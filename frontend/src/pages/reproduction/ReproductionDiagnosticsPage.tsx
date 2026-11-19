import { useMutation, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Lightbulb,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { StatusBadge } from '../../components/StatusBadge'
import { DeterministicDiagnosisPanel } from '../../components/DeterministicDiagnosisPanel'
import { formatConfidence, formatDateTime } from '../../features/format'
import { DECISION_LABEL, runStatusLabel, runStatusTone } from '../../features/reproductionMeta'
import { useTrackProject } from '../../hooks/useTrackProject'
import { ApiError } from '../../services/api'
import { reproductionApi } from '../../services/reproductionApi'
import type {
  DiagnosticView,
  RemediationDecision,
  ReproRunView,
} from '../../types/reproduction'

function MutationError({ error }: { error: unknown }) {
  if (!error) return null
  const code = error instanceof ApiError ? error.code : 'UNKNOWN_ERROR'
  const message = error instanceof Error ? error.message : '操作失败，请稍后重试。'
  if (code === 'LLM_KEY_NOT_CONFIGURED') {
    return (
      <div className="rounded-md border border-warning/30 bg-warning-wash p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-warning">
          <AlertTriangle size={16} /> AI 诊断不可用
        </p>
        <p className="mt-2 text-xs text-ink-muted">
          后端未配置可用的模型密钥，未生成任何诊断结论。页面不会展示预设或伪造的诊断内容。
        </p>
        <p className="mono mt-2 text-[11px] text-warning">错误码：{code}</p>
        <p className="mt-1 break-words text-xs text-ink-muted">后端消息：{message}</p>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-danger/30 bg-danger-wash p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-danger">
        <AlertTriangle size={16} /> 请求未成功
      </p>
      <p className="mt-2 break-words text-xs text-ink-muted">{message}</p>
      <p className="mono mt-2 text-[11px] text-danger">错误码：{code}</p>
    </div>
  )
}

function PossibleCauseCard({
  cause,
  index,
}: {
  cause: DiagnosticView['possible_causes'][number]
  index: number
}) {
  return (
    <div className="rounded-lg border border-line-soft p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          <span className="mono mr-1.5 text-[11px] text-ink-subtle">#{index + 1}</span>
          {cause.cause}
        </p>
        <StatusBadge tone="accent" dot={false}>{formatConfidence(cause.confidence)}</StatusBadge>
      </div>
      <p className="mt-2 text-xs text-ink-muted">依据：{cause.basis || '后端未提供依据。'}</p>
    </div>
  )
}

export default function ReproductionDiagnosticsPage() {
  const pid = useParams().pid ?? ''
  useTrackProject(pid)

  const runsQuery = useQuery({
    queryKey: ['repro-runs', pid],
    queryFn: () => reproductionApi.listRuns(pid),
    enabled: !!pid,
  })
  const [selectedRunId, setSelectedRunId] = useState('')

  useEffect(() => {
    const items = runsQuery.data?.items ?? []
    if (!selectedRunId && items.length > 0) setSelectedRunId(items[0].run_id)
  }, [runsQuery.data, selectedRunId])

  const diagnosticMutation = useMutation({
    mutationFn: () =>
      reproductionApi.createDiagnostic({ run_id: selectedRunId, project_id: pid }),
  })

  const [proposalId, setProposalId] = useState('')
  const [decision, setDecision] = useState<RemediationDecision>('approve')
  const [reviewer, setReviewer] = useState('')
  const [note, setNote] = useState('')
  const [modifiedValue, setModifiedValue] = useState('')

  useEffect(() => {
    const data = diagnosticMutation.data
    if (!data) return
    const first = data.remediation_proposals?.[0]?.proposal_id ?? data.proposal_id ?? ''
    setProposalId(first)
  }, [diagnosticMutation.data])

  const reviewMutation = useMutation({
    mutationFn: () =>
      reproductionApi.reviewRemediation(proposalId, {
        decision,
        reviewer: reviewer.trim() || '未署名',
        note: note.trim() || undefined,
        modified_value: decision === 'modify' ? modifiedValue : undefined,
      }),
  })

  const diagnostic = diagnosticMutation.data
  const selectedRun: ReproRunView | undefined = (runsQuery.data?.items ?? []).find(
    (run) => run.run_id === selectedRunId,
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-dark">AI Diagnostics</p>
          <h2 className="mt-1 text-lg font-semibold">AI 诊断与人工审核</h2>
          <p className="mt-1 text-sm text-ink-muted">
            诊断由后端 POST /diagnostics 生成；无模型密钥时仅显示后端返回的不可用错误，不展示任何预设诊断。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/projects/${pid}/reproduction`} className="btn-ghost">返回总览</Link>
          {selectedRunId && (
            <Link to={`/reproductions/runs/${selectedRunId}`} className="btn-ghost">查看控制台</Link>
          )}
        </div>
      </div>

      <DeterministicDiagnosisPanel />

      <section className="panel p-5">
        <h3 className="text-sm font-semibold">选择要诊断的运行</h3>
        {runsQuery.isPending ? (
          <div className="mt-3"><LoadingState compact message="正在读取运行列表…" /></div>
        ) : runsQuery.isError ? (
          <div className="mt-3">
            <ErrorState
              compact
              message={runsQuery.error instanceof Error ? runsQuery.error.message : '无法获取运行列表。'}
              code={runsQuery.error instanceof ApiError ? runsQuery.error.code : undefined}
              onRetry={() => void runsQuery.refetch()}
            />
          </div>
        ) : (runsQuery.data?.items ?? []).length === 0 ? (
          <div className="mt-3">
            <EmptyState
              compact
              icon={Bot}
              title="暂无可诊断的运行"
              description="请先创建复现运行，再对该运行发起 AI 诊断。"
            />
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[260px] flex-1">
              <label className="field-label" htmlFor="diagnostic-run">运行</label>
              <select
                id="diagnostic-run"
                className="field-input"
                value={selectedRunId}
                onChange={(event) => setSelectedRunId(event.target.value)}
              >
                {(runsQuery.data?.items ?? []).map((run) => (
                  <option key={run.run_id} value={run.run_id}>
                    {run.run_id} · {runStatusLabel(run.status)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={!selectedRunId || diagnosticMutation.isPending}
              onClick={() => diagnosticMutation.mutate()}
            >
              {diagnosticMutation.isPending ? (
                <><RefreshCw size={15} className="animate-spin" />诊断中…</>
              ) : (
                <><Bot size={15} />发起 AI 诊断</>
              )}
            </button>
          </div>
        )}
        {selectedRun && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge tone={runStatusTone(selectedRun.status)}>
              {runStatusLabel(selectedRun.status)}
            </StatusBadge>
            <span className="text-xs text-ink-subtle">
              plan_id: <span className="mono">{selectedRun.plan_id}</span>
            </span>
          </div>
        )}
        <div className="mt-4"><MutationError error={diagnosticMutation.error} /></div>
      </section>

      {diagnostic && (
        <>
          <section className="panel overflow-hidden">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <Bot size={17} className="text-accent-dark" />
                <h3 className="text-sm font-semibold">诊断结果</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone={diagnostic.ai_available ? 'success' : 'warning'}>
                  AI {diagnostic.ai_available ? '可用' : '不可用'}
                </StatusBadge>
                {diagnostic.needs_human_confirm && <StatusBadge tone="warning">需人工确认</StatusBadge>}
                <span className="text-xs text-ink-subtle">{formatDateTime(diagnostic.created_at)}</span>
              </div>
            </div>
            <div className="space-y-5 p-5">
              <div>
                <h4 className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
                  <AlertTriangle size={14} className="text-danger" />问题
                </h4>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{diagnostic.problem}</p>
              </div>
              <div>
                <h4 className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
                  <ClipboardCheck size={14} className="text-accent-dark" />错误证据
                </h4>
                <p className="mono mt-2 whitespace-pre-wrap break-all rounded-md border border-line-soft bg-canvas/60 p-3 text-xs text-ink">
                  {diagnostic.error_evidence || '后端未提供错误证据。'}
                </p>
              </div>
              <div>
                <h4 className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
                  <Lightbulb size={14} className="text-warning" />可能原因
                </h4>
                <div className="mt-2 grid gap-3 lg:grid-cols-2">
                  {(diagnostic.possible_causes ?? []).length === 0 ? (
                    <p className="text-xs text-ink-subtle">后端未提供可能原因。</p>
                  ) : (
                    diagnostic.possible_causes.map((cause, index) => (
                      <PossibleCauseCard key={`${cause.cause}-${index}`} cause={cause} index={index} />
                    ))
                  )}
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-line-soft p-3">
                  <h4 className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
                    <ShieldCheck size={14} className="text-success" />修复建议
                  </h4>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">
                    {diagnostic.suggested_fix || '后端未提供修复建议。'}
                  </p>
                </div>
                <div className="rounded-lg border border-line-soft p-3">
                  <h4 className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
                    <CheckCircle2 size={14} className="text-accent-dark" />验证方式
                  </h4>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">
                    {diagnostic.verification_method || '后端未提供验证方式。'}
                  </p>
                </div>
              </div>
              <p className="mono text-[10px] text-ink-subtle">
                diagnostic_id: {diagnostic.diagnostic_id} · prompt_version: {diagnostic.prompt_version ?? '—'}
              </p>
            </div>
          </section>

          <section className="panel overflow-hidden">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <ShieldCheck size={17} className="text-accent-dark" />
                <h3 className="text-sm font-semibold">修复建议人工审核</h3>
              </div>
              <StatusBadge tone="neutral" dot={false}>POST /remediations/{'{id}'}/review</StatusBadge>
            </div>
            <div className="p-5">
              {(diagnostic.remediation_proposals ?? []).length > 0 && (
                <div className="mb-4 space-y-2">
                  {diagnostic.remediation_proposals!.map((proposal, index) => (
                    <button
                      key={`${proposal.proposal_id}-${index}`}
                      type="button"
                      onClick={() => setProposalId(proposal.proposal_id ?? '')}
                      className={`w-full rounded-md border p-3 text-left text-xs transition-colors ${
                        proposalId === proposal.proposal_id
                          ? 'border-accent bg-accent-wash'
                          : 'border-line-soft hover:bg-canvas'
                      }`}
                    >
                      <span className="font-medium">{proposal.change_type || `提案 ${index + 1}`}</span>
                      {proposal.target_file && <span className="mono ml-2 text-ink-subtle">{proposal.target_file}</span>}
                      <span className="mt-1 block break-words text-ink-muted">
                        原值：{proposal.original_value || '—'} → 建议：{proposal.proposed_value || '—'}
                      </span>
                      {proposal.changes_research_conditions && (
                        <span className="mt-1 block text-warning">该变更会影响研究条件</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="proposal-id">修复提案 ID</label>
                  <input
                    id="proposal-id"
                    className="field-input mono"
                    value={proposalId}
                    onChange={(event) => setProposalId(event.target.value)}
                    placeholder="后端返回的 proposal_id"
                  />
                  <p className="mt-1 text-[11px] text-ink-subtle">
                    诊断结果若附带提案会自动填入；否则请填写后端记录中的 proposal_id（如报告证据引用中的 remediation_proposals:&lt;id&gt;）。
                  </p>
                </div>
                <div>
                  <label className="field-label" htmlFor="review-decision">审核决定</label>
                  <select
                    id="review-decision"
                    className="field-input"
                    value={decision}
                    onChange={(event) => setDecision(event.target.value as RemediationDecision)}
                  >
                    {(['approve', 'reject', 'modify'] as RemediationDecision[]).map((value) => (
                      <option key={value} value={value}>{DECISION_LABEL[value]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="reviewer">审核人</label>
                  <input
                    id="reviewer"
                    className="field-input"
                    value={reviewer}
                    onChange={(event) => setReviewer(event.target.value)}
                    placeholder=" reviewer 姓名"
                  />
                </div>
                {decision === 'modify' && (
                  <div>
                    <label className="field-label" htmlFor="modified-value">修改后的值</label>
                    <input
                      id="modified-value"
                      className="field-input"
                      value={modifiedValue}
                      onChange={(event) => setModifiedValue(event.target.value)}
                    />
                  </div>
                )}
                <div className="sm:col-span-2">
                  <label className="field-label" htmlFor="review-note">备注</label>
                  <textarea
                    id="review-note"
                    className="field-input"
                    rows={2}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </div>
              </div>
              <div className="mt-4">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!proposalId.trim() || reviewMutation.isPending}
                  onClick={() => reviewMutation.mutate()}
                >
                  <ShieldCheck size={15} />
                  {reviewMutation.isPending ? '提交中…' : '提交审核决定'}
                </button>
              </div>
              {reviewMutation.isError && (
                <div className="mt-3 rounded-md border border-danger/30 bg-danger-wash p-3 text-xs">
                  <p className="font-semibold text-danger">审核提交未成功</p>
                  <p className="mt-1 text-ink-muted">
                    {reviewMutation.error instanceof Error ? reviewMutation.error.message : '请求失败。'}
                  </p>
                  <p className="mono mt-1 text-danger">
                    错误码：{reviewMutation.error instanceof ApiError ? reviewMutation.error.code : 'UNKNOWN_ERROR'}
                  </p>
                </div>
              )}
              {reviewMutation.isSuccess && (
                <div className="mt-3 rounded-md border border-success/30 bg-success-wash p-3 text-xs text-success">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 size={14} /> 审核已记录
                  </p>
                  <p className="mt-1 break-all text-ink-muted">
                    review_id: {reviewMutation.data.review_id} · status: {reviewMutation.data.status} ·
                    原始建议保留：{reviewMutation.data.original_preserved ? '是' : '否'}
                  </p>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
