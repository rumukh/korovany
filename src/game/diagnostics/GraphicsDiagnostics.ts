import * as THREE from 'three'
import type { ActiveRunSaveV3 } from '../run/runTypes.ts'
import {
  GRAPHICS_DIAGNOSTICS_VERSION, GRAPHICS_VISUAL_REVISION, type GraphicsClock,
} from './GraphicsClock.ts'
import {
  GraphicsFrameMeter, summarizeGraphicsFrames, type GraphicsFrame, type GraphicsRuntimeFrame,
} from './GraphicsFrameMeter.ts'
import { GraphicsResources } from './GraphicsResources.ts'
import {
  graphicsSubsystemBudgetSnapshot, type GraphicsSubsystemInputs,
} from './GraphicsSubsystemInventory.ts'
import type { GraphicsSourceRoot } from './GraphicsSubsystemSubmissions.ts'
import {
  CHARACTER_PORTRAIT_VERSION, validateCharacterPortrait, type GraphicsCharacterPortraitRequest,
} from './GraphicsCharacterPortrait.ts'

export interface GraphicsPoint { x: number; y: number; z: number }
export interface GraphicsFixtureStage {
  label: string
  player?: GraphicsPoint
  companions?: Array<{ id: string; position: GraphicsPoint }>
  camera?: { yaw: number; pitch: number }
  crowd?: boolean
  foundation?: boolean
  antialiasing?: 'none' | 'fxaa'
  portrait?: GraphicsCharacterPortraitRequest | null
}
export interface GraphicsProfileOptions {
  warmupFrames: number
  sampleFrames: number
  inputs?: Array<{ frame: number; keys: string[] }>
  counters?: 'full' | 'disabled'
}
export interface GraphicsDiagnosticHost {
  runtime(): GraphicsRuntimeFrame
  snapshot(): object
  world(): object
  stage(request: GraphicsFixtureStage): void
  present(): void
  frame(delta: number): void
  save(): ActiveRunSaveV3
  input(keys: readonly string[]): void
  probe(points: readonly { x: number; z: number }[]): object[]
  subsystemRoots?(): readonly GraphicsSourceRoot[]
  subsystemInventory?(): GraphicsSubsystemInputs
}

export function validateGraphicsProbe(points: readonly { x: number; z: number }[]): void {
  if (!Array.isArray(points) || points.length < 1 || points.length > 256
    || points.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.z))) {
    throw new Error('Graphics terrain probes require 1..256 finite points')
  }
}

export function validateGraphicsStage(request: GraphicsFixtureStage): void {
  if (!request || typeof request.label !== 'string' || !request.label.trim() || request.label.length > 240) {
    throw new Error('Every graphics stage needs an explicit, bounded prerequisite label')
  }
  const point = (value: GraphicsPoint) => {
    if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) throw new Error('Non-finite fixture position')
  }
  if (request.player) point(request.player)
  if (request.camera && (!Number.isFinite(request.camera.yaw) || !Number.isFinite(request.camera.pitch)
    || request.camera.pitch < -0.2 || request.camera.pitch > 1.15)) throw new Error('Invalid fixture camera')
  if (request.companions) {
    if (!Array.isArray(request.companions) || request.companions.length > 3
      || new Set(request.companions.map((entry) => entry.id)).size !== request.companions.length) {
      throw new Error('Invalid or duplicate fixture companion identities')
    }
    for (const entry of request.companions) {
      if (typeof entry.id !== 'string' || !entry.id) throw new Error('Missing fixture companion identity')
      point(entry.position)
    }
  }
  if (request.crowd !== undefined && typeof request.crowd !== 'boolean') throw new Error('Invalid crowd prerequisite')
  if (request.foundation !== undefined && typeof request.foundation !== 'boolean') throw new Error('Invalid foundation prerequisite')
  if (request.antialiasing !== undefined && !['none', 'fxaa'].includes(request.antialiasing)) throw new Error('Invalid AA comparison prerequisite')
  if (request.portrait !== undefined) {
    if (Object.keys(request).some((key) => key !== 'label' && key !== 'portrait')) {
      throw new Error('Portrait staging cannot be combined with world, camera, crowd or effect prerequisites')
    }
    if (request.portrait !== null) validateCharacterPortrait(request.portrait)
  }
}

export function assertPortraitCaptureOnly(active: boolean): void {
  if (active) throw new Error('Clear the staged portrait before advancing simulation or profiling gameplay')
}

