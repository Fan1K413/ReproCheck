# ReproCheck 全站交互规范 · Global Interaction Spec（Phase 2 · 体验设计）

> 文档性质：**全站交互 / 信息架构规范 + 逐页创新交互方案 + 改造验收表模板**，不含业务组件代码。落地由 Phase 3 前端工程师执行。
> 继承关系：本文**完整继承** `Plan/global-design-system.md`（Phase 1 定稿，838 行）——所有颜色、间距、圆角、阴影、字号、时长、缓动数值**一律引用 `--rc-*` token，不自造任何数值**；并延伸 `Plan/interaction-spec.md`（L1 工作台交互：9 入口 / 径向拖动 / 三级层级 / 37 路由）。
> 适用范围：41 个页面条目（37 业务路由 + L1 工作台 + 登录页 + 历史页/兜底，见 §5 说明）+ 8 个 Bloom 舞台文件 + 5 个 workbench 文件 + AppLayout + 6 个高频公共组件。
> 阅读对象：非专业编程用户 + 前端工程师。每条规则都给到判断条件或明确 token 引用，可直接落地。

---

## 0. 先读这五条（避免做错方向）

| # | 结论 | 理由 |
|---|---|---|
| **D1** | **L1 主入口只有圆盘，没有侧栏。** L2 侧栏取消"常驻"，降级为**按需唤出的抽屉式辅助导航**，默认不占内容宽度 | 用户上轮明确"不要侧栏作为主入口，二级页保留侧栏可接受"；常驻 248px 侧栏是旧版主入口思维，会让 8 类页面布局无法各异。裁决详见 §1.4 |
| **D2** | L2 的**主导航 = 顶栏面包屑 + 「全部功能」浮层**，与 L1  Circular 工作台同源；侧栏抽屉只是跨区跳转的辅助通路 | 承接 `interaction-spec.md` §1/§5，不新增第十个入口 |
| **D3** | 每个重要业务页**至少一种与其业务匹配的特色交互**，且必须绑定**现有真实接口/字段**；没有数据时显示空态，**严禁假数据动画** | 用户硬性要求 + Phase 1 §4.6/§5.4 红线 |
| **D4** | 动画按 Apple 细腻度做：**transform / opacity 优先**，按 token 取时长与缓动；`prefers-reduced-motion` 全站降级；动画不阻塞、不掩盖加载失败 | 用户硬性要求；详见 §4、§6 |
| **D5** | **不新增路由、不删业务、不造假数据。**「代码中心」无独立路由，由复现规划 DAG / 复现环境承接 | Phase 1 §0 边界；`App.tsx` 已核实 |

> 数据真值来源（本文所有"真实数据绑定点"均出自这些文件，工程师按此核对）：
> `frontend/src/App.tsx`（路由）、`types/reproduction.ts` + `types/api.ts`（字段）、`services/reproductionApi.ts` + `api.ts`（接口）、各页 `useQuery` 的 `queryKey`，以及 `components/AppLayout.tsx`（导航壳）。

---

## 1. 全站交互层级承接

### 1.1 三级职责与承接关系

> 沿用 `interaction-spec.md` §1.1 的三层定义，本文补齐"L2 如何继承工作台语言但布局各异"的规则。

| 层级 | 名称 | 职责 | 视觉承接 | 本层不做 |
|---|---|---|---|---|
| **L1** | 中央工作台（`/`） | 只回答"我要去哪一类工作"：9 入口 + 中央状态文案 + 径向拖动 | 紫黑褶皱 Canvas + 磨砂圆盘 + 9 环绕图标（图 1，唯一形态） | 不显示业务数据、不做表单、无侧栏 |
| **L2** | 功能空间（37 业务路由） | 完成一类完整任务；承载该类目全部真实路由；子功能间切换 | 继承工作台**紫黑色源 + 玻璃五要素 + 同一 token / 图标系统**；按 §1.2 选布局语言 | 不再套暗色圆盘、不做第二个常驻侧栏 |
| **L3** | 操作面板 | 单个局部动作：新建、确认、筛选、详情预览、抽屉导航 | 从当前 L2 语言里"长出来"的浮层/抽屉，保留 1px 亮边 + 紫光晕 | 不改 URL、不算新页面层级；Esc 即关 |

**一句话承接**：L1 用"盘心放大淡入"把用户送进 L2（400ms，`--rc-dur-slow` + `--rc-ease-out`）；L2 顶栏永远有「工作台 › 入口 › 当前页」面包屑 +「全部功能」按钮；L3 只在该页内浮出，关掉回到原页。

### 1.2 L2 如何"继承语言但布局各异"（关键）

继承的是**底层契约**，变化的是**上层骨架**。工程师按下面这张表判断"什么不动、什么可以变"：

| 维度 | 必须继承（不可变） | 可以各异（8 类差异化就发生在这里） |
|---|---|---|
| 色源 | 10 色品牌基色 + 语义层 token，禁字面量 | 深色/浅色皮肤由页面性质选（Phase 1 §1.3/§1.4） |
| 玻璃 | 五要素（半透底 + blur + 1px 亮边 + 多层阴影 + 环境色） | 卡片圆角/厚度、层叠方式 |
| 图标 | lucide 线性、1.75 线宽、`currentColor`、圆端 | 尺寸档位、与文字组合 |
| 动效 | 时长/缓动只取 token；transform/opacity 优先；可降级 | 特色动效（层叠、展开、波形、透视） |
| 布局 | 4px 基线、12 栅格、页边距、顶栏 64px | **列结构、卡片形态、留白节奏**——这是 8 类页面"看起来不一样"的主战场 |
| 间距 | `--rc-space-*`、`--rc-card-pad` 等 token | 栅格列分配（如论文 3/9、项目 8/4、环境 3/9） |

> 结论：**差异化不靠换主色**（Phase 1 §5.4 红线），靠"布局骨架 + 卡片形态 + 特色元素 + 特色动效"。§2 逐类给出。

### 1.3 任务流程图（全站版）

```
   ┌────────────────────────────────────────────────────┐
   │ L1 中央工作台（图 1 圆盘 · 无侧栏）                  │
   │ 9 入口；点击 / Tab+Enter / 拖动径向选择（三选一）    │
   └───────────────────────┬────────────────────────────┘
                           │ 400ms 盘心放大淡入（--rc-dur-slow）
                           ▼
   ┌────────────────────────────────────────────────────┐
   │ L2 功能空间（顶栏：工作台 › 入口 › 当前页 · 全部功能）│
   │ 按 §1.2 继承语言，按 §2 呈现 8 类布局之一            │
   │ └── 可选：顶栏「目录」按钮 → 左侧抽屉（L3 辅助导航）  │
   ├───────────────────┬────────────────────────────────┤
   │ 「全部功能」浮层   │ 页内操作（新建/筛选/对比/展开…） │
   │ 子功能一键切换     │            ↓                   │
   │ （仍是 L2）        │   ┌────────────────────────┐   │
   │                   │   │ L3 操作面板 / 抽屉 / 确认│   │
   │                   │   │ 表单 / 对比 / 证据预览  │   │
   │                   │   └───────────┬────────────┘   │
   │                   │  保存/取消/Esc → 回到原 L2 页   │
   └───────────────────┴────────────────────────────────┘
                           │ 面包屑「工作台」/ 返回键 / 浏览器后退
                           │ 统一 returnToWorkbench()：先处理未保存数据
                           ▼
                   回到 L1，显示「上次：…」上下文
```

### 1.4 AppLayout 改造裁决（侧栏去留）

