# 科研复现审计官 · v2 独立全站验收报告

> **验证者**：qa-verifier（独立验证工程师，团队 ui-reprocheck-v2）
> **验证日期**：2026-11-22
> **立场**：全新视角、不采信任何工程师自报；"证明代码能工作"而非"确认它存在"。
> **方法**：Edge + puppeteer-core 真实浏览器；桌面 1440×900 + 移动 390×844 双视口逐页访问；DOM 诊断、整页截图、控制台/页面错误/失败请求采集、`documentElement.scrollWidth <= innerWidth + 2` 溢出检测、真实数据特征断言、后端 pytest 回归。
> **脚本**：`frontend/scripts/v2-final-verify.mjs`（全量巡检）、`frontend/scripts/v2-final-recheck.mjs`（聚焦复核，澄清启发式误判）
> **原始数据**：`.screenshots/v2-final-report.json`、`.screenshots/v2-final-recheck.json`；截图 `.screenshots/v2-final-*.png`

---

## 0. 结论摘要

| 项目 | 结果 |
|---|---|
| 41 页可访问路由 | **40/40 真实通过，0 项真实失败**（1 项 N/A：历史未挂载页） |
| 8 Bloom 舞台 | **7/7 可访问舞台通过**（1 项 N/A：ProjectConstellation 仅被未挂载页引用） |
| 双视口截图 | 40 条可访问路由 × 2 + 7 舞台 × 2 = **94 张**，全部落盘 `.screenshots/v2-final-*.png`（N/A 页不截图） |
| 横向溢出 | **全部通过**（桌面/移动 `scrollWidth == innerWidth`） |
| 控制台 | 仅 **1 条 503**（`/demo/audit` 缺 LLM Key），**0 pageerror、0 失败请求** |
| 真实数据断言 | **37 页命中**真实数据特征（远超 ≥8 页要求） |
| 音乐图标 / 双皮肤 / 墨绿归零 | **全部通过**（详见 §4） |
| 后端回归 | **30 passed**（3 个关键测试文件，18.45s） |

**诚实声明**：初量巡检脚本的通用启发式（`textLen > 30`）把 canvas 工作台、登录后重定向页、路由兜底页误判为 `FAIL-RENDER`，另有双皮肤初判取错 DOM 层级、Wave D 两条断言写错泳道名/状态码。全部经聚焦复核（§3、§6）逐一澄清，**均非产品缺陷**。唯一真实未通过项是 demo/audit 因环境未配置 LLM Key 返回 503（§3.3、§6）。

---

## 1. 全站 41 页验收表（对应 `Plan/global-interaction-spec.md` §5.1）

> 路由中 `:projectId`/`:pid` 代入真实演示项目 `proj-209c77cd39f94212`；`:planId`/`:runId` 为运行时从复现总览页发现并回读的真实 ID；`:materialId` 为真实材料 `mat-e305657ae1924224`；`:caseId` 为真实案例 `case-c3d8a5d22038455c`。
> 截图列文件名均位于 `.screenshots/` 下。

