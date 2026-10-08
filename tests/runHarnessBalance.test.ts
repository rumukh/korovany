/**
 * W1-5 — the balance instrument, and the baseline it measured.
 *
 * The gameplay review of 2026-10-06 ran 330 harness runs and found `beeline` winning 106 of
 * 120 and `duelist`, which fights everything within 13 m, losing 60 of 60. It also said why
 * those numbers could not guide tuning: the harness had no squad, no healing, and events it
 * counted instead of fought. This file is the instrument with those three added — and the
 * contract/random-event interaction, the road caravan, the generator's own encounters, the
 * finale's director and the engine's walk — each behind its own opt-in arm, each with a
 * control, and the baseline it produces with all of them on.
 *
 * Every arm is defined in `tests/runHarness.ts`, and `tests/runHarnessFidelity.test.ts`
 * holds the copied builder parameters to the shipped `GameEngine`. The pinned numbers in
 * `runHarness.test.ts`, `runHarnessSchedules.test.ts`, `runHarnessSweep.test.ts` and the
 * rest are untouched: with every new arm at its default, a run is the run it always was.
 *
 * ---
 *
 * ## The documented baseline
 *
 * `HARNESS_SHIPPED_ARMS`, 30 Hz, a 600 s limit, seeds `1 + 7919 n` for n = 0…39, every
 * faction under every policy — 360 runs on W3-3 over `main` at 8cd281f, in the
 * engine's streaming window, with the caravan spine, errand press, remnants, held streaming,
 * W3-2 combat economy, managed squad resources, capped HP and tiered composition among the
 * shipped arms — reproduced by
 * `KOROVANY_BALANCE_SEEDS=40 node --experimental-strip-types --test tests/runHarnessBalance.test.ts`
 * (that command uses the committed test's 480 s limit; the table used 600 s through
 * `sweepBalance` directly). Victories are win / defeat / timeout; length is the victories'
 * p10–p50–p90 in seconds. Re-published on 2026-10-08 when W3-3 joined the shipped arms; it
 * supersedes the W3-1 table, W3-4 table, the errand-press table, 191cda5 and 29adca3,
 * which `docs/run-harness.md` keeps for the record.
 *
 * ```text
 * policy · faction    win/def/timeout   won in p10–p50–p90   damage   companions at finale
 * beeline · elf       14 / 26 /  0       88–130–164 s        192      2.8 (37/40 with ≥ 1)
 * beeline · guard     17 / 23 /  0      103–132–191 s        163      3.6 (40/40)
 * beeline · villain   19 / 21 /  0       85–110–165 s        154      3.2 (39/39)
 * cautious · elf      13 / 11 / 16       88–130–164 s        173      2.8 (34/37)
 * cautious · guard    14 / 13 / 13      103–123–229 s        152      3.6 (39/40)
 * cautious · villain  13 / 14 / 13       85–104–157 s        143      3.2 (37/37)
 * duelist · elf       32 /  8 /  0      103–139–209 s        185      3.3 (37/37)
 * duelist · guard     36 /  4 /  0      104–144–201 s        135      3.7 (39/39)
 * duelist · villain   34 /  6 /  0      102–130–174 s        150      3.3 (38/38)
 * ```
 *
 * What it says, in the review's terms:
 *
 * - **F5, inverted.** Fighting everything within 13 m wins 102 of 120 and walking past it
 *   50 of 120. The review's 0 of 60 was a harness with no squad and no healing: every
 *   W1-5 arm off, with the review's `commit` rumours and 1 200 s limit, gives its 88 %
 *   against 0 % again (53/60 against 0/60), and one arm at a time each of the squad and
 *   healing more than halves the fighter's wins when taken away — `docs/run-harness.md`
 *   has the ablation. The spine costs the fighter 14 of its 110 wins, the villain's most.
 * - **F1, answered.** W2-1 made the tier follow the run's progress, so every cell now
 *   reaches three drafts (median), where the clock alone dealt none in seven cells of nine.
 *   W2-2's caravans made the run itself longer: a cell's median win is 104–144 s, against
 *   77–107 s with the spine off, and 264 of 360 runs end inside three minutes (303 with it
 *   off).
 * - **F2, corrected.** All 360 runs reached their contract and started it: 347 kept,
 *   none abandoned. The first baseline's 239 `crowded` abandonments came from the harness
 *   simulating the whole 3x3 where the engine simulates only the plus inside it (W1-6's
 *   finding): the 3x3 kept the actor budget full for 45 s a run. NPCs took 29 carts, each
 *   after a full load, and the squad took none.
 * - **F3, measured.** 420 of 1 226 rumours (34 %) were beyond reach when offered, and 490
 *   of 1 268 (39 %) once W2-1 paced the run by progress. W2-3 then offered only rumours the
 *   player can meet: 67 of 451 (15 %) on the same seeds and arms, every one an escort that
 *   this road-only estimate times to the cart's square rather than to where the player
 *   meets the cart. With the current shipped arms it is 37 of 607 (6 %).
 * - **F4.** At least one companion reached 340 of 347 finales, and every winning finale had
 *   one. Care restores 11–38 companion HP a run by faction; no recovery site is used over twice.
 * - **W3-5.** The 191cda5 table's three beeline guard timeouts, and three of the cautious
 *   guard's, were the harness's errand stand-in waiting out an archer at a healer. Under the
 *   press no run stalls at its errand, and threat-wave damage over the 360 runs falls from
 *   2 181 to 801: 1 488 of it was seed 285085's two stalled guards. `tests/errandPress.test.ts`
 *   and `docs/run-harness.md` have the rest.
 * - **W3-4.** A cautious run spawns 137 encounter bodies against 939 before it, 1.6 times
 *   a beeline or duelist run's (1.3 on the next forty seeds). Its flee-script thrash on a
 *   square's edge is masked by the streaming hold, not fixed; `docs/run-harness.md` has
 *   both seed sets.
 * - **W3-3.** Capped HP alone moves no outcome. Tiered composition moves beeline 51→50,
 *   cautious stays 40 and duelist moves 93→102; no policy rises by more than 9 or falls by
 *   more than 1. The villain duelist moves 27→34.
 *
 * The committed test below sweeps three seeds per cell and asserts bands that held at forty;
 * `KOROVANY_BALANCE_SEEDS` widens it without changing what it asserts.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import type { Faction } from '../src/game/types.ts'
import {
  HARNESS_SHIPPED_ARMS,
  runHarness,
  sweepBalance,
  type BalanceCell,
  type RunOptions,
  type RunReport,
} from './runHarness.ts'

/** Seeds per faction and policy in the committed sweep. */
function balanceSeeds(): number {
  const raw = Number(process.env.KOROVANY_BALANCE_SEEDS)
  return Number.isInteger(raw) && raw > 0 ? raw : 3
}

const FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']

function pooled(cells: readonly BalanceCell[], pick: (cell: BalanceCell) => number): number {
  return cells.reduce((sum, cell) => sum + pick(cell), 0)
}

// ---------------------------------------------------------------------------
// 1. The baseline
// ---------------------------------------------------------------------------

test('the shipped baseline: three factions, three policies, inside the measured bands', () => {
  assert.equal(HARNESS_SHIPPED_ARMS.squadResource, 'managed')
  const seeds = balanceSeeds()
  const report = sweepBalance({ seeds, timeLimit: 480 })
  assert.equal(report.cells.length, 9)
  for (const cell of report.cells) {
    assert.equal(cell.runs, seeds)
    assert.equal(cell.outcomes.victory + cell.outcomes.defeat + cell.outcomes.timeout, seeds)
    // Every cell meets the generator's own encounters on the road.
    assert.ok((cell.damageBySystem.encounter ?? 0) > 0, `${cell.policy}/${cell.faction} met no encounter`)
    assert.ok(cell.meanDamageTaken > 20, `${cell.policy}/${cell.faction} took ${cell.meanDamageTaken}`)
  }
  const byPolicy = (policy: string) => report.cells.filter((cell) => cell.policy === policy)
  const wins = (policy: string) => pooled(byPolicy(policy), (cell) => cell.outcomes.victory)
  const runs = (policy: string) => pooled(byPolicy(policy), (cell) => cell.runs)

  // The review's finding, inverted. With no squad and no healing, fighting everything lost
  // every run; with the starters beside them and a ration in the bag, the player who stops
  // to fight wins more often than the one who walks past. The bands are wide on purpose —
  // this is a fact about the design, not a target.
  const beeline = wins('beeline') / runs('beeline')
  const duelist = wins('duelist') / runs('duelist')
  assert.ok(duelist >= 0.5, `duelist won ${duelist}`)
  assert.ok(beeline >= 0.1 && beeline <= 0.9, `beeline won ${beeline}`)
  assert.ok(duelist >= beeline, `duelist ${duelist} should win at least as often as beeline ${beeline}`)

  // Runs are short: a winning run is still the review's two-to-three-minute errand (F1).
  // W2-1 fixed F1's other half: the tier now follows the run's progress as well as the
  // clock, so the errand and the contract arm deal the first two drafts on the way to the
  // finale. Enemy health and damage stay on the clock, which is why the win bands above
  // did not have to move.
  for (const cell of [...byPolicy('beeline'), ...byPolicy('duelist')]) {
    if (cell.outcomes.victory === 0) continue
    assert.ok(
      cell.victoryLength.p50 >= 45 && cell.victoryLength.p50 <= 240,
      `${cell.policy}/${cell.faction} median win ${cell.victoryLength.p50}`,
    )
    assert.ok(cell.draftsReached.median >= 2, `${cell.policy}/${cell.faction} drafts`)
  }

  // Both ends of a run kill: the road's encounters and the finale's director.
  const deaths: Record<string, number> = {}
  for (const cell of report.cells) {
    for (const [system, count] of Object.entries(cell.deathSystems)) {
      deaths[system] = (deaths[system] ?? 0) + count
    }
  }
  assert.ok((deaths.encounter ?? 0) + (deaths.finale ?? 0) > 0, JSON.stringify(deaths))

  // The squad mostly reaches the finale (F4's "≥ 1 in most runs" target, as it stands).
  const opened = pooled(report.cells, (cell) => cell.companionsAtFinale.opened)
  const withOne = pooled(report.cells, (cell) => cell.companionsAtFinale.atLeastOne)
  assert.ok(opened > 0 && withOne / opened >= 0.6, `${withOne}/${opened} finales with a companion`)
  for (const cell of report.cells) {
    assert.ok(
      cell.squadResource.recoveryUses <= cell.runs * 2,
      `${cell.policy}/${cell.faction} used recovery ${cell.squadResource.recoveryUses} times`,
    )
  }
  for (const faction of FACTIONS) {
    const cells = report.cells.filter((cell) => cell.faction === faction)
    const replacements = cells.reduce((sum, cell) =>
      sum + Object.values(cell.squadResource.replacementsBySource)
        .reduce((subtotal, count) => subtotal + count, 0), 0)
    const factionRuns = pooled(cells, (cell) => cell.runs)
    assert.ok(
      replacements <= factionRuns * 1.5,
      `${faction} recruited ${replacements} in ${factionRuns} runs`,
    )
  }

  // Contracts start where the player arrives (F2, corrected). In the engine's window the
  // actor budget has room for the builder, so the 40-seed baseline started every contract
  // it reached and abandoned none. The 3x3 window refused two in three as `crowded`.
  const started = pooled(report.cells, (cell) => cell.contracts.started)
  const abandoned = pooled(report.cells, (cell) => cell.contracts.abandoned)
  const totalRuns = pooled(report.cells, (cell) => cell.runs)
  assert.ok(started >= totalRuns * 0.8, `${started} contracts started in ${totalRuns} runs`)
  assert.ok(abandoned * 10 <= started, `abandoned ${abandoned}, started ${started}`)
  const named = pooled(report.cells, (cell) =>
    Object.values(cell.contracts.abandonedBy).reduce((sum, count) => sum + count, 0),
  )
  assert.equal(named, abandoned, 'every abandoned contract has a refusal reason')
  // The road is the engine's: the budget never had to turn an encounter body away.
  for (const cell of report.cells) {
    assert.ok(
      cell.encounters.meanOnField > 0 && cell.encounters.meanRefusedSeconds < 1,
      `${cell.policy}/${cell.faction}: ${JSON.stringify(cell.encounters)}`,
    )
  }

  // W1-2: nobody takes a cart by touching it, and the squad never loads one. The rule is held
  // to the engine's own methods by `runHarnessFidelity.test.ts`; here it holds over whole
  // runs — every cart lost to an NPC went through a loading channel first.
  assert.equal(pooled(report.cells, (cell) => cell.caravans.robbedBySquad), 0, 'a companion loaded a cart')
  const lostToNpcs = pooled(report.cells, (cell) => cell.caravans.robberiesLostToNpcs)
  const loads = pooled(report.cells, (cell) => cell.caravans.lootsStarted)
  assert.ok(lostToNpcs <= loads, `${lostToNpcs} carts lost to NPCs after only ${loads} loads`)

  // Rumours: offered, and only rarely beyond reach (F3). Before W2-3 over a third of the
  // offers could not be met when they were made (490 of 1 268 at forty seeds, 23 of 90
  // here); W2-3 offers only what the player can meet, and this independent road-only
  // estimate still calls a few escorts late (67 of 451, 3 of 48 here) because it times the
  // walk to the cart's square now rather than to the square the player meets it in. With
  // W2-2's caravan spine in the shipped arms it is 67 of 617 at forty seeds, 3 of 40 here.
  const offered = pooled(report.cells, (cell) => cell.rumours.offered)
  const beyond = pooled(report.cells, (cell) => cell.rumours.beyondReach)
  assert.ok(offered > 0)
  assert.ok(beyond * 5 < offered, `${beyond} of ${offered} rumours beyond reach`)
})

