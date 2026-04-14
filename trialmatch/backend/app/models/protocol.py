"""SQLAlchemy model: Protocol."""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Protocol(Base):
    __tablename__ = "protocols"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    eudract_number: Mapped[str | None] = mapped_column(String(50), nullable=True, unique=True)
    phase: Mapped[str] = mapped_column(
        Enum("I", "II", "III", "IV", name="protocol_phase"), nullable=False
    )
    pathology: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    promoter: Mapped[str | None] = mapped_column(String(255), nullable=True)
    arc_referent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("NOW()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("NOW()")
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )

    # Relations
    criteria = relationship("Criterion", back_populates="protocol", cascade="all, delete-orphan")
    analyses = relationship("Analysis", back_populates="protocol")
    creator = relationship(
        "User",
        back_populates="protocols",
        foreign_keys=[created_by],
        primaryjoin="Protocol.created_by == User.id",
    )
