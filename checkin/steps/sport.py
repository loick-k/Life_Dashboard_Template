import json
import time
from datetime import date

import streamlit as st

from checkin.steps.body import _parse_measurement


def _add_sport_session(draft_key: str) -> None:
    sessions = st.session_state[draft_key].setdefault("sport_sessions", [])
    if len(sessions) < 3:
        sessions.append({"sport_type": "Course", "duration_minutes": 0, "distance_km": None})

def _remove_sport_session(draft_key: str, index: int, selected_date: date) -> None:
    sessions = st.session_state[draft_key].setdefault("sport_sessions", [])
    if 0 <= index < len(sessions):
        sessions.pop(index)
    prefix = f"sport_session_{selected_date}_"
    for key in list(st.session_state):
        if str(key).startswith(prefix):
            del st.session_state[key]

def _sync_sport_widget(
    draft_key: str, index: int, field: str, widget_key: str, *, integer: bool = False
) -> None:
    """Copie immédiatement la valeur éditée dans le brouillon avant tout changement d'écran."""
    sessions = st.session_state[draft_key].setdefault("sport_sessions", [])
    if not 0 <= index < len(sessions):
        return
    value, error = _parse_sport_value(
        st.session_state.get(widget_key, ""), field, 0, 600 if integer else 200, integer=integer
    )
    if error is None:
        sessions[index][field] = value


def _persist_sport_widget_change(
    save_daily_bundle,
    load_sport_sessions,
    selected_date,
    draft_key: str,
    existing,
    index: int,
    field: str,
    widget_key: str,
) -> None:
    """Sauvegarde et confirme une modification de séance avant la navigation."""
    draft = st.session_state[draft_key]
    sessions = draft.setdefault("sport_sessions", [])
    if not 0 <= index < len(sessions):
        return

    raw_value = st.session_state.get(widget_key)
    if field == "sport_type":
        value, validation_error = str(raw_value or ""), None
    elif field == "duration_minutes":
        value, validation_error = int(raw_value or 0), None
    else:
        value, validation_error = _parse_sport_value(
            raw_value, "Distance", 0, 200
        )
    error_key = f"sport_save_error_{selected_date}_{index}"
    if validation_error:
        st.session_state[error_key] = validation_error
        return

    sessions[index][field] = value
    draft["sport_minutes"] = sum(int(session.get("duration_minutes") or 0) for session in sessions)
    draft["sport_type"] = ", ".join(
        str(session.get("sport_type"))
        for session in sessions
        if int(session.get("duration_minutes") or 0) > 0
    ) or None

    valid_indices = [
        session_index for session_index, session in enumerate(sessions)
        if session.get("sport_type") and int(session.get("duration_minutes") or 0) > 0
    ]
    valid_sessions = [sessions[session_index] for session_index in valid_indices]
    # Une séance sans durée reste seulement un brouillon : elle n'est pas encore
    # une donnée métier enregistrable dans sport_sessions.
    if index not in valid_indices:
        st.session_state[error_key] = None
        return
    persisted_index = valid_indices.index(index)

    draft.setdefault("_skipped", set()).discard(6)
    draft.setdefault("_completed", set()).add(6)
    draft["_saving_step"] = 6
    draft["_saving_skipped"] = False
    save_error = None
    for attempt in range(2):
        try:
            save_error = save_daily_bundle(selected_date, draft, existing)
            persisted = load_sport_sessions(selected_date) if save_error is None else None
            if persisted is not None and len(persisted) > persisted_index:
                row = persisted.iloc[persisted_index]
                expected = sessions[index]
                distance_matches = (
                    expected.get("distance_km") is None
                    or (
                        row.get("distance_km") is not None
                        and abs(float(row["distance_km"]) - float(expected["distance_km"])) < 0.0001
                    )
                )
                if (
                    str(row["sport_type"]) == str(expected["sport_type"])
                    and int(row["duration_minutes"] or 0) == int(expected["duration_minutes"] or 0)
                    and distance_matches
                ):
                    save_error = None
                    break
            if save_error is None:
                save_error = "La séance n’a pas été confirmée par Neon."
        except Exception:
            save_error = "La vérification Neon de la séance a échoué."
        if attempt == 0:
            time.sleep(0.15)
    draft.pop("_saving_step", None)
    draft.pop("_saving_skipped", None)
    st.session_state[error_key] = save_error
    if save_error is None:
        payload = json.dumps(sessions, sort_keys=True, ensure_ascii=False, default=str)
        st.session_state[f"checkin_autosave_payload_{selected_date}_6"] = payload
        st.session_state.last_autosave = selected_date.isoformat()


def _persist_sport_duration_change(
    save_daily_bundle,
    load_sport_sessions,
    selected_date,
    draft_key: str,
    existing,
    index: int,
    hours_key: str,
    minutes_key: str,
    total_key: str,
) -> None:
    """Assemble heures + minutes avant de réutiliser la sauvegarde vérifiée."""
    hours = max(0, int(st.session_state.get(hours_key, 0) or 0))
    minutes = max(0, min(59, int(st.session_state.get(minutes_key, 0) or 0)))
    st.session_state[total_key] = hours * 60 + minutes
    _persist_sport_widget_change(
        save_daily_bundle,
        load_sport_sessions,
        selected_date,
        draft_key,
        existing,
        index,
        "duration_minutes",
        total_key,
    )


def _parse_sport_value(
    raw: str, label: str, minimum: float, maximum: float, *, integer: bool = False
) -> tuple[float | int | None, str | None]:
    value, error = _parse_measurement(raw, label, minimum, maximum)
    if error or value is None:
        return value, error
    if integer and not value.is_integer():
        return None, f"{label} : saisis un nombre entier de minutes."
    return (int(value) if integer else float(value)), None

def _format_duration(minutes: int) -> str:
    hours, remainder = divmod(int(minutes), 60)
    if hours and remainder:
        return f"{hours} h {remainder:02d}"
    if hours:
        return f"{hours} h"
    return f"{remainder} min"
