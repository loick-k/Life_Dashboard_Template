from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import dataclass
from typing import Literal

import streamlit as st
from pydantic import BaseModel, Field


NUTRITION_MODEL = "gpt-5.6-luna"
INPUT_USD_PER_MILLION = 1.00
CACHED_INPUT_USD_PER_MILLION = 0.10
OUTPUT_USD_PER_MILLION = 6.00
DEFAULT_USD_TO_EUR = 0.92
LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class NutritionUsage:
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    cost_usd: float
    cost_eur: float
    usd_to_eur: float


class NutritionEstimate(BaseModel):
    kcal: int = Field(ge=0, le=15000)
    sport_kcal_burned: int = Field(default=0, ge=0, le=10000)
    proteins_g: float = Field(ge=0, le=1000)
    carbs_g: float = Field(ge=0, le=2000)
    fats_g: float = Field(ge=0, le=1000)
    confidence: Literal["faible", "moyenne", "élevée"]
    assumptions: list[str]


class NutritionAnalysisUnavailable(RuntimeError):
    pass


def nutrition_source_hash(
    meals: dict[str, str], sport_sessions: list[dict] | None = None, weight_kg: float | None = None
) -> str:
    normalized = {
        "meals": {
            key: " ".join(str(value or "").strip().lower().split())
            for key, value in sorted(meals.items())
        },
        "sport_sessions": sport_sessions or [],
        "weight_kg": weight_kg,
    }
    payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def has_meal_content(meals: dict[str, str]) -> bool:
    return any(str(value or "").strip() for value in meals.values())


def has_sport_content(sport_sessions: list[dict] | None) -> bool:
    return any(
        session.get("sport_type") and int(session.get("duration_minutes") or 0) > 0
        for session in (sport_sessions or [])
    )


def get_openai_api_key() -> str:
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if key:
        return key
    try:
        return str(st.secrets.get("OPENAI_API_KEY", "")).strip()
    except Exception:
        return ""


def get_usd_to_eur_rate() -> float:
    raw_value = os.getenv("OPENAI_USD_TO_EUR", "").strip()
    if not raw_value:
        try:
            raw_value = str(st.secrets.get("OPENAI_USD_TO_EUR", "")).strip()
        except Exception:
            raw_value = ""
    try:
        rate = float(raw_value.replace(",", ".")) if raw_value else DEFAULT_USD_TO_EUR
    except ValueError:
        rate = DEFAULT_USD_TO_EUR
    return rate if rate > 0 else DEFAULT_USD_TO_EUR


def _usage_from_response(response) -> NutritionUsage:
    def token_count(value) -> int:
        return max(0, int(value)) if isinstance(value, (int, float)) else 0

    usage = getattr(response, "usage", None)
    input_tokens = token_count(getattr(usage, "input_tokens", 0))
    output_tokens = token_count(getattr(usage, "output_tokens", 0))
    input_details = getattr(usage, "input_tokens_details", None)
    cached_tokens = min(input_tokens, token_count(getattr(input_details, "cached_tokens", 0)))
    uncached_tokens = input_tokens - cached_tokens
    cost_usd = (
        uncached_tokens * INPUT_USD_PER_MILLION
        + cached_tokens * CACHED_INPUT_USD_PER_MILLION
        + output_tokens * OUTPUT_USD_PER_MILLION
    ) / 1_000_000
    usd_to_eur = get_usd_to_eur_rate()
    return NutritionUsage(
        input_tokens=input_tokens,
        cached_input_tokens=cached_tokens,
        output_tokens=output_tokens,
        cost_usd=cost_usd,
        cost_eur=cost_usd * usd_to_eur,
        usd_to_eur=usd_to_eur,
    )


def _load_openai_sdk():
    from openai import (
        APIConnectionError,
        APITimeoutError,
        AuthenticationError,
        BadRequestError,
        OpenAI,
        OpenAIError,
        PermissionDeniedError,
        RateLimitError,
    )
    return {
        "APIConnectionError": APIConnectionError,
        "APITimeoutError": APITimeoutError,
        "AuthenticationError": AuthenticationError,
        "BadRequestError": BadRequestError,
        "OpenAI": OpenAI,
        "OpenAIError": OpenAIError,
        "PermissionDeniedError": PermissionDeniedError,
        "RateLimitError": RateLimitError,
    }


