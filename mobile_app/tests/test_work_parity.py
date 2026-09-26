"""V1 domain oracle over the same synthetic fixtures used by TypeScript."""
import json
from pathlib import Path
import unittest

from domain.work import work_balance_minutes


class WorkParityTests(unittest.TestCase):
    def test_shared_balance_cases(self):
        cases = json.loads((Path(__file__).parent / "fixtures" / "work_balance.json").read_text())
        for case in cases:
            with self.subTest(case=case):
                self.assertEqual(
                    work_balance_minutes(case["minutes"], day_off=case["day_off"]),
                    case["balance"],
                )
