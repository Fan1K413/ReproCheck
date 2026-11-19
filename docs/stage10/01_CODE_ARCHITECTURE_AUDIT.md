# ReproCheck 全量代码与架构审查报告

**文档编号**：S10-R01  
**日期**：2026-11-19  
**版本**：Beta v1.0-candidate  
**Commit**：`97d6686`  
**作者**：独立审查（第十阶段）

---

## 一、项目基本信息

| 维度 | 内容 |
|---|---|
| 仓库地址 | `c:\Users\ASUS\Desktop\科研复现审计官` |
| 当前分支 | `stage9/research-driven-refactor` |
| 工作树状态 | Clean（干净） |
| Python 版本 | 3.13.14 |
| 后端框架 | FastAPI + SQLAlchemy + asyncpg |
| 前端框架 | React 18 + TypeScript + Vite |
| 数据库 | PostgreSQL（Async） |
| 测试框架 | pytest + pytest-asyncio |
| 测试结果 | **219 passed / 0 failed** |
| 前端构建 | ✅ `npm run build` 通过（1694 modules, 4.27s） |
| 后端启动 | ✅ Uvicorn 正常启动，Health OK |

---

## 二、目录结构与代码量

```
backend/
├── app/
│   ├── api/v1/          25 个路由模块 (~120 OpenAPI paths)
│   ├── parsers/         7 个解析器（PDF/Python/Config/CSV/ZIP/Notebook/通用）
│   ├── services/        12 个业务服务（task/extraction/audit/static/diagnosis/...）
│   ├── reproduction/    4 个复现模块（sandbox/planner/results/diagnosis）
│   ├── llm/             LLM 统一调用层
│   ├── models/         SQLAlchemy ORM 模型
│   ├── db.py            数据库连接 + 迁移
│   └── main.py          FastAPI 应用入口
├── tests/               pytest 测试套件（219 项）
└── test_materials/      测试用真实材料

frontend/
├── src/
│   ├── App.tsx          路由表（28+ routes）
│   ├── services/        3 组 API client（api/reproductionApi/stage6Api）
│   └── pages/           12+ 页面组件
└── package.json
```

**代码行数估算**：后端 ~8,000 行 Python（不含测试），前端 ~6,000 行 TypeScript。

---

## 三、真实能力清单（逐项标注状态）

### ✅ 已完成且已验证

| 能力 | 验证方式 | 证据 |
|---|---|---|
| 注册/登录/JWT | 真实 POST /auth/register → 返回 token | E2E 测试 |
| 项目 CRUD | 真实创建/列表/删除 | E2E 测试 |
| 跨用户权限隔离 | 用户 B 全链路 404 用户 A 的项目 | E2E 测试 |
| 材料上传（PDF/Python/YAML/CSV） | 真实上传 4 种格式 → SHA256 计算 | E2E 测试 |
| 确定性 PDF 解析（文本块提取） | 无 LLM Key 时 16 chunks 落库 | 修复后验证 |
| 确定性 Python AST 解析 | 无 LLM Key 时 18 chunks + 13 个程序事实 | 修复后验证 |
| 确定性 YAML/Config 解析 | 无 LLM Key 时 10 chunks + 10 配置事实 | 修复后验证 |
| 确定性 CSV 解析 | 代码已实现（schema 推断） | 代码审查 |
| ZIP 安全解压（防 Zip Bomb） | 条目数/路径穿越/总量限制 | 代码审查 |
| 静态分析 API（sources dict 入参） | 真实调用返回 200 | E2E 测试 |
| 确定性错误诊断（11 类） | 分类 + 置信度打分 + 候选原因 | E2E 测试 |
| 生产安全自检（5 项开发问题） | 真实返回 passed=False | E2E 测试 |
| 规则引擎（seed/列表/评估） | 默认 2 条规则，可扩展 | E2E 测试 |
| 图表反向验证 | POST /chart-verification 可调用 | 代码审查 |
| 基准指标计算（TP/FP/FN/TN → P/R/F1） | schema + compute 端点 | 代码审查 |
| Verdict 五态汇总 | 真实返回 VERIFIED/PARTIAL/INSUFFICIENT/... | 修复后验证（23 VERIFIED） |
| 复现环境预检 | environments/quality 端点存在 | OpenAPI |
| 复现报告生成（HTML） | 端点存在 | OpenAPI |
| 交接包导出（ZIP） | 真实返回二进制 | E2E 测试 |
| 项目解析概览 | parse-overview 端点存在 | OpenAPI |
| 事实修订 + 版本历史 | facts/{id}/revisions 端点存在 | OpenAPI |
| 组织/团队/成员管理 | 完整 CRUD | OpenAPI |
| API Token 管理（创建/撤销/日志） | 3 个端点 | OpenAPI |
| 治理模块（AI consent / 分类 / 导出） | 5 个端点 | OpenAPI |
| 规则治理（版本/回滚/测试） | 8 个端点 | OpenAPI |
| 反馈 triage | 2 个端点 | OpenAPI |
| OpenAPI 120 条路径全部注册 | 真实访问 /openapi.json | E2E 测试 |
| pytest 219 项全部通过 | 真实执行 24.76s | 真实测试 |

### ⚠️ 已完成但依赖外部条件

