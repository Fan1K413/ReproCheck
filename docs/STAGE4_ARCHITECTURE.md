# 第四阶段架构（STAGE4_ARCHITECTURE）

## 1. 分层与模块

```
前端复现工作台 (7 页面)
   │ HTTP /api/v1/reproductions/*
   ▼
FastAPI 路由层 app/api/v1/reproductions.py (21 条新接口，追加式)
   ▼
复现引擎 app/reproduction/
   ├── planner.py        AI 反向规划（复用 LLMService）
   ├── prompts.py        规划/诊断提示词（版本号）
   ├── adapter.py        第三阶段兼容适配层 + DAG 工具
   ├── feasibility.py    确定性可行性校验 + 安全阻断
   ├── sandbox.py        安全预检 + 环境检测 + 受控执行（默认禁用）
   ├── results.py        指标提取 / 对照 / 质量评估
   ├── diagnostics.py    AI 失败诊断 + 修复审核
   └── report.py         14 章报告（HTML/PDF）
   ▼
数据层 app/models/stage4.py (12 张新表) + 幂等迁移
   ▼
复用基座：LLMService / errors / 第二阶段 facts+evidence
```

## 2. 关键设计决策

1. **不假设第三阶段存在**：磁盘实测第三阶段零实现。`Stage3AuditAdapter` 只暴露第一阶段 `audit_findings` + 第二阶段 `extracted_facts` 的既有数据视图，并在提示词中明确标注。
2. **确定性 vs AI 分工**：DAG 结构校验、可行性判定、安全阻断、指标比较规则全部由程序决定；AI 只做规划建议与失败诊断，且必须经 Schema 校验与程序复核。
3. **安全优先于演示**：无 Rootless Docker/gVisor 时 `ExecutionSandbox.sandbox_available()` 返回 false，所有运行请求状态为 `blocked_no_sandbox`、`execution_enabled=false`，绝不假装执行。
4. **材料缺失 ≠ 研究造假**：可行性校验消息明确写"仅表示当前材料库缺少记录，不代表该材料不存在/研究者未设置"。
5. **运行成功 ≠ 复现成功**：指标比较有 6 种 verdict，比较条件不一致优先判 not_comparable；质量评分公开公式并声明不代表学术质量。

## 3. 数据流（规划）

```
projects/materials → extracted_facts + audit_findings (适配层)
   → LLMService.chat(planning prompt, schema=ReproductionPlanIn)
   → Pydantic 校验 → validate_dag(环/未知依赖)
   → check_feasibility(程序规则) → propagate_blocking
   → reproduction_plans + reproduction_tasks 落库
```

## 4. 数据流（执行与验证）

```
plan → create_run → SecurityPreflight.scan + EnvDetector.detect
   → sandbox_available() 检测 → 当前 blocked_no_sandbox
   （若将来有安全容器：独立工作目录 → 非root容器 → 无网络 → 资源限制 → 日志/产物采集 → 清理）
   → ResultExtractor(日志/CSV/JSON) → reproduction_metrics
   → MetricComparator → metric_comparisons
   → QualityEvaluator → quality 接口
   → ReportGenerator → 14 章报告
```

## 5. 安全边界

- 禁止在主 API 进程执行用户代码（架构层面从未实现执行器）；
- 安全阻断由程序规则决定，AI 不参与；
- 网络默认关闭，云元数据/私有地址静态扫描命中即阻断；
- 执行环境不继承 API Key/数据库密码等敏感环境变量（设计中，因执行禁用暂无实际继承面）；
- 项目数据隔离：诊断接口校验 `run.project_id == project_id`，跨项目访问返回 FORBIDDEN。

## 6. 外部阻塞与降级

| 阻塞 | 降级 |
|---|---|
| 无真实 API Key | 规划/诊断接口复用 LLMService、无 Key 报 503，协议级 mock 验证逻辑 |
| 无容器运行时 | 执行默认禁用，提供静态检查与环境分析 |
| 旧报告未保存 PDF | 用 PyMuPDF 从已生成的 HTML 按需生成 PDF |

## 7. 前序兼容

第一/二阶段 19 条业务接口与 11 张表未改动；本阶段 21 条接口 + 12 张表全部追加；76 项测试含前序 52 项回归全过；Git 基线在 master，本阶段在 `stage4/reproduction-engine` 分支。
