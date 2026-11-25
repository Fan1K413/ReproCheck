# WorkBuddy 任务优先体验调研与可迁移结论

日期：2026-11-24  
调研对象：腾讯 WorkBuddy（桌面 AI Agent 工作台）  
调研目的：为 ReproCheck 的“产品级易用性革命”确定可验证的体验原则，而不是复制视觉外观。  
调研边界：本次为公开文档与产品页研究，没有登录 WorkBuddy 做真实任务执行，因此不声称“实测其内部流程”。ReproCheck 的改造与验收均在本地真实项目、真实接口上完成。

## 1. 事实基线

| 事实 | 来源 | 对 ReproCheck 的启发 |
|---|---|---|
| WorkBuddy 把自然语言任务作为第一入口：用户描述需求，由产品自主规划与执行，不需要预先拆成复杂步骤 | [WorkBuddy 简介](https://www.workbuddy.cn/docs/workbuddy/) | 首屏应先问“你要做什么”，不能先摆功能矩阵 |
| 主界面分为侧边栏任务列表、对话区、右侧结果区；任务按文件夹分组，结果与产物单独呈现 | [WorkBuddy 简介](https://www.workbuddy.cn/docs/workbuddy/) | 首页需要一个主任务入口；复杂功能应退到第二层 |
| 新建任务页有欢迎语、工作模式切换、技能快捷入口、输入框；输入框支持 `@` 引用文件、`/` 调用技能，并可设置工作空间与权限 | [WorkBuddy 快速开始](https://www.workbuddy.ai/docs/zh/workbuddy/Quickstart) | 把“可做什么、需要准备什么、结果在哪里”放在同一个任务上下文里 |
| 产品提供多种工作模式，让 Agent 先规划或直接执行；执行结果可验收 | [WorkBuddy llms.txt](https://www.workbuddy.cn/llms.txt) | ReproCheck 可以借鉴“先确认目标，再进入步骤”，但不能把科研判断交给黑箱 |
| WorkBuddy 强调本地文件授权、结果可交付、多任务并行 | [WorkBuddy 简介](https://www.workbuddy.cn/docs/workbuddy/) / [腾讯云产品页](https://cloud.tencent.com/product/workbuddy) | 保留“真实执行/真实结果”的表达，不用演示数据冒充完成 |
| WorkBuddy 面向日常办公、代码开发、设计创意等不同场景提供任务模板与专家能力 | [腾讯云 WorkBuddy](https://cloud.tencent.com/product/workbuddy) | 新手入口应该按“目标”分岔，而不是按“模块”分岔 |

## 2. 可迁移的五条体验原则

1. **任务优先于功能清单。** 首次进入先问目标，再根据目标进入材料、复现、报告或 AI 配置；九个专业入口仍然保留，但不作为新用户的第一屏。
2. **一个页面只回答一个问题。** WorkBuddy 的“新建任务”只要求用户描述目标；ReproCheck 的 API 向导拆成服务商、密钥、模型、测试、保存五步，避免一次面对协议、端点、能力矩阵。
3. **复杂配置渐进披露。** 默认路径只显示必填项；服务地址、超时、温度、最大输出放到“高级设置”，但不删除原有能力。
4. **结果与下一步始终可见。** 借鉴右侧结果区的“产物/文件/变更”分层，ReproCheck 在全局页头下插入“根据真实项目数据判断的下一步”，让用户不必自己猜测下一模块。
5. **可信感来自可验证状态。** WorkBuddy 强调真实文件操作与可验收结果；ReproCheck 保留真实 API 测试、真实材料数量、真实报告状态，并在失败时显示普通中文原因与技术详情折叠。

## 3. 不能照搬的部分

- **不能把“自主执行”当作“自动判定论文正确”。** 科研复现需要证据、原文位置、人工复核和限制说明；ReproCheck 的 AI 只能做整理与辅助，不能替代审计结论。
- **不能让代码仓库“自动下载并运行”。** 当前产品只登记仓库地址，不下载、不执行；这比 WorkBuddy 的本地文件操作更保守，但符合科研审计的安全边界。
- **不能用模拟任务填充首页。** WorkBuddy 的任务列表是真实运行记录；ReproCheck 的首次引导和下一步只能读取真实项目、材料、事实、运行和报告数量。
- **不能为了“简洁”删掉专业能力。** API 协议、端点、能力、按任务分配、调用记录仍保留在“高级管理模式”中，供需要的人使用。

## 4. 改造前后的对照

| 体验点 | 改造前（真实基线） | 改造后（本轮实现） | 验证方式 |
|---|---|---|---|
| 首次进入 | 直接看到 9 个图标组成的径向工作台 | 先进入任务式介绍，再选择“我今天想做什么” | 浏览器场景 `onboarding` |
| 返回用户 | 只有图标墙，没有任务入口 | 保留径向工作台，右上角增加“我想做什么/中文手册/帮助” | `workbench-regression` |
| 项目/材料之后 | 页面结束，没有下一步 | 页头下显示基于真实数据的 `NextStepCard` | 项目、材料、任务、事实、报告路由均读取到真实建议 |
| API 配置 | 供应商、协议、端点、能力矩阵同屏；系统 LLM 页只有“测试模型连接” | 默认五步向导；测试失败给普通中文原因；技术细节折叠 | DeepSeek 无效密钥真实请求返回 `auth_failed`，页面不出现保存按钮 |
| 术语 | DAG、解析、证据图谱、provider、model、base URL 混用 | 导航使用任务语言；术语组件悬停解释；手册集中列出 | 24 条术语字典 + 11 章手册 |
| 帮助 | 无页内帮助 | 右滑帮助抽屉（是什么/何时用/准备/步骤/结果/FAQ/出错/术语），ESC 与遮罩可关 | 1440 与 390 宽度真实浏览器验收 |

## 5. 可引用来源

- WorkBuddy 官方简介：<https://www.workbuddy.cn/docs/workbuddy/>
- WorkBuddy 官方快速开始：<https://www.workbuddy.ai/docs/zh/workbuddy/Quickstart>
- WorkBuddy 官方 llms.txt：<https://www.workbuddy.cn/llms.txt>
- 腾讯云 WorkBuddy 产品页：<https://cloud.tencent.com/product/workbuddy>
- 腾讯云国际站 WorkBuddy 场景页：<https://www.tencentcloud.com/act/pro/workbuddy?lang=zh>

> 说明：以上公开资料用于提炼体验原则，不用于证明 ReproCheck 已实现 WorkBuddy 的全部能力。ReproCheck 的实际功能以项目代码、真实接口和本轮验收报告为准。