// ---------------------------------------------------------------------------
// 2. Each arm against its control
// ---------------------------------------------------------------------------

const ARM_SEEDS = [1, 7920]

function sample(overrides: Partial<RunOptions>, policy: RunOptions['policy'] = 'duelist'): RunReport[] {
  const reports: RunReport[] = []
  for (const seed of ARM_SEEDS) {
    for (const faction of FACTIONS) {
      reports.push(
        runHarness({ ...HARNESS_SHIPPED_ARMS, ...overrides, seed, faction, policy, hz: 30, timeLimit: 240 }),
      )
    }
  }
  return reports
}

const total = (reports: readonly RunReport[], pick: (report: RunReport) => number): number =>
  reports.reduce((sum, report) => sum + pick(report), 0)

test('the squad arm: the starters fight, the decoy placebo does not, and off is nobody', () => {
  const starting = sample({ squad: 'starting' })
  const decoy = sample({ squad: 'decoy' })
  const off = sample({ squad: 'off' })
  for (const report of [...starting, ...decoy]) {
    assert.equal(report.balance.companions.started, 3, `${report.faction} fielded its three starters`)
  }
  assert.ok(total(starting, (report) => report.balance.companions.damageDealt) > 0)
  assert.ok(total(starting, (report) => report.balance.companions.kills) > 0)
  // The negative control: the same three bodies, in the same formation, strike nothing.
  assert.equal(total(decoy, (report) => report.balance.companions.damageDealt), 0)
  assert.equal(total(decoy, (report) => report.balance.companions.kills), 0)
  assert.ok(total(decoy, (report) => report.balance.companions.damageTaken) > 0, 'the decoys are still struck')
  for (const report of off) {
    assert.equal(report.balance.companions.started, 0)
    assert.equal(report.balance.companions.aliveAtEnd, 0)
  }
})

