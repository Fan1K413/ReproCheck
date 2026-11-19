# 受控 RAG 知识架构规范（RAG_KNOWLEDGE_ARCHITECTURE）

> 阶段六 · C 组。对应实现：`app/services/rag_service.py`、`app/api/v1/rag.py`；
> 数据表 `knowledge_documents`（见 `app/models/stage6.py`）。测试：`app/tests/test_stage6_rules.py`。

## 1. 设计目标

为审计提供**可溯源、受控**的知识检索：检索完全确定性、每条命中都带来源与来源分级，
当前论文证据永远优先，历史案例与外部知识不得覆盖当前事实，模型合成内容必须显式标注。

## 2. 来源分级（provenance_class）

四分类，**每条命中与每个文档都带标签**：

| provenance_class | 含义 | 来源 |
|---|---|---|
| `current_evidence` | 当前论文/材料原始证据，**最高优先** | 被审计对象本身，**不入知识库** |
| `historical_case` | 历史基准案例/标准化事实/失败诊断 | KB：`verified_case`/`normalized_fact`/`failure_diagnosis` |
| `external_knowledge` | 审计规则/复现方法/环境配置等外部知识 | KB：`audit_rule`/`repro_method`/`env_config` |
| `model_inference` | 大模型合成内容，**不得冒充证据** | 可选合成输出 |

`source_type → provenance_class` 映射（`PROVENANCE_MAP`）：
`verified_case/normalized_fact/failure_diagnosis → historical_case`；
`audit_rule/repro_method/env_config → external_knowledge`。

**关键不变量**：知识库内容永远不是 `current_evidence`。检索命中只可能是
`historical_case` 或 `external_knowledge`；`model_inference` 仅出现在可选合成结果上。

## 3. 确定性检索（纯 Python，无向量库、无 LLM）

- 分词 `tokenize()`：英文/数字词（`[a-z0-9]+`）+ 中文单字 + 中文二元组（bigram），
  无需外部分词依赖，确定性。
- 语料 = `title`（权重 ×2）+ `content`。TF-IDF：`idf = log((N+1)/(df+1)) + 1`（平滑），
  `tf` 为原始词频；查询与文档向量做**余弦相似度**。
- 命中按 `score` 降序、`id` 升序**稳定排序**，仅保留 `score>0`，截断 `top_k`（1–50）。
- 每条命中：`{document, score, source_ref, provenance_class}`，`document` 含
  `id/title/content/source_type/source_ref/org_id/is_public/provenance_class`。
- 同一查询多次调用结果完全一致（测试断言确定性）。

## 4. 当前证据优先

- 给定 `project_id` 时：先 `resolve_project_access` 校验项目访问，再在响应
  `provenance.current_evidence_priority` 强制返回提示：
  「当前论文原始证据（current_evidence）永远优先；历史案例与外部知识只能补充参考，
  不得覆盖或改写当前事实。」
- 可选合成的 system prompt 同样内置该约束，且要求只依据带来源标签的资料回答、末尾列来源编号。
- 响应始终返回 `provenance.classes` 四分类释义，供调用方/前端展示来源约束。

## 5. 可见性与权限

| 方法 路径 | 权限 | 说明 |
|---|---|---|
| `POST /rag/documents` | `rule.manage`（org）或 `case.manage`（project）任一 | `{source_type, source_ref?, title, content, is_public?}`；非法 `source_type` → 422；留痕 |
| `GET /rag/documents?source_type` | 认证 | 可见 = 公共 + 本 org + 本人创建；平台管理员见全部 |
| `POST /rag/query` | 认证（给定 `project_id` 时校验项目访问） | `{query, project_id?, top_k?, synthesize?}` |

- 文档归属 `org_id` 取自授权组织（`rule.manage`）或项目所属组织（`case.manage`）。
- 检索候选集按上述可见性过滤，杜绝跨 org 泄露。

## 6. 可选合成（优雅降级）

- `synthesize=True` 且 `settings.is_llm_configured` 且有命中时，才调用 `LLMService.chat`
  生成答案，标注 `provenance_class="model_inference"`，附 `sources[]`（编号 + source_ref +
  各来源 provenance_class + document_id）。
- 未配置 LLM / 调用失败（`AppError` 或任何异常）→ `synthesis=None`，**绝不阻断确定性检索**。
- 默认 `synthesize=False`：核心检索不依赖大模型。

## 7. 未实现 / 后续（诚实标注）

- **无向量数据库 / embeddings**：刻意采用纯 Python TF-IDF，便于审计与复现；语义召回增强为后续可选项。
- **无自动入库同步**：文档经 API 显式添加；从 `benchmark_cases`/`case_facts`/`audit_rules`
  自动同步生成知识文档是后续集成工作。
- **当前证据优先是「返回给调用方/合成 prompt 的约束 + 来源分级」**，而非检索时与实时论文证据的自动融合；
  真正的「当前证据 vs 历史知识」融合发生在审计引擎侧（本模块范围外）。KB 永不产出 `current_evidence`。
- **无重排序（rerank）/ cross-encoder**：仅 TF-IDF 余弦；标题 ×2 为唯一权重启发式。
- 中文检索基于字面 unigram/bigram，非同义词语义匹配；同义扩展为后续工作。