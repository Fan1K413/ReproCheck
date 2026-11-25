import { useState } from 'react'
import {
  ArrowRight, BookOpen, ChevronLeft, FileText, FolderOpen,
  LineChart, ListChecks, Microscope, PlayCircle,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { ThemeToggle } from '../components/ThemeToggle'
import ReproFieldBackground from '../workbench/background/ReproFieldBackground'

export const ONBOARDING_KEY = 'rc:onboarding:v1'

export function onboardingStatus(): 'done' | 'skipped' | null {
  try {
    const value = localStorage.getItem(ONBOARDING_KEY)
    return value === 'done' || value === 'skipped' ? value : null
  } catch {
    return null
  }
}

export function markOnboarding(value: 'done' | 'skipped') {
  try {
    localStorage.setItem(ONBOARDING_KEY, value)
  } catch {
    /* 隐私模式 */
  }
}

const ORBIT_STAGES = [
  { id: 'paper', icon: FileText, label: '论文' },
  { id: 'data', icon: FolderOpen, label: '数据' },
  { id: 'plan', icon: ListChecks, label: '步骤' },
  { id: 'run', icon: PlayCircle, label: '运行' },
  { id: 'diff', icon: LineChart, label: '对照' },
  { id: 'report', icon: Microscope, label: '报告' },
]

type Goal = 'reproduce' | 'manage' | 'check' | 'report' | 'learn'

const GOALS: { id: Goal; title: string; tag: string; icon: typeof FileText }[] = [
  { id: 'reproduce', title: '复现一篇论文', tag: '四步流程', icon: Microscope },
  { id: 'manage', title: '打开已有项目', tag: '项目档案', icon: FolderOpen },
  { id: 'check', title: '核对实验结果', tag: '结果对照', icon: LineChart },
  { id: 'report', title: '生成审计报告', tag: '报告交付', icon: FileText },
  { id: 'learn', title: '浏览工作流', tag: '1 分钟', icon: BookOpen },
]

function GoalProjectPicker({ goal, onBack }: { goal: Goal; onBack: () => void }) {
  const navigate = useNavigate()
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.getProjects })
  const destination = goal === 'report' ? 'reproduction/reports' : 'reproduction/comparison'

  return (
    <div className="ux-onboard-panel ux-onboard-panel--narrow">
      <button type="button" className="ux-onboard-back" onClick={onBack}>
        <ChevronLeft size={15} /> 返回
      </button>
      <span className="ux-eyebrow">选择项目</span>
      <h1>进入哪个项目？</h1>
      {projects.isLoading ? <div className="ux-onboard-empty">加载中…</div> : null}
      {projects.isError ? <div className="ux-onboard-empty">读取项目失败</div> : null}
      {projects.data?.items?.length ? (
        <div className="ux-project-picker rc-stagger">
          {projects.data.items.slice(0, 8).map((project) => (
            <button
              type="button"
              key={project.id}
              className="ux-project-choice"
              onClick={() => {
                markOnboarding('done')
                navigate(`/projects/${project.id}/${destination}`)
              }}
            >
              <span className="ux-project-choice__icon"><FolderOpen size={17} /></span>
              <span>
                <strong>{project.name}</strong>
                <small>{project.paper_title || project.domain || '—'}</small>
              </span>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
      ) : !projects.isLoading ? (
        <div className="ux-onboard-empty">
          暂无项目 · <Link to="/projects/new" onClick={() => markOnboarding('done')}>新建项目</Link>
        </div>
      ) : null}
      <div className="ux-onboard-foot">
        <Link to="/projects" onClick={() => markOnboarding('done')} className="ux-text-link">全部项目</Link>
      </div>
    </div>
  )
}

export default function FirstRunExperience({
  onFinish,
  initialStage = 'welcome',
}: {
  onFinish: () => void
  initialStage?: 'welcome' | 'goals'
}) {
  const navigate = useNavigate()
  const [stage, setStage] = useState<'welcome' | 'goals' | 'project' | 'learn'>(initialStage)
  const [goal, setGoal] = useState<Goal>('reproduce')
  const [activeOrbit, setActiveOrbit] = useState<number>(0)

  const finish = (value: 'done' | 'skipped' = 'done') => {
    markOnboarding(value)
    onFinish()
  }

  const chooseGoal = (id: Goal) => {
    setGoal(id)
    if (id === 'reproduce') {
      markOnboarding('done')
      navigate('/start/reproduce')
    } else if (id === 'manage') {
      markOnboarding('done')
      navigate('/projects')
    } else if (id === 'learn') {
      setStage('learn')
    } else {
      setStage('project')
    }
  }

  const progress = stage === 'welcome' ? 1 : stage === 'goals' ? 2 : 3

  return (
    <div className="ux-onboard">
      <ReproFieldBackground />
      <div className="ux-onboard__veil" aria-hidden="true" />
      <header className="ux-onboard__top">
        <div className="ux-onboard__brand">
          <span className="ux-onboard__mark">R</span>
          <span>
            <strong>ReproCheck</strong>
            <small>科研复现审计</small>
          </span>
        </div>
        <div className="ux-onboard__steps" aria-label={`进度 ${progress}/3`}>
          {[1, 2, 3].map((step) => (
            <span key={step} className={step <= progress ? 'is-active' : ''} />
          ))}
        </div>
        <div className="flex items-center gap-2.5">
          <ThemeToggle compact />
          <button type="button" className="ux-onboard__skip" onClick={() => finish('skipped')}>
            进入工作台
          </button>
        </div>
      </header>

      {stage === 'welcome' && (
        <main className="ux-onboard-panel">
          <div className="ux-onboard-hero">
            <div>
              <span className="ux-eyebrow">ReproCheck</span>
              <h1>从一篇论文出发，<br />把证据串成闭环。</h1>
              <div className="ux-onboard-cta-row">
                <button type="button" className="ux-onboard-primary" onClick={() => setStage('goals')}>
                  开始<ArrowRight size={16} />
                </button>
                <button type="button" className="ux-onboard-secondary" onClick={() => finish('skipped')}>
                  直接进盘面
                </button>
              </div>
            </div>
            <div className="ux-onboard-orbit" aria-hidden="true">
              <span className="ux-onboard-orbit__ring" />
              <span className="ux-onboard-orbit__core">
                {ORBIT_STAGES[activeOrbit]?.label ?? '论文'}
              </span>
              {ORBIT_STAGES.slice(1).map(({ label, icon: Glyph }, index) => (
                <button
                  key={label}
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActiveOrbit(index + 1)}
                  onMouseLeave={() => setActiveOrbit(0)}
                  className={`ux-onboard-orbit__node n${index + 1}${activeOrbit === index + 1 ? ' is-lit' : ''}`}
                >
                  <Glyph size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="ux-capability-strip rc-stagger">
            {ORBIT_STAGES.map(({ icon: Glyph, label }, idx) => (
              <div
                key={label}
                className={`ux-capability-pill${activeOrbit === idx ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveOrbit(idx)}
              >
                <Glyph size={15} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </main>
      )}

      {stage === 'goals' && (
        <main className="ux-onboard-panel ux-onboard-panel--narrow">
          <button type="button" className="ux-onboard-back" onClick={() => setStage('welcome')}>
            <ChevronLeft size={15} /> 返回
          </button>
          <span className="ux-eyebrow">选择入口</span>
          <h1>今天从哪一步开始？</h1>
          <div className="ux-goal-grid rc-stagger">
            {GOALS.map(({ id, title, tag, icon: Glyph }) => (
              <button type="button" key={id} className="ux-goal" onClick={() => chooseGoal(id)}>
                <span className="ux-goal__icon"><Glyph size={19} /></span>
                <span className="ux-goal__copy">
                  <strong>{title}</strong>
                  <small>{tag}</small>
                </span>
                <ArrowRight size={15} className="ux-goal__arrow" />
              </button>
            ))}
          </div>
          <div className="ux-onboard-foot">
            <Link to="/demo/audit" onClick={() => markOnboarding('done')} className="ux-text-link">示例演示</Link>
            <Link to="/manual" onClick={() => markOnboarding('done')} className="ux-text-link">使用手册</Link>
          </div>
        </main>
      )}

      {stage === 'project' && <GoalProjectPicker goal={goal} onBack={() => setStage('goals')} />}

      {stage === 'learn' && (
        <main className="ux-onboard-panel ux-onboard-panel--narrow">
          <button type="button" className="ux-onboard-back" onClick={() => setStage('goals')}>
            <ChevronLeft size={15} /> 返回
          </button>
          <span className="ux-eyebrow">工作流</span>
          <h1>四步完成一次复现审计</h1>
          <div className="ux-learn-steps rc-stagger">
            {[
              ['01', '建项目', '归档论文与上下文'],
              ['02', '加材料', 'PDF · 数据 · 代码'],
              ['03', '拆步骤', '规划 · 环境 · 运行'],
              ['04', '出报告', '对照 · 证据 · 交付'],
            ].map(([num, title, text]) => (
              <div key={num} className="ux-learn-step">
                <span className="mono">{num}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="ux-onboard-actions">
            <button
              type="button"
              className="ux-onboard-primary"
              onClick={() => {
                markOnboarding('done')
                navigate('/start/reproduce')
              }}
            >
              开始四步引导<ArrowRight size={16} />
            </button>
            <button type="button" className="ux-onboard-secondary" onClick={() => finish('done')}>
              进入工作台
            </button>
          </div>
        </main>
      )}
    </div>
  )
}
