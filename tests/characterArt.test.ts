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
  buildCharacterSkeleton,
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
  WAGON_RIG,
  type BeastKind,
  type CharacterFaction,
  type CharacterPartKeys,
  type CharacterPlan,
  type CharacterProportions,
  type CharacterSkeleton,
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
 * Spec 09 §8 — `GEOMETRY_CACHE_ENTRIES_MAX`, the whole of `GameEngine.artGeometry`.
 *
 * Not `CHARACTER_GEOMETRY_KEYS<=180`, which is a different budget over a different
 * population and is correctly measured at 140 by the plan sweep above. This is the one
 * §8 describes as "one engine-side cache now holds humanoid parts, beasts, fauna and
 * the caravan" — and which `docs/10` records as existing "in no code at all, only in
 * the two specs".
 */
const GEOMETRY_CACHE_ENTRIES_MAX = 220

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
/** Every kind the builders accept, including the ones no plan table selects. */
const HEADGEAR_KINDS = [
  'circlet', 'crown', 'hood', 'kettle', 'nasal', 'crested',
  'greathelm', 'hornedHelm', 'boneMask', 'ragHood', 'cap', 'strap',
] as const
const WEAPON_KINDS = [
  'sword', 'greatsword', 'sabre', 'dagger', 'axe', 'cleaver',
  'spear', 'glaive', 'mace', 'maul', 'bow', 'staff',
] as const

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
  // The four pivots are now named by `buildCharacterSkeleton`, so the humanoid rig
  // lives in two files. Search both: `createBeast` still names all four in the
  // engine, and searching only the engine would have gone on passing for a body
  // that had lost every one of them.
  const kit = readFileSync(
    fileURLToPath(new URL('../src/game/art/CharacterKit.ts', import.meta.url)),
    'utf8',
  )
  const rigSource = `${source}\n${kit}`
  const frozen = [
    'body-pivot',
    'torso-pivot',
    // Newer than the rest and not in docs/09's bold list, but load-bearing all the
    // same: `applyActorVisualVariation` finds it by name to divide the chest's
    // shoulder width back out. Rename it and the correction silently stops.
    'neck-pivot',
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
      rigSource.includes(`.name = '${name}'`) ||
        rigSource.includes(`['${name}', -1]`) ||
        rigSource.includes(`['${name}', 1]`),
      `the rig no longer assigns the name "${name}"`,
    )
  }
  // The humanoid pivots come from one builder, and the head hangs off the chest
  // inside it. An engine that went back to building its own would compile, pass
  // every other assertion here, and put the heads back behind the necks.
  assert.ok(
    kit.includes('torsoPivot.add(neckPivot)') && kit.includes('neckPivot.add(headPivot)'),
    'buildCharacterSkeleton must hang the neck off the spine and the head off the neck',
  )
  assert.ok(
    source.includes('buildCharacterSkeleton(p)'),
    'createCharacter must take its pivots from buildCharacterSkeleton',
  )
  assert.equal(
    (source.match(/bodyPivot\.add\(headPivot\)/g) ?? []).length,
    1,
    'only createBeast may root a head-pivot at the body; a person hangs one off the spine',
  )
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
 * The head is a joint on the spine, not a second root at the feet.
 *
 * ## What was wrong
 *
 * `head-pivot` was built as a *sibling* of `torso-pivot`, both at the actor's own
 * origin — the ground between the feet — with the head placed at `headY` above it.
 * At rest that is indistinguishable from a neck, which is why it shipped: with
 * every rotation at zero the head lands exactly where the collar is, and this file
 * had no test that posed a body before measuring it.
 *
 * It comes apart the moment anything rotates. `animateActorCharacter` writes the
 * plan's own `lean` into `torso-pivot.rotation.x`, swinging the collar forward
 * through the entire 2.1–2.3 m lever arm from the ground to the shoulders, while a
 * head rooted at the feet on a different pivot does not move at all.
 *
 * ## Measured, on the sibling rig, over the 27 faction x role proportion sets
 *
 * Distance between the head and where `torso-pivot` puts it — the same quantity
 * assertion 1 below measures.
 *
 * | pose | worst |
 * | --- | --- |
 * | rest, nothing posed | **0.0000** |
 * | standing, plan `lean` only | **0.4992** (brute, `lean` 0.20) |
 * | walking, `lean` + gait lean | **0.6835** (elf brute) |
 * | deepest reachable hunch, 0.83 rad | **2.3385** |
 *
 * A head is 0.66 m deep. Three-quarters of a head, backwards, standing still.
 *
 * The roles whose `lean` is zero — elf and guard soldier, minion, archer, champion
 * — measured 0.0000 standing and only came apart once they walked, which is how a
 * whole-population defect gets reported as "some of them". The player was never
 * affected: `animateCharacter`, the only pose pass the player gets, never writes
 * `torso-pivot`'s transform, and only actors run `animateActorCharacter`. That is
 * the whole of "the NPC heads are wrong and mine is fine", and it is why no
 * constant offset could have fixed it — the displacement is a rotation times a
 * lever arm, so it changes with the pose.
 *
 * ## What this test is
 *
 * Two invariants, both consequences of the hierarchy rather than of any number:
 *
 * 1. **Rigid.** The head's world position is whatever `torso-pivot` says it is.
 *    Exact — to 1e-12 — for every transform the engine can write.
 * 2. **Hinged at the neck.** Turning the head moves it on an arc whose radius is
 *    the neck-to-head distance, ~0.5 m, not the ground-to-head distance, ~2.7 m.
 *
 * ## Mutation proof
 *
 * Reverting `buildCharacterSkeleton` to the shipped arrangement — `head-pivot`
 * parented to `bodyPivot`, at y 0, with `headY` back to `p.headY` — takes
 * assertion 1 to **2.3385 m off** at `elf/soldier/0` in "deepest hunch" and
 * assertion 2 to **1.3795 m against a 0.4872 m bound** at the same plan. On the
 * real tree assertion 1 reads 0 and assertion 2 reads well inside its arc.
 *
 * The mutation run earned its keep twice: assertion 2's bound was first written
 * against `skeleton.headY`, which the mutation *also* changes, so the bound grew
 * with the number it was bounding and the assertion could not fail. It is now
 * derived from the proportion table instead. A check whose answer moves with the
 * thing it is checking is not a check.
 */
