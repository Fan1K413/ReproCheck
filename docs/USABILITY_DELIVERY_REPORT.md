# ReproCheck 产品级易用性革命 · 交付索引

日期：2026-11-24  
范围：`C:\Users\ASUS\Desktop\科研复现审计官`  
状态：**代码改造完成，技术验收通过；外部真实用户测试尚未执行。**

这次没有停在设计方案。新手引导、四步复现、五步 API 向导、术语解释、页面帮助、中文手册、基于真实数据的下一步提示，都已经接进现有 React 页面和真实后端接口。原有专业功能、路由和权限保留。

## 1. 一句话结论

普通用户第一次进入时，不再先面对九个无名称图标，而是先回答“我想做什么”；随后进入四步复现、项目、报告或一分钟教学。页面会解释术语、提供当前页帮助，并根据项目里真实的材料、任务、事实、运行和报告给出下一步。

技术层面已经证明：**页面可打开、按钮接真实接口、错误不被伪装成成功、窄屏不爆框**。  
尚不能证明：**没有使用过 ReproCheck 的普通人第一次就能独立完成**。这需要 3–5 名外部真实用户按测试脚本走查。

## 2. 八项要求的落点

| 任务要求 | 实际落点 | 当前证据 |
|---|---|---|
| 新用户引导：软件能做什么 → 用户想做什么 → 逐步引导 | 首次进入的三阶段介绍；五个目标；一分钟教学；跳过与重开 | `.screenshots/usability/round2/01-onboarding-welcome-1440.png`、`02-onboarding-goals-1440.png`、`usability-goals-verify.json` |
| 论文 / 数据 / 代码 / 实验的引导流程 | `/start/reproduce` 四步：选项目 → 论文/数据/代码 → 真实就绪核对 → 进入复现 | `05-guided-project-picker-1440.png`、`07-guided-ready-step4-1440.png` |
| API 配置默认简单模式 | `/settings/models?tab=setup` 默认五步向导；原来的 7 个技术 section 保留在“高级管理模式” | `14-api-final-no-key-real-failure-1440.png` |
| 按项目真实支持的服务商动态生成选项 | 前端读取 `/model-providers`，不写死厂商列表 | `usability-verify-round2.json` 中 `GET /model-providers` 200 |
| 测试连接必须真实调用 | 新增 `POST /model-credentials/test-draft`；真实请求服务商并返回真实错误 | 同一份 JSON：`POST /test-draft` 200，`auth_failed` / `LLM_INVALID_KEY` / 157ms |
| 密钥不明文、不日志、不完整回显 | 草稿测试只存在请求内存；保存走服务端加密；列表只返回 `key_hint` | `backend/app/api/v1/modelhub.py`、`backend/app/modelhub/gateway.py` |
| 全站中文术语与页面帮助 | 24 条术语字典、11 章手册、所有主要路由的 7 段式帮助抽屉 | `13-help-drawer-390.png`、`12-manual-1440-current.png` |
| 每页基于真实数据的下一步 | `NextStepCard` 读取材料、任务、事实、规划、环境、运行、报告真实接口 | `route-regression` 中 9 个真实项目路由均出现对应建议，`unexpectedResponses=[]` |

## 3. 交付文档

| 文档 | 内容 |
|---|---|
| `docs/WORKBUDDY_UX_RESEARCH.md` | WorkBuddy 公开资料调研、五条可迁移原则、不能照搬的边界 |
| `docs/USABILITY_ISSUE_INVENTORY.md` | 改造前全站页面、路由、术语、帮助与下一步问题清单 |
| `docs/USABILITY_NEW_USER_FLOW.md` | 新用户从首次进入到材料、复现、报告、API 的完整路径 |
| `docs/USABILITY_API_SETUP_REDESIGN.md` | API 页面重构方案、真实测试链、密钥处理与失败态 |
| `docs/USABILITY_GLOSSARY.md` | 24 条术语的旧词 → 页面用词 → 通俗解释 |
| `docs/USER_MANUAL.md` | 完整中文用户手册源文档 |
| `docs/USABILITY_ONBOARDING.md` | 新手引导状态机、五个目标、跳过/重开行为 |
| `docs/USABILITY_REAL_USER_TEST_REPORT.md` | 技术验收结果 + 尚未执行的外部用户测试脚本与记录表 |
| `docs/USABILITY_CHANGED_FILES.md` | 本轮新增、修改文件与接口清单 |
| `docs/USABILITY_OPEN_ISSUES.md` | P0–P3 未解决问题、风险和需要用户拍板的产品选择 |
| `docs/USABILITY_DELIVERY_REPORT.md` | 本文件，交付索引与最终状态 |

