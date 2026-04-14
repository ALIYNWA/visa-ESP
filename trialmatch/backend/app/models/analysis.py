"""SQLAlchemy models: Analysis and CriterionResult."""
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Analysis(Base):
    __tablename__ = "analyses"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    protocol_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("protocols.id"), nullable=False
    )
    protocol_version: Mapped[int] = mapped_column(Integer, nullable=False)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    verdict: Mapped[str] = mapped_column(
        Enum("eligible", "non_eligible", "incomplet", name="verdict_type"), nullable=False
    )
    score_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    resume: Mapped[str | None] = mapped_column(Text, nullable=True)
    points_attention: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    prompt_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    model_name: Mapped[str] = mapped_column(String(100), nullable=False)
    model_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    raw_llm_response_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("NOW()")
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    validated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    validated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        CheckConstraint("score_pct >= 0 AND score_pct <= 100", name="check_score_pct_range"),
    )

    # Relations
    protocol = relationship("Protocol", back_populates="analyses")
    patient = relationship("Patient", back_populates="analyses")
    criterion_results = relationship(
        "CriterionResult", back_populates="analysis", cascade="all, delete-orphan"
    )
    validator = relationship(
        "User", foreign_keys=[validated_by],
        primaryjoin="Analysis.validated_by == User.id",
    )
    creator = relationship(
        "User", foreign_keys=[created_by],
        primaryjoin="Analysis.created_by == User.id",
    )


class CriterionResult(Base):
    __tablename__ = "criterion_results"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    analysis_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False
    )
    criterion_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("criteria.id"), nullable=False
    )
    criterion_text: Mapped[str] = mapped_column(String(1000), nullable=False)
    criterion_type: Mapped[str] = mapped_column(
        Enum("INC", "EXC", name="criterion_type"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        Enum("satisfait", "non_satisfait", "inconnu", name="criterion_status"), nullable=False
    )
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    overridden_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    overridden_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    override_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    override_status: Mapped[str | None] = mapped_column(
        Enum("satisfait", "non_satisfait", name="override_status"), nullable=True
    )

    # Relations
    analysis = relationship("Analysis", back_populates="criterion_results")
    criterion = relationship("Criterion", back_populates="results")
    overrider = relationship(
        "User", foreign_keys=[overridden_by],
        primaryjoin="CriterionResult.overridden_by == User.id",
    )
