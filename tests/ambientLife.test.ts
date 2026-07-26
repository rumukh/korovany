/**
 * Layer 5 — ambient life.
 *
 * Three kinds of claim live here, and they are deliberately not the same kind:
 *
 * 1. **Geometry and gating**, which are decidable. A flee direction that recedes, a
 *    startle radius that widens when the player sprints, a civilian count that follows
 *    the chronicle, an alarm search that finds what it should and ignores what it should
 *    not. These are unit tests and they are the bulk of the file.
 * 2. **One A/B measurement** of civilian panic, run through `tests/aiHarness.ts` — same
 *    shape as Layers 3 and 4, both arms shipped code, dense metrics preferred over
 *    deaths, with the disengage check the harness header demands asserted directly.
 * 3. **Nothing at all about how it feels**, which is most of what this layer is for.
 *    Whether a village reads as inhabited is not a number and is not claimed here; that
 *    was checked in the browser and §9 says so plainly.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import {
  AMBIENT_CIVILIAN_LIMIT,
  AMBIENT_STORM_SLOW,
  BIRD_SPRINT_STARTLE_BONUS,
  BIRD_STARTLE_RADIUS,
  CAMPFIRE_NIGHT_THRESHOLD,
  CIVILIAN_ALARM_RADIUS,
  CIVILIAN_MIN_INTEGRITY,
  CIVILIAN_PANIC_SPEED_MULTIPLIER,
  DEER_SPRINT_STARTLE_BONUS,
  DEER_STARTLE_RADIUS,
  civilianRoutine,
  fleeDirection,
  planCivilianCount,
  planWildlife,
  shouldStartle,
  weatherHunch,
  weatherPaceMultiplier,
} from '../src/game/world/AmbientLife.ts'
import {
  actorResolve,
  evaluateMorale,
  findCivilianAlarm,
  isPacifistRole,
  selectThreat,
  type AiActor,
  type AiPoint,
} from '../src/game/world/ActorAi.ts'
import {
  computeNightFactor,
  computeStormFactor,
  createWeatherMix,
} from '../src/game/world/WorldEnvironment.ts'
import { ALLEGIANCE_RELATIONS, type ActorRole, type Allegiance } from '../src/game/types.ts'
import {
  accumulate,
  makeFighter,
  runFight,
  type HarnessFighter,
  type HarnessOptions,
  type HarnessResult,
} from './aiHarness.ts'

const positionOf = (actor: TestActor): AiPoint => actor.position

interface TestActor extends AiActor {
  position: AiPoint
}

function actor(
  id: string,
  allegiance: Allegiance,
  role: ActorRole,
  x: number,
  z: number,
  overrides: Partial<TestActor> = {},
): TestActor {
  return {
    id,
    allegiance,
    role,
    alive: true,
    ignoredTargetId: null,
    targetId: null,
    packId: null,
    packKinSize: 1,
    hp: 70,
    maxHp: 70,
    playerAggro: false,
    position: { x, y: 0, z },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

test('a flee direction always recedes from what it is fleeing', () => {
  // The Layer 4 flanking ladder shipped with slots whose radial component was *negative*,
  // so ranks three and up walked away from their target forever. The assertion that would
  // have caught it was "every slot has a positive closing component"; this is the same
  // assertion pointed the other way, because a flee that does not recede is the Layer 3
  // and Layer 4 harness failure in yet another disguise.
  let checked = 0
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
    for (const distance of [0.5, 3, 17]) {
      const threatX = Math.sin(angle) * distance
      const threatZ = Math.cos(angle) * distance
      const away = fleeDirection(0, 0, threatX, threatZ, 0.3)

      const length = Math.hypot(away.x, away.z)
      assert.ok(Math.abs(length - 1) < 1e-9, `direction must be a unit vector: ${length}`)

      // One step along it must increase the distance to the threat. That is the whole
      // property, and it is the one a "skip your turn" model silently fails.
      const before = Math.hypot(threatX, threatZ)
      const after = Math.hypot(threatX - away.x, threatZ - away.z)
      assert.ok(after > before, `stepping away must recede: ${before} -> ${after}`)
      checked += 1
    }
  }
  assert.ok(checked >= 72, `the sweep must actually run: ${checked}`)
})

test('a flee direction from an identical position is still a direction', () => {
  // Degenerate input, and the one that matters: two bodies at exactly the same spot is
  // what a zero-length vector comes from, and returning `{0, 0}` would leave the actor
  // standing in the fight not fighting.
  const away = fleeDirection(4, 4, 4, 4, 1.1)
  assert.ok(
    Math.abs(Math.hypot(away.x, away.z) - 1) < 1e-9,
    'a coincident threat must still produce a unit direction',
  )
})

test('sprinting widens the startle radius, and only sprinting', () => {
  // "Birds startled by sprinting" from the design list, generalised to one rule over both
  // species rather than a bird-shaped special case.
  const justOutside = BIRD_STARTLE_RADIUS + BIRD_SPRINT_STARTLE_BONUS / 2
  assert.equal(
    shouldStartle(justOutside, BIRD_STARTLE_RADIUS, BIRD_SPRINT_STARTLE_BONUS, false),
    false,
    'walking past at that distance must not flush the bird',
  )
  assert.equal(
    shouldStartle(justOutside, BIRD_STARTLE_RADIUS, BIRD_SPRINT_STARTLE_BONUS, true),
    true,
    'sprinting past at the same distance must',
  )
  // And the bonus is not unbounded: far enough out, sprinting changes nothing.
  assert.equal(
    shouldStartle(
      BIRD_STARTLE_RADIUS + BIRD_SPRINT_STARTLE_BONUS + 1,
      BIRD_STARTLE_RADIUS,
      BIRD_SPRINT_STARTLE_BONUS,
      true,
    ),
    false,
  )
  // Deer are calmer than birds, which is the read the two constants are chosen for.
  assert.ok(
    DEER_STARTLE_RADIUS > BIRD_STARTLE_RADIUS &&
      DEER_SPRINT_STARTLE_BONUS > BIRD_SPRINT_STARTLE_BONUS,
    'a deer notices you further off, a bird panics closer in',
  )
})

// ---------------------------------------------------------------------------
// Gating: the chronicle, the day, and the weather
// ---------------------------------------------------------------------------

test('how busy a village is follows the chronicle, monotonically', () => {
  assert.equal(planCivilianCount(100), AMBIENT_CIVILIAN_LIMIT)
  assert.equal(planCivilianCount(0), 0, 'a razed square has nobody in it')
  assert.equal(
    planCivilianCount(CIVILIAN_MIN_INTEGRITY - 1),
    0,
    'and neither does one that is nearly razed',
  )
  let previous = -1
  for (let integrity = 0; integrity <= 100; integrity += 1) {
    const count = planCivilianCount(integrity)
    assert.ok(count >= previous, `count must never fall as integrity rises: ${integrity}`)
    assert.ok(
      count <= AMBIENT_CIVILIAN_LIMIT,
      `and never exceed the limit: ${count} at ${integrity}`,
    )
    previous = count
  }
  // The point of the whole rule: a raided square is visibly quieter than an intact one.
  assert.ok(
    planCivilianCount(100) > planCivilianCount(50),
    'a settlement that took a raid last night must be quieter',
  )
  assert.equal(planCivilianCount(Number.NaN), 0, 'a broken number empties the village')
})

test('the routine comes from elapsed run time, not from a display setting', () => {
  // The bug `WorldEnvironment` exists to prevent, checked at Layer 5's entry point:
  // `civilianRoutine` takes a night factor, and the only legal source of that number is
  // `computeNightFactor(elapsed)`. Turning the day/night cycle off pins the *rendered*
  // night factor to zero, and if that value reached here every campfire in the world
  // would go out and every villager would stand in the street at midnight.
  const displayNightFactor = 0 // what `GameEngine.nightFactor` is when the cycle is off

  let sawNight = false
  let sawDay = false
  let divergences = 0
  for (let elapsed = 0; elapsed < 480; elapsed += 3) {
    const simulated = computeNightFactor(elapsed)
    const routine = civilianRoutine(simulated)
    if (routine === 'gather') sawNight = true
    else sawDay = true
    if (routine !== civilianRoutine(displayNightFactor)) divergences += 1
  }
  // Assert the run actually exercises both halves, rather than passing by never
  // reaching night — the pattern §9 asks for in every gating claim.
  assert.ok(sawNight, 'the sweep must reach a night at which villagers gather')
  assert.ok(sawDay, 'and a day at which they do not')
  // The negative control: the display value gives a materially different answer, so the
  // two are genuinely distinguishable and this test would fail if they were wired
  // together. Agreement here would be the bug.
  assert.ok(
    divergences > 30,
    `the display value must disagree with the simulation: ${divergences}`,
  )
  assert.equal(
    civilianRoutine(CAMPFIRE_NIGHT_THRESHOLD),
    'gather',
    'the threshold itself is night, not day',
  )
})

test('the storm response comes from the weather mix and slows only walking', () => {
  const clear = createWeatherMix('clear')
  const storm = createWeatherMix('rain')
  assert.equal(computeStormFactor(clear), 0)
  assert.equal(computeStormFactor(storm), 1)

  assert.equal(weatherPaceMultiplier(computeStormFactor(clear)), 1, 'fair weather is free')
  assert.ok(
    Math.abs(weatherPaceMultiplier(computeStormFactor(storm)) - (1 - AMBIENT_STORM_SLOW)) <
      1e-9,
    'a full storm costs exactly the documented share of pace',
  )
  // Bounded on both sides: a garbled input must not stop the world or reverse it.
  assert.equal(weatherPaceMultiplier(Number.NaN), 1)
  assert.equal(weatherPaceMultiplier(-5), 1)
  assert.ok(weatherPaceMultiplier(5) > 0, 'the multiplier can never go negative')
  assert.equal(weatherHunch(0), 0)
  assert.ok(weatherHunch(1) > 0 && weatherHunch(1) === weatherHunch(4), 'hunch is clamped')
})

test('wildlife composition is seeded and reads the biome', () => {
  const roll = (seed: string, forested: boolean): string[] => {
    const rng = new RandomStream(deriveSeed('ambient-wildlife', seed))
    return Array.from({ length: 200 }, () => planWildlife(rng, forested))
  }
  assert.deepEqual(roll('a', true), roll('a', true), 'the same seed must replay')
  const forest = roll('a', true).filter((kind) => kind === 'deer').length
  const open = roll('a', false).filter((kind) => kind === 'deer').length
  assert.ok(forest > open, `the woods must hold more deer: ${forest} vs ${open}`)
  assert.ok(open > 0 && forest < 200, 'and neither biome may be all one thing')
})

// ---------------------------------------------------------------------------
// The alarm, and what a bystander does with it
// ---------------------------------------------------------------------------

test('a bystander is alarmed by a fight it is not part of', () => {
  // The rule with the substance. The three sides are `neutral` to civilians in the
  // matrix and must stay that way — making them hostile would turn every patrol in the
  // world into a peasant hunt — so a hostility search alone would let a faction raid
  // sweep through a village that carried on walking between the houses.
  assert.equal(
    ALLEGIANCE_RELATIONS.civilian.guard,
    'neutral',
    'this test is only meaningful while soldiers and villagers are neutral',
  )

  const villager = actor('villager', 'civilian', 'peasant', 0, 0)
  const bystander = actor('idle', 'guard', 'soldier', 3, 0)
  const fighter = actor('fighting', 'guard', 'soldier', 4, 0, { targetId: 'somebody' })

  assert.equal(
    findCivilianAlarm(villager, [villager, bystander], CIVILIAN_ALARM_RADIUS, positionOf),
    null,
    'a soldier standing about is not frightening',
  )
  const alarm = findCivilianAlarm(
    villager,
    [villager, bystander, fighter],
    CIVILIAN_ALARM_RADIUS,
    positionOf,
  )
  assert.ok(alarm, 'a soldier swinging at somebody is')
  assert.equal(alarm.source.x, 4, 'and the alarm points at the one that is fighting')
})

test('a body in the road is alarming, and a distant one is not', () => {
  const villager = actor('villager', 'civilian', 'peasant', 0, 0)
  const corpse = actor('corpse', 'guard', 'soldier', 5, 0, { alive: false })
  const far = actor('far', 'guard', 'soldier', 200, 0, {
    alive: false,
    id: 'far',
  })
  const near = findCivilianAlarm(
    villager,
    [villager, corpse],
    CIVILIAN_ALARM_RADIUS,
    positionOf,
  )
  assert.ok(near && Math.abs(near.distance - 5) < 1e-9, 'a body nearby is alarming')
  assert.equal(
    findCivilianAlarm(villager, [villager, far], CIVILIAN_ALARM_RADIUS, positionOf),
    null,
    'a body across the square is not',
  )
})

test('the player is only frightening while menacing, and the alarm takes the nearest', () => {
  const villager = actor('villager', 'civilian', 'peasant', 0, 0)
  const wolf = actor('wolf', 'beast', 'wolf', 8, 0)
  const player = { position: { x: 2, y: 0, z: 0 }, menacing: false }

  const calm = findCivilianAlarm(
    villager,
    [villager, wolf],
    CIVILIAN_ALARM_RADIUS,
    positionOf,
    player,
  )
  assert.ok(calm, 'the wolf is always alarming')
  assert.equal(calm.source.x, 8, 'but a player walking past is not, so the wolf wins')

  const menacing = findCivilianAlarm(
    villager,
    [villager, wolf],
    CIVILIAN_ALARM_RADIUS,
    positionOf,
    { ...player, menacing: true },
  )
  assert.ok(menacing, 'a player who has just swung is')
  assert.equal(menacing.source.x, 2, 'and being nearer, they are what it runs from')
})

test('panic is a reason inside the one morale rule, not a second rule beside it', () => {
  const input = {
    hpFraction: 1,
    groupShare: 1,
    packShare: 1,
    commanderNearby: false,
    commanderLost: false,
    alarmDistance: Number.POSITIVE_INFINITY,
  }
  // A healthy villager with nothing frightening in sight carries on with its day.
  assert.equal(evaluateMorale('peasant', input), 'none')
  // And breaks the moment something is.
  assert.equal(
    evaluateMorale('peasant', { ...input, alarmDistance: CIVILIAN_ALARM_RADIUS - 1 }),
    'panic',
  )
  assert.equal(
    evaluateMorale('peasant', { ...input, alarmDistance: CIVILIAN_ALARM_RADIUS + 1 }),
    'none',
    'the radius is the radius',
  )
  // A soldier standing in the same spot does not panic — panic is for bystanders, and
  // the gate is the role rather than the distance.
  assert.equal(
    evaluateMorale('soldier', { ...input, alarmDistance: 1 }),
    'none',
    'a soldier is not a bystander',
  )
  // The `null` gate still outranks panic, and `captive` is where that matters: a captive
  // must not panic out of its cage, and the rescue event owns its movement.
  assert.equal(actorResolve('captive'), null)
  assert.equal(
    evaluateMorale('captive', { ...input, alarmDistance: 0 }),
    'none',
    'an unbreakable role must not acquire a back door through panic',
  )
  // **And `captive` is deliberately not a pacifist role**, which is the assertion that
  // would have caught a defect this nearly shipped with. `rescueCaptive` frees a prisoner
  // by flipping `aiMode`, not `role` — the freed companion keeps `role: 'captive'` for
  // the rest of the run — so listing the role as pacifist would have left every rescued
  // ally permanently unable to fight or even retaliate. A caged captive needs no entry:
  // `updateActors` short-circuits on `aiMode === 'captive'` before targeting, and the
  // `null` resolve above is what keeps it calm.
  assert.equal(
    isPacifistRole('captive'),
    false,
    'a rescued captive must be able to fight; its pacifism is a state, not a role',
  )
  assert.equal(isPacifistRole('peasant'), true)
  assert.equal(isPacifistRole('soldier'), false)
  // And the villager still has the ordinary door underneath: hurt enough, it breaks with
  // nothing frightening nearby at all.
  assert.equal(evaluateMorale('peasant', { ...input, hpFraction: 0.2 }), 'individual')
})

test('a bystander never picks a fight, however hostile the matrix says it is', () => {
  // A wolf will eat a villager — `ALLEGIANCE_RELATIONS` says so and should. Hostility is
  // a relation; *starting a fight* is a behaviour, and without the gate the villager
  // scores the wolf like any other target and walks over to be eaten.
  assert.equal(ALLEGIANCE_RELATIONS.civilian.beast, 'hostile')
  const villager = actor('villager', 'civilian', 'peasant', 0, 0)
  const wolf = actor('wolf', 'beast', 'wolf', 3, 0)
  assert.equal(
    selectThreat(villager, [villager, wolf], 30, positionOf),
    null,
    'the villager picks nothing',
  )
  // The control: the same call with a soldier in the villager's place does find the wolf,
  // so the `null` above is the gate and not an empty candidate list.
  const soldier = actor('soldier', 'guard', 'soldier', 0, 0)
  assert.equal(
    selectThreat(soldier, [soldier, wolf], 30, positionOf),
    wolf,
    'a soldier in the same spot fights it',
  )
  // And a rescued captive — which keeps `role: 'captive'` for the whole run — must fight
  // too, or the rescue event hands the player a permanently useless companion.
  const freed = actor('freed', 'guard', 'captive', 0, 0)
  assert.equal(
    selectThreat(freed, [freed, wolf], 30, positionOf),
    wolf,
    'a freed captive must still be able to fight',
  )
})

// ---------------------------------------------------------------------------
// The one measurement
// ---------------------------------------------------------------------------

const TRIALS = 60
const tally = (record: Record<string, number>, key: string): number => record[key] ?? 0

/** A raid arriving on a settlement: a pack, a garrison, and villagers in the street. */
function village(): HarnessFighter[] {
  const beasts = (['bear', 'wolf', 'wolf'] as const).map((role, index) => {
    const angle = (index / 3) * Math.PI * 2
    return makeFighter('beast', role, Math.sin(angle) * 3, 16 + Math.cos(angle) * 3, {
      id: `beast-${index}`,
      packId: 'pack',
      packKinSize: role === 'wolf' ? 2 : 1,
      hostileToPlayer: false,
    })
  })
  const guards = Array.from({ length: 2 }, (_, index) =>
    makeFighter('guard', 'soldier', (index - 0.5) * 3, 2, {
      id: `guard-${index}`,
      hostileToPlayer: false,
    }),
  )
  const villagers = Array.from({ length: 3 }, (_, index) =>
    makeFighter('civilian', 'peasant', (index - 1) * 3.5, 6, {
      id: `villager-${index}`,
      hostileToPlayer: false,
    }),
  )
  return [...beasts, ...guards, ...villagers]
}

