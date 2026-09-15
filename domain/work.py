from domain.models import WorkSchedule


DAILY_WORK_TARGET_MINUTES = 7 * 60 + 42


def time_to_minutes(value: str | None) -> int | None:
    if not value:
        return None
    hour, minute = value.split(":")
    return int(hour) * 60 + int(minute)


def duration_between(start_time: str, end_time: str) -> int:
    start = time_to_minutes(start_time)
    end = time_to_minutes(end_time)
    if start is None or end is None:
        raise ValueError("Les deux horaires sont requis.")
    if end < start:
        end += 24 * 60
    return end - start


def work_duration_minutes(schedule: WorkSchedule) -> int | None:
    values = (schedule.start_time, schedule.morning_end_time, schedule.afternoon_start_time, schedule.end_time, schedule.third_start_time, schedule.third_end_time)
    if not any(values):
        return None
    if schedule.start_time and schedule.end_time and not any((schedule.morning_end_time, schedule.afternoon_start_time, schedule.third_start_time, schedule.third_end_time)):
        return duration_between(schedule.start_time, schedule.end_time)
    pairs = ((schedule.start_time, schedule.morning_end_time), (schedule.afternoon_start_time, schedule.end_time), (schedule.third_start_time, schedule.third_end_time))
    if not all((start and end) or (not start and not end) for start, end in pairs):
        raise ValueError("Chaque créneau commencé doit comporter une heure de début et une heure de fin.")
    return sum(duration_between(start, end) for start, end in pairs if start and end)


def work_balance_minutes(duration_minutes: int | None, *, day_off: bool = False) -> int | None:
    if duration_minutes is None:
        return None
    return duration_minutes - (0 if day_off else DAILY_WORK_TARGET_MINUTES)
