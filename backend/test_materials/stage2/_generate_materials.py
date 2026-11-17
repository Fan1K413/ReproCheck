"""生成第二阶段解析器的合成测试材料（全部为合成测试数据）。

运行：.venv/Scripts/python test_materials/stage2/_generate_materials.py
"""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent

SAMPLE_PY = r'''# 合成测试材料：Python 静态解析样例（此文件不会被解析器执行）
import os
import argparse
import torch
from torch import nn

# 模块顶层故意放置的 raise，用于验证 AST 解析绝不执行用户代码
raise RuntimeError("如果用户代码被执行，解析必然失败")

lr = 0.001
batch_size = 64
epochs = 10
weight_decay = 1e-4
seed = 42
optimizer = "adam"
scheduler = "cosine"
num_classes = 10


class SimpleCNN(nn.Module):
    def __init__(self, in_channels=3, num_classes=10):
        super().__init__()
        self.conv = nn.Conv2d(in_channels, 32, 3)
        self.fc = nn.Linear(32, num_classes)

    def forward(self, x):
        return self.fc(self.conv(x))


def train(model, dataloader, epochs=10, lr=0.001):
    opt = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    for epoch in range(epochs):
        print(epoch)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lr", type=float, default=0.001)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--epochs", type=int, default=10)
    args = parser.parse_args()
    train(None, None, epochs=args.epochs, lr=args.lr)


if __name__ == "__main__":
    main()
'''

NOTEBOOK = {
    "cells": [
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": ["# 合成测试 Notebook\n", "这是一个 markdown 说明单元格。"],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "source": ["lr = 0.001\n", "batch_size = 64\n", "print(lr)"],
            "outputs": [],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "source": ["def train(epochs=10):\n", "    return epochs"],
            "outputs": [],
        },
    ],
    "metadata": {"kernelspec": {"name": "python3"}},
    "nbformat": 4,
    "nbformat_minor": 5,
}

CONFIG_YAML = """# 合成测试材料
train:
  epochs: 10
  batch_size: 64
  optimizer:
    name: adam
    lr: 0.001
    weight_decay: 0.0001
  scheduler: cosine
dataset: cifar10
seed: 42
model: resnet18
num_classes: 10
"""

CONFIG_JSON = json.dumps({
    "train": {"lr": 0.001, "batch_size": 64, "epochs": 10},
    "model": "resnet18",
    "seed": 42,
}, ensure_ascii=False, indent=2)

CONFIG_TOML = """# 合成测试材料
[train]
epochs = 10
batch_size = 64
lr = 0.001

[model]
name = "resnet18"
num_classes = 10
"""

REQUIREMENTS = """# 合成测试材料
torch==2.1.0
numpy>=1.24
PyYAML==6.0.3
"""

README = """# 合成测试材料：图像分类复现实验

## 环境安装

pip install -r requirements.txt

## 训练命令

CUDA_VISIBLE_DEVICES=0 python train.py --lr 0.001 --batch-size 64

使用 Adam 优化器，学习率 0.001，batch size 为 64，训练 10 个 epoch。

## 实验结果

Top-1 准确率为 92.5%。
"""

DATA_CSV = """id,learning_rate,batch_size,accuracy,split
1,0.001,64,0.92,train
1,0.001,64,0.92,train
3,,64,0.88,val
4,0.002,32,0.90,test
5,0.002,32,,test
"""

UNSAFE_YAML = """# 合成测试材料：恶意 YAML（safe_load 必须拒绝）
!!python/object/apply:os.system ["echo HACKED"]
"""

BROKEN_PY = """# 合成测试材料：语法错误
def broken(:
    pass
"""


def write_pdf() -> None:
    import fitz

    doc = fitz.open()
    # 第 1 页：标题 + 摘要 + 参数 + 印刷页码
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 60), "Synthetic Reproducibility Paper", fontsize=16)
    page.insert_text((72, 100), "Abstract", fontsize=14)
    page.insert_text(
        (72, 125),
        "This is synthetic test material for the ReproCheck parser.",
        fontsize=11,
    )
    page.insert_text(
        (72, 145),
        "We train with learning rate 0.001 and batch size 64 for 10 epochs.",
        fontsize=11,
    )
    page.insert_text((270, 800), "Page 1", fontsize=10)

    # 第 2 页：章节 + 表格特征 + 印刷页码 "- 2 -"
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 60), "Introduction", fontsize=14)
    page.insert_text((72, 85), "Method: we use Adam optimizer and cosine scheduler.", fontsize=11)
    page.insert_text((72, 120), "epoch | loss | accuracy", fontsize=11)
    page.insert_text((72, 140), "1 0.45 0.80", fontsize=11)
    page.insert_text((72, 160), "2 0.30 0.88", fontsize=11)
    page.insert_text((72, 180), "3 0.25 0.91", fontsize=11)
    page.insert_text((270, 800), "- 2 -", fontsize=10)

    # 第 3 页：实验 + 结果 + 印刷页码
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 60), "Experiment Setup", fontsize=14)
    page.insert_text((72, 85), "Results: the model reaches 92.5% accuracy.", fontsize=11)
    page.insert_text((72, 105), "Discussion: batch size 64 works well.", fontsize=11)
    page.insert_text((270, 800), "Page 3", fontsize=10)

    doc.save(str(HERE / "sample.pdf"))
    doc.close()


def write_xlsx() -> None:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "train"
    ws.append(["id", "lr", "batch_size"])
    ws.append([1, 0.001, 64])
    ws.append([2, 0.002, 32])
    ws.append([2, 0.002, 32])  # 重复行
    ws.append([3, None, 16])  # 缺失值
    wb.save(str(HERE / "sample.xlsx"))
    wb.close()


def main() -> None:
    (HERE / "sample_project.py").write_text(SAMPLE_PY, encoding="utf-8")
    (HERE / "sample.ipynb").write_text(json.dumps(NOTEBOOK, ensure_ascii=False, indent=2), encoding="utf-8")
    (HERE / "config.yaml").write_text(CONFIG_YAML, encoding="utf-8")
    (HERE / "config.json").write_text(CONFIG_JSON, encoding="utf-8")
    (HERE / "config.toml").write_text(CONFIG_TOML, encoding="utf-8")
    (HERE / "requirements.txt").write_text(REQUIREMENTS, encoding="utf-8")
    (HERE / "README.md").write_text(README, encoding="utf-8")
    (HERE / "data.csv").write_text(DATA_CSV, encoding="utf-8")
    (HERE / "unsafe.yaml").write_text(UNSAFE_YAML, encoding="utf-8")
    (HERE / "broken.py").write_text(BROKEN_PY, encoding="utf-8")
    (HERE / "broken.ipynb").write_text("{not valid json", encoding="utf-8")
    (HERE / "empty.md").write_text("", encoding="utf-8")
    write_pdf()
    write_xlsx()

    # 正常 ZIP：用于正常解析测试
    with zipfile.ZipFile(HERE / "bundle_ok.zip", "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.md", README)
        zf.writestr("config.yaml", CONFIG_YAML)
        zf.writestr("requirements.txt", REQUIREMENTS)
        zf.writestr("scripts/train.py", SAMPLE_PY)

    # 恶意 ZIP：含路径穿越条目，用于安全测试
    with zipfile.ZipFile(HERE / "bundle.zip", "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.md", README)
        zf.writestr("../evil.txt", "SYNTHETIC EVIL PAYLOAD - MUST NOT BE EXTRACTED")

    print("合成测试材料已生成于", HERE)


if __name__ == "__main__":
    main()
