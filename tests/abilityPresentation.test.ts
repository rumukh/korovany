import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { BOW_RELEASE_SECONDS, bowReleaseProgress } from '../src/game/art/AbilityPresentation.ts'
import { GeometryCache, StylizedArtLibrary, resolveCharacterPlan } from '../src/game/art/index.ts'
import { createMeleePresentation } from '../src/game/art/MeleePresentation.ts'
import { ABILITY_INFO, createHealthyBody, type Faction } from '../src/game/types.ts'
import { createPlayerMeleeState } from '../src/game/world/CombatResolver.ts'
import { createCombatMasteryState } from '../src/game/world/CombatMastery.ts'

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

function fixture(faction: Faction) {
  const library = new StylizedArtLibrary({
    ink: { player: 0x18202b, enemy: 0x24181c, interactable: 0x272116, landmark: 0x172126 },
  })
  const cache = new GeometryCache()
  const melee = createPlayerMeleeState()
  const body = createHealthyBody()
  const mastery = createCombatMasteryState()
  const pose = { ...createMeleePresentation(), stride: 0, flinch: 0, stagger: 0 }
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    faction, artLibrary: library, artGeometry: cache, handOffset: new THREE.Vector3(),
    elapsed: 0, playerPose: pose, melee, body, combatMastery: mastery, honestMelee: true,
    cameraPitch: 0, cameraYaw: 0, abilityCooldown: 0, shieldActive: false,
    isSprinting: false, reducedMotion: false, activePlayerAttackKind: 'melee', attackAnimation: 0,
    playSound() {},
  })
  const player = invoke<THREE.Group>(engine, 'createCharacter', faction, true)
  engine.player = player
  const joint = (name: string) => {
    const part = player.getObjectByName(name)
    assert.ok(part, `production rig must contain ${name}`)
    return part
  }
  const draw = (stride = 0) => {
    invoke(engine, 'samplePlayerPose', stride)
    invoke(engine, 'animateCharacter', player, pose)
    player.updateMatrixWorld(true)
  }
  const hand = (side: 'left' | 'right') => joint(`${side}Elbow`).localToWorld(new THREE.Vector3(
    0, -resolveCharacterPlan(faction, 'player', 0, true).proportions.forearm, 0,
  ))
  return { engine, player, joint, melee, body, mastery, pose, library, cache, draw, hand,
    dispose: () => { cache.dispose(); library.dispose() } }
}

test('bow follow-through is bounded by the paid cooldown and adds no draw-time delay', () => {
  const max = ABILITY_INFO.elf.cooldownMax
  assert.equal(bowReleaseProgress(max, max), 0)
  assert.ok(Math.abs((bowReleaseProgress(max - 0.16, max) ?? 0) - 0.5) < 1e-10)
  assert.equal(bowReleaseProgress(max - BOW_RELEASE_SECONDS - 1e-8, max), null)
  for (const cooldown of [0, -1, Number.NaN, Infinity, max + 1]) {
    assert.equal(bowReleaseProgress(cooldown, max), null)
  }
})

test('the production elf equips the bow for release, tracks pitch, and returns to the melee weapon', () => {
  const value = fixture('elf')
  try {
    const bow = value.joint('ability-bow')
    const weapon = value.joint('weapon')
    const shield = value.joint('shield')
    const originalMelee = JSON.stringify(value.melee)
    const oldBody = JSON.stringify(value.body)
    const cacheSize = value.cache.size
    const materials = value.library.sharedMaterialCount
    value.draw()
    assert.equal(bow.visible, false)
    assert.equal(weapon.visible, true)
    value.engine.abilityCooldown = ABILITY_INFO.elf.cooldownMax
    for (const pitch of [-0.6, 0, 0.65]) {
      value.engine.cameraPitch = pitch
      value.draw(0.5)
      assert.equal(bow.visible, true)
      assert.equal(weapon.visible, false)
      assert.equal(shield.visible, false)
      const aim = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch))
      assert.ok(aim.dot(bow.getWorldDirection(new THREE.Vector3())) > 1 - 1e-8)
      const hand = value.hand('left')
      assert.ok(hand.distanceTo(bow.getWorldPosition(new THREE.Vector3())) < 1e-8)
    }
    value.engine.abilityCooldown = 0.2
    value.draw()
    assert.equal(bow.visible, false)
    assert.equal(weapon.visible, true)
    assert.equal(shield.visible, true)
    assert.equal(value.cache.size, cacheSize)
    assert.equal(value.library.sharedMaterialCount, materials)
    assert.equal(JSON.stringify(value.melee), originalMelee)
    assert.equal(JSON.stringify(value.body), oldBody)
  } finally {
    value.dispose()
  }
})

