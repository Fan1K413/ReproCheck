# ReproCheck 全量代码审查报告

- **审查日期**：2026-11-24
- **审查分支**：`stage9/research-driven-refactor`（基于最近提交 `f2a7ce8` 及当前工作区改动）
- **基线检查**：
  - 前端 TypeScript 检查（`npm run typecheck` / `tsc --noEmit`）：**通过**（`vite build` 在当前沙箱写临时时间戳文件时受 `EPERM` 权限限制未完成）。
  - 后端测试环境：`backend/.venv/pyvenv.cfg` 仍指向旧机器路径（`C:\Users\ASUS\.workbuddy\...`），导致当前机器直接调用 `.venv\Scripts\python.exe` 无法执行 `pytest`，需重建虚拟环境后重跑全量测试。

---

## 问题分布总览

| 严重级别 | 数量 | 主要涉及领域 |
| --- | --- | --- |
| **Critical（严重）** | 5 | 跨租户 IDOR 越权、工作流 DAG 门禁绕过、匿名访问默认放行与生产门禁失效 |
| **High（高危）** | 8 | 请求体限流矛盾、中文文件名下载 500、加密/CORS 配置崩溃或失效、ModelHub 凭据外泄与事务污染、静态预检空跑、核心解析/监控/知识库/补证链路断裂、RBAC 提权、SQLite 长事务锁库 |
| **Medium（中危）** | 6 | 前后端接口契约断层、Bloom 证据织机与引导流死循环、站点模式路由与种子泄密、前端缓存/401/状态串台、事件循环阻塞与工程启动隐患 |

---

## 一、Critical（严重安全越权 / 核心逻辑击穿）

### C-01. 跨租户越权篡改科研事实 + 首次人工修订快照被覆盖（IDOR + 数据污染）
- **涉及位置**：
  - `backend/app/api/isolation.py`（L26, L48, L96–98）
  - `backend/app/models/__init__.py`（L137, L151）
  - `backend/app/api/v1/facts.py`（L89–143, L106–114）
- **根因与影响**：
  1. `PATCH /api/v1/facts/{fact_id}` 与 `GET /api/v1/facts/{fact_id}/revisions` 路由本身没有接入 `get_current_user` 或 `resolve_project_access`，完全依赖路由级 `enforce_project_isolation`。但 `_ENTITY_LOOKUP["fact_id"]` 使用 `ExtractedFact.id == eid` 反查（`id` 是自增 `Integer` 主键），而接口路径参数传入的是字符串业务标识 `fact-xxxx`（存放在 `ExtractedFact.fact_id` 列）。查询恒返回 `None` 导致隔离校验静默跳过——即便关闭 `ALLOW_UNAUTH_TEST_ENDPOINTS`，任意登录用户仍可跨组织读取他人修订历史或篡改他人项目的科研事实。
  2. `facts.py` 第 106–114 行在循环中先执行 `setattr(f, field, new)` 覆盖字段值，之后才序列化 `f.ai_original_json`，导致保存的“AI 原始快照”实际上是人工修改后的新值。
- **修复建议**：
  - `isolation.py` 中对 `fact_id` 按 `ExtractedFact.fact_id == eid` 查询（仅当 `eid.isdigit()` 时兜底匹配 `id`）。
  - 在 `patch_fact` 与 `get_revisions` 显式校验 `get_current_user`、`resolve_project_access` 及 `fact.revise` 权限。
  - 在 `setattr` 循环前先备份生成 `f.ai_original_json`。

### C-02. 工作流节点审批与重试存在跨工作流 / 跨租户越权（IDOR）
- **涉及位置**：
  - `backend/app/api/v1/orchestration.py`（L149–166）
  - `backend/app/services/orchestration_service.py`（L89–95, L459–509）
- **根因与影响**：
  - `POST /api/v1/workflows/{workflow_id}/nodes/{node_id}/confirm` 与 `.../retry` 仅依据路径中的 `workflow_id` 调用 `resolve_project_access`，随后调用 `svc.confirm_node(node_id, ...)` / `svc.retry_node(node_id, ...)` 时未校验 `node.workflow_id == workflow_id`。
  - `_get_node(node_id)` 仅按主键查节点，随后通过 `node.workflow_id` 加载目标工作流并推进执行。攻击者可传入自己项目下的 `workflow_id` 搭配受害者的 `node_id`，强行批准/拒绝他人的高风险人工确认门禁（同时清空 `needs_human_confirm = False`）或重跑他人节点。
