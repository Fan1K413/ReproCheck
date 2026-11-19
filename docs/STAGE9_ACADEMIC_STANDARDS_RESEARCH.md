# 第九阶段｜国际科研平台与权威学术规范调研报告

> 调研人：B 组（国际科研平台与权威学术规范调研专家）
> 调研日期：2026-11-19
> 用途：为 ReproCheck 第九阶段产品重构提供**真实、可核查**的规范依据。
> 调研方式：真实联网检索（WebFetch / WebSearch），优先官方页面与正式论文。
> 标注约定：**【事实】**= 来源原文/官方陈述；**【分析】**= 基于事实的推断；**【建议】**= 对 ReproCheck 落地建议。
>
> **重要声明（贯穿全文）**：本报告借鉴 ACM 等机构的**评估框架**用于设计自检规则，绝不等于获得 ACM 或任何机构的**认证/背书**。ReproCheck 只给出"在自身验证范围内"的结论，任何输出都不得暗示官方认可。详见第 6 节。

---

## 0. 调研来源清单与可访问性

| # | 来源 | 版本 / 日期 | URL | 状态 |
|---|---|---|---|---|
| S1 | ACM Artifact Review and Badging | **v1.1，2020-08-24** | https://www.acm.org/publications/policies/artifact-review-and-badging-current | 成功 |
| S2 | GO FAIR / FAIR Vocabulary（本体） | 草案，含 F1–R1.3 全部 15 条 | https://w3id.org/fair/principles/ | 成功 |
| S3 | Wilkinson 等《The FAIR Guiding Principles》 | **Scientific Data 3:160018，2016-03-15**（2019-03-19 有 Addendum） | https://www.nature.com/articles/sdata201618 | 成功 |
| S4 | RO-Crate Metadata Specification | **v1.1，2023-04-26，Recommendation** | https://www.researchobject.org/ro-crate/1.1/ | 成功 |
| S5 | W3C PROV-O | **W3C Recommendation，2013-04-30** | https://www.w3.org/TR/prov-o/ | 成功 |
| S6 | DataCite 官网 | 截至 2026-11-19 已注册 DOI 80,792,635 | https://datacite.org/ | 成功 |
| S7 | CASRAI 官网 | **Dictionary v2026.1**（1,986 条 / 29 域） | https://casrai.org/ | 成功 |
| S8 | NeurIPS 2025 CFP / 2026 Main Track Handbook | 2025 / 2026 | https://neurips.cc/Conferences/2025/CallForPapers · https://neurips.cc/Conferences/2026/MainTrackHandbook | 成功 |
| S9 | NeurIPS Paper Checklist Guidelines | 官方指南 | https://neurips.cc/public/guides/PaperChecklist | 成功 |
| S10 | NeurIPS D&B 数据托管指南 | 2025 | https://neurips.cc/Conferences/2025/DataHostingGuidelines | 成功 |
| S11 | Nature Machine Intelligence 投稿指南 | 官方 | https://nature.com/natmachintell/submission-guidelines/preparing-your-submission | 成功 |
| S12 | Nature Communications Resources | 官方资源页 | https://nature.com/ncomms/submit/resources | 成功 |
| S13 | Nature Mach. Intell. 社论《Research, reuse, repeat》 | 2020 | https://www.nature.com/articles/s42256-020-00277-9 | 成功（经检索摘要） |
| S14 | ICML 2025 Author Instructions / CFP | 2025 | https://icml.cc/Conferences/2025/AuthorInstructions · https://icml.cc/Conferences/2025/CallForPapers | 成功 |
| S15 | CVPR 2025 Suggested Practices | 2025 | https://cvpr.thecvf.com/Conferences/2025/AuthorSuggestedPractices | 成功 |
| S16 | AAAI-25 Submission Instructions / Reproducibility Checklist | 2025 | https://aaai.org/?p=90352 · https://aaai.org/?p=90497 | 成功 |
| S17 | Science Journals Editorial Policies | 官方 | https://www.science.org/content/page/science-journals-editorial-policies | 成功 |
| S18 | NIH Data Management & Sharing Policy | **2023 政策**，页面更新 2025-08-05 | https://grants.nih.gov/policy-and-compliance/policy-topics/sharing-policies/dms | 成功 |
| S19 | ACL Anthology + Responsible NLP Checklist | 2025/2026 论文附件 | https://aclanthology.org/ · https://aclanthology.org/attachments/2025.emnlp-main.996.checklist.pdf | 成功 |
| S20 | Zenodo 官网 | 实时（2026-11-19 有上传） | https://zenodo.org/ | 成功 |
| S21 | OSF（COS 官方产品页） | 官方 | https://www.cos.io/products/osf | 成功 |
| S22 | paperswithcode/releasing-research-code | **NeurIPS 2021 官方推荐** | https://github.com/paperswithcode/releasing-research-code | 成功 |
| S23 | ACS Publications Editorial Policies | — | https://www.acs.org/publications/editorial-and-peer-review-process/editorial-policies.html | **404，无法访问** |
| S24 | Nature Communications《Machine learning checklist》PDF | 官方 PDF | https://www.nature.com/documents/machine-learning-checklist.pdf | 已下载但**环境无法解析 PDF 正文**；存在性与链接由 S12 证实 |
| S25 | GO FAIR 官网 FAIR Principles 页 | — | https://www.go-fair.org/fair-principles/ | 仅返回概述，完整 15 条由 S2/S3 取得 |

