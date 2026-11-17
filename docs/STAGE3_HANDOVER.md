# 第三阶段交接说明（STAGE3_HANDOVER）

## 1. 第三阶段目标

在**当前事实库**上开展跨材料一致性审计（论文 vs 代码 vs 配置 vs README 的参数冲突、缺失、不一致），无需推倒重来。

## 2. 可直接复用的资产

### 数据层（已完成，勿重建）
- `extracted_facts`：统一事实表，含 fact_type/field_key/raw_value/normalized_value/assertion_type/extraction_status/parser_source；
- `evidence_items`：证据库，含 original_text（后端原文）+ quote + source_locator + verification_status；
- `source_chunks`：统一文本块，含 content_hash/parser_version/source_locator_json；
- `ai_runs` / `parse_tasks` / `material_parse_runs`：完整调用与任务元数据；
- 幂等迁移 `app/db/migrate.py`：新增表/列时继续用 Inspector 模式扩展。

### 服务层（已完成）
- `services/__init__.py`：第一阶段的 `build_comparisons()` / `values_equal()` / 字段别名标准化——**直接用于跨材料程序化比对**；
- `services/extraction_service.py`：事实抽取与证据校验链，可复用于任何新材料类型；
- `services/task_service.py`：任务状态机、幂等、取消标记、缓存复用；
- `llm/LLMService`：统一模型调用（超时/重试/校验/修复/统计）；
- `llm/prompts/`：按类型分模板与版本号，第三阶段可加 `cross_material_review.py`。

### API 层
- v1 既有 6 接口 + v2 新增 13 接口，统一信封与错误码；
- 第三阶段建议新增：`POST /api/v1/audits`（基于事实库的跨材料审计）、`GET /api/v1/audits/{id}`、`GET /api/v1/audits/{id}/findings`。

### 前端
- `DataTable` / `StatusBadge` / 状态组件 / `api.ts` 封装；
- `FactsPage`（事实分类展示 + 证据 + 人工修订）、`OverviewPage`（真实聚合）、`MaterialsPage`/`ParseTasksPage`；
- 第三阶段审计结果页可直接复用事实卡的证据定位渲染（PDF 页码/代码行号/配置路径）。

## 3. 第三阶段建议实施顺序

1. **事实归一**：跨材料同语义字段匹配（复用 `normalize_field_key`，扩展到 field_label 与领域同义词）；
2. **程序化比对**：对 normalized_value 做数值/字符串/单位/缺失比较（复用 `build_comparisons` 的思路，扩展到 N 个材料与多事实类型）；
3. **AI 风险解释**：把已验证差异 + 真实证据提交模型（复用 `RiskExplanations` 模式）；
4. **审计结果落库**：新建 `audits` / `audit_findings_v2` / `audit_evidence_v2`，关联 fact_id 与 evidence_id，**不复制原文**（引用 evidence_items）；
5. **前端审计页**：复用现有事实/证据组件，展示跨材料冲突矩阵与定位跳转；
6. **测试**：基于现有合成材料（同一组材料的论文/代码/配置版本）构造已知冲突的基准答案。

## 4. 注意事项与坑

- **事实来源区分**：审计只应对 `parser_source in (model, program, human)` 的事实做比对，人工修订（human）的值应优先采用；
- **assertion_type**：inferred/ambiguous 事实参与比对时须降低置信权重或标注"推断，需人工核实"；
- **证据链**：审计结论的证据必须引用现有 `evidence_items.evidence_id`，不得重新生成引用文本；
- **成本控制**：跨材料审计调用模型须设上限（建议复用 `MAX_LLM_CALLS_PER_TASK` 与哈希缓存）；
- **未验证项**：真实模型调用仍待配置密钥；第三阶段开始前应先补测真实抽取，否则指标不可信；
- **同步任务**：如需真正的后台异步审计，须引入后台任务队列（当前为同步执行 + 状态落库，不假装分布式调度）。

## 5. 当前阻塞项

1. 真实 API Key 未配置——所有真实模型调用与 P/R/F1 指标无法验证；
2. PyMuPDF 版本锁定需校准；
3. 无 Git 仓库——建议第三阶段开始前初始化版本控制以便回滚。
