"""结果提取、论文结果对照、复现质量评估。

关键：代码运行成功 ≠ 论文成功复现。不把所有数值差异简单判为成功/失败。
"""
from __future__ import annotations

import csv
import io
import json
import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ExtractedFact
from app.models.stage4 import MetricComparison, ReproductionMetric

METRIC_PATTERNS = [
    (r"\baccuracy\s*[:=]\s*([0-9.]+)", "accuracy"),
    (r"\bacc\s*[:=]\s*([0-9.]+)", "accuracy"),
    (r"\bf1[-_ ]?score\s*[:=]\s*([0-9.]+)", "f1"),
    (r"\bprecision\s*[:=]\s*([0-9.]+)", "precision"),
    (r"\brecall\s*[:=]\s*([0-9.]+)", "recall"),
    (r"\bauc\s*[:=]\s*([0-9.]+)", "auc"),
    (r"\bloss\s*[:=]\s*([0-9.]+)", "loss"),
    (r"\bbleu\s*[:=]\s*([0-9.]+)", "bleu"),
    (r"\brouge\s*[:=]\s*([0-9.]+)", "rouge"),
    (r"\brmse\s*[:=]\s*([0-9.]+)", "rmse"),
    (r"\bmae\s*[:=]\s*([0-9.]+)", "mae"),
]


class ResultExtractor:
    """从日志/CSV/JSON 提取指标；无法可靠提取时标记 needs_manual_review。"""

    def extract_from_text(self, text: str, source: str) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for pattern, name in METRIC_PATTERNS:
            for m in re.finditer(pattern, text, re.IGNORECASE):
                try:
                    value = float(m.group(1))
                except ValueError:
                    continue
                results.append({
                    "metric_name": name, "metric_value": value, "unit": None,
                    "source": source, "extraction_method": "regex_from_text",
                    "confidence": 0.7, "needs_manual_review": False,
                    "raw_match": m.group(0)[:100],
                })
        return results

    def extract_from_json(self, text: str, source: str) -> list[dict[str, Any]]:
        try:
            data = json.loads(text)
        except Exception:
            return []
        results: list[dict[str, Any]] = []
        def walk(obj: Any, path: str = "") -> None:
            if isinstance(obj, dict):
                for k, v in obj.items():
                    walk(v, f"{path}.{k}" if path else str(k))
            elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
                key = path.lower()
                for _, name in METRIC_PATTERNS:
                    if name in key:
                        results.append({
                            "metric_name": name, "metric_value": float(obj), "unit": None,
                            "source": f"{source}#{path}", "extraction_method": "json_path",
                            "confidence": 0.95, "needs_manual_review": False,
                        })
                        break
        walk(data)
        return results

    def extract_from_csv(self, text: str, source: str) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        try:
            reader = csv.DictReader(io.StringIO(text))
            for row in reader:
                for k, v in row.items():
                    key = (k or "").lower()
                    for _, name in METRIC_PATTERNS:
                        if name in key:
                            try:
                                results.append({
                                    "metric_name": name, "metric_value": float(v), "unit": None,
                                    "source": f"{source}#{k}", "extraction_method": "csv_column",
                                    "confidence": 0.9, "needs_manual_review": False,
                                })
                            except (ValueError, TypeError):
                                pass
                            break
        except Exception:
            pass
        return results

    async def persist(self, db: AsyncSession, run_id: str, project_id: str,
                      metrics: list[dict[str, Any]]) -> list[ReproductionMetric]:
        rows = []
        for m in metrics:
            row = ReproductionMetric(
                metric_name=m["metric_name"], metric_value=m.get("metric_value"),
                unit=m.get("unit"), source=m.get("source", ""),
                extraction_method=m.get("extraction_method", ""),
                run_id=run_id, project_id=project_id,
                confidence=m.get("confidence", 0.0),
                needs_manual_review=m.get("needs_manual_review", False),
            )
            db.add(row)
            rows.append(row)
        await db.flush()
        return rows


