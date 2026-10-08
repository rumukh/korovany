/**
 * W3-4 — the harness's whole runs keep «Недобитые» the way the engine does.
 *
 * `encounterMemory: 'remnants'` runs the engine's own ledger (`world/EncounterRemnants.ts`) on the
 * harness's spawner, deaths and removals; `tests/encounterRemnantsEngine.test.ts` drives the same
 * ledger through the shipped `GameEngine`. What is checked here is the harness's wiring, over
 * whole runs with the shipped arms: the opt-in encounter trace records every member fielded,
 * leaving the field alive and falling, and two rules have to hold on every line of it.
 *
 * 1. A member that fell is never fielded again, unless its square changed hands and the new
 *    owners' man stands under the same spawn id.
 * 2. A member that left the field hurt comes back with exactly the health and maximum it left
 *    with; one that left whole comes back whole. If its square changed hands meanwhile, the
 *    new owners' man under the same spawn id is fielded whole.
 *
 * The control is the same runs with `encounterMemory: 'fresh'`, the engine before W3-4, which
 * breaks both rules: the trace has to tell them apart, or it is measuring nothing.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import type { Faction } from '../src/game/types.ts'
import {
  HARNESS_SHIPPED_ARMS,
  runHarness,
  type EncounterTraceEvent,
  type InputPolicy,
} from './runHarness.ts'

/** Shipped-arm runs that fight a pack, leave its square and come back to it. */
const CASES: ReadonlyArray<{ seed: number; faction: Faction; policy: InputPolicy }> = [
  { seed: 134624, faction: 'elf', policy: 'beeline' },
  { seed: 31677, faction: 'elf', policy: 'duelist' },
  { seed: 102948, faction: 'guard', policy: 'beeline' },
  { seed: 300923, faction: 'villain', policy: 'beeline' },
]

interface Audit {
  fallenRefielded: string[]
  woundsLost: string[]
  woundsKept: number
  fallenRevisited: number
  handedOver: number
}

function audit(trace: readonly EncounterTraceEvent[]): Audit {
  const result: Audit = { fallenRefielded: [], woundsLost: [], woundsKept: 0, fallenRevisited: 0, handedOver: 0 }
  const last = new Map<string, EncounterTraceEvent>()
  for (const event of trace) {
    const previous = last.get(event.spawnId)
    if (event.kind === 'field' && previous) {
      const label = `${event.spawnId} at ${event.at.toFixed(2)} s`
      if (previous.signature !== event.signature) {
        // The chronicle handed the square to another side: its own people, fielded whole.
        result.handedOver += 1
        if (event.hp !== event.maxHp) result.woundsLost.push(`${label}: the new owners' man came hurt ${event.hp}/${event.maxHp}`)
      } else if (previous.kind === 'fall') {
        result.fallenRefielded.push(label)
      } else if (previous.kind === 'leave') {
        if (previous.hp < previous.maxHp) {
          if (event.hp === previous.hp && event.maxHp === previous.maxHp) result.woundsKept += 1
          else result.woundsLost.push(`${label}: left ${previous.hp}/${previous.maxHp}, back ${event.hp}/${event.maxHp}`)
        } else if (event.hp !== event.maxHp) {
          result.woundsLost.push(`${label}: left whole, back hurt ${event.hp}/${event.maxHp}`)
        }
      }
    }
    last.set(event.spawnId, event)
  }
  return result
}

function run(encounterMemory: 'remnants' | 'fresh') {
  return CASES.map((entry) => runHarness({
    ...HARNESS_SHIPPED_ARMS,
    encounterMemory,
    encounterTrace: true,
    seed: entry.seed,
    faction: entry.faction,
    policy: entry.policy,
    hz: 30,
    timeLimit: 240,
  }))
}

test('whole runs keep the fallen dead and the wounded wounded, and the old engine does neither', () => {
  const shipped = run('remnants')
  let restored = 0
  let skipped = 0
  for (const report of shipped) {
    assert.equal(report.encounterMemory, 'remnants')
    assert.ok(report.encounterTrace, 'the trace was asked for')
    const found = audit(report.encounterTrace)
    const label = `seed ${report.seed} ${report.faction} ${report.policy}`
    assert.deepEqual(found.fallenRefielded, [], `${label}: a fallen member was fielded again`)
    assert.deepEqual(found.woundsLost, [], `${label}: a wound did not come back`)
    restored += report.balance.encounters.remnantSurvivorsRestored
    skipped += report.balance.encounters.remnantFallenSkipped
    assert.equal(found.woundsKept, report.balance.encounters.remnantSurvivorsRestored, `${label}: trace and metric agree`)
  }
  // Non-vacuity: these runs did leave hurt packs and come back to them, dead men and all.
  assert.ok(restored >= 2, `only ${restored} survivors came back wounded`)
  assert.ok(skipped >= 2, `only ${skipped} fallen members were passed over`)

  // The control: the engine before W3-4, on the same seeds, refields the dead and heals the hurt.
  const fresh = run('fresh')
  let refielded = 0
  let lost = 0
  for (const report of fresh) {
    assert.equal(report.balance.encounters.remnantSurvivorsRestored, 0)
    assert.equal(report.balance.encounters.remnantFallenSkipped, 0)
    const found = audit(report.encounterTrace ?? [])
    refielded += found.fallenRefielded.length
    lost += found.woundsLost.length
  }
  assert.ok(refielded > 0, 'the old engine never refielded a dead member on these seeds')
  assert.ok(lost > 0, 'the old engine never healed a wounded member on these seeds')
})

test('without the trace a run is the same run, and the trace draws from no stream', () => {
  const [entry] = CASES
  const plain = runHarness({ ...HARNESS_SHIPPED_ARMS, seed: entry.seed, faction: entry.faction, policy: entry.policy, hz: 30, timeLimit: 240 })
  const traced = runHarness({
    ...HARNESS_SHIPPED_ARMS, encounterTrace: true, seed: entry.seed, faction: entry.faction, policy: entry.policy, hz: 30, timeLimit: 240,
  })
  assert.equal(plain.encounterTrace, undefined)
  const { encounterTrace: _trace, ...rest } = traced
  assert.deepEqual(rest, plain)
})
