import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
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
  setBloomEnabled(enabled: boolean): void
  setInkOutlinesEnabled(enabled: boolean): void
  setFoliageQuality(quality: FoliageQuality): void
  setWeatherEnabled(enabled: boolean): void
  setDynamicDayNight(enabled: boolean): void
  setScreenShakeEnabled(enabled: boolean): void
}

function fixture() {
  const calls: [string, unknown][] = []
  const forbidden = () => { assert.fail('A visual setting attempted a campaign/rig lifecycle operation') }
  const engine: VisualEngineProbe = Object.assign(Object.create(GameEngine.prototype), {
    visualPolicy: resolveVisualPolicy(DEFAULT_VISUAL_SETTINGS),
    reducedMotion: false, screenShakeEnabled: true, inkOutlinesEnabled: true,
    groundFoliageQuality: 'high', weatherEnabled: true, dynamicDayNight: true,
    player: { position: { x: 4, z: 5 } }, actors: [{ id: 'friendly' }, { id: 'hostile' }],
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
    'weather-target', 'ground-weather', 'day-night', 'weather', 'atmosphere',
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
