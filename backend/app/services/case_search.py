"""基准案例检索（第六阶段 B 组）：结构化筛选 + 纯 Python 轻量相似度。

**定位：参考检索（reference retrieval），不是当前论文事实来源。**
每条结果都带 provenance_class="historical_case" 与 match_basis[]（解释「为什么命中」），
调用方（审计/RAG/前端）不得把相似案例的数值当作当前论文的事实，也不得覆盖当前证据。

算法（无向量数据库、无第三方依赖、无大模型调用）：
1. 可见性 + 结构化筛选复用 benchmark_service.build_visible_stmt（公共 + 本组织 + 本人创建）。
2. 分词：ASCII 词（含 resnet-50 这类连字符整体与子词）+ 中文二元组，去停用词。
3. TF-IDF：字段加权词频（标题/任务/数据集权重更高）× 平滑 IDF，余弦相似度。
4. 结构化命中：research_task / dataset / domain / model_architecture 与查询词的重合。
5. 综合打分并生成中文 match_basis，按分数降序（同分按质量等级、更新时间）。
"""
from __future__ import annotations

import math
import re
from collections import Counter
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.stage6 import BenchmarkCase, User
from app.services import benchmark_service as bs

PROVENANCE_CLASS = "historical_case"
DISCLAIMER = ("检索结果为历史基准案例，仅供参考比对；不得作为当前论文事实，"
              "也不得覆盖当前论文证据（provenance_class=historical_case）。")

# 参与文本相似度计算的字段及其词频权重
SEARCH_FIELDS: dict[str, float] = {
    "title": 2.0,
    "research_task": 1.6,
    "dataset_name": 1.5,
    "model_architecture": 1.4,
    "summary": 1.0,
}
FIELD_LABELS = {"title": "标题", "summary": "摘要", "research_task": "研究任务",
                "model_architecture": "模型架构", "dataset_name": "数据集"}

_STOPWORDS = {
    "the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "with", "by", "is",
    "are", "was", "were", "we", "our", "this", "that", "these", "those", "as", "at",
    "from", "it", "its", "be", "been", "using", "use", "via", "which", "their", "can",
    "also", "than", "then", "so", "such", "both", "each", "per", "when", "while",
    "after", "before", "between", "within", "without", "up", "down", "out", "over",
    "under", "again", "more", "most", "other", "some", "any", "all", "not", "no",
    "paper", "study", "approach", "results", "result", "et", "al",
    "的", "了", "和", "与", "及", "在", "是", "对", "为", "以", "并", "或", "等",
    "中", "上", "下", "我们", "本文", "该", "此", "其", "以及", "通过", "进行",
    "使用", "采用", "基于", "一种", "一个", "论文", "研究", "方法", "实验",
}
_ASCII_RE = re.compile(r"[a-z0-9][a-z0-9._+\-]*")
_CJK_RE = re.compile(r"[\u4e00-\u9fff]+")
_SPLIT_RE = re.compile(r"[-_.+/]")


def tokenize(text: str) -> list[str]:
    """小写分词：ASCII 词 + 连字符子词 + 中文二元组，去停用词与单字符噪声。"""
    s = (text or "").lower()
    tokens: list[str] = []
    for match in _ASCII_RE.finditer(s):
        tok = match.group(0).strip("._+-")
        if not tok or tok in _STOPWORDS:
            continue
        if len(tok) > 1 or tok.isdigit():
            tokens.append(tok)
        for part in _SPLIT_RE.split(tok):
            part = part.strip()
            if len(part) > 1 and part not in _STOPWORDS and part != tok:
                tokens.append(part)
    for run in _CJK_RE.findall(s):
        if len(run) == 1:
            if run not in _STOPWORDS:
                tokens.append(run)
            continue
        for i in range(len(run) - 1):
            gram = run[i:i + 2]
            if gram not in _STOPWORDS:
                tokens.append(gram)
    return tokens


def _compact(text: str) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", (text or "").lower())


def _case_text(case: BenchmarkCase) -> dict[str, str]:
    return {field: str(getattr(case, field, "") or "") for field in SEARCH_FIELDS}


def _weighted_tf(case: BenchmarkCase) -> Counter:
    tf: Counter = Counter()
    for field, weight in SEARCH_FIELDS.items():
        for tok in tokenize(str(getattr(case, field, "") or "")):
            tf[tok] += weight
    return tf


