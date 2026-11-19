"""第六阶段演示数据种子（幂等）。

用法（在 backend 目录下）：
    ./.venv/Scripts/python.exe -m scripts.seed_stage6_demo

创建 4 个演示账户（密码统一 ReproCheck#2026）、1 个实验室组织、1 个带 Notebook 材料的
审计项目、4 个覆盖全部质量等级的基准案例、默认+自定义审计规则（含版本对比评估）、
反馈/评论/复核、RAG 知识文档、仓库连接与演示快照、API Token 与调用日志、AI 授权与数据导出。
所有重要操作经服务层写入审计轨迹。已存在演示账户时直接跳过，不重复写入。
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db import SessionLocal, init_db
from app.models import AIRun, AuditFinding, Project
from app.models.stage6 import (
    ApiCallLog,
    OrgMember,
    ProjectMember,
    RepositorySnapshot,
    User,
)
from app.core.security import new_id
from app.services import (
    auth_service,
    benchmark_service,
    collab_service,
    feedback_service,
    governance_service,
    notebook_service,
    org_service,
    rag_service,
    repository_service,
    rule_eval,
    rule_service,
)
from app.services.material_service import MaterialService
from app.services.trail_service import record_trail

DEMO_PASSWORD = "ReproCheck#2026"
LEAD_EMAIL = "lead@reprocheck.demo"

NOTEBOOK = {
    "cells": [
        {"cell_type": "markdown", "metadata": {}, "source": [
            "# ResNet-50 / ImageNet 复现训练\n",
            "目标：复现论文报告的 top-1 76.1%（90 epochs，8×V100）。"]},
        {"cell_type": "code", "execution_count": 1, "metadata": {}, "outputs": [], "source": [
            "import torch\n",
            "from torchvision.models import resnet50\n",
            "model = resnet50(weights=None)\n",
            "print(torch.__version__, torch.cuda.device_count())"]},
        {"cell_type": "code", "execution_count": 2, "metadata": {},
         "outputs": [{"output_type": "stream", "name": "stdout", "text": ["1.8.0 8\n"]}],
         "source": [
            "config = dict(lr=0.1, batch_size=256, epochs=90, optimizer='SGD', momentum=0.9)\n",
            "config"]},
        {"cell_type": "markdown", "metadata": {}, "source": [
            "## 训练循环\n", "余弦退火 + 标签平滑 0.1，混合精度 AMP。"]},
        {"cell_type": "code", "execution_count": 3, "metadata": {},
         "outputs": [{"output_type": "stream", "name": "stdout",
                      "text": ["epoch 90/90 top1=76.03 top5=92.91\n"]}],
         "source": [
            "for epoch in range(config['epochs']):\n",
            "    train_one_epoch(model, loader, optimizer)\n",
            "print(f'epoch 90/90 top1=76.03 top5=92.91')"]},
        {"cell_type": "code", "execution_count": 4, "metadata": {}, "outputs": [], "source": [
            "torch.save(model.state_dict(), 'resnet50_imagenet.pth')"]},
    ],
    "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                 "language_info": {"name": "python", "version": "3.8.10"}},
    "nbformat": 4, "nbformat_minor": 5,
}

PAPER_MD = """# Deep Residual Learning for Image Recognition（摘录）

训练细节：我们使用 SGD，batch size 256，学习率 0.1，动量 0.9，权重衰减 1e-4，
训练 90 个 epoch，每 30 个 epoch 学习率除以 10。在 8 块 V100 GPU 上以混合精度训练，
ImageNet 验证集 top-1 准确率 76.1%，top-5 准确率 92.9%。

