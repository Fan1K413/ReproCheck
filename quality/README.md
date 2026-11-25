# ReproCheck 独立质量档案（第七阶段）

> 维护者：独立质量保障智能体（QA），不承担功能开发。
> 首次建立：2026-11-24 11:00（Asia/Shanghai）
> 最近一次全量审计：2026-11-24 10:30–11:05

## 这个目录是什么

ReproCheck 的长期质量档案。只记录**真实执行过的检查**、**可复现的证据**和**明确标注的未验证项**；不填充虚构测试结果，不把未执行写成通过。

本目录与项目已有的质量资料并存、不替代：

- `docs/stage10/`：第十阶段 12 份交付文档（含安全、性能、回归报告）
- `docs/STAGE7_*`：早期第七阶段报告（2026-11-18）
- `audit-reports/`：代码审查与统计审计报告
- `docs/STAGE6_REAL_STATUS.md`：第六阶段真实能力清单

## 当前结论（2026-11-24）

| 项目 | 结果 |
|---|---|
| 后端全量测试 | **359 passed / 0 failed**（58.98s，6 warnings） |
| 前端 typecheck | **exit 0** |
| 前端生产构建 | **exit 0**（index 313.67 kB / gzip 98.28 kB，6.52s） |
| 真实用户主流程 | 创建→上传 4 文件→解析→事实→概览→手动规划→新增任务→生成 14 章报告→重进持久化：**链路可走通**；AI 事实抽取与真实执行**阻塞**（无 LLM Key / 无执行沙箱） |
| 移动端 390×844 横向溢出 | 8 个关键路由均无溢出 |
| **质量门禁** | **BLOCKED — 不通过** |

阻断项（详见 `BUG_TRACKER.md`、`SECURITY_AUDIT.md`）：

1. 默认运行配置下，匿名请求可读取全部项目/材料/解析任务并下载材料文件（实测 200）。
2. 匿名请求可上传材料、删除任意材料（实测 200）。
3. `viewer`（只读角色）可上传材料（实测 200）；25 个写端点使用「任意已登录即放行」的 `require_admin`，未校验 `material.upload` / `audit.run` 等权限。
4. 材料详情抽屉在 1440×900 下操作栏落到视口外（footer y=1110、bottom=1183），需页面滚动 307px 才能触达；scrim 不覆盖顶栏。

## 目录结构

```
quality/
├── README.md                 # 本文件：角色、口径、当前结论
├── PROJECT_MAP.md            # 仓库/服务/数据库/路由/接口地图
├── MODULE_INVENTORY.md       # 模块清单与真实能力状态
├── BUG_TRACKER.md            # 缺陷台账（P0/P1/P2/P3）
├── REGRESSION_TRACKER.md     # 基线、回归执行记录与风险
├── API_AUDIT.md              # 244 个 API 操作的契约与鉴权审计
├── SECURITY_AUDIT.md         # 鉴权、隔离、配置与输入面
├── PERFORMANCE_AUDIT.md      # 接口/构建/页面加载实测
├── TEST_COVERAGE.md          # 后端 359 项测试与前端测试缺口
├── RELEASE_CHECKLIST.md      # 质量门禁逐项判定
├── reports/
│   ├── initial-audit.md      # 首轮审计报告（按第七阶段第九节格式）
│   ├── api-audit.json        # API 探针原始结果
│   ├── user-journey.json     # 用户主流程走查记录
│   └── screens/              # 真实截图证据
└── tools/
    ├── api_audit.py          # 可重放的 API 鉴权/隔离探针
    └── user_journey.mjs      # 可重放的浏览器主流程走查
```

## 口径与边界

- **不修改业务逻辑**：发现缺陷只登记、给修复建议，交由对应开发智能体处理。2026-11-24 应用户要求执行过一次纯注释清理（无逻辑改动，359 项测试复验通过），详见下方「清理记录」。
- **不覆盖他人未提交修改**：仅改动指定注释行，不重排、不合并其他智能体的未提交代码。
- **不伪造数据**：LLM 未配置时，解析任务真实返回 `partially_completed / LLM_NOT_CONFIGURED / 0 facts`；报告与页面均按此展示。
- **测试环境**：Windows 11、Python 3.13 venv、Node 22、Edge（Playwright `channel=msedge`）、SQLite 本地库；非生产环境、非容器环境。
- **未验证项**：真实论文实战、真实 LLM Key 抽取、真实代码执行沙箱、并发/压力、备份恢复、移动端真机。

## 复跑方式

```powershell
# 后端全量
cd backend
$env:PYTHONPATH = "."
.\.venv\Scripts\python -m pytest -q

# 前端门禁
cd ..\frontend
npm run typecheck
npm run build

# API 鉴权/隔离探针（需 8000 端口在跑）
cd ..
.\backend\.venv\Scripts\python quality\tools\api_audit.py

# 浏览器主流程（需 5173/8000 在跑）
node quality\tools\user_journey.mjs
```

## 证据索引

| 证据 | 路径 |
|---|---|
| API 探针原始 JSON | `quality/reports/api-audit.json` |
| 主流程记录 | `quality/reports/user-journey.json` |
| 创建成功 | `quality/reports/screens/01-project-created.png` |
| 4 文件上传成功 | `quality/reports/screens/02-materials-uploaded.png` |
| 无 Key 事实页 0 条 | `quality/reports/screens/04-facts.png` |
| 解析任务部分完成 | `quality/reports/screens/14-parse-task-partial.png` |
| 手动规划 | `quality/reports/screens/06-reproduction-overview.png` |
| 新增任务 | `quality/reports/screens/07-plan-task.png` |
| 14 章报告 | `quality/reports/screens/10-report-generated.png` |
| 抽屉操作栏越界 | `quality/reports/screens/12-material-drawer-1440.png`、`13-material-drawer-scrolled.png` |
| 390 宽材料页 | `quality/reports/screens/11-mobile-materials.png` |

## 清理记录（2026-11-24）

- 删除生成物：项目内 `__pycache__`、`.pytest_cache`、`.pytest_tmp*`、根/前端日志、`frontend/dist`、临时脚本 `backend/_inspect.py`。
- 删除未被任何文档/代码引用的设计草稿与旧截图：`workbench-radial/`、根目录 bloom/visual 样稿、`.screenshots` 根目录 276 个孤儿文件（保留 docs 引用的 final/v2-final/v3-final/v4-final 与子目录）。
- 源码清理：移除 26 处“不伪造/不编造/如实”等自我说明式注释，统一 248 处装饰性分隔注释；未改任何条件、数据结构、接口或业务分支。
- 未删除：业务源码、数据库及备份、docs、Plan、被 docs 引用的截图、`.venv`、`node_modules`。
- 复验：`pytest 359 passed / 0 failed`；`npm run typecheck`、`npm run build` 均 exit 0。
- 合计回收约 165 MB；删除清单与判定依据见本轮对话，执行前均做过引用检查。

## 变更纪律

- 每轮审计追加记录，不删除历史结论；已修复项在 `BUG_TRACKER.md` 标记 `Fixed` 并保留原证据。
- 质量门禁结论只能由证据支撑；测试环境不完整时标 `BLOCKED`，不标 `PASS`。
- 下一轮优先复核本文件「阻断项」1–4。
