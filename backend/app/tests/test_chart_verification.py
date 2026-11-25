"""第六阶段 Wave E：论文图表反向验证（纯函数 + 真实 client + JWT）。"""
from __future__ import annotations

from contextlib import asynccontextmanager

import pytest

from app.services.chart_verification_service import (
    extract_captions,
    extract_table_claims,
    find_plot_logic,
    find_result_files,
    verify_bundle,
    verify_figure,
)


# 纯函数：真实文本提取

def test_extract_table_claims_from_real_text():
    chunks = [
        "普通段落没有指标数值。",
        "ResNet-50 76.1 91.2\naccuracy 0.912\nno metric here",
    ]
    locators = [{}, {"page_index": 3, "chunk_id": "chunk-paper-2"}]
    claims = extract_table_claims(chunks, locators)

    values = [value for claim in claims for value in claim["values"]]
    assert 76.1 in values
    assert 91.2 in values
    assert 0.912 in values
    resnet = next(claim for claim in claims if claim["metric_name"] == "resnet-50")
    assert resnet["values"] == [76.1, 91.2]
    assert resnet["source_locator"]["page_index"] == 3
    assert all(claim["extraction_method"] == "text_regex" for claim in claims)


def test_extract_table_claims_pipe_row_and_empty_input():
    claims = extract_table_claims(["Model | 76.1 | 91.2"], [{"page_index": 5}])
    assert len(claims) == 1
    assert claims[0]["values"] == [76.1, 91.2]
    assert claims[0]["confidence"] > 0
    assert extract_table_claims(["无数值的普通句子", ""], []) == []


def test_extract_captions_figure_and_chinese_table():
    chunks = ["正文段落\nFigure 1: Accuracy comparison\n其他内容\n表 2 不同方法的准确率"]
    captions = extract_captions(chunks, [{"page_index": 7}])

    assert len(captions) == 2
    assert captions[0]["kind"] == "figure"
    assert captions[0]["number"] == 1
    assert captions[0]["text"] == "Accuracy comparison"
    assert captions[0]["source_locator"]["page_index"] == 7
    assert captions[1]["kind"] == "table" and captions[1]["number"] == 2


# 纯函数：AST 绘图逻辑

def test_find_plot_logic_detects_matplotlib_plot():
    code = (
        "import matplotlib.pyplot as plt\n"
        "plt.figure(figsize=(6, 4))\n"
        "plt.plot([1, 2], [3, 4])\n"
    )
    calls = find_plot_logic(code)

    plot = next(call for call in calls if call["symbol"] == "plt.plot")
    assert plot["line"] == 3
    assert "plt.plot" in plot["evidence_line"]
    assert plot["method"] == "ast"
    assert "plt.plot" in plot["call"]


def test_find_plot_logic_detects_plotly_and_handles_bad_code():
    calls = find_plot_logic(
        "import plotly.express as px\nfig = px.bar(x=[1, 2], y=[3, 4])\n"
    )
    assert any(call["symbol"] == "px.bar" for call in calls)
    assert find_plot_logic("def broken(:\n  plt.plot(1, 2)") == []
    assert find_plot_logic("print('no plot here')") == []


# 纯函数：结果数值与判定

def test_find_result_files_from_csv_json_and_log():
    found = find_result_files({
        "results.csv": "model,accuracy,f1\nresnet,0.912,0.88\n",
        "metrics.json": '{"accuracy": 0.923, "loss": 0.12}',
        "train.log": "epoch 10 accuracy=0.901 loss: 0.23",
    })
    pairs = {(item["file_name"], item["metric"]): item["value"] for item in found}
    assert pairs[("results.csv", "accuracy")] == 0.912
    assert pairs[("results.csv", "f1")] == 0.88
    assert pairs[("metrics.json", "accuracy")] == 0.923
    assert pairs[("metrics.json", "loss")] == 0.12
    assert pairs[("train.log", "accuracy")] == 0.901
    assert all(item["source"] for item in found)


