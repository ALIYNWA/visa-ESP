"""FastAPI dependency injection — auth, DB, services."""
import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.core.security import verify_token
from app.models.user import User
from app.services.audit_service import AuditService, get_audit_service
from app.services.eligibility_engine import EligibilityEngine
from app.services.llm_service import LLMService, get_llm_service

logger = get_logger(__name__)

bearer_scheme = HTTPBearer(auto_error=False)

# ── Revoked tokens store (in-memory pour MVP, Redis en production) ─────────────
_revoked_tokens: set[str] = set()


def revoke_token(token: str) -> None:
    _revoked_tokens.add(token)


def is_token_revoked(token: str) -> bool:
    return token in _revoked_tokens


# ── Auth dependencies ─────────────────────────────────────────────────────────

async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: AsyncSession = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    if is_token_revoked(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
        )

    payload = verify_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


# ── Role-based access control ─────────────────────────────────────────────────

ROLE_HIERARCHY = {
    "admin": 5,
    "investigateur_principal": 4,
    "co_investigateur": 3,
    "arc": 2,
    "tec": 1,
}


def require_role(*roles: str):
    """Dependency factory: require one of the specified roles."""
    async def check_role(current_user: CurrentUser) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role}' is not authorized for this action",
            )
        return current_user
    return check_role


def require_min_role(min_role: str):
    """Require at least a minimum role level."""
    min_level = ROLE_HIERARCHY.get(min_role, 0)

    async def check_min_role(current_user: CurrentUser) -> User:
        user_level = ROLE_HIERARCHY.get(current_user.role, 0)
        if user_level < min_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required: {min_role}",
            )
        return current_user
    return check_min_role


# ── Service dependencies ──────────────────────────────────────────────────────

def get_llm(request: Request) -> LLMService:
    return get_llm_service()


def get_audit(request: Request) -> AuditService:
    return get_audit_service()


def get_eligibility_engine(
    llm: LLMService = Depends(get_llm),
    audit: AuditService = Depends(get_audit),
) -> EligibilityEngine:
    return EligibilityEngine(llm, audit)


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""
