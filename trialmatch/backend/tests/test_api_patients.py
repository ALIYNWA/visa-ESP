"""Tests API patients — nominal, 401, 403, 422, 404, 409."""
import uuid

import pytest
from tests.conftest import auth_headers

BASE = "/api/v1/patients"

VALID_PATIENT = {
    "pseudonym": "TEST-PAT-API-001",
    "context": {
        "age": 55,
        "sexe": "F",
        "diagnostic_principal": "Cancer du sein",
        "stade": "II",
        "ecog_performance_status": 0,
        "traitements_en_cours": [],
        "biologie": {"hemoglobine": "13.5 g/dL"},
        "antecedents": [],
    },
}


@pytest.mark.asyncio
async def test_create_patient_nominal(client, admin_user):
    resp = await client.post(BASE, json=VALID_PATIENT, headers=auth_headers(admin_user))
    assert resp.status_code == 201
    data = resp.json()
    assert data["pseudonym"] == "TEST-PAT-API-001"
    # Le contexte doit être retourné déchiffré
    assert data["context"]["age"] == 55


@pytest.mark.asyncio
async def test_create_patient_no_auth(client):
    resp = await client.post(BASE, json=VALID_PATIENT)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_patient_tec_forbidden(client, tec_user):
    resp = await client.post(BASE, json=VALID_PATIENT, headers=auth_headers(tec_user))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_patient_missing_pseudonym(client, admin_user):
    bad = {"context": VALID_PATIENT["context"]}
    resp = await client.post(BASE, json=bad, headers=auth_headers(admin_user))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_patient_duplicate_pseudonym(client, admin_user, sample_patient):
    dup = {**VALID_PATIENT, "pseudonym": sample_patient.pseudonym}
    resp = await client.post(BASE, json=dup, headers=auth_headers(admin_user))
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_get_patient_nominal(client, admin_user, sample_patient):
    resp = await client.get(f"{BASE}/{sample_patient.id}", headers=auth_headers(admin_user))
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == str(sample_patient.id)
    assert data["context"] is not None  # Contexte déchiffré


@pytest.mark.asyncio
async def test_get_patient_not_found(client, admin_user):
    resp = await client.get(f"{BASE}/{uuid.uuid4()}", headers=auth_headers(admin_user))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_patients_nominal(client, admin_user, sample_patient):
    resp = await client.get(BASE, headers=auth_headers(admin_user))
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    # Contexte NE doit PAS apparaître dans la liste (ListItem)
    items = resp.json()
    assert all("context" not in item for item in items)


@pytest.mark.asyncio
async def test_update_patient_nominal(client, admin_user, sample_patient):
    resp = await client.put(
        f"{BASE}/{sample_patient.id}",
        json={"pseudonym": "UPDATED-PSEUDONYM"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200
    assert resp.json()["pseudonym"] == "UPDATED-PSEUDONYM"


@pytest.mark.asyncio
async def test_get_patient_no_auth(client, sample_patient):
    resp = await client.get(f"{BASE}/{sample_patient.id}")
    assert resp.status_code == 401
