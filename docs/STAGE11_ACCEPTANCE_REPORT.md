# 交付 12：第十一阶段升级验收报告

> 验收时间：2026-11-20。口径：只把有真实代码 + 测试/浏览器证据的项标为"完成"。

## 1. 验收标准逐项结论

| # | 标准 | 结论 | 证据 |
|---|---|---|---|
| 1 | 用户能在软件内自行配置 API Key | 完成 | `/settings/models` 模型管理中心；浏览器实测创建凭据成功 |
| 2 | 不再局限于千问 | 完成 | 10 家供应商注册表 + 3 类适配器；registry 测试 |
| 3 | 支持自定义 OpenAI 兼容接口 | 完成 | `openai_compatible` provider + Base URL 表单 + SSRF 校验；API 测试 |
| 4 | 多供应商适配层真正接入业务任务 | 完成 | 5 类任务经 TaskLLM/网关；环境变量回落保证历史测试 |
| 5 | API Key 安全存储、不通过接口泄露 | 完成 | Fernet/WebCrypto 加密、脱敏视图、归属隔离、撤销/删除 |
| 6 | 用户能选择不同科研任务的模型 | 完成 | 任务绑定 API + UI；7 个任务键 |
| 7 | 连接测试真实有效 | 完成（失败路径已实测） | 真实 fetch/httpx 调用；浏览器返回 auth_failed；成功路径待真实 Key |
| 8 | 本地版与 Site 版能力边界清晰 | 完成 | 能力矩阵文档 + Site 桥接实测；未做云端部署，如实标注 |
| 9 | 全局主要 UI 交互问题得到修复 | 完成（范围内） | 浏览器实测发现 4 个问题并修复；verify_ui 38/38 |
| 10 | 原有核心功能没有回归破坏 | 完成 | 全量 pytest 357 passed（历史 219 项均在内）；verify_ui 38/38 |
| 11 | 至少完成两项有实际价值的新科研功能 | 完成 | 实验差异分析中心 + 项目变化监控与影响分析 |
| 12 | 所有新功能均经过独立测试 | 完成 | test_modelhub.py 16 项 + test_research_features.py 4 项 |
| 13 | 所有完成情况都有真实代码和测试证据 | 完成 | 见下方文件清单与测试输出 |

## 2. 明确未完成 / 受限项（不冒充完成）

- **真实供应商联调**：没有任何厂商真实 API Key；所有适配层测试是协议级模拟。
- **Site 版云端部署**：平台注入的 `functions/_qoder/*` 不在仓库，只在本地桥接验证，未部署。
- **Site 版自动路由执行**：Site 无模型调用运行时，仅支持配置与连接测试。
- **功能 C/D/E/F**：证据图谱全链路、审稿工作台、资源预算、RO-Crate 归档未落地；只做可行性说明。
- **多用户并发浏览器实测**与**全局轮询治理**：时间限制，未做。

## 3. 本阶段新增/修改的核心文件

后端：
```
app/modelhub/{__init__,capabilities,errors,security,base,registry,gateway,bridge,context}.py
app/modelhub/adapters/{__init__,openai_compatible,anthropic,gemini}.py
app/models/modelhub.py                     # 7 张新表
app/api/v1/modelhub.py                     # 模型中心 API
app/api/v1/research_features.py            # 两项新功能 API
app/services/experiment_diff_service.py
app/services/change_monitor_service.py
app/services/repository_service.py        # 快照记录真实变更文件
（改造）services/extraction_service.py、services/audit_service.py、
        services/rag_service.py、reproduction/{planner,diagnostics}.py、
        api/v1/reproductions.py、api/__init__.py、db/__init__.py、main.py、
        core/config.py、core/errors.py、tests/test_production_safety.py
```

前端：
```
src/pages/ModelCenterPage.tsx
src/pages/{ExperimentDiffPage,ChangeMonitorPage}.tsx
src/services/{modelApi,researchApi}.ts
src/types/{model,research}.ts
（改造）src/App.tsx、src/components/AppLayout.tsx、src/pages/LlmSettingsPage.tsx
functions/domain_models.ts、functions/routes.ts、dev/fake-db.mjs
dev/schema_modelhub.sql
```

## 4. 测试结果

- 后端：`357 passed`（基线 219 + 本阶段新增 20，其余为同工作区并行任务新增；历史断言未删改）。
- 前端：`npm run typecheck` 通过；`npm run build` 成功（仅有既存 bundle 体积警告）。
- API：见 `STAGE11_API_TEST_REPORT.md`。
- 浏览器：`STAGE11_BROWSER_TEST_RECORD.md`，`verify_ui.mjs` 38/38、consoleErrors 0。

## 5. 上线前置条件（必须执行，否则功能不可用或不安全）

1. 本地版设置独立 `MODEL_CREDENTIAL_KEY`（与 `JWT_SECRET`、`ENCRYPTION_KEY`、数据库分离）；
   未设置时用户级凭据保存会返回 503（fail-closed）。
2. 生产关闭 `ALLOW_LOCAL_MODEL_ENDPOINT`、`allow_unauth_test_endpoints`，收紧 CORS 与 JWT。
3. Site 版先执行 `frontend/dev/schema_modelhub.sql`，并配置 `APP_MODEL_KEY` Secret。
4. 数据库新表由 `init_db()` 的 `create_all` 自动创建（不改既有 53 表）；Site 需手工迁移。

## 6. 总体结论

本阶段把 ReproCheck 从"单一千问 + 只读状态页"升级为"10 家供应商统一适配 + 用户级加密凭据 +
任务级模型绑定 + 真实连接测试 + 两项目有真实数据支撑的科研分析功能"的产品形态。
原有测试与浏览器基线保持通过；未取得真实 Key 与 Site 云端部署的部分均已明确标注为未完成，
没有用静态界面冒充功能落地。