test('saved bow recovery renders identically and a new melee or evade takes visual priority', () => {
  const value = fixture('elf')
  try {
    value.engine.abilityCooldown = ABILITY_INFO.elf.cooldownMax - 0.1
    value.draw()
    const bow = value.joint('ability-bow')
    const rotation = value.joint('rightElbow').rotation.toArray()
    const hand = bow.position.toArray()
    value.engine.abilityCooldown = 0
    value.draw()
    value.engine.abilityCooldown = ABILITY_INFO.elf.cooldownMax - 0.1
    value.draw()
    assert.deepEqual(value.joint('rightElbow').rotation.toArray(), rotation)
    assert.deepEqual(bow.position.toArray(), hand)
    Object.assign(value.melee, { phase: 'windup', beat: 1, phaseRemaining: 0.1 })
    value.draw()
    assert.equal(bow.visible, false)
    assert.equal(value.joint('weapon').visible, true)
    Object.assign(value.melee, createPlayerMeleeState())
    value.mastery.evadeRemaining = 0.15
    value.draw()
    assert.equal(bow.visible, false)
  } finally {
    value.dispose()
  }
})

test('ability poses do not restore missing limbs and one-armed bow release uses the surviving hand', () => {
  const value = fixture('elf')
  try {
    value.body.leftArm = 'missing'
    value.joint('leftArm').visible = false
    value.engine.abilityCooldown = ABILITY_INFO.elf.cooldownMax
    value.draw()
    const bow = value.joint('ability-bow')
    assert.equal(value.joint('leftArm').visible, false)
    assert.equal(bow.visible, true)
    const hand = value.hand('right')
    assert.ok(hand.distanceTo(bow.getWorldPosition(new THREE.Vector3())) < 1e-8)
    value.body.rightArm = 'missing'
    value.joint('rightArm').visible = false
    value.draw()
    assert.equal(bow.visible, false)
    assert.equal(value.joint('rightArm').visible, false)
  } finally {
    value.dispose()
  }
})

test('guard braces the offhand through walking and attacking, keeping the shield on that hand', () => {
  const value = fixture('guard')
  try {
    value.engine.shieldActive = true
    const shield = value.joint('shield')
    const arm = value.joint('leftArm')
    for (const stride of [0, 0.62, -0.62]) {
      value.draw(stride)
      const expected = value.hand('left')
      const center = shield.getWorldPosition(new THREE.Vector3())
      assert.ok(expected.distanceTo(center) < 0.061, 'shield must remain held, not float ahead')
      assert.ok(arm.rotation.x < -1)
      assert.ok(value.joint('leftElbow').rotation.x > 1)
      assert.ok(shield.position.z > 0.6)
    }
    Object.assign(value.melee, { phase: 'windup', beat: 1, phaseRemaining: 0.04 })
    value.draw()
    assert.ok(arm.rotation.x < -1, 'the sword arm must not steal the shield arm pose')
    value.engine.shieldActive = false
    Object.assign(value.melee, createPlayerMeleeState())
    value.draw()
    assert.equal(arm.rotation.x, 0)
    assert.equal(shield.position.z, 0.08)
    value.engine.shieldActive = true
    value.draw(0.4)
    invoke(value.engine, 'dropShield')
    assert.equal(arm.rotation.x, 0, 'releasing guard must settle the arm even while paused')
    assert.equal(shield.position.z, 0.08)
    assert.equal(value.engine.abilityCooldown, ABILITY_INFO.guard.cooldownMax)
  } finally {
    value.dispose()
  }
})

test('bow geometry borrows the same cached parts and material across player constructions', () => {
  const value = fixture('elf')
  try {
    const second = invoke<THREE.Group>(value.engine, 'createCharacter', 'elf', true)
    const firstBow = value.joint('ability-bow')
    const secondBow = second.getObjectByName('ability-bow')
    assert.ok(secondBow)
    const firstParts = firstBow.children
    assert.equal(firstParts.length, 2)
    for (let i = 0; i < firstParts.length; i += 1) {
      const first = firstParts[i]
      const next: THREE.Object3D | undefined = secondBow.children[i]
      assert.ok(first instanceof THREE.Mesh && next instanceof THREE.Mesh)
      assert.equal(first.geometry, next.geometry)
      assert.equal(first.material, next.material)
      assert.equal(StylizedArtLibrary.isLibraryOwned(first.geometry), true)
      assert.equal(StylizedArtLibrary.isLibraryOwned(first.material), true)
    }
    assert.equal(firstBow.visible, false)
    assert.equal(secondBow.visible, false)
  } finally {
    value.dispose()
  }
})
