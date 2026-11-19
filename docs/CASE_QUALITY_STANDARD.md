# ReproCheck 第六阶段 · 案例质量等级标准（B 组）

> 实现状态：已实现并通过测试（`test_stage6_benchmark.py`：四级阶梯、无环境执行验证、AI 不可设等级、降级确认、纯函数确定性）。
> 判定代码：`backend/app/services/benchmark_service.py::evaluate_quality`（纯函数）+ `_apply_quality`（落库/留痕）。
> 规则版本：`RULE_VERSION = "stage6-b1"`。机器可读阶梯：`GET /cases/{id}` 响应中的 `quality_standard`，或 `quality_standard_view()`。

## 1. 第一原则：等级是算出来的，不是填出来的

- **AI、客户端、前端都不能设置 `quality_level`**。
  - `POST /cases` 的输入模型 `extra="forbid"` 且不含该字段；提交 `quality_level`/`quality_evidence_json` → **422**。
  - `POST /cases/{id}/quality/recompute` 只接受 `{confirm_downgrade: bool}`；提交目标等级 → **422**。
  - `POST /cases/{id}/facts`、`/verifications` 同样拒绝任何等级注入字段 → **422**。
  - 服务层 `create_case` 对 dict 直调（内部/AI 路径）有同等守卫，抛 `AppError("VALIDATION_ERROR")`。
- 等级唯一来源是 `evaluate_quality(created_by, verifications)`：**只读验证记录，确定性计算**，
  同样输入（无论顺序）必得同样等级与同样证据依据。
- 大模型可以做的事：抽取事实、起草验证说明、解释证据差异；**不可以**做的事：宣布案例"已验证"。

## 2. 四级阶梯

| 等级 | 中文 | 判定条件（充分必要） |
|---|---|---|
| `unverified` | 未验证 | 无任何验证记录；或现有验证全部为 `fail`/`partial`（无任何 pass） |
| `partially_verified` | 部分验证 | 存在 `review` + `pass`；**或**存在 `execution` + `pass` 但 conditions 未声明运行环境 |
| `execution_verified` | 执行验证 | 存在 `execution` + `pass` 且 conditions 声明了运行环境 |
| `independently_reviewed` | 独立复核 | 满足 `execution_verified`，**且另有**一条 `review` + `pass`，其复核人 ≠ 该执行验证的执行人，且 ≠ 案例创建者 |

补充规则（同样确定性）：

1. **只有 `pass` 升级**：`fail`/`partial` 不提升等级，但计入 `counts` 并在 `notes` 中给出引用警示。
2. **环境声明判定**：conditions 中任一环境键非空即成立（见 §3），支持嵌套 `environment`/`env` 对象。
   仅写指标（如 `{"accuracy":0.95}`）不算环境声明 → 只到 `partially_verified`。
3. **独立性判定**：按 `verifier_user_id` 比较；复核人为空（匿名/系统）不算独立；
   创建者自审、执行人自审都不算独立，此类 review pass 进入 `supporting` 并注明原因。
4. **多条执行验证**：取时间最新的合格执行验证作为环境证据，其余进入 `supporting`。
5. **验证只追加不覆盖**：新增 fail 不会自动降级（历史结论保留），降级只能通过显式重算 + 人工确认（§5）。

## 3. 运行环境键（`ENVIRONMENT_KEYS`，28 个）

```
code_commit, commit, commit_sha, container_image, cpu, cuda_version, cudnn_version,
dependencies, docker_image, driver_version, env, environment, framework, gpu, gpu_count,
gpu_model, hardware, library_versions, memory, mixed_precision, num_gpus, operating_system,
os, precision, python_version, pytorch_version, ram, torch_version
```

- 键名大小写不敏感；值为空串/空对象/空数组/null 视为未声明。
- `environment`/`env` 为对象时展平进入证据 `environment`；为非空字符串时视为已声明。
- 与 `SCIENTIFIC_FACT_SCHEMA.md` 的 `environment` 类字段同源，便于「事实 → 验证条件」直接映射。

合格示例：

```json
{"gpu": "NVIDIA GeForce RTX 3090", "python_version": "3.10.12",
 "pytorch_version": "2.1.0+cu118", "cuda_version": "11.8", "operating_system": "Ubuntu 20.04"}
```
```json
{"environment": {"gpu": "A100", "cuda_version": "12.1"}, "code_commit": "a1b2c3d"}
```

不合格示例：`{}`、`{"accuracy": 0.95}`、`{"gpu": ""}`、`{"notes": "跑通了"}`。

## 4. 证据结构 `quality_evidence_json`