| # | 页面 | 路由 | 渲染 | 桌面截图 | 移动截图 | 横向溢出 | 控制台错误 | 真实数据断言 | 结论 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 01-中央工作台 | `/` | ✅ | v2-final-01-中央工作台-desktop.png | v2-final-01-中央工作台-mobile.png | ✅ 无 | 无 | N/A（canvas/重定向，见复核） | 通过（聚焦复核确认） |
| 2 | 02-登录页 | `/login` | ✅ | v2-final-02-登录页-desktop.png | v2-final-02-登录页-mobile.png | ✅ 无 | 无 | N/A（canvas/重定向，见复核） | 通过（聚焦复核确认） |
| 3 | 03-项目列表 | `/projects` | ✅ | v2-final-03-项目列表-desktop.png | v2-final-03-项目列表-mobile.png | ✅ 无 | 无 | proj-209c77cd39f94212, ResNet | 通过 |
| 4 | 04-新建项目 | `/projects/new` | ✅ | v2-final-04-新建项目-desktop.png | v2-final-04-新建项目-mobile.png | ✅ 无 | 无 | 新建项目, 项目名称, 创建项目 | 通过 |
| 5 | 05-Bloom项目工作台 | `/projects/proj-209c77cd39f94212/workbench` | ✅ | v2-final-05-Bloom项目工作台-desktop.png | v2-final-05-Bloom项目工作台-mobile.png | ✅ 无 | 无 | 材料, 事实, 验证 | 通过 |
| 6 | 06-AI模型服务 | `/settings/llm` | ✅ | v2-final-06-AI模型服务-desktop.png | v2-final-06-AI模型服务-mobile.png | ✅ 无 | 无 | 模型, API, LLM | 通过 |
| 7 | 07-模型管理中心 | `/settings/models` | ✅ | v2-final-07-模型管理中心-desktop.png | v2-final-07-模型管理中心-mobile.png | ✅ 无 | 无 | 我的模型, 默认模型, 使用统计 | 通过 |
| 8 | 08-审计演示 | `/demo/audit` | ✅ | v2-final-08-审计演示-desktop.png | v2-final-08-审计演示-mobile.png | ✅ 无 | ⚠ 1（503，见 §3.3） | 审计演示, 开始分析 | 通过（交互受环境限制，见 §3.3） |
| 9 | 09-材料管理 | `/projects/proj-209c77cd39f94212/materials` | ✅ | v2-final-09-材料管理-desktop.png | v2-final-09-材料管理-mobile.png | ✅ 无 | 无 | paper_excerpt.md, resnet50_repro.ipynb | 通过 |
| 10 | 10-材料详情 | `/materials/mat-e305657ae1924224` | ✅ | v2-final-10-材料详情-desktop.png | v2-final-10-材料详情-mobile.png | ✅ 无 | 无 | paper_excerpt.md, 事实, 材料 | 通过 |
| 11 | 11-解析任务 | `/projects/proj-209c77cd39f94212/tasks` | ✅ | v2-final-11-解析任务-desktop.png | v2-final-11-解析任务-mobile.png | ✅ 无 | 无 | 解析, 任务, paper_excerpt.md | 通过 |
| 12 | 12-科研事实 | `/projects/proj-209c77cd39f94212/facts` | ✅ | v2-final-12-科研事实-desktop.png | v2-final-12-科研事实-mobile.png | ✅ 无 | 无 | learning_rate, batch_size, optimizer | 通过 |
| 13 | 13-证据图谱 | `/projects/proj-209c77cd39f94212/evidence-graph` | ✅ | v2-final-13-证据图谱-desktop.png | v2-final-13-证据图谱-mobile.png | ✅ 无 | 无 | 证据, 材料, 事实 | 通过 |
| 14 | 14-解析概览 | `/projects/proj-209c77cd39f94212/overview` | ✅ | v2-final-14-解析概览-desktop.png | v2-final-14-解析概览-mobile.png | ✅ 无 | 无 | 材料, 事实, 证据 | 通过 |
| 15 | 15-项目验证 | `/projects/proj-209c77cd39f94212/verification` | ✅ | v2-final-15-项目验证-desktop.png | v2-final-15-项目验证-mobile.png | ✅ 无 | 无 | 验证, 证据, 结论 | 通过 |
| 16 | 16-交接包 | `/projects/proj-209c77cd39f94212/handoff` | ✅ | v2-final-16-交接包-desktop.png | v2-final-16-交接包-mobile.png | ✅ 无 | 无 | 交接, 材料, 验证 | 通过 |
| 17 | 17-实验差异分析 | `/projects/proj-209c77cd39f94212/experiments/diff` | ✅ | v2-final-17-实验差异分析-desktop.png | v2-final-17-实验差异分析-mobile.png | ✅ 无 | 无 | 差异, 指标 | 通过 |
| 18 | 18-变化监控 | `/projects/proj-209c77cd39f94212/change-monitor` | ✅ | v2-final-18-变化监控-desktop.png | v2-final-18-变化监控-mobile.png | ✅ 无 | 无 | 变化, 监控, 分析 | 通过 |
| 19 | 19-数据质量审计 | `/projects/proj-209c77cd39f94212/data-audit` | ✅ | v2-final-19-数据质量审计-desktop.png | v2-final-19-数据质量审计-mobile.png | ✅ 无 | 无 | 字段, 审计, 结构 | 通过 |
| 20 | 20-统计审计 | `/stats-audit` | ✅ | v2-final-20-统计审计-desktop.png | v2-final-20-统计审计-mobile.png | ✅ 无 | 无 | 统计, 审计, 指标 | 通过 |
| 21 | 21-复现总览 | `/projects/proj-209c77cd39f94212/reproduction` | ✅ | v2-final-21-复现总览-desktop.png | v2-final-21-复现总览-mobile.png | ✅ 无 | 无 | 复现, plan-b4bbf8748a2d41, run-5acdb8cd27d946 | 通过 |
| 22 | 22-复现规划DAG | `/reproductions/plans/plan-b4bbf8748a2d41` | ✅ | v2-final-22-复现规划DAG-desktop.png | v2-final-22-复现规划DAG-mobile.png | ✅ 无 | 无 | 规划, 阶段, plan-b4bbf8748a2d41 | 通过 |
| 23 | 23-复现环境 | `/projects/proj-209c77cd39f94212/reproduction/environment` | ✅ | v2-final-23-复现环境-desktop.png | v2-final-23-复现环境-mobile.png | ✅ 无 | 无 | 环境, 依赖, Python | 通过 |
| 24 | 24-执行控制台 | `/reproductions/runs/run-5acdb8cd27d946` | ✅ | v2-final-24-执行控制台-desktop.png | v2-final-24-执行控制台-mobile.png | ✅ 无 | 无 | 日志, 运行, run-5acdb8cd27d946 | 通过 |
| 25 | 25-结果对照 | `/projects/proj-209c77cd39f94212/reproduction/comparison` | ✅ | v2-final-25-结果对照-desktop.png | v2-final-25-结果对照-mobile.png | ✅ 无 | 无 | 对照, 指标, accuracy | 通过 |
| 26 | 26-AI诊断 | `/projects/proj-209c77cd39f94212/reproduction/diagnostics` | ✅ | v2-final-26-AI诊断-desktop.png | v2-final-26-AI诊断-mobile.png | ✅ 无 | 无 | 诊断, 分类 | 通过 |
| 27 | 27-报告中心 | `/projects/proj-209c77cd39f94212/reproduction/reports` | ✅ | v2-final-27-报告中心-desktop.png | v2-final-27-报告中心-mobile.png | ✅ 无 | 无 | 报告, 章节, 证据 | 通过 |
| 28 | 28-组织与成员 | `/orgs` | ✅ | v2-final-28-组织与成员-desktop.png | v2-final-28-组织与成员-mobile.png | ✅ 无 | 无 | 成员, 开源复现审计实验室, org- | 通过 |
| 29 | 29-角色权限 | `/roles` | ✅ | v2-final-29-角色权限-desktop.png | v2-final-29-角色权限-mobile.png | ✅ 无 | 无 | 角色, 权限 | 通过 |
| 30 | 30-项目团队 | `/projects/proj-209c77cd39f94212/team` | ✅ | v2-final-30-项目团队-desktop.png | v2-final-30-项目团队-mobile.png | ✅ 无 | 无 | 评论, 活动, 复核 | 通过 |
| 31 | 31-基准案例库 | `/benchmark` | ✅ | v2-final-31-基准案例库-desktop.png | v2-final-31-基准案例库-mobile.png | ✅ 无 | 无 | 案例, 检索, ResNet | 通过 |
| 32 | 32-案例详情 | `/benchmark/case-c3d8a5d22038455c` | ✅ | v2-final-32-案例详情-desktop.png | v2-final-32-案例详情-mobile.png | ✅ 无 | 无 | 验证, 质量 | 通过 |
| 33 | 33-事实字段目录 | `/fact-schema` | ✅ | v2-final-33-事实字段目录-desktop.png | v2-final-33-事实字段目录-mobile.png | ✅ 无 | 无 | 字段, 事实, 学习率 | 通过 |
| 34 | 34-审计规则 | `/rules` | ✅ | v2-final-34-审计规则-desktop.png | v2-final-34-审计规则-mobile.png | ✅ 无 | 无 | 规则, accuracy_tolerance, 离线评估 | 通过 |
| 35 | 35-反馈治理 | `/feedback` | ✅ | v2-final-35-反馈治理-desktop.png | v2-final-35-反馈治理-mobile.png | ✅ 无 | 无 | 分诊, 反馈, 待处理 | 通过 |
| 36 | 36-知识检索 | `/knowledge` | ✅ | v2-final-36-知识检索-desktop.png | v2-final-36-知识检索-mobile.png | ✅ 无 | 无 | 知识, 检索, FID | 通过 |
| 37 | 37-外部集成 | `/integrations` | ✅ | v2-final-37-外部集成-desktop.png | v2-final-37-外部集成-mobile.png | ✅ 无 | 无 | 集成, 仓库 | 通过 |
| 38 | 38-API令牌 | `/api-tokens` | ✅ | v2-final-38-API令牌-desktop.png | v2-final-38-API令牌-mobile.png | ✅ 无 | 无 | 令牌, 创建 | 通过 |
| 39 | 39-数据治理 | `/governance` | ✅ | v2-final-39-数据治理-desktop.png | v2-final-39-数据治理-mobile.png | ✅ 无 | 无 | 导出, 保留 | 通过 |
| 40 | 40-历史遗留页 | `DashboardPage.tsx`（未挂载） | N/A | — | — | N/A | 无 | N/A | N/A（符合 §5.1 口径，源码存在但 `App.tsx` 未引用） |
| 41 | 41-路由兜底 | `/__qa_nonexistent_route__`（→ `/`） | ✅ | v2-final-41-路由兜底-desktop.png | v2-final-41-路由兜底-mobile.png | ✅ 无 | 无 | N/A（重定向，见复核） | 通过（聚焦复核确认） |

