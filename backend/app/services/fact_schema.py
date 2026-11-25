"""标准科研事实字段目录与归一化（第六阶段 B 组 · 科研复现基准库）。

设计原则：
1. **原始值永不丢失**：CaseFact 同时保存 raw_field/raw_value 与 normalized_value/unit，
   归一化只用于检索、比对与展示，不覆盖原文证据。
2. **确定性**：全部为纯 Python 规则（别名表 + 数值/单位解析），不调用大模型，
   同一输入永远得到同一输出，可被测试逐条断言。
3. **复用既有比对别名**：第二层程序化校验 app.services.FIELD_ALIASES / NUMERIC_FIELDS
   在此并入别名索引，保证「论文事实比对」与「基准库事实」使用同一套字段口径。
4. **未收录字段不报错**：未知字段降级为 snake_case key + 原文值，标记 is_standard=False，
   避免因为目录未覆盖而丢弃科研信息。

字段目录见 docs/SCIENTIFIC_FACT_SCHEMA.md。
"""
from __future__ import annotations

import math
import re
from typing import Any

from app.services import FIELD_ALIASES, NUMERIC_FIELDS

SCHEMA_VERSION = "stage6-b1"

# 字段类别（顺序即 UI 展示顺序）
CATEGORIES: dict[str, str] = {
    "training_parameter": "训练参数",
    "environment": "运行环境",
    "dataset": "数据集",
    "metric": "评价指标",
}

# value_type 语义：float=连续数值 / int=整数 / ratio=0~1 比例 / version=版本号 /
# enum=受控取值 / string=自由文本
VALUE_TYPES: dict[str, str] = {
    "float": "连续数值",
    "int": "整数",
    "ratio": "比例（0~1）",
    "version": "版本号",
    "enum": "受控取值",
    "string": "文本",
}


def _f(label: str, label_en: str, category: str, unit: str, aliases: list[str],
       value_type: str) -> dict[str, Any]:
    return {"label": label, "label_en": label_en, "category": category,
            "unit": unit, "aliases": aliases, "value_type": value_type}


# 标准字段目录

