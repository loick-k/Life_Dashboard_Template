import unittest

from app_clock import now_paris, timestamp_paris, today_paris


class ParisClockTests(unittest.TestCase):
    def test_clock_is_timezone_aware_and_consistent(self):
        current = now_paris()
        self.assertIsNotNone(current.tzinfo)
        self.assertEqual(getattr(current.tzinfo, "key", None), "Europe/Paris")
        self.assertEqual(today_paris(), current.date())
        self.assertRegex(timestamp_paris(), r"[+-]\d{2}:\d{2}$")


if __name__ == "__main__":
    unittest.main()
