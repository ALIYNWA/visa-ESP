# SECURITY.md — TrialMatch

## Architecture de sécurité

### Vue d'ensemble

TrialMatch est conçu pour un déploiement 100% on-premise en milieu hospitalier. Chaque couche de la stack implémente des contrôles de sécurité indépendants (défense en profondeur).

```
[Navigateur] ──HTTPS──> [Nginx / Frontend]
                              │
                         [FastAPI Backend]
                         JWT + RBAC + Rate limiting
                              │
                    ┌─────────┴─────────┐
               [PostgreSQL]        [Ollama/Meditron]
               pgcrypto AES-256    réseau interne isolé
               triggers append-only temperature=0
```

### Authentification

| Mécanisme | Configuration |
|-----------|--------------|
| JWT access token | Expiration 8h, HS256 |
| Refresh token | Cookie httpOnly, SameSite=Strict, 7 jours |
| Rotation refresh | Automatique à chaque refresh |
| Révocation | Sur logout (store en mémoire, Redis en prod) |
| Rate limiting login | 5 tentatives / 15min / IP, puis blocage 30min |

### Autorisation RBAC

| Rôle | Protocoles | Patients | Analyses | Validation | Override |
|------|-----------|----------|----------|------------|---------|
| admin | CRUD | CRUD | CRUD | ✓ | ✓ |
| investigateur_principal | CRUD | CRUD | CRUD | ✓ | ✓ |
| co_investigateur | Lecture | Lecture | CRUD | ✗ | ✓ |
| arc | Lecture | Création | Création | ✗ | ✗ |
| tec | Lecture | Lecture | Lecture | ✗ | ✗ |

### Chiffrement des données

- **Contexte patient** : AES-256-GCM via bibliothèque `cryptography` Python
- **Clé de chiffrement** : Dérivée via PBKDF2-HMAC-SHA256 (600 000 itérations) depuis `ENCRYPTION_KEY` (hors base de données)
- **Nonce** : 12 octets aléatoires par chiffrement (`secrets.token_bytes`)
- **Réponse LLM brute** : Chiffrée en base (même clé AES-256-GCM)
- **Hash prompt** : SHA-256 calculé avant envoi au LLM (traçabilité)

### Logs d'audit (BPC)

- Table `audit_logs` en append-only (trigger PostgreSQL `BEFORE UPDATE OR DELETE`)
- Logs structurés JSON via structlog (fichier + stdout)
- **Aucune donnée patient dans les logs** — uniquement des UUIDs
- Chaque événement possède un `event_id` UUID unique et un `timestamp` UTC

### Sécurité réseau Docker

- Réseau `trialmatch_internal` avec `internal: true` (bloque tout accès Internet)
- PostgreSQL **non exposé** sur le réseau hôte
- Ollama **non exposé** sur le réseau hôte
- Seul le port 3000 (Nginx frontend) est exposé à l'hôpital

### Headers HTTP

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'none'; script-src 'self'; ...
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

### Prévention des injections

| Type | Protection |
|------|-----------|
| SQL injection | SQLAlchemy ORM paramétré — jamais de SQL dynamique |
| XSS | React escape automatique + CSP strict |
| Prompt injection | Détection regex + sanitisation avant injection LLM |
| Path traversal | FastAPI UUID routing (pas de chemins arbitraires) |

---

## Procédure de rotation des clés

### Rotation de la clé JWT (`JWT_SECRET_KEY`)

```bash
# 1. Générer une nouvelle clé
openssl rand -hex 32

# 2. Mettre à jour secrets/jwt_secret.txt sur TOUS les nœuds
echo "NOUVELLE_CLE" > secrets/jwt_secret.txt

# 3. Redémarrer le backend (tous les tokens existants seront invalidés)
docker compose restart backend

# Impact : Tous les utilisateurs devront se reconnecter.
# Fréquence recommandée : Tous les 90 jours, ou immédiatement en cas de compromission suspectée.
```

