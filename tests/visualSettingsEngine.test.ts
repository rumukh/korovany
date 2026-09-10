import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { BloomPostProcessor } from '../src/game/BloomPostProcessor.ts'
import type { GraphicsFixtureStage } from '../src/game/diagnostics/GraphicsDiagnostics.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { createWeatherMix } from '../src/game/world/WorldEnvironment.ts'
import { resolveVisualPolicy, type VisualQualityPolicy } from '../src/game/visualPolicy.ts'
import { DEFAULT_VISUAL_SETTINGS, type FoliageQuality } from '../src/game/visualSettings.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

interface VisualEngineProbe {
  visualPolicy: VisualQualityPolicy
  paused: boolean
  elapsed: number
  body: { leftArm: string; rightLeg: string }
  companions: readonly string[]
  cameraObstacles: readonly object[]
  getVisualPolicy(): VisualQualityPolicy
  graphicsRuntimeSnapshot(): { visualPolicy: VisualQualityPolicy }
  setBloomEnabled(enabled: boolean): void
  setInkOutlinesEnabled(enabled: boolean): void
  setFoliageQuality(quality: FoliageQuality): void
  setWeatherEnabled(enabled: boolean): void
  setDynamicDayNight(enabled: boolean): void
  setScreenShakeEnabled(enabled: boolean): void
  stageGraphicsFixture(request: GraphicsFixtureStage): void
}

function fixture() {
  const calls: [string, unknown][] = []
  const forbidden = () => { assert.fail('A visual setting attempted a campaign/rig lifecycle operation') }
  const engine: VisualEngineProbe = Object.assign(Object.create(GameEngine.prototype), {
    visualPolicy: resolveVisualPolicy(DEFAULT_VISUAL_SETTINGS),
    reducedMotion: false, screenShakeEnabled: true, inkOutlinesEnabled: true,
    groundFoliageQuality: 'high', weatherEnabled: true, dynamicDayNight: true,
    player: { position: { x: 4, z: 5 } }, actors: [{ id: 'friendly' }, { id: 'hostile' }],
    renderer: { domElement: { dataset: {} } }, weatherTarget: 'overcast',
    paused: true, elapsed: 77, body: { leftArm: 'missing', rightLeg: 'prosthetic' },
    companions: ['companion-0', 'companion-1', 'companion-2'],
    cameraObstacles: [{ id: 'gameplay-sight-obstacle' }],
    lightningFlash: 0, thunderDelay: -1, hitStopRemaining: 0,
    postProcessor: { setEnabled: (value: boolean) => calls.push(['post', value]) },
    generatedWorld: {
      setDecorationDensity: (value: number) => calls.push(['foliage', value]),
      setOutlineDressing: (value: boolean) => calls.push(['world-ink', value]),
    },
    updatePlayerOutlineVisibility() { calls.push(['player-ink', null]) },
    updateActorOutlineVisibility(actor: { id: string }) { calls.push(['actor-ink', actor.id]) },
    updateInteractableOutlines() { calls.push(['interaction-ink', null]) },
    zoneAtPosition: () => 'neutral',
    setWeatherTarget(kind: string, snap: boolean) { calls.push(['weather-target', { kind, snap }]) },
    applyGroundWeather() { calls.push(['ground-weather', null]) },
    updateDayNight() { calls.push(['day-night', null]) },
    updateWeather(delta: number) { calls.push(['weather', delta]) },
    updateAtmosphere(delta: number) { calls.push(['atmosphere', delta]) },
    resetCameraMotion() { calls.push(['camera-reset', null]) },
    setPaused: forbidden, saveGeneratedRun: forbidden, createCharacter: forbidden,
    start: forbidden, destroy: forbidden,
  })
  return { engine, calls }
}

test('the real engine getters retain a frozen launch policy and existing setters refresh it', () => {
  const { engine, calls } = fixture()
  const first = engine.getVisualPolicy()
  assert.equal(engine.getVisualPolicy(), first, 'getter must not allocate per frame')
  engine.setBloomEnabled(false)
  assert.notEqual(engine.getVisualPolicy(), first)
  assert.equal(first.post.enabled, true, 'published snapshots must not be mutated')
  assert.equal(engine.getVisualPolicy().preferences.bloomEnabled, false)
  assert.equal(engine.getVisualPolicy().post.enabled, false)
  assert.deepEqual(calls, [['post', false]])
  engine.setBloomEnabled(true)
  assert.equal(engine.getVisualPolicy().post.enabled, true)
  assert.deepEqual(calls.at(-1), ['post', true])
})

