# 第九阶段 · 独立验收报告（第八步）

- 执行人：`verify-stage9`（第九阶段独立测试智能体，**未参与 U1/U2/U4 任何代码修改**）
- 执行日期：2026-11-19
- 分支：`stage9/research-driven-refactor`（基线 tag `stage9-baseline` / `33b6a5c`）
- 依据：`docs/STAGE9_ACCEPTANCE_PLAN.md`、`docs/STAGE9_TECH_DESIGN.md`
- 只读约束：除本报告与一次性脚本 `backend/_stage9_verify.py`（跑完已删）外，未修改任何业务代码

---

## 一、执行摘要

| 项目 | 结果 |
|---|---|
| 自动化验收检查（HTTP 真实响应） | **19 / 19 PASS，0 FAIL** |
| 12 类科研场景标注 | 9 PASS、1 PASS(含 BLOCKED 子项)、1 BLOCKED 子项、1 N/A、0 FAIL |
| P0 Bug | **0** |
| P1 Bug | **0** |
| P2 Bug（改进项，不阻断发布） | 3 |
| 后端全量回归 | **217 passed**（3 warnings，37.35s）；进程退出码非 0 仅因 Windows 临时目录清理 `PermissionError`，非测试失败 |
| 前端 typecheck | 通过（`tsc --noEmit` 无错误） |
| 前端 build | 通过（Vite 5.4.21，1694 模块，8.62s；仅 chunk>500kB 警告） |
| **发布结论** | **可以发布（P0/P1 = 0）**，附 3 项 P2 改进建议 |

> 未声称 ACM 认证；未伪造论文结果；所有"通过"均来自真实 HTTP status + body 或代码静态核对，无脑补。

---

## 二、核心验收项真实证据

### U1 统一可信结论层

| 检查 | 状态 | 真实证据（status + body 摘要） |
|---|---|---|
| U1-1 空项目 | PASS | `GET /api/v1/projects/p-empty/verdict-summary` → **200**；`verdicts` 五态全 0；三维 `material_available/artifact_assessed/results_validated` 均 `UNVERIFIABLE`；`scope_note="仅基于 ReproCheck 自身验证范围内的证据，未进行独立实验复现，不构成任何机构的认证。"`；`framework_note="参考 ACM v1.1 评估框架设计自检项"` |
| U1-2 构造事实/证据 | PASS | `GET .../p-fact/verdict-summary` → **200**；`verdicts={VERIFIED:2, PARTIALLY_VERIFIED:0, INSUFFICIENT_EVIDENCE:1, CONFLICTING:1, UNVERIFIABLE:1}`（= supported+within_tolerance / needs_review / significant_deviation / unsupported，与预期逐项一致）；`evidence_locator={total:3, with_location:2, ratio:0.6667}` |
| U1-3 映射正确性 | PASS | `map_to_verdict` 纯函数 **18/18** 命中：comparison(3)、extraction(3)、reproduction(6)、benchmark_quality(4)、未知来源(1)、未知状态(1)；未知值均落 `INSUFFICIENT_EVIDENCE`，不猜测 |
| U1-4 无认证 | PASS | 无 JWT 请求 → **401**，`error.code=UNAUTHORIZED`，`message="需要登录：请提供有效的 Bearer 令牌。"` |
| U1-5 越权 | PASS | 第二用户 JWT 访问他人项目 → **404**，`error.code=NOT_FOUND`，`message="项目不存在或无权访问。"`（由 `enforce_project_isolation` → `resolve_project_access` 拦截，隐藏存在性） |

### U2 能力驾驶舱（新端点真实可达，逐一 HTTP 调用）

| 检查 | 状态 | 真实证据 |
|---|---|---|
| U2-1 `POST /projects/{id}/chart-verification` | PASS | **200**；构造 pdf 块含 `ResNet-50 ... 76.1 top-1`、python 含 `plt.plot`、csv 含 `accuracy=0.9` → `table_claims=3`、`plot_logic=1`、`result_files=1`、`summary={supported:2, conflicting:1, insufficient_data:0}` |
| U2-2 `GET /diagnosis/production-check` | PASS | **200**；`passed=false`、`issues` 5 项（开发默认配置如实告警，不伪造通过） |
| U2-3 `GET /verification/layers` | PASS | **200**；`total=5`，五层职责齐全，第3层动态执行默认不执行 |
| U2-4 `POST /verification/static-analysis` | PASS | **200**；返回 `files_analyzed/valid_files/syntax_errors/combined/warnings/finding_count/method` |
| U2-5 `POST /verification/recompute` | PASS | **200**；`accuracy=9/10` 重算 `recomputed=0.9`、`abs_diff=0.0`、`verdict=consistent` |
| U2-6 `POST /benchmark/metrics/compute` | PASS | **200**；真实样本 3 truths/3 predictions → `precision=0.33, recall=0.33, f1=0.33`，`counts={tp:1, fp:2, fn:2, ...}` |
| U2-7 `POST /projects/{id}/handoff/export` | PASS | **200**、`content-type=application/zip`、2880 字节；首 2 字节 `PK`，ZIP 含 `manifest.json` 等 10+ 条目 |
| U2-8 `POST /projects/{id}/handoff/validate` | PASS | **200**；上传上一步真实 ZIP → `valid=true`、`import_mode=validated_not_applied` |
| U2-9 `POST /parse-tasks/{id}/pause` `/resume` | PASS | 均 **200**；`queued → paused → queued`，`resume_count=1`（构造真实 ParseTask 行 + JWT） |

