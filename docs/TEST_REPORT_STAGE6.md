# 第六阶段专项测试报告（团队协作平台 + Qoder Site 迁移）

生成时间：2026-11-19
原则：**只记录真实执行过的测试**，不编造通过率/准确率/性能指标。所有命令均在本地真实执行，输出如实摘录。

## 1. 测试环境

- Windows 11（10.0.26300），Python 3.13（`backend/.venv`），Node 24，Vite 5（`--mode site`）
- 后端：FastAPI + SQLite（`backend/reprocheck.db`），pytest 实跑
- Site Function 本地桥：`node dev/function-local.mjs 8001`（Node strip-types 直跑 `frontend/functions/*.ts`，内存假 DB + 全量种子）
- 种子数据：`backend/scripts/export_site_seed.py` 导出 **53 表 / 375 行**（含第四阶段复现全链路演示数据，`backend/scripts/seed_stage4_demo.py` 生成，界面均带"演示"标注）
- 浏览器实测：Puppeteer-core + 本机 Edge（headless），桌面 1440×900、移动 390×844
- 证据文件：`frontend/.smoke-report.txt`、`frontend/.verify-report.json`、`frontend/.verify-shots/`（43 张截图）

## 2. 汇总结果（真实执行）

| 套件 | 命令 | 结果 |
|---|---|---|
| 后端自动化 | `cd backend && .venv/Scripts/python.exe -m pytest -q --basetemp=.pytest_tmp` | **120 passed**, 3 warnings（15.29s） |
| 其中四/六阶段 | 同上，限定 `test_stage4*.py test_stage6_*.py` | **68 passed**（11.94s） |
| Function 跨域冒烟 | `node dev/site-smoke.mjs`（对 8001 桥，覆盖 identity/benchmark/rules/integrations 四域） | **SMOKE 45/45 ok** |
| 浏览器 UI 验证 | `npx vite --mode site --port 5173 --strictPort & node scripts/verify_ui.mjs` | **STEPS 38/38 ok**；consoleErrors **0**、pageErrors **0**、failedRequests **0** |

warnings 均为 FastAPI/fitz 弃用提示，不影响功能。UI 验证含 24 个路由访问、9 组交互、4 个移动视口页与横向溢出检查。

## 3. 专项测试 20 项

