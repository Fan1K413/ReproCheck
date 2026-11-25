import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ClipboardList,
  FileText,
  FolderKanban,
  ListChecks,
  Orbit,
  ShieldCheck,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { LoadingState } from '../components/LoadingState'
import { formatCount } from '../features/format'
import { materialTypeLabel } from '../features/stage2Meta'
import { useTrackProject } from '../hooks/useTrackProject'
import { ApiError, api } from '../services/api'
import type { MaterialType, ParseOverview } from '../types/api'
import '../styles/overview-showcase.css'
import '../styles/wave-b-material.css'

/** 后端 parse-overview 额外返回 tasks 聚合，局部扩展类型（不改共享 types） */
type ParseOverviewExtra = ParseOverview & {
  tasks?: { completed?: number; total?: number }
}

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'neutral'

/** 仪表盘几何（viewBox 1000×1000） */
const CX = 500
const CY = 500
const R_ARC = 330
const R_TICK_OUTER = 412
const R_TICK_INNER = 384
const C = 2 * Math.PI * R_ARC

type Readout = {
  id: string
  label: string
  field: string
  value: number | null | undefined
  tone: Tone
  x: number
  y: number
}

export default function OverviewPage() {
  const projectId = useParams().projectId ?? ''
  useTrackProject(projectId)

  const overviewQuery = useQuery({
    queryKey: ['parse-overview', projectId],
    queryFn: () => api.getParseOverview(projectId),
    enabled: !!projectId,
  })

  const overview = overviewQuery.data as ParseOverviewExtra | undefined
  const base = `/projects/${projectId}`

  if (overviewQuery.isPending) {
    return <LoadingState message="正在读取解析概览…" hint="正在汇总材料与事实统计" />
  }
  if (overviewQuery.isError) {
    return (
      <ErrorState
        message={overviewQuery.error instanceof Error ? overviewQuery.error.message : '无法获取解析概览。'}
        code={overviewQuery.error instanceof ApiError ? overviewQuery.error.code : undefined}
        onRetry={() => void overviewQuery.refetch()}
      />
    )
  }
  if (!overview) {
    return <EmptyState title="暂无概览数据" description="后端未返回该项目的解析概览。" />
  }

  const materials = overview.materials
  const facts = overview.facts
  const llm = overview.llm

  const typeEntries = Object.entries(overview.by_type ?? {}).sort((a, b) => b[1] - a[1])
  const maxTypeCount = typeEntries.reduce((max, [, count]) => Math.max(max, count), 0)
  const materialTotal = materials?.total ?? 0
  const noMaterials = materialTotal === 0

  /** 仪表弧段：长度 ∝ 真实计数 */
  const arcs = [
    { key: 'completed', label: '解析成功', value: materials?.completed ?? 0, tone: 'success' },
    {
      key: 'partially_completed',
      label: '部分完成',
      value: materials?.partially_completed ?? 0,
      tone: 'warning',
    },
    { key: 'failed', label: '解析失败', value: materials?.failed ?? 0, tone: 'danger' },
    { key: 'pending', label: '等待解析', value: materials?.pending ?? 0, tone: 'info' },
  ]
  const arcTotal = arcs.reduce((sum, arc) => sum + arc.value, 0)
  let arcOffset = 0
  const arcSegments = arcs.map((arc) => {
    const length = arcTotal > 0 ? (arc.value / arcTotal) * C : 0
    const segment = { ...arc, length, offset: arcOffset }
    arcOffset += length
    return segment
  })

  /** 四角读数：全部绑定真实字段 */
  const readouts: Readout[] = [
    {
      id: 'materials',
      label: '材料总数',
      field: 'materials.total',
      value: materials?.total,
      tone: 'neutral',
      x: 360,
      y: 360,
    },
    {
      id: 'facts',
      label: '事实总量',
      field: 'facts.total',
      value: facts?.total,
      tone: 'violet',
      x: 640,
      y: 360,
    },
    {
      id: 'evidence',
      label: '证据已绑定',
      field: 'facts.with_evidence',
      value: facts?.with_evidence,
      tone: 'success',
      x: 360,
      y: 640,
    },
    {
      id: 'calls',
      label: 'LLM 调用',
      field: 'llm.total_calls',
      value: llm?.total_calls,
      tone: 'info',
      x: 640,
      y: 640,
    },
  ]

  const cards: {
    label: string
    field: string
    value: number | null | undefined
    tone: Tone
  }[] = [
    { label: '材料总数', field: 'materials.total', value: materials?.total, tone: 'neutral' },
    { label: '解析成功', field: 'materials.completed', value: materials?.completed, tone: 'success' },
    {
      label: '部分完成',
      field: 'materials.partially_completed',
      value: materials?.partially_completed,
      tone: 'warning',
    },
    { label: '解析失败', field: 'materials.failed', value: materials?.failed, tone: 'danger' },
    { label: '等待解析', field: 'materials.pending', value: materials?.pending, tone: 'info' },
    { label: '事实总量', field: 'facts.total', value: facts?.total, tone: 'violet' },
    {
      label: '证据已绑定',
      field: 'facts.with_evidence',
      value: facts?.with_evidence,
      tone: 'success',
    },
    { label: '待复核事实', field: 'facts.needs_review', value: facts?.needs_review, tone: 'warning' },
    {
      label: '人工修订',
      field: 'facts.human_revised',
      value: facts?.human_revised,
      tone: 'info',
    },
    { label: 'LLM 调用', field: 'llm.total_calls', value: llm?.total_calls, tone: 'violet' },
    { label: 'Token 总量', field: 'llm.total_tokens', value: llm?.total_tokens, tone: 'violet' },
    ...(overview.tasks?.completed != null
      ? [
          {
            label: '已完成任务',
            field: 'tasks.completed',
            value: overview.tasks.completed,
            tone: 'success' as Tone,
          },
        ]
      : []),
  ]

  const ticks = Array.from({ length: 36 }, (_, index) => index * 10)

  return (
    <div className="mb-page">
      <header className="mb-head">
        <div className="min-w-0">
          <p className="mb-head__eyebrow">解析概览</p>
          <h1 className="mb-head__title">解析概览</h1>
          <p className="mb-head__desc">材料、任务与事实分布</p>
        </div>
        <nav className="mb-head__actions">
          <Link to={`${base}/workbench`} className="btn-primary">
            <Icon as={Orbit} size="sm" />
            Bloom 账本
          </Link>
          <Link to={`${base}/materials`} className="btn-ghost">
            <Icon name="file" size="sm" />
            材料管理
          </Link>
          <Link to={`${base}/tasks`} className="btn-ghost">
            <Icon name="listTree" size="sm" />
            解析任务
          </Link>
          <Link to={`${base}/facts`} className="btn-ghost">
            <Icon name="clipboardCheck" size="sm" />
            科研事实
          </Link>
          <Link to={`${base}/data-audit`} className="btn-ghost">
            <Icon name="shield" size="sm" />
            数据质量审计
          </Link>
        </nav>
      </header>

      {noMaterials && (
        <section className="mb-panel">
          <div className="mb-panel__body">
            <EmptyState
              compact
              icon={FolderKanban}
              title="该项目尚无材料"
              description="上传材料并发起解析后，这里的统计与分布会由后端实时生成。"
              action={
                <Link to={`${base}/materials`} className="btn-primary">
                  去上传材料
                </Link>
              }
            />
          </div>
        </section>
      )}

      <div className="mb-split">
        {/* 左 8 列：仪表 + 类型分布 */}
        <div className="flex min-w-0 flex-col gap-6">
          <section className="mb-panel mb-panel--grid" aria-label="解析状态仪表">
            <div className="mb-panel__head">
              <h3 className="mb-panel__title">
                <Icon as={Activity} size="sm" tone="accent" />
                材料状态仪表
              </h3>
            </div>
            <div className="mb-panel__body">
              <div className="ov-stage">
                <svg
                  className="ov-stage__svg"
                  viewBox="0 0 1000 1000"
                  role="img"
                  aria-label={`材料状态仪表：共 ${materialTotal} 份材料`}
                >
                  {/* 基准环 */}
                  <circle className="ov-ring" cx={CX} cy={CY} r={R_ARC} strokeWidth={46} />
                  <circle className="ov-ring" cx={CX} cy={CY} r={250} />
                  <circle className="ov-ring ov-ring--strong" cx={CX} cy={CY} r={108} />

                  {/* 刻度 */}
                  {ticks.map((deg) => {
                    const rad = ((deg - 90) * Math.PI) / 180
                    const major = deg % 90 === 0
                    const outer = major ? R_TICK_OUTER : R_TICK_INNER
                    return (
                      <line
                        key={deg}
                        className={`ov-tick ${major ? 'ov-tick--major' : ''}`}
                        x1={CX + Math.cos(rad) * R_ARC}
                        y1={CY + Math.sin(rad) * R_ARC}
                        x2={CX + Math.cos(rad) * outer}
                        y2={CY + Math.sin(rad) * outer}
                      />
                    )
                  })}

                  {/* 数据弧段（真实占比） */}
                  {arcTotal > 0 &&
                    arcSegments
                      .filter((segment) => segment.length > 0)
                      .map((segment) => (
                        <circle
                          key={segment.key}
                          className={`ov-arc ov-arc--${segment.tone}`}
                          cx={CX}
                          cy={CY}
                          r={R_ARC}
                          strokeDasharray={`${segment.length} ${C - segment.length}`}
                          strokeDashoffset={-segment.offset}
                          transform={`rotate(-90 ${CX} ${CY})`}
                        >
                          <title>
                            {segment.label}：{segment.value} 份（{arcTotal > 0 ? ((segment.value / arcTotal) * 100).toFixed(1) : '0.0'}%）
                          </title>
                        </circle>
                      ))}

                  {/* 四角锚点 */}
                  {readouts.map((readout) => (
                    <circle
                      key={`dot-${readout.id}`}
                      className="ov-dot ov-dot--muted"
                      cx={readout.x}
                      cy={readout.y}
                      r={5}
                    />
                  ))}
                </svg>

                {/* 读数浮层（HTML 排印，字号走 --rc-fs-* 层级） */}
                <div
                  className="ov-float ov-float--core"
                  style={{ left: '50%', top: '50%' }}
                  aria-hidden="true"
                >
                  <span className="ov-float__value">{formatCount(facts?.total)}</span>
                  <span className="ov-float__label">事实总量</span>
                </div>

                {readouts.map((readout) => (
                  <div
                    key={readout.id}
                    className="ov-float"
                    style={{ left: `${readout.x / 10}%`, top: `${readout.y / 10}%` }}
                  >
                    <span className="ov-float__value">{formatCount(readout.value)}</span>
                    <span className="ov-float__label">{readout.label}</span>
                  </div>
                ))}
              </div>

              {/* 弧段图例：数值同时以文字表达，不只靠颜色 */}
              <ul className="mt-4 flex flex-wrap gap-2">
                {arcSegments.map((segment) => (
                  <li
                    key={segment.key}
                    className="mb-chip mb-chip--static"
                    style={{ borderColor: 'var(--rc-border-hair)' }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 'var(--rc-radius-disc)',
                        backgroundColor:
                          segment.tone === 'success'
                            ? 'var(--rc-success)'
                            : segment.tone === 'warning'
                              ? 'var(--rc-warning)'
                              : segment.tone === 'danger'
                                ? 'var(--rc-danger)'
                                : 'var(--rc-info)',
                      }}
                    />
                    {segment.label}
                    <span className="mb-chip__count">
                      {segment.value} ·{' '}
                      {arcTotal > 0 ? ((segment.value / arcTotal) * 100).toFixed(1) : '0.0'}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="mb-panel" aria-label="材料类型分布">
            <div className="mb-panel__head">
              <h3 className="mb-panel__title">
                <Icon name="grid" size="sm" tone="accent" />
                材料类型分布
              </h3>
            </div>
            <div className="mb-panel__body">
              {typeEntries.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                  后端未返回材料类型分布。
                </p>
              ) : (
                <div className="ov-dist">
                  {typeEntries.map(([type, count]) => {
                    const percent = maxTypeCount > 0 ? (count / maxTypeCount) * 100 : 0
                    return (
                      <div key={type} className="ov-dist__row">
                        <span className="ov-dist__name">
                          {materialTypeLabel[type as MaterialType] ?? type}
                        </span>
                        <span className="ov-dist__track">
                          <span className="ov-dist__bar" style={{ width: `${percent}%` }} />
                        </span>
                        <span className="ov-dist__n">{count}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* 右 4 列：概览卡 */}
        <div className="flex min-w-0 flex-col gap-6">
          <section className="mb-panel" aria-label="解析概览卡">
            <div className="mb-panel__head">
              <h3 className="mb-panel__title">
                <Icon name="grid" size="sm" tone="accent" />
                概览卡
              </h3>
              <span className="mb-panel__hint">{cards.length} 项读数</span>
            </div>
            <div className="mb-panel__body">
              <div className="ov-readouts">
                {cards.map((card) => (
                  <div key={card.field} className="ov-readout">
                    <p className="ov-readout__label">{card.label}</p>
                    <p className={`ov-readout__value ov-readout__value--${card.tone}`}>
                      {formatCount(card.value)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mb-panel" aria-label="证据链索引">
            <div className="mb-panel__head">
              <h3 className="mb-panel__title">
                <Icon as={ShieldCheck} size="sm" tone="accent" />
                证据链索引
              </h3>
            </div>
            <div className="mb-panel__body flex flex-col gap-3">
              <dl className="mb-dl">
                <div className="mb-dl__row">
                  <dt className="mb-dl__key">证据覆盖</dt>
                  <dd className="mb-dl__val">
                    {formatCount(facts?.with_evidence)} / {formatCount(facts?.total)}
                  </dd>
                </div>
                <div className="mb-dl__row">
                  <dt className="mb-dl__key">项目 ID</dt>
                  <dd className="mb-dl__val">{overview.project_id}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Link to={`${base}/facts`} className="btn-ghost">
                  <Icon as={ClipboardList} size="sm" />
                  科研事实
                </Link>
                <Link to={`${base}/tasks`} className="btn-ghost">
                  <Icon as={ListChecks} size="sm" />
                  解析任务
                </Link>
                <Link to={`${base}/materials`} className="btn-ghost">
                  <Icon as={FileText} size="sm" />
                  材料管理
                </Link>
                <Link to={`${base}/evidence-graph`} className="btn-ghost">
                  <Icon name="network" size="sm" />
                  证据图谱
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
