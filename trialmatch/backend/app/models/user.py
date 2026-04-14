"""SQLAlchemy models: User and AuditLog."""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    username: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(
        Enum(
            "admin", "investigateur_principal", "co_investigateur", "arc", "tec",
            name="user_role",
        ),
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("NOW()")
    )

    # Relations
    protocols = relationship("Protocol", back_populates="creator", foreign_keys="Protocol.created_by")
    patients = relationship("Patient", back_populates="creator")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("NOW()")
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    resource_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    resource_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
