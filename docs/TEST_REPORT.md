# 测试报告（第一阶段 + 第二阶段综合）

生成时间：2026-11-17
原则：**只记录真实执行过的测试**，不编造通过率/准确率/性能指标。
本报告为第二阶段更新版：52 项中含第一阶段 17 项回归。

## 1. 测试环境

- Windows 11，Python 3.13（backend venv），Node 22 / npm 10
- 新依赖：PyMuPDF 2.1、PyYAML 6.0.3、openpyxl 3.1.5（阿里云镜像 + `--no-cache-dir` 安装）
- 全部命令真实执行，输出如实摘录。

## 2. 后端自动化测试：**52 passed**

命令：`cd backend && .venv/Scripts/python -m pytest app/tests/ -q --basetemp=/tmp/rc_t5`
结果：**52 passed, 3 warnings in 3.10s**（0 失败）。
warnings：FastAPI `on_event` 弃用（2）、fitz API 弃用提示（1），均不影响功能。

分文件明细（逐文件实跑统计）：

| 测试文件 | 通过数 | 覆盖 |
|---|---|---|
| test_comparison.py（一阶段） | 6 | 字段别名/数值/字符串/单位/缺失/四项预设结果 |
| test_llm.py（一阶段） | 8 | 成功/无 Key/401/429/超时/JSON修复/修复失败/密钥不泄漏 |
| test_audit.py（一阶段） | 3 | 端到端两项冲突/证据关联/虚构 chunk 拒绝 |
| test_parsers.py（二阶段新增） | 26 | 8 类解析器正常/空/损坏/恶意/metadata |
| test_extraction.py（二阶段新增） | 5 | 证据验证/虚构 chunk/假 quote/not_found/无 Key |
| test_stage2_api.py（二阶段新增） | 4 | 全链路/无 Key 失败/格式拒绝/删除级联 |
| **合计** | **52** | |

## 3. 解析器测试集（自建合成材料，17 个文件）

位置：`backend/test_materials/stage2/`，均有 `README.md` 标注"合成测试材料"。

| 文件 | 用途 |
|---|---|
| sample.pdf | 2-3 页可提取文本 PDF，含标题/摘要/实验设置与印刷页码 |
| sample_project.py | AST 解析样本，含 import/类/函数/argparse/lr/batch_size |
| sample.ipynb | 合法 notebook，含 markdown + code cell |
| config.yaml / config.json / config.toml | 配置解析，含嵌套 train.optimizer.lr |
| requirements.txt | 依赖解析 |
| README.md / empty.md | 文档正常/空文件 |
| data.csv / sample.xlsx | 表格元信息 |
| bundle.zip / bundle_ok.zip | 含 `../evil.txt` 路径穿越样本 / 正常包 |
| broken.py / broken.ipynb / unsafe.yaml | 语法错误/损坏 JSON/yaml 对象构造攻击 |

26 项解析器测试覆盖：正常解析、空文件、损坏文件、超大/压缩炸弹、不支持格式、编码异常、重复上传、恶意压缩包、解析失败。抽验关键安全断言：
- PDF 三种页码（page_index/viewer/printed）分别断言；
- Python 模块顶层 `raise RuntimeError` 时解析不触发执行；
- YAML `!!python/object` 标签被 safe_load 拒绝；
- ZIP `../evil.txt` 整体判失败，不部分解压。

## 4. API 真实 HTTP 冒烟测试：通过

启动 uvicorn + curl 实测：

| 接口 | 结果 |
|---|---|
| GET /api/v1/health | 200，统一信封 + request_id |
| GET /openapi.json | **19 条路径**（一阶段 6 + 二阶段 13）全部注册 |
| POST /projects | 200，项目成功创建 |
| POST /materials/upload | 200，config.yaml 216B，真实 sha256、material_type=yaml、parse_status=uploaded |
| GET /materials?project_id | 200，返回真实材料列表 |
| POST /materials/{id}/parse（无 Key） | **503 + LLM_KEY_NOT_CONFIGURED**，不伪造事实 |

## 5. 前端工程与浏览器测试：通过

- `npx tsc --noEmit`：exit 0；
- `npm run build`：成功，1657 模块，dist js 317KB / css 20.6KB；
- 密钥扫描：前端 src 无明文 Key（仅 `api_key_configured` 状态布尔值）；
- 假数据扫描：无 `Math.random` / mockData / 写死结果；
- 轮询：ParseTasksPage 用真实 `GET /parse-tasks` + 1500ms setInterval；
- 浏览器（chromium）实测材料管理页：5 个新导航项齐全、拖拽上传区与材料列表渲染正常、无布局错位；控制台仅 favicon 404 与 ReactRouter v7 warning（无害）。

## 6. 真实 API 调用测试：**待配置真实密钥**

**状态：未完成（外部阻塞，非代码缺陷）**

- 环境 `sk-` 密钥对 OpenAI 官方端点被本地代理 502 拦截，对通义/DeepSeek/月之暗面/智谱兼容端点全部 401；
- 未开通云端免密钥服务（激活会改变架构并触发计费确认）；
- 未宣称任何真实模型调用成功；程序链路已用协议级 mock 验证，填入真实密钥即可运行。

因此本报告中：
- **字段抽取 Precision/Recall/F1：无法真实计算**（无真实模型输出，不编造指标）；
- 证据关联成功率、原文引用验证率等，只在 mock 层面验证了**校验逻辑正确**，不代表真实模型表现；
- 样本量小（自建合成材料 17 个文件、mock 事实数十条），即使将来有真实结果也不足以宣称模型准确率。

## 7. 未执行的测试

- 真实模型字段抽取指标（P/R/F1）——阻塞于密钥；
- 大规模并发/压力测试（第二阶段范围外）；
- OCR 精度测试（本阶段无 OCR 能力，明确提示）；
- PDF 表格结构还原测试（范围外）。

## 8. 已知问题

1. `favicon.ico` 404 控制台噪音（无害）；
2. FastAPI `on_event` 弃用 warning；
3. `requirements.txt` 锁 PyMuPDF 1.24.13，实际安装 2.1.x（阿里云镜像解析结果），部署时建议按实际版本校准或改为 `PyMuPDF>=1.24`；
4. 同步执行的解析任务无法真正中断正在运行的模型调用，取消标记在阶段边界生效（已在 API 响应注明，不假装实时取消）。
