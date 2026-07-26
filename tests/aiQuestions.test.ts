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
  return roles.map((role, index) => {
    const angle = (index / roles.length) * Math.PI * 2
    return makeFighter('beast', role, Math.sin(angle) * 3, centreZ + Math.cos(angle) * 3, {
      packId: 'pack',
      packSize: roles.length,
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
      packSize: 1,
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

test('Q1: the rout rule works, and never once fires in a shipped raid', () => {
  // Prediction before measuring: routing would cut beast losses in a normal raid.
  // Measured: it does — but only for a pack that is mostly wolves, which is not a pack
  // `planBeastPack` ever builds.
  const shipped: Array<[string, BeastRole[]]> = [
    ['forest raid', ['bear', 'wolf', 'wolf']],
    ['fort raid', ['troll', 'wolf', 'wolf']],
  ]
  for (const [label, roles] of shipped) {
    const armed = batch(`q1-${label}`, () => [...pack(roles, 15), ...garrison(3)], {
      packRoutEnabled: true,
    })
    assert.ok(
      tally(armed.deathsBy, 'beast') > 60,
      `${label} must be a real fight, got ${tally(armed.deathsBy, 'beast')} beast deaths`,
    )
    // The finding. A wrecker has 135-165 hp against a wolf's 42, so it always outlives
    // its escorts — and `routThreshold` is 0 for bears and trolls. By the time half the
    // pack is down, the only survivor is the one role that cannot break.
    assert.equal(
      armed.routs,
      0,
      `${label} routed ${armed.routs} times — if this now fires, the finding in §9 is stale`,
    )
  }

  // The rule itself is not broken; it is unreachable. A pack that is mostly wolves
  // breaks in every single fight.
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
    tally(withRout.fledBy, 'beast') > 0,
    'a broken wolf must actually leave the field, not stand and be killed',
  )
  // And when it fires it matters: a third of the pack walks away alive, and the garrison
  // loses fewer of its own because the fight ends sooner.
  assert.ok(
    tally(withRout.deathsBy, 'beast') < tally(withoutRout.deathsBy, 'beast'),
    `routing should save wolves: ${tally(withoutRout.deathsBy, 'beast')} → ${tally(withRout.deathsBy, 'beast')}`,
  )
  assert.ok(
    tally(withRout.deathsBy, 'guard') <= tally(withoutRout.deathsBy, 'guard'),
    `routing should not cost defenders: ${tally(withoutRout.deathsBy, 'guard')} → ${tally(withRout.deathsBy, 'guard')}`,
  )
})

test('Q2: beasts do not split their attention — the player is all-or-nothing', () => {
  // Prediction before measuring: beasts would spend themselves on the garrison and take
  // pressure off the player. Measured: the opposite, and it is not a tendency but a
  // switch. `updateActors` evaluates player pursuit *before* `findNearestEnemy`, so a
  // beast that can sense the player ignores every NPC in the square.
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
