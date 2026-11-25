"""第四阶段测试：规划/DAG/可行性/沙箱安全/对照/诊断/报告。

AI 相关用协议级 mock 验证程序逻辑；真实 API 调用状态如实标注。
"""
from __future__ import annotations

import json

import httpx
import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.errors import AppError
from app.llm import LLMService
from app.models import Material, Project
from app.models.stage4 import (
    ExecutionEnvironment,
    ReproductionPlan,
    ReproductionRun,
    ReproductionTask,
)
from app.reproduction.adapter import propagate_blocking, validate_dag
from app.reproduction.diagnostics import FailureDiagnoser
from app.reproduction.feasibility import check_feasibility
from app.reproduction.planner import ReproductionPlanner
from app.reproduction.results import MetricComparator, QualityEvaluator, ResultExtractor
from app.reproduction.sandbox import ExecutionSandbox, SecurityPreflight, EnvDetector


def mk_plan_payload(tasks=None):
    return {
        "title": "测试复现规划",
        "tasks": tasks or [
            {"task_key": "T01", "title": "确认数据集", "description": "检查数据集来源",
             "depends_on": [], "required_materials": [], "action": "检查数据集来源与版本",
             "expected_result": "明确数据集", "acceptance_criteria": "有下载地址",
             "evidence_refs": [], "risk": "低", "feasibility": "ready",
             "feasibility_reason": "", "needs_human_confirm": False},
            {"task_key": "T02", "title": "准备环境", "description": "检查依赖",
             "depends_on": ["T01"], "required_materials": [],
             "action": "检查学习率与 batch size 配置",
             "expected_result": "环境就绪", "acceptance_criteria": "依赖齐全",
             "evidence_refs": [], "risk": "低", "feasibility": "ready",
             "feasibility_reason": "", "needs_human_confirm": False},
        ],
    }


def _mk_response(payload):
    return httpx.Response(200, json={
        "model": "qwen-plus",
        "choices": [{"message": {"role": "assistant",
                                 "content": json.dumps(payload, ensure_ascii=False)}}],
        "usage": {"prompt_tokens": 200, "completion_tokens": 100, "total_tokens": 300},
    }, request=httpx.Request("POST", "https://mock/v1/chat/completions"))


# DAG

def test_dag_valid_topological_order():
    tasks = [{"task_key": "A", "depends_on": []},
             {"task_key": "B", "depends_on": ["A"]},
             {"task_key": "C", "depends_on": ["B"]}]
    order, errors = validate_dag(tasks)
    assert not errors and order == ["A", "B", "C"]


def test_dag_detects_cycle():
    tasks = [{"task_key": "A", "depends_on": ["B"]},
             {"task_key": "B", "depends_on": ["A"]}]
    order, errors = validate_dag(tasks)
    assert order == [] and any("循环" in e for e in errors)


def test_dag_detects_unknown_dependency():
    tasks = [{"task_key": "A", "depends_on": ["MISSING"]}]
    order, errors = validate_dag(tasks)
    assert order == [] and any("不存在" in e for e in errors)


def test_blocking_propagation():
    tasks = [
        {"task_key": "A", "depends_on": [], "feasibility": "missing_material", "status": "blocked"},
        {"task_key": "B", "depends_on": ["A"], "feasibility": "ready", "status": "pending"},
    ]
    result = propagate_blocking(tasks, ["A", "B"])
    assert result[1]["feasibility"] == "missing_dependency"
    assert result[1]["status"] == "blocked"


# feasibility

def test_feasibility_security_block():
    task = {"title": "训练", "action": "执行 rm -rf /data 清理", "needs_human_confirm": False}
    f, reason = check_feasibility(task, [], [])
    assert f == "blocked_security" and "高风险" in reason


