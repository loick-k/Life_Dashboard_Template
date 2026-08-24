from datetime import date, timedelta

import pandas as pd

from app_clock import today_paris


def setting_float(settings, key, default=None):
    try:
        raw = settings.get(key, "")
        if raw in (None, ""):
            return default
        return float(raw)
    except ValueError:
        return default


def setting_date(settings, key, default=None):
    raw = str(settings.get(key, "") or "").strip()
    if not raw:
        return default
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return default

def week_bounds(ref: date):
    monday = ref - timedelta(days=ref.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday

def no_alcohol_streak(df: pd.DataFrame):
    if df.empty:
        return 0

    df2 = df[["entry_date", "alcohol_glasses"]].copy()
    df2 = df2.dropna(subset=["entry_date"])
    if df2.empty:
        return 0

    today = today_paris()
    df2 = df2[df2["entry_date"] <= today]
    if df2.empty:
        return 0
    df2["alcohol_glasses"] = pd.to_numeric(df2["alcohol_glasses"], errors="coerce").fillna(0)
    positive_days = df2.loc[df2["alcohol_glasses"] > 0, "entry_date"]
    if not positive_days.empty:
        return max((today - positive_days.max()).days, 0)

    return max((today - df2["entry_date"].min()).days + 1, 0)

def safe_sum(df, col):
    if df.empty or col not in df:
        return None
    values = pd.to_numeric(df[col], errors="coerce").dropna()
    if values.empty:
        return None
    return float(values.sum())

def zero_if_none(value):
    return 0 if value is None else value

def fmt_metric(value, suffix="", decimals=1, integer=False):
    if value is None:
        return "—"
    if integer:
        return f"{int(round(value))}{suffix}"
    return f"{value:.{decimals}f}{suffix}"

def safe_mean(df, col):
    if df.empty or col not in df:
        return None
    values = pd.to_numeric(df[col], errors="coerce").dropna()
    if values.empty:
        return None
    return float(values.mean())

def latest_value(df, col):
    if df.empty or col not in df:
        return None
    values = pd.to_numeric(df[col], errors="coerce").dropna()
    if values.empty:
        return None
    return float(values.iloc[-1])

def trend_delta(df, col, days=14):
    if df.empty or col not in df:
        return None
    dmin = today_paris() - timedelta(days=days)
    sub = df[df["entry_date"] >= dmin].copy()
    vals = pd.to_numeric(sub[col], errors="coerce").dropna()
    if len(vals) < 2:
        return None
    return float(vals.iloc[-1] - vals.iloc[0])

def score_sleep(avg_sleep):
    if avg_sleep is None:
        return None, "Pas assez de données sommeil."
    if 7 <= avg_sleep <= 9:
        return 100, "Sommeil moyen dans la zone cible."
    if 6 <= avg_sleep < 7 or 9 < avg_sleep <= 10:
        return 75, "Sommeil proche de la zone cible."
    if 5 <= avg_sleep < 6 or 10 < avg_sleep <= 11:
        return 50, "Sommeil à surveiller."
    return 30, "Sommeil très éloigné de la zone cible."

def score_alcohol(weekly_glasses):
    if weekly_glasses is None:
        return None, "Pas assez de données alcool cette semaine."
    if weekly_glasses == 0:
        return 100, "Semaine explicitement saisie sans alcool."
    if weekly_glasses <= 4:
        return 80, "Consommation alcool faible cette semaine."
    if weekly_glasses <= 8:
        return 55, "Consommation alcool modérée à surveiller."
    return 30, "Consommation alcool élevée cette semaine."

def score_tobacco(days_without_smoking):
    if days_without_smoking >= 365:
        return 100, "Plus d’un an sans tabac."
    if days_without_smoking >= 90:
        return 90, "Plus de trois mois sans tabac."
    if days_without_smoking >= 30:
        return 80, "Plus d’un mois sans tabac."
    if days_without_smoking >= 7:
        return 70, "Plus d’une semaine sans tabac."
    if days_without_smoking > 0:
        return 60, "Dynamique sans tabac engagée."
    return 30, "Arrêt du tabac à consolider."

def score_sport(weekly_hours, target_hours):
    if weekly_hours is None:
        return None, "Pas assez de données sport cette semaine."
    if target_hours is None or target_hours <= 0:
        target_hours = 3
    if weekly_hours >= target_hours:
        return 100, "Objectif sport hebdomadaire atteint."
    if weekly_hours >= 0.5 * target_hours:
        return 70, "Sport présent mais objectif pas encore atteint."
    if weekly_hours > 0:
        return 45, "Un peu de sport, mais volume faible."
    return 25, "Aucune activité sportive saisie cette semaine."

def score_phone(avg_phone, max_phone):
    if avg_phone is None:
        return None, "Pas assez de données portable."
    if max_phone is None or max_phone <= 0:
        max_phone = 3
    if avg_phone <= max_phone:
        return 100, "Temps portable dans ton critère."
    if avg_phone <= max_phone * 1.4:
        return 70, "Temps portable légèrement au-dessus du critère."
    if avg_phone <= max_phone * 2:
        return 45, "Temps portable assez élevé."
    return 25, "Temps portable très élevé."

def score_nutrition(df_week):
    if df_week.empty:
        return None, "Pas assez de données alimentation."
    nutrition_columns = ["kcal", "proteins_g", "carbs_g", "fats_g"]
    available_columns = [column for column in nutrition_columns if column in df_week]
    if not available_columns:
        return None, "Aucune donnée alimentation renseignée cette semaine."
    tracked_days = df_week[available_columns].notna().any(axis=1).sum()
    if tracked_days == 0:
        return None, "Aucune donnée alimentation renseignée cette semaine."
    if tracked_days >= 6:
        return 100, "Alimentation bien renseignée cette semaine."
    if tracked_days >= 4:
        return 75, "Alimentation renseignée sur une partie de la semaine."
    if tracked_days >= 2:
        return 50, "Alimentation peu renseignée."
    return 30, "Très peu de données alimentation."

def score_body(df_entries, belly_goal):
    latest_belly = latest_value(df_entries, "belly_cm")
    latest_weight = latest_value(df_entries, "weight_kg")
    latest_fat = latest_value(df_entries, "body_fat_pct")

    if latest_belly is None and latest_weight is None and latest_fat is None:
        return None, "Pas assez de données corps."

    if belly_goal is not None and belly_goal > 0 and latest_belly is not None:
        delta = latest_belly - belly_goal
        if delta <= 0:
            return 100, "Tour de ventre dans ton critère personnel."
        if delta <= 3:
            return 75, "Tour de ventre proche du critère personnel."
        if delta <= 7:
            return 55, "Tour de ventre au-dessus du critère."
        return 35, "Tour de ventre nettement au-dessus du critère."

    belly_trend = trend_delta(df_entries, "belly_cm", days=21)
    if belly_trend is not None:
        if belly_trend < -1:
            return 85, "Tendance récente du tour de ventre à la baisse."
        if belly_trend <= 1:
            return 65, "Tour de ventre plutôt stable."
        return 45, "Tour de ventre en hausse sur la période récente."

    return 60, "Données corps présentes, mais pas encore assez de recul."

def score_social(social_week, target_days):
    if target_days is None or target_days <= 0:
        target_days = 2
    social_days = social_week["entry_date"].nunique() if not social_week.empty else 0
    if social_days >= target_days:
        return 100, "Objectif social hebdomadaire atteint."
    if social_days >= 1:
        return 70, "Au moins une journée sociale cette semaine."
    return 35, "Aucune interaction sociale saisie cette semaine."

def score_goals(goal_logs_week):
    if goal_logs_week.empty:
        return None, "Pas encore de suivi d'objectifs cette semaine."
    worked_days = goal_logs_week.loc[goal_logs_week["worked"] == 1, "entry_date"].nunique()
    total_days = goal_logs_week["entry_date"].nunique()
    if total_days == 0:
        return None, "Pas encore de suivi d'objectifs cette semaine."
    ratio = worked_days / total_days
    if ratio >= 0.8:
        return 100, "Objectifs travaillés presque tous les jours saisis."
    if ratio >= 0.5:
        return 75, "Objectifs travaillés régulièrement."
    if ratio > 0:
        return 50, "Objectifs travaillés ponctuellement."
    return 25, "Aucun objectif travaillé sur les jours saisis."


def score_tracking(df_week, column, label, expected_days):
    if df_week.empty or column not in df_week:
        return None, f"Aucune donnée {label.lower()} cette semaine."
    tracked = int(pd.to_numeric(df_week[column], errors="coerce").notna().sum())
    if tracked == 0:
        return None, f"Aucune donnée {label.lower()} cette semaine."
    ratio = tracked / max(expected_days, 1)
    score = 100 if ratio >= 0.8 else 75 if ratio >= 0.5 else 50 if ratio >= 0.25 else 30
    return score, f"{tracked}/{expected_days} jour(s) renseigné(s) cette semaine."


def score_work(weekly_hours, target_hours):
    if weekly_hours is None:
        return None, "Aucun temps de travail renseigné cette semaine."
    target = target_hours if target_hours and target_hours > 0 else 35
    ratio = weekly_hours / target
    if 0.9 <= ratio <= 1.1:
        return 100, "Temps de travail proche de l’objectif hebdomadaire."
    if 0.7 <= ratio <= 1.25:
        return 75, "Temps de travail assez proche de l’objectif."
    if ratio > 1.25:
        return 50, "Temps de travail nettement supérieur à l’objectif."
    return 45, "Temps de travail inférieur à l’objectif hebdomadaire."


def score_positive_time(total_minutes, label, target_minutes=60):
    if total_minutes is None:
        return None, f"Aucun temps {label.lower()} renseigné cette semaine."
    if total_minutes >= target_minutes:
        return 100, f"{label} bien présent cette semaine."
    if total_minutes > 0:
        return 65, f"{label} présent, mais encore ponctuel cette semaine."
    return 35, f"Aucun temps consacré à {label.lower()} cette semaine."


def score_rating(avg_rating, label):
    if avg_rating is None:
        return None, f"Aucune note pour {label.lower()} cette semaine."
    return round(max(1, min(10, avg_rating)) * 10), f"Note moyenne : {avg_rating:.1f}/10 cette semaine."

def global_form_assessment(df_entries, goal_logs, social_logs, settings):
    today = today_paris()
    monday, sunday = week_bounds(today)
    df_week = df_entries[(df_entries["entry_date"] >= monday) & (df_entries["entry_date"] <= sunday)].copy() if not df_entries.empty else pd.DataFrame()
    goals_week = goal_logs[(goal_logs["entry_date"] >= monday) & (goal_logs["entry_date"] <= sunday)].copy() if not goal_logs.empty else pd.DataFrame()
    social_week = social_logs[(social_logs["entry_date"] >= monday) & (social_logs["entry_date"] <= sunday)].copy() if not social_logs.empty else pd.DataFrame()

    elapsed_days = min(today.weekday() + 1, 7)
    sport_target = setting_float(settings, "sport_weekly_goal_hours", 3)
    phone_max = setting_float(settings, "phone_max_hours", 3)
    belly_goal = setting_float(settings, "belly_goal_cm", None)
    social_target = setting_float(settings, "social_weekly_goal_days", 2)
    work_target = setting_float(settings, "work_weekly_target_hours", 35)

    components = []
    tobacco_stop_date = setting_date(settings, "tobacco_stop_date")
    close_relations_label = str(
        settings.get("close_relations_label", "Écoute de mes proches")
        or "Écoute de mes proches"
    )
    if tobacco_stop_date is not None:
        tobacco_days = max((today - tobacco_stop_date).days, 0)
        components.append(("Tabac", *score_tobacco(tobacco_days), 0.8))
    components.extend([
        ("Alcool", *score_alcohol(safe_sum(df_week, "alcohol_glasses")), 1.0),
        ("Sommeil", *score_sleep(safe_mean(df_week, "sleep_hours")), 1.0),
        ("Poids · suivi", *score_tracking(df_week, "weight_kg", "Poids", elapsed_days), 0.35),
        ("Masse graisseuse · suivi", *score_tracking(df_week, "body_fat_pct", "Masse graisseuse", elapsed_days), 0.35),
        ("Tour de ventre", *score_body(df_week, belly_goal), 0.6),
        ("Travail", *score_work(safe_sum(df_week, "work_duration_hours"), work_target), 0.8),
        ("Sport", *score_sport(safe_sum(df_week, "sport_hours"), sport_target), 1.0),
        ("Temps de portable", *score_phone(safe_mean(df_week, "phone_hours"), phone_max), 0.9),
        ("Repas saisis", *score_nutrition(df_week), 0.45),
        ("Calories · suivi", *score_tracking(df_week, "kcal", "Calories", elapsed_days), 0.2),
        ("Protéines · suivi", *score_tracking(df_week, "proteins_g", "Protéines", elapsed_days), 0.2),
        ("Glucides · suivi", *score_tracking(df_week, "carbs_g", "Glucides", elapsed_days), 0.2),
        ("Lipides · suivi", *score_tracking(df_week, "fats_g", "Lipides", elapsed_days), 0.2),
        ("Écriture", *score_positive_time(safe_sum(df_week, "me_time_writing_minutes"), "Écriture"), 0.45),
        ("Méditation", *score_positive_time(safe_sum(df_week, "me_time_meditation_minutes"), "Méditation"), 0.45),
        ("Détente", *score_positive_time(safe_sum(df_week, "me_time_relaxation_minutes"), "Détente"), 0.45),
        ("Sorties", *score_positive_time(safe_sum(df_week, "me_time_outings_minutes"), "Sorties"), 0.45),
        ("Écoute de soi", *score_rating(safe_mean(df_week, "self_listening_score"), "Écoute de soi"), 0.7),
        (close_relations_label, *score_rating(safe_mean(df_week, "close_relations_listening_score"), close_relations_label), 0.7),
        ("Social", *score_social(social_week, social_target), 0.8),
        ("Objectifs", *score_goals(goals_week), 0.9),
    ])

    rows = []
    weighted_sum = 0
    weight_sum = 0
    for name, score, comment, weight in components:
        rows.append({"Indicateur de la semaine": name, "Score": score, "Lecture": comment})
        if score is not None:
            weighted_sum += score * weight
            weight_sum += weight

    global_score = round(weighted_sum / weight_sum) if weight_sum else None
    return global_score, pd.DataFrame(rows)

def label_global_score(score):
    if score is None:
        return "Pas assez de données", "Saisis quelques jours pour avoir une première lecture."
    if score >= 85:
        return "Très bonne dynamique", "Les signaux de la semaine sont globalement bien orientés."
    if score >= 70:
        return "Bonne dynamique", "La base est bonne, avec quelques leviers d'amélioration."
    if score >= 55:
        return "Équilibre fragile", "Certains signaux sont bons, mais plusieurs points tirent la forme vers le bas."
    return "Semaine difficile", "Le score suggère une semaine à alléger ou à reprendre par un ou deux leviers simples."
