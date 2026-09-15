"""Adaptateur V1 : seul ce module traduit les résultats métier en état Streamlit."""

import logging
import time

import streamlit as st

from performance_monitor import record_performance
from services.checkin_service import save_checkin_bundle as save_checkin_core
from services.nutrition_service import run_nutrition_analysis


LOGGER = logging.getLogger(__name__)


def _secret(name: str, default=""):
    try:
        return st.secrets.get(name, default)
    except Exception:
        return default


def save_checkin_bundle(selected_date, draft, existing):
    analysis_requested = bool(draft.pop("_request_nutrition_analysis", False))
    error = save_checkin_core(selected_date, draft, existing)
    if error:
        return error

    if analysis_requested:
        started = time.perf_counter()
        notice_key = f"nutrition_analysis_notice_{selected_date.isoformat()}"
        meals = {
            "petit_dejeuner": draft.get("meal_breakfast", ""),
            "dejeuner": draft.get("meal_lunch", ""),
            "diner": draft.get("meal_dinner", ""),
            "autres": draft.get("meal_other", ""),
        }
        sessions = [session for session in draft.get("sport_sessions", []) if int(session.get("duration_minutes") or 0) > 0]
        try:
            result = run_nutrition_analysis(
                selected_date, meals, sessions, draft.get("weight_kg"),
                api_key=str(_secret("OPENAI_API_KEY", "")),
                usd_to_eur=float(_secret("OPENAI_USD_TO_EUR", 0.92)),
            )
            st.session_state[notice_key] = (result.level, result.message)
            if result.values:
                saved = dict(draft.get("_last_saved_entry") or {})
                saved.update(result.values)
                draft["_nutrition_estimate"] = saved
                draft["_last_saved_entry"] = saved
        except Exception:
            LOGGER.exception("Erreur nutritionnelle inattendue")
            st.session_state[notice_key] = ("warning", "Les repas sont enregistrés, mais l’analyse a échoué. Consulte les logs Streamlit.")
        finally:
            record_performance("API · analyse nutritionnelle", (time.perf_counter() - started) * 1000)

    context_key = f"checkin_context_{selected_date.isoformat()}"
    if context_key in st.session_state:
        st.session_state[context_key]["existing"] = draft.pop("_last_saved_entry", None)
    else:
        draft.pop("_last_saved_entry", None)
    return None