def test_feasibility_missing_material_not_blame_researcher():
    task = {"title": "下载数据集", "action": "下载 ImageNet",
            "required_materials": ["imagenet.zip"], "needs_human_confirm": False}
    f, reason = check_feasibility(task, [], [])
    assert f == "missing_material"
    assert "不代表该材料不存在" in reason


def test_feasibility_missing_config_not_blame_researcher():
    task = {"title": "训练", "action": "执行训练程序", "needs_human_confirm": False}
    f, reason = check_feasibility(task, [], [])
    assert f == "missing_configuration"
    assert "不等于研究者未设置" in reason


# sandbox security

def test_security_preflight_detects_dangerous_script():
    code = "import os\nos.system('rm -rf /')\nx = requests.get('http://169.254.169.254/latest')"
    findings = SecurityPreflight().scan_text(code, "train.py")
    codes = {f["code"] for f in findings}
    assert "DANGEROUS_PATTERN" in codes and "INTERNAL_NETWORK_ACCESS" in codes
    passed, reason = SecurityPreflight().decide(findings)
    assert not passed and "阻断" in reason


def test_sandbox_disabled_by_default():
    available, reason = ExecutionSandbox.sandbox_available()
    assert available is False
    assert "禁用" in reason or "未验证" in reason


def test_env_detector():
    from app.models import Material
    materials = [Material(id="m1", project_id="p", source_name="requirements.txt",
                          material_type="requirements", raw_text="")]
    texts = {"requirements.txt": "torch==1.13.0\npython=3.9\ncuda=11.7"}
    info = EnvDetector().detect(materials, texts)
    assert info["frameworks"].get("python_version") == "3.9"
    assert info["frameworks"].get("cuda") == "11.7"
    assert any(f["kind"] == "requirements" for f in info["dependency_files"])


# result comparison

def test_metric_comparator_verdicts():
    c = MetricComparator()
    assert c.compare("accuracy", 0.926, 0.926)["verdict"] == "exact_match"
    assert c.compare("accuracy", 0.926, 0.918)["verdict"] == "within_tolerance"
    assert c.compare("accuracy", 0.926, 0.80)["verdict"] == "significant_deviation"
    assert c.compare("accuracy", None, 0.9)["verdict"] == "insufficient_data"
    assert c.compare("accuracy", 0.9, 0.9,
                     conditions={"same_dataset": False})["verdict"] == "not_comparable"


def test_metric_extractor_regex_and_json():
    e = ResultExtractor()
    metrics = e.extract_from_text("Epoch 10: accuracy=0.923, f1_score=0.881", "log.txt")
    assert any(m["metric_name"] == "accuracy" and m["metric_value"] == 0.923 for m in metrics)
    js = e.extract_from_json('{"metrics": {"auc": 0.95}}', "result.json")
    assert any(m["metric_name"] == "auc" and m["metric_value"] == 0.95 for m in js)


def test_quality_scope_note():
    q = QualityEvaluator().evaluate([], 0, [], [], [])
    assert "不代表学术质量" in q["scope_note"]
    assert len(q["dimensions"]) == 7
    assert "Σ" in q["formula"]


# planner (mock LLM)

@pytest.mark.asyncio
async def test_planner_generates_valid_dag(session_fixture, monkeypatch):
    session_fixture.add(Project(id="p1", name="测试"))
    session_fixture.add(Material(id="m1", project_id="p1", source_name="config.yaml",
                                 material_type="yaml", raw_text="lr: 0.001"))
    await session_fixture.commit()
    llm = LLMService(client=httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: _mk_response(mk_plan_payload()))))
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    plan = await ReproductionPlanner(session_fixture, llm=llm).create_plan("p1")
    assert plan.source == "ai" and plan.ai_available is True
    tasks = (await session_fixture.execute(
        select(ReproductionTask).where(ReproductionTask.plan_id == plan.id)
    )).scalars().all()
    assert len(tasks) == 2
    summary = json.loads(plan.feasibility_summary_json)
    assert sum(summary.values()) == 2


