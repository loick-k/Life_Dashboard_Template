from datetime import datetime, time, timedelta

import streamlit as st

from app_clock import today_paris
from checkin.steps.sport import _format_duration


def _parse_clock(raw: str, fallback: time) -> time:
    try:
        return datetime.strptime(raw, "%H:%M").time()
    except (TypeError, ValueError):
        return fallback

def _bedtime_options(current_value: str) -> list[str]:
    """Ordonne les horaires comme une soirée : 18 h, minuit, puis le début de matinée."""
    options = [f"{hour:02d}:{minute:02d}" for hour in range(18, 24) for minute in range(0, 60, 5)]
    options += [f"{hour:02d}:{minute:02d}" for hour in range(0, 7) for minute in range(0, 60, 5)]
    if current_value not in options:
        options.append(current_value)
    return options

def _sleep_duration(bedtime: time, wake_time: time) -> float:
    start = datetime.combine(today_paris(), bedtime)
    end = datetime.combine(today_paris(), wake_time)
    if end <= start:
        end += timedelta(days=1)
    return (end - start).total_seconds() / 3600

def _sleep_gauge(bedtime: time, wake_time: time, duration_hours: float) -> None:
    capped_duration = min(max(duration_hours, 0), 14)
    marker_position = capped_duration / 14 * 100
    duration_label = _format_duration(round(duration_hours * 60))
    st.markdown(
        f"""
        <div class="sleep-summary">
            <div class="sleep-times">
                <strong>{bedtime.strftime('%H:%M')}</strong>
                <span class="sleep-night-line"></span>
                <strong>{wake_time.strftime('%H:%M')}</strong>
            </div>
            <div class="sleep-duration-label">Durée calculée</div>
            <div class="sleep-duration-value">{duration_label}</div>
            <div class="sleep-gauge">
                <div class="sleep-target-zone"></div>
                <div class="sleep-marker" style="left:{marker_position:.2f}%"></div>
            </div>
            <div class="sleep-scale">
                <span>0 h</span><span class="sleep-target-label">Zone cible 7–9 h</span><span>14 h</span>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
