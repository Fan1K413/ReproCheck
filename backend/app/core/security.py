"""第六阶段身份与凭据安全：密码哈希、JWT、对称加密、令牌生成。

密码用 stdlib pbkdf2_hmac（无需 bcrypt 依赖）；JWT 用 PyJWT HS256；
仓库凭据/API Token 加密用 cryptography.Fernet。密钥仅来自后端配置，绝不回显。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

_PBKDF2_ITERATIONS = 200_000


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:16]}"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_hex, dk_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                                 bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(dk.hex(), dk_hex)
    except (ValueError, AttributeError):
        return False


def create_access_token(user_id: str, email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "iat": now,
        "exp": now + timedelta(hours=settings.jwt_expire_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    """解码并校验 JWT；失败抛 jwt.PyJWTError（由调用方转 401）。"""
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


def _fernet() -> Fernet:
    if settings.encryption_key:
        key = settings.encryption_key.encode("utf-8")
    else:
        digest = hashlib.sha256(settings.jwt_secret.encode("utf-8")).digest()
        key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("凭据解密失败：加密密钥不匹配或数据损坏。") from exc


def generate_token(prefix: str = "rc") -> tuple[str, str]:
    """返回 (明文令牌, sha256 哈希)。明文仅创建时返回一次，DB 只存哈希。"""
    plain = f"{prefix}_{secrets.token_urlsafe(32)}"
    return plain, hash_token(plain)


def hash_token(plain: str) -> str:
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()