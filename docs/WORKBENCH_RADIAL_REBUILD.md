# ReproCheck 主工作台专项重构 · 交付报告

> 本文件是第一轮记录，部分视觉口径已被第二轮取代。第二轮最终验收见 `docs/WORKBENCH_SPATIAL_ROUND2.md`。

范围：`frontend` 一级主工作台 `/`（React 18 + Vite + TypeScript + 手写 `rc-*` CSS）
日期：2026-11-24
结论：背景、圆形工作台几何、9 枚功能图标、中央圆盘信息层级、交互反馈、多分辨率适配与真实浏览器验收全部完成；`tsc --noEmit && vite build` 通过，无新增运行时依赖，37 条既有功能路由与二段式入口逻辑全部保留。

## 验收对照

| 任务书要求 | 结果 | 证据 |
| --- | --- | --- |
| 背景重设计，保留紫色体系、有空间纵深 | 通过（上一轮完成，本轮沿用并复核） | 光场背景 + 3 段对比图 `compare-stage.png` |
| 圆盘必须是正圆、以中心为唯一原点 | 通过：6 档分辨率圆度偏差均为 0，圆心偏移均为 0 | `after/audit.json` |
| 极坐标统一轨道，禁止手写每个图标的 left/top | 通过：位置唯一来源 `buildSlots()`，组件内无逐项坐标 | `radialLayout.ts`、`RadialWorkbench.tsx` |
| 角度按入口数量自动等角分布 | 通过：9 入口严格 0/40/…/320，最大回读偏差 0.01° | `distributeAngles()` + 6 档实测 |
| 9 个图标同一线性体系、同画布、同描边、视觉面积一致 | 通过：lucide 0.454、24 画布、1.6 描边、光学缩放 0.94–1.04 | `entryIcons.ts`、`EntryGlyph.tsx` |
| 中央圆盘信息层级重做 | 通过：品牌词 / 主标题 / 提示 / 计数四层，idle 与 active 两态 | 本报告「中央圆盘」节与截图 |
| hover / 选中 / 拖动反馈统一，热区大于图标，图标不倾斜 | 通过：热区 48 > 珠体 40.31（+19%），仅径向位移，无 rotate | `workbench.css`、交互态截图 |
| 多分辨率适配 | 通过：1920 / 1600 / 1440 / 1366 / 1024 / 390 六档 | 分辨率实测表 |
| 性能不退化 | 通过：六档 160.8–162.3fps，p95 6.2ms | `after/perf-matrix.json` |
| 真实浏览器验收 | 通过：9/9 点击开卡组、9/9 首卡进入真实路由、5/5 拖动命中 | `after/audit.json` |

## 文件清单

新增：

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `frontend/src/workbench/radialLayout.ts` | 104 | 极坐标单一真源：轨道比例、等角分配、槽位、最近命中、向量角度 |
| `frontend/src/workbench/entryIcons.ts` | 93 | 9 入口图标注册表：lucide 组件、光学系数、语义依据、兜底 |
| `frontend/src/workbench/EntryGlyph.tsx` | 33 | 统一图标渲染层，圆盘 / 卡组标题共用 |

重写或修改：

| 文件 | 行数 | 变更 |
| --- | --- | --- |
| `frontend/src/workbench/EntryLauncher.tsx` | 258 | 入口数据改为 `SEEDS`（只保留内容）；角度由 `distributeAngles(SEEDS.length)` 注入；删除逐项 angle/radius/kind/glyph |
| `frontend/src/workbench/RadialWorkbench.tsx` | 293 | 槽位渲染、两道轨道环、9 枚刻度、玻璃珠入口、新中央层级、`closeFan()`、`data-*` 状态属性 |
| `frontend/src/workbench/useRadialInteraction.ts` | 212 | 拖动命中改用 `angleFromVector` + `nearestIndex`，移除内联角度循环 |
| `frontend/src/workbench/FeatureFan.tsx` | 110 | 卡组标题改用 `EntryGlyph`，与圆盘图标同源 |
| `frontend/src/styles/workbench.css` | 1464 | 以直径 token 推导全部尺寸；删除 `scaleY`；新增轨道、刻度、盘面、中央层级、响应式与 reduced-motion |

