# 证据可追溯性设计（第二阶段）

## 1. 核心承诺

**点击事实 → 查看证据 → 打开原始材料 → 找到对应位置。**

与普通 AI 论文总结工具的根本差异：每条事实的证据原文来自后端保存的材料，不是模型生成的引用文本；每个引用都经过存在性与逐字匹配校验。

## 2. 数据结构（`evidence_items` 表）

| 字段 | 用途 |
|---|---|
| evidence_id | 证据唯一 ID |
| fact_id / project_id / material_id / chunk_id | 归属链：事实→项目→材料→文本块 |
| source_name | 原始文件名 |
| quote | 模型声称的引用（可能被拒） |
| original_text | **从 source_chunks 读取的真实原文** |
| source_locator | JSON 定位（页码/行号/字段路径按类型） |
| verification_status | verified / unverified / rejected |

## 3. 校验机制

1. **chunk_id 存在性**：模型引用的 chunk 必须属于本次材料，否则拒绝；
2. **quote 逐字匹配**：quote 必须在对应 chunk 原文中连续出现（忽略首尾空白），否则标 `unverified`，事实降为 `needs_review`；
3. **原文读取**：`original_text` 始终从后端 `source_chunks.original_text` 读取；
4. **无定位兜底**：定位信息缺失时前端显示"来源位置尚未确认"，不编造页码/行号。

测试覆盖：`test_extract_with_verified_evidence`（验证成功）、`test_reject_fabricated_chunk_id`（虚构 chunk 被拒）、`test_fake_quote_marked_unverified`（假引用标未验证）。

## 4. 前端展示

证据块按材料类型渲染定位徽标：
- PDF：`source_name` + 阅读器页码 + 印刷页码（有则显示）+ 章节 + bbox 存在时标注"有坐标"；
- 代码：`file_path` + `start_line—end_line` + 高亮代码原文；
- 配置：`field_path` + `original_key`；
- 无定位：显示"来源位置尚未确认"。

点击证据可跳转到 `/materials/{material_id}` 打开材料详情查看完整原文与所有块。

## 5. 删除时的一致性

删除材料时（`DELETE /materials/{id}`）：
- 返回 `cascaded: {chunks, facts, evidence}` 统计；
- `evidence_items` 显式清理，避免孤立记录；
- 物理文件删除失败只记日志，不影响 DB 一致性；
- 集成测试 `test_material_delete_cascades_and_no_orphans` 覆盖。

## 6. 已知限制

- PDF 坐标（bbox）已保存但不提供可视化框选（第二阶段仅展示"有坐标"标记与文本）；
- 印刷页码依赖页脚正则识别，失败时用阅读器页码并标注来源；
- 模型可能给出"语义正确但措辞不同"的 quote，会被判 unverified（保守策略，宁可标待复核也不接受不精确引用）。
