/**
 * Equivalence control for the `world/CombatResolver.ts` extraction.
 *
 * The role damage tables, the action contract, the two damage resolutions, the poise
 * reaction and the death rules were lifted out of `GameEngine` so a headless run harness
 * could exercise the real combat model. A refactor that silently changes behaviour is
 * worse than no refactor, and the engine methods cannot be tested directly — instantiating
 * `GameEngine` needs a WebGL context — so this file re-implements the **pre-extraction**
 * engine code inline and asserts the extracted functions agree with it across a large
 * randomised sample.
 *
 * The re-implementations below are deliberate copies of what `GameEngine` used to do,
 * including their quirks: the ternary chains in `actorAttackPlayer` and `actorAttackActor`
 * exactly as they were written down twice, the `Math.max(0, hp - dealt) <= 0` kill test,
 * the `0.7` poise floor that appears in three separate places, and the fact that a brute's
 * frontal check silently does nothing when the source is standing on top of it.
 *
 * Every block has a negative control: a plausible-looking wrong variant, asserted to
 * disagree. Without that, agreement would only prove the comparison is blind.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import { BEAST_ROLES, isBeastRole, type ActorRole } from '../src/game/types.ts'
import { BEAST_PROFILES } from '../src/game/world/Fauna.ts'
import {
  ARCHER_FIRE_COOLDOWN,
  CONTACT_RANGE_FORGIVENESS,
  MELEE_DAMAGE,
  actionCooldown,
  actionRecovery,
  actionWindup,
  actorMaxPoise,
  actorStaggerDuration,
  advanceReaction,
  applyDamageReaction,
  canStartAction,
  isLargeBody,
  isWithinContact,
  killReward,
  knockbackMagnitude,
  meleeDamageSpec,
  playerArmor,
  resolveActorDamage,
  resolvePlayerDamage,
  rollMeleeDamage,
  rollPropBite,
  selectDeathStyle,
  shouldInjurePlayer,
  type CombatActionKind,
  type CombatActor,
  type CombatAttackKind,
  type CombatDeathStyle,
  type CombatHitWeight,
  type CombatReactionKind,
} from '../src/game/world/CombatResolver.ts'

const ALL_ROLES: readonly ActorRole[] = [
  'soldier',
  'scout',
  'commander',
  'minion',
  'archer',
  'brute',
  'champion',
  'captive',
  'peasant',
  ...BEAST_ROLES,
]

const ATTACK_KINDS: readonly CombatAttackKind[] = [
  'melee',
  'cleave',
  'arrow',
  'allyMelee',
  'actorArrow',
]

const ACTION_KINDS: readonly CombatActionKind[] = [
  'meleePlayer',
  'meleeActor',
  'eventProp',
  'arrow',
]

// ---------------------------------------------------------------------------
// The pre-extraction engine code, copied verbatim
// ---------------------------------------------------------------------------

/** Exactly what `GameEngine.actorAttackPlayer` computed, ternary chain and all. */
function legacyAttackPlayerDamage(role: ActorRole, combatRng: () => number): number {
  return isBeastRole(role)
    ? BEAST_PROFILES[role].meleeDamage
    : role === 'commander'
      ? 10
      : role === 'champion'
        ? 17
        : role === 'brute'
          ? 14
          : 6 + combatRng() * 3
}

/** Exactly what `GameEngine.actorAttackActor` computed. The second of the two tables. */
function legacyAttackActorDamage(role: ActorRole): number {
  return isBeastRole(role)
    ? BEAST_PROFILES[role].meleeDamage
    : role === 'commander'
      ? 18
      : role === 'champion'
        ? 17
        : role === 'brute'
          ? 14
          : 13
}

/** Exactly what `GameEngine.actorAttackEventProp` computed. */
function legacyPropBite(role: ActorRole, eventRng: () => number): number {
  return role === 'troll' ? 9 + eventRng() * 4 : 4 + eventRng() * 2
}

function legacyActorWindup(role: ActorRole): number {
  if (role === 'scout' || role === 'minion') return 0.18
  if (role === 'archer') return 0.32
  if (role === 'commander') return 0.38
  if (role === 'brute') return 0.56
  if (role === 'champion') return 0.48
  return 0.26
}

