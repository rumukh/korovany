import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import * as THREE from 'three'
import {
  BEAST_KINDS, GeometryCache, StylizedArtLibrary, creaturePresenter, validateArtGeometry,
  type CreaturePresenter,
  type WagonPresenter, wagonPresenter,
} from '../src/game/art/index.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

interface CreatureFactory {
  createBeast(role: typeof BEAST_KINDS[number]): THREE.Group
  createDeer(): THREE.Group
  createBird(): THREE.Group
  createCaravan(gilded?: boolean): THREE.Group
}

function fixture() {
  const art = new StylizedArtLibrary({ enhanced: true, ink: {
    player: 0x282828, enemy: 0x282828, interactable: 0x282828, landmark: 0x282828,
  } })
  const cache = new GeometryCache(), presenters = new Set<CreaturePresenter>()
  const engine: CreatureFactory = Object.assign(Object.create(GameEngine.prototype), {
    artLibrary: art, artGeometry: cache, creaturePresenters: presenters, wagonPresenters: new Set<WagonPresenter>(),
    visualPolicy: resolveVisualPolicy({ visualMode: 'enhanced' }),
    palette: { warning: new THREE.Color(0xfbbf24), bg: new THREE.Color(0x302d29), text: new THREE.Color(0xdedede),
      surface: new THREE.Color(0x45413c), borderStrong: new THREE.Color(0x605e5a) },
  })
  return { engine, art, cache, presenters, dispose() {
    for (const p of presenters) p.dispose()
    art.dispose(); cache.dispose()
  } }
}

test('the real beast population has articulated feet and one compatible body submission', () => {
  const f = fixture()
  for (const kind of BEAST_KINDS) {
    const root = f.engine.createBeast(kind)
    const p = creaturePresenter(root)
    assert.ok(p)
    assert.equal(p.source.geometry.groups.length, 0)
    assert.equal(p.legs.length, 4)
    assert.ok(p.skeleton.bones.length <= 64)
    validateArtGeometry(p.source)
    assert.equal(root.getObjectByName('head-pivot')!.parent!.name, 'neck-pivot')
    for (const name of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'leftElbow', 'rightElbow', 'leftKnee', 'rightKnee']) {
      assert.ok(root.getObjectByName(name), `${kind}:${name}`)
    }
    const outline = f.art.applyOutline(root, 'structural')
    assert.equal(outline.shells.length, 1)
    const shell = outline.shells[0]
    assert.ok(shell instanceof THREE.SkinnedMesh)
    assert.equal(shell.skeleton, p.skeleton)
    const original = p.source.geometry.index!.count
    p.hideLimb('leftArm')
    p.hideLimb('rightLeg')
    assert.ok(p.source.geometry.index!.count < original)
    assert.equal(shell.geometry, p.source.geometry)
    f.art.releaseOutline(outline)
  }
  f.dispose()
})

test('beast hoof planting preserves roots and leaves upright troll hands out of ground IK', () => {
  const f = fixture()
  let states = 0
  for (const kind of BEAST_KINDS) {
    const root = f.engine.createBeast(kind), p = creaturePresenter(root)!
    for (const stride of [-0.6, -0.2, 0, 0.2, 0.6]) for (const slope of [-0.1, 0, 0.1]) {
      root.position.set(2, 0.4, -3)
      root.rotation.y = 0.6
      for (const leg of p.legs) {
        leg.upper.scale.y = 0.97
        leg.upper.rotation.set(stride * leg.side, 0.08, leg.side * 0.025)
      }
      const before = root.matrix.clone()
      const originalPosition = root.position.toArray()
      const originalRotation = root.quaternion.toArray()
      const armPose = p.legs[0].upper.quaternion.clone()
      p.poseFeet(1 / 60, stride, (x, z) => 0.4 + (x - 2) * slope + (z + 3) * -slope * 0.5)
      root.updateMatrixWorld(true)
      assert.deepEqual(root.position.toArray(), originalPosition)
      assert.deepEqual(root.quaternion.toArray(), originalRotation)
      for (const leg of p.legs) {
        assert.ok(leg.knee.rotation.x >= 0)
        assert.ok(leg.knee.rotation.x < 2.56)
      }
      if (kind === 'troll') assert.deepEqual(p.legs[0].upper.quaternion.toArray(), armPose.toArray())
      assert.ok(before.elements.every(Number.isFinite))
      states++
    }
  }
  assert.equal(states, 60)
  f.dispose()
})

