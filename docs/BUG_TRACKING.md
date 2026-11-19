# 缺陷跟踪

| ID | 优先级 | 描述 | 证据 | 状态 |
|---|---|---|---|---|
| BUG-001 | P0 | 阶段3与阶段4在不同分支，阶段3未提交，没有可运行的完整产品 | `git worktree list`；两分支都改了 api/__init__.py、App.tsx | 待决策（需提交/合并授权） |
| BUG-002 | P0 | 无用户体系，无法做跨用户隔离 | api/deps.py:12 仅共享令牌 | 待决策（架构变更） |
| BUG-003 | P0 | 创建项目及全部读接口无鉴权 | projects.py / overview.py / audit_runs.py 中 require_admin=0 | 待修复 |
| BUG-004 | P1 | 真实模型调用无法验证 | 无 .env，LLM_API_KEY 为空 | 阻塞：需用户提供 Key |
| BUG-005 | P1 | 真实代码执行不可用 | `docker: command not found` | 阻塞：需授权安装 Docker 或改为静态审计模式 |
| BUG-006 | P1 | 复核署名是自填文本，不是真实身份 | stage3 ReviewInput | 依赖 BUG-002 |
| BUG-007 | P2 | stage4 前端缺 lint、test 脚本 | frontend/package.json scripts | 待修复 |
| BUG-008 | P2 | react-router 2 个 moderate 漏洞 | npm audit | 待修复（主版本升级） |
| BUG-009 | P2 | 阶段3来源导航前端未接入 | auditApi.ts 无 /sources 调用 | 待修复 |
| BUG-010 | P3 | 测试运行在 backend/storage/materials 下残留 6 个 proj-* 目录 | stage3 worktree git status | 待确认归属 |
