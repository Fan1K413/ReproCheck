# 第二阶段 API 契约（v2，兼容 v1）

Base：`/api/v1`，统一响应信封与错误码沿用第一阶段（见 API_CONTRACT.md）。
v2 新增接口全部为**追加**，不改动 v1 任何已有接口。

## 材料管理

### POST /api/v1/materials/upload  🔒
`multipart/form-data`：`project_id`(str) + `file`(UploadFile)
→ data: `{ material_id, project_id, filename, material_type, size_bytes, parse_status, sha256, created_at }`

### GET /api/v1/materials?project_id=xxx
→ data: `{ items: MaterialView[], total }`
`MaterialView`: `{ material_id, project_id, filename, material_type, size_bytes, parse_status, sha256, chunk_count, fact_count, created_at, error_message }`

### GET /api/v1/materials/{material_id}
→ data: MaterialView + `{ metadata: dict, warnings: ParseWarning[], raw_preview: str, can_preview: bool }`

### GET /api/v1/materials/{material_id}/download
→ 原始文件二进制流（Content-Disposition attachment）

### DELETE /api/v1/materials/{material_id}  🔒
→ data: `{ deleted: true, cascaded: { chunks: N, facts: N, evidence: N } }`

## 解析任务

### POST /api/v1/materials/{material_id}/parse  🔒
发起解析+抽取任务（创建 task 记录，同步执行本阶段小任务；返回任务 id）。
→ data: `{ task_id, material_id, status: "queued"|"completed"|"failed", idem_key }`

### GET /api/v1/parse-tasks/{task_id}
→ data: ParseTaskView: `{ task_id, material_id, project_id, status, stage, stage_message, started_at, completed_at, error_code, error_message, model, model_calls, total_tokens, prompt_tokens, completion_tokens, duration_ms, prompt_version, facts_count }`

### GET /api/v1/parse-tasks?project_id=xxx
→ data: `{ items: ParseTaskView[], total }`

### POST /api/v1/parse-tasks/{task_id}/retry  🔒
安全重试（仅 failed 状态），→ data: ParseTaskView

### DELETE /api/v1/parse-tasks/{task_id}  🔒
取消 queued 任务；running 任务标记 cancel_requested，→ data: `{ cancelled: bool }`

## 事实与证据

### GET /api/v1/facts?project_id=xxx&material_id=optional
→ data: `{ items: FactViewV2[], total }`
`FactViewV2`:
```json
{
  "fact_id": "fact_xxx",
  "project_id": "proj_xxx", "material_id": "mat_xxx",
  "fact_type": "training_parameter", "field_key": "learning_rate",
  "field_label": "学习率", "raw_value": "0.001", "normalized_value": 0.001,
  "unit": null, "assertion_type": "explicit",
  "extraction_status": "supported", "parser_source": "model",
  "extraction_run_id": "run_xxx", "confidence": 0.9,
  "evidence": [{ "evidence_id":"ev_xxx", "chunk_id":"pdf_xxx",
     "quote":"...", "source_name":"paper.pdf", "source_locator":{...},
     "verification_status":"verified", "original_text":"后端材料原文" }],
  "revision_count": 0, "created_at": "..."
}
```

### PATCH /api/v1/facts/{fact_id}  🔒  （人工修订，留痕）
body: `{ field_key?, field_label?, raw_value?, normalized_value?, note? }`
→ data: FactViewV2（revision_count+1，parser_source 变为 "human" 但保留 ai_original 快照）

### GET /api/v1/facts/{fact_id}/revisions
→ data: `{ items: [{ revision_id, fact_id, field_key, old_value, new_value, revision_source, note, created_at }], total }`

### GET /api/v1/facts/summary?project_id=xxx
→ data: `{ total, by_assertion:{explicit,inferred,ambiguous,not_found}, by_status:{supported,unsupported,needs_review}, with_evidence, human_confirmed, by_type:{} }`

## 材料解析概览

### GET /api/v1/projects/{project_id}/parse-overview
→ data:
```json
{
  "project_id": "...",
  "materials": {"total":3,"completed":2,"partially_completed":1,"failed":0,"pending":0},
  "facts": {"total":18,"with_evidence":17,"needs_review":2,"human_revised":1},
  "llm": {"total_calls":6,"total_tokens":1200},
  "by_type": {"pdf":1,"python":1,"yaml":1}
}
```
所有数字必须来自真实数据库聚合，禁止前端硬编码。

## 前端约定
- 使用现有 `api.ts` 的 `request<T>()` 与 `ApiError`；新增方法集中在此文件。
- base 仍为 `VITE_API_BASE_URL`（默认 /api）+ `/v1`；无密钥变量。
- 路由新增：`/projects/:projectId/materials`、`/materials/:materialId`、`/projects/:projectId/tasks`、`/projects/:projectId/facts`、`/projects/:projectId/overview`。
- 沿用现有 AppLayout、DataTable、StatusBadge、LoadingState/ErrorState/EmptyState。
- 所有统计来自接口；失败显示 error.code/message；上传显示真实服务器返回状态。
- 证据定位展示：PDF 显示 viewer_page_number + printed_page_number（有则显示）+ section + bbox 存在时标注"有坐标"；代码显示 file_path + start_line-end_line；配置显示 field_path/original_key；无定位显示"来源位置尚未确认"。