验证与证据（均为本轮新增，非产品运行时依赖）：

| 文件 | 作用 |
| --- | --- |
| `frontend/scripts/wb-radial-audit.mjs` | 6 档几何 / 文字溢出 / 9 入口点击 / 首卡路由 / 5 方位拖动 / hover FPS |
| `frontend/scripts/wb-states.mjs` | hover 上下半区、拖动中、卡组、键盘焦点、键盘导航、遮罩关闭 |
| `frontend/scripts/wb-perf-matrix.mjs` | 每档独立浏览器实例的 rAF 性能矩阵 |
| `frontend/scripts/wb-shot.mjs`、`wb-field-probe.mjs`、`wb-perf-probe.mjs`、`wb-path-probe.mjs` | 单档截图、背景帧探针、同页性能归因、路径探针 |
| `.screenshots/workbench-radial/` | `after/` 六档截图与两份 JSON、`states/` 十张交互态、三张对比板 |

背景模块（上一轮建立，本轮未改动）：

`src/workbench/background/{fieldTokens.ts, fieldShader.ts, fieldController.ts, ReproFieldBackground.tsx, ATTRIBUTION.md}` 与 `src/styles/workbench-background.css`。

## 背景视觉升级

旧背景是紫色折叠场：18 条放射褶皱铺满画面，与圆形工作台争夺视觉中心，且几乎没有纵深。本轮沿用上一轮定稿的 WebGL1 光场方案：在 384 长边的低分辨率离屏画布上叠加若干加权高斯光斑，按时间缓慢漂移，再用 CSS 网格与渐晕层补足近景；不使用静态图充当背景，也不引入第三方运行时。

- 纵深来自三层：远景大光斑（低对比、慢速）→ 中景紫色雾面 → 近景网格与暗角；圆盘自身再用外发光、玻璃盘面与内圈阴影压在中间。
- 紫色体系不变，色阶仍取自 `tokens.css`：`#08040f / #1e0a35 / #3b1066 / #7c2fd0 / #a855f7 / #c084fc / #e9d5ff / #f6f0fb`。
- 性能边界：`FIELD_PERF = { fps: 30, maxPixelSide: 384, maxDpr: 1.5, maxFrameDelta: 0.05 }`；WebGL 不可用时退回 CSS 网格降级，`prefers-reduced-motion` 下静止。
- 本轮复核：六档画布尺寸分别为 384×216、384×216、384×240、384×216、384×288、177×384，累计帧数 113–121，仍按 30fps 上限调度。
- 细节与调研过程见 `docs/WORKBENCH_BACKGROUND_REDESIGN.md`、署名见 `src/workbench/background/ATTRIBUTION.md`。

## 圆形工作台与布局算法

唯一原点为圆盘几何中心。所有入口坐标由「入口数量 + 起始角 + 轨道比例」推导，组件不再出现任何单个入口的 `left / top / angle / radius` 常量。

\[
\theta_i = (\theta_0 + i \cdot 360/n) \bmod 360,\qquad i = 0,\dots,n-1
\]

\[
u_i = (\sin\theta_i,\; -\cos\theta_i),\qquad
x_i = 50 + 50\,r\,u_{ix},\qquad
y_i = 50 + 50\,r\,u_{iy}
\]

其中 \(\theta_0 = 0^\circ\) 指 12 点方向，顺时针递增；\(r\) 是相对圆盘直径的轨道比例；\(x_i, y_i\) 是相对圆盘容器的百分比。

拖动命中按环形最短夹角取最近入口：

