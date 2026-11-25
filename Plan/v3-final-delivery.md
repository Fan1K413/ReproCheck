# ReproCheck V3「NO LEGACY UI」最终验收交付

> 任务代号：NO LEGACY UI —— 全站原生界面重建 V3
> 交付时间：2026-11-23
> 仓库：`C:\Users\ASUS\Desktop\科研复现审计官`
> 判定口径：以中央工作台 `/` 为唯一最高设计基准；任何页面不得使用旧 UI 截图伪装。

---

## 一、交付结论

V3 全站原生界面重建**已完成并通过验收**。所有业务页面、登录页、Bloom 沉浸式视图均由
React 组件 + CSS + 内联 SVG 原生渲染，未使用任何旧 UI 截图、图片背景或 iframe 伪装。
全站共用一套 Design System（`--rc-*` token + `rc-app-universe` 深色空间层 + 统一组件库）。

| 验收项 | 结果 |
|---|---|
| 业务路由浏览器验收 | **39/39 PASS**（桌面 + 移动双视口） |
| Bloom 视图验收 | **3/3 PASS**（绽放舞台 / 工坊 / 证据织机） |
| 登录页（独立未登录上下文） | PASS，原生 SVG，0 张图片 |
| 功能目录抽屉真实交互 | PASS（打开存在 dialog / aria-modal，Esc 关闭） |
| 项目关系展开、材料筛选交互 | PASS |
| 反截图源码扫描 | PASS（120 文件，无 img 背景 / data:image / iframe / video） |
| console / pageerror / 失败请求 | 0 / 0 / 0 |
| 后端回归 | **357 passed** |
| 前端 typecheck + build | PASS |
| 主工作台待机帧率 | 59.7 fps（软件合成基线），真 GPU 参考 ~60 fps |
| Bloom 展开动画帧率 | 软件合成基线 20.5 fps；**真 GPU 中位数 59.1 fps** |

---

## 二、设计系统（唯一全站视觉源）

- **唯一色源**：`frontend/src/styles/tokens.css` 的 `--rc-*` token（品牌紫、背景、玻璃、边框、文本、状态色、字体、间距、圆角、动效、图标尺寸）。
- **全站统一空间层**：`frontend/src/styles/rc-unified.css`
  - `.rc-app-universe`：紫黑折叠场径向渐变底，覆盖所有 L2 页面。
  - `.rc-l2-header` / `.rc-page-header` / `.rc-app-main`：统一顶栏、页面头、内容区。
  - `.rc-auth-stage` / `.rc-auth-orbit` / `.rc-auth-card`：原生登录页视觉。
  - `rc-page-in` 页面切换动画。
- **统一组件**：`Icon`（内联 SVG）、`PageHeader`、`Modal`、`Tabs`、`DataTable`、
  `LoadingState` / `EmptyState` / `ErrorState`、`StatusBadge`、`AppLayout`。
- **图标**：全部内联 SVG，全站无位图图标。
- **材质**：磨砂玻璃（`backdrop-filter`）、顶部高光线、低饱和紫光晕。

### 关键文件改动
| 文件 | 改动 |
|---|---|
| `frontend/src/main.tsx` | 导入 `styles/rc-unified.css` |
| `frontend/src/components/AppLayout.tsx` | 外层挂 `rc-app-universe`，`<main>` 挂 `rc-app-main`；抽屉仅在打开时挂载，真实 dialog/aria-modal |
| `frontend/src/components/PageHeader.tsx` | 统一 `.rc-page-header`，新增 `eyebrow` |
| `frontend/src/pages/auth/LoginPage.tsx` | 完整重写为 V3 原生登录页，保留真实登录/注册/演示账户 |
| `frontend/src/styles/index.css` | `.panel` / `.field-input` 改为紫黑玻璃 + 高光 + 紫色 focus |
| `frontend/src/bloom/bloom.css` | 性能与形变窗口优化（见第五节） |
| `frontend/src/workbench/FoldFieldCanvas.tsx` | 静态低分辨率绘制（SAMPLES 64→44，RENDER_SCALE 0.55），去除逐帧 rAF |
| `frontend/src/bloom/BloomCard.tsx` | 详情延迟到形变尾段挂载（780ms），避免与动画同帧竞争 |

### 浅色皮肤清理
移除 12 个页面的 `data-rc-skin="light"`（LLM 设置、复现报告、API 令牌、基准案例、
案例详情、反馈治理、组织、项目团队、角色、规则、集成、数据治理等），全站再无浅色断层。
grep 复核仅剩注释说明。

---

## 三、路由与页面改造清单

完整路由清单见 `Plan/v3-route-inventory.md`。验收覆盖 39 条业务路由 + 3 个 Bloom 视图：

