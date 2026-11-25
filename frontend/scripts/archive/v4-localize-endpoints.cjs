// 一次性把用户界面里的接口调试文案换成中文来源说明（仅字面替换，命中才改）
const fs = require('node:fs')

const edits = {
  'src/pages/reproduction/ReproductionComparisonPage.tsx': [
    ['hint="GET /reproductions/metric-comparisons"', 'hint="正在读取后端指标对照"'],
    ['GET /metric-comparisons · ', '指标对照 · '],
    ['<span className="rc-wa-source">GET /reproductions/quality</span>', '<span className="rc-wa-source">来源：后端质量对照聚合</span>'],
  ],
  'src/pages/reproduction/ReproductionConsolePage.tsx': [
    ['hint="GET /reproductions/runs/{run_id}"', 'hint="正在读取后端运行状态"'],
    ['<span className="rc-wa-source">GET /reproductions/runs/{run.run_id}</span>', '<span className="rc-wa-source">来源：后端运行记录</span>'],
    ['取自 GET /metric-comparisons 中匹配指标的最大 |diff_relative|', '取自后端指标对照中匹配指标的最大相对偏差'],
  ],
  'src/pages/reproduction/ReproductionDiagnosticsPage.tsx': [
    ['诊断由后端 POST /diagnostics 生成', '诊断由后端实时生成'],
    ['<span className="rc-wa-source">GET /reproductions/runs</span>', '<span className="rc-wa-source">来源：后端运行记录</span>'],
    ["<span className=\"rc-wa-source\">POST /remediations/{'{id}'}/review</span>", '<span className="rc-wa-source">来源：后端复核接口</span>'],
  ],
  'src/pages/reproduction/ReproductionEnvironmentPage.tsx': [
    ['hint="GET /reproductions/environments"', 'hint="正在读取后端环境数据"'],
    ['全部字段来自 GET /reproductions/environments，由后端依据材料解析与静态分析生成。', '全部字段来自后端环境数据，由后端依据材料解析与静态分析生成。'],
    ['全部字段来自 GET /reproductions/environments，由后端依据材料解析与静态分析生成，每个区块标注来源字段。', '全部字段来自后端环境数据，由后端依据材料解析与静态分析生成，每个区块标注来源字段。'],
  ],
  'src/pages/reproduction/ReproductionOverviewPage.tsx': [
    ['hint="GET /reproductions/plans · /runs"', 'hint="正在读取后端规划与运行数据"'],
    ['所有统计来自后端 GET /reproductions/plans 与 /runs 及规划详情，无前端伪造数据。', '所有统计来自后端规划、运行与规划详情，无前端伪造数据。'],
    ['hint="GET /reproductions/plans → total"', 'hint="后端真实计数"'],
    ['hint="GET /reproductions/runs → total"', 'hint="后端真实计数"'],
    ["<span className=\"rc-wa-source\">来源：GET /reproductions/plans/{'{plan_id}'} → tasks[].status</span>", '<span className="rc-wa-source">来源：后端规划任务的真实状态</span>'],
    ['<span className="rc-wa-source">GET /reproductions/plans</span>', '<span className="rc-wa-source">来源：后端规划聚合</span>'],
    ['<span className="rc-wa-source">GET /reproductions/runs</span>', '<span className="rc-wa-source">来源：后端运行聚合</span>'],
  ],
  'src/pages/reproduction/ReproductionPlanPage.tsx': [
    ['hint="GET /reproductions/plans/{plan_id}"', 'hint="正在读取后端规划详情"'],
    ['节点与边均由后端 <span className="mono">dag.nodes / dag.edges</span> 返回，前端仅做布局，不推断依赖。', '节点与边均由后端返回，前端仅做布局，不推断依赖。'],
    ['使用后端 POST /reproductions/plans。无模型密钥时后端返回 ai_available=false 与 LLM_KEY_NOT_CONFIGURED，不会生成假规划。', '使用后端规划接口。无模型密钥时后端会明确返回不可用状态，不会生成假规划。'],
    ["POST /reproductions/plans/{'{plan_id}'}/tasks", '后端规划任务接口'],
    ['POST /reproductions/runs。如无安全沙箱，后端返回 execution_enabled=false 与 blocked_no_sandbox，不会伪造运行。', '运行接口。如无安全沙箱，后端会明确返回不可执行状态，不会伪造运行。'],
    ['description="详情来自 GET /reproductions/plans/{plan_id} 返回的 tasks 数组。"', 'description="详情来自后端规划详情返回的任务列表。"'],
  ],
  'src/pages/reproduction/ReproductionReportsPage.tsx': [
    ['hint="GET /reproductions/reports"', 'hint="正在读取后端报告列表"'],
    ['<StatusBadge tone="neutral" dot={false}>POST /reproductions/reports</StatusBadge>', '<StatusBadge tone="neutral" dot={false}>由后端实时生成</StatusBadge>'],
  ],
}

const cwd = process.cwd()
for (const [file, pairs] of Object.entries(edits)) {
  const p = `${cwd}/${file}`
  let text = fs.readFileSync(p, 'utf8')
  let hits = 0
  for (const [from, to] of pairs) {
    if (text.includes(from)) {
      text = text.split(from).join(to)
      hits += 1
    }
  }
  fs.writeFileSync(p, text)
  console.log(`${file}: ${hits}/${pairs.length}`)
}
