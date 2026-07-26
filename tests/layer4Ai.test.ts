/**
 * Layer 4 — what stronger NPC AI actually changed, counted side by side.
 *
 * Every claim here is two arms of the *same* harness with one mechanism switched, using
 * shipped code on both sides: the Layer 3 arm calls `selectCombatTarget` and the
 * cohesion-only rout, which are still exported for exactly this reason, and the Layer 4
 * arm calls `selectThreat` and `evaluateMorale`. Neither arm is a re-implementation, so
 * an agreement between them would be a real agreement and a divergence a real one.
 *
 * Metrics are **attacks, damage and rout events**, which run to hundreds or thousands per
 * batch. Deaths appear only where they are dense enough to carry a claim, and never alone.
 *
 * Caveat, meant throughout: `tests/aiHarness.ts` runs the game's real decision code but
 * models movement and contact. These numbers describe what the decision logic does, not
 * what a player experiences. **Nothing here is about flanking** — flanking is an approach
 * path and needs the steering and separation this harness does not have; its rules are
 * tested as geometry in `tests/actorAi.test.ts` and checked by eye in the browser.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import type { ActorRole, Allegiance, BeastRole } from '../src/game/types.ts'
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
function garrison(count: number): HarnessFighter[] {
  return ring(count, 'guard', 'soldier', 'bystander')
}

/** A knot of allies standing round a point, which is how a garrison holds a site. */
function ring(
  count: number,
  allegiance: Allegiance,
  role: ActorRole,
  prefix: string,
): HarnessFighter[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = 0.4 + (index / count) * Math.PI * 2
    return makeFighter(allegiance, role, Math.sin(angle) * 4, Math.cos(angle) * 4, {
      id: `${prefix}-${index}`,
      hostileToPlayer: false,
      packId: null,
      packKinSize: 1,
    })
  })
}

/**
 * A rank facing another rank at 12 m — inside a soldier's 15 m sense range, and far
 * enough apart that the two sides are distinguishable rather than one crowd.
 */
function line(
  allegiance: Allegiance,
  count: number,
  z: number,
  role: ActorRole = 'soldier',
): HarnessFighter[] {
  return Array.from({ length: count }, (_, index) =>
    makeFighter(allegiance, role, (index - (count - 1) / 2) * 2.4, z, {
      id: `${allegiance}-${index}`,
      hostileToPlayer: false,
    }),
  )
}

function batch(
  label: string,
  build: () => HarnessFighter[],
  options: HarnessOptions,
): HarnessResult {
  const results: HarnessResult[] = []
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const rng = new RandomStream(deriveSeed('ai-layer4', `${label}-${trial}`))
    results.push(runFight(build(), rng, options))
  }
  return accumulate(results)
}

const tally = (record: Record<string, number>, key: string): number => record[key] ?? 0

test('threat scoring replaces the 21 m step function with a mix', () => {
  // §9 Q2 measured Layer 3's targeting as a step function: standing in the raid, 100% of
  // beast attacks landed on the player and 0% on the garrison. That is what Layer 4's
  // threat scoring exists to remove, and both arms are kept so the removal is visible
  // rather than asserted.
  const build = (): HarnessFighter[] => [
    ...pack(['bear', 'wolf', 'wolf'], 15),
    ...garrison(3),
  ]
  const options: HarnessOptions = {
    packRoutEnabled: true,
    individualMorale: true,
    player: { x: 0, z: 0, hp: 1_000_000, damage: 0 },
    maxFrames: 1_500,
  }
  const layer3 = batch('step-off', build, { ...options, threatScoring: false })
  const layer4 = batch('step-on', build, { ...options, threatScoring: true })

  const dense = (result: HarnessResult): number =>
    tally(result.attacksAgainst, 'player') + tally(result.attacksAgainst, 'guard')
  assert.ok(
    dense(layer3) > 300 && dense(layer4) > 300,
    `metrics must be dense: ${dense(layer3)} vs ${dense(layer4)}`,
  )

  // The control: Layer 3's rule is still exactly a step. If this ever stops being zero,
  // the two arms are no longer measuring what this test says they measure.
  assert.equal(
    tally(layer3.attacksAgainst, 'guard'),
    0,
    'the Layer 3 arm must still put every beast attack on the player',
  )
  // And the change: the garrison is now part of the fight, without the player becoming
  // irrelevant. Measured 0 → 600 attacks on the garrison over 60 fights.
  assert.ok(
    tally(layer4.attacksAgainst, 'guard') > 100,
    `threat scoring must give the garrison a share: ${tally(layer4.attacksAgainst, 'guard')}`,
  )
  assert.ok(
    tally(layer4.attacksAgainst, 'player') > 100,
    'and must not make the player irrelevant either',
  )
})

