import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_VISUAL_PREFERENCES,
  DEFAULT_VISUAL_SETTINGS,
  VISUAL_PREFERENCES_KEY,
  VISUAL_PREFERENCES_VERSION,
  foliageQualityDensity,
  loadVisualPreferences,
  normalizeVisualPreferences,
  normalizeVisualSettings,
  saveVisualPreferences,
  type VisualPreferences,
  type VisualQuality,
} from '../src/game/visualSettings.ts'
import {
  LEGACY_VISUAL_REVISION,
  VISUAL_PREVIEW_AVAILABLE,
  resolveVisualPolicy,
  resolveVisualViewport,
} from '../src/game/visualPolicy.ts'
import {
  disposeOwnedVisualResources,
  type VisualFrameOwner,
  type VisualResourceOwner,
} from '../src/game/visualLifecycle.ts'
import type { BloomPostProcessor } from '../src/game/BloomPostProcessor.ts'
import type { StorageLike, StorageWarning } from '../src/game/run/storage.ts'

function memoryStorage(entries: [string, string][] = []) {
  const values = new Map(entries)
  const calls: string[] = []
  const storage: StorageLike = {
    getItem(key) { calls.push(`read:${key}`); return values.get(key) ?? null },
    setItem(key, value) { calls.push(`write:${key}`); values.set(key, value) },
    removeItem(key) { calls.push(`remove:${key}`); values.delete(key) },
  }
  return { values, calls, storage }
}

function warnings() {
  const messages: string[] = []
  const errors: unknown[] = []
  const warn: StorageWarning = (message, error) => { messages.push(message); errors.push(error) }
  return { messages, errors, warn }
}

test('absent preferences launch enhanced graphics at the highest tier with the full HUD', () => {
  const { storage, calls } = memoryStorage()
  const { warn, messages } = warnings()
  assert.deepEqual(loadVisualPreferences(storage, warn), { hudMode: 'full' })
  assert.deepEqual(normalizeVisualSettings(undefined, warn), DEFAULT_VISUAL_SETTINGS)
  const policy = resolveVisualPolicy({})
  assert.equal(policy.mode, 'enhanced')
  assert.equal(policy.quality, 'high')
  assert.equal(policy.post.antialiasing, 'fxaa')
  assert.equal(policy.shadows.mapSize, 2048)
  assert.equal(policy.shadows.worldCasterBudget, 16)
  assert.equal(policy.render.maxPixels, 2_100_000)
  assert.deepEqual(policy.density, { foliage: 1, weather: 1, ambientLife: 1, particles: 1 })
  assert.deepEqual(calls, [`read:${VISUAL_PREFERENCES_KEY}`])
  assert.deepEqual(messages, [])
  assert.equal('hudMode' in DEFAULT_VISUAL_SETTINGS, false, 'HUD presentation is not an engine setting')
})

test('HUD preferences discard retired graphics fields and warn about invalid HUD values', () => {
  const { warn, messages } = warnings()
  const preferences = normalizeVisualPreferences({
    visualMode: 'auto', visualQuality: 'low', hudMode: 'compact', seed: 99,
  }, warn)
  assert.deepEqual(preferences, { hudMode: 'compact' })
  assert.deepEqual(messages, [])
  assert.equal(Object.isFrozen(preferences), true)
  assert.equal(Reflect.set(preferences, 'visualMode', 'enhanced'), false)

  const invalid = warnings()
  assert.deepEqual(normalizeVisualPreferences({
    visualMode: true, visualQuality: 0, hudMode: [],
  }, invalid.warn), DEFAULT_VISUAL_PREFERENCES)
  assert.deepEqual(invalid.messages, ['Korovany: invalid hudMode preference ignored.'])
  for (const value of [null, [], false, 3, 'enhanced']) {
    const rejected = warnings()
    assert.deepEqual(normalizeVisualPreferences(value, rejected.warn), DEFAULT_VISUAL_PREFERENCES)
    assert.equal(rejected.messages.length, 1)
  }
})

