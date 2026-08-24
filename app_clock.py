"""Horloge métier unique du Life Dashboard."""

from datetime import datetime
from zoneinfo import ZoneInfo


PARIS_TIMEZONE = ZoneInfo("Europe/Paris")


def now_paris() -> datetime:
    """Retourne l'instant courant avec un fuseau Europe/Paris explicite."""
    return datetime.now(PARIS_TIMEZONE)


def today_paris():
    """Retourne la date civile courante à Paris."""
    return now_paris().date()


def timestamp_paris(timespec: str = "seconds") -> str:
    """Retourne un horodatage ISO incluant le décalage UTC de Paris."""
    return now_paris().isoformat(timespec=timespec)
