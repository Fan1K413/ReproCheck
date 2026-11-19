# ReproCheck Stage 10 — 真实科研项目基准测试集

**版本**：v1.0  
**日期**：2026-11-19  
**项目总数**：20（ML/DL × 5, CV × 5, NLP × 5, BioInfo × 5）  
**来源**：WebSearch 交叉验证 GitHub / arXiv / ACL Anthology / Nature 官方页面  
**许可证**：每个项目的原始代码/数据有各自许可证，此处元数据为学术研究用途收集

---

## 项目索引

### ML/DL（5 项）

| ID | 论文 | 会议 | 年份 | GitHub | 可复现难度 |
|---|---|---|---|---|---|
| ML-01 | Scaling Data-Constrained Language Models | NeurIPS (杰出论文Runner-Up) | 2023 | huggingface/datablations | 🔴 极高 |
| ML-02 | LLaVA: Visual Instruction Tuning | NeurIPS (Oral) | 2023 | haotian-liu/LLaVA | 🟡 中 |
| ML-03 | ClimaX: Foundation Model for Weather | ICML | 2023 | microsoft/ClimaX | 🔴 极高 (已归档) |
| ML-04 | Magicoder: OSS-Instruct Code Gen | ICML | 2024 | ise-uiuc/magicoder | 🟢 低 |
| ML-05 | VideoMAE: MAE for Video SSL | NeurIPS (Spotlight) | 2022 | MCG-NJU/VideoMAE | 🟡 中 |

### CV（5 项）

| ID | 论文 | 会议 | 年份 | GitHub | 可复现难度 |
|---|---|---|---|---|---|
| CV-01 | DINO: DETR with Improved DeNoising Anchor | ICLR | 2022 | IDEACVR/DINO | 🔴 极高 |
| CV-02 | Mask DINO: Unified Detection + Segmentation | CVPR (Highlight) | 2023 | IDEA-Research/MaskDINO | 🔴 极高 |
| CV-03 | Grounding DINO: Open-Set Detection | ECCV (Oral) | 2024 | IDEA-Research/GroundingDINO | 🟡 中 |
| CV-04 | SAM: Segment Anything | ICCV (Oral) | 2023 | facebookresearch/segment-anything | 🟡 中 |
| CV-05 | RT-DETR: DETRs Beat YOLOs | CVPR (Oral) | 2024 | lyuwenyu/RT-DETR | 🟢 低 |

### NLP（5 项）

| ID | 论文 | 会议 | 年份 | GitHub | 可复现难度 |
|---|---|---|---|---|---|
| NLP-01 | FLARE: Active Retrieval Augmented Gen | EMNLP | 2023 | jzbjyb/FLARE | 🟡 中 |
| NLP-02 | NoMIRACL: Multilingual RAG Robustness | EMNLP Findings | 2024 | project-miracl/nomiracl | 🟢 低 |
| NLP-03 | SWIM-IR: LLM-Synthesized Retrieval Data | NAACL | 2024 | google-research-datasets/SWIM-IR | 🔴 极高 |
| NLP-04 | PopQA: When Not to Trust LMs | ACL | 2023 | AlexTMallen/adaptive-retrieval | 🟡 中 |
| NLP-05 | SPAR: Salient Phrase Aware Dense Retrieval | EMNLP Findings | 2022 | facebookresearch/dpr-scale/tree/main/spar | 🔴 极高 |

### BioInfo/SciComp（5 项）

| ID | 论文 | 期刊/会议 | 年份 | GitHub | 可复现难度 |
|---|---|---|---|---|---|
| BIO-01 | AlphaFold 3: Biomolecular Interactions | Nature | 2024 | google-deepmind/alphafold3 | 🔴 极高 |
| BIO-02 | RFdiffusion: De Novo Protein Design | Nature | 2023 | RosettaCommons/RFdiffusion | 🟠 中高 |
| BIO-03 | scGPT: Single-Cell Multi-omics FM | Nature Methods | 2024 | bowang-lab/scGPT | 🟡 中 |
| BIO-04 | OpenProteinSet + OpenFold | NeurIPS | 2023 | aqlaboratory/openfold | 🔴 极高 |
| BIO-05 | DrugCLIP: Protein-Molecule Contrastive | NeurIPS | 2023 | bowen-gao/DrugCLIP | 🟢 低 |

---

## 详细元数据（完整版见 JSON 文件 `benchmark_projects_v1.json`）

每个项目在 JSON 中包含以下字段：

```json
{
  "project_id": "ML-01",
  "paper_title": "...",
  "authors": ["..."],
  "year": 2023,
  "venue": "NeurIPS",
  "domain": "ml_dl",
  "arxiv_id": "2305.16264",
  "github_url": "https://github.com/huggingface/datablations",
  "github_license": "Apache 2.0",
  "dataset_url": "...",
  "dataset_license": "...",
  "environment": {
    "os": "Linux",
    "python": "3.11+",
    "cuda": "required",
    "gpu": "A100 80GB (推荐)",
    "framework": "Megatron-DeepSpeed, PyTorch"
  },
  "key_claims": [
    "...",
    "..."
  ],
  "key_metrics": [
    {"metric": "...", "value": "...", "table": "..."}
  ],
  "known_repro_issues": [
    "...",
    "..."
  ],
  "reproducibility_difficulty": "extreme|high|medium|low",
  "local_repro_possible": false,
  "realistic_test_capability": "static_analysis_only|inference_possible|fine_tune_possible|full_train_possible",
  "notes": "..."
}
```

