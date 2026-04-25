from pathlib import Path
from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# Charge explicitement le .env avant que pydantic ne lise l'environnement
_ENV_FILE = Path(__file__).parent / ".env"
load_dotenv(_ENV_FILE, override=False)


class Settings(BaseSettings):
    ANTHROPIC_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-opus-4-5-20251101"
    MAX_INPUT_CHARS: int = 80_000
    HOST: str = "0.0.0.0"
    PORT: int = 8001
    LOG_LEVEL: str = "INFO"
    SCRAPE_INTERVAL_SECONDS: int = 21_600

    model_config = {"extra": "ignore"}


settings = Settings()
