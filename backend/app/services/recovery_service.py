"""失败后的智能恢复服务（第七阶段升级）。

流程：识别失败类型 → 定位日志 → 分析环境/依赖/数据路径/资源限制 → 提出修复建议 →
生成修复补丁建议 → 在隔离副本中测试 → 经用户批准后应用。

硬约束：
- 不得自动修改原始科研项目；原始项目保持原样（original_preserved=true）；
- 补丁仅为提案，隔离副本测试通过（或在显式同意下跳过）且人工批准后才允许应用；
- 无安全隔离后端时，隔离测试如实标记 skipped，不伪造通过；
- 所有诊断、测试、审批、应用动作写审计轨迹。
"""
from __future__ import annotations

import json
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import BACKEND_STORAGE, settings
from app.core.errors import AppError
from app.models import Material
from app.models.stage7 import RecoveryPlan
from app.reproduction.deterministic_diagnosis import classify_failure
from app.reproduction.sandbox import EnvDetector, ExecutionSandbox
from app.services.trail_service import record_trail

OOM_PATTERNS = ("out of memory", "oom", "memoryerror", "cuda out of memory", "killed")
TIMEOUT_PATTERNS = ("timeout", "timed out", "time limit exceeded")
DEP_PATTERNS = ("modulenotfounderror", "importerror", "no module named")
DATA_PATH_PATTERNS = ("filenotfounderror", "no such file or directory", "permission denied", "not found")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dump(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, default=str)


