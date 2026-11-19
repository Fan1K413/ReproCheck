# 第六阶段独立验收报告（普通科研人员视角 · 只读）

- 验收人：独立验收测试员（verifier），**未参与本阶段任何业务代码修改**
- 验收时间：2026-11-19
- 项目根：`C:/Users/ASUS/Desktop/科研复现审计官`
- 报告性质：只读验收。临时探针脚本 `backend/_acceptance_probe.py` 与结果 `backend/_acceptance_result.json` 跑完后即删除，**未改动任何业务代码**。

---

## 一、验收方法与环境

| 项目 | 内容 |
|---|---|
| 调用方式 | 真实 FastAPI `app` + `httpx.AsyncClient(transport=ASGITransport(app=app))`，全部断言基于真实 HTTP 响应（status code + response body） |
| 数据库 | 内存 SQLite（`sqlite+aiosqlite:///:memory:`），`Base.metadata.create_all`，`app.dependency_overrides[get_db]` 指向同一 engine/sessionmaker |
| 认证 | 真实注册用户 + 真实 JWT（`Authorization: Bearer <token>`）；关闭 `allow_unauth_test_endpoints`，强制后端鉴权与项目隔离 |
| LLM | **协议级 mock LLM**（`httpx.MockTransport`，参考 `test_stage2_api.py` 的 `_mk` / `extract_payload`），仅验证程序链路；**未连接任何真实模型服务** |
| 复现执行 | `enable_code_execution=False`（本环境无 Rootless Docker/gVisor），run 真实状态为 `blocked_no_sandbox` |
| 证据留存 | 每步均记录 request_id、status code 与关键响应字段，见下文「证据」列 |

> 重要区分：**协议级 mock LLM（测试用）≠ 真实模型已验证**。凡依赖真实模型能力（事实抽取质量、复现规划质量、五篇论文实战）均标为 BLOCKED，不伪造通过。

---

## 二、15 步逐步验收结果

汇总：**PASS 17 项（含子步骤）/ FAIL 1 项 / BLOCKED 2 项**；15 个主步骤全部 PASS。

### 步骤 1 ～ 5：身份 → 项目 → 材料 → 解析 → 事实

| 步骤 | 预期 | 实际 | 证据（真实 HTTP） | 结论 |
|---|---|---|---|---|
| 1 注册 + 登录拿 JWT | `POST /auth/register`、`/auth/login` 均 200，返回 JWT | register=200，login=200，拿到 token，用户 `researcher@example.com`（id=`user-c6c74e51c1f8451e`） | register 200 `{"success":true,"data":{"token":"eyJ...","user":{...}}}`, request_id=`req-…`；login 200，同 token 语义 | **PASS** |
| 1.1 JWT 鉴权自证 | `GET /auth/me` 200，含组织信息 | 200，orgs=1（注册自动建个人组织 `org_admin`） | 200 `{"organizations":[{"id":"org-…","role_key":"org_admin"}]}` | **PASS** |
| 2 创建科研项目（Bearer） | `POST /projects` 200，返回 project_id，owner 为当前用户 | 200，`project_id=proj-f2a937a89b8b4bc4`，owner=`user-c6c74e51c1f8451e` | 200 `{"id":"proj-f2a937a89b8b4bc4","owner_user_id":"user-c6c74e51c1f8451e","org_id":"org-…"}` | **PASS** |
| 3 上传 TXT 材料（含 "Learning Rate 0.001, Batch Size 64"） | `POST /materials/upload` 200，`parse_status=uploaded` | 200，`material_id=mat-c3f3e2fc5d294443`，`parse_status=uploaded`，size=79，sha256 落库 | 200 `{"material_id":"mat-c3f3e2fc5d294443","parse_status":"uploaded","sha256":"3a260076…"}` | **PASS** |
| 4 协议级 mock LLM 解析生成事实 | `POST /materials/{id}/parse` 200，status=completed，model_calls=1，prompt 含 chunk_id | 200，status=completed，model_calls=1，total_tokens=180，chunk_id=`rd_mat-c3f3e2fc5d294443_001` | 200 `{"status":"completed","model_calls":1,"total_tokens":180,"facts_count":1,"model":"qwen-plus"}`；mock 请求体命中 `chunk_id="…"` | **PASS** |
| 4.1 真实模型连通性 | 真实 LLM Key / 真实模型未验证 | `settings.llm_api_key` 设为 `sk-test` 占位；仅 `httpx.MockTransport` 返回伪造 usage | 无真实网络出向调用；模型=qwen-plus 为 mock 声明 | **BLOCKED** |
| 5 事实列表 + 研究主张/证据 | `GET /facts` 200，含 learning_rate 事实，assertion_type=explicit，extraction_status=supported，evidence.verification_status=verified | 200，total=1，`fact_id=fact-9186d612161b41`，全部字段符合断言 | 200 `{"field_key":"learning_rate","assertion_type":"explicit","extraction_status":"supported","evidence":[{"verification_status":"verified","quote":"Learning Rate 0.001",…}]}` | **PASS** |

