# 第九阶段重构 · 现有产品只读审计（对标基线）

- 审计时间：2026-11-19
- 审计角色：D 组（现有项目架构与代码审计）
- 范围：项目根 `C:/Users/ASUS/Desktop/科研复现审计官`，只读，未修改任何业务代码
- 证据口径：`事实` = 源码/配置/文档中的可直接核验陈述（附 `文件:行号`）；`分析` = 基于事实的推断，非源码客观陈述
- 目的：为第九阶段产品重构提供"最影响用户体验、科研审计质量、系统稳定性"的五个具体问题作为对标基线，拒绝"需要更好的 UI"式泛泛而谈

---

## 问题一 `[P0] README 仍自称「第一阶段」，与第六/七阶段真实实现严重失同步`

- **事实**：`README.md:5` 写「**第一阶段**：已实现大模型接入……」；`README.md:6`/`README.md:99` 写「第一阶段仅处理文本材料，未实现 PDF 页码、代码行号」。但前端侧栏底部明确显示「API /api/v1 · 第六阶段」（`frontend/src/components/AppLayout.tsx:278`）；git 提交历史含 `stage4 / stage6 / stage6` 多轮交付（`git log`：`827e8fa stage6: chart verification...`、`db47864 stage6: task orchestration...`、`1d32f51 stage4: frontend reproduction workbench (7 pages)`）。PDF 页码与代码行号证据定位实际上**已部分实现**：PDF 记录 `viewer_page_number/printed_page_number`（`backend/app/parsers/pdf_parser.py:159-161`）、配置与 README 解析器写 `line_number`（`backend/app/parsers/config_parser.py:87`、`backend/app/parsers/readme_parser.py:78`）、任务服务把页码/行号映射进证据块（`backend/app/services/task_service.py:212-213`）、前端有 `SourceLocatorView` 展示「PDF 第 N 页 · 印刷页 M」（`frontend/src/components/SourceLocatorView.tsx:38-41`）。真实状态清单也确认产品已到第六阶段（`docs/STAGE6_REAL_STATUS.md:1,42-55`）。
- **分析**：README 是绝大多数新用户和重构接手者的第一入口。它把产品描述成只有「审计演示 + 合成材料」的第一阶段（`README.md:61-65`），会使读者完全不知道已有登录、项目隔离、材料解析、复现工作台、团队协作、基准库等真实能力；同时又错误声称"未实现 PDF 页码/代码行号"，与代码事实相反。文档失信会直接放大问题二的"能力用不到"。
- **影响**：新用户引导和认知错位；重构团队可能按错误基线制定方案；对外交付可信度受损。
- **建议方向**：以 `docs/STAGE6_REAL_STATUS.md` 为事实源重写 README，区分「已测试可用 / 仅后端 API / 未实现」三态；把"合成材料演示"降级为一个入口说明而非主流程；补一页「能力—入口—状态」对照表。

---

## 问题二 `[P0] 六个后端能力已交付 API 但前端零入口，用户无法触达`

- **事实**：以下能力后端路由真实存在，但前端三个 API client（`services/api.ts`、`services/reproductionApi.ts`、`services/stage6Api.ts`）与各页面均**无对应调用或按钮**（对 `frontend/src` 全量 grep `handoff|chart-verification|verification-layers|benchmark-metrics|pause|resume|recover` 仅命中确定性诊断的 `/diagnosis/categories`、`/diagnosis/classify`，见 `frontend/src/services/reproductionApi.ts:254-261`）：

  | 能力 | 后端 API 证据 | 前端状态 |
  |---|---|---|
  | 项目交接包导出/导入 | `POST /projects/{id}/handoff/export`、`/validate`（`backend/app/api/v1/handoff.py:28,44`） | 无入口 |
  | 论文图表反向验证 | `POST /projects/{id}/chart-verification`（`backend/app/api/v1/chart_verification.py:50`） | 无入口 |
  | 验证引擎分层面板（静态分析/数值重算/分层说明） | `POST /verification/static-analysis`、`/verification/recompute`、`GET /verification/layers`（`backend/app/api/v1/verification_layers.py:33,40,48`） | 无入口 |
  | 审计基准指标计算（P/R/F1 等） | `POST /benchmark/metrics/compute`、`GET /benchmark/metrics/schema`（`backend/app/api/v1/benchmark_metrics.py:42,60`） | 无入口 |
  | 任务暂停/继续/卡死恢复 | `POST /parse-tasks/{id}/pause`、`/resume`、`/parse-tasks/recover-stale`（`backend/app/api/v1/parse_tasks.py:149,163,75`） | 前端只接了 `retryTask`/`cancelTask`（`frontend/src/services/api.ts:200-208`） |
  | 确定性失败诊断 | `POST /diagnosis/classify`、`GET /diagnosis/categories`（`backend/app/api/v1/diagnosis.py`） | 唯一有 UI：`frontend/src/components/DeterministicDiagnosisPanel.tsx:12`，挂载于 `frontend/src/pages/reproduction/ReproductionDiagnosticsPage.tsx:146` |

  项目自身审计也明确承认「图表反向验证、交接包、申诉复核无前端入口」（`docs/STAGE6_REAL_STATUS.md:30`）。
