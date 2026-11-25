# BUG_TRACKER · 缺陷台账

> 规则：每条缺陷必须有真实证据；未复现的推测不进台账。
> 严重度：**P0** 生产数据泄露/破坏、核心流程完全不可用；**P1** 关键权限/核心链路/主要界面失效；**P2** 体验、口径、文档与测试缺口；**P3** 卫生与告警。
> 本轮环境为本地开发模式；标注「生产为 P0」的条目在 `STRICT_PRODUCTION=1` + 正确环境变量下会被阻断，但当前默认配置不安全。

| ID | 严重度 | 模块 | 标题 | 状态 | 证据 |
|---|---|---|---|---|---|
| BUG-2026-11-001 | **P1（生产 P0）** | 鉴权/项目隔离 | 匿名可读全部项目、材料、解析任务并下载材料 | Open | `reports/api-audit.json` probes `anon.*` |
| BUG-2026-11-002 | **P1（生产 P0）** | 材料写入 | 匿名可上传材料、删除任意材料 | Open | `api-audit.json` `anon.upload`；补充探针 `anon.delete` |
| BUG-2026-11-003 | **P1** | RBAC | `viewer` 只读角色可上传材料；25 个写端点未校验业务权限 | Open | `viewer.upload_non_member` 404 对照；`viewer.upload` 200 |
| BUG-2026-11-004 | **P1** | 材料详情 UI | 1440×900 下抽屉操作栏落到视口外，需滚动页面才可达 | Open | `screens/12-material-drawer-1440.png`、`13-material-drawer-scrolled.png` |
| BUG-2026-11-005 | P2 | 材料/解析状态 | 材料卡显示「已完成」，实际 AI 抽取为部分完成、0 事实 | Open | `02-materials-uploaded.png` 与 `14-parse-task-partial.png` |
| BUG-2026-11-006 | P2 | 文档/验收 | 测试基线过期且安全验收结论与实测不符 | Open | README 205 / commit 219 / 实测 359；stage10 报告称无 token 401，实测匿名 200 |
| BUG-2026-11-007 | P2 | 测试体系 | 前端无自动化回归套件，仅临时 Playwright 脚本 | Open | `frontend/package.json` 无 test 脚本；本轮 1 条手工走查 |
| BUG-2026-11-008 | P3 | 测试告警 | `pytest` 出现 coroutine `aclose` never awaited 警告 | Open | `359 passed, 6 warnings`，`test_modelhub.py` |
| BUG-2026-11-009 | P3 | 仓库卫生 | 根库 `reprocheck.db` 与活动库并存；241 条未提交条目 | Open | `PROJECT_MAP.md` §1 |

---

## BUG-2026-11-001 · 匿名读取全量数据

**复现**

```http
GET /api/v1/projects                     → 200, total=15
GET /api/v1/materials?project_id=proj-209c77cd39f94212 → 200, total=2
GET /api/v1/parse-tasks?project_id=proj-209c77cd39f94212 → 200, total=2
GET /api/v1/materials/{id}/download       → 200, 486 bytes
```

**根因**

- `settings.allow_unauth_test_endpoints=True`（默认）。
- `api/isolation.py:90-93` 在 `user is None` 且开关为真时直接 `return`，不校验项目归属。
- `projects.py:45`、`materials.py:49`、`parse_tasks.py:131` 等读接口本身没有 `get_current_user`。

**影响**

任何能访问 8000 端口的人（同机、局域网、误暴露公网）可枚举项目名称、论文标题、描述、owner/org id、材料文件名、解析状态，并下载原始材料。属于数据泄露，不只是“演示便利”。

**修复建议**

1. 生产启动强制 `STRICT_PRODUCTION=1` 且 `ALLOW_UNAUTH_TEST_ENDPOINTS=false`；当前 `.env` 缺失，无法保证。
2. 将匿名放行收敛为显式 demo 路由（只允许固定 demo 项目、只读、限流），不要全局 `return`。
3. 读接口加 `get_current_user`，再走 `resolve_project_access`。
4. 回归：未登录访问上述 4 个请求必须 401；演示账号只能看到自己项目。

