import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import * as THREE from 'three'
import {
  CHARACTER_FACTIONS, CHARACTER_VARIANTS, CHARACTER_PHYSICAL_PALETTE,
  GeometryCache, StylizedArtLibrary, createCharacterPresenter, illustratedCharacterPlan,
  resolveCharacterPlan, characterRoles, buildIllustratedHead, buildIllustratedHeadgear,
  selectCharacterVisualLevel, validateArtGeometry,
  buildIllustratedHand,
  type CharacterContact,
} from '../src/game/art/index.ts'
import { sumVisualAllocationReceipts } from '../src/game/diagnostics/VisualBudgetAccounting.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import { resolveVisualSubsystemAllocation } from '../src/game/visualBudget.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

function library() {
  return new StylizedArtLibrary({ enhanced: true, ink: {
    player: 0x282828, enemy: 0x282828, interactable: 0x282828, landmark: 0x282828,
  } })
}

test('enhanced adult heads have jaw, nose, visible face openings and dedicated skin', () => {
  for (const faction of CHARACTER_FACTIONS) {
    const head = buildIllustratedHead(faction, 'near')
    head.computeBoundingBox()
    assert.ok(head.boundingBox)
    const bounds = head.boundingBox
    assert.ok(bounds.max.y - bounds.min.y < 0.7, 'the head is not the old one-metre bulb')
    assert.ok(bounds.max.z > 0.23, 'the nose projects beyond the facial plane')
    const profile = head.getAttribute('position')
    const jaw = [], cheek = []
    for (let i = 0; i < profile.count; i++) {
      if (Math.abs(profile.getY(i) + 0.205) < 0.002) jaw.push(Math.abs(profile.getX(i)))
      if (Math.abs(profile.getY(i)) < 0.002) cheek.push(Math.abs(profile.getX(i)))
    }
    assert.ok(jaw.length && cheek.length)
    assert.ok(Math.max(...cheek) > Math.max(...jaw) * 1.2, 'the jaw narrows independently of the cheekbones')
    head.dispose()
  }
  for (const kind of ['hood', 'ragHood', 'boneMask', 'greathelm', 'nasal', 'hornedHelm'] as const) {
    const geometry = buildIllustratedHeadgear(kind, 'near')
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    mesh.updateMatrixWorld(true)
    for (const x of [-0.087, 0.087]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, 0.058, 1), new THREE.Vector3(0, 0, -1), 0, 0.83)
      assert.equal(ray.intersectObject(mesh).length, 0, `${kind} places a wall in front of the eye`)
    }
    geometry.dispose()
    mesh.material.dispose()
  }
  assert.equal(new Set(CHARACTER_PHYSICAL_PALETTE.skin).size, 4)
})

test('actual enhanced taxonomy builds one skinned body with named independent equipment', () => {
  const art = library()
  const cache = new GeometryCache()
  let count = 0
  for (const faction of CHARACTER_FACTIONS) {
    for (const role of [...characterRoles(), 'player']) {
      for (let variant = 0; variant < CHARACTER_VARIANTS; variant++) {
        const plan = illustratedCharacterPlan(resolveCharacterPlan(faction, role, variant, role === 'player'))
        const presenter = createCharacterPresenter(plan, art, cache, role === 'player')
        assert.equal(presenter.body.geometry.groups.length, 0, 'one body draw, not old material groups')
        assert.ok(presenter.jointCount <= 64)
        for (const source of presenter.sources) validateArtGeometry(source)
        assert.equal(presenter.root.getObjectByName('weapon')?.parent, presenter.anatomy.torsoPivot)
        assert.equal(presenter.root.getObjectByName('neck-pivot')?.parent, presenter.anatomy.torsoPivot)
        assert.equal(presenter.root.getObjectByName('head-pivot')?.parent, presenter.anatomy.neckPivot)
        for (const name of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'leftElbow', 'rightElbow', 'leftKnee', 'rightKnee']) {
          assert.ok(presenter.root.getObjectByName(name), name)
        }
        assert.ok(presenter.sources.length <= 3)
        const usage = sumVisualAllocationReceipts(presenter.allocationReceipts()).dynamicArt
        assert.ok(usage.cpuGeometryBytes > 0)
        assert.equal(usage.gpuAllocatedBytes, null, 'CPU receipts must not invent GPU measurements')
        presenter.dispose()
        presenter.dispose()
        assert.equal(art.getRenderBindingStats().sources, 0)
        assert.equal(cache.size, 0, 'removed rig must release every geometry receipt')
        count++
      }
    }
  }
  assert.equal(count, 90)
  cache.dispose()
  art.dispose()
})

