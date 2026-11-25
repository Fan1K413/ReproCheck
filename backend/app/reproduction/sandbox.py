"""安全预检与受控执行服务（第四阶段·技术风险最高模块）。

核心原则：
- 绝对禁止在 FastAPI 应用服务器上直接执行用户上传代码；
- 无 Rootless Docker/gVisor/Firecracker 时完全禁用执行，只提供静态检查与环境分析；
- 安全阻断由程序规则决定，AI 不参与阻断判定；
- 静态扫描降低风险但不保证绝对安全。
"""
from __future__ import annotations

import json
import re
import uuid
import zipfile
from asyncio import to_thread
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError
from app.models import Material
from app.models.stage4 import ExecutionEnvironment, ReproductionRun
from app.parsers.limits import MAX_SINGLE_FILE_BYTES, MAX_ZIP_ENTRIES, MAX_ZIP_TOTAL_UNCOMPRESSED, ParserError
from app.services.material_service import MaterialService

# 安全扫描规则（程序规则，不由 AI 决定阻断）
DANGEROUS_PATTERNS: list[tuple[str, str]] = [
    (r"\bos\.system\s*\(", "调用系统命令"),
    (r"\bsubprocess\.(Popen|call|run|check_output)\s*\(", "子进程执行"),
    (r"\beval\s*\(|\bexec\s*\(", "动态代码执行"),
    (r"\b__import__\s*\(", "动态导入"),
    (r"rm\s+-rf|del\s+/[fF]|[Ss][Hh][Uu][Tt][Dd][Oo][Ww][Nn]", "危险文件操作"),
    (r"chmod\s+777|chown\s+root", "权限提升至全局可写"),
    (r"curl[^\n]*\|\s*(ba)?sh|wget[^\n]*\|\s*(ba)?sh", "下载并执行脚本"),
    (r"(169\.254\.169\.254|metadata\.google\.internal)", "访问云元数据地址"),
    (r"(requests|urllib|http\.client)\.(get|post)\s*\(\s*['\"]https?://", "发起网络请求"),
    (r"--privileged|--no-sandbox|--disable-security", "容器安全选项被禁用"),
    (r"\bpickle\.load\s*\(|\btorch\.load\s*\([^)]*weights_only\s*=\s*False", "不安全反序列化"),
]
# 内部/元数据网络：含云元数据 169.254.169.254（关键防护）、loopback 与私有网段
NETWORK_HOST_PATTERN = re.compile(
    r"https?://(169\.254\.169\.254|metadata\.google\.internal|127\.0\.0\.1|localhost|"
    r"0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)"
)

ENV_FILE_HINTS = {
    "requirements.txt": "requirements",
    "pyproject.toml": "pyproject",
    "poetry.lock": "poetry_lock",
    "pipfile": "pipfile",
    "environment.yml": "conda_env",
    "conda-lock.yml": "conda_lock",
    "dockerfile": "dockerfile",
    "docker-compose.yml": "docker_compose",
    "setup.py": "setup_py",
    "setup.cfg": "setup_cfg",
}

_TEXT_SUFFIXES = {
    ".py", ".ipynb", ".sh", ".ps1", ".cmd", ".bat", ".r", ".jl", ".js", ".ts",
    ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".txt", ".md", ".markdown",
    ".requirements",
}

def _source_text(data: bytes, name: str) -> str:
    text = data.decode("utf-8-sig", errors="replace")
    if name.lower().endswith(".ipynb"):
        notebook = json.loads(text)
        if not isinstance(notebook, dict) or not isinstance(notebook.get("cells"), list):
            raise ValueError("Notebook 格式无效。")
        code = []
        for cell in notebook["cells"]:
            if not isinstance(cell, dict):
                raise ValueError("Notebook 单元格格式无效。")
            if cell.get("cell_type") == "code":
                code.append("".join(cell.get("source") or ""))
        return "\n".join(code)
    return text


def _stored_texts(path: Path, name: str):
    if path.stat().st_size > MAX_SINGLE_FILE_BYTES:
        raise ValueError("材料超过预检大小限制。")
    if path.suffix.lower() != ".zip":
        yield name, _source_text(path.read_bytes(), name)
        return
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_ZIP_ENTRIES or sum(e.file_size for e in entries) > MAX_ZIP_TOTAL_UNCOMPRESSED:
            raise ValueError("压缩包超过安全预检限制。")
        for entry in entries:
            inner = Path(entry.filename)
            if entry.is_dir() or (
                inner.suffix.lower() not in _TEXT_SUFFIXES and inner.name.lower() not in ENV_FILE_HINTS
            ):
                continue
            if entry.file_size > MAX_SINGLE_FILE_BYTES:
                raise ValueError("压缩包中的源文件超过预检大小限制。")
            with archive.open(entry) as member:
                data = member.read(MAX_SINGLE_FILE_BYTES + 1)
            if len(data) > MAX_SINGLE_FILE_BYTES:
                raise ValueError("压缩包中的源文件超过预检大小限制。")
            yield f"{name}/{entry.filename}", _source_text(data, entry.filename)


