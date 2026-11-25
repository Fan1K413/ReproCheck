import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import {
  Activity,
  ClipboardList,
  Database,
  FileText,
  GitCompare,
  Network,
  ScrollText,
  Server,
  ShieldCheck,
  Terminal,
  Users,
} from 'lucide-react'
import { formatBytes, formatCount, formatDateTime } from '../features/format'
import type { DependencyView } from '../types/reproduction'
import type { BloomUnitId } from './types'
import {
  BarRow,
  Chip,
  EmptyNote,
  MetricGrid,
  PanelError,
  PanelLoading,
  Section,
  comparisonVerdict,
  feasibility,
  formatMs,
  isCodeMaterial,
  isConfigMaterial,
  isDataMaterial,
  materialStatus,
  materialTypeLabel,
  memberRole,
  planStatus,
  planTaskStatus,
  runStatus,
  useComparisons,
  useDataAudits,
  useEvidenceGraph,
  useFactsSummary,
  useParseOverview,
  usePlanDetail,
  useProjectMaterials,
  useProjectMembers,
  useProjectTasks,
  useReproEnvironments,
  useReproPlans,
  useReproQuality,
  useReproReports,
  useReproRuns,
  useVerdictSummary,
} from './unitDetailParts'

type UnitProps = { projectId: string }

const FACT_TYPE_LABEL: Record<string, string> = {
  research_info: '研究信息',
  dataset: '数据集',
  model: '模型',
  training_parameter: '训练参数',
  metric: '评价指标',
  environment: '环境依赖',
  runtime: '运行方式',
  experiment_process: '实验过程',
  other: '其他',
}

const ASSERTION_LABEL: Record<string, string> = {
  explicit: '明确陈述',
  inferred: '推断',
  ambiguous: '存在歧义',
  not_found: '未找到',
}

const EXTRACTION_LABEL: Record<string, string> = {
  supported: '有证据支持',
  unsupported: '无证据支持',
  needs_review: '待复核',
}

/* ==================================================================
   01 论文与材料
   ================================================================== */

function MaterialsUnit({ projectId }: UnitProps) {
  const materialsQuery = useProjectMaterials(projectId)
  const tasksQuery = useProjectTasks(projectId)
  const overviewQuery = useParseOverview(projectId)
  const factsQuery = useFactsSummary(projectId)

  if (materialsQuery.isPending) return <PanelLoading label="材料列表" />
  if (materialsQuery.isError) {
    return <PanelError label="材料列表" onRetry={() => void materialsQuery.refetch()} />
  }

  const materials = materialsQuery.data.items
  const tasks = tasksQuery.data?.items ?? []
  const completedTasks = tasks.filter(
    (task) => task.status === 'completed' || task.status === 'partially_completed',
  ).length
  const factsTotal = factsQuery.data?.total
  const overview = overviewQuery.data

  return (
    <>
      <MetricGrid
        items={[
          { label: '材料总数', value: formatCount(materials.length), hint: 'GET /materials' },
          {
            label: '解析任务',
            value: formatCount(tasks.length),
            hint: `${completedTasks} 个已完成或部分完成`,
          },
          {
            label: '抽取事实',
            value: factsTotal == null ? '—' : formatCount(factsTotal),
            hint: '来自事实汇总接口',
          },
        ]}
      />

      <Section
        title="材料与解析状态"
        icon={FileText}
        note="真实文件与 SHA-256 由后端保存"
      >
        {materials.length === 0 ? (
          <EmptyNote
            title="尚无材料"
            description="上传论文 PDF、Notebook、代码或数据文件后，解析结果会显示在这里。"
            action={
              <Link to={`/projects/${projectId}/materials`} className="btn-primary">
                去上传材料
              </Link>
            }
          />
        ) : (
          <div className="bloom-list">
            {materials.map((material) => {
              const status = materialStatus(material.parse_status)
              return (
                <Link
                  key={material.material_id}
                  to={`/materials/${material.material_id}`}
                  className="bloom-list__row"
                >
                  <Icon as={FileText} size={15} tone="muted" />
                  <span className="bloom-list__main">
                    <span className="bloom-list__title">{material.filename}</span>
                    <span className="bloom-list__meta">
                      {materialTypeLabel(material.material_type)} · {formatBytes(material.size_bytes)} ·{' '}
                      {material.chunk_count} 个文本块 · {material.fact_count} 条事实
                    </span>
                  </span>
                  <Chip tone={status.tone}>{status.label}</Chip>
                </Link>
              )
            })}
          </div>
        )}
      </Section>

      <Section title="解析覆盖" icon={Activity} note="parse-overview 聚合">
        {overview ? (
          <div className="bloom-kv">
            <div className="bloom-kv__item">
              <div className="bloom-kv__key">材料状态</div>
              <div className="bloom-kv__value">
                完成 {overview.materials.completed} · 部分 {overview.materials.partially_completed} · 待处理{' '}
                {overview.materials.pending} · 失败 {overview.materials.failed}
              </div>
            </div>
            <div className="bloom-kv__item">
              <div className="bloom-kv__key">事实证据</div>
              <div className="bloom-kv__value">
                {overview.facts.with_evidence} / {overview.facts.total} 条具备证据
              </div>
            </div>
            <div className="bloom-kv__item">
              <div className="bloom-kv__key">模型调用</div>
              <div className="bloom-kv__value">
                {overview.llm.total_calls} 次 · {formatCount(overview.llm.total_tokens)} tokens
              </div>
            </div>
          </div>
        ) : (
          <PanelLoading label="解析聚合" />
        )}
      </Section>
    </>
  )
}

