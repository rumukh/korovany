import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import * as THREE from 'three'
import {
  GeometryCache, StylizedArtLibrary, characterPresenter, type CharacterPresenter,
  type CharacterAppearance, type CharacterContact,
} from '../src/game/art/index.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import { sumVisualAllocationReceipts } from '../src/game/diagnostics/VisualBudgetAccounting.ts'

const loader = registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
} })
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

function fixture(quality: 'high' | 'balanced' | 'low' = 'balanced') {
  const art = new StylizedArtLibrary({ enhanced: true, ink: {
    player: 0x282828, enemy: 0x282828, interactable: 0x282828, landmark: 0x282828,
  } })
  const cache = new GeometryCache()
  const engine: {
    elapsed: number
    createCharacter(faction: 'elf', player: boolean): THREE.Group
    animateCharacter(root: THREE.Group, pose: {
      stride: number; attack: number; anticipation: number; recovery: number; flinch: number; stagger: number
    }): void
  } =
    Object.assign(Object.create(GameEngine.prototype), {
      visualPolicy: resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: quality }),
      artLibrary: art, artGeometry: cache, characterPresenters: new Set(),
      palette: { link: new THREE.Color(0x4da6ff) },
      handOffset: new THREE.Vector3(), elapsed: 0,
    })
  const p = characterPresenter(engine.createCharacter('elf', true))!
  const source = p.root.getObjectByName('weapon-head')
  assert.ok(source instanceof THREE.SkinnedMesh)
  return { p, source, art, cache, engine, dispose() {
    p.dispose()
    assert.equal(art.getRenderBindingStats().sources, 0)
    assert.equal(cache.size, 0)
    art.dispose(); cache.dispose()
  } }
}

function nockVertex(source: THREE.SkinnedMesh): number {
  const position = source.geometry.getAttribute('position')
  const weights = source.geometry.getAttribute('skinWeight')
  for (let i = 0; i < position.count; i++) {
    if (weights.getY(i) === 1 && Math.abs(position.getX(i) - 0.02) < 1e-6 &&
        Math.abs(position.getY(i)) < 1e-6 && Math.abs(position.getZ(i) + 0.23) < 1e-6) return i
  }
  throw new Error('Actual ready arrow has no nock-cap center vertex')
}

function transform(node: THREE.Object3D) {
  return {
    position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(),
    matrix: node.matrix.toArray(), matrixAutoUpdate: node.matrixAutoUpdate, visible: node.visible,
  }
}

function checkHeld(p: CharacterPresenter, source: THREE.SkinnedMesh, origin: THREE.Vector3, direction: THREE.Vector3) {
  p.root.updateMatrixWorld(true)
  const actualNock = source.getVertexPosition(nockVertex(source), new THREE.Vector3()).applyMatrix4(source.matrixWorld)
  assert.ok(actualNock.distanceTo(origin) < 1e-6, `actual nock misses gameplay origin by ${actualNock.distanceTo(origin)}`)
  const weapon = p.rig.weapon!
  const forward = new THREE.Vector3(0, 0, 1).transformDirection(weapon.matrixWorld)
  assert.ok(forward.distanceTo(direction) < 1e-10)
  for (const side of [-1, 1]) {
    const arm = side > 0 ? p.rig.rightArm! : p.rig.leftArm!
    if (!arm.visible) continue
    const hand = p.hands[side > 0 ? 1 : 0]
    assert.ok(new THREE.Vector3().setFromMatrixPosition(hand.matrix).distanceTo(hand.position) < 1e-6,
      'hand matrix must not hide an unreachable arm by moving its wrist away from the forearm end')
    const expectedFrame = weapon.matrixWorld.clone()
    if (side !== p.rig.mainHand) expectedFrame.setPosition(origin)
    const bone = p.skeleton.bones.indexOf(hand)
    const skin = p.body.geometry.getAttribute('skinIndex'), positions = p.body.geometry.getAttribute('position')
    let checked = 0
    for (let i = 0; i < p.body.geometry.index!.count; i++) {
      const vertex = p.body.geometry.index!.getX(i)
      if (skin.getX(vertex) !== bone) continue
      const expected = new THREE.Vector3().fromBufferAttribute(positions, vertex)
        .applyMatrix4(p.skeleton.boneInverses[bone]).applyMatrix4(expectedFrame)
      const actual = p.body.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(p.body.matrixWorld)
      assert.ok(actual.distanceTo(expected) < 1e-5, 'actual finger vertices must surround the aimed grip/string frame')
      checked++
    }
    assert.ok(checked > 0)
  }
}