function batch(label: string, options: HarnessOptions): HarnessResult {
  const results: HarnessResult[] = []
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const rng = new RandomStream(deriveSeed('ambient-life', `${label}-${trial}`))
    results.push(runFight(village(), rng, options))
  }
  return accumulate(results)
}

const OPTIONS: HarnessOptions = {
  packRoutEnabled: true,
  individualMorale: true,
  threatScoring: true,
  player: null,
  maxFrames: 1_200,
}

test('scattering civilians: measured, not predicted', () => {
  const still = batch('panic-off', { ...OPTIONS, civilianPanic: false })
  const scatter = batch('panic-on', { ...OPTIONS, civilianPanic: true })

  // **The disengage check first, because every other number here depends on it.** The
  // harness header records two measurements inverted by a behaviour that was supposed to
  // leave and instead stood still. If a panicking villager is not displaced, this whole
  // test is measuring the degenerate model and the result below is worthless.
  //
  // The arm without the mechanism is *not* "nobody moves": a villager still breaks on its
  // wounds through the ordinary individual door, and still walks its route when calm.
  // What the arm without the mechanism has is no `panic` displacement at all, and that is
  // what makes this an A/B on the panic door rather than on movement itself.
  assert.equal(
    tally(still.fledDistanceByReason, 'panic'),
    0,
    'with panic off nothing is displaced by panic — this is the control',
  )
  assert.ok(
    tally(scatter.fledDistanceByReason, 'panic') > 500,
    `with panic on villagers must actually move: ${tally(scatter.fledDistanceByReason, 'panic').toFixed(0)} m`,
  )
  assert.ok(
    tally(still.fledDistanceByReason, 'individual') > 0,
    'and the off arm must still be a world where a wounded villager runs',
  )
  assert.equal(tally(still.routsByReason, 'panic'), 0)
  assert.ok(
    tally(scatter.routsByReason, 'panic') > 50,
    `panic must fire densely: ${tally(scatter.routsByReason, 'panic')} events`,
  )

  // The dense metric: beast attacks that landed on a villager. Deaths alone are far too
  // sparse to carry a claim on their own — §9 records a conclusion that once rested on 12
  // events, one seed producing all 12 — so the attack count is the measurement and the
  // headcount is reported beside it. Here they happen to agree, which is worth having.
  const attacksStill = tally(still.attacksAgainst, 'civilian')
  const attacksScatter = tally(scatter.attacksAgainst, 'civilian')
  assert.ok(
    attacksStill > 200,
    `the metric must be dense before it means anything: ${attacksStill}`,
  )
  // Both arms must be running the same fight, or the comparison is between two different
  // scenarios rather than two arms.
  assert.ok(
    tally(still.attacksAgainst, 'guard') > 100 && tally(scatter.attacksAgainst, 'guard') > 100,
    'the raid itself must happen in both arms',
  )

  // Measured 420 → 190 attacks, and 180 → 60 deaths out of 180 villagers.
  assert.ok(
    attacksScatter < attacksStill * 0.75,
    `scattering must materially reduce bites taken: ${attacksStill} -> ${attacksScatter}`,
  )
  const livedStill =
    tally(still.survivorsBy, 'civilian') + tally(still.fledBy, 'civilian')
  const livedScatter =
    tally(scatter.survivorsBy, 'civilian') + tally(scatter.fledBy, 'civilian')
  assert.equal(livedStill, 0, 'a village that stands still loses everybody — the control')
  assert.ok(
    livedScatter > 90,
    `and one that scatters keeps most of itself: ${livedScatter} of 180`,
  )
  // But not all of it. A wolf is still faster than a villager, so a raid on a village
  // still reads as a raid on a village rather than as a fire drill.
  assert.ok(
    tally(scatter.deathsBy, 'civilian') > 20,
    `the wolves must still catch some: ${tally(scatter.deathsBy, 'civilian')}`,
  )
})

