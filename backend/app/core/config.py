"""应用配置：仅从环境变量 / .env 读取，密钥绝不进入前端或日志。"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # backend/.env 与项目根目录 .env 均可，根目录优先由启动命令注入
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # LLM
    llm_provider: str = "qwen"
    llm_api_key: str = ""
    llm_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    llm_model: str = "qwen-plus"
    llm_timeout: float = Field(default=60.0, gt=0)
    llm_max_retries: int = Field(default=1, ge=0, le=5)

    # DB
    database_url: str = "sqlite+aiosqlite:///./reprocheck.db"
    sync_database_url: str = "sqlite:///./reprocheck.db"

    # Auth
    admin_token: str = ""
    allow_unauth_test_endpoints: bool = True

    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    # 单次请求体上限：1MB，防止超大材料滥用
    max_request_bytes: int = 1024 * 1024

    # 第四阶段：安全隔离执行（默认关闭；无安全容器时绝不执行用户代码）
    enable_code_execution: bool = False
    execution_backend: str = "none"   # none / rootless_docker / gvisor（当前环境仅 none）
    execution_timeout_seconds: int = 300
    execution_max_cpu_seconds: int = 120
    execution_max_memory_mb: int = 2048
    execution_max_pids: int = 128
    execution_allow_network: bool = False

    @field_validator("llm_base_url")
    @classmethod
    def _strip_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @property
    def is_llm_configured(self) -> bool:
        return bool(self.llm_api_key.strip())

    @property
    def provider_kind(self) -> Literal["qwen", "openai_compatible"]:
        return "qwen" if self.llm_provider.strip().lower() == "qwen" else "openai_compatible"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