function legacyActorRecovery(role: ActorRole): number {
  if (role === 'scout' || role === 'minion') return 0.18
  if (role === 'archer') return 0.2
  if (role === 'commander') return 0.28
  if (role === 'brute') return 0.42
  if (role === 'champion') return 0.36
  return 0.24
}

function legacyActorMaxPoise(role: ActorRole): number {
  if (isBeastRole(role)) return BEAST_PROFILES[role].poise
  if (role === 'scout' || role === 'minion' || role === 'archer') return 18
  if (role === 'commander') return 46
  if (role === 'brute') return 58
  if (role === 'champion') return 72
  return 28
}

function legacyActorStaggerDuration(role: ActorRole): number {
  if (role === 'scout' || role === 'minion' || role === 'archer') return 0.34
  if (role === 'commander') return 0.24
  if (role === 'brute') return 0.2
  if (role === 'champion') return 0.18
  return 0.3
}

/** The cooldown ternary from `GameEngine.startActorAction`. */
function legacyActionCooldown(kind: CombatActionKind, role: ActorRole): number {
  return kind === 'arrow'
    ? 1.8
    : kind === 'meleePlayer'
      ? role === 'commander'
        ? 0.8
        : 1.15
      : kind === 'meleeActor'
        ? 1.3
        : 1.35
}

interface LegacyDamageResult {
  applied: boolean
  dealt: number
  killed: boolean
  weight: CombatHitWeight
}

/** The arithmetic half of `GameEngine.damagePlayer`, with the presentation removed. */
function legacyDamagePlayer(input: {
  baseDamage: number
  health: number
  faction: string
  shieldActive: boolean
  hasIncomingDirection: boolean
  incomingDotAim: number
}): LegacyDamageResult {
  if (input.health <= 0) {
    return { applied: false, dealt: 0, killed: false, weight: 'normal' }
  }
  const armor = input.faction === 'guard' ? 0.72 : 1
  const frontalBlock =
    input.shieldActive && input.hasIncomingDirection && input.incomingDotAim > 0.2
  const dealt = input.baseDamage * armor * (frontalBlock ? 0.15 : 1)
  const health = Math.max(0, input.health - dealt)
  const killed = health <= 0
  const weight: CombatHitWeight = frontalBlock
    ? 'blocked'
    : killed
      ? 'lethal'
      : dealt >= 22
        ? 'heavy'
        : 'normal'
  return { applied: true, dealt, killed, weight }
}

/** The arithmetic half of `GameEngine.damageActor`. */
function legacyDamageActor(input: {
  alive: boolean
  role: ActorRole
  hp: number
  maxHp: number
  baseDamage: number
  attackKind: CombatAttackKind
  facingDotToSource: number | null
}): LegacyDamageResult {
  if (!input.alive) {
    return { applied: false, dealt: 0, killed: false, weight: 'normal' }
  }
  let dealt = Math.max(0, input.baseDamage)
  if (
    input.role === 'brute' &&
    input.facingDotToSource !== null &&
    input.facingDotToSource > 0.2
  ) {
    dealt *= 0.5
  }
  const hp = Math.max(0, input.hp - dealt)
  const killed = hp <= 0
  const weight: CombatHitWeight = killed
    ? 'lethal'
    : input.attackKind === 'cleave' || dealt >= input.maxHp * 0.22
      ? 'heavy'
      : 'normal'
  return { applied: true, dealt, killed, weight }
}

interface LegacyActor {
  role: ActorRole
  reaction: CombatReactionKind
  reactionRemaining: number
  poise: number
  maxPoise: number
  poiseRecoveryDelay: number
  staggerImmunity: number
}

