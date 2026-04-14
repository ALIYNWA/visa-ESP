"""
Système de notifications multi-canaux avec cooldown anti-spam
- Email via SMTP
- SMS via Twilio (numéros gérés depuis l'UI)
- WhatsApp via Twilio (numéros gérés depuis l'UI)
"""
import smtplib
import logging
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional

from config import settings
from models import CheckResult
import notification_store as store

logger = logging.getLogger(__name__)


# ------------------------------------------------------------------
# Cooldown anti-spam
# ------------------------------------------------------------------
class NotificationCooldown:
    def __init__(self, cooldown_minutes: int):
        self.cooldown_minutes = cooldown_minutes
        self._last_sent: Optional[datetime] = None

    @property
    def last_sent(self) -> Optional[datetime]:
        return self._last_sent

    def can_notify(self) -> bool:
        if self._last_sent is None:
            return True
        elapsed = (datetime.now(timezone.utc) - self._last_sent).total_seconds() / 60
        return elapsed >= self.cooldown_minutes

    def mark_sent(self):
        self._last_sent = datetime.now(timezone.utc)

    def next_allowed_in(self) -> float:
        if self._last_sent is None:
            return 0.0
        elapsed = (datetime.now(timezone.utc) - self._last_sent).total_seconds() / 60
        return max(0.0, self.cooldown_minutes - elapsed)


cooldown = NotificationCooldown(settings.ALERT_COOLDOWN_MINUTES)


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
def _build_sms_body(result: CheckResult) -> str:
    ts = result.timestamp.strftime("%d/%m %H:%M")
    return (
        f"ALERTE VisaMonitor : Creneau visa Espagne disponible ! "
        f"{result.slots_count} creneau(x) - {ts}. "
        f"Reservez sur {settings.TARGET_URL}"
    )


def _build_whatsapp_body(result: CheckResult) -> str:
    ts = result.timestamp.strftime("%d/%m/%Y a %H:%M UTC")
    slots = f"\nCreneaux : {result.slots_count}" if result.slots_count > 0 else ""
    return (
        f"ALERTE VisaMonitor\n\n"
        f"Creneau visa Espagne disponible !\n"
        f"Date : {ts}{slots}\n"
        f"Detail : {result.message}\n\n"
        f"Reservez sur : {settings.TARGET_URL}"
    )


def _get_twilio_client(cfg: dict):
    from twilio.rest import Client
    return Client(cfg["twilio_account_sid"], cfg["twilio_auth_token"])


# ------------------------------------------------------------------
# Telegram
# ------------------------------------------------------------------
def send_telegram(result: CheckResult, cfg: dict = None) -> tuple[bool, str]:
    """Envoie une notification Telegram à tous les chat_ids configurés."""
    if cfg is None:
        cfg = store.load()

    if not cfg.get("telegram_enabled"):
        return False, "Telegram désactivé"

    token = cfg.get("telegram_bot_token", "").strip()
    chat_ids = [str(c).strip() for c in cfg.get("telegram_chat_ids", []) if str(c).strip()]

    if not token or not chat_ids:
        return False, "Token ou chat_id manquant"

    ts = result.timestamp.strftime("%d/%m/%Y a %H:%M UTC")
    slots = f"\nCreneaux detectes : {result.slots_count}" if result.slots_count > 0 else ""
    text = (
        f"ALERTE - Creneau visa Espagne disponible !\n\n"
        f"Date : {ts}{slots}\n"
        f"Reservez sur : {settings.TARGET_URL}"
    )

    import urllib.request, json as _json
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    sent_to = []
    errors = []

    for chat_id in chat_ids:
        try:
            payload = _json.dumps({"chat_id": chat_id, "text": text}).encode()
            req = urllib.request.Request(
                url, data=payload,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = _json.loads(resp.read())
                if data.get("ok"):
                    sent_to.append(chat_id)
                    logger.info(f"Telegram envoye a {chat_id}")
                else:
                    errors.append(f"{chat_id}: {data.get('description','erreur')}")
        except Exception as e:
            errors.append(f"{chat_id}: {e}")
            logger.error(f"Telegram erreur pour {chat_id}: {e}")

    if sent_to:
        return True, f"Telegram envoye a {', '.join(sent_to)}"
    return False, "; ".join(errors) or "Echec envoi Telegram"


# ------------------------------------------------------------------
# Envoi SMS
# ------------------------------------------------------------------
def send_sms(result: CheckResult, cfg: dict = None) -> tuple[bool, str]:
    """
    Envoie SMS à tous les numéros configurés.
    Retourne (succès, message).
    """
    if cfg is None:
        cfg = store.load()

    if not cfg.get("sms_enabled"):
        return False, "SMS désactivé"

    numbers = [n.strip() for n in cfg.get("sms_numbers", []) if n.strip()]
    if not numbers:
        return False, "Aucun numéro SMS configuré"

    if not store.twilio_configured(cfg):
        return False, "Credentials Twilio incomplets"

    try:
        client = _get_twilio_client(cfg)
        body = _build_sms_body(result)
        sent_to = []
        for number in numbers:
            msg = client.messages.create(
                body=body,
                from_=cfg["twilio_phone_from"],
                to=number,
            )
            sent_to.append(number)
            logger.info(f"SMS envoyé à {number} ({msg.sid})")
        return True, f"SMS envoyé à {', '.join(sent_to)}"

    except ImportError:
        return False, "Twilio non installé (pip install twilio)"
    except Exception as e:
        logger.error(f"Erreur SMS : {e}")
        return False, str(e)


# ------------------------------------------------------------------
# Envoi WhatsApp
# ------------------------------------------------------------------
def send_whatsapp(result: CheckResult, cfg: dict = None) -> tuple[bool, str]:
    """
    Envoie WhatsApp à tous les numéros configurés.
    """
    if cfg is None:
        cfg = store.load()

    if not cfg.get("whatsapp_enabled"):
        return False, "WhatsApp désactivé"

    numbers = [n.strip() for n in cfg.get("whatsapp_numbers", []) if n.strip()]
    if not numbers:
        return False, "Aucun numéro WhatsApp configuré"

    if not store.twilio_configured(cfg):
        return False, "Credentials Twilio incomplets"

    try:
        client = _get_twilio_client(cfg)
        body = _build_whatsapp_body(result)
        wa_from = cfg.get("twilio_whatsapp_from", "whatsapp:+14155238886")
        sent_to = []
        for number in numbers:
            to = f"whatsapp:{number}" if not number.startswith("whatsapp:") else number
            msg = client.messages.create(body=body, from_=wa_from, to=to)
            sent_to.append(number)
            logger.info(f"WhatsApp envoyé à {number} ({msg.sid})")
        return True, f"WhatsApp envoyé à {', '.join(sent_to)}"

    except ImportError:
        return False, "Twilio non installé (pip install twilio)"
    except Exception as e:
        logger.error(f"Erreur WhatsApp : {e}")
        return False, str(e)


# ------------------------------------------------------------------
# Email (inchangé)
# ------------------------------------------------------------------
def send_email(result: CheckResult) -> tuple[bool, str]:
    if not settings.ENABLE_EMAIL:
        return False, "Email désactivé"
    if not all([settings.SMTP_USER, settings.SMTP_PASSWORD, settings.NOTIFY_EMAIL]):
        return False, "Configuration SMTP incomplète"

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "ALERTE - Creneau visa Espagne disponible !"
        msg["From"] = settings.SMTP_USER
        msg["To"] = settings.NOTIFY_EMAIL
        body_text = (
            f"Creneau visa Espagne disponible !\n"
            f"Heure : {result.timestamp.strftime('%d/%m/%Y %H:%M')} UTC\n"
            f"Creneaux : {result.slots_count}\n"
            f"URL : {settings.TARGET_URL}"
        )
        msg.attach(MIMEText(body_text, "plain", "utf-8"))
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_USER, settings.NOTIFY_EMAIL, msg.as_string())
        logger.info(f"Email envoyé à {settings.NOTIFY_EMAIL}")
        return True, f"Email envoyé à {settings.NOTIFY_EMAIL}"
    except Exception as e:
        logger.error(f"Erreur email : {e}")
        return False, str(e)


