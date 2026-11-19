# ReproCheck 第六阶段 · 标准科研事实字段目录（B 组）

> 实现状态：已实现并通过测试（`test_stage6_benchmark.py` 中事实归一化、字段目录、纯函数单测）。
> 单一事实来源：`backend/app/services/fact_schema.py`（`STANDARD_FIELDS`，`SCHEMA_VERSION="stage6-b1"`，共 **50** 个标准字段）。
> 机器可读目录：`GET /api/v1/fact-schema`（认证）。前端表单、字段映射、比对视图一律以该接口为准，不要硬编码别名。
> 与第二阶段 `FACT_SCHEMA.md`（LLM 抽取输出 schema）互补：本文件定义**基准库落库口径与归一化规则**。

## 1. 设计原则

1. **原文永不丢失**：`CaseFact` 同时保存 `raw_field`/`raw_value` 与 `normalized_value`/`unit`。
   归一化只服务于检索、比对与展示，绝不覆盖原文证据。
2. **确定性、可测试**：全部为纯 Python 规则（别名表 + 数值/单位解析），不调用大模型，同输入必同输出。
3. **口径复用**：并入第二层程序化比对的 `app/services/__init__.py::FIELD_ALIASES` 与 `NUMERIC_FIELDS`，
   保证「论文事实比对」与「基准库事实」使用同一套字段口径（`batch size`/`lr`/`训练轮数` 等）。
4. **未收录不报错**：未知字段降级为 snake_case key + 原文值，`is_standard=false`，不丢弃科研信息。
5. **不静默裁剪**：无法解析或单位不明时保留原文（如 `128 per GPU`、`cosine annealing`、`accuracy=120`），
   交由人工核查，而不是猜测换算。

## 2. 字段目录

`value_type` 语义：`float` 连续数值 / `int` 整数 / `ratio` 比例（0~1）/ `version` 版本号 / `enum` 受控取值 / `string` 文本。
单位 `—` 表示无量纲。别名列表为节选，完整别名以 `GET /fact-schema` 为准。

### 训练参数（training_parameter）

| field_key | 中文 | 单位 | 值类型 | 别名示例 |
|---|---|---|---|---|
| `learning_rate` | 学习率 | — | float | lr, learning rate, learningrate, init_lr |
| `batch_size` | 批大小 | samples | int | batch size, batchsize, batch, bs |
| `epochs` | 训练轮数 | epoch | int | epoch, num_epochs, num_train_epochs, training_epochs |
| `optimizer` | 优化器 | — | enum | optim, optimizer_name, optimiser, 优化器 |
| `weight_decay` | 权重衰减 | — | float | wd, weight decay, l2, l2_regularization |
| `random_seed` | 随机种子 | — | int | seed, random seed, rng_seed, global_seed |
| `momentum` | 动量 | — | float | sgd_momentum, momentum_coefficient, 动量 |
| `lr_scheduler` | 学习率调度 | — | string | scheduler, lr_schedule, learning_rate_scheduler, lr_decay |
| `loss_function` | 损失函数 | — | string | loss, loss_fn, criterion, objective |
| `dropout` | Dropout 比例 | ratio | ratio | drop_rate, dropout_rate, drop_path_rate, 丢弃率 |
| `mixed_precision` | 混合精度 | — | enum | amp, fp16, bf16, mixed precision |
| `num_workers` | 数据加载线程数 | threads | int | workers, dataloader_workers, num_worker, 加载线程数 |
| `gradient_accumulation_steps` | 梯度累积步数 | steps | int | grad_accum, accumulation_steps, gradient_accumulation, 梯度累积 |
| `warmup_epochs` | 预热轮数 | epoch | float | warmup, warmup_steps, warmup_ratio, 预热轮数 |

### 运行环境（environment）

