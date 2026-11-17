"""结构化日志：绝不输出 API Key 明文或用户完整私有材料。"""
from __future__ import annotations

import logging
import sys

REDACT = ("api_key", "authorization", "token", "secret", "password")


def _safe(value: object) -> object:
    if isinstance(value, dict):
        return {
            k: ("***REDACTED***" if any(r in k.lower() for r in REDACT) else _safe(v))
            for k, v in value.items()
        }
    return value


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(
        "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
    ))
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())


logger = logging.getLogger("reprocheck")
