# ReproCheck 主工作台 · 第二轮空间重构验收报告

日期：2026-11-24  
范围：`frontend/src/workbench/` 一级主工作台、背景光场、图标入口、二级花瓣交互与对应样式  
浏览器：Microsoft Edge（Playwright 1.65.1，headless；真实 dev server `127.0.0.1:5173`）  
当前工作树：`stage9/research-driven-refactor` 工作线。本轮未提交；本机 `git` 命令不可用，无法执行 status/commit/restore。修改集中在 `frontend/src/workbench` 的未跟踪目录与 `frontend/scripts`、`docs`，未触碰其他工作线 11:23 修改的 `pages` / `stores`。

![第二轮前后对照](../.screenshots/workbench-round2/workbench-round2-compare.png)

## 交付速览

- 深墨紫丝绸光场已重写为独立的 value-noise + 4 层 fbm + domain warping GLSL；没有静态壁纸、粒子、霓虹或放射条纹，背景画布最大边 384。
- 1440×900 的中心工作台是 576px 环形玻璃透镜：核心 195.8px（ratio 0.34）、入口轨道 449.3px、热区 50px、glyph≈27.36px；提示从底部白色胶囊改为盘下 18px 的轻量状态行。
- 9 个入口共用 24 画布 / 1.6 描边 / 圆形无底板热区，按逐图标墨迹包围盒与墨量做了 `scale/dx/dy` 光学校准；没有贴纸式白色方底。
- 二级交互改为可路由、可关闭、支持键盘与 reduced-motion 的弧形花瓣：6 项为 3+3 双瓣弧，3 项为最小 38° 步长的 V 形，4 项为 212×74 单弧；窄屏改为盘下纵向花瓣栈。旧 `FeatureFan` 与约 9.3KB 旧 `.rc-fan-*` 样式已删除。
- 六个验收视口全部 `overflow=0 / collisions=0 / pageErrors=0 / badResponses=[]`；真实录屏 `19.2s / 1440×900 / webm`；最终性能矩阵 165Hz 级别、p95 6.2ms、long task 0；390 idle 有 2 个 >20ms 帧。

## 1. 设计结果

### 1.1 背景：深墨紫丝绸光场

`frontend/src/workbench/background/fieldShader.ts` 为本轮原创 GLSL：

- value noise + 4 层 fbm + domain warping 形成被拉伸的绸带；`macro ridge` 负责大尺度布匹走向，`broad ridge` 与 `fine fiber` 补充中尺度褶裥和细纤维，`veil` 让暗部有薄纱层次。
- 方向性 ambient 区分左下墨黑与右上紫光；丝绸值直接调制底色，亮褶抬起、暗褶压深；最后叠加约 0.6% 静态颗粒，避免整片纯色。
- 不引入任何外部运行时依赖；没有点阵、轨道环、紫色大光斑、放射或密集粒子。`ReproFieldBackground.tsx` 只保留低对比 echo 环。
- 低分辨率 buffer 按视口分配：1920/1600/1366 为 384×216，1440 为 384×240，1024 为 384×288，390 为 177×384。`fieldController.ts` 的 `uTime` 驱动缓慢变化；WebGL 不可用时回落到 `workbench-background.css` 的深墨紫折痕与 0.28 透明度 live canvas。

本轮最后的材质校准（在截图复核后做的）：

- 削弱透镜外圈灰白光晕，保留紫色外场与 0 56px 120px 的底面阴影，让透镜像浮在丝绸上而不是坐在一块亮板上。
- `rc-disc` 的 24/38/60/78/94% 环带 alpha 调低到约 0.22/0.46/0.52/0.38/0.13；核心玻璃从近实白调到 `0.94/0.88/0.82` 的淡紫玻璃，并加 `blur(10px) saturate(118%)`。
- 核心标题字号改为按盘径 `0.0315` 缩放（clamp 11.5–17.5），并禁止换行，修掉了 1024/1366 下“工作台”被拆成单字换行的问题；≤1100px 的花瓣标签降到 12px，修掉 1024 下长标签被截断。

### 1.2 中心透镜与 1440 比例

唯一尺寸源在 `.rc-disc-shell`：

| 项目 | 1440×900 值 | 说明 |
| --- | --- | --- |
| 盘径 | 576px | `clamp(320px, min(40vw, 64vh), 620px)`；1920 为 620，1600 为 576，1366 为 491.5，1024 为 409.6，390 idle 为 335.4 |
| 核心 | 195.8px | ratio 0.34；1920 210.8，1366 167.1，1024 139.3，390 114 |
| 入口轨道 | 449.3px | 盘径 0.78；9 个入口不再贴边 |
| 点击热区 | 50px | 盘径 0.10 上限，不可见圆形热区 |
| glyph | ≈27.36px | 盘径 0.0475，clamp 20–29 |
| 底部提示 | 盘下 18px | 紧贴盘面的状态行，不是孤立的白色胶囊 |

