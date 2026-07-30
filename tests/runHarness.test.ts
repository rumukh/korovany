/**
 * What the full-run harness measured, part one: a fixed seed and its control arms.
 *
 * `tests/runHarness.ts` drives a whole campaign headlessly through the real world
 * generator, terrain, collision, navmesh, chronicle, materialization, campaign director
 * and combat resolver. This file pins one seed exactly — the driver is deterministic, so
 * if a number below moves, something in the simulation changed and the diff says which —
 * and then checks that the report can tell three scripted policies apart. Without that
 * second half the numbers would be unfalsifiable: a metric that cannot separate a walking
 * player from a standing one is not measuring the player.
 *
 * The scripted 30 / 60 / 144 Hz schedules and the weather-target transition are in
 * `runHarnessSchedules.test.ts`; the multi-seed sweep is in `runHarnessSweep.test.ts`.
 * Three files rather than one because the test runner runs files in parallel and the
 * sweep is the long pole.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { runHarness } from './runHarness.ts'

// ---------------------------------------------------------------------------
// 1. A stable report for a fixed seed
// ---------------------------------------------------------------------------

test('the harness produces a stable run report for a fixed seed', () => {
  const report = runHarness({ seed: 424242, faction: 'elf', policy: 'beeline', hz: 60 })

  // Every number below moved once, when roadmap 1.4 turned the three-node chain into a
  // four-node diamond: the campaign is a node longer, so the run is longer, walks further
  // and sees more of the chronicle. The default arms are unchanged — `contractPolicy` is
  // `firstReady`, which pins nothing and takes the ready nodes in graph order, exactly as
  // the pre-1.4 `.find()` did.
  assert.equal(report.outcome, 'victory')
  assert.equal(report.objectivesCompleted, 4)
  assert.equal(report.objectivesTotal, 4)
  assert.equal(report.frames, 9_665)
  assert.equal(report.kills, 2)
  assert.equal(report.regionsVisited, 12)
  assert.equal(report.chronicleTicks, 20)
  assert.equal(report.chronicleHistory.length, 14)
  assert.equal(report.weatherTargetChanges, 8)
  assert.equal(report.finalWeather, 'clear')

  // Floats to four places: enough to catch a changed rule, loose enough to survive a
  // platform's last-bit difference in `Math.hypot`.
  assert.equal(report.elapsed.toFixed(4), '161.0833')
  assert.equal(report.distanceWalked.toFixed(4), '978.1452')
  assert.equal(report.damageTaken.total.toFixed(4), '32.2296')
  assert.equal(report.damageDealt.total.toFixed(4), '352.6049')
  assert.equal(report.health.toFixed(4), '67.7704')

  // Time and distance to each objective, which is deliverable A's first bullet. The first
  // objective completes almost immediately because a faction's campaign begins at the site
  // it spawns on: worth knowing, and not a defect.
  const [first, second, third, fourth] = report.objectives
  assert.equal(first.completedAt?.toFixed(3), '0.017')
  assert.equal(first.distanceWalked.toFixed(2), '0.00')
  assert.equal(second.completedAt?.toFixed(3), '76.700')
  assert.equal(second.distanceWalked.toFixed(2), '490.77')
  assert.equal(third.completedAt?.toFixed(3), '123.350')
  assert.equal(third.distanceWalked.toFixed(2), '278.82')
  assert.equal(fourth.completedAt?.toFixed(3), '161.083')
  assert.equal(fourth.distanceWalked.toFixed(2), '208.55')

  // Roadmap 1.4 — the fork existed and the run took one of its arms. Two ready nodes at
  // once is the whole shape; `chose` is false because this arm pins nothing.
  assert.equal(report.contracts.contractId, 'unshackle')
  assert.equal(report.contracts.maxReady, 2)
  assert.equal(report.contracts.chose, false)
  assert.deepEqual(report.contracts.middleOrder, [
    'objective-elf-branch',
    'objective-elf-contract',
  ])

  // Event exposure: how much of the world's own history this run was in a position to see.
  assert.deepEqual(report.eventExposure, {
    chronicleEvents: 14,
    witnessed: 4,
    offScreen: 10,
    materializable: 19,
    materializedNearPlayer: 19,
  })

  // Region dwell sums to the run, minus nothing: every frame is spent somewhere.
  const dwell = Object.values(report.regionDwell).reduce((sum, value) => sum + value, 0)
  assert.ok(
    Math.abs(dwell - report.elapsed) < 0.05,
    `dwell ${dwell} should account for the whole run ${report.elapsed}`,
  )

  // Determinism, which every number above depends on.
  const repeat = runHarness({ seed: 424242, faction: 'elf', policy: 'beeline', hz: 60 })
  assert.deepEqual(repeat, report, 'the driver must be deterministic')
})

test('the idle control separates what the player did from what the world did', () => {
  // The control arm `aiHarness.ts` learned to demand twice. A metric that cannot tell a
  // walking player from a standing one is not measuring the player.
  //
  // The limit is 180 s rather than 120 s since roadmap 1.4 added a fourth required node:
  // measured on this seed, the walking arm reaches victory at 156.6 s. What the control is
  // about is the *separation* between the arms, so the window was widened rather than the
  // claim weakened.
  const walking = runHarness({
    seed: 424242,
    faction: 'elf',
    policy: 'beeline',
    hz: 20,
    timeLimit: 180,
  })
  const idle = runHarness({
    seed: 424242,
    faction: 'elf',
    policy: 'idle',
    hz: 20,
    timeLimit: 180,
  })

  assert.equal(idle.distanceWalked, 0, 'the idle policy must genuinely not move')
  assert.ok(walking.distanceWalked > 400, `walking should travel, got ${walking.distanceWalked}`)
  assert.equal(idle.regionsVisited, 1, 'a standing player visits one region')
  assert.ok(walking.regionsVisited > 4, `walking should cross regions, got ${walking.regionsVisited}`)
  assert.equal(idle.outcome, 'defeat', 'standing in the open is fatal, which is the point')
  assert.equal(walking.outcome, 'victory')
  assert.ok(
    idle.damageTaken.total > walking.damageTaken.total,
    'standing still must cost more than walking, or the attrition metric is inverted',
  )
  assert.equal(idle.damageDealt.total, 0, 'the idle policy never swings')
  assert.equal(idle.kills, 0)
})

test('a cautious policy trades a death for a stalled run', () => {
  // Two policies, one seed: the harness has to be able to tell them apart, or "scripted
  // input policies" is a parameter nobody can act on. Most seeds never press the player
  // hard enough for the retreat branch to fire at all, which is itself worth knowing —
  // this is one of the ones that does.
  const beeline = runHarness({
    seed: 182_138,
    faction: 'villain',
    policy: 'beeline',
    hz: 20,
    timeLimit: 300,
  })
  const cautious = runHarness({
    seed: 182_138,
    faction: 'villain',
    policy: 'cautious',
    hz: 20,
    timeLimit: 300,
  })

  assert.equal(beeline.outcome, 'defeat', 'the beeline arm walks into a fight it loses')
  assert.equal(cautious.outcome, 'timeout', 'the cautious arm survives and stops finishing')
  assert.ok(
    cautious.damageTaken.total < beeline.damageTaken.total,
    `cautious ${cautious.damageTaken.total} should take less than beeline ${beeline.damageTaken.total}`,
  )
  assert.ok(
    cautious.distanceWalked > beeline.distanceWalked * 5,
    'retreating costs a great deal of distance, which is the trade being measured',
  )
  assert.ok(cautious.health > 0, 'the cautious arm is alive at the time limit')
  assert.equal(beeline.health, 0)
})