### 步骤 6 ～ 10：图谱 → 复现 → pause → 诊断 → 指标

| 步骤 | 预期 | 实际 | 证据（真实 HTTP） | 结论 |
|---|---|---|---|---|
| 6 证据图谱 | `GET /projects/{id}/evidence-graph` 200，有节点和有向边，边端点均合法 | 200，counts=`{facts:1, evidence:1, materials:1, source_chunks:1, edges:3}`，nodes=4，edges=3，edges_valid=true | 200 `{"nodes":[fact/evidence/material/source_chunk],"edges":[supported_by/quotes/located_in],"counts":{…}}` | **PASS** |
| 7.0 无 Key 规划明确拒绝（补测） | `POST /plans` 无 Key → 503 `LLM_KEY_NOT_CONFIGURED`，不生成假规划 | 503，code=`LLM_KEY_NOT_CONFIGURED`，message 明确「未生成任何规划」 | 503 `{"error":{"code":"LLM_KEY_NOT_CONFIGURED","message":"AI 复现规划不可用：尚未配置真实 API Key，未生成任何规划。"}}` | **PASS** |
| 7 复现规划 + 任务 + run | `POST /plans`、`/tasks`、`/runs` 均 200；run.status 是真实状态 | plan=200 (`rplan-a3678712cac84c84`)，task=200 (`rtask-48693725ae1146f5`)，run=200，`run.status=blocked_no_sandbox`，`execution_enabled=false` | 200 run `{"status":"blocked_no_sandbox","execution_enabled":false,"error_message":"ENABLE_CODE_EXECUTION=false：代码执行已被显式禁用","security_check":{"sandbox_available":false}}` | **PASS** |
| 7.1 真实模型规划连通性 | 真实 LLM 规划未验证 | 规划走协议级 mock（返回合法 `ReproductionPlanIn` JSON），未连接真实模型 | mock 规划任务数=1；真实模型规划质量/稳定性未验证 | **BLOCKED** |
| 7.2 无效 Key 报错形态（补测） | 上游 LLM 鉴权失败应映射明确业务错误，HTTP 状态不应与用户 JWT 失效混淆 | **401**，`code=LLM_INVALID_KEY` | 401 `{"error":{"code":"LLM_INVALID_KEY","message":"API Key 无效或已过期，请检查后端 LLM_API_KEY。"}}`（request_id=`req-84e570e2340a`） | **FAIL**（见 Bug P2-1） |
| 8 pause/resume 编排 | 复现 run 无 pause（仅 cancel）；ParseTask pause→paused，resume→queued 且 resume_count+1 | 路由清单 `run_pause_routes=[]`；cancel=200 返回 `cancelled:false`（终态，真实）；pause=200→paused；resume=200→queued，resume_count=1 | 200 `{"status":"paused","paused_at":"…"}`；200 `{"status":"queued","resume_count":1}` | **PASS** |
| 8.1 已完成任务 pause 拒绝（补测） | 对 completed 任务 pause → 409 INVALID_STATE | 409，code=`INVALID_STATE` | 409 `{"error":{"code":"INVALID_STATE","message":"仅排队或执行中的任务可暂停。"}}` | **PASS** |
| 9 确定性诊断（CUDA OOM） | `POST /diagnosis/classify` 200，primary=`hardware_resource_shortage`，候选 `is_confirmed=false` | 200，primary=`hardware_resource_shortage`，confidence=0.75，is_confirmed=false | 200 `{"candidates":[{"category":"hardware_resource_shortage","confidence":0.75,"is_confirmed":false}],"method":"deterministic_rule_v1"}` | **PASS** |
| 10 审计基准指标 P/R/F1 | `POST /benchmark/metrics/compute` 200，P/R/F1=0.33/0.33/0.33，fpr/fnr=0.67/0.67，evidence_acc=1.0，cat_acc=0.5，tp=1/fp=2/fn=2 | 全部精确命中预期值 | 200 `{"precision":0.33,"recall":0.33,"f1":0.33,"false_positive_rate":0.67,"false_negative_rate":0.67,"counts":{"tp":1,"fp":2,"fn":2}}` | **PASS** |

