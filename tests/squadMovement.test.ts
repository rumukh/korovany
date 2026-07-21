import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SQUAD_FOLLOW_CRUISE_SPEED,
  SQUAD_FOLLOW_MAX_SPEED,
  SQUAD_REGROUP_DISTANCE,
  STARTING_SQUAD_VERSION,
  getSquadFollowSpeed,
  getStartingSquad,
  shouldInitializeStartingSquad,
  shouldSquadRegroup,
} from '../src/game/squadMovement.ts'

test('squad followers keep pace and accelerate when they fall behind', () => {
  assert.equal(getSquadFollowSpeed(3.7, 3.2), SQUAD_FOLLOW_CRUISE_SPEED)

  const catchUpSpeed = getSquadFollowSpeed(3.7, 12)
  assert.ok(catchUpSpeed > SQUAD_FOLLOW_CRUISE_SPEED)
  assert.ok(catchUpSpeed < SQUAD_FOLLOW_MAX_SPEED)

  assert.equal(getSquadFollowSpeed(3.7, 100), SQUAD_FOLLOW_MAX_SPEED)
  assert.equal(getSquadFollowSpeed(18, 100), 18)
})

test('distant squad members regroup before engaging enemies', () => {
  assert.equal(shouldSquadRegroup(SQUAD_REGROUP_DISTANCE), false)
  assert.equal(shouldSquadRegroup(SQUAD_REGROUP_DISTANCE + 0.01), true)
})

test('generated runs receive a faction-appropriate starter squad', () => {
  assert.deepEqual(
    getStartingSquad('elf').map((member) => member.role),
    ['scout', 'archer', 'scout'],
  )
  assert.deepEqual(
    getStartingSquad('guard').map((member) => member.role),
    ['soldier', 'archer', 'soldier'],
  )
  assert.deepEqual(
    getStartingSquad('villain').map((member) => member.role),
    ['minion', 'brute', 'archer'],
  )

  for (const faction of ['elf', 'guard', 'villain'] as const) {
    const squad = getStartingSquad(faction)
    assert.equal(squad.length, 3)
    assert.equal(
      new Set(squad.map((member) => `${member.offsetX}:${member.offsetZ}`)).size,
      squad.length,
    )
  }
})

test('starter squad migration runs exactly once per saved run', () => {
  assert.equal(shouldInitializeStartingSquad(undefined), true)
  assert.equal(shouldInitializeStartingSquad(0), true)
  assert.equal(shouldInitializeStartingSquad(STARTING_SQUAD_VERSION), false)
})