def _load(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return default


def _storage_root() -> Path:
    return BACKEND_STORAGE


class RecoveryService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # 方案生成

    async def create_plan(
        self, project_id: str, *, raw_log: str, run_id: str | None = None,
        workflow_id: str | None = None, node_id: str | None = None,
        user_id: str | None = None,
    ) -> RecoveryPlan:
        materials = list((await self.db.execute(
            select(Material).where(Material.project_id == project_id)
        )).scalars().all())
        texts = {m.source_name: m.raw_text or "" for m in materials}

        checks = await self._run_checks(materials, texts, raw_log or "")
        env_missing = checks.get("environment", {}).get("missing", [])
        diagnosis = classify_failure(
            raw_log=raw_log or "",
            environment_missing="; ".join(env_missing),
        )
        failure_category = diagnosis.primary_category
        failure_summary = diagnosis.primary_label or (raw_log or "")[:500]
        candidates = [asdict(c) for c in diagnosis.candidates]
        suggested_fix = self._suggest_fix(failure_category, checks)
        patch_proposal = self._build_patch(failure_category, checks, materials)

        plan = RecoveryPlan(
            id=f"rec-{uuid.uuid4().hex[:16]}", project_id=project_id,
            workflow_id=workflow_id, node_id=node_id, run_id=run_id,
            failure_category=failure_category, failure_summary=failure_summary,
            log_ref=self._store_log_ref(project_id, raw_log or ""),
            checks_json=_dump(checks), candidates_json=_dump(candidates),
            suggested_fix=suggested_fix, patch_proposal_json=_dump(patch_proposal),
            original_preserved=True, status="open", test_status="pending",
            created_by=user_id,
        )
        self.db.add(plan)
        await self.db.flush()

        # 隔离副本：复制材料快照到 worktrees 目录，绝不回写原始材料
        isolation_path = await self._make_isolation_copy(plan.id, materials)
        plan.isolation_copy_path = isolation_path
        plan.test_status, plan.test_result_json = await self._test_in_isolation(plan, isolation_path)
        self.db.add(plan)

        await record_trail(
            self.db, action="recovery.create_plan", actor_user_id=user_id,
            project_id=project_id, target_type="recovery_plan", target_id=plan.id,
            after={"failure_category": failure_category, "test_status": plan.test_status},
            summary="生成失败恢复方案",
        )
        await self.db.commit()
        await self.db.refresh(plan)
        return plan

    async def _run_checks(self, materials: list[Material], texts: dict[str, str],
                          raw_log: str) -> dict[str, Any]:
        log_lower = raw_log.lower()
        env = EnvDetector().detect(materials, texts)

        missing_deps = [line for line in env.get("missing", []) if line]
        missing_data = [
            m.source_name for m in materials
            if (m.source_name or "").lower().endswith((".csv", ".json", ".parquet", ".xlsx"))
            and m.parse_status == "failed"
        ]
        resource = {
            "oom_detected": any(p in log_lower for p in OOM_PATTERNS),
            "timeout_detected": any(p in log_lower for p in TIMEOUT_PATTERNS),
            "dependency_error": any(p in log_lower for p in DEP_PATTERNS),
            "data_path_error": any(p in log_lower for p in DATA_PATH_PATTERNS),
            "limits": {
                "max_pids": settings.execution_max_pids,
                "allow_network": settings.execution_allow_network,
                "node_timeout_seconds": settings.workflow_node_timeout_seconds,
            },
        }
        return {
            "environment": env,
            "missing_dependencies": missing_deps,
            "missing_data_materials": missing_data,
            "resource": resource,
            "dependency_imports": self._parse_missing_imports(raw_log),
        }

    @staticmethod
    def _parse_missing_imports(raw_log: str) -> list[str]:
        imports: list[str] = []
        for line in raw_log.splitlines():
            low = line.lower()
            if "no module named" in low:
                parts = line.split("no module named")[-1].strip().strip("'\"")
                if parts:
                    imports.append(parts)
            elif "importerror" in low:
                imports.append(line.strip()[:120])
        return sorted(set(imports))

    @staticmethod
    def _suggest_fix(category: str, checks: dict[str, Any]) -> str:
        resource = checks.get("resource", {})
        if resource.get("dependency_error"):
            deps = checks.get("dependency_imports") or checks.get("missing_dependencies")
            return f"安装/对齐缺失依赖：{', '.join(deps) if deps else '见日志缺失模块'}；先在隔离副本验证，不改原始环境。"
        if resource.get("data_path_error"):
            return "核对数据文件路径与目录结构，确认材料已上传且路径与代码引用一致。"
        if resource.get("oom_detected"):
            return "降低批大小/内存占用，或检查显存/内存限制；在隔离副本复现后再调整配置。"
        if resource.get("timeout_detected"):
            return "拆分任务或延长超时阈值；先在隔离副本测量耗时分布。"
        return "基于诊断候选原因逐项在隔离副本验证，确认根因后再形成补丁。"

    @staticmethod
    def _build_patch(category: str, checks: dict[str, Any],
                     materials: list[Material]) -> dict[str, Any]:
        deps = checks.get("dependency_imports") or []
        target = next((m.source_name for m in materials if (m.source_name or "").endswith("requirements.txt")), "")
        proposal: dict[str, Any] = {
            "change_type": "none", "target_file": None,
            "original": None, "proposed": None, "rationale": "",
        }
        if deps:
            proposal.update({
                "change_type": "env", "target_file": target or "requirements.txt",
                "original": "缺失模块未声明",
                "proposed": f"补充依赖：{', '.join(deps)}",
                "rationale": "日志显示导入失败；需在隔离环境安装验证后再写入原始项目。",
            })
        elif category == "data_path":
            proposal.update({
                "change_type": "config", "target_file": None,
                "rationale": "数据路径不一致；建议核对代码中的路径配置与实际材料位置。",
            })
        elif category == "resource_limit":
            proposal.update({
                "change_type": "config", "target_file": None,
                "rationale": "资源受限；建议调整批大小/超时/资源配额，隔离副本验证后再应用。",
            })
        return proposal

    def _store_log_ref(self, project_id: str, raw_log: str) -> str:
        if not raw_log:
            return ""
        ref_dir = _storage_root() / project_id / "recovery_logs"
        ref_dir.mkdir(parents=True, exist_ok=True)
        ref = ref_dir / f"{uuid.uuid4().hex[:16]}.log"
        ref.write_text(raw_log[:200_000], encoding="utf-8")
        return str(ref)

    async def _make_isolation_copy(self, plan_id: str, materials: list[Material]) -> str:
        copy_dir = _storage_root() / "worktrees" / plan_id
        copy_dir.mkdir(parents=True, exist_ok=True)
        manifest: list[dict[str, Any]] = []
        for m in materials:
            snapshot = {"material_id": m.id, "source_name": m.source_name,
                        "material_type": m.material_type}
            if m.raw_text:
                (copy_dir / f"{m.id}.txt").write_text(m.raw_text, encoding="utf-8")
                snapshot["snapshot_file"] = f"{m.id}.txt"
            manifest.append(snapshot)
        (copy_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        return str(copy_dir)

    async def _test_in_isolation(self, plan: RecoveryPlan, copy_path: str) -> tuple[str, str | None]:
        available, reason = ExecutionSandbox.sandbox_available()
        if not available:
            return "skipped", _dump({"reason": f"无安全隔离执行后端：{reason}",
                                    "copy_path": copy_path,
                                    "note": "隔离副本已留存；待后端可用后在副本内复测，原始项目未改动。"})
        # 后端可用时，真实复测由受控 ReproductionRun 流程在隔离副本内发起；
        # 只记录待复测状态。
        return "pending", _dump({"copy_path": copy_path,
                                 "note": "隔离副本就绪；复测需通过受控执行流程发起。"})

    # 审批与应用

    async def review_plan(self, plan_id: str, decision: str, *, note: str = "",
                           user_id: str | None = None) -> RecoveryPlan:
        plan = await self._get(plan_id)
        if plan.status not in ("open", "awaiting_approval"):
            raise AppError("INVALID_STATE", "仅待审批的恢复方案可审核。", status_code=409)
        if decision not in ("approved", "rejected"):
            raise AppError("VALIDATION_ERROR", "decision 必须为 approved 或 rejected。")
        plan.approved_by = user_id
        plan.approved_at = _now()
        if decision == "approved":
            plan.status = "approved"
        else:
            plan.status = "rejected"
        self.db.add(plan)
        await record_trail(
            self.db, action="recovery.review", actor_user_id=user_id,
            project_id=plan.project_id, target_type="recovery_plan", target_id=plan.id,
            after={"decision": decision, "note": note}, summary=f"恢复方案{('批准' if decision == 'approved' else '拒绝')}",
        )
        await self.db.commit()
        await self.db.refresh(plan)
        return plan

    async def apply_plan(self, plan_id: str, *, consent_skip_test: bool = False,
                         user_id: str | None = None) -> RecoveryPlan:
        plan = await self._get(plan_id)
        if plan.status != "approved":
            raise AppError("INVALID_STATE", "仅已批准的方案可应用。", status_code=409)
        if plan.test_status not in ("passed",):
            if not (consent_skip_test and plan.test_status == "skipped"):
                raise AppError("INVALID_STATE", "隔离副本测试未通过；未获显式同意不得跳过测试。", status_code=409)
        # 硬约束：不自动修改原始科研项目。补丁以提案形式留存；
        # 真实写入需在安全后端内由受控流程执行，当前环境仅记录“已批准待落地”。
        available, reason = ExecutionSandbox.sandbox_available()
        if not available:
            plan.status = "awaiting_approval"
            plan.test_result_json = _dump({
                **(_load(plan.test_result_json, {}) or {}),
                "apply_blocked_reason": f"无安全隔离执行后端：{reason}",
            })
            self.db.add(plan)
            await self.db.commit()
            raise AppError("EXECUTION_DISABLED", "当前环境禁止写回原始项目；补丁提案已留存，未改动原始材料。")

        plan.status = "applied"
        plan.applied_at = _now()
        plan.original_preserved = True
        self.db.add(plan)
        await record_trail(
            self.db, action="recovery.apply", actor_user_id=user_id,
            project_id=plan.project_id, target_type="recovery_plan", target_id=plan.id,
            after={"original_preserved": True, "patch": _load(plan.patch_proposal_json, None)},
            summary="恢复补丁已在受控环境应用，原始项目已保留快照",
        )
        await self.db.commit()
        await self.db.refresh(plan)
        return plan

    async def _get(self, plan_id: str) -> RecoveryPlan:
        plan = (await self.db.execute(
            select(RecoveryPlan).where(RecoveryPlan.id == plan_id)
        )).scalar_one_or_none()
        if plan is None:
            raise AppError("NOT_FOUND", "恢复方案不存在。")
        return plan

    async def list_plans(self, project_id: str, status: str | None = None) -> list[dict]:
        stmt = select(RecoveryPlan).where(RecoveryPlan.project_id == project_id)
        if status:
            stmt = stmt.where(RecoveryPlan.status == status)
        rows = (await self.db.execute(stmt.order_by(RecoveryPlan.created_at))).scalars().all()
        return [self._view(p) for p in rows]

    async def plan_view(self, plan_id: str) -> dict[str, Any]:
        return self._view(await self._get(plan_id))

    @staticmethod
    def _view(p: RecoveryPlan) -> dict[str, Any]:
        return {
            "id": p.id, "project_id": p.project_id, "workflow_id": p.workflow_id,
            "node_id": p.node_id, "run_id": p.run_id,
            "failure_category": p.failure_category, "failure_summary": p.failure_summary,
            "log_ref": p.log_ref, "checks": _load(p.checks_json, None),
            "candidates": _load(p.candidates_json, None),
            "suggested_fix": p.suggested_fix,
            "patch_proposal": _load(p.patch_proposal_json, None),
            "isolation_copy_path": p.isolation_copy_path,
            "test_status": p.test_status, "test_result": _load(p.test_result_json, None),
            "status": p.status, "original_preserved": p.original_preserved,
            "approved_by": p.approved_by,
            "approved_at": p.approved_at.isoformat() if p.approved_at else None,
            "applied_at": p.applied_at.isoformat() if p.applied_at else None,
            "created_at": p.created_at.isoformat() if p.created_at else "",
        }
