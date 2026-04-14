"""Tests API analyses — nominal, auth, permissions, validation, override."""
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from tests.conftest import auth_headers, make_mock_llm

from app.api.deps import get_eligibility_engine
from app.main import app
from app.schemas.llm import CriterionLLMResult, LLMAnalysisOutput
from app.services.audit_service import AuditService
from app.services.eligibility_engine import EligibilityEngine

BASE = "/api/v1/analyses"


def override_engine(criteria):
    """Override the eligibility engine dependency with a mock."""
    mock_llm = make_mock_llm(criteria, verdict="eligible")
    audit = MagicMock(spec=AuditService)
    audit.log = AsyncMock(return_value=MagicMock())
    engine = EligibilityEngine(mock_llm, audit)

    app.dependency_overrides[get_eligibility_engine] = lambda: engine
    return engine


@pytest.mark.asyncio
async def test_create_analysis_nominal(client, admin_user, sample_protocol, sample_patient, sample_criteria, db):
    override_engine(sample_criteria)
    resp = await client.post(
        BASE,
        json={"protocol_id": str(sample_protocol.id), "patient_id": str(sample_patient.id)},
        headers=auth_headers(admin_user),
    )
    app.dependency_overrides.pop(get_eligibility_engine, None)
    assert resp.status_code == 201
    data = resp.json()
    assert data["verdict"] == "eligible"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_analysis_no_auth(client, sample_protocol, sample_patient):
    resp = await client.post(
        BASE,
        json={"protocol_id": str(sample_protocol.id), "patient_id": str(sample_patient.id)},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_analysis_tec_forbidden(client, tec_user, sample_protocol, sample_patient):
    resp = await client.post(
        BASE,
        json={"protocol_id": str(sample_protocol.id), "patient_id": str(sample_patient.id)},
        headers=auth_headers(tec_user),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_analysis_protocol_not_found(client, admin_user, sample_patient, sample_criteria):
    override_engine(sample_criteria)
    resp = await client.post(
        BASE,
        json={"protocol_id": str(uuid.uuid4()), "patient_id": str(sample_patient.id)},
        headers=auth_headers(admin_user),
    )
    app.dependency_overrides.pop(get_eligibility_engine, None)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_analysis_not_found(client, admin_user):
    resp = await client.get(f"{BASE}/{uuid.uuid4()}", headers=auth_headers(admin_user))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_validate_analysis_nominal(client, investigateur_user, sample_protocol, sample_patient, sample_criteria):
    override_engine(sample_criteria)
    create_resp = await client.post(
        BASE,
        json={"protocol_id": str(sample_protocol.id), "patient_id": str(sample_patient.id)},
        headers=auth_headers(investigateur_user),
    )
    app.dependency_overrides.pop(get_eligibility_engine, None)
    assert create_resp.status_code == 201
    analysis_id = create_resp.json()["id"]

    val_resp = await client.post(
        f"{BASE}/{analysis_id}/validate",
        json={"signature_note": "Validé par investigateur."},
        headers=auth_headers(investigateur_user),
    )
    assert val_resp.status_code == 200
    assert val_resp.json()["validated_at"] is not None


@pytest.mark.asyncio
async def test_validate_analysis_arc_forbidden(client, arc_user, sample_protocol, sample_patient, sample_criteria):
    override_engine(sample_criteria)
    create_resp = await client.post(
        BASE,
        json={"protocol_id": str(sample_protocol.id), "patient_id": str(sample_patient.id)},
        headers=auth_headers(arc_user),
    )
    app.dependency_overrides.pop(get_eligibility_engine, None)
    assert create_resp.status_code == 201
    analysis_id = create_resp.json()["id"]

    val_resp = await client.post(
        f"{BASE}/{analysis_id}/validate",
        json={},
        headers=auth_headers(arc_user),
    )
    assert val_resp.status_code == 403


@pytest.mark.asyncio
async def test_double_validation_conflict(client, investigateur_user, sample_protocol, sample_patient, sample_criteria):
    override_engine(sample_criteria)
    create_resp = await client.post(
        BASE,
        json={"protocol_id": str(sample_protocol.id), "patient_id": str(sample_patient.id)},
        headers=auth_headers(investigateur_user),
    )
    app.dependency_overrides.pop(get_eligibility_engine, None)
    analysis_id = create_resp.json()["id"]

    # Première validation OK
    await client.post(f"{BASE}/{analysis_id}/validate", json={}, headers=auth_headers(investigateur_user))
    # Deuxième validation -> 409
    resp2 = await client.post(f"{BASE}/{analysis_id}/validate", json={}, headers=auth_headers(investigateur_user))
    assert resp2.status_code == 409


@pytest.mark.asyncio
async def test_list_analyses_by_patient(client, admin_user, sample_protocol, sample_patient, sample_criteria):
    override_engine(sample_criteria)
    await client.post(
        BASE,
        json={"protocol_id": str(sample_protocol.id), "patient_id": str(sample_patient.id)},
        headers=auth_headers(admin_user),
    )
    app.dependency_overrides.pop(get_eligibility_engine, None)

    resp = await client.get(f"{BASE}?patient_id={sample_patient.id}", headers=auth_headers(admin_user))
    assert resp.status_code == 200
    assert len(resp.json()) >= 1
