import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import {
  buildCharacterSkeleton,
  characterRoles,
  resolveCharacterPlan,
} from '../src/game/art/index.ts'
import { weatherHunch } from '../src/game/world/AmbientLife.ts'
import { createSquadCommandState } from '../src/game/world/SquadCommand.ts'

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

function actor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'actor',
    allegiance: 'civilian',
    role: 'soldier',
    mesh: new THREE.Group(),
    hp: 50,
    maxHp: 50,
    speed: 3.7,
    alive: true,
    attackCooldown: 0,
    home: new THREE.Vector3(),
    wanderTarget: new THREE.Vector3(0, 0, 5),
    wanderTimer: 10,
    targetId: null,
    stride: 0.6,
    phase: 0,
    velocity: new THREE.Vector3(3, 0, 4),
    gaitPhase: 0,
    visualSpeed: 5,
    motionBlend: 1,
    turnLean: 0.5,
    headYaw: 0,
    idleTimer: 0,
    wanderPace: 1,
    retreatTimer: 0,
    reinforcementTimer: 0,
    reinforcementsCalled: 0,
    objectiveEligible: true,
    squadEligible: false,
    squadSlot: null,
    aiMode: 'normal',
    eventOwnerId: null,
    eventPropTargetId: null,
    ignoredTargetId: null,
    playerAggro: false,
    aggroMemory: 0,
    lastKnownTargetPos: null,
    rageTimer: 0,
    alertCooldown: 0,
    retaliationTimer: 0,
    action: null,
    reaction: 'none',
    reactionRemaining: 0,
    poise: 10,
    maxPoise: 10,
    poiseRecoveryDelay: 0,
    staggerImmunity: 0,
    knockbackVelocity: new THREE.Vector3(),
    lastHitDirection: new THREE.Vector3(0, 0, 1),
    generatedRegionId: null,
    generatedEncounterId: null,
    generatedSpawnId: null,
    routTimer: 0,
    rallyTimer: 0,
    commanderLostTimer: 0,
    routReason: 'none',
    moraleTimer: 0,
    alertTimer: 0,
    alertPos: null,
    alarmPos: null,
    chargeCooldown: 0,
    chargeWindup: 0,
    chargeTimer: 0,
    chargeDirection: new THREE.Vector3(0, 0, 1),
    order: null,
    ...overrides,
  }
}

function actorEngine(value: Record<string, unknown>): object {
  const player = new THREE.Group()
  player.position.set(100, 0, 100)
  return Object.assign(Object.create(GameEngine.prototype), {
    actors: [value],
    player,
    faction: 'elf',
    health: 100,
    maxHealth: 100,
    cameraYaw: 0,
    elapsed: 0,
    ambientStormPace: 1,
    generatedNavigationRegionSignature: '',
    generatedWorld: {
      navigation: { getActiveRegions: () => [] },
      collision: { getRevision: () => 0 },
    },
    finale: {
      identity: {
        regionId: 'finale-region',
        encounterId: 'finale-encounter',
        bossId: 'finale-boss',
        escortIds: [],
        profile: 'marshal',
      },
    },
    squadCommand: createSquadCommandState({ x: 0, z: 0, heading: 0 }),
    squadIntents: new Map(),
    squadBlockedSeconds: new Map(),
    fledBeastIds: [],
    eventPropTargets: new Map(),
    collisionProbe: new THREE.Vector3(),
    reconcileSquadFocus() {},
    getCombatTargets: () => [],
    updateActorIndicators() {},
    updateActorReaction() {},
    updateActorKnockback: () => 0,
    updateActorMorale() {},
    updateCivilianRoutine() {},
    updateActorAction() {},
    updateChampionAura() {},
    animateActorCharacter() {},
    moveToOrderPost: () => 0,
    getNavigationWaypoint: () => null,
    chooseWanderTarget() {},
    getActorSeparation: () => new THREE.Vector3(),
    hasCommanderAura: () => false,
    groundHeightAt: () => 0,
  })
}

test('stopped NPC states clear stale speed and unwind their turn lean', () => {
  for (const state of ['action', 'stagger', 'captive'] as const) {
    const value = actor({
      action: state === 'action' ? { phase: 'windup' } : null,
      reaction: state === 'stagger' ? 'stagger' : 'none',
      aiMode: state === 'captive' ? 'captive' : 'normal',
    })
    const engine = actorEngine(value)
    invoke<void>(engine, 'updateActors', 1 / 60)

    assert.deepEqual((value.velocity as THREE.Vector3).toArray(), [0, 0, 0], state)
    assert.equal(value.visualSpeed, 0, `${state}: stopped speed must not revive the gait`)
    assert.ok((value.motionBlend as number) < 1, `${state}: gait blend did not settle`)
    assert.ok((value.stride as number) < 0.6, `${state}: stride did not settle`)
    assert.ok((value.turnLean as number) < 0.5, `${state}: stale cornering lean stayed frozen`)
  }
})

