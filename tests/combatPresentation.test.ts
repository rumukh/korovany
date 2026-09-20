import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { buildCharacterSkeleton, resolveCharacterPlan } from '../src/game/art/CharacterKit.ts'
import { createMeleePresentation, sampleMeleePresentation } from '../src/game/art/MeleePresentation.ts'
import {
  advancePlayerMelee,
  bufferPlayerMelee,
  cancelPlayerMelee,
  createPlayerMeleeState,
  playerBeatSpec,
} from '../src/game/world/CombatResolver.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

function invoke<T>(target: object, method: string, ...args: unknown[]): T {
  return Reflect.apply(Reflect.get(target, method) as (...values: unknown[]) => T, target, args)
}

test('melee presentation reads the real phase and peaks at contact, never at button press', () => {
  for (const beat of [1, 2, 3]) {
    const spec = playerBeatSpec(beat)
    const state = createPlayerMeleeState()
    const pose = createMeleePresentation()
    Object.assign(state, { beat, phase: 'windup', phaseRemaining: spec.windup })
    sampleMeleePresentation(state, pose)
    assert.equal(pose.attack, 0)
    assert.equal(pose.trail, 0)
    state.phaseRemaining = spec.windup * 0.35
    sampleMeleePresentation(state, pose)
    assert.ok(pose.anticipation > 0.99)
    assert.ok(pose.attack < 0.001)
    assert.equal(pose.trail, 0)
    state.phaseRemaining = 0
    const beforeContact = { ...sampleMeleePresentation(state, pose) }
    Object.assign(state, { phase: 'recovery', phaseRemaining: spec.recovery })
    sampleMeleePresentation(state, pose)
    assert.equal(pose.attack, 1)
    assert.equal(pose.anticipation, 0)
    assert.equal(pose.trail, 1)
    assert.equal(beforeContact.twist, pose.twist, 'body must not jump at the contact boundary')
    assert.equal(beforeContact.sweep, pose.sweep)
    state.phaseRemaining = 0
    sampleMeleePresentation(state, pose)
    assert.equal(pose.attack, 0)
    assert.equal(pose.trail, 0)
  }
})

test('render sampling never advances combat, costs stamina, or changes contacts across frame schedules', () => {
  for (const hz of [20, 30, 60, 144]) {
    const state = createPlayerMeleeState()
    const control = createPlayerMeleeState()
    const pose = createMeleePresentation()
    let stamina = 100
    let contacts = 0
    for (let frame = 0; frame < hz * 2; frame += 1) {
      if (frame % Math.max(1, Math.round(hz * 0.22)) === 0) {
        bufferPlayerMelee(state)
        bufferPlayerMelee(control)
      }
      const step = advancePlayerMelee(state, { delta: 1 / hz, stamina })
      assert.deepEqual(step, advancePlayerMelee(control, { delta: 1 / hz, stamina }))
      stamina -= step.staminaSpent
      if (step.contactBeat > 0) contacts += 1
      for (let sample = 0; sample < 4; sample += 1) {
        assert.equal(sampleMeleePresentation(state, pose), pose, 'reuse the same presentation object')
      }
      assert.deepEqual(state, control)
      assert.ok(Object.values(pose).every(Number.isFinite))
      assert.ok(pose.trail >= 0 && pose.trail <= 1)
    }
    assert.ok(contacts >= 3)
  }
})

function fixture() {
  const proportions = resolveCharacterPlan('guard', 'player', 0, true).proportions
  const skeleton = buildCharacterSkeleton(proportions)
  const { root: player, torsoPivot, pelvisPivot } = skeleton
  const joints = {
    leftArm: new THREE.Group(), rightArm: new THREE.Group(),
    leftElbow: new THREE.Group(), rightElbow: new THREE.Group(),
    leftLeg: new THREE.Group(), rightLeg: new THREE.Group(),
    leftKnee: new THREE.Group(), rightKnee: new THREE.Group(),
    weapon: new THREE.Group(), cloak: null,
  }
  const hands = []
  for (const side of [-1, 1]) {
    const arm = side < 0 ? joints.leftArm : joints.rightArm
    const elbow = side < 0 ? joints.leftElbow : joints.rightElbow
    arm.position.set(side * proportions.shoulderX, skeleton.shoulderY, 0)
    elbow.position.y = -proportions.upperArm
    const hand = new THREE.Object3D()
    hand.position.y = -proportions.forearm
    elbow.add(hand)
    arm.add(elbow)
    torsoPivot.add(arm)
    hands.push(hand)
  }
  torsoPivot.add(joints.weapon)
  pelvisPivot.add(joints.leftLeg, joints.rightLeg)
  const rig = {
    ...joints, torsoPivot, mainHand: 1, beast: null, boundArms: false,
    upperArm: proportions.upperArm, forearm: proportions.forearm,
    shoulderY: skeleton.shoulderY, elbowRest: proportions.elbowRest,
    armSplay: proportions.armSplay, lean: proportions.lean,
  }
  player.userData.rig = rig
  const pose = { ...createMeleePresentation(), stride: 0, flinch: 0, stagger: 0 }
  const state = createPlayerMeleeState()
  const trail = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial())
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    player, playerPose: pose, melee: state, honestMelee: true, activePlayerAttackKind: 'melee',
    attackAnimation: 1, weaponTrail: trail, handOffset: new THREE.Vector3(),
    elapsed: 0, reducedMotion: false, isSprinting: false,
  })
  return { engine, state, pose, rig, player, hands, trail }
}

