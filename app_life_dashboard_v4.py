
import json
import logging
import time
from datetime import date, timedelta

import pandas as pd
import streamlit as st
from daily_checkin import render_daily_checkin
from app_config import (
    APP_TITLE,
    CHECKIN_DATA_STEP_COUNT,
    CHECKIN_SUMMARY_STEP,
    CHECKIN_VERSION,
)
from app_clock import timestamp_paris, today_paris
from app_auth import logout_private_data_access, require_private_data_access
from data_store import (
    clear_nutrition_analysis,
    complete_goal,
    create_friend,
    create_goal,
    delete_goal_log,
    delete_goal_logs_for_date,
    get_conn,
    init_db,
    load_checkin_context,
    load_checkin_progress,
    load_api_usage_logs,
    load_entries,
    load_work_entries_before,
    load_entry,
    load_friends,
    load_goal_logs,
    load_goal_logs_all,
    load_goals,
    load_last_body_measurements,
    load_settings,
    load_social_logs,
    load_sport_sessions,
    load_unmigrated_todo_items,
    reactivate_goal,
    save_api_usage,
    save_entry,
    save_goal_log,
    save_nutrition_analysis,
    save_setting,
    save_social_logs_for_date,
    save_sport_sessions,
    mark_todo_item_migrated,
    update_friend_active,
    USE_POSTGRES,
)
from nutrition_analysis import (
    NUTRITION_MODEL,
    NutritionAnalysisUnavailable,
    analyze_meals,
    has_meal_content,
    has_sport_content,
    nutrition_source_hash,
)
from dashboard_metrics import (
    fmt_metric,
    global_form_assessment,
    label_global_score,
    latest_value,
    no_alcohol_streak,
    safe_mean,
    safe_sum,
    setting_float,
    setting_date,
    week_bounds,
    zero_if_none
)

from performance_monitor import APP_RUN_STARTED, measure_performance, performance_summary, record_performance
from work_tracking import (
    compute_work_duration,
    format_hour_decimal,
    format_signed_duration,
    parse_optional_time,
    work_balance_through_date,
    work_week_summary,
    work_week_table,
)
from work_report import build_work_report
from todoist_view import render_todoist_view
from todoist_metrics import completed_tasks_frame, render_todoist_metrics
from services.todoist_service import TodoistError, load_completed_tasks
from checkin.steps.body import flush_pending_body_measurements

LOGGER = logging.getLogger(__name__)

from services.checkin_service import save_checkin_bundle



# -----------------------------
# Interface
# -----------------------------
st.set_page_config(page_title=APP_TITLE, page_icon="🌱", layout="wide", initial_sidebar_state="collapsed")
require_private_data_access(USE_POSTGRES)
init_db()
settings = load_settings()

