"""Application configuration via Pydantic Settings."""
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    APP_ENV: Literal["development", "test", "production"] = "production"
    APP_SECRET_KEY: str = Field(min_length=32)
    APP_DEBUG: bool = False
    CORS_ORIGINS: str = "http://localhost:3000"

    # Base de données
    DATABASE_URL: str

    # Chiffrement
    ENCRYPTION_KEY: str = Field(min_length=32)
    ENCRYPTION_SALT: str = Field(min_length=16)
    PBKDF2_ITERATIONS: int = 600000

    # JWT
    JWT_SECRET_KEY: str = Field(min_length=32)
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Ollama
    OLLAMA_BASE_URL: str = "http://ollama:11434"
    OLLAMA_MODEL: str = "meditron:70b"
    OLLAMA_TIMEOUT: int = 300
    LLM_MAX_RETRIES: int = 3
    LLM_TEMPERATURE: float = 0.0

    # Rate limiting
    RATE_LIMIT_LOGIN_ATTEMPTS: int = 5
    RATE_LIMIT_WINDOW_MINUTES: int = 15
    RATE_LIMIT_LOCKOUT_MINUTES: int = 30

    # Logs
    LOG_LEVEL: str = "INFO"
    LOG_FILE: str = "/app/logs/trialmatch.jsonl"

    # LDAP
    LDAP_ENABLED: bool = False
    LDAP_SERVER: str = ""
    LDAP_BASE_DN: str = ""
    LDAP_BIND_DN: str = ""
    LDAP_BIND_PASSWORD: str = ""
    LDAP_USER_SEARCH_BASE: str = ""

    @field_validator("LLM_TEMPERATURE")
    @classmethod
    def temperature_must_be_zero(cls, v: float) -> float:
        if v != 0.0:
            raise ValueError("LLM temperature must be 0.0 for deterministic results")
        return v

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    @property
    def is_test(self) -> bool:
        return self.APP_ENV == "test"

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
