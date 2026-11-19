"""静态代码分析服务（独立验证引擎第二层，纯 AST 解析）。

职责边界：
- 只对调用方传入的源码字符串做 ast.parse 静态解析，绝不执行任何代码、不访问文件系统；
- 提取的是可复核的确定性观察（imports / 模型类 / 关键调用 / 优化器与 lr），不是复现结论；
- 语法错误如实返回 valid=False，不猜测、不伪造解析结果；
- 中文提示只描述观察事实，不构成失败根因判定。
"""
from __future__ import annotations

import ast
from typing import Any

_METHOD = "ast_static"

# 设置随机种子的常见调用名（末段匹配，覆盖 torch.manual_seed / random.seed 等）
_SEED_CALL_NAMES = {
    "seed", "manual_seed", "set_seed", "seed_everything",
    "random_seed", "init_seed", "initial_seed", "reseed",
}

# 常见优化器类名（末段匹配，覆盖 torch.optim.Adam / keras.optimizers.Adam 等）
_OPTIMIZER_NAMES = {
    "adam", "adamw", "sgd", "rmsprop", "adagrad", "adadelta",
    "lbfgs", "sparseadam", "radam", "lion", "nadam", "optimizer",
}


def _dotted_name(node: ast.AST | None) -> str:
    """把 Name/Attribute/Call 还原为点分名称，用于确定性地识别调用目标。"""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _dotted_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    if isinstance(node, ast.Call):
        return _dotted_name(node.func)
    return ""


def _literal_or_source(node: ast.AST | None) -> Any:
    """优先取字面量值；非字面量仅返回源码文本，绝不求值。"""
    if node is None:
        return None
    try:
        return ast.literal_eval(node)
    except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
        try:
            return ast.unparse(node)
        except Exception:
            return None


def _is_nn_module_base(dotted: str) -> bool:
    """判定基类是否为 nn.Module（含 torch.nn.Module 等限定名）。"""
    if not dotted:
        return False
    parts = dotted.split(".")
    if parts[-1] != "Module":
        return False
    # 裸 Module 或任意以 nn.Module 结尾的限定名（nn.Module / torch.nn.Module）
    return len(parts) == 1 or parts[-2] == "nn"


def _is_optimizer_call(name: str, variable: str | None) -> bool:
    """按调用名末段或赋值变量名确定性识别优化器实例化。"""
    short = name.split(".")[-1].lower() if name else ""
    if short in _OPTIMIZER_NAMES or short.endswith("optimizer"):
        return True
    return bool(variable) and "optimizer" in variable.lower()


class _EvidenceVisitor(ast.NodeVisitor):
    """一次遍历收集全部证据，并携带所在函数上下文。"""

    def __init__(self) -> None:
        self.imports: list[str] = []
        self.model_classes: list[str] = []
        self.train_test_split_calls: list[dict[str, Any]] = []
        self.random_seed_settings: list[dict[str, Any]] = []
        self.optimizer_and_lr: list[dict[str, Any]] = []
        self.functions: list[tuple[int, str]] = []
        self._scope: list[str] = []
        self._assign_targets: dict[int, str] = {}

    @staticmethod
    def _scope_name(visitor: "_EvidenceVisitor") -> str | None:
        return visitor._scope[-1] if visitor._scope else None

    def _record_import(self, name: str) -> None:
        if name and name not in self.imports:
            self.imports.append(name)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._record_import(alias.name)
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        # 只记录模块名（不含具体符号），避免把 import 与调用证据混为一谈。
        self._record_import(node.module or "")
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        if any(_is_nn_module_base(_dotted_name(base)) for base in node.bases):
            if node.name not in self.model_classes:
                self.model_classes.append(node.name)
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.functions.append((node.lineno, node.name))
        self._scope.append(node.name)
        self.generic_visit(node)
        self._scope.pop()

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.functions.append((node.lineno, node.name))
        self._scope.append(node.name)
        self.generic_visit(node)
        self._scope.pop()

    def visit_Assign(self, node: ast.Assign) -> None:
        if isinstance(node.value, ast.Call):
            for target in node.targets:
                name = _dotted_name(target)
                if name:
                    self._assign_targets[id(node.value)] = name
                    break
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        if isinstance(node.value, ast.Call):
            name = _dotted_name(node.target)
            if name:
                self._assign_targets[id(node.value)] = name
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        name = _dotted_name(node.func)
        short = name.split(".")[-1] if name else ""
        scope = self._scope_name(self)
        variable = self._assign_targets.get(id(node))

        if short == "train_test_split":
            self.train_test_split_calls.append({
                "name": name, "line": node.lineno, "col": node.col_offset,
                "function": scope,
            })
        if short.lower() in _SEED_CALL_NAMES or name.lower().endswith("seed"):
            seed_value = _literal_or_source(node.args[0]) if node.args else None
            self.random_seed_settings.append({
                "name": name, "line": node.lineno, "col": node.col_offset,
                "function": scope, "value": seed_value,
            })
        if _is_optimizer_call(name, variable):
            lr_value: Any = None
            lr_keyword: str | None = None
            for kw in node.keywords:
                if kw.arg and kw.arg.lower() in ("lr", "learning_rate", "learningrate"):
                    lr_value = _literal_or_source(kw.value)
                    lr_keyword = kw.arg
                    break
            self.optimizer_and_lr.append({
                "name": name, "line": node.lineno, "col": node.col_offset,
                "function": scope, "variable": variable,
                "lr": lr_value, "lr_keyword": lr_keyword,
            })
        self.generic_visit(node)