STANDARD_FIELDS: dict[str, dict[str, Any]] = {
    # 训练参数
    "learning_rate": _f("学习率", "Learning Rate", "training_parameter", "", [
        "lr", "learning rate", "learningrate", "init_lr", "initial_learning_rate",
        "base_lr", "peak_lr", "学习率", "初始学习率"], "float"),
    "batch_size": _f("批大小", "Batch Size", "training_parameter", "samples", [
        "batch size", "batchsize", "batch", "bs", "train_batch_size", "per_device_batch_size",
        "批大小", "批量大小", "批次大小"], "int"),
    "epochs": _f("训练轮数", "Epochs", "training_parameter", "epoch", [
        "epoch", "num_epochs", "num_train_epochs", "training_epochs", "max_epochs",
        "训练轮数", "轮数", "迭代轮数"], "int"),
    "optimizer": _f("优化器", "Optimizer", "training_parameter", "", [
        "optim", "optimizer_name", "optimiser", "优化器", "优化算法"], "enum"),
    "weight_decay": _f("权重衰减", "Weight Decay", "training_parameter", "", [
        "wd", "weight decay", "l2", "l2_regularization", "l2_penalty",
        "权重衰减", "正则化系数"], "float"),
    "random_seed": _f("随机种子", "Random Seed", "training_parameter", "", [
        "seed", "random seed", "rng_seed", "global_seed", "随机种子", "种子"], "int"),
    "momentum": _f("动量", "Momentum", "training_parameter", "", [
        "sgd_momentum", "momentum_coefficient", "动量"], "float"),
    "lr_scheduler": _f("学习率调度", "LR Scheduler", "training_parameter", "", [
        "scheduler", "lr_schedule", "learning_rate_scheduler", "lr_decay",
        "学习率调度", "调度策略", "学习率衰减"], "string"),
    "loss_function": _f("损失函数", "Loss Function", "training_parameter", "", [
        "loss", "loss_fn", "criterion", "objective", "损失函数", "目标函数"], "string"),
    "dropout": _f("Dropout 比例", "Dropout", "training_parameter", "ratio", [
        "drop_rate", "dropout_rate", "drop_path_rate", "丢弃率", "随机失活"], "ratio"),
    "mixed_precision": _f("混合精度", "Mixed Precision", "training_parameter", "", [
        "amp", "fp16", "bf16", "mixed precision", "precision_mode", "混合精度"], "enum"),
    "num_workers": _f("数据加载线程数", "Data Loader Workers", "training_parameter", "threads", [
        "workers", "dataloader_workers", "num_worker", "加载线程数", "数据线程数"], "int"),
    "gradient_accumulation_steps": _f("梯度累积步数", "Gradient Accumulation Steps",
                                      "training_parameter", "steps", [
        "grad_accum", "accumulation_steps", "gradient_accumulation", "梯度累积", "梯度累积步数"], "int"),
    "warmup_epochs": _f("预热轮数", "Warmup Epochs", "training_parameter", "epoch", [
        "warmup", "warmup_steps", "warmup_ratio", "预热轮数", "预热步数"], "float"),

    # 运行环境
    "python_version": _f("Python 版本", "Python Version", "environment", "", [
        "python", "python_ver", "py_version", "python版本"], "version"),
    "pytorch_version": _f("PyTorch 版本", "PyTorch Version", "environment", "", [
        "torch", "torch_version", "pytorch", "pytorch_ver", "torch版本"], "version"),
    "cuda_version": _f("CUDA 版本", "CUDA Version", "environment", "", [
        "cuda", "cuda_ver", "cuda_toolkit", "cuda版本"], "version"),
    "gpu": _f("GPU 型号", "GPU", "environment", "", [
        "gpu_model", "gpu_name", "graphics_card", "accelerator", "hardware",
        "显卡", "显卡型号", "gpu型号", "加速卡"], "string"),
    "operating_system": _f("操作系统", "Operating System", "environment", "", [
        "os", "os_version", "system", "platform", "操作系统", "系统版本"], "string"),
    "cpu": _f("CPU 型号", "CPU", "environment", "", [
        "processor", "cpu_model", "cpu_name", "处理器", "cpu型号"], "string"),
    "memory": _f("内存容量", "Memory", "environment", "GB", [
        "ram", "system_memory", "gpu_memory", "vram", "内存", "显存"], "float"),
    "driver_version": _f("驱动版本", "Driver Version", "environment", "", [
        "nvidia_driver", "driver", "gpu_driver", "显卡驱动", "驱动版本"], "version"),
    "framework": _f("深度学习框架", "Framework", "environment", "", [
        "dl_framework", "library", "toolkit", "框架", "深度学习框架"], "string"),
    "code_commit": _f("代码提交号", "Code Commit", "environment", "", [
        "commit", "git_commit", "commit_sha", "revision", "代码版本", "提交哈希"], "string"),
    "docker_image": _f("容器镜像", "Docker Image", "environment", "", [
        "container_image", "docker", "container", "镜像", "容器镜像"], "string"),

    # 数据集
    "dataset_name": _f("数据集名称", "Dataset Name", "dataset", "", [
        "dataset", "data", "data_name", "corpus", "数据集", "数据集名", "数据集名称"], "string"),
    "dataset_version": _f("数据集版本", "Dataset Version", "dataset", "", [
        "data_version", "dataset_ver", "dataset_release", "数据集版本"], "version"),
    "train_split": _f("训练集划分", "Train Split", "dataset", "", [
        "train", "training_split", "train_size", "train_set", "训练集", "训练集划分"], "string"),
    "validation_split": _f("验证集划分", "Validation Split", "dataset", "", [
        "val", "valid", "val_split", "validation", "dev", "dev_split", "validation_size",
        "验证集", "验证集划分", "开发集"], "string"),
    "test_split": _f("测试集划分", "Test Split", "dataset", "", [
        "test", "test_split", "test_size", "testing_split", "eval_split",
        "测试集", "测试集划分"], "string"),
    "preprocessing_method": _f("预处理方法", "Preprocessing Method", "dataset", "", [
        "preprocessing", "preprocess", "data_augmentation", "augmentation", "normalization",
        "预处理", "预处理方法", "数据增强", "归一化方法"], "string"),
    "num_classes": _f("类别数", "Number of Classes", "dataset", "classes", [
        "classes", "n_classes", "num_class", "class_count", "类别数", "分类数"], "int"),
    "image_size": _f("输入图像尺寸", "Image Size", "dataset", "px", [
        "input_size", "img_size", "resolution", "image_resolution", "crop_size",
        "输入尺寸", "图像尺寸", "分辨率"], "string"),
    "input_shape": _f("输入张量形状", "Input Shape", "dataset", "", [
        "input_dim", "input_dims", "shape", "tensor_shape", "输入形状", "输入维度"], "string"),
    "dataset_size": _f("数据集规模", "Dataset Size", "dataset", "samples", [
        "num_samples", "total_samples", "sample_count", "样本数", "数据量", "数据集规模"], "int"),

    # 评价指标
    "accuracy": _f("准确率", "Accuracy", "metric", "ratio", [
        "acc", "top1", "top-1", "top1_accuracy", "acc@1", "accuracy_rate", "准确率"], "ratio"),
    "precision": _f("精确率", "Precision", "metric", "ratio", [
        "precision_score", "positive_predictive_value", "精确率", "查准率"], "ratio"),
    "recall": _f("召回率", "Recall", "metric", "ratio", [
        "recall_score", "sensitivity", "tpr", "true_positive_rate", "召回率", "查全率"], "ratio"),
    "f1": _f("F1 分数", "F1 Score", "metric", "ratio", [
        "f1_score", "f1-score", "fmeasure", "f1值", "f1 值"], "ratio"),
    "auc": _f("AUC", "AUC", "metric", "ratio", [
        "roc_auc", "auroc", "auc_roc", "area_under_roc", "曲线下面积"], "ratio"),
    "rmse": _f("均方根误差", "RMSE", "metric", "", [
        "root_mean_squared_error", "rms_error", "rmsd", "均方根误差"], "float"),
    "mae": _f("平均绝对误差", "MAE", "metric", "", [
        "mean_absolute_error", "mad", "平均绝对误差"], "float"),
    "top5_accuracy": _f("Top-5 准确率", "Top-5 Accuracy", "metric", "ratio", [
        "top5", "top-5", "acc@5", "top5_acc", "top_5_accuracy"], "ratio"),
    "perplexity": _f("困惑度", "Perplexity", "metric", "", [
        "ppl", "困惑度"], "float"),
    "bleu": _f("BLEU 分数", "BLEU", "metric", "", [
        "bleu_score", "bleu-4", "bleu4"], "float"),
    "psnr": _f("峰值信噪比", "PSNR", "metric", "dB", [
        "peak_signal_noise_ratio", "峰值信噪比"], "float"),
    "ssim": _f("结构相似性", "SSIM", "metric", "ratio", [
        "structural_similarity", "结构相似性"], "ratio"),
    "training_time": _f("训练耗时", "Training Time", "metric", "hours", [
        "train_time", "training_duration", "wall_time", "训练时间", "训练耗时"], "float"),
    "parameter_count": _f("参数量", "Parameter Count", "metric", "params", [
        "params", "num_parameters", "model_size", "n_params", "参数量", "模型参数数"], "int"),
    "inference_latency": _f("推理延迟", "Inference Latency", "metric", "ms", [
        "latency", "inference_time", "infer_time", "推理延迟", "推理耗时"], "float"),
}