**责任方**：后端认证/隔离负责人。QA 不代改。

---

## BUG-2026-11-002 · 匿名上传与删除材料

**复现**

1. `POST /api/v1/materials/upload`（无 Authorization）`project_id=proj-85fc20129a03495f`，文件 `qa-anon-probe.txt` → **200**，返回 `mat-f7b40eec57274e69`。
2. `DELETE /api/v1/materials/mat-c0a107aebf6e41fe`（无 Authorization）→ **200** `{"deleted": true}`。

**根因**

- `materials.py:32/117` 使用 `dependencies=[Depends(require_admin)]`。
- `deps.require_admin` 在 `allow_unauth_test_endpoints=True` 且无 token 时直接放行（`deps.py:64-79`）。
- 上传/删除均未调用 `resolve_project_access`，不校验项目成员。

**影响**

匿名者可向任意项目写文件、删除任意材料（含他人未备份数据），且删除会级联 chunks/facts。属于完整性/可用性破坏风险。

**修复建议**

- 上传/删除改用 `require_write_user` + `resolve_project_access(min_rank=2)`（researcher+），并校验 `material.upload` / `material.delete`。
- 删除前记录审计轨迹（当前 `MaterialService.delete` 未见 project 归属校验）。
- 回归：匿名 401；viewer 403；非成员 404。

---

## BUG-2026-11-003 · viewer 可执行写操作

**复现**

- 登录 `viewer@reprocheck.demo`（只读角色，`ROLES["viewer"]` 权限列表为空）。
- `POST /materials/upload` 到演示项目 → **200**，生成 `mat-c0a107aebf6e41fe`。
- 随后匿名 DELETE 该材料 → 200（同时验证 BUG-002）。

**根因**

`require_admin` 的语义是「任意已登录用户」，不是「管理员」。全仓 25 处使用：

| 文件 | 次数 |
|---|---|
| `reproductions.py` | 9 |
| `parse_tasks.py` | 7 |
| `materials.py` | 3 |
| `demo.py` | 2 |
| `facts.py` | 2 |
| `llm.py` | 2 |

包括上传、解析、重试、恢复、事实修订、运行创建/取消、报告生成、LLM 测试。

**影响**

只读成员可改数据、触发昂贵解析、生成报告；与 `ROLE_PERMISSION_MATRIX.md`、`rbac.py` 的权限声明不一致。

**修复建议**

- 按业务改用 `require_permission("material.upload" / "audit.run" / "report.generate" / ...)`。
- `require_admin` 只保留给真正管理员或删除；不要把「已登录」当「有权限」。
- 增加角色矩阵回归：viewer 对所有写端点 403；reviewer 不能上传；researcher 不能删项目。

---

## BUG-2026-11-004 · 材料抽屉操作栏越界

**复现（1440×900，Edge）**

1. 打开 `/projects/{id}/materials`。
2. 点击 `sample.pdf` 卡片展开详情。
3. 等待 6s，读取布局：

| 元素 | 实测 |
|---|---|
| `.mb-drawer`（position: fixed; inset: 0） | x=24, y=88, w=1392, h=**1095**, bottom=**1183** |
| `.mb-drawer__panel` | y=88, h=1095, bottom=1183 |
| `.mb-drawer__foot`（解析/下载/删除/打开完整详情） | y=**1110**, bottom=**1183** |
| 视口 | 1440×900 |

4. 页面需 `scrollTo(0, 307)` 后 footer 才到 y=803；滚动时整个“固定”抽屉随页面移动，scrim 从 y=88 起、不覆盖 64px 顶栏。

**根因**

`.mb-page` 的计算样式为 `transform: matrix(1,0,0,1,0,0)`（identity 但仍是 transform）。CSS 规范下，祖先有 transform 时 `position: fixed` 相对该祖先而不是视口，导致 `inset:0` 撑成 `.mb-page` 的内容高度 1095，而不是视口 900。

