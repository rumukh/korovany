import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { createArtStream, createAtmospherePresentation, StylizedArtLibrary } from '../src/game/art/index.ts'
import { createCampaignContractState, createChronicleCommitmentState, createGeneratedObjectives } from '../src/game/world/CampaignDirector.ts'
import { createChronicleRegions, createChronicleState, getChronicleProtectedRegionIds, type ChronicleEvent } from '../src/game/world/Chronicle.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { createWeatherMix, type WeatherMix } from '../src/game/world/WorldEnvironment.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import type { ZoneId } from '../src/game/types.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

function fixture() {
  const blueprint = generateWorld('environment-toggles-2')
  const events: ChronicleEvent[] = []
  const player = new THREE.Group()
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    generatedBlueprint: blueprint, player, faction: 'elf', actors: [],
    elapsed: 60, health: 100, ended: false, paused: false, hitStopRemaining: 0.03,
    weatherEnabled: true, dynamicDayNight: true, reducedMotion: false,
    weatherZone: 'palace', weatherTarget: 'clear', weatherWeights: createWeatherMix('clear'),
    renderer: { domElement: { dataset: {} } },
    visualPolicy: resolveVisualPolicy({ visualMode: 'enhanced', weatherEnabled: true }),
    zoneAtPosition: () => zones[Math.floor(player.position.x / 100) % zones.length],
    chronicleAccumulator: 0,
    chronicleState: createChronicleState(), chronicleRegions: createChronicleRegions(blueprint),
    chronicleProtectedRegionIds: getChronicleProtectedRegionIds(blueprint),
    chronicleCommitments: createChronicleCommitmentState(), chronicleRumourReserved: new Set(),
    campaignContracts: createCampaignContractState(),
    generatedRngStreams: { chronicle: new RandomStream(321), rumour: new RandomStream(456), combat: new RandomStream(789) },
    objectives: createGeneratedObjectives(blueprint, 'elf'),
    generatedWorld: { update() {}, regions: { getSimulatedRegionIds: () => [] } },
    generatedRegionIdAt: () => null,
    handleChronicleEvents: (next: ChronicleEvent[]) => events.push(...next),
    announceRumourVerdict() {},
    updatePlayer: () => { player.position.x++ },
    body: { bleeding: 0 }, doctrineEffects: {},
    finaleWithinArena: () => true,
    updateDayNight() {}, applyWeatherEnvironment() {}, updateStylizedLighting() {},
    updatePrecipitation() {}, updateLightning() {}, restoreWeatherVisuals() {}, updateAtmosphere() {},
  })
  for (const method of [
    'updateLoot', 'updateThreat', 'updateAmbientBeasts', 'updateAmbientCivilians', 'cleanupDeadActors',
    'updatePlayerMelee', 'syncGeneratedRegions', 'refreshGeneratedCameraObstacles', 'updateCaravan',
    'updateProjectiles', 'updateActors', 'updateTorches', 'updateCampfires', 'updateWildlife',
    'updateInteractableOutlines', 'updateParticles', 'updateComicHitFx', 'updateDecals',
    'updateMission', 'updateFactionContract', 'updateEvents', 'updatePrompt', 'emitView',
  ]) Reflect.set(engine, method, () => {})
  for (const field of ['shakeClock', 'trauma', 'damageFlash', 'attackCooldown', 'attackAnimation',
    'abilityCooldown', 'caravanCooldown', 'caravanRobbedFlash', 'moraleNoticeCooldown']) Reflect.set(engine, field, 0)
  return { engine, events }
}
const zones: ZoneId[] = ['palace', 'forest', 'fort', 'neutral']

