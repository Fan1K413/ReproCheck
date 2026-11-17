# 合成测试材料：图像分类复现实验

## 环境安装

pip install -r requirements.txt

## 训练命令

CUDA_VISIBLE_DEVICES=0 python train.py --lr 0.001 --batch-size 64

使用 Adam 优化器，学习率 0.001，batch size 为 64，训练 10 个 epoch。

## 实验结果

Top-1 准确率为 92.5%。
