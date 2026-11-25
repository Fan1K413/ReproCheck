# PERFORMANCE_AUDIT · 接口、构建与页面加载

> 环境：本机 Windows 11、Edge headless、127.0.0.1、SQLite、无并发。
> 口径：**单次热缓存观测**，不等同压力测试；所有数字为本轮实测，未做统计学重复。

## 1. API 延迟

来源：`quality/tools/api_audit.py`（httpx，单请求，毫秒）。

| 请求 | 状态 | 延迟 |
|---|---|---|
| 匿名 `GET /projects`（15 条） | 200 | **21.8 ms** |
| 匿名 `GET /materials`（2 条） | 200 | 11.8 ms |
| 匿名 `GET /parse-tasks`（2 条） | 200 | 11.4 ms |
| 匿名 `GET /materials/{id}/download`（486 B） | 200 | 9.2 ms |
| `POST /auth/login` | 200 | 94.5 / 71.8 / 68.0 / 70.5 ms（4 角色） |
| `POST /projects` | 200 | 23.7 ms |
| viewer `POST /materials/upload`（3.8 KB PDF） | 404（隔离） | 11.6 ms |
| 匿名 `POST /materials/upload` | 200 | 24.7 ms |
| `DELETE /projects/{id}`（4 材料级联） | 200 | 未单独计时（< 1s 完成） |

观察：

- 读接口 9–22 ms，登录 68–95 ms（含 bcrypt/JWT）。
- 本地单用户，无慢查询证据；材料列表存在“逐条 count chunks/facts”的 N+1 形态（`materials.py:54-60`），当前 2–4 条不明显，数据量大时需复测。
- 解析任务列表同样逐条查材料名（`parse_tasks.py:137-139`）。

## 2. 页面加载（热缓存）

Playwright `waitUntil=load`，1440×900，登录后：

| 路由 | wall | DOMContentLoaded | 正文长度 |
|---|---|---|---|
| `/projects` | 77 ms | 67 ms | 1,986 |
| `/projects/{id}/materials` | 82 ms | 72 ms | 733 |
| `/projects/{id}/reproduction` | 73 ms | 64 ms | 799 |

说明：Vite dev server + 本机回环 + 已登录热缓存，不能代表生产；仅用于发现明显卡顿。主流程页面均无 >1s 阻塞。

## 3. 构建产物

`npm run build`（`tsc --noEmit && vite build`）：

| 产物 | 大小 | gzip |
|---|---|---|
| `index-CnO7_JR3.js` | 313.67 kB | 98.28 kB |
| `ProjectWorkbenchPage-D087YAwm.js` | 93.75 kB | 30.47 kB |
| `CaseDetailPage` | 35.70 kB | 10.59 kB |
| `RulesPage` | 34.70 kB | 11.03 kB |
| `ModelCenterPage` | 29.47 kB | 8.61 kB |
| `StatsAuditPage` | 28.43 kB | 9.76 kB |
| `ReproductionPlanPage` | 23.53 kB | 7.41 kB |

- 构建耗时 **6.52s**，exit 0；无 >500 kB 警告。
- 路由级分包生效（Bloom 工作台独立 93.75 kB）。

## 4. 测试与数据库

| 项 | 值 |
|---|---|
| 后端 359 项测试 | 58.98s（约 6.1 项/秒） |
| 测试收集 | 4.08s |
| 活动 SQLite | 2,027,520 B（83 张表） |
| 演示库项目 | 15 条（审计前） |
| QA 临时数据 | 已全部删除 |

## 5. 风险与未测

- 未做并发（10/50/100 并发）、长稳、内存增长。
- 未测真实 LLM 调用延迟（无 Key）。
- 未测执行沙箱（`none`）。
- 未测大文件（>10 MB PDF、超大 ZIP）、批量上传。
- 未测生产 CDN/反向代理/TLS。
- 未做前端 Lighthouse/内存快照。

## 6. 初步结论

- 本地单用户性能**无明显瓶颈**；读接口毫秒级，构建体积可控。
- 性能不是当前发布阻断项；阻断在鉴权与抽屉布局。
- 下一轮在数据量增长后复测材料/任务列表的 N+1。