test('explicit engine comparison settings remain valid while invalid values fall back to enhanced high', () => {
  for (const visualMode of ['legacy', 'enhanced'] as const) {
    for (const visualQuality of ['low', 'balanced', 'high'] as const) {
      const settings = normalizeVisualSettings({ visualMode, visualQuality })
      assert.equal(settings.visualMode, visualMode)
      assert.equal(settings.visualQuality, visualQuality)
    }
  }
  const { warn, messages } = warnings()
  assert.deepEqual(normalizeVisualSettings({ visualMode: 'auto', visualQuality: 0 }, warn), DEFAULT_VISUAL_SETTINGS)
  assert.deepEqual(messages, [
    'Korovany: invalid visualMode preference ignored.',
    'Korovany: invalid visualQuality preference ignored.',
  ])
})

test('normalization retains independent effect-off preferences and warns about invalid booleans', () => {
  const settings = normalizeVisualSettings({
    visualMode: 'enhanced', visualQuality: 'high', bloomEnabled: false,
    inkOutlinesEnabled: false, weatherEnabled: false, screenShakeEnabled: false,
    dynamicDayNight: false, foliageQuality: 'off', hudMode: 'compact',
  })
  assert.equal(settings.bloomEnabled, false)
  assert.equal(settings.inkOutlinesEnabled, false)
  assert.equal(settings.weatherEnabled, false)
  assert.equal(settings.screenShakeEnabled, false)
  assert.equal(settings.dynamicDayNight, false)
  assert.equal(settings.foliageQuality, 'off')
  assert.equal('hudMode' in settings, false)
  const { warn, messages } = warnings()
  const invalid = normalizeVisualSettings({
    bloomEnabled: 'false', foliageQuality: 'ultra', weatherEnabled: 0,
  }, warn)
  assert.equal(invalid.bloomEnabled, true)
  assert.equal(invalid.weatherEnabled, true)
  assert.equal(invalid.foliageQuality, 'high')
  assert.equal(messages.length, 3)
})

test('new visual preferences round-trip atomically without changing campaign or old effect keys', () => {
  const before: [string, string][] = [
    ['korovany-bloom', 'false'],
    ['korovany-ink-outlines', 'false'],
    ['korovany-weather', 'false'],
    ['korovany-screen-shake', 'false'],
    ['korovany-foliage', 'off'],
    ['korovany-active-run-v3', '{"runId":"untouched","seed":20260906}'],
  ]
  const { storage, values, calls } = memoryStorage(before)
  const preferences: VisualPreferences = { hudMode: 'compact' }
  assert.equal(saveVisualPreferences(storage, preferences), true)
  assert.deepEqual(loadVisualPreferences(storage), preferences)
  for (const [key, value] of before) assert.equal(values.get(key), value)
  assert.deepEqual(calls, [`write:${VISUAL_PREFERENCES_KEY}`, `read:${VISUAL_PREFERENCES_KEY}`])
  assert.deepEqual(JSON.parse(values.get(VISUAL_PREFERENCES_KEY)!), { version: VISUAL_PREFERENCES_VERSION, ...preferences })
})

test('existing graphics selections cannot downgrade a launch and migration preserves HUD and campaign data', () => {
  for (const visualMode of ['legacy', 'enhanced']) {
    for (const visualQuality of ['low', 'balanced', 'high']) {
      const saved = JSON.stringify({ version: 1, visualMode, visualQuality, hudMode: 'compact' })
      const { storage, values, calls } = memoryStorage([
        [VISUAL_PREFERENCES_KEY, saved],
        ['korovany-active-run-v3', '{"runId":"unchanged","seed":20260906}'],
        ['korovany-bloom', 'false'],
      ])
      const { warn, messages } = warnings()
      const preferences = loadVisualPreferences(storage, warn)
      assert.deepEqual(preferences, { hudMode: 'compact' })
      const policy = resolveVisualPolicy({ ...preferences, bloomEnabled: false })
      assert.equal(policy.mode, 'enhanced')
      assert.equal(policy.quality, 'high')
      assert.equal(policy.post.enabled, false)
      assert.deepEqual(calls, [`read:${VISUAL_PREFERENCES_KEY}`], 'migration must not mutate storage during reads')
      assert.equal(saveVisualPreferences(storage, preferences, warn), true)
      assert.deepEqual(JSON.parse(values.get(VISUAL_PREFERENCES_KEY)!), { version: 2, hudMode: 'compact' })
      assert.equal(values.get('korovany-active-run-v3'), '{"runId":"unchanged","seed":20260906}')
      assert.equal(values.get('korovany-bloom'), 'false')
      assert.deepEqual(messages, [])
    }
  }
})

