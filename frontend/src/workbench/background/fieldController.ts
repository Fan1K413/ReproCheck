/**
 * 背景控制器：持有 WebGL 上下文、渲染循环、可见性/降级与资源回收。
 *
 * 工程模式参考 godwire/react-aurora-background 与 TheNaubit/react-aurora-background
 * （均为 MIT，署名与许可全文见同目录 ATTRIBUTION.md）：
 * - 低离屏分辨率渲染，浏览器放大承担柔和质感；
 * - 帧率上限 + 帧步长截断，后台恢复不跳变；
 * - IntersectionObserver / visibilitychange / reduced-motion 三路停循环；
 * - 上下文丢失可恢复，卸载时完整释放 GL 资源与监听。
 */

import {
  FIELD_LOBES,
  FIELD_PERF,
  TOKEN_HEX,
  hexToRgb01,
} from './fieldTokens'
import { FRAGMENT_SHADER, MAX_LOBES, VERTEX_SHADER } from './fieldShader'

export interface FieldControllerCallbacks {
  /** WebGL 上下文建立并完成首帧后回调。 */
  onReady?: () => void
  /** 浏览器不支持 WebGL 时回调，CSS 静态背景保持可见。 */
  onUnavailable?: () => void
}

export interface FieldController {
  destroy: () => void
}

interface UniformLocations {
  resolution: WebGLUniformLocation | null
  background: WebGLUniformLocation | null
  count: WebGLUniformLocation | null
  blobs: WebGLUniformLocation | null
  colors: WebGLUniformLocation | null
  softness: WebGLUniformLocation | null
  time: WebGLUniformLocation | null
}

const SOFTNESS = 0.08

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('createShader failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`shader compile failed: ${log ?? 'unknown'}`)
  }
  return shader
}

