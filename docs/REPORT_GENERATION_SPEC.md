# 报告生成规范（REPORT_GENERATION_SPEC）

## 1. 14 章结构

1 项目基本信息 / 2 材料清单 / 3 复现目标与范围 / 4 反向复现规划 / 5 环境与依赖 / 6 代码安全检查 / 7 任务执行记录 / 8 实验结果 / 9 论文结果与复现结果对照 / 10 差异与失败原因 / 11 证据链与来源定位 / 12 修复建议 / 13 人工复核记录 / 14 最终结论与限制说明。

## 2. 数据来源与区分（每章标注 origin）

- **程序自动检测**：项目/材料/事实/环境/对照统计；
- **AI 分析**：规划（ai_available=true 时）、诊断（ai_available=true 时）；
- **实际执行结果**：运行记录（当前执行禁用，章节明确说明）；
- **用户人工判断**：修复审核；
- **无法验证**：范围声明中明示。

测试 `test_report_distinguishes_ai_program_execution_origins` 验证四种 origin 共存。

## 3. 证据可追溯

每章 `sources` 数组列出 `表名:ID`（如 `extracted_facts:fact-xxx`、`metric_comparisons:mcmp-xxx`），前端报告中心可点击查看；证据原文在 evidence_items，不复制模型生成文本。

## 4. 导出

- HTML：`GET /reports/{id}/html`，完整独立可阅读（内联 CSS，深蓝科研风格）；
- PDF：`GET /reports/{id}/pdf`，仅当 weasyprint 可用时生成；**不可用时返回 501 + PDF_UNAVAILABLE，不伪造 PDF**；
- 报告版本：version 字段，支持重复生成新版本。

## 5. 范围声明（每份报告必含）

`scope_note`：评分只表示平台定义的复现验证覆盖程度，不代表学术质量/论文真实性/研究结论正确性；第 14 章明确写出"当前环境无安全隔离执行后端，代码执行未启用"。

## 6. 一致性

报告内容全部由 DB 聚合生成；测试 `test_report_generation_14_chapters_with_sources` 断言 14 章、每章含 sources/origin、HTML 完整、范围声明存在。