test('malformed and unsupported persisted records warn and fall back to the full HUD', () => {
  for (const raw of ['{', 'null', '[]', '{"version":3,"hudMode":"compact"}', '{}']) {
    const { storage } = memoryStorage([[VISUAL_PREFERENCES_KEY, raw]])
    const { warn, messages } = warnings()
    assert.deepEqual(loadVisualPreferences(storage, warn), DEFAULT_VISUAL_PREFERENCES)
    assert.ok(messages.length > 0, `missing warning for ${raw}`)
  }
  const { storage } = memoryStorage([[VISUAL_PREFERENCES_KEY,
    '{"version":2,"hudMode":"invalid"}']])
  const { warn, messages } = warnings()
  assert.deepEqual(loadVisualPreferences(storage, warn), { hudMode: 'full' })
  assert.equal(messages.length, 1)
})

test('storage failures are explicit and do not produce a success result', () => {
  const readError = new Error('storage denied')
  const readWarnings = warnings()
  assert.deepEqual(loadVisualPreferences({
    getItem() { throw readError },
  }, readWarnings.warn), DEFAULT_VISUAL_PREFERENCES)
  assert.deepEqual(readWarnings.errors, [readError])
  const writeError = new Error('quota exceeded')
  const writeWarnings = warnings()
  assert.equal(saveVisualPreferences({
    setItem() { throw writeError },
  }, DEFAULT_VISUAL_PREFERENCES, writeWarnings.warn), false)
  assert.deepEqual(writeWarnings.errors, [writeError])
})

test('an unavailable preview reports requested enhanced separately from effective legacy', () => {
  const policy = resolveVisualPolicy(
    { visualMode: 'enhanced', visualQuality: 'high' }, { enhancedAvailable: false },
  )
  assert.equal(policy.preferences.visualMode, 'enhanced')
  assert.equal(policy.mode, 'legacy')
  assert.equal(policy.previewAvailable, false)
  assert.equal(policy.revision, LEGACY_VISUAL_REVISION)
  assert.equal(policy.budget, null)
  assert.deepEqual(policy.render, { scale: 1, maxPixelRatio: 1.75, maxPixels: null })
  assert.deepEqual(policy.camera, { collision: 'legacy-ray', foregroundFade: false })
  assert.equal(policy.shadows.worldCasterBudget, 0)
  assert.equal(resolveVisualPolicy({ visualMode: 'enhanced' }).mode,
    VISUAL_PREVIEW_AVAILABLE ? 'enhanced' : 'legacy')
})

const qualities: readonly VisualQuality[] = ['high', 'balanced', 'low']

test('legacy quality choices cannot change existing render, shadow, ink, LOD or density behavior', () => {
  const baseline = resolveVisualPolicy({ visualMode: 'legacy' })
  for (const quality of qualities) {
    const legacy = resolveVisualPolicy({ visualMode: 'legacy', visualQuality: quality }, { enhancedAvailable: true })
    assert.equal(legacy.mode, 'legacy', 'explicit legacy comparison remains available')
    for (const domain of ['render', 'post', 'camera', 'ink', 'shadows', 'lod', 'density'] as const) {
      assert.deepEqual(legacy[domain], baseline[domain], `${quality}: changed legacy ${domain}`)
    }
  }
  assert.deepEqual(['off', 'low', 'high'].map((quality) =>
    resolveVisualPolicy(normalizeVisualSettings({ foliageQuality: quality })).density.foliage,
  ), [0, 0.55, 1])
  assert.equal(foliageQualityDensity('low'), 0.55)
})

