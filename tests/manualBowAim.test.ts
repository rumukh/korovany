import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { BowAim } from '../src/game/input/BowAim.ts'
import { createHealthyBody } from '../src/game/types.ts'
import { buildAbilityView } from '../src/game/world/CampaignView.ts'

test('manual aim keeps a root-local reachable muzzle at every pitch and distance without aiming backwards', () => {
  const root = new THREE.Group()
  const aim = new BowAim()
  for (const yaw of [-3, -1, 0, 2, 4]) for (const pitch of [-1.2, -0.6, 0, 0.6, 1.2]) {
    for (const distance of [0.12, 0.5, 1, 10, 30]) for (const leftMissing of [false, true]) {
      root.position.set(3, 4, 7)
      let query = 0
      aim.resolve(root.position, yaw, pitch, leftMissing, 30, () => query++ === 0 ? distance / 30 : null)
      root.rotation.y = aim.heading
      root.updateMatrixWorld(true)
      const local = root.worldToLocal(aim.origin.clone())
      assert.ok(Math.abs(local.y - 2.05) < 1e-12)
      assert.ok(local.z >= -1e-12 && local.z <= 0.35 + 1e-12)
      assert.ok(leftMissing ? local.x >= -1e-12 : local.x <= 1e-12)
      assert.ok(Math.abs(local.x) <= 0.25 + 1e-12)
      const direction = aim.direction.clone().transformDirection(root.matrixWorld.clone().invert())
      assert.ok(Math.abs(Math.atan2(direction.x, direction.z)) <= 0.27)
      assert.ok(Math.abs(Math.asin(direction.y)) <= 1.2 + 1e-12)
      assert.ok(aim.target.clone().sub(aim.origin).dot(aim.direction) > 0)
      assert.ok(Math.abs(aim.direction.length() - 1) < 1e-12)
    }
  }
})

test('aim availability and actual shot readiness are independent and truthfully disabled on interruption', () => {
  for (const stamina of [0, 14, 15, 100]) for (const cooldown of [0, 0.5]) {
    const input = { faction: 'elf' as const, body: createHealthyBody(), stamina, shieldActive: false,
      abilityCooldown: cooldown, paused: false, ended: false, bowAiming: true }
    const view = buildAbilityView(input)
    assert.equal(view.active, true)
    assert.equal(view.aimAvailable, true)
    assert.equal(view.ready, stamina >= 15 && cooldown === 0)
    assert.equal(buildAbilityView({ ...input, paused: true }).aimAvailable, false)
    assert.equal(buildAbilityView({ ...input, inputBlocked: true }).aimAvailable, false)
    input.body.leftArm = input.body.rightArm = 'missing'
    assert.equal(buildAbilityView(input).aimAvailable, false)
    assert.equal(buildAbilityView(input).ready, false)
  }
})