test('beyond sense range the player is still not a target, which is not the step', () => {
  // Worth pinning separately, because it looks like the step function surviving and is
  // not. Inside sense range the split is now a mix; outside it the player is simply not
  // a legal candidate, and `evaluatePlayerPursuit` — not the scoring — is what says so.
  const far = batch(
    'far-on',
    () => [...pack(['bear', 'wolf', 'wolf'], 15), ...garrison(3)],
    {
      packRoutEnabled: true,
      individualMorale: true,
      threatScoring: true,
      player: { x: 60, z: 0, hp: 1_000_000, damage: 0 },
      maxFrames: 1_500,
    },
  )
  assert.ok(tally(far.attacksAgainst, 'guard') > 300, 'the raid must still happen')
  assert.equal(
    tally(far.attacksAgainst, 'player'),
    0,
    'a player nobody can see takes no hits',
  )
})

test('threat scoring takes the player out of the middle of a raid', () => {
  // The consequence that matters for play. The player watches a raid from six metres
  // away rather than standing in it, and is no longer the only thing in the square worth
  // biting. Measured over 60 fights: damage taken 73,286 → 6,284, and the raid resolves
  // — beast deaths 60 → 116 — because the beasts fight the garrison that can kill them.
  const build = (): HarnessFighter[] => [
    ...pack(['bear', 'wolf', 'wolf'], 15),
    ...garrison(3),
  ]
  const options: HarnessOptions = {
    packRoutEnabled: true,
    individualMorale: true,
    player: { x: 6, z: 6, hp: 1_000_000, damage: 0 },
    maxFrames: 1_500,
  }
  const layer3 = batch('bystander-off', build, { ...options, threatScoring: false })
  const layer4 = batch('bystander-on', build, { ...options, threatScoring: true })

  assert.ok(
    tally(layer3.damageAgainst, 'player') > 10_000,
    `metric must be dense: ${tally(layer3.damageAgainst, 'player')}`,
  )
  assert.ok(
    tally(layer4.damageAgainst, 'player') * 5 < tally(layer3.damageAgainst, 'player'),
    `standing aside should cost far less: ${tally(layer3.damageAgainst, 'player').toFixed(0)} → ${tally(layer4.damageAgainst, 'player').toFixed(0)}`,
  )
  assert.equal(
    tally(layer3.attacksAgainst, 'guard'),
    0,
    'control: under Layer 3 the garrison was never touched while the player was visible',
  )
  assert.ok(
    tally(layer4.deathsBy, 'beast') > tally(layer3.deathsBy, 'beast'),
    `and the raid should now actually resolve: ${tally(layer3.deathsBy, 'beast')} → ${tally(layer4.deathsBy, 'beast')}`,
  )
})

test('individual morale breaks the lone wolf cohesion correctly cannot', () => {
  // The case §9 named and deliberately left alone: `bear+wolf+boar` carries a single
  // wolf, so its kin size is 1, its pack share is permanently 1, and the cohesion rule
  // can never fire. That was the right answer for a *cohesion* rule. Breaking a wolf
  // standing over its dead bear is the individual half's job, and this is the test that
  // says it does it.
  const build = (): HarnessFighter[] => [
    ...pack(['bear', 'wolf', 'boar'], 15),
    ...garrison(3),
  ]
  const cohesionOnly = batch('lone-off', build, {
    packRoutEnabled: true,
    individualMorale: false,
  })
  const unified = batch('lone-on', build, {
    packRoutEnabled: true,
    individualMorale: true,
  })

  assert.ok(
    tally(cohesionOnly.attacksBy, 'beast') > 500,
    `the fight must be real: ${tally(cohesionOnly.attacksBy, 'beast')} beast attacks`,
  )
  assert.equal(cohesionOnly.routs, 0, 'cohesion alone still never breaks a lone wolf')
  assert.ok(
    tally(unified.routsByRole, 'wolf') >= TRIALS,
    `the wolf should break in every fight: ${tally(unified.routsByRole, 'wolf')}`,
  )
  assert.equal(
    tally(unified.routsByRole, 'boar') + tally(unified.routsByRole, 'bear'),
    0,
    'a boar and a bear never rout, however the rule is reached',
  )
  assert.equal(
    tally(unified.routsByReason, 'cohesion'),
    0,
    'and none of it comes through the cohesion door',
  )
  assert.ok(
    tally(unified.fledBy, 'beast') > 0,
    'a broken wolf leaves the field rather than standing to be killed',
  )
})