**裁决（明确、可执行）：取消常驻侧栏，保留为"抽屉式辅助导航"，默认隐藏。**

| 场景 | 处理 | 理由 |
|---|---|---|
| **L1 工作台** | 无侧栏（现状已如此，`AppLayout` 外独立 `WorkbenchPage`） | 用户硬性要求，主入口是圆盘 |
| **L2 二级页 · 桌面 ≥1280** | 顶栏保留一个「目录」按钮（`ListTree` 18px）。点击后从左侧滑出 **280px 抽屉**（遮罩 `--rc-scrim` + blur `--rc-blur-scrim`），列出原侧栏全部分组与链接；默认关闭，**不占内容宽度** | 侧栏功能保留（可达性不丢），但不再是主入口；内容区全宽，8 类布局才能各异 |
| **L2 · 平板/手机 <1024** | 无常驻侧栏；「目录」抽屉同上，抽屉宽 `min(85vw, 320px)`；主导航仍是面包屑 +「全部功能」底部抽屉 | 承接 `interaction-spec.md` §6.3 |
| **Bloom 舞台 `/projects/:id/workbench`** | 完全无侧栏、无全局顶栏（现状 `isBloomWorkbench` 分支已如此），由舞台自带项目条导航 | Phase 1 §4 + 现有代码，保持不变 |

**落地要点（给 Phase 3）**：
- `AppLayout.tsx` 中 `aside` 从 `lg:translate-x-0` 常驻改为**默认 `-translate-x-full`**，由 `uiStore.sidebarOpen` 控制开合（字段已存在，无需新增状态）。
- 抽屉是 **L3 性质**：`role="dialog"`、非模态、Esc 关闭、`aria-label="功能目录"`、打开时焦点进抽屉、关闭后焦点回到「目录」按钮；打开时用遮罩按钮关闭（复用现有遮罩 `<button>` 结构）。
- 顶栏 `lg:pl-[248px]` 的内容区左内边距**移除**，内容区改为全宽居中（`--rc-content-max:1440px`）。
- 「全部功能」浮层（`AllFeaturesPopover`）保持不变，仍是跨功能首选；「目录」抽屉是它的**补充**（当用户想按旧分组浏览全部入口时用），二者入口都保留，不做二选一删除。
- 抽屉内的 `NavLink` 视觉按 token 重绑：选中态 `--rc-accent` 底 + `--rc-hi` 字（替换现有 `bg-accent text-accent-dark`），图标 18px / 1.75。

### 1.5 面包屑 / 返回 / 全部功能：统一规则

| 元素 | 统一规则 |
|---|---|
| **面包屑** | 固定三段 `工作台 › <入口名> › <当前页>`，位于 sticky 顶栏（高 `--rc-header-h:64px`）。第 1 段返回 L1，第 2 段进入该入口主路由，第 3 段为当前页（`aria-current="page"`，不可点）。超长用 `truncate`，不换行。 |
| **返回工作台** | 三种方式（面包屑「工作台」、页眉返回按钮 `ArrowLeft`、浏览器后退）**收敛到同一 `returnToWorkbench()`**：先处理未保存数据（`interaction-spec.md` §8.3）→ 写上下文 → 400ms 转场回 L1。名称与 `AppLayout.tsx` 现有同名函数一致，直接沿用并补"未保存确认"。 |
| **全部功能浮层** | 点击顶栏「全部功能」从面包屑下方浮出（手机端改为底部抽屉），列当前入口全部子功能 + 跨类相关链接。`role="dialog"` 非模态，Esc / 点击外部关闭，关闭后焦点回到触发按钮。入场 `--rc-dur-base` + `--rc-ease-out`，出场 `--rc-dur-fast`。 |
| **键盘 Escape 优先级**（沿用并补全 `AppLayout.tsx` §现有 keydown） | ① 有 L3 浮层 → 关 L3；② 否则有抽屉 → 关抽屉；③ 否则在 L2 → 返回 L1。输入框/文本域/可编辑区聚焦时不触发返回。 |

### 1.6 关键界面线框要点（L2 通用骨架，不是视觉稿）

```
┌──────────────────────────────────────────────────────────────┐
│ ← 工作台 › 复现验证 › 执行控制台   [目录]  [全部功能]   [用户]│ ← sticky 顶栏 64px
├──────────────────────────────────────────────────────────────┤
│  [可选通知条 rc-route-notice：无上下文时提示，5.2s 后淡出]      │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  按 §2 选 8 类布局之一（论文层叠 / 项目关系 / 数据条带…）│  │
│  │  内容区最大宽 --rc-content-max:1440px 居中              │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
   ↖ 左侧「目录」抽屉（默认隐藏）：280px，遮罩 + blur，L3 性质
```

---

## 2. 八类页面特色创新交互（逐类交付）

> 每类统一给出 6 项：**交互名称 / 用户操作 / 视觉反馈（token）/ 真实数据绑定点 / 任务流程与线框要点 / 响应式 / 无障碍 / 降级方案**。
> 铁律：所有数值/状态来自真实字段；空数据显示 `EmptyState`，失败显示 `ErrorState` + 重试，加载显示 `LoadingState` 骨架——动画不替代这四种状态。

### 2.1 论文管理 —— 空间展开与层叠浏览

**对应路由**：`/projects/:projectId/materials`（材料/论文列表，浅色"档案室"皮肤）、`/materials/:materialId`（详情）、`/projects`（列表卡显示 `paper_title`）。

| 项 | 内容 |
|---|---|
| **交互名称** | 档案层叠浏览（Stacked Archive）+ 点击展开详情 |
| **用户操作** | 右 9 列卡片沿斜轴错位堆叠（沿 X 轴 -8px 递增 / Y 轴 +6px 递减，沿用 Phase 1 §4.1）；鼠标 hover 当前卡"浮到最上层"，点击展开为详情面板（L3） |
| **视觉反馈** | hover 200ms（`--rc-dur-base` + `--rc-ease-hover`）抬起 4px + `--rc-shadow-glass` 加深 + 描边 `--rc-border-strong`；展开用 `--rc-dur-slow` + `--rc-ease-out`；露出的"纸边"用 1px `--rc-border`；来源标签 `--rc-info` |
| **真实数据绑定点** | `GET /materials`（`queryKey:['materials',projectId]`）→ `MaterialView { filename, material_type, size_bytes, parse_status, sha256, chunk_count, fact_count, created_at, error_message }`。卡片主标题=`filename`、角标=`material_type`、状态=`parse_status`（StatusBadge）、底部=`chunk_count`/`fact_count`（mono tabular）；展开详情显示 `sha256`、`error_message`、`created_at`。项目列表卡副标题=`project.paper_title`、`domain` |
| **任务流程图** | 进列表 → 扫层叠卡（hover 浮起）→ 点击 → L3 详情面板 → 关闭回列表。全程不改 URL（详情是面板不是新页）；需要独立链接时走 `/materials/:materialId` |
| **线框要点** | 左 3 列筛选（类型/解析状态/时间），右 9 列层叠卡；左上竖排 mono 11 页码/序号；卡片 r`--rc-radius-lg`、内边距 `--rc-card-pad`；详情面板宽 `--rc-content-max` 的 40%，从右侧滑入 |
| **响应式** | ≥1024 层叠；640–1023 减小错位倾角（≤6°）；<640 改**纵向堆叠 + 横向滑动切换**，取消透视变形，保证文字可读（`interaction-spec.md` §6.3） |
| **无障碍** | 层叠卡用真实 `<button>` 卡片，Tab 顺序 = 视觉层叠顺序；展开态 `aria-expanded` + `aria-controls`；`parse_status` 用 StatusBadge 文字（不只靠颜色）；读屏读"文件 X，解析状态 Y，N 个事实" |
| **降级方案** | 无数据 → `EmptyState`「暂无材料，请上传」；列表为空时不做层叠动画；reduced-motion → 直接平铺 + 120ms 淡入，取消错位与浮起 |