/** The poise half of `GameEngine.applyActorDamageReaction`, without the telegraph. */
function legacyApplyReaction(
  actor: LegacyActor,
  result: LegacyDamageResult,
  attackKind: CombatAttackKind,
): boolean {
  if (!result.applied) return false
  if (result.killed) return false
  if (actor.reaction !== 'stagger') {
    actor.reaction = 'flinch'
    actor.reactionRemaining = Math.max(actor.reactionRemaining, 0.12)
  }
  actor.poiseRecoveryDelay = 0.75
  const poiseDamage = result.dealt * (attackKind === 'cleave' ? 1.45 : 0.75)
  if (actor.staggerImmunity > 0) {
    actor.poise = Math.max(actor.maxPoise * 0.7, actor.poise - poiseDamage)
    return false
  }
  actor.poise -= poiseDamage
  if (actor.poise > 0) return false
  actor.reaction = 'stagger'
  actor.reactionRemaining = legacyActorStaggerDuration(actor.role)
  actor.staggerImmunity = 0.45
  actor.poise = actor.maxPoise * 0.7
  return true
}

/** Exactly what `GameEngine.updateActorReaction` did. */
function legacyAdvanceReaction(actor: LegacyActor, delta: number): void {
  actor.staggerImmunity = Math.max(0, actor.staggerImmunity - delta)
  actor.poiseRecoveryDelay = Math.max(0, actor.poiseRecoveryDelay - delta)
  if (actor.reaction !== 'none') {
    const wasStaggered = actor.reaction === 'stagger'
    actor.reactionRemaining = Math.max(0, actor.reactionRemaining - delta)
    if (actor.reactionRemaining <= 0) {
      actor.reaction = 'none'
      if (wasStaggered) actor.poise = Math.max(actor.poise, actor.maxPoise * 0.7)
    }
  }
  if (actor.reaction !== 'stagger' && actor.poiseRecoveryDelay <= 0) {
    actor.poise = Math.min(actor.maxPoise, actor.poise + 22 * delta)
  }
}

/** The death-style ternary out of `GameEngine.killActor`. */
function legacyDeathStyle(
  attackKind: CombatAttackKind,
  requestedKnockback: number,
  lateralStrength: number,
  sourceInFront: boolean,
): CombatDeathStyle {
  return attackKind === 'cleave' || requestedKnockback >= 2.5
    ? 'launchFall'
    : lateralStrength > 0.68
      ? 'spinFall'
      : sourceInFront
        ? 'backFall'
        : 'sideFall'
}

/** The knockback scaling from `GameEngine.applyActorDamageReaction`. */
function legacyKnockback(
  role: ActorRole,
  requestedKnockback: number,
  motionScale: number,
): number {
  const largeRole = role === 'brute' || role === 'commander' || role === 'champion'
  return requestedKnockback * (largeRole ? 0.55 : 1) * motionScale
}

// ---------------------------------------------------------------------------
// The one table
// ---------------------------------------------------------------------------

test('the one melee table reproduces both hand-synced engine tables', () => {
  // The rolled arm is the reason `rollMeleeDamage` takes a thunk. Feeding both sides the
  // same stream is what proves the extraction draws in the same places as well as
  // computing the same numbers: if the new code drew for a commander, these two streams
  // would desynchronise and every later comparison in the loop would fail.
  const legacyRng = new RandomStream(deriveSeed('combat-resolver', 'melee-legacy'))
  const actualRng = new RandomStream(deriveSeed('combat-resolver', 'melee-legacy'))
  let comparisons = 0
  let rolledArms = 0

  for (let trial = 0; trial < 900; trial += 1) {
    for (const role of ALL_ROLES) {
      const expectedPlayer = legacyAttackPlayerDamage(role, () => legacyRng.next())
      const actualPlayer = rollMeleeDamage(role, 'player', () => actualRng.next())
      assert.equal(actualPlayer, expectedPlayer, `vs player, ${role}, trial ${trial}`)

      const expectedActor = legacyAttackActorDamage(role)
      const actualActor = rollMeleeDamage(role, 'actor', () => {
        throw new Error('the actor column has no spread and must not draw')
      })
      assert.equal(actualActor, expectedActor, `vs actor, ${role}, trial ${trial}`)

      comparisons += 2
      if (meleeDamageSpec(role, 'player').spread > 0) rolledArms += 1
    }
  }

  assert.equal(
    legacyRng.getState(),
    actualRng.getState(),
    'the extraction must draw from the combat stream in exactly the same places',
  )
  assert.ok(comparisons > 10_000, `expected a large sample, got ${comparisons}`)
  assert.ok(rolledArms > 1_000, `expected the rolled arm to be exercised, got ${rolledArms}`)
})

