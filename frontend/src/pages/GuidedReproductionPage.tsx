import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, BookOpen, Check, CheckCircle2, Code2, Database,
  FileText, FolderOpen, Link2, Loader2, Plus, RotateCcw, ShieldCheck,
} from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { modelApi } from '../services/modelApi'
import type { MaterialView, Project } from '../types/api'

type GuidedStep = 1 | 2 | 3 | 4

const STEPS = [
  { id: 1, title: '添加论文', short: '论文', icon: FileText, accept: '.pdf,.txt,.md', hint: '支持 PDF / TXT / MD' },
  { id: 2, title: '补充数据', short: '数据', icon: Database, accept: '.csv,.xlsx', hint: '支持 CSV / XLSX' },
  { id: 3, title: '登记代码', short: '代码', icon: Code2, accept: '.zip,.py,.ipynb,.txt', hint: '支持 .zip / .py / .ipynb' },
  { id: 4, title: '准备实验', short: '准备', icon: ShieldCheck, accept: '', hint: '' },
] as const

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/Failed to fetch|NetworkError|network/i.test(message)) return '连接不上后端服务。确认 ReproCheck 后端已启动后再试。'
  if (/401|unauthorized/i.test(message)) return '登录状态失效了，请重新登录后再继续。'
  if (/403|forbidden/i.test(message)) return '当前账号没有这个项目的操作权限，请联系项目负责人。'
  if (/413|too large/i.test(message)) return '文件太大，换一个小一点的文件或压缩后再上传。'
  return message || '操作没有完成，请稍后重试。'
}

