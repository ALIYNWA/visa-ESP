"""
Configuration chargée depuis le fichier .env
"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # --- Monitoring ---
    TARGET_URL: str = "https://algeria.blsspainglobal.com/DZA/account/login"
    VISA_CATEGORY: str = "Spain"
    VISA_SUBCATEGORY: str = "Short Stay"
    CHECK_INTERVAL_MIN: int = 30   # secondes
    CHECK_INTERVAL_MAX: int = 90   # secondes
    MAX_RETRIES: int = 3
    RETRY_BACKOFF_BASE: float = 2.0  # exponentiel

    # --- Playwright ---
    HEADLESS: bool = True
    BROWSER_TIMEOUT: int = 30000  # ms

    # --- Proxy (optionnel — pour accès depuis serveur hors Algérie) ---
    # Format: http://ip:port  ou  http://user:pass@ip:port
    PROXY_SERVER: str = ""
    PROXY_USERNAME: str = ""
    PROXY_PASSWORD: str = ""

    # --- Email (SMTP) ---
    ENABLE_EMAIL: bool = False
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    NOTIFY_EMAIL: str = ""

    # --- Twilio SMS ---
    ENABLE_SMS: bool = False
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_PHONE_FROM: str = ""   # ex: +15551234567
    NOTIFY_PHONE: str = ""        # ex: +213XXXXXXXXX

    # --- Twilio WhatsApp ---
    ENABLE_WHATSAPP: bool = False
    TWILIO_WHATSAPP_FROM: str = "whatsapp:+14155238886"  # sandbox Twilio
    NOTIFY_WHATSAPP: str = ""     # ex: whatsapp:+213XXXXXXXXX

    # --- Alertes ---
    ALERT_COOLDOWN_MINUTES: int = 15  # délai min entre deux alertes

    # --- Serveur ---
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    LOG_LEVEL: str = "INFO"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