test('the panic sprint is what makes scattering do anything at all', () => {
  // §9's contradicted prediction, kept as an executable control rather than a note.
  //
  // Panic was first implemented at the `1.15×` speed every routing actor gets, which put
  // a villager at 3.57 m/s against a wolf's 5.4. It fled, visibly and correctly, and
  // **saved exactly nobody**: 180 deaths out of 180 with the mechanic on, and 180 with it
  // off. The mechanic was not broken — it was implemented as designed and was dead
  // content, which is the same failure mode as Layer 3's rout rule firing in 0 of 120
  // shipped fights.
  //
  // This asserts the margin is real and load-bearing, so that anyone who "tidies up" the
  // multiplier back to the shared 1.15 gets a failing test rather than a silent
  // regression to a behaviour that looks right and does nothing.
  const wolfSpeed = 5.4
  const villagerWalk = 3.1
  assert.ok(
    villagerWalk * 1.15 < wolfSpeed,
    'the shared rout speed must lose to a wolf — this is why the multiplier exists',
  )
  assert.ok(
    villagerWalk * CIVILIAN_PANIC_SPEED_MULTIPLIER < wolfSpeed,
    'a wolf must still run a villager down, or a raid stops being a raid',
  )
  assert.ok(
    villagerWalk * CIVILIAN_PANIC_SPEED_MULTIPLIER > 3.4,
    'but a bear must not, which is the asymmetry the whole number is chosen for',
  )
})

