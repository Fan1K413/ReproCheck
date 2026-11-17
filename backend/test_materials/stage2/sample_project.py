# 合成测试材料：Python 静态解析样例（此文件不会被解析器执行）
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
