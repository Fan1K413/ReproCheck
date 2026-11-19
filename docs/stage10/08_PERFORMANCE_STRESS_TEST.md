# 性能与压力测试报告

**文档编号**：S10-R08  
**日期**：2026-11-19  
**测试环境**：单进程 Uvicorn / SQLite async（开发模式）  
**测试工具**：Python httpx 串行调用 + pytest 基准计时

---

## 一、当前实测耗时

| 操作 | 耗时 | 条件 |
|---|---|---|
| 注册 | < 100ms | 真实 |
| 登录 | < 100ms | 真实 |
| 创建项目 | < 100ms | 真实 |
| 上传单文件 | 50-150ms | 3.8KB PDF, 1.3KB PY |
| 解析 PDF（确定性） | **132ms** | 真实，含 16 chunks |
| 解析 Python AST | **64ms** | 真实，含 18 chunks + 13 program facts |
| 解析 YAML | **70ms** | 真实，含 10 chunks + 10 config facts |
| 静态分析 API | < 100ms | sources dict 入参 |
| Verdict summary | < 100ms | 汇总 23 facts |
| 确定性诊断 classify | < 100ms | 11 类分类 |
| 交接包导出 | < 500ms | ZIP 生成 |
| pytest 全套 | **24.76s** | 219 项，含异步 setup |

### 结论：单任务延迟**优秀**，所有核心 API 均在 500ms 内完成。

---

## 二、数据库性能（SQLite async，开发模式）

> 注意：生产环境用 asyncpg + PostgreSQL，延迟应更低。以下数据是开发模式的上界。

| 查询类型 | 耗时 | 测试方式 |
|---|---|---|
| 项目列表（无过滤） | < 50ms | 真实 API |
| 材料列表（带 project_id 过滤） | < 50ms | 真实 API |
| ParseTask 列表（带 project_id 过滤） | < 50ms | 真实 API |
| Facts 列表 | < 100ms | 真实 API |
| Verdict summary（聚合查询） | < 100ms | 真实 API |

### 已知潜在瓶颈

| 场景 | 瓶颈 | 解决方案 |
|---|---|---|
| 百万级 facts | fact 表无分页默认限制 | 前端已用 cursor-based pagination |
| 大项目材料列表 | 无 material_count 索引 | 需在 PostgreSQL 加索引 |
| 并发 parse tasks | SQLite 写入锁 | 生产用 PostgreSQL 可缓解 |

---

## 三、前端构建与运行时

| 指标 | 值 |
|---|---|
| 构建时间 | 4.27s |
| 产物大小 | 695.85 kB (gzip 188.81 kB) |
| Chunk 警告 | > 500 kB，建议 code-split |

---

## 四、未执行的压力测试（客观限制）

| 测试类型 | 原因 | 建议补测 |
|---|---|---|
| 并发 1000 用户 | 单进程 Uvicorn 无法模拟 | 用 Locust + 多 worker |
| 100MB+ 大 PDF 解析 | 无测试文件 | 需准备大文件 |
| 1000+ 材料项目 | 数据库记录不足 | 批量生成 |
| GPU 密集型任务排队 | 无 GPU | 有 GPU 后测 reproduction |
| 长时间运行稳定性 | 无持续运行环境 | 需 24h 持续运行 |

---

## 五、性能改进建议

| 优先级 | 建议 | 预期收益 |
|---|---|---|
| P1 | 换 PostgreSQL 做完整压力测试 | 消除 SQLite 写入锁瓶颈 |
| P2 | 给 facts/materials 表加索引 | 大项目列表查询提速 |
| P3 | 前端 code-split | 首屏加载速度提升 |
| P3 | 批量解析任务并行化 | 多材料同时解析提速 |

---

*报告结束。所有耗时数据来自真实 API 调用。压力测试部分如实说明未覆盖范围。*