# 比例型字段：原文若为百分数（"95.2%" 或 0~100 之间的裸数）统一折算到 0~1
RATIO_FIELDS: set[str] = {k for k, v in STANDARD_FIELDS.items() if v["value_type"] == "ratio"}
# 数值型字段（含第二层比对已定义的 NUMERIC_FIELDS，保证口径一致）
NUMERIC_FIELD_KEYS: set[str] = {
    k for k, v in STANDARD_FIELDS.items() if v["value_type"] in ("float", "int", "ratio")
} | set(NUMERIC_FIELDS)

# 受控取值归一化表
_OPTIMIZERS = {
    "sgd": "SGD", "adam": "Adam", "adamw": "AdamW", "adamax": "Adamax",
    "adagrad": "Adagrad", "adadelta": "Adadelta", "rmsprop": "RMSprop",
    "rms_prop": "RMSprop", "nadam": "Nadam", "radam": "RAdam",
    "lbfgs": "L-BFGS", "l-bfgs": "L-BFGS", "lion": "Lion", "lamb": "LAMB",
    "adafactor": "Adafactor", "shampoo": "Shampoo", "sparseadam": "SparseAdam",
}
_PRECISION = {
    "fp16": "fp16", "float16": "fp16", "half": "fp16", "amp": "fp16", "true": "fp16",
    "yes": "fp16", "on": "fp16", "1": "fp16",
    "bf16": "bf16", "bfloat16": "bf16",
    "fp32": "fp32", "float32": "fp32", "full": "fp32", "no": "fp32", "none": "fp32",
    "false": "fp32", "off": "fp32", "0": "fp32",
    "fp64": "fp64", "float64": "fp64", "double": "fp64",
}
_OS = {
    "ubuntu": "Ubuntu", "debian": "Debian", "centos": "CentOS", "rhel": "RHEL",
    "fedora": "Fedora", "arch": "Arch Linux", "windows": "Windows", "win": "Windows",
    "macos": "macOS", "mac os": "macOS", "osx": "macOS", "darwin": "macOS",
    "linux": "Linux", "unix": "Unix",
}
_DATASETS = {
    "cifar10": "CIFAR-10", "cifar-10": "CIFAR-10", "cifar 10": "CIFAR-10",
    "cifar100": "CIFAR-100", "cifar-100": "CIFAR-100", "cifar 100": "CIFAR-100",
    "imagenet": "ImageNet", "imagenet1k": "ImageNet", "imagenet-1k": "ImageNet",
    "ilsvrc2012": "ImageNet", "ilsvrc-2012": "ImageNet",
    "mnist": "MNIST", "fashionmnist": "Fashion-MNIST", "fashion-mnist": "Fashion-MNIST",
    "kmnist": "KMNIST", "emnist": "EMNIST", "svhn": "SVHN", "stl10": "STL-10",
    "stl-10": "STL-10",
    "coco": "COCO", "mscoco": "COCO", "ms coco": "COCO", "coco2017": "COCO",
    "voc": "PASCAL VOC", "pascalvoc": "PASCAL VOC", "pascal voc": "PASCAL VOC",
    "cityscapes": "Cityscapes", "ade20k": "ADE20K", "kitti": "KITTI",
    "nuscenes": "nuScenes", "modelnet40": "ModelNet40", "modelnet": "ModelNet40",
    "shapenet": "ShapeNet", "scannet": "ScanNet", "s3dis": "S3DIS",
    "kinetics": "Kinetics-400", "kinetics400": "Kinetics-400", "k400": "Kinetics-400",
    "ucf101": "UCF101", "hmdb51": "HMDB51", "audioset": "AudioSet",
    "esc50": "ESC-50", "urbansound8k": "UrbanSound8K", "librispeech": "LibriSpeech",
    "commonvoice": "Common Voice", "common voice": "Common Voice",
    "squad": "SQuAD", "squad1.1": "SQuAD", "squad2": "SQuAD 2.0", "squad2.0": "SQuAD 2.0",
    "glue": "GLUE", "superglue": "SuperGLUE", "sst2": "SST-2", "sst-2": "SST-2",
    "mrpc": "MRPC", "qnli": "QNLI", "cola": "CoLA", "rte": "RTE", "boolq": "BoolQ",
    "multirc": "MultiRC", "wikitext103": "WikiText-103", "wikitext-103": "WikiText-103",
    "wikitext2": "WikiText-2", "wikitext-2": "WikiText-2",
    "imdb": "IMDB", "agnews": "AG News", "ag news": "AG News", "dbpedia": "DBpedia",
    "yelp": "Yelp", "cnn/dailymail": "CNN/DailyMail", "cnndailymail": "CNN/DailyMail",
    "xsum": "XSum", "wmt14": "WMT14", "wmt-14": "WMT14",
    "gsm8k": "GSM8K", "humaneval": "HumanEval", "mbpp": "MBPP", "mmlu": "MMLU",
    "hellaswag": "HellaSwag", "winogrande": "WinoGrande", "truthfulqa": "TruthfulQA",
    "arc-challenge": "ARC-Challenge", "bigbench": "BIG-bench",
    "cora": "Cora", "citeseer": "CiteSeer", "pubmed": "PubMed", "qm9": "QM9",
    "ogbg-molhiv": "OGBG-MOLHIV", "mimiciii": "MIMIC-III", "mimic-iii": "MIMIC-III",
    "mimic": "MIMIC-III", "chestxray14": "ChestX-ray14", "chest x-ray14": "ChestX-ray14",
    "isic": "ISIC", "tcga": "TCGA", "celeba": "CelebA", "ffhq": "FFHQ",
}