test('logical missing limbs remove indices and prosthetics never mutate a shared neighbor', () => {
  const art = library()
  const cache = new GeometryCache()
  const plan = illustratedCharacterPlan(resolveCharacterPlan('guard', 'soldier', 0))
  const a = createCharacterPresenter(plan, art, cache, false)
  const b = createCharacterPresenter(plan, art, cache, false)
  assert.equal(a.body.geometry, b.body.geometry)
  const index = b.body.geometry.index!.array.slice()
  const colors = b.body.geometry.getAttribute('color').array.slice()
  const before = index.length
  a.setAppearance({ leftArm: 'missing', rightArm: 'prosthetic' })
  assert.ok(a.body.geometry.index!.count < before)
  assert.equal(a.rig.leftArm!.visible, false)
  assert.deepEqual(b.body.geometry.index!.array, index)
  assert.deepEqual(b.body.geometry.getAttribute('color').array, colors)
  assert.notEqual(a.body.geometry, b.body.geometry)
  a.setAppearance({ rightLeg: 'missing' })
  assert.equal(a.rig.leftArm!.visible, false)
  const contact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: 'skin' as const }
  assert.equal(a.sampleContact('leftArm', contact), false)
  assert.equal(a.sampleContact('rightArm', contact), true)
  assert.equal(contact.surface, 'metal')
  a.dispose(); b.dispose()
  assert.equal(cache.size, 0)
  art.dispose()
})

test('contact normals and grip positions follow full posed matrices, not rest pose', () => {
  const art = library()
  const cache = new GeometryCache()
  const presenter = createCharacterPresenter(illustratedCharacterPlan(resolveCharacterPlan('elf', 'archer', 0)), art, cache, true)
  const target = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: 'skin' as const }
  const expected = new THREE.Vector3()
  let states = 0
  for (const x of [-0.6, 0, 0.7]) for (const y of [-0.5, 0.2, 0.6]) for (const z of [-0.3, 0, 0.3]) {
    presenter.root.position.set(7, 2, -4)
    presenter.root.rotation.set(0.1, 1.2, 0.07)
    presenter.anatomy.bodyPivot.scale.set(1.05, 0.95, 0.97)
    presenter.anatomy.torsoPivot.scale.set(1.07, 1.01, 1)
    presenter.anatomy.torsoPivot.rotation.set(x, y, z)
    presenter.rig.leftArm!.rotation.set(x - 0.5, y, z)
    presenter.rig.leftElbow!.rotation.set(0.7, 0.1, -0.2)
    presenter.syncAttachments()
    presenter.root.updateMatrixWorld(true)
    expected.setFromMatrixPosition(presenter.hands[0].matrixWorld)
    const grip = new THREE.Vector3().setFromMatrixPosition(presenter.rig.weapon!.matrixWorld)
    assert.ok(grip.distanceTo(expected) < 1e-10)
    for (let i = 0; i < 16; i++) {
      assert.ok(Math.abs(presenter.hands[0].matrixWorld.elements[i] -
        presenter.rig.weapon!.matrixWorld.elements[i]) < 1e-10, 'the complete hand/handle frame agrees, including shear')
    }
    assert.ok(presenter.sampleContact('torso', target))
    const anchor = presenter.anchors.get('torso')!
    expected.copy(anchor.normal).applyMatrix3(new THREE.Matrix3().getNormalMatrix(anchor.node.matrixWorld)).normalize()
    assert.ok(target.normal.distanceTo(expected) < 1e-12)
    states++
  }
  assert.equal(states, 27)
  const localHand = buildIllustratedHand(-1)
  const handPositions = localHand.getAttribute('position')
  const boneIndex = presenter.skeleton.bones.indexOf(presenter.hands[0])
  const bodyIndices = presenter.body.geometry.getAttribute('skinIndex')
  let vertex = 0
  const actual = new THREE.Vector3()
  const triangles = presenter.body.geometry.index!
  for (let i = 0; i < triangles.count; i++) {
    const v = triangles.getX(i)
    if (bodyIndices.getX(v) !== boneIndex) continue
    expected.fromBufferAttribute(handPositions, vertex++).applyMatrix4(presenter.rig.weapon!.matrixWorld)
    presenter.body.getVertexPosition(v, actual).applyMatrix4(presenter.body.matrixWorld)
    assert.ok(actual.distanceTo(expected) < 1e-5, 'deformed finger vertices track the real handle, not only a named empty pivot')
  }
  assert.equal(vertex, handPositions.count)
  localHand.dispose()
  presenter.dispose(); art.dispose(); cache.dispose()
})

