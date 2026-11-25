import { useEffect, useRef, useState } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { createFieldController, type FieldController } from './fieldController'
import '../../styles/workbench-background.css'

/**
 * 一级工作台背景层：随全局黑绿深色 / 类纸浅色主题实时切换 WebGL 与 CSS 兜底场。
 */
export default function ReproFieldBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const controllerRef = useRef<FieldController | null>(null)
  const theme = useUIStore((state) => state.theme)
  const [live, setLive] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let controller: FieldController | null = null
    try {
      controller = createFieldController(
        canvas,
        {
          onReady: () => setLive(true),
          onUnavailable: () => setLive(false),
        },
        useUIStore.getState().theme,
      )
      controllerRef.current = controller
    } catch {
      setLive(false)
    }

    return () => {
      controller?.destroy()
      controllerRef.current = null
    }
  }, [])

  useEffect(() => {
    controllerRef.current?.setTheme(theme)
  }, [theme])

  return (
    <div className={`rc-field${live ? ' rc-field--live' : ''}`} aria-hidden="true">
      <div className="rc-field__fallback" />
      <div className="rc-field__echo">
        <span className="rc-field__echo-ring rc-field__echo-ring--outer" />
        <span className="rc-field__echo-ring rc-field__echo-ring--inner" />
      </div>
      <canvas ref={canvasRef} className="rc-field__canvas" />
    </div>
  )
}
