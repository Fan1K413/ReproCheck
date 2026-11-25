/**
 * Wave E · AI 模型服务（/settings/llm）
 * --------------------------------------------------------------------------
 * 设计：V3 全站统一深色空间体系，与主工作台同一 --rc-* 语义 token。
 * 硬约束：API 密钥只在后端读取与保存，前端不接收明文；
 *         浏览器草稿（sessionStorage）只允许保存非敏感字段，
 *         密钥字段绝不落盘 —— 页面底部提供实时自检。
 */
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cpu, PlugZap, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { LoadingState } from '../components/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import { formatCount, formatDateTime, formatDuration } from '../features/format'
import { connectionMeta } from '../features/llm'
import { ApiError, api } from '../services/api'
import '../styles/wave-e-model.css'

/** 草稿槽位前缀：与模型管理中心共用，只允许写入非敏感字段。 */
const DRAFT_PREFIX = 'rc.draft.'
/** 命中即视为“密钥字段”的字段名模式。 */
const SECRET_FIELD_PATTERN = /api[_-]?key|secret|passwo?rd|credential_secret/i

/**
 * 扫描 sessionStorage 中的草稿槽位，确认没有任何密钥字段落盘。
 * 只读、不抛错；隐私模式下 sessionStorage 不可用时返回空数组（视为无泄漏）。
 */
function scanSecretDrafts(): string[] {
  if (typeof window === 'undefined') return []
  let storage: Storage | null = null
  try {
    storage = window.sessionStorage
  } catch {
    return []
  }
  if (!storage) return []
  const hits: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key || !key.startsWith(DRAFT_PREFIX)) continue
    let raw = ''
    try {
      raw = storage.getItem(key) ?? ''
    } catch {
      continue
    }
    if (SECRET_FIELD_PATTERN.test(key) || SECRET_FIELD_PATTERN.test(raw)) hits.push(key)
  }
  return hits
}

function SpecRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rc-we-spec">
      <span className="rc-we-spec__k">{label}</span>
      <div className="rc-we-spec__v">{children}</div>
    </div>
  )
}