**巡检细节**：
- 全部 40 条可访问路由在桌面与移动视口 HTTP 状态为 200 或 304（304 已禁缓存复测确认为缓存命中，见 §3.2 第 6 项）。
- `rootChildren > 0`、`crash` 正则（`/something went wrong|minified react error|unhandled runtime error|application error/i`）全程为 0 命中，无 React 崩溃。
- 横向溢出：`documentElement.scrollWidth` 与 `innerWidth` 在全部 80 次视口检查中相等（无一条 > `innerWidth + 2`）。

---

## 2. 8 Bloom 舞台验收表（经 `/projects/proj-209c77cd39f94212/workbench` 进入）

| # | 舞台 | 路由 | 渲染 | 桌面截图 | 移动截图 | 溢出 | 数据/选择器命中 | 结论 |
|---|---|---|---|---|---|---|---|---|
| B1 | BloomStage-绽放舞台 | `/projects/proj-209c77cd39f94212/workbench` | ✅ | v2-final-B1-BloomStage-绽放舞台-desktop.png | v2-final-B1-BloomStage-绽放舞台-mobile.png | ✅ | 材料 | 通过 |
| B2 | BloomCard-瓣卡 | `/projects/proj-209c77cd39f94212/workbench` | ✅ | v2-final-B2-BloomCard-瓣卡-desktop.png | v2-final-B2-BloomCard-瓣卡-mobile.png | ✅ | —（与 B1 同路由，瓣卡 SVG/canvas 可见，见截图） | 通过 |
| B3 | BloomAtelier-工坊 | `/projects/proj-209c77cd39f94212/workbench?view=atelier` | ✅ | v2-final-B3-BloomAtelier-工坊-desktop.png | v2-final-B3-BloomAtelier-工坊-mobile.png | ✅ | 工坊, 模块 | 通过 |
| B4 | BloomWorkbench-状态机focus | `/projects/proj-209c77cd39f94212/workbench?focus=materials` | ✅ | v2-final-B4-BloomWorkbench-状态机focus-desktop.png | v2-final-B4-BloomWorkbench-状态机focus-mobile.png | ✅ | 材料, 事实, 证据 | 通过 |
| B5 | EvidenceLoom-证据织机 | `/projects/proj-209c77cd39f94212/workbench?view=loom` | ✅ | v2-final-B5-EvidenceLoom-证据织机-desktop.png | v2-final-B5-EvidenceLoom-证据织机-mobile.png | ✅ | 证据 | 通过 |
| B6 | ProjectConstellation-项目星图 | — | N/A | — | — | N/A | 源码存在 | N/A（仅被未挂载的 `DashboardPage` 引用，非独立路由） |
| B7 | unitDetails-单元详情 | `/projects/proj-209c77cd39f94212/workbench?focus=materials` | ✅ | v2-final-B7-unitDetails-单元详情-desktop.png | v2-final-B7-unitDetails-单元详情-mobile.png | ✅ | 材料状态, 事实证据, 模型调用 | 通过 |
| B8 | unitDetailParts-详情子组件 | `/projects/proj-209c77cd39f94212/workbench?focus=materials` | ✅ | v2-final-B8-unitDetailParts-详情子组件-desktop.png | v2-final-B8-unitDetailParts-详情子组件-mobile.png | ✅ | paper_excerpt.md | 通过 |

