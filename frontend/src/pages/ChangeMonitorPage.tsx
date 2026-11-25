/**
 * 项目变化监控与影响分析（图4 精密 + 变化列表）
 *
 * 业务未变：GET /change-monitor/analyze 分析、POST /change-monitor/create-review-plan 需用户确认后创建。
 * 特色交互：**变化清单影响链聚焦** —— 点击任一变更文件，右侧按真实 `affected_facts[].matched_file`
 * 过滤出直接命中的科研事实，并把相关运行与审计结论一并标出；无命中时如实说明「无直接证据」。
 *
 * 真实数据绑定：ChangeAnalysis{ status, reason, old_commit, new_commit, new_snapshot_id,
 *   changed_files[], categories[], affected_facts[], affected_runs[], affected_conclusions[],
 *   suggestions[], notice }
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { ApiError } from '../services/api'
import { researchApi } from '../services/researchApi'
import { toast } from '../stores/toastStore'
import type { ChangeAnalysis } from '../types/research'
import '../styles/wave-c-verify.css'

const CATEGORY_LABEL: Record<string, string> = {
  code: '代码',
  config: '配置',
  data: '数据',
  docs: '文档',
  other: '其它',
}

const IMPACT_CATEGORY = ['code', 'config', 'data']

/** 后端在分析响应里附带真实仓库快照列表；类型定义未收录，这里局部补齐。 */
type ChangeAnalysisWithSnapshots = ChangeAnalysis & {
  snapshots?: Array<{ id?: string; commit_sha?: string; fetched_at?: string }>
}

