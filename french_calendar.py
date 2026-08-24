from datetime import date, timedelta


def easter_sunday(year: int) -> date:
    """Calcule la date de Pâques selon le calendrier grégorien."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    month_offset = (32 + 2 * e + 2 * i - h - k) % 7
    correction = (a + 11 * h + 22 * month_offset) // 451
    month = (h + month_offset - 7 * correction + 114) // 31
    day = (h + month_offset - 7 * correction + 114) % 31 + 1
    return date(year, month, day)


def french_holiday_name(day: date) -> str | None:
    fixed = {
        (1, 1): "Jour de l’An",
        (5, 1): "Fête du Travail",
        (5, 8): "Victoire 1945",
        (7, 14): "Fête nationale",
        (8, 15): "Assomption",
        (11, 1): "Toussaint",
        (11, 11): "Armistice",
        (12, 25): "Noël",
    }
    if (day.month, day.day) in fixed:
        return fixed[(day.month, day.day)]
    easter = easter_sunday(day.year)
    moving = {
        easter + timedelta(days=1): "Lundi de Pâques",
        easter + timedelta(days=39): "Ascension",
        easter + timedelta(days=50): "Lundi de Pentecôte",
    }
    return moving.get(day)


def default_work_mode(day: date) -> str:
    return "Day off" if day.weekday() >= 5 or french_holiday_name(day) else "Bureau"
