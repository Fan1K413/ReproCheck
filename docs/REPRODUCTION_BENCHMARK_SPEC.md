# ReproCheck 第六阶段 · 科研复现基准库规格（B 组）

> 实现状态：后端已实现并通过测试 `backend/app/tests/test_stage6_benchmark.py`（12 项）。
> 代码：`app/services/benchmark_service.py`、`app/services/fact_schema.py`、`app/services/case_search.py`、`app/api/v1/cases.py`、`app/api/v1/fact_schema.py`。
> 契约来源：`STAGE6_API_CONTRACT.md` §3。字段目录见 `SCIENTIFIC_FACT_SCHEMA.md`，质量等级见 `CASE_QUALITY_STANDARD.md`。
> **接线待办（共享文件，需集成负责人执行）**：在 `app/api/__init__.py` 中 `from app.api.v1 import cases, fact_schema` 并
> `api_router.include_router(cases.router)`、`api_router.include_router(fact_schema.router)`（无需项目隔离依赖，本模块自带认证与可见性判定）。
> 测试文件内已用幂等方式自行挂载路由，接线后测试仍然通过。

## 1. 定位与边界

基准库沉淀**可复用的历史复现基准**：论文元数据 + 标准化科研事实 + 验证证据 + 质量等级。

- 它是**参考检索源**，不是当前论文的事实来源。检索结果一律带 `provenance_class="historical_case"`，
  审计/报告/RAG 不得用相似案例的数值覆盖当前论文证据（当前证据永远优先）。
- **只存元数据、事实与指针，不再分发本体**：不复制论文 PDF/附件、不镜像代码仓库、不转存数据集。
  `code_repo_url + code_commit`、`doi/source_url` 仅作定位指针；`traceability.redistribution` 恒为 `metadata_only`。
- 许可合规：案例保存 `license` 原文声明；缺失时在 `traceability.warnings` 给出提示，引用前需人工确认许可条款。

## 2. 数据模型（`app/models/stage6.py`，本模块不改表结构）

### BenchmarkCase（`benchmark_cases`）

| 字段 | 说明 |
|---|---|
| `id` | `case-` 前缀 uuid 串 |
| `title` | 必填，≤300 字符 |
| `doi` / `source_url` | 文献来源指针（≤200 / ≤500） |
| `domain` / `research_task` | 归一为 snake_case 小写键（`Computer Vision` → `computer_vision`） |
| `model_architecture` | 原样保留大小写（如 `ResNet-50`、`ViT-B/16`） |
| `dataset_name` | 经字段目录归一（`cifar_10` → `CIFAR-10`），未收录数据集保留原文 |
| `code_repo_url` / `code_commit` | 代码指针 + 提交号（版本可定位） |
| `license` | 许可声明原文 |
| `quality_level` | **系统字段**：`unverified` / `partially_verified` / `execution_verified` / `independently_reviewed` |
| `quality_evidence_json` | **系统字段**：等级判定证据（依据哪几条验证、环境、独立复核人、计数、提示） |
| `version` | 内容版本号，新增事实 +1（创建为 1） |
| `org_id` / `is_public` / `created_by` | 归属组织、是否公共、创建者 |
| `summary` | 摘要（参与检索） |
| `created_at` / `updated_at` | UTC ISO8601 |

### CaseFact（`case_facts`）

`id`(`cf-`)、`case_id`、`field_key`(标准键)、`raw_field`/`raw_value`(**原文永久保留**)、
`normalized_value`/`unit`(归一值)、`source_type`、`source_ref`、`context`、
`applicable_experiment`(适用实验，如 `baseline`/`ablation`)、`confidence`(0~1)、`created_at`。

`source_type ∈ {paper, code, config, log, dataset_card, manual, execution, review, other}`，默认 `manual`。

### CaseVerification（`case_verifications`）

`id`(`cv-`)、`case_id`、`verifier_user_id`、`verification_type ∈ {execution, review}`、
`conditions_json`(JSON 对象文本)、`result ∈ {pass, fail, partial}`、`notes`、`created_at`。
验证记录**只追加不覆盖**，失败记录同样保留并计入证据提示。

## 3. 端点（基础路径 `/api/v1`，信封 `{success,data,error,request_id}`）

