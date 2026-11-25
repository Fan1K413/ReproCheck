import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Network } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { LoadingState } from '../components/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import { api } from '../services/api'
import type { EvidenceGraphEdge, EvidenceGraphNode } from '../types/api'
import '../styles/wave-b-material.css'

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

const TYPE_ICON: Record<string, 'file' | 'scroll' | 'book' | 'database'> = {
  fact: 'file',
  evidence: 'scroll',
  source_chunk: 'book',
  material: 'database',
}

/** 放射半径（占正方形舞台边长的百分比）：事实 → 证据 → 片段 → 材料 */
const RING_FACT = 26
const RING_EVIDENCE = 35
const RING_CHUNK = 42
const RING_MATERIAL = 47

type ChainNode = {
  node: EvidenceGraphNode
  ring: number
  /** 该节点是否被多条证据链共享（由真实边数据推导） */
  shared: boolean
}

function polar(angleDeg: number, radiusPct: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: 50 + Math.cos(rad) * radiusPct,
    y: 50 + Math.sin(rad) * radiusPct,
  }
}

export default function EvidenceGraphPage() {
  const projectId = useParams().projectId ?? ''
  const [expanded, setExpanded] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showRelations, setShowRelations] = useState(false)

  const graphQuery = useQuery({
    queryKey: ['evidence-graph', projectId],
    queryFn: () => api.getEvidenceGraph(projectId),
    enabled: !!projectId,
  })

  const graph = graphQuery.data

  /** 由真实 edges 推导 fact → evidence → chunk → material 的证据链 */
  const model = useMemo(() => {
    if (!graph) return null
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
    const outgoing = new Map<string, EvidenceGraphEdge[]>()
    for (const edge of graph.edges) {
      const list = outgoing.get(edge.source)
      if (list) list.push(edge)
      else outgoing.set(edge.source, [edge])
    }

    const facts = graph.nodes.filter((node) => node.type === 'fact')
    const factChains = facts.map((fact, index) => {
      const angle = (360 / Math.max(facts.length, 1)) * index - 90
      const evidenceNodes: ChainNode[] = []
      const chunkNodes: ChainNode[] = []
      const materialNodes: ChainNode[] = []
      // 后端可能返回重复边（同一 chunk→material 的 located_in 会重复出现），
      // 这里按节点 id 去重，保证一条证据链上每个节点只出现一次。
      const seenEvidence = new Set<string>()
      const seenChunk = new Set<string>()
      const seenMaterial = new Set<string>()

      for (const edge of outgoing.get(fact.id) ?? []) {
        if (edge.type !== 'supported_by') continue
        const evidence = nodeById.get(edge.target)
        if (!evidence || seenEvidence.has(evidence.id)) continue
        seenEvidence.add(evidence.id)
        evidenceNodes.push({ node: evidence, ring: RING_EVIDENCE, shared: false })
        for (const edge2 of outgoing.get(evidence.id) ?? []) {
          if (edge2.type !== 'quotes') continue
          const chunk = nodeById.get(edge2.target)
          if (!chunk || seenChunk.has(chunk.id)) continue
          seenChunk.add(chunk.id)
          chunkNodes.push({ node: chunk, ring: RING_CHUNK, shared: false })
          for (const edge3 of outgoing.get(chunk.id) ?? []) {
            if (edge3.type !== 'located_in') continue
            const material = nodeById.get(edge3.target)
            if (!material || seenMaterial.has(material.id)) continue
            seenMaterial.add(material.id)
            materialNodes.push({ node: material, ring: RING_MATERIAL, shared: false })
          }
        }
      }
      return { fact, angle, evidenceNodes, chunkNodes, materialNodes }
    })

    // 统计各片段 / 材料被多少条链引用（真实边数据）
    const chunkUsage = new Map<string, number>()
    const materialUsage = new Map<string, number>()
    for (const chain of factChains) {
      for (const item of chain.chunkNodes) {
        chunkUsage.set(item.node.id, (chunkUsage.get(item.node.id) ?? 0) + 1)
      }
      for (const item of chain.materialNodes) {
        materialUsage.set(item.node.id, (materialUsage.get(item.node.id) ?? 0) + 1)
      }
    }
    for (const chain of factChains) {
      for (const item of chain.chunkNodes) {
        item.shared = (chunkUsage.get(item.node.id) ?? 0) > 1
      }
      for (const item of chain.materialNodes) {
        item.shared = (materialUsage.get(item.node.id) ?? 0) > 1
      }
    }

    // 关系清单去重：后端会返回重复的三元组（source,target,type）
    const seenEdge = new Set<string>()
    const uniqueEdges = graph.edges.filter((edge) => {
      const key = `${edge.source}|${edge.target}|${edge.type}`
      if (seenEdge.has(key)) return false
      seenEdge.add(key)
      return true
    })

    return { factChains, nodeById, uniqueEdges }
  }, [graph])

  const selectedNode = selectedId && model ? (model.nodeById.get(selectedId) ?? null) : null

  function toggleFact(factId: string) {
    setExpanded((prev) =>
      prev.includes(factId) ? prev.filter((id) => id !== factId) : [...prev, factId],
    )
    setSelectedId(factId)
  }

  const countTiles = graph
    ? [
        { label: '科研事实', value: graph.counts.facts },
        { label: '证据引用', value: graph.counts.evidence },
        { label: '来源材料', value: graph.counts.materials },
        { label: '原文片段', value: graph.counts.source_chunks },
        { label: '可追溯关系', value: graph.counts.edges },
      ]
    : []

  return (
    <div className="mb-page">
      <header className="mb-head">
        <div className="min-w-0">
          <Link to={`/projects/${projectId}/facts`} className="mb-back">
            <Icon name="arrowLeft" size="xs" />
            返回科研事实
          </Link>
          <p className="mb-head__eyebrow mt-3">Evidence Graph · 扇形放射</p>
          <h1 className="mb-head__title">科研结论证据图谱</h1>
          <p className="mb-head__desc">
            图谱仅展示当前项目数据库中可追溯的事实、证据引用、原文片段与来源材料关系；
            点击任一事实节点，沿该轴放射展开其证据链（180ms 收拢 / 展开），每条引用单独标示核验状态，不推断缺失边。
          </p>
        </div>
        <nav className="mb-head__actions">
          <Link to={`/projects/${projectId}/facts`} className="btn-ghost">
            <Icon name="clipboardCheck" size="sm" />
            科研事实
          </Link>
          <Link to={`/projects/${projectId}/overview`} className="btn-ghost">
            <Icon name="grid" size="sm" />
            解析概览
          </Link>
        </nav>
      </header>

      {graphQuery.isPending ? (
        <LoadingState message="正在读取证据图谱…" hint="GET /projects/{id}/evidence-graph" />
      ) : graphQuery.isError ? (
        <ErrorState
          message={graphQuery.error.message || '证据图谱加载失败'}
          onRetry={() => void graphQuery.refetch()}
        />
      ) : !graph || graph.nodes.length === 0 ? (
        <EmptyState
          icon={Network}
          title="暂无可追溯证据"
          description="项目中尚无事实数据，或现存引用无法关联到同项目的原文与材料。"
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {countTiles.map((tile) => (
              <div key={tile.label} className="mb-stat">
                <p className="mb-stat__label">{tile.label}</p>
                <p className="mb-stat__value">{tile.value}</p>
              </div>
            ))}
          </div>

          <div className="mb-split">
            {/* 左 8 列：扇形放射画布 */}
            <section className="mb-panel mb-panel--grid" aria-label="证据关系扇形图">
              <div className="mb-panel__head">
                <h3 className="mb-panel__title">
                  <Icon name="network" size="sm" tone="accent" />
                  证据轴放射
                </h3>
                <span className="mb-panel__hint">
                  已展开 {expanded.length} / {model?.factChains.length ?? 0} 条证据链
                </span>
              </div>
              <div className="mb-panel__body mb-panel__body--tight">
                <div className="mb-fan" role="group" aria-label="项目证据放射图">
                  <div className="mb-fan__stage">
                    <svg
                      className="mb-fan__lines"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      {model?.factChains.map((chain) => {
                        const isOpen = expanded.includes(chain.fact.id)
                        const hub = { x: 50, y: 50 }
                        const factPos = polar(chain.angle, RING_FACT)
                        const segments: {
                          from: { x: number; y: number }
                          to: { x: number; y: number }
                          type: string
                          hidden: boolean
                        }[] = [{ from: hub, to: factPos, type: 'hub', hidden: false }]

                        let prev = factPos
                        const pushChain = (items: ChainNode[], type: string) => {
                          for (const item of items) {
                            const pos = polar(chain.angle, item.ring)
                            segments.push({ from: prev, to: pos, type, hidden: !isOpen })
                            prev = pos
                          }
                        }
                        pushChain(chain.evidenceNodes, 'supported_by')
                        pushChain(chain.chunkNodes, 'quotes')
                        pushChain(chain.materialNodes, 'located_in')

                        return segments.map((segment, index) => (
                          <line
                            key={`${chain.fact.id}-${index}`}
                            className={`mb-fan__line mb-fan__line--${segment.type} ${
                              segment.hidden ? 'mb-fan__line--off' : ''
                            }`}
                            x1={segment.from.x}
                            y1={segment.from.y}
                            x2={segment.to.x}
                            y2={segment.to.y}
                          />
                        ))
                      })}
                    </svg>

                    <div
                      className="mb-fan__hub"
                      aria-label={`项目证据核心，共 ${graph.counts.facts} 条事实`}
                    >
                      <span className="mb-fan__hub__n">{graph.counts.facts}</span>
                      <span className="mb-fan__hub__t">EVIDENCE CORE</span>
                      <span className="mb-fan__hub__t">{graph.counts.edges} 条关系</span>
                    </div>

                    {model?.factChains.map((chain) => {
                      const isOpen = expanded.includes(chain.fact.id)
                      const factPos = polar(chain.angle, RING_FACT)
                      const labelAbove = Math.sin((chain.angle * Math.PI) / 180) > 0
                      return (
                        <div key={chain.fact.id}>
                          <button
                            type="button"
                            className={`mb-fan__node mb-fan__node--fact ${
                              isOpen ? 'mb-fan__node--on' : ''
                            }`}
                            style={
                              { '--x': `${factPos.x}%`, '--y': `${factPos.y}%` } as CSSProperties
                            }
                            aria-expanded={isOpen}
                            aria-label={`事实 ${chain.fact.label || chain.fact.id}，点击展开证据链`}
                            title={chain.fact.label || chain.fact.id}
                            onClick={() => toggleFact(chain.fact.id)}
                          >
                            <Icon name={TYPE_ICON.fact} size="xs" tone="accent" />
                          </button>
                          <span
                            className={`mb-fan__label ${labelAbove ? 'mb-fan__label--above' : ''}`}
                            style={
                              { '--x': `${factPos.x}%`, '--y': `${factPos.y}%` } as CSSProperties
                            }
                            aria-hidden="true"
                          >
                            {chain.fact.label || chain.fact.id}
                          </span>

                          {chain.evidenceNodes.map((item) => {
                            const pos = polar(chain.angle, item.ring)
                            return (
                              <button
                                key={`${chain.fact.id}-${item.node.id}`}
                                type="button"
                                className={`mb-fan__node mb-fan__node--evidence ${
                                  isOpen ? '' : 'mb-fan__node--hidden'
                                }`}
                                style={
                                  { '--x': `${pos.x}%`, '--y': `${pos.y}%` } as CSSProperties
                                }
                                aria-label={`证据引用 ${item.node.label || item.node.id}`}
                                title={item.node.label || item.node.id}
                                onClick={() => setSelectedId(item.node.id)}
                              >
                                <Icon name={TYPE_ICON.evidence} size="xs" tone="info" />
                              </button>
                            )
                          })}

                          {chain.chunkNodes.map((item) => {
                            const pos = polar(chain.angle, item.ring)
                            return (
                              <button
                                key={`${chain.fact.id}-${item.node.id}`}
                                type="button"
                                className={`mb-fan__node mb-fan__node--source_chunk ${
                                  isOpen ? '' : 'mb-fan__node--hidden'
                                }`}
                                style={
                                  { '--x': `${pos.x}%`, '--y': `${pos.y}%` } as CSSProperties
                                }
                                aria-label={`原文片段 ${item.node.label || item.node.id}${
                                  item.shared ? '，多链共享' : ''
                                }`}
                                title={item.node.label || item.node.id}
                                onClick={() => setSelectedId(item.node.id)}
                              >
                                <Icon name={TYPE_ICON.source_chunk} size="xs" tone="muted" />
                              </button>
                            )
                          })}

                          {chain.materialNodes.map((item) => {
                            const pos = polar(chain.angle, item.ring)
                            return (
                              <button
                                key={`${chain.fact.id}-${item.node.id}`}
                                type="button"
                                className={`mb-fan__node mb-fan__node--material ${
                                  isOpen ? '' : 'mb-fan__node--hidden'
                                }`}
                                style={
                                  { '--x': `${pos.x}%`, '--y': `${pos.y}%` } as CSSProperties
                                }
                                aria-label={`来源材料 ${item.node.label || item.node.id}${
                                  item.shared ? '，多链共享' : ''
                                }`}
                                title={item.node.label || item.node.id}
                                onClick={() => setSelectedId(item.node.id)}
                              >
                                <Icon name={TYPE_ICON.material} size="xs" tone="info" />
                              </button>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* 窄屏降级：纵向链条列表（真实边数据） */}
                <div className="mb-fanlist">
                  {model?.factChains.map((chain) => {
                    const isOpen = expanded.includes(chain.fact.id)
                    return (
                      <div key={chain.fact.id} className="mb-chain">
                        <button
                          type="button"
                          className="mb-chain__btn"
                          aria-expanded={isOpen}
                          onClick={() => toggleFact(chain.fact.id)}
                        >
                          <span className="min-w-0">
                            <span
                              className="mb-mono block text-xs"
                              style={{ color: 'var(--rc-text-subtle)' }}
                            >
                              {chain.fact.id.slice(0, 14)}
                            </span>
                            <span className="block truncate">{chain.fact.label || '（无标签）'}</span>
                          </span>
                          {isOpen ? (
                            <Icon name="chevronDown" size="sm" />
                          ) : (
                            <Icon as={ChevronRight} size="sm" />
                          )}
                        </button>
                        {isOpen && (
                          <div className="mb-chain__body">
                            {chain.evidenceNodes.map((item) => (
                              <button
                                key={`${chain.fact.id}-${item.node.id}`}
                                type="button"
                                className="mb-chip"
                                onClick={() => setSelectedId(item.node.id)}
                              >
                                证据 · {item.node.label || item.node.id}
                              </button>
                            ))}
                            {chain.chunkNodes.map((item) => (
                              <button
                                key={`${chain.fact.id}-${item.node.id}`}
                                type="button"
                                className="mb-chip"
                                onClick={() => setSelectedId(item.node.id)}
                              >
                                片段 · {item.node.label || item.node.id}
                                {item.shared ? '（共享）' : ''}
                              </button>
                            ))}
                            {chain.materialNodes.map((item) => (
                              <button
                                key={`${chain.fact.id}-${item.node.id}`}
                                type="button"
                                className="mb-chip"
                                onClick={() => setSelectedId(item.node.id)}
                              >
                                材料 · {item.node.label || item.node.id}
                                {item.shared ? '（共享）' : ''}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>

            {/* 右 4 列：节点检视 */}
            <div className="flex min-w-0 flex-col gap-6">
              <section className="mb-panel" aria-label="节点详情">
                <div className="mb-panel__head">
                  <h3 className="mb-panel__title">
                    <Icon name="search" size="sm" tone="accent" />
                    节点检视
                  </h3>
                  {selectedNode && (
                    <StatusBadge tone="neutral" dot={false}>
                      {TYPE_LABEL[selectedNode.type]}
                    </StatusBadge>
                  )}
                </div>
                <div className="mb-panel__body">
                  {!selectedNode ? (
                    <EmptyState
                      compact
                      icon={Network}
                      title="未选择节点"
                      description="点击扇形图上的任一节点，查看其真实字段与定位信息。"
                    />
                  ) : (
                    <div className="mb-inspect">
                      <p className="mb-inspect__title">
                        <Icon name={TYPE_ICON[selectedNode.type]} size="sm" tone="accent" />
                        {selectedNode.label || '（无标签）'}
                      </p>
                      <dl className="mb-dl mt-3">
                        <div className="mb-dl__row">
                          <dt className="mb-dl__key">节点 ID</dt>
                          <dd className="mb-dl__val">{selectedNode.id}</dd>
                        </div>
                        {selectedNode.field_key && (
                          <div className="mb-dl__row">
                            <dt className="mb-dl__key">字段键</dt>
                            <dd className="mb-dl__val">{selectedNode.field_key}</dd>
                          </div>
                        )}
                        {selectedNode.value != null && (
                          <div className="mb-dl__row">
                            <dt className="mb-dl__key">取值</dt>
                            <dd className="mb-dl__val">{String(selectedNode.value)}</dd>
                          </div>
                        )}
                        {selectedNode.extraction_status && (
                          <div className="mb-dl__row">
                            <dt className="mb-dl__key">抽取状态</dt>
                            <dd className="mb-dl__val">{selectedNode.extraction_status}</dd>
                          </div>
                        )}
                        {selectedNode.verification_status && (
                          <div className="mb-dl__row">
                            <dt className="mb-dl__key">核验状态</dt>
                            <dd className="mb-dl__val">{selectedNode.verification_status}</dd>
                          </div>
                        )}
                        {selectedNode.sha256 && (
                          <div className="mb-dl__row">
                            <dt className="mb-dl__key">SHA-256</dt>
                            <dd className="mb-dl__val">{selectedNode.sha256}</dd>
                          </div>
                        )}
                        {selectedNode.material_id && (
                          <div className="mb-dl__row">
                            <dt className="mb-dl__key">材料 ID</dt>
                            <dd className="mb-dl__val">{selectedNode.material_id}</dd>
                          </div>
                        )}
                      </dl>
                      {selectedNode.source_locator && (
                        <div className="mt-3">
                          <p className="mb-label mb-1">source_locator</p>
                          <pre className="mb-quote">
                            {JSON.stringify(selectedNode.source_locator, null, 2)}
                          </pre>
                        </div>
                      )}
                      {selectedNode.type === 'material' && selectedNode.material_id && (
                        <Link to={`/materials/${selectedNode.material_id}`} className="btn-ghost mt-4">
                          <Icon name="externalLink" size="sm" />
                          打开材料详情
                        </Link>
                      )}
                      {selectedNode.type === 'fact' && selectedNode.fact_id && (
                        <Link to={`/projects/${projectId}/facts`} className="btn-ghost mt-4">
                          <Icon name="clipboardCheck" size="sm" />
                          在事实清单中查看
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="mb-panel" aria-label="可追溯关系清单">
                <button
                  type="button"
                  className="mb-panel__head w-full text-left"
                  aria-expanded={showRelations}
                  onClick={() => setShowRelations((value) => !value)}
                  style={{ backgroundColor: 'var(--rc-surface-2)' }}
                >
                  <h3 className="mb-panel__title">
                    <Icon name="listTree" size="sm" tone="accent" />
                    可追溯关系
                  </h3>
                  <span className="mb-panel__hint">
                    {model?.uniqueEdges.length ?? 0} 条唯一关系 / 后端返回 {graph.edges.length} 条
                  </span>
                </button>
                {showRelations && (
                  <ul className="mb-panel__body flex flex-col gap-2">
                    {model?.uniqueEdges.map((edge, index) => {
                      const source = model?.nodeById.get(edge.source)
                      const target = model?.nodeById.get(edge.target)
                      return (
                        <li
                          key={`${edge.source}-${edge.type}-${edge.target}-${index}`}
                          className="flex flex-wrap items-center gap-2 text-xs"
                        >
                          <button
                            type="button"
                            className="mb-chip mb-chip--static"
                            onClick={() => setSelectedId(edge.source)}
                          >
                            {source?.label ?? edge.source}
                          </button>
                          <span style={{ color: 'var(--rc-violet)' }}>
                            {EDGE_LABEL[edge.type] ?? edge.type} →
                          </span>
                          <button
                            type="button"
                            className="mb-chip mb-chip--static"
                            onClick={() => setSelectedId(edge.target)}
                          >
                            {target?.label ?? edge.target}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