### 2.2 项目管理 —— 关联关系动态展开

**对应路由**：`/projects`（列表）、`/projects/new`、`/projects/:projectId/workbench`（Bloom 舞台，另见 §5）。

| 项 | 内容 |
|---|---|
| **交互名称** | 项目关系聚焦（Focus Graph）：选中项目 → 展开关联的论文/数据/代码/任务 |
| **用户操作** | 点击项目卡（或卡片上的"关联"入口）→ 该卡成为焦点，周围浮出关联节点（材料 / 数据 / 规划步骤 / 解析任务）；hover 某节点高亮"项目↔节点"单向连线；点击节点跳对应真实路由 |
| **视觉反馈** | 关系节点 8px 圆点 `--rc-violet`，连线 1px `--rc-border-strong`；选中项 `--rc-accent-wash` 底 + `--rc-magenta` 外环；节点连线 200ms（`--rc-dur-base`）淡入；阶段切换 400ms（`--rc-dur-slow` + `--rc-ease-out`）沿透视轴滑入（Phase 1 §4.2） |
| **真实数据绑定点** | `GET /projects`（`queryKey:['projects']`）→ `project { id, name, description, domain, paper_title, created_at }`；关联关系来自 Bloom `WorkbenchUnitData.units`（真实单元：`materials`/`dataset`/`facts`/`evidence`/`plan`/`environment`/`runs`/`verification`/`report`/`team`，见 `bloom/useBloomUnits.ts`），节点点击跳 `/projects/:id/{materials\|overview\|workbench}`。**没有关联数据时节点不显示，不虚构连线** |
| **任务流程图** | 进项目列表 → 选中卡 → 关系节点淡入 → 点节点跳真实页 → 返回仍保留焦点卡（local state） |
| **线框要点** | 上 4 张 KPI 磁贴（等宽，4 列），下左 8 列项目空间卡（按阶段分列，顶部 2px 阶段色条：规划紫/执行亮紫/验证薄荷青/归档中性），下右 4 列关系迷你画布；角标 mono 12 项目号 |
| **响应式** | <1024 关系画布收敛到卡片下方；<640 隐藏迷你画布，改为卡片内"关联 N 项"可点 chip → 底部抽屉列关联（仍是真实数据） |
| **无障碍** | 关系节点是 `<button>` + `aria-label="论文：文件名"`；选中态 `aria-pressed`；画布容器 `role="group"` + `aria-label="项目关联关系"`；连线仅装饰（`aria-hidden`），语义靠按钮文字 |
| **降级方案** | 无关联 → 显示"尚未建立关联"文字，不画空画布；reduced-motion → 取消透视滑入，节点 120ms 淡入；节点过多（>12）→ 只显示前 12 + "展开全部"按钮 |

### 2.3 数据集 —— 数据结构动态展开

**对应路由**：`/projects/:projectId/data-audit`（数据质量审计，图 4 深色精密）、`/projects/:projectId/facts`（含 `fact_type='dataset'` 的事实）。项目内无独立"数据集中心"路由，数据视图挂数据审计页。

| 项 | 内容 |
|---|---|
| **交互名称** | 结构透视条（Structure Ribbon）：数据集 → 展开文件结构 / 规模 / 格式 / 完整性 / 版本 |
| **用户操作** | 左侧数据集树选中一项 → 右侧"字段结构可视化"横向条带展开；hover 字段块显 1px 亮边 + tooltip（名称/类型/真实统计值）；切换数据集时条带交叉淡入 |
| **视觉反馈** | 字段块用紫阶（字符串/数值/时间三类灰度紫），**块宽 ∝ 真实字段占比**（Phase 1 §4.3 硬要求）；完整性用 `--rc-success`/`--rc-warning`/`--rc-danger` 状态色；切换 200ms（`--rc-dur-base`）交叉淡入；hover 亮边 `--rc-border-strong` |
| **真实数据绑定点** | `queryKey:['data-audit','list',projectId]` / `['data-audit','detail',projectId,selectedId]` / `['data-audit','rules']`（`services/dataAuditApi.ts`）→ 维度/问题/得分/规则字段；规模与格式来自材料/数据证据 `MaterialView.size_bytes`、`chunk_count` 与 `DataSourceLocator { sheet_name, column_name, row_count }`（`types/api.ts`）；版本来自 sha256 前 8 位（mono）。**占比必须由真实 `row_count`/字段计数计算，不得画装饰条** |
| **任务流程图** | 选数据集 → 条带展开 → hover 看细节 → 点问题进入审计明细。无 `row_count` 的字段不画长度，只显示名称与"未统计" |
| **线框要点** | 左 2 列数据集树，右 10 列：上 3 列数据卡网格（紧凑卡 padding `--rc-card-pad-tight`、r`--rc-radius-md`），下横向条带 + 类型标签（mono、`tabular-nums`）；表格遵循 Phase 1 §5.1 |
| **响应式** | <1024 树收为顶部下拉；<640 条带改纵向列表（每行=字段 + 真实值），保留状态色，取消宽度编码（窄屏宽度不可靠） |
| **无障碍** | 字段块 `<button>` + `aria-label="字段 X，类型 Y，N 行"`；占比同时用**文字数值**表达（不只靠长度/颜色）；tooltip `role="tooltip"` + `aria-describedby`；树用 `role="tree"` 语义 |
| **降级方案** | 无统计 → "暂无结构统计"，不画条；审计接口失败 → `ErrorState` + 重试；reduced-motion → 取消交叉淡入，直接替换 |

### 2.4 代码管理 —— 版本时间轴交互

**对应路由**：**无独立代码中心路由**；挂在 `/reproductions/plans/:planId`（规划 DAG，图 3/4）与 `/projects/:pid/reproduction/environment`（复现环境）。禁止新增假入口（`interaction-spec.md` §2.4）。

| 项 | 内容 |
|---|---|
| **交互名称** | 版本/步骤时间轴（Timeline Rail）：沿时间轴查看规划版本与环境变更 |
| **用户操作** | 页面左侧步骤树/时间轴，点击某节点 → 右侧上方显示该步脚本/配置只读区，下方 DAG 高亮当前节点；hover 节点显示该步状态与时间；时间轴可横向滚动 |
| **视觉反馈** | 当前节点 1px `--rc-magenta` + `--rc-glow-violet`；执行中节点 2s 线性脉冲描边（**仅当前节点**，Phase 1 §4.4 禁止满屏跑马灯）；DAG 连线 1px `--rc-border-strong`；代码块 `--rc-surface-3` + mono 12 + 行号槽；近黑 `--rc-bg` + 24px 细网格 `rgba(233,213,255,.04)` |
| **真实数据绑定点** | DAG 完全来自后端 `ReproductionDag { nodes: DagNode[], edges: DagEdge[] }`，`DagNode { id, status }`、`DagEdge { from, to }`（`ReproductionPlanPage.tsx` 明确"仅做布局，不做依赖推断"）；规划状态 `PlanView.status`；时间轴节点的状态用 `ReproTaskStatus`；环境变更用 `EnvironmentView.changed_from_original[]` + `created_at`。**脚本内容取真实返回字段，无则显示"未提供脚本"** |
| **任务流程图** | 选规划 → 时间轴列出节点（真实 nodes）→ 点节点 → 显示脚本/状态 → 跳执行控制台（`/reproductions/runs/:runId`） |
| **线框要点** | 左 200px 步骤树，右上 40% 只读区（mono 12、行号槽 32px），右下 60% DAG 节点图，底部固定 48px 状态条；无大圆角卡，用 1px `--rc-border-hair` 分区 + r`--rc-radius-xs` 小 chip |
| **响应式** | <1024 步骤树收为顶部横向时间轴；<640 DAG 改纵向步骤列表（保留连线语义为"→ 下一步"文字），只读区 `overflow-x:auto` |
| **无障碍** | 时间轴节点 `<button>` + `aria-current="step"`；状态用文字（"运行中"/"已阻塞"，不只靠脉冲色）；DAG 图提供等价的`<ol>`步骤列表给读屏；reduced-motion 下**全部脉冲停止** |
| **降级方案** | 无 nodes/edges → `EmptyState`「暂无复现步骤」；脚本字段缺失 → "未提供脚本"占位；reduced-motion → 节点静态高亮，无脉冲 |

