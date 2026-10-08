import assert from 'node:assert/strict'
import test from 'node:test'
import type { RunCompanionState } from '../src/game/run/runTypes.ts'
import {
  COMPANION_TREATMENT_RANGE,
  RECOVERY_TREATMENTS_PER_SITE,
  SQUAD_RESOURCE_CAP,
  availableSquadCapacity,
  canTreatCompanion,
  canVillainMuster,
  consumeRecoveryTreatment,
  createSquadResourceState,
  healCompanionHealth,
  markFightContribution,
  queueSquadReinforcement,
  recoveryTreatmentsRemaining,
  restoreSquadResourceState,
  serializeSquadResourceState,
  squadRewardCredit,
} from '../src/game/world/SquadResource.ts'

const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }

function companion(id: string, health = 55): RunCompanionState {
  return {
    id,
    role: 'scout',
    health,
    maxHealth: 55,
    worldPosition: [0, 0, 0],
  }
}

test('a recovery site has two persisted treatments and a third use refuses', () => {
  const state = createSquadResourceState(['healer'])
  assert.equal(recoveryTreatmentsRemaining(state, 'healer'), RECOVERY_TREATMENTS_PER_SITE)
  assert.equal(consumeRecoveryTreatment(state, 'healer'), true)
  assert.equal(recoveryTreatmentsRemaining(state, 'healer'), 1)
  assert.equal(consumeRecoveryTreatment(state, 'healer'), true)
  assert.equal(recoveryTreatmentsRemaining(state, 'healer'), 0)
  assert.equal(consumeRecoveryTreatment(state, 'healer'), false)

  const restored = restoreSquadResourceState(serializeSquadResourceState(state), {
    recoverySiteIds: ['healer'],
    faction: 'elf',
    bounds,
    startingSquadVersion: 1,
    companions: [
      companion('squad:elf:starter:0'),
      companion('squad:elf:starter:1'),
      companion('squad:elf:starter:2'),
    ],
  })
  assert.equal(restored.rejected, false)
  assert.equal(recoveryTreatmentsRemaining(restored.state, 'healer'), 0)
})

test('companion treatment is local, bounded, and does not manufacture health', () => {
  assert.equal(canTreatCompanion({
    health: 10,
    maxHealth: 55,
    distance: COMPANION_TREATMENT_RANGE,
  }), true)
  assert.equal(canTreatCompanion({
    health: 10,
    maxHealth: 55,
    distance: COMPANION_TREATMENT_RANGE + 0.01,
  }), false)
  assert.equal(canTreatCompanion({ health: 55, maxHealth: 55, distance: 0 }), false)
  assert.deepEqual(healCompanionHealth(10, 55, 35), { health: 45, restored: 35 })
  assert.deepEqual(healCompanionHealth(45, 55, 35), { health: 55, restored: 10 })
  assert.deepEqual(healCompanionHealth(0, 55, 35), { health: 35, restored: 35 })
})

test('older saves derive missing starters while malformed present state fails closed', () => {
  const companions = [
    companion('squad:villain:starter:0'),
    companion('squad:villain:starter:2'),
  ]
  const absent = restoreSquadResourceState(undefined, {
    recoverySiteIds: ['healer'],
    faction: 'villain',
    bounds,
    startingSquadVersion: 1,
    companions,
  })
  assert.equal(absent.rejected, false)
  assert.equal(absent.state.casualties, 1)
  assert.equal(absent.state.villainMustersUsed, 0)
  assert.equal(recoveryTreatmentsRemaining(absent.state, 'healer'), 2)

  const malformed = restoreSquadResourceState({
    ...serializeSquadResourceState(absent.state),
    recoveryTreatments: { healer: 3 },
  }, {
    recoverySiteIds: ['healer'],
    faction: 'villain',
    bounds,
    startingSquadVersion: 1,
    companions,
  })
  assert.equal(malformed.rejected, true)
  assert.equal(malformed.state.villainMustersUsed, 1)
  assert.equal(recoveryTreatmentsRemaining(malformed.state, 'healer'), 0)
  assert.deepEqual(malformed.state.pending, [])
})

test('reinforcements share the cap and villain muster spends exactly once', () => {
  const state = createSquadResourceState(['healer'], 1)
  assert.equal(canVillainMuster({
    state,
    faction: 'villain',
    livingSquad: 3,
    atOldFort: true,
  }), true)
  assert.equal(queueSquadReinforcement(state, 3, {
    id: 'squad:villain:muster:0',
    source: 'villainMuster',
    role: 'minion',
    position: { x: 5, z: 6 },
  }), true)
  assert.equal(state.villainMustersUsed, 1)
  assert.equal(availableSquadCapacity(state, 3), 0)
  assert.equal(canVillainMuster({
    state,
    faction: 'villain',
    livingSquad: 3,
    atOldFort: true,
  }), false)
  assert.equal(queueSquadReinforcement(state, 3, {
    id: 'another',
    source: 'guardOrder',
    role: 'soldier',
    position: { x: 0, z: 0 },
  }), false)
  assert.equal(3 + state.pending.length, SQUAD_RESOURCE_CAP)
})

test('personal gold is full after any real contribution, wherever the fight settles', () => {
  assert.deepEqual(squadRewardCredit(15, false), {
    gold: 7,
    fullGold: 15,
    reduced: true,
  })
  assert.deepEqual(squadRewardCredit(15, true), {
    gold: 15,
    fullGold: 15,
    reduced: false,
  })

  const state = createSquadResourceState([])
  markFightContribution(state, 'contract:one')
  const restored = restoreSquadResourceState(serializeSquadResourceState(state), {
    recoverySiteIds: [],
    faction: 'guard',
    bounds,
    startingSquadVersion: 1,
    companions: [],
  })
  assert.deepEqual(restored.state.contributedFightKeys, ['contract:one'])
})
