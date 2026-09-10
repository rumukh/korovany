import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { GraphicsClock, graphicsClockOptions } from '../src/game/diagnostics/GraphicsClock.ts'
import { GraphicsResources, graphicsFormatBytes } from '../src/game/diagnostics/GraphicsResources.ts'
import { GraphicsGpuTimer, type GraphicsGpuSample } from '../src/game/diagnostics/GraphicsGpuTimer.ts'
import {
  GraphicsFrameMeter, graphicsDistribution, summarizeGraphicsFrames, type GraphicsRuntimeFrame,
} from '../src/game/diagnostics/GraphicsFrameMeter.ts'
import { MethodPatch } from '../src/game/diagnostics/MethodPatch.ts'
import {
  validateGraphicsProfile, validateGraphicsStage, validateGraphicsProbe,
} from '../src/game/diagnostics/GraphicsDiagnostics.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import { createWeatherMix } from '../src/game/world/WorldEnvironment.ts'
import { ActorBudget, MAX_ACTORS } from '../src/game/world/ActorBudget.ts'
import { StylizedArtLibrary } from '../src/game/art/StylizedArtLibrary.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

function glDouble(supported = false) {
  let currentQuery: object | null = null
  let resultReads = 0
  let deletes = 0
  let creates = 0
  let disjoint = false
  let lost = false
  let ready = false
  const extension = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb }
  const noop = (..._args: unknown[]) => {}
  // A deliberately small WebGL test double. The production observer installs the
  // real method list on this object, so a missing method fails rather than hiding.
  const gl = Object.assign(Object.create(null), {
    CURRENT_QUERY: 0x8865, QUERY_RESULT_AVAILABLE: 0x8867, QUERY_RESULT: 0x8866,
    getExtension: (name: string) => supported && name === 'EXT_disjoint_timer_query_webgl2' ? extension : null,
    isContextLost: () => lost,
    getParameter: () => disjoint,
    createQuery: () => { creates++; return {} },
    deleteQuery: () => { deletes++ },
    beginQuery: (_target: number, query: object) => { currentQuery = query },
    endQuery: () => { currentQuery = null },
    getQuery: () => currentQuery,
    getQueryParameter: (_query: object, parameter: number) => {
      if (parameter === 0x8867) return ready
      resultReads++
      assert.ok(ready, 'The timer must never fetch an unavailable GPU result')
      return 2_500_000
    },
    bindBuffer: noop, bindVertexArray: noop, bufferData: noop, activeTexture: noop, bindTexture: noop,
    texStorage2D: noop, texStorage3D: noop, texImage2D: noop, texImage3D: noop,
    compressedTexImage2D: noop, compressedTexImage3D: noop, copyTexImage2D: noop, generateMipmap: noop,
    bindRenderbuffer: noop, renderbufferStorage: noop, renderbufferStorageMultisample: noop,
    framebufferTexture2D: noop, framebufferTextureLayer: noop, framebufferRenderbuffer: noop,
    drawArrays: noop, drawElements: noop, drawArraysInstanced: noop, drawElementsInstanced: noop,
    drawRangeElements: noop, readPixels: noop, blitFramebuffer: noop,
  })
  for (const suffix of ['Buffer', 'Texture', 'Renderbuffer', 'Framebuffer', 'Program', 'Shader', 'VertexArray']) {
    gl[`create${suffix}`] = () => ({})
    gl[`delete${suffix}`] = noop
  }
  return {
    gl, extension,
    ready: (value: boolean) => { ready = value },
    lost: (value: boolean) => { lost = value },
    disjoint: (value: boolean) => { disjoint = value },
    counts: () => ({ resultReads, creates, deletes }),
  }
}

test('diagnostics are opt-in and reject malformed seed, time and weather', () => {
  assert.equal(graphicsClockOptions(''), null)
  assert.equal(graphicsClockOptions('?graphicsDiagnostics=true&visualSeed=bad'), null)
  assert.deepEqual(graphicsClockOptions('?graphicsDiagnostics=1'), { seed: 20260906, timeSeconds: 0, weather: null })
  for (const suffix of ['visualSeed=-1', 'visualSeed=1.5', 'visualSeed=4294967296',
    'visualTime=NaN', 'visualTime=-1', 'visualWeather=hail']) {
    assert.throws(() => graphicsClockOptions(`?graphicsDiagnostics=1&${suffix}`))
  }
})