### 2.5 环境管理 —— 依赖关系可视化

**对应路由**：`/projects/:pid/reproduction/environment`（图 4 深色）。

| 项 | 内容 |
|---|---|
| **交互名称** | 依赖聚焦图（Dependency Focus）：hover 依赖节点高亮其状态与来源，缺失/偏差一眼可见 |
| **用户操作** | 左 3 列环境摘要（Python 版本 / 包管理器 / 锁文件状态），右 9 列依赖清单拓扑；hover 某依赖 → 高亮该项并淡化其他项（opacity → .25，200ms）；底部"版本偏差表"列缺失与告警 |
| **视觉反馈** | 已解析 `--rc-success`、缺失 `--rc-danger`（虚线边 ×.5）、版本偏差 `--rc-warning`、连线/节点 `--rc-violet`；节点为小胶囊（r`--rc-radius-pill`、padding 4/10、mono 12 版本号）；偏差项 `TriangleAlert` 16px；**不做自动旋转** |
| **真实数据绑定点** | `EnvironmentView`（`queryKey:['repro-env',...]`，`GET /reproductions/environments`）：`python_version`、`frameworks`、`dependencies: DependencyView[]{ name, declared_version, source }`、`hardware_requirements`、`entrypoints`、`missing[]`、`warnings[]`、`changed_from_original[]`。**节点大小/状态必须由 `missing`/`warnings`/`changed_from_original` 真实判定** |
| **任务流程图** | 进环境页 → 看摘要 → hover 依赖看来源/版本 → 底部偏差表看告警 → 返回 |
| **线框要点** | 左 3 列摘要；右 9 列依赖拓扑（当前接口是**平铺清单**，按 `source` 分列成组即可：**不得虚构依赖箭头**，除非后端提供边字段）；底部偏差表用 `DataTable` |
| **响应式** | <1024 摘要收为顶部磁贴行；<640 拓扑改分组列表（按 source 分组），保留状态色与"缺失/偏差"文字 |
| **无障碍** | 依赖节点 `<button>` + `aria-label="包名 X，版本 Y，来源 Z，状态 W"`；hover 淡化用 CSS，但键盘 focus 同样触发（`:focus-within`）；缺失/偏差用 `TriangleAlert` + 文字双信号 |
| **降级方案** | 依赖为空 → `EmptyState`「未识别到依赖」；无 `declared_version` → 显示"未声明"；reduced-motion → 取消淡化过渡与任何旋转，直接切换 |

### 2.6 实验执行 —— 实时任务状态反馈（波形 / 进度 / 日志）

**对应路由**：`/reproductions/runs/:runId`（执行控制台，图 4 深色精密）。

| 项 | 内容 |
|---|---|
| **交互名称** | 仪器控制台（Instrument Console）：实时波形 + 进度 + 日志三联动 |
| **用户操作** | 顶栏 Play / Pause / `RotateCw`（刷新）+ 运行 ID；运行中自动轮询刷新；中部左图表画布看指标曲线、右看实时日志；底部 3 张指标卡（耗时/完成度/偏差） |
| **视觉反馈** | 实时曲线 `--rc-violet`，参考线 `--rc-text-subtle` 虚线，越界段 `--rc-danger`；数值 mono 28px Sora 600 `tabular-nums`；数据点追加 120ms（`--rc-dur-fast`）淡入、**不重绘全图**；运行中状态点 2s 呼吸（可降级）；完成/失败一次性 400ms（`--rc-dur-slow`）状态切换 |
| **真实数据绑定点** | `ReproductionConsolePage.tsx` 现有 4 个 `useQuery`：`['repro-run',runId]`（`ReproRunView.status`，`status==='running'` 才轮询）、`['repro-run-logs',runId]`（`LogEntry { log_id, stream, content, created_at }`）、`['repro-run-metrics',runId]`（`MetricView { metric_name, metric_value, unit, confidence, created_at }`）、产物与规划。**波形只能由 `metrics` 的真实点序列绘制；无数据显示 `EmptyState`「暂无运行数据」** |
| **任务流程图** | 选运行 → 看状态 → 运行中自动刷新（POLL_MS，仅 running）→ 看波形/日志 → 完成/失败一次性状态反馈。取消用现有 mutation + `repro-run` invalidate |
| **线框要点** | 顶部 56px 控制条；中部左 8 列图表（细网格 + 十字准星 + 时间戳刻度）、右 4 列实时日志；底部 3 张指标卡 padding `--rc-space-5`；状态用 `StatusBadge` + `runStatusLabel(run.status)`（现有函数，状态来自后端，非伪造） |
| **响应式** | <1024 图表与日志上下堆叠；<640 图表 `overflow-x:auto`、日志单列，控制条主操作固定底部安全区 `env(safe-area-inset-bottom)` |
| **无障碍** | 状态 `aria-live="polite"` 播报（"运行中/已完成/失败"）；波形附**文字摘要**（当前值/趋势/越界数）供读屏；日志 `role="log"` + `aria-live="polite"`；呼吸动画 reduced-motion 下停止但状态文字保留 |
| **降级方案** | 无 metrics → `EmptyState`（**绝不画假波形**）；查询失败 → `ErrorState` + `onRetry`；轮询仅在 `running` 时开启，停止后清除定时器；reduced-motion → 点直接出现、无呼吸、状态切换 120ms 淡入 |

### 2.7 结果验证 —— 双结果对比交互（论文 vs 复现）

**对应路由**：`/projects/:pid/reproduction/comparison`（动态透视卡片语言）。