**影响**

- 首次打开详情时，解析/下载/删除/完整详情四个操作不可见；用户可能以为功能缺失。
- 键盘/读屏用户需要先滚动页面才能到操作栏，模态语义被破坏。
- 与 `aria-modal="true"` 的承诺不一致。

**修复建议**

- 去掉页面级 identity transform（或改用 `translate` 动画结束后的 `transform: none`）。
- 更稳妥：用 `createPortal` 把抽屉挂到 `body`，`height: 100dvh`，并锁定 body 滚动。
- 回归：1440×900、1180×820、390×844 三档断言 footer bottom ≤ viewport height。

---

## BUG-2026-11-005 · 材料状态与抽取结果语义不一致

**复现**

- 材料卡：`sample.pdf` → 绿色「已完成」、`16 块 / 0 事实`。
- 同一材料的解析任务页：`partially_completed` + 「解析完成，AI 抽取跳过（未配置 API Key 或未授权）」+ 错误码 `LLM_NOT_CONFIGURED`。
- 详情抽屉只显示「该材料尚未抽取到科研事实」，不显示跳过原因。

**影响**

用户会误以为论文里没有事实，而不是“AI 未配置”；对审计结论的可信度有直接影响。

**修复建议**

- 材料卡状态按最新 parse task 聚合：`completed`（解析+抽取全成）/ `partially_completed`（解析成、抽取跳过）/ `failed`。
- 详情与空态直接展示原因与下一步（配置 Key 的链接）。

---

## BUG-2026-11-006 · 文档与验收口径漂移

| 文档 | 原文 | 实测 |
|---|---|---|
| `README.md:7` | 后端 205 项测试 | 359 |
| `README.md:120` | 当前基线 205 passed | 359 |
| commit `f2a7ce8` | 219/219 pytest pass | 359 |
| `docs/stage10/09_SECURITY_TEST_REPORT.md:32` | 无 token 访问 401 | `GET /projects` 匿名 200，15 条 |
| 同文件 :23 | 跨用户隔离 10/10 | 已登录隔离成立；匿名可绕过 |

**影响**：验收结论不可直接复用，发布说明会误导。

**修复建议**：以本档案实测数为准更新 README/阶段报告；把“开发模式匿名放行”写成显式前提，不再写“无 token 401”。

---

## BUG-2026-11-007 · 前端自动化测试缺失

- `frontend/package.json` 无 `test`/`e2e` 脚本；仅 `typecheck` + `build`。
- 本轮只有 1 条临时 Playwright 走查（`quality/tools/user_journey.mjs`），不是可入库的回归套件。
- 39 条路由、材料抽屉、权限按钮、报告页均无自动断言。

**建议**：建 `frontend/tests/e2e`，至少覆盖登录、项目创建、4 类材料上传、解析状态、抽屉 footer 可见性、viewer 隐藏写按钮、报告生成；接入 `npm run test:e2e`。

---

## BUG-2026-11-008 · pytest 资源告警

`359 passed, 6 warnings` 中包含：

```text
RuntimeWarning: coroutine method 'aclose' of 'Response.aiter_lines' was never awaited
  test_modelhub.py::test_openai_compatible_stream_and_model_list
FutureWarning: The `fitz` API is deprecated ...
```

**影响**：当前不影响用例结果；但流式响应未关闭可能在真实长连接下泄漏连接。建议在 mock/适配器里显式 `aclose()`，并把 PyMuPDF 导入改为 `pymupdf`。

---

## BUG-2026-11-009 · 仓库卫生

- 根 `reprocheck.db` 1.66 MB，projects=0；活动库 `backend/reprocheck.db` 2.03 MB、projects=15。路径取决于进程 cwd，易误连旧库。
- 审计开始时 241 条未提交/未跟踪条目（frontend 131、backend 66、docs 20、Plan 10）。无法给出一个可复现的“发布 commit”。

**建议**：删除/归档根库并在 README 写明活动库路径；发布前收敛未提交变更、打 tag。
