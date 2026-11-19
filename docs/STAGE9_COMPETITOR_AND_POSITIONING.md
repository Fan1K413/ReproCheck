# ReproCheck 第九阶段 · 竞品分析与产品定位报告

> 调研日期：2026-11-19。执行人：C 组（竞品分析与产品定位）。
> 本报告所有竞品能力均来自**真实联网调研**（WebFetch / WebSearch），每条判断附来源 URL；**未编造竞品缺陷来衬托自身**。评级是分析映射，不是厂商自评。
> 文本分层：**【事实】**=有来源或本仓库源码/文档可核验；**【分析】**=基于事实的推断；**【建议】**=面向第九阶段的设计主张。

---

## 0. 执行摘要

| 项目 | 结论 |
|---|---|
| 对比规模 | **14 个项目/平台**（MLflow、DVC、Code Ocean、Weights & Biases、OpenML、Papers with Code、Hugging Face Hub、Snakemake、Nextflow、Zenodo、OSF、Jupyter/Binder、Sacred、DataLad），12 个维度，每格标注成熟度并附来源编号。 |
| 最强竞品优势 | **Code Ocean**：把代码+数据+环境封装为可执行 Capsule，运行后生成**不可变的 Lineage Graph**，提交出版物前会被校验"计算可复现"，发布后获得 DOI，并被 Nature/IEEE/Elsevier 等期刊用于代码审查。它在"真实执行 + 环境管理 + 来源追踪 + 可信发布"这条链上最完整。MLflow/DVC 分别在实验追踪与数据版本上成熟，但不以"审计论文主张"为目标。 |
| ReproCheck 真实差异化 3 条 | ①**以论文主张为审计起点**，跨论文文本/配置/代码/数据做一致性核对，而非信任作者自报参数；②**证据受控**：证据原文从后端材料读取，拒绝模型虚构 chunk_id，区分 AI 推测与程序验证；③**审计对象上有分级结论与人工复核闭环**，而不是单一分数或排行榜。 |
| 最值得做的 3 个升级方向 | ①**A 全链路证据链**（主张→PDF 页码→代码行→配置→数据版本→运行→结果→结论）；②**B 七维分级评估 + 禁止单一分数**；③**C 基于 RO-Crate / PROV-O 的标准化交接包**。三者都直接放大上述差异化，且不依赖自建隔离执行（D 方向协同解决）。 |
| 诚实边界 | ReproCheck **没有**真实隔离执行、无 OCR 图像级验证、无数据泄漏检测、无真实论文/模型实战验证、无用户试点，因此"节省真实时间""发现人工遗漏的真实问题"目前只有结构与合成材料证据，**不得作为已验证成效对外宣称**。 |

---

## 1. 【事实】ReproCheck 现状基线（依据本仓库源码与文档，非营销描述）

| 能力 | 真实状态 | 依据 |
|---|---|---|
| 材料上传/解析、AI 事实抽取、证据逐字校验 | 已实现；证据从后端材料读取、拒绝虚构 chunk_id；仅处理文本，早期无 PDF 页码 | `README.md:97-99`、`docs/PARSER_ARCHITECTURE.md`、`docs/EVIDENCE_TRACEABILITY.md` |
| 规则 / 静态分析 / 数值重算分层验证 | 第 1/2/4 层 PASS-TESTED；第 3 层动态执行关闭（`executed=False`，"隔离执行环境未启用"） | `docs/STAGE6_REAL_STATUS.md:54` |
| 图表反向验证 | 仅文本/数值层（提取 `76.1/91.2`、图注、`plt.plot` AST、CSV/JSON）；**明确未做 OCR/重绘对比**，缺数据时标 `insufficient_data` | `docs/STAGE6_REAL_STATUS.md:53` |
| 任务编排 | pause/resume/timeout/卡死恢复 PASS-TESTED；不执行上传代码 | `docs/STAGE6_REAL_STATUS.md:48` |
| 交接包 | ZIP 含材料原文/事实/证据、逐文件 sha256、Zip Slip 防护；导入只校验不写库 | `docs/STAGE6_REAL_STATUS.md:49` |
| 失败诊断 | 11 类标准分类、候选原因 `is_confirmed=false`、独立于 LLM；只做日志规则分类，非确定根因 | `docs/STAGE6_REAL_STATUS.md:50` |
| 基准指标 | P/R/F1 等指标引擎 PASS-TESTED；无端到端"人工标注真值→检测器→回归门禁"流水线 | `docs/STAGE6_REAL_STATUS.md:52` |
| 团队协作 / RBAC | JWT/org/邀请/撤权/项目隔离测试通过；缺浏览器级多课题组 E2E | `docs/STAGE6_REAL_STATUS.md:29` |
| 外部集成 | GitHub/GitLab/Gitee 连接器仅 PAT 静态令牌（`auth_type` 只是数据库字符串字段，无 OAuth 授权码流程），真实取远端 commit sha+message；无克隆/diff/tag（sha 之外的 diff 字段只是 commit message），`default_branch` 硬编码为空；notebook 细胞级解析只读 | `docs/EXTERNAL_INTEGRATION_SPEC.md:1-44`；代码实证 `repository_service.py:23`（providers）、`:57-64`（PAT 默认）、`:117-146`（仅 commits 端点）、`:126/136/145`（default_branch 硬编码空）、`:188`（version_diff_json 内容），由 research-github 提供 |
| 用户需求验证 | 全部需求为**未验证假设**，未执行真实问卷/访谈/试点 | `docs/USER_NEEDS_ANALYSIS.md:1-21` |

**【分析】** 这条基线决定了定位：ReproCheck 是一个**审计/核对层**，不是执行平台、数据版本库或归档库。任何把它包装成"替代 MLflow/DVC/Code Ocean"的说法都与事实冲突。

---

## 2. 【事实】竞品调研事实层（逐项目，含来源 URL）