中心不再是一整块浅紫板：中心低 alpha，38%–60% 为亮玻璃带，78% 为图标带，94% 后透明；外缘仅保留左上方向的一段 conic 软镜缘（opacity 0.38、blur 1.5），中央浅井压暗环从旧版 0.16 降到约 0.10。实际 1440 静止图为 `after/1440x900-idle.png`，6 瓣图为 `after/1440x900-petals.png`。

### 1.3 9 图标光学体系

`entryIcons.ts` 使用同一套 lucide 线性图标：24×24 画布、1.6 描边、统一端点与转角；每个图标先测 alpha>26 的真实墨迹 bbox 与墨量，再按“视觉外延 20.8 单位 + 墨量 ±3% 补偿”求 `scale/dx/dy`。原始测量在 `.screenshots/workbench-round2/icon-ink.json`。

| 入口 | 图标 | scale | dx / dy（24 画布单位） | 墨量 |
| --- | --- | --- | --- | --- |
| 智能审计 | ScanSearch | 1.03 | 0 / 0 | 偏轻，放大 3% |
| 项目管理 | FolderOpen | 0.92 | 0 / +0.5 | 下压 0.5，收 8% |
| 材料解析 | FileText | 0.90 | 0 / 0 | 墨量最重，收 10% |
| 复现验证 | FlaskConical | 0.97 | +0.13 / 0 | 右移 0.13，收 3% |
| 规则与字段 | ListChecks | 1.04 | 0 / 0 | 墨量最轻，放大 4% |
| 验证与交付 | PackageCheck | 0.94 | −0.5 / 0 | 左移回正，收 6% |
| 差异与监控 | GitCompare | 1.02 | 0 / 0 | 外延偏小，放大 2% |
| 协作与集成 | Users | 0.94 | 0 / 0 | 与档案夹同宽，收 6% |
| 模型服务 | Cpu | 0.99 | 0 / 0 | 墨量偏重，轻收 1% |

入口无白色方底；hover/选中只出现图标下方的透明光池或深紫玻璃片。选中态图标抬升 4px（S3 拖动 9px），中心核心同步显示当前功能的真实标题与说明。

### 1.4 二级「花瓣」交互

`petalLayout.ts` 是纯几何求解器，按真实入口子项数量输出 `arc` 或 `stack`：

- 6 项：`SIX_OFFSETS = [-2.8, -1.8, -0.7, 0.7, 1.8, 2.8]`，两段 3 片，中央留出一个锚点空隙；1440 面板 204×72，1600 同宽，1366 195.3×72，1024 178×72。
- 3 项：最小步长 38°，面板 204×74；智能审计在 1440 为 `378.5,106.5 / 618,24 / 857.5,106.5` 的上向 V。
- 4 项：212×74，1440 为 `804.2,752.3 / 589.8,801.2 / 383,726 / 250.2,550.6`。
- 2 项：204×74，单段弧。
- 面板半径取 `min(高度上限, 宽度上限, 488)`，再抬到“盘半径 + 半高 + 14px”的下限，几何上消除越界与压盘。
- 窄屏 ≤860px 切 `stack`：390×844 为单列 312/307/302/297/292/288 ×56，y 425.7→801.7；390×568 为 2 列 167×52，最后一片 bottom 509.3；768×1024 为 360 宽单列。

1440 六瓣坐标与尺寸：

| # | 标签 | x | y | w×h |
| --- | --- | --- | --- | --- |
| 01 | 复现总览 | 822.8 | 82.1 | 204×72 |
| 02 | 规划 DAG（复现步骤与脚本） | 966.2 | 238.3 | 204×72 |
| 03 | 复现环境（依赖与配置） | 1004.3 | 467.7 | 204×72 |
| 04 | 执行控制台 | 857.7 | 721.7 | 204×72 |
| 05 | 结果对照 | 639.9 | 803.4 | 204×72 |
| 06 | 报告中心 | 433 | 757.3 | 204×72 |

打开方式：点击入口后由父级直接切换 `entry.id` 对应的真实子项；scrim 点击、ESC、右上“收起”、再次点击锚点均可关闭；打开后焦点进入第一片，关闭后回到锚点。切换另一个入口时父级重挂载 `PetalStage`，不保留旧面板。面板支持 ArrowLeft/Right/Home/End/Tab。

