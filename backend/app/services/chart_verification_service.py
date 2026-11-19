"""论文图表反向验证（第六阶段 Wave E）纯服务。

只做文本与数值层的程序化核对：
- 从论文文本块正则提取表格行数值与图注；
- 用 ast 静态分析代码中的绘图调用（绝不执行用户代码）；
- 从结果材料（CSV/JSON/日志文本）提取真实指标数值；
- 对比论文声明与结果数值，缺数据时明确标记 insufficient_data。

不依赖 LLM、不访问数据库、不调用外部服务或 OCR。所有结果只来自传入的真实材料。
"""
from __future__ import annotations

import ast
import csv
import hashlib
import io
import json
import re
from typing import Any

# ---- 表格行识别 ----
# 独立数字 token：左侧不能是字母/数字/点/连字符（避免把 ResNet-50 中的 50 当作数值），
# 右侧必须是空白/结束/百分号/分隔符（避免把 0.912abc 误当数值）。
_STANDALONE_NUMBER_RE = re.compile(
    r"(?<![\w.\-])[-+]?\d+(?:\.\d+)?(?=\s|$|%|％|,|，|\)|\])"
)
_FULL_NUMBER_RE = re.compile(r"^\s*([-+]?\d+(?:\.\d+)?)\s*[%％]?\s*$")

# 图注/表注行（识别后跳过表格行提取，避免把编号当指标值）
_CAPTION_RE = re.compile(
    r"^\s*(?P<kind>Figure|Fig\.|Fig|Table|Tab\.|Tab|图|表)\s*[:：]?\s*"
    r"(?P<number>\d{1,3})\s*[:：.\-、]?\s*(?P<text>.*)$",
    re.IGNORECASE,
)

# 指标别名 -> 规范名；顺序保证长别名优先命中
_METRIC_ALIASES: tuple[tuple[str, str], ...] = (
    ("accuracy", "accuracy"),
    ("准确率", "accuracy"),
    ("top-1", "top1"),
    ("top1", "top1"),
    ("top-5", "top5"),
    ("top5", "top5"),
    ("f1-score", "f1"),
    ("f1_score", "f1"),
    ("f1 score", "f1"),
    ("f1", "f1"),
    ("precision", "precision"),
    ("精确率", "precision"),
    ("recall", "recall"),
    ("召回率", "recall"),
    ("auc", "auc"),
    ("bleu", "bleu"),
    ("rouge", "rouge"),
    ("rmse", "rmse"),
    ("mae", "mae"),
    ("loss", "loss"),
    ("损失", "loss"),
    ("acc", "accuracy"),
)

# ---- 绘图调用识别（AST 静态分析）----
_PLOT_LIBS = {"matplotlib", "plotly", "seaborn", "pandas", "mpl_toolkits"}
_PLOT_METHODS = {
    "plot", "bar", "barh", "hist", "scatter", "pie", "boxplot", "violinplot",
    "step", "stackplot", "imshow", "contour", "contourf", "quiver", "hexbin",
    "errorbar", "fill_between", "loglog", "semilogx", "semilogy", "line",
    "area", "heatmap", "add_trace", "figure", "subplots", "barplot",
    "countplot", "distplot", "histplot", "scatterplot", "lineplot", "pairplot",
    "savefig", "show",
}
# 即使变量不是已知绘图库别名，这些方法名也足以作为绘图证据
_STRONG_PLOT_METHODS = {
    "plot", "bar", "barh", "hist", "scatter", "pie", "imshow", "boxplot",
    "add_trace", "barplot", "scatterplot", "lineplot", "histplot", "figure",
    "subplots",
}

