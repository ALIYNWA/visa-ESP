"""Audit service — append-only BPC-compliant logging."""
import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.user import AuditLog

logger = get_logger(__name__)


class AuditService:
    async def log(
        self,
        db: AsyncSession,
        event_type: str,
        user_id: uuid.UUID | None = None,
        resource_type: str | None = None,
        resource_id: uuid.UUID | None = None,
        details: dict | None = None,
        ip_address: str = "",
        session_id: str = "",
    ) -> AuditLog:
        """
        Enregistrer un événement d'audit.
        JAMAIS de données patient dans les details — uniquement des UUIDs.
        """
        entry = AuditLog(
            id=uuid.uuid4(),
            event_id=uuid.uuid4(),
            timestamp=datetime.now(UTC),
            event_type=event_type,
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details or {},
            ip_address=ip_address[:45] if ip_address else None,
            session_id=session_id[:255] if session_id else None,
        )
        db.add(entry)
        await db.flush()

        # Aussi logger en structlog pour agrégation externe
        logger.info(
            "audit_event",
            event_type=event_type,
            user_id=str(user_id) if user_id else None,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id else None,
            event_id=str(entry.event_id),
        )

        return entry


def get_audit_service() -> AuditService:
    return AuditService()