**无法访问的来源**：S23（ACS 404）、S24（PDF 正文无法解析）。其余 22 个来源均取得实质内容。

---

## 1. 核心概念框架（所有后续判断的基础）

### 1.1 ACM 的三组徽章与四级术语（S1）

**【事实】ACM 定义三组相互独立的徽章**（"Artifacts Evaluated / Artifacts Available / Results Validated"，可单独或组合授予）：

1. **Artifacts Evaluated（工件已评估）**——又分两级，只能取其一：
   - **Functional（功能级）**：工件"documented, consistent, complete, exercisable, and include appropriate evidence of verification and validation"。原文四条子标准：
     - *Documented*：至少包含工件清单 + 足以运行它们的描述；
     - *Consistent*：工件与论文相关，并以内在方式贡献于主要结果的产生；
     - *Complete*：尽可能包含所有相关组件（专有工件可不含，但须记录获取方式并提供代理）；
     - *Exercisable*：脚本/软件可成功执行，数据可访问并被适当操作。
   - **Reusable（可复用级）**：质量"significantly exceeds minimal functionality"，具备 Functional 全部 qualities，且"very carefully documented and well-structured"，严格遵循社区规范，便于 reuse 与 repurposing。
2. **Artifacts Available（工件可获取）**：作者创建的工件置于公共可访问仓储，提供 DOI/链接与唯一标识符；**不要求已通过正式评估，也不要求完整**；个人主页不合格。
3. **Results Validated（结果已验证）**——又分两级：
   - **Reproduced**：非作者团队"using, in part, artifacts provided by the author"获得主要结果；
   - **Replicated**：非作者团队"without the use of author-supplied artifacts"独立获得主要结果。
   - 原文明确："exact replication or reproduction of results is not required, or even expected. Instead, the results must be in agreement to within a tolerance deemed acceptable for experiments of the given type"，且差异不应改变论文主要结论。

**【事实】ACM 经与 NISO 讨论后交换了术语**（S1 原文脚注）：现行为
- **Repeatability（重复性）**：同一团队、同一实验装置（计算实验语境：研究者可靠地重复自己的计算）；
- **Reproducibility（复现性）**：不同团队、同一实验装置，使用**作者提供的工件**；
- **Replicability（可重复性/再实现性）**：不同团队、不同实验装置，使用**完全独立开发的工件**。

**【分析】** 这套"徽章 + 术语"是好的分层：把"材料质量""可获取性""结果验证"解耦，避免用一个"可复现"标签混淆不同强度的证据。这正是 ReproCheck 应借鉴的核心结构。

### 1.2 FAIR 原则（S2/S3）

