from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date

from app_clock import timestamp_paris
from data_store import save_api_usage, save_nutrition_analysis
from nutrition_analysis import (
    NUTRITION_MODEL, NutritionAnalysisUnavailable, analyze_meals,
    has_meal_content, has_sport_content, nutrition_source_hash,
)


@dataclass(frozen=True)
class NutritionRunResult:
    level: str
    message: str
    values: dict | None = None


def run_nutrition_analysis(
    selected_date: date, meals: dict[str, str], sport_sessions: list[dict],
    weight_kg: float | None, *, api_key: str = "", usd_to_eur: float | None = None,
) -> NutritionRunResult:
    """Exécute l'analyse sur demande, indépendamment de la sauvegarde quotidienne."""
    if not has_meal_content(meals) and not has_sport_content(sport_sessions):
        return NutritionRunResult("info", "Aucun repas ni aucune séance sportive à analyser pour cette journée.")
    try:
        estimate, usage = analyze_meals(
            meals, sport_sessions, weight_kg, api_key=api_key, usd_to_eur=usd_to_eur,
        )
    except NutritionAnalysisUnavailable as exc:
        return NutritionRunResult("warning", str(exc))

    source_hash = nutrition_source_hash(meals, sport_sessions, weight_kg)
    save_nutrition_analysis(selected_date, estimate, source_hash, NUTRITION_MODEL)
    save_api_usage(selected_date, NUTRITION_MODEL, usage)
    values = {
        "kcal": int(estimate.kcal),
        "sport_kcal_burned": int(estimate.sport_kcal_burned),
        "proteins_g": float(estimate.proteins_g),
        "carbs_g": float(estimate.carbs_g),
        "fats_g": float(estimate.fats_g),
        "nutrition_analysis_hash": source_hash,
        "nutrition_analysis_model": NUTRITION_MODEL,
        "nutrition_analysis_confidence": estimate.confidence,
        "nutrition_analysis_assumptions": json.dumps(estimate.assumptions, ensure_ascii=False),
        "nutrition_analyzed_at": timestamp_paris(),
    }
    return NutritionRunResult(
        "success",
        f"Estimation calculée : {estimate.kcal} kcal ingérées · {estimate.sport_kcal_burned} kcal sport · "
        f"P {estimate.proteins_g:.0f} g · G {estimate.carbs_g:.0f} g · L {estimate.fats_g:.0f} g.",
        values,
    )
