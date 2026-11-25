# ReproCheck NO LEGACY UI · V3 全站原生重建计划

## 状态
进行中（Wave 1 公共底座已完成并进入全站验收）

## 不卡死计数
- 视觉成员：1 次失败（429，20:12:53 重置）
- 审计成员：1 次失败（429，20:12:53 重置）
- 当前处置：主代理继续执行；恢复后必须独立复核，不得把主代理结论直接当成员结论。

## 目标
以登录后可访问的 `/` 径向主工作台为唯一最高视觉基准，重建全部真实可访问二级页面。所有界面必须是 React/CSS/SVG/Canvas 原生组件与真实交互，禁止旧 UI 截图、Base64 图片伪装、iframe、视频伪装、静态假按钮和假业务数据。

## In Scope
- `frontend/src/App.tsx` 当前挂载的全部 40 条可访问路由与登录页。
- `AppLayout` 全局功能目录、顶栏、L2 页面骨架。
- 项目 Bloom 工作台 4 个视图（舞台/focus/atelier/loom）作为项目空间层级，但视觉材质向 `/` 主工作台收敛。
- 统一 Design Tokens、图标、公共组件、动效和页面布局语言。
- 反旧截图扫描、浏览器截图、交互、构建、后端回归与性能验收。

## Out of Scope
- 不改业务权限、后端接口语义、数据库结构。
- 不删除真实论文/科研/用户上传素材；截图仅作为验收证据。
- 不做生产部署、不重置 Git 工作区、不覆盖用户既有未提交成果。

## 需求 → 步骤映射
1. 提取 `/` 真实设计基准 → 建立 `tokens.css` + `rc-page.css` 统一语义层。
2. 全站路由审计 → 逐页记录旧 UI 风险，形成页面清单。
3. 公共底座重建 → AppLayout、登录页、PageHeader/Card/Modal/Table/Tabs 等组件统一。
4. 二级页面分批原生重建 → 保留原 hooks/API/权限，替换外壳、卡片、表格、空态、错误态、操作按钮。
5. 反截图审计 → 检索 img/background/base64/iframe/canvas，确认真实用途。
6. 浏览器验收 → 40+ 路由真实打开、桌面/移动截图、控制台和失败请求采集。
7. 回归与性能 → typecheck/build、后端测试、核心交互、FPS/掉帧记录。
8. 汇编交付 → 路由清单、完成状态、遗留、设计系统、组件清单、测试报告。

## P0 / 阻断级
- 主工作台视觉基准真实可运行，无 pageerror、无旧截图冒充。
- 统一 token 与全局页面骨架可用。
- typecheck/build 通过。

## P1 / 核心级
- 40 条可访问路由均真实渲染并连接现有业务。
- 登录、项目、材料、任务、事实、复现控制台、结果对照、报告、组织/权限等主要操作可真实触发。
- 双视口无横向溢出、无假交互、无控制台错误。

## P2 / 完善级
- 动效性能接近 60 FPS，重交互不低于可接受阈值并记录证据。
- bundle 警告与已知性能债如实披露。

## Wave 划分
- Wave 0：真实服务、基线巡检、计划与回退点。
- Wave 1：公共设计系统 + AppLayout + 登录页。
- Wave 2：项目空间（projects/new/Bloom workbench）。
- Wave 3：材料解析链（materials/detail/tasks/facts/evidence/overview）。
- Wave 4：复现链（reproduction 7 页 + console）。
- Wave 5：验证/交付/治理（verification/handoff/diff/monitor/data/stats/stage6 13 页）。
- Wave 6：全站验收、反截图、性能、报告。

## 风险与缓解
- 工作区已有大量未提交改动：改任何既有文件前创建同目录 `.bak`；不重置、不覆盖。
- 40+ 页面范围大：按路由分批；每批完成 typecheck + 浏览器截图，不让半成品进入下一批。
- 历史“已完成”不可信：所有验收以当前运行页面和新报告为准。
- LLM Key 未配置：AI 分析链路返回 503 是真实环境限制，不做假成功。

## 回滚
- 每批修改前保存 `.bak`；失败时按 `.bak` 局部恢复。
- 构建或浏览器验收失败即停止该 Wave，先修根因，不扩大修改范围。

## 验收口径
- “完成”= 源码真实重构 + typecheck/build 通过 + 路由实际打开 + 截图证据 + 交互/回归证据。
- “未完成”= 任一项缺失，必须在最终报告逐项列出。

## Wave 1 实测记录
- `npm run typecheck`：通过。
- `npm run build`：通过（CSS 317.02kB / JS 1043.14kB；保留 >500kB chunk 警告）。
- 登录页重构：真实 React/CSS/SVG，含登录/注册、演示账号填充与真实 API。
- AppLayout：统一深色空间背景、按需 Drawer、顶栏高光与统一页面头。
- 页面级浅色皮肤：12 个页面已移除 `data-rc-skin="light"`。
- 源码反截图扫描：未发现 `<img>` UI、`background-image:url(...)`、`data:image`、`iframe`、`video`。