**【事实】**FAIR = Findable / Accessible / Interoperable / Reusable，共 15 条子原则（官方本体 w3id.org/fair/principles 原文）：
- F1 `(meta)data are assigned a globally unique and persistent identifier`
- F2 `data are described with rich metadata`
- F3 `metadata clearly and explicitly include the identifier of the data it describes`
- F4 `(meta)data are registered or indexed in a searchable resource`
- A1 `(meta)data are retrievable by their identifier using a standardized communications protocol`；A1.1 `open, free, and universally implementable`；A1.2 `allows for an authentication and authorization procedure, where necessary`
- A2 `metadata are accessible, even when the data are no longer available`
- I1 `(meta)data use a formal, accessible, shared, and broadly applicable language for knowledge representation`
- I2 `(meta)data use vocabularies that follow FAIR principles`
- I3 `(meta)data include qualified references to other (meta)data`
- R1 `(meta)data are richly described with a plurality of accurate and relevant attributes`；R1.1 `released with a clear and accessible data usage license`；R1.2 `associated with detailed provenance`；R1.3 `meet domain-relevant community standards`

**【事实】** FAIR 论文特别强调"enhancing the ability of **machines** to automatically find and use the data"（S3 摘要）。**【分析】** 这解释了为何机器可读元数据（而非仅人类可读 PDF）是自动审计的前提。

### 1.3 关联与溯源标准（S4/S5/S6/S7/S21/S22）

- **【事实】RO-Crate v1.1**（2023-04-26，Recommendation）：用 JSON-LD 把研究数据与其元数据打包成"research object"，`@context` + 根实体 + 数据实体/上下文实体；DOI 10.5281/zenodo.7867028（S4）。
- **【事实】W3C PROV-O**（2013-04-30 Recommendation）：以 `Entity / Activity / Agent` 三类核心对象建模溯源，核心属性 `used`、`wasGeneratedBy`、`wasAttributedTo`、`wasDerivedFrom`，复杂场景用 `qualifiedUsage/qualifiedGeneration/qualifiedDerivation` 增加时间、角色、计划等细节（S5）。
- **【事实】DataCite**：全球社区组织，提供 DOI 与元数据 schema，连接数据、预印本、图像、样本等成果，并与 Crossref/ORCID 互操作；S6 显示 2026 年已注册 DOI 80,792,635。
- **【事实】CASRAI**：2006 年成立，Dictionary v2026.1 有 1,986 条 / 29 域；CRediT 贡献者角色（14 类，2020 移交 NISO，ANSI/NISO Z39.104-2022）；与 NISO/euroCRIS/CODATA/RDA/ORCID/Crossref/DataCite/ARDC 有 crosswalk（S7）。
- **【事实】OSF**：COS 运营的免费开源平台，"register study plans, publish preprints… link externally to related data, materials, code, publications"；支持版本控制、带时间戳只读的 registrations、私有默认、与 Zenodo/Dryad/Dataverse 互操作（S21）。
- **【事实】ML 代码完整性清单**（S22，NeurIPS 2021 官方推荐，基于 200+ ML 仓库分析）：5 项 = 依赖声明 / 训练代码 / 评估代码 / 预训练模型 / README 含结果表与可精确复现命令。

---

## 2. 八个核心问题的回答

### Q1. 学术界如何判断研究材料是否完整？

**【事实】** ACM 用四个维度判定 Functional 级工件完整性：Documented（有清单+描述）、Consistent（与论文相关且贡献于结果）、Complete（含所有相关组件，专有部分须记录并给代理）、Exercisable（可执行/可访问）（S1）。Nature Mach. Intell. 要求 Methods "contain all elements necessary to allow interpretation and replication of the results"，并鼓励把逐步协议存入 protocols.io（S11）。Science 要求所有论文包含 materials availability statement，"even if there are no newly created materials"，且数据须"available to any researcher for purposes of reproducing or extending the analysis"，存入可永久访问、可引用 PID 的仓储（明确拒绝 Dropbox 这类作者可随时删改的服务）（S17）。FAIR 以 F2 丰富元数据、F4 可检索索引、R1.1 许可、R1.2 溯源、R1.3 社区标准刻画"完整可用"（S2/S3）。AAAI/NeurIPS/ACL 等以清单列举"是否包含伪代码、数据集、源码、依赖、硬件/软件版本、随机种子"等（S9/S16/S19）。RO-Crate 把"数据 + 元数据"作为一个可寻址整体打包（S4）。

