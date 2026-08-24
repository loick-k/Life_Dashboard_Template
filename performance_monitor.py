import time
from functools import wraps

import pandas as pd
import streamlit as st

from app_clock import timestamp_paris


APP_RUN_STARTED = time.perf_counter()


def record_performance(label: str, elapsed_ms: float) -> None:
    """Conserve un historique court en session, sans écriture en base."""
    try:
        samples = st.session_state.setdefault("performance_samples", [])
        samples.append(
            {
                "process": label,
                "ms": round(elapsed_ms, 1),
                "at": timestamp_paris(),
            }
        )
        if len(samples) > 200:
            del samples[:-200]
    except Exception:
        pass


def measure_performance(label: str):
    """Décorateur léger pour chronométrer les opérations importantes."""
    def decorator(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            started = time.perf_counter()
            try:
                return function(*args, **kwargs)
            finally:
                record_performance(label, (time.perf_counter() - started) * 1000)

        return wrapped

    return decorator


def performance_summary() -> pd.DataFrame:
    samples = st.session_state.get("performance_samples", [])
    if not samples:
        return pd.DataFrame()
    frame = pd.DataFrame(samples)
    return frame.groupby("process", as_index=False).agg(
        appels=("ms", "size"),
        dernier_ms=("ms", "last"),
        moyenne_ms=("ms", "mean"),
        maximum_ms=("ms", "max"),
    ).sort_values("maximum_ms", ascending=False)