def _empty_analysis(error: str | None = None) -> dict[str, Any]:
    """无效源码也返回完整结构，便于上层稳定消费。"""
    result: dict[str, Any] = {
        "valid": error is None,
        "imports": [],
        "model_classes": [],
        "train_test_split_calls": [],
        "random_seed_settings": [],
        "optimizer_and_lr": [],
        "function_defs": [],
        "findings": [],
        "finding_count": 0,
        "method": _METHOD,
    }
    if error is not None:
        result["error"] = error
    return result


def analyze_python_source(source: str) -> dict[str, Any]:
    """解析单文件源码；语法错误返回 valid=False，不抛异常。"""
    if not isinstance(source, str):
        return _empty_analysis("源码必须是字符串。")
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError) as exc:
        lineno = getattr(exc, "lineno", None)
        detail = getattr(exc, "msg", str(exc))
        if lineno:
            return _empty_analysis(f"Python 语法错误（第 {lineno} 行）：{detail}")
        return _empty_analysis(f"Python 语法错误：{detail}")

    visitor = _EvidenceVisitor()
    visitor.visit(tree)

    findings: list[dict[str, Any]] = []
    for imported in visitor.imports:
        findings.append({"kind": "import", "value": imported, "line": None})
    for cls in visitor.model_classes:
        findings.append({"kind": "model_class", "value": cls, "line": None})
    for kind, records in (
        ("train_test_split", visitor.train_test_split_calls),
        ("random_seed", visitor.random_seed_settings),
        ("optimizer", visitor.optimizer_and_lr),
    ):
        for record in records:
            findings.append({
                "kind": kind, "value": record.get("name"),
                "line": record.get("line"),
            })

    result = _empty_analysis()
    result.update({
        "imports": visitor.imports,
        "model_classes": visitor.model_classes,
        "train_test_split_calls": visitor.train_test_split_calls,
        "random_seed_settings": visitor.random_seed_settings,
        "optimizer_and_lr": visitor.optimizer_and_lr,
        "function_defs": [name for _, name in sorted(visitor.functions)],
        "findings": findings,
        "finding_count": len(findings),
    })
    return result


def analyze_project_code(sources: dict[str, str]) -> dict[str, Any]:
    """汇总多文件静态分析结果；warnings 仅为确定性观察，不是根因结论。"""
    if not isinstance(sources, dict):
        sources = {}
    combined: dict[str, list[Any]] = {
        "imports": [],
        "model_classes": [],
        "train_test_split_calls": [],
        "random_seed_settings": [],
        "optimizer_and_lr": [],
        "function_defs": [],
    }
    syntax_errors: list[dict[str, str]] = []
    warnings: list[str] = []
    finding_count = 0

    for filename, source in sorted(sources.items(), key=lambda item: str(item[0])):
        name = str(filename)
        analysis = analyze_python_source(source if isinstance(source, str) else "")
        if not analysis["valid"]:
            syntax_errors.append({"file": name, "error": analysis.get("error", "语法错误")})
            continue
        for key in ("imports", "model_classes", "function_defs"):
            for value in analysis[key]:
                if value not in combined[key]:
                    combined[key].append(value)
        for key in ("train_test_split_calls", "random_seed_settings", "optimizer_and_lr"):
            for record in analysis[key]:
                item = dict(record)
                item["file"] = name
                combined[key].append(item)
        finding_count += analysis["finding_count"]

    # 训练代码判据只用确定性观察：训练/拟合函数、nn.Module 子类、优化器实例化。
    training_functions = [
        name for name in combined["function_defs"]
        if "train" in name.lower() or name.lower() == "fit"
    ]
    has_training_code = bool(
        training_functions or combined["model_classes"] or combined["optimizer_and_lr"]
    )
    if has_training_code and not combined["train_test_split_calls"]:
        warnings.append(
            "静态观察：检测到训练相关代码，但未发现 train_test_split 调用；"
            "数据划分口径需人工核实，此提示不构成根因结论。"
        )
    if has_training_code and not combined["random_seed_settings"]:
        warnings.append(
            "静态观察：检测到训练相关代码，但未发现随机种子设置；"
            "随机性控制需人工核实，此提示不构成根因结论。"
        )

    return {
        "files_analyzed": len(sources),
        "valid_files": len(sources) - len(syntax_errors),
        "syntax_errors": syntax_errors,
        "combined": combined,
        "warnings": warnings,
        "finding_count": finding_count,
        "method": "ast_static_project",
    }
