import { useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'
import {
  bloomPlacements,
  mobileStageHeight,
  panelBox,
  restPlacement,
  type CardSpec,
  type PanelBox,
  type Placement,
  type StageBox,
} from './geometry'
import type { BloomMode, BloomMorph } from './types'

type LayoutArgs = {
  stageRef: RefObject<HTMLElement | null>
  cards: CardSpec[]
  mode: BloomMode
  activeIds: string[]
  relatedIds: string[]
  wide: boolean
  panelMorph: BloomMorph
}

type LayoutResult = {
  stage: StageBox
  mobile: boolean
  measured: boolean
  placements: Map<string, Placement>
  panel: PanelBox | null
  height: number
}

/**
 * 响应式轨道布局：宽度变化时重算所有目标位置；
 * 高度在桌面由容器撑满，在移动端由卡片数量决定。
 */
export function useBloomLayout({
  stageRef,
  cards,
  mode,
  activeIds,
  relatedIds,
  wide,
  panelMorph,
}: LayoutArgs): LayoutResult {
  const [stage, setStage] = useState<StageBox>({ w: 0, h: 0 })
  const [measured, setMeasured] = useState(false)

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const measure = () => {
      const width = element.clientWidth
      const height = element.clientHeight
      if (width <= 0) return
      setStage((previous) =>
        previous.w === width && previous.h === height ? previous : { w: width, h: height },
      )
      setMeasured(true)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [stageRef])

  const mobile = measured && stage.w < 900
  const height = mobile ? mobileStageHeight(cards.length) : stage.h
  const effectiveStage: StageBox = mobile
    ? { w: stage.w, h: height }
    : stage

  const panel = useMemo(() => {
    if (mode === 'rest' || effectiveStage.w === 0) return null
    return panelBox(effectiveStage, panelMorph)
  }, [mode, effectiveStage, panelMorph])

  const placements = useMemo(() => {
    if (effectiveStage.w === 0 || effectiveStage.h === 0) return new Map<string, Placement>()
    if (mode === 'rest' || !panel) {
      return new Map(
        cards.map((card) => [
          card.id,
          restPlacement(effectiveStage, card, mobile, cards.length),
        ]),
      )
    }
    return bloomPlacements({
      stage: effectiveStage,
      cards,
      activeIds,
      relatedIds,
      panel,
      wide,
      combined: mode === 'combined',
      mobile,
    })
  }, [cards, mode, effectiveStage, panel, activeIds, relatedIds, wide, mobile])

  return { stage: effectiveStage, mobile, measured, placements, panel, height }
}