---

## 3. Wave C / D / E 历史问题独立复核结论

### 3.1 Wave C（8 页"0/23 通过、ERR_CONNECTION_REFUSED"）—— **假警报**

- **历史报告与交接快照不一致**：我接手时 `.screenshots/v2-waveC-verify-report.json` 已被前面工程师更新为"所有桌面/移动/溢出步骤 ok，仅 `stats-audit:run` 失败"，并非交接信息中的 0/23 全挂。这恰恰说明**不能采信任何自报**。
- **独立复核**：8 页全部纳入全量双视口巡检，结果 **8/8 真实渲染**（见 §1 第 3、4、15、16、17、18、19、20 行）：
  - `/projects`、`/projects/new`、`/verification`、`/handoff`、`/experiments/diff`、`/change-monitor`、`/data-audit`、`/stats-audit` 均 HTTP 200/304、`rootChildren > 0`、无 React 崩溃、双视口无溢出、桌面与移动截图均已落盘。
  - 真实数据命中示例：项目 ID `proj-209c77cd39f94212`；`accuracy_tolerance`；`paper_excerpt.md` 等。
- **唯一历史失败项 `stats-audit:run` 复测**：点击"运行审计"→ `.rc4-table-wrap` 在 30s 内出现，表格渲染 **PASS**（`hist.waveC.statsAuditRun.pass = true`）。
- **结论**：历史 0/23 是当时 **dev server 中断**导致的测试环境问题，非页面缺陷；当前服务下 8 页真实可渲染，原 `stats table not rendered` 亦不再复现。

