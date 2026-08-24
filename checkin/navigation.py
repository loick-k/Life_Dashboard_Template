import json
from datetime import date

import streamlit as st

from app_config import CHECKIN_DATA_STEP_COUNT, CHECKIN_STEPS as STEPS, CHECKIN_SUMMARY_STEP


def _go(step: int) -> None:
    st.session_state.checkin_step = max(0, min(step, len(STEPS) - 1))
    st.session_state.checkin_show_home = False
    try:
        st.rerun(scope="fragment")
    except Exception:
        st.rerun()


def _open_checkin_home_step(step: int) -> None:
    st.session_state.checkin_step = int(step)
    st.session_state.checkin_show_home = False


def _resume_checkin(step: int) -> None:
    st.session_state.checkin_step = int(step)
    st.session_state.checkin_show_home = False


def _save_and_go(save_daily_bundle, selected_date, draft, existing, step: int, next_step: int, skipped: bool = False) -> None:
    if skipped:
        draft.setdefault("_skipped", set()).add(step)
        draft.setdefault("_completed", set()).discard(step)
    else:
        draft.setdefault("_skipped", set()).discard(step)
        draft.setdefault("_completed", set()).add(step)
    draft["_saving_step"] = step
    draft["_saving_skipped"] = skipped
    try:
        error = save_daily_bundle(selected_date, draft, existing)
    finally:
        draft.pop("_saving_step", None)
        draft.pop("_saving_skipped", None)
    if error:
        st.error(error)
        return
    st.session_state.last_autosave = selected_date.isoformat()
    if st.session_state.pop("checkin_edit_mode", False):
        next_step = CHECKIN_SUMMARY_STEP
    _go(next_step)


def _autosave_step(
    save_daily_bundle, selected_date, draft, existing, step: int, payload,
    save_initial: bool = False, mark_completed: bool = True,
) -> str | None:
    """Enregistre une étape dès que ses widgets changent, sans modifier la navigation."""
    state_key = f"checkin_autosave_payload_{selected_date}_{step}"
    serialized = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    previous = st.session_state.get(state_key)
    if previous is None and not save_initial:
        st.session_state[state_key] = serialized
        return None
    if previous == serialized:
        return None

    draft.setdefault("_skipped", set()).discard(step)
    if mark_completed:
        draft.setdefault("_completed", set()).add(step)
    else:
        draft.setdefault("_completed", set()).discard(step)
    draft["_saving_step"] = step
    draft["_saving_skipped"] = False
    try:
        error = save_daily_bundle(selected_date, draft, existing)
    finally:
        draft.pop("_saving_step", None)
        draft.pop("_saving_skipped", None)
    if error:
        st.error(error)
        return error
    st.session_state[state_key] = serialized
    return None


def _reset_step_draft(draft: dict, step: int) -> None:
    defaults = {
        0: {"sleep_hours": 7.5, "sleep_bedtime": "23:00", "sleep_wake_time": "06:30", "nap_minutes": 0},
        1: {"alcohol_glasses": 0},
        2: {"weight_kg": None},
        3: {"body_fat_pct": None},
        4: {"belly_cm": None},
        5: {
            "work_travel": "Non", "work_start_time": "", "work_morning_end_time": "",
            "work_afternoon_start_time": "", "work_end_time": "",
            "work_third_start_time": "", "work_third_end_time": "",
        },
        6: {"sport_type": None, "sport_minutes": 0, "sport_sessions": []},
        7: {"phone_hours": 0},
        8: {"meal_breakfast": "", "meal_lunch": "", "meal_dinner": "", "meal_other": ""},
        9: {
            "me_time_writing_minutes": 0,
            "me_time_meditation_minutes": 0,
            "me_time_relaxation_minutes": 0,
            "me_time_outings_minutes": 0,
        },
        10: {"self_listening_score": None, "close_relations_listening_score": None},
        11: {"friend_ids": []},
        12: {"goals": {}},
    }
    draft.update(defaults.get(step, {}))
    if step == 8:
        draft.pop("_nutrition_estimate", None)


def _delete_step_response(save_daily_bundle, selected_date, draft, existing, step: int) -> None:
    draft.setdefault("_completed", set()).discard(step)
    draft.setdefault("_skipped", set()).discard(step)
    _reset_step_draft(draft, step)
    draft["_saving_step"] = step
    draft["_deleting_step"] = step
    try:
        error = save_daily_bundle(selected_date, draft, existing)
    finally:
        draft.pop("_saving_step", None)
        draft.pop("_deleting_step", None)
    if error:
        st.error(error)
        return
    st.session_state.last_autosave = selected_date.isoformat()
    st.session_state.checkin_show_home = True
    st.session_state.checkin_step = step
    st.rerun()


