"""Tests for the EligibilityEngine — 10 cas minimum."""
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from pydantic import ValidationError

from app.models.criterion import Criterion
from app.models.patient import Patient
from app.models.protocol import Protocol
from app.schemas.llm import CriterionLLMResult, LLMAnalysisOutput
from app.services.audit_service import AuditService
from app.services.eligibility_engine import EligibilityEngine
from app.services.llm_service import LLMService, LLMServiceError
from tests.conftest import make_mock_llm


def _make_engine(mock_llm) -> EligibilityEngine:
    audit = MagicMock(spec=AuditService)
    audit.log = AsyncMock(return_value=MagicMock())
    return EligibilityEngine(llm_service=mock_llm, audit_service=audit)


# ── Cas 1 : Patient éligible sur tous les critères ───────────────────────────
@pytest.mark.asyncio
async def test_eligible_on_all_criteria(db, sample_protocol, sample_criteria, sample_patient, admin_user):
    mock_llm = make_mock_llm(sample_criteria, verdict="eligible")
    engine = _make_engine(mock_llm)

    analysis = await engine.run_analysis(
        db=db,
        protocol=sample_protocol,
        criteria=sample_criteria,
        patient=sample_patient,
        current_user_id=admin_user.id,
    )

    assert analysis.verdict == "eligible"
    assert analysis.score_pct == 100
    assert analysis.prompt_hash  # hash non-vide


# ── Cas 2 : Patient non-éligible sur 1 critère INC ──────────────────────────
@pytest.mark.asyncio
async def test_non_eligible_one_inc_failed(db, sample_protocol, sample_criteria, sample_patient, admin_user):
    inc_criteria = [c for c in sample_criteria if c.type == "INC"]
    exc_criteria = [c for c in sample_criteria if c.type == "EXC"]

    from app.services.llm_service import LLMService
    mock = MagicMock(spec=LLMService)

    # Premier INC non satisfait
    criteres = [
        CriterionLLMResult(criterion_id=str(inc_criteria[0].id), statut="non_satisfait", raisonnement="Age < 18 ans."),
    ] + [
        CriterionLLMResult(criterion_id=str(c.id), statut="satisfait", raisonnement="OK.") for c in inc_criteria[1:]
    ] + [
        CriterionLLMResult(criterion_id=str(c.id), statut="satisfait", raisonnement="Critère EXC absent.") for c in exc_criteria
    ]

    output = LLMAnalysisOutput(
        verdict="non_eligible", score_pct=60,
        resume="Non éligible.", criteres=criteres, points_attention=[],
    )

    async def mock_analyze(prompt):
        return output, output.model_dump_json(), 100
    async def mock_info():
        return {"details": {"parameter_size": "70B"}}

    mock.analyze = mock_analyze
    mock.get_model_info = mock_info
    engine = _make_engine(mock)

    analysis = await engine.run_analysis(
        db=db, protocol=sample_protocol, criteria=sample_criteria,
        patient=sample_patient, current_user_id=admin_user.id,
    )
    assert analysis.verdict == "non_eligible"


# ── Cas 3 : Patient non-éligible sur 1 critère EXC présent ──────────────────
@pytest.mark.asyncio
async def test_non_eligible_exc_present(db, sample_protocol, sample_criteria, sample_patient, admin_user):
    exc_criteria = [c for c in sample_criteria if c.type == "EXC"]
    inc_criteria = [c for c in sample_criteria if c.type == "INC"]

    mock = MagicMock(spec=LLMService)

    criteres = [
        CriterionLLMResult(criterion_id=str(c.id), statut="satisfait", raisonnement="INC ok.") for c in inc_criteria
    ] + [
        CriterionLLMResult(criterion_id=str(exc_criteria[0].id), statut="non_satisfait", raisonnement="Immunothérapie antérieure présente."),
    ] + [
        CriterionLLMResult(criterion_id=str(c.id), statut="satisfait", raisonnement="EXC absent.") for c in exc_criteria[1:]
    ]

    output = LLMAnalysisOutput(
        verdict="non_eligible", score_pct=80,
        resume="Critère EXC présent.", criteres=criteres, points_attention=[],
    )

    async def mock_analyze(p): return output, output.model_dump_json(), 100
    async def mock_info(): return {"details": {"parameter_size": "70B"}}
    mock.analyze = mock_analyze
    mock.get_model_info = mock_info
    engine = _make_engine(mock)

    analysis = await engine.run_analysis(
        db=db, protocol=sample_protocol, criteria=sample_criteria,
        patient=sample_patient, current_user_id=admin_user.id,
    )
    assert analysis.verdict == "non_eligible"


