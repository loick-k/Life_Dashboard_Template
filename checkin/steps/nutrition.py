import json
from datetime import date

import pandas as pd
import streamlit as st


def _number_or_none(value: float) -> float | None:
    return float(value) if value > 0 else None


def _render_energy_kpis(draft: dict, existing: dict | None, *, show_not_calculated: bool = False) -> None:
    source = draft.get("_nutrition_estimate") or existing or {}
    ingested = source.get("kcal")
    burned = source.get("sport_kcal_burned")
    ingested = None if ingested is None or pd.isna(ingested) else ingested
    burned = None if burned is None or pd.isna(burned) else burned
    if ingested is None and not show_not_calculated:
        return

    def kcal_value(value):
        return "n.c." if value is None else f"{float(value):.0f} kcal"

    net = None if ingested is None else float(ingested) - float(burned or 0)
    ingested_col, burned_col, net_col = st.columns(3)
    ingested_col.metric("Ingérées", kcal_value(ingested))
    burned_col.metric("Sport", kcal_value(burned))
    net_col.metric("Nettes", kcal_value(net))

def _render_nutrition_estimate(draft: dict, existing: dict | None) -> None:
    source = draft.get("_nutrition_estimate") or existing or {}
    if source.get("kcal") is None:
        return
    st.markdown("#### Bilan énergétique estimé")
    _render_energy_kpis(draft, existing)
    protein_col, carbs_col, fats_col = st.columns(3)
    protein_col.metric("Protéines", f"{float(source.get('proteins_g') or 0):.0f} g")
    carbs_col.metric("Glucides", f"{float(source.get('carbs_g') or 0):.0f} g")
    fats_col.metric("Lipides", f"{float(source.get('fats_g') or 0):.0f} g")
    confidence = source.get("nutrition_analysis_confidence")
    if confidence:
        st.caption(f"Niveau de confiance : {confidence} · estimation indicative")
    assumptions = source.get("nutrition_analysis_assumptions")
    if assumptions:
        try:
            assumptions = json.loads(assumptions) if isinstance(assumptions, str) else assumptions
        except (TypeError, json.JSONDecodeError):
            assumptions = []
        if assumptions:
            with st.expander("Hypothèses de portions utilisées"):
                for assumption in assumptions:
                    st.markdown(f"- {assumption}")

def _show_nutrition_notice(selected_date: date) -> None:
    notice = st.session_state.pop(f"nutrition_analysis_notice_{selected_date.isoformat()}", None)
    if notice:
        getattr(st, notice[0])(notice[1])
