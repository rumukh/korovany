import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DAY_LENGTH,
  WEATHER_BY_ZONE,
  advanceWeatherMix,
  computeDayPhase,
  computeNightFactor,
  computeStormFactor,
  createChronicleEnvironment,
  createWeatherMix,
  snapWeatherMix,
  type WeatherMix,
} from '../src/game/world/WorldEnvironment.ts'
import {
  createChronicleRegions,
  createChronicleState,
  getChronicleProtectedRegionIds,
  tickChronicle,
  type ChronicleEvent,
} from '../src/game/world/Chronicle.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import type { ZoneId } from '../src/game/types.ts'

test('the day phase and night factor are functions of elapsed run time alone', () => {
  assert.equal(computeNightFactor(0), computeNightFactor(0))
  // Periodic over a day, up to the float error of wrapping a larger elapsed value.
  assert.ok(
    Math.abs(computeNightFactor(97.5) - computeNightFactor(97.5 + DAY_LENGTH)) < 1e-12,
  )
  assert.ok(Math.abs(computeDayPhase(0) - computeDayPhase(DAY_LENGTH * 3)) < 1e-12)

  const samples: number[] = []
  for (let step = 0; step < 64; step += 1) {
    const value = computeNightFactor((step / 64) * DAY_LENGTH)
    assert.ok(value >= 0 && value <= 1, `night factor ${value} is out of range`)
    samples.push(value)
  }
  assert.ok(Math.max(...samples) > 0.95, 'expected a deep night in the cycle')
  assert.ok(Math.min(...samples) < 0.05, 'expected a full day in the cycle')
  assert.equal(Number.isFinite(computeNightFactor(Number.NaN)), true)
})

test('weather blends toward the biome kind and storms read as rain or snow', () => {
  assert.deepEqual(WEATHER_BY_ZONE, {
    neutral: 'overcast',
    palace: 'clear',
    forest: 'rain',
    fort: 'snow',
  })

  const mix = createWeatherMix('clear')
  assert.equal(computeStormFactor(mix), 0)
  for (let step = 0; step < 400; step += 1) advanceWeatherMix(mix, 'rain', 0.05)
  assert.ok(mix.rain > 0.99, `expected rain to dominate, got ${mix.rain}`)
  assert.ok(computeStormFactor(mix) > 0.99)

  for (let step = 0; step < 400; step += 1) advanceWeatherMix(mix, 'overcast', 0.05)
  assert.ok(computeStormFactor(mix) < 0.01, 'overcast is not a storm')

  const total = Object.values(mix).reduce((sum, value) => sum + value, 0)
  assert.ok(Math.abs(total - 1) < 1e-9, `weights must stay normalized, got ${total}`)

  const frozen = createWeatherMix('snow')
  advanceWeatherMix(frozen, 'clear', 0)
  advanceWeatherMix(frozen, 'clear', -1)
  assert.deepEqual(frozen, createWeatherMix('snow'))

  snapWeatherMix(frozen, 'clear')
  assert.deepEqual(frozen, createWeatherMix('clear'))
})

/**
 * Mirrors the ordering in `GameEngine.update()`: `updateChronicle` samples the
 * environment, then `updateWeather` advances the weather mix toward the biome under the
 * player. `renderWeather` / `renderDayNight` stand in for the parts of
 * `updateWeather` / `updateDayNight` that a display setting is allowed to switch off.
 */
