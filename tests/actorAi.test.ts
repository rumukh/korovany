/**
 * Equivalence control for the `world/ActorAi.ts` extraction.
 *
 * `selectCombatTarget` and `beastPackShare` were lifted out of `GameEngine.updateActors`
 * so a headless harness could exercise the real decision logic. A refactor that silently
 * changes behaviour is worse than no refactor, and the engine functions cannot be tested
 * directly (instantiating `GameEngine` needs a WebGL context), so this file re-implements
 * the *pre-extraction* engine code inline and asserts the pure versions agree with it
 * across a large randomised sample.
 *
 * The re-implementations below are deliberate copies of what `GameEngine` used to do,
 * including their quirks — 3D distance rather than planar, the 1.35 lock slack, the
 * `packId` null short-circuit. If a future change makes the pure functions diverge, this
 * fails and names the case.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import {
  ALLEGIANCES,
  areAllegiancesHostile,
  BEAST_ROLES,
  type ActorRole,
  type Allegiance,
  type BeastRole,
} from '../src/game/types.ts'
import { shouldBeastRout } from '../src/game/world/Fauna.ts'
import {
  acceptsAlert,
  actorResolve,
  aiDistance,
  beastPackShare,
  engagementRank,
  evaluateMorale,
  evaluatePlayerPursuit,
  flankApproachAngle,
  flankBlend,
  FLANK_MAX_ANGLE,
  localGroupShare,
  playerEngagementRank,
  selectCombatTarget,
  selectThreat,
  THREAT_PLAYER,
  type AiActor,
  type AiAlert,
  type AiPoint,
} from '../src/game/world/ActorAi.ts'

interface Sample extends AiActor {
  position: AiPoint
}

const positionOf = (actor: Sample): AiPoint => actor.position

/** Exactly what `GameEngine.findNearestEnemy` did before the extraction. */
function legacyFindNearestEnemy(
  actor: Sample,
  actors: readonly Sample[],
  range: number,
): Sample | null {
  const locked = actor.targetId
    ? actors.find((other) => other.id === actor.targetId)
    : undefined
  if (
    locked?.alive &&
    locked.id !== actor.ignoredTargetId &&
    areAllegiancesHostile(actor.allegiance, locked.allegiance) &&
    aiDistance(actor.position, locked.position) < range * 1.35
  ) {
    return locked
  }

  let nearest: Sample | null = null
  let bestDistance = range
  for (const other of actors) {
    if (
      !other.alive ||
      other === actor ||
      other.id === actor.ignoredTargetId ||
      !areAllegiancesHostile(actor.allegiance, other.allegiance)
    ) {
      continue
    }
    const distance = aiDistance(actor.position, other.position)
    if (distance < bestDistance) {
      nearest = other
      bestDistance = distance
    }
  }
  return nearest
}

/**
 * What `GameEngine.beastPackShare` did before Layer 3's morale rework: share of the whole
 * pack, regardless of species. Kept as the "before" side of a deliberate change.
 */
function packRelativeShare(
  actor: Sample,
  actors: readonly Sample[],
  radius: number,
): number {
  if (!actor.packId) return 1
  let alive = 0
  const radiusSquared = radius * radius
  for (const other of actors) {
    if (other.packId !== actor.packId || !other.alive) continue
    if (other !== actor) {
      const dx = other.position.x - actor.position.x
      const dy = other.position.y - actor.position.y
      const dz = other.position.z - actor.position.z
      if (dx * dx + dy * dy + dz * dz > radiusSquared) continue
    }
    alive += 1
  }
  return alive / Math.max(1, actor.packKinSize)
}

