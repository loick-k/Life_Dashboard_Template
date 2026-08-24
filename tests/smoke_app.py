import os
import sqlite3
import sys
import tempfile
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
temp_dir = tempfile.mkdtemp(prefix="life-dashboard-audit-")
os.chdir(temp_dir)

from streamlit.testing.v1 import AppTest

from app_config import CHECKIN_DATA_STEP_COUNT, CHECKIN_SUMMARY_STEP


def assert_clean(at, label):
    if at.exception:
        details = "; ".join(str(item.value) for item in at.exception)
        raise AssertionError(f"{label}: {details}")
    print(f"OK {label}")


def assert_no_quick_dates(at, label):
    quick_date_keys = {"mobile_nav_today", "mobile_nav_yesterday"}
    visible = [button.key for button in at.button if button.key in quick_date_keys]
    if visible:
        raise AssertionError(f"{label}: boutons de date encore visibles ({visible!r})")


app = AppTest.from_file(str(ROOT / "app_life_dashboard_v4.py"), default_timeout=30)
app.run()
assert_clean(app, "accueil")

app.session_state["main_navigation"] = "Courbes"
app.run()
assert_clean(app, "courbes sans données")
assert_no_quick_dates(app, "courbes")
app.session_state["main_navigation"] = "Todo"
app.run()
assert_clean(app, "configuration Todoist sans jeton")
app.session_state["main_navigation"] = "Aujourd'hui"
app.run()

for step in range(CHECKIN_DATA_STEP_COUNT):
    app.session_state["checkin_step"] = step
    app.session_state["checkin_show_home"] = False
    app.run()
    assert_clean(app, f"étape {step + 1}")

# A field change must reach the database without pressing Continue.
app.session_state["checkin_step"] = 2
app.session_state["checkin_show_home"] = False
app.run()
weight_inputs = [item for item in app.text_input if item.label == "Poids en kg"]
if not weight_inputs:
    raise AssertionError("autosauvegarde immédiate: champ poids introuvable")
weight_inputs[0].set_value("78,4")
app.run()
with sqlite3.connect("life_dashboard.sqlite") as autosave_conn:
    autosaved_weight = autosave_conn.execute(
        "SELECT weight_kg FROM daily_entries WHERE entry_date = ?",
        (date.today().isoformat(),),
    ).fetchone()
if autosaved_weight != (78.4,):
    raise AssertionError(f"autosauvegarde immédiate: poids non sauvegardé ({autosaved_weight!r})")
print("OK autosauvegarde immédiate sans Continuer")

app.session_state["checkin_step"] = CHECKIN_SUMMARY_STEP
app.session_state["checkin_show_home"] = False
app.run()
assert_clean(app, "récapitulatif")

