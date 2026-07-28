import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { actorGaitCadence, actorSpeedForRole, BEAST_ROLES } from '../src/game/types.ts'
import { BEAST_PROFILES } from '../src/game/world/Fauna.ts'
import * as THREE from 'three'
import {
  BEAST_KINDS,
  BEAST_LOOK_CLAMP,
  BEAST_RIG,
  CHARACTER_FACTIONS,
  CHARACTER_VARIANTS,
  GeometryCache,
  artVariation,
  beastLookYaw,
  buildBeastBody,
  buildBeastHead,
  buildBeastLimb,
  buildBeastSkeleton,
  buildBeastTail,
  buildBirdBody,
  buildBirdWing,
  applyChestPose,
  applyHeadPose,
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
  chestGaitYaw,
  decayStrideOnStagger,
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
  // The five pivots are now named by `buildCharacterSkeleton`, and the beast's five by
  // `buildBeastSkeleton`, so both rigs live in `CharacterKit` rather than the engine.
  // Search both files: the engine used to name all four beast pivots itself, and
  // searching only the engine would have gone on passing for a body that had lost every
  // one of them.
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
  // This used to allow exactly one — `createBeast`'s, on the argument that a quadruped's
  // neck could not be guessed at. It could: `BEAST_RIG` already says where each animal's
  // front limbs hang from. Now nobody may, and the beast half of that is asserted with
  // its own reasons in `the engine poses a beast through the rig these tests measure`.
  assert.equal(
    (rigSource.match(/bodyPivot\.add\(headPivot\)/g) ?? []).length,
    0,
    'nothing may root a head-pivot at the body: a person hangs one off the spine and an '
    + 'animal off its shoulder. A head parented to the body is a second root at the feet.',
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
  //
  // And the modulo form that replaced it was a second member of the same class rather
  // than a fix. `lookStates % LOOK_POSES === 0` is satisfied by dropping the *pitch*
  // endpoint instead of the roll one: 385 poses over 120 sweeps is 46,200, and
  // 46,200 % 462 === 0. A reviewer found that. **A divisibility check on a count is a
  // check on the number of sweeps, not on the size of one** — so it is asserted
  // directly now, against the plans and configurations that produce it.
  const LOOK_POSES =
    (LOOK_PITCH.steps + 1) * (LOOK_YAW.steps + 1) * (LOOK_ROLL.steps + 1)
  assert.equal(
    LOOK_POSES,
    462,
    `the look grid is now ${String(LOOK_POSES)} poses, not the 462 published in `
    + '`CharacterKit.ts` and `docs/09`. Update both, or restore the axis that shrank.',
  )
  assert.equal(
    lookStates,
    55_440,
    `the look grid visited ${String(lookStates)} states, not the 55,440 that 462 poses `
    + 'across every plan and shoulder/breath configuration produce. Asserted as a total '
    + 'rather than as a multiple of 462, because a multiple is also what you get when a '
    + 'different axis loses an endpoint and the sweep count absorbs it.',
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
 * as the angle between the head's world forward and the requested heading. The three
 * rejected rows are computed on **one plan** of that sweep, 228,690 states, which the
 * plan-independence assertion below the probes proves is the whole population rather
 * than a sample of it:
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
  // The objective is **constant** in head roll — not merely flat at this maximum. The
  // worst chest configuration scores identically at roll 0.037 and at -0.150, and
  // sweeping roll across arbitrary chest states moves the heading by at most 2.4e-14
  // degrees, which is float noise. Saying "the maximum is roll-degenerate" would be
  // true and would still mislead, because it invites the thought that some *other*
  // maximum might be roll-sensitive. None can be. A reviewer measured this first and I
  // reproduced it rather than taking it, which is the rule this whole passage is about.
  //
  // **And it was refutable without measuring anything, from this codebase, ten commits
  // earlier.** `solveHeadYaw` takes `chestX, chestY, chestZ, headPitch, lookYaw`. There
  // is no roll argument, and its absence is documented as deliberate in the function's
  // own docblock — *"a rotation about Z leaves the +Z axis fixed, so head-pivot's
  // rotation.z cannot move the gaze and is not a parameter"* — written in `3257029`, by
  // the same hand that later blamed that axis for a 39% discrepancy.
  //
  // So the general rule is sharper than "verify your causes": **before offering a cause,
  // check whether your own code already answers it.** A justification written while
  // correcting yourself is not merely unverified — it is written by the one person who
  // has stopped consulting the source, because they are certain they know what it says.
  // The counter-proof here was a function signature, and a `git grep` away.
  //
  // So: **the sweep was partially joint** — it constrained some axes by the reaction and
  // left others as free cross-product ranges — and that is the defect, demonstrated.
  //
  // Which axis carried it is now partly established, by a factorial design rather than
  // a bracket, because a probe that moves two things cannot attribute what it sees.
  // One constraint relaxed at a time, coefficient = degrees / 0.0099:
  //
  //   fully joint                                             4.8203
  //   head roll freed to +/-0.30                              4.8203   <- exactly zero
  //   chest PITCH pinned at the axis maximum 0.70             5.7018
  //   chest ROLL  pinned at the axis maximum 0.30             6.0420   <- dominant
  //
  // **That is a ranking over the axes that were free, not over the axes the bound is
  // sensitive to.** Pinning chest *yaw* at its maximum gives 5.9876 — between the two —
  // but yaw contributed nothing to the discrepancy, because it is the one axis the
  // original sweep constrained correctly. A reviewer measured that and flagged the
  // misreading before anyone made it: "roll dominant, pitch second" invites being read
  // as a statement about the geometry when it is a statement about which constraints
  // were missing. **Sensitivity and contribution are different quantities, and only the
  // second one explains a wrong number.**
  //
  // **That baseline read 4.9199 for one commit, and it was itself partially joint** —
  // the fourth instance of this defect, inside the commit documenting the third. A
  // reviewer found it and named the free axis: `idleWeightShift` is
  // `sin(...) * 0.035 * (1 - actor.motionBlend)`, so at the maximum's `motionBlend`
  // of 1.18 the engine permits `|shift| <= 0.0063` and the harness permitted 0.035 —
  // **5.6x over, on an axis that feeds `torsoPivot.rotation.z` directly**. You can read
  // it off the corner: coupled, the worst sits at chest roll 0.083 (= 0.5*0.16 +
  // 0.0063*0.55); decoupled, at 0.099 (= 0.5*0.16 + 0.035*0.55).
  //
  // So the baseline was inflated by 2.1% **on precisely the axis the design set out to
  // isolate**, which means the two factors were not independent: part of the chest-roll
  // effect was already inside the baseline. The ordering survives — head roll is zero
  // for a structural reason, chest roll is the largest single term either way — but
  // every delta moved, and 4.8203 now agrees with the 4.81 quoted twenty lines above
  // instead of contradicting it inside the rule that says to reconcile or name both.
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
  // This started as an assertion on a freshly built skeleton, which pinned
  // **construction** rather than the object the engine animates. `Euler.order` is a
  // mutable per-object property, so setting it at the animation site passed 22/0 — the
  // addition-blindness lesson one object across. And the realistic edit is the quiet
  // one: `ZYX` moves the gaze 143° and any bound catches it, while **`YXZ` is what
  // everyone reaches for when a head gimbal-locks**, and under `YXZ` roll stays inert,
  // so the conspicuous signature never appears.
  //
  // `applyHeadPose` therefore passes the order to `Euler.set` on every write, which
  // does not detect a runtime change but **overwrites it on the next frame**. The
  // assertion below drives that function against a deliberately corrupted pivot rather
  // than inspecting a clean one. **An invariant that reasserts itself is worth more
  // than a guard that can be walked around**, and here it cost one argument.
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
    // Swept, not sampled — and this assertion was written *after* a reviewer showed
    // that `chestGaitYaw` and `decayStrideOnStagger` were each pinned at a single
    // input, so it should not have been one pose and one component. It was.
    //
    // The reviewer's unifying diagnosis is that every remaining hole here is **a sample
    // standing in for a population**: one plan for 27, one pose for 462, one grid corner
    // for a joint set, one stride for a function, one delta for a decay. That is the
    // same defect this file opened with — a hand-written chest table standing in for a
    // reachable envelope — and it is unrecognisable at the far end because the sample
    // stopped looking like a list and started looking like an argument list.
    //
    // So: several poses, all three components, and a component-swap check. `pitch` and
    // `yaw` transposed would satisfy any assertion that only reads `rotation.x` at a
    // pose where they happen to be equal, which is why none of the poses below have
    // two equal components.
    // Both pivots, because `solveHeadYaw` reads both and an earlier version of this
    // block reasserted only the head. A reviewer measured what the missing half cost:
    // chest order `ZYX` is worth **30.02°** against this test's 0.9650° bound, within a
    // factor of 1.5 of the original bug — and setting it at animation time passed 22/0.
    //
    // **A fix scoped to the instance that was reported is a fix scoped to a sample.**
    // The head was the pivot in the finding; the derivation names two.
    for (const sabotage of ['YXZ', 'ZYX', 'ZXY'] as const) {
      for (const [pitch, yaw, roll] of [
        [0.1, 0.2, 0.3], [-0.09, 0.65, -0.3], [0.18, -1.2, 0.037], [0, 0.5, -0.15],
      ] as const) {
        for (const [name, node, apply] of [
          ['head-pivot', s.headPivot, applyHeadPose],
          ['torso-pivot', s.torsoPivot, applyChestPose],
        ] as const) {
          node.rotation.order = sabotage
          apply(node, pitch, yaw, roll)
          assert.equal(
            node.rotation.order,
            'XYZ',
            `something set ${name}'s Euler order to ${sabotage} and the pose function left `
            + 'it there. Both pass the order to `Euler.set` precisely so that a runtime '
            + 'reassignment cannot survive a frame — asserting the order on a freshly built '
            + 'skeleton does not cover this, because the engine animates a rig the test '
            + 'never sees.',
          )
          assert.deepEqual(
            [node.rotation.x, node.rotation.y, node.rotation.z],
            [pitch, yaw, roll],
            `the pose function was given (${String(pitch)}, ${String(yaw)}, ${String(roll)}) `
            + `for ${name} and wrote (${String(node.rotation.x)}, ${String(node.rotation.y)}, `
            + `${String(node.rotation.z)}). All three components are checked, at four `
            + 'poses with no two equal, because a single pose reading only the pitch is '
            + 'satisfied by `headPitch * 0.5` at zero and by transposing two arguments '
            + 'anywhere they coincide.',
          )
        }
      }
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
  // The check above is self-consistent, not a pin: it compares the loop's count against
  // the product of the same axes the loop reads, so widening an axis moves both sides
  // together and it stays green. A reviewer took the direction-degenerate head-roll axis
  // from 2 steps to 3 and the published total went 6,174,630 -> 8,232,840 with the whole
  // file at 22/0. **A count that is quoted elsewhere has to be pinned to a literal**, or
  // the only thing verified is that the loop can multiply.
  assert.equal(
    states,
    6_174_630,
    `the gaze sweep now visits ${String(states)} states, not the 6,174,630 published in `
    + 'this docblock, `GameEngine.ts` and `docs/09`. That is not necessarily wrong — an '
    + 'axis may have been widened deliberately — but three files quote the old figure.',
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
  // One plan, and **this comment cited the wrong assertion as its licence for three
  // commits.** The plan-independence sets below the probes evaluate the *exact solve's*
  // breath and body residue; they never touch the raw, scalar or no-pitch rules. A
  // reviewer injected `p.lean` into the rejected `measure` alone and the file stayed
  // 22/0, because sampled `elf/soldier` has `lean` 0 while other plans reach 0.20.
  //
  // The shortcut is nevertheless sound — the same reviewer swept all 27 plans over the
  // full 6,174,630 rejected states and got exactly one double per rule. **But "the
  // claim is true" and "this assertion proves it" are different statements**, and
  // citing a nearby assertion that happens to be about something else is how a
  // justification survives without ever being tested. So the rejected rules now carry
  // their own plan sweep, below, at the state each of them maximises at.
  const rejected = { raw: 0, scalar: 0, nopitch: 0 }
  const worstState = {
    raw: [0, 0, 0, 0, 0, 0] as number[],
    scalar: [0, 0, 0, 0, 0, 0] as number[],
    nopitch: [0, 0, 0, 0, 0, 0] as number[],
  }
  let scalarWorseThanNothing = 0
  let rejectedStates = 0
  // Built once, used by both the one-plan sweep and the plan-independence check below.
  // They previously had **two implementations of the same measurement**, which is how a
  // reviewer's mutation of one slipped past the other — and re-implementing the thing
  // you are checking is the defect this file caught in the anisotropy test and again in
  // the chest-yaw coefficients. A shared closure cannot drift from itself.
  const rig = (plan: CharacterProportions): {
    skeleton: ReturnType<typeof buildCharacterSkeleton>, head: THREE.Object3D,
  } => {
    const skeleton = buildCharacterSkeleton(plan)
    const head = new THREE.Object3D()
    head.position.y = skeleton.headY
    skeleton.headPivot.add(head)
    setCharacterShoulderWidth(skeleton.torsoPivot, skeleton.neckPivot, 1.07)
    skeleton.torsoPivot.scale.y = 1 + BREATH_AMPLITUDE
    return { skeleton, head }
  }
  // The chest rotation is set *inside* here rather than by the caller. It was a
  // parameter that the body ignored, relying on the loop having set the pivot first
  // — which `tsc` caught as three unread arguments. A measurement helper that
  // silently depends on state its own signature claims to take is how a sweep ends
  // up measuring the previous iteration.
  const measureOn = (
    r: { skeleton: ReturnType<typeof buildCharacterSkeleton>, head: THREE.Object3D },
    x: number, y: number, z: number, headPitch: number, headRoll: number,
    target: number, yaw: number,
  ): number => {
    r.skeleton.torsoPivot.rotation.set(x, y, z)
    r.skeleton.headPivot.rotation.set(headPitch, yaw, headRoll)
    r.skeleton.root.updateMatrixWorld(true)
    forward.set(0, 0, 1).transformDirection(r.head.matrixWorld)
    return Math.abs(Math.atan2(forward.x, forward.z) - target)
  }
  {
    const p = resolveCharacterPlan('elf', 'soldier', 0, false).proportions
    const one = rig(p)
    const skeleton = one.skeleton
    const measure = (
      x: number, y: number, z: number, headPitch: number, headRoll: number,
      target: number, yaw: number,
    ): number => measureOn(one, x, y, z, headPitch, headRoll, target, yaw)
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
                  if (raw > rejected.raw) {
                    rejected.raw = raw
                    worstState.raw = [bodyZ, x, y, z, headPitch, headRoll]
                  }
                  if (scalar > rejected.scalar) {
                    rejected.scalar = scalar
                    worstState.scalar = [bodyZ, x, y, z, headPitch, headRoll]
                  }
                  if (nopitch > rejected.nopitch) {
                    rejected.nopitch = nopitch
                    worstState.nopitch = [bodyZ, x, y, z, headPitch, headRoll]
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  const asDegrees = (radians: number): number => radians * (180 / Math.PI)
  // The licence for measuring the three rejected rules on one plan, owned here rather
  // than borrowed from an assertion about a different quantity. Each rule is re-evaluated
  // across all 27 plans **at the state it maximises at** — the state where a plan
  // dependence would matter most — and must take exactly one distinct double.
  //
  // Raw doubles, not rounded: the residues of a *direction* calculation are either
  // bit-identical or they are not, and a tolerance here would be the thing that lets a
  // real dependence through. `p.lean` reaching the chest is the specific defect this
  // catches, and it is not hypothetical — `elf/soldier` has `lean` 0 while other plans
  // reach 0.20, which is exactly why sampling that plan hid it.
  for (const [rule, yawOf] of [
    ['raw', (_x: number, _y: number, _z: number, _hp: number, t: number): number => t],
    ['scalar', (_x: number, y: number, _z: number, _hp: number, t: number): number => t - y],
    ['nopitch', (x: number, y: number, z: number, _hp: number, t: number): number =>
      solveHeadYaw(x, y, z, 0, t)],
  ] as const) {
    const [bodyZ, cx, cy, cz, headPitch, headRoll] = worstState[rule]
    const residues = new Set<number>()
    for (const faction of FACTIONS) {
      for (const role of ROLES) {
        const r = rig(resolveCharacterPlan(faction, role, 0, false).proportions)
        r.skeleton.bodyPivot.scale.set(1.05, 1.055, 1.05 * bodyZ)
        // Through the *same* `measureOn` the sweep above uses, so the two cannot
        // disagree. `measureOn` returns |heading − target|; feeding target 0 makes that
        // the heading itself, which is the quantity plan-independence is about.
        residues.add(
          measureOn(r, cx, cy, cz, headPitch, headRoll, 0, yawOf(cx, cy, cz, headPitch, 0.65)),
        )
      }
    }
    assert.equal(
      residues.size,
      1,
      `the ${rule} rule's heading takes ${String(residues.size)} distinct values across `
      + `the ${String(FACTIONS.length * ROLES.length)} plans at the state it maximises `
      + 'at, so the figure quoted for it is a sample of a population that varies rather '
      + 'than the population itself. Sweep the plans in the rejected block, or find what '
      + 'made a direction depend on a proportion — `lean` is measured in radians and '
      + 'reaches `torsoPivot.rotation.x`, so it is the first place to look.',
    )
  }
  const worseShare = (scalarWorseThanNothing / rejectedStates) * 100
  assert.ok(
    Math.abs(worseShare - 3.904) < 0.0005,
    `the scalar rule is now worse than no correction in ${worseShare.toFixed(4)}% of states, `
    + 'not the 3.904% quoted beside it. This figure was carried as "4.2%" through four '
    + 'files and four commits without ever being computed by anything — it needs both '
    + 'rejected rules evaluated over one grid, which nothing did until now.',
  )
  // Pinned to **half** the last published digit, not a whole one. The original `< 0.01`
  // against a two-decimal figure was the wrong bound by exactly a factor of two: 43.6448
  // could drift to 43.6494 — which *displays* as 43.65, a different number in every
  // docblock quoting it — and stay green. A reviewer produced that drift for all three
  // rows and the share.
  //
  // The rule the tolerance has to encode is not "close enough" but **"still rounds to
  // what we published"**, so it is half a unit in the last place shown. A guard on a
  // published figure is really a guard on the *rendering* of that figure, and the two
  // differ by a factor of two — which is invisible unless you ask what the assertion is
  // protecting, rather than what it is measuring.
  for (const [rule, expected, worthIt] of [
    ['raw `lookYaw`, authored in body space and used in chest space', 43.64, rejected.raw],
    ['a scalar `lookYaw - chestYaw`', 20.30, rejected.scalar],
    ['the solve without the head\'s own pitch', 9.71, rejected.nopitch],
  ] as const) {
    assert.ok(
      Math.abs(asDegrees(worthIt) - expected) < 0.005,
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

const HEAVY_ROLES: readonly string[] = ['brute', 'champion']

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
      // Production's own function, not a test-side copy of its arithmetic. This line
      // read `-stride * gait.chestYawCoefficient` for six passes, and a reviewer noticed
      // what that cost: **this simulation is the only place in the file that exercises
      // the chest-yaw arithmetic across its whole range** — 3,600 frames per role, the
      // stride swinging through ±0.62 — and it was exercising a copy.
      //
      // The equality assertion elsewhere pins `chestGaitYaw(1, heavy)`. One input. A
      // mutant returning `-Math.sign(stride) * 0.12` satisfies it exactly while turning
      // the chest's gait yaw into a square wave, and a dead zone `if (|stride| < 0.1)
      // return 0` — which is what anyone adds to kill jitter — satisfies it while
      // deleting the gait yaw over the low-stride range the reachability model rests on.
      // Both passed 22/0. Pointed here, the first fails at 21/1 through an assertion
      // that already existed.
      //
      // **A function whose value is its shape cannot be pinned at a point**, and the
      // cheapest shape test available is usually a numerical test that already runs.
      const chestYaw = chestGaitYaw(stride, HEAVY_ROLES.includes(gait.role))
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
      Math.abs(converted - REJECTED_WOBBLE[gait.role]) < 0.0005,
      `a ${gait.role}'s rejected rule now produces ${converted.toFixed(4)} degrees of `
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
 * Every pose the engine can put a beast in, built once and shared by the tests below.
 *
 * The invariants these feed hold for *any* transform, so this is **breadth, not a
 * bound** — but the magnitude table in `what a foot-rooted skull was worth on each of
 * the four animals` is measured over it, so it is built in one place rather than
 * restated and allowed to drift between the two.
 *
 * The box is not the product of the terms, and that matters: `pose.attack` and
 * `pose.anticipation` are read out of the same `actor.action` and exclude each other,
 * `pose.flinch` and `pose.stagger` are one `reaction` field, and the stagger branch
 * sets `actor.action = null` — so a staggering animal has no attack to add. The
 * previously recorded beast figures were taken at attack *plus* stagger, which is the
 * same unreachable pose the humanoid table had to have corrected out of it.
 *
 * The last family is the corner nothing was watching. `updateActorDeathMotion`
 * overwrites `head-pivot.rotation.z` with `side * 0.28 * eased` and leaves the chest
 * holding whatever the last live frame wrote, which is a genuinely different part of the
 * space from anything the living animation reaches.
 */
interface BeastPose {
  name: string
  chest: readonly [number, number, number]
  head: readonly [number, number, number]
  /** `torso-pivot.scale.y`, which the breathing pass writes every frame. */
  breathScale: number
  /** `torso-pivot.scale.x`, the actor's shoulder width from the art stream. */
  shoulders: number
  death: boolean
}

/** `updateActors`: `sin(gaitPhase) * 0.62 * motionBlend`, `motionBlend` capped at 1.18. */
const BEAST_STRIDE_MAX = 0.62 * 1.18
/** `actor.turnLean`, clamped to +/-0.5 before it is damped. */
const BEAST_TURN_MAX = 0.5
/** `animateActorCharacter`: `breathing = sin(...) * 0.018`. */
const BEAST_BREATH_AMPLITUDE = 0.018
/** `animateBeastPosture`: `torsoPivot.scale.y = 1 + breathing * 0.3`. */
const BEAST_BREATH_GAIN = 0.3
/** `applyActorVisualVariation`: `shoulders = variation.around(1, 0.07)`. */
const BEAST_SHOULDER_SPREAD = 0.07
/** `updateActorDeathMotion`: `head.rotation.z = side * 0.28 * eased`. */
const BEAST_DEATH_LOLL = 0.28

/** The seven jointly reachable action states, and what each of them writes. */
const BEAST_ACTIONS = [
  { name: 'idle', anticipation: 0, attack: 0, stagger: 0, flinch: 0 },
  { name: 'windup', anticipation: 1, attack: 0, stagger: 0, flinch: 0 },
  { name: 'attack', anticipation: 0, attack: 1, stagger: 0, flinch: 0 },
  { name: 'flinch', anticipation: 0, attack: 0, stagger: 0, flinch: 1 },
  { name: 'windup+flinch', anticipation: 1, attack: 0, stagger: 0, flinch: 1 },
  { name: 'attack+flinch', anticipation: 0, attack: 1, stagger: 0, flinch: 1 },
  { name: 'stagger', anticipation: 0, attack: 0, stagger: 1, flinch: 0 },
] as const

function beastPoses(upright: boolean): BeastPose[] {
  const shoulderSet = [1 + BEAST_SHOULDER_SPREAD, 1 - BEAST_SHOULDER_SPREAD]
  const out: BeastPose[] = [
    {
      name: 'rest',
      chest: [0, 0, 0],
      head: [0, 0, 0],
      breathScale: 1,
      shoulders: 1,
      death: false,
    },
  ]
  const chestOf = (
    action: (typeof BEAST_ACTIONS)[number],
    stride: number,
    turn: number,
  ): readonly [number, number, number] => [
    -action.anticipation * (upright ? 0.16 : 0.1) +
      action.attack * (upright ? 0.2 : 0.14) +
      action.stagger * 0.14,
    -stride * 0.03,
    -turn * 0.06,
  ]
  for (const action of BEAST_ACTIONS) {
    for (const stride of [-BEAST_STRIDE_MAX, 0, BEAST_STRIDE_MAX]) {
      for (const turn of [-BEAST_TURN_MAX, 0, BEAST_TURN_MAX]) {
        for (const breath of [-BEAST_BREATH_AMPLITUDE, 0, BEAST_BREATH_AMPLITUDE]) {
          for (const look of [-BEAST_LOOK_CLAMP, 0, BEAST_LOOK_CLAMP]) {
            for (const shoulders of shoulderSet) {
              out.push({
                name: `${action.name} stride ${stride.toFixed(2)} turn ${turn.toFixed(2)} `
                  + `breath ${breath.toFixed(3)} look ${look.toFixed(2)} `
                  + `shoulders ${shoulders.toFixed(2)}`,
                chest: chestOf(action, stride, turn),
                head: [action.attack * 0.16 - action.flinch * 0.2, look, turn * 0.04],
                breathScale: 1 + breath * BEAST_BREATH_GAIN,
                shoulders,
                death: false,
              })
            }
          }
        }
      }
    }
  }
  // Death. The chest is frozen wherever the last live frame left it and only the skull's
  // roll is driven, which is why this corner has to be written out rather than falling
  // out of the living sweep.
  for (const action of BEAST_ACTIONS) {
    for (const side of [1, -1]) {
      for (const eased of [0.5, 1]) {
        for (const shoulders of shoulderSet) {
          out.push({
            name: `${action.name}, dead, side ${String(side)} eased ${eased.toFixed(2)} `
              + `shoulders ${shoulders.toFixed(2)}`,
            chest: chestOf(action, BEAST_STRIDE_MAX, BEAST_TURN_MAX),
            head: [
              action.attack * 0.16 - action.flinch * 0.2,
              BEAST_LOOK_CLAMP,
              side * BEAST_DEATH_LOLL * eased,
            ],
            breathScale: 1 + BEAST_BREATH_AMPLITUDE * BEAST_BREATH_GAIN,
            shoulders,
            death: true,
          })
        }
      }
    }
  }
  return out
}

/** How many poses `beastPoses` produces. Restated so a silent collapse fails loudly. */
const BEAST_POSE_COUNT =
  1 + BEAST_ACTIONS.length * 3 * 3 * 3 * 3 * 2 + BEAST_ACTIONS.length * 2 * 2 * 2

/**
 * The angle between two orientations, in degrees, without `acos` near the identity.
 *
 * `2 * acos(|q1 · q2|)` is the obvious formula and it is useless for the assertion that
 * needs it most: `acos` has infinite derivative at 1, so a residual of 1e-16 in the dot
 * product comes out as 1e-8 rad of "angle" and an exactness check at 1e-9 can never
 * pass. The half-angle taken as `atan2(|vector part|, |scalar part|)` of the *relative*
 * quaternion is linear in the residual near zero and still correct at half a turn.
 */
function orientationDegrees(a: THREE.Quaternion, b: THREE.Quaternion): number {
  const relative = a.clone().invert().multiply(b)
  return (
    2 *
    Math.atan2(Math.hypot(relative.x, relative.y, relative.z), Math.abs(relative.w)) *
    (180 / Math.PI)
  )
}

/**
 * Each animal's neck, as a committed literal — the expected side the hinge bound is not.
 *
 * The hinge check below bounds the skull's arc by `hypot(headY - frontJointY, headZ -
 * frontZ)`, read out of `BEAST_RIG`. That is the right expectation for a defect in
 * `buildBeastSkeleton`, which is a different piece of code from the table it reads. It is
 * **blind to a defect in the table itself**: move a shoulder and the measured arc and the
 * bound move together, and the check agrees with itself in a world where the neck has
 * drifted back down to the animal's feet. Demonstrated rather than argued — dropping the
 * wolf's `frontJointY` to 0 leaves the hinge bound green.
 *
 * That is the shape this repository keeps finding: **comparing two things you control.**
 * It is not a hard-coded number that makes a pin sound, nor a computed one that makes it
 * rotten; it is whether the expected side comes from somewhere the defect cannot reach.
 * So these four are literals, committed here, and the sweep reads production. A shoulder
 * that moves is named by this rather than absorbed by the bound that reads it.
 *
 * The second guard on the same hole is the ratio assertion beside the hinge — the neck's
 * arm must be under half the foot-rooted one — which is a geometric claim with a
 * committed constant rather than a quantity the rig can move. It is what caught the
 * dropped shoulder.
 */
const BEAST_NECK: Record<BeastKind, number> = {
  wolf: 0.566,
  boar: 0.6612,
  bear: 0.6462,
  troll: 0.365,
}

/**
 * What the foot-rooted arrangement was worth, in authored units, per animal.
 *
 * Produced by the run that checks them. They are pinned as equalities against recorded
 * constants, never as bounds derived from the quantity the defect moves, and every
 * failure message names the new value so the prose gets corrected by being told.
 *
 * Three quantities, because the defect had two halves and they peak in different poses:
 *
 * - `slip` — the skull against **where its own chest would carry it**, with the head's
 *   own rotation held at zero on both sides so they are like for like. This is the "it
 *   does not follow the ribs" half, and it is worst while the animal is alive.
 * - `walking` / `dying` — how far the fix **moves the skull** at an identical authored
 *   pose, which also catches the second half: a head rotation about a pivot at the feet
 *   swings the skull through the whole ground-to-skull arm instead of the neck's. Worst
 *   on death, on all four animals, because that is the one pose that drives the roll.
 * - `twist` — the skull's axes against a chest-rigid skull's. It equals the chest's
 *   entire rotation, because the foot-rooted skull inherited none of it.
 */
const FOOT_ROOTED_SKULL: Record<
  BeastKind,
  { slip: number; walking: number; dying: number; twist: number }
> =
  {
    wolf: { slip: 0.2414, walking: 0.4697, dying: 0.6255, twist: 8.3171 },
    boar: { slip: 0.2116, walking: 0.3927, dying: 0.5353, twist: 8.3171 },
    bear: { slip: 0.2751, walking: 0.5102, dying: 0.7165, twist: 8.3171 },
    troll: { slip: 0.4732, walking: 0.6055, dying: 1.0040, twist: 11.6733 },
  }

/**
 * A beast's skull is part of its body, and this is what proves it.
 *
 * `createBeast` used to build `head-pivot` as a **sibling of `torso-pivot` at the
 * animal's own origin** — the ground between its feet — with the skull placed `headY`
 * up and `headZ` forward of it. That is a second root, not a neck. It is the same defect
 * that was found and fixed on people, and it was deliberately deferred here on the
 * argument that a quadruped's neck is not at `shoulderY` and guessing at one turns one
 * regression into two. The guess turned out to be unnecessary: `BEAST_RIG` already
 * records where each animal's front limbs hang from, and that is where its neck starts.
 *
 * ## The population, and why it is four rather than ninety
 *
 * The humanoid sweep enumerates 3 factions × 10 roles × 3 variants. **Beasts have no
 * discrete variant at all**: `spawnActor` resolves one and hands it only to
 * `createCharacter`. Their per-actor differences come from `applyActorVisualVariation`,
 * which writes continuous scales out of an art stream and cannot be enumerated — so the
 * population is `BEAST_KINDS`, four, and the sweep drives the extremes of every term the
 * animation can write instead of enumerating individuals. That is stated rather than
 * assumed: the first assertion checks `BEAST_KINDS` against `BEAST_ROLES`, a separately
 * authored list in `types.ts`, because two lists that must agree and are never compared
 * are how a fifth animal joins the game with no sweep noticing.
 *
 * ## What the defect was worth, and why the recorded figures are not quoted
 *
 * `docs/09` §4 and the docblock that used to stand here recorded **0.296 on a wolf,
 * 0.368 on a bear and 0.660 on a troll**, "under attack plus stagger". Both halves of
 * that are wrong, and the companion test computes replacements rather than correcting
 * them by hand:
 *
 * - Driven at the pose they name, the sibling rig gives **0.4589, 0.5231 and 0.7911** —
 *   between 42% and 55% more than recorded. Nothing could have noticed: no assertion
 *   ever evaluated them.
 * - The pose they name is **not reachable.** The stagger branch sets
 *   `actor.action = null`, and `sampleActorPose` reads the attack out of `actor.action`.
 *   That is the *same* correction the humanoid table needed, made in this same file,
 *   with the beast line left holding the uncorrected version.
 *
 * ## And the corner nothing was watching: death
 *
 * `updateActorDeathMotion` writes `head-pivot.rotation.z = side * 0.28 * eased` — a
 * skull lolling as the body goes down — and on a pivot at the feet that swings it
 * through the entire ground-to-skull lever arm. On a troll: **1.0040 authored units,
 * 1.3453 m in the world, on every single death**, covered by no assertion at all. The
 * humanoid rig had the identical hole. A pose that only happens after the health bar
 * disappears is still a pose.
 *
 * ## What this test is
 *
 * Two invariants of the hierarchy, plus the two joints they rest on. The other two —
 * orientation and proportion — are the test immediately after, in their own `test()`
 * rather than appended here, because `assert` throws and an invariant asserted after one
 * that has already failed is an invariant nobody will ever watch fail.
 *
 * 1. **Placed.** The rest pose is bit-identical to the old one. The whole reason this
 *    defect survived on people for the life of the code is that it is invisible until
 *    something rotates, so "the fix moved the art" has to be excluded by measurement
 *    rather than by argument.
 * 2. **Rigid in position.** The skull's world position is whatever `torso-pivot` says it
 *    is, to 1e-12, for every transform the engine can write — including the two the
 *    chest carries as *scale*, which is why `setCharacterShoulderWidth` is driven here
 *    rather than a copy of its arithmetic.
 * 3. **Hinged at the neck.** Turning the head moves it on an arc about the shoulder, not
 *    about the feet. The radius comes from `BEAST_RIG`, never from the skeleton's own
 *    `headY`/`headZ`, which the mutation below also moves — a bound that grows with the
 *    quantity it bounds cannot fail, and that exact mistake was caught on the humanoid
 *    branch by the mutation run rather than by review.
 *
 * They fail independently, and the mutation table records which fires for each: a neck
 * dropped to the animal's origin with the head offsets left ground-relative keeps 1 and
 * 2 and breaks 3; a neck moved 0.2 forward with the head offsets unchanged breaks 1
 * alone; a `head-pivot` parented to `body-pivot` *at* the shoulder keeps 1 and 3 and is
 * caught by the joint equalities at the end.
 *
 * **Know what assertion 2 does and does not prove**, because the humanoid version of it
 * has the same property and it is worth stating twice rather than nowhere. Its expected
 * value is `restLocal · torsoPivot.matrixWorld` with `restLocal` captured from the same
 * tree, so on *any* tree where the skull descends from `torso-pivot` it is zero by
 * construction. It is a hierarchy check, and it cannot fail while the joint equalities
 * at the end of the loop hold. What it adds is coverage of the transforms those
 * equalities say nothing about — the chest's two *scales* — and a number rather than a
 * yes/no when it does go wrong.
 */
test("a beast's skull is rigid with its ribs and hinges at the neck", () => {
  // The population. Two independently authored lists that have to agree.
  assert.deepEqual(
    [...BEAST_KINDS].sort(),
    [...BEAST_ROLES].sort(),
    'the art module and the gameplay types disagree about which animals exist. Every '
    + 'sweep here enumerates `BEAST_KINDS`; a role only `types.ts` knows about is a beast '
    + 'nothing below covers.',
  )
  assert.equal(BEAST_KINDS.length, 4, 'the beast population is four kinds and no variants')

  const restLocal = new THREE.Vector3()
  const actual = new THREE.Vector3()
  const expected = new THREE.Vector3()

  let worstRigid = 0
  let worstRigidAt = ''
  let checked = 0

  for (const kind of BEAST_KINDS) {
    const rig = BEAST_RIG[kind]
    const poses = beastPoses(kind === 'troll')
    assert.equal(
      poses.length,
      BEAST_POSE_COUNT,
      `${kind}: the pose box collapsed. Every measurement below is taken over it, so a `
      + 'sweep that has stopped producing poses is a suite that has stopped asserting.',
    )
    const skeleton = buildBeastSkeleton(rig)
    // The head mesh, placed exactly as `createBeast` places it — out of the skeleton's
    // own neck-relative offsets, which is the coupling the fix rests on.
    const head = new THREE.Object3D()
    head.position.set(0, skeleton.headY, skeleton.headZ)
    skeleton.headPivot.add(head)

    // 1. Placed. Nothing posed, and the skull stands exactly where `BEAST_RIG` puts it
    //    — which is where the sibling arrangement put it too.
    skeleton.root.updateMatrixWorld(true)
    restLocal.setFromMatrixPosition(head.matrixWorld)
    assert.ok(
      Math.abs(restLocal.x) < 1e-12 &&
        Math.abs(restLocal.y - rig.headY) < 1e-12 &&
        Math.abs(restLocal.z - rig.headZ) < 1e-12,
      `${kind}: at rest the skull must stand at (0, ${rig.headY.toFixed(3)}, `
      + `${rig.headZ.toFixed(3)}), not (${restLocal.x.toFixed(4)}, `
      + `${restLocal.y.toFixed(4)}, ${restLocal.z.toFixed(4)}). Hanging the head off the `
      + 'ribs must be invisible on an animal nothing has posed — that property is the '
      + 'entire reason this defect survived on people for the life of the code.',
    )

    for (const pose of poses) {
      checked += 1
      // Full pose, scales included. `setCharacterShoulderWidth` is production's own
      // function: mutate it and this measurement moves, which is precisely what a copy
      // of its arithmetic written out here would prevent.
      applyChestPose(skeleton.torsoPivot, pose.chest[0], pose.chest[1], pose.chest[2])
      skeleton.torsoPivot.scale.y = pose.breathScale
      setCharacterShoulderWidth(skeleton.torsoPivot, skeleton.neckPivot, pose.shoulders)

      // 2. Rigid in position, with the head's own rotation held at zero so that both
      //    sides of the comparison are like for like — the correction the humanoid table
      //    needed when it first read 0.6835 instead of 0.6603.
      applyHeadPose(skeleton.headPivot, 0, 0, 0)
      skeleton.root.updateMatrixWorld(true)
      actual.setFromMatrixPosition(head.matrixWorld)
      expected.copy(restLocal).applyMatrix4(skeleton.torsoPivot.matrixWorld)
      const off = actual.distanceTo(expected)
      if (off > worstRigid) {
        worstRigid = off
        worstRigidAt = `${kind} in "${pose.name}"`
      }
    }

    applyChestPose(skeleton.torsoPivot, 0, 0, 0)
    skeleton.torsoPivot.scale.set(1, 1, 1)
    skeleton.neckPivot.scale.set(1, 1, 1)

    // 3. Hinged at the neck. The head's rotations turn a skull; they do not swing an
    //    animal. The radius is the two joints the rig table names, not the skeleton's own
    //    offsets, which the mutation moves along with the thing being bounded.
    const turn = 0.3
    applyHeadPose(skeleton.headPivot, turn, turn, turn)
    skeleton.root.updateMatrixWorld(true)
    actual.setFromMatrixPosition(head.matrixWorld)
    const swung = actual.distanceTo(restLocal)
    const neckToHead = Math.hypot(rig.headY - rig.frontJointY, rig.headZ - rig.frontZ)
    const footToHead = Math.hypot(rig.headY, rig.headZ)
    // The joint the bound below reads, pinned against a literal rather than against
    // itself. Without this the hinge check is a comparison between two quantities the
    // rig table controls, and a shoulder that slid to the floor would take the bound
    // with it — measured: dropping the wolf's `frontJointY` to 0 leaves the bound green
    // and is caught only by the ratio assertion further down. Half a unit in the last
    // digit shown, so a drift that changes the printed figure cannot stay quiet.
    assert.ok(
      Math.abs(neckToHead - BEAST_NECK[kind]) < 0.00005,
      `a ${kind}'s neck now measures ${neckToHead.toFixed(4)} from shoulder to skull, not `
      + `the ${BEAST_NECK[kind].toFixed(4)} recorded. \`BEAST_RIG\` has been re-authored: `
      + 'nothing is necessarily broken, but the hinge bound below reads this same number '
      + 'on both sides, so it will not tell you. Correct the literal to the value in this '
      + 'message and re-measure `FOOT_ROOTED_SKULL`.',
    )
    // Chord of the arc, generous by a factor of two on the three-axis case — the same
    // shape of bound the humanoid hinge check uses.
    const bound = 2 * neckToHead * Math.sin(turn * 1.5)
    assert.ok(
      swung <= bound,
      `${kind}: turning the head ${turn.toFixed(2)} rad moved it ${swung.toFixed(4)}, over `
      + `the ${bound.toFixed(4)} an arc about the shoulder allows. head-pivot is hinged `
      + 'somewhere below the neck; at the animal\'s own origin it swings the whole body, '
      + `which is ${(2 * footToHead * Math.sin(turn * 1.5)).toFixed(4)} on this one.`,
    )
    assert.ok(swung > 0, `${kind}: the head must actually turn`)
    // And the hinge has to be a real improvement, not a renamed one. Both radii come out
    // of the same table, so this cannot be satisfied by rescaling the animal.
    assert.ok(
      neckToHead < footToHead * 0.5,
      `${kind}: the neck-to-skull arm is ${neckToHead.toFixed(4)} against a foot-to-skull `
      + `arm of ${footToHead.toFixed(4)}. The joint has drifted back down towards the `
      + 'animal\'s origin, which is the defect this rig was rebuilt to remove.',
    )
    applyHeadPose(skeleton.headPivot, 0, 0, 0)

    // The joints themselves, last, so a rig that has come apart reports how far by.
    assert.equal(skeleton.neckPivot.parent, skeleton.torsoPivot, `${kind}: neck off the ribs`)
    assert.equal(skeleton.headPivot.parent, skeleton.neckPivot, `${kind}: head off the neck`)
    assert.equal(skeleton.neckPivot.position.x, 0, `${kind}: the neck is off centre`)
    assert.equal(
      skeleton.neckPivot.position.y,
      rig.frontJointY,
      `${kind}: the neck must start at the front limb joint, which is a beast's shoulder`,
    )
    assert.equal(skeleton.neckPivot.position.z, rig.frontZ, `${kind}: neck off the shoulder`)
    assert.equal(
      skeleton.headY,
      rig.headY - rig.frontJointY,
      `${kind}: the head mesh's Y is not measured from the neck`,
    )
    assert.equal(
      skeleton.headZ,
      rig.headZ - rig.frontZ,
      `${kind}: the head mesh's Z is not measured from the neck`,
    )
  }

  assert.equal(
    checked,
    BEAST_KINDS.length * BEAST_POSE_COUNT,
    'the sweep did not run over every animal and every pose',
  )
  assert.ok(
    worstRigid < 1e-12,
    `the skull left the ribcage by ${worstRigid.toFixed(4)} at ${worstRigidAt}. It must `
    + 'descend from `torso-pivot`, so that whatever the chest does the head does too. Do '
    + 'not answer this with an offset: the displacement is a rotation times a lever arm '
    + 'and changes with every frame of the pose.',
  )
})

/**
 * A beast's skull turns with its chest, and keeps its own proportions doing it.
 *
 * The other two halves of the same hierarchy, in their own test rather than appended to
 * the one above — because `assert` throws, so a second invariant asserted after a first
 * one that has failed is a second invariant nobody will ever see fail. The humanoid work
 * split for the same reason and found, in the split, that one of its four assertions
 * could not fail at all.
 *
 * **Orientation.** The rule on this programme is: *do not test a rig without posing it;
 * do not test position without testing orientation.* A skull can inherit its chest's
 * translation and ignore its rotation — that is exactly what a head-stabilisation hack
 * looks like, and it is the most likely future edit here — and no position assertion
 * would ever see it. On the arrangement this rig replaces the skull's axes were out by
 * **11.6733°** on a troll and **8.3171°** on the other three, which is precisely the
 * chest's whole rotation, because the skull inherited none of it.
 *
 * **Proportion.** Hanging a head off a chest is exactly what hands it a pair of
 * shoulders: `applyActorVisualVariation` runs for beasts too, and it writes the actor's
 * shoulder width onto `torso-pivot.scale.x`. `setCharacterShoulderWidth` divides that
 * back out at `neck-pivot`, and it has to be `neck-pivot` and not `head-pivot` — a scale
 * and a rotation do not commute, so a cancellation below a rotation is valid only in the
 * rest pose. The bound is derived from the breath, which is the only thing that may
 * legitimately reach a skull, and the sweep drives `setCharacterShoulderWidth` itself so
 * that mutating production breaks the measurement rather than leaving a private copy of
 * the arithmetic quietly agreeing with itself.
 *
 * The two are measured in one loop but at different chest scales, and that is deliberate:
 * a non-uniform scale above a rotation **shears**, and a sheared matrix has no exact
 * rotation to compare a quaternion against. So the orientation check runs at unit chest
 * scale, where the comparison is exact to 1e-12, and the scale's entire contribution is
 * what the proportion check measures instead. Splitting them that way is what makes both
 * bounds tight rather than one of them generous enough to hide the other.
 *
 * **Where each expectation comes from**, because that and not its syntax is what makes a
 * gate real. The orientation check's expected side is the chest's own world rotation
 * times the head's local Euler — read off the *same tree* as the value it checks, so it
 * is a hierarchy consequence and cannot fail while the joint equalities in the previous
 * test hold. What it adds is the degree of freedom those equalities do not describe and
 * a number when it goes wrong. The proportion bound is the opposite and stronger case:
 * its expected side is a **closed form** — `1/(1 - amplitude·gain) - 1` — over two
 * literals that `the engine poses a beast through the rig these tests measure` pins
 * against the engine's source. No part of the rig can reach it.
 */
test("a beast's skull turns with its chest and keeps its own proportions", () => {
  const actualQuat = new THREE.Quaternion()
  const expectedQuat = new THREE.Quaternion()
  const localQuat = new THREE.Quaternion()
  const localEuler = new THREE.Euler()
  const axis = new THREE.Vector3()

  let worstTwist = 0
  let worstTwistAt = ''
  let worstAnisotropy = 0
  let worstAnisotropyAt = ''
  let checked = 0

  for (const kind of BEAST_KINDS) {
    const skeleton = buildBeastSkeleton(BEAST_RIG[kind])
    const head = new THREE.Object3D()
    head.position.set(0, skeleton.headY, skeleton.headZ)
    skeleton.headPivot.add(head)

    for (const pose of beastPoses(kind === 'troll')) {
      checked += 1
      applyChestPose(skeleton.torsoPivot, pose.chest[0], pose.chest[1], pose.chest[2])
      applyHeadPose(skeleton.headPivot, pose.head[0], pose.head[1], pose.head[2])

      // Proportion, with every scale the chest carries.
      skeleton.torsoPivot.scale.y = pose.breathScale
      setCharacterShoulderWidth(skeleton.torsoPivot, skeleton.neckPivot, pose.shoulders)
      skeleton.root.updateMatrixWorld(true)
      let longest = 0
      let shortest = Number.POSITIVE_INFINITY
      for (let column = 0; column < 3; column += 1) {
        const length = axis.fromArray(head.matrixWorld.elements, column * 4).length()
        longest = Math.max(longest, length)
        shortest = Math.min(shortest, length)
      }
      const anisotropy = longest / shortest - 1
      if (anisotropy > worstAnisotropy) {
        worstAnisotropy = anisotropy
        worstAnisotropyAt = `${kind} in "${pose.name}"`
      }

      // Orientation, at unit chest scale so there is an exact rotation to compare with.
      skeleton.torsoPivot.scale.set(1, 1, 1)
      skeleton.neckPivot.scale.set(1, 1, 1)
      skeleton.root.updateMatrixWorld(true)
      head.getWorldQuaternion(actualQuat)
      skeleton.torsoPivot.getWorldQuaternion(expectedQuat)
      localEuler.set(pose.head[0], pose.head[1], pose.head[2], 'XYZ')
      expectedQuat.multiply(localQuat.setFromEuler(localEuler))
      const twist = orientationDegrees(actualQuat, expectedQuat)
      if (twist > worstTwist) {
        worstTwist = twist
        worstTwistAt = `${kind} in "${pose.name}"`
      }
    }
  }

  assert.equal(
    checked,
    BEAST_KINDS.length * BEAST_POSE_COUNT,
    'the sweep did not run over every animal and every pose',
  )
  assert.ok(
    worstTwist < 1e-9,
    `the skull's own axes are ${worstTwist.toFixed(4)} degrees off the chest's at `
    + `${worstTwistAt}. A head that inherits the chest's position and not its rotation `
    + 'stares straight ahead out of a body that is turning — the half of this defect a '
    + 'position-only assertion cannot see.',
  )
  // Derived from the breath the engine writes and nothing else, exactly as the humanoid
  // anisotropy bound is. Exhaling is the worse direction: 1/(1-b) - 1 > b.
  const breathAnisotropy = 1 / (1 - BEAST_BREATH_AMPLITUDE * BEAST_BREATH_GAIN) - 1
  assert.ok(
    worstAnisotropy <= breathAnisotropy + 1e-9,
    `the skull is ${(worstAnisotropy * 100).toFixed(4)}% out of proportion at `
    + `${worstAnisotropyAt}, against the ${(breathAnisotropy * 100).toFixed(4)}% the `
    + 'chest\'s breath can account for. Hanging a head off a chest hands it the chest\'s '
    + 'shoulder width; `setCharacterShoulderWidth` divides that back out at `neck-pivot`, '
    + 'and it has to be `neck-pivot` — a scale cancelled below a rotation only cancels at '
    + 'rest.',
  )
  assert.ok(
    worstAnisotropy > 0,
    'the skull is perfectly isotropic in every pose, which means the chest\'s breath is '
    + 'not reaching it at all — the sweep is no longer driving the scales it claims to.',
  )
})

/**
 * A beast's head tracks its target through its own chest, not past it.
 *
 * The beast half of `the head tracks its target through the chest, not past it`, and it
 * exists because hanging the skull off the ribs **creates** this problem. `lookYaw` is
 * measured by `updateActors` from the animal's own facing, so it is a *body*-space
 * angle; `head-pivot` was a body-space node and is now a chest-space one. Written raw it
 * is simply wrong, by exactly the chest's own contribution.
 *
 * Three rules, all evaluated here rather than two of them being described:
 *
 * - **none** — write `lookYaw` straight onto the pivot.
 * - **scalar** — `lookYaw - chestYaw`, the obvious correction, which cancels only while
 *   the chest's other two axes are zero. A beast's chest pitches into its lunge and
 *   rolls with its turn, so they are not.
 * - **solve** — `solveHeadYaw`, which is exact.
 *
 * The figures are small: a beast's chest barely moves next to a person's, and the same
 * mistake on a humanoid is worth 43.64°. Saying so is the point. The numbers are pinned
 * anyway, because **the reason to correct it is that the reparenting introduced it**,
 * not that it is large — and because a figure quoted in prose on this project has decayed
 * every single time it was not computed by the run that quotes it.
 *
 * The sweep is `beastPoses`, the same box every other beast measurement uses, so the
 * chest envelope here cannot drift away from the one the rig is asserted over.
 *
 * `solveHeadYaw`'s own exactness is checked against a **different code path**, not
 * against itself: the solve produces a yaw, and the check composes the two Euler
 * rotations into a matrix and reads the world heading back out. Agreement between a
 * closed-form solve and a forward evaluation is evidence; agreement between the solve
 * and a second call to the solve would not be.
 *
 * The share of states where the scalar rule loses is pinned as a **count**, not a
 * percentage, and that distinction was earned rather than chosen. Adding a fifth animal
 * to `BEAST_KINDS` takes the count from 432 to 540 and leaves the percentage at 9.0680%
 * — because a new quadruped shares the existing chest envelope exactly. A decimal share
 * with a tolerance would have been a figure that recomputes itself, survives a change to
 * the population it describes, and looks in a diff exactly like a pin that works.
 */
test("a beast's head tracks its target through its own chest", () => {
  // Produced by this run. Equalities against recorded constants, not bounds derived from
  // anything the defect moves; each failure message names the new value.
  const RECORDED = {
    none: 2.5583,
    scalar: 1.2799,
    trollNone: 3.0334,
    trollScalar: 1.7368,
    /**
     * States where the scalar rule is worse than doing nothing, as a **count**, not a
     * percentage.
     *
     * A share is a ratio of two integers and pinning it as a decimal invites a tolerance
     * loose enough to admit a different displayed number. The count is exact, and the
     * denominator is pinned separately, so a change to either is named rather than
     * cancelling in the quotient.
     */
    scalarWorse: 432,
  }
  const forward = new THREE.Vector3()
  const chestMatrix = new THREE.Matrix4()
  const headMatrix = new THREE.Matrix4()
  const euler = new THREE.Euler()

  const heading = (
    chest: readonly [number, number, number],
    pitch: number,
    yaw: number,
    roll: number,
  ): number => {
    chestMatrix.makeRotationFromEuler(euler.set(chest[0], chest[1], chest[2], 'XYZ'))
    headMatrix.makeRotationFromEuler(euler.set(pitch, yaw, roll, 'XYZ'))
    forward.set(0, 0, 1).applyMatrix4(chestMatrix.multiply(headMatrix))
    return Math.atan2(forward.x, forward.z)
  }
  const missBy = (
    chest: readonly [number, number, number],
    pitch: number,
    yaw: number,
    roll: number,
    look: number,
  ): number => {
    const got = heading(chest, pitch, yaw, roll)
    return Math.abs(Math.atan2(Math.sin(got - look), Math.cos(got - look))) * (180 / Math.PI)
  }

  let worstNone = 0
  let worstScalar = 0
  let worstSolve = 0
  let trollNone = 0
  let trollScalar = 0
  let scalarWorse = 0
  let states = 0
  let worstSolveAt = ''

  for (const kind of BEAST_KINDS) {
    for (const pose of beastPoses(kind === 'troll')) {
      const [pitch, look, roll] = pose.head
      states += 1
      const none = missBy(pose.chest, pitch, look, roll, look)
      const scalar = missBy(pose.chest, pitch, look - pose.chest[1], roll, look)
      const solved = solveHeadYaw(pose.chest[0], pose.chest[1], pose.chest[2], pitch, look)
      const solve = missBy(pose.chest, pitch, solved, roll, look)
      if (solve > worstSolve) {
        worstSolve = solve
        worstSolveAt = `${kind} in "${pose.name}"`
      }
      if (kind === 'troll') {
        trollNone = Math.max(trollNone, none)
        trollScalar = Math.max(trollScalar, scalar)
        } else {
          // The three quadrupeds share a chest envelope exactly — the only term that
          // differs by animal is the `upright` pitch gain, which only the troll takes.
          worstNone = Math.max(worstNone, none)
          worstScalar = Math.max(worstScalar, scalar)
        }
        if (scalar > none + 1e-12) scalarWorse += 1
    }
  }

  assert.equal(states, BEAST_KINDS.length * BEAST_POSE_COUNT, 'the gaze sweep did not run')
  assert.ok(
    worstSolve < 1e-9,
    `\`solveHeadYaw\` left a beast's gaze ${worstSolve.toFixed(6)} degrees off at `
    + `${worstSolveAt}. It is meant to be exact wherever the chest's forward axis still `
    + 'points forward, and a beast\'s chest never comes close to turning that far.',
  )
  for (const [what, got, was] of [
    ['no correction at all', worstNone, RECORDED.none],
    ['the scalar subtraction', worstScalar, RECORDED.scalar],
    ['no correction, on a troll', trollNone, RECORDED.trollNone],
    ['the scalar subtraction, on a troll', trollScalar, RECORDED.trollScalar],
  ] as const) {
    assert.ok(
      Math.abs(got - was) < 0.00005,
      `${what} now costs a beast ${got.toFixed(4)} degrees of gaze, not the `
      + `${was.toFixed(4)} recorded beside it. Nothing is necessarily broken — the chest `
      + 'envelope or the pose box has moved — but the figures in `buildBeastSkeleton`\'s '
      + 'docblock, in `animateBeastPosture`\'s, and in docs/09 §4 are now wrong. Correct '
      + 'them to the value in this message.',
    )
  }
  const share = (100 * scalarWorse) / states
  assert.equal(
    scalarWorse,
    RECORDED.scalarWorse,
    `the scalar rule is now worse than doing nothing in ${String(scalarWorse)} of the `
    + `${String(states)} swept states — ${share.toFixed(4)}%, not the `
    + `${((100 * RECORDED.scalarWorse) / states).toFixed(4)}% recorded. Same correction as `
    + 'above: this figure appears in `buildBeastSkeleton`\'s docblock, in '
    + '`animateBeastPosture`\'s and in docs/09 §4.',
  )
  // And the rejected rules have to be rejectable: if the chest stopped moving at all,
  // every rule above would be exact and this test would pass while measuring nothing.
  // The floor is a tenth of a degree — an absolute angle, not a fraction of any figure
  // this test produces.
  assert.ok(
    worstNone > 0.1,
    `writing \`lookYaw\` raw onto a beast's head now costs only ${worstNone.toFixed(4)} `
    + 'degrees. The chest envelope has collapsed, so this test is no longer '
    + 'distinguishing the three rules from each other.',
  )
  assert.ok(
    worstScalar < worstNone,
    `the scalar rule (${worstScalar.toFixed(4)}) is no longer better in the worst case `
    + `than no correction (${worstNone.toFixed(4)}). That would make the ordering this `
    + 'test records meaningless; re-derive it before touching the numbers.',
  )
})

/**
 *
 * Separate from the invariants above on purpose. Those are the regression gate and are
 * exact; this is a *record*, and a record nothing evaluates is what produced the
 * 0.296 / 0.368 / 0.660 that stood in two files and reproduced in neither. It follows
 * the precedent `the head tracks its target through the chest, not past it` set for the
 * rejected gaze rules: the test drives the rejected arrangement itself instead of
 * quoting what it was once worth.
 *
 * The "before" rig is not a hand-written copy. It is `buildBeastSkeleton`'s own output
 * with `head-pivot` re-parented onto `body-pivot` and the head mesh put back at
 * `BEAST_RIG`'s ground-relative offsets — literally the mutation the fix reverses — so a
 * change to the production builder changes this measurement with it.
 */
test('what a foot-rooted skull was worth on each of the four animals', () => {
  const restLocal = new THREE.Vector3()
  const brokenAt = new THREE.Vector3()
  const fixedAt = new THREE.Vector3()
  const expected = new THREE.Vector3()
  const chestQuat = new THREE.Quaternion()
  const headQuat = new THREE.Quaternion()
  const localQuat = new THREE.Quaternion()
  const localEuler = new THREE.Euler()
  const axis = new THREE.Vector3()
  const measured = new Map<
    BeastKind,
    { slip: number; walking: number; dying: number; twist: number }
  >()

  for (const kind of BEAST_KINDS) {
    const rig = BEAST_RIG[kind]
    const poses = beastPoses(kind === 'troll')
    assert.ok(
      poses.some((pose) => pose.death) && poses.some((pose) => !pose.death),
      `${kind}: both pose families must be swept`,
    )

    // The "before" rig: production's own pivots, rearranged into the shipped mistake.
    const broken = buildBeastSkeleton(rig)
    broken.bodyPivot.add(broken.headPivot)
    const brokenHead = new THREE.Object3D()
    brokenHead.position.set(0, rig.headY, rig.headZ)
    broken.headPivot.add(brokenHead)
    assert.equal(
      broken.headPivot.parent,
      broken.bodyPivot,
      `${kind}: the "before" rig must actually be the foot-rooted one`,
    )
    // And the shipped one, untouched, so the third measurement is a real before/after
    // rather than an arithmetic identity.
    const fixed = buildBeastSkeleton(rig)
    const fixedHead = new THREE.Object3D()
    fixedHead.position.set(0, fixed.headY, fixed.headZ)
    fixed.headPivot.add(fixedHead)

    broken.root.updateMatrixWorld(true)
    restLocal.setFromMatrixPosition(brokenHead.matrixWorld)
    fixed.root.updateMatrixWorld(true)
    fixedAt.setFromMatrixPosition(fixedHead.matrixWorld)
    assert.ok(
      restLocal.distanceTo(fixedAt) < 1e-12,
      `${kind}: the two arrangements must start the animal in the same place, or the `
      + 'travel below is measuring a moved model rather than a moved joint',
    )

    let slip = 0
    let walking = 0
    let dying = 0
    let twist = 0
    for (const pose of poses) {
      for (const skeleton of [broken, fixed]) {
        applyChestPose(skeleton.torsoPivot, pose.chest[0], pose.chest[1], pose.chest[2])
        skeleton.torsoPivot.scale.y = pose.breathScale
        applyHeadPose(skeleton.headPivot, pose.head[0], pose.head[1], pose.head[2])
        skeleton.root.updateMatrixWorld(true)
      }
      // How far the fix moves the skull, at an identical authored pose. This is the
      // measurement that sees *both* halves of the defect: the chest the skull failed to
      // follow, and its own rotation swinging it about the feet instead of the neck.
      brokenAt.setFromMatrixPosition(brokenHead.matrixWorld)
      fixedAt.setFromMatrixPosition(fixedHead.matrixWorld)
      const travel = brokenAt.distanceTo(fixedAt)
      if (pose.death) dying = Math.max(dying, travel)
      else walking = Math.max(walking, travel)

      // Orientation, on the broken rig, against a skull rigid with its own chest.
      brokenHead.getWorldQuaternion(headQuat)
      broken.torsoPivot.getWorldQuaternion(chestQuat)
      localEuler.set(pose.head[0], pose.head[1], pose.head[2], 'XYZ')
      chestQuat.multiply(localQuat.setFromEuler(localEuler))
      twist = Math.max(twist, orientationDegrees(headQuat, chestQuat))

      // And the chest-inheritance half on its own, with the head's rotation held at zero
      // on both sides so they are like for like — the correction the humanoid table
      // needed when it first read 0.6835 instead of 0.6603.
      applyHeadPose(broken.headPivot, 0, 0, 0)
      broken.root.updateMatrixWorld(true)
      brokenAt.setFromMatrixPosition(brokenHead.matrixWorld)
      expected.copy(restLocal).applyMatrix4(broken.torsoPivot.matrixWorld)
      slip = Math.max(slip, brokenAt.distanceTo(expected))
    }
    measured.set(kind, { slip, walking, dying, twist })
  }

  for (const kind of BEAST_KINDS) {
    const record = FOOT_ROOTED_SKULL[kind]
    const got = measured.get(kind)
    assert.ok(got, `${kind}: the sweep produced no measurement`)
    for (const what of ['slip', 'walking', 'dying'] as const) {
      assert.ok(
        Math.abs(got[what] - record[what]) < 0.00005,
        `a foot-rooted ${kind} skull now measures ${got[what].toFixed(4)} for "${what}", `
        + `not the ${record[what].toFixed(4)} recorded beside it. Nothing is necessarily `
        + 'broken — but `BEAST_RIG`, the pose box or the animation has moved, and every '
        + 'figure in the docblocks above and in docs/09 is now wrong. Correct them to the '
        + 'value in this message rather than re-measuring by hand.',
      )
    }
    assert.ok(
      Math.abs(got.twist - record.twist) < 0.00005,
      `a foot-rooted ${kind} skull is now ${got.twist.toFixed(4)} degrees off its own `
      + `chest, not the ${record.twist.toFixed(4)} recorded. Same correction as above.`,
    )
    // The defect has to be worth something, or the equalities above are pinning nothing.
    // The floor is the animal's **own skull**, measured off the mesh — a quantity from
    // an entirely different part of the module, that no rig change can move, and not any
    // fraction of the measurement itself. Margins as recorded: wolf 1.40x, boar 1.30x,
    // bear 1.81x, troll 3.30x.
    const skull = buildBeastHead(kind)
    skull.computeBoundingBox()
    skull.boundingBox?.getSize(axis)
    const depth = axis.z
    skull.dispose()
    assert.ok(
      depth > 0.5,
      `${kind}: the head mesh measured ${depth.toFixed(4)} deep, which is not a skull`,
    )
    assert.ok(
      got.dying > depth * 0.4,
      `a foot-rooted ${kind} skull moved only ${got.dying.toFixed(4)} on death, under `
      + `${(depth * 0.4).toFixed(4)} — two fifths of its own ${depth.toFixed(4)} length. `
      + 'The pose box has stopped reaching the poses this test exists to measure, so the '
      + 'equalities above are pinning a rig nothing ever poses.',
    )
    // Death is the worse corner on every animal, which is the finding: the pose no test
    // covered was the pose the defect was largest in.
    assert.ok(
      got.dying > got.walking,
      `a foot-rooted ${kind} skull moved ${got.dying.toFixed(4)} dying against `
      + `${got.walking.toFixed(4)} walking. Death was the worse of the two on all four `
      + 'animals and on the humanoid rig; if that has changed, say so in docs/09 rather '
      + 'than deleting this line.',
    )
  }

  // And the world units, which is what the bug was reported in. `BEAST_PROFILES.scale`
  // is authored in `Fauna.ts`, entirely independently of the art table, so this catches a
  // rescale that leaves every authored figure untouched.
  const troll = measured.get('troll')
  assert.ok(troll, 'the troll must be swept')
  const trollWorld = troll.dying * BEAST_PROFILES.troll.scale
  assert.ok(
    Math.abs(trollWorld - 1.3453) < 0.00005,
    `a foot-rooted troll's skull now left its chest by ${trollWorld.toFixed(4)} m on `
    + 'death, not the 1.3453 m recorded. That is the figure this programme quotes as '
    + '"worse than the bug the user reported"; correct it here and in docs/09.',
  )
})

/**
 * A beast still keeps out of the biped pass, and still cannot look behind it.
 *
 * Two premises the rig depends on, both one line, both invisible to every measurement
 * above. The early return keeps the animal out of `animateActorCharacter`'s shoulder
 * bend, hip counter-rotation and body-centred head yaw, which are written for a spine
 * that stands up. The clamp is anatomy: a wolf is not an owl.
 *
 * The clamp used to be asserted by a source regex over `clamp(lookYaw, -0.45, 0.45)`.
 * This repository has already concluded, three review passes into the humanoid work,
 * that **a source regex cannot pin a behavioural invariant — it can only pin the current
 * spelling of one**, and the fix each time was to move the arithmetic somewhere a test
 * can drive it. So the clamp is `beastLookYaw` now, this drives the real function, and
 * what is left in source is the one thing a call cannot check: that the engine hands it
 * the angle instead of passing the angle straight through.
 *
 * Why the clamp is *kept* has changed, and that is worth writing down rather than
 * quietly leaving the old justification standing. On the sibling rig it was the only
 * thing holding the skull inside the animal: a look yaw about a pivot at the feet swept
 * a wolf's head 0.7337 authored units sideways even at the clamp and a troll's 1.0433,
 * both just inside their own contact-shadow radii — which is all "reads as attached"
 * ever meant. Hinged at the shoulder the same look moves them 0.2526 and 0.1629. The
 * clamp is no longer load-bearing for attachment. It is load-bearing for anatomy, and
 * the footprint comparison below stays what it always was — a **smoke bound**, two
 * separately authored numbers that ought to stay in proportion — with the radius
 * corrected to the joint the skull now actually turns about.
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
  const firstTorsoWrite = posture.indexOf('applyChestPose(')
  assert.ok(guard > 0, 'the beast branch has gone from animateActorCharacter')
  assert.ok(firstTorsoWrite > 0, 'the biped chest is no longer written by applyChestPose')
  assert.ok(
    guard < firstTorsoWrite,
    'a beast now reaches the biped shoulder bend, which twists the hips against the ribs '
    + 'and yaws the head about the body centre. Those are written for a spine that stands '
    + 'up; on a quadruped they pull the animal apart at every joint.',
  )
  assert.ok(
    posture.slice(guard, firstTorsoWrite).includes('return'),
    'the beast branch must return, not fall through into the biped pass',
  )

  // The clamp, driven rather than read. `beastLookYaw` is production.
  assert.equal(beastLookYaw(0), 0, 'a beast looking straight ahead must not be deflected')
  for (const look of [-Math.PI, -1.2, -BEAST_LOOK_CLAMP, 0, BEAST_LOOK_CLAMP, 1.2, Math.PI]) {
    const yaw = beastLookYaw(look)
    assert.ok(
      Math.abs(yaw) <= BEAST_LOOK_CLAMP + 1e-12,
      `a beast asked to look ${look.toFixed(2)} rad turned its head ${yaw.toFixed(4)}, past `
      + `the ${BEAST_LOOK_CLAMP.toFixed(2)} rad its neck allows.`,
    )
    if (Math.abs(look) <= BEAST_LOOK_CLAMP) {
      assert.ok(
        Math.abs(yaw - look) < 1e-12,
        `a beast asked to look ${look.toFixed(2)} rad — inside its own range — turned `
        + `${yaw.toFixed(4)} instead. The clamp must be a limit, not a scaling.`,
      )
    }
  }
  assert.ok(
    Math.abs(beastLookYaw(Math.PI) - BEAST_LOOK_CLAMP) < 1e-12 &&
      Math.abs(beastLookYaw(-Math.PI) + BEAST_LOOK_CLAMP) < 1e-12,
    'the clamp must saturate at its own limit in both directions, so an animal asked to '
    + 'look behind itself turns as far as it can rather than snapping to zero',
  )
  // Everything above is expressed in `BEAST_LOOK_CLAMP` and therefore moves with it —
  // which is exactly the self-scaling shape this repository keeps catching. This one does
  // not: a right angle is a fact about animals, not about the constant. A quadruped that
  // can put its own nose over its own shoulder without moving its ribs is not a beast.
  assert.ok(
    BEAST_LOOK_CLAMP > 0 && BEAST_LOOK_CLAMP < Math.PI / 2,
    `a beast may now turn its head ${BEAST_LOOK_CLAMP.toFixed(2)} rad off its own facing. `
    + 'Past a right angle the neck is not a neck; if the animation needs a wider look, '
    + 'turn the animal.',
  )

  // The rig data the numbers above were measured from, so a rewritten table is noticed
  // here rather than in a screenshot. A smoke bound: it compares a chord against a radius
  // and there is no geometric reason those should be equal, but the two are authored
  // separately, so a skull that grows away from its own shoulder trips it.
  for (const kind of BEAST_KINDS) {
    const rig = BEAST_RIG[kind]
    assert.ok(
      rig.headZ > 0 && rig.headY > 0,
      `${kind}: a skull is up and forward of the body centre`,
    )
    const neckToHead = Math.hypot(rig.headY - rig.frontJointY, rig.headZ - rig.frontZ)
    const sweep = 2 * neckToHead * Math.sin(BEAST_LOOK_CLAMP / 2)
    assert.ok(
      sweep <= rig.footprint,
      `a ${kind}'s skull sweeps ${sweep.toFixed(4)} sideways at the clamped `
      + `${BEAST_LOOK_CLAMP.toFixed(2)} rad look — further than its `
      + `${rig.footprint.toFixed(2)} footprint radius. Either clamp the look further or `
      + 'bring the skull in towards its own shoulder.',
    )
  }
})

/**
 * The engine poses a beast through the rig these tests measure.
 *
 * `GameEngine` cannot be instantiated in Node, so every number above is taken through
 * `CharacterKit`'s pure pieces. That proves the arithmetic and proves nothing about
 * whether the engine calls it. These are the couplings, in one place with a name that
 * says what they are — the beast half of `the engine wires the rig the way these tests
 * measure it`.
 *
 * Each is written to survive an *addition*, not only a rewrite. A pinned line can stay
 * verbatim and simply stop mattering because something was appended after it, so where a
 * write has to be the last word on a pivot, the negative is asserted too.
 */
test('the engine poses a beast through the rig these tests measure', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/game/GameEngine.ts', import.meta.url)),
    'utf8',
  )
  const kit = readFileSync(
    fileURLToPath(new URL('../src/game/art/CharacterKit.ts', import.meta.url)),
    'utf8',
  )

  // Construction. The pivots come from one builder, and the head hangs off the neck
  // inside it — an engine that went back to building its own would compile, pass every
  // measurement in this file, and put the skulls back at the animals' feet.
  const beast = source.slice(
    source.indexOf('private createBeast('),
    source.indexOf('private beastPeltColor('),
  )
  assert.ok(beast.length > 800, 'could not isolate createBeast')
  assert.ok(
    /buildBeastSkeleton\(rig\)/.test(beast),
    'createBeast must take its pivots from `buildBeastSkeleton`, which owns the fact that '
    + '`head-pivot` is a joint at the shoulder rather than a second root at the feet.',
  )
  assert.ok(
    /head\.position\.set\(0, headY, headZ\)$/m.test(beast),
    'the beast head mesh must be placed from the skeleton\'s neck-relative offsets. '
    + 'Anchored at the end of the line, because unanchored a longer expression beginning '
    + 'the same way would match and could put the skull back where it was.',
  )
  assert.ok(
    !/rig\.head[YZ]/.test(beast),
    'createBeast must not read `BEAST_RIG`\'s ground-relative head offsets directly: they '
    + 'are measured from the floor and `head-pivot` is at the shoulder. Reading both is '
    + 'how a joint drifts away from the mesh it carries.',
  )
  assert.equal(
    ((`${source}\n${kit}`).match(/bodyPivot\.add\(headPivot\)/g) ?? []).length,
    0,
    'nothing may root a head-pivot at the body any more. A person hangs one off the spine '
    + 'and an animal off its shoulder; a head parented to the body is a second root at '
    + 'the feet, which is the defect both rigs were rebuilt to remove.',
  )
  assert.equal(
    (kit.match(/neckPivot\.add\(headPivot\)/g) ?? []).length,
    2,
    'both skeleton builders — the person\'s and the animal\'s — must hang the head off a '
    + 'neck. One of the two silently going back to a sibling is exactly how this defect '
    + 'came to be fixed on people and left on beasts.',
  )
  assert.equal(
    (kit.match(/torsoPivot\.add\(neckPivot\)/g) ?? []).length,
    2,
    'both skeleton builders must hang the neck off the ribs',
  )

  // The pose pass.
  const pass = source.slice(
    source.indexOf('private animateBeastPosture('),
    source.indexOf('private sampleActorPose('),
  )
  assert.ok(pass.length > 600, 'could not isolate the beast posture pass')
  assert.ok(
    /applyChestPose\(\s*torsoPivot,/.test(pass),
    'the beast chest must be written through `applyChestPose`, which re-asserts the XYZ '
    + 'Euler order every frame. `solveHeadYaw` reads the columns of `Rx·Ry·Rz` out of the '
    + 'chest by hand, so an order set anywhere else silently invalidates the whole solve.',
  )
  assert.ok(
    !/torsoPivot\.rotation\.[xyz]\s*(?:[-+*/]?=[^=])/.test(pass),
    'the beast pass must not assign a chest rotation field directly. A field write never '
    + 'touches `.order`, which is exactly how the humanoid chest went ten commits with an '
    + 'unasserted requirement — measured at up to 30.0230 degrees of gaze error. Reading '
    + 'the three fields is fine and is what `solveHeadYaw` is handed; assigning them is '
    + 'what `applyChestPose` exists to stop.',
  )
  assert.ok(
    /actor\.headYaw = dampAngle\(actor\.headYaw, beastLookYaw\(lookYaw\), 5, delta\)$/m
      .test(pass),
    'a beast\'s tracking must clamp its look through `beastLookYaw` and damp the '
    + '*body*-space angle. Damped after the conversion it lags the chest\'s own gait '
    + 'twist, and the lag comes back as world-space wobble.',
  )
  assert.ok(
    /const headPitch = pose\.attack \* 0\.16 - pose\.flinch \* 0\.2$/m.test(pass),
    'the beast head pitch must be computed before the solve and reused when it is '
    + 'written, so the solve reads the value that actually lands on the pivot. Anchored '
    + 'at the end of the line: unanchored, an appended term would still match and would '
    + 'move the head somewhere the solve does not know about.',
  )
  assert.ok(
    /applyHeadPose\(\s*headPivot,\s*headPitch,\s*torsoPivot\s*\?\s*solveHeadYaw\(\s*torsoPivot\.rotation\.x,\s*torsoPivot\.rotation\.y,\s*torsoPivot\.rotation\.z,\s*headPitch,\s*actor\.headYaw,?\s*\)\s*:\s*actor\.headYaw,\s*actor\.turnLean \* 0\.04,?\s*\)/
      .test(pass),
    'the beast head pose is no longer one `applyHeadPose` call taking the hoisted pitch, '
    + 'a yaw solved against the chest\'s full rotation *and* that same pitch, and the '
    + 'turn-lean roll. `lookYaw` is a body-space angle and `head-pivot` is a chest-space '
    + 'node now: written raw it costs 3.0334 degrees on a troll, and the obvious '
    + '`lookYaw - chestYaw` leaves 1.7368 and is worse than doing nothing in 432 of 4764 '
    + 'swept states. Every argument is checked because on the humanoid call two of them '
    + 'were not, and a reviewer passed `0` for the roll with the suite still green.',
  )
  assert.ok(
    !/headPivot\.rotation\./.test(pass),
    'the beast pass must not write a head rotation field after `applyHeadPose`. This is '
    + 'the assertion that survives an *addition*: the call above can stay word for word '
    + 'and stop mattering entirely because a later line overwrote one of its axes.',
  )

  // The breath, which the proportion bound above is derived from — a derivation reading a
  // stale input is just a round number again.
  assert.ok(
    new RegExp(`torsoPivot\\.scale\\.y = 1 \\+ breathing \\* ${BEAST_BREATH_GAIN}$`, 'm')
      .test(pass),
    `a beast's chest no longer breathes by ${BEAST_BREATH_GAIN}. Move `
    + '`BEAST_BREATH_GAIN` with it in the same commit: the skull\'s proportion bound is '
    + 'derived from it.',
  )
  assert.ok(
    new RegExp(`const breathing = Math\\.sin\\([^)]*\\) \\* ${BEAST_BREATH_AMPLITUDE}`)
      .test(source.slice(
        source.indexOf('private animateActorCharacter('),
        source.indexOf('private samplePlayerPose('),
      )),
    `the breathing amplitude is no longer ${BEAST_BREATH_AMPLITUDE}. It feeds both the `
    + 'humanoid and the beast proportion bounds.',
  )

  // The width. `applyActorVisualVariation` runs for beasts as well as people, and the
  // neck it divides the chest's width back out at is now something a beast has.
  const variation = source.slice(
    source.indexOf('private applyActorVisualVariation('),
    source.indexOf('private createActorHealthBar('),
  )
  assert.ok(variation.length > 500, 'could not isolate the actor variation pass')
  assert.ok(
    new RegExp(`shoulders = variation\\.around\\(1, ${BEAST_SHOULDER_SPREAD}\\)`)
      .test(variation),
    `the shoulder spread is no longer ${BEAST_SHOULDER_SPREAD}. The beast skull's `
    + 'proportion sweep drives both extremes of it; move `BEAST_SHOULDER_SPREAD` with it.',
  )

  // The death pose. Nothing else in the suite drives it, and on the old rig it was the
  // largest instance of the defect on all four animals.
  const death = source.slice(
    source.indexOf('private updateActorDeathMotion('),
    source.indexOf('private injurePlayer('),
  )
  assert.ok(death.length > 800, 'could not isolate the death motion')
  assert.ok(
    new RegExp(`head\\.rotation\\.z = side \\* ${BEAST_DEATH_LOLL} \\* eased$`, 'm')
      .test(death),
    `a dying body no longer lolls its head by ${BEAST_DEATH_LOLL}. The beast pose box `
    + 'drives that number; move `BEAST_DEATH_LOLL` with it, and re-measure — this is the '
    + 'pose the foot-rooted skull was worst in and the one nothing was checking.',
  )
  assert.ok(
    !/head\.(position|scale)/.test(death) && !/head\.rotation\.[xy]/.test(death),
    'the death motion must drive the skull\'s roll and nothing else. It is looked up by '
    + 'name off the actor\'s mesh, so a position or a second rotation written here reaches '
    + 'a pivot that no living pose pass will reset.',
  )
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
  // Three source pins reduced to one, because `applyHeadPose` made two of them
  // behavioural. What is left here is genuinely a *wiring* fact — which values are
  // handed to the function — and that is the one thing a call cannot check, since it
  // takes whatever it is given.
  //
  // The single-argument shape matters: `headPitch` appears twice in the call, once as
  // the pitch written and once as the pitch the solve corrects for. Hoisting it into a
  // const exists so those cannot diverge, and this pattern is what notices if the two
  // occurrences stop being the same expression.
  assert.ok(
    /applyHeadPose\(\s*headPivot,\s*headPitch,\s*torsoPivot\s*\?\s*solveHeadYaw\(\s*torsoPivot\.rotation\.x,\s*torsoPivot\.rotation\.y,\s*torsoPivot\.rotation\.z,\s*headPitch,\s*actor\.headYaw,?\s*\)\s*:\s*actor\.headYaw,\s*actor\.turnLean \* 0\.06 -\s*idleWeightShift \* 0\.2 -\s*pose\.flinch \* hitRight \* 0\.3,?\s*\)/
      .test(actorPosture),
    'the head pose is no longer written by one `applyHeadPose` call taking `headPitch`, '
    + 'a yaw solved against the chest\'s full rotation *and* that same `headPitch`, and '
    + 'the turn-lean roll. Naming the function is not enough: a reviewer replaced the '
    + 'call with `solveHeadYaw(0, 0, 0, actor.headYaw)` and the whole suite still '
    + 'passed, because nothing checked the arguments. A scalar subtraction leaves 20.3 '
    + 'degrees and is worse than nothing in 3.90% of states; dropping the head pitch '
    + 'alone leaves 9.7. **The roll argument is checked because it was not**: the same '
    + 'reviewer passed `0` there and this assertion stayed green, which would have '
    + 'silently removed the head\'s counter-roll against the turn. The equality between '
    + 'the pitch given and the pitch written is checked by driving `applyHeadPose` '
    + 'directly, in the gaze test — this only checks what reaches it.',
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
  // And the beast short-circuit, which is what keeps `actorSpeedForRole`'s unreachable
  // branch unreachable. Handed a beast role directly it returns the humanoid 3.7, where
  // the profiles are wolf 5.4, boar 4.6, bear 3.4, troll 2.9 — so if this `??` ever
  // goes, every quadruped silently takes a soldier's speed while the cadence function
  // beside it keeps answering correctly for them. A reviewer found the mismatch and put
  // the choice correctly: either the function's domain is wrong or its beast behaviour
  // is. This line is what makes the answer "the domain".
  assert.ok(
    /beast\?\.speed \?\? actorSpeedForRole\(role\)/.test(source),
    'the beast speed short-circuit is gone, so quadrupeds now reach '
    + '`actorSpeedForRole`, which answers only for humanoids and returns 3.7 for all '
    + 'four of them. Narrow that function\'s parameter type, or restore the '
    + '`beast?.speed ??` that keeps its unreachable branch unreachable.',
  )
  // Every advance site, not "some site advances correctly". `.test()` returns true on
  // the first match, so this pin was satisfied by one of the three `gaitPhase +=`
  // statements while the other two could be inlined with a literal — which is the "gait
  // wrong by 3.7x" defect it exists to prevent, moved onto the flee and charge paths.
  // A reviewer inlined one and the file stayed 22/0.
  //
  // The question that would have caught this when the pin was written, and the five
  // before it: **what is the population of the thing I am pinning, and am I sampling it
  // or enumerating it?** Three call sites, two pivots, two placements, a second delta —
  // every one was cheap to enumerate, and in every case the sample chosen was the one in
  // front of the author. That is the review-response mechanism one level down.
  //
  // `>= 3` rather than `=== 3` so a legitimate fourth site is not a failure; the
  // `every` is what carries the meaning.
  const advances = source.match(/gaitPhase \+= [^\n]*/g) ?? []
  assert.ok(
    advances.length >= 3
      && advances.every((a) => /travelled \* actorGaitCadence\(actor\.role\)/.test(a)),
    `of the ${String(advances.length)} places the gait advances, `
    + `${String(advances.filter((a) => !/travelled \* actorGaitCadence\(actor\.role\)/.test(a)).length)} `
    + 'no longer multiply distance travelled by `actorGaitCadence`. `the head holds its '
    + 'target while the chest twists under it` multiplies speed by cadence on the '
    + 'strength of these lines; if any of them becomes time-based or takes a literal, '
    + 'that simulation is wrong by the actor\'s speed on whichever path it is. This '
    + 'stays a source pin because it is a wiring fact — *what* the cadence is multiplied '
    + 'by — and `actorGaitCadence` cannot check what its callers do with the answer.',
  )
  const HEAVY = ['brute', 'champion']
  // ## Twelve source pins, replaced by two calls
  //
  // The cadence and speed for each role used to be matched against `GameEngine`'s
  // source text, because `GameEngine` cannot be constructed in a Node test. Across six
  // review passes those patterns were walked past six different ways, and the last one
  // is what settled it: both *default* branches asserted that a role name was **absent**
  // from a slice, and absence is defeated by routing the name through a constant —
  // `role === ROLE_SOLDIER ? 9.9 : 3.7)` leaves `: 3.7)` intact, keeps `'soldier'` out
  // of the slice, and gives the soldier a speed of 9.9 with the file at 22/0.
  //
  // That evasion is contrived on its own. The *shape* is not: three of the six earlier
  // evasions were also "move the token out of the window", and **a negative source
  // assertion is exactly as strong as your confidence about where the token can live**.
  //
  // `actorGaitCadence` and `actorSpeedForRole` are now pure functions in `types.ts`, so
  // this table is checked by calling them. No spelling of the engine can satisfy these
  // assertions without returning the values — which is the same move that retired the
  // anisotropy test's private copy of the shoulder-width correction, and the reason to
  // prefer it is not elegance but that **reading code can always be defeated by
  // rewriting it, and running it cannot.**
  for (const gait of GAITS) {
    assert.equal(
      actorGaitCadence(gait.role),
      gait.cadence,
      `the ${gait.role}'s gait cadence is ${String(actorGaitCadence(gait.role))} in the `
      + `engine and ${String(gait.cadence)} in GAITS. The wobble simulation below `
      + 'multiplies speed by cadence, so a drift here models physics the engine does '
      + 'not run — which is how an earlier version of that test came to be sized '
      + 'against a gait 3.7x too slow.',
    )
    assert.equal(
      actorSpeedForRole(gait.role),
      gait.speed,
      `the ${gait.role}'s speed is ${String(actorSpeedForRole(gait.role))} in the engine `
      + `and ${String(gait.speed)} in GAITS. Cadence is radians per *metre*, so the `
      + 'simulated frequency is this speed times that cadence and both must be right.',
    )
    assert.equal(
      chestGaitYaw(1, HEAVY.includes(gait.role)),
      -gait.chestYawCoefficient,
      `GAITS gives the ${gait.role} a chest yaw coefficient of `
      + `${String(gait.chestYawCoefficient)}; the engine turns a unit stride into `
      + `${String(chestGaitYaw(1, HEAVY.includes(gait.role)))}.`,
    )
  }
  // The beasts, which `GAITS` never covered and no assertion touched. `GAITS` documents
  // why it excludes `minion`, `captive` and `commander`; the quadrupeds were simply not
  // thought of, and `actorGaitCadence`'s first line carries three constants driving four
  // creatures' limb animation. A reviewer changed the wolf's 9.6 to 2.0 and the file
  // stayed 22/0.
  //
  // Low stakes — beasts never reach the biped pass this file measures — but they are
  // three unpinned numbers inside a function whose entire purpose is now to be pinned,
  // and *"the population is the ones I was thinking about"* is the defect this pass
  // named. Enumerated from `BEAST_KINDS` rather than listed, so a fifth creature is a
  // failure here rather than a silent omission.
  for (const [kind, cadence] of [
    ['wolf', 9.6], ['boar', 8.8], ['bear', 5.2], ['troll', 5.2],
  ] as const) {
    assert.equal(
      actorGaitCadence(kind),
      cadence,
      `the ${kind}'s gait cadence is ${String(actorGaitCadence(kind))}, not the `
      + `${String(cadence)} recorded here. Nothing downstream of this file reads it — `
      + 'beasts do not run the biped posture pass — but an unpinned constant in a pinned '
      + 'function is the omission this table exists to prevent.',
    )
  }
  assert.deepEqual(
    [...BEAST_KINDS].sort(),
    ['bear', 'boar', 'troll', 'wolf'],
    'the beast roster has changed, so the cadence table above is sampling it rather '
    + 'than enumerating it. Add the new creature\'s cadence, or remove the departed one.',
  )
  // And the three humanoid roles `GAITS` leaves out, found by asking the same question
  // of the same function rather than waiting to be told a third time.
  //
  // `GAITS` documents why it excludes `minion`, `captive` and `commander` **from the
  // wobble simulation** — minion duplicates soldier, commander has speed 0 and does not
  // walk. That is a decision about which gaits are worth simulating. It is not a reason
  // for their *constants* to be unpinned, and `commander`'s speed of 0 is a distinct
  // production value that nothing checked at all.
  //
  // Enumerated from `characterRoles()`, so the nine are nine.
  const ROLE_GAITS: Record<
    (ReturnType<typeof characterRoles>)[number], readonly [number, number]
  > = {
    soldier: [3.7, 6.8], minion: [3.7, 6.8], scout: [4.8, 8.4],
    archer: [3.2, 7.2], brute: [2.6, 5.8], commander: [0, 6.8],
    champion: [4.15, 5.8], peasant: [3.1, 6.8], captive: [3.7, 6.8],
  }
  assert.deepEqual(
    [...characterRoles()].sort(),
    Object.keys(ROLE_GAITS).sort(),
    'the humanoid roster and this speed/cadence table disagree, so the table is a '
    + 'sample of the roles rather than an enumeration of them.',
  )
  for (const role of characterRoles()) {
    // The cast is licensed by the assertion immediately above, not asserted away by it:
    // `characterRoles()` returns `readonly string[]`, and the `deepEqual` has just
    // established that its members are exactly the keys of this table. Doing it in that
    // order matters — a cast placed before the enumeration check would be the thing
    // hiding a mismatch rather than the thing relying on one being absent.
    const named = role as Parameters<typeof actorSpeedForRole>[0]
    const [speed, cadence] = ROLE_GAITS[role]
    assert.deepEqual(
      [actorSpeedForRole(named), actorGaitCadence(named)],
      [speed, cadence],
      `the ${role}'s speed/cadence is `
      + `[${String(actorSpeedForRole(named))}, ${String(actorGaitCadence(named))}], not the `
      + `[${String(speed)}, ${String(cadence)}] recorded here. Three of these roles are `
      + 'absent from `GAITS` for stated reasons about which gaits are worth simulating — '
      + 'which is a decision about the wobble table, not a licence for their constants '
      + 'to go unchecked.',
    )
  }
  assert.ok(
    /const heavy = actor\.role === 'brute' \|\| actor\.role === 'champion'/.test(source),
    'the `heavy` predicate has changed, so GAITS\' split across the two coefficients no '
    + 'longer matches the engine. The assertion above reads both values out of source '
    + 'but still decides which role gets which from a hard-coded pair of names, and '
    + 'this is what keeps that honest.',
  )
  // Which stride the chest reads, and what a stagger does to it. Both are load-bearing
  // for the joint-reachability model the gaze test's comment describes, and a previous
  // version of that comment asserted the opposite of both — that `pose.stride` being
  // zeroed under stagger leaves a staggering chest with no gait yaw. It does not:
  // `pose.stride` only ever reaches the limbs, and `actor.stride` is damped rather than
  // cleared.
  //
  // ## These were six source regexes, and three review passes walked past them
  //
  // Each pass produced a new evasion and each fix bought exactly one more instance:
  //
  //   matching a prefix                  `= headPitch * 0.5`            22/0
  //   adding a statement after the pin   `actor.stride = 0` on the next line   22/0
  //   compound assignment                `actor.stride *= 0`            22/0
  //   hoisting the term out of the slice  `const gaitGate = ...`        22/0
  //   writing it somewhere else entirely  the stagger's own branch      22/0
  //
  // The third reviewer drew the conclusion the first two had earned: **a source regex
  // cannot pin a behavioural invariant — it can only pin the current spelling of one**,
  // so the class of evasions is unbounded. Anchoring closed modification, negative
  // assertions closed addition, and neither touches scope or spelling.
  //
  // So the arithmetic moved into `chestGaitYaw` and `decayStrideOnStagger`, and these
  // are now *calls* rather than patterns. **A test that drives production cannot be
  // evaded by rewriting production** — mutating the damp rate from 13 to 30 fails here
  // where no regex saw it, and that pin is permanent.
  //
  // **It does not close the class, and claiming otherwise was the first draft of this
  // comment.** Two of the three evasions above survive the extraction, measured:
  //
  //   `actor.stride *= 0` after the call                    22 pass, 0 fail
  //   gate hoisted above the block, `* gaitGate` in the yaw  22 pass, 0 fail
  //
  // Both leave the extracted functions untouched and change what happens *around* the
  // call. The extraction pins what the arithmetic computes; it cannot pin that the
  // result is what reaches the pivot. **Splitting a fact out of production converts a
  // spelling problem into a wiring problem — it does not remove one.**
  //
  // What would close the remainder is a test that constructs an actor and runs a frame,
  // and `GameEngine` is not constructible in Node, which is why this file pins source at
  // all. So the honest position is: the arithmetic is now permanently guarded, the
  // wiring is guarded by one regex that a determined edit can still walk around, and
  // that gap is a property of the test architecture rather than of this assertion.
  // Recorded rather than papered over, because the previous three rounds each ended
  // with a claim that the latest patch had settled it.
  assert.equal(
    decayStrideOnStagger(1, 1 / 60).toFixed(4),
    Math.exp(-13 / 60).toFixed(4),
    'a stagger no longer damps the stride at 13. If it clears it instead, the first '
    + 'frame of a stagger stops carrying ~81% of its gait yaw, and the gaze test\'s '
    + 'reachability model — which pairs a staggering chest\'s residual gait yaw with the '
    + 'head pitch that same frame produces — needs re-deriving rather than editing.',
  )
  // A second delta, because the assertion above can be satisfied by construction. A
  // reviewer replaced the body with `stride * Math.exp(-13 / 60)` — the frame rate
  // hard-coded, `delta` ignored entirely — and it passed, because it returns exactly
  // what the pin asks for at exactly the input the pin uses. At 30 fps the real
  // function gives `exp(-13/30)` = 0.6485 and that mutant still gives 0.8059.
  //
  // **A hard-coded frame rate is precisely the class of defect that moving arithmetic
  // into a function exists to catch**, and a single-delta pin cannot see it. Two
  // deltas pin the exponential *form*: decay over 2/60 must equal decay over 1/60
  // squared, which holds for `exp(-k·delta)` and fails for anything that ignores
  // `delta` or is linear in it.
  assert.ok(
    Math.abs(decayStrideOnStagger(1, 2 / 60) - decayStrideOnStagger(1, 1 / 60) ** 2) < 1e-12,
    `the stride decay is no longer exponential in delta: one frame at 2/60 leaves `
    + `${decayStrideOnStagger(1, 2 / 60).toFixed(6)} where two frames at 1/60 leave `
    + `${(decayStrideOnStagger(1, 1 / 60) ** 2).toFixed(6)}. A decay that ignores delta `
    + 'passes the equality above and is wrong at every frame rate but the one it was '
    + 'written at.',
  )
  // And the *other* axis, which the commit that fixed the delta left at one point —
  // every assertion above uses `stride = 1`. `damp(Math.sign(stride), 0, 13, delta)` is
  // identical to production at `stride = 1` for every delta, so it satisfies the value
  // pin, the semigroup pin and the `> 0.8` pin together; at `stride = 0.5` it snaps a
  // staggering actor's stride to full magnitude and then decays, instead of decaying
  // from where it was.
  //
  // **A reviewer found this inside the commit titled "pin the extracted functions across
  // their range, not at one input"**, which is the sharpest instance this branch has
  // produced of its own recurring defect: *the axis you were shown gets enumerated and
  // the axis nobody complained about stays a sample.* The delta axis had a demonstrated
  // failure; the stride axis did not; only the demonstrated one got swept.
  //
  // So the question is not "am I sampling or enumerating" but **"which axes does this
  // function have, and did I enumerate the one nobody complained about?"** — which is
  // why `chestGaitYaw` escaped: the wobble simulation calls it 3,600 times per role
  // across ±0.62, so its stride axis was covered by something that already existed.
  // `decayStrideOnStagger` has nothing behind it; the simulation never staggers.
  // Linearity across a *range* of strides, not at two points — because two points is
  // still a sample, and the first version of this assertion used exactly 0.5 and 1.
  // `Math.max(stride, 0.5)` passed it 22/0: a clamp sitting exactly on a sample point is
  // invisible to it, and my own mutation run found that within a minute of writing it.
  //
  // **And the range it then swept was positive-only**, which a fourth reviewer broke with
  // `stride < 0 ? 0 : damp(...)` — 22/0. `actor.stride` is damped toward `sin(gaitPhase)`
  // and spends half the gait cycle negative, so clearing the negative half deletes half
  // the cycle and invalidates the signed reachability model this file's bounds rest on.
  //
  // Three rounds of the same defect on one axis of one function: a point, then two
  // points, then the positive half. **Each fix enumerated exactly the part that had been
  // demonstrated broken.** That is the sharpest form of the pattern this branch keeps
  // producing, and it is worth stating with the count rather than tidied away: the
  // question is not just which axes a function has, but *which half of each axis you
  // have actually been shown*.
  for (const stride of [-1, -0.62, -0.25, -0.05, -0.01, 0.01, 0.05, 0.1, 0.25, 0.5, 0.62, 1]) {
    assert.ok(
      Math.abs(decayStrideOnStagger(stride, 1 / 60) - stride * decayStrideOnStagger(1, 1 / 60))
        < 1e-12,
      `the stride decay is no longer linear in the stride at ${String(stride)}: it leaves `
      + `${decayStrideOnStagger(stride, 1 / 60).toFixed(9)} where linearity requires `
      + `${(stride * decayStrideOnStagger(1, 1 / 60)).toFixed(9)}. Linearity holds for `
      + '`s·e^(-k·delta)` and fails for anything that normalises, clamps or signs the '
      + 'stride — all of which leave a staggering actor decaying from a magnitude it '
      + 'never had rather than from where it actually was.',
    )
  }
  assert.ok(
    decayStrideOnStagger(1, 1 / 60) > 0.8,
    `one frame of a stagger leaves ${decayStrideOnStagger(1, 1 / 60).toFixed(4)} of the `
    + 'stride, not the ~0.806 the reachability model is built on. Anything that makes '
    + 'this small enough to ignore makes that model wrong in the other direction.',
  )
  // The one fact that genuinely is about wiring rather than arithmetic, so it stays a
  // source pin: *which* stride the chest reads. `chestGaitYaw` cannot check this — it
  // takes whatever it is handed.
  assert.ok(
    /chestGaitYaw\(actor\.stride, heavy\)/.test(actorPosture),
    'the chest\'s yaw no longer reads `actor.stride`. If it now reads `pose.stride`, a '
    + 'stagger really would zero it — `pose.stride` is set to 0 on a stagger and only '
    + 'ever reaches limbs — and the gaze test\'s reachability comment, which says the '
    + 'opposite, becomes wrong in the other direction.',
  )
  // And that the value `chestGaitYaw` returns is the value the chest keeps. A reviewer
  // added `torsoPivot.rotation.y -= actor.stride * 0.01` *after* the expression: the
  // extracted function still returns 0.12 per unit stride, the assertion above still
  // passes, and the chest effectively turns at 0.13. The extraction pins what the
  // arithmetic computes and cannot pin that the result survives to the pivot, because
  // `torsoPivot.rotation.y` is assignable by anything downstream.
  //
  // Counted, not pattern-matched, and counting **every** assignment operator — the
  // previous negative assertion of this shape looked for `=` and was walked past with
  // `*=`.
  //
  // **The commit that added this claimed it was "not one more spelling" and caught a
  // second writer "whatever it looks like". That claim is false and a reviewer
  // falsified it in one line:**
  //
  // ```ts
  // const chestRotation = torsoPivot.rotation
  // chestRotation.y -= actor.stride * 0.01
  // ```
  //
  // 22/0. `Object.assign`, `rotation.set`, bracket notation and a helper call are the
  // same class. This *is* one more spelling — a better one, because it covers the four
  // operators rather than one, but a source regex cannot see through an alias and no
  // amount of widening will change that.
  //
  // It is left in place because it raises the bar against the mutations that are
  // actually likely, and the claim is corrected rather than the assertion deleted. What
  // would close it is a test that runs a frame and reads the pivot, which needs a
  // constructible `GameEngine` — the architectural gap this file has recorded throughout
  // and cannot fix from here.
  assert.equal(
    (actorPosture.match(/rotation\.order\s*=/g) ?? []).length,
    0,
    'something in the actor posture pass assigns `rotation.order`. `applyHeadPose` and '
    + '`applyChestPose` reassert XYZ on every write, but **that only beats a write they '
    + 'run after** — a reviewer set the order on the line following the call and it '
    + 'survived, because `Euler`\'s order setter recomputes the quaternion on its own. '
    + 'Nothing here has any business setting an Euler order: the two pose functions own '
    + 'it, and this assertion says so for both placements rather than the one that '
    + 'happened to be measured.',
  )
  assert.equal(
    (actorPosture.match(/applyChestPose\(/g) ?? []).length,
    1,
    'the chest pose is written by something other than a single `applyChestPose` call. '
    + '`GAITS` simulates one `chestGaitYaw` result, so a second write — even one that '
    + 'only adjusts it — makes the wobble test model a gait the engine does not run, '
    + 'while every assertion about the coefficient still passes because the coefficient '
    + 'did not change.',
  )
  assert.equal(
    (actorPosture.match(/torsoPivot\.rotation\.[xyz]\s*(?:[-+*/]?=)/g) ?? []).length,
    0,
    'a component of the chest\'s rotation is assigned directly in the actor posture '
    + 'pass. That bypasses `applyChestPose`, which means the Euler order stops being '
    + 'reasserted — worth up to 30 degrees of gaze error — and it means the chest yaw '
    + 'the wobble test simulates is not the chest yaw the engine produces. Counting '
    + 'every assignment operator, because the previous assertion of this shape looked '
    + 'for `=` and was walked past with `*=`.',
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