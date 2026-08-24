import streamlit as st


def sync_me_time_widgets(draft_key: str, selected_date, fields) -> None:
    """Synchronise immédiatement les durées et leur total après une interaction."""
    draft = st.session_state[draft_key]
    total = 0
    for field in fields:
        hours = int(st.session_state.get(f"{field}_hours_{selected_date}", 0) or 0)
        minutes = int(st.session_state.get(f"{field}_minutes_{selected_date}", 0) or 0)
        value = hours * 60 + minutes
        draft[field] = value
        total += value
    st.session_state[f"me_time_total_{selected_date}"] = total
