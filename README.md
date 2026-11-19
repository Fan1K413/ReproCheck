# ReproCheck｜科研复现审计官

**科研结论的独立核对层**：把论文主张、PDF 证据、配置、代码、数据、运行记录当作互相独立的证词，用确定性规则与可复核证据做交叉比对，给出分级、可人工复核的审计结论。

它不替代 MLflow/DVC/Code Ocean（追踪、版本化、执行），而是**消费它们的产物**，回答它们不回答的问题：论文写的与代码/配置/数据/结果是否一致？每条结论的证据在哪里？验证到什么程度？

> 定位依据见 `docs/STAGE9_COMPETITOR_AND_POSITIONING.md`。当前代码主阶段为第六阶段（后端 205 项测试通过），第九阶段正在做"研究驱动重构"（独立分支 `stage9/research-driven-refactor`）。

## 当前能力（真实状态，2026-11-19）

状态口径：`已测试`=有真实后端测试；`仅API`=后端可用但前端无入口；`部分`=有边界；`未实现`=缺失。

| 能力 | 状态 | 入口 |
|---|---|---|
| 注册/登录/JWT、组织与项目隔离、角色权限 | 已测试 | 登录页 / 组织与成员 / 角色权限 |
| 材料上传（PDF/代码/配置/CSV/…）与解析任务（排队/重试/取消） | 已测试 | 材料管理 / 解析任务 |
| AI 事实抽取 + 证据逐字校验（拒绝虚构 chunk_id） | 已测试（LLM 需真实 Key） | 科研事实 |
| 证据图谱、PDF 页码与代码行号定位 | 已测试 | 科研事实 → 查看证据图谱 |
| 科研复现规划/任务/运行/指标对比/报告 | 已测试（真实执行关闭） | 复现验证（7 页） |
| 任务暂停/继续/超时/卡死恢复、失败分类 | 已测试 | 解析任务页（暂停/继续）/ 项目验证页（批量恢复） |
| 确定性失败诊断（11 类，独立于大模型，候选原因） | 已测试 | AI 诊断页 |
| 图表反向验证（文本/数值层） | 已测试（无 OCR 图像级） | 项目验证页 |
| 项目交接包导出/校验（ZIP + SHA-256 manifest） | 已测试（导入只校验不写库） | 交接包页 |
| 基准指标（P/R/F1/误报漏报/定位准确率） | 已测试 | 项目验证页 |
| 科研团队协作、反馈治理、审计轨迹 | 已测试（浏览器 E2E 未做） | 团队协作/反馈治理页 |
| 真实隔离执行（Docker/GVisor）、OCR 图像重绘对比、数据泄漏检测 | 未实现 | — |

完整逐项清单见 `docs/STAGE6_REAL_STATUS.md`；第九阶段前后端落差审计见 `docs/STAGE9_CURRENT_PRODUCT_AUDIT.md`。

## 目录

```
ReproCheck/
├── frontend/    React + TypeScript + Vite + Tailwind
├── backend/     FastAPI + SQLAlchemy + SQLite + Alembic
├── docs/        架构 / API / 数据库 / 安全 / 测试 / 阶段报告 / 调研报告
├── Plan/        阶段计划与升级决策
├── .env.example 环境变量模板（密钥留空）
└── README.md
```

## 在 Windows 11 上启动

### 1. 后端

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
# 首次可用国内镜像：
# .\.venv\Scripts\pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ --no-cache-dir
.\.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

后端默认 `http://localhost:8000`，接口文档 `http://localhost:8000/docs`。

### 2. 配置真实 API Key（可选，但 AI 抽取/规划需要）

复制根目录 `.env.example` 为 `backend/.env`（或项目根 `.env`），填入真实值：

```env
LLM_PROVIDER=qwen
LLM_API_KEY=你的真实密钥
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
```

- 未配置 Key 时，解析/规划明确返回 503，**不生成任何假事实或假规划**。
- 密钥只在后端 `.env`，不进前端、不进日志、不提交 Git。
- 生产必须收紧：`ALLOW_UNAUTH_TEST_ENDPOINTS=false`、`JWT_SECRET`/`ENCRYPTION_KEY` 设强随机值、`CORS_ALLOW_ORIGINS` 收敛域名、`STRICT_PRODUCTION=1`（见 `docs/PRODUCTION_HARDENING_GUIDE.md`）。

### 3. 前端

```powershell
cd frontend
npm install
npm run dev
```

前端默认 `http://localhost:5173`，`/api` 代理到后端 8000。

## 推荐使用流程（主线）

1. 注册并登录 → 创建科研项目。
2. 到「材料管理」上传论文 PDF、实验配置、代码/数据文件。
3. 发起解析（需 LLM Key）→ 到「科研事实」查看抽取结果与逐字证据；到「证据图谱」看主张—证据—原文关系。
4. 到「复现验证」建立规划与任务、确认后创建运行；查看指标对照与诊断。
5. 无需 Key 也可使用：确定性失败诊断（AI 诊断页）、静态代码分析、数值重算、基准指标、图表反向验证（项目验证页）、项目交接包导出/校验（交接包页）。

「审计演示」页只使用合成材料，是功能演示入口，**不是真实论文审计**。

## 测试

```powershell
cd backend
$env:PYTHONPATH = "."; .\.venv\Scripts\python -m pytest -q
cd ..\frontend
npm run typecheck
npm run build
```

当前基线：后端 205 passed；前端 typecheck/build 通过。LLM 相关测试用协议级 mock，真实模型连通性需自行配置 Key 后验证。详见 `docs/STAGE6_TEST_AND_BUGFIX_REPORT.md`。

## 研究依据（第九阶段）

- `docs/STAGE9_GITHUB_RESEARCH.md`：23 个开源科研工具真实调研（GitHub API 元数据 + LICENSE 原文核实）。
- `docs/STAGE9_ACADEMIC_STANDARDS_RESEARCH.md`：ACM v1.1 / FAIR / RO-Crate / W3C PROV 等官方规范调研。
- `docs/STAGE9_COMPETITOR_AND_POSITIONING.md`：14 平台 12 维对比与"独立核对层"定位。
- `docs/STAGE9_UPGRADE_DECISION.md`：8 候选方向评分与落地选择。

**合规声明**：ReproCheck 仅"参考 ACM v1.1 框架"设计自检项，**不获得也不宣称 ACM 认证或任何机构背书**；所有结论只代表自身验证范围内的证据。

## 安全与范围边界

- 前端不存密钥；后端不回显密钥。
- 证据原文从用户上传材料的后端字节读取，拒绝模型虚构引用。
- **不执行用户上传的代码**；`enable_code_execution=False`、`execution_backend=none` 为默认。
- 不购买服务器/域名/GPU；不做真实生产部署声明。
- 未进行五篇权威论文实战、365 天真实运行或备份恢复演练；这些均标为未完成。
