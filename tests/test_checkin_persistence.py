import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import pandas as pd

import data_store
import services.checkin_service as checkin_service
from app_config import CHECKIN_DATA_STEP_COUNT
from checkin.state import _initial_draft
from checkin.steps.body import _persist_measurement_change, flush_pending_body_measurements
from checkin.steps.sport import _persist_sport_duration_change, _persist_sport_widget_change


class FakeSessionState(dict):
    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc

    def __setattr__(self, name, value):
        self[name] = value


class CheckinPersistenceIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = data_store.DB_PATH
        self.original_use_postgres = data_store.USE_POSTGRES
        self.original_database_url = data_store.DATABASE_URL
        data_store.DB_PATH = Path(self.temp_dir.name) / "persistence.sqlite"
        data_store.USE_POSTGRES = False
        data_store.DATABASE_URL = ""
        data_store.init_db.clear()
        data_store.init_db()
        self.selected_date = date(2026, 8, 10)
        self.session_state_patch = patch.object(checkin_service.st, "session_state", {})
        self.session_state_patch.start()

    def tearDown(self):
        self.session_state_patch.stop()
        data_store.init_db.clear()
        data_store.DB_PATH = self.original_db_path
        data_store.USE_POSTGRES = self.original_use_postgres
        data_store.DATABASE_URL = self.original_database_url
        self.temp_dir.cleanup()

    def _create_related_entities(self):
        friend_id = data_store.create_friend("Alice", "Amie")
        data_store.create_goal("Écrire chaque jour")
        conn = data_store.get_conn()
        goal_id = int(conn.execute(
            "SELECT id FROM goals WHERE title = ?", ("Écrire chaque jour",)
        ).fetchone()[0])
        conn.close()
        return friend_id, goal_id

    def _complete_draft(self, friend_id, goal_id):
        draft = _initial_draft(None)
        draft.update({
            "sleep_hours": 7.5,
            "sleep_bedtime": "00:15",
            "sleep_wake_time": "07:45",
            "nap_minutes": 35,
            "alcohol_glasses": 2,
            "weight_kg": 78.4,
            "body_fat_pct": 18.5,
            "belly_cm": 86.5,
            "work_travel": "Télétravail",
            "work_start_time": "08:30",
            "work_morning_end_time": "12:30",
            "work_afternoon_start_time": "13:30",
            "work_end_time": "17:00",
            "work_third_start_time": "18:00",
            "work_third_end_time": "19:00",
            "sport_type": "Course",
            "sport_minutes": 45,
            "sport_sessions": [{
                "sport_type": "Course",
                "duration_minutes": 45,
                "distance_km": 7.2,
            }],
            "phone_hours": 2 + 37 / 60,
            "meal_breakfast": "Yaourt et banane",
            "meal_lunch": "Poulet, riz et légumes",
            "meal_dinner": "Soupe et omelette",
            "meal_other": "Un café",
            "me_time_writing_minutes": 20,
            "me_time_meditation_minutes": 10,
            "me_time_relaxation_minutes": 30,
            "me_time_outings_minutes": 60,
            "self_listening_score": 8,
            "close_relations_listening_score": 9,
            "friend_ids": [friend_id],
            "goals": {goal_id: True},
            "_completed": set(range(CHECKIN_DATA_STEP_COUNT)),
            "_skipped": set(),
        })
        return draft

    def test_complete_day_round_trip_covers_every_indicator(self):
        friend_id, goal_id = self._create_related_entities()
        draft = self._complete_draft(friend_id, goal_id)

        error = checkin_service.save_checkin_bundle(self.selected_date, draft, None)

        self.assertIsNone(error)
        entry = data_store.load_entry(self.selected_date)
        expected_scalars = {
            "sleep_hours": 7.5,
            "sleep_bedtime": "00:15",
            "sleep_wake_time": "07:45",
            "nap_minutes": 35,
            "alcohol_glasses": 2,
            "weight_kg": 78.4,
            "body_fat_pct": 18.5,
            "belly_cm": 86.5,
            "work_travel": "Télétravail",
            "work_duration_hours": 8.5,
            "work_third_start_time": "18:00",
            "work_third_end_time": "19:00",
            "phone_hours": 2 + 37 / 60,
            "meal_breakfast": "Yaourt et banane",
            "meal_lunch": "Poulet, riz et légumes",
            "meal_dinner": "Soupe et omelette",
            "meal_other": "Un café",
            "me_time_writing_minutes": 20,
            "me_time_meditation_minutes": 10,
            "me_time_relaxation_minutes": 30,
            "me_time_outings_minutes": 60,
            "self_listening_score": 8,
            "close_relations_listening_score": 9,
        }
        for field, expected in expected_scalars.items():
            self.assertEqual(entry[field], expected, field)

        sessions = data_store.load_sport_sessions(self.selected_date)
        self.assertEqual(sessions.loc[0, "sport_type"], "Course")
        self.assertEqual(int(sessions.loc[0, "duration_minutes"]), 45)
        self.assertAlmostEqual(float(sessions.loc[0, "distance_km"]), 7.2)
        social = data_store.load_social_logs(self.selected_date)
        self.assertEqual(social["friend_id"].astype(int).tolist(), [friend_id])
        goals = data_store.load_goal_logs(self.selected_date)
        self.assertEqual(goals["goal_id"].astype(int).tolist(), [goal_id])
        self.assertTrue(bool(goals.loc[0, "worked"]))

    def test_partial_autosave_never_erases_previous_indicators(self):
        friend_id, goal_id = self._create_related_entities()
        original = self._complete_draft(friend_id, goal_id)
        self.assertIsNone(checkin_service.save_checkin_bundle(self.selected_date, original, None))

        persisted = data_store.load_entry(self.selected_date)
        partial = _initial_draft(persisted)
        partial["phone_hours"] = 3.25
        partial["_completed"] = {7}
        partial["_skipped"] = set(range(CHECKIN_DATA_STEP_COUNT)) - {7}
        partial["_saving_step"] = 7

        self.assertIsNone(
            checkin_service.save_checkin_bundle(self.selected_date, partial, persisted)
        )

        reloaded = data_store.load_entry(self.selected_date)
        self.assertEqual(reloaded["phone_hours"], 3.25)
        self.assertEqual(reloaded["weight_kg"], 78.4)
        self.assertEqual(reloaded["body_fat_pct"], 18.5)
        self.assertEqual(reloaded["belly_cm"], 86.5)
        self.assertEqual(reloaded["sleep_bedtime"], "00:15")
        sessions = data_store.load_sport_sessions(self.selected_date)
        self.assertAlmostEqual(float(sessions.loc[0, "distance_km"]), 7.2)
        self.assertEqual(len(data_store.load_social_logs(self.selected_date)), 1)
        self.assertEqual(len(data_store.load_goal_logs(self.selected_date)), 1)

    def test_isolated_work_times_are_saved_and_can_be_completed_later(self):
        morning = _initial_draft(None)
        morning.update({
            "work_travel": "Bureau",
            "work_start_time": "08:17",
            "_saving_step": 5,
            "_completed": set(),
            "_skipped": set(),
        })

        self.assertIsNone(checkin_service.save_checkin_bundle(self.selected_date, morning, None))
        saved_morning = data_store.load_entry(self.selected_date)
        self.assertEqual(saved_morning["work_start_time"], "08:17")
        self.assertIsNone(saved_morning["work_duration_hours"])

        later = _initial_draft(saved_morning)
        later.update({
            "work_morning_end_time": "12:05",
            "work_afternoon_start_time": "13:10",
            "_saving_step": 5,
            "_completed": set(),
            "_skipped": set(),
        })
        self.assertIsNone(checkin_service.save_checkin_bundle(self.selected_date, later, saved_morning))
        saved_later = data_store.load_entry(self.selected_date)
        self.assertEqual(saved_later["work_start_time"], "08:17")
        self.assertEqual(saved_later["work_morning_end_time"], "12:05")
        self.assertEqual(saved_later["work_afternoon_start_time"], "13:10")
        self.assertIsNone(saved_later["work_duration_hours"])


