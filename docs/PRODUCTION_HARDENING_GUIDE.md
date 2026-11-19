# ReproCheck 生产加固与故障处理手册

状态：`PARTIAL`（提供可执行自检与配置指引；真实生产部署/备份恢复尚未在本项目验证）。
本手册对应第六阶段第十步"工程质量和部署升级"中可在本环境真实交付的部分。未验证项如实标注，不伪造部署成功。

## 1. 上线前安全自检（真实可用）

后端提供两个入口：
- 启动日志：每次启动调用 `settings.strict_production_check()`，把不安全项打进 WARNING 日志。
- API：`GET /api/v1/diagnosis/production-check`（需登录），返回 `{passed, issues, note}`。

自检覆盖（均未改变开发默认值，避免破坏本地演示/测试）：
| 检查项 | 生产要求 |
|---|---|
| `allow_unauth_test_endpoints` | 必须 `False`；否则匿名可访问项目接口 |
| `jwt_secret` | 32 位以上随机值，不得为 `dev-insecure-change-me` |
| `encryption_key` | 16 位以上独立随机值，不得复用 JWT 密钥 |
| `cors_allow_origins_raw` | 收敛为前端域名，禁止 `*` |
| `require_ai_consent` | 建议 `True`（调用外部 LLM 前需 AI 授权） |
| `enable_code_execution` / `execution_backend` | 未配置安全容器时不得开启执行 |

**强制模式**：设置环境变量 `STRICT_PRODUCTION=1` 后，任一检查项不通过则服务拒绝启动。
这是真实执行的守卫（在 `main.py` 的 startup 中），不是文档承诺。

## 2. 推荐生产配置（.env）

复制 `.env.example`，至少修改：
```
ALLOW_UNAUTH_TEST_ENDPOINTS=false
JWT_SECRET=<32+ 位随机串>
ENCRYPTION_KEY=<16+ 位独立随机串>
REQUIRE_AI_CONSENT=true
CORS_ALLOW_ORIGINS=https://你的前端域名
STRICT_PRODUCTION=1
ADMIN_TOKEN=<强随机值>
```
JWT/加密密钥用系统随机源生成，例如 `python -c "import secrets;print(secrets.token_urlsafe(48))"`；不要把生成值提交到 Git。

## 3. 未验证/阻断项（部署前必须自行完成）

- 代码隔离执行：`enable_code_execution=False`、`execution_backend=none`，无 rootless Docker/GVisor。上线前须部署安全容器并做逃逸测试；在此之前不得启用执行。
- 备份恢复：SQLite 有 `.bak` 文件，但未做真实"备份→破坏→恢复→校验"演练。
- 并发/队列：解析任务为同步执行+DB 状态，无独立 worker 队列；多并发生产负载未压测。
- 监控告警：仅日志，无指标采集/告警通道。
- 版本升级/回滚：有 Git 检查点标签（`stage6-checkpoint-preflight`、`stage6-core-complete`），但数据库无降级迁移脚本。

## 4. 故障处理（已知问题）

| 现象 | 原因 | 处理 |
|---|---|---|
| pytest 退出时报 Windows `PermissionError` 清理临时目录 | pytest 临时目录清理权限问题（环境问题） | 测试主体结果有效；加 `-p no:cacheprovider` 可缓解 |
| 登录态下载材料/报告 401 | 历史版本二进制端点未注入 Bearer | 已修复（前端注入 token）；若仍 401 检查后端 `allow_unauth_test_endpoints=false` 时项目归属 |
| 无效 LLM Key 返回 401 被误判为登录失效 | 历史错误码映射问题 | 已修复为 502；业务码仍是 `LLM_INVALID_KEY` |
| 解析响应 `material_name` 为空 | 历史响应未补全材料名 | 已修复，与 `GET /parse-tasks/{id}` 一致 |
| 无 Key 时解析/规划 503 | 设计行为，不伪造结果 | 配置真实 `LLM_API_KEY` 后重试 |
| 运行 `blocked_no_sandbox` | 执行引擎默认关闭 | 部署安全容器前属预期，不得绕过 |
| 图表验证 `insufficient_data` | 缺原始 CSV/JSON 或绘图代码 | 补充真实结果文件；不得据此声称已精确复核 |

## 5. 数据库变更与回滚

- 解析任务新增列：`paused_at`、`timeout_seconds`(600)、`failure_category`('')、`resume_count`(0)、`heartbeat_at`；均由 `db/migrate.py` 幂等补列，nullable/有默认值，旧数据不丢。
- 回滚：代码用 Git 标签回退；数据库新增列不删除（SQLite 删列成本高），保留即可兼容旧代码。

## 6. 结论

本手册提供的是**可执行的自检与配置守卫**，不是"已完成生产部署"的证明。真实上线仍需完成第 3 节全部阻断项并做独立运维验收。
