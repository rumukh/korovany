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
} from '../src/game/art/index.ts'
import { sumVisualAllocationReceipts } from '../src/game/diagnostics/VisualBudgetAccounting.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'

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
        assert.ok(presenter.skeleton.bones.length <= 64)
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
  for (let i = 0; i < bodyIndices.count; i++) {
    if (bodyIndices.getX(i) !== boneIndex) continue
    expected.fromBufferAttribute(handPositions, vertex++).applyMatrix4(presenter.rig.weapon!.matrixWorld)
    presenter.body.getVertexPosition(i, actual).applyMatrix4(presenter.body.matrixWorld)
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