test('the sustain arm: wounds bleed, the healer heals, and its placebo heals nothing', () => {
  const shipped = sample({ sustain: 'shipped' }, 'beeline')
  const visit = sample({ sustain: 'visit' }, 'beeline')
  const off = sample({ sustain: 'off' }, 'beeline')
  assert.ok(total(shipped, (report) => report.balance.sustain.healed) > 0)
  assert.ok(total(shipped, (report) => report.balance.sustain.goldEarned) > 0)
  assert.ok(total(shipped, (report) => report.balance.sustain.rationsEaten) > 0)
  // The placebo eats the same ration and visits on the same triggers, and restores nothing.
  assert.equal(total(visit, (report) => report.balance.sustain.healed), 0)
  assert.ok(total(visit, (report) => report.balance.sustain.healingWithheld) > 0)
  assert.ok(total(visit, (report) => report.balance.sustain.rationsEaten) > 0)
  for (const report of off) {
    assert.equal(report.balance.sustain.healed, 0)
    assert.equal(report.balance.sustain.goldEarned, 0)
    assert.equal(report.balance.sustain.injuries, 0)
    assert.equal(report.damageTaken.bleeding, 0, 'no wound, no bleed, as the pinned runs')
  }
  // Wounds are real in both body arms: the combat stream rolls `shouldInjurePlayer`.
  assert.ok(
    total([...shipped, ...visit], (report) => report.balance.sustain.injuries) > 0,
    'no injury in twelve runs means the wound roll is not wired',
  )
})

