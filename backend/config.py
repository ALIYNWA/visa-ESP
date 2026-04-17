"""
Configuration chargée depuis le fichier .env
"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # --- Monitoring Espagne (BLS) ---
    TARGET_URL: str = "https://algeria.blsspainglobal.com/DZA/account/login"
    VISA_CATEGORY: str = "Spain"
    VISA_SUBCATEGORY: str = "Short Stay"

    # --- Monitoring France (Capago – depuis mars 2025) ---
    FRANCE_TARGET_URL: str = "https://fr-dz.capago.eu/rendezvous/"
    FRANCE_VISA_CATEGORY: str = "France"
    FRANCE_VISA_SUBCATEGORY: str = "Court séjour"

    CHECK_INTERVAL_MIN: int = 30   # secondes
    CHECK_INTERVAL_MAX: int = 90   # secondes
    MAX_RETRIES: int = 3
    RETRY_BACKOFF_BASE: float = 2.0  # exponentiel

    # --- Playwright ---
    HEADLESS: bool = True
    BROWSER_TIMEOUT: int = 30000  # ms

    # --- Proxy (optionnel — pour accès depuis serveur hors Algérie) ---
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
    TWILIO_PHONE_FROM: str = ""
    NOTIFY_PHONE: str = ""

    # --- Twilio WhatsApp ---
    ENABLE_WHATSAPP: bool = False
    TWILIO_WHATSAPP_FROM: str = "whatsapp:+14155238886"
    NOTIFY_WHATSAPP: str = ""

    # --- Alertes ---
    ALERT_COOLDOWN_MINUTES: int = 15

    # --- Serveur ---
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    LOG_LEVEL: str = "INFO"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
