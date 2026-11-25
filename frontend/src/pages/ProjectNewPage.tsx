/**
 * 新建项目（图2 基础态表单 + 草稿防抖保存）
 *
 * 业务未变：提交仍走 POST /projects（api.createProject），表单字段与校验规则保持原样。
 * 新增：300ms 防抖草稿写入 sessionStorage；密钥类字段一律不落草稿（白名单 + 敏感词过滤双保险）。
 *
 * 真实数据绑定：CreateProjectRequest{name,domain,paper_title,description}。
 */
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ErrorState } from '../components/ErrorState'
import { ApiError, api } from '../services/api'
import type { CreateProjectRequest, Project } from '../types/api'
import '../styles/wave-c-verify.css'

const emptyForm: CreateProjectRequest = {
  name: '',
  domain: '',
  paper_title: '',
  description: '',
}

/** 草稿键：按页面隔离，避免与其他表单串档。 */
const DRAFT_KEY = 'rc:project-new:draft:v1'
/** 防抖时长（交互规范 §6.2「300ms 防抖草稿」）。 */
const DRAFT_DEBOUNCE_MS = 300

/**
 * 密钥类字段过滤：命中敏感词或不在白名单内的字段一律不写入 sessionStorage。
 * 当前表单不含密钥字段，但保留该守卫以便后续新增字段时默认安全。
 */
const DRAFT_ALLOWED_FIELDS: Array<keyof CreateProjectRequest> = [
  'name',
  'domain',
  'paper_title',
  'description',
]
const SENSITIVE_PATTERN = /(key|token|secret|password|passwd|credential|apikey|api_key|session)/i

type DraftPayload = {
  fields: Partial<CreateProjectRequest>
  savedAt: string
}

function isSensitiveField(field: string): boolean {
  return SENSITIVE_PATTERN.test(field)
}

/** 只保留白名单内、且非敏感词的字段值。 */
function pickDraftFields(form: CreateProjectRequest): Partial<CreateProjectRequest> {
  const picked: Partial<CreateProjectRequest> = {}
  for (const field of DRAFT_ALLOWED_FIELDS) {
    if (isSensitiveField(field)) continue
    const value = form[field]
    if (typeof value === 'string') picked[field] = value
  }
  return picked
}

function readDraft(): DraftPayload | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    const fields = record.fields
    if (!fields || typeof fields !== 'object') return null
    const safe: Partial<CreateProjectRequest> = {}
    for (const field of DRAFT_ALLOWED_FIELDS) {
      if (isSensitiveField(field)) continue
      const value = (fields as Record<string, unknown>)[field]
      if (typeof value === 'string') safe[field] = value
    }
    return { fields: safe, savedAt: typeof record.savedAt === 'string' ? record.savedAt : '' }
  } catch {
    return null
  }
}

function writeDraft(form: CreateProjectRequest): DraftPayload | null {
  if (typeof sessionStorage === 'undefined') return null
  const fields = pickDraftFields(form)
  const hasAny = Object.values(fields).some((value) => typeof value === 'string' && value.trim() !== '')
  if (!hasAny) {
    try {
      sessionStorage.removeItem(DRAFT_KEY)
    } catch {
      /* 存储不可用时静默降级，不阻断表单 */
    }
    return null
  }
  const payload: DraftPayload = { fields, savedAt: new Date().toISOString() }
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload))
  } catch {
    return null
  }
  return payload
}

function clearDraft() {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    /* 忽略存储异常 */
  }
}

function hasContent(form: CreateProjectRequest): boolean {
  return Object.values(form).some((value) => typeof value === 'string' && value.trim() !== '')
}

