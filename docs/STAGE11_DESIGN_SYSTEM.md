# 交付 7：设计系统规范（第十一阶段）

本阶段不推翻既有 Tailwind + CSS 变量体系，只在新增页面上统一使用已有 tokens，避免视觉分叉。

## 1. 颜色（来自 `src/styles/index.css` / `tailwind.config.js`）

- `navy-*`：深色侧栏与标题层级（科研软件的稳定感）。
- `ink / ink-muted / ink-subtle`：正文 / 次要 / 弱化文本三级。
- `line / line-soft / canvas / surface`：边框、分隔线、页面底、面板底。
- `accent / accent-dark / accent-wash`：唯一强调色（默认/选中态）；**不新增第二种强调色**。
- `success / warning / danger / neutral`：状态语义色，配 `-wash` 背景。

规则：状态色只用于状态，不用于装饰；不用渐变铺底；不使用高饱和大面积色块。

## 2. 字体与信息层级

- 无衬线 UI 字：Inter；等宽数据字：IBM Plex Mono（`font-mono` / `.mono`）。
- 层级：页面标题 `text-lg font-semibold` → 面板标题 `text-sm font-semibold` → 正文 `text-sm` → 辅助 `text-xs text-ink-muted`。
- ID、模型名、commit、token 数、耗时等**一律等宽**，便于科研数据比对。

## 3. 间距与形状

- 页面主区 `space-y-5`；面板内部 `px-5 py-4`；表单字段 `space-y-3`。
- 圆角：面板 `rounded-panel`；控件 `rounded`；标签 `rounded`。
- 阴影：仅 `shadow-panel` / `shadow-pop`（弹窗）；不叠加多层阴影。

## 4. 组件约定

| 组件 | 用法 |
|---|---|
| `Panel` | 统一面板头 `panel-header` + 内容区；新页面不再自造卡片样式 |
| `PageHeader` | 页面标题、描述、右侧动作区 |
| `Modal` | 所有表单弹窗；Esc 与遮罩关闭；`wide` 只用于复杂表格 |
| `StatusBadge` | 6 种 tone；状态文字必须与数据一致，不提前显示成功 |
| `LoadingState` / `ErrorState` / `EmptyState` | 加载、错误、空数据三态必须覆盖 |
| `Tabs` | 同级切换；当前项 `aria-selected` |
| `DataTable`（或 `.data-table`） | 表格统一密集模式；可横向滚动，不压缩列宽 |

## 5. 按钮与表单

- `btn-primary` 只用于主操作（保存、生成报告、确认）；`btn-ghost` 用于次级操作。
- 进行中必须禁用按钮并显示 `Loader2 animate-spin`，防重复提交。
- 危险操作（撤销、删除、创建重审任务）需二次确认或显式勾选确认框。
- API Key 输入必须 `type="password"`，`autoComplete="off"`；提交后清空组件状态。

## 6. 响应式

- 侧栏在窄屏转横向滚动导航；模型中心左导航 `lg:flex-col` 其余 `flex-row overflow-x-auto`。
- 表格外层 `overflow-x-auto`，不让列错位。
- 统计卡片 `grid-cols-2 sm:grid-cols-4`。

## 7. 动效与克制原则

- 只允许旋转加载图标、颜色过渡 `transition-colors`；不放大面积动画。
- 不做"AI 模板风"的渐变标题、发光边框、漂浮卡片。
- 信息密度优先：科研数据一屏可读优先于装饰留白。
