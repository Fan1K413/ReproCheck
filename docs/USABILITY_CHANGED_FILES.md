# 本轮修改文件清单

日期：2026-11-24  
项目根：`C:\Users\ASUS\Desktop\科研复现审计官`  
说明：Git CLI 在本机不可用，无法用 `git status/diff` 证明文件归属。以下仅列出本轮任务中明确读取、修改或新增的文件；没有把其他工作线并行修改的 `pages/stores` 等文件算作本轮成果。新增文件标注“新增”，其余为修改。

## 1. 后端

| 文件 | 变更 | 作用 |
|---|---|---|
| `backend/app/api/v1/materials.py` | 修改 | 新增 `POST /materials/link-repository`；材料列表返回代码仓库 `external_url`；仅对代码仓库暴露 URL |
| `backend/app/services/material_service.py` | 修改 | 新增 `link_repository`：URL 协议校验、拒绝带账号密码、去重、复用 materials 表、`material_type=code_repository`、不下载/不执行 |
| `backend/app/api/v1/modelhub.py` | 修改 | 新增 `POST /model-credentials/test-draft`、`POST /model-setup`；临时凭据不落库；测试不再要求持久化加密密钥 |
| `backend/app/modelhub/gateway.py` | 修改 | `test_credential` 支持内存明文临时凭据；已保存凭据仍走解密路径 |

### 新增/变更接口

- `POST /api/v1/materials/link-repository`
  - 入参：`project_id`、`url`、可选 `name`
  - 权限：登录 + 项目成员权限
  - 行为：只登记 URL；不发起下载、不执行
- `POST /api/v1/model-credentials/test-draft`
  - 入参：`provider_key`、`api_key`、`model_id`、可选 `base_url`
  - 行为：真实调用服务商；密钥只存在本次请求内存；不写数据库/不写日志
- `POST /api/v1/model-setup`
  - 入参：服务商、密钥、模型、显示名、可选地址/超时/最大输出/温度
  - 行为：凭据与模型配置同事务保存；失败整体回滚；需要 `MODEL_CREDENTIAL_KEY`

## 2. 前端：新增 UX 组件与内容页

| 文件 | 变更 | 作用 |
|---|---|---|
| `frontend/src/ux/FirstRunExperience.tsx` | 新增 | 首次进入三步任务引导、五个目标、真实项目选择、一分钟教学；状态键 `rc:onboarding:v1` |
| `frontend/src/ux/GuidedModelSetup.tsx` | 新增 | 真五步 API 向导；服务商→密钥→模型→真实测试→保存；失败不显示保存 |
| `frontend/src/ux/PageHelpDrawer.tsx` | 新增 | 右滑帮助抽屉：是什么/何时用/准备/步骤/结果/FAQ/出错/术语；ESC、遮罩、焦点回退 |
| `frontend/src/ux/NextStepCard.tsx` | 新增 | 读取 materials/tasks/facts/plans/environments/runs/reports 真实数据，给出下一步 |
| `frontend/src/ux/glossary.tsx` | 新增 | 24 条术语字典、`Term` 悬停/聚焦解释、`GlossaryList` |
| `frontend/src/ux/pageHelp.ts` | 新增 | 所有主要真实路由的 7 段式帮助与兜底 |
| `frontend/src/pages/GuidedReproductionPage.tsx` | 新增 | 四步复现引导：项目选择/新建、论文/数据/代码、真实就绪、跳过、URL 状态 |
| `frontend/src/pages/UserManualPage.tsx` | 新增 | 11 章中文手册、目录筛选、术语表、错误处理、边界 |
| `frontend/src/styles/usability.css` | 新增 | 首次引导、帮助抽屉、下一步条等样式 |
| `frontend/src/styles/usability-guided.css` | 新增 | 四步复现引导布局与窄屏 |
| `frontend/src/styles/usability-model-manual.css` | 新增 | 五步 API 向导与手册样式 |
| `frontend/src/main.tsx` | 修改 | 引入三个新样式文件 |

## 3. 前端：改造既有页面

