"""Security utilities: JWT, password hashing, encryption, rate limiting."""
import base64
import hashlib
import hmac
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── Mots-clés suspects pour prévention prompt injection ───────────────────────
PROMPT_INJECTION_PATTERNS = [
    r"ignore\s+(previous|all|above)",
    r"system\s*:",
    r"<\s*system\s*>",
    r"###\s*(system|instruction|prompt)",
    r"---\s*(system|instruction)",
    r"forget\s+(all|everything|previous)",
    r"new\s+instruction",
    r"override\s+(instruction|system)",
    r"\[INST\]",
    r"<\|im_start\|>",
]
INJECTION_RE = re.compile(
    "|".join(PROMPT_INJECTION_PATTERNS),
    re.IGNORECASE | re.MULTILINE,
)


# ── Hachage mot de passe ──────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── JWT ───────────────────────────────────────────────────────────────────────

def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: dict[str, Any]) -> str:
    to_encode = data.copy()
    expire = datetime.now(UTC) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])


def verify_token(token: str) -> dict[str, Any] | None:
    try:
        payload = decode_token(token)
        return payload
    except JWTError:
        return None


# ── Chiffrement AES-256-GCM ───────────────────────────────────────────────────

def _derive_key() -> bytes:
    """Dériver la clé AES-256 via PBKDF2."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=base64.b64decode(settings.ENCRYPTION_SALT),
        iterations=settings.PBKDF2_ITERATIONS,
    )
    return kdf.derive(base64.b64decode(settings.ENCRYPTION_KEY))


def encrypt_data(plaintext: str) -> str:
    """Chiffre une chaîne en AES-256-GCM. Retourne base64(nonce + ciphertext)."""
    key = _derive_key()
    aesgcm = AESGCM(key)
    nonce = secrets.token_bytes(12)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ciphertext).decode("utf-8")


def decrypt_data(encoded: str) -> str:
    """Déchiffre une chaîne chiffrée par encrypt_data."""
    key = _derive_key()
    aesgcm = AESGCM(key)
    raw = base64.b64decode(encoded)
    nonce, ciphertext = raw[:12], raw[12:]
    return aesgcm.decrypt(nonce, ciphertext, None).decode("utf-8")


# ── Hash SHA-256 ───────────────────────────────────────────────────────────────

def hash_prompt(prompt: str) -> str:
    """Calculer le hash SHA-256 du prompt complet."""
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()


# ── Sanitisation et prévention injection ─────────────────────────────────────

def sanitize_text_field(text: str, max_length: int = 1000) -> str:
    """Sanitise un champ texte libre : troncature + détection injection."""
    if not text:
        return text

    # Troncature
    sanitized = text[:max_length]

    # Détection prompt injection
    if INJECTION_RE.search(sanitized):
        logger.warning(
            "prompt_injection_detected",
            text_preview=sanitized[:50],
        )
        # Remplacer les patterns dangereux par [REDACTED]
        sanitized = INJECTION_RE.sub("[REDACTED]", sanitized)

    return sanitized


def check_prompt_injection(text: str) -> bool:
    """Retourne True si une tentative d'injection est détectée."""
    return bool(INJECTION_RE.search(text))


# ── Génération de tokens sécurisés ────────────────────────────────────────────

def generate_session_id() -> str:
    return secrets.token_urlsafe(32)