@pytest.mark.asyncio
async def test_planner_no_key_fails_without_fake_plan(session_fixture, monkeypatch):
    session_fixture.add(Project(id="p2", name="测试"))
    await session_fixture.commit()
    monkeypatch.setattr(settings, "llm_api_key", "")
    with pytest.raises(AppError) as ei:
        await ReproductionPlanner(session_fixture, llm=LLMService()).create_plan("p2")
    assert ei.value.code == "LLM_KEY_NOT_CONFIGURED"
    plans = (await session_fixture.execute(select(ReproductionPlan))).scalars().all()
    assert len(plans) == 0


@pytest.mark.asyncio
async def test_planner_rejects_cycle_from_ai(session_fixture, monkeypatch):
    session_fixture.add(Project(id="p3", name="测试"))
    await session_fixture.commit()
    tasks = mk_plan_payload()["tasks"]
    tasks[0]["depends_on"] = ["T02"]  # 形成环
    llm = LLMService(client=httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: _mk_response(mk_plan_payload(tasks)))))
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    with pytest.raises(AppError) as ei:
        await ReproductionPlanner(session_fixture, llm=llm).create_plan("p3")
    assert ei.value.code == "DAG_INVALID"


# sandbox run creation

@pytest.mark.asyncio
async def test_run_creation_blocked_no_sandbox(session_fixture, monkeypatch):
    session_fixture.add(Project(id="p4", name="测试"))
    session_fixture.add(ReproductionPlan(id="rp4", project_id="p4", title="plan"))
    await session_fixture.commit()
    run = await ExecutionSandbox(session_fixture).create_run(
        plan_id="rp4", project_id="p4", task_ids=[], requested_by="tester")
    assert run.execution_enabled is False
    assert run.status == "blocked_no_sandbox"
    sec = json.loads(run.security_check_json)
    assert sec["sandbox_available"] is False


# diagnosis no key

@pytest.mark.asyncio
async def test_diagnosis_no_key_not_fake(session_fixture, monkeypatch):
    session_fixture.add(Project(id="p5", name="测试"))
    session_fixture.add(ReproductionRun(id="rr5", project_id="p5", plan_id="rp5", status="failed"))
    await session_fixture.commit()
    monkeypatch.setattr(settings, "llm_api_key", "")
    with pytest.raises(AppError) as ei:
        await FailureDiagnoser(session_fixture, llm=LLMService()).diagnose("rr5", "p5")
    assert ei.value.code == "LLM_KEY_NOT_CONFIGURED"


# report generation

@pytest.mark.asyncio
async def test_report_generation_14_chapters_with_sources(session_fixture):
    from app.reproduction.report import ReportGenerator
    session_fixture.add(Project(id="p6", name="报告测试", domain="CV", paper_title="合成"))
    await session_fixture.commit()
    report = await ReportGenerator(session_fixture).generate("p6")
    sections = json.loads(report.sections_json)
    assert len(sections) == 14
    assert report.html and "<html" in report.html
    assert all("sources" in s and "origin" in s for s in sections)
    # 范围声明明确不是学术质量判定
    assert "学术质量" in report.scope_note
    # PDF 不可用时返回 None
    assert report.pdf_path is None or isinstance(report.pdf_path, str)


@pytest.mark.asyncio
async def test_report_distinguishes_ai_program_execution_origins(session_fixture):
    from app.reproduction.report import ReportGenerator
    session_fixture.add(Project(id="p7", name="来源区分"))
    session_fixture.add(ReproductionPlan(id="rp7", project_id="p7", title="p", ai_available=True))
    await session_fixture.commit()
    report = await ReportGenerator(session_fixture).generate("p7")
    sections = json.loads(report.sections_json)
    origins = {s["origin"] for s in sections}
    assert any("AI" in o for o in origins)
    assert any("程序" in o for o in origins)
    assert any("用户" in o or "综合" in o for o in origins)
