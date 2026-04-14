"""Patient CRUD API endpoints."""
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, get_audit, get_client_ip, require_role
from app.core.security import decrypt_data, encrypt_data
from app.models.patient import Patient
from app.schemas.patient import PatientCreate, PatientListItem, PatientRead, PatientUpdate
from app.services.audit_service import AuditService

router = APIRouter(prefix="/patients", tags=["patients"])

READ_ROLES = ("admin", "investigateur_principal", "co_investigateur", "arc", "tec")
WRITE_ROLES = ("admin", "investigateur_principal", "co_investigateur", "arc")


@router.get("", response_model=list[PatientListItem])
async def list_patients(
    db: DB,
    current_user: CurrentUser,
) -> list[PatientListItem]:
    result = await db.execute(
        select(Patient).order_by(Patient.created_at.desc())
    )
    return [PatientListItem.model_validate(p) for p in result.scalars().all()]


@router.post("", response_model=PatientRead, status_code=status.HTTP_201_CREATED)
async def create_patient(
    request: Request,
    body: PatientCreate,
    db: DB,
    current_user: CurrentUser = Depends(require_role(*WRITE_ROLES)),
    audit: AuditService = Depends(get_audit),
) -> PatientRead:
    # Vérifier unicité pseudonyme
    existing = await db.execute(select(Patient).where(Patient.pseudonym == body.pseudonym))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Patient with pseudonym '{body.pseudonym}' already exists",
        )

    # Chiffrer le contexte clinique
    context_json = body.context.model_dump_json()
    encrypted = encrypt_data(context_json)

    patient = Patient(
        id=uuid.uuid4(),
        pseudonym=body.pseudonym,
        context_encrypted=encrypted,
        created_by=current_user.id,
    )
    db.add(patient)
    await db.flush()

    await audit.log(
        db=db,
        event_type="patient_created",
        user_id=current_user.id,
        resource_type="patient",
        resource_id=patient.id,
        # Pas de données cliniques dans les logs
        ip_address=get_client_ip(request),
    )

    return _build_patient_read(patient, body.context.model_dump())


@router.get("/{patient_id}", response_model=PatientRead)
async def get_patient(
    patient_id: uuid.UUID,
    db: DB,
    current_user: CurrentUser,
) -> PatientRead:
    patient = await db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    context = _decrypt_context(patient)
    return _build_patient_read(patient, context)


@router.put("/{patient_id}", response_model=PatientRead)
async def update_patient(
    request: Request,
    patient_id: uuid.UUID,
    body: PatientUpdate,
    db: DB,
    current_user: CurrentUser = Depends(require_role(*WRITE_ROLES)),
    audit: AuditService = Depends(get_audit),
) -> PatientRead:
    patient = await db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    if body.pseudonym is not None:
        # Vérifier unicité
        existing = await db.execute(
            select(Patient).where(
                Patient.pseudonym == body.pseudonym,
                Patient.id != patient_id,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pseudonym already in use")
        patient.pseudonym = body.pseudonym

    if body.context is not None:
        patient.context_encrypted = encrypt_data(body.context.model_dump_json())

    await audit.log(
        db=db,
        event_type="patient_updated",
        user_id=current_user.id,
        resource_type="patient",
        resource_id=patient.id,
        ip_address=get_client_ip(request),
    )

    context = _decrypt_context(patient)
    return _build_patient_read(patient, context)


def _decrypt_context(patient: Patient) -> dict:
    if not patient.context_encrypted:
        return {}
    try:
        return json.loads(decrypt_data(patient.context_encrypted))
    except Exception:
        return {}


def _build_patient_read(patient: Patient, context: dict) -> PatientRead:
    from app.schemas.patient import PatientContextData
    return PatientRead(
        id=patient.id,
        pseudonym=patient.pseudonym,
        context=PatientContextData.model_validate(context) if context else None,
        created_by=patient.created_by,
        created_at=patient.created_at,
    )