st.markdown("""
<style>
    .block-container {padding-top: 4.75rem; padding-bottom: 5rem; max-width: 1100px;}
    .checkin-step-title {font-size:2rem; line-height:1.15; font-weight:750; color:#30313d;}
    .summary-row {display:flex; justify-content:space-between; gap:1rem; padding:.85rem 0; border-bottom:1px solid rgba(128,128,128,.2);}
    .sport-total {display:flex; align-items:center; justify-content:space-between; gap:1rem; margin:.75rem 0; padding:1rem 1.1rem; border-radius:16px; background:rgba(45,140,240,.09);}
    .sport-total strong {font-size:1.3rem; color:#2577c7;}
    .sleep-summary {margin:1.15rem 0 .75rem; padding:1rem 1.1rem; border-radius:18px; background:rgba(128,128,128,.045);}
    .sleep-times {display:flex; align-items:center; gap:.8rem; font-size:1.05rem;}
    .sleep-night-line {height:2px; flex:1; background:linear-gradient(90deg,#64748b,#c4b5fd,#64748b); border-radius:999px;}
    .sleep-duration-label {margin-top:1rem; color:#7c818c; font-size:.88rem;}
    .sleep-duration-value {font-size:1.65rem; line-height:1.2; font-weight:750; color:#30313d; margin:.15rem 0 .8rem;}
    .sleep-gauge {position:relative; height:10px; border-radius:999px; background:#dfe4eb; overflow:visible;}
    .sleep-target-zone {position:absolute; left:50%; width:14.2857%; top:0; bottom:0; background:#4ade80; border-radius:999px;}
    .sleep-marker {position:absolute; top:50%; width:18px; height:18px; transform:translate(-50%,-50%); border:3px solid white; border-radius:50%; background:#2563eb; box-shadow:0 1px 5px rgba(0,0,0,.25);}
    .sleep-scale {display:flex; justify-content:space-between; gap:.5rem; margin-top:.55rem; color:#8a8f99; font-size:.78rem;}
    .sleep-target-label {color:#16a34a; font-weight:650; text-align:center;}
    div[data-testid="stForm"] {border:1px solid rgba(128,128,128,.20); border-radius:22px; padding:1.25rem; background:rgba(128,128,128,.035);}
    div[data-testid="stForm"]:has(.nav-only-form) {border:0; padding:0; background:transparent; min-height:0;}
    div[data-testid="stButton"] button, div[data-testid="stFormSubmitButton"] button {min-height:3rem; border-radius:12px; font-weight:650;}
    @media (max-width: 640px) {
        .block-container {padding:3.75rem .85rem 12.5rem;}
        h1 {font-size:1.7rem !important;}
        h2 {font-size:1.55rem !important;}
        h3 {font-size:1.2rem !important;}
        div[data-testid="stForm"] {padding:1rem .8rem; border-radius:18px;}
        div[data-testid="stHorizontalBlock"] {gap:.6rem;}
        div[data-testid="stHorizontalBlock"]:has(.checkin-header-marker) {
            display:flex !important; flex-direction:row !important; flex-wrap:nowrap !important;
            align-items:center !important; gap:.75rem;
        }
        div[data-testid="stHorizontalBlock"]:has(.checkin-header-marker) > div[data-testid="stColumn"]:first-child {
            width:42% !important; min-width:0 !important; flex:0 0 42% !important;
        }
        div[data-testid="stHorizontalBlock"]:has(.checkin-header-marker) > div[data-testid="stColumn"]:last-child {
            width:58% !important; min-width:0 !important; flex:1 1 58% !important;
        }
        .checkin-step-title {font-size:1.55rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
        div[data-testid="stHorizontalBlock"]:has(.st-key-mobile_nav_today) {
            position:fixed; left:0; right:8.75rem; bottom:0; z-index:1001;
            display:flex !important; flex-direction:row !important; flex-wrap:nowrap !important;
            gap:.3rem; padding:.45rem .5rem calc(.45rem + env(safe-area-inset-bottom));
            background:rgba(255,255,255,.97); border-top:1px solid rgba(128,128,128,.22);
            box-shadow:0 -4px 18px rgba(0,0,0,.08);
        }
        div[data-testid="stForm"]:has(.checkin-nav-marker)
        div[data-testid="stHorizontalBlock"]:has(div[data-testid="stFormSubmitButton"]) {
            position:fixed; left:0; right:0; bottom:calc(4.35rem + env(safe-area-inset-bottom)); z-index:1002;
            display:flex !important; flex-direction:row !important; flex-wrap:nowrap !important;
            gap:.35rem; padding:.55rem .65rem;
            background:rgba(255,255,255,.97); border-top:1px solid rgba(128,128,128,.18);
            box-shadow:0 -3px 14px rgba(0,0,0,.06);
        }
        div[data-testid="stHorizontalBlock"]:has(.st-key-mobile_nav_today) button {
            min-height:2.8rem; font-size:.66rem; padding:.3rem .1rem;
        }
        div[data-testid="stHorizontalBlock"]:has(.st-key-mobile_nav_today) button p {
            white-space:nowrap !important; overflow:hidden; text-overflow:clip;
            line-height:1.05 !important;
            font-size:.68rem !important;
            letter-spacing:-.01em !important;
        }
        div[data-testid="stHorizontalBlock"]:has(.st-key-mobile_nav_today) > div[data-testid="stColumn"] {
            width:25% !important; min-width:0 !important; flex:1 1 0 !important;
        }
        div[data-testid="stForm"]:has(.checkin-nav-marker)
        div[data-testid="stHorizontalBlock"]:has(div[data-testid="stFormSubmitButton"]) > div[data-testid="stColumn"] {
            width:33.333% !important; min-width:0 !important; flex:1 1 0 !important;
        }
    }
</style>
""", unsafe_allow_html=True)

today = today_paris()
tobacco_stop_date = setting_date(settings, "tobacco_stop_date")


def navigate_main(section):
    flush_pending_body_measurements(save_checkin_bundle, load_entry)
    st.session_state.main_navigation = section


def navigate_date(target_date):
    flush_pending_body_measurements(save_checkin_bundle, load_entry)
    st.session_state.main_navigation = "Aujourd'hui"
    st.session_state.checkin_date_picker = target_date
    st.session_state.checkin_step = 0
    st.session_state.checkin_show_home = True


main_section = st.session_state.get("main_navigation", "Aujourd'hui")
if main_section not in ["Aujourd'hui", "Todo", "Courbes", "Réglages"]:
    main_section = "Courbes" if main_section == "Dashboard" else "Aujourd'hui"
    st.session_state.main_navigation = main_section

with st.sidebar:
    st.header("Navigation")
    st.button(
        "📝 Saisie journalière",
        use_container_width=True,
        type="primary" if main_section == "Aujourd'hui" else "secondary",
        on_click=navigate_date,
        args=(today,),
    )
    st.button(
        "✅ Todo",
        use_container_width=True,
        type="primary" if main_section == "Todo" else "secondary",
        on_click=navigate_main,
        args=("Todo",),
    )
    st.button(
        "📊 Bilan",
        use_container_width=True,
        type="primary" if main_section == "Courbes" else "secondary",
        on_click=navigate_main,
        args=("Courbes",),
    )
    st.button(
        "⚙️ Réglages",
        use_container_width=True,
        type="primary" if main_section == "Réglages" else "secondary",
        on_click=navigate_main,
        args=("Réglages",),
    )
    if USE_POSTGRES:
        st.divider()
        st.button(
            "🔒 Se déconnecter",
            use_container_width=True,
            on_click=logout_private_data_access,
        )