test('fixture clock and art streams repeat independently of gameplay streams', () => {
  const first = new GraphicsClock({ seed: 17, timeSeconds: 140, weather: 'snow' })
  const second = new GraphicsClock({ seed: 17, timeSeconds: 140, weather: 'snow' })
  const gameplay = new RandomStream(deriveSeed(17, 'gameplay:combat'))
  const state = gameplay.getState()
  const rainA = first.createRandom('rain')
  const rainB = second.createRandom('rain')
  const snow = first.createRandom('snow')
  const rain = Array.from({ length: 50 }, rainA)
  assert.deepEqual(rain, Array.from({ length: 50 }, rainB))
  assert.notDeepEqual(rain, Array.from({ length: 50 }, snow))
  assert.deepEqual(Array.from({ length: 50 }, () => first.randomWeather()),
    Array.from({ length: 50 }, () => second.randomWeather()))
  first.advance(0.025)
  assert.equal(first.timeSeconds, 140.025)
  assert.equal(second.timeSeconds, 140)
  assert.equal(gameplay.getState(), state)
  assert.throws(() => first.advance(-1))
  assert.throws(() => first.advance(Number.NaN))
})

test('actual engine visual weather hooks do not overwrite simulation elapsed, weather, or gameplay RNG', () => {
  const gameplay = new RandomStream(29)
  const mix = createWeatherMix('clear')
  let originalWeatherDraws = 0
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    elapsed: 37, weatherWeights: mix, weatherTarget: 'clear',
    generatedRngStreams: { combat: gameplay },
    graphicsClock: new GraphicsClock({ seed: 47, timeSeconds: 136.8, weather: 'rain' }),
    weatherRng: () => { originalWeatherDraws++; return 0.5 },
  })
  const original = { elapsed: engine.elapsed, mix: { ...mix }, rng: gameplay.getState() }
  assert.equal(engine.visualElapsed, 136.8)
  const rainScale = engine.weightedWeatherValue('sunScale')
  engine.updateWeatherWeights(1 / 60)
  for (let i = 0; i < 10; i++) engine.randomWeatherRange(0, 1)
  assert.deepEqual({ elapsed: engine.elapsed, mix, rng: gameplay.getState() }, original)
  assert.equal(originalWeatherDraws, 0)
  engine.graphicsClock = null
  assert.equal(engine.visualElapsed, 37)
  assert.notEqual(engine.weightedWeatherValue('sunScale'), rainScale, 'The visual override must actually have an effect')
  assert.equal(engine.randomWeatherRange(10, 20), 15)
  assert.equal(originalWeatherDraws, 1)
})

test('actual production logical-frame hook preserves hit stop, update order, paused work and manual labels', () => {
  const events: unknown[] = []
  const clock = new GraphicsClock({ seed: 1, timeSeconds: 0, weather: null })
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    paused: false, ended: false, hitStopRemaining: 0.02, graphicsClock: clock,
    graphicsDiagnostics: {
      beginFrame: (delta: number, source: string) => events.push(['begin', delta, source]),
      meter: { endUpdate: () => events.push('update-end') },
      endFrame: () => events.push('frame-end'),
    },
    update: (delta: number) => events.push(['update', delta]),
    updateCameraEffects: (delta: number) => events.push(['accents', delta]),
    updateCamera: () => events.push('camera'),
    characterPresenters: new Set([{ updateLod: () => events.push('character-lod') }]),
    creaturePresenters: new Set([{ updateLod: () => events.push('creature-lod') }]),
    camera: new THREE.Camera(), audioListenerRight: new THREE.Vector3(),
    audio: { setListener: () => events.push('audio') }, updateMusicContext: () => events.push('music'),
    postProcessor: { render: () => events.push('render') },
  })
  engine.renderLogicalFrame(0.05, 'active')
  assert.deepEqual(events, [
    ['begin', 0.05, 'active'], ['update', 0.030000000000000002], ['accents', 0.05],
    'camera', 'character-lod', 'creature-lod', 'audio', 'music', 'update-end', 'render', 'frame-end',
  ])
  assert.equal(engine.hitStopRemaining, 0)
  assert.equal(clock.timeSeconds, 0.05)
  events.length = 0
  engine.paused = true
  engine.renderLogicalFrame(0.05, 'manual')
  assert.deepEqual(events, [
    ['begin', 0.05, 'manual'], 'camera', 'character-lod', 'creature-lod', 'audio', 'music', 'update-end', 'render', 'frame-end',
  ])
  assert.equal(clock.timeSeconds, 0.05)
})

