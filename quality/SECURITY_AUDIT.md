# SECURITY_AUDIT · 鉴权、隔离与配置安全

> 范围：本地运行态（开发模式）+ 代码审查 + 真实 HTTP 探针。
> 非渗透测试；未使用 sqlmap/Burp/ClamAV 等外部工具。
> 关联：`API_AUDIT.md`、`BUG_TRACKER.md` BUG-001/002/003。

## 1. 结论摘要

| 维度 | 结果 |
|---|---|
| 已登录用户的项目隔离 | **通过**：非成员上传/删除项目返回 404（隐藏存在性） |
| 无效/过期 token | **通过**：`/auth/me` 401 |
| 匿名边界 | **失败**：读项目/材料/任务/下载、写材料、删材料均 200 |
| 角色权限 | **失败**：viewer（只读）可上传材料；25 个写端点用 any-auth 语义 |
| 生产配置自检 | **失败 5 项**：JWT 密钥、加密密钥、匿名开关、CORS、AI 授权 |
| 输入面 | 部分通过：ZIP/YAML/路径有防护；无请求体上限、无速率限制 |
| 依赖 | 版本固定；未做 CVE 扫描 |

## 2. 真实发现

### SEC-01 · 匿名可读全量项目数据（P1，生产 P0）

- 证据：`api-audit.json` 探针 1–4。
- 匿名 `GET /projects` 返回 15 条，含项目名、论文标题、描述、owner_user_id、org_id。
- 匿名可读 2 份材料、2 个解析任务，并可下载 486 B 的原始文件。
- 根因：`allow_unauth_test_endpoints=True` + `isolation.py` 匿名 return + 读接口无 `get_current_user`。

### SEC-02 · 匿名写/删材料（P1，生产 P0）

- 匿名上传 `qa-anon-probe.txt` → 200，生成 `mat-f7b40eec57274e69`。
- 匿名 DELETE 另一份探针材料 → 200 `{"deleted": true}`。
- 根因：`require_admin` 在匿名 + 开发开关下放行；上传/删除无项目归属校验。
- 影响：数据完整性破坏；可被脚本批量删除。

### SEC-03 · viewer 越权写（P1）

- `ROLES["viewer"]` 权限列表为空，声明“不能修改”。
- 实测 viewer 上传到演示项目 → 200。
- 25 处 `require_admin` 覆盖 6 个 API 文件，含上传、解析、事实修订、运行创建/取消、报告生成、LLM 测试。
- 根因：`require_admin` 实现为“任意已登录用户”，不是角色校验。

### SEC-04 · 生产配置 5 项不合格（P1）

`settings.strict_production_check()` 会报告：

1. `allow_unauth_test_endpoints=True` → 匿名可访问项目接口。
2. `jwt_secret` 为 `dev-insecure-change-me` / 长度不足 32。
3. `encryption_key` 为空（仅开发期从 JWT 派生）。
4. `CORS allow_origins` 含 `*`。
5. `require_ai_consent=False`。

启动时只 `logger.warning`；只有显式 `STRICT_PRODUCTION=1` 才拒绝启动。当前 `.env` 不存在，无法确认部署方已收敛。

### SEC-05 · 速率限制与请求体上限缺失（P2）

- 代码中未见 slowapi/网关限流；登录、匿名上传、解析均无频控。
- FastAPI 默认无显式 body size 限制；文件上传由解析器/服务层限制，但 HTTP 层未挡大包。
- 未做真实压测，只做代码审查。

### SEC-06 · 输入面（部分通过）

| 项 | 结论 |
|---|---|
| ZIP 路径穿越/条目数/总量 | 有校验（`zip_parser.py`） |
| YAML | 强制 `safe_load` |
| SQL 注入 | SQLAlchemy 参数化；未用外部工具验证 |
| 文件存储 | UUID 重命名 + 受控目录 |
| XSS | React 默认转义；后端不转义；未做渗透 |
| CSRF | Bearer Token + 分离前端，常规不需要；未验证 |
| 病毒扫描 | 无 ClamAV |

## 3. 正向验证

- 4 个演示账号登录 200；错误密码未测（避免锁定）。
- 无效 token 401。
- viewer 非成员上传 → 404；viewer 删除 lead 项目 → 404；说明 `resolve_project_access` 对已登录链路有效。
- 错误响应不泄露堆栈：404 仅返回中文消息 + 错误码 + request_id。
- 报告 PDF 不可用时返回 501 `PDF_UNAVAILABLE`，不伪造文件。

## 4. 与既有安全报告的口径差异

`docs/stage10/09_SECURITY_TEST_REPORT.md` 写：

- “无 token 访问 401”
- “跨用户隔离 10/10”

实测：

- `GET /projects` 无 token **200 / 15 条**；`materials`、`parse-tasks`、`download` 同样 200。
- 已登录隔离确实成立，但匿名路径绕过，不能给 10/10。

建议把该报告改为“开发模式（allow_unauth=True）下匿名可读写；生产必须 STRICT_PRODUCTION=1”，或直接以本档案为准更新。

## 5. 发布前必须完成

1. 生产配置：强随机 JWT/加密密钥、CORS 白名单、关闭匿名开关、开启 AI 授权。
2. 匿名路由收敛到显式 demo 白名单（只读、固定项目、限流）。
3. 材料/解析/事实/复现写端点全部走 `require_permission` + 项目隔离。
4. 登录与上传限流、请求体上限。
5. 补角色矩阵回归与匿名 401 回归。

## 6. 未覆盖

- 真实漏洞利用链、横向移动、SSRF、XXE、反序列化。
- 密钥轮换、审计日志篡改、备份加密。
- 多租户跨组织边界（仅测了同组织 viewer 与匿名）。
- 供应链 CVE、容器逃逸、GPU 隔离。
