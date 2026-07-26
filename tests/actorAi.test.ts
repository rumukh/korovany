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
  aiDistance,
  beastPackShare,
  evaluatePlayerPursuit,
  selectCombatTarget,
  type AiActor,
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
  return Array.from({ length: count }, (_, index) => ({
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
    position: {
      x: rng.range(-40, 40),
      y: rng.range(0, 3),
      z: rng.range(-40, 40),
    },
  }))
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
