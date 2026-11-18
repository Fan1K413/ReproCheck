"""合成训练脚本（非真实项目）——仅用于 AST 静态解析测试，不得执行。"""
import argparse


def build_parser():
    parser = argparse.ArgumentParser(description="synthetic reproduction sample")
    parser.add_argument("--lr", type=float, default=0.001)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--seed", type=int, default=42)
    return parser


def main():
    args = build_parser().parse_args()
    learning_rate = args.lr
    batch_size = args.batch_size
    seed = args.seed
    print(f"lr={learning_rate} batch={batch_size} seed={seed}")


if __name__ == "__main__":
    main()
