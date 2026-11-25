"""Deterministic checks behind the AgentArts paper-audit tools."""
from __future__ import annotations

import hashlib
from asyncio import to_thread
import json
import re
from pathlib import Path
from typing import Literal

import yaml
from yaml.tokens import AliasToken

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models import Material
from app.parsers.limits import ParserError
from app.parsers.registry import parse_file
from app.services.material_service import MaterialService
from app.services.numeric_recompute_service import recompute_from_counts
from app.services.static_analysis_service import analyze_project_code

RULE_VERSION = "paper-audit-v1"
FIELDS = {
    "batch_size": "config",
    "learning_rate": "config",
    "seed": "code",
    "f1": "metrics",
    "accuracy": "metrics",
}
ROLE_TYPES = {
    "paper": {"pdf", "text"},
    "config": {"yaml", "json", "toml"},
    "code": {"python"},
    "metrics": {"json"},
}
NUMBER = r"[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?"
ALIASES = {
    "batch_size": r"batch[_ ]size|批大小",
    "learning_rate": r"learning[_ ]rate|学习率|lr",
    "seed": r"random[_ ]seed|seed|随机种子",
    "f1": r"f1(?:[- ]score)?",
    "accuracy": r"accuracy|准确率",
}
ClaimField = Literal["batch_size", "learning_rate", "seed", "f1", "accuracy"]
CheckKind = Literal["config", "code", "metrics"]


class ClaimIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    field: ClaimField
    chunk_id: str = Field(min_length=1, max_length=100)
    quote: str = Field(min_length=1, max_length=700)


class AuditIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    paper: str = Field(min_length=1, max_length=36)
    config: str | None = Field(default=None, min_length=1, max_length=36)
    code: str | None = Field(default=None, min_length=1, max_length=36)
    metrics: str | None = Field(default=None, min_length=1, max_length=36)
    parent_id: str | None = Field(default=None, min_length=1, max_length=36)
    allow_cloud_processing: Literal[True]


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"invalid JSON constant: {value}")


def _file_data(role: str, path: Path, material: Material) -> dict:
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != material.sha256:
        raise AppError("MATERIAL_CHANGED", f"材料内容校验失败：{material.source_name}。", status_code=409)
    if role == "code":
        return {"source": raw.decode("utf-8-sig")}
    if role == "metrics":
        data = json.loads(raw, parse_constant=_reject_json_constant)
        if not isinstance(data, dict):
            raise ValueError("result must be an object")
        return {"metrics": data}
    if role == "config" and material.material_type == "yaml" and any(
        isinstance(token, AliasToken) for token in yaml.scan(raw)
    ):
        raise ValueError("YAML aliases are not supported by the audit")
    parsed = parse_file(path, material_id=material.id, project_id=material.project_id,
                        source_name=material.source_name)
    if parsed.status == "failed":
        raise ValueError("material could not be parsed")
    if role == "config":
        return {"leaves": parsed.metadata.get("leaves", [])}
    chunks = []
    remaining = 20_000
    for chunk in parsed.chunks:
        if len(chunks) >= 48 or not remaining:
            break
        text = chunk.content[:min(2000, remaining)]
        remaining -= len(text)
        chunks.append({"chunk_id": chunk.chunk_id, "text": text, "locator": chunk.source_locator})
    if not chunks:
        raise ValueError("paper has no text")
    return {"chunks": chunks, "limited": len(chunks) < len(parsed.chunks) or
            any(len(chunk.content) > len(item["text"]) for chunk, item in zip(parsed.chunks, chunks))}