def _scan_stored(preflight: SecurityPreflight, path: Path, name: str):
    findings = []
    samples = {}
    sample_chars = 0
    for source, text in _stored_texts(path, name):
        findings.extend(preflight.scan_text(text, source))
        sample = text[:min(8192, max(0, 262144 - sample_chars))]
        if sample:
            samples[source] = sample
            sample_chars += len(sample)
    return findings, samples


class SecurityPreflight:
    """静态安全预检：返回结构化 findings，阻断由程序规则决定。"""

    def scan_text(self, text: str, source: str) -> list[dict[str, Any]]:
        findings: list[dict[str, Any]] = []
        for pattern, reason in DANGEROUS_PATTERNS:
            m = re.search(pattern, text, re.IGNORECASE)
            if m:
                line = text[:m.start()].count("\n") + 1
                findings.append({
                    "code": "DANGEROUS_PATTERN", "source": source, "line": line,
                    "reason": reason, "matched": m.group(0)[:80],
                    "severity": "high",
                })
        for m in NETWORK_HOST_PATTERN.finditer(text):
            findings.append({
                "code": "INTERNAL_NETWORK_ACCESS", "source": source,
                "line": text[:m.start()].count("\n") + 1,
                "reason": "访问宿主机内部/私有网络地址", "matched": m.group(0)[:80],
                "severity": "high",
            })
        return findings

    def scan_material(self, material: Material, text: str) -> list[dict[str, Any]]:
        return self.scan_text(text, material.source_name)

    @staticmethod
    def decide(findings: list[dict[str, Any]]) -> tuple[bool, str]:
        """返回 (passed, reason)。存在 high 级别即阻断。"""
        highs = [f for f in findings if f.get("severity") == "high"]
        if highs:
            reasons = "；".join(f"{f['source']}:{f['reason']}" for f in highs[:3])
            return False, f"静态安全预检发现 {len(highs)} 项高风险操作，已阻断执行：{reasons}"
        return True, "静态安全预检通过（注意：静态扫描不能保证绝对安全）"


class EnvDetector:
    """科研代码环境检测器：识别常见依赖声明与硬件要求，不执行任何命令。"""

    def detect(self, materials: list[Material], texts: dict[str, str]) -> dict[str, Any]:
        found: list[dict[str, str]] = []
        all_text = "\n".join(texts.values())
        for name, kind in ENV_FILE_HINTS.items():
            if any(name.lower() in (m.source_name or "").lower() for m in materials):
                found.append({"file": name, "kind": kind, "source": "material_list"})
        version_patterns = [
            (r"python[=><~ ]+(3\.\d+(?:\.\d+)?)", "python_version"),
            (r"torch[=><~ ]+([\d.]+)", "pytorch"),
            (r"tensorflow[=><~ ]+([\d.]+)", "tensorflow"),
            (r"cuda[=><~ ]*([\d.]+)", "cuda"),
            (r"numpy[=><~ ]+([\d.]+)", "numpy"),
        ]
        frameworks: dict[str, str] = {}
        for pattern, key in version_patterns:
            m = re.search(pattern, all_text, re.IGNORECASE)
            if m:
                frameworks[key] = m.group(1)
        hardware: dict[str, Any] = {}
        if re.search(r"\bcuda\b|gpu|nvidia", all_text, re.IGNORECASE):
            hardware["gpu_required"] = True
        if re.search(r"\b(\d+)\s*gb\b.*(memory|ram|显存)", all_text, re.IGNORECASE):
            m = re.search(r"(\d+)\s*gb", all_text, re.IGNORECASE)
            if m:
                hardware["min_memory_gb"] = int(m.group(1))
        entrypoints = [m.source_name for m in materials
                       if (m.source_name or "").lower() in ("train.py", "main.py", "run.py")]
        missing = []
        if not any(f["kind"] in ("requirements", "pyproject", "conda_env") for f in found):
            missing.append("未发现依赖声明文件（requirements.txt/pyproject.toml/environment.yml）")
        if not entrypoints:
            missing.append("未发现明确训练入口（train.py/main.py/run.py）")
        warnings = []
        if frameworks.get("cuda") and not hardware.get("gpu_required"):
            warnings.append("依赖声明含 CUDA，但材料未明确标注 GPU 要求")
        return {
            "dependency_files": found,
            "python_version": frameworks.get("python_version"),
            "frameworks": frameworks,
            "hardware_requirements": hardware,
            "entrypoints": entrypoints,
            "missing": missing,
            "warnings": warnings,
        }