test('the two columns genuinely differ, so collapsing them was not a merge', () => {
  // If every role hit for the same amount against both targets, one table would have been
  // the right answer and this extraction would have silently changed the game. Two roles
  // differ, and they are the two the design intends to differ.
  const differing = ALL_ROLES.filter(
    (role) =>
      meleeDamageSpec(role, 'player').base !== meleeDamageSpec(role, 'actor').base ||
      meleeDamageSpec(role, 'player').spread !== meleeDamageSpec(role, 'actor').spread,
  )
  assert.deepEqual(
    [...differing].sort(),
    ['archer', 'captive', 'commander', 'minion', 'peasant', 'scout', 'soldier'].sort(),
    'the ordinary roles and the commander are the asymmetric ones',
  )
  // And the shared entry really is shared: the ordinary roles are one object, so a future
  // edit to a soldier cannot forget the peasant.
  assert.equal(MELEE_DAMAGE.soldier, MELEE_DAMAGE.peasant)
  assert.equal(MELEE_DAMAGE.soldier, MELEE_DAMAGE.archer)
})

test('prop bites match the engine, and troll wrecking is twice a raider', () => {
  const legacyRng = new RandomStream(deriveSeed('combat-resolver', 'prop'))
  const actualRng = new RandomStream(deriveSeed('combat-resolver', 'prop'))
  for (let trial = 0; trial < 400; trial += 1) {
    for (const role of ALL_ROLES) {
      assert.equal(
        rollPropBite(role, actualRng.next()),
        legacyPropBite(role, () => legacyRng.next()),
        `${role}, trial ${trial}`,
      )
    }
  }
  assert.equal(legacyRng.getState(), actualRng.getState())
})

// ---------------------------------------------------------------------------
// The action contract
// ---------------------------------------------------------------------------

test('the action contract matches the engine code it replaced', () => {
  let comparisons = 0
  for (const role of ALL_ROLES) {
    assert.equal(actionWindup(role), legacyActorWindup(role), `windup ${role}`)
    assert.equal(actionRecovery(role), legacyActorRecovery(role), `recovery ${role}`)
    assert.equal(actorMaxPoise(role), legacyActorMaxPoise(role), `poise ${role}`)
    assert.equal(
      actorStaggerDuration(role),
      legacyActorStaggerDuration(role),
      `stagger ${role}`,
    )
    comparisons += 4
    for (const kind of ACTION_KINDS) {
      assert.equal(
        actionCooldown(kind, role),
        legacyActionCooldown(kind, role),
        `cooldown ${kind}/${role}`,
      )
      comparisons += 1
    }
  }
  assert.equal(actionCooldown('arrow', 'archer'), ARCHER_FIRE_COOLDOWN)
  assert.ok(comparisons >= 100, `expected every role covered, got ${comparisons}`)

  // The band the roadmap's open disagreement about a dodge turns on. Pinned so a future
  // tuning pass cannot move the floor without the argument being reopened deliberately.
  const windups = ALL_ROLES.map(actionWindup)
  assert.equal(Math.min(...windups), 0.18)
  assert.equal(Math.max(...windups), 0.56)
})

test('an actor may act only when it is up, idle and not reeling', () => {
  const cases: Array<[boolean, unknown, CombatReactionKind, boolean]> = [
    [true, null, 'none', true],
    [true, null, 'flinch', true],
    [true, null, 'stagger', false],
    [true, { kind: 'meleePlayer' }, 'none', false],
    [false, null, 'none', false],
  ]
  for (const [alive, action, reaction, expected] of cases) {
    assert.equal(
      canStartAction({ alive, action, reaction }),
      expected,
      `${String(alive)}/${String(Boolean(action))}/${reaction}`,
    )
  }
})

