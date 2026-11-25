"""数据审计编排器：收集文件 → 只读解析 → 四类规则 → 汇总报告。

入口：
    run_data_audit(project_id=..., data_roots=[...], code_files=[...])
    run_audit_on_paths(paths=[...], ...)

安全约束（在本层统一落实）：
- 只读访问：全部读取经 readers 的只读 API，不写任何源文件；
- 资源上限：文件数 / 单文件字节 / 行数 / 采样数均从 readers 常量派生，可收窄不可放大超过上限；
- 无网络、无模型调用：纯本地确定性计算；
- 证据门：evidence 为空的 finding 一律丢弃，不发布无依据结论。
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.dataaudit import distribution as dist_mod
from app.dataaudit import integrity as int_mod
from app.dataaudit import leakage as leak_mod
from app.dataaudit import preprocessing as pre_mod
from app.dataaudit.readers import (
    MAX_FILES,
    MAX_FILE_BYTES,
    MAX_ROWS_PER_FILE,
    MAX_SAMPLE_ROWS,
    FileMeta,
    TableData,
    collect_files,
    is_missing,
    read_csv_streaming,
    read_jsonl_streaming,
)
from app.dataaudit.schema import RULE_CATALOG, AuditReport, Finding

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp", ".tif", ".tiff"}
MAX_IMAGE_FILES = 500
NUMERIC_RATIO = 0.9  # 采样值 ≥90% 可转数值 → 视为数值列


def _infer_numeric_columns(td: TableData) -> dict[str, str]:
    """按采样行推断每列类型（供 INT-006 类型污染检查使用）。"""
    out: dict[str, str] = {}
    if not td.rows:
        return out
    for col in td.columns:
        total = nums = 0
        for row in td.rows[:200]:
            v = row.get(col)
            if is_missing(v):
                continue
            total += 1
            try:
                float(str(v).strip())
                nums += 1
            except (ValueError, TypeError):
                pass
        if total and nums / total >= NUMERIC_RATIO:
            out[col] = "float" if any(
                "." in str(row.get(col, "")) for row in td.rows[:50]
            ) else "int"
    return out


def _load_tables(files: list[FileMeta], *, max_rows: int,
                 sample_rows: int,
                 aliases: dict[str, str] | None = None) -> dict[str, TableData]:
    """读取数据文件为 TableData。

    aliases: 存储文件名 → 原始文件名（如 mat-abc.csv → train.csv），
    用于在存储名被改写的场景下仍能识别数据划分。
    """
    tables: dict[str, TableData] = {}
    for m in files:
        if m.skipped or m.size == 0:
            continue
        # manifest / README 是元数据文件，不作为数据表解析
        if Path(m.path).name.lower() in (
            "manifest.json", "readme.md", "readme.txt", "dataset_card.md"
        ):
            continue
        p = Path(m.abs_path)
        if m.suffix in (".csv", ".tsv"):
            td = read_csv_streaming(
                p, max_rows=max_rows, sample_rows=sample_rows)
        elif m.suffix == ".jsonl":
            td = read_jsonl_streaming(
                p, max_rows=max_rows, sample_rows=sample_rows)
        elif m.suffix == ".json":
            td = _read_json_table(p, max_rows=max_rows, sample_rows=sample_rows)
        else:
            # .xlsx / .parquet：依赖可选库，由调用方通过项目解析管线覆盖，
            # 本引擎不强制引入第三方依赖
            continue
        if td is None:
            continue
        td.path = m.path
        if aliases:
            td.alias = aliases.get(m.path) or aliases.get(m.abs_path) or ""
        tables[m.path] = td
    return tables


def _read_json_table(path: Path, *, max_rows: int,
                     sample_rows: int) -> TableData | None:
    """JSON 数组文件 → TableData（容错，失败返回 None）。"""
    import json

    td = TableData(path=str(path))
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, json.JSONDecodeError, MemoryError):
        td.parse_error = "READ_ERROR:json"
        return td
    if not isinstance(data, list) or not data:
        td.parse_error = "EMPTY_FILE"
        return td
    rows = [r for r in data[:max_rows] if isinstance(r, dict)]
    keys: list[str] = []
    for r in rows:
        for k in r:
            if k not in keys:
                keys.append(k)
    td.columns = keys[:500]
    td.total_rows = len(rows)
    td.rows = rows[:sample_rows]
    return td


def _collect_images(roots: list[Path]) -> list[str]:
    out: list[str] = []
    for root in roots:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if len(out) >= MAX_IMAGE_FILES:
                return out
            if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES:
                out.append(str(p))
    return out


def _read_code_files(paths: list[str], *,
                     max_files: int = 30) -> list[tuple[str, str]]:
    """读取代码文件用于泄漏/预处理扫描（只读、限容）。"""
    out: list[tuple[str, str]] = []
    for p in paths[:max_files]:
        path = Path(p)
        if path.suffix.lower() not in (".py", ".ipynb", ".r", ".jl", ".yaml", ".yml"):
            continue
        try:
            if path.stat().st_size > 2_000_000:
                continue
            out.append((path.name, path.read_text(encoding="utf-8",
                                                  errors="replace")))
        except OSError:
            continue
    return out


def _build_rule_results(findings: list[Finding],
                        evaluated: set[str]) -> dict[str, str]:
    """rule_id -> pass / fail / skipped。"""
    by_rule: dict[str, list[Finding]] = {}
    for f in findings:
        by_rule.setdefault(f.rule_id, []).append(f)
    results: dict[str, str] = {}
    for rid in RULE_CATALOG:
        group = by_rule.get(rid, [])
        if any(f.severity == "unknown" for f in group) and \
                all(f.severity in ("unknown", "info") for f in group):
            results[rid] = "skipped"
        elif any(f.severity not in ("info", "unknown") for f in group):
            results[rid] = "fail"
        elif rid in evaluated or group:
            results[rid] = "pass"
        else:
            results[rid] = "skipped"
    return results


def run_data_audit(
    *,
    project_id: str,
    data_roots: list[str | Path],
    code_files: list[str] | None = None,
    paper_claims: dict[str, str] | None = None,
    file_aliases: dict[str, str] | None = None,
    max_files: int = MAX_FILES,
    max_file_bytes: int = MAX_FILE_BYTES,
    max_rows: int = MAX_ROWS_PER_FILE,
    sample_rows: int = MAX_SAMPLE_ROWS,
) -> AuditReport:
    """执行完整的数据质量审计，返回 AuditReport。

    data_roots: 数据集目录（只读）。
    code_files: 参与泄漏/预处理扫描的代码文件路径列表。
    paper_claims: 可选的论文描述（evidence.paper_description 关联用）。
    file_aliases: 存储文件名 → 原始文件名映射（上传场景下存储名被改写，
                  需借助原始名识别 train/test 划分与数据集版本）。
    """
    started = time.perf_counter()
    roots = [Path(r).resolve() for r in data_roots]
    max_files = min(max_files, MAX_FILES)
    max_file_bytes = min(max_file_bytes, MAX_FILE_BYTES)
    sample_rows = min(sample_rows, MAX_SAMPLE_ROWS)
    max_rows = min(max_rows, MAX_ROWS_PER_FILE)

    all_files: list[FileMeta] = []
    for root in roots:
        all_files.extend(collect_files(root, max_files=max_files))
    all_files = all_files[:max_files]

    tables = _load_tables(all_files, max_rows=max_rows,
                          sample_rows=sample_rows, aliases=file_aliases)
    images = _collect_images(roots)
    code = _read_code_files(code_files or [])

    findings: list[Finding] = []
    evaluated: set[str] = set()

    def run(fn, *args, **kwargs) -> None:
        """执行一个规则函数，隔离异常并登记已评估规则。"""
        try:
            result = fn(*args, **kwargs)
        except Exception:  # noqa: BLE001 — 单条规则失败不阻断整体审计
            return
        if isinstance(result, list):
            findings.extend(result)
            for f in result:
                evaluated.add(f.rule_id)

    # 1. 完整性
    run(int_mod.check_hashes, all_files, project_id=project_id)
    if roots:
        run(int_mod.check_manifest_missing, roots[0],
            {f.path for f in all_files})
    for td in tables.values():
        run(int_mod.check_format, td, all_files)
        run(int_mod.check_types, td, known_numeric=_infer_numeric_columns(td))
        run(int_mod.check_nulls, td)
        run(int_mod.check_outliers, td)
    if roots:
        v_findings, version, sources = int_mod.detect_version_and_source(
            all_files, roots[0], aliases=file_aliases)
        findings.extend(v_findings)
        for f in v_findings:
            evaluated.add(f.rule_id)
    else:
        version, sources = None, []

    # 2. 泄漏
    run(leak_mod.split_overlap_audit, tables)
    run(leak_mod.internal_duplicate_audit, tables)
    run(leak_mod.near_duplicate_audit, tables, images)
    run(leak_mod.temporal_leakage_audit, tables)
    run(leak_mod.label_leakage_audit, tables)
    run(leak_mod.code_leakage_scan, code)
    run(leak_mod.cv_split_audit, code, tables)

    # 3. 分布与统计
    run(dist_mod.class_balance_audit, tables)
    run(dist_mod.distribution_shift_audit, tables)
    run(dist_mod.split_proportion_audit, tables)
    run(dist_mod.dataset_scale_audit, tables)
    stats = dist_mod.collect_dataset_stats(tables)

    # 4. 预处理
    run(pre_mod.preprocessing_code_scan, code)
    run(pre_mod.train_test_preprocess_consistency, code, tables)
    run(pre_mod.missing_imputation_audit, tables, code)
    run(pre_mod.encoding_audit, tables, code)

    # 5. 论文描述关联（可选）
    if paper_claims:
        for f in findings:
            for e in f.evidence:
                claim = paper_claims.get(f.rule_id)
                if claim and not e.paper_description:
                    e.paper_description = claim

    # 证据门：无证据的发现不发布
    gated = [f for f in findings if f.evidence]
    dropped = len(findings) - len(gated)

    stats.update({
        "files_scanned": len(all_files),
        "images_scanned": len(images),
        "code_files_scanned": len(code),
        "dataset_version": version,
        "sources": sources[:10],
        "findings_dropped_no_evidence": dropped,
    })

    report = AuditReport(
        audit_id=uuid.uuid4().hex,
        project_id=project_id,
        created_at=datetime.now(timezone.utc).isoformat(),
        scope={
            "data_roots": [str(r) for r in roots],
            "code_files": len(code),
            "limits": {
                "max_files": max_files,
                "max_file_bytes": max_file_bytes,
                "max_rows": max_rows,
                "sample_rows": sample_rows,
            },
            "read_only": True,
            "external_calls": False,
        },
        findings=sorted(
            gated,
            key=lambda f: (["critical", "high", "medium", "low", "info",
                            "unknown"].index(f.severity)
                           if f.severity in ("critical", "high", "medium",
                                             "low", "info", "unknown") else 5,
                           f.rule_id),
        ),
        stats=stats,
        rule_results=_build_rule_results(gated, evaluated),
        duration_ms=int((time.perf_counter() - started) * 1000),
    )
    return report


def run_audit_on_paths(
    paths: list[str | Path],
    *,
    project_id: str,
    code_files: list[str] | None = None,
    **kwargs: Any,
) -> AuditReport:
    """对一组显式文件路径执行审计（自动推断共同根目录）。"""
    resolved = [Path(p).resolve() for p in paths]
    if not resolved:
        return run_data_audit(project_id=project_id, data_roots=[],
                              code_files=code_files, **kwargs)
    # 共同根：所有路径的公共父目录
    root = Path(resolved[0])
    for p in resolved[1:]:
        while root != root.parent and not _contains(root, p):
            root = root.parent
    return run_data_audit(project_id=project_id, data_roots=[root],
                          code_files=code_files, **kwargs)


def _contains(parent: Path, child: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False