- **修复建议**：
  - `_get_node(workflow_id, node_id)` 必须增加 `WorkflowNode.workflow_id == workflow_id` 约束，不匹配即返回 `404`。
  - `confirm_node` 校验 `review.decide` 权限，`retry_node` 校验 `audit.run` 权限。

### C-03. 工作流 DAG 调度器未校验前置节点是否完成，导致乱序执行与越过人工确认门禁
- **涉及位置**：
  - `backend/app/workflow/state.py`（L126–170）
  - `backend/app/services/orchestration_service.py`（L298–308）
- **根因与影响**：
  - `ready_nodes()` 仅通过 `_dep_blocked(dep_status)` 排除了 `failed / cancelled / skipped / blocked` 四种状态，**未要求前置依赖必须处于 `NODE_COMPLETED`**。
  - 当依赖节点仍处于 `pending`、`running` 或 `awaiting_confirmation`（等待人工确认）时，后继节点也会同时被判定为 `ready`；在 `advance()` 调度循环中，前置节点进入 `awaiting_confirmation` 后仅执行 `continue`（且不扣减并发配额 `slots`），紧接着就会在同一轮调度中直接执行其后继节点，彻底绕过人工确认门禁。
- **修复建议**：
  - 在 `ready_nodes()` 中检查前置节点状态，只要任一前置依赖不等于 `NODE_COMPLETED`（若显式配置允许跳过则另行放行），后继节点不得加入 `ready`。

### C-04. 修复建议审核接口跨租户越权且允许伪造审核人身份（IDOR）
- **涉及位置**：
  - `backend/app/api/isolation.py`（L24–31）
  - `backend/app/api/v1/reproductions.py`（L139–145, L412–423）
  - `backend/app/reproduction/diagnostics.py`（L119–139）
- **根因与影响**：
  - `proposal_id` 未加入 `_ENTITY_LOOKUP`，`ReviewCreate` 请求体也不含 `project_id` / `plan_id` / `run_id`，导致 `enforce_project_isolation` 解析不到项目而直接放行。
  - `require_admin` 允许任意已登录用户通过，`FailureDiagnoser.review_remediation` 按 `proposal_id` 直接更新数据库，并将客户端传入的 `payload.reviewer` 原样落库，可跨租户篡改任意修复提案状态并冒充审核人身份。
- **修复建议**：
  - 在 `_ENTITY_LOOKUP` 中注册 `"proposal_id": [("app.models.stage4", "RemediationProposal")]`。
  - 路由注入 `get_current_user` 与 `review.decide` 权限校验，由服务端从 `user` 读取真实 `reviewer_user_id` 和显示名称。

### C-05. 默认 `ALLOW_UNAUTH_TEST_ENDPOINTS=true` 绕过隔离，且 `.env` 中 `STRICT_PRODUCTION=1` 不生效
- **涉及位置**：
  - `backend/app/core/config.py`（L17, L34）
  - `backend/app/api/isolation.py`（L90–93）
  - `backend/app/api/deps.py`（L64–79）
  - `backend/app/main.py`（L94–99）
- **根因与影响**：
  1. 代码与两份 `.env.example` 均将 `allow_unauth_test_endpoints` 默认设为 `True`。一旦请求**不带 `Authorization` 头**（`user is None`），`enforce_project_isolation` 与 `require_admin` 会直接 `return` 放行：已登录的非项目成员访问项目会拿到 `404`，而完全匿名的请求却能拿到 `200 OK` 读取全部项目、下载/上传/删除材料、消耗 LLM 额度并触发数据审计。
  2. `Settings` 未定义 `strict_production` 字段且设置了 `extra="ignore"`，`pydantic-settings` 不会把 `.env` 变量写入 `os.environ`。若运维只在 `.env` 写入 `STRICT_PRODUCTION=1`，`main.py` 第 98 行的 `os.getenv("STRICT_PRODUCTION")` 将读到空值，导致生产配置阻断失效。
- **修复建议**：
  - 将 `allow_unauth_test_endpoints` 默认改为 `False`（仅在 `backend/app/tests/conftest.py` 测试夹具中按需开启）。
  - 在 `Settings` 中显式声明 `strict_production: bool = False`，并在 `main.py` 通过 `settings.strict_production` 判断。

