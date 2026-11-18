# 执行沙箱安全（EXECUTION_SANDBOX_SECURITY）

## 1. 最高原则

**绝不在 FastAPI 应用进程直接执行用户上传的代码。** 当前环境无 Rootless Docker / gVisor / Firecracker（实测 docker/podman 均 NOT FOUND），因此**执行能力默认完全禁用**，只提供静态检查与环境分析。不因演示牺牲安全。

## 2. 安全检查清单（设计与实测状态）

| # | 要求 | 实现状态 |
|---|---|---|
| 1 | 每次运行独立工作目录 | 设计预留（执行禁用时不创建） |
| 2 | 独立容器/沙箱 | `execution_backend`，当前 `none` |
| 3 | 禁止特权模式 | 规则设计 + 扫描 `--privileged` |
| 4 | 禁止挂载宿主机敏感目录 | 设计（执行禁用无挂载面） |
| 5 | 禁止 Docker Socket | 设计 |
| 6 | 非 root 用户执行 | 设计（user 参数化） |
| 7 | CPU 上限 | `execution_max_cpu_seconds=120` |
| 8 | 内存上限 | `execution_max_memory_mb=2048` |
| 9 | 磁盘上限 | 配置预留 |
| 10 | 进程数上限 | `execution_max_pids=128` |
| 11 | 执行超时 | `execution_timeout_seconds=300` |
| 12 | 容器生命周期 | 设计（结束即清理） |
| 13 | 默认关闭网络 | `execution_allow_network=false` |
| 14 | 限制可访问文件 | 独立工作目录设计 |
| 15 | 结束清理临时环境 | 设计 |
| 16 | 保留日志/元数据/产物 | 表结构就绪（execution_logs/artifacts） |

**只有 1、4、5、6、9、12、14、15 属于"设计预留但当前无执行器故无法端到端验证"——如实标注，不冒充已实现运行时隔离。**

## 3. 静态安全预检（已实现并测试）

`SecurityPreflight.scan_text()` 程序规则检测：
- `os.system` / `subprocess.*` / `eval` / `exec` / `__import__`
- `rm -rf` / `chmod 777` / 下载执行脚本
- 云元数据地址 `169.254.169.254`、`metadata.google.internal`
- 内网地址（127.0.0.1 / localhost / 10./192.168./172.16-31）
- 不安全反序列化（pickle.load / torch.load weights_only=False）
- 容器安全选项被禁用（--privileged/--no-sandbox）

命中 high 即 `decide()` 返回阻断，理由含具体 source/line/reason。测试 `test_security_preflight_detects_dangerous_script` 验证。

**明确声明**：静态扫描只能降低风险，不能保证绝对安全；AI 可辅助解释风险，但阻断由程序规则决定。

## 4. 环境检测（已实现）

`EnvDetector.detect()` 识别 requirements.txt / pyproject.toml / poetry.lock / Pipfile / environment.yml / conda-lock.yml / Dockerfile / docker-compose.yml / setup.py/cfg，解析 Python/Torch/TensorFlow/CUDA 版本、硬件要求、训练入口，列出缺失项与警告。**不自动升级依赖、不执行命令**，保存原始配置与变更记录（changed_from_original_json）。

## 5. 受控执行接口（当前禁用）

`ExecutionSandbox.create_run()`：
1. 扫描所有材料文本 → findings；
2. 环境检测 → ExecutionEnvironment 落库；
3. `sandbox_available()` 检测后端 → 当前恒 false（ENABLE_CODE_EXECUTION=false + backend=none）；
4. 创建 ReproductionRun，状态 `blocked_no_sandbox`、`execution_enabled=false`、`security_check` 记录完整原因；
5. **不启动任何进程**。

将来若部署 Rootless Docker 并设置 `ENABLE_CODE_EXECUTION=true`、`execution_backend=rootless_docker`，仍需人工授权与完整隔离验证后方可考虑启用，不得自动打开。

## 6. 网络与敏感信息

- 网络默认关闭；`execution_allow_network=false`；
- 云元数据/内网地址静态命中即阻断；
- 执行环境不继承 API Key / DB 密码（设计中；因执行禁用无实际继承面）；
- 密钥仍仅后端 env，前端零接触。

## 7. 已知限制

- 无真实隔离运行时，所有执行相关能力是"接口 + 规则 + 明确禁用"，**没有端到端执行验证**；
- 资源限制清单为配置与设计，未经真实容器验证；
- 不可拿生产环境做攻击测试；安全测试在测试环境用 mock 文本完成。
