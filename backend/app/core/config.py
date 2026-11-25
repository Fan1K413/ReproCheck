"""应用配置：仅从环境变量 / .env 读取，密钥绝不进入前端或日志。"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
BACKEND_STORAGE = BACKEND_DIR / "storage"
_DEFAULT_SQLITE_PATH = (BACKEND_DIR / "reprocheck.db").as_posix()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # backend/.env 与项目根目录 .env 均可，根目录优先由启动命令注入
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        populate_by_name=True,
    )

    # LLM
    llm_provider: str = "qwen"
    llm_api_key: str = ""
    llm_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    llm_model: str = "qwen-plus"
    llm_timeout: float = Field(default=60.0, gt=0)
    llm_max_retries: int = Field(default=1, ge=0, le=5)

    # DB
    database_url: str = f"sqlite+aiosqlite:///{_DEFAULT_SQLITE_PATH}"
    sync_database_url: str = f"sqlite:///{_DEFAULT_SQLITE_PATH}"

    # Auth
    admin_token: str = ""
    allow_unauth_test_endpoints: bool = False
    strict_production: bool = False

    # Stage6 身份与凭据安全
    jwt_secret: str = "dev-insecure-change-me"
    jwt_expire_hours: int = 12
    encryption_key: str = ""  # 生产必填；为空时由 jwt_secret 派生（仅开发）
    # 第十一阶段：模型 API 凭据独立加密密钥（Fernet key 或口令）。
    # 必须与数据库、JWT_SECRET、ENCRYPTION_KEY 分离；为空时拒绝保存用户 API Key。
    model_credential_key: str = ""
    # 仅开发/内网测试：允许 http://localhost 自定义模型端点。生产必须 false。
    allow_local_model_endpoint: bool = False
    bootstrap_admin_email: str = ""
    bootstrap_admin_password: str = ""
    invitation_expire_days: int = 7
    open_api_default_rate_limit: int = 60  # 次/分钟
    # 治理：开启后，调用外部 LLM 前必须存在有效的 AI 授权（ai_consent），否则明确拒绝。
    # 默认关闭以兼容本地演示与既有测试；生产建议设为 True。
    require_ai_consent: bool = False
    data_retention_days: int = 365

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    # CORS：默认放行以支持本地前端；生产须在部署配置中收敛为具体域名。
    # 用字符串承载，避免 pydantic-settings 对 list 字段强制 JSON 解码；
    # 通过 cors_origins 属性提供 list，支持 JSON 数组与逗号分隔两种写法。
    cors_allow_origins_raw: str = Field(
        default="*",
        validation_alias=AliasChoices("CORS_ALLOW_ORIGINS_RAW", "CORS_ALLOW_ORIGINS"),
    )

    # 普通请求上限。上传按材料和交接包各自的限制处理。
    max_request_bytes: int = Field(default=1024 * 1024, gt=0)

    # 第四阶段：安全隔离执行（默认关闭；无安全容器时绝不执行用户代码）
    enable_code_execution: bool = False
    execution_backend: str = "none"   # none / rootless_docker / gvisor（当前环境仅 none）
    execution_timeout_seconds: int = 300
    execution_max_cpu_seconds: int = 120
    execution_max_memory_mb: int = 2048
    execution_max_pids: int = 128
    execution_allow_network: bool = False

    # 第七阶段：科研工作流编排限制（策略上限；只读检查类处理器不消耗执行配额）
    workflow_max_concurrent_nodes: int = Field(default=1, ge=1, le=8)
    workflow_node_timeout_seconds: int = Field(default=300, gt=0)
    workflow_max_auto_retries: int = Field(default=2, ge=0, le=5)
    workflow_stale_minutes: int = Field(default=15, gt=0)

    @field_validator("llm_base_url")
    @classmethod
    def _strip_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @property
    def cors_origins(self) -> list[str]:
        """解析 CORS 来源：支持 JSON 数组与逗号分隔两种写法。"""
        s = (self.cors_allow_origins_raw or "").strip()
        if not s:
            return []
        if s.startswith("["):
            try:
                parsed = __import__("json").loads(s)
                return [str(x) for x in parsed] if isinstance(parsed, list) else [s]
            except (ValueError, TypeError):
                return [s]
        return [x.strip() for x in s.split(",") if x.strip()]

    @property
    def is_llm_configured(self) -> bool:
        return bool(self.llm_api_key.strip())

    @property
    def provider_kind(self) -> Literal["qwen", "openai_compatible"]:
        return "qwen" if self.llm_provider.strip().lower() == "qwen" else "openai_compatible"

    def strict_production_check(self) -> list[str]:
        """返回生产部署必须修复的不安全配置项清单（纯函数，不改状态）。

        设计意图：默认值保持开发态以兼容本地演示与既有测试；部署方在上线前
        显式调用本函数（或启动时看警告）确认没有遗漏。返回空列表表示通过。
        """
        issues: list[str] = []
        if self.allow_unauth_test_endpoints:
            issues.append("allow_unauth_test_endpoints=True：匿名请求可访问项目接口，生产必须为 False")
        if not self.jwt_secret or self.jwt_secret == "dev-insecure-change-me" or len(self.jwt_secret) < 32:
            issues.append("jwt_secret 仍为开发默认值或长度不足 32：生产必须设置高强度随机密钥")
        if not self.encryption_key or len(self.encryption_key) < 16:
            issues.append("encryption_key 为空或过短：生产必须设置独立加密密钥（不能依赖 jwt_secret 派生）")
        if not self.model_credential_key:
            issues.append("model_credential_key 为空：用户级 API Key 无法安全加密存储，模型管理中心不可用")
        if self.allow_local_model_endpoint:
            issues.append("allow_local_model_endpoint=True：生产必须关闭，禁止访问本地模型端点")
        if "*" in self.cors_origins:
            issues.append("CORS allow_origins 含 '*'：生产必须收敛为前端域名")
        if not self.require_ai_consent:
            issues.append("require_ai_consent=False：生产建议开启 AI 授权门禁")
        if self.enable_code_execution and self.execution_backend == "none":
            issues.append("enable_code_execution=True 但 execution_backend=none：不可执行不可信代码")
        return issues


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
