# 交付 10：API 测试结果（第十一阶段）

## 测试组与性质

独立新增测试文件，不修改历史断言：
- `backend/app/tests/test_modelhub.py`：16 项（注册表/能力矩阵/加密/SSRF/三种适配器协议/网关/API）。
- `backend/app/tests/test_research_features.py`：4 项（实验差异 + 变化监控）。

## 覆盖清单

| 类别 | 覆盖 | 状态 |
|---|---|---|
| 10 家供应商注册表与官方端点 | 协议、能力矩阵、联调状态标记 | 通过 |
| 能力不支持 | `CAPABILITY_UNSUPPORTED` + 明确原因 | 通过 |
| OpenAI 兼容适配 | 正常、401、429、流式 SSE、`/models` | 通过（MockTransport） |
| Anthropic 原生适配 | system 分离、角色映射、`x-api-key`、usage | 通过（MockTransport） |
| Gemini 原生适配 | contents 角色、JSON MIME、`x-goog-api-key`、usageMetadata | 通过（MockTransport） |
| 正确/错误 Key | 凭据创建 + 连接测试 success / auth_failed | 通过（模拟响应） |
| 错误 Base URL / 私网 / 元数据 / userinfo | SSRF 拒绝 422 | 通过 |
| 超时 / 限流 / 服务不可用 | httpx 状态与异常映射 | 通过（模拟） |
| 返回格式异常 | `LLM_INVALID_FORMAT` 与一次修复 | 通过（既有 + 新增） |
| 结构化 JSON | Pydantic `extra=forbid` + 网关校验 | 通过 |
| 用户凭据隔离 | 跨用户 PATCH 返回 404、列表为空 | 通过 |
| API Key 脱敏 | 创建/列表响应无明文、无密文列 | 通过 |
| 凭据撤销 / 删除 | revoke / purge | 通过 |
| 模型切换与备用策略 | 主模型 500 → 用户配置备用模型成功并记录原因 | 通过（模拟） |
| 流式输出 | SSE 增量拼接 | 通过（模拟） |
| 任务绑定往返 | PUT/GET 绑定、默认/备用标记 | 通过 |
| 调用统计 | 次数、成功/失败、Token、P95、分组、费用标注 | 通过 |
| 新功能 | 相关性标注、至少两个运行、文档变化不重跑、配置变化需确认 | 通过 |

## 真实联调声明

**未进行任何真实供应商联调**：本环境没有授权的真实 API Key。
所有供应商调用均由 `httpx.MockTransport` 在协议层模拟；Site 版 `realTest()` 用真实 `fetch` 实现，
但浏览器实测使用无效 Key 对千问端点发起调用，返回 `auth_failed`，证明"不会假成功"，
不能证明"成功路径已真实联调"。

浏览器实测中，保存无效 Key 后自动连接测试返回：
```
连接失败：auth_failed
LLM_INVALID_KEY API Key 无效或已过期，请检查该模型凭据的配置。
```
这是符合预期的失败语义，而非真实连接成功。

## 回归

`PYTHONPATH=. python -m pytest -q` → **357 passed**（含历史 219 项基线与本阶段新增测试；
退出码受 Windows 临时目录清理的 atexit 权限警告影响，测试结果全部通过）。
未删除任何历史测试，未降低断言标准。

## 不经测试宣称的事项

- 不宣称任何供应商"真实连接成功"或"已完成真实费用结算对接"。
- 不宣称 Site 版已真实部署到云端（平台注入模块不在仓库）。