\[
i^* = \arg\min_i \min\left(|\theta-\theta_i|,\; 360-|\theta-\theta_i|\right)
\]

轨道常量（`radialLayout.ts`）：

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `ORBIT.entry` | 0.657 | 入口珠心轨道半径 / 圆盘半径；轨道环正好穿过珠体中心 |
| `ORBIT.core` | 0.44 | 中央圆盘直径 / 圆盘直径（渲染由 CSS `--rc-core-ratio: 0.44` 采用同一值） |
| `ORBIT.guide` | 0.8 | 外侧引导环，仅作视觉刻度，不承载交互 |

尺寸只有一个真源：`--rc-disc-size: clamp(288px, min(34vw, 58vh), 540px)`，移动端 `min(86vw, 340px)`。圆盘 `width = height` 且 `aspect-ratio: 1`，删除了旧的 `scaleY(0.98)`；中央盘、珠体、图标、字号全部由该直径推导：

| Token | 公式 | 1440×900 实测 |
| --- | --- | --- |
| 圆盘 | `clamp(288, min(34vw,58vh), 540)` | 489.59 |
| 中央盘 | `min(0.44×圆盘, 224)` | 215.4 |
| 点击热区 | `clamp(38, 0.1×圆盘, 48)` | 48 |
| 玻璃珠 | `0.84×热区` | 40.31 |
| 图标 | `clamp(18, 0.051×圆盘, 24)` | 24 |
| 入口轨道环 | `0.657×圆盘` | 321.66 |
| 引导环 | `0.8×圆盘` | 391.67 |

槽位对象同时输出 `left/top` 百分比与径向外推单位向量 `--rc-out-x / --rc-out-y`；后者只参与 hover / S3 的位移，不参与布局，因此不触发布局重排。CSS 中唯一的位置规则是 `left:50%; top:50%` 配合 `translate(-50%,-50%)`，入口再叠加 `calc(var(--rc-out-x) * var(--rc-lift))`。

改造前后的关键差异（同一审计脚本，改造前基线取自本轮开始时的 `--phase before` 输出）：

| 指标 | 1440×900 改造前 | 1440×900 改造后 | 390×844 改造前 | 390×844 改造后 |
| --- | --- | --- | --- | --- |
| 圆盘宽×高 | 458 × 449 | 489.59 × 489.59 | 335.39 × 328.68 | 335.39 × 335.39 |
| 圆度偏差 | 9px（椭圆） | 0 | 6.71px | 0 |
| 圆心偏移 | — | (0, 0) | y −16.89 | (0, 0) |
| 9 入口角度 | 0 / 40.6 / 80.2 / 119.5 / 159.6 / 200.4 / 240.5 / 279.8 / 319.4 | 0 / 40 / … / 320 | 同左，带漂移 | 0 / 40 / … / 320 |
| 入口距圆心极差 | 2.80px | 0.03px | 2.02px | 0.02px |
| 点击热区 | 46 × 45.08（非正方） | 48 × 48 | — | 38 × 38 |
| 中央盘直径 | 约 40%（183px） | 44%（215.4px） | 40% | 44%（147.6px） |
| 主标题 / 计数 | 12px / 7.5px | 18px / 10.9px | 12px / 7.5px | 12.7px / 10px |

旧版左上方那枚 Cpu 图标因坐标漂移落到盘外，远看像 “AI” 字样；放大 6 倍确认是图标而非多余文本（`.screenshots/bg-redesign/zoom-ai.png`）。统一轨道后它回到 320° 的模型服务入口。

## 图标系统

9 枚图标全部来自已安装的 `lucide-react@0.454.0`，同一线性风格、圆角端点、`currentColor` 描边，不使用 Emoji、不混用第二套图标库、不为单个图标写 size。

