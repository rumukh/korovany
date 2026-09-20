import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import * as THREE from 'three'
import {
  GeometryCache, StylizedArtLibrary, LegacyBowPresentation,
  buildWeaponGrip, buildIllustratedNockedArrow, type LegacyBowResources,
} from '../src/game/art/index.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'

const loader = registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
} })
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

function fixture() {
  const cache = new GeometryCache()
  const art = new StylizedArtLibrary({ ink: {
    player: 0x282828, enemy: 0x282828, interactable: 0x282828, landmark: 0x282828,
  } })
  const palette = Object.fromEntries(['bg', 'elevated', 'surface', 'soft', 'border', 'borderStrong', 'text',
    'muted', 'accent', 'success', 'danger', 'warning', 'link', 'accentFg'].map((key) => [key, new THREE.Color(0x667788)]))
  const engine: {
    elapsed: number
    createCharacter(faction: 'elf' | 'guard', player: boolean): THREE.Group
    animateCharacter(root: THREE.Group, pose: {
      stride: number; attack: number; anticipation: number; recovery: number; flinch: number; stagger: number
    }): void
  } = Object.assign(Object.create(GameEngine.prototype), {
    artLibrary: art, artGeometry: cache, visualPolicy: resolveVisualPolicy({ visualMode: 'legacy' }),
    handOffset: new THREE.Vector3(), palette, elapsed: 0,
  })
  const root = engine.createCharacter('elf', true)
  const resources: LegacyBowResources = {
    bowGeometry: cache.acquire('test:legacy-bow', () => buildWeaponGrip('bow')),
    arrowGeometry: cache.acquire('test:legacy-arrow', buildIllustratedNockedArrow),
    stringGeometry: cache.acquire('test:legacy-string', () => new THREE.BoxGeometry(0.016, 1, 0.016)),
    bowMaterial: art.acquireMaterial('test:wood', { color: 0x664433, surface: 'leather' }),
    arrowMaterial: art.acquireMaterial('test:arrow', { color: 0x778899, surface: 'metal' }),
    stringMaterial: art.acquireMaterial('test:string', { color: 0x222222, surface: 'cloth' }),
  }
  for (const g of [resources.bowGeometry, resources.arrowGeometry, resources.stringGeometry]) {
    StylizedArtLibrary.markLibraryOwned(g)
  }
  return { root, resources, cache, art, engine, dispose() { art.dispose(); cache.dispose() } }
}

function state(node: THREE.Object3D) {
  return {
    p: node.position.toArray(), q: node.quaternion.toArray(), s: node.scale.toArray(),
    m: node.matrix.toArray(), auto: node.matrixAutoUpdate, visible: node.visible,
  }
}

function mesh(root: THREE.Object3D, name: string): THREE.Mesh {
  const node = root.getObjectByName(name)
  assert.ok(node instanceof THREE.Mesh, name)
  return node
}

function checkPose(root: THREE.Group, origin: THREE.Vector3, direction: THREE.Vector3) {
  root.updateMatrixWorld(true)
  const arrow = mesh(root, 'legacy-bow-arrow'), weapon = root.getObjectByName('weapon')!
  const position = arrow.geometry.getAttribute('position')
  let nock = -1
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(position.getX(i) - 0.02) < 1e-6 && Math.abs(position.getY(i)) < 1e-6 &&
        Math.abs(position.getZ(i) + 0.06) < 1e-6) { nock = i; break }
  }
  assert.ok(nock >= 0)
  const actual = new THREE.Vector3().fromBufferAttribute(position, nock).applyMatrix4(arrow.matrixWorld)
  assert.ok(actual.distanceTo(origin) < 1e-6, `legacy nock error ${actual.distanceTo(origin)}`)
  assert.ok(new THREE.Vector3(0, 0, 1).transformDirection(weapon.matrixWorld).distanceTo(direction) < 1e-10)
  const left = root.getObjectByName('leftArm')!.visible
  for (const side of [-1, 1]) {
    const arm = root.getObjectByName(side < 0 ? 'leftArm' : 'rightArm')!
    if (!arm.visible) continue
    const forearm = mesh(root, side < 0 ? 'leftArm-forearm' : 'rightArm-forearm')
    // The center of the actual gloved palm built into the legacy forearm.
    const palm = new THREE.Vector3(0, -0.58 - 0.11, 0.01).applyMatrix4(forearm.matrixWorld)
    const expected = side === (left ? -1 : 1) ? weapon.getWorldPosition(new THREE.Vector3()) : origin
    assert.ok(palm.distanceTo(expected) < 1e-6, 'legacy grip must meet the actual palm without moving hand geometry')
  }
  for (const name of ['legacy-bow-string-lower', 'legacy-bow-string-upper']) {
    const string = mesh(root, name)
    const center = new THREE.Vector3(0, -0.5, 0).applyMatrix4(string.matrixWorld)
    assert.ok(center.distanceTo(origin) < 1e-6, 'both real string segments meet at the nock')
    const end = new THREE.Vector3(0, 0.5, 0).applyMatrix4(string.matrixWorld)
    const expected = new THREE.Vector3(0.02, name.endsWith('lower') ? -0.74 : 0.74, -0.23).applyMatrix4(weapon.matrixWorld)
    assert.ok(end.distanceTo(expected) < 1e-6, 'string endpoint remains on its bow limb')
  }
}

