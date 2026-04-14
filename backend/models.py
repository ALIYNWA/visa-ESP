"""
Modèles de données Pydantic
"""
from pydantic import BaseModel, Field, model_validator
from datetime import datetime, timezone
from typing import Optional, List, Any


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CheckResult(BaseModel):
    timestamp: datetime
    available: bool
    slots_count: int
    message: str
    duration_ms: Optional[float] = None
    error: Optional[str] = None

    def to_log(self) -> str:
        status = "DISPONIBLE [OK]" if self.available else "Indisponible [--]"
        ts = self.timestamp.strftime("%Y-%m-%d %H:%M:%S")
        return f"[{ts}] {status} | creneaux: {self.slots_count} | {self.message}"


class MonitorStatus(BaseModel):
    is_running: bool
    current_status: Optional[bool] = None
    slots_detected: int = 0
    total_checks: int = 0
    last_check: Optional[datetime] = None
    next_check: Optional[datetime] = None
    last_notification: Optional[datetime] = None
    uptime_since: Optional[datetime] = None
    history: List[CheckResult] = []


class WSMessage(BaseModel):
    type: str   # "check_result" | "status_update" | "notification" | "log"
    data: dict
    timestamp: datetime = Field(default_factory=_now)

    model_config = {"json_encoders": {datetime: lambda v: v.isoformat()}}
