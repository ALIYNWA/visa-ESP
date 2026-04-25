"""
Moteur d'analyse : appel Claude API avec streaming SSE.
"""
import json
import logging
import re
from typing import AsyncGenerator

import anthropic

from config import settings

log = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Prompt système
# --------------------------------------------------------------------------
SYSTEM_PROMPT = """Tu es un expert senior en réponse aux appels d'offres publics, en modélisation \
financière, en pricing stratégique et en analyse concurrentielle. Tu agis comme un outil SaaS \
complet d'aide à la décision.

RÈGLES ABSOLUES :
- Tu produis EXACTEMENT 10 sections dans l'ordre, chacune précédée de la balise "## SECTION_N – Titre"
  où N est un entier de 1 à 10.
- Tu n'inventes jamais de données chiffrées sans le signaler explicitement par "(hypothèse)".
- Tu utilises des tableaux Markdown (format |col|col|) pour toutes les données numériques.
- Tu signales toujours les zones d'incertitude par ⚠️.
- Tu rédiges exclusivement en français, de façon professionnelle et concise.
- Tu ne sautes aucune section. Tu n'ajoutes pas de section supplémentaire.
- Pour chaque donnée financière estimée, tu précises les hypothèses de calcul."""

# --------------------------------------------------------------------------
# Prompt utilisateur (template)
# --------------------------------------------------------------------------
USER_PROMPT_TEMPLATE = """Analyse le document d'appel d'offres suivant et produis une analyse \
complète d'aide à la décision.

---DOCUMENT---
{document_text}
---FIN DU DOCUMENT---

Produis exactement les 10 sections suivantes dans cet ordre :

## SECTION_1 – Résumé exécutif
Synthèse en 300-500 mots : nature du marché, périmètre, budget estimé, délais clés, \
obligations principales, verdict Go/No-Go préliminaire.

## SECTION_2 – Analyse du besoin
Tableau des livrables attendus. Contraintes techniques et juridiques. Zones d'ambiguïté \
identifiées (⚠️). Risques opérationnels et dépendances critiques.

## SECTION_3 – Benchmark marché
Projets similaires identifiés. Fourchettes de prix de marché (€ HT). Niveaux de TJM \
(grands cabinets / mid-market / spécialistes indépendants). Contexte marché. \
Signale clairement les hypothèses et incertitudes (⚠️).

## SECTION_4 – Modélisation financière détaillée
Construis les 4 blocs suivants avec un tableau Markdown pour chacun \
(colonnes : Poste | Quantité | PU HT (€) | Total HT (€) | Coût interne (€) | Marge %) :

**Bloc A — Ressources humaines (profils, jours/homme)**
**Bloc B — Frais techniques (licences, infra, outils)**
**Bloc C — Sous-traitance / partenaires**
**Bloc D — Frais généraux (gestion, coordination, risques)**

Tableau récapitulatif final : Prix proposé total HT | Coût total | Marge brute € | Marge %

## SECTION_5 – Scénarios financiers
Tableau avec colonnes : Scénario | Hypothèses clés | CA HT (€) | Coût total (€) | \
Marge nette (€) | Marge % | Probabilité estimée

3 lignes : 🔴 Pessimiste | 🟡 Médian | 🟢 Optimiste

Pour chaque scénario : justification des hypothèses.

## SECTION_6 – Structures de coûts (3 modèles)
Pour chaque modèle, tableau de ventilation des coûts + point mort + rentabilité :
- Modèle 1 : Équipe CDI interne
- Modèle 2 : Mix CDI + freelances
- Modèle 3 : Équipe mutualisée / forfait

Recommande le modèle optimal avec justification.

## SECTION_7 – Analyse concurrentielle
Concurrents probables classés : low-cost / standard / premium.
Tableau : Concurrent | Profil | Fourchette prix estimée | Points forts | Points faibles
Signale les hypothèses (⚠️). Ne donne jamais de prix précis, uniquement des fourchettes.

## SECTION_8 – Positionnement stratégique
Positionnement recommandé (agressif / équilibré / premium). Proposition de valeur différenciante. \
Thèmes gagnants à mettre en avant dans l'offre. Argumentaire prix.

## SECTION_9 – Détection des risques
Tableau registre des risques : Risque | Probabilité (F/M/E) | Impact (F/M/E) | Score | \
Mitigation recommandée

Catégories : financier, technique, contractuel, volume, concurrentiel, OAB (offre anormalement basse).

## SECTION_10 – Recommandation finale
**Décision : GO ✅ / NO-GO ❌ / CONDITIONNEL ⚠️**

Prix recommandé HT : X €
Fourchette acceptable : [X min € — X max €]

3 conditions sine qua non (si Go ou Conditionnel).
Actions prioritaires dans les 48h.
Synthèse en 5 lignes maximum."""

# --------------------------------------------------------------------------
# Regex pour détecter les marqueurs de section dans le stream
# --------------------------------------------------------------------------
SECTION_RE = re.compile(r"##\s*SECTION_(\d+)\s*[–\-—]")


async def stream_analysis(document_text: str) -> AsyncGenerator[str, None]:
    """
    Générateur async SSE.
    Émet :
      data: {"delta": "...texte..."}
      data: {"section": N}          ← quand un marqueur ## SECTION_N est détecté
      data: {"heartbeat": true}     ← toutes les 20s pour garder la connexion
      data: [DONE]
    """
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    user_message = USER_PROMPT_TEMPLATE.format(document_text=document_text)

    buffer = ""  # rolling buffer pour détecter les marqueurs sur plusieurs chunks

    try:
        async with client.messages.stream(
            model=settings.CLAUDE_MODEL,
            max_tokens=8000,
            temperature=0.15,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            async for text_chunk in stream.text_stream:
                buffer += text_chunk

                # Détection de marqueur de section dans le buffer
                match = SECTION_RE.search(buffer)
                if match:
                    section_num = int(match.group(1))
                    yield f"data: {json.dumps({'section': section_num})}\n\n"
                    # Vide le buffer après détection pour éviter double-détection
                    buffer = buffer[match.end():]
                elif len(buffer) > 300:
                    # Purge partielle : garde les 100 derniers chars pour le prochain chunk
                    buffer = buffer[-100:]

                yield f"data: {json.dumps({'delta': text_chunk})}\n\n"

    except anthropic.APIStatusError as e:
        log.error("Erreur Claude API: %s", e)
        yield f"event: error\ndata: {json.dumps({'message': f'Erreur API Claude : {e.message}'})}\n\n"
        return
    except Exception as e:
        log.exception("Erreur inattendue dans stream_analysis")
        yield f"event: error\ndata: {json.dumps({'message': f'Erreur interne : {str(e)}'})}\n\n"
        return

    yield "data: [DONE]\n\n"
