"""模型凭据安全：独立密钥加密 + API Key 脱敏 + 自定义 Base URL 校验。

安全约束：
- 加密密钥优先来自环境变量 MODEL_CREDENTIAL_KEY，绝不与密文同库、绝不由 JWT_SECRET 派生；
  非严格生产模式下若未配置环境变量，则自动生成并持久化本地独立密钥文件。
- 列表/详情接口永不返回 key_ciphertext，只返回 key_hint（脱敏后 4+2 字符）。
- 自定义 URL 默认仅 HTTPS，检查全部解析地址并固定连接 IP；本地回环需显式开启。
"""
from __future__ import annotations

import base64
import hashlib
import ipaddress
import os
import socket
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from app.core.config import BACKEND_STORAGE, settings
from app.core.logging import logger
from app.modelhub.errors import EncryptionUnavailableError, SSRFBlockedError

_LOCAL_CREDENTIAL_KEY_FILE: Path = BACKEND_STORAGE / ".model_credential_key"

# 云元数据 / 内部管理常见主机名
_BLOCKED_HOSTNAMES = {
    "metadata", "metadata.google.internal", "metadata.goog", "instance-data",
    "169.254.169.254", "kubernetes.default", "kubernetes.default.svc",
    "metadata.azure.internal", "169.254.170.2",
}

# 明确拒绝的网段（含 CGNAT、基准测试、链路本地、IPv6 唯一本地等）
_BLOCKED_NETWORKS = [
    ipaddress.ip_network(n) for n in (
        "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
        "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.168.0.0/16",
        "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4",
        "240.0.0.0/4", "::/128", "::1/128", "fc00::/7", "fe80::/10",
        "ff00::/8", "2001:db8::/32",
    )
]


def mask_key(value: str) -> str:
    """生成可安全展示的脱敏串；不泄露长度信息。"""
    v = (value or "").strip()
    if not v:
        return ""
    if len(v) <= 8:
        return "****"
    return f"{v[:4]}…{v[-2:]}"


def _load_or_create_local_credential_key() -> str:
    """本地/开发模式未显式配置 MODEL_CREDENTIAL_KEY 时，自动生成并持久化独立密钥文件。"""
    key_file = _LOCAL_CREDENTIAL_KEY_FILE
    try:
        existing = key_file.read_text(encoding="utf-8").strip()
        if not existing:
            raise EncryptionUnavailableError()
        return existing
    except FileNotFoundError:
        pass
    except OSError as exc:
        logger.warning("local_model_credential_key_read_failed error=%s", exc)
        raise EncryptionUnavailableError() from exc

    from cryptography.fernet import Fernet

    generated = Fernet.generate_key().decode("ascii")
    temp_path = None
    try:
        key_file.parent.mkdir(parents=True, exist_ok=True)
        descriptor, filename = tempfile.mkstemp(prefix=f"{key_file.name}.", dir=key_file.parent)
        temp_path = Path(filename)
        with os.fdopen(descriptor, "w", encoding="ascii") as handle:
            handle.write(generated + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temp_path, key_file)
        except FileExistsError:
            existing = key_file.read_text(encoding="utf-8").strip()
            if not existing:
                raise EncryptionUnavailableError()
            return existing
    except OSError as exc:
        logger.warning("local_model_credential_key_write_failed error=%s", exc)
        raise EncryptionUnavailableError() from exc
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError as exc:
                logger.warning("local_model_credential_key_cleanup_failed error=%s", exc)

    logger.info("local_model_credential_key_initialized path=%s", key_file.name)
    return generated


def _fernet_key() -> bytes:
    raw = (settings.model_credential_key or "").strip()
    if not raw:
        if settings.strict_production:
            raise EncryptionUnavailableError()
        raw = _load_or_create_local_credential_key()
    try:
        # 标准 Fernet key（urlsafe base64 的 32 字节）；先验证长度与可解码性
        decoded = base64.urlsafe_b64decode(raw.encode("utf-8"))
        if len(decoded) == 32:
            return raw.encode("utf-8")
    except Exception:  # noqa: BLE001 - 非法 base64 视为口令
        pass
    # 口令形式：SHA-256 派生，确定性，且与数据库分离
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_credential(plaintext: str) -> str:
    from cryptography.fernet import Fernet
    return Fernet(_fernet_key()).encrypt((plaintext or "").encode("utf-8")).decode("utf-8")


def decrypt_credential(ciphertext: str) -> str:
    from cryptography.fernet import Fernet, InvalidToken
    try:
        return Fernet(_fernet_key()).decrypt((ciphertext or "").encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise EncryptionUnavailableError() from exc


def redact_secrets(text: str, secrets: list[str]) -> str:
    """从错误文本中移除已知密钥片段，防止经错误堆栈泄露。"""
    out = text or ""
    for s in secrets:
        if s and len(s) >= 4:
            out = out.replace(s, "***REDACTED***")
    return out


def _ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if ip.is_unspecified or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
        return True
    return any(ip in net for net in _BLOCKED_NETWORKS)


def validate_base_url(url: str, *, allow_local: bool | None = None) -> str:
    return resolve_model_endpoint(url, allow_local=allow_local)[0]


def resolve_model_endpoint(url: str, *, allow_local: bool | None = None) -> tuple[str, str]:
    """校验并规范化自定义模型 Base URL；失败抛 SSRFBlockedError。

    返回去掉尾部斜杠的 URL 与固定解析 IP。
    """
    raw = (url or "").strip().rstrip("/")
    if not raw:
        raise SSRFBlockedError("地址不能为空")
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError as exc:
        raise SSRFBlockedError("地址格式非法") from exc

    if parts.username or parts.password:
        raise SSRFBlockedError("不允许在地址中携带用户名或密码")
    if parts.query or parts.fragment:
        raise SSRFBlockedError("地址不允许包含查询参数或片段")
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise SSRFBlockedError("仅允许 HTTP 或 HTTPS 协议")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        raise SSRFBlockedError("缺少主机名")
    path = parts.path or ""
    if ".." in path or "//" in path:
        raise SSRFBlockedError("地址路径非法")

    if host in _BLOCKED_HOSTNAMES or host.endswith(".metadata") or host.endswith(".internal"):
        raise SSRFBlockedError("目标主机属于内部元数据服务")
    local_ok = settings.allow_local_model_endpoint if allow_local is None else allow_local
    local_endpoint = local_ok and host in {"localhost", "127.0.0.1", "::1"}
    if scheme != "https" and not (local_endpoint and scheme == "http"):
        raise SSRFBlockedError("仅允许 HTTPS（本地回环需显式开启）")

    # DNS 解析后检查全部记录，防止域名指向内网
    try:
        infos = socket.getaddrinfo(host, port or (443 if scheme == "https" else 80),
                                   type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        logger.warning("model_url_dns_failure host=%s", host)
        raise SSRFBlockedError("域名无法解析") from exc
    addresses = []
    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr.split("%")[0])
        except ValueError:
            raise SSRFBlockedError("域名解析结果非法")
        checked_ip = (ip.ipv4_mapped or ip) if isinstance(ip, ipaddress.IPv6Address) else ip
        if not (local_endpoint and checked_ip.is_loopback) and (
            local_endpoint or not checked_ip.is_global or _ip_blocked(checked_ip)
        ):
            raise SSRFBlockedError("目标地址指向内网或保留网段")
        addresses.append(str(ip))
    if not addresses:
        raise SSRFBlockedError("域名无法解析")
    return raw, addresses[0]