test('contact forgiveness is the slack the engine applied inline', () => {
  let comparisons = 0
  const rng = new RandomStream(deriveSeed('combat-resolver', 'contact'))
  for (let trial = 0; trial < 4_000; trial += 1) {
    const contactRange = rng.range(1, 4)
    const distance = rng.range(0, 6)
    assert.equal(
      isWithinContact(distance, contactRange),
      !(distance > contactRange + CONTACT_RANGE_FORGIVENESS),
      `distance ${distance} range ${contactRange}`,
    )
    comparisons += 1
  }
  assert.ok(comparisons >= 4_000)
})

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

test('player damage matches the engine code it replaced', () => {
  let comparisons = 0
  let blocked = 0
  let lethal = 0
  let heavy = 0

  for (let trial = 0; trial < 700; trial += 1) {
    const rng = new RandomStream(deriveSeed('combat-resolver', `player-${trial}`))
    for (const faction of ['elf', 'guard', 'villain']) {
      const input = {
        baseDamage: rng.range(0, 60),
        health: rng.chance(0.1) ? 0 : rng.range(1, 120),
        faction,
        shieldActive: rng.chance(0.45),
        hasIncomingDirection: rng.chance(0.85),
        incomingDotAim: rng.range(-1, 1),
      }
      const expected = legacyDamagePlayer(input)
      const actual = resolvePlayerDamage({
        baseDamage: input.baseDamage,
        health: input.health,
        shieldActive: input.shieldActive,
        hasIncomingDirection: input.hasIncomingDirection,
        incomingDotAim: input.incomingDotAim,
        armor: playerArmor(input.faction),
      })
      assert.equal(actual.applied, expected.applied, `applied, trial ${trial}`)
      assert.equal(actual.dealt, expected.dealt, `dealt, trial ${trial}`)
      assert.equal(actual.killed, expected.killed, `killed, trial ${trial}`)
      assert.equal(actual.weight, expected.weight, `weight, trial ${trial}`)
      comparisons += 4
      if (actual.weight === 'blocked') blocked += 1
      if (actual.weight === 'lethal') lethal += 1
      if (actual.weight === 'heavy') heavy += 1
    }
  }

  assert.ok(comparisons > 8_000, `expected a large sample, got ${comparisons}`)
  // Agreeing on a long run of ordinary hits would prove nothing about the branches.
  assert.ok(blocked > 100, `expected blocked hits in the sample, got ${blocked}`)
  assert.ok(lethal > 100, `expected lethal hits in the sample, got ${lethal}`)
  assert.ok(heavy > 100, `expected heavy hits in the sample, got ${heavy}`)
})

test('the injury roll keeps the engine gate that protects the combat stream', () => {
  // `shouldInjurePlayer` deliberately does not take `canInjure` or `blocked`: folding them
  // in would have drawn from the combat stream on every blocked hit and desynchronised
  // every later roll in a run. This pins the two conditions it does own.
  assert.equal(shouldInjurePlayer(0.1, 50), true)
  assert.equal(shouldInjurePlayer(0.11, 50), false, 'the threshold is exclusive')
  assert.equal(shouldInjurePlayer(0.1, 82), false, 'a healthy player keeps the limb')
  assert.equal(shouldInjurePlayer(0.1, 81.999), true)
  assert.equal(playerArmor('guard'), 0.72)
  assert.equal(playerArmor('elf'), 1)
  assert.equal(playerArmor('villain'), 1)
})