### U2 前端接线静态核对（Read/Grep，未跑浏览器）

| 项 | 状态 | 证据 |
|---|---|---|
| 路由 | PASS | `frontend/src/App.tsx:57-58` 含 `projects/:projectId/verification`、`projects/:projectId/handoff` |
| 侧栏入口 | PASS | `frontend/src/components/AppLayout.tsx:115-124` 有"项目验证""交接包"两项，无项目时 degradation 到 `/projects` |
| 真实 API 调用 | PASS | `ProjectVerificationPage.tsx:123-172` 调 `api.getVerdictSummary / runChartVerification / getProductionCheck / recoverStale` 与 `reproductionApi.getVerificationLayers / runStaticAnalysis / runRecompute / computeBenchmarkMetrics`（均非硬编码）；`HandoffPage.tsx:28,34,114` 调 `api.exportHandoff / validateHandoff` 且含 `<input type="file">` |
| pause/resume 按钮 | PASS | `ParseTasksPage.tsx:113,122` 调 `api.pauseTask / resumeTask`，`:194,202` 有"暂停/恢复"按钮与错误提示 |
| client 定义 | PASS | `services/api.ts:268-343`、`services/reproductionApi.ts:271-291` 定义全部 12 个新方法，走统一 request（Bearer + 错误码） |

**结论**：≥4 项能力有真实前端入口（实际 7+ 项），满足技术设计验收标准。

### U4 README

- `grep "第一阶段\|仅合成材料" README.md` → **NONE FOUND**（`:90` 的"审计演示页只使用合成材料"是准确语境，非过时表述）。
- 含能力—入口—状态表（`:13-26`，`已测试/仅API/部分/未实现`，为要求的三态超集）；含"科研结论的独立核对层"定位（`:3`）；含安全边界（`:113-119`：不执行用户代码、需 LLM Key、不宣称部署）。
- 合规声明（`:111`）：明确"参考 ACM v1.1 框架……不获得也不宣称 ACM 认证"。
- 轻微不一致见 P2-2。

---

## 三、12 类科研场景逐项标注

| # | 场景 | 标注 | 真实证据 / 说明 |
|---|---|---|---|
| 1 | 正常科研项目（注册→建项目→上传→解析→看图谱/verdict） | **PASS（解析环节 BLOCKED）** | 项目创建、材料落库、verdict-summary(200)、证据图谱页面存在均验证；真实解析需 LLM Key，无 Key → BLOCKED（未配置） |
| 2 | 缺失 README 的项目 → 材料完整性降级 | **PASS** | X1：材料缺 sha256 → `material_available.status=PARTIALLY_VERIFIED`、`subtype=sha256_partial`、`basis="0/1 份材料具备 sha256"`，未冒充 VERIFIED |
| 3 | 无公开数据集 → 不编造 | **PASS** | U1-1 空项目三维全 `UNVERIFIABLE`；X1 部分材料 `PARTIALLY_VERIFIED`，均不编造 |
| 4 | 依赖版本冲突 → 候选原因不冒充根因 | **PASS** | X2：`POST /diagnosis/classify` → **200**，`primary_category=env_dependency_conflict`，1 个候选且 `is_confirmed=false` |
| 5 | 论文与代码不一致 → CONFLICTING + 证据 | **PASS** | U1-2 `MetricComparison=significant_deviation` → `verdicts.CONFLICTING=1`；U2-1 图表交叉验证 `summary.conflicting=1`，附 `plot_logic`/`result_files` 来源 |
| 6 | 数据划分风险 → 若无检测能力须明确"未覆盖" | **N/A** | README `:26` 将"数据泄漏检测/隔离执行/OCR"标为未实现，系统未假报安全；本次未发现相关端点，无适用判定对象 |
| 7 | 运行超时 → `failure_category=timeout` + `error_code=TASK_TIMEOUT` | **PASS（服务级；HTTP 端到端 BLOCKED）** | X5：`TaskService.mark_timeout` 落库 `status=failed, error_code=TASK_TIMEOUT, failure_category=timeout`（代码 `task_service.py:389-398`）；无真实长任务，无法经 HTTP 触发端到端 |
| 8 | 运行失败 → 诊断候选 `is_confirmed=false` | **PASS** | X2 同证：全部候选 `is_confirmed=false`，`method` 为确定性规则 |
| 9 | 结果与论文差异 → `significant_deviation` → CONFLICTING | **PASS** | U1-2 直接证据：`verdicts.CONFLICTING=1`，`counts.metric_comparisons=2` |
| 10 | 部分实验材料 → `INSUFFICIENT_EVIDENCE` 占比合理 + scope_note | **PASS** | U1-2：`INSUFFICIENT_EVIDENCE=1/5`（needs_review）；U1-1 `scope_note` 含认证声明 |
| 11 | 大型科研项目（10+ 材料）聚合不 500 | **PASS** | X3：12 份材料 `GET verdict-summary` → **200**，`counts.materials=12`，耗时 **15.8ms** |
| 12 | 多成员共同审计（非成员 404、成员可见） | **PASS** | U1-5 非成员 → **404**；U1-4 无认证 → **401**；X4 成员 → **200**（五态分布可见） |

