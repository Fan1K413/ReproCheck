# 第六阶段核心能力闭环 · 实施计划

## 状态
进行中。检查点：`ae339ce` / tag `stage6-checkpoint-preflight`。

## 需求→步骤映射
- R1 任务编排（暂停/继续/超时/恢复/失败分类/日志）→ Wave A
- R2 项目交接包（ZIP+JSON清单+哈希+权限）→ Wave B
- R3 失败诊断/图表反向验证/验证引擎分层/基准 → 后续 Wave，本轮先状态标注（见 STAGE6_REAL_STATUS.md）
- R4 前端操作入口与集成验证 → Wave C
- R5 独立验收与交付文档 → Wave D

## 验收口径（冻结）
1. 任务编排：真实状态流转，有 `paused/resumed/timed_out` 状态与 API；超时有测试；失败分类有枚举；不引入固定进度条。
2. 交接包：ZIP 含材料原文/事实/证据/报告/日志/产物，manifest.json 有 sha256 校验，导入校验哈希与权限；无越权读取他人数据。
3. 迁移：新增列 nullable/有默认值，幂等迁移可重跑；已有库升级不丢数据。
4. 回归：后端全量测试通过；前端 typecheck/build 通过。
5. 不执行上传代码，不购买服务，不伪造论文结果。

## 安全闸门
- 项目隔离：所有新 API 必须经 `enforce_project_isolation` + 资源归属校验。
- 权限：导出/导入需 `get_current_user` + 项目成员校验。
- 导入 ZIP：防路径穿越（Zip Slip）、限大小、仅允许白名单条目。
- 不回滚既有未提交改动；失败用检查点 tag 恢复。

## Wave A — 任务编排器状态机（agent: impl-orchestrator）
文件：`models/stage2.py`（新增列）、`db/migrate.py`（幂等列）、`services/task_service.py`、`api/v1/parse_tasks.py`、新测试。
出口：`pytest` 新增测试通过，含 pause/resume/timeout/recover 与失败分类。

## Wave B — 项目交接包导出/导入（agent: impl-handoff）
文件：新 `services/handoff_service.py`、新 `api/v1/handoff.py`、`api/__init__.py`（仅注册）、新测试。
出口：ZIP 内容断言、哈希校验、越权拒绝测试通过。

## Wave C — 集成与前端（主 Agent）
前端导出/导入入口、事实页接线核对；回归验证。

## Wave D — 独立验收（agent: verifier）
未参与开发的测试智能体走用户流程，记录证据与 Bug。

## 回滚决策
任一 Wave 测试失败且无法在 3 轮内修复 → 该 Wave 回退到检查点，其余 Wave 保留；如实披露。

## 不卡死计数
Wave A: 0；Wave B: 0；Wave C: 0；Wave D: 0。上限 3，达上限列方案并披露。
