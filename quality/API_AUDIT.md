# API_AUDIT · 接口契约、鉴权与隔离审计

> 审计对象：运行中的 `http://127.0.0.1:8000`（uvicorn，SQLite）
> 方法：OpenAPI 盘点 + 真实 HTTP 探针（`quality/tools/api_audit.py`）+ 定向补测
> 原始结果：`quality/reports/api-audit.json`

## 1. 规模与结构

| 项 | 值 |
|---|---|
| OpenAPI paths | **201** |
| 操作（method+path） | **244** |
| 业务前缀 | `/api/v1/*` |
| 开放 API | `/api/open/v1/*`（7 个操作） |
| 健康检查 | `GET /api/v1/health` |

按 tag 的主要分布：reproductions 24、lifecycle 19、organizations 16、audit-rules 11、orchestration 11、collaboration 11、cases 10、parse-tasks 8、workflow 8、materials 5、facts 5、projects **3**。

## 2. 统一响应契约（实测）

成功：

```json
{"success": true, "data": {...}, "error": null, "request_id": "req-..."}
```

错误（404 实测）：

```json
{"success": false, "data": null,
 "error": {"code": "NOT_FOUND", "message": "材料不存在。", "details": null},
 "request_id": "req-..."}
```

- 4 个演示账号登录返回 `data.token` + `data.user`，token 为 JWT（HS256，12h）。
- 无效 token 调 `/auth/me` → 401，envelope 一致。
- 参数校验失败 → 422 `VALIDATION_ERROR`（代码路径）。
- 未捕获异常 → 500 `INTERNAL_ERROR`（本轮未触发）。

结论：**契约 envelope 一致，错误码可读**；问题不在结构，在“谁能调”。

## 3. 真实探针结果

主探针 15 项（`api_audit.py`），另补测 2 项（viewer 上传、匿名删除）。判定：7 项符合、7 项不符合、3 项基线读数。

| # | 探针 | HTTP | 读数 | 期望 | 判定 |
|---|---|---|---|---|---|
| 1 | 匿名 `GET /projects` | **200** | total=15 | 401/403 | ✗ |
| 2 | 匿名 `GET /materials?project_id=演示项目` | **200** | total=2 | 401/403 | ✗ |
| 3 | 匿名 `GET /parse-tasks?project_id=演示项目` | **200** | total=2 | 401/403 | ✗ |
| 4 | 匿名 `GET /materials/{id}/download` | **200** | 486 B | 401/403 | ✗ |
| 5 | 无效 token `GET /auth/me` | 401 | — | 401 | ✓ |
| 6 | 4 角色登录 | 200 | lead/researcher/reviewer/viewer | 200 | ✓ |
| 7 | lead `POST /projects` | 200 | `proj-85fc…` | 200 | ✓ |
| 8 | viewer（非成员）`POST /materials/upload` 到 lead 新项目 | 404 | — | 403/404 | ✓（隔离生效） |
| 9 | **匿名** `POST /materials/upload` 同一项目 | **200** | `mat-f7b4…` | 401 | ✗ |
| 10 | viewer `DELETE /projects/{lead 项目}` | 404 | — | 403/404 | ✓ |
| 11 | lead `GET /projects` | 200 | total=5 | — | 基线 |
| 12 | viewer `GET /projects` | 200 | total=1 | — | 隔离读数 |
| 13 | **viewer** `POST /materials/upload` 到演示项目 | **200** | `mat-c0a1…` | 403 | ✗ |
| 14 | **匿名** `DELETE /materials/{id}` | **200** | `deleted:true` | 401 | ✗ |

关键对照：**同一个上传请求，带 viewer token 时 404（隔离拦住），不带 token 时 200（匿名放行）**。这不是“权限不足”，而是匿名路径直接把隔离短路。

## 4. 接口面缺口

| 能力 | 现状 | 影响 |
|---|---|---|
| 项目详情 | 无 `GET /projects/{id}` | 前端只能依赖列表；深链/刷新后需整表查询 |
| 项目编辑 | 无 `PATCH/PUT` | 文档“编辑项目”无法验收 |
| 数据集 | `lifecycle` 有 GET/POST/PATCH | 无前端入口，无法按用户路径验收 |
| 仓库克隆/分支/commit | 仅 connect/sync/snapshots/revoke | 无法固定代码版本 |
| 执行环境 | 仅 `GET /reproductions/environments` | 无法创建/锁定/销毁/复用 |
| 运行暂停 | 仅 `POST /runs/{id}/cancel` | 无 pause/resume |
| 报告 PDF | `GET /reports/{id}/pdf` → 501 `PDF_UNAVAILABLE` | 页面如实提示，非静默失败 |
| 速率限制 | 代码中未见 | 匿名/暴力登录无门槛 |

## 5. 鉴权设计问题（根因）

1. `config.py:34` `allow_unauth_test_endpoints: bool = True`。
2. `isolation.py:90-93`：
   ```python
   if user is None:
       if settings.allow_unauth_test_endpoints:
           return
       raise AppError("UNAUTHORIZED", ...)
   ```
   匿名直接跳过所有项目归属校验。
3. `deps.py:64-79` `require_admin` 在无 token + 开关为真时也直接放行；且对已登录用户不再校验角色。
4. 25 个写端点使用 `require_admin`，覆盖材料、解析、事实、复现、报告、LLM。
5. `projects.py:44-57` 的 list/create 用 `get_optional_user`，匿名可读全量、可创建无 owner 项目（代码路径；创建未实测以免污染库）。

## 6. 结论

- 契约与错误结构：**通过**。
- 已登录用户的项目隔离：**通过**（viewer 非成员上传/删除项目均 404）。
- 匿名边界：**失败**（读、写、删、下载全部 200）。
- RBAC：**失败**（viewer 可写）。
- 发布判定：**BLOCKED**，详见 `RELEASE_CHECKLIST.md`。

## 7. 建议的最小修复顺序

1. 生产环境强制关闭 `ALLOW_UNAUTH_TEST_ENDPOINTS`，并把该开关从“全局 return”改为“仅 demo 路由”。
2. `materials`、`parse_tasks` 的读写全部加 `get_current_user` + `resolve_project_access`。
3. 25 个 `require_admin` 按权限键替换；补角色矩阵测试。
4. 补 `GET /projects/{id}` 与编辑接口，或明确从产品范围删除。
5. 加登录/上传限流与请求体上限。
