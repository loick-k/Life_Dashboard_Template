from datetime import date

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from app_clock import today_paris


LOCKED_CHART_CONFIG = {
    "displayModeBar": False,
    "scrollZoom": False,
    "doubleClick": False,
    "showTips": False,
    "staticPlot": True,
    "responsive": True,
}


def _show_chart(fig):
    """Affiche un graphique sans interaction pour préserver le scroll mobile."""
    if fig.layout.height is None:
        fig.update_layout(height=380)
    fig.update_layout(
        dragmode=False,
        margin={"l": 45, "r": 20, "t": 60, "b": 55},
    )
    fig.update_xaxes(fixedrange=True)
    fig.update_yaxes(fixedrange=True)
    st.plotly_chart(fig, use_container_width=True, config=LOCKED_CHART_CONFIG)


def _empty_chart(title, y_title="", y_range=None):
    fig = go.Figure()
    fig.update_layout(
        title=title,
        xaxis_title="",
        yaxis_title=y_title,
        yaxis={"rangemode": "tozero", "range": list(y_range) if y_range is not None else [0, 1]},
        annotations=[{
            "text": "Aucune donnée pour le moment",
            "xref": "paper",
            "yref": "paper",
            "x": 0.5,
            "y": 0.5,
            "showarrow": False,
            "font": {"color": "#8a8f99"},
        }],
    )
    _show_chart(fig)


def _group_dates(df, columns, granularity="day", aggregation="mean"):
    plot_df = df[["entry_date", *columns]].copy()
    plot_df["entry_date"] = pd.to_datetime(plot_df["entry_date"], errors="coerce")
    plot_df = plot_df.dropna(subset=["entry_date"])
    if granularity == "day":
        return plot_df
    frequency = "W-MON" if granularity == "week" else "MS"
    grouped = plot_df.set_index("entry_date")[columns].resample(frequency)
    return (grouped.sum(min_count=1) if aggregation == "sum" else grouped.mean()).reset_index()


def plot_line(df, y_cols, title, labels=None, granularity="day", y_range=None, y_title=""):
    available = [c for c in y_cols if c in df.columns]
    if df.empty or not available:
        _empty_chart(title, y_title, y_range)
        return

    plot_df = _group_dates(df, available, granularity, "mean")
    plot_df = plot_df.melt(id_vars="entry_date", var_name="indicateur", value_name="valeur")
    plot_df = plot_df.dropna(subset=["valeur"])

    if plot_df.empty:
        _empty_chart(title, y_title, y_range)
        return

    if labels:
        plot_df["indicateur"] = plot_df["indicateur"].replace(labels)

    fig = px.line(plot_df, x="entry_date", y="valeur", color="indicateur", markers=True, title=title)
    fig.update_layout(xaxis_title="", yaxis_title=y_title)
    if y_range is not None:
        fig.update_yaxes(range=list(y_range))
    _show_chart(fig)


def plot_daily_bar(
    df, column, title, y_label, color="#3b82f6", *, granularity="day", aggregation="mean"
):
    if df.empty or column not in df.columns:
        _empty_chart(title, y_label)
        return

    plot_df = _group_dates(df, [column], granularity, aggregation)
    plot_df[column] = pd.to_numeric(plot_df[column], errors="coerce")
    plot_df = plot_df.dropna(subset=[column])
    if plot_df.empty:
        _empty_chart(title, y_label)
        return

    plot_df["label"] = plot_df[column].map(lambda value: "" if value == 0 else f"{value:g}")
    fig = px.bar(plot_df, x="entry_date", y=column, text="label", title=title)
    fig.update_traces(
        marker_color=color,
        textposition="outside",
        cliponaxis=False,
        hovertemplate=f"%{{x|%d/%m/%Y}}<br>%{{y:.2f}} {y_label}<extra></extra>",
    )

    zero_values = plot_df[plot_df[column] == 0]
    if not zero_values.empty:
        fig.add_trace(go.Scatter(
            x=zero_values["entry_date"],
            y=[0] * len(zero_values),
            mode="markers+text",
            marker={"symbol": "circle-open", "size": 10, "color": color, "line": {"width": 2}},
            text=["0"] * len(zero_values),
            textposition="top center",
            cliponaxis=False,
            hoverinfo="skip",
            showlegend=False,
        ))
    fig.update_layout(xaxis_title="", yaxis_title=y_label, bargap=0.25)
    fig.update_yaxes(rangemode="tozero")
    _show_chart(fig)

