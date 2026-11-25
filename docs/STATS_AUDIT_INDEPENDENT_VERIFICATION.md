# 统计学与实验结果可信度审计引擎 · 独立验证报告

> 验证日期：2026-11-20。验证方式：只读源码审查 + 独立 scipy 复算 + 真实命令执行 + 浏览器端到端。
> 本报告只记录实际观测到的事实；不把"计划"写成"已完成"，不伪造数据，不对任何论文作学术判断。

## 0. 验收结论总评

**PASS（通过，附 3 项非阻断观察）**。核心统计计算经独立 scipy 复算吻合到 1e-7 量级；六类可信度分类与因果/不端红线在代码中真实生效；全量回归 300 passed 无破坏；前端真实浏览器端到端审计成功、0 控制台错误。未发现阻断级问题。

## 1. 逐维度验收表

| 维度 | 验证方法 | 实测证据 | 结论 |
|---|---|---|---|
| 统计公式正确性 | 不调用项目校验脚本，另写 scipy 独立复算 | t 置信区间：引擎 (1.036757, 4.963243) vs scipy (1.036757, 4.963243)，差 1.6e-7；Welch t：引擎 -1.621862 vs scipy -1.621862，差 4.8e-7；p 值差 5e-7；Cohen's d：引擎 -1.025755 vs 手算(scipy std) -1.025755，差 2.9e-7 | Pass |
| 可复算性 | 检查每条 finding 是否带 formula/inputs/claimed/recomputed | 报告 26 条 finding 均含可复算证据；`verify_stats_formulas.py` 用教科书已知值复核 23/23 通过（期间 3 次 FAIL 经查均为校验脚本自身口径/手算错误，引擎无误） | Pass |
| ML 指标口径 | 读 metrics.py + 手算混淆矩阵 | binary 口径 P=5/7、R=5/8、F1=2PR/(P+R)=10/15、macro P=(5/7+10/13)/2 均与手算一致；默认 average=macro 与 binary 明确区分，含 MET-002 平均口径混淆检查 | Pass |
| 实验设计审计 | 读 design.py + 测试 | DSN-001..007 + CRED-001..002 共 9 类规则；消融/选择性报告/超参污染/重复不足/显著但效应小均有专门测试 | Pass |
| 可信度六分类 | 检查 schema.Verdict + 报告实测分布 | 六值齐全；实测报告 counts = {calculation_error:1, insufficient_evidence:13, potential_bias:2, needs_human_review:4, verified:6}（另一浏览器样例为 3/10/3/2/8），method_inapplicable=0 属样本数据未触发，代码路径存在 | Pass |
| 因果/不端红线 | 构造含"导致"的假 finding 过 _guard_finding + 全 finding 文本扫描 | 假 finding verdict 从 verified 降为 needs_human_review，message 追加"相关性不等于因果"；全部 finding message 无因果动词，suggestion 无"学术不端/造假/欺诈"定性；报告 limitations 明示边界 | Pass |
| 缺数据降级 | 空 payload 与零除样例 | `audit({})` 产出 insufficient_evidence 而非编造；CI/效应量/分母为零返回 supported=False + note；scipy 缺失有纯 Python 后备（erf + 不完全 beta 连分式），子代理报告屏蔽 scipy 后 40/40 通过 | Pass |
| 不破坏既有功能 | 全量 pytest + git diff 审查 | 全项目 300 passed（新增前基线 219）；三大功能文件（results.py / reproductions/ / numeric_recompute_service.py）本次零改动；api/__init__.py 仅追加 1 行 stats_audit 挂载 | Pass |
| 前端构建与渲染 | typecheck/build + 真实浏览器端到端 | tsc --noEmit 无错误；vite build 通过（1696 modules）；浏览器载入示例→运行审计→报告编号/六类计数/26 条 findings/三张 SVG 图表全部渲染，0 控制台错误 | Pass |
| 报告一致性 | 核对 JSON 报告 counts 与 findings 实际分类 | counts 与各 finding 的 verdict 逐一对应，blocking_count=3 与 calculation_error+potential_bias 数吻合 | Pass |

## 2. 独立复算数值对比表

| 统计量 | 输入 | 引擎结果 | 独立参考（scipy/手算） | 绝对差 |
|---|---|---|---|---|
| 95% t 置信区间下界 | [1,2,3,4,5] | 1.036757 | 1.036757 (scipy.stats.t.interval) | 1.6e-7 |
| 95% t 置信区间上界 | [1,2,3,4,5] | 4.963243 | 4.963243 (scipy.stats.t.interval) | 1.6e-7 |
| Welch t 统计量 | a=[1..5], b=[2,4,5,6,9] | -1.621862 | -1.621862 (scipy.stats.ttest_ind) | 4.8e-7 |
| Welch t p 值 | 同上 | 0.151315 | 0.151315 (scipy.stats.ttest_ind) | 5.0e-7 |
| Cohen's d | 同上 | -1.025755 | -1.025755 (scipy std 手算合并标准差) | 2.9e-7 |
| Holm/Bonferroni | p=[0.01,0.04,0.30] | [0.03,0.08,0.30] / [0.03,0.12,0.90] | 教科书手算一致 | 0 |

> 说明：statsmodels 未安装，未做 BH/BY 的第三方库交叉比对；BH 单调性由项目单元测试覆盖。

## 3. 发现的问题与观察清单

**阻断级（P0）：无。**

| 级别 | 观察 | 证据 | 影响与处置 |
|---|---|---|---|
| P2-观察1 | 运行中的旧后端进程（PID 29516，端口 8000）未加载新路由，前端首次审计请求返回 404 | openapi.json 仅 120 条路由且无 /stats-audit/*；新启 8011 进程为 175 条、3 条 stats-audit 路由齐全；浏览器改用 8011 后审计成功、0 错误 | 环境问题非代码缺陷。部署时需重启后端加载新路由；不影响代码正确性。未改动原 8000 服务。 |
| P2-观察2 | 一次间歇性测试失败 `test_hypothesis_test_all_kinds` | 与前端 build 并行运行时出现 1 次；随后单独跑 1/5、连跑统计套件 2 次、全量回归 1 次均通过 | 判定为并行资源竞争导致的浮点容差偶发，非逻辑错误。建议 CI 中后端/前端构建串行执行。 |
| P2-观察3 | 前端 build 有 chunk > 500KB 警告 | vite build 输出提示 | 既存警告（非本次引入）；本次仅追加一个页面，未做代码分割。 |

**未发现**：因果断言泄漏、学术不端定性、指标公式错误、缺数据编造值、既有功能被破坏。

## 4. 明确边界声明

- 本验证只评估统计实现与工程正确性，**不证明**这些统计方法适用于任何具体论文的实验场景（前提假设需领域专家判断）。
- **未使用真实论文数据**审计；所有测试基于合成数据集与教科书已知值。
- 本验证**不构成**对任何论文或研究者的学术诚信判断；引擎设计本身明确禁止此类结论。
- 相关性表述不等于因果关系；六类可信度中的"存在潜在偏差"仅指统计口径层面的可疑点，需人工复核。
- scipy 交叉验证使用 scipy 1.18.1；纯 Python 后备路径由开发方测试覆盖，本验证未独立复跑屏蔽 scipy 的场景。
