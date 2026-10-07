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
 * faction under every policy — 360 runs on `main` at 29adca3, in the engine's streaming
 * window — reproduced by
 * `KOROVANY_BALANCE_SEEDS=40 node --experimental-strip-types --test tests/runHarnessBalance.test.ts`
 * (that command uses the committed test's 480 s limit; the table used 600 s through
 * `sweepBalance` directly). Victories are win / defeat / timeout; length is the victories'
 * p10–p50–p90 in seconds.
 *
 * ```text
 * policy · faction    win/def/timeout   won in p10–p50–p90   damage   companions at finale
 * beeline · elf       14 / 26 /  0      63– 88–149 s         139      3.1 (35/37 with ≥ 1)
 * beeline · guard     14 / 24 /  2      76– 87–107 s         318      2.8 (36/37)
 * beeline · villain   23 / 17 /  0      68– 89–108 s         120      2.9 (40/40)
 * cautious · elf      12 / 14 / 14      63– 87–111 s         128      3.0 (37/39)
 * cautious · guard    10 / 16 / 14      71– 86–107 s         310      2.7 (36/38)
 * cautious · villain  19 / 11 / 10      68– 83–107 s         111      2.9 (40/40)
 * duelist · elf       35 /  5 /  0      78– 96–133 s         118      3.5 (40/40)
 * duelist · guard     36 /  4 /  0      80–107–136 s         119      2.9 (39/40)
 * duelist · villain   38 /  2 /  0      75– 94–144 s         111      3.0 (40/40)
 * ```
 *
 * What it says, in the review's terms:
 *
 * - **F5, inverted.** Fighting everything within 13 m now wins 109 of 120 and walking past
 *   it 51 of 120. The review's 0 of 60 was a harness with no squad and no healing: every
 *   W1-5 arm off, with the review's `commit` rumours and 1 200 s limit, gives its 88 %
 *   against 0 % again (53/60 against 0/60), and one arm at a time each of the squad and
 *   healing more than halves the fighter's wins when taken away — `docs/run-harness.md`
 *   has the ablation.
 * - **F1, unchanged.** 302 of 360 runs end inside three minutes and the median doctrine
 *   drafts reached is zero in every cell but cautious elf and guard, where a third of the
 *   runs stall to the time limit. **W2-1 has since fixed the drafts half:** the tier follows
 *   the run's progress as well as the clock, so the same runs reach two drafts, while enemy
 *   stats stay on the clock and the win counts stay within noise. The table above is the
 *   clock-only rule (`escalation: 'time'`); `tests/runHarnessEscalation.test.ts` holds the
 *   comparison.
 * - **F2, corrected.** Every run reached its contract and started it: 360 started, 346
 *   kept, none abandoned. The first baseline's 239 `crowded` abandonments came from the
 *   harness simulating the whole 3x3 where the engine simulates only the plus inside it
 *   (W1-6's finding): the 3x3 kept the actor budget full for 45 s a run. NPCs took 12
 *   carts, each after a full load, and the squad took none.
 * - **F3, measured.** 420 of 1 226 rumours (34 %) were beyond reach when offered.
 * - **F4.** At least one companion reached 343 of 351 finales; the finale is still the
 *   single largest killer (54 of 119 defeats).
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

  // Rumours: offered, and a measurable share of them unreachable in time (F3).
  const offered = pooled(report.cells, (cell) => cell.rumours.offered)
  const beyond = pooled(report.cells, (cell) => cell.rumours.beyondReach)
  assert.ok(offered > 0)
  assert.ok(beyond > 0 && beyond < offered, `${beyond} of ${offered} rumours beyond reach`)
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
  // Under `engage`, the elf on seed 7920 and the guard on seed 47515 each reach a chronicle
  // ambush whose raiders load their cart. In the baseline's `ignore` arm no NPC ever starts a
  // load, so these are the runs that show the channel working end to end. The pre-W1-2
  // touch rule would lose a cart without a load (`lost > loads`), and the old squad rule
  // would show up in `robbedBySquad`.
  //
  // Were 31677 and 182138 until W2-1, re-picked by the same rule — the first seed in the
  // stride on which each faction's raiders start a load. W2-1 moved what the shipped arms
  // run into: the tier on the HUD now follows progress, so events, waves and drafts come
  // sooner, and the night moved, so the chronicle's carts meet different ground.
  const reports = ([
    [7920, 'elf'],
    [47515, 'guard'],
  ] as const).map(([seed, faction]) =>
    runHarness({
      ...HARNESS_SHIPPED_ARMS,
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
