/**
 * Roadmap 1.1 — what the honest melee actually measures, and the controls that keep the
 * measurements from being decoration.
 *
 * The asymmetry this initiative answers is stated in `docs/STRATEGY.md`: the enemy half of
 * the combat conversation has wind-ups, telegraphs, contact, recovery, flinch, poise and
 * stagger; the player half was a 0.52 s cooldown, a 3.6 m nearest-hostile scan and a
 * facing snap, so **once anything hostile was inside that radius the swing could not miss
 * and could not be aimed**. Four signals were named for the fix, plus one number from the
 * open disagreements. This file produces all five.
 *
 * ---
 *
 * **The controls, because a number without one is a claim.**
 *
 * - *A swing must be able to miss.* Asserted twice: structurally, by handing
 *   `selectMeleeTarget` a candidate outside the arc with an overwhelming score; and
 *   empirically, by a whiff rate above zero in a real run. The legacy arm's whiff rate of
 *   exactly zero is what makes the second one mean something — it is the same policy, the
 *   same seeds and the same world, differing only in the melee model.
 * - *The assist may never reach outside the arc.* Same test from the other side: a
 *   candidate one degree outside the arc, and one centimetre beyond the reach, each with
 *   the best possible assist score, must both be refused — and the *same* candidate moved
 *   just inside must be taken, or the refusal would only prove the function returns null.
 * - *The defensive cancel must do something.* Signal 2 is a comparison between three arms
 *   that differ only in how much of a telegraph the scripted player answers, so "the
 *   avoided share rose" is a difference rather than an assertion.
 * - *The finisher must be the only stance-breaker.* A normal beat with the same damage is
 *   run against the same target, and must not break it.
 *
 * ---
 *
 * **The one number from the open disagreements.** Disagreement (a) — whether a true dodge
 * is ever needed — was converted into an acceptance criterion rather than resolved: *if a
 * beat's commitment window exceeds the 0.18 s scout/minion floor, movement stops being an
 * answer.* `PLAYER_MELEE_FINISHER_COMMITMENT` is that window, it is asserted here against
 * the floor, and the measured consequence — hits taken while committed — is counted
 * alongside it. **No dodge is added either way.** The number is reported; the decision is
 * the roadmap owner's.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import type { ActorRole } from '../src/game/types.ts'
import {
  PLAYER_MELEE_BEATS,
  PLAYER_MELEE_BUFFER,
  PLAYER_MELEE_CHAIN_WINDOW,
  PLAYER_MELEE_FINISHER_COMMITMENT,
  PLAYER_MELEE_RESET_COOLDOWN,
  actionWindup,
  actorBaseHealth,
  actorMaxPoise,
  advancePlayerMelee,
  advanceReaction,
  applyDamageReaction,
  bufferPlayerMelee,
  cancelPlayerMelee,
  createPlayerMeleeState,
  isPlayerMeleeCommitted,
  isWithinMeleeArc,
  meleeAssistScore,
  nextPlayerMeleeBeat,
  playerBeatSpec,
  resolveActorDamage,
  selectMeleeTarget,
  type CombatActor,
  type MeleeArcCandidate,
  type PlayerMeleeState,
} from '../src/game/world/CombatResolver.ts'
import {
  runHarness,
  type MeleeDefence,
  type MeleeMetrics,
  type MeleeModel,
} from './runHarness.ts'

/** The scout/minion wind-up. Open disagreement (a)'s floor, written once. */
const WINDUP_FLOOR = 0.18
/** The brute's wind-up. The top of the band signal 3 names. */
const WINDUP_CEILING = 0.56

const SEEDS = [424242, 182138, 991, 20260729, 7920, 15839]
const TIME_LIMIT = 300

interface Arm {
  beatsResolved: number
  beatsWhiffed: number
  whiffRate: number
  telegraphedHeavies: number
  telegraphedHeaviesAvoided: number
  avoidableHitRate: number
  finishersLanded: number
  poiseBreaks: number
  cancels: number
  hitsWhileCommitted: number
  damageDealt: number
  windupClearAttempts: Record<string, number>
  windupClears: Record<string, number>
}

/**
 * One arm of the comparison: the same six seeds, the same faction, the same duelist
 * policy, the same simulation rate — differing only in the melee model and how much of a
 * telegraph the player answers.
 */
