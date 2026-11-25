import { useMemo } from 'react'
import { ArrowRight, CheckCircle2, CircleHelp, Sparkles } from 'lucide-react'
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
  title: string
  detail: string
  action: string
  to: string
  secondary?: { label: string; to: string }
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
          title: `继续「${first.name}」`,
          detail: '打开最近项目，或从头走一遍四步复现引导。',
          action: '打开项目',
          to: `/projects/${first.id}/workbench`,
          secondary: { label: '重新开始引导', to: '/start/reproduce' },
        }
      }
      return {
        title: '先建立一个项目',
        detail: '项目会把你接下来上传的论文、数据和结果放在同一个地方。',
        action: '新建项目',
        to: '/projects/new',
        secondary: { label: '用四步引导开始', to: '/start/reproduce' },
      }
    }
    if (!projectId) return null
    if (materials.isLoading || tasks.isLoading || facts.isLoading ||
        plans.isLoading || runs.isLoading || reports.isLoading) {
      return {
        title: '正在查看项目状态…',
        detail: '只读取真实项目数据，不会用示例进度代替。',
        action: '打开项目材料',
        to: `/projects/${projectId}/materials`,
      }
    }

    const materialItems = materials.data?.items ?? []
    const paper = materialItems.find((m) => m.material_type === 'pdf' || m.material_type === 'readme' || m.material_type === 'text')
    const data = materialItems.find((m) => m.material_type === 'csv' || m.material_type === 'xlsx')
    const code = materialItems.find((m) => ['python', 'notebook', 'zip', 'requirements', 'code_repository'].includes(m.material_type))
    const taskItems = tasks.data?.items ?? []
    const completed = taskItems.filter((t) => t.status === 'completed' || t.status === 'partially_completed')
    const failed = taskItems.filter((t) => t.status === 'failed' || t.status === 'unsupported')

    if (!paper) {
      return {
        title: '第一步：添加论文',
        detail: materialItems.length
          ? '项目里已有材料，但还没有可识别的论文。上传论文 PDF 才能开始核对。'
          : '项目还是空的。先上传你要复现的论文 PDF；数据与代码可以稍后再补。',
        action: '添加论文',
        to: `/start/reproduce?project=${projectId}&step=1`,
        secondary: { label: '查看材料清单', to: `/projects/${projectId}/materials` },
      }
    }
    if (!completed.length) {
      if (failed.length) {
        return {
          title: '论文解析遇到问题',
          detail: '有解析任务失败。先看失败原因，再决定重新上传还是换文件格式。',
          action: '查看失败原因',
          to: `/projects/${projectId}/tasks`,
          secondary: { label: '重新查看材料', to: `/projects/${projectId}/materials` },
        }
      }
      return {
        title: '第二步：让系统读一遍论文',
        detail: '论文已上传，但还没有完成解析。解析后才会出现原文块和可核对的事实。',
        action: '去解析论文',
        to: `/projects/${projectId}/materials`,
        secondary: { label: '查看任务状态', to: `/projects/${projectId}/tasks` },
      }
    }
    if ((facts.data?.total ?? 0) === 0) {
      return {
        title: '检查论文读到了什么',
        detail: '解析已经完成，但还没有抽出可核对的事实。打开材料详情或事实页确认是否需要重试。',
        action: '查看科研事实',
        to: `/projects/${projectId}/facts`,
        secondary: { label: '打开材料详情', to: `/projects/${projectId}/materials` },
      }
    }
    const planCount = plans.data?.items?.length ?? 0
    if (!planCount) {
      return {
        title: '第三步：把复现拆成步骤',
        detail: data || code
          ? '论文信息已读出。现在创建复现规划，把数据、代码和判断标准写成可执行步骤。'
          : '论文信息已读出。还可以补充数据或代码，也可以先建立规划，把缺项记录进去。',
        action: '创建复现规划',
        to: `/projects/${projectId}/reproduction`,
        secondary: data || code
          ? { label: '再补材料', to: `/projects/${projectId}/materials` }
          : { label: '补充数据或代码', to: `/start/reproduce?project=${projectId}&step=3` },
      }
    }
    const runCount = runs.data?.items?.length ?? 0
    if (!runCount) {
      return {
        title: '第四步：创建复现运行',
        detail: '创建运行时会记录实验环境。运行创建后，可查看 Python、依赖与系统信息。',
        action: '创建复现运行',
        to: `/projects/${projectId}/reproduction`,
      }
    }
    const reportCount = reports.data?.items?.length ?? 0
    if (!reportCount) {
      return {
        title: '运行有记录，整理成报告',
        detail: '已经存在复现运行。把材料、事实与结果差异整理成报告，方便复核和交付。',
        action: '生成审计报告',
        to: `/projects/${projectId}/reproduction/reports`,
        secondary: { label: '查看结果对照', to: `/projects/${projectId}/reproduction/comparison` },
      }
    }
    return {
      title: '报告已生成，做最后复核',
      detail: '检查每一条结论是否有证据、是否把未验证写成已验证，再导出交付。',
      action: '打开审计报告',
      to: `/projects/${projectId}/reproduction/reports`,
      secondary: { label: '检查证据', to: `/projects/${projectId}/facts` },
    }
  }, [
    pathname, projectId, projects.data, materials.data, materials.isLoading,
    tasks.data, tasks.isLoading, facts.data, facts.isLoading, plans.data,
    plans.isLoading, runs.data, runs.isLoading, reports.data, reports.isLoading,
  ])

  if (!step) return null

  const isDone = step.title.startsWith('报告已生成')

  return (
    <section className={`ux-next-step${isDone ? ' ux-next-step--done' : ''}`} aria-label="系统建议的下一步">
      <div className="ux-next-step__icon" aria-hidden="true">
        {isDone ? <CheckCircle2 size={18} /> : <Sparkles size={18} />}
      </div>
      <div className="ux-next-step__copy">
        <span className="ux-next-step__label">
          <CircleHelp size={13} /> 根据项目真实数据判断的下一步
        </span>
        <strong>{step.title}</strong>
        <p>{step.detail}</p>
      </div>
      <div className="ux-next-step__actions">
        <Link to={step.to} className="ux-next-step__primary">
          {step.action}<ArrowRight size={15} />
        </Link>
        {step.secondary && <Link to={step.secondary.to} className="ux-next-step__secondary">{step.secondary.label}</Link>}
      </div>
    </section>
  )
}