---

## 二、High（核心功能阻断 / 高危安全与数据一致性缺陷）

### H-01. 全局 1MB 请求体限制阻断真实 PDF/ZIP 上传，而 Chunked 请求可绕过限流
- **涉及位置**：
  - `backend/app/main.py`（L63–68）
  - `backend/app/core/config.py`（L63）
  - `backend/app/parsers/limits.py`（L10）
  - `backend/app/api/v1/materials.py`（L41）
  - `backend/app/api/open_v1.py`（L112）
- **根因与影响**：
  - `limits.py` 声明单文件上限为 `20MB`（交接包校验上限 `50MB`），但 `main.py` 中间件对所有含 `Content-Length > max_request_bytes`（默认 `1MB`）的请求一律返回 `413`，导致浏览器无法上传大于 1MB 的论文 PDF、压缩包或数据集。
  - 同时，若客户端发送 `Transfer-Encoding: chunked` 请求（不含 `Content-Length`），中间件限流会被完全绕过，且路由层直接 `await file.read()` 全量读入内存并写盘（`MaterialService.upload` 也未校验 `len(data) <= MAX_SINGLE_FILE_BYTES`），存在内存耗尽风险。
- **修复建议**：
  - 区分普通 JSON 接口上限（1MB）与文件上传路由上限（对齐 `MAX_SINGLE_FILE_BYTES` / `MAX_BUNDLE_BYTES`），并在服务端对 `UploadFile` 采用流式分块读取与实时字节计数截断。

### H-02. 下载含中文或非 ASCII 文件名的材料必现 HTTP 500 崩溃
- **涉及位置**：
  - `backend/app/api/v1/materials.py`（L132–142）
- **根因与影响**：
  - `download_material` 构造响应头 `Content-Disposition: attachment; filename="{m.source_name}"` 时直接嵌入未经编码的 UTF-8 文件名。Starlette 在编码 HTTP 响应头时强制使用 `latin-1`，任何含中文字符的文件名都会直接抛出 `UnicodeEncodeError`（HTTP 500）。
  - 此外，在 `async def` 路由中直接调用 `path.read_bytes()` 会同步阻塞事件循环。
- **修复建议**：
  - 采用 RFC 5987 编码方式：`attachment; filename="download{ext}"; filename*=UTF-8''{quote(m.source_name)}`，并改用 `FileResponse` 流式返回。

### H-03. 按文档配置 `ENCRYPTION_KEY` 运行时 500 崩溃，且 `CORS_ALLOW_ORIGINS` 被静默忽略
- **涉及位置**：
  - `backend/app/core/security.py`（L61–67）
  - `backend/app/core/config.py`（L60, L118–119）
  - `.env.example`（L31–42）
- **根因与影响**：
  1. `.env.example` 与 `strict_production_check()` 要求将 `ENCRYPTION_KEY` 配置为“16 位以上随机值”，但 `core/security.py:_fernet()` 未像 `modelhub/security.py` 那样做 SHA-256 + base64 密钥派生，而是直接执行 `Fernet(settings.encryption_key.encode("utf-8"))`。只要不是精确 44 字节的 urlsafe-base64 Fernet 密钥，启动自检会放行，但运行时调用 `encrypt_secret` / `decrypt_secret` 必抛 `ValueError`（HTTP 500）。
  2. 根目录 `.env.example` 与 `README.md` 中的环境变量名为 `CORS_ALLOW_ORIGINS`，而 `Settings` 中字段为 `cors_allow_origins_raw` 且没有配置别名，受 `extra="ignore"` 影响，`CORS_ALLOW_ORIGINS` 会被静默忽略，生产 CORS 依然保持 `*` 全放行。
- **修复建议**：
  - 为 `core/security.py:_fernet()` 增加非标准 Fernet key 的确定性盐值派生，并在 `strict_production_check()` 中实际试构造 `_fernet()`。
  - 为 `cors_allow_origins_raw` 增加 `validation_alias=AliasChoices("CORS_ALLOW_ORIGINS_RAW", "CORS_ALLOW_ORIGINS")`。

### H-04. ModelHub 凭据外泄风险、本地模型开关 100% 失效、SSRF 缺口与事务污染
- **涉及位置**：
  - `backend/app/api/v1/modelhub.py`（L361–393, L405–428）
  - `backend/app/modelhub/security.py`（L118–142）
  - `backend/app/modelhub/gateway.py`（L130–170, L254–328, L367–376）
