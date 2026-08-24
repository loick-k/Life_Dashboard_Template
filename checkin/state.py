from datetime import datetime, time, timedelta

import pandas as pd

from app_clock import today_paris
from app_config import CHECKIN_VERSION


def _migrate_progress_v1(completed: set[int], skipped: set[int]) -> tuple[set[int], set[int]]:
    new_completed = {step for step in completed if step <= 5}
    new_skipped = {step for step in skipped if step <= 5}
    old_accounted = completed | skipped
    if {6, 7}.issubset(completed):
        new_completed.add(6)
    elif {6, 7}.issubset(old_accounted):
        new_skipped.add(6)
    for old_step in (8, 9, 10):
        new_step = old_step - 1
        if old_step in completed:
            new_completed.add(new_step)
        if old_step in skipped:
            new_skipped.add(new_step)
    return new_completed, new_skipped


def _migrate_progress_v2(completed: set[int], skipped: set[int]) -> tuple[set[int], set[int]]:
    new_completed = {step for step in completed if step <= 7}
    new_skipped = {step for step in skipped if step <= 7}
    old_accounted = completed | skipped
    if 8 in old_accounted:
        new_skipped.add(8)
    for old_step in (8, 9):
        new_step = old_step + 1
        if old_step in completed:
            new_completed.add(new_step)
        if old_step in skipped:
            new_skipped.add(new_step)
    return new_completed, new_skipped


def _migrate_progress_v3(completed: set[int], skipped: set[int]) -> tuple[set[int], set[int]]:
    """Insère Temps pour moi avant Social sans invalider les anciennes journées."""
    new_completed = {step for step in completed if step <= 8}
    new_skipped = {step for step in skipped if step <= 8}
    for old_step in (9, 10):
        new_step = old_step + 1
        if old_step in completed:
            new_completed.add(new_step)
        if old_step in skipped:
            new_skipped.add(new_step)
    new_skipped.add(9)
    return new_completed, new_skipped


def _migrate_progress_v4(completed: set[int], skipped: set[int]) -> tuple[set[int], set[int]]:
    """Insère l'étape Écoute avant Social sans invalider les anciennes journées."""
    new_completed = {step for step in completed if step <= 9}
    new_skipped = {step for step in skipped if step <= 9}
    for old_step in (10, 11):
        new_step = old_step + 1
        if old_step in completed:
            new_completed.add(new_step)
        if old_step in skipped:
            new_skipped.add(new_step)
    new_skipped.add(10)
    return new_completed, new_skipped


def _clean(value, default=None):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return default
    return value


def _initial_draft(existing: dict | None) -> dict:
    row = existing or {}
    stored_sleep = float(_clean(row.get("sleep_hours"), 7.5))
    bedtime = str(_clean(row.get("sleep_bedtime"), "23:00") or "23:00")
    wake_time = str(_clean(row.get("sleep_wake_time"), "") or "")
    if not wake_time:
        wake_dt = datetime.combine(today_paris(), time(23, 0)) + timedelta(hours=stored_sleep)
        wake_time = wake_dt.strftime("%H:%M")
    return {
        "sleep_hours": stored_sleep,
        "sleep_bedtime": bedtime,
        "sleep_wake_time": wake_time,
        "nap_minutes": int(_clean(row.get("nap_minutes"), 0)),
        "alcohol_glasses": int(_clean(row.get("alcohol_glasses"), 0)),
        "weight_kg": _clean(row.get("weight_kg")),
        "body_fat_pct": _clean(row.get("body_fat_pct")),
        "belly_cm": _clean(row.get("belly_cm", row.get("waist_cm"))),
        "work_travel": str(_clean(row.get("work_travel"), "Non") or "Non"),
        "work_start_time": str(_clean(row.get("work_start_time"), "") or ""),
        "work_morning_end_time": str(_clean(row.get("work_morning_end_time"), "") or ""),
        "work_afternoon_start_time": str(_clean(row.get("work_afternoon_start_time"), "") or ""),
        "work_end_time": str(_clean(row.get("work_end_time"), "") or ""),
        "work_third_start_time": str(_clean(row.get("work_third_start_time"), "") or ""),
        "work_third_end_time": str(_clean(row.get("work_third_end_time"), "") or ""),
        "sport_type": str(_clean(row.get("sport_type"), "") or ""),
        "sport_minutes": int(round(float(_clean(row.get("sport_hours"), 0)) * 60)),
        "sport_sessions": [],
        "phone_hours": float(_clean(row.get("phone_hours"), 0)),
        "meal_breakfast": str(_clean(row.get("meal_breakfast"), "") or ""),
        "meal_lunch": str(_clean(row.get("meal_lunch"), "") or ""),
        "meal_dinner": str(_clean(row.get("meal_dinner"), "") or ""),
        "meal_other": str(_clean(row.get("meal_other"), "") or ""),
        "me_time_writing_minutes": int(_clean(row.get("me_time_writing_minutes"), 0)),
        "me_time_meditation_minutes": int(_clean(row.get("me_time_meditation_minutes"), 0)),
        "me_time_relaxation_minutes": int(_clean(row.get("me_time_relaxation_minutes"), 0)),
        "me_time_outings_minutes": int(_clean(row.get("me_time_outings_minutes"), 0)),
        "self_listening_score": _clean(row.get("self_listening_score")),
        "close_relations_listening_score": _clean(row.get("close_relations_listening_score")),
        "friend_ids": [],
        "social_context": "Vu en personne",
        "social_duration": None,
        "social_note": "",
        "goals": {},
        "_skipped": set(),
        "_completed": set(),
        "_progress_version": CHECKIN_VERSION,
    }