test('a steered NPC faces its actual travel instead of sliding sideways', () => {
  const value = actor({ velocity: new THREE.Vector3(), stride: 0, visualSpeed: 0, motionBlend: 0, turnLean: 0 })
  const engine = Object.assign(actorEngine(value), {
    moveCharacter(position: THREE.Vector3, movementX: number, movementZ: number): boolean {
      if (Math.abs(movementX) < 0.05) return true
      position.x += movementX
      position.z += movementZ
      return false
    },
  })

  invoke<void>(engine, 'updateActors', 0.25)
  const mesh = value.mesh as THREE.Group
  const travelYaw = Math.atan2(mesh.position.x, mesh.position.z)
  const facingError = Math.abs(Math.atan2(
    Math.sin(mesh.rotation.y - travelYaw),
    Math.cos(mesh.rotation.y - travelYaw),
  ))

  assert.ok(Math.abs(travelYaw) > 0.4, 'fixture did not force an avoidance step')
  assert.ok(
    facingError < 0.1,
    `actor travelled at ${travelYaw.toFixed(3)} rad but faced ${mesh.rotation.y.toFixed(3)}`,
  )
})

test('finale movement also faces the avoidance step it actually took', () => {
  const value = actor({ velocity: new THREE.Vector3(), stride: 0 })
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    collisionProbe: new THREE.Vector3(),
    getNavigationWaypoint: () => null,
    groundHeightAt: () => 0,
    moveCharacter(position: THREE.Vector3, movementX: number, movementZ: number): boolean {
      if (Math.abs(movementX) < 0.05) return true
      position.x += movementX
      position.z += movementZ
      return false
    },
  })

  const travelled = invoke<number>(engine, 'moveFinaleActor', value, { x: 0, z: 5 }, 1)
  const mesh = value.mesh as THREE.Group
  const travelYaw = Math.atan2(mesh.position.x, mesh.position.z)
  assert.ok(travelled > 0.9)
  assert.ok(Math.abs(travelYaw) > 0.4, 'fixture did not force an avoidance step')
  assert.ok(Math.abs(mesh.rotation.y - travelYaw) < 1e-12)
})

test('the shared pose resets player torso pitch while the actor pass restores NPC lean', () => {
  const p = resolveCharacterPlan('villain', 'soldier', 0, false).proportions
  const skeleton = buildCharacterSkeleton(p)
  skeleton.root.userData.rig = {
    torsoPivot: skeleton.torsoPivot,
    leftArm: null,
    rightArm: null,
    leftElbow: null,
    rightElbow: null,
    leftLeg: null,
    rightLeg: null,
    leftKnee: null,
    rightKnee: null,
    weapon: null,
    cloak: null,
    waistY: skeleton.waistY,
    shoulderY: skeleton.shoulderY,
    upperArm: p.upperArm,
    forearm: p.forearm,
    elbowRest: p.elbowRest,
    armSplay: p.armSplay,
    legSplay: p.legSplay,
    mainHand: 1,
    beast: null,
    boundArms: false,
    lean: p.lean,
  }
  const pose = { stride: 0, attack: 0, anticipation: 0, recovery: 0, flinch: 0, stagger: 0 }
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    elapsed: 0,
    ambientStormHunch: 0,
    scratchPose: { ...pose },
    finale: { identity: { bossId: 'finale-boss', profile: 'marshal' }, action: null },
  })

  for (let frame = 0; frame < 4; frame += 1) {
    skeleton.torsoPivot.rotation.x += 0.2
    invoke<void>(engine, 'animateCharacter', skeleton.root, pose)
    assert.equal(skeleton.torsoPivot.rotation.x, 0, `frame ${frame}: evade pitch accumulated`)
  }

  const value = actor({
    allegiance: 'villain',
    mesh: skeleton.root,
    stride: 0,
    velocity: new THREE.Vector3(),
    visualSpeed: 0,
    motionBlend: 0,
    turnLean: 0,
  })
  invoke<void>(engine, 'animateActorCharacter', value, 1 / 60, 0)
  assert.ok(Math.abs(skeleton.torsoPivot.rotation.x - p.lean) < 1e-12)
})

test('storm posture replaces authored resting lean instead of stacking on top of it', () => {
  const engine = Object.assign(Object.create(GameEngine.prototype), { ambientStormHunch: 0 })
  const fullStorm = weatherHunch(1)
  const authoredLeans = [-0.04, 0, 0.09, 0.13, 0.2]

  for (const fraction of [0, 0.25, 0.5, 1]) {
    Reflect.set(engine, 'ambientStormHunch', weatherHunch(fraction))
    for (const lean of authoredLeans) {
      const actual = invoke<number>(engine, 'actorRestingLean', { lean })
      const expected = THREE.MathUtils.lerp(lean, Math.max(lean, fullStorm), fraction)
      assert.ok(
        Math.abs(actual - expected) < 1e-12,
        `lean ${lean}, storm ${fraction}: ${actual} !== ${expected}`,
      )
    }
  }

  const oldScoutRest = 0.09 + fullStorm
  const scoutRest = invoke<number>(engine, 'actorRestingLean', { lean: 0.09 })
  assert.equal(scoutRest, fullStorm)
  assert.ok(scoutRest < oldScoutRest - 0.08, 'full storm still stacked both resting poses')
})

