"""独立验证引擎第2层（静态分析）+ 第4层（数值重算）与分层 API 测试。"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from app.services.numeric_recompute_service import (
    LAYER_SPECS,
    compare_recomputed,
    recompute_accuracy,
    recompute_f1,
    recompute_from_counts,
    verify_layer_panel,
)
from app.services.static_analysis_service import analyze_project_code, analyze_python_source


SAMPLE_SOURCE = """import torch
import torch.nn as nn
from sklearn.model_selection import train_test_split

class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc = nn.Linear(4, 2)

    def forward(self, x):
        return self.fc(x)

def train(x, y):
    torch.manual_seed(42)
    x_train, x_val, y_train, y_val = train_test_split(x, y, test_size=0.2)
    optimizer = torch.optim.Adam(Net().parameters(), lr=0.001)
    return optimizer
"""

TRAIN_NO_SPLIT_SOURCE = """import torch.nn as nn

class Net(nn.Module):
    pass

def train(model):
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    return optimizer
"""


def test_analyze_python_source_extracts_real_ast_evidence():
    r = analyze_python_source(SAMPLE_SOURCE)
    assert r["valid"] is True
    assert r["method"] == "ast_static"
    assert "torch" in r["imports"]
    assert "torch.nn" in r["imports"]
    assert "sklearn.model_selection" in r["imports"]
    assert "Net" in r["model_classes"]
    assert len(r["train_test_split_calls"]) == 1
    split = r["train_test_split_calls"][0]
    assert split["name"].endswith("train_test_split")
    assert split["function"] == "train"
    assert split["line"] > 0
    assert len(r["random_seed_settings"]) == 1
    seed = r["random_seed_settings"][0]
    assert seed["name"] == "torch.manual_seed"
    assert seed["value"] == 42
    assert len(r["optimizer_and_lr"]) == 1
    optimizer = r["optimizer_and_lr"][0]
    assert optimizer["name"].endswith("Adam")
    assert optimizer["lr"] == 0.001
    assert optimizer["variable"] == "optimizer"
    assert {"__init__", "forward", "train"}.issubset(set(r["function_defs"]))
    assert r["finding_count"] == len(r["findings"])
    assert r["finding_count"] > 0


def test_analyze_python_source_syntax_error_never_raises():
    r = analyze_python_source("def broken(:\n    pass")
    assert r["valid"] is False
    assert "语法错误" in r["error"]
    assert r["findings"] == []
    assert r["finding_count"] == 0
    assert r["imports"] == []
    assert r["method"] == "ast_static"


def test_analyze_project_code_warns_when_training_without_split_or_seed():
    r = analyze_project_code({"train.py": TRAIN_NO_SPLIT_SOURCE})
    assert r["files_analyzed"] == 1
    assert r["syntax_errors"] == []
    assert r["warnings"]
    assert any("train_test_split" in w for w in r["warnings"])
    assert any("随机种子" in w for w in r["warnings"])
    assert "观察" in r["warnings"][0]
    # 完整样本含 split 与 seed 时不应再给出缺失提示
    assert analyze_project_code({"train.py": SAMPLE_SOURCE})["warnings"] == []


def test_analyze_project_code_aggregates_files_and_records_syntax_errors():
    r = analyze_project_code({
        "train.py": SAMPLE_SOURCE,
        "broken.py": "class Bad(:\n    pass",
    })
    assert r["files_analyzed"] == 2
    assert r["valid_files"] == 1
    assert r["syntax_errors"][0]["file"] == "broken.py"
    assert "torch" in r["combined"]["imports"]
    assert "Net" in r["combined"]["model_classes"]
    assert r["combined"]["train_test_split_calls"][0]["file"] == "train.py"
    assert r["combined"]["random_seed_settings"][0]["value"] == 42
    assert r["combined"]["optimizer_and_lr"][0]["lr"] == 0.001
    assert r["method"] == "ast_static_project"


def test_recompute_f1_standard_values():
    r = recompute_f1(8, 2, 2)
    assert r["precision"] == 0.8
    assert r["recall"] == 0.8
    assert r["f1"] == 0.8
    assert r["value"] == 0.8
    assert r["denominator_zero"] is False
    assert r["method"] == "numeric_recompute"


def test_recompute_f1_all_zero_denominators_returns_zero_with_note():
    r = recompute_f1(0, 0, 0)
    assert r["precision"] == r["recall"] == r["f1"] == 0.0
    assert r["denominator_zero"] is True
    assert "分母为 0" in r["note"]
    assert len(r["notes"]) >= 1


def test_recompute_accuracy_correct_and_zero_total():
    ok_result = recompute_accuracy(8, 10)
    assert ok_result["accuracy"] == 0.8
    assert ok_result["value"] == 0.8
    assert ok_result["denominator_zero"] is False
    zero = recompute_accuracy(0, 0)
    assert zero["accuracy"] == 0.0
    assert zero["denominator_zero"] is True
    assert "total<=0" in zero["note"]


def test_recompute_from_counts_supported_and_unknown_metrics():
    f1 = recompute_from_counts("f1", {"tp": 8, "fp": 2, "fn": 2})
    assert f1["supported"] is True
    assert f1["metric"] == "f1"
    assert f1["value"] == 0.8
    acc = recompute_from_counts("accuracy", {"correct": 9, "total": 10})
    assert acc["value"] == 0.9
    unknown = recompute_from_counts("bleu", {"tp": 8, "fp": 2, "fn": 2})
    assert unknown["supported"] is False
    assert unknown["value"] is None
    assert "不支持" in unknown["note"]
    missing = recompute_from_counts("recall", {"tp": 8})
    assert missing["supported"] is False


def test_compare_recomputed_consistent_and_inconsistent():
    recomputed = recompute_f1(8, 2, 2)
    same = compare_recomputed(recomputed, 0.805, tolerance=0.01)
    assert same["verdict"] == "consistent"
    assert same["method"] == "numeric_recompute"
    assert same["recomputed"] == 0.8
    assert same["abs_diff"] is not None and same["abs_diff"] <= 0.01
    diff = compare_recomputed(recomputed, 0.5, tolerance=0.01)
    assert diff["verdict"] == "inconsistent"
    assert diff["abs_diff"] > 0.01


def test_compare_recomputed_insufficient_data_on_zero_denominator():
    recomputed = recompute_f1(0, 0, 0)
    result = compare_recomputed(recomputed, 0.0)
    assert result["verdict"] == "insufficient_data"
    assert "分母为 0" in result["note"]
    assert compare_recomputed({"supported": False}, 0.8)["verdict"] == "insufficient_data"


def test_verify_layer_panel_marks_dynamic_execution_not_executed():
    outputs = [
        {"layer": 1, "method": "deterministic_rule_v1", "basis": "日志规则", "confidence": 0.7},
        {"layer": 2, "method": "ast_static", "basis": "AST 解析", "confidence": 0.85},
        {"layer": 4, "method": "numeric_recompute", "basis": "TP/FP/FN 重算", "confidence": 0.95},
        {"layer": 5, "method": "ai_assisted", "basis": "解释已验证证据", "confidence": 0.4},
    ]
    panel = verify_layer_panel(outputs)
    assert panel["total"] == 5
    assert [item["layer"] for item in panel["layers"]] == [1, 2, 3, 4, 5]
    layer3 = panel["layers"][2]
    assert layer3["executed"] is False
    assert "隔离执行环境未启用" in layer3["note"]
    assert layer3["confidence"] == 0.0
    assert all(item["executed"] for item in panel["layers"] if item["layer"] != 3)
    assert all({"layer", "method", "basis", "executed", "confidence", "note"}.issubset(item)
               for item in panel["layers"])
    assert panel["executed_count"] == 4


def test_layer_specs_declare_layer3_off_by_default():
    assert len(LAYER_SPECS) == 5
    layer3 = next(spec for spec in LAYER_SPECS if spec["layer"] == 3)
    assert layer3["executed_by_default"] is False
    assert "隔离执行环境未启用" in layer3["note"]
    assert all({"layer", "method", "boundary", "executed_by_default"}.issubset(spec)
               for spec in LAYER_SPECS)


@pytest_asyncio.fixture
async def api_client(client):
    """仅在全局尚未注册路由时临时挂载，避免与 api/__init__.py 的统一注册冲突。"""
    from app.main import app
    from app.api.v1.verification_layers import router

    target = "/api/v1/verification/static-analysis"
    if any(getattr(route, "path", "") == target for route in app.router.routes):
        yield client
        return
    snapshot = list(app.router.routes)
    app.include_router(router, prefix="/api/v1")
    try:
        yield client
    finally:
        app.router.routes[:] = snapshot


async def _auth_headers(client, tag: str) -> dict[str, str]:
    reg = await client.post("/api/v1/auth/register", json={
        "email": f"verify-{tag}-{uuid.uuid4().hex[:8]}@example.com",
        "password": "password123",
        "display_name": "验证层测试用户",
    })
    assert reg.status_code == 200, reg.text
    return {"Authorization": f"Bearer {reg.json()['data']['token']}"}


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path,payload", [
    ("post", "/api/v1/verification/static-analysis", {"sources": {"a.py": "x=1"}}),
    ("post", "/api/v1/verification/recompute", {"metric": "f1", "counts": {"tp": 1, "fp": 0, "fn": 0}}),
    ("get", "/api/v1/verification/layers", None),
])
async def test_verification_endpoints_require_auth(api_client, method, path, payload):
    if method == "get":
        r = await api_client.get(path)
    else:
        r = await api_client.post(path, json=payload)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_static_analysis_api_returns_real_ast_result(api_client):
    headers = await _auth_headers(api_client, "static")
    r = await api_client.post("/api/v1/verification/static-analysis",
                              json={"sources": {"train.py": SAMPLE_SOURCE}}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["success"] is True
    data = r.json()["data"]
    assert data["files_analyzed"] == 1
    assert data["syntax_errors"] == []
    assert "Net" in data["combined"]["model_classes"]
    assert data["combined"]["train_test_split_calls"][0]["file"] == "train.py"
    assert data["combined"]["optimizer_and_lr"][0]["lr"] == 0.001


@pytest.mark.asyncio
async def test_recompute_api_returns_verdict(api_client):
    headers = await _auth_headers(api_client, "recompute")
    r = await api_client.post("/api/v1/verification/recompute", json={
        "metric": "f1",
        "counts": {"tp": 8, "fp": 2, "fn": 2},
        "reported_value": 0.805,
        "tolerance": 0.01,
    }, headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["verdict"] == "consistent"
    assert data["recomputed"] == 0.8
    assert data["reported"] == 0.805
    assert data["method"] == "numeric_recompute"


@pytest.mark.asyncio
async def test_layers_api_documents_default_off_dynamic_execution(api_client):
    headers = await _auth_headers(api_client, "layers")
    r = await api_client.get("/api/v1/verification/layers", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["total"] == 5
    third = next(item for item in data["layers"] if item["layer"] == 3)
    assert third["executed_by_default"] is False
    assert "隔离执行环境未启用" in data["note"]