| 项 | 内容 |
|---|---|
| **交互名称** | 双结果透视对比（Dual Result Compare）：前卡论文基准 / 后卡复现值，切换方案透视滑入 |
| **用户操作** | 顶部"基准 vs 复现"对照选择器；中部双层透视卡（前卡 scale 1 / 后卡 scale .96 + translateY(-12px)，沿用 Phase 1 §4.7）；切换方案时 400ms（`--rc-dur-slow` + `--rc-ease-out`）透视滑入；底部差异明细表可展开 |
| **视觉反馈** | 基准 `--rc-text-subtle` 虚线，复现 `--rc-violet`，一致 `--rc-success`，偏差 `--rc-danger`；差异条为以 0 为中心的双向 mini bar（左右各 50%），长度 ∝ 真实 `diff_relative`；指标数字 200ms（`--rc-dur-base`）计数过渡 |
| **真实数据绑定点** | `queryKey:['repro-comparisons',pid]` → `GET /reproductions/metric-comparisons` → `ComparisonView { metric_name, paper_value, reproduced_value, unit, diff_absolute, diff_relative, verdict, rule, tolerance_basis, conditions_check }`；质量 `queryKey` → `QualityView { dimensions[], overall, formula, scope_note }`。`verdict` 六态（`exact_match`/`within_tolerance`/`significant_deviation`/`insufficient_data`/`not_comparable`/`needs_manual_review`）用 `StatusBadge` 表达。**`paper_value` 或 `reproduced_value` 为 null → 标"数据不足"，不画对比条** |
| **任务流程图** | 进对照页 → 选方案 → 透视卡切换 → 看双向差异条 + 判定 → 展开明细看 `conditions_check`（同数据集/同划分/同指标…）。条件检查不全时不给"通过"结论 |
| **线框要点** | 顶部 2 列对照选择器；中部双层透视卡 r`--rc-radius-lg` + 1px 亮边；指标卡内"数值 / 基准 / 偏差%"三栏（mono 12 tabular）；底部 `DataTable`（表头/单元格 12px 16px，行高 44） |
| **响应式** | <1024 双层卡改上下排列（去掉 scale/translate 透视）；<640 改单列卡片轮播；差异条保留但宽度用百分比，附文字偏差值 |
| **无障碍** | 透视是装饰，前后卡有明确文字标题（"论文基准 X"/"复现值 Y"）；差异同时给文字（"+12.3%"）；`verdict` 用文字不用颜色；`aria-live="polite"` 播报方案切换结果 |
| **降级方案** | 单值为空 → "数据不足"占位、不画条；`insufficient_data`/`not_comparable` → 明确文案；reduced-motion → 直接切换，无透视滑入与计数动画 |

### 2.8 审计报告 —— 章节式空间导航

**对应路由**：`/projects/:pid/reproduction/reports`（浅色"档案室"白玻璃皮肤，高级编辑感）。

| 项 | 内容 |
|---|---|
| **交互名称** | 章节空间导航（Chapter Spatial Nav）：左目录 ↔ 中正文 ↔ 右证据，三栏联动 |
| **用户操作** | 左目录树点击/滚动联动高亮当前章节；正文中证据引用为行内 chip，点击 → 右栏对应证据卡滚动定位并 1px 紫环高亮 400ms；右栏证据卡可点开原文 |
| **视觉反馈** | 证据引用左边框 2px `--rc-violet`；结论块 `--rc-accent-wash`；行内 chip r`--rc-radius-xs` + 下划虚线 `--rc-violet`；目录滚动联动 120ms（`--rc-dur-fast`）高亮；证据定位 400ms（`--rc-dur-slow` + `--rc-ease-out`）；打印样式转纯白底黑字、去阴影 |
| **真实数据绑定点** | `queryKey:['repro-report', selectedReportId]` → `ReportView { report_id, title, status, version, section_count, html_available, pdf_available, sections[] }`；`ReportSection { section_id, key, index, chapter/title, origin, summary/content, conclusions/key_conclusions, sources[] }`（`types/reproduction.ts`）。**目录项来自 `sections[].chapter/title`，证据来自 `sections[].sources[]`（`ReportSource`/`EvidenceView`），不手写章节** |
| **任务流程图** | 选报告 → 目录定位章节 → 读正文 → 点证据 chip → 右栏证据定位 → 看原文 → 导出 HTML/PDF（`html_available`/`pdf_available` 为 true 才启用按钮） |
| **线框要点** | 左 2 列目录树（sticky）、中 7 列正文（最大 72ch，段落无卡靠留白 + 1px 分隔线）、右 3 列证据卡栈（sticky，r`--rc-radius-md`，顶部 mono 11 证据 ID + `ScrollText` 16px） |
| **响应式** | <1024 收为两栏（目录 + 正文），证据改正文内嵌折叠；<640 单列，目录改顶部"章节"下拉，证据 chip 点击弹底部抽屉显示原文 |
| **无障碍** | 目录 `role="tree"`、当前章节 `aria-current="location"`；证据 chip 是 `<button>` + `aria-label="证据 E-01，跳到右栏"`；定位同时滚动 + 焦点移动（键盘不迷路）；打印样式保留语义结构 |
| **降级方案** | `sections` 为空 → `EmptyState`「报告暂无章节」；`pdf_error` 存在时禁用 PDF 按钮并说明原因；reduced-motion → 证据定位改为直接高亮（无滚动插值），高亮保留 400ms 后淡出 |

> 8 类页面与 Phase 1 §4 视觉语言一一对应，工程师可把本节"交互"直接叠加到 Phase 1"视觉"之上，不做二次设计决策。

---

## 3. 全站动画系统规范（Apple 级）

> 唯一数值来源：Phase 1 §1.7「动画」token 表。**不新增时长/缓动数值**。Apple 细腻度的关键不是"动得多"，而是"该动的动、动的都是 transform/opacity、随时可降级"。

### 3.1 四类动画总表

| 类别 | 典型场景 | 时长 token | 缓动 token | 优先属性 | blur / 3D / 视差使用 |
|---|---|---|---|---|---|
| **A 微交互** | hover、按钮按下、图标状态、tooltip | `--rc-dur-instant` 80ms（按下回弹起点）、`--rc-dur-base` 200ms（hover） | `--rc-ease-hover`（hover/active）、`--rc-ease-spring`（仅按钮/图标轻微回弹，**不得用于页面**） | `transform`（scale 1.08 hover / 0.94 active）、`opacity`、`color`、`box-shadow` | 发光用 `--rc-glow-violet`/`--rc-glow-magenta`；**不用 blur 做动效**；图标缩放按 Phase 1 §2.4 |
| **B 转场** | 页面切换、弹窗、抽屉、抽屉展开、浮层 | `--rc-dur-slow` 400ms（页面/透视卡）、`--rc-dur-base` 200ms（弹窗入场）、`--rc-dur-fast` 120ms（出场） | `--rc-ease-out`（入场/层级）、`--rc-ease-inout`（展开/收拢） | `opacity` + `transform`（translateY(8px→0)、scale(.98→1)、scale(.92→1)） | 弹窗遮罩 `backdrop-filter: var(--rc-blur-scrim)`（静态，不动画 blur）；3D perspective 仅结果验证/论文层叠，幅度克制 |
| **C 数据动效** | 加载骨架、刷新、进度、数据点追加、计数 | `--rc-dur-fast` 120ms（数据点淡入、数字计数 200ms 用 `--rc-dur-base`）、刷新单次 `--rc-dur-slow` 400ms；Loading 旋转 800ms（Phase 1 §5.3 已定） | `--rc-ease-out`（刷新）、`--rc-ease-linear`（旋转/呼吸） | `opacity`、`transform`（进度用 `scaleX` 而非 `width`）、`background-position`（骨架） | 不用 blur；呼吸/脉冲只作用于**单个**状态点；**动画绝不掩盖加载失败——失败必须切 `ErrorState`** |
| **D 空间动效** | 卡片展开、层叠、视差、关系图展开 | `--rc-dur-slow` 400ms（展开/透视切换）、`--rc-dur-base` 200ms（连线淡入） | `--rc-ease-out`（展开入场）、`--rc-ease-inout`（收拢） | `transform`（translate/scale/rotate）、`opacity` | 3D perspective **克制**：仅 §2.1/§2.7 使用，倾角 ≤6°（窄屏更小）；parallax 仅 Bloom 舞台背景且幅度极小；hover 玻璃的 `--rc-blur-panel` 静态存在，不动 blur |

