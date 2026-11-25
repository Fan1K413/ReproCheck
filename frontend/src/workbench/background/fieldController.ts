/**
 * 背景控制器：持有 WebGL 上下文、渲染循环、双主题即时切换与资源回收。
 */
import type { ThemeMode } from '../../stores/uiStore'
import { FIELD_LOBES, FIELD_PERF, FIELD_THEMES } from './fieldTokens'
import { FRAGMENT_SHADER, MAX_LOBES, VERTEX_SHADER } from './fieldShader'

export interface FieldControllerCallbacks {
  onReady?: () => void
  onUnavailable?: () => void
}

export interface FieldController {
  setTheme: (theme: ThemeMode) => void
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
  silkDeep: WebGLUniformLocation | null
  silkLight: WebGLUniformLocation | null
  ambientLow: WebGLUniformLocation | null
  ambientHigh: WebGLUniformLocation | null
  fiberColor: WebGLUniformLocation | null
  ridgeColor: WebGLUniformLocation | null
  vignetteColor: WebGLUniformLocation | null
  isLight: WebGLUniformLocation | null
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
  initialTheme: ThemeMode = 'dark',
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
    silkDeep: null,
    silkLight: null,
    ambientLow: null,
    ambientHigh: null,
    fiberColor: null,
    ridgeColor: null,
    vignetteColor: null,
    isLight: null,
  }

  let unavailable = false
  let contextLost = false
  let inViewport = true
  let pageVisible = !document.hidden
  let reducedMotion = false
  let currentTheme: ThemeMode = initialTheme

  let animating = false
  let rafHandle: number | null = null
  let lastFrame: number | null = null
  let elapsed = 0
  let frameCount = 0
  const intervalMs = 1000 / FIELD_PERF.fps

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

  const blobData = new Float32Array(MAX_LOBES * 3)
  const colorData = new Float32Array(MAX_LOBES * 4)

  function syncPaletteData(theme: ThemeMode) {
    currentTheme = theme
    const palette = FIELD_THEMES[theme]
    FIELD_LOBES.forEach((lobe, index) => {
      const [r, g, b] = palette.lobeColors[index] ?? palette.silkLight
      colorData[index * 4] = r
      colorData[index * 4 + 1] = g
      colorData[index * 4 + 2] = b
      colorData[index * 4 + 3] = lobe.weight
    })
  }

  syncPaletteData(initialTheme)

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
      silkDeep: gl.getUniformLocation(program, 'uSilkDeep'),
      silkLight: gl.getUniformLocation(program, 'uSilkLight'),
      ambientLow: gl.getUniformLocation(program, 'uAmbientLow'),
      ambientHigh: gl.getUniformLocation(program, 'uAmbientHigh'),
      fiberColor: gl.getUniformLocation(program, 'uFiberColor'),
      ridgeColor: gl.getUniformLocation(program, 'uRidgeColor'),
      vignetteColor: gl.getUniformLocation(program, 'uVignetteColor'),
      isLight: gl.getUniformLocation(program, 'uIsLight'),
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
    const palette = FIELD_THEMES[currentTheme]

    gl.uniform2f(locations.resolution, canvas.width, canvas.height)
    gl.uniform4f(
      locations.background,
      palette.background[0],
      palette.background[1],
      palette.background[2],
      1,
    )
    gl.uniform1i(locations.count, FIELD_LOBES.length)
    gl.uniform3fv(locations.blobs, blobData)
    gl.uniform4fv(locations.colors, colorData)
    gl.uniform1f(locations.softness, SOFTNESS)
    gl.uniform1f(locations.time, elapsed)
    gl.uniform3fv(locations.silkDeep, palette.silkDeep)
    gl.uniform3fv(locations.silkLight, palette.silkLight)
    gl.uniform3fv(locations.ambientLow, palette.ambientLow)
    gl.uniform3fv(locations.ambientHigh, palette.ambientHigh)
    gl.uniform3fv(locations.fiberColor, palette.fiberColor)
    gl.uniform3fv(locations.ridgeColor, palette.ridgeColor)
    gl.uniform3fv(locations.vignetteColor, palette.vignetteColor)
    gl.uniform1f(locations.isLight, palette.isLight)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  function shouldAnimate(): boolean {
    return !unavailable && !contextLost && inViewport && pageVisible && !reducedMotion
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

  const contextOptions: WebGLContextAttributes = {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  }
  gl = canvas.getContext('webgl2', contextOptions) as WebGLRenderingContext | null
  if (!gl) {
    gl = canvas.getContext('webgl', contextOptions) as WebGLRenderingContext | null
  }

  if (!gl || !setupResources()) {
    unavailable = true
    callbacks.onUnavailable?.()
    return {
      setTheme(theme: ThemeMode) {
        syncPaletteData(theme)
      },
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
    setTheme(theme: ThemeMode) {
      syncPaletteData(theme)
      drawFrame()
    },
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