function arm(meleeModel: MeleeModel, meleeDefence: MeleeDefence): Arm {
  const total: Arm = {
    beatsResolved: 0,
    beatsWhiffed: 0,
    whiffRate: 0,
    telegraphedHeavies: 0,
    telegraphedHeaviesAvoided: 0,
    avoidableHitRate: 0,
    finishersLanded: 0,
    poiseBreaks: 0,
    cancels: 0,
    hitsWhileCommitted: 0,
    damageDealt: 0,
    windupClearAttempts: {},
    windupClears: {},
  }
  for (const seed of SEEDS) {
    const report = runHarness({
      seed,
      faction: 'elf',
      policy: 'duelist',
      hz: 60,
      timeLimit: TIME_LIMIT,
      meleeModel,
      meleeDefence,
    })
    const melee: MeleeMetrics = report.melee
    total.beatsResolved += melee.beatsResolved
    total.beatsWhiffed += melee.beatsWhiffed
    total.telegraphedHeavies += melee.telegraphedHeavies
    total.telegraphedHeaviesAvoided += melee.telegraphedHeaviesAvoided
    total.finishersLanded += melee.finishersLanded
    total.poiseBreaks += melee.poiseBreaks
    total.cancels += melee.cancels
    total.hitsWhileCommitted += melee.hitsWhileCommitted
    total.damageDealt += report.damageDealt.total
    for (const [role, count] of Object.entries(melee.windupClearAttempts)) {
      total.windupClearAttempts[role] = (total.windupClearAttempts[role] ?? 0) + count
    }
    for (const [role, count] of Object.entries(melee.windupClears)) {
      total.windupClears[role] = (total.windupClears[role] ?? 0) + count
    }
  }
  total.whiffRate =
    total.beatsResolved > 0 ? total.beatsWhiffed / total.beatsResolved : 0
  total.avoidableHitRate =
    total.telegraphedHeavies > 0
      ? total.telegraphedHeaviesAvoided / total.telegraphedHeavies
      : 0
  return total
}

// ---------------------------------------------------------------------------
// The contract: three beats, buffered, and chaining has to beat mashing
// ---------------------------------------------------------------------------

/** Runs the state machine at a fixed rate with a scripted press schedule. */
function drive(
  state: PlayerMeleeState,
  seconds: number,
  options: {
    hz?: number
    stamina?: number
    press?: (elapsed: number) => boolean
  } = {},
): { contacts: number[]; starts: number[]; stalls: number } {
  const hz = options.hz ?? 240
  const delta = 1 / hz
  const contacts: number[] = []
  const starts: number[] = []
  let stalls = 0
  let elapsed = 0
  while (elapsed < seconds) {
    elapsed += delta
    if (options.press?.(elapsed) ?? true) bufferPlayerMelee(state)
    const step = advancePlayerMelee(state, {
      delta,
      stamina: options.stamina ?? 100,
    })
    if (step.startedBeat > 0) starts.push(step.startedBeat)
    if (step.contactBeat > 0) contacts.push(step.contactBeat)
    if (step.finisherStalled) stalls += 1
  }
  return { contacts, starts, stalls }
}

test('a held button walks the three beats in order and keeps walking them', () => {
  const state = createPlayerMeleeState()
  const { contacts } = drive(state, 4)

  assert.ok(contacts.length >= 9, `only ${String(contacts.length)} beats landed in 4 s`)
  // The sequence, not a stutter: every window of three is 1, 2, 3 in order.
  for (let index = 0; index + 2 < contacts.length; index += 3) {
    assert.deepEqual(contacts.slice(index, index + 3), [1, 2, 3])
  }
  assert.equal(new Set(contacts).size, PLAYER_MELEE_BEATS.length)
})

