import streamlit as st


def _apply_work_schedule(draft_key: str, widget_keys: dict, schedule: dict) -> None:
    draft = st.session_state[draft_key]
    for field, value in schedule.items():
        clean_value = str(value or "")
        draft[field] = clean_value
        st.session_state[widget_keys[field]] = clean_value

