# ReproCheck 全站设计系统 · Global Design System（Phase 1 · 视觉方向）

> 文档性质：**全站视觉规范 + Design Token 契约**，不含业务组件代码。落地由 Phase 3 前端工程师执行。
> 继承关系：本文**完整继承** `Plan/visual-style-spec.md` 的紫黑玻璃语言与 10 色 `--rc-*` 基色，**不推翻、不重命名**任何既有 `--rc-*` 变量；在其之上补齐语义层、跨皮肤层与旧变量迁移层。
> 适用范围：41 个业务页 + 8 个 bloom 舞台 + 5 个 workbench 文件 + AppLayout + 6 个高频公共组件。
> 唯一权威：本文的 `:root{}` 变量块（§1.9）。任何页面 CSS 不得再新增颜色字面量。

---

## 0. 三个核心决策（先读这一段）

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 色源唯一 | **`--rc-*` 是唯一色源**。`--accent` 绿系、bloom 墨绿、硬编码深色全部降级为**兼容别名**或**作用域内局部变量**，不再作为设计来源 | 4 套变量并存是全站割裂的根因；逐页改色号必然漏改 |
| D2 | 双皮肤 | 默认皮肤 = **深色（工作台同款紫黑）**；阅读/表格密集页可显式切 `data-rc-skin="light"`（浅色"档案室"）。**两套皮肤共用同一套品牌基色与紫罗兰强调色**，只反转 surface/text/border | 忠实于上轮规范"图 2 浅色档案室"的结论，同时让全站气质统一 |
| D3 | 迁移方式 | **别名映射优先（一次性改 1 个文件），逐页迁移只做布局与特色元素** | 38 个旧页不改一行 JSX 就能去掉绿色；把 Phase 3 的预算留给 8 类页面的差异化布局 |

> ⚠️ 边界：本轮**不新增路由**。用户点名的「代码中心」在项目中**没有独立路由**（`App.tsx` 已核实），按上轮结论由**复现规划** `/reproductions/plans/:planId` 与**执行控制台** `/reproductions/runs/:runId` 承接。所有图标与页面规范如实标注，不做假入口。

---

## 1. Design Token 全量清单

### 1.1 Token 命名契约（强制）

1. 只有 `--rc-*` 是 canonical token；禁止在业务页写 `#9fe870`、`rgba(124,47,207,.2)` 之类的字面量。
2. 品牌基色（§1.2）**永不修改**，语义层（§1.3）才允许按皮肤覆盖。
3. 透明度通过 `rgba()` token 表达，不再用 Tailwind 的 `/30` 硬编码叠加在旧变量上。
4. 旧变量（`--accent` / `--surface` / `--navy-*` / `--success` …）保留为**兼容别名**，标记 `/* @deprecated */`，允许长期共存，禁止在新代码中使用。
5. Bloom 变量（§1.11）只允许存在于舞台作用域内部，且 only for 数据语义，不得定义页面底色。

### 1.2 品牌基色（继承上轮规范，10 色，不改动）

| # | Token | HEX | 用途（不可挪作他用） |
|---|---|---|---|
| 1 | `--rc-ink` | `#08040F` | 画布基底、消隐点、褶皱暗面、遮罩 |
| 2 | `--rc-purple-deep` | `#1E0A35` | 深紫黑、玻璃盘下缘折射、浅色页正文 |
| 3 | `--rc-purple-dark` | `#3B1066` | 深紫、线框图标在浅底上的默认色 |
| 4 | `--rc-purple` | `#7C2FD0` | 品牌主紫、主按钮填充、选中态（白字 6.7:1 达 AA） |
| 5 | `--rc-violet` | `#A855F7` | 亮紫、发光、强调文字（深底上 4.8:1） |
| 6 | `--rc-magenta` | `#C084FC` | 品紫、玻璃环境映射、focus ring |
| 7 | `--rc-lilac` | `#E9D5FF` | 淡紫粉、次级文字、描边基色 |
| 8 | `--rc-glass` | `#F6F0FB` | 磨砂底、正文（深底上 >12:1） |
| 9 | `--rc-hi` | `#FFFFFF` | 1px 高光、纯白反相文字 |
| 10 | `--rc-cool` | `#EAF3EE` | 冷青绿反射，避免全紫发腻 |

> 注：10 色 HEX 与 `workbench.css` 现有值完全一致，本轮不改动任何既有 `--rc-*` 值。

### 1.3 语义颜色 · 深色皮肤（默认，L1 工作台与 L2 业务页共用）

| Token | HEX / 值 | 近似实色 | 用途 |
|---|---|---|---|
| `--rc-bg` | `#08040F` | #08040F | 页面画布最底层 |
| `--rc-bg-2` | `#150A26` | #150A26 | 画布第二层（顶部/侧栏微渐变） |
| `--rc-surface` | `#150A26` | #150A26 | 卡片基础面（配合 8% 玻璃叠层） |
| `--rc-surface-2` | `#221038` | #221038 | 抬升面：hover 卡、次级面板 |
| `--rc-surface-3` | `#2E1548` | #2E1548 | 选中面、内嵌槽、代码/日志底 |
| `--rc-surface-glass` | `rgba(246,240,252,.08)` | #241D2B | 玻璃卡片底色（必须叠 backdrop-filter） |
| `--rc-surface-glass-2` | `rgba(233,213,255,.14)` | #3B2F4C | 玻璃抬升面 |
| `--rc-border-hair` | `rgba(255,255,255,.08)` | #251632 | 1px 分隔线、表格行线 |
| `--rc-border` | `rgba(233,213,255,.16)` | #3B2A4E | 常规描边（卡片、输入框） |
| `--rc-border-strong` | `rgba(233,213,255,.30)` | #503A68 | hover/选中描边 |
| `--rc-text` | `#F6F0FB` | — | 正文、标题 |
| `--rc-text-muted` | `#B9A5D2` | — | 次要说明、标签（≈8:1） |
| `--rc-text-subtle` | `#8B76A8` | — | 占位符、元信息（≈4.8:1，最小可用） |
| `--rc-text-inverse` | `#1E0A35` | — | 浅色玻璃面上的文字 |
| `--rc-accent` | `#7C2FD0` | — | 主操作填充、进度条、链接 |
| `--rc-accent-bright` | `#A855F7` | — | 发光、强调数字、图表高亮点 |
| `--rc-accent-wash` | `rgba(124,47,207,.18)` | #2C1749 | 选中底色、chip 底 |
| `--rc-success` | `#46D6B0` | — | 通过/一致（薄荷青，避开绿系冲突，10.3:1） |
| `--rc-success-wash` | `rgba(70,214,176,.14)` | — | 通过态底色 |
| `--rc-danger` | `#FF6B7D` | — | 失败/错误（珊瑚红，非粉） |
| `--rc-danger-wash` | `rgba(255,107,125,.14)` | — | 错误态底色 |
| `--rc-warning` | `#F5B94E` | — | 警告/待处理（琥珀，呼应 card 图标黄条） |
| `--rc-warning-wash` | `rgba(245,185,78,.14)` | — | 警告态底色 |
| `--rc-info` | `#7DD3FC` | — | 信息/进行中（冷青） |
| `--rc-neutral` | `#9C8BB5` | — | 中性 badge |
| `--rc-focus` | `#C084FC` | — | 键盘焦点环（2px） |
| `--rc-scrim` | `rgba(8,4,15,.62)` | — | 弹窗遮罩（叠 blur 6px） |

### 1.4 语义颜色 · 浅色皮肤（`[data-rc-skin="light"]`，档案室页）

只覆盖 surface/text/border 与功能色的**深色版本**；品牌基色与主紫**不变**。

