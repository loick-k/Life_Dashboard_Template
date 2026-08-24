import json
import time

import pandas as pd
import streamlit as st


WORK_TIME_FIELDS = (
    "work_start_time",
    "work_morning_end_time",
    "work_afternoon_start_time",
    "work_end_time",
    "work_third_start_time",
    "work_third_end_time",
)


def _clean_work_time(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def _sync_work_schedule_from_entry(
    draft: dict, entry: dict | None, widget_keys: dict[str, str]
) -> None:
    """Réaligne le brouillon et les widgets sur la dernière valeur confirmée en base."""
    if not entry:
        return
    for field in WORK_TIME_FIELDS:
        value = _clean_work_time(entry.get(field))
        draft[field] = value
        st.session_state[widget_keys[field]] = value
    travel = _clean_work_time(entry.get("work_travel"))
    if travel:
        draft["work_travel"] = travel


def _persist_work_time_change(
    save_daily_bundle,
    load_entry,
    selected_date,
    draft_key: str,
    existing,
    widget_keys: dict[str, str],
    changed_field: str,
) -> None:
    """Sauvegarde un horaire sans laisser les widgets obsolètes effacer les autres."""
    latest = load_entry(selected_date) or existing or {}
    draft = st.session_state[draft_key]
    for field in WORK_TIME_FIELDS:
        draft[field] = _clean_work_time(latest.get(field))
    changed_value = _clean_work_time(st.session_state.get(widget_keys[changed_field], ""))
    draft[changed_field] = changed_value
    draft["work_travel"] = str(
        st.session_state.get(f"work_mode_{selected_date}", draft.get("work_travel") or "Bureau")
    )
    draft.setdefault("_skipped", set()).discard(5)
    draft["_saving_step"] = 5
    draft["_saving_skipped"] = False
    error_key = f"work_save_error_{selected_date}"
    save_error = None
    persisted = None
    for attempt in range(2):
        try:
            save_error = save_daily_bundle(selected_date, draft, latest)
            persisted = load_entry(selected_date) if save_error is None else None
            if persisted is not None:
                expected = changed_value or None
                actual = _clean_work_time(persisted.get(changed_field)) or None
                if actual == expected:
                    save_error = None
                    break
                save_error = "L’horaire n’a pas été confirmé par Neon."
        except Exception:
            save_error = "La vérification Neon de l’horaire a échoué."
        if attempt == 0:
            time.sleep(0.15)
    draft.pop("_saving_step", None)
    draft.pop("_saving_skipped", None)
    st.session_state[error_key] = save_error
    if save_error is None and persisted is not None:
        _sync_work_schedule_from_entry(draft, persisted, widget_keys)
        payload = {
            "work_travel": draft.get("work_travel"),
            **{field: draft.get(field, "") for field in WORK_TIME_FIELDS},
        }
        st.session_state[f"checkin_autosave_payload_{selected_date}_5"] = json.dumps(
            payload, sort_keys=True, ensure_ascii=False, default=str
        )
        st.session_state.last_autosave = selected_date.isoformat()


def _apply_work_schedule(draft_key: str, widget_keys: dict, schedule: dict) -> None:
    draft = st.session_state[draft_key]
    for field, value in schedule.items():
        clean_value = str(value or "")
        draft[field] = clean_value
        st.session_state[widget_keys[field]] = clean_value
