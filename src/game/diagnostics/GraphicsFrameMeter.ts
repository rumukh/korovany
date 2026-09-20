import * as THREE from 'three'
import type { TransientEffectBudget } from '../TransientEffectBudget.ts'
import { StylizedArtLibrary } from '../art/StylizedArtLibrary.ts'
import { GraphicsGpuTimer, type GraphicsGpuSample } from './GraphicsGpuTimer.ts'
import { GraphicsResources, type GraphicsResourceSnapshot } from './GraphicsResources.ts'
import { MethodPatch } from './MethodPatch.ts'
import {
  GraphicsSubsystemSubmissions, type GraphicsSourceRoot, type GraphicsSubsystemFrame,
} from './GraphicsSubsystemSubmissions.ts'

export type GraphicsPass = 'scene' | 'ink' | 'shadow' | 'post'
export interface GraphicsDraws { calls: number; triangles: number; lines: number; points: number }
export interface GraphicsRuntimeFrame {
  elapsed: number
  paused: boolean
  ended: boolean
  npcCount: number
  aliveNpcs: number
  movingNpcs: number
  actingNpcs: number
  health: number
  region: string | null
  visibleRegions: string[]
  simulatedRegions: string[]
  transientPresentation?: ReturnType<TransientEffectBudget['snapshot']>
  cameraPresentation?: {
    x: number
    y: number
    z: number
    boom: number
    shoulder: number
    overflows: number
    targetProbes?: number
    visibleTargetProbes?: number
    visibilityCut?: boolean
    trianglesTested: number
    fadedInstances: number
    worldShadowDraws: number
    worldShadowInstances: number
    worldShadowTriangles: number
  }
}
export interface GraphicsFrame extends GraphicsGpuSample {
  id: number
  source: 'active' | 'manual'
  phase: 'capture' | 'warmup' | 'sample'
  intervalMs: number | null
  updateMs: number
  submissionMs: number
  cpuMs: number
  streamingMs: number
  draws: Record<GraphicsPass, GraphicsDraws> | null
  total: GraphicsDraws | null
  rendererInfo: GraphicsDraws | null
  counterAgreement: boolean | null
  readPixelsCalls: number | null
  blits: number | null
  resources: GraphicsResourceSnapshot | null
  subsystems: GraphicsSubsystemFrame | null
  bufferDimensions: { width: number; height: number } | null
  runtime: GraphicsRuntimeFrame
}

const emptyDraws = (): GraphicsDraws => ({ calls: 0, triangles: 0, lines: 0, points: 0 })

export function addGraphicsDraw(target: GraphicsDraws, mode: number, count: number, instances: number): void {
  if (!Number.isInteger(count) || count < 0 || !Number.isInteger(instances) || instances < 0) {
    throw new Error('Invalid graphics draw dimensions')
  }
  target.calls++
  if (mode === 0x0004) target.triangles += count / 3 * instances
  else if (mode === 0x0005 || mode === 0x0006) target.triangles += Math.max(0, count - 2) * instances
  else if (mode === 0x0001) target.lines += count / 2 * instances
  else if (mode === 0x0002) target.lines += count * instances
  else if (mode === 0x0003) target.lines += Math.max(0, count - 1) * instances
  else if (mode === 0x0000) target.points += count * instances
  else throw new Error(`Unknown graphics primitive mode ${mode}`)
}

function numeric(value: unknown): number {
  if (typeof value !== 'number') throw new Error('Invalid graphics draw argument')
  return value
}

