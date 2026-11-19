# 第九阶段 · 交付汇总

日期 2026-11-19。分支 `stage9/research-driven-refactor`，基线 tag `stage9-baseline`（33b6a5c）。
核心原则（用户原文）：不为了加功能而加功能、不照抄、不虚构调研、不静态页面冒充、不宣称 ACM 认证。

## 一、交付物清单（用户第十一步 10 项）

| # | 要求交付物 | 文件 | 状态 |
|---|---|---|---|
| 1 | GitHub 全球开源科研工具调研报告 | docs/STAGE9_GITHUB_RESEARCH.md | 完成：23 项目（15 深度），GitHub API 真实元数据 + LICENSE 原文核实，全部功能结论标"仅静态分析未运行" |
| 2 | 国际科研平台与权威学术规范调研报告 | docs/STAGE9_ACADEMIC_STANDARDS_RESEARCH.md | 完成：ACM v1.1 / FAIR / RO-Crate / W3C PROV 等官方来源，8 问题逐条附 URL，合规红线明确 |
| 3 | ReproCheck 竞品能力对比矩阵 | docs/STAGE9_COMPETITOR_AND_POSITIONING.md | 完成：14 平台 12 维矩阵，每格有来源 URL，"独立核对层"定位 |
| 4 | 当前产品问题与能力差距报告 | docs/STAGE9_CURRENT_PRODUCT_AUDIT.md | 完成：5 个具体 P0/P1 问题 + 文件行号；主控补充 STAGE9_BASELINE_FACTS.md |
| 5 | 核心竞争力重新定位方案 | docs/STAGE9_COMPETITOR_AND_POSITIONING.md 第 4-5 节 | 完成：三条真实差异 + 五方向设计建议 |
| 6 | 产品升级优先级路线图 | docs/STAGE9_UPGRADE_DECISION.md | 完成：8 候选 × 8 维评分，P0/P1/P2，本阶段选 U1+U2+U4 |
| 7 | 技术架构调整与数据模型设计 | docs/STAGE9_TECH_DESIGN.md | 完成：U1/U2/U4 设计+验收口径；U1 无 DB 变更（只读聚合），无需迁移脚本 |
| 8 | 实际代码修改 | 见第二节 | 完成：U1 后端 + U2 前端 + U4 README |
| 9 | 自动化测试及真实运行记录 | 第二节 + STAGE9_INDEPENDENT_ACCEPTANCE.md | 完成：后端 219 passed（基线 205 + U1 12 + 图表误报防护 2；独立验收 19/19 PASS），前端 typecheck/build 通过 |
| 10 | 升级前后对比及独立验收报告 | docs/STAGE9_INDEPENDENT_ACCEPTANCE.md | 完成：独立测试代理（未参与实现）执行，19/19 PASS、P0=0、P1=0、P2=3（其中 2 项已修复） |

## 二、实际完成的升级（三项，均为真实代码）

### U1 统一可信结论层
- 新增 `backend/app/services/verdict_service.py`：五态（已验证/部分验证/证据不足/冲突/无法验证）+ ACM 三维解耦（材料可获取/工件已评估/结果已验证）；映射 4 套旧状态枚举，未知值不猜测；只读聚合不写库。
- 新增 `GET /api/v1/projects/{id}/verdict-summary`（项目隔离 + 认证）。
- 新增 `tests/test_verdict_service.py` 12 项；全局注册后复验通过；后端全量 205→217 passed。
- 前端 `ProjectVerificationPage.tsx` 用同一模型展示五态与三维，附"仅自身验证范围、不构成机构认证"声明。

### U2 能力驾驶舱（接通已有后端能力）
- 新页面 `ProjectVerificationPage.tsx`：可信结论、图表反向验证、验证引擎分层（静态分析/数值重算）、基准指标计算、任务批量恢复、生产自检——全部真实 API 调用（useQuery/useMutation），非空壳。
- 新页面 `HandoffPage.tsx`：交接包导出（Bearer Blob 下载）+ 上传校验（manifest 摘要 + import_mode 提示）。
- `ParseTasksPage.tsx`：暂停/继续按钮接真实 API。
- `App.tsx` / `AppLayout.tsx`：两个新路由与侧栏入口。
- API client（api.ts / reproductionApi.ts）与类型补齐；typecheck/build 通过。

### U4 README 重写
- README 反映真实阶段（第六阶段 + 第九阶段重构）、三态能力表、安全边界、独立核对层定位、参考 ACM 框架的合规声明；删除"第一阶段/仅合成材料"过时表述。

## 三、调研形成的关键结论（事实/分析/建议分层见各报告）
1. 【分析】产品是"引擎强、驾驶舱弱"：后端堆积大量能力，前端入口严重不足——直接指导 U2。
2. 【分析】行业空位是"论文解析 × 可逐字核验的证据追踪"；可信度分层无人做——直接指导 U1。
3. 【规范事实】ACM v1.1 把材料可用/工件评估/结果验证解耦，禁止单一分数；借鉴≠认证——直接指导 U1 五态+三维+scope_note。
4. 【代码事实】GitHub 连接器当前只取 commit message，version_diff_json 名不副实——列入 P2（U5），本阶段不做。
5. 【法律事实】GitHub API license 字段对部分仓库返回 NOASSERTION，A 组通过 LICENSE 原文核实 MIT/BSD——集成时应做文本指纹，不轻信 API。

## 四、版本与回滚
- 基线 tag `stage9-baseline` = 33b6a5c；本阶段所有提交在分支 `stage9/research-driven-refactor`。
- 数据库无变更，U1 为只读聚合，无需迁移/回滚脚本。
- 回滚：`git reset --hard stage9-baseline`（仅本分支）。

## 五、未做与边界（如实披露）
- U3 标准证据包（RO-Crate JSON-LD）、U5 代码版本真实关联、U7 外部工具导入、U8 审计事件会话：列 P1/P2，本阶段未开发（理由见升级决策）。
- 真实隔离执行（Docker/GVisor）、OCR 图像级重绘对比、数据泄漏检测、五篇论文实战、365 天运行、备份恢复、生产部署：未实现/未验证，不伪造。
- 发布状态：NOT_READY（P0 阻断项未清）。