### 步骤 11 ～ 15：导出 → 隔离 → 反馈 → 重启 → 汇总

| 步骤 | 预期 | 实际 | 证据（真实 HTTP） | 结论 |
|---|---|---|---|---|
| 11 导出交接包 ZIP | `POST /projects/{id}/handoff/export` 返回 `application/zip`；解压 manifest 含 `bundle_version`/`generated_at`/`files.*.sha256` | 200，content-type=application/zip，7259 bytes，15 entries；manifest：`bundle_version=1.0`，`generated_at=2026-11-19T07:48:44.789426+00:00`，14 个文件均含 sha256 | 200 headers `content-type: application/zip`；manifest `{"bundle_version":"1.0","generated_at":"…","files":{"README.md":{"sha256":"2c936adc…","size_bytes":412},…}}` | **PASS** |
| 12 非成员导出被拒 | 外部用户 export 同一项目 → 403/404（隐藏存在性），不泄露数据 | 新注册 `outsider@example.com` 导出 → **404** `NOT_FOUND`，无 ZIP 返回 | 404 `{"error":{"code":"NOT_FOUND","message":"项目不存在或无权访问。"}}` | **PASS** |
| 13 提交审计反馈 | `POST /feedback` 200，status=open；普通成员可提交（triage 才需 finding.review） | 200，`feedback_id=fb-ee72e31c36af4cc7`，status=open，user_id=当前用户 | 200 `{"id":"fb-ee72e31c36af4cc7","feedback_type":"confirm","status":"open",…}` | **PASS** |
| 14 重启后历史数据仍在 | 关闭 client 再开新 AsyncClient，沿用同一 engine/factory 重查 facts/graph/parse-tasks，数据不丢失 | facts=200/1，graph=200/nodes=4/edges=3，tasks=200/2；恢复态任务 `(queued, resume_count=1)` 仍在 | 新 client 三次 GET 均 200 且数据与重启前一致 | **PASS** |
| 15 汇总 | 统计 PASS/FAIL/BLOCKED | PASS=17，FAIL=1，BLOCKED=2（20 条验收记录） | 见本报告第二、四、五节 | 统计完成 |

---

## 三、BLOCKED 项（环境限制，不伪造通过）

| 编号 | 能力 | 受阻原因 | 状态 |
|---|---|---|---|
| B-1 | 真实 LLM 事实抽取（步骤 4.1） | 本环境无真实 LLM API Key；仅协议级 mock 验证程序链路，真实抽取质量/幻觉率/中文论文适配未验证 | **BLOCKED** |
| B-2 | 真实 LLM 复现规划（步骤 7.1） | 同上；真实模型输出的规划质量、DAG 合理性、可行性判定未验证 | **BLOCKED** |
| B-3 | 真实代码隔离执行（run） | `enable_code_execution=false`，无 Rootless Docker/gVisor/Firecracker；run 状态真实返回 `blocked_no_sandbox`，未执行任何用户代码 | **BLOCKED（环境限制，系统诚实拒绝）** |
| B-4 | 图表反向验证 / 真实代码隔离执行实战 / 五篇论文实战 | 无真实论文数据、无图表基准集、无安全沙箱；本轮不具备验证条件 | **BLOCKED** |
| B-5 | 真实进程重启持久化 | 按要求用「同一内存 DB engine + 新 AsyncClient」模拟重启；未做跨进程、文件型 SQLite 的真实重启验证 | **部分验证（模拟通过，真实进程未测）** |

