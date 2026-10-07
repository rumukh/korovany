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
 * ## The measurement (shipped arms, 30 Hz, 600 s, seeds `1 + 7919 n`, n = 0…39)
 *
 * ```text
 * policy · faction    time (control)       progress (shipped)    progressAll (rejected)
 *                     wins   drafts/win    wins   drafts/win     wins
 * beeline · elf       15/40     0          13/40     2           6/40
 * beeline · guard     16/40     0          17/40     2          13/40
 * beeline · villain   25/40     0          25/40     2          17/40
 * cautious · elf      12/40     0          11/40     2           4/40
 * cautious · guard    14/40     0          16/40     2           9/40
 * cautious · villain  21/40     0          21/40     2          13/40
 * duelist · elf       38/40     0          36/40     2          30/40
 * duelist · guard     38/40     0          36/40     2          29/40
 * duelist · villain   36/40     0          36/40     2          34/40
 * ```
 *
 * Under `progress`, 198 of 211 wins opened two drafts or more before the end, the finale was
 * fought at pacing tier 3 with its boss scaled at the clock's tier 1, and the median win
 * length moved by under ten percent. Without a card taken and with the director silent, a
 * `progress` run is the `time` run to the frame; `progressAll` is not.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
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

  // Control: the same seeds on the clock alone. The metric can tell the two rules apart.
  const timeWins = time.filter((report) => report.outcome === 'victory')
  assert.equal(median(timeWins.map((report) => report.balance.draftsOpenedAt.length)), 0)
  assert.ok(timeWins.every((report) => report.balance.tierRises.every((rise) => rise.cause === 'time')))
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

test('enemy stats ignore progress: with no card taken and the director silent, a run is the clock run', () => {
  // Under 230 s nothing paced by the tier is left: no random events (silent director), no
  // card (`none`) and no threat wave (they start at 240 s). Enemy stats are the one thing an
  // earned tier could still have touched, and they must not have.
  const extra: Partial<RunOptions> = { doctrinePolicy: 'none', eventDirector: 'silent' }
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