test('no-post, ink-off, foliage-off and weather-off survive every enhanced tier', () => {
  for (const visualQuality of qualities) {
    const policy = resolveVisualPolicy({
      visualMode: 'enhanced', visualQuality, bloomEnabled: false, inkOutlinesEnabled: false,
      foliageQuality: 'off', weatherEnabled: false, screenShakeEnabled: false,
    }, { enhancedAvailable: true })
    assert.deepEqual(policy.post, { enabled: false, bloom: false, grade: false, antialiasing: 'none' })
    assert.equal(policy.ink.enabled, false)
    assert.equal(policy.density.foliage, 0)
    assert.equal(policy.density.weather, 0)
    assert.equal(policy.cameraEffects, false)
    assert.equal(policy.mode, 'enhanced')
  }
})

test('enhanced low is genuinely direct and the upper tiers have one explicit FXAA/post policy', () => {
  for (const visualQuality of qualities) {
    const policy = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality }, { enhancedAvailable: true })
    const post = visualQuality !== 'low'
    assert.equal(policy.post.enabled, post)
    assert.equal(policy.post.bloom, post)
    assert.equal(policy.post.grade, post)
    assert.equal(policy.post.antialiasing, post ? 'fxaa' : 'none')
    assert.equal(policy.budget?.provisional, true)
    assert.equal(policy.camera.collision, 'volume')
    assert.equal(policy.lod.hysteresis, 0.15)
  }
})

test('shared tier limits price submitted world shadow draws, instances and triangles', () => {
  const expected = [
    [2048, 40, 16, 48, 60_000, 0.75, 1.5],
    [1024, 28, 8, 24, 30_000, 0.65, 1.25],
    [512, 0, 0, 0, 0, 0.6, 1],
  ]
  for (const [index, visualQuality] of qualities.entries()) {
    const policy = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality }, { enhancedAvailable: true })
    assert.deepEqual([
      policy.shadows.mapSize, policy.shadows.worldDistance, policy.shadows.worldCasterBudget,
      policy.shadows.worldInstanceBudget, policy.shadows.worldTriangleBudget,
      policy.ink.minPixels, policy.ink.maxPixels,
    ], expected[index])
  }
})

test('reduced motion is explicit and never turns off gameplay information or the selected tier', () => {
  const policy = resolveVisualPolicy({
    visualMode: 'enhanced', visualQuality: 'high', screenShakeEnabled: true,
  }, { enhancedAvailable: true, reducedMotion: true })
  assert.equal(policy.reducedMotion, true)
  assert.equal(policy.cameraEffects, false)
  assert.equal(policy.preferences.screenShakeEnabled, true)
  assert.equal(policy.quality, 'high')
  assert.equal(policy.density.particles, 0.5)
  assert.equal(policy.ink.enabled, true)
})

test('published policy data is immutable and does not retain mutable caller settings', () => {
  const settings = { ...DEFAULT_VISUAL_SETTINGS }
  const policy = resolveVisualPolicy(settings, { enhancedAvailable: true })
  settings.bloomEnabled = false
  assert.equal(policy.preferences.bloomEnabled, true)
  for (const object of [policy, policy.preferences, policy.render, policy.camera, policy.post,
    policy.shadows, policy.ink, policy.lod, policy.density]) {
    assert.equal(Object.isFrozen(object), true)
  }
  assert.equal(Reflect.set(policy.render, 'maxPixelRatio', 99), false)
  const enhanced = resolveVisualPolicy({ visualMode: 'enhanced' }, { enhancedAvailable: true })
  assert.equal(Object.isFrozen(enhanced.budget), true)
})