test('staged prerequisites are validated before moving gameplay roots', () => {
  assert.throws(() => validateGraphicsStage({ label: '' }))
  assert.throws(() => validateGraphicsStage({ label: 'test', player: { x: Number.NaN, y: 0, z: 0 } }))
  assert.throws(() => validateGraphicsStage({ label: 'test', camera: { yaw: 0, pitch: 100 } }))
  assert.throws(() => validateGraphicsStage({
    label: 'test', companions: [
      { id: 'duplicate', position: { x: 0, y: 0, z: 0 } },
      { id: 'duplicate', position: { x: 1, y: 0, z: 0 } },
    ],
  }))
  const player = new THREE.Group()
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    graphicsDiagnostics: null, player,
    actors: [], generatedWorld: { bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } },
  })
  assert.throws(() => engine.stageGraphicsFixture({ label: 'test', player: { x: 5, y: 0, z: 0 } }))
  engine.graphicsDiagnostics = { manual: true }
  assert.throws(() => engine.stageGraphicsFixture({ label: 'test', player: { x: 15, y: 0, z: 0 } }))
  assert.throws(() => engine.stageGraphicsFixture({
    label: 'test', player: { x: 5, y: 0, z: 0 }, companions: [{ id: 'missing', position: { x: 0, y: 0, z: 0 } }],
  }))
  assert.deepEqual(player.position.toArray(), [0, 0, 0])
})

test('crowd hook fills the actual NPC ledger, rejects the 26th slot and reports an unwalkable prerequisite', () => {
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    faction: 'guard', player: new THREE.Group(), actorBudget: new ActorBudget(),
    actors: Array.from({ length: 3 }, () => ({
      budgetCategory: 'squad', mesh: new THREE.Group(), home: new THREE.Vector3(), wanderTarget: new THREE.Vector3(),
    })),
    isWalkablePosition: () => true,
    groundHeightAt: () => 0,
    spawnActor: (_allegiance: string, _role: string, _x: number, _z: number, _index: number, options: { budget: string }) => {
      engine.claimActorSlot(options.budget)
      engine.actors.push({
        budgetCategory: options.budget, mesh: new THREE.Group(), home: new THREE.Vector3(), wanderTarget: new THREE.Vector3(),
      })
    },
  })
  engine.stageGraphicsCrowd()
  assert.equal(engine.actors.length, MAX_ACTORS)
  assert.equal(engine.actorBudget.total, MAX_ACTORS)
  assert.equal(engine.reserveActorSlots('ambient', 1), false)
  engine.actors.length = 3
  engine.isWalkablePosition = () => false
  assert.throws(() => engine.stageGraphicsCrowd(), /walkable crowd/)
  assert.equal(engine.actors.length, 3)
})

