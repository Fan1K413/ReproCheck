# 审计规则生命周期规范（AUDIT_RULE_LIFECYCLE）

> 阶段六 · C 组。对应实现：`app/services/rule_service.py`、`app/services/rule_eval.py`、
> `app/api/v1/rules.py`；数据表 `audit_rules` / `audit_rule_versions` / `rule_test_samples` /
> `rule_evaluations`（见 `app/models/stage6.py`）。测试：`app/tests/test_stage6_rules.py`。

## 1. 定位与边界

规则层是**管理 / 评估层**，与既有程序化比对引擎解耦：

- 生产比对仍由 `app/services/__init__.py`（`values_equal` / `build_comparisons`）与
  `app/services/audit_service.py` 执行，本模块**不改写**其行为。
- 规则层负责：规则的创建、启停、版本演进、离线测试、离线评估、回滚，全部留痕。
- 评估器**复用**既有引擎的字段别名（`normalize_field_key`）、数值字段集合
  （`NUMERIC_FIELDS`）、相对容差常量（`REL_TOL=1e-6`），保证语义一致。

### 最高治理红线

**AI 与用户反馈绝不能自动把判断写进生产规则。** 任何逻辑变更只能由具备
`rule.manage`（org 级）权限的人显式发起；新版本**必须附带 ≥1 条测试样本**，
先离线验证再考虑上生产。单条反馈不是绝对真理（见 FEEDBACK_GOVERNANCE_SPEC）。

## 2. 权限模型

- 规则表是**平台全局**的（`audit_rules` 无 `org_id` 列，`rule_key` 全局唯一）。
- 「谁能管理」由 org 级 `rule.manage` 把关：`resolve_rule_org()` 遍历用户的组织成员身份，
  任一组织授予 `rule.manage`（即 `org_admin` 或平台管理员）即可；否则 **403**。
- 读取（`GET /rules`、`GET /rules/{id}`、`GET .../versions`、`GET .../evaluations`）仅需认证。

## 3. 检查逻辑类型（评估器真实实现，非硬编码）

`check_logic_json.type ∈ {field_compare, unit_mismatch, missing_evidence}`，未知类型 → 422。

样本输入统一为 `{"a": {字段: 值|富对象}, "b": {...}}`（亦接受 `paper`/`repro` 别名）；
富对象为 `{"value":..., "unit":..., "evidence_ref":...}`。字段经别名归一化。

| 类型 | 判定逻辑 | 预测输出关键字段 |
|---|---|---|
| `field_compare` | 单位不同即冲突；数值字段按 `tolerance` 相对容差 `abs(a-b) <= tol*max(|a|,|b|,1)`；字符串小写/去空白归一；单侧缺失记 missing | `status`、`conflict_fields[]`、`missing_fields[]`、`details` |
| `unit_mismatch` | 同字段两侧单位均非空且不同 → 冲突 | `status`、`unit_mismatch_fields[]` |
| `missing_evidence` | 字段任一侧存在但 `evidence_ref` 为空 → 冲突 | `status`、`missing_evidence_fields[]` |

`status`：有问题=`conflict`；仅缺失=`missing`（field_compare）；否则=`consistent`。
样本通过判定 `sample_passes(expected, prediction)`：只比较 `expected` 中出现的键，
列表按集合（顺序无关），数值按容差，递归比较。

## 4. 默认规则种子（幂等）

`POST /rules/seed`（org_admin）→ `seed_default_rules()` 按 `rule_key` 去重，已存在则跳过，
不重复建版本/样本。三条代表性规则镜像既有比对逻辑：

- `param_consistency`（high）：`field_compare`，字段 `learning_rate/batch_size/epochs/optimizer`，
  `tolerance=1e-6`；3 条样本（一致 / batch_size 冲突 / epochs 缺失）。
- `unit_mismatch`（medium）：2 条样本（同单位 / 单位冲突）。
- `missing_evidence`（high）：2 条样本（证据齐全 / 证据缺失）。

每条规则建 version 1（`is_active=True`）并附测试样本。

## 5. 版本演进与回滚

- **创建规则** `POST /rules`：建 rule + version 1（active）+ 可选样本。`rule_key` 重复 → 409。
- **新版本** `POST /rules/{id}/versions`：`test_samples` 为空 → **422**（强制离线验证）。
  停用所有旧版本 → 新建 `version = current_version + 1`（active）→ 附样本 →
  `current_version` 递增 → 留痕 before/after。
- **回滚** `POST /rules/{id}/rollback {version}`：**只增不改**。复制目标版本的逻辑
  **及其测试样本**为一个全新版本号 `current_version + 1` 并激活；目标版本与所有旧版本
  保留在历史中（`is_active=False`）。目标不存在 → 404。留痕 `rolled_back_to`。
- **启停** `PATCH /rules/{id} {is_enabled}`：留痕 `rule.enable`/`rule.disable`。
- 版本列表 `GET .../versions` 按版本号降序，含 `sample_count`、`is_active`、解析后的 `check_logic`。

## 6. 离线测试与评估

- **测试** `POST /rules/{id}/test`：跑当前激活版本的全部样本，返回逐条
  `passed/expected/actual/error` 与 `pass_rate`（真实评估）。
- **评估** `POST /rules/{id}/evaluate {dataset_ref, samples[], baseline_version?}`
  → `rule_eval.evaluate_rule()`：
  - 正类=预测 `status==conflict`；真值取自样本 `expected`（`status==conflict` 或问题列表非空）。
  - 真实计算混淆矩阵 TP/FP/FN/TN 与 `precision/recall/fp_rate/fn_rate/accuracy/pass_rate/runtime_ms`
    （分母为 0 时记 0.0）。每条落库 `rule_evaluations`。
  - 给定 `baseline_version` → 对**同一数据集**分别评估 baseline 与 current，落库两条，
    返回 `baseline/candidate/delta`（前后对比），用于上线前把关。
- 评估历史 `GET .../evaluations` 按时间降序。

## 7. 审计轨迹

`rule.seed` / `rule.create` / `rule.enable` / `rule.disable` / `rule.version_create` /
`rule.rollback` / `rule.evaluate` / `rule.evaluate_compare` 均经 `record_trail` 留痕，
版本类操作保留 before/after（旧版本号与旧逻辑 → 新版本号与新逻辑）。

## 8. 未实现 / 后续（诚实标注）

- **规则尚未驱动生产审计**：把激活规则注入 `audit_service` 实时比对是后续集成工作；
  当前规则层只做管理与离线评估，生产引擎行为保持不变。
- **无自动上线门禁**：`is_enabled` 为人工开关；代码不强制「pass_rate 达标才允许启用」，
  该门禁是治理流程建议（先 test/evaluate 再 enable），非自动拦截。
- **无 AI 自动学习 / 自动规则提案**：反馈不会自动生成规则变更（见反馈治理规范）。
- **无定时/自动重评估**、无跨版本乐观锁并发控制（版本号按 `current_version+1` 递增，
  假定单写者；高并发需后续加唯一约束冲突重试）。
- 评估指标分母为 0 时统一记 0.0（而非 undefined），已在文档与代码中明确。