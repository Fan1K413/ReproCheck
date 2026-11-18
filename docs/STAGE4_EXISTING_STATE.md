# 第四阶段开发前现状审查（STAGE4_EXISTING_STATE）

审查时间：2026-11-17
审查方式：真实读取磁盘文件 + 实跑测试 + 实际命令探测，不采信任务书描述，不采信历史自述。

## 1. 目录与技术栈（实测）

- 顶层：`backend/` + `frontend/` + `docs/` + `README.md`，**无 Git 仓库**（审查时发现，已在本阶段初始化并建立 `stage4/reproduction-engine` 分支）；
- 前端：React18 + TS + Vite5 + Tailwind3 + ReactRouter + Zustand + TanStackQuery + Lucide，10 个页面；
- 后端：FastAPI + Pydantic v2 + SQLAlchemy 2.0 + Alembic + SQLite(aiosqlite)，50 个 py 文件；
- 依赖：PyMuPDF 2.1 / PyYAML 6.0.3 / openpyxl 3.1.5。

## 2. 前序阶段真实完成情况（关键：不得夸大）

| 阶段 | 任务书声称 | 磁盘实测 | 结论 |
|---|---|---|---|
| 第一阶段 | API接入/审计链路/4页面 | 6 个 v1 接口、demo/audit 最小审计、17 项测试 | ✅ 真实完成（最小版） |
| 第二阶段 | 多格式解析/证据库 | 8 类解析器、13 个 v2 接口、4 张新表、26+ 解析测试 | ✅ 真实完成 |
| **第三阶段** | **审计引擎/证据图谱/AI调用/UI** | **零相关代码**：grep `reproduction/证据图谱/evidence_graph` 无命中；前端无审计页面；无第三阶段数据表 | ❌ **完全不存在** |

**必须明确**：第三阶段任务书只有 `STAGE3_HANDOVER.md`（交接说明），没有任何实现。任务书里"检查第三阶段审计引擎、证据图谱、AI 调用能力和 UI 的实际完成情况"的真实答案是**均未实现**。本阶段不得把第二阶段的 `audit_findings` 表（第一阶段最小演示审计留下的）误称为"第三阶段审计引擎"。

## 3. API 与数据库（实测）

- API：共 23 条路由（19 业务 + docs 4），其中 v1 演示审计 1 条（`/demo/audit`），**无跨材料审计接口、无证据图谱接口**；
- 数据库 11 张表：`projects / materials / source_chunks / extracted_facts / audit_findings / evidences / ai_runs / material_parse_runs / parse_tasks / evidence_items / fact_revisions`；
- 迁移：0001 占位 + 0002 幂等扩展 + `app/db/migrate.py`（Inspector 检测补列）；
- 测试：**52 passed**（一阶段 17 + 二阶段 35）。

## 4. AI 能力实况（关键阻塞）

- `LLM_API_KEY` 环境变量：**EMPTY**；`OPENAI_API_KEY` 存在（51 字符 `sk-` 开头），但第一阶段已实测对 OpenAI 官方端点被本地代理 502 拦截，对通义/DeepSeek/月之暗面/智谱兼容端点全部 401（失效占位密钥）；
- 结论：**当前无真实可用的大模型 API**。本阶段所有 AI 功能（反向规划、失败诊断）必须复用现有 `LLMService`，并在无 Key 时明确报"AI 不可用"，不得用固定 JSON/预设文本冒充。

## 5. 执行隔离能力实况（关键阻塞）

- `docker`：**NOT FOUND**；`podman`：**NOT FOUND**；
- 当前为 Windows 11 + WorkBuddy 沙箱，无 Rootless Docker / gVisor / Firecracker；
- 结论：**当前环境不具备安全隔离执行用户代码的条件**。按任务书"对于无法安全隔离的部署环境，应当关闭代码执行能力，只提供静态检查和环境分析，不得以牺牲安全性为代价完成演示"——本阶段将实现完整的**安全预检 + 环境检测 + 静态分析 + 受控执行接口**，但**默认关闭真实代码执行**，明确标注"当前环境不支持安全执行"，绝不假装执行成功。

## 6. 可复用资产（明确所有权）

- 后端：`LLMService`（唯一模型调用入口）、`core/errors` 统一异常、`materials/facts/parse-tasks/overview` 现有接口、`models` 11 张表 + 幂等迁移模式；
- 前端：`DataTable/StatusBadge/LoadingState/ErrorState/EmptyState/SourceLocatorView`、`api.ts` 统一封装、深蓝科研设计系统；
- 数据：第二阶段的科研事实 + 证据库正是本阶段反向规划的输入基础。

## 7. 未解决的高优先级问题

1. 第三阶段整体缺失——本阶段的"AI 规划结合审计结果"只能结合第一阶段的 `audit_findings`（最小审计）或第二阶段的 facts，需在适配层明确数据来源，不得假装有第三阶段审计结果；
2. 无真实 API Key——AI 规划/诊断无法真跑；
3. 无容器运行时——真实执行不可用；
4. 无 Git（已在本阶段修复，建立分支）。

## 8. 审查结论

前序第一、二阶段真实完成且测试通过，可作为第四阶段基础；**第三阶段不存在**，本阶段必须建立适配层而非假设其存在。两项外部阻塞（Key、容器）决定了本阶段交付形态：**规划/环境/安全/对照/报告/前端工作台可真实实现；AI 与代码执行以"接口完整 + 明确不可用标注 + 协议级 mock 验证逻辑"交付，不伪造**。