quick_date = st.session_state.get("checkin_date_picker", today)
yesterday = today - timedelta(days=1)
if main_section == "Aujourd'hui":
    nav_today, nav_yesterday = st.columns(2)
    nav_today.button(
        "☀️ Aujourd’hui",
        key="mobile_nav_today",
        use_container_width=True,
        type="primary" if main_section == "Aujourd'hui" and quick_date == today else "secondary",
        on_click=navigate_date,
        args=(today,),
    )
    nav_yesterday.button(
        "↩️ Hier",
        key="mobile_nav_yesterday",
        use_container_width=True,
        type="primary" if main_section == "Aujourd'hui" and quick_date == yesterday else "secondary",
        on_click=navigate_date,
        args=(yesterday,),
    )
if main_section == "Réglages":
    selected_tab = st.radio(
        "Rubrique",
        ["Social", "Objectifs & critères", "Données", "Performance"],
        horizontal=True,
        key="settings_navigation",
    )
else:
    selected_tab = "Dashboard" if main_section == "Courbes" else main_section


if selected_tab not in ["Aujourd'hui", "Todo"]:
    st.title("📊 Tableau de bord personnel")
    st.caption("Suivi quotidien : alcool, sommeil, travail, poids, tour de ventre, sport, portable, alimentation, social et objectifs.")


if selected_tab == "Aujourd'hui":
    checkin_render_started = time.perf_counter()
    render_daily_checkin(
        today=today,
        load_entry=load_entry,
        save_daily_bundle=save_checkin_bundle,
        load_active_goals=load_goals,
        load_active_friends=load_friends,
        load_goal_logs=load_goal_logs,
        load_social_logs=load_social_logs,
        load_sport_sessions=load_sport_sessions,
        create_friend=create_friend,
        load_checkin_progress=load_checkin_progress,
        load_last_body_measurements=load_last_body_measurements,
        load_work_entries_before=load_work_entries_before,
        settings=settings,
        load_checkin_context=load_checkin_context,
    )
    record_performance("Interface · parcours quotidien", (time.perf_counter() - checkin_render_started) * 1000)
    record_performance("Interface · cycle complet", (time.perf_counter() - APP_RUN_STARTED) * 1000)
    st.stop()

elif selected_tab == "Todo":
    render_todoist_view(
        load_local_items=load_unmigrated_todo_items,
        mark_migrated=mark_todo_item_migrated,
    )

