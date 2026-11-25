# 交付 11：浏览器实测记录（第十一阶段）

## 环境

- 前端：`npm run dev -- --host 127.0.0.1`（Vite 5173），`/api` 代理到本地 FastAPI 8000。
- 后端：`uvicorn app.main:app --host 127.0.0.1 --port 8000`，并设置 `MODEL_CREDENTIAL_KEY`。
- 浏览器：内置 Chromium（OpenCode Review pane）+ `scripts/verify_ui.mjs` 的 headless Edge。

## 操作步骤与观察

1. 打开 `/login`，用演示账号 `lead@reprocheck.demo` / `ReproCheck#2026` 登录。
   - 网络：`POST /api/v1/auth/login` 200；随后 `/projects`、`/llm/status`、`/auth/me` 均 200。
2. 遍历 10 条路由（见 UI 缺陷清单）：全部 `#root` 有内容，无未捕获错误。
3. `/settings/models`：
   - 「模型供应商」表格渲染 10 行，显示官方端点、能力项数、"未真实联调"标签；无控制台错误。
   - 切换到「API 凭据」→「添加凭据」→ 填入 `sk-browser-test-1234` → 保存。
   - 首次（后端未配 `MODEL_CREDENTIAL_KEY`）：返回 **503**，前端未保存明文；这是期望的 fail-closed。
   - 重启后端并配置独立加密密钥后重试：创建成功，列表显示脱敏 `sk-b…34`，弹窗关闭，password 输入框被清空。
   - 自动连接测试真实调用千问兼容端点，返回 `auth_failed / LLM_INVALID_KEY`（无效 Key），
     "正在测试…"提示被结果替换（缺陷 #1 已修复并复测）。
4. 复现总览：首次遍历发现"规划"链接缺失且后端 500（缺陷 #2）；修复后重跑：
   - `node scripts/verify_ui.mjs` → **STEPS 38/38 ok，consoleErrors 0，pageErrors 0，failedRequests 0**。
   - 该脚本包含 `mobile:viewport` 窄屏巡检（ok）。
5. 两个新功能页面在有/无有效项目上下文下均正常渲染，无 JS 异常。

## 截图与产物

- `frontend/.verify-shots/`：由 verify_ui.mjs 生成的桌面/移动截图。
- `frontend/.verify-report.json`：38 步逐项结果（全部 ok）。
- 浏览器 tab 中可见的模型中心、凭据列表与连接失败结果为本次实测证据。

## 结论与限制

- 本阶段浏览器实测覆盖了登录、主要路由、模型配置全流程、新功能页面、移动视口与既有 38 步交互脚本。
- 未做：真实云端 Site 部署验证、真实厂商 Key 的成功路径、多用户并发浏览器操作、OCR/图表像素级检查。
- 上述未做项均不宣称通过。