# 时间/内存单位换算（换算到字段目录声明的规范单位）
_TO_HOURS = {"h": 1.0, "hr": 1.0, "hrs": 1.0, "hour": 1.0, "hours": 1.0,
             "min": 1 / 60, "mins": 1 / 60, "minute": 1 / 60, "minutes": 1 / 60,
             "s": 1 / 3600, "sec": 1 / 3600, "secs": 1 / 3600, "second": 1 / 3600,
             "seconds": 1 / 3600, "ms": 1 / 3_600_000, "d": 24.0, "day": 24.0, "days": 24.0}
_TO_MS = {"ms": 1.0, "millisecond": 1.0, "milliseconds": 1.0, "s": 1000.0,
          "sec": 1000.0, "second": 1000.0, "seconds": 1000.0, "us": 0.001,
          "µs": 0.001, "μs": 0.001, "min": 60_000.0, "minute": 60_000.0}
_TO_GB = {"gb": 1.0, "g": 1.0, "gib": 1.0, "tb": 1024.0, "t": 1024.0,
          "mb": 1 / 1024, "m": 1 / 1024, "mib": 1 / 1024, "kb": 1 / 1024 ** 2}
_COUNT_SUFFIX = {"k": 1e3, "thousand": 1e3, "m": 1e6, "million": 1e6,
                 "b": 1e9, "billion": 1e9}

