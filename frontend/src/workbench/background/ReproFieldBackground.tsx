import { useEffect, useRef, useState } from 'react'
import { createFieldController, type FieldController } from './fieldController'
import '../../styles/workbench-background.css'

/**
 * 一级工作台背景层。
 *
 * 结构（自下而上）：
 *  1. `__fallback`  静态墨紫底 + 两条斜向丝绸折痕，首屏与 WebGL 不可用时可见；
 *  2. `__canvas`   WebGL 丝绸光场，仅做光影，不拦截任何交互。
 *
 * 第二轮已移除证据点阵与两条轨道环：它们会和盘面争夺「几何仪器感」，
 * 空间纵深改由着色器的域扭曲、环境光与 CSS 的单一外轨道承担。
 */
export default function ReproFieldBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [live, setLive] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let controller: FieldController | null = null
    try {
      controller = createFieldController(canvas, {
        onReady: () => setLive(true),
        onUnavailable: () => setLive(false),
      })
    } catch {
      setLive(false)
    }

    return () => controller?.destroy()
  }, [])

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
