# 第七阶段 API 测试报告

日期：2026-11-18。

## 环境及执行

- 后端项目虚拟环境 Python：3.13.14。
- 执行 `PYTHONPATH=.../backend backend/.venv/Scripts/python.exe -m pytest --collect-only -q backend/app/tests`，退出码 4；应用导入阶段失败：`ModuleNotFoundError: No module named 'jwt'`。
- 未执行 API 测试、数据库写入或真实服务启动，不将测试文件存在视为 API 通过。
- 当前 API 聚合代码注册 health、llm、demo、audit_runs、projects、materials、parse_tasks、facts、overview、reproductions；未见 auth、org、team、case、rule、integration、governance 路由。

## API 风险审查

| 检查项 | 状态 | 证据/说明 |
|---|---|---|
| 请求/返回契约 | NOT_TESTED | 后端测试收集被依赖阻断 |
| HTTP 状态/错误结构 | NOT_TESTED | 无 HTTP 响应实测 |
| 权限与跨项目隔离 | FAIL（静态源码） | `projects.py` 查询全量项目；隔离 helper 未被路由引用 |
| 幂等/重复请求 | NOT_TESTED | 未并发或重复发送请求 |
| 参数边界/超时/异常 | NOT_TESTED | 未运行接口测试 |
| 公开 API/token | NOT_IMPLEMENTED | 当前路由聚合无开放 API 路由 |
| 认证、成员、撤权 | NOT_IMPLEMENTED | 无 auth/team 路由 |
| 路由覆盖 | PARTIAL | 旧阶段业务路由源码存在，缺少第六阶段规划的多组接口 |

## 后续验收要求

恢复依赖环境后，先在隔离数据库运行现有测试；然后覆盖未认证/无权限/跨组织 404、项目成员授权、管理员授权、删除/重复提交、上传边界和长任务状态。任何测试结果需保留原始命令、用例数和失败列表。