export default function ChangeMonitorPage() {
  const { projectId = '' } = useParams()
  const qc = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [focusFile, setFocusFile] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)

  const analysisQ = useQuery({
    queryKey: ['change-monitor', projectId],
    queryFn: () => researchApi.changeMonitor(projectId),
    enabled: !!projectId,
  })
  const create = useMutation({
    mutationFn: () => researchApi.createReviewPlan(projectId, analysisQ.data?.new_snapshot_id ?? ''),
    onSuccess: () => {
      setConfirmOpen(false)
      setConfirmed(false)
      toast.success('已创建重审草稿，请到复现规划页人工确认')
      void qc.invalidateQueries()
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '创建失败'),
  })
  const data = analysisQ.data

  const categories = useMemo(() => data?.categories ?? [], [data])
  const snapshots = useMemo(
    () => (data as ChangeAnalysisWithSnapshots | undefined)?.snapshots ?? [],
    [data],
  )

  const visibleFiles = useMemo(() => {
    const files = data?.changed_files ?? []
    return category ? files.filter((file) => file.category === category) : files
  }, [data, category])

  /** 聚焦文件 → 真实命中该路径的科研事实；无命中即为「无直接证据」。 */
  const focusedFacts = useMemo(() => {
    const facts = data?.affected_facts ?? []
    if (!focusFile) return facts
    return facts.filter((fact) => fact.matched_file === focusFile)
  }, [data, focusFile])

  return (
    <div className="rc4-page">
      <PageHeader
        title="项目变化监控与影响分析"
        description="仓库变更与影响链分析"
        actions={
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void analysisQ.refetch()}
            disabled={analysisQ.isFetching}
          >
            <Icon name="rotate" size="sm" className={analysisQ.isFetching ? 'animate-spin' : ''} />
            重新分析
          </button>
        }
      />

      {analysisQ.isPending ? (
        <div className="rc4-panel">
          <LoadingState message="分析仓库变化…" />
        </div>
      ) : analysisQ.isError || !data ? (
        <div className="rc4-panel">
          <ErrorState message="无法获取变化分析" onRetry={() => void analysisQ.refetch()} />
        </div>
      ) : (
        <>
          <section className="rc4-panel">
            <div className="rc4-panel__head">
              <h3 className="rc4-panel__title">
                <Icon name="network" size="sm" tone="accent" />
                快照对比
              </h3>
              <StatusBadge tone={data.status === 'analyzed' ? 'success' : 'neutral'}>
                {data.status}
              </StatusBadge>
            </div>
            <div className="rc4-panel__body">
              {data.status !== 'analyzed' ? (
                <p className="rc4-list__meta">{data.reason ?? '暂无足够数据。'}</p>
              ) : (
                <div className="rc4-kpis">
                  <div className="rc4-kpi">
                    <p className="rc4-kpi__label">旧 commit</p>
                    <p className="rc4-kpi__value text-base break-all">
                      {data.old_commit || '—'}
                    </p>
                  </div>
                  <div className="rc4-kpi">
                    <p className="rc4-kpi__label">新 commit</p>
                    <p className="rc4-kpi__value text-base break-all">
                      {data.new_commit || '—'}
                    </p>
                  </div>
                  <div className="rc4-kpi">
                    <p className="rc4-kpi__label">变更文件</p>
                    <p className="rc4-kpi__value">{data.changed_files.length}</p>
                  </div>
                  <div className="rc4-kpi">
                    <p className="rc4-kpi__label">影响结论</p>
                    <p className="rc4-kpi__value">{data.affected_conclusions.length}</p>
                  </div>
                </div>
              )}
              {data.commit_message && (
                <p className="rc4-list__meta mt-3">提交信息：{data.commit_message}</p>
              )}
              {data.status !== 'analyzed' && (
                <div className="mt-4">
                  <p className="rcw-overline mb-2">仓库快照</p>
                  {snapshots.length === 0 ? (
                    <p className="rc4-list__meta">暂无仓库快照。</p>
                  ) : (
                    <div className="rc4-list">
                      {snapshots.map((snapshot) => (
                        <div key={snapshot.id ?? snapshot.commit_sha} className="rc4-list__row">
                          <div className="rc4-list__main">
                            <p className="rc4-list__title mono break-all">
                              {snapshot.commit_sha ?? snapshot.id ?? '—'}
                            </p>
                            <p className="rc4-list__meta">
                              {snapshot.id ?? '—'} · {snapshot.fetched_at ?? '—'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="rc4-list__meta mt-3">
                    至少需要两次 commit 不同的成功同步才能比对；当前快照数 {snapshots.length}。
                  </p>
                </div>
              )}
            </div>
          </section>

          {data.status === 'analyzed' && (
            <>
              <section className="rc4-panel">
                <div className="rc4-panel__head">
                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <h3 className="rc4-panel__title">变更文件</h3>
                    <span className="rc4-panel__hint">
                      {visibleFiles.length} / {data.changed_files.length}
                    </span>
                  </div>
                  {categories.length > 0 && (
                    <div className="rc4-rail" role="group" aria-label="按变更类别筛选">
                      <button
                        type="button"
                        className="rc4-rail__item"
                        aria-pressed={category === null}
                        onClick={() => setCategory(null)}
                      >
                        全部
                        <span className="rc4-rail__count">{data.changed_files.length}</span>
                      </button>
                      {categories.map((item) => {
                        const count = data.changed_files.filter((f) => f.category === item).length
                        return (
                          <button
                            key={item}
                            type="button"
                            className="rc4-rail__item"
                            aria-pressed={category === item}
                            onClick={() => setCategory(category === item ? null : item)}
                          >
                            {CATEGORY_LABEL[item] ?? item}
                            <span className="rc4-rail__count">{count}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="rc4-panel__body">
                  {data.changed_files.length === 0 ? (
                    <p className="rc4-list__meta">
                      快照未包含文件清单。
                    </p>
                  ) : visibleFiles.length === 0 ? (
                    <EmptyState compact title="该类别下没有变更文件" />
                  ) : (
                    <div className="rc4-list">
                      {visibleFiles.map((file) => (
                        <button
                          key={file.path}
                          type="button"
                          className="rc4-list__row w-full text-left"
                          data-focus={focusFile === file.path}
                          aria-pressed={focusFile === file.path}
                          onClick={() => setFocusFile(focusFile === file.path ? null : file.path)}
                        >
                          <span className="rc4-list__main">
                            <span className="rc4-list__title mono break-all">{file.path}</span>
                            <span className="rc4-list__meta block">状态：{file.status || '—'}</span>
                          </span>
                          <StatusBadge
                            tone={IMPACT_CATEGORY.includes(file.category) ? 'warning' : 'neutral'}
                          >
                            {CATEGORY_LABEL[file.category] ?? file.category}
                          </StatusBadge>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* 影响链聚焦：真实 matched_file 关联 */}
              <section className="rc4-panel">
                <div className="rc4-panel__head">
                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <h3 className="rc4-panel__title">影响链</h3>
                    <span className="rc4-panel__hint">
                      {focusFile ? `聚焦：${focusFile}` : '点击上方变更文件聚焦其影响'}
                    </span>
                  </div>
                  {focusFile && (
                    <button type="button" className="btn-ghost" onClick={() => setFocusFile(null)}>
                      取消聚焦
                    </button>
                  )}
                </div>
                <div className="rc4-panel__body">
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div>
                      <p className="rcw-overline mb-2">相关科研事实（{focusedFacts.length}）</p>
                      {focusedFacts.length === 0 ? (
                        <p className="rc4-list__meta">无直接证据。</p>
                      ) : (
                        <div className="rc4-list">
                          {focusedFacts.map((fact) => (
                            <div key={fact.id} className="rc4-list__row">
                              <div className="rc4-list__main">
                                <p className="rc4-list__title">{fact.field}</p>
                                <p className="rc4-list__meta break-all">{fact.matched_file}</p>
                              </div>
                              <StatusBadge tone="warning">{fact.impact}</StatusBadge>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="rcw-overline mb-2">
                        可能受影响的运行（{data.affected_runs.length}）
                      </p>
                      {data.affected_runs.length === 0 ? (
                        <p className="rc4-list__meta">无直接证据。</p>
                      ) : (
                        <div className="rc4-list">
                          {data.affected_runs.map((run) => (
                            <div key={run.id} className="rc4-list__row">
                              <div className="rc4-list__main">
                                <p className="rc4-list__title mono break-all">{run.id}</p>
                                <p className="rc4-list__meta">{run.status}</p>
                              </div>
                              <StatusBadge tone="warning">{run.impact}</StatusBadge>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="rcw-overline mb-2">
                        审计结论（{data.affected_conclusions.length}）
                      </p>
                      {data.affected_conclusions.length === 0 ? (
                        <p className="rc4-list__meta">无直接证据。</p>
                      ) : (
                        <div className="rc4-list">
                          {data.affected_conclusions.map((conclusion) => (
                            <div key={conclusion.id} className="rc4-list__row">
                              <div className="rc4-list__main">
                                <p className="rc4-list__title">{conclusion.metric}</p>
                                <p className="rc4-list__meta">
                                  {conclusion.verdict} · {conclusion.impact}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {focusFile && focusedFacts.length === 0 && (
                    <p className="rc4-list__meta mt-3">
                      该文件未匹配到任何科研事实；其余影响为仓库级推断，不归属到具体文件。
                    </p>
                  )}
                </div>
              </section>

              <section className="rc4-panel">
                <div className="rc4-panel__head">
                  <h3 className="rc4-panel__title">建议</h3>
                  <span className="rc4-panel__hint">{data.suggestions.length} 条</span>
                </div>
                <div className="rc4-panel__body">
                  {data.suggestions.length === 0 ? (
                    <p className="rc4-list__meta">暂无建议。</p>
                  ) : (
                    <div className="rc4-list">
                      {data.suggestions.map((suggestion, index) => (
                        <div key={index} className="rc4-list__row">
                          <div className="rc4-list__main">
                            <p className="rc4-list__title">{suggestion.title}</p>
                            <p className="rc4-list__meta">{suggestion.reason}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge tone={suggestion.severity === 'high' ? 'danger' : 'neutral'}>
                              {suggestion.severity}
                            </StatusBadge>
                            {suggestion.requires_confirmation && data.new_snapshot_id && (
                              <button
                                type="button"
                                className="btn-ghost"
                                onClick={() => setConfirmOpen(true)}
                              >
                                创建重审草稿
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <div className="rcw-note">
                <Icon name="shield" size="sm" tone="accent" />
                {data.notice ?? '影响分析基于确定性规则，相关不等于因果。'}
              </div>
            </>
          )}
        </>
      )}

      <Modal
        open={confirmOpen}
        title="确认创建重审任务"
        description="创建后仅生成复现规划草稿，不执行实验、不覆盖任何审计结论。"
        onClose={() => {
          setConfirmOpen(false)
          setConfirmed(false)
        }}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setConfirmOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!confirmed || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? <Icon name="loader" size="sm" className="animate-spin" /> : null}
              确认创建
            </button>
          </>
        }
      >
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>我已确认需要根据本次仓库变更创建重审草稿，并理解该操作不会自动执行实验。</span>
        </label>
      </Modal>
    </div>
  )
}
