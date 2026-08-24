import streamlit as st


def _create_friend_for_refresh(create_friend, name_key: str, category_key: str) -> None:
    name = str(st.session_state.get(name_key, "")).strip()
    if not name:
        st.session_state.social_friend_message = ("error", "Indique un nom avant de valider.")
        return
    friend_id = create_friend(name, st.session_state.get(category_key, "Ami"))
    if friend_id is None:
        st.session_state.social_friend_message = ("error", "Cette personne n’a pas pu être ajoutée.")
        return
    st.session_state.pending_social_friend_id = int(friend_id)
    st.session_state[name_key] = ""
    st.session_state.social_friend_message = ("success", f"{name} a été ajouté et sélectionné.")