def test_verify_figure_without_result_data_is_insufficient():
    claim = {"claim_id": "claim-1", "metric_name": "accuracy", "values": [0.912]}
    result = verify_figure(claim, [], [])

    assert result["verdict"] == "insufficient_data"
    assert "未完成精确复核" in result["note"]
    assert "缺少原始数据" in result["note"]
    assert result["diff"] is None
    assert result["evidence_missing"]


def test_verify_figure_supported_and_conflicting():
    claim = {"claim_id": "claim-1", "metric_name": "accuracy", "values": [0.912]}
    calls = [{"symbol": "plt.plot", "line": 3}]

    supported = verify_figure(claim, calls, [{"metric": "accuracy", "value": 0.912}])
    assert supported["verdict"] == "supported"
    assert supported["diff"] == 0.0
    assert supported["evidence_missing"] == []

    conflicting = verify_figure(claim, calls, [{"metric": "accuracy", "value": 0.700}])
    assert conflicting["verdict"] == "conflicting"
    assert conflicting["diff"] > 0.1
    assert conflicting["paper_values"] == [0.912]
    assert conflicting["result_values"] == [0.700]


def test_verify_figure_does_not_match_different_metric_values():
    """回归：论文 accuracy 不得因结果文件里另一个指标的相同数值被误判为 supported。"""
    claim = {"claim_id": "claim-1", "metric_name": "accuracy", "values": [0.912]}
    calls = [{"symbol": "plt.plot", "line": 3}]
    # 结果里只有 loss=0.912（数值恰好相同，但指标不同）
    result = verify_figure(claim, calls, [
        {"metric": "loss", "value": 0.912, "source": "metrics.json#loss"}])
    assert result["verdict"] == "insufficient_data"
    assert any("同名数值" in x for x in result["evidence_missing"])
    assert "未完成精确复核" in result["note"]
    # 有同指标时恢复正常判定
    ok_result = verify_figure(claim, calls, [
        {"metric": "loss", "value": 0.912, "source": "metrics.json#loss"},
        {"metric": "accuracy", "value": 0.912, "source": "metrics.json#accuracy"}])
    assert ok_result["verdict"] == "supported"
    assert any("accuracy" in s for s in ok_result["result_sources"])


def test_verify_bundle_end_to_end():
    bundle = verify_bundle(
        ["Figure 1: Accuracy comparison\nResNet-50 76.1 91.2\naccuracy 0.912"],
        [{"page_index": 1}],
        {"plot.py": "import matplotlib.pyplot as plt\nplt.plot([1, 2], [3, 4])"},
        {"results.csv": "model,accuracy\nresnet,0.912\n"},
    )

    assert bundle["summary"]["total_claims"] == 2
    assert bundle["summary"]["supported"] >= 1
    assert bundle["captions"][0]["number"] == 1
    assert any(call["symbol"] == "plt.plot" for call in bundle["plot_logic"])
    assert any(item["value"] == 0.912 for item in bundle["result_files"])
    assert len(bundle["verifications"]) == 2
    assert any("未做图像级/OCR级重绘对比" in item for item in bundle["limitations"])


# 真实 client + JWT 的 API 测试

def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@asynccontextmanager
async def _session():
    """复用 client 的 get_db override，确保与 HTTP 请求看到同一个内存库。"""
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