function buildCrowd(rng: RandomStream, count: number): Sample[] {
  const packs = [null, 'pack-a', 'pack-b']
  const roles = [...BEAST_ROLES, 'soldier'] as ActorRole[]
  return Array.from({ length: count }, (_, index) => {
    const maxHp = rng.integer(40, 160)
    return {
      id: `actor-${index}`,
      allegiance: rng.pick(ALLEGIANCES as readonly Allegiance[]),
      // Role matters now that morale is kin-relative; without it every actor would look
      // like the same species and the kin filter would silently do nothing.
      role: rng.pick(roles),
      alive: rng.chance(0.82),
      ignoredTargetId: rng.chance(0.15) ? `actor-${rng.integer(0, count)}` : null,
      targetId: rng.chance(0.4) ? `actor-${rng.integer(0, count)}` : null,
      packId: rng.pick(packs),
      packKinSize: rng.integer(1, 5),
      // Layer 4 fields. Real spread on hp matters: threat scoring reads it, and a crowd
      // where everything is at full health could not tell a wounded-target rule apart
      // from no rule at all.
      hp: rng.integer(1, maxHp),
      maxHp,
      playerAggro: rng.chance(0.3),
      position: {
        x: rng.range(-40, 40),
        y: rng.range(0, 3),
        z: rng.range(-40, 40),
      },
    }
  })
}

test('the extracted target selection matches the engine code it replaced', () => {
  let comparisons = 0
  let nonNullResults = 0
  let lockedResults = 0

  for (let trial = 0; trial < 400; trial += 1) {
    const rng = new RandomStream(deriveSeed('actor-ai', `crowd-${trial}`))
    const crowd = buildCrowd(rng, rng.integer(2, 14))
    for (const range of [4, 6.5, 15, 21, 52]) {
      for (const actor of crowd) {
        const expected = legacyFindNearestEnemy(actor, crowd, range)
        const actual = selectCombatTarget(actor, crowd, range, positionOf)
        assert.equal(
          actual?.id ?? null,
          expected?.id ?? null,
          `trial ${trial}, range ${range}, actor ${actor.id}`,
        )
        comparisons += 1
        if (actual) {
          nonNullResults += 1
          if (actual.id === actor.targetId) lockedResults += 1
        }
      }
    }
  }

  // The sample has to actually exercise the interesting branches, or agreeing on a
  // long run of nulls would prove nothing at all.
  assert.ok(comparisons > 10_000, `expected a large sample, got ${comparisons}`)
  assert.ok(nonNullResults > 500, `expected real targets to be found, got ${nonNullResults}`)
  assert.ok(
    lockedResults > 50,
    `expected the locked-target branch to be exercised, got ${lockedResults}`,
  )
})

test('pack share is kin-relative, which is a deliberate change from pack-relative', () => {
  // Layer 3 shipped with morale measured over the whole pack. Measured across 120 fights
  // that never once let a wolf break, because a wrecker always outlived its escorts and
  // the survivor was the one role that cannot rout (§9). Morale is now measured over a
  // beast's own kind. This pins the new semantics *and* asserts the two genuinely differ,
  // so the change cannot silently revert.
  let comparisons = 0
  let partialShares = 0
  let divergences = 0

  for (let trial = 0; trial < 500; trial += 1) {
    const rng = new RandomStream(deriveSeed('actor-ai', `pack-${trial}`))
    const crowd = buildCrowd(rng, rng.integer(2, 14))
    for (const radius of [4, 16, 40]) {
      for (const actor of crowd) {
        const kinRelative = beastPackShare(actor, crowd, radius, positionOf)
        // Recomputed here so the assertion is about the rule, not about the call.
        const expected =
          actor.packId === null
            ? 1
            : crowd.filter(
                (other) =>
                  other.packId === actor.packId &&
                  other.role === actor.role &&
                  other.alive &&
                  (other === actor ||
                    aiDistance(other.position, actor.position) <= radius),
              ).length / Math.max(1, actor.packKinSize)
        assert.ok(
          Math.abs(kinRelative - expected) < 1e-9,
          `trial ${trial}, radius ${radius}, ${actor.id}: ${kinRelative} vs ${expected}`,
        )
        comparisons += 1
        if (kinRelative > 0 && kinRelative < 1) partialShares += 1
        if (Math.abs(kinRelative - packRelativeShare(actor, crowd, radius)) > 1e-9) {
          divergences += 1
        }
      }
    }
  }

  assert.ok(comparisons > 10_000, `expected a large sample, got ${comparisons}`)
  // A broken pack is the case that matters; agreeing only on 1.0 would be vacuous.
  assert.ok(
    partialShares > 200,
    `expected broken packs in the sample, got ${partialShares}`,
  )
  // And the change must be real: if kin-relative and pack-relative agreed everywhere,
  // the rework would have been a no-op and the §9 numbers would be inexplicable.
  assert.ok(
    divergences > 200,
    `kin-relative morale must actually differ from pack-relative, got ${divergences}`,
  )
})

