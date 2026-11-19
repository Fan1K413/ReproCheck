# 第七阶段缺陷跟踪

更新：2026-11-18。优先级按上线风险排序；状态仅代表当前观察。

| ID | 级别 | 缺陷 | 证据/复现 | 修复状态 |
|---|---|---|---|---|
| S7-001 | P0 | 用户注册/登录入口未实现，核心用户无法独立使用 | API 聚合与 `App.tsx:21-48` 路由检查 | 未修；需实现与测试 |
| S7-002 | P0 | 项目列表无身份过滤，跨用户数据隔离未接通 | `projects.py:27-31` 查询全部 Project；`isolation.py:84-97` 全仓仅定义无路由调用 | 未修；上线阻断 |
| S7-003 | P0 | `require_admin` 对任意活跃用户 JWT 直接放行，不检查角色/权限/项目成员 | `deps.py:50-65`；调用见 `materials.py:32,117`、`facts.py`、`parse_tasks.py`、`reproductions.py` 多个写接口 | 未修；需改用最小权限校验并逐路由回归 |
| S7-004 | P1 | Stage6 组织/团队/协作/案例等设计未落业务 API | API 聚合缺对应 router | 未修；部分为未实现功能 |
| S7-005 | P1 | 后端测试无法收集 | 项目 venv pytest 导入 `jwt` 缺失，退出码 4 | BLOCKED；未安装依赖 |
| S7-006 | P1 | 真实 AI 功能未实测 | 无 `.env`/Key | BLOCKED；需凭据/授权 |
| S7-007 | P1 | 真实执行沙箱不可用 | 配置禁用、backend none；隔离 Worker 不存在 | BLOCKED；需隔离基础设施 |
| S7-008 | P1 | JWT 密钥默认占位值、测试无鉴权默认开启 | `core/config.py` | 未修/生产覆盖未知 |
| S7-009 | P1 | 未做真实用户主流程/科学准确性验证 | 未启动浏览器 E2E；Playwright 启动因本机未安装 Chrome 失败 | NOT_TESTED |
| S7-010 | P2 | CORS 全源开放 | `main.py` | 未修；部署前收敛 |
| S7-011 | P2 | Stage6 Alembic revision 文档/代码不一致 | 迁移计划提及 0003，目录无该 revision | 未修 |
| S7-012 | P2 | 没有性能及移动端结果 | 本轮无性能/浏览器实验 | NOT_TESTED |
| S7-013 | P2 | 前端生产依赖存在 2 个 moderate 安全公告 | `npm audit --omit=dev --audit-level=moderate` 退出码 1；涉及 react-router 与 react-router-dom 6.30.6，建议更新会涉及破坏性主版本变更 | 未修；须评估兼容性后处理 |
| S7-014 | P2 | 浏览器运行时视觉/交互验收无法进行 | `playwright-cli open http://127.0.0.1:5173/` 报 Chrome 未安装 | BLOCKED；未安装浏览器 |

本轮未修改上述缺陷；避免在未确认迁移/权限设计、无法执行后端回归和浏览器验证的情况下实施不完整安全/依赖修复。未提交代码补丁。