| 入口 | id | 图标 | 光学系数 | 语义依据 | 功能数 |
| --- | --- | --- | --- | --- | --- |
| 智能审计 | `audit` | ScanSearch | 1.00 | 文稿 + 扫描环，对应筛查动作 | 3 |
| 项目档案 | `projects` | FolderOpen | 1.00 | 打开的档案夹，对应归档与调阅 | 3 |
| 材料解析 | `materials` | FileText | 1.02 | 单页文稿；线条偏少，放大 2% 补墨量 | 6 |
| 复现验证 | `repro` | FlaskConical | 0.98 | 锥形瓶；轮廓外扩，收缩 2% 避免压过邻位 | 6 |
| 规则与字段 | `rules` | ListChecks | 1.04 | 清单 + 勾选；三条短横墨量偏轻，放大 4% | 3 |
| 验证与交付 | `delivery` | PackageCheck | 0.99 | 封装 + 勾选，对应产出确认 | 4 |
| 差异与监控 | `diff` | GitCompare | 1.03 | 双向对比节点；图形偏空，放大 3% | 4 |
| 协作与集成 | `collab` | Users | 1.00 | 双人剪影，对应组织与成员 | 6 |
| 模型服务 | `models` | Cpu | 0.94 | 芯片；引脚最密，收缩 6% 防止过重 | 2 |

规范：

- 画布固定 24×24，描边固定 1.6（24 单位坐标），端点与连接统一为 lucide 默认圆角；容器统一由 `EntryGlyph` 渲染。
- 光学缩放只改 `transform: scale()`，不改画布、不改描边；实际墨迹外框在 1440 档为 22.56–24.96px（相对 24 画布 ±5.4%），用来抵消不同图形的密度差。
- 单一渲染路径：圆盘入口、功能卡组标题都用 `<EntryGlyph entryId>`；容器 `.rc-glyph` 固定正方形，图标永不旋转，状态变化只改颜色与阴影。
- 小尺寸等比：容器 18px 时 24 画布等比缩至 18，1.6 描边对应约 1.2px；同一断点下 9 枚完全一致，保证小屏仍清晰且不糊成实心。
- 兜底：未注册的入口 id 回退到 `ScanSearch`，不会出现空图标。

## 中央圆盘信息层级

旧核心是「英文小字 + 中文标题 + 英文按钮文案」的平铺，信息没有主次，计数只有 7.5px。新核心按纵向区块重排：

| 区块 | 内容 | 字号（1440 档） | 作用 |
| --- | --- | --- | --- |
| 品牌 | `ReproCheck` + 细横线 | 11px，字距 0.18em | 品牌锚点，不抢主标题 |
| 主信息（idle） | 科研复现审计工作台 / 选择或拖动功能入口 / 9 个功能入口 · 37 条路由 | 18 / 12.5 / 10.9px | 回答「这是什么、怎么用、有多少内容」 |
| 主信息（active） | 入口标题 / 入口描述 / S3 时「松手展开功能」 | 16 / 12 / 10.9px | 鼠标或拖动选中时即时解释当前入口 |
| 上下文 | 上次：项目 · 规划 · 运行 + 清除 | 10.4px | 仅在 idle 且存在上下文时出现 |
| 紧凑入口 | 展开全部（≤279px 显示） | 12px | 既有行为，未改逻辑 |

视觉工艺：中央盘为近白径向渐变（`#ffffff → #f8effc → #ead6f5`），外圈 1px 深紫描边（`rgba(76,29,149,.24)`），内层 `inset` 亮边与紫色底部内阴影；`::before` 内环 inset 6% 形成第二道同心圆。品牌词与主标题之间用一条 1px、低对比短线分隔，替代旧版的英文叠层。信息全部为真实数据：入口数取 `ENTRIES.length`，路由数取 `FEATURE_COUNT`（37），不是写死文案。

## 交互系统与测试

状态机（`useRadialInteraction.ts`）：