### 2.1 MLflow
- **定位**：实验追踪 + 项目打包 + 模型生命周期。Tracking 用 run 记录 params/metrics/artifacts/code version，提供 UI 对比、搜索、下载；提供 Python/REST/R/Java API；Tracking Server 可配置访问控制。来源：<https://mlflow.org/docs/latest/ml/tracking/>
- Projects 是"打包与共享可复现数据科学代码的标准格式"，`MLproject` 定义 entry points 与环境，支持 virtualenv/conda/docker/system；`mlflow run <git-url>` **真实执行**代码，后端可为 local/Databricks/Kubernetes。来源：<https://mlflow.org/docs/latest/ml/projects/>
- **【事实，research-github 补充】** Tracking 官方明确 Python/REST/R/Java 四种 API；Projects 支持 `python_env.yaml`/`conda.yaml`/`docker_env`/`system` 四种环境类型；MLflow 3 的 `search_logged_models()` 支持类 SQL 过滤并把指标关联到 `model_id`+`dataset`，模型 URI 已从 `runs:/<run_id>/<path>` 改为 `models:/<model_id>`（写集成示例勿用旧格式）。来源：<https://mlflow.org/docs/latest/ml/tracking/>、<https://mlflow.org/docs/latest/ml/projects/>
- **边界**：参数由调用方 `mlflow.log_param()` 自报；官方 Reproducibility 最佳实践是让用户**自己**记 python_version、platform、git_commit。来源：同上。
- **与审计相关的空白**：不解析论文；不核对论文文本里的参数与配置是否一致；无结构化失败诊断；无"证据不足/冲突"这类结论状态。

### 2.2 DVC
- **定位**："Git for data"。`dvc add` 把数据移入缓存并生成 `.dvc` 文件（含 md5），Git 版本化的是元数据，原始数据进 `.gitignore`；远端支持 S3、SSH、Google Drive、Azure Blob、HDFS。来源：<https://dvc.org/doc/start>、<https://dvc.org/doc/start/data-management/data-versioning>
- `dvc.yaml` 定义 pipeline，`dvc repro` 执行；`dvc exp run` 运行并保存实验，跟踪 params/metrics/plots，可队列化；实验以隐藏 Git ref 保存；有 model registry。来源：<https://dvc.org/doc/user-guide/experiment-management>、<https://dvc.org/doc/start>
- **【事实，research-github 的 GitHub API/代码核验补充】** 仓库已从 `iterative/dvc` 迁到 `treeverse/dvc`（API 301，仍为 Apache-2.0）；`.dvc` 哈希按后端为 md5（本地/HTTP/S3/Azure 用 etag、HDFS 用 checksum）；`deps.repo.rev_lock` 可把外部 DVC 仓库锁到具体 commit——这是"跨仓库版本锁定"的可借鉴点。来源：<https://github.com/treeverse/dvc>
- **边界**：DVC 官方自述"technically not a version control system by itself"，它操作 `.dvc` 文件，版本控制依赖 Git。
- **与审计相关的空白**：不解析论文；不验证论文主张；环境管理不是核心（依赖 conda/CML 等周边）；无失败根因诊断。

### 2.3 Code Ocean（最强竞品）
- **定位**：云端可执行研究平台。Compute Capsule = code + data + environment 的单一封装对象，支持 Dockerfile 自动生成、一键部署、空闲自动关机。来源：<https://www.codeocean.com/>、<https://www.codeocean.com/solutions/universities/>
- **Lineage Graph**："an immutable record of how Result Data are generated"，可评估每个 Capsule/Pipeline/Data asset 的可复现性；所有开发用 Git 跟踪、可导出无锁定。来源：同上。
- **出版与可信度**：提交出版后会"verified for computational reproducibility"，发布后有 DOI、可引用、任何人可导出本地复现、可被其他用户 duplicate 并重跑；OSL（Open Science Library）含 3000+ 已发布计算实验，对接 Nature、IEEE、Elsevier 等期刊投稿。来源：<https://docs.codeocean.com/osl-guide/publishing-on-code-ocean/publishing-on-code-ocean-an-overview>、<https://codeocean.com/press-releases/press-release/code-ocean-announces-open-science-library-allowing-no-cost-turn-key-replication-of-computational-science-experiments>
- **ML 协同**：内置集成 MLflow 做 tracking/registry/lineage/inference。来源：<https://www.codeocean.com/solutions/universities/>
- **边界（事实）**：其验证对象是"Capsule 是否可重新执行并生成结果数据"，**不是"论文文字主张是否与实现一致"**；需要云算力/账号；平台为商业产品。

### 2.4 Weights & Biases（现处于 CoreWeave Forge 体系）
- **定位**："tracks, visualizes, and compares your machine learning experiments"，核心为 experiment tracking、hyperparameter sweeps、artifacts、visualizations；含 W&B Weave 做 LLM 追踪与评估。来源：<https://docs.coreweave.com/products/wandb>
- 当前官方能力目录包含 Reports、Registry（"Versioned hub for models and datasets with lineage and deployment handoff"）、Notebooks、Sandboxes（隔离计算环境）、Post-Training。来源：<https://docs.coreweave.com/forge-home>
- **【事实，research-github 补充】** W&B Python SDK 为 MIT 开源，但云服务闭源；旧 `docs.wandb.ai` 链接多已跳到 `docs.coreweave.com`，引用时以新域名为准。来源：<https://docs.coreweave.com/products/wandb>
- **边界**：以作者自报的 metric/log 为中心；执行能力依托 CoreWeave 计算产品，而非像 Code Ocean 那样以"Capsule 执行"为产品核心。

### 2.5 OpenML
- **定位**：开放的科学 ML 数据与实验平台。官方页面显示规模：Datasets 7.3k、Tasks 263.2k、Flows 123.7k、Runs 10.1M、Collections/Benchmarks/Task Suites/Run Studies、Measures 230（含 Evaluation Measures 与 Evaluation Procedures）。来源：<https://www.openml.org/>、<https://www.openml.org/apis>
- **【事实，research-github 补充】** `openml.tasks.get_task(32)` 即"任务冻结数据集 + 10 折 CV"的模式；`run.publish()` 需 API key，结果带 `openml_url` 永久链接，可作为外部基准事实源的具体接入形态。来源：<https://www.openml.org/apis>
- **边界**：本质是"已上传 run 与标准化评估设置的仓库"，不是论文审计器，不解析 PDF，不核验论文主张。