### 3.2 Wave D（6 项交互失败）—— **6 项均非产品缺陷，系测试断言写错**

逐项 DOM 前后证据（原始数据 `v2-final-report.json → historical.waveD`）：

| 项 | 历史结论 | 独立复核 | 判定 |
|---|---|---|---|
| `rules:sort+eval` | 失败 | "优先级"排序按钮与"离线评估" tab 均可点击并切换，DOM 前后有内容变化；断言 `pass=true` | **测试脚本问题，功能存在** |
| `feedback:lanes` | 失败 | 泳道真实名称为 **待处理 / 已分诊 / 已解决 / 有争议**（DOM 快照明确含"分诊泳道…点击泳道标题可只看该状态"、`待处理0`、`已分诊1`、`已解决1`、`有争议1`）。历史脚本误用"待分诊/处理中/已解决"做断言 → 假阴性 | **断言写错泳道名，功能存在** |
| `governance:tiers` | 失败 | "AI 授权" tab 可点击并切换内容；分类/导出/保留区块可见；断言 `pass=true` | **测试脚本问题，功能存在** |
| `integrations:notebook` | 失败 | 集成页含真实 notebook 集成区块与可选仓库/快照，断言 `pass=true` | **测试脚本问题，功能存在** |
| `tokens:cards` | 失败 | 令牌页渲染真实令牌卡片与"创建令牌"入口，断言 `pass=true` | **测试脚本问题，功能存在** |
| `mobile` | 失败 | 12 页移动视口全部 `scrollWidth == innerWidth == 390`（无溢出）；历史失败仅因断言要求 `http === 200`，而浏览器缓存命中返回 **304**。禁缓存复测 `/governance` 三次均 **200**（`recheck.cache304.codes = [200,200,200]`） | **断言把 304 当失败，功能正常** |

