# 第四阶段测试报告（TEST_REPORT_STAGE4）

生成时间：2026-11-17
原则：**只记录真实执行过的测试**，不编造通过率/准确率/性能；不通过或未执行项如实列出。

## 1. 环境事实（实测）

- Git：原无仓库，本阶段初始化并建立 `stage4/reproduction-engine` 分支，基线提交 `01c878c`；
- 后端：Python 3.13 + FastAPI，测试用内存 SQLite；
- 前端：Node 22 / npm 10；
- **无 docker / podman**（实测 NOT FOUND）；**无可用 LLM API Key**（LLM_API_KEY=EMPTY，OPENAI_API_KEY 为失效占位）。

## 2. 自动化测试结果

命令：`cd backend && .venv/Scripts/python -m pytest app/tests/ -q`
结果：**76 passed, 3 warnings in 3.11s**（0 失败）。

| 测试文件 | 通过数 | 说明 |
|---|---|---|
| test_stage4.py | 20 | 规划/DAG/可行性/安全/对照/质量/诊断/报告 |
| test_stage4_api.py | 4 | HTTP 层：无 Key 失败、沙箱禁用、质量聚合、报告导出、人工任务 |
| 前序六文件（一/二阶段） | 52 | 回归，确认无功能倒退 |

warnings：FastAPI on_event 弃用（2）、fitz 弃用（1），不影响功能。

## 3. 专项场景对照（任务书第九部分 20 场景）

| # | 场景 | 状态 | 证据 |
|---|---|---|---|
| 1 | 材料完整/环境正确/代码可运行 | ⚠️ 部分 | 静态检查与规划已测；**真实执行未做**（无安全沙箱） |
| 2 | 缺数据集正确阻断 | ✅ | `test_feasibility_missing_material_not_blame_researcher` |
| 3 | 缺依赖识别环境不完整 | ✅ | `test_env_detector`（missing 检测） |
| 4 | 依赖版本冲突诊断 | ⚠️ | 接口+无 Key 失败已测；**真实 AI 诊断未做** |
| 5 | 启动命令错误捕获日志 | ⚠️ | 日志接口已测；无执行故无真实错误日志 |
| 6 | 运行超时终止 | ⚠️ | 配置项存在；无执行故未测真实超时终止 |
| 7 | GPU 不可用报告硬件限制 | ✅ | EnvDetector.hardware 静态检测 |
| 8 | 运行成功结果不一致识别差异 | ✅ | `test_metric_comparator_verdicts`（significant_deviation） |
| 9 | 参数变化可追溯 | ✅ | 第二阶段 fact revisions + 报告参数来源 |
| 10 | 多次运行结果统计差异 | ⚠️ | 扩展点；当前单次运行，无统计依据不输出置信区间 |
| 11 | AI 调用失败不伪造 | ✅ | `test_api_no_key_plan_and_diagnosis`（503，零落库） |
| 12 | AI 输出格式错误处理 | ✅ | `test_planner_rejects_cycle_from_ai` + LLM 适配层修复测试 |
| 13 | 用户取消保存记录 | ✅ | `ExecutionSandbox.cancel`（终态 + note，明确无进程） |
| 14 | 恶意压缩包不逃逸 | ✅ | 第二阶段 ZIP 测试 + 本阶段静态扫描 |
| 15 | 恶意脚本不访问宿主机 | ✅ | `test_security_preflight_detects_dangerous_script` |
| 16 | 无授权网络访问阻断 | ✅ | 云元数据/内网地址正则检测测试 |
| 17 | 不能访问其他项目运行 | ✅ | FailureDiagnoser project_id 校验（FORBIDDEN） |
| 18 | 刷新恢复状态 | ✅ | DB 持久化 + GET 状态接口；前端轮询真实接口 |
| 19 | PDF 与实际记录一致 | ⚠️ | 报告由 DB 聚合（14 章已测）；**PDF 不可用返回 501，未伪造** |
| 20 | 证据引用定位 | ✅ | 报告每章 sources 指向真实记录 ID |

**未通过/未执行项**：场景 1/4/5/6/10/19 的真实执行或真实 AI 部分，因无安全容器与无 API Key 未执行，全部在上表用 ⚠️ 标注，不伪造通过记录。

## 4. API 真实 HTTP 冒烟（uvicorn + curl）

| 接口 | 实测 |
|---|---|
| GET /openapi.json | 40 条路径（21 条第四阶段 reproduction 接口） |
| POST /reproductions/plans（无 Key） | 503 + LLM_KEY_NOT_CONFIGURED，零规划落库 |
| POST /reproductions/diagnostics（无 Key） | 503 + LLM_KEY_NOT_CONFIGURED |
| GET /reproductions/quality（空项目） | overall=0.05，7 维度，真实 DB 聚合，未编造高分 |
| POST /reproductions/runs | status=blocked_no_sandbox，execution_enabled=false |
| POST /reproductions/reports | 14 章 HTML 生成成功；PDF 不可用如实标注 |

## 5. 前端

（前端子代理完成后补：tsc/build 结果。）

## 6. 真实 API 调用与代码执行

**均未发生**：
- 无真实模型调用（无 Key）——AI 规划/诊断逻辑用协议级 mock 验证，不伪造结果；
- 无用户代码执行（无安全容器）——所有运行请求明确 `blocked_no_sandbox`；
- 真实抽取 P/R/F1、执行成功率等指标**无法计算**，不编造。

## 7. 已知问题

1. `weasyprint` 未安装，PDF 导出不可用（501，已如实标注）；
2. 同步任务无真正的后台队列与实时取消（执行禁用时无进程，取消仅记录状态）；
3. 资源限制清单为配置设计，未经真实容器验证；
4. 第三阶段缺失，规划中的"审计发现"来自适配层的既有数据视图，非第三阶段引擎。
