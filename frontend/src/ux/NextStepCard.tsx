import { useMemo } from 'react'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import {
  useFactsSummary,
  useProjectMaterials,
  useProjectTasks,
  useReproPlans,
  useReproReports,
  useReproRuns,
} from '../bloom/unitDetailParts'

type Step = {
  index: number
  total: number
  tag: string
  title: string
  action: string
  to: string
  secondary?: { label: string; to: string }
  done?: boolean
}

function projectIdFromPath(pathname: string): string | null {
  if (pathname === '/projects/new') return null
  const match = pathname.match(/^\/projects\/([^/]+)(?:\/|$)/)
  if (!match || match[1] === 'new') return null
  return match[1]
}

export default function NextStepCard() {
  const { pathname } = useLocation()
  const projectId = projectIdFromPath(pathname)
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
    enabled: pathname === '/projects',
    staleTime: 15_000,
  })
  const materials = useProjectMaterials(projectId ?? '')
  const hasPaper = materials.data?.items.some((m) => ['pdf', 'readme', 'text'].includes(m.material_type))
  const tasks = useProjectTasks(hasPaper ? projectId ?? '' : '')
  const hasCompletedTask = tasks.data?.items.some((t) => ['completed', 'partially_completed'].includes(t.status))
  const facts = useFactsSummary(hasCompletedTask ? projectId ?? '' : '')
  const plans = useReproPlans(facts.data?.total ? projectId ?? '' : '')
  const runs = useReproRuns(plans.data?.items.length ? projectId ?? '' : '')
  const reports = useReproReports(runs.data?.items.length ? projectId ?? '' : '')

  const step = useMemo<Step | null>(() => {
    if (pathname === '/projects') {
      const first = projects.data?.items?.[0]
      if (first) {
        return {
          index: 1,
          total: 5,
          tag: '最近项目',
          title: first.name,
          action: '打开工作台',
          to: `/projects/${first.id}/workbench`,
          secondary: { label: '四步引导', to: '/start/reproduce' },
        }
      }
      return {
        index: 0,
        total: 5,
        tag: '起点',
        title: '新建首个复现项目',
        action: '新建项目',
        to: '/projects/new',
        secondary: { label: '四步引导', to: '/start/reproduce' },
      }
    }
    if (!projectId) return null
    if (
      materials.isLoading ||
      tasks.isLoading ||
      facts.isLoading ||
      plans.isLoading ||
      runs.isLoading ||
      reports.isLoading
    ) {
      return null
    }

    const materialItems = materials.data?.items ?? []
    const paper = materialItems.find((m) => ['pdf', 'readme', 'text'].includes(m.material_type))
    const taskItems = tasks.data?.items ?? []
    const completed = taskItems.filter((t) => ['completed', 'partially_completed'].includes(t.status))
    const failed = taskItems.filter((t) => ['failed', 'unsupported'].includes(t.status))

    if (!paper) {
      return {
        index: 0,
        total: 5,
        tag: '01/05',
        title: '上传论文材料',
        action: '添加论文',
        to: `/start/reproduce?project=${projectId}&step=1`,
        secondary: { label: '材料清单', to: `/projects/${projectId}/materials` },
      }
    }
    if (!completed.length) {
      if (failed.length) {
        return {
          index: 1,
          total: 5,
          tag: '异常',
          title: '解析任务失败',
          action: '查看任务',
          to: `/projects/${projectId}/tasks`,
          secondary: { label: '材料', to: `/projects/${projectId}/materials` },
        }
      }
      return {
        index: 1,
        total: 5,
        tag: '02/05',
        title: '启动论文解析',
        action: '去解析',
        to: `/projects/${projectId}/materials`,
        secondary: { label: '任务队列', to: `/projects/${projectId}/tasks` },
      }
    }
    if ((facts.data?.total ?? 0) === 0) {
      return {
        index: 2,
        total: 5,
        tag: '02/05',
        title: '核对抽取事实',
        action: '查看事实',
        to: `/projects/${projectId}/facts`,
      }
    }
    if (!(plans.data?.items?.length ?? 0)) {
      return {
        index: 2,
        total: 5,
        tag: '03/05',
        title: '拆解复现步骤',
        action: '建立规划',
        to: `/projects/${projectId}/reproduction`,
        secondary: { label: '补材料', to: `/projects/${projectId}/materials` },
      }
    }
    if (!(runs.data?.items?.length ?? 0)) {
      return {
        index: 3,
        total: 5,
        tag: '04/05',
        title: '创建复现运行',
        action: '进入运行',
        to: `/projects/${projectId}/reproduction`,
      }
    }
    if (!(reports.data?.items?.length ?? 0)) {
      return {
        index: 4,
        total: 5,
        tag: '05/05',
        title: '汇总审计报告',
        action: '生成报告',
        to: `/projects/${projectId}/reproduction/reports`,
        secondary: { label: '结果对照', to: `/projects/${projectId}/reproduction/comparison` },
      }
    }
    return {
      index: 5,
      total: 5,
      tag: '完成',
      title: '审计报告已就绪',
      action: '打开报告',
      to: `/projects/${projectId}/reproduction/reports`,
      secondary: { label: '复核证据', to: `/projects/${projectId}/facts` },
      done: true,
    }
  }, [
    pathname,
    projectId,
    projects.data,
    materials.data,
    materials.isLoading,
    tasks.data,
    tasks.isLoading,
    facts.data,
    facts.isLoading,
    plans.data,
    plans.isLoading,
    runs.data,
    runs.isLoading,
    reports.data,
    reports.isLoading,
  ])

  if (!step) return null

  return (
    <aside className="rc-step-strip" aria-label="当前进度与下一步">
      <div className="rc-step-strip__left">
        {step.done ? (
          <CheckCircle2 size={15} style={{ color: 'var(--rc-success)', flexShrink: 0 }} aria-hidden="true" />
        ) : (
          <div className="rc-step-strip__dots" aria-hidden="true">
            {Array.from({ length: step.total }, (_, i) => (
              <span
                key={i}
                className={`rc-step-strip__dot${
                  i < step.index ? ' is-done' : i === step.index ? ' is-current' : ''
                }`}
              />
            ))}
          </div>
        )}
        <span className="rc-step-strip__tag">{step.tag}</span>
        <strong className="rc-step-strip__title">{step.title}</strong>
      </div>
      <div className="rc-step-strip__actions">
        {step.secondary && (
          <Link to={step.secondary.to} className="rc-step-strip__secondary">
            {step.secondary.label}
          </Link>
        )}
        <Link to={step.to} className="rc-step-strip__cta">
          {step.action}
          <ArrowRight size={13} />
        </Link>
      </div>
    </aside>
  )
}
