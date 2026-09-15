from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class WorkSchedule(DomainModel):
    work_mode: Literal["Télétravail", "Day off", "Bureau", "Déplacement"] = "Bureau"
    start_time: str | None = None
    morning_end_time: str | None = None
    afternoon_start_time: str | None = None
    end_time: str | None = None
    third_start_time: str | None = None
    third_end_time: str | None = None

    @field_validator("start_time", "morning_end_time", "afternoon_start_time", "end_time", "third_start_time", "third_end_time")
    @classmethod
    def normalize_clock(cls, value):
        return normalize_optional_time(value)


class SportSession(DomainModel):
    session_id: UUID = Field(default_factory=uuid4)
    sport_type: str = Field(min_length=1, max_length=80)
    duration_minutes: int = Field(ge=0, le=600)
    distance_km: float | None = Field(default=None, ge=0, le=200)


class Meals(DomainModel):
    breakfast: str = ""
    lunch: str = ""
    dinner: str = ""
    other: str = ""

    def as_legacy_dict(self) -> dict[str, str]:
        return {"petit_dejeuner": self.breakfast, "dejeuner": self.lunch, "diner": self.dinner, "autres": self.other}


class DailyCheckinPatch(DomainModel):
    entry_date: date
    sleep_hours: float | None = Field(default=None, ge=0, le=24)
    nap_minutes: int | None = Field(default=None, ge=0, le=720)
    alcohol_glasses: int | None = Field(default=None, ge=0, le=100)
    weight_kg: float | None = Field(default=None, gt=0, le=500)
    body_fat_pct: float | None = Field(default=None, ge=0, le=100)
    belly_cm: float | None = Field(default=None, gt=0, le=500)
    phone_hours: float | None = Field(default=None, ge=0, le=24)
    work: WorkSchedule | None = None
    sport_sessions: list[SportSession] | None = Field(default=None, max_length=3)
    meals: Meals | None = None


def normalize_optional_time(raw) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip().lower().replace("h", ":").replace(".", ":")
    if not text:
        return None
    if text.isdigit() and len(text) in (3, 4):
        text = text[:-2] + ":" + text[-2:]
    parts = text.split(":")
    if len(parts) != 2 or not all(part.isdigit() for part in parts):
        raise ValueError("format attendu HH:MM")
    hour, minute = map(int, parts)
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
        raise ValueError("heure invalide")
    return f"{hour:02d}:{minute:02d}"
