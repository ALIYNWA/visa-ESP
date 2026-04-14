# VisaMonitor – Surveillance rendez-vous visa Espagne · Alger

Dashboard temps réel pour détecter la disponibilité de créneaux de rendez-vous
visa sur le site BLS Spain Visa Algeria, avec notifications multi-canaux.

---

## Structure du projet

```
screenMatch/
├── backend/
│   ├── main.py          # FastAPI + WebSocket
│   ├── monitor.py       # Boucle de surveillance
│   ├── scraper.py       # Playwright (éthique)
│   ├── notifier.py      # Email / SMS / WhatsApp
│   ├── config.py        # Settings depuis .env
│   ├── models.py        # Pydantic models
│   └── requirements.txt
├── frontend/
│   ├── index.html       # Dashboard
│   ├── app.js           # WebSocket + UI
│   └── style.css        # Design
├── logs/                # Fichiers de log
├── .env.example         # Template de configuration
└── .gitignore
```

---

## Installation

### 1. Prérequis
- Python 3.11+
- pip

### 2. Environnement virtuel

```bash
cd screenMatch/backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# Linux/Mac
source .venv/bin/activate
```

### 3. Dépendances

```bash
pip install -r requirements.txt
playwright install chromium
```

### 4. Configuration

```bash
# Copier le template
cp .env.example .env
# Éditer .env avec vos paramètres
```

### 5. Lancement

```bash
cd backend
python main.py
```

Ouvrir le navigateur : **http://localhost:8000**

---

## Notifications

### Email (Gmail)

1. Activer la validation en 2 étapes sur votre compte Google
2. Générer un **Mot de passe d'application** : Google Account → Sécurité → Mots de passe des applications
3. Dans `.env` :
   ```
   ENABLE_EMAIL=true
   SMTP_USER=votre@gmail.com
   SMTP_PASSWORD=xxxx xxxx xxxx xxxx
   NOTIFY_EMAIL=cible@example.com
   ```

### SMS / WhatsApp (Twilio)

1. Créer un compte sur [twilio.com](https://www.twilio.com)
2. Récupérer `Account SID` et `Auth Token`
3. Pour WhatsApp : activer le [Twilio WhatsApp Sandbox](https://www.twilio.com/console/sms/whatsapp/learn)
4. Dans `.env` :
   ```
   ENABLE_SMS=true
   TWILIO_ACCOUNT_SID=ACxxx...
   TWILIO_AUTH_TOKEN=xxx...
   TWILIO_PHONE_FROM=+15551234567
   NOTIFY_PHONE=+213XXXXXXXXX
   ```

---

## Adaptation des sélecteurs CSS

Le scraper doit être adapté selon la structure HTML réelle du site BLS.
Pour trouver les bons sélecteurs :

1. Ouvrir https://www.blsspainvisa.com/algeria/bookappointment.php
2. Ouvrir les DevTools (F12) → onglet Elements
3. Inspecter les dropdowns et le calendrier
4. Mettre à jour dans `scraper.py` :
   - `_fill_appointment_form()` → sélecteurs des formulaires
   - `_detect_availability()` → sélecteurs du calendrier

---

## Anti-blocage – Bonnes pratiques

| Pratique | Implémentation |
|---|---|
| Délai humain aléatoire | 30–90s entre checks |
| Rotation User-Agent | 5 profils navigateur |
| Délais internes | 0.8–2.5s entre actions |
| Retry exponentiel | Base 2x, max 3 tentatives |
| Pas d'automatisation | Lecture seule, aucune soumission |
| Headers réalistes | Accept-Language, DNT, etc. |

---

## API REST

| Endpoint | Méthode | Description |
|---|---|---|
| `/` | GET | Dashboard (HTML) |
| `/api/status` | GET | Statut complet du monitor |
| `/api/start` | POST | Démarrer la surveillance |
| `/api/stop` | POST | Arrêter la surveillance |
| `/api/history?limit=50` | GET | Historique des checks |
| `/api/health` | GET | Health check |
| `/ws` | WS | Flux temps réel |

---

## Usage éthique

- Ce moniteur **lit uniquement** la disponibilité, sans soumettre de formulaire
- Aucune réservation automatisée
- Respecte les délais raisonnables entre requêtes
- Conforme à une utilisation normale du site BLS
