import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HARNESS_SHIPPED_ARMS,
  runHarness,
} from './runHarness.ts'

test('managed care changes real whole runs while the legacy arm remains the matched control', () => {
  const options = {
    ...HARNESS_SHIPPED_ARMS,
    seed: 118786,
    faction: 'guard',
    policy: 'duelist',
    hz: 30,
    timeLimit: 300,
  } as const
  const managed = runHarness(options)
  const legacy = runHarness({ ...options, squadResource: 'legacy' })

  assert.equal(managed.squadResource, 'managed')
  assert.equal(legacy.squadResource, 'legacy')
  assert.equal(legacy.balance.squadResource.companionHealed, 0)
  assert.equal(legacy.balance.squadResource.recoveryUses, 0)
  assert.deepEqual(legacy.balance.squadResource.replacementsBySource, {
    elfRescue: 0,
    elfDefense: 0,
    guardOrder: 0,
    villainMuster: 0,
    villainPress: 0,
  })
  assert.ok(managed.balance.squadResource.companionHealed > 0)
  assert.ok(managed.balance.squadResource.recoveryUses > 0)
  assert.ok(managed.balance.squadResource.recoveryUses <= 2)
  assert.equal(managed.balance.squadResource.replacementsBySource.guardOrder, 1)
  assert.equal(managed.balance.squadResource.attendedGuardDeliveries, 1)
  assert.equal(managed.balance.squadResource.attendedGuardConfiscations, 1)
  assert.ok((managed.balance.companions.aliveAtEnd ?? 0) >= legacy.balance.companions.aliveAtEnd)
})

test('a squad-only settlement withholds exactly half personal gold in the managed arm', () => {
  const options = {
    ...HARNESS_SHIPPED_ARMS,
    // W3-3's first-staging roles move seed 95029's settlement. Re-picked by the same
    // invariant: the first stride seed with one squad-only 70-gold settlement.
    seed: 340518,
    faction: 'villain',
    policy: 'beeline',
    hz: 30,
    timeLimit: 300,
  } as const
  const managed = runHarness(options)
  const legacy = runHarness({ ...options, squadResource: 'legacy' })
  assert.equal(managed.balance.squadResource.reducedSettlements, 1)
  assert.equal(managed.balance.squadResource.goldWithheld, 35)
  assert.equal(legacy.balance.squadResource.reducedSettlements, 0)
  assert.equal(legacy.balance.squadResource.goldWithheld, 0)
})

test('elf rescue and villain press-gang remain distinct managed replacement sources', () => {
  const elf = runHarness({
    ...HARNESS_SHIPPED_ARMS,
    seed: 1,
    faction: 'elf',
    policy: 'duelist',
    hz: 30,
    timeLimit: 300,
  })
  assert.equal(elf.balance.squadResource.replacementsBySource.elfRescue, 1)
  assert.equal(elf.balance.squadResource.replacementsBySource.villainPress, 0)

  const villain = runHarness({
    ...HARNESS_SHIPPED_ARMS,
    seed: 95029,
    faction: 'villain',
    policy: 'beeline',
    hz: 30,
    timeLimit: 300,
  })
  assert.equal(villain.balance.squadResource.replacementsBySource.elfRescue, 0)
  assert.equal(villain.balance.squadResource.replacementsBySource.villainPress, 1)
})