elif selected_tab == "Dashboard":
    from dashboard_charts import (
        plot_calorie_balance,
        plot_daily_bar,
        plot_line,
        plot_nutrition,
        plot_social_by_week,
        plot_weekly_alcohol,
        plot_workday_calendar,
        social_recurrence_table,
    )

    st.header("Bilan")
    period_label = st.radio(
        "Période affichée",
        options=["7 jours", "1 mois", "1 an", "Depuis le début"],
        index=1,
        key="dashboard_period",
        horizontal=True,
    )
    period_config = {
        "7 jours": (today - timedelta(days=6), "day", 1),
        "1 mois": (today - timedelta(days=29), "day", 5),
        "1 an": (today - timedelta(days=364), "week", 53),
        "Depuis le début": (None, "month", 104),
    }
    period_start, chart_granularity, calendar_weeks = period_config[period_label]
    alcohol_granularity = "month" if chart_granularity == "month" else "week"
    social_granularity = alcohol_granularity
    if tobacco_stop_date is not None:
        st.metric(
            "🚭 Jours sans tabac",
            f"{max((today - tobacco_stop_date).days, 0)} j",
            help=f"Depuis le {tobacco_stop_date.strftime('%d/%m/%Y')}",
        )

    df_entries = load_entries()
    all_goal_logs = load_goal_logs_all()
    all_social_logs = load_social_logs()
    if period_start is not None:
        if not df_entries.empty:
            df_entries = df_entries[df_entries["entry_date"] >= period_start].copy()
        if not all_goal_logs.empty:
            all_goal_logs = all_goal_logs[all_goal_logs["entry_date"] >= period_start].copy()
        if not all_social_logs.empty:
            all_social_logs = all_social_logs[all_social_logs["entry_date"] >= period_start].copy()
    elif not df_entries.empty:
        history_days = max((today - min(df_entries["entry_date"])).days + 1, 1)
        calendar_weeks = max(1, (history_days + 6) // 7)
    st.caption(
        "Détail journalier" if chart_granularity == "day"
        else "Valeurs regroupées par semaine" if chart_granularity == "week"
        else "Valeurs regroupées par mois"
    )
    monday, sunday = week_bounds(today)
    todoist_history_limited = period_start is None
    todoist_start = period_start or (today - timedelta(days=364))
    todoist_error = None
    try:
        todoist_completed = completed_tasks_frame(
            load_completed_tasks(todoist_start - timedelta(days=1), today + timedelta(days=2))
        )
        if not todoist_completed.empty:
            todoist_completed = todoist_completed[
                (todoist_completed["entry_date"] >= todoist_start)
                & (todoist_completed["entry_date"] <= today)
            ].copy()
    except TodoistError as exc:
        todoist_completed = pd.DataFrame()
        todoist_error = f"Historique Todoist indisponible : {exc}"

    if df_entries.empty:
        st.info("Commence par saisir une journée pour alimenter le dashboard.")
        st.subheader("Courbes par catégorie")
        st.caption("Les graphiques se rempliront progressivement avec tes premières saisies.")
        st.markdown("### Corps")
        plot_line(
            df_entries, ["weight_kg"], "Poids", {"weight_kg": "Poids"},
            granularity=chart_granularity, y_range=(60, 90), y_title="kg",
        )
        plot_line(
            df_entries, ["body_fat_pct"], "Taux de masse graisseuse", {"body_fat_pct": "Masse graisseuse"},
            granularity=chart_granularity, y_range=(0, 30), y_title="%",
        )
        plot_line(df_entries, ["belly_cm"], "Mesures corporelles", granularity=chart_granularity)
        st.divider()
        st.markdown("### Temps quotidiens")
        plot_daily_bar(df_entries, "sleep_hours", "Sommeil", "heures", "#6366f1", granularity=chart_granularity)
        plot_daily_bar(df_entries, "sport_hours", "Sport", "heures", "#22c55e", granularity=chart_granularity, aggregation="sum")
        plot_daily_bar(df_entries, "phone_hours", "Temps de portable", "heures", "#f97316", granularity=chart_granularity)
        st.divider()
        st.markdown("### Travail")
        plot_workday_calendar(df_entries, weeks=calendar_weeks)
        plot_daily_bar(df_entries, "work_hours", "Durée de travail", "heures", "#2563eb", granularity=chart_granularity, aggregation="sum")
        st.download_button(
            "📄 Télécharger le rapport PDF du temps de travail",
            data=build_work_report(df_entries, today),
            file_name=f"rapport_temps_travail_{today.isoformat()}.pdf",
            mime="application/pdf",
            use_container_width=True,
        )
        st.divider()
        st.markdown("### Alcool")
        plot_weekly_alcohol(df_entries, granularity=alcohol_granularity)
        st.divider()
        st.markdown("### Alimentation")
        plot_calorie_balance(df_entries, granularity=chart_granularity)
        plot_nutrition(df_entries, granularity=chart_granularity)
        st.divider()
        st.markdown("### Social")
        plot_social_by_week(all_social_logs, granularity=social_granularity)
        render_todoist_metrics(todoist_completed, chart_granularity, todoist_error)
    else:
        df_week = df_entries[(df_entries["entry_date"] >= monday) & (df_entries["entry_date"] <= sunday)].copy()
        social_week = all_social_logs[(all_social_logs["entry_date"] >= monday) & (all_social_logs["entry_date"] <= sunday)].copy() if not all_social_logs.empty else pd.DataFrame()

        st.subheader("Vue rapide hebdomadaire")
        k2, k3, k4, k5 = st.columns(4)
        with k2:
            st.metric("🍷 Série sans alcool", f"{no_alcohol_streak(df_entries)} j", help="Calculé sur les jours saisis consécutifs.")
        with k3:
            st.metric(
                "🍷 Verres cette semaine",
                fmt_metric(zero_if_none(safe_sum(df_week, "alcohol_glasses")), integer=True),
            )
        with k4:
            avg_sleep = safe_mean(df_week, "sleep_hours")
            st.metric("💤 Sommeil moyen", "—" if avg_sleep is None else f"{avg_sleep:.1f} h")
        with k5:
            avg_phone = safe_mean(df_week, "phone_hours")
            st.metric("📱 Portable moyen", "—" if avg_phone is None else f"{avg_phone:.1f} h/j")

        k6, k7, k8, k9, k10 = st.columns(5)
        with k6:
            work_total, work_target, work_balance = work_week_summary(df_entries, settings, today)
            if work_total is None:
                st.metric("💼 Travail semaine", "—")
            else:
                st.metric(
                    "💼 Travail semaine",
                    format_hour_decimal(work_total),
                    delta=None if work_balance is None else f"{work_balance:+.1f} h vs {work_target:.0f} h",
                )
        with k7:
            st.metric("🏃 Sport semaine", fmt_metric(safe_sum(df_week, "sport_hours"), " h"))
        with k8:
            avg_kcal = safe_mean(df_week, "kcal")
            st.metric("🔥 kcal moyennes", "—" if avg_kcal is None else f"{avg_kcal:.0f}")
        with k9:
            last_weight = latest_value(df_entries, "weight_kg")
            st.metric("⚖️ Dernier poids", "—" if last_weight is None else f"{last_weight:.1f} kg")
        with k10:
            last_belly = latest_value(df_entries, "belly_cm")
            belly_goal = setting_float(settings, "belly_goal_cm", None)
            delta = None if last_belly is None or belly_goal is None else last_belly - belly_goal
            st.metric(
                "📏 Tour de ventre",
                "—" if last_belly is None else f"{last_belly:.1f} cm",
                delta=None if delta is None else f"{delta:+.1f} cm vs critère",
            )

        k11, k12, k13 = st.columns(3)
        with k11:
            st.metric("👥 Jours sociaux semaine", f"{social_week['entry_date'].nunique() if not social_week.empty else 0}")
        with k12:
            st.metric("👥 Interactions semaine", f"{len(social_week) if not social_week.empty else 0}")
        with k13:
            st.metric("🎯 Objectifs actifs", f"{len(load_goals(active_only=True))}/3")

        st.divider()

        st.subheader("Courbes par catégorie")
        st.caption("Tous les graphiques sont regroupés sur cette page : fais défiler pour parcourir ton historique.")

        st.markdown("### Corps")
        plot_line(
            df_entries,
            ["weight_kg"],
            "Poids",
            {"weight_kg": "Poids"},
            granularity=chart_granularity,
            y_range=(60, 90),
            y_title="kg",
        )
        plot_line(
            df_entries,
            ["body_fat_pct"],
            "Taux de masse graisseuse",
            {"body_fat_pct": "Masse graisseuse"},
            granularity=chart_granularity,
            y_range=(0, 30),
            y_title="%",
        )
        plot_line(
            df_entries,
            ["belly_cm"],
            "Mesures corporelles",
            {"belly_cm": "Tour de ventre"},
            granularity=chart_granularity,
        )

        st.divider()
        st.markdown("### Temps quotidiens")
        plot_daily_bar(df_entries, "sleep_hours", "Sommeil", "heures", "#6366f1", granularity=chart_granularity)
        plot_daily_bar(df_entries, "sport_hours", "Sport", "heures", "#22c55e", granularity=chart_granularity, aggregation="sum")
        plot_daily_bar(df_entries, "phone_hours", "Temps de portable", "heures", "#f97316", granularity=chart_granularity)

        st.divider()
        st.markdown("### Travail")
        plot_workday_calendar(df_entries, weeks=calendar_weeks)
        st.markdown("#### Compteur cumulé du temps de travail")
        current_work_counter = work_balance_through_date(df_entries, today)
        st.metric(
            "⏱️ Compteur temps de travail",
            format_signed_duration(current_work_counter),
            help=(
                "Avance ou retard total jusqu’à aujourd’hui sur une référence de 7 h 42 par "
                "journée de travail renseignée. La journée actuelle n’est ajoutée "
                "que lorsque sa durée est calculable. Les Day off sont neutres."
            ),
        )
        st.caption("Le détail de la semaine en cours est présenté ci-dessous.")
        work_table = work_week_table(df_entries, settings, today)
        if work_table.empty:
            st.info("Pas encore de données de travail cette semaine.")
        else:
            st.dataframe(work_table, use_container_width=True, hide_index=True)
        plot_daily_bar(df_entries, "work_hours", "Durée de travail", "heures", "#2563eb", granularity=chart_granularity, aggregation="sum")
        st.download_button(
            "📄 Télécharger le rapport PDF du temps de travail",
            data=build_work_report(df_entries, today),
            file_name=f"rapport_temps_travail_{today.isoformat()}.pdf",
            mime="application/pdf",
            use_container_width=True,
        )

        st.divider()
        st.markdown("### Alcool")
        plot_weekly_alcohol(df_entries, granularity=alcohol_granularity)

        st.divider()
        st.markdown("### Alimentation")
        plot_calorie_balance(df_entries, granularity=chart_granularity)
        plot_nutrition(df_entries, granularity=chart_granularity)

        st.divider()
        st.markdown("### Social")
        plot_social_by_week(all_social_logs, granularity=social_granularity)
        recurrence = social_recurrence_table(all_social_logs)
        if not recurrence.empty:
            st.dataframe(recurrence, use_container_width=True, hide_index=True)

        render_todoist_metrics(todoist_completed, chart_granularity, todoist_error)
        if todoist_history_limited:
            st.caption("Pour préserver la rapidité, la vue Todoist « Depuis le début » est limitée aux 12 derniers mois.")

        st.divider()
        st.subheader("Objectifs cette semaine")
        if all_goal_logs.empty:
            st.info("Pas encore de suivi d'objectifs.")
        else:
            week_logs = all_goal_logs[(all_goal_logs["entry_date"] >= monday) & (all_goal_logs["entry_date"] <= sunday)]
            if week_logs.empty:
                st.info("Aucun objectif coché cette semaine.")
            else:
                summary = (
                    week_logs.groupby("title", as_index=False)["worked"]
                    .sum()
                    .rename(columns={"title": "Objectif", "worked": "Jours travaillés"})
                    .sort_values("Jours travaillés", ascending=False)
                )
                st.dataframe(summary, use_container_width=True, hide_index=True)

        st.divider()
        st.subheader("Évaluation de la semaine en cours")
        global_score, score_details = global_form_assessment(df_entries, all_goal_logs, all_social_logs, settings)
        label, explanation = label_global_score(global_score)

        g1, g2 = st.columns([1, 3])
        with g1:
            st.metric("Score hebdomadaire", "—" if global_score is None else f"{global_score}/100")
        with g2:
            st.markdown(f"**{label}**")
            st.write(explanation)
            st.caption("Score indicatif calculé du lundi à aujourd’hui. Les valeurs absentes sont ignorées, jamais transformées en zéro.")

        if not score_details.empty:
            st.dataframe(score_details, use_container_width=True, hide_index=True)


elif selected_tab == "Social":
    from dashboard_charts import plot_social_by_week, social_recurrence_table

    st.header("Suivi social")
    st.caption("Ajoute les personnes que tu veux suivre, puis coche-les dans la saisie quotidienne quand tu les vois.")

    with st.form("new_friend_form"):
        c1, c2, c3 = st.columns([2, 1, 1])
        with c1:
            new_friend = st.text_input("Nom de la personne")
        with c2:
            new_category = st.selectbox("Catégorie", ["Ami", "Famille", "Collègue", "Association", "Autre"])
        with c3:
            st.write("")
            add_friend = st.form_submit_button("Ajouter")
    if add_friend:
        if new_friend.strip():
            create_friend(new_friend, new_category)
            st.success("Personne ajoutée.")
            st.rerun()
        else:
            st.error("Indique un nom.")

    st.divider()

    friends = load_friends(active_only=False)
    social_logs = load_social_logs()

    s1, s2 = st.columns(2)
    with s1:
        st.subheader("Personnes suivies")
        if friends.empty:
            st.info("Aucune personne enregistrée.")
        else:
            display_friends = friends.copy()
            display_friends["Statut"] = display_friends["active"].apply(lambda x: "Actif" if x == 1 else "Masqué")
            st.dataframe(display_friends[["name", "category", "Statut", "created_at"]].rename(columns={
                "name": "Nom",
                "category": "Catégorie",
                "created_at": "Créé le",
            }), use_container_width=True, hide_index=True)

            for _, friend in friends.iterrows():
                action = "Masquer" if int(friend["active"]) == 1 else "Réactiver"
                if st.button(f"{action} — {friend['name']}", key=f"friend_active_{friend['id']}"):
                    update_friend_active(int(friend["id"]), active=not bool(friend["active"]))
                    st.rerun()

    with s2:
        st.subheader("Récurrence")
        recurrence = social_recurrence_table(social_logs)
        if recurrence.empty:
            st.info("Pas encore de données de récurrence.")
        else:
            st.dataframe(recurrence, use_container_width=True, hide_index=True)

    st.divider()
    st.subheader("Périodes sociales")
    plot_social_by_week(social_logs)

    if not social_logs.empty:
        st.subheader("Historique social")
        display_logs = social_logs.copy()
        display_logs["entry_date"] = display_logs["entry_date"].apply(lambda d: d.strftime("%d/%m/%Y"))
        st.dataframe(display_logs[["entry_date", "name", "category"]].rename(columns={
            "entry_date": "Date",
            "name": "Personne",
            "category": "Catégorie",
        }), use_container_width=True, hide_index=True)


elif selected_tab == "Objectifs & critères":
    st.header("Objectifs & critères")

    st.subheader("Critères personnels du dashboard")
    st.caption("Ces critères alimentent l'évaluation globale. Ils sont personnels, ajustables et non médicaux.")

    with st.form("criteria_form"):
        c1, c2, c3, c4 = st.columns(4)
        with c1:
            belly_goal_current = setting_float(settings, "belly_goal_cm", None)
            belly_goal_cm = st.number_input(
                "Critère tour de ventre max (cm)",
                min_value=0.0,
                max_value=200.0,
                step=0.5,
                value=float(belly_goal_current or 0.0),
                help="Mettre 0 pour désactiver le critère.",
            )
        with c2:
            sleep_min = st.number_input("Sommeil cible min (h)", min_value=0.0, max_value=12.0, step=0.25, value=setting_float(settings, "sleep_min_hours", 7) or 7.0)
        with c3:
            phone_max = st.number_input("Portable max moyen (h/j)", min_value=0.0, max_value=24.0, step=0.25, value=setting_float(settings, "phone_max_hours", 3) or 3.0)
        with c4:
            sport_goal = st.number_input("Sport cible (h/semaine)", min_value=0.0, max_value=20.0, step=0.25, value=setting_float(settings, "sport_weekly_goal_hours", 3) or 3.0)

        c5, c6 = st.columns(2)
        with c5:
            social_goal = st.number_input("Objectif social : jours avec interaction / semaine", min_value=0.0, max_value=7.0, step=1.0, value=setting_float(settings, "social_weekly_goal_days", 2) or 2.0)
        with c6:
            work_weekly_target = st.number_input("Objectif travail (h/semaine)", min_value=0.0, max_value=80.0, step=0.5, value=setting_float(settings, "work_weekly_target_hours", 35) or 35.0)
        work_days_per_week = st.number_input("Nombre de jours de travail de référence / semaine", min_value=1.0, max_value=7.0, step=1.0, value=setting_float(settings, "work_days_per_week", 5) or 5.0)

        st.markdown("#### Libellés et repères personnels")
        personal_col1, personal_col2 = st.columns(2)
        close_relations_label = personal_col1.text_input(
            "Libellé de la seconde note d’écoute",
            value=settings.get("close_relations_label", "Écoute de mes proches"),
        )
        tobacco_stop_date_text = personal_col2.text_input(
            "Date d’arrêt du tabac · facultative",
            value=settings.get("tobacco_stop_date", ""),
            placeholder="AAAA-MM-JJ",
            help="Laisse vide pour masquer cet indicateur.",
        )

        st.markdown("#### Horaires de travail standards")
        st.caption("Ils sont proposés comme raccourci dans la saisie quotidienne. Format attendu : HH:MM.")
        wt1, wt2, wt3, wt4 = st.columns(4)
        work_standard_start = wt1.text_input("Début", value=settings.get("work_standard_start", "08:30"))
        work_standard_morning_end = wt2.text_input("Fin de matinée", value=settings.get("work_standard_morning_end", "12:30"))
        work_standard_afternoon_start = wt3.text_input("Reprise", value=settings.get("work_standard_afternoon_start", "13:30"))
        work_standard_end = wt4.text_input("Fin", value=settings.get("work_standard_end", "17:30"))

        save_criteria = st.form_submit_button("Enregistrer les critères", use_container_width=True)

    if save_criteria:
        time_errors = []
        tobacco_date_error = None
        if tobacco_stop_date_text.strip():
            try:
                date.fromisoformat(tobacco_stop_date_text.strip())
            except ValueError:
                tobacco_date_error = "Date d’arrêt du tabac : utilise le format AAAA-MM-JJ."
        standard_times = {
            "work_standard_start": parse_optional_time(work_standard_start, "Début standard", time_errors),
            "work_standard_morning_end": parse_optional_time(work_standard_morning_end, "Fin de matinée standard", time_errors),
            "work_standard_afternoon_start": parse_optional_time(work_standard_afternoon_start, "Reprise standard", time_errors),
            "work_standard_end": parse_optional_time(work_standard_end, "Fin standard", time_errors),
        }
        if tobacco_date_error:
            st.error(tobacco_date_error)
        elif not close_relations_label.strip():
            st.error("Le libellé de la seconde note d’écoute ne peut pas être vide.")
        elif time_errors or any(value is None for value in standard_times.values()):
            for error in time_errors:
                st.error(error)
            if not time_errors:
                st.error("Les quatre horaires standards sont obligatoires.")
        else:
            save_setting("belly_goal_cm", "" if belly_goal_cm == 0 else belly_goal_cm)
            save_setting("sleep_min_hours", sleep_min)
            save_setting("phone_max_hours", phone_max)
            save_setting("sport_weekly_goal_hours", sport_goal)
            save_setting("social_weekly_goal_days", social_goal)
            save_setting("work_weekly_target_hours", work_weekly_target)
            save_setting("work_days_per_week", work_days_per_week)
            save_setting("close_relations_label", close_relations_label.strip())
            save_setting("tobacco_stop_date", tobacco_stop_date_text.strip())
            for key, value in standard_times.items():
                save_setting(key, value)
            st.success("Critères enregistrés.")
            st.rerun()

    st.divider()

    goals = load_goals(active_only=False)
    active_goals = load_goals(active_only=True)

    st.subheader("Objectifs actifs")
    st.caption("Garde 3 objectifs actifs. Quand un objectif est terminé, marque-le comme terminé puis ajoute un nouvel objectif.")

    if active_goals.empty:
        st.info("Aucun objectif actif.")
    else:
        for _, goal in active_goals.iterrows():
            c1, c2 = st.columns([4, 1])
            with c1:
                st.write(f"🎯 **{goal['title']}**")
            with c2:
                if st.button("Terminer", key=f"complete_{goal['id']}"):
                    complete_goal(int(goal["id"]))
                    st.rerun()

    st.divider()

    st.subheader("Ajouter un objectif")
    if len(active_goals) >= 3:
        st.warning("Tu as déjà 3 objectifs actifs. Termine ou désactive un objectif avant d'en ajouter un nouveau.")
    else:
        with st.form("new_goal_form"):
            new_goal = st.text_input("Nouvel objectif")
            add_goal = st.form_submit_button("Ajouter")
        if add_goal:
            if new_goal.strip():
                create_goal(new_goal)
                st.success("Objectif ajouté.")
                st.rerun()
            else:
                st.error("Indique un intitulé d'objectif.")

    st.divider()

    st.subheader("Historique des objectifs")
    if goals.empty:
        st.info("Aucun objectif enregistré.")
    else:
        display = goals.copy()
        display["Statut"] = display["active"].apply(lambda x: "Actif" if x == 1 else "Terminé")
        display = display[["title", "Statut", "created_at", "completed_at"]].rename(columns={
            "title": "Objectif",
            "created_at": "Créé le",
            "completed_at": "Terminé le",
        })
        st.dataframe(display, use_container_width=True, hide_index=True)

        inactive = goals[goals["active"] == 0]
        if not inactive.empty:
            st.caption("Réactiver un ancien objectif")
            for _, goal in inactive.iterrows():
                if st.button(f"Réactiver — {goal['title']}", key=f"reactivate_{goal['id']}"):
                    if len(load_goals(active_only=True)) >= 3:
                        st.error("Impossible : il y a déjà 3 objectifs actifs.")
                    else:
                        reactivate_goal(int(goal["id"]))
                        st.rerun()


elif selected_tab == "Performance":
    st.header("Performance")

    st.subheader("Coût estimé de l’API OpenAI")
    api_usage_logs = load_api_usage_logs()
    if api_usage_logs.empty:
        st.info("Le suivi commencera lors de la prochaine analyse nutritionnelle.")
    else:
        total_eur = float(api_usage_logs["estimated_cost_eur"].sum())
        total_usd = float(api_usage_logs["estimated_cost_usd"].sum())
        total_tokens = int(
            api_usage_logs["input_tokens"].sum() + api_usage_logs["output_tokens"].sum()
        )
        last_cost_eur = float(api_usage_logs.iloc[0]["estimated_cost_eur"])
        cost1, cost2, cost3, cost4 = st.columns(4)
        cost1.metric("Coût cumulé estimé", f"{total_eur:.4f} €")
        cost2.metric("Dernière analyse", f"{last_cost_eur:.4f} €")
        cost3.metric("Analyses suivies", str(len(api_usage_logs)))
        cost4.metric("Jetons consommés", f"{total_tokens:,}".replace(",", " "))
        exchange_rate = float(api_usage_logs.iloc[0]["usd_to_eur"])
        st.caption(
            f"Estimation technique : {total_usd:.4f} $ convertis avec 1 $ = {exchange_rate:.2f} €. "
            "La facture OpenAI reste la référence définitive."
        )
        st.link_button("Voir la consommation officielle OpenAI", "https://platform.openai.com/usage", use_container_width=True)

    st.divider()
    st.caption("Mesures conservées uniquement dans cette session. Elles ne sont ni envoyées ni enregistrées dans Neon.")

    summary = performance_summary()
    samples = st.session_state.get("performance_samples", [])
    if summary.empty:
        st.info("Navigue dans l’application et enregistre quelques étapes pour produire des mesures.")
    else:
        last_cycle = next(
            (item["ms"] for item in reversed(samples) if item["process"] == "Interface · cycle complet"),
            None,
        )
        slowest = summary.iloc[0]
        k1, k2, k3 = st.columns(3)
        k1.metric("Dernier affichage", f"{last_cycle:.0f} ms" if last_cycle is not None else "—")
        k2.metric("Process le plus lent", str(slowest["process"]).replace("Base · ", ""))
        k3.metric("Maximum observé", f"{slowest['maximum_ms']:.0f} ms")

        display = summary.rename(columns={
            "process": "Process",
            "appels": "Appels",
            "dernier_ms": "Dernier (ms)",
            "moyenne_ms": "Moyenne (ms)",
            "maximum_ms": "Maximum (ms)",
        })
        st.dataframe(
            display,
            use_container_width=True,
            hide_index=True,
            column_config={
                "Dernier (ms)": st.column_config.NumberColumn(format="%.0f"),
                "Moyenne (ms)": st.column_config.NumberColumn(format="%.0f"),
                "Maximum (ms)": st.column_config.NumberColumn(format="%.0f"),
            },
        )
        st.caption("Repère pratique : moins de 300 ms est très réactif ; au-delà de 1 000 ms, le process mérite une optimisation.")

    if st.button("Effacer les mesures", use_container_width=True):
        st.session_state.performance_samples = []
        st.rerun()


elif selected_tab == "Données":
    st.header("Données")

    df_entries = load_entries()
    if df_entries.empty:
        st.info("Aucune donnée quotidienne saisie.")
    else:
        st.subheader("Entrées quotidiennes")
        st.dataframe(df_entries.sort_values("entry_date", ascending=False), use_container_width=True, hide_index=True)

        csv = df_entries.to_csv(index=False).encode("utf-8")
        st.download_button(
            "⬇️ Télécharger les données quotidiennes en CSV",
            data=csv,
            file_name="life_dashboard_daily_entries.csv",
            mime="text/csv",
            use_container_width=True,
        )

    goal_logs = load_goal_logs_all()
    if not goal_logs.empty:
        st.subheader("Suivi des objectifs")
        st.dataframe(goal_logs, use_container_width=True, hide_index=True)

        csv_goals = goal_logs.to_csv(index=False).encode("utf-8")
        st.download_button(
            "⬇️ Télécharger le suivi des objectifs en CSV",
            data=csv_goals,
            file_name="life_dashboard_goal_logs.csv",
            mime="text/csv",
            use_container_width=True,
        )

    social_logs = load_social_logs()
    if not social_logs.empty:
        st.subheader("Suivi social")
        st.dataframe(social_logs, use_container_width=True, hide_index=True)

        csv_social = social_logs.to_csv(index=False).encode("utf-8")
        st.download_button(
            "⬇️ Télécharger le suivi social en CSV",
            data=csv_social,
            file_name="life_dashboard_social_logs.csv",
            mime="text/csv",
            use_container_width=True,
        )


record_performance("Interface · cycle complet", (time.perf_counter() - APP_RUN_STARTED) * 1000)
