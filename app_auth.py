import hashlib
import hmac
import os

import streamlit as st


def _configured_secret(name: str) -> str:
    value = os.getenv(name, "").strip()
    if value:
        return value
    try:
        return str(st.secrets.get(name, "") or "").strip()
    except Exception:
        return ""


def _password_matches(candidate: str, password: str, password_hash: str) -> bool:
    if password_hash:
        candidate_hash = hashlib.sha256(candidate.encode("utf-8")).hexdigest()
        return hmac.compare_digest(candidate_hash, password_hash.lower())
    return bool(password) and hmac.compare_digest(candidate, password)


def require_private_data_access(external_database_enabled: bool) -> None:
    """Protège les données personnelles lorsque l'application utilise une base externe."""
    if not external_database_enabled:
        return
    if st.session_state.get("life_dashboard_authenticated", False):
        return

    password = _configured_secret("APP_ACCESS_PASSWORD")
    password_hash = _configured_secret("APP_ACCESS_PASSWORD_SHA256")
    if not password and not password_hash:
        st.error("Accès désactivé : configure APP_ACCESS_PASSWORD dans les Secrets Streamlit.")
        st.caption("Cette sécurité est obligatoire lorsqu’une base de données externe est connectée.")
        st.stop()
    if password and len(password) < 12:
        st.error("Accès désactivé : APP_ACCESS_PASSWORD doit contenir au moins 12 caractères.")
        st.stop()

    st.title("🔒 Accès privé")
    st.caption("Les données de cette instance sont protégées.")
    with st.form("private_data_login"):
        candidate = st.text_input("Mot de passe", type="password", autocomplete="current-password")
        submitted = st.form_submit_button("Se connecter", type="primary", use_container_width=True)
    if submitted:
        if _password_matches(candidate, password, password_hash):
            st.session_state.life_dashboard_authenticated = True
            st.rerun()
        else:
            st.error("Mot de passe incorrect.")
    st.stop()


def logout_private_data_access() -> None:
    st.session_state.life_dashboard_authenticated = False