---

## 四、统计口径（适用范围内，真实样本）

| 指标 | 结果 | 样本与口径 |
|---|---|---|
| 五态映射正确率（`map_to_verdict`） | **100%（18/18）** | 4 套枚举全覆盖 + 未知来源/状态；预期取自 `STAGE9_TECH_DESIGN.md` U1 节 |
| 聚合 counts 正确率 | **100%（5/5 类）** | U1-2 人工构造 5 条事实/比对，五态 counts 逐项吻合 |
| 证据定位完整率 | **2/3 = 0.6667** | 3 条 EvidenceItem 中 2 条带 `source_locator`，与 `evidence_locator.ratio` 一致 |
| 越权拒绝率 | **100%（1/1）** | 非成员访问他人项目 verdict-summary → 404；无认证 → 401（1/1） |
| P/R/F1（端点计算正确性） | **P=0.33, R=0.33, F1=0.33** | U2-6：3 truths / 3 predictions，TP=1, FP=2, FN=2；这是**验证计算端点的合成样本** |
| 产品真实检测 P/R/F1 | **未验证** | 未提供带标注的科研样本基准集；不得以合成端点样本冒充产品检出质量 |
| 运行成功率/耗时 | 聚合 API X3 15.8ms；真实任务运行 **BLOCKED** | 无 Docker / 无 LLM Key |

---

## 五、问题分类（严格区分）

### A. 系统真发现的问题（产品/文档缺陷）

1. **P2-1 图表验证把代码/结果材料数值误当"论文表格主张"（可能误报，检测质量缺陷）**
   - 复现：pdf 块 `ResNet-50 achieves 76.1 top-1 accuracy` + python 块 `plt.plot([1,2,3],[0.7,0.8,0.9])` + csv 块 `accuracy=0.9 / f1=0.88` → `table_claims=3`，其中 2 条来自代码/结果数值（`values=[1,2,3,0.7,0.8,0.9]`、`[0.9]`、`[0.88]`，`metric=None`），`summary` 给出 `supported=2, conflicting=1`，但论文侧并无对应表格。
   - 根因：`backend/app/api/v1/chart_verification.py:59-64` 把所有 SourceChunk 无差别送入 `verify_bundle`；`chart_verification_service.py:454-462` 的 `extract_table_claims` 不区分材料类型。
   - 影响：普通科研用户可能把代码/结果里的数字当成"论文声明被验证"，削弱"独立核对层"可信度。
   - 建议：按 `Material.material_type` 仅将论文/PDF 类 chunk 作为 claims，代码/结果仅作对照证词。
2. **P2-2 README 能力与入口表轻微滞后**
   - `README.md:20,22,23,24` 仍写"后端 API（前端接线中）"，但 U2 已在 `项目验证` / `交接包` 页接入真实入口。属文档与现状不一致，非功能缺陷。
3. **P2-3（可选）标准两列 CSV 的指标未被提取**
   - 观测：`metric,value\naccuracy,0.9` 形式 → `result_files=0`（`_metric_from_key` 不识别 `metric/value` 列名，且文本正则只认 `metric=value`）。`accuracy=0.9` 形式可识别。需真实 CSV 样本确认，故列 P2 低置信度。

### B. 可能误报（测试侧，非产品 Bug，已纠正）