test('actual live setters cannot snap a partial mix, visit a new biome or spend any simulation time', () => {
  const { engine } = fixture()
  engine.player.position.x = 150
  engine.updateWeather(0.25)
  assert.ok(engine.weatherWeights.rain > 0 && engine.weatherWeights.rain < 0.5)
  const before = { ...engine.weatherWeights }
  engine.player.position.x = 250
  const rng = engine.generatedRngStreams.chronicle.getState()
  for (const enabled of [false, true, false, true]) {
    engine.setWeatherEnabled(enabled)
    engine.setDynamicDayNight(enabled)
    engine.updateWeather(0)
    assert.deepEqual(engine.weatherWeights, before)
    assert.equal(engine.weatherTarget, 'rain', 'only the next real simulation update sees the new biome')
    assert.equal(engine.elapsed, 60)
    assert.equal(engine.hitStopRemaining, 0.03)
    assert.deepEqual(engine.generatedRngStreams.chronicle.getState(), rng)
  }
  engine.updateWeather(0.05)
  assert.equal(engine.weatherTarget, 'snow')
  assert.ok(engine.weatherWeights.snow > 0)
})

test('actual engine update ordering and chronicle history are identical across live weather/day toggles', () => {
  function run(toggles: boolean, restoreOldSnap = false) {
    const { engine, events } = fixture()
    const ticks: { elapsed: number; mix: WeatherMix; ambientNight: number; stormPace: number }[] = []
    const updateChronicle = engine.updateChronicle.bind(engine)
    engine.updateChronicle = (delta: number) => {
      const before = engine.chronicleState.tick
      updateChronicle(delta)
      if (engine.chronicleState.tick !== before) ticks.push({
        elapsed: engine.elapsed, mix: { ...engine.weatherWeights },
        ambientNight: engine.ambientNightFactor, stormPace: engine.ambientStormPace,
      })
    }
    const art = createArtStream(42, 'negative-environment-proof')
    for (let frame = 0; frame < 8000; frame++) {
      if (toggles && frame % 37 === 12) {
        engine.setWeatherEnabled(!engine.weatherEnabled)
        engine.setDynamicDayNight(!engine.dynamicDayNight)
        if (restoreOldSnap) engine.setWeatherTarget(engine.weatherTarget, true)
        art.next()
      }
      engine.update(0.05)
    }
    return {
      ticks, events, state: engine.chronicleState, regions: [...engine.chronicleRegions],
      mix: engine.weatherWeights, elapsed: engine.elapsed, hitStop: engine.hitStopRemaining,
      rng: Object.values(engine.generatedRngStreams).map((stream) => (stream as RandomStream).getState()),
    }
  }
  const baseline = run(false)
  assert.ok(baseline.ticks.length > 40)
  assert.ok(baseline.events.length > 0, 'chronicle must produce real events')
  assert.ok(baseline.ticks.some((tick) => tick.mix.rain > 0.1 && tick.mix.rain < 0.9))
  assert.deepEqual(run(true), baseline)
  assert.notDeepEqual(run(true, true).ticks, baseline.ticks, 'reintroducing the setter snap must fail the same comparison')
})

