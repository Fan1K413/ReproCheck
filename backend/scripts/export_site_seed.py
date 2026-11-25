"""导出站点种子数据与 PG schema（Qoder Sites function_backend 迁移用）。

- seed_data.json：站点演示数据，剔除登录凭据、邀请凭据及关联 API 日志；
- schema.sql：仅使用迁移受支持子集（text/integer/bigint/boolean/timestamptz/jsonb）。
Float 标量以 text 存储（迁移不支持 numeric/float），Function 侧负责解析。
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import (JSON, BigInteger, Boolean, DateTime, Float, Integer,
                        Numeric, UniqueConstraint)

from app.models import Base
import app.models.stage2  # noqa: F401
import app.models.stage4  # noqa: F401
import app.models.stage6  # noqa: F401

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "backend" / "reprocheck.db"
OUT_SEED = ROOT / "frontend" / "dev" / "seed_data.json"
OUT_SEED_TS = ROOT / "frontend" / "functions" / "seed_data.ts"
OUT_SCHEMA = ROOT / "frontend" / "dev" / "schema.sql"
_NON_EXPORTABLE_TABLES = {
    "api_tokens", "api_call_logs", "invitations",
    "model_credentials", "model_profiles", "task_model_bindings",
}
_SECRET_COLUMNS = {"password_hash", "token_hash", "token_encrypted", "key_ciphertext"}


def sanitize_seed_table(table: str, rows: list[dict]) -> list[dict]:
    if table in _NON_EXPORTABLE_TABLES:
        return []
    sanitized = []
    for row in rows:
        clean = {key: val for key, val in row.items() if key not in _SECRET_COLUMNS}
        if table == "users":
            # 保留历史所有者引用，但禁止用来源库账号登录站点。
            clean.update(password_hash="!", is_active=False)
        sanitized.append(clean)
    return sanitized


def pg_type(col) -> str:
    t = col.type
    if isinstance(t, JSON):
        return "jsonb"
    if isinstance(t, DateTime):
        return "timestamptz"
    if isinstance(t, Boolean):
        return "boolean"
    if isinstance(t, BigInteger):
        return "bigint"
    if isinstance(t, Integer):
        return "integer"
    if isinstance(t, (Float, Numeric)):
        return "text"
    return "text"


def convert(col, value):
    if value is None:
        return None
    if isinstance(col.type, JSON):
        return json.loads(value) if isinstance(value, str) else value
    if isinstance(col.type, DateTime):
        if isinstance(value, str):
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat().replace("+00:00", "Z")
        return value
    if isinstance(col.type, Boolean):
        return bool(value)
    if isinstance(col.type, (Float, Numeric)):
        return str(value)
    return value


def main() -> None:
    con = sqlite3.connect(DB.resolve().as_uri() + "?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    tables = Base.metadata.sorted_tables
    seed: dict[str, list[dict]] = {}
    for t in tables:
        cols = {c.name: c for c in t.columns}
        rows = con.execute(f'SELECT * FROM "{t.name}"').fetchall()
        seed[t.name] = sanitize_seed_table(t.name, [
            {k: convert(cols[k], r[k]) for k in r.keys() if k in cols} for r in rows
        ])
    OUT_SEED.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(seed, ensure_ascii=False, separators=(",", ":"))
    OUT_SEED.write_text(payload, encoding="utf-8")
    OUT_SEED_TS.write_text(
        "// 由 backend/scripts/export_site_seed.py 生成；仅服务端使用，禁止前端导入。\n"
        "export const SEED: Record<string, Record<string, any>[]> = " + payload + ";\n",
        encoding="utf-8")

    lines: list[str] = []
    for t in tables:
        pk = list(t.primary_key.columns)
        if len(pk) != 1:
            raise SystemExit(f"composite PK unsupported: {t.name}")
        uniques: list[tuple[str, ...]] = []
        for c in t.columns:
            if c.unique and not c.primary_key:
                uniques.append((c.name,))
        for con_ in t.constraints:
            if isinstance(con_, UniqueConstraint):
                uniques.append(tuple(c.name for c in con_.columns))
        for i in t.indexes:
            if i.unique:
                uniques.append(tuple(c.name for c in i.columns))
        seen = set()
        uniques = [u for u in uniques if not (u in seen or seen.add(u))]
        defs = []
        col_unique = {u[0] for u in uniques if len(u) == 1}
        for c in t.columns:
            piece = f"  {c.name} {pg_type(c)}"
            if c.primary_key:
                piece += " PRIMARY KEY"
            elif not c.nullable:
                piece += " NOT NULL"
            if c.name in col_unique and not c.primary_key:
                piece += " UNIQUE"
            for fk in c.foreign_keys:
                piece += f" REFERENCES app.{fk.column.table.name} ({fk.column.name})"
            defs.append(piece)
        for u in uniques:
            if len(u) > 1:
                defs.append("  UNIQUE (" + ", ".join(u) + ")")
        lines.append(f"CREATE TABLE app.{t.name} (\n" + ",\n".join(defs) + "\n);")
        seen_idx: set[tuple[str, ...]] = set()
        for i in t.indexes:
            if i.unique:
                continue
            cols = tuple(c.name for c in i.columns)
            if cols in seen_idx:
                continue
            seen_idx.add(cols)
            lines.append(f"CREATE INDEX {i.name} ON app.{t.name} ({', '.join(cols)});")
    OUT_SCHEMA.parent.mkdir(parents=True, exist_ok=True)
    OUT_SCHEMA.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"seed tables={len(seed)} rows={sum(len(v) for v in seed.values())} bytes={OUT_SEED.stat().st_size}")
    print(f"schema statements={len(lines)} bytes={OUT_SCHEMA.stat().st_size}")


if __name__ == "__main__":
    main()
