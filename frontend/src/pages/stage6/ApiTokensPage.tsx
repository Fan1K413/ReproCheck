import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Ban,
  KeyRound,
  ScrollText,
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
import { StatusBadge, type Tone } from '../../components/StatusBadge'
import { formatDateTime, formatDuration } from '../../features/format'
import { API_SCOPES } from '../../features/stage6Meta'
import { ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import { toast } from '../../stores/toastStore'
import type { ApiCallLog, ApiToken, ApiTokenCreated } from '../../types/stage6'
import '../../styles/wave-d-stage6.css'

/**
 * 密钥安全约定（global-interaction-spec.md §6.2「未保存数据丢失」）：
 * 本页 **不做任何草稿持久化** —— 不写 sessionStorage、不写 localStorage。
 * 令牌明文只在创建成功的那一次响应里存在于 React 组件状态，
 * 关闭弹窗即被清除；scope / 速率 / 过期等非敏感项同样不落盘，
 * 以免令牌明文经由草稿恢复链路外泄。
 */

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
      <span className="mono whitespace-nowrap text-xs rcw-muted">{formatDateTime(log.created_at)}</span>
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
      <span className="mono block max-w-[320px] truncate text-xs" title={log.endpoint}>
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
      <span className="mono whitespace-nowrap text-xs rcw-muted">{formatDuration(log.duration_ms)}</span>
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

  const kpis = [
    { label: '令牌总数', value: tokensQuery.data?.total ?? 0, icon: 'key' as const },
    { label: '生效中', value: activeCount, icon: 'shield' as const },
    { label: '已撤销 / 过期', value: tokens.length - activeCount, icon: 'triangleAlert' as const },
    { label: '可选 scope', value: API_SCOPES.length, icon: 'listTree' as const },
  ]

  return (
    <div className="rcw-page">
      <div className="rcw-stack">
        <PageHeader
          title="开放 API Token"
          description="外部集成受控访问令牌"
          actions={
            <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size="xs" />创建令牌
            </button>
          }
        />

        <div className="rcw-grid rcw-grid-4 rc-stagger">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="rcw-kpi">
              <span className="rcw-kpi-icon"><Icon name={kpi.icon} size="sm" /></span>
              <div className="min-w-0">
                <p className="rcw-kpi-value">{kpi.value}</p>
                <p className="rcw-kpi-label">{kpi.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ---------------- 令牌卡墙 ---------------- */}
        <section className="rcw-card">
          <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)', borderBottom: 'var(--rc-stroke-hair)' }}>
            <h3 className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
              <Icon name="key" size="sm" tone="accent" />令牌
            </h3>
            {tokensQuery.data && (
              <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                <StatusBadge tone="neutral">{tokensQuery.data.total} 个</StatusBadge>
                <StatusBadge tone="success">{activeCount} 生效中</StatusBadge>
              </div>
            )}
          </div>
          {tokensQuery.isPending ? (
            <LoadingState compact message="正在读取令牌列表…" />
          ) : tokensQuery.isError ? (
            <ErrorState compact message={tokensQuery.error.message} code={errorCode(tokensQuery.error)} onRetry={() => void tokensQuery.refetch()} />
          ) : tokens.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title="尚无 API Token"
              description="创建受控访问令牌后，CI 流水线与外部工具可安全调用开放 API。"
              action={
                <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
                  <Icon name="plus" size="xs" />创建第一个令牌
                </button>
              }
            />
          ) : (
            <div className="rcw-grid rcw-grid-3" style={{ marginTop: 'var(--rc-space-4)' }}>
              {tokens.map((token) => {
                const meta = tokenStatusMeta(token)
                const selected = token.token_id === logTokenId
                return (
                  <article key={token.token_id} className="rcw-token" data-selected={selected ? 'true' : 'false'}>
                    <div className="rcw-row-between" style={{ alignItems: 'flex-start' }}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{token.name}</p>
                        <p className="mono mt-0.5 truncate text-[11px] rcw-faint">{token.token_id}</p>
                      </div>
                      <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                    </div>
                    <p className="mono text-[11px] rcw-muted">
                      前缀 <span className="rcw-ink">{token.prefix}…</span> · 限速 <span className="rcw-ink">{token.rate_limit_per_min}</span> 次/分
                    </p>
                    <div className="rcw-row" style={{ gap: 'var(--rc-space-1)' }}>
                      {token.scopes.map((s) => (
                        <span key={s} className="rcw-chip rcw-chip-accent" title={scopeLabel(s)}>{s}</span>
                      ))}
                    </div>
                    <div className="rcw-stack-tight" style={{ fontSize: 'var(--rc-fs-caption)' }}>
                      <span className="rcw-row-between"><span className="rcw-faint">最近调用</span><span className="mono rcw-muted">{formatDateTime(token.last_used_at)}</span></span>
                      <span className="rcw-row-between"><span className="rcw-faint">过期时间</span><span className="mono rcw-muted">{token.expires_at ? formatDateTime(token.expires_at) : '长期有效'}</span></span>
                      <span className="rcw-row-between"><span className="rcw-faint">创建时间</span><span className="mono rcw-muted">{formatDateTime(token.created_at)}</span></span>
                    </div>
                    <div className="rcw-row-end" style={{ marginTop: 'auto', paddingTop: 'var(--rc-space-3)', borderTop: 'var(--rc-stroke-hair)' }}>
                      <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setSelectedTokenId(token.token_id)}>
                        <Icon as={ScrollText} size="xs" />调用日志
                      </button>
                      {!token.is_revoked && (
                        <button type="button" className="rcw-danger !px-2.5 !py-1 text-xs" onClick={() => setRevokeTarget(token)}>
                          <Icon as={Ban} size="xs" />撤销
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        {/* ---------------- 调用日志 ---------------- */}
        <section className="rcw-card">
          <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)', borderBottom: 'var(--rc-stroke-hair)' }}>
            <h3 className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
              <Icon as={Activity} size="sm" tone="accent" />调用日志
            </h3>
            <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
              {logToken && (
                <>
                  <StatusBadge tone="accent" dot={false}>{logToken.name}</StatusBadge>
                  <span className="mono text-[11px] rcw-faint">{logToken.prefix}…</span>
                </>
              )}
              {logsQuery.data && <StatusBadge tone="neutral">{logsQuery.data.total} 条</StatusBadge>}
            </div>
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
              <div style={{ marginTop: 'var(--rc-space-3)' }}>
                <DataTable
                  columns={logColumns}
                  data={logsQuery.data?.items ?? []}
                  rowKey={(log) => log.log_id}
                  empty={
                    <EmptyState compact icon={Activity} title="暂无调用记录" description="使用该令牌调用开放 API 后，日志会显示在这里（最多最近 50 条）。" />
                  }
                />
              </div>
              <p className="mt-3 text-xs rcw-muted">
                超过速率限制返回 <span className="mono font-semibold" style={{ color: 'var(--rc-warning)' }}>429（RATE_LIMITED）</span>
                ；日志保留 90 天，调用方 IP 仅存哈希。
              </p>
            </>
          )}
        </section>
      </div>

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
              <Icon name="key" size="xs" />
              {createMutation.isPending ? '正在创建…' : '创建令牌'}
            </button>
          </>
        }
      >
        <div className="space-y-3.5">
          <p className="rcw-note">
            本表单不写入 sessionStorage / localStorage：关闭或刷新后需重新填写，密钥明文亦不会被任何本地存储留存。
          </p>
          <div>
            <label className="field-label" htmlFor="token-name">令牌名称</label>
            <input
              id="token-name"
              className="field-input"
              autoComplete="off"
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
                    className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-xs transition"
                    style={{
                      borderColor: checked ? 'var(--rc-accent)' : 'var(--rc-border-hair)',
                      backgroundColor: checked ? 'var(--rc-accent-wash)' : 'var(--rc-surface)',
                      color: checked ? 'var(--rcw-ink)' : 'var(--rc-text-muted)',
                    }}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 shrink-0"
                      style={{ accentColor: 'var(--rc-accent)' }}
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
              <p className="mt-1 text-[11px] rcw-faint">超过限制返回 429（RATE_LIMITED）。</p>
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
              <p className="mt-1 text-[11px] rcw-faint">留空则长期有效，直至手动撤销。</p>
            </div>
          </div>
          {createError && <p className="text-xs font-medium" style={{ color: 'var(--rc-danger)' }}>{createError}</p>}
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
            <div className="rcw-note">
              <p className="text-[11px] font-semibold">完整令牌（rc_live_ 前缀）</p>
              <p className="mono mt-1.5 select-all break-all text-sm leading-6" style={{ color: 'var(--rc-text)' }}>
                {createdToken.token}
              </p>
              <CopyButton text={createdToken.token} label="复制令牌" className="mt-2 !border-accent !bg-surface" />
            </div>
            <div className="rcw-note rcw-note--danger">
              <p className="rcw-row" style={{ gap: 'var(--rc-space-2)', alignItems: 'flex-start' }}>
                <Icon as={AlertTriangle} size="xs" style={{ marginTop: 3 }} />
                <span className="text-xs font-medium leading-relaxed">
                  关闭后将无法再次查看完整令牌，请立即复制保存。后端仅存储哈希，明文不可恢复。
                </span>
              </p>
            </div>
            <div>
              <p className="field-label rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                <Icon name="terminal" size="xs" />调用示例
              </p>
              <pre className="mono whitespace-pre-wrap break-all rounded-md px-3 py-2.5 text-[11px] leading-relaxed"
                style={{ backgroundColor: 'var(--rc-surface-3)', color: 'var(--rc-text)' }}>
                {`curl -H "Authorization: Bearer ${createdToken.token}" \\
  http://localhost:8000/api/open/v1/projects`}
              </pre>
            </div>
            <div className="rcw-row" style={{ gap: 'var(--rc-space-1)' }}>
              {createdToken.scopes.map((s) => (
                <span key={s} className="rcw-chip" title={scopeLabel(s)}>{s}</span>
              ))}
              <span className="mono ml-auto text-[11px] rcw-faint">{createdToken.rate_limit_per_min} 次/分</span>
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
            <button type="button" className="rcw-danger" disabled={revokeMutation.isPending}
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.token_id)}>
              <Icon as={Ban} size="xs" />
              {revokeMutation.isPending ? '正在撤销…' : '确认撤销'}
            </button>
          </>
        }
      >
        {revokeTarget && (
          <div className="rcw-stack-tight">
            <div className="rcw-card rcw-card-flat rcw-card-tight">
              <p className="font-medium">{revokeTarget.name}</p>
              <p className="mono mt-0.5 text-[11px] rcw-faint">
                {revokeTarget.prefix}… · {revokeTarget.token_id}
              </p>
            </div>
            <div className="rcw-note rcw-note--danger">
              撤销后使用该令牌的调用立即失效（401 UNAUTHORIZED），CI 流水线与外部工具将无法继续访问；调用日志保留留痕。
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
