"""SQLAlchemy model: Patient (contexte chiffré AES-256)."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    pseudonym: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    # Le contexte clinique est chiffré AES-256-GCM avant stockage
    context_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("NOW()")
    )

    # Relations
    creator = relationship("User", back_populates="patients")
    analyses = relationship("Analysis", back_populates="patient")