- **根因与影响**：
  1. **已存储 API Key 外泄**：`PATCH /model-credentials/{cred_id}` 允许仅修改 `base_url` 而不重新提交 `api_key`。攻击者篡改 `base_url` 后调用 `/test` 或 `/models`，网关会解密原 `key_ciphertext` 并通过请求头发送至新的 URL；同时 `revoke_credential` 仅改状态未清空密文，且 `test_credential` / `list_models` 完全不检查 `cred.status`（已吊销或禁用凭据仍可发送外连请求）。
  2. **`ALLOW_LOCAL_MODEL_ENDPOINT=true` 完全失效**：`modelhub/security.py:118` 虽然对 `http://localhost` 放行了协议校验，但随后在 L129–141 解析 DNS 后调用 `_ip_blocked(ip)`，因 `ip.is_loopback` 为 `True` 再次无条件拦截；同时 `gateway.py:284` 硬编码要求 `base_url.startswith("https://")`，导致本地模型端点永远无法保存和调用。
  3. **SSRF 复核与 DNS Rebinding 缺口**：`_build_adapter` 在调用时不复核 DNS 解析结果（存在 DNS Rebinding TOCTOU 风险），且非 `openai_compatible` 供应商配置自定义 `base_url` 时在 `gateway.py` 跳过全部 URL 安全校验。
  4. **Fallback 模型参数错用 + 调用方事务污染**：`gateway.py:130` 在候选列表循环外用主模型的 `model_id` / `params` 构造 `ModelRequest`，主模型失败切到不同供应商的 `fallback` 时仍发送主模型的 `model_id` 导致 404；`_log_call` 与 `_record_route` 直接在调用方的 `AsyncSession` 上执行 `commit()` / `rollback()`，会提前提交未完成事务或在日志异常时回滚调用方数据。
- **修复建议**：
  - 变更 `base_url` 时强制要求重填 `api_key`；吊销时置空 `key_ciphertext` 并在所有测试/调用入口统一检查 `cred.status == "active"`。
  - 修复 `validate_base_url` 中 `allow_local` 对回环地址的放行条件，并在适配器传输层做 IP 固定防重绑定。
  - 在候选模型循环内部构造 `ModelRequest`；日志落库改用独立会话或嵌套事务。

### H-05. 上传材料 `raw_text` 恒为空串，导致安全预检（`SecurityPreflight`）被绕过且环境检测失效
- **涉及位置**：
  - `backend/app/services/material_service.py`（L94–100）
  - `backend/app/reproduction/sandbox.py`（L173–178）
- **根因与影响**：
  - `MaterialService.upload()` 将所有上传材料的 `raw_text` 初始化为 `""`，解析阶段也只写入 `SourceChunk` 表而不回填 `Material.raw_text`。
  - `ExecutionSandbox.create_run()`（以及 `EnvDetector.detect()`）仅遍历 `if m.raw_text:` 扫描源码文本，导致所有通过上传接口提交的 `.py`、`.ipynb`、`.zip` 文件**全部跳过安全扫描**，即使代码中包含 `os.system`、`subprocess`、`pickle.load` 或内网元数据地址也会直接判定 `"passed": true`。
- **修复建议**：
  - 预检与环境检测优先通过 `MaterialService.path_of(m)` 读取磁盘真实文件内容（含 `.zip` 内部代码条目），若磁盘不可用再回退读取 `SourceChunk`。