test('chaining beats mashing, so the third beat is not a tax on the first', () => {
  // Beat one is the shortest beat. If the sequence reset for free a player would spam it
  // and never see beats two or three, which would make the whole initiative decorative.
  // The chain window is what stops that: reopening at beat one costs a wait.
  const chained = createPlayerMeleeState()
  const chainedRun = drive(chained, 12)
  const chainedDamage = chainedRun.contacts.reduce(
    (total, beat) => total + playerBeatSpec(beat).damageMultiplier,
    0,
  )

  // The masher: presses only after letting the chain window lapse, so every swing is a
  // fresh beat one.
  const mashed = createPlayerMeleeState()
  let sinceIdle = 0
  const mashedRun = drive(mashed, 12, {
    press: () => {
      const idle = mashed.phase === 'idle'
      sinceIdle = idle ? sinceIdle + 1 / 240 : 0
      return idle && mashed.chainRemaining <= 0 && sinceIdle > 0
    },
  })
  const mashedDamage = mashedRun.contacts.reduce(
    (total, beat) => total + playerBeatSpec(beat).damageMultiplier,
    0,
  )

  assert.deepEqual(new Set(mashedRun.contacts), new Set([1]), 'the masher chained anyway')
  assert.ok(
    chainedDamage > mashedDamage * 1.15,
    `chaining ${chainedDamage.toFixed(1)} must beat mashing ${mashedDamage.toFixed(1)}`,
  )
})

test('a press is remembered across a beat, and forgotten after the buffer', () => {
  // The buffer is what makes the sequence feel like one button rather than a rhythm test.
  const buffered = createPlayerMeleeState()
  bufferPlayerMelee(buffered)
  advancePlayerMelee(buffered, { delta: 0.001, stamina: 100 })
  assert.equal(buffered.beat, 1)
  // One press during beat one's wind-up, then nothing: it must still become beat two.
  bufferPlayerMelee(buffered)
  const first = playerBeatSpec(1)
  const second = playerBeatSpec(2)
  const { contacts } = drive(
    buffered,
    first.windup + first.recovery + second.windup + 0.05,
    { press: () => false },
  )
  assert.deepEqual(contacts, [1, 2], 'the buffered press was dropped')

  // And the negative control: a press older than the buffer is gone.
  const stale = createPlayerMeleeState()
  bufferPlayerMelee(stale)
  advancePlayerMelee(stale, { delta: PLAYER_MELEE_BUFFER + 0.01, stamina: 100 })
  assert.equal(stale.beat, 0, 'a stale press still opened the sequence')
})

test('the sequence closes when the chain window lapses', () => {
  const state = createPlayerMeleeState()
  bufferPlayerMelee(state)
  const opener = playerBeatSpec(1)
  drive(state, opener.windup + opener.recovery + 0.02, { press: () => false })
  assert.equal(state.phase, 'idle')
  assert.equal(state.beat, 1)
  assert.ok(state.chainRemaining > 0)
  assert.equal(nextPlayerMeleeBeat(state), 2)

  advancePlayerMelee(state, { delta: PLAYER_MELEE_CHAIN_WINDOW + 0.01, stamina: 100 })
  assert.equal(state.beat, 0, 'the sequence stayed open past its window')
  assert.equal(nextPlayerMeleeBeat(state), 1)
})

// ---------------------------------------------------------------------------
// Control 1: a swing must be able to miss
// ---------------------------------------------------------------------------

test('the arc refuses everything outside it, whatever the assist would prefer', () => {
  // The control that fails if the swing becomes unmissable again. Each candidate is
  // constructed to be the *most* attractive thing the assist could possibly want — dead
  // ahead in range terms, alone in the list — and still outside the arc by a hair.
  for (const spec of PLAYER_MELEE_BEATS) {
    const justOutsideTheArc: MeleeArcCandidate = {
      id: 'outside-arc',
      distance: 0.5,
      aimDot: spec.arcDot - 1e-6,
      hostile: true,
    }
    const justOutOfReach: MeleeArcCandidate = {
      id: 'out-of-reach',
      distance: spec.reach + 0.01,
      aimDot: 1,
      hostile: true,
    }
    const behind: MeleeArcCandidate = {
      id: 'behind',
      distance: 0.5,
      aimDot: -1,
      hostile: true,
    }
    for (const candidate of [justOutsideTheArc, justOutOfReach, behind]) {
      assert.equal(isWithinMeleeArc(candidate, spec), false, `${candidate.id} passed`)
      assert.equal(
        selectMeleeTarget([candidate], spec),
        null,
        `${candidate.id} was struck by beat ${String(spec.beat)}`,
      )
    }

    // Non-vacuity: the same two candidates, moved *just* inside, must be taken. Without
    // this the assertions above would be satisfied by a function that always returns null.
    const insideArc: MeleeArcCandidate = { ...justOutsideTheArc, aimDot: spec.arcDot }
    const insideReach: MeleeArcCandidate = { ...justOutOfReach, distance: spec.reach }
    assert.equal(selectMeleeTarget([insideArc], spec)?.id, 'outside-arc')
    assert.equal(selectMeleeTarget([insideReach], spec)?.id, 'out-of-reach')
  }
})

