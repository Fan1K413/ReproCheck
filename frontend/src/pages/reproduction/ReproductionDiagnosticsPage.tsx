import { useMutation, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Lightbulb,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DeterministicDiagnosisPanel } from '../../components/DeterministicDiagnosisPanel'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
import { LoadingState } from '../../components/LoadingState'
import { StatusBadge } from '../../components/StatusBadge'
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
import '../../styles/wave-a-repro.css'

const DECISION_HINT: Record<RemediationDecision, string> = {
  approve: '按后端建议值执行',
  reject: '保留原值，不做修改',
  modify: '以人工填写的值替代',
}

function MutationError({ error }: { error: unknown }) {
  if (!error) return null
  const code = error instanceof ApiError ? error.code : 'UNKNOWN_ERROR'
  const message = error instanceof Error ? error.message : '操作失败，请稍后重试。'
  if (code === 'LLM_KEY_NOT_CONFIGURED') {
    return (
      <div
        style={{
          display: 'flex',
          gap: 'var(--rc-space-3)',
          padding: 'var(--rc-space-4)',
          borderRadius: 'var(--rc-radius-sm)',
          backgroundColor: 'var(--rc-warning-wash)',
        }}
      >
        <Icon as={AlertTriangle} size="sm" tone="warning" />
        <div style={{ minWidth: 0 }}>
          <p className="rc-wa-sub" style={{ color: 'var(--rc-warning)' }}>
            AI 诊断不可用
          </p>
          <p style={{ marginTop: 4, fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
            后端未配置可用的模型密钥，未生成任何诊断结论。页面不会展示预设或伪造的诊断内容。
          </p>
          <p className="rc-wa-pick__id" style={{ marginTop: 4, color: 'var(--rc-warning)' }}>
            错误码：{code}
          </p>
          <p style={{ marginTop: 4, fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
            后端消息：{message}
          </p>
        </div>
      </div>
    )
  }
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--rc-space-3)',
        padding: 'var(--rc-space-4)',
        borderRadius: 'var(--rc-radius-sm)',
        backgroundColor: 'var(--rc-danger-wash)',
      }}
    >
      <Icon as={AlertTriangle} size="sm" tone="danger" />
      <div style={{ minWidth: 0 }}>
        <p className="rc-wa-sub" style={{ color: 'var(--rc-danger)' }}>
          请求未成功
        </p>
        <p style={{ marginTop: 4, fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)', overflowWrap: 'anywhere' }}>
          {message}
        </p>
        <p className="rc-wa-pick__id" style={{ marginTop: 4, color: 'var(--rc-danger)' }}>
          错误码：{code}
        </p>
      </div>
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
    <div className="rc-wa-panel" style={{ backgroundColor: 'var(--rc-surface-3)' }}>
      <div className="rc-wa-panel__body rc-wa-panel__body--tight">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--rc-space-2)' }}>
          <p style={{ fontSize: 'var(--rc-fs-body)', fontWeight: 'var(--rc-fw-sb)' }}>
            <span className="mono rc-wa-pick__id" style={{ marginRight: 6 }}>
              #{index + 1}
            </span>
            {cause.cause}
          </p>
          <StatusBadge tone="accent" dot={false}>
            {formatConfidence(cause.confidence)}
          </StatusBadge>
        </div>
        <p className="rc-wa-kpi__hint" style={{ marginTop: 'var(--rc-space-2)' }}>
          依据：{cause.basis || '后端未提供依据。'}
        </p>
      </div>
    </div>
  )
}

export default function ReproductionDiagnosticsPage() {
  const pid = useParams().pid ?? ''
  return <Diagnostics key={pid} pid={pid} />
}

