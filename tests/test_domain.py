import unittest
from datetime import date

from pydantic import ValidationError

from domain.models import DailyCheckinPatch, Meals, SportSession, WorkSchedule
from domain.nutrition import nutrition_source_hash
from domain.work import work_balance_minutes, work_duration_minutes


class DomainTests(unittest.TestCase):
    def test_domain_modules_do_not_import_streamlit(self):
        import domain.models as models
        import domain.nutrition as nutrition
        import domain.work as work
        for module in (models, nutrition, work):
            self.assertNotIn("streamlit", module.__dict__)

    def test_work_schedule_normalizes_and_computes_three_slots(self):
        schedule = WorkSchedule(start_time="8h15", morning_end_time="12:00", afternoon_start_time="13.00", end_time="17:00", third_start_time="1830", third_end_time="19:15")
        self.assertEqual(schedule.start_time, "08:15")
        self.assertEqual(work_duration_minutes(schedule), 510)
        self.assertEqual(work_balance_minutes(510), 48)

    def test_invalid_values_are_rejected_before_persistence(self):
        with self.assertRaises(ValidationError):
            DailyCheckinPatch(entry_date=date.today(), body_fat_pct=120)
        with self.assertRaises(ValidationError):
            SportSession(sport_type="Course", duration_minutes=12, distance_km=-1)

    def test_nutrition_hash_is_deterministic(self):
        session = SportSession(session_id="bd0fbad2-2c56-4c33-b9a7-011e309cb9cb", sport_type="Course", duration_minutes=45, distance_km=7.2)
        self.assertEqual(nutrition_source_hash(Meals(lunch=" Poulet   riz "), [session], 78.0), nutrition_source_hash(Meals(lunch="poulet riz"), [session], 78.0))


if __name__ == "__main__":
    unittest.main()