- 中央工作台 `/`、项目列表 `/projects`、新建项目、项目工作台
- 材料链、复现链、结果对照、AI 诊断、报告中心
- stage6 协作治理链：组织/角色/项目团队/基准案例/案例详情/事实字段/审计规则/反馈治理/知识检索/外部集成/API 令牌/数据治理
- 设置：LLM 配置、模型配置
- Bloom 三视图：`?view=stage` / `?view=atelier` / `?view=loom`
- 路由兜底页

每一页均通过双视口 DOM 断言：`universe` 容器存在、原生渲染、无崩溃、无横向溢出、标题/内容符合预期。
截图证据：`.screenshots/v3-final/`（85 张）。

---

## 四、验收证据

| 证据 | 路径 |
|---|---|
| 全站验收报告 | `.screenshots/v3-final-report.json` |
| 全站截图（85 张） | `.screenshots/v3-final/` |
| 性能报告 | `.screenshots/v3-performance-report.json` |
| 改造前基线 | `.screenshots/v3-baseline/` |
| Wave 1 过程 | `.screenshots/v3-wave1/` |
| 验收脚本 | `frontend/scripts/v3-no-legacy-verify.mjs`、`frontend/scripts/v3-performance.mjs` |
| 计划/设计/规范 | `Plan/v3-no-legacy-ui_plan.md`、`v3-design-system.md`、`v3-route-inventory.md`、`v3-interaction-spec.md` |

### 验收脚本关键能力
- 独立未登录浏览器上下文验证 `/login`（规避旧脚本已登录态误判）。
- 真实 API 登录取 token，逐路由注入登录态。
- 真实交互：抽屉开合（aria-modal）、项目关系展开、材料筛选、Bloom 卡片点击。
- 源码反截图扫描：`<img>` / `background-image:url(...)` / `data:image` / `iframe` / `video`。

---

## 五、性能优化记录

主工作台曾低至 13.7 fps，经多轮优化回到 ~60 fps：
- FoldField Canvas 改为一次性静态低分辨率绘制，取消逐帧 rAF。
- Bloom 详情区延迟到形变尾段挂载。
- 移除高成本 `drop-shadow`、`clip-path` 过渡；收窄 `transition-property`、`will-change` 至活动期。

Bloom 展开动画是最后瓶颈。逐层消融（真 GPU / Radeon 780M）定位：

| 消融项 | 帧率 |
|---|---|
| baseline | 41.8 fps |
| 关表面斜纹纹理 `::before` | 56.8 fps |
| 关叠加描边 `::after` | 60.0 fps |
| 关中层渐变光晕 | 59.1 fps |

据此在形变窗口（`is-open:not(.is-revealed)` / `is-morphing`，约 800ms）内临时降级这三层纯装饰，
动画结束自动恢复，静态视觉不变。固定 GPU 后端连续 5 次展开：
`52.7 / 59.1 / 59.1 / 59.1 / 60.5`，**中位数 59.1 fps**（首次 52.7 为冷启动）。

> 性能脚本声明：`.screenshots/v3-performance-report.json` 采用 headless Edge `--disable-gpu`
> 软件合成，**仅用于同环境相对回归**，不等同真机 GPU 帧率。真机 GPU 数据由一次性对照测量
> 取得（AMD Radeon 780M，D3D11），并已在验收后清理临时脚本。

---

## 六、未完成项 / 已知限制（如实列出）

1. **Bloom 展开动画的软件合成基线仍为 20.5 fps**：在 `--disable-gpu` 的 CPU 软件光栅化下，
   大卡 transform 逐帧重绘整张花瓣，无法达到 60。真 GPU（含核显）中位数 59.1 fps，
   判定为测试环境限制而非代码缺陷；**真机低端集显 / 移动端的展开动画建议人工复测**。
2. **bundle 体积警告**：构建产物 `index-*.js` 约 1.04 MB（gzip 288 kB），
   Vite 提示 >500 kB chunk。未做路由级 code-splitting / manualChunks，不影响功能，
   后续如需首屏优化可按需拆分。
3. **子代理独立复核未完成**：`visual-architect`、`codebase-audit` 因 429 频率限制未能完成
   独立复核，本轮验收由主流程脚本与消融测量完成；若额度恢复建议追加一次独立视觉走查。
4. **首次展开冷启动帧**：5 次测量中首次 52.7 fps（其余 59.1+），为页面加载后首次形变，可接受。

---

## 七、回归命令（可复现）

```bash
# 后端
cd backend && ./.venv/Scripts/python.exe -m pytest -q   # 357 passed

# 前端
cd frontend
npm run build                              # typecheck + vite build
node scripts/v3-no-legacy-verify.mjs        # 39/39 + 3/3 + 反截图 + 交互
node scripts/v3-performance.mjs             # 性能基线（软件合成，相对回归）
```

前置：后端 `uvicorn app.main:app --port 8000`（在 `backend/` 目录内启动，确保演示账号库路径正确），
前端 `vite --port 5173 --strictPort`。
