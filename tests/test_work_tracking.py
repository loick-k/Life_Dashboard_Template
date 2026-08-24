import unittest

import pandas as pd

from work_tracking import (
    compute_work_duration,
    format_signed_duration,
    parse_optional_time,
    work_balance_before_day,
    work_day_balance,
)


class WorkTrackingTests(unittest.TestCase):
    def test_time_formats_are_normalized(self):
        for raw, expected in (("8:30", "08:30"), ("8h30", "08:30"), ("0830", "08:30")):
            errors = []
            self.assertEqual(parse_optional_time(raw, "Début", errors), expected)
            self.assertEqual(errors, [])

    def test_invalid_time_is_rejected(self):
        errors = []
        self.assertIsNone(parse_optional_time("25:10", "Début", errors))
        self.assertTrue(errors)

    def test_complete_day_subtracts_lunch_break(self):
        errors = []
        duration = compute_work_duration("08:30", "12:30", "13:30", "17:30", errors)
        self.assertEqual(duration, 8.0)
        self.assertEqual(errors, [])

    def test_simple_and_half_days(self):
        self.assertEqual(compute_work_duration("09:00", None, None, "17:00", []), 8.0)
        self.assertEqual(compute_work_duration("09:00", "12:00", None, None, []), 3.0)
        self.assertEqual(compute_work_duration(None, None, "14:00", "18:00", []), 4.0)

    def test_incomplete_schedule_is_rejected(self):
        errors = []
        self.assertIsNone(compute_work_duration("09:00", "12:00", "14:00", None, errors))
        self.assertTrue(errors)

    def test_three_complete_slots_are_summed(self):
        errors = []
        duration = compute_work_duration(
            "08:00", "10:00", "10:30", "12:30", errors, "14:00", "15:30"
        )
        self.assertEqual(duration, 5.5)
        self.assertEqual(errors, [])

    def test_incomplete_third_slot_is_saved_but_not_calculated(self):
        errors = []
        duration = compute_work_duration(
            "08:00", "12:00", "13:00", "17:00", errors, "18:00", None
        )
        self.assertIsNone(duration)
        self.assertTrue(errors)

    def test_daily_balance_uses_seven_hours_forty_two(self):
        self.assertEqual(format_signed_duration(work_day_balance(8.0)), "+0h18")
        self.assertEqual(format_signed_duration(work_day_balance(7.5)), "−0h12")
        self.assertEqual(format_signed_duration(work_day_balance(7.7)), "À l’équilibre")

    def test_day_off_has_no_negative_balance(self):
        self.assertEqual(work_day_balance(0, day_off=True), 0)

    def test_balance_before_day_accumulates_only_calculable_days(self):
        entries = pd.DataFrame([
            {"work_duration_hours": 8.0, "work_hours": None, "work_travel": "Bureau"},
            {"work_duration_hours": 7.0, "work_hours": None, "work_travel": "Télétravail"},
            {"work_duration_hours": None, "work_hours": None, "work_travel": "Bureau"},
            {"work_duration_hours": 0.0, "work_hours": None, "work_travel": "Day off"},
        ])
        self.assertAlmostEqual(work_balance_before_day(entries), -0.4)


if __name__ == "__main__":
    unittest.main()