# Complete the whole default journey and exercise every autosave.
app.session_state["checkin_step"] = 0
app.session_state["checkin_show_home"] = False
app.run()
for expected_step in range(CHECKIN_DATA_STEP_COUNT):
    if expected_step == 0:
        bedtime_selects = [item for item in app.selectbox if item.label == "Heure de coucher de la veille"]
        if not bedtime_selects:
            raise AssertionError("sommeil: sélecteur de coucher introuvable")
        bedtime_selects[0].select("00:30")
        nap_checks = [item for item in app.checkbox if item.label == "J’ai fait une sieste"]
        if not nap_checks:
            raise AssertionError("sommeil: option de sieste introuvable")
        nap_checks[0].check()
        app.run()
        nap_durations = [item for item in app.selectbox if item.label == "Durée de la sieste"]
        if not nap_durations:
            raise AssertionError("sommeil: durée de sieste introuvable")
        nap_durations[0].select(45)
        app.run()
    if expected_step in (2, 3, 4):
        measurement_values = {2: "78,4", 3: "18.5", 4: "86,5"}
        measurement_labels = {2: "Poids en kg", 3: "Masse graisseuse en %", 4: "Tour de ventre en cm"}
        measurement_inputs = [
            item for item in app.text_input if item.label == measurement_labels[expected_step]
        ]
        if not measurement_inputs:
            raise AssertionError(f"étape {expected_step + 1}: champ de mesure introuvable")
        measurement_inputs[-1].set_value(measurement_values[expected_step])
    if expected_step == 6:
        add_sport_buttons = [item for item in app.button if item.label == "＋ Ajouter une séance"]
        if not add_sport_buttons:
            raise AssertionError("sport: bouton Ajouter une séance introuvable")
        add_sport_buttons[0].click()
        app.run()
        duration_inputs = [item for item in app.selectbox if item.label == "Durée (minutes)"]
        distance_inputs = [item for item in app.text_input if item.label == "Distance (km)"]
        if not duration_inputs or not distance_inputs:
            raise AssertionError("sport: durée ou distance introuvable après ajout")
        duration_inputs[-1].select(45)
        distance_inputs[-1].set_value("7,2")
        app.run()
        assert_clean(app, "saisie d'une séance sportive")
        sport_draft = app.session_state[f"checkin_draft_{date.today().isoformat()}"]["sport_sessions"]
        if sport_draft != [{"sport_type": "Course", "duration_minutes": 45, "distance_km": 7.2}]:
            raise AssertionError(f"sport: brouillon non synchronisé : {sport_draft}")
    if expected_step == 8 and app.text_area:
        app.text_area[0].set_value("Un bol de yaourt avec une banane")
    if expected_step == 9:
        outings_minutes = [
            item for item in app.number_input
            if item.key == f"me_time_outings_minutes_minutes_{date.today()}"
        ]
        if not outings_minutes:
            raise AssertionError("temps pour moi: durée Sorties introuvable")
        outings_minutes[0].set_value(45)
        app.run()
        expected_total_key = f"me_time_total_{date.today()}"
        actual_total = app.session_state[expected_total_key]
        if actual_total != 45:
            raise AssertionError(
                "temps pour moi: le total ne s'actualise pas immédiatement "
                f"({actual_total!r})"
            )
        print("OK actualisation immédiate du total Temps pour moi")
    continue_buttons = [
        button
        for button in app.button
        if button.label.startswith(("Continuer", "Voir le récapitulatif"))
    ]
    if not continue_buttons:
        raise AssertionError(f"étape {expected_step + 1}: bouton Continuer introuvable")
    keyed_continue = [
        button for button in continue_buttons if button.key == f"continue_{expected_step}"
    ]
    # Les callbacks des mesures peuvent laisser un ancien fragment dans AppTest.
    # La clé d'étape est prioritaire ; les formulaires courants sont en fin d'arbre.
    (keyed_continue[-1] if keyed_continue else continue_buttons[-1]).click()
    app.run()
    assert_clean(app, f"autosauvegarde {expected_step + 1}")
    expected_next = expected_step + 1
    actual_next = app.session_state["checkin_step"]
    if actual_next != expected_next:
        raise AssertionError(
            f"autosauvegarde {expected_step + 1}: étape attendue {expected_next}, obtenue {actual_next}; "
            f"erreurs affichées: {[item.value for item in app.error]}"
        )

if app.session_state["checkin_step"] != CHECKIN_SUMMARY_STEP:
    raise AssertionError(
        f"le parcours complet n'aboutit pas au récapitulatif: étape {app.session_state['checkin_step']}"
    )

conn = sqlite3.connect("life_dashboard.sqlite")
saved_body = conn.execute(
    "SELECT sleep_bedtime, nap_minutes, weight_kg, body_fat_pct, belly_cm FROM daily_entries WHERE entry_date = ?",
    (date.today().isoformat(),),
).fetchone()
conn.close()
if saved_body != ("00:30", 45, 78.4, 18.5, 86.5):
    raise AssertionError(f"mesures corporelles ou coucher mal enregistrés : {saved_body}")
print("OK coucher après minuit et mesures corporelles")

# Une nouvelle session, équivalente à un redémarrage du téléphone, doit relire Neon/SQLite.
reloaded_app = AppTest.from_file(str(ROOT / "app_life_dashboard_v4.py"), default_timeout=30)
reloaded_app.run()
reloaded_app.session_state["main_navigation"] = "Aujourd'hui"
reloaded_app.session_state["checkin_step"] = 2
reloaded_app.session_state["checkin_show_home"] = False
reloaded_app.run()
reloaded_weight = [item.value for item in reloaded_app.text_input if item.label == "Poids en kg"]
if reloaded_weight != ["78,4"]:
    raise AssertionError(f"redémarrage: poids non relu ({reloaded_weight!r})")
reloaded_app.session_state["checkin_step"] = 3
reloaded_app.run()
reloaded_body_fat = [item.value for item in reloaded_app.text_input if item.label == "Masse graisseuse en %"]
if reloaded_body_fat != ["18,5"]:
    raise AssertionError(f"redémarrage: TMG non relu ({reloaded_body_fat!r})")
reloaded_app.session_state["checkin_step"] = 6
reloaded_app.run()
reloaded_distances = [item.value for item in reloaded_app.text_input if item.label == "Distance (km)"]
reloaded_durations = [item.value for item in reloaded_app.selectbox if item.label == "Durée (minutes)"]
if reloaded_distances != ["7,2"] or reloaded_durations != [45]:
    raise AssertionError(
        f"redémarrage: séance de course non relue "
        f"(distance={reloaded_distances!r}, durée={reloaded_durations!r})"
    )