test('cohesion still governs packs after the two rules were unified', () => {
  // The other half of the unification: adding individual morale must not have quietly
  // replaced Layer 3's rule. Compositions with real kin still break by cohesion.
  for (const roles of [
    ['bear', 'wolf', 'wolf'],
    ['wolf', 'wolf', 'wolf'],
  ] as BeastRole[][]) {
    const result = batch(
      `cohesion-${roles.join('-')}`,
      () => [...pack(roles, 15), ...garrison(3)],
      { packRoutEnabled: true, individualMorale: true },
    )
    assert.ok(
      tally(result.routsByReason, 'cohesion') > 0,
      `${roles.join('+')} must still break by cohesion, got ${JSON.stringify(result.routsByReason)}`,
    )
  }
})

test('roles that must never break do not, even while being killed', () => {
  // Campaign safety, and the assertion that caught a real defect. `ROLE_RESOLVE` was a
  // `Partial` read with `?? 0`, which turned every `null` — "never breaks" — back into
  // "breaks like a soldier": commanders and champions routed in 60 fights out of 60.
  // The positive control is the point of the test: they have to be in genuine danger,
  // or "never routed" would be indistinguishable from "was never threatened".
  for (const role of ['commander', 'champion'] as ActorRole[]) {
    const result = batch(
      `steady-${role}`,
      () => [...line('guard', 1, -6, role), ...line('elf', 4, 6)],
      { packRoutEnabled: true, individualMorale: true, maxFrames: 3_000 },
    )
    assert.ok(
      tally(result.deathsBy, 'guard') >= TRIALS,
      `${role} must actually be dying in this scenario: ${tally(result.deathsBy, 'guard')} deaths`,
    )
    assert.equal(result.routs, 0, `${role} must never rout, got ${result.routs}`)
  }
})

test('morale makes a fight decisive instead of mutually annihilating', () => {
  // Two identical ranks of four. Without morale they wipe each other out and one man is
  // left standing on each side; with it, one side breaks and the other walks away whole.
  //
  // **Which** side wins is an artefact of this harness: fighters act in array order, so
  // whoever is listed first lands the first blow of each frame, and morale turns that
  // consistent half-frame edge into a rout. The swapped control below proves exactly
  // that, and is why this test claims decisiveness and not an advantage for anybody.
  const options: HarnessOptions = {
    packRoutEnabled: true,
    maxFrames: 3_000,
  }
  const build = (): HarnessFighter[] => [...line('guard', 4, -6), ...line('elf', 4, 6)]
  const swapped = (): HarnessFighter[] => [...line('elf', 4, 6), ...line('guard', 4, -6)]

  const attrition = batch('lines-off', build, { ...options, individualMorale: false })
  const morale = batch('lines-on', build, { ...options, individualMorale: true })
  const moraleSwapped = batch('lines-swap-on', swapped, {
    ...options,
    individualMorale: true,
  })

  const totalAttacks = (result: HarnessResult): number =>
    tally(result.attacksBy, 'guard') + tally(result.attacksBy, 'elf')
  assert.ok(
    totalAttacks(attrition) > 2_000 && totalAttacks(morale) > 2_000,
    `metrics must be dense: ${totalAttacks(attrition)} vs ${totalAttacks(morale)}`,
  )
  assert.equal(attrition.routs, 0, 'the control arm must never rout')
  assert.ok(morale.routs > 100, `morale must actually fire: ${morale.routs} routs`)

  const survivors = (result: HarnessResult): number =>
    tally(result.survivorsBy, 'guard') + tally(result.survivorsBy, 'elf')
  // Measured: 2 survivors across 60 fights without morale, 240 with it.
  assert.ok(
    survivors(morale) > survivors(attrition) * 10,
    `morale should leave a side standing: ${survivors(attrition)} → ${survivors(morale)}`,
  )
  // The control that keeps the claim honest: swap the listing order and the winner
  // swaps with it, so nothing here is a statement about guards or elves.
  assert.ok(
    tally(morale.survivorsBy, 'guard') > tally(morale.survivorsBy, 'elf') &&
      tally(moraleSwapped.survivorsBy, 'elf') > tally(moraleSwapped.survivorsBy, 'guard'),
    'the winning side must follow the iteration order, not the allegiance',
  )
})