test('a mixed pack can break, which strict inequality made impossible', () => {
  // The arithmetic that kept the rule dead: a shipped raid escorts its wrecker with
  // exactly two wolves, so losing one leaves a share of exactly one half.
  assert.equal(shouldBeastRout('wolf', 0.5), true, 'half its kin down is a broken pack')
  assert.equal(shouldBeastRout('wolf', 0.51), false)
  assert.equal(shouldBeastRout('wolf', 1), false, 'an intact pack never breaks')
  // A lone wolf escorting a bear has a kin size of one, so its share is always 1: it
  // never had a pack to lose, and correctly never routs.
  for (const role of ['boar', 'bear', 'troll'] as BeastRole[]) {
    assert.equal(shouldBeastRout(role, 0), false, `${role} must never rout`)
  }
})

test('a deliberately wrong implementation is caught by the same comparison', () => {
  // Negative control for the two tests above: if the comparison could not distinguish a
  // changed implementation, their agreement would mean nothing.
  //
  // The crowd is built with real vertical spread on purpose. `aiDistance` is 3D because
  // the engine's `Vector3.distanceTo` is, and on flat ground the difference is invisible
  // — which is exactly why "just use planar distance" is a plausible future edit and
  // worth having a test that would notice it.
  let disagreements = 0
  for (let trial = 0; trial < 200; trial += 1) {
    const rng = new RandomStream(deriveSeed('actor-ai', `negative-control-${trial}`))
    const crowd: Sample[] = Array.from({ length: 8 }, (_, index) => ({
      id: `actor-${index}`,
      allegiance: rng.pick(['elf', 'guard', 'beast'] as Allegiance[]),
      alive: true,
      ignoredTargetId: null,
      targetId: null,
      packId: null,
      packKinSize: 1,
      role: 'soldier' as const,
      hp: 100,
      maxHp: 100,
      playerAggro: false,
      position: { x: rng.range(-9, 9), y: rng.range(0, 22), z: rng.range(-9, 9) },
    }))
    for (const actor of crowd) {
      const correct = selectCombatTarget(actor, crowd, 15, positionOf)
      // Planar distance instead of 3D: a plausible-looking "simplification".
      const wrong = selectCombatTarget(actor, crowd, 15, (other) => ({
        x: other.position.x,
        y: 0,
        z: other.position.z,
      }))
      if ((correct?.id ?? null) !== (wrong?.id ?? null)) disagreements += 1
    }
  }
  assert.ok(
    disagreements > 0,
    'the comparison must be able to detect a changed implementation',
  )
})

