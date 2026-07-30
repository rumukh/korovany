/**
 * Roadmap 2.2's gating question, made checkable: **do two seeds produce two runs?**
 *
 * `docs/STRATEGY.md` defers 2.2 "until run epilogues and player evidence show that seeds
 * still feel interchangeable after 1.5", and open disagreement (b) records two authors who
 * do not agree about the answer. `tests/seedVariance.ts` is the instrument; this file is
 * the part of it that has to keep being true, and the three tests below are three different
 * ways of not fooling ourselves:
 *
 * 1. **The negative control.** Hold the world completely still and change nothing but the
 *    combat stream's salt. Every structural field must come back identical. A route or a
 *    control tally that moved here would be reading dice, and every cross-seed number this
 *    measurement produces would be worthless. This is the same discipline as 1.3's placebo
 *    arm and 1.5's per-axis ablation, pointed at this measurement's own failure mode.
 *
 * 2. **The positive control.** Change the faction instead and the route line *must* move,
 *    because a metric that reports "no divergence" for everything is not evidence of
 *    anything. Without this, "the route does not move across seeds" is unfalsifiable.
 *
 * 3. **The finding itself, as a band.** With the faction pinned, completed campaigns print
 *    a handful of route lines and mostly the same three chronicle verbs. That is a fact
 *    about the generator as it stands, not a target — and if someone ever lands 2.2, this
 *    is the test that fails and says "re-read the decider", exactly as
 *    `worldVariety.test.ts`'s anchor-exclusion test is written to fail when 2.2 frees
 *    `ENDPOINTS`.
 *
 * The measured corpus behind the bands is larger than the one CI runs. Over **120 seeds
 * per faction** with `MEASUREMENT_ARM`, completed campaigns printed **4 (elf), 4 (guard)
 * and 5 (villain)** distinct route lines, and the modal three-verb chronicle covered
 * **79 %, 81 % and 82 %** of them. The committed gate sweeps far fewer seeds so the suite
 * stays quick, and asserts bands rather than those numbers.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { WORLD_FACTIONS, type WorldBlueprint } from '../src/game/world/worldTypes.ts'
import { collapseAxis } from './worldVariety.ts'
import {
  METRIC_FIELDS,
  VARIANCE_METRICS,
  measureRunFields,
  measureSeedVariance,
  runAblatedArm,
  runFactionArm,
  runNoiseArm,
  runSeedArm,
  type MeasuredRun,
} from './seedVariance.ts'

/**
 * How many seeds the committed gate walks. Small by default so the suite stays quick; the
 * measurement's own figure is one environment variable away.
 */
function seedCount(): number {
  const raw = Number(process.env.KOROVANY_SEED_VARIANCE_SEEDS)
  return Number.isInteger(raw) && raw > 0 ? raw : 18
}

/** A seed the scripted player finishes, so the control compares two completed campaigns. */
const CONTROL_SEED = 1

function victories(runs: readonly MeasuredRun[]): MeasuredRun[] {
  return runs.filter((run) => run.report.outcome === 'victory')
}

// ---------------------------------------------------------------------------
// 1. The negative control
// ---------------------------------------------------------------------------

test('the negative control holds: with the world fixed, the dice move nothing structural', () => {
  const runs = runNoiseArm(CONTROL_SEED, 'elf', 12)
  assert.equal(runs.length, 12)
  assert.equal(
    measureSeedVariance(runs).completionRate,
    1,
    'the control seed has to be one the scripted player finishes, or it is comparing a ' +
      'completed campaign against a truncated one',
  )

  const report = measureSeedVariance(runs)
  for (const metric of ['route', 'routeDiscovered', 'cause', 'control', 'controlBase', 'controlShift', 'controlMap', 'controlDelta', 'beatShape', 'beatVerbs', 'encounterMix'] as const) {
    assert.equal(
      report.fields[metric].distinct,
      1,
      `${metric} moved under combat noise alone, so it is reading dice rather than world ` +
        'structure and no cross-seed reading of it means anything',
    )
  }

  // And the salt must actually be doing something, or the control is a tautology: the
  // damage rolls are the one thing it is allowed to change, and they have to change.
  assert.ok(
    report.fields.bodyProxy.distinct > 1,
    'salting the combat stream changed no damage at all, so the control proves nothing',
  )
})

// ---------------------------------------------------------------------------
// 2. The positive control
// ---------------------------------------------------------------------------