function postFixture(policy: VisualQualityPolicy) {
  const scene = new THREE.Scene()
  let target: THREE.WebGLRenderTarget | null = null
  const clearColor = new THREE.Color(0)
  const calls = { scene: 0, post: 0 }
  const renderer = {
    autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
    outputColorSpace: THREE.SRGBColorSpace, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1,
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(800, 600),
    getPixelRatio: () => 1,
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next },
    getClearColor: (out: THREE.Color) => out.copy(clearColor),
    getClearAlpha: () => 1,
    setClearColor: (color: THREE.ColorRepresentation) => { clearColor.set(color) },
    clear() {},
    render: (object: THREE.Object3D) => { if (object === scene) calls.scene++; else calls.post++ },
  }
  const post = new BloomPostProcessor(renderer as never, scene, new THREE.PerspectiveCamera(),
    policy.post.enabled, { enhanced: policy.mode === 'enhanced', antialiasing: policy.post.antialiasing })
  const { engine } = fixture()
  Object.assign(engine, { visualPolicy: policy, postProcessor: post })
  const render = (expectedPost: number) => {
    calls.scene = calls.post = 0
    // Execute the real composer/pass code against a CPU render sink. These are
    // renderer invocations, not a WebGL performance or shader-compilation claim.
    post.render()
    assert.equal(calls.scene, 1)
    assert.equal(calls.post, expectedPost)
    assert.equal(post.getDebugSnapshot().composer, expectedPost !== 0)
  }
  return { engine, post, render }
}

test('real bloom toggles configure the actual AA pipeline for off-at-launch, re-enable, low and legacy policies', () => {
  for (const visualMode of ['legacy', 'enhanced'] as const) {
    for (const visualQuality of ['high', 'balanced', 'low'] as const) {
      for (const bloomEnabled of [false, true]) {
        const policy = resolveVisualPolicy({ visualMode, visualQuality, bloomEnabled })
        const { engine, post, render } = postFixture(policy)
        try {
          render(policy.post.enabled ? policy.post.antialiasing === 'fxaa' ? 16 : 15 : 0)
          for (const enabled of [true, false, true]) {
            engine.setBloomEnabled(enabled)
            const next = engine.getVisualPolicy().post
            render(next.enabled ? next.antialiasing === 'fxaa' ? 16 : 15 : 0)
            assert.equal(post.getDebugSnapshot().passes.includes('fxaa'), next.antialiasing === 'fxaa')
            assert.equal(engine.paused, true)
            assert.equal(engine.elapsed, 77)
          }
        } finally { post.dispose() }
      }
    }
  }
})

test('a labelled diagnostic no-AA override persists for comparison and resets on an explicit live bloom policy update', () => {
  const { engine, post, render } = postFixture(resolveVisualPolicy({
    visualMode: 'enhanced', visualQuality: 'balanced', bloomEnabled: false,
  }))
  Object.assign(engine, {
    graphicsDiagnostics: { manual: true }, actors: [],
    player: new THREE.Group(),
    generatedWorld: {
      bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, update() {},
    },
    syncGeneratedRegions() {}, refreshGeneratedCameraObstacles() {},
  })
  try {
    render(0)
    engine.setBloomEnabled(true)
    render(16)
    engine.stageGraphicsFixture({ label: 'Explicit CPU same-post no-AA comparison', antialiasing: 'none' })
    assert.equal(engine.getVisualPolicy().post.antialiasing, 'fxaa', 'A diagnostic override is not a persisted user preference')
    render(15)
    post.setSize(800, 600)
    render(15)
    engine.setBloomEnabled(true)
    render(16)
    engine.stageGraphicsFixture({ label: 'Second explicit AA comparison', antialiasing: 'none' })
    engine.setBloomEnabled(false)
    render(0)
    engine.setBloomEnabled(true)
    render(16)
    assert.equal(engine.paused, true)
    assert.equal(engine.elapsed, 77)
  } finally { post.dispose() }
})

test('existing live ink and foliage setters still affect current world and actor surfaces', () => {
  const { engine, calls } = fixture()
  engine.setInkOutlinesEnabled(false)
  assert.equal(engine.getVisualPolicy().ink.enabled, false)
  assert.deepEqual(calls, [
    ['player-ink', null], ['actor-ink', 'friendly'], ['actor-ink', 'hostile'],
    ['interaction-ink', null], ['world-ink', false],
  ])
  engine.setFoliageQuality('low')
  assert.equal(engine.getVisualPolicy().density.foliage, 0.55)
  assert.deepEqual(calls.at(-1), ['foliage', 0.55])
  engine.setFoliageQuality('off')
  assert.deepEqual(calls.at(-1), ['foliage', 0])
  engine.setFoliageQuality('high')
  assert.deepEqual(calls.at(-1), ['foliage', 1])
})

test('new policy bookkeeping leaves existing environment update semantics and paused campaign intact', () => {
  const { engine, calls } = fixture()
  const body = engine.body
  const companions = engine.companions
  const sight = engine.cameraObstacles
  engine.setWeatherEnabled(false)
  assert.equal(engine.getVisualPolicy().density.weather, 0)
  assert.equal(engine.getVisualPolicy().preferences.weatherEnabled, false)
  assert.deepEqual(calls.map(([name]) => name), [
    'day-night', 'weather', 'atmosphere',
  ])
  calls.length = 0
  engine.setDynamicDayNight(false)
  assert.equal(engine.getVisualPolicy().preferences.dynamicDayNight, false)
  assert.deepEqual(calls.map(([name]) => name), ['day-night', 'weather', 'atmosphere'])
  engine.setScreenShakeEnabled(false)
  assert.equal(engine.getVisualPolicy().cameraEffects, false)
  assert.equal(engine.getVisualPolicy().preferences.screenShakeEnabled, false)
  assert.equal(engine.paused, true)
  assert.equal(engine.elapsed, 77)
  assert.equal(engine.body, body)
  assert.equal(engine.companions, companions)
  assert.equal(engine.cameraObstacles, sight)
  assert.equal(Reflect.has(GameEngine.prototype, 'setVisualMode'), false)
  assert.equal(Reflect.has(GameEngine.prototype, 'setVisualQuality'), false)
})

