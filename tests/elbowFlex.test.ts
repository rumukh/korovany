import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import {
  CHARACTER_FACTIONS, GeometryCache, StylizedArtLibrary,
  elbowRotation, solveHandOffset, swivelElbowTowardPole, type CharacterPresenter,
} from '../src/game/art/index.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'

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

/** Shoulder, elbow and wrist hung along -Y, the way both production rigs build an arm. */
function armChain(upperArm: number, forearm: number) {
  const shoulder = new THREE.Object3D()
  const elbow = new THREE.Object3D()
  const wrist = new THREE.Object3D()
  elbow.position.y = -upperArm
  wrist.position.y = -forearm
  shoulder.add(elbow)
  elbow.add(wrist)
  return { shoulder, elbow, wrist }
}

/**
 * How far in front of its own upper arm a wrist sits, in the shoulder's frame.
 *
 * Figures face +Z and the upper arm runs down the shoulder's -Y, so a forearm that
 * has flexed shows a positive Z here. A negative one has hinged backwards.
 */
function wristAhead(arm: THREE.Object3D, elbow: THREE.Object3D, forearm: number): number {
  arm.updateWorldMatrix(true, true)
  return arm.worldToLocal(elbow.localToWorld(new THREE.Vector3(0, -forearm, 0))).z
}

test('a flexed elbow carries the hand in front of the upper arm', () => {
  const { shoulder, elbow } = armChain(0.58, 0.54)
  for (const flex of [0.12, 0.72, 1.21, 2.2]) {
    elbow.rotation.x = elbowRotation(flex)
    const ahead = wristAhead(shoulder, elbow, 0.54)
    assert.ok(Math.abs(ahead - 0.54 * Math.sin(flex)) < 1e-12, `flex ${flex} left the wrist at z ${ahead}`)
  }
})

test('the hand solve matches a real joint chain, shoulder yaw included', () => {
  const upperArm = 0.58, forearm = 0.54
  const { shoulder, elbow, wrist } = armChain(upperArm, forearm)
  const solved = new THREE.Vector3(), actual = new THREE.Vector3()
  const cases = [[-0.87, 0.84, 0.35, 1.21], [0.4, -0.6, -0.2, 0.3], [-2.1, 0, 0.42, 1.77], [0.7, 1.4, -0.9, 2.4]]
  for (const [armX, armY, armZ, flex] of cases) {
    shoulder.rotation.set(armX, armY, armZ)
    elbow.rotation.x = elbowRotation(flex)
    shoulder.updateMatrixWorld(true)
    wrist.getWorldPosition(actual)
    solveHandOffset(solved, upperArm, forearm, armX, armZ, elbowRotation(flex), armY)
    assert.ok(solved.distanceTo(actual) < 1e-12, `solve drifted ${solved.distanceTo(actual)} at ${[armX, armY, armZ, flex].join(', ')}`)
  }
})

test('swivelling a solved arm toward a pole moves the elbow and never the hand', () => {
  const axis = new THREE.Vector3(0.6, -0.39, 0.7).normalize()
  // A flexed arm's hand direction in its own frame: down the upper arm and forward.
  const hand = new THREE.Vector3(0, -0.77, 0.51).normalize()
  const orientation = new THREE.Quaternion().setFromUnitVectors(hand, axis)
  const pole = new THREE.Vector3(-0.5, -1, 0)
  const across = (v: THREE.Vector3) => v.clone().addScaledVector(axis, -v.dot(axis)).normalize()
  const before = across(new THREE.Vector3(0, -1, 0).applyQuaternion(orientation)).dot(across(pole))
  swivelElbowTowardPole(orientation, axis, pole)
  assert.ok(hand.clone().applyQuaternion(orientation).distanceTo(axis) < 1e-12, 'the hand left its target')
  const after = across(new THREE.Vector3(0, -1, 0).applyQuaternion(orientation)).dot(across(pole))
  assert.ok(after > 1 - 1e-12, `the elbow stopped ${after} short of the pole`)
  assert.ok(before < after)
  const settled = orientation.clone()
  swivelElbowTowardPole(orientation, axis, axis.clone().multiplyScalar(2))
  assert.ok(orientation.angleTo(settled) < 1e-12, 'a pole along the arm has no direction to turn toward')
})

function fixture(mode: 'legacy' | 'enhanced') {
  const library = new StylizedArtLibrary({
    enhanced: mode === 'enhanced',
    ink: { player: 0x18202b, enemy: 0x24181c, interactable: 0x272116, landmark: 0x172126 },
  })
  const cache = new GeometryCache()
  const presenters = new Set<CharacterPresenter>()
  const palette = Object.fromEntries(['bg', 'elevated', 'surface', 'soft', 'border', 'borderStrong', 'text',
    'muted', 'accent', 'success', 'danger', 'warning', 'link', 'accentFg'].map((key) => [key, new THREE.Color(0x667788)]))
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    artLibrary: library, artGeometry: cache, characterPresenters: presenters, palette,
    visualPolicy: resolveVisualPolicy({ visualMode: mode }), handOffset: new THREE.Vector3(), elapsed: 0,
  })
  return { engine, presenters, dispose() { for (const p of presenters) p.dispose(); cache.dispose(); library.dispose() } }
}

const POSES: Record<string, Partial<Record<'stride' | 'attack' | 'anticipation' | 'recovery' | 'flinch' | 'stagger', number>>> = {
  rest: {},
  'weapon arm swinging forward': { stride: -0.62 },
  'weapon arm swinging back': { stride: 0.62 },
  windup: { anticipation: 1 },
  'half windup': { anticipation: 0.5 },
  strike: { attack: 1 },
  recovery: { attack: 0.4, recovery: 1 },
  flinch: { flinch: 1 },
  stagger: { stagger: 1 },
}
const ROLES = ['soldier', 'archer', 'brute', 'champion', 'commander', 'captive', 'peasant'] as const

for (const mode of ['legacy', 'enhanced'] as const) {
  test(`${mode} figures never fold a forearm behind its upper arm`, () => {
    const f = fixture(mode)
    let arms = 0
    try {
      for (const faction of CHARACTER_FACTIONS) for (const role of ROLES) {
        const root = invoke<THREE.Group>(f.engine, 'createCharacter', faction, false, role, 0)
        const rig = root.userData.rig
        const presenter = [...f.presenters].find((p) => p.root === root)
        for (const [name, partial] of Object.entries(POSES)) {
          const pose = { stride: 0, attack: 0, anticipation: 0, recovery: 0, flinch: 0, stagger: 0, ...partial }
          invoke(f.engine, 'animateCharacter', root, pose)
          // Shields, two-handed grips and bowstrings are fitted after the pose, as in play.
          presenter?.poseSupport(Math.max(pose.anticipation, pose.attack * 0.8))
          for (const side of ['left', 'right'] as const) {
            const ahead = wristAhead(rig[`${side}Arm`], rig[`${side}Elbow`], rig.forearm)
            assert.ok(ahead > -1e-9, `${faction} ${role}, ${name}: ${side} wrist ${ahead.toFixed(3)} behind its arm`)
            arms += 1
          }
        }
      }
    } finally {
      f.dispose()
    }
    assert.equal(arms, CHARACTER_FACTIONS.length * ROLES.length * Object.keys(POSES).length * 2)
  })
}