test('viewport policy bounds real 3D pixels without resizing CSS or HUD coordinates', () => {
  for (const visualQuality of qualities) {
    const policy = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality }, { enhancedAvailable: true })
    for (const [width, height] of [[1920, 1080], [390, 844], [3840, 2160], [844, 390], [1, 2_000_000]]) {
      for (const dpr of [1, 1.25, 2, 3]) {
        const viewport = resolveVisualViewport(policy.render, width, height, dpr)
        assert.equal(viewport.cssWidth, width)
        assert.equal(viewport.cssHeight, height)
        assert.equal(viewport.devicePixelRatio, dpr)
        assert.ok(viewport.drawingBufferWidth * viewport.drawingBufferHeight <= policy.render.maxPixels!)
        assert.ok(viewport.pixelRatio <= dpr)
        assert.ok(viewport.drawingBufferWidth >= 1 && viewport.drawingBufferHeight >= 1)
        assert.deepEqual(resolveVisualViewport(policy.render, width, height, dpr), viewport)
      }
    }
  }
  const legacy = resolveVisualPolicy({ visualMode: 'legacy' })
  assert.deepEqual(resolveVisualViewport(legacy.render, 1920, 1080, 2), {
    cssWidth: 1920, cssHeight: 1080, devicePixelRatio: 2, pixelRatio: 1.75,
    drawingBufferWidth: 3360, drawingBufferHeight: 1890,
  })
  const hidden = resolveVisualViewport(legacy.render, 0, 0, 1)
  assert.equal(hidden.drawingBufferWidth, 1)
  assert.equal(hidden.drawingBufferHeight, 1)
})

test('invalid viewport data fails explicitly instead of propagating NaN or hiding the scene', () => {
  const render = resolveVisualPolicy({}).render
  for (const [width, height, dpr] of [
    [NaN, 1080, 1], [1920, Infinity, 1], [-1, 1080, 1], [1920, 1080, 0],
    [1920, 1080, -1], [1920, 1080, NaN],
  ]) assert.throws(() => resolveVisualViewport(render, width, height, dpr), RangeError)
  assert.throws(() => resolveVisualViewport({ ...render, scale: 0 }, 1, 1, 1), RangeError)
  assert.throws(() => resolveVisualViewport({ ...render, maxPixels: 0 }, 1, 1, 1), RangeError)
})

test('exclusive allocations drain in reverse order exactly once, without disposing borrowed resources', () => {
  const calls: string[] = []
  const source: VisualResourceOwner = { dispose: () => { calls.push('source') } }
  const shell: VisualResourceOwner = { dispose: () => { calls.push('shell') } }
  const borrowed: VisualResourceOwner = { dispose: () => { calls.push('borrowed') } }
  const sourceReferences = { geometry: borrowed }
  const owned = [source, shell, source]
  disposeOwnedVisualResources(owned)
  assert.deepEqual(calls, ['shell', 'source'])
  assert.deepEqual(owned, [])
  assert.equal(sourceReferences.geometry, borrowed)
  disposeOwnedVisualResources(owned)
  assert.deepEqual(calls, ['shell', 'source'])
})

test('partial construction cleanup attempts every owner and surfaces all disposal failures', () => {
  const calls: string[] = []
  const firstError = new Error('first cleanup failed')
  const secondError = new Error('second cleanup failed')
  const owned: VisualResourceOwner[] = [
    { dispose() { calls.push('first'); throw firstError } },
    { dispose() { calls.push('second'); throw secondError } },
    { dispose() { calls.push('third') } },
  ]
  assert.throws(() => disposeOwnedVisualResources(owned), (error: unknown) => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [secondError, firstError])
    return true
  })
  assert.deepEqual(calls, ['third', 'second', 'first'])
  assert.deepEqual(owned, [])
  assert.doesNotThrow(() => disposeOwnedVisualResources(owned))
})

test('the existing post processor satisfies the sole frame-owner interface', () => {
  const compatible: BloomPostProcessor extends VisualFrameOwner ? true : false = true
  assert.equal(compatible, true)
})