本轮修复了一个真实交互缺陷：展开 6 瓣后，鼠标经过其他被压暗的入口会触发旧 `onEntryEnter`，把 `activeIndex` 改成别的入口；离开时 `onEntryLeave` 又清空 `activeIndex`，导致“花瓣还开着、核心已回到 idle 文案”。现在 `fanIndex !== null` 时入口的 pointer/focus 事件不再改写当前功能，只有点击才允许切换；`hover-other-entry` 回归项在移入和移出后都验证 `coreTitle=复现验证`、`fan=true`、`activeCount=1`。

## 2. 六档验收

`after/audit.json` 为真实浏览器结果，六个视口最终状态：

| 视口 | 盘径 | 核心 | buffer | 6 瓣 | overflow | collisions | pageErrors | badResponses |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1920×1080 | 620 at 650,230 | 210.8 | 384×216 | 6 | 0 | 0 | 0 | [] |
| 1600×900 | 576 at 512,162 | 195.8 | 384×216 | 6 | 0 | 0 | 0 | [] |
| 1440×900 | 576 at 432,162 | 195.8 | 384×240 | 6 | 0 | 0 | 0 | [] |
| 1366×768 | 491.5 at 437.2,138.2 | 167.1 | 384×216 | 6 | 0 | 0 | 0 | [] |
| 1024×768 | 409.6 at 307.2,179.2 | 139.3 | 384×288 | 6 | 0 | 0 | 0 | [] |
| 390×844 | 335.4 at 27.3,254.3 | 114 | 177×384 | 6 stack | 0 | 0 | 0 | [] |

六档最终图在 `.screenshots/workbench-round2/after/`：每个视口一对 `*-idle.png` / `*-petals.png`。1920 盘径 620、1600 与 1440 576、1366 491.5、1024 409.6、390 idle 335.4（fan 态按 0.7 缩到 234.8）。

`npm run build` 已通过（`tsc --noEmit && vite build`，1750 modules transformed）；`npx tsc --noEmit -p tsconfig.json` 单独通过。没有删除或回滚其他工作线文件。

## 3. 交互回归

`interaction.json` 为 1440×900 的真实点击/键盘回归，最终 `ok=true`、`errors=[]`：

| 测试 | 结果 |
| --- | --- |
| 打开 6 项 | 6 panels；overflow 0；collisions 0；焦点在 `复现验证：复现总览` |
| 悬停另一入口再离开 | 核心保持“复现验证”；fan=true；active=1；未被 hover 重置 |
| ArrowRight ×2 / End / Home | `复现环境（依赖与配置）` → `报告中心` → `复现总览` |
| Tab | `规划 DAG（复现步骤与脚本）` |
| ESC 关闭 | stage=0；fan=false；焦点回入口 index 3 |
| “收起”按钮 | stage=0；fan=false；焦点回入口 index 3 |
| 点击 scrim | stage=0；fan=false |
| 再点同一锚点 | stage=0；fan=false |
| 6 → 3 切换 | 只剩 3 片：`事实字段目录 / 审计规则 / 反馈治理`；overflow 0；collisions 0 |
| 3 项（智能审计） | 3 panels；overflow 0；collisions 0 |
| 4 项（验证与交付） | 4 panels；overflow 0；collisions 0 |
| 真实路由：知识检索 | 到达 `/knowledge`；stage 计数 0 |
| reduced-motion | `(prefers-reduced-motion: reduce)` 命中；`animationName=rc-petal-fade`；`0.12s`；shell transition `none` |

截图对应：`state-switch-3item.png`、`state-arc-3item.png`、`state-arc-4item.png`、`state-reduced-motion.png`；交互录屏为 `workbench-round2-1440.webm`。

录屏：`19.2s / 1440×900 / 4,062,347 bytes`，含 6 瓣展开、鼠标经过面板、3 项切换、2 项模型服务、关闭。录屏只为演示加了可见光标环，不属于产品 UI。8s 帧已复核为“6 瓣 + 核心复现验证 + 锚点发光”，不再出现 idle 文案异常。

## 4. 性能

`perf-matrix.json` 为最终几何/CSS 后的六档数据；当前显示器刷新率为 165Hz，因此 FPS 接近 165 而不是 60：