# ---- 结果数值识别 ----
_METRIC_KEY_TOKENS: tuple[tuple[str, str], ...] = (
    ("accuracy", "accuracy"), ("准确率", "accuracy"),
    ("f1", "f1"), ("precision", "precision"), ("精确率", "precision"),
    ("recall", "recall"), ("召回率", "recall"), ("auc", "auc"),
    ("bleu", "bleu"), ("rouge", "rouge"), ("rmse", "rmse"), ("mae", "mae"),
    ("loss", "loss"), ("损失", "loss"), ("acc", "accuracy"),
)
_TEXT_METRIC_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"\baccuracy\s*[:=]\s*([-+]?\d+(?:\.\d+)?)", "accuracy"),
    (r"\bacc\s*[:=]\s*([-+]?\d+(?:\.\d+)?)", "accuracy"),
    (r"\bf1[-_ ]?score\s*[:=]\s*([-+]?\d+(?:\.\d+)?)", "f1"),
    (r"\bprecision\s*[:=]\s*([-+]?\d+(?:\.\d+)?)", "precision"),
    (r"\brecall\s*[:=]\s*([-+]?\d+(?:\.\d+)?)", "recall"),
    (r"\bauc\s*[:=]\s*([-+]?\d+(?:\.\d+)?)", "auc"),
    (r"\bloss\s*[:=]\s*([-+]?\d+(?:\.\d+)?)", "loss"),
)

_MAX_TEXT_CHARS = 200_000


def _digest(prefix: str, payload: str) -> str:
    """生成稳定的业务 ID，同一输入多次运行得到同一结果。"""
    return f"{prefix}-{hashlib.sha1(payload.encode('utf-8')).hexdigest()[:12]}"


def _locator_at(locators: list[dict], index: int) -> dict:
    if 0 <= index < len(locators) and isinstance(locators[index], dict):
        return locators[index]
    return {}


def _canonical_metric(label: str) -> str | None:
    """判断标签是否为已知指标名；未知标签返回 None（保留原标签作为名称）。"""
    low = label.strip().lower()
    for alias, canonical in _METRIC_ALIASES:
        if alias in low:
            return canonical
    return None


def _parse_pipe_row(line: str) -> tuple[str, list[float]] | None:
    """解析 "ResNet-50 | 76.1 | 91.2" 形式：首列为标签，其余列全为数值。"""
    parts = [part.strip() for part in line.split("|")]
    if len(parts) < 2:
        return None
    label = parts[0].strip(" :：-—")
    if not label or len(label) > 60 or not re.search(r"[A-Za-z\u4e00-\u9fff]", label):
        return None
    values: list[float] = []
    for part in parts[1:]:
        matched = _FULL_NUMBER_RE.match(part)
        if matched:
            values.append(float(matched.group(1)))
    return (label, values) if values else None


def _parse_spaced_row(line: str) -> tuple[str, list[float]] | None:
    """解析 "accuracy 0.912" / "ResNet-50 76.1 91.2" 形式。"""
    matches = list(_STANDALONE_NUMBER_RE.finditer(line))
    if not matches:
        return None
    label = line[:matches[0].start()].strip(" \t:：-—,，|")
    if not label or len(label) > 60 or len(label.split()) > 8:
        return None
    if not re.search(r"[A-Za-z\u4e00-\u9fff]", label):
        return None
    tail = line[matches[-1].end():].strip()
    if len(tail) > 12:  # 尾部存在大段正文，视为普通句子而非表格行
        return None
    values = [float(m.group(0)) for m in matches]
    return (label, values) if values else None


def extract_table_claims(chunks: list[str], locators: list[dict]) -> list[dict]:
    """从论文文本块中提取表格行数值主张；无匹配返回空列表，绝不编造。"""
    claims: list[dict] = []
    for chunk_index, raw_chunk in enumerate(chunks or []):
        if not isinstance(raw_chunk, str):
            continue
        for raw_line in raw_chunk.splitlines():
            line = raw_line.strip()
            if not line or len(line) > 300 or _CAPTION_RE.match(line):
                continue
            parsed = _parse_pipe_row(line) or _parse_spaced_row(line)
            if parsed is None:
                continue
            label, values = parsed
            canonical = _canonical_metric(label)
            metric_name = canonical or label.strip().lower()
            confidence = 0.92 if canonical else (0.8 if len(values) >= 2 else 0.7)
            claims.append({
                "claim_id": _digest(
                    "tbl", f"{chunk_index}|{raw_line}|{values}"),
                "metric_name": metric_name,
                "values": values,
                "raw_line": raw_line[:300],
                "source_locator": _locator_at(locators or [], chunk_index),
                "extraction_method": "text_regex",
                "confidence": confidence,
            })
    return claims


