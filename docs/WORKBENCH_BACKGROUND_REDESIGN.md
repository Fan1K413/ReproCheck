# 一级主工作台背景重设计 · 交付报告

> 本文件是第一轮背景记录，部分实现与参数已在第二轮替换。最终验收见 `docs/WORKBENCH_SPATIAL_ROUND2.md`。

> 改造对象：ReproCheck 一级主工作台（径向圆盘 + 9 个外围功能入口）背景。
> 改造原则：**保留品牌紫阶配色，彻底替换原放射褶皱/扇形条纹构图**；不改动圆盘、入口位置、图标功能与跳转关系。
> 验证环境：本地 Edge（Playwright 驱动），dev server `http://127.0.0.1:5173`；全部截图与指标来自真实运行页面。

## 1. GitHub 参考仓库清单

实际克隆到本地研究区、阅读 README / 源码 / LICENSE 的仓库：

| # | 仓库 | 许可证 | 版权 | 技术路线 |
| --- | --- | --- | --- | --- |
| 1 | [godwire/react-aurora-background](https://github.com/godwire/react-aurora-background) | MIT | Copyright (c) 2026 godwire | React + WebGL1 GLSL，simplex fBm 极光，自适应画质、上下文丢失恢复、可见性暂停 |
| 2 | [TheNaubit/react-aurora-background](https://github.com/TheNaubit/react-aurora-background) | MIT | Copyright (c) 2022 Albert Adler \| Naucode | WebGL 加权高斯光斑，≤256px 离屏渲染、30fps 上限、标签页隐藏暂停、CSS 静态降级 |
| 3 | [nonlineartom/gradient-backdrops](https://github.com/nonlineartom/gradient-backdrops) | MIT | Copyright (c) 2026 nonlineartom | 多风格 GLSL 背景，OKLab 混色、抖动降噪、离屏暂停、CSS fallback |
| 4 | [LalithK90/background-lab](https://github.com/LalithK90/background-lab) | MIT | Copyright (c) 2026 Lalith K | 原生 HTML 实验集：CSS 极光、SVG goo 流体、Three.js WebGL |
| 5 | [kmikeym/motion-backgrounds](https://github.com/kmikeym/motion-backgrounds) | CC0 1.0 | 公有领域 | 纯 CSS/SVG 模糊光斑网格，零 JS |
| 6 | stevesouth/css-mesh（npm，调研阶段参考） | MIT | — | 纯 CSS 模糊椭圆网格 |

调研方式：克隆仓库 → 阅读 README 与目录结构 → 阅读着色器/控制器源码与 LICENSE → 对照工程模式（画质降级、暂停策略、资源回收、上下文恢复）逐一核对。未复制任何演示页面、静态壁纸或商业素材。

## 2. 实际研究过的六种方案

| 方案 | 代表仓库 | 视觉高级感 | 紫阶兼容 | 衬托圆盘/图标 | 动态自然度 | 视觉噪声 | GPU/CPU 开销 | 多尺寸适配 | 稳定性/降级 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A. WebGL1 fBm 极光 | godwire | 高 | 高（可换色） | 好 | 高 | 低 | 中（低分辨率渲染可控） | 好 | 自带降级思路 | 候选 |
| B. WebGL 低分辨率光斑场 | Naubit | 高 | 高 | 好 | 高 | 低 | 低（≤256–384px、限帧） | 好 | CSS 降级完整 | **选用** |
| C. 多风格 GLSL 背景集 | gradient-backdrops | 高 | 中 | 中 | 高 | 中 | 中 | 好 | 有 fallback | 参考工程模式 |
| D. SVG goo 流体 | background-lab | 中 | 中 | 差 | 高 | 高（feTurbulence/位移滤镜） | 高 | 中 | 弱 | 淘汰：滤镜贵、噪声大 |
| E. Three.js 场景背景 | background-lab | 高 | 中 | 中 | 高 | 低 | 高（600KB+ 依赖） | 中 | 一般 | 淘汰：无理由引入重型依赖 |
| F. 纯 CSS/SVG 光斑网格 | motion-backgrounds / css-mesh | 中 | 高 | 好 | 低（仅 translate/scale） | 中（大面积 blur） | 低-中 | 好 | 无依赖 | 作为静态降级层保留 |

## 3. 最终选型与理由

**选用方案 B：WebGL1 低分辨率加权高斯光斑场 + CSS 静态网格降级层**（A/C 的生命周期与画质工程模式作为补充）。

理由：

1. **技术栈匹配**：项目为 React 18 + Vite，不新增第三方运行时依赖；WebGL 为浏览器原生能力，Three.js / tsParticles 等重型库均未引入。
2. **视觉目标匹配**：加权高斯光斑可形成柔和、连贯、慢节奏的流动光影，配合中心压暗与边缘雾化获得空间纵深；避免了旧版密集放射褶皱、尖锐扇形与过饱和光束。
3. **成本可控**：光斑在低分辨率离屏缓冲（最长边 ≤384px）中绘制，浏览器放大承担柔和质感；帧率上限 30fps；后台/离屏/减少动态时停循环。
4. **降级完整**：WebGL 不可用或初始化失败时，CSS 紫阶网格背景直接可见，不留空白画布；着色器失败不影响业务组件。
5. **可维护**：配色配置、着色器源码、控制器、React 组件、样式分离为独立模块，业务组件不感知渲染实现。

## 4. 实现方式

### 4.1 模块结构（`frontend/src/workbench/background/`）

| 文件 | 职责 |
| --- | --- |
| `fieldTokens.ts` | 品牌紫阶 hex → 0..1 RGB 换算；6 个光斑的锚点、半径、权重、漂移/呼吸参数；渲染性能预算（帧率、分辨率上限、DPR 上限、帧步长截断） |
| `fieldShader.ts` | WebGL1 / GLSL ES 1.00 顶点 + 片元着色器：加权高斯融合、中心压暗、边缘雾化、色阶抖动降噪 |
| `fieldController.ts` | GL 上下文创建/编译/资源回收、渲染循环、帧率上限、ResizeObserver / IntersectionObserver / visibilitychange / reduced-motion 四路停循环、上下文丢失与恢复、卸载清理 |
| `ReproFieldBackground.tsx` | React 包装层：渲染降级网格、点阵、轨道细环与画布；建立/销毁控制器；WebGL 就绪后切换 `--live` 状态 |
| `workbench-background.css` | 静态紫阶网格、证据点阵、轨道细环、画布层级、静态降级隐藏空画布、reduced-motion 规则 |
| `ATTRIBUTION.md` | 参考仓库、许可证与版权署名 |

### 4.2 视觉设计（颜色全部来自 `tokens.css`）

- 基底：`--rc-bg / --rc-ink`（#08040f）。
- 光斑紫阶：`--rc-purple-deep` #1e0a35、`--rc-purple-dark` #3b1066、`--rc-purple` #7c2fd0、`--rc-violet` #a855f7、`--rc-magenta` #c084fc、`--rc-lilac` #e9d5ff。
- 前后两层纵深：远层光斑半径大、权重低、速度慢；近层光斑中等、权重略高。
- 品牌识别元素：中心圆盘以外的稀疏证据点阵（径向遮罩，中心区不显形）、两条低透明度轨道细环，呼应“审计/复现/空间化入口”语义；不使用通用 AI 紫色渐变模板。
- 中心保护：着色器中心压暗 + 既有 `.rc-stage__veil` 双重保证圆盘文字与外围图标可读；背景 `pointer-events: none`，层级 `z-index: 0`，圆盘 `z-index: 2`、入口 `z-index: 5`。

### 4.3 动态与性能策略

- 光斑沿慢速 Lissajous 轨迹漂移，半径轻微呼吸；无快速旋转、闪烁、变色或剧烈形变。
- 离屏缓冲最长边 ≤384px，DPR 上限 1.5；帧率上限 30fps；单帧步长截断 0.05s，后台恢复不跳变。
- 页面隐藏、画布离屏、`prefers-reduced-motion: reduce` 时停止 rAF 循环；减少动态下只保留一帧静止画面。
- 不做逐帧 DOM 布局计算；不反复创建/销毁 Canvas；观察者只在尺寸/可见性变化时触发。
- WebGL 上下文丢失时拦截 `webglcontextlost`，恢复后重编译资源并续跑；卸载时释放程序、缓冲与全部监听。

## 5. 实际修改的文件清单

### 新增

- `frontend/src/workbench/background/ReproFieldBackground.tsx`
- `frontend/src/workbench/background/fieldController.ts`
- `frontend/src/workbench/background/fieldShader.ts`
- `frontend/src/workbench/background/fieldTokens.ts`
- `frontend/src/workbench/background/ATTRIBUTION.md`
- `frontend/src/styles/workbench-background.css`
- `frontend/scripts/bg-redesign-capture.mjs`（前后台截图 + 基线指标采集）
- `frontend/scripts/bg-redesign-verify.mjs`（降级/减少动态/层级/多尺寸/帧计数验证）

### 修改

- `frontend/src/workbench/RadialWorkbench.tsx`：背景组件由 `FoldFieldCanvas` 替换为 `ReproFieldBackground`；圆盘、入口映射、事件处理与跳转未改。
- `frontend/src/styles/workbench.css`：移除已废弃的 `.rc-foldfield` 规则块。
- `frontend/src/styles/rc-unified.css`：移除已废弃的 `.rc-foldfield--ambient` 与 `rc-foldfield-drift` 关键帧。
- `frontend/src/workbench/FoldFieldCanvas.tsx`：仅标注 `@deprecated` 留档；已无任何引用，不参与渲染。

### 未改动

- 中心圆盘、9 个外围入口的位置、图标、文案、路由与业务逻辑；
- 登录页背景及其样式；
- 任何第三方依赖（`package.json` 未新增运行时条目）。

## 6. 性能测试结果（实测，非模拟）

测试脚本：`frontend/scripts/bg-redesign-capture.mjs`、`bg-redesign-verify.mjs`；结果落盘在 `.screenshots/bg-redesign/`。

| 指标 | 旧背景（before） | 新背景（after） | 说明 |
| --- | --- | --- | --- |
| 渲染缓冲 | 704×396（2D canvas） | 384×216（WebGL，1920×1080 视口）/ 384×240（1440×900） | 最长边被限制在 384px 以内 |
| 背景实际绘制帧率 | 一次性离屏绘制 + CSS 漂移 | 约 30.6fps（帧计数 37 → 144，间隔 3.5s） | 控制器帧计数实测；上限 30fps |
| 整页 rAF 采样（headless） | 163.5fps，avg 6.11ms/帧 | 162.9fps，avg 6.14ms/帧 | headless 下 rAF 受显示器刷新率约束，不代表着色器 GPU 耗时 |
| 控制台错误 / 页面异常 | 0 / 0 | 0 / 0 | 含 WebGL 正常、降级、减少动态、多尺寸全部用例 |
| 入口数量 | 9 | 9 | 未增减功能入口 |

性能策略落地核对：

- 无逐帧 DOM 布局；无 Canvas 反复重建；无大面积逐帧模糊/混合滤镜叠加。
- 后台标签页暂停动画；离屏暂停；高分屏 DPR 被限制；低性能设备走 CSS 静态降级路径。

**测量局限（如实披露）**：headless Edge 的 WebGL 为软件渲染路径，GPU 占用与真机帧率不具代表性；未使用 WebGL Timer 查询，故未给出单帧 GPU 毫秒数。真机独显/核显设备上的 FPS、GPU 占用与发热需在目标硬件上复测。

## 7. 截图证据（真实浏览器采集）

目录：`.screenshots/bg-redesign/`

### 7.1 改造前后对比（桌面 1280×720 CSS 视口）

| 旧背景 | 新背景静态 | 新背景动态（间隔 700ms） |
| --- | --- | --- |
| `before/01-desktop-static.png` | `after/01-desktop-static.png` | `after/02-desktop-dynamic.png` |

### 7.2 完整工作台组合效果（圆盘 + 全部外围图标）

- `verify/live-1920x1080.png`
- `verify/live-1280x800.png`
- `after/01-desktop-static.png`

### 7.3 多尺寸适配

| 视口 | 文件 |
| --- | --- |
| 1920×1080 桌面宽屏 | `verify/live-1920x1080.png` |
| 1280×800 桌面 | `verify/live-1280x800.png` |
| 390×844 移动 | `verify/live-390x844.png`、`after/03-mobile-390x844.png` |

### 7.4 降级与特殊场景

| 场景 | 文件 | 结果 |
| --- | --- | --- |
| 阻断 WebGL 上下文 | `verify/fallback-no-webgl.png` | CSS 紫阶网格 + 点阵 + 轨道环可见，页面无异常，`--live` 未激活 |
| `prefers-reduced-motion: reduce` | `verify/reduced-motion.png` | 静止首帧，无连续循环 |
| 动态两帧比对 | `verify/motion-t0.png`、`verify/motion-t1.png` | 光斑位置/亮度有缓慢位移，帧计数推进 |

### 7.5 视觉核对结论

- 无密集放射条纹、无尖锐重复扇形、无过饱和紫色光束；
- 配色仍为原品牌紫阶，未引入蓝/绿/橙等新主色；
- 中心圆盘与文字清晰，外围 9 个图标可识别；
- 背景无明显视觉噪声；各尺寸下未出现背景错位、遮挡、闪烁；
- 背景层不拦截鼠标事件。

## 8. 尚未解决的问题与后续建议

1. **真机 GPU 复测**：当前帧率/GPU 数据来自 headless 软件渲染；建议在目标笔记本（核显/独显）上复测 30fps 稳定性、GPU 占用与长时间发热。
2. **浅色皮肤适配**：着色器光斑颜色为固定紫阶常量，当前工作台为深色主题；若后续启用浅色皮肤，需为光斑补充一套浅色映射或降低发光强度。
3. **宽屏左侧明暗**：1920×1080 下左侧深紫光斑偏弱，视觉重心略偏右；如需要可微调 `fieldTokens.ts` 中左侧光斑的锚点/权重，参数集中配置，无需改动着色器。
4. **性能指标埋点**：后续可在控制器中接入真实 WebGL Timer 或长任务观测，输出单帧 GPU/主线程耗时到审计日志。