test('actual elf hero holds the supplied world nock and flight direction through posed affine parents', () => {
  const f = fixture(), { p, source } = f
  p.root.position.set(3, 1.2, -7)
  p.setBowAiming(true)
  const origin = new THREE.Vector3(), direction = new THREE.Vector3()
  let cases = 0
  for (const rootYaw of [-1.1, 0.8]) for (const chest of [-1, 1]) for (const pitch of [-0.7, 0, 0.7]) {
    for (const yaw of [-0.3, 0, 0.3]) for (const scale of [0.97, 1.03]) {
      p.root.rotation.set(0, rootYaw, 0)
      p.anatomy.bodyPivot.scale.set(1.02, scale, 0.98)
      p.anatomy.torsoPivot.rotation.set(chest * 0.12, chest * 0.1, chest * 0.08)
      p.anatomy.torsoPivot.scale.set(1.04, 0.99, 1.01)
      p.rig.leftArm!.scale.set(1.01, 1.02, 0.98)
      p.rig.rightArm!.scale.set(0.98, 1.02, 1.03)
      p.rig.leftElbow!.scale.y = 1.01
      p.rig.rightElbow!.scale.y = 0.99
      p.root.updateMatrixWorld(true)
      origin.set(-0.25, 2.05, 0.4).applyAxisAngle(THREE.Object3D.DEFAULT_UP, rootYaw).add(p.root.position)
      direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
        .applyAxisAngle(THREE.Object3D.DEFAULT_UP, rootYaw)
      const root = transform(p.root), body = transform(p.anatomy.bodyPivot), torso = transform(p.anatomy.torsoPivot)
      const armScales = [p.rig.leftArm!.scale.toArray(), p.rig.rightArm!.scale.toArray()]
      p.poseBowAim(origin, direction)
      checkHeld(p, source, origin, direction)
      assert.deepEqual(transform(p.root), root)
      assert.deepEqual(transform(p.anatomy.bodyPivot), body)
      assert.deepEqual(transform(p.anatomy.torsoPivot), torso)
      assert.deepEqual([p.rig.leftArm!.scale.toArray(), p.rig.rightArm!.scale.toArray()], armScales)
      const aimed = transform(p.rig.weapon!)
      p.poseArrowRecovery(); p.poseSupport(0)
      assert.deepEqual(transform(p.rig.weapon!), aimed, 'legacy presentation must not double-pose held aim')
      p.advanceActionPresentation(0, false)
      p.poseBowAim(origin, direction)
      checkHeld(p, source, origin, direction)
      cases++
    }
  }
  assert.equal(cases, 72)
  f.dispose()
})

test('bow nock semantics are identical in every quality and the vertical frame stays finite', () => {
  for (const quality of ['high', 'balanced', 'low'] as const) {
    const f = fixture(quality), { p, source } = f
    p.setBowAiming(true)
    const origin = new THREE.Vector3(-0.25, 2.05, 0.35)
    const directions = [
      new THREE.Vector3(0, -0.65, 1).normalize(), new THREE.Vector3(0, 0.65, 1).normalize(),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    ]
    for (const direction of directions) {
      p.poseBowAim(origin, direction)
      checkHeld(p, source, origin, direction)
      assert.ok(p.rig.weapon!.matrix.elements.every(Number.isFinite))
    }
    f.dispose()
  }
})

