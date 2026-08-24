import unittest
from unittest.mock import MagicMock, patch

import httpx
from openai import AuthenticationError, RateLimitError

from nutrition_analysis import (
    NUTRITION_MODEL,
    NutritionAnalysisUnavailable,
    NutritionEstimate,
    analyze_meals,
    nutrition_source_hash,
    _load_openai_sdk,
)


OPENAI_SDK = _load_openai_sdk()


class NutritionAnalysisTests(unittest.TestCase):
    def test_hash_ignores_case_and_extra_spaces(self):
        first = nutrition_source_hash({"dejeuner": "  Poulet   RIZ "})
        second = nutrition_source_hash({"dejeuner": "poulet riz"})
        self.assertEqual(first, second)

    @patch("nutrition_analysis._load_openai_sdk")
    @patch("nutrition_analysis.get_openai_api_key", return_value="test-key")
    def test_structured_estimate(self, _get_key, sdk_loader):
        estimate = NutritionEstimate(
            kcal=2100,
            sport_kcal_burned=450,
            proteins_g=100,
            carbs_g=240,
            fats_g=75,
            confidence="moyenne",
            assumptions=["Une assiette standard"],
        )
        client = MagicMock()
        client.responses.parse.return_value.output_parsed = estimate
        sdk = OPENAI_SDK.copy()
        sdk["OpenAI"] = MagicMock(return_value=client)
        sdk_loader.return_value = sdk

        sessions = [{"sport_type": "Course", "duration_minutes": 45, "distance_km": 7.2}]
        result, usage = analyze_meals({"dejeuner": "Poulet et riz"}, sessions, 78.4)

        self.assertEqual(result.kcal, 2100)
        self.assertEqual(result.sport_kcal_burned, 450)
        self.assertEqual(usage.cost_eur, 0)
        call = client.responses.parse.call_args.kwargs
        self.assertEqual(call["model"], NUTRITION_MODEL)
        self.assertEqual(call["text_format"], NutritionEstimate)
        self.assertIn("une portion adulte standard", call["input"][0]["content"])
        self.assertIn("sport_kcal_burned", call["input"][0]["content"])
        self.assertIn("Course", call["input"][1]["content"])
        self.assertIn("78.4", call["input"][1]["content"])

    def test_hash_changes_with_sport(self):
        meals = {"dejeuner": "Poulet et riz"}
        without_sport = nutrition_source_hash(meals)
        with_sport = nutrition_source_hash(
            meals, [{"sport_type": "Course", "duration_minutes": 45, "distance_km": 7.2}], 78.4
        )
        self.assertNotEqual(without_sport, with_sport)

    @patch("nutrition_analysis._load_openai_sdk")
    @patch("nutrition_analysis.get_openai_api_key", return_value="test-key")
    def test_missing_api_credits_are_explained(self, _get_key, sdk_loader):
        response = httpx.Response(
            429,
            request=httpx.Request("POST", "https://api.openai.com/v1/responses"),
            json={"error": {"code": "insufficient_quota"}},
        )
        client = MagicMock()
        client.responses.parse.side_effect = RateLimitError(
            "quota",
            response=response,
            body={"code": "insufficient_quota"},
        )
        sdk = OPENAI_SDK.copy()
        sdk["OpenAI"] = MagicMock(return_value=client)
        sdk_loader.return_value = sdk

        with self.assertRaisesRegex(NutritionAnalysisUnavailable, "crédits"):
            analyze_meals({"dejeuner": "Poulet et riz"})

    @patch("nutrition_analysis._load_openai_sdk")
    @patch("nutrition_analysis.get_openai_api_key", return_value="test-key")
    def test_quota_type_in_body_is_explained(self, _get_key, sdk_loader):
        response = httpx.Response(
            429,
            request=httpx.Request("POST", "https://api.openai.com/v1/responses"),
        )
        client = MagicMock()
        client.responses.parse.side_effect = RateLimitError(
            "quota",
            response=response,
            body={"type": "insufficient_quota"},
        )
        sdk = OPENAI_SDK.copy()
        sdk["OpenAI"] = MagicMock(return_value=client)
        sdk_loader.return_value = sdk

        with self.assertRaisesRegex(NutritionAnalysisUnavailable, "crédit API"):
            analyze_meals({"dejeuner": "Poulet et riz"})

    @patch("nutrition_analysis._load_openai_sdk")
    @patch("nutrition_analysis.get_openai_api_key", return_value="test-key")
    def test_invalid_api_key_is_explained(self, _get_key, sdk_loader):
        response = httpx.Response(
            401,
            request=httpx.Request("POST", "https://api.openai.com/v1/responses"),
        )
        client = MagicMock()
        client.responses.parse.side_effect = AuthenticationError(
            "invalid key",
            response=response,
            body=None,
        )
        sdk = OPENAI_SDK.copy()
        sdk["OpenAI"] = MagicMock(return_value=client)
        sdk_loader.return_value = sdk

        with self.assertRaisesRegex(NutritionAnalysisUnavailable, "clé OpenAI"):
            analyze_meals({"dejeuner": "Poulet et riz"})


if __name__ == "__main__":
    unittest.main()