### 3.2 Apple 细腻度的四条实现原则

1. **缓动比时长更重要**：入场统一 `--rc-ease-out`（`cubic-bezier(.16,1,.3,1)`，快起慢收），不使用浏览器默认 `ease`。回弹 `--rc-ease-spring` 只给按钮/图标，页面级一律不用。
2. **transform / opacity 优先**：任何动画属性必须是 `transform` 或 `opacity`（或 color/box-shadow/background-position）；**禁止动画 `width`/`height`/`top`/`left`/`margin`/`padding`**，这些会触发布局（layout）+ 重绘（paint）。
3. **错峰要短、要有限**：列表入场按索引错峰 30ms（Phase 1 §4.1），**只对首屏前 ~12 项做**，避免长列表几百个动画同时排队。
4. **状态可见但不喧宾**：完成/失败是一次性 400ms 状态切换，之后归于静态；不做无限循环动画（除"运行中"呼吸，且可降级）。

### 3.3 60fps 优化清单（逐条打勾）

| # | 规则 | 检查点 |
|---|---|---|
| 1 | transform/opacity 优先 | animation/transition 属性里没有 width/height/top/left/margin/padding |
| 2 | `will-change` 只在活动期 | 元素**开始动画前**加 `will-change: transform, opacity`，`transitionend`/`animationend` 后移除；不在全站常驻（常驻会占用 GPU 内存） |
| 3 | 避免布局抖动 | 不在动画中读 `offsetWidth`/`getBoundingClientRect`；读写分离，测量集中在 rAF 之前 |
| 4 | 减少大面积 `backdrop-filter` | 玻璃面用 token 的 blur 但**不叠加多层大面积模糊**；滚动容器上避免全屏 blur；移动端可降级为纯色半透底 |
| 5 | rAF 合并 pointermove | 拖动（L1 径向、层叠、抽屉）中 pointermove 用 `requestAnimationFrame` 合并，一帧一次状态更新，不在事件里直接 setState 多次 |
| 6 | 去重动画 | 同一元素同一属性同时只跑一个 transition；状态切换先取消旧动画再起新的 |
| 7 | 事件监听清理 | `useEffect` 返回 `removeEventListener`；`pointermove`/`resize`/`scroll` 监听成对清理 |
| 8 | 定时器清理 | `setTimeout`/`setInterval` 在 cleanup 里 `clear`；轮询用 react-query 的 `refetchInterval` 条件式（`status==='running'`），停止即不再轮询 |
| 9 | 列表虚拟化/限量 | 长列表错峰动画只作用首屏；大量节点的关系图限制同屏动画节点数 |
| 10 | 合成层克制 | 不滥用 `transform: translateZ(0)` 强制提升图层；只在确有卡顿的元素上用 |

### 3.4 高刷（≥90/120Hz）适配说明

- **不锁帧**：CSS transition / animation 由浏览器按显示器刷新率驱动，天然跟随高刷；JS 动画一律用 `requestAnimationFrame`，**不用 `setInterval` 做动画**（在时间轴上用「经过时间」计算进度，而不是「帧数」，这样 60Hz 与 120Hz 观感一致）。
- **时长是时间不是帧数**：所有 token 是毫秒（如 `--rc-dur-base:200ms`），在 120Hz 上自然更顺滑，不需要改数值。
- **避免逐帧 DOM 写入**：rAF 回调里只做一次样式/状态写入；用 ref 直接改 `transform` 时优先于 React setState（拖动等高频场景）。
- **验证方式**：在 120Hz 屏上检查 §2.1 层叠、§2.6 波形追加、§2.7 透视切换是否无抖动、无丢帧。

### 3.5 `prefers-reduced-motion` 全站降级规则（强制）

> 全局监听 `@media (prefers-reduced-motion: reduce)`；JS 动效用 `matchMedia` 读取同一偏好。降级后**反馈不能丢，只是换成静态/淡入**。

| 类别 | 降级后行为 |
|---|---|
| 时长 | 除 120ms（`--rc-dur-fast`）纯淡入淡出外，**所有位移/缩放/旋转时长归零**（直接到终态） |
| 微交互 | 取消 scale 回弹、发光扫动；保留颜色/描边变化（hover 态仍可辨） |
| 转场 | 页面/弹窗/抽屉改 120ms 淡入淡出，不做 translate/scale/3D |
| 数据动效 | 数据点直接出现、数字直接到值、无呼吸/脉冲；状态变化用**文字 + 状态色**（不只靠颜色） |
| 空间动效 | 层叠错峰、透视滑入、视差全部取消；卡片直接平铺/切换 |
| 反馈替代 | 选中/当前态用 1px `--rc-magenta` 外环 + `aria-current` + 文字变化表达（对齐 `interaction-spec.md` §7.3） |

> 打印样式（`report-accordion.css`）单独处理：纯白底黑字、去阴影、去所有动画。

---

## 4. 响应式与无障碍（全站）

### 4.1 断点（沿用 Phase 1 §1.8 / `interaction-spec.md` §6）

| 断点 | 宽度 | 栅格/页边距 | 主要变化 |
|---|---|---|---|
| 桌面 | ≥1280px | 12 栅格 / 页边距 `--rc-page-pad` 32px | 完整 8 类布局，侧栏抽屉默认隐藏 |
| 窄桌面 | 1024–1279px | 12 栅格 / 页边距 32px | 关系画布/证据栏收窄，KPI 仍 4 列 |
| 平板 | 640–1023px | 6–8 栅格 / 页边距 20px | 多栏压缩为两栏，3D 倾角 ≤6° |
| 手机 | <640px | 单列 / 页边距 16px | 全部单列；层叠→纵向堆叠；3D→平面；表格 `overflow-x:auto` + sticky 表头；主操作固定底部安全区 |
| 极窄 | <280px | 单列 | L1 圆盘降为 2 行卡片列表（已实现）；L2 组件不溢出，允许文字截断 + tooltip |

### 4.2 移动端降级速查

| 桌面交互 | 手机降级 | 触控要点 |
|---|---|---|
| hover 浮起 / tooltip | 轻触即展开详情；说明在页内顶部补一次 | 无 hover，保留 `pointerdown` 80ms 按压反馈 |
| 层叠卡（§2.1） | 纵向堆叠 + 横向滑动切换，取消透视变形 | 热区 ≥48px，指尖可点 |
| 3D 透视对比（§2.7） | 上下排列/单列轮播 | 不做需要精确指针的"翻转" |
| 关系/依赖图（§2.2/§2.5） | 分组列表 + chip 展开 | 节点 ≥48px，不用 hover 高亮（改用 tap 后高亮） |
| 径向拖动（L1） | 可用但非必须，阈值 12px + `touch-action:none` | 直接点图标更快，介绍文案进 L2 补一次 |
| 「全部功能」浮层 | 底部抽屉 `max-height:70vh` 可滚动 | `padding-bottom: calc(20px + env(safe-area-inset-bottom))` |

### 4.3 无障碍清单（WCAG AA 对齐）

