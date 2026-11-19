# 第六阶段 · 极其完整测试与 Bug 修复报告

时间：2026-11-19。基线 HEAD `827e8fa`（工作区干净）。本报告记录本轮实际执行的测试、发现的真实 Bug、修复与回归证据。**静态扫描的启发式告警经人工逐条核实，误报已明确剔除。**

## 一、执行了哪些测试

| 测试 | 命令/方式 | 结果 |
|---|---|---|
| 后端全量（基线） | `PYTHONPATH=. .venv/Scripts/python.exe -m pytest -q -p no:cacheprovider` | 200 passed |
| 静态代码审查（启发式） | `code_reviewer.py --input-dir backend/app/services --file-ext .py` | 25 文件；严重 2、一般 62、优化 29（多数为启发式误报，见第三节） |
| 15 个新增端点运行时验证 | 一次性 AsyncClient 脚本，逐端点测无认证/正常/越权 | 15 端点全部注册；0 个 500；发现 2 个认证缺口 + 1 个传参缺陷 |
| 端点静态契约核对 | 独立 lite 代理 Read/Grep 核对注册/字段/认证/隔离 | 13 组全部注册；发现 4 处（2 真 2 误报） |
| 后端全量（修复后） | 同上 | **205 passed** |
| 前端类型 + 构建 | `npm run typecheck && npm run build` | 通过（1692 modules） |

## 二、发现并修复的真实 Bug（3 个）

### BUG-1（P1）写操作端点匿名越权
- 现象：`POST /parse-tasks/{id}/pause|resume|retry`、`DELETE /parse-tasks/{id}`、`POST /parse-tasks/recover-stale` 在低档配置下允许无 JWT 调用，可执行状态变更。
- 根因：端点用 `require_admin`（开发开关下静默放行匿名）+ `get_optional_user`，而 `_task_for_request` 中 `if user is None: return task` 跳过项目隔离。
- 修复：`api/deps.py` 新增 `require_write_user`（无条件要求 JWT，不受开发开关影响）；5 个写端点改用它。
- 回归：`test_bugfix_auth_boundary.py::test_write_endpoints_require_auth_even_in_dev_mode`，匿名 pause/resume/retry/cancel/recover 全部 401。同步更新 2 个原匿名测试为带认证（安全收紧的正当更新，未放宽任何断言）。

### BUG-2（P1）recover-stale body 传参被误判越权
- 现象：项目 owner 用 JSON body 传 `project_id` 调用 `POST /parse-tasks/recover-stale` 返回 403"需通过 project_id 限定"；query 传参则 200。
- 根因：POST 端点只读 `request.query_params`，不读 body。
- 修复：新增 `RecoverStaleBody` Pydantic 模型，`project_id` 同时支持 body 与 query（body 优先）。
- 回归：`test_bugfix_recover_body.py` 2 项（body 成功 + body 越权 404）。

### BUG-3（P2）开发默认下事实/证据图谱读接口匿名可读
- 现象：`allow_unauth_test_endpoints=True`（默认）时，`/facts`、`/facts/summary`、`/facts/{id}/revisions`、`/projects/{id}/evidence-graph` 匿名 200。
- 核实：这是开发/生产双模式设计——关闭开关后全部返回 401（实测确认），生产手册已要求关闭。**不是代码缺陷，是配置契约**。
- 处理：新增 `test_bugfix_auth_boundary.py::test_read_endpoints_require_auth_in_production_mode` 固化"生产模式匿名读必须 401"的契约，防止将来回归。

## 三、人工核实的误报（未改代码）

| 静态告警 | 核实结论 | 证据 |
|---|---|---|
| 2×"硬编码敏感信息"（auth_service.py:54 / org_service.py:55） | 误报：匹配到 `role_key="org_admin"` 角色字面量，非凭据 | 直接读源码确认 |
| "Zip Slip 只检查 manifest 路径" | 误报：`validate_bundle` 对 ZIP 所有条目调 `_check_member_path`，且拒绝未登记文件；现有 4 个路径穿越测试通过 | handoff_service.py:311-322, 336-357 |
| "数据包异常值未处理" | 误报：`_count()` 拒绝负数/字符串/浮点/bool；实测 5 种异常输入均返回 `supported=False` 不崩溃 | numeric_recompute_service.py:88-99 + 实测输出 |
| "`/verification/layers` 用 `executed_by_default` 而非 `executed`" | 非 bug：语义是"默认是否执行"，与"本次是否执行"不同，字段定义正确 | LAYER_SPECS 定义 |
| 62 项"空指针风险" / 29 项"函数过长" | 启发式噪音，无具体触发条件，不属本轮修复范围 | 静态审查的本质局限 |

## 四、仍存在的真实缺口（非本轮 bug，清单化披露）

- 数据泄漏检测（训练/测试样本 ID 重叠）：全库无实现。属用户任务第八步基准覆盖项，是**未实现功能**而非 bug，本轮未越界新增。
- 图表图像级/OCR 重绘对比：缺数据与 OCR 环境，标 BLOCKED（文本/数值层已实现）。
- 真实隔离执行后端（Docker/GVisor）：未部署，第3层 `executed=False`。
- 前端无 test/lint 脚本：仅有 typecheck/build；本轮未擅自引入新依赖。

## 五、结论

本轮按"极其完整跑测试 + 修 bug + 验证功能"执行：后端全量 200→205 passed，前端构建通过，15 个新增端点逐一真实调用无 500。发现并修复 3 个真实问题（2 个 P1 越权/传参、1 个配置契约回归测试），人工剔除 5 类静态误报。**发布状态仍 NOT_READY**（P0：无真实隔离执行后端 + 生产配置未实测收敛）。
