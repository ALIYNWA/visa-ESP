"""Analysis API endpoints — create, validate, override, match-all."""
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, CurrentUser, get_audit, get_client_ip, get_eligibility_engine, require_role
from app.models.analysis import Analysis, CriterionResult
from app.models.criterion import Criterion
from app.models.patient import Patient
from app.models.protocol import Protocol
from app.schemas.analysis import (
    AnalysisCreate,
    AnalysisListItem,
    AnalysisRead,
    AnalysisValidate,
    CriterionOverride,
    DashboardStats,
)
from app.services.audit_service import AuditService
from app.services.eligibility_engine import EligibilityEngine

router = APIRouter(tags=["analyses"])

OVERRIDE_ROLES = ("admin", "investigateur_principal", "co_investigateur")
VALIDATE_ROLES = ("admin", "investigateur_principal")
CREATE_ROLES = ("admin", "investigateur_principal", "co_investigateur", "arc")


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_analysis_or_404(db: DB, analysis_id: uuid.UUID) -> Analysis:
    result = await db.execute(
        select(Analysis)
        .options(selectinload(Analysis.criterion_results))
        .where(Analysis.id == analysis_id)
    )
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found")
    return analysis


# ── Routes analyses ────────────────────────────────────────────────────────────

@router.post("/analyses", response_model=AnalysisRead, status_code=status.HTTP_201_CREATED)
async def create_analysis(
    request: Request,
    body: AnalysisCreate,
    db: DB,
    current_user: CurrentUser = Depends(require_role(*CREATE_ROLES)),
    engine: EligibilityEngine = Depends(get_eligibility_engine),
    audit: AuditService = Depends(get_audit),
) -> AnalysisRead:
    # Vérifier que le protocole existe et est actif
    protocol = await db.get(Protocol, body.protocol_id)
    if not protocol:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Protocol not found")
    if not protocol.is_active:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Protocol is inactive")

    # Vérifier que le patient existe
    patient = await db.get(Patient, body.patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    # Charger les critères
    result = await db.execute(
        select(Criterion)
        .where(Criterion.protocol_id == protocol.id)
        .order_by(Criterion.order)
    )
    criteria = result.scalars().all()

    # Lancer l'analyse
    analysis = await engine.run_analysis(
        db=db,
        protocol=protocol,
        criteria=list(criteria),
        patient=patient,
        current_user_id=current_user.id,
        ip_address=get_client_ip(request),
    )

    # Rafraîchir pour avoir les criterion_results
    await db.refresh(analysis, ["criterion_results"])

    return AnalysisRead.model_validate(analysis)


@router.get("/analyses/{analysis_id}", response_model=AnalysisRead)
async def get_analysis(
    analysis_id: uuid.UUID,
    db: DB,
    current_user: CurrentUser,
) -> AnalysisRead:
    analysis = await _get_analysis_or_404(db, analysis_id)
    return AnalysisRead.model_validate(analysis)


@router.get("/analyses", response_model=list[AnalysisListItem])
async def list_analyses(
    db: DB,
    current_user: CurrentUser,
    patient_id: uuid.UUID | None = None,
    protocol_id: uuid.UUID | None = None,
) -> list[AnalysisListItem]:
    stmt = select(Analysis).order_by(Analysis.created_at.desc())
    if patient_id:
        stmt = stmt.where(Analysis.patient_id == patient_id)
    if protocol_id:
        stmt = stmt.where(Analysis.protocol_id == protocol_id)
    result = await db.execute(stmt)
    return [AnalysisListItem.model_validate(a) for a in result.scalars().all()]


@router.post("/analyses/{analysis_id}/validate", response_model=AnalysisRead)
async def validate_analysis(
    request: Request,
    analysis_id: uuid.UUID,
    body: AnalysisValidate,
    db: DB,
    current_user: CurrentUser = Depends(require_role(*VALIDATE_ROLES)),
    audit: AuditService = Depends(get_audit),
) -> AnalysisRead:
    analysis = await _get_analysis_or_404(db, analysis_id)

    if analysis.validated_at:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Analysis is already validated",
        )

    analysis.validated_by = current_user.id
    analysis.validated_at = datetime.now(UTC)

    await audit.log(
        db=db,
        event_type="analysis_validated",
        user_id=current_user.id,
        resource_type="analysis",
        resource_id=analysis.id,
        details={"note": body.signature_note},
        ip_address=get_client_ip(request),
    )

    return AnalysisRead.model_validate(analysis)