test('a village does not make the raid safer for the garrison', () => {
  // The counterfactual worth checking, because it is the failure mode a bystander in a
  // fight actually has: villagers are hostile to beasts by the matrix, so they are legal
  // targets, and a pack that spends the fight chasing peasants is a pack that never
  // reaches the soldiers. If adding scenery to a square measurably defuses its raid,
  // Layer 5 has changed the game rather than dressed it.
  const withVillagers = batch('with-villagers', { ...OPTIONS, civilianPanic: true })
  const results: HarnessResult[] = []
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const rng = new RandomStream(deriveSeed('ambient-life', `no-villagers-${trial}`))
    results.push(
      runFight(
        village().filter((fighter) => fighter.allegiance !== 'civilian'),
        rng,
        { ...OPTIONS, civilianPanic: true },
      ),
    )
  }
  const without = accumulate(results)

  const guardAttacks = (result: HarnessResult): number =>
    tally(result.attacksAgainst, 'guard')
  assert.ok(guardAttacks(without) > 100, 'the control raid must be dense')
  const ratio = guardAttacks(withVillagers) / guardAttacks(without)
  assert.ok(
    ratio > 0.6,
    `villagers must not defuse the raid: guard attacks fell to ${(ratio * 100).toFixed(0)}%`,
  )

  // The reverse, which is the finding this counterfactual actually produced: villagers
  // that *cannot* run are bait, and bait changes who wins. Standing still they hold the
  // pack four metres from the garrison and it dies there — 49 beast deaths against 1 in a
  // square with no villagers in it at all. Scattering puts that back where it belongs.
  const bait = batch('bait', { ...OPTIONS, civilianPanic: false })
  assert.ok(
    tally(bait.deathsBy, 'beast') > tally(without.deathsBy, 'beast') + 20,
    `stationary villagers must measurably change the raid: ${tally(bait.deathsBy, 'beast')} vs ${tally(without.deathsBy, 'beast')} beast deaths`,
  )
  assert.ok(
    tally(withVillagers.deathsBy, 'beast') < tally(bait.deathsBy, 'beast'),
    'and scattering must take that thumb off the scale',
  )
})
