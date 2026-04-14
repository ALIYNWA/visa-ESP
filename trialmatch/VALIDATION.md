# VALIDATION.md — Module de validation TrialMatch

## Objectif

Le module de validation permet d'évaluer la performance du moteur d'éligibilité sur un jeu de cas de test représentatif. Il est requis avant toute mise en production ou mise à jour majeure du modèle LLM.

---

## Utilisation

### Prérequis

```bash
# Python 3.11 + httpx
pip install httpx

# Application en cours d'exécution
docker compose up -d
docker compose exec backend alembic upgrade head
```

### Exécution standard

```bash
# Obtenir un token JWT admin
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"votre-mot-de-passe"}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Lancer la validation
python validation/run_validation.py \
  --api-url http://localhost:8000 \
  --token "$TOKEN" \
  --fixtures validation/fixtures/sample_trials.json \
  --output validation/report_$(date +%Y%m%d_%H%M).json
```

### Générer le rapport HTML

```bash
python validation/generate_report.py \
  --input validation/report_$(date +%Y%m%d_%H%M).json \
  --output validation/report.html

# Ouvrir dans le navigateur
open validation/report.html   # macOS
xdg-open validation/report.html  # Linux
```

---

## Format de `sample_trials.json`

Le fichier de fixtures est un tableau d'objets `trial`, chacun contenant un protocole et ses cas de test :

```json
[
  {
    "trial_id": "TRIAL-001",
    "protocol": {
      "title": "Titre de l'essai",
      "eudract_number": "2024-000000-00",
      "phase": "II",
      "pathology": "Pathologie ciblée",
      "criteria": [
        { "type": "INC", "text": "Critère d'inclusion", "order": 0 },
        { "type": "EXC", "text": "Critère d'exclusion", "order": 1 }
      ]
    },
    "test_cases": [
      {
        "case_id": "TRIAL-001-ELIGIBLE",
        "patient_context": {
          "age": 55,
          "sexe": "M",
          "diagnostic_principal": "...",
          "ecog_performance_status": 1,
          "biologie": { "creatinine": "0.9 mg/dL" },
          "traitements_en_cours": [],
          "antecedents": []
        },
        "expected_verdict": "eligible",
        "expected_min_score": 80
      },
      {
        "case_id": "TRIAL-001-NON-ELIGIBLE",
        "patient_context": { "age": 16 },
        "expected_verdict": "non_eligible",
        "expected_max_score": 70
      }
    ]
  }
]
```

### Champs disponibles

| Champ | Type | Description |
|-------|------|-------------|
| `trial_id` | string | Identifiant unique de l'essai |
| `protocol.phase` | "I"\|"II"\|"III"\|"IV" | Phase de l'essai |
| `test_cases[].case_id` | string | Identifiant unique du cas |
| `expected_verdict` | "eligible"\|"non_eligible"\|"incomplet" | Verdict attendu |
| `expected_min_score` | int 0-100 | Score minimum attendu (optionnel) |
| `expected_max_score` | int 0-100 | Score maximum attendu (optionnel) |

### Champs `patient_context`

| Champ | Type | Description |
|-------|------|-------------|
| `age` | int | Âge en années |
| `sexe` | "M"\|"F"\|"Autre" | |
| `diagnostic_principal` | string | Diagnostic principal |
| `stade` | string | Stade de la maladie |
| `ecog_performance_status` | int 0-4 | ECOG Performance Status |
| `biologie` | dict | Valeurs biologiques (`{"creatinine": "1.0 mg/dL"}`) |
| `traitements_en_cours` | list[str] | Traitements actuels |
| `antecedents` | list[str] | Antécédents médicaux |
| `notes_libres` | string | Contexte clinique libre |

---

## Interprétation des métriques

### Sortie console

```
✓ PASS | TRIAL-001-ELIGIBLE               | Expected: eligible        | Got: eligible        | Score:  95% | 3250ms
✗ FAIL | TRIAL-001-NONELIGIBLE-AGE        | Expected: non_eligible    | Got: eligible        | Score:  85% | 2800ms
```

### Rapport JSON

```json
{
  "run_id": "uuid",
  "total": 10,
  "passed": 9,
  "failed": 1,
  "pass_rate_pct": 90.0,
  "avg_latency_ms": 3100,
  "go_nogo": "GO"
}
```

### Métriques clés

| Métrique | Description | Seuil go/no-go |
|----------|-------------|---------------|
| `pass_rate_pct` | % de cas avec verdict et score corrects | >= 90% |
| `avg_latency_ms` | Latence moyenne des appels LLM | < 30 000ms (30s) |
| Cas "incomplet" inattendus | Données manquantes non détectées | 0 toléré |

---

## Critères go/no-go

### GO — Autorisation de mise en production

Toutes les conditions suivantes doivent être réunies :

- [x] **Taux de réussite >= 90%** sur l'ensemble des cas de test
- [x] **Zéro faux "éligible"** sur les cas attendus `non_eligible`
  *(un faux positif est plus dangereux qu'un faux négatif)*
- [x] **Latence moyenne < 30 secondes** par analyse
- [x] **Tous les tests unitaires passent** (`pytest` + `vitest`)
- [x] **Zéro erreur 500** dans les logs de validation

### NO-GO — Blocage

Tout l'un des critères suivants déclenche un NO-GO :

- [ ] Taux de réussite < 90%
- [ ] Au moins 1 faux positif "éligible" sur un cas `non_eligible`
- [ ] Latence > 60 secondes (timeout utilisateur inacceptable)
- [ ] Crash du service pendant la validation

### En cas de NO-GO

1. Analyser les cas échoués dans le rapport HTML
2. Vérifier les logs backend : `docker compose logs backend | grep error`
3. Tester manuellement les cas problématiques via `POST /api/v1/analyses`
4. Vérifier la température LLM (`LLM_TEMPERATURE=0` dans `.env`)
5. Si le modèle est en cause : considérer un fine-tuning ou changer de modèle

---

## Ajouter des cas de test

Pour atteindre 100 cas de test (recommandé) :

1. Ajouter des objets dans `validation/fixtures/sample_trials.json`
2. Couvrir les cas limites :
   - Valeurs biologiques exactement au seuil (±5%)
   - Données partiellement manquantes
   - Patients avec comorbidités multiples
   - Protocoles sans critères d'exclusion
   - Contexte patient en plusieurs langues (français/anglais)

```bash
# Valider que le fichier JSON est bien formé
python -c "import json; json.load(open('validation/fixtures/sample_trials.json')); print('OK')"
```