/* ==================================================================
   02 数据集与代码
   ================================================================== */

function DatasetUnit({ projectId }: UnitProps) {
  const materialsQuery = useProjectMaterials(projectId)
  const auditsQuery = useDataAudits(projectId)

  if (materialsQuery.isPending) return <PanelLoading label="材料类型" />
  if (materialsQuery.isError) {
    return <PanelError label="材料类型" onRetry={() => void materialsQuery.refetch()} />
  }

  const materials = materialsQuery.data.items
  const dataFiles = materials.filter((material) => isDataMaterial(material.material_type))
  const codeFiles = materials.filter((material) => isCodeMaterial(material.material_type))
  const configFiles = materials.filter((material) => isConfigMaterial(material.material_type))
  const audits = auditsQuery.data?.items ?? []

  return (
    <>
      <MetricGrid
        items={[
          { label: '数据文件', value: formatCount(dataFiles.length), hint: 'CSV / Excel' },
          { label: '代码与 Notebook', value: formatCount(codeFiles.length), hint: 'Python / ipynb / ZIP' },
          { label: '配置文件', value: formatCount(configFiles.length), hint: 'YAML / JSON / TOML' },
        ]}
      />

      <Section title="数据集与代码资产" icon={Database} note="按材料类型分组">
        {materials.length === 0 ? (
          <EmptyNote title="尚无材料" description="上传数据或代码后，这里会按类型分组。" />
        ) : (
          <div className="bloom-list">
            {materials.map((material) => (
              <Link
                key={material.material_id}
                to={`/materials/${material.material_id}`}
                className="bloom-list__row"
              >
                <span className="bloom-list__main">
                  <span className="bloom-list__title">{material.filename}</span>
                  <span className="bloom-list__meta">
                    {isDataMaterial(material.material_type)
                      ? '数据文件'
                      : isCodeMaterial(material.material_type)
                        ? '代码 / Notebook'
                        : isConfigMaterial(material.material_type)
                          ? '配置文件'
                          : '文档'}
                    {' · '}
                    {materialTypeLabel(material.material_type)}
                  </span>
                </span>
                <Chip tone="neutral">{material.chunk_count} 块</Chip>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section title="数据质量审计" icon={ShieldCheck} note="后端本地只读执行">
        {auditsQuery.isError ? (
          <PanelError label="数据审计记录" onRetry={() => void auditsQuery.refetch()} />
        ) : audits.length === 0 ? (
          <EmptyNote
            title="尚无数据审计记录"
            description="数据分布、完整性与泄漏审计需要主动发起；演示项目未运行过该审计。"
            action={
              <Link to={`/projects/${projectId}/data-audit`} className="btn-ghost">
                打开数据质量审计
              </Link>
            }
          />
        ) : (
          <div className="bloom-list">
            {audits.map((audit) => (
              <div key={audit.audit_id} className="bloom-list__row">
                <span className="bloom-list__main">
                  <span className="bloom-list__title">{audit.audit_id}</span>
                  <span className="bloom-list__meta">
                    {formatDateTime(audit.created_at)} · {audit.status}
                  </span>
                </span>
                <Chip tone="neutral">查看</Chip>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  )
}

/* ==================================================================
   03 科研事实
   ================================================================== */

function FactsUnit({ projectId }: UnitProps) {
  const factsQuery = useFactsSummary(projectId)

  if (factsQuery.isPending) return <PanelLoading label="事实汇总" />
  if (factsQuery.isError) {
    return <PanelError label="事实汇总" onRetry={() => void factsQuery.refetch()} />
  }

  const summary = factsQuery.data
  const typeEntries = Object.entries(summary.by_type ?? {}).sort((a, b) => b[1] - a[1])
  const maxType = typeEntries.reduce((max, [, count]) => Math.max(max, count), 1)

  return (
    <>
      <MetricGrid
        items={[
          { label: '事实总数', value: formatCount(summary.total), hint: 'facts/summary' },
          { label: '有证据', value: formatCount(summary.with_evidence), hint: '逐字引用已核验' },
          { label: '待复核', value: formatCount(summary.by_status.needs_review ?? 0), hint: '需要人工确认' },
          { label: '人工修订', value: formatCount(summary.human_confirmed), hint: '留下修订记录' },
        ]}
      />

      <Section title="事实类型分布" icon={ClipboardList} note="按后端字段分类">
        {typeEntries.length === 0 ? (
          <EmptyNote title="尚无事实" description="解析材料并完成抽取后，事实会按类型分布。" />
        ) : (
          <div className="bloom-bars">
            {typeEntries.map(([type, count]) => (
              <BarRow
                key={type}
                label={FACT_TYPE_LABEL[type] ?? type}
                value={count}
                max={maxType}
                display={`${count} 条`}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="断言与证据状态" icon={ShieldCheck}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {Object.entries(summary.by_assertion).map(([key, value]) => (
            <Chip key={key} tone={key === 'explicit' ? 'success' : key === 'inferred' ? 'warning' : 'neutral'}>
              {ASSERTION_LABEL[key] ?? key} · {value}
            </Chip>
          ))}
          {Object.entries(summary.by_status).map(([key, value]) => (
            <Chip
              key={`status-${key}`}
              tone={key === 'supported' ? 'success' : key === 'unsupported' ? 'danger' : 'warning'}
            >
              {EXTRACTION_LABEL[key] ?? key} · {value}
            </Chip>
          ))}
        </div>
        <div className="bloom-note" style={{ marginTop: 10 }}>
          每条事实都必须通过原文核对后才计入“有证据”；前端不生成任何事实或证据。
        </div>
      </Section>
    </>
  )
}

/* ==================================================================
   04 证据图谱
   ================================================================== */

function EvidenceUnit({ projectId }: UnitProps) {
  const graphQuery = useEvidenceGraph(projectId)

  if (graphQuery.isPending) return <PanelLoading label="证据图谱" />
  if (graphQuery.isError) {
    return <PanelError label="证据图谱" onRetry={() => void graphQuery.refetch()} />
  }

  const graph = graphQuery.data
  const counts = graph.counts

  return (
    <>
      <MetricGrid
        items={[
          { label: '事实节点', value: formatCount(counts.facts), hint: 'fact' },
          { label: '证据节点', value: formatCount(counts.evidence), hint: 'evidence' },
          { label: '原文块', value: formatCount(counts.source_chunks), hint: 'source_chunk' },
          { label: '关系边', value: formatCount(counts.edges), hint: 'supported_by / quotes' },
        ]}
      />

      <Section title="证据链层级" icon={Network} note="真实节点计数">
        <div className="bloom-kv">
          <div className="bloom-kv__item">
            <div className="bloom-kv__key">材料</div>
            <div className="bloom-kv__value">{counts.materials} 个材料节点</div>
          </div>
          <div className="bloom-kv__item">
            <div className="bloom-kv__key">原文</div>
            <div className="bloom-kv__value">{counts.source_chunks} 个文本块</div>
          </div>
          <div className="bloom-kv__item">
            <div className="bloom-kv__key">引用</div>
            <div className="bloom-kv__value">{counts.evidence} 条证据</div>
          </div>
          <div className="bloom-kv__item">
            <div className="bloom-kv__key">结论</div>
            <div className="bloom-kv__value">{counts.facts} 条事实</div>
          </div>
        </div>
      </Section>

      <Section title="图谱结构" icon={Network}>
        {counts.facts === 0 ? (
          <EmptyNote title="尚无证据节点" description="完成事实抽取后，主张—证据—原文的关系会出现在这里。" />
        ) : (
          <div className="bloom-note">
            当前图谱包含 {counts.facts} 条事实、{counts.evidence} 条证据与 {counts.edges} 条关系边；
            仅统计已通过原文定位核验的引用，未定位的引用不计入节点。
          </div>
        )}
      </Section>
    </>
  )
}

/* ==================================================================
   05 复现规划
   ================================================================== */

type DagTask = {
  key: string
  title: string
  dependsOn: string[]
  status: string
  feasibility: string
  human: boolean
}

function PlanDag({ tasks }: { tasks: DagTask[] }) {
  const { positions, edges } = useMemo(() => {
    const keys = tasks.map((task) => task.key)
    const level = new Map<string, number>()
    keys.forEach((key) => level.set(key, 0))
    for (let round = 0; round < tasks.length; round += 1) {
      let changed = false
      for (const task of tasks) {
        for (const dependency of task.dependsOn) {
          if (!level.has(dependency)) continue
          const candidate = (level.get(dependency) ?? 0) + 1
          if (candidate > (level.get(task.key) ?? 0)) {
            level.set(task.key, candidate)
            changed = true
          }
        }
      }
      if (!changed) break
    }
    const maxLevel = Math.max(0, ...Array.from(level.values()))
    const groups = new Map<number, DagTask[]>()
    for (const task of tasks) {
      const taskLevel = level.get(task.key) ?? 0
      const group = groups.get(taskLevel) ?? []
      group.push(task)
      groups.set(taskLevel, group)
    }
    const result = new Map<string, { x: number; y: number }>()
    for (const [taskLevel, group] of groups) {
      group.forEach((task, index) => {
        result.set(task.key, {
          x: maxLevel === 0 ? 50 : 10 + (taskLevel / maxLevel) * 80,
          y: ((index + 1) / (group.length + 1)) * 74 + 13,
        })
      })
    }
    const edgeList: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> = []
    for (const task of tasks) {
      for (const dependency of task.dependsOn) {
        const start = result.get(dependency)
        const end = result.get(task.key)
        if (start && end) edgeList.push({ from: start, to: end })
      }
    }
    return { positions: result, edges: edgeList }
  }, [tasks])

  if (tasks.length === 0) {
    return (
      <EmptyNote
        title="尚无规划任务"
        description="创建复现规划后，任务依赖会以 DAG 缩略图显示。"
      />
    )
  }

  return (
    <div className="bloom-dag" aria-label="复现任务依赖缩略图">
      <svg className="bloom-dag__svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        {edges.map((edge, index) => (
          <line
            key={index}
            x1={edge.from.x}
            y1={edge.from.y}
            x2={edge.to.x}
            y2={edge.to.y}
            stroke="var(--bloom-paper-ink)"
            strokeOpacity={0.22}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {tasks.map((task) => {
        const position = positions.get(task.key)
        if (!position) return null
        return (
          <div
            key={task.key}
            className={`bloom-dag__node${task.feasibility === 'needs_human_review' ? ' is-warning' : ''}`}
            style={{ left: `${position.x}%`, top: `${position.y}%` }}
            title={`${task.title}（${task.key}）`}
          >
            {task.title}
          </div>
        )
      })}
    </div>
  )
}

function PlanUnit({ projectId }: UnitProps) {
  const plansQuery = useReproPlans(projectId)
  const plan = plansQuery.data?.items[0]
  const detailQuery = usePlanDetail(plan?.plan_id)

  if (plansQuery.isPending) return <PanelLoading label="复现规划" />
  if (plansQuery.isError) {
    return <PanelError label="复现规划" onRetry={() => void plansQuery.refetch()} />
  }

  const tasks = detailQuery.data?.tasks ?? []
  const dagTasks: DagTask[] = tasks.map((task) => ({
    key: task.task_key,
    title: task.title,
    dependsOn: task.depends_on.map((id) => tasks.find((item) => item.task_id === id)?.task_key ?? id),
    status: task.status,
    feasibility: task.feasibility,
    human: task.needs_human_confirm,
  }))
  const feasible = tasks.filter(
    (task) => task.feasibility === 'ready' || String(task.feasibility) === 'feasible',
  ).length
  const human = tasks.filter((task) => task.needs_human_confirm).length

  return (
    <>
      <MetricGrid
        items={[
          { label: '复现规划', value: formatCount(plansQuery.data.total), hint: 'plans' },
          { label: '规划任务', value: formatCount(tasks.length), hint: detailQuery.isPending ? '读取中…' : 'plan detail' },
          { label: '可行任务', value: formatCount(feasible), hint: 'feasibility=feasible' },
          { label: '待人工确认', value: formatCount(human), hint: 'needs_human_confirm' },
        ]}
      />

      <Section title="任务依赖 DAG" icon={Network} note="由 depends_on 推导">
        {detailQuery.isError ? (
          <PanelError label="规划详情" onRetry={() => void detailQuery.refetch()} />
        ) : detailQuery.isPending && plan ? (
          <PanelLoading label="规划详情" />
        ) : (
          <PlanDag tasks={dagTasks} />
        )}
      </Section>

      <Section title="规划任务" icon={ClipboardList} note={`${tasks.length} 项`}>
        {tasks.length === 0 ? (
          <EmptyNote title="尚无任务" description="规划详情返回 tasks 后显示。" />
        ) : (
          <div className="bloom-list">
            {tasks.map((task) => {
              const status = planTaskStatus(task.status)
              const feasibilityMeta = feasibility(task.feasibility)
              return (
                <div key={task.task_id} className="bloom-list__row">
                  <span className="bloom-list__main">
                    <span className="bloom-list__title">{task.title}</span>
                    <span className="bloom-list__meta">
                      {task.task_key} · 依赖 {task.depends_on.length} 项
                      {task.needs_human_confirm ? ' · 需人工确认' : ''}
                    </span>
                  </span>
                  <Chip tone={feasibilityMeta.tone}>{feasibilityMeta.label}</Chip>
                  <Chip tone={status.tone}>{status.label}</Chip>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {plan && (
        <Section title="规划状态" icon={Activity}>
          <div className="bloom-kv">
            <div className="bloom-kv__item">
              <div className="bloom-kv__key">状态</div>
              <div className="bloom-kv__value">{planStatus(plan.status).label}</div>
            </div>
            <div className="bloom-kv__item">
              <div className="bloom-kv__key">来源</div>
              <div className="bloom-kv__value">{plan.source ?? '—'}</div>
            </div>
            <div className="bloom-kv__item">
              <div className="bloom-kv__key">创建</div>
              <div className="bloom-kv__value">{formatDateTime(plan.created_at)}</div>
            </div>
          </div>
        </Section>
      )}
    </>
  )
}

/* ==================================================================
   06 实验环境
   ================================================================== */

function EnvironmentUnit({ projectId }: UnitProps) {
  const envQuery = useReproEnvironments(projectId)

  if (envQuery.isPending) return <PanelLoading label="实验环境" />
  if (envQuery.isError) {
    return <PanelError label="实验环境" onRetry={() => void envQuery.refetch()} />
  }

  const env = envQuery.data.items[0]
  if (!env) {
    return (
      <>
        <MetricGrid items={[{ label: '实验环境', value: '0', hint: '尚未检测' }]} />
        <EmptyNote
          title="尚未检测运行环境"
          description="上传 Notebook 或依赖清单后，后端会提取 Python 版本、框架与硬件要求。"
          action={
            <Link to={`/projects/${projectId}/reproduction/environment`} className="btn-ghost">
              去检测环境
            </Link>
          }
        />
      </>
    )
  }

  const dependencies = (env.dependencies as unknown[]).map((dependency) => {
    if (typeof dependency === 'string') return dependency
    const item = dependency as DependencyView
    return `${item.name}${item.declared_version ? `==${item.declared_version}` : ''}`
  })
  const frameworks = Object.entries(env.frameworks ?? {})
  const hardware =
    typeof env.hardware_requirements === 'string'
      ? env.hardware_requirements
      : env.hardware_requirements && typeof env.hardware_requirements === 'object'
        ? Object.entries(env.hardware_requirements as Record<string, unknown>)
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join(' · ')
        : '—'

  return (
    <>
      <MetricGrid
        items={[
          { label: 'Python', value: env.python_version ?? '—', hint: '声明版本' },
          {
            label: '框架',
            value: frameworks.length > 0 ? String(frameworks[0][1]) : '—',
            hint: frameworks.length > 0 ? frameworks[0][0] : '未检测',
          },
          { label: '依赖', value: formatCount(dependencies.length), hint: 'requirements' },
          { label: '缺失声明', value: formatCount(env.missing.length), hint: '影响可复现性' },
        ]}
      />

      <Section title="环境声明" icon={Server} note="来自 Notebook / 配置">
        <div className="bloom-kv">
          <div className="bloom-kv__item">
            <div className="bloom-kv__key">硬件要求</div>
            <div className="bloom-kv__value">{hardware}</div>
          </div>
          <div className="bloom-kv__item">
            <div className="bloom-kv__key">入口文件</div>
            <div className="bloom-kv__value">{env.entrypoints.join(' · ') || '—'}</div>
          </div>
          <div className="bloom-kv__item">
            <div className="bloom-kv__key">框架版本</div>
            <div className="bloom-kv__value">
              {frameworks.length > 0
                ? frameworks.map(([name, version]) => `${name} ${String(version)}`).join(' · ')
                : '—'}
            </div>
          </div>
        </div>
      </Section>

      <Section title="依赖清单" icon={Database} note={`${dependencies.length} 项`}>
        {dependencies.length === 0 ? (
          <EmptyNote title="尚无依赖声明" description="上传 requirements.txt 或 Notebook 后显示。" />
        ) : (
          <div className="bloom-list">
            {dependencies.map((dependency) => (
              <div key={dependency} className="bloom-list__row">
                <span className="bloom-list__main">
                  <span className="bloom-list__title mono">{dependency}</span>
                </span>
                <Chip tone="neutral">声明</Chip>
              </div>
            ))}
          </div>
        )}
      </Section>

      {env.missing.length > 0 && (
        <Section title="缺失的可复现声明" icon={Activity} note="不计为通过">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {env.missing.map((item) => (
              <Chip key={item} tone="danger">
                {item}
              </Chip>
            ))}
          </div>
          {env.warnings.map((warning) => (
            <div className="bloom-note is-warning" style={{ marginTop: 8 }} key={warning}>
              {warning}
            </div>
          ))}
        </Section>
      )}
    </>
  )
}

/* ==================================================================
   07 复现运行
   ================================================================== */

function RunsUnit({ projectId }: UnitProps) {
  const runsQuery = useReproRuns(projectId)

  if (runsQuery.isPending) return <PanelLoading label="复现运行" />
  if (runsQuery.isError) {
    return <PanelError label="复现运行" onRetry={() => void runsQuery.refetch()} />
  }

  const runs = runsQuery.data.items
  const completed = runs.filter((run) => run.status === 'completed').length
  const failed = runs.filter((run) => run.status === 'failed').length
  const latest = runs[0]

  return (
    <>
      <MetricGrid
        items={[
          { label: '运行总数', value: formatCount(runs.length), hint: 'GET /reproductions/runs' },
          { label: '已完成', value: formatCount(completed), hint: 'status=completed' },
          { label: '失败', value: formatCount(failed), hint: '后端真实错误' },
          {
            label: '最近状态',
            value: latest ? runStatus(latest.status).label : '—',
            hint: latest ? formatDateTime(latest.created_at) : '暂无运行',
          },
        ]}
      />

      <Section title="运行记录" icon={Terminal} note={`${runs.length} 次`}>
        {runs.length === 0 ? (
          <EmptyNote
            title="尚无运行记录"
            description="规划确认后可创建运行；后端在无安全沙箱时会明确阻塞，不会伪造执行结果。"
            action={
              <Link to={`/projects/${projectId}/reproduction`} className="btn-ghost">
                打开复现总览
              </Link>
            }
          />
        ) : (
          <div className="bloom-list">
            {runs.map((run) => {
              const status = runStatus(run.status)
              return (
                <Link
                  key={run.run_id}
                  to={`/reproductions/runs/${run.run_id}`}
                  className="bloom-list__row"
                >
                  <span className="bloom-list__main">
                    <span className="bloom-list__title mono">{run.run_id}</span>
                    <span className="bloom-list__meta">
                      耗时 {formatMs(run.duration_ms)} · 内存{' '}
                      {run.resource_usage?.memory_mb == null
                        ? '—'
                        : `${formatCount(Math.round(run.resource_usage.memory_mb))} MB`}
                      {' · '}执行{run.execution_enabled ? '已启用' : '已禁用'}
                    </span>
                  </span>
                  <Chip tone={status.tone}>{status.label}</Chip>
                </Link>
              )
            })}
          </div>
        )}
      </Section>

      {runs.some((run) => run.error_message) && (
        <Section title="失败原因" icon={Activity} note="来自运行记录">
          {runs
            .filter((run) => run.error_message)
            .map((run) => (
              <div className="bloom-note is-warning" key={run.run_id} style={{ marginBottom: 8 }}>
                <span className="mono" style={{ marginRight: 6 }}>
                  {run.run_id}
                </span>
                {run.error_message}
              </div>
            ))}
        </Section>
      )}

      <div className="bloom-note">
        代码执行状态由后端沙箱策略决定：当前若返回 execution_enabled=false，界面只显示阻塞状态，不显示推测进度。
      </div>
    </>
  )
}

/* ==================================================================
   08 结果验证
   ================================================================== */

function VerificationUnit({ projectId }: UnitProps) {
  const qualityQuery = useReproQuality(projectId)
  const verdictQuery = useVerdictSummary(projectId)
  const comparisonsQuery = useComparisons(projectId)

  if (qualityQuery.isPending) return <PanelLoading label="质量评分" />
  if (qualityQuery.isError) {
    return <PanelError label="质量评分" onRetry={() => void qualityQuery.refetch()} />
  }

  const quality = qualityQuery.data
  const dimensions = [...quality.dimensions].sort((a, b) => a.score - b.score)
  const verdict = verdictQuery.data
  const comparisons = comparisonsQuery.data?.items ?? []
  const verdictTotal = verdict
    ? Object.values(verdict.verdicts ?? {}).reduce((sum, value) => sum + value, 0)
    : null
  const locatorRatio = verdict?.evidence_locator?.ratio

  return (
    <>
      <MetricGrid
        items={[
          {
            label: '复现覆盖分',
            value: quality.overall == null ? '—' : quality.overall.toFixed(3),
            hint: '平台定义的覆盖程度',
          },
          {
            label: '五态结论',
            value: verdictTotal == null ? '—' : formatCount(verdictTotal),
            hint: 'verdict-summary',
          },
          { label: '指标对照', value: formatCount(comparisons.length), hint: 'metric comparisons' },
          {
            label: '证据定位率',
            value: locatorRatio == null ? '—' : `${Math.round(locatorRatio * 100)}%`,
            hint: '带位置的证据',
          },
        ]}
      />

      <Section title="质量维度（最低三项优先）" icon={ShieldCheck} note="score / 1.0">
        <div className="bloom-bars">
          {dimensions.map((dimension) => (
            <BarRow
              key={dimension.key}
              label={dimension.label}
              value={dimension.score}
              max={dimension.max}
              display={dimension.score.toFixed(2)}
              tone={dimension.score < 0.4 ? 'warning' : undefined}
            />
          ))}
        </div>
        <div className="bloom-note" style={{ marginTop: 10 }}>
          {quality.scope_note}
        </div>
      </Section>

      <Section title="五态验证结论" icon={Activity}>
        {verdictQuery.isError ? (
          <PanelError label="验证结论" onRetry={() => void verdictQuery.refetch()} />
        ) : !verdict ? (
          <PanelLoading label="验证结论" />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(verdict.verdicts ?? {}).map(([key, value]) => {
              const tone =
                key === 'VERIFIED'
                  ? 'success'
                  : key === 'CONFLICTING'
                    ? 'danger'
                    : key === 'INSUFFICIENT_EVIDENCE' || key === 'PARTIALLY_VERIFIED'
                      ? 'warning'
                      : 'neutral'
              return (
                <Chip key={key} tone={tone}>
                  {verdict.verdict_labels?.[key] ?? key} · {value}
                </Chip>
              )
            })}
          </div>
        )}
      </Section>

      <Section title="指标对照" icon={GitCompare} note={`${comparisons.length} 条`}>
        {comparisonsQuery.isError ? (
          <PanelError label="指标对照" onRetry={() => void comparisonsQuery.refetch()} />
        ) : comparisons.length === 0 ? (
          <EmptyNote title="尚无指标对照" description="运行结束后，论文值与复现值会按容差规则对比。" />
        ) : (
          <div className="bloom-list">
            {comparisons.map((comparison, index) => {
              const meta = comparisonVerdict(comparison.verdict)
              return (
                <div key={`${comparison.comparison_id}-${index}`} className="bloom-list__row">
                  <span className="bloom-list__main">
                    <span className="bloom-list__title">{comparison.metric_name}</span>
                    <span className="bloom-list__meta">
                      论文 {comparison.paper_value ?? '—'} · 复现 {comparison.reproduced_value ?? '—'} · 差异{' '}
                      {comparison.diff_relative == null
                        ? '—'
                        : `${(comparison.diff_relative * 100).toFixed(1)}%`}
                    </span>
                  </span>
                  <Chip tone={meta.tone}>{meta.label}</Chip>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </>
  )
}

/* ==================================================================
   09 审计报告
   ================================================================== */

function ReportUnit({ projectId }: UnitProps) {
  const reportsQuery = useReproReports(projectId)

  if (reportsQuery.isPending) return <PanelLoading label="审计报告" />
  if (reportsQuery.isError) {
    return <PanelError label="审计报告" onRetry={() => void reportsQuery.refetch()} />
  }

  const reports = reportsQuery.data.items
  const latest = reports[0]
  const sectionCount = reports.reduce((sum, report) => sum + (report.section_count ?? 0), 0)

  return (
    <>
      <MetricGrid
        items={[
          { label: '报告总数', value: formatCount(reports.length), hint: 'GET /reproductions/reports' },
          { label: '章节合计', value: formatCount(sectionCount), hint: 'section_count' },
          {
            label: 'HTML 导出',
            value: latest?.html_available ? '可用' : '不可用',
            hint: '后端生成',
          },
          {
            label: 'PDF 导出',
            value: latest?.pdf_available ? '可用' : '不可用',
            hint: latest?.pdf_error ?? '按后端能力',
          },
        ]}
      />

      <Section title="报告列表" icon={ScrollText} note={`${reports.length} 份`}>
        {reports.length === 0 ? (
          <EmptyNote
            title="尚无审计报告"
            description="完成运行与对照后，可以生成带证据章节的审计报告。"
            action={
              <Link to={`/projects/${projectId}/reproduction/reports`} className="btn-ghost">
                打开报告中心
              </Link>
            }
          />
        ) : (
          <div className="bloom-list">
            {reports.map((report) => (
              <div key={report.report_id} className="bloom-list__row">
                <Icon as={ScrollText} size={15} tone="muted" />
                <span className="bloom-list__main">
                  <span className="bloom-list__title">{report.title}</span>
                  <span className="bloom-list__meta">
                    V{report.version} · {report.section_count ?? report.sections?.length ?? 0} 章 ·{' '}
                    {formatDateTime(report.created_at)}
                  </span>
                </span>
                <Chip tone={report.status === 'final' ? 'success' : 'neutral'}>{report.status}</Chip>
              </div>
            ))}
          </div>
        )}
      </Section>

      {latest && (
        <Section title="报告边界" icon={Activity}>
          <div className="bloom-note">{latest.scope_note}</div>
        </Section>
      )}
    </>
  )
}

/* ==================================================================
   10 协作与任务
   ================================================================== */

function TeamUnit({ projectId }: UnitProps) {
  const membersQuery = useProjectMembers(projectId)

  if (membersQuery.isPending) return <PanelLoading label="项目成员" />
  if (membersQuery.isError) {
    return <PanelError label="项目成员" onRetry={() => void membersQuery.refetch()} />
  }

  const members = membersQuery.data.items
  const lead = members.filter((member) => member.role_key === 'project_lead').length
  const reviewers = members.filter((member) => member.role_key === 'reviewer').length

  return (
    <>
      <MetricGrid
        items={[
          { label: '项目成员', value: formatCount(members.length), hint: 'project members' },
          { label: '负责人', value: formatCount(lead), hint: 'project_lead' },
          { label: '复核员', value: formatCount(reviewers), hint: 'reviewer' },
          {
            label: '权限边界',
            value: 'RBAC',
            hint: '按项目隔离',
          },
        ]}
      />

      <Section title="成员与角色" icon={Users} note="来自后端成员表">
        {members.length === 0 ? (
          <EmptyNote title="尚无项目成员" description="邀请成员后，角色与权限会显示在这里。" />
        ) : (
          <div className="bloom-list">
            {members.map((member) => {
              const initial = (member.display_name || member.email || '?').slice(0, 1).toUpperCase()
              return (
                <div key={member.user_id} className="bloom-list__row">
                  <span
                    className="bloom-avatar"
                    style={{ marginLeft: 0, width: 28, height: 28 }}
                    aria-hidden="true"
                  >
                    {initial}
                  </span>
                  <span className="bloom-list__main">
                    <span className="bloom-list__title">{member.display_name || member.email}</span>
                    <span className="bloom-list__meta">{member.email}</span>
                  </span>
                  <Chip tone={member.role_key === 'project_lead' ? 'success' : 'neutral'}>
                    {memberRole(member.role_key)}
                  </Chip>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <div className="bloom-note">
        所有成员与角色由后端项目成员接口返回；界面不缓存权限判断，实际操作仍由服务端校验。
      </div>
    </>
  )
}

/* ==================================================================
   统一入口
   ================================================================== */

export function UnitDetail({ unitId, projectId }: { unitId: BloomUnitId; projectId: string }) {
  switch (unitId) {
    case 'materials':
      return <MaterialsUnit projectId={projectId} />
    case 'dataset':
      return <DatasetUnit projectId={projectId} />
    case 'facts':
      return <FactsUnit projectId={projectId} />
    case 'evidence':
      return <EvidenceUnit projectId={projectId} />
    case 'plan':
      return <PlanUnit projectId={projectId} />
    case 'environment':
      return <EnvironmentUnit projectId={projectId} />
    case 'runs':
      return <RunsUnit projectId={projectId} />
    case 'verification':
      return <VerificationUnit projectId={projectId} />
    case 'report':
      return <ReportUnit projectId={projectId} />
    case 'team':
      return <TeamUnit projectId={projectId} />
    default:
      return null
  }
}