### Rotation de la clé de chiffrement (`ENCRYPTION_KEY`)

> ⚠️ La rotation de la clé de chiffrement nécessite un re-chiffrement de toutes les données.

```bash
# 1. Générer une nouvelle clé
openssl rand -base64 32  # Nouvelle ENCRYPTION_KEY
openssl rand -base64 16  # Nouveau ENCRYPTION_SALT

# 2. Script de migration (à écrire en fonction des volumes)
#    - Déchiffrer avec l'ancienne clé
#    - Rechiffrer avec la nouvelle clé
#    - Mettre à jour en base

# 3. Mettre à jour secrets/encryption_key.txt
# 4. Redémarrer le backend
docker compose restart backend

# Impact : Aucune interruption visible si migration effectuée avant redémarrage.
# Fréquence recommandée : En cas de compromission uniquement.
```

### Rotation du mot de passe PostgreSQL

```bash
# 1. Générer un nouveau mot de passe fort
openssl rand -base64 24

# 2. Mettre à jour dans PostgreSQL
docker compose exec db psql -U trialmatch -c "ALTER USER trialmatch PASSWORD 'NOUVEAU_MDP';"

# 3. Mettre à jour secrets/db_password.txt
# 4. Redémarrer le backend
docker compose restart backend
```

---

## Politique de mots de passe

- Longueur minimale : 12 caractères
- Doit contenir : majuscules, minuscules, chiffres, caractères spéciaux
- Hachage : bcrypt avec coût adaptatif (passlib)
- Expiration : 90 jours (enforcer via procédure LDAP ou reset annuel)
- Historique : 10 derniers mots de passe interdits (implémentation LDAP)
- Verrouillage : Après 5 tentatives échouées en 15 minutes (rate limiter API)

---

## Procédure en cas d'incident de sécurité

### Niveaux de sévérité

| Niveau | Description | Délai de réponse |
|--------|-------------|-----------------|
| P1 | Accès non autorisé aux données patient, exfiltration | Immédiat (< 1h) |
| P2 | Compromission d'un compte utilisateur | < 4h |
| P3 | Tentative d'intrusion détectée (logs) | < 24h |

### Procédure P1 — Fuite de données

```bash
# 1. Isoler immédiatement l'environnement
docker compose down

# 2. Préserver les logs (AVANT toute autre action)
docker compose logs --no-color > incident_logs_$(date +%Y%m%d_%H%M%S).txt
cp backend/logs/trialmatch.jsonl incident_audit_$(date +%Y%m%d_%H%M%S).jsonl

# 3. Notifier le DPO et la direction médicale dans l'heure
# 4. Déclarer à la CNIL dans les 72h (obligation RGPD)
# 5. Changer TOUTES les clés (JWT, chiffrement, DB)
# 6. Audit complet des logs d'audit PostgreSQL
```

### Procédure P2 — Compte compromis

```bash
# 1. Désactiver le compte immédiatement
# Via l'API admin :
curl -X PUT http://localhost:8000/api/v1/users/{user_id} \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"is_active": false}'

# 2. Révoquer tous les tokens actifs
docker compose restart backend  # Flush du store de tokens en mémoire

# 3. Analyser les logs d'audit pour identifier les actions effectuées
# 4. Réinitialiser le mot de passe si le compte est réactivé
```

### Contacts d'urgence

Renseigner selon l'organisation hospitalière :
- DPO (Délégué à la Protection des Données)
- RSSI (Responsable Sécurité des SI)
- Direction médicale
- Équipe technique on-call

---

## Conformité

| Réglementation | Mesure |
|---------------|--------|
| RGPD Art. 25 (Privacy by Design) | Pseudonymisation, chiffrement, minimisation |
| RGPD Art. 32 (Sécurité du traitement) | AES-256, TLS, contrôle d'accès |
| BPC (Bonnes Pratiques Cliniques) | Logs audit append-only, immuabilité analyses validées |
| HDS (Hébergeur Données de Santé) | On-premise, chiffrement au repos et en transit |