export class GraphicsFrameMeter {
  readonly gpu: GraphicsGpuTimer
  readonly resources: GraphicsResources
  readonly subsystemSubmissions: GraphicsSubsystemSubmissions
  private readonly renderer: THREE.WebGLRenderer
  private readonly patches = new MethodPatch()
  private readonly originalAutoReset: boolean
  private readonly now: () => number
  private current: {
    id: number
    source: 'active' | 'manual'
    intervalMs: number | null
    started: number
    updateEnd: number
    streamStart: number | null
    streamingMs: number
    draws: Record<GraphicsPass, GraphicsDraws>
    readPixelsCalls: number
    blits: number
    gpu: GraphicsGpuSample
  } | null = null
  private category: GraphicsPass = 'scene'
  private sequence = 0
  private disposed = false
  private counting = true

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, resources: GraphicsResources,
    now: () => number = () => performance.now(), readRoots?: () => readonly GraphicsSourceRoot[]) {
    this.renderer = renderer
    this.resources = resources
    this.now = now
    this.subsystemSubmissions = new GraphicsSubsystemSubmissions(readRoots)
    const gl = renderer.getContext()
    if (!('beginQuery' in gl)) throw new Error('Graphics diagnostics require WebGL2')
    this.gpu = new GraphicsGpuTimer(gl)
    this.originalAutoReset = renderer.info.autoReset
    renderer.info.autoReset = false
    try {
      this.installObservers(renderer, scene, resources, gl)
    } catch (error) {
      const errors: unknown[] = [error]
      try { this.patches.dispose() } catch (cleanupError) { errors.push(cleanupError) }
      try { this.gpu.dispose() } catch (cleanupError) { errors.push(cleanupError) }
      renderer.info.autoReset = this.originalAutoReset
      throw new AggregateError(errors, 'Graphics observer installation failed')
    }
  }

  private installObservers(renderer: THREE.WebGLRenderer, scene: THREE.Scene,
    resources: GraphicsResources, gl: WebGL2RenderingContext): void {
    this.patches.wrap(renderer, 'render', (call, args) => {
      const previous = this.category
      this.category = args[0] === scene ? 'scene' : 'post'
      try { return this.subsystemSubmissions.withSource(null, null, null, this.category, call) }
      finally { this.category = previous }
    })
    this.patches.wrap(renderer, 'renderBufferDirect', (call, args) => {
      const previous = this.category
      const object = args[4]
      if (args[1] === null) this.category = 'shadow'
      else if (object instanceof THREE.Object3D && StylizedArtLibrary.isOutlineShell(object)) this.category = 'ink'
      const material = args[3] instanceof THREE.Material ? args[3] : null
      const value = args[5]
      const group = value && typeof value === 'object' && 'start' in value && 'count' in value &&
        typeof value.start === 'number' && typeof value.count === 'number'
        ? { start: value.start, count: value.count,
          ...('materialIndex' in value && typeof value.materialIndex === 'number' ? { materialIndex: value.materialIndex } : {}) }
        : null
      const before = this.current?.draws[this.category].calls ?? 0
      const pass = this.category
      try {
        const target = renderer.getRenderTarget()
        if (target) resources.observeRenderTarget(target, renderer.properties, pass === 'shadow')
        return this.subsystemSubmissions.withSource(object instanceof THREE.Object3D ? object : null,
          material, group, this.category, call)
      } finally {
        this.category = previous
        if (object instanceof THREE.Object3D && (this.current?.draws[pass].calls ?? 0) > before) {
          const { owner } = this.subsystemSubmissions.resolver.resolve(object, pass)
          if (owner !== 'unattributed') resources.observeSource(object, owner, renderer.properties)
        }
      }
    })
    this.patches.wrap(renderer, 'setRenderTarget', (call, args) => {
      const result = call()
      if (args[0] instanceof THREE.WebGLRenderTarget) {
        resources.observeRenderTarget(args[0], renderer.properties, false)
      }
      return result
    })
    const draw = (key: 'drawArrays' | 'drawElements' | 'drawArraysInstanced' | 'drawElementsInstanced' | 'drawRangeElements',
      countIndex: number, instanceIndex?: number) => {
      this.patches.wrap(gl, key, (call, args) => {
        const result = call()
        if (this.current) {
          const total = this.current.draws[this.category]
          const calls = total.calls, triangles = total.triangles, lines = total.lines, points = total.points
          const instances = instanceIndex === undefined ? 1 : numeric(args[instanceIndex])
          addGraphicsDraw(total, numeric(args[0]), numeric(args[countIndex]), instances)
          this.subsystemSubmissions.record(this.category, {
            calls: total.calls - calls, triangles: total.triangles - triangles,
            lines: total.lines - lines, points: total.points - points,
          }, instances)
        }
        return result
      })
    }
    draw('drawArrays', 2)
    draw('drawElements', 1)
    draw('drawArraysInstanced', 2, 3)
    draw('drawElementsInstanced', 1, 4)
    draw('drawRangeElements', 3)
    this.patches.wrap(gl, 'readPixels', (call) => {
      if (this.current) this.current.readPixelsCalls++
      return call()
    })
    this.patches.wrap(gl, 'blitFramebuffer', (call) => {
      if (this.current) this.current.blits++
      return call()
    })
  }

  begin(deltaSeconds: number, source: 'active' | 'manual'): void {
    if (this.disposed || this.current) throw new Error('Invalid graphics logical-frame begin')
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error('Invalid frame delta')
    if (this.counting) this.renderer.info.reset()
    if (this.counting) this.subsystemSubmissions.begin()
    const started = this.now()
    this.current = {
      id: ++this.sequence, source, intervalMs: source === 'active' ? deltaSeconds * 1000 : null,
      started, updateEnd: started, streamStart: null, streamingMs: 0,
      draws: { scene: emptyDraws(), ink: emptyDraws(), shadow: emptyDraws(), post: emptyDraws() },
      readPixelsCalls: 0, blits: 0, gpu: { gpuMs: null, gpuStatus: 'unavailable' },
    }
  }

  beginStreaming(): void {
    if (!this.current) return
    if (this.current.streamStart !== null) throw new Error('Nested graphics streaming measurement')
    this.current.streamStart = this.now()
  }

  endStreaming(): void {
    if (!this.current) return
    if (this.current.streamStart === null) throw new Error('Streaming measurement was not started')
    this.current.streamingMs += this.now() - this.current.streamStart
    this.current.streamStart = null
  }

  endUpdate(): void {
    if (!this.current) throw new Error('Graphics update ended outside a frame')
    this.current.updateEnd = this.now()
    this.gpu.begin(this.current.gpu)
  }

  end(readRuntime: GraphicsRuntimeFrame | (() => GraphicsRuntimeFrame), phase: GraphicsFrame['phase']): GraphicsFrame {
    if (!this.current) throw new Error('Graphics frame ended without a begin')
    this.gpu.end()
    const ended = this.now()
    const current = this.current
    this.current = null
    const runtime = typeof readRuntime === 'function' ? readRuntime() : readRuntime
    if (current.streamStart !== null) throw new Error('Unclosed streaming measurement')
    const total = emptyDraws()
    for (const draws of Object.values(current.draws)) {
      for (const key of ['calls', 'triangles', 'lines', 'points'] as const) total[key] += draws[key]
    }
    const info = this.renderer.info.render
    const rendererInfo = { calls: info.calls, triangles: info.triangles, lines: info.lines, points: info.points }
    const frame: GraphicsFrame = Object.assign(current.gpu, {
      id: current.id, source: current.source, phase, intervalMs: current.intervalMs,
      updateMs: current.updateEnd - current.started, submissionMs: ended - current.updateEnd,
      cpuMs: ended - current.started, streamingMs: current.streamingMs,
      draws: this.counting ? current.draws : null,
      total: this.counting ? total : null, rendererInfo: this.counting ? rendererInfo : null,
      counterAgreement: this.counting ? Object.keys(total).every((key) =>
        Reflect.get(total, key) === Reflect.get(rendererInfo, key)) : null,
      readPixelsCalls: this.counting ? current.readPixelsCalls : null, blits: this.counting ? current.blits : null,
      resources: this.counting ? this.resources.snapshot() : null, runtime,
      subsystems: this.counting ? this.subsystemSubmissions.snapshot(current.draws) : null,
      bufferDimensions: this.renderer.domElement
        ? { width: this.renderer.domElement.width, height: this.renderer.domElement.height } : null,
    })
    return frame
  }

  abort(): void {
    this.gpu.end()
    this.current = null
    this.category = 'scene'
  }

  get countersEnabled(): boolean { return this.counting }

  disableCounters(): void {
    if (this.disposed || this.current) throw new Error('Cannot remove counters inside a frame or after disposal')
    if (!this.counting) return
    this.patches.dispose()
    this.resources.stopTracking()
    this.renderer.info.autoReset = this.originalAutoReset
    this.counting = false
    this.subsystemSubmissions.clear()
  }

  dispose(): void {
    if (this.disposed) return
    this.abort()
    this.disposed = true
    this.gpu.dispose()
    this.patches.dispose()
    this.renderer.info.autoReset = this.originalAutoReset
    this.subsystemSubmissions.clear()
  }
}