# ------------------------------------------------------------------
# Notification principale
# ------------------------------------------------------------------
def notify(result: CheckResult) -> dict:
    """Envoie toutes les notifications si disponible et cooldown respecté."""
    if not result.available:
        return {"sent": False, "reason": "Pas de disponibilité"}

    if not cooldown.can_notify():
        remaining = cooldown.next_allowed_in()
        return {"sent": False, "reason": f"Cooldown ({remaining:.1f} min restantes)"}

    cfg = store.load()
    channels = []
    errors = []

    ok, msg = send_email(result)
    if ok:
        channels.append("email")
    elif settings.ENABLE_EMAIL:
        errors.append(f"email: {msg}")

    ok, msg = send_telegram(result, cfg)
    if ok:
        channels.append("telegram")
    elif cfg.get("telegram_enabled"):
        errors.append(f"telegram: {msg}")

    ok, msg = send_sms(result, cfg)
    if ok:
        channels.append("sms")
    elif cfg.get("sms_enabled"):
        errors.append(f"sms: {msg}")

    ok, msg = send_whatsapp(result, cfg)
    if ok:
        channels.append("whatsapp")
    elif cfg.get("whatsapp_enabled"):
        errors.append(f"whatsapp: {msg}")

    if channels:
        cooldown.mark_sent()
        logger.info(f"Notifications envoyées via : {', '.join(channels)}")
        return {"sent": True, "channels": channels}

    reason = "; ".join(errors) if errors else "Aucun canal actif"
    return {"sent": False, "reason": reason}


# ------------------------------------------------------------------
# Test (envoi d'un message factice pour vérifier la config)
# ------------------------------------------------------------------
def test_notification(channel: str, number: str, cfg: dict) -> tuple[bool, str]:
    """
    Envoie un message de test sur le canal spécifié au numéro donné.
    """
    from models import CheckResult
    from datetime import datetime, timezone
    fake = CheckResult(
        timestamp=datetime.now(timezone.utc),
        available=True,
        slots_count=3,
        message="TEST - Verification de la configuration VisaMonitor",
    )

    if channel == "telegram":
        test_cfg = {**cfg, "telegram_enabled": True, "telegram_chat_ids": [number]}
        return send_telegram(fake, test_cfg)
    elif channel == "sms":
        test_cfg = {**cfg, "sms_enabled": True, "sms_numbers": [number]}
        return send_sms(fake, test_cfg)
    elif channel == "whatsapp":
        test_cfg = {**cfg, "whatsapp_enabled": True, "whatsapp_numbers": [number]}
        return send_whatsapp(fake, test_cfg)
    else:
        return False, f"Canal inconnu : {channel}"