test('resource ledger counts storage rather than resource objects, including depth, MSAA, mips and release', () => {
  const { gl } = glDouble()
  const original = gl.bufferData
  const ledger = new GraphicsResources(gl)
  const buffer = gl.createBuffer()
  gl.bindBuffer(0x8892, buffer)
  gl.bufferData(0x8892, new Float32Array(16), 0x88e4)
  assert.equal(ledger.snapshot().bufferBytes, 64)
  gl.bufferData(0x8892, new Float32Array(16), 0x88e4, 2, 4)
  assert.equal(ledger.snapshot().bufferBytes, 16)

  const color = gl.createTexture()
  gl.bindTexture(0x0de1, color)
  gl.texStorage2D(0x0de1, 4, 0x8058, 8, 4)
  gl.framebufferTexture2D(0x8d40, 0x8ce0, 0x0de1, color, 0)
  assert.equal(ledger.snapshot().textureBytes, 172)
  const beforeMips = ledger.snapshot().allocatedBytes
  gl.generateMipmap(0x0de1)
  assert.equal(ledger.snapshot().allocatedBytes, beforeMips, 'Generating already allocated mips is not new storage')
  const depth = gl.createRenderbuffer()
  gl.bindRenderbuffer(0x8d41, depth)
  gl.renderbufferStorageMultisample(0x8d41, 4, 0x81a6, 8, 4)
  gl.framebufferRenderbuffer(0x8d40, 0x8d00, 0x8d41, depth)
  assert.equal(ledger.snapshot().renderbufferBytes, 512)
  assert.equal(ledger.snapshot().renderTargetBytes, 684)
  assert.equal(ledger.snapshot().trackedBytes, 700)
  gl.deleteTexture(color)
  gl.deleteRenderbuffer(depth)
  gl.deleteBuffer(buffer)
  assert.equal(ledger.snapshot().trackedBytes, 0)
  assert.equal(ledger.snapshot().allocatedBytes, ledger.snapshot().releasedBytes)
  ledger.dispose()
  ledger.dispose()
  assert.equal(gl.bufferData, original)
})

test('resource ledger deduplicates GL handles and covers cube faces, array layers, generated mips and unknown formats', () => {
  const { gl } = glDouble()
  const ledger = new GraphicsResources(gl)
  const cube = gl.createTexture()
  gl.bindTexture(0x8513, cube)
  gl.texStorage2D(0x8513, 3, 0x881a, 4, 4)
  assert.equal(ledger.snapshot().textureBytes, 1008)
  const array = gl.createTexture()
  gl.bindTexture(0x8c1a, array)
  gl.texStorage3D(0x8c1a, 3, 0x8229, 4, 4, 5)
  assert.equal(ledger.snapshot().textureBytes, 1008 + 105, 'Array layers do not shrink with mip level')
  const image = gl.createTexture()
  gl.bindTexture(0x0de1, image)
  gl.texImage2D(0x0de1, 0, 0x1908, 0x1908, 0x1401, { width: 8, height: 4 })
  gl.generateMipmap(0x0de1)
  assert.equal(ledger.snapshot().textureBytes, 1008 + 105 + 172)
  gl.framebufferTexture2D(0x8d40, 0x8ce0, 0x0de1, image, 0)
  gl.framebufferTexture2D(0x8d40, 0x8ce0, 0x0de1, image, 0)
  assert.equal(ledger.snapshot().renderTargetBytes, 172)
  gl.texStorage2D(0x0de1, 1, 0xdead, 10, 10)
  assert.deepEqual(ledger.snapshot().unknownFormats, [0xdead], 'Unknown sizes must not masquerade as complete accounting')
  assert.equal(graphicsFormatBytes(0xdead), null)
  ledger.dispose()
})

test('resource ledger reports untracked binds and handles VAO-local index-buffer storage', () => {
  const { gl } = glDouble()
  const ledger = new GraphicsResources(gl)
  assert.throws(() => gl.bufferData(0x8892, 16, 0x88e4), /untracked or unbound/)
  const vao = gl.createVertexArray()
  const first = gl.createBuffer()
  const second = gl.createBuffer()
  gl.bindBuffer(0x8893, first)
  gl.bufferData(0x8893, 12, 0x88e4)
  gl.bindVertexArray(vao)
  gl.bindBuffer(0x8893, second)
  gl.bufferData(0x8893, 18, 0x88e4)
  gl.bindVertexArray(null)
  gl.bufferData(0x8893, 24, 0x88e4)
  assert.equal(ledger.snapshot().bufferBytes, 42)
  ledger.dispose()
})

test('GPU timing is unavailable without the actual extension and never invents a duration', () => {
  const fake = glDouble()
  const timer = new GraphicsGpuTimer(fake.gl)
  const sample: GraphicsGpuSample = { gpuMs: null, gpuStatus: 'pending' }
  timer.begin(sample)
  timer.end()
  timer.poll()
  assert.deepEqual(sample, { gpuMs: null, gpuStatus: 'unavailable' })
  assert.equal(fake.counts().creates, 0)
  assert.match(timer.unavailableReason ?? '', /not exposed/)
  timer.dispose()
})

