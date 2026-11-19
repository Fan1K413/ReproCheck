# 第五阶段 · 功能验收矩阵

状态：PASS / PARTIAL / FAIL / NOT_IMPLEMENTED / BLOCKED / NOT_TESTED。
"单测通过"不等于 PASS；PASS 要求在真实后端、真实数据下实跑通过。当前**没有任何一项达到 PASS**。

| 功能 | 阶段 | 代码位置 | API | 数据来源 | 测试方法 | 结果 | 问题 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| 项目管理 | 1 | api/v1/projects.py | /projects | SQLite | pytest | NOT_TESTED（E2E） | 创建/读取无鉴权 | P0 |
| 用户与权限 | 1 | api/deps.py | — | — | 代码检查 | NOT_IMPLEMENTED | 仅共享令牌，无用户 | P0 |
| 跨用户隔离 | 1 | — | — | — | 代码检查 | NOT_IMPLEMENTED | 无用户归属 | P0 |
| 健康检查 | 1 | api/v1/health.py | /health | — | 代码检查 | NOT_TESTED | — | P3 |
| 材料上传/存储 | 1 | api/v1/materials.py | /materials | 文件存储 | pytest | NOT_TESTED（E2E） | 大文件未测 | P2 |
| PDF/DOCX/代码/配置解析 | 2 | parsers/ | /parse-tasks | 上传文件 | pytest | NOT_TESTED（真实材料） | 未用真实论文测 | P1 |
| LLM 事实抽取 | 2 | llm/ | /parse-tasks | 模型 API | — | BLOCKED | 无 LLM_API_KEY | P1 |
| 证据定位/原文位置 | 2 | services/ | /facts | SQLite | pytest | NOT_TESTED（E2E） | — | P1 |
| 审计快照与确定性规则 | 3 | stage3 worktree audits/ | /audits | 阶段2事实 | pytest 347 | PARTIAL | 未提交、未合并 | P1 |
| 语义审计 | 3 | audits/semantic.py | /audits | 模型 API | pytest（隔离 mock） | BLOCKED | 无 Key | P1 |
| 证据图谱 | 3 | features/audit/EvidenceGraph.tsx | /audits/{id}/graph | 审计结果 | 前端单测 | NOT_TESTED（浏览器） | — | P2 |
| 人工复核留痕 | 3 | audits/service.py | /findings/{id}/review | SQLite | pytest | PARTIAL | 署名为自填，无真实身份 | P1 |
| 来源导航 | 3 | audits/sources.py | /findings/{id}/sources/{eid} | 原文件 | pytest | PARTIAL | 前端未接入 | P2 |
| 复现任务规划 | 4 | reproduction/ | /reproductions/tasks | 事实/审计 | pytest | NOT_TESTED（E2E） | 未接阶段3审计结果 | P1 |
| 沙箱预检 | 4 | reproduction/sandbox.py | /reproductions/runs | 配置 | pytest | PARTIAL | 正确拒绝；无 Docker | — |
| 真实代码执行 | 4 | reproduction/sandbox.py | /reproductions/runs | Docker | — | BLOCKED | Docker 未安装 | P1 |
| 结果对比 | 4 | reproduction/ | — | 运行产物 | pytest | NOT_TESTED（真实运行） | 依赖执行 | P1 |
| AI 失败诊断 | 4 | reproduction/ | — | 模型 API | — | BLOCKED | 无 Key | P1 |
| 报告 / PDF 导出 | 4 | reproduction/report.py | — | 运行证据 | pytest | NOT_TESTED | `_try_pdf` 依赖未核实 | P2 |
| 前端 lint/测试门禁 | 4 | frontend/package.json | — | — | npm | NOT_IMPLEMENTED | 无 lint、test 脚本 | P2 |
| 依赖安全 | 全 | frontend | — | npm audit | npm audit | FAIL | react-router 2 moderate | P2 |
| 端到端主流程 | 全 | — | — | — | — | NOT_TESTED | 阶段3/4未合并 | P0 |