test('the assist biases inside the arc and cannot widen it', () => {
  const spec = playerBeatSpec(1)
  // Two hostiles, both legal. The one the player is looking at wins even though the other
  // is nearer, which is the whole of what "soft assist" is allowed to mean.
  const lookedAt: MeleeArcCandidate = {
    id: 'looked-at',
    distance: spec.reach * 0.9,
    aimDot: 0.99,
    hostile: true,
  }
  const nearerButWide: MeleeArcCandidate = {
    id: 'nearer',
    distance: 0.6,
    aimDot: spec.arcDot + 0.01,
    hostile: true,
  }
  assert.equal(selectMeleeTarget([nearerButWide, lookedAt], spec)?.id, 'looked-at')
  assert.ok(meleeAssistScore(lookedAt, spec) > meleeAssistScore(nearerButWide, spec))

  // And the same pair with the looked-at one pushed a hair outside the arc: the assist
  // must fall back to the legal target rather than reaching past the arc for its favourite.
  const pushedOut: MeleeArcCandidate = { ...lookedAt, distance: spec.reach + 0.01 }
  assert.equal(selectMeleeTarget([nearerButWide, pushedOut], spec)?.id, 'nearer')
})

test('hostiles are struck before bystanders, whatever the assist prefers', () => {
  // §5D's rule, kept from the old auto-target: being *able* to whack a peasant is the
  // joke; having the assist do it for you while a wolf is in the arc is a bug.
  const spec = playerBeatSpec(1)
  const villagerDeadAhead: MeleeArcCandidate = {
    id: 'villager',
    distance: 0.4,
    aimDot: 1,
    hostile: false,
  }
  const wolfAtTheEdge: MeleeArcCandidate = {
    id: 'wolf',
    distance: spec.reach,
    aimDot: spec.arcDot,
    hostile: true,
  }
  assert.equal(selectMeleeTarget([villagerDeadAhead, wolfAtTheEdge], spec)?.id, 'wolf')
  // Non-vacuity: with nothing to fight, the villager is a legal target again.
  assert.equal(selectMeleeTarget([villagerDeadAhead], spec)?.id, 'villager')
})

// ---------------------------------------------------------------------------
// The finisher: stamina, poise, and the commitment window
// ---------------------------------------------------------------------------

test('only the third beat costs stamina, and it refuses to open without it', () => {
  assert.deepEqual(
    PLAYER_MELEE_BEATS.map((spec) => spec.staminaCost > 0),
    [false, false, true],
  )
  const cost = playerBeatSpec(PLAYER_MELEE_BEATS.length).staminaCost
  assert.ok(cost > 0)

  // An empty bar must not swallow the press: the one-button promise is that the button
  // always does something, so a refused finisher opens beat one instead.
  const state = createPlayerMeleeState()
  const run = drive(state, 3, { stamina: cost - 1 })
  assert.ok(run.stalls > 0, 'the finisher opened on an empty bar')
  assert.deepEqual(new Set(run.contacts), new Set([1, 2]), 'a finisher landed unpaid')
  assert.ok(run.starts.length > run.contacts.length - 2, 'the press was swallowed')

  // Non-vacuity: the same schedule with the stamina present does reach the finisher.
  const paid = createPlayerMeleeState()
  const paidRun = drive(paid, 3, { stamina: 100 })
  assert.equal(paidRun.stalls, 0)
  assert.ok(paidRun.contacts.includes(PLAYER_MELEE_BEATS.length))
})

