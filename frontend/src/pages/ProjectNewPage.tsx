import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Loader2, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ErrorState } from '../components/ErrorState'
import { ApiError, api } from '../services/api'
import type { CreateProjectRequest, Project } from '../types/api'

const emptyForm: CreateProjectRequest = {
  name: '',
  domain: '',
  paper_title: '',
  description: '',
}

export default function ProjectNewPage() {
  const [form, setForm] = useState<CreateProjectRequest>(emptyForm)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [created, setCreated] = useState<Project | null>(null)
  const mutation = useMutation({ mutationFn: api.createProject })

  function update(field: keyof CreateProjectRequest, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }))
  }

  function reset() {
    setForm(emptyForm)
    setValidationError(null)
    setCreated(null)
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
      { onSuccess: (project) => setCreated(project) },
    )
  }

  if (created) {
    return (
      <div className="panel mx-auto max-w-2xl p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-wash text-success">
          <CheckCircle2 size={28} strokeWidth={1.8} />
        </div>
        <h2 className="mt-4 text-lg font-semibold">项目创建成功</h2>
        <p className="mt-1 text-sm text-ink-muted">项目「{created.name}」已保存至后端。</p>
        <p className="mono mt-3 inline-block rounded bg-canvas px-3 py-1 text-xs text-ink-muted">
          ID: {created.id}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link to="/projects" className="btn-primary">
            查看项目列表
          </Link>
          <button type="button" className="btn-ghost" onClick={reset}>
            <Plus size={15} />
            继续创建
          </button>
        </div>
      </div>
    )
  }

  const apiError = mutation.error as ApiError | null

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">新建项目</h2>
        <p className="mt-1 text-sm text-ink-muted">填写项目档案信息，提交后写入后端项目库。</p>
      </div>

      <form onSubmit={handleSubmit} className="panel max-w-3xl space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="project-name">
              项目名称 <span className="text-danger">*</span>
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
              研究领域 <span className="text-danger">*</span>
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

        <div>
          <label className="field-label" htmlFor="project-paper">
            论文标题 <span className="text-danger">*</span>
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

        <div>
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

        {validationError && <p className="text-sm text-danger">{validationError}</p>}
        {mutation.isError && (
          <ErrorState
            compact
            message={apiError?.message ?? '创建项目失败，请稍后重试。'}
            code={apiError?.code}
          />
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-soft pt-5">
          <Link to="/projects" className="btn-ghost">
            <ArrowLeft size={15} />
            取消
          </Link>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                提交中…
              </>
            ) : (
              <>
                <Plus size={16} />
                创建项目
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