test('the head is rigid with the chest and hinges at the neck', () => {
  // Every transform `animateActorCharacter` and `applyActorVisualVariation` can
  // write onto `torso-pivot`, at the extreme of each term. Named so a reader can
  // find the line each one comes from; the invariant holds for any transform at
  // all, so this table is breadth, not a bound.
  const POSES: readonly {
    name: string
    x: number
    rotation: readonly [number, number, number]
    scale: readonly [number, number, number]
  }[] = [
    { name: 'rest', x: 0, rotation: [0, 0, 0], scale: [1, 1, 1] },
    // rotation.x: forwardLean * motionBlend + attack + stagger + storm hunch + lean
    { name: 'deepest hunch', x: 0, rotation: [0.83, 0, 0], scale: [1, 1, 1] },
    // rotation.x: anticipation * 0.16 against an officer's negative lean
    { name: 'windup', x: 0, rotation: [-0.2, 0, 0], scale: [1, 1, 1] },
    // rotation.y: stride * 0.12 + attack * 0.16 + flinch * 0.22
    { name: 'twist', x: 0, rotation: [0, -0.5, 0], scale: [1, 1, 1] },
    // rotation.z: turnLean * 0.16 + idleWeightShift * 0.55 + flinch * 0.18
    { name: 'turn roll', x: 0.035, rotation: [0, 0, -0.28], scale: [1, 1, 1] },
    // scale.x is the actor's shoulder width, scale.y the breath.
    { name: 'broad and inhaling', x: -0.035, rotation: [0.2, 0.1, 0.1], scale: [1.07, 1.01, 1] },
    { name: 'narrow and exhaling', x: 0.02, rotation: [0.4, -0.3, 0.2], scale: [0.93, 0.99, 1] },
    { name: 'staggered back', x: 0, rotation: [-0.2, 0.4, 0.28], scale: [1, 1, 1] },
  ]

  const restLocal = new THREE.Vector3()
  const expected = new THREE.Vector3()
  const actual = new THREE.Vector3()
  const rest = new THREE.Vector3()
  const joints: {
    label: string
    skeleton: CharacterSkeleton
    p: CharacterProportions
    head: THREE.Object3D
    rest: THREE.Vector3
  }[] = []
  let worstRigid = 0
  let worstRigidAt = ''
  let checked = 0

  for (const faction of FACTIONS) {
    for (const role of [...ROLES, 'player'] as const) {
      for (let variant = 0; variant < CHARACTER_VARIANTS; variant += 1) {
        const plan = resolveCharacterPlan(faction, role, variant, role === 'player')
        const p = plan.proportions
        const skeleton = buildCharacterSkeleton(p)
        const label = `${faction}/${role}/${String(variant)}`
        checked += 1

        // The head mesh, placed exactly as `createCharacter` places it.
        const head = new THREE.Object3D()
        head.position.y = skeleton.headY
        head.scale.setScalar(p.headScale)
        skeleton.headPivot.add(head)

        // Where the head sits in the chest's own frame. Not a magic number: the
        // pivot chain has to reproduce the proportion table's `headY` above the
        // ground with nothing posed, or the fix has moved the art.
        skeleton.root.updateMatrixWorld(true)
        rest.setFromMatrixPosition(head.matrixWorld)
        assert.ok(
          Math.abs(rest.x) < 1e-12 && Math.abs(rest.z) < 1e-12 &&
            Math.abs(rest.y - p.headY) < 1e-12,
          `${label}: at rest the head must stand at (0, ${p.headY.toFixed(3)}, 0), not `
          + `(${rest.x.toFixed(4)}, ${rest.y.toFixed(4)}, ${rest.z.toFixed(4)}). The rig `
          + 'change must be invisible on a body nothing has posed.',
        )
        restLocal.copy(rest)

        // 1. Rigid with the chest.
        for (const pose of POSES) {
          skeleton.torsoPivot.position.x = pose.x
          skeleton.torsoPivot.rotation.set(...pose.rotation)
          skeleton.torsoPivot.scale.set(...pose.scale)
          skeleton.root.updateMatrixWorld(true)
          actual.setFromMatrixPosition(head.matrixWorld)
          expected.copy(restLocal).applyMatrix4(skeleton.torsoPivot.matrixWorld)
          const off = actual.distanceTo(expected)
          if (off > worstRigid) {
            worstRigid = off
            worstRigidAt = `${label} in "${pose.name}"`
          }
        }
        skeleton.torsoPivot.position.x = 0
        skeleton.torsoPivot.rotation.set(0, 0, 0)
        skeleton.torsoPivot.scale.set(1, 1, 1)

        joints.push({ label, skeleton, p, head, rest: rest.clone() })
      }
    }
  }

  assert.equal(checked, FACTIONS.length * (ROLES.length + 1) * CHARACTER_VARIANTS)
  assert.ok(
    worstRigid < 1e-12,
    `the head left the chest by ${worstRigid.toFixed(4)} m at ${worstRigidAt}. `
    + 'It must be a child of `torso-pivot`, so that whatever the chest does the head '
    + 'does too. Do not answer this with an offset: the displacement is a rotation '
    + 'times a lever arm and changes with every frame of the pose.',
  )

  // 2. Hinged at the neck. The head's own rotations are look, counter-pitch and
  //    counter-roll — they turn a skull, they do not swing a body.
  for (const { label, skeleton, p, head, rest: restAt } of joints) {
    const turn = 0.3
    skeleton.headPivot.rotation.set(turn, turn, turn)
    skeleton.root.updateMatrixWorld(true)
    actual.setFromMatrixPosition(head.matrixWorld)
    const swung = actual.distanceTo(restAt)
    // Chord of the arc, generous by a factor of two on the three-axis case. Derived
    // from the proportion table and NOT from `skeleton.headY`: a bound that grows
    // with the number it is bounding cannot fail, and that is exactly what the first
    // draft of this line did — the mutation run caught it, not review.
    const bound = 2 * (p.headY - p.shoulderY) * Math.sin(turn * 1.5)
    assert.ok(
      swung <= bound,
      `${label}: turning the head ${turn.toFixed(2)} rad moved it ${swung.toFixed(4)} m, `
      + `over the ${bound.toFixed(4)} m an arc about the neck allows. head-pivot is `
      + 'hinged somewhere below the neck — at the feet, it swings the whole body.',
    )
    assert.ok(swung > 0, `${label}: the head must actually turn`)
    skeleton.headPivot.rotation.set(0, 0, 0)
  }

  // The joints themselves: the neck at the shoulder line on the spine, the head's
  // rotation below it, carrying a head measured from the neck. Last, so that a rig
  // which has come apart reports how far by.
  for (const { label, skeleton, p } of joints) {
    assert.equal(skeleton.neckPivot.parent, skeleton.torsoPivot, `${label}: neck off the spine`)
    assert.equal(skeleton.headPivot.parent, skeleton.neckPivot, `${label}: head off the neck`)
    assert.equal(skeleton.neckPivot.position.y, p.shoulderY, `${label}: neck off the shoulders`)
    assert.equal(skeleton.headY, p.headY - p.shoulderY, `${label}: head Y not neck-relative`)
  }
})

