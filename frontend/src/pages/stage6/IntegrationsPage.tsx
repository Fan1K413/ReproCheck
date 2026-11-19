import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, GitBranch, Github, Gitlab, Globe, KeyRound, Link2,
  NotebookPen, Plus, RefreshCw, ShieldAlert, Tag, Terminal, Unlink,
} from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '../../components/CopyButton'
import { DataTable, type Column } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../features/format'
import { REPO_PROVIDERS, REPO_STATUS, SNAPSHOT_STATUS } from '../../features/stage6Meta'
import { useTrackProject } from '../../hooks/useTrackProject'
import { ApiError, api } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import { toast } from '../../stores/toastStore'
import { useUIStore } from '../../stores/uiStore'
import type { NotebookCell, NotebookOutput, RepoSnapshot, RepositoryConnection } from '../../types/stage6'

const DANGER_BTN =
  'inline-flex items-center gap-1.5 rounded-md bg-danger px-3 py-2 text-sm font-medium text-white transition hover:bg-danger/90 disabled:opacity-50'

function providerIcon(provider: string) {
  if (provider === 'github') return Github
  if (provider === 'gitlab') return Gitlab
  return Globe
}

function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

/** 快照说明：synced 取 detail.message，阻断取 detail.reason（后端 version_diff_json 视图）。 */
function snapshotNote(snapshot: RepoSnapshot): string {
  const message = snapshot.detail.message
  if (typeof message === 'string' && message.trim()) return message
  const reason = snapshot.detail.reason
  if (typeof reason === 'string' && reason.trim()) return reason
  return ''
}

const snapshotColumns: Column<RepoSnapshot>[] = [
  {
    key: 'sha', header: 'Commit',
    render: (s) => s.commit_sha
      ? <span className="mono whitespace-nowrap text-xs text-ink" title={s.commit_sha}>{s.commit_sha.slice(0, 12)}…</span>
      : <span className="whitespace-nowrap text-xs text-ink-subtle">未获取</span>,
  },
  { key: 'repo', header: '仓库', render: (s) => <span className="mono whitespace-nowrap text-xs text-ink-muted">{s.repo_full_name}</span> },
  { key: 'tag', header: 'Tag', render: (s) => s.tag ? <StatusBadge tone="navy" dot={false}>{s.tag}</StatusBadge> : <span className="text-xs text-ink-subtle">—</span> },
  { key: 'branch', header: '分支', render: (s) => <span className="mono whitespace-nowrap text-xs text-ink-muted">{s.branch || '—'}</span> },
  {
    key: 'status', header: '状态',
    render: (s) => {
      const meta = SNAPSHOT_STATUS[s.status] ?? { label: s.status, tone: 'neutral' as const }
      return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
    },
  },
  { key: 'time', header: '同步时间', render: (s) => <span className="mono whitespace-nowrap text-xs text-ink-muted">{formatDateTime(s.fetched_at)}</span> },
  {
    key: 'note', header: '说明',
    render: (s) => {
      const note = snapshotNote(s)
      return note
        ? <span className="block max-w-[260px] truncate text-xs text-ink-muted" title={note}>{note}</span>
        : <span className="text-xs text-ink-subtle">—</span>
    },
  },
]

function outputText(output: NotebookOutput): string {
  const join = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join('') : v || '')
  if (output.output_type === 'stream') return join(output.text)
  if (output.output_type === 'error') {
    return [output.ename, output.evalue].filter(Boolean).join(': ')
  }
  const plain = output.data?.['text/plain']
  return join(plain as string | string[] | undefined)
}

