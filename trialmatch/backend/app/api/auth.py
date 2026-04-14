"""Authentication endpoints — login, logout, me, refresh."""
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, CurrentUser, get_audit, get_client_ip, revoke_token
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
    verify_token,
)
from app.models.user import User
from app.services.audit_service import AuditService

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Rate limiting (en mémoire — Redis en production) ─────────────────────────
_login_attempts: dict[str, list[datetime]] = defaultdict(list)
_locked_ips: dict[str, datetime] = {}


def _check_rate_limit(ip: str) -> None:
    now = datetime.now(UTC)

    # Vérifier si l'IP est bloquée
    if ip in _locked_ips:
        lock_until = _locked_ips[ip]
        if now < lock_until:
            remaining = int((lock_until - now).total_seconds() / 60)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed attempts. Locked for {remaining} more minutes.",
            )
        else:
            del _locked_ips[ip]
            _login_attempts[ip] = []

    # Nettoyer les tentatives expirées
    window = timedelta(minutes=settings.RATE_LIMIT_WINDOW_MINUTES)
    _login_attempts[ip] = [t for t in _login_attempts[ip] if now - t < window]

    # Vérifier le nombre de tentatives
    if len(_login_attempts[ip]) >= settings.RATE_LIMIT_LOGIN_ATTEMPTS:
        lock_until = now + timedelta(minutes=settings.RATE_LIMIT_LOCKOUT_MINUTES)
        _locked_ips[ip] = lock_until
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed attempts. Locked for {settings.RATE_LIMIT_LOCKOUT_MINUTES} minutes.",
        )


def _record_failed_attempt(ip: str) -> None:
    _login_attempts[ip].append(datetime.now(UTC))


# ── Schemas ───────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=256)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: str
    role: str


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    role: str
    is_active: bool
    last_login: datetime | None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
async def login(
    request: Request,
    body: LoginRequest,
    response: Response,
    db: DB,
    audit: AuditService = Depends(get_audit),
) -> LoginResponse:
    ip = get_client_ip(request)
    _check_rate_limit(ip)

    # Chercher l'utilisateur
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password or not verify_password(body.password, user.hashed_password):
        _record_failed_attempt(ip)
        await audit.log(
            db=db,
            event_type="login_failed",
            details={"username": body.username, "reason": "invalid_credentials"},
            ip_address=ip,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is inactive",
        )

    # Générer les tokens
    access_token = create_access_token({"sub": str(user.id), "role": user.role})
    refresh_token = create_refresh_token({"sub": str(user.id)})

    # Mettre à jour le dernier login
    user.last_login = datetime.now(UTC)

    # Refresh token en cookie httpOnly sécurisé
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
        max_age=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/api/v1/auth/refresh",
    )

    await audit.log(
        db=db,
        event_type="login_success",
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=ip,
    )

    return LoginResponse(
        access_token=access_token,
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user_id=str(user.id),
        role=user.role,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    current_user: CurrentUser,
    db: DB,
    audit: AuditService = Depends(get_audit),
) -> None:
    # Révoquer le token actuel
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        revoke_token(token)

    # Supprimer le cookie de refresh
    response.delete_cookie("refresh_token", path="/api/v1/auth/refresh")

    await audit.log(
        db=db,
        event_type="logout",
        user_id=current_user.id,
        resource_type="user",
        resource_id=current_user.id,
        ip_address=get_client_ip(request),
    )


@router.post("/refresh", response_model=LoginResponse)
async def refresh(
    request: Request,
    response: Response,
    db: DB,
    refresh_token: Annotated[str | None, Cookie()] = None,
) -> LoginResponse:
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")

    payload = verify_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    # Rotation : nouveau pair de tokens
    new_access = create_access_token({"sub": str(user.id), "role": user.role})
    new_refresh = create_refresh_token({"sub": str(user.id)})
    revoke_token(refresh_token)

    response.set_cookie(
        key="refresh_token",
        value=new_refresh,
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
        max_age=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/api/v1/auth/refresh",
    )

    return LoginResponse(
        access_token=new_access,
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user_id=str(user.id),
        role=user.role,
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: CurrentUser) -> UserResponse:
    return UserResponse(
        id=str(current_user.id),
        username=current_user.username,
        email=current_user.email,
        role=current_user.role,
        is_active=current_user.is_active,
        last_login=current_user.last_login,
    )