def _idf(doc_freq: Counter, n_docs: int) -> dict[str, float]:
    return {tok: math.log((1 + n_docs) / (1 + df)) + 1.0 for tok, df in doc_freq.items()}


def _cosine(query_vec: dict[str, float], doc_vec: dict[str, float]) -> float:
    if not query_vec or not doc_vec:
        return 0.0
    dot = sum(w * doc_vec.get(tok, 0.0) for tok, w in query_vec.items())
    qn = math.sqrt(sum(w * w for w in query_vec.values()))
    dn = math.sqrt(sum(w * w for w in doc_vec.values()))
    if qn == 0 or dn == 0:
        return 0.0
    return dot / (qn * dn)


def _vec(tf: Counter, idf: dict[str, float]) -> dict[str, float]:
    return {tok: weight * idf.get(tok, math.log(2.0) + 1.0) for tok, weight in tf.items()}


def _structured_hits(case: BenchmarkCase, query_tokens: set[str],
                     query_compact: str) -> list[tuple[str, str]]:
    """返回 (命中类型, 中文 match_basis) 列表。"""
    hits: list[tuple[str, str]] = []
    texts = _case_text(case)

    def covers(value: str) -> bool:
        if not value.strip():
            return False
        toks = set(tokenize(value))
        if toks and toks.issubset(query_tokens):
            return True
        compact = _compact(value)
        return bool(compact) and len(compact) >= 3 and compact in query_compact

    if covers(texts["research_task"]):
        hits.append(("research_task", f"research_task 匹配: {case.research_task}"))
    if covers(texts["dataset_name"]):
        hits.append(("dataset", f"dataset 相同: {case.dataset_name}"))
    if covers(str(case.domain or "")):
        hits.append(("domain", f"domain 匹配: {case.domain}"))
    if covers(texts["model_architecture"]):
        hits.append(("model_architecture", f"模型架构相似: {case.model_architecture}"))
    return hits


def _text_basis(query_tokens: list[str], doc_tokens: set[str],
                idf: dict[str, float]) -> str | None:
    """把重合词还原为可读短语（learning rate / batch size），否则列高权重词。"""
    shared = [t for t in query_tokens if t in doc_tokens]
    if not shared:
        return None
    phrases: list[str] = []
    seen: set[str] = set()
    for i in range(len(query_tokens) - 1):
        a, b = query_tokens[i], query_tokens[i + 1]
        if a in doc_tokens and b in doc_tokens and a.isalpha() and b.isalpha():
            phrase = f"{a} {b}"
            if phrase not in seen:
                seen.add(phrase)
                phrases.append(phrase)
        if len(phrases) >= 3:
            break
    if phrases:
        return "文本相似项: " + ", ".join(phrases)
    ranked = sorted(set(shared), key=lambda t: -idf.get(t, 0.0))[:4]
    return "文本相似项: " + ", ".join(ranked)


