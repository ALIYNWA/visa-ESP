"""
Pydantic request/response models.
"""
from typing import Optional
from pydantic import BaseModel, HttpUrl, field_validator


# ---------------------------------------------------------------------------
# RFP
# ---------------------------------------------------------------------------
class RFPImportUrl(BaseModel):
    url: str
    title: Optional[str] = None
    issuer: Optional[str] = None


class RFPImportText(BaseModel):
    raw_text: str
    title: Optional[str] = None
    issuer: Optional[str] = None
    source_url: Optional[str] = None
    deadline: Optional[str] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None


class RFPUpdate(BaseModel):
    title: Optional[str] = None
    issuer: Optional[str] = None
    deadline: Optional[str] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    status: Optional[str] = None
    tags: Optional[list[str]] = None


# ---------------------------------------------------------------------------
# Strategy
# ---------------------------------------------------------------------------
class ScenarioDetail(BaseModel):
    price: Optional[float] = None
    price_rationale: Optional[str] = None
    effort_days: Optional[int] = None
    team_size: Optional[int] = None
    risk_level: Optional[str] = None        # low | medium | high
    win_probability: Optional[float] = None  # 0.0 – 1.0
    approach: Optional[str] = None
    pros: list[str] = []
    cons: list[str] = []


class StrategyResponse(BaseModel):
    rfp_id: str
    worst_case: ScenarioDetail
    medium_case: ScenarioDetail
    best_case: ScenarioDetail
    recommendation: str
    key_differentiators: list[str] = []
    created_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Scraping
# ---------------------------------------------------------------------------
class ScrapeRequest(BaseModel):
    source: str = "boamp"          # boamp | ted
    query: str = "logiciel santé"
    max_results: int = 20
