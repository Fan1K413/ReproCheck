# 交付 5：本地版与 Site 版能力对比（第十一阶段）

## 1. 两种形态

- **A 本地版**：FastAPI + SQLAlchemy + SQLite + React Vite（`/api` → `localhost:8000`）。
- **B Qoder Site 版**：同一 SPA + 单个 Deno Edge Function（`functions/`）+ 托管 PostgreSQL + 同源
  `/functions/v1/app/api`（`.env.site`）。

两版共用同一套前端页面与 API 路径契约；Site 版后端逻辑在 `frontend/functions/domain_*.ts` 镜像实现。

## 2. 能力矩阵（模型管理相关）

| 能力 | 本地版 | Site 版 |
|---|---|---|
| 模型管理 UI（7 分区） | ✓ | ✓（同一页面） |
| 10 家供应商列表 + 能力矩阵 | ✓ | ✓ |
| 用户级 API 凭据加密存储 | Fernet + `MODEL_CREDENTIAL_KEY` | WebCrypto Fernet 兼容 + `APP_MODEL_KEY`（可回落 `APP_JWT_SECRET`） |
| SSRF 防护 | HTTPS + DNS 全记录网段校验 + 禁止重定向 | 字面地址/元数据域名拦截 + HTTPS；**无 DNS 解析** |
| 真实连接测试 | ✓ 出站 httpx | ✓ 出站 fetch（受平台网络策略约束） |
| 模型列表拉取 | ✓ | ✓ |
| 任务级绑定 / 默认备用 / 统计 / 日志 / 路由记录 | ✓ | ✓（7 表已定义 schema） |
| 自动路由执行 | ✓（网关） | ✗（Site 版无模型调用运行时，只做配置与测试；明确标注） |
| 本地沙箱执行 / 文件解析 / PDF 报告 | ✓（默认关闭） | ✗（`DEMO_LIMIT`） |
| 密钥进入浏览器 | 否 | 否（仅 `VITE_API_BASE_URL` 同源路径） |

## 3. 一致性测试

- 两版供应商 key、任务键、API 路径、信封格式一致；
- 本地：22 项 modelhub API 测试（凭据隔离、脱敏、SSRF、真实测试语义、统计）通过；
- Site：本地桥接 `dev/probe.mjs domain_models 8013` 实测 providers=10、创建凭据、列表脱敏、
  创建 profile、绑定、stats 全部通过；因平台注入模块 `functions/_qoder/*` 不在仓库，
  **未做真实云端部署联调**，报告不得声称已部署成功。

## 4. 部署前置条件

Site 版需先执行 `frontend/dev/schema_modelhub.sql` 创建 7 张表，并在 Sites → Settings → Secrets 配置 `APP_MODEL_KEY`。
未配置时凭据仍可保存（回落到 `APP_JWT_SECRET`），但应在部署清单中标记安全降级。

## 5. 明确不支持

Site 版不提供文件/沙箱执行、真实 PDF 解析、PDF 报告下载、真实 GitLab/Gitee commit 拉取；
这些能力只属于本地版，界面与文档均已标注，不用静态 UI 冒充功能落地。