test('the positive control holds: the route metric can show divergence, and does', () => {
  const seeds = 3
  const byFaction = runFactionArm(WORLD_FACTIONS, { seeds })
  const bySeed = new Map<number, MeasuredRun[]>()
  for (const run of byFaction) {
    bySeed.set(run.report.seed, [...(bySeed.get(run.report.seed) ?? []), run])
  }
  assert.equal(bySeed.size, seeds)

  for (const runs of bySeed.values()) {
    const report = measureSeedVariance(runs)
    // One world, three factions: three different routes, and hardly any agreement between
    // them. If this ever collapsed, "seeds do not move the route" would stop being a
    // finding and start being an instrument that cannot see a route at all.
    assert.equal(
      report.fields.routeDiscovered.distinct,
      3,
      'three factions in one world walked the same route',
    )
    assert.ok(
      report.routeLineAgreement < 0.4,
      `three factions agreed on ${report.routeLineAgreement} of their route line`,
    )
    // The same world, so the territory the generator handed out is identical — which is
    // what makes the *base* tally the one control metric that must not move here.
    assert.equal(report.fields.controlBase.distinct, 1)
  }
})

// ---------------------------------------------------------------------------
// 3. The finding
// ---------------------------------------------------------------------------

test('with the faction pinned, completed campaigns still print a handful of routes', () => {
  const seeds = seedCount()
  const runs = victories(runSeedArm('elf', { seeds }))
  assert.ok(
    runs.length >= seeds / 2,
    `only ${runs.length} of ${seeds} runs finished; the arm is measuring a clock`,
  )
  const report = measureSeedVariance(runs)

  // The band, not the number. Measured at 4 distinct routes over 85 completed elf
  // campaigns across 120 seeds; the ceiling is generous and still far below "every seed
  // is its own route".
  assert.ok(
    report.fields.routeDiscovered.distinct <= Math.max(6, Math.round(runs.length * 0.4)),
    `${report.fields.routeDiscovered.distinct} distinct routes over ${runs.length} completed ` +
      'campaigns — if this rose, someone made seeds matter and the 2.2 decider needs re-reading',
  )
  assert.ok(
    report.routeLineAgreement > 0.5,
    `route lines agreed on only ${report.routeLineAgreement} of their positions`,
  )
  // Two runs walk most of the same squares. The corridor, measured.
  assert.ok(
    report.routeOverlap > 0.7,
    `two runs shared only ${report.routeOverlap} of their squares`,
  )

  // 1.2's claim about beat-shape, quantified: most runs print the same three verbs.
  assert.ok(
    report.fields.beatVerbs.modeShare > 0.5,
    `the modal three-verb chronicle covered only ${report.fields.beatVerbs.modeShare} of runs`,
  )

  // And the two fields that *do* move, so this is a finding rather than a flat line.
  assert.ok(
    report.fields.controlMap.distinctShare > 0.7,
    'the twenty-five-square control map is supposed to be nearly unique per seed',
  )
  assert.ok(
    report.meanControlDelta > 1,
    'a run that changes no square at all would make the control reading meaningless',
  )
})

// ---------------------------------------------------------------------------
// Hygiene: coverage, ablation liveness, determinism
// ---------------------------------------------------------------------------

test('every сводка field owns a metric, and every metric owns a field', () => {
  const fields = new Set(VARIANCE_METRICS.map((metric) => METRIC_FIELDS[metric]))
  for (const field of ['route', 'cause', 'body', 'control', 'beatShape', 'encounters']) {
    assert.ok(fields.has(field as never), `no metric covers the ${field} field`)
  }
  assert.equal(fields.size, 6)
})

test('the ablation arm is live: collapsing an axis really collapses it', () => {
  // The blueprint half needs no runs at all, so it is measured on blueprints.
  const shipped = Array.from({ length: 12 }, (_, index) => generateWorld(1 + index * 7919))
  const riverShapes = (worlds: readonly WorldBlueprint[]): number =>
    new Set(worlds.map((world) => world.river.regionPath.join('>'))).size
  const placements = (worlds: readonly WorldBlueprint[]): number =>
    new Set(
      worlds.map((world) =>
        world.sites.map((site) => `${site.id}=${site.regionId}`).join('|'),
      ),
    ).size

  assert.ok(riverShapes(shipped) > 1, 'the shipped corpus has only one river shape')
  assert.ok(placements(shipped) > 1, 'the shipped corpus has only one site placement')

  const collapsed = collapseAxis(collapseAxis(shipped, 'river'), 'optionalSites')
  assert.equal(riverShapes(collapsed), 1, 'collapsing the river axis left several rivers')
  assert.equal(placements(collapsed), 1, 'collapsing the site axis left several placements')

  // And an ablated world must still be walkable, or the baseline arm is measuring a
  // broken generator rather than an older one.
  const walked = runAblatedArm('elf', ['river', 'optionalSites'], { seeds: 2 })
  assert.ok(walked.some((run) => run.report.outcome === 'victory'))
})

test('the measurement is deterministic, which is what makes its numbers comparable', () => {
  const first = measureSeedVariance(runSeedArm('guard', { seeds: 2 }))
  const second = measureSeedVariance(runSeedArm('guard', { seeds: 2 }))
  assert.deepEqual(second, first)
  assert.deepEqual(
    measureRunFields(runNoiseArm(CONTROL_SEED, 'villain', 1)[0]),
    measureRunFields(runNoiseArm(CONTROL_SEED, 'villain', 1)[0]),
  )
})