_SUPERSCRIPT = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺", "0123456789-+")
_NUM_RE = re.compile(
    r"^([<>~≈=≤≥]?\s*[-+]?(?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)\s*(.*)$"
)
_VERSION_RE = re.compile(r"\d+(?:\.\d+)*(?:[-+][A-Za-z0-9._]+)?")
_SCIENTIFIC_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[x×*]\s*10\s*\^?\s*([-+]?\d+)")


def _slug(raw: str) -> str:
    """字段名归一化为 snake_case 小写 key（保留中文）。"""
    s = (raw or "").strip().lower()
    s = s.translate(_SUPERSCRIPT)
    s = re.sub(r"[\s\-–—/\.]+", "_", s)
    s = re.sub(r"[：:=（）()\[\]{}'\"`]+", "", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s


def _build_alias_index() -> dict[str, str]:
    index: dict[str, str] = {}
    for key, spec in STANDARD_FIELDS.items():
        index[_slug(key)] = key
        index[_slug(spec["label"])] = key
        index[_slug(spec["label_en"])] = key
        for alias in spec["aliases"]:
            index.setdefault(_slug(alias), key)
    # 并入第二层程序化比对的别名口径（batch size / lr / 训练轮数 等）
    for alias, (key, _label) in FIELD_ALIASES.items():
        if key in STANDARD_FIELDS:
            index.setdefault(_slug(alias), key)
    index.pop("", None)
    return index


ALIAS_INDEX: dict[str, str] = _build_alias_index()


def normalize_field(raw_field: str) -> str:
    """任意写法字段名 -> 标准 field_key；未收录字段返回 snake_case 原文 key。

    例："lr" / "Learning Rate" / "学习率" -> learning_rate；
        "F1 (macro)" -> f1；"Batch-Size" -> batch_size。
    """
    text = (raw_field or "").strip()
    if not text:
        return ""
    key = _slug(text)
    if key in ALIAS_INDEX:
        return ALIAS_INDEX[key]
    # 去掉括注限定（"f1 (macro)" / "accuracy（%）"）后再查一次
    without_paren = re.sub(r"[（(][^）)]*[）)]", "", text).strip()
    key2 = _slug(without_paren)
    if key2 and key2 in ALIAS_INDEX:
        return ALIAS_INDEX[key2]
    # 去掉尾部单位（"accuracy %" / "training_time h"）
    key3 = re.sub(r"[_\s]*(%|percent|ratio|hours?|hrs?|ms|samples?|epochs?)$", "", key2 or key)
    if key3 and key3 in ALIAS_INDEX:
        return ALIAS_INDEX[key3]
    return key or key2 or _slug(text)


def field_spec(field_key: str) -> dict[str, Any] | None:
    return STANDARD_FIELDS.get(field_key)


def field_label(field_key: str) -> str:
    spec = STANDARD_FIELDS.get(field_key)
    return spec["label"] if spec else field_key


def is_standard_field(field_key: str) -> bool:
    return field_key in STANDARD_FIELDS


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def _fmt_number(x: float, as_int: bool = False) -> str:
    """稳定的数值字符串：整数去小数，极小值展开为十进制，避免 1e-05 之类歧义。"""
    if not math.isfinite(x):
        return str(x)
    if as_int and float(x).is_integer():
        return str(int(x))
    if x == 0:
        return "0"
    if abs(x) < 1e-4:
        s = f"{x:.12f}".rstrip("0").rstrip(".")
        return s or "0"
    if abs(x) >= 1e15:
        return f"{x:.10g}"
    s = f"{x:.10g}"
    if "e" in s or "E" in s:  # .10g 仍给出指数时展开为十进制
        s = f"{x:.12f}".rstrip("0").rstrip(".")
    return s


def _parse_number(raw: str) -> tuple[float | None, str]:
    """解析数值前缀，返回 (数值, 剩余单位文本)。支持科学计数法与 ×10^n。"""
    s = _clean_text(raw).translate(_SUPERSCRIPT)
    s = _SCIENTIFIC_RE.sub(lambda m: f"{m.group(1)}e{m.group(2)}", s)
    s = s.replace(",", "") if re.match(r"^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$", s) else s
    m = _NUM_RE.match(s)
    if not m:
        return None, s
    num_part = re.sub(r"^[<>~≈=≤≥]\s*", "", m.group(1)).strip()
    try:
        return float(num_part), _clean_text(m.group(2))
    except ValueError:
        return None, s


def _normalize_version(raw: str) -> str:
    s = _clean_text(raw)
    m = _VERSION_RE.search(s)
    return m.group(0) if m else s


def _normalize_gpu(raw: str) -> str:
    s = _clean_text(raw)
    tokens = []
    for tok in s.split(" "):
        low = tok.lower().strip(",;")
        fixed = {"nvidia": "NVIDIA", "geforce": "GeForce", "rtx": "RTX", "gtx": "GTX",
                 "tesla": "Tesla", "quadro": "Quadro", "a100": "A100", "a6000": "A6000",
                 "v100": "V100", "h100": "H100", "h800": "H800", "a800": "A800",
                 "t4": "T4", "p100": "P100", "p40": "P40", "k80": "K80",
                 "cpu": "CPU", "gpu": "GPU", "ti": "Ti", "super": "SUPER",
                 "amd": "AMD", "radeon": "Radeon", "instinct": "Instinct", "mi250": "MI250",
                 "apple": "Apple", "m1": "M1", "m2": "M2", "m3": "M3", "mps": "MPS"}.get(low)
        tokens.append(fixed or tok)
    return " ".join(tokens)


def _normalize_os(raw: str) -> str:
    s = _clean_text(raw)
    low = s.lower()
    for prefix, canonical in _OS.items():
        if low == prefix or low.startswith(prefix + " "):
            rest = s[len(prefix):].strip()
            return f"{canonical} {rest}".strip()
    return s


def _normalize_dataset(raw: str) -> str:
    s = _clean_text(raw)
    key = s.lower().replace("_", "-").strip()
    if key in _DATASETS:
        return _DATASETS[key]
    compact = key.replace("-", "").replace(" ", "")
    for alias, canonical in _DATASETS.items():
        if alias.replace("-", "").replace(" ", "") == compact:
            return canonical
    return s


def _normalize_ratio(x: float, had_percent: bool) -> float:
    """比例字段统一折算到 0~1：显式 % 或 1<值<=100 的裸数视为百分数。"""
    if had_percent:
        return x / 100.0
    if 1.0 < x <= 100.0:
        return x / 100.0
    return x


def normalize_value(field_key: str, raw_value: Any) -> tuple[str, str]:
    """归一化字段值，返回 (normalized_value, unit)。原始值由调用方另行保存。

    - 数值字段：解析科学计数法/千分位/单位后缀，输出稳定十进制字符串。
    - 比例字段（accuracy/f1/dropout 等）：百分数折算为 0~1，unit=ratio。
    - 版本字段：抽取版本号主体（"Python 3.10.12" -> "3.10.12"）。
    - 受控字段：optimizer/mixed_precision 归一到规范拼写。
    - 名称字段：dataset_name/gpu/operating_system 归一到规范写法。
    - 未收录字段：仅做空白归一化，unit 为空，绝不丢值。
    """
    if raw_value is None:
        return "", ""
    if isinstance(raw_value, bool):
        raw_value = "true" if raw_value else "false"
    text = _clean_text(str(raw_value))
    spec = STANDARD_FIELDS.get(field_key)
    if not text:
        return "", (spec["unit"] if spec else "")
    if spec is None:
        return text, ""

    unit = spec["unit"]
    vtype = spec["value_type"]

    if vtype == "version":
        return _normalize_version(text), unit
    if vtype == "enum":
        low = text.lower()
        if field_key == "optimizer":
            return _OPTIMIZERS.get(low.replace("-", "").replace("_", ""), _clean_text(text)), unit
        if field_key == "mixed_precision":
            return _PRECISION.get(low, low), unit
        return text, unit
    if vtype == "string":
        if field_key == "dataset_name":
            return _normalize_dataset(text), unit
        if field_key == "gpu":
            return _normalize_gpu(text), unit
        if field_key == "operating_system":
            return _normalize_os(text), unit
        if field_key in ("train_split", "validation_split", "test_split"):
            num, rest = _parse_number(text)
            if num is not None:
                if rest == "%" or (not rest and 0 < num <= 100 and "." in text):
                    return _fmt_number(num / 100.0), "ratio"
                if not rest:
                    return _fmt_number(num, as_int=True), "samples"
            return text, unit
        return text, unit

    # 数值型（float / int / ratio）
    num, rest = _parse_number(text)
    if num is None:
        return text, unit  # 无法解析（如 "cosine annealing"）时保留原文
    had_percent = rest.startswith("%") or rest.lower() in ("percent", "pct")
    # 计数型字段的 K/M/B 后缀（"25.6M" 参数量 -> 25600000）
    if field_key in ("parameter_count", "dataset_size") and rest.lower() in _COUNT_SUFFIX:
        return _fmt_number(num * _COUNT_SUFFIX[rest.lower()], as_int=True), unit
    if rest and not had_percent:
        low = rest.lower().rstrip(".")
        if unit == "hours" and low in _TO_HOURS:
            num *= _TO_HOURS[low]
        elif unit == "ms" and low in _TO_MS:
            num *= _TO_MS[low]
        elif unit == "GB" and low in _TO_GB:
            num *= _TO_GB[low]
        elif unit == "ratio" and low in ("ratio", "fraction"):
            pass
        elif low in ("samples", "sample", "images", "epochs", "epoch", "steps", "step",
                     "classes", "threads", "params", "px", "db"):
            pass  # 与规范单位同义，直接采用数值
        else:
            return text, unit  # 未知单位：保留原文，避免错误换算
    if vtype == "ratio" or unit == "ratio":
        return _fmt_number(_normalize_ratio(num, had_percent)), "ratio"
    return _fmt_number(num, as_int=(vtype == "int")), unit


def fact_schema_view() -> dict[str, Any]:
    """GET /fact-schema 的响应体：标准字段目录 + 类别 + 归一化规则说明。"""
    fields = []
    for key, spec in STANDARD_FIELDS.items():
        fields.append({
            "field_key": key,
            "label": spec["label"],
            "label_en": spec["label_en"],
            "category": spec["category"],
            "category_label": CATEGORIES[spec["category"]],
            "unit": spec["unit"],
            "value_type": spec["value_type"],
            "value_type_label": VALUE_TYPES[spec["value_type"]],
            "aliases": list(spec["aliases"]),
            "is_numeric": key in NUMERIC_FIELD_KEYS,
        })
    categories = [
        {"key": k, "label": v,
         "field_count": sum(1 for f in fields if f["category"] == k)}
        for k, v in CATEGORIES.items()
    ]
    return {
        "version": SCHEMA_VERSION,
        "total": len(fields),
        "categories": categories,
        "fields": fields,
        "normalization_rules": [
            "字段名大小写/空格/连字符不敏感，别名与中文名统一映射到标准 field_key。",
            "原始 raw_field/raw_value 永久保留，normalized_value 仅用于比对与检索。",
            "数值支持科学计数法（1e-3）、千分位（1,024）与 ×10^n 写法。",
            "比例型指标（accuracy/precision/recall/f1/auc/dropout/ssim）统一折算到 0~1，unit=ratio。",
            "时间/内存按规范单位换算（training_time→hours，inference_latency→ms，memory→GB）。",
            "版本字段抽取版本号主体；dataset_name/gpu/operating_system 归一到规范写法。",
            "未收录字段降级为 snake_case key 并保留原文，is_standard=false，不丢弃信息。",
        ],
    }