test('real engine presentation refresh wires final fog, wetness and terrain/density buffers without changing the authoritative mix', () => {
  const { engine } = fixture()
  const art = new StylizedArtLibrary({
    ink: { player: 0x111111, enemy: 0x111111, interactable: 0x111111, landmark: 0x111111 }, enhanced: true,
  })
  const material = art.createMaterial({ surface: 'ground', color: 0x775533 })
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  }
  material.onBeforeCompile(shader as never, null as never)
  const rainPositions = new Float32Array(420 * 6).fill(0.5), snowPositions = new Float32Array(300 * 3).fill(0.5)
  const rainGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(rainPositions, 3))
  const snowGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(snowPositions, 3))
  const rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial())
  const snow = new THREE.Points(snowGeometry, new THREE.PointsMaterial())
  const environment = {
    timeSeconds: 0, windX: 0, windZ: 0, windStrength: 0, rain: 0, snow: 0, wetness: 0,
    skyColor: new THREE.Color(), horizonColor: new THREE.Color(), atmosphere: createAtmospherePresentation(),
  }
  let terrainSamples = 0
  Object.assign(engine, {
    artLibrary: art, artEnvironment: environment, atmosphereReference: { environment },
    enhancedLightingRef: { keyIntensity: 0, rimColor: new THREE.Color(), shadowTint: new THREE.Color(), environment },
    readableSky: new THREE.Color(0xc2d1df), readableGround: new THREE.Color(0xb0a38d),
    hemisphere: new THREE.HemisphereLight(), sun: new THREE.DirectionalLight(), rimLight: new THREE.DirectionalLight(),
    enhancedTarget: new THREE.Vector3(), fog: new THREE.Fog(0x557799, 48, 132),
    weatherGray: new THREE.Color(), backgroundColor: new THREE.Color(0x557799),
    skyMaterial: new THREE.MeshBasicMaterial(), cloudMaterial: new THREE.MeshBasicMaterial(), cloudBaseColor: new THREE.Color(),
    sunDisc: { material: { opacity: 1 } }, moonDisc: { material: { opacity: 1 } }, stars: { material: { opacity: 1 } },
    wind: { direction: new THREE.Vector2(1, 0), strength: 0.25 }, lightningLight: new THREE.HemisphereLight(),
    rain, snow, rainPositions, snowPositions, snowDriftPhases: new Float32Array(300),
    camera: new THREE.PerspectiveCamera(),
    precipitationFrame: {
      delta: 0, time: 0, cameraX: 0, cameraY: 0, cameraZ: 0, windX: 0, windZ: 0, windStrength: 0, reducedMotion: false,
    },
    precipitationHeight: () => { terrainSamples++; return 60 },
    atmosphereRoot: new THREE.Group(), clouds: [], flames: [],
    updateZoneTint: () => { engine.fog.color.setRGB(0.1, 0.2, 0.3) },
    postProcessor: { setGradeTints() {} },
    updateDayNight: () => {
      engine.sun.intensity = 2.65
      engine.hemisphere.intensity = 1.65
      engine.rimLight.intensity = 1
    },
  })
  for (const method of ['updateStylizedLighting', 'applyWeatherEnvironment', 'restoreWeatherVisuals', 'updatePrecipitation', 'updateAtmosphere']) {
    Reflect.set(engine, method, Reflect.get(GameEngine.prototype, method))
  }
  engine.camera.position.set(0, 68, 0)
  engine.weatherWeights = { clear: 0.2, overcast: 0, rain: 0.8, snow: 0 }
  const before = { ...engine.weatherWeights }
  try {
    engine.updateDayNight()
    engine.updateWeather(0)
    engine.updateAtmosphere(0)
    assert.equal((shader.uniforms.uArtWeather.value as THREE.Vector3).z, 0.8)
    assert.deepEqual((shader.uniforms.uArtAtmosphereColor.value as THREE.Color).toArray(), [0.1, 0.2, 0.3])
    assert.equal(rain.geometry.drawRange.count, Math.floor(420 * 0.8) * 2)
    assert.ok(rainPositions[1] > 60)
    assert.ok(terrainSamples <= 420 + 300)
    const attributes = [rain.geometry.getAttribute('position'), snow.geometry.getAttribute('position')]
    engine.setWeatherEnabled(false)
    assert.equal((shader.uniforms.uArtWeather.value as THREE.Vector3).z, 0)
    assert.equal(rain.visible, false)
    assert.equal(snow.visible, false)
    engine.setWeatherEnabled(true)
    assert.equal((shader.uniforms.uArtWeather.value as THREE.Vector3).z, 0.8)
    assert.equal(rain.visible, true)
    engine.reducedMotion = true
    engine.visualPolicy = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'low' }, { reducedMotion: true })
    engine.graphicsClock = { weather: createWeatherMix('snow'), timeSeconds: 120 }
    engine.updateDayNight()
    engine.updateWeather(0)
    assert.equal(snow.geometry.drawRange.count, 60)
    assert.equal(rain.visible, false)
    assert.equal((shader.uniforms.uArtWind.value as THREE.Vector3).z, 0)
    assert.deepEqual(engine.weatherWeights, before)
    assert.equal(engine.elapsed, 60)
    assert.equal(engine.hitStopRemaining, 0.03)
    assert.equal(rain.geometry.getAttribute('position'), attributes[0])
    assert.equal(snow.geometry.getAttribute('position'), attributes[1])
  } finally {
    rainGeometry.dispose(); snowGeometry.dispose(); rain.material.dispose(); snow.material.dispose()
    material.dispose(); art.dispose()
  }
})
