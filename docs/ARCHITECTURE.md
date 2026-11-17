# ReproCheck 架构说明（第一阶段）

## 1. 总体架构

```
浏览器 (React SPA)
   │  HTTP / JSON（同源 /api 代理）
   ▼
FastAPI 后端  ── 静止前端由前端服务提供，后端只提供 API
   │
   ├── API 层 (app/api/v1)      统一响应/异常、访问令牌、请求体大小限制
   ├── 服务层 (app/services)    审计链路编排、程序化比对、证据验证
   ├── LLM 层 (app/llm)         OpenAI 兼容协议适配，密钥只在后端
   ├── 数据层 (db/models)       SQLAlchemy 2.0 + SQLite（可迁移 PostgreSQL）
   └── Schema (app/schemas)     Pydantic v2 严格校验
```

**为什么前后端分离**：任务书要求密钥绝不进入前端。前端只与后端 API 通信，模型调用全部由后端发起。

## 2. 部署形态

- **本地开发**：前端 Vite dev server（5173）+ 后端 uvicorn（8000），Vite 把 `/api` 代理到后端。
- **Windows 11 生产**：前端 `npm run build` 产出 `dist/`，用 Nginx 托管并反代 `/api` 到 uvicorn；或前端托管到静态站点、后端单独部署（云服务器/容器）。
- **关于 Qoder Sites**：当前工作区环境未提供 Qoder Sites 后端运行时/数据库/Secrets 的可验证能力。因此**不假装静态页面已接通后端**。若目标账号仅支持静态部署，采用"Qoder Sites 托管前端 + 独立后端服务（云服务器/容器）"结构，后端环境变量用服务器的 Secret 管理。

## 3. 四层审计链路

1. **AI 结构化抽取**：两份材料各自一次真实模型调用，输出 Pydantic `FactsExtraction`，每条事实携带 `evidence_chunk_id`。
2. **程序化事实比对**：`services/__init__.py` 用纯程序比较数值/字符串/单位/缺失字段，并做字段别名标准化。**冲突判断不交给大模型**。
3. **AI 风险解释**：仅把"已验证的冲突 + 真实证据原文"提交给模型，输出 `RiskExplanations`。
4. **证据链验证**：模型引用的 chunk_id 若不在本次提供的集合中直接拒绝；证据原文从后端 `source_chunks` 读取，绝不使用模型生成的引用文本。

## 4. 关键安全设计

- 前端无任何模型 API 调用，无 `VITE_*_KEY`。
- 密钥仅从后端环境变量读取；日志、错误、接口响应均不回显（见 SECURITY.md）。
- 连接测试与审计接口支持 `X-Admin-Token` 访问控制，防止额度滥用。
- 请求体大小限制 1MB，超时可控，重试有限（最多 1 次修复），不无限重试。

## 5. 目录结构

```
backend/app/
├── api/         路由与访问令牌依赖
├── core/        配置、异常、日志
├── db/          引擎与会话
├── models/      SQLAlchemy 表
├── schemas/     Pydantic 校验
├── services/    比对引擎 + 审计编排
├── llm/         模型适配层
└── tests/       单元/协议级 mock/端到端测试
frontend/        React 前端（由前端子任务实现）
docs/            交付文档
```