| 文件 | 变更 | 作用 |
|---|---|---|
| `frontend/src/App.tsx` | 修改 | 新增 `/start/reproduce`、`/manual` 两条 lazy 路由 |
| `frontend/src/workbench/WorkbenchPage.tsx` | 修改 | 首次无状态进入引导；`what=1` 直接目标页；保留径向工作台；监听重开事件 |
| `frontend/src/workbench/RadialWorkbench.tsx` | 修改 | 新增“我想做什么 / 中文手册 / 使用帮助”顶栏与 `onReopenGuide` |
| `frontend/src/workbench/EntryLauncher.tsx` | 修改 | 9 个入口、二级功能改任务语言；DAG→复现步骤清单；环境→实验环境 |
| `frontend/src/components/AppLayout.tsx` | 修改 | 主导航增加“我想做什么”；页头帮助按钮；NextStepCard；移除顶栏重复大标题；路由标题通俗化；Bloom 浮动帮助 |
| `frontend/src/pages/ModelCenterPage.tsx` | 修改 | 默认/`?tab=setup` 进入五步向导；原 7 个技术 section 全部保留为“高级管理模式” |
| `frontend/src/pages/LlmSettingsPage.tsx` | 修改 | 改为“系统 AI 状态”排错页；主 CTA 指向五步向导；系统测试保留 |
| `frontend/src/pages/MaterialsPage.tsx` | 修改 | 标题/说明通俗化；代码仓库隐藏解析/下载，显示“打开仓库”；顶部增加“登记代码仓库” |
| `frontend/src/pages/UserManualPage.tsx` | 修改 | 手册目录按章节名实时筛选；无匹配空态 |
| `frontend/src/pages/GuidedReproductionPage.tsx` | 修改 | 移除重复页头；换项目入口移入项目卡 |
| `frontend/src/ux/FirstRunExperience.tsx` | 修改 | 支持 `initialStage`，重开直接到目标页 |
| `frontend/src/ux/GuidedModelSetup.tsx` | 修改 | 真正拆成 5 个交互步骤；保存只在测试成功后出现 |
| `frontend/src/ux/pageHelp.ts` | 修改 | 新增 `home` 帮助与 `/?` 匹配；`openWhatToDo` 事件辅助 |
| `frontend/src/services/api.ts` | 修改 | 新增 `linkRepository` |
| `frontend/src/services/modelApi.ts` | 修改 | 新增 `testDraft`、`createGuidedSetup` |
| `frontend/src/types/api.ts` | 修改 | `MaterialType` 增加 `code_repository`；`MaterialView` 增加 `external_url` |
| `frontend/src/features/stage2Meta.ts` | 修改 | 代码仓库类型标签与色调 |
| `frontend/src/bloom/unitDetailParts.tsx` | 修改 | 代码仓库纳入代码类材料判定 |

## 4. 验收脚本与截图

| 文件 | 变更 | 说明 |
|---|---|---|
| `frontend/scripts/ux-baseline.mjs` | 新增 | 旧版 8 页面基线截图/文本 |
| `frontend/scripts/ux-verify.mjs` | 新增 | 首轮 8 场景验收 |
| `frontend/scripts/ux-verify-round2.mjs` | 新增 | 本轮 23 组场景：五步 API、真实失败、代码仓库、帮助、窄屏、旧路由 |
| `frontend/vite.verify.config.ts` | 新增（测试用） | 5174 隔离 Vite，代理到 8001 临时后端；正式开发仍用 5173→8000 |
| `.screenshots/usability/**` | 新增 | 基线、首轮、第二轮截图与 JSON 证据 |
| `.screenshots/usability/round2/usability-verify-round2.json` | 新增 | 本轮浏览器断言、API 状态、布局溢出结果 |

## 5. 文档

| 文件 | 变更 |
|---|---|
| `docs/USABILITY_ISSUE_INVENTORY.md` | 新增 |
| `docs/WORKBUDDY_UX_RESEARCH.md` | 新增 |
| `docs/USABILITY_NEW_USER_FLOW.md` | 新增 |
| `docs/USABILITY_API_SETUP_REDESIGN.md` | 新增 |
| `docs/USABILITY_GLOSSARY.md` | 新增 |
| `docs/USER_MANUAL.md` | 新增 |
| `docs/USABILITY_ONBOARDING.md` | 新增 |
| `docs/USABILITY_REAL_USER_TEST_REPORT.md` | 新增 |
| `docs/USABILITY_CHANGED_FILES.md` | 新增（本文件） |
| `docs/USABILITY_OPEN_ISSUES.md` | 新增 |
| `docs/USABILITY_DELIVERY_REPORT.md` | 新增（交付索引） |

## 6. 没有删除的东西

- 径向工作台、9 个入口、花瓣二级卡、ESC 关闭与键盘操作；
- `/settings/models` 原有 7 个技术 section 与所有路由；
- 真实 API 测试、真实材料上传、真实项目权限；
- 原有页面、权限、数据表；没有用 mock 数据替换真实接口；
- 没有把复杂功能简化成不可用的单页。

## 7. 运行说明

```powershell
# 后端（项目 venv）
cd C:\Users\ASUS\Desktop\科研复现审计官\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 前端
cd C:\Users\ASUS\Desktop\科研复现审计官\frontend
npm run dev -- --host 127.0.0.1 --port 5173

# 类型检查
npx tsc --noEmit

# 本轮浏览器验收（需要 5174 + 8001 隔离环境）
node scripts\ux-verify-round2.mjs
```

API 保存需要在后端环境配置 `MODEL_CREDENTIAL_KEY`（独立随机密钥，不要复用 JWT_SECRET）。未配置时测试可以真实调用，但保存会明确失败，不会伪造成功。