test('actual legacy elf rig holds a visible bow at the canonical nock over the full manual aim envelope', () => {
  let cases = 0
  for (const missing of [null, 'leftArm', 'rightArm'] as const) {
    const f = fixture(), { root, engine } = f
    if (missing) root.getObjectByName(missing)!.visible = false
    root.position.set(4, 1.4, -6)
    root.rotation.y = 0.8
    const helper = new LegacyBowPresentation(root, f.resources)
    const geometry = mesh(root, 'leftArm-forearm').geometry
    const originalVertices = geometry.getAttribute('position').array.slice()
    helper.setBowAiming(true)
    for (const stride of [-0.62, 0, 0.62]) for (const scale of [0.98, 1.02]) {
      engine.animateCharacter(root, { stride, attack: 0, anticipation: 0, recovery: 0, flinch: 0, stagger: 0 })
      const torso = root.getObjectByName('torso-pivot')!
      torso.rotation.set(0, 0, 0)
      torso.scale.set(1.02, scale, 0.98)
      root.getObjectByName('leftArm')!.scale.set(1, 1.01, 0.99)
      root.getObjectByName('rightArm')!.scale.set(1.01, 0.99, 1.02)
      for (const pitch of [-1.2, 0, 1.2]) for (const yaw of [-0.27, 0, 0.27]) for (const factor of [0, 0.5, 1]) {
        const origin = new THREE.Vector3((missing === 'leftArm' ? 0.25 : -0.25) * factor, 2.05, 0.35 * factor)
          .applyAxisAngle(THREE.Object3D.DEFAULT_UP, root.rotation.y).add(root.position)
        const direction = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
          .applyAxisAngle(THREE.Object3D.DEFAULT_UP, root.rotation.y)
        root.updateMatrixWorld(true)
        const baseline = [root, root.getObjectByName('body-pivot')!, root.getObjectByName('leftLeg')!, root.getObjectByName('rightLeg')!].map(state)
        helper.poseBowAim(origin, direction)
        checkPose(root, origin, direction)
        assert.deepEqual([root, root.getObjectByName('body-pivot')!, root.getObjectByName('leftLeg')!, root.getObjectByName('rightLeg')!].map(state), baseline)
        assert.deepEqual(geometry.getAttribute('position').array, originalVertices)
        assert.equal(helper.visual.visible, true)
        assert.equal(mesh(root, 'weapon-head').visible, false)
        assert.equal(root.getObjectByName('weapon-grip-detail')!.visible, false)
        cases++
      }
    }
    helper.dispose(); f.dispose()
  }
  assert.equal(cases, 486)
})