| 状态 | 触发 | 表现 |
| --- | --- | --- |
| S0 | 初始 / 离开 / 取消 | 全部入口满透明度，核心显示 idle 信息 |
| S1 | hover / focus | 当前入口高亮，其余降至 0.6；核心切换为该入口标题与描述 |
| S2 | 点击 / Enter / 拖动释放 | 提交并打开该入口的真实功能卡组 |
| S3 | 中心按住拖动 | 当前命中入口径向抬起 9px、玻璃珠转为深紫 + 白图标，其余降至 0.45，入口轨道环变虚线 |

反馈统一规则：

- 热区始终大于图标：`.rc-entry` 是 48×48（390 档 38×38），珠体 40.31（31.91），热区多出 19%；点击、hover、focus 都落在同一热区。
- 只有位移，没有倾斜：hover 沿径向外推 3px，S3 9px，`translate` 叠加在 `translate(-50%,-50%)` 上；9 枚图标在任何状态下都无 `rotate`、无 `scale` 变形。
- tooltip 按入口所在半区避让：上半区朝上、下半区朝下，均朝圆盘外侧展开，并带两位功能数（`03`），不遮挡中央盘；`aria-describedby` 指向同一节点。
- 键盘：方向键循环移动焦点（Home/End 到首尾），Enter/Space 打开卡组，Escape 关闭并重置；`role="menu"` / `menuitem`、`aria-current` 同步。实测从第 3 枚按两次右方向键到第 5 枚，焦点、tooltip、`aria-label` 全部正确。
- 关闭一致性：`closeFan()` 同时关闭卡组并 `interaction.reset()`，避免高亮、tooltip、`data-active` 残留；Escape、右上角关闭、点击遮罩三条路径共用。
- 拖动：鼠标 8px、触摸 12px 激活；距圆心 <0.48R 保持 S0，0.48R–2R 按最近角度命中，>2R 取消；释放即提交。
- `prefers-reduced-motion`：取消 hover/S3 的位移与缩放，保留颜色、描边与阴影反馈。

实测结果：

| 测试 | 结果 |
| --- | --- |
| 点击 9 个入口 | 9/9 打开对应卡组，标题与功能数全部匹配（3/3/6/6/3/4/4/6/2） |
| 每个入口首张卡进入路由 | 9/9 路由变化：`/demo/audit`、`/projects`×5、`/fact-schema`、`/orgs`、`/settings/llm` |
| 拖动 5 个方位（0°/80°/160°/240°/320°） | 5/5 命中预期入口，拖动中高亮与释放后卡组标题一致 |
| 键盘导航 | 3 → 5（两次 ArrowRight），焦点、tooltip、aria 同步 |
| 遮罩关闭 | 卡组 1 → 0，`data-fan` 归 false，高亮清零 |
| hover 帧率 | 165.2fps / 6.05ms / p95 6.2ms / 长帧 0 |

路由结果说明：`/projects`、`/fact-schema`、`/orgs`、`/settings/llm` 中的多数降级来自既有 `resolveFeatureRoute`——当 `uiStore` 没有当前项目 / 规划 / 运行时，带 `:id` 的功能会落到真实列表页并给出提示。本轮未注入假项目数据来“美化”结果。

## 分辨率与几何实测

审计脚本在六个独立视口打开真实页面（mock 仅限登录态，路由与组件均为真实实现）：

| 视口 | 圆盘 | 圆度Δ | 圆心偏移 | 中央盘 | 距离极差 | 角度 | 文字溢出 | 视口越界 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1920×1080 | 540 | 0 | (0,0) | 224 | 0.03 | 0/40/…/320 | 0 | 无 |
| 1600×900 | 522 | 0 | (0,0) | 224 | 0.03 | 0/40/…/320 | 0 | 无 |
| 1440×900 | 489.59 | 0 | (0,0) | 215.4 | 0.03 | 0/40/…/320 | 0 | 无 |
| 1366×768 | 445.44 | 0 | (0,0) | 196 | 0.01 | 0/40/…/320 | 0 | 无 |
| 1024×768 | 348.16 | 0 | (0,0) | 153.2 | 0.03 | 0/40/…/320 | 0 | 无 |
| 390×844 | 335.39 | 0 | (0,0) | 147.6 | 0.02 | 0/40/…/320 | 0 | 无 |