def extract_captions(chunks: list[str], locators: list[dict]) -> list[dict]:
    """识别 Figure/Table/图/表 开头的图注与表注行。"""
    captions: list[dict] = []
    for chunk_index, raw_chunk in enumerate(chunks or []):
        if not isinstance(raw_chunk, str):
            continue
        for raw_line in raw_chunk.splitlines():
            line = raw_line.strip()
            if not line or len(line) > 500:
                continue
            matched = _CAPTION_RE.match(line)
            if not matched:
                continue
            raw_kind = matched.group("kind").lower()
            if raw_kind == "表" or raw_kind.startswith(("table", "tab")):
                kind = "table"
            else:
                kind = "figure"
            number = int(matched.group("number"))
            text = matched.group("text").strip()
            captions.append({
                "caption_id": _digest("cap", f"{chunk_index}|{raw_line}"),
                "kind": kind,
                "number": number,
                "text": text,
                "source_locator": _locator_at(locators or [], chunk_index),
            })
    return captions


def _root_name(node: ast.AST) -> str:
    """取属性链最左侧变量名，如 matplotlib.pyplot -> matplotlib。"""
    while isinstance(node, ast.Attribute):
        node = node.value
    return node.id if isinstance(node, ast.Name) else ""


def find_plot_logic(code_text: str) -> list[dict]:
    """用 ast 静态检测 matplotlib/plotly/seaborn 等绘图调用；语法错误返回空列表。"""
    if not isinstance(code_text, str) or not code_text.strip():
        return []
    try:
        tree = ast.parse(code_text)
    except (SyntaxError, ValueError):
        return []

    # 收集绘图库导入别名，避免把普通对象的 .plot 误判（强特征方法名除外）
    aliases: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in _PLOT_LIBS:
                    aliases.add(alias.asname or root)
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root in _PLOT_LIBS:
                for alias in node.names:
                    aliases.add(alias.asname or alias.name)

    lines = code_text.splitlines()
    found: list[dict] = []
    seen: set[tuple[Any, ...]] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        symbol: str
        if isinstance(func, ast.Attribute):
            attribute = func.attr
            if attribute not in _PLOT_METHODS:
                continue
            root = _root_name(func.value)
            if (root not in aliases and root not in _PLOT_LIBS
                    and attribute not in _STRONG_PLOT_METHODS):
                continue
            try:
                symbol = ast.unparse(func)
            except Exception:  # noqa: BLE001 - 不同 Python 版本兼容回退
                symbol = attribute
        elif isinstance(func, ast.Name):
            if func.id not in aliases or func.id not in _PLOT_METHODS:
                continue
            symbol = func.id
        else:
            continue

        try:
            call = ast.unparse(node)[:400]
        except Exception:  # noqa: BLE001
            call = symbol
        line = int(getattr(node, "lineno", 0) or 0)
        evidence = lines[line - 1].strip()[:300] if 0 < line <= len(lines) else ""
        key = (line, symbol, call)
        if key in seen:
            continue
        seen.add(key)
        found.append({
            "symbol": symbol,
            "line": line,
            "call": call,
            "evidence_line": evidence,
            "method": "ast",
        })
    found.sort(key=lambda item: (item["line"], item["symbol"]))
    return found


def _metric_from_key(key: str) -> str | None:
    low = (key or "").lower()
    for token, canonical in _METRIC_KEY_TOKENS:
        if token in low:
            return canonical
    return None


