"""第六阶段 B 组测试：基准案例 / 事实归一化 / 可见性隔离 / 质量阶梯 / 参考检索。

全部使用真实注册用户与 JWT，并关闭匿名开发放行以验证真实隔离。
路由由本模块挂载（app/api/__init__.py 属共享文件，集成负责人统一接线）。
"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager

import pytest

from app.core.errors import AppError


# ---------------------------- 基础设施 ----------------------------

@asynccontextmanager
async def _db():
    """取一个与 client 同库的会话，用完显式关闭（避免异步生成器悬挂）。"""
    from app.db import get_db
    from app.main import app
    gen = app.dependency_overrides[get_db]()
    session = await gen.__anext__()
    try:
        yield session
    finally:
        await gen.aclose()

@pytest.fixture(scope="module", autouse=True)
def _mount_benchmark_routes():
    """把 B 组路由挂到测试 app（幂等：已接线则跳过）。"""
    from app.api.v1 import cases, fact_schema
    from app.main import app
    paths = {getattr(r, "path", "") for r in app.routes}
    if "/api/v1/cases" not in paths:
        app.include_router(cases.router, prefix="/api/v1")
    if "/api/v1/fact-schema" not in paths:
        app.include_router(fact_schema.router, prefix="/api/v1")
    yield


@pytest.fixture(autouse=True)
def _strict_auth(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)


async def _register(client, email, name="测试用户"):
    r = await client.post("/api/v1/auth/register",
                          json={"email": email, "password": "password123", "display_name": name})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _org_id(client, token):
    r = await client.get("/api/v1/auth/me", headers=_auth(token))
    assert r.status_code == 200, r.text
    return r.json()["data"]["organizations"][0]["id"]


async def _invite_as(client, org_id, owner_token, email, role_key="org_admin"):
    """邀请用户进入组织并接受，返回被邀请者的注册数据。"""
    r = await client.post(f"/api/v1/orgs/{org_id}/invitations",
                          json={"email": email, "role_key": role_key}, headers=_auth(owner_token))
    assert r.status_code == 200, r.text
    token = r.json()["data"]["token"]
    invitee = await _register(client, email)
    r = await client.post("/api/v1/invitations/accept", json={"token": token},
                          headers=_auth(invitee["token"]))
    assert r.status_code == 200, r.text
    return invitee


def _payload(**over):
    data = {
        "title": "ResNet-50 在 CIFAR-10 上的训练复现基准",
        "doi": "10.48550/arXiv.1512.03385",
        "source_url": "https://arxiv.org/abs/1512.03385",
        "domain": "computer_vision",
        "research_task": "image_classification",
        "model_architecture": "ResNet-50",
        "dataset_name": "cifar-10",
        "code_repo_url": "https://github.com/example/resnet-cifar",
        "code_commit": "a1b2c3d4e5f6",
        "license": "MIT",
        "summary": "复现 ResNet-50 在 CIFAR-10 上的训练：learning rate 0.1，batch size 128，SGD 动量 0.9，cosine 学习率衰减。",
    }
    data.update(over)
    return data


async def _create_case(client, token, **over):
    r = await client.post("/api/v1/cases", json=_payload(**over), headers=_auth(token))
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def _add_fact(client, token, case_id, raw_field, raw_value, **over):
    body = {"raw_field": raw_field, "raw_value": raw_value}
    body.update(over)
    r = await client.post(f"/api/v1/cases/{case_id}/facts", json=body, headers=_auth(token))
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def _verify(client, token, case_id, verification_type, result="pass", conditions=None, notes=""):
    r = await client.post(f"/api/v1/cases/{case_id}/verifications",
                          json={"verification_type": verification_type, "result": result,
                                "conditions_json": conditions, "notes": notes},
                          headers=_auth(token))
    assert r.status_code == 200, r.text
    return r.json()["data"]


_ENV = {"gpu": "NVIDIA GeForce RTX 3090", "python_version": "3.10.12",
        "pytorch_version": "2.1.0+cu118", "cuda_version": "11.8",
        "operating_system": "Ubuntu 20.04"}


# ---------------------------- 案例创建与列表 ----------------------------

@pytest.mark.asyncio
async def test_create_and_list_case_with_filters(client):
    a = await _register(client, "bench-owner@example.com", "基准维护者")
    case = await _create_case(client, a["token"])
    assert case["id"].startswith("case-")
    assert case["quality_level"] == "unverified"
    assert case["created_by"] == a["user"]["id"]
    assert case["org_id"] == await _org_id(client, a["token"])
    assert case["dataset_name"] == "CIFAR-10"          # 数据集名归一化
    assert case["is_public"] is False
    assert case["traceability"]["complete"] is True

    await _create_case(client, a["token"], title="ViT 在 ImageNet 上的微调基准",
                       domain="computer_vision", research_task="image_classification",
                       dataset_name="imagenet", model_architecture="ViT-B/16",
                       summary="Vision Transformer fine-tuning on ImageNet-1k.")
    await _create_case(client, a["token"], title="BERT 在 SQuAD 上的抽取式问答基准",
                       domain="nlp", research_task="question_answering",
                       dataset_name="squad", model_architecture="BERT-base",
                       summary="Extractive question answering with BERT.")

    r = await client.get("/api/v1/cases", headers=_auth(a["token"]))
    assert r.status_code == 200
    body = r.json()["data"]
    assert body["total"] == 3 and len(body["items"]) == 3
    assert body["limit"] == 20 and body["offset"] == 0

    # 结构化筛选
    for params, expected in [
        ({"domain": "nlp"}, 1),
        ({"research_task": "image_classification"}, 2),
        ({"dataset": "cifar10"}, 1),
        ({"quality_level": "unverified"}, 3),
        ({"quality_level": "execution_verified"}, 0),
        ({"q": "resnet"}, 1),
        ({"q": "BERT"}, 1),
    ]:
        r = await client.get("/api/v1/cases", params=params, headers=_auth(a["token"]))
        assert r.status_code == 200, r.text
        assert r.json()["data"]["total"] == expected, (params, r.text)

    # 分页与非法筛选
    r = await client.get("/api/v1/cases", params={"limit": 2, "offset": 2}, headers=_auth(a["token"]))
    assert len(r.json()["data"]["items"]) == 1 and r.json()["data"]["total"] == 3
    r = await client.get("/api/v1/cases", params={"quality_level": "ai_says_verified"},
                         headers=_auth(a["token"]))
    assert r.status_code == 422
    # 排序与公共标记筛选
    r = await client.get("/api/v1/cases", params={"sort": "quality"}, headers=_auth(a["token"]))
    assert r.status_code == 200 and len(r.json()["data"]["items"]) == 3
    r = await client.get("/api/v1/cases", params={"sort": "updated"}, headers=_auth(a["token"]))
    assert r.status_code == 200 and r.json()["data"]["total"] == 3
    r = await client.get("/api/v1/cases", params={"sort": "title", "limit": 1}, headers=_auth(a["token"]))
    assert r.json()["data"]["items"][0]["title"] == "BERT 在 SQuAD 上的抽取式问答基准"
    r = await client.get("/api/v1/cases", params={"is_public": "false"}, headers=_auth(a["token"]))
    assert r.json()["data"]["total"] == 3
    r = await client.get("/api/v1/cases", params={"is_public": "true"}, headers=_auth(a["token"]))
    assert r.json()["data"]["total"] == 0
    r = await client.get("/api/v1/cases", params={"sort": "bogus"}, headers=_auth(a["token"]))
    assert r.status_code == 422

    # 详情含质量阶梯与验证清单
    r = await client.get(f"/api/v1/cases/{case['id']}", headers=_auth(a["token"]))
    detail = r.json()["data"]
    assert detail["fact_count"] == 0 and detail["verifications"] == []
    assert [lv["key"] for lv in detail["quality_standard"]["levels"]] == [
        "unverified", "partially_verified", "execution_verified", "independently_reviewed"]


# ---------------------------- 事实归一化与字段目录 ----------------------------

@pytest.mark.asyncio
async def test_fact_normalization_and_field_schema(client):
    a = await _register(client, "fact-owner@example.com")
    case = await _create_case(client, a["token"])

    lr = await _add_fact(client, a["token"], case["id"], "lr", "1e-3",
                         source_type="config", source_ref="configs/cifar.yaml#L12",
                         applicable_experiment="baseline", confidence=0.95)
    assert lr["field_key"] == "learning_rate"
    assert lr["normalized_value"] == "0.001"
    assert lr["raw_field"] == "lr" and lr["raw_value"] == "1e-3"   # 原文保留
    assert lr["category"] == "training_parameter" and lr["is_standard"] is True
    assert lr["source_ref"] == "configs/cifar.yaml#L12" and lr["confidence"] == 0.95

    bs = await _add_fact(client, a["token"], case["id"], "Batch Size", "1,024")
    assert bs["field_key"] == "batch_size" and bs["normalized_value"] == "1024"
    assert bs["unit"] == "samples"

    acc = await _add_fact(client, a["token"], case["id"], "acc", "95.2%",
                          source_type="paper", source_ref="Table 2")
    assert acc["field_key"] == "accuracy" and acc["normalized_value"] == "0.952"
    assert acc["unit"] == "ratio" and acc["category"] == "metric"

    zh = await _add_fact(client, a["token"], case["id"], "学习率", "3×10^-4",
                         applicable_experiment="ablation")
    assert zh["field_key"] == "learning_rate" and zh["normalized_value"] == "0.0003"

    env = await _add_fact(client, a["token"], case["id"], "torch", "2.1.0+cu118")
    assert env["field_key"] == "pytorch_version" and env["normalized_value"] == "2.1.0+cu118"

    custom = await _add_fact(client, a["token"], case["id"], "Custom Metric", "0.42")
    assert custom["field_key"] == "custom_metric" and custom["is_standard"] is False
    assert custom["normalized_value"] == "0.42"      # 未收录字段不丢值

    # 无法归一化的字段名 / 超出列宽的取值：显式 422，不静默截断入库
    for bad in ({"raw_field": "---", "raw_value": "1"},
                {"raw_field": "x" * 100, "raw_value": "1"},
                {"raw_field": "lr", "raw_value": "0.2", "unit": "u" * 41},
                {"raw_field": "lr", "raw_value": "0.2", "source_ref": "s" * 301},
                {"raw_field": "lr", "raw_value": "0.2", "applicable_experiment": "e" * 201}):
        r = await client.post(f"/api/v1/cases/{case['id']}/facts", json=bad,
                              headers=_auth(a["token"]))
        assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR", bad

    r = await client.get(f"/api/v1/cases/{case['id']}/facts", headers=_auth(a["token"]))
    items = r.json()["data"]["items"]
    assert r.json()["data"]["total"] == 6
    assert items[0]["category"] == "training_parameter"   # 按类别排序

    r = await client.get(f"/api/v1/cases/{case['id']}/facts", params={"category": "metric"},
                         headers=_auth(a["token"]))
    assert [f["field_key"] for f in r.json()["data"]["items"]] == ["accuracy"]
    r = await client.get(f"/api/v1/cases/{case['id']}/facts", params={"field_key": "lr"},
                         headers=_auth(a["token"]))
    assert len(r.json()["data"]["items"]) == 2          # 别名查询命中两条 learning_rate

    # 字段目录接口
    r = await client.get("/api/v1/fact-schema", headers=_auth(a["token"]))
    assert r.status_code == 200
    schema = r.json()["data"]
    keys = {f["field_key"] for f in schema["fields"]}
    required = {"learning_rate", "batch_size", "epochs", "optimizer", "weight_decay",
                "random_seed", "python_version", "pytorch_version", "cuda_version", "gpu",
                "operating_system", "dataset_name", "dataset_version", "train_split",
                "validation_split", "test_split", "preprocessing_method", "accuracy",
                "precision", "recall", "f1", "auc", "rmse", "mae"}
    assert required <= keys and schema["total"] >= 24
    assert {c["key"] for c in schema["categories"]} == {
        "training_parameter", "environment", "dataset", "metric"}
    lr_spec = next(f for f in schema["fields"] if f["field_key"] == "learning_rate")
    assert "lr" in lr_spec["aliases"] and lr_spec["value_type"] == "float"
    # 未认证不可读目录
    assert (await client.get("/api/v1/fact-schema")).status_code == 401


# ---------------------------- 可见性隔离 ----------------------------

@pytest.mark.asyncio
async def test_case_visibility_isolation(client):
    a = await _register(client, "iso-a@example.com", "甲方")
    b = await _register(client, "iso-b@example.com", "乙方")
    private = await _create_case(client, a["token"])
    await _add_fact(client, a["token"], private["id"], "lr", "0.01")

    # B 不可见：详情/事实/验证/重算一律 404（隐藏存在性）
    assert (await client.get(f"/api/v1/cases/{private['id']}", headers=_auth(b["token"]))).status_code == 404
    assert (await client.get(f"/api/v1/cases/{private['id']}/facts", headers=_auth(b["token"]))).status_code == 404
    assert (await client.post(f"/api/v1/cases/{private['id']}/facts",
                              json={"raw_field": "lr", "raw_value": "0.5"},
                              headers=_auth(b["token"]))).status_code == 404
    assert (await client.post(f"/api/v1/cases/{private['id']}/verifications",
                              json={"verification_type": "review", "result": "pass"},
                              headers=_auth(b["token"]))).status_code == 404
    assert (await client.post(f"/api/v1/cases/{private['id']}/quality/recompute",
                              headers=_auth(b["token"]))).status_code == 404
    items = (await client.get("/api/v1/cases", headers=_auth(b["token"]))).json()["data"]["items"]
    assert all(c["id"] != private["id"] for c in items)
    found = (await client.post("/api/v1/cases/search", json={"query": "ResNet CIFAR-10"},
                               headers=_auth(b["token"]))).json()["data"]["items"]
    assert all(r["case"]["id"] != private["id"] for r in found)

    # A 自己可见
    assert (await client.get(f"/api/v1/cases/{private['id']}", headers=_auth(a["token"]))).status_code == 200

    # 公共案例对 B 可见，但 B 不能改其事实
    public = await _create_case(client, a["token"], title="公共 CIFAR-10 基准", is_public=True)
    assert (await client.get(f"/api/v1/cases/{public['id']}", headers=_auth(b["token"]))).status_code == 200
    r = await client.post(f"/api/v1/cases/{public['id']}/facts",
                          json={"raw_field": "lr", "raw_value": "0.9"}, headers=_auth(b["token"]))
    assert r.status_code == 403
    # 非 org_admin 不能在他人组织内创建/发布案例
    org_a = await _org_id(client, a["token"])
    member = await _invite_as(client, org_a, a["token"], "iso-member@example.com", "member")
    r = await client.post("/api/v1/cases", json=_payload(is_public=True, org_id=org_a),
                          headers=_auth(member["token"]))
    assert r.status_code == 403
    r = await client.post("/api/v1/cases", json=_payload(org_id=org_a),
                          headers=_auth(member["token"]))
    assert r.status_code == 403
    # 不能把案例挂到不属于自己的组织
    r = await client.post("/api/v1/cases", json=_payload(org_id=org_a), headers=_auth(b["token"]))
    assert r.status_code == 404
    # 组织成员可见本组织私有案例
    assert (await client.get(f"/api/v1/cases/{private['id']}", headers=_auth(member["token"]))).status_code == 200


# ---------------------------- 质量阶梯 ----------------------------

@pytest.mark.asyncio
async def test_quality_progression_four_levels(client):
    a = await _register(client, "quality-a@example.com", "执行人")
    org_a = await _org_id(client, a["token"])
    case = await _create_case(client, a["token"])
    assert case["quality_level"] == "unverified"

    # 1) 人工复核通过 -> partially_verified
    r1 = await _verify(client, a["token"], case["id"], "review", "pass",
                       {"scope": "材料与结论审阅"}, "复核训练配置与指标口径")
    assert r1["quality_level"] == "partially_verified" and r1["changed"] is True
    assert r1["quality_evidence"]["basis"][0]["verification_type"] == "review"

    # 2) 执行复现通过（声明环境）-> execution_verified
    r2 = await _verify(client, a["token"], case["id"], "execution", "pass", _ENV,
                       "在 RTX 3090 上复现，accuracy 0.951")
    assert r2["quality_level"] == "execution_verified"
    assert r2["quality_evidence"]["environment"]["gpu"] == "NVIDIA GeForce RTX 3090"
    assert r2["quality_evidence"]["counts"]["execution_pass_with_environment"] == 1

    # 3) 同一人再复核不构成独立复核
    r3 = await _verify(client, a["token"], case["id"], "review", "pass", {}, "自审")
    assert r3["quality_level"] == "execution_verified"
    assert any("独立" in n for n in r3["quality_evidence"]["notes"])

    # 4) 独立复核人（≠ 执行人且 ≠ 创建者）-> independently_reviewed
    b = await _invite_as(client, org_a, a["token"], "quality-reviewer@example.com", "org_admin")
    r4 = await _verify(client, b["token"], case["id"], "review", "pass",
                       {"scope": "独立复核执行日志与指标"}, "独立复核通过")
    assert r4["quality_level"] == "independently_reviewed"
    assert r4["quality_evidence"]["independent_reviewer_user_id"] == b["user"]["id"]
    assert len(r4["quality_evidence"]["basis"]) == 2

    # 失败验证不降级（append-only），但写入证据提示
    r5 = await _verify(client, b["token"], case["id"], "execution", "fail", _ENV, "换种子后未达标")
    assert r5["quality_level"] == "independently_reviewed"
    assert r5["quality_evidence"]["counts"]["fail"] == 1
    assert any("fail" in n for n in r5["quality_evidence"]["notes"])

    detail = (await client.get(f"/api/v1/cases/{case['id']}", headers=_auth(a["token"]))).json()["data"]
    assert detail["quality_level"] == "independently_reviewed"
    assert detail["quality_label"] == "独立复核"
    assert detail["verification_count"] == 5
    assert detail["quality_evidence"]["level"] == "independently_reviewed"


@pytest.mark.asyncio
async def test_execution_without_environment_stays_partial(client):
    a = await _register(client, "noenv@example.com")
    case = await _create_case(client, a["token"])
    r = await _verify(client, a["token"], case["id"], "execution", "pass",
                      {"accuracy": 0.95}, "跑通但未记录环境")
    assert r["quality_level"] == "partially_verified"
    assert any("环境" in n for n in r["quality_evidence"]["notes"])
    # 补齐环境后升级
    r2 = await _verify(client, a["token"], case["id"], "execution", "pass",
                       {"environment": {"gpu": "A100", "cuda_version": "12.1"}}, "补记环境")
    assert r2["quality_level"] == "execution_verified"
    assert r2["quality_evidence"]["environment"]["gpu"] == "A100"
    # partial 结果不升级
    case2 = await _create_case(client, a["token"], title="部分复现案例")
    r3 = await _verify(client, a["token"], case2["id"], "execution", "partial", _ENV, "仅复现部分指标")
    assert r3["quality_level"] == "unverified"


@pytest.mark.asyncio
async def test_quality_level_cannot_be_set_by_client_or_ai(client):
    a = await _register(client, "noai@example.com")
    # 创建接口拒绝 quality_level
    r = await client.post("/api/v1/cases", json=_payload(quality_level="independently_reviewed"),
                          headers=_auth(a["token"]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    r = await client.post("/api/v1/cases", json=_payload(quality_evidence_json={"level": "execution_verified"}),
                          headers=_auth(a["token"]))
    assert r.status_code == 422
    # 正常创建的案例一律 unverified
    case = await _create_case(client, a["token"])
    assert case["quality_level"] == "unverified"
    # 重算接口不接受目标等级
    r = await client.post(f"/api/v1/cases/{case['id']}/quality/recompute",
                          json={"quality_level": "independently_reviewed"}, headers=_auth(a["token"]))
    assert r.status_code == 422
    # 事实接口同样不接受等级注入
    r = await client.post(f"/api/v1/cases/{case['id']}/facts",
                          json={"raw_field": "lr", "raw_value": "0.1", "quality_level": "execution_verified"},
                          headers=_auth(a["token"]))
    assert r.status_code == 422
    # 服务层直调（AI/内部调用路径）也被拒绝
    from app.models.stage6 import User
    from app.services import benchmark_service as svc
    from sqlalchemy import select
    async with _db() as db:
        user = (await db.execute(select(User).where(User.email == "noai@example.com"))).scalar_one()
        with pytest.raises(AppError) as exc:
            await svc.create_case(db, user, {"title": "AI 直接设等级", "quality_level": "execution_verified"})
        assert exc.value.code == "VALIDATION_ERROR"
        created = await svc.create_case(db, user, {"title": "服务层创建"})
        assert created["quality_level"] == "unverified"
    assert (await client.get(f"/api/v1/cases/{case['id']}", headers=_auth(a["token"]))).json()["data"]["quality_level"] == "unverified"


@pytest.mark.asyncio
async def test_recompute_downgrade_requires_confirmation(client):
    a = await _register(client, "downgrade-a@example.com")
    org_a = await _org_id(client, a["token"])
    case = await _create_case(client, a["token"])
    await _verify(client, a["token"], case["id"], "execution", "pass", _ENV, "执行通过")
    b = await _invite_as(client, org_a, a["token"], "downgrade-b@example.com", "org_admin")
    r = await _verify(client, b["token"], case["id"], "review", "pass", {}, "独立复核")
    assert r["quality_level"] == "independently_reviewed"
    independent_id = r["verification"]["id"]

    # 撤销独立复核记录后重算：默认不降级
    from app.models.stage6 import CaseVerification
    from sqlalchemy import select
    async with _db() as db:
        row = (await db.execute(select(CaseVerification).where(CaseVerification.id == independent_id))).scalar_one()
        await db.delete(row)
        await db.commit()

    r = await client.post(f"/api/v1/cases/{case['id']}/quality/recompute", headers=_auth(a["token"]))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["computed_level"] == "execution_verified"
    assert data["quality_level"] == "independently_reviewed"
    assert data["downgrade_blocked"] is True and data["changed"] is False

    # 人工确认降级后生效
    r = await client.post(f"/api/v1/cases/{case['id']}/quality/recompute",
                          json={"confirm_downgrade": True}, headers=_auth(a["token"]))
    data = r.json()["data"]
    assert data["quality_level"] == "execution_verified" and data["changed"] is True
    assert data["downgrade_blocked"] is False
    # 空 body 重算幂等
    r = await client.post(f"/api/v1/cases/{case['id']}/quality/recompute", headers=_auth(a["token"]))
    assert r.json()["data"]["quality_level"] == "execution_verified"
    assert r.json()["data"]["changed"] is False


# ---------------------------- 验证校验与权限 ----------------------------

@pytest.mark.asyncio
async def test_verification_validation_and_permissions(client):
    a = await _register(client, "verify-a@example.com")
    org_a = await _org_id(client, a["token"])
    case = await _create_case(client, a["token"])
    outsider = await _register(client, "verify-outsider@example.com")
    member = await _invite_as(client, org_a, a["token"], "verify-member@example.com", "member")

    for body in (
        {"verification_type": "simulation", "result": "pass"},
        {"verification_type": "execution", "result": "ok"},
        {"verification_type": "execution", "result": "pass", "conditions_json": "{bad json"},
        {"verification_type": "execution", "result": "pass", "conditions_json": [1, 2]},
    ):
        r = await client.post(f"/api/v1/cases/{case['id']}/verifications", json=body, headers=_auth(a["token"]))
        assert r.status_code == 422, (body, r.text)

    # 组织普通成员（无 finding.review / case.manage）不能提交验证
    r = await client.post(f"/api/v1/cases/{case['id']}/verifications",
                          json={"verification_type": "review", "result": "pass"},
                          headers=_auth(member["token"]))
    assert r.status_code == 403
    # 组织外用户不可见 -> 404
    r = await client.post(f"/api/v1/cases/{case['id']}/verifications",
                          json={"verification_type": "review", "result": "pass"},
                          headers=_auth(outsider["token"]))
    assert r.status_code == 404
    # 字符串形式 conditions_json 也被接受
    r = await client.post(f"/api/v1/cases/{case['id']}/verifications",
                          json={"verification_type": "execution", "result": "pass",
                                "conditions_json": json.dumps(_ENV, ensure_ascii=False)},
                          headers=_auth(a["token"]))
    assert r.status_code == 200
    assert r.json()["data"]["quality_level"] == "execution_verified"
    # 验证清单可读
    r = await client.get(f"/api/v1/cases/{case['id']}/verifications", headers=_auth(a["token"]))
    assert r.json()["data"]["total"] == 1
    assert r.json()["data"]["items"][0]["conditions"]["cuda_version"] == "11.8"


# ---------------------------- 参考检索 ----------------------------

@pytest.mark.asyncio
async def test_search_match_basis_and_visibility(client):
    a = await _register(client, "search-a@example.com")
    b = await _register(client, "search-b@example.com")
    public = await _create_case(client, a["token"], is_public=True)
    private_a = await _create_case(client, a["token"], title="CIFAR-100 上的 ResNet 私有基准",
                                   dataset_name="cifar-100")
    private_b = await _create_case(client, b["token"], title="乙方私有 CIFAR-10 基准")
    await _add_fact(client, a["token"], public["id"], "lr", "0.1")
    await _verify(client, a["token"], public["id"], "execution", "pass", _ENV, "执行通过")

    r = await client.post("/api/v1/cases/search",
                          json={"query": "CIFAR-10 image classification learning rate batch size ResNet",
                                "top_k": 10}, headers=_auth(a["token"]))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["provenance_class"] == "historical_case"
    assert "不得作为当前论文事实" in data["disclaimer"]
    ids = [item["case"]["id"] for item in data["items"]]
    assert public["id"] in ids and private_a["id"] in ids
    assert private_b["id"] not in ids                     # 不可见案例绝不返回
    top = data["items"][0]
    assert top["case"]["id"] == public["id"] and top["score"] > 0
    assert top["provenance_class"] == "historical_case"
    basis = " | ".join(top["match_basis"])
    assert "dataset 相同: CIFAR-10" in basis
    assert "research_task 匹配: image_classification" in basis
    assert "文本相似项" in basis
    assert "质量等级: execution_verified" in basis
    assert top["text_similarity"] > 0

    # B 只能检索到自己的私有案例与 A 的公共案例
    r = await client.post("/api/v1/cases/search", json={"query": "CIFAR-10 ResNet"},
                          headers=_auth(b["token"]))
    ids_b = [item["case"]["id"] for item in r.json()["data"]["items"]]
    assert private_b["id"] in ids_b and public["id"] in ids_b
    assert private_a["id"] not in ids_b

    # 结构化筛选为硬约束
    r = await client.post("/api/v1/cases/search",
                          json={"query": "ResNet", "filters": {"dataset": "CIFAR-100"}},
                          headers=_auth(a["token"]))
    items = r.json()["data"]["items"]
    assert [i["case"]["id"] for i in items] == [private_a["id"]]
    assert any("筛选条件命中" in b for b in items[0]["match_basis"])

    # min_quality 过滤 + 空查询按质量排序
    await _verify(client, a["token"], private_a["id"], "review", "pass", {}, "复核通过")
    r = await client.post("/api/v1/cases/search",
                          json={"query": "", "filters": {"min_quality": "partially_verified"}},
                          headers=_auth(a["token"]))
    items = r.json()["data"]["items"]
    assert {i["case"]["id"] for i in items} == {public["id"], private_a["id"]}
    assert items[0]["case"]["quality_level"] == "execution_verified"
    assert all("未提供查询词" in i["match_basis"][0] for i in items)

    # top_k 生效
    r = await client.post("/api/v1/cases/search", json={"query": "", "top_k": 1},
                          headers=_auth(a["token"]))
    assert len(r.json()["data"]["items"]) == 1
    # min_score 阈值过滤
    r = await client.post("/api/v1/cases/search",
                          json={"query": "CIFAR-10 ResNet", "filters": {"min_score": 0.99}},
                          headers=_auth(a["token"]))
    assert r.json()["data"]["items"] == []
    # 非法 min_quality
    r = await client.post("/api/v1/cases/search",
                          json={"query": "x", "filters": {"min_quality": "verified_by_ai"}},
                          headers=_auth(a["token"]))
    assert r.status_code == 422


# ---------------------------- 留痕 / 冲突 / 追溯 ----------------------------

@pytest.mark.asyncio
async def test_trail_conflict_and_traceability(client):
    a = await _register(client, "trail-b@example.com")
    case = await _create_case(client, a["token"], title="无许可声明的案例",
                              doi="", source_url="", license="", code_repo_url="")
    assert case["traceability"]["complete"] is False
    assert len(case["traceability"]["warnings"]) == 2
    assert case["traceability"]["redistribution"] == "metadata_only"

    fact = await _add_fact(client, a["token"], case["id"], "epochs", "200",
                           source_type="paper", source_ref="Section 4.1")
    assert fact["normalized_value"] == "200" and fact["unit"] == "epoch"
    # 完全相同的事实 -> 409
    r = await client.post(f"/api/v1/cases/{case['id']}/facts",
                          json={"raw_field": "epoch", "raw_value": "200",
                                "source_type": "paper", "source_ref": "Section 4.1"},
                          headers=_auth(a["token"]))
    assert r.status_code == 409 and r.json()["error"]["code"] == "CONFLICT"
    # 不同适用实验可共存
    await _add_fact(client, a["token"], case["id"], "epochs", "200",
                    source_type="paper", source_ref="Section 4.1", applicable_experiment="long-run")
    # 非法 confidence / source_type
    r = await client.post(f"/api/v1/cases/{case['id']}/facts",
                          json={"raw_field": "lr", "raw_value": "0.1", "confidence": 1.5},
                          headers=_auth(a["token"]))
    assert r.status_code == 422
    r = await client.post(f"/api/v1/cases/{case['id']}/facts",
                          json={"raw_field": "lr", "raw_value": "0.1", "source_type": "guess"},
                          headers=_auth(a["token"]))
    assert r.status_code == 422
    await _verify(client, a["token"], case["id"], "review", "pass", {}, "复核")

    detail = (await client.get(f"/api/v1/cases/{case['id']}", headers=_auth(a["token"]))).json()["data"]
    assert detail["version"] == 3 and detail["fact_count"] == 2

    from app.models.stage6 import AuditTrail
    from sqlalchemy import select
    async with _db() as db:
        rows = (await db.execute(select(AuditTrail).where(AuditTrail.target_id == case["id"]))).scalars().all()
        actions = {r.action for r in rows}
        assert {"case.create", "case.quality_change"} <= actions
        change = next(r for r in rows if r.action == "case.quality_change")
        assert json.loads(change.before_json)["quality_level"] == "unverified"
        assert json.loads(change.after_json)["quality_level"] == "partially_verified"
        fact_rows = (await db.execute(select(AuditTrail).where(AuditTrail.action == "case.fact_add"))).scalars().all()
        assert len(fact_rows) == 2
        assert all(r.actor_user_id == a["user"]["id"] and r.request_id for r in fact_rows)


# ---------------------------- 纯函数单测（确定性） ----------------------------

def _v(vid, vtype, result, verifier, conditions=None, created="2026-01-01T00:00:00+00:00"):
    return {"id": vid, "verification_type": vtype, "result": result,
            "verifier_user_id": verifier, "conditions": conditions or {},
            "created_at": created, "notes": ""}


@pytest.mark.asyncio
async def test_evaluate_quality_deterministic_and_order_independent():
    from app.services import benchmark_service as svc
    creator = "user-a"
    exec_v = _v("cv-1", "execution", "pass", "user-a", _ENV, "2026-01-02T00:00:00+00:00")
    self_review = _v("cv-2", "review", "pass", "user-a", {}, "2026-01-03T00:00:00+00:00")
    indep_review = _v("cv-3", "review", "pass", "user-b", {}, "2026-01-04T00:00:00+00:00")
    fail_v = _v("cv-4", "execution", "fail", "user-c", _ENV, "2026-01-05T00:00:00+00:00")
    partial_v = _v("cv-5", "review", "partial", "user-b", {}, "2026-01-06T00:00:00+00:00")

    assert svc.evaluate_quality(creator, [])[0] == "unverified"
    assert svc.evaluate_quality(creator, [fail_v, partial_v])[0] == "unverified"
    assert svc.evaluate_quality(creator, [self_review])[0] == "partially_verified"
    assert svc.evaluate_quality(creator, [exec_v])[0] == "execution_verified"
    assert svc.evaluate_quality(creator, [exec_v, self_review])[0] == "execution_verified"
    assert svc.evaluate_quality(creator, [exec_v, indep_review])[0] == "independently_reviewed"
    # 创建者本人复核不算独立，即使与执行人不同
    assert svc.evaluate_quality("user-b", [exec_v, indep_review])[0] == "execution_verified"
    # 无环境的执行通过只到部分验证
    assert svc.evaluate_quality(creator, [_v("cv-6", "execution", "pass", "user-a", {})])[0] == "partially_verified"

    # 顺序无关 + 重复调用结果一致（除时间戳）
    rows = [exec_v, indep_review, fail_v, partial_v, self_review]
    level_a, ev_a = svc.evaluate_quality(creator, rows)
    level_b, ev_b = svc.evaluate_quality(creator, list(reversed(rows)))
    assert level_a == level_b == "independently_reviewed"
    assert [b["verification_id"] for b in ev_a["basis"]] == [b["verification_id"] for b in ev_b["basis"]]
    assert ev_a["counts"] == ev_b["counts"]
    assert ev_a["environment"]["cuda_version"] == "11.8"
    # 环境判定：空/无关条件不算环境
    assert svc.has_environment_conditions({}) is False
    assert svc.has_environment_conditions({"accuracy": 0.95}) is False
    assert svc.has_environment_conditions({"gpu": ""}) is False
    assert svc.has_environment_conditions({"env": {"os": "Ubuntu 22.04"}}) is True
    assert svc.has_environment_conditions({"code_commit": "abc123"}) is True


@pytest.mark.asyncio
async def test_normalize_value_edge_cases():
    from app.services.fact_schema import normalize_field, normalize_value
    # 别名与大小写/连字符/括注
    assert normalize_field("LR") == "learning_rate"
    assert normalize_field(" learning-rate ") == "learning_rate"
    assert normalize_field("训练轮数") == "epochs"
    assert normalize_field("F1 (macro)") == "f1"
    assert normalize_field("Accuracy %") == "accuracy"
    assert normalize_field(" totally_new_field ") == "totally_new_field"
    assert normalize_field("") == ""
    # 比例：百分数折算，0~1 原样，超范围不静默裁剪
    assert normalize_value("accuracy", "95.2%") == ("0.952", "ratio")
    assert normalize_value("accuracy", "0.952") == ("0.952", "ratio")
    assert normalize_value("f1", "87.5") == ("0.875", "ratio")
    assert normalize_value("accuracy", "120") == ("120", "ratio")
    assert normalize_value("rmse", "95.2") == ("95.2", "")     # 非比例字段不折算
    # 数值解析：科学计数法、千分位、单位后缀、无法解析时保留原文
    assert normalize_value("learning_rate", "1E-4") == ("0.0001", "")
    assert normalize_value("batch_size", "1,024") == ("1024", "samples")
    assert normalize_value("epochs", "100.0") == ("100", "epoch")
    assert normalize_value("training_time", "90 min") == ("1.5", "hours")
    assert normalize_value("parameter_count", "25.6M") == ("25600000", "params")
    assert normalize_value("learning_rate", "cosine annealing") == ("cosine annealing", "")
    assert normalize_value("batch_size", "128 per GPU") == ("128 per GPU", "samples")
    assert normalize_value("learning_rate", None) == ("", "")
    assert normalize_value("mixed_precision", True) == ("fp16", "")
    # 名称/版本归一化
    assert normalize_value("dataset_name", "cifar_10") == ("CIFAR-10", "")
    assert normalize_value("dataset_name", "自建工业缺陷数据集") == ("自建工业缺陷数据集", "")
    assert normalize_value("operating_system", "ubuntu 22.04") == ("Ubuntu 22.04", "")
    assert normalize_value("python_version", "Python 3.11.5") == ("3.11.5", "")
    assert normalize_value("optimizer", "adamw") == ("AdamW", "")
    assert normalize_value("totally_new_field", "  保留 原文  ") == ("保留 原文", "")