### H-06. 多条核心业务链路静默失效
- **`requirements.txt` 被当成纯文本解析**：`material_service.py`（L88–93）按 `mat-{id}{ext}` 存盘为 `mat-xxx.txt`；`task_service.py`（L186–188）将磁盘路径直接传给 `registry.py:parse_file()`（L54–56），`detect_material_type("mat-xxx.txt")` 返回 `"text"` 而非 `"requirements"`，导致无法进入 `config_parser`。
- **ModelHub 用户密钥无法驱动解析抽取**：`task_service.py`（L250）仅依据 `.env` 的 `settings.is_llm_configured` 决定是否跳过 AI 抽取，未检查当前用户在「模型管理中心」配置的凭据与任务绑定，导致用户即使已在前端配好模型，未配 `.env` 全局 Key 时仍跳过抽取。
- **程序事实重试翻倍且格式不兼容比对**：`extraction_service.py:add_program_facts()`（L263–316）重跑前不清理旧的 `program` 事实导致重复堆积，且将 `"learning_rate: 0.001"` 整段写入 `raw_value`（`normalized_value=None`），致使后续数值对比失配。
- **第 11 阶段变化监控与实验 Commit 对比失效 + 500 崩溃**：`repository_service.py:sync_repository()`（L165–168）创建 `RepositorySnapshot` 时硬编码 `project_id=None`，导致 `experiment_diff_service.py`（L77–84）与 `change_monitor_service.py` 查询项目快照恒为空；此外 `change_monitor_service.py` 第 84 行访问了 `ExtractedFact` 上不存在的属性 `fact.source_ref`（应为 `source_name`），一旦命中分支会直接抛出 `AttributeError`（500）。
- **知识库新建必报 403 且私有项目条目跨项目泄露**：`knowledge_service.py:create_entry()`（L113）调用 `user_has_permission(db, user, "knowledge.write")` 时未传 `org_id`/`project_id`，对非平台管理员恒返回 `False`（403）；而 `_get_visible_entry` 与 `list_entries`（L276–305）仅校验 `entry.org_id in org_ids`，未检查 `entry.visibility == "project"`，导致同组织非项目成员可读写或篡改项目私有条目（且 `revise_entry` 传给 `_get_visible_entry` 的 `write=True` 参数被完全忽略）。
- **补证任务假闭环**：`evidence_gap_service.py:execute_task()`（L297–312）未生成任何新 `EvidenceItem`（甚至 `_extract_existing_evidence` 返回 `found=False` 时），也会无条件把任务置为 `completed` 并把缺口置为 `closed`。

### H-07. RBAC 权限模型越权（自注册即获 `org_admin`、项目 `viewer` 可执行 30+ 写接口）
- **涉及位置**：
  - `backend/app/services/auth_service.py`（L49–55）、`backend/app/services/rule_service.py`（L45–59）、`backend/app/services/rag_service.py`（L102–144）、`backend/app/services/benchmark_service.py`（L458–464, L506–508）
  - `backend/app/api/deps.py`（L115–133）、`backend/app/api/v1/projects.py`（L55–78）、`backend/app/api/v1/orgs.py`（L132–135）、`backend/app/services/governance_service.py`（L96–124）
- **根因与影响**：
  1. 开放注册自动为用户新建个人组织并授予 `org_admin`，而全局规则表 `AuditRule` 无 `org_id` 隔离、`rag_service`/`benchmark_service` 未限制 `is_public=True` 必须由平台管理员操作，任何新注册外部用户均可篡改全平台审计规则、向全局 RAG 注入污染文档或伪造公共基准用例的最高验证等级。
  2. `resolve_project_access` 默认 `min_rank=0`，且写路由普遍仅挂了 `require_admin` 或 `enforce_project_isolation`，项目只读角色 `viewer` 可正常调用上传/删除材料、修改事实、操控工作流、生成报告等 30 余个写接口。
  3. 存在多处跨组织越权：`POST /projects` 未校验用户是否属于传入的 `org_id`；`GET /teams/{team_id}/members` 未校验成员身份；`POST /invitations/accept` 未校验 `user.email == inv.email`；`GET /governance/ai-consent` 未传 `project_id` 时可拉取全站授权记录，且 `ensure_ai_consent` 中 `(AiConsent.org_id == org_id)` 在 `org_id=None` 时会编译为 `IS NULL` 误匹配其他项目的全局空组织授权。

### H-08. SQLite 跨外部 LLM 请求长事务锁库 + 未开启外键级联与 WAL
- **涉及位置**：
  - `backend/app/db/__init__.py`（L11–17）
  - `backend/app/services/extraction_service.py`（L132–142）
  - `backend/app/services/audit_service.py`（L117–155）
  - `backend/app/services/material_service.py`（L186–194）
  - `backend/app/api/v1/projects.py`（L115–128）
- **根因与影响**：
  - `ExtractionService.extract` 与 `AuditService.run_audit` 在调用外部 `await llm.chat()`（单次最长 60s、多轮可达 180s+）之前先执行了 `await self.db.flush()`，提前持有 SQLite 全局写锁，导致并发写入请求超过 5 秒默认超时后直接报 `database is locked`（500）。
  - SQLite 连接未启用 `PRAGMA journal_mode=WAL`、`PRAGMA busy_timeout` 和 `PRAGMA foreign_keys=ON`，导致删除材料或项目时数据库级 `ON DELETE CASCADE` 不生效，在 `extracted_facts`、`parse_tasks` 及第 7/10/11/12 阶段表中遗留大量孤儿记录。
