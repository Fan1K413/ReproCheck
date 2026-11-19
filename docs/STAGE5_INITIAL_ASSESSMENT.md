# 第五阶段初始盘点与执行边界（2026-11-19）

## 状态声明

本文件记录本轮可核验的仓库现状、已执行验证和尚未开展的工作，不代表已完成全年模拟、五篇论文实战审计、正式服务器部署或独立验收。当前结论：**NOT_READY（局部已验证）**。

## Git 与回滚基线

- 分支：`stage4/reproduction-engine`；HEAD：`1d32f5133346a3d2c6b4de3103ed829f983319de`。
- 最近提交依次包括 `1d32f51`、`90a4830`、`01c878c`。
- 工作区在本轮开始前已有大量未提交和未跟踪文件，包含 Stage6 前后端代码、测试、迁移、Stage7 报告及 `.workbuddy/memory` 内容；本轮不覆盖、不清理、不提交这些内容。
- 未创建新提交或标签。由于已有改动无法可靠归属到当前阶段，不能把 HEAD 描述为覆盖全部当前工作区的回滚快照；建立隔离、可回滚的代码检查点需先由项目负责人明确如何保存现有改动。
- `git diff --check` 退出码 0；Git 提示多个已有文件 LF 将转为 CRLF，未发现空白错误。

## 项目功能状态矩阵

| 能力 | 当前分类 | 本轮证据与限制 |
|---|---|---|
| React/TypeScript/Vite 前端构建 | 已实现（工程构建通过） | `frontend/package.json` 中 `typecheck`、`build` 脚本；本轮类型检查退出码 0，生产构建成功，1670 个模块，约 6.67 秒。未做浏览器真人流程。 |
| 项目/材料/事实/复现工作台页面 | 部分实现 | `frontend/src/App.tsx:21-47` 注册现有工作台路由；页面/API 源码存在，不等于用户旅程端到端通过。 |
| 注册/登录 API 与页面 | 部分实现 | Stage6 auth 路由在 `backend/app/api/__init__.py:51-62` 被挂载，登录页位于 `frontend/src/pages/auth/LoginPage.tsx`，API client 有 `/auth/register`、`/auth/login`（`frontend/src/services/stage6Api.ts`）。但 `frontend/src/App.tsx:21-47` 没有登录/注册页面路由，也没有挂载 `RequireAuth`；用户目前无法从主路由走完整登录流程。 |
| 项目级数据隔离 | 部分实现，生产需阻断复核 | 旧项目相关路由统一挂载 `enforce_project_isolation`（`backend/app/api/__init__.py:34-49`），项目服务为登录用户筛选可见项目（`backend/app/api/v1/projects.py:44-52`）。但 `get_optional_user` 返回匿名时，`projects.py:47-50` 不做过滤，默认 `ALLOW_UNAUTH_TEST_ENDPOINTS=True`（`backend/app/core/config.py:32-35`）；生产环境必须确保关闭该开关并以真实生产配置/HTTP 场景验证。 |
| 组织/协作/规则/反馈/RAG/集成/开放 API | 部分实现 | 后端路由已在 `backend/app/api/__init__.py:51-62` 挂载；测试模块存在。本轮跑通当前测试套件，但未做这些流程的浏览器验收、跨租户攻防或生产部署验证。 |
| 论文/PDF/代码/配置解析 | 部分实现 | README 声明有解析器；测试包括 PDF 页码、空 PDF OCR 标记、ZIP 路径穿越/炸弹拒绝等（`backend/app/tests/test_parsers.py`）。当前未运行五篇论文材料，不代表公式、表格、图片或复杂布局解析已可靠。 |
| 模型调用与科研判断 | 无真实供应商验证 | README 要求用户自备后端 LLM Key；本轮没有真实供应商凭据或实际调用授权。模拟/mock 测试不能作为真实科研判断准确性证据。 |
| 上传代码安全执行 | 默认未实现可运行环境 / 安全关闭 | `backend/app/core/config.py:56-63` 默认 `enable_code_execution=False`、`execution_backend="none"`、网络关闭；不得在宿主机执行不可信仓库代码。 |
| 队列、后台 Worker 与任务恢复 | 无法验证 | 本轮未启动多进程 Worker，也未做服务重启、队列崩溃恢复、并发压力或幂等验证。 |
| 数据库迁移与备份恢复 | 无法验证 | 本轮未执行迁移、备份、恢复或生产兼容性测试。 |
| 部署/HTTPS/监控/回滚 | 尚未实现或无法验证 | 当前未提供正式服务器、域名、证书、数据库/对象存储、生产密钥或发布授权；不能声称已上线。 |

## 本轮实测