test('W3-2 applies honest fast-tell latency and measurable stamina pressure', () => {
  const shipped = sample({})
  const legacy = sample({ combatEconomy: 'legacy', meleeDefence: 'heavy' })
  const eager = sample({ tellReactionLatency: 0.20 })
  const slow = sample({ tellReactionLatency: 0.30 })
  const legacyEager = sample({
    combatEconomy: 'legacy',
    meleeDefence: 'heavy',
    tellReactionLatency: 0.20,
  })
  const fastRoles = ['scout', 'minion', 'wolf', 'boar', 'bear', 'troll']
  const fastAttempts = (reports: readonly RunReport[]) =>
    total(reports, (report) =>
      fastRoles.reduce(
        (sum, role) => sum + (report.melee.windupClearAttempts[role] ?? 0),
        0,
      ),
    )
  assert.ok(shipped.every((report) => report.combatEconomy === 'shipped'))
  assert.ok(legacy.every((report) => report.combatEconomy === 'legacy'))
  assert.equal(fastAttempts(shipped), 0, '0.25 s reacted to a 0.18–0.26 s tell')
  assert.ok(fastAttempts(eager) > 0, 'the 0.20 s sensitivity arm answered no clearable tell')
  assert.equal(fastAttempts(slow), 0, 'the 0.30 s sensitivity arm reacted before contact')
  assert.equal(fastAttempts(legacyEager), 0, 'the legacy arm read a tell it does not draw')
  assert.ok(
    total(shipped, (report) => report.melee.staminaStarvedMoments) >
      total(legacy, (report) => report.melee.staminaStarvedMoments),
    'the offensive regeneration delay created no measurable stamina pressure',
  )
  assert.ok(
    shipped.some((report) => report.melee.staminaStarvedRate > 0),
    'the shipped reports hid every starved finisher',
  )
})

