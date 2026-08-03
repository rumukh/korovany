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
 * 4. **Roadmap 2.1's arm**, added when subset completion shipped. Every arm above varies
 *    the world; this one holds the world completely still and varies which road the player
 *    takes. See its own test for why that is the only reading 2.1's claim lives in.
 *
 * The measured corpus behind the bands is larger than the one CI runs. Over **120 seeds
 * per faction** with `MEASUREMENT_ARM`, completed campaigns printed **4 (elf), 4 (guard)
 * and 5 (villain)** distinct route lines, and the modal three-verb chronicle covered
 * **79 %, 81 % and 82 %** of them. The committed gate sweeps far fewer seeds so the suite
 * stays quick, and asserts bands rather than those numbers.
 *
 * **What roadmap 2.1 did and did not move here, stated before anyone reads a number off
 * this file.** Re-measured after subset completion shipped, over the same 120 seeds per
 * faction:
 *
 * | corpus                        | completed | routes | line agreement | square overlap |
 * | ----------------------------- | --------: | -----: | -------------: | -------------: |
 * | pre-2.1 (PR #84, elf)         |        85 |      4 |          0.787 |          0.852 |
 * | shipped 2.1, elf              |        93 |      4 |          0.787 |          0.846 |
 * | shipped 2.1, guard            |        98 |      4 |          0.786 |          0.841 |
 * | shipped 2.1, villain          |        84 |      5 |          0.778 |          0.844 |
 * | 2.1 with exclusivity removed  |        79 |      4 |          0.787 |          0.877 |
 *
 * **Across seeds the route still does not move, and 2.1 never claimed it would** — that was
 * PR #84's finding about the *seed*, and this initiative changed the player's options
 * rather than the generator's. What did move is the square overlap, by 0.031 against its
 * own matched control (0.846 against 0.877 with `optional`/`exclusiveGroup` stripped), and
 * that is a small number honestly reported rather than a large one dressed up. The reading
 * 2.1's claim actually lives in is test 4 below, where the world is held still.
 *
 * **The route-order fix, as a separate line item.** `RegionManager.getDiscoveredRegionIds`
 * used to sort the discovered set into row-major grid order, so the «Маршрут» line a player
 * read was the low corner of the map rather than a path. It returns discovery order now.
 * **Not one number above moved**, and that is the point rather than a relief: this module
 * always judged on the discovery-order reading, and the harness builds its own discovered
 * set, so the fix could only ever change what the *engine* prints. What it changed is the
 * one column that measured that:
 *
 * | 120 seeds | walked line | shipped line, before | shipped line, after | grid lines | walked lines |
 * | --------- | ----------: | -------------------: | ------------------: | ---------: | -----------: |
 * | elf       |       0.787 |            **0.674** |           **0.787** |          6 |            4 |
 * | guard     |       0.786 |            **0.350** |           **0.786** |         11 |            4 |
 * | villain   |       0.778 |            **0.353** |           **0.778** |         17 |            5 |
 *
 * The last two columns are the sharpest statement of the defect available, and they correct
 * this module's own earlier phrasing. The shipped line was never *flat* — sorted, it printed
 * **17 distinct "routes" for the villain where there are 5**, because the eight labels
 * `MAX_EPILOGUE_ROUTE` prints were the eight lowest-numbered squares of whatever set a run
 * discovered. It varied more than the truth, and varied for a reason that had nothing to do
 * with the road taken.
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
  runChoiceArm,
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

/**
 * A seed the scripted player finishes, so the control compares two completed campaigns.
 *
 * Was 1 until roadmap 2.1; the exclusive fork changed which arm the seeded player walks on
 * that seed and it stopped finishing inside the arm's clock. Re-picked by the same rule
 * (elf and villain both complete it) rather than by loosening the control, because a corpus
 * with a truncated campaign in it is exactly what this control exists to refuse.
 */
const CONTROL_SEED = 2

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
  for (const metric of ['route', 'routeDiscovered', 'routeGridOrder', 'cause', 'control', 'controlBase', 'controlShift', 'controlMap', 'controlDelta', 'beatShape', 'beatVerbs', 'encounterMix'] as const) {
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

  // **The route-order regression guard, on a real corpus.** The postcard's line and the
  // discovery-order line used to be different readings of the same run, and this module
  // judged on the second because the first was not a path at all. The engine hands over the
  // discovery order now, so they are the same line and the same statistic, and the
  // grid-ordered reading is kept as the thing that must not come back.
  assert.equal(
    report.shippedRouteLineAgreement,
    report.routeLineAgreement,
    'what the postcard prints has come apart from the discovery order again',
  )
  assert.equal(
    report.fields.route.distinct,
    report.fields.routeDiscovered.distinct,
    'the shipped line and the discovery-order line disagree about how many routes there are',
  )
  // Non-vacuity, and a correction worth recording rather than deleting. The first draft of
  // this guard asserted the grid ordering was *flatter* — that a line which is the low
  // corner of the map would agree more between two runs. **It is the other way round**, and
  // this assertion is what found that: measured on the CI panel, grid order agrees 0.673
  // against the walked line's 0.823, and on the 120-seed elf corpus 0.674 against 0.787.
  // The reason is `MAX_EPILOGUE_ROUTE`: sorted, the eight printed labels are the eight
  // lowest-numbered squares of whatever set the run happened to discover, so they move with
  // the *set*; walked, they are the corridor out of the start, which a pinned faction shares.
  // So the shipped line was never "flat" — it varied, and varied for a reason that has
  // nothing to do with the road taken. The guard is therefore that the two differ at all.
  assert.notEqual(
    report.gridOrderRouteLineAgreement,
    report.routeLineAgreement,
    'the grid-sorted line and the walked line score identically, so the sort is back',
  )
})

