from datetime import date

import pandas as pd

from dashboard_metrics import setting_float, week_bounds
from app_clock import today_paris
from domain.models import WorkSchedule, normalize_optional_time
from domain.work import (
    DAILY_WORK_TARGET_MINUTES,
    duration_between as _duration_between_minutes,
    time_to_minutes,
    work_duration_minutes,
)


DAILY_WORK_TARGET_HOURS = DAILY_WORK_TARGET_MINUTES / 60


def parse_optional_time(raw, label, errors):
    """Normalise une heure HH:MM, H:MM, 8h30 ou 0830."""
    try:
        return normalize_optional_time(raw)
    except ValueError as exc:
        detail = "format attendu HH:MM, par exemple 08:30." if "format" in str(exc) else "heure invalide."
        errors.append(f"{label} : {detail}")
        return None


def duration_between(start_time, end_time):
    if not start_time or not end_time:
        return None
    return _duration_between_minutes(start_time, end_time) / 60


def compute_work_duration(start_time, morning_end_time, afternoon_start_time, end_time, errors,
                          third_start_time=None, third_end_time=None):
    try:
        minutes = work_duration_minutes(WorkSchedule(
            start_time=start_time, morning_end_time=morning_end_time,
            afternoon_start_time=afternoon_start_time, end_time=end_time,
            third_start_time=third_start_time, third_end_time=third_end_time,
        ))
        return None if minutes is None else round(minutes / 60, 2)
    except ValueError:
        errors.append("Suivi travail : chaque créneau commencé doit comporter une heure de début et une heure de fin.")
        return None


def format_hour_decimal(value):
    if value is None or pd.isna(value):
        return "—"
    value = float(value)
    hours = int(value)
    minutes = int(round((value - hours) * 60))
    if minutes == 60:
        hours += 1
        minutes = 0
    return f"{hours}h{minutes:02d}"


def work_day_balance(duration_hours, day_off=False):
    if duration_hours is None or pd.isna(duration_hours):
        return None
    target = 0 if day_off else DAILY_WORK_TARGET_HOURS
    return round(float(duration_hours) - target, 2)


def work_balance_before_day(work_entries) -> float:
    """Solde cumule des journees precedentes dont la duree est calculable."""
    if work_entries is None or work_entries.empty:
        return 0.0
    cumulative_balance = 0.0
    for _, row in work_entries.iterrows():
        duration = row.get("work_duration_hours")
        if duration is None or pd.isna(duration):
            duration = row.get("work_hours")
        if duration is None or pd.isna(duration):
            continue
        cumulative_balance += work_day_balance(
            float(duration), day_off=row.get("work_travel") == "Day off"
        ) or 0.0
    return round(cumulative_balance, 2)


def format_signed_duration(value):
    if value is None or pd.isna(value):
        return "—"
    value = float(value)
    if abs(value) < (0.5 / 60):
        return "À l’équilibre"
    sign = "+" if value > 0 else "−"
    return f"{sign}{format_hour_decimal(abs(value))}"


def work_week_table(df_entries, settings, ref_date=None):
    ref_date = ref_date or today_paris()
    monday, sunday = week_bounds(ref_date)
    if df_entries.empty:
        return pd.DataFrame()
    frame = df_entries[
        (df_entries["entry_date"] >= monday) & (df_entries["entry_date"] <= sunday)
    ].copy()
    if frame.empty:
        return pd.DataFrame()
    frame["duration"] = pd.to_numeric(
        frame.get("work_duration_hours", frame.get("work_hours")), errors="coerce"
    )
    if "work_hours" in frame.columns:
        frame["duration"] = frame["duration"].fillna(
            pd.to_numeric(frame["work_hours"], errors="coerce")
        )
    frame = frame[frame["duration"].notna()].sort_values("entry_date")
    cumulative = 0.0
    cumulative_balance = 0.0
    rows = []
    for _, row in frame.iterrows():
        duration = float(row["duration"])
        cumulative += duration
        balance = work_day_balance(duration, day_off=row.get("work_travel") == "Day off") or 0.0
        cumulative_balance += balance
        rows.append({
            "Date": row["entry_date"].strftime("%d/%m/%Y"),
            "Déplacement": row.get("work_travel") or "—",
            "Heure début journée": row.get("work_start_time") or "—",
            "Heure fin matinée": row.get("work_morning_end_time") or "—",
            "Heure début aprem": row.get("work_afternoon_start_time") or "—",
            "Heure fin de journée": row.get("work_end_time") or "—",
            "Début créneau 3": row.get("work_third_start_time") or "—",
            "Fin créneau 3": row.get("work_third_end_time") or "—",
            "Durée journée": format_hour_decimal(duration),
            "Avance": format_hour_decimal(balance) if balance > 0 else "—",
            "Retard": format_hour_decimal(abs(balance)) if balance < 0 else "—",
            "Solde cumulé": format_signed_duration(cumulative_balance),
            "Heures semaine": format_hour_decimal(cumulative),
        })
    return pd.DataFrame(rows)


def work_week_summary(df_entries, settings, ref_date=None):
    ref_date = ref_date or today_paris()
    monday, sunday = week_bounds(ref_date)
    if df_entries.empty:
        return None, None, None
    frame = df_entries[
        (df_entries["entry_date"] >= monday) & (df_entries["entry_date"] <= sunday)
    ].copy()
    if frame.empty:
        return None, None, None
    duration = pd.to_numeric(
        frame.get("work_duration_hours", frame.get("work_hours")), errors="coerce"
    )
    if "work_hours" in frame.columns:
        duration = duration.fillna(pd.to_numeric(frame["work_hours"], errors="coerce"))
    total = float(duration.dropna().sum()) if not duration.dropna().empty else None
    target = setting_float(settings, "work_weekly_target_hours", 35) or 35
    return total, target, None if total is None else total - target


def work_balance_through_date(df_entries, ref_date=None):
    """Solde cumulé jusqu'à la date, en ignorant les journées incomplètes."""
    ref_date = ref_date or today_paris()
    if df_entries is None or df_entries.empty or "entry_date" not in df_entries.columns:
        return 0.0
    frame = df_entries.copy()
    entry_dates = pd.to_datetime(frame["entry_date"], errors="coerce").dt.date
    frame = frame[entry_dates.notna() & (entry_dates <= ref_date)]
    return work_balance_before_day(frame)