test('events are fought: the director and the chronicle put bodies down, the counted model none', () => {
  const fought = sample({ eventModel: 'fought' })
  const counted = sample({ eventModel: 'counted' })
  const started = (reports: readonly RunReport[]) =>
    total(reports, (report) =>
      Object.values(report.balance.events.randomStarted).reduce((sum, count) => sum + count, 0),
    )
  const located = (reports: readonly RunReport[]) =>
    total(reports, (report) =>
      Object.values(report.balance.events.locatedMaterialized).reduce((sum, count) => sum + count, 0),
    )
  assert.ok(started(fought) > 0, 'the director started nothing')
  assert.ok(located(fought) > 0, 'no chronicle situation materialized as a fight')
  assert.ok(
    total(fought, (report) =>
      (report.balance.damageBySystem.randomEvent ?? 0) +
      (report.balance.damageBySystem.locatedEvent ?? 0) +
      (report.balance.damageBySystem.contractEvent ?? 0) +
      (report.balance.damageBySystem.caravan ?? 0),
    ) > 0,
    'the events never laid a hand on the player',
  )
  // The control: counted, as the pinned runs are — not one event body on the field.
  assert.equal(started(counted), 0)
  assert.equal(located(counted), 0)
  for (const report of counted) {
    for (const system of ['randomEvent', 'locatedEvent', 'contractEvent', 'threatWave', 'caravan', 'ambush']) {
      assert.equal(report.balance.damageBySystem[system] ?? 0, 0, `${system} in a counted run`)
    }
  }
})

test('W1-1 in whole runs: a random event up at arrival stands down, and the contract starts', () => {
  // Seed 95029, the elf walking to its signature contract with a champion event still up.
  // Before W1-1 that refused the start until the 12 s grace ran out and the contract failed
  // forward ("так и не собрался"); the engine now stands the event down — no payout, no
  // failure — and starts the contract. The control holds the director still and changes
  // nothing else: no event to stand down, the same contract kept.
  const options = { ...HARNESS_SHIPPED_ARMS, seed: 95029, faction: 'elf', policy: 'beeline', hz: 30, timeLimit: 300 } as const
  const shipped = runHarness(options)
  const silent = runHarness({ ...options, eventDirector: 'silent' })
  assert.equal(shipped.balance.events.randomStoodDown, 1, 'no random event was up at the arrival')
  assert.equal(shipped.balance.contracts.lostToEvents, 0)
  assert.equal(shipped.balance.contracts.abandoned, 0)
  assert.equal(shipped.balance.contracts.started, 1)
  assert.equal(shipped.balance.contracts.kept, 1)
  assert.equal(silent.balance.events.randomStoodDown, 0)
  assert.equal(silent.balance.contracts.started, 1)
  assert.equal(silent.balance.contracts.kept, 1)
})

