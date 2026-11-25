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
  { id: 1, title: '添加论文', short: '论文', icon: FileText, accept: '.pdf,.txt,.md', hint: '推荐 PDF；单个文件，大小限制以后端提示为准' },
  { id: 2, title: '补充数据', short: '数据', icon: Database, accept: '.csv,.xlsx', hint: '支持 CSV / Excel；不确定是否敏感时先不要上传' },
  { id: 3, title: '登记代码', short: '代码', icon: Code2, accept: '.zip,.py,.ipynb,.txt', hint: '.zip / .py / .ipynb；只保存，不自动执行' },
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
        <span className="ux-eyebrow">第 0 步 · 先给这次复现一个位置</span>
        <h1>从哪个项目开始？</h1>
        <p>项目是装论文、数据、代码和报告的文件夹。已有项目可以直接继续；没有就新建一个。</p>
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
            <label><span>这次复现叫什么？<b>必填</b></span><input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：ResNet 图像分类复现" autoFocus /></label>
            <label><span>论文标题 <small>可以先空着，之后再补</small></span><input className="field-input" value={paperTitle} onChange={(e) => setPaperTitle(e.target.value)} placeholder="例如：Deep Residual Learning for Image Recognition" /></label>
            <label><span>研究领域 <small>不确定可以空着</small></span><input className="field-input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="例如：计算机视觉 / 教育学 / 医学" /></label>
            <p className="ux-form-note">空着的标题和领域会先写为“待补充”，不会替你编造论文信息。</p>
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
        <h2>你接下来会做什么</h2>
        <ol>{STEPS.map(({ id, title, icon: Icon }) => <li key={id}><span><Icon size={16} /></span><div><strong>{id}. {title}</strong><small>可以跳过，之后回来补</small></div></li>)}</ol>
        <div className="ux-guided-aside__note"><BookOpen size={16} /><p>没有科研软件经验也没关系。每一步都会说明要准备什么、做完得到什么。</p><Link to="/manual#guided" className="ux-text-link">查看四步引导说明</Link></div>
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
              <h2>{step === 1 ? '上传你要复现的论文' : step === 2 ? '把实验数据也放进来' : '作者的代码在哪里？'}</h2>
              <p>{step === 1 ? '最好上传论文 PDF。系统会保存原文，之后可以在材料详情里核对文字有没有读对。' : step === 2 ? '论文里的表格、CSV 或 Excel 数据可以在这里上传。数据能让后续判断更有依据。' : '粘贴代码仓库网页地址即可。ReproCheck 只登记地址，不会自动下载或运行里面的代码。'}</p>
              <div className="ux-guidance-list">
                <div><strong>要准备什么</strong><span>{step === 1 ? '论文 PDF，文件名能看出标题更好。' : step === 2 ? 'CSV / Excel 文件；多个文件可逐个上传。' : 'GitHub / GitLab / Gitee 等仓库网页链接。'}</span></div>
                <div><strong>做完得到什么</strong><span>{step === 1 ? '论文进入材料清单，之后可以开始解析。' : step === 2 ? '项目里多出数据文件与来源记录。' : '材料清单里出现“代码仓库链接”。'}</span></div>
                <div><strong>没有这项？</strong><span>可以跳过；报告会如实记录缺项，不会补假数据。</span></div>
              </div>
              {step === 3 && (
                <>
                  <div className="ux-repo-form">
                    <label><span>代码仓库地址</span><div className="ux-input-with-icon"><Link2 size={16} /><input className="field-input" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/作者/项目" /></div></label>
                    <label><span>给它一个容易认的名字 <small>可选</small></span><input className="field-input" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="例如：作者官方实现" /></label>
                    <button type="button" className="ux-onboard-primary" onClick={linkRepo} disabled={busy}>{busy ? <Loader2 size={16} className="ux-spin" /> : <Check size={16} />}{busy ? '正在登记…' : '登记仓库地址'}</button>
                  </div>
                  <div className="ux-guided-divider"><span>或者上传代码压缩包</span></div>
                </>
              )}
              <UploadZone accept={current.accept} label={step === 1 ? '选择论文文件' : step === 2 ? '选择数据文件' : '上传代码文件'} hint={current.hint} busy={busy} onUpload={upload} />
              {lastUpload && <div className="ux-callout ux-callout--success"><CheckCircle2 size={16} />已加入项目：{lastUpload}</div>}
              {error && <div className="ux-callout ux-callout--danger">{error}</div>}
              <div className="ux-guided-card__actions">
                <button type="button" className="ux-onboard-primary" onClick={() => setStep((step + 1) as GuidedStep)} disabled={busy}>保存草稿，下一步<ArrowRight size={16} /></button>
                <button type="button" className="ux-text-link" onClick={skip} disabled={busy}>暂时没有，先跳过</button>
              </div>
              {step === 1 && <p className="ux-security-note"><ShieldCheck size={14} />材料保存在你自己的项目空间，不会自动发到外部网站。</p>}
            </section>
          )}

          {step === 4 && (
            <section className="ux-guided-card ux-guided-card--ready">
              <div className="ux-guided-card__icon"><ShieldCheck size={22} /></div>
              <h2>准备情况，已经按项目真实材料核对</h2>
              <p>下面不是预估进度，而是从项目材料里读到的实际状态。缺项可以之后补。</p>
              <div className="ux-readiness">
                {[['论文', counts.paper, '解析后才能产生可核对的事实'], ['数据', counts.data, '没有数据也能继续，但报告会记录限制'], ['代码', counts.code, '代码链接只登记，不自动运行']].map(([label, ready, note]) => (
                  <div key={String(label)} className={`ux-readiness__row${ready ? ' is-ready' : ''}`}>
                    <span>{ready ? <CheckCircle2 size={17} /> : <RotateCcw size={17} />}</span>
                    <div><strong>{label}</strong><small>{note}</small></div>
                    <button type="button" onClick={() => navigate(`/projects/${project.id}/materials`)}>{ready ? '查看' : '去补充'}</button>
                  </div>
                ))}
              </div>
              <div className="ux-ready-next">
                <div><span className="ux-eyebrow">你的下一步</span><h3>进入复现总览，把实验拆成步骤</h3><p>系统会带你创建复现规划；有缺项也能先开始，并在报告里记录限制。</p></div>
                <button type="button" className="ux-onboard-primary" onClick={() => navigate(`/projects/${project.id}/reproduction`)}>进入复现工作台<ArrowRight size={16} /></button>
              </div>
              <div className="ux-ai-optional">
                <div><strong>需要 AI 帮忙读论文吗？</strong><p>没有配置也能管理项目、材料和报告。AI 是可选增强；要用时先完成一次真实连接测试。</p></div>
                {profiles.data?.length ? <span className="ux-chip ux-chip--success"><Check size={13} />AI 已连接 {profiles.data.length} 个模型</span> : <Link to="/settings/models?tab=setup" className="ux-onboard-secondary">去连接 AI 助手（可选）</Link>}
              </div>
              <div className="ux-guided-card__actions"><Link to={`/projects/${project.id}/materials`} className="ux-text-link">先看完整材料清单</Link><Link to="/manual#guided" className="ux-text-link">阅读这一步的说明</Link></div>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