test('player pursuit gates on sight, leash and memory in that order', () => {
  const base = {
    hostileToPlayer: true,
    playerAggro: false,
    aggroMemory: 0,
    playerDistance: 10,
    senseRange: 15,
    leashRange: 52,
  }
  // In plain sight.
  assert.deepEqual(evaluatePlayerPursuit(base), {
    canSense: true,
    canTrack: false,
    shouldPursue: true,
  })
  // Out of sense range but already angry: tracked to the leash.
  assert.deepEqual(
    evaluatePlayerPursuit({ ...base, playerAggro: true, playerDistance: 30 }),
    { canSense: false, canTrack: true, shouldPursue: true },
  )
  // Past the leash, but still remembers: keeps going to the last known position.
  assert.equal(
    evaluatePlayerPursuit({
      ...base,
      playerAggro: true,
      playerDistance: 80,
      aggroMemory: 2,
    }).shouldPursue,
    true,
  )
  // Past the leash and forgotten.
  assert.equal(
    evaluatePlayerPursuit({ ...base, playerAggro: true, playerDistance: 80 }).shouldPursue,
    false,
  )
  // Not hostile to the player: none of the above applies, whatever the distance.
  for (const distance of [1, 10, 30, 80]) {
    assert.deepEqual(
      evaluatePlayerPursuit({
        ...base,
        hostileToPlayer: false,
        playerAggro: true,
        aggroMemory: 5,
        playerDistance: distance,
      }),
      { canSense: false, canTrack: false, shouldPursue: false },
    )
  }
})

// ---------------------------------------------------------------------------
// Layer 4 — the rules that are decisions rather than measurements
// ---------------------------------------------------------------------------

test('a shout reaches allies in earshot and nobody else', () => {
  const listener = (overrides: Partial<Sample> = {}): Sample => ({
    id: 'listener',
    allegiance: 'guard',
    role: 'soldier',
    alive: true,
    ignoredTargetId: null,
    targetId: null,
    packId: null,
    packKinSize: 1,
    hp: 70,
    maxHp: 70,
    playerAggro: false,
    position: { x: 0, y: 0, z: 0 },
    ...overrides,
  })
  const alert: AiAlert = {
    sourceId: 'shouter',
    allegiance: 'guard',
    origin: { x: 5, y: 0, z: 0 },
    target: { x: 30, y: 0, z: 0 },
    hostileId: 'wolf-1',
  }
  const takes = (sample: Sample, radius = 20): boolean =>
    acceptsAlert(sample, alert, radius, positionOf)

  assert.equal(takes(listener()), true, 'an idle ally in earshot takes the call')
  assert.equal(takes(listener(), 4), false, 'out of earshot it does not')
  assert.equal(takes(listener({ alive: false })), false, 'the dead do not respond')
  assert.equal(takes(listener({ id: 'shouter' })), false, 'nor does the shouter')
  assert.equal(
    takes(listener({ allegiance: 'elf' })),
    false,
    'and an enemy does not get told where to look',
  )
  assert.equal(
    takes(listener({ allegiance: 'civilian' })),
    false,
    'neutral is not friendly: a bystander is not part of the watch',
  )
  assert.equal(
    takes(listener({ ignoredTargetId: 'wolf-1' })),
    false,
    'a protected target is still protected when it is shouted about',
  )
  // The rule with substance. Without it one shout re-aims a whole square.
  assert.equal(
    takes(listener({ targetId: 'someone-else' })),
    false,
    'an ally already fighting something does not drop it for hearsay',
  )
  assert.equal(
    takes(listener({ targetId: 'wolf-1' })),
    true,
    'but one already on that very target is still in the loop',
  )
})