1. `npm --prefix ".../frontend" run typecheck`：退出码 0。
2. `npm --prefix ".../frontend" run build`：退出码 0；Vite 5.4.21，转换 1670 modules。
3. `PYTHONPATH=.../backend python -m pytest .../backend/app/tests --collect-only -q`：收集成功，119 项。
4. 同一测试目录全量执行：**119 passed，20.35 秒**；出现 3 条弃用/未来兼容性 warning（FastAPI `on_event`、pytest-asyncio 未指定 event loop scope、fitz API）。pytest 退出清理时另有 Windows 临时目录 `PermissionError`，不改变已报告的 119 项测试结果，但环境清理警告需后续检查。
5. `git diff --check`：退出码 0；仅有换行符提示。

## 365 天模拟方法（方案，尚未执行）

采用可重复的离散虚拟时间推进：在隔离测试数据库和专用临时文件目录中，以事件脚本逐日推进 `simulated_at`，一年按 12 个月分段执行、每月固化输入、操作、数据库状态、日志、错误与用户体验记录。它只能模拟用户事件和数据年龄，不等同于真实运行了一年。

计划规模：至少 20 个隔离模拟项目、100 份经许可或自制的测试文件；覆盖用户注册/退出、项目创建与删除、材料替换、审计重复运行、历史对比、报告导出、失败重试、并行任务、超限文件、服务重启、数据库备份恢复及模型接口中断。每个情景记录预期、实际 HTTP/API 结果、DB/磁盘持久化前后状态和证据位置。

执行前提：测试环境不得连接生产库或生产文件存储；模拟日期使用显式注入时钟，不得篡改机器系统时间；失败时保留可复现事件与日志。由于真实用户流程前端认证路由尚未接通，先需修复/验收该入口，并建立专用测试环境。当前尚未生成 12 个月体验日志，也未创建 20 个项目或 100 份材料。

## 五篇论文筛选与来源核验（已完成书目/代码入口初核；实战未开始）

下列五篇覆盖视觉、医学图像、NLP、机器翻译和蛋白质结构预测。论文页/作者项目已通过出版方或研究机构页面、仓库原始 README 核验；“官方代码”只在明确作者/机构原仓库时使用。许可是代码许可，不自动覆盖数据集/模型权重许可。任何代码均未下载、安装或执行。