| Token | 值 | 用途 |
|---|---|---|
| `--rc-bg` | `#F6F0FB` | 页面画布（玻璃白） |
| `--rc-bg-2` | `#EFE6F7` | 分区底 |
| `--rc-surface` | `rgba(255,255,255,.76)` | 卡片（叠 blur(18px) saturate(140%)） |
| `--rc-surface-2` | `#F1E7FA` | 抬升面 |
| `--rc-surface-3` | `#E7D8F2` | 内嵌槽 |
| `--rc-surface-glass` | `rgba(255,255,255,.62)` | 玻璃面 |
| `--rc-border-hair` | `rgba(59,16,102,.08)` | 细分隔线 |
| `--rc-border` | `rgba(59,16,102,.16)` | 常规描边 |
| `--rc-border-strong` | `rgba(59,16,102,.32)` | 选中描边 |
| `--rc-text` | `#1E0A35` | 正文 |
| `--rc-text-muted` | `#5B4A6B` | 次要文字 |
| `--rc-text-subtle` | `#7A6A8D` | 占位符 |
| `--rc-text-inverse` | `#F6F0FB` | 深色面上的反相文字 |
| `--rc-success` | `#0E7A5F` | 通过（白底 ≥4.5:1） |
| `--rc-danger` | `#C0294A` | 失败 |
| `--rc-warning` | `#9A6300` | 警告 |
| `--rc-info` | `#1E6E93` | 信息 |
| `--rc-neutral` | `#5B4A6B` | 中性 |
| `--rc-accent-wash` | `rgba(124,47,207,.10)` | 选中底 |
| `--rc-scrim` | `rgba(30,10,53,.42)` | 遮罩 |

### 1.5 字体排印

沿用上轮：`Sora` + `IBM Plex Mono` + `PingFang SC` 回退链。**最多 3 种字重** 400/500/600，禁止 700+ 堆叠。

| Token | 值 | 层级 | 字重 Token | 行高 Token | 字距 Token | 用途 |
|---|---|---|---|---|---|---|
| `--rc-fs-display` | 40px | Display | `--rc-fw-sb` 600 | `--rc-lh-tight` 1.1 | `--rc-ls-display` -0.02em | 工作台/欢迎页主标题 |
| `--rc-fs-h1` | 28px | H1 | 600 | 1.2 | -0.01em | 模块主标题 |
| `--rc-fs-h2` | 20px | H2 | 600 | 1.3 | 0 | 卡片标题、弹窗标题 |
| `--rc-fs-h3` | 16px | H3 | 600 | 1.4 | 0 | 小标题、强调数值标签 |
| `--rc-fs-body` | 14px | Body | `--rc-fw-r` 400 | 1.6 | 0.01em | 正文 |
| `--rc-fs-caption` | 12px | Caption | `--rc-fw-m` 500 | 1.5 | 0.02em | 说明、tooltip、tooltip chip |
| `--rc-fs-micro` | 11px | Micro | 500 | 1.4 | 0.06em | 表头、overline（仅大写英文/编号） |
| `--rc-fs-mono` | 12px | Mono | 500 | 1.4 | 0.06em | 审计编号、哈希、指标、时间 |

- 中文标题不使用 `letter-spacing < -0.01em`（会挤字）；负字距只作用于 Sora 英文/数字。
- 数字、ID、指标、日志一律 `--rc-font-mono` + `font-variant-numeric: tabular-nums`。
- 旧 `--font-sans: Inter…` 必须别名到 `--rc-font-body`；**Inter 不得再作为显示字体**。

### 1.6 间距（4px 基线，8pt 栅格）

| Token | 值 | 使用场景 |
|---|---|---|
| `--rc-space-1` | 4px | 图标与文字最小间隙、badge 圆点、紧凑列表行内 |
| `--rc-space-2` | 8px | **图标↔文字标准间距**、chip 内边距、按钮图标间距 |
| `--rc-space-3` | 12px | 表单控件内边距、列表项间距、卡片内小间距 |
| `--rc-space-4` | 16px | 组件内标准间距、按钮左右内边距、卡片分组间 |
| `--rc-space-5` | 20px | 卡片内边距（紧凑卡）、移动端页面边距 |
| `--rc-space-6` | 24px | **卡片标准内边距**、栅格 gutter、区块间距 |
| `--rc-space-7` | 32px | 桌面页边距、大区块分隔、弹窗内边距 |
| `--rc-space-8` | 40px | 页面顶部留白、 hero 区段落间距 |

> 禁止 5/7/9/13/18px 等非标数值（现有 `.data-table td{padding:11px 14px}` 属迁移对象）。

### 1.7 圆角 / 边框 / 阴影 / 透明度 / 动画 / 图标尺寸

**圆角**

| Token | 值 | 用途 |
|---|---|---|
| `--rc-radius-xs` | 6px | badge、小 chip、代码块内标签 |
| `--rc-radius-sm` | 10px | 输入框、按钮、app 方块图标 |
| `--rc-radius-md` | 14px | 列表项、嵌套卡、tooltip 外的浮层 |
| `--rc-radius-lg` | 20px | 标准卡片、弹窗、popover |
| `--rc-radius-xl` | 28px | 大面板（承接旧 `--radius-panel:30px`） |
| `--rc-radius-pill` | 999px | 胶囊按钮、状态 badge、tooltip |
| `--rc-radius-disc` | 50% | 圆盘、头像、圆形图标底 |

**边框**（一律 1px，禁止 2px 实线描边，focus ring 除外）
`--rc-stroke-hair: 1px solid var(--rc-border-hair)` / `--rc-stroke: 1px solid var(--rc-border)` / `--rc-stroke-strong: 1px solid var(--rc-border-strong)`

**玻璃多层阴影**（五要素：半透底 + backdrop blur + 1px 亮边 + 内外多层阴影 + 环境色叠加，缺一不可）

| Token | 值 | 用途 |
|---|---|---|
| `--rc-blur-glass` | `blur(22px) saturate(150%)` | 圆盘/大玻璃面 |
| `--rc-blur-panel` | `blur(14px) saturate(135%)` | 卡片、popover |
| `--rc-blur-scrim` | `blur(6px)` | 弹窗遮罩 |
| `--rc-shadow-inset-hi` | `inset 0 1px 0 rgba(255,255,255,.70)` | 上缘冷白高光 |
| `--rc-shadow-inset-lo` | `inset 0 -8px 24px rgba(168,85,247,.28)` | 下缘紫反射 |
| `--rc-shadow-near` | `0 8px 24px rgba(8,4,15,.45)` | 近距投影 |
| `--rc-shadow-far` | `0 24px 70px rgba(124,47,207,.35)` | 远距紫光晕 |
| `--rc-shadow-glass` | 上述 4 层组合 | 圆盘/玻璃卡默认 |
| `--rc-shadow-panel` | `inset 0 1px 0 rgba(255,255,255,.12), 0 12px 36px rgba(8,4,15,.32)` | 业务卡片 |
| `--rc-shadow-pop` | `--rc-shadow-panel` + `0 0 32px rgba(168,85,247,.24)` | 弹窗、下拉 |
| `--rc-glow-violet` | `0 0 18px rgba(168,85,247,.60)` | active 发光 |
| `--rc-glow-magenta` | `0 0 14px rgba(192,132,252,.45)` | focus/选中发光 |

**透明度层级**

| Token | 值 | 用途 |
|---|---|---|
| `--rc-a-04` | .04 | 极淡分隔、hover 底 |
| `--rc-a-08` | .08 | 玻璃卡底、表格 hover |
| `--rc-a-12` | .12 | 描边增强、选中底 |
| `--rc-a-16` | .16 | app 图标边、次要层 |
| `--rc-a-24` | .24 | 强调描边 |
| `--rc-a-34` | .34 | 磨砂盘起始底 |
| `--rc-a-42` | .42 | 盘缘 1px 白边 |
| `--rc-a-70` | .70 | app 图标磨砂底 |

