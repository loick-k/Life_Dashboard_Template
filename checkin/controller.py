from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta

import pandas as pd
import streamlit as st

from app_config import (
    CHECKIN_DATA_STEP_COUNT,
    CHECKIN_STEPS as STEPS,
    CHECKIN_SUMMARY_STEP,
    CHECKIN_VERSION,
    SPORT_TYPES,
)
from app_clock import today_paris
from french_calendar import default_work_mode, french_holiday_name
from checkin.steps.body import (_use_last_measurement, _french_number, _measurement_text, _sync_body_measurements_from_entry, _parse_measurement, _persist_measurement_change)
from checkin.steps.sport import (_add_sport_session, _remove_sport_session, _persist_sport_duration_change, _persist_sport_widget_change, _parse_sport_value, _format_duration)
from checkin.steps.sleep import (_parse_clock, _bedtime_options, _sleep_duration, _sleep_gauge)
from checkin.steps.nutrition import (_number_or_none, _render_energy_kpis, _render_nutrition_estimate, _show_nutrition_notice)
from checkin.steps.work import (_apply_work_schedule)
from checkin.steps.social import (_create_friend_for_refresh)
from checkin.steps.wellbeing import sync_me_time_widgets
from work_tracking import (
    compute_work_duration,
    format_hour_decimal,
    format_signed_duration,
    parse_optional_time,
    work_balance_before_day,
    work_day_balance,
)
from checkin.state import (
    _clean, _initial_draft, _migrate_progress_v1, _migrate_progress_v2,
    _migrate_progress_v3, _migrate_progress_v4,
)
from checkin.navigation import (
    _autosave_step, _edit_step, _go, _nav, _nav_without_form,
    _open_dashboard, _progress_header, _render_checkin_home,
    _render_delete_action, _save_and_go,
)



































def _infer_completed_steps(existing, sport_sessions, social_logs, goal_logs) -> set[int]:
    if not existing:
        return set()
    completed = set()
    field_steps = {
        0: ["sleep_hours", "sleep_bedtime", "sleep_wake_time", "nap_minutes"],
        1: ["alcohol_glasses"],
        2: ["weight_kg"],
        3: ["body_fat_pct"],
        4: ["belly_cm", "waist_cm"],
        5: ["work_travel", "work_start_time", "work_end_time", "work_duration_hours"],
        7: ["phone_hours"],
        8: ["meal_breakfast", "meal_lunch", "meal_dinner", "meal_other"],
        9: [
            "me_time_writing_minutes", "me_time_meditation_minutes",
            "me_time_relaxation_minutes", "me_time_outings_minutes",
        ],
        10: ["self_listening_score", "close_relations_listening_score"],
    }
    for step, fields in field_steps.items():
        if any(_clean(existing.get(field)) not in (None, "") for field in fields):
            completed.add(step)
    if not sport_sessions.empty or _clean(existing.get("sport_hours")) is not None:
        completed.add(6)
    if not social_logs.empty:
        completed.add(11)
    if not goal_logs.empty:
        completed.add(12)
    return completed


def _render_nutrition_analysis_button(
    *, selected_date, draft, existing, save_daily_bundle, return_step: int
) -> None:
    estimate_source = draft.get("_nutrition_estimate") or existing or {}
    analysis_label = (
        "↻ Recalculer l’estimation nutritionnelle et sportive"
        if estimate_source.get("kcal") is not None
        else "✨ Calculer l’estimation nutritionnelle et sportive"
    )
    if not st.button(
        analysis_label,
        use_container_width=True,
        type="secondary",
        key=f"nutrition_analysis_{selected_date}_{return_step}",
    ):
        return
    draft["_request_nutrition_analysis"] = True
    draft["_saving_step"] = return_step
    try:
        with st.spinner("Analyse nutritionnelle et sportive en cours…"):
            error = save_daily_bundle(selected_date, draft, existing)
    finally:
        draft.pop("_saving_step", None)
        draft.pop("_request_nutrition_analysis", None)
    if error:
        st.error(error)
    else:
        _go(return_step)








