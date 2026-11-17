# 数据库结构（第一阶段）

数据库：SQLite（开发/演示），SQLAlchemy 2.0 ORM，保留迁移到 PostgreSQL 的能力。
时间字段为带时区的 DateTime，默认由应用写入 UTC。

## 表关系

```
Project 1 ──── * Material 1 ──── * SourceChunk
                    │
Project 1 ──── * AIRun（快照 result_json）

AIRun ──── * ExtractedFact（引用 material_id / chunk_id）
AIRun ──── * AuditFinding 1 ──── * Evidence（original_text 来自 SourceChunk）
```

## 表

### projects 审计项目
| 字段 | 类型 | 说明 |
|---|---|---|
| id | str(36) PK | 项目 ID |
| name | str(200) IDX | 项目名称 |
| domain | str(120) | 研究领域 |
| paper_title | str(300) | 论文标题 |
| description | text | 描述 |
| created_at / updated_at | datetime | 时间戳 |

### materials 项目材料
| 字段 | 类型 | 说明 |
|---|---|---|
| id | str(36) PK | 材料 ID |
| project_id | str(36) FK→projects | 所属项目（CASCADE） |
| source_name | str(200) | 文件名，如 paper_excerpt.txt |
| material_type | str(40) | text / yaml |
| raw_text | text | 材料原文（证据唯一真实来源） |
| created_at | datetime | |

### source_chunks 材料文本块
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| material_id | str(36) FK→materials | |
| chunk_id | str(80) | 业务 ID，如 paper_chunk_001（与 material_id 联合唯一） |
| chunk_index | int | 顺序 |
| original_text | text | 原文块 |
| locator_type | str(30) | text_paragraph（第二阶段扩展 PDF 页码/代码行号） |
| page_number / line_number | int? | 预留 |
| created_at | datetime | |

### extracted_facts 结构化事实
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| run_id | str(36) IDX | 审计运行 |
| project_id | str(36) IDX | |
| material_id | str(36) FK→materials | |
| chunk_id | str(80) | 证据块（联合索引 run_id+field_key） |
| field_key | str(80) | 规范字段 |
| raw_value / normalized_value / unit | str | 值 |
| confidence | float | 抽取置信度 |

### audit_findings 审计问题
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| run_id | str(36) IDX | |
| project_id | str(36) IDX | |
| field_key | str(80) | |
| severity | str(20) | high/medium/low |
| title | str(300) | |
| ai_explanation | text | AI 风险解释 |
| created_at | datetime | |

### evidences 证据
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| evidence_id | str(60) IDX | |
| finding_id | int FK→audit_findings | |
| project_id / material_id / chunk_id | str | 来源定位 |
| source_name | str(200) | |
| locator_type | str(30) | |
| page_number / line_number | int? | 预留 |
| original_text | text | **从 source_chunks 读取，非模型生成** |
| created_at | datetime | |

### ai_runs AI 调用与审计运行记录
| 字段 | 类型 | 说明 |
|---|---|---|
| id | str(36) PK | run_id |
| project_id | str(36) IDX | |
| run_type / status | str(30) | running/completed/failed |
| provider / model / request_id | str | 调用元数据 |
| calls / prompt_tokens / completion_tokens / total_tokens | int | 用量 |
| duration_ms | int | 耗时 |
| success | bool | 是否成功 |
| error_code | str? | 失败码 |
| result_json | text? | 完整结果快照（供 run_id 历史查询） |
| created_at / finished_at | datetime | |

## 迁移

- 开发期由 `app/db.init_db()` 在启动时 `create_all` 自动建表。
- 生产环境用 Alembic：`alembic revision --autogenerate -m "..."` → `alembic upgrade head`。
- 迁移配置见 `backend/alembic.ini` 与 `backend/alembic/env.py`。