export function validateGraphicsProfile(options: GraphicsProfileOptions): void {
  if (!options || !Number.isInteger(options.warmupFrames) || options.warmupFrames < 1 || options.warmupFrames > 3600
    || !Number.isInteger(options.sampleFrames) || options.sampleFrames < 1 || options.sampleFrames > 7200) {
    throw new Error('Graphics profile requires 1..3600 warm-up and 1..7200 active sample frames')
  }
  if (options.counters !== undefined && options.counters !== 'full' && options.counters !== 'disabled') {
    throw new Error('Unknown graphics counter mode')
  }
  const allowed = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space', 'KeyR'])
  let previous = -1
  for (const input of options.inputs ?? []) {
    if (!Number.isInteger(input.frame) || input.frame <= previous
      || input.frame >= options.warmupFrames + options.sampleFrames || !Array.isArray(input.keys)
      || input.keys.length > allowed.size || input.keys.some((key) => !allowed.has(key))) {
      throw new Error('Invalid, unordered, or unsupported graphics input schedule')
    }
    previous = input.frame
  }
}

export function createInstrumentedGraphicsRenderer(): {
  renderer: THREE.WebGLRenderer
  resources: GraphicsResources
  defaultSamples: number
} {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl2', {
    alpha: false, depth: true, stencil: false, antialias: true,
    premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance',
  })
  if (!context) throw new Error('Graphics diagnostics require a real WebGL2 context')
  const resources = new GraphicsResources(context)
  const defaultSamples: unknown = context.getParameter(context.SAMPLES)
  if (typeof defaultSamples !== 'number') {
    resources.dispose()
    throw new Error('WebGL did not report default framebuffer samples')
  }
  try {
    return {
      renderer: new THREE.WebGLRenderer({ canvas, context, antialias: true, powerPreference: 'high-performance' }),
      resources, defaultSamples,
    }
  } catch (error) {
    resources.dispose()
    throw error
  }
}

