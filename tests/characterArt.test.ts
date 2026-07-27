import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import {
  BEAST_RIG,
  CHARACTER_VARIANTS,
  GeometryCache,
  artVariation,
  buildBeastBody,
  buildBeastHead,
  buildBeastLimb,
  buildBeastTail,
  buildBirdBody,
  buildBirdWing,
  buildCloak,
  buildDeerBody,
  buildDeerCrown,
  buildDeerLeg,
  buildFace,
  buildForearm,
  buildHair,
  buildHand,
  buildHarness,
  buildHead,
  buildHeadgear,
  buildOffhand,
  buildOxBody,
  buildOxHead,
  buildShin,
  buildThigh,
  buildTorso,
  buildTorsoTrim,
  buildUpperArm,
  buildWagonAxle,
  buildWagonBed,
  buildWagonCargo,
  buildWagonFrame,
  buildWagonTilt,
  buildWagonWheel,
  buildWeaponGrip,
  buildWeaponHead,
  buildWristRope,
  characterPartKeys,
  hasOutlineNormals,
  resolveCharacterPlan,
  solveHandOffset,
  type BeastKind,
  type CharacterFaction,
  type CharacterPartKeys,
  type CharacterPlan,
} from '../src/game/art/index.ts'
// Imported from the module rather than the barrel on purpose: these two are a review
// instrument, not part of the art surface `docs/09` §5.1 publishes, and adding them to
// `index.ts` would put a diagnostic hook in the vocabulary every other session imports.
import {
  characterWindingRepairs,
  resetCharacterWindingRepairs,
} from '../src/game/art/CharacterKit.ts'

/** Spec 09 §8. Kept here so the numbers in the doc are measured, not asserted. */
const CHARACTER_MESHES_NEAR = 19
const CHARACTER_MESHES_FAR = 14

/**
 * Wave 2A — NPC, creature and caravan models.
 *
 * These assert the things a screenshot cannot: that every person the game can
 * build actually builds, that the shapes differ where the spec says they must,
 * that the cache keys are honest about what they name, and that the rig contract
 * the animation, dismemberment, prosthetic, gore and torch code depends on is
 * still intact. See `docs/09-npc-and-creature-models-spec.md`.
 */

const FACTIONS: readonly CharacterFaction[] = ['elf', 'guard', 'villain']
const ROLES = [
  'soldier',
  'scout',
  'commander',
  'minion',
  'archer',
  'brute',
  'champion',
  'captive',
  'peasant',
] as const
const BEASTS: readonly BeastKind[] = ['wolf', 'boar', 'bear', 'troll']

const WIND_A = new THREE.Vector3()
const WIND_B = new THREE.Vector3()
const WIND_C = new THREE.Vector3()
const WIND_EDGE_ONE = new THREE.Vector3()
const WIND_EDGE_TWO = new THREE.Vector3()
const WIND_FACE = new THREE.Vector3()
const WIND_VERTEX = new THREE.Vector3()

/**
 * Counts triangles whose winding disagrees with their own normals.
 *
 * The foundation's `loftProfile` emits triangles wound opposite to the normals it
 * writes, so a `FrontSide` material draws the inside of the far wall and — far more
 * visibly — the `BackSide` ink shell lands in front of its own source and paints
 * the whole silhouette solid ink. `CharacterKit` repairs that per part; this is the
 * guard that it keeps doing so.
 */
function insideOutTriangles(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (!position || !normal) return 0
  const index = geometry.getIndex()
  const count = index ? index.count : position.count
  let disagree = 0
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    const first = index ? index.getX(triangle) : triangle
    const second = index ? index.getX(triangle + 1) : triangle + 1
    const third = index ? index.getX(triangle + 2) : triangle + 2
    WIND_A.fromBufferAttribute(position, first)
    WIND_B.fromBufferAttribute(position, second)
    WIND_C.fromBufferAttribute(position, third)
    WIND_EDGE_ONE.subVectors(WIND_B, WIND_A)
    WIND_EDGE_TWO.subVectors(WIND_C, WIND_A)
    WIND_FACE.crossVectors(WIND_EDGE_ONE, WIND_EDGE_TWO)
    if (WIND_FACE.lengthSq() < 1e-14) continue
    WIND_VERTEX.fromBufferAttribute(normal, first)
    if (WIND_FACE.dot(WIND_VERTEX) < 0) disagree += 1
  }
  return disagree
}

/**
 * The share of triangles whose normal points away from the part's own centroid.
 *
 * `insideOutTriangles` cannot see a part that has been flipped *whole* — reversed
 * normals and reversed winding agree with each other perfectly. That is exactly
 * what happens when a loft is handed its sections top-to-bottom, or when a lathe
 * profile runs downwards, and the result lights from the inside and loses its ink
 * shell without ever failing a winding check. This catches it.
 *
 * The measure is meaningless for genuinely concave assemblies — an antler, a
 * canvas tilt, a harness — so the guard is a floor rather than a demand for 100%.
 * A correctly built part measures 57% at worst; a flipped one measures 0-40%.
 */
function outwardShare(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const index = geometry.getIndex()
  const count = index ? index.count : position.count
  const centre = new THREE.Vector3()
  const vertex = new THREE.Vector3()
  for (let point = 0; point < position.count; point += 1) {
    vertex.fromBufferAttribute(position, point)
    centre.add(vertex)
  }
  centre.multiplyScalar(1 / position.count)
  const away = new THREE.Vector3()
  let outward = 0
  let total = 0
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    const first = index ? index.getX(triangle) : triangle
    vertex.fromBufferAttribute(position, first)
    away.subVectors(vertex, centre)
    if (away.lengthSq() < 1e-9) continue
    WIND_VERTEX.fromBufferAttribute(normal, first)
    total += 1
    if (WIND_VERTEX.dot(away) >= 0) outward += 1
  }
  return total === 0 ? 1 : outward / total
}

function assertSolid(geometry: THREE.BufferGeometry, label: string): number {
  const position = geometry.getAttribute('position')
  assert.ok(position, `${label} has no position attribute`)
  assert.ok(position.count > 0, `${label} is empty`)
  const values = position.array as ArrayLike<number>
  for (let index = 0; index < position.count * 3; index += 1) {
    assert.ok(Number.isFinite(values[index]), `${label} has a non-finite vertex`)
  }
  assert.ok(geometry.getAttribute('normal'), `${label} has no normals`)
  assert.ok(hasOutlineNormals(geometry), `${label} has no welded outline normals`)
  assert.equal(
    insideOutTriangles(geometry),
    0,
    `${label} has inside-out triangles; its ink shell would cover it`,
  )
  assert.ok(
    outwardShare(geometry) >= 0.5,
    `${label} is inverted whole: only ${(outwardShare(geometry) * 100).toFixed(
      0,
    )}% of its normals face outwards, so it lights from the inside and loses its ink`,
  )
  return position.count / 3
}

