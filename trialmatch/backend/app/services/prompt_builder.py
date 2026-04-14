"""Construct the LLM prompt for eligibility analysis."""
import json

from app.core.security import sanitize_text_field
from app.models.criterion import Criterion
from app.models.protocol import Protocol


SYSTEM_PROMPT = """Tu es un médecin investigateur expert en recherche clinique spécialisé dans l'analyse d'éligibilité aux essais cliniques.

RÈGLES ABSOLUES :
1. Réponds UNIQUEMENT en JSON valide selon le schéma fourni. Aucun texte avant ou après le JSON.
2. Si une donnée est absente ou insuffisante : statut = "inconnu". JAMAIS présumer une valeur manquante comme satisfaite.
3. Chaque raisonnement doit citer les données patient utilisées (valeur numérique, terme exact).
4. Pour les critères biologiques avec seuils chiffrés : calcule et compare explicitement.
5. Pour les critères d'exclusion : statut "satisfait" signifie que le critère d'exclusion N'EST PAS présent chez le patient.

SCHÉMA DE RÉPONSE ATTENDU (JSON strict) :
{
  "verdict": "eligible|non_eligible|incomplet",
  "score_pct": <entier 0-100>,
  "resume": "<1-2 phrases résumant l'éligibilité>",
  "criteres": [
    {
      "criterion_id": "<uuid>",
      "statut": "satisfait|non_satisfait|inconnu",
      "raisonnement": "<explication max 200 chars citant les données patient>"
    }
  ],
  "points_attention": ["<point d'attention clinique>"]
}

RÈGLES DE CALCUL DU VERDICT :
- "eligible" : tous les critères INC sont "satisfait" ET tous les critères EXC sont "satisfait" (= non présents)
- "non_eligible" : au moins un critère INC est "non_satisfait" OU au moins un critère EXC est "non_satisfait" (= présent)
- "incomplet" : au moins un critère est "inconnu" et aucun critère n'est "non_satisfait"
"""


def build_eligibility_prompt(
    protocol: Protocol,
    criteria: list[Criterion],
    patient_context: dict,
) -> str:
    """Construire le prompt complet pour l'analyse d'éligibilité."""
    inclusion = [c for c in criteria if c.type == "INC"]
    exclusion = [c for c in criteria if c.type == "EXC"]

    inc_lines = "\n".join(
        f"  - ID={c.id} | {sanitize_text_field(c.text)}"
        for c in sorted(inclusion, key=lambda x: x.order)
    )
    exc_lines = "\n".join(
        f"  - ID={c.id} | {sanitize_text_field(c.text)}"
        for c in sorted(exclusion, key=lambda x: x.order)
    )

    # Sanitiser le contexte patient (protection prompt injection)
    safe_context = _sanitize_patient_context(patient_context)

    user_prompt = f"""PROTOCOLE : {sanitize_text_field(protocol.title, 500)} — Phase {protocol.phase} — EudraCT {protocol.eudract_number or 'N/A'}
PATHOLOGIE : {sanitize_text_field(protocol.pathology, 255)}

CRITÈRES D'INCLUSION ({len(inclusion)}) :
{inc_lines if inc_lines else "  (aucun critère d'inclusion)"}

CRITÈRES D'EXCLUSION ({len(exclusion)}) :
{exc_lines if exc_lines else "  (aucun critère d'exclusion)"}

CONTEXTE CLINIQUE PATIENT :
{json.dumps(safe_context, ensure_ascii=False, indent=2)}

Analyse chaque critère individuellement selon les règles absolues.
Retourne UNIQUEMENT le JSON de résultat, sans texte avant ou après."""

    return f"{SYSTEM_PROMPT}\n\n{user_prompt}"


def _sanitize_patient_context(context: dict) -> dict:
    """Sanitise récursivement le contexte patient pour prévenir l'injection."""
    safe = {}
    for key, value in context.items():
        safe_key = sanitize_text_field(str(key), 100)
        if isinstance(value, str):
            safe[safe_key] = sanitize_text_field(value, 2000)
        elif isinstance(value, list):
            safe[safe_key] = [
                sanitize_text_field(str(item), 500) if isinstance(item, str) else item
                for item in value
            ]
        elif isinstance(value, dict):
            safe[safe_key] = _sanitize_patient_context(value)
        else:
            safe[safe_key] = value
    return safe
