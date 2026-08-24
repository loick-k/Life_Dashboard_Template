from datetime import datetime

import streamlit as st

from app_clock import today_paris
from services.todoist_service import (
    TodoistError,
    close_task,
    create_project,
    create_task,
    delete_task,
    is_todoist_configured,
    load_projects,
    load_tasks,
)


PRIORITIES = {"Normale": 1, "Moyenne": 2, "Haute": 3, "Urgente": 4}
LOCAL_PRIORITIES = {"Basse": 1, "Normale": 1, "Haute": 3}


@st.cache_data(ttl=30, show_spinner=False)
def _load_todoist_snapshot():
    return load_projects(), load_tasks()


def _due_label(task: dict) -> str:
    due = task.get("due") or {}
    value = due.get("date")
    if not value:
        return "Sans échéance"
    due_date = datetime.fromisoformat(value).date()
    today = today_paris()
    if due_date == today:
        return "Aujourd’hui"
    if due_date < today:
        return f"En retard · {due_date.strftime('%d/%m/%Y')}"
    return due_date.strftime("%d/%m/%Y")


def _migrate_local_tasks(local_items, projects, mark_migrated):
    project_by_name = {
        str(project.get("name", "")).strip().casefold(): str(project["id"])
        for project in projects
    }
    migrated = 0
    failures = []
    for item in local_items.to_dict("records"):
        try:
            raw_category = item.get("category_name")
            category_name = "" if raw_category is None or raw_category != raw_category else str(raw_category).strip()
            project_id = None
            if category_name:
                normalized_name = category_name.casefold()
                project_id = project_by_name.get(normalized_name)
                if not project_id:
                    project = create_project(category_name)
                    project_id = str(project["id"])
                    project_by_name[normalized_name] = project_id

            raw_due_date = item.get("due_date")
            due_date = None if raw_due_date is None or raw_due_date != raw_due_date else raw_due_date
            task = create_task(
                str(item["title"]),
                due_date,
                project_id,
                LOCAL_PRIORITIES.get(str(item.get("priority") or "Normale"), 1),
            )
            external_id = str(task["id"])
            if bool(item.get("completed")):
                close_task(external_id)
            mark_migrated(int(item["id"]), external_id)
            migrated += 1
        except (TodoistError, KeyError, ValueError) as exc:
            failures.append(f"{item.get('title', 'Tâche sans titre')} : {exc}")
    return migrated, failures


@st.fragment
def render_todoist_view(load_local_items=None, mark_migrated=None):
    st.header("✅ Ma Todo list")

    if not is_todoist_configured():
        st.info(
            "Ajoute le secret `TODOIST_API_TOKEN` dans Streamlit Cloud pour activer Todoist."
        )
        st.link_button(
            "Ouvrir les réglages Todoist",
            "https://app.todoist.com/app/settings/integrations/developer",
            use_container_width=True,
        )
        return

    try:
        projects, tasks = _load_todoist_snapshot()
    except TodoistError as exc:
        st.error(str(exc))
        return

    if st.button("↻ Actualiser", key="todoist_refresh"):
        _load_todoist_snapshot.clear()
        st.rerun()

    project_names = {str(project["id"]): str(project["name"]) for project in projects}
    project_options = [None, *project_names]

    if load_local_items is not None and mark_migrated is not None:
        local_items = load_local_items()
        if not local_items.empty:
            with st.expander(f"Importer les tâches de la Todo intégrée ({len(local_items)})"):
                active_count = int((local_items["completed"] == 0).sum())
                completed_count = int((local_items["completed"] != 0).sum())
                st.write(f"{active_count} tâche(s) active(s) · {completed_count} terminée(s)")
                st.caption("Les étiquettes deviendront des projets Todoist. Les données Neon ne seront pas supprimées.")
                confirmed = st.checkbox(
                    "Je confirme la migration vers Todoist",
                    key="todoist_migration_confirmed",
                )
                if st.button(
                    "Importer maintenant",
                    type="primary",
                    disabled=not confirmed,
                    use_container_width=True,
                    key="todoist_migrate",
                ):
                    with st.spinner("Migration vers Todoist…"):
                        migrated, failures = _migrate_local_tasks(local_items, projects, mark_migrated)
                    _load_todoist_snapshot.clear()
                    if migrated:
                        st.success(f"{migrated} tâche(s) importée(s) dans Todoist.")
                    if failures:
                        st.error(f"{len(failures)} tâche(s) n’ont pas pu être importées.")
                        with st.expander("Voir les erreurs"):
                            for failure in failures:
                                st.write(f"- {failure}")
                    if not failures:
                        st.rerun()

    with st.expander("＋ Nouvelle tâche", expanded=False):
        with st.form("todoist_quick_add", clear_on_submit=True):
            title = st.text_input("Tâche")
            due_col, priority_col = st.columns(2)
            with due_col:
                due_date = st.date_input("Échéance", value=None, format="DD/MM/YYYY")
            with priority_col:
                priority_label = st.selectbox("Priorité", list(PRIORITIES))
            project_id = st.selectbox(
                "Projet",
                project_options,
                format_func=lambda value: "Boîte de réception" if value is None else project_names[value],
            )
            submitted = st.form_submit_button("＋ Ajouter", type="primary", use_container_width=True)
        if submitted:
            if not title.strip():
                st.warning("Saisis d’abord une tâche.")
            else:
                try:
                    create_task(title, due_date, project_id, PRIORITIES[priority_label])
                    _load_todoist_snapshot.clear()
                    st.toast("Tâche ajoutée dans Todoist")
                    st.rerun()
                except TodoistError as exc:
                    st.error(str(exc))

    filter_options = ["Tous les projets", *project_names.values()]
    project_filter = st.selectbox("Projet", filter_options, key="todoist_project_filter")
    if project_filter != "Tous les projets":
        tasks = [task for task in tasks if project_names.get(str(task.get("project_id"))) == project_filter]

    st.metric("À faire", len(tasks))
    if not tasks:
        st.info("Aucune tâche active dans cette vue.")

    for task in tasks:
        task_id = str(task["id"])
        with st.container(border=True):
            check_col, delete_col = st.columns([6, 1])
            completed = check_col.checkbox(str(task["content"]), key=f"todoist_done_{task_id}")
            if delete_col.button("🗑️", key=f"todoist_delete_{task_id}", help="Supprimer la tâche"):
                try:
                    delete_task(task_id)
                    _load_todoist_snapshot.clear()
                    st.rerun()
                except TodoistError as exc:
                    st.error(str(exc))
            project_name = project_names.get(str(task.get("project_id")), "Boîte de réception")
            st.caption(f"{_due_label(task)} · {project_name}")
            if completed:
                try:
                    close_task(task_id)
                    _load_todoist_snapshot.clear()
                    st.toast("Tâche terminée")
                    st.rerun()
                except TodoistError as exc:
                    st.error(str(exc))

    st.link_button("Ouvrir Todoist", "https://app.todoist.com/", use_container_width=True)