| 项 | 规则 |
|---|---|
| **键盘可达** | 所有交互（层叠卡、关系节点、证据 chip、时间轴、差异切换）用原生 `<button>`/`<a>`，不写 `div onClick`。Tab 顺序 = 视觉顺序，不用 CSS `order` 打乱。浮层/抽屉打开时焦点进入、Esc 关闭后焦点回到触发元素 |
| **焦点可见** | `:focus-visible { outline: 2px solid var(--rc-focus); outline-offset: 2px }`（浅色皮肤用 `--rc-purple` 保证 3:1）。任何状态都不移除焦点环 |
| **ARIA** | 浮层/抽屉 `role="dialog"` + `aria-label`；选中 `aria-current`/`aria-pressed`；展开 `aria-expanded`/`aria-controls`；实时状态 `aria-live="polite"`；日志 `role="log"`；树 `role="tree"`；图标按钮 `aria-label`；装饰图形 `aria-hidden` |
| **焦点顺序** | 顶栏（返回→目录→全部功能→用户）→ 页内主内容（按视觉从上到下、从左到右）→ 浮层（打开时插入焦点序列，关闭时归还） |
| **对比度** | 正文 `--rc-glass`/`--rc-text`（深底 >12:1）；次要 `--rc-text-muted`（≈8:1）；元信息 `--rc-text-subtle`（≈4.8:1，最小可用）；主紫按钮上用 `--rc-hi`（白字达 AA）；浅色皮肤功能色用深版（Phase 1 §1.4） |
| **不靠单一信号** | 状态同时有**文字 + 颜色 + 图标/形状**；差异同时有**数值文字 + 条长**；选中同时有**外环 + 文字 + `aria-current`**；色弱用户可辨 |
| **字号/热区** | 说明文字 ≥12px、正文 ≥14px（不用 <10px）；触控热区 ≥44×44（手机 ≥48×48），相邻不重叠 |
| **reduced-motion** | 全站按 §3.5 降级，反馈不丢失 |

---

## 5. 全站 41 页改造验收表模板

> **填写说明**：Phase 3 每完成一页，逐列填写并贴截图链接。"是否"列填 ✅/❌/N/A。图标/布局/动画/交互/响应式为**必改项**，未通过不得验收。
> **页数口径**：`App.tsx` 实际有 **37 条 AppLayout 业务路由 + L1 工作台 + 登录页 = 39 条真实页面路由**；下表另列 `DashboardPage`（历史未挂载页）与通配符兜底路由凑足 **41 个页面条目**——这是项目真值，不虚构第 41 个业务页。Bloom 舞台 8 行单列（对应 `bloom/` 下 8 个舞台文件）。

### 5.1 页面改造验收表（41 行）

| # | 页面名称 | 路由 | 原有设计问题 | 新设计方案 | 图标是否更换 | 布局是否重新对齐 | 动画是否优化 | 交互是否实现 | 响应式是否通过 | 截图验收 | 回归测试 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | L1 中央工作台 | `/` | 旧入口待按 Phase 1 换图标/去粉音符 | 圆盘 9 入口 + 径向拖动（继承 L1 规范） | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 2 | 登录页 | `/login` | 待评估 | 紫黑玻璃登录卡，沿用 token | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 3 | 项目列表 | `/projects` | 旧矩形卡、绿色系 | 图 2 层叠 + §2.2 关联关系展开 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 4 | 新建项目 | `/projects/new` | 旧表单样式 | 图 2 基础态表单 + 草稿防抖 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 5 | Bloom 项目工作台 | `/projects/:projectId/workbench` | 墨绿光、粉色残留 | Bloom 作用域覆盖（Phase 1 §1.11），无侧栏 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 6 | AI 模型服务 | `/settings/llm` | 旧表单、密钥字段 | 图 2 基础态；密钥不落草稿 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 7 | 模型管理中心 | `/settings/models` | 旧卡 | 动态透视卡片（多模型切换） | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 8 | 审计演示 | `/demo/audit` | 旧卡 | 动态透视卡片（多方案切换） | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 9 | 材料管理 | `/projects/:projectId/materials` | 旧矩形卡 | 图 2 层叠 + §2.1 层叠浏览/展开 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 10 | 材料详情 | `/materials/:materialId` | 旧详情样式 | 图 2 层叠基础 + 证据/事实关联 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 11 | 解析任务 | `/projects/:projectId/tasks` | 旧列表 | 图 4 精密线框 + 任务状态 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 12 | 科研事实 | `/projects/:projectId/facts` | 旧卡/表 | 图 4 精密 + 事实类型筛选 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 13 | 证据图谱 | `/projects/:projectId/evidence-graph` | 旧图 | 图 3 扇形 + 节点收拢展开 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 14 | 解析概览 | `/projects/:projectId/overview` | 旧面板 | 图 4 精密 + 概览卡 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 15 | 项目验证 | `/projects/:projectId/verification` | 旧卡 | 图 4 精密 + 验证状态 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 16 | 交接包 | `/projects/:projectId/handoff` | 旧卡 | 图 2 层叠基础 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 17 | 实验差异分析 | `/projects/:projectId/experiments/diff` | 旧卡 | 图 4 精密 + 差异监控（自定义偏差波形图标） | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 18 | 项目变化监控 | `/projects/:projectId/change-monitor` | 旧卡 | 图 4 精密 + 变化列表 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 19 | 数据质量审计 | `/projects/:projectId/data-audit` | 旧表 | 图 4 精密 + §2.3 结构透视条 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 20 | 统计审计 | `/stats-audit` | 旧卡 | 图 4 精密 + 统计表 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 21 | 复现总览 | `/projects/:pid/reproduction` | 旧卡 | 动态透视卡片（多规划/运行） | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 22 | 复现规划 DAG | `/reproductions/plans/:planId` | 旧图 | 图 3/4 + §2.4 版本时间轴 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 23 | 复现环境 | `/projects/:pid/reproduction/environment` | 旧表 | 图 4 精密 + §2.5 依赖聚焦图 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 24 | 执行控制台 | `/reproductions/runs/:runId` | 旧日志/无波形 | 图 4 精密 + §2.6 实时波形/进度/日志 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 25 | 结果对照 | `/projects/:pid/reproduction/comparison` | 旧表 | 动态透视 + §2.7 双结果对比 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 26 | AI 诊断 | `/projects/:pid/reproduction/diagnostics` | 旧卡 | 图 4 精密 + 诊断/修复审核 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 27 | 报告中心 | `/projects/:pid/reproduction/reports` | 旧 accordion 硬编码深色 | 图 2 浅色档案室 + §2.8 章节空间导航 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 28 | 组织与成员 | `/orgs` | 旧表 | 图 2 基础态 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 29 | 角色权限 | `/roles` | 旧表 | 图 2 基础态 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 30 | 项目团队 | `/projects/:projectId/team` | 旧表 | 图 2 基础态 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 31 | 基准案例库 | `/benchmark` | 旧卡 | 图 2 层叠基础 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 32 | 案例详情 | `/benchmark/:caseId` | 旧详情 | 图 2 层叠基础 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 33 | 事实字段目录 | `/fact-schema` | 旧表/图 | 图 3 扇形 + 字段关系 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 34 | 审计规则 | `/rules` | 旧表 | 图 2 基础态 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 35 | 反馈治理 | `/feedback` | 旧表 | 图 2 基础态 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 36 | 知识检索 | `/knowledge` | 旧图/列表 | 图 3 扇形 + 知识网络 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 37 | 外部集成 | `/integrations` | 旧卡 | 图 2 基础态 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 38 | API 令牌 | `/api-tokens` | 旧表/密钥展示 | 图 2 基础态；密钥不落草稿 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 39 | 数据治理 | `/governance` | 旧表 | 图 2 基础态 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 40 | 历史遗留页（未挂载） | `DashboardPage.tsx`（`App.tsx` 未引用） | 旧仪表盘、未接入路由 | 仅 token 化，不新增路由/入口 | N/A | 待填 | 待填 | N/A | 待填 | 待填 | 待填 |
| 41 | 路由兜底 | `*` → `Navigate to="/"` | 逻辑正常 | 保持重定向到 L1，无需视觉改造 | N/A | N/A | N/A | 待填 | N/A | 待填 | 待填 |