| 方法 路径 | 权限 | 说明 |
|---|---|---|
| POST `/cases` | `case.manage`（researcher+，案例所属 org）；`is_public=true` 另需 `org.manage`（org_admin） | 创建即 `unverified`；**不接受 `quality_level`/`quality_evidence_json`/`created_by`/`id`** |
| GET `/cases` | 认证 | 筛选 `domain`/`research_task`/`dataset`/`quality_level`/`q`/`org_id`/`is_public`；`sort ∈ recent,updated,quality,title`；`limit`(1~100,默认20)/`offset` → `{items,total,limit,offset,sort}` |
| GET `/cases/{id}` | 可见 | 详情含 `fact_count`、`verifications[]`、`quality_evidence`、`traceability`、`quality_standard` |
| POST `/cases/{id}/facts` | 创建者或案例 org 内 `case.manage` | 字段名/值自动归一化；完全重复事实 → 409；字段名无法归一化或超列宽（`field_key`>80、`unit`>40、`source_ref`>300、`applicable_experiment`>200）→ 422，不静默截断 |
| GET `/cases/{id}/facts` | 可见 | 可按 `field_key`(支持别名)/`category` 过滤，按类别排序 |
| POST `/cases/{id}/verifications` | `finding.review` 或 `case.manage`（reviewer+；可带 `project_id` 走项目级判定） | 提交后**自动重算等级（只升不降）** |
| GET `/cases/{id}/verifications` | 可见 | 验证清单（含解析后的 `conditions`）；**契约外补充的只读端点**，供质量证据面板使用 |
| POST `/cases/{id}/quality/recompute` | `finding.review` 或 `case.manage` | 系统重算；body 可选 `{confirm_downgrade:bool}`，**不接受目标等级** |
| POST `/cases/search` | 认证 | `{query,filters,top_k}` → `{items:[{case,score,match_basis[],provenance_class,...}],total,disclaimer,...}` |
| GET `/fact-schema` | 认证 | 标准字段目录 + 类别 + 归一化规则说明 |

所有输入模型 `extra="forbid"`：多传字段（含任何试图注入 `quality_level` 的字段）→ 422 `VALIDATION_ERROR`。
服务层 `create_case` 另有同等守卫，直调（内部/AI 路径）同样拒绝。

### 创建案例请求示例

```json
{
  "title": "ResNet-50 在 CIFAR-10 上的训练复现基准",
  "doi": "10.48550/arXiv.1512.03385",
  "source_url": "https://arxiv.org/abs/1512.03385",
  "domain": "computer_vision",
  "research_task": "image_classification",
  "model_architecture": "ResNet-50",
  "dataset_name": "cifar-10",
  "code_repo_url": "https://github.com/example/resnet-cifar",
  "code_commit": "a1b2c3d4e5f6",
  "license": "MIT",
  "summary": "learning rate 0.1，batch size 128，SGD + cosine 衰减",
  "is_public": false
}
```

### 事实请求示例（别名与百分数自动归一）

```json
{"raw_field": "lr", "raw_value": "1e-3", "source_type": "config",
 "source_ref": "configs/cifar.yaml#L12", "applicable_experiment": "baseline", "confidence": 0.95}
```
→ `field_key=learning_rate`、`normalized_value="0.001"`、`raw_field/raw_value` 原样保留。

## 4. 可见性与隔离（后端强制）

可见 = `is_public=true` **或** `org_id ∈ 本人所属组织` **或** `created_by=本人`；平台管理员可见全部。

- 不可见的案例：详情/事实/验证/重算一律 **404**（隐藏存在性），与项目级隔离口径一致；列表与检索结果中**绝不出现**。
- 可见但无权限：写操作 **403**（如组织普通成员提交验证、外部用户改公共案例事实）。
- 不能把案例挂到非本人所属组织（404）；公共发布需 org_admin（403）。
- 检索与列表共用 `build_visible_stmt`，**不存在绕过可见性的检索路径**。

## 5. 检索（`case_search.py`，纯 Python，无向量数据库）

1. 结构化筛选为硬约束：`domain`/`research_task`/`dataset`/`quality_level`/`org_id`/`is_public`/`q`，
   另支持 `min_quality`（等级下限）与 `min_score`（分数阈值）。
2. 分词：ASCII 词（`resnet-50` 同时保留整体与子词）+ 中文二元组，去停用词。
3. 相似度：字段加权 TF（title 2.0 / research_task 1.6 / dataset_name 1.5 / model_architecture 1.4 / summary 1.0）
   × 平滑 IDF `log((1+N)/(1+df))+1`，余弦相似度。