**结论**：Wave D 6 项失败**全部为假阴性**——2 项是断言字符串错误（泳道名、304 状态码），4 项是选择器/步骤脆弱性。特色交互真实存在于页面。

### 3.3 Wave E（`demo-audit: run + schemes` 失败 + 503）—— **真实环境限制，非前端缺失**

- **503 精确溯源**：我拦截了分析请求的响应，证据完整：
  - 请求：`POST http://127.0.0.1:5173/api/v1/demo/audit`
  - 状态：**503**
  - 响应体：`{"success":false,"error":{"code":"LLM_KEY_NOT_CONFIGURED","message":"尚未配置 API Key，请在后端 .env 中设置 LLM_API_KEY。"},"request_id":"req-6dc5876a3432"}`
  - 页面 DOM 显示 `ErrorState`："请求未成功 / 尚未配置 API Key… LLM_KEY_NOT_CONFIGURED / 重试"。
  - 同步直连后端 `POST /api/v1/demo/audit` 亦返回同一 503（request_id `req-4069a9a7c099`），确认 503 来自 **backend `LLM_KEY_NOT_CONFIGURED`**，不是前端 bug、不是网络中断。
- **"方案切换"为何点不到**：源码 `DemoAuditPage.tsx:342-355` 的三个方案 tab（`方案一 · 结构化参数抽取` / `方案二 · 参数一致性比对` / `方案三 · 风险与证据`）**确实存在**，但它们位于 `{mutation.isSuccess && result && (...)}` 分支内（`:303`）。分析 503 → 无 result → tab 不渲染 → 历史脚本 `clickText('方案二')` 报 "click target not found"。**功能已实现，只是被环境失败挡住不可达**，属于"环境缺少 LLM Key"，不是"特色交互没实现"。
- **附带历史问题复核**：Wave E 报告另记 `model-mobile` 横向溢出 `sw=738 > iw=390`。我在本次全量巡检与聚焦复核中两次访问 `/settings/models`（390×844），均得 `sw=390, iw=390, body=390`，**溢出不再复现**（`hist.waveE.modelMobileOverflow.pass = true`），推断为早前布局版本或临时状态所致。
- **结论**：此项是**唯一真实的未通过交互**，但根因是环境未配置 `LLM_API_KEY`。补齐密钥后即可验证完整链路；前端代码本身无缺失。

---

## 4. 专项断言证据

### 4.1 音乐图标断言 —— **通过**

`/` 工作台差异监控入口（`EntryLauncher` 的 diff 项）渲染自定义偏差波形 SVG：
- `.rc-app--diff svg` 存在，`path` 数 = **3**，与 `components/Icon.tsx:240-266` 的 `DeviationWave` 定义一致：
  1. 参考轨迹 `M3 8.5c3.4 0 4.8-2.6 8-2.6 3.4 0 4.6 2.6 10 2.6`
  2. 实测轨迹 `M3 15.5c3.4 0 4.8 2.6 8 2.6 3.4 0 4.6-2.6 10-2.6`
  3. 偏差菱形 `M12 10.4 13.6 12 12 13.6 10.4 12Z`
