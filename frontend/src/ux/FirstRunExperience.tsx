import { useMemo, useState } from 'react'
import {
  ArrowRight, BookOpen, Check, ChevronLeft, FileText, FolderOpen,
  GitBranch, LineChart, ListChecks, Microscope, PlayCircle, Sparkles,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
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
    /* 隐私模式：本次会话仍可继续 */
  }
}

const CAPABILITIES = [
  { icon: FileText, title: '论文材料', text: '把 PDF、补充材料和原文放在一处，随时回到证据。' },
  { icon: FolderOpen, title: '数据与代码', text: '数据表格、代码文件或仓库链接都有明确位置，不再散落。' },
  { icon: ListChecks, title: '复现步骤', text: '把论文里的实验拆成能检查、能交付的步骤。' },
  { icon: PlayCircle, title: '运行记录', text: '记录真实执行与失败原因，不用模拟结果凑进度。' },
  { icon: LineChart, title: '结果对照', text: '论文指标与复现结果放在一起，差异有据可查。' },
  { icon: Microscope, title: '审计报告', text: '把证据、限制和结论整理成可复核的中文报告。' },
]

type Goal = 'reproduce' | 'manage' | 'check' | 'report' | 'learn'

const GOALS: { id: Goal; title: string; text: string; icon: typeof FileText }[] = [
  { id: 'reproduce', title: '我想复现一篇论文', text: '从添加论文开始，四步把材料准备齐。', icon: Microscope },
  { id: 'manage', title: '我想管理已有项目', text: '打开项目，看看材料、运行和报告到哪一步。', icon: FolderOpen },
  { id: 'check', title: '我想检查一次实验结果', text: '打开已有项目，查看结果对照和证据。', icon: LineChart },
  { id: 'report', title: '我想生成或查看报告', text: '选择一个已有项目，整理可交付的审计报告。', icon: FileText },
  { id: 'learn', title: '我还不知道怎么用，带我看看', text: '用一分钟了解 ReproCheck 的真实工作方式。', icon: BookOpen },
]

