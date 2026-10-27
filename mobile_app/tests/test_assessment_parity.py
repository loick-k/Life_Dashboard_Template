"""Read-only V1 oracle; synthetic fixtures only, no Streamlit, Neon or credentials."""
from datetime import date, timedelta
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import pandas as pd
import dashboard_metrics as v1

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "assessment_scores.json").read_text(encoding="utf-8"))
REFERENCE = date(2026, 10, 26)


class AssessmentParityTests(unittest.TestCase):
    def test_all_shared_score_boundaries_against_actual_v1(self):
        functions = {
            "scoreSleep": v1.score_sleep, "scoreAlcohol": v1.score_alcohol,
            "scoreTobacco": v1.score_tobacco, "scoreSport": v1.score_sport,
            "scorePhone": v1.score_phone, "scoreWork": v1.score_work,
            "scorePositiveTime": v1.score_positive_time, "scoreRating": v1.score_rating,
        }
        for case in FIXTURE["cases"]:
            method, args = case["method"], case["args"]
            with self.subTest(method=method, args=args), patch.object(v1, "today_paris", return_value=REFERENCE):
                if method in functions:
                    actual = functions[method](*args)[0]
                elif method == "scoreNutrition":
                    actual = v1.score_nutrition(pd.DataFrame({"kcal": [2000] * args[0]}))[0]
                elif method == "scoreTracking":
                    tracked, expected, label = args
                    actual = v1.score_tracking(pd.DataFrame({"value": [1] * tracked}), "value", label, expected)[0]
                elif method == "scoreSocial":
                    days, target = args
                    actual = v1.score_social(pd.DataFrame({"entry_date": [REFERENCE - timedelta(days=i) for i in range(days)]}), target)[0]
                elif method == "scoreGoals":
                    worked, total = args
                    actual = v1.score_goals(pd.DataFrame({"entry_date": [REFERENCE - timedelta(days=i) for i in range(total)], "worked": [1] * worked + [0] * (total - worked)}))[0]
                elif method == "scoreBody":
                    belly, weight, fat, goal, trend = args
                    rows = [{"entry_date": REFERENCE, "belly_cm": belly, "weight_kg": weight, "body_fat_pct": fat}]
                    if trend is not None:
                        rows.insert(0, {"entry_date": REFERENCE - timedelta(days=1), "belly_cm": belly - trend, "weight_kg": weight, "body_fat_pct": fat})
                    actual = v1.score_body(pd.DataFrame(rows), goal)[0]
                else:
                    self.fail(f"Unknown oracle {method}")
                self.assertEqual(actual, case["score"])

    def test_global_weighted_score_matches_shared_complete_observation(self):
        case = FIXTURE["global"]
        rows = []
        for raw in case["rows"]:
            row = dict(raw)
            row["entry_date"] = date.fromisoformat(row["entry_date"])
            for target, source in [("phone_hours", "phone_minutes"), ("sport_hours", "sport_minutes"), ("work_duration_hours", "work_duration_minutes")]:
                row[target] = row[source] / 60
            rows.append(row)
        logs = pd.DataFrame({"entry_date": [REFERENCE], "worked": [1]})
        social = pd.DataFrame({"entry_date": [REFERENCE, REFERENCE]})
        with patch.object(v1, "today_paris", return_value=REFERENCE):
            score, _ = v1.global_form_assessment(pd.DataFrame(rows), logs, social, case["settings"])
        self.assertEqual(score, case["score"])


if __name__ == "__main__":
    unittest.main()