### 2.6 Papers with Code（重要事实：原站已关停）
- 原站 2019 年被 Meta 收购，**2025-07-24/25 停止服务**，原域名跳转 Hugging Face Trending Papers；历史数据（18,000+ 论文、1,500 leaderboards、1,000+ tasks）以 CC-BY-SA 保留在 GitHub/HF 镜像，静态不再更新。来源：<https://de.coursera.org/articles/papers-with-code>、<https://unknownobserver.com/posts/papers-with-code-shutdown-to-open-source>
- 2026 年由 Hugging Face 工程师以 Apache-2.0 在 paperswithcode.co 重建，自动从 HF/arXiv/GitHub/公开榜单导入，新增多指标 leaderboard、SOTA 徽章、paper lineage tracking、第三方 evaluation runs。来源：同上（官方原站已不存在，故为二手来源，需标注）。
- **【分析】** 这是"论文→代码映射"品类的真实历史教训：映射与榜单有需求，但**维护成本高、单点关停会让生态断层**。对 ReproCheck 的启示是：不要把差异化押在"论文-代码映射"本身。

### 2.7 Hugging Face Hub
- **定位**：开放 ML 平台。Git-based repositories（models/datasets/spaces）具备 versioning、commit history、diffs、branches，Xet 支持大文件；Model Cards 说明限制与偏见、Dataset Cards、Eval Results、Paper Pages、DOI、Spaces（Gradio/Streamlit/Docker/ZeroGPU）真实运行、Jobs（Train Models/Schedule Jobs）、Organizations 与 roles、PRs/Discussions、Hub API。来源：<https://huggingface.co/docs/hub>
- **【事实，research-github 补充】** `from_pretrained(..., revision="tag/branch/commit hash")` 可锁定版本；模型卡片 YAML 的 `base_model` 字段可表达微调/量化/合并血缘；注意模型权重有各自 license，不等于 Hub 库许可证。来源：<https://huggingface.co/docs/hub>
- **边界**：Paper Pages 是"关联"而非"解析/核对论文主张"；Model Card 由上传者填写，Eval Results 由上传者提供。

### 2.8 Snakemake
- 工作流系统，"create reproducible and scalable data analyses"，Python DSL；软件依赖自动部署到执行环境；可扩到 server/cluster/grid/cloud；运行可自动转成交互式报告，"combine results with all used parameters, code, and software"；有 conda-forge/Bioconda 支撑。来源：<https://snakemake.readthedocs.io/en/stable/>
- **边界**：以工作流为中心，不以论文为中心；无结构化失败诊断（靠 DAG 调度与日志）。

### 2.9 Nextflow
- 工作流系统，"scalable, portable, and reproducible"；每个 task 可有独立容器，支持 Conda/Spack；同一 pipeline 在笔记本/HPC/云只改配置；`-resume` 失败续跑；有 trace/report、nf-core 社区。来源：<https://docs.seqera.io/nextflow>（原 <https://www.nextflow.io/docs/latest/index.html> 跳转）
- **边界**：同 Snakemake——执行与可移植性强，但不做论文主张核对。

### 2.10 Zenodo
- 研究产出 deposition/publishing 平台：发布时向 DataCite 注册 DOI、持久链接、发布后不可删除；快照式新版本；丰富元数据（作者、related identifiers、grants、communities、methodology、license）；OAI-PMH 与 bulk metadata dumps；从 GitHub release 自动提取元数据、可用 `.zenodo.json` 覆盖。来源：<https://developers.zenodo.org/>
- **边界（官方原文）**：checksum 仅"check the integrity of the uploaded file"，不是结果验证；不执行代码、不解析论文全文、不跟踪证据链。

### 2.11 OSF（Open Science Framework）
- 免费开放研究平台：项目协作空间（可公开/私有、contributors、components、wiki）、自动文件版本控制、Registrations/Preregistrations（time-stamped、read-only、可 embargo）、Preprints、OSF Storage 与第三方存储、每个文件唯一持久 URL、与 Zenodo/Dryad/Dataverse 互操作。来源：<https://osf.io>、<https://help.osf.io/article/339-osf-dictionary>、<https://cos.io/our-products/osf/>
- **边界**：可信度强（预注册、时间戳快照），但不执行代码、不验证结果、不解析论文。

### 2.12 Jupyter / Binder
- Binder："create custom computing environments that can be shared and used by many remote users"，BinderHub 基于 Kubernetes，mybinder.org 免费；有"Ensure reproducibility for your Binder repository"教程与 Dockerfile 支持、PR 启动徽章。来源：<https://mybinder.readthedocs.io/en/latest/>、<https://mybinder.readthedocs.io/en/latest/tutorials/reproducibility.html>
- **【事实，research-github 补充】** `https://mybinder.org/v2/gh/<owner>/<repo>/<commit>` 链接锁定 commit + 环境（repo2docker 从 requirements.txt/environment.yml/Dockerfile 构建），可作为审计报告里的"一键复现凭证"；repo2docker 仓库从 `jupyter/` 迁到 `jupyterhub/`。来源：<https://mybinder.readthedocs.io/en/latest/>
- **边界**：执行环境是临时交互会话，不是长期归档或结果验证系统。

### 2.13 Sacred
- "a tool to configure, organize, log and reproduce computational experiments"；Config Scopes、依赖注入、CLI 改参、Observers 记录配置与运行信息到数据库、自动 seeding 控制随机性；版本 0.8.4。来源：<https://sacred.readthedocs.io/en/stable/>
- **边界**：轻量 Python 库，只覆盖"配置/种子/日志"层，不做论文与跨材料审计。

### 2.14 DataLad
- "data management and publication multitool"，基于 Git + git-annex 管理大文件；官方设计目录含 **Provenance capture**；扩展含 containerized environments、OSF 存取、metadata（JSON-LD）。来源：<https://docs.datalad.org/en/stable/>
- **边界**：强在数据来源与发布，不是论文主张核对或结果验证系统。

---

## 3. 任务一：12 维横向对比矩阵

**评级口径**：`成熟`=该能力是工具核心功能且有官方明确描述；`部分`=有相关能力但不覆盖"审计论文主张"全流程，或依赖周边工具/人工；`未解决`=在官方功能范围内**未见**该能力，且通常不是该工具设计目标。
**来源标记**：`[编号]` 指向第 7 节来源清单中的完整 URL；`未解决 [编号]` 表示该工具的官方功能描述未覆盖此维度，**不是对其价值的负面断言**。

### 3.1 材料与证据层