/**
 * A head keeps its own proportions, whichever way it is looking.
 *
 * `torso-pivot` is not only a joint. `applyActorVisualVariation` writes this actor's
 * shoulder width to its `scale.x` — `around(1, 0.07)` — and the breathing pass writes
 * `scale.y` every frame. Hanging the neck off the chest, which is what stops the head
 * leaving the body, also hands the head that width, and a head is not a pair of
 * shoulders: `headScale` is supposed to be the only thing that sizes a skull.
 *
 * So the width is divided back out. **Where** it is divided out is the whole test.
 * The first version of this fix put the correction on `head-pivot`, which the
 * animation rotates by up to 0.65 rad of look yaw — and a shrink along the head's
 * local x does not cancel a stretch along the world's X once those two frames differ.
 * Measured over the whole look envelope below, with the widest shoulders and a full
 * inhale, across all 30 faction x role plans:
 *
 * | correction | worst head anisotropy |
 * | --- | --- |
 * | none | **7.00%** (elf soldier, facing forward) |
 * | on the rotated `head-pivot` | **5.34%** (elf peasant, full yaw) |
 * | on the unrotated `neck-pivot` | **0.99%**, which is the chest's breath |
 *
 * The middle row is the point: it is better than nothing only while the actor looks
 * straight ahead, and a compensation that is right at one angle is not a fix. Note
 * also that the first draft of these numbers quoted 3.00% for "none" — that was one
 * pose of one plan, not the worst of the envelope, and it would have understated the
 * defect by more than half. The envelope is what the assertion sweeps.
 *
 * The bound below is 2%: above the 1% the breath is allowed to contribute, and well
 * under either broken arrangement.
 */