| 视口 | idle FPS | fan FPS | p95 | long task | 390 idle >20ms 帧 |
| --- | --- | --- | --- | --- | --- |
| 1920×1080 | 165.1 | 165.1 | 6.2ms | 0 | 0 |
| 1600×900 | 165.0 | 165.3 | 6.2ms | 0 | 0 |
| 1440×900 | 165.2 | 165.3 | 6.2ms | 0 | 0 |
| 1366×768 | 165.2 | 165.1 | 6.2ms | 0 | 0 |
| 1024×768 | 165.2 | 165.2 | 6.2ms | 0 | 0 |
| 390×844 | 160.2 | 165.2 | 6.2ms | 0 | 2（idle），fan 0 |

结论：6 片烟熏玻璃面板展开未新增 long task；390 idle 的 2 个 >20ms 帧来自首帧合成，不影响展开态。背景 buffer 维持 384 级别，未因面板合成放大。

## 5. 产物与文件清单

### 最终截图

- 对比展板：`.screenshots/workbench-round2/workbench-round2-compare.png`
- 六档最终 idle + 6 瓣：`.screenshots/workbench-round2/after/{1920x1080,1600x900,1440x900,1366x768,1024x768,390x844}-{idle,petals}.png`
- 1440 3 项：`.screenshots/workbench-round2/state-arc-3item.png`
- 1440 4 项：`.screenshots/workbench-round2/state-arc-4item.png`
- 3 项切换：`.screenshots/workbench-round2/state-switch-3item.png`
- reduced-motion：`.screenshots/workbench-round2/state-reduced-motion.png`
- 390×568 2 列 / 768×1024 单列补充：`petal-390x568-3.png`、`petal-768x1024-3.png`
- 改造前基线：`.screenshots/workbench-round2/before/{1920x1080,1440x900,390x844}.png`
- 录屏与抽帧：`workbench-round2-1440.webm`、`video-03s.png`、`video-08s.png`、`video-14s.png`、`video-19s.png`

### 数据文件

- 六档几何/边界/错误：`after/audit.json`
- 交互回归：`interaction.json`
- 性能：`perf-matrix.json`
- 图标墨迹测量：`icon-ink.json`

### 修改文件

| 文件 | 变化 |
| --- | --- |
| `frontend/src/workbench/background/fieldShader.ts` | 重写为 value-noise + fbm + domain warping + silk/fiber/veil + grain |
| `frontend/src/workbench/background/fieldTokens.ts` | 5 个深色 lobe 与颜色 token |
| `frontend/src/workbench/background/fieldController.ts` | 增加 `uTime` uniform 与时间推进 |
| `frontend/src/workbench/background/ReproFieldBackground.tsx` | 删除 dots/orbits，保留双 echo ring；低分辨率画布 |
| `frontend/src/styles/workbench-background.css` | 深墨紫 fallback、折痕、echo、live 时 0.28 fallback |
| `frontend/src/workbench/background/ATTRIBUTION.md` | 补充本轮参考来源、许可证、版权与未使用说明 |
| `frontend/src/workbench/radialLayout.ts` | ORBIT .78 / core .34 / guide .94；唯一几何源 |
| `frontend/src/workbench/RadialWorkbench.tsx` | 环形透镜结构、提示行、同入口 toggle、空白关闭、焦点回锚点；入口 hover/focus 在 fan 打开时隔离 |
| `frontend/src/styles/workbench.css` | 环形玻璃膜、软镜缘、浅井、盘下提示；核心玻璃与标题排版；删除约 9.3KB 旧 `.rc-fan-*` / `.rc-core__meta` |
| `frontend/src/workbench/entryIcons.ts` | 9 图标光学 `scale/dx/dy` 表 |
| `frontend/src/workbench/EntryGlyph.tsx` | 应用 `translate(dx,dy) scale(s)` |
| `frontend/src/workbench/petalLayout.ts` | arc/stack、6 项 3+3、3 项 min 38°、6 项小屏 178、移动端 2 列 52 高 |
| `frontend/src/workbench/PetalStage.tsx` | scrim、heading、SVG rails、面板、关闭、方向键焦点、`data-columns` |
| `frontend/src/styles/workbench-petals.css` | 烟熏玻璃花瓣、双段弧光、锚点脉冲、移动端栈、reduced-motion、移动端隐藏 ESC |
| `frontend/src/main.tsx` | 引入 `./styles/workbench-petals.css` |
| `frontend/scripts/wb-round2-acceptance.mjs` | 六档 idle/6 瓣截图与几何/控制台验收 |
| `frontend/scripts/wb-petal-interaction.mjs` | 开关/遮罩/切换/键盘/路由/hover 隔离/reduced-motion |
| `frontend/scripts/wb-petal-shot.mjs` | 单档开瓣截图与越界/重叠统计 |
| `frontend/scripts/wb-perf-matrix.mjs` | 六档 idle/fan FPS、p95、long task、画布 buffer |
| `frontend/scripts/wb-round2-video.mjs` | 1440×900 真实录屏与录屏光标 |
| `frontend/scripts/wb-video-check.mjs` | 录屏时长/尺寸与抽帧 |
| `frontend/scripts/wb-compare-board.mjs` | 前后对比板渲染 |
| `docs/workbench-round2-compare.html` | 前后对比板源文件 |
| `docs/WORKBENCH_SPATIAL_ROUND2.md` | 本报告 |
| `docs/WORKBENCH_RADIAL_REBUILD.md` | 顶部增加“第一轮记录、已被第二轮取代”的注记，正文保留 |
| `docs/WORKBENCH_BACKGROUND_REDESIGN.md` | 顶部增加“第一轮记录、最终验收见第二轮”的注记，正文保留 |

