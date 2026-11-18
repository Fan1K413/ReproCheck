# 第四阶段开发计划（STAGE4_DEVELOPMENT_PLAN）

## 目标与边界

把 ReproCheck 从"科研材料审计工具"升级为"科研复现验证平台"，但不以牺牲安全/真实性换演示效果。

## 外部阻塞下的交付形态（先说清楚）

| 阻塞 | 本阶段实际交付 |
|---|---|
| 无真实 API Key | AI 规划/诊断接口真实实现并复用 LLMService，无 Key 明确报错；用协议级 mock 验证 Schema/校验/成本记录逻辑；不伪造规划/诊断结果 |
| 无容器运行时 | 安全预检、环境检测、静态分析、受控执行接口真实实现；**默认禁用真实代码执行**，明确标注当前环境不支持；不假装运行成功 |

## 分阶段实施（Wave）

### Wave 1：基座（主工程师）
- 12 张新表 + 幂等迁移（Inspector 模式，保留前序数据）
- 新增错误码、配置项（`ENABLE_CODE_EXECUTION` 默认 false、执行策略）
- `Stage3AuditAdapter`（明确数据来源，不伪造第三阶段）

### Wave 2：规划引擎（主工程师 + 子代理并行）
- **主**：`ReproductionPlanner`（调用 LLMService 真实接口 + Pydantic Schema + Prompt 版本）、`FeasibilityChecker`（确定性可行性判定）、DAG 拓扑排序/环检测/阻断传播
- **子代理 frontend-workbench**：7 个前端工作台页面（总览/规划DAG/环境/控制台/结果比较/AI诊断/报告中心），真实数据驱动

### Wave 3：执行与安全（主工程师）
- `SecurityPreflight`（文件类型/路径穿越/可疑脚本/网络调用/高风险命令静态扫描，程序规则决策阻断）
- `EnvDetector`（requirements/pyproject/environment.yml/Dockerfile 等环境识别）
- `ExecutionSandbox`（沙箱接口 + 安全检查 + 默认禁用执行；非 root/资源限制/无网络/生命周期/清理的设计与清单）

### Wave 4：结果与诊断（主工程师）
- `ResultExtractor`（日志/CSV/JSON/TensorBoard 指标提取，无法提取标 needs_manual_review）
- `MetricComparator`（exact/绝对/相对/容差/多次统计，比较条件不一致标 not_comparable）
- `QualityEvaluator`（7 维度，公开公式与权重，明确不是学术质量判定）
- `FailureDiagnoser`（复用 LLMService，无 Key 明确不可用）

### Wave 5：报告与联调（子代理 + 主）
- **子代理 report-dev**：`ReportGenerator` HTML/PDF 导出 + 报告中心前端（可独立阅读，结论可追溯）
- **主**：API 集成、测试集、端到端测试、文档

### Wave 6：验证与交付（主工程师）
- 20 个场景测试（含安全边界、长任务恢复、PDF 一致性、证据定位）
- 真实跑全部测试，不通过项如实记录
- 10 份交付文档

## 质量门禁（每 Wave 结束）
- 后端 pytest 全绿（含前序 52 回归）
- 前端 tsc + build 通过
- 无密钥泄漏、无伪造数据
- 每份文档数字来自真实运行结果

## 明确禁止
- 不执行用户上传代码（除非有安全隔离且用户授权，当前无）
- 不自动安装用户依赖
- 不伪造 AI 规划/诊断（无 Key 明确标注）
- 不用静态数字冒充执行进度
- 不改前序模块签名（追加而非重构）
- 不把材料缺失说成研究造假