**动画**

| Token | 值 | 用途 |
|---|---|---|
| `--rc-dur-instant` | 80ms | 按下回弹起点 |
| `--rc-dur-fast` | 120ms | tooltip、淡入淡出、reduced-motion 唯一时长 |
| `--rc-dur-base` | 200ms | hover、按钮、popover、卡片显隐 |
| `--rc-dur-slow` | 400ms | 层级切换、透视卡片切换 |
| `--rc-dur-ambient` | 24s | 背景褶皱相位流动（20–28s 区间取中值） |
| `--rc-ease-out` | `cubic-bezier(.16,1,.3,1)` | 入场、层级切换 |
| `--rc-ease-hover` | `cubic-bezier(.2,.8,.2,1)` | hover/active |
| `--rc-ease-inout` | `cubic-bezier(.4,0,.2,1)` | 展开/收拢 |
| `--rc-ease-spring` | `cubic-bezier(.2,1.35,.36,1)` | 轻微回弹（仅按钮/图标，不得用于页面） |
| `--rc-ease-linear` | `linear` | 环境动画 |

**图标尺寸**

| Token | 值 | 场景 | strokeWidth |
|---|---|---|---|
| `--rc-icon-xs` | 16px | 表格行内、badge、紧凑按钮 | `--rc-stroke-small: 2` |
| `--rc-icon-sm` | 18px | 常规按钮、表单后缀 | `--rc-stroke-ui: 1.75` |
| `--rc-icon-md` | 20px | 导航、卡片操作、页眉按钮 | 1.75 |
| `--rc-icon-lg` | 24px | L1 线框入口、区块标题图标 | 1.75（L1 磨砂盘上用 1.5） |
| `--rc-icon-xl` | 32px | 功能磁贴、空状态插图图标 | `--rc-stroke-deco: 1.5` |

> App 方块图标本身 36px（L1）/34px（平板）/32px（手机），内部字形 = `calc(var(--rc-glyph-size) - 2px)`，即 22/20/18px；**与 5 个线框入口共用同一 stroke 体系**，靠深色底而非线宽拉平视觉重量。

### 1.8 布局 Token

| Token | 值 | 用途 |
|---|---|---|
| `--rc-header-h` | 64px | AppLayout 顶栏高度 |
| `--rc-page-pad` | 32px | 桌面页左右边距 |
| `--rc-card-pad` | 24px | 卡片内边距（标准） |
| `--rc-card-pad-tight` | 16px | 密集数据卡/表格卡 |
| `--rc-grid-gutter` | 24px | 12 栅格间距 |
| `--rc-section-gap` | 24px | 区块之间 |
| `--rc-icon-gap` | 8px | 图标↔文字 |
| `--rc-content-max` | 1440px | 内容最大宽度 |

响应式断点：`≥1280` 桌面 / `1024–1279` 窄桌面 / `640–1023` 平板 / `<640` 手机 / `<280` 极窄（L1 已实现，L2 沿用）。

### 1.9 可直接粘贴的完整 `:root{}` 变量块

```css
:root {
  /* ===== 1. 品牌基色（继承 visual-style-spec.md，永不改动） ===== */
  --rc-ink: #08040f;
  --rc-purple-deep: #1e0a35;
  --rc-purple-dark: #3b1066;
  --rc-purple: #7c2fd0;
  --rc-violet: #a855f7;
  --rc-magenta: #c084fc;
  --rc-lilac: #e9d5ff;
  --rc-glass: #f6f0fb;
  --rc-hi: #ffffff;
  --rc-cool: #eaf3ee;

  /* ===== 2. 语义颜色 · 深色皮肤（默认） ===== */
  --rc-bg: #08040f;
  --rc-bg-2: #150a26;
  --rc-surface: #150a26;
  --rc-surface-2: #221038;
  --rc-surface-3: #2e1548;
  --rc-surface-glass: rgba(246, 240, 252, .08);
  --rc-surface-glass-2: rgba(233, 213, 255, .14);
  --rc-border-hair: rgba(255, 255, 255, .08);
  --rc-border: rgba(233, 213, 255, .16);
  --rc-border-strong: rgba(233, 213, 255, .30);
  --rc-text: #f6f0fb;
  --rc-text-muted: #b9a5d2;
  --rc-text-subtle: #8b76a8;
  --rc-text-inverse: #1e0a35;
  --rc-accent: #7c2fd0;
  --rc-accent-bright: #a855f7;
  --rc-accent-wash: rgba(124, 47, 207, .18);
  --rc-accent-rgb: 124 47 207;
  --rc-success: #46d6b0;
  --rc-success-wash: rgba(70, 214, 176, .14);
  --rc-success-rgb: 70 214 176;
  --rc-danger: #ff6b7d;
  --rc-danger-wash: rgba(255, 107, 125, .14);
  --rc-danger-rgb: 255 107 125;
  --rc-warning: #f5b94e;
  --rc-warning-wash: rgba(245, 185, 78, .14);
  --rc-warning-rgb: 245 185 78;
  --rc-info: #7dd3fc;
  --rc-info-wash: rgba(125, 211, 252, .14);
  --rc-neutral: #9c8bb5;
  --rc-neutral-wash: rgba(156, 139, 181, .14);
  --rc-focus: #c084fc;
  --rc-scrim: rgba(8, 4, 15, .62);

  /* ===== 3. 字体 ===== */
  --rc-font-display: 'Sora', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  --rc-font-mono: 'IBM Plex Mono', 'PingFang SC', 'Microsoft YaHei', monospace;
  --rc-font-body: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', system-ui, sans-serif;
  --rc-fs-display: 40px;
  --rc-fs-h1: 28px;
  --rc-fs-h2: 20px;
  --rc-fs-h3: 16px;
  --rc-fs-body: 14px;
  --rc-fs-caption: 12px;
  --rc-fs-micro: 11px;
  --rc-fs-mono: 12px;
  --rc-fw-r: 400;
  --rc-fw-m: 500;
  --rc-fw-sb: 600;
  --rc-lh-tight: 1.1;
  --rc-lh-h: 1.25;
  --rc-lh-body: 1.6;
  --rc-ls-display: -.02em;
  --rc-ls-h1: -.01em;
  --rc-ls-body: .01em;
  --rc-ls-caption: .02em;
  --rc-ls-mono: .06em;

  /* ===== 4. 间距（4px 基线） ===== */
  --rc-space-1: 4px;
  --rc-space-2: 8px;
  --rc-space-3: 12px;
  --rc-space-4: 16px;
  --rc-space-5: 20px;
  --rc-space-6: 24px;
  --rc-space-7: 32px;
  --rc-space-8: 40px;

  /* ===== 5. 圆角 ===== */
  --rc-radius-xs: 6px;
  --rc-radius-sm: 10px;
  --rc-radius-md: 14px;
  --rc-radius-lg: 20px;
  --rc-radius-xl: 28px;
  --rc-radius-pill: 999px;
  --rc-radius-disc: 50%;

  /* ===== 6. 边框 / 阴影 / 模糊 / 透明度 ===== */
  --rc-stroke-hair: 1px solid var(--rc-border-hair);
  --rc-stroke: 1px solid var(--rc-border);
  --rc-stroke-strong: 1px solid var(--rc-border-strong);
  --rc-blur-glass: blur(22px) saturate(150%);
  --rc-blur-panel: blur(14px) saturate(135%);
  --rc-blur-scrim: blur(6px);
  --rc-shadow-inset-hi: inset 0 1px 0 rgba(255, 255, 255, .70);
  --rc-shadow-inset-lo: inset 0 -8px 24px rgba(168, 85, 247, .28);
  --rc-shadow-near: 0 8px 24px rgba(8, 4, 15, .45);
  --rc-shadow-far: 0 24px 70px rgba(124, 47, 207, .35);
  --rc-shadow-glass:
    inset 0 1px 0 rgba(255, 255, 255, .70),
    inset 0 -8px 24px rgba(168, 85, 247, .28),
    0 8px 24px rgba(8, 4, 15, .45),
    0 24px 70px rgba(124, 47, 207, .35);
  --rc-shadow-panel:
    inset 0 1px 0 rgba(255, 255, 255, .12),
    0 12px 36px rgba(8, 4, 15, .32);
  --rc-shadow-pop:
    inset 0 1px 0 rgba(255, 255, 255, .14),
    0 18px 48px rgba(8, 4, 15, .42),
    0 0 32px rgba(168, 85, 247, .24);
  --rc-glow-violet: 0 0 18px rgba(168, 85, 247, .60);
  --rc-glow-magenta: 0 0 14px rgba(192, 132, 252, .45);
  --rc-a-04: .04;
  --rc-a-08: .08;
  --rc-a-12: .12;
  --rc-a-16: .16;
  --rc-a-24: .24;
  --rc-a-34: .34;
  --rc-a-42: .42;
  --rc-a-70: .70;

  /* ===== 7. 动画 ===== */
  --rc-dur-instant: 80ms;
  --rc-dur-fast: 120ms;
  --rc-dur-base: 200ms;
  --rc-dur-slow: 400ms;
  --rc-dur-ambient: 24s;
  --rc-ease-out: cubic-bezier(.16, 1, .3, 1);
  --rc-ease-hover: cubic-bezier(.2, .8, .2, 1);
  --rc-ease-inout: cubic-bezier(.4, 0, .2, 1);
  --rc-ease-spring: cubic-bezier(.2, 1.35, .36, 1);
  --rc-ease-linear: linear;

  /* ===== 8. 图标 ===== */
  --rc-icon-xs: 16px;
  --rc-icon-sm: 18px;
  --rc-icon-md: 20px;
  --rc-icon-lg: 24px;
  --rc-icon-xl: 32px;
  --rc-stroke-small: 2;
  --rc-stroke-ui: 1.75;
  --rc-stroke-deco: 1.5;

  /* ===== 9. 布局 ===== */
  --rc-header-h: 64px;
  --rc-page-pad: 32px;
  --rc-card-pad: 24px;
  --rc-card-pad-tight: 16px;
  --rc-grid-gutter: 24px;
  --rc-section-gap: 24px;
  --rc-icon-gap: 8px;
  --rc-content-max: 1440px;
}

/* ===== 10. 浅色皮肤：只覆盖语义层，品牌基色与主紫不变 ===== */
[data-rc-skin='light'] {
  --rc-bg: #f6f0fb;
  --rc-bg-2: #efe6f7;
  --rc-surface: rgba(255, 255, 255, .76);
  --rc-surface-2: #f1e7fa;
  --rc-surface-3: #e7d8f2;
  --rc-surface-glass: rgba(255, 255, 255, .62);
  --rc-surface-glass-2: rgba(233, 213, 255, .55);
  --rc-border-hair: rgba(59, 16, 102, .08);
  --rc-border: rgba(59, 16, 102, .16);
  --rc-border-strong: rgba(59, 16, 102, .32);
  --rc-text: #1e0a35;
  --rc-text-muted: #5b4a6b;
  --rc-text-subtle: #7a6a8d;
  --rc-text-inverse: #f6f0fb;
  --rc-accent-wash: rgba(124, 47, 207, .10);
  --rc-success: #0e7a5f;
  --rc-success-wash: rgba(14, 122, 95, .10);
  --rc-danger: #c0294a;
  --rc-danger-wash: rgba(192, 41, 74, .10);
  --rc-warning: #9a6300;
  --rc-warning-wash: rgba(154, 99, 0, .10);
  --rc-info: #1e6e93;
  --rc-neutral: #5b4a6b;
  --rc-scrim: rgba(30, 10, 53, .42);
  --rc-shadow-panel:
    inset 0 1px 0 rgba(255, 255, 255, .85),
    0 12px 32px rgba(59, 16, 102, .12);
  --rc-shadow-pop:
    inset 0 1px 0 rgba(255, 255, 255, .9),
    0 18px 48px rgba(30, 10, 53, .18),
    0 0 32px rgba(168, 85, 247, .18);
}
```