/** Builds every part a plan names and returns the triangle count of one actor. */
function buildEveryPart(
  plan: CharacterPlan,
  keys: CharacterPartKeys,
  seen?: Set<string>,
): number {
  const p = plan.proportions
  let triangles = 0
  const take = (key: string | null, geometry: THREE.BufferGeometry, copies = 1): void => {
    triangles += assertSolid(geometry, key ?? 'unnamed') * copies
    if (key) seen?.add(key)
    geometry.dispose()
  }
  take(keys.torso, buildTorso(plan))
  take(keys.head, buildHead(plan.faction))
  take(keys.face, buildFace(plan.faction))
  if (keys.hair) take(keys.hair, buildHair(plan.hair))
  take(keys.upperArm, buildUpperArm(plan.faction, plan.armour, p.upperArm), 2)
  take(
    keys.forearm,
    buildForearm(plan.faction, plan.armour, plan.gloved, p.forearm),
    2,
  )
  if (keys.hand) take(keys.hand, buildHand(), 2)
  take(keys.thigh, buildThigh(plan.faction, plan.armour, p.thigh), 2)
  take(keys.shin, buildShin(plan.faction, plan.armour, p.shin), 2)
  if (keys.trim) take(keys.trim, buildTorsoTrim(plan.trim))
  if (keys.cloak) take(keys.cloak, buildCloak(plan.faction, plan.cloak))
  if (keys.headgear) take(keys.headgear, buildHeadgear(plan.headgear))
  if (keys.weaponHead) take(keys.weaponHead, buildWeaponHead(plan.weapon))
  if (keys.weaponGrip) take(keys.weaponGrip, buildWeaponGrip(plan.weapon))
  if (keys.offhand) take(keys.offhand, buildOffhand(plan.offhand))
  return triangles
}

test('every person the game can build actually builds', () => {
  const keys = new Set<string>()
  let worst = 0
  for (const faction of FACTIONS) {
    for (const role of [...ROLES, 'player']) {
      for (let variant = 0; variant < CHARACTER_VARIANTS; variant += 1) {
        const plan = resolveCharacterPlan(faction, role, variant, role === 'player')
        const parts = characterPartKeys(plan)
        worst = Math.max(worst, buildEveryPart(plan, parts, keys))
      }
    }
  }
  // §8 — the cache has to hold every distinct part the game can ask for. This is
  // the theoretical ceiling; a real run touches fifty to seventy of them.
  assert.ok(keys.size <= 180, `character geometry keys grew to ${String(keys.size)}`)
  assert.ok(worst <= 3600, `one actor reached ${String(worst)} triangles`)
  // The captive's rope is built outside the plan's key set, under a fixed key.
  assertSolid(buildWristRope(), 'wrist-rope')
})

test('a plan is a pure function of faction, role and variant', () => {
  for (const faction of FACTIONS) {
    for (const role of ROLES) {
      for (let variant = 0; variant < CHARACTER_VARIANTS; variant += 1) {
        const first = resolveCharacterPlan(faction, role, variant)
        const second = resolveCharacterPlan(faction, role, variant)
        assert.deepEqual(first, second, `${faction}/${role}/${String(variant)} drifted`)
        assert.deepEqual(
          characterPartKeys(first),
          characterPartKeys(second),
          'the same plan must produce the same cache keys',
        )
      }
    }
  }
  // Out-of-range and negative variants wrap rather than throwing or producing
  // an undefined weapon, because the caller draws one from an art stream.
  assert.deepEqual(
    resolveCharacterPlan('guard', 'soldier', CHARACTER_VARIANTS + 1),
    resolveCharacterPlan('guard', 'soldier', 1),
  )
  assert.deepEqual(
    resolveCharacterPlan('guard', 'soldier', -1),
    resolveCharacterPlan('guard', 'soldier', CHARACTER_VARIANTS - 1),
  )
  // An unknown role must still produce a whole person rather than a crash.
  const unknown = resolveCharacterPlan('elf', 'quartermaster', 0)
  assert.equal(unknown.kit, 'line')
})

test('actor variation is seeded from an art stream, never from chance', () => {
  const label = 'npc:variant:guard:soldier:3'
  const first = artVariation('коровaны', label).integer(0, CHARACTER_VARIANTS)
  const second = artVariation('коровaны', label).integer(0, CHARACTER_VARIANTS)
  assert.equal(first, second, 'the same actor must be the same person on reload')
  assert.ok(first >= 0 && first < CHARACTER_VARIANTS)
  const other = artVariation('коровaны', 'npc:variant:guard:soldier:4')
  const spread = new Set<number>()
  for (let index = 0; index < 24; index += 1) {
    spread.add(
      artVariation('коровaны', `npc:variant:elf:soldier:${String(index)}`).integer(
        0,
        CHARACTER_VARIANTS,
      ),
    )
  }
  assert.ok(spread.size > 1, 'a line of soldiers must not all be the same variant')
  assert.ok(other.unit() >= 0)
})

test('the three factions are different shapes, not different colours', () => {
  const measure = (faction: CharacterFaction): THREE.Vector3 => {
    const plan = resolveCharacterPlan(faction, 'soldier', 0)
    const torso = buildTorso(plan)
    torso.computeBoundingBox()
    const size = new THREE.Vector3()
    torso.boundingBox?.getSize(size)
    torso.dispose()
    return size
  }
  const elf = measure('elf')
  const guard = measure('guard')
  const villain = measure('villain')
  // Width is the readable axis in a silhouette, and the three must not agree.
  assert.ok(guard.x > elf.x + 0.1, 'a guard must be broader than an elf')
  assert.ok(villain.x > elf.x, 'a villain must be broader than an elf')
  assert.ok(Math.abs(guard.x - villain.x) > 0.02, 'guard and villain must differ')

  // Proportion, not just the torso: an elf stands taller and a villain hunches.
  const elfPlan = resolveCharacterPlan('elf', 'soldier', 0)
  const guardPlan = resolveCharacterPlan('guard', 'soldier', 0)
  const villainPlan = resolveCharacterPlan('villain', 'soldier', 0)
  assert.ok(elfPlan.proportions.shoulderY > guardPlan.proportions.shoulderY)
  assert.ok(guardPlan.proportions.shoulderX > elfPlan.proportions.shoulderX)
  assert.ok(villainPlan.proportions.lean > 0.1, 'a villain leans forward')
  assert.equal(elfPlan.proportions.lean, 0)

  // And the three headgear and weapon families must not overlap at all.
  const gear = new Map<CharacterFaction, Set<string>>()
  for (const faction of FACTIONS) {
    const hats = new Set<string>()
    const weapons = new Set<string>()
    for (const role of ROLES) {
      for (let variant = 0; variant < CHARACTER_VARIANTS; variant += 1) {
        const plan = resolveCharacterPlan(faction, role, variant)
        if (plan.headgear !== 'none' && plan.headgear !== 'cap' && plan.headgear !== 'strap') {
          hats.add(plan.headgear)
        }
        weapons.add(plan.weapon)
      }
    }
    gear.set(faction, hats)
    assert.ok(weapons.size >= 3, `${faction} fields only ${String(weapons.size)} weapons`)
  }
  for (const [faction, hats] of gear) {
    for (const [other, otherHats] of gear) {
      if (faction === other) continue
      for (const hat of hats) {
        assert.ok(
          !otherHats.has(hat),
          `${faction} and ${other} share the headgear "${hat}"`,
        )
      }
    }
  }
})

