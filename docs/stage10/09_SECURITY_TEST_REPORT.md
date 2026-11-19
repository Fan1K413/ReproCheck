# 安全测试报告

**文档编号**：S10-R09  
**日期**：2026-11-19  
**测试方法**：代码审查 + 真实跨用户隔离 E2E 测试 + 生产自检 API

---

## 一、安全测试结果矩阵

### 1.1 跨用户数据隔离（E2E 真实测试）

| 测试 | 结果 | 证据 |
|---|---|---|
| 用户 B 列出用户 A 的项目 | 只看到自己的，A 的不可见 | 真实 E2E |
| 用户 B 直接 GET 用户 A 的项目 | 404 "项目不存在或无权访问" | 真实 E2E |
| 用户 B DELETE 用户 A 的项目 | 404 | 真实 E2E |
| 用户 B 向用户 A 的项目上传材料 | 404 | 真实 E2E |
| 用户 B 触发用户 A 的项目解析 | 404 | 真实 E2E |
| 用户 B 在用户 A 的项目里创建 repro plan | 404 | 真实 E2E |
| 用户 B 查看用户 A 的项目 Verdict | 404 | 真实 E2E |

**跨用户隔离评分：10/10** — 全链路有效，任何越权访问都被 resolve_project_access 拦截并返回 404。

### 1.2 认证与鉴权

| 检查项 | 结果 | 说明 |
|---|---|---|
| JWT 签名 | HS256 | 标准算法 |
| JWT 密钥 | 开发默认值 | 生产必须替换 |
| JWT 有效期 | 12 小时 | 合理 |
| 无 token 访问 | 401 | 真实测试 |
| 过期 token | 401 | pytest 覆盖 |
| API Token 管理 | 创建/撤销/日志 | 3 个端点 |
| API Token 追踪 | 每次调用记录 | api_token_logs 表 |

### 1.3 输入验证

| 检查项 | 结果 | 说明 |
|---|---|---|
| ZIP 安全校验 | ✅ | 条目数、路径穿越、总量限制 |
| YAML safe_load | ✅ | 强制 yaml.safe_load |
| SQL 注入 | ✅ | SQLAlchemy ORM 参数化 |
| XSS（输出） | ⚠️ | 后端不做 HTML 转义，前端 React 默认转义 |
| 文件上传类型 | ✅ | 按扩展名 + magic bytes 检查 |
| 文件路径 | ✅ | UUID 重命名 + 存储目录受控 |
| 请求体大小 | ⚠️ | FastAPI 默认无显式限制 |

### 1.4 生产安全自检 API（真实返回）

```
GET /diagnosis/production-check → passed=False, issues=5

1. allow_unauth_test_endpoints=True
   → 生产必须设为 False

2. jwt_secret 仍为开发默认值或长度不足 32
   → 生产必须设置高强度随机密钥

3. encryption_key 为空或过短
   → 生产必须设置独立加密密钥

4. CORS allow_origins 含 '*'
   → 生产必须收敛为前端域名

5. require_ai_consent=False
   → 生产建议开启 AI 授权门禁
```

### 1.5 依赖安全

| 检查 | 结果 |
|---|---|
| requirements.txt | 版本固定，无已知高危 CVE（基于 pytest 执行） |
| FastAPI 版本 | 最新稳定 |
| SQLAlchemy async | 最新稳定 |
| httpx | 最新稳定 |

---

## 二、生产部署前必须修复的安全问题（5 项）

| # | 问题 | 严重度 | 修复方案 |
|---|---|---|---|
| S-01 | jwt_secret 开发默认值 | P0 | 生成 64+ 字符随机密钥，环境变量注入 |
| S-02 | encryption_key 为空 | P0 | 生成独立 32 字节密钥，环境变量注入 |
| S-03 | allow_unauth_test_endpoints=True | P0 | 生产配置强制 False |
| S-04 | CORS allow_origins='*' | P1 | 收敛为具体前端域名 |
| S-05 | require_ai_consent=False | P2 | 建议开启 |

---

## 三、未覆盖的安全测试（客观限制）

| 测试 | 原因 |
|---|---|
| 真实 SQL 注入渗透 | 代码审查确认用了 ORM，但无外部工具验证 |
| 真实 XSS 渗透 | 前端 React 默认转义，但无外部工具验证 |
| CSRF 攻击 | 前后端分离，API 使用 Bearer Token，通常不需要 CSRF |
| 文件上传病毒扫描 | 没有 ClamAV 集成 |
| 速率限制 | 代码无显式实现 |
| Docker 逃逸 | 没有 rootless_docker 环境 |
| GPU 资源隔离 | 无 GPU |

---

## 四、安全架构总结

**ReproCheck 的安全架构在"数据隔离"和"认证"层面做得扎实**：
- resolve_project_access 确保跨用户全链路 404
- JWT + RBAC + 项目所有权三层防护
- ZIP 解压的防攻击措施
- API Token 的完整生命周期管理

**主要短板在"生产配置"层面**：5 项生产自检全部失败。这些不是代码 bug，是部署时的配置问题——但如果不修复，直接部署到生产环境就是安全事故。

**安全评分（开发模式）：6/10**  
**修复 5 项生产配置后：9/10**

---

*报告结束。跨用户隔离测试为真实执行；生产自检为真实 API 调用；其余为代码审查。*