### 1.10 旧变量 → 新 Token 兼容别名（一次性加到 `styles/index.css` 末尾）

> 加这一段后，38 个旧页**不改 JSX** 即完成"去绿 + 紫化"。别名是 computed-value 解析，浅色皮肤覆盖会动态生效。

```css
/* @deprecated 兼容层：仅用于存量页面，新代码禁止使用 */
:root {
  /* 绿色主色 → 品牌紫（含 Tailwind 透明度三元组） */
  --accent: var(--rc-accent);
  --accent-soft: var(--rc-accent-bright);
  --accent-dark: var(--rc-purple-deep);
  --accent-wash: var(--rc-accent-wash);
  --accent-rgb: var(--rc-accent-rgb);
  --accent-soft-rgb: 168 85 247;
  --accent-dark-rgb: 30 10 53;
  --accent-wash-rgb: 124 47 207;

  /* 中性面 → rc 语义面 */
  --surface: var(--rc-surface);
  --canvas: var(--rc-bg);
  --line: var(--rc-border);
  --line-soft: var(--rc-border-hair);
  --surface-rgb: 21 10 38;
  --canvas-rgb: 8 4 15;
  --line-rgb: 233 213 255;
  --line-soft-rgb: 255 255 255;

  /* 文字 */
  --ink: var(--rc-text);
  --ink-muted: var(--rc-text-muted);
  --ink-subtle: var(--rc-text-subtle);
  --ink-rgb: 246 240 251;
  --ink-muted-rgb: 185 165 210;
  --ink-subtle-rgb: 139 118 168;

  /* 功能色 */
  --success: var(--rc-success);
  --success-wash: var(--rc-success-wash);
  --success-rgb: var(--rc-success-rgb);
  --success-wash-rgb: 70 214 176;
  --danger: var(--rc-danger);
  --danger-wash: var(--rc-danger-wash);
  --danger-rgb: var(--rc-danger-rgb);
  --danger-wash-rgb: 255 107 125;
  --warning: var(--rc-warning);
  --warning-wash: var(--rc-warning-wash);
  --warning-rgb: var(--rc-warning-rgb);
  --warning-wash-rgb: 245 185 78;
  --neutral: var(--rc-neutral);
  --neutral-wash: var(--rc-neutral-wash);

  /* 旧 navy 灰阶 → 紫阶 */
  --navy-950: var(--rc-ink);
  --navy-900: var(--rc-ink);
  --navy-800: var(--rc-purple-deep);
  --navy-700: var(--rc-purple-dark);
  --navy-600: var(--rc-text-subtle);
  --navy-100: var(--rc-lilac);
  --navy-950-rgb: 8 4 15;
  --navy-900-rgb: 8 4 15;
  --navy-800-rgb: 30 10 53;
  --navy-700-rgb: 59 16 102;
  --navy-600-rgb: 139 118 168;
  --navy-100-rgb: 233 213 255;

  /* 字体 / 圆角 / 阴影 */
  --font-sans: var(--rc-font-body);
  --font-mono: var(--rc-font-mono);
  --radius-sm: var(--rc-radius-sm);
  --radius-md: var(--rc-radius-md);
  --radius-panel: var(--rc-radius-lg);
  --shadow-panel: var(--rc-shadow-panel);
  --shadow-pop: var(--rc-shadow-pop);
}
```

