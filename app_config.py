APP_TITLE = "Tableau de bord personnel"

DEFAULT_SETTINGS = {
    "belly_goal_cm": "",
    "sleep_min_hours": "7",
    "phone_max_hours": "3",
    "sport_weekly_goal_hours": "3",
    "social_weekly_goal_days": "2",
    "work_weekly_target_hours": "35",
    "work_days_per_week": "5",
    "work_standard_start": "08:30",
    "work_standard_morning_end": "12:30",
    "work_standard_afternoon_start": "13:30",
    "work_standard_end": "17:30",
    "close_relations_label": "Écoute de mes proches",
    "tobacco_stop_date": "",
}

CHECKIN_STEPS = [
    ("Sommeil", "🌙"),
    ("Alcool", "🍷"),
    ("Poids", "⚖️"),
    ("Masse graisseuse", "📉"),
    ("Tour de ventre", "📏"),
    ("Temps de travail", "💼"),
    ("Séances de sport", "🏃"),
    ("Temps de portable", "📱"),
    ("Alimentation", "🍽️"),
    ("Temps pour moi", "🌿"),
    ("Écoute", "👂"),
    ("Suivi social", "🤝"),
    ("Objectifs", "🎯"),
    ("Récapitulatif", "✅"),
]

CHECKIN_DATA_STEP_COUNT = len(CHECKIN_STEPS) - 1
CHECKIN_SUMMARY_STEP = CHECKIN_DATA_STEP_COUNT
CHECKIN_VERSION = 5

SPORT_TYPES = [
    "Course",
    "Vélo",
    "Musculation",
    "Sport collectif",
    "Escalade",
    "Badminton",
    "Autre",
]
