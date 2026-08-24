import json
import logging
import time

import pandas as pd
import streamlit as st

from app_clock import timestamp_paris
from app_config import CHECKIN_DATA_STEP_COUNT, CHECKIN_VERSION
from data_store import (
    clear_nutrition_analysis, delete_goal_log, delete_goal_logs_for_date,
    get_conn, load_entry, save_api_usage, save_entry, save_goal_log,
    save_nutrition_analysis, save_social_logs_for_date, save_sport_sessions,
)
from nutrition_analysis import (
    NUTRITION_MODEL, NutritionAnalysisUnavailable, analyze_meals,
    has_meal_content, has_sport_content, nutrition_source_hash,
)
from performance_monitor import measure_performance, record_performance
from work_tracking import compute_work_duration, parse_optional_time


LOGGER = logging.getLogger(__name__)


def has_daily_data(data):
    fields = [
        "alcohol_glasses", "sleep_hours", "nap_minutes", "work_hours", "work_duration_hours", "weight_kg", "waist_cm", "belly_cm",
        "body_fat_pct", "sport_hours", "phone_hours", "kcal", "sport_kcal_burned",
        "proteins_g", "carbs_g", "fats_g", "meal_breakfast", "meal_lunch", "meal_dinner", "meal_other",
        "me_time_writing_minutes", "me_time_meditation_minutes", "me_time_relaxation_minutes",
        "me_time_outings_minutes",
        "self_listening_score", "close_relations_listening_score",
    ]
    if any(data.get(field) is not None for field in fields):
        return True
    work_text_fields = ["work_travel", "work_start_time", "work_morning_end_time", "work_afternoon_start_time", "work_end_time", "work_third_start_time", "work_third_end_time"]
    if any(str(data.get(field, "") or "").strip() for field in work_text_fields):
        return True
    return False