已删除：`frontend/src/workbench/FeatureFan.tsx`；`workbench.css` 内旧 `.rc-fan-*` 与 `.rc-core__meta` 样式（约 9,336 字符移除）。`FeatureFan`/`rc-fan`/`rc-core__meta` 在 `src/workbench` 的 grep 为 0。最终 `workbench.css` 1,110 行、129/129 花括号；`workbench-petals.css` 455 行、72/72 花括号。

## 6. 许可证与依赖

- 未新增第三方运行时依赖；背景是浏览器原生 WebGL，二级交互是 React + CSS transform/opacity。
- 参考实现与许可证已写入 `frontend/src/workbench/background/ATTRIBUTION.md`：velvet（MIT）、ShaderDrop（MIT）、godwire/react-aurora-background（MIT）、paper-design/shaders（Apache-2.0）、nonlineartom/gradient-backdrops（MIT）、PavelDoGreat/WebGL-Fluid-Simulation（评估未采用，MIT）。
- 未复制演示页面、静态壁纸或来源不明代码；未使用付费组件。

## 7. 未解决问题与风险

1. **录屏只有 webm**。本机没有 ffmpeg，无法转 mp4/gif；`workbench-round2-1440.webm` 可由 Edge/Chrome 直接播放。
2. **390 idle 有 2 个 >20ms 帧**（160.2 FPS，p95 6.2ms），其余五档与 390 fan 均为 0 long frame；若验收要求 60Hz 下也绝对 0，需要再压首帧纹理上传。
3. **6 项花瓣弧较宽**：当前双瓣弧约 150°–160°，中央留出锚点空隙；用户任务允许更宽弧，但“是否接受这一宽度”尚未获得用户确认。若要更收敛的两片花瓣，可减小 `SIX_OFFSETS` 的 ±2.8。
4. **3 项弧会随锚点方向旋转**：智能审计（0°）是上向 V，规则与字段（约 240°）是下向 V。所有面板独立、不重叠；若要求所有 3 项都固定为上向 V，需要另行定义旋转策略。
5. **390×568 2 列 / 768×1024 单列**属于六档之外的补充断点，已实测无越界/重叠，但未纳入最终六档表。
6. 真实 demo 账号访问 `/knowledge` 时 `/api/v1/rag/documents` 仍可能返回 401；本轮交互脚本对该端点做了 demo mock，只为验证路由，不是产品鉴权修复。主工作台本身六档 `badResponses=[]`。
7. `docs/WORKBENCH_RADIAL_REBUILD.md`、`docs/WORKBENCH_BACKGROUND_REDESIGN.md` 的正文仍是上一轮内容，只在顶部加了“已被第二轮取代”的注记；本报告为第二轮最终口径。
8. 当前工作树未提交；`git` CLI 在 PATH 不可用，无法提供 commit diff 或 status。未删除、未回滚其他工作线文件。

## 8. 复现命令

在 `frontend` 目录：

```bash
npm run dev                 # http://127.0.0.1:5173
npm run build               # tsc --noEmit && vite build
node scripts/wb-round2-acceptance.mjs   # 六档截图 + audit.json
node scripts/wb-petal-interaction.mjs 1440 900  # 交互回归 + interaction.json
node scripts/wb-perf-matrix.mjs        # 性能矩阵 + perf-matrix.json
node scripts/wb-round2-video.mjs       # 1440×900 录屏
node scripts/wb-video-check.mjs        # 时长/尺寸/抽帧
```

演示鉴权：`localStorage rc_token='demo-token-radial'` + `rc_user`；`/api/v1/auth/me` 由测试脚本 mock 返回 `lead@reprocheck.demo`。测试账号不写入产品代码。
