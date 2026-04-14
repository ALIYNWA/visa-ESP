"""LLM service — Ollama/Meditron with retry logic and strict JSON validation."""
import json
import time
from typing import Any

import httpx
from pydantic import ValidationError

from app.core.config import settings
from app.core.logging import get_logger
from app.schemas.llm import LLMAnalysisOutput

logger = get_logger(__name__)


class LLMServiceError(Exception):
    """Raised when LLM fails after all retries."""


class LLMService:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=settings.OLLAMA_BASE_URL,
            timeout=settings.OLLAMA_TIMEOUT,
        )

    async def analyze(self, prompt: str) -> tuple[LLMAnalysisOutput, str, int]:
        """
        Call Meditron via Ollama with retry on invalid JSON.

        Returns:
            (parsed_output, raw_response_text, latency_ms)
        Raises:
            LLMServiceError: after LLM_MAX_RETRIES failures
        """
        last_error: Exception | None = None

        for attempt in range(1, settings.LLM_MAX_RETRIES + 1):
            start_ms = int(time.monotonic() * 1000)
            raw_response = ""
            try:
                raw_response = await self._call_ollama(prompt)
                parsed = self._parse_response(raw_response)
                latency_ms = int(time.monotonic() * 1000) - start_ms

                if attempt > 1:
                    logger.info(
                        "llm_retry_succeeded",
                        attempt=attempt,
                        latency_ms=latency_ms,
                    )

                return parsed, raw_response, latency_ms

            except (json.JSONDecodeError, ValidationError, ValueError) as exc:
                latency_ms = int(time.monotonic() * 1000) - start_ms
                last_error = exc
                logger.warning(
                    "llm_invalid_json_retry",
                    attempt=attempt,
                    max_retries=settings.LLM_MAX_RETRIES,
                    error=str(exc),
                    raw_preview=raw_response[:200] if raw_response else "",
                    latency_ms=latency_ms,
                )

        raise LLMServiceError(
            f"LLM returned invalid JSON after {settings.LLM_MAX_RETRIES} attempts. "
            f"Last error: {last_error}"
        )

    async def _call_ollama(self, prompt: str) -> str:
        """Send request to Ollama API."""
        payload: dict[str, Any] = {
            "model": settings.OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": settings.LLM_TEMPERATURE,  # MUST be 0 (déterminisme)
                "num_predict": 4096,
            },
        }

        response = await self._client.post("/api/generate", json=payload)
        response.raise_for_status()

        data = response.json()
        return data.get("response", "")

    def _parse_response(self, raw: str) -> LLMAnalysisOutput:
        """Extract and validate JSON from LLM response."""
        cleaned = raw.strip()

        # Chercher le premier { et dernier } pour extraire le JSON
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise json.JSONDecodeError("No JSON object found", cleaned, 0)

        json_str = cleaned[start:end + 1]
        data = json.loads(json_str)
        return LLMAnalysisOutput.model_validate(data)

    async def get_model_info(self) -> dict[str, Any]:
        """Retrieve model info from Ollama."""
        try:
            response = await self._client.post(
                "/api/show",
                json={"name": settings.OLLAMA_MODEL},
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError:
            return {"name": settings.OLLAMA_MODEL, "version": "unknown"}

    async def close(self) -> None:
        await self._client.aclose()


# Singleton
_llm_service: LLMService | None = None


def get_llm_service() -> LLMService:
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
    return _llm_service
