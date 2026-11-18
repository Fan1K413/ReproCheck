# ReproCheck 第四阶段合成测试样例

本目录所有文件均为**合成测试材料**，不来自任何真实论文或真实仓库，仅用于验证解析、规划、安全预检、结果对照与报告链路。禁止将其描述为真实科研成果。

## 样例清单

| 文件 | 用途 |
|---|---|
| repro_config.yaml | 一份合成训练配置（lr/batch_size/epochs/seed/dataset） |
| repro_train.py | 合成训练脚本（含 argparse 与安全的参数定义，用于 AST 静态解析测试） |
| malicious_snippet.txt | 合成恶意片段（os.system/云元数据访问），用于安全预检阻断测试 |
| training_log.txt | 合成训练日志（含 accuracy/f1），用于指标提取测试 |
| results.json | 合成结果 JSON，用于 JSON 指标提取测试 |

## 覆盖的测试场景（对应任务书第九部分）

1. 材料完整、环境正确、代码可运行 —— 本环境无安全执行后端，改为静态检查路径验证（如实标注）
2. 缺少数据集 → `test_feasibility_missing_material_not_blame_researcher`
3. 缺少依赖文件 → EnvDetector 的 missing 检测
4. 依赖版本冲突 → 诊断接口（无 Key 明确不可用，不伪造）
5. 启动命令错误 → 诊断接口（同上）
6. 运行超时 → 配置项 + 执行禁用（无真实运行）
7. GPU 不可用 → EnvDetector hardware 检测（静态）
8. 运行成功但结果不一致 → `test_metric_comparator_verdicts`（significant_deviation）
9. 参数变化可追溯 → 第二阶段 fact revisions + 本报告参数对照
10. 多次运行结果不同 → 统计扩展点（当前单次，无统计依据不输出置信区间）
11. AI 调用失败不伪造 → `test_api_no_key_plan_and_diagnosis`
12. AI 输出格式错误 → `test_planner_rejects_cycle_from_ai` + LLM 适配层 JSON 修复测试
13. 用户取消 → `ExecutionSandbox.cancel`（同步执行禁用，明确 note）
14. 恶意压缩包不逃逸 → 第二阶段 `test_parsers` + 本阶段 SecurityPreflight
15. 恶意脚本不访问宿主机 → `test_security_preflight_detects_dangerous_script`
16. 网络访问限制 → 同上（云元数据/内网地址检测）
17. 项目数据隔离 → FailureDiagnoser 校验 project_id（FORBIDDEN）
18. 刷新恢复状态 → DB 持久化 + GET 状态接口（前端轮询真实接口）
19. PDF 与实际记录一致 → 报告由 DB 聚合生成；PDF 不可用时 501（不伪造）
20. 证据定位 → 每章 sources 指向真实记录 ID

**未通过/未执行的场景**：场景 1/6 的真实执行部分因无安全隔离运行时未执行（如实标注）；场景 4/5 的真实 AI 诊断因无 API Key 未执行（接口与逻辑已测，结果未伪造）。
