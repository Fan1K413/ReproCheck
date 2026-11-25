import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, GitBranch, Github, Gitlab, Globe, Link2,
  NotebookPen, RefreshCw, ShieldAlert, Tag, Unlink,
} from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '../../components/CopyButton'
import { DataTable, type Column } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
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
import '../../styles/wave-d-stage6.css'

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
      ? <span className="mono whitespace-nowrap text-xs" title={s.commit_sha}>{s.commit_sha.slice(0, 12)}…</span>
      : <span className="whitespace-nowrap text-xs rcw-faint">未获取</span>,
  },
  { key: 'repo', header: '仓库', render: (s) => <span className="mono whitespace-nowrap text-xs rcw-muted">{s.repo_full_name}</span> },
  { key: 'tag', header: 'Tag', render: (s) => s.tag ? <StatusBadge tone="navy" dot={false}>{s.tag}</StatusBadge> : <span className="text-xs rcw-faint">—</span> },
  { key: 'branch', header: '分支', render: (s) => <span className="mono whitespace-nowrap text-xs rcw-muted">{s.branch || '—'}</span> },
  {
    key: 'status', header: '状态',
    render: (s) => {
      const meta = SNAPSHOT_STATUS[s.status] ?? { label: s.status, tone: 'neutral' as const }
      return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
    },
  },
  { key: 'time', header: '同步时间', render: (s) => <span className="mono whitespace-nowrap text-xs rcw-muted">{formatDateTime(s.fetched_at)}</span> },
  {
    key: 'note', header: '说明',
    render: (s) => {
      const note = snapshotNote(s)
      return note
        ? <span className="block max-w-[260px] truncate text-xs rcw-muted" title={note}>{note}</span>
        : <span className="text-xs rcw-faint">—</span>
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
    <div className="rcw-cell">
      <div className="rcw-cell-head">
        <span className="rcw-chip">#{cell.order_index}</span>
        <StatusBadge tone={isCode ? 'accent' : 'neutral'} dot={false}>{isCode ? '代码' : 'Markdown'}</StatusBadge>
        {isCode && <span className="mono text-[11px] rcw-faint">In [{cell.execution_count ?? ' '}]:</span>}
        <span className="ml-auto text-[11px] rcw-faint">{cell.output_count} 条输出</span>
      </div>
      <pre className="rcw-cell-body">{cell.source || '（空单元格）'}</pre>
      {isCode && cell.output_count > 0 && (
        <div className="rcw-cell-out">
          <p className="rcw-row" style={{ gap: 'var(--rc-space-2)', marginBottom: 'var(--rc-space-2)', fontSize: 'var(--rc-fs-caption)', fontWeight: 'var(--rc-fw-sb)' }}>
            <Icon name="terminal" size="xs" />执行输出 · {cell.output_count} 条
          </p>
          {renderedOutputs.length > 0 ? (
            <div className="rcw-stack-tight">
              {renderedOutputs.map((o) => (
                <pre key={o.key} data-error={o.isError ? 'true' : undefined}>{o.text}</pre>
              ))}
            </div>
          ) : (
            <p className="mono text-[11px] leading-relaxed rcw-muted">
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
      <div className="rcw-stack-tight">
        <div className="rcw-grid rcw-grid-4">
          {[
            { label: '细胞总数', value: notebookQuery.data?.cell_count ?? cells.length },
            { label: '代码细胞', value: codeCount },
            { label: 'Markdown 细胞', value: cells.length - codeCount },
            { label: '输出总数', value: outputTotal },
          ].map((stat) => (
            <div key={stat.label} className="rcw-kpi">
              <div className="min-w-0">
                <p className="rcw-kpi-value">{stat.value}</p>
                <p className="rcw-kpi-label">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="rcw-stack-tight" style={{ marginTop: 'var(--rc-space-3)' }}>
          {cells.map((cell) => <NotebookCellView key={cell.cell_id} cell={cell} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="rcw-page">
      <div className="rcw-stack">
        <PageHeader
          title="外部集成"
          description="仓库连接器卡墙 · 快照同步 · Notebook 结构视图（凭据仅后端加密存储）"
          actions={
            <button type="button" className="btn-primary" onClick={() => setConnectOpen(true)}>
              <Icon name="plus" size="xs" />连接仓库
            </button>
          }
        />

        {/* ---------------- 连接器卡墙 ---------------- */}
        <section className="rcw-stack-tight">
          <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
            <Icon as={Link2} size="sm" tone="accent" />
            <h3 className="text-sm font-semibold">连接器</h3>
            {reposQuery.data && <StatusBadge tone="neutral">{reposQuery.data.total} 个</StatusBadge>}
          </div>
          {reposQuery.isPending ? (
            <div className="rcw-card"><LoadingState compact message="正在读取仓库连接…" /></div>
          ) : reposQuery.isError ? (
            <div className="rcw-card">
              <ErrorState compact message={reposQuery.error.message} code={errorCode(reposQuery.error)} onRetry={() => void reposQuery.refetch()} />
            </div>
          ) : connections.length === 0 ? (
            <div className="rcw-card">
              <EmptyState
                icon={Link2}
                title="尚无仓库连接"
                description="连接 GitHub / GitLab / Gitee 账户后，可同步真实 commit 快照；令牌留空则以只读无凭据模式连接。"
                action={
                  <button type="button" className="btn-primary" onClick={() => setConnectOpen(true)}>
                    <Icon name="plus" size="xs" />连接第一个仓库
                  </button>
                }
              />
            </div>
          ) : (
            <div className="rcw-grid rcw-grid-3">
              {connections.map((conn) => {
                const ProviderGlyph = providerIcon(conn.provider)
                const meta = REPO_STATUS[conn.status] ?? { label: conn.status, tone: 'neutral' as const }
                const isSelected = conn.connection_id === syncConnId
                return (
                  <article key={conn.connection_id} className="rcw-conn" data-selected={isSelected ? 'true' : 'false'}>
                    <div className="rcw-row-between" style={{ alignItems: 'flex-start' }}>
                      <div className="rcw-row" style={{ gap: 'var(--rc-space-3)', minWidth: 0 }}>
                        <span className="rcw-conn-icon">
                          <Icon as={ProviderGlyph} size="sm" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{REPO_PROVIDERS[conn.provider] ?? conn.provider}</p>
                          <p className="truncate text-xs rcw-muted">{conn.account_label || '未命名账户'}</p>
                        </div>
                      </div>
                      <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                    </div>
                    <div className="rcw-row" style={{ gap: 'var(--rc-space-1)' }}>
                      {conn.repo_allowlist.length > 0 ? conn.repo_allowlist.map((repo) => (
                        <span key={repo} className="rcw-chip">{repo}</span>
                      )) : <span className="text-xs rcw-faint">未设置白名单（不限制仓库范围）</span>}
                    </div>
                    <div className="rcw-row-between" style={{ marginTop: 'auto', paddingTop: 'var(--rc-space-3)', borderTop: 'var(--rc-stroke-hair)' }}>
                      <span className="text-[11px] rcw-faint">
                        {conn.status === 'revoked' ? `撤销于 ${formatDateTime(conn.revoked_at)}` : `创建于 ${formatDateTime(conn.created_at)}`}
                      </span>
                      <span className="rcw-row" style={{ gap: 'var(--rc-space-1)' }}>
                        <Icon name="key" size="xs" tone="subtle" />
                        <span className="text-[11px] rcw-faint">{conn.has_token ? '凭据已托管' : '无凭据'}</span>
                      </span>
                    </div>
                    <div className="rcw-row-end">
                      {conn.status !== 'revoked' && !isSelected && (
                        <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setSelectedConnId(conn.connection_id)}>
                          设为同步对象
                        </button>
                      )}
                      {isSelected && conn.status !== 'revoked' && <StatusBadge tone="accent" dot={false}>当前同步对象</StatusBadge>}
                      {conn.status !== 'revoked' && (
                        <button type="button" className="rcw-danger !px-2.5 !py-1 text-xs" onClick={() => setRevokeTarget(conn)}>
                          <Icon as={Unlink} size="xs" />撤销
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        {/* ---------------- 同步与快照 ---------------- */}
        <section className="rcw-card">
          <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)', borderBottom: 'var(--rc-stroke-hair)' }}>
            <h3 className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
              <Icon name="rotate" size="sm" tone="accent" />同步与快照
            </h3>
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
            <div className="rcw-stack" style={{ marginTop: 'var(--rc-space-4)' }}>
              <div className="rcw-split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
                <div className="rcw-card rcw-card-tight rcw-card-flat">
                  <p className="text-sm font-semibold">发起同步</p>
                  <p className="mt-0.5 text-xs leading-relaxed rcw-muted">真实拉取远端 commit；无凭据或拉取失败会落阻断快照，绝不伪造版本号。</p>
                  <div className="rcw-stack-tight" style={{ marginTop: 'var(--rc-space-3)' }}>
                    <div>
                      <label className="field-label" htmlFor="sync-repo">仓库全名（owner/repo）</label>
                      <input id="sync-repo" className="field-input mono" list="repo-allowlist-options" value={syncRepo}
                        onChange={(e) => setSyncRepo(e.target.value)} placeholder={selectedConn.repo_allowlist[0] ?? 'owner/repo'} />
                      <datalist id="repo-allowlist-options">
                        {selectedConn.repo_allowlist.map((repo) => <option key={repo} value={repo} />)}
                      </datalist>
                      {selectedConn.repo_allowlist.length > 0 && (
                        <div className="rcw-row mt-1.5" style={{ gap: 'var(--rc-space-1)' }}>
                          {selectedConn.repo_allowlist.map((repo) => (
                            <button key={repo} type="button" className="rcw-chip rcw-chip-btn" onClick={() => setSyncRepo(repo)}>
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
                    {syncError && <p className="text-xs font-medium" style={{ color: 'var(--rc-danger)' }}>{syncError}</p>}
                    {selectedConn.status === 'revoked' && <p className="text-xs font-medium" style={{ color: 'var(--rc-warning)' }}>连接已撤销，无法同步。</p>}
                    <button type="button" className="btn-primary w-full" onClick={submitSync}
                      disabled={syncMutation.isPending || selectedConn.status === 'revoked'}>
                      <Icon as={RefreshCw} size="xs" className={syncMutation.isPending ? 'animate-spin' : ''} />
                      {syncMutation.isPending ? '正在同步…' : '同步快照'}
                    </button>
                  </div>
                </div>

                <div className="rcw-card rcw-card-tight rcw-card-flat">
                  <div className="rcw-row-between" style={{ gap: 'var(--rc-space-2)' }}>
                    <p className="text-sm font-semibold">{freshResult ? '本次同步结果' : '最近一次快照'}</p>
                    {resultMeta && <StatusBadge tone={resultMeta.tone}>{resultMeta.label}</StatusBadge>}
                  </div>
                  {!resultSnapshot ? (
                    <p className="mt-3 text-xs leading-relaxed rcw-muted">尚未发起同步。填写仓库全名后点击「同步快照」，结果与阻断原因会显示在这里。</p>
                  ) : resultSnapshot.status !== 'synced' ? (
                    <div className="rcw-note mt-3" style={resultSnapshot.status === 'blocked_fetch_failed'
                      ? { backgroundColor: 'var(--rc-danger-wash)', color: 'var(--rc-danger)' }
                      : undefined}>
                      <p className="rcw-row" style={{ gap: 'var(--rc-space-2)', fontWeight: 'var(--rc-fw-sb)', color: 'var(--rc-text)' }}>
                        {resultSnapshot.status === 'blocked_fetch_failed'
                          ? <Icon as={AlertTriangle} size="xs" tone="danger" />
                          : <Icon as={ShieldAlert} size="xs" tone="warning" />}
                        同步被阻断
                      </p>
                      <p className="mt-1.5 text-xs leading-relaxed rcw-muted">{snapshotNote(resultSnapshot) || '后端未返回阻断原因。'}</p>
                      <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--rc-text)' }}>未获取到真实 commit，不伪造版本号。</p>
                      <p className="mono mt-1 text-[11px] rcw-faint">{resultSnapshot.repo_full_name}</p>
                    </div>
                  ) : (
                    <div className="rcw-stack-tight mt-3">
                      <div>
                        <p className="field-label">Commit SHA</p>
                        <div className="rcw-row" style={{ gap: 'var(--rc-space-2)', padding: 'var(--rc-space-2) var(--rc-space-3)', borderRadius: 'var(--rc-radius-sm)', border: 'var(--rc-stroke-hair)', backgroundColor: 'var(--rc-surface)' }}>
                          <code className="mono min-w-0 flex-1 break-all text-xs">{resultSnapshot.commit_sha}</code>
                          <CopyButton text={resultSnapshot.commit_sha} className="shrink-0" />
                        </div>
                      </div>
                      <div className="rcw-row" style={{ gap: 'var(--rc-space-1)' }}>
                        {resultSnapshot.tag && <StatusBadge tone="navy" dot={false}><Icon as={Tag} size="xs" /> {resultSnapshot.tag}</StatusBadge>}
                        {resultSnapshot.branch && <StatusBadge tone="accent" dot={false}><Icon as={GitBranch} size="xs" /> {resultSnapshot.branch}</StatusBadge>}
                        <span className="mono text-[11px] rcw-faint">{resultSnapshot.repo_full_name}</span>
                      </div>
                      <p className="text-xs rcw-muted">同步于 {formatDateTime(resultSnapshot.fetched_at)}</p>
                      {snapshotNote(resultSnapshot) && <p className="text-xs leading-relaxed rcw-muted">{snapshotNote(resultSnapshot)}</p>}
                    </div>
                  )}
                </div>
              </div>

              <div className="rcw-card rcw-card-tight rcw-card-flat">
                {snapshotsQuery.isPending ? (
                  <LoadingState compact message="正在读取快照列表…" />
                ) : snapshotsQuery.isError ? (
                  <ErrorState compact message={snapshotsQuery.error.message} code={errorCode(snapshotsQuery.error)} onRetry={() => void snapshotsQuery.refetch()} />
                ) : (
                  <DataTable
                    columns={snapshotColumns}
                    data={snapshotsQuery.data?.items ?? []}
                    rowKey={(s) => s.snapshot_id}
                    empty={<EmptyState compact icon={RefreshCw} title="暂无快照记录" description="发起同步后，快照（含阻断记录）会显示在这里。" />}
                  />
                )}
              </div>
            </div>
          )}
        </section>

        {/* ---------------- Notebook 结构视图 ---------------- */}
        <section className="rcw-card">
          <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)', borderBottom: 'var(--rc-stroke-hair)' }}>
            <h3 className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
              <Icon as={NotebookPen} size="sm" tone="accent" />Notebook 结构视图
            </h3>
            {notebookQuery.data && <StatusBadge tone="accent">{notebookQuery.data.cell_count} 个细胞</StatusBadge>}
          </div>
          <div className="rcw-stack" style={{ marginTop: 'var(--rc-space-4)' }}>
            <div className="rcw-grid rcw-grid-2">
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
      </div>

      {/* ---------------- 连接仓库 Modal ---------------- */}
      <Modal
        open={connectOpen}
        title="连接仓库"
        description="凭据仅后端加密存储，永不回显；同步必须真实拉取远端 commit。"
        onClose={() => setConnectOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setConnectOpen(false)}>取消</button>
            <button type="button" className="btn-primary" disabled={connectMutation.isPending} onClick={submitConnect}>
              {connectMutation.isPending ? '正在连接…' : '创建连接'}
            </button>
          </>
        }
      >
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
          <div className="rcw-card rcw-card-flat rcw-card-tight">
            <p className="text-xs rcw-muted">
              认证方式：<span className="mono font-semibold" style={{ color: 'var(--rc-text)' }}>pat</span>（个人访问令牌，固定）
            </p>
          </div>
          <div>
            <label className="field-label" htmlFor="conn-token">访问令牌（可选）</label>
            <input id="conn-token" type="password" autoComplete="new-password" className="field-input mono"
              value={patToken} onChange={(e) => setPatToken(e.target.value)} placeholder="ghp_… / glpat-… / gitee token" />
            <p className="mt-1 text-[11px] leading-relaxed rcw-faint">
              令牌仅后端加密存储，永不回显。留空则以只读无凭据模式连接，同步将被明确阻断。
            </p>
          </div>
          <div>
            <label className="field-label" htmlFor="conn-allowlist">仓库白名单（每行一个 owner/repo）</label>
            <textarea id="conn-allowlist" className="field-input mono min-h-[76px] resize-y text-xs" rows={3}
              value={allowlistText} onChange={(e) => setAllowlistText(e.target.value)}
              placeholder={'reprocheck-lab/resnet50-repro\nowner/repo'} />
            <p className="mt-1 text-[11px] rcw-faint">留空则不限制仓库范围；同步时后端仍会校验白名单。</p>
          </div>
          {connectError && <p className="text-xs font-medium" style={{ color: 'var(--rc-danger)' }}>{connectError}</p>}
        </div>
      </Modal>

      {/* ---------------- 撤销连接确认 Modal ---------------- */}
      <Modal
        open={!!revokeTarget}
        title="撤销仓库连接"
        description="此操作立即生效，不可恢复。"
        onClose={() => setRevokeTarget(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setRevokeTarget(null)}>取消</button>
            <button type="button" className="rcw-danger" disabled={revokeMutation.isPending}
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.connection_id)}>
              <Icon as={Unlink} size="xs" />{revokeMutation.isPending ? '正在撤销…' : '确认撤销'}
            </button>
          </>
        }
      >
        {revokeTarget && (
          <div className="rcw-stack-tight">
            <div className="rcw-card rcw-card-flat rcw-card-tight">
              <p className="font-medium">{REPO_PROVIDERS[revokeTarget.provider] ?? revokeTarget.provider} · {revokeTarget.account_label}</p>
              <p className="mono mt-0.5 text-[11px] rcw-faint">{revokeTarget.connection_id}</p>
            </div>
            <div className="rcw-note rcw-note--danger">
              撤销后连接立即失效，后端将清空加密存储的访问令牌；历史快照与审计轨迹保留留痕，无法再用该连接同步。
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