test('a finisher breaks every role from full poise, and a normal beat does not', () => {
  // The third beat's reason to exist. `actorMaxPoise` runs 18/28/46/58/72 by role, and a
  // rule that held for a scout and not for a champion would be a rule about damage.
  const roles: readonly ActorRole[] = [
    'scout',
    'minion',
    'archer',
    'soldier',
    'captive',
    'peasant',
    'commander',
    'brute',
    'champion',
    'wolf',
    'boar',
    'bear',
    'troll',
  ]
  const finisher = playerBeatSpec(PLAYER_MELEE_BEATS.length)
  const opener = playerBeatSpec(1)

  for (const role of roles) {
    // Deliberately far too small a hit to break anything by arithmetic: the weakest poise
    // in the game is 18, and 10 damage is 7.5 poise as an ordinary beat and 14.5 as a
    // cleave — the strongest attack kind before 1.1. The finisher breaks anyway, because
    // its break is a rule.
    const dealt = 10
    assert.equal(
      applyDamageReaction(freshTarget(role), hit(dealt), finisher.attackKind),
      true,
      `a finisher failed to break ${role}`,
    )
    assert.equal(
      applyDamageReaction(freshTarget(role), hit(dealt), opener.attackKind),
      false,
      `an ordinary beat of ${String(dealt)} broke ${role}`,
    )
    assert.equal(
      applyDamageReaction(freshTarget(role), hit(dealt), 'cleave'),
      false,
      `a cleave of ${String(dealt)} broke ${role}`,
    )
  }

  // Non-vacuity for the two negatives: a big enough ordinary beat *does* break a stance,
  // so "the ordinary beat did not break it" is about the kind and not about the harness.
  assert.equal(applyDamageReaction(freshTarget('champion'), hit(400), 'melee'), true)

  // And the immunity window still holds, so the finisher breaks a stance rather than
  // locking one.
  const immune = freshTarget('champion')
  immune.staggerImmunity = 0.3
  assert.equal(applyDamageReaction(immune, hit(999), finisher.attackKind), false)
})

test('only the finisher commits, and the window is measured against the 0.18 s floor', () => {
  // Open disagreement (a), as an executable acceptance criterion.
  assert.equal(
    PLAYER_MELEE_FINISHER_COMMITMENT,
    playerBeatSpec(3).windup + playerBeatSpec(3).recovery,
  )
  assert.deepEqual(
    PLAYER_MELEE_BEATS.map((spec) => spec.commits),
    [false, false, true],
  )

  // Beats one and two are cancellable in *both* phases; the finisher is cancellable in
  // neither. That is the whole of the defensive verb and the whole of its price.
  for (const spec of PLAYER_MELEE_BEATS) {
    for (const phase of ['windup', 'recovery'] as const) {
      const state = createPlayerMeleeState()
      state.beat = spec.beat
      state.phase = phase
      state.phaseRemaining = phase === 'windup' ? spec.windup : spec.recovery
      assert.equal(isPlayerMeleeCommitted(state), spec.commits)
      assert.equal(cancelPlayerMelee(state), !spec.commits)
      assert.equal(state.phase, spec.commits ? phase : 'idle')
    }
  }

  // The finisher's dead time survives a cancel, so cancelling is not a discount on a
  // finisher already thrown.
  const spent = createPlayerMeleeState()
  spent.lockout = PLAYER_MELEE_RESET_COOLDOWN
  cancelPlayerMelee(spent)
  assert.equal(spent.lockout, PLAYER_MELEE_RESET_COOLDOWN)

  // The reported number. It exceeds the floor: the finisher is the one place in 1.1 where
  // movement stops being an answer, which is precisely the condition disagreement (a)
  // asked to have written down. No dodge is added either way — this is a report.
  assert.ok(
    PLAYER_MELEE_FINISHER_COMMITMENT > WINDUP_FLOOR,
    `commitment ${PLAYER_MELEE_FINISHER_COMMITMENT.toFixed(3)} s vs floor ${String(WINDUP_FLOOR)} s`,
  )
  // But the part that cannot be taken back — the swing itself — is inside the floor, so a
  // scout's jab thrown at the same instant is still answerable up to the contact frame.
  assert.ok(
    playerBeatSpec(3).windup < WINDUP_FLOOR,
    `pre-contact commit ${playerBeatSpec(3).windup.toFixed(3)} s`,
  )
  // And it is the shortest commitment the beat table allows: no other beat is longer.
  assert.equal(
    Math.max(...PLAYER_MELEE_BEATS.map((spec) => spec.windup + spec.recovery)),
    PLAYER_MELEE_FINISHER_COMMITMENT,
  )
})

