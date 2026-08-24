import unittest

import pandas as pd

from dashboard_charts import calorie_balance_data, social_recurrence_table


class CalorieBalanceTests(unittest.TestCase):
    def test_calculates_net_calories_when_both_values_are_known(self):
        result = calorie_balance_data(pd.DataFrame({
            "entry_date": ["2026-08-09"],
            "kcal": [2100],
            "sport_kcal_burned": [430],
        }))
        self.assertEqual(result.loc[0, "net_kcal"], 1670)

    def test_keeps_net_calories_missing_when_sport_value_is_unknown(self):
        result = calorie_balance_data(pd.DataFrame({
            "entry_date": ["2026-08-09"],
            "kcal": [2100],
        }))
        self.assertTrue(pd.isna(result.loc[0, "net_kcal"]))


class SocialRecurrenceTests(unittest.TestCase):
    def test_interval_column_is_arrow_compatible_text(self):
        logs = pd.DataFrame({
            "name": ["Alice", "Bob", "Bob"],
            "category": ["Amie", "Ami", "Ami"],
            "entry_date": pd.to_datetime(["2026-08-01", "2026-08-01", "2026-08-05"]),
        })

        result = social_recurrence_table(logs)
        values = result["Intervalle moyen entre deux fois"].tolist()

        self.assertTrue(all(isinstance(value, str) for value in values))
        self.assertIn("—", values)
        self.assertIn("4 j", values)


if __name__ == "__main__":
    unittest.main()
