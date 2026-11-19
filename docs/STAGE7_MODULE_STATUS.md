# 第七阶段模块状态表

审计日期：2026-11-18。PASS 仅限本轮有直接运行证据的检查；不以页面/API 存在等同于业务通过。

| 模块 | 状态 | 已核验事实 | 未验证/阻断 |
|---|---|---|---|
| Git/工作区保护 | PARTIAL | 分支 `stage4/reproduction-engine`；发现未提交改动并保留 | stage6 代码最终用途/完整性待项目负责人确认 |
| 前端依赖与类型 | PASS（类型检查） | `npm run typecheck` 退出码 0 | 仅类型检查，不代表浏览器操作 |
| 前端生产构建 | PASS（构建） | `npm run build` 成功，Vite 转换 1666 modules；本地开发服务首页 HTTP 200 | 未在生产域名部署；浏览器自动化缺 Chrome |
| 前端依赖安全 | FAIL（生产依赖告警） | `npm audit --omit=dev --audit-level=moderate` 报 2 moderate react-router 公告，退出码 1 | 修复涉及主版本升级，未做破坏性迁移 |
| 后端环境 | BLOCKED | `.venv` Python 3.13.14 可用 | pytest 收集被缺少 PyJWT 阻断；未执行测试 |
| 路由/API | PARTIAL | API 路由源代码可见，基础路径 `/api/v1` | 没有 HTTP 服务 E2E 证据 |
| 注册/登录/退出 | NOT_IMPLEMENTED | auth helper 和模型存在 | 无 auth API 路由与前端登录/注册页面 |
| 组织/团队/邀请 | NOT_IMPLEMENTED | stage6 模型/规划文档存在 | 无 API 路由和用户流程 |
| 权限与项目隔离 | FAIL | isolation helper 存在 | 未挂载到路由；项目列表无鉴权、无所有权过滤 |
| 材料管理 | PARTIAL | 多格式解析器及材料 API、测试源码存在 | 本轮未运行后端测试/真实上传，文件安全边界未实测 |
| AI 科研解析 | BLOCKED | LLM 配置/服务存在 | 无 `.env`、未提供 Key、未真实调用 |
| 确定性审计/证据 | PARTIAL | stage1/2 服务源码和测试文件存在 | 真实论文准确性、漏报/误报与证据定位未实测 |
| 复现规划/比较/诊断 | PARTIAL | stage4 服务/API/UI 源码存在 | 无 Key 时 AI 阻断；无沙箱时真实执行阻断 |
| 代码隔离执行 | BLOCKED | 默认禁用、无执行后端配置 | Docker/GVisor 未验证可用；不执行上传代码 |
| 长任务恢复/Worker | NOT_TESTED | 有解析任务模型/API | 未验证页面刷新、worker 重启、队列与取消 |
| 报告/HTML | PARTIAL | 报告服务/API/UI 源码存在 | 真实数据报告完整性未测 |
| PDF 导出/打开 | NOT_TESTED | 代码中有导出端点 | 依赖可用性、文件有效性和字体未测 |
| 数据库迁移/回滚 | NOT_TESTED | 启动迁移及 stage6 迁移代码存在 | 未执行真实/临时数据库升级、降级、备份恢复 |
| 科研案例库/规则/RAG | NOT_IMPLEMENTED | 需求/迁移规划文本存在 | 当前 API 路由目录无实现证据 |
| 仓库连接/开放 API | NOT_IMPLEMENTED | 规划文档有契约 | 无对应 API/router 前端流程 |
| 部署/域名/HTTPS/监控 | BLOCKED | 未发现部署编排文件 | 无生产环境、授权和部署凭据 |

## 结论

当前可确认为 PASS 的仅有前端类型检查与生产构建这两项工程检查。核心用户流程和上线门槛均未满足；总体发布状态为 `NOT_READY`。