function ProjectSetup({ onSelected }: { onSelected: (project: Project) => void }) {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.getProjects })
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [paperTitle, setPaperTitle] = useState('')
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (!name.trim()) return setError('先给这次复现起一个名字，例如“ResNet 论文复现”。')
    setBusy(true); setError('')
    try {
      const project = await api.createProject({
        name: name.trim(), domain: domain.trim() || '待补充',
        paper_title: paperTitle.trim() || '待补充', description: '由四步复现引导创建',
      })
      onSelected(project)
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }

  return (
    <div className="ux-guided-intro">
      <section className="ux-guided-start">
        <span className="ux-eyebrow">选择或新建项目</span>
        <h1>从哪个项目开始？</h1>
        <p>选择已有项目继续，或新建复现项目。</p>
        {projects.isLoading && <div className="ux-guided-loading"><Loader2 size={16} />正在读取项目…</div>}
        {projects.isError && <div className="ux-callout ux-callout--danger">读取项目失败：{errorText(projects.error)}</div>}
        {projects.data?.items?.length ? (
          <div className="ux-guided-projects">
            {projects.data.items.slice(0, 6).map((project) => (
              <button key={project.id} type="button" className="ux-guided-project" onClick={() => onSelected(project)}>
                <span className="ux-guided-project__icon"><FolderOpen size={19} /></span>
                <span><strong>{project.name}</strong><small>{project.paper_title || '论文标题待补充'}</small></span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        ) : null}
        <div className="ux-guided-divider"><span>或者</span></div>
        {!creating ? (
          <button type="button" className="ux-onboard-secondary" onClick={() => setCreating(true)}><Plus size={16} />新建一个项目</button>
        ) : (
          <div className="ux-guided-form">
            <label><span>项目名称 <b>必填</b></span><input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：ResNet 图像分类复现" autoFocus /></label>
            <label><span>论文标题 <small>可选</small></span><input className="field-input" value={paperTitle} onChange={(e) => setPaperTitle(e.target.value)} placeholder="例如：Deep Residual Learning for Image Recognition" /></label>
            <label><span>研究领域 <small>可选</small></span><input className="field-input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="例如：计算机视觉 / 教育学 / 医学" /></label>
            {error && <div className="ux-callout ux-callout--danger">{error}</div>}
            <div className="ux-guided-form__actions">
              <button type="button" className="ux-onboard-primary" onClick={create} disabled={busy}>
                {busy ? <Loader2 size={16} className="ux-spin" /> : <ArrowRight size={16} />}{busy ? '正在创建…' : '创建并继续'}
              </button>
              <button type="button" className="ux-text-link" onClick={() => setCreating(false)}>取消</button>
            </div>
          </div>
        )}
      </section>
      <aside className="ux-guided-aside">
        <h2>四步流程</h2>
        <ol>{STEPS.map(({ id, title, icon: Icon }) => <li key={id}><span><Icon size={16} /></span><div><strong>{id}. {title}</strong><small>可随时跳过</small></div></li>)}</ol>
        <div className="ux-guided-aside__note"><BookOpen size={16} /><Link to="/manual#guided" className="ux-text-link">查看四步引导说明</Link></div>
      </aside>
    </div>
  )
}

function UploadZone({ accept, label, hint, onUpload, busy }: { accept: string; label: string; hint: string; onUpload: (file: File) => void; busy: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  return (
    <div className={`ux-upload-zone${dragging ? ' is-dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files?.[0]; if (file) onUpload(file) }}>
      <span className="ux-upload-zone__icon"><FileText size={23} /></span>
      <strong>{label}</strong><p>{hint}</p>
      <input ref={inputRef} type="file" accept={accept} hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) onUpload(file); e.currentTarget.value = '' }} />
      <button type="button" className="ux-onboard-secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? <Loader2 size={16} className="ux-spin" /> : <Plus size={16} />}{busy ? '正在上传…' : '选择文件'}
      </button><small>也可以把文件拖到这里</small>
    </div>
  )
}

export default function GuidedReproductionPage() {
  const [params] = useSearchParams()
  return <GuidedReproduction key={params.get('project') ?? ''} />
}

function GuidedReproduction() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const initialProject = params.get('project') ?? ''
  const initialStep = Math.min(4, Math.max(1, Number(params.get('step') || 1))) as GuidedStep
  const [project, setProject] = useState<Project | null>(null)
  const [step, setStep] = useState<GuidedStep>(initialStep)
  const [showProjectPicker, setShowProjectPicker] = useState(!initialProject)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [repoName, setRepoName] = useState('')
  const [lastUpload, setLastUpload] = useState('')

  const projects = useQuery({ queryKey: ['projects'], queryFn: api.getProjects, enabled: Boolean(initialProject) && !project })
  const materials = useQuery({ queryKey: ['materials', project?.id], queryFn: () => api.listMaterials(project!.id), enabled: Boolean(project?.id) })
  const profiles = useQuery({ queryKey: ['model-profiles'], queryFn: modelApi.profiles, staleTime: 30_000 })

  useEffect(() => {
    if (!project && initialProject && projects.data?.items) {
      const matched = projects.data.items.find((item) => item.id === initialProject)
      if (matched) setProject(matched); else setShowProjectPicker(true)
    }
  }, [initialProject, project, projects.data])

  useEffect(() => {
    params.set('step', String(step)); if (project) params.set('project', project.id)
    setParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, project?.id])

  const paper = materials.data?.items.find((m: MaterialView) => ['pdf', 'text', 'readme'].includes(m.material_type))
  const data = materials.data?.items.find((m: MaterialView) => ['csv', 'xlsx'].includes(m.material_type))
  const code = materials.data?.items.find((m: MaterialView) => ['python', 'notebook', 'zip', 'requirements', 'code_repository'].includes(m.material_type))
  const counts = useMemo(() => ({ paper: Boolean(paper), data: Boolean(data), code: Boolean(code) }), [paper, data, code])

  const onSelected = (selected: Project) => {
    setProject(selected); setStep(1); setShowProjectPicker(false); setError('')
  }

  const upload = async (file: File) => {
    if (!project) return
    setBusy(true); setError(''); setLastUpload('')
    try {
      const form = new FormData(); form.append('project_id', project.id); form.append('file', file)
      const result = await api.uploadMaterial(form)
      setLastUpload(result.filename); await materials.refetch()
      if (step < 4) setStep((step + 1) as GuidedStep)
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }

  const linkRepo = async () => {
    if (!project || !repoUrl.trim()) return setError('先粘贴代码仓库地址，例如 https://github.com/作者/项目。也可以先跳过。')
    setBusy(true); setError('')
    try {
      const result = await api.linkRepository({ project_id: project.id, url: repoUrl.trim(), name: repoName.trim() })
      setLastUpload(result.filename); setRepoUrl(''); setRepoName(''); await materials.refetch(); setStep(4)
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }

  const skip = () => { setError(''); setStep((value) => (value < 4 ? (value + 1) as GuidedStep : 4)) }
  const current = STEPS[step - 1]

  if (showProjectPicker || !project) {
    return (
      <div className="ux-guided-page">
        <ProjectSetup onSelected={onSelected} />
      </div>
    )
  }

  return (
    <div className="ux-guided-page">
      <div className="ux-guided-shell">
        <aside className="ux-guided-rail">
          <div className="ux-guided-rail__project">
            <div className="ux-guided-rail__project-head">
              <span>当前项目</span>
              <button type="button" className="ux-text-link" onClick={() => setShowProjectPicker(true)}>换项目</button>
            </div>
            <strong>{project.name}</strong><small>{project.paper_title || '论文标题待补充'}</small>
          </div>
          <ol>{STEPS.map(({ id, title, short }) => {
            const done = (id === 1 && counts.paper) || (id === 2 && counts.data) || (id === 3 && counts.code) || (id === 4 && counts.paper)
            return <li key={id} className={`${step === id ? 'is-current' : ''}${done && step !== id ? ' is-done' : ''}`}><button type="button" onClick={() => setStep(id)}><span className="ux-guided-rail__num">{done && step !== id ? <Check size={14} /> : id}</span><span><strong>{short}</strong><small>{title}</small></span></button></li>
          })}</ol>
          <div className="ux-guided-rail__progress"><span>材料完整度</span><div><i style={{ width: `${[counts.paper, counts.data, counts.code].filter(Boolean).length / 3 * 100}%` }} /></div><small>{[counts.paper, counts.data, counts.code].filter(Boolean).length}/3 类核心材料</small></div>
        </aside>

        <main className="ux-guided-main">
          <div className="ux-guided-main__head"><span className="ux-eyebrow">第 {step} 步 / 4</span><h1>{current.title}</h1></div>
          {step < 4 && (
            <section className="ux-guided-card">
              <div className="ux-guided-card__icon">{step === 1 ? <FileText size={22} /> : step === 2 ? <Database size={22} /> : <Code2 size={22} />}</div>
              <h2>{step === 1 ? '上传论文原文' : step === 2 ? '上传实验数据' : '关联代码仓库或源码'}</h2>
              <p>{step === 1 ? '上传 PDF 或文本，作为事实抽取与核验来源。' : step === 2 ? '补充 CSV / Excel 表格数据，可随时跳过。' : '登记仓库链接或上传代码包，仅记录不自动执行。'}</p>
              {step === 3 && (
                <>
                  <div className="ux-repo-form">
                    <label><span>代码仓库地址</span><div className="ux-input-with-icon"><Link2 size={16} /><input className="field-input" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/作者/项目" /></div></label>
                    <label><span>仓库名称 <small>可选</small></span><input className="field-input" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="例如：作者官方实现" /></label>
                    <button type="button" className="ux-onboard-primary" onClick={linkRepo} disabled={busy}>{busy ? <Loader2 size={16} className="ux-spin" /> : <Check size={16} />}{busy ? '正在登记…' : '登记仓库地址'}</button>
                  </div>
                  <div className="ux-guided-divider"><span>或者上传代码压缩包</span></div>
                </>
              )}
              <UploadZone accept={current.accept} label={step === 1 ? '选择论文文件' : step === 2 ? '选择数据文件' : '上传代码文件'} hint={current.hint} busy={busy} onUpload={upload} />
              {lastUpload && <div className="ux-callout ux-callout--success"><CheckCircle2 size={16} />已加入项目：{lastUpload}</div>}
              {error && <div className="ux-callout ux-callout--danger">{error}</div>}
              <div className="ux-guided-card__actions">
                <button type="button" className="ux-onboard-primary" onClick={() => setStep((step + 1) as GuidedStep)} disabled={busy}>下一步<ArrowRight size={16} /></button>
                <button type="button" className="ux-text-link" onClick={skip} disabled={busy}>跳过</button>
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="ux-guided-card ux-guided-card--ready">
              <div className="ux-guided-card__icon"><ShieldCheck size={22} /></div>
              <h2>材料准备清单</h2>
              <p>核对当前核心材料状态，缺项可随时补充。</p>
              <div className="ux-readiness">
                {[['论文', counts.paper, '抽取实验设定与核心结论'], ['数据', counts.data, '核对表格与指标数据（可选）'], ['代码', counts.code, '仓库链接或源码包（可选）']].map(([label, ready, note]) => (
                  <div key={String(label)} className={`ux-readiness__row${ready ? ' is-ready' : ''}`}>
                    <span>{ready ? <CheckCircle2 size={17} /> : <RotateCcw size={17} />}</span>
                    <div><strong>{label}</strong><small>{note}</small></div>
                    <button type="button" onClick={() => navigate(`/projects/${project.id}/materials`)}>{ready ? '查看' : '去补充'}</button>
                  </div>
                ))}
              </div>
              <div className="ux-ready-next">
                <div><span className="ux-eyebrow">下一步</span><h3>进入复现工作台</h3><p>拆解复现步骤并开始核验。</p></div>
                <button type="button" className="ux-onboard-primary" onClick={() => navigate(`/projects/${project.id}/reproduction`)}>进入复现工作台<ArrowRight size={16} /></button>
              </div>
              <div className="ux-ai-optional">
                <div><strong>AI 模型连接（可选）</strong><p>配置模型后可启用辅助解析与抽取。</p></div>
                {profiles.data?.length ? <span className="ux-chip ux-chip--success"><Check size={13} />AI 已连接 {profiles.data.length} 个模型</span> : <Link to="/settings/models?tab=setup" className="ux-onboard-secondary">连接 AI 模型</Link>}
              </div>
              <div className="ux-guided-card__actions"><Link to={`/projects/${project.id}/materials`} className="ux-text-link">查看材料清单</Link><Link to="/manual#guided" className="ux-text-link">查看引导说明</Link></div>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