**【分析】** "完整"并非单一布尔值，而是分层的：①是否有清单与可发现条目（FAIR F1–F4）；②是否覆盖产生主要结果所需的全部工件（ACM Complete）；③是否附带许可、溯源、社区标准元数据（FAIR R1.*）；④无法提供的部分是否有明确理由与替代（ACM/Science 的专有数据条款）。

**【建议】** ReproCheck 的完整性检查应输出结构化维度（清单/声明/依赖/溯源/许可/例外理由），而不是一个笼统"完整/不完整"。

### Q2. 如何判断代码是否真正能运行？

**【事实】** ACM 的 *Exercisable* 直接要求"included scripts and/or software used to generate the results… can be successfully executed, and included data can be accessed and appropriately manipulated"（S1）。NeurIPS Handbook 要求代码"self-contained and executable"，否则须解释原因；提交须含训练与评估代码、依赖规格；给出的指令须含"the exact command and environment needed to run to reproduce the results"（S8/S9）。S22 的 5 项清单把依赖声明（`requirements.txt` / `environment.yml` / `setup.py`）、训练脚本含超参与技巧、评估脚本、预训练模型、README 结果表+精确命令列为可执行性要素，并建议用 Docker 提供整体环境。AAAI 清单要求报告"computing infrastructure… including GPU/CPU models; amount of memory; operating system; names and versions of relevant software libraries and frameworks"及随机种子设置（S16）。Science 要求自写代码在发表前存入永久公共仓储，GitHub 代码须"archived in its current form in a permanent public repository"，否则用 pseudocode 替代并经同行评议（S17）。Nature MI 与 Code Ocean 合作提供"compute capsule"，内含 code+data+results+computational environment 并以 DOI 固化（S13）。

**【分析】** 业界判断"能运行"的证据链 = 依赖锁定 + 精确命令 + 自包含/容器化 + 在干净环境实测 + 输出与论文一致。纯静态检查（是否有 requirements.txt、README 命令）只能证明"具备可运行条件"，不能证明"确实跑通"。

**【建议】** ReproCheck 应区分两级：**结构级可运行性**（清单齐全、依赖/命令/环境声明存在，可自动检查）与**实测级可运行性**（真实执行，须隔离沙箱+用户授权，当前 README 明确"不运行用户上传代码"，应维持该边界并在报告中如实标注"未实测"）。

### Q3. 如何判断代码与论文描述一致？

**【事实】** ACM 的 *Consistent* 要求工件"relevant to the associated paper, and contribute in some inherent way to the generation of its main results"（S1）。AAAI 清单有一条极强的可操作规则："All source code implementing new methods have comments detailing the implementation, **with references to the paper where each step comes from**"（S16）——即代码注释应能指回论文步骤。AAAI 还要求说明超参数搜索与最优值、评估指标及选择动机、每个结果运行的次数（S16）。NeurIPS 要求实验设置（数据划分、超参数、如何选取）在正文详述，完整细节可在代码/附录（S9）。ACL Responsible NLP Checklist 的 C2/C3/C4 要求报告实验设置含超参数搜索与最优值、结果描述统计（误差棒、是 max/mean 还是单次运行）、所用包的 implementation/model/parameter settings（S19）。Science 要求通讯作者"Confirm that the presentation in the paper of the data/materials/code accurately reflects the original sources"，且统计方法须详细到"enable a knowledgeable reader… to verify the results"（S17）。

**【分析】** "一致性"本质是**跨材料事实比对**：论文正文/附录中的参数、指标、方法步骤，应与配置文件、代码注释、README 结果表中的对应值一致——这正是 ReproCheck 的核心能力（README 第 1–5 行描述）。

**【建议】** 把"代码↔论文一致性"做成一等公民检查项：抽取论文参数 vs 配置/代码/README 参数，输出冲突清单 + 原文证据（chunk_id/行号）；并明确这是"文本声明层一致性"，不等同于"代码实际行为一致性"（后者需执行）。

### Q4. 如何判断结果是否得到复现？