test('W1-2 in whole runs: a cart is lost to an NPC only after a load, and never to the squad', () => {
  // Under `engage`, the elf on seed 118786 and the guard on seed 126705 each reach a chronicle
  // ambush whose raiders load their cart. In the baseline's `ignore` arm no NPC ever starts a
  // load, so these are the runs that show the channel working end to end. The pre-W1-2
  // touch rule would lose a cart without a load (`lost > loads`), and the old squad rule
  // would show up in `robbedBySquad`.
  //
  // Were 31677 and 182138 until W2-1, re-picked by the same rule — the first seed in the
  // stride on which each faction's raiders start a load. W2-1 moved what the shipped arms
  // run into: the tier on the HUD now follows progress, so events, waves and drafts come
  // sooner, and the night moved, so the chronicle's carts meet different ground.
  //
  // W2-2 re-picked the guard's by the same rule. On 47515 the guard now defends an ambush of
  // its own side's cart instead of robbing it, the run takes another course, and no raider
  // starts a load; the guard's first such seed was then 79191, and the elf kept 7920.
  //
  // W2-2's caravan spine then joined the shipped arms, and both were re-picked by the same
  // rule. Every run now starts at one of the camp's caravans and waits for two before the
  // finale, so it reaches the chronicle's ambushes later and elsewhere: no raider starts a
  // load on 7920 or 79191 any more. The first such seeds are 118786 for the elf (n = 15, 3
  // loads, 1 cart lost) and 1 for the guard (n = 0, 1 load, 1 lost).
  //
  // W3-5's errand press was checked against the same rule and moves neither: both seeds still
  // start a load under it, with the same loads and losses.
  //
  // W3-4 was checked against it too. Its remnants move neither seed. Its streaming hold moves
  // the guard's: the window no longer recentres on every step back over an edge, the run meets
  // its packs and ambushes at other moments, and on seed 1 no raider starts a load. Re-picked
  // by the same rule: 126705 (n = 16, 1 load, 1 lost). The elf keeps 118786 (3 loads, 1 lost).
  //
  // W3-2's matched contact shapes change that road again. Re-picked by the same first-in-stride
  // rule, seed 1 starts one load for each side; the guard loses its cart and the elf does not.
  //
  // W3-3's tiered composition moves the guard's ambush. Seed 1 remains the elf's first load;
  // the guard's first is 55434 (n = 7), one load and one lost cart.
  const reports = ([
    [1, 'elf'],
    [55434, 'guard'],
  ] as const).map(([seed, faction]) =>
    runHarness({
      ...HARNESS_SHIPPED_ARMS,
      squadResource: 'legacy',
      eventPolicy: 'engage',
      seed,
      faction,
      policy: 'duelist',
      hz: 30,
      timeLimit: 600,
    }),
  )
  const loads = total(reports, (report) => report.balance.caravans.lootsStarted)
  const lost = total(reports, (report) => report.balance.caravans.robberiesLostToNpcs)
  assert.ok(loads >= 2, `${loads} loads: the channel never ran in a whole run`)
  assert.ok(lost >= 1 && lost <= loads, `${lost} carts lost to NPCs after ${loads} loads`)
  for (const report of reports) assert.equal(report.balance.caravans.robbedBySquad, 0)
})

test('the window arm: the shipped arms simulate the engine\'s plus, and the 3x3 is the control', () => {
  // The same seeds and factions, once in the engine's window and once in the pinned 3x3.
  // Over a whole run the two meet much the same encounters; what differs is how many stand
  // on the road at once, and whether the budget has to turn bodies away to hold them.
  const plus = sample({})
  const square = sample({ regionWindow: 'square' })
  for (const report of plus) assert.equal(report.regionWindow, 'engine')
  for (const report of square) assert.equal(report.regionWindow, 'square')
  const crowd = (reports: readonly RunReport[]) =>
    total(reports, (report) => report.balance.encounters.meanOnField) / reports.length
  const refused = (reports: readonly RunReport[]) =>
    total(reports, (report) => report.balance.encounters.refusedSeconds)
  assert.ok(crowd(plus) > 0, 'the plus fielded nobody')
  assert.ok(crowd(plus) < crowd(square), `${crowd(plus)} bodies on the road in the plus, ${crowd(square)} in the 3x3`)
  assert.ok(refused(plus) < refused(square), `refused ${refused(plus)} s in the plus, ${refused(square)} s in the 3x3`)
})

test('W1-6 in whole runs: the guard\'s own garrisons call for men only in a fight', () => {
  // Seed 1: the guard's road to «Домики жгут» in D2 runs past the palace's strongholds in E2
  // and E4, whose friendly commanders called a soldier under the old rule while nobody
  // fought. The shipped rule calls nobody there, and the contract is the same contract. The
  // `inert` commander, a body and a swing, is what every pinned number was measured with.
  //
  // Was 95029, the reported repro, until W2-2's caravan spine joined the shipped arms. The
  // guard now first walks to one of the camp's caravans, passes the strongholds at another
  // moment, and the old rule called nobody on that run. Re-picked as the first seed in the
  // stride on which the old rule calls a soldier and the shipped and inert rules call none,
  // with the contract started in all three: seed 1 (n = 0). The engine-level repro of 95029
  // stays in `tests/commanderReinforcements.test.ts`.
  const options = {
    ...HARNESS_SHIPPED_ARMS,
    squadResource: 'legacy',
    seed: 1,
    faction: 'guard',
    policy: 'beeline',
    hz: 30,
    timeLimit: 300,
  } as const
  const shipped = runHarness(options)
  const legacy = runHarness({ ...options, commanders: 'legacy' })
  const inert = runHarness({ ...options, commanders: 'inert' })
  assert.equal(shipped.commanders, 'shipped')
  assert.equal(shipped.balance.encounters.reinforcementsCalled, 0, 'an idle garrison called a soldier')
  assert.ok(legacy.balance.encounters.reinforcementsCalled >= 1, 'the old rule called nobody: the arm is not wired')
  assert.equal(inert.balance.encounters.reinforcementsCalled, 0)
  for (const report of [shipped, legacy, inert]) {
    assert.equal(report.balance.contracts.started, 1)
    assert.equal(report.balance.contracts.abandoned, 0)
  }
})

