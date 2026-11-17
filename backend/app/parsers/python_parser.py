"""Python 源码静态解析器（第二阶段）。

绝对禁止执行用户代码：仅使用标准库 ast / tokenize 做静态分析。
提取 import 依赖、函数/类及其行号与参数、关键超参数赋值、argparse 默认值、
训练入口，为每项生成一个带 CodeLocator 的 SourceChunk。
"""
from __future__ import annotations

import ast
from pathlib import Path

from app.parsers._common import semantic_label
from app.parsers.limits import ParserError
from app.schemas.parsing import CodeLocator, ParseResult, SourceChunk

PARSER_VERSION = "python-ast-v1"


def _segment(text: str, node: ast.AST) -> str:
    """取节点对应的原始源码片段；失败时回退到 ast.unparse。"""
    seg = ast.get_source_segment(text, node)
    if seg is not None:
        return seg.strip()
    try:
        return ast.unparse(node).strip()
    except Exception:
        return ""


def _end_line(node: ast.AST) -> int:
    return int(getattr(node, "end_lineno", None) or getattr(node, "lineno", 1))


def _make_chunk(
    *,
    material_id: str,
    project_id: str,
    file_path: str,
    seq: int,
    start_line: int,
    end_line: int,
    symbol: str | None,
    content: str,
) -> SourceChunk:
    locator = CodeLocator(
        file_path=file_path,
        start_line=start_line,
        end_line=end_line,
        symbol=symbol,
    )
    return SourceChunk(
        chunk_id=f"py_{material_id}_{seq:03d}",
        project_id=project_id,
        material_id=material_id,
        material_type="python",
        chunk_index=seq - 1,
        content=content,
        content_hash=SourceChunk.make_hash(content),
        parser_version=PARSER_VERSION,
        source_locator=locator.model_dump(),
        token_estimate=max(1, len(content) // 4),
    )


def _target_name(target: ast.AST) -> str | None:
    """从赋值目标中提取变量名（Name 或 xxx.attr）。"""
    if isinstance(target, ast.Name):
        return target.id
    if isinstance(target, ast.Attribute):
        return target.attr
    return None


def parse_python_text(
    text: str,
    *,
    file_path: str,
    material_id: str,
    project_id: str,
) -> ParseResult:
    """从内存字符串解析 Python（ZIP 内文件与单文件共享此逻辑）。不执行代码。"""
    base = dict(material_id=material_id)

    # 1) 先做语法解析；语法错误绝不伪造结果
    try:
        tree = ast.parse(text, filename=file_path)
    except (SyntaxError, ValueError) as exc:  # ValueError 覆盖含 null 字节等情况
        lineno = getattr(exc, "lineno", None)
        detail = f"Python 语法错误（第 {lineno} 行）：{exc.msg}" if lineno else f"Python 语法错误：{exc}"
        return ParseResult(
            **base,
            material_type="python",
            parser_version=PARSER_VERSION,
            status="failed",
            error_code="PYTHON_SYNTAX_ERROR",
            error_message=detail,
        )

    lines = text.splitlines()
    meta: dict = {
        "imports": [],
        "functions": [],
        "classes": [],
        "key_parameters": [],
        "argparse_defaults": [],
        "entry_points": [],
    }

    # (start_line, end_line, symbol, content) — 最后按行号排序统一生成 chunk
    items: list[tuple[int, int, str, str]] = []

    # 2) import 依赖（聚合为一个 chunk）
    import_nodes = [
        n for n in ast.walk(tree)
        if isinstance(n, (ast.Import, ast.ImportFrom))
    ]
    if import_nodes:
        for node in import_nodes:
            if isinstance(node, ast.Import):
                for alias in node.names:
                    meta["imports"].append(alias.name)
            else:
                module = node.module or ""
                for alias in node.names:
                    meta["imports"].append(f"{module}.{alias.name}" if module else alias.name)
        imp_content = "\n".join(
            seg for seg in (_segment(text, n) for n in import_nodes) if seg
        )
        start = min(n.lineno for n in import_nodes)
        end = max(_end_line(n) for n in import_nodes)
        items.append((start, end, "imports", imp_content))

    # 3) 函数（含异步函数）与类：名称 + 起止行号 + 参数
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            args = []
            a = node.args
            for arg in list(a.posonlyargs) + list(a.args) + list(a.kwonlyargs):
                if arg.arg not in ("self", "cls"):
                    args.append(arg.arg)
            if a.vararg:
                args.append("*" + a.vararg.arg)
            if a.kwarg:
                args.append("**" + a.kwarg.arg)
            meta["functions"].append({
                "name": node.name,
                "start_line": node.lineno,
                "end_line": _end_line(node),
                "args": args,
            })
            items.append((node.lineno, _end_line(node), node.name, _segment(text, node)))
            if node.name in ("train", "main"):
                meta["entry_points"].append({"type": "function", "name": node.name, "line": node.lineno})
        elif isinstance(node, ast.ClassDef):
            meta["classes"].append({
                "name": node.name,
                "start_line": node.lineno,
                "end_line": _end_line(node),
            })
            items.append((node.lineno, _end_line(node), node.name, _segment(text, node)))

    # 4) 关键超参数赋值（命中别名表才算）
    assign_nodes: list[ast.AST] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            assign_nodes.append(node)
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            assign_nodes.append(node)
    for node in assign_nodes:
        if isinstance(node, ast.Assign):
            targets = node.targets
            value_node = node.value
        else:  # AnnAssign
            targets = [node.target]
            value_node = node.value
        key = None
        for target in targets:
            name = _target_name(target)
            if name and semantic_label(name):
                key = name
                break
        if not key:
            continue
        raw_value = _segment(text, value_node)
        start = node.lineno
        end = _end_line(node)
        meta["key_parameters"].append({
            "field": key,
            "semantic_label": semantic_label(key),
            "raw_value": raw_value,
            "start_line": start,
            "end_line": end,
            "file_path": file_path,
            "source_text": _segment(text, node),
        })
        items.append((start, end, key, _segment(text, node)))

    # 5) argparse add_argument 默认值
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        if node.func.attr != "add_argument":
            continue
        if not node.args or not isinstance(node.args[0], ast.Constant):
            continue
        flag = node.args[0].value
        if not isinstance(flag, str):
            continue
        key = flag.lstrip("-").replace("-", "_")
        default = None
        for kw in node.keywords:
            if kw.arg == "default":
                default = _segment(text, kw.value)
                break
        meta["argparse_defaults"].append({
            "flag": flag,
            "key": key,
            "semantic_label": semantic_label(key),
            "default": default,
            "line": node.lineno,
        })
        items.append((node.lineno, _end_line(node), f"argparse:{key}", _segment(text, node)))

    # 6) 训练入口 if __name__ == "__main__"
    for node in ast.walk(tree):
        if not isinstance(node, ast.If):
            continue
        test = node.test
        if (
            isinstance(test, ast.Compare)
            and isinstance(test.left, ast.Name)
            and test.left.id == "__name__"
        ):
            meta["entry_points"].append({"type": "__main__", "name": "__main__", "line": node.lineno})
            items.append((node.lineno, _end_line(node), "__main__", _segment(text, node)))
            break

    # 7) 统一生成 chunk（按起始行排序保证确定性）
    items.sort(key=lambda x: (x[0], x[1], x[2]))
    chunks = [
        _make_chunk(
            material_id=material_id,
            project_id=project_id,
            file_path=file_path,
            seq=seq,
            start_line=start,
            end_line=end,
            symbol=symbol,
            content=content or "",
        )
        for seq, (start, end, symbol, content) in enumerate(items, 1)
    ]

    # 空文件：没有任何可提取内容 → failed，绝不返回空的成功结果
    if not chunks:
        return ParseResult(
            **base,
            material_type="python",
            parser_version=PARSER_VERSION,
            status="failed",
            error_code="EMPTY_FILE",
            error_message="Python 文件中未提取到任何可解析结构",
            metadata={"lines": len(lines)},
        )

    return ParseResult(
        **base,
        material_type="python",
        parser_version=PARSER_VERSION,
        status="completed",
        chunks=chunks,
        metadata=meta,
    )


def parse_python(
    path: Path,
    *,
    material_id: str,
    project_id: str,
) -> ParseResult:
    """统一入口：读取 .py 文件后交给 parse_python_text。"""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError) as exc:
        return ParseResult(
            material_id=material_id,
            material_type="python",
            parser_version=PARSER_VERSION,
            status="failed",
            error_code="ENCODING_ERROR",
            error_message=f"无法读取 Python 文件：{exc}",
        )
    return parse_python_text(
        text,
        file_path=Path(path).name,
        material_id=material_id,
        project_id=project_id,
    )