async def search_cases(db: AsyncSession, user: User, query: str,
                       filters: dict[str, Any] | None = None,
                       top_k: int = 10) -> list[dict[str, Any]]:
    """检索可见基准案例，返回 [{case, score, match_basis[], provenance_class, ...}]。

    filters 支持 domain/research_task/dataset/quality_level/q/org_id/is_public/min_quality。
    结构化筛选为硬约束；query 为空时按质量等级与更新时间返回参考列表。
    """
    filters = dict(filters or {})
    top_k = bs.int_param(top_k, 10, 1, 50)
    query_text = str(query or "").strip()
    min_quality = str(filters.pop("min_quality", "") or "").strip()
    if min_quality and min_quality not in bs.QUALITY_RANK:
        raise AppError("VALIDATION_ERROR", f"min_quality 须为 {list(bs.QUALITY_RANK)}。")
    min_score = filters.pop("min_score", None)
    try:
        min_score = float(min_score) if min_score not in (None, "") else None
    except (TypeError, ValueError):
        raise AppError("VALIDATION_ERROR", "min_score 须为数值。")

    stmt = await bs.build_visible_stmt(db, user, filters)
    cases = list((await db.execute(stmt.order_by(BenchmarkCase.created_at.desc()))).scalars().all())
    if min_quality:
        floor = bs.QUALITY_RANK[min_quality]
        cases = [c for c in cases if bs.QUALITY_RANK.get(c.quality_level or "unverified", 0) >= floor]
    if not cases:
        return []

    query_tokens = tokenize(query_text)
    query_token_set = set(query_tokens)
    query_compact = _compact(query_text)
    query_tf = Counter(query_tokens)

    doc_tfs = {c.id: _weighted_tf(c) for c in cases}
    doc_freq: Counter = Counter()
    for tf in doc_tfs.values():
        doc_freq.update(tf.keys())
    idf = _idf(doc_freq, len(cases))
    query_vec = _vec(query_tf, idf) if query_tf else {}

    active_filters = {k: v for k, v in filters.items()
                      if v not in (None, "", []) and k in
                      ("domain", "research_task", "dataset", "dataset_name",
                       "quality_level", "org_id", "is_public", "q")}

    results: list[dict[str, Any]] = []
    for case in cases:
        tf = doc_tfs[case.id]
        doc_tokens = set(tf.keys())
        cosine = _cosine(query_vec, _vec(tf, idf)) if query_vec else 0.0
        hits = _structured_hits(case, query_token_set, query_compact) if query_text else []
        hit_types = {kind for kind, _ in hits}

        score = 0.60 * cosine
        score += 0.18 if "research_task" in hit_types else 0.0
        score += 0.12 if "dataset" in hit_types else 0.0
        score += 0.05 if "domain" in hit_types else 0.0
        score += 0.05 if "model_architecture" in hit_types else 0.0

        basis: list[str] = [text for _, text in hits]
        title_lower = (case.title or "").lower()
        if query_text and len(query_text) >= 4 and query_text.lower() in title_lower:
            score += 0.10
            basis.insert(0, f"标题包含查询短语: {query_text}")
        text_basis = _text_basis(query_tokens, doc_tokens, idf) if query_text else None
        if text_basis:
            basis.append(text_basis)
        for key, value in active_filters.items():
            basis.append(f"筛选条件命中: {key}={value}")
        if min_quality:
            basis.append(f"质量等级不低于 {min_quality}")
        level = case.quality_level or "unverified"
        basis.append(f"质量等级: {level}（{bs.QUALITY_LABELS.get(level, '未验证')}）")
        if not query_text:
            basis.insert(0, "未提供查询词：按质量等级与更新时间排序的参考列表")
        elif not hits and cosine <= 0.0:
            basis.append("仅结构化筛选命中，文本无相似项")

        score = round(min(1.0, score), 4)
        if query_text and score <= 0.0 and not active_filters:
            continue
        if min_score is not None and score < min_score:
            continue
        results.append({
            "case": bs.case_view(case),
            "score": score,
            "match_basis": basis,
            "matched_fields": sorted(hit_types | ({"text"} if cosine > 0 else set())),
            "text_similarity": round(cosine, 4),
            "provenance_class": PROVENANCE_CLASS,
            "usage_note": "历史案例参考，不得作为当前论文事实。",
        })

    # 分数降序；同分时优先高质量等级与更近更新时间
    results.sort(key=lambda r: (-r["score"],
                                -bs.QUALITY_RANK.get(r["case"]["quality_level"], 0),
                                _neg_timestamp(r["case"]["updated_at"])))
    return results[:top_k]


def _neg_timestamp(iso: str) -> float:
    try:
        return -datetime.fromisoformat(iso).timestamp()
    except (ValueError, TypeError):
        return 0.0


def search_meta(query: str, total: int, top_k: int) -> dict[str, Any]:
    return {
        "query": str(query or "").strip(),
        "total": total,
        "top_k": top_k,
        "provenance_class": PROVENANCE_CLASS,
        "disclaimer": DISCLAIMER,
        "algorithm": "structured_filters + weighted_tfidf_cosine (pure python, no vector db)",
        "score_weights": {"text_cosine": 0.60, "research_task": 0.18, "dataset": 0.12,
                          "domain": 0.05, "model_architecture": 0.05, "title_phrase": 0.10},
        "search_fields": {k: {"weight": w, "label": FIELD_LABELS[k]} for k, w in SEARCH_FIELDS.items()},
    }