print("OK poids, TMG et course après redémarrage de session")
conn = sqlite3.connect("life_dashboard.sqlite")
saved_outings = conn.execute(
    "SELECT me_time_outings_minutes FROM daily_entries WHERE entry_date = ?",
    (date.today().isoformat(),),
).fetchone()
conn.close()
if saved_outings != (45,):
    raise AssertionError(f"temps pour moi: durée Sorties mal enregistrée ({saved_outings!r})")
print("OK sauvegarde du temps de sorties")

# A stale Streamlit context must never erase measurements already persisted.
selected_iso = date.today().isoformat()
draft_key = f"checkin_draft_{selected_iso}"
context_key = f"checkin_context_{selected_iso}"
app.session_state[context_key]["existing"] = None
app.session_state[draft_key]["weight_kg"] = None
app.session_state[draft_key]["body_fat_pct"] = None
app.session_state[draft_key]["_completed"].difference_update({2, 3})
app.session_state[draft_key]["_skipped"].update({2, 3})
app.session_state["checkin_step"] = 1
app.session_state["checkin_show_home"] = False
app.run()
continue_alcohol = [item for item in app.button if item.label == "Continuer →"]
if not continue_alcohol:
    raise AssertionError("régression mesures: bouton Continuer introuvable")
continue_alcohol[0].click()
app.run()
conn = sqlite3.connect("life_dashboard.sqlite")
preserved_body = conn.execute(
    "SELECT weight_kg, body_fat_pct, belly_cm FROM daily_entries WHERE entry_date = ?",
    (selected_iso,),
).fetchone()
conn.close()
if preserved_body != (78.4, 18.5, 86.5):
    raise AssertionError(f"régression mesures: une sauvegarde ultérieure a effacé {preserved_body}")
print("OK préservation des mesures après contexte obsolète")

# Returning to a date must replace stale widget text with persisted measurements.
app.session_state[f"body_weight_{selected_iso}"] = ""
app.session_state[f"body_fat_{selected_iso}"] = ""
app.session_state["active_checkin_date"] = "2026-08-08"
app.session_state["checkin_show_home"] = True
app.run()
if app.session_state[f"body_weight_{selected_iso}"] != "78,4":
    raise AssertionError("régression poids: le widget n'a pas été resynchronisé")
if app.session_state[f"body_fat_{selected_iso}"] != "18,5":
    raise AssertionError("régression TMG: le widget n'a pas été resynchronisé")
print("OK resynchronisation des champs de mesures")

# Back has the same persistence guarantee as Continue on every data step.
app.session_state["checkin_step"] = 3
app.session_state["checkin_show_home"] = False
app.run()
tmg_inputs = [item for item in app.text_input if item.label == "Masse graisseuse en %"]
back_buttons = [item for item in app.button if item.label == "← Retour"]
if not tmg_inputs or not back_buttons:
    raise AssertionError("retour autosauvegardé: champ TMG ou bouton Retour introuvable")
tmg_inputs[0].set_value("19,7")
back_buttons[0].click()
app.run()
conn = sqlite3.connect("life_dashboard.sqlite")
saved_tmg_after_back = conn.execute(
    "SELECT body_fat_pct FROM daily_entries WHERE entry_date = ?",
    (selected_iso,),
).fetchone()
conn.close()
if saved_tmg_after_back != (19.7,):
    raise AssertionError(f"retour autosauvegardé: TMG perdu ({saved_tmg_after_back!r})")
print("OK autosauvegarde du TMG avec Retour")

conn = sqlite3.connect("life_dashboard.sqlite")
saved_sport = conn.execute(
    "SELECT sport_type, duration_minutes, distance_km FROM sport_sessions WHERE entry_date = ?",
    (date.today().isoformat(),),
).fetchone()
conn.close()
if saved_sport != ("Course", 45, 7.2):
    raise AssertionError(f"séance sportive mal enregistrée : {saved_sport}")
print("OK durée et distance sportives")
from nutrition_analysis import NutritionEstimate
import data_store

test_estimate = NutritionEstimate(
    kcal=2100,
    sport_kcal_burned=430,
    proteins_g=100,
    carbs_g=240,
    fats_g=75,
    confidence="moyenne",
    assumptions=["Test"],
)
data_store.save_nutrition_analysis(date.today(), test_estimate, "test-hash", "test-model")
conn = sqlite3.connect("life_dashboard.sqlite")
saved_burned_kcal = conn.execute(
    "SELECT sport_kcal_burned FROM daily_entries WHERE entry_date = ?",
    (date.today().isoformat(),),
).fetchone()
conn.close()
if saved_burned_kcal != (430,):
    raise AssertionError(f"kcal sportives mal enregistrées : {saved_burned_kcal}")
print("OK kcal dépensées par le sport")

# Delete one completed response and ensure that zero is not kept as a value.
app.session_state["checkin_step"] = 1
app.session_state["checkin_show_home"] = False
app.run()
delete_confirmations = [item for item in app.checkbox if item.label == "Je confirme la suppression"]
if not delete_confirmations:
    raise AssertionError("suppression: confirmation introuvable sur une étape renseignée")
