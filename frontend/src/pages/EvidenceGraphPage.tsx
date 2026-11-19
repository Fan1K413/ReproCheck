import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Network } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import { api } from '../services/api'

const TYPE_LABEL: Record<string, string> = {
  fact: '科研事实',
  evidence: '证据引用',
  source_chunk: '原文片段',
  material: '来源材料',
}

const EDGE_LABEL: Record<string, string> = {
  supported_by: '有证据支持',
  quotes: '引用原文',
  located_in: '位于材料',
}

export default function EvidenceGraphPage() {
  const projectId = useParams().projectId ?? ''
  const graphQuery = useQuery({
    queryKey: ['evidence-graph', projectId],
    queryFn: () => api.getEvidenceGraph(projectId),
    enabled: !!projectId,
  })

  return (
    <div className="space-y-5">
      <div>
        <Link to={`/projects/${projectId}/facts`} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-accent-dark">
          <ArrowLeft size={13} /> 返回科研事实
        </Link>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-dark">Evidence Graph</p>
        <h2 className="mt-1 text-lg font-semibold">科研结论证据图谱</h2>
        <p className="mt-1 text-sm text-ink-muted">
            图谱仅展示当前项目数据库中可追溯的事实、证据引用、原文片段与来源材料关系；每条引用单独标示核验状态，不推断缺失边。
        </p>
      </div>

      {graphQuery.isPending ? (
        <LoadingState message="正在读取证据图谱…" />
      ) : graphQuery.isError ? (
        <ErrorState message={graphQuery.error.message || '证据图谱加载失败'} onRetry={() => void graphQuery.refetch()} />
      ) : !graphQuery.data || graphQuery.data.nodes.length === 0 ? (
        <EmptyState icon={Network} title="暂无可追溯证据" description="项目中尚无事实数据，或现存引用无法关联到同项目的原文与材料。" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Object.entries({
              科研事实: graphQuery.data.counts.facts,
              证据引用: graphQuery.data.counts.evidence,
              来源材料: graphQuery.data.counts.materials,
              原文片段: graphQuery.data.counts.source_chunks,
              可追溯关系: graphQuery.data.counts.edges,
            }).map(([label, value]) => (
              <div key={label} className="panel p-3">
                <p className="text-xs text-ink-muted">{label}</p>
                <p className="mono mt-1 text-xl font-semibold text-ink">{value}</p>
              </div>
            ))}
          </div>
          <section className="panel p-4 sm:p-5" aria-label="证据关系图谱">
            <h3 className="text-sm font-semibold text-ink">证据链节点</h3>
            <div className="mt-4 grid gap-3 lg:grid-cols-4">
              {(['fact', 'evidence', 'source_chunk', 'material'] as const).map((type) => {
                const nodes = graphQuery.data.nodes.filter((node) => node.type === type)
                return (
                  <div key={type} className="min-w-0">
                    <p className="mb-2 text-xs font-semibold text-ink-muted">{TYPE_LABEL[type]}（{nodes.length}）</p>
                    <ul className="space-y-2">
                      {nodes.map((node) => (
                        <li key={node.id} className="rounded-md border border-line-soft bg-canvas p-3">
                          <p className="break-words text-xs font-semibold text-ink">{node.label || '（无标签）'}</p>
                          <p className="mono mt-1 break-all text-[10px] text-ink-subtle">{node.id}</p>
                          {node.type === 'evidence' && (
                            <StatusBadge
                              tone={node.verification_status === 'verified' ? 'success' : 'warning'}
                              dot={false}
                            >
                              {node.verification_status === 'verified' ? '原文已核验' : '需复核'}
                            </StatusBadge>
                          )}
                          {node.type === 'material' && node.sha256 && (
                            <p className="mono mt-2 break-all text-[10px] text-ink-subtle">SHA-256: {node.sha256}</p>
                          )}
                          {node.source_locator && (
                            <pre className="mono mt-2 whitespace-pre-wrap break-words text-[10px] text-ink-subtle">{JSON.stringify(node.source_locator)}</pre>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </section>
          <section className="panel p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-ink">可追溯关系</h3>
            <ul className="mt-3 divide-y divide-line-soft">
              {graphQuery.data.edges.map((edge, index) => {
                const source = graphQuery.data.nodes.find((node) => node.id === edge.source)
                const target = graphQuery.data.nodes.find((node) => node.id === edge.target)
                return (
                  <li key={`${edge.source}-${edge.type}-${edge.target}-${index}`} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                    <span className="rounded bg-canvas px-2 py-1 text-ink">{source?.label ?? edge.source}</span>
                    <span className="text-accent-dark">{EDGE_LABEL[edge.type] ?? edge.type} →</span>
                    <span className="rounded bg-canvas px-2 py-1 text-ink">{target?.label ?? edge.target}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
