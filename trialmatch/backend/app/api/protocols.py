"""Protocol and Criterion CRUD API endpoints."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, CurrentUser, get_audit, get_client_ip, require_min_role, require_role
from app.models.criterion import Criterion
from app.models.protocol import Protocol
from app.schemas.protocol import (
    CriterionCreate,
    CriterionRead,
    CriterionUpdate,
    ProtocolCreate,
    ProtocolListItem,
    ProtocolRead,
    ProtocolUpdate,
)
from app.services.audit_service import AuditService

router = APIRouter(prefix="/protocols", tags=["protocols"])

WRITE_ROLES = ("admin", "investigateur_principal")


# ── Protocols ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ProtocolListItem])
async def list_protocols(
    db: DB,
    current_user: CurrentUser,
    is_active: bool | None = None,
) -> list[ProtocolListItem]:
    stmt = select(Protocol)
    if is_active is not None:
        stmt = stmt.where(Protocol.is_active == is_active)
    result = await db.execute(stmt.order_by(Protocol.created_at.desc()))
    protocols = result.scalars().all()

    items = []
    for p in protocols:
        count_result = await db.execute(
            select(func.count()).where(Criterion.protocol_id == p.id)
        )
        count = count_result.scalar_one()
        item = ProtocolListItem.model_validate(p)
        item.criteria_count = count
        items.append(item)

    return items


@router.post("", response_model=ProtocolRead, status_code=status.HTTP_201_CREATED)
async def create_protocol(
    request: Request,
    body: ProtocolCreate,
    db: DB,
    current_user: CurrentUser = Depends(require_role(*WRITE_ROLES)),
    audit: AuditService = Depends(get_audit),
) -> ProtocolRead:
    # Vérifier unicité EudraCT
    if body.eudract_number:
        existing = await db.execute(
            select(Protocol).where(Protocol.eudract_number == body.eudract_number)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"EudraCT number '{body.eudract_number}' already exists",
            )

    protocol = Protocol(
        id=uuid.uuid4(),
        title=body.title,
        eudract_number=body.eudract_number,
        phase=body.phase,
        pathology=body.pathology,
        summary=body.summary,
        promoter=body.promoter,
        arc_referent=body.arc_referent,
        created_by=current_user.id,
    )
    db.add(protocol)
    await db.flush()

    for idx, crit_data in enumerate(body.criteria):
        crit = Criterion(
            id=uuid.uuid4(),
            protocol_id=protocol.id,
            type=crit_data.type,
            text=crit_data.text,
            order=crit_data.order if crit_data.order else idx,
        )
        db.add(crit)

    await db.flush()
    await db.refresh(protocol, ["criteria"])

    await audit.log(
        db=db,
        event_type="protocol_created",
        user_id=current_user.id,
        resource_type="protocol",
        resource_id=protocol.id,
        details={"title": protocol.title, "eudract": protocol.eudract_number},
        ip_address=get_client_ip(request),
    )

    return ProtocolRead.model_validate(protocol)


@router.get("/{protocol_id}", response_model=ProtocolRead)
async def get_protocol(
    protocol_id: uuid.UUID,
    db: DB,
    current_user: CurrentUser,
) -> ProtocolRead:
    result = await db.execute(
        select(Protocol)
        .options(selectinload(Protocol.criteria))
        .where(Protocol.id == protocol_id)
    )
    protocol = result.scalar_one_or_none()
    if not protocol:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Protocol not found")
    return ProtocolRead.model_validate(protocol)


@router.put("/{protocol_id}", response_model=ProtocolRead)
async def update_protocol(
    request: Request,
    protocol_id: uuid.UUID,
    body: ProtocolUpdate,
    db: DB,
    current_user: CurrentUser = Depends(require_role(*WRITE_ROLES)),
    audit: AuditService = Depends(get_audit),
) -> ProtocolRead:
    result = await db.execute(
        select(Protocol).options(selectinload(Protocol.criteria)).where(Protocol.id == protocol_id)
    )
    protocol = result.scalar_one_or_none()
    if not protocol:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Protocol not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(protocol, field, value)

    await audit.log(
        db=db,
        event_type="protocol_updated",
        user_id=current_user.id,
        resource_type="protocol",
        resource_id=protocol.id,
        ip_address=get_client_ip(request),
    )

    return ProtocolRead.model_validate(protocol)


@router.post("/{protocol_id}/version", response_model=ProtocolRead, status_code=status.HTTP_201_CREATED)
async def new_version(
    request: Request,
    protocol_id: uuid.UUID,
    db: DB,
    current_user: CurrentUser = Depends(require_role(*WRITE_ROLES)),
    audit: AuditService = Depends(get_audit),
) -> ProtocolRead:
    result = await db.execute(
        select(Protocol).options(selectinload(Protocol.criteria)).where(Protocol.id == protocol_id)
    )
    protocol = result.scalar_one_or_none()
    if not protocol:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Protocol not found")

    protocol.version += 1

    await audit.log(
        db=db,
        event_type="protocol_new_version",
        user_id=current_user.id,
        resource_type="protocol",
        resource_id=protocol.id,
        details={"new_version": protocol.version},
        ip_address=get_client_ip(request),
    )

    return ProtocolRead.model_validate(protocol)


@router.get("/{protocol_id}/criteria", response_model=list[CriterionRead])
async def list_criteria(
    protocol_id: uuid.UUID,
    db: DB,
    current_user: CurrentUser,
) -> list[CriterionRead]:
    result = await db.execute(
        select(Criterion)
        .where(Criterion.protocol_id == protocol_id)
        .order_by(Criterion.order)
    )
    return [CriterionRead.model_validate(c) for c in result.scalars().all()]


@router.post("/{protocol_id}/criteria", response_model=CriterionRead, status_code=status.HTTP_201_CREATED)
async def add_criterion(
    request: Request,
    protocol_id: uuid.UUID,
    body: CriterionCreate,
    db: DB,
    current_user: CurrentUser = Depends(require_role(*WRITE_ROLES)),
    audit: AuditService = Depends(get_audit),
) -> CriterionRead:
    # Vérifier que le protocole existe
    proto = await db.get(Protocol, protocol_id)
    if not proto:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Protocol not found")

    crit = Criterion(
        id=uuid.uuid4(),
        protocol_id=protocol_id,
        type=body.type,
        text=body.text,
        order=body.order,
    )
    db.add(crit)
    await db.flush()

    await audit.log(
        db=db,
        event_type="criterion_added",
        user_id=current_user.id,
        resource_type="criterion",
        resource_id=crit.id,
        details={"protocol_id": str(protocol_id), "type": body.type},
        ip_address=get_client_ip(request),
    )

    return CriterionRead.model_validate(crit)


@router.put("/{protocol_id}/criteria/{criterion_id}", response_model=CriterionRead)
async def update_criterion(
    request: Request,
    protocol_id: uuid.UUID,
    criterion_id: uuid.UUID,
    body: CriterionUpdate,
    db: DB,
    current_user: CurrentUser = Depends(require_role(*WRITE_ROLES)),
    audit: AuditService = Depends(get_audit),
) -> CriterionRead:
    result = await db.execute(
        select(Criterion).where(
            Criterion.id == criterion_id,
            Criterion.protocol_id == protocol_id,
        )
    )
    crit = result.scalar_one_or_none()
    if not crit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Criterion not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(crit, field, value)

    await audit.log(
        db=db,
        event_type="criterion_updated",
        user_id=current_user.id,
        resource_type="criterion",
        resource_id=crit.id,
        ip_address=get_client_ip(request),
    )

    return CriterionRead.model_validate(crit)


@router.delete("/{protocol_id}/criteria/{criterion_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_criterion(
    request: Request,
    protocol_id: uuid.UUID,
    criterion_id: uuid.UUID,
    db: DB,
    current_user: CurrentUser = Depends(require_role(*WRITE_ROLES)),
    audit: AuditService = Depends(get_audit),
) -> None:
    result = await db.execute(
        select(Criterion).where(
            Criterion.id == criterion_id,
            Criterion.protocol_id == protocol_id,
        )
    )
    crit = result.scalar_one_or_none()
    if not crit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Criterion not found")

    await db.delete(crit)

    await audit.log(
        db=db,
        event_type="criterion_deleted",
        user_id=current_user.id,
        resource_type="criterion",
        resource_id=criterion_id,
        ip_address=get_client_ip(request),
    )
