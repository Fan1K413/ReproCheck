"""面向单篇论文的阅读与材料核对，复用项目内的材料及可定位原文。"""
from __future__ import annotations

import json
from asyncio import to_thread
from collections import Counter, defaultdict
from math import isfinite
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models import AIRun, ExtractedFact, Material, SourceChunk
from app.models.stage2 import EvidenceItem
from app.parsers.limits import ParserError
from app.parsers.registry import parse_file
from app.schemas.parsing import ParseResult
from app.services.chart_verification_service import (
    extract_table_claims,
    find_result_files,
    verify_figure,
)
from app.services.material_service import MaterialService
from app.services.task_service import parsed_chunks

RESULT_TYPES = {"csv", "json", "text"}
MAX_RESULT_TEXT = 200_000
MAX_REPORT_CLAIMS = 100


def object_from_json(raw: str | None) -> dict:
    try:
        value = json.loads(raw) if raw else None
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def page_source(chunk: SourceChunk) -> dict:
    locator = object_from_json(chunk.source_locator_json)
    return {
        "page": chunk.page_number or locator.get("viewer_page_number"),
        "section": locator.get("section"),
    }


async def parse_paper(db: AsyncSession, paper: Material) -> ParseResult:
    try:
        path = await MaterialService(db).path_of(paper)
        return await to_thread(
            parse_file, path, material_id=paper.id, project_id=paper.project_id,
            source_name=paper.source_name,
        )
    except ParserError as error:
        raise AppError("VALIDATION_ERROR", "无法读取这份 PDF，请重新上传副本。") from error


async def paper_chunks(db: AsyncSession, paper: Material) -> tuple[list[SourceChunk], ParseResult | None]:
    chunks = list(await db.scalars(
        select(SourceChunk).where(SourceChunk.material_id == paper.id)
        .order_by(SourceChunk.chunk_index, SourceChunk.id)
    ))
    if chunks or not paper.stored_path or paper.parse_error_code or paper.needs_ocr:
        return chunks, None
    # 旧入口上传的文件可能尚未解析。读取时在内存提取文本，不写入或调用模型。
    try:
        parsed = await parse_paper(db, paper)
    except AppError:
        return [], None
    return parsed_chunks(paper, parsed), parsed


def reading_view(
    paper: Material, chunks: list[SourceChunk], parsed: ParseResult | None, page: int,
) -> dict:
    metadata = parsed.metadata if parsed is not None else object_from_json(paper.parse_metadata_json)
    page_count = metadata.get("page_count") or paper.page_count or None
    if page_count and page > page_count:
        raise AppError("NOT_FOUND", "这篇论文没有该页。")
    abstract = []
    blocks = []
    for chunk in chunks:
        source = page_source(chunk)
        section = source["section"]
        if isinstance(section, str) and section.strip().casefold().rstrip(":：").strip() in {"abstract", "摘要"}:
            abstract.append(chunk.original_text)
        if source["page"] == page or (page == 1 and source["page"] is None):
            blocks.append({"text": chunk.original_text, **source})

    status = "ready"
    message = None
    if not chunks:
        scanned = parsed.needs_ocr if parsed is not None else paper.needs_ocr
        status = "original_only" if scanned else "unavailable"
        message = (
            "这份 PDF 没有可提取的文字，可以下载原文阅读。"
            if scanned else "暂时无法提取原文，请下载 PDF 或上传另一份副本。"
        )
    elif not blocks:
        message = "这一页没有可提取的文字，可以在原始 PDF 中阅读。"
    return {
        "status": status,
        "message": message,
        "page": page,
        "page_count": page_count,
        "sections": metadata.get("sections", []),
        "abstract_excerpt": "\n\n".join(abstract)[:4_000] or None,
        "blocks": blocks,
    }


async def latest_key_points_run(db: AsyncSession, paper: Material) -> AIRun | None:
    return await db.scalar(
        select(AIRun).where(
            AIRun.project_id == paper.project_id,
            AIRun.material_id == paper.id,
            AIRun.run_type == "material_extraction",
            AIRun.status == "completed",
            AIRun.success.is_(True),
        ).order_by(AIRun.finished_at.desc(), AIRun.id.desc()).limit(1)
    )


async def key_points(db: AsyncSession, paper: Material) -> list[dict]:
    run = await latest_key_points_run(db, paper)
    if run is None:
        return []
    rows = (await db.execute(
        select(ExtractedFact, EvidenceItem, SourceChunk.page_number)
        .join(EvidenceItem, EvidenceItem.fact_id == ExtractedFact.fact_id)
        .outerjoin(SourceChunk, (SourceChunk.material_id == paper.id)
                   & (SourceChunk.chunk_id == EvidenceItem.chunk_id))
        .where(
            ExtractedFact.run_id == run.id,
            ExtractedFact.material_id == paper.id,
            ExtractedFact.extraction_status == "supported",
            EvidenceItem.material_id == paper.id,
            EvidenceItem.verification_status == "verified",
        ).order_by(ExtractedFact.id, EvidenceItem.id)
    )).all()
    points: dict[str, dict] = {}
    for fact, evidence, page in rows:
        if fact.fact_id not in points:
            points[fact.fact_id] = {
                "label": fact.field_label or fact.field_key,
                "value": fact.raw_value,
                "kind": fact.assertion_type,
                "sources": [],
            }
        locator = object_from_json(evidence.source_locator)
        points[fact.fact_id]["sources"].append({
            "page": page or locator.get("viewer_page_number"),
            "quote": evidence.quote,
        })
    return list(points.values())


