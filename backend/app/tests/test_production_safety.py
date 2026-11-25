"""生产安全自检测试（不破坏开发默认配置）。"""
from __future__ import annotations

from app.core.config import Settings


def test_default_dev_config_reports_issues():
    s = Settings(_env_file=None)
    issues = s.strict_production_check()
    assert s.allow_unauth_test_endpoints is False
    assert any("jwt_secret" in i for i in issues)
    assert any("CORS" in i for i in issues)


def test_hardened_config_passes(monkeypatch):
    s = Settings(_env_file=None)
    s.allow_unauth_test_endpoints = False
    s.jwt_secret = "x" * 48
    s.encryption_key = "y" * 32
    s.model_credential_key = "z" * 32  # 第十一阶段新增：用户凭据独立加密密钥
    s.cors_allow_origins_raw = "https://lab.example.edu"
    s.require_ai_consent = True
    s.enable_code_execution = False
    assert s.strict_production_check() == []


def test_code_execution_without_backend_flagged():
    s = Settings(_env_file=None)
    s.allow_unauth_test_endpoints = False
    s.jwt_secret = "x" * 48
    s.encryption_key = "y" * 32
    s.model_credential_key = "z" * 32
    s.cors_allow_origins_raw = "https://lab.example.edu"
    s.require_ai_consent = True
    s.enable_code_execution = True
    s.execution_backend = "none"
    issues = s.strict_production_check()
    assert any("execution_backend=none" in i for i in issues)


def test_check_does_not_mutate_settings():
    s = Settings(_env_file=None)
    before = (s.allow_unauth_test_endpoints, s.jwt_secret)
    s.strict_production_check()
    assert (s.allow_unauth_test_endpoints, s.jwt_secret) == before


def test_cors_field_parses_both_formats():
    """CORS 字段支持 JSON 数组与逗号分隔两种写法。"""
    s = Settings(_env_file=None)
    assert s.cors_origins == ["*"]
    s.cors_allow_origins_raw = "https://a.com,https://b.com"
    assert s.cors_origins == ["https://a.com", "https://b.com"]
    s.cors_allow_origins_raw = '["https://c.com"]'
    assert s.cors_origins == ["https://c.com"]


def test_dotenv_production_settings(tmp_path):
    env = tmp_path / ".env"
    env.write_text("STRICT_PRODUCTION=1\nCORS_ALLOW_ORIGINS=https://lab.example.edu\n")
    s = Settings(_env_file=env)
    assert s.strict_production is True
    assert s.cors_origins == ["https://lab.example.edu"]