test('roles read as roles before they read as stat blocks', () => {
  const plan = (role: string): CharacterPlan => resolveCharacterPlan('guard', role, 0)
  const brute = plan('brute')
  const scout = plan('scout')
  const commander = plan('commander')
  const archer = plan('archer')
  const peasant = plan('peasant')
  const captive = plan('captive')

  assert.ok(
    brute.proportions.shoulderX > scout.proportions.shoulderX * 1.3,
    'a brute and a scout must not share a silhouette at thirty metres',
  )
  assert.ok(brute.proportions.lean > scout.proportions.lean)
  assert.ok(commander.cloak === 'cloak', 'rank wears a full-length cloak')
  assert.ok(commander.proportions.shoulderY > plan('soldier').proportions.shoulderY)
  assert.equal(archer.weapon, 'bow')
  assert.equal(archer.mainHand, 'left', 'a bow is held in the bow hand')
  assert.equal(archer.trim, 'quiver')
  assert.equal(archer.offhand, 'none', 'an archer carries no shield')

  // Non-combatants must be readable without colour: no armour, no weapon, and
  // something in their hands that is not a weapon.
  assert.equal(peasant.armour, 'none')
  assert.equal(peasant.armed, false)
  assert.equal(peasant.offhand, 'bundle')
  assert.equal(peasant.gloved, false, 'a villager has bare hands')
  assert.equal(captive.boundArms, true)
  assert.equal(captive.armour, 'none')
  assert.equal(captive.cloak, 'rags')
  // A captive keeps a hidden dagger, because rescuing one hands it back.
  assert.equal(captive.armed, true)
  assert.equal(captive.offhand, 'none')

  // Two-handed weapons never carry an offhand, whatever the kit table wants.
  for (const faction of FACTIONS) {
    for (const role of ROLES) {
      for (let variant = 0; variant < CHARACTER_VARIANTS; variant += 1) {
        const resolved = resolveCharacterPlan(faction, role, variant)
        const twoHanded =
          resolved.weapon === 'greatsword' ||
          resolved.weapon === 'glaive' ||
          resolved.weapon === 'maul' ||
          resolved.weapon === 'staff' ||
          resolved.weapon === 'bow' ||
          resolved.weapon === 'spear'
        if (twoHanded && resolved.armour !== 'none') {
          assert.equal(
            resolved.offhand,
            'none',
            `${faction}/${role} holds a ${resolved.weapon} and a shield`,
          )
        }
      }
    }
  }
})

test('cache keys name exactly what they build', () => {
  // The contract of a shared cache: one key, one buffer. This is the check that
  // catches the subtle direction — two *different* shapes handed the same key,
  // where whichever actor spawns first silently decides what the other looks like.
  // It caught `torsoClass` collapsing `line` with `hero`, and the limb builders
  // taking a length that varies by kit even when faction and armour agree.
  const built = new Map<string, string>()
  const fingerprint = (geometry: THREE.BufferGeometry): string => {
    const position = geometry.getAttribute('position')
    const values = position.array as ArrayLike<number>
    let hash = 2166136261
    for (let index = 0; index < position.count * 3; index += 1) {
      hash ^= Math.round(values[index] * 4096)
      hash = Math.imul(hash, 16777619)
    }
    return `${String(position.count)}:${String(hash >>> 0)}`
  }
  const record = (key: string | null, geometry: THREE.BufferGeometry): void => {
    if (!key) {
      geometry.dispose()
      return
    }
    const print = fingerprint(geometry)
    const seen = built.get(key)
    if (seen === undefined) built.set(key, print)
    else assert.equal(print, seen, `two different shapes share the key "${key}"`)
    geometry.dispose()
  }
  for (const faction of FACTIONS) {
    for (const role of [...ROLES, 'player']) {
      for (let variant = 0; variant < CHARACTER_VARIANTS; variant += 1) {
        const plan = resolveCharacterPlan(faction, role, variant, role === 'player')
        const keys = characterPartKeys(plan)
        const p = plan.proportions
        record(keys.torso, buildTorso(plan))
        record(keys.head, buildHead(plan.faction))
        record(keys.face, buildFace(plan.faction))
        if (keys.hair) record(keys.hair, buildHair(plan.hair))
        record(keys.upperArm, buildUpperArm(plan.faction, plan.armour, p.upperArm))
        record(
          keys.forearm,
          buildForearm(plan.faction, plan.armour, plan.gloved, p.forearm),
        )
        if (keys.hand) record(keys.hand, buildHand())
        record(keys.thigh, buildThigh(plan.faction, plan.armour, p.thigh))
        record(keys.shin, buildShin(plan.faction, plan.armour, p.shin))
        if (keys.trim) record(keys.trim, buildTorsoTrim(plan.trim))
        if (keys.cloak) record(keys.cloak, buildCloak(plan.faction, plan.cloak))
        if (keys.headgear) record(keys.headgear, buildHeadgear(plan.headgear))
        if (keys.weaponHead) record(keys.weaponHead, buildWeaponHead(plan.weapon))
        if (keys.weaponGrip) record(keys.weaponGrip, buildWeaponGrip(plan.weapon))
        if (keys.offhand) record(keys.offhand, buildOffhand(plan.offhand))
      }
    }
  }

  // And the other direction: shapes that genuinely differ must not be forced to
  // share, or the cache is doing nothing.
  const lightGuard = resolveCharacterPlan('guard', 'scout', 0)
  const heavyGuard = resolveCharacterPlan('guard', 'brute', 0)
  assert.notEqual(
    characterPartKeys(lightGuard).torso,
    characterPartKeys(heavyGuard).torso,
  )
  assert.notEqual(
    characterPartKeys(lightGuard).thigh,
    characterPartKeys(heavyGuard).thigh,
  )
  const elfSoldier = resolveCharacterPlan('elf', 'soldier', 0)
  const guardSoldier = resolveCharacterPlan('guard', 'soldier', 0)
  assert.notEqual(characterPartKeys(elfSoldier).head, characterPartKeys(guardSoldier).head)

  // Third direction, and the one a naive key gets wrong: a key must not be *finer*
  // than the geometry either. Two keys for one buffer means the cache built and
  // holds the same shape twice, which is a leak dressed up as a lookup.
  const shapes = new Map<string, string>()
  for (const [key, print] of built) {
    const owner = shapes.get(print)
    if (owner === undefined) shapes.set(print, key)
    else
      assert.fail(
        `keys "${owner}" and "${key}" name the same buffer — the key is finer than the shape`,
      )
  }

  // A weapon key must be enough to rebuild the weapon byte for byte.
  const first = buildWeaponHead('sabre')
  const second = buildWeaponHead('sabre')
  assert.deepEqual(
    Array.from(first.getAttribute('position').array as Float32Array),
    Array.from(second.getAttribute('position').array as Float32Array),
    'the same key must name the same buffer',
  )
  first.dispose()
  second.dispose()
})