function GoalProjectPicker({ goal, onBack }: { goal: Goal; onBack: () => void }) {
  const navigate = useNavigate()
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.getProjects })
  const destination = goal === 'report' ? 'reproduction/reports' : 'reproduction/comparison'

  return (
    <div className="ux-onboard-panel ux-onboard-panel--narrow">
      <button type="button" className="ux-onboard-back" onClick={onBack}>
        <ChevronLeft size={15} /> 换一个任务
      </button>
      <span className="ux-eyebrow">再选一步</span>
      <h1>要处理哪个项目？</h1>
      <p className="ux-onboard-lead">这里只列出你当前有权限打开的真实项目。选择后会直接进入对应页面。</p>
      {projects.isLoading ? <div className="ux-onboard-empty">正在读取项目…</div> : null}
      {projects.isError ? (
        <div className="ux-onboard-empty">
          读取项目失败。你仍然可以打开项目列表，或先新建一个项目。
        </div>
      ) : null}
      {projects.data?.items?.length ? (
        <div className="ux-project-picker">
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
              <span className="ux-project-choice__icon"><FolderOpen size={18} /></span>
              <span>
                <strong>{project.name}</strong>
                <small>{project.paper_title || '论文标题待补充'} · {project.domain || '领域待补充'}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      ) : !projects.isLoading ? (
        <div className="ux-onboard-empty">
          还没有可打开的项目。<Link to="/projects/new" onClick={() => markOnboarding('done')}>先建立项目</Link>
          ，或<Link to="/start/reproduce" onClick={() => markOnboarding('done')}>四步引导</Link>。
        </div>
      ) : null}
      <div className="ux-onboard-foot">
        <Link to="/projects" onClick={() => markOnboarding('done')} className="ux-text-link">直接去项目列表</Link>
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
  const goalTitle = useMemo(() => GOALS.find((item) => item.id === goal)?.title ?? '', [goal])

  return (
    <div className="ux-onboard">
      <ReproFieldBackground />
      <div className="ux-onboard__veil" aria-hidden="true" />
      <header className="ux-onboard__top">
        <div className="ux-onboard__brand">
          <span className="ux-onboard__mark">R</span>
          <span>
            <strong>ReproCheck</strong>
            <small>科研复现审计官</small>
          </span>
        </div>
        <div className="ux-onboard__steps" aria-label={`引导进度：第 ${progress} 步，共 3 步`}>
          {[1, 2, 3].map((step) => (
            <span key={step} className={step <= progress ? 'is-active' : ''} />
          ))}
        </div>
        <button type="button" className="ux-onboard__skip" onClick={() => finish('skipped')}>
          先跳过，直接进入工作台
        </button>
      </header>

      {stage === 'welcome' && (
        <main className="ux-onboard-panel">
          <div className="ux-onboard-hero">
            <div>
              <span className="ux-eyebrow"><Sparkles size={14} /> 第一次使用，从这里开始</span>
              <h1>不用先学软件，<br />先告诉我你要做什么。</h1>
              <p className="ux-onboard-lead">
                ReproCheck 会带你把论文、数据、代码和实验结果串起来。你不需要编程基础，也不需要先理解“复现审计”。
              </p>
              <button type="button" className="ux-onboard-primary" onClick={() => setStage('goals')}>
                下一步：选择我想做的事<ArrowRight size={17} />
              </button>
              <Link to="/manual" className="ux-onboard-manual" onClick={() => markOnboarding('done')}>
                <BookOpen size={15} />先看中文使用手册
              </Link>
            </div>
            <div className="ux-onboard-orbit" aria-hidden="true">
              <span className="ux-onboard-orbit__core">你的论文</span>
              {['数据', '代码', '实验', '证据', '报告'].map((label, index) => (
                <span key={label} className={`ux-onboard-orbit__node n${index + 1}`}>{label}</span>
              ))}
            </div>
          </div>
          <div className="ux-capability-grid">
            {CAPABILITIES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="ux-capability">
                <Icon size={18} />
                <div><strong>{title}</strong><p>{text}</p></div>
              </div>
            ))}
          </div>
        </main>
      )}

      {stage === 'goals' && (
        <main className="ux-onboard-panel ux-onboard-panel--narrow">
          <button type="button" className="ux-onboard-back" onClick={() => setStage('welcome')}>
            <ChevronLeft size={15} /> 返回介绍
          </button>
          <span className="ux-eyebrow">第 2 步 · 选择起点</span>
          <h1>你今天最想先完成什么？</h1>
          <p className="ux-onboard-lead">不用选“最正确”的。选一个最接近的，系统会带你走对应的下一步；之后也能随时回来换。</p>
          <div className="ux-goal-grid">
            {GOALS.map(({ id, title, text, icon: Icon }) => (
              <button type="button" key={id} className="ux-goal" onClick={() => chooseGoal(id)}>
                <span className="ux-goal__icon"><Icon size={20} /></span>
                <span className="ux-goal__copy"><strong>{title}</strong><small>{text}</small></span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
          <div className="ux-onboard-foot">
            <span>不确定？可以先<Link to="/demo/audit" onClick={() => markOnboarding('done')} className="ux-text-link">用示例了解流程</Link></span>
            <Link to="/manual" className="ux-text-link" onClick={() => markOnboarding('done')}>打开完整手册</Link>
          </div>
        </main>
      )}

      {stage === 'project' && <GoalProjectPicker goal={goal} onBack={() => setStage('goals')} />}

      {stage === 'learn' && (
        <main className="ux-onboard-panel ux-onboard-panel--narrow">
          <button type="button" className="ux-onboard-back" onClick={() => setStage('goals')}>
            <ChevronLeft size={15} /> 换一个任务
          </button>
          <span className="ux-eyebrow">一分钟了解</span>
          <h1>一次复现，通常只有四步。</h1>
          <p className="ux-onboard-lead">
            你不需要一次准备完美。系统会允许跳过缺项，并把真实的下一步一直显示在页面顶部。
          </p>
          <div className="ux-learn-steps">
            {[
              ['1', '建项目', '给这次复现一个名字，所有材料会放在这里。'],
              ['2', '加论文', '上传 PDF；数据和代码可以之后补。'],
              ['3', '拆步骤', '把论文里的实验变成可检查的复现步骤。'],
              ['4', '出报告', '记录证据、差异和限制，再导出可复核的报告。'],
            ].map(([num, title, text]) => (
              <div key={num} className="ux-learn-step">
                <span>{num}</span><div><strong>{title}</strong><p>{text}</p></div>
              </div>
            ))}
          </div>
          <div className="ux-learn-note">
            <Check size={16} />
            <span>没有 API 密钥也能先管理项目和材料；AI 整理是可选增强，不是使用前提。</span>
          </div>
          <div className="ux-onboard-actions">
            <button type="button" className="ux-onboard-primary" onClick={() => { markOnboarding('done'); navigate('/start/reproduce') }}>
              从添加论文开始<ArrowRight size={17} />
            </button>
            <button type="button" className="ux-onboard-secondary" onClick={() => finish('done')}>先进入工作台</button>
          </div>
        </main>
      )}

      {stage !== 'project' && (
        <footer className="ux-onboard__foot">
          <span>{goalTitle && stage === 'learn' ? `你选的是：${goalTitle}` : '你的进度只保存在这台电脑上，可随时跳过。'}</span>
          <span><GitBranch size={14} /> 所有项目数据保存在后端，不会上传到无关服务</span>
        </footer>
      )}
    </div>
  )
}