- U2-5 首次 FAIL：我把 `verdict` 白名单写成 `match/within_tolerance/insufficient_data`，而实现返回合法值 `consistent`（`numeric_recompute_service.py:244-248`）。**这是测试断言过窄**，修正后 PASS；不作为产品缺陷。
- U2-1 的 `conflicting=1` 源于合成数据里论文 `76.1 top-1` 与结果 `accuracy=0.9` 指标口径/量纲不一致，**不是真实论文冲突**，仅证明交叉检查被触发。

### C. 漏掉 / 未验证的能力

- 真实 LLM Key 下的解析、事实抽取、证据逐字校验端到端（无 Key）。
- 浏览器端真实点击 E2E（按计划仅做前端代码静态核对，未启动浏览器）。
- 真实带标注基准集上的产品 P/R/F1、误报/漏报率。
- 多成员协作 UI 全流程（仅 API 层隔离已验）。
- 365 天真实运行、备份恢复演练、五篇权威论文实战（README `:119` 已声明未完成）。

### D. 材料不足无法判断

- 场景 6（数据划分风险）：项目未提供相关检测能力或样本，无法判定系统行为，标 N/A。
- P2-3 需真实 CSV 样本方可确认。

### E. 资源限制导致 BLOCKED

- 无真实 LLM Key → 场景 1 解析环节 BLOCKED（系统应返回 503 且不造假，符合 README `:68`）。
- 无 Docker/GVisor、无 OCR → 隔离动态执行、图像级重绘对比、数据泄漏检测 BLOCKED/未实现。
- pytest 进程退出码非 0：Windows 沙箱下 `pytest-of-ASUS/pytest-current` 临时目录清理 `PermissionError [WinError 5]`，发生在 atexit、与 217 个测试结果无关，属环境限制。

---

## 六、Bug 清单（按 P0/P1/P2 分级）

| 级别 | 数量 | 明细 |
|---|---|---|
| **P0** | 0 | 无 |
| **P1** | 0 | 无 |
| **P2** | 3 | P2-1 图表验证 claim 提取来源过宽；P2-2 README "前端接线中"滞后；P2-3 标准两列 CSV 指标识别缺口（低置信度） |

**发布门槛核对**（`STAGE9_ACCEPTANCE_PLAN.md`）：
- P0/P1 Bug = 0 ✅
- 后端测试 ≥205 passed：217 ✅
- 前端 typecheck/build 通过 ✅
- U1 五态映射与三维输出有真实例子 ✅（U1-1/U1-2）
- U2 ≥4 项能力有真实前端入口 ✅（7+ 项静态核对）
- README 与真实状态一致 ✅（P2-2 为轻微滞后，不影响门槛）

---

## 七、结论与声明

- **结论：可以发布（P0/P1 = 0）**。P2 项为质量/文档改进建议，不阻断本阶段交付。
- 本报告不声称 ACM 认证；不伪造论文结果；所有 FAIL/BLOCKED 均已如实披露。
- 环境限制项（LLM Key / Docker / OCR / 浏览器 E2E）在具备条件后应补测，尤其"真实标注样本上的 P/R/F1"目前为**未验证**。
- 临时脚本 `backend/_stage9_verify.py` 已在验收结束后删除；业务代码零改动。

---

## 八、主控对 P2 项的后续处理（验收报告完成后追加）

独立验收后，主控对 P2 项做了实际修复与确认（均有测试/命令证据）：

| P2 项 | 处理 | 证据 |
|---|---|---|
| P2-1 代码/CSV 数值被误当论文 claim | **已修复**：① API 层构建 `claim_material_ids`，仅论文类材料（非 python/notebook/zip/csv/json/xlsx）的 chunk 进入 claim 提取；② `verify_figure` 按 metric 名优先匹配结果值，指标不一致时判 `insufficient_data` 并记录 `result_sources`；③ 新增 2 个回归测试（不同指标数值不产生 supported；代码/CSV chunk 不产生 claim） | `test_chart_verification.py` 14 passed（原 12 + 2 回归） |
| P2-2 README "前端接线中"滞后 | **已修复**：README 能力表改为真实入口（项目验证页/交接包页/解析任务页），并修正使用流程第 5 步 | README.md grep 无"接线中" |
| P2-3 标准两列 CSV（`metric,value\naccuracy,0.9`）指标识别缺口 | **已核实为边界情况，非核心缺陷**：`find_result_files` 支持 `accuracy=0.9`、`model,accuracy\nresnet,0.9` 等常见格式；`metric,value` 两列表需额外格式识别，列入 P2 后续迭代，不阻断本阶段 | 原报告低置信度项，保留未修 |

最终全量回归：**219 passed**（基线 205 → U1 12 → 图表误报防护 2）；前端 typecheck/build 通过。发布结论不变：P0/P1=0，但产品整体发布状态仍 NOT_READY（无真实隔离执行/生产实测等既有 P0 阻断项属第六阶段遗留，不属本阶段新增）。
