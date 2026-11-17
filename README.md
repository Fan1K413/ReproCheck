# ReproCheck｜科研复现审计官

面向机器学习论文的跨材料复现审计平台。研究者提供论文说明与实验配置，系统通过真实大模型 API 抽取结构化实验信息，再由程序进行跨材料事实比对，发现参数冲突与说明不一致，并给出可追溯证据。

> **第一阶段**：已实现大模型接入、连接测试、文本材料输入、AI 结构化抽取、程序化参数比对、AI 风险解释、证据链验证、审计结果展示与运行记录保存。
> 输入为**合成测试材料**，不是真实论文。真实 API 调用需你自行配置密钥（见下文）。

## 目录

```
ReproCheck/
├── frontend/    React + TS + Vite + Tailwind 前端
├── backend/     FastAPI + SQLAlchemy + SQLite 后端
├── docs/        架构 / API 契约 / 数据库 / LLM 集成 / 安全 / 测试 / 完成报告
├── .env.example 环境变量模板（密钥留空）
└── README.md
```

## 在 Windows 11 上启动

### 1. 后端

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
# 首次请用国内镜像加速：
# .\.venv\Scripts\pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ --no-cache-dir
.\.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

后端默认监听 `http://localhost:8000`，接口文档：`http://localhost:8000/docs`。

### 2. 配置真实 API Key（关键）

复制项目根目录的 `.env.example` 为 `backend/.env`（或 `项目根/.env`），填入真实值：

```env
LLM_PROVIDER=qwen
LLM_API_KEY=你的真实密钥
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
LLM_TIMEOUT=60
LLM_MAX_RETRIES=1
```

- 默认走通义千问的 OpenAI 兼容接口；其他 OpenAI 格式服务改 `LLM_BASE_URL` 和 `LLM_MODEL` 即可。
- **密钥只放后端 `.env`，不要提交 Git，不要放前端**。
- 生产环境务必设置 `ADMIN_TOKEN=一个强随机值`，并在前端请求头带 `X-Admin-Token`（防止他人消耗你的额度）。

### 3. 前端

```powershell
cd frontend
npm install
npm run dev
```

前端默认 `http://localhost:5173`，已配置把 `/api` 代理到后端 8000 端口。

## 使用流程

1. 打开「AI 模型服务」页 → 点击「测试模型连接」，验证真实模型是否回复"ReproCheck API 连接成功"。
2. 打开「审计演示」页 → 确认两段合成材料 → 点击「开始分析」。
3. 查看：结构化参数抽取、参数一致性比较（冲突/一致）、AI 风险说明、证据原文、调用耗时与 Token。

## 预设验收结果

用官方合成材料分析后，程序应发现两项冲突：

| 参数 | 论文 | 配置 | 结果 |
|---|---|---|---|
| Batch Size | 64 | 32 | 冲突 |
| Learning Rate | 0.001 | 0.0001 | 冲突 |
| Epochs | 100 | 100 | 一致 |
| Optimizer | AdamW | AdamW | 一致 |

## 测试

```powershell
cd backend
.\.venv\Scripts\python -m pytest app/tests/ -q
cd ..\frontend
npx tsc --noEmit
npm run build
```

未配置真实密钥时：真实 API 调用测试标记为「待配置真实密钥」；程序逻辑由协议级 mock 覆盖。详见 `docs/TEST_REPORT.md`。

## 部署到 Qoder Sites / 生产

见 `docs/ARCHITECTURE.md`。若部署平台只支持静态前端，则前端托管静态站点、后端独立部署（云服务器/容器），后端环境变量用平台 Secret 管理。

## 安全与范围

- 前端不直连模型 API、无密钥；后端日志/错误/响应不回显密钥。
- 证据原文从后端材料读取，拒绝模型虚构的 chunk_id。
- 不运行用户上传的代码，不解压执行 ZIP。
- 第一阶段仅处理文本材料，未实现 PDF 页码、代码行号、完整论文库搜索、多智能体协作。