test('GPU queries are bounded, asynchronous, disjoint-aware and fully disposed', () => {
  const fake = glDouble(true)
  const timer = new GraphicsGpuTimer(fake.gl, 2)
  const samples: GraphicsGpuSample[] = Array.from({ length: 4 }, () => ({ gpuMs: null, gpuStatus: 'pending' }))
  timer.begin(samples[0]); timer.end()
  timer.begin(samples[1]); timer.end()
  timer.begin(samples[2]); timer.end()
  assert.equal(samples[2].gpuStatus, 'queue-full')
  assert.equal(fake.counts().resultReads, 0)
  fake.ready(true)
  timer.poll()
  assert.equal(samples[0].gpuMs, 2.5)
  assert.equal(samples[1].gpuMs, 2.5)
  fake.ready(false)
  timer.begin(samples[3]); timer.end()
  fake.disjoint(true)
  timer.poll()
  assert.equal(samples[3].gpuMs, null)
  assert.equal(samples[3].gpuStatus, 'disjoint')
  timer.dispose()
  assert.deepEqual(fake.counts(), { creates: 2, deletes: 2, resultReads: 2 })
  assert.throws(() => timer.begin(samples[0]), /disposed/)
})

test('whole-frame counters include scene, instanced ink, shadows, post and restore auto-reset', () => {
  const { gl } = glDouble()
  const ledger = new GraphicsResources(gl)
  const scene = new THREE.Scene()
  const renderer = Object.assign(Object.create(null), {
    info: {
      autoReset: true, render: { calls: 0, triangles: 0, lines: 0, points: 0 },
      reset() { Object.assign(this.render, { calls: 0, triangles: 0, lines: 0, points: 0 }) },
    },
    getContext: () => gl,
    render: (_scene: object, _camera: THREE.Camera) => {},
    renderBufferDirect: (_camera: THREE.Camera, _scene: object | null, _geometry: THREE.BufferGeometry,
      _material: THREE.Material, _object: THREE.Object3D, _group: unknown) => {},
  })
  const camera = new THREE.Camera()
  const art = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  const library = new StylizedArtLibrary({ ink: { player: 0, enemy: 0, interactable: 0, landmark: 0 } })
  const binding = library.applyOutline(art, 'enemy')
  const shell = art.children[0]
  assert.ok(shell, 'The ink control must contain an actual production outline shell')
  renderer.renderBufferDirect = (_camera: THREE.Camera, _scene: object | null, _geometry: THREE.BufferGeometry,
    _material: THREE.Material, object: THREE.Object3D) => {
    const instances = object === shell ? 3 : 1
    gl.drawElementsInstanced(0x0004, 36, 0x1403, 0, instances)
    renderer.info.render.calls++
    renderer.info.render.triangles += 12 * instances
  }
  renderer.render = (root: object) => {
    if (root === scene) {
      renderer.renderBufferDirect(camera, null, art.geometry, art.material, art, null)
      renderer.renderBufferDirect(camera, scene, art.geometry, art.material, art, null)
      renderer.renderBufferDirect(camera, scene, art.geometry, art.material, shell, null)
    } else {
      gl.drawArrays(0x0004, 0, 3)
      renderer.info.render.calls++
      renderer.info.render.triangles++
    }
  }
  let time = 0
  const meter = new GraphicsFrameMeter(renderer, scene, ledger, () => time)
  const runtime: GraphicsRuntimeFrame = {
    elapsed: 1, paused: false, ended: false, health: 100, npcCount: 25, aliveNpcs: 25,
    movingNpcs: 8, actingNpcs: 2, region: 'a', visibleRegions: ['a'], simulatedRegions: ['a'],
  }
  meter.begin(1 / 60, 'active')
  time = 1; meter.beginStreaming()
  time = 3; meter.endStreaming()
  time = 4; meter.endUpdate()
  renderer.render(scene)
  renderer.render(new THREE.Scene())
  renderer.render(new THREE.Scene())
  time = 7
  const frame = meter.end(runtime, 'sample')
  assert.ok(frame.draws)
  assert.deepEqual(frame.total, { calls: 5, triangles: 62, lines: 0, points: 0 })
  assert.equal(frame.draws.shadow.triangles, 12)
  assert.equal(frame.draws.ink.triangles, 36)
  assert.equal(frame.draws.post.triangles, 2)
  assert.equal(frame.counterAgreement, true)
  assert.equal(frame.updateMs, 4)
  assert.equal(frame.submissionMs, 3)
  assert.equal(frame.streamingMs, 2)
  assert.equal(summarizeGraphicsFrames([frame]).at25NpcCapFrames, 1)
  meter.begin(0, 'manual'); meter.endUpdate()
  renderer.render(scene)
  renderer.info.render.calls = 1
  renderer.info.render.triangles = 1
  const broken = meter.end(runtime, 'capture')
  assert.equal(broken.counterAgreement, false, 'The final one-triangle proxy must be detected')
  assert.equal(summarizeGraphicsFrames([broken]).frameTimeMs, null, 'Manual renders are not FPS evidence')
  const nativeDraw = gl.drawElementsInstanced
  meter.disableCounters()
  assert.notEqual(gl.drawElementsInstanced, nativeDraw, 'The wrappers are removed, not left running with a boolean guard')
  assert.equal(renderer.info.autoReset, true)
  assert.equal(ledger.snapshot().trackingActive, false)
  meter.begin(1 / 60, 'active'); meter.endUpdate()
  renderer.render(scene)
  const control = meter.end(runtime, 'sample')
  assert.equal(control.total, null)
  assert.equal(control.resources, null)
  assert.equal(control.counterAgreement, null)
  assert.equal(summarizeGraphicsFrames([control]).calls, null)
  assert.equal(summarizeGraphicsFrames([control]).counterUnavailableFrames, 1)
  meter.dispose()
  assert.equal(renderer.info.autoReset, true)
  library.releaseOutline(binding)
  library.dispose()
  art.geometry.dispose()
  art.material.dispose()
  ledger.dispose()
})

