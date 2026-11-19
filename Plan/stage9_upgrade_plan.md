# 第九阶段 · 研究驱动重构规划

## 状态
进行中。基线 tag `stage9-baseline`（HEAD `33b6a5c`，工作区干净，205 passed）。

## 调研进度
| 组 | 任务 | 状态 | 产出 |
|---|---|---|---|
| A | GitHub 开源调研 | 完成 | docs/STAGE9_GITHUB_RESEARCH.md（23 项目，15 深度，真实 API 数据+来源链接） |
| B | 学术规范调研 | 进行中 | docs/STAGE9_ACADEMIC_STANDARDS_RESEARCH.md（待生成） |
| C | 竞品/定位 | 进行中 | docs/STAGE9_COMPETITOR_AND_POSITIONING.md（待生成） |
| D | 项目审计 | 完成 | docs/STAGE9_CURRENT_PRODUCT_AUDIT.md（5 个具体 P0/P1 问题+文件行号） |
| 主控 | 基线与前后端落差 | 完成 | docs/STAGE9_BASELINE_FACTS.md |

## 已确认的关键事实（不等 B/C 即可定）
1. 产品是"引擎很强但驾驶舱没接好"：后端 15 个新增端点，前端只接了 2 个（evidence-graph、diagnosis/classify）。
2. README 自称"第一阶段"，与第六阶段现实严重失同步。
3. 审计结论状态在 4+ 子系统割裂（conflict/consistent、supported/unsupported、verdict 五态、quality_level 四态），无统一五态模型。
4. A 组调研出的 5 个可借鉴机制：①事件化审计会话（Sacred/MLflow/Code Ocean）；②声明态 vs 冻结态双层证据+内容寻址（DVC/Git LFS）；③自包含审计证据包（Snakemake/Nextflow report）；④结构化 front matter 事实记录（HF Model Cards/OpenML）；⑤可复现性完备性评分卡（PWC releasing-research-code）。

## 候选升级方向（初稿，待 B/C 调研结论后评分排序）
- U1 可信结论五态统一模型（已验证/部分验证/证据不足/冲突/无法验证）+ 贯穿前后端（对应 D 问题四）
- U2 能力驾驶舱：把 6 项无入口后端能力接入项目工作区（对应 D 问题二）
- U3 README/新用户引导重写（对应 D 问题一/三）
- U4 审计事件会话：每个 run 挂证据事件、可回放（A 机制①）
- U5 声明态vs冻结态双层参数对照（A 机制②）
- U6 可复现性评分卡（A 机制⑤）
- U7 标准交接包 RO-Crate JSON-LD（待 B 组规范调研确认）
- U8 外部工具协同（MLflow/DVC 导入，待 C 组竞品结论确认）

## 本阶段落地上限
用户要求"选出不超过 3 项最有价值、证据最充分且与现有架构兼容的升级"。
**初步倾向**：U1（科研可信度核心）+ U2（让已有能力可达）+ U3（文档/引导低成本高收益），最终以 B/C 调研后的 8 维评分确定。

## 验收口径（冻结）
- 落地项必须有真实代码+测试，前端不是静态壳；
- 不破坏 205 passed 基线；
- 不执行第三方代码、不伪造论文结果；
- 每项升级有设计文档、迁移/回滚说明、独立验收。

## 工作区隔离
所有实现在 `stage9-baseline` 之后的独立提交中进行；临时脚本清理；不覆盖任何既有未提交改动（当前为 0）。
