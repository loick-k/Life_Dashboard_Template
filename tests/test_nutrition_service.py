import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from services.nutrition_service import run_nutrition_analysis


class NutritionServiceTests(unittest.TestCase):
    def test_empty_request_does_not_call_provider(self):
        with patch("services.nutrition_service.analyze_meals") as analyze:
            result = run_nutrition_analysis(date(2026, 9, 15), {}, [], None)
        self.assertEqual(result.level, "info")
        analyze.assert_not_called()

    def test_analysis_is_separate_and_persisted_on_explicit_request(self):
        estimate = SimpleNamespace(
            kcal=1900, sport_kcal_burned=350, proteins_g=110.0,
            carbs_g=210.0, fats_g=65.0, confidence="moyenne",
            assumptions=["portion standard"],
        )
        usage = SimpleNamespace()
        with (
            patch("services.nutrition_service.analyze_meals", return_value=(estimate, usage)) as analyze,
            patch("services.nutrition_service.save_nutrition_analysis") as save_analysis,
            patch("services.nutrition_service.save_api_usage") as save_usage,
        ):
            result = run_nutrition_analysis(
                date(2026, 9, 15), {"dejeuner": "Poulet et riz"}, [], 78,
                api_key="test-key",
            )
        self.assertEqual(result.level, "success")
        self.assertEqual(result.values["kcal"], 1900)
        analyze.assert_called_once()
        save_analysis.assert_called_once()
        save_usage.assert_called_once()


if __name__ == "__main__":
    unittest.main()
