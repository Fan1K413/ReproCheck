# 执行工作流（EXECUTION_WORKFLOW）

## 1. 完整流程

```
用户发起复现 → 安全预检 → 环境检查 → 任务依赖检查 → 人工授权
→ 创建隔离环境 → 执行命令 → 采集日志 → 提取结果 → 结果验证
→ 生成报告 → 清理环境
```

当前环境因无安全隔离后端，流程在"创建隔离环境"前即以 `blocked_no_sandbox` 终止，后续步骤不假装执行。

## 2. 各步骤实现状态

| 步骤 | 实现 | 状态 |
|---|---|---|
| 发起复现 | POST /reproductions/runs | ✅ 真实 |
| 安全预检 | SecurityPreflight.scan_text | ✅ 真实（静态） |
| 环境检查 | EnvDetector.detect | ✅ 真实 |
| 任务依赖检查 | validate_dag + propagate_blocking | ✅ 真实 |
| 人工授权 | tasks/{id}/confirm + remediations review | ✅ 真实 |
| 创建隔离环境 | sandbox_available() | ❌ 当前禁用（明确标注） |
| 执行命令 | — | ❌ 当前禁用 |
| 采集日志/产物 | GET runs/{id}/logs, artifacts | ✅ 接口真实（无执行时为空） |
| 结果提取 | ResultExtractor | ✅ 真实（对已有文本/CSV/JSON） |
| 结果验证 | MetricComparator + QualityEvaluator | ✅ 真实 |
| 生成报告 | ReportGenerator 14 章 | ✅ 真实 |
| 清理环境 | 设计 | 执行禁用无环境可清理 |

## 3. 任务状态（来自真实 Worker/DB，非前端计时器）

`pending → blocked / confirmed → running → completed / failed / cancelled`
运行级：`pending / blocked_no_sandbox / blocked_security / running / completed / failed / cancelled`

前端 `GET /reproductions/runs/{id}` 查询真实状态；`cancel` 记录 `cancel_requested` 与终态（同步执行禁用时无进程需终止，API 明确返回 note）。

## 4. 日志与产物

- `execution_logs`：stream(stdout/stderr) + content + 时间戳；
- `execution_artifacts`：name/path/size/hash；
- 无 Key/无执行时这些表为空，前端显示空状态而非伪造日志。

## 5. 资源与生命周期

配置项：`execution_timeout_seconds=300`、`max_cpu_seconds=120`、`max_memory_mb=2048`、`max_pids=128`、`allow_network=false`。这些是**执行启用后的策略**，当前未启用，未经真实容器验证。

## 6. 幂等与恢复

- 创建运行每次生成新 run_id，无重复执行；
- `cancel` 幂等（终态重复取消返回 cancelled:false）；
- 服务重启后从 DB 读真实状态，不推断为成功；
- 无分布式任务队列（不假装拥有），当前同步任务均无实际执行。
