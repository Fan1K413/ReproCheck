# 第二阶段安全审查（SECURITY_REVIEW）

审查时间：2026-11-17
方式：源码逐模块审查 + 测试断言 + 真实 HTTP 冒烟。

## 1. 用户代码执行防护 ✅

| 风险 | 措施 | 验证 |
|---|---|---|
| 执行上传的 Python | 仅 `ast.parse()` + `tokenize` 静态解析，无任何 `exec/eval/subprocess` | 合成样本顶层 `raise RuntimeError`，解析不触发 |
| 执行 notebook cell | 只读 JSON，不执行代码 | parse_notebook 全程 json 模块 |
| 自动 pip install | 无此逻辑；requirements.txt 只做文本解析 | 源码审查 |
| 解压后运行 ZIP 脚本 | 只读入内存字符串，从不 extractall | zip_parser.py 源码 + 测试 |
| README 运行命令 | 只保存原文为 runtime 事实，不执行 | readme_parser + 提示词规则 |

## 2. 文件与路径安全 ✅

- **扩展名白名单**：`limits.ALLOWED_EXTENSIONS`，上传时 registry 二次校验，不支持格式返回 422（冒烟测试 evil.exe 被拒）；
- **文件名净化**：去路径成分、危险字符（`<>:"|?*`）、控制字符；
- **路径穿越**：`safe_resolve_within()` 确保解析路径在存储根内；ZIP 条目含 `..` 直接整体判失败；
- **ZIP 防护**：条目 ≤500、解压总量 ≤100MB、单文件 ≤20MB、符号链接跳过、危险扩展名跳过、忽略目录跳过；
- **文件大小**：单文件硬限制，项目材料数 ≤30；
- **MIME**：扩展名 + 路径双重校验，下载用 Content-Disposition attachment。

## 3. 反序列化与注入防护 ✅

- YAML 强制 `yaml.safe_load`，`!!python/object` 攻击样本被拒绝（测试断言）；
- JSON 用标准 json，TOML 用 tomllib，均无对象构造风险；
- SQL 全部使用 SQLAlchemy ORM/参数化语句，无字符串拼接 SQL；
- Pydantic `extra="forbid"` 拒绝模型返回多余字段。

## 4. AI 结果安全 ✅

- 模型不能创造证据：chunk_id 必须存在且属于当前材料，否则拒绝引用；
- quote 必须逐字出现在 chunk 原文，否则标 unverified、事实降 needs_review；
- 证据原文从后端 source_chunks 读取，不用模型生成文本；
- not_found 明确标记，不根据领域常识填充；
- confidence 明确标注"非校准概率"。

## 5. 密钥与隐私 ✅

- API Key 仅后端 `settings.llm_api_key` 读取；
- 前端零明文 Key（仅 `api_key_configured` 布尔状态）；
- 日志脱敏（core/logging.py 的 REDACT 列表）；
- 不将完整私人论文内容写入普通日志（只记事件类型与请求 ID）；
- 上传/解析接口支持 `X-Admin-Token` 访问控制。

## 6. 数据一致性 ✅

- 删除材料返回 `cascaded` 统计，显式清理 evidence_items 避免孤立记录；
- 数据库迁移幂等，旧数据保留，新列全部 nullable/默认值；
- 解析失败明确标记，不把上传成功当解析成功；
- 服务重启后从 DB 读取真实任务状态，不推断为成功。

## 7. 遗留风险（如实披露）

| 风险 | 状态 | 建议 |
|---|---|---|
| 无真实 API Key，无法验证真实模型调用 | 阻塞（外部） | 配置后按 TEST_REPORT 补测 |
| CORS `allow_origins=["*"]` | 开发配置 | 生产收敛到前端域名 |
| 同步解析任务取消非实时 | 设计取舍 | 阶段边界生效，已在 API 注明；如需实时可迁移后台任务队列 |
| PyMuPDF 版本锁定值与实际不符 | 配置偏差 | 改 `PyMuPDF>=1.24` 或按实际版本校准 |
| 未做并发/压力测试 | 范围外 | 生产前补充 |
| 大文件（接近 20MB）内存占用 | 潜在 | 生产可改流式处理 |

## 8. 安全结论

第二阶段核心安全要求（不执行代码、不装依赖、ZIP 三重防护、路径穿越、密钥保护、证据防伪造）均已实现并有测试/源码证据支撑。无高危阻塞漏洞。上述遗留风险为配置偏差或范围外项，已在对应文档披露。