def plot_weekly_alcohol(df, granularity="week"):
    if df.empty:
        _empty_chart("Nombre de verres par semaine", "Verres")
        return

    plot_df = df[["entry_date", "alcohol_glasses"]].copy()
    plot_df["entry_date"] = pd.to_datetime(plot_df["entry_date"], errors="coerce")
    plot_df = plot_df.dropna(subset=["entry_date"])
    plot_df["alcohol_glasses"] = pd.to_numeric(plot_df["alcohol_glasses"], errors="coerce")
    plot_df = plot_df.dropna(subset=["alcohol_glasses"])
    if plot_df.empty:
        _empty_chart("Nombre de verres par semaine", "Verres")
        return
    period_frequency = "M" if granularity == "month" else "W-SUN"
    plot_df["week"] = plot_df["entry_date"].dt.to_period(period_frequency)
    weekly = plot_df.groupby("week", as_index=False)["alcohol_glasses"].sum()

    weekly["week_label"] = weekly["week"].map(
        lambda period: (
            f"{period.start_time:%m/%Y}" if granularity == "month"
            else f"{period.start_time:%d/%m} → {period.end_time:%d/%m}"
        )
    )
    weekly["label"] = weekly["alcohol_glasses"].map(
        lambda value: "" if value == 0 else f"{value:g} verre(s)"
    )
    y_max = max(1.0, float(weekly["alcohol_glasses"].max()) * 1.2)
    fig = px.bar(
        weekly,
        x="week_label",
        y="alcohol_glasses",
        text="label",
        title="Nombre de verres par mois" if granularity == "month" else "Nombre de verres par semaine",
    )
    fig.update_traces(textposition="outside", cliponaxis=False, marker_color="#ef4444")

    zero_weeks = weekly[weekly["alcohol_glasses"] == 0]
    if not zero_weeks.empty:
        fig.add_trace(go.Scatter(
            x=zero_weeks["week_label"],
            y=[0] * len(zero_weeks),
            mode="markers+text",
            marker={"symbol": "circle-open", "size": 10, "color": "#ef4444", "line": {"width": 2}},
            text=["0 verre"] * len(zero_weeks),
            textposition="top center",
            cliponaxis=False,
            hoverinfo="skip",
            showlegend=False,
        ))
    fig.update_layout(xaxis_title="Mois" if granularity == "month" else "Semaine", yaxis_title="Verres", bargap=0.3)
    fig.update_yaxes(range=[0, y_max], rangemode="tozero")
    _show_chart(fig)


def plot_workday_calendar(df, weeks=26):
    workdays = (
        df[["entry_date", "work_travel"]].copy()
        if not df.empty and "work_travel" in df.columns
        else pd.DataFrame(columns=["entry_date", "work_travel"])
    )
    workdays["entry_date"] = pd.to_datetime(workdays["entry_date"], errors="coerce")
    workdays["work_travel"] = workdays["work_travel"].fillna("").astype(str).str.strip()
    workdays = workdays.dropna(subset=["entry_date"])
    workdays = workdays[workdays["work_travel"] != ""]
    latest_workday = workdays["entry_date"].max().normalize() if not workdays.empty else pd.Timestamp.today().normalize()
    end_date = max(pd.Timestamp.today().normalize(), latest_workday)
    end_date += pd.Timedelta(days=6 - end_date.weekday())
    start_date = end_date - pd.Timedelta(weeks=weeks - 1, days=6)
    start_date -= pd.Timedelta(days=start_date.weekday())
    all_dates = pd.date_range(start_date, end_date, freq="D")
    week_starts = pd.date_range(start_date, end_date, freq="W-MON")

    aliases = {
        "Bureau": "Bureau",
        "Télétravail": "Télétravail",
        "Déplacement": "Déplacement",
        "Day off": "Day off",
        "Congé": "Day off",
    }
    day_types = {
        row.entry_date.normalize(): aliases.get(row.work_travel, "Autre")
        for row in workdays.itertuples()
        if start_date <= row.entry_date.normalize() <= end_date
    }
    categories = ["Non renseigné", "Bureau", "Télétravail", "Déplacement", "Day off", "Autre"]
    category_codes = {name: index for index, name in enumerate(categories)}
    colors = ["#ebedf0", "#2563eb", "#8b5cf6", "#f59e0b", "#22c55e", "#64748b"]
    z = [[0 for _ in week_starts] for _ in range(7)]
    hover_dates = [["" for _ in week_starts] for _ in range(7)]
    hover_types = [["Non renseigné" for _ in week_starts] for _ in range(7)]

    for current_date in all_dates:
        week_index = (current_date.normalize() - start_date).days // 7
        weekday = current_date.weekday()
        day_type = day_types.get(current_date.normalize(), "Non renseigné")
        z[weekday][week_index] = category_codes[day_type]
        hover_dates[weekday][week_index] = current_date.strftime("%d/%m/%Y")
        hover_types[weekday][week_index] = day_type

    scale = []
    last_index = len(colors) - 1
    for index, color in enumerate(colors):
        lower = max(0, (index - 0.5) / last_index)
        upper = min(1, (index + 0.5) / last_index)
        scale.extend([(lower, color), (upper, color)])

    fig = go.Figure(go.Heatmap(
        z=z,
        x=week_starts,
        y=["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"],
        customdata=[
            [[hover_dates[row][col], hover_types[row][col]] for col in range(len(week_starts))]
            for row in range(7)
        ],
        colorscale=scale,
        zmin=0,
        zmax=last_index,
        xgap=4,
        ygap=4,
        hovertemplate="%{customdata[0]}<br><b>%{customdata[1]}</b><extra></extra>",
        colorbar={
            "title": "Type",
            "tickmode": "array",
            "tickvals": list(range(len(categories))),
            "ticktext": categories,
            "thickness": 12,
        },
    ))
    fig.update_layout(
        title=f"Type de journée — {weeks} dernière{'s' if weeks > 1 else ''} semaine{'s' if weeks > 1 else ''}",
        height=330,
        margin={"l": 45, "r": 20, "t": 55, "b": 35},
        xaxis={"title": "", "tickformat": "%d %b", "dtick": 28 * 24 * 60 * 60 * 1000},
        yaxis={"title": "", "autorange": "reversed"},
    )
    _show_chart(fig)

