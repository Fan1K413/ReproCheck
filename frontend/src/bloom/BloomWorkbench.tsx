import { useEffect, useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import type { BloomMode, BloomUnitId, WorkbenchUnitData } from './types'
import { BloomStage } from './BloomStage'

type BloomWorkbenchProps = {
  projectId: string
  data: WorkbenchUnitData
}

function syncFocusParam(id: BloomUnitId | null) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('focus', id)
  else url.searchParams.delete('focus')
  window.history.replaceState(window.history.state, '', url)
}

/**
 * 工作台状态机：
 * rest → open → combining → combined → open / rest
 * 所有状态变化都会同步到 ?focus=，刷新后可以回到同一单元。
 */
export function BloomWorkbench({ projectId, data }: BloomWorkbenchProps) {
  const [searchParams] = useSearchParams()
  const { key: locationKey } = useLocation()
  const [mode, setMode] = useState<BloomMode>('rest')
  const [activeId, setActiveId] = useState<BloomUnitId | null>(null)
  const [selectedIds, setSelectedIds] = useState<BloomUnitId[]>([])
  const [combinedPair, setCombinedPair] = useState<[BloomUnitId, BloomUnitId] | null>(null)

  const units = data.units
  const ids = useMemo(() => new Set(units.map((unit) => unit.id)), [units])

  // 深链恢复：数据可能异步到达，必须等 units 就绪后再读取一次 URL。
  const focus = searchParams.get('focus') as BloomUnitId | null
  const canRestoreFocus = Boolean(focus && ids.has(focus))
  useEffect(() => {
    if (focus && !canRestoreFocus) return
    setCombinedPair(null)
    setSelectedIds([])
    setActiveId(focus)
    setMode(focus ? 'open' : 'rest')
  }, [focus, canRestoreFocus, locationKey])

  const open = (id: BloomUnitId) => {
    if (!ids.has(id)) return
    setCombinedPair(null)
    setSelectedIds([])
    setActiveId(id)
    setMode('open')
    syncFocusParam(id)
  }

  const close = () => {
    setMode('rest')
    setActiveId(null)
    setSelectedIds([])
    setCombinedPair(null)
    syncFocusParam(null)
  }

  const combine = (pair: [BloomUnitId, BloomUnitId]) => {
    if (!ids.has(pair[0]) || !ids.has(pair[1]) || pair[0] === pair[1]) return
    setCombinedPair(pair)
    setSelectedIds(pair)
    setActiveId(null)
    setMode('combined')
    syncFocusParam(null)
  }

  const select = (id: BloomUnitId) => {
    if (mode === 'combined') {
      open(id)
      return
    }
    if (mode === 'combining') {
      if (selectedIds.includes(id)) {
        const next = selectedIds.filter((item) => item !== id)
        setSelectedIds(next)
        if (next.length === 0) setMode(activeId ? 'open' : 'rest')
        return
      }
      const next = [...selectedIds, id].slice(0, 2) as BloomUnitId[]
      if (next.length === 2) {
        combine([next[0], next[1]])
        return
      }
      setSelectedIds(next)
      return
    }
    if (mode === 'open' && activeId) {
      if (activeId === id) {
        setSelectedIds([activeId])
        setMode('combining')
        return
      }
      combine([activeId, id])
      return
    }
  }

  const cancelCombo = () => {
    if (mode === 'combined' && combinedPair) {
      const first = combinedPair[0]
      setCombinedPair(null)
      setSelectedIds([])
      setActiveId(first)
      setMode('open')
      syncFocusParam(first)
      return
    }
    setCombinedPair(null)
    setSelectedIds([])
    setMode(activeId ? 'open' : 'rest')
    syncFocusParam(activeId)
  }

  return (
    <BloomStage
      projectId={projectId}
      projectName={data.project?.name ?? null}
      paperTitle={data.project?.paper_title ?? null}
      units={units}
      mode={mode}
      activeId={activeId}
      selectedIds={selectedIds}
      combinedPair={combinedPair}
      comboInsight={data.comboInsight}
      onOpen={open}
      onClose={close}
      onSelect={select}
      onCombine={combine}
      onCancelCombo={cancelCombo}
      onRefresh={data.refresh}
    />
  )
}