| field_key | 中文 | 单位 | 值类型 | 别名示例 |
|---|---|---|---|---|
| `python_version` | Python 版本 | — | version | python, python_ver, py_version, python版本 |
| `pytorch_version` | PyTorch 版本 | — | version | torch, torch_version, pytorch, pytorch_ver |
| `cuda_version` | CUDA 版本 | — | version | cuda, cuda_ver, cuda_toolkit, cuda版本 |
| `gpu` | GPU 型号 | — | string | gpu_model, gpu_name, graphics_card, accelerator |
| `operating_system` | 操作系统 | — | string | os, os_version, system, platform |
| `cpu` | CPU 型号 | — | string | processor, cpu_model, cpu_name, 处理器 |
| `memory` | 内存容量 | GB | float | ram, system_memory, gpu_memory, vram |
| `driver_version` | 驱动版本 | — | version | nvidia_driver, driver, gpu_driver, 显卡驱动 |
| `framework` | 深度学习框架 | — | string | dl_framework, library, toolkit, 框架 |
| `code_commit` | 代码提交号 | — | string | commit, git_commit, commit_sha, revision |
| `docker_image` | 容器镜像 | — | string | container_image, docker, container, 镜像 |

### 数据集（dataset）

| field_key | 中文 | 单位 | 值类型 | 别名示例 |
|---|---|---|---|---|
| `dataset_name` | 数据集名称 | — | string | dataset, data, data_name, corpus |
| `dataset_version` | 数据集版本 | — | version | data_version, dataset_ver, dataset_release, 数据集版本 |
| `train_split` | 训练集划分 | — | string | train, training_split, train_size, train_set |
| `validation_split` | 验证集划分 | — | string | val, valid, val_split, validation |
| `test_split` | 测试集划分 | — | string | test, test_split, test_size, testing_split |
| `preprocessing_method` | 预处理方法 | — | string | preprocessing, preprocess, data_augmentation, augmentation |
| `num_classes` | 类别数 | classes | int | classes, n_classes, num_class, class_count |
| `image_size` | 输入图像尺寸 | px | string | input_size, img_size, resolution, image_resolution |
| `input_shape` | 输入张量形状 | — | string | input_dim, input_dims, shape, tensor_shape |
| `dataset_size` | 数据集规模 | samples | int | num_samples, total_samples, sample_count, 样本数 |

### 评价指标（metric）

| field_key | 中文 | 单位 | 值类型 | 别名示例 |
|---|---|---|---|---|
| `accuracy` | 准确率 | ratio | ratio | acc, top1, top-1, top1_accuracy |
| `precision` | 精确率 | ratio | ratio | precision_score, positive_predictive_value, 精确率, 查准率 |
| `recall` | 召回率 | ratio | ratio | recall_score, sensitivity, tpr, true_positive_rate |
| `f1` | F1 分数 | ratio | ratio | f1_score, f1-score, fmeasure, f1值 |
| `auc` | AUC | ratio | ratio | roc_auc, auroc, auc_roc, area_under_roc |
| `rmse` | 均方根误差 | — | float | root_mean_squared_error, rms_error, rmsd, 均方根误差 |
| `mae` | 平均绝对误差 | — | float | mean_absolute_error, mad, 平均绝对误差 |
| `top5_accuracy` | Top-5 准确率 | ratio | ratio | top5, top-5, acc@5, top5_acc |
| `perplexity` | 困惑度 | — | float | ppl, 困惑度 |
| `bleu` | BLEU 分数 | — | float | bleu_score, bleu-4, bleu4 |
| `psnr` | 峰值信噪比 | dB | float | peak_signal_noise_ratio, 峰值信噪比 |
| `ssim` | 结构相似性 | ratio | ratio | structural_similarity, 结构相似性 |
| `training_time` | 训练耗时 | hours | float | train_time, training_duration, wall_time, 训练时间 |
| `parameter_count` | 参数量 | params | int | params, num_parameters, model_size, n_params |
| `inference_latency` | 推理延迟 | ms | float | latency, inference_time, infer_time, 推理延迟 |

契约要求的 24 个字段（learning_rate…mae）全部覆盖，另补充 26 个复现审计常用字段。

## 3. 字段名归一化 `normalize_field(raw_field) -> field_key`

