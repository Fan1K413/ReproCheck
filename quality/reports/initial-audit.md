# 首轮审计报告（第七阶段）

> 审计角色：独立质量保障智能体
> 时间：2026-11-24 10:30–11:05（Asia/Shanghai）
> 对象：ReproCheck，分支 `stage9/research-driven-refactor`，HEAD `f2a7ce8` + 241 条未提交/未跟踪
> 地点：本地开发环境（Windows 11 / Python 3.13 / Node 22 / Edge headless / SQLite）

---

## 一、本轮检查

### 检查模块

身份与项目（auth/projects/isolation/RBAC）、材料与解析（materials/parsers/task）、事实与证据、复现规划/任务、报告、解析概览、移动端布局、API 契约、安全配置、测试体系。

### 检查文件（代表）

- `backend/app/main.py`、`core/config.py`、`api/deps.py`、`api/isolation.py`
- `backend/app/api/v1/{auth,projects,materials,parse_tasks,facts,reproductions}.py`
- `backend/app/services/{auth_service,material_service,task_service}.py`
- `backend/app/reproduction/{planner,report}.py`
- `frontend/src/{App.tsx,components/AppLayout.tsx}`
- `frontend/src/pages/{MaterialsPage,ProjectsPage,OverviewPage,ProjectNewPage}.tsx`
- `frontend/src/pages/reproduction/ReproductionOverviewPage.tsx`
- `frontend/src/styles/wave-b-material.css`
- `README.md`、`docs/stage10/09_SECURITY_TEST_REPORT.md`

### 执行测试

| 测试 | 命令/方式 | 结果 |
|---|---|---|
| 后端全量 | `pytest -q` | **359 passed / 0 failed / 6 warnings / 58.98s** |
| 前端类型 | `npm run typecheck` | exit 0 |
| 前端构建 | `npm run build` | exit 0 / 6.52s / index 313.67 kB |
| API 探针 | `quality/tools/api_audit.py` | 主探针 15 项 + 补测 2 项；7 符合 / 7 不符合 / 3 基线 |
| 用户主流程 | `quality/tools/user_journey.mjs` + 页面探针 | 11 步：9 pass / 1 partial / 1 blocked |
| 多尺寸 | 390×844 8 路由 | 无横向溢出 |
| 抽屉布局 | 1440×900 DOM 实测 | footer 越界（P1） |

### 测试环境

- 前端 `http://127.0.0.1:5173`（Vite dev），后端 `http://127.0.0.1:8000`（uvicorn）。
- 活动库 `backend/reprocheck.db`；`backend/.env` 不存在，`LLM_API_KEY` 未配置。
- 执行后端 `none`；无 Docker/GVisor。
- 演示账号 4 个（密码来自仓库 seed 脚本）。
- 外部服务：无；未调用真实 LLM。

---

## 二、发现问题

### 新增 Bug（9 条）

| ID | 级别 | 摘要 |
|---|---|---|
| BUG-2026-11-001 | P1（生产 P0） | 匿名可读全部项目/材料/任务并下载文件 |
| BUG-2026-11-002 | P1（生产 P0） | 匿名可上传材料、删除任意材料 |
| BUG-2026-11-003 | P1 | viewer 只读角色可上传；25 个写端点未校验业务权限 |
| BUG-2026-11-004 | P1 | 材料详情抽屉 footer 越界，操作按钮首屏不可见 |
| BUG-2026-11-005 | P2 | 材料卡“已完成”与任务“部分完成/0 事实”语义冲突 |
| BUG-2026-11-006 | P2 | README/阶段报告测试数与安全结论漂移 |
| BUG-2026-11-007 | P2 | 前端无自动化回归套件 |
| BUG-2026-11-008 | P3 | pytest 出现未 await 的 `aclose` 警告 |
| BUG-2026-11-009 | P3 | 根库与活动库并存；241 条未提交 |

### 已修复 Bug

**0**。本轮为只读审计，未修改业务源码。

### 遗留 Bug

上述 9 条全部 Open，均需对应开发智能体处理：

- BUG-001/002/003 → 后端鉴权/RBAC；
- BUG-004 → 前端布局；
- BUG-005 → 前端状态语义；
- BUG-006 → 文档负责人；
- BUG-007/008 → 测试负责人；
- BUG-009 → 仓库维护。

### 新发现风险

1. **默认配置即不安全**：5 项生产自检不合格，启动仅 warning；未设 `STRICT_PRODUCTION=1` 时可被误部署。
2. **匿名路径短路隔离**：不是个别接口漏鉴权，而是 `isolation.py` 的全局 return，影响面覆盖全部项目相关读写。
3. **角色声明与实现脱节**：`rbac.py` 写明 viewer 零权限，`require_admin` 却把“已登录”当“有权限”。
4. **模态定位脆弱**：页面级 identity transform 让 fixed 元素相对内容容器定位；同类抽屉可能复现。
5. **验收文档过度乐观**：stage10 安全报告 10/10 隔离与实测不符，后续不能直接引用。

