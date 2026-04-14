"""Tests API protocols — nominal, 401, 403, 422, 404, 409."""
import uuid

import pytest
from tests.conftest import auth_headers


BASE = "/api/v1/protocols"

VALID_PROTOCOL = {
    "title": "ONCO-API-TEST",
    "eudract_number": "2024-999999-10",
    "phase": "II",
    "pathology": "Mélanome",
    "summary": "Essai test",
    "promoter": "CHU Test",
    "arc_referent": "ARC Test",
    "criteria": [
        {"type": "INC", "text": "Age >= 18 ans", "order": 0},
        {"type": "EXC", "text": "Grossesse", "order": 1},
    ],
}


@pytest.mark.asyncio
async def test_create_protocol_nominal(client, admin_user):
    resp = await client.post(BASE, json=VALID_PROTOCOL, headers=auth_headers(admin_user))
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "ONCO-API-TEST"
    assert len(data["criteria"]) == 2


@pytest.mark.asyncio
async def test_create_protocol_no_auth(client):
    resp = await client.post(BASE, json=VALID_PROTOCOL)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_protocol_forbidden_tec(client, tec_user):
    resp = await client.post(BASE, json=VALID_PROTOCOL, headers=auth_headers(tec_user))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_protocol_invalid_phase(client, admin_user):
    bad = {**VALID_PROTOCOL, "phase": "V", "eudract_number": "2024-000001-00"}
    resp = await client.post(BASE, json=bad, headers=auth_headers(admin_user))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_protocol_duplicate_eudract(client, admin_user, sample_protocol):
    dup = {**VALID_PROTOCOL, "eudract_number": sample_protocol.eudract_number}
    resp = await client.post(BASE, json=dup, headers=auth_headers(admin_user))
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_get_protocol_nominal(client, admin_user, sample_protocol):
    resp = await client.get(f"{BASE}/{sample_protocol.id}", headers=auth_headers(admin_user))
    assert resp.status_code == 200
    assert resp.json()["id"] == str(sample_protocol.id)


@pytest.mark.asyncio
async def test_get_protocol_not_found(client, admin_user):
    resp = await client.get(f"{BASE}/{uuid.uuid4()}", headers=auth_headers(admin_user))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_protocols_nominal(client, admin_user, sample_protocol):
    resp = await client.get(BASE, headers=auth_headers(admin_user))
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_update_protocol_nominal(client, admin_user, sample_protocol):
    resp = await client.put(
        f"{BASE}/{sample_protocol.id}",
        json={"title": "Updated Title"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated Title"


@pytest.mark.asyncio
async def test_add_criterion_nominal(client, admin_user, sample_protocol):
    resp = await client.post(
        f"{BASE}/{sample_protocol.id}/criteria",
        json={"type": "INC", "text": "Nouveau critère", "order": 10},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201
    assert resp.json()["text"] == "Nouveau critère"


@pytest.mark.asyncio
async def test_delete_criterion_nominal(client, admin_user, sample_protocol, sample_criteria):
    crit = sample_criteria[0]
    resp = await client.delete(
        f"{BASE}/{sample_protocol.id}/criteria/{crit.id}",
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_criterion_not_found(client, admin_user, sample_protocol):
    resp = await client.delete(
        f"{BASE}/{sample_protocol.id}/criteria/{uuid.uuid4()}",
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 404
