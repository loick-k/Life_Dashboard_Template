import hashlib
import hmac
import math
import os
import time

import streamlit as st


MAX_FAILED_ATTEMPTS = 5
LOCKOUT_SECONDS = 5 * 60
MAX_RETRY_DELAY_SECONDS = 30
OIDC_REQUIRED_KEYS = ("redirect_uri", "cookie_secret", "client_id", "client_secret", "server_metadata_url")


def _configured_secret(name: str) -> str:
    value = os.getenv(name, "").strip()
    if value:
        return value
    try:
        return str(st.secrets.get(name, "") or "").strip()
    except Exception:
        return ""


def _parse_allowed_emails(raw_value) -> set[str]:
    if isinstance(raw_value, str):
        values = raw_value.split(",")
    elif isinstance(raw_value, (list, tuple, set)):
        values = raw_value
    else:
        values = []
    return {str(value).strip().lower() for value in values if str(value).strip()}


def _allowed_google_emails() -> set[str]:
    environment_value = os.getenv("APP_ALLOWED_EMAILS", "").strip()
    if environment_value:
        return _parse_allowed_emails(environment_value)
    try:
        return _parse_allowed_emails(st.secrets.get("APP_ALLOWED_EMAILS", []))
    except Exception:
        return set()


def _google_oidc_is_configured() -> bool:
    try:
        auth = st.secrets.get("auth", {})
        return all(str(auth.get(key, "") or "").strip() for key in OIDC_REQUIRED_KEYS)
    except Exception:
        return False


def _password_matches(candidate: str, password: str, password_hash: str) -> bool:
    if password_hash:
        candidate_hash = hashlib.sha256(candidate.encode("utf-8")).hexdigest()
        return hmac.compare_digest(candidate_hash, password_hash.lower())
    return bool(password) and hmac.compare_digest(candidate, password)


def _retry_delay_seconds(failed_attempts: int) -> int:
    """Retourne un délai exponentiel court avant la tentative suivante."""
    if failed_attempts <= 0:
        return 0
    return min(2 ** (failed_attempts - 1), MAX_RETRY_DELAY_SECONDS)


def _remaining_wait_seconds(now: float) -> int:
    retry_at = float(st.session_state.get("life_dashboard_auth_retry_at", 0.0) or 0.0)
    locked_until = float(st.session_state.get("life_dashboard_auth_locked_until", 0.0) or 0.0)
    return max(0, math.ceil(max(retry_at, locked_until) - now))


def _reset_auth_failures() -> None:
    st.session_state.pop("life_dashboard_auth_failed_attempts", None)
    st.session_state.pop("life_dashboard_auth_retry_at", None)
    st.session_state.pop("life_dashboard_auth_locked_until", None)


def require_private_data_access(external_database_enabled: bool) -> None:
    """Protège systématiquement l'accès à l'instance personnelle."""
    del external_database_enabled  # Conservé dans la signature pour compatibilité.
    if _google_oidc_is_configured():
        if not st.user.is_logged_in:
            st.title("🔒 Accès privé")
            st.caption("Connecte-toi avec le compte Google autorisé pour accéder à tes données.")
            if st.button("Continuer avec Google", type="primary", use_container_width=True):
                st.login()
            st.stop()

        allowed_emails = _allowed_google_emails()
        current_email = str(getattr(st.user, "email", "") or "").strip().lower()
        if not allowed_emails:
            st.error("Accès désactivé : configure APP_ALLOWED_EMAILS dans les Secrets Streamlit.")
            if st.button("Se déconnecter", use_container_width=True):
                st.logout()
            st.stop()
        if current_email not in allowed_emails:
            st.error("Ce compte Google n’est pas autorisé à accéder à cette application.")
            if st.button("Utiliser un autre compte Google", use_container_width=True):
                st.logout()
            st.stop()
        return

    password = _configured_secret("APP_ACCESS_PASSWORD")
    password_hash = _configured_secret("APP_ACCESS_PASSWORD_SHA256")
    if st.session_state.get("life_dashboard_authenticated", False):
        return

    if not password and not password_hash:
        st.error("Accès désactivé : configure APP_ACCESS_PASSWORD dans les Secrets Streamlit.")
        st.caption("Cette sécurité est obligatoire lorsqu’une base de données externe est connectée.")
        st.stop()
    if password and len(password) < 12:
        st.error("Accès désactivé : APP_ACCESS_PASSWORD doit contenir au moins 12 caractères.")
        st.stop()

    now = time.monotonic()
    remaining_wait = _remaining_wait_seconds(now)
    locked_until = float(st.session_state.get("life_dashboard_auth_locked_until", 0.0) or 0.0)
    if remaining_wait:
        if locked_until > now:
            st.error(f"Trop de tentatives incorrectes. Réessaie dans {remaining_wait} seconde(s).")
        else:
            st.warning(f"Mot de passe incorrect. Nouvelle tentative possible dans {remaining_wait} seconde(s).")
        st.stop()

    st.title("🔒 Accès privé")
    st.caption("Les données de cette instance sont protégées.")
    with st.form("private_data_login"):
        candidate = st.text_input("Mot de passe", type="password", autocomplete="current-password")
        submitted = st.form_submit_button("Se connecter", type="primary", use_container_width=True)
    if submitted:
        if _password_matches(candidate, password, password_hash):
            _reset_auth_failures()
            st.session_state.life_dashboard_authenticated = True
            st.rerun()
        else:
            failed_attempts = int(st.session_state.get("life_dashboard_auth_failed_attempts", 0) or 0) + 1
            st.session_state.life_dashboard_auth_failed_attempts = failed_attempts
            if failed_attempts >= MAX_FAILED_ATTEMPTS:
                st.session_state.life_dashboard_auth_locked_until = now + LOCKOUT_SECONDS
                st.error("Trop de tentatives incorrectes. Accès temporairement bloqué pendant 5 minutes.")
            else:
                delay = _retry_delay_seconds(failed_attempts)
                st.session_state.life_dashboard_auth_retry_at = now + delay
                remaining_attempts = MAX_FAILED_ATTEMPTS - failed_attempts
                st.error(
                    f"Mot de passe incorrect. Attends {delay} seconde(s) avant de réessayer "
                    f"({remaining_attempts} tentative(s) restante(s))."
                )
    st.stop()


def logout_private_data_access() -> None:
    _reset_auth_failures()
    if _google_oidc_is_configured() and st.user.is_logged_in:
        st.logout()
        return
    st.session_state.life_dashboard_authenticated = False
