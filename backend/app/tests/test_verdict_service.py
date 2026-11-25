"""U1 统一可信结论层测试：纯映射、只读聚合与 API 认证/隔离。"""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.isolation import enforce_project_isolation
from app.core.config import settings
from app.core.errors import AppError, app_error_handler
from app.db import get_db
from app.models import ExtractedFact, Material, Project
from app.models.stage2 import EvidenceItem
from app.models.stage4 import MetricComparison
from app.services.verdict_service import (
    CONFLICTING,
    INSUFFICIENT_EVIDENCE,
    PARTIALLY_VERIFIED,
    UNVERIFIABLE,
    VERDICT_STATUSES,
    VERIFIED,
    build_project_verdict,
    map_to_verdict,
)

# 确保各阶段表已注册到 Base.metadata（建表由 conftest 的 engine_fixture 完成）。
import app.models.stage2  # noqa: F401
import app.models.stage4  # noqa: F401
import app.models.stage6  # noqa: F401


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def verdict_client(engine_fixture):
    """独立挂载待测路由，避免修改全局 api_router（由主 Agent 统一注册）。"""
    from app.api.v1 import auth, projects, verdict

    factory = async_sessionmaker(engine_fixture, class_=AsyncSession, expire_on_commit=False)
    test_app = FastAPI()
    test_app.add_exception_handler(AppError, app_error_handler)

    async def override_get_db():
        async with factory() as session:
            yield session

    test_app.dependency_overrides[get_db] = override_get_db
    test_app.include_router(auth.router, prefix="/api/v1")
    test_app.include_router(
        projects.router, prefix="/api/v1",
        dependencies=[Depends(enforce_project_isolation)],
    )
    test_app.include_router(
        verdict.router, prefix="/api/v1",
        dependencies=[Depends(enforce_project_isolation)],
    )
    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
        yield client


async def _register(client: AsyncClient, email: str) -> dict:
    response = await client.post("/api/v1/auth/register", json={
        "email": email, "password": "password123", "display_name": "验证用户",
    })
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _create_project(client: AsyncClient, token: str, name: str) -> str:
    response = await client.post("/api/v1/projects", headers=_auth(token), json={
        "name": name, "domain": "ML", "paper_title": "复现审计", "description": "U1 测试项目",
    })
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


async def _seed_project(db: AsyncSession, project_id: str) -> Material:
    material = Material(
        id=f"mat-{project_id}", project_id=project_id, source_name="paper.txt",
        raw_text="实验文本", sha256="a" * 64,
    )
    db.add(material)
    await db.flush()
    return material


def _seed_fact(db: AsyncSession, project_id: str, material_id: str,
               index: int, status: str) -> ExtractedFact:
    fact = ExtractedFact(
        run_id=f"run-{project_id}", project_id=project_id, material_id=material_id,
        chunk_id=f"chunk-{index}", field_key=f"field-{index}", raw_value="0.001",
        extraction_status=status, fact_id=f"fact-{project_id}-{index}",
        parser_source="model",
    )
    db.add(fact)
    return fact


# map_to_verdict

@pytest.mark.asyncio
async def test_map_comparison_statuses():
    assert map_to_verdict("comparison", "conflict") == CONFLICTING
    assert map_to_verdict("comparison", "consistent") == VERIFIED
    assert map_to_verdict("comparison", "missing") == INSUFFICIENT_EVIDENCE


@pytest.mark.asyncio
async def test_map_extraction_statuses_and_unknown_source():
    assert map_to_verdict("extraction", "supported") == VERIFIED
    assert map_to_verdict("extraction", "unsupported") == UNVERIFIABLE
    assert map_to_verdict("extraction", "needs_review") == INSUFFICIENT_EVIDENCE
    assert map_to_verdict("unknown_system", "supported") == INSUFFICIENT_EVIDENCE
    assert map_to_verdict("extraction", "brand_new_status") == INSUFFICIENT_EVIDENCE


@pytest.mark.asyncio
async def test_map_reproduction_statuses():
    assert map_to_verdict("reproduction", "exact_match") == VERIFIED
    assert map_to_verdict("reproduction", "within_tolerance") == VERIFIED
    assert map_to_verdict("reproduction", "significant_deviation") == CONFLICTING
    assert map_to_verdict("reproduction", "insufficient_data") == INSUFFICIENT_EVIDENCE
    assert map_to_verdict("reproduction", "not_comparable") == UNVERIFIABLE


@pytest.mark.asyncio
async def test_map_benchmark_quality_statuses():
    assert map_to_verdict("benchmark_quality", "execution_verified") == VERIFIED
    assert map_to_verdict("benchmark_quality", "independently_reviewed") == VERIFIED
    assert map_to_verdict("benchmark_quality", "partially_verified") == PARTIALLY_VERIFIED
    assert map_to_verdict("benchmark_quality", "unverified") == UNVERIFIABLE


# build_project_verdict

@pytest.mark.asyncio
async def test_build_empty_project_returns_zero_counts_and_disclaimer(session_fixture):
    result = await build_project_verdict(session_fixture, "proj-empty-verdict")

    assert set(result["verdicts"]) == set(VERDICT_STATUSES)
    assert all(count == 0 for count in result["verdicts"].values())
    assert result["dimensions"]["material_available"]["status"] == UNVERIFIABLE
    assert result["dimensions"]["artifact_assessed"]["status"] == UNVERIFIABLE
    assert result["dimensions"]["results_validated"]["status"] == UNVERIFIABLE
    assert "不构成任何机构的认证" in result["scope_note"]
    assert "ACM v1.1" in result["framework_note"]
    assert result["counts"]["comparisons"] == 0
    assert result["counts"]["benchmark_cases"] == 0
    assert any("ComparisonView" in note for note in result["notes"])
    assert any("BenchmarkCase" in note for note in result["notes"])


