"""Structured logging — append-only, audit-compliant (BPC)."""
import logging
import sys
from pathlib import Path

import structlog

from app.core.config import settings


def configure_logging() -> None:
    """Configure structlog for structured JSON logging."""
    log_level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)

    # Ensure log directory exists
    log_path = Path(settings.LOG_FILE)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    # Handlers: stdout + append-only file
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]

    file_handler = logging.FileHandler(settings.LOG_FILE, mode="a", encoding="utf-8")
    file_handler.setLevel(log_level)
    handlers.append(file_handler)

    logging.basicConfig(
        format="%(message)s",
        level=log_level,
        handlers=handlers,
    )

    # Suppress noisy libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    shared_processors: list = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.JSONRenderer(),
        ],
        foreign_pre_chain=shared_processors,
    )

    for handler in handlers:
        handler.setFormatter(formatter)


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