class MetricComparator:
    """论文结果 vs 复现结果对照。容差不由 AI 随意决定。"""

    DEFAULT_TOLERANCE = {
        "accuracy": 0.02, "f1": 0.02, "precision": 0.02, "recall": 0.02,
        "auc": 0.02, "bleu": 1.0, "rouge": 0.02, "rmse": 0.05, "mae": 0.05,
        "loss": 0.05,
    }

    def compare(
        self, metric_name: str, paper_value: float | None, reproduced_value: float | None,
        *, unit: str | None = None, tolerance: float | None = None,
        tolerance_basis: str = "平台默认容差（非论文标准，需人工确认适用性）",
        conditions: dict[str, bool] | None = None,
    ) -> dict[str, Any]:
        conditions = conditions or {}
        diff_abs = None
        diff_rel = None
        if paper_value is not None and reproduced_value is not None:
            diff_abs = reproduced_value - paper_value
            if paper_value != 0:
                diff_rel = diff_abs / abs(paper_value)

        # 比较条件不一致 → not_comparable（优先于数值判断）
        critical = ["same_dataset", "same_split", "same_metric", "same_preprocessing"]
        if any(conditions.get(k) is False for k in critical):
            verdict = "not_comparable"
        elif paper_value is None or reproduced_value is None:
            verdict = "insufficient_data"
        elif paper_value == reproduced_value:
            verdict = "exact_match"
        else:
            tol = tolerance if tolerance is not None else self.DEFAULT_TOLERANCE.get(
                metric_name.lower(), 0.02)
            if abs(diff_abs or 0) <= tol:
                verdict = "within_tolerance"
            else:
                verdict = "significant_deviation"
        return {
            "metric_name": metric_name, "paper_value": paper_value,
            "reproduced_value": reproduced_value, "unit": unit,
            "diff_absolute": diff_abs, "diff_relative": diff_rel,
            "verdict": verdict,
            "rule": ("condition_check" if verdict == "not_comparable"
                     else "exact" if verdict == "exact_match"
                     else f"absolute_tolerance<={tolerance if tolerance is not None else self.DEFAULT_TOLERANCE.get(metric_name.lower(), 0.02)}"),
            "tolerance_basis": tolerance_basis,
            "conditions_check": conditions,
        }

    async def persist(self, db: AsyncSession, project_id: str, result: dict[str, Any]) -> MetricComparison:
        row = MetricComparison(
            id=f"mcmp-{uuid.uuid4().hex[:14]}", project_id=project_id,
            metric_name=result["metric_name"], paper_value=result["paper_value"],
            reproduced_value=result["reproduced_value"], unit=result["unit"],
            diff_absolute=result["diff_absolute"], diff_relative=result["diff_relative"],
            verdict=result["verdict"], rule=result["rule"],
            tolerance_basis=result["tolerance_basis"],
            conditions_json=json.dumps(result["conditions_check"], ensure_ascii=False),
        )
        db.add(row)
        await db.flush()
        return row


class QualityEvaluator:
    """七维度复现质量评估；公开公式与权重，明确不是学术质量判定。"""

    DIMENSIONS = [
        ("material_completeness", "材料完整性", 0.15),
        ("environment_consistency", "环境一致性", 0.15),
        ("parameter_consistency", "参数一致性", 0.15),
        ("code_executability", "代码可执行性", 0.15),
        ("run_success", "运行成功情况", 0.15),
        ("result_comparability", "结果可比性", 0.15),
        ("evidence_completeness", "证据完整性", 0.10),
    ]
    SCOPE_NOTE = (
        "本评分仅表示 ReproCheck 平台定义的复现验证覆盖程度，"
        "不代表学术质量、论文真实性或研究结论正确性的权威判定。"
    )

    def evaluate(self, facts: list[ExtractedFact], evidence_count: int,
                 runs: list[dict[str, Any]], comparisons: list[dict[str, Any]],
                 env_missing: list[str]) -> dict[str, Any]:
        def ratio(num: int, den: int) -> float:
            return round(num / den, 4) if den else 0.0

        with_evidence = sum(1 for f in facts if (f.quote or "") and f.chunk_id)
        material_score = ratio(min(len(facts), 20), 20)
        env_score = ratio(1 if not env_missing else max(0, 3 - len(env_missing)), 3)
        param_groups: dict[str, set[str]] = {}
        for f in facts:
            if f.fact_type == "training_parameter":
                param_groups.setdefault(f.field_key, set()).add(
                    str(f.normalized_value or f.raw_value))
        param_score = ratio(sum(1 for v in param_groups.values() if len(v) == 1),
                            max(len(param_groups), 1))
        executable = any(r.get("execution_enabled") for r in runs)
        code_score = 0.3 if executable else 0.0  # 静态分析覆盖部分能力
        run_score = ratio(sum(1 for r in runs if r.get("status") == "completed"), max(len(runs), 1))
        comparable = sum(1 for c in comparisons if c.get("verdict") not in
                         ("insufficient_data", "not_comparable"))
        compare_score = ratio(comparable, max(len(comparisons), 1))
        evidence_score = ratio(min(evidence_count, 20), 20)

        raw = {
            "material_completeness": material_score,
            "environment_consistency": env_score,
            "parameter_consistency": param_score,
            "code_executability": code_score,
            "run_success": run_score,
            "result_comparability": compare_score,
            "evidence_completeness": evidence_score,
        }
        dimensions = []
        for key, label, weight in self.DIMENSIONS:
            dimensions.append({
                "key": key, "label": label, "score": raw[key], "max": 1.0,
                "weight": weight, "basis": self._basis(key, raw[key], facts, evidence_count, runs),
                "missing": self._missing(key, env_missing, runs),
            })
        overall = round(sum(raw[k] * w for k, _, w in self.DIMENSIONS), 4)
        return {
            "dimensions": dimensions,
            "formula": "overall = Σ (dimension.score × dimension.weight)，权重和=1.0",
            "overall": overall, "scope_note": self.SCOPE_NOTE,
        }

    @staticmethod
    def _basis(key: str, score: float, facts, evidence_count: int, runs) -> str:
        if key == "material_completeness":
            return f"基于已抽取事实数 {len(facts)}（目标 20 条）线性计算"
        if key == "evidence_completeness":
            return f"基于证据条目数 {evidence_count}（目标 20 条）线性计算"
        if key == "code_executability":
            return "当前环境无安全隔离执行后端，仅静态分析，按 0.3 计入"
        if key == "run_success":
            return f"基于运行记录 {len(runs)} 条中 completed 状态占比"
        return "基于对应维度存在性/一致性的程序化规则计算"

    @staticmethod
    def _missing(key: str, env_missing: list[str], runs) -> list[str]:
        if key == "environment_consistency":
            return list(env_missing)
        if key == "run_success" and not runs:
            return ["无运行记录"]
        return []
