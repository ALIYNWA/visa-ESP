"""
Stockage persistant des paramètres de notification.
Les credentials Twilio restent dans .env (sécurité).
Les numéros de téléphone sont gérés via l'interface web et sauvegardés ici.
"""
import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

STORE_PATH = Path(__file__).parent / "notif_settings.json"

DEFAULT_SETTINGS = {
    # Telegram
    "telegram_enabled": False,
    "telegram_bot_token": "",   # ex: 123456:ABCdef...
    "telegram_chat_ids": [],    # ex: ["123456789"]
    # Twilio (conservé pour compatibilité)
    "sms_enabled": False,
    "sms_numbers": [],
    "whatsapp_enabled": False,
    "whatsapp_numbers": [],
    "twilio_account_sid": "",
    "twilio_auth_token": "",
    "twilio_phone_from": "",
    "twilio_whatsapp_from": "whatsapp:+14155238886",
}


def load() -> dict:
    if STORE_PATH.exists():
        try:
            with open(STORE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            # Fusionner avec les defaults pour les nouvelles clés
            merged = {**DEFAULT_SETTINGS, **data}
            return merged
        except Exception as e:
            logger.error(f"Erreur lecture notif_settings.json : {e}")
    return dict(DEFAULT_SETTINGS)


def save(data: dict) -> bool:
    try:
        # Ne jamais sauvegarder le token en clair dans les logs
        with open(STORE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Erreur sauvegarde notif_settings.json : {e}")
        return False


def get_masked(data: dict) -> dict:
    """Retourne les paramètres avec les tokens masqués pour l'affichage frontend."""
    masked = dict(data)
    if masked.get("twilio_auth_token"):
        tok = masked["twilio_auth_token"]
        masked["twilio_auth_token"] = tok[:4] + "****" + tok[-4:] if len(tok) > 8 else "****"
    if masked.get("telegram_bot_token"):
        tok = masked["telegram_bot_token"]
        masked["telegram_bot_token"] = tok[:6] + "****" + tok[-4:] if len(tok) > 10 else "****"
    return masked


def twilio_configured(data: dict) -> bool:
    return bool(
        data.get("twilio_account_sid", "").strip().startswith("AC") and
        data.get("twilio_auth_token", "").strip() and
        data.get("twilio_phone_from", "").strip()
    )


def telegram_configured(data: dict) -> bool:
    return bool(
        data.get("telegram_bot_token", "").strip() and
        data.get("telegram_chat_ids", [])
    )