**若兼容层让某些浅色页对比度不足**（例如 `btn-primary` 原为浅绿底深绿字，现在是深紫底深紫字）→ 统一改 `btn-primary` 为 `background: var(--rc-accent); color: var(--rc-hi)`，不要再回退旧配色。

### 1.11 Bloom / 硬编码深色的冲突消解（务实方案）

**Bloom（8 个舞台文件）** — 不删变量，做**作用域收敛**：

| 变量族 | 判定 | 处理 |
|---|---|---|
| `--bloom-*` 中控制**页面/舞台底色、面板底、文字、边框**的变量 | Shell 类 | 在 `.bloom-stage` 作用域内覆盖为 `--rc-bg/-surface/-text/-border`，与别名层同源 |
| `--atelier-*`、`--loom-*` 中控制**节点状态、连线、证据类型**的变量 | Data 类 | 保留独立命名，但色值改为 rc 功能色：`--loom-pass → --rc-success`、`--loom-fail → --rc-danger`、`--loom-pending → --rc-warning`、连线 → `--rc-violet` |
| 舞台发光/光晕 | Glow 类 | 统一用 `--rc-glow-violet` / `--rc-glow-magenta`，去掉墨绿光 |

> 8 个舞台**不逐页改色号**：在 bloom 各自的根容器加一个覆盖块即可（约 1 处/文件）。若某变量无法归类，默认按 Shell 处理。

**硬编码深色文件**：`overview-showcase.css`、`report-accordion.css` 做一次字面量替换表：

| 原字面量 | 替换为 |
|---|---|
| `#0e0f0c` / `#08040f` / 近黑 | `var(--rc-bg)` / `var(--rc-ink)` |
| `#1f211c` / `#2c2f28` | `var(--rc-surface)` / `var(--rc-surface-2)` |
| `#9fe870` / 任何绿色 | `var(--rc-accent)` / `var(--rc-success)` |
| `#e2f6d5` | `var(--rc-accent-wash)` |
| `#ffffff`（作为面板底） | `var(--rc-surface)`（作为文字保留 `var(--rc-hi)`） |
| `#dcdfd8` / `#e8ebe6` | `var(--rc-border)` / `var(--rc-border-hair)` |
| 表行 hover `#f4f9ef` | `rgba(124,47,207,.08)` |
| 滚动条 `#c9ccc4` | `rgba(233,213,255,.28)` |

**迁移执行顺序（Phase 3）**：① 引入 §1.9 + §1.10 → ② bloom 作用域覆盖 → ③ 硬编码替换 → ④ 8 类页面布局升级 → ⑤ 组件 token 化（StatusBadge/DataTable 等）→ ⑥ 可选清理别名（建议保留）。

---

## 2. 统一图标系统规范

### 2.1 设计语言

**"克制的精密仪器"**：参考 Apple 图标的留白与规整 + Lucide 的几何纪律。一句话规则——**线性、单色、圆端、等重、无渐变、无阴影（除交互发光）**。

| 维度 | 规范值 |
|---|---|
| 基础库 | `lucide-react ^0.454`，**不引入第二套图标库**，不混用实心/线框 |
| 网格 | 24×24 viewBox；图形落在 **2px 安全边距内的 20×20 区域**；关键轴 2 / 6 / 12 / 18 / 22 |
| 线宽 | 统一 `strokeWidth = 1.75`；≤16px 用 `2`；L1 磨砂盘线框与 32px 装饰用 `1.5` |
| 端点/连接 | `stroke-linecap="round"`、`stroke-linejoin="round"`（**强制**；禁止 butt/miter） |
| 转角 | 方形结构圆角 = 网格的 1/8，即 24 网格上 **r=3**；容器圆角用 `--rc-radius-*` |
| 视觉重心 | 光学居中而非几何居中；细长图形（如 ArrowLeft）可上下 ±0.5px 微调；不得整体缩放填充 safe area |
| 填充 | `fill="none"`，颜色一律 `currentColor`；禁止渐变填充、禁止双色图标 |
| 阴影 | 默认无；仅 hover/active 用 `drop-shadow` 发光（见 §2.4） |

**场景 → 风格规则（不混用）**

1. **操作类**（按钮/表格行/菜单）：lucide 线性，`strokeWidth` 按尺寸表，**不做彩色**。
2. **状态类**（成功/失败/警告）：lucide 线性图标 + 语义色 token（如 `CheckCircle2` + `--rc-success`），**不用实心圆底**；仅 StatusBadge 的小圆点允许实心（`bg-current`）。
3. **L1 五线框入口**：lucide 线性 24px / 1.5，色 `--rc-purple-dark`（磨砂盘上）。
4. **L1 四 App 方块入口**：深色圆角方块容器 + **单色字形 22px / 1.75**，保持"深色实体图标"身份。**保留** compass 蓝紫盘面与 card 顶部琥珀条两处参考图特征；**取消** music 粉色（见 §3）。
5. **自定义 SVG**：仅在 lucide 无精确语义时使用（L1「AI」字样、差异监控新图标）；必须遵守同一网格/线宽/端点规则。

### 2.2 自定义 SVG 绘制规范

```svg
<svg viewBox="0 0 24 24" width="24" height="24" fill="none"
     stroke="currentColor" stroke-width="1.75"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <!-- 路径必须落在 x∈[2,22], y∈[2,22] -->
</svg>
```

- 一个 SVG 只表达一个语义；路径数 ≤4；避免 <1px 的视觉间隙（22px 显示下会糊）。
- 「AI」字形例外：用 `Sora 600 / 24px / letter-spacing:-.06em` 文本节点（现有 `.rc-glyph-ai` 已符合），不改成路径。
- 交付前在 16 / 20 / 24 / 32px 四档各看一次；16px 下若糊，允许把 `strokeWidth` 提到 2，不改图形结构。

### 2.3 用户点名图标映射表（22 项）

> 全部为 lucide-react 导出名；尺寸默认 20px/1.75（表格内 16px/2）。"自定义"项见括号。

| 场景 | 建议图标（lucide 名） | 尺寸/场景 | 备注 |
|---|---|---|---|
| 论文中心 | `BookOpen` | 24 / 功能磁贴 | 备选 `FileText`（材料域已占用 FileText，避免撞车） |
| 项目管理 | `FolderKanban` | 24 | L1「项目档案」仍用 `Folder` 忠于参考图；二级页用 Kanban 表结构 |
| 数据中心 | `Database` | 24 | 数据集页；备选 `Table2` |
| 代码中心 | `GitBranch`（规划 DAG）+ `SquareTerminal`（执行控制台） | 20 | **无独立代码中心路由**；由 `/reproductions/plans/:planId`、`/reproductions/runs/:runId` 承接，禁止新增假入口 |
| 环境管理 | `Boxes` | 24 | 备选 `Package`；依赖树用 `Network` |
| 复现任务 | `FlaskConical` | 24 | 运行/执行态用 `Play` 叠加，不另做图标 |
| 结果验证 | `BadgeCheck` | 24 | 通过态色 `--rc-success`；失败用 `BadgeX` + `--rc-danger` |
| 审计报告 | `ScrollText` | 24 | 强调证据链；备选 `ClipboardCheck` |
| 协作中心 | `UsersRound` | 24 | 外部集成用 `PlugZap` |
| 系统设置 | `Settings2` | 20 | 模型设置子页用 `Bot` |
| 用户中心 | `CircleUserRound` | 20 | 备选 `UserRound` |
| 上传 | `UploadCloud` | 20 | 简版 `Upload`（按钮内） |
| 下载 | `DownloadCloud` | 20 | 简版 `Download`（按钮内） |
| 搜索 | `Search` | 18 / 输入框前缀 | 不放大到 24 |
| 编辑 | `PenLine` | 18 | 与 L1 `edit` 入口一致 |
| 删除 | `Trash2` | 18 | 仅危险按钮用 `--rc-danger` |
| 保存 | `Save` | 18 | 禁用态见 §2.4 |
| 返回 | `ArrowLeft` | 20 | 页眉返回；与 L2 `.rc-crumb-home` 搭配 |
| 展开 | `ChevronDown`（折叠内容） / `Maximize2`（全屏） | 16 / 18 | 两个语义分开，不复用 |
| 收拢 | `ChevronUp` / `Minimize2` | 16 / 18 | 与上项成对 |
| 播放 | `Play` | 20 | 运行中改用 `LoaderCircle` + 旋转 |
| 暂停 | `Pause` | 20 | 与 Play 成对 |
| 刷新 | `RotateCw` | 18 | 动效：单次 400ms 旋转 `--rc-ease-out` |