角度回读的最大偏差为 0.01°（240.01 / 39.99 等），属于亚像素测量误差，不是布局误差。文字溢出判据只统计横向 `scrollWidth > clientWidth + 1`；早前把行高造成的纵向假阳性排除后，六档均为 0。

## 性能

方法：每档单独启动一个 Edge 无头实例，在 3 秒 rAF 采样窗口内让鼠标沿 0.33R 轨道扫过 9 个入口，同时记录帧间隔；背景 canvas 读取同页 `dataset.frameCount`。

| 视口 | FPS | 平均帧 | p95 | 长帧（>20ms） | 背景缓冲 | 背景累计帧 |
| --- | --- | --- | --- | --- | --- | --- |
| 1920×1080 | 160.8 | 6.22 | 6.2 | 2 | 384×216 | 119 |
| 1600×900 | 161.5 | 6.19 | 6.2 | 2 | 384×216 | 113 |
| 1440×900 | 161.9 | 6.17 | 6.2 | 2 | 384×240 | 120 |
| 1366×768 | 162.0 | 6.17 | 6.2 | 2 | 384×216 | 121 |
| 1024×768 | 162.3 | 6.16 | 6.2 | 2 | 384×288 | 120 |
| 390×844 | 162.2 | 6.16 | 6.2 | 2 | 177×384 | 121 |

当前测试机为 165Hz 屏幕，160–162fps 已贴近刷新上限；相对 60fps 的 16.7ms 预算仍有约 2.7 倍余量。此前多浏览器上下文连跑时曾掉到 75–118fps，同页归因（现状 / 关闭盘面 blur / 关闭背景 canvas 三者均 165fps）证明是并行上下文争抢，不是盘面 `backdrop-filter` 或背景着色器的单点开销；本表数据来自逐档独立实例。

构建：`npm run build`（即 `tsc --noEmit && vite build`）通过，主包 315.33kB / gzip 99.34kB，最大页面 chunk 93.79kB / gzip 30.49kB（ProjectWorkbenchPage）。

## 前后对比

三阶段总览（原背景 + 旧几何 → 新背景 + 旧几何 → 新背景 + 新几何 / 新图标）：

![三阶段对比](../.screenshots/workbench-radial/compare-stage.png)

本轮前后同屏（左：上一轮结束状态，右：本轮完成）：

![桌面端前后对比](../.screenshots/workbench-radial/compare-desktop.png)

移动端前后：

![移动端前后对比](../.screenshots/workbench-radial/compare-mobile.png)

六档成品：`.screenshots/workbench-radial/after/{1920x1080,1600x900,1440x900,1366x768,1024x768,390x844}.png`
交互态：`.screenshots/workbench-radial/states/{1440x900,390x844}-{hover-top,hover-bottom,dragging,fan,focus}.png`
原始数据：`.screenshots/workbench-radial/after/audit.json`、`perf-matrix.json`

口径说明：改造前的几何数值已逐项记入上表（来源为本轮开始时 `--phase before` 的审计输出），但那批 PNG 因早期用中文绝对路径传参的事故没有落盘；因此“改造前”视觉对照采用上一轮交付的 1280×720 截图（新背景 + 旧几何 + 旧图标），更早的原背景状态用 `bg-redesign/before/01-desktop-static.png`。两组对照的圆盘尺寸差异来自视口与面板缩放不同，不代表本轮缩放。

## 参考来源与许可证

