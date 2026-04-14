"""Tests for LLMService — mock Ollama, retry, temperature, hash."""
import json

import pytest
import respx
from httpx import Response

from app.core.security import hash_prompt
from app.services.llm_service import LLMService, LLMServiceError


VALID_LLM_RESPONSE = json.dumps({
    "verdict": "eligible",
    "score_pct": 90,
    "resume": "Patient potentiellement éligible.",
    "criteres": [],
    "points_attention": [],
})

SAMPLE_PROMPT = "Analyse l'éligibilité du patient au protocole XYZ."


@pytest.mark.asyncio
@respx.mock
async def test_valid_json_response():
    """Mock Ollama avec réponse JSON valide."""
    respx.post("http://ollama:11434/api/generate").mock(
        return_value=Response(200, json={"response": VALID_LLM_RESPONSE})
    )
    respx.post("http://ollama:11434/api/show").mock(
        return_value=Response(200, json={"details": {"parameter_size": "70B"}})
    )

    service = LLMService()
    output, raw, latency = await service.analyze(SAMPLE_PROMPT)
    await service.close()

    assert output.verdict == "eligible"
    assert output.score_pct == 90
    assert latency >= 0


@pytest.mark.asyncio
@respx.mock
async def test_malformed_json_triggers_retry():
    """Mock Ollama avec JSON malformé puis valide au 3e appel."""
    call_count = 0

    def side_effect(request):
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            return Response(200, json={"response": "NOT JSON AT ALL {{{"})
        return Response(200, json={"response": VALID_LLM_RESPONSE})

    respx.post("http://ollama:11434/api/generate").mock(side_effect=side_effect)
    respx.post("http://ollama:11434/api/show").mock(
        return_value=Response(200, json={"details": {"parameter_size": "70B"}})
    )

    service = LLMService()
    output, raw, latency = await service.analyze(SAMPLE_PROMPT)
    await service.close()

    assert output.verdict == "eligible"
    assert call_count == 3  # 2 échecs + 1 succès


@pytest.mark.asyncio
@respx.mock
async def test_all_retries_exhausted():
    """Mock Ollama qui renvoie toujours du JSON invalide -> LLMServiceError."""
    respx.post("http://ollama:11434/api/generate").mock(
        return_value=Response(200, json={"response": "INVALID JSON EVERY TIME"})
    )

    service = LLMService()
    with pytest.raises(LLMServiceError, match="invalid JSON"):
        await service.analyze(SAMPLE_PROMPT)
    await service.close()


@pytest.mark.asyncio
@respx.mock
async def test_temperature_zero_in_payload():
    """Vérifier que temperature=0 est envoyé dans la requête Ollama."""
    captured_payload = {}

    def capture(request):
        nonlocal captured_payload
        captured_payload = json.loads(request.content)
        return Response(200, json={"response": VALID_LLM_RESPONSE})

    respx.post("http://ollama:11434/api/generate").mock(side_effect=capture)
    respx.post("http://ollama:11434/api/show").mock(
        return_value=Response(200, json={"details": {"parameter_size": "70B"}})
    )

    service = LLMService()
    await service.analyze(SAMPLE_PROMPT)
    await service.close()

    assert captured_payload.get("options", {}).get("temperature") == 0


@pytest.mark.asyncio
async def test_prompt_hash_calculation():
    """Vérifier que le hash SHA-256 du prompt est calculé correctement."""
    import hashlib
    prompt = "Test prompt pour hash."
    expected_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    calculated = hash_prompt(prompt)
    assert calculated == expected_hash
    assert len(calculated) == 64


@pytest.mark.asyncio
@respx.mock
async def test_ollama_timeout():
    """Mock Ollama qui timeout -> erreur propre (LLMServiceError via HTTPError)."""
    import httpx
    respx.post("http://ollama:11434/api/generate").mock(
        side_effect=httpx.TimeoutException("Connection timeout")
    )

    service = LLMService()
    with pytest.raises(Exception):
        await service.analyze(SAMPLE_PROMPT)
    await service.close()