test('legacy shot/rearm/cancel keeps attachments, offhand, LOD and supplied resource ownership stable', (t) => {
  const f = fixture(), { root, resources, cache } = f
  const weapon = root.getObjectByName('weapon')!, shield = root.getObjectByName('shield')!
  const beforeShield = state(shield), beforeWeapon = state(weapon)
  const head = mesh(root, 'weapon-head'), originalHead = head.geometry
  const gripLod = root.getObjectByName('weapon-grip-detail')!
  const torch = new THREE.Group(), trail = new THREE.Group()
  weapon.add(torch, trail)
  const helper = new LegacyBowPresentation(root, resources)
  const outline = f.art.applyOutline(root, 'structural')
  let disposed = 0
  const supplied = [resources.bowGeometry, resources.arrowGeometry, resources.stringGeometry]
  for (const g of supplied) g.addEventListener('dispose', () => { disposed++ })
  const baselineSize = cache.size
  const origin = new THREE.Vector3(-0.25, 2.05, 0.35), direction = new THREE.Vector3(0, 0, 1)
  const arrow = mesh(root, 'legacy-bow-arrow')
  for (let cycle = 0; cycle < 24; cycle++) {
    helper.setBowAiming(true)
    helper.poseBowAim(origin, direction)
    const grip = weapon.getWorldPosition(new THREE.Vector3())
    assert.ok(shield.position.z < 0)
    helper.beginArrowPresentation(direction, 0)
    assert.equal(arrow.visible, false)
    helper.poseBowAim(origin, direction)
    assert.ok(weapon.getWorldPosition(new THREE.Vector3()).distanceTo(grip) < 1e-10)
    const paused = state(weapon)
    const random = t.mock.method(Math, 'random', () => { throw new Error('Legacy steady pose consumes RNG') })
    helper.advanceActionPresentation(0, false)
    helper.poseBowAim(origin, direction)
    random.mock.restore()
    assert.deepEqual(state(weapon), paused)
    helper.advanceActionPresentation(0.175, false)
    helper.poseBowAim(origin, direction)
    assert.ok(Math.abs(weapon.getWorldPosition(new THREE.Vector3()).distanceTo(grip) - 0.045) < 1e-10)
    helper.advanceActionPresentation(0.18, false)
    assert.equal(arrow.visible, true)
    helper.poseBowAim(origin, direction)
    checkPose(root, origin, direction)
    helper.beginArrowPresentation(direction, 0)
    helper.setBowAiming(false)
    assert.equal(helper.bowAimingActive, false)
    assert.equal(helper.visual.visible, false)
    assert.deepEqual(state(shield), beforeShield)
    assert.deepEqual(state(weapon), beforeWeapon)
    assert.equal(head.visible, true); assert.equal(gripLod.visible, true)
    assert.equal(head.geometry, originalHead)
    assert.equal(torch.parent, weapon); assert.equal(trail.parent, weapon)
    assert.equal(disposed, 0)
    assert.equal(cache.size, baselineSize)
  }
  helper.beginArrowPresentation(new THREE.Vector3(), NaN)
  assert.deepEqual(state(weapon), beforeWeapon, 'inactive notifications leave legacy baseline alone')
  for (const shell of outline.shells) assert.equal(shell.geometry, (shell.parent as THREE.Mesh).geometry)
  f.art.releaseOutline(outline)
  helper.dispose(); helper.dispose()
  assert.equal(root.getObjectByName('legacy-bow-presentation'), undefined)
  assert.equal(disposed, 0, 'helper must never free caller-owned cached geometry')
  f.dispose()
  assert.equal(disposed, 3)
  assert.throws(() => helper.setBowAiming(true), /disposed/)
})

test('legacy missing/prosthetic limbs and invalid targets never restore geometry or force the grip', () => {
  const f = fixture(), { root } = f
  const left = root.getObjectByName('leftArm')!, right = root.getObjectByName('rightArm')!
  left.visible = false
  const forearm = mesh(root, 'rightArm-forearm')
  const prosthetic = f.art.acquireMaterial('test:prosthetic', { color: 0xaaaaaa, surface: 'metal' })
  forearm.material = prosthetic
  const helper = new LegacyBowPresentation(root, f.resources)
  helper.setBowAiming(true)
  helper.poseBowAim(new THREE.Vector3(0.25, 2.05, 0.35), new THREE.Vector3(0, 0, 1))
  root.updateMatrixWorld(true)
  const before = [left, right, root.getObjectByName('weapon')!].map(state)
  assert.throws(() => helper.poseBowAim(new THREE.Vector3(50, 0, 0), new THREE.Vector3(0, 0, 1)), /unreachable/)
  assert.deepEqual([left, right, root.getObjectByName('weapon')!].map(state), before)
  assert.throws(() => helper.poseBowAim(new THREE.Vector3(), new THREE.Vector3()), /unit/)
  assert.throws(() => helper.advanceActionPresentation(NaN, false), /timestep/)
  right.visible = false
  helper.advanceActionPresentation(0, false)
  assert.equal(helper.bowAimingActive, false)
  assert.equal(left.visible, false); assert.equal(right.visible, false)
  assert.equal(forearm.material, prosthetic)
  assert.throws(() => helper.setBowAiming(true), /surviving arm/)
  right.visible = true
  helper.setBowAiming(true)
  helper.advanceActionPresentation(0, true)
  assert.equal(helper.bowAimingActive, false)
  helper.dispose(); f.dispose()
})

test('legacy constructor rejects unsupported rigs and malformed borrowed resources without modifying the scene', () => {
  const f = fixture()
  const original = f.root.getObjectByName('weapon')!.children.slice()
  const short = new THREE.BoxGeometry(0.01, 0.4, 0.01)
  assert.throws(() => new LegacyBowPresentation(f.root, { ...f.resources, stringGeometry: short }), /unit-Y/)
  assert.deepEqual(f.root.getObjectByName('weapon')!.children, original)
  const guard = f.engine.createCharacter('guard', true)
  assert.throws(() => new LegacyBowPresentation(guard, f.resources), /legacy elf-player/)
  const helper = new LegacyBowPresentation(f.root, f.resources)
  assert.throws(() => new LegacyBowPresentation(f.root, f.resources), /unique named weapon/)
  helper.dispose(); short.dispose(); f.dispose()
})