function formatSavedAt(iso: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

export default function ProjectNewPage() {
  const [form, setForm] = useState<CreateProjectRequest>(emptyForm)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [created, setCreated] = useState<Project | null>(null)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const restoredRef = useRef(false)
  const mutation = useMutation({ mutationFn: api.createProject })

  /* 进入页面：恢复上一次未提交的草稿（仅白名单字段）。 */
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    const draft = readDraft()
    if (!draft) return
    const merged = { ...emptyForm, ...draft.fields }
    if (Object.values(merged).every((value) => typeof value !== 'string' || !value.trim())) return
    setForm(merged)
    setDraftSavedAt(draft.savedAt || null)
    setDraftRestored(true)
  }, [])

  /* 表单变化：300ms 防抖写草稿。 */
  useEffect(() => {
    if (created) return
    if (!hasContent(form)) {
      clearDraft()
      setDraftSavedAt(null)
      return
    }
    const timer = window.setTimeout(() => {
      const payload = writeDraft(form)
      setDraftSavedAt(payload?.savedAt ?? null)
    }, DRAFT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [form, created])

  /* 离开前提醒：存在未提交内容时拦截（草稿仍保留在 sessionStorage）。 */
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!hasContent(form) || created) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [form, created])

  function update(field: keyof CreateProjectRequest, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }))
  }

  function reset() {
    setForm(emptyForm)
    setValidationError(null)
    setCreated(null)
    setDraftSavedAt(null)
    setDraftRestored(false)
    clearDraft()
    mutation.reset()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.name.trim() || !form.domain.trim() || !form.paper_title.trim()) {
      setValidationError('项目名称、研究领域与论文标题为必填项。')
      return
    }
    setValidationError(null)
    mutation.mutate(
      {
        name: form.name.trim(),
        domain: form.domain.trim(),
        paper_title: form.paper_title.trim(),
        description: form.description.trim(),
      },
      {
        onSuccess: (project) => {
          setCreated(project)
          clearDraft()
        },
      },
    )
  }

  if (created) {
    return (
      <div className="rc2-page">
        <section className="rc2-card mx-auto max-w-2xl text-center">
          <span className="rc2-card__stage rc2-card__stage--success" aria-hidden="true" />
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-wash text-success">
            <Icon name="badgeCheck" size="xl" tone="success" />
          </div>
          <h2 className="rc2-hero__title mt-4">项目创建成功</h2>
          <p className="rc2-hero__desc">项目「{created.name}」已保存至后端。</p>
          <div className="mt-3 flex justify-center">
            <span className="rcw-chip">ID: {created.id}</span>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Link to="/projects" className="btn-primary">
              查看项目列表
            </Link>
            <button type="button" className="btn-ghost" onClick={reset}>
              <Icon name="plus" size="sm" />
              继续创建
            </button>
          </div>
        </section>
      </div>
    )
  }

  const apiError = mutation.error as ApiError | null

  return (
    <div className="rc2-page">
      <header className="rc2-hero">
        <div className="min-w-0">
          <p className="rcw-overline">Projects</p>
          <h2 className="rc2-hero__title mt-2">新建项目</h2>
          <p className="rc2-hero__desc">填写基础信息创建审计项目</p>
        </div>
        <Link to="/projects" className="btn-ghost">
          <Icon name="arrowLeft" size="sm" />
          返回项目列表
        </Link>
      </header>

      {(draftRestored || draftSavedAt) && (
        <div className="rc2-draft" role="status" aria-live="polite">
          <Icon name="save" size="sm" tone="accent" />
          {draftRestored ? (
            <span>已恢复上次未提交的草稿（{formatSavedAt(draftSavedAt ?? '')}）。</span>
          ) : (
            <span>草稿已暂存 · {formatSavedAt(draftSavedAt ?? '')}</span>
          )}
          <span className="rc2-draft__spacer" />
          <button
            type="button"
            className="rc2-link"
            onClick={() => {
              setForm(emptyForm)
              setDraftSavedAt(null)
              setDraftRestored(false)
              clearDraft()
            }}
          >
            <Icon name="trash" size="xs" />
            清除草稿
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="rc2-form max-w-3xl">
        <div className="rc2-form__grid">
          <div>
            <label className="field-label" htmlFor="project-name">
              项目名称 <span style={{ color: 'var(--rc-danger)' }}>*</span>
            </label>
            <input
              id="project-name"
              className="field-input"
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
              placeholder="例如：ResNet 复现审计"
              maxLength={120}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="project-domain">
              研究领域 <span style={{ color: 'var(--rc-danger)' }}>*</span>
            </label>
            <input
              id="project-domain"
              className="field-input"
              value={form.domain}
              onChange={(event) => update('domain', event.target.value)}
              placeholder="例如：计算机视觉"
              maxLength={120}
            />
          </div>
        </div>

        <div className="mt-5">
          <label className="field-label" htmlFor="project-paper">
            论文标题 <span style={{ color: 'var(--rc-danger)' }}>*</span>
          </label>
          <input
            id="project-paper"
            className="field-input"
            value={form.paper_title}
            onChange={(event) => update('paper_title', event.target.value)}
            placeholder="例如：Deep Residual Learning for Image Recognition"
            maxLength={300}
          />
        </div>

        <div className="mt-5">
          <label className="field-label" htmlFor="project-description">
            项目描述
          </label>
          <textarea
            id="project-description"
            className="field-input min-h-[110px] resize-y"
            value={form.description}
            onChange={(event) => update('description', event.target.value)}
            placeholder="记录复现目标、关注的参数与已知差异…"
            maxLength={2000}
          />
        </div>

        {validationError && (
          <p className="mt-4 text-sm" style={{ color: 'var(--rc-danger)' }} role="alert">
            {validationError}
          </p>
        )}
        {mutation.isError && (
          <div className="mt-4">
            <ErrorState
              compact
              message={apiError?.message ?? '创建项目失败，请稍后重试。'}
              code={apiError?.code}
            />
          </div>
        )}

        <div className="rc2-form__actions">
          <Link to="/projects" className="btn-ghost">
            <Icon name="arrowLeft" size="sm" />
            取消
          </Link>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? (
              <>
                <Icon name="loader" size="sm" className="animate-spin" />
                提交中…
              </>
            ) : (
              <>
                <Icon name="plus" size="sm" />
                创建项目
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