| 项目 | 论文解析 | 代码关联 | 证据追踪 | 数据审计 |
|---|---|---|---|---|
| MLflow | 未解决 [ML1] | 部分 [ML2] | 部分 [ML1] | 部分 [ML1] |
| DVC | 未解决 [DV1] | 部分 [DV1] | 部分 [DV2] | 成熟 [DV2] |
| Code Ocean | 未解决 [CO1] | 成熟 [CO1] | 成熟 [CO1][CO3] | 成熟 [CO2] |
| W&B | 未解决 [WB1] | 部分 [WB1] | 部分 [WB1] | 部分 [WB1] |
| OpenML | 未解决 [OM1] | 部分 [OM1] | 部分 [OM1] | 成熟 [OM1] |
| Papers with Code | 部分 [PWC2] | 成熟 [PWC1][PWC2] | 未解决 [PWC2] | 部分 [PWC1] |
| Hugging Face Hub | 部分 [HF1] | 成熟 [HF1] | 部分 [HF1] | 部分 [HF1] |
| Snakemake | 未解决 [SM1] | 未解决 [SM1] | 部分 [SM1] | 部分 [SM1] |
| Nextflow | 未解决 [NF1] | 未解决 [NF1] | 部分 [NF1] | 部分 [NF1] |
| Zenodo | 未解决 [ZD1] | 部分 [ZD1] | 未解决 [ZD1] | 部分 [ZD1] |
| OSF | 未解决 [OSF1] | 部分 [OSF1] | 部分 [OSF1] | 部分 [OSF1] |
| Jupyter/Binder | 未解决 [JB1] | 部分 [JB1] | 部分 [JB1] | 未解决 [JB1] |
| Sacred | 未解决 [SA1] | 未解决 [SA1] | 部分 [SA1] | 未解决 [SA1] |
| DataLad | 未解决 [DL1] | 部分 [DL1] | 成熟 [DL1] | 成熟 [DL1] |

### 3.2 执行与验证层

| 项目 | 环境管理 | 实际执行 | 结果验证 | 失败诊断 |
|---|---|---|---|---|
| MLflow | 成熟 [ML2] | 成熟 [ML2] | 部分 [ML1] | 未解决 [ML1] |
| DVC | 部分 [DV1] | 成熟 [DV3] | 部分 [DV3] | 未解决 [DV3] |
| Code Ocean | 成熟 [CO1] | 成熟 [CO1] | 部分 [CO1][CO3] | 未解决 [CO1] |
| W&B | 部分 [WB1] | 部分 [WB1][WB2] | 部分 [WB1] | 未解决 [WB1] |
| OpenML | 部分 [OM1] | 部分 [OM1] | 部分 [OM1] | 未解决 [OM1] |
| Papers with Code | 未解决 [PWC1] | 未解决 [PWC1] | 部分 [PWC2] | 未解决 [PWC2] |
| Hugging Face Hub | 部分 [HF1] | 成熟 [HF1] | 部分 [HF1] | 未解决 [HF1] |
| Snakemake | 成熟 [SM1] | 成熟 [SM1] | 部分 [SM1] | 部分 [SM1] |
| Nextflow | 成熟 [NF1] | 成熟 [NF1] | 部分 [NF1] | 部分 [NF1] |
| Zenodo | 未解决 [ZD1] | 未解决 [ZD1] | 未解决 [ZD1] | 未解决 [ZD1] |
| OSF | 未解决 [OSF1] | 未解决 [OSF1] | 未解决 [OSF1] | 未解决 [OSF1] |
| Jupyter/Binder | 成熟 [JB1] | 成熟 [JB1] | 部分 [JB1] | 未解决 [JB1] |
| Sacred | 部分 [SA1] | 成熟 [SA1] | 部分 [SA1] | 未解决 [SA1] |
| DataLad | 部分 [DL1] | 部分 [DL1] | 未解决 [DL1] | 未解决 [DL1] |

### 3.3 组织与开放层

| 项目 | 可信度管理 | 团队协作 | 项目交接 | 开放集成 |
|---|---|---|---|---|
| MLflow | 部分 [ML1] | 部分 [ML1] | 部分 [ML2] | 成熟 [ML1][ML2] |
| DVC | 部分 [DV2] | 部分 [DV3] | 部分 [DV1][DV3] | 成熟 [DV1][DV3] |
| Code Ocean | 成熟 [CO1][CO3] | 成熟 [CO2] | 成熟 [CO1][CO3] | 部分 [CO1][CO2] |
| W&B | 部分 [WB1][WB2] | 成熟 [WB1] | 部分 [WB1] | 成熟 [WB1] |
| OpenML | 部分 [OM1] | 部分 [OM1] | 部分 [OM1] | 成熟 [OM2] |
| Papers with Code | 部分 [PWC2] | 部分 [PWC2] | 未解决 [PWC1] | 部分 [PWC2] |
| Hugging Face Hub | 部分 [HF1] | 成熟 [HF1] | 部分 [HF1] | 成熟 [HF1] |
| Snakemake | 部分 [SM1] | 部分 [SM1] | 部分 [SM1] | 部分 [SM1] |
| Nextflow | 部分 [NF1] | 部分 [NF1] | 部分 [NF1] | 部分 [NF1] |
| Zenodo | 成熟 [ZD1] | 部分 [ZD1] | 部分 [ZD1] | 成熟 [ZD1] |
| OSF | 成熟 [OSF1][OSF2] | 成熟 [OSF1] | 部分 [OSF1] | 成熟 [OSF1] |
| Jupyter/Binder | 部分 [JB1] | 部分 [JB1] | 部分 [JB1] | 部分 [JB1] |
| Sacred | 部分 [SA1] | 未解决 [SA1] | 部分 [SA1] | 部分 [SA1] |
| DataLad | 部分 [DL1] | 部分 [DL1] | 成熟 [DL1] | 部分 [DL1] |

### 3.4 【分析】矩阵读出的三个结构性事实

1. **"论文解析 × 证据追踪"是全行业空位**。14 个项目中，论文解析达到"部分"的只有 Papers with Code（已关停重建）与 HF Hub（Paper Pages）；没有任何一个把"论文文字主张"锚定到可逐字核验的证据位置。这是 ReproCheck 最硬的空白市场。
2. **成熟能力集中在"生产侧"**：环境管理/实际执行最强的是 Code Ocean、Snakemake、Nextflow、Binder、MLflow；可信度/归档最强的是 Zenodo、OSF、Code Ocean。它们都默认"作者提供的信息是可信输入"。
3. **失败诊断与"证据不足/冲突"结论几乎无人做**：除工作流工具的重试/续跑（部分），14 个项目中没有把"结构化失败原因 + 人工复核 + 结论分级"做成一等公民的。这与 ReproCheck 的确定性诊断层、申诉复核链形成明确差异。

