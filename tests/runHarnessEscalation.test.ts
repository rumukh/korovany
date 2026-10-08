/**
 * W2-1 — progress-anchored escalation, measured in whole runs.
 *
 * `tests/escalation.test.ts` pins the rules on the engine's own methods. This file holds
 * them over whole runs of the W1-5 instrument, with the shipped arms on, against matched
 * controls on the same seeds:
 *
 * - `time` is the rule before W2-1, the clock alone: the control the drafts are measured
 *   against.
 * - `progress` is the shipped rule: the pacing tier follows progress too, enemy health and
 *   damage stay on the clock.
 * - `progressAll` is the rejected design: progress scales enemy stats as well. It is the
 *   negative control for "the earned tier leaves enemy stats alone".
 *
 * ---
 *
 * ## The measurement (shipped arms, engine window, 30 Hz, 600 s, seeds `1 + 7919 n`, n = 0…39)
 *
 * ```text
 * policy · faction    time (control)       progress (shipped)    progressAll (rejected)
 *                     wins   drafts/win    wins   drafts/win     wins
 * beeline · elf       14/40     0          11/40     2           3/40
 * beeline · guard     14/40     0          16/40     2           9/40
 * beeline · villain   23/40     0          21/40     2          19/40
 * cautious · elf      12/40     0          10/40     2           4/40
 * cautious · guard    10/40     0          12/40     2           5/40
 * cautious · villain  18/40     0          17/40     2          13/40
 * duelist · elf       35/40     0          36/40     2          26/40
 * duelist · guard     36/40     0          36/40     2          24/40
 * duelist · villain   38/40     0          37/40     2          24/40
 * ```
 *
 * Under `progress`, 194 of 196 wins opened two drafts or more before the end, the finale was
 * fought at pacing tier 3 with its boss scaled at the clock's tier 1, and the median win
 * length moved by ten percent or less. Without a card taken and with the director silent, a
 * `progress` run is the `time` run to the frame; `progressAll` is not.
 *
 * Measured before W2-2's caravan spine joined the shipped arms. The tests below hold with it,
 * on the same seeds: its caravans add steps of progress, so the finale is now fought at
 * pacing tier 4 and every cell reaches three drafts (`docs/run-harness.md`, Baseline).
 *
 * The calm gate's 30 s ceiling (`DOCTRINE_DRAFT_MAX_HOLD_SECONDS`) changed four of the 360
 * `progress` runs, and no win: the stuck guard timeouts on seeds 79191 and 142543 under the
 * beeline and cautious scripts, whose third and fourth drafts the gate alone never opened.
 *
 * Everything above was measured before W3-5, with the errand stand-in (`errand: 'clear'`).
 * W3-5 found that those four timeouts were that stand-in waiting out an archer the engine's
 * `E` would have ignored. Under the shipped arms' press each of them finishes its errand on
 * arrival.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { DOCTRINE_DRAFT_MAX_HOLD_SECONDS } from '../src/game/run/doctrine.ts'
import type { Faction } from '../src/game/types.ts'
import {
  HARNESS_SHIPPED_ARMS,
  runHarness,
  type Escalation,
  type InputPolicy,
  type RunOptions,
  type RunReport,
} from './runHarness.ts'

const SEEDS = [1, 7920, 15839]
const FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']

function sweep(
  escalation: Escalation,
  policy: InputPolicy,
  extra: Partial<RunOptions> = {},
  timeLimit = 480,
): RunReport[] {
  const reports: RunReport[] = []
  for (const faction of FACTIONS) {
    for (const seed of SEEDS) {
      reports.push(runHarness({
        ...HARNESS_SHIPPED_ARMS,
        ...extra,
        escalation,
        seed,
        faction,
        policy,
        hz: 30,
        timeLimit,
      }))
    }
  }
  return reports
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

test('drafts follow progress: winning runs open two, where the clock alone opened none', () => {
  const progress = [...sweep('progress', 'beeline'), ...sweep('progress', 'duelist')]
  const time = [...sweep('time', 'beeline'), ...sweep('time', 'duelist')]
  const wins = progress.filter((report) => report.outcome === 'victory')
  assert.ok(wins.length >= 6, `only ${wins.length} winning runs to read`)

  const drafts = wins.map((report) => report.balance.draftsOpenedAt.length)
  assert.ok(median(drafts) >= 2, `median drafts per win ${median(drafts)}`)
  assert.ok(
    drafts.filter((count) => count >= 2).length >= wins.length * 0.8,
    `${drafts.filter((count) => count >= 2).length} of ${wins.length} wins opened two drafts`,
  )
  // Every draft opened on or after the rise that dealt it: the calm gate only ever delays.
  for (const report of wins) {
    report.balance.draftsOpenedAt.forEach((at, index) => {
      const rise = report.balance.tierRises[index]
      assert.ok(rise && at >= rise.at, `${report.faction}/${report.seed}: a draft before its tier`)
    })
  }
  // And at a calm moment: the ceiling on the wait is for fights that never end, not for these.
  assert.ok(wins.every((report) => report.balance.draftsForced === 0), 'a win needed the ceiling')

  // Control: the same seeds on the clock alone. The metric can tell the two rules apart.
  const timeWins = time.filter((report) => report.outcome === 'victory')
  assert.equal(median(timeWins.map((report) => report.balance.draftsOpenedAt.length)), 0)
  assert.ok(timeWins.every((report) => report.balance.tierRises.every((rise) => rise.cause === 'time')))
})

test('a fight that never ends cannot starve a draft: the ceiling opens it 30 s after its tier', () => {
  // Guard seed 142543 under the beeline script is pinned in a fight from the clock's third
  // tier to the 600 s timeout. The calm gate alone held its third and fourth drafts for the
  // rest of the run; the ceiling opens each `DOCTRINE_DRAFT_MAX_HOLD_SECONDS` after its tier.
  //
  // W3-5: the fight was the harness's own. Its errand stand-in waited for an archer to leave
  // the healer the errand sits on, and the engine's `E` finishes that errand when the guard
  // reaches it, at 87 s. The shipped arms now press it (`errand: 'press'`). The stand-in, kept
  // as the control arm, is still the deterministic fight that never ends that this rule needs.
  const stuckRun: RunOptions = {
    ...HARNESS_SHIPPED_ARMS,
    squadResource: 'legacy',
    // Isolate W2-1's draft ceiling from later W3-2 combat routing.
    combatEconomy: 'legacy',
    errand: 'clear',
    seed: 142543,
    faction: 'guard',
    policy: 'beeline',
    hz: 30,
    timeLimit: 600,
  }
  const stuck = runHarness(stuckRun)
  assert.equal(stuck.outcome, 'timeout')
  assert.equal(stuck.balance.draftsOpenedAt.length, 3)
  assert.equal(stuck.balance.draftsForced, 2, 'the ceiling did not open the starved drafts')
  const clockRises = stuck.balance.tierRises.filter((rise) => rise.cause === 'time')
  assert.equal(clockRises.length, 2)
  for (const rise of clockRises) {
    const waited = (stuck.balance.draftsOpenedAt.find((at) => at >= rise.at) ?? Infinity) - rise.at
    assert.ok(
      waited >= DOCTRINE_DRAFT_MAX_HOLD_SECONDS && waited < DOCTRINE_DRAFT_MAX_HOLD_SECONDS + 1,
      `tier ${rise.tier}: the draft waited ${waited} s`,
    )
  }

  // Control: the same run on the clock alone has no gate, so the same three drafts open on
  // their tiers' frames and none counts as forced. The count is the ceiling's, not lateness.
  const clock = runHarness({ ...stuckRun, escalation: 'time' })
  assert.equal(clock.balance.draftsOpenedAt.length, 3)
  assert.equal(clock.balance.draftsForced, 0)
})

test('the finale is paced by the earned tier and scaled by the clock', () => {
  const progress = sweep('progress', 'duelist')
  const finales = progress.filter((report) => report.balance.finaleTier !== null)
  assert.ok(finales.length >= 6, `only ${finales.length} finales opened`)
  for (const report of finales) {
    assert.ok(
      (report.balance.finaleScalingTier ?? 0) <= (report.balance.finaleTier ?? 0),
      `${report.faction}/${report.seed}: scaled above its pacing tier`,
    )
  }
  // Non-vacuity: the split actually happens — finales fought at an earned tier above the clock.
  assert.ok(
    finales.some((report) => (report.balance.finaleTier ?? 0) > (report.balance.finaleScalingTier ?? 0)),
    'no finale was fought at an earned tier, so this test proves nothing',
  )
})

test('enemy stats ignore progress when W3-3 composition is held at its legacy control', () => {
  // Under 230 s nothing paced by the tier is left: no random events (silent director), no
  // card (`none`) and no threat wave (they start at 240 s). W3-3 deliberately spends the
  // pacing tier on composition, so its legacy role arm is held still here. Enemy stats are
  // then the one thing an earned tier could still have touched, and they must not have.
  const extra: Partial<RunOptions> = {
    doctrinePolicy: 'none',
    eventDirector: 'silent',
    encounterComposition: 'legacy',
    encounterHealth: 'legacy',
  }
  const fingerprint = (report: RunReport) => ({
    outcome: report.outcome,
    elapsed: report.elapsed.toFixed(4),
    damageTaken: report.damageTaken.total.toFixed(4),
    damageDealt: report.damageDealt.total.toFixed(4),
    kills: report.kills,
  })
  const time = sweep('time', 'duelist', extra, 230).map(fingerprint)
  const progress = sweep('progress', 'duelist', extra, 230)
  assert.ok(
    progress.some((report) => report.balance.tierRises.some((rise) => rise.cause === 'progress')),
    'no run earned a tier, so the comparison below compares two identical rules',
  )
  assert.deepEqual(progress.map(fingerprint), time)

  // Negative control: let the earned tier scale enemy stats, and the same runs differ.
  const rejected = sweep('progressAll', 'duelist', extra, 230).map(fingerprint)
  assert.notDeepEqual(rejected, time)
})

test('«Устав дозора» stays distinct: closures throw waves only under it', () => {
  const vanguard = sweep('progress', 'duelist', { doctrinePolicy: 'first', doctrinePool: ['vanguard'] })
  const quartermaster = sweep('progress', 'duelist', { doctrinePolicy: 'first', doctrinePool: ['quartermaster'] })
  assert.ok(vanguard.every((report) => report.doctrines.equipped.includes('vanguard')))
  assert.equal(vanguard.reduce((sum, report) => sum + report.balance.wavesBy.clock, 0), 0, 'vanguard was thrown a clock wave')
  assert.ok(
    vanguard.reduce((sum, report) => sum + report.balance.wavesBy.objective, 0) >= vanguard.length / 2,
    'vanguard closures threw no waves',
  )
  assert.equal(
    quartermaster.reduce((sum, report) => sum + report.balance.wavesBy.objective, 0),
    0,
    'the base rule threw a wave on a closed objective',
  )
})