4. 打分：`0.60×cosine + 0.18×research_task + 0.12×dataset + 0.05×domain + 0.05×model_architecture + 0.10×标题短语`，上限 1.0。
5. 排序：分数降序 → 质量等级降序 → 更新时间降序；`top_k` 默认 10（1~50）。
6. `query` 为空时返回按质量与更新时间排序的参考列表（分数 0）。

**每条结果必须解释命中原因**（`match_basis[]`，中文）：

```
"research_task 匹配: image_classification"
"dataset 相同: CIFAR-10"
"模型架构相似: ResNet-50"
"文本相似项: learning rate, batch size"
"标题包含查询短语: ResNet-50"
"筛选条件命中: dataset=CIFAR-100"
"质量等级: execution_verified（执行验证）"
```

响应附 `provenance_class="historical_case"`、`usage_note`、`disclaimer`、`algorithm`、`score_weights`，
便于前端与下游模块显式区分「历史参考」与「当前证据」。

## 6. 审计留痕（`audit_trail`）

| action | 触发 | before/after |
|---|---|---|
| `case.create` | 创建案例 | after: title/quality_level/is_public/domain/research_task/dataset_name |
| `case.fact_add` | 新增事实 | after: field_key/raw_value/normalized_value/unit/source_type/source_ref |
| `case.verification` | 提交验证 | after: verification_type/result/conditions/notes |
| `case.quality_change` | 验证引起的等级变更 | before/after: quality_level + 依据验证 id 列表 |
| `case.quality_recompute` | 显式重算引起的等级变更 | 同上 |

每条含 `actor_user_id`、`org_id`、`target_type/target_id`、`request_id`。等级变更保留旧值，不覆盖历史判断。

## 7. 测试覆盖（12 项，全部通过）

创建+列表+筛选+排序+分页；事实归一化（`lr`→`learning_rate`、`1e-3`→`0.001`、千分位、百分数、中文别名、未收录字段）
及入库守卫（纯标点字段名、超列宽 `field_key`/`unit`/`source_ref`/`applicable_experiment` 一律 422）；
字段目录接口；可见性隔离（404/403/公共可见/跨组织挂载）；四级质量阶梯（含独立复核人）；
无环境执行验证只到部分验证；客户端与 AI 均不能设等级（API 422 + 服务层守卫）；
降级需人工确认；验证入参校验与权限；检索 match_basis 与可见性、硬筛选、min_quality/min_score/top_k；
留痕/重复事实 409/来源追溯告警；`evaluate_quality` 与 `normalize_value` 纯函数确定性单测。

运行：`cd backend && ./.venv/Scripts/python.exe -m pytest app/tests/test_stage6_benchmark.py -q`
全量回归：`./.venv/Scripts/python.exe -m pytest app/tests/ -q` → 105 passed（本模块 12 项，未破坏既有测试）。

## 8. 未实现 / 后续（诚实标注）

- **路由接线**：`app/api/__init__.py` 属共享文件，本模块未修改，需集成负责人挂载（见文首）。
- 案例/事实的**修改与删除端点**（PATCH/DELETE）未实现：当前只支持追加事实与追加验证；
  纠错通过新增事实（不同 `applicable_experiment`/`source_ref`）与新增验证表达，历史不被覆盖。
- 案例**版本历史 diff**（`version` 已递增，但无历史快照表/对比端点）未实现。
- **执行验证与第四阶段复现引擎的自动打通**未实现：`execution` 验证目前由人工提交 conditions 与 result，
  未自动读取 `reproduction_runs` 的沙箱执行结果与指标比对结论。
- 检索为**内存内扫描 + TF-IDF**，适用于千级案例；未实现向量索引、分页游标、跨语言语义检索与检索缓存。
- 事实**置信度加权聚合**（同一字段多来源冲突时的裁决）未实现；冲突裁决仍由第二层 `app/services/__init__.py` 比对逻辑负责。
- 公共案例的**许可自动核验**（ SPDX 校验、上游仓库 license 抓取）未实现，仅保存声明并给出缺失告警。
- 前端页面（基准库列表/详情/事实录入/质量证据面板/检索）属第八阶段前端任务，本模块只提供 API。