test('live player rig shows alternating swings and a stronger finisher with the grip still in the hand', () => {
  const { engine, state, pose, player, rig, hands, trail } = fixture()
  const twists: number[] = []
  const rolls: number[] = []
  for (const beat of [1, 2, 3]) {
    Object.assign(state, { beat, phase: 'recovery', phaseRemaining: playerBeatSpec(beat).recovery })
    invoke(engine, 'samplePlayerPose', 0.1)
    invoke(engine, 'animateCharacter', player, pose)
    invoke(engine, 'updateWeaponTrail')
    player.updateMatrixWorld(true)
    const grip = rig.weapon.getWorldPosition(new THREE.Vector3())
    assert.ok(grip.distanceTo(hands[1].getWorldPosition(new THREE.Vector3())) < 1e-8)
    twists.push(rig.torsoPivot.rotation.y)
    rolls.push(rig.weapon.rotation.z)
    assert.equal(trail.visible, true)
  }
  assert.ok(twists[0] > 0 && twists[1] < 0)
  assert.ok(twists[2] > twists[0])
  assert.ok(Math.abs(rolls[0] - rolls[1]) > 0.5)
  assert.ok(trail.scale.x > 1)
})

test('cancelled swings clear pose and trail immediately; a restored finisher retains its exact phase', () => {
  const { engine, state, pose, player, rig, trail } = fixture()
  Object.assign(state, { beat: 1, phase: 'windup', phaseRemaining: 0.04 })
  invoke(engine, 'samplePlayerPose', 0)
  invoke(engine, 'animateCharacter', player, pose)
  assert.notEqual(rig.torsoPivot.rotation.y, 0)
  cancelPlayerMelee(state)
  invoke(engine, 'samplePlayerPose', 0)
  invoke(engine, 'animateCharacter', player, pose)
  invoke(engine, 'updateWeaponTrail')
  assert.equal(pose.attack, 0, 'the old attackAnimation must not resurrect a cancelled swing')
  assert.equal(rig.torsoPivot.rotation.y, 0)
  assert.equal(trail.visible, false)

  Object.assign(state, { beat: 3, phase: 'windup', phaseRemaining: 0.05 })
  const saved = JSON.stringify(state)
  invoke(engine, 'samplePlayerPose', 0)
  const before = { ...pose }
  assert.equal(cancelPlayerMelee(state), false)
  Object.assign(state, JSON.parse(saved))
  invoke(engine, 'samplePlayerPose', 0)
  assert.deepEqual(pose, before)
  Reflect.set(engine, 'reducedMotion', true)
  invoke(engine, 'animateCharacter', player, pose)
  assert.ok(Math.abs(rig.torsoPivot.rotation.y) < Math.abs(pose.twist))
  assert.equal(JSON.stringify(state), saved)
})

test('legacy melee and instant cleave keep their own presentation instead of borrowing the combo clock', () => {
  const { engine, state, pose, trail } = fixture()
  Reflect.set(engine, 'activePlayerAttackKind', 'cleave')
  invoke(engine, 'samplePlayerPose', 0)
  assert.equal(pose.attack, 1)
  Reflect.set(engine, 'activePlayerAttackKind', 'melee')
  Reflect.set(engine, 'honestMelee', false)
  invoke(engine, 'samplePlayerPose', 0)
  assert.equal(pose.attack, 1)
  Object.assign(state, { beat: 3, phase: 'recovery', phaseRemaining: playerBeatSpec(3).recovery })
  invoke(engine, 'samplePlayerPose', 0)
  invoke(engine, 'updateWeaponTrail')
  assert.equal(trail.visible, true, 'a saved committed finisher still presents its real contact')
  assert.ok(pose.twist > 0)
})