test('flanking hands out distinct approach slots and folds them away at contact', () => {
  // The primary comes straight in and everyone else does not, which is the whole rule.
  assert.equal(flankApproachAngle(0), 0)
  const offsets = [1, 2, 3, 4, 5].map((rank) => flankApproachAngle(rank))
  assert.equal(new Set(offsets).size, offsets.length, 'every rank gets its own slot')
  assert.ok(
    offsets.every((offset) => offset !== 0),
    'no secondary attacker queues up on the primary',
  )
  // Pairs, so a flank comes at the target from both sides rather than all from one.
  assert.ok(offsets.some((offset) => offset > 0) && offsets.some((offset) => offset < 0))

  // **The assertion that matters.** The offset rotates the approach direction, so an
  // angle past a right angle gives a negative radial component and the attacker walks
  // away from its target — distance grows, the blend stays pinned at full, and it never
  // converges. The first draft ran to ±135° and π, which made ranks three and up recede
  // forever, including a raider retreating from the barricade it was sent to destroy.
  for (const rank of [0, 1, 2, 3, 4, 5, 6, 11]) {
    const offset = flankApproachAngle(rank)
    assert.ok(
      Math.abs(offset) <= FLANK_MAX_ANGLE,
      `rank ${rank} offset ${offset} must stay inside the closing cone`,
    )
    assert.ok(
      Math.cos(offset) > 0.2,
      `rank ${rank} must still close on its target, got cos ${Math.cos(offset).toFixed(2)}`,
    )
  }

  // The blend is what stops it being an orbit: at range the offset is full, at the stop
  // ring it is nothing, so attackers converge instead of circling forever.
  assert.equal(flankBlend(2.45, 2.45), 0, 'no offset at contact')
  assert.equal(flankBlend(1, 2.45), 0, 'nor inside it')
  assert.ok(flankBlend(4, 2.45) > 0 && flankBlend(4, 2.45) < 1, 'partial while closing')
  assert.equal(flankBlend(40, 2.45), 1, 'full while far away')
  // Monotone, or an attacker would swing back out as it closed.
  let previous = -1
  for (const distance of [2.45, 3, 4, 6, 9, 20]) {
    const blend = flankBlend(distance, 2.45)
    assert.ok(blend >= previous, `blend must not fall as distance grows: ${distance}`)
    previous = blend
  }
})

test('engagement rank is stable, ally-only, and promotes on a death', () => {
  const make = (id: string, targetId: string | null, extra: Partial<Sample> = {}): Sample => ({
    id,
    allegiance: 'guard',
    role: 'soldier',
    alive: true,
    ignoredTargetId: null,
    targetId,
    packId: null,
    packKinSize: 1,
    hp: 70,
    maxHp: 70,
    playerAggro: false,
    position: { x: 0, y: 0, z: 0 },
    ...extra,
  })
  const a = make('a', 'victim')
  const b = make('b', 'victim')
  const c = make('c', 'victim')
  const enemy = make('aa', 'victim', { allegiance: 'elf' })
  const elsewhere = make('ab', 'other-victim')
  const crowd = [a, b, c, enemy, elsewhere]

  assert.equal(engagementRank(a, 'victim', crowd), 0, 'lowest id leads the attack')
  assert.equal(engagementRank(b, 'victim', crowd), 1)
  assert.equal(engagementRank(c, 'victim', crowd), 2)
  // An enemy on the same target is not part of *our* queue, even with a lower id.
  assert.equal(
    engagementRank(a, 'victim', crowd),
    engagementRank(a, 'victim', [a, b, c]),
    'hostiles on the same target do not shift our ranks',
  )
  // Losing the primary promotes the rest rather than leaving a hole.
  a.alive = false
  assert.equal(engagementRank(b, 'victim', crowd), 0)
  assert.equal(engagementRank(c, 'victim', crowd), 1)

  // The player queue is the same idea keyed on `playerAggro`, because an actor going for
  // the player has no `targetId` to match on.
  const chasing = [
    make('a', null, { playerAggro: true }),
    make('b', null, { playerAggro: true }),
    make('c', null, { playerAggro: false }),
  ]
  assert.equal(playerEngagementRank(chasing[0], chasing), 0)
  assert.equal(playerEngagementRank(chasing[1], chasing), 1)
  assert.equal(
    playerEngagementRank(chasing[2], chasing),
    2,
    'rank counts everyone ahead of you in the queue, whether or not you are in it',
  )
})