class PersistenceRetryTests(unittest.TestCase):
    def test_navigation_flushes_weight_before_date_change(self):
        selected_date = date(2026, 8, 11)
        draft_key = f"checkin_draft_{selected_date.isoformat()}"
        state = FakeSessionState({
            "active_checkin_date": selected_date.isoformat(),
            draft_key: {
                "weight_kg": None,
                "body_fat_pct": None,
                "belly_cm": None,
                "_completed": set(),
                "_skipped": set(),
            },
            f"body_weight_{selected_date}": "77,8",
        })
        saved = {}

        def fake_save(_date, draft, _existing):
            saved.update({"weight_kg": draft["weight_kg"]})
            return None

        def fake_load(_date):
            return saved.copy()

        with patch("checkin.steps.body.st.session_state", state):
            error = flush_pending_body_measurements(fake_save, fake_load)

        self.assertIsNone(error)
        self.assertEqual(saved["weight_kg"], 77.8)
        self.assertIn(2, state[draft_key]["_completed"])
        self.assertEqual(state[f"measurement_saved_value_{selected_date}_2"], 77.8)

    def test_measurement_retries_when_first_readback_is_missing(self):
        selected_date = date(2026, 8, 10)
        draft_key = "draft"
        widget_key = "weight"
        state = FakeSessionState({
            draft_key: {"_completed": set(), "_skipped": set()},
            widget_key: "78,4",
        })
        save_calls = []
        read_calls = []

        def fake_save(*_args):
            save_calls.append(True)
            return None

        def fake_load(_selected_date):
            read_calls.append(True)
            return {} if len(read_calls) == 1 else {"weight_kg": 78.4}

        with (
            patch("checkin.steps.body.st.session_state", state),
            patch("checkin.steps.body.time.sleep"),
        ):
            _persist_measurement_change(
                fake_save, fake_load, selected_date, draft_key, None, 2,
                "weight_kg", widget_key, "Poids", 30, 250,
            )

        self.assertEqual(len(save_calls), 2)
        self.assertEqual(len(read_calls), 2)
        self.assertIsNone(state[f"measurement_save_error_{selected_date}_2"])
        self.assertEqual(state[draft_key]["weight_kg"], 78.4)

    def test_sport_distance_retries_until_database_confirms_value(self):
        selected_date = date(2026, 8, 10)
        draft_key = "draft"
        widget_key = "distance"
        state = FakeSessionState({
            draft_key: {
                "sport_sessions": [{
                    "sport_type": "Course",
                    "duration_minutes": 45,
                    "distance_km": None,
                }],
                "_completed": set(),
                "_skipped": set(),
            },
            widget_key: "7,2",
        })
        save_calls = []
        read_calls = []

        def fake_save(*_args):
            save_calls.append(True)
            return None

        def fake_load(_selected_date):
            read_calls.append(True)
            distance = None if len(read_calls) == 1 else 7.2
            return pd.DataFrame([{
                "sport_type": "Course",
                "duration_minutes": 45,
                "distance_km": distance,
            }])

        with (
            patch("checkin.steps.sport.st.session_state", state),
            patch("checkin.steps.sport.time.sleep"),
        ):
            _persist_sport_widget_change(
                fake_save, fake_load, selected_date, draft_key, None, 0,
                "distance_km", widget_key,
            )

        self.assertEqual(len(save_calls), 2)
        self.assertEqual(len(read_calls), 2)
        self.assertIsNone(state[f"sport_save_error_{selected_date}_0"])
        self.assertEqual(state[draft_key]["sport_sessions"][0]["distance_km"], 7.2)

    def test_precise_sport_duration_is_saved_in_minutes(self):
        selected_date = date(2026, 8, 24)
        draft_key = "draft"
        hours_key = "sport_hours"
        minutes_key = "sport_minutes"
        total_key = "sport_total"
        state = FakeSessionState({
            draft_key: {
                "sport_sessions": [{
                    "sport_type": "Course",
                    "duration_minutes": 0,
                    "distance_km": 7.2,
                }],
                "_completed": set(),
                "_skipped": set(),
            },
            hours_key: 1,
            minutes_key: 37,
        })
        saved_durations = []

        def fake_save(_selected_date, draft, _existing):
            saved_durations.append(draft["sport_sessions"][0]["duration_minutes"])
            return None

        def fake_load(_selected_date):
            return pd.DataFrame([{
                "sport_type": "Course",
                "duration_minutes": 97,
                "distance_km": 7.2,
            }])

        with patch("checkin.steps.sport.st.session_state", state):
            _persist_sport_duration_change(
                fake_save, fake_load, selected_date, draft_key, None, 0,
                hours_key, minutes_key, total_key,
            )

        self.assertEqual(saved_durations, [97])
        self.assertEqual(state[draft_key]["sport_sessions"][0]["duration_minutes"], 97)
        self.assertEqual(state[draft_key]["sport_minutes"], 97)
        self.assertIsNone(state[f"sport_save_error_{selected_date}_0"])


if __name__ == "__main__":
    unittest.main()