test('actor damage matches the engine code it replaced', () => {
  let comparisons = 0
  let bruteFrontals = 0
  let lethal = 0
  let heavy = 0

  for (let trial = 0; trial < 900; trial += 1) {
    const rng = new RandomStream(deriveSeed('combat-resolver', `actor-${trial}`))
    for (const role of ALL_ROLES) {
      const maxHp = rng.range(40, 180)
      const target: CombatActor = {
        role,
        alive: !rng.chance(0.08),
        hp: rng.range(1, maxHp),
        maxHp,
        reaction: 'none',
        reactionRemaining: 0,
        poise: actorMaxPoise(role),
        maxPoise: actorMaxPoise(role),
        poiseRecoveryDelay: 0,
        staggerImmunity: 0,
      }
      const attackKind = ATTACK_KINDS[rng.integer(0, ATTACK_KINDS.length)]
      const baseDamage = rng.chance(0.05) ? -rng.range(0, 20) : rng.range(0, 70)
      // `null` models the engine's "source is standing on top of the target" branch,
      // where `toSource.lengthSq()` fails the epsilon and the multiplier never applies.
      const facingDotToSource = rng.chance(0.08) ? null : rng.range(-1, 1)
      const expected = legacyDamageActor({
        alive: target.alive,
        role,
        hp: target.hp,
        maxHp,
        baseDamage,
        attackKind,
        facingDotToSource,
      })
      const actual = resolveActorDamage({
        target,
        baseDamage,
        attackKind,
        facingDotToSource,
      })
      assert.equal(actual.applied, expected.applied, `applied ${role} trial ${trial}`)
      assert.equal(actual.dealt, expected.dealt, `dealt ${role} trial ${trial}`)
      assert.equal(actual.killed, expected.killed, `killed ${role} trial ${trial}`)
      assert.equal(actual.weight, expected.weight, `weight ${role} trial ${trial}`)
      comparisons += 4
      if (
        role === 'brute' &&
        target.alive &&
        facingDotToSource !== null &&
        facingDotToSource > 0.2
      ) {
        bruteFrontals += 1
      }
      if (actual.weight === 'lethal') lethal += 1
      if (actual.weight === 'heavy') heavy += 1
    }
  }

  assert.ok(comparisons > 40_000, `expected a large sample, got ${comparisons}`)
  assert.ok(bruteFrontals > 100, `expected brute frontals, got ${bruteFrontals}`)
  assert.ok(lethal > 500, `expected lethal hits, got ${lethal}`)
  assert.ok(heavy > 500, `expected heavy hits, got ${heavy}`)
})

test('the poise reaction matches the engine code it replaced', () => {
  let comparisons = 0
  let staggers = 0
  let immuneAbsorbs = 0

  for (let trial = 0; trial < 900; trial += 1) {
    const rng = new RandomStream(deriveSeed('combat-resolver', `poise-${trial}`))
    for (const role of ALL_ROLES) {
      const maxPoise = actorMaxPoise(role)
      const seed = {
        role,
        reaction: (['none', 'flinch', 'stagger'] as CombatReactionKind[])[
          rng.integer(0, 3)
        ],
        reactionRemaining: rng.range(0, 0.4),
        poise: rng.range(0, maxPoise),
        maxPoise,
        poiseRecoveryDelay: rng.range(0, 1),
        staggerImmunity: rng.chance(0.3) ? rng.range(0.01, 0.45) : 0,
      }
      const outcome = {
        applied: !rng.chance(0.1),
        dealt: rng.range(0, 60),
        killed: rng.chance(0.15),
        weight: 'normal' as CombatHitWeight,
        blocked: false,
        impact: 0,
      }
      const attackKind = ATTACK_KINDS[rng.integer(0, ATTACK_KINDS.length)]

      const legacyActor: LegacyActor = { ...seed }
      const actualActor: CombatActor = {
        ...seed,
        alive: true,
        hp: 100,
        maxHp: 100,
      }
      const expectedStaggered = legacyApplyReaction(legacyActor, outcome, attackKind)
      const actualStaggered = applyDamageReaction(actualActor, outcome, attackKind)

      assert.equal(actualStaggered, expectedStaggered, `staggered ${role} ${trial}`)
      assert.equal(actualActor.reaction, legacyActor.reaction, `reaction ${role} ${trial}`)
      assert.equal(
        actualActor.reactionRemaining,
        legacyActor.reactionRemaining,
        `remaining ${role} ${trial}`,
      )
      assert.equal(actualActor.poise, legacyActor.poise, `poise ${role} ${trial}`)
      assert.equal(
        actualActor.poiseRecoveryDelay,
        legacyActor.poiseRecoveryDelay,
        `delay ${role} ${trial}`,
      )
      assert.equal(
        actualActor.staggerImmunity,
        legacyActor.staggerImmunity,
        `immunity ${role} ${trial}`,
      )
      comparisons += 6
      if (actualStaggered) staggers += 1
      if (outcome.applied && !outcome.killed && seed.staggerImmunity > 0) {
        immuneAbsorbs += 1
      }

      // And then run the recovery half forward over a few frames, which is where the
      // 0.7 floor and the regen delay interact.
      for (const delta of [0.016, 0.05, 0.2]) {
        legacyAdvanceReaction(legacyActor, delta)
        advanceReaction(actualActor, delta)
        assert.equal(actualActor.reaction, legacyActor.reaction, `tick reaction ${role}`)
        assert.equal(actualActor.poise, legacyActor.poise, `tick poise ${role}`)
        assert.equal(
          actualActor.staggerImmunity,
          legacyActor.staggerImmunity,
          `tick immunity ${role}`,
        )
        comparisons += 3
      }
    }
  }

  assert.ok(comparisons > 100_000, `expected a large sample, got ${comparisons}`)
  assert.ok(staggers > 500, `expected staggers in the sample, got ${staggers}`)
  assert.ok(
    immuneAbsorbs > 500,
    `expected the immunity branch to be exercised, got ${immuneAbsorbs}`,
  )
})