test('a crowd stays inside the draw budget it documents', () => {
  // Spec 09 §8 publishes near/far mesh counts. They were written from a sketch and
  // were wrong; measuring them here is what stops them going stale again. The
  // counts mirror `createCharacter`: every key that resolves becomes one mesh, and
  // `attachCharacterDetail` is what the far column drops.
  let worstNear = 0
  let worstFar = 0
  let worstLabel = ''
  for (const faction of FACTIONS) {
    for (const role of [...ROLES, 'player']) {
      for (let variant = 0; variant < CHARACTER_VARIANTS; variant += 1) {
        const plan = resolveCharacterPlan(faction, role, variant, role === 'player')
        const keys = characterPartKeys(plan)
        const on = (key: string | null, count = 1): number => (key ? count : 0)
        // Detail meshes: trim, face, hair, both bare hands and the weapon grip.
        const detail =
          on(keys.trim) + 1 + on(keys.hair) + on(keys.hand, 2) + on(keys.weaponGrip)
        const near =
          1 + // torso
          on(keys.cloak) +
          1 + // head
          on(keys.headgear) +
          4 + // upper arms and forearms
          4 + // thighs and shins
          on(keys.weaponHead) +
          on(keys.offhand) +
          (plan.boundArms ? 1 : 0) +
          detail
        if (near > worstNear) {
          worstNear = near
          worstLabel = `${faction}/${role}/${String(variant)}`
        }
        worstFar = Math.max(worstFar, near - detail)
      }
    }
  }
  assert.ok(
    worstNear <= CHARACTER_MESHES_NEAR,
    `worst near-field actor is ${worstLabel} at ${String(worstNear)} meshes, budget ${String(
      CHARACTER_MESHES_NEAR,
    )}`,
  )
  assert.ok(
    worstFar <= CHARACTER_MESHES_FAR,
    `worst far-field actor is ${String(worstFar)} meshes, budget ${String(CHARACTER_MESHES_FAR)}`,
  )
  // And the LOD has to be doing real work, or the budget is a formality.
  assert.ok(
    worstFar <= worstNear - 4,
    'the detail LOD must remove at least four meshes from a distant actor',
  )
})

test('the geometry cache balances across a crowd', () => {
  const cache = new GeometryCache()
  const acquired: string[] = []
  for (let index = 0; index < 25; index += 1) {
    const faction = FACTIONS[index % FACTIONS.length]
    const role = ROLES[index % ROLES.length]
    const plan = resolveCharacterPlan(faction, role, index % CHARACTER_VARIANTS)
    const keys = characterPartKeys(plan)
    for (const key of Object.values(keys)) {
      if (!key) continue
      cache.acquire(key, () => new THREE.BufferGeometry())
      acquired.push(key)
    }
  }
  assert.ok(cache.size > 0)
  assert.ok(
    cache.size < acquired.length,
    'twenty-five actors must share buffers rather than build their own',
  )
  for (const key of acquired) cache.release(key)
  assert.equal(cache.size, 0, 'the cache must empty when the last actor lets go')
  cache.dispose()
})

test('the arm solve puts the grip where three.js puts the hand', () => {
  const shoulder = new THREE.Object3D()
  const elbow = new THREE.Object3D()
  const wrist = new THREE.Object3D()
  shoulder.add(elbow)
  elbow.add(wrist)
  const upperArm = 0.58
  const forearm = 0.54
  elbow.position.y = -upperArm
  wrist.position.y = -forearm
  const solved = new THREE.Vector3()
  const expected = new THREE.Vector3()
  const cases: readonly (readonly [number, number, number])[] = [
    [0, 0, 0],
    [0.4, -0.2, 0.3],
    [-0.9, 0.35, 1.1],
    [1.4, 0.6, 0.2],
    [-1.2, -0.75, 0.85],
  ]
  for (const [armX, armZ, elbowX] of cases) {
    shoulder.rotation.set(armX, 0, armZ)
    elbow.rotation.set(elbowX, 0, 0)
    shoulder.updateMatrixWorld(true)
    expected.setFromMatrixPosition(wrist.matrixWorld)
    solveHandOffset(solved, upperArm, forearm, armX, armZ, elbowX)
    assert.ok(
      solved.distanceTo(expected) < 1e-6,
      `hand solve drifted at ${String(armX)}/${String(armZ)}/${String(elbowX)}: ` +
        `${solved.toArray().join(',')} vs ${expected.toArray().join(',')}`,
    )
  }
})

test('the four beasts are four animals', () => {
  const sizes = new Map<BeastKind, THREE.Vector3>()
  for (const kind of BEASTS) {
    const rig = BEAST_RIG[kind]
    const body = buildBeastBody(kind)
    assertSolid(body, `${kind} body`)
    body.computeBoundingBox()
    const size = new THREE.Vector3()
    body.boundingBox?.getSize(size)
    sizes.set(kind, size)
    body.dispose()
    for (const part of [
      buildBeastHead(kind),
      buildBeastLimb(kind, true, rig.frontLimb),
      buildBeastLimb(kind, false, rig.hindLimb),
      buildBeastTail(kind),
    ]) {
      assertSolid(part, `${kind} part`)
      part.dispose()
    }
    // The joints have to sit inside the animal, or the legs start in its ribs.
    assert.ok(rig.frontJointY > 0 && rig.frontJointY < rig.backHeight + 1.2)
    assert.ok(rig.frontLimb > 0 && rig.hindLimb > 0)
    assert.ok(rig.headZ > rig.hindZ, `${kind} has its head behind its hips`)
  }
  const wolf = sizes.get('wolf')
  const troll = sizes.get('troll')
  const bear = sizes.get('bear')
  assert.ok(wolf && troll && bear)
  assert.ok(
    wolf.z / wolf.y > troll.z / troll.y,
    'a wolf is long and low; a troll is not',
  )
  assert.ok(BEAST_RIG.troll.backHeight > BEAST_RIG.wolf.backHeight * 1.5)
  assert.ok(BEAST_RIG.boar.backHeight < BEAST_RIG.bear.backHeight)
})