export class GraphicsDiagnostics {
  readonly meter: GraphicsFrameMeter
  readonly clock: GraphicsClock
  readonly api
  private readonly renderer: THREE.WebGLRenderer
  private readonly host: GraphicsDiagnosticHost
  private readonly defaultSamples: number
  private readonly stages: string[] = []
  private readonly rendererMetadata: object
  private lastFrame: GraphicsFrame | null = null
  private manualMode = true
  private disposed = false
  private portraitActive = false
  private portraitLabel: HTMLDivElement | null = null
  private record: {
    options: GraphicsProfileOptions
    frames: GraphicsFrame[]
    started: number
    finished: number | null
    resolve(value: object): void
    reject(error: Error): void
  } | null = null
  private readonly contextLost = () => this.fail(new Error('WebGL context lost during graphics diagnostics'))

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, resources: GraphicsResources,
    defaultSamples: number, clock: GraphicsClock, host: GraphicsDiagnosticHost) {
    this.renderer = renderer
    this.host = host
    this.defaultSamples = defaultSamples
    this.clock = clock
    this.meter = new GraphicsFrameMeter(renderer, scene, resources, undefined, () => host.subsystemRoots?.() ?? [])
    const gl = renderer.getContext()
    const debug: unknown = gl.getExtension('WEBGL_debug_renderer_info')
    const debugField = (key: string): string | null => {
      if (!debug || typeof debug !== 'object') return null
      const parameter: unknown = Reflect.get(debug, key)
      if (typeof parameter !== 'number') return null
      const value: unknown = gl.getParameter(parameter)
      return typeof value === 'string' ? value : null
    }
    this.rendererMetadata = {
      backend: 'THREE.WebGLRenderer / WebGL2',
      threeRevision: THREE.REVISION,
      userAgent: navigator.userAgent,
      renderer: debugField('UNMASKED_RENDERER_WEBGL'),
      vendor: debugField('UNMASKED_VENDOR_WEBGL'),
      version: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      contextAttributes: gl.getContextAttributes(),
      defaultFramebufferSamples: defaultSamples,
      gpuTimingExtension: this.meter.gpu.extension ? 'EXT_disjoint_timer_query_webgl2' : null,
      gpuTimingUnavailableReason: this.meter.gpu.unavailableReason,
    }
    this.api = Object.freeze({
      version: GRAPHICS_DIAGNOSTICS_VERSION,
      capabilities: Object.freeze({ characterPortrait: CHARACTER_PORTRAIT_VERSION, subsystemBudget: 1 }),
      snapshot: () => this.snapshot(),
      world: () => { this.assertUsable(); return this.host.world() },
      probe: (points: readonly { x: number; z: number }[]) => {
        this.assertManual()
        validateGraphicsProbe(points)
        return this.host.probe(points)
      },
      save: () => { this.assertManual(); return this.host.save() },
      stage: (request: GraphicsFixtureStage) => {
        this.assertManual()
        if (this.stages.length >= 64) throw new Error('Fixture prerequisite history is full; reload the fixture')
        validateGraphicsStage(request)
        this.host.stage(request)
        if (request.portrait !== undefined) {
          this.portraitActive = request.portrait !== null
          this.portraitLabel?.remove()
          this.portraitLabel = null
          if (request.portrait) {
            const label = document.createElement('div')
            label.id = 'graphics-character-portrait-label'
            label.textContent = `STAGED ${request.portrait.view === 'gameplay' ? 'GAMEPLAY VIEW' : 'PORTRAIT - NOT CAMERA COLLISION EVIDENCE'}: ${request.portrait.subject} | ${request.portrait.view} | ${request.portrait.pose}`
            label.style.cssText = 'position:fixed;left:12px;bottom:32px;z-index:10001;max-width:calc(100vw - 24px);padding:4px 8px;background:#111;color:#fff;font:12px monospace;pointer-events:none'
            document.body.append(label)
            this.portraitLabel = label
          }
        }
        this.stages.push(request.label)
        this.host.present()
        return this.snapshot()
      },
      render: (frames = 1) => {
        this.assertManual()
        this.assertFrameCount(frames)
        this.host.present()
        for (let index = 0; index < frames; index++) this.host.frame(0)
        return this.snapshot()
      },
      step: (frames = 1, deltaSeconds = 1 / 60) => {
        this.assertManual()
        assertPortraitCaptureOnly(this.portraitActive)
        this.assertFrameCount(frames)
        if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || deltaSeconds > 0.05) {
          throw new Error('Manual fixture step must be in (0, 0.05] seconds')
        }
        for (let index = 0; index < frames; index++) this.host.frame(deltaSeconds)
        return this.snapshot()
      },
      profile: (options: GraphicsProfileOptions) => this.profile(options),
      stop: () => {
        this.assertUsable()
        this.fail(new Error('Graphics profile cancelled explicitly'))
      },
    })
    if (Reflect.get(window, '__korovanyGraphics') !== undefined) {
      this.meter.dispose()
      resources.dispose()
      throw new Error('Another graphics diagnostic owner is already installed')
    }
    Object.defineProperty(window, '__korovanyGraphics', { configurable: true, value: this.api })
    renderer.domElement.addEventListener('webglcontextlost', this.contextLost)
  }

  get manual(): boolean { return this.manualMode }

  private assertUsable(): void {
    if (this.disposed) throw new Error('Graphics diagnostics are disposed')
  }

  private assertManual(): void {
    this.assertUsable()
    if (this.record || !this.manualMode) throw new Error('Cannot stage or manually step an active profile')
  }

  private assertFrameCount(frames: number): void {
    if (!Number.isInteger(frames) || frames < 1 || frames > 600) throw new Error('Fixture frames must be in 1..600')
  }

  private snapshot(): object {
    this.assertUsable()
    const canvas = this.renderer.domElement
    const rect = canvas.getBoundingClientRect()
    const width = canvas.width
    const height = canvas.height
    const inputs = this.host.subsystemInventory?.()
    const frameSize = this.lastFrame?.bufferDimensions
    const subsystemBudget = inputs ? graphicsSubsystemBudgetSnapshot(
      inputs, this.lastFrame, this.meter.subsystemSubmissions.sourceDetails(),
      this.meter.resources, this.renderer.properties,
      frameSize?.width === width && frameSize.height === height
        ? width * height * 4 * (1 + (this.defaultSamples > 1 ? this.defaultSamples : 0) + Math.max(1, this.defaultSamples)) : null,
    ) : null
    return {
      apiVersion: GRAPHICS_DIAGNOSTICS_VERSION, visualRevision: GRAPHICS_VISUAL_REVISION,
      manual: this.manualMode, stagedPrerequisites: [...this.stages],
      visualClock: { ...this.clock.options, currentTimeSeconds: this.clock.timeSeconds },
      renderer: this.rendererMetadata,
      viewport: { width: rect.width, height: rect.height, bufferWidth: width, bufferHeight: height,
        devicePixelRatio: window.devicePixelRatio, rendererPixelRatio: this.renderer.getPixelRatio() },
      accounting: this.meter.countersEnabled ? 'full' : 'unavailable: counter-disabled timing control',
      resources: this.meter.countersEnabled ? this.meter.resources.snapshot() : null,
      renderTargets: this.meter.countersEnabled ? this.meter.resources.targets() : null,
      defaultFramebufferEstimate: {
        width, height, samples: this.defaultSamples,
        colorResolveBytes: width * height * 4,
        multisampleColorBytes: this.defaultSamples > 1 ? width * height * 4 * this.defaultSamples : 0,
        depthBytes: width * height * 4 * Math.max(1, this.defaultSamples),
        excludes: 'Browser swapchain copies, tiling/alignment, shader/driver overhead; not measured VRAM',
      },
      lastFrame: this.lastFrame,
      subsystemBudget,
      runtime: this.host.snapshot(),
    }
  }

  private profile(options: GraphicsProfileOptions): Promise<object> {
    this.assertManual()
    assertPortraitCaptureOnly(this.portraitActive)
    validateGraphicsProfile(options)
    const runtime = this.host.runtime()
    if (runtime.paused || runtime.ended) throw new Error('Performance profiles require an active production run')
    if (options.counters === 'disabled') this.meter.disableCounters()
    else if (!this.meter.countersEnabled) throw new Error('Reload the fixture to restore complete allocation accounting')
    this.manualMode = false
    return new Promise((resolve, reject) => {
      this.record = {
        options: structuredClone(options), frames: [], started: performance.now(), finished: null, resolve, reject,
      }
      this.applyScheduledInput()
    })
  }

  private applyScheduledInput(): void {
    if (!this.record) return
    const next = this.record.options.inputs?.find((input) => input.frame === this.record?.frames.length)
    if (next) this.host.input(next.keys)
  }

  beginFrame(delta: number, source: 'active' | 'manual'): void {
    this.meter.begin(delta, source)
  }

  endFrame(): void {
    const phase = !this.record ? 'capture' :
      this.record.frames.length < this.record.options.warmupFrames ? 'warmup' : 'sample'
    this.lastFrame = this.meter.end(() => this.host.runtime(), phase)
    const runtime = this.lastFrame.runtime
    if (this.lastFrame.counterAgreement === false) {
      throw new Error(`Whole-frame GL/renderer counters disagree at frame ${this.lastFrame.id}`)
    }
    if (this.lastFrame.subsystems?.reconciled === false) {
      throw new Error(`Subsystem/whole-frame GL counters disagree at frame ${this.lastFrame.id}`)
    }
    if (!this.record) return
    this.record.frames.push(this.lastFrame)
    if (runtime.paused || runtime.ended) {
      this.fail(new Error('Production run paused or ended before the requested profile completed'))
      return
    }
    if (this.record.frames.length >= this.record.options.warmupFrames + this.record.options.sampleFrames) {
      this.manualMode = true
      this.record.finished = performance.now()
      this.host.input([])
    } else this.applyScheduledInput()
  }

  poll(): void {
    this.meter.gpu.poll()
    const record = this.record
    if (!record || record.finished === null) return
    if (this.meter.gpu.pendingCount && performance.now() - record.finished < 2500) return
    if (this.meter.gpu.pendingCount) this.meter.gpu.invalidate('timeout')
    this.record = null
    const report = {
      complete: true,
      measurement: 'Active production RAF update, camera, audio submission, renderer, shadows, ink and post; instrumentation overhead included',
      counterMode: this.meter.countersEnabled ? 'full' : 'disabled: native GL/renderer methods restored; CPU markers, runtime telemetry and GPU queries retained',
      wallDurationMs: record.finished - record.started,
      options: record.options,
      warmup: summarizeGraphicsFrames(record.frames.filter((frame) => frame.phase === 'warmup')),
      samples: summarizeGraphicsFrames(record.frames.filter((frame) => frame.phase === 'sample')),
      allFrames: summarizeGraphicsFrames(record.frames),
      frames: record.frames,
      snapshot: this.snapshot(),
    }
    record.resolve(report)
  }

  fail(error: Error): void {
    this.meter.abort()
    this.manualMode = true
    this.host.input([])
    if (this.record) {
      const record = this.record
      this.record = null
      record.reject(error)
    }
    console.error('Korovany graphics diagnostics:', error)
  }

  dispose(): void {
    if (this.disposed) return
    if (this.record) this.fail(new Error('Graphics engine disposed during a profile'))
    this.disposed = true
    this.portraitLabel?.remove()
    this.portraitLabel = null
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost)
    this.meter.dispose()
    Object.defineProperty(window, '__korovanyGraphicsLastDisposal', {
      configurable: true, value: this.meter.resources.snapshot(),
    })
    this.meter.resources.dispose()
    if (Reflect.get(window, '__korovanyGraphics') === this.api) Reflect.deleteProperty(window, '__korovanyGraphics')
  }
}
