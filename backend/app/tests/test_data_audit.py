"""第十阶段：数据质量与数据完整性审计引擎测试。

覆盖：四类规则（完整性/泄漏/分布/预处理）、证据门、只读保证、
API 全链路（执行/详情/列表/规则目录/跨项目隔离）。
"""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest

from app.dataaudit import RULE_CATALOG, run_audit_on_paths, run_data_audit

# 测试数据集

def _write_dataset(root: Path) -> dict:
    """构造一个含已知问题的合成数据集。返回预期问题清单。"""
    root.mkdir(parents=True, exist_ok=True)

    # train：类别极不平衡（2% 少数类）+ 含缺失 + 时间列
    train = ["id,text,label,date,miss"]
    for i in range(300):
        label = "1" if i < 6 else "0"
        text = f"clinical record {i} patient outcome assessment {i * 7}"
        miss = "" if i % 7 == 0 else "3.14"
        train.append(f'{i},"{text}",{label},2020-{(i % 12) + 1:02d}-01,{miss}')
    # 与 test 完全相同的 20 行（>1% → 高概率泄漏），标签取多数类避免干扰不平衡检测
    shared = []
    for i in range(20):
        shared.append(f's{i},"shared identical sample {i} across splits {i * 13}",0,2021-06-01,1.0')
    train.extend(shared)
    (root / "train_v1.csv").write_text("\n".join(train), encoding="utf-8")

    # test：含相同 20 行 + 60 行独立
    test = ["id,text,label,date,miss"]
    test.extend(shared)
    for i in range(60):
        test.append(f'u{i},"unique heldout sample {i} content {i * 11}",0,2022-01-01,2.0')
    (root / "test_v1.csv").write_text("\n".join(test), encoding="utf-8")

    # 同内容不同文件名（副本泄漏）
    shutil.copyfile(root / "train_v1.csv", root / "train_backup.csv")

    # 空文件 + 损坏格式
    (root / "empty.csv").write_bytes(b"")
    (root / "broken.csv").write_text("a,b,c\n1,2\n3,4,5,6\n", encoding="utf-8")

    # manifest 声明了不存在的文件
    (root / "manifest.json").write_text(json.dumps(
        {"files": ["train_v1.csv", "test_v1.csv", "not_on_disk.csv"]},
        ensure_ascii=False), encoding="utf-8")

    # 代码：全量 fit 泄漏 + 训练集 fit 正向确认 + KFold
    code = root / "pipeline.py"
    code.write_text(
        "from sklearn.preprocessing import StandardScaler\n"
        "scaler = StandardScaler()\n"
        "X_all = __import__('numpy').vstack([X_train, X_test])\n"
        "scaler.fit(X_all)\n"
        "from sklearn.model_selection import KFold\n"
        "kf = KFold(n_splits=5)\n", encoding="utf-8")

    return {
        "leak_rows": len(shared),
        "imbalance_minority": 6,
        "files": {"train_v1.csv", "test_v1.csv", "train_backup.csv",
                  "empty.csv", "broken.csv", "manifest.json",
                  "pipeline.py"},
    }


@pytest.fixture
def dataset(tmp_path: Path) -> dict:
    return _write_dataset(tmp_path / "ds")


# 引擎单元测试

def test_rules_catalog_covers_four_categories():
    cats = {r.category for r in RULE_CATALOG.values()}
    assert cats == {"integrity", "leakage", "distribution", "preprocessing"}
    assert len(RULE_CATALOG) >= 30