// ---------------------------------------------------------------------------
// 4. Roadmap 2.1 — the route the *player* moves
// ---------------------------------------------------------------------------

test('the same world walked down its two roads is not the same route', () => {
  // **What this arm is for.** Every other arm here varies the world — the seed, the
  // faction, the dice, the layout — and PR #84's finding was that the route does not move
  // with the seed. Roadmap 2.1 never claimed it would. Its claim is the other one: that a
  // *player* can move the route with the world held completely still, which is exactly what
  // 1.4's all-required fork could not offer.
  //
  // So this holds the seed, the faction, the layout, the chronicle and the dice still and
  // varies one thing: which arm of the fork is taken. `firstReady` walks the faction's
  // signature contract, `contrary` walks the alternative, and the pair is compared to
  // itself.
  //
  // **Measured over 60 seeds per faction, on victories where both roads finished:**
  //
  // | shape         | faction | pairs | line agreement | square overlap |
  // |---------------|---------|------:|---------------:|---------------:|
  // | branched      | elf     |    30 |          0.775 |     **0.863**  |
  // | branched      | guard   |    39 |          0.795 |     **0.890**  |
  // | branched      | villain |    24 |          0.766 |     **0.849**  |
  // | `allRequired` | elf     |    25 |          0.785 |       0.910    |
  // | `allRequired` | guard   |    29 |          0.737 |       0.933    |
  // | `allRequired` | villain |    23 |          0.717 |       0.942    |
  //
  // The `allRequired` rows are the matched control: the same two policies on the same
  // worlds with only `optional`/`exclusiveGroup` removed, so both runs walk **both** arms
  // and differ in nothing but the order. They still print different route *lines* — walking
  // the same two places in a different order changes what streams in when — which is why
  // the line-agreement column cannot discriminate here and the **square overlap** is what
  // this test judges on. An exclusive choice removes squares the other road would have
  // shown; an ordering does not.
  const seeds = seedCount()
  // One faction in the committed gate, and it is stated rather than hidden: this arm walks
  // two whole runs per seed per shape, and sweeping all three factions took 161 s of CI for
  // a comparison the table above already records for all of them. The guard is chosen
  // because it completes most often, so the panel yields the most usable pairs per second.
  // `KOROVANY_SEED_VARIANCE_SEEDS` widens it; `runChoiceArm` takes a faction.
  const measure = (shape: 'branched' | 'allRequired'): { overlap: number; pairs: number; varied: number } => {
    let overlap = 0
    let pairs = 0
    let varied = 0
    for (const pair of runChoiceArm('guard', { seeds }, shape)) {
      if (
        pair.first.report.outcome !== 'victory' ||
        pair.contrary.report.outcome !== 'victory'
      ) {
        continue
      }
      pairs += 1
      overlap += measureSeedVariance([pair.first, pair.contrary]).routeOverlap
      // Sets, not sequences. The control walks both arms in both runs and may walk them in
      // either order, which is an ordering rather than a route — the exact distinction 1.4
      // shipped and this initiative replaced.
      const first = [...pair.first.report.contracts.route].sort().join('+')
      const contrary = [...pair.contrary.report.contracts.route].sort().join('+')
      if (first !== contrary) varied += 1
    }
    return { overlap: overlap / Math.max(1, pairs), pairs, varied }
  }

  const branched = measure('branched')
  const required = measure('allRequired')

  // Non-vacuity, twice over. The arm has to have produced pairs at all, and every one of
  // them has to have actually taken different roads — otherwise the comparison below is
  // between a policy and itself.
  assert.ok(branched.pairs >= 5, `only ${branched.pairs} completed pairs to compare`)
  assert.ok(required.pairs >= 5, `only ${required.pairs} completed control pairs`)
  assert.equal(
    branched.varied,
    branched.pairs,
    'the two policies walked the same campaign route, so nothing was exclusive',
  )
  // And the control walks *both* arms in both runs, so its "routes" are the same set every
  // time — which is 1.4's shape, reproduced.
  assert.equal(
    required.varied,
    0,
    'the all-required control closed different sets of nodes, so it is not a matched control',
  )

  // **The finding.** Choosing a road drops squares the other road would have shown; merely
  // reordering the same two errands does not.
  assert.ok(
    branched.overlap < required.overlap - 0.01,
    `exclusive choice overlapped ${branched.overlap.toFixed(3)} against an ordering-only ` +
      `control at ${required.overlap.toFixed(3)} — the choice is not removing any ground`,
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