async def supporting_materials(db: AsyncSession, paper: Material) -> list[Material]:
    return list(await db.scalars(
        select(Material).where(Material.project_id == paper.project_id, Material.material_type != "pdf")
        .order_by(Material.created_at, Material.id)
    ))


def material_view(material: Material) -> dict:
    return {
        "id": material.id,
        "filename": material.source_name,
        "role": "results" if material.material_type in RESULT_TYPES else "reference",
    }


def _result_values(path: Path | None, material_name: str, raw_text: str) -> list[dict] | None:
    try:
        if path is not None:
            with path.open("rb") as stream:
                data = stream.read(4 * MAX_RESULT_TEXT + 1)
            if len(data) > 4 * MAX_RESULT_TEXT:
                return None
            raw_text = data.decode("utf-8-sig")
        if len(raw_text) > MAX_RESULT_TEXT:
            return None
        return [
            result for result in find_result_files({material_name: raw_text}, exact_metrics=True)
            if isfinite(result["value"])
        ]
    except (OSError, ValueError, OverflowError, RecursionError):
        return None


def _report_checks(chunks: list[SourceChunk], candidates: dict[str, list[dict]]) -> tuple[list[dict], int]:
    claims = extract_table_claims(
        [chunk.original_text for chunk in chunks], [page_source(chunk) for chunk in chunks],
        exact_metrics=True,
    )
    claim_counts = Counter(claim["metric_name"] for claim in claims)
    checks = []
    for claim in claims[:MAX_REPORT_CLAIMS]:
        results = candidates.get(claim["metric_name"], [])
        values = [value for value in claim["values"] if isfinite(value)]
        paper_source = {**claim["source_locator"], "quote": claim["raw_line"]}
        if not values or not results:
            status = "missing_evidence"
            note = "需要同名指标的结果文件。"
        elif "%" in claim["raw_line"] or "％" in claim["raw_line"] or any(
            result["percentage"] for result in results
        ):
            status = "needs_review"
            note = "有数值使用百分比，请确认两份材料的单位后再比较。"
        elif claim_counts[claim["metric_name"]] > 1 or len(values) != 1 or len(results) != 1:
            status = "needs_review"
            note = "同名指标有多个数值，请确认对应的实验和结果行。"
        else:
            comparison = verify_figure({**claim, "values": values}, [], results)
            status = "matched" if comparison["verdict"] == "supported" else "difference"
            note = (
                "这两个数值在默认容差内一致，请确认实验条件。"
                if status == "matched" else "这两个数值存在差异，请核对实验条件和指标定义。"
            )
        checks.append({
            "metric": claim["metric_name"],
            "status": status,
            "message": note,
            "paper_values": values,
            "paper_source": paper_source,
            "results": results,
        })
    return checks, len(claims)


async def paper_report(db: AsyncSession, paper: Material) -> dict[str, Any]:
    chunks, _ = await paper_chunks(db, paper)
    materials = []
    candidates: dict[str, list[dict]] = defaultdict(list)
    files = await supporting_materials(db, paper)
    storage = MaterialService(db)
    for material in files:
        item = material_view(material)
        materials.append(item)
        if item["role"] == "reference":
            item["status"] = "reference_only"
            item["message"] = "已收录为参考材料。自动核对使用 CSV、JSON 或 TXT 结果文件。"
            continue
        try:
            path = await storage.path_of(material) if material.stored_path else None
        except (AppError, ParserError):
            results = None
        else:
            results = await to_thread(_result_values, path, material.source_name, material.raw_text)
        item["status"] = "unreadable" if results is None else "included" if results else "no_metric"
        if results is None:
            item["message"] = "无法读取数值，请上传 UTF-8 编码且不超过 20 万字符的结果文件。"
        elif not results:
            item["message"] = "未找到可识别的指标，请确认文件包含指标名称和对应数值。"
        for result in results or []:
            values = candidates[result["metric"]]
            if len(values) < 2:
                values.append({
                    "metric": result["metric"], "value": result["value"],
                    "material_id": material.id, "filename": material.source_name, "source": result["source"],
                    "line": result.get("line"),
                    "percentage": result.get("percentage", False),
                })

    checks, total = await to_thread(_report_checks, chunks, candidates)
    counts = dict.fromkeys(("matched", "difference", "needs_review", "missing_evidence"), 0)
    for check in checks:
        counts[check["status"]] += 1
    status = "insufficient_evidence"
    if counts["difference"]:
        status = "differences_found"
    elif counts["needs_review"] or (counts["matched"] and counts["missing_evidence"]):
        status = "needs_review"
    elif counts["matched"]:
        status = "values_match"
    if total > len(checks) and status == "values_match":
        status = "needs_review"
    messages = {
        "differences_found": "发现数值差异，请根据报告中的原文和结果文件复核。",
        "needs_review": "部分数值还需复核，请查看缺少的证据或对应的实验条件。",
        "values_match": "已核对的数值在默认容差内一致。",
        "insufficient_evidence": (
            "未找出可对照的论文数值，可下载原文核查。"
            if not total else "缺少可对照的结果文件，可以补充材料后再查看报告。"
        ),
    }
    return {
        "status": status,
        "message": messages[status],
        "summary": {**counts, "detected": total, "shown": len(checks)},
        "materials": materials,
        "checks": checks,
        "scope": "核对论文可识别的文本数值与 UTF-8 编码的 CSV、JSON 或 TXT 结果，最多展示 100 条。复现实验和图像核验未执行。",
    }
