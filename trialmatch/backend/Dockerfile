# TrialMatch Backend Dockerfile
FROM python:3.11-slim AS base

# Dépendances système
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Installer les dépendances Python
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ── Image de production ───────────────────────────────────────────────────────
FROM base AS production

COPY . .

# Créer le dossier de logs
RUN mkdir -p /app/logs

# Utilisateur non-root pour la sécurité
RUN useradd -r -s /bin/false appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]

# ── Image de test ─────────────────────────────────────────────────────────────
FROM base AS test

COPY . .
RUN mkdir -p /app/logs

CMD ["pytest", "-v", "--asyncio-mode=auto", "tests/"]