delete_confirmations[0].check()
app.run()
delete_buttons = [item for item in app.button if item.label == "Supprimer cette donnée"]
if not delete_buttons:
    raise AssertionError("suppression: bouton introuvable")
delete_buttons[0].click()
app.run()
assert_clean(app, "suppression d'une donnée")
conn = sqlite3.connect("life_dashboard.sqlite")
deleted_alcohol = conn.execute(
    "SELECT alcohol_glasses FROM daily_entries WHERE entry_date = ?",
    (date.today().isoformat(),),
).fetchone()
conn.close()
if deleted_alcohol is None or deleted_alcohol[0] is not None:
    raise AssertionError(f"suppression: valeur alcool encore enregistrée: {deleted_alcohol}")

# Schema initialization removes a technical row that has no business data left.
import data_store

conn = sqlite3.connect("life_dashboard.sqlite")
conn.execute(
    """INSERT OR REPLACE INTO daily_entries
       (entry_date, checkin_completed_steps, checkin_skipped_steps, checkin_finished, checkin_version, updated_at)
       VALUES ('2026-07-02', '[]', '[]', 0, 3, ?)""",
    (datetime.now().isoformat(timespec="seconds"),),
)
conn.execute(
    "DELETE FROM schema_migrations WHERE migration_id = '20260809_001_current_schema'"
)
conn.commit()
conn.close()
data_store.init_db.clear()
data_store.init_db()
conn = sqlite3.connect("life_dashboard.sqlite")
orphan = conn.execute(
    "SELECT entry_date FROM daily_entries WHERE entry_date = '2026-07-02'"
).fetchone()
conn.close()
if orphan is not None:
    raise AssertionError(f"nettoyage: ligne quotidienne vide encore présente: {orphan}")
print("OK nettoyage d'une ligne vide")

# Exercise chart and recurrence branches with isolated fake data.
today = date.today().isoformat()
conn = sqlite3.connect("life_dashboard.sqlite")
conn.execute(
    """INSERT OR REPLACE INTO daily_entries
       (entry_date, alcohol_glasses, sleep_hours, work_hours, belly_cm,
        body_fat_pct, sport_hours, phone_hours, weight_kg, work_travel, updated_at)
       VALUES (?, 0, 7.5, 8, 90, 20, 1, 2, 78, 'Bureau', ?)""",
    (today, datetime.now().isoformat(timespec="seconds")),
)
conn.execute(
    "INSERT INTO friends (name, category, active, created_at) VALUES ('Test', 'Ami', 1, ?)",
    (datetime.now().isoformat(timespec="seconds"),),
)
friend_id = conn.execute("SELECT id FROM friends WHERE name = 'Test'").fetchone()[0]
conn.execute(
    """INSERT INTO social_logs
       (entry_date, friend_id, context, duration_hours, note, updated_at)
       VALUES (?, ?, 'Vu en personne', NULL, '', ?)""",
    (today, friend_id, datetime.now().isoformat(timespec="seconds")),
)
conn.commit()
conn.close()

data_store.load_friends.clear()
app.session_state["main_navigation"] = "Aujourd'hui"
app.session_state["checkin_step"] = 11
app.session_state["checkin_show_home"] = False
app.run()
assert_clean(app, "social avec une personne")

social_name_inputs = [item for item in app.text_input if item.label == "Nom"]
add_social_buttons = [item for item in app.button if item.label == "Ajouter et sélectionner"]
if not social_name_inputs or not add_social_buttons:
    raise AssertionError("social: formulaire d'ajout d'une relation introuvable")
social_name_inputs[0].set_value("Nouvelle relation")
add_social_buttons[0].click()
app.run()
assert_clean(app, "ajout immédiat d'une relation")
people_selects = [item for item in app.multiselect if item.label == "Personnes"]
if not people_selects or "Nouvelle relation" not in people_selects[0].options:
    raise AssertionError("social: la nouvelle relation n'apparaît pas dans la liste sans actualisation")
if len(people_selects[0].value) < 1:
    raise AssertionError("social: la nouvelle relation n'est pas sélectionnée automatiquement")
print("OK ajout et sélection immédiate d'une relation")

app.session_state["main_navigation"] = "Courbes"
app.run()
assert_clean(app, "courbes avec données")
for period in ("7 jours", "1 mois", "1 an", "Depuis le début"):
    app.session_state["dashboard_period"] = period
    app.run()
    assert_clean(app, f"courbes/{period}")

for section in ("Social", "Objectifs & critères", "Données", "Performance"):
    app.session_state["main_navigation"] = "Réglages"
    app.session_state["settings_navigation"] = section
    app.run()
    assert_clean(app, f"réglages/{section}")
    assert_no_quick_dates(app, f"réglages/{section}")
