"""Run the real pure V1 recurrence function, with a synthetic Paris date only."""
import ast
from datetime import date
import json
from pathlib import Path
import unittest

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads((Path(__file__).parent / "fixtures" / "catalog_history.json").read_text(encoding="utf-8"))


class CatalogHistoryParityTests(unittest.TestCase):
    def test_shared_rounding_preserves_python_float_ties_to_even(self):
        for case in CASES["rounding"]:
            with self.subTest(value=case["value"]):
                self.assertEqual(round(case["value"], 1), case["expected"])

    def test_shared_recurrence_matches_actual_v1_function(self):
        path = ROOT / "dashboard_charts.py"
        source = ast.parse(path.read_text(encoding="utf-8"))
        function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == "social_recurrence_table")
        for case in CASES["recurrence"]:
            with self.subTest(name=case["name"]):
                namespace = {"pd": pd, "today_paris": lambda: date.fromisoformat(case["end"])}
                exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), "exec"), namespace)
                frame = pd.DataFrame([{"name": case["name"], "category": "Ami", "entry_date": day} for day in case["dates"]])
                row = namespace["social_recurrence_table"](frame).iloc[0]
                self.assertEqual(int(row["Nombre de fois vue"]), len(case["dates"]))
                self.assertEqual(row["Dernière fois"], date.fromisoformat(case["dates"][-1]).strftime("%d/%m/%Y"))
                self.assertEqual(int(row["Jours depuis"]), case["daysSince"])
                interval = case["averageInterval"]
                self.assertEqual(row["Intervalle moyen entre deux fois"], "—" if interval is None else f"{interval:g} j")


if __name__ == "__main__":
    unittest.main()