---

## 测试优先级排序

### Tier 1：可真实执行推理的项目（用于完整复现审计）
1. **ML-04 Magicoder** — 7 行代码即可推理，HumanEval+ 70.7 pass@1
2. **BIO-05 DrugCLIP** — 推理即可运行，GPU ≥12GB
3. **CV-05 RT-DETR** — 完整训练+推理，PyTorch 2.0.1
4. **BIO-03 scGPT** — MIT 许可证，Docker 环境

### Tier 2：推理可复现，训练极难（用于审计推理一致性）
5. **ML-02 LLaVA** — LoRA/QLoRA 可降低显存
6. **CV-04 SAM** — 官方预训练权重推理极易
7. **CV-03 Grounding DINO** — Docker 有已知 workaround
8. **ML-05 VideoMAE** — 微调阶段门槛低
9. **BIO-02 RFdiffusion** — 推理秒级

### Tier 3：仅能做静态审计（硬件门槛过高）
10-20. 其余项目（AlphaFold 3, OpenProteinSet, DINO, Mask DINO, ClimaX 等）

---

## ReproCheck 测试场景映射

| ReproCheck 能力 | 适用项目 | 测试方式 |
|---|---|---|
| PDF 解析 + 章节/表格提取 | 全部 20 项 | 上传论文 PDF 解析 |
| 论文主张 → 代码定位 | Tier 1 项目 | 上传 GitHub 代码 zip，静态分析 |
| 配置参数一致性 | ML-04, CV-05, BIO-03 | 对比论文参数与 config.yaml |
| 数据集完整性检查 | CV-01, NLP-01, BIO-03 | 检查 README 声明的数据是否公开 |
| 依赖版本冲突 | 全部 20 项 | 对比 requirements.txt 与 environment.yml |
| 随机种子缺失 | ML-02, ML-05, NLP-03 | 检查代码中是否 set_seed() |
| 实验次数不足 | 全部 20 项 | 检查论文中是否报告 mean±std |
| 真实执行（inference） | Tier 1 项目 | Docker 隔离环境执行 |
| 结果指标核验 | Tier 1 项目 | 对比推理输出与论文表格 |
| 图表反向验证 | CV-01~05 | 论文表格数值与代码输出交叉验证 |

---

## 人工构造问题测试集

为验证 ReproCheck 的问题识别能力，从真实项目中人工植入以下 **15 类问题**（受控副本，不修改原始项目）：

| 编号 | 问题类型 | 植入项目 | 植入方式 | ReproCheck 应识别 |
|---|---|---|---|---|
| P-01 | 论文模型描述 vs 代码实现不一致 | ML-02 LLaVA | 代码中删除一个 attention head | 模型结构差异 |
| P-02 | 论文参数 vs 配置文件不一致 | CV-05 RT-DETR | config.yaml 中把 lr=1e-4 改成 lr=1e-3 | 参数差异 |
| P-03 | 代码引用了不同的数据集 | NLP-01 FLARE | README 声明 WikiAsp，但代码默认 StrategyQA | 数据集引用错误 |
| P-04 | 训练/测试集重叠 | BIO-03 scGPT | mock 数据集中 train 和 test 共享 10% 样本 | 数据泄漏 |
| P-05 | 指标计算方式错误 | CV-04 SAM | mIoU 计算中把 foreground 和 background 混淆 | 指标错误 |
| P-06 | 随机种子缺失 | ML-04 Magicoder | 所有 train.py 中删除 set_seed() | 随机性未控 |
| P-07 | 实验次数不足 | CV-05 RT-DETR | 论文只跑了 1 次就报告结果 | 实验统计不足 |
| P-08 | 依赖版本冲突 | NLP-01 FLARE | requirements.txt 声明 torch==2.1.0 但实际需要 2.0.1 | 版本冲突 |
| P-09 | 代码路径错误 | BIO-02 RFdiffusion | checkpoint 路径用绝对路径 /home/user/... | 路径错误 |
| P-10 | 模型权重缺失 | ML-05 VideoMAE | README 声明需要的预训练权重链接失效 | 工件缺失 |
| P-11 | 实验结果 vs 论文表格不一致 | CV-01 DINO | 运行脚本计算的 AP 值与论文差 5% | 结果冲突 |
| P-12 | 运行环境不完整 | NLP-04 PopQA | 缺少 Elasticsearch 部署文档 | 环境不完整 |
| P-13 | 日志缺失 | BIO-05 DrugCLIP | train.py 中删除所有 logger.info() | 审计轨迹缺失 |
| P-14 | 论文主张无法定位代码 | CV-03 Grounding DINO | 论文声明的算法组件在代码中找不到 | 主张-代码断裂 |
| P-15 | 硬件要求未声明 | ML-03 ClimaX | README 不提需要多少 GPU | 环境信息缺失 |

---

## 许可证合规声明

本基准测试集仅包含元数据（论文标题、作者、GitHub URL、arXiv ID、指标数字），不包含任何代码库快照或数据文件。使用任何原始项目代码或数据时，必须遵守其各自的许可证条款。

具体许可证信息已在每个项目的 JSON 元数据中标注。

---

## 版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-11-19 | 初始版本，20 个项目 |
