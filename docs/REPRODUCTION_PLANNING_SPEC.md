# 反向复现规划规范（REPRODUCTION_PLANNING_SPEC）

## 1. 定位

让 ReproCheck 扮演独立研究者：把论文作者视角的实验描述，转成可执行者视角的复现步骤 DAG。

## 2. 输入

1. 第二阶段 `extracted_facts`（field/value/assertion/证据）；
2. `Stage3AuditAdapter` 提供的审计视图——**明确标注**来自第一阶段 demo 审计 + 程序化比对，非"第三阶段审计引擎"；
3. materials 列表（材料存在性判定）。

## 3. AI 规划（真实调用）

- 复用 `LLMService.chat(response_schema=ReproductionPlanIn)`；
- 提示词版本 `repro-plan-v1.0`，写入 `reproduction_plans.prompt_version`；
- 要求输出覆盖：研究目标/模型结构/数据集/预处理/训练参数/环境/依赖/训练命令/随机种子/评价指标/对照/消融/预期输出/验证方式；
- 严禁：固定 JSON、预设回答、随机文本；无 Key 直接报 `LLM_KEY_NOT_CONFIGURED`，不返回任何规划。

## 4. 任务 Schema（每项必含）

`task_key / title / description / depends_on / required_materials / action / expected_result / acceptance_criteria / evidence_refs / risk / feasibility / feasibility_reason / needs_human_confirm`

## 5. 程序校验（AI 说了不算）

1. **DAG 校验** `validate_dag()`：重复 key、未知依赖、循环依赖 → `DAG_INVALID`，规划失败；
2. **可行性校验** `check_feasibility()`（确定性规则，覆盖 AI 的 feasibility）：
   - `ready`：具备条件
   - `missing_material`：所需材料不在项目
   - `missing_dependency`：依赖声明缺失
   - `missing_configuration`：关键参数事实（lr/batch_size）缺失
   - `needs_human_review`：需人工确认
   - `blocked_security`：操作命中高风险模式（sudo/rm -rf/网络调用等）
   - `unverifiable`：当前条件无法验证
3. **阻断传播** `propagate_blocking()`：前置任务不可执行时，后继 `ready` 任务改为 `missing_dependency` 并 `blocked`——数据集缺失就阻断训练，不假装可继续。

## 6. 严谨性约束

- 材料未记录数据集地址 → `missing_material`，理由明确"不代表该材料不存在"；
- 材料未记录随机种子 → 不得判定作者未用随机种子，标记 `needs_human_review` 或 `unverifiable`；
- 不把材料缺失写成"研究造假/实验未实施"。

## 7. 修复流程

AI 输出缺字段/依赖错误/任务不可执行 → Pydantic 校验失败或 DAG_INVALID → 异常上抛；LLM 适配层对格式错误做 1 次有限修复请求，仍失败报 `LLM_INVALID_FORMAT`。不静默修补成"可执行的假任务"。

## 8. 测试证据

`test_planner_generates_valid_dag`（mock LLM 生成 2 任务 DAG，断言落库）、`test_planner_no_key_fails_without_fake_plan`（无 Key 零规划落库）、`test_planner_rejects_cycle_from_ai`（AI 返回环被拒）、DAG/可行性 7 项单测。