test('the fauna and the caravan build', () => {
  for (const geometry of [
    buildDeerBody(),
    buildDeerCrown(),
    buildDeerLeg(true),
    buildDeerLeg(false),
    buildBirdBody(),
    buildBirdWing(),
  ]) {
    assertSolid(geometry, 'fauna part')
    geometry.dispose()
  }
  const wagon = [
    buildWagonFrame(),
    buildWagonBed(),
    buildWagonAxle(3.1),
    buildWagonWheel(1.02),
    buildWagonWheel(0.78),
    buildWagonTilt(),
    buildWagonCargo(false),
    buildWagonCargo(true),
    buildOxBody(),
    buildOxHead(),
    buildHarness(),
  ]
  for (const geometry of wagon) assertSolid(geometry, 'wagon part')

  // The cargo is squashed by the robbery code with `scale.y`, so it has to be
  // authored around its own origin rather than around the wagon's.
  const cargo = wagon[6]
  cargo.computeBoundingBox()
  const box = cargo.boundingBox
  assert.ok(box)
  assert.ok(
    Math.abs(box.min.y + box.max.y) < 0.6,
    'cargo must straddle its own origin so squashing it reads as a load sinking',
  )
  // A wheel spins on Z, so it has to be built in the XY plane.
  const wheel = wagon[3]
  wheel.computeBoundingBox()
  const wheelSize = new THREE.Vector3()
  wheel.boundingBox?.getSize(wheelSize)
  assert.ok(wheelSize.z < wheelSize.x * 0.4, 'a wheel must be flat along its axle')
  assert.ok(Math.abs(wheelSize.x - wheelSize.y) < 0.1, 'a wheel must be round')
  for (const geometry of wagon) geometry.dispose()
})

test('every part is wound the right way round', () => {
  // `assertSolid` already checks this for every humanoid part of every plan; this
  // covers the builders that no character plan reaches — headgear and weapons the
  // tables happen not to use, the wagon, and the mirrored pairs, where a baked
  // mirror also reverses the winding and has to be undone by hand.
  const check = (geometry: THREE.BufferGeometry, label: string): void => {
    assert.equal(
      insideOutTriangles(geometry),
      0,
      `${label} has inside-out triangles; its ink shell would cover it`,
    )
    assert.ok(
      outwardShare(geometry) >= 0.5,
      `${label} is inverted whole: only ${(outwardShare(geometry) * 100).toFixed(
        0,
      )}% of its normals face outwards`,
    )
    geometry.dispose()
  }
  for (const kind of [
    'circlet',
    'crown',
    'hood',
    'kettle',
    'nasal',
    'crested',
    'greathelm',
    'hornedHelm',
    'boneMask',
    'ragHood',
    'cap',
    'strap',
  ] as const) {
    check(buildHeadgear(kind), `headgear ${kind}`)
  }
  for (const kind of [
    'sword',
    'greatsword',
    'sabre',
    'dagger',
    'axe',
    'cleaver',
    'spear',
    'glaive',
    'mace',
    'maul',
    'bow',
    'staff',
  ] as const) {
    check(buildWeaponHead(kind), `weapon ${kind}`)
    check(buildWeaponGrip(kind), `grip ${kind}`)
  }
  for (const kind of BEASTS) {
    check(buildBeastBody(kind), `${kind} body`)
    check(buildBeastHead(kind), `${kind} head`)
    check(buildBeastLimb(kind, true, BEAST_RIG[kind].frontLimb), `${kind} front limb`)
    check(buildBeastTail(kind), `${kind} tail`)
  }
  check(buildDeerBody(), 'deer body')
  check(buildDeerCrown(), 'deer crown')
  check(buildDeerLeg(true), 'deer leg')
  check(buildBirdBody(), 'bird body')
  check(buildBirdWing(), 'bird wing')
  check(buildOxBody(), 'ox body')
  check(buildOxHead(), 'ox head')
  check(buildHarness(), 'harness')
  check(buildWagonFrame(), 'wagon frame')
  check(buildWagonAxle(3.1), 'wagon axle')
  check(buildWagonWheel(1.02), 'wagon wheel')
  check(buildWagonBed(), 'wagon bed')
  check(buildWagonTilt(), 'wagon tilt')
  check(buildWagonCargo(true), 'wagon cargo')
})

