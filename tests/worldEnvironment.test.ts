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
  nightFellBetween,
  smoothstep,
  snapWeatherMix,
  type WeatherMix,
} from '../src/game/world/WorldEnvironment.ts'
import {
  BEAST_NIGHT_MULTIPLIER,
  createChronicleRegions,
  createChronicleState,
  getChronicleProtectedRegionIds,
  tickChronicle,
  type ChronicleEvent,
} from '../src/game/world/Chronicle.ts'
import { CAMPFIRE_NIGHT_THRESHOLD } from '../src/game/world/AmbientLife.ts'
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
  //
  // The seed moved with roadmap 1.5: the walk is fixed but the world under it is not, and
  // on `environment-toggles` the new site placement leaves this run with **no beast raid at
  // all**, which would make the equality below a comparison of two histories the
  // environment never touched. `environment-toggles-2` produces eleven, and the
  // beast-raid guard three assertions down is what caught it.
  const base = { seed: 'environment-toggles-2', frames: 48_000, frameDelta: 0.05 }
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

// ---------------------------------------------------------------------------
// W2-1 — night is a short phase of a nine-minute day, not most of the run
// ---------------------------------------------------------------------------

/**
 * The curve this change replaced, restated: a 240-second day starting at 0.18 of its
 * cycle, with no warp. Every band below is checked against it as the negative control —
 * a band the old curve also passes would not be measuring the change.
 */
function legacyNightFactor(elapsed: number): number {
  const phase = (((elapsed / 240 + 0.18) % 1) + 1) % 1
  return 1 - smoothstep(-0.08, 0.45, Math.sin(phase * Math.PI * 2))
}

const NIGHT = CAMPFIRE_NIGHT_THRESHOLD

/** The share of `[from, to)` the world spends at or above the campfire threshold. */
function nightShare(nightFactor: (elapsed: number) => number, from: number, to: number): number {
  const step = 0.05
  let night = 0
  let total = 0
  for (let elapsed = from; elapsed < to; elapsed += step) {
    total += 1
    if (nightFactor(elapsed) >= NIGHT) night += 1
  }
  return night / total
}

/** Every step that crosses into night, under a rule given as an edge or a level. */
function nightfalls(
  from: number,
  to: number,
  rule: (previous: number, current: number) => boolean,
): number[] {
  const crossings: number[] = []
  const step = 0.05
  for (let elapsed = from + step; elapsed < to; elapsed += step) {
    if (rule(elapsed - step, elapsed)) crossings.push(elapsed)
  }
  return crossings
}

test('night is about 28% of a nine-minute day, and a tenth of the first five minutes', () => {
  assert.equal(DAY_LENGTH, 540)
  const cycle = nightShare(computeNightFactor, 0, DAY_LENGTH)
  const firstFive = nightShare(computeNightFactor, 0, 300)
  const firstThree = nightShare(computeNightFactor, 0, 180)
  assert.ok(cycle > 0.27 && cycle < 0.29, `night is ${cycle.toFixed(3)} of the day`)
  assert.ok(firstFive <= 0.15, `night is ${firstFive.toFixed(3)} of the first five minutes`)
  assert.equal(firstThree, 0, 'the opening is daylight')
  // The run starts in daylight with the sun high, and a real deep night still comes.
  assert.equal(computeNightFactor(0), 0)
  assert.ok(computeNightFactor(345.6) > 0.99, 'expected a deep night at the new midnight')

  // Negative control: the old curve spends more than half of every day, and almost half of
  // the first five minutes, at night — exactly what the bands above refuse.
  const legacyCycle = nightShare(legacyNightFactor, 0, 240)
  const legacyFive = nightShare(legacyNightFactor, 0, 300)
  assert.ok(legacyCycle > 0.55, `legacy cycle ${legacyCycle.toFixed(3)}`)
  assert.ok(legacyFive > 0.44, `legacy first five minutes ${legacyFive.toFixed(3)}`)
  assert.equal(legacyCycle > 0.27 && legacyCycle < 0.29, false)
  assert.equal(legacyFive <= 0.15, false)
})