test('the real GameEngine factory and saved-body adapter use the enhanced production rig', () => {
  const art = library()
  const cache = new GeometryCache()
  const presenters = new Set<ReturnType<typeof createCharacterPresenter>>()
  interface FactoryProbe {
    player: THREE.Group
    body: { leftArm: 'missing'; rightArm: 'prosthetic'; leftLeg: 'healthy'; rightLeg: 'wounded' }
    createCharacter(faction: 'elf' | 'guard' | 'villain', player: boolean, role?: 'soldier', variant?: number): THREE.Group
    applySavedBodyAppearance(): void
    samplePlayerPose(stride: number): object
  }
  const engine: FactoryProbe = Object.assign(Object.create(GameEngine.prototype), {
    visualPolicy: resolveVisualPolicy({ visualMode: 'enhanced' }),
    artLibrary: art, artGeometry: cache, characterPresenters: presenters,
    palette: { success: new THREE.Color(0x4ade80), link: new THREE.Color(0x4da6ff), accent: new THREE.Color(0xfd8ea1) },
    body: { leftArm: 'missing', rightArm: 'prosthetic', leftLeg: 'healthy', rightLeg: 'wounded' },
  })
  for (const faction of CHARACTER_FACTIONS) {
    engine.player = engine.createCharacter(faction, true)
    engine.applySavedBodyAppearance()
    assert.ok(engine.player.getObjectByName('character-body-batch') instanceof THREE.SkinnedMesh)
    assert.equal(engine.player.getObjectByName('leftArm')!.visible, false)
    assert.equal(engine.player.getObjectByName('rightArm')!.visible, true)
    assert.equal(engine.body.leftArm, 'missing')
    const npc = engine.createCharacter(faction, false, 'soldier', 1)
    assert.ok(npc.getObjectByName('character-body-batch') instanceof THREE.SkinnedMesh)
    assert.ok(npc.getObjectByName('faction-ring'))
  }
  for (const p of presenters) p.dispose()
  art.dispose(); cache.dispose()
})

test('projected character LOD has two-sided hysteresis and stable hero priority', () => {
  assert.equal(selectCharacterVisualLevel('near', 0.12, false, 0.15), 'near')
  assert.equal(selectCharacterVisualLevel('mid', 0.14, false, 0.15), 'mid')
  assert.equal(selectCharacterVisualLevel('mid', 0.16, false, 0.15), 'near')
  assert.equal(selectCharacterVisualLevel('near', 0.1, false, 0.15), 'mid')
  assert.equal(selectCharacterVisualLevel('far', 0.055, false, 0.15), 'far')
  assert.equal(selectCharacterVisualLevel('mid', 0.055, false, 0.15), 'mid')
  assert.equal(selectCharacterVisualLevel('far', 0, true, 0.15), 'hero')
  assert.throws(() => selectCharacterVisualLevel('near', NaN, false, 0.15))
})

test('live LOD rebinding preserves limbs, complete ranged weapons, fade and borrowed ink', () => {
  const art = library(), cache = new GeometryCache()
  const presenter = createCharacterPresenter(illustratedCharacterPlan(resolveCharacterPlan('elf', 'archer', 1)), art, cache, false)
  const outline = art.applyOutline(presenter.root, 'structural')
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 150)
  const policy = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'balanced' })
  presenter.setAppearance({ rightLeg: 'missing' })
  const weapon = presenter.root.getObjectByName('weapon-head') as THREE.Mesh
  const weaponGeometry = weapon.geometry
  const nearTriangles = presenter.body.geometry.index!.count
  for (const [distance, level] of [[90, 'far'], [30, 'mid'], [8, 'near'], [90, 'far'], [8, 'near']] as const) {
    camera.position.set(0, 2, distance)
    presenter.updateLod(camera, policy)
    assert.equal(presenter.level, level)
    assert.equal(presenter.rig.rightLeg!.visible, false)
    assert.equal(weapon.geometry, weaponGeometry, 'the bow/haft never disappears as a generic grip detail')
    for (const shell of outline.shells) assert.equal(shell.geometry, (shell.parent as THREE.Mesh).geometry)
    if (level === 'far') assert.ok(presenter.body.geometry.index!.count < nearTriangles)
    assert.ok(cache.size <= 3, 'at most two body templates and the complete bow are retained')
  }
  art.releaseOutline(outline); presenter.dispose(); art.dispose(); cache.dispose()
})

