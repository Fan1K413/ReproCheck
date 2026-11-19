# 缺陷修复与回归记录

**文档编号**：S10-R10  
**日期**：2026-11-19  
**本阶段修复**：1 个 P1 级缺陷 + 2 个配套更新  
**Commit**：`97d6686`

---

## 修复一：LLM Key 硬依赖导致解析流程卡死

| 字段 | 内容 |
|---|---|
| **缺陷编号** | BUG-ST10-001 |
| **严重度** | P1 — 核心业务流程阻断 |
| **发现日期** | 2026-11-19（第十阶段真实 E2E 测试） |
| **修复日期** | 2026-11-19 |
| **根因** | `TaskService.start()` 在第 128-130 行硬检查 `settings.is_llm_configured`，没有 API Key 时直接抛 `LLM_KEY_NOT_CONFIGURED`，导致任务无法创建。后续的确定性 PDF/Python AST/YAML 解析也无法执行 |
| **复现步骤** | 1. 启动后端，不设置 LLM API Key<br>2. 用户上传 PDF 或 Python 文件<br>3. 调用 POST /materials/{id}/parse<br>4. 返回 503 LLM_KEY_NOT_CONFIGURED |
| **预期行为** | 确定性解析（不依赖 LLM）应能执行，AI 抽取作为可选第二阶段 |
| **实际行为** | 503，什么都不做，用户看到的是空壳 |

### 修复方案

**文件**：`backend/app/services/task_service.py`

**改动 1 — `start()` 方法**（删除 LLM Key 硬检查）

删除了第 128-136 行：
```python
# 旧代码（删除）
if not settings.is_llm_configured:
    raise AppError("LLM_KEY_NOT_CONFIGURED", ...)
# 治理门检查也在这里硬阻塞
```

改为注释说明延迟检查：
```python
# 新代码（注释引导）
# LLM Key 不再硬阻塞任务创建：确定性解析始终可以执行；
# AI 事实抽取在 run() 的 extracting 阶段按 Key 是否存在独立决定。
```

**改动 2 — `run()` 方法**（重构抽取阶段，优雅降级）

1. 先做确定性解析（parse_file），这部分不依赖 LLM ✅
2. 成功后检查 LLM 是否可用 + 治理门是否放行
3. 如果可用 → 正常执行 LLM 抽取
4. 如果不可用 → 设置 `task.status = partially_completed`，记录跳过原因（`LLM_NOT_CONFIGURED` 或 `AI_CONSENT_REQUIRED`）
5. 无论是否 LLM 可用，**确定性程序事实始终补充**（`add_program_facts`）

**文件**：`backend/app/api/v1/parse_tasks.py`

**改动 3 — `_view()` 方法**（新增 result JSON 字段）

新增 `result` 字段返回解析后的 JSON（之前 result_json 只在内部存储，不返回给前端）。

### 修改文件清单

| 文件 | 改动 |
|---|---|
| `backend/app/services/task_service.py` | 151 行重构（+136/-57） |
| `backend/app/api/v1/parse_tasks.py` | +8 行 |
| `backend/app/tests/test_stage2_api.py` | 更新 1 个测试匹配新预期 |
| `backend/app/tests/test_stage6_governance.py` | 更新 1 个测试匹配新预期 + import json |

### 修复验证

| 验证 | 结果 |
|---|---|
| pytest 219 项回归 | ✅ 100% 通过 |
| PDF 解析（无 LLM Key） | ✅ 200 OK，16 chunks，partially_completed |
| Python 解析（无 LLM Key） | ✅ 200 OK，18 chunks，13 个确定性程序事实 |
| YAML 解析（无 LLM Key） | ✅ 200 OK，10 chunks，10 个配置事实 |
| Verdict summary | ✅ 23 VERIFIED（由确定性程序事实生成） |
| 治理门阻断（无 LLM Key） | ✅ 200 OK，AI_CONSENT_REQUIRED 记录 |
| 有 LLM Key 时（pytest mock） | ✅ 正常执行抽取，完成路径未改变 |
| 跨用户隔离 | ✅ 未受影响 |

### 是否引入回归问题

否。修复只影响 `start()` 和 `run()` 内部逻辑，不改变对外 API 签名，不改变有 LLM Key 时的正常行为路径。

---

## 其他 P0/P1 问题汇总（当前已知但本阶段未修复）

| # | 问题 | 严重度 | 原因 | 建议 |
|---|---|---|---|---|
| BUG-SEC-001 | 5 项生产自检失败（密钥默认值、CORS '*' 等） | P0 | 部署配置问题，不是代码 bug | 生产部署时配置环境变量 |
| BUG-SEC-002 | 无文件上传类型白名单（仅 magic bytes） | P2 | 代码未实现 | 后续版本加扩展名白名单 |
| BUG-FE-001 | 前端可能部分页面假设 LLM 抽取已完成 | P2 | 未做完整前端浏览器测试 | 有浏览器环境后验证 |

---

## 修复收益评估

| 维度 | 修复前 | 修复后 |
|---|---|---|
| 用户体验 | 无 LLM Key → 空壳页面，什么都做不了 | 无 LLM Key → 解析正常，有确定性事实和 Verdict |
| 产品可用度 | "完全卡死" | "基础功能可用" |
| 测试可信度 | pytest 219 通过但真实不可用 | pytest 219 通过且真实可用 |
| 架构原则 | "不伪造结果"但实现成"不做结果" | "不伪造结果"+"能做的先做" |

---

*记录结束。修复已 Commit 97d6686，219 项测试全部回归通过。*
