# 第六阶段剩余缺口攻坚计划

## 状态
进行中。基线 HEAD `ec46431`（165 passed）。前序计划见 `Plan/stage6_core_plan.md`。

## 需求→步骤映射（用户选定"继续攻剩余缺口"）
- G1 论文图表反向验证（PDF 表格/图注提取、绘图逻辑检索、结果文件检索、数值对比、人工校正）→ Wave E
- G2 独立验证引擎第2层静态分析 + 第4层数值重算 → Wave F
- G3 生产安全加固（不破坏测试基线）→ Wave G（主 Agent）
- G4 回归与文档更新 → Wave H

## 验收口径（冻结）
1. 图表验证：从 PDF 结构化提取表格数值与图注是真实解析（有测试断言具体数值）；能检索代码绘图逻辑与结果文件；缺数据时明确标记 `insufficient_data`，不声称已精确复核。
2. 验证引擎：静态分析层真实解析 Python AST 检测模型结构/关键调用；数值重算层从原始数值按公式重算，与论文值对比；每层输出标注 method/basis/executed/confidence。
3. 生产安全：提供显式 `strict_production` 校验函数与启动守卫，默认不破坏现有匿名测试；文档明确生产必须设置的值。
4. 回归：后端全量 ≥165 passed 无新增失败；前端 typecheck/build 通过。

## 环境边界（不伪造）
- 无 GPU/无真实论文 PDF 图像数据：图表"重绘像素对比"与"真实实验执行"标 BLOCKED，不实现、不冒充。
- 只做可确定性验证的部分（文本层表格数值、图注、代码 plot 调用、CSV/JSON 数值重算）。

## Wave E — 图表反向验证（agent: impl-chart）
新文件：`services/chart_verification_service.py`、`api/v1/chart_verification.py`、`tests/test_chart_verification.py`；复用 `parsers/pdf_parser.py`/`python_parser.py`/`reproduction/results.py`，不改这些文件。

## Wave F — 验证引擎分层（agent: impl-engine）
新文件：`services/static_analysis_service.py`、`services/numeric_recompute_service.py`、`api/v1/verification_layers.py`、`tests/test_verification_layers.py`。

## Wave G — 生产安全加固（主 Agent）
`core/config.py` 新增 `strict_production_check()` 纯函数（不默认启用），返回缺失/不安全配置项清单；文档更新。

## Wave H — 回归与文档
全量测试、build、更新 STAGE6 文档、独立验收补充。

## 回滚
检查点 tag `stage6-core-complete`（HEAD `db47864`）。任一 Wave 3 轮内修不好即回退该 Wave。

## 不卡死计数
E/F/G/H 各 0，上限 3。