test('walking hips settle toward the planted foot and breathing leaves feet planted', () => {
  const movingRoles = characterRoles().filter((role) => role !== 'commander' && role !== 'captive')
  let poses = 0

  for (const faction of ['elf', 'guard', 'villain'] as const) {
    for (const role of movingRoles) {
      const p = resolveCharacterPlan(faction, role, 0, false).proportions
      const skeleton = buildCharacterSkeleton(p)
      const feet: THREE.Object3D[] = []
      const limbs: Record<string, THREE.Object3D> = {}
      for (const [name, side] of [['leftLeg', -1], ['rightLeg', 1]] as const) {
        const leg = new THREE.Group()
        leg.name = name
        leg.position.set(side * p.hipX, p.hipY, 0)
        leg.rotation.z = side * p.legSplay
        const knee = new THREE.Group()
        knee.name = name === 'leftLeg' ? 'leftKnee' : 'rightKnee'
        knee.position.y = -p.thigh
        const foot = new THREE.Object3D()
        foot.position.y = -p.shin
        knee.add(foot)
        leg.add(knee)
        skeleton.pelvisPivot.add(leg)
        limbs[name] = leg
        limbs[knee.name] = knee
        feet.push(foot)
      }
      skeleton.root.userData.rig = {
        torsoPivot: skeleton.torsoPivot,
        leftArm: null,
        rightArm: null,
        leftElbow: null,
        rightElbow: null,
        leftLeg: limbs.leftLeg,
        rightLeg: limbs.rightLeg,
        leftKnee: limbs.leftKnee,
        rightKnee: limbs.rightKnee,
        weapon: null,
        cloak: null,
        waistY: skeleton.waistY,
        shoulderY: skeleton.shoulderY,
        upperArm: p.upperArm,
        forearm: p.forearm,
        elbowRest: p.elbowRest,
        armSplay: p.armSplay,
        legSplay: p.legSplay,
        mainHand: 1,
        beast: null,
        boundArms: false,
        lean: p.lean,
      }
      const value = actor({
        allegiance: faction,
        role,
        mesh: skeleton.root,
        velocity: new THREE.Vector3(),
        stride: 0,
        motionBlend: 1,
        turnLean: 0,
      })
      const engine = Object.assign(Object.create(GameEngine.prototype), {
        elapsed: Math.PI / (2 * 1.75),
        ambientStormHunch: 0,
        scratchPose: { stride: 0, attack: 0, anticipation: 0, recovery: 0, flinch: 0, stagger: 0 },
        finale: { identity: { bossId: 'finale-boss', profile: 'marshal' }, action: null },
      })
      const lowestFoot = (): number => {
        skeleton.root.updateMatrixWorld(true)
        return Math.min(...feet.map((foot) => foot.getWorldPosition(new THREE.Vector3()).y))
      }

      invoke<void>(engine, 'animateActorCharacter', value, 1 / 60, 0)
      const inhalingRest = lowestFoot()
      Reflect.set(engine, 'elapsed', 3 * Math.PI / (2 * 1.75))
      invoke<void>(engine, 'animateActorCharacter', value, 1 / 60, 0)
      const exhalingRest = lowestFoot()
      assert.ok(
        Math.abs(inhalingRest - exhalingRest) < 1e-12,
        `${faction}/${role}: breathing moved the feet through the ground`,
      )

      for (const stride of [-0.62, -0.465, -0.31, -0.155, 0, 0.155, 0.31, 0.465, 0.62]) {
        Reflect.set(value, 'stride', stride)
        invoke<void>(engine, 'animateActorCharacter', value, 1 / 60, 0)
        const footRise = lowestFoot() - exhalingRest
        poses += 1
        assert.ok(
          footRise >= -0.01,
          `${faction}/${role} stride ${stride}: hips drove a foot ${(-footRise).toFixed(4)} underground`,
        )
        assert.ok(
          footRise <= 0.07,
          `${faction}/${role} stride ${stride}: planted foot rose ${footRise.toFixed(4)}`,
        )
      }
    }
  }

  assert.equal(poses, 189)
})

test('a committed boar charge stops at a blocker instead of steering around it', () => {
  const value = actor({
    role: 'boar',
    allegiance: 'beast',
    chargeTimer: 0.5,
    stride: 0,
    motionBlend: 0,
    visualSpeed: 0,
  })
  let steeringCalls = 0
  let collisionCalls = 0
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    collisionProbe: new THREE.Vector3(),
    moveActorWithSteering() {
      steeringCalls += 1
      return 1
    },
    moveCharacter(position: THREE.Vector3): boolean {
      collisionCalls += 1
      position.x += 0.5
      return true
    },
    groundHeightAt: () => 0,
    animateActorCharacter() {},
    resolveBoarChargeContact() {},
  })

  assert.equal(invoke<boolean>(engine, 'updateBeastCharge', value, 1 / 60), true)
  assert.equal(collisionCalls, 1)
  assert.equal(steeringCalls, 0)
  assert.deepEqual((value.mesh as THREE.Group).position.toArray(), [0, 0, 0])
  assert.equal(value.chargeTimer, 0)
  assert.ok((value.chargeCooldown as number) > 0)
})
