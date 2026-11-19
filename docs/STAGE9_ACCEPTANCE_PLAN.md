# 第九阶段 · 独立验收计划（第八步）

执行人：未参与 U1/U2/U4 实现的独立测试智能体。执行时机：实现完成并注册路由后。基线 tag `stage9-baseline`（33b6a5c）。

## 验收范围（用户第八步要求的 12 类场景）
1. 正常科研项目：注册→建项目→上传材料→解析→看事实/证据图谱/verdict-summary。
2. 缺失 README 的项目：材料完整性维度应降级而非 VERIFIED。
3. 无公开数据集的项目：material_available 维度应 PARTIALLY/UNVERIFIABLE，不编造。
4. 依赖版本冲突的项目：确定性诊断/静态分析给出候选原因，不冒充确定根因。
5. 论文与代码不一致的项目：verdict 应 CONFLICTING 且附证据。
6. 数据划分存在风险的项目：如无检测能力，明确标"未覆盖/证据不足"，不假报安全。
7. 运行超时的项目：任务 failure_category=timeout + error_code=TASK_TIMEOUT。
8. 运行失败的项目：诊断候选原因 is_confirmed=false。
9. 结果与论文有差异的项目：MetricComparison verdict=significant_deviation → CONFLICTING。
10. 只有部分实验材料的项目：五态中 INSUFFICIENT_EVIDENCE 占比合理，scope_note 有认证声明。
11. 大型科研项目：模拟多材料（如 10+），聚合 API 不 500，耗时可接受。
12. 多成员共同审计：两个真实用户，非成员访问他人项目 404；成员可见。

## 统计口径（适用范围内）
- 五态映射正确率：对人工标注的 N 个状态样本，map_to_verdict 输出与预期一致的比例。
- 证据定位完整率：evidence_locator.ratio 与真实携带 page/line 的证据一致。
- Precision/Recall/F1：对"应报冲突"的样本，系统报 CONFLICTING 的 P/R/F1（用 benchmark_metrics 计算）。
- 越权拒绝率：非成员访问项目端点返回 404/403 的比例（目标 100%）。
- 运行成功率/任务耗时：仅记录真实执行结果，无 Docker 时标 BLOCKED。

## 必须披露
- 失败案例、误报/漏报分析；
- 环境限制导致的 BLOCKED（真实 LLM Key、Docker/OCR、论文数据）；
- 不声称 ACM 认证；不伪造论文结果。

## 通过门槛
- P0/P1 Bug = 0；后端全量测试 ≥205 passed；前端 typecheck/build 通过；
- U1 五态映射与三维输出有真实例子；U2 至少 4 项能力有真实前端入口（浏览器或 HTTP 证据）；README 与真实状态一致。
