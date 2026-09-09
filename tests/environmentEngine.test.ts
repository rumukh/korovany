import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { createArtStream } from '../src/game/art/index.ts'
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