**L1 九入口最终图标清单**（除 `diff` 外保持现状，降低返工）：

| id | 名称 | kind | 图标 | 色 |
|---|---|---|---|---|
| audit | 智能审计 | line | `Sparkles` | `--rc-purple-dark` |
| projects | 项目档案 | line | `Folder` | `--rc-purple-dark` |
| materials | 材料解析 | line | `FileText` | `--rc-purple-dark` |
| repro | 复现验证 | app | `Compass` | #E3E9FF（蓝紫盘面保留） |
| rules | 规则与字段 | app | `PenLine` | #FFFFFF |
| delivery | 验证与交付 | app | `CreditCard` | #F4EAFF（琥珀顶条保留） |
| **diff** | **差异与监控** | **app** | **自定义 SVG（§3）** | **#F4EAFF（粉色移除）** |
| collab | 协作与集成 | line | `Globe2` | `--rc-purple-dark` |
| models | 模型服务 | line | 「AI」字形 | `--rc-purple-dark` |

### 2.4 图标状态规范

| 状态 | 线性图标（浅底/磨砂盘） | App 方块图标 | 缩放 | 发光 |
|---|---|---|---|---|
| default | `currentColor = --rc-purple-dark`（浅）/ `--rc-lilac`（深） | 字形 #F4EAFF，边框 `rgba(255,255,255,.16)` | 1 | 无 |
| hover | 色 → `--rc-purple`，边框可加 `--rc-border-strong` | 边框 → `rgba(233,213,255,.5)` | **1.08**（L1 entry 视觉整体 1.12） | `0 0 12px rgba(168,85,247,.35)` |
| active（按下） | 色 → `--rc-violet` | 同 hover | **0.94**，80ms 回弹 | 无 |
| selected（当前页/已选中） | 色 → `--rc-violet` + 1px `--rc-magenta` 外环（offset 3px） | 边框 `--rc-lilac .75` + 外环 | 1.12 | `--rc-glow-violet` |
| disabled | `currentColor = --rc-text-subtle` + `opacity:.4` | 同左，`cursor:not-allowed` | 1 | 无 |

- 时长统一 `--rc-dur-base`，缓动 `--rc-ease-hover`；selected 入场用 `--rc-ease-out`。
- 键盘焦点：`:focus-visible { outline: 2px solid var(--rc-focus); outline-offset: 2px }`，任何状态都不可移除。

### 2.5 浅色/深色背景适配规则

| 元素 | 深色皮肤 | 浅色皮肤 / 磨砂浅玻璃 |
|---|---|---|
| 线性图标默认色 | `--rc-lilac` / `--rc-violet` | `--rc-purple-dark`（`#3B1066`，白底 10:1+） |
| 线性图标 hover/选中 | `--rc-magenta` / 发光 | `--rc-purple`（不发光，改用 `--rc-accent-wash` 圆底） |
| App 方块图标 | 深色底 + #F4EAFF 字形（不变） | **保持深色底**（它们是"深色物件"），不反相 |
| 危险/成功图标 | `--rc-danger` / `--rc-success`（亮版） | 浅色皮肤已覆盖为深版，自动生效 |
| 禁用态 | 两套均 `--rc-text-subtle` × .4 | 同左 |

**红线**：禁止在图标组件里写死 `color:#fff` 或 `color:#000`；一律 `currentColor` 由容器 token 决定。

---

## 3. 音乐图标重设计（用户特别强调）

### 3.1 现状诊断

| 项 | 现状 | 问题 |
|---|---|---|
| 入口语义 | `id='diff'` / name「差异与监控」，features = 实验差异、变化监控、数据质量审计、统计审计 | 与音乐毫无关系 |
| 图形 | `EntryLauncher.tsx` 中 `glyph:'music'`, `icon: Music2`；`RadialWorkbench.tsx` 的 `EntryGlyph()` 渲染 `Music2` | 历史命名/素材残留，误导用户与维护者 |
| 颜色 | `workbench.css` `.rc-app--music .rc-glyph-icon { color: #ff6b9a }` 粉色音符 | 是全站唯一高饱和粉色，破坏紫黑克制基调，与 8 个入口不同族 |
| 视觉重量 | 同为 36px 深色圆角块，但粉色产生额外"视觉重量" | 9 个入口不平衡，一眼被吸走注意力 |

结论：**必须换图形、换颜色、换命名**；容器几何（36px / r=10 / 深色磨砂 / 1px 白边 / 同款阴影）**保持不变**，以保证与其他 3 个 App 方块同族。

### 3.2 新图形概念

**概念名：偏差波形（Deviation Wave）** —— 上、下两条镜像的参考/实测轨迹，中间一枚菱形"偏差标记"。读起来同时像「对照两条曲线」「分叉对比」「波形偏差」，精准对应"差异与监控"，且与其余 8 个图标同为线性几何语言。

**可直接落地的 SVG**（推荐作为 `EntryGlyph()` 中 `glyph='diff'` 分支的返回值；圆点/菱形均为 stroke-only，无 fill）：

```svg
<svg viewBox="0 0 24 24" width="22" height="22" fill="none"
     stroke="currentColor" stroke-width="1.75"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <!-- 参考轨迹 -->
  <path d="M3 8.5c3.4 0 4.8-2.6 8-2.6 3.4 0 4.6 2.6 10 2.6"/>
  <!-- 实测轨迹（镜像偏离） -->
  <path d="M3 15.5c3.4 0 4.8 2.6 8 2.6 3.4 0 4.6-2.6 10-2.6"/>
  <!-- 偏差标记：菱形 -->
  <path d="M12 10.4 13.6 12 12 13.6 10.4 12Z"/>
</svg>
```

- 几何校验：路径范围 x∈[3,21]、y∈[5.9,18.1]，落在 2px 安全区内；3 条路径；`fill="none"`；两端圆头。
- 在 22px 显示下两条曲线与中心菱形均可辨；缩到 16px 仍可读（若项目要求极窄屏降级，把 `stroke-width` 调到 2）。
- **Lucide 备选方案**（若当轮不便加自定义 SVG）：`GitCompare` + `strokeWidth=1.75` + #F4EAFF，语义可用但辨识度低于自定义方案，**优先自定义**。
- **禁止**：`Activity`、`AudioLines`、`Music2`、`Waveform` 等会被读成"音乐/心跳"的图标；禁止彩色填充或渐变。

### 3.3 颜色与视觉重量统一

| 项 | 旧值 | 新值 |
|---|---|---|
| 字形色 | `#ff6b9a`（粉） | `#F4EAFF`（与 `.rc-glyph-icon` 默认一致）；选中时 `#FFFFFF` + `drop-shadow(0 0 8px rgba(168,85,247,.65))` |
| CSS 类 | `.rc-app--music` | `.rc-app--diff`（删除 `.rc-app--music .rc-glyph-icon{color:#ff6b9a}` 整条规则） |
| Entry 类型 | `glyph:'music'` | `glyph:'diff'`（同步 `Entry['glyph']` 联合类型与 `EntryGlyph()` 分支；**`id:'diff'` 与路由不变**） |
| import | `Music2` | 移除 `Music2` 导入，改为自定义组件（或 `GitCompare`） |
| 容器 | 36px / r10 / `rgba(18,8,30,.92)` / 1px 白边 / 同款阴影 | **完全不变** |

