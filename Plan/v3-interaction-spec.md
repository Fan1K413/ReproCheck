# ReproCheck V3 全站体验与交互规范

## 1. 信息架构

- L1 `/`：径向主工作台，负责九类能力入口与上下文选择。
- L2 `/projects`、`/orgs`、`/settings/*`、`/benchmark`、`/rules` 等：业务空间页，使用统一顶栏 + 页面头 + 内容区。
- L3 浮层：功能目录 Drawer、全部功能 Popover、Modal、材料详情 Drawer、移动关联 Drawer。
- 项目 Bloom 工作台：`workbench / focus / atelier / loom` 四级项目空间，不使用旧页面截图。

## 2. 导航规则

- Esc：优先关闭当前 L3 浮层；无浮层时关闭功能目录；仍无目录时返回 L1。
- 功能目录：打开后焦点进入第一个导航项，关闭后焦点归还「目录」按钮。
- 面包屑：「工作台」始终可返回 L1；当前页标题与 `aria-current="page"` 一致。
- 页面切换：内容区 400ms 内淡入上移，禁止长时间空白和假加载。

## 3. 核心交互

| 场景 | 真实行为 | 验收 |
|---|---|---|
| 登录 / 注册 | 调 `/auth/login` 或 `/auth/register`；失败显示后端错误；成功写入会话并跳转 | 独立未登录上下文验证 |
| 演示账户 | 一键填充邮箱和密码，不自动伪造登录成功 | 点击后输入值可断言 |
| 功能目录 | 打开 / Esc 关闭 / 遮罩关闭 / 焦点归还 | `role=dialog`、`aria-modal=true`、关闭后 DOM 移除 |
| 项目档案 | 点击“展开关联”加载 Bloom 真实聚合节点，再点收起 | 文本与节点数变化 |
| 材料筛选 | 类型 / 状态筛选按钮可切换 `aria-pressed` | 筛选状态可断言 |
| 材料操作 | 上传、解析、下载、删除均接真实 API；删除必须 confirm | 不伪造进度，不静默失败 |
| 科研事实 | 证据展开、人工修订、修订历史均触发真实请求 | 成功后刷新相关 query |
| 复现控制台 | 日志、指标、运行状态读取真实 run；暂停 / 继续 / 失败分类接现有接口 | 显示真实 run_id 与状态 |
| Modal | Esc / 遮罩 / 关闭按钮可退出；焦点进入 panel，关闭后归还触发元素 | 焦点语义可断言 |
| 空 / 错 / 加载 | 使用 EmptyState / ErrorState / LoadingState，不使用假数据填充 | 截图与 DOM 验收 |

## 4. 响应式

- 桌面优先 1440px；内容最大宽 `--rc-content-max`。
- 移动 390px：页面头纵向排列，卡片单列，抽屉全宽，禁止横向溢出。
- 触达目标：常规按钮 ≥40px，移动关键操作 ≥44px。
- `prefers-reduced-motion: reduce`：取消空间位移、旋转与无限循环，仅保留 120ms 淡入。

## 5. 无障碍

- 图标默认 `aria-hidden`；有语义时提供 `title`。
- 表单控件必须绑定 `<label>` 或可访问名称。
- Drawer / Modal 使用 `role="dialog"` 与 `aria-modal="true"`。
- 状态变化使用文字与徽章，不只依赖颜色。
- `:focus-visible` 环必须清晰可见，不允许动效延迟焦点显示。

## 6. 视觉一致性检查点

1. 页面背景属于 `rc-app-universe / rc-stage / bloom-layout` 三种真实壳之一。
2. 卡片使用 `--rc-surface` 或语义 glass 层。
3. 字体层级来自 `--rc-fs-*`，图标来自 `Icon.tsx`。
4. 间距来自 `--rc-space-*`，圆角来自 `--rc-radius-*`。
5. 不允许出现页面级 `data-rc-skin="light"` 断层。
6. 不允许旧 UI 截图作为 `<img>`、背景、iframe、视频或 Canvas 图像源。

## 7. 当前自动化验收

- 独立脚本：`frontend/scripts/v3-no-legacy-verify.mjs`
- 覆盖：39 条业务路由双视口、3 个 Bloom 视图、独立登录页、抽屉、项目关系、材料筛选、源码反截图扫描、控制台 / pageerror / 失败请求采集。