test('grounding follows signed slopes without moving simulation roots or restoring missing feet', () => {
  const art = library(), cache = new GeometryCache()
  const p = createCharacterPresenter(illustratedCharacterPlan(resolveCharacterPlan('guard', 'soldier', 0)), art, cache, false)
  p.root.position.set(4, 1, -3)
  p.root.rotation.y = 0.6
  const position = p.root.position.clone(), rotation = p.root.quaternion.clone()
  const sample = (x: number, z: number) => 1 + (x - 4) * 0.12 + (z + 3) * -0.08
  for (let frame = 0; frame < 60; frame++) {
    p.rig.leftLeg!.rotation.x = 0
    p.rig.rightLeg!.rotation.x = 0
    p.rig.leftKnee!.rotation.x = 0.04
    p.rig.rightKnee!.rotation.x = 0.04
    p.ground(1 / 60, sample, true, 0, 0)
  }
  p.root.updateMatrixWorld(true)
  for (const foot of p.feet) {
    const world = foot.getWorldPosition(new THREE.Vector3())
    assert.ok(Math.abs(world.y - sample(world.x, world.z)) < 0.045, 'sole is near its actual terrain sample')
  }
  assert.deepEqual(p.root.position, position)
  assert.deepEqual(p.root.quaternion.toArray(), rotation.toArray())
  assert.ok(Math.abs(p.anatomy.bodyPivot.position.y) <= 0.16)
  p.setAppearance({ leftLeg: 'missing' })
  p.ground(1 / 30, sample, true, 0, 0.2)
  assert.equal(p.rig.leftLeg!.visible, false)
  p.ground(1 / 60, sample, false, 0, 0)
  assert.equal(p.anatomy.bodyPivot.position.y, 0, 'airborne pose has no terrain pelvis offset')
  assert.throws(() => p.ground(1 / 60, () => NaN, true, 0, 0), /terrain sample/)
  p.dispose(); art.dispose(); cache.dispose()
})

test('low near and mid can share geometry without violating distinct replacement leases', () => {
  const art = library(), cache = new GeometryCache()
  const p = createCharacterPresenter(illustratedCharacterPlan(resolveCharacterPlan('guard', 'soldier', 0)), art, cache, false, 'low')
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 150)
  const policy = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'low' })
  const original = p.body.geometry
  camera.position.set(0, 0, 26)
  p.updateLod(camera, policy)
  assert.equal(p.level, 'mid')
  assert.equal(p.body.geometry, original)
  for (const source of p.sources) assert.equal(source.castShadow, false)
  p.dispose()
  assert.throws(() => p.updateLod(camera, policy), /disposed/)
  assert.throws(() => p.setAppearance({ leftArm: 'missing' }), /disposed/)
  art.dispose(); cache.dispose()
})

test('support hand reaches the actual shield handle through posed and scaled joints', () => {
  const art = library(), cache = new GeometryCache()
  const p = createCharacterPresenter(illustratedCharacterPlan(resolveCharacterPlan('guard', 'soldier', 0)), art, cache, false)
  const shield = p.root.getObjectByName('shield')!
  const wanted = new THREE.Vector3(), actual = new THREE.Vector3()
  for (const scale of [0.95, 1, 1.05]) for (const raised of [false, true]) {
    p.rig.leftArm!.scale.y = scale
    p.anatomy.torsoPivot.rotation.set(0.22, -0.3, 0.17)
    p.anatomy.torsoPivot.scale.set(1.07, 1.01, 1)
    shield.position.set(raised ? 0 : -0.82, (raised ? 1.78 : 1.85) - p.rig.waistY, raised ? 0.58 : 0.08)
    p.poseSupport(0.4)
    p.root.updateMatrixWorld(true)
    wanted.set(0, 0.02, -0.11).applyMatrix4(shield.matrixWorld)
    actual.setFromMatrixPosition(p.hands[0].matrixWorld)
    assert.ok(actual.distanceTo(wanted) < 0.001, 'the shield is held by the hand, not an unrelated forearm pose')
  }
  p.dispose(); art.dispose(); cache.dispose()
})

