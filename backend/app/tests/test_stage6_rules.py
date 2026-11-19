"""第六阶段 C 组测试：审计规则生命周期 / 反馈治理 / 受控 RAG。

覆盖：种子幂等、新版本须附测试样本、回滚保留历史、真实 pass/fail 评估、
反馈绝不自动改规则、争议转人工、RAG 来源分级与当前证据优先、rule.manage 权限、
离线评估指标与版本前后对比。全部使用真实注册用户与 JWT。

注意：本模块自行把 C 组路由挂到 app（owner 后续在 app/api/__init__.py 正式挂载）；
挂载带幂等守卫，避免重复注册影响其它测试。
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.api.v1 import feedback as feedback_router
from app.api.v1 import rag as rag_router
from app.api.v1 import rules as rules_router
from app.db import get_db
from app.main import app
from app.models.stage6 import OrgMember


def _register_routers() -> None:
    paths = {getattr(r, "path", None) for r in app.routes}
    if "/api/v1/rules" not in paths:
        app.include_router(rules_router.router, prefix="/api/v1")
        app.include_router(feedback_router.router, prefix="/api/v1")
        app.include_router(rag_router.router, prefix="/api/v1")


_register_routers()


async def _register(client, email, password="password123", name="测试用户"):
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": password, "display_name": name})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _org_id(client, token):
    r = await client.get("/api/v1/auth/me", headers=_auth(token))
    return r.json()["data"]["organizations"][0]["id"]


async def _project(client, token, name="C组项目"):
    r = await client.post("/api/v1/projects", json={"name": name}, headers=_auth(token))
    assert r.status_code == 200, r.text
    return r.json()["data"]["id"]


async def _demote_to_member(user_id):
    """把用户个人组织角色降为 member，使其不再具备 org 级 rule.manage。"""
    factory = app.dependency_overrides[get_db]
    async for db in factory():
        m = (await db.execute(select(OrgMember).where(OrgMember.user_id == user_id))).scalar_one()
        m.role_key = "member"
        await db.commit()
        break


def _rule_create_body(rule_key="custom_param", logic=None, samples=None):
    return {
        "rule_key": rule_key, "name": "自定义参数规则", "domain": "机器学习",
        "risk_level": "high", "check_logic_json": logic or {"type": "field_compare", "fields": ["batch_size"], "tolerance": 1e-6},
        "test_samples": samples if samples is not None else [
            {"label": "ok", "input": {"a": {"batch_size": 64}, "b": {"batch_size": 64}}, "expected": {"status": "consistent"}}],
    }


@pytest.mark.asyncio
async def test_seed_defaults_idempotent(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "seed-admin@example.com")
    h = _auth(a["token"])

    r = await client.post("/api/v1/rules/seed", headers=h)
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert set(d["seeded"]) == {"param_consistency", "unit_mismatch", "missing_evidence"}
    assert d["skipped"] == [] and d["total"] == 3

    # 再次种子：全部跳过，不重复
    r2 = await client.post("/api/v1/rules/seed", headers=h)
    d2 = r2.json()["data"]
    assert d2["seeded"] == [] and set(d2["skipped"]) == {"param_consistency", "unit_mismatch", "missing_evidence"}

    rules = (await client.get("/api/v1/rules", headers=h)).json()["data"]
    assert rules["total"] == 3
    pc = next(x for x in rules["items"] if x["rule_key"] == "param_consistency")
    assert pc["current_version"] == 1 and pc["is_enabled"] is True
    assert pc["check_logic"]["type"] == "field_compare"


@pytest.mark.asyncio
async def test_create_version_requires_test_samples(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "ver-admin@example.com")
    h = _auth(a["token"])

    r = await client.post("/api/v1/rules", json=_rule_create_body(), headers=h)
    assert r.status_code == 200, r.text
    rid = r.json()["data"]["id"]
    assert r.json()["data"]["current_version"] == 1

    # 无测试样本 -> 拒绝
    bad = await client.post(f"/api/v1/rules/{rid}/versions",
                            json={"check_logic_json": {"type": "field_compare", "fields": ["batch_size"], "tolerance": 1e-3},
                                  "change_note": "放宽容差", "test_samples": []}, headers=h)
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "VALIDATION_ERROR"

    # 附样本 -> 成功，版本递增，旧版本停用
    good = await client.post(f"/api/v1/rules/{rid}/versions",
                             json={"check_logic_json": {"type": "field_compare", "fields": ["batch_size"], "tolerance": 1e-3},
                                   "change_note": "放宽容差",
                                   "test_samples": [{"label": "s", "input": {"a": {"batch_size": 64}, "b": {"batch_size": 64}},
                                                     "expected": {"status": "consistent"}}]}, headers=h)
    assert good.status_code == 200, good.text
    assert good.json()["data"]["current_version"] == 2

    versions = (await client.get(f"/api/v1/rules/{rid}/versions", headers=h)).json()["data"]["items"]
    assert len(versions) == 2
    active = [v for v in versions if v["is_active"]]
    assert len(active) == 1 and active[0]["version"] == 2
    assert all(v["sample_count"] >= 1 for v in versions)


@pytest.mark.asyncio
async def test_rollback_restores_logic_and_keeps_history(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "rollback-admin@example.com")
    h = _auth(a["token"])
    logic_v1 = {"type": "field_compare", "fields": ["batch_size", "learning_rate"], "tolerance": 1e-6}
    rid = (await client.post("/api/v1/rules", json=_rule_create_body(logic=logic_v1), headers=h)).json()["data"]["id"]

    logic_v2 = {"type": "field_compare", "fields": ["batch_size"], "tolerance": 1e-2}
    await client.post(f"/api/v1/rules/{rid}/versions",
                      json={"check_logic_json": logic_v2, "change_note": "v2",
                            "test_samples": [{"label": "s", "input": {"a": {"batch_size": 64}, "b": {"batch_size": 64}},
                                              "expected": {"status": "consistent"}}]}, headers=h)

    rb = await client.post(f"/api/v1/rules/{rid}/rollback", json={"version": 1}, headers=h)
    assert rb.status_code == 200, rb.text
    d = rb.json()["data"]
    assert d["rolled_back_to"] == 1
    assert d["current_version"] == 3  # 全新版本号，而非复用 1
    assert d["check_logic"] == logic_v1  # 逻辑恢复

    versions = (await client.get(f"/api/v1/rules/{rid}/versions", headers=h)).json()["data"]["items"]
    assert len(versions) == 3  # 历史完整保留
    by_no = {v["version"]: v for v in versions}
    assert by_no[3]["is_active"] is True
    assert by_no[1]["is_active"] is False and by_no[2]["is_active"] is False
    assert by_no[3]["check_logic"] == logic_v1
    assert by_no[3]["sample_count"] >= 1  # 回滚后仍可离线测试

    # 回滚到不存在版本 -> 404
    missing = await client.post(f"/api/v1/rules/{rid}/rollback", json={"version": 99}, headers=h)
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_run_rule_tests_real_pass_fail(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "test-admin@example.com")
    h = _auth(a["token"])
    await client.post("/api/v1/rules/seed", headers=h)
    rules = (await client.get("/api/v1/rules", headers=h)).json()["data"]["items"]
    pc = next(x for x in rules if x["rule_key"] == "param_consistency")

    # 种子样本全部通过（评估器真实计算）
    r = await client.post(f"/api/v1/rules/{pc['id']}/test", headers=h)
    d = r.json()["data"]
    assert d["total"] == 3 and d["passed"] == 3 and d["pass_rate"] == 1.0

    # 自定义规则：一条 expected 正确（pass），一条 expected 故意写错（fail）
    samples = [
        {"label": "correct", "input": {"a": {"batch_size": 64}, "b": {"batch_size": 32}},
         "expected": {"status": "conflict", "conflict_fields": ["batch_size"]}},
        {"label": "wrong_expected", "input": {"a": {"batch_size": 64}, "b": {"batch_size": 32}},
         "expected": {"status": "consistent"}},  # 实际冲突，期望却写一致 -> 必 fail
    ]
    rid = (await client.post("/api/v1/rules", json=_rule_create_body(rule_key="fail_demo", samples=samples), headers=h)).json()["data"]["id"]
    r2 = await client.post(f"/api/v1/rules/{rid}/test", headers=h)
    d2 = r2.json()["data"]
    assert d2["total"] == 2 and d2["passed"] == 1 and d2["failed"] == 1 and d2["pass_rate"] == 0.5
    by_label = {x["label"]: x for x in d2["results"]}
    assert by_label["correct"]["passed"] is True
    assert by_label["wrong_expected"]["passed"] is False
    assert by_label["wrong_expected"]["actual"]["status"] == "conflict"


@pytest.mark.asyncio
async def test_feedback_does_not_change_rule(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "fb-admin@example.com")
    h = _auth(a["token"])
    pid = await _project(client, a["token"])
    await client.post("/api/v1/rules/seed", headers=h)
    rules = (await client.get("/api/v1/rules", headers=h)).json()["data"]["items"]
    pc = next(x for x in rules if x["rule_key"] == "param_consistency")
    rid = pc["id"]
    before_versions = (await client.get(f"/api/v1/rules/{rid}/versions", headers=h)).json()["data"]["total"]
    before_rule = (await client.get(f"/api/v1/rules/{rid}", headers=h)).json()["data"]

    fb = await client.post("/api/v1/feedback",
                           json={"project_id": pid, "finding_id": "finding-1", "feedback_type": "false_positive",
                                 "note": "我认为这是误报", "evidence_ref": "chunk-9"}, headers=h)
    assert fb.status_code == 200, fb.text
    assert fb.json()["data"]["status"] == "open"

    # 规则版本 / 逻辑 / 启停完全不变
    after_rule = (await client.get(f"/api/v1/rules/{rid}", headers=h)).json()["data"]
    after_versions = (await client.get(f"/api/v1/rules/{rid}/versions", headers=h)).json()["data"]["total"]
    assert after_rule["current_version"] == before_rule["current_version"] == 1
    assert after_rule["check_logic"] == before_rule["check_logic"]
    assert after_rule["is_enabled"] == before_rule["is_enabled"] is True
    assert after_versions == before_versions == 1

    listed = (await client.get(f"/api/v1/feedback?project_id={pid}", headers=h)).json()["data"]
    assert listed["total"] == 1 and listed["items"][0]["feedback_type"] == "false_positive"


@pytest.mark.asyncio
async def test_triage_disputed_goes_to_human_review(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "triage-admin@example.com")
    h = _auth(a["token"])
    pid = await _project(client, a["token"])
    fid = (await client.post("/api/v1/feedback",
                             json={"project_id": pid, "finding_id": "f-2", "feedback_type": "request_review",
                                   "note": "请复核"}, headers=h)).json()["data"]["id"]

    tr = await client.post(f"/api/v1/feedback/{fid}/triage",
                           json={"status": "disputed", "resolution": "双方证据冲突，需人工裁定"}, headers=h)
    assert tr.status_code == 200, tr.text
    d = tr.json()["data"]
    assert d["status"] == "disputed" and d["requires_human_review"] is True
    assert d["review_id"]

    # 争议进入人工复核队列（ReviewRequest target_type=feedback, pending）
    reviews = (await client.get(f"/api/v1/projects/{pid}/reviews", headers=h)).json()["data"]["items"]
    fb_reviews = [x for x in reviews if x["target_type"] == "feedback" and x["target_id"] == fid]
    assert len(fb_reviews) == 1 and fb_reviews[0]["status"] == "pending"

    # resolved 分诊记录裁定人
    fid2 = (await client.post("/api/v1/feedback",
                              json={"project_id": pid, "feedback_type": "confirm", "note": "确认问题"}, headers=h)).json()["data"]["id"]
    tr2 = await client.post(f"/api/v1/feedback/{fid2}/triage", json={"status": "resolved", "resolution": "已确认"}, headers=h)
    assert tr2.json()["data"]["status"] == "resolved"
    assert tr2.json()["data"]["resolved_by"] == a["user"]["id"]

    # 非法状态 -> 422
    bad = await client.post(f"/api/v1/feedback/{fid2}/triage", json={"status": "auto_learn"}, headers=h)
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_rag_provenance_and_current_evidence_priority(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "rag-admin@example.com")
    h = _auth(a["token"])
    pid = await _project(client, a["token"])

    d1 = await client.post("/api/v1/rag/documents",
                           json={"source_type": "verified_case", "source_ref": "case-001",
                                 "title": "ResNet 复现基准案例", "content": "batch size 64 learning rate 0.001 epochs 100",
                                 "is_public": True}, headers=h)
    assert d1.status_code == 200, d1.text
    assert d1.json()["data"]["provenance_class"] == "historical_case"

    d2 = await client.post("/api/v1/rag/documents",
                           json={"source_type": "audit_rule", "source_ref": "rule-param",
                                 "title": "参数一致性审计规则", "content": "learning rate batch size 相对容差 比对",
                                 "is_public": True}, headers=h)
    assert d2.json()["data"]["provenance_class"] == "external_knowledge"

    q = await client.post("/api/v1/rag/query", json={"query": "learning rate batch size", "top_k": 5}, headers=h)
    assert q.status_code == 200, q.text
    data = q.json()["data"]
    assert len(data["hits"]) >= 1
    for hit in data["hits"]:
        assert hit["source_ref"]
        assert hit["score"] > 0
        assert hit["provenance_class"] in {"historical_case", "external_knowledge"}
        # 知识库内容永远不是当前证据
        assert hit["provenance_class"] != "current_evidence"
    assert set(data["provenance"]["classes"]) == {"current_evidence", "historical_case", "external_knowledge", "model_inference"}

    # 给定项目：强制当前证据优先提示
    qp = await client.post("/api/v1/rag/query", json={"query": "batch size", "project_id": pid, "top_k": 3}, headers=h)
    note = qp.json()["data"]["provenance"]["current_evidence_priority"]
    assert "当前论文原始证据" in note and "优先" in note and "不得覆盖" in note
    assert all(hit["provenance_class"] != "current_evidence" for hit in qp.json()["data"]["hits"])

    # 非法 source_type -> 422
    bad = await client.post("/api/v1/rag/documents",
                            json={"source_type": "model_inference", "title": "x", "content": "y"}, headers=h)
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_rule_manage_permission_enforced(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "perm-admin@example.com")
    b = await _register(client, "perm-member@example.com")
    await _demote_to_member(b["user"]["id"])

    # 非管理员（org member）不能创建规则 / 种子
    r = await client.post("/api/v1/rules", json=_rule_create_body(rule_key="no_perm"), headers=_auth(b["token"]))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"
    assert (await client.post("/api/v1/rules/seed", headers=_auth(b["token"]))).status_code == 403

    # 管理员可以
    ok_r = await client.post("/api/v1/rules", json=_rule_create_body(rule_key="yes_perm"), headers=_auth(a["token"]))
    assert ok_r.status_code == 200

    # 未认证 -> 401
    assert (await client.post("/api/v1/rules", json=_rule_create_body(rule_key="anon"))).status_code == 401


@pytest.mark.asyncio
async def test_offline_evaluation_metrics_and_version_compare(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "eval-admin@example.com")
    h = _auth(a["token"])

    # v1 容差过松（1.0）：64 vs 32 被判一致 -> 漏检；v2 容差 1e-6：正确检出
    loose = {"type": "field_compare", "fields": ["batch_size"], "tolerance": 1.0}
    rid = (await client.post("/api/v1/rules", json=_rule_create_body(rule_key="eval_demo", logic=loose), headers=h)).json()["data"]["id"]
    tight = {"type": "field_compare", "fields": ["batch_size"], "tolerance": 1e-6}
    await client.post(f"/api/v1/rules/{rid}/versions",
                      json={"check_logic_json": tight, "change_note": "收紧容差",
                            "test_samples": [{"label": "s", "input": {"a": {"batch_size": 64}, "b": {"batch_size": 32}},
                                              "expected": {"status": "conflict"}}]}, headers=h)

    samples = [
        {"label": "conflict1", "input": {"a": {"batch_size": 64}, "b": {"batch_size": 32}}, "expected": {"status": "conflict"}},
        {"label": "consistent", "input": {"a": {"batch_size": 64}, "b": {"batch_size": 64}}, "expected": {"status": "consistent"}},
        {"label": "conflict2", "input": {"a": {"batch_size": 64}, "b": {"batch_size": 32}}, "expected": {"status": "conflict"}},
    ]
    ev = await client.post(f"/api/v1/rules/{rid}/evaluate",
                           json={"dataset_ref": "ds-001", "samples": samples, "baseline_version": 1}, headers=h)
    assert ev.status_code == 200, ev.text
    d = ev.json()["data"]
    assert d["baseline"]["version"] == 1 and d["candidate"]["version"] == 2
    # v1 漏检：recall 0, fn_rate 1；v2 全检出：recall 1, precision 1
    assert d["baseline"]["metrics"]["recall"] == 0.0
    assert d["baseline"]["metrics"]["fn_rate"] == 1.0
    assert d["candidate"]["metrics"]["recall"] == 1.0
    assert d["candidate"]["metrics"]["precision"] == 1.0
    assert d["candidate"]["metrics"]["fp_rate"] == 0.0
    assert d["delta"]["recall"] == 1.0
    assert d["candidate"]["metrics"]["runtime_ms"] >= 0

    # 两条评估落库
    evals = (await client.get(f"/api/v1/rules/{rid}/evaluations", headers=h)).json()["data"]
    assert evals["total"] == 2
    assert {e["version"] for e in evals["items"]} == {1, 2}

    # 单版本评估（无 baseline）也可用并落库
    ev2 = await client.post(f"/api/v1/rules/{rid}/evaluate", json={"dataset_ref": "ds-002", "samples": samples}, headers=h)
    assert ev2.status_code == 200
    assert ev2.json()["data"]["metrics"]["recall"] == 1.0
    evals2 = (await client.get(f"/api/v1/rules/{rid}/evaluations", headers=h)).json()["data"]
    assert evals2["total"] == 3


@pytest.mark.asyncio
async def test_percent_accuracy_fields_use_absolute_tolerance(client, monkeypatch):
    """百分号字符串的指标字段按绝对容差比对（镜像 MetricComparator），不得退化为字符串相等。"""
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "pct-admin@example.com")
    h = _auth(a["token"])
    v1 = {"type": "field_compare", "fields": ["top1_accuracy"], "tolerance": 0.001}
    rid = (await client.post("/api/v1/rules", json=_rule_create_body(rule_key="pct_acc", logic=v1), headers=h)).json()["data"]["id"]
    v2 = {"type": "field_compare", "fields": ["top1_accuracy"], "tolerance": 0.002}
    await client.post(f"/api/v1/rules/{rid}/versions",
                      json={"check_logic_json": v2, "change_note": "放宽至 0.2pp",
                            "test_samples": [{"label": "gap", "input": {"a": {"top1_accuracy": "76.1%"}, "b": {"top1_accuracy": "75.95%"}},
                                              "expected": {"status": "consistent"}}]}, headers=h)
    samples = [
        {"label": "protocol_gap", "input": {"a": {"top1_accuracy": "76.1%"}, "b": {"top1_accuracy": "75.95%"}},
         "expected": {"status": "consistent"}},
        {"label": "within", "input": {"a": {"top1_accuracy": "76.1%"}, "b": {"top1_accuracy": "76.05%"}},
         "expected": {"status": "consistent"}},
        {"label": "beyond", "input": {"a": {"top1_accuracy": "76.1%"}, "b": {"top1_accuracy": "75.3%"}},
         "expected": {"status": "conflict"}},
    ]
    ev = await client.post(f"/api/v1/rules/{rid}/evaluate",
                           json={"dataset_ref": "ds-pct", "samples": samples, "baseline_version": 1}, headers=h)
    assert ev.status_code == 200, ev.text
    d = ev.json()["data"]
    # 0.15pp 协议差异：v1(0.1pp) 误报，v2(0.2pp) 判一致
    assert d["baseline"]["metrics"]["precision"] == 0.5
    assert d["baseline"]["metrics"]["fp_rate"] == 0.5
    assert d["candidate"]["metrics"]["precision"] == 1.0
    assert d["candidate"]["metrics"]["fp_rate"] == 0.0
    assert d["delta"]["precision"] == 0.5
    assert all(r["matched"] for r in d["candidate"]["results"])