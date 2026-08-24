import json
import time
from datetime import date

import pandas as pd
import streamlit as st

from checkin.state import _clean


def _use_last_measurement(draft_key: str, field: str, widget_key: str, value: float) -> None:
    numeric_value = float(value)
    st.session_state[draft_key][field] = numeric_value
    st.session_state[widget_key] = f"{numeric_value:g}".replace(".", ",")


def _persist_measurement_change(
    save_daily_bundle,
    load_entry,
    selected_date,
    draft_key: str,
    existing,
    step: int,
    field: str,
    widget_key: str,
    label: str,
    minimum: float,
    maximum: float,
) -> None:
    """Enregistre une mesure dès la validation du champ, avant tout rerun/navigation."""
    value, validation_error = _parse_measurement(
        st.session_state.get(widget_key, ""), label, minimum, maximum
    )
    error_key = f"measurement_save_error_{selected_date}_{step}"
    if validation_error or value is None:
        st.session_state[error_key] = validation_error
        return

    draft = st.session_state[draft_key]
    draft[field] = value
    draft.setdefault("_skipped", set()).discard(step)
    draft.setdefault("_completed", set()).add(step)
    draft["_saving_step"] = step
    draft["_saving_skipped"] = False
    save_error = None
    for attempt in range(2):
        try:
            save_error = save_daily_bundle(selected_date, draft, existing)
            if save_error is None:
                persisted = load_entry(selected_date) or {}
                persisted_value = persisted.get(field)
                if persisted_value is not None and abs(float(persisted_value) - value) < 0.0001:
                    break
                save_error = f"{label} : la valeur n’a pas été confirmée par Neon."
        except Exception:
            save_error = f"{label} : la vérification Neon a échoué."
        if attempt == 0:
            time.sleep(0.15)
    draft.pop("_saving_step", None)
    draft.pop("_saving_skipped", None)

    st.session_state[error_key] = save_error
    if save_error is None:
        st.session_state[f"measurement_saved_value_{selected_date}_{step}"] = value
        payload = json.dumps({field: value}, sort_keys=True, ensure_ascii=False)
        st.session_state[f"checkin_autosave_payload_{selected_date}_{step}"] = payload
        st.session_state.last_autosave = selected_date.isoformat()


def flush_pending_body_measurements(save_daily_bundle, load_entry) -> str | None:
    """Persiste les champs corporels avant un changement d'écran ou de date."""
    active_date = st.session_state.get("active_checkin_date")
    if not active_date:
        return None
    selected_date = date.fromisoformat(str(active_date))
    draft_key = f"checkin_draft_{selected_date.isoformat()}"
    draft = st.session_state.get(draft_key)
    if not draft:
        return None

    fields = [
        (2, "weight_kg", f"body_weight_{selected_date}", "Poids", 30, 250),
        (3, "body_fat_pct", f"body_fat_{selected_date}", "Masse graisseuse", 1, 70),
        (4, "belly_cm", f"body_belly_{selected_date}", "Tour de ventre", 40, 200),
    ]
    changed_steps = []
    for step, field, widget_key, label, minimum, maximum in fields:
        if widget_key not in st.session_state:
            continue
        value, error = _parse_measurement(
            st.session_state.get(widget_key, ""), label, minimum, maximum
        )
        if error or value is None:
            continue
        current = draft.get(field)
        if current is None or abs(float(current) - value) > 0.0001:
            draft[field] = value
            draft.setdefault("_completed", set()).add(step)
            draft.setdefault("_skipped", set()).discard(step)
            changed_steps.append((step, field, value))

    if not changed_steps:
        return None
    draft["_saving_step"] = changed_steps[0][0]
    try:
        error = save_daily_bundle(selected_date, draft, load_entry(selected_date))
    finally:
        draft.pop("_saving_step", None)
    if error:
        return error

    persisted = load_entry(selected_date) or {}
    for step, field, value in changed_steps:
        persisted_value = persisted.get(field)
        if persisted_value is None or abs(float(persisted_value) - value) > 0.0001:
            return f"{field} : la sauvegarde n’a pas été confirmée par Neon."
        st.session_state[f"measurement_saved_value_{selected_date}_{step}"] = value
    return None

def _french_number(value: float, decimals: int = 1) -> str:
    return f"{float(value):.{decimals}f}".replace(".", ",")

def _measurement_text(value) -> str:
    return "" if value is None else f"{float(value):g}".replace(".", ",")

def _sync_body_measurements_from_entry(draft: dict, entry: dict | None, selected_date: date) -> None:
    """Aligne brouillon et widgets avec Neon lorsqu'aucune mesure n'est en cours d'édition."""
    if not entry:
        return
    fields = {
        2: ("weight_kg", f"body_weight_{selected_date}"),
        3: ("body_fat_pct", f"body_fat_{selected_date}"),
        4: ("belly_cm", f"body_belly_{selected_date}"),
    }
    completed = draft.setdefault("_completed", set())
    skipped = draft.setdefault("_skipped", set())
    for step, (field, widget_key) in fields.items():
        value = _clean(entry.get(field))
        draft[field] = value
        st.session_state[widget_key] = _measurement_text(value)
        if value is not None:
            completed.add(step)
            skipped.discard(step)

def _parse_measurement(raw: str, label: str, minimum: float, maximum: float) -> tuple[float | None, str | None]:
    text = str(raw or "").strip().replace(" ", "").replace(",", ".")
    if not text:
        return None, None
    try:
        value = float(text)
    except ValueError:
        return None, f"{label} : saisis un nombre, par exemple 78,4."
    if not minimum <= value <= maximum:
        return None, f"{label} : la valeur doit être comprise entre {minimum:g} et {maximum:g}."
    return value, None
