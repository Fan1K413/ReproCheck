# Bloom UI｜运行与验收手册

面向交付验收：启动 ReproCheck，进入三级 Bloom 工作台，复现桌面/平板/手机交互，并确认真实数据边界。

- 设计规范：[`BLOOM_UI_DESIGN.md`](./BLOOM_UI_DESIGN.md)
- 实现入口：`frontend/src/bloom/`；项目工作台 `/projects/:projectId/workbench`
- 不新增动画依赖，不改变既有路由、接口、权限与数据

## 1. 环境

- Windows 11（当前验证环境）或 Python 3.10+ / Node.js 18+。
- 后端依赖在 `backend/.venv`；前端依赖在 `frontend/node_modules`。
- Chrome / Edge，需要支持 `clip-path: polygon()`、CSS transition 与 `ResizeObserver`。
- 不需要 GPU；真实代码执行默认关闭（`execution_backend=none`）。

## 2. 启动

后端：

```powershell
cd C:\Users\ASUS\Desktop\科研复现审计官\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

健康检查：`Invoke-RestMethod http://127.0.0.1:8000/api/v1/health`，应返回 `version=1.0.0-stage1`。

前端：

```powershell
cd C:\Users\ASUS\Desktop\科研复现审计官\frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

- 前端 `http://127.0.0.1:5173/`；Vite 将 `/api` 代理到 `http://localhost:8000`。
- 生产构建：`npm run build`；静态产物在 `frontend/dist/`。

演示账号：

```text
邮箱：lead@reprocheck.demo
密码：ReproCheck#2026
```

登录后 token 在 `localStorage` 的 `rc_token`。

## 3. 三个入口

一级绽放台：

```text
http://127.0.0.1:5173/projects/proj-209c77cd39f94212/workbench
```

二级单卡深链：

```text
http://127.0.0.1:5173/projects/proj-209c77cd39f94212/workbench?focus=materials
```

三级复现工坊：

```text
http://127.0.0.1:5173/projects/proj-209c77cd39f94212/workbench?view=atelier
```

工坊装配与选中：

```text
...?view=atelier&modules=materials,dataset,environment,runs,verification&focus=environment
```

`modules` 支持 2–6 个单元，URLSearchParams 会把逗号编码为 `%2C`，属正常现象。

## 4. 验收步骤

### 4.1 一级：绽放台（1440×900）

1. 打开工作台，确认 10 张卡、中心核、顶栏、底栏、工坊入口均可见。
2. 卡片应有三种材质与轮廓：纸页（materials/facts/report）、格架（evidence/plan/team）、仪器（dataset/environment/runs/verification）。
3. 检查标题、指标、状态点完整，没有被瓣形裁切。
4. 拖动空白区域，轨道整体轻微旋转；`Esc` 清除 focus 并回到全景。

### 4.2 二级：形变面板

1. 点击「论文与材料」，确认面板为 folio：宋体标题、装订线、1120×650、760ms。
2. 点击「实验环境」，确认面板为 instrument：仪表条、等宽读数、1180×610、620ms；标题、4 个指标、环境声明、依赖清单完整。
3. 点击「复现规划」，确认面板为 lattice：网格底、DAG、任务列表、1060×660、700ms。
4. 正文超出时右下出现 `↓` 滚动提示；滚到底部提示消失；细滚动条可见。
5. 非活动卡被 dim 到 0.16，不与面板争夺视线。
6. `Esc`、右上「收拢」均可关闭，URL 的 `focus` 参数同步清除。

### 4.3 三级：复现工坊（1440×900）

1. 打开 `?view=atelier`，确认左侧模块库、中央 PROJECT HUB、5 个真实节点、配对曲线、右侧详情、底部 readiness 同时出现。
2. 默认 5 模块：材料、数据集、环境、运行、验证；readiness 显示 `2/5`。
3. 点击左侧「科研事实」的 `+`，模块变 6 个；readiness 变 `3/6`；URL 的 `modules` 同步更新。
4. 点击节点，右侧详情更新；节点与左侧活动态同步。
5. 移除模块只改前端装配，不删除任何后端对象；不足 2 个时 `−` 禁用。
6. 底部读数显示真实缺口：环境缺失 2 项、失败运行 1 次、事实证据 12/12；刷新只重新取数。

### 4.4 平板与手机

1024×768：

- 右侧详情变为覆盖抽屉，关闭按钮可见；关闭后图完整，左库、节点、底部读数可用。

390×844：

- 一级为 10 条纵向 chamfer 卡列表，标题/指标/状态完整，页面可滚动。
- 二级为全屏面板，顶部四工具与底部两行操作可用；滚动提示/底栏不被裁切。
- 三级页面高度等于视口 844px；模块 chips 换行、模块堆叠、缺口清单、readiness 依次排布。
- 点击任意模块，全屏抽屉覆盖顶栏，标题、指标、正文、底栏完整；右上关闭与底部「移出工坊」「在绽放台展开」可用。

## 5. 真实数据口径

演示项目 `proj-209c77cd39f94212`：

- 2 份材料，均 `parsed`；12 条事实（12 条有证据）；36 条证据关系；1 份规划（5 任务，4 可行 / 1 待人工）；1 个环境（Python 3.8.10 / torch 1.8.0，缺 `random_seed`、`data_augmentation_pipeline_version`）；2 次运行（1 成功 / 1 CUDA OOM）；4 条指标对照；1 份 final 报告；4 位成员。
- 覆盖分 `0.545`；readiness 默认 `2/5`，加入事实后 `3/6`。
- `parse_status` 后端返回 `parsed`，前端已兼容；`EnvironmentView.dependencies` 实际为 `string[]`；`ReproRunView.security_check` 形状与类型存在偏差；`plan.dag.edges` 的 from 是 task id、to 是 task_key。这些偏差不在 UI 层伪造。

## 6. 构建与回归

```powershell
cd frontend
npm run typecheck
npm run build
```

最近一次通过：`tsc --noEmit` 0 error；Vite 1720 modules；CSS 109.52kB；JS 864.26kB。构建警告只有 chunk > 500kB，未做代码分割；当前为单页工作台，暂不引入路由级拆包。

## 7. 已知边界

- 旧版两卡 `⊕` 组合仍保留为“快速对照”，与三级工坊并存；工坊是主路径，组合是辅助路径。
- 工坊装配只保存在 URL，不写用户偏好；刷新恢复依赖完整链接。
- 工坊模块上限 6，下限 2；上限由“同一屏可读”决定，不是业务限制。
- 移动端工坊不使用力导向图，改为堆叠 + 缺口清单；这是信息密度取舍，不是功能缺失。
- 旧 `docs/bloom/*.png` 与 `ReproCheck-Bloom-UI.zip` 属于早期版本，已不再作为验收依据。