test('combined diagnostic snapshots report the actual policy without bypassing unavailable preview', () => {
  const { engine, calls } = fixture()
  const combat = new RandomStream(20260906)
  const weather = createWeatherMix('clear')
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  const player = new THREE.Group()
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { pointerLockElement: null },
  })
  Object.assign(engine, {
    visualPolicy: resolveVisualPolicy(
      { visualMode: 'enhanced', visualQuality: 'low' }, { enhancedAvailable: false },
    ),
    faction: 'guard', player, actors: [], scene, camera, cameraYaw: 0, cameraPitch: 0.38,
    ended: false, health: 77, pointerFallback: true, nightFactor: 0,
    renderer: { domElement: {} },
    cameraVisibility: { debug: {} },
    artLibrary: { getRenderBindingStats: () => ({ sources: 0, ownedGeometries: 0, geometryBytes: 0, attributeBytes: 0 }) },
    generatedBlueprint: { seed: 20260906, fingerprint: 'unchanged-world' },
    generatedRngStreams: { combat }, weatherTarget: 'clear', weatherWeights: weather,
    generatedWorld: {
      currentRegionId: 'region-4-0',
      regions: {
        getVisibleRegionIds: () => ['region-4-0'],
        getSimulatedRegionIds: () => ['region-4-0'],
      },
      getDebugSnapshot: () => ({ currentRegionId: 'region-4-0' }),
    },
  })
  Object.assign(Reflect.get(engine, 'postProcessor'), { getDebugSnapshot: () => ({ composer: false }) })
  const originalRng = combat.getState()
  const originalWeather = { ...weather }
  try {
    const before = engine.graphicsRuntimeSnapshot()
    assert.equal(before.visualPolicy, engine.getVisualPolicy())
    assert.equal(before.visualPolicy.preferences.visualMode, 'enhanced')
    assert.equal(before.visualPolicy.preferences.visualQuality, 'low')
    assert.equal(before.visualPolicy.mode, 'legacy')
    assert.equal(before.visualPolicy.previewAvailable, false)
    assert.equal(before.visualPolicy.render.maxPixels, null, 'Unavailable tiers must not be reported as active')
    assert.equal(Object.isFrozen(before.visualPolicy), true)
    engine.setBloomEnabled(false)
    const after = engine.graphicsRuntimeSnapshot()
    assert.equal(after.visualPolicy, engine.getVisualPolicy())
    assert.equal(after.visualPolicy.preferences.bloomEnabled, false)
    assert.equal(after.visualPolicy.post.enabled, false)
    assert.equal(before.visualPolicy.post.enabled, true, 'Earlier evidence remains immutable')
    assert.deepEqual(calls, [['post', false]])
    assert.equal(engine.paused, true)
    assert.equal(engine.elapsed, 77)
    assert.equal(combat.getState(), originalRng)
    assert.deepEqual(weather, originalWeather)
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})

test('App stages preview choices without restarting the engine or closing an overlay', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('const changeVisualPreferences = ')
  const end = source.indexOf('const selectBoon = ', start)
  assert.ok(start >= 0 && end > start)
  const handler = source.slice(start, end)
  assert.match(handler, /saveVisualPreferences\(window\.localStorage, next, warnRunStorage\)/)
  assert.match(handler, /visualPreferencesRef\.current = next/)
  assert.match(handler, /setVisualPreferencesError\(!saved\)/)
  assert.doesNotMatch(handler, /engineRef|setScreen|setRunId|applyGameOverlays|launchGeneratedRun|checkpointGeneratedRun/)
  assert.match(source, /visualMode: visualPreferencesRef\.current\.visualMode/)
  assert.match(source, /visualQuality: visualPreferencesRef\.current\.visualQuality/)
  assert.doesNotMatch(source, /hudMode: visualPreferencesRef/)
})

test('the shared controls expose labels, pending application and shrinkable 44px selectors', () => {
  const source = readFileSync(new URL('../src/game/ui/VisualSettingsControls.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
  assert.match(source, /visualPreferenceApplication\(/)
  assert.match(source, /aria-describedby=/)
  assert.match(source, /htmlFor=/)
  assert.match(source, /VISUAL_SETTINGS_COPY\.reloadRequired/)
  assert.match(source, /VISUAL_SETTINGS_COPY\.unavailable/)
  assert.match(source, /VISUAL_SETTINGS_COPY\.storageFailed/)
  assert.match(css, /\.visual-settings select \{[^}]*min-height: 2\.75rem;[^}]*min-width: 0;/)
  assert.match(css, /\.visual-settings select:focus-visible \{/)
})