export function createFieldController(
  canvas: HTMLCanvasElement,
  callbacks: FieldControllerCallbacks = {},
): FieldController {
  let gl: WebGLRenderingContext | null = null
  let program: WebGLProgram | null = null
  let positionBuffer: WebGLBuffer | null = null
  let positionLocation = -1
  let locations: UniformLocations = {
    resolution: null,
    background: null,
    count: null,
    blobs: null,
    colors: null,
    softness: null,
    time: null,
  }

  let unavailable = false
  let contextLost = false
  let inViewport = true
  let pageVisible = !document.hidden
  let reducedMotion = false

  let animating = false
  let rafHandle: number | null = null
  let lastFrame: number | null = null
  let elapsed = 0
  let frameCount = 0
  const intervalMs = 1000 / FIELD_PERF.fps

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

  const blobData = new Float32Array(MAX_LOBES * 3)
  const colorData = new Float32Array(MAX_LOBES * 4)
  const backgroundRgb = hexToRgb01(TOKEN_HEX.ink)

  // 颜色在建立上下文前解析一次；运行期不再做字符串解析。
  FIELD_LOBES.forEach((lobe, index) => {
    const [r, g, b] = hexToRgb01(lobe.color)
    colorData[index * 4] = r
    colorData[index * 4 + 1] = g
    colorData[index * 4 + 2] = b
    colorData[index * 4 + 3] = lobe.weight
  })

  function setupResources(): boolean {
    if (!gl) return false
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    program = gl.createProgram()
    if (!program) return false
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return false
    }

    positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )

    positionLocation = gl.getAttribLocation(program, 'aPosition')
    locations = {
      resolution: gl.getUniformLocation(program, 'uResolution'),
      background: gl.getUniformLocation(program, 'uBackground'),
      count: gl.getUniformLocation(program, 'uCount'),
      blobs: gl.getUniformLocation(program, 'uBlobs'),
      colors: gl.getUniformLocation(program, 'uColors'),
      softness: gl.getUniformLocation(program, 'uSoftness'),
      time: gl.getUniformLocation(program, 'uTime'),
    }
    return true
  }

  function renderSize(cssWidth: number, cssHeight: number): [number, number] {
    const dpr = Math.min(window.devicePixelRatio || 1, FIELD_PERF.maxDpr)
    let pxWidth = Math.max(1, Math.round(cssWidth * dpr))
    let pxHeight = Math.max(1, Math.round(cssHeight * dpr))
    const scale = Math.min(1, FIELD_PERF.maxPixelSide / Math.max(pxWidth, pxHeight))
    pxWidth = Math.max(1, Math.round(pxWidth * scale))
    pxHeight = Math.max(1, Math.round(pxHeight * scale))
    return [pxWidth, pxHeight]
  }

  function resize() {
    if (!gl || !program) return
    const cssWidth = canvas.clientWidth
    const cssHeight = canvas.clientHeight
    if (cssWidth === 0 || cssHeight === 0) return
    const [pxWidth, pxHeight] = renderSize(cssWidth, cssHeight)
    if (canvas.width !== pxWidth || canvas.height !== pxHeight) {
      canvas.width = pxWidth
      canvas.height = pxHeight
      gl.viewport(0, 0, pxWidth, pxHeight)
    }
  }

  function updateBlobData(time: number) {
    FIELD_LOBES.forEach((lobe, index) => {
      const angle = time * lobe.speed + lobe.phase
      const x = lobe.anchor[0] + lobe.driftX * Math.sin(angle)
      const y = lobe.anchor[1] + lobe.driftY * Math.cos(angle * 0.83)
      const radius =
        lobe.radius * (1 + lobe.breath * Math.sin(time * lobe.breathSpeed + lobe.phase))
      blobData[index * 3] = x
      blobData[index * 3 + 1] = y
      blobData[index * 3 + 2] = radius
    })
  }

  function drawFrame() {
    if (!gl || !program || !positionBuffer) return
    resize()
    frameCount += 1
    canvas.dataset.frameCount = String(frameCount)
    gl.useProgram(program)

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

    updateBlobData(elapsed)

    gl.uniform2f(locations.resolution, canvas.width, canvas.height)
    gl.uniform4f(locations.background, backgroundRgb[0], backgroundRgb[1], backgroundRgb[2], 1)
    gl.uniform1i(locations.count, FIELD_LOBES.length)
    gl.uniform3fv(locations.blobs, blobData)
    gl.uniform4fv(locations.colors, colorData)
    gl.uniform1f(locations.softness, SOFTNESS)
    gl.uniform1f(locations.time, elapsed)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  function shouldAnimate(): boolean {
    return (
      !unavailable &&
      !contextLost &&
      inViewport &&
      pageVisible &&
      !reducedMotion
    )
  }

  function stopLoop() {
    animating = false
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle)
      rafHandle = null
    }
    lastFrame = null
  }

  function syncAnimation() {
    if (shouldAnimate()) {
      if (!animating) {
        animating = true
        lastFrame = null
        rafHandle = requestAnimationFrame(tick)
      }
    } else {
      stopLoop()
      // 静止时保留一帧可见画面，而不是留下空白画布。
      drawFrame()
    }
  }

  function tick(now: number) {
    if (!animating) return
    rafHandle = requestAnimationFrame(tick)
    if (lastFrame === null) {
      lastFrame = now
      return
    }
    const deltaMs = now - lastFrame
    if (deltaMs < intervalMs) return

    lastFrame = now
    const deltaSeconds = Math.min(deltaMs / 1000, FIELD_PERF.maxFrameDelta)
    elapsed += deltaSeconds
    drawFrame()
  }

  function handleVisibility() {
    pageVisible = !document.hidden
    syncAnimation()
  }

  function handleMotionChange() {
    reducedMotion = motionQuery.matches
    syncAnimation()
  }

  function handleContextLost(event: Event) {
    event.preventDefault()
    contextLost = true
    stopLoop()
  }

  function handleContextRestored() {
    if (!gl) return
    contextLost = false
    if (setupResources()) {
      resize()
      syncAnimation()
    }
  }

  function destroyResources() {
    if (gl) {
      if (program) gl.deleteProgram(program)
      if (positionBuffer) gl.deleteBuffer(positionBuffer)
    }
    program = null
    positionBuffer = null
  }

  // 初始化：依次尝试 WebGL2 / WebGL1
  const contextOptions: WebGLContextAttributes = {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  }
  gl =
    canvas.getContext('webgl2', contextOptions) as WebGLRenderingContext | null
  if (!gl) {
    gl = canvas.getContext('webgl', contextOptions) as WebGLRenderingContext | null
  }

  if (!gl || !setupResources()) {
    unavailable = true
    callbacks.onUnavailable?.()
    return {
      destroy() {
        destroyResources()
      },
    }
  }

  resize()
  drawFrame()
  callbacks.onReady?.()

  const resizeObserver = new ResizeObserver(() => {
    if (!animating) drawFrame()
    else resize()
  })
  resizeObserver.observe(canvas)

  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[entries.length - 1]
      inViewport = entry ? entry.isIntersecting : true
      syncAnimation()
    },
    { rootMargin: '100px' },
  )
  intersectionObserver.observe(canvas)

  document.addEventListener('visibilitychange', handleVisibility)
  canvas.addEventListener('webglcontextlost', handleContextLost)
  canvas.addEventListener('webglcontextrestored', handleContextRestored)
  motionQuery.addEventListener('change', handleMotionChange)
  handleMotionChange()
  syncAnimation()

  return {
    destroy() {
      stopLoop()
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener('visibilitychange', handleVisibility)
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      canvas.removeEventListener('webglcontextrestored', handleContextRestored)
      motionQuery.removeEventListener('change', handleMotionChange)
      destroyResources()
      gl = null
    },
  }
}
