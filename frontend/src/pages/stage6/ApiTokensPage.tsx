import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Ban,
  KeyRound,
  Lock,
  Plus,
  ScrollText,
  Terminal,
} from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '../../components/CopyButton'
import { DataTable, type Column } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge, type Tone } from '../../components/StatusBadge'
import { formatDateTime, formatDuration } from '../../features/format'
import { API_SCOPES } from '../../features/stage6Meta'
import { ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import { toast } from '../../stores/toastStore'
import type { ApiCallLog, ApiToken, ApiTokenCreated } from '../../types/stage6'

const DANGER_BTN =
  'inline-flex items-center gap-1.5 rounded-md bg-danger px-3 py-2 text-sm font-medium text-white transition hover:bg-danger/90 disabled:opacity-50'

const DEFAULT_SCOPES = ['project.read', 'audit.read', 'repro.read']

function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

function scopeLabel(key: string): string {
  return API_SCOPES.find((s) => s.key === key)?.label ?? key
}

function tokenStatusMeta(token: ApiToken): { label: string; tone: Tone } {
  if (token.is_revoked) return { label: '已撤销', tone: 'danger' }
  if (token.expires_at && new Date(token.expires_at).getTime() < Date.now())
    return { label: '已过期', tone: 'warning' }
  return { label: '生效中', tone: 'success' }
}

function methodTone(method: string): Tone {
  if (method === 'GET') return 'accent'
  if (method === 'POST') return 'success'
  return 'neutral'
}

function statusTone(code: number): Tone {
  if (code >= 200 && code < 300) return 'success'
  if (code === 429) return 'warning'
  return 'danger'
}

const logColumns: Column<ApiCallLog>[] = [
  {
    key: 'time',
    header: '时间',
    render: (log) => (
      <span className="mono whitespace-nowrap text-xs text-ink-muted">{formatDateTime(log.created_at)}</span>
    ),
  },
  {
    key: 'method',
    header: '方法',
    render: (log) => (
      <StatusBadge tone={methodTone(log.method)} dot={false}>
        <span className="mono">{log.method}</span>
      </StatusBadge>
    ),
  },
  {
    key: 'endpoint',
    header: '端点',
    render: (log) => (
      <span className="mono block max-w-[320px] truncate text-xs text-ink" title={log.endpoint}>
        {log.endpoint}
      </span>
    ),
  },
  {
    key: 'status',
    header: '状态码',
    render: (log) => (
      <StatusBadge tone={statusTone(log.status_code)}>
        <span className="mono">{log.status_code}</span>
        {log.status_code === 429 && '限流'}
      </StatusBadge>
    ),
  },
  {
    key: 'duration',
    header: '耗时',
    align: 'right',
    render: (log) => (
      <span className="mono whitespace-nowrap text-xs text-ink-muted">{formatDuration(log.duration_ms)}</span>
    ),
  },
]

export default function ApiTokensPage() {
  const queryClient = useQueryClient()

  const tokensQuery = useQuery({ queryKey: ['stage6-api-tokens'], queryFn: stage6Api.listApiTokens })
  const tokens = tokensQuery.data?.items ?? []
  const activeCount = tokens.filter((t) => tokenStatusMeta(t).tone === 'success').length

  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null)
  const logToken = tokens.find((t) => t.token_id === selectedTokenId) ?? tokens[0] ?? null
  const logTokenId = logToken?.token_id ?? ''
  const logsQuery = useQuery({
    queryKey: ['stage6-api-logs', logTokenId],
    queryFn: () => stage6Api.listApiLogs(logTokenId),
    enabled: !!logTokenId,
  })

  /* ---------------- 创建令牌 ---------------- */
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES)
  const [rate, setRate] = useState('60')
  const [expires, setExpires] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdToken, setCreatedToken] = useState<ApiTokenCreated | null>(null)

  const createMutation = useMutation({
    mutationFn: stage6Api.createApiToken,
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['stage6-api-tokens'] })
      setCreatedToken(created)
      setCreateOpen(false)
      setName('')
      setScopes(DEFAULT_SCOPES)
      setRate('60')
      setExpires('')
      setCreateError(null)
      toast.success('API Token 已创建，明文仅显示一次，请立即复制。')
    },
    onError: (error) => toast.error(error.message),
  })

  const toggleScope = (key: string) =>
    setScopes((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]))

  const submitCreate = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setCreateError('请填写令牌名称。')
      return
    }
    if (scopes.length === 0) {
      setCreateError('至少选择一个 scope。')
      return
    }
    const rateNum = Number(rate)
    if (!Number.isInteger(rateNum) || rateNum < 1) {
      setCreateError('速率限制需为 ≥ 1 的整数（次/分）。')
      return
    }
    let expiresIso: string | undefined
    if (expires) {
      const date = new Date(expires)
      if (Number.isNaN(date.getTime())) {
        setCreateError('过期时间格式不正确。')
        return
      }
      if (date.getTime() <= Date.now()) {
        setCreateError('过期时间需晚于当前时间。')
        return
      }
      expiresIso = date.toISOString()
    }
    setCreateError(null)
    createMutation.mutate({ name: trimmed, scopes, rate_limit_per_min: rateNum, expires_at: expiresIso })
  }

  /* ---------------- 撤销令牌 ---------------- */
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null)
  const revokeMutation = useMutation({
    mutationFn: (tokenId: string) => stage6Api.revokeApiToken(tokenId),
    onSuccess: (token) => {
      void queryClient.invalidateQueries({ queryKey: ['stage6-api-tokens'] })
      void queryClient.invalidateQueries({ queryKey: ['stage6-api-logs', token.token_id] })
      toast.success(`令牌「${token.name}」已撤销，相关调用立即失效。`)
      setRevokeTarget(null)
    },
    onError: (error) => toast.error(error.message),
  })

  const tokenColumns: Column<ApiToken>[] = [
    {
      key: 'name',
      header: '名称',
      render: (t) => (
        <div className="min-w-0">
          <p className="whitespace-nowrap font-medium text-ink">{t.name}</p>
          <p className="mono mt-0.5 text-[10px] text-ink-subtle">{t.token_id}</p>
        </div>
      ),
    },
    {
      key: 'prefix',
      header: '前缀',
      render: (t) => <span className="mono whitespace-nowrap text-xs text-ink-muted">{t.prefix}…</span>,
    },
    {
      key: 'scopes',
      header: '授权范围',
      render: (t) => (
        <div className="flex max-w-[240px] flex-wrap gap-1">
          {t.scopes.map((s) => (
            <span key={s} className="mono rounded bg-accent-wash px-1.5 py-0.5 text-[10px] leading-4 text-accent-dark" title={scopeLabel(s)}>
              {s}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'rate',
      header: '速率限制',
      align: 'right',
      render: (t) => (
        <span className="mono whitespace-nowrap text-xs text-ink-muted">{t.rate_limit_per_min} 次/分</span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      render: (t) => {
        const meta = tokenStatusMeta(t)
        return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
      },
    },
    {
      key: 'last_used',
      header: '最近调用',
      render: (t) => (
        <span className="mono whitespace-nowrap text-xs text-ink-muted">{formatDateTime(t.last_used_at)}</span>
      ),
    },
    {
      key: 'expires',
      header: '过期时间',
      render: (t) =>
        t.expires_at ? (
          <span className="mono whitespace-nowrap text-xs text-ink-muted">{formatDateTime(t.expires_at)}</span>
        ) : (
          <span className="whitespace-nowrap text-xs text-ink-subtle">长期有效</span>
        ),
    },
    {
      key: 'created',
      header: '创建时间',
      render: (t) => (
        <span className="mono whitespace-nowrap text-xs text-ink-muted">{formatDateTime(t.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (t) => (
        <div className="flex flex-wrap items-center gap-2 whitespace-nowrap">
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-1 text-xs"
            onClick={() => setSelectedTokenId(t.token_id)}
          >
            <ScrollText size={16} strokeWidth={1.8} />
            调用日志
          </button>
          {!t.is_revoked && (
            <button type="button" className={DANGER_BTN} onClick={() => setRevokeTarget(t)}>
              <Ban size={16} strokeWidth={1.8} />
              撤销
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="开放 API Token"
        description="面向 CI / 外部工具的受控访问令牌；明文仅创建时显示一次"
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={16} strokeWidth={1.8} />
            创建令牌
          </button>
        }
      />

      {/* ---------------- 令牌列表 ---------------- */}
      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <KeyRound size={16} strokeWidth={1.8} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">令牌列表</h3>
          </div>
          {tokensQuery.data && (
            <div className="flex items-center gap-1.5">
              <StatusBadge tone="neutral">{tokensQuery.data.total} 个</StatusBadge>
              <StatusBadge tone="success">{activeCount} 生效中</StatusBadge>
            </div>
          )}
        </div>
        <p className="flex items-center gap-1.5 border-b border-line-soft bg-canvas px-5 py-2.5 text-xs text-ink-muted">
          <Lock size={16} strokeWidth={1.8} className="shrink-0 text-ink-subtle" />
          明文令牌（rc_live_ 前缀）仅创建时返回一次，后端仅存 SHA-256 哈希；撤销或过期后立即失效。
        </p>
        {tokensQuery.isPending ? (
          <LoadingState compact message="正在读取令牌列表…" />
        ) : tokensQuery.isError ? (
          <ErrorState compact message={tokensQuery.error.message} code={errorCode(tokensQuery.error)} onRetry={() => void tokensQuery.refetch()} />
        ) : (
          <DataTable
            columns={tokenColumns}
            data={tokens}
            rowKey={(t) => t.token_id}
            empty={
              <EmptyState
                icon={KeyRound}
                title="尚无 API Token"
                description="创建受控访问令牌后，CI 流水线与外部工具可通过开放 API（/api/open/v1）调用。"
                action={
                  <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
                    <Plus size={16} strokeWidth={1.8} />
                    创建第一个令牌
                  </button>
                }
              />
            }
          />
        )}
      </section>

      {/* ---------------- 调用日志 ---------------- */}
      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Activity size={16} strokeWidth={1.8} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">调用日志</h3>
            {logToken && (
              <>
                <StatusBadge tone="accent" dot={false}>{logToken.name}</StatusBadge>
                <span className="mono text-[11px] text-ink-subtle">{logToken.prefix}…</span>
              </>
            )}
          </div>
          {logsQuery.data && <StatusBadge tone="neutral">{logsQuery.data.total} 条</StatusBadge>}
        </div>
        {tokensQuery.isPending ? (
          <LoadingState compact message="正在读取令牌列表…" />
        ) : !logToken ? (
          <EmptyState compact icon={Activity} title="暂无令牌" description="创建令牌后，可在此查看其开放 API 调用日志。" />
        ) : logsQuery.isPending ? (
          <LoadingState compact message="正在读取调用日志…" />
        ) : logsQuery.isError ? (
          <ErrorState compact message={logsQuery.error.message} code={errorCode(logsQuery.error)} onRetry={() => void logsQuery.refetch()} />
        ) : (
          <>
            <DataTable
              columns={logColumns}
              data={logsQuery.data?.items ?? []}
              rowKey={(log) => log.log_id}
              empty={
                <EmptyState compact icon={Activity} title="暂无调用记录" description="使用该令牌调用开放 API 后，日志会显示在这里（最多最近 50 条）。" />
              }
            />
            <p className="border-t border-line-soft bg-canvas px-5 py-2.5 text-xs text-ink-muted">
              超过速率限制返回 <span className="mono font-semibold text-warning">429（RATE_LIMITED）</span>
              ；日志保留 90 天，调用方 IP 仅存哈希。
            </p>
          </>
        )}
      </section>

      {/* ---------------- 创建令牌 Modal ---------------- */}
      <Modal
        open={createOpen}
        title="创建 API Token"
        description="明文仅创建成功后返回一次；请按最小权限原则选择 scope。"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setCreateOpen(false)}>取消</button>
            <button type="button" className="btn-primary" disabled={createMutation.isPending} onClick={submitCreate}>
              <KeyRound size={16} strokeWidth={1.8} />
              {createMutation.isPending ? '正在创建…' : '创建令牌'}
            </button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div>
            <label className="field-label" htmlFor="token-name">令牌名称</label>
            <input
              id="token-name"
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：CI 流水线（生产）"
            />
          </div>
          <div>
            <span className="field-label">授权范围（scope，至少 1 项）</span>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {API_SCOPES.map((s) => {
                const checked = scopes.includes(s.key)
                return (
                  <label
                    key={s.key}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-xs transition ${
                      checked
                        ? 'border-accent bg-accent-wash text-accent-dark'
                        : 'border-line bg-surface text-ink-muted hover:bg-canvas'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 shrink-0 accent-[#2e6bff]"
                      checked={checked}
                      onChange={() => toggleScope(s.key)}
                    />
                    <span className="mono">{s.key}</span>
                    <span className="ml-auto shrink-0">{s.label}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="token-rate">速率限制（次/分）</label>
              <input
                id="token-rate"
                type="number"
                min={1}
                step={1}
                className="field-input mono"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-ink-subtle">超过限制返回 429（RATE_LIMITED）。</p>
            </div>
            <div>
              <label className="field-label" htmlFor="token-expires">过期时间（可选）</label>
              <input
                id="token-expires"
                type="datetime-local"
                className="field-input mono"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-ink-subtle">留空则长期有效，直至手动撤销。</p>
            </div>
          </div>
          {createError && <p className="text-xs font-medium text-danger">{createError}</p>}
        </div>
      </Modal>

      {/* ---------------- 明文一次性展示 Modal ---------------- */}
      <Modal
        open={!!createdToken}
        title="令牌已创建 · 明文仅此一次"
        description={`令牌「${createdToken?.name ?? ''}」已生效。完整明文仅本次返回，关闭弹窗后即从页面状态清除。`}
        onClose={() => setCreatedToken(null)}
        footer={
          <button type="button" className="btn-primary" onClick={() => setCreatedToken(null)}>
            我已保存，关闭
          </button>
        }
      >
        {createdToken && (
          <div className="space-y-3.5">
            <div className="rounded-md border border-accent bg-accent-wash p-3">
              <p className="text-[11px] font-semibold text-accent-dark">完整令牌（rc_live_ 前缀）</p>
              <p className="mono mt-1.5 select-all break-all text-sm leading-6 text-ink">
                {createdToken.token}
              </p>
              <CopyButton text={createdToken.token} label="复制令牌" className="mt-2 !border-accent !bg-surface" />
            </div>
            <div className="flex items-start gap-2 rounded-md border border-danger bg-danger-wash p-3">
              <AlertTriangle size={16} strokeWidth={1.8} className="mt-0.5 shrink-0 text-danger" />
              <p className="text-xs font-medium leading-relaxed text-danger">
                关闭后将无法再次查看完整令牌，请立即复制保存。后端仅存储哈希，明文不可恢复。
              </p>
            </div>
            <div>
              <p className="field-label flex items-center gap-1.5">
                <Terminal size={16} strokeWidth={1.8} /> 调用示例
              </p>
              <pre className="mono whitespace-pre-wrap break-all rounded-md bg-navy-950 px-3 py-2.5 text-[11px] leading-relaxed text-navy-100">
                {`curl -H "Authorization: Bearer ${createdToken.token}" \\
  http://localhost:8000/api/open/v1/projects`}
              </pre>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-subtle">
              {createdToken.scopes.map((s) => (
                <span key={s} className="mono rounded bg-neutral-wash px-1.5 py-0.5 text-neutral" title={scopeLabel(s)}>
                  {s}
                </span>
              ))}
              <span className="mono ml-auto">{createdToken.rate_limit_per_min} 次/分</span>
            </div>
          </div>
        )}
      </Modal>

      {/* ---------------- 撤销确认 Modal ---------------- */}
      <Modal
        open={!!revokeTarget}
        title="撤销 API Token"
        description="此操作立即生效，不可恢复。"
        onClose={() => setRevokeTarget(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setRevokeTarget(null)}>取消</button>
            <button
              type="button"
              className={DANGER_BTN}
              disabled={revokeMutation.isPending}
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.token_id)}
            >
              <Ban size={16} strokeWidth={1.8} />
              {revokeMutation.isPending ? '正在撤销…' : '确认撤销'}
            </button>
          </>
        }
      >
        {revokeTarget && (
          <div className="space-y-3">
            <div className="rounded-md border border-line bg-canvas px-3 py-2 text-sm">
              <p className="font-medium">{revokeTarget.name}</p>
              <p className="mono mt-0.5 text-[11px] text-ink-subtle">
                {revokeTarget.prefix}… · {revokeTarget.token_id}
              </p>
            </div>
            <div className="rounded-md border border-danger bg-danger-wash p-3 text-xs leading-relaxed text-danger">
              撤销后使用该令牌的调用立即失效（401 UNAUTHORIZED），CI 流水线与外部工具将无法继续访问；调用日志保留留痕。
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}