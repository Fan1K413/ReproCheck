# AI 诊断规范（AI_DIAGNOSTIC_SPEC）

## 1. 真实 API 调用

`FailureDiagnoser.diagnose()` 复用现有 `LLMService.chat(response_schema=DiagnosticIn)`：
- 无真实 Key → 抛 `LLM_KEY_NOT_CONFIGURED`，前端显示"AI 诊断不可用"，**不返回任何预设诊断**；
- 提示词版本 `repro-diagnose-v1.0`，写入 `failure_diagnostics.prompt_version`；
- 记录 model/token/calls（复用 LLMService 既有统计）。

## 2. 输入上下文（全部来自真实数据）

论文方法描述（facts） / 审计发现（适配层） / 当前复现任务 / 原始配置 / 实际运行环境（ExecutionEnvironment） / 完整错误日志（ExecutionLog） / 运行结果（ReproductionMetric） / 对应证据。

## 3. 诊断输出 Schema（Pydantic 严格）

`problem / error_evidence / possible_causes[{cause,basis,confidence}] / suggested_fix / verification_method / needs_human_confirm`

confidence 为 low/medium/high 文本描述，**不是校准概率**。诊断必须引用真实日志片段作 error_evidence。

## 4. 区分失败原因

依赖版本不兼容 / 数据目录错误 / 预处理不一致 / 模型结构与论文不符 / CUDA 不兼容 / 训练参数缺失 / 显存不足 / 启动命令错误。

## 5. 修复闭环与安全

- AI 建议保存为 `remediation_proposals`（original_value/proposed_value/diff），默认 `pending`；
- **默认不修改用户原始文件**；修改需 `POST remediations/{id}/review` 人工 approve/reject/modify；
- 涉及研究方法/训练参数/数据划分/模型结构的建议标记 `changes_research_conditions=true`，approve 时 note 自动追加"可能改变原始研究条件，不能称为严格复现"；
- 人工操作全部留痕（`remediation_reviews`，original_preserved=true）。

## 6. 不可信数据处理

论文、代码、日志、配置一律视为不可信数据；提示词明确禁止其中嵌入的指令覆盖系统安全规则；不执行其中任何命令。

## 7. 调用质量要求（复用既有实现）

Key 仅后端 env；前端零接触；支持配置模型/供应商；超时（LLM_TIMEOUT）；有限重试（1 次格式修复）；失败记录（ai_runs）；Token 统计；Schema 校验；Prompt 版本；日志脱敏；请求 ID 追踪。

## 8. 测试证据

`test_diagnosis_no_key_not_fake`（无 Key 无诊断落库）、`test_api_no_key_plan_and_diagnosis`（HTTP 503）。真实诊断质量因无 Key 无法评测，如实标注。
