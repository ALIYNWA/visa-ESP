"""Pydantic v2 schemas for Protocol and Criterion."""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CriterionBase(BaseModel):
    type: Literal["INC", "EXC"]
    text: str = Field(min_length=1, max_length=1000)
    order: int = Field(default=0, ge=0)


class CriterionCreate(CriterionBase):
    pass


class CriterionUpdate(BaseModel):
    type: Literal["INC", "EXC"] | None = None
    text: str | None = Field(default=None, min_length=1, max_length=1000)
    order: int | None = Field(default=None, ge=0)


class CriterionRead(CriterionBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    protocol_id: uuid.UUID
    created_at: datetime


class ProtocolBase(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    eudract_number: str | None = Field(default=None, max_length=50)
    phase: Literal["I", "II", "III", "IV"]
    pathology: str = Field(min_length=1, max_length=255)
    summary: str | None = None
    promoter: str | None = Field(default=None, max_length=255)
    arc_referent: str | None = Field(default=None, max_length=255)


class ProtocolCreate(ProtocolBase):
    criteria: list[CriterionCreate] = Field(default_factory=list)


class ProtocolUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    eudract_number: str | None = Field(default=None, max_length=50)
    phase: Literal["I", "II", "III", "IV"] | None = None
    pathology: str | None = Field(default=None, min_length=1, max_length=255)
    summary: str | None = None
    promoter: str | None = Field(default=None, max_length=255)
    arc_referent: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None


class ProtocolRead(ProtocolBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    created_by: uuid.UUID
    criteria: list[CriterionRead] = Field(default_factory=list)


class ProtocolListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    eudract_number: str | None
    phase: str
    pathology: str
    version: int
    is_active: bool
    created_at: datetime
    criteria_count: int = 0