test('each guard variant fits its source-plus-ink geometry envelope without dropping equipment', () => {
  const art = library(), cache = new GeometryCache()
  for (const quality of ['high', 'balanced', 'low'] as const) {
    const allocation = resolveVisualSubsystemAllocation(resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: quality }))!
    for (let variant = 0; variant < CHARACTER_VARIANTS; variant++) {
      const plan = illustratedCharacterPlan(resolveCharacterPlan('guard', 'soldier', variant))
      const p = createCharacterPresenter(plan, art, cache, false, quality)
      const triangles = p.sources.reduce((sum, source) =>
        sum + (source.geometry.index?.count ?? source.geometry.getAttribute('position').count) / 3, 0)
      // Geometry upper bound, not a GL/whole-frame measurement: source + identical ink,
      // plus the actual 24-segment ring, 18-segment contact disc and health sprite.
      assert.ok(triangles * 2 + 48 + 18 + 2 <= allocation.firstRole.nearMainViewTriangles,
        `${quality}/${variant}: ${triangles * 2 + 68} main-view geometry triangles`)
      assert.equal(p.sources.length, plan.offhand === 'none' ? 2 : 3)
      assert.ok(p.jointCount <= allocation.firstRole.joints)
      assert.ok(p.geometryBytes <= allocation.firstRole.exclusiveCpuBackingBytes)
      p.dispose()
    }
  }
  cache.dispose(); art.dispose()
})

test('captive rope follows posed wrists and failed construction cannot release another captive receipt', () => {
  const art = library(), cache = new GeometryCache()
  const plan = illustratedCharacterPlan(resolveCharacterPlan('elf', 'captive', 0))
  const p = createCharacterPresenter(plan, art, cache, false)
  const rope = p.root.getObjectByName('wrist-rope')!
  assert.equal(cache.referenceCount('wrist-rope'), 1)
  const wrist = new THREE.Vector3(), loop = new THREE.Vector3()
  for (const pitch of [-0.2, 0.3, 0.6]) {
    p.anatomy.torsoPivot.rotation.set(pitch, 0.2, -0.1)
    p.rig.leftElbow!.rotation.x = 0.72 + pitch * 0.1
    p.syncAttachments()
    p.root.updateMatrixWorld(true)
    for (const side of [0, 1]) {
      wrist.setFromMatrixPosition(p.hands[side].matrixWorld)
      loop.set(side === 0 ? -0.5 : 0.5, 0, 0).applyMatrix4(rope.matrixWorld)
      assert.ok(wrist.distanceTo(loop) < 1e-9, 'rope cuffs stay on the actual wrists')
    }
  }
  const originalBind = art.bindRenderSource
  art.bindRenderSource = () => { throw new Error('injected preparation rejection') }
  try {
    assert.throws(() => createCharacterPresenter(plan, art, cache, false), /preparation rejection/)
    assert.equal(cache.referenceCount('wrist-rope'), 1, 'a failed builder must not spend another holder receipt')
  } finally { art.bindRenderSource = originalBind }
  rope.visible = false
  p.rig.boundArms = false
  p.syncAttachments()
  assert.equal(rope.visible, false, 'a rescued captive is not rebound by the pose pass')
  p.dispose()
  assert.equal(cache.size, 0)
  art.dispose()
})

test('shield cache keys include baked tint while identical bundles share one physical asset', () => {
  const art = library(), cache = new GeometryCache()
  const guards = [0, 2].map((variant) => createCharacterPresenter(
    illustratedCharacterPlan(resolveCharacterPlan('guard', 'soldier', variant)), art, cache, false))
  const shields = guards.map((p) => p.root.getObjectByName('shield') as THREE.Mesh)
  assert.notEqual(shields[0].geometry, shields[1].geometry, 'distinct baked colors cannot share a geometry key')
  assert.notDeepEqual(shields[0].geometry.getAttribute('color').array, shields[1].geometry.getAttribute('color').array)
  const civilians = CHARACTER_FACTIONS.map((faction) => createCharacterPresenter(
    illustratedCharacterPlan(resolveCharacterPlan(faction, 'peasant', 0)), art, cache, false))
  const bundles = civilians.map((p) => (p.root.getObjectByName('shield') as THREE.Mesh).geometry)
  assert.equal(bundles[0], bundles[1])
  assert.equal(bundles[1], bundles[2])
  for (const p of [...guards, ...civilians]) p.dispose()
  assert.equal(cache.size, 0)
  cache.dispose(); art.dispose()
})