| 来源 | 许可证 | 使用方式 |
| --- | --- | --- |
| [lucide-react 0.454.0](https://github.com/lucide-icons/lucide) | ISC（部分来自 Feather，MIT） | 9 枚线性图标的 SVG 路径；未修改路径，仅统一画布 / 描边并做光学缩放 |
| [godwire/react-aurora-background](https://github.com/godwire/react-aurora-background) | MIT | 参考 WebGL1 上下文生命周期、丢失恢复、可见性暂停、reduced-motion 切换、资源回收 |
| [TheNaubit/react-aurora-background](https://github.com/TheNaubit/react-aurora-background) | MIT | 参考加权高斯光斑着色模型、低分辨率渲染、帧率上限、渲染预算 |
| [nonlineartom/gradient-backdrops](https://github.com/nonlineartom/gradient-backdrops) | MIT | 参考 GLSL 工程组织、CSS 静态降级、色阶抖动 |
| [LalithK90/background-lab](https://github.com/LalithK90/background-lab) | MIT | 用于比较 CSS 极光、SVG goo、Three.js 三条路线的成本 |
| [kmikeym/motion-backgrounds](https://github.com/kmikeym/motion-backgrounds) | CC0 1.0 | 参考纯 CSS/SVG 网格光斑的降级结构 |

- 背景为原创着色器与控制器实现，未逐字复制上述仓库源码；完整版权声明与 MIT 全文见 `src/workbench/background/ATTRIBUTION.md`。
- 字体栈声明 Sora / IBM Plex Mono / PingFang SC / Noto Sans SC，但未随包分发任何字体文件，不产生字体再分发义务；未安装时按系统字体回退。
- 未引入付费组件、商业素材、来源不明代码或新的运行时依赖；WebGL 为浏览器原生能力。

## 遗留问题与建议

1. 任务书写「点击图标可进入对应功能页面」，当前保留既有的二段式：点击入口 → 该入口的功能卡组 → 点击卡片进入真实路由。这样符合「不得删除原功能」，也能让一个入口承载 2–6 条路由；若要求一级直达，需要产品侧明确默认路由并接受其余功能改由别处进入。
2. 无项目上下文时，带 `:id` 的功能会按既有 `resolveFeatureRoute` 降级到 `/projects` 并提示，这是真实逻辑，不是本轮缺陷；验收报告已按实际落点记录，未用假数据绕过。
3. `AllFeaturesPopover` 的「展开全部」触发器只在 ≤279px 显示，这是既有行为；本轮未改其可见性，也未纳入 6 档主验收（最小档为 390）。
4. `FoldFieldCanvas.tsx` 与 `FoldFieldCanvas.tsx.bak` 是背景改造后留下的旧折叠场留档（文件头已标 `@deprecated`），当前无任何引用；本轮未删除以免误删用户资产，建议确认后清理。
5. 1920 档圆盘上限为 540px，占屏宽 28%，视觉更克制；若希望大屏更具压迫感，可把上限提到 600–640，但需要同步复核核心字号与 1600/1440 档的过渡。
6. 触屏拖动只按 Pointer Events 规范实现并用触摸阈值 12px 校验，未在真实手机上手测；Playwright 的拖动验收为鼠标指针。建议在 iOS / Android 各补一次真机触摸回归。
7. 审计日志中的两条 401 来自未 mock 的业务接口（仅 mock 了 `/auth/me`），不影响几何、交互与路由断言；接入真实种子账号后应消失。

## 复现方式

```bash
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
npm run build
node scripts/wb-radial-audit.mjs --phase after
node scripts/wb-states.mjs 1440 900
node scripts/wb-perf-matrix.mjs
```

审计脚本使用本机 Edge（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）与 `playwright-core`；登录态通过 `localStorage` 的 `rc_token / rc_user` 与 `/api/v1/auth/me` 的 mock 注入，其余页面、路由与交互均为真实实现。截图默认写入 `.screenshots/workbench-radial/`，不接受中文绝对路径作为输出参数。
