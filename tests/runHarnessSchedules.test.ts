/**
 * What the full-run harness measured, part two: the scripted schedules and the weather.
 *
 * Two questions the roadmap named explicitly.
 *
 * **The 30 / 60 / 144 Hz arms.** The success signal was that they agree on chronicle
 * history. **They do not**, and this file measures the disagreement rather than asserting
 * it away: outcome and campaign progress agree on every seed tested, chronicle history
 * does not. What that means for the fixed-step question is written down at the test.
 *
 * **The weather-target transition.** `advanceWeatherMix` composes exactly across sub-steps
 * for a fixed target — asserted here — so the mix itself is not the hazard. *When* the
 * target changes is, and this file follows that difference all the way into
 * `advanceBeasts`, which nothing guarded before.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import {
  createChronicleRegions,
  createChronicleState,
  getChronicleProtectedRegionIds,
  tickChronicle,
} from '../src/game/world/Chronicle.ts'
import {
  advanceWeatherMix,
  computeStormFactor,
  createChronicleEnvironment,
  createWeatherMix,
  WEATHER_KINDS,
  type WeatherMix,
} from '../src/game/world/WorldEnvironment.ts'
import type { Faction } from '../src/game/types.ts'
import { runHarness } from './runHarness.ts'

const FACTION_ROTATION: readonly Faction[] = ['elf', 'guard', 'villain']


// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2. The scripted schedules
// ---------------------------------------------------------------------------

test('the 30, 60 and 144 Hz arms agree on the run, and not on chronicle history', () => {
  // The roadmap's success signal was "the 144 Hz and 30 Hz arms agree on chronicle
  // history". **They do not.** Measured over these nine seeds: three diverge. Over a
  // wider forty-seed sample the rate was 14 of 40, and in neither sample did a single
  // seed diverge in outcome or in objectives completed.
  //
  // The cause is not the weather mix — `advanceWeatherMix` composes exactly, asserted
  // below. It is that a chronicle tick reads *where the player is*: which regions are
  // frozen because they are streamed in, and what the weather target became when the
  // player last crossed a biome edge. A finer schedule samples the route at a different
  // cadence, so a tick can land with a different region frozen.
  //
  // **What that means for the fixed-step question the roadmap left open.** It does not
  // justify converting the browser runtime. A fixed simulation step would not remove this
  // divergence, because the input it is sensitive to is the player's *route*, and a route
  // depends on when input arrives — which no internal timestep controls. What the
  // divergence does say is that a chronicle history is reproducible for a seed *and a
  // playthrough*, exactly as the determinism caveat in `docs/STRATEGY.md` claims, and now
  // with a number attached.
  const seeds = [1, 7920, 15839, 23758, 31677, 39596, 47515, 55434, 63353]
  let historyDivergences = 0
  let outcomeDivergences = 0
  let progressDivergences = 0

  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index]
    const faction = FACTION_ROTATION[index % FACTION_ROTATION.length]
    const arms = [30, 60, 144].map((hz) =>
      runHarness({ seed, faction, policy: 'beeline', hz, timeLimit: 300 }),
    )

    const outcomes = new Set(arms.map((report) => report.outcome))
    const progress = new Set(arms.map((report) => report.objectivesCompleted))
    if (outcomes.size > 1) outcomeDivergences += 1
    if (progress.size > 1) progressDivergences += 1

    const histories = arms.map((report) => report.chronicleHistory.join('|'))
    if (new Set(histories).size > 1) historyDivergences += 1
  }

  // The part that must hold: a schedule change never changes whether the run was won or
  // how far the campaign got. This is the assertion that would fail if a future change
  // made frame pacing matter to the player rather than only to the world's bookkeeping.
  assert.equal(outcomeDivergences, 0, 'a schedule change must not change the outcome')
  assert.equal(progressDivergences, 0, 'a schedule change must not change campaign progress')

  // The part that is documented rather than demanded. Pinned exactly, so a change in
  // either direction is visible: if it drops to zero, something made the chronicle
  // schedule-independent and that is worth knowing; if it climbs, something made frame
  // pacing matter more.
  assert.equal(
    historyDivergences,
    3,
    `chronicle history diverged on ${historyDivergences} of ${seeds.length} seeds`,
  )
})

// ---------------------------------------------------------------------------
// 3. The weather-target transition
// ---------------------------------------------------------------------------

function stepMix(mix: WeatherMix, target: Parameters<typeof advanceWeatherMix>[1], seconds: number, hz: number): void {
  const delta = 1 / hz
  const steps = Math.round(seconds * hz)
  for (let index = 0; index < steps; index += 1) advanceWeatherMix(mix, target, delta)
}

function mixDistance(first: WeatherMix, second: WeatherMix): number {
  let total = 0
  for (const kind of WEATHER_KINDS) total += Math.abs(first[kind] - second[kind])
  return total
}

test('the weather mix composes exactly for a fixed target, at any schedule', () => {
  // The half of the hazard that is *not* a hazard, asserted so the other half is not
  // blamed for it. `advanceWeatherMix` is an exponential approach, so a second of it in
  // one step and a second of it in 144 equal steps land in the same place.
  for (const target of WEATHER_KINDS) {
    const single = createWeatherMix('clear')
    advanceWeatherMix(single, target, 1)
    for (const hz of [30, 60, 144]) {
      const stepped = createWeatherMix('clear')
      stepMix(stepped, target, 1, hz)
      assert.ok(
        mixDistance(single, stepped) < 1e-12,
        `target ${target} at ${hz} Hz drifted by ${mixDistance(single, stepped)}`,
      )
    }
  }
})

test('the weather mix does not compose across a target change, which is the hazard', () => {
  // Same total time, same two targets, different moment of the change. This is the case
  // the roadmap names: the mix is fine, *when the target flips* is not, and where the
  // player is standing decides when it flips.
  //
  // The pair is clear and rain rather than rain and snow, and that choice is the
  // measurement. `stormFactor` is `rain + snow`, so a rain-to-snow transition moves the
  // *mix* and leaves the storm factor identical to sixteen decimal places — a real
  // ordering difference the chronicle cannot see. A crossing between a stormy biome and a
  // dry one is the one that reaches it, and that is exactly the crossing a player makes
  // walking out of the forest.
  const early = createWeatherMix('clear')
  stepMix(early, 'rain', 0.6, 60)
  stepMix(early, 'clear', 0.4, 60)

  const late = createWeatherMix('clear')
  stepMix(late, 'rain', 0.2, 60)
  stepMix(late, 'clear', 0.8, 60)

  assert.ok(
    mixDistance(early, late) > 0.01,
    `a target change must be order-sensitive, got ${mixDistance(early, late)}`,
  )
  assert.ok(
    Math.abs(computeStormFactor(early) - computeStormFactor(late)) > 0.1,
    'the ordering difference has to survive into the storm factor to matter',
  )

  // The rain-to-snow control, which is why the pair above was chosen: it moves the mix and
  // not the storm factor, so it is invisible to the chronicle.
  const stormyEarly = createWeatherMix('clear')
  stepMix(stormyEarly, 'rain', 0.25, 60)
  stepMix(stormyEarly, 'snow', 0.75, 60)
  const stormyLate = createWeatherMix('clear')
  stepMix(stormyLate, 'rain', 0.75, 60)
  stepMix(stormyLate, 'snow', 0.25, 60)
  assert.ok(
    mixDistance(stormyEarly, stormyLate) > 0.01,
    'the stormy pair must still differ in the mix',
  )
  assert.ok(
    Math.abs(computeStormFactor(stormyEarly) - computeStormFactor(stormyLate)) < 1e-9,
    'a stormy-to-stormy transition must be invisible to the storm factor',
  )

  // And the same change landing one 144 Hz frame apart is a smaller but real difference —
  // the resolution at which a schedule can move the answer.
  const atFrame = createWeatherMix('clear')
  stepMix(atFrame, 'rain', 0.5, 144)
  stepMix(atFrame, 'clear', 0.5, 144)
  const oneFrameLater = createWeatherMix('clear')
  stepMix(oneFrameLater, 'rain', 0.5 + 1 / 144, 144)
  stepMix(oneFrameLater, 'clear', 0.5 - 1 / 144, 144)
  assert.ok(
    mixDistance(atFrame, oneFrameLater) > 0,
    'a one-frame shift in the target change must be visible in the mix',
  )
})

test('a weather-target transition reaches advanceBeasts through stormFactor', () => {
  // The last link in the chain the roadmap describes: the mix difference above is only
  // interesting because it becomes a `stormFactor`, and `stormFactor` multiplies beast
  // growth inside `tickChronicle`. Nothing guarded this before.
  const blueprint = generateWorld(4_242)
  const protectedRegionIds = getChronicleProtectedRegionIds(blueprint)

  const early = createWeatherMix('clear')
  stepMix(early, 'rain', 0.6, 60)
  stepMix(early, 'clear', 0.4, 60)
  const late = createWeatherMix('clear')
  stepMix(late, 'rain', 0.2, 60)
  stepMix(late, 'clear', 0.8, 60)

  assert.ok(
    Math.abs(computeStormFactor(early) - computeStormFactor(late)) > 0.1,
    'the two transitions must produce different storm factors, or this proves nothing',
  )

  const run = (mix: WeatherMix): Map<string, number> => {
    const state = createChronicleState()
    const regions = createChronicleRegions(blueprint)
    const rng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:chronicle'))
    const environment = createChronicleEnvironment(0, mix)
    for (let tick = 0; tick < 8; tick += 1) {
      tickChronicle({
        blueprint,
        state,
        regions,
        rng,
        environment,
        playerFaction: 'elf',
        playerObjectiveRatio: 0,
        protectedRegionIds,
        frozenRegionIds: new Set<string>(),
      })
    }
    const pressure = new Map<string, number>()
    for (const [regionId, region] of regions) pressure.set(regionId, region.beastPressure)
    return pressure
  }

  const earlyPressure = run(early)
  const latePressure = run(late)
  let differing = 0
  for (const [regionId, value] of earlyPressure) {
    if (Math.abs(value - (latePressure.get(regionId) ?? 0)) > 1e-9) differing += 1
  }
  assert.ok(
    differing > 0,
    'a different storm factor must change beast pressure, or the chain is broken',
  )

  // Control: the same mix twice must produce identical pressure, so the difference above
  // is the storm factor and not the chronicle being non-deterministic.
  const repeat = run(early)
  for (const [regionId, value] of earlyPressure) {
    assert.equal(repeat.get(regionId), value, `chronicle must be deterministic at ${regionId}`)
  }
})

test('the harness sees weather targets flip at schedule-dependent moments', () => {
  // The engine-level shape of the same hazard: the target is resolved from the biome under
  // the player *after* the player has moved, so a coarser schedule samples the crossing at
  // a different point and can count a different number of flips.
  const seeds = [991, 424242, 20260729]
  let flipCountDivergences = 0
  for (const seed of seeds) {
    const arms = [30, 60, 144].map((hz) =>
      runHarness({ seed, faction: 'elf', policy: 'beeline', hz, timeLimit: 300 }),
    )
    if (new Set(arms.map((report) => report.weatherTargetChanges)).size > 1) {
      flipCountDivergences += 1
    }
  }
  assert.equal(
    flipCountDivergences,
    1,
    `weather-target flip counts diverged on ${flipCountDivergences} of ${seeds.length} seeds`,
  )
})

// ---------------------------------------------------------------------------
