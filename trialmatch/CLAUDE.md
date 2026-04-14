# TrialMatch — Guide Claude Code

## Contexte du projet
TrialMatch est un outil d'éligibilité patients pour essais cliniques, déployé 100% on-premise en milieu hospitalier. Il utilise un LLM médical (Meditron 3 70B via Ollama) pour analyser automatiquement l'éligibilité des patients aux protocoles d'essais cliniques.

## Contraintes absolues (ne jamais contourner)

- **ZÉRO appel réseau externe** — tout reste en local (Ollama local, PostgreSQL local)
- **temperature=0** sur tous les appels LLM pour assurer le déterminisme
- **Validation Pydantic v2 stricte** sur toutes les entrées/sorties
- **Retry max 3** si le LLM renvoie un JSON invalide, avec logging de chaque échec
- **Statut "inconnu"** si données insuffisantes — jamais présumé satisfait
- **UUID + horodatage + hash SHA-256** du prompt sur chaque analyse
- **Aucune donnée patient dans les logs** — uniquement les UUIDs
- **Logs audit append-only** — enforcement via trigger PostgreSQL

## Stack technique

- **Backend** : Python 3.11, FastAPI, Pydantic v2, SQLAlchemy 2
- **LLM** : Meditron 3 70B via Ollama (http://ollama:11434 en Docker, http://localhost:11434 en local)
- **Base de données** : PostgreSQL 16 avec pgcrypto pour le chiffrement
- **Migrations** : Alembic
- **Frontend** : React 18, TypeScript, Vite, TailwindCSS
- **Auth** : JWT (8h) + Refresh token httpOnly + LDAP/AD optionnel
- **Tests** : pytest + pytest-asyncio + httpx / Vitest + React Testing Library

## Architecture de sécurité

- Données JSONB patient chiffrées via pgcrypto (AES-256)
- Clé de chiffrement dérivée via PBKDF2, stockée hors DB dans variable d'environnement
- Hash SHA-256 du prompt complet avant envoi au LLM
- RBAC : admin > investigateur_principal > co_investigateur > arc > tec
- Triggers PostgreSQL : audit_logs append-only, analyses immuables après validation
- Rate limiting : 5 tentatives login/15min/IP puis blocage 30min
- Prévention prompt injection : détection mots-clés suspects dans champs libres

## Commandes utiles

```bash
# Démarrage
cp .env.example .env
ollama pull meditron:70b
docker compose up -d
docker compose exec backend alembic upgrade head

# Tests
docker compose -f docker-compose.test.yml run --rm tests
cd backend && pytest -v
cd frontend && npm test

# Logs
docker compose logs -f backend
docker compose exec db psql -U trialmatch -d trialmatch

# Migrations
docker compose exec backend alembic revision --autogenerate -m "description"
docker compose exec backend alembic upgrade head
```

## Règles de développement

1. Ne jamais logger de données patient — uniquement les UUIDs
2. Toujours recalculer le score côté serveur, ne pas faire confiance au score LLM
3. Vérifier que tous les criterion_id du LLM correspondent aux critères envoyés
4. Toute modification d'analyse validée doit lever une erreur 403
5. Les logs audit sont en append-only — aucune mise à jour/suppression
6. Sanitiser tous les champs libres avant injection dans le prompt LLM
7. Utiliser des paramètres SQLAlchemy pour éviter les injections SQL

## Structure des rôles

| Rôle | Protocoles | Analyses | Validation | Override |
|------|-----------|----------|------------|---------|
| admin | CRUD | CRUD | Oui | Oui |
| investigateur_principal | CRUD | CRUD | Oui | Oui |
| co_investigateur | Lecture | CRUD | Non | Oui |
| arc | Lecture | Création | Non | Non |
| tec | Lecture | Lecture | Non | Non |
