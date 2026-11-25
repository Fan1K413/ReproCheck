# ReproCheck 投稿前审计 · 华为 ICT 创新赛赛题二

课题组在投稿前把论文和实验产物放进同一项目。AgentArts 从论文中提取可核验主张，按字段调用不同的 ReproCheck 工具。FastAPI 从本次材料快照核对原文并计算证据状态，网页展示每条主张和证据位置。补上传材料后，AgentArts 只重查受影响的主张，前后结果可追溯。

## 部署与配置

1. 按仓库 README 启动前后端。云端联调时将前端、后端部署到 HTTPS 环境，确保 AgentArts 工作空间可访问后端的五个工具路由。前端继续通过同源路径 `/api` 访问 FastAPI。反向代理需允许审计请求等待 `AGENTARTS_TIMEOUT` 加上解析时间，按现有上传接口设置文件大小限制。SQLite 和 `backend/storage` 应使用持久存储。
2. 在比赛工作空间配置可供已发布工作流使用的模型，例如带 API Key 的华为云 MaaS 模型。平台赠送的免费模型 Token 不能用于外部工作流 API。按下文搭建并发布任务型工作流，选择 API Key 鉴权。
3. 在后端 `.env` 或部署系统的密钥配置中填写以下变量，再重启后端。

| 变量 | 填写方式 |
| --- | --- |
| `AGENTARTS_INVOKE_URL` | 工作流的完整「调用路径」，形如 `https://<华为云域名>/runtimes/<运行时名称>/invocations` |
| `AGENTARTS_API_KEY` | 已发布的工作流 API Key，填写 Key 本身 |
| `AGENTARTS_TOOL_SECRET` | 后端独立随机密钥，至少 32 个字符。可用 `python -c "import secrets; print(secrets.token_urlsafe(32))"` 生成 |
| `AGENTARTS_WORKFLOW_VERSION` | 本次发布的版本标识，例如 `paper-audit-1.0.0`，重新发布工作流时同步更新 |
| `AGENTARTS_TIMEOUT` | 可选，默认 90 秒 |

后端用 `AGENTARTS_TOOL_SECRET` 派生单次、定时失效的工具令牌，随工作流的开始参数传递。工具插件使用本次运行的令牌，不需要配置另一份静态密钥。参赛演示使用合成或可公开传输的材料。如果部署启用了现有的 `REQUIRE_AI_CONSENT`，需先在项目治理设置授予外部模型授权，发起审计时仍需勾选本次处理同意。

## 搭建 AgentArts 工作流

先从仓库根目录生成 API 插件的 OpenAPI 文件，将命令中的域名换成实际的**后端**地址。

```sh
python agentarts/export_plugin.py https://reprocheck.example.org > /tmp/reprocheck-plugin.json
```

在 AgentArts 「插件 → 基于 API 创建插件」导入该文件。保留工具响应为对象，并确认存在 `getAuditContext`、`verifyConfig`、`verifyCode`、`verifyMetrics` 和 `finishAudit` 五个操作。若控制台把请求体包在 `body`，在下面的节点映射中设置其子字段。插件无额外网关认证，FastAPI 验证每次请求体里的运行令牌。若入口另有网关认证，按部署环境添加网关凭据。

创建一个任务型工作流，按下表连线。该表和仓库提示词是可重建配置，AgentArts 原生 JSONL 应由实际发布的工作流导出。