async def _register(client, email: str) -> dict:
    response = await client.post("/api/v1/auth/register", json={
        "email": email, "password": "password123", "display_name": "图表验证用户",
    })
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _create_project(client, headers: dict, name: str) -> str:
    response = await client.post("/api/v1/projects", json={"name": name}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


@pytest.mark.asyncio
async def test_api_chart_verification_returns_real_extraction(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    owner = await _register(client, "chart-verify@example.com")
    headers = _auth(owner["token"])
    project_id = await _create_project(client, headers, "图表反向验证项目")

    from app.models import Material, SourceChunk

    async with _session() as db:
        paper = Material(
            id="mat-chart-paper", project_id=project_id,
            source_name="paper.pdf", material_type="pdf", raw_text="",
        )
        code = Material(
            id="mat-chart-code", project_id=project_id,
            source_name="plot.py", material_type="python",
            raw_text="import matplotlib.pyplot as plt\nplt.plot([1, 2], [3, 4])",
        )
        result = Material(
            id="mat-chart-result", project_id=project_id,
            source_name="results.csv", material_type="csv",
            raw_text="model,accuracy\nresnet,0.912\n",
        )
        db.add_all([paper, code, result])
        await db.flush()
        db.add(SourceChunk(
            material_id=paper.id, project_id=project_id,
            chunk_id="chunk-paper-1", chunk_index=0,
            original_text="Figure 1: Accuracy comparison\nResNet-50 76.1 91.2\naccuracy 0.912",
            source_locator_json='{"page_index": 0, "viewer_page_number": 1}',
        ))
        await db.commit()

    response = await client.post(
        f"/api/v1/projects/{project_id}/chart-verification", headers=headers)
    assert response.status_code == 200, response.text
    data = response.json()["data"]

    assert data["summary"]["total_claims"] == 2
    assert data["summary"]["supported"] >= 1
    assert data["captions"][0]["text"] == "Accuracy comparison"
    assert data["table_claims"][0]["source_locator"]["page_index"] == 0
    assert any(call["symbol"] == "plt.plot" for call in data["plot_logic"])
    assert any(item["value"] == 0.912 for item in data["result_files"])
    assert response.json()["success"] is True


@pytest.mark.asyncio
async def test_api_code_and_csv_chunks_are_not_paper_claims(client, monkeypatch):
    """回归：代码/CSV chunk 的数值不得被误当论文表格主张（独立验收 P2-1）。"""
    from app.core.config import settings
    from app.models import Material, SourceChunk

    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    owner = await _register(client, "chart-source@example.com")
    headers = _auth(owner["token"])
    project_id = await _create_project(client, headers, "来源隔离项目")

    async with _session() as db:
        paper = Material(id="src-paper", project_id=project_id, source_name="paper.pdf",
                         material_type="pdf", raw_text="")
        code = Material(id="src-code", project_id=project_id, source_name="plot.py",
                        material_type="python", raw_text="")
        result = Material(id="src-csv", project_id=project_id, source_name="r.csv",
                          material_type="csv", raw_text="")
        db.add_all([paper, code, result])
        await db.flush()
        db.add_all([
            SourceChunk(material_id=paper.id, project_id=project_id, chunk_id="c-paper",
                        chunk_index=0, original_text="Table 1: accuracy 0.912",
                        source_locator_json='{"page_index": 2}'),
            SourceChunk(material_id=code.id, project_id=project_id, chunk_id="c-code",
                        chunk_index=0, original_text="plt.plot([1,2,3],[0.7,0.8,0.9])"),
            SourceChunk(material_id=result.id, project_id=project_id, chunk_id="c-csv",
                        chunk_index=0, original_text="accuracy=0.912"),
        ])
        await db.commit()

    response = await client.post(
        f"/api/v1/projects/{project_id}/chart-verification", headers=headers)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    # 只有论文 chunk 产出 claim；代码数组与 CSV 数值不进 table_claims
    assert data["summary"]["total_claims"] <= 2
    all_values = [v for c in data["table_claims"] for v in c.get("values", [])]
    assert 1 not in all_values and 2 not in all_values and 3 not in all_values
    # 结果数值仍作为对照证词被提取
    assert any(item["value"] == 0.912 for item in data["result_files"])


@pytest.mark.asyncio
async def test_api_chart_verification_empty_project(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    owner = await _register(client, "chart-empty@example.com")
    headers = _auth(owner["token"])
    project_id = await _create_project(client, headers, "空图表验证项目")

    response = await client.post(
        f"/api/v1/projects/{project_id}/chart-verification", headers=headers)
    assert response.status_code == 200, response.text
    data = response.json()["data"]

    for key in ("captions", "table_claims", "plot_logic", "result_files", "verifications"):
        assert data[key] == []
    assert data["summary"] == {
        "total_claims": 0, "supported": 0, "conflicting": 0, "insufficient_data": 0,
    }


@pytest.mark.asyncio
async def test_api_chart_verification_requires_auth(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    response = await client.post(
        "/api/v1/projects/project-without-token/chart-verification")
    assert response.status_code == 401, response.text