视觉重量校验（4 个 App 方块对齐）：`Compass` 22px 蓝紫盘面、`PenLine` 22px 白、`CreditCard` 22px 淡紫+琥珀顶条、`DeviationWave` 22px 淡紫 —— 四者面积、线宽、外框一致；仅保留 compass/card 两处参考图特征色，差异监控不再使用独占色。

> 附：语义功能色里的 `--rc-danger: #FF6B7D` 是**状态色**，与图标里的粉色不是一回事，不违反本条；不要把状态色用于入口图标。

---

## 4. 八类二级页面独特视觉语言

> 共同底线：紫黑品牌基色 + 玻璃五要素 + 同一 token 体系 + 同一图标系统。**差异化只发生在布局骨架、卡片形态、特色元素与动效**，不靠换主色。

### 4.1 论文管理（空间错位 / 层叠悬浮卡）

- **配色侧重**：浅色皮肤 `--rc-bg:#F6F0FB` + 白玻璃卡；强调 `--rc-violet`；论文来源用 `--rc-info` 细标签。
- **布局骨架**：12 栅格；左侧 3 列筛选栏，右侧 9 列**斜轴堆叠卡列表**（卡片沿 X 轴 -8px 递增偏移、Y 轴 +6px 递减，形成档案室纵深）；hover 时当前卡回到 z 顶。
- **卡片样式**：`--rc-radius-lg`，`--rc-shadow-panel`，标题 Sora 16/600，摘要 `--rc-text-muted` 12/1.5，右上角 `BookOpen` 16px。
- **特色元素**：卡片左上角"页码/版本"竖排 mono 11；层叠露出的纸边用 1px `--rc-border` + 8px 偏移。
- **动效**：滚动进入时卡片按索引错峰 30ms 淡入上移 6px（`--rc-ease-out`）；hover 卡片 200ms 抬起 4px + 紫晕。

### 4.2 项目管理（空间卡 + 关系图）

- **配色侧重**：深色皮肤；主卡 `--rc-surface-glass`，关系节点 `--rc-purple→--rc-magenta` 渐变线。
- **布局骨架**：上方 4 张 KPI 磁贴（4 列等宽），下方左 8 列"项目空间卡"、右 4 列"关系图"迷你画布；卡按项目阶段分列。
- **卡片样式**：玻璃卡 + 顶部 2px 阶段色条（规划紫 / 执行亮紫 / 验证薄荷青 / 归档中性）；角标用 mono 12 项目号。
- **特色元素**：关系图用细线 `--rc-border-strong` 连接，节点 8px 圆点 `--rc-violet`，hover 节点放大 1.3 并显示单向关联线。
- **动效**：切换阶段时卡片沿透视轴滑入 400ms `--rc-ease-out`，关系图节点连线 200ms 淡入。

### 4.3 数据集（数据卡 + 结构可视化）

- **配色侧重**：深底 + 单一品紫高亮；数值 `--rc-text`，字段名 `--rc-text-subtle`，结构图节点 `--rc-violet`。
- **布局骨架**：左 2 列数据集树，右 10 列：上"数据卡网格"（3 列），下"字段结构可视化"（横向条带 + 类型标签）。
- **卡片样式**：紧凑卡 `padding:16px`、r14；头部 `Database` 20px；行数/大小用 mono 12 `tabular-nums`。
- **特色元素**：结构图用不同灰度的紫色块表达字段类型（字符串/数值/时间），块宽 ∝ 字段占比（**数据必须来自真实统计**，不得画装饰条）。
- **动效**：字段块 hover 显 1px 亮边 + tooltip；切换数据集时结构图 200ms 交叉淡入。

### 4.4 代码管理（精密技术界面，保可读性）

> 承接页：复现规划 DAG / 执行控制台；**无独立代码中心路由**。

- **配色侧重**：最接近参考图 4：近黑 `--rc-bg` + 细网格 `rgba(233,213,255,.04)` 24px 网格；唯一高亮 `--rc-violet`；正文必须 `--rc-text`（不降对比度换气氛）。
- **布局骨架**：左侧 200px 步骤树，右侧：上 40% 脚本/配置只读区（mono 12，行号槽 32px），下 60% DAG 节点图；底部固定 48px 状态条。
- **卡片样式**：无大圆角卡，改 1px `--rc-border-hair` 分区 + r6 小 chip；代码块 `--rc-surface-3` + `overflow:auto`。
- **特色元素**：DAG 连线 1px `--rc-border-strong`，当前节点 1px `--rc-magenta` + 外发光；行号 `--rc-text-subtle` mono 11。
- **动效**：执行中节点用 2s 线性脉冲描边（仅当前节点）；**禁止**满屏跑马灯；`prefers-reduced-motion` 下全停。

### 4.5 环境管理（依赖可视化）

- **配色侧重**：深底；已解析依赖 `--rc-success`，缺失 `--rc-danger`，版本偏差 `--rc-warning`；连线 `--rc-violet`。
- **布局骨架**：左 3 列环境摘要（Python/包管理器/锁文件状态），右 9 列依赖拓扑（径向或分层），底部 1 行"版本偏差表"。
- **卡片样式**：依赖节点为小胶囊（r pill，padding 4/10，mono 12 版本号）；缺失节点虚线边 `--rc-danger` × .5。
- **特色元素**：拓扑节点大小 ∝ 被依赖次数（真实数据）；偏差项用 warning 三角 `TriangleAlert` 16px。
- **动效**：hover 节点高亮其**上游路径**（其余路径 opacity → .25，200ms）；不做自动旋转。

### 4.6 实验执行（科研仪器控制台 + 实时线条/波形）

- **配色侧重**：深底近黑；实时曲线 `--rc-violet`，参考线 `--rc-text-subtle` 虚线，越界段 `--rc-danger`；数值 mono。
- **布局骨架**：顶部 56px 运行控制条（Play/Pause/RotateCw + 运行 ID），中部左 8 列图表画布、右 4 列实时日志，底部 3 张指标卡（耗时/完成度/偏差）。
- **卡片样式**：仪表卡 `padding:20px`，数值 28px Sora 600 mono tabular；标签 11px overline。
- **特色元素**：细网格 + 十字准星 + 时间戳刻度；波形只允许**来自真实 run 数据**（后端指标/日志流），**严禁假数据动画**；无数据时用 `EmptyState` 明示"暂无运行数据"。
- **动效**：数据点追加用 120ms 淡入，不重绘全图；运行中状态点 2s 呼吸（可降级）；完成/失败一次性 400ms 状态切换。

### 4.7 结果验证（多层对比 / 动态指标卡）

- **配色侧重**：深底；基准 `--rc-text-subtle` 虚线，复现值 `--rc-violet`，一致 `--rc-success`，偏差 `--rc-danger`。
- **布局骨架**：顶部 2 列"基准 vs 复现"对照选择器，中部**双层透视卡**（前卡 scale 1 / 后卡 scale .96 + translateY(-12px)，r20 + 1px 亮边），底部差异明细表。
- **卡片样式**：指标卡内"数值 / 基准 / 偏差%"三栏，偏差正值 `--rc-danger`、负值 `--rc-neutral`，mono 12 tabular。
- **特色元素**：差异条：以 0 为中心的双向 mini bar（左右各 50%），长度 ∝ 真实偏差比例。
- **动效**：切换方案 400ms 透视滑入（`--rc-ease-out`），指标数字 200ms 计数过渡；reduced-motion 下直接切换。