test('threat scoring makes an archer shoot past the thing it cannot hurt', () => {
  // Three archers against a brute standing in front of an enemy archer. Nearest-wins
  // sends them at the brute; role preference sends them at the archer. Metric is attacks
  // by the role that took them, which runs to hundreds.
  const build = (): HarnessFighter[] => [
    ...ring(3, 'guard', 'archer', 'guard-archer'),
    makeFighter('elf', 'brute', 0, 9, { id: 'elf-brute', hostileToPlayer: false }),
    makeFighter('elf', 'archer', 1.6, 11, { id: 'elf-archer', hostileToPlayer: false }),
  ]
  const nearest = batch('archer-off', build, {
    packRoutEnabled: true,
    threatScoring: false,
    maxFrames: 3_000,
  })
  const scored = batch('archer-on', build, {
    packRoutEnabled: true,
    threatScoring: true,
    maxFrames: 3_000,
  })

  const ratio = (result: HarnessResult): number =>
    tally(result.attacksAgainstRole, 'archer') /
    Math.max(1, tally(result.attacksAgainstRole, 'brute'))
  assert.ok(
    tally(nearest.attacksAgainstRole, 'brute') > 200,
    `metric must be dense: ${tally(nearest.attacksAgainstRole, 'brute')}`,
  )
  // Measured 780/600 = 1.3 nearest-wins, 959/478 = 2.0 scored.
  assert.ok(
    ratio(scored) > ratio(nearest) * 1.3,
    `archers should prefer the back rank: ${ratio(nearest).toFixed(2)} → ${ratio(scored).toFixed(2)}`,
  )
})

test('threat scoring finishes the wounded, and that saves lives', () => {
  // A healthy enemy and a nearly-dead one at almost the same distance. Nearest-wins is
  // indifferent; scoring treats the wounded one as closer than it is, kills it first,
  // and the guards take one incoming attacker fewer for the rest of the fight.
  const build = (): HarnessFighter[] => [
    ...ring(3, 'guard', 'soldier', 'guard'),
    makeFighter('elf', 'soldier', 0, 8, { id: 'elf-healthy', hostileToPlayer: false }),
    makeFighter('elf', 'soldier', 2.5, 9.5, {
      id: 'elf-wounded',
      hostileToPlayer: false,
      hp: 12,
    }),
  ]
  const nearest = batch('wounded-off', build, {
    packRoutEnabled: true,
    threatScoring: false,
    maxFrames: 3_000,
  })
  const scored = batch('wounded-on', build, {
    packRoutEnabled: true,
    threatScoring: true,
    maxFrames: 3_000,
  })

  assert.ok(
    tally(nearest.attacksBy, 'guard') > 300 && tally(scored.attacksBy, 'guard') > 300,
    'metrics must be dense',
  )
  assert.equal(
    tally(nearest.deathsBy, 'elf'),
    tally(scored.deathsBy, 'elf'),
    'both arms should still finish the same two enemies',
  )
  // Measured 60 → 5 defender deaths over 60 fights, on near-identical attack volume.
  assert.ok(
    tally(scored.deathsBy, 'guard') * 2 < tally(nearest.deathsBy, 'guard'),
    `focusing the wounded should cost fewer defenders: ${tally(nearest.deathsBy, 'guard')} → ${tally(scored.deathsBy, 'guard')}`,
  )
})
