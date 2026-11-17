"""解析器共享的语义标签映射与辅助函数（第二阶段）。

集中放置"原始字段名 -> 语义标签"的映射，供 Python/Config/ZIP 解析器共用，
避免同一个别名表在多处重复维护。
"""
from __future__ import annotations

import re

# 语义标签别名表：规范化后的原始 key -> 统一语义标签
SEMANTIC_ALIASES: dict[str, str] = {
    # 学习率
    "learning_rate": "learning_rate", "lr": "learning_rate",
    "base_lr": "learning_rate", "learningrate": "learning_rate",
    "initial_lr": "learning_rate", "lr_init": "learning_rate",
    # 批大小
    "batch_size": "batch_size", "bs": "batch_size", "batchsize": "batch_size",
    "micro_batch_size": "batch_size", "train_batch_size": "batch_size",
    # 训练轮数
    "epochs": "epochs", "epoch": "epochs", "num_epochs": "epochs",
    "n_epochs": "epochs", "nb_epochs": "epochs", "max_epochs": "epochs",
    "num_epoch": "epochs",
    # 优化器 / 权重衰减 / 动量
    "optimizer": "optimizer", "optim": "optimizer",
    "weight_decay": "weight_decay", "wd": "weight_decay",
    "decay": "weight_decay", "l2": "weight_decay", "l2_penalty": "weight_decay",
    "momentum": "momentum", "beta1": "momentum",
    # 随机种子
    "seed": "seed", "random_seed": "seed", "manual_seed": "seed",
    "rng_seed": "seed", "random_state": "seed",
    # 数据集 / 模型
    "dataset": "dataset", "data": "dataset", "train_dataset": "dataset",
    "dataset_name": "dataset", "data_path": "dataset", "dataset_path": "dataset",
    "model": "model", "arch": "model", "architecture": "model",
    "model_name": "model", "network": "model",
    # 输入 / 序列
    "input_size": "input_size", "input_dim": "input_size", "image_size": "input_size",
    "seq_len": "seq_len", "sequence_length": "seq_len", "max_len": "seq_len",
    "max_length": "seq_len", "max_seq_len": "seq_len",
    "num_classes": "num_classes", "n_classes": "num_classes",
    "num_labels": "num_classes", "classes": "num_classes",
    # 调度 / 预热 / 指标
    "scheduler": "scheduler", "lr_scheduler": "scheduler", "lrscheduler": "scheduler",
    "warmup_steps": "warmup_steps", "warmup": "warmup_steps",
    "warmup_epochs": "warmup_steps", "num_warmup_steps": "warmup_steps",
    "metrics": "metrics", "metric": "metrics", "eval_metric": "metrics",
}

# 需要从原文中识别的运行命令特征（只记录原文，不执行）
RUN_COMMAND_MARKERS = (
    "python train", "python3 train", "pip install", "pip3 install",
    "conda install", "cuda_visible_devices", "torchrun", "python -m",
    "python main", "python run", "bash ", "sh ", "make ", "uv pip",
)


def normalize_key(key: object) -> str:
    """把字段名规范化为小写下划线形式，便于别名匹配。"""
    return re.sub(r"[^a-z0-9]+", "_", str(key).lower()).strip("_")


def semantic_label(key: object) -> str | None:
    """返回原始 key 对应的语义标签；未命中返回 None。"""
    return SEMANTIC_ALIASES.get(normalize_key(key))


def looks_like_run_command(line: str) -> bool:
    """判断一行文本是否像运行/安装命令（仅用于标注，不执行）。"""
    low = line.lower()
    return any(marker in low for marker in RUN_COMMAND_MARKERS)
