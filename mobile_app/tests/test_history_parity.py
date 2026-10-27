"""Checks real V1 grouping in isolation, without importing Streamlit or Plotly."""
import ast
from datetime import date, timedelta
import json
from pathlib import Path
import unittest

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads((Path(__file__).parent / "fixtures" / "history_metrics.json").read_text(encoding="utf-8"))


class HistoryParityTests(unittest.TestCase):
    def test_shared_period_bounds_are_the_v1_rolling_windows(self):
        for case in CASES["periods"]:
            with self.subTest(case=case):
                expected = date.fromisoformat(case["end"]) - timedelta(days=case["days"] - 1)
                self.assertEqual(expected.isoformat(), case["start"])

    def test_monthly_means_and_sums_match_the_actual_v1_grouping_function(self):
        # Execute only the reviewed pure _group_dates function, not the UI module.
        path = ROOT / "dashboard_charts.py"
        source = ast.parse(path.read_text(encoding="utf-8"))
        function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == "_group_dates")
        namespace = {"pd": pd}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), "exec"), namespace)
        frame = pd.DataFrame(CASES["rows"])
        for key, expected in CASES["monthly"].items():
            with self.subTest(metric=key):
                grouped = namespace["_group_dates"](frame, [key], "month", "sum" if key == "alcohol_glasses" else "mean")
                actual = [None if pd.isna(value) else value for value in grouped[key]]
                self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