- **修复建议**：
  - 通过 SQLAlchemy `connect` 监听器开启 `WAL`、`busy_timeout=15000` 和 `foreign_keys=ON`。
  - 发起外部 HTTP 调用前先 `commit()` 初始 `running` 记录以释放写事务。

---

## 三、Medium（前后端契约断层 / 前端状态缺陷 / 工程运维隐患）

### M-01. AI 诊断与修复提案前后端契约不匹配
- **涉及位置**：
  - `backend/app/api/v1/reproductions.py`（L395–423）
  - `frontend/src/pages/reproduction/ReproductionDiagnosticsPage.tsx`（L155–179, L581）
- **根因与影响**：
  - `POST /reproductions/diagnostics` 虽在后台生成了 `RemediationProposal` 落库，但接口响应未返回 `remediation_proposals` 数组或 `proposal_id`；`POST /reproductions/remediations/{proposal_id}/review` 返回字段名为 `decision`，前端却渲染 `reviewMutation.data.status`，导致提案双栏对比与审核结果状态显示缺失。

### M-02. Bloom 证据织机（Evidence Loom）关系边断链与视图状态缺陷
- **涉及位置**：
  - `frontend/src/bloom/weave.ts`（L142–162, L178–181）
  - `backend/app/parsers/registry.py`（L22–50）
  - `frontend/src/bloom/BloomAtelier.tsx`、`frontend/src/workbench/BloomWorkbench.tsx`
- **根因与影响**：
  - `weave.ts` 通过 `material_type.includes('data')` 过滤数据材料，但后端材料类型只有 `'csv'` / `'xlsx'`；同时 `GET /reproductions/plans` 列表响应未携带 `tasks` 嵌套字段，导致 `materials → plan`、`dataset → plan`、`dataset → environment` 三条核心图谱边恒为空。
  - `BloomAtelier.tsx` 顶部视图切换缺少 `"loom"` 入口；`BloomWorkbench.tsx` 中 `focusRestored.current` 置 `true` 后不会随路由或 `projectId` 变化重置，导致后续 `?focus=` 跳转失效。

### M-03. 新手引导卡片 `NextStepCard` 存在步骤死循环与冗余并发请求
- **涉及位置**：
  - `frontend/src/ux/NextStepCard.tsx`（L138–147）
- **根因与影响**：
  - 当项目已创建规划但尚未创建运行时，数据库尚无 `ExecutionEnvironment` 记录；`NextStepCard` 会提示“第四步：确认实验环境”并引导跳往 `/projects/:pid/reproduction/environment`。但环境页是**纯只读展示页**（环境仅在创建运行时自动采集），用户按引导进入后没有任何创建入口，导致卡片永久卡死在第四步；且该卡片在所有项目子页面挂载时均会并发触发 7 个只读请求。

### M-04. 站点模式（`frontend/functions/`）路由大幅落后且种子脚本导出敏感哈希
- **涉及位置**：
  - `frontend/functions/routes.ts`（L11–19）
  - `backend/scripts/export_site_seed.py`（L73–85）
- **根因与影响**：
  - `functions/routes.ts` 缺少第 9–11 阶段新增接口（模型向导 `/model-credentials/test-draft`、`/model-setup`、数据审计、统计审计、证据图谱、可信结论等），在站点模式下访问对应功能会报 404。
  - `export_site_seed.py` 对本地数据库全表执行 `SELECT *` 并直接写入受 Git 追踪的 `frontend/dev/seed_data.json` 与 `frontend/functions/seed_data.ts`，未过滤 `password_hash`、`token_hash`、`token_encrypted` 等敏感列。

### M-05. 前端登出缓存残留、401 过期未清理与跨项目切换串台
- **涉及位置**：
  - `frontend/src/stores/authStore.ts`（L54–62）
  - `frontend/src/services/api.ts`（L93–101, L200–202, L303–305）
  - `frontend/src/components/RequireAuth.tsx`（L18–36）
  - `frontend/src/pages/DataAuditPage.tsx`、`ReproductionDiagnosticsPage.tsx`、`ReproductionComparisonPage.tsx`、`GuidedReproductionPage.tsx`