```json
{
  "level": "independently_reviewed",
  "computed_level": "independently_reviewed",
  "previous_level": "execution_verified",
  "rule_version": "stage6-b1",
  "computed_at": "2026-01-04T00:00:00+00:00",
  "downgrade_blocked": false,
  "confirm_downgrade": false,
  "basis": [
    {"verification_id": "cv-…", "verification_type": "execution", "result": "pass",
     "verifier_user_id": "user-…", "created_at": "…", "reason": "执行复现通过，且 conditions 声明了运行环境"},
    {"verification_id": "cv-…", "verification_type": "review", "result": "pass",
     "verifier_user_id": "user-…", "created_at": "…", "reason": "独立人工复核通过（复核人 ≠ 执行人且 ≠ 案例创建者）"}
  ],
  "supporting": [{"verification_id": "cv-…", "reason": "人工复核通过，但复核人与执行人/创建者相同，不构成独立复核"}],
  "environment": {"gpu": "NVIDIA GeForce RTX 3090", "cuda_version": "11.8"},
  "independent_reviewer_user_id": "user-…",
  "counts": {"total": 5, "execution_pass": 2, "execution_pass_with_environment": 1,
             "review_pass": 2, "fail": 1, "partial": 0},
  "notes": ["存在 1 条 fail 验证，引用该案例前须阅读失败原因。"]
}
```

- `basis` = **支撑当前等级的验证清单**（可追溯到具体 `cv-` 记录与复核人）。
- `supporting` = 相关但不构成升级依据的记录（自审、历史执行）。
- `notes` = 为什么没到更高等级 / 引用风险提示（中文，可直接展示给用户）。
- `level` 为**实际生效等级**，`computed_level` 为**本次计算等级**；两者不同即说明降级被拦截。

## 5. 重算语义（只升不降 + 人工确认降级）

| 场景 | 行为 |
|---|---|
| 提交验证 `POST /cases/{id}/verifications` | 自动重算，**只升不降**；变更写 `case.quality_change` 留痕 |
| 显式重算 `POST /cases/{id}/quality/recompute`（无 body 或 `{}`） | 计算等级 > 当前 → 升级；计算等级 < 当前 → **保持当前**，返回 `downgrade_blocked=true`、`changed=false`，并在 notes 说明 |
| 显式重算 `{"confirm_downgrade": true}` | 允许降级到计算等级，写 `case.quality_recompute` 留痕（before/after 均保留） |
| 计算等级 == 当前 | 幂等：`changed=false`，仍刷新证据与 `computed_at` |

权限：重算与提交验证均需 `finding.review` 或 `case.manage`（reviewer 及以上；可传 `project_id` 走项目级判定）；
不可见案例一律 404。降级确认目前为**单人布尔确认**，不是二人审批流（见 §8）。

## 6. 标准 progression（测试实测路径）

```
创建案例                                  -> unverified
A 提交 review/pass（材料审阅）            -> partially_verified
A 提交 execution/pass + 环境 conditions   -> execution_verified
A 再提交 review/pass（自审）              -> execution_verified（notes: 尚无独立人工复核）
B（≠A，且 ≠ 创建者）提交 review/pass      -> independently_reviewed
B 提交 execution/fail                     -> independently_reviewed（fail 不自动降级，notes 给出警示）
删除该独立复核记录后重算                  -> 保持 independently_reviewed，downgrade_blocked=true
重算 + confirm_downgrade=true             -> execution_verified
```

## 7. 留痕与可追溯

| action | 说明 |
|---|---|
| `case.verification` | 每次提交验证（含 fail/partial），after 保存 type/result/conditions/notes |
| `case.quality_change` | 验证引起的等级变更，before/after 保存等级 + 依据验证 id 列表 |
| `case.quality_recompute` | 显式重算引起的等级变更（含确认降级） |

均含 `actor_user_id`、`org_id`、`target_type/target_id`、`request_id`；旧等级不被覆盖，可回溯"谁在何时依据哪条验证把案例升到某级"。

## 8. 未实现 / 限制（诚实标注）

- **执行验证未与第四阶段复现引擎自动打通**：`execution` 验证的 conditions/result 目前由人工提交，
  未自动消费沙箱执行日志、指标比对结论与 `reproduction_runs` 结果；因此"执行通过"仍是人工断言 + 证据文本。
- **验证撤销/作废端点未实现**：测试中的降级场景通过直接删除记录模拟；生产需要 `DELETE /verifications/{id}`
  或"作废标记 + 重算"流程（当前只能追加新验证或人工确认降级）。
- **独立复核人身份强校验未实现**：仅按 `verifier_user_id` 不同判定独立性，
  未校验复核人是否属于外部组织、是否存在利益冲突声明、是否具备 reviewer 角色以外的资质。
- **等级有效期与重验策略未实现**：无 `verified_at` 过期、依赖版本升级后自动降级/提醒重验。
- **降级审批流未实现**：`confirm_downgrade` 为单人确认，无二人复核、无审批记录表。
- **部分验证的细化未实现**：`partial` 结果不区分"部分指标复现"与"部分实验复现"，统一不升级。
- 前端质量证据面板（阶梯可视化、依据跳转、降级确认弹窗）属第八阶段前端任务，本模块只提供 API 与证据 JSON。