@router.put("/analyses/{analysis_id}/criteria/{criterion_result_id}/override", response_model=AnalysisRead)
async def override_criterion(
    request: Request,
    analysis_id: uuid.UUID,
    criterion_result_id: uuid.UUID,
    body: CriterionOverride,
    db: DB,
    current_user: CurrentUser = Depends(require_role(*OVERRIDE_ROLES)),
    audit: AuditService = Depends(get_audit),
) -> AnalysisRead:
    analysis = await _get_analysis_or_404(db, analysis_id)

    if analysis.validated_at:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot override criteria on a validated analysis",
        )

    # Trouver le CriterionResult
    cr_result = await db.execute(
        select(CriterionResult).where(
            CriterionResult.id == criterion_result_id,
            CriterionResult.analysis_id == analysis_id,
        )
    )
    cr = cr_result.scalar_one_or_none()
    if not cr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Criterion result not found")

    cr.override_status = body.override_status
    cr.override_note = body.override_note
    cr.overridden_by = current_user.id
    cr.overridden_at = datetime.now(UTC)

    # Recalculer le verdict/score après override
    await db.flush()
    await db.refresh(analysis, ["criterion_results"])
    _recompute_analysis(analysis)

    await audit.log(
        db=db,
        event_type="criterion_overridden",
        user_id=current_user.id,
        resource_type="criterion_result",
        resource_id=cr.id,
        details={
            "analysis_id": str(analysis_id),
            "criterion_id": str(cr.criterion_id),
            "override_status": body.override_status,
        },
        ip_address=get_client_ip(request),
    )

    return AnalysisRead.model_validate(analysis)


def _recompute_analysis(analysis: Analysis) -> None:
    """Recalculer score et verdict après un override."""
    results = analysis.criterion_results
    if not results:
        analysis.score_pct = 100
        analysis.verdict = "eligible"
        return

    effective_statuses = [
        cr.override_status if cr.override_status else cr.status
        for cr in results
    ]

    has_non_satisfait = "non_satisfait" in effective_statuses
    has_unknown = "inconnu" in effective_statuses
    satisfied_count = effective_statuses.count("satisfait")
    total = len(effective_statuses)

    analysis.score_pct = int(round((satisfied_count / total) * 100)) if total > 0 else 100

    if has_non_satisfait:
        analysis.verdict = "non_eligible"
    elif has_unknown:
        analysis.verdict = "incomplet"
    else:
        analysis.verdict = "eligible"


# ── Match all ─────────────────────────────────────────────────────────────────

@router.post("/patients/{patient_id}/match-all", response_model=list[AnalysisRead])
async def match_all_protocols(
    request: Request,
    patient_id: uuid.UUID,
    db: DB,
    current_user: CurrentUser = Depends(require_role(*CREATE_ROLES)),
    engine: EligibilityEngine = Depends(get_eligibility_engine),
) -> list[AnalysisRead]:
    patient = await db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    result = await db.execute(
        select(Protocol).where(Protocol.is_active == True)
    )
    protocols = result.scalars().all()

    analyses = []
    for protocol in protocols:
        crit_result = await db.execute(
            select(Criterion)
            .where(Criterion.protocol_id == protocol.id)
            .order_by(Criterion.order)
        )
        criteria = crit_result.scalars().all()

        analysis = await engine.run_analysis(
            db=db,
            protocol=protocol,
            criteria=list(criteria),
            patient=patient,
            current_user_id=current_user.id,
            ip_address=get_client_ip(request),
        )
        await db.refresh(analysis, ["criterion_results"])
        analyses.append(AnalysisRead.model_validate(analysis))

    return analyses


# ── Dashboard ─────────────────────────────────────────────────────────────────

@router.get("/dashboard/stats", response_model=DashboardStats)
async def dashboard_stats(
    db: DB,
    current_user: CurrentUser,
) -> DashboardStats:
    from datetime import timedelta

    from app.models.patient import Patient
    from app.models.protocol import Protocol

    total_protocols = (await db.execute(select(func.count()).select_from(Protocol))).scalar_one()
    active_protocols = (await db.execute(
        select(func.count()).select_from(Protocol).where(Protocol.is_active == True)
    )).scalar_one()
    total_patients = (await db.execute(select(func.count()).select_from(Patient))).scalar_one()
    total_analyses = (await db.execute(select(func.count()).select_from(Analysis))).scalar_one()

    week_ago = datetime.now(UTC) - timedelta(days=7)
    analyses_last_7_days = (await db.execute(
        select(func.count()).select_from(Analysis).where(Analysis.created_at >= week_ago)
    )).scalar_one()

    eligible_count = (await db.execute(
        select(func.count()).select_from(Analysis).where(Analysis.verdict == "eligible")
    )).scalar_one()
    eligible_rate = (eligible_count / total_analyses * 100) if total_analyses > 0 else 0.0

    pending_validation = (await db.execute(
        select(func.count()).select_from(Analysis).where(Analysis.validated_at == None)
    )).scalar_one()

    return DashboardStats(
        total_protocols=total_protocols,
        active_protocols=active_protocols,
        total_patients=total_patients,
        total_analyses=total_analyses,
        analyses_last_7_days=analyses_last_7_days,
        eligible_rate_pct=round(eligible_rate, 1),
        pending_validation=pending_validation,
    )