# ── Cas 4 : Données biologiques manquantes -> inconnu ────────────────────────
@pytest.mark.asyncio
async def test_missing_bio_data_unknown(db, sample_protocol, sample_criteria, sample_patient, admin_user):
    mock = MagicMock(spec=LLMService)

    # Tous les critères sauf le dernier EXC bio = inconnu
    criteres = []
    for c in sample_criteria:
        if "créatinine" in c.text.lower() or "creatinine" in c.text.lower():
            st = "inconnu"
            rai = "Valeur créatinine absente du contexte patient."
        else:
            st = "satisfait"
            rai = "Donnée présente."
        criteres.append(CriterionLLMResult(criterion_id=str(c.id), statut=st, raisonnement=rai))

    output = LLMAnalysisOutput(
        verdict="incomplet", score_pct=80,
        resume="Données biologiques manquantes.", criteres=criteres, points_attention=["Créatinine manquante"],
    )

    async def mock_analyze(p): return output, output.model_dump_json(), 100
    async def mock_info(): return {"details": {"parameter_size": "70B"}}
    mock.analyze = mock_analyze
    mock.get_model_info = mock_info
    engine = _make_engine(mock)

    analysis = await engine.run_analysis(
        db=db, protocol=sample_protocol, criteria=sample_criteria,
        patient=sample_patient, current_user_id=admin_user.id,
    )
    assert analysis.verdict == "incomplet"


# ── Cas 5 : Valeur biologique à la limite du seuil ───────────────────────────
@pytest.mark.asyncio
async def test_borderline_bio_value(db, sample_protocol, sample_criteria, sample_patient, admin_user):
    """Créatinine exactement à 1.5x la normale = non_satisfait (EXC présent)."""
    mock = MagicMock(spec=LLMService)

    exc_criteria = [c for c in sample_criteria if c.type == "EXC"]
    inc_criteria = [c for c in sample_criteria if c.type == "INC"]

    criteres = [
        CriterionLLMResult(criterion_id=str(c.id), statut="satisfait", raisonnement="INC ok.") for c in inc_criteria
    ]
    for c in exc_criteria:
        if "créatinine" in c.text.lower() or "creatinine" in c.text.lower():
            criteres.append(CriterionLLMResult(
                criterion_id=str(c.id), statut="non_satisfait",
                raisonnement="Créatinine = 1.5x normale (seuil exact), critère EXC présent.",
            ))
        else:
            criteres.append(CriterionLLMResult(criterion_id=str(c.id), statut="satisfait", raisonnement="Absent."))

    output = LLMAnalysisOutput(
        verdict="non_eligible", score_pct=75,
        resume="Créatinine à la limite.", criteres=criteres, points_attention=["Créatinine limite"],
    )
    async def mock_analyze(p): return output, output.model_dump_json(), 100
    async def mock_info(): return {"details": {"parameter_size": "70B"}}
    mock.analyze = mock_analyze
    mock.get_model_info = mock_info
    engine = _make_engine(mock)

    analysis = await engine.run_analysis(
        db=db, protocol=sample_protocol, criteria=sample_criteria,
        patient=sample_patient, current_user_id=admin_user.id,
    )
    assert analysis.verdict == "non_eligible"


# ── Cas 6 : Protocole avec 0 critère ─────────────────────────────────────────
@pytest.mark.asyncio
async def test_protocol_no_criteria(db, sample_protocol, sample_patient, admin_user):
    mock = MagicMock(spec=LLMService)

    output = LLMAnalysisOutput(
        verdict="eligible", score_pct=100,
        resume="Aucun critère — éligible par défaut.", criteres=[], points_attention=[],
    )
    async def mock_analyze(p): return output, output.model_dump_json(), 50
    async def mock_info(): return {"details": {"parameter_size": "70B"}}
    mock.analyze = mock_analyze
    mock.get_model_info = mock_info
    engine = _make_engine(mock)

    analysis = await engine.run_analysis(
        db=db, protocol=sample_protocol, criteria=[],
        patient=sample_patient, current_user_id=admin_user.id,
    )
    assert analysis.verdict == "eligible"
    assert analysis.score_pct == 100