### 4.8 审计报告（高级编辑感 + 证据链清晰）

- **配色侧重**：浅色皮肤"档案室"白玻璃；正文 `--rc-text`；证据引用左边框 `--rc-violet` 2px；结论块 `--rc-accent-wash`。
- **布局骨架**：左 2 列目录树（sticky），中 7 列报告正文（正文最大 72ch），右 3 列证据卡片栈（sticky）。
- **卡片样式**：正文段落无卡（靠留白与 1px 分隔线）；证据卡 r14 + 顶部 mono 11 证据 ID + `ScrollText` 16px。
- **特色元素**：正文中的证据引用为行内 chip（r6、下划虚线 `--rc-violet`），点击滚动到右栏对应证据并 1px 紫环高亮 400ms。
- **动效**：目录滚动联动 120ms 高亮；证据定位 400ms `--rc-ease-out`；打印样式转纯白底黑字、去阴影。

---

## 5. 全局统一规则（像素级）

### 5.1 间距 / 对齐 / 基线网格

| 项 | 规范 |
|---|---|
| 基线网格 | 4px；所有 padding/margin/height 为 4 的倍数（图标内部光学微调除外） |
| 栅格 | 12 列，gutter `--rc-grid-gutter: 24px`；内容 `--rc-content-max: 1440px` 居中 |
| 页面边距 | 桌面 32px / 平板 20px / 手机 16px |
| 页眉 | `--rc-header-h: 64px`，sticky，`backdrop-filter: var(--rc-blur-panel)`，底边 1px `--rc-border-hair` |
| 区块间距 | 相邻 section 24px；大段落 40px |
| **组件边缘对齐** | 同一行组件的**左边缘、基线、高度**必须一致；页眉标题与正文首行左对齐；卡片内所有子元素的左内边距统一 `--rc-card-pad:24px`；表格首列左内边距 = 卡片内边距 |
| 卡片内边距 | 标准 24px；密集数据卡 16px；弹窗 24px；**同屏卡片内边距必须一致** |
| 表单 | label 12/600 `--rc-text-muted`，下距 8px；输入框高 40px、padding 9px 12px、r10；focus 1px `--rc-accent` + 3px `--rc-accent-wash` |
| 表格 | 表头 11px mono/600、uppercase、`.06em`、padding 12px 16px；单元格 13px、padding 12px 16px；行高 ≥44px；hover 底 `rgba(124,47,207,.08)` |
| 图标↔文字 | 标准 8px（`--rc-icon-gap`）；按钮内图标↔文字 8px；紧凑 badge 4px；**不得用 6px/10px** |
| 图标对齐 | 图标与文字**视觉居中**：与 14px 正文搭配时图标 18px，icon 顶部比文字顶部低约 2px（用 flex `align-items:center` 即可），不手动 translate |

### 5.2 弹窗 / 浮层结构

```
遮罩   rgba(8,4,15,.62) + backdrop-filter: blur(6px)，z-index 70
面板   最大宽度 640px（sm 480 / lg 880），radius 20px，
       background: var(--rc-surface-glass) + var(--rc-blur-panel)，
       border: 1px solid var(--rc-border)，box-shadow: var(--rc-shadow-pop)
头部   padding 20px 24px 16px，标题 H2 20/600，底边 1px --rc-border-hair
主体   padding 24px，max-height 60vh，overflow-y auto
底部   padding 16px 24px，右对齐按钮，按钮间距 8px
关闭   32px 圆形，r pill，1px --rc-border，Icon X 16px
动效   入场 200ms --rc-ease-out：opacity 0→1 + translateY(8px→0) + scale(.98→1)
       出场 120ms --rc-ease-hover；遮罩与面板同步
键盘   Esc 关闭、Tab 焦点锁定、打开后焦点落在面板/第一个可聚焦元素
```

- 危险操作确认弹窗：主按钮改 `--rc-danger`，但不加红色面板底（保持紫黑基调）。
- 移动端（<640px）：底部抽屉式，r `20px 20px 0 0`，`padding-bottom: calc(20px + env(safe-area-inset-bottom))`。

### 5.3 高频公共组件 Token 化（Phase 3 落地清单）

| 组件 | 关键改动 |
|---|---|
| `StatusBadge` | `Tone` 的 `accent/success/danger/warning/neutral/navy` 六档全部改绑 rc token；pill r999；padding 2px 8px；12/500；圆点 6px `bg-current` 保留；`dot` 关闭时不留空 gap |
| `ErrorState` / `EmptyState` / `LoadingState` | 插图图标 32px `--rc-icon-xl` / 1.5；标题 H3 16/600；说明 12 `--rc-text-muted`；主按钮 40px 高；Loading 用 `--rc-violet` 单色旋转 800ms，不用多色 spinner |
| `PageHeader` | 标题 H1 28/600（正文页 20/600）；描述 14 `--rc-text-muted`；actions 右对齐、按钮高 36/40 统一、图标 18px |
| `DataTable` | 表头/单元格内边距统一 12px 16px；行高 44；hover 紫化；选中行左侧 2px `--rc-violet`；空态内嵌 `EmptyState` |
| `Modal` / `Tabs` / `CopyButton` / `JsonBlock` | Modal 按 §5.2；Tabs 下划线 2px `--rc-violet`、文字 14/500→600；CopyButton 图标 16/18 + 200ms 成功态切 `Check`；JsonBlock 用 `--rc-surface-3` + mono 12 + 无彩色语法高亮（仅紫/中性两档） |

### 5.4 避免什么（返工红线）

1. ❌ 新增任何绿色；`--accent` 绿系只允许作为兼容别名存在。
2. ❌ 在 bloom 舞台外用墨绿；在业务页用 bloom 变量。
3. ❌ 图标混用实心/线框、改线宽、写死颜色、加渐变或阴影（交互发光除外）。
4. ❌ 保留 `Music2` 粉色音符或把"差异与监控"做成音乐语义。
5. ❌ 给 8 类二级页各换一个主色来"做差异化"——差异化靠布局、卡片形态、特色元素与动效。
6. ❌ 实验执行页出现假数据波形/假进度；数据不真实时显示空态。
7. ❌ 新增"代码中心"路由或入口；按现有规划/控制台承接。
8. ❌ 玻璃面只做半透明、漏掉 blur + 1px 亮边 + 多层阴影 + 环境色叠加。
9. ❌ 动画幅度过大；环境动画必须可降级到 `prefers-reduced-motion`（保留 120ms 淡入淡出）。

---

## 6. 交付接口（给 Phase 3）

- 复制 §1.9 到 `frontend/src/styles/index.css` 顶部（在 `@tailwind` 指令后），§1.10 追加到文件末尾。
- 修改 `workbench.css`：把 §1.9 的 10 个品牌色保持原值不动；删除 `.rc-app--music` 粉色规则，新增 `.rc-app--diff`（颜色 #F4EAFF）；组件类逐步改绑语义 token。
- 修改 `EntryLauncher.tsx`：移除 `Music2` 导入；`glyph` 联合类型 `'music'` → `'diff'`；新增自定义 `DeviationWave` SVG 组件（路径见 §3.2）；`id/name/route/features` 一律不动。
- Bloom：在舞台根容器加作用域覆盖（§1.11），8 个文件各 1 处。
- 页面：按 §4 的 8 类语言分批迁移，优先高频 6 组件（§5.3）再逐页。
- 验收：在 `frontend/src` 范围 `grep` 不得出现 `#9fe870`、`#e2f6d5`、`#163300`、`Music2`、`rc-app--music`（本文的迁移对照表可保留这些字符串）；图标 `strokeWidth` 仅 1.5/1.75/2 三值。