test('real deer and birds use independent leg and wing joints without changing their roots', () => {
  const f = fixture()
  const deer = f.engine.createDeer(), bird = f.engine.createBird()
  const dp = creaturePresenter(deer)!, bp = creaturePresenter(bird)!
  assert.equal(dp.legs.length, 4)
  assert.ok(bp.wings)
  assert.equal(dp.source.geometry.groups.length, 0)
  assert.equal(bp.source.geometry.groups.length, 0)
  for (const panic of [false, true]) for (const time of [0.03, 0.14, 0.31, 0.62]) {
    dp.poseWildlife(time, panic, 1 / 60, () => 0)
    bp.poseWildlife(time, panic, 1 / 60, () => 0)
    assert.equal(bp.wings[0].rotation.z, -bp.wings[1].rotation.z)
    assert.notEqual(dp.legs[0].upper.rotation.x, dp.legs[1].upper.rotation.x)
    assert.deepEqual(deer.position.toArray(), [0, 0, 0])
    assert.deepEqual(bird.position.toArray(), [0, 0, 0])
  }
  validateArtGeometry(dp.source); validateArtGeometry(bp.source)
  assert.throws(() => dp.poseFeet(1 / 60, 0, () => NaN), /non-finite/)
  f.dispose()
})

test('production plain and gilded wagons retain cargo and roll each wheel by its own actual radius', () => {
  const f = fixture()
  for (const gilded of [false, true]) {
    const root = f.engine.createCaravan(gilded)
    const wagon = wagonPresenter(root)!
    assert.ok(wagon)
    const cargo = root.getObjectByName('cargo')
    assert.ok(cargo instanceof THREE.Mesh, 'robbery still addresses its own material and mesh')
    assert.equal(root.getObjectsByProperty('name', 'draft-ox').length, 2)
    for (const ox of root.getObjectsByProperty('name', 'draft-ox')) {
      assert.equal(creaturePresenter(ox)?.legs.length, 4, 'draft animals have working limbs, not legs baked into a body')
    }
    const positions = root.position.toArray(), rotation = root.quaternion.toArray()
    const wheels = root.getObjectsByProperty('name', 'wheel')
    wagon.update(0.1, 0.3, () => 0)
    for (const wheel of wheels) {
      assert.ok(Math.abs(wheel.rotation.z + 0.3 / Number(wheel.userData.wheelRadius)) < 1e-12)
    }
    const phases = wheels.map((wheel) => wheel.rotation.z)
    wagon.update(0.1, 0, () => 0)
    assert.deepEqual(wheels.map((wheel) => wheel.rotation.z), phases, 'blocked or stopped wheels do not keep spinning')
    assert.deepEqual(root.position.toArray(), positions)
    assert.deepEqual(root.quaternion.toArray(), rotation)
    cargo.scale.y = 0.35
    wagon.update(0.05, 0, () => 0)
    assert.equal(cargo.scale.y, 0.35, 'the visual controller cannot replenish robbed cargo')
    assert.ok(cargo.position.y < 2.45)
    for (const name of ['left-trace', 'right-trace']) {
      const trace = root.getObjectByName(name)!
      assert.ok(trace.scale.x > 2 && trace.scale.x < 5)
      assert.ok(trace.matrix.elements.every(Number.isFinite))
    }
    assert.deepEqual(root.position.toArray(), positions)
    wagon.dispose()
    assert.throws(() => wagon.update(0.1, 0, () => 0), /disposed/)
  }
  f.dispose()
})
