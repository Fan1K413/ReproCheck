# 结果对照规范（RESULT_COMPARISON_SPEC）

## 1. 结果提取

`ResultExtractor` 从日志文本、JSON、CSV 提取指标（accuracy/acc/f1/precision/recall/auc/loss/bleu/rouge/rmse/mae），每项记录：metric_name / metric_value / unit / source / extraction_method / 对应 run / 时间戳 / confidence / needs_manual_review。

- 无法可靠提取 → `needs_manual_review=true`，不自行推测；
- 不把模型权重、二进制文件送模型；不送完整数据集。

## 2. 论文结果对照（6 种判定）

`MetricComparator.compare()` 按优先级：

| 判定 | 条件 |
|---|---|
| `not_comparable` | same_dataset / same_split / same_metric / same_preprocessing 任一为 false（**优先于数值**） |
| `insufficient_data` | 论文值或复现值缺失 |
| `exact_match` | 两值完全相等 |
| `within_tolerance` | 绝对误差 ≤ 容差 |
| `significant_deviation` | 绝对误差 > 容差 |

另有 `needs_manual_review` 供人工标记。

## 3. 容差来源（不由 AI 随意决定）

优先级：论文明确标准 → 用户配置验收标准 → 平台默认（accuracy/f1/precision/recall/auc 0.02，loss/rmse/mae 0.05，bleu 1.0），默认容差在 `tolerance_basis` 中明确写"平台默认容差（非论文标准，需人工确认适用性）"。支持相对误差 `diff_relative`，多次运行统计与均值/置信区间为扩展点（当前单次运行，无统计依据不输出置信区间）。

## 4. 条件一致性检查

`conditions_check`：same_dataset / same_split / same_metric / same_preprocessing / same_hyperparams / same_seed / environment_diff，随对照结果落库并前端可展开。

## 5. 差异 ≠ 失败

结果有差异可能因随机性、硬件、非确定性计算。平台**不**把差异简单判为复现失败，而是给出 verdict + 条件检查 + 理由，人工判断留给 `needs_manual_review`。

## 6. 复现质量评估（七维度）

材料完整性 / 环境一致性 / 参数一致性 / 代码可执行性 / 运行成功情况 / 结果可比性 / 证据完整性，各 0-1 分 + 权重（和=1.0）+ 计算依据 + 缺失项。

- 公式公开：`overall = Σ (score × weight)`；
- `code_executability` 当前因执行禁用只计 0.3（静态分析覆盖）；
- **明确声明**：评分只表示平台定义的复现验证覆盖程度，不代表学术质量、论文真实性或研究结论正确性（`scope_note` 写入报告与前端）。

## 7. 测试证据

`test_metric_comparator_verdicts`（6 种判定）、`test_metric_extractor_regex_and_json`、`test_quality_scope_note`、`test_api_quality_from_real_db`（空项目 overall<0.3，真实聚合）。
