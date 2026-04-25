"""
Moteur de stratégie de réponse — génère 3 scénarios via Claude.
Retourne du JSON structuré + explicable.
"""
import json
import logging
import re
from typing import Optional

import anthropic

from config import settings

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------
STRATEGY_SYSTEM = """\
Tu es un expert senior en réponse aux appels d'offres (RFP) pour les éditeurs de logiciels de santé.
Tu maîtrises la modélisation financière, le pricing stratégique et l'analyse concurrentielle.

RÈGLES :
- Réponds UNIQUEMENT en JSON valide, sans aucun texte avant ou après.
- Ne génère JAMAIS de chiffres inventés. Base-toi sur le document fourni et indique "(hypothèse)" si nécessaire.
- Sois précis, structuré, explicable. Chaque montant doit être justifié par une hypothèse claire.
- Tout en français, professionnel.
"""

STRATEGY_USER_TEMPLATE = """\
Analyse cet appel d'offres et génère une stratégie de réponse complète en 3 scénarios.

--- APPEL D'OFFRES ---
{rfp_text}
--- FIN ---

{analysis_context}

Réponds avec exactement ce JSON (ne change pas les clés) :
{{
  "worst_case": {{
    "price": <float HT en euros>,
    "price_rationale": "<explication 2-3 phrases>",
    "effort_days": <integer jours/homme total>,
    "team_size": <integer nombre de personnes>,
    "risk_level": "<low|medium|high>",
    "win_probability": <float 0.0 à 1.0>,
    "approach": "<description de l'approche en 2-3 phrases>",
    "pros": ["<avantage 1>", "<avantage 2>"],
    "cons": ["<inconvénient 1>", "<inconvénient 2>"]
  }},
  "medium_case": {{
    "price": <float HT en euros>,
    "price_rationale": "<explication 2-3 phrases>",
    "effort_days": <integer jours/homme total>,
    "team_size": <integer nombre de personnes>,
    "risk_level": "<low|medium|high>",
    "win_probability": <float 0.0 à 1.0>,
    "approach": "<description de l'approche en 2-3 phrases>",
    "pros": ["<avantage 1>", "<avantage 2>"],
    "cons": ["<inconvénient 1>", "<inconvénient 2>"]
  }},
  "best_case": {{
    "price": <float HT en euros>,
    "price_rationale": "<explication 2-3 phrases>",
    "effort_days": <integer jours/homme total>,
    "team_size": <integer nombre de personnes>,
    "risk_level": "<low|medium|high>",
    "win_probability": <float 0.0 à 1.0>,
    "approach": "<description de l'approche en 2-3 phrases>",
    "pros": ["<avantage 1>", "<avantage 2>"],
    "cons": ["<inconvénient 1>", "<inconvénient 2>"]
  }},
  "recommendation": "<paragraphe de 3-5 phrases expliquant le scénario recommandé et pourquoi>",
  "key_differentiators": [
    "<différenciateur 1 pour gagner ce marché>",
    "<différenciateur 2>",
    "<différenciateur 3>"
  ]
}}

Contexte pour calibrer les prix :
- worst_case : offre minimaliste, prix bas, équipe réduite, périmètre restreint
- medium_case : offre équilibrée, full périmètre, équipe standard
- best_case : offre premium, accompagnement étendu, SLA fort, équipe expérimentée
"""

METADATA_SYSTEM = """\
Tu es un extracteur de données structurées pour appels d'offres.
Réponds UNIQUEMENT en JSON valide. Pas de texte avant ou après.
"""

METADATA_USER_TEMPLATE = """\
Extrait les métadonnées de cet appel d'offres :

--- DOCUMENT ---
{text}
--- FIN ---

Réponds avec exactement ce JSON :
{{
  "title": "<titre concis de l'AO, max 150 chars>",
  "issuer": "<nom de l'organisation émettrice>",
  "deadline": "<date limite ISO YYYY-MM-DD ou null>",
  "budget_min": <float en euros ou null>,
  "budget_max": <float en euros ou null>,
  "complexity": "<low|medium|high>",
  "summary": "<résumé factuel en 2-3 phrases max>",
  "tags": ["<tag1>", "<tag2>", "<tag3>"]
}}

Si une information n'est pas disponible, utilise null pour les champs scalaires et [] pour les tableaux.
"""


# ---------------------------------------------------------------------------
# Helpers JSON
# ---------------------------------------------------------------------------
def _extract_json(text: str) -> dict:
    """Extrait le JSON d'une réponse qui pourrait contenir du texte parasite."""
    # Cherche un bloc JSON entre accolades
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return json.loads(match.group())
    return json.loads(text)


# ---------------------------------------------------------------------------
# Extraction de métadonnées
# ---------------------------------------------------------------------------
async def extract_metadata(raw_text: str) -> dict:
    """Utilise Claude pour extraire titre, issuer, deadline, budget, summary."""
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    truncated = raw_text[:20_000]  # On n'a pas besoin de tout le texte pour les métadonnées

    try:
        msg = await client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=1000,
            temperature=0.1,
            system=METADATA_SYSTEM,
            messages=[{
                "role": "user",
                "content": METADATA_USER_TEMPLATE.format(text=truncated),
            }],
        )
        text = msg.content[0].text
        data = _extract_json(text)
        return data
    except Exception as e:
        log.error("Erreur extraction métadonnées: %s", e)
        return {}


# ---------------------------------------------------------------------------
# Génération de stratégie
# ---------------------------------------------------------------------------
async def generate_strategy(rfp_text: str, analysis_json: Optional[str] = None) -> dict:
    """Génère 3 scénarios de réponse (worst/medium/best) via Claude."""
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    # Contexte additionnel si une analyse existe déjà
    analysis_context = ""
    if analysis_json:
        try:
            analysis_context = (
                f"\n--- ANALYSE EXISTANTE (contexte) ---\n"
                f"{analysis_json[:3000]}\n--- FIN ANALYSE ---\n"
            )
        except Exception:
            pass

    truncated = rfp_text[:30_000]
    user_msg = STRATEGY_USER_TEMPLATE.format(
        rfp_text=truncated,
        analysis_context=analysis_context,
    )

    try:
        msg = await client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=3000,
            temperature=0.2,
            system=STRATEGY_SYSTEM,
            messages=[{"role": "user", "content": user_msg}],
        )
        text = msg.content[0].text
        data = _extract_json(text)
        _validate_strategy(data)
        return data
    except json.JSONDecodeError as e:
        log.error("JSON invalide dans la réponse stratégie: %s", e)
        raise ValueError(f"Réponse JSON invalide de Claude: {e}")
    except Exception as e:
        log.error("Erreur génération stratégie: %s", e)
        raise


def _validate_strategy(data: dict) -> None:
    """Valide la structure minimale du JSON de stratégie."""
    required_keys = ["worst_case", "medium_case", "best_case", "recommendation"]
    for k in required_keys:
        if k not in data:
            raise ValueError(f"Clé manquante dans la réponse stratégie: {k}")
    for scenario in ["worst_case", "medium_case", "best_case"]:
        s = data[scenario]
        if not isinstance(s, dict):
            raise ValueError(f"Scénario '{scenario}' invalide")
        # Assure que les listes sont bien des listes
        s.setdefault("pros", [])
        s.setdefault("cons", [])
    data.setdefault("key_differentiators", [])
