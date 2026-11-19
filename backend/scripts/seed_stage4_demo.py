"""第四阶段演示数据种子（幂等）：为第六阶段演示项目补齐复现工作台全链路数据。

用法（在 backend 目录下）：
    ./.venv/Scripts/python.exe -m scripts.seed_stage4_demo

在既有 ResNet-50/ImageNet 演示项目上写入：材料解析记录、原文分块、12 条科研事实
（含 1 条人工修订留痕与 1 条未声明字段）、证据链、执行环境、复现计划（5 任务 DAG）、
一次失败运行（CUDA OOM）+ 诊断 + 修复审核、一次成功运行（日志/产物/指标）、
程序化指标对照（含 10-crop 与 single-crop 协议区分）、14 章复现报告。
全部为标注演示数据；不伪造 AI 在线调用，运行记录为历史快照。
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db import SessionLocal, init_db
from app.models import AIRun, Material, Project, SourceChunk, ExtractedFact
from app.models.stage2 import EvidenceItem, FactRevision, MaterialParseRun, ParseTask
from app.models.stage4 import (
    ExecutionArtifact, ExecutionEnvironment, ExecutionLog, FailureDiagnostic,
    MetricComparison, RemediationProposal, RemediationReview, ReproductionMetric,
    ReproductionPlan, ReproductionReport, ReproductionRun, ReproductionTask,
)
from app.models.stage6 import User
from app.reproduction.report import ReportGenerator
from app.reproduction.results import MetricComparator
from app.services.trail_service import record_trail

DEMO_MODEL = "demo-seed-snapshot（历史演示快照，非在线调用）"


def nid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:14]}"


def jdump(v) -> str:
    return json.dumps(v, ensure_ascii=False)


async def seed() -> None:
    await init_db()
    async with SessionLocal() as db:
        project = (await db.execute(select(Project))).scalars().first()
        if project is None:
            print("未找到演示项目，请先运行 scripts.seed_stage6_demo。")
            return
        pid = project.id
        exists = (await db.execute(
            select(ReproductionPlan).where(ReproductionPlan.project_id == pid)
        )).scalars().first()
        if exists is not None:
            print("第四阶段演示数据已存在，跳过种子。")
            return

        users = {u.email: u for u in (await db.execute(select(User))).scalars().all()}
        lead = users["lead@reprocheck.demo"]
        researcher = users["researcher@reprocheck.demo"]
        reviewer = users["reviewer@reprocheck.demo"]
        materials = (await db.execute(
            select(Material).where(Material.project_id == pid).order_by(Material.created_at)
        )).scalars().all()
        paper = next(m for m in materials if m.material_type != "notebook")
        notebook = next(m for m in materials if m.material_type == "notebook")
        # 回填 raw_text：站点 Function 无本地文件存储，文本入库后材料/Notebook 视图自包含。
        from pathlib import Path
        for m in (paper, notebook):
            if not m.raw_text and m.stored_path and Path(m.stored_path).exists():
                m.raw_text = Path(m.stored_path).read_text(encoding="utf-8")

        base = datetime.now(timezone.utc) - timedelta(days=6)
        t = lambda h: base + timedelta(hours=h)  # noqa: E731

        # ---------- 材料解析记录 ----------
        for m, chunks_n, parser in [(paper, 2, "markdown-1.2"), (notebook, 2, "ipynb-1.2")]:
            m.parse_status = "parsed"
            m.parser_version = parser
            m.parse_duration_ms = 260
            m.parse_metadata_json = jdump({"parser": parser, "chunks": chunks_n, "demo": True})
            m.warnings_json = jdump([])
            db.add(MaterialParseRun(
                id=nid("mpr"), material_id=m.id, project_id=pid, parser_version=parser,
                parser_status="completed", chunk_count=chunks_n, warning_count=0,
                started_at=t(0), completed_at=t(0.05), duration_ms=260,
            ))
            db.add(ParseTask(
                id=nid("ptask"), project_id=pid, material_id=m.id, idem_key=nid("idem"),
                status="completed", stage="completed", stage_message="解析与事实抽取完成（演示快照）。",
                model=DEMO_MODEL, prompt_version="fact-extract-v2", model_calls=1,
                prompt_tokens=1800, completion_tokens=640, total_tokens=2440,
                duration_ms=4200, facts_count=12 if m is paper else 0,
                result_json=jdump({"demo": True, "facts_count": 12 if m is paper else 0}),
                created_at=t(0), started_at=t(0), completed_at=t(0.05),
            ))

        # ---------- 原文分块 ----------
        paper_text = paper.raw_text
        parts = [p.strip() for p in paper_text.split("## 复现注意事项") if p.strip()]
        chunk_defs = [
            (paper, "paper_chunk_001", 0, parts[0], "text_paragraph"),
            (paper, "paper_chunk_002", 1, "## 复现注意事项" + parts[1], "text_paragraph"),
            (notebook, "notebook_chunk_001", 0,
             "config = dict(lr=0.1, batch_size=256, epochs=90, optimizer='SGD', momentum=0.9)",
             "notebook_cell"),
            (notebook, "notebook_chunk_002", 1,
             "for epoch in range(config['epochs']):\n    train_one_epoch(model, loader, optimizer)\n"
             "# stdout: epoch 90/90 top1=76.03 top5=92.91", "notebook_cell"),
        ]
        for m, cid, idx, text, loc in chunk_defs:
            db.add(SourceChunk(
                material_id=m.id, chunk_id=cid, chunk_index=idx, original_text=text,
                locator_type=loc, project_id=pid, material_type=m.material_type,
                content_hash=hashlib.sha256(text.encode()).hexdigest(),
                parser_version=m.parser_version,
                source_locator_json=jdump({"chunk_index": idx, "locator_type": loc}),
                token_estimate=max(1, len(text) // 2), created_at=t(0.05),
            ))

        # ---------- 抽取运行 + 事实 + 证据 ----------
        extraction_run = AIRun(
            id=nid("run"), project_id=pid, run_type="extraction", status="completed",
            provider="demo-seed", model=DEMO_MODEL, task_type="fact_extraction",
            prompt_version="fact-extract-v2", material_id=paper.id, calls=2,
            prompt_tokens=3600, completion_tokens=1280, total_tokens=4880,
            duration_ms=8400, success=True,
            result_json=jdump({"demo": True, "facts_count": 12}),
            created_at=t(0.05), finished_at=t(0.08),
        )
        db.add(extraction_run)

        # (field_key, label, raw, normalized, unit, type, quote, chunk, status, assertion)
        fact_defs = [
            ("learning_rate", "学习率", "0.1", "0.1", "", "training_parameter", "学习率 0.1", "paper_chunk_001", "supported", "explicit"),
            ("batch_size", "批大小", "256", "256", "samples", "training_parameter", "batch size 256", "paper_chunk_001", "supported", "explicit"),
            ("epochs", "训练轮数", "90", "90", "epochs", "training_parameter", "训练 90 个 epoch", "paper_chunk_001", "supported", "explicit"),
            ("optimizer", "优化器", "SGD", "SGD", "", "training_parameter", "我们使用 SGD", "paper_chunk_001", "supported", "explicit"),
            ("momentum", "动量", "0.9", "0.9", "", "training_parameter", "动量 0.9", "paper_chunk_001", "supported", "explicit"),
            ("weight_decay", "权重衰减", "1e-4", "0.0001", "", "training_parameter", "权重衰减 1e-4", "paper_chunk_001", "supported", "explicit"),
            ("lr_scheduler", "学习率调度", "每 30 个 epoch 学习率除以 10", "step_30_gamma_0.1", "", "training_parameter", "每 30 个 epoch 学习率除以 10", "paper_chunk_001", "supported", "explicit"),
            ("gpu", "GPU 型号", "8 块 V100", "V100 x8", "", "environment", "在 8 块 V100 GPU 上以混合精度训练", "paper_chunk_001", "supported", "explicit"),
            ("mixed_precision", "混合精度", "混合精度", "amp_fp16", "", "environment", "以混合精度训练", "paper_chunk_001", "supported", "explicit"),
            ("accuracy", "Top-1 准确率", "76.1%", "0.761", "ratio", "metric", "ImageNet 验证集 top-1 准确率 76.1%", "paper_chunk_001", "supported", "explicit"),
            ("top5_accuracy", "Top-5 准确率", "92.9%", "0.929", "ratio", "metric", "top-5 准确率 92.9%", "paper_chunk_001", "supported", "explicit"),
            ("random_seed", "随机种子", "未声明", None, "", "training_parameter", "论文未明确声明随机种子与数据增强管线版本", "paper_chunk_002", "unsupported", "inferred"),
        ]
        chunk_text = {cid: text for _, cid, _, text, _ in chunk_defs}
        fact_ids: dict[str, str] = {}
        for i, (fk, label, raw, norm, unit, ftype, quote, cid, status, assertion) in enumerate(fact_defs):
            fid = nid("fact")
            fact_ids[fk] = fid
            human = fk == "weight_decay"
            ai_original = jdump({
                "field_key": fk, "field_label": label,
                "raw_value": raw, "normalized_value": "1e-4" if human else norm,
            }) if human else None
            db.add(ExtractedFact(
                run_id=extraction_run.id, project_id=pid, material_id=paper.id, chunk_id=cid,
                field_key=fk, raw_value=raw, normalized_value=norm, unit=unit,
                confidence=0.2 if status == "unsupported" else 0.93,
                fact_id=fid, fact_type=ftype, field_label=label, assertion_type=assertion,
                extraction_status=status, parser_source="human" if human else "model",
                extraction_run_id=extraction_run.id, quote=quote,
                source_locator_json=jdump({"chunk_id": cid, "chunk_index": 0 if cid.endswith("001") else 1}),
                source_name=paper.source_name, revision_count=1 if human else 0,
                ai_original_json=ai_original, created_at=t(0.08),
            ))
            db.add(EvidenceItem(
                evidence_id=nid("ev"), fact_id=fid, project_id=pid, material_id=paper.id,
                chunk_id=cid, source_name=paper.source_name, quote=quote,
                original_text=chunk_text[cid],
                source_locator=jdump({"chunk_id": cid}),
                verification_status="unverified" if status == "unsupported" else "verified",
                created_at=t(0.08),
            ))
            if human:
                db.add(FactRevision(
                    revision_id=nid("rev"), fact_id=fid, field_key="normalized_value",
                    old_value="1e-4", new_value="0.0001", revision_source="human",
                    note="人工核对：科学计数法统一折算为小数（演示修订留痕）。",
                    created_at=t(1),
                ))

        # ---------- 执行环境（来自 Notebook 检测） ----------
        env = ExecutionEnvironment(
            id=nid("env"), project_id=pid, material_id=notebook.id, python_version="3.8.10",
            frameworks_json=jdump({"pytorch": "1.8.0", "torchvision": "0.9.0"}),
            dependencies_json=jdump(["torch==1.8.0", "torchvision==0.9.0"]),
            hardware_json=jdump({"gpu": "NVIDIA V100", "gpu_count": 8, "memory_gb": 32}),
            entrypoints_json=jdump(["train.ipynb"]),
            missing_json=jdump(["random_seed", "data_augmentation_pipeline_version"]),
            warnings_json=jdump(["Notebook 未声明随机种子，结果可能随运行波动。"]),
            changed_from_original_json=jdump([]), created_at=t(1),
        )
        db.add(env)

        # ---------- 计划 + 任务 DAG ----------
        plan = ReproductionPlan(
            id=nid("plan"), project_id=pid,
            title="ResNet-50 / ImageNet top-1 76.1% 复现计划", status="confirmed",
            source="ai", ai_available=True, prompt_version="repro-plan-v1", model=DEMO_MODEL,
            feasibility_summary_json=jdump({
                "feasible": 4, "needs_human_review": 1, "blocked": 0,
                "summary": "材料与运行环境就绪；随机种子与增强管线版本未声明，数据准备需人工确认。",
            }),
            source_refs_json=jdump(["paper_chunk_001", "paper_chunk_002", fact_ids["accuracy"]]),
            created_at=t(1),
        )
        db.add(plan)
        task_defs = [
            ("env_setup", "环境准备", [], "feasible",
             "按 Notebook 检测重建 Python 3.8.10 + PyTorch 1.8.0 环境（8×V100）。",
             "torch.cuda.device_count() == 8", "依赖版本与 Notebook 声明一致。"),
            ("data_prepare", "ImageNet 数据准备", ["env_setup"], "needs_human_review",
             "准备 ImageNet-1k 训练/验证集；论文未声明增强管线版本，需人工确认后再执行。",
             "验证集 50000 张可加载", "划分与官方 val 一致；增强管线经人工确认。"),
            ("train_config", "训练配置对齐", ["env_setup"], "feasible",
             "对齐论文超参数：SGD lr=0.1 bs=256 epochs=90 momentum=0.9 wd=1e-4，每 30 epoch 学习率除以 10，AMP。",
             "配置与论文事实逐项一致", "允许平台默认容差内的实现差异，需留痕。"),
            ("train_run", "训练执行", ["data_prepare", "train_config"], "feasible",
             "执行 90 epoch 训练，记录日志与检查点。",
             "完成 90 epoch 并产出检查点", "运行日志完整可追溯。"),
            ("eval_report", "评估与报告", ["train_run"], "feasible",
             "单 crop 评估 top-1/top-5，与论文 10-crop 结果区分比对，生成 14 章报告。",
             "指标对照区分评估协议", "不得把协议不一致的结果判为数值偏差。"),
        ]
        task_ids: dict[str, str] = {}
        for key, title, deps, feas, action, expected, accept in task_defs:
            tid = nid("task")
            task_ids[key] = tid
            db.add(ReproductionTask(
                id=tid, plan_id=plan.id, project_id=pid, task_key=key, title=title,
                description=action, depends_on_json=jdump([task_ids[d] for d in deps]),
                required_materials_json=jdump([paper.id, notebook.id]),
                action=action, expected_result=expected, acceptance_criteria=accept,
                evidence_refs_json=jdump([fact_ids["learning_rate"], fact_ids["batch_size"]]),
                risk="随机种子未声明，复现结果存在运行间波动。" if key == "train_run" else "",
                feasibility=feas,
                feasibility_reason="论文未声明数据增强管线版本，需人工确认。" if feas == "needs_human_review" else "材料与证据齐备。",
                needs_human_confirm=feas == "needs_human_review",
                status="completed", created_at=t(1),
            ))

        # ---------- 失败运行 + 诊断 + 修复审核 ----------
        run_failed = ReproductionRun(
            id=nid("run"), project_id=pid, plan_id=plan.id,
            task_ids_json=jdump([task_ids["train_config"], task_ids["train_run"]]),
            status="failed", execution_enabled=True,
            security_check_json=jdump({"passed": True, "tool": "SecurityPreflight",
                                       "checks": ["无危险系统调用", "无云元数据访问", "无外联下载"]}),
            environment_id=env.id, requested_by=researcher.display_name,
            requested_by_user_id=researcher.id, workdir="runs/repro-resnet50-001",
            started_at=t(2), finished_at=t(2.12), duration_ms=432000,
            cpu_seconds=310.5, memory_mb=32100.0,
            error_message="CUDA out of memory. Tried to allocate 2.00 GiB (GPU 0; 31.75 GiB total capacity)",
            created_at=t(2),
        )
        db.add(run_failed)
        for stream, content in [
            ("stdout", "[demo] start train: batch_size=512 epochs=90 amp=off"),
            ("stdout", "[demo] epoch 1/90 step 120/5005 loss=6.91"),
            ("stderr", "RuntimeError: CUDA out of memory. Tried to allocate 2.00 GiB (GPU 0; 31.75 GiB total capacity)"),
        ]:
            db.add(ExecutionLog(log_id=nid("log"), run_id=run_failed.id, project_id=pid,
                                stream=stream, content=content, created_at=t(2.1)))
        diag = FailureDiagnostic(
            id=nid("diag"), run_id=run_failed.id, project_id=pid,
            problem="训练在第 1 个 epoch 因显存溢出（CUDA OOM）中断。",
            error_evidence="RuntimeError: CUDA out of memory. Tried to allocate 2.00 GiB (GPU 0; 31.75 GiB total capacity)",
            possible_causes_json=jdump(["batch_size=512 超出 8×V100 显存预算", "未启用 AMP 混合精度"]),
            suggested_fix="将 batch_size 恢复为论文值 256 并启用 AMP；该修改不改变研究条件。",
            verification_method="nvidia-smi 观察显存占用并重跑首个 epoch。",
            needs_human_confirm=True, ai_available=True, prompt_version="diag-v1",
            created_at=t(2.2),
        )
        db.add(diag)
        proposal = RemediationProposal(
            id=nid("rem"), diagnostic_id=diag.id, project_id=pid, change_type="config",
            target_file="train.ipynb#cell-2", original_value="batch_size=512",
            proposed_value="batch_size=256", changes_research_conditions=False,
            status="approved", created_at=t(2.3),
        )
        db.add(proposal)
        db.add(RemediationReview(
            id=nid("rev"), proposal_id=proposal.id, decision="approve",
            reviewer=reviewer.display_name, reviewer_user_id=reviewer.id,
            note="恢复论文值 256，不改变研究条件；同意重跑。", original_preserved=True,
            created_at=t(3),
        ))

        # ---------- 成功运行 + 日志/产物/指标 ----------
        run_ok = ReproductionRun(
            id=nid("run"), project_id=pid, plan_id=plan.id,
            task_ids_json=jdump(list(task_ids.values())), status="completed",
            execution_enabled=True,
            security_check_json=jdump({"passed": True, "tool": "SecurityPreflight",
                                       "checks": ["无危险系统调用", "无云元数据访问", "无外联下载"]}),
            environment_id=env.id, requested_by=researcher.display_name,
            requested_by_user_id=researcher.id, workdir="runs/repro-resnet50-002",
            started_at=t(5), finished_at=t(66.5), duration_ms=221400000,
            cpu_seconds=1587600.0, memory_mb=28672.0, created_at=t(5),
        )
        db.add(run_ok)
        ok_logs = [
            ("stdout", "[demo] start train: lr=0.1 batch_size=256 epochs=90 optimizer=SGD momentum=0.9 wd=0.0001 amp=on"),
            ("stdout", "[demo] scheduler: step decay gamma=0.1 every 30 epochs"),
            ("stdout", "[demo] epoch 10/90 top1=61.24 top5=83.10"),
            ("stdout", "[demo] epoch 30/90 top1=70.85 top5=89.72"),
            ("stdout", "[demo] epoch 60/90 top1=74.91 top5=92.10"),
            ("stdout", "epoch 90/90 top1=76.03 top5=92.91"),
            ("stdout", "[demo] saved checkpoint: resnet50_imagenet.pth"),
        ]
        for i, (stream, content) in enumerate(ok_logs):
            db.add(ExecutionLog(log_id=nid("log"), run_id=run_ok.id, project_id=pid,
                                stream=stream, content=content, created_at=t(5 + i * 9)))
        for name, size in [("resnet50_imagenet.pth", 102400000), ("metrics.json", 1240), ("train.log", 8600000)]:
            db.add(ExecutionArtifact(
                artifact_id=nid("art"), run_id=run_ok.id, project_id=pid, name=name,
                path=f"runs/repro-resnet50-002/{name}", size_bytes=size,
                hash=hashlib.sha256(f"demo:{name}".encode()).hexdigest(), created_at=t(66.5),
            ))
        metric_defs = [
            ("top1_accuracy", 0.7603, "ratio", "stdout: epoch 90/90 top1=76.03", "regex", "ImageNet val (single-crop)", 0.95),
            ("top5_accuracy", 0.9291, "ratio", "stdout: epoch 90/90 top5=92.91", "regex", "ImageNet val (single-crop)", 0.95),
            ("training_time", 61.5, "hours", "run started_at/finished_at", "program", None, 1.0),
        ]
        for name, value, unit, source, method, dataset, conf in metric_defs:
            db.add(ReproductionMetric(
                metric_name=name, metric_value=value, unit=unit, source=source,
                extraction_method=method, experiment="resnet50-imagenet-90e", dataset=dataset,
                run_id=run_ok.id, project_id=pid, confidence=conf,
                needs_manual_review=False, created_at=t(66.6),
            ))

        # ---------- 指标对照（程序化，区分评估协议） ----------
        cmp = MetricComparator()
        cond_all = {"same_dataset": True, "same_split": True, "same_metric": True, "same_preprocessing": True}
        comparisons = [
            cmp.compare("top1_accuracy", 0.761, 0.7603, unit="ratio",
                        conditions={**cond_all, "same_preprocessing": False},
                        tolerance_basis="论文 76.1% 为 10-crop 评估，复现为单 crop：协议不一致，不作数值偏差判定。"),
            cmp.compare("top1_accuracy", 0.753, 0.7603, unit="ratio", conditions=cond_all,
                        tolerance_basis="论文表 3 单 crop 参考值 75.3%；平台默认容差 0.02（非论文标准，需人工确认适用性）。"),
            cmp.compare("top5_accuracy", 0.929, 0.9291, unit="ratio", conditions=cond_all),
            cmp.compare("training_time", None, 61.5, unit="hours", conditions=cond_all,
                        tolerance_basis="论文未报告训练耗时，无法对照。"),
        ]
        for result in comparisons:
            await cmp.persist(db, pid, result)

        # ---------- 报告（14 章，纯 DB/模板） ----------
        report = await ReportGenerator(db).generate(pid, plan_id=plan.id, run_ids=[run_ok.id, run_failed.id])
        report.title = "ResNet-50 / ImageNet 复现审计报告（演示）"
        report.status = "final"

        # ---------- 审计轨迹 ----------
        for action, target_type, target_id, summary, actor in [
            ("repro.plan_created", "reproduction_plan", plan.id, "创建复现计划（演示种子）", lead),
            ("repro.run_failed", "reproduction_run", run_failed.id, "复现运行失败：CUDA OOM（演示种子）", researcher),
            ("repro.remediation_approved", "remediation_proposal", proposal.id, "修复建议审核通过：恢复 batch_size=256", reviewer),
            ("repro.run_completed", "reproduction_run", run_ok.id, "复现运行完成：top1=76.03（演示种子）", researcher),
            ("repro.report_generated", "reproduction_report", report.id, "生成 14 章复现报告（演示种子）", lead),
        ]:
            await record_trail(db, action=action, actor_user_id=actor.id, project_id=pid,
                               target_type=target_type, target_id=target_id,
                               summary=summary, request_id="seed-stage4-demo")
        await db.commit()
        print(f"第四阶段演示种子完成：project={pid} facts={len(fact_defs)} tasks={len(task_defs)} "
              f"runs=2 comparisons={len(comparisons)} report={report.id}")


if __name__ == "__main__":
    asyncio.run(seed())