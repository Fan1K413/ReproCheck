/**
 * 项目档案（图2 空间层叠卡 + §2.2 关联关系聚焦展开）
 *
 * 真实数据绑定：
 *   - GET /projects（queryKey ['projects']）→ Project{id,name,domain,paper_title,description,created_at}
 *   - 关联关系：Bloom WorkbenchUnitData.units（bloom/useBloomUnits.ts），真实单元读数来自
 *     materials / dataset / facts / evidence / plan / environment / runs / verification / report / team
 *
 * 交互（§2.2 项目关系聚焦 Focus Graph）：
 *   选中项目卡 → 关联迷你画布淡入（400ms 沿透视轴），节点点击跳真实路由；
 *   <640px 隐藏迷你画布，改为卡片内「关联单元」chip → 底部抽屉列出真实关联。
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FolderKanban, Orbit } from 'lucide-react'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { StatusBadge, type Tone } from '../components/StatusBadge'
import { formatDateTime } from '../features/format'
import { api } from '../services/api'
import type { Project } from '../types/api'
import { useBloomUnits } from '../bloom/useBloomUnits'
import type { BloomUnit } from '../bloom/types'
import '../styles/wave-c-verify.css'

/** Bloom tone → 卡片顶部 2px 阶段条配色（对应 §4.2 的四档阶段色）。 */
const TONE_STAGE: Record<Tone, string> = {
  accent: 'rc2-card__stage--accent',
  success: 'rc2-card__stage--success',
  neutral: 'rc2-card__stage--neutral',
  navy: 'rc2-card__stage--pending',
  warning: 'rc2-card__stage--accent',
  danger: 'rc2-card__stage--accent',
}

function isNarrowViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 639px)').matches
}

function RelationNode({ unit }: { unit: BloomUnit }) {
  const target = unit.links[0]?.to
  const label = `${unit.title}，${unit.metric}${unit.metricLabel}，${unit.status}`
  const inner = (
    <>
      <span className="rc2-node__dot" aria-hidden="true" />
      <span className="rc2-node__text">
        <span className="rc2-node__title">{unit.title}</span>
        <span className="rc2-node__meta">
          {unit.loading
            ? '读取中…'
            : unit.failed
              ? '读取失败'
              : `${unit.metric} ${unit.metricLabel} · ${unit.status}`}
        </span>
        {!unit.loading && !unit.failed && unit.summary ? (
          <span className="rc2-node__meta">{unit.summary}</span>
        ) : null}
      </span>
    </>
  )

  if (!target) {
    return (
      <div className="rc2-node" role="group" aria-label={label}>
        {inner}
      </div>
    )
  }

  return (
    <Link className="rc2-node" to={target} aria-label={label} title={unit.links[0]?.label}>
      {inner}
      <Icon name="externalLink" size="xs" tone="subtle" />
    </Link>
  )
}

/** 关联面板：只有聚焦项目才挂载，因此只对被选中的项目发起真实查询。 */
function RelationPanel({ projectId, onTone }: { projectId: string; onTone?: (tone: Tone) => void }) {
  const { units } = useBloomUnits(projectId)
  const visible = units.slice(0, 12)
  const readable = visible.filter((unit) => !unit.loading && !unit.failed)

  useEffect(() => {
    if (!onTone) return
    const signal =
      units.find((unit) => unit.tone === 'success') ?? units.find((unit) => unit.tone === 'accent')
    onTone(signal?.tone ?? 'neutral')
  }, [onTone, units])

  return (
    <section className="rc2-rel" aria-label="项目关联关系" role="group">
      <div className="rc2-rel__head">
        <h3 className="rc2-rel__title">关联关系</h3>
        <StatusBadge tone="neutral">{visible.length} 个单元</StatusBadge>
      </div>
      {readable.length === 0 && visible.every((unit) => unit.loading || unit.failed) ? (
        <p className="rc2-rel__empty">
          {visible.some((unit) => unit.loading)
            ? '正在读取关联单元…'
            : '尚未建立关联，或关联数据读取失败。'}
        </p>
      ) : (
        <div className="rc2-rel__list rcw-rise" key={projectId}>
          {visible.map((unit) => (
            <RelationNode key={unit.id} unit={unit} />
          ))}
        </div>
      )}
      <p className="rcw-overline mt-4">节点读数来自真实后端聚合；无数据的单元不画连线。</p>
    </section>
  )
}

