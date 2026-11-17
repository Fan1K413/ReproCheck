"""解析器安全限制与错误类型（第二阶段）。

所有硬限制集中在此，防止 ZIP Bomb / 路径穿越 / 超大文件 / 代码执行。
"""
from __future__ import annotations

from pathlib import Path

# 文件大小硬限制
MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024      # 单文件 20MB
MAX_ZIP_TOTAL_UNCOMPRESSED = 100 * 1024 * 1024  # ZIP 解压总量 100MB
MAX_ZIP_ENTRIES = 500                          # ZIP 最多 500 个条目
MAX_PROJECT_MATERIALS = 30                     # 单项目最多 30 个材料
MAX_CHUNK_CHARS = 1800                         # 单文本块上限字符数
CHUNK_OVERLAP_CHARS = 150                      # 相邻块重叠上下文
MAX_PDF_PAGES = 300                            # PDF 最多 300 页
MAX_SEND_TO_LLM_CHARS = 6000                   # 单次送给模型的文本上限

# 允许解析的扩展名白名单（小写，含点）
ALLOWED_EXTENSIONS = {
    ".pdf", ".py", ".ipynb", ".zip",
    ".yaml", ".yml", ".json", ".toml",
    ".txt", ".md", ".markdown",
    ".requirements", ".csv", ".xlsx",
}
# 明确禁止的扩展名（可执行/危险）
BLOCKED_EXTENSIONS = {
    ".exe", ".dll", ".so", ".dylib", ".bat", ".cmd", ".ps1", ".sh",
    ".js", ".ts", ".php", ".rb", ".pl", ".jar", ".class", ".bin",
    ".pkl", ".pickle", ".pt", ".pth", ".ckpt", ".onnx", ".safetensors",
    ".egg", ".whl", ".pyc", ".pyo",
}

# 需要忽略的仓库目录（不送入模型）
IGNORED_DIRS = {
    ".git", ".venv", "venv", "env", "__pycache__", ".pytest_cache",
    ".mypy_cache", "node_modules", "dist", "build", ".idea", ".vscode",
    "wandb", "lightning_logs", "runs", "checkpoints", "outputs",
}


class ParserError(Exception):
    """解析器失败的规范化异常。message 不含文件完整内容。"""

    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class UnsupportedFormatError(ParserError):
    def __init__(self, ext: str):
        super().__init__("UNSUPPORTED_FORMAT", f"不支持的文件格式：{ext or '(无扩展名)'}")


class FileTooLargeError(ParserError):
    def __init__(self, size: int, limit: int):
        super().__init__("FILE_TOO_LARGE", f"文件过大（{size} 字节，上限 {limit} 字节）")


class SuspiciousArchiveError(ParserError):
    def __init__(self, reason: str):
        super().__init__("SUSPICIOUS_ARCHIVE", f"压缩包校验失败：{reason}")


def safe_resolve_within(base: Path, target: Path) -> Path:
    """确保 target 解析后仍在 base 目录内，否则抛异常（路径穿越防护）。"""
    base_resolved = base.resolve()
    target_resolved = target.resolve()
    try:
        target_resolved.relative_to(base_resolved)
    except ValueError:
        raise SuspiciousArchiveError("检测到路径穿越尝试")
    return target_resolved