test('approved canonical muzzle fits full pitch envelope after actual gait and terrain grounding', () => {
  let cases = 0
  for (const missing of [null, 'leftArm', 'rightArm'] as const) {
    const f = fixture(), { p, source, engine } = f
    p.root.position.set(5, 2, -3)
    p.root.rotation.y = 0.7
    if (missing) p.setAppearance({ [missing]: 'missing' })
    p.setBowAiming(true)
    const indices = p.body.geometry.index!.array.slice()
    for (const slope of [-1, 1]) for (const stride of [-0.62, 0, 0.62]) for (const breathing of [-0.018, 0.018]) {
      const height = (x: number, z: number) => 2 + (x - 5) * slope * 0.25 + (z + 3) * slope * 0.18
      for (let frame = 0; frame < 12; frame++) {
        engine.elapsed = frame / 60
        engine.animateCharacter(p.root, { stride, attack: 0, anticipation: 0, recovery: 0, flinch: 0, stagger: 0 })
        p.anatomy.torsoPivot.rotation.set(0, 0, 0)
        p.anatomy.torsoPivot.scale.y = 1 + breathing * 0.55
        p.secondaryMotion(1 / 60, stride, 0, false)
        p.ground(1 / 60, height, true, 0, stride)
      }
      for (const pitch of [-1.2, -0.6, 0, 0.6, 1.2]) for (const yaw of [-0.27, 0, 0.27]) {
        for (const closeFactor of [0, 0.5, 1]) {
          const origin = new THREE.Vector3((missing === 'leftArm' ? 0.25 : -0.25) * closeFactor, 2.05, 0.35 * closeFactor)
            .applyAxisAngle(THREE.Object3D.DEFAULT_UP, p.root.rotation.y).add(p.root.position)
          const direction = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
            .applyAxisAngle(THREE.Object3D.DEFAULT_UP, p.root.rotation.y)
          p.root.updateMatrixWorld(true)
          const root = transform(p.root), pelvis = transform(p.anatomy.bodyPivot)
          const legs = [p.rig.leftLeg!, p.rig.rightLeg!, ...p.feet].map(transform)
          p.poseBowAim(origin, direction)
          checkHeld(p, source, origin, direction)
          const string = source.skeleton.bones.find((bone) => bone.name === 'bow-string-bone')!
          assert.ok(string.position.z <= -0.08 && string.position.z >= -0.3)
          if (Math.abs(pitch) === 1.2 && closeFactor === 1) {
            p.beginArrowPresentation(direction, direction.y)
            p.advanceActionPresentation(0.175, false)
            p.poseBowAim(origin, direction)
            assert.equal(string.position.z, 0)
            p.advanceActionPresentation(0.18, false)
            p.poseBowAim(origin, direction)
            checkHeld(p, source, origin, direction)
          }
          assert.deepEqual(transform(p.root), root)
          assert.deepEqual(transform(p.anatomy.bodyPivot), pelvis)
          assert.deepEqual([p.rig.leftLeg!, p.rig.rightLeg!, ...p.feet].map(transform), legs)
          assert.deepEqual(p.body.geometry.index!.array, indices)
          cases++
        }
      }
    }
    f.dispose()
  }
  assert.equal(cases, 1620)
})

test('held shot releases once, recoils, rearms while held and immediately exits without moving the root', () => {
  const f = fixture(), { p, source, art } = f
  const weapon = p.rig.weapon!, shield = p.root.getObjectByName('shield')!
  const originalShield = transform(shield)
  const skeleton = source.skeleton
  const originalWeapon = source.geometry
  const torch = new THREE.Group(), trail = new THREE.Group()
  weapon.add(torch, trail)
  const outlines = art.applyOutline(p.root, 'structural')
  const shell = outlines.shells.find((s) => s.parent === source)!
  const binding = art.getRenderSourceBinding(source)!
  art.setSourceVisibility(binding, 0.4)
  const origin = new THREE.Vector3(-0.25, 2.05, 0.4), direction = new THREE.Vector3(0, 0, 1)
  p.setBowAiming(true)
  p.poseBowAim(origin, direction)
  p.root.updateMatrixWorld(true)
  const root = transform(p.root)
  const originalGrip = weapon.getWorldPosition(new THREE.Vector3())
  assert.equal(p.bowAimingActive, true)
  assert.equal(p.weaponKind, 'bow')
  assert.ok(shield.position.z < 0 && shield.visible)
  assert.notEqual(source.geometry, originalWeapon)
  const readyCount = source.geometry.getAttribute('position').count
  p.setBowAiming(true)
  assert.equal(source.geometry.getAttribute('position').count, readyCount)
  p.beginArrowPresentation(direction, 0)
  const released = source.geometry
  assert.ok(released.getAttribute('position').count < readyCount)
  assert.throws(() => nockVertex(source), /no nock/)
  p.poseBowAim(origin, direction)
  assert.ok(weapon.getWorldPosition(new THREE.Vector3()).distanceTo(originalGrip) < 1e-10,
    'release moves the string, not the whole bow by the draw distance')
  const releasedFrame = transform(weapon)
  p.advanceActionPresentation(0, false)
  p.poseBowAim(origin, direction)
  assert.deepEqual(transform(weapon), releasedFrame, 'zero delta cannot advance recoil')
  p.advanceActionPresentation(0.175, false)
  p.poseBowAim(origin, direction)
  const recoiled = weapon.getWorldPosition(new THREE.Vector3())
  assert.ok(Math.abs(recoiled.distanceTo(originalGrip) - 0.045) < 1e-10, 'actual grip recoil has a measured bound')
  assert.equal(source.geometry, released)
  p.advanceActionPresentation(0.18, false)
  p.poseBowAim(origin, direction)
  assert.equal(p.arrowPresentationActive, false)
  assert.equal(p.weaponKind, 'bow')
  assert.equal(source.geometry.getAttribute('position').count, readyCount)
  checkHeld(p, source, origin, direction)
  assert.equal(source.skeleton, skeleton)
  assert.equal(shell.geometry, source.geometry)
  assert.ok(Math.abs(art.getSourceVisibility(binding) - 0.4) < 1e-6)
  p.beginArrowPresentation(direction, 0)
  p.setBowAiming(false)
  assert.equal(p.bowAimingActive, false)
  assert.equal(p.arrowPresentationActive, false)
  assert.equal(p.weaponKind, 'sabre')
  assert.deepEqual(transform(p.root), root)
  assert.equal(weapon.matrixAutoUpdate, true)
  assert.deepEqual(transform(shield), originalShield)
  assert.equal(torch.parent, weapon); assert.equal(trail.parent, weapon)
  p.poseBowAim(new THREE.Vector3(NaN, 0, 0), direction)
  p.setBowAiming(true)
  p.advanceActionPresentation(0, true)
  assert.equal(p.bowAimingActive, false, 'interrupt cancels even a ready bow without a shot')
  assert.equal(p.weaponKind, 'sabre')
  assert.equal(sumVisualAllocationReceipts(p.allocationReceipts()).dynamicArt.gpuAllocatedBytes, null)
  art.releaseOutline(outlines)
  f.dispose()
})

