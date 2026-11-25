import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge, type Tone } from '../components/StatusBadge'
import { useTrackProject } from '../hooks/useTrackProject'
import { api, request } from '../services/api'

const ROLES = [
  { key: 'paper', label: '论文', formats: 'PDF / TXT', types: ['pdf', 'text'], accept: '.pdf,.txt' },
  { key: 'config', label: '实验配置', formats: 'YAML / JSON / TOML', types: ['yaml', 'json', 'toml'], accept: '.yaml,.yml,.json,.toml' },
  { key: 'code', label: 'Python 源码', formats: 'PY', types: ['python'], accept: '.py' },
  { key: 'metrics', label: '结果计数', formats: 'JSON', types: ['json'], accept: '.json' },
] as const

type Role = typeof ROLES[number]['key']
type Materials = Partial<Record<Role, { id: string; name: string; sha256: string }>>
type Evidence = {
  material_id: string
  name: string
  text: string
  locator: { viewer_page_number?: number; page_number?: number; line_number?: number; field_path?: string }
}
type Finding = {
  id: string
  claim: { field: keyof typeof fields }
  expected: number
  observed: number | null
  status: keyof typeof verdicts
  note: string
  evidence: Evidence[]
}
type AuditRun = {
  id: string
  parent_id: string | null
  created_at: string
  status: 'running' | 'completed' | 'failed'
  workflow_version: string
  rule_version: string
  materials: Materials
  result: {
    findings?: Finding[]
    workflow_steps?: { node_type: string; name: string }[]
    checked_count?: number
    limited?: boolean
    error?: string
    error_code?: string
  } | null
}

const fields = {
  batch_size: '批大小', learning_rate: '学习率', seed: '随机种子', f1: '二分类 F1', accuracy: '准确率',
}
const verdicts = {
  VERIFIED: { label: '已验证', tone: 'success' },
  PARTIALLY_VERIFIED: { label: '部分验证', tone: 'accent' },
  INSUFFICIENT_EVIDENCE: { label: '证据不足', tone: 'warning' },
  CONFLICTING: { label: '存在冲突', tone: 'danger' },
  UNVERIFIABLE: { label: '无法验证', tone: 'neutral' },
} satisfies Record<string, { label: string; tone: Tone }>

const runLabels = { running: '运行中', completed: '已完成', failed: '运行失败' }

function sourceLocation({ viewer_page_number, page_number, line_number, field_path }: Evidence['locator']) {
  const page = viewer_page_number ?? page_number
  if (page != null) return `第 ${page} 页`
  if (field_path) return field_path
  if (line_number != null) return `第 ${line_number} 行`
  return ''
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试。'
}

export default function PaperAuditPage() {
  const projectId = useParams().projectId ?? ''
  useTrackProject(projectId)
  return <PaperAudit key={projectId} projectId={projectId} />
}

