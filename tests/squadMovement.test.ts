import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SQUAD_FOLLOW_CRUISE_SPEED,
  SQUAD_FOLLOW_MAX_SPEED,
  getSquadFollowSpeed,
} from '../src/game/squadMovement.ts'

test('squad followers keep pace and accelerate when they fall behind', () => {
  assert.equal(getSquadFollowSpeed(3.7, 3.2), SQUAD_FOLLOW_CRUISE_SPEED)

  const catchUpSpeed = getSquadFollowSpeed(3.7, 12)
  assert.ok(catchUpSpeed > SQUAD_FOLLOW_CRUISE_SPEED)
  assert.ok(catchUpSpeed < SQUAD_FOLLOW_MAX_SPEED)

  assert.equal(getSquadFollowSpeed(3.7, 100), SQUAD_FOLLOW_MAX_SPEED)
  assert.equal(getSquadFollowSpeed(18, 100), 18)
})