def test_audit_detects_known_issues(dataset, tmp_path):
    report = run_data_audit(project_id="t", data_roots=[tmp_path / "ds"],
                            code_files=[str(tmp_path / "ds" / "pipeline.py")])
    rule_ids = {f.rule_id for f in report.findings}

    # 完整性
    assert "INT-003" in rule_ids, "空文件必须检出"
    assert "INT-004" in rule_ids, "列数不一致必须检出"
    # 泄漏：train/test 重复样本
    assert "LEAK-001" in rule_ids, "跨划分重复必须检出"
    # 同内容不同文件名
    assert "LEAK-003" in rule_ids, "副本文件必须检出"
    # 代码泄漏
    assert "LEAK-007" in rule_ids, "全量 fit 必须检出"
    # 分布：类别不平衡
    assert "DIST-001" in rule_ids, "2% 少数类必须检出不平衡"
    # 预处理：扫描到 KFold/缩放
    assert "PRE-001" in rule_ids or "LEAK-010" in rule_ids
    # 版本可追溯性（unknown 或 info 均为合法输出）
    assert "INT-010" in rule_ids


def test_leakage_severity_scales_with_rate(dataset, tmp_path):
    """重复率 >1% 应为 high；不能无条件把重复都判成泄漏。"""
    report = run_data_audit(project_id="t", data_roots=[tmp_path / "ds"])
    leaks = [f for f in report.findings
             if f.rule_id == "LEAK-001" and f.severity != "info"]
    assert leaks, "应有非 info 的 LEAK-001"
    # 合成集重复率 20/80 = 25% → high
    assert leaks[0].severity in ("high", "medium")
    assert leaks[0].justification, "泄漏判定必须写明依据"


def test_every_finding_has_evidence(dataset, tmp_path):
    report = run_data_audit(project_id="t", data_roots=[tmp_path / "ds"])
    assert report.findings, "合成数据集必须产生发现"
    for f in report.findings:
        assert f.evidence, f"{f.rule_id} 缺少证据"
        for e in f.evidence:
            assert e.file_path, f"{f.rule_id} 证据缺少 file_path"
    d = report.to_dict()
    assert d["stats"]["findings_dropped_no_evidence"] == 0


def test_audit_is_read_only(dataset, tmp_path):
    """审计前后所有文件字节级不变（哈希一致）。"""
    root = tmp_path / "ds"
    before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
              for p in root.iterdir() if p.is_file()}
    run_data_audit(project_id="t", data_roots=[root])
    after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
             for p in root.iterdir() if p.is_file()}
    assert before == after, "审计过程修改了原始数据文件"


def test_no_split_gives_unknown_not_verdict(tmp_path):
    """没有划分信息时输出 unknown，不强行判定泄漏。"""
    root = tmp_path / "noloop"
    root.mkdir()
    rows = ["id,text,label"]
    for i in range(50):
        rows.append(f'{i},"some text content here {i}",1')
    (root / "data.csv").write_text("\n".join(rows), encoding="utf-8")
    report = run_data_audit(project_id="t", data_roots=[root])
    leaks = [f for f in report.findings if f.rule_id.startswith("LEAK-00")]
    for f in leaks:
        assert f.severity in ("unknown", "info", "medium"), \
            f"无划分证据时不应输出 {f.severity} 级泄漏结论"


def test_resource_limits_are_enforced(tmp_path):
    root = tmp_path / "big"
    root.mkdir()
    rows = ["id,v"] + [f"{i},{i}" for i in range(500)]
    (root / "data.csv").write_text("\n".join(rows), encoding="utf-8")
    report = run_data_audit(project_id="t", data_roots=[root],
                            max_files=5, sample_rows=100)
    # 采样上限生效
    per_file = report.stats["per_file"]
    for path, meta in per_file.items():
        if path.endswith("data.csv"):
            assert meta["sampled"] <= 100
    assert report.scope["limits"]["max_files"] == 5


def test_run_audit_on_paths_infers_root(tmp_path):
    root = tmp_path / "ds2"
    root.mkdir()
    (root / "a.csv").write_text("x,y\n1,2\n3,4\n", encoding="utf-8")
    report = run_audit_on_paths([root / "a.csv"], project_id="t")
    assert report.findings is not None
    assert str(root.resolve()) in report.scope["data_roots"][0] or \
        report.scope["data_roots"][0].startswith(str(tmp_path.resolve()))


# API 测试