export default function LlmSettingsPage() {
  const qc = useQueryClient()
  const statusQuery = useQuery({ queryKey: ['llm-status'], queryFn: api.getLlmStatus })
  const testMutation = useMutation({
    mutationFn: api.testLlm,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['llm-status'] })
    },
  })
  const status = statusQuery.data
  const testError = testMutation.error as ApiError | null
  const testData = testMutation.data

  // 密钥落盘自检：状态变化或测试完成后重新扫描一次草稿槽位。
  const secretDraftHits = useMemo(
    () => scanSecretDrafts(),
    [statusQuery.data, testMutation.data, testMutation.isError],
  )

  return (
    <div className="rc-we-page rc-we-page--bleed">
      <header className="rc-we-head">
        <div className="rc-we-head__text">
          <p className="rc-we-eyebrow">系统级状态 · 排错用</p>
          <h1 className="rc-we-title">系统 AI 状态</h1>
          <p className="rc-we-lead">系统默认 AI 服务状态</p>
        </div>
        <div className="rc-we-actions">
          <Link to="/settings/models?tab=providers" className="btn-primary">
            <Icon as={SlidersHorizontal} size="sm" />
            连接 AI 助手
          </Link>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? (
              <>
                <Icon name="loader" size="sm" className="animate-spin" />
                测试中…
              </>
            ) : (
              <>
                <Icon as={PlugZap} size="sm" />
                测试系统连接
              </>
            )}
          </button>
        </div>
      </header>

      <section className="rc-we-note" aria-label="密钥安全说明">
        <Icon as={ShieldCheck} size="md" className="rc-we-note__icon" />
        <div className="rc-we-row-between" style={{ flex: 1 }}>
          <span>密钥加密保存在后端，前端不存储明文。</span>
          {secretDraftHits.length === 0 ? (
            <StatusBadge tone="success">草稿自检通过</StatusBadge>
          ) : (
            <StatusBadge tone="danger">
              发现 {secretDraftHits.length} 处疑似密钥字段
            </StatusBadge>
          )}
        </div>
      </section>

      {statusQuery.isPending ? (
        <section className="rc-we-card">
          <LoadingState message="正在读取模型服务状态…" />
        </section>
      ) : statusQuery.isError || !status ? (
        <section className="rc-we-card">
          <ErrorState
            message="无法获取模型服务状态，请确认后端服务已启动。"
            onRetry={() => void statusQuery.refetch()}
          />
        </section>
      ) : (
        <div className="rc-we-grid rc-we-grid--2">
          <section className="rc-we-card">
            <div className="rc-we-card__head">
              <h2 className="rc-we-card__title">
                <Icon as={Cpu} size="md" tone="accent" />
                服务配置
              </h2>
              <StatusBadge tone={connectionMeta[status.connection_status].tone}>
                {connectionMeta[status.connection_status].label}
              </StatusBadge>
            </div>
            <div className="rc-we-card__body" style={{ paddingTop: 'var(--rc-space-2)' }}>
              <SpecRow label="服务商">
                <span className="rc-we-spec__v--mono">{status.provider}</span>
              </SpecRow>
              <SpecRow label="模型">
                <span className="rc-we-spec__v--mono" title={status.model}>
                  {status.model}
                </span>
              </SpecRow>
              <SpecRow label="API 密钥">
                <StatusBadge tone={status.api_key_configured ? 'success' : 'neutral'}>
                  {status.api_key_configured ? '已配置' : '未配置'}
                </StatusBadge>
              </SpecRow>
              <SpecRow label="连接状态">
                <StatusBadge tone={connectionMeta[status.connection_status].tone}>
                  {connectionMeta[status.connection_status].label}
                </StatusBadge>
              </SpecRow>
            </div>
          </section>

          <section className="rc-we-card">
            <div className="rc-we-card__head">
              <h2 className="rc-we-card__title">
                <Icon as={PlugZap} size="md" tone="accent" />
                最近一次调用
              </h2>
              <StatusBadge tone={status.last_call_success == null ? 'neutral' : status.last_call_success ? 'success' : 'danger'}>
                {status.last_call_success == null
                  ? '暂无记录'
                  : status.last_call_success
                    ? '成功'
                    : '失败'}
              </StatusBadge>
            </div>
            <div className="rc-we-card__body" style={{ paddingTop: 'var(--rc-space-2)' }}>
              <SpecRow label="调用时间">
                <span className="rc-we-spec__v--mono">{formatDateTime(status.last_call_at)}</span>
              </SpecRow>
              <SpecRow label="调用耗时">
                <span className="rc-we-spec__v--mono">
                  {formatDuration(status.last_call_duration_ms)}
                </span>
              </SpecRow>
              <SpecRow label="调用结果">
                {status.last_call_success == null ? (
                  <span style={{ color: 'var(--rc-text-subtle)' }}>暂无记录</span>
                ) : (
                  <StatusBadge tone={status.last_call_success ? 'success' : 'danger'}>
                    {status.last_call_success ? '成功' : '失败'}
                  </StatusBadge>
                )}
              </SpecRow>
              <SpecRow label="Token 用量">
                {status.last_token_usage ? (
                  <span className="rc-we-spec__v--mono">
                    {formatCount(status.last_token_usage.total_tokens)} 个 Token
                    <span
                      className="ml-1"
                      style={{ color: 'var(--rc-text-subtle)', fontWeight: 'var(--rc-fw-r)' }}
                    >
                      (提示 {formatCount(status.last_token_usage.prompt_tokens)} / 补全{' '}
                      {formatCount(status.last_token_usage.completion_tokens)})
                    </span>
                  </span>
                ) : (
                  <span style={{ color: 'var(--rc-text-subtle)' }}>暂无记录</span>
                )}
              </SpecRow>
            </div>
          </section>
        </div>
      )}

      {(testMutation.isSuccess || testMutation.isError) && (
        <section className="rc-we-card">
          <div className="rc-we-card__head">
            <h2 className="rc-we-card__title">连接测试结果</h2>
            {testMutation.isSuccess && (
              <StatusBadge tone={testData?.success ? 'success' : 'danger'}>
                {testData?.success ? '调用成功' : '调用未成功'}
              </StatusBadge>
            )}
          </div>
          {testMutation.isError ? (
            <div className="rc-we-card__body">
              <ErrorState
                compact
                message={testError?.message ?? '模型连接测试失败。'}
                code={testError?.code}
                onRetry={() => testMutation.mutate()}
              />
            </div>
          ) : testData ? (
            <div className="rc-we-card__body">
              <div className="rc-we-grid rc-we-grid--3">
                <div className="rc-we-kpi">
                  <p className="rc-we-kpi__k">模型</p>
                  <p className="rc-we-kpi__v" title={testData.model}>
                    {testData.model}
                  </p>
                </div>
                <div className="rc-we-kpi">
                  <p className="rc-we-kpi__k">耗时</p>
                  <p className="rc-we-kpi__v">{formatDuration(testData.duration_ms)}</p>
                </div>
                <div className="rc-we-kpi">
                  <p className="rc-we-kpi__k">Token 用量</p>
                  <p className="rc-we-kpi__v">
                    {testData.token_usage ? formatCount(testData.token_usage.total_tokens) : '—'}
                  </p>
                </div>
              </div>
              <div className="rc-we-stack-tight" style={{ marginTop: 'var(--rc-space-5)' }}>
                <p className="field-label">模型返回内容</p>
                <pre className="rc-we-code">{testData.reply}</pre>
              </div>
              <p className="rc-we-mono" style={{ marginTop: 'var(--rc-space-2)', color: 'var(--rc-text-subtle)' }}>
                测试时间：{formatDateTime(testData.tested_at)}
              </p>
            </div>
          ) : null}
        </section>
      )}
    </div>
  )
}
