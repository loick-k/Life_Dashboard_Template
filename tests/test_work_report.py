import unittest
from datetime import date

import pandas as pd
from pypdf import PdfReader

from work_report import build_work_report


class WorkReportTests(unittest.TestCase):
    def test_report_contains_requested_sections(self):
        entries = pd.DataFrame([
            {
                "entry_date": date(2026, 8, 24),
                "work_travel": "Bureau",
                "work_start_time": "08:30",
                "work_morning_end_time": "12:30",
                "work_afternoon_start_time": "13:30",
                "work_end_time": "17:30",
                "work_duration_hours": 8.0,
                "work_hours": 8.0,
            },
            {
                "entry_date": date(2026, 8, 25),
                "work_travel": "Télétravail",
                "work_start_time": "08:45",
                "work_morning_end_time": "12:15",
                "work_afternoon_start_time": "13:15",
                "work_end_time": "17:15",
                "work_duration_hours": 7.5,
                "work_hours": 7.5,
            },
        ])

        content = build_work_report(entries, date(2026, 8, 28))
        self.assertTrue(content.startswith(b"%PDF"))
        reader = PdfReader(__import__("io").BytesIO(content))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        self.assertIn("Compteur cumulé", text)
        self.assertIn("Types de journée", text)
        self.assertIn("Détail de la semaine", text)
        self.assertIn("Durée de travail", text)


if __name__ == "__main__":
    unittest.main()
