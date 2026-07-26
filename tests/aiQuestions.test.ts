/**
 * The three Layer 3 questions that could not be answered when Layer 3 shipped, because
 * they live in per-frame actor AI rather than in the chronicle.
 *
 *   Q1. Does the wolf rout rule change how encounters end?
 *   Q2. Do beasts spend themselves on faction NPCs instead of the player?
 *   Q3. What does beasts-being-hostile-to-all-three actually do?
 *
 * Every answer is a side-by-side count across 60 seeded fights per arm, with the
 * mechanism switched on and off in the same harness. Metrics are **attacks and damage**,
 * which run to hundreds or thousands per batch, rather than deaths, which run to dozens —
 * the Layer 3 post-mortem was a null result on a metric too sparse to carry the question,
 * and deaths alone would repeat exactly that mistake.
 *
 * All three answers came out differently from the prediction written before the
 * measurement. That is recorded at each test rather than quietly corrected.
 *
 * Caveat, meant throughout: `tests/aiHarness.ts` runs the game's real decision code but
 * models movement and contact. These numbers describe what the decision logic does, not
 * what a player experiences.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import { BEAST_SENSE_RANGE } from '../src/game/world/Fauna.ts'
import type { Allegiance, BeastRole } from '../src/game/types.ts'
import {
  accumulate,
  makeFighter,
  runFight,
  type HarnessFighter,
  type HarnessOptions,
  type HarnessResult,
} from './aiHarness.ts'

const TRIALS = 60

/** A pack arriving together, the way `planBeastPack`'s roles converge on a settlement. */
function pack(roles: readonly BeastRole[], centreZ: number): HarnessFighter[] {
  // Morale is kin-relative, so each beast counts how many of its own kind set out.
  const kin = new Map<BeastRole, number>()
  for (const role of roles) kin.set(role, (kin.get(role) ?? 0) + 1)
  return roles.map((role, index) => {
    const angle = (index / roles.length) * Math.PI * 2
    return makeFighter('beast', role, Math.sin(angle) * 3, centreZ + Math.cos(angle) * 3, {
      packId: 'pack',
      packKinSize: kin.get(role) ?? 1,
      id: `beast-${index}`,
    })
  })
}

/** The settlement's own garrison: it fights beasts, and has no quarrel with the player. */
function garrison(count: number, allegiance: Allegiance = 'guard'): HarnessFighter[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = 0.4 + (index / count) * Math.PI * 2
    return makeFighter(allegiance, 'soldier', Math.sin(angle) * 4, Math.cos(angle) * 4, {
      id: `bystander-${index}`,
      hostileToPlayer: false,
      packId: null,
      packKinSize: 1,
    })
  })
}

function batch(
  label: string,
  build: () => HarnessFighter[],
  options: HarnessOptions,
): HarnessResult {
  const results: HarnessResult[] = []
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const rng = new RandomStream(deriveSeed('ai-questions', `${label}-${trial}`))
    results.push(runFight(build(), rng, options))
  }
  return accumulate(results)
}

const tally = (record: Record<string, number>, key: string): number => record[key] ?? 0

test('Q1: the rout rule now fires in shipped raids, and thins them when it does', () => {
  // History: measured at **0 routs in 120 fights** of these same compositions when Layer 3
  // shipped. Two local rules collided — a wrecker has 135-165 hp against a wolf's 42 and
  // `routThreshold` 0, so it always outlived its escorts and the survivor was the one role
  // that cannot break — and morale measured over the whole pack could never reach the
  // threshold anyway. Morale is now kin-relative and fires at exactly half, and packs are
  // sometimes wolves-only. This test pins the fix: if a future change makes routs stop
  // firing, Layer 3's headline behaviour is dead content again and this fails.
  const shipped: Array<[string, BeastRole[]]> = [
    ['forest raid', ['bear', 'wolf', 'wolf']],
    ['fort raid', ['troll', 'wolf', 'wolf']],
  ]
  for (const [label, roles] of shipped) {
    const armed = batch(`q1-${label}-on`, () => [...pack(roles, 15), ...garrison(3)], {
      packRoutEnabled: true,
    })
    const control = batch(`q1-${label}-off`, () => [...pack(roles, 15), ...garrison(3)], {
      packRoutEnabled: false,
    })
    assert.ok(
      tally(armed.deathsBy, 'beast') > 60,
      `${label} must be a real fight, got ${tally(armed.deathsBy, 'beast')} beast deaths`,
    )
    assert.ok(
      armed.routs >= TRIALS,
      `${label} should break a wolf in every fight, got ${armed.routs} routs`,
    )
    assert.equal(control.routs, 0, `${label} control arm must never rout`)
    assert.ok(
      tally(armed.fledBy, 'beast') > 0,
      'a broken wolf must leave the field, not stand and be killed',
    )
    // The consequence that matters: a raid that breaks up costs the settlement's
    // defenders far fewer lives. Measured ~178 → ~117 and ~180 → ~106 across 60 fights.
    assert.ok(
      tally(armed.deathsBy, 'guard') < tally(control.deathsBy, 'guard') * 0.8,
      `${label} should cost defenders fewer lives: ${tally(control.deathsBy, 'guard')} → ${tally(armed.deathsBy, 'guard')}`,
    )
  }

  // A pure wolf pack — the composition `planBeastPack` now sometimes builds — breaks
  // hardest, because every member is kin to every other.
  const purePack: BeastRole[] = ['wolf', 'wolf', 'wolf']
  const withRout = batch('q1-pure-on', () => [...pack(purePack, 15), ...garrison(3)], {
    packRoutEnabled: true,
  })
  const withoutRout = batch('q1-pure-off', () => [...pack(purePack, 15), ...garrison(3)], {
    packRoutEnabled: false,
  })
  assert.ok(withRout.routs >= TRIALS, `expected a rout per fight, got ${withRout.routs}`)
  assert.equal(withoutRout.routs, 0, 'the control arm must never rout')
  assert.ok(
    tally(withRout.deathsBy, 'beast') < tally(withoutRout.deathsBy, 'beast'),
    `routing should save wolves: ${tally(withoutRout.deathsBy, 'beast')} → ${tally(withRout.deathsBy, 'beast')}`,
  )

  // A single wolf escorting a wrecker has a kin size of one, so its share is always 1.
  // It never had a pack to lose and correctly never breaks — the rule is about cohesion,
  // not about being outnumbered.
  const loneWolf = batch(
    'q1-lone',
    () => [...pack(['bear', 'wolf', 'boar'], 15), ...garrison(3)],
    { packRoutEnabled: true },
  )
  assert.equal(loneWolf.routs, 0, 'a wolf with no kin has no pack to break')
})

