"""Pydantic v2 schema strict pour la sortie JSON du LLM."""
import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class CriterionLLMResult(BaseModel):
    """Résultat d'évaluation d'un critère par le LLM."""
    model_config = {"strict": True}

    criterion_id: str = Field(min_length=1)
    statut: Literal["satisfait", "non_satisfait", "inconnu"]
    raisonnement: str = Field(min_length=1, max_length=200)

    @field_validator("criterion_id")
    @classmethod
    def validate_uuid_format(cls, v: str) -> str:
        try:
            uuid.UUID(v)
        except ValueError:
            raise ValueError(f"criterion_id must be a valid UUID: {v}")
        return v


class LLMAnalysisOutput(BaseModel):
    """Schéma de sortie JSON strict attendu du LLM Meditron."""
    model_config = {"strict": True}

    verdict: Literal["eligible", "non_eligible", "incomplet"]
    score_pct: Annotated[int, Field(ge=0, le=100)]
    resume: str = Field(min_length=1, max_length=500)
    criteres: list[CriterionLLMResult] = Field(min_length=0)
    points_attention: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_criteres_not_empty_if_criteria_exist(self) -> "LLMAnalysisOutput":
        return self