test('the chest lends the head its breath but not its shoulders', () => {
  // The widest chest the engine can write: `around(1, 0.07)` at its extreme, times
  // the breathing pass's `1 + breathing * 0.55` at the top of an inhale.
  const SHOULDERS = 1.07
  const BREATH = 1 + 0.018 * 0.55
  // Everything `animateActorCharacter` and `animateDeath` write to `head-pivot`:
  // look yaw clamped to 0.65, stagger pitch, and the death roll.
  const LOOKS: readonly (readonly [number, number, number])[] = [
    [0, 0, 0],
    [0, 0.65, 0],
    [0, -0.65, 0],
    [0.18, 0.65, 0.3],
    [-0.12, 0.4, -0.28],
  ]
  const axis = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const basis = new THREE.Matrix3()
  let worst = 0
  let worstAt = ''

  for (const faction of FACTIONS) {
    for (const role of [...ROLES, 'player'] as const) {
      const plan = resolveCharacterPlan(faction, role, 0, role === 'player')
      const p = plan.proportions
      const skeleton = buildCharacterSkeleton(p)
      const head = new THREE.Object3D()
      head.position.y = skeleton.headY
      head.scale.setScalar(p.headScale)
      skeleton.headPivot.add(head)
      // As `applyActorVisualVariation` sets them.
      skeleton.torsoPivot.scale.set(SHOULDERS, BREATH, 1)
      skeleton.neckPivot.scale.x = 1 / SHOULDERS

      for (const look of LOOKS) {
        skeleton.headPivot.rotation.set(...look)
        skeleton.root.updateMatrixWorld(true)
        basis.setFromMatrix4(head.matrixWorld)
        for (let i = 0; i < 3; i += 1) {
          axis[i].set(Number(i === 0), Number(i === 1), Number(i === 2)).applyMatrix3(basis)
        }
        const lengths = axis.map((v) => v.length())
        const anisotropy = Math.max(...lengths) / Math.min(...lengths) - 1
        if (anisotropy > worst) {
          worst = anisotropy
          worstAt = `${faction}/${role} looking [${look.map((v) => v.toFixed(2)).join(', ')}]`
        }
      }
    }
  }

  assert.ok(
    worst <= 0.02,
    `the head came out ${(worst * 100).toFixed(2)}% anisotropic at ${worstAt}. The chest's `
    + 'shoulder width has reached the skull. Divide it out on `neck-pivot`, which does not '
    + 'rotate — on `head-pivot` the correction only cancels while the actor looks straight '
    + 'ahead, and at full yaw it is worse than no correction at all.',
  )
})

/**
 * The beasts keep the sibling arrangement, and this pins what makes that safe.
 *
 * `createBeast` roots `head-pivot` at the animal's origin with the skull at `headY`
 * up and `headZ` forward, exactly as the humanoid rig used to. It has not been
 * moved here: a quadruped's neck is not at `shoulderY`, no one has reported a beast
 * head, and guessing at a wolf's neck joint to fix a bug that was reported about
 * people is how one regression becomes two.
 *
 * What makes it survivable is a workaround rather than a joint, and docs/09 §4 says
 * so: `animateBeastPosture` "replaces the biped shoulder bend, hip counter-rotation
 * and head yaw, all of which pull an animal apart at the joints when applied to a
 * body whose skull sits a metre forward of its own pivot". Measured on `BEAST_RIG`:
 * a wolf's skull sits **1.08 of its own units forward** of the pivot it yaws about,
 * so the clamped 0.45 rad look already sweeps it **0.48 units sideways**, and the
 * biped pass — which reaches 0.83 rad of hunch on a lever arm of 1.64 — would move
 * it **1.3**.
 *
 * So the two premises are the early return that keeps a beast out of the biped pass
 * and the clamp on the beast's own yaw. Both are load-bearing, both are one line,
 * and both are invisible to every other test in this file.
 */