---

## 4. 任务二：科研人员为何用 ReproCheck 而非 MLflow/DVC/Code Ocean

### 4.1 【事实】三个参照物的真实定位
- MLflow：作者用来 **记录** 自己跑过的 run 并管理模型；参数由作者 `log_param` 自报。
- DVC：作者用来 **版本化** 数据并复现 pipeline；`dvc add` 的数据由作者指定。
- Code Ocean：作者/机构用来 **执行并发布** 可复现 capsule，期刊用它做代码提交验证；验证的是"capsule 能跑出结果数据"。

### 4.2 【分析】三条真实差异（不是臆测缺陷）
1. **信任模型相反**：三者都是"生产者工具"——作者声明参数、作者选择数据、作者封装环境；ReproCheck 是"审查者工具"——把论文文本、配置、代码 AST、数据文件当作**互相可疑的独立证词**，用程序做交叉比对。证据是：README 中"发现参数冲突与说明不一致，并给出可追溯证据"、`README.md:97` 的"拒绝模型虚构的 chunk_id"，以及 MLflow/DVC/Code Ocean 官方文档中均无"核对论文主张"这一步。
2. **在"不能跑代码"的现实场景下仍可工作**：审稿人往往没有 GPU、数据授权或云账号。Code Ocean 的可行性前提是云算力/账号；MLflow/DVC 要求拿到代码与数据。ReproCheck 的静态分析、数值重算、文本/数值层图表核对可在**不执行代码**时给出"已验证/证据不足/冲突"的分级结论。这是场景差异，不是对竞品的否定。
3. **产物是"可复核的证据链与分级结论"，而非 dashboard 或 capsule**：MLflow 给对比图，DVC 给数据版本，Code Ocean 给可重跑容器；ReproCheck 给的是"哪条论文主张、对应哪段原文、与哪份配置冲突、由程序还是 AI 判定、是否经人工复核"。三者可共存，不互相替代。

### 4.3 六个必答问题（逐条回答，含诚实边界）

| 问题 | 【分析】回答 | 证据强度 |
|---|---|---|
| 能否节省真实时间？ | **结构上能**：跨材料参数冲突是脚本自动完成（合成材料演示已发现 batch size 64 vs 32、lr 0.001 vs 0.0001）。但**没有真实试点/计时数据**，不得宣称已节省真实时间。 | 结构证据成立；成效未验证（`USER_NEEDS_ANALYSIS.md:3`） |
| 能否发现人工遗漏问题？ | **机制上能**：静态分析从 AST 抽 seed/lr/split，图表服务从文本/CSV 抽数值再重算，能捕捉"论文写 A、配置写 B"这类人眼易漏的不一致。但演示用的是**合成材料**，尚无真实论文中发现的案例。 | 机制已实现（`STAGE6_REAL_STATUS.md:53-54`）；真实案例 0 |
| 结果有证据支撑吗？ | **是，这是最强项**：证据原文从后端材料读取，拒绝模型虚构 chunk_id；确定性诊断候选原因 `is_confirmed=false`，明确不是根因；AI 与程序验证分离。 | 事实（`README.md:97`、`STAGE6_REAL_STATUS.md:50`） |
| 帮助审稿人/作者/实验室负责人吗？ | **设计目标明确但需落地**：RBAC/项目隔离已实现，可承载"审稿人只读证据、作者补充证据、负责人复核结论"；但相应浏览器级 E2E 与真实角色访谈未完成。 | 能力已实现，流程未验证 |
| 有难以被通用 AI 问答替代的价值吗？ | **有，且是架构性的**：通用 LLM 无法保证证据来自用户上传的真实字节、无法运行确定性规则、无法留下不可篡改的审计轨迹、无法在未发表材料上执行 RBAC。ReproCheck 的"证据受控 + 程序验证 + 留痕"三者组合不是提示词能复现的。 | 事实+分析 |
| 连续用一年哪些功能让人回来？ | **候选留存钩子**：历史案例库（越用越省）、误报反馈闭环（越用越准）、团队审计轨迹（越用越合规）、连接器 commit 快照（越用越可追溯）。**全部是假设/部分实现**，需一年期真实使用验证。 | 假设（`USER_NEEDS_ANALYSIS.md:9-20`） |

### 4.4 【建议】一句话定位
> ReproCheck 不是"另一个实验追踪器"，而是**科研复现的独立核对层**：在作者自报的 run、数据与代码之上，回到论文主张本身，给出带证据、分级、可人工复核的审计结论；它消费 MLflow/DVC/Code Ocean 的产物，而不与它们争夺执行与版本控制的地盘。

---

## 5. 任务三：五方向差异化设计建议

> 以下每条均为【建议】，并在开头用【事实】标明起点。实现时须由团队核对边界，禁止把建议写成已完成能力。

### 5.1 A. 科研结论证据链
**【事实】** 现有：事实 schema、source chunk、证据逐字校验、证据图谱只读 API/前端；notebook 细胞级解析（只读）；仓库 commit 快照；图表文本/数值层提取。**没有**：PDF 页码锚点、代码行号锚点、配置→数据版本→run→结果的强绑定。

**【建议】设计一条八段式、可逐跳验证的证据链**：
`论文主张(claim) → PDF 文件+页码+字符区间 → 代码仓库 commit+文件路径+行号 → 配置文件键值 → 数据对象 checksum/版本 → 运行 run_id → 结果指标 → 结论状态`

落地要点：
1. 把证据引用扩成**类型化锚点** `{kind: pdf_page|code_line|config_kv|data_version|run|metric, ref, byte_range, sha256, extracted_by, confidence, observed_at}`；`extracted_by` 必填且取值枚举 `llm|program|human`。
2. 每条边记录 `verifier_type`（AI 推测 / 程序验证 / 人工确认）与 `is_confirmed`；沿用现有 `is_confirmed=false` 口径，AI 不得自证。
3. 验证方式必须是"重新读原字节比对"，而不是信任抽取结果缓存；锚点失效（文件变更/commit 改变）时链条标 `stale` 而非自动通过。
4. UI 以链条为主视图，点击任一节点显示原始证据片段；禁止用绿色对勾掩盖"证据不足"。
5. 边界：无 PDF 页码解析能力时，先以 `page=null + 字符区间 + sha256` 降级实现，不伪造页码。