@pytest.mark.asyncio
async def test_build_facts_and_evidence_locator_ratio(session_fixture):
    project_id = "proj-facts-verdict"
    session_fixture.add(Project(id=project_id, name="事实测试", domain="ML"))
    material = await _seed_project(session_fixture, project_id)
    facts = [
        _seed_fact(session_fixture, project_id, material.id, 1, "supported"),
        _seed_fact(session_fixture, project_id, material.id, 2, "supported"),
        _seed_fact(session_fixture, project_id, material.id, 3, "unsupported"),
        _seed_fact(session_fixture, project_id, material.id, 4, "needs_review"),
    ]
    await session_fixture.flush()
    for index, fact in enumerate(facts, start=1):
        has_locator = index <= 2
        session_fixture.add(EvidenceItem(
            evidence_id=f"ev-{index}", fact_id=fact.fact_id, project_id=project_id,
            material_id=material.id, chunk_id=fact.chunk_id, source_name="paper.txt",
            quote="原文引用", original_text="原文引用",
            source_locator='{"page": 3}' if has_locator else "",
        ))
    await session_fixture.commit()

    result = await build_project_verdict(session_fixture, project_id)

    assert result["verdicts"] == {
        VERIFIED: 2, PARTIALLY_VERIFIED: 0, INSUFFICIENT_EVIDENCE: 1,
        CONFLICTING: 0, UNVERIFIABLE: 1,
    }
    assert result["evidence_locator"] == {
        "total": 4, "with_location": 2, "ratio": pytest.approx(0.5),
    }
    assert result["dimensions"]["material_available"]["status"] == VERIFIED
    assert result["counts"]["extracted_facts"] == 4
    assert result["counts"]["evidence_items"] == 4


@pytest.mark.asyncio
async def test_material_dimension_partial_when_sha256_missing(session_fixture):
    project_id = "proj-material-verdict"
    session_fixture.add(Project(id=project_id, name="材料测试", domain="ML"))
    session_fixture.add(Material(
        id="mat-a", project_id=project_id, source_name="a.pdf", raw_text="A", sha256="b" * 64,
    ))
    session_fixture.add(Material(
        id="mat-b", project_id=project_id, source_name="b.pdf", raw_text="B", sha256=None,
    ))
    await session_fixture.commit()

    result = await build_project_verdict(session_fixture, project_id)

    assert result["dimensions"]["material_available"]["status"] == PARTIALLY_VERIFIED
    assert result["dimensions"]["material_available"]["subtype"] == "sha256_partial"
    assert result["counts"]["materials"] == 2


@pytest.mark.asyncio
async def test_results_dimension_conflict_from_metric_comparisons(session_fixture):
    project_id = "proj-results-verdict"
    session_fixture.add(Project(id=project_id, name="结果测试", domain="ML"))
    session_fixture.add(MetricComparison(
        id="cmp-1", project_id=project_id, metric_name="accuracy",
        verdict="significant_deviation", rule="absolute", tolerance_basis="论文表格",
    ))
    session_fixture.add(MetricComparison(
        id="cmp-2", project_id=project_id, metric_name="loss",
        verdict="within_tolerance", rule="absolute", tolerance_basis="论文表格",
    ))
    await session_fixture.commit()

    result = await build_project_verdict(session_fixture, project_id)

    assert result["verdicts"][CONFLICTING] == 1
    assert result["verdicts"][VERIFIED] == 1
    assert result["dimensions"]["results_validated"]["status"] == CONFLICTING
    assert result["dimensions"]["results_validated"]["subtype"] == "deviation"
    assert result["counts"]["metric_comparisons"] == 2


@pytest.mark.asyncio
async def test_build_tolerates_db_query_errors():
    class BrokenDB:
        async def execute(self, statement):
            raise RuntimeError("missing table")

    result = await build_project_verdict(BrokenDB(), "proj-broken-db")

    assert all(count == 0 for count in result["verdicts"].values())
    assert all(count == 0 for count in result["counts"].values())
    assert result["dimensions"]["material_available"]["status"] == UNVERIFIABLE
    assert any("RuntimeError" in note for note in result["notes"])


# API 认证与项目隔离

@pytest.mark.asyncio
async def test_api_requires_authentication(verdict_client, monkeypatch):
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    owner = await _register(verdict_client, "verdict-owner@example.com")
    project_id = await _create_project(verdict_client, owner["token"], "无权访问测试")

    response = await verdict_client.get(f"/api/v1/projects/{project_id}/verdict-summary")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_api_owner_can_read_own_project(verdict_client, monkeypatch):
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    owner = await _register(verdict_client, "verdict-self@example.com")
    project_id = await _create_project(verdict_client, owner["token"], "自己的项目")

    response = await verdict_client.get(
        f"/api/v1/projects/{project_id}/verdict-summary", headers=_auth(owner["token"]),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["success"] is True
    assert body["data"]["project_id"] == project_id
    assert set(body["data"]["verdicts"]) == set(VERDICT_STATUSES)
    assert "不构成任何机构的认证" in body["data"]["scope_note"]


@pytest.mark.asyncio
async def test_api_other_user_gets_404(verdict_client, monkeypatch):
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    owner = await _register(verdict_client, "verdict-isolation-a@example.com")
    outsider = await _register(verdict_client, "verdict-isolation-b@example.com")
    project_id = await _create_project(verdict_client, owner["token"], "他人的项目")

    response = await verdict_client.get(
        f"/api/v1/projects/{project_id}/verdict-summary", headers=_auth(outsider["token"]),
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