test('W1-6 in whole runs: the guard\'s own idle soldiers step back for a contract, and come home', () => {
  // Seed 1, the contrary arm: the guard takes «Зверьё у домиков» beside the elf's and the
  // villain's strongholds, and eighteen of the palace's own soldiers fill the window. With
  // nobody stepping back the beast raid finds four of the five slots it needs and is
  // abandoned as `crowded`. The shipped staging asks the farthest pack out of sight to step
  // back, and it comes home once the room is free and nobody would see it come.
  const options = {
    ...HARNESS_SHIPPED_ARMS,
    squadResource: 'legacy',
    seed: 1,
    faction: 'guard',
    policy: 'beeline',
    contractPolicy: 'contrary',
    hz: 30,
    timeLimit: 300,
  } as const
  const shipped = runHarness(options)
  const none = runHarness({ ...options, staging: 'none' })
  assert.equal(shipped.staging, 'friendly')
  assert.equal(shipped.balance.contracts.started, 1)
  assert.equal(shipped.balance.contracts.abandoned, 0)
  assert.equal(shipped.balance.encounters.packsSteppedBack, 1)
  assert.equal(shipped.balance.encounters.packsReturned, 1)
  assert.equal(none.staging, 'none')
  assert.equal(none.balance.contracts.started, 0)
  assert.deepEqual(none.balance.contracts.abandonedBy, { crowded: 1 })
  assert.equal(none.balance.encounters.packsSteppedBack, 0)
})

test('the arms leave the pinned run alone, and the shipped kit walks the engine\'s road', () => {
  const base = { seed: 424242, faction: 'elf', policy: 'beeline', hz: 60, timeLimit: 40 } as const
  const omitted = runHarness(base)
  const explicit = runHarness({
    ...base,
    squad: 'off',
    sustain: 'off',
    eventModel: 'counted',
    eventPolicy: 'ignore',
    eventDirector: 'shipped',
    playerKit: 'harness',
    encounterModel: 'harness',
    regionWindow: 'square',
    commanders: 'inert',
    staging: 'none',
    errand: 'clear',
    combatEconomy: 'legacy',
    encounterMemory: 'fresh',
    streaming: 'instant',
  })
  assert.deepEqual(explicit, omitted, 'the declared defaults must be the defaults')
  assert.equal(omitted.balance.companions.started, 0)
  assert.equal(omitted.balance.sustain.goldEarned, 0)
  assert.deepEqual(omitted.balance.events.randomStarted, {})
  // The pinned report completes the start objective on the frame it loads, because this
  // file's kit spawns on the start site. The engine spawns twenty metres back along the
  // critical path, so the shipped kit has to walk there first.
  assert.ok((omitted.objectives[0].completedAt ?? 0) < 0.05)
  const shippedKit = runHarness({ ...base, playerKit: 'shipped' })
  assert.ok((shippedKit.objectives[0].completedAt ?? 0) > 1, 'the shipped kit spawned on the site')
})

test('the balance sweep is deterministic', () => {
  const options = { seeds: 1, timeLimit: 120, policies: ['beeline'] as const, factions: ['villain'] as const }
  assert.deepEqual(sweepBalance(options), sweepBalance(options))
})