test('a beast never reaches the biped posture pass, and its own yaw stays clamped', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/game/GameEngine.ts', import.meta.url)),
    'utf8',
  )
  const posture = source.slice(
    source.indexOf('private animateActorCharacter('),
    source.indexOf('private samplePlayerPose('),
  )
  assert.ok(posture.length > 1000, 'could not isolate the actor posture pass')
  // The early return, before a single torso rotation is written.
  const guard = posture.indexOf('if (rig?.beast)')
  const firstTorsoWrite = posture.indexOf('torsoPivot.rotation.x')
  assert.ok(guard > 0, 'the beast branch has gone from animateActorCharacter')
  assert.ok(
    guard < firstTorsoWrite,
    'a beast now reaches the biped shoulder bend. Its skull hangs off a pivot at the '
    + 'animal\'s centre, so the hunch that fits a person swings a wolf\'s head a metre.',
  )
  assert.ok(
    posture.slice(guard, firstTorsoWrite).includes('return'),
    'the beast branch must return, not fall through into the biped pass',
  )
  // And the beast's own pass keeps the yaw inside the arc the rig can hide.
  const beastPass = source.slice(
    source.indexOf('private animateBeastPosture('),
    source.indexOf('private sampleActorPose('),
  )
  assert.ok(beastPass.length > 400, 'could not isolate the beast posture pass')
  assert.ok(
    /clamp\(lookYaw,\s*-0\.45,\s*0\.45\)/.test(beastPass),
    'the beast head yaw is no longer clamped to +/-0.45 rad, which is the only reason '
    + 'a skull on a pivot at the animal\'s centre still reads as attached',
  )
  // The rig data the numbers above were measured from, so a rewritten table is
  // noticed here rather than in a screenshot.
  for (const kind of BEASTS) {
    const rig = BEAST_RIG[kind]
    assert.ok(
      rig.headZ > 0 && rig.headY > 0,
      `${kind}: a skull is up and forward of the body centre`,
    )
    assert.ok(
      2 * rig.headZ * Math.sin(0.45 / 2) < rig.headZ,
      `${kind}: the clamped look must sweep the skull less than its own reach forward`,
    )
  }
  // `applyActorVisualVariation` runs for beasts as well as people, and it divides
  // the chest's width back out at the neck — which only exists on a person. A beast
  // has no `neck-pivot`, so the lookup is the guard; written as a lookup rather than
  // a role test so that adding a beast neck later fixes this for free.
  const variation = source.slice(
    source.indexOf('private applyActorVisualVariation('),
    source.indexOf('private createActorHealthBar('),
  )
  assert.ok(variation.length > 500, 'could not isolate the actor variation pass')
  assert.ok(
    /getObjectByName\('neck-pivot'\)[\s\S]{0,120}neckPivot\.scale\.x = 1 \/ shoulders/.test(
      variation,
    ),
    'the shoulder-width counter-scale must go on neck-pivot, which people have and '
    + 'beasts do not, and which does not rotate',
  )
  assert.ok(
    !/headPivot\.scale/.test(variation),
    'the counter-scale must not go on head-pivot: the animation rotates it, so the '
    + 'correction stops cancelling the moment the actor looks anywhere but forward',
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
 * **1,228 parts, 588,015 directed edges, 0 inconsistent**, with 6,903 honest boundary
 * edges from the open sheets (1.17%, and asserted, because that is the number that
 * would move if the position grid started splitting shared corners).
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
   * Directed edges that are not part of exactly one opposite pair, and boundary edges
   * counted apart.
   *
   * On a closed, consistently oriented surface every undirected edge is traversed
   * exactly twice, once in each direction. Reversing a single face flips its three
   * edges, so each one loses its twin and doubles up with its neighbour's copy — the
   * pairing breaks whatever the normals are later made to say, which is what makes
   * this the only instrument here that survives `computeVertexNormals` AND sees a
   * partial inversion.
   *
   * "Exactly one each way" is asserted literally rather than as "the two directions
   * agree". Agreement alone accepts a doubled surface: two coincident copies of the
   * same closed shell give every edge a count of two in each direction, and a reviewer
   * demonstrated the looser rule reporting `{ bad: 0 }` on exactly that. Two coincident
   * shells wound *opposite* ways read the same. The strict rule costs nothing here —
   * measured across the whole roster it reports the identical zero as the loose one.
   *
   * Vertices are matched by quantised position, not by index: these parts are merged,
   * non-indexed, and share corners only geometrically. `1e-4` is a *finer* grid than
   * `bakeOutlineNormals` welds at, so it is the conservative direction — it can split a
   * shared corner into two, which turns real edges into boundary edges and makes this
   * check blinder, never noisier. That is why the boundary count is returned and
   * asserted rather than discarded: it is the number that would move if the grid
   * started splitting corners. Measured both ways over 1,228 parts: `1e-4` gives
   * 588,015 directed edges and 6,903 boundary; `1e-3` gives 586,485 and 6,633. A 0.26%
   * difference in edges and 4% in boundary means the geometry is nowhere near the
   * quantisation, which is the thing worth knowing.
   *
   * An edge traversed once with no twin is a boundary — an open sheet, of which this
   * module has several — and is counted separately rather than treated as a fault.
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
      } else if (count !== 1 || twin !== 1) bad += count
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
  // Every builder, not a selection. A reviewer found the first version of this sweep
  // reaching seven part kinds per plan, which left faces, hair, forearms, hands, trim,
  // cloaks, grips, offhands, beast limbs, deer legs, bird wings, ox heads and half the
  // wagon outside both the edge check and the repair counter — and the counter is reset
  // above, so any evidence those builders produced earlier in the file was erased.
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
        parts.push([`${tag}:face`, buildFace(plan.faction)])
        if (keys.hair) parts.push([`${tag}:hair:${plan.hair}`, buildHair(plan.hair)])
        parts.push([`${tag}:upperArm`, buildUpperArm(plan.faction, plan.armour, p.upperArm)])
        parts.push([
          `${tag}:forearm`,
          buildForearm(plan.faction, plan.armour, plan.gloved, p.forearm),
        ])
        if (keys.hand) parts.push([`${tag}:hand`, buildHand()])
        parts.push([`${tag}:thigh`, buildThigh(plan.faction, plan.armour, p.thigh)])
        parts.push([`${tag}:shin`, buildShin(plan.faction, plan.armour, p.shin)])
        if (keys.trim) parts.push([`${tag}:trim:${plan.trim}`, buildTorsoTrim(plan.trim)])
        if (keys.cloak) {
          parts.push([`${tag}:cloak:${plan.cloak}`, buildCloak(plan.faction, plan.cloak)])
        }
        if (keys.headgear) {
          parts.push([`${tag}:headgear:${plan.headgear}`, buildHeadgear(plan.headgear)])
        }
        if (keys.weaponHead) {
          parts.push([`${tag}:weaponHead:${plan.weapon}`, buildWeaponHead(plan.weapon)])
        }
        if (keys.weaponGrip) {
          parts.push([`${tag}:weaponGrip:${plan.weapon}`, buildWeaponGrip(plan.weapon)])
        }
        if (keys.offhand) parts.push([`${tag}:offhand:${plan.offhand}`, buildOffhand(plan.offhand)])
      }
    }
  }
  parts.push(['wrist-rope', buildWristRope()])
  // The headgear and weapon kinds the plan tables happen never to select, which is
  // where a builder can rot unbuilt for a whole wave.
  for (const kind of HEADGEAR_KINDS) parts.push([`headgear:${kind}`, buildHeadgear(kind)])
  for (const kind of WEAPON_KINDS) {
    parts.push([`weaponHead:${kind}`, buildWeaponHead(kind)])
    parts.push([`weaponGrip:${kind}`, buildWeaponGrip(kind)])
  }
  for (const kind of BEASTS) {
    parts.push([`beast:${kind}:body`, buildBeastBody(kind)])
    parts.push([`beast:${kind}:head`, buildBeastHead(kind)])
    parts.push([`beast:${kind}:front`, buildBeastLimb(kind, true, BEAST_RIG[kind].frontLimb)])
    parts.push([`beast:${kind}:hind`, buildBeastLimb(kind, false, BEAST_RIG[kind].hindLimb)])
    parts.push([`beast:${kind}:tail`, buildBeastTail(kind)])
  }
  parts.push(['deer:body', buildDeerBody()])
  parts.push(['deer:crown', buildDeerCrown()])
  parts.push(['deer:legFront', buildDeerLeg(true)])
  parts.push(['deer:legBack', buildDeerLeg(false)])
  parts.push(['bird:body', buildBirdBody()])
  parts.push(['bird:wing', buildBirdWing()])
  parts.push(['wagon:frame', buildWagonFrame()])
  parts.push(['wagon:bed', buildWagonBed()])
  parts.push(['wagon:axle', buildWagonAxle(3.1)])
  parts.push(['wagon:wheelBig', buildWagonWheel(1.02)])
  parts.push(['wagon:wheelSmall', buildWagonWheel(0.78)])
  parts.push(['wagon:tilt', buildWagonTilt()])
  parts.push(['wagon:cargoPlain', buildWagonCargo(false)])
  parts.push(['wagon:cargoGilded', buildWagonCargo(true)])
  parts.push(['ox:body', buildOxBody()])
  parts.push(['ox:head', buildOxHead()])
  parts.push(['harness', buildHarness()])

  let judgedParts = 0
  let judgedFaces = 0
  let judgedEdges = 0
  let boundaryEdges = 0
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
    boundaryEdges += edges.boundary
    if (edges.bad > 0) inconsistent.push(`${label} (${String(edges.bad)} edges)`)
    geometry.dispose()
  }

  // Domain guards, pinned rather than floored. Floors are what let the first version of
  // this sweep drop two fifths of the roster and still pass its own `>= 450`. Measured
  // on the merged tree: 1,228 parts, 588,015 directed edges, 6,903 of them boundary.
  // The bands are +/-15% so a new headgear kind or an extra wagon part is not a test
  // failure, while dropping a builder family is.
  assert.ok(
    judgedParts >= 1050 && judgedParts <= 1400,
    `the sweep judged ${String(judgedParts)} parts, outside the 1050-1400 band measured `
    + 'for the full roster. Above it, a builder is being called more than it should be; '
    + 'below it, a builder family has fallen out of this enumeration and is unchecked.',
  )
  assert.ok(
    judgedFaces >= 150000,
    `only ${String(judgedFaces)} faces were judged across ${String(judgedParts)} parts`,
  )
  // The edge instrument has its own domain, because it skips zero-area triangles and
  // would report a spotless zero over a population it had entirely discarded.
  assert.ok(
    judgedEdges >= 500000 && judgedEdges <= 680000,
    `the edge instrument judged ${String(judgedEdges)} directed edges, outside the `
    + '500,000-680,000 band measured for the full roster',
  )
  // Boundary edges are the number that moves if the 1e-4 grid starts splitting shared
  // corners, which would silently turn real edges into excused ones and blind this
  // check. Measured 6,903, which is 1.17% of the edges; the band catches a grid that
  // has begun to fragment long before it could hide a reversal.
  assert.ok(
    boundaryEdges <= judgedEdges * 0.02,
    `${String(boundaryEdges)} of ${String(judgedEdges)} directed edges have no twin `
    + `(${((boundaryEdges / judgedEdges) * 100).toFixed(2)}%, measured 1.17%). Open sheets `
    + 'account for the baseline; a rise means the position quantisation is splitting '
    + 'shared corners, and every edge it splits is one this check can no longer judge.',
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
    'these parts have edges that are not part of exactly one opposite pair, which means '
    + 'some faces are wound against their neighbours or a surface is doubled. Measured '
    + 'clean across the whole roster, and it is the only one of the four instruments '
    + 'that sees a PARTIAL inversion — so a failure here with the other three green is '
    + 'the expected shape, not a contradiction.',
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

/**
 * The one budget in §8 that no code enforces, given a population for the first time.
 *
 * A first pass at this test reported a much louder finding — that the cache sat at
 * exactly its ceiling with zero headroom — and it was **wrong**. It compared the
 * whole-cache population against `CHARACTER_GEOMETRY_KEYS<=180`, which is a budget over
 * a *different* population: the keys reachable from a `CharacterPlan`, correctly
 * measured at 140 by the sweep above, and honestly described as such in §8. Reading the
 * spec being criticised is what caught it, and the near-miss is recorded here because
 * comparing a number to the nearest similar-looking ceiling is a cheap mistake to make
 * and an expensive one to publish.
 *
 * What survives is quieter and real. `GameEngine.artGeometry` is one cache, and four
 * constructors put keys into it that no plan produces — `createBeast`, `createCaravan`,
 * `createDeer`, `createBird` — plus `faction-ring` and `wrist-rope`, which the plan
 * sweep names as living outside the key set and then does not count. §8 budgets that
 * whole cache at `GEOMETRY_CACHE_ENTRIES_MAX=220`, and `docs/10` records that the
 * constant "turns out to exist in no code at all, only in the two specs". So the
 * population had never been measured against it:
 *
 * ```text
 * keys the plan sweep measures      140   (90 plans: 3 factions x 10 roles x 3 variants)
 * keys only the constructors make    40   (4 beasts x 5 parts, the cart, the fauna, 2 shared)
 * overlap                             0
 * whole cache                       180   of 220 -> 82%, 40 spare
 * ```
 *
 * Nothing is over budget. The gap was that nothing could have told you when it was: a
 * key family added to any of those four constructors moved a number that no assertion
 * read. That is what the drift guard at the bottom is for, and it is the half of this
 * test worth keeping — the count above is a snapshot, the guard is the part that keeps
 * the snapshot true.
 */
test('the geometry cache budget counts every key the cache actually holds', () => {
  // 1. The population the plan sweep covers.
  const planKeys = new Set<string>()
  let plans = 0
  for (const faction of FACTIONS) {
    for (const role of [...ROLES, 'player']) {
      for (let variant = 0; variant < CHARACTER_VARIANTS; variant += 1) {
        plans += 1
        const keys = characterPartKeys(
          resolveCharacterPlan(faction, role, variant, role === 'player'),
        )
        for (const key of Object.values(keys)) if (key) planKeys.add(key)
      }
    }
  }

  // 2. The population it does not. Derived from the taxonomy wherever the taxonomy
  //    decides it — the beast roster from `BEAST_RIG`, the wheel keys from `WAGON_RIG`'s
  //    own radii — so adding a fifth beast or a third axle moves this set by itself.
  const engineKeys = new Set<string>([
    'deer-body', 'deer-crown', 'deer-leg:front', 'deer-leg:hind',
    'bird-body', 'bird-wing', 'bird-beak',
    'wagon-frame', 'wagon-bed', 'wagon-tilt', 'wagon-axle', 'wagon-harness',
    'ox-body', 'ox-head', 'wagon-cargo:gilded', 'wagon-cargo:plain',
    'faction-ring', 'wrist-rope',
  ])
  for (const radius of [WAGON_RIG.rearWheelRadius, WAGON_RIG.frontWheelRadius]) {
    engineKeys.add(`wagon-wheel:${radius.toFixed(2)}`)
  }
  for (const role of Object.keys(BEAST_RIG)) {
    engineKeys.add(`beast-body:${role}`)
    engineKeys.add(`beast-head:${role}`)
    engineKeys.add(`beast-limb:${role}:front`)
    engineKeys.add(`beast-limb:${role}:hind`)
    engineKeys.add(`beast-tail:${role}`)
  }

  const shared = [...planKeys].filter((key) => engineKeys.has(key))
  assert.deepEqual(
    shared,
    [],
    'a key produced by both a plan and a constructor would be double counted below',
  )
  const everyKey = new Set([...planKeys, ...engineKeys])

  // Domain guards, both sides, because a budget over an empty population is the failure
  // this file exists to refuse and either half could collapse independently.
  assert.equal(plans, 90, `enumerated ${String(plans)} plans, expected 3 x 10 x 3`)
  assert.ok(planKeys.size >= 120, `only ${String(planKeys.size)} plan keys were enumerated`)
  assert.ok(engineKeys.size >= 35, `only ${String(engineKeys.size)} engine keys were enumerated`)

  assert.ok(
    everyKey.size <= GEOMETRY_CACHE_ENTRIES_MAX,
    `GameEngine.artGeometry can hold ${String(everyKey.size)} distinct keys — `
    + `${String(planKeys.size)} from plans and ${String(engineKeys.size)} from the beast, `
    + `caravan and fauna constructors — against the §8 whole-cache budget of `
    + `${String(GEOMETRY_CACHE_ENTRIES_MAX)}. Raise it deliberately and say so in `
    + 'docs/09 §8, or fold keys together; do not raise it to make a test pass. Note that '
    + 'the plan sweep above will NOT have failed: it measures CHARACTER_GEOMETRY_KEYS, a '
    + 'different budget over the 140 plan-reachable keys, and it cannot see these 40.',
  )

  // 3. The drift guard, which is the part that actually protects. The set above is a
  //    hand-written mirror of literals that live in `GameEngine.ts`, and a mirror is
  //    worth nothing unless something notices when the original moves. Every key family
  //    handed to the cache must be represented here — matched on the static prefix,
  //    because most of these keys are template literals.
  const source = readFileSync(
    fileURLToPath(new URL('../src/game/GameEngine.ts', import.meta.url)),
    'utf8',
  )
  const families = new Set<string>()
  // Lazy to the closing delimiter, not "anything that is not a delimiter". The strict
  // form `[^'`]+` looks tighter and silently drops every key whose interpolation
  // contains a quote — here that is exactly two, ``deer-leg:${front ? 'front' : 'hind'}``
  // and the matching ``beast-limb:`` — so it found 19 of 21 and read as clean. The floor
  // below is what caught that, on this test's own author, before it could be believed.
  for (const match of source.matchAll(/\bbuild\(\s*(['`])(.+?)\1/g)) {
    // Everything up to the first interpolation is the part a key always starts with.
    families.add(match[2].split('${')[0])
  }
  const unaccounted = [...families].filter(
    (prefix) => ![...engineKeys].some((key) => key.startsWith(prefix)),
  )
  // Without this, a scan that matched nothing would report no drift and read as clean.
  // Pinned rather than floored, because the count is knowable and a drop of two is
  // precisely the failure this guard already caught once.
  assert.equal(
    families.size,
    21,
    `found ${String(families.size)} cache key families in GameEngine.ts, expected 21. `
    + 'Either a constructor gained or lost one — in which case update `engineKeys` and '
    + 'the ceiling together — or the scan has stopped matching and cannot report drift.',
  )
  assert.deepEqual(
    unaccounted,
    [],
    'these key families reach GameEngine.artGeometry and are absent from the budget above, '
    + 'so the cache holds more than anything measures. Add them to `engineKeys`, and check '
    + 'the total against the ceiling in the same commit.',
  )
})