**【事实】** ACM 要求 Results Reproduced/Replicated 均由**非作者**的 person/team 在后续研究中获得主要结果，区别仅在是否使用作者提供的工件；并允许在"acceptable tolerance"内不一致，只要不改变主要结论；**post-publication 授予 Results Validated 必须提交一份报道复现/重复的同行评议论文作为证据**（S1）。NeurIPS 设 Reproducibility Challenge，研究者"claim"已录用且作者共享代码的论文并测试结果；2019 版有 173 篇被认领、70+ 机构参与（S13）。Nature Mach. Intell. 的 reusability report 明确"not intended as reproducibility or replication checks of the original paper's claims"，而是检验代码在新数据/新应用下的 robust/generalizable/reusable，且是同行评议、邀请撰写的文章（S13）。

**【分析】** 真正的"结果复现"有三要素：**独立第三方 + 使用工件（或不使用）+ 容差内一致**。它不是单个工具跑一遍就能"认证"的，而是需要实验执行 + 领域判断 + 可引用的证据。

**【建议】** ReproCheck 只能报告三类自身范围内的结论：①**跨材料一致性**（声明层）；②**可复现性条件/就绪度**（是否具备清单、依赖、命令、环境、数据/权重链接）；③**结果比对**（若用户提供了复现运行的结果，做容差比对并显式声明所用容差）。**禁止**输出"结果已复现/已验证"这类暗示 ACM 徽章或独立验证的措辞。

### Q5. 如何区分 "结果复现 / 结果重复验证 / 材料可用"（reproduce / replicate / reusable）？

**【事实】** ACM 现行术语（S1，经 NISO 协调后）：
| 术语 | 团队 | 实验装置/工件 | 含义 |
|---|---|---|---|
| Repeatability 重复性 | 同一团队 | 同一装置 | 作者可靠重复自己的计算 |
| Reproducibility 复现性 | 不同团队 | 同一装置，用作者工件 | 独立组用作者工件得同结果 |
| Replicability 再实现性 | 不同团队 | 不同装置，独立工件 | 独立组用自研工件得同结果 |

徽章侧：**Artifacts Available** 仅表示工件永久可获取（不需评估、不需完整）；**Artifacts Evaluated–Functional** 表示通过独立审计且可执行；**Reusable** 表示质量显著超越功能级、结构良好、便于 repurposing（S1）。Nature MI 的 "reusability report" 检验的是新情境下的稳健性/通用性/可复用性，而非对原论文主张的复现或重复（S13）。

**【分析】** 中文场景常把 reproduce/replicate 都译作"复现"，造成语义塌缩。三者的证据强度递增关系大致是：材料可用（Available）< 可执行（Functional）< 结果复现（Reproduced）< 结果重复（Replicated），而 Reusable 是"材料质量"维度而非"结果证据"维度——两者正交。

**【建议】** ReproCheck 应采用**显式四维标签**，且每个结论都标注所用定义来源（建议默认采用 ACM v1.1 + NISO 术语，并在 UI 注明"本平台采用 ACM 2020 定义"）。绝不把"材料可用"表述为"结果已复现"。

### Q6. 论文的数据/代码/权重/环境/实验记录应如何关联？

**【事实】** 相关规范给出互补的关联机制：
- **PROV-O**：以 Entity/Activity/Agent 三元组表达"数据由某活动使用某输入生成、归因于某主体、派生自某源"，并用 qualified terms 补充时间/角色/计划（S5）——可表达"结果←训练活动←(代码、数据、配置、环境)←作者"。
- **RO-Crate**：用 JSON-LD 把数据与上下文实体打包为一个带持久标识的研究对象，v1.1 已是 Recommendation（S4）。
- **FAIR**：F1 持久标识、F3 元数据含数据标识、A2 数据不存在时元数据仍可及、I3 合格引用、R1.2 详细溯源、R1.3 社区标准（S2/S3）。
- **DataCite / Zenodo**：DataCite 提供 DOI + 元数据 schema 并与 Crossref/ORCID 互操作（S6）；Zenodo 提供版本化、DOI、长期保存，被 paperswithcode 列为权重托管推荐（S20/S22）。
- **OSF**：以"lifecycle open science"把研究计划、数据、代码、产出跨系统链接，registrations 带时间戳只读、版本控制、与 Zenodo/Dryad/Dataverse 互操作（S21）。
- **领域清单**：NeurIPS D&B 要求数据集配 Croissant 机器可读元数据并推荐 Dataverse/Kaggle/HF/OpenML（S10）；Science 要求数据/代码以 DOI 在参考文献中正式引用（S17）；Code Ocean capsule 把 code+data+results+environment 打成带 DOI 的可执行单元（S13）。