test('the load-bearing rig names are still assigned', () => {
  // Animation, dismemberment, prosthetics, gore, the torch, the weapon trail and
  // the shield pose all address the rig by name. A rename is silent at compile
  // time and catastrophic at runtime, so it is caught here instead.
  const source = readFileSync(
    fileURLToPath(new URL('../src/game/GameEngine.ts', import.meta.url)),
    'utf8',
  )
  const frozen = [
    'body-pivot',
    'torso-pivot',
    'head-pivot',
    'pelvis-pivot',
    'torso',
    'head',
    'leftArm',
    'rightArm',
    'leftLeg',
    'rightLeg',
    'weapon',
    'shield',
    'faction-ring',
  ]
  for (const name of frozen) {
    assert.ok(
      source.includes(`.name = '${name}'`) ||
        source.includes(`['${name}', -1]`) ||
        source.includes(`['${name}', 1]`),
      `the rig no longer assigns the name "${name}"`,
    )
  }
  // Fauna names the wildlife animation drives, plus the captive's rope, which
  // `unbindActorArms` looks up by name when the ropes come off.
  for (const name of ['deer-body', 'legs', 'wings', 'cargo', 'wheel', 'wrist-rope']) {
    assert.ok(source.includes(`.name = '${name}'`), `"${name}" is no longer assigned`)
  }
  // Freeing a captive has to do both halves: clear the flag that pins the arms and
  // hide the cord that says why. One without the other is worse than neither.
  const unbind = source.slice(
    source.indexOf('private unbindActorArms('),
    source.indexOf('private markCharacterShadows('),
  )
  assert.ok(unbind.includes('boundArms = false'), 'rescue must clear boundArms')
  assert.ok(unbind.includes("'wrist-rope'"), 'rescue must drop the rope')
  assert.equal(
    (source.match(/this\.unbindActorArms\(/g) ?? []).length,
    2,
    'both the rescue path and the companion restore must free a captive',
  )
  // Per-frame allocation: the pose sampler feeds a reused buffer, never a literal.
  const sampler = source.slice(
    source.indexOf('private sampleActorPose('),
    source.indexOf('private updateChampionAura('),
  )
  assert.ok(sampler.includes('this.scratchPose'), 'the actor pose must reuse its buffer')
  assert.ok(!/return\s*\{/.test(sampler), 'the actor pose must not allocate per frame')
  // Character construction must never reach for chance or the wall clock. Comments
  // are stripped first, because the docs above the code say the words too.
  const construction = source
    .slice(
      source.indexOf('private createCharacter('),
      source.indexOf('private createActorHealthBar('),
    )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  assert.ok(construction.length > 1000, 'could not isolate the construction path')
  assert.ok(
    !construction.includes('Math.random('),
    'character construction must stay deterministic',
  )
  assert.ok(!construction.includes('Date.now('))
  assert.ok(!construction.includes('performance.now('))
  // And it must not mutate a shared material to tint an actor.
  assert.ok(
    !construction.includes('offsetHSL'),
    'shared character materials must be selected, never mutated',
  )
})

/**
 * Wave 4 review. `CharacterKit` never had an independent review, and its winding
 * surface turned out to be measuring the wrong thing in three separate ways.
 *
 * ## 1. `insideOutTriangles` was never testing this module
 *
 * `ensureOutwardWinding` runs inside `loft()` and inside `finish()` — which is to say
 * inside every builder here — and it reverses exactly the triangles `insideOutTriangles`
 * counts, using the same cross product, the same `1e-14` degeneracy guard and the same
 * comparison against the same first-vertex normal. `assertSolid` requires
 * `hasOutlineNormals`, which only `finish()` sets, so *every* geometry that assertion
 * accepts has provably been through the repair. It could not have returned anything but
 * zero. `docs/10` section 13 lists this pattern as the costliest defect class on the
 * programme; this file had it and nobody had looked.
 *
 * Measured with the repair disabled: **0 inside-out triangles in 196,705, across all
 * 1235 parts the game can build.** So the repair is dead code as well as blinding, and
 * the invariant it was hiding holds on its own. `characterWindingRepairs()` is the
 * evidence surviving the fixup, and this pins it at zero.
 *
 * ## 2. Orientation needs FOUR instruments, because each is blind where the others see
 *
 * S3 measured three of them on its own builders (`docs/10` section 13) and CharacterKit
 * never got the result. Wave 4 measured a fourth here, because three were not enough:
 *
 * ```text
 * instrument           sees                          blind to
 * normal agreement     a stored normal against its   anything whose normals were
 *                      own winding                   recomputed, and everything in
 *                                                    this module (see 1)
 * signed volume        a part turned inside out      PARTIAL inversion: it SUMS, so
 *                      whole                         reversed faces cancel against
 *                                                    correct ones
 * centroid / outward   a whole flip, cheaply         partial inversion, and anything
 *                                                    not star-convex
 * edge consistency     ANY inconsistently wound      an open sheet's boundary, which
 *                      face, absolutely              it counts separately
 * ```
 *
 * The fourth is the one that closes the gap, and the gap was real. Measured on this
 * module's own parts, with 20% of each part's faces reversed and the normals then
 * recomputed — which is what `displaceGeometry` does downstream, and the exact shape
 * S3 says signed volume cannot see:
 *
 * ```text
 * part            normal agreement   outward share   signed volume   edge consistency
 * torso guard          0 (blind)      0.606 (pass)    +0.179 (pass)     36 bad  CAUGHT
 * ox body              0 (blind)      0.512 (pass)    -0.814 caught     16 bad  CAUGHT
 * wagon tilt           0 (blind)      0.530 (pass)    +0.763 (pass)     12 bad  CAUGHT
 * headgear kettle      0 (blind)      0.667 (pass)    +0.096 (pass)     24 bad  CAUGHT
 * ```
 *
 * A guard's torso with a fifth of its faces inverted passes all three of the
 * instruments this file and `docs/10` had. Edge consistency catches all twelve parts
 * tried, at every fraction, and needs no tolerance: a closed surface's every directed
 * edge has exactly one opposite twin, and reversing any face breaks that pairing
 * whatever the normals are later made to say. Measured clean across the whole roster:
 * **986 parts, 480,423 directed edges, 0 inconsistent**, with 1,919 honest boundary
 * edges from the open sheets (worst 16.67% of one part, a captive's trim).
 *
 * ## 3. Every detector is validated before it is believed
 *
 * A correctly wound control must read exactly 0 and a corrupted one must read the whole
 * population, or "0 offenders" is indistinguishable from "this function returns 0".
 *
 * ## Mutation record
 *
 * Two mutations were run against the suite as it stood before this test existed.
 *
 * **A — every finished part reversed whole, normals recomputed.** Caught, by four of
 * the existing tests. `outwardShare` does real work against a whole flip and that is
 * worth stating, because the rest of this docblock is about what it cannot do.
 *
 * **C — 20% of every *torso* reversed, normals then recomputed.** Scoped to the torso
 * on purpose: it is a part on which all three of the old instruments are blind, which
 * a roster-wide mutation hides because a handful of thinner parts do dip under the
 * `outwardShare` guard and take the suite red for the wrong reason. Result:
 *
 * ```text
 * every person the game can build actually builds     PASS
 * the three factions are different shapes             PASS
 * cache keys name exactly what they build             PASS
 * the four beasts are four animals                    PASS
 * the fauna and the caravan build                     PASS
 * every part is wound the right way round             PASS
 * this test                                           FAIL
 *   "the control torso has 36 inconsistently wound edges, so it is not a control"
 * ```
 *
 * Every torso in the game inside out across a fifth of its surface, and the whole
 * pre-existing `CharacterKit` suite reporting green. That is the gap this closes.
 */
test('character parts are oriented, measured by four instruments and not by one', () => {
  resetCharacterWindingRepairs()

  const A = new THREE.Vector3()
  const B = new THREE.Vector3()
  const C = new THREE.Vector3()
  const edgeOne = new THREE.Vector3()
  const edgeTwo = new THREE.Vector3()
  const face = new THREE.Vector3()
  const away = new THREE.Vector3()

  /**
   * Six times the signed volume of the closed hull. Absolute: it does not consult the
   * normals, so `computeVertexNormals` cannot launder it the way it launders every
   * winding-versus-normal check. Blind to partial inversion, because it is a sum.
   */
  const signedVolume = (geometry: THREE.BufferGeometry): number => {
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    const count = index ? index.count : position.count
    let total = 0
    for (let triangle = 0; triangle + 2 < count; triangle += 3) {
      A.fromBufferAttribute(position, index ? index.getX(triangle) : triangle)
      B.fromBufferAttribute(position, index ? index.getX(triangle + 1) : triangle + 1)
      C.fromBufferAttribute(position, index ? index.getX(triangle + 2) : triangle + 2)
      total += A.dot(face.crossVectors(B, C))
    }
    return total / 6
  }

  /**
   * Faces whose winding points back towards the part's own centroid, and how many were
   * judged at all. Not an absolute zero: these parts are not star-convex — a wagon tilt
   * and an antler have a large honest baseline — so this is read as a sensitivity
   * instrument, never as a pass mark.
   */
  const centroidInward = (geometry: THREE.BufferGeometry): { inward: number, judged: number } => {
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    const count = index ? index.count : position.count
    const centre = new THREE.Vector3()
    const vertex = new THREE.Vector3()
    for (let point = 0; point < position.count; point += 1) {
      centre.add(vertex.fromBufferAttribute(position, point))
    }
    centre.multiplyScalar(1 / position.count)
    let inward = 0
    let judged = 0
    for (let triangle = 0; triangle + 2 < count; triangle += 3) {
      A.fromBufferAttribute(position, index ? index.getX(triangle) : triangle)
      B.fromBufferAttribute(position, index ? index.getX(triangle + 1) : triangle + 1)
      C.fromBufferAttribute(position, index ? index.getX(triangle + 2) : triangle + 2)
      edgeOne.subVectors(B, A)
      edgeTwo.subVectors(C, A)
      face.crossVectors(edgeOne, edgeTwo)
      if (face.lengthSq() < 1e-14) continue
      away.copy(A).add(B).add(C).divideScalar(3).sub(centre)
      if (away.lengthSq() < 1e-14) continue
      judged += 1
      if (face.dot(away) <= 0) inward += 1
    }
    return { inward, judged }
  }

  /**
   * Directed edges that have no opposite twin, and boundary edges counted apart.
   *
   * On a closed, consistently oriented surface every undirected edge is traversed
   * exactly twice, once in each direction. Reversing a single face flips its three
   * edges, so each one loses its twin and doubles up with its neighbour's copy — the
   * pairing breaks whatever the normals are later made to say, which is what makes
   * this the only instrument here that survives `computeVertexNormals` AND sees a
   * partial inversion.
   *
   * Vertices are matched by quantised position, not by index: these parts are merged,
   * non-indexed, and share corners only geometrically. `1e-4` is four times finer than
   * `bakeOutlineNormals` welds at (`1e-3`), so anything this module already treats as
   * one point is one point here too, and it measured 0 inconsistent edges in 480,423.
   *
   * An edge traversed once with no twin is a boundary — an open sheet, of which this
   * module has several — and is counted separately rather than treated as a fault.
   * An edge traversed *twice in the same direction* is never legitimate.
   */
  const inconsistentEdges = (
    geometry: THREE.BufferGeometry,
  ): { bad: number, edges: number, boundary: number } => {
    const position = geometry.getAttribute('position')
    const inverse = 1 / 1e-4
    const key = (vertex: number): string =>
      `${String(Math.round(position.getX(vertex) * inverse))}|`
      + `${String(Math.round(position.getY(vertex) * inverse))}|`
      + `${String(Math.round(position.getZ(vertex) * inverse))}`
    const directed = new Map<string, number>()
    let edges = 0
    for (let triangle = 0; triangle + 2 < position.count; triangle += 3) {
      const corners = [key(triangle), key(triangle + 1), key(triangle + 2)]
      // A triangle with two corners at the same point has no area and no orientation.
      if (
        corners[0] === corners[1]
        || corners[1] === corners[2]
        || corners[0] === corners[2]
      ) continue
      for (let corner = 0; corner < 3; corner += 1) {
        const edge = `${corners[corner]}>${corners[(corner + 1) % 3]}`
        directed.set(edge, (directed.get(edge) ?? 0) + 1)
        edges += 1
      }
    }
    let bad = 0
    let boundary = 0
    for (const [edge, count] of directed) {
      const [from, to] = edge.split('>')
      const twin = directed.get(`${to}>${from}`) ?? 0
      if (twin === 0) {
        if (count === 1) boundary += 1
        else bad += count
      } else if (count !== twin) bad += Math.abs(count - twin)
    }
    return { bad, edges, boundary }
  }

  /** Reverses the first `fraction` of a geometry's triangles, in place. */
  const reverseFraction = (geometry: THREE.BufferGeometry, fraction: number): number => {
    const position = geometry.getAttribute('position')
    const triangles = Math.floor(position.count / 3)
    const target = Math.max(1, Math.floor(triangles * fraction))
    for (const name of Object.keys(geometry.attributes)) {
      const attribute = geometry.getAttribute(name)
      const size = attribute.itemSize
      const array = attribute.array as unknown as Record<number, number>
      for (let triangle = 0; triangle < target * 3; triangle += 3) {
        for (let component = 0; component < size; component += 1) {
          const first = (triangle + 1) * size + component
          const second = (triangle + 2) * size + component
          const swap = array[first]
          array[first] = array[second]
          array[second] = swap
        }
      }
    }
    return target
  }

  // ---- instrument validation, before anything is believed --------------------
  const control = buildTorso(resolveCharacterPlan('guard', 'soldier', 0))
  // The control has to be clean before it can validate anything, and edge consistency
  // is the only instrument here that can establish that on its own: it needs no
  // baseline, no tolerance and no reference geometry. Everything below compares a
  // corrupted copy against this one, so a corrupt control would quietly invert the
  // meaning of every assertion that follows.
  const controlEdges = inconsistentEdges(control)
  assert.equal(
    controlEdges.bad,
    0,
    `the control torso has ${String(controlEdges.bad)} inconsistently wound edges, so it `
    + 'is not a control. Every comparison below is against it and would be measuring the '
    + 'difference between two faults.',
  )
  assert.ok(
    controlEdges.edges > 1000,
    `the edge check judged only ${String(controlEdges.edges)} directed edges on a torso`,
  )
  const controlVolume = signedVolume(control)
  const controlCentroid = centroidInward(control)
  assert.ok(controlCentroid.judged > 0, 'the control judged no faces at all')
  assert.ok(controlVolume > 0, `a correct torso must enclose positive volume, got ${controlVolume.toFixed(6)}`)

  const flipped = control.clone()
  const flippedCount = reverseFraction(flipped, 1)
  assert.ok(flippedCount > 0, 'the whole-flip control reversed no triangles')
  assert.ok(
    signedVolume(flipped) < 0,
    'signed volume must go negative on a fully reversed part, or it cannot see a flip',
  )
  assert.equal(
    insideOutTriangles(flipped),
    controlCentroid.judged,
    'the normal-agreement check must report every judged face on a fully reversed part',
  )
  // The laundering case, which is why signed volume is here at all: recomputing the
  // normals makes them agree with the new winding, so the relative check goes silent
  // while the geometry is still inside out.
  const laundered = flipped.clone()
  laundered.deleteAttribute('normal')
  laundered.computeVertexNormals()
  assert.equal(
    insideOutTriangles(laundered),
    0,
    'this assertion documents the weakness: after computeVertexNormals a reversed part '
    + 'agrees with itself perfectly. If it ever fails, the relative check got stronger '
    + 'and this comment is stale.',
  )
  assert.ok(
    signedVolume(laundered) < 0,
    'signed volume must still see the reversal that computeVertexNormals laundered',
  )
  // And the blindness that makes signed volume insufficient on its own, measured here
  // rather than quoted: reverse a small fraction and the sum barely moves.
  const partial = control.clone()
  const partialCount = reverseFraction(partial, 0.05)
  const partialCentroid = centroidInward(partial)
  assert.ok(partialCount > 0, 'the partial-flip control reversed no triangles')
  assert.ok(
    signedVolume(partial) > 0,
    `signed volume still reads positive with ${String(partialCount)} faces reversed, which `
    + 'is the documented blindness — if this ever fails, signed volume became sensitive '
    + 'to partial inversion and the three-instrument rule can be revisited',
  )
  assert.ok(
    partialCentroid.inward > controlCentroid.inward,
    `the centroid count must RISE when ${String(partialCount)} faces are reversed `
    + `(${String(controlCentroid.inward)} -> ${String(partialCentroid.inward)}); it is the `
    + 'only one of the three sign instruments that responds to a partial inversion',
  )

  // The fourth instrument, and the case that motivates it. A partial inversion whose
  // normals are then recomputed defeats all three of the others on a torso; this is
  // the control that proves edge consistency does not join them.
  const laundering = control.clone()
  const launderedFaces = reverseFraction(laundering, 0.2)
  laundering.deleteAttribute('normal')
  laundering.computeVertexNormals()
  assert.ok(launderedFaces > 0, 'the laundered partial control reversed no triangles')
  // All three of the instruments this file and docs/10 had, on the same geometry.
  // Asserted rather than described, so that if any of them ever becomes able to see
  // this, the claim in the docblock above fails instead of quietly going stale.
  assert.equal(
    insideOutTriangles(laundering),
    0,
    'normal agreement is expected to be blind here — computeVertexNormals rebuilt the '
    + 'normals from the reversed winding',
  )
  assert.ok(
    outwardShare(laundering) >= 0.5,
    `the outward-share guard is expected to be blind here (measured 0.606 on a guard's `
    + `torso, guard is 0.5); it read ${outwardShare(laundering).toFixed(3)}`,
  )
  assert.ok(
    signedVolume(laundering) > 0,
    `signed volume is expected to be blind here (measured +0.179); it read `
    + `${signedVolume(laundering).toFixed(4)}`,
  )
  const launderedEdges = inconsistentEdges(laundering)
  assert.ok(
    launderedEdges.bad > 0,
    `edge consistency must catch ${String(launderedFaces)} reversed faces that the other `
    + 'three instruments all pass; it read 0, so nothing in this test can see a partial '
    + 'inversion and the whole orientation surface is back to being decorative',
  )
  control.dispose()
  flipped.dispose()
  laundered.dispose()
  partial.dispose()
  laundering.dispose()

  // ---- the sweep over every part the game can build --------------------------
  const parts: [string, THREE.BufferGeometry][] = []
  for (const faction of FACTIONS) {
    for (const role of [...ROLES, 'player']) {
      for (let variant = 0; variant < CHARACTER_VARIANTS; variant += 1) {
        const plan = resolveCharacterPlan(faction, role, variant, role === 'player')
        const keys = characterPartKeys(plan)
        const p = plan.proportions
        const tag = `${faction}/${role}/${String(variant)}`
        parts.push([`${tag}:torso`, buildTorso(plan)])
        parts.push([`${tag}:head`, buildHead(plan.faction)])
        parts.push([`${tag}:upperArm`, buildUpperArm(plan.faction, plan.armour, p.upperArm)])
        parts.push([`${tag}:thigh`, buildThigh(plan.faction, plan.armour, p.thigh)])
        parts.push([`${tag}:shin`, buildShin(plan.faction, plan.armour, p.shin)])
        if (keys.headgear) parts.push([`${tag}:headgear:${plan.headgear}`, buildHeadgear(plan.headgear)])
        if (keys.weaponHead) parts.push([`${tag}:weapon:${plan.weapon}`, buildWeaponHead(plan.weapon)])
      }
    }
  }
  for (const kind of BEASTS) {
    parts.push([`beast:${kind}:body`, buildBeastBody(kind)])
    parts.push([`beast:${kind}:head`, buildBeastHead(kind)])
    parts.push([`beast:${kind}:tail`, buildBeastTail(kind)])
  }
  parts.push(['deer:body', buildDeerBody()])
  parts.push(['bird:body', buildBirdBody()])
  parts.push(['ox:body', buildOxBody()])
  parts.push(['wagon:bed', buildWagonBed()])
  parts.push(['wagon:wheel', buildWagonWheel(1.02)])
  parts.push(['harness', buildHarness()])

  let judgedParts = 0
  let judgedFaces = 0
  let judgedEdges = 0
  const hollow: string[] = []
  const disagreeing: string[] = []
  const inconsistent: string[] = []
  let smallestVolume = Infinity
  for (const [label, geometry] of parts) {
    const volume = signedVolume(geometry)
    const { inward, judged } = centroidInward(geometry)
    assert.ok(judged > 0, `${label} was judged on no faces, so its result means nothing`)
    void inward
    judgedParts += 1
    judgedFaces += judged
    smallestVolume = Math.min(smallestVolume, volume)
    if (volume <= 0) hollow.push(`${label} (volume ${volume.toFixed(6)})`)
    const disagree = insideOutTriangles(geometry)
    if (disagree > 0) disagreeing.push(`${label} (${String(disagree)} triangles)`)
    const edges = inconsistentEdges(geometry)
    judgedEdges += edges.edges
    if (edges.bad > 0) inconsistent.push(`${label} (${String(edges.bad)} edges)`)
    geometry.dispose()
  }

  // Domain guards. Pinned, not floored, where the number is derivable: 3 factions x 10
  // roles x 3 variants is 90 plans, and every plan contributes at least five parts.
  assert.ok(
    judgedParts >= 450,
    `only ${String(judgedParts)} parts were judged; the sweep is not covering the roster`,
  )
  assert.ok(
    judgedFaces >= 40000,
    `only ${String(judgedFaces)} faces were judged across ${String(judgedParts)} parts`,
  )
  // The edge instrument has its own domain, because it skips zero-area triangles and
  // would report a spotless zero over a population it had entirely discarded.
  assert.ok(
    judgedEdges >= 150000,
    `only ${String(judgedEdges)} directed edges were judged; the edge instrument threw `
    + 'away most of the roster as degenerate, so its zero means nothing',
  )
  assert.deepEqual(
    hollow.slice(0, 8),
    [],
    'these parts enclose zero or negative volume, so they are inside out whole and will '
    + 'light from within while their ink shell extrudes inward and disappears',
  )
  assert.deepEqual(
    disagreeing.slice(0, 8),
    [],
    'these parts have triangles wound against their own normals',
  )
  assert.deepEqual(
    inconsistent.slice(0, 8),
    [],
    'these parts have edges traversed twice in the same direction, which means some of '
    + 'their faces are wound against their neighbours. Measured clean across the whole '
    + 'roster (986 parts, 480,423 directed edges, 0 inconsistent), and it is the only '
    + 'one of the four instruments that sees a PARTIAL inversion — so a failure here '
    + 'with the other three green is the expected shape, not a contradiction.',
  )
  // Measured: the smallest enclosed volume across the roster is 0.0012 (a bird wing).
  // Asserted as a floor rather than left implicit, because a part that collapsed to a
  // sheet would pass every sign test above while enclosing nothing.
  assert.ok(
    smallestVolume > 1e-4,
    `the thinnest part encloses only ${smallestVolume.toExponential(3)}, which is close `
    + 'enough to a flat sheet that the volume instrument cannot speak about it',
  )

  // The whole point of the counter: the repair is allowed to exist, and is not allowed
  // to be doing anything. Measured Wave 4 across all 1235 buildable parts: 0 of 196,705
  // triangles. A non-zero here means a GeometryKit builder regressed and this module
  // quietly papered over it — which is exactly the failure the counter exists to expose.
  assert.equal(
    characterWindingRepairs(),
    0,
    `ensureOutwardWinding reversed ${String(characterWindingRepairs())} triangles while `
    + 'building the roster. It is meant to be a no-op: the foundation fixed loftProfile, '
    + 'and a non-zero count means something upstream now emits triangles wound against '
    + 'their own normals and this module is hiding it from every assertion downstream.',
  )
})