@st.fragment
def render_daily_checkin(
    *,
    today: date,
    load_entry,
    save_daily_bundle,
    load_active_goals,
    load_active_friends,
    load_goal_logs,
    load_social_logs,
    load_sport_sessions,
    create_friend,
    load_checkin_progress,
    load_last_body_measurements,
    load_work_entries_before,
    settings,
    load_checkin_context=None,
) -> None:
    date_col, title_col = st.columns([1, 1.7], vertical_alignment="center")
    with date_col:
        st.markdown("<span class='checkin-header-marker'></span>", unsafe_allow_html=True)
        date_default = {"value": today} if "checkin_date_picker" not in st.session_state else {}
        selected_date = st.date_input(
            "Jour suivi",
            format="DD/MM/YYYY",
            label_visibility="collapsed",
            key="checkin_date_picker",
            **date_default,
        )
    draft_key = f"checkin_draft_{selected_date.isoformat()}"
    context_key = f"checkin_context_{selected_date.isoformat()}"
    date_changed = st.session_state.get("active_checkin_date") != selected_date.isoformat()
    if date_changed or context_key not in st.session_state:
        if load_checkin_context is not None:
            st.session_state[context_key] = load_checkin_context(selected_date)
        else:
            st.session_state[context_key] = {
                "existing": load_entry(selected_date),
                "last_body_measurements": load_last_body_measurements(selected_date),
            }
    existing = st.session_state[context_key]["existing"]
    if date_changed:
        st.session_state.active_checkin_date = selected_date.isoformat()
        st.session_state.checkin_step = 0
        st.session_state.checkin_show_home = True
        st.session_state[draft_key] = _initial_draft(existing)
        if existing is None:
            st.session_state[draft_key]["work_travel"] = default_work_mode(selected_date)
        progress = st.session_state[context_key].get("progress")
        social = st.session_state[context_key].get("social")
        sport_sessions = st.session_state[context_key].get("sport_sessions")
        goal_logs = st.session_state[context_key].get("goal_logs")
        if progress is None and social is None:
            social = load_social_logs(selected_date)
        if progress is None and sport_sessions is None:
            sport_sessions = load_sport_sessions(selected_date)
        if progress is None and goal_logs is None:
            goal_logs = load_goal_logs(selected_date)
        if social is not None and not social.empty:
            st.session_state[draft_key]["friend_ids"] = social["friend_id"].astype(int).tolist()
            for column, key, fallback in [
                ("context", "social_context", "Vu en personne"),
                ("duration_hours", "social_duration", None),
                ("note", "social_note", ""),
            ]:
                values = social[column].dropna()
                st.session_state[draft_key][key] = values.iloc[0] if not values.empty else fallback
        if sport_sessions is not None and not sport_sessions.empty:
            st.session_state[draft_key]["sport_sessions"] = [
                {
                    "sport_type": str(row["sport_type"]),
                    "duration_minutes": int(_clean(row["duration_minutes"], 0)),
                    "distance_km": _clean(row["distance_km"]),
                }
                for _, row in sport_sessions.iterrows()
            ]
        elif sport_sessions is not None and st.session_state[draft_key]["sport_type"]:
            # Compatibilité avec les anciennes journées qui n'avaient pas encore
            # de lignes sport_sessions. Si le détail n'a pas été chargé, on attend
            # le chargement différé au lieu de fabriquer une séance sans distance.
            st.session_state[draft_key]["sport_sessions"] = [{
                "sport_type": st.session_state[draft_key]["sport_type"],
                "duration_minutes": st.session_state[draft_key]["sport_minutes"],
                "distance_km": None,
            }]
        if progress is None:
            completed = _infer_completed_steps(existing, sport_sessions, social, goal_logs)
            skipped = set()
        else:
            completed = progress["completed"]
            skipped = progress["skipped"]
            if progress.get("version", 1) < 2:
                completed, skipped = _migrate_progress_v1(completed, skipped)
            if progress.get("version", 1) < 3:
                completed, skipped = _migrate_progress_v2(completed, skipped)
            if progress.get("version", 1) < 4:
                completed, skipped = _migrate_progress_v3(completed, skipped)
            if progress.get("version", 1) < 5:
                completed, skipped = _migrate_progress_v4(completed, skipped)
            if goal_logs is not None and 12 in completed and goal_logs.empty:
                completed.discard(12)
        st.session_state[draft_key]["_completed"] = completed
        st.session_state[draft_key]["_skipped"] = skipped
        st.session_state[draft_key]["_progress_version"] = CHECKIN_VERSION
        _sync_body_measurements_from_entry(st.session_state[draft_key], existing, selected_date)
        accounted_for = completed | skipped
        st.session_state.checkin_step = (
            CHECKIN_SUMMARY_STEP if set(range(CHECKIN_DATA_STEP_COUNT)).issubset(accounted_for)
            else next(step for step in range(CHECKIN_DATA_STEP_COUNT) if step not in accounted_for)
        )

    draft = st.session_state.setdefault(draft_key, _initial_draft(existing))
    sessions_were_missing = "sport_sessions" not in draft
    completed_were_missing = "_completed" not in draft
    draft_progress_version = int(draft.get("_progress_version", 3))
    # Les brouillons Streamlit peuvent survivre à une mise à jour du code.
    # On complète uniquement les nouvelles clés sans écraser la saisie en cours.
    for key, default_value in _initial_draft(existing).items():
        if key not in draft:
            draft[key] = default_value
    if draft_progress_version < 4:
        draft["_completed"], draft["_skipped"] = _migrate_progress_v3(
            draft.get("_completed", set()),
            draft.get("_skipped", set()),
        )
        draft_progress_version = 4
    if draft_progress_version < 5:
        draft["_completed"], draft["_skipped"] = _migrate_progress_v4(
            draft.get("_completed", set()),
            draft.get("_skipped", set()),
        )
        draft["_progress_version"] = CHECKIN_VERSION
    if sessions_were_missing:
        stored_sessions = load_sport_sessions(selected_date)
        if not stored_sessions.empty:
            draft["sport_sessions"] = [
                {
                    "sport_type": str(row["sport_type"]),
                    "duration_minutes": int(_clean(row["duration_minutes"], 0)),
                    "distance_km": _clean(row["distance_km"]),
                }
                for _, row in stored_sessions.iterrows()
            ]
    step = int(st.session_state.get("checkin_step", 0))
    if completed_were_missing:
        draft["_completed"] = set(range(min(step, CHECKIN_DATA_STEP_COUNT))) - draft.get("_skipped", set())
    if st.session_state.get("checkin_show_home", True):
        if not date_changed:
            latest_entry = load_entry(selected_date)
            if latest_entry is not None:
                st.session_state[context_key]["existing"] = latest_entry
                _sync_body_measurements_from_entry(draft, latest_entry, selected_date)
        _render_checkin_home(selected_date, title_col, draft)
        return

    active_goals = (
        load_active_goals(active_only=True)
        if step in (12, CHECKIN_SUMMARY_STEP)
        else pd.DataFrame()
    )
    friends = (
        load_active_friends(active_only=True)
        if step in (11, CHECKIN_SUMMARY_STEP)
        else pd.DataFrame()
    )

    last_body_measurements = st.session_state[context_key].get("last_body_measurements")
    if step in (2, 3, 4) and last_body_measurements is None:
        last_body_measurements = load_last_body_measurements(selected_date)
        st.session_state[context_key]["last_body_measurements"] = last_body_measurements
    last_body_measurements = last_body_measurements or {}

    sport_sessions = st.session_state[context_key].get("sport_sessions")
    if step in (6, CHECKIN_SUMMARY_STEP) and sport_sessions is None:
        sport_sessions = load_sport_sessions(selected_date)
        st.session_state[context_key]["sport_sessions"] = sport_sessions
        if not sport_sessions.empty and not draft["sport_sessions"]:
            draft["sport_sessions"] = [
                {
                    "sport_type": str(row["sport_type"]),
                    "duration_minutes": int(_clean(row["duration_minutes"], 0)),
                    "distance_km": _clean(row["distance_km"]),
                }
                for _, row in sport_sessions.iterrows()
            ]

    social = st.session_state[context_key].get("social")
    if step in (11, CHECKIN_SUMMARY_STEP) and social is None:
        social = load_social_logs(selected_date)
        st.session_state[context_key]["social"] = social
        if not social.empty and not draft["friend_ids"]:
            draft["friend_ids"] = social["friend_id"].astype(int).tolist()

    goal_logs = st.session_state[context_key].get("goal_logs")
    if step in (12, CHECKIN_SUMMARY_STEP) and goal_logs is None:
        goal_logs = load_goal_logs(selected_date)
        st.session_state[context_key]["goal_logs"] = goal_logs
        if not goal_logs.empty and not draft["goals"]:
            draft["goals"] = {
                int(row["goal_id"]): bool(row["worked"])
                for _, row in goal_logs.iterrows()
            }
    with title_col:
        st.markdown(
            f"<div class='checkin-step-title'>{STEPS[step][1]} {STEPS[step][0]}</div>",
            unsafe_allow_html=True,
        )
    _progress_header(step, existing)
    if step == 0:
        st.markdown("### À quelle heure t’es-tu couché et réveillé ?")
        c1, c2 = st.columns(2)
        bedtime_value = str(draft.get("sleep_bedtime") or "23:00")
        bedtime_options = _bedtime_options(bedtime_value)
        bedtime_text = c1.selectbox(
            "Heure de coucher de la veille",
            bedtime_options,
            index=bedtime_options.index(bedtime_value),
            key=f"sleep_bedtime_select_{selected_date}",
            help="La liste continue après 23:55 avec 00:00, 00:05, etc.",
        )
        bedtime = _parse_clock(bedtime_text, time(23, 0))
        wake_time = c2.time_input("Heure de réveil", _parse_clock(draft["sleep_wake_time"], time(6, 30)), step=300)
        value = _sleep_duration(bedtime, wake_time)
        draft["sleep_hours"] = value
        draft["sleep_bedtime"] = bedtime.strftime("%H:%M")
        draft["sleep_wake_time"] = wake_time.strftime("%H:%M")
        stored_nap = max(0, int(draft.get("nap_minutes", 0) or 0))
        has_nap = st.checkbox(
            "J’ai fait une sieste",
            value=stored_nap > 0,
            key=f"has_nap_{selected_date}",
        )
        if has_nap:
            nap_options = list(range(5, 185, 5))
            if stored_nap > 0 and stored_nap not in nap_options:
                nap_options.append(stored_nap)
                nap_options.sort()
            nap_default = stored_nap if stored_nap > 0 else 30
            nap_minutes = st.selectbox(
                "Durée de la sieste",
                nap_options,
                index=nap_options.index(nap_default),
                format_func=_format_duration,
                key=f"nap_minutes_{selected_date}",
            )
        else:
            nap_minutes = 0
        draft["nap_minutes"] = int(nap_minutes)
        _autosave_step(
            save_daily_bundle, selected_date, draft, existing, step,
            {
                "bedtime": draft["sleep_bedtime"],
                "wake_time": draft["sleep_wake_time"],
                "nap_minutes": draft["nap_minutes"],
            },
        )
        _sleep_gauge(bedtime, wake_time, value)
        if nap_minutes:
            st.markdown(
                f"**Sommeil total avec la sieste : "
                f"{_format_duration(round(value * 60) + int(nap_minutes))}**"
            )
        st.caption("Le passage à minuit est pris en compte automatiquement.")
        with st.form("step_sleep_navigation"):
            st.markdown("<span class='nav-only-form'></span>", unsafe_allow_html=True)
            back, skip, nxt = _nav(step)
        if skip: _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 1, skipped=True)
        if nxt:
            draft.setdefault("_skipped", set()).discard(step)
            draft["sleep_hours"] = value
            draft["sleep_bedtime"] = bedtime.strftime("%H:%M")
            draft["sleep_wake_time"] = wake_time.strftime("%H:%M")
            draft["nap_minutes"] = int(nap_minutes)
            _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 1)

    elif step == 1:
        st.markdown("### Combien de verres as-tu bu ?")
        value = st.number_input(
            "Nombre de verres", 0, 30, int(draft["alcohol_glasses"]), 1,
            key=f"alcohol_glasses_{selected_date}",
        )
        st.caption("Saisis 0 pour confirmer une journée sans alcool.")
        draft["alcohol_glasses"] = value
        _autosave_step(save_daily_bundle, selected_date, draft, existing, step, {"alcohol_glasses": value})
        back, skip, nxt = _nav_without_form(step)
        if skip: _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 2, skipped=True)
        if back or nxt:
            draft.setdefault("_skipped", set()).discard(step)
            draft["alcohol_glasses"] = value
            _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 0 if back else 2)

    elif step == 2:
        st.markdown("### Quel est ton poids pour cette date ?")
        widget_key = f"body_weight_{selected_date}"
        value_default = {"value": _measurement_text(draft["weight_kg"])} if widget_key not in st.session_state else {}
        value_raw = st.text_input(
            "Poids en kg", placeholder="Ex : 78,4 ou 78.4", key=widget_key,
            on_change=_persist_measurement_change,
            args=(save_daily_bundle, load_entry, selected_date, draft_key, existing, step, "weight_kg", widget_key, "Poids", 30, 250),
            **value_default,
        )
        measurement_error = st.session_state.pop(f"measurement_save_error_{selected_date}_{step}", None)
        if measurement_error:
            st.error(measurement_error)
        saved_weight = st.session_state.get(f"measurement_saved_value_{selected_date}_{step}")
        if saved_weight is not None:
            st.caption(f"✓ Poids confirmé dans Neon : {_french_number(saved_weight)} kg")
        st.caption("Le point et la virgule sont acceptés pour les décimales.")
        last_value = last_body_measurements.get("weight_kg")
        info_col, action_col = st.columns([2.2, 1])
        info_col.caption(f"Dernière mesure : {_french_number(last_value)} kg" if last_value is not None else "Aucune mesure précédente")
        action_col.button("Identique", use_container_width=True, disabled=last_value is None, on_click=_use_last_measurement, args=(draft_key, "weight_kg", widget_key, last_value))
        autosave_value, autosave_error = _parse_measurement(value_raw, "Poids", 30, 250)
        if not autosave_error and autosave_value is not None:
            draft["weight_kg"] = autosave_value
            _autosave_step(save_daily_bundle, selected_date, draft, existing, step, {"weight_kg": autosave_value}, save_initial=True)
        back, skip, nxt = _nav_without_form(step)
        if skip: _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 3, skipped=True)
        if back or nxt:
            value, error = _parse_measurement(value_raw, "Poids", 30, 250)
            if error:
                st.error(error)
            else:
                draft.setdefault("_skipped", set()).discard(step)
                draft["weight_kg"] = value
                _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 1 if back else 3)

    elif step == 3:
        st.markdown("### Quel est ton taux de masse graisseuse ?")
        widget_key = f"body_fat_{selected_date}"
        value_default = {"value": _measurement_text(draft["body_fat_pct"])} if widget_key not in st.session_state else {}
        value_raw = st.text_input(
            "Masse graisseuse en %", placeholder="Ex : 18,5 ou 18.5", key=widget_key,
            on_change=_persist_measurement_change,
            args=(save_daily_bundle, load_entry, selected_date, draft_key, existing, step, "body_fat_pct", widget_key, "Masse graisseuse", 1, 70),
            **value_default,
        )
        measurement_error = st.session_state.pop(f"measurement_save_error_{selected_date}_{step}", None)
        if measurement_error:
            st.error(measurement_error)
        st.caption("Le point et la virgule sont acceptés pour les décimales.")
        last_value = last_body_measurements.get("body_fat_pct")
        info_col, action_col = st.columns([2.2, 1])
        info_col.caption(f"Dernière mesure : {_french_number(last_value)} %" if last_value is not None else "Aucune mesure précédente")
        action_col.button("Identique", use_container_width=True, disabled=last_value is None, on_click=_use_last_measurement, args=(draft_key, "body_fat_pct", widget_key, last_value))
        autosave_value, autosave_error = _parse_measurement(value_raw, "Masse graisseuse", 1, 70)
        if not autosave_error and autosave_value is not None:
            draft["body_fat_pct"] = autosave_value
            _autosave_step(save_daily_bundle, selected_date, draft, existing, step, {"body_fat_pct": autosave_value}, save_initial=True)
        back, skip, nxt = _nav_without_form(step)
        if skip: _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 4, skipped=True)
        if back or nxt:
            value, error = _parse_measurement(value_raw, "Masse graisseuse", 1, 70)
            if error:
                st.error(error)
            else:
                draft.setdefault("_skipped", set()).discard(step)
                draft["body_fat_pct"] = value
                _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 2 if back else 4)

    elif step == 4:
        st.markdown("### Quel est ton tour de ventre ?")
        widget_key = f"body_belly_{selected_date}"
        value_default = {"value": _measurement_text(draft["belly_cm"])} if widget_key not in st.session_state else {}
        value_raw = st.text_input(
            "Tour de ventre en cm", placeholder="Ex : 86,5 ou 86.5", key=widget_key,
            on_change=_persist_measurement_change,
            args=(save_daily_bundle, load_entry, selected_date, draft_key, existing, step, "belly_cm", widget_key, "Tour de ventre", 40, 200),
            **value_default,
        )
        measurement_error = st.session_state.pop(f"measurement_save_error_{selected_date}_{step}", None)
        if measurement_error:
            st.error(measurement_error)
        st.caption("Le point et la virgule sont acceptés pour les décimales.")
        last_value = last_body_measurements.get("belly_cm")
        info_col, action_col = st.columns([2.2, 1])
        info_col.caption(f"Dernière mesure : {_french_number(last_value)} cm" if last_value is not None else "Aucune mesure précédente")
        action_col.button("Identique", use_container_width=True, disabled=last_value is None, on_click=_use_last_measurement, args=(draft_key, "belly_cm", widget_key, last_value))
        autosave_value, autosave_error = _parse_measurement(value_raw, "Tour de ventre", 30, 250)
        if not autosave_error and autosave_value is not None:
            draft["belly_cm"] = autosave_value
            _autosave_step(save_daily_bundle, selected_date, draft, existing, step, {"belly_cm": autosave_value}, save_initial=True)
        back, skip, nxt = _nav_without_form(step)
        if skip: _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 5, skipped=True)
        if back or nxt:
            value, error = _parse_measurement(value_raw, "Tour de ventre", 30, 250)
            if error:
                st.error(error)
            else:
                draft.setdefault("_skipped", set()).discard(step)
                draft["belly_cm"] = value
                _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 3 if back else 5)

    elif step == 5:
        st.markdown("### Renseigne ta journée de travail")
        prior_work_key = "work_entries_before"
        if prior_work_key not in st.session_state[context_key]:
            st.session_state[context_key][prior_work_key] = load_work_entries_before(
                selected_date
            )
        opening_work_balance = work_balance_before_day(
            st.session_state[context_key][prior_work_key]
        )
        st.metric(
            "Avance / retard avant cette journée",
            format_signed_duration(opening_work_balance),
        )
        st.caption("Cumul des journées de travail renseignées jusqu’à la veille.")
        travel_options = ["Télétravail", "Day off", "Bureau", "Déplacement"]
        current = draft["work_travel"] if draft["work_travel"] in travel_options else default_work_mode(selected_date)
        travel = st.radio("Type de journée", travel_options, index=travel_options.index(current), horizontal=True, key=f"work_mode_{selected_date}")
        holiday_name = french_holiday_name(selected_date)
        if travel == "Day off":
            reason = "Week-end" if selected_date.weekday() >= 5 else holiday_name
            st.info(f"Journée non travaillée{f' · {reason}' if reason else ''}.")
        if travel != "Day off":
            st.caption("Ajoute jusqu’à trois créneaux pour calculer automatiquement la durée travaillée.")
            widget_keys = {
                "work_start_time": f"work_start_{selected_date}",
                "work_morning_end_time": f"work_morning_end_{selected_date}",
                "work_afternoon_start_time": f"work_afternoon_start_{selected_date}",
                "work_end_time": f"work_end_{selected_date}",
                "work_third_start_time": f"work_third_start_{selected_date}",
                "work_third_end_time": f"work_third_end_{selected_date}",
            }
            previous_entry = load_entry(selected_date - timedelta(days=1))
            previous_schedule = {field: _clean(previous_entry.get(field), "") if previous_entry else "" for field in widget_keys}
            standard_schedule = {
                "work_start_time": settings.get("work_standard_start", "08:30"),
                "work_morning_end_time": settings.get("work_standard_morning_end", "12:30"),
                "work_afternoon_start_time": settings.get("work_standard_afternoon_start", "13:30"),
                "work_end_time": settings.get("work_standard_end", "17:30"),
                "work_third_start_time": "",
                "work_third_end_time": "",
            }
            shortcut1, shortcut2 = st.columns(2)
            shortcut1.button("↩️ Horaires d’hier", use_container_width=True, disabled=not any(previous_schedule.values()), on_click=_apply_work_schedule, args=(draft_key, widget_keys, previous_schedule))
            shortcut2.button("⚡ Horaires standards", use_container_width=True, on_click=_apply_work_schedule, args=(draft_key, widget_keys, standard_schedule))
            def work_value(field):
                return {"value": draft[field]} if widget_keys[field] not in st.session_state else {}
            c1, c2 = st.columns(2)
            start = c1.text_input("1. Heure de début", placeholder="08:30", key=widget_keys["work_start_time"], **work_value("work_start_time"))
            morning_end = c2.text_input("2. Fin de matinée", placeholder="12:30", key=widget_keys["work_morning_end_time"], **work_value("work_morning_end_time"))
            c3, c4 = st.columns(2)
            afternoon_start = c3.text_input("3. Début d’après-midi", placeholder="13:30", key=widget_keys["work_afternoon_start_time"], **work_value("work_afternoon_start_time"))
            end = c4.text_input("4. Fin de journée", placeholder="17:30", key=widget_keys["work_end_time"], **work_value("work_end_time"))
            st.caption("Créneau 3 · facultatif")
            c5, c6 = st.columns(2)
            third_start = c5.text_input("5. Heure de début", placeholder="18:30", key=widget_keys["work_third_start_time"], **work_value("work_third_start_time"))
            third_end = c6.text_input("6. Heure de fin", placeholder="20:00", key=widget_keys["work_third_end_time"], **work_value("work_third_end_time"))
        else:
            start = morning_end = afternoon_start = end = third_start = third_end = ""
        work_payload = {"work_travel": travel, "work_start_time": start.strip(), "work_morning_end_time": morning_end.strip(), "work_afternoon_start_time": afternoon_start.strip(), "work_end_time": end.strip(), "work_third_start_time": third_start.strip(), "work_third_end_time": third_end.strip()}
        draft.update(work_payload)
        completion_errors = []
        completion_times = [
            parse_optional_time(start, "Heure de début", completion_errors),
            parse_optional_time(morning_end, "Fin de matinée", completion_errors),
            parse_optional_time(afternoon_start, "Début d’après-midi", completion_errors),
            parse_optional_time(end, "Fin de journée", completion_errors),
        ]
        completion_third = [
            parse_optional_time(third_start, "Début du créneau 3", completion_errors),
            parse_optional_time(third_end, "Fin du créneau 3", completion_errors),
        ]
        completion_duration = compute_work_duration(*completion_times, [], *completion_third) if not completion_errors else None
        _autosave_step(
            save_daily_bundle,
            selected_date,
            draft,
            existing,
            step,
            work_payload,
            mark_completed=travel == "Day off" or completion_duration is not None,
        )
        if travel == "Day off":
            duration_col, balance_col = st.columns(2)
            duration_col.metric("Temps travaillé", "0h00")
            balance_col.metric(
                "Solde après cette journée",
                format_signed_duration(opening_work_balance),
            )
        else:
            work_errors = []
            parsed_times = [
                parse_optional_time(start, "Heure de début", work_errors),
                parse_optional_time(morning_end, "Fin de matinée", work_errors),
                parse_optional_time(afternoon_start, "Début d’après-midi", work_errors),
                parse_optional_time(end, "Fin de journée", work_errors),
            ]
            parsed_third = [
                parse_optional_time(third_start, "Début du créneau 3", work_errors),
                parse_optional_time(third_end, "Fin du créneau 3", work_errors),
            ]
            duration = compute_work_duration(*parsed_times, work_errors, *parsed_third)
            duration_col, balance_col = st.columns(2)
            duration_col.metric("Temps travaillé", format_hour_decimal(duration))
            closing_work_balance = (
                None if duration is None
                else opening_work_balance + (work_day_balance(duration) or 0.0)
            )
            balance_col.metric(
                "Solde après cette journée",
                "En attente" if closing_work_balance is None
                else format_signed_duration(closing_work_balance),
            )
            st.caption("Référence journalière : 7 h 42 de travail.")
            if work_errors and any((start, morning_end, afternoon_start, end, third_start, third_end)):
                st.caption("Complète les horaires pour calculer le compteur.")
        back, skip, nxt = _nav_without_form(step)
        if skip: _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 6, skipped=True)
        if back or nxt:
            draft.setdefault("_skipped", set()).discard(step)
            draft.update(work_payload)
            _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 4 if back else 6)

    elif step == 6:
        st.markdown("### Tes séances sportives")
        st.caption("Renseigne jusqu’à trois séances. La distance est demandée uniquement pour la course.")
        if not draft["sport_sessions"]:
            st.info("Aucune séance pour cette date.")
        session_values = []
        sport_errors = []
        for index, session in enumerate(draft["sport_sessions"]):
            with st.container(border=True):
                heading_col, remove_col = st.columns([5, 1], vertical_alignment="center")
                heading_col.markdown(f"#### Séance {index + 1}")
                remove_col.button("✕", key=f"remove_sport_{selected_date}_{index}", help="Supprimer cette séance", use_container_width=True, on_click=_remove_sport_session, args=(draft_key, index, selected_date))
                type_key = f"sport_session_{selected_date}_{index}_type"
                duration_hours_key = f"sport_session_{selected_date}_{index}_duration_hours"
                duration_minutes_key = f"sport_session_{selected_date}_{index}_duration_minutes"
                duration_total_key = f"sport_session_{selected_date}_{index}_duration_total"
                distance_key = f"sport_session_{selected_date}_{index}_distance"
                stored_type = session.get("sport_type", "Course")
                current_type = stored_type if stored_type in SPORT_TYPES else "Autre"
                type_default = {"index": SPORT_TYPES.index(current_type)} if type_key not in st.session_state else {}
                sport_type = st.selectbox(
                    "Activité", SPORT_TYPES, key=type_key,
                    on_change=_persist_sport_widget_change,
                    args=(save_daily_bundle, load_sport_sessions, selected_date, draft_key, existing, index, "sport_type", type_key),
                    **type_default,
                )
                stored_duration = int(session.get("duration_minutes") or 0)
                stored_hours, stored_minutes = divmod(stored_duration, 60)
                if duration_hours_key not in st.session_state:
                    st.session_state[duration_hours_key] = stored_hours
                if duration_minutes_key not in st.session_state:
                    st.session_state[duration_minutes_key] = stored_minutes
                duration_col_hours, duration_col_minutes = st.columns(2)
                duration_callback_args = (
                    save_daily_bundle, load_sport_sessions, selected_date, draft_key,
                    existing, index, duration_hours_key, duration_minutes_key,
                    duration_total_key,
                )
                duration_hours = duration_col_hours.number_input(
                    "Heures", min_value=0, max_value=10, step=1,
                    key=duration_hours_key,
                    on_change=_persist_sport_duration_change,
                    args=duration_callback_args,
                )
                duration_minutes = duration_col_minutes.number_input(
                    "Minutes", min_value=0, max_value=59, step=1,
                    key=duration_minutes_key,
                    on_change=_persist_sport_duration_change,
                    args=duration_callback_args,
                )
                duration = int(duration_hours) * 60 + int(duration_minutes)
                distance = None
                if sport_type == "Course":
                    distance_default = {"value": _measurement_text(session.get("distance_km"))} if distance_key not in st.session_state else {}
                    distance_raw = st.text_input(
                        "Distance (km)",
                        placeholder="Ex : 7,2 ou 7.2",
                        key=distance_key,
                        on_change=_persist_sport_widget_change,
                        args=(save_daily_bundle, load_sport_sessions, selected_date, draft_key, existing, index, "distance_km", distance_key),
                        **distance_default,
                    )
                    distance, distance_error = _parse_sport_value(
                        distance_raw, f"Séance {index + 1} · distance", 0, 200
                    )
                    if distance_error:
                        sport_errors.append(distance_error)
                session_values.append({
                    "sport_type": sport_type,
                    "duration_minutes": int(duration or 0),
                    "distance_km": float(distance) if distance else None,
                })
                sport_save_error = st.session_state.pop(
                    f"sport_save_error_{selected_date}_{index}", None
                )
                if sport_save_error:
                    st.error(sport_save_error)

        draft["sport_sessions"] = session_values
        draft["sport_minutes"] = sum(session["duration_minutes"] for session in session_values)
        draft["sport_type"] = ", ".join(
            session["sport_type"] for session in session_values if session["duration_minutes"] > 0
        ) or None
        if not sport_errors:
            _autosave_step(save_daily_bundle, selected_date, draft, existing, step, session_values)
        st.markdown(
            f"<div class='sport-total'><span>Temps de sport total</span><strong>{_format_duration(draft['sport_minutes'])}</strong></div>",
            unsafe_allow_html=True,
        )
        st.button(
            "＋ Ajouter une séance",
            key=f"add_sport_{selected_date}",
            use_container_width=True,
            disabled=len(session_values) >= 3,
            on_click=_add_sport_session,
            args=(draft_key,),
        )
        back, skip, nxt = _nav_without_form(step)
        if skip: _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 7, skipped=True)
        if back or nxt:
            if sport_errors:
                for error in sport_errors:
                    st.error(error)
            else:
                _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 5 if back else 7)

    elif step == 7:
        st.markdown("### Combien de temps as-tu passé sur ton portable ?")
        stored_phone_minutes = max(0, int(round(float(draft["phone_hours"]) * 60)))
        default_phone_hours, default_phone_minutes = divmod(stored_phone_minutes, 60)
        hours_col, minutes_col = st.columns(2)
        phone_hours = hours_col.number_input(
            "Heures", min_value=0, max_value=23, value=min(default_phone_hours, 23), step=1,
            key=f"phone_hours_{selected_date}",
        )
        phone_minutes = minutes_col.number_input(
            "Minutes", min_value=0, max_value=59, value=default_phone_minutes, step=1,
            key=f"phone_minutes_{selected_date}",
        )
        phone_total_minutes = int(phone_hours) * 60 + int(phone_minutes)
        draft["phone_hours"] = phone_total_minutes / 60
        _autosave_step(save_daily_bundle, selected_date, draft, existing, step, {"phone_minutes": phone_total_minutes})
        st.markdown(f"**Durée saisie : {int(phone_hours)}:{int(phone_minutes):02d}**")
        back, skip, nxt = _nav_without_form(step)
        if skip: _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 8, skipped=True)
        if back or nxt:
            draft.setdefault("_skipped", set()).discard(step)
            draft["phone_hours"] = phone_total_minutes / 60
            _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 6 if back else 8)

    elif step == 8:
        st.markdown("### Qu’as-tu mangé aujourd’hui ?")
        st.caption("Décris simplement tes repas. Ces textes pourront être interprétés automatiquement plus tard.")
        breakfast = st.text_area("☕ Repas du matin", value=draft["meal_breakfast"], placeholder="Ex : café, deux tartines, yaourt…", height=90, key=f"meal_breakfast_{selected_date}")
        lunch = st.text_area("🥗 Repas du midi", value=draft["meal_lunch"], placeholder="Ex : poulet, riz, légumes, fruit…", height=90, key=f"meal_lunch_{selected_date}")
        dinner = st.text_area("🍲 Repas du soir", value=draft["meal_dinner"], placeholder="Ex : soupe, omelette, pain…", height=90, key=f"meal_dinner_{selected_date}")
        other_food = st.text_area("🍎 Autres", value=draft["meal_other"], placeholder="Collations, boissons ou autre consommation…", height=90, key=f"meal_other_{selected_date}")
        meal_payload = {
            "meal_breakfast": breakfast.strip(), "meal_lunch": lunch.strip(),
            "meal_dinner": dinner.strip(), "meal_other": other_food.strip(),
        }
        draft.update(meal_payload)
        _autosave_step(save_daily_bundle, selected_date, draft, existing, step, meal_payload)
        _show_nutrition_notice(selected_date)
        _render_nutrition_analysis_button(
            selected_date=selected_date,
            draft=draft,
            existing=existing,
            save_daily_bundle=save_daily_bundle,
            return_step=step,
        )
        st.markdown("#### Bilan énergétique")
        _render_energy_kpis(draft, existing, show_not_calculated=True)
        back, skip, nxt = _nav_without_form(step, "Continuer vers le temps pour moi")
        if skip: _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 9, skipped=True)
        if back or nxt:
            draft.setdefault("_skipped", set()).discard(step)
            draft.update({
                "meal_breakfast": breakfast.strip(),
                "meal_lunch": lunch.strip(),
                "meal_dinner": dinner.strip(),
                "meal_other": other_food.strip(),
            })
            _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 7 if back else 9)

    elif step == 9:
        st.markdown("### Quel temps t’es-tu accordé ?")
        st.caption("Indique séparément le temps consacré à chaque activité.")
        activity_values = {}
        activities = [
            ("me_time_writing_minutes", "✍️ Écriture"),
            ("me_time_meditation_minutes", "🧘 Méditation"),
            ("me_time_relaxation_minutes", "📖 Détente"),
            ("me_time_outings_minutes", "☕ Sorties"),
        ]
        activity_fields = [field for field, _ in activities]
        for field, label in activities:
            stored_minutes = max(0, int(draft.get(field, 0) or 0))
            default_hours, default_minutes = divmod(stored_minutes, 60)
            with st.container(border=True):
                st.markdown(f"#### {label}")
                if field == "me_time_relaxation_minutes":
                    st.caption("Lecture, musique, jeux de société ou autre moment calme.")
                elif field == "me_time_outings_minutes":
                    st.caption("Balades, cafés, bars, restaurants ou autres sorties.")
                hours_col, minutes_col = st.columns(2)
                hours_key = f"{field}_hours_{selected_date}"
                minutes_key = f"{field}_minutes_{selected_date}"
                hours_col.number_input(
                    "Heures", 0, 23, min(default_hours, 23), 1,
                    key=hours_key,
                    on_change=sync_me_time_widgets,
                    args=(draft_key, selected_date, activity_fields),
                )
                minutes_col.number_input(
                    "Minutes", 0, 59, default_minutes, 1,
                    key=minutes_key,
                    on_change=sync_me_time_widgets,
                    args=(draft_key, selected_date, activity_fields),
                )
                activity_values[field] = (
                    int(st.session_state.get(hours_key, 0) or 0) * 60
                    + int(st.session_state.get(minutes_key, 0) or 0)
                )
        total_me_time = sum(activity_values.values())
        st.session_state[f"me_time_total_{selected_date}"] = total_me_time
        draft.update(activity_values)
        _autosave_step(save_daily_bundle, selected_date, draft, existing, step, activity_values)
        st.markdown(
            f"<div class='sport-total'><span>Temps pour moi total</span>"
            f"<strong>{_format_duration(total_me_time)}</strong></div>", unsafe_allow_html=True,
        )
        back, skip, nxt = _nav_without_form(step, "Continuer vers l'écoute")
        if skip: _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 10, skipped=True)
        if back or nxt:
            draft.setdefault("_skipped", set()).discard(step)
            draft.update(activity_values)
            _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 8 if back else 10)

    elif step == 10:
        st.markdown("### Comment as-tu été à l'écoute aujourd'hui ?")
        st.caption("Attribue une note de 1 à 10 pour chaque dimension.")
        self_score = st.slider("Écoute de soi-même", 1, 10, int(draft.get("self_listening_score") or 5), 1, key=f"self_listening_{selected_date}")
        close_relations_label = str(
            settings.get("close_relations_label", "Écoute de mes proches")
            or "Écoute de mes proches"
        )
        family_score = st.slider(close_relations_label, 1, 10, int(draft.get("close_relations_listening_score") or 5), 1, key=f"close_relations_listening_{selected_date}")
        listening_payload = {
            "self_listening_score": int(self_score),
            "close_relations_listening_score": int(family_score),
        }
        draft.update(listening_payload)
        _autosave_step(save_daily_bundle, selected_date, draft, existing, step, listening_payload)
        back, skip, nxt = _nav_without_form(step, "Continuer vers le social")
        if skip: _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 11, skipped=True)
        if back or nxt:
            draft.setdefault("_skipped", set()).discard(step)
            draft.update({
                "self_listening_score": int(self_score),
                "close_relations_listening_score": int(family_score),
            })
            _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 9 if back else 11)

    elif step == 11:
        st.markdown("### Qui as-tu vu aujourd’hui ?")
        st.caption("Sélectionne simplement les personnes rencontrées. Nous suivrons le nombre de personnes vues et la fréquence des rencontres.")
        selection_key = f"social_people_{selected_date}"
        friend_map = (
            {int(friend_id): str(name) for friend_id, name in zip(friends["id"], friends["name"])}
            if not friends.empty
            else {}
        )
        valid_friend_ids = set(friend_map)
        pending_friend_id = st.session_state.pop("pending_social_friend_id", None)
        if pending_friend_id is not None and int(pending_friend_id) in valid_friend_ids:
            pending_friend_id = int(pending_friend_id)
            current_ids = [int(friend_id) for friend_id in draft.get("friend_ids", [])]
            if pending_friend_id not in current_ids:
                current_ids.append(pending_friend_id)
            draft["friend_ids"] = current_ids
            st.session_state[selection_key] = current_ids
        draft["friend_ids"] = [
            int(friend_id)
            for friend_id in draft.get("friend_ids", [])
            if int(friend_id) in valid_friend_ids
        ]
        if selection_key in st.session_state:
            st.session_state[selection_key] = [
                int(friend_id)
                for friend_id in st.session_state.get(selection_key, [])
                if int(friend_id) in valid_friend_ids
            ]
        selection_default = {
            "default": [fid for fid in draft["friend_ids"] if fid in friend_map]
        } if selection_key not in st.session_state else {}
        selected = st.multiselect(
            "Personnes",
            list(friend_map),
            format_func=lambda fid: friend_map[fid],
            key=selection_key,
            **selection_default,
        )
        draft["friend_ids"] = selected
        draft.update({"social_context": "Vu en personne", "social_duration": None})
        _autosave_step(save_daily_bundle, selected_date, draft, existing, step, {"friend_ids": selected})
        if not friend_map:
            st.info("Aucune personne n’est encore enregistrée. Ajoute la première ci-dessous.")

        message = st.session_state.pop("social_friend_message", None)
        if message:
            getattr(st, message[0])(message[1])

        with st.expander("＋ Ajouter une personne"):
            st.caption("La nouvelle personne sera immédiatement ajoutée et sélectionnée.")
            name_key = f"new_social_friend_name_{selected_date}"
            category_key = f"new_social_friend_category_{selected_date}"
            with st.form("add_social_friend", clear_on_submit=False):
                add_col, category_col = st.columns([2, 1])
                add_col.text_input("Nom", placeholder="Prénom ou nom", key=name_key)
                category_col.selectbox(
                    "Catégorie",
                    ["Ami", "Famille", "Collègue", "Association", "Autre"],
                    key=category_key,
                )
                add_friend_submitted = st.form_submit_button(
                    "Ajouter et sélectionner",
                    type="primary",
                    use_container_width=True,
                    on_click=_create_friend_for_refresh,
                    args=(create_friend, name_key, category_key),
                )
            if add_friend_submitted:
                st.rerun(scope="app")

        with st.form("step_social_navigation"):
            st.markdown("<span class='nav-only-form'></span>", unsafe_allow_html=True)
            back, skip, nxt = _nav(step, "Continuer vers les objectifs")
        if skip: _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 12, skipped=True)
        if back or nxt:
            draft.setdefault("_skipped", set()).discard(step)
            draft.update({"friend_ids": selected, "social_context": "Vu en personne", "social_duration": None})
            _save_and_go(save_daily_bundle, selected_date, draft, existing, step, 10 if back else 12)

    elif step == 12:
        st.markdown("### As-tu contribué à tes objectifs ?")
        goal_date = selected_date
        st.caption(f"Suivi du {goal_date.strftime('%d/%m/%Y')}")
        existing_goal_logs = goal_logs if goal_logs is not None else pd.DataFrame()
        existing_goal_map = {
            int(row["goal_id"]): bool(row["worked"])
            for _, row in existing_goal_logs.iterrows()
        } if not existing_goal_logs.empty else {}
        goal_values = {}
        if active_goals.empty:
            st.info("Aucun objectif actif. Configure jusqu’à trois objectifs dans Objectifs & critères.")
        else:
            for _, goal in active_goals.head(3).iterrows():
                goal_id = int(goal["id"])
                current_value = draft["goals"].get(goal_id, existing_goal_map.get(goal_id, False))
                goal_values[goal_id] = st.checkbox(
                    str(goal["title"]), value=bool(current_value),
                    key=f"daily_goal_{selected_date}_{goal_id}",
                )
        draft["goals"] = goal_values
        _autosave_step(save_daily_bundle, selected_date, draft, existing, step, goal_values)
        back, skip, nxt = _nav_without_form(step, "Voir le récapitulatif")
        if skip: _save_and_go(save_daily_bundle, selected_date, draft, existing, step, CHECKIN_SUMMARY_STEP, skipped=True)
        if back or nxt:
            draft.setdefault("_skipped", set()).discard(step)
            draft["goals"] = goal_values
            _save_and_go(
                save_daily_bundle, selected_date, draft, existing, step,
                11 if back else CHECKIN_SUMMARY_STEP,
            )

    else:
        st.markdown("### Ta journée en un coup d’œil")
        skipped = draft.get("_skipped", set())

        def shown(step_number, value):
            return "Étape passée" if step_number in skipped else value

        rows = [
            ("Sommeil", shown(0, f"{draft['sleep_bedtime']} → {draft['sleep_wake_time']}")),
            ("Sieste", shown(0, _format_duration(draft.get("nap_minutes", 0)) if draft.get("nap_minutes") else "Aucune")),
            ("Alcool", shown(1, f"{draft['alcohol_glasses']} verre(s)")),
            ("Poids", shown(2, "Non renseigné" if draft["weight_kg"] is None else f"{draft['weight_kg']:.1f} kg")),
            ("Masse graisseuse", shown(3, "Non renseignée" if draft["body_fat_pct"] is None else f"{draft['body_fat_pct']:.1f} %")),
            ("Tour de ventre", shown(4, "Non renseigné" if draft["belly_cm"] is None else f"{draft['belly_cm']:.1f} cm")),
            ("Travail", shown(5, draft["work_travel"])),
            ("Sport", shown(6, " · ".join(
                f"{session['sport_type']} {_format_duration(session['duration_minutes'])}"
                + (f" ({session['distance_km']:.1f} km)" if session.get("distance_km") else "")
                for session in draft["sport_sessions"] if session["duration_minutes"] > 0
            ) or "Aucune séance")),
            ("Temps de sport total", shown(6, _format_duration(draft["sport_minutes"]))),
            ("Temps de portable", shown(7, _format_duration(round(draft["phone_hours"] * 60)))),
            ("Alimentation", shown(8, " · ".join(
                label for label, value in [
                    ("Matin", draft["meal_breakfast"]),
                    ("Midi", draft["meal_lunch"]),
                    ("Soir", draft["meal_dinner"]),
                    ("Autres", draft["meal_other"]),
                ] if value
            ) or "Non renseignée")),
            ("Écriture", shown(9, _format_duration(draft["me_time_writing_minutes"]))),
            ("Méditation", shown(9, _format_duration(draft["me_time_meditation_minutes"]))),
            ("Détente", shown(9, _format_duration(draft["me_time_relaxation_minutes"]))),
            ("Sorties", shown(9, _format_duration(draft["me_time_outings_minutes"]))),
            ("Écoute de soi-même", shown(10, f"{int(draft['self_listening_score'])}/10" if draft.get("self_listening_score") else "Non renseignée")),
            (str(settings.get("close_relations_label", "Écoute de mes proches") or "Écoute de mes proches"), shown(10, f"{int(draft['close_relations_listening_score'])}/10" if draft.get("close_relations_listening_score") else "Non renseignée")),
            ("Interactions", shown(11, str(len(draft["friend_ids"])))),
            ("Objectifs réalisés", shown(12, f"{sum(bool(value) for value in draft['goals'].values())}/{min(len(active_goals), 3)}")),
        ]
        for label, value in rows:
            st.markdown(f"<div class='summary-row'><span>{label}</span><strong>{value}</strong></div>", unsafe_allow_html=True)
        _show_nutrition_notice(selected_date)
        _render_nutrition_estimate(draft, existing)
        with st.expander("✏️ Modifier une réponse"):
            edit_step = st.selectbox(
                "Indicateur à modifier",
                options=list(range(CHECKIN_DATA_STEP_COUNT)),
                format_func=lambda index: f"{STEPS[index][1]} {STEPS[index][0]}",
                label_visibility="collapsed",
            )
            st.button(
                "Modifier cet indicateur",
                use_container_width=True,
                on_click=_edit_step,
                args=(edit_step,),
            )
        summary_back, summary_charts = st.columns(2)
        summary_back.button(
            "← Retour aux objectifs",
            use_container_width=True,
            on_click=_go,
            args=(12,),
        )
        summary_charts.button(
            "📈 Accéder à mes courbes",
            use_container_width=True,
            on_click=_open_dashboard,
        )

        _render_nutrition_analysis_button(
            selected_date=selected_date,
            draft=draft,
            existing=existing,
            save_daily_bundle=save_daily_bundle,
            return_step=CHECKIN_SUMMARY_STEP,
        )

    if step < CHECKIN_SUMMARY_STEP and step in draft.get("_completed", set()):
        _render_delete_action(save_daily_bundle, selected_date, draft, existing, step)