**【分析】** 一个稳健的关联模型 = **持久标识符（DOI/PID）+ 机器可读元数据层（RO-Crate/Croissant/PROV-O）+ 内容寻址的版本化仓储（Zenodo/GitHub release+归档）+ 显式实验记录（配置、种子、命令、环境锁、运行日志）**。CASRAI/CRediT 另可表达"谁对哪个工件/活动负责"（S7）。

**【建议】** ReproCheck 的事实模型应支持把 `%paper ↔ dataset DOI ↔ code repo/release DOI ↔ model weights ↔ environment(lockfile/container) ↔ experiment run record(config/seed/command/output)` 作为可关联实体，并尽量复用 PROV-O/RO-Crate 的关系词表（used / wasGeneratedBy / wasDerivedFrom / wasAttributedTo）而非自造私有关系。

### Q7. 哪些评估项可自动化，哪些必须人工复核？

**【事实 + 分析】** 依据各规范的"可判定性"划分：

**可自动化（结构/声明层）**：
- 清单/声明是否存在且字段是否填全（NeurIPS/AAAI/ACL 清单结构，S9/S16/S19）；
- DOI/PID 是否存在并可解析、仓储链接是否有效（FAIR A1、F1/F3/F4，S2；Science 引用要求，S17）；
- 参数/指标/方法描述的**跨材料一致性比对**（ ACM Consistent，S1；ReproCheck 现有能力）；
- 依赖声明、训练/评估脚本、README 结果表与命令、随机种子、硬件/软件版本是否声明（S22/S16/S9）；
- 文件清单与实际文件是否匹配、许可字段是否存在（ACM Complete、FAIR R1.1，S1/S2）；
- 元数据格式/溯源图结构是否合规（RO-Crate JSON-LD 校验、PROV-O 关系合法性，S4/S5）；
- 统计报告项是否**出现**（误差棒、n、p 值），仅检查 presence（S17/S16）。

**必须人工复核（实质/判断层）**：
- 代码是否真的产出论文结果（需真实执行与领域判断；ACM Exercisable、Reproduced/Replicated，S1）；
- 容差是否"acceptable for experiments of the given type"——ACM 明确不给定量阈值，交领域专家（S1）；
- 科学主张是否成立、基线是否恰当、实验设计（样本量、停止规则、异常值处理、盲法）、统计是否误用（S17 Study Design/统计条款；S16）；
- 伦理、风险、局限、许可适当性、工件使用是否符合 intended use（ACL B3/D 组，S19）；
- "Reusable"级别判断——"significantly exceeds minimal functionality"需同行评估（S1）；Nature reusability reports 为邀请+同行评议（S13）；
- ACM 徽章本身由期刊/会议按其 review process 授予，ReproCheck 无权授予。

**【建议】** 产品上明确以"自动检查（可复核证据）"与"需人工确认（专家判断）"两类呈现，自动项给出可点开的原文证据，人工项不得由 LLM 单方面给出终局结论。

### Q8. 当前规范有哪些未被科研软件充分解决的问题？