class ExecutionSandbox:
    """受控执行接口。当前环境无安全容器时完全禁用执行。"""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.preflight = SecurityPreflight()
        self.detector = EnvDetector()

    @staticmethod
    def sandbox_available() -> tuple[bool, str]:
        """实际检测：是否有可用的安全隔离后端。"""
        if not settings.enable_code_execution:
            return False, "ENABLE_CODE_EXECUTION=false：代码执行已被显式禁用"
        if settings.execution_backend not in ("rootless_docker", "gvisor"):
            return False, (
                f"当前执行后端为 {settings.execution_backend}，无 Rootless Docker/gVisor/Firecracker，"
                "无法保证安全隔离，禁止执行用户代码"
            )
        return False, "当前部署环境未提供已验证的安全隔离执行后端，执行保持禁用"

    async def create_run(
        self, *, plan_id: str, project_id: str, task_ids: list[str], requested_by: str
    ) -> ReproductionRun:
        materials = (await self.db.execute(
            select(Material).where(Material.project_id == project_id)
        )).scalars().all()
        texts: dict[str, str] = {}
        findings: list[dict[str, Any]] = []
        material_service = MaterialService(self.db)
        for m in materials:
            suffix = Path(m.source_name or "").suffix.lower()
            if m.stored_path and suffix in _TEXT_SUFFIXES | {".zip"}:
                try:
                    path = await material_service.path_of(m)
                    scanned, samples = await to_thread(_scan_stored, self.preflight, path, m.source_name)
                    findings.extend(scanned)
                    texts.update(samples)
                except (AppError, ParserError, OSError, ValueError, TypeError, RuntimeError, zipfile.BadZipFile):
                    findings.append({
                        "code": "MATERIAL_NOT_SCANNED", "source": m.source_name,
                        "reason": "无法完整读取材料进行安全预检", "severity": "high",
                    })
            elif m.raw_text:
                texts[m.source_name] = m.raw_text
                findings.extend(self.preflight.scan_material(m, m.raw_text))

        env_info = self.detector.detect(materials, texts)
        env = ExecutionEnvironment(
            id=f"env-{uuid.uuid4().hex[:14]}", project_id=project_id,
            python_version=env_info["python_version"],
            frameworks_json=json.dumps(env_info["frameworks"], ensure_ascii=False),
            dependencies_json=json.dumps(env_info["dependency_files"], ensure_ascii=False),
            hardware_json=json.dumps(env_info["hardware_requirements"], ensure_ascii=False),
            entrypoints_json=json.dumps(env_info["entrypoints"], ensure_ascii=False),
            missing_json=json.dumps(env_info["missing"], ensure_ascii=False),
            warnings_json=json.dumps(env_info["warnings"], ensure_ascii=False),
            changed_from_original_json="[]",
        )
        self.db.add(env)
        await self.db.flush()

        passed, reason = self.preflight.decide(findings)
        available, sandbox_reason = self.sandbox_available()
        execution_enabled = passed and available
        status = "blocked_no_sandbox" if not available else ("blocked_security" if not passed else "pending")
        error = None if execution_enabled else (sandbox_reason if not available else reason)

        run = ReproductionRun(
            id=f"rrun-{uuid.uuid4().hex[:14]}", project_id=project_id, plan_id=plan_id,
            task_ids_json=json.dumps(task_ids, ensure_ascii=False),
            status=status, execution_enabled=execution_enabled,
            security_check_json=json.dumps({
                "passed": passed, "reason": reason, "findings": findings[:50],
                "sandbox_available": available, "sandbox_reason": sandbox_reason,
                "checked_at": datetime.now(timezone.utc).isoformat(),
            }, ensure_ascii=False, default=str),
            environment_id=env.id, requested_by=requested_by, error_message=error,
        )
        self.db.add(run)
        await self.db.commit()
        return run

    async def cancel(self, run_id: str) -> dict:
        run = (await self.db.execute(
            select(ReproductionRun).where(ReproductionRun.id == run_id)
        )).scalar_one_or_none()
        if run is None:
            raise AppError("NOT_FOUND", "运行记录不存在。")
        if run.status in ("completed", "failed", "cancelled", "blocked_no_sandbox", "blocked_security"):
            return {"cancelled": False, "status": run.status, "reason": "任务未在运行中或已终态"}
        run.cancel_requested = True
        run.status = "cancelled"
        run.finished_at = datetime.now(timezone.utc)
        self.db.add(run)
        await self.db.commit()
        return {"cancelled": True, "status": "cancelled", "note": "已记录取消；无执行进程需要终止"}