def _render_delete_action(save_daily_bundle, selected_date, draft, existing, step: int) -> None:
    with st.expander("🗑️ Supprimer la donnée enregistrée"):
        st.caption(
            "Seule la réponse de cette étape sera supprimée. "
            "Les autres indicateurs de la journée seront conservés."
        )
        confirmation_key = f"confirm_delete_step_{selected_date}_{step}"
        confirmed = st.checkbox("Je confirme la suppression", key=confirmation_key)
        if st.button(
            "Supprimer cette donnée",
            key=f"delete_step_{selected_date}_{step}",
            type="secondary",
            use_container_width=True,
            disabled=not confirmed,
        ):
            _delete_step_response(save_daily_bundle, selected_date, draft, existing, step)


def _edit_step(step: int) -> None:
    st.session_state.checkin_edit_mode = True
    st.session_state.checkin_step = int(step)
    st.session_state.checkin_show_home = False


def _open_dashboard() -> None:
    st.session_state.main_navigation = "Courbes"


def _progress_header(step: int, existing: dict | None) -> None:
    status = " · Journée déjà renseignée" if existing else ""
    st.progress(
        (step + 1) / len(STEPS),
        text=f"Étape {step + 1}/{len(STEPS)}{status}",
    )


def _render_checkin_home(selected_date: date, title_col, draft: dict) -> None:
    with title_col:
        st.markdown("<div class='checkin-step-title'>Mon point quotidien</div>", unsafe_allow_html=True)

    completed = draft.get("_completed", set())
    skipped = draft.get("_skipped", set())
    accounted_for = completed | skipped
    answered_count = len(set(range(CHECKIN_DATA_STEP_COUNT)) & accounted_for)
    is_finished = answered_count == CHECKIN_DATA_STEP_COUNT
    resume_step = CHECKIN_SUMMARY_STEP if is_finished else next(
        (step for step in range(CHECKIN_DATA_STEP_COUNT) if step not in accounted_for),
        0,
    )

    st.markdown("### Ta saisie du jour")
    if is_finished:
        primary_label = "✅ Voir le récapitulatif"
    elif answered_count:
        st.caption(f"{answered_count}/{CHECKIN_DATA_STEP_COUNT} indicateurs traités · reprends là où tu t’es arrêté.")
        primary_label = "▶️ Reprendre mon point quotidien"
    else:
        st.caption("Avance étape par étape ou ouvre directement l’indicateur de ton choix.")
        primary_label = "▶️ Commencer mon point quotidien"

    st.button(
        primary_label,
        type="primary",
        use_container_width=True,
        on_click=_resume_checkin,
        args=(resume_step,),
    )
    st.progress(
        answered_count / CHECKIN_DATA_STEP_COUNT,
        text=f"Progression · {answered_count}/{CHECKIN_DATA_STEP_COUNT}",
    )

    st.markdown("#### Accès direct")
    for row_start in range(0, CHECKIN_DATA_STEP_COUNT, 3):
        columns = st.columns(3)
        for offset, column in enumerate(columns):
            step_index = row_start + offset
            if step_index >= CHECKIN_DATA_STEP_COUNT:
                continue
            title, icon = STEPS[step_index]
            status = " ✓" if step_index in completed else " ·" if step_index in skipped else ""
            column.button(
                f"{icon} {title}{status}",
                key=f"home_step_{selected_date}_{step_index}",
                use_container_width=True,
                on_click=_open_checkin_home_step,
                args=(step_index,),
            )


def _nav(step: int, next_label: str = "Continuer", allow_skip: bool = True) -> tuple[bool, bool, bool]:
    st.markdown("<span class='checkin-nav-marker'></span>", unsafe_allow_html=True)
    back_col, skip_col, next_col = st.columns([1, 1, 1.25])
    back = back_col.form_submit_button("← Retour", use_container_width=True, disabled=step == 0)
    skip = skip_col.form_submit_button("Passer", use_container_width=True, disabled=not allow_skip)
    following = next_col.form_submit_button(f"{next_label} →", type="primary", use_container_width=True)
    return back, skip, following


def _nav_without_form(step: int, next_label: str = "Continuer") -> tuple[bool, bool, bool]:
    """Navigation pour les étapes dont les widgets vivent hors d'un formulaire Streamlit."""
    st.markdown("<span class='checkin-nav-marker'></span>", unsafe_allow_html=True)
    back_col, skip_col, next_col = st.columns([1, 1, 1.25])
    back = back_col.button("← Retour", use_container_width=True, disabled=step == 0, key=f"back_{step}")
    skip = skip_col.button("Passer", use_container_width=True, key=f"skip_{step}")
    following = next_col.button(
        f"{next_label} →", type="primary", use_container_width=True, key=f"continue_{step}"
    )
    return back, skip, following
