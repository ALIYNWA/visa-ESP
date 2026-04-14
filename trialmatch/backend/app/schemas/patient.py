"""Pydantic v2 schemas for Patient."""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PatientContextData(BaseModel):
    """Données cliniques du patient — validées avant chiffrement."""
    age: int | None = Field(default=None, ge=0, le=150)
    sexe: str | None = Field(default=None, pattern=r"^(M|F|Autre)$")
    diagnostic_principal: str | None = Field(default=None, max_length=500)
    stade: str | None = Field(default=None, max_length=100)
    antecedents: list[str] = Field(default_factory=list, max_length=50)
    traitements_en_cours: list[str] = Field(default_factory=list, max_length=50)
    biologie: dict[str, str | float | None] = Field(default_factory=dict)
    ecog_performance_status: int | None = Field(default=None, ge=0, le=4)
    poids_kg: float | None = Field(default=None, gt=0, le=500)
    taille_cm: float | None = Field(default=None, gt=0, le=300)
    allergies: list[str] = Field(default_factory=list)
    notes_libres: str | None = Field(default=None, max_length=5000)
    model_config = ConfigDict(extra="allow")


class PatientCreate(BaseModel):
    pseudonym: str = Field(min_length=1, max_length=100)
    context: PatientContextData


class PatientUpdate(BaseModel):
    pseudonym: str | None = Field(default=None, min_length=1, max_length=100)
    context: PatientContextData | None = None


class PatientRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    pseudonym: str
    context: PatientContextData | None = None
    created_by: uuid.UUID
    created_at: datetime


class PatientListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    pseudonym: str
    created_at: datetime