## 4. 代码与验收证据

**前端构建**

- `npx tsc --noEmit -p tsconfig.json`：通过。
- `npm run build`：通过。
- 构建日志：`.screenshots/usability/round2/build-final.log`。

**真实浏览器**

- 23 组场景：`.screenshots/usability/round2/usability-verify-round2.json`
  - `errors=[]`
  - `unexpectedResponses=[]`
  - 24 个去重真实 API 调用，全部 200（其中无效密钥测试是真实的业务失败响应，不是网络 500）
- 五目标验证：`.screenshots/usability/round2/usability-goals-verify.json`
- 最终生产式复验：`.screenshots/usability/round2/usability-verify-final.json`
- 录屏：`.screenshots/usability/round2/usability-final-demo-1440.webm`
- 分辨率：390 / 768 / 1440 / 1920；所有被测页面 `documentOverflow=0`、`bodyOverflow=0`。

**页面截图**

- 首次引导、目标选择、工作台、花瓣入口；
- 四步复现（项目选择、代码登记、准备完成）；
- 代码仓库材料；
- API 五步与真实失败；
- 中文手册；
- 390 帮助抽屉。

全部位于 `.screenshots/usability/round2/`，命名按 `01`–`17` 与分辨率后缀排列。手册章节眉标改为中文后，已在 1440 真实浏览器复验：11 个眉标全部为中文、`documentOverflow=0`、`errors=[]`，截图见 `12-manual-1440-current.png`。

## 5. 不能写成“已完成”的部分

1. **外部真实用户测试：0 人。** 当前只有开发者自动化、真实接口和真实浏览器验收；没有完成率、耗时、用户原话或满意度数据。
2. **真实 API 成功保存路径未验证。** 没有有效服务商密钥；只验证了真实失败路径。另有部署环境缺少 `MODEL_CREDENTIAL_KEY`，保存会被明确拒绝，而不是伪造成功。
3. **项目工作台（Bloom 沉浸视图）没有全局下一步条。** 为避免遮住画布，保留其自身导航；这是已记录的覆盖缺口。
4. **代码仓库只有 URL，没有 branch / commit 锁定。** 对版本可追溯性仍不足，改动会涉及数据模型，未擅自扩展。
5. **390 宽屏工作台顶栏三个入口只有图标。** 有 `aria-label`，但第一次使用时识别成本仍高于桌面端。
6. **“首次引导 + 保留径向工作台”的混合首页仍待产品确认。** 没有为了模仿 WorkBuddy 删除已有的九个专业入口。

以上没有一条被包装成“已解决”。详见 `docs/USABILITY_OPEN_ISSUES.md`。

## 6. 本地运行与复验

```powershell
# 后端
cd C:\Users\ASUS\Desktop\科研复现审计官\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 前端（另开终端）
cd C:\Users\ASUS\Desktop\科研复现审计官\frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

- 打开 `http://127.0.0.1:5173/`，首次会进入任务式引导。
- `/manual` 是中文手册；`/settings/models?tab=setup` 是五步 API 向导。
- 重新看引导：清除浏览器 `rc:onboarding:v1`，或在工作台点“我想做什么”。

## 7. 最后一处本轮修正

`frontend/src/pages/UserManualPage.tsx` 的 11 个章节英文 kicker 已全部改为中文，并修正“对照、验证与报告”标题的引号。手册现在不再出现 `Quickstart / Guided reproduction / API setup` 等英文眉标；1440 浏览器复验 11 个章节眉标均为中文，页面无横向溢出、无页面错误。

**最终口径**：可以验收“产品级易用性改造的实际实现与技术验收”；不能验收“真实用户可用性已通过”。后者需要按 `docs/USABILITY_REAL_USER_TEST_REPORT.md` 第 4 节执行。