def _friendly_api_error(exc, sdk) -> str:
    if isinstance(exc, sdk["AuthenticationError"]):
        return "La clé OpenAI est invalide ou désactivée. Vérifie OPENAI_API_KEY dans les Secrets Streamlit."
    if isinstance(exc, sdk["PermissionDeniedError"]):
        return "La clé OpenAI n’autorise pas ce modèle ou l’API Responses. Vérifie ses permissions dans OpenAI."
    if isinstance(exc, sdk["RateLimitError"]):
        error_details = " ".join((
            str(getattr(exc, "code", "") or ""),
            str(getattr(exc, "type", "") or ""),
            json.dumps(getattr(exc, "body", {}) or {}, ensure_ascii=False),
        )).lower()
        quota_markers = (
            "insufficient_quota",
            "billing_hard_limit_reached",
            "billing_not_active",
            "credit_balance",
        )
        if any(marker in error_details for marker in quota_markers):
            return (
                "Aucun crédit API OpenAI n’est disponible pour ce projet. "
                "Ajoute un moyen de paiement ou des crédits dans OpenAI → Billing, puis réessaie après quelques minutes."
            )
        return (
            "La limite temporaire d’utilisation OpenAI a été atteinte. Patiente une minute puis relance l’analyse. "
            "Si le message persiste, vérifie les crédits et les limites du projet dans OpenAI → Billing et Limits."
        )
    if isinstance(exc, sdk["BadRequestError"]):
        code = str(getattr(exc, "code", "") or "").lower()
        if code in {"model_not_found", "invalid_model"}:
            return f"Le modèle {NUTRITION_MODEL} n’est pas disponible pour ce projet OpenAI."
        return "OpenAI a refusé la demande d’analyse. Consulte les logs Streamlit pour le détail technique."
    if isinstance(exc, sdk["APITimeoutError"]):
        return "OpenAI n’a pas répondu dans le délai prévu. Relance l’analyse dans quelques instants."
    if isinstance(exc, sdk["APIConnectionError"]):
        return "Streamlit n’arrive pas à joindre OpenAI. Vérifie la connexion puis relance l’analyse."
    return "L’analyse OpenAI a échoué. Consulte les logs Streamlit pour le détail technique."


def analyze_meals(
    meals: dict[str, str],
    sport_sessions: list[dict] | None = None,
    weight_kg: float | None = None,
) -> tuple[NutritionEstimate, NutritionUsage]:
    api_key = get_openai_api_key()
    if not api_key:
        raise NutritionAnalysisUnavailable(
            "Ajoute OPENAI_API_KEY dans les Secrets Streamlit pour activer l’analyse nutritionnelle."
        )
    if not has_meal_content(meals) and not has_sport_content(sport_sessions):
        raise NutritionAnalysisUnavailable("Aucun repas ni aucune séance sportive n’est renseigné pour cette journée.")

    sdk = _load_openai_sdk()
    client = sdk["OpenAI"](api_key=api_key, timeout=25.0, max_retries=1)
    try:
        response = client.responses.parse(
            model=NUTRITION_MODEL,
            reasoning={"effort": "none"},
            max_output_tokens=600,
            input=[
                {
                    "role": "system",
                    "content": (
                        "Tu estimes les apports nutritionnels d'une journée à partir de repas décrits en français. "
                        "Retourne uniquement les totaux journaliers demandés par le schéma. "
                        "Quand une quantité est précisée, utilise-la. Quand elle ne l'est pas, considère exactement "
                        "une portion adulte standard et réaliste correspondant au contenant ou à l'unité mentionnée : "
                        "une assiette, un bol, un verre, une tranche, une cuillère ou une unité. "
                        "N'invente jamais une seconde portion. Inclus les boissons, sauces, huiles et collations mentionnées. "
                        "Liste brièvement les principales quantités supposées dans assumptions. "
                        "Utilise confidence=faible si plusieurs portions sont ambiguës, moyenne si quelques hypothèses "
                        "sont nécessaires, et élevée lorsque les quantités sont suffisamment précises. "
                        "Les valeurs sont des estimations et doivent rester cohérentes entre kcal et macronutriments. "
                        "Estime séparément dans sport_kcal_burned les kcal dépensées pendant les séances sportives. "
                        "Appuie-toi sur l'activité, la durée, la distance lorsqu'elle existe et le poids fourni. "
                        "Si le poids manque, utilise une hypothèse adulte standard et mentionne-la dans assumptions. "
                        "Ne soustrais jamais les kcal sportives des kcal alimentaires."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps({
                        "repas": meals,
                        "seances_sportives": sport_sessions or [],
                        "poids_kg": weight_kg,
                    }, ensure_ascii=False, default=str),
                },
            ],
            text_format=NutritionEstimate,
        )
    except sdk["OpenAIError"] as exc:
        LOGGER.exception("Échec de l’analyse nutritionnelle OpenAI (%s)", type(exc).__name__)
        raise NutritionAnalysisUnavailable(_friendly_api_error(exc, sdk)) from exc
    estimate = response.output_parsed
    if estimate is None:
        raise NutritionAnalysisUnavailable("L’analyse nutritionnelle n’a retourné aucun résultat exploitable.")
    return estimate, _usage_from_response(response)