- **根因与影响**：
  - `logout()` 未调用 `queryClient.clear()`，切换用户登录会在 `staleTime` 内看到上一位用户的项目、模型凭据与 Token。
  - `api.ts` 捕获到 401 `UNAUTHORIZED` 时未自动触发登出重定向，会话中途过期后页面停留在半瘫痪状态；下载文件名若含未编码 `%` 字符，`decodeURIComponent` 会抛出未捕获 `URIError`。
  - 多个项目子页面未在 `projectId` / `pid` 变化时重置本地 `useState`（如 `selectedId`、`selectedRunId`、`diagnosticMutation`），切换项目后会请求旧项目资源导致 404 或串台展示。

### M-06. 性能阻塞、上游路径穿越与工程启动隐患
- **事件循环阻塞与 XLSX 炸弹风险**：`data_audit.py`（L86–94）与 `task_service.py`（L186）在 `async def` 路由中直接同步解析大文件；`data_parser.py`（L175）对 `.xlsx` 未做 ZIP 解压体积预检。
- **连接泄漏与基准回归方向反转**：`LLMService._post()`（`llm/__init__.py:94,106`）每次新建 `httpx.AsyncClient` 后未调用 `aclose()`；`benchmark_metrics.py` 对 `false_positive_rate` / `false_negative_rate` 等“越低越好”指标沿用“越大越好”阈值方向判定回归。
- **上游仓库 API 路径穿越**：`repository_service.py`（L117–151）将未 URL 编码、未校验字符集的 `repo_full_name` 与 `ref` 直接拼入 GitHub/GitLab/Gitee API URL 并附带解密后的组织 PAT 发送请求。
- **N+1 查询与双库分裂**：`materials.py`（L76–90）与 `parse_tasks.py`（L130–140）列表接口逐行发起计数/名称查询；`./reprocheck.db` 与 `./storage/materials` 依赖进程 CWD，仓库根目录与 `backend/` 下已形成两套不同步的数据库；`migrate_stage2()`（`db/__init__.py:45`、`migrate.py:90`）启动时创建临时 `AsyncEngine` 未释放。
- **启动脚本与本地环境**：`scripts/start-reprocheck.ps1`（L17–34, L85）优先调用 `%LOCALAPPDATA%\Doubao\...` 中的 `node.exe` 且不回退读取 `PATH`；对跨机器失效的 `backend/.venv` 仅检查 `python.exe` 存在性，启动时会空等 90 秒才报错超时。

---

## 四、建议修复优先级路线图

1. **P0（立即阻断安全与核心正确性漏洞）**：
   - 修复 `isolation.py` 的 `fact_id` / `proposal_id` 反查、工作流 `node_id` 归属校验、DAG `ready_nodes()` 依赖完成态判定。
   - 默认关闭 `allow_unauth_test_endpoints`，将 `strict_production` 正式纳入 `Settings`，并在写路由补齐最小角色权限校验。
   - 封堵 ModelHub 修改 `base_url` 窃取存储密钥、吊销态检查及本地端点的循环拦截死逻辑。
2. **P1（打通上传、下载、解析与数据落库主链路）**：
   - 放开上传路由请求体限制并改为流式限额，修复中文文件名 RFC 5987 下载响应头。
   - 修复 `ENCRYPTION_KEY` 派生与 `CORS_ALLOW_ORIGINS` 别名；打通 `requirements.txt` 识别、ModelHub 凭据触发解析、`SecurityPreflight` 读取真实文件内容、`RepositorySnapshot.project_id` 绑定与 `change_monitor` 属性名。
   - 为 SQLite 开启 `WAL` / `busy_timeout` / `foreign_keys=ON`，将外部 LLM HTTP 调用移出数据库写事务，统一数据库与 `storage/` 的绝对基准路径。
3. **P2（对齐前后端契约与工程体验收尾）**：
   - 补齐诊断提案序列化与 `status`/`decision` 对齐、修复 Bloom `weave.ts` 数据材料筛选与 `NextStepCard` 引导逻辑。
   - 登出时清空 `queryClient`、补充 401 全局失效登出及页面 `projectId` 切换重置；清理 `export_site_seed.py` 敏感列并优化启动脚本与重建本地 `.venv`。
