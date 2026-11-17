"""跨解析器共享的文本切分（第二阶段）。

切分优先级：自然段落（空行） > 句子/换行 > 字符硬切。
相邻块保留 overlap 字符上下文，尽量不破坏原始语义完整性。
"""
from __future__ import annotations

import re

from app.parsers.limits import CHUNK_OVERLAP_CHARS, MAX_CHUNK_CHARS


def _split_long_unit(unit: str, limit: int) -> list[str]:
    """把一个过长段落拆成若干 <= limit 的小单元。

    优先按句子边界（标点后空白），再按换行，最后才按字符硬切。
    """
    if len(unit) <= limit:
        return [unit]
    # 句子边界：在句末标点后的空白切开（标点保留在前一段）
    sentences = re.split(r"(?<=[。！？!?；;])\s+", unit)
    sentences = [s for s in sentences if s]
    out: list[str] = []
    for sentence in sentences:
        if len(sentence) <= limit:
            out.append(sentence)
            continue
        # 再按换行切
        for line in sentence.split("\n"):
            if not line:
                continue
            if len(line) <= limit:
                out.append(line)
            else:
                # 最后字符硬切
                for i in range(0, len(line), limit):
                    piece = line[i:i + limit]
                    if piece:
                        out.append(piece)
    return out or [unit[:limit]]


def split_text(
    text: str,
    *,
    max_chars: int = MAX_CHUNK_CHARS,
    overlap: int = CHUNK_OVERLAP_CHARS,
) -> list[str]:
    """把文本切成带重叠上下文的块列表。

    - 空文本返回 []；短文本原样返回。
    - overlap 会钳制在 [0, max_chars//2]，避免重叠吞掉正文。
    """
    if text is None:
        return []
    text = str(text)
    if not text:
        return []
    max_chars = max(1, int(max_chars))
    overlap = max(0, min(int(overlap), max_chars // 2))
    if len(text) <= max_chars:
        return [text]

    # 先按空行分段落（丢弃纯空行，但保留段落内换行）
    paragraphs = re.split(r"\n\s*\n", text)
    budget = max_chars - overlap if max_chars - overlap > 0 else max_chars

    units: list[str] = []
    for para in paragraphs:
        if not para.strip():
            continue
        units.extend(_split_long_unit(para, budget))

    # 把小单元打包成块
    chunks: list[str] = []
    current = ""
    for unit in units:
        if not current:
            current = unit
        elif len(current) + len(unit) + 1 <= budget:
            current = current + "\n" + unit
        else:
            chunks.append(current)
            current = unit
    if current:
        chunks.append(current)

    # 相邻块加入上一块尾部 overlap 作为上下文
    result: list[str] = []
    previous = ""
    for chunk in chunks:
        if previous and overlap:
            tail = previous[-overlap:]
            if not chunk.startswith(tail):
                chunk = tail + chunk
        result.append(chunk)
        previous = chunk
    return result
