import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HARNESS_SHIPPED_ARMS,
  runHarness,
} from './runHarness.ts'

const CONTROL = {
  ...HARNESS_SHIPPED_ARMS,
  seed: 1,
  faction: 'guard',
  policy: 'duelist',
  hz: 30,
  timeLimit: 300,
  escalation: 'progressAll',
} as const

test('the capped arm clips the old compounded HP product and reports its matched control', () => {
  assert.equal(HARNESS_SHIPPED_ARMS.encounterHealth, 'capped')
  assert.equal(HARNESS_SHIPPED_ARMS.encounterComposition, 'tiered')
  const legacy = runHarness({
    ...CONTROL,
    encounterHealth: 'legacy',
    encounterComposition: 'legacy',
  })
  const capped = runHarness({
    ...CONTROL,
    encounterHealth: 'capped',
    encounterComposition: 'legacy',
  })
  assert.equal(legacy.encounterHealth, 'legacy')
  assert.equal(capped.encounterHealth, 'capped')
  assert.ok(
    legacy.balance.encounters.maximumHealthMultiplier > 1.65,
  )
  assert.equal(
    capped.balance.encounters.maximumHealthMultiplier,
    1.65,
  )
})

test('tiered composition is deterministic and reports staging mixes and real fight time', () => {
  const legacy = runHarness({
    ...CONTROL,
    encounterHealth: 'capped',
    encounterComposition: 'legacy',
  })
  const first = runHarness({
    ...CONTROL,
    encounterHealth: 'capped',
    encounterComposition: 'tiered',
  })
  const second = runHarness({
    ...CONTROL,
    encounterHealth: 'capped',
    encounterComposition: 'tiered',
  })
  assert.equal(first.encounterComposition, 'tiered')
  assert.deepEqual(
    first.balance.encounters.stagedMixes,
    second.balance.encounters.stagedMixes,
  )
  assert.deepEqual(
    first.balance.encounters.timeToKillByTierAndMix,
    second.balance.encounters.timeToKillByTierAndMix,
  )
  assert.notDeepEqual(
    first.balance.encounters.stagedMixes,
    legacy.balance.encounters.stagedMixes,
  )
  assert.ok(
    Object.keys(first.balance.encounters.stagedMixes)
      .some((key) => key.startsWith('tier-4|')),
  )
  assert.ok(
    Object.values(first.balance.encounters.timeToKillByTierAndMix)
      .some((metric) =>
        metric.fights > 0 &&
        metric.totalSeconds > 0 &&
        metric.meanSeconds > 0),
  )
})

test('a tiered remnant keeps one role signature until the square changes hands', () => {
  const report = runHarness({
    ...HARNESS_SHIPPED_ARMS,
    encounterHealth: 'capped',
    encounterComposition: 'tiered',
    encounterTrace: true,
    seed: 31677,
    faction: 'elf',
    policy: 'duelist',
    hz: 30,
    timeLimit: 240,
  })
  const last = new Map<string, string>()
  let sameOwnerReturns = 0
  for (const event of report.encounterTrace ?? []) {
    const previous = last.get(event.spawnId)
    if (event.kind === 'field' && previous) {
      const previousOwner = previous.slice(
        0,
        previous.indexOf('/'),
      )
      const owner = event.signature.slice(
        0,
        event.signature.indexOf('/'),
      )
      if (owner === previousOwner) {
        sameOwnerReturns += 1
        assert.equal(
          event.signature,
          previous,
          `${event.spawnId} re-rolled without changing hands`,
        )
      }
    }
    last.set(event.spawnId, event.signature)
  }
  assert.ok(sameOwnerReturns > 0, 'the control run refielded no same-owner member')
})