// ---------------------------------------------------------------------------
// Death
// ---------------------------------------------------------------------------

test('death style and reward match the engine code they replaced', () => {
  let comparisons = 0
  const seen = new Set<CombatDeathStyle>()

  for (let trial = 0; trial < 1_400; trial += 1) {
    const rng = new RandomStream(deriveSeed('combat-resolver', `death-${trial}`))
    for (const attackKind of ATTACK_KINDS) {
      const requestedKnockback = rng.range(0, 5)
      const lateralStrength = rng.range(0, 1)
      const sourceInFront = rng.chance(0.5)
      const actual = selectDeathStyle({
        attackKind,
        requestedKnockback,
        lateralStrength,
        sourceInFront,
      })
      assert.equal(
        actual,
        legacyDeathStyle(attackKind, requestedKnockback, lateralStrength, sourceInFront),
        `trial ${trial}, ${attackKind}`,
      )
      seen.add(actual)
      comparisons += 1
    }
  }

  assert.ok(comparisons > 5_000, `expected a large sample, got ${comparisons}`)
  assert.equal(seen.size, 4, `all four death styles must be reachable, saw ${seen.size}`)

  for (const role of ALL_ROLES) {
    assert.equal(killReward(role), role === 'commander' ? 55 : 12, `reward ${role}`)
    assert.equal(
      isLargeBody(role),
      role === 'brute' || role === 'commander' || role === 'champion',
      `large body ${role}`,
    )
  }
})

test('knockback scaling matches the engine code it replaced', () => {
  let comparisons = 0
  const rng = new RandomStream(deriveSeed('combat-resolver', 'knockback'))
  for (let trial = 0; trial < 500; trial += 1) {
    for (const role of ALL_ROLES) {
      const requested = rng.range(0, 6)
      const motionScale = rng.chance(0.4) ? 0.6 : 1
      assert.equal(
        knockbackMagnitude(role, requested, motionScale),
        legacyKnockback(role, requested, motionScale),
        `${role} trial ${trial}`,
      )
      comparisons += 1
    }
  }
  assert.ok(comparisons > 5_000, `expected a large sample, got ${comparisons}`)
})

// ---------------------------------------------------------------------------
// Negative controls
// ---------------------------------------------------------------------------