export function graphicsDistribution(values: readonly number[]) {
  if (!values.length) return null
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Invalid graphics distribution')
  const sorted = [...values].sort((left, right) => left - right)
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]
  return {
    count: sorted.length, min: sorted[0], max: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99),
  }
}

export function summarizeGraphicsFrames(frames: readonly GraphicsFrame[]) {
  const distribution = (read: (frame: GraphicsFrame) => number | null) =>
    graphicsDistribution(frames.flatMap((frame) => {
      const value = read(frame)
      return value === null ? [] : [value]
    }))
  return {
    frames: frames.length,
    frameTimeMs: graphicsDistribution(frames.flatMap((frame) => frame.intervalMs === null ? [] : [frame.intervalMs])),
    cpuUpdateMs: distribution((frame) => frame.updateMs),
    cpuSubmissionMs: distribution((frame) => frame.submissionMs),
    cpuTotalMs: distribution((frame) => frame.cpuMs),
    streamingMs: distribution((frame) => frame.streamingMs),
    gpuMs: graphicsDistribution(frames.flatMap((frame) => frame.gpuMs === null ? [] : [frame.gpuMs])),
    gpuStatuses: Object.fromEntries([...new Set(frames.map((frame) => frame.gpuStatus))]
      .map((status) => [status, frames.filter((frame) => frame.gpuStatus === status).length])),
    calls: distribution((frame) => frame.total?.calls ?? null),
    triangles: distribution((frame) => frame.total?.triangles ?? null),
    mainViewTriangles: distribution((frame) => frame.draws ? frame.draws.scene.triangles + frame.draws.ink.triangles : null),
    passes: Object.fromEntries((['scene', 'ink', 'shadow', 'post'] as const).map((pass) => [pass, {
      calls: distribution((frame) => frame.draws?.[pass].calls ?? null),
      triangles: distribution((frame) => frame.draws?.[pass].triangles ?? null),
    }])),
    trackedBytes: distribution((frame) => frame.resources?.trackedBytes ?? null),
    renderTargetBytes: distribution((frame) => frame.resources?.renderTargetBytes ?? null),
    npcs: distribution((frame) => frame.runtime.npcCount),
    aliveNpcs: distribution((frame) => frame.runtime.aliveNpcs),
    movingNpcs: distribution((frame) => frame.runtime.movingNpcs),
    actingNpcs: distribution((frame) => frame.runtime.actingNpcs),
    at25NpcCapFrames: frames.filter((frame) => frame.runtime.npcCount === 25).length,
    inactiveFrames: frames.filter((frame) => frame.runtime.paused || frame.runtime.ended).length,
    counterDisagreements: frames.filter((frame) => frame.counterAgreement === false).map((frame) => frame.id),
    counterUnavailableFrames: frames.filter((frame) => frame.counterAgreement === null).length,
    readPixelsCalls: frames.some((frame) => frame.readPixelsCalls === null) ? null :
      frames.reduce((sum, frame) => sum + (frame.readPixelsCalls ?? 0), 0),
    streamingTransitions: frames.flatMap((frame, index) => {
      const previous = frames[index - 1]
      if (!previous || previous.runtime.visibleRegions.join() === frame.runtime.visibleRegions.join()) return []
      return [{
        frame: frame.id, region: frame.runtime.region, intervalMs: frame.intervalMs,
        nextIntervalMs: frames[index + 1]?.intervalMs ?? null,
        cpuMs: frame.cpuMs, streamingMs: frame.streamingMs,
        loaded: frame.runtime.visibleRegions.filter((id) => !previous.runtime.visibleRegions.includes(id)),
        unloaded: previous.runtime.visibleRegions.filter((id) => !frame.runtime.visibleRegions.includes(id)),
        allocatedBytes: frame.resources && previous.resources
          ? frame.resources.allocatedBytes - previous.resources.allocatedBytes : null,
        releasedBytes: frame.resources && previous.resources
          ? frame.resources.releasedBytes - previous.resources.releasedBytes : null,
      }]
    }),
  }
}
