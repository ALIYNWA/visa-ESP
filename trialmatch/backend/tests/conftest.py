"""Shared pytest fixtures for all backend tests."""
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.database import Base, get_db
from app.core.security import create_access_token, hash_password
from app.main import app
from app.models.criterion import Criterion
from app.models.patient import Patient
from app.models.protocol import Protocol
from app.models.user import User

# ── Test database ─────────────────────────────────────────────────────────────

TEST_DATABASE_URL = settings.DATABASE_URL

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_test_db():
    """Create all tables at session start, drop at end."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db() -> AsyncGenerator[AsyncSession, None]:
    """Provide a test DB session with rollback after each test."""
    async with test_engine.connect() as conn:
        await conn.begin()
        async with AsyncSession(conn, expire_on_commit=False) as session:
            yield session
            await session.rollback()


@pytest_asyncio.fixture
async def client(db: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """HTTP test client with overridden DB dependency."""
    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# ── User fixtures ──────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def admin_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        username="admin_test",
        email="admin@test.com",
        hashed_password=hash_password("Admin1234!"),
        role="admin",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


@pytest_asyncio.fixture
async def arc_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        username="arc_test",
        email="arc@test.com",
        hashed_password=hash_password("Arc1234!"),
        role="arc",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


@pytest_asyncio.fixture
async def tec_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        username="tec_test",
        email="tec@test.com",
        hashed_password=hash_password("Tec1234!"),
        role="tec",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


@pytest_asyncio.fixture
async def investigateur_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        username="invest_test",
        email="invest@test.com",
        hashed_password=hash_password("Invest1234!"),
        role="investigateur_principal",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


# ── Token helpers ─────────────────────────────────────────────────────────────

def make_token(user: User) -> str:
    return create_access_token({"sub": str(user.id), "role": user.role})


def auth_headers(user: User) -> dict:
    return {"Authorization": f"Bearer {make_token(user)}"}


# ── Protocol fixtures ─────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def sample_protocol(db: AsyncSession, admin_user: User) -> Protocol:
    protocol = Protocol(
        id=uuid.uuid4(),
        title="ONCO-TEST-2024",
        eudract_number="2024-001234-10",
        phase="II",
        pathology="Cancer du poumon non à petites cellules",
        summary="Essai de phase II évaluant l'immunothérapie",
        promoter="CHU Test",
        arc_referent="ARC Dupont",
        created_by=admin_user.id,
    )
    db.add(protocol)
    await db.flush()
    return protocol


@pytest_asyncio.fixture
async def sample_criteria(db: AsyncSession, sample_protocol: Protocol) -> list[Criterion]:
    criteria = [
        Criterion(
            id=uuid.uuid4(),
            protocol_id=sample_protocol.id,
            type="INC",
            text="Age >= 18 ans",
            order=0,
        ),
        Criterion(
            id=uuid.uuid4(),
            protocol_id=sample_protocol.id,
            type="INC",
            text="ECOG Performance Status <= 2",
            order=1,
        ),
        Criterion(
            id=uuid.uuid4(),
            protocol_id=sample_protocol.id,
            type="INC",
            text="Diagnostic confirmé de CBNPC stade IIIB ou IV",
            order=2,
        ),
        Criterion(
            id=uuid.uuid4(),
            protocol_id=sample_protocol.id,
            type="EXC",
            text="Traitement antérieur par immunothérapie",
            order=3,
        ),
        Criterion(
            id=uuid.uuid4(),
            protocol_id=sample_protocol.id,
            type="EXC",
            text="Créatinine > 1.5x la normale",
            order=4,
        ),
    ]
    for c in criteria:
        db.add(c)
    await db.flush()
    return criteria


@pytest_asyncio.fixture
async def sample_patient(db: AsyncSession, admin_user: User) -> Patient:
    from app.core.security import encrypt_data
    import json
    context = {
        "age": 62,
        "sexe": "M",
        "diagnostic_principal": "CBNPC stade IV",
        "stade": "IV",
        "ecog_performance_status": 1,
        "traitements_en_cours": ["Carboplatine"],
        "biologie": {"creatinine": "0.9 mg/dL", "hb": "12.5 g/dL"},
        "antecedents": ["HTA", "Diabète type 2"],
    }
    patient = Patient(
        id=uuid.uuid4(),
        pseudonym="PATIENT-TEST-001",
        context_encrypted=encrypt_data(json.dumps(context)),
        created_by=admin_user.id,
    )
    db.add(patient)
    await db.flush()
    return patient


# ── Mock LLM service ──────────────────────────────────────────────────────────

def make_mock_llm(criteria: list[Criterion], verdict: str = "eligible"):
    """Create a mock LLM service returning valid JSON for given criteria."""
    from app.schemas.llm import CriterionLLMResult, LLMAnalysisOutput
    from app.services.llm_service import LLMService

    mock = MagicMock(spec=LLMService)

    statut_map = {
        "eligible": "satisfait",
        "non_eligible": "non_satisfait",
        "incomplet": "inconnu",
    }
    statut = statut_map.get(verdict, "satisfait")

    output = LLMAnalysisOutput(
        verdict=verdict,
        score_pct=100 if verdict == "eligible" else 0,
        resume="Patient analysé par le LLM mock.",
        criteres=[
            CriterionLLMResult(
                criterion_id=str(c.id),
                statut=statut,
                raisonnement=f"Mock: critère {c.type} évalué comme {statut}.",
            )
            for c in criteria
        ],
        points_attention=[],
    )

    raw_response = output.model_dump_json()

    async def mock_analyze(prompt: str):
        return output, raw_response, 250

    async def mock_get_model_info():
        return {"name": "meditron:70b", "details": {"parameter_size": "70B"}}

    mock.analyze = mock_analyze
    mock.get_model_info = mock_get_model_info
    return mock