async def snapshot_materials(db: AsyncSession, project_id: str, selection: AuditIn) -> dict:
    ids = {getattr(selection, role) for role in ROLE_TYPES} - {None}
    materials = {row.id: row for row in await db.scalars(
        select(Material).where(Material.project_id == project_id, Material.id.in_(ids))
    )}
    snapshot = {}
    for role, allowed_types in ROLE_TYPES.items():
        material_id = getattr(selection, role)
        if material_id is None:
            continue
        material = materials.get(material_id)
        if material is None:
            raise AppError("NOT_FOUND", "所选材料不存在或无权访问。", status_code=404)
        if material.material_type not in allowed_types or not material.stored_path:
            raise AppError("VALIDATION_ERROR", f"材料格式不适用于 {role}：{material.source_name}。")
        limit = 20 * 1024 * 1024 if role == "paper" else 256 * 1024
        if material.file_size_bytes > limit:
            raise AppError("VALIDATION_ERROR", f"材料超出审计大小限制：{material.source_name}。")
        path = await MaterialService(db).path_of(material)
        try:
            content = await to_thread(_file_data, role, path, material)
        except (OSError, ValueError, ParserError, RecursionError, yaml.YAMLError) as exc:
            raise AppError("AUDIT_MATERIAL_INVALID", f"无法读取有效审计内容：{material.source_name}。", status_code=422) from exc
        snapshot[role] = {"id": material.id, "name": material.source_name,
                          "sha256": material.sha256, **content}
    return snapshot


def _evidence(material: dict, locator: dict, text: str) -> dict:
    return {"material_id": material["id"], "name": material["name"],
            "sha256": material["sha256"], "locator": locator, "text": text}


def _comparison(expected: float, observed: float, field: str) -> bool:
    tolerance = 0.005 if field in ("f1", "accuracy") else max(abs(expected) * 1e-9, 1e-12)
    return abs(expected - observed) <= tolerance + 1e-12