def find_result_files(material_texts: dict[str, str]) -> list[dict]:
    """从材料文本中提取 CSV/JSON/日志形式的真实指标数值（纯函数）。"""
    found: list[dict] = []
    for file_name, raw_text in (material_texts or {}).items():
        if not isinstance(raw_text, str) or not raw_text.strip():
            continue
        text = raw_text[:_MAX_TEXT_CHARS]
        name = str(file_name)

        # 1) JSON：按键路径中的指标词识别数值
        try:
            data = json.loads(text)
        except (json.JSONDecodeError, TypeError, ValueError):
            data = None
        if isinstance(data, (dict, list)):
            def walk(obj: Any, path: str) -> None:
                if isinstance(obj, dict):
                    for key, value in obj.items():
                        walk(value, f"{path}.{key}" if path else str(key))
                elif isinstance(obj, list):
                    for index, value in enumerate(obj):
                        walk(value, f"{path}[{index}]")
                elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
                    leaf = path.rsplit(".", 1)[-1]
                    metric = _metric_from_key(leaf)
                    if metric:
                        found.append({
                            "file_name": name, "metric": metric,
                            "value": float(obj), "source": f"{name}#json:{path}",
                        })
            walk(data, "")
            continue

        # 2) CSV：按列名中的指标词识别数值
        try:
            reader = csv.DictReader(io.StringIO(text))
            fieldnames = reader.fieldnames or []
            csv_items: list[dict] = []
            for row in reader:
                for key, value in row.items():
                    metric = _metric_from_key(key or "")
                    if not metric:
                        continue
                    try:
                        numeric = float(str(value).strip())
                    except (TypeError, ValueError):
                        continue
                    csv_items.append({
                        "file_name": name, "metric": metric, "value": numeric,
                        "source": f"{name}#csv:{key}",
                    })
            if fieldnames and csv_items:
                found.extend(csv_items)
                continue
        except (csv.Error, ValueError):
            pass

        # 3) 日志/文本：metric=value 形式（复用 results.py 的提取风格）
        for pattern, metric in _TEXT_METRIC_PATTERNS:
            for matched in re.finditer(pattern, text, re.IGNORECASE):
                try:
                    numeric = float(matched.group(1))
                except (TypeError, ValueError):
                    continue
                found.append({
                    "file_name": name, "metric": metric, "value": numeric,
                    "source": f"{name}#text:{matched.group(0)[:60]}",
                })
    return found


def _coerce_values(raw_values: Any) -> list[float]:
    """把 list[dict]/list[float]/单值统一为浮点列表，无法转换的丢弃。"""
    if raw_values is None:
        return []
    if not isinstance(raw_values, list):
        raw_values = [raw_values]
    values: list[float] = []
    for item in raw_values:
        candidate = item.get("value") if isinstance(item, dict) else item
        if isinstance(candidate, bool) or candidate is None:
            continue
        try:
            values.append(float(candidate))
        except (TypeError, ValueError):
            continue
    return values