test('production bound-arm posing does not freeze an enhanced captive walking gait', () => {
  const art = library(), cache = new GeometryCache()
  const p = createCharacterPresenter(illustratedCharacterPlan(resolveCharacterPlan('elf', 'captive', 0)), art, cache, false)
  const pose = { stride: 0.5, attack: 0, anticipation: 0, recovery: 0, flinch: 0, stagger: 0 }
  const engine: { animateCharacter(root: THREE.Group, animation: typeof pose): void } =
    Object.assign(Object.create(GameEngine.prototype), { elapsed: 1.2, handOffset: new THREE.Vector3() })
  engine.animateCharacter(p.root, pose)
  assert.equal(p.rig.leftLeg!.rotation.x, 0.5)
  assert.equal(p.rig.rightLeg!.rotation.x, -0.5)
  assert.equal(p.rig.leftArm!.rotation.x, 0)
  assert.equal(p.rig.rightArm!.rotation.x, 0)
  p.rig.boundArms = false
  engine.animateCharacter(p.root, pose)
  assert.ok(Math.abs(p.rig.leftArm!.rotation.x) > 0.1)
  assert.equal(p.rig.leftLeg!.rotation.x, 0.5)
  p.dispose(); art.dispose(); cache.dispose()
})

test('contact surfaces match physical kit layers and weapon anchors follow the actual geometry', () => {
  const art = library(), cache = new GeometryCache()
  const sample: CharacterContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: 'dark' }
  for (const faction of CHARACTER_FACTIONS) for (const role of ['soldier', 'archer', 'peasant']) {
    const plan = illustratedCharacterPlan(resolveCharacterPlan(faction, role, 0))
    const p = createCharacterPresenter(plan, art, cache, false)
    assert.ok(p.sampleContact('torso', sample))
    assert.equal(sample.surface, role === 'peasant' ? 'cloth' : faction === 'guard' ? 'metal' : 'leather')
    if (plan.armed) {
      const weapon = p.root.getObjectByName('weapon-head') as THREE.Mesh
      const position = weapon.geometry.getAttribute('position')
      let maximum = -Infinity
      for (let i = 0; i < position.count; i++) maximum = Math.max(maximum,
        plan.weapon === 'bow' ? position.getZ(i) : position.getY(i))
      p.rig.weapon!.rotation.set(-0.3, 0.2, 0.4)
      p.syncAttachments()
      p.root.updateMatrixWorld(true)
      assert.ok(p.sampleContact('weaponTip', sample))
      const local = p.rig.weapon!.worldToLocal(sample.point.clone())
      assert.ok(Math.abs((plan.weapon === 'bow' ? local.z : local.y) - maximum) < 1e-5)
      assert.ok(p.sampleContact('weaponGrip', sample))
      assert.ok(sample.point.distanceTo(p.hands[p.rig.mainHand > 0 ? 1 : 0].getWorldPosition(new THREE.Vector3())) < 1e-10)
      p.setAppearance({ [plan.mainHand === 'right' ? 'rightArm' : 'leftArm']: 'missing' })
      assert.ok(p.sampleContact('weaponGrip', sample), 'the remaining hand can carry the weapon')
      p.setAppearance({ leftArm: 'missing', rightArm: 'missing' })
      assert.equal(p.sampleContact('weaponGrip', sample), false)
      assert.equal(p.sampleContact('weaponTip', sample), false)
    } else {
      assert.equal(p.sampleContact('weapon', sample), false)
      assert.equal(p.sampleContact('weaponGrip', sample), false)
      assert.equal(p.sampleContact('weaponTip', sample), false)
      assert.ok(p.sampleContact('shield', sample))
      assert.equal(sample.surface, 'leather', 'the civilian bundle is not a metal shield')
    }
    p.dispose()
  }
  art.dispose(); cache.dispose()
})

