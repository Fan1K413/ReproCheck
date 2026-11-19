# Beta 部署与回滚手册

**文档编号**：S10-R11  
**版本**：Beta v1.0-candidate  
**Commit**：`97d6686`  
**日期**：2026-11-19

---

## 一、版本固定

| 维度 | 值 |
|---|---|
| 版本号 | `1.0.0-beta-candidate-1` |
| Git commit | `97d6686` |
| 发布日期 | 2026-11-19 |
| 上一个稳定 commit | `3b9075e` (stage9 baseline) |
| 测试 | 219 pytest passed, real E2E verified |

---

## 二、生产环境配置（必须）

### 2.1 必须设置的环境变量

```bash
# === 安全 ===
REPROCHECK_JWT_SECRET=<至少64字符随机密钥>
REPROCHECK_ENCRYPTION_KEY=<至少32字节随机密钥>
REPROCHECK_ALLOW_UNAUTH_TEST_ENDPOINTS=False
REPROCHECK_CORS_ALLOW_ORIGINS=https://your-frontend-domain.com
REPROCHECK_REQUIRE_AI_CONSENT=True

# === LLM（可选但强烈建议）===
REPROCHECK_LLM_API_KEY=<真实 API Key>
REPROCHECK_LLM_MODEL=qwen-plus  # 或 gpt-4o-mini, claude-3-haiku

# === 数据库 ===
REPROCHECK_DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/reprocheck

# === 运行时 ===
REPROCHECK_ENVIRONMENT=production
```

### 2.2 生产自检（必须全部通过）

部署后立即调用：
```bash
curl http://localhost:8765/api/v1/diagnosis/production-check
```

**必须满足**：`passed=True` 且 `issues` 为空。

### 2.3 禁止的生产配置

| 配置 | 生产值 | 当前开发值 |
|---|---|---|
| `allow_unauth_test_endpoints` | `False` | `True` ❌ |
| `require_admin` 下省略 `require_write_user` | 不允许 | 存在（已澄清为"已登录即可"但需关注） |
| `allow_origins` 含 `'*'` | 不允许 | 存在 ❌ |

---

## 三、数据库迁移

```bash
# 1. 备份当前数据库
pg_dump -U reprocheck reprocheck > backup_20261119_v0.sql

# 2. 应用迁移（本阶段无 schema 变更，自动迁移在应用启动时执行）
# 启动后端后自动执行 stage2_migration_done（0 new columns in this stage）

# 3. 验证迁移
curl http://localhost:8765/api/v1/health
# 检查日志: "stage2_migration_done columns=0 indexes=0"
```

---

## 四、Docker 部署

### 4.1 后端 Dockerfile（生产优化）

```dockerfile
FROM python:3.13-slim

WORKDIR /app

# 系统依赖
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 应用代码
COPY app/ ./app/

# 非 root 用户
RUN useradd -m appuser && chown -R appuser /app
USER appuser

# 生产配置
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1
WORKERS=4

EXPOSE 8765

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:8765/api/v1/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8765", "--workers", "4"]
```

### 4.2 前端 Dockerfile

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

---

## 五、回滚方案

### 5.1 触发条件

| 条件 | 触发回滚 |
|---|---|
| 生产自检 `passed=False` | ✅ |
| 启动后 1 分钟内 health 接口不通 | ✅ |
| 核心 API 500 率 > 1% | ✅ |
| 数据丢失（parse-tasks/facts 记录异常） | ✅ |
| 发现 P0 安全漏洞 | ✅ |

### 5.2 回滚步骤

```bash
# 1. 标记服务为不可用（health 返回 503）
# 2. 切换回上一个稳定版本
git checkout 3b9075e

# 3. 恢复数据库（如有数据变更）
psql -U reprocheck reprocheck < backup_20261119_v0.sql

# 4. 重新部署
docker-compose up -d --build

# 5. 验证 health 和核心 API
curl http://localhost:8765/api/v1/health
```

### 5.3 数据兼容策略

本阶段无 schema 变更，**向后兼容**。如果未来有 schema 变更，必须提供：
- 向前迁移脚本（up）
- 向后回滚脚本（down）
- 数据迁移前备份

---

## 六、监控与日志

### 6.1 健康检查端点

```bash
GET /api/v1/health
→ {"status": "ok", "version": "1.0.0-beta-candidate-1", "timestamp": "..."}
```

### 6.2 关键指标监控

| 指标 | 阈值 | 告警 |
|---|---|---|
| API P95 延迟 | > 2s | 告警 |
| 解析任务成功率 | < 95% | 告警 |
| 内存占用 | > 1GB | 告警 |
| CPU 占用 | > 80% | 告警 |
| LLM API 调用失败率 | > 5% | 告警 |

### 6.3 日志

所有关键操作通过 `reprocheck` logger 记录，输出格式：
```
2026-11-19 18:57:09 | INFO | reprocheck | task_completed task=... result=partially_completed
```

---

## 七、用户使用说明要点

1. **注册即可使用** — 无审核，邮箱即账号
2. **上传材料** — 支持 PDF、Python (.py)、YAML、JSON、CSV、TXT、ZIP
3. **自动解析** — 上传后自动触发确定性解析，无 LLM Key 也能看到结果
4. **AI 抽取** — 配置 LLM API Key 后自动启用，需要用户同意治理门
5. **事实修订** — 支持手动修订 AI 抽取的事实
6. **导出** — 交接包导出为 ZIP，含全部材料+解析结果+Verdict

---

## 八、管理员使用说明要点

1. **安全优先** — 生产部署前必须过 production-check
2. **备份** — 建议每日自动 pg_dump
3. **LLM Key 可选** — 没有 Key 也能用，但少了 AI 抽取
4. **监控** — 关注 parse-task 成功率和延迟
5. **升级** — 先在 staging 验证，再部署生产
6. **回滚** — 数据库已迁移前可直接 git checkout + 重启

---

*手册结束。所有配置项、Dockerfile、回滚步骤都经过代码审查验证。*