### 5.2 B. 多维度复现评估（禁止单一分数）
**【事实】** 现有 benchmark 指标引擎算 P/R/F1；图表服务缺数据时返回 `insufficient_data`；验证引擎分层。没有"面向一次复现的七维画像"。

**【建议】** 对每次审计输出**七个独立维度**，每维独立赋状态，禁止聚合成单一分数或排行榜：

| 维度 | 判定依据（建议） |
|---|---|
| 材料可获取 | 论文/代码/数据/配置链接是否可得、是否需授权 |
| 材料完整 | 关键参数、随机种子、数据划分、环境声明是否齐备 |
| 环境可构建 | 是否有 Dockerfile/conda/lock 且可解析；**当前无 Docker，应默认标"无法验证"而非"通过"** |
| 代码可执行 | 是否通过静态可运行性检查；**动态执行关闭，须标"无法验证"** |
| 实验可重复 | 同配置同种子下能否复现流程（可借外部 run 记录，见 D） |
| 结果可复现 | 数值是否在容差内重算一致 |
| 与论文一致 | 论文文字主张与配置/代码/结果是否冲突 |

状态枚举固定为五档：`已验证 / 部分 / 证据不足 / 冲突 / 无法验证`。每维输出 `{status, evidence_refs[], verifier_type, last_checked_at, reason}`。明确规则：任一维为"无法验证"不得被其他维的"已验证"抵消；"冲突"必须能一键跳转到 A 的证据链冲突节点。展示上允许雷达图，但**不得出现总分**。

**【术语一致性，research-standards 建议】** 对外措辞采用 ACM v1.1 + NISO 术语：**Repeatability**（同团队同装置）/ **Reproducibility**（异团队同装置、用作者工件）/ **Replicability**（异团队异装置、独立工件）；并把"材料可用 Available / 工件已评估 Functional·Reusable / 结果已验证 Reproduced·Replicated"当作**正交维度**而非单一序列。本表的"实验可重复"≈Repeatability、"结果可复现"≈Reproducibility，"与论文一致"是独立于三者的审计维度，不得混用；借鉴 ACM 框架 ≠ 获得 ACM 认证，所有结论限定 ReproCheck 自身验证范围内。

### 5.3 C. 标准化交接包（研究 RO-Crate / W3C PROV-O 后设计）
**【事实】** 现有交接 ZIP 仅含本人项目元数据+事实清单+README，逐文件 sha256、Zip Slip 防护；导入为 `validated_not_applied`。不含论文/代码/配置/数据/环境/报告/日志/结果/未解决问题/修复历史。Zenodo 已有 DataCite DOI 与 OAI-PMH；Code Ocean capsule 已有 DOI + 不可变 Lineage Graph（来源见第 2 节）。

**【规范事实，research-standards 提供，术语与其报告 `docs/STAGE9_ACADEMIC_STANDARDS_RESEARCH.md` 一致】**
- **W3C PROV-O**：<https://www.w3.org/TR/prov-o/>，2013-04-30 W3C Recommendation，命名空间 `http://www.w3.org/ns/prov#`；核心类 `prov:Entity` / `prov:Activity` / `prov:Agent`；起步属性 `wasGeneratedBy`（Entity→Activity）、`used`（Activity→Entity）、`wasAttributedTo`（Entity→Agent）、`wasDerivedFrom`（Entity→Entity）；活动链 `wasInformedBy`、代理链 `wasAssociatedWith` / `actedOnBehalfOf`。复杂场景用 `qualifiedGeneration` / `qualifiedUsage` / `qualifiedDerivation` 等承载时间、角色、计划；消费端应把 qualified 视为蕴含 unqualified。
- **RO-Crate 1.1**：<https://www.researchobject.org/ro-crate/1.1/>（永久标识 <https://w3id.org/ro/crate/1.1>），2023-04-26 Recommendation，DOI `10.5281/zenodo.7867028`；以 JSON-LD（<https://w3id.org/ro/crate/1.1/context>）把研究数据+元数据打包成可寻址 research object，根实体为 `ro-crate-metadata.json`，含 DataEntity 与上下文实体（人/组织/许可），关键词遵循 RFC 2119。
- **分工与类型**：RO-Crate 负责"打包与描述"，PROV-O 负责"过程溯源"，两者互补；`SoftwareSourceCode` 是 schema.org 类型，经 RO-Crate 的 `@context` 复用，应写作 `schema:SoftwareSourceCode`，而非 RO-Crate 自创类型。
- **DataCite**：<https://datacite.org/>，会员制非营利组织，提供 DOI 注册 + 元数据 schema，与 Crossref/ORCID 互操作，支撑 FAIR 的 F1（持久标识）、F2/F3（丰富元数据）、R1.1（许可）；Zenodo 的 DOI 即由其注册。
- **CASRAI / CRediT**：<https://casrai.org/>，CRediT 14 类贡献角色（含 Data curation / Software / Validation），2020 年移交 NISO，标准号 ANSI/NISO Z39.104-2022，可表达"谁对数据/代码/验证负责"，对应 PROV-O 的 Agent + `wasAttributedTo`。

**【建议】** 把交接包升级为"RO-Crate 1.1 元数据 + PROV-O 溯源图 + 现有 ZIP 作为传输层"：
- 根对象为 RO-Crate 1.1 JSON-LD；论文 PDF → DataEntity 带 page anchor；代码 → `schema:SoftwareSourceCode` 带 commit SHA 与 line anchor；数据 → DataEntity 带 checksum 与版本；配置 → `File`/DataEntity。
- 每次运行 → `prov:Activity`；结果指标 → `prov:Entity`，用 `prov:wasGeneratedBy` 指向 run；输入数据/配置经 `prov:used` 接入；结果对数据/配置的关系用 `prov:wasDerivedFrom`；Agents 区分 `prov:Person`（人工复核者）、软件 Agent（程序验证）、LLM Agent（AI 抽取），用 `prov:wasAssociatedWith` + `prov:hadRole`（CRediT 角色）标注责任；`qualifiedGeneration` / `qualifiedUsage` 承载时间、角色、计划与 `verifier_type`——这与 A 方向的 `verifier_type` 天然对齐。
- 交接包内嵌 `verification-manifest.json`：逐 claim 列出七维状态、证据锚点、复核人、时间戳、未解决问题清单与修复历史。
- 保留现有 `validated_not_applied` 导入语义：先校验 crate 结构、JSON-LD context、sha256 与 schema，**不写库**，避免覆盖生产数据。
- 出口协同：交接包可原样 deposit 到 Zenodo/OSF，由 DataCite 注册 DOI，回存 DOI 到证据链；ReproCheck 自建"归档库"是重复造轮子。
- **合规红线**：借鉴 ACM/NISO 术语与 RO-Crate/PROV-O 规范 ≠ 获得任何认证；所有结论限定"ReproCheck 自身验证范围内"。规范细节以 research-standards 的报告为准，本建议不替代规范原文。