// ---------------------------------------------------------------------------
// Signal 1: whiff rate above zero and below ~35 %
// ---------------------------------------------------------------------------

test('signal 1: the swing whiffs sometimes and not often', () => {
  const honest = arm('honest', 'heavy')
  const legacy = arm('legacy', 'heavy')

  assert.ok(honest.beatsResolved > 200, `only ${String(honest.beatsResolved)} beats`)
  assert.ok(honest.whiffRate > 0, 'a swing that cannot miss is the thing 1.1 replaced')
  assert.ok(
    honest.whiffRate < 0.35,
    `whiff rate ${honest.whiffRate.toFixed(3)} is above the ~35 % ceiling`,
  )
  // The control arm. The pre-1.1 model resolves no beats at all, because it has none —
  // its swing is instantaneous and unmissable, which is why its whiff rate is exactly the
  // zero this signal exists to move off.
  assert.equal(legacy.beatsResolved, 0)
  assert.equal(legacy.whiffRate, 0)

  // And the sequence really reaches its third beat rather than stalling at one.
  assert.ok(honest.finishersLanded > 20, `${String(honest.finishersLanded)} finishers`)
  assert.ok(honest.poiseBreaks > honest.finishersLanded, 'the finisher broke no stances')
})

// ---------------------------------------------------------------------------
// Signal 2: the avoidable-hit rate rises
// ---------------------------------------------------------------------------

test('signal 2: answering a telegraph avoids it, and not answering does not', () => {
  const none = arm('honest', 'none')
  const heavy = arm('honest', 'heavy')
  const all = arm('honest', 'all')

  // Non-vacuity first: every arm has to have been *offered* telegraphed heavies, or the
  // ratios below are ratios of nothing.
  for (const [label, measured] of [
    ['none', none],
    ['heavy', heavy],
    ['all', all],
  ] as const) {
    assert.ok(
      measured.telegraphedHeavies >= 15,
      `${label} saw only ${String(measured.telegraphedHeavies)} heavies`,
    )
  }

  assert.ok(
    none.avoidableHitRate < 0.25,
    `the control arm avoided ${none.avoidableHitRate.toFixed(3)} without trying`,
  )
  assert.ok(
    heavy.avoidableHitRate > none.avoidableHitRate * 2.5,
    `answering raised the avoided share only from ${none.avoidableHitRate.toFixed(3)} to ${heavy.avoidableHitRate.toFixed(3)}`,
  )
  assert.ok(
    all.avoidableHitRate > 0.6,
    `answering every tell avoided ${all.avoidableHitRate.toFixed(3)}`,
  )
  assert.ok(none.cancels === 0 && all.cancels > 0, 'the cancel counter is not wired')

  // The cost, measured rather than argued: the committed finisher is the one place the
  // player cannot answer, and the arm that throws the most finishers eats the most hits
  // while rooted.
  assert.ok(
    all.hitsWhileCommitted < heavy.hitsWhileCommitted,
    `committed hits ${String(all.hitsWhileCommitted)} vs ${String(heavy.hitsWhileCommitted)}`,
  )
})

// ---------------------------------------------------------------------------
// Signal 3: movement-cancel clears the 0.18–0.56 s wind-up band
// ---------------------------------------------------------------------------

test('signal 3: the cancel clears the whole 0.18-0.56 s wind-up band', () => {
  const answered = arm('honest', 'all')
  const roles = Object.keys(answered.windupClearAttempts).filter(
    (role) => answered.windupClearAttempts[role] >= 20,
  )

  // The band has to be covered at both ends, or "clears the band" is a claim about
  // whichever role happened to show up.
  const windups = roles.map((role) => actionWindup(role as ActorRole))
  assert.ok(
    Math.min(...windups) <= WINDUP_FLOOR,
    `the fastest role sampled winds up in ${String(Math.min(...windups))} s`,
  )
  assert.ok(
    Math.max(...windups) >= WINDUP_CEILING,
    `the slowest role sampled winds up in ${String(Math.max(...windups))} s`,
  )

  for (const role of roles) {
    const attempts = answered.windupClearAttempts[role]
    const cleared = answered.windupClears[role] ?? 0
    assert.ok(
      cleared / attempts >= 0.85,
      `${role} (${String(actionWindup(role as ActorRole))} s): cleared ${String(cleared)}/${String(attempts)}`,
    )
  }

  // The control: the arm that does not answer clears nothing, so the rate above is the
  // cancel and not the scripted player wandering off by accident.
  const ignored = arm('honest', 'none')
  assert.deepEqual(ignored.windupClearAttempts, {})
  assert.deepEqual(ignored.windupClears, {})
})