def verify_figure(claim: dict, plot_calls: list, result_values: list) -> dict:
    """对比论文表格数值与结果文件数值；缺一方数据时明确标记证据不足。"""
    paper_values = _coerce_values((claim or {}).get("values"))
    # 误报防护：结果文件数值必须先按指标名匹配 claim；否则不同指标（如学习率与准确率）
    # 的数值会被当成同一实验结果比较，产生虚假的 supported/conflicting。
    metric = str((claim or {}).get("metric_name") or "").strip().lower()
    dict_results = [item for item in (result_values or []) if isinstance(item, dict)]
    scalar_results = [item for item in (result_values or []) if not isinstance(item, dict)]
    metric_matches = [
        item for item in dict_results
        if metric and str(item.get("metric") or "").strip().lower() == metric
    ]
    chosen = metric_matches if metric_matches else (dict_results if dict_results else scalar_results)
    results = _coerce_values(chosen)
    result_sources = [
        str(item.get("source") or item.get("file_name") or "")
        for item in chosen if isinstance(item, dict)
    ]
    evidence_missing: list[str] = []
    if not plot_calls:
        evidence_missing.append("未发现绘图调用证据")
    if not paper_values:
        evidence_missing.append("论文表格中未提取到可比对数值")
    if not results:
        evidence_missing.append("结果材料中未提取到可比对数值")

    base = {
        "claim_id": (claim or {}).get("claim_id"),
        "metric_name": (claim or {}).get("metric_name"),
        "paper_values": paper_values,
        "result_values": results,
        "diff": None,
        "diff_details": [],
        "method": "paper_table_vs_result_file_numeric_comparison",
        "result_sources": [s for s in result_sources if s],
        "evidence_missing": evidence_missing,
        "note": "",
    }
    if result_sources and not metric_matches and metric:
        base["evidence_missing"].append(
            f"结果文件中未找到指标 {metric} 的同名数值，以下比对使用其他指标数值，仅供人工参考"
        )

    if not results or not paper_values or (metric and not metric_matches):
        base["verdict"] = "insufficient_data"
        base["note"] = (
            "缺少原始数据（未找到同指标数值），未完成精确复核；仅记录论文文本声明与已有的绘图调用证据。"
            if metric and not metric_matches else
            "缺少原始数据，未完成精确复核；仅记录论文文本声明与已有的绘图调用证据。"
        )
        return base

    # 以最小绝对差判定是否匹配：容差取 2% 相对值，且不低于 0.01 绝对值。
    pairs = [(paper, result, abs(paper - result))
             for paper in paper_values for result in results]
    pairs.sort(key=lambda item: item[2])
    best_paper, best_result, best_diff = pairs[0]
    tolerance = max(0.01, abs(best_paper) * 0.02)
    base["diff"] = round(best_diff, 10)
    base["diff_details"] = [
        {
            "paper_value": paper, "result_value": result,
            "absolute_diff": round(diff, 10),
            "relative_diff": round(diff / abs(paper), 10) if paper else None,
        }
        for paper, result, diff in pairs[:8]
    ]
    if best_diff <= tolerance:
        base["verdict"] = "supported"
        base["note"] = (
            "论文文本数值与结果文件数值一致（在平台默认容差内），"
            "未做图像级重绘核对，实验条件一致性仍需人工确认。"
        )
    else:
        base["verdict"] = "conflicting"
        base["note"] = (
            "结果文件数值与论文文本声明存在差异，需人工复核数据集/划分/指标定义等条件；"
            "本结论仅基于文本与数值层比对。"
        )
    # 有真实数值时，数值缺失证据不再成立
    base["evidence_missing"] = [
        item for item in evidence_missing
        if item not in ("论文表格中未提取到可比对数值", "结果材料中未提取到可比对数值")
    ]
    return base


def verify_bundle(
    chunks: list[str],
    locators: list[dict],
    code_texts: dict[str, str],
    material_texts: dict[str, str],
) -> dict:
    """编排图表反向验证：图注、表格主张、绘图逻辑、结果数值与逐条核对。"""
    captions = extract_captions(chunks, locators)
    table_claims = extract_table_claims(chunks, locators)
    plot_logic: list[dict] = []
    for file_name, code_text in (code_texts or {}).items():
        for item in find_plot_logic(code_text):
            enriched = dict(item)
            enriched["file_name"] = str(file_name)
            plot_logic.append(enriched)
    result_files = find_result_files(material_texts)

    verifications = [
        verify_figure(claim, plot_logic, result_files) for claim in table_claims
    ]
    summary = {
        "total_claims": len(table_claims),
        "supported": sum(1 for v in verifications if v["verdict"] == "supported"),
        "conflicting": sum(1 for v in verifications if v["verdict"] == "conflicting"),
        "insufficient_data": sum(
            1 for v in verifications if v["verdict"] == "insufficient_data"),
    }
    limitations = [
        "未做图像级/OCR级重绘对比，仅文本与数值层验证",
        "绘图调用来自 AST 静态分析，未执行代码，无法确认图形实际渲染内容",
        "表格行与图注来自文本正则提取，扫描版或图片型表格可能遗漏",
        "数值比对使用平台默认容差，不等于论文的实验条件一致性判定",
    ]
    return {
        "captions": captions,
        "table_claims": table_claims,
        "plot_logic": plot_logic,
        "result_files": result_files,
        "verifications": verifications,
        "summary": summary,
        "limitations": limitations,
    }