---

## 四、Bug 清单（P0 / P1 / P2 分级）

### P0 / P1
**无。** 15 个主流程步骤全部 PASS，未发现数据伪造、越权访问、持久化丢失或核心流程阻断级缺陷。

### P2（低优先级，不影响主流程，建议后续修复）

| 编号 | 描述 | 证据 | 建议 |
|---|---|---|---|
| P2-1 | **上游 LLM 鉴权失败以 HTTP 401 暴露在业务接口，易被误判为用户登录失效。** 当后端配置了无效/过期的 `LLM_API_KEY` 时，`POST /api/v1/reproductions/plans` 返回 HTTP 401 + `LLM_INVALID_KEY`；此时用户自己的 JWT 完全有效。API 客户端若按 401 统一处理，可能错误地清除会话或要求用户重新登录。 | 步骤 7.2：HTTP 401 `{"error":{"code":"LLM_INVALID_KEY","message":"API Key 无效或已过期，请检查后端 LLM_API_KEY。"}}`，request_id=`req-84e570e2340a` | 将服务端 LLM Key 失效映射为 502/503（保留 `LLM_INVALID_KEY` 业务码），与「用户身份 401」区分；或至少在文档中明确该 401 的语义。 |
| P2-2 | **`POST /materials/{id}/parse` 响应中 `material_name` 恒为空字符串。** `parse_tasks.py` 的 `start_parse` 调用 `ok(_view(task))` 时未传入 material_name；而 `GET /parse-tasks/{id}` 传入后显示正常（如 `paper.txt`）。同一任务在「刚解析完」与「随后查询」两个接口展示不一致。 | 步骤 4 响应 `"material_name":""`；步骤 8/14 同一材料的 `GET /parse-tasks/{id}` 响应 `"material_name":"paper.txt"` | 在 `start_parse` 返回前按 `task.material_id` 补全 `material_name`，与列表/详情接口保持一致。 |

---

## 五、总体结论

**结论：在具备真实 LLM Key 的前提下，普通科研人员可以独立完成「注册 → 建项目 → 传材料 → 解析成事实 → 看证据图谱 → 建复现规划/任务/run → 暂停恢复 → 诊断 → 算基准指标 → 导出交接包 → 提交反馈」的核心全流程；本环境因无真实 LLM Key 与无安全沙箱，真实模型环节与真实代码执行环节标为 BLOCKED，未伪造通过。**

具体判断依据：

1. **程序链路完整且诚实**：15 个主步骤全部 PASS；无 Key 时解析/规划明确返回 503，run 在无沙箱时真实返回 `blocked_no_sandbox`，失败诊断一律 `is_confirmed=false`，未发现「把推测包装成确定结论」或伪造成功的行为（步骤 4、7.0、7、9）。
2. **权限与隔离有效**：非项目成员导出被 404 拒绝（步骤 12），关闭匿名放行后所有受保护接口强制 Bearer（步骤 1、1.1、2）；`project_lead` 身份由注册建项目自动获得，普通科研人员无需管理员介入即可开工。
3. **数据可持久化**：同一 DB 模拟重启后 facts/图谱/任务状态均不丢失（步骤 14）。
4. **工程可验证性**：确定性诊断与基准指标为纯规则/纯计算，P/R/F1 数值可精确复算（步骤 9、10）；交接包 manifest 含 bundle_version/generated_at/逐文件 sha256（步骤 11）。
5. **待改进**：2 个 P2 级问题（无效 Key 的 401 语义、`material_name` 空值），均不阻断核心流程，建议排入后续迭代修复。
6. **未能验证的部分（必须诚实声明）**：真实 LLM 抽取与规划质量、真实代码隔离执行、图表反向验证、五篇论文实战——本环境缺少 Key / Docker / 真实数据，均标为 BLOCKED，**不能据此宣称这些能力已通过验收**。

---

*证据来源：临时只读探针 `backend/_acceptance_probe.py` 的真实 HTTP 调用输出（已删除）；结果摘要 `backend/_acceptance_result.json`（已删除）。本报告未修改任何业务代码。*
