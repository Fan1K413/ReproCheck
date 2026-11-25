# Stage 9 Reproduction Audit Fixture

## Abstract
This deliberately small, synthetic paper is used only for end-to-end product auditing. It is not a real research claim.

## Method
We evaluate a deterministic residual summation over eight samples. The seed is 20261123 and the learning rate is 0.001 for 2 epochs with batch size 4.

## Results
The baseline accuracy is 0.750 and the reproduced accuracy is 0.875. The difference is 0.125. The experiment uses the accompanying CSV and Python files.

## Reproduction
Run `python stage9-reproduce.py` with Python 3.11. No network access, credentials, external dataset, or third-party package is required.