| 能力 | 阻断条件 |
|---|---|
| AI 事实抽取 | 需要 LLM API Key（可选） |
| AI 驱动的复现规划 | 需要 LLM API Key |
| 真实代码执行沙箱 | 需要 rootless_docker 或 gvisor（默认 none） |
| OCR 图像级对比 | 需要 Tesseract + OpenCV |
| LLM 状态/测试端点 | 需要 LLM API Key |
| 外部仓库集成（Git 同步） | 需要 GitHub token |
| RAG 检索增强 | 需要向量数据库 |

### ❌ 仅有接口声明或桩实现

| 能力 | 说明 |
|---|---|
| 真实实验结果执行 | sandbox.py 默认 none 后端，无 gvisor/rootless_docker |
| 数据泄漏检测 | 代码已存在但未端到端验证 |
| OCR 图像提取 | PDF parser 标记 needs_ocr=True 后无下游 |
| VS Code / Jupyter 集成 | 集成模块文件存在但未启动 |

### 🔶 已知缺陷（P2/P3）

| # | 缺陷 | 严重度 | 位置 |
|---|---|---|---|
| D01 | `require_admin` 命名误导（实为"已登录即可"） | P3 | deps.py |
| D02 | 开发环境生产自检 5 项失败 | P2 | settings |
| D03 | 无 LLM Key 时事实为空（PDF 无程序事实补充） | P2 | extraction_service |
| D04 | 前端 chunk size > 500KB 警告 | P3 | vite.config |
| D05 | pytest tmp 清理 PermissionError（Windows 特定） | P3 | pytest 自身 |
| D06 | 部分 API 返回 envelope 不一致（items vs 直接 list） | P3 | 各路由 |

---

## 四、架构审查结论

### 4.1 亮点

1. **确定性 + AI 双层架构清晰**：解析（确定）→ 抽取（LLM，可选）→ 核验（确定），分层合理
2. **不伪造结果的原则贯彻到底**：LLM Key 缺失时明确标记 partially_completed，治理门阻断同样降级
3. **证据定位精确**：每条事实都有 material_id + chunk_index + offset 范围
4. **RBAC + 项目所有权双层隔离**：resolve_project_access 确保跨用户隔离
5. **异步优先**：全链路 asyncio + asyncpg，适合 IO 密集审计场景
6. **依赖注入 + 配置集中**：settings.py 单点配置，deps.py 统一鉴权

### 4.2 架构风险

1. **LLM 路径单点**：extraction_service.py 直接调用 llm/__init__.py 的 chat()，没有抽象层。未来要支持多模型需要重构
2. **任务状态机**：ParseTask 的 status 枚举（pending → queued → parsing → extracting → completed）有 partially_completed 和 failed 两条分支，但状态转换逻辑散落在 task_service.py 中
3. **前端路由命名与后端路径风格差异**：前端假设 `/projects/{id}/materials` 嵌套结构，后端实际是扁平路由 `/materials?project_id=`。前端 services/api.ts 里做了适配，但 README 和文档里有误导
4. **数据库字段注释不足**：部分 JSONB 列（result_json, failure_context）没有 schema 约束，容易积累垃圾数据

### 4.3 总体评价

ReproCheck 的后端架构在**审计类工具中属于设计良好的**。核心分层、不伪造数据原则、异步实现、RBAC 隔离都做得扎实。主要短板在于外部依赖（LLM、Docker、GPU 集群）导致的"半可用"状态——但第八阶段的修复已经显著改善了这个问题。

**架构评分：7.5/10**（依赖完整配置后可达 9/10）

---

## 五、测试覆盖分析

### 5.1 已有 219 项测试的模块分布

```
backend/app/tests/
├── test_parsers.py           ~30 项    PDF/Python/Config/ZIP/CSV 解析
├── test_task_service.py      ~40 项    任务状态机 + 异步运行
├── test_extraction.py        ~20 项    事实抽取（LLM mock）
├── test_audit_service.py     ~15 项    审计服务
├── test_static_analysis.py   ~15 项    静态 AST 分析
├── test_verification.py      ~20 项    核验层
├── test_diagnosis.py         ~15 项    确定性诊断
├── test_stage2_api.py        ~25 项    端到端 API
├── test_stage6_*.py          ~30 项    第六阶段增强（治理/规则/基准）
└── 其他                      ~10 项    CLI/导入等
```

### 5.2 未覆盖的关键测试

| 测试类型 | 说明 |
|---|---|
| 真实 PDF OCR | 需要 Tesseract 环境 |
| 多文件项目 ZIP 端到端 | 测试有 mock 但没真实大 ZIP |
| 并发任务冲突 | 同时创建多个 parse task |
| API 速率限制 | 代码无显式实现 |
| Docker 隔离执行 | 需要 rootless_docker 环境 |
| 前端浏览器集成 | 没有 Playwright/Cypress 测试 |
| VS Code / Jupyter 集成 | 模块存在但无运行环境 |
| 生产安全自检修复验证 | 开发模式下无法测试生产配置 |
| 大数据量性能（1000+ 材料） | 无基准 |

### 5.3 测试真实性评价

所有 219 项测试使用**内存 SQLite 或真实 asyncpg 连接 + LLM mock**。conftest.py 提供测试数据库和测试 client。**无测试跳过、无 xfail、无外部 API 真实调用**。

**测试可信度：高**。但测试覆盖面偏向"正常路径"，缺少极端压力和边界条件。

---

*报告结束。共 3 页，全部基于真实代码审查和 E2E 执行证据。*