---

## 三、回归测试

| 类别 | 通过 | 失败 | 未执行 | 阻塞 |
|---|---|---|---|---|
| 后端 pytest | 359 | 0 | 0 | 0 |
| 前端 typecheck/build | 2 | 0 | 0 | 0 |
| 用户主流程 11 步 | 9 | 0 | 0 | 1（运行） |
| 主流程部分完成 | 1（解析） | — | — | — |
| API 探针 17 项 | 7 符合预期 | 7 不符合预期 | 3 基线读数 | — |
| 390 宽 8 路由 | 8 | 0 | 0 | 0 |
| 全路由遍历 | 0 | 0 | 39 | — |
| 真实 LLM | 0 | 0 | 0 | 1 |
| 真实执行 | 0 | 0 | 0 | 1 |

说明：“符合预期”指无效 token 401、4 角色登录 200、viewer 非成员上传 404、viewer 删除项目 404；“不符合预期”为 BUG-001/002/003 的 7 个 200；“基线读数”为 lead/viewer 项目计数与 lead 创建成功。

---

## 四、多智能体协作

| 项 | 内容 |
|---|---|
| 涉及其他智能体的文件 | 工作区 241 条未提交：frontend 131、backend 66、docs 20、Plan 10、其他 14 |
| 本轮是否修改这些文件 | **否**。只新增 `quality/`，未覆盖、未合并、未切分支 |
| 是否发生冲突 | **无** |
| 是否需要其他智能体处理 | **是**：BUG-001/002/003 后端、BUG-004/005 前端、BUG-006 文档、BUG-007/008 测试 |
| 临时数据 | 3 个 `QA-AUDIT` 项目及 6 份材料已通过真实 DELETE 清理；残留 0 |

---

## 五、质量门禁结论

**BLOCKED — 不通过。**

按第七阶段第八节，命中以下不得通过项：

- 出现 P0 风险（默认配置匿名可读写，生产未强制 STRICT）。
- 关键权限控制失效（viewer 可写、匿名可删）。
- 测试环境不完整（LLM/执行沙箱），已标阻塞而非通过。
- 工作区无可复现发布 commit（241 条未提交）。

可如实声明的部分：

- 后端 359 项自动化测试全通过；
- 前端构建通过；
- 项目创建→上传→解析→规划→任务→报告→重进链路真实可走；
- 无 Key 时明确降级，不伪造事实/执行结果；
- 移动端无横向溢出。

---

## 六、下一轮计划

### 目标 1：复验鉴权修复（最高优先）

- 匿名的 `GET /projects`、`/materials`、`/parse-tasks`、`/materials/{id}/download`、`POST /materials/upload`、`DELETE /materials/{id}` 全部 401。
- viewer 对 upload/parse/delete/report/run 全部 403；researcher 可上传不可删项目；lead 可管理。
- 检查是否引入 demo 路由回归（演示项目仍可只读访问）。

### 目标 2：复验材料抽屉

- 1440×900、1180×820、390×844 三档 footer 可见（bottom ≤ viewport）。
- 打开时 body 滚动锁定；Esc/遮罩关闭后焦点回到触发卡片。

### 目标 3：真实 LLM 链路（需用户提供 Key）

- 用一篇合法可用论文跑完整抽取：chunks→facts→evidence→报告；核对每条事实的 chunk_id 逐字命中。
- 未提供 Key 前保持 BLOCKED，不写“通过”。

### 目标 4：真实执行与环境（需沙箱）

- 环境创建/锁定/复用/销毁；运行创建、日志、产物、指标对照。
- 无沙箱前只验证“拒绝执行”的安全路径。

### 目标 5：测试体系

- 前端 E2E 入库（登录、创建、上传、抽屉、权限、报告）。
- 权限矩阵与匿名边界测试入库，防止 BUG-001/002/003 回归。
- 更新 README/阶段报告数字与口径。

### 目标 6：全路由与异常面

- 39 条路由逐一访问（含 404、空数据、非法 id）。
- 大文件、损坏 PDF、重复上传、并发上传。

---

## 七、证据与限制

- 原始探针：`quality/reports/api-audit.json`
- 主流程：`quality/reports/user-journey.json`、`quality/reports/screens/`
- 未验证：真实论文/LLM、真实执行、并发压力、Safari/Firefox、移动真机、备份恢复。
- 本报告不含任何虚构测试结果；所有“通过”均可在上述文件复现。