- **分析**：这是投入产出比最差的断层——大量后端能力（含测试通过的 200 项回归，`docs/STAGE6_REAL_STATUS.md:57`）因没有前端入口而对终端用户等于不存在。用户完成"登录→建项目→上传→解析"后，无法导出交接包、无法做图表反向验证、看不到验证引擎分层、无法算基准指标、无法暂停任务。
- **影响**：核心审计质量能力（图表验证、分层验证、基准指标）被埋没；用户被迫用 curl/API 文档才能用产品；第九阶段若只做 UI 翻新而不接线，问题依旧。
- **建议方向**：按"能力—入口"清单逐个补前端路由与按钮，并在侧栏（问题三）暴露；优先把图表反向验证、验证分层、交接包接到项目详情页，把暂停/继续接到解析任务页。

---

## 问题三 `[P1] 新用户引导停留在静态空状态，侧栏无项目时退化为提示性死链`

- **事实**：
  - 登录后首屏 `DashboardPage` 有基础空状态：无项目时显示「尚无项目 / 去创建一个」（`frontend/src/pages/DashboardPage.tsx:184-197`），无审计发现时显示「尚无审计发现 / 前往审计演示」（`frontend/src/pages/DashboardPage.tsx:212-223`）。但「审计运行」统计卡永久硬编码为 `—`，hint 为「后端暂无运行列表接口，不显示推测数字」（`frontend/src/pages/DashboardPage.tsx:129-138`）。
  - 无 `lastProjectId` 时，侧栏「材料解析」5 项与「复现验证」7 项全部退化指向 `/projects`（`frontend/src/components/AppLayout.tsx:95-105,113-129`），「项目团队」同样指向 `/projects`（`frontend/src/components/AppLayout.tsx:195-200`），仅配静态提示文字「请先在「项目」中选择一个项目」（`frontend/src/components/AppLayout.tsx:259,265`）。
  - `RequireAuth` 行为：无 token → 跳 `/login` 并带 `state.from`（`frontend/src/components/RequireAuth.tsx:38-40`）；401 → 清会话（`:32-36`）；校验中显示 Loading（`:42-48`）；无用户且校验失败显示 ErrorState 可重试（`:50-62`）。注册页会「自动创建个人工作空间」（`frontend/src/pages/auth/LoginPage.tsx:193`），并提供 4 个演示账号一键填充（`:23-26,84-86`）。
- **分析**：引导是"有空状态文案、无分步任务流"。首次进入的用户面对一个 20+ 入口的侧栏（`/orgs`、`/roles`、`/benchmark`、`/rules`、`/feedback`、`/knowledge`、`/integrations`、`/api-tokens`、`/governance` 等，`frontend/src/components/AppLayout.tsx:44-68`），除 Dashboard 两处文案外没有任何"第 1 步做什么"的指引；侧栏大量入口在无项目时只是跳回项目列表，属于伪导航。硬编码 `—` 的统计卡让首屏显得产品"没有数据"。
- **影响**：新用户认知负荷高、流失风险大；菜单虽多但不知道主线在哪；与问题二叠加形成"看起来功能很多、实际用不起来"的观感。
- **建议方向**：设计首次进入的分步引导（建项目→上传→解析→看结论），侧栏在无项目时折叠/禁用二级入口而非跳转死链，"审计运行"卡改为真实数据或移除。

---

## 问题四 `[P1] 审计结论状态多方割裂，主审计流仍是粗粒度冲突/一致，缺统一「已验证/部分验证/证据不足/冲突/无法验证」模型`

