# TrialMatch — Outil d'éligibilité patients pour essais cliniques

Déploiement 100% on-premise · Zéro appel réseau externe · Données chiffrées AES-256

---

## Prérequis

| Composant | Version minimale | Notes |
|-----------|-----------------|-------|
| Docker Engine | 24.0+ | `docker --version` |
| Docker Compose | V2 (plugin) | `docker compose version` |
| GPU NVIDIA | A100 40GB+ recommandé | Pour Meditron 70B |
| NVIDIA Container Toolkit | Dernière | Pour accès GPU dans Docker |
| RAM système | 128 GB+ | Meditron 70B ≈ 40 GB VRAM + OS |
| Stockage | 200 GB+ SSD | Modèle LLM + données |
| Ollama | 0.3.0+ | Installé sur l'hôte ou via Docker |

> **Sans GPU A100** : Meditron 70B peut tourner en CPU (lent, ~10-30min/analyse) ou utiliser un modèle plus petit. Configurer `OLLAMA_MODEL=meditron:7b` dans `.env`.

---

## Installation en 5 commandes

```bash
# 1. Copier et configurer les variables d'environnement
cp .env.example .env
# Éditer .env : JWT_SECRET_KEY, ENCRYPTION_KEY, ENCRYPTION_SALT, POSTGRES_PASSWORD

# 2. Créer le dossier secrets Docker
mkdir -p secrets
echo "votre-mot-de-passe-postgres" > secrets/db_password.txt
echo "votre-cle-encryption-base64" > secrets/encryption_key.txt
echo "votre-jwt-secret" > secrets/jwt_secret.txt
chmod 600 secrets/*.txt

# 3. Télécharger Meditron 70B via Ollama (≈ 40 GB)
ollama pull meditron:70b

# 4. Démarrer l'application
docker compose up -d

# 5. Appliquer les migrations de base de données
docker compose exec backend alembic upgrade head
```

---

## Configuration `.env` expliquée

```bash
# ── Application ────────────────────────────────────────────────────────────────
APP_ENV=production          # Ne pas changer en prod
APP_SECRET_KEY=             # openssl rand -hex 32
APP_DEBUG=false

# ── Base de données ────────────────────────────────────────────────────────────
POSTGRES_PASSWORD=          # Mot de passe fort (min 24 chars)
# DATABASE_URL est construite automatiquement depuis les secrets Docker

# ── Chiffrement AES-256 ────────────────────────────────────────────────────────
ENCRYPTION_KEY=             # openssl rand -base64 32
ENCRYPTION_SALT=            # openssl rand -base64 16
PBKDF2_ITERATIONS=600000    # Ne pas réduire en production

# ── JWT ────────────────────────────────────────────────────────────────────────
JWT_SECRET_KEY=             # openssl rand -hex 32 (différent de APP_SECRET_KEY)
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=480   # 8 heures
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7

# ── LLM ────────────────────────────────────────────────────────────────────────
OLLAMA_MODEL=meditron:70b   # meditron:7b pour tests sans GPU A100
OLLAMA_TIMEOUT=300          # 5 min (70B peut être lent en CPU)
LLM_TEMPERATURE=0           # NE PAS MODIFIER — déterminisme requis
LLM_MAX_RETRIES=3

# ── Rate limiting ─────────────────────────────────────────────────────────────
RATE_LIMIT_LOGIN_ATTEMPTS=5
RATE_LIMIT_WINDOW_MINUTES=15
RATE_LIMIT_LOCKOUT_MINUTES=30
```

---

## Lancement Ollama + Meditron

### Option A — Ollama sur l'hôte (recommandé avec GPU)

```bash
# Installer Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Démarrer le service
systemctl start ollama   # Linux avec systemd
ollama serve             # ou manuellement

# Télécharger le modèle
ollama pull meditron:70b

# Vérifier
ollama list
curl http://localhost:11434/api/tags
```

### Option B — Ollama dans Docker (service inclus dans docker-compose.yml)

```bash
# Le service ollama est inclus dans docker-compose.yml
# Télécharger le modèle dans le conteneur après le premier démarrage
docker compose exec ollama ollama pull meditron:70b
```

---

## Lancement de l'application

```bash
# Démarrage complet
docker compose up -d

# Vérifier l'état des services
docker compose ps

# Voir les logs en temps réel
docker compose logs -f backend

# Arrêt
docker compose down

# Arrêt avec suppression des volumes (ATTENTION : perte des données)
docker compose down -v
```

---

## Lancement des tests

```bash
# Tests backend (dans Docker)
docker compose -f docker-compose.test.yml run --rm tests

# Tests backend (localement avec virtualenv)
cd backend
python -m venv venv
source venv/bin/activate   # ou venv\Scripts\activate sur Windows
pip install -r requirements.txt
pytest -v --asyncio-mode=auto tests/

# Tests frontend
cd frontend
npm install
npm test

# Tests avec couverture
cd frontend && npm run test:coverage
cd backend && pytest --cov=app --cov-report=html tests/
```

---

## Module de validation (100 essais)

```bash
# Obtenir un token JWT
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"votre-mdp"}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Lancer la validation
python validation/run_validation.py \
  --api-url http://localhost:8000 \
  --token $TOKEN \
  --fixtures validation/fixtures/sample_trials.json \
  --output validation/report.json

# Générer le rapport HTML
python validation/generate_report.py \
  --input validation/report.json \
  --output validation/report.html
```

---

## Accès à l'interface

| Service | URL | Description |
|---------|-----|-------------|
| Interface utilisateur | http://localhost:3000 | Application React |
| Documentation API | http://localhost:8000/docs | Swagger UI (dev uniquement) |
| Santé backend | http://localhost:8000/health | Health check |

---

## Créer le premier compte administrateur

```bash
# Se connecter à la base de données
docker compose exec db psql -U trialmatch -d trialmatch

# Insérer un admin (remplacer le hash bcrypt par le vôtre)
-- Générer le hash : python -c "from passlib.context import CryptContext; print(CryptContext(schemes=['bcrypt']).hash('VotreMotDePasse!'))"
INSERT INTO users (id, username, email, hashed_password, role, is_active)
VALUES (
  gen_random_uuid(),
  'admin',
  'admin@hopital.fr',
  '$2b$12$votre-hash-bcrypt-ici',
  'admin',
  true
);
\q
```

---

## Migrations Alembic

```bash
# Appliquer toutes les migrations
docker compose exec backend alembic upgrade head

# Créer une nouvelle migration
docker compose exec backend alembic revision --autogenerate -m "description"

# Rollback d'une migration
docker compose exec backend alembic downgrade -1

# Historique
docker compose exec backend alembic history
```