test('a bounded two-template neighborhood reuses LOD geometry and drains every retained receipt', () => {
  const art = library(), cache = new GeometryCache()
  const p = createCharacterPresenter(illustratedCharacterPlan(resolveCharacterPlan('guard', 'soldier', 0)), art, cache, false)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200)
  const policy = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'balanced' })
  const near = p.body.geometry
  let nearDisposals = 0
  near.addEventListener('dispose', () => { nearDisposals++ })
  camera.position.z = 30
  p.updateLod(camera, policy)
  const mid = p.body.geometry
  assert.notEqual(mid, near)
  camera.position.z = 8
  p.updateLod(camera, policy)
  assert.equal(p.body.geometry, near, 'returning across the neighborhood must not rebuild the same body')
  assert.equal(nearDisposals, 0)
  for (const distance of [100, 30, 8, 100, 30, 8]) {
    camera.position.z = distance
    p.updateLod(camera, policy)
    assert.ok(cache.size <= 4, 'two body templates plus weapon/shield bound the live cache population')
    const usage = sumVisualAllocationReceipts(p.allocationReceipts()).dynamicArt
    assert.ok(usage.cpuGeometryBytes >= p.geometryBytes, 'inactive retained backing stores are charged too')
  }
  p.dispose()
  assert.equal(cache.size, 0)
  assert.equal(nearDisposals, 1)
  art.dispose()
})

test('the actual elf arrow event changes presentation without changing projectile timing or paid state', () => {
  const art = library(), cache = new GeometryCache()
  const p = createCharacterPresenter(illustratedCharacterPlan(resolveCharacterPlan('elf', 'player', 0, true)), art, cache, true)
  const source = p.root.getObjectByName('weapon-head') as THREE.SkinnedMesh
  const skeleton = source.skeleton
  const weapon = p.rig.weapon!
  const torch = new THREE.Group(), trail = new THREE.Group()
  torch.name = 'torch'; trail.name = 'weapon-trail'
  weapon.add(torch, trail)
  const outlines = art.applyOutline(p.root, 'structural')
  const shell = outlines.shells.find((node) => node.parent === source)!
  const binding = art.getRenderSourceBinding(source)!
  art.setSourceVisibility(binding, 0.4)
  const shots: unknown[][] = []
  const paid = { beat: 3, phase: 'windup', phaseRemaining: 0.11, lockout: 0 }
  const engine: { fireArrow(): void; stamina: number; abilityCooldown: number; melee: typeof paid } =
    Object.assign(Object.create(GameEngine.prototype), {
      player: p.root, faction: 'elf', cameraYaw: 0.4, activePlayerAttackKind: 'melee',
      stamina: 74, abilityCooldown: 3, melee: paid,
      spawnProjectile: (...args: unknown[]) => { shots.push(args) }, playSound() {},
    })
  p.root.position.set(3, 1.2, -4)
  const position = p.root.position.toArray()
  const before = JSON.stringify({ stamina: engine.stamina, abilityCooldown: engine.abilityCooldown, melee: paid })
  engine.fireArrow()
  assert.equal(shots.length, 1, 'the real projectile fires immediately; no visual windup delays it')
  assert.equal(p.arrowPresentationActive, true)
  assert.equal(p.weaponKind, 'bow')
  assert.ok(source.geometry.name.endsWith('released'), 'the fired arrow is not duplicated on the held bow')
  assert.equal(source.skeleton, skeleton)
  assert.equal(shell.geometry, source.geometry)
  assert.ok(Math.abs(art.getSourceVisibility(binding) - 0.4) < 1e-6)
  assert.equal(torch.parent, weapon)
  assert.equal(trail.parent, weapon)
  assert.ok(p.root.getObjectByName('shield')!.position.z < 0, 'the elf offhand is stowed, not deleted')
  p.advanceActionPresentation(0, false)
  assert.equal(p.arrowPresentationActive, true)
  p.root.rotation.y += 0.3
  p.advanceActionPresentation(0.12, false)
  p.poseArrowRecovery()
  p.root.updateMatrixWorld(true)
  const shotVelocity = shots[0][3]
  assert.ok(shotVelocity instanceof THREE.Vector3)
  const forward = new THREE.Vector3(0, 0, 1).transformDirection(weapon.matrixWorld)
  assert.ok(Math.abs(Math.atan2(forward.x, forward.z) - Math.atan2(shotVelocity.x, shotVelocity.z)) < 1e-10)
  p.advanceActionPresentation(0.3, false)
  assert.equal(p.arrowPresentationActive, false)
  assert.equal(p.weaponKind, 'sabre')
  assert.equal(weapon.matrixAutoUpdate, true)
  assert.equal(torch.parent, weapon)
  assert.deepEqual(p.root.position.toArray(), position)
  assert.equal(JSON.stringify({ stamina: engine.stamina, abilityCooldown: engine.abilityCooldown, melee: paid }), before)
  art.releaseOutline(outlines); p.dispose()
  assert.equal(cache.size, 0)
  art.dispose()
})