def plot_nutrition(df, granularity="day"):
    plot_daily_bar(df, "proteins_g", "Protéines", "grammes", "#2563eb", granularity=granularity)
    plot_daily_bar(df, "carbs_g", "Glucides", "grammes", "#f59e0b", granularity=granularity)
    plot_daily_bar(df, "fats_g", "Lipides", "grammes", "#ef4444", granularity=granularity)


def calorie_balance_data(df):
    """Ajoute le bilan calorique sans transformer une donnée absente en zéro."""
    result = df.copy()
    for column in ("kcal", "sport_kcal_burned"):
        if column not in result.columns:
            result[column] = pd.NA
        result[column] = pd.to_numeric(result[column], errors="coerce")
    known_values = result["kcal"].notna() & result["sport_kcal_burned"].notna()
    result["net_kcal"] = (result["kcal"] - result["sport_kcal_burned"]).where(known_values)
    return result


def plot_calorie_balance(df, granularity="day"):
    calorie_df = calorie_balance_data(df)
    plot_daily_bar(
        calorie_df, "kcal", "Calories ingérées", "kcal", "#f97316",
        granularity=granularity,
    )
    plot_daily_bar(
        calorie_df, "sport_kcal_burned", "Calories dépensées par le sport", "kcal", "#16a34a",
        granularity=granularity,
    )
    plot_daily_bar(
        calorie_df, "net_kcal", "Calories nettes (alimentation − sport)", "kcal", "#7c3aed",
        granularity=granularity,
    )

def plot_social_by_week(social_logs, granularity="week"):
    if social_logs.empty:
        _empty_chart("Personnes vues et jours sociaux par semaine", "Nombre")
        return
    plot_df = social_logs.copy()
    plot_df["entry_date"] = pd.to_datetime(plot_df["entry_date"])
    frequency = "M" if granularity == "month" else "W-MON"
    plot_df["week"] = plot_df["entry_date"].dt.to_period(frequency).astype(str)
    weekly = plot_df.groupby("week", as_index=False).agg(
        jours_sociaux=("entry_date", "nunique"),
        personnes_vues=("id", "count"),
    )
    fig = px.bar(
        weekly,
        x="week",
        y=["jours_sociaux", "personnes_vues"],
        barmode="group",
        title="Personnes vues et jours sociaux par mois" if granularity == "month" else "Personnes vues et jours sociaux par semaine",
        labels={"value": "Nombre", "variable": "Indicateur"},
    )
    fig.update_layout(xaxis_title="Mois" if granularity == "month" else "Semaine", yaxis_title="Nombre")
    _show_chart(fig)

def social_recurrence_table(social_logs):
    if social_logs.empty:
        return pd.DataFrame()

    today = today_paris()
    rows = []
    for name, group in social_logs.groupby("name"):
        dates = sorted(
            pd.to_datetime(group["entry_date"], errors="coerce")
            .dropna()
            .dt.date
            .unique()
        )
        if not dates:
            continue
        last_seen = dates[-1]
        intervals = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
        avg_interval = round(sum(intervals) / len(intervals), 1) if intervals else None
        avg_interval_label = "—" if avg_interval is None else f"{avg_interval:g} j"
        rows.append({
            "Personne": name,
            "Catégorie": group["category"].dropna().iloc[-1] if "category" in group and not group["category"].dropna().empty else "",
            "Nombre de fois vue": len(dates),
            "Dernière fois": last_seen.strftime("%d/%m/%Y"),
            "Jours depuis": (today - last_seen).days,
            # Cette colonne est volontairement 100 % textuelle : mélanger float
            # et « — » provoque un échec de sérialisation PyArrow dans Streamlit.
            "Intervalle moyen entre deux fois": avg_interval_label,
        })

    return pd.DataFrame(rows).sort_values(["Jours depuis", "Nombre de fois vue"], ascending=[True, False])
