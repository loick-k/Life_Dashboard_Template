import unittest
from datetime import date

import pandas as pd

from dashboard_metrics import global_form_assessment, week_bounds


class WeeklyAssessmentTests(unittest.TestCase):
    def test_assessment_uses_current_week_and_keeps_missing_alcohol_missing(self):
        monday, _ = week_bounds(date.today())
        entries = pd.DataFrame([
            {
                "entry_date": monday,
                "sleep_hours": 8,
                "alcohol_glasses": None,
                "sport_hours": 1,
                "phone_hours": 2,
                "work_duration_hours": 7,
                "weight_kg": 78,
                "body_fat_pct": 18,
                "belly_cm": 85,
                "me_time_writing_minutes": 30,
                "me_time_meditation_minutes": 10,
                "me_time_relaxation_minutes": 30,
                "me_time_outings_minutes": 30,
                "self_listening_score": 8,
                "close_relations_listening_score": 7,
            }
        ])
        score, details = global_form_assessment(
            entries, pd.DataFrame(), pd.DataFrame(), {}
        )
        self.assertIsNotNone(score)
        self.assertGreaterEqual(len(details), 21)
        self.assertNotIn("Tabac", details["Indicateur de la semaine"].tolist())
        alcohol = details.loc[details["Indicateur de la semaine"] == "Alcool", "Score"].iloc[0]
        self.assertTrue(pd.isna(alcohol))

    def test_optional_tobacco_date_enables_indicator(self):
        score, details = global_form_assessment(
            pd.DataFrame(), pd.DataFrame(), pd.DataFrame(),
            {"tobacco_stop_date": "2026-01-01"},
        )
        self.assertIsNotNone(score)
        self.assertIn("Tabac", details["Indicateur de la semaine"].tolist())


if __name__ == "__main__":
    unittest.main()