test('Q2: beasts do not split their attention — the player is all-or-nothing', () => {
  // Prediction before measuring: beasts would spend themselves on the garrison and take
  // pressure off the player. Measured: the opposite, and it is not a tendency but a
  // switch. `updateActors` evaluated player pursuit *before* `findNearestEnemy`, so a
  // beast that could sense the player ignored every NPC in the square.
  //
  // **This is now the historical record, not current behaviour.** Layer 4 replaced that
  // ordering with `selectThreat`, which scores the player in the same pass as every NPC;
  // `tests/layer4Ai.test.ts` measures the removal against this arm. The test is kept
  // rather than deleted because a negative control is only worth anything if the "before"
  // side is real code — and the harness's Layer 3 arm still calls the real Layer 3
  // functions. If this ever stops being a clean step, the two arms of that comparison are
  // no longer measuring what they claim to.
  const build = (): HarnessFighter[] => [
    ...pack(['bear', 'wolf', 'wolf'], 15),
    ...garrison(3),
  ]

  const near = batch('q2-near', build, {
    packRoutEnabled: true,
    player: { x: 0, z: 0, hp: 1_000_000, damage: 0 },
    maxFrames: 1_500,
  })
  const far = batch('q2-far', build, {
    packRoutEnabled: true,
    player: { x: BEAST_SENSE_RANGE + 15, z: 0, hp: 1_000_000, damage: 0 },
    maxFrames: 1_500,
  })

  const nearTotal =
    tally(near.attacksAgainst, 'player') + tally(near.attacksAgainst, 'guard')
  const farTotal = tally(far.attacksAgainst, 'player') + tally(far.attacksAgainst, 'guard')
  assert.ok(
    nearTotal > 300 && farTotal > 300,
    `metrics must be dense: ${nearTotal} near, ${farTotal} far`,
  )

  // Standing in the raid: every single beast attack lands on the player.
  assert.ok(tally(near.attacksAgainst, 'player') > 0)
  assert.equal(
    tally(near.attacksAgainst, 'guard'),
    0,
    'a sensed player suppresses NPC targeting entirely',
  )
  // Hanging back beyond sense range: not one attack comes the player's way.
  assert.equal(
    tally(far.attacksAgainst, 'player'),
    0,
    'beyond sense range the player is not a target at all',
  )
  assert.ok(
    tally(far.attacksAgainst, 'guard') > 0,
    'and the garrison takes the whole raid instead',
  )
})

test('Q3: hostile-to-all-three is what ends a beast raid at all', () => {
  // Both arms are identical in count, position and pack. The only difference is the
  // matrix entry: whether the bystanders are something beasts want to eat.
  const armFor = (allegiance: Allegiance) => (): HarnessFighter[] => [
    ...pack(['bear', 'wolf', 'wolf'], 15),
    ...garrison(3, allegiance),
  ]
  const options: HarnessOptions = {
    packRoutEnabled: true,
    player: { x: 0, z: 0, hp: 1_000_000, damage: 0 },
    maxFrames: 1_500,
  }
  // `guard`: beasts are hostile to them, so they fight. `beast`: the matrix reads them as
  // pack, so the same bodies in the same places are simply ignored.
  const hostileBystanders = batch('q3-hostile', armFor('guard'), options)
  const ignoredBystanders = batch('q3-ignored', armFor('beast'), options)

  const withGarrison = tally(hostileBystanders.damageAgainst, 'player')
  const withoutGarrison = tally(ignoredBystanders.damageAgainst, 'player')
  assert.ok(withoutGarrison > 10_000, `metric must be dense, got ${withoutGarrison}`)

  // A garrison beasts are willing to fight destroys the pack and the raid ends. One that
  // beasts ignore leaves the player as the only thing in the square worth biting.
  assert.ok(
    withGarrison * 10 < withoutGarrison,
    `a hostile garrison should cut player damage by an order of magnitude: ${withoutGarrison.toFixed(0)} → ${withGarrison.toFixed(0)}`,
  )
  assert.ok(
    tally(hostileBystanders.deathsBy, 'beast') > 0,
    'the garrison must be able to kill beasts',
  )
  assert.equal(
    tally(ignoredBystanders.deathsBy, 'beast'),
    0,
    'ignored bystanders never end the raid',
  )
})