### 5.2 Bloom 舞台验收表（8 行，对应 `bloom/` 8 个舞台文件）

| # | 舞台文件 | 作用 | 主要改造（Phase 1 §1.11 作用域覆盖） | 图标 | 动画优化 | 交互/60fps | 响应式 | 截图 | 回归 |
|---|---|---|---|---|---|---|---|---|---|
| B1 | `BloomStage.tsx` | 绽放舞台容器 | Shell 变量收敛到 rc；径向展开动效降级 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| B2 | `BloomCard.tsx` | 瓣卡 | 玻璃五要素 + token；hover 抬起 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| B3 | `BloomAtelier.tsx` | 工作台/组合面板 | 墨绿光晕 → `--rc-glow-violet` | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| B4 | `BloomWorkbench.tsx` | 状态机/焦点同步 | 状态同步 `?focus=` 保持不变；token 化 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| B5 | `EvidenceLoom.tsx` | 证据织机（6 阶段） | 阶段/连线色 → rc 功能色；节点动效降级 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| B6 | `ProjectConstellation.tsx` | 项目星图 | 节点/连线 token 化；无自动旋转 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| B7 | `unitDetails.tsx` | 单元详情内容 | 硬编码深色字面量替换；正文对比度 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| B8 | `unitDetailParts.tsx` | 详情子组件 | 同上；状态色语义化 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |

> workbench 5 文件（`WorkbenchPage.tsx` / `RadialWorkbench.tsx` / `EntryLauncher.tsx` / `EntryLauncher` 依赖的 `AllFeaturesPopover.tsx` / `FoldFieldCanvas.tsx`，另 `useRadialInteraction.ts` 为 hook）的图标/动效按 `interaction-spec.md` + Phase 1 §3 验收，已在第 1 行"L1 中央工作台"统一覆盖。

---

## 6. 性能与业务保护

### 6.1 三条落地铁律

1. **不删业务**：37 条业务路由、Bloom 舞台、全部按钮/菜单/功能一个不少。侧栏从"常驻"改"抽屉"是**位置变化，不是删除**——所有链接在「目录」抽屉与「全部功能」浮层里都可达。不合并、不隐藏、不新增假入口。
2. **不造假数据**：所有图表、波形、进度、条长、版本号、状态**绑定真实接口字段**（§2 逐类列明）。数据缺失显示空态，不画装饰；状态由后端 `status`/`verdict` 驱动（控制台现有注释已明确"状态由后端返回，不是伪造的成功结果"，保持这一原则）。
3. **动画不掩盖加载失败**：`LoadingState` 骨架**必须有退出条件**——数据到达切内容、失败切 `ErrorState`（带 `onRetry`）、超时给提示；禁止无限旋转/骨架常驻来"假装加载"。轮询仅在 `status==='running'` 时开启，结束即停，避免无意义请求。

### 6.2 高风险交互与降级方案（汇总）

| 风险 | 场景 | 后果 | 降级 / 防护 |
|---|---|---|---|
| 假数据波形/进度 | 执行控制台无 metrics | 误导用户认为复现成功 | 无数据 → `EmptyState`「暂无运行数据」；状态取后端 `run.status` |
| 3D/层叠在触屏变形 | 手机窄屏层叠卡 | 文字变形难读、误点 | <640 纵向堆叠 + 横向滑动、倾角 ≤6°、热区 ≥48px |
| 侧栏取消后"找不到功能" | 用户习惯旧侧栏 | 迷路 | 「目录」抽屉 +「全部功能」浮层双入口；链接全量保留；首次可给一次性引导 |
| 未保存数据丢失 | 表单填一半返回 L1 | 返工 | 300ms 防抖草稿 `sessionStorage`（密钥字段除外）+ 离开确认；Esc = 安全默认 |
| 动效引起眩晕 | 前庭敏感用户 | 不适 | 全站 `prefers-reduced-motion` 降级（§3.5），反馈不丢失 |
| 动画掩盖失败 | 骨架常驻/无限 loading | 用户以为卡在加载 | 骨架必须有成功/失败/超时出口；失败切 ErrorState + 重试 |
| 大面积 backdrop-filter 卡顿 | 全屏模糊 + 滚动 | 掉帧 | 减少叠加；移动端可降级纯色半透底；`will-change` 只在活动期 |
| 高频 pointermove 掉帧 | L1 径向拖动、层叠 hover | 卡顿 | rAF 合并，一帧一次更新；监听/定时器成对清理 |
| 语言串味 | 把图 3 扇形塞进数据审计 | 视觉混乱 | 按 §1.2/§5 固定映射，一个 L2 空间不换语言，L1 永远图 1 |
| 无障碍漏项 | 浮层焦点未归还 | 键盘用户迷路 | 浮层/抽屉焦点进入 + Esc 归还；所有交互用原生 button/a |

### 6.3 Phase 3 前端工程师检查清单（逐条打勾）

**结构 / 业务**
- [ ] 37 条业务路由 + 登录 + L1 一个不少；未新增路由、未新增"代码中心"假入口
- [ ] 侧栏改为默认隐藏的「目录」抽屉；原侧栏全部链接在抽屉 +「全部功能」浮层中可达
- [ ] 内容区移除 `lg:pl-[248px]`，改全宽居中（`--rc-content-max`）
- [ ] Bloom 舞台保持无侧栏/无全局顶栏；`?focus=` 状态机不变

**Token / 视觉**（对齐 Phase 1）
- [ ] 无颜色字面量；`--rc-*` 唯一色源；兼容别名层已加
- [ ] 4 个 App 方块图标同族；粉色音符已删、偏差波形已上；图标仅 1.5/1.75/2 三档线宽

**交互（本文 §2）**
- [ ] 8 类页面各实现至少一种特色交互，且数据绑定真实字段
- [ ] 四类状态齐备：Loading（骨架）/ Error（重试）/ Empty（空态）/ 正常内容
- [ ] 状态文字来自后端字段，无硬编码"成功"

**动画（本文 §3）**
- [ ] 时长/缓动只取 token；动画属性只含 transform/opacity/color/box-shadow/background-position
- [ ] `will-change` 活动期添加、结束移除；pointermove 用 rAF 合并
- [ ] 事件监听/定时器成对清理；轮询按 `status==='running'` 条件开启
- [ ] 大面积 blur 克制；移动端可降级

**响应式 / 无障碍（本文 §4）**
- [ ] 5 档断点逐页验证；<640 单列、表格可横滑、主操作在安全区
- [ ] 所有交互原生 button/a、Tab 顺序正确、`:focus-visible` 2px 焦点环
- [ ] 状态/差异/选中均为多信号（文字+颜色+形状）；`aria-live`/`role="dialog"`/`aria-current` 到位
- [ ] `prefers-reduced-motion` 下无位移/缩放/旋转，反馈仍在

**验收（本文 §5）**
- [ ] 41 页 + 8 舞台验收表逐行填写，截图与回归测试列完整
- [ ] 高频 6 组件（StatusBadge/ErrorState/LoadingState/EmptyState/PageHeader/DataTable）按 Phase 1 §5.3 token 化

---

> 文档结束。颜色/间距/字号/动效数值回看 `Plan/global-design-system.md`；L1 圆盘交互回看 `Plan/interaction-spec.md`。本文只做交互与信息架构规范，不覆盖任何现有 token 数值。