**【事实 + 分析】**
1. **术语不统一**：ACM/NISO 已交换 reproduce/replicate 定义（S1），不同社区仍各用各的；任何工具都必须声明所用定义，否则"复现"结论不可比。
2. **清单自报、验证弱**：NeurIPS 明确"no because the code is proprietary"是可接受答案，"Papers cannot be rejected simply for not including code"；清单 yes/no 多为作者自填（S9）。**清单合规 ≠ 真的可复现**。
3. **可执行性难以自动判定**：ACM Exercisable、结果验证都需独立执行+容差判断，目前规范把细节留给社区（S1 明言"still too early to establish more specific guidelines"）。
4. **环境/工件衰变**：Science 指出 GitHub 可被作者后续修改而破坏复现，须归档当前版本（S17）；依赖漂移、硬件非确定性、闭源/受限模型（NeurIPS 允许"hosted model"作复现路径，S9）使自动验证困难。
5. **实验记录与配置缺乏统一机器可读 schema**： albeit RO-Crate v1.1/Croissant/PROV-O 已具备表达力，但在 ML 论文中尚未成为主流强制项（S4/S5/S10）。
6. **AI 生成内容溯源**：NeurIPS/ICML/AAAI/Nature 均新增 LLM/agent 披露要求（S8/S14/S16/S11），但如何机器验证"方法是否用到 LLM、图表是否幻觉"尚无标准。
7. **徽章/结论不可机读、不可跨venue比较**：ACM 徽章是 PDF/元数据标签，依赖各会议自己的 review process（S1），没有统一的机读"验证结论"本体；这让第三方工具难以引用。
8. **共享差距**：隐私/人类受试者/专有数据只能给代理或 gated access（S1/S17），形成验证盲区。

**【建议】** ReproCheck 的差异化定位正好落在这些缺口：用机器可读事实 + 可点证据，把"声明层一致性/就绪度"做扎实，同时**显式承认**上述无法自动解决的部分，避免越界承诺。

---

## 3. 对 ReproCheck 最有价值的 5 条规范启示

1. **采用 ACM 的解耦分层，而非单一"复现分"**：把 `材料可用 / 工件已评估(功能·可复用) / 结果已验证(复现·重复)` 作为正交维度分别输出，并显式声明所用定义（S1）。
2. **"一致性"是可执行的一等检查**：AAAI 的"代码注释须指回论文步骤"（S16）+ ReproCheck 现有参数比对能力，可形成"论文↔配置↔代码/README"的跨材料事实核对，且必须附原文证据。
3. **区分结构级与实测级可运行性**：依赖/命令/环境声明（S22/S9）可自动查；真实执行须沙箱+授权且如实标注"未实测"，守住 README 中"不运行用户代码"的边界。
4. **用 PROV-O/RO-Crate/DataCite 的关系与 PID 建模关联**：`paper↔data↔code↔weights↔environment↔run` 用 used/wasGeneratedBy/wasDerivedFrom + DOI，而非私有字段（S4/S5/S6）。
5. **FAIR 的机器可读性 + 完整性维度可直接产品化**：F1–F4/A1–A2/I1–I3/R1–R1.3 作为"元数据完整度"评分项，R1.2 provenance 作为溯源证据要求（S2/S3）。

---

## 4. 合规与表述红线（借鉴 ≠ 认证）

**【事实】** ACM 原文：此类增强评审"encouraged, but remain completely optional"，参与对作者也是 optional；徽章由期刊/会议按其自身 review process 授予，post-publication 的 Results Validated 还须提交同行评议证据（S1）。各 venue 政策也多为"encouraged/recommended"而非强制（S9/S14/S15）。

**【建议】** 产品与文档必须遵守：
- 表述为"**参考/借鉴 ACM v1.1 评估框架**设计自检项"，**不得**使用"ACM 认证 / ACM 徽章 / 官方背书 / 已通过 ACM 评估"等措辞。
- 所有结论加范围限定："本报告仅基于 ReproCheck 自身验证范围内（文本抽取与跨材料比对）的证据，未进行独立实验复现，不构成任何机构的认证。"
- 引用规范时附版本与日期（如"ACM v1.1, 2020-08-24"），避免把不同社区定义混用。
- 对"可复现性"只报就绪度/一致性，不报"已复现"。

---

## 5. 后续建议

- 若需 ACS 政策细节，改从 ACS 出版伦理子页或 DOI 政策页重试（S23 主页面 404）。
- Nature Comms 机器学习清单（S24）建议由具备 PDF 解析能力的环境提取条目原文，用于细化 ML 专属检查表。
- 可补充调研 IEEE、ACM 各 SIG 的具体 artifact evaluation 流程，以及 Zenodo/Figshare/Dataverse 的 API 自动化能力。
