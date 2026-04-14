"""Pydantic v2 schemas for Analysis and CriterionResult."""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CriterionResultRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    criterion_id: uuid.UUID
    criterion_text: str
    criterion_type: Literal["INC", "EXC"]
    status: Literal["satisfait", "non_satisfait", "inconnu"]
    reasoning: str | None
    overridden_by: uuid.UUID | None
    overridden_at: datetime | None
    override_note: str | None
    override_status: Literal["satisfait", "non_satisfait"] | None


class AnalysisCreate(BaseModel):
    protocol_id: uuid.UUID
    patient_id: uuid.UUID


class AnalysisRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    protocol_id: uuid.UUID
    protocol_version: int
    patient_id: uuid.UUID
    verdict: Literal["eligible", "non_eligible", "incomplet"]
    score_pct: int
    resume: str | None
    points_attention: list[str] | None
    prompt_hash: str
    model_name: str
    model_version: str | None
    latency_ms: int | None
    created_at: datetime
    created_by: uuid.UUID
    validated_by: uuid.UUID | None
    validated_at: datetime | None
    criterion_results: list[CriterionResultRead] = Field(default_factory=list)


class AnalysisListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    protocol_id: uuid.UUID
    patient_id: uuid.UUID
    verdict: str
    score_pct: int
    created_at: datetime
    validated_at: datetime | None


class AnalysisValidate(BaseModel):
    """Payload pour valider une fiche RCP."""
    signature_note: str | None = Field(default=None, max_length=500)


class CriterionOverride(BaseModel):
    """Payload pour overrider un critère."""
    override_status: Literal["satisfait", "non_satisfait"]
    override_note: str = Field(min_length=1, max_length=1000)


class MatchAllRequest(BaseModel):
    """Lance l'analyse d'un patient sur tous les protocoles actifs."""
    patient_id: uuid.UUID


class DashboardStats(BaseModel):
    total_protocols: int
    active_protocols: int
    total_patients: int
    total_analyses: int
    analyses_last_7_days: int
    eligible_rate_pct: float
    pending_validation: int