test('the first dusk falls about four and a half minutes in, and night lasts about two and a half', () => {
  const edge = (previous: number, current: number) =>
    nightFellBetween(previous, current, NIGHT)
  const dusks = nightfalls(0, DAY_LENGTH * 2, edge)
  assert.equal(dusks.length, 2, `${dusks.length} nightfalls in two days`)
  assert.ok(Math.abs(dusks[0] - 270) <= 5, `first dusk at ${dusks[0].toFixed(1)} s`)
  assert.ok(Math.abs(dusks[1] - dusks[0] - DAY_LENGTH) < 0.1, 'the second dusk is a day later')
  let dawn = dusks[0]
  while (computeNightFactor(dawn) >= NIGHT) dawn += 0.05
  assert.ok(dawn - dusks[0] > 140 && dawn - dusks[0] < 160, `night lasted ${(dawn - dusks[0]).toFixed(1)} s`)

  // Negative control: the old curve fell dark 69 seconds in.
  const legacy = nightfalls(0, 240, (previous, current) =>
    legacyNightFactor(previous) < NIGHT && legacyNightFactor(current) >= NIGHT)
  assert.ok(legacy.length === 1 && legacy[0] < 75, `legacy dusk at ${legacy[0]?.toFixed(1)}`)
})

test('nightfall is an edge: once per night, silent for a run continued in the dark', () => {
  const edge = (previous: number, current: number) =>
    nightFellBetween(previous, current, NIGHT)
  // Once a night across three days, whatever the frame step.
  for (const step of [1 / 144, 1 / 60, 1 / 30, 0.25]) {
    let count = 0
    for (let elapsed = step; elapsed < DAY_LENGTH * 3; elapsed += step) {
      if (edge(elapsed - step, elapsed)) count += 1
    }
    assert.equal(count, 3, `step ${step}: ${count} nightfalls in three days`)
  }
  // A continue at midnight starts dark: its first step crosses nothing.
  assert.equal(edge(345.6, 345.65), false)
  assert.equal(edge(345.6, 345.6), false)
  // Negative control: the level reading ("it is night") answers on every dark step.
  const level = nightfalls(0, DAY_LENGTH, (_previous, current) => computeNightFactor(current) >= NIGHT)
  assert.ok(level.length > 1_000, `${level.length} level answers`)
})

test('the day phase advances smoothly and never runs backwards', () => {
  let previous = computeDayPhase(0)
  let largest = 0
  for (let elapsed = 0.05; elapsed <= DAY_LENGTH * 2; elapsed += 0.05) {
    const phase = computeDayPhase(elapsed)
    let advance = phase - previous
    if (advance < -0.5) advance += 1
    assert.ok(advance > 0, `the sun went backwards at ${elapsed.toFixed(2)} s`)
    largest = Math.max(largest, advance)
    previous = phase
  }
  // Fastest at midnight, at about 2.3 times the average speed of 0.05/540 per step.
  const average = 0.05 / DAY_LENGTH
  assert.ok(largest < average * 2.5, `the sun jumped ${(largest / average).toFixed(2)}× its average`)
  assert.ok(computeDayPhase(Number.NaN) === computeDayPhase(0), 'a broken clock reads as the start')
})

test('the shorter night keeps the beasts\' pressure per day and moves it into the night', () => {
  // Mean growth multiplier over a whole day, as `advanceBeasts` applies it every tick.
  const meanGrowth = (nightFactor: (elapsed: number) => number, day: number, multiplier: number) => {
    let total = 0
    let samples = 0
    for (let elapsed = 0; elapsed < day; elapsed += 0.05) {
      total += 1 + (multiplier - 1) * nightFactor(elapsed)
      samples += 1
    }
    return total / samples
  }
  const before = meanGrowth(legacyNightFactor, 240, 1.6)
  const after = meanGrowth(computeNightFactor, DAY_LENGTH, BEAST_NIGHT_MULTIPLIER)
  assert.ok(Math.abs(after / before - 1) < 0.02, `per-day beast growth moved by ${((after / before - 1) * 100).toFixed(1)}%`)
  // Negative control: the old multiplier under the new curve quietly loses about an eighth.
  const unchanged = meanGrowth(computeNightFactor, DAY_LENGTH, 1.6)
  assert.ok(unchanged / before < 0.9, `keeping 1.6 kept ${(unchanged / before).toFixed(3)} of it`)
})