## 复现注意事项
- 论文未明确声明随机种子与数据增强管线版本；
- 表 3 的 76.1% 为 10-crop 评估，单 crop 为 75.3%。
"""


async def _user_by_email(db, email: str) -> User:
    return (await db.execute(select(User).where(User.email == email))).scalar_one()


async def seed() -> None:
    await init_db()
    async with SessionLocal() as db:
        exists = (await db.execute(select(User).where(User.email == LEAD_EMAIL))).scalar_one_or_none()
        if exists is not None:
            print("演示数据已存在，跳过种子。")
            return

        # ---------- 账户 ----------
        accounts = {}
        for email, name in [
            (LEAD_EMAIL, "林晚晴"),
            ("researcher@reprocheck.demo", "陈叙"),
            ("reviewer@reprocheck.demo", "沈知微"),
            ("viewer@reprocheck.demo", "顾远"),
        ]:
            await auth_service.register(db, email, DEMO_PASSWORD, name)
            accounts[email] = await _user_by_email(db, email)
        lead, researcher, reviewer, viewer = (accounts[e] for e in [
            LEAD_EMAIL, "researcher@reprocheck.demo", "reviewer@reprocheck.demo", "viewer@reprocheck.demo"])

        # ---------- 组织 / 邀请 / 团队 / 工作空间 ----------
        org = await org_service.create_org(db, lead, "开源复现审计实验室",
                                           "面向 CV/ML 论文复现的团队协作审计空间（演示数据）。")
        org_id = org["id"]
        for user, role in [(researcher, "member"), (reviewer, "member"), (viewer, "member")]:
            inv = await org_service.create_invitation(db, lead, org_id, user.email, role)
            await org_service.accept_invitation(db, user, inv["token"])
        team = await org_service.create_team(db, lead, org_id, "ImageNet 复现小组", "负责 ImageNet 系列基准复现。")
        await org_service.add_team_member(db, lead, team["id"], researcher.id, "lead")
        await org_service.add_team_member(db, lead, team["id"], reviewer.id, "reviewer")
        ws = await org_service.create_workspace(db, lead, org_id, "CVPR 2026 投稿", "投稿前复现审计工作空间。")

        # ---------- 项目 / 成员 / 材料 ----------
        proj = Project(id=f"proj-{uuid.uuid4().hex[:16]}", name="ResNet-50 / ImageNet 复现审计",
                       domain="计算机视觉", paper_title="Deep Residual Learning for Image Recognition",
                       description="对照论文表 3 与训练配置，审计 top-1 76.1% 的可复现性（演示项目）。",
                       owner_user_id=lead.id, org_id=org_id, workspace_id=ws["id"])
        db.add(proj)
        await db.flush()
        for user, role in [(lead, "project_lead"), (researcher, "researcher"),
                           (reviewer, "reviewer"), (viewer, "viewer")]:
            db.add(ProjectMember(id=new_id("pm"), project_id=proj.id, user_id=user.id,
                                 role_key=role, added_by=lead.id))
        await record_trail(db, action="project.create", actor_user_id=lead.id, org_id=org_id,
                           project_id=proj.id, target_type="project", target_id=proj.id,
                           after={"name": proj.name}, summary="创建项目")
        await db.commit()

        msvc = MaterialService(db)
        nb_material = await msvc.upload(proj.id, "resnet50_repro.ipynb",
                                        json.dumps(NOTEBOOK, ensure_ascii=False).encode("utf-8"))
        md_material = await msvc.upload(proj.id, "paper_excerpt.md", PAPER_MD.encode("utf-8"))
        await notebook_service.get_notebook(db, lead, nb_material.id)

        # ---------- 审计发现（供评论 / 复核 / 反馈引用） ----------
        run = AIRun(id=new_id("run"), project_id=proj.id, run_type="demo_audit", status="completed",
                    provider="seed", model="demo-seed", calls=0)
        db.add(run)
        await db.flush()
        f1 = AuditFinding(run_id=run.id, project_id=proj.id, field_key="top1_accuracy", severity="high",
                          title="top-1 准确率与论文声明存在 0.07pp 差异",
                          ai_explanation="复现日志 top1=76.03%，论文表 3 声明 76.1%（10-crop）。差异在容差边缘，需确认评估协议一致。")
        f2 = AuditFinding(run_id=run.id, project_id=proj.id, field_key="random_seed", severity="medium",
                          title="随机种子与数据增强版本缺少证据",
                          ai_explanation="论文未声明随机种子；Notebook 未固定 seed，复现结果存在 run-to-run 方差风险。")
        db.add_all([f1, f2])
        await db.commit()
        await db.refresh(f1)
        await db.refresh(f2)

        # ---------- 基准案例（覆盖四级质量阶梯） ----------
        async def make_case(title, **kw):
            return await benchmark_service.create_case(db, lead, {"title": title, "org_id": org_id, **kw})

        c1 = await make_case(
            "ResNet-50 ImageNet top-1 76.1%（90 epochs）",
            doi="10.1109/CVPR.2016.90", source_url="https://arxiv.org/abs/1512.03385",
            domain="computer_vision", research_task="image_classification",
            model_architecture="ResNet-50", dataset_name="ImageNet-1k",
            code_repo_url="https://github.com/pytorch/vision", code_commit="a1b2c3d4e5f6",
            license="BSD-3-Clause", is_public=True,
            summary="论文表 3 的 10-crop top-1 76.1%；8×V100、SGD lr=0.1、bs=256、90 epochs。")
        for raw_field, raw_value, source_type, source_ref in [
            ("learning rate", "0.1", "paper", "§3.4 Training"),
            ("batch size", "256", "paper", "§3.4 Training"),
            ("epochs", "90", "paper", "§3.4 Training"),
            ("top-1 accuracy", "76.1%", "paper", "Table 3"),
            ("GPU", "8×V100", "execution", "repro log env"),
            ("pytorch version", "1.8.0", "execution", "cell 1 stdout"),
            ("training time", "62 h", "execution", "run summary"),
        ]:
            await benchmark_service.add_case_fact(db, lead, c1["id"], {
                "raw_field": raw_field, "raw_value": raw_value,
                "source_type": source_type, "source_ref": source_ref,
                "applicable_experiment": "imagenet_90ep", "confidence": 0.9})
        await benchmark_service.add_verification(
            db, lead, c1["id"], "execution",
            {"gpu": "8×V100", "python_version": "3.8.10", "pytorch_version": "1.8.0",
             "cuda_version": "11.1", "operating_system": "Ubuntu 20.04", "mixed_precision": "AMP"},
            "pass", "8 卡复现 top1=76.03%，与论文 10-crop 76.1% 在 0.1pp 内一致。", project_id=proj.id)
        await benchmark_service.add_verification(
            db, reviewer, c1["id"], "review", None, "pass",
            "独立复核：评估协议（10-crop）与论文一致，证据链完整。", project_id=proj.id)

        c2 = await make_case(
            "ViT-B/16 ImageNet top-1 81.8%（300 epochs）",
            doi="10.48550/arXiv.2010.11929", source_url="https://arxiv.org/abs/2010.11929",
            domain="computer_vision", research_task="image_classification",
            model_architecture="ViT-B/16", dataset_name="ImageNet-1k",
            code_repo_url="https://github.com/google-research/vision_transformer",
            code_commit="9f8e7d6c5b4a", license="Apache-2.0", is_public=True,
            summary="ViT-B/16 在 ImageNet-1k 上 300 epochs 的 top-1 81.8%。")
        for raw_field, raw_value in [("learning_rate", "3e-3"), ("batch_size", "4096"),
                                     ("epochs", "300"), ("top1_accuracy", "81.8%")]:
            await benchmark_service.add_case_fact(db, lead, c2["id"], {
                "raw_field": raw_field, "raw_value": raw_value,
                "source_type": "paper", "source_ref": "Table 3", "confidence": 0.85})
        await benchmark_service.add_verification(
            db, lead, c2["id"], "execution",
            {"gpu": "8×A100", "pytorch_version": "1.10.0", "cuda_version": "11.3"},
            "pass", "复现 top1=81.6%，与论文差 0.2pp，环境已声明。", project_id=proj.id)

        c3 = await make_case(
            "BERT-base GLUE 平均 82.4（Fine-tuning）",
            doi="10.18653/v1/N19-1423", source_url="https://arxiv.org/abs/1810.04805",
            domain="nlp", research_task="language_understanding",
            model_architecture="BERT-base", dataset_name="GLUE",
            code_repo_url="https://github.com/google-research/bert", code_commit="3c2d1e0f",
            license="Apache-2.0",
            summary="BERT-base 在 GLUE 九任务平均 82.4；仅人工复核，未执行复现。")
        await benchmark_service.add_case_fact(db, lead, c3["id"], {
            "raw_field": "GLUE score", "raw_value": "82.4", "source_type": "paper",
            "source_ref": "Table 1", "confidence": 0.8})
        await benchmark_service.add_verification(
            db, reviewer, c3["id"], "review", None, "pass",
            "材料与结论审阅通过；尚未执行复现，等级停留在部分验证。", project_id=proj.id)

        c4 = await make_case(
            "ADM-Guided Diffusion ImageNet 256×256 FID 3.17",
            doi="10.48550/arXiv.2105.05233", source_url="https://arxiv.org/abs/2105.05233",
            domain="computer_vision", research_task="image_generation",
            model_architecture="ADM (guided diffusion)", dataset_name="ImageNet-256",
            code_repo_url="https://github.com/openai/guided-diffusion",
            license="MIT",
            summary="分类器引导扩散模型 FID 3.17；一次执行复现失败，等级保持未验证。")
        await benchmark_service.add_case_fact(db, lead, c4["id"], {
            "raw_field": "FID", "raw_value": "3.17", "source_type": "paper",
            "source_ref": "Table 2", "confidence": 0.75})
        await benchmark_service.add_verification(
            db, lead, c4["id"], "execution", {"gpu": "4×A100"}, "fail",
            "FID=4.02 与论文 3.17 差距超出容差；分类器权重版本不一致，待排查。", project_id=proj.id)

        # ---------- 审计规则 ----------
        await rule_service.seed_default_rules(db, lead)
        custom = await rule_service.create_rule(db, lead, {
            "rule_key": "accuracy_tolerance_0p1", "name": "准确率容差 0.1pp 校验",
            "domain": "计算机视觉",
            "description": "top-1/top-5 准确率按 0.1 个百分点绝对容差比对，超出即冲突。",
            "risk_level": "high", "evidence_requirement": "需论文表格与复现日志双侧证据。",
            "check_logic_json": {"type": "field_compare", "fields": ["top1_accuracy", "top5_accuracy"],
                                 "tolerance": 0.001, "severity": "high"},
            "change_note": "初始版本：0.1pp 容差",
            "test_samples": [
                {"label": "within_tolerance",
                 "input": {"a": {"top1_accuracy": "76.1%", "top5_accuracy": "92.9%"},
                           "b": {"top1_accuracy": "76.03%", "top5_accuracy": "92.9%"}},
                 "expected": {"status": "consistent", "conflict_fields": [], "missing_fields": []}},
                {"label": "beyond_tolerance",
                 "input": {"a": {"top1_accuracy": "76.1%", "top5_accuracy": "92.9%"},
                           "b": {"top1_accuracy": "75.3%", "top5_accuracy": "92.9%"}},
                 "expected": {"status": "conflict", "conflict_fields": ["top1_accuracy"], "missing_fields": []}},
                {"label": "top5_beyond_tolerance",
                 "input": {"a": {"top1_accuracy": "76.1%", "top5_accuracy": "92.9%"},
                           "b": {"top1_accuracy": "76.1%", "top5_accuracy": "92.2%"}},
                 "expected": {"status": "conflict", "conflict_fields": ["top5_accuracy"], "missing_fields": []}},
                {"label": "both_fields_within",
                 "input": {"a": {"top1_accuracy": "76.1%", "top5_accuracy": "92.9%"},
                           "b": {"top1_accuracy": "76.05%", "top5_accuracy": "92.85%"}},
                 "expected": {"status": "consistent", "conflict_fields": [], "missing_fields": []}},
                {"label": "missing_replica_side",
                 "input": {"a": {"top1_accuracy": "76.1%", "top5_accuracy": "92.9%"}, "b": {}},
                 "expected": {"status": "missing", "conflict_fields": [],
                              "missing_fields": ["top1_accuracy", "top5_accuracy"]}},
            ],
        })
        await rule_service.create_version(db, lead, custom["id"],
                                          {"type": "field_compare", "fields": ["top1_accuracy", "top5_accuracy"],
                                           "tolerance": 0.002, "severity": "high"},
                                          "放宽容差至 0.2pp 以减少评估协议差异导致的误报",
                                          [{"label": "protocol_gap_now_consistent",
                                            "input": {"a": {"top1_accuracy": "76.1%", "top5_accuracy": "92.9%"},
                                                      "b": {"top1_accuracy": "75.95%", "top5_accuracy": "92.9%"}},
                                            "expected": {"status": "consistent", "conflict_fields": [], "missing_fields": []}},
                                           {"label": "top5_beyond_tolerance",
                                            "input": {"a": {"top1_accuracy": "76.1%", "top5_accuracy": "92.9%"},
                                                      "b": {"top1_accuracy": "76.1%", "top5_accuracy": "92.2%"}},
                                            "expected": {"status": "conflict", "conflict_fields": ["top5_accuracy"], "missing_fields": []}},
                                           {"label": "both_fields_within",
                                            "input": {"a": {"top1_accuracy": "76.1%", "top5_accuracy": "92.9%"},
                                                      "b": {"top1_accuracy": "76.05%", "top5_accuracy": "92.85%"}},
                                            "expected": {"status": "consistent", "conflict_fields": [], "missing_fields": []}},
                                           {"label": "missing_replica_side",
                                            "input": {"a": {"top1_accuracy": "76.1%", "top5_accuracy": "92.9%"}, "b": {}},
                                            "expected": {"status": "missing", "conflict_fields": [],
                                                         "missing_fields": ["top1_accuracy", "top5_accuracy"]}}])
        await rule_service.run_rule_tests(db, lead, custom["id"])
        eval_samples = [
            {"label": "within_0p07",
             "input": {"a": {"top1_accuracy": "76.1%", "top5_accuracy": "92.9%"},
                       "b": {"top1_accuracy": "76.03%", "top5_accuracy": "92.9%"}},
             "expected": {"status": "consistent", "conflict_fields": [], "missing_fields": []}},
            {"label": "beyond_0p8",
             "input": {"a": {"top1_accuracy": "76.1%", "top5_accuracy": "92.9%"},
                       "b": {"top1_accuracy": "75.3%", "top5_accuracy": "92.9%"}},
             "expected": {"status": "conflict", "conflict_fields": ["top1_accuracy"], "missing_fields": []}},
            {"label": "protocol_gap_0p15",
             "input": {"a": {"top1_accuracy": "81.8%", "top5_accuracy": "95.0%"},
                       "b": {"top1_accuracy": "81.65%", "top5_accuracy": "95.0%"}},
             "expected": {"status": "consistent", "conflict_fields": [], "missing_fields": []}},
            {"label": "top5_within_0p02",
             "input": {"a": {"top1_accuracy": "76.1%", "top5_accuracy": "92.9%"},
                       "b": {"top1_accuracy": "76.1%", "top5_accuracy": "92.88%"}},
             "expected": {"status": "consistent", "conflict_fields": [], "missing_fields": []}},
        ]
        await rule_eval.evaluate_rule(db, lead, custom["id"], "demo://imagenet-accuracy-4", eval_samples, 1)

        # ---------- 反馈 / 评论 / 复核 ----------
        fb1 = await feedback_service.create_feedback(
            db, researcher, proj.id, str(f1.id), "false_positive",
            "0.07pp 差异来自单 crop 与 10-crop 协议不同，不应判为冲突。", "notebook:cell3", None)
        await feedback_service.triage_feedback(db, reviewer, fb1["id"], "disputed",
                                               "评估协议差异需人工复核确认，暂不改动规则。")
        fb2 = await feedback_service.create_feedback(
            db, reviewer, proj.id, str(f2.id), "confirm", "随机种子缺失属实，已要求补充。", "", None)
        await feedback_service.triage_feedback(db, reviewer, fb2["id"], "triaged", "转交研究员补充 seed 声明。")
        fb3 = await feedback_service.create_feedback(
            db, lead, proj.id, None, "supplement", "补充 10-crop 评估脚本与日志。", "storage://eval_10crop.log", None)
        await feedback_service.triage_feedback(db, lead, fb3["id"], "resolved", "证据已归档，差异解释成立。")

        await collab_service.create_comment(db, researcher, proj.id, "finding", str(f1.id),
                                            "建议先核对评估 crop 数；论文表 3 是 10-crop，我们日志是单 crop。")
        await collab_service.create_comment(db, lead, proj.id, "material", nb_material.id,
                                            "cell 3 的 stdout 请保留原始日志，不要手工改写数值。")
        await collab_service.create_comment(db, reviewer, proj.id, "finding", str(f2.id),
                                            "请在 Notebook 顶部固定 torch/numpy/random 三处种子。")
        rev1 = await collab_service.create_review(db, researcher, proj.id, "finding", str(f1.id), reviewer.id)
        await collab_service.decide_review(db, reviewer, rev1["id"], "changes_requested",
                                           "补充 10-crop 对照实验后再提交裁定。")
        rev2 = await collab_service.create_review(db, lead, proj.id, "finding", str(f2.id), reviewer.id)
        await collab_service.decide_review(db, reviewer, rev2["id"], "approved",
                                           "种子缺失证据充分，同意列入整改清单。")

        # ---------- RAG 知识文档 ----------
        for source_type, title, content, source_ref in [
            ("repro_method", "ImageNet 复现评估协议核对清单",
             "复现 ImageNet 结果前必须核对：crop 数（单 crop/10-crop）、resize 短边尺寸、center crop 比例、"
             "验证集版本（val 50k）。论文表 3 的 76.1% 为 10-crop 协议，单 crop 约 75.3%。", "method://imagenet-eval"),
            ("env_config", "PyTorch 1.8 + CUDA 11.1 复现环境基线",
             "推荐环境：Ubuntu 20.04 / Python 3.8.10 / PyTorch 1.8.0 / CUDA 11.1 / cuDNN 8.0.5，"
             "8×V100 32GB，AMP 混合精度。torchvision 0.9.0 的 ResNet 实现与论文一致。", "env://pytorch18-v100"),
            ("audit_rule", "准确率比对容差约定",
             "top-1/top-5 准确率默认绝对容差 0.1pp；评估协议不同（crop 数/插值方式）时先对齐协议再比对，"
             "不得直接放宽容差掩盖协议差异。", "rule://accuracy-tolerance"),
            ("verified_case", "ResNet-50 复现案例摘要",
             "历史案例：ResNet-50 90 epochs top-1 76.03%（单 crop）/76.1%（10-crop），"
             "环境 8×V100 + PyTorch 1.8.0，已独立复核。仅供参考，不得覆盖当前论文事实。", "case://resnet50"),
            ("failure_diagnosis", "扩散模型 FID 偏高的常见原因",
             "FID 复现偏高常见原因：分类器权重版本不一致、采样步数不足、EMA 权重未启用、"
             "参考统计量（reference batch）不同。逐项排查后再下结论。", "diag://fid-gap"),
        ]:
            await rag_service.add_document(db, lead, source_type, source_ref, title, content, True)

        # ---------- 仓库连接 / 演示快照 ----------
        conn = await repository_service.connect_repository(db, lead, {
            "provider": "github", "account_label": "reprocheck-lab（演示）", "auth_type": "pat",
            "token": "", "org_id": org_id, "repo_allowlist": ["reprocheck-lab/resnet50-repro"]}, "seed-demo")
        demo_snap = RepositorySnapshot(
            id=new_id("snap"), connection_id=conn["connection_id"], project_id=proj.id,
            repo_full_name="reprocheck-lab/resnet50-repro", default_branch="main",
            commit_sha="9f3c2ab7d1e84f60b5a2c9e07d4f1836a2b5c9de", tag="v0.9.0", branch="main",
            version_diff_json=json.dumps({
                "status": "synced",
                "message": "演示种子快照（非实时拉取）：用于展示同步结果视图。",
            }, ensure_ascii=False))
        db.add(demo_snap)
        await record_trail(db, action="integration.sync", actor_user_id=lead.id, org_id=org_id,
                           target_type="repository_snapshot", target_id=demo_snap.id,
                           after={"repo": demo_snap.repo_full_name, "commit_sha": demo_snap.commit_sha},
                           summary="同步仓库快照（演示种子）")
        await db.commit()

        # ---------- API Token / 调用日志 ----------
        from app.services import api_token_service
        token_view = await api_token_service.create_token(db, lead, {
            "name": "CI 流水线（演示）", "scopes": ["project.read", "audit.read", "repro.read"],
            "rate_limit_per_min": 120, "org_id": org_id}, "seed-demo")
        # 明文令牌仅创建时返回一次；种子直接丢弃，不在任何输出中保留。
        token_view.pop("token", None)
        now = datetime.now(timezone.utc)
        for i, (endpoint, method, status, dur) in enumerate([
            ("/api/open/v1/projects", "GET", 200, 38),
            ("/api/open/v1/audits", "POST", 200, 214),
            ("/api/open/v1/reproductions", "GET", 200, 52),
            ("/api/open/v1/projects", "GET", 429, 6),
        ]):
            db.add(ApiCallLog(id=new_id("apilog"), token_id=token_view["token_id"], endpoint=endpoint,
                              method=method, status_code=status, duration_ms=dur,
                              ip_hash="demo-seed", created_at=now - timedelta(minutes=12 * (4 - i))))
        from app.models.stage6 import ApiToken
        trow = (await db.execute(select(ApiToken).where(ApiToken.id == token_view["token_id"]))).scalar_one()
        trow.last_used_at = now - timedelta(minutes=2)
        await db.commit()

        # ---------- 治理：AI 授权 / 数据导出 ----------
        await governance_service.grant_ai_consent(db, lead, {
            "project_id": proj.id, "allow_external_llm": True, "scope": "project"}, "seed-demo")
        await governance_service.request_export(db, lead, "seed-demo")

        print("演示数据种子完成：")
        print(f"  组织: {org['name']} ({org_id})")
        print(f"  项目: {proj.name} ({proj.id})")
        print(f"  案例: {c1['id']} / {c2['id']} / {c3['id']} / {c4['id']}")
        print(f"  登录: {LEAD_EMAIL} 等 4 个账户，密码 {DEMO_PASSWORD}")


if __name__ == "__main__":
    asyncio.run(seed())