def verify_claim(snapshot: dict, kind: CheckKind, claim: ClaimIn) -> dict:
    if FIELDS[claim.field] != kind:
        raise AppError("AUDIT_WRONG_TOOL", "主张类型与核验工具不匹配。", status_code=422)
    paper = snapshot["paper"]
    chunks = {item["chunk_id"]: item for item in paper["chunks"]}
    chunk = chunks.get(claim.chunk_id)
    if chunk is None or claim.quote not in chunk["text"]:
        raise AppError("AUDIT_INVALID_REFERENCE", "论文引用必须是本次材料快照中的逐字原文。", status_code=422)
    pattern = re.compile(
        rf"(?<![\w-])(?:{ALIASES[claim.field]})\s*(?:[:=：]|为|is)\s*({NUMBER})([ \t]*%)?(?![\w%]|\.\d)",
        flags=re.IGNORECASE,
    )
    matches = list(pattern.finditer(claim.quote))
    # Check only an unambiguous, literal value in the original paper quote.
    if len(matches) != 1:
        raise AppError("AUDIT_INVALID_VALUE", "引文须明确包含一处所选字段及数值。", status_code=422)
    match = matches[0]
    offsets = [occurrence.start() for occurrence in re.finditer(re.escape(claim.quote), chunk["text"])]
    if not any(
        full_match.end() == offset + match.end()
        for offset in offsets
        if (full_match := pattern.match(chunk["text"], offset + match.start())) is not None
    ):
        raise AppError("AUDIT_INVALID_VALUE", "引文截断了原文中的字段或数值。", status_code=422)
    value, unit = match.groups()
    expected = float(value) / (100 if unit else 1)
    if not -1e12 < expected < 1e12 or (kind == "metrics" and not 0 <= expected <= 1):
        raise AppError("AUDIT_INVALID_VALUE", "论文数值超出核验范围。", status_code=422)
    if (kind != "metrics" and unit) or (claim.field in ("batch_size", "seed") and not expected.is_integer()):
        raise AppError("AUDIT_INVALID_VALUE", "论文数值单位或精度与核验字段不符。", status_code=422)
    finding = {
        "id": hashlib.sha256(json.dumps([claim.field, paper["sha256"], claim.chunk_id, claim.quote],
                                       ensure_ascii=False).encode()).hexdigest(),
        "claim": claim.model_dump(), "check": kind, "expected": expected, "observed": None,
        "status": "INSUFFICIENT_EVIDENCE",
        "evidence": [_evidence(paper, chunk["locator"], claim.quote)],
    }
    artifact = snapshot.get(kind)
    if artifact is None:
        finding["note"] = {"config": "请补充该实验的配置文件。", "code": "请补充设置随机种子的 Python 文件。",
                           "metrics": "请补充同一实验口径的结果计数 JSON。"}[kind]
        return finding

    observed: float | None = None
    if kind == "config":
        leaves = [item for item in artifact["leaves"]
                  if item.get("semantic_label") == claim.field or item["original_key"] == claim.field]
        if len(leaves) == 1 and re.fullmatch(NUMBER, leaves[0]["raw_value"], flags=re.IGNORECASE):
            leaf = leaves[0]
            observed = float(leaf["raw_value"])
            finding["evidence"].append(_evidence(
                artifact, {"field_path": leaf["original_path"]},
                f'{leaf["original_path"]} = {leaf["raw_value"]}',
            ))
        finding["note"] = "检查所选配置中的唯一数值字段。" if observed is not None else "配置缺少该字段，或存在多个候选字段。"
    elif kind == "code":
        analysis = analyze_project_code({artifact["name"]: artifact["source"]})
        seeds = analysis["combined"]["random_seed_settings"]
        if len(seeds) == 1 and type(seeds[0]["value"]) is int:
            seed = seeds[0]
            observed = seed["value"]
            finding["evidence"].append(_evidence(
                artifact, {"line_number": seed["line"]},
                artifact["source"].splitlines()[seed["line"] - 1],
            ))
        finding["note"] = "静态核对种子字面量，运行时取值待确认。" if observed is not None else "未发现唯一的整数字面量种子设置。"
    else:
        data = artifact["metrics"]
        scope = re.search(r"\bsplit\s*=\s*([\w.-]+)", claim.quote, flags=re.IGNORECASE)
        label = re.search(r"\bpositive_label\s*=\s*([\w.-]+)", claim.quote, flags=re.IGNORECASE)
        keys = ("tp", "fp", "fn") if claim.field == "f1" else ("correct", "total")
        if claim.field == "f1" and re.search(r"\b(?:macro|micro|weighted)\b", claim.quote, re.I):
            finding["status"] = "UNVERIFIABLE"
            finding["note"] = "当前只核验明确正类的二分类 F1。"
            return finding
        if not scope or (claim.field == "f1" and not label):
            finding["note"] = "论文原文需写明 split，F1 还需写明 positive_label。"
            return finding
        scope_fields = ("split", "average", "positive_label") if claim.field == "f1" else ("split",)
        result_scope = {key: data.get(key) for key in scope_fields}
        if any(type(value) not in (str, int) or value == "" for value in result_scope.values()):
            finding["note"] = "结果 JSON 缺少可核对的实验口径。"
            return finding
        if (result_scope["split"] != scope[1] or
            (claim.field == "f1" and
             (result_scope["average"] != "binary" or str(result_scope["positive_label"]) != label[1]))):
            finding["status"] = "UNVERIFIABLE"
            finding["note"] = "数据划分、正类或汇总方式与本次核验口径不可比。"
            finding["evidence"].append(_evidence(
                artifact, {"field_path": ", ".join(scope_fields)}, json.dumps(result_scope, ensure_ascii=False),
            ))
            return finding
        counts = data.get("counts")
        if not isinstance(counts, dict) or any(type(counts.get(key)) is not int or
                                               not 0 <= counts[key] <= 10**12 for key in keys):
            finding["note"] = "结果 JSON 缺少有效的非负整数计数。"
            return finding
        recomputed = recompute_from_counts(claim.field, counts)
        if not recomputed.get("valid") or recomputed.get("denominator_zero") or (
            claim.field == "accuracy" and counts["correct"] > counts["total"]
        ):
            finding["note"] = "计数口径无效或分母为零，需要人工核对。"
            return finding
        observed = recomputed["value"]
        finding["note"] = recomputed["note"]
        finding["evidence"].append(_evidence(
            artifact, {"field_path": "counts"}, json.dumps({key: counts[key] for key in keys}),
        ))
    if observed is not None and -1e12 < observed < 1e12:
        finding["observed"] = observed
        if kind == "code":
            finding["status"] = "PARTIALLY_VERIFIED" if _comparison(expected, observed, claim.field) else "CONFLICTING"
        else:
            finding["status"] = "VERIFIED" if _comparison(expected, observed, claim.field) else "CONFLICTING"
    elif observed is not None:
        finding["note"] = "材料中的数值超出核验范围。"
    return finding