| # | 专项 | 方法与证据 | 结果 |
|---|---|---|---|
| 1 | 认证与会话 | smoke `login:bad-password-401`、`login:lead`（JWT 三段）、`auth:missing-token-401`、`me`；后端 `test_stage6_auth.py` | 通过 |
| 2 | RBAC 与数据隔离 | smoke `rbac:register` 注册外部用户后 `rbac:non-member-404`、`rbac:non-member-materials-404`（非成员访问一律 404，不泄漏存在性） | 通过 |
| 3 | 组织与邀请 | smoke `orgs:seeded`；UI `orgs:invite-tab+create`（邀请页签创建流程）、截图 03/20-org-invite-token | 通过 |
| 4 | 团队与审计轨迹 | smoke `team:members`（≥2 成员）；UI `team:tabs`、截图 05/21-team-comments/22-team-activity；后端 trail 测试 | 通过 |
| 5 | 基准案例库 | smoke `cases:seeded`、`case:detail`、`case:facts`、`case:verifications`；UI 06/07/24-case-create-modal/25-case-verifications | 通过 |
| 6 | 案例质量分仅由核验计算 | smoke `case:quality-recompute`；UI `case:tabs+recompute`（截图 26）；后端 `test_stage6_benchmark.py` 断言 AI/客户端不可直接写质量分 | 通过 |
| 7 | 案例检索 | smoke `cases:search`；UI `benchmark:search-mode`（截图 23-benchmark-search） | 通过 |
| 8 | 事实标准化 schema | smoke `fact-schema`；UI 08-fact-schema | 通过 |
| 9 | 事实人工修订留痕 | smoke `fact:patch`（revision_count+1）、`fact:revisions-persisted`（`rev-` 前缀持久化）；UI 21-facts | 通过 |
| 10 | 规则生命周期与评估对照 | smoke `rules:seeded`（accuracy_tolerance*）、`rules:test-samples`、`rules:eval-compare`（candidate.precision=1、baseline=0.5、delta=0.5 精确断言）；UI `rules:eval-compare`（截图 27） | 通过 |
| 11 | 反馈治理（单条反馈不自动改生产规则） | smoke `feedback:create`→`feedback:triage`(resolved)→`feedback:filter`；UI `feedback:triage`（截图 28）；后端 `test_stage6_rules.py` | 通过 |
| 12 | 受控 RAG 检索 | smoke `rag:query`（hits 数组带引用）；UI `knowledge:query`（截图 29-knowledge-hits） | 通过 |
| 13 | 仓库连接器 / Notebook 集成 | smoke `integrations:repos`；UI `notebook-selects`、`integrations:notebook`（截图 30） | 通过 |
| 14 | 开放 API 令牌生命周期 | smoke `token:create-once`（`rc_live_` 明文仅一次）、`token:list-no-secret`（列表不含 token_hash/明文）、`token:call-logs`、`token:revoke`、`open:revoked-token-401`、`open:invalid-token-401`；UI `tokens:create+logs`（截图 31/32） | 通过 |
| 15 | 受限能力诚实降级 | smoke `open:audits-demo-limit`、`demo-limit:upload` 均 **501 + code=DEMO_LIMIT**（Site 环境无沙箱执行运行时，不伪造成功） | 通过 |
| 16 | 数据治理导出与保留策略 | smoke `governance:export`(completed)、`governance:export-download`（ZIP `PK` 魔数校验）、`governance:retention`；UI `governance:export`（截图 33/34） | 通过 |
| 17 | 复现规划与任务 DAG | smoke `repro:plans`（≥1）；UI `repro:plan+run-detail`（截图 35-repro-plan-detail：5 任务 DAG、依赖与人工确认标记） | 通过 |
| 18 | 执行控制台真实数据 | UI 36-repro-run-console：7 条日志、3 条指标、3 个产物均来自后端接口，页面明示"不推进任何前端伪造进度"；后端 `test_stage4.py` | 通过 |
| 19 | 结果对照与容差判定 | UI 18-repro-comparison：4 条对照（within_tolerance×2、not_comparable×1 因预处理条件不一致、insufficient_data×1），展开六项条件检查与容差依据；后端 `test_comparison.py`/`test_stage4.py` | 通过 |
| 20 | 复现报告生成与导出 | smoke `repro:reports`（≥1）、`repro:report-html`（含 `<html`）；UI 20-repro-reports（报告含范围声明，非学术质量判定） | 通过 |

## 4. 响应式与控制台洁净度

- 移动 390×844：工作台/基准库/规则/组织四页截图 40–43，横向溢出检查全部通过。
- 38 步全程 consoleErrors 0、pageErrors 0、failedRequests 0（修复后复跑确认）。

## 5. 本轮发现并修复的缺陷（复跑验证）

| 缺陷 | 修复 | 验证 |
|---|---|---|
| 复现页 4×401：`reproductionApi.ts` 请求未带 Authorization | request() 注入 Bearer（与 api.ts 一致） | UI 16–20 页全部渲染真实数据 |
| 环境页依赖清单 React 重复 key `undefined-`：后端返回字符串依赖（`torch==1.8.0`），页面按对象取字段 | `normalizeDependencies()` 兼容字符串/对象两种形态 | 复跑 38/38 且 consoleErrors 0；截图 17 依赖表正常 |
| `fact_revisions` 文本 id 写入整型主键 | 插入改用 `nextIntId(db,"fact_revisions")` | smoke `fact:revisions-persisted` 通过 |
| benchmark 域校验层被中间态 rewrite 删除（23 处悬空引用） | 恢复 bodyObj/forbidExtra/intParamLocal，语义对齐后端 Pydantic | tsc 0 个 TS2304；smoke 45/45 |

## 6. Qoder Site 部署验收（发布后执行）

状态：**待发布**。草稿已打包就绪（artifactReady=true），唯一阻塞为 `APP_JWT_SECRET` 需在 Site Settings 专用输入框录入（值不经聊天/命令行）。发布后逐项执行并回填：

1. 线上 `/functions/v1/app/api/v1/health` 200；
2. 演示账号登录 + `/auth/me`；
3. 种子数据可见（项目/案例/复现规划/报告）；
4. 一次真实 mutation（事实修订或反馈 triage）落库可见；
5. 开放 API 受限能力仍诚实 501 DEMO_LIMIT；
6. 移动视口抽查无溢出。

## 7. 结论

20 项专项测试全部通过；后端 120、Function 冒烟 45/45、浏览器 38/38 均为真实执行结果。部署验收待 Secret 录入与发布后补齐。