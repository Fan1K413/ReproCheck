"""第二阶段幂等数据库迁移。

不删库、不重建：用 SQLAlchemy Inspector 检测现有表/列，缺则 ALTER ADD COLUMN / CREATE TABLE。
既能在空库运行，也能在已有第一阶段数据的库上运行，旧数据一律保留。

迁移在 init_db() 中调用；也可单独运行：
    python -m app.db.migrate
"""
from __future__ import annotations

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy import inspect

from app.core.config import settings
from app.core.logging import logger

# (表名, 列名, SQLite 列定义) —— 全部 nullable 或有默认值，保证 ALTER 成功
STAGE2_COLUMNS: list[tuple[str, str, str]] = [
    # materials
    ("materials", "original_filename", "VARCHAR(300)"),
    ("materials", "stored_path", "VARCHAR(500)"),
    ("materials", "file_size_bytes", "INTEGER DEFAULT 0"),
    ("materials", "sha256", "VARCHAR(64)"),
    ("materials", "mime_type", "VARCHAR(120)"),
    ("materials", "parse_status", "VARCHAR(30) DEFAULT 'uploaded'"),
    ("materials", "parser_version", "VARCHAR(40)"),
    ("materials", "parse_error_code", "VARCHAR(60)"),
    ("materials", "parse_error_message", "TEXT"),
    ("materials", "parse_duration_ms", "INTEGER DEFAULT 0"),
    ("materials", "page_count", "INTEGER"),
    ("materials", "needs_ocr", "BOOLEAN DEFAULT 0"),
    ("materials", "parse_metadata_json", "TEXT"),
    ("materials", "warnings_json", "TEXT"),
    # source_chunks
    ("source_chunks", "project_id", "VARCHAR(36)"),
    ("source_chunks", "material_type", "VARCHAR(40)"),
    ("source_chunks", "content_hash", "VARCHAR(64)"),
    ("source_chunks", "parser_version", "VARCHAR(40)"),
    ("source_chunks", "source_locator_json", "TEXT"),
    ("source_chunks", "token_estimate", "INTEGER DEFAULT 0"),
    # extracted_facts
    ("extracted_facts", "fact_id", "VARCHAR(60)"),
    ("extracted_facts", "fact_type", "VARCHAR(40) DEFAULT 'training_parameter'"),
    ("extracted_facts", "field_label", "VARCHAR(200)"),
    ("extracted_facts", "assertion_type", "VARCHAR(20) DEFAULT 'explicit'"),
    ("extracted_facts", "extraction_status", "VARCHAR(20) DEFAULT 'supported'"),
    ("extracted_facts", "parser_source", "VARCHAR(20) DEFAULT 'model'"),
    ("extracted_facts", "extraction_run_id", "VARCHAR(60)"),
    ("extracted_facts", "quote", "TEXT"),
    ("extracted_facts", "source_locator_json", "TEXT"),
    ("extracted_facts", "source_name", "VARCHAR(200)"),
    ("extracted_facts", "revision_count", "INTEGER DEFAULT 0"),
    ("extracted_facts", "ai_original_json", "TEXT"),
    ("extracted_facts", "created_at", "DATETIME"),
    # ai_runs
    ("ai_runs", "task_type", "VARCHAR(40)"),
    ("ai_runs", "prompt_version", "VARCHAR(40)"),
    ("ai_runs", "material_id", "VARCHAR(36)"),
    # parse_tasks：第六阶段状态机字段（nullable/默认值，兼容旧库）
    ("parse_tasks", "paused_at", "DATETIME"),
    ("parse_tasks", "timeout_seconds", "INTEGER DEFAULT 600"),
    ("parse_tasks", "failure_category", "VARCHAR(40) DEFAULT ''"),
    ("parse_tasks", "resume_count", "INTEGER DEFAULT 0"),
    ("parse_tasks", "heartbeat_at", "DATETIME"),
]

# 新增索引（表必须已存在才建）
STAGE2_INDEXES: list[tuple[str, str, str]] = [
    ("ix_materials_sha256", "materials", "sha256"),
    ("ix_materials_parse_status", "materials", "parse_status"),
    ("ix_source_chunks_project", "source_chunks", "project_id"),
    ("ix_source_chunks_hash", "source_chunks", "content_hash"),
    ("ix_extracted_facts_fact_id", "extracted_facts", "fact_id"),
    ("ix_extracted_facts_run", "extracted_facts", "extraction_run_id"),
    ("ix_ai_runs_task_type", "ai_runs", "task_type"),
    ("ix_ai_runs_material", "ai_runs", "material_id"),
]

# 新增表由 create_all 建立，这里仅记录期望，便于日志核对
STAGE2_TABLES = [
    "material_parse_runs", "parse_tasks", "evidence_items", "fact_revisions",
]


async def migrate_stage2(engine: AsyncEngine | None = None) -> dict:
    """幂等执行第二阶段迁移，返回统计供测试与日志使用。"""
    if engine is not None:
        return await _apply_stage2(engine)
    engine = _make_sync_backed_engine()
    try:
        return await _apply_stage2(engine)
    finally:
        await engine.dispose()


async def _apply_stage2(engine: AsyncEngine) -> dict:
    stats = {"columns_added": 0, "indexes_added": 0, "tables_expected": len(STAGE2_TABLES)}

    def _inspect(conn):
        insp = inspect(conn)
        return {
            "tables": set(insp.get_table_names()),
            "columns": {
                t: {c["name"] for c in insp.get_columns(t)}
                for t in insp.get_table_names()
            },
            "indexes": {t: {i["name"] for i in insp.get_indexes(t)}
                        for t in insp.get_table_names()},
        }

    async with engine.begin() as conn:
        state = await conn.run_sync(_inspect)

        # 补列（仅当表存在）
        for table, column, ddl in STAGE2_COLUMNS:
            if table not in state["tables"]:
                continue
            if column in state["columns"].get(table, set()):
                continue
            await conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {ddl}'))
            state["columns"].setdefault(table, set()).add(column)
            stats["columns_added"] += 1

        # 补索引
        for idx_name, table, column in STAGE2_INDEXES:
            if table not in state["tables"]:
                continue
            if idx_name in state["indexes"].get(table, set()):
                continue
            await conn.execute(text(f'CREATE INDEX "{idx_name}" ON "{table}" ("{column}")'))
            state["indexes"].setdefault(table, set()).add(idx_name)
            stats["indexes_added"] += 1

    logger.info(
        "stage2_migration_done columns=%s indexes=%s",
        stats["columns_added"], stats["indexes_added"],
    )
    return stats


def _make_sync_backed_engine() -> AsyncEngine:
    return create_async_engine(
        settings.database_url,
        connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
    )


if __name__ == "__main__":
    async def _main():
        result = await migrate_stage2()
        print("migration result:", result)

    asyncio.run(_main())