test('morale is one rule with two doors, and some roles have neither', () => {
  const steady = {
    hpFraction: 1,
    groupShare: 1,
    packShare: 1,
    commanderNearby: false,
    commanderLost: false,
    // Layer 5 added a third door and a required field to feed it. `Infinity` is the
    // honest "measured, and nothing is there" — spelled out rather than left off, because
    // `tests/` is not typechecked and a missing field here would silently become
    // `undefined`, which compares false against every threshold and would quietly make
    // this fixture stop testing what it says it tests.
    alarmDistance: Number.POSITIVE_INFINITY,
  }
  assert.equal(evaluateMorale('soldier', steady), 'none', 'a fresh soldier does not run')

  // Door one: Layer 3 cohesion, unchanged, and reachable only by beasts that have a
  // threshold at all.
  assert.equal(
    evaluateMorale('wolf', { ...steady, packShare: 0.5 }),
    'cohesion',
    'half its kin down is still a broken pack',
  )
  assert.equal(
    evaluateMorale('boar', { ...steady, packShare: 0 }),
    'none',
    'a boar has no cohesion door and never routs',
  )

  // Door two: individual morale. Roughly a fifth of health left with nothing else wrong.
  assert.equal(evaluateMorale('soldier', { ...steady, hpFraction: 0.3 }), 'none')
  assert.equal(evaluateMorale('soldier', { ...steady, hpFraction: 0.15 }), 'individual')
  // Or half health with half the group on the ground.
  assert.equal(
    evaluateMorale('soldier', { ...steady, hpFraction: 0.5, groupShare: 0 }),
    'individual',
  )
  assert.equal(
    evaluateMorale('soldier', { ...steady, hpFraction: 0.5, groupShare: 1 }),
    'none',
    'the same wound with the squad intact is survivable',
  )

  // A commander steadies, and losing him is a shock that tips a wavering actor over.
  const wavering = { ...steady, hpFraction: 0.42, groupShare: 0.25 }
  assert.equal(evaluateMorale('soldier', wavering), 'individual')
  assert.equal(
    evaluateMorale('soldier', { ...wavering, commanderNearby: true }),
    'none',
    'a commander in earshot holds the line together',
  )
  const holding = { ...steady, hpFraction: 0.55, groupShare: 0.4 }
  assert.equal(evaluateMorale('soldier', holding), 'none')
  assert.equal(
    evaluateMorale('soldier', { ...holding, commanderLost: true }),
    'individual',
    'and watching him fall is what tips it',
  )

  // The `null` resolves. This is the assertion that catches the defect measurement found:
  // a `?? 0` fallback turned every one of these into "breaks like a soldier".
  const desperate = {
    hpFraction: 0.001,
    groupShare: 0,
    packShare: 0,
    commanderNearby: false,
    commanderLost: true,
    // Nothing frightening nearby, so `panic` cannot account for any of the breaks below
    // and the positive control is genuinely about the individual and cohesion doors.
    alarmDistance: Number.POSITIVE_INFINITY,
  }
  for (const role of ['commander', 'champion', 'captive'] as ActorRole[]) {
    assert.equal(actorResolve(role), null, `${role} must be marked as never breaking`)
    assert.equal(
      evaluateMorale(role, desperate),
      'none',
      `${role} must not break even at death's door with everything against it`,
    )
  }
  // Positive control: the same inputs break everything that *can* break, so the four
  // `none`s above are about the role and not about the inputs being too mild.
  for (const role of ['soldier', 'archer', 'scout', 'minion', 'brute', 'wolf', 'peasant'] as ActorRole[]) {
    assert.notEqual(
      evaluateMorale(role, desperate),
      'none',
      `${role} must break under these inputs`,
    )
  }
  // And the beast half agrees with `BEAST_PROFILES` rather than restating it.
  for (const role of BEAST_ROLES) {
    assert.equal(
      actorResolve(role) === null,
      shouldBeastRout(role, 0) === false,
      `${role}: resolve and rout threshold must agree`,
    )
  }
})