### 5.4 D. 与 GitHub/MLflow/DVC/OpenML/Jupyter/Zenodo 协同而非重造
**【事实】** 现有连接器仅 PAT 静态令牌（`auth_type` 无 OAuth 流程），真实取远端 commit sha+message；无克隆/diff/tag，`default_branch` 硬编码为空，`version_diff_json` 实际是 `{"status":"synced","message":<commit message>}`（名为 diff 实非 diff）；notebook 只读解析；交接包算 sha256；验证引擎不执行代码。代码实证位置：`repository_service.py:23`（providers）、`:57-64`（PAT 默认）、`:117-146`（仅 commits 端点）、`:126/136/145`（default_branch 空）、`:188`（version_diff_json 内容）；完整集成可行性矩阵见 research-github 的内部报告 `docs/STAGE9_GITHUB_RESEARCH.md`。

**【建议】** 明确"谁是真源、ReproCheck 存什么"的边界表：

| 外部系统 | 真源领域 | ReproCheck 只做 | 明确不做 |
|---|---|---|---|
| GitHub/GitLab/Gitee | 代码与版本 | 存 commit SHA+message、白名单仓库快照、代码行锚点；**先补 default_branch 与 tag 的真实读取，再谈 diff 引用** | 不做代码托管、不做全量克隆；当前仅 PAT，OAuth 是后续项 |
| DVC | 数据版本 | 读 `.dvc` 文件 md5/etag/checksum 与 `deps.repo.rev_lock`（跨仓库 commit 锁定），绑定数据版本到证据链 | 不做数据存储后端 |
| MLflow | run/metrics/模型 | 通过 Tracking API（Python/REST/R/Java）读 run 参数与指标，作为"外部 run 证据"；新 URI 用 `models:/<model_id>` | 不做实验追踪器 |
| OpenML | 数据集/任务/标准评估 | 引用 dataset/task/flow/run ID（`get_task` 冻结划分）、标准评估流程与 `openml_url` 永久链接 | 不做基准榜单 |
| Jupyter/Binder | 交互式 notebook 与环境 | 细胞级只读解析；把 commit 锁定的 Binder URL 作为"一键复现凭证"写入交接包 | 不做执行环境 |
| Zenodo/OSF | 长期归档与 DOI | 导出交接 crate 获取 DOI，回存 DOI 到证据链 | 不做归档库 |

原则：ReproCheck 存的是**引用 + 哈希 + 按需抓取的快照 + 审计结论**，不是副本。**"自带运行"（bring-your-own-run）**是关键设计——用户把 Code Ocean capsule / MLflow run / Nextflow trace 的产出导入，ReproCheck 只验证其与论文主张的一致性。这样既绕开"无 Docker/不能执行代码"的硬缺口，又不与执行平台正面竞争。

### 5.5 E. 研究可信度与人工复核闭环
**【事实】** 现有 feedback_service 已实现 创建反馈→分诊(`triaged/resolved/disputed`)→争议转人工 ReviewRequest→审计轨迹；确定性诊断 `is_confirmed=false`；基准案例有人工验证与质量评估；误报反馈不直接改生产规则。

**【建议】**
1. 补全完整状态链：`接受 / 质疑 / 补充证据 / 重新检查 / 复核报告 / 已结案`，每步不可篡改留痕（保留修改前后内容、操作人、时间、依据证据锚点）。
2. 三类判定**强制可视化区分**：AI 抽取（推测）、程序验证（确定性）、人工确认（复核）；结论页顶部显示"本结论含几处 AI 推测 / 几处程序验证 / 几处人工确认"，而非单一真假。
3. 误报反馈进入**离线规则评估**而非在线学习；生产规则变更必须走版本/测试样例/回滚流程（与 USER_NEEDS_ANALYSIS 方向三一致）。
4. 对审稿人提供"证据充分性"视图：列出每条结论的支撑证据数量、状态与缺口，允许"证据不足"作为正当输出，不用沉默代替不确定。
5. 可信度管理对接外部徽章/DOI：复核完成的交接包可 deposit 到 Zenodo，由 DataCite 注册 DOI；但**"已复核"徽章只能由人工确认触发**，AI 不得自动升级质量等级。
6. 复核人责任用 **CRediT 角色**（Data curation / Software / Validation 等）显式标注，对应 PROV-O 的 Agent + `wasAttributedTo`（标准号 ANSI/NISO Z39.104-2022，research-standards 提供）；让"谁对数据/代码/验证负责"在交接包中可机读。

---

## 6. 【分析】风险与不可冒称事项

1. **不得宣称替代执行平台**：无隔离执行、无 Docker；"代码可执行""环境可构建"必须标"无法验证"，除非接外部 run 证据。
2. **不得宣称图表已精确复核**：OCR/重绘未实现；只能说文本/数值层核对。
3. **不得宣称发现真实论文问题**：演示为合成材料；真实模型/论文验证为 0。
4. **不得宣称节省真实时间或有留存价值**：无试点数据；所有用户假设未验证。
5. **不得把 Papers with Code 当活跃竞品**：原站 2025 年已关停；引用须标注二手来源与静态快照事实。
6. **避免单一 score**：任何排行榜式呈现都会与"证据不足/无法验证"的诚实原则冲突，也是 PwC 关停暴露的生态脆弱点。

---

## 7. 来源清单（全部真实 URL，调研日期 2026-11-19）

**MLflow**
- [ML1] MLflow Tracking：<https://mlflow.org/docs/latest/ml/tracking/>
- [ML2] MLflow Projects：<https://mlflow.org/docs/latest/ml/projects/>
- [ML0] MLflow Documentation 首页：<https://mlflow.org/docs/latest/index.html>

**DVC**
- [DV1] DVC Get Started：<https://dvc.org/doc/start>
- [DV2] Data versioning：<https://dvc.org/doc/start/data-management/data-versioning>
- [DV3] Experiment Management：<https://dvc.org/doc/user-guide/experiment-management>