1. 去首尾空白 → 小写 → 空格/连字符/斜杠/点转 `_` → 去标点（`：:=（）()[]{}'"`）→ 压缩重复 `_`。
2. 查别名索引（标准 key + 中英文 label + 全部别名 + `FIELD_ALIASES`）。
3. 未命中则去掉括注限定再查（`F1 (macro)` → `f1`）。
4. 仍未命中则去掉尾部单位再查（`Accuracy %` → `accuracy`）。
5. 全部未命中 → 返回 snake_case 原文 key（`Custom Metric` → `custom_metric`），落库 `is_standard=false`。

| 输入 | 输出 |
|---|---|
| `lr` / `LR` / `Learning Rate` / ` learning-rate ` / `学习率` | `learning_rate` |
| `Batch Size` / `Batch-Size` / `批大小` | `batch_size` |
| `epoch` / `训练轮数` | `epochs` |
| `acc` / `top1` / `Accuracy %` | `accuracy` |
| `torch` | `pytorch_version` |
| `F1 (macro)` | `f1` |
| ` totally_new_field ` | `totally_new_field` |
| `""` | `""`（路由层拒绝空字段名，422） |
| `---` / `（）` / `...` | `""`（纯标点无法归一化，服务层拒绝，422） |

**入库前的显式校验**（`benchmark_service.add_case_fact`，全部返回 422 `VALIDATION_ERROR`，不静默截断）：
`raw_field` 非空且 ≤120 字符；归一化后的 `field_key` 非空且 ≤80；`raw_value` 非空；
显式 `unit` ≤40；`source_ref` ≤300；`applicable_experiment` ≤200；`source_type` 属于白名单；
`confidence` ∈ [0,1]。上限与 `case_facts` 表列宽一一对应（`String(80/120/40/300/200)`），
`raw_value`/`normalized_value`/`context` 为 `Text`，不设长度上限。

## 4. 值归一化 `normalize_value(field_key, raw_value) -> (normalized_str, unit)`

- **数值解析**：支持科学计数法（`1e-3`/`1E-4`）、千分位（`1,024`）、`×10^n` 与上标（`3×10^-4`）、
  前缀近似符（`~0.001`）；输出稳定十进制字符串（`0.001`、`0.00001`、`1024`），整数字段去掉 `.0`。
- **比例字段**（`value_type=ratio`：accuracy/precision/recall/f1/auc/top5_accuracy/ssim/dropout）：
  显式 `%`/`percent` 或 `1 < 值 ≤ 100` 的裸数按百分数折算到 0~1，`unit="ratio"`；
  `0~1` 原样；`>100` 不折算、不裁剪（保留原值待人工核查）。非比例字段（rmse/mae/bleu…）不做百分数折算。
- **单位换算**（仅对目录声明的规范单位）：`training_time`→hours（s/min/h/d）、
  `inference_latency`→ms（us/ms/s/min）、`memory`→GB（MB/GB/TB）；
  `parameter_count`/`dataset_size` 支持 K/M/B 后缀（`25.6M`→`25600000`）。
  同义单位（samples/epochs/steps/classes/threads/params/px/dB）直接取数值；**未知单位保留原文**。
- **版本字段**：抽取版本号主体（`Python 3.10.12`→`3.10.12`，`torch 2.1.0+cu118`→`2.1.0+cu118`）；无数字则保留原文。
- **受控字段**：`optimizer` 归一拼写（adamw→AdamW、sgd→SGD、rmsprop→RMSprop、lbfgs→L-BFGS…）；
  `mixed_precision` 归一为 `fp16/bf16/fp32/fp64`（true/amp/half→fp16，false/off→fp32）。
- **名称字段**：`dataset_name` 归一常见公开数据集（cifar_10→CIFAR-10、imagenet→ImageNet、squad→SQuAD…，
  自建数据集保留原文）；`gpu` 规范大小写（nvidia geforce rtx 3090→NVIDIA GeForce RTX 3090）；
  `operating_system` 规范前缀（ubuntu 22.04→Ubuntu 22.04）。
- **划分字段**：`train_split` 等，`80%`→`("0.8","ratio")`，`60000`→`("60000","samples")`，`8:1:1` 保留原文。
- **兜底**：`None`→`("", 目录单位)`；布尔→`true/false` 后按类型处理；无法解析的文本原样保留；
  未收录字段仅做空白归一化，`unit=""`。