// ---------------------------------------------------------------------------
// Signal 4: time-to-kill separates by role
// ---------------------------------------------------------------------------

/**
 * One duel, through the shipped combat model and nothing else.
 *
 * The full-run harness cannot answer this: it gives every humanoid 90 health, which is a
 * stated simplification, so a time-to-kill measured there would be a measurement of the
 * harness. This drives `CombatResolver`'s own beat table, damage, poise and reaction
 * against the role's real spawn health, at a fixed rate, with a seeded roll.
 */
function timeToKill(role: ActorRole, model: MeleeModel): number {
  const rng = new RandomStream(deriveSeed('honest-melee', `${model}:${role}`))
  const health = actorBaseHealth(role)
  const target: CombatActor = {
    role,
    alive: true,
    hp: health,
    maxHp: health,
    reaction: 'none',
    reactionRemaining: 0,
    poise: actorMaxPoise(role),
    maxPoise: actorMaxPoise(role),
    poiseRecoveryDelay: 0,
    staggerImmunity: 0,
  }
  const state = createPlayerMeleeState()
  const hz = 240
  const delta = 1 / hz
  let elapsed = 0
  let stamina = 100
  let legacyCooldown = 0
  while (elapsed < 120 && target.alive) {
    elapsed += delta
    advanceReaction(target, delta)
    stamina = Math.min(100, stamina + delta * 16)
    if (model === 'legacy') {
      legacyCooldown = Math.max(0, legacyCooldown - delta)
      if (legacyCooldown > 0) continue
      legacyCooldown = 0.52
      strike(target, 28 + rng.next() * 7, 'melee')
      continue
    }
    bufferPlayerMelee(state)
    const step = advancePlayerMelee(state, { delta, stamina })
    stamina -= step.staminaSpent
    if (step.contactBeat === 0) continue
    const spec = playerBeatSpec(step.contactBeat)
    strike(target, (28 + rng.next() * 7) * spec.damageMultiplier, spec.attackKind)
  }
  return target.alive ? Number.POSITIVE_INFINITY : elapsed
}

function strike(
  target: CombatActor,
  baseDamage: number,
  attackKind: ReturnType<typeof playerBeatSpec>['attackKind'],
): void {
  const outcome = resolveActorDamage({
    target,
    baseDamage,
    attackKind,
    facingDotToSource: null,
  })
  target.hp = Math.max(0, target.hp - outcome.dealt)
  applyDamageReaction(target, outcome, attackKind)
  if (outcome.killed) target.alive = false
}