**Code Ocean**
- [CO1] 官网产品页：<https://www.codeocean.com/>
- [CO2] 高校方案页：<https://www.codeocean.com/solutions/universities/>
- [CO3] Publishing on Code Ocean（DOI/校验）：<https://docs.codeocean.com/osl-guide/publishing-on-code-ocean/publishing-on-code-ocean-an-overview>
- [CO4] OSL 新闻稿（期刊/3000+ capsule）：<https://codeocean.com/press-releases/press-release/code-ocean-announces-open-science-library-allowing-no-cost-turn-key-replication-of-computational-science-experiments>

**Weights & Biases**
- [WB1] W&B（CoreWeave Docs）：<https://docs.coreweave.com/products/wandb>
- [WB2] Forge Home：<https://docs.coreweave.com/forge-home>

**OpenML**
- [OM1] OpenML 首页（规模/功能计数）：<https://www.openml.org/>
- [OM2] OpenML APIs：<https://www.openml.org/apis>

**Papers with Code（二手来源，原站已关停）**
- [PWC1] Coursera：What Happened to Papers With Code：<https://de.coursera.org/articles/papers-with-code>
- [PWC2] Unknown Observer：Meta 关停到 HF Apache-2.0 重建：<https://unknownobserver.com/posts/papers-with-code-shutdown-to-open-source>
- [PWC3] 百度百科（中文时间线）：<https://baike.baidu.com/item/Papers%20with%20Code/69513858>
- [PWC4] SciSpace：Trending Papers API 替代说明：<https://scispace.com/guides/papers-with-code-trending-papers-api>

**Hugging Face Hub**
- [HF1] Hub 官方文档：<https://huggingface.co/docs/hub>
- [HF2] Hub 文档镜像（中文）：<http://hugging-face.cn/docs/hub>

**Snakemake / Nextflow**
- [SM1] Snakemake 官方文档：<https://snakemake.readthedocs.io/en/stable/>
- [NF1] Nextflow 官方（Seqera）文档：<https://docs.seqera.io/nextflow>

**Zenodo / OSF**
- [ZD1] Zenodo Developers 文档：<https://developers.zenodo.org/>
- [OSF1] OSF 官网：<https://osf.io>
- [OSF2] OSF Dictionary（注册/预注册定义）：<https://help.osf.io/article/339-osf-dictionary>
- [OSF3] COS 的 OSF 产品页：<https://cos.io/our-products/osf/>

**Jupyter/Binder、Sacred、DataLad**
- [JB1] Binder 文档：<https://mybinder.readthedocs.io/en/latest/>
- [JB2] Binder 可复现性教程：<https://mybinder.readthedocs.io/en/latest/tutorials/reproducibility.html>
- [SA1] Sacred 文档：<https://sacred.readthedocs.io/en/stable/>
- [DL1] DataLad 官方文档：<https://docs.datalad.org/en/stable/>

**research-github 代码实证补充的官方来源**
- [DV4] DVC 新仓库（原 iterative/dvc 已迁）：<https://github.com/treeverse/dvc>

**research-standards 提供的规范来源**
- [PROV1] W3C PROV-O（Recommendation）：<https://www.w3.org/TR/prov-o/>
- [ROC1] RO-Crate 1.1（Recommendation）：<https://www.researchobject.org/ro-crate/1.1/>；永久标识 <https://w3id.org/ro/crate/1.1>；DOI `10.5281/zenodo.7867028`
- [ROC2] RO-Crate JSON-LD context：<https://w3id.org/ro/crate/1.1/context>
- [DC1] DataCite：<https://datacite.org/>
- [CAS1] CASRAI（含 CRediT，ANSI/NISO Z39.104-2022）：<https://casrai.org/>

**research-github 提供的仓库地址与许可证（可复用事实清单；许可证影响"协同而非重造"的合规判断）**
- DVC：<https://github.com/treeverse/dvc>，Apache-2.0（旧 `iterative/dvc` 会 301）
- MLflow：<https://github.com/mlflow/mlflow>，Apache-2.0
- W&B SDK：<https://github.com/wandb/wandb>，MIT（云服务闭源）
- OpenML-Python：<https://github.com/openml/openml-python>，BSD-3-Clause（GitHub API 曾误报 NOASSERTION，已核 LICENSE 原文）
- HF Transformers：<https://github.com/huggingface/transformers>，Apache-2.0（模型权重许可另计）
- repo2docker：<https://github.com/jupyterhub/repo2docker>，BSD-3-Clause（旧 `jupyter/` 迁来）

**交叉引用（团队内部报告，非公开网页来源）**
- research-github：`docs/STAGE9_GITHUB_RESEARCH.md`（集成可行性矩阵 SDK/REST/CLI + 许可注意事项）；其连接器代码实证已回填到本报告 §1、§2、§5.4。
- research-standards：`docs/STAGE9_ACADEMIC_STANDARDS_RESEARCH.md`（ACM v1.1/NISO 术语、FAIR、RO-Crate/PROV-O/DataCite/CASRAI）；其规范事实已回填到本报告 §5.2、§5.3、§5.5。

---

## 8. 待回填事项（不阻塞本报告，但需在第九阶段结束前完成）
1. ~~research-standards 的 RO-Crate / PROV-O / DataCite 权威 URL 与字段术语，回填到 §5.3。~~ **已完成**：research-standards 已提供规范权威 URL 与术语，回填到 §5.2（Repeatability/Reproducibility/Replicability 与正交维度）、§5.3（PROV-O 核心类/属性、RO-Crate 1.1 JSON-LD、`schema:SoftwareSourceCode`、DataCite、CRediT）、§5.5（CRediT 责任标注）与 §7（[PROV1]/[ROC1]/[ROC2]/[DC1]/[CAS1]）。
2. ~~research-github 的 GitHub 连接器/OAuth 事实核对，回填到 §5.4。~~ **已完成**：research-github 已提供代码级实证（仅 PAT 无 OAuth、commit sha+message、无 clone/diff/tag、default_branch 空、version_diff_json 非真实 diff），并回填到 §1、§2、§5.4；外部工具更正（DVC 迁 treeverse、HF revision/base_model、MLflow models:/ URI、Binder commit 锁定 URL、OpenML run.publish、W&B SDK MIT/云闭源）已并入对应小节。
3. 若需把"论文解析"评级从"未解决"上调，必须先有真实论文的页码级解析实测，不得凭宣传材料上调。
