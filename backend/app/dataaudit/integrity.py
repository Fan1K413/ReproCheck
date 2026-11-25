"""数据集完整性审计（INT-001 ~ INT-011）。

全部为确定性计算：哈希、格式、字段、类型、空值、异常值、版本与来源。
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app.dataaudit.readers import (
    FileMeta,
    TableData,
    file_sha256_streaming,
    is_missing,
)
from app.dataaudit.schema import Evidence, Finding, get_rule

SOURCE_URL = re.compile(r"https?://[^\s\"'<>\)]+")
CLEAN_COL = re.compile(r"^[A-Za-z_][A-Za-z0-9_\s]*$")


def _f(rule_id: str, severity: str, message: str, *,
       evidence: list[Evidence], justification: str = "",
       confidence: str = "high", suggestion: str = "",
       affects: str = "") -> Finding:
    rule = get_rule(rule_id)
    return Finding(
        rule_id=rule_id, rule_name=rule.name, severity=severity,
        message=message, confidence=confidence, evidence=evidence,
        justification=justification, suggestion=suggestion, affects=affects,
    )


def check_hashes(files: list[FileMeta], *, project_id: str) -> list[Finding]:
    """INT-001 哈希缺失 + INT-002 内容重复（含同内容不同文件名）。"""
    out: list[Finding] = []
    by_hash: dict[str, list[FileMeta]] = {}
    for m in files:
        if m.skipped:
            continue
        if m.sha256 is None:
            try:
                m.sha256 = file_sha256_streaming(Path(m.abs_path))
            except OSError:
                out.append(_f(
                    "INT-009", "critical",
                    f"文件无法读取：{m.path}",
                    evidence=[Evidence(file_path=m.path, detail="读取失败（可能损坏或无权限）")],
                    justification="打开文件时抛出 OSError",
                ))
                continue
        by_hash.setdefault(m.sha256, []).append(m)

    for m in files:
        if m.skipped:
            out.append(_f(
                "INT-003", "high",
                f"文件被跳过（{m.skipped}）：{m.path}",
                evidence=[Evidence(file_path=m.path, detail=f"size={m.size}")],
                justification="超过审计资源上限，未纳入分析",
                suggestion="如需审计该文件，请提高 max_file_bytes 限额",
            ))
        elif m.size == 0:
            out.append(_f(
                "INT-003", "high",
                f"空文件（0 字节）：{m.path}",
                evidence=[Evidence(file_path=m.path, detail="size=0")],
                justification="声明的数据文件不包含任何内容",
                suggestion="重新导出或重新下载该数据文件",
            ))
        elif m.sha256:
            out.append(_f(
                "INT-001", "info",
                f"SHA256 已记录：{m.path}",
                evidence=[Evidence(file_path=m.path, detail=f"sha256={m.sha256[:16]}...")],
                justification="哈希可用于完整性验证与版本追溯",
                affects="",
            ))

    for digest, group in by_hash.items():
        if len(group) < 2:
            continue
        names = [g.path for g in group]
        # 同内容不同文件名 → 更强的泄漏信号
        basenames = {Path(n).name for n in names}
        rule = "LEAK-003" if len(basenames) > 1 else "INT-002"
        out.append(_f(
            rule, "medium" if rule == "INT-002" else "medium",
            f"内容完全相同的 {len(group)} 个文件：{', '.join(names)}",
            evidence=[Evidence(file_path=names[0],
                               detail=f"sha256={digest[:16]}... 同组: {', '.join(names[1:])}")],
            justification="SHA256 完全一致，字节级相同；"
                          + ("文件名不同，可能是数据划分时的副本泄漏"
                             if rule == "LEAK-003" else "重复副本"),
            suggestion="确认是否为冗余副本；若是不同划分中的同一文件，属于数据泄漏",
            confidence="high",
        ))
    return out


def check_format(table: TableData, files: list[FileMeta]) -> list[Finding]:
    """INT-004 格式错误 / INT-005 字段异常 / INT-009 损坏。"""
    out: list[Finding] = []
    if table.parse_error in ("ENCODING_ERROR",):
        out.append(_f(
            "INT-009", "critical",
            f"文件编码错误，疑似损坏：{Path(table.path).name}",
            evidence=[Evidence(file_path=table.path, detail=table.parse_error)],
            justification="无法按 UTF-8 解码",
        ))
    elif table.parse_error and table.parse_error.startswith("READ_ERROR"):
        out.append(_f(
            "INT-009", "critical",
            f"文件读取失败：{Path(table.path).name}",
            evidence=[Evidence(file_path=table.path, detail=table.parse_error)],
            justification="读取过程中抛出异常",
        ))
    elif table.parse_error == "EMPTY_FILE":
        out.append(_f(
            "INT-003", "high",
            f"数据文件为空：{Path(table.path).name}",
            evidence=[Evidence(file_path=table.path, detail="无表头/无记录")],
            justification="解析器读不到任何结构",
        ))
    elif table.parse_error and table.parse_error.startswith("TOO_MANY_COLUMNS"):
        out.append(_f(
            "INT-004", "high",
            f"列数异常（{table.parse_error}）：{Path(table.path).name}",
            evidence=[Evidence(file_path=table.path, detail=table.parse_error)],
            justification="超出单表合理列数上限，可能格式错误",
        ))

    if table.ragged_rows > 0:
        ratio = table.ragged_rows / max(table.total_rows, 1)
        sev = "high" if ratio > 0.01 else "medium"
        out.append(_f(
            "INT-004", sev,
            f"{table.ragged_rows} 行的列数与表头不一致"
            f"（{Path(table.path).name}，占 {ratio:.1%}）",
            evidence=[Evidence(file_path=table.path,
                               detail=f"ragged={table.ragged_rows}/{table.total_rows}")],
            justification="CSV 行结构不一致，通常是字段中含未转义分隔符或文件截断",
            suggestion="检查分隔符与引号转义；若为截断需重新导出",
            confidence="high" if ratio > 0.001 else "medium",
        ))

    # 字段检查
    seen: dict[str, int] = {}
    for col in table.columns:
        seen[col] = seen.get(col, 0) + 1
        if not col.strip():
            out.append(_f(
                "INT-005", "medium",
                f"存在空列名：{Path(table.path).name}",
                evidence=[Evidence(file_path=table.path, field="<empty>")],
                justification="表头包含空字符串",
            ))
        elif not CLEAN_COL.match(col):
            out.append(_f(
                "INT-005", "low",
                f"列名含特殊字符：'{col}'（{Path(table.path).name}）",
                evidence=[Evidence(file_path=table.path, field=col)],
                justification="列名不匹配常规标识符规则，可能影响下游代码引用",
            ))
    for col, cnt in seen.items():
        if cnt > 1:
            out.append(_f(
                "INT-005", "medium",
                f"重复列名 '{col}' ×{cnt}（{Path(table.path).name}）",
                evidence=[Evidence(file_path=table.path, field=col)],
                justification="同一表头出现多次，读取时会互相覆盖",
                suggestion="重命名重复列",
            ))
    return out


def check_types(table: TableData, *, known_numeric: dict[str, str]) -> list[Finding]:
    """INT-006 类型污染：按首行推断的类型检查采样行中的异常值。"""
    out: list[Finding] = []
    for col, typ in known_numeric.items():
        if col not in table.columns or typ not in ("int", "float"):
            continue
        bad: list[tuple[int, Any]] = []
        for idx, row in enumerate(table.rows):
            v = row.get(col)
            if is_missing(v):
                continue
            try:
                float(str(v).strip())
            except (ValueError, TypeError):
                bad.append((idx, v))
        if bad:
            sample = ", ".join(f"row#{i}={v!r}" for i, v in bad[:3])
            out.append(_f(
                "INT-006", "medium",
                f"数值列 '{col}' 混入 {len(bad)} 个非数值值（{Path(table.path).name}）",
                evidence=[Evidence(file_path=table.path, field=col,
                                   sample_id=f"row#{bad[0][0]}", detail=sample)],
                justification=f"列 '{col}' 大部分值可转为 {typ}，但存在无法转换的值",
                suggestion="确认是脏数据还是类型设计错误；必要时清洗",
                confidence="medium",
            ))
    return out


def check_nulls(table: TableData, *, threshold: float = 0.3) -> list[Finding]:
    """INT-007 空值率过高 + DIST-004 数据缺失严重。"""
    out: list[Finding] = []
    if not table.rows or not table.columns:
        return out
    n = len(table.rows)
    for col in table.columns:
        missing = sum(1 for r in table.rows if is_missing(r.get(col)))
        rate = missing / n
        if rate >= threshold:
            out.append(_f(
                "DIST-004", "medium" if rate < 0.6 else "high",
                f"字段 '{col}' 缺失率 {rate:.1%}（{missing}/{n}）：{Path(table.path).name}",
                evidence=[Evidence(file_path=table.path, field=col,
                                   detail=f"missing={missing}/{n}")],
                justification=f"采样 {n} 行中 {rate:.1%} 为空值标记",
                suggestion="确认缺失机制（MCAR/MAR/MNAR）并声明处理策略",
                confidence="medium",
            ))
        elif rate >= 0.1:
            out.append(_f(
                "INT-007", "low",
                f"字段 '{col}' 空值率 {rate:.1%}（{Path(table.path).name}）",
                evidence=[Evidence(file_path=table.path, field=col,
                                   detail=f"missing={missing}/{n}")],
                justification="空值率超过 10%",
                confidence="medium",
            ))
    return out


def check_outliers(table: TableData, *, iqr_k: float = 3.0) -> list[Finding]:
    """INT-008 / DIST-003 IQR 极端值（仅对数值列、基于采样）。"""
    out: list[Finding] = []
    for col in table.columns:
        vals: list[float] = []
        for row in table.rows:
            v = row.get(col)
            if is_missing(v):
                continue
            try:
                vals.append(float(str(v).strip()))
            except (ValueError, TypeError):
                continue
        if len(vals) < 20:
            continue
        vals.sort()
        n = len(vals)

        def q(p: float) -> float:
            return vals[min(n - 1, max(0, int(p * (n - 1))))]
        q1, q3 = q(0.25), q(0.75)
        iqr = q3 - q1
        if iqr <= 0:
            continue
        lo, hi = q1 - iqr_k * iqr, q3 + iqr_k * iqr
        extreme = [v for v in vals if v < lo or v > hi]
        if not extreme:
            continue
        rate = len(extreme) / n
        out.append(_f(
            "DIST-003", "low",
            f"字段 '{col}' 存在 {len(extreme)} 个极端值（{rate:.1%}，范围 [{lo:.4g}, {hi:.4g}]）",
            evidence=[Evidence(file_path=table.path, field=col,
                               detail=f"min={vals[0]:.4g}, max={vals[-1]:.4g}, "
                                      f"extreme e.g. {extreme[:3]}")],
            justification=f"超出 Q1-{iqr_k}×IQR ~ Q3+{iqr_k}×IQR",
            suggestion="核实是真实极端观测还是录入/单位错误",
            confidence="medium",
        ))
    return out


def detect_version_and_source(files: list[FileMeta], root: Path,
                              aliases: dict[str, str] | None = None
                              ) -> tuple[list[Finding], str | None, list[str]]:
    """INT-010 版本识别 + INT-011 来源追踪。返回 (findings, version, sources)。

    aliases: 存储名 → 原始文件名（上传场景下存储名被改写，版本号可能只在
    原始名中）。
    """
    out: list[Finding] = []
    version = None
    from app.dataaudit.readers import infer_dataset_version
    names = [f.path for f in files]
    if aliases:
        names += [aliases.get(f.path) or aliases.get(f.abs_path) or ""
                  for f in files]
    version = infer_dataset_version([n for n in names if n])

    # 清单文件中的显式版本字段优先于文件名推断
    manifest = read_manifest(root) or {}
    if not version:
        for key in ("version", "dataset_version", "revision", "release"):
            value = manifest.get(key)
            if isinstance(value, (str, int, float)) and str(value).strip():
                version = str(value).strip()
                break

    if version:
        out.append(_f(
            "INT-010", "info",
            f"识别到数据集版本标识：{version}",
            evidence=[Evidence(file_path=files[0].path if files else str(root),
                               dataset_version=version,
                               detail="从文件/目录命名推断")],
            justification="路径中包含语义化版本号模式",
        ))
    else:
        out.append(_f(
            "INT-010", "unknown",
            "未识别到数据集版本标识",
            evidence=[Evidence(file_path=str(root),
                               detail="目录与文件名中无版本号模式")],
            justification="无法确认数据集版本，可追溯性不足",
            suggestion="建议按 dataset-vX.Y 命名或提供 manifest.json",
            confidence="high",
        ))

    sources: list[str] = []
    for f in files:
        name = Path(f.path).name.lower()
        if name in ("manifest.json", "readme.md", "readme.txt", "dataset_card.md"):
            try:
                text = Path(f.abs_path).read_text(encoding="utf-8", errors="replace")[:200_000]
            except OSError:
                continue
            for m in SOURCE_URL.findall(text):
                if m not in sources:
                    sources.append(m)
            # manifest 结构化字段也算来源声明（license/dataset/source/provider）
            if name == "manifest.json" and isinstance(manifest, dict):
                for key in ("license", "dataset", "source", "provider",
                            "origin", "citation"):
                    value = manifest.get(key)
                    if isinstance(value, str) and value.strip():
                        entry = f"{key}: {value.strip()[:120]}"
                        if entry not in sources:
                            sources.append(entry)
    if sources:
        out.append(_f(
            "INT-011", "info",
            f"从清单/README 追踪到 {len(sources)} 个数据来源声明",
            evidence=[Evidence(file_path="manifest/README", detail="; ".join(sources[:5]))],
            justification="文档中包含来源 URL",
        ))
    else:
        out.append(_f(
            "INT-011", "unknown",
            "未找到数据来源声明（无 manifest/README 含来源链接）",
            evidence=[Evidence(file_path=str(root), detail="未发现来源 URL")],
            justification="数据来源不可追溯",
            suggestion="补充 manifest.json 声明数据来源与许可",
            confidence="medium",
        ))
    return out, version, sources


def read_manifest(root: Path) -> dict[str, Any] | None:
    p = root / "manifest.json"
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8", errors="replace"))
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def check_manifest_missing(root: Path, present: set[str]) -> list[Finding]:
    """INT-003 扩展：manifest 声明的文件在磁盘上缺失。"""
    manifest = read_manifest(root)
    if not manifest:
        return []
    out: list[Finding] = []
    declared = manifest.get("files") or manifest.get("dataset_files") or []
    if isinstance(declared, dict):
        declared = list(declared.keys())
    for entry in declared:
        name = entry if isinstance(entry, str) else str(entry.get("path", ""))
        if not name:
            continue
        if name not in present and Path(name).name not in {
            Path(p).name for p in present
        }:
            out.append(_f(
                "INT-003", "high",
                f"manifest 声明的文件缺失：{name}",
                evidence=[Evidence(file_path="manifest.json",
                                   detail=f"declared={name} but not found")],
                justification="清单声明与磁盘实际内容不一致",
                suggestion="重新下载缺失文件或更新 manifest",
            ))
    return out
