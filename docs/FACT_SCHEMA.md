# 科研事实 Schema（第二阶段）

## 1. 模型返回结构（Pydantic 严格校验，`app/schemas/parsing.py`）

```json
{
  "facts": [
    {
      "fact_type": "training_parameter",
      "field_key": "learning_rate",
      "field_label": "学习率",
      "raw_value": "0.001",
      "normalized_value": 0.001,
      "unit": null,
      "assertion_type": "explicit",
      "evidence_refs": [
        { "chunk_id": "pdf_mat_x_p005_b02", "quote": "the initial learning rate was set to 0.001" }
      ],
      "confidence": 0.95
    }
  ]
}
```

`FactsExtractionV2` 设置 `extra="forbid"`——模型多返回字段会校验失败，触发一次有限修复请求，仍失败则报 `LLM_INVALID_FORMAT`。

## 2. 枚举值域

| 字段 | 取值 |
|---|---|
| `fact_type` | research_info / dataset / model / training_parameter / metric / environment / runtime / experiment_process / other |
| `assertion_type` | explicit（原文明确） / inferred（上下文推断） / ambiguous（歧义） / not_found（未找到） |
| `extraction_status` | supported（有验证证据） / unsupported（无证据/not_found） / needs_review（引用存在但 quote 未通过校验） |
| `parser_source` | model（AI 抽取） / program（确定性解析） / human（人工修订） |

## 3. 数据库落库（extracted_facts 扩展表）

第一阶段列全部保留：`run_id / project_id / material_id / chunk_id / field_key / raw_value / normalized_value / unit / confidence`

第二阶段追加列：
`fact_id / fact_type / field_label / assertion_type / extraction_status / parser_source / extraction_run_id / quote / source_locator_json / source_name / revision_count / ai_original_json / created_at`

- 第一阶段旧记录新列取默认值（`assertion_type=explicit`、`parser_source=model`），不丢失；
- `ai_original_json` 保存 AI 原始输出快照，人工修订后仍可追溯。

## 4. 校验链路（9 步）

模型返回后依次执行：
1. JSON 格式校验（LLM 适配层）
2. 字段类型校验（Pydantic）
3. 枚举值校验（Pydantic Literal）
4. `chunk_id` 存在性校验（不在本次材料中 → 拒绝该引用）
5. `material_id` 归属校验
6. 原文引用校验（quote 必须在 chunk 原文中逐字出现）
7. 必要字段完整性校验
8. 重复事实处理（field_key+值去重，上限 80 条/材料）
9. 数据库保存校验（异常明确抛出，不包装成功）

## 5. explicit vs inferred vs not_found 的判定

| 情形 | assertion_type | extraction_status |
|---|---|---|
| 原文明确写出 + quote 验证通过 | explicit | supported |
| 上下文可推断，原文未直接写 | inferred | needs_review（除非有有效 quote） |
| 存在歧义 | ambiguous | needs_review |
| 当前材料未找到 | not_found | unsupported |
| 模型给了 chunk_id 但 quote 不匹配 | 任意 | needs_review（证据 unverified） |
| 模型引用不存在的 chunk_id | 任意 | 拒绝该引用，保留事实但无证据 |

**只有得到有效原文支持的事实才能标 supported。confidence 仅为辅助信息，不是经统计校准的正确概率**（前端明确标注）。

## 6. 人工修订与留痕

`PATCH /facts/{id}` 记录到 `fact_revisions`：
- 保存修订前/后值、`revision_source=human`、备注、时间；
- 事实的 `parser_source` 变为 `human`，不再冒充 AI 原始输出；
- AI 原始值保存在 `ai_original_json`，`GET /facts/{id}/revisions` 可查看完整轨迹。

## 7. Program 来源事实

配置文件/代码的确定性解析结果（如 `lr: 0.001`、AST 识别的 `batch_size=64`）由 `add_program_facts()` 直接生成 `parser_source="program"` 的事实——**不调用模型、不重复计费**，并作为 AI 抽取的补充。