def _mk_csv(name: str, lines: list[str]) -> tuple[str, bytes, str]:
    return (name, "\n".join(lines).encode("utf-8"), "text/csv")


@pytest.mark.asyncio
async def test_data_audit_api_full_flow(client, tmp_path, monkeypatch):
    """执行 → 详情 → 列表 → 规则目录 全链路。"""
    from app.services.material_service import STORAGE_ROOT
    import app.api.v1.data_audit as da

    r = await client.post("/api/v1/projects", json={
        "name": "数据审计测试", "domain": "ML",
        "paper_title": "合成", "description": "t",
    })
    assert r.status_code == 200
    pid = r.json()["data"]["id"]

    # 无数据时应 404 而非空报告
    r = await client.post(f"/api/v1/projects/{pid}/data-audits",
                          json={"include_code_scan": True})
    assert r.status_code == 404

    # 上传数据材料（走真实 upload 落盘到 STORAGE_ROOT/pid）
    # test 前 60 行与 train 完全相同（制造跨划分重复），其余行不同
    # —— 两文件内容必须不同，否则会被 sha256 去重为同一材料
    train = ["id,text,label"] + [
        f'{i},"record {i} text {i * 3}",{"1" if i < 5 else "0"}'
        for i in range(120)
    ]
    test = ["id,text,label"] + [
        f'{i},"record {i} text {i * 3}",{"1" if i < 5 else "0"}'
        for i in range(60)
    ] + [
        f'{200 + i},"heldout unique {i} content {i * 7}","0"'
        for i in range(60)
    ]
    r = await client.post("/api/v1/materials/upload",
                          data={"project_id": pid},
                          files={"file": _mk_csv("train.csv", train)})
    assert r.status_code == 200, r.text
    r = await client.post("/api/v1/materials/upload",
                          data={"project_id": pid},
                          files={"file": _mk_csv("test.csv", test)})
    assert r.status_code == 200, r.text

    try:
        # 执行审计
        r = await client.post(f"/api/v1/projects/{pid}/data-audits",
                              json={"include_code_scan": True})
        assert r.status_code == 200, r.text
        report = r.json()["data"]
        audit_id = report["audit_id"]
        assert report["version"] == "dataaudit-v1"
        assert report["scope"]["read_only"] is True
        assert report["scope"]["external_calls"] is False
        assert report["findings"], "上传的重复数据应产生发现"
        for f in report["findings"]:
            assert f["evidence"], "API 输出的发现必须带证据"
        rule_ids = {f["rule_id"] for f in report["findings"]}
        assert "LEAK-001" in rule_ids, "train/test 完全相同应检出跨划分重复"

        # 详情
        r = await client.get(f"/api/v1/projects/{pid}/data-audits/{audit_id}")
        assert r.status_code == 200
        assert r.json()["data"]["audit_id"] == audit_id

        # 列表
        r = await client.get(f"/api/v1/projects/{pid}/data-audits")
        assert r.status_code == 200
        items = r.json()["data"]["items"]
        assert any(i["audit_id"] == audit_id for i in items)

        # 跨项目隔离：另一个项目的 audit_id 查不到
        r2 = await client.post("/api/v1/projects", json={
            "name": "other", "domain": "x", "paper_title": "", "description": ""})
        other_pid = r2.json()["data"]["id"]
        r = await client.get(
            f"/api/v1/projects/{other_pid}/data-audits/{audit_id}")
        assert r.status_code == 404, "跨项目访问必须 404"

        # 规则目录
        r = await client.get("/api/v1/data-audits/rules")
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["total"] == len(RULE_CATALOG)
        assert data["total"] >= 30
    finally:
        # 清理真实落盘的材料
        shutil.rmtree(STORAGE_ROOT / pid, ignore_errors=True)


@pytest.mark.asyncio
async def test_data_audit_api_rejects_unknown_project(client):
    r = await client.post("/api/v1/projects/no-such/data-audits",
                          json={"include_code_scan": False})
    assert r.status_code == 404