test('bow string and nock share the draw bone, release excludes the nocked arrow, and missing arms stay missing', () => {
  const art = library(), cache = new GeometryCache()
  const p = createCharacterPresenter(illustratedCharacterPlan(resolveCharacterPlan('elf', 'archer', 0)), art, cache, false)
  const source = p.root.getObjectByName('weapon-head') as THREE.SkinnedMesh
  assert.equal(source.skeleton.bones.length, 2)
  const tip: CharacterContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: 'dark' }
  p.poseSupport(0)
  p.root.updateMatrixWorld(true)
  const positions = source.geometry.getAttribute('position')
  let tipIndex = 0, endIndex = -1
  for (let i = 0; i < positions.count; i++) {
    if (positions.getZ(i) > positions.getZ(tipIndex)) tipIndex = i
    if (Math.abs(positions.getY(i) - 0.74) < 1e-4 && Math.abs(positions.getZ(i) + 0.23) < 0.01 &&
        Math.abs(positions.getX(i) - 0.02) < 0.01) endIndex = i
  }
  assert.ok(endIndex >= 0, 'the production bow contains its actual string endpoint')
  const restTipVertex = source.getVertexPosition(tipIndex, new THREE.Vector3())
  const restEnd = source.getVertexPosition(endIndex, new THREE.Vector3())
  p.sampleContact('weaponTip', tip)
  const rest = p.rig.weapon!.worldToLocal(tip.point.clone())
  p.poseSupport(1)
  p.root.updateMatrixWorld(true)
  p.sampleContact('weaponTip', tip)
  const drawn = p.rig.weapon!.worldToLocal(tip.point.clone())
  assert.ok(Math.abs(rest.z - drawn.z - 0.3) < 1e-10)
  const drawnVertex = source.getVertexPosition(tipIndex, new THREE.Vector3())
  assert.ok(Math.abs(restTipVertex.z - drawnVertex.z - 0.3) < 1e-10, 'the rendered nocked arrow, not only its empty anchor, follows the draw')
  assert.ok(source.getVertexPosition(endIndex, new THREE.Vector3()).distanceTo(restEnd) < 1e-10,
    'the string endpoint stays attached to its bow limb')
  const dopedGeometry = source.geometry.clone()
  const weights = dopedGeometry.getAttribute('skinWeight')
  for (let i = 0; i < weights.count; i++) weights.setXYZW(i, 1, 0, 0, 0)
  const doped = new THREE.SkinnedMesh(dopedGeometry, source.material)
  doped.skeleton = source.skeleton
  doped.bindMatrix.copy(source.bindMatrix)
  doped.bindMatrixInverse.copy(source.bindMatrixInverse)
  assert.ok(doped.getVertexPosition(tipIndex, new THREE.Vector3()).distanceTo(drawnVertex) > 0.2,
    'a rigid-only mutation must fail the same deformed-vertex measurement')
  dopedGeometry.dispose()
  const readyIndices = source.geometry.index?.count ?? source.geometry.getAttribute('position').count
  p.setBowRelease(true)
  const releasedIndices = source.geometry.index?.count ?? source.geometry.getAttribute('position').count
  assert.ok(releasedIndices < readyIndices)
  p.setBowRelease(false)
  p.setAppearance({ leftArm: 'missing' })
  assert.equal(p.rig.mainHand, 1)
  p.syncAttachments()
  assert.equal(p.rig.leftArm!.visible, false)
  assert.ok(p.sampleContact('weaponGrip', tip))
  validateArtGeometry(source)
  p.dispose(); art.dispose(); cache.dispose()
})