function NotebookCellView({ cell }: { cell: NotebookCell }) {
  const isCode = cell.cell_type === 'code'
  const renderedOutputs = (cell.outputs || [])
    .map((output, idx) => ({ key: idx, text: outputText(output), isError: output.output_type === 'error' }))
    .filter((o) => o.text.trim().length > 0)
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-canvas px-3 py-2">
        <span className="mono rounded bg-navy-100 px-1.5 text-[11px] leading-5 text-navy-800">#{cell.order_index}</span>
        <StatusBadge tone={isCode ? 'accent' : 'neutral'} dot={false}>{isCode ? '代码' : 'Markdown'}</StatusBadge>
        {isCode && <span className="mono text-[11px] text-ink-subtle">In [{cell.execution_count ?? ' '}]:</span>}
        <span className="ml-auto text-[11px] text-ink-subtle">{cell.output_count} 条输出</span>
      </div>
      <pre className="mono max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2.5 text-xs leading-relaxed text-ink">
        {cell.source || '（空单元格）'}
      </pre>
      {isCode && cell.output_count > 0 && (
        <div className="border-t border-line-soft bg-navy-950 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-navy-100">
            <Terminal size={16} strokeWidth={1.8} /> 执行输出 · {cell.output_count} 条
          </p>
          {renderedOutputs.length > 0 ? (
            <div className="mt-1.5 space-y-1.5">
              {renderedOutputs.map((o) => (
                <pre
                  key={o.key}
                  className={`mono max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed ${o.isError ? 'text-red-300' : 'text-navy-100'}`}
                >
                  {o.text}
                </pre>
              ))}
            </div>
          ) : (
            <p className="mono mt-1 text-[11px] leading-relaxed text-navy-100">
              输出为非文本类型（图像 / HTML 等），此处仅展示计数。
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function IntegrationsPage() {
  const queryClient = useQueryClient()
  const lastProjectId = useUIStore((state) => state.lastProjectId)

  /* ---------------- 仓库连接 ---------------- */
  const reposQuery = useQuery({ queryKey: ['stage6-repositories'], queryFn: stage6Api.listRepositories })
  const connections = reposQuery.data?.items ?? []
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null)
  const selectedConn = connections.find((c) => c.connection_id === selectedConnId) ?? connections[0] ?? null
  const syncConnId = selectedConn?.connection_id ?? ''

  const [connectOpen, setConnectOpen] = useState(false)
  const [provider, setProvider] = useState('github')
  const [accountLabel, setAccountLabel] = useState('')
  const [patToken, setPatToken] = useState('')
  const [allowlistText, setAllowlistText] = useState('')
  const [connectError, setConnectError] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<RepositoryConnection | null>(null)

  const connectMutation = useMutation({
    mutationFn: stage6Api.connectRepository,
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['stage6-repositories'] })
      toast.success(`已连接 ${REPO_PROVIDERS[created.provider] ?? created.provider} 账户「${created.account_label}」。`)
      setSelectedConnId(created.connection_id)
      setConnectOpen(false)
      setProvider('github'); setAccountLabel(''); setPatToken(''); setAllowlistText(''); setConnectError(null)
    },
    onError: (error) => toast.error(error.message),
  })

  const revokeMutation = useMutation({
    mutationFn: (connId: string) => stage6Api.revokeRepository(connId),
    onSuccess: (conn) => {
      void queryClient.invalidateQueries({ queryKey: ['stage6-repositories'] })
      void queryClient.invalidateQueries({ queryKey: ['stage6-snapshots', conn.connection_id] })
      toast.success('连接已撤销，后端加密凭据已清空。')
      setRevokeTarget(null)
    },
    onError: (error) => toast.error(error.message),
  })

  const submitConnect = () => {
    const label = accountLabel.trim()
    if (!label) { setConnectError('请填写账户标识（account_label）。'); return }
    const lines = allowlistText.split('\n').map((l) => l.trim()).filter(Boolean)
    const bad = lines.find((l) => !/^[^/\s]+\/[^/\s]+$/.test(l))
    if (bad) { setConnectError(`白名单每行应为 owner/repo 格式：「${bad}」不合法。`); return }
    setConnectError(null)
    connectMutation.mutate({
      provider, account_label: label, auth_type: 'pat',
      token: patToken.trim() || undefined, repo_allowlist: lines,
    })
  }

  /* ---------------- 同步与快照 ---------------- */
  const snapshotsQuery = useQuery({
    queryKey: ['stage6-snapshots', syncConnId],
    queryFn: () => stage6Api.listSnapshots(syncConnId),
    enabled: !!syncConnId,
  })
  const [syncRepo, setSyncRepo] = useState('')
  const [syncRef, setSyncRef] = useState('')
  const [syncError, setSyncError] = useState<string | null>(null)

  const syncMutation = useMutation({
    mutationFn: (vars: { connId: string; repo: string; ref: string }) =>
      stage6Api.syncRepository(vars.connId, { repo_full_name: vars.repo, ref: vars.ref || undefined }),
    onSuccess: (snapshot) => {
      void queryClient.invalidateQueries({ queryKey: ['stage6-snapshots', snapshot.connection_id] })
      if (snapshot.status === 'synced') toast.success('快照同步成功，已获取真实 commit。')
      else if (snapshot.status === 'blocked_no_credentials') toast.info('同步被阻断：未配置凭据，未获取真实 commit。')
      else toast.info('同步被阻断：远端拉取失败，未获取真实 commit。')
    },
    onError: (error) => toast.error(error.message),
  })

  const submitSync = () => {
    if (!selectedConn) return
    const repo = syncRepo.trim()
    if (!repo) { setSyncError('请填写仓库全名（owner/repo）。'); return }
    if (selectedConn.repo_allowlist.length > 0 && !selectedConn.repo_allowlist.includes(repo)) {
      setSyncError('该仓库不在此连接的白名单内，后端将拒绝同步。'); return
    }
    setSyncError(null)
    syncMutation.mutate({ connId: selectedConn.connection_id, repo, ref: syncRef.trim() })
  }

  const freshResult = syncMutation.data && syncMutation.data.connection_id === syncConnId ? syncMutation.data : null
  const resultSnapshot = freshResult ?? snapshotsQuery.data?.items[0] ?? null
  const resultMeta = resultSnapshot
    ? SNAPSHOT_STATUS[resultSnapshot.status] ?? { label: resultSnapshot.status, tone: 'neutral' as const }
    : null

  /* ---------------- Notebook 视图 ---------------- */
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.getProjects })
  const projects = projectsQuery.data?.items ?? []
  const [nbProjectId, setNbProjectId] = useState<string | null>(null)
  const nbProject =
    projects.find((p) => p.id === nbProjectId) ?? projects.find((p) => p.id === lastProjectId) ?? projects[0] ?? null
  const nbPid = nbProject?.id ?? ''
  useTrackProject(nbPid)

  const materialsQuery = useQuery({
    queryKey: ['materials', nbPid], queryFn: () => api.listMaterials(nbPid), enabled: !!nbPid,
  })
  const notebooks = (materialsQuery.data?.items ?? []).filter((m) => m.filename.toLowerCase().endsWith('.ipynb'))
  const [nbMaterialId, setNbMaterialId] = useState<string | null>(null)
  const nbMaterial = notebooks.find((m) => m.material_id === nbMaterialId) ?? notebooks[0] ?? null
  const nbMid = nbMaterial?.material_id ?? ''
  const notebookQuery = useQuery({
    queryKey: ['stage6-notebook', nbMid], queryFn: () => stage6Api.getNotebook(nbMid), enabled: !!nbMid,
  })
  const cells = notebookQuery.data?.cells ?? []
  const codeCount = cells.filter((c) => c.cell_type === 'code').length
  const outputTotal = cells.reduce((sum, c) => sum + c.output_count, 0)

  const renderNotebookBody = () => {
    if (projectsQuery.isPending) return <LoadingState compact message="正在读取项目列表…" />
    if (projectsQuery.isError)
      return <ErrorState compact message={projectsQuery.error.message} code={errorCode(projectsQuery.error)} onRetry={() => void projectsQuery.refetch()} />
    if (projects.length === 0)
      return <EmptyState compact title="尚无项目" description="创建项目并上传 .ipynb 材料后，可在此查看细胞级结构。" />
    if (materialsQuery.isPending) return <LoadingState compact message="正在读取项目材料…" />
    if (materialsQuery.isError)
      return <ErrorState compact message={materialsQuery.error.message} code={errorCode(materialsQuery.error)} onRetry={() => void materialsQuery.refetch()} />
    if (notebooks.length === 0)
      return <EmptyState compact icon={NotebookPen} title="该项目暂无 Notebook 材料" description="上传 .ipynb 文件后，此处会列出可解析的 Notebook。" />
    if (notebookQuery.isPending)
      return <LoadingState compact message="正在解析 Notebook 结构…" hint="仅读取已存储文件，绝不执行代码" />
    if (notebookQuery.isError)
      return <ErrorState compact message={notebookQuery.error.message} code={errorCode(notebookQuery.error)} onRetry={() => void notebookQuery.refetch()} />
    if (cells.length === 0) return <EmptyState compact title="该 Notebook 暂无细胞" />
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: '细胞总数', value: notebookQuery.data?.cell_count ?? cells.length },
            { label: '代码细胞', value: codeCount },
            { label: 'Markdown 细胞', value: cells.length - codeCount },
            { label: '输出总数', value: outputTotal },
          ].map((stat) => (
            <div key={stat.label} className="rounded-md border border-line bg-canvas px-3 py-2">
              <p className="mono text-lg font-semibold leading-6 text-ink">{stat.value}</p>
              <p className="text-[11px] text-ink-subtle">{stat.label}</p>
            </div>
          ))}
        </div>
        <div className="space-y-2.5">
          {cells.map((cell) => <NotebookCellView key={cell.cell_id} cell={cell} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="外部集成"
        description="仓库连接器 · 快照同步 · Notebook 结构视图（凭据仅后端加密存储）"
        actions={
          <button type="button" className="btn-primary" onClick={() => setConnectOpen(true)}>
            <Plus size={16} strokeWidth={1.8} /> 连接仓库
          </button>
        }
      />

      {/* ---------------- 仓库连接 ---------------- */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Link2 size={16} strokeWidth={1.8} className="text-accent-dark" />
          <h3 className="text-sm font-semibold">仓库连接</h3>
          {reposQuery.data && <StatusBadge tone="neutral">{reposQuery.data.total} 个</StatusBadge>}
        </div>
        {reposQuery.isPending ? (
          <div className="panel"><LoadingState compact message="正在读取仓库连接…" /></div>
        ) : reposQuery.isError ? (
          <div className="panel">
            <ErrorState compact message={reposQuery.error.message} code={errorCode(reposQuery.error)} onRetry={() => void reposQuery.refetch()} />
          </div>
        ) : connections.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon={Link2} title="尚无仓库连接"
              description="连接 GitHub / GitLab / Gitee 账户后，可同步真实 commit 快照；令牌留空则以只读无凭据模式连接。"
              action={
                <button type="button" className="btn-primary" onClick={() => setConnectOpen(true)}>
                  <Plus size={16} strokeWidth={1.8} /> 连接第一个仓库
                </button>
              }
            />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {connections.map((conn) => {
              const Icon = providerIcon(conn.provider)
              const meta = REPO_STATUS[conn.status] ?? { label: conn.status, tone: 'neutral' as const }
              const isSelected = conn.connection_id === syncConnId
              return (
                <div key={conn.connection_id}
                  className={`panel flex flex-col gap-3 p-4 transition ${isSelected ? 'border-accent ring-2 ring-accent-wash' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-wash text-accent-dark">
                        <Icon size={18} strokeWidth={1.8} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{REPO_PROVIDERS[conn.provider] ?? conn.provider}</p>
                        <p className="truncate text-xs text-ink-muted">{conn.account_label || '未命名账户'}</p>
                      </div>
                    </div>
                    <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {conn.repo_allowlist.length > 0 ? conn.repo_allowlist.map((repo) => (
                      <span key={repo} className="mono rounded bg-neutral-wash px-2 py-0.5 text-[11px] text-neutral">{repo}</span>
                    )) : <span className="text-xs text-ink-subtle">未设置白名单（不限制仓库范围）</span>}
                  </div>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
                    <span className="text-[11px] text-ink-subtle">
                      {conn.status === 'revoked' ? `撤销于 ${formatDateTime(conn.revoked_at)}` : `创建于 ${formatDateTime(conn.created_at)}`}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-[11px] text-ink-subtle">
                        <KeyRound size={16} strokeWidth={1.8} /> {conn.has_token ? '凭据已托管' : '无凭据'}
                      </span>
                      {conn.status !== 'revoked' && !isSelected && (
                        <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setSelectedConnId(conn.connection_id)}>
                          设为同步对象
                        </button>
                      )}
                      {isSelected && conn.status !== 'revoked' && <StatusBadge tone="accent" dot={false}>当前同步对象</StatusBadge>}
                      {conn.status !== 'revoked' && (
                        <button type="button" className={DANGER_BTN} onClick={() => setRevokeTarget(conn)}>
                          <Unlink size={16} strokeWidth={1.8} /> 撤销
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ---------------- 同步与快照 ---------------- */}
      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <RefreshCw size={16} strokeWidth={1.8} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">同步与快照</h3>
          </div>
          {connections.length > 0 && (
            <select className="field-input !w-auto max-w-[280px] !py-1.5 text-xs" value={syncConnId} aria-label="选择同步连接"
              onChange={(e) => { setSelectedConnId(e.target.value); setSyncError(null) }}>
              {connections.map((c) => (
                <option key={c.connection_id} value={c.connection_id}>
                  {REPO_PROVIDERS[c.provider] ?? c.provider} · {c.account_label}
                </option>
              ))}
            </select>
          )}
        </div>
        {reposQuery.isPending ? (
          <LoadingState compact message="正在读取仓库连接…" />
        ) : !selectedConn ? (
          <EmptyState compact icon={RefreshCw} title="尚无可同步的连接" description="创建仓库连接后，可在此拉取真实 commit 快照。" />
        ) : (
          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border border-line bg-canvas p-4">
                <p className="text-sm font-semibold">发起同步</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">真实拉取远端 commit；无凭据或拉取失败会落阻断快照，绝不伪造版本号。</p>
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="field-label" htmlFor="sync-repo">仓库全名（owner/repo）</label>
                    <input id="sync-repo" className="field-input mono" list="repo-allowlist-options" value={syncRepo}
                      onChange={(e) => setSyncRepo(e.target.value)} placeholder={selectedConn.repo_allowlist[0] ?? 'owner/repo'} />
                    <datalist id="repo-allowlist-options">
                      {selectedConn.repo_allowlist.map((repo) => <option key={repo} value={repo} />)}
                    </datalist>
                    {selectedConn.repo_allowlist.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {selectedConn.repo_allowlist.map((repo) => (
                          <button key={repo} type="button" onClick={() => setSyncRepo(repo)}
                            className="mono rounded bg-accent-wash px-2 py-0.5 text-[11px] text-accent-dark transition hover:bg-navy-100">
                            {repo}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="field-label" htmlFor="sync-ref">分支 / Tag（可选）</label>
                    <input id="sync-ref" className="field-input mono" value={syncRef}
                      onChange={(e) => setSyncRef(e.target.value)} placeholder="留空则使用远端默认 HEAD" />
                  </div>
                  {syncError && <p className="text-xs font-medium text-danger">{syncError}</p>}
                  {selectedConn.status === 'revoked' && <p className="text-xs font-medium text-warning">连接已撤销，无法同步。</p>}
                  <button type="button" className="btn-primary w-full" onClick={submitSync}
                    disabled={syncMutation.isPending || selectedConn.status === 'revoked'}>
                    <RefreshCw size={16} strokeWidth={1.8} className={syncMutation.isPending ? 'animate-spin' : ''} />
                    {syncMutation.isPending ? '正在同步…' : '同步快照'}
                  </button>
                </div>
              </div>

              <div className="rounded-md border border-line bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{freshResult ? '本次同步结果' : '最近一次快照'}</p>
                  {resultMeta && <StatusBadge tone={resultMeta.tone}>{resultMeta.label}</StatusBadge>}
                </div>
                {!resultSnapshot ? (
                  <p className="mt-3 text-xs leading-relaxed text-ink-muted">尚未发起同步。填写仓库全名后点击「同步快照」，结果与阻断原因会显示在这里。</p>
                ) : resultSnapshot.status !== 'synced' ? (
                  <div className={`mt-3 rounded-md border p-3.5 ${resultSnapshot.status === 'blocked_fetch_failed' ? 'border-danger bg-danger-wash' : 'border-warning bg-warning-wash'}`}>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                      {resultSnapshot.status === 'blocked_fetch_failed'
                        ? <AlertTriangle size={16} strokeWidth={1.8} className="text-danger" />
                        : <ShieldAlert size={16} strokeWidth={1.8} className="text-warning" />}
                      同步被阻断
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{snapshotNote(resultSnapshot) || '后端未返回阻断原因。'}</p>
                    <p className="mt-2 text-xs font-semibold text-ink">未获取到真实 commit，不伪造版本号。</p>
                    <p className="mono mt-1 text-[11px] text-ink-subtle">{resultSnapshot.repo_full_name}</p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div>
                      <p className="field-label">Commit SHA</p>
                      <div className="flex items-start gap-2 rounded-md border border-line bg-canvas px-3 py-2">
                        <code className="mono min-w-0 flex-1 break-all text-xs leading-5 text-ink">{resultSnapshot.commit_sha}</code>
                        <CopyButton text={resultSnapshot.commit_sha} className="shrink-0" />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {resultSnapshot.tag && <StatusBadge tone="navy" dot={false}><Tag size={16} strokeWidth={1.8} /> {resultSnapshot.tag}</StatusBadge>}
                      {resultSnapshot.branch && <StatusBadge tone="accent" dot={false}><GitBranch size={16} strokeWidth={1.8} /> {resultSnapshot.branch}</StatusBadge>}
                      <span className="mono text-[11px] text-ink-subtle">{resultSnapshot.repo_full_name}</span>
                    </div>
                    <p className="text-xs text-ink-muted">同步于 {formatDateTime(resultSnapshot.fetched_at)}</p>
                    {snapshotNote(resultSnapshot) && <p className="text-xs leading-relaxed text-ink-muted">{snapshotNote(resultSnapshot)}</p>}
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-md border border-line">
              {snapshotsQuery.isPending ? (
                <LoadingState compact message="正在读取快照列表…" />
              ) : snapshotsQuery.isError ? (
                <ErrorState compact message={snapshotsQuery.error.message} code={errorCode(snapshotsQuery.error)} onRetry={() => void snapshotsQuery.refetch()} />
              ) : (
                <DataTable columns={snapshotColumns} data={snapshotsQuery.data?.items ?? []} rowKey={(s) => s.snapshot_id}
                  empty={<EmptyState compact icon={RefreshCw} title="暂无快照记录" description="发起同步后，快照（含阻断记录）会显示在这里。" />} />
              )}
            </div>
          </div>
        )}
      </section>

      {/* ---------------- Notebook 视图 ---------------- */}
      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <NotebookPen size={16} strokeWidth={1.8} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">Notebook 结构视图</h3>
          </div>
          {notebookQuery.data && <StatusBadge tone="accent">{notebookQuery.data.cell_count} 个细胞</StatusBadge>}
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="nb-project">项目</label>
              <select id="nb-project" className="field-input" value={nbPid} disabled={projects.length === 0}
                onChange={(e) => { setNbProjectId(e.target.value); setNbMaterialId(null) }}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="nb-material">Notebook 材料（.ipynb）</label>
              <select id="nb-material" className="field-input" value={nbMid} disabled={notebooks.length === 0}
                onChange={(e) => setNbMaterialId(e.target.value)}>
                {notebooks.map((m) => <option key={m.material_id} value={m.material_id}>{m.filename}</option>)}
              </select>
            </div>
          </div>
          {renderNotebookBody()}
        </div>
      </section>

      {/* ---------------- 连接仓库 Modal ---------------- */}
      <Modal open={connectOpen} title="连接仓库" description="凭据仅后端加密存储，永不回显；同步必须真实拉取远端 commit。"
        onClose={() => setConnectOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setConnectOpen(false)}>取消</button>
            <button type="button" className="btn-primary" disabled={connectMutation.isPending} onClick={submitConnect}>
              {connectMutation.isPending ? '正在连接…' : '创建连接'}
            </button>
          </>
        }>
        <div className="space-y-3.5">
          <div>
            <label className="field-label" htmlFor="conn-provider">服务商</label>
            <select id="conn-provider" className="field-input" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
              <option value="gitee">Gitee</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="conn-account">账户标识（account_label）</label>
            <input id="conn-account" className="field-input" value={accountLabel}
              onChange={(e) => setAccountLabel(e.target.value)} placeholder="例如：reprocheck-lab" />
          </div>
          <div className="rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink-muted">
            认证方式：<span className="mono font-semibold text-ink">pat</span>（个人访问令牌，固定）
          </div>
          <div>
            <label className="field-label" htmlFor="conn-token">访问令牌（可选）</label>
            <input id="conn-token" type="password" autoComplete="new-password" className="field-input mono"
              value={patToken} onChange={(e) => setPatToken(e.target.value)} placeholder="ghp_… / glpat-… / gitee token" />
            <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
              令牌仅后端加密存储，永不回显。留空则以只读无凭据模式连接，同步将被明确阻断。
            </p>
          </div>
          <div>
            <label className="field-label" htmlFor="conn-allowlist">仓库白名单（每行一个 owner/repo）</label>
            <textarea id="conn-allowlist" className="field-input mono min-h-[76px] resize-y text-xs" rows={3}
              value={allowlistText} onChange={(e) => setAllowlistText(e.target.value)}
              placeholder={'reprocheck-lab/resnet50-repro\nowner/repo'} />
            <p className="mt-1 text-[11px] text-ink-subtle">留空则不限制仓库范围；同步时后端仍会校验白名单。</p>
          </div>
          {connectError && <p className="text-xs font-medium text-danger">{connectError}</p>}
        </div>
      </Modal>

      {/* ---------------- 撤销连接确认 Modal ---------------- */}
      <Modal open={!!revokeTarget} title="撤销仓库连接" description="此操作立即生效，不可恢复。"
        onClose={() => setRevokeTarget(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setRevokeTarget(null)}>取消</button>
            <button type="button" className={DANGER_BTN} disabled={revokeMutation.isPending}
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.connection_id)}>
              <Unlink size={16} strokeWidth={1.8} /> {revokeMutation.isPending ? '正在撤销…' : '确认撤销'}
            </button>
          </>
        }>
        {revokeTarget && (
          <div className="space-y-3">
            <div className="rounded-md border border-line bg-canvas px-3 py-2 text-sm">
              <p className="font-medium">{REPO_PROVIDERS[revokeTarget.provider] ?? revokeTarget.provider} · {revokeTarget.account_label}</p>
              <p className="mono mt-0.5 text-[11px] text-ink-subtle">{revokeTarget.connection_id}</p>
            </div>
            <div className="rounded-md border border-danger bg-danger-wash p-3 text-xs leading-relaxed text-danger">
              撤销后连接立即失效，后端将清空加密存储的访问令牌；历史快照与审计轨迹保留留痕，无法再用该连接同步。
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}