import hashlib
import json

from domain.models import Meals, SportSession


def nutrition_source_hash(meals: Meals, sport_sessions: list[SportSession] | None = None, weight_kg: float | None = None) -> str:
    normalized = {
        "meals": {key: " ".join(value.strip().lower().split()) for key, value in sorted(meals.as_legacy_dict().items())},
        "sport_sessions": [session.model_dump(mode="json") for session in (sport_sessions or [])],
        "weight_kg": weight_kg,
    }
    payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def has_nutrition_content(meals: Meals, sessions: list[SportSession] | None = None) -> bool:
    return any(meals.as_legacy_dict().values()) or any(session.duration_minutes > 0 for session in (sessions or []))