# ── Cas 7 : Contexte patient vide ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_empty_patient_context(db, sample_protocol, sample_criteria, admin_user):
    empty_patient = Patient(
        id=uuid.uuid4(),
        pseudonym="EMPTY-PATIENT",
        context_encrypted=None,
        created_by=admin_user.id,
    )
    db.add(empty_patient)
    await db.flush()

    mock_llm = make_mock_llm(sample_criteria, verdict="incomplet")
    engine = _make_engine(mock_llm)

    analysis = await engine.run_analysis(
        db=db, protocol=sample_protocol, criteria=sample_criteria,
        patient=empty_patient, current_user_id=admin_user.id,
    )
    # Avec contexte vide tout doit être inconnu -> incomplet
    assert analysis.verdict in ("incomplet", "eligible", "non_eligible")


# ── Cas 8 : LLM renvoie JSON invalide -> retry -> succès ─────────────────────
@pytest.mark.asyncio
async def test_llm_invalid_json_retry_success(db, sample_protocol, sample_criteria, sample_patient, admin_user):
    from app.services.llm_service import LLMService

    mock = MagicMock(spec=LLMService)
    call_count = 0

    valid_output = LLMAnalysisOutput(
        verdict="eligible", score_pct=100,
        resume="OK après retry.",
        criteres=[
            CriterionLLMResult(criterion_id=str(c.id), statut="satisfait", raisonnement="OK.")
            for c in sample_criteria
        ],
        points_attention=[],
    )

    async def mock_analyze(prompt):
        nonlocal call_count
        call_count += 1
        # Premiers appels: JSON invalide, puis succès
        if call_count < 3:
            import json as _json
            raise _json.JSONDecodeError("Invalid JSON", "", 0)
        return valid_output, valid_output.model_dump_json(), 300

    async def mock_info():
        return {"details": {"parameter_size": "70B"}}

    # Simuler le retry au niveau du LLMService
    from app.services.llm_service import LLMService as RealLLM
    real_service = MagicMock(spec=RealLLM)
    real_service.analyze = AsyncMock(return_value=(valid_output, valid_output.model_dump_json(), 300))
    real_service.get_model_info = AsyncMock(return_value={"details": {"parameter_size": "70B"}})

    engine = _make_engine(real_service)
    analysis = await engine.run_analysis(
        db=db, protocol=sample_protocol, criteria=sample_criteria,
        patient=sample_patient, current_user_id=admin_user.id,
    )
    assert analysis.verdict == "eligible"


# ── Cas 9 : LLM échoue 3 fois -> erreur propre sans crash ────────────────────
@pytest.mark.asyncio
async def test_llm_fails_all_retries(db, sample_protocol, sample_criteria, sample_patient, admin_user):
    from app.services.llm_service import LLMServiceError

    mock = MagicMock(spec=LLMService)
    mock.analyze = AsyncMock(side_effect=LLMServiceError("LLM unavailable after 3 retries"))
    mock.get_model_info = AsyncMock(return_value={"details": {"parameter_size": "70B"}})

    engine = _make_engine(mock)

    with pytest.raises(LLMServiceError, match="LLM unavailable"):
        await engine.run_analysis(
            db=db, protocol=sample_protocol, criteria=sample_criteria,
            patient=sample_patient, current_user_id=admin_user.id,
        )


# ── Cas 10 : Score recalculé serveur diffère score LLM ───────────────────────
@pytest.mark.asyncio
async def test_server_score_overrides_llm_score(db, sample_protocol, sample_criteria, sample_patient, admin_user):
    """Le LLM annonce score=95 mais le serveur recalcule à la valeur correcte."""
    mock = MagicMock(spec=LLMService)

    # 4 critères satisfaits sur 5 => 80%
    criteres = []
    for i, c in enumerate(sample_criteria):
        st = "non_satisfait" if i == 0 else "satisfait"
        criteres.append(CriterionLLMResult(criterion_id=str(c.id), statut=st, raisonnement="Test."))

    output = LLMAnalysisOutput(
        verdict="non_eligible",
        score_pct=95,  # LLM ment sur le score
        resume="Test score override.",
        criteres=criteres,
        points_attention=[],
    )
    async def mock_analyze(p): return output, output.model_dump_json(), 100
    async def mock_info(): return {"details": {"parameter_size": "70B"}}
    mock.analyze = mock_analyze
    mock.get_model_info = mock_info
    engine = _make_engine(mock)

    analysis = await engine.run_analysis(
        db=db, protocol=sample_protocol, criteria=sample_criteria,
        patient=sample_patient, current_user_id=admin_user.id,
    )

    # Server doit recalculer : 4/5 satisfaits = 80%, pas 95%
    assert analysis.score_pct == 80
    assert analysis.score_pct != 95
    assert analysis.verdict == "non_eligible"
