import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import {
  BEAST_KINDS,
  BEAST_RIG,
  CHARACTER_FACTIONS,
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
  characterRoles,
  hasOutlineNormals,
  resolveCharacterPlan,
  setCharacterShoulderWidth,
  solveHandOffset,
  solveHeadYaw,
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

// Read from `CharacterKit` rather than restated here. A hand-written array typed
// `readonly CharacterFaction[]` is checked in one direction only: it breaks if a
// faction is *removed* and stays green if one is *added*, so every population claim
// in this file would quietly stop covering the population. A reviewer found that;
// these three now come from the same data the plans are built out of, so a new
// faction, role or beast joins every sweep below by construction.
const FACTIONS = CHARACTER_FACTIONS
const ROLES = characterRoles()
const BEASTS = BEAST_KINDS
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
  // The five pivots are now named by `buildCharacterSkeleton`, so the humanoid rig
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
 * through the entire 2.12-2.34 m lever arm from the ground to the shoulders, while a
 * head rooted at the feet on a different pivot does not move at all.
 *
 * ## Measured, on the sibling rig, over the 21 distinct proportion sets
 *
 * 27 faction × role pairs, but only **21 distinct** sets of proportions: the `heavy`
 * kit patches all 18 fields, so the three factions' brutes are byte-identical;
 * `civil` patches 17 of 18 and the one it omits is set only by `guard`, so the elf
 * and villain peasants are too; and `soldier` and `minion` share the `line` kit
 * within each faction. Both reviewers and I first quoted this as 27 or 24 by counting
 * pairs and reasoning about the patch tables; 21 is what enumerating and comparing
 * them actually returns.
 *
 * Distance between the head and where `torso-pivot` puts it — the same quantity
 * assertion 1 below measures, with the head's own rotation held at zero so that
 * both sides of the comparison are like for like.
 *
 * | pose | worst |
 * | --- | --- |
 * | rest, nothing posed | **0.0000** |
 * | standing, plan `lean` only | **0.4992** (brute, `lean` 0.20) |
 * | walking, at the 1.18 motion-blend cap | **0.6603** (elf brute) |
 * | deepest *reachable* pose | **1.7189** (villain champion, 0.6149 rad) |
 * | synthetic 0.83 rad, used by the sweep below | **2.3385** |
 *
 * A head is 0.66 m deep. Three-quarters of a head, backwards, standing still.
 *
 * Two corrections a reviewer made to earlier drafts of this table, kept here because
 * both are the kind of mistake that survives if only the conclusion is recorded.
 * The walking figure was first given as **0.6835**, which is arithmetically right but
 * measures a different thing: it lets the head's own counter-pitch move the head on
 * the "before" side while the "after" side holds it at zero. Like for like, at the
 * 1.18 cap `motionBlend` is clamped to, it is 0.6603. And the 0.83 rad pose was
 * labelled *reachable*; it is not — it sums role-incompatible maxima and adds attack
 * to stagger, and `GameEngine.ts`'s stagger branch sets `actor.action = null`, so a
 * staggering actor has no attack to add. Respecting that exclusivity, the deepest
 * pose the simulation can reach is **0.6149 rad**, worth **1.7189 m** on a villain
 * champion — not the brute, whose bigger angle rides a shorter lever arm. The 0.83
 * pose stays in the sweep, because the invariant holds for any transform and a wider
 * net is free, but it is labelled synthetic.
 *
 * A third correction was needed on the corrections: a second reviewer put the
 * reachable worst at 2.0405 m by letting attack and stagger co-occur. The source
 * forbids it. Two reviewers disagreed by 19% on this number and the tie-breaker was
 * reading the line that clears the field, not averaging the estimates.
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
 * **Know what assertion 1 does and does not prove.** Its expected value is
 * `restLocal · torsoPivot.matrixWorld`, and `restLocal` is captured from the same
 * tree — so on *any* tree where the head descends from `torso-pivot` it is zero by
 * construction, wherever under it the head sits. It is a hierarchy test. A reviewer
 * pointed this out and it is worth keeping in view: the *placement* is carried by
 * the rest-pose check above it, which pins the head at exactly `p.headY` off the
 * ground, and by assertion 2, which pins the hinge radius. The same reviewer
 * verified both fire independently — mutating `neckPivot.position.y` to 0 while
 * fixing `headY` back to `p.headY` keeps the head rigid *and* correctly placed at
 * rest, so assertions 1 and the rest check both pass, and assertion 2 alone catches
 * it at 1.3795 m against its 0.4872 m bound. Three assertions, three distinct
 * failures; none of them is dead code behind another.
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
 * Measured over the look grid below — an over-covering cross-product of both shoulder extremes, both breath extremes,
 * 462 head rotations, 30 plans — as max/min length of the head's transformed basis:
 *
 * | correction | worst head anisotropy |
 * | --- | --- |
 * | none | **8.59%** |
 * | on the rotated `head-pivot` | **6.05%** |
 * | on the unrotated `neck-pivot` | **1.00%**, which is the chest's breath |
 *
 * Those are not the 7.00 / 5.34 / 0.99 quoted in earlier drafts, and the reason is
 * **not** the one those drafts gave. They said the grid replaced five sampled poses.
 * The grid was the right change — the prose had called five poses "the whole look
 * envelope" — but it moved nothing. Decomposed:
 *
 * | poses | shoulders | breaths | none | head | neck |
 * | --- | --- | --- | --- | --- | --- |
 * | 5 | 1.07 | inhale | 7.00 | 5.34 | 0.99 |
 * | 5 | 1.07 | both | 8.07 | 5.60 | 1.00 |
 * | 5 | both | both | **8.59** | **6.05** | **1.00** |
 * | 462 | both | both | **8.59** | **6.05** | **1.00** |
 *
 * The last two rows are identical. **The entire move came from sweeping both shoulder
 * and both breath extremes, not from pose coverage** — and for the uncorrected row it
 * could not have come from anywhere else: with no cancellation the head inherits
 * `diag(shoulders, breath, 1)`, whose max/min ratio is fixed regardless of how the
 * head is rotated and is attained at the identity. Sweeping rotations there is
 * *provably* incapable of finding anything new.
 *
 * A reviewer decomposed that after the commit claiming otherwise had landed. It is
 * the branch's own recurring defect one level up: **a change attributed to the wrong
 * variable.** The grid stays — it makes the claim honest going forward, and rotation
 * does matter for the `head-pivot` row — but it is not what moved the number.
 *
 * The middle row is the point: it is better than nothing only while the actor looks
 * straight ahead, and a compensation that is right at one angle is not a fix. The
 * structural reason is worth naming, because it is not specific to this rig: **a
 * scale and a rotation do not commute**, so any cancellation applied *downstream* of
 * a rotation is valid only in the rest pose. Splitting the joint so that the
 * correcting pivot never rotates leaves no angle-dependence to test.
 *
 * Note also that the first draft of these numbers quoted 3.00% for "none" — that was
 * one pose of one plan, not the worst of the envelope, and it would have understated
 * the defect by more than half. The envelope is what the assertion sweeps.
 *
 * ## The bound is the breath, and nothing else
 *
 * With the correction where it belongs the *only* thing reaching the head is
 * `torso-pivot.scale.y`, which the breathing pass writes as `1 + breathing * 0.55`
 * with `breathing` bounded by 0.018. That is a pure-Y scale, so the anisotropy it
 * causes has a closed form: inhaling, `b` = 0.0099000000; exhaling,
 * `1 / (1 - b) - 1` = 0.0099989900.
 *
 * **The sweep reaches 0.0099988276 of that — six decimal places, not the ten this
 * comment claimed for three commits.** The gap is 1.62e-7, which is 162x the `+1e-9`
 * the bound adds and calls float noise, so the two statements were quietly in conflict
 * with each other. Neither the closed form nor the measurement is wrong: the maximum
 * of a pure-Y scale's anisotropy is attained at the *identity* rotation, and the look
 * grid's pitch axis runs -0.14, -0.072, -0.004, 0.064, 0.132, 0.2 — it never samples
 * zero, so it approaches the maximum without reaching it. A grid that steps from a
 * negative endpoint to a positive one does not necessarily contain the origin, and
 * assuming it does is how a measurement gets credited with precision it never had.
 *
 * The bound is genuinely tight regardless — 0.0016% relative headroom over the
 * measured worst — which is the property that matters and is what "derived rather than
 * chosen" was always about.
 *
 * So this bound is not "comfortably above the answer" — the earlier 2% was a round
 * number that would have admitted a doubling before firing. It is derived from the
 * breath amplitude, an input no rig defect can move, exactly as the hinge bound is
 * derived from the proportion table. Anything at all that is not the breath fails it.
 * `the engine wires the rig the way these tests measure it` pins the two constants
 * this derivation reads.
 *
 * ## A retracted mutation proof, and what replaced it
 *
 * An earlier version of this test applied its own copy of the correction —
 * `neckPivot.scale.x = 1 / shoulders`, written out here — and the mutation evidence
 * published for it was obtained by mutating *that line*. A reviewer mutated
 * **production** instead and found the numerical assertions stayed green: only the
 * source regex noticed. The measurements were right and the proof was worthless,
 * which is the same shape as a bound that cannot fail — a test that cannot see the
 * code it is named after.
 *
 * Both halves of the width now live in `setCharacterShoulderWidth`, which the engine
 * and this test both call, so mutating production breaks the measurement. Re-verified
 * that way: dropping the cancellation, moving it to the wrong axis, and introducing a
 * 0.3% error in it each fail here now, and each passed before.
 *
 * The strongest assertion is no longer the anisotropy sweep but the equality on what
 * the neck hands down — a pure-Y breath and nothing else. It catches shear, which
 * comparing basis lengths does not: measured on the rejected arrangement at 5.34% by
 * basis length and **8.99%** by singular value, from five poses at one shoulder and
 * an inhale. That measurement is the *third* reviewer's. An earlier draft of this
 * docblock credited it to the second, which asked for the attribution to come off it
 * — *"I never measured 8.99% by singular value"* — and then independently confirmed
 * the figure was right. Provenance matters here for the same reason the numbers do.
 */
test('the chest lends the head its breath but not its shoulders', () => {
  // The widest chest the engine can write: `around(1, 0.07)` at either extreme.
  const SHOULDERS = [1.07, 0.93]
  // `animateActorCharacter`: breathing = sin(...) * 0.018, scale.y = 1 + breathing * 0.55.
  const BREATH_AMPLITUDE = 0.018 * 0.55
  const BREATHS = [1 + BREATH_AMPLITUDE, 1 - BREATH_AMPLITUDE]
  // A pure-Y scale of `1 + b` stretches the head by `b`; one of `1 - b` squashes it,
  // which reads as the other two axes being `1 / (1 - b)` longer. The exhale is the
  // larger of the two, so it is the bound. The slack is float noise, not headroom.
  const BOUND = 1 / (1 - BREATH_AMPLITUDE) - 1 + 1e-9
  // The head's own reachable rotations, swept as a grid rather than sampled. An
  // earlier version enumerated five poses and the docblock called the result "the
  // whole look envelope" — a reviewer swept 4,563 poses and got a different worst,
  // which is the same overclaim as a hand-written chest table. Pitch is the gait
  // counter-pitch plus stagger, yaw the ±0.65 clamp, roll the turn lean and the
  // death loll.
  //
  // Stepped by integer index, not by accumulating a float — the same repair the gaze
  // test above already carries, and this is where it should have been made first,
  // because this is the test whose grid size is *published*. Accumulating `lz += 0.1`
  // from -0.3 reaches 0.30000000000000004 on the seventh step, which fails `<= 0.3`,
  // so the roll axis declared seven values and visited six and the "462-pose look
  // grid" quoted in `CharacterKit.ts` and `docs/09` was really 396. Nothing was wrong
  // with the *result* — a smaller grid can only make the measured worst smaller, and
  // the bound held anyway — but the endpoint the comment names as reachable was never
  // reached, and the published count was 17% high.
  //
  // The lesson is narrower than "floats are inexact" and worth stating: **a loop
  // condition is not a count.** Anything that declares how many states it visits has
  // to derive the states from that number rather than hope a comparison agrees with
  // it, and the `steps + 1` product below is now the only definition of the grid.
  const LOOK_PITCH = { from: -0.14, to: 0.2, steps: 5 }
  const LOOK_YAW = { from: -0.65, to: 0.65, steps: 10 }
  const LOOK_ROLL = { from: -0.3, to: 0.3, steps: 6 }
  const atLook = (a: { from: number, to: number, steps: number }, index: number): number =>
    a.from + ((a.to - a.from) * index) / a.steps
  let lookStates = 0
  const axis = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const basis = new THREE.Matrix3()
  const inherited = new THREE.Matrix3()
  let worst = 0
  let worstAt = ''
  let states = 0

  for (const faction of FACTIONS) {
    for (const role of [...ROLES, 'player'] as const) {
      const plan = resolveCharacterPlan(faction, role, 0, role === 'player')
      const p = plan.proportions
      const skeleton = buildCharacterSkeleton(p)
      const head = new THREE.Object3D()
      head.position.y = skeleton.headY
      head.scale.setScalar(p.headScale)
      skeleton.headPivot.add(head)
      // The *production* correction, not a copy of its arithmetic. This is the whole
      // point of the helper existing: mutating `setCharacterShoulderWidth` has to
      // break this measurement, and before the helper it did not — the engine's half
      // could be reverted and every number here stayed green, because the test had
      // applied its own.
      for (const shoulders of SHOULDERS) {
        setCharacterShoulderWidth(skeleton.torsoPivot, skeleton.neckPivot, shoulders)
        for (const breath of BREATHS) {
          skeleton.torsoPivot.scale.y = breath

          // Everything the head inherits, before its own rotation is involved: the
          // chest's scale times the neck's. Stated as an equality rather than a
          // bound, because there is an exact right answer — a pure-Y scale carrying
          // the breath — and anything else at all is contamination. This is stricter
          // than the anisotropy sweep below and catches shear, which comparing basis
          // lengths does not: a reviewer measured the rejected arrangement at 5.34%
          // by basis length and 8.99% by singular value.
          skeleton.root.updateMatrixWorld(true)
          inherited.setFromMatrix4(skeleton.neckPivot.matrixWorld)
          const e = inherited.elements
          const expected = [1, 0, 0, 0, breath, 0, 0, 0, 1]
          for (let i = 0; i < 9; i += 1) {
            assert.ok(
              Math.abs(e[i] - expected[i]) < 1e-12,
              `${faction}/${role}: the head inherits ${JSON.stringify([...e].map((v) => `${v}`))} `
              + `from the chest at shoulders ${shoulders.toFixed(2)}, not a pure breath of `
              + `${breath.toFixed(5)}. Only the breath may reach a skull; the shoulder width `
              + 'must be divided back out on `neck-pivot`, which does not rotate.',
            )
          }

          for (let li = 0; li <= LOOK_PITCH.steps; li += 1) {
            const lx = atLook(LOOK_PITCH, li)
            for (let lj = 0; lj <= LOOK_YAW.steps; lj += 1) {
              const ly = atLook(LOOK_YAW, lj)
              for (let lk = 0; lk <= LOOK_ROLL.steps; lk += 1) {
                const lz = atLook(LOOK_ROLL, lk)
                states += 1
                lookStates += 1
                skeleton.headPivot.rotation.set(lx, ly, lz)
                skeleton.root.updateMatrixWorld(true)
                basis.setFromMatrix4(head.matrixWorld)
                for (let i = 0; i < 3; i += 1) {
                  axis[i]
                    .set(Number(i === 0), Number(i === 1), Number(i === 2))
                    .applyMatrix3(basis)
                }
                const lengths = axis.map((v) => v.length())
                const anisotropy = Math.max(...lengths) / Math.min(...lengths) - 1
                if (anisotropy > worst) {
                  worst = anisotropy
                  worstAt = `${faction}/${role} at shoulders ${shoulders.toFixed(2)}, breath `
                    + `${breath.toFixed(5)}, looking [${lx.toFixed(2)}, ${ly.toFixed(2)}, `
                    + `${lz.toFixed(2)}]`
                }
              }
            }
          }
        }
      }
    }
  }

  // `> 40_000` proves the sweep ran; it does not prove the sweep is the one described.
  // The roll axis silently lost its endpoint for four commits and this guard passed
  // throughout, because 396 poses and 462 poses both clear a floor. A count that is
  // published has to be asserted exactly, against the product of its own axes.
  const LOOK_POSES =
    (LOOK_PITCH.steps + 1) * (LOOK_YAW.steps + 1) * (LOOK_ROLL.steps + 1)
  assert.equal(
    LOOK_POSES,
    462,
    `the look grid is now ${String(LOOK_POSES)} poses, not the 462 published in `
    + '`CharacterKit.ts` and `docs/09`. Update both, or restore the axis that shrank.',
  )
  assert.equal(
    lookStates % LOOK_POSES,
    0,
    `the look grid visited ${String(lookStates)} states, which is not a whole number of `
    + `${String(LOOK_POSES)}-pose sweeps — an axis is not reaching its declared endpoint.`,
  )
  assert.ok(states > 40_000, `swept only ${String(states)} states; the grid has collapsed`)
  assert.ok(
    worst <= BOUND,
    `the head came out ${(worst * 100).toFixed(4)}% anisotropic **through the chest** at `
    + `${worstAt}, over the ${(BOUND * 100).toFixed(4)}% the chest's breath accounts for. `
    + 'This is scoped to `torso-pivot` and `neck-pivot` on purpose — it is not the total '
    + 'a rendered head carries, because `body-pivot` adds its own non-uniform variation '
    + 'on top and a reviewer measures the real in-game figure at 13.32%. That part is '
    + 'pre-existing, identical before and after this rig change, and filed separately. '
    + 'What this bound owns is the chest: something other than the breath has reached '
    + 'the skull, most likely the shoulder width, which must be divided out on '
    + '`neck-pivot`. It does not rotate; `head-pivot` does, and a scale correction '
    + 'downstream of a rotation only cancels in the rest pose.',
  )
})

/**
 * The head points where the actor is looking, not where its chest is twisted.
 *
 * `lookYaw` is computed in `updateActors` as the angle from the actor's *own facing*
 * to whatever it is tracking, clamped to ±0.65. Hanging `head-pivot` off the chest
 * puts that value in a frame it was not authored in, because the chest twists too —
 * and not only in yaw: it pitches into the run, the attack and the storm, and rolls
 * with the turn and the flinch.
 *
 * Measured over the sweep this test runs — the chest envelope, the head's own pitch
 * and roll, the body's X-vs-Z asymmetry and the clamped look range, 6,174,630 states —
 * as the angle between the head's world forward and the requested heading:
 *
 * | rule | worst heading error |
 * | --- | --- |
 * | `lookYaw` written raw | **43.64°** |
 * | `lookYaw - torsoPivot.rotation.y` | **20.30°**, and *worse than doing nothing* in **3.90%** of states |
 * | `solveHeadYaw` without the head's pitch | **9.71°** |
 * | `solveHeadYaw` | **exact**, to float, given an upright chest — see `solveHeadYaw` |
 *
 * **These are an upper bound over a superset, not a reachable worst.** The sweep is a
 * cross-product of each axis's range, and the engine's terms are correlated —
 * `flinch · hitRight` drives both `rotation.y` and `rotation.z`, and a stagger clears
 * `actor.action`, so attack and stagger cannot co-occur. A reviewer measured the
 * jointly-reachable worst for the head-tilt case at **4.952°** against this sweep's
 * 9.71°, about 96% high. That is the right trade for a *guard* — a superset can only
 * make it stricter, never blind — but it is the wrong number to quote as "what the
 * player saw", and the same distinction the "reachable 0.83 rad" label got wrong
 * earlier in this file. Where a reachable figure is what matters, this file says so
 * and gives it separately.
 *
 * ## Every figure in that table is computed by this test, and that is a recent repair
 *
 * They used to be measured by hand — mutate `solveHeadYaw`, read the assertion, copy
 * the digits into four files — and they were wrong three times running. 35.93/13.79
 * first, corrected to 37.43/14.00, and both of those were already wrong when written:
 * the grid at the time printed 43.37 and 19.50. A third reviewer caught that and
 * supplied 43.37/19.50/8.84 — correct for the tip it read, and stale by the time it
 * reported, because `body-pivot` had joined the sweep in between and moved every one
 * of them. The 4.2% was worse still: it belonged to a *different rule* and had never
 * been computed by anything at all.
 *
 * The lesson is not that four people were careless. **A number produced by mutating
 * production cannot be re-checked by the suite that quotes it**, so it goes stale
 * silently and the sentence certifying it as measured goes stale with it — and every
 * reader who verifies it, including three reviewers, is verifying it against the same
 * grid the author had, not the grid in the repository. The rules are now evaluated
 * inside the committed sweep and pinned to a hundredth of a degree, so the assertion
 * reports the drift and names the new value. That is the only reason this table can
 * be trusted, and it is why "I measured it once" is not a durable claim about a number
 * that depends on a grid someone else can edit.
 *
 * The middle row is the shape of mistake this codebase keeps making and is worth
 * naming: subtracting one Euler component corrects a rotation only while the other
 * two are zero, exactly as a scale correction on a rotated pivot cancels only while
 * the actor faces forward. It shipped in this branch for one commit, and a reviewer
 * caught it by sweeping a jointly-consistent state space instead of a hand-written
 * pose list. That is also how the 3° bound this test used to carry was found to be
 * dishonest: the old table ran `rotation.y` over [−0.382, 0.16] when the reachable
 * range is about [−0.31, 0.47] — unreachable on one side, 2.9× short on the other.
 *
 * This test exists because the positional rigidity test could not have caught any of
 * it. A head can sit perfectly on its neck and still be looking at the wrong thing.
 */
test('the head tracks its target through the chest, not past it', () => {
  // The chest envelope, from `animateActorCharacter`, plus the head's own pitch and
  // roll — which the engine writes in the same Euler as the yaw, so a solve that
  // ignores them is exact only for a test that also ignores them. Leaving the pitch
  // out measures 9.71 degrees of error over this sweep; the roll cannot matter,
  // because a rotation
  // about Z leaves the +Z axis fixed, and this sweep drives it anyway to prove that.
  //
  // Stepped by integer index, not by accumulating a float: the previous version wrote
  // `for (x = from; x <= to; x += step)` and silently dropped its own declared
  // endpoint, so the grid was smaller than the comment claimed. A reviewer counted the
  // states and found the gap.
  const AXES = [
    { name: 'chest pitch', from: -0.2, to: 0.7, steps: 10 },
    { name: 'chest yaw', from: -0.32, to: 0.48, steps: 10 },
    { name: 'chest roll', from: -0.3, to: 0.3, steps: 6 },
    { name: 'head pitch', from: -0.09, to: 0.18, steps: 4 },
    { name: 'head roll', from: -0.3, to: 0.3, steps: 2 },
  ] as const
  const at = (axis: (typeof AXES)[number], index: number): number =>
    axis.from + ((axis.to - axis.from) * index) / axis.steps
  const TARGETS = [-0.65, -0.39, -0.13, 0.13, 0.39, 0.65]

  const forward = new THREE.Vector3()
  // `animateActorCharacter`: breathing = sin(...) * 0.018, scale.y = 1 + breathing * 0.55.
  const BREATH_AMPLITUDE = 0.018 * 0.55
  // Degrees of heading error per unit of breath, measured. The residue is not float
  // noise: the chest's `scale.y` sits between its rotation and the head's, so it
  // stretches the Y component of a *pitched* head's forward vector, and the chest's
  // rotation then mixes that back into X and Z. `solveHeadYaw` composes rotations and
  // deliberately does not model it — a per-frame scale is not something a closed form
  // wants as an argument for a hundredth of a degree.
  //
  // **This is an empirical coefficient, not a derivation.** It is the measured maximum
  // rounded up — 9.5301 to 9.6, a margin of 0.73% — and it is worth naming the
  // difference, because the anisotropy bound two tests up *is* a closed form
  // (`1/(1-b) - 1`, a closed form the sweep approaches to six decimals, short only because its pitch axis misses the identity) and this is not. What it does have
  // is linearity, which the probes below check: 9.5225 at quarter amplitude, 9.5301 at
  // full, 9.5402 at double. Double the breath and this bound doubles with it — the
  // property a round number lacks — but it is a fitted constant with thin margin, and
  // a reviewer was right to say "derived" was doing more work than it can carry.
  //
  // The sweep it is measured over **over-covers**: it is a cross-product of each
  // axis's range, and the engine's terms are correlated. `actor.reaction` is one
  // field, so a stagger excludes a flinch, and a stagger also clears `actor.action` —
  // yet the worst corner here needs the head pitch a stagger gives *and* the chest yaw
  // a flinch gives. A reviewer put the jointly reachable worst at 0.0476° against this
  // sweep's 0.0943°, and the coefficient at 4.81 against 9.53. Over-covering is the
  // safe direction for a guard — it can only make the bound stricter — but it means
  // the in-game figure is about half what is quoted, and the sweep must not be called
  // "the reachable envelope". That mislabel has now been made three times in this file.
  // Two coefficients, because there are two scales above the head and they are
  // **independent additive terms**, not one effect. Both are degrees of heading error
  // per unit of the asymmetry that causes them.
  //
  // The residue is not float noise. A scale between the chest's rotation and the
  // head's stretches one component of a *pitched* head's forward vector, and the
  // chest's rotation mixes it back into X and Z. Heading is `atan2(x, z)`, so it is
  // invariant to `scale.y` and to any scale with `scale.x === scale.z` — which is why
  // the chest's *breath* skews it only through the head's pitch, and why `body-pivot`
  // skews it through the **X-vs-Z asymmetry** of `set(bulk, height, bulk * z)`.
  // `solveHeadYaw` composes rotations and deliberately models neither: a per-frame
  // scale is not something a closed form wants as an argument for a hundredth of a
  // degree.
  //
  // **These are empirical coefficients, not derivations.** Each is a measured maximum
  // rounded up, and that distinction matters because the anisotropy bound two tests up
  // *is* a closed form (`1/(1-b) - 1`, a closed form the sweep approaches to six decimals, short only because its pitch axis misses the identity) and calling
  // these "derived" flatters them. What they have is **linearity**, which the three
  // probes below verify independently — halve or double either asymmetry and its term
  // moves with it.
  //
  // `body-pivot` is the larger of the two by an order of magnitude and was missing
  // from this sweep entirely until a reviewer found it: 0.89° against a bound of
  // 0.095°, **9.4× over**, from a term the assertion's own message said could not be
  // there. It is the same term that makes head *anisotropy* 13.32% in game against the
  // 0.99% the chest accounts for — one missing scale, two bounds, found twice.
  //
  // The sweep **over-covers**: it is a cross-product of each axis's range, and the
  // engine's terms are correlated. `actor.reaction` is one field, so a stagger
  // excludes a flinch, and a stagger clears `actor.action`, so attack cannot co-occur
  // with it. Note what is *not* true, because an earlier version of this comment
  // asserted it: a stagger does **not** stop the chest yawing with the gait.
  // `torsoPivot.rotation.y` reads `actor.stride`, not `pose.stride` — `pose.stride` is
  // zeroed under stagger but only ever reaches the limbs — and `actor.stride` is
  // *damped* toward zero at rate 13, so the first frame of a stagger keeps about 81%
  // of its gait yaw. That first frame is also where `pose.stagger` peaks, so the
  // pairing is not merely reachable, it is reachable exactly where the head pitch is
  // largest. Enumerating jointly, the breath coefficient is **4.81** against this
  // sweep's 9.53. Over-covering is the safe direction for a guard — it can only make
  // the bound stricter — but it means the in-game figure is about half what is quoted,
  // and this sweep must not be called "the reachable envelope". That mislabel was made
  // three times in this file before it stuck.
  //
  // 4.81 is worth a note on how it was settled, because it took three attempts and the
  // first two were wrong in instructive ways. A reviewer measured 4.81; an independent
  // enumeration here measured 6.68; and rather than reconcile a 39% disagreement, the
  // comment adopted the reviewer's figure and presented it as fact. The reviewer caught
  // that — *"deferring to a reviewer's number over your own measurement is the same
  // defect class as everything else this branch has caught: a claim adopted rather than
  // verified"* — which is the sharpest correction of the review, because the number was
  // right and the reason for believing it was not.
  //
  // The first reconciliation then blamed `pose.stride`, and was wrong for the reasons
  // above. The second blamed head roll being swept free to -0.30 when the engine cannot
  // exceed 0.037 without a flinch, and a flinch cannot co-occur with a stagger. That
  // engine fact is true and the state is genuinely unreachable — but it is **not what
  // produced 6.68**, because removing it changes nothing. Measured both ways over a
  // jointly-consistent enumeration:
  //
  //   head roll held to what the engine writes   0.0487 deg
  //   head roll swept free to +/-0.30            0.0487 deg, same chest state
  //
  // The maximum is roll-degenerate: the worst chest configuration scores identically at
  // roll 0.037 and at -0.150, so freeing the axis adds states that tie rather than
  // states that win. A reviewer measured this first and I reproduced it rather than
  // taking it, which is the rule this whole passage is about.
  //
  // So: **the sweep was partially joint** — it constrained some axes by the reaction and
  // left others as free cross-product ranges — and that is the defect, demonstrated.
  //
  // Which axis carried it is now partly established, by a factorial design rather than
  // a bracket, because a probe that moves two things cannot attribute what it sees.
  // One constraint relaxed at a time, coefficient = degrees / 0.0099:
  //
  //   fully joint                                             4.9199
  //   head roll freed to +/-0.30                              4.9199   <- exactly zero
  //   chest PITCH pinned at the axis maximum 0.70             5.7018
  //   chest ROLL  pinned at the axis maximum 0.30             6.0420   <- dominant
  //
  // **Head roll contributes exactly zero**, and not merely at the measured maximum:
  // `head-pivot`'s Euler is XYZ, so its matrix is `Rx·Ry·Rz` and `Rz(roll)·zHat = zHat`,
  // while every scale in the chain sits *above* that rotation and so cannot reintroduce
  // a dependence. Head roll cannot move this heading at any value, reachable or not —
  // which is a proof this file already contained eighty lines above, in the comment
  // explaining why the sweep drives head roll at all.
  //
  // **Chest roll is the largest single term**, and an earlier version of this comment
  // named chest pitch, the second largest. Jointly `|-turnLean*0.16 + shift*0.55|`
  // cannot exceed 0.099; the probe pinned it at 0.30, three times over.
  //
  // Two lessons rather than one. Naming the *second* biggest contributor is not a
  // rounding error in an explanation — it is the same "change credited to the wrong
  // variable" defect as naming an inert one, just harder to notice, because a
  // plausible-sized effect in the right direction reads as confirmation. And **the
  // reason a variable is inert can be sitting in the same file, already proven, and
  // still not be reached for** — the head-roll claim was refuted by a comment eighty
  // lines up that I had read and written near.
  //
  // What is still **not** accounted for is the remainder: 6.04 is not 6.68, so at least
  // one further axis was free. Both files name chest roll as the dominant demonstrated
  // contributor and stop there.
  //
  // Three causes were offered for one number and all three were wrong, by three
  // different people, while the number itself survived every attack. That pattern has a
  // sharper reading than "verify your causes", and it is the one worth keeping: **a
  // number surviving attack is not evidence that any story about it is true.** The
  // justification is the part nobody re-measures, precisely *because* the number it
  // explains has already been checked — the number's correctness lends unearned
  // credibility to the story attached to it. Separate the two, and when the story cannot
  // be reproduced, say so instead of reaching for the next one.
  const SKEW_PER_UNIT_BREATH = 9.6
  const SKEW_PER_UNIT_BODY_ASYMMETRY = 29
  // `applyActorVisualVariation`: bodyPivot.scale.set(bulk, height, bulk * around(1, 0.03)).
  // Only the third factor matters here — it is the whole of the X-vs-Z asymmetry.
  const BODY_Z_ASYMMETRY = 0.03
  const BODY_SCALES = [1 - BODY_Z_ASYMMETRY, 1, 1 + BODY_Z_ASYMMETRY]
  let worst = 0
  let worstAt = ''
  let states = 0

  // `solveHeadYaw` derives its two columns by hand from **three.js's XYZ Euler matrix**
  // — `R = Rx·Ry·Rz` for the chest, with the head's pitch applied after its yaw in the
  // same order. Every element in that derivation is order-specific. Under `ZYX` the
  // head's roll becomes outermost and reaches the gaze directly, and the closed form is
  // solving a different problem.
  //
  // Nothing said so. A reviewer mutated `headPivot.rotation.order = 'ZYX'` and found the
  // bound below catches it — 143 degrees of movement — so the order was *transitively*
  // pinned by a guard aimed at something else entirely. That is a guard by luck: it
  // holds exactly as long as nobody weakens the bound or changes what it measures, and
  // nothing would connect the two.
  //
  // **An assumption load-bearing for a closed form should be asserted where the closed
  // form lives, not inherited from whatever else happens to notice.** Pinned explicitly,
  // on a real skeleton, so the failure names the cause instead of reporting a
  // 143-degree gaze error and leaving the reader to work backwards to the Euler order.
  {
    const s = buildCharacterSkeleton(resolveCharacterPlan('elf', 'soldier', 0, false).proportions)
    for (const [name, node] of [
      ['torso-pivot', s.torsoPivot], ['neck-pivot', s.neckPivot], ['head-pivot', s.headPivot],
    ] as const) {
      assert.equal(
        node.rotation.order,
        'XYZ',
        `${name} now uses ${node.rotation.order} Euler order. \`solveHeadYaw\` reads the `
        + 'columns of `Rx·Ry·Rz` by hand and every term in it assumes XYZ, so under any '
        + 'other order it answers a different question. Under ZYX the head\'s roll '
        + 'reaches the gaze directly, which the derivation says it cannot.',
      )
    }
  }

  for (const faction of FACTIONS) {
    for (const role of ROLES) {
      const p = resolveCharacterPlan(faction, role, 0, false).proportions
      const skeleton = buildCharacterSkeleton(p)
      const head = new THREE.Object3D()
      head.position.y = skeleton.headY
      skeleton.headPivot.add(head)
      // Everything above the head that carries a scale: `body-pivot` for the actor's
      // bulk, `torso-pivot` for its shoulders and its breath. `buildCharacterSkeleton`
      // returns `body-pivot` as the parent of `torso-pivot`, so setting it here puts
      // it above the whole rotation chain exactly as the engine does.
      setCharacterShoulderWidth(skeleton.torsoPivot, skeleton.neckPivot, 1.07)
      skeleton.torsoPivot.scale.y = 1 + BREATH_AMPLITUDE

      for (const bodyZ of BODY_SCALES) {
        skeleton.bodyPivot.scale.set(1.05, 1.055, 1.05 * bodyZ)
        for (let i = 0; i <= AXES[0].steps; i += 1) {
          const x = at(AXES[0], i)
          for (let j = 0; j <= AXES[1].steps; j += 1) {
            const y = at(AXES[1], j)
            for (let k = 0; k <= AXES[2].steps; k += 1) {
              const z = at(AXES[2], k)
              skeleton.torsoPivot.rotation.set(x, y, z)
              for (let m = 0; m <= AXES[3].steps; m += 1) {
                const headPitch = at(AXES[3], m)
                for (let n = 0; n <= AXES[4].steps; n += 1) {
                  const headRoll = at(AXES[4], n)
                  for (const target of TARGETS) {
                    states += 1
                    // Exactly what `animateActorCharacter` writes, in its order.
                    skeleton.headPivot.rotation.set(
                      headPitch,
                      solveHeadYaw(x, y, z, headPitch, target),
                      headRoll,
                    )
                    skeleton.root.updateMatrixWorld(true)
                    forward.set(0, 0, 1).transformDirection(head.matrixWorld)
                    const error = Math.abs(Math.atan2(forward.x, forward.z) - target)
                    if (error > worst) {
                      worst = error
                      worstAt = `${faction}/${role} body z ${bodyZ.toFixed(2)} chest `
                        + `[${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}] head pitch `
                        + `${headPitch.toFixed(2)} roll ${headRoll.toFixed(2)} looking `
                        + `${target.toFixed(2)}`
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  assert.equal(
    states,
    FACTIONS.length * ROLES.length * TARGETS.length * BODY_SCALES.length *
      AXES.reduce((total, axis) => total * (axis.steps + 1), 1),
    'the grid has collapsed; every declared endpoint must be visited',
  )
  // The solve is exact on a chain of pure rotations — that is its whole contract, and
  // an earlier version of it was not, because it ignored the head's own pitch. What is
  // left is the two scales above the head, each bounded by the asymmetry that causes
  // it rather than by a number someone liked.
  const bound =
    SKEW_PER_UNIT_BREATH * BREATH_AMPLITUDE +
    SKEW_PER_UNIT_BODY_ASYMMETRY * BODY_Z_ASYMMETRY
  assert.ok(
    worst * (180 / Math.PI) <= bound,
    `the head ended up ${(worst * (180 / Math.PI)).toFixed(4)} degrees off its target `
    + `at ${worstAt}, over the ${bound.toFixed(4)} the chest's breath and the body's `
    + 'X-vs-Z asymmetry account for between them. `solveHeadYaw` answers a linear '
    + 'equation rather than approximating one, so more than those two means it is being '
    + 'given the wrong arguments — most likely a missing head pitch, which alone is '
    + 'worth 9.7 degrees.',
  )

  // ## The rejected rules are measured here, not quoted from a mutation run
  //
  // Every earlier version of this file carried the rejected rules' error as prose —
  // "raw leaves 37.43 degrees, a scalar subtraction leaves 14.00" — measured once by
  // mutating `solveHeadYaw` and reading the assertion above. Three separate reviewers
  // found three separate sets of those digits wrong, and the last one found the
  // *replacement* digits wrong too, because the sweep gained `body-pivot` between the
  // measurement and the quotation.
  //
  // The numbers were never the problem. **A number that is produced by a mutation run
  // cannot be re-checked by the suite that quotes it**, so it drifts silently every
  // time the grid moves, and the sentence certifying it as measured drifts with it.
  // The fix is not more careful copying. It is to make the committed suite compute
  // them, so they are as re-checkable as anything else here and go red when they move.
  //
  // One plan, because a heading is a direction and no direction calculation reads a
  // position — the same property the assertion below the probes verifies rather than
  // assumes. Every body scale and the full axis grid, because those do reach a heading.
  const rejected = { raw: 0, scalar: 0, nopitch: 0 }
  let scalarWorseThanNothing = 0
  let rejectedStates = 0
  {
    const p = resolveCharacterPlan('elf', 'soldier', 0, false).proportions
    const skeleton = buildCharacterSkeleton(p)
    const head = new THREE.Object3D()
    head.position.y = skeleton.headY
    skeleton.headPivot.add(head)
    setCharacterShoulderWidth(skeleton.torsoPivot, skeleton.neckPivot, 1.07)
    skeleton.torsoPivot.scale.y = 1 + BREATH_AMPLITUDE
    // The chest rotation is set *inside* here rather than by the caller. It was a
    // parameter that the body ignored, relying on the loop having set the pivot first
    // — which `tsc` caught as three unread arguments. A measurement helper that
    // silently depends on state its own signature claims to take is how a sweep ends
    // up measuring the previous iteration.
    const measure = (
      x: number, y: number, z: number, headPitch: number, headRoll: number,
      target: number, yaw: number,
    ): number => {
      skeleton.torsoPivot.rotation.set(x, y, z)
      skeleton.headPivot.rotation.set(headPitch, yaw, headRoll)
      skeleton.root.updateMatrixWorld(true)
      forward.set(0, 0, 1).transformDirection(head.matrixWorld)
      return Math.abs(Math.atan2(forward.x, forward.z) - target)
    }
    for (const bodyZ of BODY_SCALES) {
      skeleton.bodyPivot.scale.set(1.05, 1.055, 1.05 * bodyZ)
      for (let i = 0; i <= AXES[0].steps; i += 1) {
        const x = at(AXES[0], i)
        for (let j = 0; j <= AXES[1].steps; j += 1) {
          const y = at(AXES[1], j)
          for (let k = 0; k <= AXES[2].steps; k += 1) {
            const z = at(AXES[2], k)
            for (let m = 0; m <= AXES[3].steps; m += 1) {
              const headPitch = at(AXES[3], m)
              for (let n = 0; n <= AXES[4].steps; n += 1) {
                const headRoll = at(AXES[4], n)
                for (const target of TARGETS) {
                  // The head keeps the pitch it really wears in all three; only the
                  // yaw rule changes. `solveHeadYaw(..., 0, ...)` is the pre-`3257029`
                  // solve exactly — at `headPitch` zero its `cp`/`sp` terms collapse
                  // to column 2 — so this is the shipped code's own history, not a
                  // hand-written imitation of it.
                  rejectedStates += 1
                  const raw = measure(x, y, z, headPitch, headRoll, target, target)
                  const scalar = measure(x, y, z, headPitch, headRoll, target, target - y)
                  const nopitch = measure(
                    x, y, z, headPitch, headRoll, target, solveHeadYaw(x, y, z, 0, target),
                  )
                  // "Worse than doing nothing" is the whole case against the scalar
                  // rule, and it is a comparison between two rejected rules, so it can
                  // only be measured where both are evaluated. Quoted as a bare
                  // percentage for four commits, in four files, without one.
                  if (scalar > raw) scalarWorseThanNothing += 1
                  rejected.raw = Math.max(rejected.raw, raw)
                  rejected.scalar = Math.max(rejected.scalar, scalar)
                  rejected.nopitch = Math.max(rejected.nopitch, nopitch)
                }
              }
            }
          }
        }
      }
    }
  }
  const asDegrees = (radians: number): number => radians * (180 / Math.PI)
  const worseShare = (scalarWorseThanNothing / rejectedStates) * 100
  assert.ok(
    Math.abs(worseShare - 3.904) < 0.01,
    `the scalar rule is now worse than no correction in ${worseShare.toFixed(4)}% of states, `
    + 'not the 3.904% quoted beside it. This figure was carried as "4.2%" through four '
    + 'files and four commits without ever being computed by anything — it needs both '
    + 'rejected rules evaluated over one grid, which nothing did until now.',
  )
  // Pinned to a hundredth of a degree. That is a discriminator, not a tolerance: it is
  // tight enough that any real change to the grid or the rules moves it, and the
  // failure message carries the new value, so the docblocks quoting these get corrected
  // by being told rather than by someone remembering to re-measure.
  for (const [rule, expected, worthIt] of [
    ['raw `lookYaw`, authored in body space and used in chest space', 43.64, rejected.raw],
    ['a scalar `lookYaw - chestYaw`', 20.30, rejected.scalar],
    ['the solve without the head\'s own pitch', 9.71, rejected.nopitch],
  ] as const) {
    assert.ok(
      Math.abs(asDegrees(worthIt) - expected) < 0.01,
      `${rule} now leaves ${asDegrees(worthIt).toFixed(4)} degrees, not the ${String(expected)} `
      + 'quoted beside it. Nothing is necessarily broken — the grid may simply have '
      + 'moved — but every docblock in `CharacterKit.ts`, `GameEngine.ts` and `docs/09` '
      + 'that quotes this figure is now wrong, and this assertion exists so that it is '
      + 'this test that tells you rather than a reviewer.',
    )
    assert.ok(
      asDegrees(worthIt) > bound,
      `${rule} would pass the bound above, so rejecting it needs an argument this test `
      + 'does not have.',
    )
  }

  // Three probes that keep the bound above honest. Each varies one scale and holds the
  // other at unity, because the two terms are independent and a probe that moved both
  // could not attribute what it saw — which is precisely how `body-pivot` went missing
  // from this test for four commits.
  //
  // They run on **one plan**, which on this branch's record should be the next
  // sample-presented-as-population defect. It is not — but the reason given here for
  // three commits was false, and the counter-example sits a hundred lines down.
  //
  // The false version: *"every proportion enters the rig as a position, and no direction
  // calculation reads a position."* `CharacterProportions.lean` is documented **"in
  // radians"**, takes seven distinct values across the plans, and reaches
  // `torsoPivot.rotation.x` directly as `rig.lean` — which is the very rotation
  // `solveHeadYaw` consumes. Three more fields are radians and four are scales. A
  // proportion reaching a rotation is not merely possible, it is what the wobble test
  // below already does: `const chestPitch = 0.04 + 0.22 + p.lean`.
  //
  // The true version is narrower and is a property of **this probe**, not of the rig:
  // the probe *overwrites* `torso-pivot.rotation` wholesale before measuring, so every
  // plan-derived rotation is discarded before it can matter. What remains plan-derived
  // in the chain is `neckPivot.position.y` and the head's own offset — **translations,
  // and a translation cannot change a direction.**
  //
  // The difference is not pedantic. The false version would license a probe that
  // *derived* its chest pitch from `p.lean`, and plan-independence would then be
  // straightforwardly untrue while the stated reason said it could not be. A reviewer
  // found this by reading the type rather than the argument. The assertion below is
  // unaffected and re-verifies the property empirically across all 27 plans rather than
  // resting on either argument, which is the only reason a wrong justification stayed
  // harmless for three commits.
  const probe = (breath: number, bodyZ: number, faction = 'elf', role = 'soldier'): number => {
    const p = resolveCharacterPlan(faction as CharacterFaction, role, 0, false).proportions
    const skeleton = buildCharacterSkeleton(p)
    const head = new THREE.Object3D()
    head.position.y = skeleton.headY
    skeleton.headPivot.add(head)
    setCharacterShoulderWidth(skeleton.torsoPivot, skeleton.neckPivot, 1.07)
    skeleton.torsoPivot.scale.y = breath
    skeleton.bodyPivot.scale.set(1.05, 1.055, 1.05 * bodyZ)
    let peak = 0
    for (let i = 0; i <= AXES[0].steps; i += 1) {
      for (let j = 0; j <= AXES[1].steps; j += 1) {
        const x = at(AXES[0], i)
        const y = at(AXES[1], j)
        const z = AXES[2].to
        const headPitch = AXES[3].to
        skeleton.torsoPivot.rotation.set(x, y, z)
        for (const target of TARGETS) {
          skeleton.headPivot.rotation.set(
            headPitch,
            solveHeadYaw(x, y, z, headPitch, target),
            AXES[4].from,
          )
          skeleton.root.updateMatrixWorld(true)
          forward.set(0, 0, 1).transformDirection(head.matrixWorld)
          peak = Math.max(peak, Math.abs(Math.atan2(forward.x, forward.z) - target))
        }
      }
    }
    return peak * (180 / Math.PI)
  }

  // 1. With both scales at unity the chain is pure rotation, and the solve is exact.
  //    If this ever reads more than float noise, the solve is wrong — not the scales —
  //    and the bound above would absorb it silently.
  //
  //    The threshold is 1e-10 degrees against a measured 4e-14: four orders of
  //    headroom for float, not the twenty-six million a previous 1e-6 gave while its
  //    comment called it "float noise". A reviewer pointed out that mismatch, and it
  //    matters here more than most — this guard's whole job is to stop the skew bound
  //    absorbing a solver error, so slack in it is slack in both.
  const exact = probe(1, 1)
  assert.ok(
    exact <= 1e-10,
    `with no breath and no body asymmetry the solve should be exact, and it is out by `
    + `${exact.toExponential(3)} degrees. The residue above is then neither of the two `
    + 'scales, and its bound is measuring something it does not name.',
  )
  // 2. The breath term is linear in the breath, which is what makes its coefficient a
  //    coefficient. If this stops holding, `SKEW_PER_UNIT_BREATH` is a number again.
  //    Body asymmetry held at unity so this measures one term, not their sum.
  const breathSingle = probe(1 + BREATH_AMPLITUDE, 1)
  const breathDouble = probe(1 + 2 * BREATH_AMPLITUDE, 1)
  assert.ok(
    Math.abs(breathDouble / breathSingle - 2) < 0.02,
    `doubling the breath changed the heading residue by ${(breathDouble / breathSingle).toFixed(4)}x, `
    + 'not 2x. The residue is no longer linear in the breath, so `SKEW_PER_UNIT_BREATH` '
    + 'is no longer a coefficient and the bound above is just a number again.',
  )
  // 3. And the body term is linear in the body's X-vs-Z asymmetry, with the breath
  //    held off. This is the guard that did not exist while `body-pivot` was missing
  //    from the sweep entirely — the term was 9.4x the whole bound and no assertion
  //    in the file could see it, because none of them applied the scale that causes it.
  const bodySingle = probe(1, 1 - BODY_Z_ASYMMETRY)
  const bodyDouble = probe(1, 1 - 2 * BODY_Z_ASYMMETRY)
  assert.ok(
    bodySingle >= 0.5 * SKEW_PER_UNIT_BODY_ASYMMETRY * BODY_Z_ASYMMETRY,
    `the body's asymmetry contributed only ${bodySingle.toFixed(4)} degrees, less than `
    + `half what \`SKEW_PER_UNIT_BODY_ASYMMETRY\` predicts for it. Measured it is `
    + `${(bodySingle / breathSingle).toFixed(2)}x the breath's ${breathSingle.toFixed(4)}; `
    + 'if it has collapsed toward zero this sweep is no longer applying `body-pivot`\'s '
    + 'scale and the bound has quietly lost the larger of the two inputs it names.',
  )
  assert.ok(
    Math.abs(bodyDouble / bodySingle - 2) < 0.05,
    `doubling the body's X-vs-Z asymmetry changed the heading residue by `
    + `${(bodyDouble / bodySingle).toFixed(4)}x, not 2x. `
    + '`SKEW_PER_UNIT_BODY_ASYMMETRY` is no longer a coefficient.',
  )
  // 4. And the three probes above are entitled to run on one plan, because the residue
  //    is the same for every plan. **Asserted rather than argued**, which turned out to
  //    matter: the argument that stood here for three commits — proportions enter the
  //    rig as positions, and no direction calculation reads a position — is false.
  //    `lean` is a proportion in radians and reaches `torsoPivot.rotation.x`. The
  //    property still holds, for the narrower reason given above the probe, and this
  //    assertion is why a wrong justification cost nothing: it measures the residues
  //    instead of trusting the sentence beside them.
  //
  //    That is the case for asserting a property you believe you can prove. **A proof
  //    is only as good as its weakest premise and nothing re-checks a premise**, while
  //    an assertion re-checks itself on every run — and this one was written by someone
  //    who believed the false argument and would have written the same code either way.
  //
  //    Nine decimals is normally the kind of precision choice worth attacking as a
  //    knife-edge. Measured, it is not: the residues are **bit-identical** across the
  //    27 plans — one distinct double, spread exactly 0, zero ulps — so the margin to
  //    the rounding threshold is not a judgement call. Comparing raw doubles instead
  //    would be stricter and would also fail on a harmless last-bit change, which is a
  //    worse trade for a property that is structural rather than numerical.
  const breathResidues = new Set<string>()
  const bodyResidues = new Set<string>()
  for (const faction of FACTIONS) {
    for (const role of ROLES) {
      breathResidues.add(probe(1 + BREATH_AMPLITUDE, 1, faction, role).toFixed(9))
      bodyResidues.add(probe(1, 1 - BODY_Z_ASYMMETRY, faction, role).toFixed(9))
    }
  }
  assert.equal(
    breathResidues.size,
    1,
    `the breath residue takes ${String(breathResidues.size)} distinct values across the `
    + `${String(FACTIONS.length * ROLES.length)} plans: ${[...breathResidues].join(', ')}. `
    + 'It is no longer plan-independent, so the probes above are sampling one plan out '
    + 'of a population that varies — and `SKEW_PER_UNIT_BREATH` was fitted on that one '
    + 'sample. Sweep the plans in the probes, or find what made a direction depend on a '
    + 'proportion.',
  )
  assert.equal(
    bodyResidues.size,
    1,
    `the body residue takes ${String(bodyResidues.size)} distinct values across the plans: `
    + `${[...bodyResidues].join(', ')}. Same consequence as the breath residue above.`,
  )
})

/**
 * And it holds still while the chest twists under it.
 *
 * The test above measures settled poses, and a settled pose cannot see a lag. The
 * head's yaw is *damped* — `dampAngle(..., 7, delta)` — and the chest's yaw
 * oscillates with the gait. Damping a target that has already been converted into
 * chest space puts the chest's own oscillation inside the thing being smoothed, and
 * the lag comes straight back out as world-space wobble. So the tracking is damped
 * in body space, on `actor.headYaw`, and `solveHeadYaw` converts instantaneously.
 * **A frame change is not a motion.**
 *
 * ## The gait model here was wrong by 3.7×, and it mattered
 *
 * `actorGaitCadence` returns **radians per metre travelled**, not per second:
 * `updateActors` does `gaitPhase += travelled * cadence`. A soldier moves at 3.7 m/s
 * and its cadence is 6.8 rad/m, so its chest oscillates at **25.16 rad/s — 4.00 Hz**,
 * not the 6.8 rad/s an earlier version of this test simulated. The stride is also
 * damped at 15 on its way from `sin(gaitPhase)` to `actor.stride`, which this model
 * dropped.
 *
 * That is not a cosmetic error. The anti-degeneracy guard below was `converted > 2`,
 * chosen against the slow model. Under the real physics the rejected rule produces
 * **1.997°** — the guard had *negative margin* and was one rounding away from passing
 * vacuously. A reviewer found it by fixing the units and re-running my own assertion
 * until it fired. **A threshold sized against a mis-modelled input is the same defect
 * as a threshold sized against nothing.**
 *
 * ## Measured under the corrected model, 60 s at 60 Hz, after the transient
 *
 * Four rules, because two of them were being conflated. What this test rejects is
 * *damp after converting*; the scalar subtraction is a different rule, rejected
 * elsewhere, and an earlier draft of this table printed the scalar's number under the
 * damp-after-convert heading.
 *
 * | rule | pure-yaw chest | with the chest's real pitch and roll |
 * | --- | --- | --- |
 * | no correction | 2.199° | **2.996°** |
 * | scalar `lookYaw - chestYaw`, damped | 1.997° | **2.787°** |
 * | **damp after `solveHeadYaw`** — what this test rejects | — | **2.091°** |
 * | `solveHeadYaw`, damped in body space | **0.000°** | **0.000°** |
 *
 * The 1.997 in the second row is the figure that mattered for the guard below: it is
 * what the rejected-in-general scalar rule produces under the *correct* gait physics,
 * against a guard that used to read `> 2`.
 *
 * The second column answers the other half of the same review: an earlier version of
 * this test held the chest's pitch and roll at zero, which is *exactly* the geometry
 * where a scalar `lookYaw - chestYaw` is exact — so the test validating the
 * conversion was blind to the only condition under which that conversion broke. It
 * now drives all three axes. `solveHeadYaw` is unaffected because it is exact for any
 * chest orientation, which is the whole reason it replaced the subtraction.
 *
 * ## The guard is no longer a round number either
 *
 * `converted > 2` is replaced by `converted > BOUND` — the rejected rule must fail
 * the very bound the shipped rule is held to. That cannot drift out of calibration
 * with the thing it is guarding, because it *is* the thing it is guarding.
 */
/**
 * The gait pairs the two tests below share.
 *
 * `updateActors`: gaitPhase += travelled * actorGaitCadence(role). Cadence is radians
 * per METRE, so the angular frequency is speed x cadence. Getting this wrong by 3.7x is
 * what made an older guard vacuous, so both factors are named rather than pre-multiplied
 * — and every walking role is swept rather than one sampled, because "the gait" is a
 * population and a soldier is a sample. `actorSpeedForRole` and `actorGaitCadence` both
 * live in `GameEngine`, which a Node test cannot import, so every pair here is pinned
 * against its source in `the engine wires the rig the way these tests measure it`.
 *
 * **Six of nine roles, and the three missing ones are a decision rather than an
 * oversight.** `characterRoles()` returns nine; `minion` reproduces `soldier` exactly
 * (same speed, cadence and plan `lean`, so its wobble is 2.091 to the digit and it adds
 * a row without adding coverage); `captive` is genuinely distinct at 2.221, because the
 * guard faction gives it a `lean` of 0.180 against 0.000; and `commander` has speed 0,
 * so it does not walk, produces 0.039 of wobble and would *fail* the rejected-rule
 * discriminator below for the honest reason that a stationary actor has no gait to get
 * wrong. Deriving this list from `characterRoles()` would therefore break the test — the
 * exclusion is real. `captive` is the one worth adding if this table is ever revisited.
 */
const GAITS = [
  { role: 'soldier', speed: 3.7, cadence: 6.8, chestYawCoefficient: 0.12 },
  { role: 'scout', speed: 4.8, cadence: 8.4, chestYawCoefficient: 0.12 },
  { role: 'archer', speed: 3.2, cadence: 7.2, chestYawCoefficient: 0.12 },
  { role: 'brute', speed: 2.6, cadence: 5.8, chestYawCoefficient: 0.08 },
  { role: 'champion', speed: 4.15, cadence: 5.8, chestYawCoefficient: 0.08 },
  { role: 'peasant', speed: 3.1, cadence: 6.8, chestYawCoefficient: 0.12 },
] as const

/**
 * What the rejected rule produces per role, measured off this sweep.
 *
 * Not a bound and not a tolerance — a record, pinned to a thousandth of a degree so
 * that the figures quoted in the comment beside the assertion cannot go stale without
 * something saying so. Every one of these was wrong once: they were taken from the
 * pure-yaw probe that motivated the per-role sweep rather than from the sweep itself,
 * and nothing in the file could tell.
 */
const REJECTED_WOBBLE: Record<(typeof GAITS)[number]['role'], number> = {
  soldier: 2.091,
  scout: 1.526,
  archer: 2.207,
  brute: 1.932,
  champion: 1.446,
  peasant: 2.391,
}

test('the head holds its target while the chest twists under it', () => {
  const DELTA = 1 / 60
  const SECONDS = 60
  const TARGET = 0.35
  // Not a tolerance. With `solveHeadYaw` the world heading *equals* the damped
  // body-space angle identically, for any cadence, amplitude or damping rate — so
  // this reads exactly zero and cannot be made to fail by moving a parameter, only by
  // changing the rule. It is a **rule discriminator**, and the paired assertion below
  // is what gives it teeth. A reviewer made that distinction and it is worth keeping
  // visible: knowing which of your bounds are tolerances and which are discriminators
  // is the difference between a number that can drift and one that cannot.
  const BOUND = 0.1
  const damp = (from: number, to: number, lambda: number): number =>
    to + (from - to) * Math.exp(-lambda * DELTA)
  const forward = new THREE.Vector3()

  const wobble = (
    gait: (typeof GAITS)[number],
    dampInBodySpace: boolean,
  ): number => {
    const p = resolveCharacterPlan('guard', gait.role, 0, false).proportions
    const skeleton = buildCharacterSkeleton(p)
    const head = new THREE.Object3D()
    head.position.y = skeleton.headY
    skeleton.headPivot.add(head)
    let gaitPhase = 0
    let stride = 0
    let bodyYaw = TARGET
    let converted = TARGET
    let worst = 0
    for (let frame = 0; frame < SECONDS / DELTA; frame += 1) {
      const time = frame * DELTA
      gaitPhase += gait.speed * DELTA * gait.cadence
      stride = damp(stride, Math.sin(gaitPhase) * 0.62, 15)
      // The chest, on all three axes: the gait's twist, the forward lean plus the
      // storm hunch plus the plan's own lean, and the turn's roll. Holding pitch and
      // roll at zero is the one geometry where a scalar conversion happens to work,
      // and two earlier versions of these tests did exactly that.
      const chestYaw = -stride * gait.chestYawCoefficient
      const chestPitch = 0.04 + 0.22 + p.lean
      const chestRoll = -Math.sin(time * 2) * 0.08
      if (dampInBodySpace) {
        bodyYaw = damp(bodyYaw, TARGET, 7)
        skeleton.headPivot.rotation.y =
          solveHeadYaw(chestPitch, chestYaw, chestRoll, 0, bodyYaw)
      } else {
        // The rejected rule: damp after converting, so the chest's own oscillation
        // is inside the thing being smoothed.
        converted = damp(
          converted,
          solveHeadYaw(chestPitch, chestYaw, chestRoll, 0, TARGET),
          7,
        )
        skeleton.headPivot.rotation.y = converted
      }
      skeleton.torsoPivot.rotation.set(chestPitch, chestYaw, chestRoll)
      skeleton.root.updateMatrixWorld(true)
      // Past the start-up transient, which neither rule is being judged on.
      if (time <= 8) continue
      forward.set(0, 0, 1).transformDirection(head.matrixWorld)
      worst = Math.max(worst, Math.abs(Math.atan2(forward.x, forward.z) - TARGET))
    }
    return worst * (180 / Math.PI)
  }

  for (const gait of GAITS) {
    const damped = wobble(gait, true)
    const converted = wobble(gait, false)
    assert.ok(
      damped <= BOUND,
      `a ${gait.role}'s head wobbled ${damped.toFixed(3)} degrees with the gait, over `
      + `${BOUND.toFixed(2)}. Damp the tracking in body space and convert with `
      + '`solveHeadYaw` afterwards; a frame change is not a motion, and damping the '
      + 'converted angle makes the head chase the chest a fraction of a second late.',
    )
    // The rejected rule has to fail the bound the shipped rule passes, or this test
    // has stopped distinguishing them. Expressed against `BOUND` rather than a round
    // number, so the two cannot drift apart — the first version said `> 2`, sized
    // against a gait model 3.7x too slow.
    //
    // The figures this comment used to quote — 1.983 for a soldier, 1.36 for a
    // champion against 2.10 for an archer — were from the wrong column. They are what
    // the rejected rule produces with the chest's *pitch and roll held at zero*,
    // which is precisely the pure-yaw geometry this test's own docblock spends two
    // paragraphs explaining that earlier versions were wrong to use. What this loop
    // actually computes is 2.091, 1.446 and 2.207. The numbers were carried across
    // from the probe that motivated the per-role sweep and never re-read off the
    // sweep itself — the same defect as the gaze table above, in the same file, on
    // the same day. Quoting a figure from the experiment that *prompted* an assertion
    // rather than from the assertion is how a comment ends up describing code that
    // was replaced for being wrong.
    //
    // So they are pinned, not quoted. Correcting a stale number and leaving nothing
    // able to notice the next one is half a fix, and this file had just done exactly
    // that to the gaze table two hundred lines above. The whole per-role table is
    // asserted to a thousandth of a degree; if the gait model, the damping rate or the
    // rejected rule moves, this names the new value instead of a reviewer doing it.
    assert.ok(
      Math.abs(converted - REJECTED_WOBBLE[gait.role]) < 0.001,
      `a ${gait.role}'s rejected rule now produces ${converted.toFixed(3)} degrees of `
      + `wobble, not the ${REJECTED_WOBBLE[gait.role].toFixed(3)} recorded beside it. `
      + 'Nothing is necessarily broken — but the comment above and any docblock quoting '
      + 'these figures are now wrong, and this assertion exists so that they get '
      + 'corrected by being told rather than by someone remembering to re-measure.',
    )
    assert.ok(
      converted > BOUND,
      `a ${gait.role}'s rejected rule produced only ${converted.toFixed(3)} degrees of `
      + `wobble, inside the ${BOUND.toFixed(2)} the shipped rule is held to. This test `
      + 'is no longer distinguishing the two rules. Check the gait model against '
      + '`updateActors` before touching the bound: cadence is radians per metre.',
    )
  }
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
 * What makes it *tolerable* — not survivable, and the distinction matters — is a
 * workaround rather than a joint. docs/09 §4 says `animateBeastPosture` "replaces
 * the biped shoulder bend, hip counter-rotation and head yaw, all of which pull an
 * animal apart at the joints when applied to a body whose skull sits a metre forward
 * of its own pivot". True, but it *reduces* the defect rather than removing it: the
 * skull still slides against the ribcage, measured in authored units at 0.296 on a
 * wolf, 0.368 on a bear and **0.660 on a troll** under attack plus stagger, before
 * `BEAST_PROFILES.scale` multiplies it into world units. A reviewer measures the
 * troll at over a metre in the world — worse than the 0.66 m humanoid case that got
 * reported. Filed separately rather than guessed at here.
 *
 * So the two premises this test pins are the early return that keeps a beast out of
 * the biped pass and the clamp on the beast's own yaw. Both are load-bearing, both
 * are one line, and both are invisible to every other test in this file. Neither
 * makes the beast rig correct; they keep it inside the arc it can hide.
 */
test('a beast never reaches the biped posture pass, and its own yaw stays clamped', () => {
  // The clamp `animateBeastPosture` puts on the beast's look. Named once and used
  // both to assert the source and to size the sweep, so the two cannot disagree.
  const BEAST_YAW_CLAMP = 0.45
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
  // Built from the constant, not restated beside it. Written out as a literal this
  // regex went on passing while `BEAST_YAW_CLAMP` said something else, so the sweep
  // below and the clamp it claims to be measuring could quietly disagree — a
  // reviewer caught that, and it is the same defect as a bound that cannot fail.
  const clampSource = new RegExp(
    `clamp\\(lookYaw,\\s*-${BEAST_YAW_CLAMP},\\s*${BEAST_YAW_CLAMP}\\)`,
  )
  assert.ok(
    clampSource.test(beastPass),
    `the beast head yaw is no longer clamped to +/-${BEAST_YAW_CLAMP} rad, which is the `
    + 'only reason a skull on a pivot at the animal\'s centre still reads as attached. '
    + 'If the clamp has moved deliberately, move BEAST_YAW_CLAMP with it and re-measure '
    + 'the sweeps below — they are sized from it.',
  )
  // The rig data the numbers above were measured from, so a rewritten table is
  // noticed here rather than in a screenshot.
  //
  // The bound is the animal's own `footprint` — the radius of its contact shadow,
  // which is an independent number in the same authored units. Be clear about what it
  // is: a **smoke bound**, not a derivation. It compares a chord against a radius, and
  // there is no geometric reason those should be equal; what it buys is that the two
  // quantities are authored separately, so a `headZ` that grows without a `footprint`
  // to match trips it. A reviewer pointed out that an earlier message called the
  // footprint "how wide the animal is", which is a radius described as a width.
  //
  // The first version of this assertion compared the sweep against `rig.headZ`, and
  // `2 * headZ * sin(t/2)` divided by `headZ` is just `2 * sin(t/2)` = 0.446: the term
  // it was bounding cancelled out and the check was true for every possible rig. It
  // was caught by a reviewer who moved a wolf's skull to `headZ` 100 and watched the
  // test pass.
  for (const kind of BEASTS) {
    const rig = BEAST_RIG[kind]
    assert.ok(
      rig.headZ > 0 && rig.headY > 0,
      `${kind}: a skull is up and forward of the body centre`,
    )
    const sweep = 2 * rig.headZ * Math.sin(BEAST_YAW_CLAMP / 2)
    assert.ok(
      sweep <= rig.footprint,
      `a ${kind}'s skull sweeps ${sweep.toFixed(4)} sideways at the clamped `
      + `${BEAST_YAW_CLAMP.toFixed(2)} rad look — further than its ${rig.footprint.toFixed(2)} `
      + 'footprint radius. A head on a pivot at the body centre only reads as attached '
      + 'while that stays true; either clamp the look further, bring `headZ` in, or give '
      + 'the beasts a neck joint as `buildCharacterSkeleton` does for people.',
    )
  }
})

/**
 * The engine uses the rig the way the tests above assume.
 *
 * `GameEngine` cannot be instantiated in Node — no DOM, no WebGL — so every
 * measurement in this file is taken through `CharacterKit`'s pure pieces. That
 * proves the arithmetic and proves nothing about whether the engine calls it. These
 * are the couplings, kept in one place with a name that says what they are.
 *
 * They lived inside the beast test for a while, which meant three humanoid guards
 * were hiding under a heading about wolves, and a reviewer pointed out that stripping
 * the gaze correction from the engine was caught by exactly one assertion in the
 * whole suite — sitting in the wrong test. A guard nobody can find is a guard nobody
 * will keep.
 */
test('the engine wires the rig the way these tests measure it', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/game/GameEngine.ts', import.meta.url)),
    'utf8',
  )
  // `applyActorVisualVariation` runs for beasts as well as people, and it divides
  // the chest's width back out at the neck — which only exists on a person. A beast
  // has no `neck-pivot`, so the lookup is the guard; written as a lookup rather than
  // a role test so that adding a beast neck later fixes this for free.
  const variation = source.slice(
    source.indexOf('private applyActorVisualVariation('),
    source.indexOf('private createActorHealthBar('),
  )
  assert.ok(variation.length > 500, 'could not isolate the actor variation pass')
  // The width now goes through one shared function, which is what lets the numerical
  // test above drive the real correction instead of a copy of its arithmetic. These
  // two say the engine still delegates rather than doing it inline again.
  assert.ok(
    /setCharacterShoulderWidth\(\s*torsoPivot,\s*mesh\.getObjectByName\('neck-pivot'\),\s*shoulders,?\s*\)/
      .test(variation),
    'the shoulder width must go through `setCharacterShoulderWidth`, passing the neck. '
    + 'Written inline again, the arithmetic in `the chest lends the head its breath but '
    + 'not its shoulders` becomes a copy that cannot fail when production changes.',
  )
  assert.ok(
    !/(neckPivot|headPivot)\.scale/.test(variation),
    'the variation pass must not write a neck or head scale itself. The counter-scale '
    + 'belongs in `setCharacterShoulderWidth`, and never on `head-pivot`: the animation '
    + 'rotates that, and a scale correction below a rotation only cancels at rest.',
  )
  // The gaze. Without these two the engine could apply `lookYaw` raw, or damp it
  // after converting, and every measurement in this file would still be green.
  const actorPosture = source.slice(
    source.indexOf('private animateActorCharacter('),
    source.indexOf('private samplePlayerPose('),
  )
  assert.ok(actorPosture.length > 1000, 'could not isolate the actor posture pass')
  assert.ok(
    /actor\.headYaw = dampAngle\(actor\.headYaw, lookYaw, 7, delta\)/.test(actorPosture),
    'the head\'s tracking must be damped on the body-space angle. Damped after the '
    + 'conversion it lags the chest\'s gait twist and the lag returns as world wobble.',
  )
  assert.ok(
    /headPivot\.rotation\.y = torsoPivot\s*\?\s*solveHeadYaw\(\s*torsoPivot\.rotation\.x,\s*torsoPivot\.rotation\.y,\s*torsoPivot\.rotation\.z,\s*headPitch,\s*actor\.headYaw,?\s*\)/
      .test(actorPosture),
    'the head yaw must be solved against the chest\'s full rotation *and* the head\'s '
    + 'own pitch, each passed through. Naming the function is not enough: a reviewer '
    + 'replaced the call with `solveHeadYaw(0, 0, 0, actor.headYaw)` and the whole '
    + 'suite still passed, because nothing checked the arguments. A scalar subtraction '
    + 'leaves 20.3 degrees and is worse than nothing in 3.90% of states; dropping the '
    + 'head pitch alone leaves 9.7.',
  )
  assert.ok(
    /const headPitch = -forwardLean \* actor\.motionBlend \* 0\.35 \+ pose\.stagger \* 0\.18$/m
      .test(actorPosture),
    'the head pitch must be computed before the solve and reused when it is written, '
    + 'so the solve reads the value that actually lands on the pivot. Anchored at the '
    + 'end of the line: unanchored, appending `+ pose.attack * 0.4` still matched, and '
    + 'that term would push the head pitch outside the [-0.09, 0.18] axis the skew '
    + 'bound is derived over — the bound would silently stop describing the engine.',
  )
  assert.ok(
    /headPivot\.rotation\.x = headPitch$/m.test(actorPosture),
    'the pitch the solve was given must be the pitch the head is given. Anchored for '
    + 'the same reason: a reviewer mutated this to `headPitch * 0.5` and the whole file '
    + 'passed 22/0, because the unanchored pattern matches its own prefix. Hoisting '
    + '`headPitch` into a const exists solely so the solve and the pivot read one '
    + 'value, and this was the assertion that was supposed to notice them diverging. '
    + 'Driving the solve with a pitch the head does not wear costs 9.7 degrees.',
  )
  // The breath. `the chest lends the head its breath but not its shoulders` derives
  // its whole bound from these two numbers — they are the only thing that legitimately
  // reaches the head — so a bound that came from an input the defect cannot move is
  // worth nothing if the input itself has quietly drifted from the engine.
  assert.ok(
    /const breathing = Math\.sin\([^)]*\) \* 0\.018/.test(actorPosture),
    'the breathing amplitude is no longer 0.018. Move it in the anisotropy test\'s '
    + '`BREATH_AMPLITUDE` in the same commit — that test\'s bound is derived from it, '
    + 'and a derivation reading a stale input is just a round number again.',
  )
  assert.ok(
    /torsoPivot\.scale\.y = 1 \+ breathing \* 0\.55/.test(actorPosture),
    'the chest\'s breath is no longer `1 + breathing * 0.55`. Move it in the anisotropy '
    + 'test\'s `BREATH_AMPLITUDE` in the same commit.',
  )
  // The gait. `the head holds its target while the chest twists under it` simulates
  // the engine's loop, and its whole point is that the model matches — an earlier
  // version read `actorGaitCadence` as radians per second when it is radians per
  // metre, which left that test's guard with negative margin.
  //
  // These used to pin four numbers with `includes`, which asks whether a string
  // appears *somewhere* in the function, not whether it appears next to the role it
  // belongs to. A reviewer swapped the scout's and the archer's cadences — 8.4 and
  // 7.2 traded — and the whole file still passed, because both strings were still
  // present. The wobble simulation was then modelling the wrong physics for two
  // roles, which is the exact "threshold sized against a mis-modelled input" defect
  // the cadence fix existed to close, reintroduced by the assertion meant to prevent
  // it. **A pin that tests for the presence of a value cannot see it move to another
  // key**, and half the point of a lookup table is which key each value sits under.
  //
  // Driven off `GAITS` itself rather than a hand-written subset, so a row added there
  // is pinned here automatically. Six of the eighteen numbers were pinned before; all
  // eighteen are now, and adding a seventh role pins three more without an edit.
  assert.ok(
    /actor\.gaitPhase \+= travelled \* this\.actorGaitCadence\(actor\.role\)/.test(source),
    'the gait no longer advances by distance travelled. `the head holds its target '
    + 'while the chest twists under it` multiplies speed by cadence on the strength of '
    + 'this line; if the gait becomes time-based, that simulation is wrong by the '
    + 'actor\'s speed.',
  )
  const cadence = source.slice(
    source.indexOf('private actorGaitCadence('),
    source.indexOf('private animateActorCharacter('),
  )
  // `soldier` and `peasant` are not named in the cadence function — they fall through
  // to its default — so their pairing is the default's value, and naming that is the
  // assertion. Same for the chest coefficient: `heavy` is a two-role predicate, and
  // everyone else takes the other branch.
  const DEFAULT_CADENCE = '6.8'
  const HEAVY = ['brute', 'champion']
  for (const gait of GAITS) {
    const value = String(gait.cadence)
    const paired = value === DEFAULT_CADENCE
      ? new RegExp(`return ${value.replace('.', '\\.')}\\s*\\n\\s*\\}`).test(cadence)
        && !new RegExp(`'${gait.role}'`).test(cadence)
      : new RegExp(`role === '${gait.role}'[^\\n]*\\)\\s*return ${value.replace('.', '\\.')}`)
        .test(cadence)
    assert.ok(
      paired,
      `the ${gait.role}'s gait cadence is no longer ${value} — either the value moved, `
      + 'or it moved to another role. `GAITS` in `the head holds its target while the '
      + 'chest twists under it` must move with it, or that test simulates physics the '
      + 'engine does not run.',
    )
    assert.ok(
      new RegExp(`role === '${gait.role}'\\s*\\n?\\s*\\?\\s*${String(gait.speed).replace('.', '\\.')}`)
        .test(source)
      || (gait.role === 'soldier' && /:\s*3\.7\)/.test(source))
      || (gait.role === 'peasant' && new RegExp(`role === 'peasant'[\\s\\S]{0,40}?${String(gait.speed).replace('.', '\\.')}`).test(source)),
      `the ${gait.role}'s speed is no longer ${String(gait.speed)}; GAITS pairs each `
      + 'speed with its cadence and the simulation multiplies the two.',
    )
    assert.equal(
      gait.chestYawCoefficient,
      HEAVY.includes(gait.role) ? 0.08 : 0.12,
      `GAITS gives the ${gait.role} a chest yaw coefficient of `
      + `${String(gait.chestYawCoefficient)}, but the engine's \`heavy\` predicate puts `
      + `it on ${HEAVY.includes(gait.role) ? '0.08' : '0.12'}.`,
    )
  }
  assert.ok(
    /const heavy = actor\.role === 'brute' \|\| actor\.role === 'champion'/.test(source),
    'the `heavy` predicate has changed, so GAITS\' 0.08-vs-0.12 split no longer '
    + 'matches the engine. The assertion above compares against a hard-coded pair of '
    + 'role names and this is what keeps that honest.',
  )
  // Which stride the chest reads, and what a stagger does to it. Both are load-bearing
  // for the joint-reachability model the gaze test's comment describes, and a previous
  // version of that comment asserted the opposite of both — that `pose.stride` being
  // zeroed under stagger leaves a staggering chest with no gait yaw. It does not:
  // `pose.stride` only ever reaches the limbs, and `actor.stride` is damped rather than
  // cleared. Pinned here so the next claim of that shape fails instead of shipping.
  //
  // **Each pin is in two halves, and the second half is the one that was missing.** A
  // positive source regex proves a line exists; it cannot prove the line still governs
  // the value. A reviewer produced two mutations that create exactly the world these
  // comments call impossible and left the file green:
  //
  //   keep the damp, add `actor.stride = 0` on the next line     22 pass, 0 fail
  //   gate the chest's stride term on `pose.stagger > 0`         22 pass, 0 fail
  //
  // Both are *additions*, so anchoring does not help — the pinned line is still there,
  // exactly as written, and has simply stopped mattering. **A pin that only looks for
  // what should be present is blind to anything added after it**, which is the same
  // shape as the `headPivot.rotation.x = headPitch` prefix hole and the third instance
  // of it in this file. The negative assertions below are what close it.
  assert.ok(
    /torsoPivot\.rotation\.y =\s*\r?\n?\s*-actor\.stride \*/.test(actorPosture),
    'the chest\'s yaw no longer reads `actor.stride`. If it now reads `pose.stride`, a '
    + 'stagger really would zero it, and the gaze test\'s reachability comment — which '
    + 'says the opposite — becomes wrong in the other direction.',
  )
  const chestYawExpression = actorPosture.slice(
    actorPosture.indexOf('torsoPivot.rotation.y ='),
    actorPosture.indexOf('torsoPivot.rotation.z ='),
  )
  assert.ok(
    chestYawExpression.length > 40 && !/stagger/.test(chestYawExpression),
    'the chest\'s yaw expression now mentions `stagger`, so the gait term it reads may '
    + 'be gated off during one. That is the behaviour the gaze test\'s reachability '
    + 'model says is impossible, and the positive pin above cannot see it because the '
    + '`-actor.stride *` it looks for is still there, merely multiplied by zero.',
  )
  const staggerBranch = source.slice(
    source.indexOf("if (actor.reaction === 'stagger' || knockbackSpeed"),
    source.indexOf("if (actor.reaction === 'stagger' || knockbackSpeed") + 400,
  )
  assert.ok(
    /actor\.stride = THREE\.MathUtils\.damp\(actor\.stride, 0, 13, delta\)/.test(staggerBranch),
    'a stagger no longer damps `actor.stride` at 13 — if it now clears it, the first '
    + 'frame of a stagger stops carrying ~81% of its gait yaw and the gaze test\'s '
    + 'reachability comment needs re-deriving, not editing.',
  )
  assert.equal(
    (staggerBranch.match(/actor\.stride\s*=/g) ?? []).length,
    1,
    'the stagger branch assigns `actor.stride` more than once. The damp above is still '
    + 'present — that is why the pin beside this one passes — but something after it '
    + 'writes the value again, and if that write is a clear then the ~81% retention the '
    + 'gaze test\'s reachability model depends on is gone.',
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


/**
 * The kettle helm decides a winding assertion on a quantity that is exactly zero.
 *
 * Reported by the Wave 4 reviewer, which declined to act on it — correctly, on both
 * counts: reshaping a shipped silhouette to satisfy a test is the wrong direction, and
 * loosening the assertion would trade a real check for a quiet one. It flagged it as a
 * latent flake and left it. This makes the flake **visible** instead, which is the third
 * option and the one this programme keeps arriving at.
 *
 * `insideOutTriangles` asks `dot(face, first-vertex normal) < 0`. Measured across every
 * headgear kind, the weakest `|cos|` is:
 *
 * ```text
 * kettle      0.000e+0      <- 12 faces of 180, exactly zero
 * ragHood     5.911e-1
 * hood        6.129e-1
 * ...
 * greathelm   9.997e-1
 * ```
 *
 * **That is a discontinuity, not a tight margin.** Every other kind sits above 0.59; the
 * kettle sits at exactly 0 because its brim's lathe profile reverses sharply, so
 * `LatheGeometry`'s averaged normal at that ring points *along* the profile — exactly
 * perpendicular to its own face. The dot is `+0`, and `+0 < 0` is false, so today it
 * passes **deterministically** rather than by luck. The hazard is that nothing about the
 * geometry keeps it on that side: nudge the profile and those twelve faces become a tiny
 * negative, and a test named for inside-out triangles fails on a helm that is not inside
 * out.
 *
 * So this pins the two facts that make the pass meaningful rather than accidental — the
 * degenerate faces are exactly zero, and none of them is negative — and fails with an
 * explanation instead of leaving the next person to rediscover the geometry.
 *
 * **What it deliberately does not do:** change `insideOutTriangles`, which would make it
 * detect less, or move the art. The face-orientation question at those twelve faces is
 * genuinely undefined for a normal-based instrument, and it is already answered
 * structurally by the edge-consistency check, which consults no normals at all.
 */
test('the kettle helm passes its winding check by construction, not by rounding', () => {
  const geometry = buildHeadgear('kettle')
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const index = geometry.getIndex()
  const count = index ? index.count : position.count

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const edge1 = new THREE.Vector3()
  const edge2 = new THREE.Vector3()
  const face = new THREE.Vector3()
  const stored = new THREE.Vector3()

  let judged = 0
  let exactlyZero = 0
  let negative = 0
  let nearZeroButNot = 0
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    const i0 = index ? index.getX(triangle) : triangle
    const i1 = index ? index.getX(triangle + 1) : triangle + 1
    const i2 = index ? index.getX(triangle + 2) : triangle + 2
    a.fromBufferAttribute(position, i0)
    b.fromBufferAttribute(position, i1)
    c.fromBufferAttribute(position, i2)
    face.copy(edge1.subVectors(b, a)).cross(edge2.subVectors(c, a))
    if (face.lengthSq() < 1e-14) continue
    stored.fromBufferAttribute(normal, i0)
    if (stored.lengthSq() < 1e-14) continue
    judged += 1
    const cosine = face.normalize().dot(stored.normalize())
    if (cosine < 0) negative += 1
    if (cosine === 0) exactlyZero += 1
    else if (Math.abs(cosine) < 1e-6) nearZeroButNot += 1
  }
  geometry.dispose()

  assert.ok(judged > 0, 'the kettle produced no judgeable faces, so this asserts nothing')

  assert.equal(
    negative,
    0,
    `${String(negative)} kettle faces wind against their own normal. If this is the first `
    + 'failure after a change to the brim profile, the helm is probably not inside out: '
    + 'twelve of its faces sit at exactly zero margin because the profile reverses and '
    + 'the lathe normal there points along it, and a nudge tips them negative. Check the '
    + 'edge-consistency instrument, which reads no normals, before touching the winding.',
  )

  assert.equal(
    nearZeroButNot,
    0,
    `${String(nearZeroButNot)} kettle faces sit within 1e-6 of zero without being exactly `
    + 'zero, which means the perpendicularity is now the result of arithmetic rather than '
    + 'of the profile being exactly reversed. At that point the sign really is decided by '
    + 'rounding, and this check stops being deterministic.',
  )

  assert.ok(
    exactlyZero > 0,
    'no kettle face sits at exactly zero margin any more. That is very likely an '
    + 'improvement — but it means the geometry this test was written against has changed, '
    + 'so re-measure the weakest margin before deleting this.',
  )
})
