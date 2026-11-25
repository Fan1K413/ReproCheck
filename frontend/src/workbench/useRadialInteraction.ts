import { useRef, useState } from 'react'
import type { KeyboardEvent, MutableRefObject, PointerEvent, RefObject } from 'react'
import { ENTRIES } from './EntryLauncher'
import { angleFromVector, nearestIndex } from './radialLayout'

export type WorkbenchPhase = 'S0' | 'S1' | 'S2' | 'S3'

type DragState = {
  startX: number
  startY: number
  pointerId: number
  pointerType: string
  captured: boolean
  cancelled: boolean
}

type Options = {
  discRef: RefObject<HTMLDivElement>
  entryRefs: MutableRefObject<Array<HTMLButtonElement | null>>
  /** 点击 / 键盘 / 拖动释放共用的提交回调 */
  onCommit: (index: number) => void
  /** 阈值内松手：显示一次操作提示 */
  onHint: () => void
}

/**
 * S0 默认 / S1 hover·focus / S2 点击反馈 / S3 拖动选中。
 * 拖动按 interaction-spec §4 与视觉负责人最终精测：8·12px 激活阈值、
 * 0.48R 死区（保持 S0）、0.48R–2R 按最近角度命中、>2R 取消；
 * 热区尺寸在不同断点下都有效，因此阈值用 R 表达。
 */
export function useRadialInteraction({ discRef, entryRefs, onCommit, onHint }: Options) {
  const [phase, setPhase] = useState<WorkbenchPhase>('S0')
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const phaseRef = useRef<WorkbenchPhase>('S0')
  const activeRef = useRef<number | null>(null)
  const dragRef = useRef<DragState | null>(null)

  const update = (nextPhase: WorkbenchPhase, nextIndex: number | null) => {
    phaseRef.current = nextPhase
    activeRef.current = nextIndex
    setPhase(nextPhase)
    setActiveIndex(nextIndex)
  }

  const reset = () => {
    dragRef.current = null
    update('S0', null)
  }

  const commit = (index: number) => {
    dragRef.current = null
    update('S2', index)
    onCommit(index)
  }

  const onEntryEnter = (index: number) => {
    if (phaseRef.current === 'S3') return
    update('S1', index)
  }

  const onEntryLeave = (index: number) => {
    if (phaseRef.current !== 'S1' || activeRef.current !== index) return
    update('S0', null)
  }

  const onEntryFocus = (index: number) => {
    setFocusIndex(index)
    if (phaseRef.current !== 'S3') update('S1', index)
  }

  const onEntryBlur = (index: number) => {
    if (phaseRef.current === 'S1' && activeRef.current === index) update('S0', null)
  }

  const onCorePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      captured: false,
      cancelled: false,
    }
  }

  const onCorePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const travelled = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY)
    const threshold = drag.pointerType === 'touch' ? 12 : 8
    if (!drag.captured) {
      if (travelled < threshold) return
      drag.captured = true
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* 捕获失败仍可按坐标继续跟踪 */
      }
    }

    const rect = discRef.current?.getBoundingClientRect()
    if (!rect) return
    const centreX = rect.left + rect.width / 2
    const centreY = rect.top + rect.height / 2
    const radius = rect.width / 2
    const vectorX = event.clientX - centreX
    const vectorY = event.clientY - centreY
    const distance = Math.hypot(vectorX, vectorY)

    if (distance > 2 * radius) {
      drag.cancelled = true
      update('S0', null)
      return
    }
    if (distance < 0.48 * radius) {
      drag.cancelled = false
      update('S0', null)
      return
    }
    drag.cancelled = false

    const theta = angleFromVector(vectorX, vectorY)
    update('S3', nearestIndex(theta, ENTRIES.length))
  }

  const onCorePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const target = activeRef.current
    const shouldCommit = drag.captured && !drag.cancelled && phaseRef.current === 'S3' && target !== null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* 捕获已自动释放时忽略 */
    }
    dragRef.current = null
    if (shouldCommit && target !== null) commit(target)
    else {
      if (!drag.captured) onHint()
      reset()
    }
  }

  const onCorePointerCancel = () => {
    reset()
  }

  const focusEntry = (index: number) => {
    const next = (index + ENTRIES.length) % ENTRIES.length
    setFocusIndex(next)
    entryRefs.current[next]?.focus()
    if (phaseRef.current !== 'S3') update('S1', next)
  }

  const onEntryKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        focusEntry(index + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        focusEntry(index - 1)
        break
      case 'Home':
        event.preventDefault()
        focusEntry(0)
        break
      case 'End':
        event.preventDefault()
        focusEntry(ENTRIES.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        commit(index)
        break
      case 'Escape':
        event.preventDefault()
        reset()
        break
      default:
        break
    }
  }

  const dimOpacity = phase === 'S3' ? 0.45 : phase === 'S1' ? 0.6 : 1

  return {
    phase,
    activeIndex,
    focusIndex,
    dimOpacity,
    commit,
    reset,
    onEntryEnter,
    onEntryLeave,
    onEntryFocus,
    onEntryBlur,
    onEntryKeyDown,
    onCorePointerDown,
    onCorePointerMove,
    onCorePointerUp,
    onCorePointerCancel,
  }
}