test('profile bounds, nearest-rank distributions and patch ownership have negative controls', () => {
  validateGraphicsProbe([{ x: 1, z: 2 }])
  assert.throws(() => validateGraphicsProbe([]))
  assert.throws(() => validateGraphicsProbe([{ x: Number.NaN, z: 0 }]))
  assert.throws(() => validateGraphicsProbe(Array.from({ length: 257 }, () => ({ x: 0, z: 0 }))))
  validateGraphicsProfile({ warmupFrames: 60, sampleFrames: 240, inputs: [{ frame: 60, keys: ['KeyW'] }] })
  assert.throws(() => validateGraphicsProfile({ warmupFrames: 0, sampleFrames: 240 }))
  assert.throws(() => validateGraphicsProfile({ warmupFrames: 60, sampleFrames: 10000 }))
  assert.throws(() => validateGraphicsProfile({ warmupFrames: 60, sampleFrames: 240, inputs: [{ frame: 0, keys: ['KeyF'] }] }))
  assert.throws(() => validateGraphicsProfile({ warmupFrames: 60, sampleFrames: 240,
    inputs: [{ frame: 2, keys: [] }, { frame: 1, keys: [] }] }))
  assert.equal(graphicsDistribution([]), null)
  assert.throws(() => graphicsDistribution([0, Number.NaN]))
  assert.deepEqual(graphicsDistribution([1, 3, 2, 100]), {
    count: 4, min: 1, max: 100, mean: 26.5, p50: 2, p95: 100, p99: 100,
  })
  const patches = new MethodPatch()
  const target = { method: () => 7 }
  const original = target.method
  patches.wrap(target, 'method', (call) => Number(call()) + 1)
  assert.equal(target.method(), 8)
  patches.dispose()
  assert.equal(target.method, original)
  assert.throws(() => patches.wrap(target, 'method', (call) => call()), /disposed/)
  const conflict = new MethodPatch()
  conflict.wrap(target, 'method', (call) => call())
  target.method = () => 9
  assert.throws(() => conflict.dispose(), /restoration failed/)
  assert.equal(target.method(), 9, 'Never overwrite a replacement owned by another instrument')
})