### 归一化示例（测试逐条断言）

| field_key | raw_value | normalized_value | unit |
|---|---|---|---|
| learning_rate | `1e-3` | `0.001` | — |
| learning_rate | `3×10^-4` | `0.0003` | — |
| batch_size | `1,024` | `1024` | samples |
| epochs | `100.0` | `100` | epoch |
| accuracy | `95.2%` | `0.952` | ratio |
| f1 | `87.5` | `0.875` | ratio |
| accuracy | `120` | `120` | ratio |
| rmse | `95.2` | `95.2` | — |
| training_time | `90 min` | `1.5` | hours |
| parameter_count | `25.6M` | `25600000` | params |
| pytorch_version | `2.1.0+cu118` | `2.1.0+cu118` | — |
| optimizer | `adamw` | `AdamW` | — |
| dataset_name | `cifar_10` | `CIFAR-10` | — |
| learning_rate | `cosine annealing` | `cosine annealing` | — |
| batch_size | `128 per GPU` | `128 per GPU` | samples |

## 5. `GET /fact-schema` 响应结构

```json
{
  "version": "stage6-b1",
  "total": 50,
  "categories": [{"key": "training_parameter", "label": "训练参数", "field_count": 14}],
  "fields": [{
    "field_key": "learning_rate", "label": "学习率", "label_en": "Learning Rate",
    "category": "training_parameter", "category_label": "训练参数",
    "unit": "", "value_type": "float", "value_type_label": "连续数值",
    "aliases": ["lr", "learning rate", "..."], "is_numeric": true
  }],
  "normalization_rules": ["字段名大小写/空格/连字符不敏感…", "比例型指标统一折算到 0~1…"]
}
```

事实落库后的视图（`GET /cases/{id}/facts`）额外返回 `label`/`label_en`/`category`/`category_label`/`is_standard`，
以及 `raw_field`/`raw_value`/`normalized_value`/`unit`/`source_type`/`source_ref`/`context`/`applicable_experiment`/`confidence`。

## 6. 与既有模块的关系

- **第二层比对**（`app/services/__init__.py`）：`values_equal` 对 `NUMERIC_FIELDS` 走数值容差比较，
  其余走字符串归一比较；本目录产出的字符串归一值可直接参与比较（数值串会被解析为 float）。
  两侧都经本目录归一后，单位一致（如 `ratio`），避免因 `95.2%` vs `0.952` 误判冲突。
- **第二阶段抽取**（`FactView.normalized_value: str|int|float|None`）：基准库统一存**字符串**归一值，
  类型信息来自目录 `value_type`；导入抽取事实时按 `field_key` 走同一 `normalize_value` 即可对齐。
- **质量判定**：`environment` 类字段键同时是 `CASE_QUALITY_STANDARD.md` 中「执行验证声明环境」的判定键来源。

## 7. 未实现 / 限制（诚实标注）

- 目录**版本化与自定义扩展端点**未实现：新增字段需改 `STANDARD_FIELDS` 并升 `SCHEMA_VERSION`（无 POST /fact-schema）。
- **区间/多值解析**未实现：`0.9~0.95`、`[0.1, 0.01]`、`top1=95.2/top5=99.1` 保留原文，不拆分为多条事实。
- 单位换算仅覆盖时间/内存/计数后缀；**未覆盖**学习率调度参数、批量与梯度累积的等价换算、
  跨框架版本语义（如 TF↔PyTorch）等复杂情形。
- `CaseFact.source_ref` 为**文本指针**（如 `Table 2`、`configs/x.yaml#L12`），未与 `evidence_chunks` 建外键级联，
  因此基准库事实暂不提供 chunk 级原文跳转（论文侧证据跳转仍由第二阶段证据链负责）。
- 百分数启发式（`1<值≤100` 视为百分数）对**天然大于 1 的比例型指标**不适用；此类指标应使用非 ratio 字段
  （如 perplexity/bleu）或显式带单位提交，避免误折算。
- 未实现字段级**冲突裁决与置信度聚合**（同字段多来源不一致时保留多条，由人工/比对逻辑判定）。