test('the local group is measured against the bodies, not a remembered roster', () => {
  const at = (id: string, x: number, alive: boolean, allegiance: Allegiance = 'guard'): Sample => ({
    id,
    allegiance,
    role: 'soldier',
    alive,
    ignoredTargetId: null,
    targetId: null,
    packId: null,
    packKinSize: 1,
    hp: 70,
    maxHp: 70,
    playerAggro: false,
    position: { x, y: 0, z: 0 },
  })
  const self = at('self', 0, true)

  assert.equal(
    localGroupShare(self, [self], 14, positionOf),
    1,
    'an actor with nobody around it has lost nothing',
  )
  assert.equal(
    localGroupShare(self, [self, at('a', 2, true), at('b', 3, false)], 14, positionOf),
    0.5,
    'one up, one down',
  )
  assert.equal(
    localGroupShare(self, [self, at('a', 2, false), at('b', 3, false)], 14, positionOf),
    0,
    'a lone survivor standing over its dead',
  )
  assert.equal(
    localGroupShare(self, [self, at('a', 60, false)], 14, positionOf),
    1,
    'a body across the square is somebody else"s problem',
  )
  assert.equal(
    localGroupShare(self, [self, at('a', 2, false, 'elf')], 14, positionOf),
    1,
    'and an enemy corpse is not a loss at all',
  )
})

test('threat scoring beats nearest-wins on the cases it was built for', () => {
  const at = (
    id: string,
    x: number,
    z: number,
    extra: Partial<Sample> = {},
  ): Sample => ({
    id,
    allegiance: 'elf',
    role: 'soldier',
    alive: true,
    ignoredTargetId: null,
    targetId: null,
    packId: null,
    packKinSize: 1,
    hp: 70,
    maxHp: 70,
    playerAggro: false,
    position: { x, y: 0, z },
    ...extra,
  })
  const hunter = at('hunter', 0, 0, { allegiance: 'guard' })

  // Wounded: the further target wins because it is nearly dead.
  const wounded = [hunter, at('healthy', 4, 0), at('bleeding', 6, 0, { hp: 4 })]
  assert.equal(selectCombatTarget(hunter, wounded, 15, positionOf)?.id, 'healthy')
  assert.equal(
    (selectThreat(hunter, wounded, 15, positionOf) as Sample | null)?.id,
    'bleeding',
    'threat scoring finishes what is nearly finished',
  )

  // Crowding: an ally already on the near target pushes this one onto the other.
  const crowd = [
    hunter,
    at('mate', 1, 1, { allegiance: 'guard', targetId: 'near' }),
    at('near', 5, 0),
    at('far', 6.2, 0),
  ]
  assert.equal(selectCombatTarget(hunter, crowd, 15, positionOf)?.id, 'near')
  assert.equal(
    (selectThreat(hunter, crowd, 15, positionOf) as Sample | null)?.id,
    'far',
    'a squad spreads across targets instead of stacking six deep on one',
  )

  // A wolf is the exception: the pack piles on rather than spreading out.
  const wolf = at('wolf', 0, 0, { allegiance: 'beast', role: 'wolf' })
  const wolfCrowd = [
    wolf,
    at('kin', 1, 1, { allegiance: 'beast', role: 'wolf', targetId: 'near' }),
    at('near', 5, 0),
    at('far', 6.2, 0),
  ]
  assert.equal(
    (selectThreat(wolf, wolfCrowd, 21, positionOf) as Sample | null)?.id,
    'near',
    'wolves focus, which is the one negative crowd weight in the table',
  )

  // And the player is scored rather than short-circuiting everything else.
  const near = [hunter, at('adjacent', 2, 0)]
  const player = { position: { x: 12, y: 0, z: 0 }, hpFraction: 1, provoked: false }
  assert.equal(
    (selectThreat(hunter, near, 15, positionOf, player) as Sample | null)?.id,
    'adjacent',
    'a soldier at arm"s length beats a player across the square',
  )
  assert.equal(
    selectThreat(
      hunter,
      [hunter, at('adjacent', 9, 0)],
      15,
      positionOf,
      { ...player, position: { x: 3, y: 0, z: 0 } },
    ),
    THREAT_PLAYER,
    'and a player at arm"s length wins the same way',
  )
})