test('aim uses the surviving arm, rejects both missing arms and never restores injured geometry', () => {
  for (const missing of ['leftArm', 'rightArm'] as const) {
    const f = fixture(), { p, source } = f
    const other = missing === 'leftArm' ? 'rightArm' : 'leftArm'
    p.setAppearance({ [missing]: 'missing', [other]: 'prosthetic', leftLeg: 'wounded' } satisfies CharacterAppearance)
    const indices = p.body.geometry.index!.array.slice()
    p.setBowAiming(true)
    assert.equal(p.rig.mainHand, missing === 'leftArm' ? 1 : -1)
    const origin = new THREE.Vector3(missing === 'leftArm' ? 0.25 : -0.25, 2.05, 0.4)
    const direction = new THREE.Vector3(0, -0.2, 1).normalize()
    p.poseBowAim(origin, direction)
    checkHeld(p, source, origin, direction)
    p.beginArrowPresentation(direction, direction.y)
    p.advanceActionPresentation(0.36, false)
    p.poseBowAim(origin, direction)
    checkHeld(p, source, origin, direction)
    assert.deepEqual(p.body.geometry.index!.array, indices)
    p.setAppearance({ [other]: 'missing' })
    assert.equal(p.bowAimingActive, false)
    assert.equal(p.arrowPresentationActive, false)
    assert.equal(p.rig.leftArm!.visible, false)
    assert.equal(p.rig.rightArm!.visible, false)
    assert.throws(() => p.setBowAiming(true), /surviving arm/)
    const contact: CharacterContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: 'skin' }
    assert.equal(p.sampleContact('weaponGrip', contact), false)
    f.dispose()
  }
})

test('invalid or unreachable aim is rejected before any hand/weapon pose is forced', () => {
  const f = fixture(), { p } = f
  p.setBowAiming(true)
  p.poseBowAim(new THREE.Vector3(-0.25, 2.05, 0.4), new THREE.Vector3(0, 0, 1))
  const nodes = [p.rig.weapon!, p.rig.leftArm!, p.rig.rightArm!, p.rig.leftElbow!, p.rig.rightElbow!, ...p.hands]
  const before = nodes.map(transform)
  for (const [origin, direction] of [
    [new THREE.Vector3(-0.25, 1.65, 0.65), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(50, 0, 0), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(NaN, 0, 0), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(), new THREE.Vector3()],
    [new THREE.Vector3(), new THREE.Vector3(0, 0, 2)],
  ]) {
    assert.throws(() => p.poseBowAim(origin, direction), /unreachable|finite world/)
    assert.deepEqual(nodes.map(transform), before)
  }
  assert.throws(() => p.advanceActionPresentation(-1, false), /timestep/)
  f.dispose()
})