test('signal 4: time-to-kill separates by role, and 1.1 did not trivialise it', () => {
  // Ordered by spawn health: peasant 26, archer 45, scout 55, soldier 70, brute 130,
  // commander 150, champion 260. A model that flattened these would make every enemy the
  // same fight, which is the failure this signal is watching for.
  const ladder: readonly ActorRole[] = [
    'peasant',
    'archer',
    'scout',
    'soldier',
    'brute',
    'commander',
    'champion',
  ]
  const honest = ladder.map((role) => timeToKill(role, 'honest'))
  const legacy = ladder.map((role) => timeToKill(role, 'legacy'))

  // Non-decreasing rather than strictly increasing, and the reason is worth writing down:
  // time-to-kill is quantised by the beat schedule, so two roles whose health differs by
  // less than one beat's damage genuinely die on the same beat. Separation is asserted as
  // the number of *distinct* rungs instead, which is what "separates by role" can honestly
  // mean for a model with discrete contact frames.
  for (let index = 1; index < ladder.length; index += 1) {
    assert.ok(
      honest[index] >= honest[index - 1],
      `${ladder[index]} (${honest[index].toFixed(2)} s) dies faster than ${ladder[index - 1]} (${honest[index - 1].toFixed(2)} s)`,
    )
  }
  assert.ok(
    new Set(honest.map((value) => value.toFixed(2))).size >= 5,
    `only ${String(new Set(honest.map((value) => value.toFixed(2))).size)} distinct rungs across seven roles`,
  )
  // The spread has to be worth having: a champion is a fight, a peasant is a swing.
  assert.ok(
    honest[ladder.length - 1] / honest[0] > 6,
    `the ladder spans only ${(honest[ladder.length - 1] / honest[0]).toFixed(1)}x`,
  )

  // Against the model it replaces. The comparison is per-role rather than a single
  // number, because the two models fail in opposite directions: the pre-1.1 swing lands
  // instantly, so it kills a 26-health peasant faster than any wind-up ever can, while
  // the sequence pulls ahead the moment a fight lasts longer than one swing. Both halves
  // are asserted so neither can quietly stop being true.
  const heavyRoles = ladder.filter((role) => actorBaseHealth(role) >= 70)
  for (const role of heavyRoles) {
    const index = ladder.indexOf(role)
    assert.ok(
      honest[index] < legacy[index],
      `${role}: honest ${honest[index].toFixed(2)} s is not faster than legacy ${legacy[index].toFixed(2)} s`,
    )
    assert.ok(
      honest[index] > legacy[index] * 0.45,
      `${role}: honest ${honest[index].toFixed(2)} s trivialises legacy ${legacy[index].toFixed(2)} s`,
    )
  }
  // And the light roles must not become a chore, which is the other way a wind-up can go
  // wrong. The bound is the sequence's own length: nothing under a soldier's health may
  // survive one full three-beat chain.
  const chainDuration = PLAYER_MELEE_BEATS.reduce(
    (total, spec) => total + spec.windup + spec.recovery,
    0,
  )
  for (const role of ladder.filter((candidate) => actorBaseHealth(candidate) < 70)) {
    const index = ladder.indexOf(role)
    assert.ok(
      honest[index] <= chainDuration,
      `${role}: honest ${honest[index].toFixed(2)} s outlives a whole chain (${chainDuration.toFixed(2)} s)`,
    )
  }
  assert.ok(honest[ladder.indexOf('brute')] > 1)
})

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('the honest arm is as deterministic as the legacy one, and reads no clock', () => {
  const realRandom = Math.random
  const realNow = Date.now
  const realPerformanceNow = performance.now
  const forbidden = (name: string) => () => {
    throw new Error(`the melee model read ${name}`)
  }
  Math.random = forbidden('Math.random') as typeof Math.random
  Date.now = forbidden('Date.now') as typeof Date.now
  performance.now = forbidden('performance.now') as typeof performance.now
  let first
  let repeat
  try {
    const options = {
      seed: 424242,
      faction: 'elf',
      policy: 'duelist',
      hz: 60,
      timeLimit: 90,
      meleeModel: 'honest',
      meleeDefence: 'heavy',
    } as const
    first = runHarness(options)
    repeat = runHarness(options)
  } finally {
    Math.random = realRandom
    Date.now = realNow
    performance.now = realPerformanceNow
  }
  assert.deepEqual(repeat, first, 'the honest arm is not deterministic')
  // Non-vacuity: the run has to have actually swung for the comparison to say anything.
  assert.ok(first.melee.beatsResolved > 0)
})

function freshTarget(role: ActorRole): CombatActor {
  const poise = actorMaxPoise(role)
  const health = actorBaseHealth(role)
  return {
    role,
    alive: true,
    hp: health,
    maxHp: health,
    reaction: 'none',
    reactionRemaining: 0,
    poise,
    maxPoise: poise,
    poiseRecoveryDelay: 0,
    staggerImmunity: 0,
  }
}

function hit(dealt: number): {
  applied: boolean
  dealt: number
  killed: boolean
  weight: 'normal'
  blocked: boolean
  impact: number
} {
  return { applied: true, dealt, killed: false, weight: 'normal', blocked: false, impact: 0 }
}