function Diagnostics({ pid }: { pid: string }) {
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
        note: note.trim() || undefined,
        modified_value: decision === 'modify' ? modifiedValue : undefined,
      }),
  })

  const diagnostic = diagnosticMutation.data
  const selectedRun: ReproRunView | undefined = (runsQuery.data?.items ?? []).find(
    (run) => run.run_id === selectedRunId,
  )

  /* 当前选中的提案（用于原值 / 建议值 双栏对比） */
  const proposals = diagnostic?.remediation_proposals ?? []
  const activeProposal = useMemo(
    () => proposals.find((item) => item.proposal_id === proposalId) ?? proposals[0] ?? null,
    [proposals, proposalId],
  )

  return (
    <div className="rc-wa-page">
      <header className="rc-wa-head">
        <div className="rc-wa-head__text">
          <p className="rc-wa-eyebrow">AI 诊断</p>
          <h1 className="rc-wa-title">AI 诊断与人工审核</h1>
          <p className="rc-wa-lede">
            诊断由后端实时生成；无模型密钥时仅显示后端返回的不可用错误，不展示任何预设诊断。
          </p>
        </div>
        <div className="rc-wa-head__actions">
          <Link to={`/projects/${pid}/reproduction`} className="btn-ghost">
            返回总览
          </Link>
          {selectedRunId && (
            <Link to={`/reproductions/runs/${selectedRunId}`} className="btn-ghost">
              查看控制台
            </Link>
          )}
        </div>
      </header>

      <DeterministicDiagnosisPanel />

      <section className="rc-wa-panel">
        <div className="rc-wa-panel__head">
          <div className="rc-wa-panel__title">
            <Icon as={Bot} size="sm" tone="accent" />
            选择要诊断的运行
          </div>
          <span className="rc-wa-source">来源：后端运行记录</span>
        </div>
        <div className="rc-wa-panel__body">
          {runsQuery.isPending ? (
            <LoadingState compact message="正在读取运行列表…" />
          ) : runsQuery.isError ? (
            <ErrorState
              compact
              message={runsQuery.error instanceof Error ? runsQuery.error.message : '无法获取运行列表。'}
              code={runsQuery.error instanceof ApiError ? runsQuery.error.code : undefined}
              onRetry={() => void runsQuery.refetch()}
            />
          ) : (runsQuery.data?.items ?? []).length === 0 ? (
            <EmptyState
              compact
              icon={Bot}
              title="暂无可诊断的运行"
              description="请先创建复现运行，再对该运行发起 AI 诊断。"
            />
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 'var(--rc-space-3)' }}>
              <div style={{ minWidth: 260, flex: 1 }}>
                <label className="field-label" htmlFor="diagnostic-run">
                  运行
                </label>
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
                <Icon as={Bot} size="sm" />
                {diagnosticMutation.isPending ? '诊断中…' : '发起 AI 诊断'}
              </button>
            </div>
          )}
          {selectedRun && (
            <div style={{ marginTop: 'var(--rc-space-3)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--rc-space-2)' }}>
              <StatusBadge tone={runStatusTone(selectedRun.status)}>{runStatusLabel(selectedRun.status)}</StatusBadge>
              <span className="rc-wa-pick__id">
                plan_id: <span className="mono">{selectedRun.plan_id}</span>
              </span>
            </div>
          )}
          <div style={{ marginTop: 'var(--rc-space-4)' }}>
            <MutationError error={diagnosticMutation.error} />
          </div>
        </div>
      </section>

      {diagnostic && (
        <>
          <section className="rc-wa-panel">
            <div className="rc-wa-panel__head">
              <div className="rc-wa-panel__title">
                <Icon as={Bot} size="sm" tone="accent" />
                诊断结果
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--rc-space-2)' }}>
                <StatusBadge tone={diagnostic.ai_available ? 'success' : 'warning'}>
                  AI {diagnostic.ai_available ? '可用' : '不可用'}
                </StatusBadge>
                {diagnostic.needs_human_confirm && <StatusBadge tone="warning">需人工确认</StatusBadge>}
                <span style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-subtle)' }}>
                  {formatDateTime(diagnostic.created_at)}
                </span>
              </div>
            </div>
            <div className="rc-wa-panel__body" style={{ display: 'grid', gap: 'var(--rc-space-5)' }}>
              <div>
                <p className="rc-wa-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--rc-danger)' }}>
                  <Icon as={AlertTriangle} size="xs" tone="danger" />
                  问题
                </p>
                <p
                  style={{
                    marginTop: 'var(--rc-space-2)',
                    fontSize: 'var(--rc-fs-body)',
                    color: 'var(--rc-text)',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {diagnostic.problem}
                </p>
              </div>

              <div>
                <p className="rc-wa-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Icon as={ClipboardCheck} size="xs" tone="accent" />
                  错误证据
                </p>
                <pre
                  className="mono rc-wa-code"
                  style={{ marginTop: 'var(--rc-space-2)', padding: 'var(--rc-space-3)', whiteSpace: 'pre-wrap' }}
                >
                  {diagnostic.error_evidence || '后端未提供错误证据。'}
                </pre>
              </div>

              <div>
                <p className="rc-wa-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--rc-warning)' }}>
                  <Icon as={Lightbulb} size="xs" tone="warning" />
                  可能原因
                </p>
                <div
                  style={{
                    marginTop: 'var(--rc-space-2)',
                    display: 'grid',
                    gap: 'var(--rc-space-3)',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  }}
                >
                  {(diagnostic.possible_causes ?? []).length === 0 ? (
                    <p style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-subtle)' }}>
                      后端未提供可能原因。
                    </p>
                  ) : (
                    diagnostic.possible_causes.map((cause, index) => (
                      <PossibleCauseCard key={`${cause.cause}-${index}`} cause={cause} index={index} />
                    ))
                  )}
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gap: 'var(--rc-space-3)',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                }}
              >
                <div className="rc-wa-panel" style={{ backgroundColor: 'var(--rc-surface-3)' }}>
                  <div className="rc-wa-panel__body rc-wa-panel__body--tight">
                    <p className="rc-wa-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--rc-success)' }}>
                      <Icon as={ShieldCheck} size="xs" tone="success" />
                      修复建议
                    </p>
                    <p
                      style={{
                        marginTop: 'var(--rc-space-2)',
                        fontSize: 'var(--rc-fs-body)',
                        color: 'var(--rc-text)',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {diagnostic.suggested_fix || '后端未提供修复建议。'}
                    </p>
                  </div>
                </div>
                <div className="rc-wa-panel" style={{ backgroundColor: 'var(--rc-surface-3)' }}>
                  <div className="rc-wa-panel__body rc-wa-panel__body--tight">
                    <p className="rc-wa-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icon as={CheckCircle2} size="xs" tone="accent" />
                      验证方式
                    </p>
                    <p
                      style={{
                        marginTop: 'var(--rc-space-2)',
                        fontSize: 'var(--rc-fs-body)',
                        color: 'var(--rc-text)',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {diagnostic.verification_method || '后端未提供验证方式。'}
                    </p>
                  </div>
                </div>
              </div>

              <p className="rc-wa-pick__id">
                diagnostic_id: {diagnostic.diagnostic_id} · prompt_version: {diagnostic.prompt_version ?? '—'}
              </p>
            </div>
          </section>

          {/* ========== 特色交互：修复提案原值/建议值 双栏对比 + 审核决策 ========== */}
          <section className="rc-wa-panel">
            <div className="rc-wa-panel__head">
              <div className="rc-wa-panel__title">
                <Icon as={ShieldCheck} size="sm" tone="accent" />
                修复建议人工审核
              </div>
              <span className="rc-wa-source">来源：后端复核接口</span>
            </div>
            <div className="rc-wa-panel__body" style={{ display: 'grid', gap: 'var(--rc-space-4)' }}>
              {proposals.length > 0 && (
                <div style={{ display: 'grid', gap: 'var(--rc-space-2)' }}>
                  <p className="rc-wa-sub">修复提案</p>
                  {proposals.map((proposal, index) => (
                    <button
                      key={`${proposal.proposal_id}-${index}`}
                      type="button"
                      className="rc-wa-proposal"
                      aria-pressed={proposal.proposal_id === activeProposal?.proposal_id}
                      onClick={() => setProposalId(proposal.proposal_id ?? '')}
                    >
                      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--rc-space-2)' }}>
                        <span style={{ fontSize: 'var(--rc-fs-caption)', fontWeight: 'var(--rc-fw-sb)' }}>
                          {proposal.change_type || `提案 ${index + 1}`}
                        </span>
                        {proposal.target_file && (
                          <span className="mono rc-wa-pick__id">{proposal.target_file}</span>
                        )}
                        {proposal.changes_research_conditions && (
                          <StatusBadge tone="warning">
                            <Icon as={TriangleAlert} size="xs" tone="warning" />
                            影响研究条件
                          </StatusBadge>
                        )}
                      </span>
                      <span style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)', overflowWrap: 'anywhere' }}>
                        原值：{proposal.original_value || '—'} → 建议：{proposal.proposed_value || '—'}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {activeProposal && (
                <div className="rc-wa-diff">
                  <div className="rc-wa-diff__side" data-kind="before">
                    <span className="rc-wa-dual__label">原始值 original_value</span>
                    <span className="rc-wa-diff__value">{activeProposal.original_value || '—'}</span>
                  </div>
                  <div className="rc-wa-diff__side" data-kind="after">
                    <span className="rc-wa-dual__label">建议值 proposed_value</span>
                    <span className="rc-wa-diff__value">{activeProposal.proposed_value || '—'}</span>
                  </div>
                </div>
              )}

              <div>
                <p className="rc-wa-sub" style={{ marginBottom: 'var(--rc-space-2)' }}>
                  审核决定
                </p>
                <div className="rc-wa-decision" role="group" aria-label="审核决定">
                  {(['approve', 'reject', 'modify'] as RemediationDecision[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="rc-wa-decision__btn"
                      aria-pressed={decision === value}
                      onClick={() => setDecision(value)}
                    >
                      <span className="rc-wa-decision__name">{DECISION_LABEL[value]}</span>
                      <span className="rc-wa-decision__hint">{DECISION_HINT[value]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rc-wa-persp__meta">
                <div>
                  <label className="field-label" htmlFor="proposal-id">
                    修复提案 ID
                  </label>
                  <input
                    id="proposal-id"
                    className="field-input mono"
                    value={proposalId}
                    onChange={(event) => setProposalId(event.target.value)}
                    placeholder="后端返回的 proposal_id"
                  />
                  <p className="rc-wa-kpi__hint" style={{ marginTop: 4 }}>
                    诊断结果若附带提案会自动填入；否则请填写后端记录中的 proposal_id。
                  </p>
                </div>
                {decision === 'modify' && (
                  <div>
                    <label className="field-label" htmlFor="modified-value">
                      修改后的值
                    </label>
                    <input
                      id="modified-value"
                      className="field-input"
                      value={modifiedValue}
                      onChange={(event) => setModifiedValue(event.target.value)}
                    />
                  </div>
                )}
                <div>
                  <label className="field-label" htmlFor="review-note">
                    备注
                  </label>
                  <textarea
                    id="review-note"
                    className="field-input"
                    rows={2}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </div>
              </div>

              <div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!proposalId.trim() || reviewMutation.isPending}
                  onClick={() => reviewMutation.mutate()}
                >
                  <Icon as={ShieldCheck} size="sm" />
                  {reviewMutation.isPending ? '提交中…' : '提交审核决定'}
                </button>
              </div>

              {reviewMutation.isError && (
                <div
                  style={{
                    padding: 'var(--rc-space-3)',
                    borderRadius: 'var(--rc-radius-sm)',
                    backgroundColor: 'var(--rc-danger-wash)',
                  }}
                >
                  <p className="rc-wa-sub" style={{ color: 'var(--rc-danger)' }}>
                    审核提交未成功
                  </p>
                  <p style={{ marginTop: 4, fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
                    {reviewMutation.error instanceof Error ? reviewMutation.error.message : '请求失败。'}
                  </p>
                  <p className="mono rc-wa-pick__id" style={{ color: 'var(--rc-danger)' }}>
                    错误码：{reviewMutation.error instanceof ApiError ? reviewMutation.error.code : 'UNKNOWN_ERROR'}
                  </p>
                </div>
              )}

              {reviewMutation.isSuccess && (
                <div
                  style={{
                    padding: 'var(--rc-space-3)',
                    borderRadius: 'var(--rc-radius-sm)',
                    backgroundColor: 'var(--rc-success-wash)',
                  }}
                >
                  <p
                    className="rc-wa-sub"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--rc-success)' }}
                  >
                    <Icon as={CheckCircle2} size="xs" tone="success" />
                    审核已记录
                  </p>
                  <p className="rc-wa-pick__id" style={{ marginTop: 4, color: 'var(--rc-text-muted)', overflowWrap: 'anywhere' }}>
                    审核决定：{DECISION_LABEL[reviewMutation.data.decision]} · 审核人：{reviewMutation.data.reviewer} ·
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