- 全站 DOM 与已加载 CSS 规则中：`Music2`/`music2` 类 = 0 命中；粉色 `#ff6b9a`/`rgb(255,107,154)` = 0 命中（源码 grep 亦 0 命中）。
- 截图证据：`v2-final-01-中央工作台-desktop.png`（圆盘右下角蓝色高亮波形图标）。

### 4.2 双皮肤断言 —— **通过**

皮肤通过页面级 `data-rc-skin="light"` 属性切换（非 `body` 层）：
- `/`（深色工作台）：无 `data-rc-skin` 属性，内容容器背景 `rgb(8, 4, 15)`。
- `/orgs`（浅色档案室）：`.rcw-page[data-rc-skin="light"]`，计算背景 `rgb(246, 240, 251)`。
- `/projects/{PID}/reproduction/reports`（报告中心，浅色）：`data-rc-skin="light"`。
- 证据：`v2-final-recheck.json → dualSkin.pass = true`。

### 4.3 Bloom 墨绿归零断言 —— **通过**

- 扫描 `src/bloom/bloom.css` + `atelier.css` + `loom.css` 中全部 6 位 hex 颜色，按 `g > 100 && g > r*1.25 && g > b*1.15` 判定"墨绿"：`greenHexHits = []`。
- 光晕已收敛到 `--rc-glow-violet`（`hasVioletGlow = true`）；`bloom.css` 注释明确"Bloom 舞台保持自带深色（不加 data-rc-skin='light'）"。
- 证据：`v2-final-report.json → assertions.bloomInkGreen.pass = true`。

---

## 5. 后端回归测试

命令（项目根 backend/ 下）：
```
.venv/Scripts/python.exe -m pytest app/tests/test_production_safety.py app/tests/test_verification_layers.py app/tests/test_stage6_auth.py -q --basetemp=.pytest_tmp_final_qa -p no:cacheprovider
```

结果：`30 passed, 4 warnings in 18.45s`。

- `test_production_safety.py` / `test_verification_layers.py` / `test_stage6_auth.py` 三文件全绿。
- warnings 均为既有无害项：`pydantic Field name "schema" shadows BaseModel attribute`（2 条）、FastAPI `on_event` 弃用（2 条），非本次回归引入。
- 结论：原业务未被 UI 改造破坏。

---

## 6. 未通过项与原因（不掩饰、不猜测）

### 6.1 唯一真实未通过项

| 项 | 现象 | 根因 | 归属 | 建议 |
|---|---|---|---|---|
| `/demo/audit` 运行 + 方案切换 | 点击"开始分析"返回 503，页面显示 `LLM_KEY_NOT_CONFIGURED`，三个方案 tab 不渲染，无法切换 | 后端 `.env` 未配置 `LLM_API_KEY`（`POST /api/v1/demo/audit` 直连复现同一 503） | **环境配置**，非前端代码缺陷 | 在 `backend/.env` 配置可用 `LLM_API_KEY` 后重跑 `node scripts/verify_wave_e.mjs` 的 `demo-audit: run + schemes` |

### 6.2 验证脚本自身的假阴性（已澄清，非产品问题）

| 项 | 初判 | 澄清证据 |
|---|---|---|
| 第 1/2/41 页 `FAIL-RENDER` | `textLen=20 < 30` 阈值 | 聚焦复核：`/` 为 canvas 工作台（canvas=1，圆盘 9 入口，diff SVG 3 paths），截图可见完整 UI；`/login` 已登录时重定向到 `/`，无痕上下文可渲染登录表单（`loginFresh.pass=true`）；兜底路由确实 `location.pathname === '/'`（canvas=1）。 |
| 双皮肤初判 `false` | 比较 `body` 背景（两者均 `rgb(8,4,15)`） | 皮肤在页面级 `data-rc-skin` 而非 `body`；复核 `dark=null` vs `light=light`，背景 `rgb(8,4,15)` vs `rgb(246,240,251)`，通过。 |
| Wave D `feedback:lanes` `false` | 断言找"待分诊/处理中/已解决" | 实际泳道名为"待处理/已分诊/已解决/有争议"，DOM 快照与筛选交互均正常，通过。 |
| Wave D `mobile` `false` | 断言要求 `http === 200` | 全部 304 为缓存命中；禁缓存后三次均 200，通过。 |

