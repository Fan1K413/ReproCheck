import type { ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Cpu, Loader2, PlugZap, ShieldCheck } from 'lucide-react'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import { formatCount, formatDateTime, formatDuration } from '../features/format'
import { connectionMeta } from '../features/llm'
import { ApiError, api } from '../services/api'

type RowProps = {
  label: string
  children: ReactNode
}

function SpecRow({ label, children }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line-soft py-3 last:border-0">
      <span className="shrink-0 text-sm text-ink-muted">{label}</span>
      <div className="min-w-0 text-right text-sm font-medium text-ink">{children}</div>
    </div>
  )
}

export default function LlmSettingsPage() {
  const statusQuery = useQuery({ queryKey: ['llm-status'], queryFn: api.getLlmStatus })
  const testMutation = useMutation({ mutationFn: api.testLlm })
  const status = statusQuery.data
  const testError = testMutation.error as ApiError | null
  const testData = testMutation.data

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">AI 模型服务</h2>
          <p className="mt-1 text-sm text-ink-muted">查看模型服务状态并发起一次真实连接测试。</p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending}
        >
          {testMutation.isPending ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              测试中…
            </>
          ) : (
            <>
              <PlugZap size={16} />
              测试模型连接
            </>
          )}
        </button>
      </div>

      <div className="flex items-start gap-3 rounded-panel border border-line bg-surface p-4">
        <ShieldCheck size={19} className="mt-0.5 shrink-0 text-accent" />
        <div>
          <p className="text-sm font-semibold text-ink">密钥安全说明</p>
          <p className="mt-1 text-sm text-ink-muted">
            API 密钥仅在后端服务中读取与保存。前端不会接收、存储或展示明文密钥，此处仅显示“已配置 / 未配置”状态。
          </p>
        </div>
      </div>

      {statusQuery.isPending ? (
        <div className="panel">
          <LoadingState message="正在读取模型服务状态…" />
        </div>
      ) : statusQuery.isError || !status ? (
        <div className="panel">
          <ErrorState
            message="无法获取模型服务状态，请确认后端服务已启动。"
            onRetry={() => void statusQuery.refetch()}
          />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="panel overflow-hidden">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <Cpu size={17} className="text-accent" />
                <h3 className="text-sm font-semibold">服务配置</h3>
              </div>
            </div>
            <div className="px-5 py-1">
              <SpecRow label="服务提供方 (provider)">
                <span className="mono text-[13px]">{status.provider}</span>
              </SpecRow>
              <SpecRow label="模型 (model)">
                <span className="mono block truncate text-[13px]" title={status.model}>
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

          <section className="panel overflow-hidden">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <PlugZap size={17} className="text-accent" />
                <h3 className="text-sm font-semibold">最近一次调用</h3>
              </div>
            </div>
            <div className="px-5 py-1">
              <SpecRow label="调用时间">
                <span className="mono text-[13px]">{formatDateTime(status.last_call_at)}</span>
              </SpecRow>
              <SpecRow label="调用耗时">
                <span className="mono text-[13px]">{formatDuration(status.last_call_duration_ms)}</span>
              </SpecRow>
              <SpecRow label="调用结果">
                {status.last_call_success == null ? (
                  <span className="text-ink-subtle">暂无记录</span>
                ) : (
                  <StatusBadge tone={status.last_call_success ? 'success' : 'danger'}>
                    {status.last_call_success ? '成功' : '失败'}
                  </StatusBadge>
                )}
              </SpecRow>
              <SpecRow label="Token 用量">
                {status.last_token_usage ? (
                  <span className="mono text-[13px]">
                    {formatCount(status.last_token_usage.total_tokens)} tokens
                    <span className="ml-1 text-xs font-normal text-ink-subtle">
                      (提示 {formatCount(status.last_token_usage.prompt_tokens)} / 补全 {formatCount(status.last_token_usage.completion_tokens)})
                    </span>
                  </span>
                ) : (
                  <span className="text-ink-subtle">暂无记录</span>
                )}
              </SpecRow>
            </div>
          </section>
        </div>
      )}

      {(testMutation.isSuccess || testMutation.isError) && (
        <section className="panel overflow-hidden">
          <div className="panel-header">
            <h3 className="text-sm font-semibold">连接测试结果</h3>
            {testMutation.isSuccess && (
              <StatusBadge tone={testData?.success ? 'success' : 'danger'}>
                {testData?.success ? '调用成功' : '调用未成功'}
              </StatusBadge>
            )}
          </div>
          {testMutation.isError ? (
            <ErrorState
              compact
              message={testError?.message ?? '模型连接测试失败。'}
              code={testError?.code}
              onRetry={() => testMutation.mutate()}
            />
          ) : testData ? (
            <div className="p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-line-soft bg-canvas px-3 py-2">
                  <p className="text-[11px] text-ink-subtle">模型</p>
                  <p className="mono mt-0.5 truncate text-[13px] font-medium" title={testData.model}>
                    {testData.model}
                  </p>
                </div>
                <div className="rounded-md border border-line-soft bg-canvas px-3 py-2">
                  <p className="text-[11px] text-ink-subtle">耗时</p>
                  <p className="mono mt-0.5 text-[13px] font-medium">{formatDuration(testData.duration_ms)}</p>
                </div>
                <div className="rounded-md border border-line-soft bg-canvas px-3 py-2">
                  <p className="text-[11px] text-ink-subtle">Token 用量</p>
                  <p className="mono mt-0.5 text-[13px] font-medium">
                    {testData.token_usage ? formatCount(testData.token_usage.total_tokens) : '—'}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <p className="field-label">模型返回内容</p>
                <pre className="mono max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-canvas p-4 text-[13px] leading-relaxed text-ink">
                  {testData.reply}
                </pre>
              </div>
              <p className="mt-2 text-xs text-ink-subtle">测试时间：{formatDateTime(testData.tested_at)}</p>
            </div>
          ) : null}
        </section>
      )}
    </div>
  )
}