test('repeated held/direct transitions preserve named sources and drain all geometry leases', () => {
  const f = fixture(), { p, source, cache } = f
  const joints = p.jointCount
  const origin = new THREE.Vector3(-0.25, 2.05, 0.4), direction = new THREE.Vector3(0, 0, 1)
  for (let i = 0; i < 24; i++) {
    p.setBowAiming(true)
    p.poseBowAim(origin, direction)
    p.beginArrowPresentation(direction, 0)
    p.advanceActionPresentation(0.36, false)
    p.poseBowAim(origin, direction)
    p.setBowAiming(false)
    p.beginArrowPresentation(direction, 0)
    p.advanceActionPresentation(0.36, false)
    assert.equal(p.weaponKind, 'sabre', 'direct shot compatibility still returns to melee')
    assert.equal(p.bowAimingActive, false)
    assert.equal(source, p.root.getObjectByName('weapon-head'))
    assert.equal(p.jointCount, joints)
    assert.ok(cache.size <= 4)
  }
  f.dispose()
  assert.throws(() => p.setBowAiming(true), /disposed/)
  assert.throws(() => p.poseBowAim(origin, direction), /disposed/)
})

test('steady held poses consume no RNG and entering during direct-shot recovery still exits to melee', (t) => {
  const f = fixture(), { p, source } = f
  const origin = new THREE.Vector3(-0.25, 2.05, 0.4), direction = new THREE.Vector3(0, 0, 1)
  p.beginArrowPresentation(direction, 0)
  p.setBowAiming(true)
  assert.equal(p.arrowPresentationActive, true)
  assert.throws(() => nockVertex(source), /no nock/)
  p.advanceActionPresentation(0.36, false)
  const random = t.mock.method(Math, 'random', () => { throw new Error('Steady bow pose must not consume RNG') })
  const originalOrigin = origin.toArray(), originalDirection = direction.toArray()
  for (let i = 0; i < 30; i++) {
    p.advanceActionPresentation(0, false)
    p.poseBowAim(origin, direction)
    p.poseSupport(0)
    p.poseArrowRecovery()
  }
  assert.deepEqual(origin.toArray(), originalOrigin)
  assert.deepEqual(direction.toArray(), originalDirection)
  random.mock.restore()
  p.setBowAiming(false)
  assert.equal(p.weaponKind, 'sabre')
  assert.equal(p.rig.weapon!.matrixAutoUpdate, true)
  assert.ok(p.root.getObjectByName('shield')!.position.z > 0)
  f.dispose()
})

test('aim transitions keep returned committed geometry alive and release thrown precommit leases', (t) => {
  const f = fixture(), { p, source, art, cache } = f
  const baseline = cache.size, before = source.geometry
  const replace = art.replaceRenderSourceGeometry.bind(art)
  const preparation = t.mock.method(art, 'replaceRenderSourceGeometry', () => { throw new Error('precommit probe') })
  assert.throws(() => p.setBowAiming(true), /precommit probe/)
  assert.equal(p.bowAimingActive, false)
  assert.equal(p.weaponKind, 'sabre')
  assert.equal(source.geometry, before)
  assert.equal(cache.size, baseline)
  preparation.mock.restore()
  const cleanup = t.mock.method(art, 'replaceRenderSourceGeometry', (...args: Parameters<typeof replace>) => {
    replace(...args)
    return { status: 'committed-with-errors', error: new Error('cleanup probe') } as const
  })
  assert.throws(() => p.setBowAiming(true), /cleanup probe/)
  assert.equal(p.bowAimingActive, true, 'returned committed state belongs to the active presenter despite cleanup error')
  assert.equal(p.weaponKind, 'bow')
  let disposed = false
  source.geometry.addEventListener('dispose', () => { disposed = true })
  p.poseBowAim(new THREE.Vector3(-0.25, 2.05, 0.4), new THREE.Vector3(0, 0, 1))
  assert.equal(disposed, false)
  assert.throws(() => p.setBowAiming(false), /cleanup probe/)
  assert.equal(p.bowAimingActive, false)
  assert.equal(p.weaponKind, 'sabre')
  cleanup.mock.restore()
  f.dispose()
})
