"""第六阶段 Wave B：科研项目交接包导出与上传校验测试（真实 client + JWT）。"""
from __future__ import annotations

import hashlib
import io
import json
import zipfile
from contextlib import asynccontextmanager

import pytest

CHUNK_TEXT_1 = "方法: 学习率 0.001, 批次 32。"
CHUNK_TEXT_2 = "结果: 准确率 91.5%。"
MATERIAL_TEXT = CHUNK_TEXT_1 + "\n" + CHUNK_TEXT_2


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register(client, email: str, name: str = "交接测试用户") -> dict:
    r = await client.post("/api/v1/auth/register", json={
        "email": email, "password": "password123", "display_name": name,
    })
    assert r.status_code == 200, r.text
    return r.json()["data"]


@asynccontextmanager
async def _session():
    """复用 client 的 get_db override，保证与 HTTP 请求看到同一个内存库。"""
    from app.db import get_db
    from app.main import app

    factory = app.dependency_overrides[get_db]
    assert factory is not None
    generator = factory()
    db = await generator.__anext__()
    try:
        yield db
    finally:
        await generator.aclose()


async def _setup_project(client, monkeypatch, email: str):
    from app.core.config import settings

    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    owner = await _register(client, email)
    headers = _auth(owner["token"])
    r = await client.post("/api/v1/projects", json={"name": "交接项目"}, headers=headers)
    assert r.status_code == 200, r.text
    project_id = r.json()["data"]["id"]
    r = await client.post(
        "/api/v1/materials/upload",
        data={"project_id": project_id},
        files={"file": ("paper.txt", MATERIAL_TEXT.encode("utf-8"), "text/plain")},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return owner, project_id, r.json()["data"]["material_id"], headers


async def _seed_data(project_id: str, material_id: str) -> None:
    """构造材料原文切块、事实/证据/修订，以及复现运行与修复历史。"""
    from app.models import AIRun, AuditFinding, Evidence, ExtractedFact, SourceChunk
    from app.models.stage2 import EvidenceItem, FactRevision
    from app.models.stage4 import (
        ExecutionArtifact,
        ExecutionLog,
        FailureDiagnostic,
        RemediationProposal,
        ReproductionMetric,
        ReproductionPlan,
        ReproductionReport,
        ReproductionRun,
        ReproductionTask,
    )

    async with _session() as db:
        db.add_all([
            SourceChunk(material_id=material_id, project_id=project_id,
                        chunk_id="chunk-1", chunk_index=0, original_text=CHUNK_TEXT_1),
            SourceChunk(material_id=material_id, project_id=project_id,
                        chunk_id="chunk-2", chunk_index=1, original_text=CHUNK_TEXT_2),
            ExtractedFact(run_id="ai-1", project_id=project_id, material_id=material_id,
                          chunk_id="chunk-1", fact_id="fact-1", field_key="learning_rate",
                          raw_value="0.001", extraction_status="needs_review",
                          parser_source="model", source_name="paper.txt"),
            AIRun(id="ai-1", project_id=project_id, run_type="parse", status="completed",
                  success=True),
            ReproductionPlan(id="plan-1", project_id=project_id, title="复现计划"),
            ReproductionTask(id="task-1", plan_id="plan-1", project_id=project_id,
                             task_key="T1", title="需人工确认的步骤",
                             needs_human_confirm=True),
            ReproductionRun(id="run-1", project_id=project_id, plan_id="plan-1",
                            status="failed"),
            ExecutionLog(log_id="log-1", run_id="run-1", project_id=project_id,
                         stream="stderr", content="error: missing dependency"),
            ExecutionArtifact(artifact_id="art-1", run_id="run-1", project_id=project_id,
                              name="output.txt", size_bytes=3, hash="abc"),
            ReproductionMetric(run_id="run-1", project_id=project_id,
                               metric_name="accuracy", metric_value=0.915,
                               needs_manual_review=True),
            FailureDiagnostic(id="diag-1", run_id="run-1", project_id=project_id,
                              problem="缺少依赖", error_evidence="error: missing dependency",
                              needs_human_confirm=True),
            RemediationProposal(id="prop-1", diagnostic_id="diag-1", project_id=project_id,
                                change_type="dependency", target_file="requirements.txt"),
            ReproductionReport(id="report-1", project_id=project_id, title="复现报告",
                               sections_json="[]"),
        ])
        await db.flush()
        finding = AuditFinding(run_id="ai-1", project_id=project_id,
                               field_key="learning_rate", severity="medium",
                               title="学习率待复核")
        db.add(finding)
        await db.flush()
        db.add_all([
            Evidence(evidence_id="ev-stage1", finding_id=finding.id,
                     project_id=project_id, material_id=material_id, chunk_id="chunk-1",
                     source_name="paper.txt", original_text=CHUNK_TEXT_1),
            EvidenceItem(evidence_id="ev-stage2", fact_id="fact-1", project_id=project_id,
                         material_id=material_id, chunk_id="chunk-1",
                         source_name="paper.txt", quote="学习率 0.001",
                         original_text=CHUNK_TEXT_1, verification_status="verified"),
            FactRevision(revision_id="rev-1", fact_id="fact-1", field_key="learning_rate",
                         old_value="0.01", new_value="0.001", note="人工修订"),
        ])
        await db.commit()


async def _export(client, project_id: str, headers: dict) -> bytes:
    r = await client.post(f"/api/v1/projects/{project_id}/handoff/export", headers=headers)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/zip")
    assert "attachment" in r.headers["content-disposition"]
    assert r.content[:2] == b"PK"
    return r.content


def _unpack(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data), "r") as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def _pack(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


async def _validate(client, project_id: str, headers: dict, data: bytes):
    return await client.post(
        f"/api/v1/projects/{project_id}/handoff/validate",
        files={"file": ("bundle.zip", data, "application/zip")},
        headers=headers,
    )


@pytest.mark.asyncio
async def test_export_zip_manifest_hashes_and_material_text(client, monkeypatch):
    _, project_id, material_id, headers = await _setup_project(
        client, monkeypatch, "handoff-export@example.com")
    await _seed_data(project_id, material_id)

    data = await _export(client, project_id, headers)
    files = _unpack(data)
    manifest = json.loads(files["manifest.json"])

    assert manifest["bundle_version"] == "1.0"
    assert manifest["project_id"] == project_id
    assert "T" in manifest["generated_at"] and "+00:00" in manifest["generated_at"]
    assert set(("generated_at", "bundle_version", "counts", "files")) <= set(manifest)
    assert manifest["counts"]["materials"] == 1
    assert manifest["counts"]["facts"] == 1

    text_path = f"materials/{material_id}.txt"
    assert text_path in files
    text = files[text_path].decode("utf-8")
    assert CHUNK_TEXT_1 in text and CHUNK_TEXT_2 in text
    # manifest 中每个载荷文件的 sha256/size_bytes 必须与真实内容一致。
    for path, meta in manifest["files"].items():
        content = files[path]
        assert hashlib.sha256(content).hexdigest() == meta["sha256"], path
        assert len(content) == meta["size_bytes"], path


@pytest.mark.asyncio
async def test_export_includes_evidence_revisions_reproduction_and_unresolved(client, monkeypatch):
    _, project_id, material_id, headers = await _setup_project(
        client, monkeypatch, "handoff-content@example.com")
    await _seed_data(project_id, material_id)

    files = _unpack(await _export(client, project_id, headers))
    assert json.loads(files["project.json"])["id"] == project_id
    assert json.loads(files["facts.json"])[0]["fact_id"] == "fact-1"
    evidence = json.loads(files["evidence.json"])
    assert evidence["evidences"][0]["evidence_id"] == "ev-stage1"
    assert evidence["evidence_items"][0]["evidence_id"] == "ev-stage2"
    assert json.loads(files["fact_revisions.json"])[0]["revision_id"] == "rev-1"
    assert json.loads(files["parse_runs.json"])["ai_runs"][0]["id"] == "ai-1"
    repro = json.loads(files["reproduction.json"])
    assert repro["runs"][0]["id"] == "run-1"
    assert repro["metrics"][0]["needs_manual_review"] is True
    assert json.loads(files["execution_logs.json"])[0]["content"] == "error: missing dependency"
    assert json.loads(files["execution_artifacts.json"])[0]["artifact_id"] == "art-1"
    assert json.loads(files["reports.json"])[0]["title"] == "复现报告"

    kinds = {item["kind"] for item in json.loads(files["unresolved.json"])}
    assert {"fact_needs_review", "task_needs_human_confirm",
            "diagnostic_needs_human_confirm"} <= kinds
    remediation = json.loads(files["remediation.json"])
    assert remediation["failure_diagnostics"][0]["id"] == "diag-1"
    assert remediation["remediation_proposals"][0]["id"] == "prop-1"


@pytest.mark.asyncio
async def test_export_and_validate_reject_non_member(client, monkeypatch):
    _, project_id, _, headers = await _setup_project(
        client, monkeypatch, "handoff-owner2@example.com")
    outsider = await _register(client, "handoff-outsider@example.com")
    outsider_headers = _auth(outsider["token"])

    r = await client.post(f"/api/v1/projects/{project_id}/handoff/export",
                          headers=outsider_headers)
    assert r.status_code in (403, 404)
    assert r.json()["error"]["code"] in ("FORBIDDEN", "NOT_FOUND")
    r = await _validate(client, project_id, outsider_headers, b"PK\x03\x04invalid")
    assert r.status_code in (403, 404)
    # 未登录请求同样被拒绝。
    r = await client.post(f"/api/v1/projects/{project_id}/handoff/export")
    assert r.status_code in (401, 403)
    assert headers  # 负责人凭据已用于建项目


@pytest.mark.asyncio
async def test_validate_valid_zip(client, monkeypatch):
    _, project_id, material_id, headers = await _setup_project(
        client, monkeypatch, "handoff-valid@example.com")
    await _seed_data(project_id, material_id)
    zip_bytes = await _export(client, project_id, headers)

    r = await _validate(client, project_id, headers, zip_bytes)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    assert body["data"]["valid"] is True
    assert body["data"]["import_mode"] == "validated_not_applied"
    assert body["data"]["manifest"]["project_id"] == project_id
    assert "manifest.json" in body["data"]["files"]
    assert f"materials/{material_id}.txt" in body["data"]["files"]


@pytest.mark.asyncio
async def test_validate_tampered_file_content_422(client, monkeypatch):
    _, project_id, material_id, headers = await _setup_project(
        client, monkeypatch, "handoff-tamper-content@example.com")
    await _seed_data(project_id, material_id)
    files = _unpack(await _export(client, project_id, headers))
    text_path = f"materials/{material_id}.txt"
    files[text_path] = files[text_path].replace(CHUNK_TEXT_1.encode("utf-8"),
                                               b"tampered text")

    r = await _validate(client, project_id, headers, _pack(files))
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_validate_tampered_manifest_hash_422(client, monkeypatch):
    _, project_id, material_id, headers = await _setup_project(
        client, monkeypatch, "handoff-tamper-manifest@example.com")
    await _seed_data(project_id, material_id)
    files = _unpack(await _export(client, project_id, headers))
    manifest = json.loads(files["manifest.json"])
    target = f"materials/{material_id}.txt"
    manifest["files"][target]["sha256"] = "0" * 64
    files["manifest.json"] = json.dumps(manifest, ensure_ascii=False).encode("utf-8")

    r = await _validate(client, project_id, headers, _pack(files))
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_validate_zip_slip_rejected(client, monkeypatch):
    _, project_id, material_id, headers = await _setup_project(
        client, monkeypatch, "handoff-zip-slip@example.com")
    await _seed_data(project_id, material_id)
    original = _unpack(await _export(client, project_id, headers))

    for bad_path in ("../evil.txt", "/tmp/evil.txt", "C:\\evil.txt", "a/../../evil.txt"):
        files = dict(original)
        files[bad_path] = b"evil"
        r = await _validate(client, project_id, headers, _pack(files))
        assert r.status_code == 422, (bad_path, r.text)
        assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_validate_oversize_zip_rejected(client, monkeypatch):
    from app.services import handoff_service as svc

    _, project_id, material_id, headers = await _setup_project(
        client, monkeypatch, "handoff-oversize@example.com")
    await _seed_data(project_id, material_id)
    zip_bytes = await _export(client, project_id, headers)
    monkeypatch.setattr(svc, "MAX_BUNDLE_BYTES", len(zip_bytes) - 1)

    r = await _validate(client, project_id, headers, zip_bytes)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_validate_too_many_entries_rejected(client, monkeypatch):
    from app.services import handoff_service as svc

    _, project_id, material_id, headers = await _setup_project(
        client, monkeypatch, "handoff-many-entries@example.com")
    await _seed_data(project_id, material_id)
    zip_bytes = await _export(client, project_id, headers)
    monkeypatch.setattr(svc, "MAX_BUNDLE_ENTRIES", len(_unpack(zip_bytes)) - 1)

    r = await _validate(client, project_id, headers, zip_bytes)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_validate_missing_manifest_and_bad_suffix_rejected(client, monkeypatch):
    _, project_id, material_id, headers = await _setup_project(
        client, monkeypatch, "handoff-format@example.com")
    await _seed_data(project_id, material_id)
    original = _unpack(await _export(client, project_id, headers))

    no_manifest = dict(original)
    no_manifest.pop("manifest.json")
    r = await _validate(client, project_id, headers, _pack(no_manifest))
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"

    bad_suffix = dict(original)
    bad_suffix["payload.exe"] = b"MZ"
    r = await _validate(client, project_id, headers, _pack(bad_suffix))
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"
