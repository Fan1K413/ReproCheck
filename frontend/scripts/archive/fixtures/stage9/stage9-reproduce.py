"""Deterministic Stage 9 audit fixture; performs no I/O outside this directory."""
from __future__ import annotations

import csv
import json
from pathlib import Path

SEED = 20261123
LEARNING_RATE = 0.001
EPOCHS = 2
BATCH_SIZE = 4


def main() -> None:
    source = Path(__file__).with_name("stage9-metrics.csv")
    with source.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    accuracy = sum(int(row["prediction"]) == int(row["label"]) for row in rows) / len(rows)
    print(json.dumps({
        "seed": SEED,
        "learning_rate": LEARNING_RATE,
        "epochs": EPOCHS,
        "batch_size": BATCH_SIZE,
        "samples": len(rows),
        "accuracy": accuracy,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