function PaperAudit({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const base = `/projects/${encodeURIComponent(projectId)}`
  const endpoint = `${base}/paper-audits`
  const historyKey = ['paper-audits', projectId]
  const materialsKey = ['materials', projectId]
  const [selectedId, setSelectedId] = useState<string>()
  const [parentId, setParentId] = useState<string>()
  const [selection, setSelection] = useState<Partial<Record<Role, string>>>({})
  const [allowCloud, setAllowCloud] = useState(false)

  const materials = useQuery({
    queryKey: materialsKey,
    queryFn: () => api.listMaterials(projectId),
  })
  const history = useQuery({
    queryKey: historyKey,
    queryFn: () => request<{ items: AuditRun[]; configured: boolean }>(endpoint),
    refetchInterval: (query) => query.state.data?.items.some((item) => item.status === 'running') ? 3000 : false,
  })
  const runId = selectedId ?? history.data?.items[0]?.id
  const run = useQuery({
    queryKey: [...historyKey, runId],
    queryFn: () => request<AuditRun>(`${endpoint}/${encodeURIComponent(runId ?? '')}`),
    enabled: Boolean(runId),
    refetchInterval: (query) => query.state.data?.status === 'running' ? 3000 : false,
  })

  const upload = useMutation({
    mutationFn: async ({ file, role }: { file: File; role: Role }) => {
      const form = new FormData()
      form.set('file', file)
      form.set('project_id', projectId)
      const result = await api.uploadMaterial(form)
      return { role, id: result.material_id }
    },
    onSuccess: async ({ role, id }) => {
      setSelection((value) => ({ ...value, [role]: id }))
      await queryClient.invalidateQueries({ queryKey: materialsKey })
    },
  })
  const start = useMutation({
    mutationFn: () => request<AuditRun>(endpoint, {
      method: 'POST',
      body: JSON.stringify({ ...selection, parent_id: parentId, allow_cloud_processing: allowCloud }),
    }),
    onSuccess: async (value) => {
      queryClient.setQueryData([...historyKey, value.id], value)
      setSelectedId(value.id)
      setParentId(undefined)
      setAllowCloud(false)
      await queryClient.invalidateQueries({ queryKey: historyKey })
    },
    onError: () => { void queryClient.invalidateQueries({ queryKey: historyKey }) },
  })

  const report = run.data?.result
  const previous = useQuery({
    queryKey: [...historyKey, run.data?.parent_id],
    queryFn: () => request<AuditRun>(`${endpoint}/${encodeURIComponent(run.data?.parent_id ?? '')}`),
    enabled: Boolean(run.data?.parent_id),
  })
  const previousFindings = new Map(previous.data?.result?.findings?.map((item) => [item.id, item]))
  const errors = [materials.error, history.error, run.error, upload.error, start.error].filter(Boolean)

  function beginReview(value: AuditRun) {
    setParentId(value.id)
    setSelection(Object.fromEntries(ROLES.flatMap(({ key }) =>
      value.materials[key] ? [[key, value.materials[key].id]] : []
    )))
    setAllowCloud(false)
    document.getElementById('paper-audit-form')?.scrollIntoView({ block: 'nearest' })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (selection.paper && allowCloud && history.data?.configured && !start.isPending && !upload.isPending) {
      start.mutate()
    }
  }

  return (
    <div className="rc4-page space-y-6">
      <PageHeader
        title="投稿前审计"
        description="用 AgentArts 核对论文中的参数、随机种子和实验指标，逐条查看证据与待补材料。"
        actions={<Link to={`${base}/verification`} className="btn-ghost">返回项目验证</Link>}
      />

      {history.data?.configured === false && (
        <p className="rounded border border-amber-500/40 p-3" role="status">服务端尚未配置已发布的 AgentArts 工作流。</p>
      )}
      {errors.map((error, index) => <p key={index} role="alert" className="rounded border border-red-500/40 p-3">{errorMessage(error)}</p>)}

      <form id="paper-audit-form" onSubmit={submit} className="space-y-4 rounded-xl border border-current/15 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{parentId ? '补充材料并复审' : '选择审计材料'}</h3>
          {parentId && <button type="button" className="btn-ghost" onClick={() => setParentId(undefined)}>改做完整审计</button>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {ROLES.map(({ key, label, formats, types, accept }) => {
            const options = materials.data?.items.filter((item) => (types as readonly string[]).includes(item.material_type)) ?? []
            const value = selection[key] ?? ''
            const selectedAvailable = !value || options.some((item) => item.material_id === value)
            return (
              <div key={key} className="space-y-2">
                <label htmlFor={`audit-${key}`} className="block text-sm font-medium">
                  {label} <span className="opacity-65">（{key === 'paper' ? '必选，' : '可选，'}{formats}）</span>
                </label>
                <select
                  id={`audit-${key}`}
                  className="w-full rounded border border-current/25 bg-transparent p-2"
                  value={value}
                  required={key === 'paper'}
                  disabled={start.isPending || (key === 'paper' && Boolean(parentId))}
                  onChange={(event) => setSelection({ ...selection, [key]: event.target.value || undefined })}
                >
                  <option value="">选择项目材料</option>
                  {!selectedAvailable && <option value={value} disabled>原材料不可用</option>}
                  {options.map((item) => <option key={item.material_id} value={item.material_id}>{item.filename}</option>)}
                </select>
                <label className="block text-xs">
                  <span className="sr-only">上传{label}</span>
                  <input
                    type="file" accept={accept} disabled={upload.isPending || start.isPending || (key === 'paper' && Boolean(parentId))}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) upload.mutate({ file, role: key })
                      event.target.value = ''
                    }}
                  />
                </label>
              </div>
            )
          })}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={allowCloud} onChange={(event) => setAllowCloud(event.target.checked)} className="mt-1" />
          同意本次将必要论文片段发送至华为云 AgentArts 处理。
        </label>
        <button
          type="submit" className="btn-primary"
          disabled={!selection.paper || !allowCloud || !history.data?.configured || start.isPending || upload.isPending}
        >
          {start.isPending ? 'AgentArts 审计进行中…' : parentId ? '复审受影响的主张' : '发起 AgentArts 审计'}
        </button>
      </form>

      <section className="space-y-4" aria-label="审计历史">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">审计历史</h3>
          {Boolean(history.data?.items.length) && (
            <select aria-label="查看审计记录" className="rounded border border-current/25 bg-transparent p-2"
              value={runId ?? ''} onChange={(event) => setSelectedId(event.target.value)}>
              {history.data?.items.map((item) => (
                <option value={item.id} key={item.id}>
                  {new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(item.created_at) ? item.created_at : `${item.created_at}Z`).toLocaleString()} · {runLabels[item.status]}{item.parent_id ? ' · 复审' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        {history.isLoading && <p role="status">正在读取审计记录…</p>}
        {history.data?.items.length === 0 && <p>暂无审计记录。</p>}
        {run.data && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge tone={run.data.status === 'failed' ? 'danger' : 'neutral'}>{runLabels[run.data.status]}</StatusBadge>
            <span>工作流 {run.data.workflow_version} · 规则 {run.data.rule_version}</span>
            {run.data.status === 'completed' && Boolean(report?.findings?.length) && (
              <button type="button" className="btn-ghost" onClick={() => run.data && beginReview(run.data)}>基于此记录复审</button>
            )}
          </div>
        )}
        {report?.error && <p role="alert">{report.error}</p>}
        {report?.limited && <p className="text-sm">论文超出本轮文本范围，审计仅覆盖送检片段。</p>}
        {report?.findings?.length === 0 && <p>在送检片段中未提取到可核验的主张。</p>}
        {report?.checked_count !== undefined && run.data?.parent_id && (
          <p className="text-sm">本轮复核 {report.checked_count} 条。其余主张沿用上一轮记录。</p>
        )}
        {report?.findings?.map((finding) => {
          const prior = previousFindings.get(finding.id)
          const verdict = verdicts[finding.status]
          return (
            <article key={finding.id} className="space-y-3 rounded-xl border border-current/15 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <h4 className="font-semibold">{fields[finding.claim.field]}</h4>
                <StatusBadge tone={verdict.tone}>{verdict.label}</StatusBadge>
                {prior && prior.status !== finding.status && <span className="text-sm">上轮：{verdicts[prior.status].label}</span>}
              </div>
              <p className="text-sm">论文值 {finding.expected} · 核验值 {finding.observed ?? '待补充'}</p>
              <p className="text-sm">{finding.note}</p>
              <div className="grid gap-3 md:grid-cols-2">
                {finding.evidence.map((proof, index) => (
                  <div key={index} className="min-w-0 rounded border border-current/15 p-3">
                    <Link to={`/materials/${encodeURIComponent(proof.material_id)}`} className="break-words text-sm underline">{proof.name}</Link>
                    {sourceLocation(proof.locator) && <span className="ml-2 text-xs">{sourceLocation(proof.locator)}</span>}
                    <blockquote className="mt-2 whitespace-pre-wrap break-words text-sm">{proof.text}</blockquote>
                  </div>
                ))}
              </div>
            </article>
          )
        })}
        {Boolean(report?.workflow_steps?.length) && (
          <details className="rounded border border-current/15 p-3">
            <summary>AgentArts 执行步骤</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {report?.workflow_steps?.map((step, index) => <li key={index}>{step.name} · {step.node_type}</li>)}
            </ol>
          </details>
        )}
      </section>
    </div>
  )
}
