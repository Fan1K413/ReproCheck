# ReproCheck V3 全站 Design System（NO LEGACY UI）

## 1. 唯一视觉基准

最高优先级页面是登录后的 `/` 径向主工作台：

- `frontend/src/workbench/RadialWorkbench.tsx`
- `frontend/src/workbench/EntryLauncher.tsx`
- `frontend/src/workbench/FoldFieldCanvas.tsx`
- `frontend/src/styles/workbench.css`
- `frontend/src/styles/tokens.css`

其视觉特征为：深紫黑折叠场、中央磨砂玻璃圆盘、非等半径精密轨道、紫色环境光、薄荷青对照光、线框 SVG 图标与 120–400ms 克制动效。所有 L2 页面必须使用同一语义 token 与材质，不复制同一布局。

## 2. 色彩 token（唯一色源）

代码唯一来源：`frontend/src/styles/tokens.css`。

| 语义 | token | 用途 |
|---|---|---|
| 主背景 | `--rc-bg`, `--rc-bg-2` | L2 页面、深空底层 |
| 紫色主色 | `--rc-purple-deep`, `--rc-purple-dark`, `--rc-purple`, `--rc-violet`, `--rc-magenta` | 品牌、轨道、选中态 |
| 卡片表面 | `--rc-surface`, `--rc-surface-2`, `--rc-surface-3` | 面板、表格、表单容器 |
| 玻璃材质 | `--rc-surface-glass`, `--rc-surface-glass-2` | Modal、抽屉、浮层 |
| 边框 | `--rc-border-hair`, `--rc-border`, `--rc-border-strong` | 发丝线、普通边框、焦点边框 |
| 文本 | `--rc-text`, `--rc-text-muted`, `--rc-text-subtle` | 主文、次级、辅助 |
| 成功 | `--rc-success`, `--rc-success-wash` | 验证通过、完成态 |
| 警告 | `--rc-warning`, `--rc-warning-wash` | 待复核、边缘差异 |
| 失败 | `--rc-danger`, `--rc-danger-wash` | 删除、阻断、失败态 |
| 信息 | `--rc-info`, `--rc-info-wash` | 说明与系统状态 |
| 高光 | `--rc-hi`, `--rc-focus`, `--rc-glow-violet`, `--rc-glow-magenta` | 亮边、focus、hover 光 |

纪律：业务组件禁止新增颜色字面量；特殊材质只能使用以上 token 的透明组合。

## 3. 字体系统

唯一来源：`tokens.css §3`。

- 展示/页面主标题：`--rc-font-display`（Sora），`--rc-fs-display` / `--rc-fs-h1`。
- 正文：`--rc-font-body`（PingFang SC / Microsoft YaHei），`--rc-fs-body`。
- 数字、ID、代码：`--rc-font-mono`（IBM Plex Mono），`--rc-fs-mono`。
- 行高：`--rc-lh-tight` 用于大标题，`--rc-lh-h` 用于模块标题，`--rc-lh-body` 用于正文。
- 字距：`--rc-ls-display`、`--rc-ls-h1`、`--rc-ls-body`、`--rc-ls-caption`、`--rc-ls-mono`。

## 4. 材质与空间

- 玻璃面板：`linear-gradient(145deg, rgba(246,240,252,.085), rgba(246,240,252,.035)) + --rc-surface`。
- 顶栏：半透明深紫渐变 + `--rc-blur-panel` + 发丝高光。
- 主背景：多层 radial 紫光 / 薄荷青环境光 + `--rc-bg` 至深紫渐变。
- Blur 边界：全屏背景不 blur；只在顶栏、抽屉、Modal、局部浮层使用，避免大面积 GPU 压力。
- 阴影：优先 `--rc-shadow-panel`；弹出层 `--rc-shadow-pop`；主工作台玻璃盘可用 `--rc-shadow-glass`。

## 5. 图标系统

唯一入口：`frontend/src/components/Icon.tsx`。

- lucide-react 作为基础 SVG 库；统一 `currentColor`、圆端圆连接、无填充渐变。
- 尺寸：`xs=16`, `sm=18`, `md=20`, `lg=24`, `xl=32`。
- 线宽：小图标 2，常规 1.75，装饰 1.5。
- 语义 tone：`muted/subtle/accent/success/danger/warning/info/inverse/onAccent`。
- 状态：hover/active/selected 只能改变颜色、轻微位移或紫色 glow，不得改变图标比例。
- 差异监控专用自定义 SVG：`DeviationWave`，3 条 path，两条镜像轨迹 + 中心菱形。

## 6. 动效系统

唯一缓动来源：`tokens.css §7`。

| 场景 | 时长 | 曲线 |
|---|---:|---|
| 点击即时反馈 | `--rc-dur-instant` 80ms | `--rc-ease-out` |
| hover / focus | `--rc-dur-fast` 120ms | `--rc-ease-hover` |
| 页面、卡片、Modal | `--rc-dur-base` 200ms | `--rc-ease-out` |
| 复杂空间展开 | `--rc-dur-slow` 400ms | `--rc-ease-out` |
| 环境光 / 轨道 | `--rc-dur-ambient` 24s | `linear` |

纪律：只动 `transform` 与 `opacity`；`prefers-reduced-motion: reduce` 下取消位移、无限动画与旋转，仅保留快速淡入。

## 7. 可复用组件清单

公共实现位置：`frontend/src/components/`。

- `Icon`：统一 SVG 图标入口。
- `PageHeader`：V3 页面头，含 eyebrow/title/description/actions。
- `Modal`：玻璃弹窗、Esc 关闭、焦点归还。
- `Tabs`：语义 tablist，选中态统一紫高光。
- `DataTable`：玻璃表格容器与统一表头。
- `LoadingState / EmptyState / ErrorState`：真实状态，不允许假进度。
- `StatusBadge`：成功/警告/失败/中性状态徽章。
- `Toaster / toast`：统一通知。
- `AppLayout`：V3 深色空间背景、顶栏、按需 Drawer、全部功能浮层、面包屑与退出登录。
- 原生 Canvas：`FoldFieldCanvas`、Bloom 证据织机 / 工坊画布；这些是实时绘制组件，不是截图。

## 8. 页面布局纪律

允许不同宏观布局，禁止风格断层：

- 项目：层叠档案卡 + 关联关系聚焦。
- 材料：筛选档案架 + 上传队列 + 详情抽屉。
- 事实：证据卡与原文对照。
- 复现控制台：日志、指标与运行状态精密仪表台。
- 协作/治理：统一深色档案卡与真实状态徽章。
- 不使用旧式白底 SaaS 圆角列表作为页面基底；不再出现 `data-rc-skin="light"` 造成的整页风格切换。

## 9. 反截图纪律

- 禁止 `<img>` 展示旧 UI 截图、`background-image:url(...)`、Base64 UI、`iframe` 旧页面、`video` 录屏背景。
- 允许：真实论文/科研材料上传预览、用户主动上传图片、测试证据截图（仅保存在 `.screenshots/`，不进入组件树）。
- 源码扫描命令已纳入 `frontend/scripts/v3-no-legacy-verify.mjs`。

## 10. V3 已落地文件

- `frontend/src/styles/rc-unified.css`
- `frontend/src/pages/auth/LoginPage.tsx`
- `frontend/src/components/AppLayout.tsx`
- `frontend/src/components/PageHeader.tsx`
- `frontend/src/styles/index.css`
- 移除全部页面级 `data-rc-skin="light"` 切换。
