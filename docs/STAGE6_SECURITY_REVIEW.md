# 第六阶段 · 安全审查报告

> 审查范围：A 身份/组织/RBAC · B 基准库 · C 规则/反馈/RAG · D 集成/开放 API · E 治理。
> 审查方式：代码审阅 + 119 项后端测试（含隔离/权限/凭据/限流负向用例）。

## 1. 认证与凭据
- 密码：stdlib `pbkdf2_hmac`（200k 迭代 + 随机盐），不引入 bcrypt 依赖；哈希绝不进响应。
- 会话：PyJWT HS256，`exp` 默认 12h；`get_current_user` 失败 401。
- 仓库令牌：Fernet 对称加密落库；API/邀请令牌：sha256 哈希落库，明文仅创建时返回一次。
- 撤销/过期立即失效；撤销仓库连接清空密文。
- **残留风险**：`JWT_SECRET`/`ENCRYPTION_KEY` 默认开发值，生产必须经环境变量注入强密钥；CORS 当前 `*`（开发），生产应收敛域名。

## 2. 授权与数据隔离（后端强制）
- RBAC 权限目录单一事实来源 `core/rbac.py`；判定优先级：平台管理员 > org_admin > 项目角色 > 组织角色。
- 项目级隔离 `enforce_project_isolation` 挂载既有项目相关路由；非成员 404（隐藏存在性），角色不足 403。
- 新增模块（cases/rules/feedback/rag/integrations/api-tokens/governance/open-api）在服务层自校验权限与可见性。
- 测试覆盖：跨组织 404、非成员 404、viewer 写操作 403、成员撤权后项目访问同步失效。
- **前端隐藏按钮不构成权限**——所有判定在后端。

## 3. 注入与输入安全
- 材料上传：扩展名白名单 + 文件名净化 + 路径穿越防护（`safe_resolve_within`）+ 单文件 20MB / ZIP 总量 100MB / 条目 500 上限。
- 请求体上限 1MB（中间件）；SQL 全部 SQLAlchemy 参数化，无字符串拼接。
- Notebook 解析只读不执行；仓库同步不执行远端代码。
- 开放 API scope 白名单校验，非法 scope 422。

## 4. AI 与数据安全
- LLM Key 仅后端配置读取，绝不进日志/响应/前端；失败规范化报错，不伪造审计成功。
- 证据原文从后端 source_chunks 读取，不用模型生成引用。
- RAG provenance 分级（current_evidence/historical_case/external_knowledge/model_inference）；当前论文证据优先，历史案例不得覆盖当前事实；KB 只产出 historical_case/external_knowledge。
- 规则进化：单条用户反馈绝不自动改生产规则；新版本须附测试样本、离线评估、可回滚；争议反馈转人工。
- 案例质量等级由确定性规则计算，AI/客户端不可直接设定。
- AI 外部模型授权门（`REQUIRE_AI_CONSENT`）：未授权明确 403，不静默发送机密材料。

## 5. 滥用防护
- 开放 API 进程内滑动窗口限流（每 token/分钟），超限 429；调用日志 IP 仅哈希。
- 邀请令牌 7 天过期、一次性接受（重复 409）。
- **残留风险**：限流为进程内，多副本需共享存储；登录/注册无暴力破解限速（建议部署侧加 WAF/限流）。

## 6. 审计与可追溯
- 重要判断（事实修订、问题确认、规则修改、修复批准、报告生成、连接/令牌/授权/导出/删除）均 `record_trail` 留痕，保留修改前后内容。
- 原始 AI 判断与证据不因用户修订结论而被覆盖。
- 审计轨迹按保留策略留存，项目删除不清空轨迹。

## 7. 结论
第六阶段安全控制已在后端落地并经负向测试验证。生产部署前必须：注入强 `JWT_SECRET`/`ENCRYPTION_KEY`、收敛 CORS、开启 `REQUIRE_AI_CONSENT`、关闭 `ALLOW_UNAUTH_TEST_ENDPOINTS`、部署侧补充登录限速与分布式限流/保留清理 cron。