function runFrames(options: {
  seed: string
  frames: number
  frameDelta: number
  dynamicDayNight: boolean
  weatherEnabled: boolean
  /**
   * Negative control. Reproduces the coupling this change removed — `nightFactor`
   * pinned to 0 by `dynamicDayNight: false` and the weather mix snapped to `clear` by
   * `weatherEnabled: false` — so the equality assertion below is provably not vacuous.
   */
  coupleToDisplaySettings?: boolean
}): { events: ChronicleEvent[]; environments: string[] } {
  const blueprint = generateWorld(options.seed)
  const state = createChronicleState()
  const regions = createChronicleRegions(blueprint)
  const rng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:chronicle'))
  const protectedRegionIds = getChronicleProtectedRegionIds(blueprint)
  const biomes = blueprint.regions.map((region) => region.biome)
  const coupled = options.coupleToDisplaySettings === true

  const mix: WeatherMix = createWeatherMix(WEATHER_BY_ZONE[biomes[0]])
  if (coupled && !options.weatherEnabled) snapWeatherMix(mix, 'clear')
  let renderedNightFactor = 0
  const events: ChronicleEvent[] = []
  const environments: string[] = []
  let elapsed = 0
  let accumulator = 0

  for (let frame = 0; frame < options.frames; frame += 1) {
    elapsed += options.frameDelta
    // A fixed, setting-independent walk. Each biome is held long enough for the weather
    // mix to actually settle, so storms and clear spells both reach the chronicle.
    const biome: ZoneId = biomes[Math.floor(frame / 200) % biomes.length]

    accumulator += options.frameDelta
    while (accumulator >= 8) {      accumulator -= 8
      const environment = createChronicleEnvironment(elapsed, mix)
      if (coupled && !options.dynamicDayNight) environment.nightFactor = 0
      environments.push(
        `${environment.nightFactor.toFixed(12)}|${environment.stormFactor.toFixed(12)}`,
      )
      events.push(
        ...tickChronicle({
          blueprint,
          state,
          regions,
          rng,
          environment,
          playerFaction: 'elf',
          playerObjectiveRatio: 0.5,
          protectedRegionIds,
          frozenRegionIds: new Set<string>(),
        }),
      )
    }

    if (!coupled || options.weatherEnabled) {
      advanceWeatherMix(mix, WEATHER_BY_ZONE[biome], options.frameDelta)
    }
    if (options.weatherEnabled) renderWeather(mix)
    renderedNightFactor = options.dynamicDayNight ? computeNightFactor(elapsed) : 0
  }

  assert.ok(renderedNightFactor >= 0)
  return { events, environments }
}

function renderWeather(mix: WeatherMix): number {
  return mix.rain * 0.5 + mix.snow * 0.5
}

test('chronicle output is identical with the day/night and weather toggles on and off', () => {
  // Long enough that beast pressure crosses its raid threshold, so the night and storm
  // multipliers genuinely decide events rather than only nudging float state.
  const base = { seed: 'environment-toggles', frames: 48_000, frameDelta: 0.05 }
  const allOn = runFrames({ ...base, dynamicDayNight: true, weatherEnabled: true })
  const allOff = runFrames({ ...base, dynamicDayNight: false, weatherEnabled: false })
  const dayNightOff = runFrames({
    ...base,
    dynamicDayNight: false,
    weatherEnabled: true,
  })
  const weatherOff = runFrames({ ...base, dynamicDayNight: true, weatherEnabled: false })

  assert.ok(allOn.events.length > 0, 'expected the chronicle to produce events')
  assert.ok(
    new Set(allOn.environments).size > 1,
    'expected the environment to actually vary across the run',
  )
  assert.ok(
    allOn.environments.some((entry) => Number(entry.split('|')[1]) > 0.5),
    'expected the walk to pass through storm weather',
  )
  assert.ok(
    allOn.environments.some((entry) => Number(entry.split('|')[0]) > 0.5),
    'expected the run to pass through night',
  )
  // The multipliers only bite once beast pressure crosses its raid threshold, so a run
  // without a raid would compare two histories the environment never influenced.
  assert.ok(
    allOn.events.some((event) => event.kind === 'beastRaid'),
    'expected a beast raid, otherwise this comparison proves nothing',
  )

  for (const variant of [allOff, dayNightOff, weatherOff]) {
    assert.deepEqual(variant.environments, allOn.environments)
    assert.deepEqual(variant.events, allOn.events)
  }

  // Negative control: with the old coupling restored, the same run diverges. Without
  // this the equality assertions above could pass for the wrong reason.
  const coupled = runFrames({
    ...base,
    dynamicDayNight: false,
    weatherEnabled: false,
    coupleToDisplaySettings: true,
  })
  assert.notDeepEqual(coupled.environments, allOn.environments)
  assert.notDeepEqual(coupled.events, allOn.events)
})

test('a chronicle environment carries no channel for a display setting', () => {
  const mix = createWeatherMix('rain')
  const environment = createChronicleEnvironment(120, mix)
  assert.deepEqual(Object.keys(environment).sort(), ['nightFactor', 'stormFactor'])
  assert.equal(environment.nightFactor, computeNightFactor(120))
  assert.equal(environment.stormFactor, computeStormFactor(mix))
  assert.equal(createChronicleEnvironment.length, 2)
})
