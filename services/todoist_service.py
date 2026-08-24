import json
import os
from datetime import date, datetime, time, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import streamlit as st


API_BASE_URL = "https://api.todoist.com/api/v1"


class TodoistError(RuntimeError):
    """Erreur présentable à l'utilisateur sans révéler le jeton Todoist."""


def get_todoist_token() -> str:
    token = os.getenv("TODOIST_API_TOKEN", "").strip()
    if token:
        return token
    try:
        return str(st.secrets.get("TODOIST_API_TOKEN", "")).strip()
    except (FileNotFoundError, KeyError):
        return ""


def is_todoist_configured() -> bool:
    return bool(get_todoist_token())


def _request(method: str, path: str, *, params=None, payload=None):
    token = get_todoist_token()
    if not token:
        raise TodoistError("Le jeton Todoist n'est pas configuré.")

    url = f"{API_BASE_URL}{path}"
    if params:
        url = f"{url}?{urlencode(params)}"
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=8) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except HTTPError as exc:
        if exc.code == 401:
            message = "Jeton Todoist invalide ou révoqué."
        elif exc.code == 429:
            message = "Todoist reçoit trop de requêtes. Réessaie dans quelques instants."
        else:
            message = f"Todoist a refusé la requête (erreur {exc.code})."
        raise TodoistError(message) from exc
    except (URLError, TimeoutError) as exc:
        raise TodoistError("Todoist est momentanément inaccessible.") from exc


def _load_all(path: str) -> list[dict]:
    results = []
    cursor = None
    while True:
        params = {"limit": 200}
        if cursor:
            params["cursor"] = cursor
        page = _request("GET", path, params=params) or {}
        results.extend(page.get("results", []))
        cursor = page.get("next_cursor")
        if not cursor:
            return results


def load_tasks() -> list[dict]:
    return _load_all("/tasks")


def load_projects() -> list[dict]:
    return _load_all("/projects")


@st.cache_data(ttl=300, show_spinner=False)
def load_completed_tasks(since: date, until: date) -> list[dict]:
    """Charge les tâches terminées par tranches compatibles avec la limite Todoist."""
    if until <= since:
        return []
    completed = []
    chunk_start = since
    while chunk_start < until:
        chunk_end = min(chunk_start + timedelta(days=89), until)
        cursor = None
        while True:
            params = {
                "since": datetime.combine(chunk_start, time.min, timezone.utc).isoformat().replace("+00:00", "Z"),
                "until": datetime.combine(chunk_end, time.min, timezone.utc).isoformat().replace("+00:00", "Z"),
                "limit": 200,
            }
            if cursor:
                params["cursor"] = cursor
            page = _request("GET", "/tasks/completed/by_completion_date", params=params) or {}
            completed.extend(page.get("items", []))
            cursor = page.get("next_cursor")
            if not cursor:
                break
        chunk_start = chunk_end
    return completed


def create_project(name: str) -> dict:
    return _request("POST", "/projects", payload={"name": name.strip(), "view_style": "list"}) or {}


def create_task(content: str, due_date=None, project_id=None, priority: int = 1) -> dict:
    payload = {"content": content.strip(), "priority": int(priority)}
    if due_date is not None:
        payload["due_date"] = due_date.isoformat() if hasattr(due_date, "isoformat") else str(due_date)
    if project_id:
        payload["project_id"] = str(project_id)
    return _request("POST", "/tasks", payload=payload) or {}


def close_task(task_id: str) -> None:
    _request("POST", f"/tasks/{task_id}/close")
    load_completed_tasks.clear()


def delete_task(task_id: str) -> None:
    _request("DELETE", f"/tasks/{task_id}")