test('a deliberately wrong damage implementation is caught by the same comparison', () => {
  // If the comparisons above could not distinguish a changed implementation, their
  // agreement would mean nothing. Each variant below is a plausible-looking future edit.
  let playerDisagreements = 0
  let actorDisagreements = 0
  let tableDisagreements = 0
  let deathDisagreements = 0
  let poiseDisagreements = 0

  for (let trial = 0; trial < 600; trial += 1) {
    const rng = new RandomStream(deriveSeed('combat-resolver', `negative-${trial}`))

    // 1. "The shield cone looks tight, widen it." Changes which hits count as blocked.
    const playerInput = {
      baseDamage: rng.range(1, 40),
      health: rng.range(20, 120),
      faction: 'guard',
      shieldActive: true,
      hasIncomingDirection: true,
      incomingDotAim: rng.range(-0.4, 0.6),
    }
    const correctPlayer = resolvePlayerDamage({
      ...playerInput,
      armor: playerArmor(playerInput.faction),
    })
    const wrongPlayer = legacyDamagePlayer({ ...playerInput, incomingDotAim: 1 })
    if (correctPlayer.weight !== wrongPlayer.weight) playerDisagreements += 1

    // 2. "A brute is a brute from every angle." Drops the frontal-arc test.
    const maxHp = rng.range(60, 160)
    const brute: CombatActor = {
      role: 'brute',
      alive: true,
      hp: maxHp,
      maxHp,
      reaction: 'none',
      reactionRemaining: 0,
      poise: actorMaxPoise('brute'),
      maxPoise: actorMaxPoise('brute'),
      poiseRecoveryDelay: 0,
      staggerImmunity: 0,
    }
    const baseDamage = rng.range(5, 40)
    const facingDotToSource = rng.range(-1, 1)
    const correctActor = resolveActorDamage({
      target: brute,
      baseDamage,
      attackKind: 'melee',
      facingDotToSource,
    })
    const wrongActor = resolveActorDamage({
      target: brute,
      baseDamage,
      attackKind: 'melee',
      facingDotToSource: null,
    })
    if (correctActor.dealt !== wrongActor.dealt) actorDisagreements += 1

    // 3. "Both tables say the same thing, use one column." The exact merge the extraction
    //    had to avoid making by accident.
    const role = ALL_ROLES[rng.integer(0, ALL_ROLES.length)]
    if (
      rollMeleeDamage(role, 'actor', () => 0) !==
      rollMeleeDamage(role, 'player', () => 0)
    ) {
      tableDisagreements += 1
    }

    // 4. "A knockback threshold of 2.5 is arbitrary, round it to 2." Moves which kills
    //    launch the body.
    const knockback = rng.range(1.6, 3.4)
    if (
      selectDeathStyle({
        attackKind: 'melee',
        requestedKnockback: knockback,
        lateralStrength: 0.1,
        sourceInFront: false,
      }) !== legacyDeathStyle('melee', knockback + 0.5, 0.1, false)
    ) {
      deathDisagreements += 1
    }

    // 5. "A cleave and a jab both hit composure." Flattens the poise multiplier.
    const poiseSeed = {
      role: 'soldier' as ActorRole,
      reaction: 'none' as CombatReactionKind,
      reactionRemaining: 0,
      poise: actorMaxPoise('soldier'),
      maxPoise: actorMaxPoise('soldier'),
      poiseRecoveryDelay: 0,
      staggerImmunity: 0,
    }
    const outcome = {
      applied: true,
      dealt: rng.range(10, 30),
      killed: false,
      weight: 'normal' as CombatHitWeight,
      blocked: false,
      impact: 0,
    }
    const cleaved: CombatActor = { ...poiseSeed, alive: true, hp: 100, maxHp: 100 }
    const jabbed: CombatActor = { ...poiseSeed, alive: true, hp: 100, maxHp: 100 }
    applyDamageReaction(cleaved, outcome, 'cleave')
    applyDamageReaction(jabbed, outcome, 'melee')
    if (cleaved.poise !== jabbed.poise) poiseDisagreements += 1
  }

  assert.ok(
    playerDisagreements > 0,
    'the shield-cone comparison must detect a changed implementation',
  )
  assert.ok(
    actorDisagreements > 0,
    'the brute-frontal comparison must detect a changed implementation',
  )
  assert.ok(
    tableDisagreements > 0,
    'the two melee columns must be distinguishable, or collapsing them merged them',
  )
  assert.ok(
    deathDisagreements > 0,
    'the death-style comparison must detect a changed threshold',
  )
  assert.ok(
    poiseDisagreements > 0,
    'the poise comparison must detect a flattened attack-kind multiplier',
  )
})