| 领域 / 论文 | 发表与论文来源 | 作者代码及性质 | 数据、许可与复现信息 |
|---|---|---|---|
| 视觉分类：Kaiming He, Xiangyu Zhang, Shaoqing Ren, Jian Sun, “Deep Residual Learning for Image Recognition” | CVPR 2016，pp.770–778；DOI `10.1109/CVPR.2016.90`；[CVPR Open Access](https://openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html) | [作者 KaimingHe/deep-residual-networks](https://github.com/KaimingHe/deep-residual-networks)，README 明列作者与 MSRA；含原 Caffe 模型/prototxt。仓库 LICENSE 为 MIT（copyright Shaoqing Ren, 2016）。其说明模型主要用于测试/微调，模型非用仓库当前 Caffe 训练；训练代码见另行链接的 FAIR 第三方实现，不混为作者原代码。 | 论文涵盖 ImageNet、CIFAR-10、COCO；摘要报告 ImageNet ensemble 3.57% error，CIFAR-10 100/1000 层和 COCO。数据入口分别为 [ImageNet](https://image-net.org/)、[CIFAR-10](https://www.cs.toronto.edu/~kriz/cifar.html)、[COCO](https://cocodataset.org/)；数据授权需按各自条款审查。README 未提供可重训同配置完整训练脚本；注明 mini-batch 256/8 GPUs、数据增强和 SGD momentum 差异会影响结果，GPU 内存可能不足。 |
| 医学图像：Olaf Ronneberger, Philipp Fischer, Thomas Brox, “U-Net: Convolutional Networks for Biomedical Image Segmentation” | MICCAI 2015, LNCS 9351, pp.234–241；DOI `10.1007/978-3-319-24574-4_28`；[Springer论文页](https://link.springer.com/chapter/10.1007/978-3-319-24574-4_28) | [作者课题组官方项目页](https://lmb.informatik.uni-freiburg.de/people/ronneber/u-net/)提供原 Caffe 代码、训练网络、MATLAB binaries 与 overlap-tile/tracking 工具；并非现代 GitHub PyTorch 仓库。 | ISBI EM 神经结构分割和 Cell Tracking Challenge 2015；挑战入口 [ISBI EM](http://brainiac2.mit.edu/isbi_challenge/) / [Cell Tracking Challenge](https://celltrackingchallenge.net/)。官方包说明仅在 Ubuntu 14.04 + MATLAB 2014b x64 编译测试，并依赖 CUDA GPU；代码/数据许可页面未见清楚授权声明，运行或再分发前需审阅包内 LICENSE/数据条款。论文摘要报告 512×512 图像在“recent GPU”小于1秒。 |
| NLP：Jacob Devlin, Ming-Wei Chang, Kenton Lee, Kristina Toutanova, “BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding” | NAACL-HLT 2019，pp.4171–4186；DOI `10.18653/v1/N19-1423`；[ACL Anthology](https://aclanthology.org/N19-1423/)（ACL 官方论文页） | [google-research/bert](https://github.com/google-research/bert) 提供 TensorFlow 源码、模型和实验脚本；作者/机构由论文及 README 支撑。但 README 声明“not an official Google product”，故按 Google Research 作者关联仓库处理，不宣称产品级官方背书。代码与模型权重 Apache-2.0。 | GLUE、SQuAD 1.1/2.0、MultiNLI、SWAG；数据按各数据集原站条款。预训练文本示例为 Wikipedia/BookCorpus；README 明确论文预处理语料不发布，BookCorpus 已不可公开下载。TF 1.11；BERT Base 微调示例约需 12GB GPU；论文预训练成本高。论文报告 GLUE 80.5、MultiNLI 86.7%、SQuAD v1.1 F1 93.2、v2.0 F1 83.1（指标口径须按论文表格区分）。 |
| 机器翻译：Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N. Gomez, Łukasz Kaiser, Illia Polosukhin, “Attention Is All You Need” | NeurIPS 2017, *Advances in Neural Information Processing Systems 30*；[NeurIPS官方论文页](https://proceedings.neurips.cc/paper/2017/hash/3f5ee243547dee91fbd053c1c4a845aa-Abstract.html)。本轮未从该页面确认 DOI，故不杜撰 DOI。 | [tensorflow/tensor2tensor](https://github.com/tensorflow/tensor2tensor) README 将该论文列入基于 T2T 的论文并说明其用于 Transformer/WMT walkthrough；仓库由 Google Brain 研究者/工程师与社区开发，但 README 也声明非官方 Google 产品，且已 deprecated。将其作为作者论文所用代码线索/项目，不标成当前维护的作者官方代码。 | WMT 2014 EN-DE/EN-FR；[WMT官方任务归档](https://www.statmt.org/wmt14/translation-task.html)提供数据、开发/测试集和复现规则，需按各语料来源分别核验许可。T2T README 给出 `translate_ende_wmt32k`、`transformer_base`、8 GPU/300K step 约 BLEU 28，单 GPU 需调小配置；训练/解码/BLEU 工具链明示。论文报告单模型 27.5 BLEU EN-DE、41.1 EN-FR，须区分论文版本/设置表述。 |
| 生物信息/蛋白质：John Jumper et al., “Highly accurate protein structure prediction with AlphaFold” | Nature 596, 583–589 (2021)；DOI `10.1038/s41586-021-03819-2`；[Nature论文页](https://www.nature.com/articles/s41586-021-03819-2)，[PubMed PMID 34265844](https://pubmed.ncbi.nlm.nih.gov/34265844/) | [DeepMind AlphaFold 2 仓库](https://github.com/deepmind/alphafold)为论文作者机构源代码入口。代码 Apache-2.0；模型参数 CC BY 4.0（以仓库说明为准，另需审查每个外部数据库许可证）。 | 公共 PDB、BFD、UniRef90、MGnify、PDB70 等；论文说明有特定数据版本。官方 README 表示完整数据下载约556GB、解压约2.62TB；测试配置示例含 12 vCPU、85GB RAM、3TB 数据盘、A100 GPU；Linux + Docker。README 指出要复现 CASP14 需固定历史数据库版本，数据库更新会改变MSA与结果；有限资源下只适合输入/解析级或预计算结构比对，不足以声称完整模型复现。摘要报告 CASP14 对多数目标达到接近实验结构的准确性；具体 0.96Å 与2.8Å 对比值取自图/定量结果说明，并非PubMed摘要文字。 |

来源与字段核验边界：
- 论文原文/出版方页面支撑标题、作者、年份、DOI/会议与摘要结果；作者项目 README 支撑代码路径、环境与运行流程。
- U-Net 原作者代码包可取，但许可证/数据授权需在真正获取包前复核；**目前未下载**。
- AlphaFold 运行需要高成本历史数据库与 GPU；不适合作为未经批准的本机下载/执行任务。
- WMT/T2T、BERT、U-Net 的“公开可访问”不等于所有数据都可自由再发布。执行时需单独记录数据集版本、来源、许可与校验和。
- 当前尚未建立五篇的页码—代码行级人工金标准，未运行 ReproCheck 审计，未计算 Precision、Recall、F1、误报/漏报率或证据定位准确率。故后续文档必须区分“筛选来源核验完成”和“实战审计未开始”。

## 正式上线阻断项

- 前端缺少登录/注册路由挂载与主流程守卫。
- 生产配置必须强制安全默认：关闭未认证测试接口、强制外部模型授权、设置强 JWT/加密密钥、限制 CORS 域名；本轮未实施生产配置更改。
- 当前未证明持久队列、任务恢复、对象存储、增量/断点上传、版本历史、监控告警、备份恢复、升级/回滚可工作。
- 尚无真实模型授权、隔离执行沙箱、正式服务器/域名或发布授权。
- 独立验收未开始；P0/P1 阻断未清零，不得发布。
