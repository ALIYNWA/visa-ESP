"""SQLAlchemy model: Criterion."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Criterion(Base):
    __tablename__ = "criteria"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    protocol_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("protocols.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(
        Enum("INC", "EXC", name="criterion_type"), nullable=False
    )
    text: Mapped[str] = mapped_column(String(1000), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("NOW()")
    )

    # Relations
    protocol = relationship("Protocol", back_populates="criteria")
    results = relationship("CriterionResult", back_populates="criterion")
