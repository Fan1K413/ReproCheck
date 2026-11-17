# LLM 抽取设计（第二阶段）

## 1. 复用第一阶段适配层

直接复用 `app/llm/LLMService.chat()`，不重写网络/重试/校验逻辑。第二阶段只增加：
- 按材料类型分任务模板；
- 更严格的事实 Schema（`FactsExtractionV2`）；
- 事实级的 chunk_id / quote 校验。

**禁止**：前端直连模型、写死模型输出、API 失败时用预制结果冒充 AI 分析。

## 2. 按材料类型的提示词模板（`app/llm/prompts/`）

| 模板 | 版本 | 适用材料 |
|---|---|---|
| paper_extraction | paper-v1.0 | pdf |
| code_extraction | code-v1.0 | python / notebook / zip |
| config_extraction | config-v1.0 | yaml / json / toml / csv / xlsx |
| readme_extraction | readme-v1.0 | readme / text |
| environment_extraction | environment-v1.0 | requirements |
| fact_normalization | normalize-v1.0 | （预留标准化任务） |

每个模板内置版本号（登记在 `PROMPT_VERSIONS`），写入 `ai_runs.prompt_version` 与 `parse_tasks.prompt_version`，便于复现实验与追踪模型行为。

## 3. 各类任务重点

- **论文**：研究信息/数据集/模型/训练参数/评价指标，找不到返回 not_found；
- **代码**：结合 AST 静态结果识别训练入口、优化器、参数、随机种子、评价指标、配置读取、模型保存；不要求模型猜测未提供的代码；
- **配置**：语义归一（lr/learning_rate → learning_rate）但保留原始路径与键名；requirements 版本保留原始约束，禁止推断精确版本；
- **README**：安装/环境/数据/训练/测试/推理命令——**只保存原文，禁止执行或验证**；
- **环境**：Python/PyTorch/TensorFlow/CUDA 版本与依赖范围，未明确则 not_found。

## 4. 严格结构化与有限修复

- `FactsExtractionV2` 设 `extra="forbid"`；
- JSON 不合法或字段不符 → LLM 适配层自动发一次修复请求（回传校验错误）；
- 修复后仍不合法 → 抛 `LLM_INVALID_FORMAT`，**不填充虚构字段**。

## 5. 模型返回后的校验（详见 FACT_SCHEMA.md）

JSON→类型→枚举→chunk_id 存在→material 归属→quote 逐字→完整性→去重→落库。

## 6. 成本控制

| 措施 | 实现 |
|---|---|
| 不送整份 PDF/ZIP | 只送解析后的有界 chunks |
| 输入上限 | 单次 ≤6000 字符，最多 60 块 |
| 任务调用上限 | `MAX_LLM_CALLS_PER_TASK = 3` |
| 事实数量上限 | 80 条/材料 |
| 输出 token 上限 | chat 调用设 max_tokens |
| 哈希缓存 | 同项目同 sha256 材料复用解析任务，不重复调用 |
| program 事实 | 确定性解析直接生成，不调用模型 |
| 有限重试 | 仅一次 JSON 修复请求，网络/鉴权/限流不重试 |
| 取消 | `cancel_requested` 标记，阶段边界检查 |
| 用量记录 | ai_runs / parse_tasks 记录 calls / prompt_tokens / completion_tokens / total_tokens |

## 7. 真实调用状态

**未成功调用任何真实模型。** 环境 `sk-` 密钥失效（详见 STAGE1 报告与 TEST_REPORT）。所有链路验证使用 `httpx.MockTransport` 在 OpenAI 兼容协议层模拟，证明的是**程序逻辑正确**。填入真实 `LLM_API_KEY` 后无需改代码即可真实调用。

`confidence` 仅作辅助参考，**不作为经统计校准的正确概率**，前端明确标注。