export default function ProjectsPage() {
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.getProjects })
  const [focusId, setFocusId] = useState<string | null>(null)
  const [focusTone, setFocusTone] = useState<Tone>('neutral')
  const [drawerOpen, setDrawerOpen] = useState(false)

  const projects = useMemo(() => projectsQuery.data?.items ?? [], [projectsQuery.data])

  const kpis = useMemo(() => {
    const domains = new Set(projects.map((project) => project.domain).filter(Boolean))
    const papers = new Set(projects.map((project) => project.paper_title).filter(Boolean))
    const latest = projects.reduce<string | null>(
      (acc, project) => (!acc || project.created_at > acc ? project.created_at : acc),
      null,
    )
    return {
      total: projectsQuery.data?.total ?? projects.length,
      domains: domains.size,
      papers: papers.size,
      latest,
    }
  }, [projects, projectsQuery.data])

  const focused = projects.find((project) => project.id === focusId) ?? null

  function toggleFocus(project: Project) {
    if (isNarrowViewport()) {
      setFocusId(project.id)
      setDrawerOpen(true)
      return
    }
    setFocusId(focusId === project.id ? null : project.id)
  }

  return (
    <div className="rc2-page">
      <header className="rc2-hero">
        <div className="min-w-0">
          <p className="rcw-overline">项目档案 · 全量清单</p>
          <h1 className="rc2-hero__title mt-2">项目档案</h1>
          <p className="rc2-hero__desc">
            每个项目是一份可展开的审计档案：选中后浮出关联的论文、数据、代码与任务单元。全部读数来自后端项目库与 Bloom 真实聚合，无数据不虚构。
          </p>
        </div>
        <Link to="/projects/new" className="btn-primary">
          <Icon name="plus" size="sm" />
          新建项目
        </Link>
      </header>

      <section className="rc2-kpis" aria-label="项目概览指标">
        {[
          { label: '项目总数', value: String(kpis.total), foot: '后端项目库计数' },
          { label: '研究领域', value: String(kpis.domains), foot: '已登记领域去重' },
          { label: '关联论文', value: String(kpis.papers), foot: '已关联论文去重' },
          {
            label: '最近更新',
            value: kpis.latest ? formatDateTime(kpis.latest).slice(0, 10) : '—',
            foot: '最近创建项目时间',
          },
        ].map((kpi, index) => (
          <div key={kpi.label} className="rc2-kpi rcw-rise" style={{ '--rcw-i': index } as CSSProperties}>
            <p className="rc2-kpi__label">{kpi.label}</p>
            <p className="rc2-kpi__value">{kpi.value}</p>
            <p className="rc2-kpi__foot">{kpi.foot}</p>
          </div>
        ))}
      </section>

      {projectsQuery.isPending ? (
        <section className="rc2-card">
          <LoadingState message="正在读取项目列表…" />
        </section>
      ) : projectsQuery.isError ? (
        <section className="rc2-card">
          <ErrorState
            message="无法获取项目列表，请确认后端服务已启动。"
            onRetry={() => void projectsQuery.refetch()}
          />
        </section>
      ) : projects.length === 0 ? (
        <section className="rc2-card rc2-card--empty">
          <EmptyState
            compact
            icon={FolderKanban}
            title="尚无项目"
            description="创建第一个复现审计项目档案后，项目会显示在这里。"
            action={
              <Link to="/projects/new" className="btn-primary">
                <Icon name="plus" size="sm" />
                去创建一个
              </Link>
            }
          />
        </section>
      ) : (
        <div className="rc2-stack">
          <div className="rc2-stack__cards">
            {projects.map((project, index) => {
              const isActive = project.id === focusId
              const stageClass = isActive ? TONE_STAGE[focusTone] : 'rc2-card__stage--neutral'
              return (
                <article
                  key={project.id}
                  className={`rc2-card rcw-rise${isActive ? ' rc2-card--active' : ''}`}
                  style={{ '--rcw-i': index } as CSSProperties}
                >
                  <span className={`rc2-card__stage ${stageClass}`} aria-hidden="true" />
                  <div className="rc2-card__head">
                    <span className="rc2-card__index" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="rc2-card__body">
                      <h3 className="rc2-card__title">{project.name}</h3>
                      <p className="rc2-card__paper">{project.paper_title || '未登记论文标题'}</p>
                      <p className="rc2-card__desc">{project.description || '暂无描述'}</p>
                      <div className="rc2-card__meta">
                        <span>领域 · {project.domain || '—'}</span>
                        <span>创建 · {formatDateTime(project.created_at)}</span>
                        <span className="mono">{project.id}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rc2-card__actions">
                    <button
                      type="button"
                      className={`rc2-link${isActive ? ' rc2-link--primary' : ''}`}
                      aria-pressed={isActive}
                      aria-controls="rc-project-relations"
                      onClick={() => toggleFocus(project)}
                    >
                      <Icon name="network" size="xs" />
                      {isActive ? '收起关联' : '展开关联'}
                    </button>

                    {isActive && (
                      <button
                        type="button"
                        className="rc2-link rc2-link--mobile-only"
                        onClick={() => setDrawerOpen(true)}
                      >
                        <Icon name="listTree" size="xs" />
                        关联单元
                      </button>
                    )}

                    <Link className="rc2-link" to={`/projects/${project.id}/workbench`}>
                      <Icon as={Orbit} size="xs" />
                      Bloom 账本
                    </Link>
                    <Link className="rc2-link" to={`/projects/${project.id}/materials`}>
                      <Icon name="file" size="xs" />
                      管理材料
                    </Link>
                    <Link className="rc2-link" to={`/projects/${project.id}/overview`}>
                      <Icon name="externalLink" size="xs" />
                      解析概览
                    </Link>
                    <Link className="rc2-link" to={`/projects/${project.id}/handoff`}>
                      <Icon name="download" size="xs" />
                      交接包
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>

          <aside className="rc2-stack__side" id="rc-project-relations">
            {focused ? (
              <RelationPanel key={focused.id} projectId={focused.id} onTone={setFocusTone} />
            ) : (
              <section className="rc2-rel" aria-label="项目关联关系">
                <div className="rc2-rel__head">
                  <h3 className="rc2-rel__title">关联关系</h3>
                  <Icon name="network" size="sm" tone="subtle" />
                </div>
                <p className="rc2-rel__empty">
                  选择左侧任意项目卡片，这里会展开该项目与论文 / 数据 / 代码 / 任务之间的真实关联节点。
                </p>
                <p className="rcw-overline mt-4">
                  阶段条：紫=读取中 · 亮紫=进行中 · 薄荷青=已完成 · 中性=未聚焦
                </p>
              </section>
            )}
          </aside>
        </div>
      )}

      {/* 窄屏底部抽屉：列出真实关联单元（L3 浮层） */}
      {drawerOpen && focused && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ backgroundColor: 'var(--rc-scrim)', backdropFilter: 'var(--rc-blur-scrim)' }}
          role="dialog"
          aria-modal="true"
          aria-label="项目关联列表"
          onClick={(event) => {
            if (event.target === event.currentTarget) setDrawerOpen(false)
          }}
        >
          <div
            className="w-full overflow-y-auto border-t"
            style={{
              backgroundColor: 'var(--rc-bg-2)',
              borderColor: 'var(--rc-border)',
              borderRadius: 'var(--rc-radius-lg) var(--rc-radius-lg) 0 0',
              padding: 'var(--rc-space-5)',
              paddingBottom: 'calc(var(--rc-space-5) + env(safe-area-inset-bottom))',
              maxHeight: '70vh',
            }}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="rc2-rel__title">{focused.name} · 关联单元</h3>
              <button
                type="button"
                className="rc2-link"
                onClick={() => setDrawerOpen(false)}
                aria-label="关闭关联列表"
              >
                <Icon name="x" size="xs" />
                关闭
              </button>
            </div>
            <RelationPanel projectId={focused.id} />
          </div>
        </div>
      )}
    </div>
  )
}
