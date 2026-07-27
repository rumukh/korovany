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