| 节点 | 参数与连线 |
| --- | --- |
| 开始 | 声明必填字符串 `run_id`、`tool_token`。快照、结果和权限均由后端管理。 |
| 获取本轮审计材料 | 调用 `getAuditContext`，从开始节点映射两个参数。读取 `mode`、`chunks`、`review_claims`。 |
| 判断是否复审 | 若 `mode=review`，使用 `review_claims`。否则进入「提取原文主张」。 |
| 提取原文主张 | 粘贴 [提取提示词](../agentarts/extract-claims.txt)。用户消息仅引用 `chunks`，不要映射 `tool_token`。结构化 JSON 输出 `claims`，类型为对象数组，每项的 `field`、`chunk_id`、`quote` 都是字符串。选低温度并关闭会话历史。 |
| 聚合候选主张 | 用变量聚合合并两条分支的数组。若数组为空，直接以空数组进入「提交核验回执」。 |
| 循环与分流 | 按候选数组串行循环。每轮用判断节点读当前项 `field`。批大小和学习率到 `verifyConfig`，随机种子到 `verifyCode`，F1 和准确率到 `verifyMetrics`。每个插件的 `claim` 引用当前项，另两个参数引用开始节点。工具失败时中断流程。聚合三个分支的 `check_id` 为单个字符串，再让循环输出累积为字符串数组。 |
| 提交核验回执 | 调用 `finishAudit`，映射两个开始参数和 `check_ids` 数组。只有服务端收到全部回执且平台确认工作流运行完成，项目才会生成报告。 |
| 结束 | 返回 `accepted` 和 `checked_count`，不输出令牌、源文件内容和模型推理日志。 |

参见 [导入 OpenAPI 插件](https://support.huaweicloud.com/lowcode-agentarts/agentarts_05_0126.html)、[分支变量聚合](https://support.huaweicloud.com/lowcode-agentarts/agentarts_05_0085.html)、[循环节点](https://support.huaweicloud.com/lowcode-agentarts/agentarts_05_0068.html)、[发布与 API 调用](https://support.huaweicloud.com/api-agentarts/agentarts_07_0047.html) 和 [SSE 事件协议](https://support.huaweicloud.com/api-agentarts/agentarts_07_0056.html)。

## 演示与验收

1. 使用 `backend/test_materials/agentarts/synthetic-paper.pdf`。修改示例文本后，可以从仓库根目录运行 `python backend/test_materials/agentarts/make_demo_pdf.py` 重新生成 PDF，也可以直接上传同目录的 TXT。
2. 进入新建项目的「项目验证 → AgentArts 投稿前审计」，上传论文、`training.yaml` 和 `train.py`，先留空结果计数并发起审计。
3. 预期批大小显示 64 对 32 的冲突并回溯到 PDF 第 1 页和 `train.batch_size`。学习率一致，随机种子为部分验证，F1 缺少计数为证据不足。
4. 点「基于此记录复审」，补传 `test-counts.json`。F1 从证据不足转为存在冲突，结果为 0.818182。其余条目沿用上一轮。历史记录保留两轮结论。
5. 打开 AgentArts 运行记录，展示模型节点、类型分流、工具调用和复审分支。录屏使用实际工作流。初赛提交时结合当期模板准备作品信息表、节点设计、场景介绍和演示视频，决赛按通知准备在线 Demo 和作品分享帖。

| 验证项 | 测试口径 |
| --- | --- |
| 核验规则 | 人工标注的规则样例覆盖一致、冲突、缺证、口径不可比和伪造引用。 |
| 本地端到端 | 使用真实 FastAPI 路由、材料上传、数据库和工具回调。AgentArts 一侧用协议级 HTTP/SSE 模拟。 |
| 云端端到端 | 在参赛工作空间发布后，按上面步骤核验可达性和模型额度，记录两轮真实运行。 |

比赛版仅核验批大小、学习率、随机种子、二分类 F1 和准确率。随机种子只核对 Python 源码中的字面设置。比较指标时论文原文需注明 `split=...`，二分类 F1 还需注明 `positive_label=...`。结果文件使用示例 JSON 结构，准确率的计数字段为 `correct` 和 `total`。模型只接收有界的论文文本片段，暂不支持扫描版 PDF 文字识别或运行上传的训练代码。

参见 [赛题二公开解读](https://www.10100.com/article/157567701) 与 [中国区赛事入口](https://e.huawei.com/cn/talent/#/ict/innovation-details?zoneCode=027425&zoneId=98269700&compId=85132021&divisionName=%E4%B8%AD%E5%9B%BD%E5%8C%BA&type=C002)。
