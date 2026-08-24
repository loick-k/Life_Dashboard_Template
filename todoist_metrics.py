import pandas as pd
import streamlit as st
from datetime import timedelta

from app_clock import PARIS_TIMEZONE, today_paris
from dashboard_charts import plot_daily_bar


def completed_tasks_frame(tasks: list[dict]) -> pd.DataFrame:
    rows = []
    for task in tasks:
        completed_at = pd.to_datetime(task.get("completed_at"), errors="coerce", utc=True)
        if pd.isna(completed_at):
            continue
        rows.append(
            {
                "entry_date": completed_at.tz_convert(PARIS_TIMEZONE).date(),
                "completed_tasks": 1,
                "project_id": str(task.get("project_id") or ""),
                "priority": int(task.get("priority") or 1),
            }
        )
    return pd.DataFrame(rows, columns=["entry_date", "completed_tasks", "project_id", "priority"])


def render_todoist_metrics(completed_df: pd.DataFrame, granularity: str, error: str | None = None):
    st.divider()
    st.markdown("### Productivité Todoist")
    if error:
        st.warning(error)

    total = int(completed_df["completed_tasks"].sum()) if not completed_df.empty else 0
    active_days = int(completed_df["entry_date"].nunique()) if not completed_df.empty else 0
    average = total / active_days if active_days else 0
    today = today_paris()
    week_start = today - timedelta(days=today.weekday())
    this_week = (
        int(completed_df.loc[completed_df["entry_date"] >= week_start, "completed_tasks"].sum())
        if not completed_df.empty else 0
    )

    k1, k2, k3, k4 = st.columns(4)
    k1.metric("Terminées sur la période", total)
    k2.metric("Cette semaine", this_week)
    k3.metric("Jours actifs", active_days)
    k4.metric("Moyenne / jour actif", f"{average:.1f}")
    plot_daily_bar(
        completed_df,
        "completed_tasks",
        "Tâches terminées",
        "tâches",
        "#dc4c3e",
        granularity=granularity,
        aggregation="sum",
    )
