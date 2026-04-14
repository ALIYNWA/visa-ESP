"""Initial schema with all tables, triggers, and indexes.

Revision ID: 001
Revises:
Create Date: 2024-01-01 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Extension pgcrypto pour le chiffrement ────────────────────────────────
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    # ── Enum types ────────────────────────────────────────────────────────────
    op.execute("CREATE TYPE protocol_phase AS ENUM ('I', 'II', 'III', 'IV')")
    op.execute("CREATE TYPE criterion_type AS ENUM ('INC', 'EXC')")
    op.execute("CREATE TYPE verdict_type AS ENUM ('eligible', 'non_eligible', 'incomplet')")
    op.execute("CREATE TYPE criterion_status AS ENUM ('satisfait', 'non_satisfait', 'inconnu')")
    op.execute("CREATE TYPE override_status AS ENUM ('satisfait', 'non_satisfait')")
    op.execute("CREATE TYPE user_role AS ENUM ('admin', 'investigateur_principal', 'co_investigateur', 'arc', 'tec')")

    # ── Table users ───────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("username", sa.String(100), nullable=False, unique=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("hashed_password", sa.String(255), nullable=True),
        sa.Column("role", postgresql.ENUM("admin", "investigateur_principal", "co_investigateur", "arc", "tec", name="user_role", create_type=False), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    # ── Table protocols ───────────────────────────────────────────────────────
    op.create_table(
        "protocols",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("eudract_number", sa.String(50), nullable=True, unique=True),
        sa.Column("phase", postgresql.ENUM("I", "II", "III", "IV", name="protocol_phase", create_type=False), nullable=False),
        sa.Column("pathology", sa.String(255), nullable=False),
        sa.Column("summary", sa.Text, nullable=True),
        sa.Column("promoter", sa.String(255), nullable=True),
        sa.Column("arc_referent", sa.String(255), nullable=True),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
    )

    # ── Table criteria ────────────────────────────────────────────────────────
    op.create_table(
        "criteria",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("protocol_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("protocols.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", postgresql.ENUM("INC", "EXC", name="criterion_type", create_type=False), nullable=False),
        sa.Column("text", sa.String(1000), nullable=False),
        sa.Column("order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    # ── Table patients ────────────────────────────────────────────────────────
    op.create_table(
        "patients",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("pseudonym", sa.String(100), nullable=False, unique=True),
        sa.Column("context_encrypted", sa.Text, nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    # ── Table analyses ────────────────────────────────────────────────────────
    op.create_table(
        "analyses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("protocol_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("protocols.id"), nullable=False),
        sa.Column("protocol_version", sa.Integer, nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("verdict", postgresql.ENUM("eligible", "non_eligible", "incomplet", name="verdict_type", create_type=False), nullable=False),
        sa.Column("score_pct", sa.Integer, nullable=False, server_default="0"),
        sa.Column("resume", sa.Text, nullable=True),
        sa.Column("points_attention", postgresql.JSONB, nullable=True),
        sa.Column("prompt_hash", sa.String(64), nullable=False),
        sa.Column("model_name", sa.String(100), nullable=False),
        sa.Column("model_version", sa.String(100), nullable=True),
        sa.Column("raw_llm_response_encrypted", sa.Text, nullable=True),
        sa.Column("latency_ms", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("validated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("score_pct >= 0 AND score_pct <= 100", name="check_score_pct_range"),
    )

    # ── Table criterion_results ───────────────────────────────────────────────
    op.create_table(
        "criterion_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("analysis_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("criterion_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("criteria.id"), nullable=False),
        sa.Column("criterion_text", sa.String(1000), nullable=False),
        sa.Column("criterion_type", postgresql.ENUM("INC", "EXC", name="criterion_type", create_type=False), nullable=False),
        sa.Column("status", postgresql.ENUM("satisfait", "non_satisfait", "inconnu", name="criterion_status", create_type=False), nullable=False),
        sa.Column("reasoning", sa.Text, nullable=True),
        sa.Column("overridden_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("overridden_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("override_note", sa.Text, nullable=True),
        sa.Column("override_status", postgresql.ENUM("satisfait", "non_satisfait", name="override_status", create_type=False), nullable=True),
    )

    # ── Table audit_logs (append-only) ────────────────────────────────────────
    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resource_type", sa.String(100), nullable=True),
        sa.Column("resource_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("details", postgresql.JSONB, nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("session_id", sa.String(255), nullable=True),
    )

    # ── Index de performance ──────────────────────────────────────────────────
    op.create_index("ix_analyses_protocol_id", "analyses", ["protocol_id"])
    op.create_index("ix_analyses_patient_id", "analyses", ["patient_id"])
    op.create_index("ix_analyses_created_at", "analyses", ["created_at"])
    op.create_index("ix_criteria_protocol_id", "criteria", ["protocol_id"])
    op.create_index("ix_audit_logs_timestamp", "audit_logs", ["timestamp"])
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index("ix_audit_logs_resource", "audit_logs", ["resource_type", "resource_id"])

    # ── Trigger : audit_logs append-only ─────────────────────────────────────
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_audit_modification()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'Les logs audit sont en lecture seule (BPC compliance)';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER audit_logs_no_update
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
    """)

    # ── Trigger : analyses immuables après validation ─────────────────────────
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_validated_analysis_modification()
        RETURNS TRIGGER AS $$
        BEGIN
            IF OLD.validated_at IS NOT NULL THEN
                RAISE EXCEPTION 'Impossible de modifier une analyse validée (id: %)', OLD.id;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER analyses_immutable_after_validation
        BEFORE UPDATE ON analyses
        FOR EACH ROW EXECUTE FUNCTION prevent_validated_analysis_modification();
    """)

    # ── Trigger : updated_at automatique sur protocols ────────────────────────
    op.execute("""
        CREATE OR REPLACE FUNCTION update_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER protocols_updated_at
        BEFORE UPDATE ON protocols
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    """)


def downgrade() -> None:
    op.drop_table("audit_logs")
    op.drop_table("criterion_results")
    op.drop_table("analyses")
    op.drop_table("patients")
    op.drop_table("criteria")
    op.drop_table("protocols")
    op.drop_table("users")

    op.execute("DROP TYPE IF EXISTS user_role")
    op.execute("DROP TYPE IF EXISTS override_status")
    op.execute("DROP TYPE IF EXISTS criterion_status")
    op.execute("DROP TYPE IF EXISTS verdict_type")
    op.execute("DROP TYPE IF EXISTS criterion_type")
    op.execute("DROP TYPE IF EXISTS protocol_phase")
    op.execute("DROP FUNCTION IF EXISTS prevent_audit_modification()")
    op.execute("DROP FUNCTION IF EXISTS prevent_validated_analysis_modification()")
    op.execute("DROP FUNCTION IF EXISTS update_updated_at()")