- **事实**：
  - 主审计比较结论的取值只有 `conflict | consistent | missing`（`backend/app/schemas/__init__.py:120`，`ComparisonView.status`）；发现项 `FindingView` 仅有 `severity` 字符串，没有结论状态字段（`backend/app/schemas/__init__.py:132-136`）。
  - 事实抽取状态为 `supported | unsupported | needs_review`（`backend/app/schemas/parsing.py:131`，`ExtractionStatus`），证据核验为 `verified / unverified`（`backend/app/models/__init__.py:113-114` 附近、`backend/app/tests/test_extraction.py:84,144`）。
  - 更细的 verdict 只散落在**互不打通**的子系统：图表验证 `supported/conflicting/insufficient_data`（`backend/app/tests/test_chart_verification.py:105-125`）；复现对比 `exact_match/within_tolerance/significant_deviation/insufficient_data/not_comparable`（`backend/app/tests/test_stage4.py:147-152`）；基准案例质量等级 `unverified/partially_verified/execution_verified/independently_reviewed`（`backend/app/tests/test_stage6_benchmark.py:193`）。
  - 前端展示同样割裂：证据图谱用「有证据支持」（`frontend/src/pages/EvidenceGraphPage.tsx:18`），复现对比用另一套 `verdictLabel/verdictTone`（`frontend/src/pages/reproduction/ReproductionComparisonPage.tsx:21-22,193-194`），案例详情用"部分验证/执行验证/独立复核"文字（`frontend/src/pages/stage6/CaseDetailPage.tsx:583`）。
  - 证据定位能力存在但**不均衡**：PDF 页码与配置/README 行号可定位（见问题一事实段），但主审计服务构造证据时仍出现 `page_number=None, line_number=None`（`backend/app/services/audit_service.py:190,262`）、`extraction_service.py:103` 同样为 None。
- **分析**：用户在不同页面看到的是几套不同的"结论"词汇，无法用一个统一口径回答"这条审计结论到底验证到什么程度"。主审计流把"证据不足""无法验证"压成 `missing`，把"部分验证"混在 `conflict/consistent` 里，这正是科研审计质量最核心的可信度问题。README 又错称未实现页码/行号（问题一），进一步削弱证据可追溯的说服力。
- **影响**：结论语义不可比、不可解释；"冲突"被过度使用而"证据不足/无法验证"被掩盖，可能导致对论文的误判；跨页无法一致追溯证据。
- **建议方向**：定义贯穿抽取/比对/复现/基准的统一结论五态 + 证据强度枚举，所有子系统向它收敛，前端用同一 `StatusBadge` 与解释文案；审计证据块强制回填可用的 page/line，缺失时显式标"无法定位"。

---

## 问题五 `[P1] 稳定性默认行为偏开发态，关键降级路径对用户不透明`

- **事实**：
  - 配置默认值偏开发：`llm_api_key=""`（`backend/app/core/config.py:22`）、`allow_unauth_test_endpoints=True`（`backend/app/core/config.py:34`，即匿名可访问项目接口）、`enable_code_execution=False`、`execution_backend="none"`（`:61-62`）。`strict_production_check()` 明确把这些列为问题（`:96,103-104,113-114`），但启动逻辑只在 `logger.warning` 记录，只有显式设 `STRICT_PRODUCTION=1` 才拒绝启动（`backend/app/main.py:71-82`）。项目自评亦承认"安全默认值仍为开发态"（`docs/STAGE6_REAL_STATUS.md:31,55`）。
  - LLM Key 缺失时，AI 诊断直接抛 `LLM_KEY_NOT_CONFIGURED` 错误，不产出任何结论（`backend/app/reproduction/diagnostics.py:40-42`）；而前端在 Dashboard 仅以徽标显示"密钥未配置"（`frontend/src/pages/DashboardPage.tsx:143-149`），诊断入口无前置引导。
  - 交接包"导入"实际上只校验不写库：`validated_not_applied`（`docs/STAGE6_REAL_STATUS.md:49`），`POST /projects/{id}/handoff/validate` 仅返回校验结果（`backend/app/api/v1/handoff.py:44-54`）。
  - 服务重启后的任务"恢复"是"把卡死任务标记为失败"而非真正续跑（`docs/STAGE6_REAL_STATUS.md:22,48`）；执行引擎第 3 层动态执行始终关闭（`backend/app/api/v1/verification_layers.py:55-56`）。
- **分析**：这些默认行为在真实使用中有三种"静默伤害"：① 若按默认配置部署到生产，匿名接口暴露且系统仅告警不阻断；② 用户执行"导入交接包"后以为数据已恢复，实际未写库；③ 任务因重启被"恢复"后看到的是失败而非继续，且无 Key 时诊断按钮只会报错而非引导去配置页。用户困惑与数据误解的风险高于功能缺失本身。
- **影响**：生产安全风险；用户对数据完整性产生错误预期；故障排查成本高；与问题一（README 只讲"填密钥"）叠加，配置引导严重不足。
- **建议方向**：生产默认值收紧或提供部署自检向导；交接包导入提供"仅校验 / 合并写入"显式选择与结果预览；任务恢复区分"重试续跑"与"标记失败"并明确提示；前端在调用诊断/重分析前预检 Key 并跳转 `settings/llm`。

---

## 总体判断（一句话）

现有产品在后端已堆积到第六阶段的大量能力（200 项测试通过），但 README 仍停留在第一阶段、六项关键能力无前端入口、引导与结论模型割裂、默认稳定性行为不透明——**这是一个"引擎很强但驾驶舱没接好"的产品，第九阶段重构的首要任务不是加新功能，而是把已有能力接到统一、可信、可引导的用户流程上。**