@measure_performance("Sauvegarde · étape complète")
def save_checkin_bundle(selected_date, draft, existing):
    """Adapte le parcours mobile au schéma historique sans perdre de colonnes."""
    # Un fragment Streamlit peut conserver une copie antérieure de la journée entre
    # deux interactions. La base reste la référence afin qu'une nouvelle étape ne
    # puisse jamais effacer une mesure déjà écrite par une sauvegarde précédente.
    persisted_entry = load_entry(selected_date)
    old = persisted_entry if persisted_entry is not None else (existing or {})
    completed = draft.get("_completed", set())
    skipped = draft.get("_skipped", set()) | (set(range(CHECKIN_DATA_STEP_COUNT)) - set(completed))
    saving_step = draft.get("_saving_step")
    saving_skipped = bool(draft.get("_saving_skipped", False))
    deleting_step = draft.get("_deleting_step")
    progress_completed = {int(step) for step in draft.get("_completed", set())}
    progress_skipped = {int(step) for step in draft.get("_skipped", set())}

    def keep(key):
        value = old.get(key)
        return None if pd.isna(value) else value

    def answer(step, key):
        if step == deleting_step:
            return None
        if step == saving_step:
            return draft.get(key)
        return keep(key) if step in skipped else draft.get(key)

    format_errors = []
    start = parse_optional_time(answer(5, "work_start_time") or "", "Heure de début", format_errors)
    morning_end = parse_optional_time(answer(5, "work_morning_end_time") or "", "Fin de matinée", format_errors)
    afternoon_start = parse_optional_time(answer(5, "work_afternoon_start_time") or "", "Reprise", format_errors)
    end = parse_optional_time(answer(5, "work_end_time") or "", "Heure de fin", format_errors)
    third_start = parse_optional_time(answer(5, "work_third_start_time") or "", "DÃ©but du crÃ©neau 3", format_errors)
    third_end = parse_optional_time(answer(5, "work_third_end_time") or "", "Fin du crÃ©neau 3", format_errors)
    if format_errors:
        return " ".join(format_errors)
    # Un horaire isolé est une donnée valide : il est sauvegardé immédiatement.
    # La durée reste absente jusqu'à ce qu'une plage calculable soit disponible.
    duration_errors = []
    duration = compute_work_duration(start, morning_end, afternoon_start, end, duration_errors, third_start, third_end)

    if deleting_step != 5 and not any([start, morning_end, afternoon_start, end, third_start, third_end]) and existing:
        duration = keep("work_duration_hours") or keep("work_hours")

    alcohol = answer(1, "alcohol_glasses")
    sleep = answer(0, "sleep_hours")
    sport_hours = None if deleting_step == 6 else (
        keep("sport_hours") if 6 in skipped else float(draft["sport_minutes"]) / 60
    )
    phone = answer(7, "phone_hours")
    meals = {
        "petit_dejeuner": answer(8, "meal_breakfast") or "",
        "dejeuner": answer(8, "meal_lunch") or "",
        "diner": answer(8, "meal_dinner") or "",
        "autres": answer(8, "meal_other") or "",
    }
    sport_sessions_payload = [
        {
            "sport_type": str(session.get("sport_type") or ""),
            "duration_minutes": int(session.get("duration_minutes") or 0),
            "distance_km": session.get("distance_km"),
        }
        for session in draft.get("sport_sessions", [])
        if session.get("sport_type") and int(session.get("duration_minutes") or 0) > 0
    ]
    current_weight = answer(2, "weight_kg")
    if current_weight is None and deleting_step != 2:
        current_weight = keep("weight_kg")
    current_body_fat = answer(3, "body_fat_pct")
    if current_body_fat is None and deleting_step != 3:
        current_body_fat = keep("body_fat_pct")
    current_belly = answer(4, "belly_cm")
    if current_belly is None and deleting_step != 4:
        current_belly = keep("belly_cm")
    current_nutrition_hash = nutrition_source_hash(meals, sport_sessions_payload, current_weight)
    previous_nutrition_hash = keep("nutrition_analysis_hash")
    nutrition_source_changed = bool(previous_nutrition_hash and previous_nutrition_hash != current_nutrition_hash)

    data = {
        "entry_date": selected_date.isoformat(),
        "alcohol_glasses": None if alcohol is None else int(alcohol),
        "sleep_hours": None if sleep is None else float(sleep),
        "sleep_bedtime": answer(0, "sleep_bedtime"),
        "sleep_wake_time": answer(0, "sleep_wake_time"),
        "nap_minutes": answer(0, "nap_minutes"),
        "work_hours": duration,
        "work_travel": answer(5, "work_travel") or None,
        "work_start_time": start,
        "work_morning_end_time": morning_end,
        "work_afternoon_start_time": afternoon_start,
        "work_end_time": end,
        "work_third_start_time": third_start,
        "work_third_end_time": third_end,
        "work_duration_hours": duration,
        "weight_kg": current_weight,
        "waist_cm": current_belly,
        "belly_cm": current_belly,
        "body_fat_pct": current_body_fat,
        "sport_type": answer(6, "sport_type"),
        "sport_hours": sport_hours,
        "phone_hours": None if phone is None else float(phone),
        "kcal": keep("kcal"),
        "sport_kcal_burned": keep("sport_kcal_burned"),
        "proteins_g": keep("proteins_g"),
        "carbs_g": keep("carbs_g"),
        "fats_g": keep("fats_g"),
        "meal_breakfast": answer(8, "meal_breakfast"),
        "meal_lunch": answer(8, "meal_lunch"),
        "meal_dinner": answer(8, "meal_dinner"),
        "meal_other": answer(8, "meal_other"),
        "me_time_writing_minutes": answer(9, "me_time_writing_minutes"),
        "me_time_meditation_minutes": answer(9, "me_time_meditation_minutes"),
        "me_time_relaxation_minutes": answer(9, "me_time_relaxation_minutes"),
        "me_time_outings_minutes": answer(9, "me_time_outings_minutes"),
        "self_listening_score": answer(10, "self_listening_score"),
        "close_relations_listening_score": answer(10, "close_relations_listening_score"),
        "nutrition_analysis_hash": previous_nutrition_hash,
        "nutrition_analysis_model": keep("nutrition_analysis_model"),
        "nutrition_analysis_confidence": keep("nutrition_analysis_confidence"),
        "nutrition_analysis_assumptions": keep("nutrition_analysis_assumptions"),
        "nutrition_analyzed_at": keep("nutrition_analyzed_at"),
        "checkin_completed_steps": json.dumps(sorted(progress_completed)),
        "checkin_skipped_steps": json.dumps(sorted(progress_skipped)),
        "checkin_finished": 1 if set(range(CHECKIN_DATA_STEP_COUNT)).issubset(progress_completed | progress_skipped) else 0,
        "checkin_version": CHECKIN_VERSION,
    }
    conn = get_conn()
    entry_removed = False
    try:
        save_entry(data, conn=conn)

        if nutrition_source_changed:
            clear_nutrition_analysis(selected_date, conn=conn)
            for key in (
                "kcal", "sport_kcal_burned", "proteins_g", "carbs_g", "fats_g",
                "nutrition_analysis_hash", "nutrition_analysis_model",
                "nutrition_analysis_confidence", "nutrition_analysis_assumptions",
                "nutrition_analyzed_at",
            ):
                data[key] = None
            draft["_nutrition_estimate"] = data.copy()

        if deleting_step == 6:
            save_sport_sessions(selected_date, [], conn=conn)
        elif not saving_skipped and (saving_step is None or saving_step == 6) and 6 not in skipped:
            sessions = [
                session for session in draft.get("sport_sessions", [])
                if session.get("sport_type") and int(session.get("duration_minutes") or 0) > 0
            ]
            save_sport_sessions(selected_date, sessions, conn=conn)

        if deleting_step == 12:
            delete_goal_logs_for_date(selected_date, conn=conn)
        elif not saving_skipped and (saving_step is None or saving_step == 12) and 12 not in skipped:
            for goal_id, worked in draft.get("goals", {}).items():
                if worked is None:
                    delete_goal_log(selected_date, int(goal_id), conn=conn)
                else:
                    save_goal_log(selected_date, int(goal_id), bool(worked), conn=conn)

        if deleting_step == 11:
            save_social_logs_for_date(selected_date, [], "Vu en personne", None, "", conn=conn)
        elif not saving_skipped and (saving_step is None or saving_step == 11) and 11 not in skipped:
            save_social_logs_for_date(
                selected_date,
                [int(friend_id) for friend_id in draft.get("friend_ids", [])],
                draft.get("social_context", "Vu en personne"),
                draft.get("social_duration"),
                draft.get("social_note", ""),
                conn=conn,
            )
        if (
            deleting_step is not None
            and not progress_completed
            and not progress_skipped
            and not has_daily_data(data)
        ):
            conn.execute(
                "DELETE FROM daily_entries WHERE entry_date = ?",
                (selected_date.isoformat(),),
            )
            entry_removed = True
        conn.commit()
    except Exception:
        conn.rollback()
        LOGGER.exception("Échec de sauvegarde de la journée %s", selected_date)
        return "La sauvegarde Neon a échoué. Réessaie dans quelques instants."
    finally:
        conn.close()

    analysis_requested = bool(draft.pop("_request_nutrition_analysis", False))
    if analysis_requested:
        notice_key = f"nutrition_analysis_notice_{selected_date.isoformat()}"
        if not has_meal_content(meals) and not has_sport_content(sport_sessions_payload):
            st.session_state[notice_key] = ("info", "Aucun repas ni aucune séance sportive à analyser pour cette journée.")
        else:
            analysis_started = time.perf_counter()
            try:
                estimate, api_usage = analyze_meals(meals, sport_sessions_payload, current_weight)
                save_nutrition_analysis(
                    selected_date,
                    estimate,
                    current_nutrition_hash,
                    NUTRITION_MODEL,
                )
                save_api_usage(selected_date, NUTRITION_MODEL, api_usage)
                data.update({
                    "kcal": int(estimate.kcal),
                    "sport_kcal_burned": int(estimate.sport_kcal_burned),
                    "proteins_g": float(estimate.proteins_g),
                    "carbs_g": float(estimate.carbs_g),
                    "fats_g": float(estimate.fats_g),
                    "nutrition_analysis_hash": current_nutrition_hash,
                    "nutrition_analysis_model": NUTRITION_MODEL,
                    "nutrition_analysis_confidence": estimate.confidence,
                    "nutrition_analysis_assumptions": json.dumps(estimate.assumptions, ensure_ascii=False),
                    "nutrition_analyzed_at": timestamp_paris(),
                })
                draft["_nutrition_estimate"] = data.copy()
                st.session_state[notice_key] = (
                    "success",
                    f"Estimation calculée : {estimate.kcal} kcal ingérées · "
                    f"{estimate.sport_kcal_burned} kcal sport · "
                    f"P {estimate.proteins_g:.0f} g · G {estimate.carbs_g:.0f} g · L {estimate.fats_g:.0f} g.",
                )
            except NutritionAnalysisUnavailable as exc:
                st.session_state[notice_key] = ("warning", str(exc))
            except Exception:
                LOGGER.exception("Erreur nutritionnelle inattendue")
                st.session_state[notice_key] = (
                    "warning",
                    "Les repas sont enregistrés, mais une erreur inattendue a interrompu l’analyse. Consulte les logs Streamlit.",
                )
            finally:
                record_performance(
                    "API · analyse nutritionnelle",
                    (time.perf_counter() - analysis_started) * 1000,
                )

    context_key = f"checkin_context_{selected_date.isoformat()}"
    if context_key in st.session_state:
        st.session_state[context_key]["existing"] = None if entry_removed else data.copy()
    return None