### 6.3 N/A 项（符合规范口径，非失败）

- 第 40 页 `DashboardPage.tsx`：历史未挂载页，`App.tsx` 无路由，仅源码存在。
- B6 `ProjectConstellation.tsx`：仅被未挂载的 `DashboardPage` 引用，无独立可访问路由。

---

## 7. 复现方式

```bash
# 全量巡检（约 5.5 分钟，生成 94 张截图 + v2-final-report.json）
cd frontend && node scripts/v2-final-verify.mjs

# 聚焦复核（澄清 canvas/皮肤/泳道/缓存等启发式误判）
cd frontend && node scripts/v2-final-recheck.mjs

# 后端回归
cd backend && .venv/Scripts/python.exe -m pytest app/tests/test_production_safety.py app/tests/test_verification_layers.py app/tests/test_stage6_auth.py -q --basetemp=.pytest_tmp_final_qa -p no:cacheprovider
```

**服务状态记录**：本次验收期间 frontend（`:5173`）与 backend（`:8000`）全程可用，未发生服务中断；`/docs` 与 `/api/v1/projects` 均 HTTP 200。唯一控制台错误为上述预期 503。

---

## 8. FPS 抽样（任务 #9 补充）

脚本：`frontend/scripts/v2-final-fps.mjs`；原始数据 `.screenshots/v2-final-fps.json`。

> **口径说明**：headless Edge 以 `--disable-gpu` 运行，canvas 为纯 CPU 渲染，以下为 rAF 参考帧率，**不能等同真机 GPU 帧率**，仅用于相对比较与异常发现。

| 场景 | 帧数 / 2s | 参考 FPS | 结论 |
|---|---|---|---|
| 工作台 canvas 待机动画 | 46 / 2.05s | 22.5 | CPU 渲染偏低，真机需复测 |
| Bloom 瓣卡展开动画（点击触发） | 14 / 2.01s | **7** | ⚠ 明显偏低，见下 |
| EvidenceLoom 织机动画 | 122 / 2.02s | 60.5 | 正常 |
| 结果对照透视卡动画 | 115 / 2.02s | 57 | 正常 |

**补充对照**：同一 Bloom 舞台**不点击、纯待机**基线为 **57.5 FPS**，说明舞台本身动画帧率正常；**7 FPS 出现在瓣卡展开交互期间**，可能是展开后详情面板重渲染或路由跳转在 CPU 渲染下的开销。建议在启用 GPU 的真机上对该交互复测，若仍明显掉帧则需优化。

---

## 9. 验收后新增回归与恢复记录（诚实记录）

- **15:17 发现**：全站整体 500，`/login` 的 `#root` 为空。定位为 `src/workbench/FoldFieldCanvas.tsx` 中 `const vignette` 重复声明（217 行与 231 行），Vite 报 `Identifier 'vignette' has already been declared`，`tsc --noEmit` 报两条 `TS2451`。该文件 mtime 为 23:14，晚于我 15:09 完成的全量验收——属其他成员并发改动引入，非我验收时的代码状态。
- **处置**：按纪律我未改业务代码，立即向 team-lead 报告阻塞（含精确错误与修复建议）。
- **15:20 复核**：`tsc --noEmit` 已无错误，`FoldFieldCanvas.tsx` 资源 HTTP 200，回归被对应工程师修复。FPS 抽样在修复后重跑成功。
- **影响**：§0–§7 的验收结论对应修复前代码状态；修复仅删除重复声明，不改变页面行为，且修复后我成功完成 FPS 抽样（需登录并访问 4 个页面，均正常），可视为冒烟通过。若需对修复后 HEAD 重新出全量 94 张截图，请指示。

---

**报告完毕。总体判定：41 页 + 8 舞台中，所有可访问项真实可渲染；唯一未通过交互由环境缺少 LLM Key 引起，需主理人配置后复验。验收后曾出现一次并发改动回归，已由团队修复并冒烟确认。**
