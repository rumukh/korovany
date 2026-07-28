import * as THREE from 'three'
import {
  bakeOutlineNormals,
  extrudeProfile,
  latheProfile,
  loftProfile,
  mergeAll,
  polygonProfile,
  rectProfile,
  taperedBox,
  transformed,
  tubeAlongPoints,
  type LoftSection,
  type LoftOptions,
  type TaperedBoxOptions,
  type TransformOptions,
  type Vec2Like,
} from './GeometryKit.ts'

/**
 * Everything the game's people, animals and carts are made of.
 *
 * `GeometryKit` is the vocabulary; this is the sentence. It owns the character
 * *taxonomy* — which faction wears what, which role reads as what shape, which
 * weapon hangs off which kit — and the builders that turn that taxonomy into
 * buffers. See `docs/09-npc-and-creature-models-spec.md` for the contract.
 *
 * Three rules hold the module together:
 *
 * 1. **No randomness lives here.** Every builder is a pure function of its
 *    arguments, so a `GeometryCache` key fully determines the buffer it names.
 *    Variation enters through {@link resolveCharacterPlan}'s integer `variant`,
 *    which the engine draws from an `art:` stream.
 * 2. **No materials live here.** Geometry in, geometry out. The engine decides
 *    what is cloth and what is steel, because only the engine has the palette.
 * 3. **No engine imports.** `three` and `GeometryKit`, nothing else, so the whole
 *    module stays importable from a Node test with no DOM.
 */

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export type CharacterFaction = 'elf' | 'guard' | 'villain'

/**
 * The nine shapes a person can be.
 *
 * Gameplay roles map onto these many-to-one, which is what keeps the cached
 * geometry space small: `soldier` and `minion` are the same silhouette problem.
 */
export type CharacterKitId =
  | 'line'
  | 'light'
  | 'ranged'
  | 'heavy'
  | 'officer'
  | 'elite'
  | 'civil'
  | 'bound'
  | 'hero'

export type ArmourWeight = 'none' | 'light' | 'medium' | 'heavy'

export type WeaponKind =
  | 'sword'
  | 'greatsword'
  | 'sabre'
  | 'dagger'
  | 'axe'
  | 'cleaver'
  | 'spear'
  | 'glaive'
  | 'mace'
  | 'maul'
  | 'bow'
  | 'staff'

export type HeadgearKind =
  | 'none'
  | 'circlet'
  | 'crown'
  | 'hood'
  | 'kettle'
  | 'nasal'
  | 'crested'
  | 'greathelm'
  | 'hornedHelm'
  | 'boneMask'
  | 'ragHood'
  | 'cap'
  | 'strap'

export type HairKind = 'none' | 'long' | 'crop' | 'topknot' | 'ragged'

export type CloakKind = 'none' | 'cape' | 'cloak' | 'mantle' | 'rags'

export type TrimKind =
  | 'none'
  | 'belt'
  | 'beltPouch'
  | 'quiver'
  | 'pack'
  | 'harness'
  | 'sash'
  | 'rope'

export type OffhandKind =
  | 'none'
  | 'heater'
  | 'roundSpiked'
  | 'leafKite'
  | 'buckler'
  | 'bundle'

/** Shapes that share a torso build. Five classes instead of nine kits. */
export type TorsoClass = 'light' | 'line' | 'heavy' | 'officer' | 'civil'

/** How many headgear/hair/weapon/tint variants a kit offers. */
export const CHARACTER_VARIANTS = 3

/** Distance at which face, hair, trim and bare hands stop being drawn. */
export const CHARACTER_DETAIL_DISTANCE = 26

export interface CharacterProportions {
  /** Height of the shoulder joints above the actor's feet. */
  shoulderY: number
  /** Half the distance between the two shoulder joints. */
  shoulderX: number
  hipY: number
  hipX: number
  /** Centre of the torso mesh. */
  torsoY: number
  /** Centre of the head mesh. */
  headY: number
  upperArm: number
  forearm: number
  thigh: number
  shin: number
  chestWidth: number
  chestDepth: number
  waistScale: number
  headScale: number
  /** Resting forward hunch of the whole torso, in radians. */
  lean: number
  /** Resting outward roll of the arms, in radians. */
  armSplay: number
  /** Resting outward roll of the legs, in radians. */
  legSplay: number
  /** Resting elbow flex, in radians. */
  elbowRest: number
}

export interface CharacterPlan {
  faction: CharacterFaction
  kit: CharacterKitId
  torsoClass: TorsoClass
  armour: ArmourWeight
  proportions: CharacterProportions
  headgear: HeadgearKind
  hair: HairKind
  weapon: WeaponKind
  offhand: OffhandKind
  cloak: CloakKind
  trim: TrimKind
  /** Selects one of four pre-mixed cloth tints. Never mutates a material. */
  tint: number
  skinTone: number
  hairTone: number
  /** Which hand the weapon pivot tracks. Archers hold the bow in the left. */
  mainHand: 'left' | 'right'
  /** Gloved kits fold the fist into the forearm; bare kits get a skin hand. */
  gloved: boolean
  armed: boolean
  /** A captive's arms are roped together and do not swing. */
  boundArms: boolean
}

/** Every cached geometry a plan needs, named so the engine and the tests agree. */
export interface CharacterPartKeys {
  torso: string
  head: string
  face: string
  hair: string | null
  upperArm: string
  forearm: string
  hand: string | null
  thigh: string
  shin: string
  trim: string | null
  cloak: string | null
  headgear: string | null
  weaponHead: string | null
  weaponGrip: string | null
  offhand: string | null
}

const KIT_BY_ROLE: Record<string, CharacterKitId> = {
  soldier: 'line',
  minion: 'line',
  scout: 'light',
  archer: 'ranged',
  brute: 'heavy',
  commander: 'officer',
  champion: 'elite',
  peasant: 'civil',
  captive: 'bound',
  player: 'hero',
}

const TORSO_CLASS_BY_KIT: Record<CharacterKitId, TorsoClass> = {
  line: 'line',
  light: 'light',
  ranged: 'light',
  heavy: 'heavy',
  officer: 'officer',
  elite: 'heavy',
  civil: 'civil',
  bound: 'civil',
  hero: 'line',
}

const ARMOUR_BY_KIT: Record<CharacterKitId, ArmourWeight> = {
  line: 'medium',
  light: 'light',
  ranged: 'light',
  heavy: 'heavy',
  officer: 'medium',
  elite: 'heavy',
  civil: 'none',
  bound: 'none',
  hero: 'medium',
}

/**
 * Weapon families, in the order a variant index walks them.
 *
 * A faction's list is its fighting style: elves reach, guards form a line,
 * villains swing something heavy they found.
 */
const WEAPONS: Record<CharacterFaction, Record<CharacterKitId, readonly WeaponKind[]>> = {
  elf: {
    line: ['sabre', 'spear', 'sword'],
    light: ['dagger', 'sabre', 'dagger'],
    ranged: ['bow', 'bow', 'bow'],
    heavy: ['glaive', 'axe', 'glaive'],
    officer: ['sabre', 'staff', 'sabre'],
    elite: ['glaive', 'greatsword', 'glaive'],
    civil: ['staff', 'staff', 'staff'],
    bound: ['dagger', 'dagger', 'dagger'],
    hero: ['sabre', 'sabre', 'sabre'],
  },
  guard: {
    line: ['sword', 'spear', 'mace'],
    light: ['sword', 'dagger', 'sword'],
    ranged: ['bow', 'bow', 'bow'],
    heavy: ['maul', 'axe', 'maul'],
    officer: ['sword', 'mace', 'sword'],
    elite: ['greatsword', 'glaive', 'greatsword'],
    civil: ['staff', 'staff', 'staff'],
    bound: ['dagger', 'dagger', 'dagger'],
    hero: ['sword', 'sword', 'sword'],
  },
  villain: {
    line: ['cleaver', 'axe', 'spear'],
    light: ['dagger', 'cleaver', 'dagger'],
    ranged: ['bow', 'bow', 'bow'],
    heavy: ['maul', 'cleaver', 'maul'],
    officer: ['cleaver', 'mace', 'cleaver'],
    elite: ['greatsword', 'maul', 'greatsword'],
    civil: ['staff', 'staff', 'staff'],
    bound: ['dagger', 'dagger', 'dagger'],
    hero: ['cleaver', 'cleaver', 'cleaver'],
  },
}

const HEADGEAR: Record<CharacterFaction, Record<CharacterKitId, readonly HeadgearKind[]>> = {
  elf: {
    line: ['circlet', 'hood', 'circlet'],
    light: ['hood', 'hood', 'circlet'],
    ranged: ['hood', 'circlet', 'hood'],
    heavy: ['strap', 'circlet', 'strap'],
    officer: ['crown', 'crown', 'circlet'],
    elite: ['crown', 'crown', 'crown'],
    civil: ['cap', 'none', 'cap'],
    bound: ['none', 'none', 'none'],
    hero: ['circlet', 'circlet', 'circlet'],
  },
  guard: {
    line: ['kettle', 'nasal', 'kettle'],
    light: ['cap', 'kettle', 'cap'],
    ranged: ['cap', 'kettle', 'cap'],
    heavy: ['strap', 'nasal', 'strap'],
    officer: ['crested', 'crested', 'nasal'],
    elite: ['greathelm', 'greathelm', 'crested'],
    civil: ['cap', 'none', 'cap'],
    bound: ['none', 'none', 'none'],
    hero: ['nasal', 'nasal', 'nasal'],
  },
  villain: {
    line: ['hornedHelm', 'boneMask', 'ragHood'],
    light: ['ragHood', 'boneMask', 'ragHood'],
    ranged: ['ragHood', 'cap', 'ragHood'],
    heavy: ['strap', 'boneMask', 'strap'],
    officer: ['hornedHelm', 'hornedHelm', 'boneMask'],
    elite: ['hornedHelm', 'boneMask', 'hornedHelm'],
    civil: ['cap', 'none', 'cap'],
    bound: ['none', 'none', 'none'],
    hero: ['hornedHelm', 'hornedHelm', 'hornedHelm'],
  },
}

const HAIR: Record<CharacterFaction, readonly HairKind[]> = {
  elf: ['long', 'long', 'crop'],
  guard: ['crop', 'crop', 'topknot'],
  villain: ['ragged', 'topknot', 'ragged'],
}

const CLOAK: Record<CharacterKitId, CloakKind> = {
  line: 'none',
  light: 'cape',
  ranged: 'none',
  heavy: 'none',
  officer: 'cloak',
  elite: 'mantle',
  civil: 'none',
  bound: 'rags',
  hero: 'cape',
}

const TRIM: Record<CharacterKitId, TrimKind> = {
  line: 'beltPouch',
  light: 'harness',
  ranged: 'quiver',
  heavy: 'belt',
  officer: 'sash',
  elite: 'belt',
  civil: 'pack',
  bound: 'rope',
  hero: 'beltPouch',
}

const OFFHAND: Record<CharacterFaction, Record<CharacterKitId, OffhandKind>> = {
  elf: {
    line: 'leafKite',
    light: 'none',
    ranged: 'none',
    heavy: 'none',
    officer: 'buckler',
    elite: 'leafKite',
    civil: 'none',
    bound: 'none',
    hero: 'leafKite',
  },
  guard: {
    line: 'heater',
    light: 'buckler',
    ranged: 'none',
    heavy: 'none',
    officer: 'heater',
    elite: 'heater',
    civil: 'none',
    bound: 'none',
    hero: 'heater',
  },
  villain: {
    line: 'roundSpiked',
    light: 'none',
    ranged: 'none',
    heavy: 'none',
    officer: 'roundSpiked',
    elite: 'roundSpiked',
    civil: 'none',
    bound: 'none',
    hero: 'roundSpiked',
  },
}

/** Two-handed weapons never carry an offhand, whatever the kit table says. */
const TWO_HANDED: ReadonlySet<WeaponKind> = new Set<WeaponKind>([
  'greatsword',
  'glaive',
  'maul',
  'staff',
  'bow',
  'spear',
])

// ---------------------------------------------------------------------------
// Proportions
// ---------------------------------------------------------------------------

/**
 * The frozen skeleton the old rig implied, kept so colliders, health-bar heights
 * and camera framing all still land where gameplay expects them.
 */
const BASE_PROPORTIONS: CharacterProportions = {
  shoulderY: 2.24,
  shoulderX: 0.62,
  hipY: 1.26,
  hipX: 0.28,
  torsoY: 1.84,
  headY: 2.78,
  upperArm: 0.58,
  forearm: 0.54,
  thigh: 0.61,
  shin: 0.61,
  chestWidth: 0.9,
  chestDepth: 0.58,
  waistScale: 0.88,
  headScale: 1,
  lean: 0,
  armSplay: 0.06,
  legSplay: 0.02,
  elbowRest: 0.16,
}

type ProportionPatch = Partial<CharacterProportions>

const FACTION_PROPORTIONS: Record<CharacterFaction, ProportionPatch> = {
  // Tallest and narrowest. The height comes from the legs and the neck, not from
  // a uniform scale, so an elf reads as long rather than as large.
  elf: {
    shoulderY: 2.34,
    shoulderX: 0.58,
    hipY: 1.34,
    torsoY: 1.92,
    headY: 2.9,
    upperArm: 0.6,
    forearm: 0.58,
    thigh: 0.65,
    shin: 0.65,
    chestWidth: 0.82,
    chestDepth: 0.54,
    waistScale: 0.82,
    headScale: 0.94,
    armSplay: 0.04,
  },
  // Squarest. Wide shoulders, short neck, low waist, feet planted.
  guard: {
    shoulderY: 2.2,
    shoulderX: 0.68,
    hipY: 1.24,
    hipX: 0.3,
    torsoY: 1.82,
    headY: 2.72,
    thigh: 0.6,
    shin: 0.6,
    chestWidth: 0.98,
    chestDepth: 0.62,
    waistScale: 0.92,
    headScale: 1,
    armSplay: 0.1,
    legSplay: 0.04,
  },
  // Hunched and long-armed, head carried forward of the shoulders.
  villain: {
    shoulderY: 2.16,
    shoulderX: 0.66,
    hipY: 1.2,
    torsoY: 1.78,
    headY: 2.64,
    upperArm: 0.62,
    forearm: 0.6,
    thigh: 0.58,
    shin: 0.58,
    chestWidth: 0.94,
    chestDepth: 0.6,
    waistScale: 0.9,
    headScale: 1.04,
    lean: 0.13,
    armSplay: 0.14,
    legSplay: 0.06,
    elbowRest: 0.24,
  },
}

const KIT_PROPORTIONS: Record<CharacterKitId, ProportionPatch> = {
  line: {},
  // A scout is narrow through the shoulders and leans into the walk.
  light: {
    shoulderX: 0.56,
    chestWidth: 0.8,
    chestDepth: 0.52,
    waistScale: 0.8,
    lean: 0.09,
    elbowRest: 0.24,
  },
  ranged: {
    shoulderX: 0.58,
    chestWidth: 0.82,
    chestDepth: 0.53,
    waistScale: 0.82,
    elbowRest: 0.3,
  },
  // A brute's shoulders sit above its ears and its arms hang past its knees.
  heavy: {
    shoulderY: 2.12,
    shoulderX: 0.82,
    hipY: 1.16,
    hipX: 0.34,
    torsoY: 1.74,
    headY: 2.5,
    upperArm: 0.66,
    forearm: 0.64,
    thigh: 0.56,
    shin: 0.56,
    chestWidth: 1.16,
    chestDepth: 0.74,
    waistScale: 1.02,
    headScale: 0.9,
    lean: 0.2,
    armSplay: 0.2,
    legSplay: 0.08,
    elbowRest: 0.3,
  },
  // Rank stands up straight and keeps its hands away from its body.
  officer: {
    shoulderY: 2.32,
    hipY: 1.32,
    torsoY: 1.9,
    headY: 2.88,
    thigh: 0.64,
    shin: 0.64,
    chestWidth: 0.92,
    waistScale: 0.84,
    lean: -0.04,
    armSplay: 0.14,
  },
  elite: {
    shoulderY: 2.3,
    shoulderX: 0.76,
    hipY: 1.28,
    torsoY: 1.88,
    headY: 2.84,
    thigh: 0.63,
    shin: 0.63,
    chestWidth: 1.08,
    chestDepth: 0.7,
    waistScale: 0.96,
    armSplay: 0.15,
  },
  // Small, round-shouldered, and standing slightly bow-legged from the work.
  civil: {
    shoulderY: 2.14,
    shoulderX: 0.55,
    hipY: 1.2,
    torsoY: 1.74,
    headY: 2.64,
    upperArm: 0.54,
    forearm: 0.5,
    thigh: 0.58,
    shin: 0.58,
    chestWidth: 0.84,
    chestDepth: 0.56,
    waistScale: 0.94,
    headScale: 1.02,
    lean: 0.1,
    armSplay: 0.08,
    legSplay: 0.06,
    elbowRest: 0.2,
  },
  bound: {
    shoulderY: 2.12,
    shoulderX: 0.54,
    hipY: 1.2,
    torsoY: 1.72,
    headY: 2.62,
    thigh: 0.58,
    shin: 0.58,
    chestWidth: 0.82,
    waistScale: 0.9,
    lean: 0.18,
    armSplay: -0.16,
    elbowRest: 0.72,
  },
  hero: {
    shoulderX: 0.66,
    chestWidth: 1.02,
    chestDepth: 0.62,
    waistScale: 0.86,
  },
}

function patchProportions(
  base: CharacterProportions,
  patch: ProportionPatch,
): CharacterProportions {
  return { ...base, ...patch }
}

/** Maps a gameplay role onto one of the nine silhouettes. */
export function characterKitForRole(role: string, player: boolean): CharacterKitId {
  if (player) return 'hero'
  return KIT_BY_ROLE[role] ?? 'line'
}

/**
 * Turns a faction, a role and one integer into a complete description of a person.
 *
 * `variant` is the only place chance enters, and it enters as an index rather than
 * as a float, so every distinct person the game can build is enumerable — which is
 * exactly what lets the geometry cache hold them all.
 */
export function resolveCharacterPlan(
  faction: CharacterFaction,
  role: string,
  variant: number,
  player = false,
): CharacterPlan {
  const kit = characterKitForRole(role, player)
  const index = ((Math.floor(variant) % CHARACTER_VARIANTS) + CHARACTER_VARIANTS) %
    CHARACTER_VARIANTS
  const torsoClass = TORSO_CLASS_BY_KIT[kit]
  const armour = ARMOUR_BY_KIT[kit]
  const proportions = patchProportions(
    patchProportions(BASE_PROPORTIONS, FACTION_PROPORTIONS[faction]),
    KIT_PROPORTIONS[kit],
  )
  const armed = kit !== 'civil'
  const weapon = WEAPONS[faction][kit][index]
  const headgear = HEADGEAR[faction][kit][index]
  const rawOffhand = OFFHAND[faction][kit]
  const offhand =
    kit === 'civil'
      ? 'bundle'
      : !armed || TWO_HANDED.has(weapon)
        ? 'none'
        : rawOffhand
  return {
    faction,
    kit,
    torsoClass,
    armour,
    proportions,
    headgear,
    hair: HAIR[faction][index],
    weapon,
    offhand,
    cloak: CLOAK[kit],
    trim: TRIM[kit],
    tint: index % 4,
    skinTone: (index + (faction === 'elf' ? 1 : faction === 'villain' ? 2 : 0)) % 4,
    hairTone: faction === 'elf' ? index % 2 : faction === 'guard' ? 2 : 3,
    mainHand: weapon === 'bow' ? 'left' : 'right',
    gloved: armour !== 'none',
    armed,
    boundArms: kit === 'bound',
  }
}

/**
 * The cache keys a plan needs. **Each key fully determines its geometry.**
 *
 * That is the whole contract of a shared cache and it is easy to get subtly wrong in
 * both directions. Too coarse and two different shapes share a buffer: `torsoClass`
 * collapses `line` with `hero` and `heavy` with `elite`, but those pairs have
 * different chest widths, and the limb builders take a *length* that varies by kit
 * even when the faction and the armour weight agree — so the torso keys by kit and
 * each limb carries its own length. Too fine and one shape gets several buffers:
 * a guard and a villain in light armour build byte-identical arms, so limbs and
 * cloaks key by the discriminant their builder actually reads, published by the
 * builder itself as a `*Variant` function rather than restated here.
 */
export function characterPartKeys(plan: CharacterPlan): CharacterPartKeys {
  const armour = plan.armour
  const p = plan.proportions
  const size = (value: number): string => value.toFixed(3)
  return {
    torso: `char-torso:${plan.faction}:${plan.kit}`,
    head: `char-head:${plan.faction}`,
    face: `char-face:${plan.faction}`,
    hair: plan.hair === 'none' ? null : `char-hair:${plan.hair}`,
    upperArm: `char-upper-arm:${upperArmVariant(plan.faction, armour)}:${size(p.upperArm)}`,
    forearm: `char-forearm:${forearmVariant(plan.faction, armour, plan.gloved)}:${size(
      p.forearm,
    )}`,
    hand: plan.gloved ? null : 'char-hand',
    thigh: `char-thigh:${thighVariant(plan.faction, armour)}:${size(p.thigh)}`,
    shin: `char-shin:${shinVariant(plan.faction, armour)}:${size(p.shin)}`,
    trim: plan.trim === 'none' ? null : `char-trim:${plan.trim}`,
    cloak: plan.cloak === 'none' ? null : `char-cloak:${cloakVariant(plan.faction, plan.cloak)}`,
    headgear: plan.headgear === 'none' ? null : `char-headgear:${plan.headgear}`,
    weaponHead: plan.armed ? `char-weapon:${plan.weapon}:head` : null,
    weaponGrip: plan.armed ? `char-weapon:${plan.weapon}:grip` : null,
    offhand: plan.offhand === 'none' ? null : `char-offhand:${plan.offhand}`,
  }
}

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

/**
 * The pivots a person is posed through, already wired to each other.
 *
 * A pivot is a *joint*, and a joint has two properties that are easy to state and
 * were both wrong here: it sits where the bones meet, and it hangs off the bone
 * above it. `head-pivot` had neither. It was built as a sibling of `torso-pivot`
 * at the actor's own origin — the ground between the feet — with the head placed
 * at `headY` above it. In the rest pose that is indistinguishable from a neck,
 * which is why it survived review: with every rotation at zero the head lands
 * exactly where the chest puts it, measured at **0.0000 for all 27 proportion
 * sets**.
 *
 * It comes apart the moment anything rotates. `animateActorCharacter` writes the
 * plan's own `lean` into `torso-pivot.rotation.x`, which swings the collar forward
 * through the whole 2.1–2.3 m lever arm from the ground to the shoulders, while a
 * head rooted at the feet on a *different* pivot does not move at all. Measured on
 * the sibling rig, as the distance between the head and where `torso-pivot` puts
 * it — a brute standing still, `lean` 0.20: **0.4992 m**. A captive: 0.4710. Any
 * villain, whose faction leans: 0.3430. A peasant: 0.2639. A head is 0.66 m deep,
 * so a standing brute wore its skull three-quarters of a head behind its own neck.
 * Walking adds the gait's forward lean and takes the worst case to **0.6835 m**.
 *
 * The roles whose `lean` is zero — an elf or guard soldier, minion, archer or
 * champion — measured 0.0000 standing and came apart only once they moved, which
 * is exactly the kind of partial symptom that gets a bug reported as "some of
 * them". The player was never affected at all, because `animateCharacter`, the
 * only pose pass the player gets, never writes `torso-pivot`'s transform; only
 * actors run `animateActorCharacter`. That asymmetry is the whole of "the NPC
 * heads are wrong and mine is fine", and it is why the fix is structural rather
 * than a nudge: no offset can be right for a displacement that is a rotation times
 * a lever arm and changes every frame.
 *
 * Hanging the head off the chest also makes six existing animation terms mean what
 * they say for the first time. `head-pivot`'s rotations are written as the *opposite
 * sign* of `torso-pivot`'s — the torso pitches `+forwardLean` and the head
 * `-forwardLean * 0.35`, the torso rolls `-turnLean * 0.16` and the head
 * `+turnLean * 0.06`, the torso takes `+idleWeightShift * 0.55` and the head
 * `-idleWeightShift * 0.2`. Partial counter-rotations only make sense against a
 * transform you inherit. As siblings they were not corrections at all; they were
 * the head and the chest leaning opposite ways in world space. So the animation was
 * already written for this hierarchy, and nothing in it needs to change.
 */
export interface CharacterSkeleton {
  /** The actor's own group. Every pivot below is already parented into it. */
  root: THREE.Group
  bodyPivot: THREE.Group
  torsoPivot: THREE.Group
  /** The neck. A child of {@link torsoPivot}, at the top of the spine. */
  headPivot: THREE.Group
  pelvisPivot: THREE.Group
  /**
   * Y for `head`, `face`, `hair` and `headgear`, in `head-pivot` space.
   *
   * Measured from the neck rather than from the ground, because that is where the
   * pivot now is. Read it from here rather than recomputing `headY - shoulderY` at
   * the call site: the two numbers have to move together, and a joint that has
   * drifted from the mesh it carries is the defect this type exists to prevent.
   */
  headY: number
}

/**
 * Builds the four load-bearing pivots for one person and parents them anatomically.
 *
 * Lives here rather than in the engine so the layout is reachable from a Node test
 * with no DOM — see {@link CharacterSkeleton} for what that test is for. It builds
 * groups and nothing else: no geometry, no materials, no cache.
 */
export function buildCharacterSkeleton(p: CharacterProportions): CharacterSkeleton {
  const root = new THREE.Group()
  const bodyPivot = new THREE.Group()
  bodyPivot.name = 'body-pivot'
  root.add(bodyPivot)
  const torsoPivot = new THREE.Group()
  torsoPivot.name = 'torso-pivot'
  bodyPivot.add(torsoPivot)
  const headPivot = new THREE.Group()
  headPivot.name = 'head-pivot'
  // The base of the neck, which is the shoulder line — the same height the arms
  // hang from, and within 0.09 of where every head mesh's neck stub ends.
  headPivot.position.y = p.shoulderY
  torsoPivot.add(headPivot)
  const pelvisPivot = new THREE.Group()
  pelvisPivot.name = 'pelvis-pivot'
  bodyPivot.add(pelvisPivot)
  return {
    root,
    bodyPivot,
    torsoPivot,
    headPivot,
    pelvisPivot,
    headY: p.headY - p.shoulderY,
  }
}

// ---------------------------------------------------------------------------
// Local construction helpers
// ---------------------------------------------------------------------------

/** A tapered box with its transform already baked in. */
function block(
  options: TaperedBoxOptions,
  place: TransformOptions = {},
): THREE.BufferGeometry {
  return transformed(taperedBox(options), place)
}

/** A wedge: a box whose top face has collapsed to a ridge along X. */
function wedge(
  width: number,
  height: number,
  depth: number,
  place: TransformOptions = {},
): THREE.BufferGeometry {
  return block(
    { width, height, depth, topScale: 0.92, topDepthScale: 0.06, bevel: 0 },
    place,
  )
}

/** A spike: a four-sided pyramid pointing along +Y. */
function spike(
  radius: number,
  height: number,
  place: TransformOptions = {},
): THREE.BufferGeometry {
  return transformed(
    loft({
      profile: polygonProfile(radius, 4, Math.PI / 4),
      sections: [
        { y: 0, scaleX: 1 },
        { y: height * 0.45, scaleX: 0.52 },
        { y: height, scaleX: 0.02 },
      ],
      name: 'spike',
    }),
    place,
  )
}

/** A flat plate cut from a drawn outline. Used for anything armour-shaped. */
function plate(
  points: readonly Vec2Like[],
  depth: number,
  place: TransformOptions = {},
  bevel = 0.012,
): THREE.BufferGeometry {
  return transformed(extrudeProfile(points, { depth, bevelSize: bevel }), place)
}

function mirroredPair(
  build: (side: number) => THREE.BufferGeometry,
): THREE.BufferGeometry[] {
  return [build(-1), build(1)]
}

const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1)
const MIRROR_Z = new THREE.Matrix4().makeScale(1, 1, -1)

const WIND_A = new THREE.Vector3()
const WIND_B = new THREE.Vector3()
const WIND_C = new THREE.Vector3()
const WIND_EDGE_ONE = new THREE.Vector3()
const WIND_EDGE_TWO = new THREE.Vector3()
const WIND_FACE = new THREE.Vector3()
const WIND_VERTEX = new THREE.Vector3()

/** Reverses one triangle's winding in place, indexed or not. */
function reverseTriangle(geometry: THREE.BufferGeometry, triangle: number): void {
  const index = geometry.getIndex()
  if (index) {
    const array = index.array
    const swap = array[triangle + 1]
    array[triangle + 1] = array[triangle + 2]
    array[triangle + 2] = swap
    return
  }
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name)
    const array = attribute.array as unknown as { [key: number]: number }
    const size = attribute.itemSize
    for (let component = 0; component < size; component += 1) {
      const a = (triangle + 1) * size + component
      const b = (triangle + 2) * size + component
      const swap = array[a]
      array[a] = array[b]
      array[b] = swap
    }
  }
}

/** Reverses every triangle's winding in place, indexed or not. */
function reverseWinding(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const index = geometry.getIndex()
  const count = index ? index.count : geometry.getAttribute('position').count
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    reverseTriangle(geometry, triangle)
  }
  if (index) index.needsUpdate = true
  else {
    for (const name of Object.keys(geometry.attributes)) {
      geometry.getAttribute(name).needsUpdate = true
    }
  }
  return geometry
}

/**
 * Triangles {@link ensureOutwardWinding} has had to reverse since the last reset.
 *
 * A silent runtime fixup does not protect an invariant — it destroys the evidence
 * that the invariant broke. `ensureOutwardWinding` runs inside `loft()` and inside
 * `finish()`, which is to say inside every builder in this module, so any downstream
 * assertion that winding agrees with normals is answering a question the builder has
 * already forced. This counter is the evidence surviving the repair: the repair still
 * happens, so a regression cannot ship broken art, and the count still rises, so a
 * regression cannot ship unnoticed either.
 *
 * Measured Wave 4, across all 1235 parts the game can build — every faction x role x
 * variant, every headgear and weapon the tables do not reach, the four beasts, the
 * deer, the bird, the ox, the wagon, the harness and the rope: **0 of 196,705
 * triangles reversed.** The repair is already a no-op, which its own docblock
 * predicted would happen "the day the kit itself is corrected". The foundation
 * corrected `loftProfile` and nothing recorded that this had become dead weight.
 *
 * It is kept rather than deleted because deleting it removes the guard as well as
 * the dead code, and this counter is what makes the guard honest.
 *
 * Validated by mutation, because a counter that reads 0 is the same shape as a counter
 * that cannot count. With `loftProfile`'s normals negated — the regression this repair
 * was written for — one torso reports **444** and one head **248**, and the roster
 * assertion in `tests/characterArt.test.ts` goes red naming the figure. On the real
 * tree both read 0.
 */
let windingRepairsMade = 0

/** How many triangles the winding repair has reversed. See {@link windingRepairsMade}. */
export function characterWindingRepairs(): number {
  return windingRepairsMade
}

/** Zeroes the repair counter, so a test can attribute repairs to its own builds. */
export function resetCharacterWindingRepairs(): void {
  windingRepairsMade = 0
}

/**
 * Makes every triangle's winding agree with its own normals.
 *
 * `loftProfile` — which is most of this module, directly or through `taperedBox` —
 * *used to* emit triangles wound the opposite way round from the normals it writes.
 * A `FrontSide` material then draws the *inside* of the far wall, and, far more
 * visibly, the `BackSide` ink shell ends up in front of its own source and paints
 * the whole silhouette solid ink.
 *
 * The repair belongs here rather than in `GeometryKit`, which this pass does not
 * own. It works triangle by triangle rather than flipping whole geometries,
 * because a merged part routinely mixes builders that disagree with each other —
 * `tubeAlongPoints` winds its walls one way and its caps the other — and a
 * majority vote would fix one and break the other. It is a measurement, so it is
 * idempotent and becomes a no-op the day the kit itself is corrected.
 *
 * **That day has arrived**, and the past tense above is deliberate. Wave 4 measured
 * every part this module can build with the repair disabled and found 0 inside-out
 * triangles in 196,705. Two things follow. The first is that no assertion anywhere
 * can distinguish this module's builders from the repair's output, so the winding
 * tests in `tests/characterArt.test.ts` were never testing this module. The second
 * is that the fixup is now purely a tripwire that swallows its own alarm — hence
 * {@link windingRepairsMade}, which is asserted to be zero rather than assumed.
 */
function ensureOutwardWinding(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (!position || !normal) return geometry
  const index = geometry.getIndex()
  const count = index ? index.count : position.count
  let reversed = 0
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
    if (WIND_FACE.dot(WIND_VERTEX) >= 0) continue
    reverseTriangle(geometry, triangle)
    reversed += 1
  }
  if (reversed === 0) return geometry
  windingRepairsMade += reversed
  if (index) index.needsUpdate = true
  else {
    for (const name of Object.keys(geometry.attributes)) {
      geometry.getAttribute(name).needsUpdate = true
    }
  }
  return geometry
}

/**
 * Mirrors a finished part across X, winding and all.
 *
 * Baking a mirror into a buffer is a trap: three.js flips the face winding for a
 * *mesh* whose world matrix has a negative determinant, but a baked mirror leaves
 * the object matrix positive, so every triangle ends up back-facing and the part
 * renders hollow. Reversing the winding by hand is the whole fix — `applyMatrix4`
 * already handles the normals, because the normal matrix of a pure mirror is the
 * mirror itself.
 *
 * `transformed()` has since grown the same repair for a negative scale, but this is
 * a raw `applyMatrix4` and is not routed through it, so the reversal below is still
 * load-bearing. Do not delete it on the strength of that fix; either keep this as
 * it is, or replace the whole body with a `transformed()` call.
 */
function mirrorX(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.applyMatrix4(MIRROR_X)
  return reverseWinding(geometry)
}

/** The same, across Z, and with the same warning. For fore-and-aft pairs. */
function mirrorZ(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.applyMatrix4(MIRROR_Z)
  return reverseWinding(geometry)
}

/**
 * `loftProfile` with its section order and its winding both made safe.
 *
 * Two traps, and the limbs fell into the first one. `loftProfile` takes its
 * sections **bottom to top**: hand a hanging limb its sections in the order they
 * are read — shoulder first, wrist last — and the whole part comes out with its
 * normals *and* its winding reversed. It then lights from the inside and its ink
 * shell extrudes inward and vanishes, which is subtle enough to survive a
 * screenshot. Reversing a descending list is unambiguous, so this does it rather
 * than making every call site remember.
 *
 * The second trap is the kit's own winding, which `ensureOutwardWinding` measures
 * and repairs. `finish` repairs the merged result too, but a part that is already
 * self-consistent is far easier to reason about when it is going to be transformed
 * or mirrored before it gets there.
 */
function loft(options: LoftOptions): THREE.BufferGeometry {
  const sections = options.sections
  const descending =
    sections.length > 1 && sections[0].y > sections[sections.length - 1].y
  return ensureOutwardWinding(
    loftProfile(
      descending ? { ...options, sections: [...sections].reverse() } : options,
    ),
  )
}

/**
 * A left/right pair from one right-hand builder.
 *
 * Use this whenever the two sides are genuine mirror images — a horn, an antler,
 * a swept pauldron — rather than the same shape at two positions.
 */
function mirroredPairX(
  build: () => THREE.BufferGeometry,
): THREE.BufferGeometry[] {
  return [mirrorX(build()), build()]
}

/**
 * A fore/aft pair from one +Z builder.
 *
 * The wagon runs along X, so its two sides are separated on **Z**, not on X.
 * Mirroring those across X moves a part to the other end of the cart instead of
 * to the other side of it, and mirrors an X-centred part onto itself.
 */
function mirroredPairZ(
  build: () => THREE.BufferGeometry,
): THREE.BufferGeometry[] {
  return [mirrorZ(build()), build()]
}

function finish(
  parts: readonly THREE.BufferGeometry[],
  name: string,
): THREE.BufferGeometry {
  // The winding repair runs once, on the finished part, because a merge routinely
  // combines builders that disagree with each other about which way round a
  // triangle goes. Outline normals are baked afterwards so the ink shell reads the
  // corrected geometry.
  return bakeOutlineNormals(ensureOutwardWinding(mergeAll(parts, { name })))
}

// ---------------------------------------------------------------------------
// Torso
// ---------------------------------------------------------------------------

const TORSO_TOP = 0.74
const TORSO_BOTTOM = -0.66

function torsoCoreSections(plan: CharacterPlan): LoftSection[] {
  const waist = plan.proportions.waistScale
  const heavy = plan.torsoClass === 'heavy'
  const chestSwell = heavy ? 1.06 : plan.torsoClass === 'light' ? 0.96 : 1
  return [
    { y: TORSO_BOTTOM, scaleX: waist * 1.02, scaleZ: waist * 1.02 },
    { y: -0.5, scaleX: waist * 1.05, scaleZ: waist * 1.04 },
    // The belt line is the narrowest point; everything above it flares.
    { y: -0.32, scaleX: waist, scaleZ: waist },
    { y: -0.12, scaleX: waist * 1.06, scaleZ: waist * 1.04 },
    { y: 0.16, scaleX: 0.98, scaleZ: 0.98 },
    { y: 0.44, scaleX: chestSwell, scaleZ: 0.95 },
    { y: 0.6, scaleX: chestSwell * 0.9, scaleZ: 0.86 },
    { y: TORSO_TOP, scaleX: 0.4, scaleZ: 0.42 },
  ]
}

function elfPauldron(reach: number): THREE.BufferGeometry {
  // A blade that sweeps up and back off the shoulder rather than out from it — the
  // elves' height has to come from the vertical, or they end up broader than a
  // palace guard, which is the one silhouette read that must never invert.
  return plate(
    [
      { x: 0, y: -0.2 },
      { x: 0.16, y: -0.15 },
      { x: 0.24, y: 0.12 },
      { x: 0.19, y: 0.4 },
      { x: 0.09, y: 0.19 },
      { x: 0.01, y: 0.02 },
    ],
    0.34,
    {
      position: { x: reach - 0.08, y: 0.44, z: 0 },
      rotation: { x: 0, y: 0, z: 0.12 },
    },
  )
}

function guardPauldron(side: number, reach: number): THREE.BufferGeometry {
  const cap = block(
    {
      width: 0.34,
      height: 0.2,
      depth: 0.44,
      topScale: 0.72,
      topDepthScale: 0.86,
      bevel: 0.05,
    },
    { position: { x: side * reach, y: 0.46, z: 0 }, rotation: { x: 0, y: 0, z: -side * 0.22 } },
  )
  const lame = block(
    { width: 0.36, height: 0.11, depth: 0.42, topScale: 1.02, bevel: 0.04 },
    { position: { x: side * (reach + 0.02), y: 0.3, z: 0 }, rotation: { x: 0, y: 0, z: -side * 0.3 } },
  )
  return mergeAll([cap, lame], { name: 'guard-pauldron' })
}

function villainPauldron(side: number, reach: number): THREE.BufferGeometry {
  // Asymmetric on purpose: one shoulder is armoured to the ear, the other is not.
  const big = side > 0
  const pad = block(
    {
      width: big ? 0.42 : 0.24,
      height: big ? 0.3 : 0.16,
      depth: big ? 0.46 : 0.3,
      topScale: 0.6,
      bevel: 0.04,
      shearX: side * 0.06,
    },
    {
      position: { x: side * (reach + (big ? 0.05 : 0)), y: big ? 0.5 : 0.44, z: 0 },
      rotation: { x: 0, y: 0, z: -side * 0.24 },
    },
  )
  if (!big) return pad
  const spikes = [-0.13, 0.05, 0.22].map((z) =>
    spike(0.055, 0.24, {
      position: { x: side * (reach + 0.13), y: 0.6, z },
      rotation: { x: 0, y: 0, z: -side * 0.5 },
    }),
  )
  return mergeAll([pad, ...spikes], { name: 'villain-pauldron' })
}

function torsoSkirt(plan: CharacterPlan): THREE.BufferGeometry[] {
  const width = plan.proportions.chestWidth
  const depth = plan.proportions.chestDepth
  if (plan.armour === 'none') {
    // A smock: one soft panel that widens to the knee, hem cut straight.
    return [
      block(
        {
          width: width * 0.92,
          height: 0.4,
          depth: depth * 0.94,
          topScale: 0.94,
          bottomScale: 1.16,
          bottomDepthScale: 1.12,
          bevel: 0.05,
        },
        { position: { x: 0, y: -0.82, z: 0 } },
      ),
    ]
  }
  if (plan.faction === 'guard') {
    // Tassets: three plates that hang free, which is what makes plate read as plate.
    return [-1, 0, 1].map((slot) =>
      block(
        {
          width: slot === 0 ? width * 0.44 : width * 0.34,
          height: 0.34,
          depth: slot === 0 ? depth * 0.5 : depth * 0.72,
          bottomScale: 0.86,
          bevel: 0.03,
        },
        {
          position: {
            x: slot * width * 0.36,
            y: -0.84,
            z: slot === 0 ? depth * 0.34 : 0,
          },
          rotation: { x: 0, y: 0, z: -slot * 0.1 },
        },
      ),
    )
  }
  if (plan.faction === 'elf') {
    // A coat that splits into two tails, front panels shorter than the back.
    return mirroredPairX(() =>
      plate(
        [
          { x: 0, y: 0 },
          { x: 0.3, y: 0 },
          { x: 0.34, y: -0.34 },
          { x: 0.2, y: -0.62 },
          { x: 0.02, y: -0.4 },
        ],
        depth * 0.9,
        { position: { x: width * 0.12, y: -0.62, z: 0 } },
      ),
    )
  }
  // A hem that has been cut to pieces and never repaired.
  return [0, 1, 2, 3].map((slot) => {
    const angle = (slot / 4) * Math.PI * 2 + Math.PI / 4
    return block(
      {
        width: width * 0.34,
        height: 0.26 + (slot % 2) * 0.16,
        depth: 0.08,
        bottomScale: 0.34,
        bevel: 0,
      },
      {
        position: {
          x: Math.cos(angle) * width * 0.42,
          y: -0.78 - (slot % 2) * 0.08,
          z: Math.sin(angle) * depth * 0.56,
        },
        rotation: { x: 0, y: -angle, z: (slot % 2 === 0 ? 1 : -1) * 0.12 },
      },
    )
  })
}

function torsoCollar(plan: CharacterPlan): THREE.BufferGeometry[] {
  const depth = plan.proportions.chestDepth
  if (plan.faction === 'elf') {
    // A standing collar that frames the jaw and adds height without a helmet.
    return [
      block(
        {
          width: 0.42,
          height: 0.34,
          depth: depth * 0.66,
          topScale: 1.2,
          topDepthScale: 1.16,
          bevel: 0.04,
        },
        { position: { x: 0, y: 0.68, z: -0.02 } },
      ),
    ]
  }
  if (plan.faction === 'guard') {
    return [
      block(
        { width: 0.5, height: 0.14, depth: depth * 0.78, topScale: 0.86, bevel: 0.04 },
        { position: { x: 0, y: 0.62, z: 0 } },
      ),
    ]
  }
  // A fur-and-rag mantle, thicker at the back than the front.
  return [
    block(
      {
        width: 0.72,
        height: 0.22,
        depth: depth * 1.02,
        topScale: 0.78,
        bevel: 0.06,
        shearZ: -0.05,
      },
      { position: { x: 0, y: 0.6, z: -0.04 } },
    ),
  ]
}

function torsoChestPiece(plan: CharacterPlan): THREE.BufferGeometry[] {
  const width = plan.proportions.chestWidth
  const depth = plan.proportions.chestDepth
  if (plan.armour === 'none') {
    // An apron with a strap, which is the whole story a peasant torso has to tell.
    return [
      plate(
        [
          { x: -0.2, y: -0.5 },
          { x: 0.2, y: -0.5 },
          { x: 0.26, y: 0.16 },
          { x: 0.1, y: 0.3 },
          { x: -0.1, y: 0.3 },
          { x: -0.26, y: 0.16 },
        ],
        0.06,
        { position: { x: 0, y: -0.06, z: depth * 0.52 } },
      ),
    ]
  }
  if (plan.faction === 'guard') {
    // A sternum ridge. It catches the key light and splits the chest in two, which
    // is the cheapest way to say "plate" at thirty metres.
    const ridge = wedge(0.14, 0.62, 0.16, {
      position: { x: 0, y: 0.22, z: depth * 0.5 },
      rotation: { x: Math.PI / 2, y: 0, z: 0 },
    })
    const bands = [-0.06, -0.26, -0.46].map((y) =>
      block(
        { width: width * 0.92, height: 0.06, depth: depth * 0.94, topScale: 1.04, bevel: 0.02 },
        { position: { x: 0, y, z: 0 } },
      ),
    )
    return [ridge, ...bands]
  }
  if (plan.faction === 'elf') {
    // Leaf scale: four overlapping rows, each narrower than the one below.
    return [0, 1, 2, 3].map((row) =>
      block(
        {
          width: width * (0.94 - row * 0.06),
          height: 0.15,
          depth: depth * (0.98 - row * 0.04),
          topScale: 0.88,
          topDepthScale: 0.9,
          bevel: 0.05,
        },
        { position: { x: 0, y: -0.34 + row * 0.22, z: 0.01 } },
      ),
    )
  }
  // Scavenged plates, lashed on crooked.
  return [
    plate(
      [
        { x: -0.26, y: -0.3 },
        { x: 0.22, y: -0.36 },
        { x: 0.3, y: 0.22 },
        { x: -0.18, y: 0.3 },
      ],
      0.08,
      { position: { x: -0.04, y: 0.12, z: depth * 0.5 }, rotation: { x: 0, y: 0, z: 0.1 } },
    ),
    plate(
      [
        { x: -0.18, y: -0.24 },
        { x: 0.2, y: -0.2 },
        { x: 0.16, y: 0.18 },
        { x: -0.22, y: 0.14 },
      ],
      0.07,
      { position: { x: 0.14, y: -0.3, z: depth * 0.48 }, rotation: { x: 0, y: 0, z: -0.18 } },
    ),
  ]
}

/** Chest, waist, shoulders, collar, skirt and pauldrons, merged into one buffer. */
export function buildTorso(plan: CharacterPlan): THREE.BufferGeometry {
  const p = plan.proportions
  const bevel = plan.faction === 'guard' ? 0.09 : plan.faction === 'elf' ? 0.14 : 0.11
  const core = loft({
    profile: rectProfile(p.chestWidth, p.chestDepth, bevel),
    sections: torsoCoreSections(plan),
    name: 'torso-core',
  })
  const reach = p.chestWidth * 0.5 + 0.09
  const pauldrons =
    plan.armour === 'none'
      ? []
      : plan.faction === 'elf'
      ? mirroredPairX(() => elfPauldron(reach))
        : plan.faction === 'guard'
          ? mirroredPair((side) => guardPauldron(side, reach))
          : mirroredPair((side) => villainPauldron(side, reach))
  return finish(
    [
      core,
      ...torsoCollar(plan),
      ...torsoChestPiece(plan),
      ...torsoSkirt(plan),
      ...pauldrons,
    ],
    'character-torso',
  )
}

// ---------------------------------------------------------------------------
// Torso trim: belts, packs, quivers, ropes
// ---------------------------------------------------------------------------

/** The leather layer. One buffer, one material, culled with the detail LOD. */
export function buildTorsoTrim(trim: TrimKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const belt = (): void => {
    parts.push(
      block(
        { width: 0.96, height: 0.13, depth: 0.66, bevel: 0.04 },
        { position: { x: 0, y: -0.33, z: 0 } },
      ),
      block(
        { width: 0.17, height: 0.17, depth: 0.09, bevel: 0.02 },
        { position: { x: 0, y: -0.33, z: 0.34 } },
      ),
    )
  }
  if (trim === 'belt' || trim === 'beltPouch' || trim === 'quiver' || trim === 'harness') {
    belt()
  }
  if (trim === 'beltPouch') {
    parts.push(
      block(
        { width: 0.2, height: 0.24, depth: 0.14, bottomScale: 0.86, bevel: 0.03 },
        { position: { x: -0.36, y: -0.46, z: 0.24 } },
      ),
      block(
        { width: 0.14, height: 0.18, depth: 0.11, bevel: 0.03 },
        { position: { x: 0.34, y: -0.44, z: 0.26 } },
      ),
    )
  }
  if (trim === 'harness' || trim === 'quiver') {
    // A strap across the chest. Two crossing bands read as webbing from any angle.
    parts.push(
      block(
        { width: 0.13, height: 0.92, depth: 0.06 },
        { position: { x: 0.02, y: 0.12, z: 0.31 }, rotation: { x: 0, y: 0, z: 0.42 } },
      ),
      block(
        { width: 0.13, height: 0.92, depth: 0.06 },
        { position: { x: 0.02, y: 0.12, z: -0.31 }, rotation: { x: 0, y: 0, z: 0.42 } },
      ),
    )
  }
  if (trim === 'quiver') {
    const tube = transformed(
      loft({
        profile: polygonProfile(0.11, 7),
        sections: [
          { y: -0.3, scaleX: 0.86 },
          { y: 0.12, scaleX: 1 },
          { y: 0.32, scaleX: 1.04 },
        ],
        name: 'quiver',
      }),
      { position: { x: -0.24, y: 0.14, z: -0.32 }, rotation: { x: 0.16, y: 0, z: -0.42 } },
    )
    parts.push(tube)
    for (const offset of [-0.05, 0, 0.05]) {
      parts.push(
        block(
          { width: 0.035, height: 0.3, depth: 0.035 },
          {
            position: { x: -0.4 + offset, y: 0.5, z: -0.36 + offset * 1.4 },
            rotation: { x: 0.16, y: 0, z: -0.42 },
          },
        ),
        // Fletching, three flat vanes, because an empty tube reads as a thermos.
        block(
          { width: 0.02, height: 0.12, depth: 0.09 },
          {
            position: { x: -0.44 + offset, y: 0.6, z: -0.38 + offset * 1.4 },
            rotation: { x: 0.16, y: 0, z: -0.42 },
          },
        ),
      )
    }
  }
  if (trim === 'pack') {
    parts.push(
      block(
        {
          width: 0.5,
          height: 0.46,
          depth: 0.3,
          topScale: 0.84,
          bottomScale: 0.94,
          bevel: 0.06,
        },
        { position: { x: 0, y: 0.06, z: -0.44 } },
      ),
      block(
        { width: 0.1, height: 0.7, depth: 0.06 },
        { position: { x: -0.24, y: 0.18, z: 0.02 }, rotation: { x: 0, y: 0, z: -0.14 } },
      ),
      block(
        { width: 0.1, height: 0.7, depth: 0.06 },
        { position: { x: 0.24, y: 0.18, z: 0.02 }, rotation: { x: 0, y: 0, z: 0.14 } },
      ),
      // A bedroll lashed across the top of the pack.
      transformed(
        loft({
          profile: polygonProfile(0.09, 6),
          sections: [
            { y: -0.26, scaleX: 0.9 },
            { y: 0.26, scaleX: 0.9 },
          ],
          name: 'bedroll',
        }),
        { position: { x: 0, y: 0.3, z: -0.46 }, rotation: { x: 0, y: 0, z: Math.PI / 2 } },
      ),
    )
  }
  if (trim === 'sash') {
    parts.push(
      plate(
        [
          { x: -0.14, y: -0.52 },
          { x: 0.14, y: -0.56 },
          { x: 0.2, y: 0.46 },
          { x: -0.08, y: 0.5 },
        ],
        0.05,
        { position: { x: 0.08, y: 0, z: 0.3 }, rotation: { x: 0, y: 0, z: -0.24 } },
      ),
      block(
        { width: 0.9, height: 0.16, depth: 0.62, bevel: 0.05 },
        { position: { x: 0, y: -0.36, z: 0 } },
      ),
      block(
        { width: 0.22, height: 0.2, depth: 0.1, bevel: 0.03 },
        { position: { x: 0.06, y: -0.36, z: 0.33 } },
      ),
    )
  }
  if (trim === 'rope') {
    // Wrists are roped in `buildForearm`; this is the loop left round the waist.
    for (const y of [-0.3, -0.38]) {
      parts.push(
        transformed(
          latheProfile(
            [
              { x: 0.42, y: -0.03 },
              { x: 0.47, y: 0 },
              { x: 0.42, y: 0.03 },
            ],
            { segments: 10, name: 'rope-loop' },
          ),
          { position: { x: 0, y, z: 0 }, scale: { x: 1.02, y: 1, z: 0.72 } },
        ),
      )
    }
  }
  if (parts.length === 0) {
    parts.push(block({ width: 0.9, height: 0.1, depth: 0.6, bevel: 0.03 }, { position: { x: 0, y: -0.33, z: 0 } }))
  }
  return finish(parts, `character-trim:${trim}`)
}

/**
 * The cord between a captive's wrists.
 *
 * Built at a half-width of `0.5` and scaled to the wearer's shoulders on attach, so
 * one buffer serves every body type. The two loops are what read at distance — a
 * bare cord between two fists is invisible against a torso — and the slack between
 * them is what says the hands are tied *together* rather than merely held low.
 */
export function buildWristRope(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (const side of [-1, 1]) {
    parts.push(
      transformed(
        latheProfile(
          [
            { x: 0.12, y: -0.04 },
            { x: 0.155, y: 0 },
            { x: 0.12, y: 0.04 },
          ],
          { segments: 9, name: 'wrist-loop' },
        ),
        { position: { x: side * 0.5, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 0.86 } },
      ),
    )
  }
  // The cord itself, sagging a little between the wrists.
  parts.push(
    tubeAlongPoints(
      [
        { x: -0.44, y: 0, z: 0.02 },
        { x: -0.18, y: -0.07, z: 0.05 },
        { x: 0.18, y: -0.07, z: 0.05 },
        { x: 0.44, y: 0, z: 0.02 },
      ],
      { radius: 0.036, radialSegments: 4, tubularSegments: 8, name: 'wrist-cord' },
    ),
  )
  return finish(parts, 'wrist-rope')
}

// ---------------------------------------------------------------------------
// Head, face, hair
// ---------------------------------------------------------------------------

/**
 * A skull with a face on it.
 *
 * The face is built, not painted: spec 08 forbids vertex colours on character
 * materials, and a flat mask would read as a mask. A brow that stands proud of the
 * sockets, a nose with a bridge, cheekbones and a jaw give the banded shader three
 * planes to separate, which is what makes a head read as a head at ten metres.
 */
export function buildHead(faction: CharacterFaction): THREE.BufferGeometry {
  const elf = faction === 'elf'
  const villain = faction === 'villain'
  const width = elf ? 0.6 : villain ? 0.68 : 0.66
  const depth = elf ? 0.62 : 0.66
  const skull = loft({
    profile: rectProfile(width, depth, elf ? 0.16 : 0.13),
    sections: [
      // Neck. Short on a guard, long on an elf, thick on a villain.
      { y: -0.5, scaleX: elf ? 0.34 : 0.42, scaleZ: elf ? 0.36 : 0.44 },
      { y: -0.34, scaleX: elf ? 0.36 : 0.46, scaleZ: elf ? 0.38 : 0.46 },
      // Jaw.
      { y: -0.24, scaleX: elf ? 0.62 : 0.78, scaleZ: 0.8, offsetZ: villain ? 0.05 : 0.02 },
      { y: -0.1, scaleX: elf ? 0.84 : 0.95, scaleZ: 0.94, offsetZ: villain ? 0.03 : 0.01 },
      // Cheekbones — the widest point of the face, always above the jaw.
      { y: 0.04, scaleX: 1, scaleZ: 1 },
      { y: 0.18, scaleX: 0.98, scaleZ: 0.98 },
      // Cranium.
      { y: 0.34, scaleX: 0.86, scaleZ: 0.88 },
      { y: 0.46, scaleX: 0.52, scaleZ: 0.56 },
    ],
    name: 'skull',
  })
  const parts: THREE.BufferGeometry[] = [skull]

  // Brow ridge. It overhangs the sockets, so the eyes sit in shadow.
  parts.push(
    block(
      {
        width: width * 0.94,
        height: 0.1,
        depth: 0.16,
        topScale: 0.84,
        bevel: 0.02,
        shearZ: villain ? 0.05 : 0.02,
      },
      { position: { x: 0, y: 0.14, z: depth * 0.44 }, rotation: { x: villain ? -0.16 : -0.08, y: 0, z: 0 } },
    ),
  )
  // Nose: a bridge and a tip, angled differently per faction.
  parts.push(
    wedge(0.13, 0.26, 0.17, {
      position: { x: 0, y: 0.01, z: depth * 0.48 },
      rotation: { x: Math.PI / 2 - (elf ? 0.16 : 0.06), y: 0, z: 0 },
    }),
  )
  // Chin.
  parts.push(
    block(
      {
        width: elf ? 0.2 : 0.3,
        height: 0.14,
        depth: 0.14,
        topScale: 1.3,
        bevel: 0.03,
      },
      { position: { x: 0, y: -0.22, z: depth * (villain ? 0.44 : 0.38) } },
    ),
  )
  // Cheekbones.
  parts.push(
    ...mirroredPair((side) =>
      block(
        { width: 0.14, height: 0.09, depth: 0.2, topScale: 0.7, bevel: 0.02 },
        {
          position: { x: side * width * 0.4, y: 0.02, z: depth * 0.3 },
          rotation: { x: 0, y: -side * 0.3, z: 0 },
        },
      ),
    ),
  )
  // Ears. Elves get long swept blades; the other two get a lobe.
  parts.push(
    ...mirroredPairX(() =>
      elf
        ? plate(
            [
              { x: 0, y: -0.09 },
              { x: 0.06, y: -0.05 },
              { x: 0.3, y: 0.24 },
              { x: 0.04, y: 0.09 },
            ],
            0.045,
            {
              position: { x: width * 0.48, y: 0.06, z: -0.02 },
              rotation: { x: 0, y: -Math.PI / 2, z: 0 },
            },
          )
        : block(
            { width: 0.06, height: 0.16, depth: 0.11, topScale: 0.8, bevel: 0.02 },
            { position: { x: width * 0.5, y: 0.04, z: -0.02 } },
          ),
    ),
  )
  if (villain) {
    // Lower tusks. They belong to the head rather than the face mesh so they stay
    // bone-coloured with the skin instead of turning into two black pegs.
    parts.push(
      ...mirroredPair((side) =>
        spike(0.035, 0.15, {
          position: { x: side * 0.13, y: -0.19, z: depth * 0.4 },
          rotation: { x: 0.2, y: 0, z: side * 0.14 },
        }),
      ),
    )
    // Brow spur.
    parts.push(spike(0.05, 0.11, { position: { x: 0, y: 0.22, z: depth * 0.38 }, rotation: { x: -0.6, y: 0, z: 0 } }))
  }
  return finish(parts, `character-head:${faction}`)
}

/** Eyes and mouth: the dark layer, drawn only inside the detail distance. */
export function buildFace(faction: CharacterFaction): THREE.BufferGeometry {
  const elf = faction === 'elf'
  const villain = faction === 'villain'
  const depth = elf ? 0.62 : 0.66
  const eyeZ = depth * 0.41
  const parts: THREE.BufferGeometry[] = []
  parts.push(
    ...mirroredPair((side) =>
      block(
        {
          width: elf ? 0.13 : 0.11,
          height: elf ? 0.05 : 0.06,
          depth: 0.05,
          bevel: 0.01,
          shearX: side * 0.02,
        },
        {
          position: { x: side * (elf ? 0.15 : 0.14), y: 0.04, z: eyeZ },
          rotation: { x: 0, y: -side * 0.24, z: side * (elf ? -0.22 : villain ? 0.2 : 0) },
        },
      ),
    ),
  )
  // Mouth: a slot, wider and lower on a villain.
  parts.push(
    block(
      { width: villain ? 0.24 : 0.17, height: 0.035, depth: 0.05 },
      { position: { x: 0, y: -0.14, z: depth * 0.42 } },
    ),
  )
  // Brow hairs sit on the dark layer so they read even under a helmet's shadow.
  parts.push(
    ...mirroredPair((side) =>
      block(
        { width: 0.15, height: 0.035, depth: 0.05 },
        {
          position: { x: side * 0.15, y: 0.115, z: depth * 0.43 },
          rotation: { x: 0, y: 0, z: side * (villain ? -0.34 : elf ? 0.2 : 0.1) },
        },
      ),
    ),
  )
  return finish(parts, `character-face:${faction}`)
}

export function buildHair(kind: HairKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  if (kind === 'long') {
    parts.push(
      block(
        { width: 0.62, height: 0.5, depth: 0.5, topScale: 0.94, bottomScale: 0.86, bevel: 0.08 },
        { position: { x: 0, y: 0.2, z: -0.06 } },
      ),
      // Two locks down the back, one longer than the other.
      block(
        { width: 0.24, height: 0.6, depth: 0.14, bottomScale: 0.5, bevel: 0.04 },
        { position: { x: -0.16, y: -0.16, z: -0.28 }, rotation: { x: -0.14, y: 0, z: 0.05 } },
      ),
      block(
        { width: 0.2, height: 0.48, depth: 0.13, bottomScale: 0.5, bevel: 0.04 },
        { position: { x: 0.18, y: -0.1, z: -0.28 }, rotation: { x: -0.14, y: 0, z: -0.05 } },
      ),
    )
  } else if (kind === 'crop') {
    parts.push(
      block(
        { width: 0.64, height: 0.28, depth: 0.62, topScale: 0.82, bevel: 0.1 },
        { position: { x: 0, y: 0.26, z: -0.02 } },
      ),
    )
  } else if (kind === 'topknot') {
    parts.push(
      block(
        { width: 0.5, height: 0.14, depth: 0.5, topScale: 0.7, bevel: 0.08 },
        { position: { x: 0, y: 0.3, z: -0.02 } },
      ),
      block(
        { width: 0.15, height: 0.34, depth: 0.15, topScale: 0.5, bevel: 0.03 },
        { position: { x: 0, y: 0.5, z: -0.1 }, rotation: { x: -0.4, y: 0, z: 0 } },
      ),
    )
  } else {
    // Ragged: uneven tufts, deliberately not symmetrical.
    const tufts: readonly (readonly [number, number, number])[] = [
      [-0.2, 0.3, -0.1],
      [0.06, 0.34, 0.05],
      [0.22, 0.28, -0.12],
      [-0.04, 0.3, -0.24],
    ]
    for (const [x, y, z] of tufts) {
      parts.push(
        block(
          { width: 0.2, height: 0.24, depth: 0.18, topScale: 0.34, bevel: 0.03 },
          { position: { x, y, z }, rotation: { x: z * 0.8, y: 0, z: x * 1.4 } },
        ),
      )
    }
  }
  return finish(parts, `character-hair:${kind}`)
}

// ---------------------------------------------------------------------------
// Headgear
// ---------------------------------------------------------------------------

function helmDome(radius: number, height: number, segments = 9): THREE.BufferGeometry {
  return latheProfile(
    [
      { x: 0.001, y: -height * 0.42 },
      { x: radius * 0.86, y: -height * 0.42 },
      { x: radius, y: -height * 0.3 },
      { x: radius * 0.96, y: -height * 0.06 },
      { x: radius * 0.82, y: height * 0.2 },
      { x: radius * 0.5, y: height * 0.42 },
      { x: 0.001, y: height * 0.5 },
    ],
    { segments, name: 'helm-dome' },
  )
}

export function buildHeadgear(kind: HeadgearKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  if (kind === 'circlet' || kind === 'crown') {
    const band = latheProfile(
      [
        { x: 0.37, y: -0.05 },
        { x: 0.4, y: -0.02 },
        { x: 0.4, y: 0.04 },
        { x: 0.37, y: 0.06 },
      ],
      { segments: 12, name: 'circlet-band' },
    )
    parts.push(transformed(band, { position: { x: 0, y: 0.2, z: 0 } }))
    const blades = kind === 'crown' ? 5 : 3
    for (let index = 0; index < blades; index += 1) {
      const spread = (index / (blades - 1) - 0.5) * (kind === 'crown' ? 2.1 : 1.2)
      const height = kind === 'crown' ? 0.3 - Math.abs(spread) * 0.09 : 0.17
      parts.push(
        plate(
          [
            { x: -0.035, y: 0 },
            { x: 0.035, y: 0 },
            { x: 0, y: height },
          ],
          0.035,
          {
            position: { x: Math.sin(spread) * 0.38, y: 0.24, z: Math.cos(spread) * 0.38 },
            rotation: { x: 0, y: spread, z: 0 },
          },
        ),
      )
    }
  } else if (kind === 'hood' || kind === 'ragHood') {
    // A cone with a broken peak, open at the face, with the drape resolved as two
    // folds rather than a smooth surface. Cloth in this game is folded, not draped.
    const shell = latheProfile(
      [
        { x: 0.001, y: -0.44 },
        { x: 0.4, y: -0.46 },
        { x: 0.47, y: -0.3 },
        { x: 0.47, y: -0.02 },
        { x: 0.4, y: 0.2 },
        { x: 0.22, y: 0.38 },
        { x: 0.08, y: 0.5 },
        { x: 0.001, y: 0.54 },
      ],
      { segments: kind === 'ragHood' ? 7 : 9, name: 'hood-shell' },
    )
    parts.push(shell)
    parts.push(
      // The peak flops backwards, which is what stops a hood reading as a traffic cone.
      block(
        { width: 0.16, height: 0.34, depth: 0.16, topScale: 0.25, bevel: 0.03 },
        { position: { x: 0, y: 0.5, z: -0.18 }, rotation: { x: -0.9, y: 0, z: 0 } },
      ),
    )
    if (kind === 'ragHood') {
      parts.push(
        // A jaw guard of lashed rags.
        block(
          { width: 0.42, height: 0.2, depth: 0.28, topScale: 1.1, bevel: 0.04 },
          { position: { x: 0.02, y: -0.28, z: 0.24 }, rotation: { x: 0.2, y: 0, z: 0.08 } },
        ),
      )
    }
  } else if (kind === 'kettle') {
    parts.push(transformed(helmDome(0.4, 0.44), { position: { x: 0, y: 0.16, z: 0 } }))
    parts.push(
      transformed(
        latheProfile(
          [
            { x: 0.3, y: -0.03 },
            { x: 0.52, y: -0.09 },
            { x: 0.52, y: -0.03 },
            { x: 0.3, y: 0.05 },
          ],
          { segments: 12, name: 'kettle-brim' },
        ),
        { position: { x: 0, y: 0.08, z: 0 } },
      ),
    )
  } else if (kind === 'nasal' || kind === 'crested') {
    parts.push(transformed(helmDome(0.42, 0.5), { position: { x: 0, y: 0.2, z: 0 } }))
    parts.push(
      // Nasal bar.
      block(
        { width: 0.08, height: 0.34, depth: 0.09, topScale: 1.5, bevel: 0.02 },
        { position: { x: 0, y: 0.02, z: 0.36 } },
      ),
      // Cheek plates.
      ...mirroredPairX(() =>
        plate(
          [
            { x: -0.07, y: 0.16 },
            { x: 0.09, y: 0.13 },
            { x: 0.06, y: -0.2 },
            { x: -0.07, y: -0.12 },
          ],
          0.05,
          {
            position: { x: 0.31, y: 0.02, z: 0.2 },
            rotation: { x: 0, y: -1.2, z: 0 },
          },
        ),
      ),
      // Brow band, riveted.
      transformed(
        latheProfile(
          [
            { x: 0.4, y: -0.04 },
            { x: 0.45, y: -0.01 },
            { x: 0.45, y: 0.04 },
            { x: 0.4, y: 0.06 },
          ],
          { segments: 12, name: 'helm-band' },
        ),
        { position: { x: 0, y: 0.09, z: 0 } },
      ),
    )
    if (kind === 'crested') {
      parts.push(
        plate(
          [
            { x: -0.3, y: 0 },
            { x: -0.14, y: 0.2 },
            { x: 0.1, y: 0.26 },
            { x: 0.3, y: 0.16 },
            { x: 0.26, y: 0.02 },
          ],
          0.06,
          { position: { x: 0, y: 0.4, z: -0.02 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } },
        ),
        // A plume falling off the back of the crest.
        block(
          { width: 0.13, height: 0.42, depth: 0.13, topScale: 0.4, bottomScale: 0.7, bevel: 0.03 },
          { position: { x: 0, y: 0.42, z: -0.3 }, rotation: { x: 0.9, y: 0, z: 0 } },
        ),
      )
    }
  } else if (kind === 'greathelm') {
    parts.push(
      block(
        {
          width: 0.66,
          height: 0.74,
          depth: 0.68,
          topScale: 0.86,
          topDepthScale: 0.9,
          bottomScale: 0.94,
          bevel: 0.09,
        },
        { position: { x: 0, y: 0.12, z: 0 } },
      ),
      // Vision slit: two bars leaving a gap, which reads darker than a painted line.
      block(
        { width: 0.6, height: 0.08, depth: 0.08 },
        { position: { x: 0, y: 0.12, z: 0.35 } },
      ),
      block(
        { width: 0.09, height: 0.34, depth: 0.09 },
        { position: { x: 0, y: 0.04, z: 0.36 } },
      ),
      // Breath holes as a raised grid on the right cheek.
      block(
        { width: 0.22, height: 0.16, depth: 0.06 },
        { position: { x: 0.14, y: -0.16, z: 0.34 } },
      ),
      plate(
        [
          { x: -0.3, y: 0 },
          { x: -0.1, y: 0.22 },
          { x: 0.14, y: 0.24 },
          { x: 0.3, y: 0.1 },
          { x: 0.24, y: -0.02 },
        ],
        0.07,
        { position: { x: 0, y: 0.48, z: 0 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } },
      ),
    )
  } else if (kind === 'hornedHelm') {
    parts.push(transformed(helmDome(0.42, 0.42, 7), { position: { x: 0, y: 0.18, z: 0 } }))
    parts.push(
      ...mirroredPairX(() =>
        transformed(
          tubeAlongPoints(
            [
              { x: 0, y: 0, z: 0 },
              { x: 0.1, y: 0.16, z: -0.03 },
              { x: 0.26, y: 0.3, z: -0.1 },
              { x: 0.46, y: 0.3, z: -0.22 },
            ],
            {
              radius: (t) => 0.1 * (1 - t) + 0.014,
              radialSegments: 6,
              tubularSegments: 9,
              capStart: true,
              name: 'horn',
            },
          ),
          { position: { x: 0.24, y: 0.16, z: 0 } },
        ),
      ),
      // A crown of small spikes between the horns.
      ...[-0.12, 0, 0.12].map((x) =>
        spike(0.035, 0.13, { position: { x, y: 0.42, z: -0.04 } }),
      ),
    )
  } else if (kind === 'boneMask') {
    parts.push(
      plate(
        [
          { x: -0.3, y: 0.26 },
          { x: 0.3, y: 0.26 },
          { x: 0.32, y: -0.06 },
          { x: 0.16, y: -0.3 },
          { x: -0.16, y: -0.3 },
          { x: -0.32, y: -0.06 },
        ],
        0.11,
        { position: { x: 0, y: -0.02, z: 0.3 } },
      ),
      // Two hollow sockets cut as raised rims rather than holes.
      ...mirroredPair((side) =>
        block(
          { width: 0.16, height: 0.12, depth: 0.06 },
          { position: { x: side * 0.14, y: 0.07, z: 0.37 } },
        ),
      ),
      // A skullcap so it does not float in front of the face.
      transformed(helmDome(0.4, 0.3, 7), { position: { x: 0, y: 0.2, z: -0.02 } }),
    )
  } else if (kind === 'cap') {
    parts.push(
      // Lathe profiles run bottom to top. Reversed, `LatheGeometry` writes its
      // normals and its winding inside out and the whole cap vanishes.
      latheProfile(
        [
          { x: 0.001, y: -0.05 },
          { x: 0.36, y: -0.06 },
          { x: 0.43, y: -0.02 },
          { x: 0.4, y: 0.08 },
          { x: 0.24, y: 0.24 },
          { x: 0.001, y: 0.3 },
        ],
        { segments: 9, name: 'cap' },
      ),
      // A knotted tail at the back — a headscarf, not a beanie.
      block(
        { width: 0.14, height: 0.24, depth: 0.12, topScale: 0.4, bevel: 0.03 },
        { position: { x: 0, y: 0.02, z: -0.4 }, rotation: { x: 1.1, y: 0, z: 0 } },
      ),
    )
  } else {
    // 'strap' — a leather band with one riveted plate over the brow.
    parts.push(
      transformed(
        latheProfile(
          [
            { x: 0.4, y: -0.06 },
            { x: 0.44, y: -0.03 },
            { x: 0.44, y: 0.05 },
            { x: 0.4, y: 0.08 },
          ],
          { segments: 10, name: 'strap-band' },
        ),
        { position: { x: 0, y: 0.14, z: 0 } },
      ),
      block(
        { width: 0.3, height: 0.18, depth: 0.1, topScale: 0.8, bevel: 0.03 },
        { position: { x: 0, y: 0.15, z: 0.34 } },
      ),
    )
  }
  return finish(parts, `character-headgear:${kind}`)
}

// ---------------------------------------------------------------------------
// Limbs
// ---------------------------------------------------------------------------

/** Upper arm, hanging from the shoulder joint at the origin. */
/**
 * The only thing a limb's silhouette takes from the armour weight: its bulk.
 *
 * `light` and `medium` build the same width, so keying a limb by the raw armour
 * weight buys two buffers for one shape.
 */
function limbBulk(armour: ArmourWeight): string {
  return armour === 'heavy' ? 'heavy' : armour === 'none' ? 'bare' : 'clad'
}

/**
 * The part of a plan an upper arm actually looks at.
 *
 * Cache keys have to be injective on geometry, but they must not be *finer* than
 * the geometry either: `guard` and `villain` in light armour build byte-identical
 * arms, and keying by faction bought two buffers for one shape. The builder names
 * itself with this same token, so a predicate can never drift away from the key
 * that is supposed to describe it — and the fingerprint test would catch it if it
 * ever did, in both directions.
 */
export function upperArmVariant(faction: CharacterFaction, armour: ArmourWeight): string {
  const lame = armour === 'heavy' || (armour === 'medium' && faction === 'guard')
  const wrap = faction === 'villain' && armour !== 'none'
  return `${limbBulk(armour)}${lame ? '+lame' : ''}${wrap ? '+wrap' : ''}`
}

export function buildUpperArm(
  faction: CharacterFaction,
  armour: ArmourWeight,
  length: number,
): THREE.BufferGeometry {
  const heavy = armour === 'heavy'
  const width = heavy ? 0.32 : armour === 'none' ? 0.24 : 0.28
  const parts: THREE.BufferGeometry[] = [
    loft({
      profile: rectProfile(width, width * 1.06, 0.06),
      sections: [
        // Deltoid cap. Shoulders are a volume, not a hinge.
        { y: 0.1, scaleX: 0.78, scaleZ: 0.8 },
        { y: 0.04, scaleX: 1.06, scaleZ: 1.06 },
        { y: -0.12, scaleX: 1, scaleZ: 1 },
        { y: -length * 0.6, scaleX: 0.88, scaleZ: 0.88 },
        // Elbow.
        { y: -length, scaleX: 0.82, scaleZ: 0.86 },
      ],
      name: 'upper-arm',
    }),
  ]
  if (armour === 'heavy' || (armour === 'medium' && faction === 'guard')) {
    parts.push(
      block(
        { width: width * 1.24, height: 0.12, depth: width * 1.26, bevel: 0.03 },
        { position: { x: 0, y: -length * 0.5, z: 0 } },
      ),
    )
  }
  if (faction === 'villain' && armour !== 'none') {
    // A rag wrap partway down. Villains never finish anything.
    parts.push(
      block(
        { width: width * 1.2, height: 0.16, depth: width * 1.18, topScale: 0.86, bevel: 0.02 },
        { position: { x: 0, y: -length * 0.72, z: 0 }, rotation: { x: 0.1, y: 0, z: 0.14 } },
      ),
    )
  }
  return finish(parts, `character-upper-arm:${upperArmVariant(faction, armour)}`)
}

function fistParts(scale: number, offsetY: number): THREE.BufferGeometry[] {
  // A fist: a palm block, a thumb ridge and three knuckles. Four small boxes read
  // as a hand from any angle the camera can reach.
  return [
    block(
      { width: 0.2 * scale, height: 0.2 * scale, depth: 0.24 * scale, bevel: 0.04 * scale },
      { position: { x: 0, y: offsetY, z: 0.01 } },
    ),
    block(
      { width: 0.19 * scale, height: 0.07 * scale, depth: 0.1 * scale, bevel: 0.02 * scale },
      { position: { x: 0, y: offsetY + 0.07 * scale, z: 0.13 * scale } },
    ),
    block(
      { width: 0.08 * scale, height: 0.14 * scale, depth: 0.1 * scale, bevel: 0.02 * scale },
      {
        position: { x: 0.1 * scale, y: offsetY + 0.04 * scale, z: 0.09 * scale },
        rotation: { x: 0, y: 0, z: -0.5 },
      },
    ),
  ]
}

/** The part of a plan a forearm actually looks at. See `upperArmVariant`. */
export function forearmVariant(
  faction: CharacterFaction,
  armour: ArmourWeight,
  gloved: boolean,
): string {
  const lame = armour !== 'none' && (faction === 'guard' || armour === 'heavy')
  return `${limbBulk(armour)}${lame ? '+lame' : ''}${gloved ? '+glove' : ''}`
}

/** Forearm, hanging from the elbow at the origin. Gloved kits get a fist. */
export function buildForearm(
  faction: CharacterFaction,
  armour: ArmourWeight,
  gloved: boolean,
  length: number,
): THREE.BufferGeometry {
  const heavy = armour === 'heavy'
  const width = heavy ? 0.29 : armour === 'none' ? 0.21 : 0.25
  const parts: THREE.BufferGeometry[] = [
    loft({
      profile: rectProfile(width, width * 1.04, 0.05),
      sections: [
        { y: 0.06, scaleX: 0.9, scaleZ: 0.94 },
        { y: -0.02, scaleX: 1.04, scaleZ: 1.02 },
        { y: -length * 0.45, scaleX: 0.9, scaleZ: 0.9 },
        // Wrist.
        { y: -length, scaleX: 0.66, scaleZ: 0.7 },
      ],
      name: 'forearm',
    }),
  ]
  if (armour !== 'none') {
    // Bracer: a band at the wrist and a lame at the elbow.
    parts.push(
      block(
        { width: width * 1.22, height: 0.2, depth: width * 1.2, topScale: 1.06, bevel: 0.03 },
        { position: { x: 0, y: -length * 0.78, z: 0 } },
      ),
    )
    if (faction === 'guard' || heavy) {
      parts.push(
        block(
          { width: width * 1.3, height: 0.1, depth: width * 1.28, bevel: 0.03 },
          { position: { x: 0, y: -0.02, z: 0 } },
        ),
      )
    }
  }
  if (gloved) parts.push(...fistParts(1, -length - 0.11))
  return finish(parts, `character-forearm:${forearmVariant(faction, armour, gloved)}`)
}

/** A bare hand, hanging from the wrist at the origin. Skin material. */
export function buildHand(): THREE.BufferGeometry {
  return finish(fistParts(0.94, -0.09), 'character-hand')
}

/** The part of a plan a thigh actually looks at. See `upperArmVariant`. */
export function thighVariant(faction: CharacterFaction, armour: ArmourWeight): string {
  const cop = armour === 'heavy' || (armour === 'medium' && faction === 'guard')
  return `${limbBulk(armour)}${cop ? '+cop' : ''}`
}

/** Thigh, hanging from the hip joint at the origin. */
export function buildThigh(
  faction: CharacterFaction,
  armour: ArmourWeight,
  length: number,
): THREE.BufferGeometry {
  const width = armour === 'heavy' ? 0.38 : armour === 'none' ? 0.3 : 0.34
  const parts: THREE.BufferGeometry[] = [
    loft({
      profile: rectProfile(width, width * 1.1, 0.06),
      sections: [
        { y: 0.1, scaleX: 0.9, scaleZ: 0.92 },
        { y: 0, scaleX: 1.04, scaleZ: 1.04 },
        { y: -length * 0.5, scaleX: 0.92, scaleZ: 0.94 },
        // Knee.
        { y: -length, scaleX: 0.82, scaleZ: 0.86 },
      ],
      name: 'thigh',
    }),
  ]
  if (armour === 'heavy' || (armour === 'medium' && faction === 'guard')) {
    // A knee cop. It is the joint a viewer looks for when a leg bends.
    parts.push(
      block(
        { width: width * 0.9, height: 0.16, depth: 0.16, topScale: 0.8, bevel: 0.03 },
        { position: { x: 0, y: -length + 0.02, z: width * 0.52 } },
      ),
    )
  }
  return finish(parts, `character-thigh:${thighVariant(faction, armour)}`)
}

/** The part of a plan a shin actually looks at. See `upperArmVariant`. */
export function shinVariant(faction: CharacterFaction, armour: ArmourWeight): string {
  const greave = armour === 'heavy' || (armour === 'medium' && faction !== 'elf')
  const wrap = faction === 'elf'
  return `${limbBulk(armour)}${greave ? '+greave' : ''}${wrap ? '+wrap' : ''}`
}

/** Shin and foot, hanging from the knee at the origin. */
export function buildShin(
  faction: CharacterFaction,
  armour: ArmourWeight,
  length: number,
): THREE.BufferGeometry {
  const width = armour === 'heavy' ? 0.32 : armour === 'none' ? 0.25 : 0.28
  const bootTop = -length + 0.2
  const parts: THREE.BufferGeometry[] = [
    loft({
      profile: rectProfile(width, width * 1.12, 0.05),
      sections: [
        { y: 0.06, scaleX: 0.94, scaleZ: 0.96 },
        // The calf sits high and at the back, which is what makes a leg read as a leg.
        { y: -length * 0.28, scaleX: 1.02, scaleZ: 1.1, offsetZ: -0.03 },
        { y: -length * 0.7, scaleX: 0.78, scaleZ: 0.8 },
        { y: bootTop, scaleX: 0.74, scaleZ: 0.78 },
      ],
      name: 'shin',
    }),
    // Boot: an ankle collar, a sole that runs forward, and a heel behind it.
    block(
      { width: width * 0.96, height: 0.14, depth: width * 1.16, topScale: 1.06, bevel: 0.03 },
      { position: { x: 0, y: bootTop - 0.04, z: 0.01 } },
    ),
    block(
      {
        width: width * 0.92,
        height: 0.11,
        depth: width * 1.9,
        topScale: 0.94,
        bottomScale: 1.04,
        bevel: 0.04,
        shearZ: 0.03,
      },
      { position: { x: 0, y: -length + 0.05, z: width * 0.44 } },
    ),
    block(
      { width: width * 0.7, height: 0.08, depth: width * 0.5, bevel: 0.02 },
      { position: { x: 0, y: -length + 0.02, z: -width * 0.4 } },
    ),
  ]
  if (armour === 'heavy' || (armour === 'medium' && faction !== 'elf')) {
    // Greave: a front plate strapped over the shin.
    parts.push(
      plate(
        [
          { x: -0.12, y: 0.22 },
          { x: 0.12, y: 0.22 },
          { x: 0.1, y: -0.2 },
          { x: -0.1, y: -0.2 },
        ],
        0.07,
        { position: { x: 0, y: -length * 0.5, z: width * 0.6 } },
      ),
    )
  }
  if (faction === 'elf') {
    // A wrap that spirals up the calf.
    for (const y of [-0.16, -0.3, -0.44]) {
      parts.push(
        block(
          { width: width * 1.08, height: 0.07, depth: width * 1.18, bevel: 0.02 },
          { position: { x: 0, y, z: 0 }, rotation: { x: 0, y: 0, z: 0.06 } },
        ),
      )
    }
  }
  return finish(parts, `character-shin:${shinVariant(faction, armour)}`)
}

// ---------------------------------------------------------------------------
// Cloaks
// ---------------------------------------------------------------------------

/** The part of a plan a cloak actually looks at: the yoke width and the kind. */
export function cloakVariant(faction: CharacterFaction, kind: CloakKind): string {
  return `${kind}:${faction === 'guard' ? 'wide' : 'narrow'}`
}

/**
 * Cloth, resolved as folds.
 *
 * A cape is built from five flat panels fanned around the back rather than from
 * one curved surface: the creases catch the band edges and the whole thing reads
 * as drawn cloth instead of as a shrink-wrapped cone.
 */
export function buildCloak(
  faction: CharacterFaction,
  kind: CloakKind,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const panelCount = kind === 'rags' ? 4 : 5
  const length = kind === 'cloak' ? 1.5 : kind === 'cape' ? 0.86 : kind === 'mantle' ? 0.62 : 0.7
  const spread = kind === 'cloak' ? 1.5 : 1.25
  for (let index = 0; index < panelCount; index += 1) {
    const t = index / (panelCount - 1) - 0.5
    const angle = t * spread
    const drop = length * (1 - Math.abs(t) * (kind === 'cloak' ? 0.18 : 0.3))
    const panelWidth = (kind === 'rags' ? 0.24 : 0.32) - Math.abs(t) * 0.06
    parts.push(
      block(
        {
          width: panelWidth,
          height: drop,
          depth: 0.06,
          bottomScale: kind === 'cloak' ? 1.5 : 1.28,
          topScale: 0.92,
          bevel: 0.015,
          shearZ: -0.08 - Math.abs(t) * 0.05,
        },
        {
          position: {
            x: Math.sin(angle) * 0.34,
            y: -drop / 2 + 0.04,
            z: -0.24 - Math.cos(angle) * 0.06,
          },
          rotation: { x: 0.06, y: -angle, z: t * 0.12 },
        },
      ),
    )
  }
  // A yoke over the shoulders so the cloth has something to hang from.
  parts.push(
    block(
      {
        width: faction === 'guard' ? 0.86 : 0.74,
        height: 0.18,
        depth: 0.62,
        topScale: 0.9,
        bevel: 0.06,
      },
      { position: { x: 0, y: 0.06, z: -0.06 } },
    ),
  )
  if (kind === 'mantle') {
    // A fur roll on top of the yoke.
    for (const x of [-0.24, 0, 0.24]) {
      parts.push(
        block(
          { width: 0.28, height: 0.2, depth: 0.34, topScale: 0.7, bevel: 0.07 },
          { position: { x, y: 0.16, z: -0.04 }, rotation: { x: 0, y: 0, z: x * 0.6 } },
        ),
      )
    }
  }
  if (kind === 'cloak') {
    // A clasp on the chest, so the cloak is worn rather than draped.
    parts.push(
      block(
        { width: 0.14, height: 0.14, depth: 0.1, topScale: 0.6, bevel: 0.03 },
        { position: { x: 0, y: 0.1, z: 0.3 } },
      ),
    )
  }
  return finish(parts, `character-cloak:${cloakVariant(faction, kind)}`)
}

// ---------------------------------------------------------------------------
// Offhand
// ---------------------------------------------------------------------------

export function buildOffhand(kind: OffhandKind): THREE.BufferGeometry {
  if (kind === 'heater') {
    const board = plate(
      [
        { x: -0.4, y: 0.6 },
        { x: 0.4, y: 0.6 },
        { x: 0.42, y: 0.08 },
        { x: 0.24, y: -0.34 },
        { x: 0, y: -0.62 },
        { x: -0.24, y: -0.34 },
        { x: -0.42, y: 0.08 },
      ],
      0.11,
      {},
      0.03,
    )
    const boss = transformed(
      latheProfile(
        [
          { x: 0.001, y: 0 },
          { x: 0.15, y: 0.012 },
          { x: 0.12, y: 0.08 },
          { x: 0.001, y: 0.11 },
        ],
        { segments: 8, name: 'shield-boss' },
      ),
      // +π/2 about X, not −π/2: the dome has to face the enemy, and the face a
      // shield presents to the enemy is +Z, where the rim and the boss live.
      { rotation: { x: Math.PI / 2, y: 0, z: 0 }, position: { x: 0, y: 0.08, z: 0.06 } },
    )
    const rib = block(
      { width: 0.08, height: 1.14, depth: 0.05 },
      { position: { x: 0, y: 0, z: 0.06 } },
    )
    const straps = mirroredPair((side) =>
      block(
        { width: 0.09, height: 0.34, depth: 0.05 },
        { position: { x: side * 0.16, y: 0.06, z: -0.07 }, rotation: { x: 0, y: 0, z: Math.PI / 2 } },
      ),
    )
    return finish([board, boss, rib, ...straps], 'character-offhand:heater')
  }
  if (kind === 'leafKite') {
    const board = plate(
      [
        { x: 0, y: 0.68 },
        { x: 0.3, y: 0.36 },
        { x: 0.34, y: -0.12 },
        { x: 0, y: -0.66 },
        { x: -0.34, y: -0.12 },
        { x: -0.3, y: 0.36 },
      ],
      0.09,
      {},
      0.03,
    )
    const veins = [-0.34, 0, 0.34].map((angle) =>
      block(
        { width: 0.05, height: 0.9, depth: 0.05 },
        { position: { x: 0, y: 0, z: 0.05 }, rotation: { x: 0, y: 0, z: angle } },
      ),
    )
    const straps = mirroredPair((side) =>
      block(
        { width: 0.08, height: 0.3, depth: 0.05 },
        { position: { x: side * 0.14, y: 0.02, z: -0.06 }, rotation: { x: 0, y: 0, z: Math.PI / 2 } },
      ),
    )
    return finish([board, ...veins, ...straps], 'character-offhand:leafKite')
  }
  if (kind === 'roundSpiked') {
    const board = transformed(
      latheProfile(
        [
          { x: 0.001, y: -0.06 },
          { x: 0.44, y: -0.05 },
          { x: 0.5, y: 0 },
          { x: 0.44, y: 0.05 },
          { x: 0.001, y: 0.09 },
        ],
        { segments: 9, name: 'round-shield' },
      ),
      { rotation: { x: Math.PI / 2, y: 0, z: 0 } },
    )
    const spikes: THREE.BufferGeometry[] = []
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2
      spikes.push(
        // +π/2 points the tip along +Z, away from the arm behind the straps.
        spike(0.05, 0.19, {
          position: { x: Math.cos(angle) * 0.3, y: Math.sin(angle) * 0.3, z: 0.07 },
          rotation: { x: Math.PI / 2, y: 0, z: 0 },
        }),
      )
    }
    const hubSpike = spike(0.09, 0.3, {
      position: { x: 0, y: 0, z: 0.07 },
      rotation: { x: Math.PI / 2, y: 0, z: 0 },
    })
    const straps = mirroredPair((side) =>
      block(
        { width: 0.08, height: 0.3, depth: 0.05 },
        { position: { x: side * 0.14, y: 0, z: -0.06 }, rotation: { x: 0, y: 0, z: Math.PI / 2 } },
      ),
    )
    return finish([board, hubSpike, ...spikes, ...straps], 'character-offhand:roundSpiked')
  }
  if (kind === 'buckler') {
    const board = transformed(
      latheProfile(
        [
          { x: 0.001, y: -0.05 },
          { x: 0.26, y: -0.04 },
          { x: 0.3, y: 0 },
          { x: 0.24, y: 0.06 },
          { x: 0.1, y: 0.13 },
          { x: 0.001, y: 0.15 },
        ],
        { segments: 10, name: 'buckler' },
      ),
      { rotation: { x: Math.PI / 2, y: 0, z: 0 } },
    )
    const grip = block(
      { width: 0.07, height: 0.24, depth: 0.05 },
      { position: { x: 0, y: 0, z: -0.07 }, rotation: { x: 0, y: 0, z: Math.PI / 2 } },
    )
    return finish([board, grip], 'character-offhand:buckler')
  }
  // 'bundle' — a sack of somebody's belongings, carried rather than fought with.
  const sack = loft({
    profile: polygonProfile(0.26, 7),
    sections: [
      { y: -0.3, scaleX: 0.5 },
      { y: -0.18, scaleX: 0.98 },
      { y: 0.06, scaleX: 1.04 },
      { y: 0.22, scaleX: 0.62 },
      { y: 0.32, scaleX: 0.22 },
    ],
    name: 'bundle',
  })
  const tie = transformed(
    latheProfile(
      [
        { x: 0.14, y: -0.03 },
        { x: 0.18, y: 0 },
        { x: 0.14, y: 0.03 },
      ],
      { segments: 8, name: 'bundle-tie' },
    ),
    { position: { x: 0, y: 0.22, z: 0 } },
  )
  return finish([sack, tie], 'character-offhand:bundle')
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

/**
 * Every weapon is authored with the **centre of its grip at the origin** and its
 * business end towards +Y, so the engine can drop any of them into the same hand
 * pivot without a per-weapon offset table.
 *
 * Each one is two buffers: the `head` (steel) and the `grip` (wood and leather).
 * Two draw calls on the object the player looks at most is a good trade.
 */
function bladeProfile(
  width: number,
  length: number,
  ricasso: number,
  curve: number,
): THREE.BufferGeometry {
  const sections: LoftSection[] = []
  const steps = 6
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    const y = ricasso + (length - ricasso) * t
    const taper = t < 0.7 ? 1 - t * 0.16 : 1 - 0.112 - (t - 0.7) * 2.9
    sections.push({
      y,
      scaleX: Math.max(0.05, taper),
      scaleZ: Math.max(0.12, 1 - t * 0.35),
      offsetX: curve * t * t,
    })
  }
  return loft({
    // A diamond cross-section: a fuller ridge down the middle of a flat blade.
    // Wound the same way round as `rectProfile`, or the walls and the caps end up
    // facing opposite directions and no whole-geometry repair can save it.
    profile: [
      { x: -width / 2, y: 0 },
      { x: 0, y: -0.05 },
      { x: width / 2, y: 0 },
      { x: 0, y: 0.05 },
    ],
    sections: [{ y: ricasso - 0.06, scaleX: 0.86, scaleZ: 0.9 }, ...sections],
    name: 'blade',
  })
}

export function buildWeaponHead(kind: WeaponKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  if (kind === 'sword' || kind === 'greatsword' || kind === 'dagger') {
    const long = kind === 'greatsword'
    const short = kind === 'dagger'
    const length = short ? 0.5 : long ? 1.72 : 1.04
    const guardY = short ? 0.1 : long ? 0.2 : 0.13
    parts.push(bladeProfile(short ? 0.11 : long ? 0.22 : 0.16, length, guardY + 0.02, 0))
    parts.push(
      // Crossguard. Straight for a sword, swept and heavier for a greatsword.
      block(
        {
          width: short ? 0.24 : long ? 0.62 : 0.44,
          height: short ? 0.06 : 0.09,
          depth: short ? 0.1 : 0.15,
          topScale: 0.78,
          bevel: 0.02,
          shearZ: long ? 0.04 : 0,
        },
        { position: { x: 0, y: guardY, z: 0 } },
      ),
    )
    parts.push(
      // Pommel.
      transformed(
        latheProfile(
          [
            { x: 0.001, y: -0.09 },
            { x: 0.07, y: -0.06 },
            { x: 0.085, y: 0 },
            { x: 0.06, y: 0.05 },
            { x: 0.001, y: 0.07 },
          ],
          { segments: 7, name: 'pommel' },
        ),
        { position: { x: 0, y: short ? -0.22 : long ? -0.56 : -0.32, z: 0 } },
      ),
    )
  } else if (kind === 'sabre') {
    parts.push(bladeProfile(0.15, 1.02, 0.14, 0.24))
    // A knuckle bow sweeping from the guard back to the pommel.
    parts.push(
      transformed(
        tubeAlongPoints(
          [
            { x: 0, y: 0.14, z: 0 },
            { x: 0.19, y: 0.04, z: 0 },
            { x: 0.21, y: -0.18, z: 0 },
            { x: 0.04, y: -0.3, z: 0 },
          ],
          { radius: 0.032, radialSegments: 5, tubularSegments: 8, name: 'knuckle-bow' },
        ),
        {},
      ),
    )
    parts.push(
      block(
        { width: 0.3, height: 0.07, depth: 0.13, topScale: 0.7, bevel: 0.02 },
        { position: { x: 0.02, y: 0.13, z: 0 }, rotation: { x: 0, y: 0, z: -0.18 } },
      ),
    )
  } else if (kind === 'axe') {
    // A bearded axe: a crescent that hangs below the haft line and bites.
    parts.push(
      plate(
        [
          { x: 0, y: -0.24 },
          { x: 0.1, y: -0.3 },
          { x: 0.36, y: -0.22 },
          { x: 0.46, y: 0.06 },
          { x: 0.34, y: 0.3 },
          { x: 0.08, y: 0.28 },
          { x: 0, y: 0.22 },
        ],
        0.09,
        { position: { x: 0.05, y: 0.78, z: 0 } },
        0.02,
      ),
      block(
        { width: 0.14, height: 0.36, depth: 0.14, bevel: 0.03 },
        { position: { x: 0, y: 0.78, z: 0 } },
      ),
      spike(0.05, 0.2, { position: { x: -0.02, y: 0.98, z: 0 }, rotation: { x: 0, y: 0, z: 0.16 } }),
    )
  } else if (kind === 'cleaver') {
    // A slab with a hook. It reads as scavenged because it is not symmetrical.
    parts.push(
      plate(
        [
          { x: -0.14, y: 0.12 },
          { x: 0.16, y: 0.16 },
          { x: 0.3, y: 0.5 },
          { x: 0.26, y: 0.86 },
          { x: 0.06, y: 0.94 },
          { x: -0.12, y: 0.72 },
        ],
        0.1,
        {},
        0.02,
      ),
      // The hook at the back of the spine.
      plate(
        [
          { x: 0, y: 0.5 },
          { x: -0.2, y: 0.62 },
          { x: -0.14, y: 0.72 },
          { x: 0, y: 0.66 },
        ],
        0.08,
        {},
        0.015,
      ),
      block(
        { width: 0.24, height: 0.08, depth: 0.14, bevel: 0.02 },
        { position: { x: 0.01, y: 0.13, z: 0 }, rotation: { x: 0, y: 0, z: 0.12 } },
      ),
    )
  } else if (kind === 'spear' || kind === 'glaive') {
    const glaive = kind === 'glaive'
    if (glaive) {
      parts.push(
        plate(
          [
            { x: -0.03, y: 0 },
            { x: 0.1, y: 0.16 },
            { x: 0.2, y: 0.5 },
            { x: 0.12, y: 0.76 },
            { x: -0.02, y: 0.6 },
            { x: -0.05, y: 0.24 },
          ],
          0.07,
          { position: { x: 0, y: 1.02, z: 0 } },
          0.02,
        ),
      )
    } else {
      parts.push(
        plate(
          [
            { x: 0, y: 0.42 },
            { x: 0.11, y: 0.14 },
            { x: 0.09, y: -0.06 },
            { x: 0, y: -0.12 },
            { x: -0.09, y: -0.06 },
            { x: -0.11, y: 0.14 },
          ],
          0.06,
          { position: { x: 0, y: 1.4, z: 0 } },
          0.02,
        ),
      )
    }
    // The socket that joins the head to the haft, plus a langet down the shaft.
    parts.push(
      block(
        { width: 0.11, height: 0.2, depth: 0.11, topScale: 0.8, bevel: 0.02 },
        { position: { x: 0, y: glaive ? 1.0 : 1.28, z: 0 } },
      ),
      block(
        { width: 0.07, height: 0.3, depth: 0.07, bevel: 0.015 },
        { position: { x: 0, y: glaive ? 0.86 : 1.12, z: 0 } },
      ),
      // A butt-spike, so the weapon has two ends.
      spike(0.04, 0.16, {
        position: { x: 0, y: glaive ? -0.86 : -0.92, z: 0 },
        rotation: { x: Math.PI, y: 0, z: 0 },
      }),
    )
  } else if (kind === 'mace' || kind === 'maul') {
    const maul = kind === 'maul'
    const headY = maul ? 0.94 : 0.7
    if (maul) {
      parts.push(
        block(
          {
            width: 0.34,
            height: 0.36,
            depth: 0.34,
            topScale: 0.86,
            bottomScale: 0.86,
            bevel: 0.05,
          },
          { position: { x: 0, y: headY, z: 0 } },
        ),
        spike(0.07, 0.24, { position: { x: 0, y: headY, z: 0.2 }, rotation: { x: Math.PI / 2, y: 0, z: 0 } }),
        block(
          { width: 0.4, height: 0.09, depth: 0.4, bevel: 0.03 },
          { position: { x: 0, y: headY + 0.12, z: 0 } },
        ),
      )
    } else {
      // Six flanges around a core. The silhouette is the flanges.
      parts.push(
        transformed(
          latheProfile(
            [
              { x: 0.001, y: -0.16 },
              { x: 0.09, y: -0.13 },
              { x: 0.11, y: 0 },
              { x: 0.09, y: 0.13 },
              { x: 0.001, y: 0.17 },
            ],
            { segments: 8, name: 'mace-core' },
          ),
          { position: { x: 0, y: headY, z: 0 } },
        ),
      )
      for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2
        parts.push(
          plate(
            [
              { x: 0, y: -0.14 },
              { x: 0.13, y: -0.05 },
              { x: 0.13, y: 0.05 },
              { x: 0, y: 0.14 },
            ],
            0.05,
            {
              position: { x: Math.cos(angle) * 0.06, y: headY, z: Math.sin(angle) * 0.06 },
              rotation: { x: 0, y: -angle, z: 0 },
            },
            0.012,
          ),
        )
      }
    }
    parts.push(
      block(
        { width: 0.12, height: 0.1, depth: 0.12, bevel: 0.02 },
        { position: { x: 0, y: headY - (maul ? 0.24 : 0.2), z: 0 } },
      ),
    )
  } else if (kind === 'bow') {
    // The string and the nocked arrow. The limbs are wood and live on the grip.
    parts.push(
      block(
        { width: 0.022, height: 1.46, depth: 0.022 },
        { position: { x: 0.02, y: 0, z: 0 } },
      ),
      block(
        { width: 0.03, height: 0.03, depth: 0.86 },
        { position: { x: 0.04, y: 0, z: 0.4 } },
      ),
      spike(0.03, 0.12, {
        position: { x: 0.04, y: 0, z: 0.86 },
        rotation: { x: Math.PI / 2, y: 0, z: 0 },
      }),
    )
  } else {
    // 'staff' — a carved head and a binding ring.
    parts.push(
      transformed(
        latheProfile(
          [
            { x: 0.001, y: -0.12 },
            { x: 0.08, y: -0.1 },
            { x: 0.1, y: 0 },
            { x: 0.07, y: 0.1 },
            { x: 0.001, y: 0.16 },
          ],
          { segments: 7, name: 'staff-head' },
        ),
        { position: { x: 0, y: 1.02, z: 0 } },
      ),
      transformed(
        latheProfile(
          [
            { x: 0.055, y: -0.03 },
            { x: 0.07, y: 0 },
            { x: 0.055, y: 0.03 },
          ],
          { segments: 7, name: 'staff-ring' },
        ),
        { position: { x: 0, y: 0.86, z: 0 } },
      ),
    )
  }
  return finish(parts, `character-weapon:${kind}:head`)
}

export function buildWeaponGrip(kind: WeaponKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const wrap = (
    height: number,
    radius: number,
    centre: number,
    ridges: number,
  ): void => {
    parts.push(
      loft({
        profile: polygonProfile(radius, 6),
        sections: [
          { y: centre - height / 2, scaleX: 0.9 },
          { y: centre - height / 2 + 0.03, scaleX: 1 },
          { y: centre + height / 2 - 0.03, scaleX: 1 },
          { y: centre + height / 2, scaleX: 0.9 },
        ],
        name: 'grip',
      }),
    )
    for (let index = 0; index < ridges; index += 1) {
      const t = (index + 0.5) / ridges
      parts.push(
        transformed(
          latheProfile(
            [
              { x: radius * 0.98, y: -0.012 },
              { x: radius * 1.16, y: 0 },
              { x: radius * 0.98, y: 0.012 },
            ],
            { segments: 6, name: 'grip-ridge' },
          ),
          { position: { x: 0, y: centre - height / 2 + height * t, z: 0 } },
        ),
      )
    }
  }
  if (kind === 'sword') wrap(0.4, 0.045, -0.08, 4)
  else if (kind === 'greatsword') wrap(0.66, 0.05, -0.19, 6)
  else if (kind === 'dagger') wrap(0.26, 0.04, -0.06, 3)
  else if (kind === 'sabre') wrap(0.36, 0.045, -0.08, 4)
  else if (kind === 'axe') {
    parts.push(
      loft({
        profile: polygonProfile(0.05, 6),
        sections: [
          { y: -0.52, scaleX: 0.92 },
          { y: -0.3, scaleX: 1 },
          { y: 0.5, scaleX: 1.02 },
          { y: 0.96, scaleX: 0.9 },
        ],
        name: 'axe-haft',
      }),
      block(
        { width: 0.13, height: 0.09, depth: 0.13, bevel: 0.02 },
        { position: { x: 0, y: -0.5, z: 0 } },
      ),
    )
  } else if (kind === 'cleaver') {
    wrap(0.34, 0.05, -0.12, 3)
    parts.push(
      block(
        { width: 0.16, height: 0.06, depth: 0.11, bevel: 0.02 },
        { position: { x: 0, y: -0.3, z: 0 } },
      ),
    )
  } else if (kind === 'spear' || kind === 'glaive') {
    const top = kind === 'glaive' ? 0.92 : 1.2
    parts.push(
      loft({
        profile: polygonProfile(0.048, 7),
        sections: [
          { y: -0.9, scaleX: 0.86 },
          { y: -0.4, scaleX: 1 },
          { y: 0.4, scaleX: 1 },
          { y: top, scaleX: 0.9 },
        ],
        name: 'haft',
      }),
    )
    for (const y of [-0.3, 0.1]) {
      parts.push(
        transformed(
          latheProfile(
            [
              { x: 0.05, y: -0.02 },
              { x: 0.062, y: 0 },
              { x: 0.05, y: 0.02 },
            ],
            { segments: 7, name: 'haft-band' },
          ),
          { position: { x: 0, y, z: 0 } },
        ),
      )
    }
  } else if (kind === 'mace' || kind === 'maul') {
    const top = kind === 'maul' ? 0.74 : 0.54
    parts.push(
      loft({
        profile: polygonProfile(kind === 'maul' ? 0.055 : 0.045, 6),
        sections: [
          { y: kind === 'maul' ? -0.58 : -0.38, scaleX: 0.9 },
          { y: -0.2, scaleX: 1 },
          { y: top, scaleX: 0.96 },
        ],
        name: 'haft',
      }),
      block(
        { width: 0.12, height: 0.08, depth: 0.12, bevel: 0.02 },
        { position: { x: 0, y: kind === 'maul' ? -0.58 : -0.38, z: 0 } },
      ),
    )
  } else if (kind === 'bow') {
    // A recurve: the limbs bend forward at the tips, which is the whole read.
    parts.push(
      tubeAlongPoints(
        [
          { x: 0, y: -0.74, z: -0.06 },
          { x: 0, y: -0.5, z: 0.08 },
          { x: 0, y: -0.16, z: 0.16 },
          { x: 0, y: 0, z: 0.17 },
          { x: 0, y: 0.16, z: 0.16 },
          { x: 0, y: 0.5, z: 0.08 },
          { x: 0, y: 0.74, z: -0.06 },
        ],
        {
          radius: (t) => 0.022 + Math.sin(t * Math.PI) * 0.026,
          radialSegments: 5,
          tubularSegments: 14,
          capStart: true,
          capEnd: true,
          name: 'bow-limbs',
        },
      ),
      block(
        { width: 0.07, height: 0.28, depth: 0.11, bevel: 0.02 },
        { position: { x: 0, y: 0, z: 0.17 } },
      ),
    )
  } else {
    parts.push(
      loft({
        profile: polygonProfile(0.045, 7),
        sections: [
          { y: -0.98, scaleX: 0.8 },
          { y: -0.6, scaleX: 1 },
          { y: 0.3, scaleX: 1.04 },
          { y: 0.88, scaleX: 0.92 },
        ],
        name: 'staff-shaft',
      }),
      // A knot in the wood, so a staff is not a dowel.
      block(
        { width: 0.11, height: 0.11, depth: 0.11, bevel: 0.03 },
        { position: { x: 0.01, y: -0.2, z: 0.01 } },
      ),
    )
  }
  return finish(parts, `character-weapon:${kind}:grip`)
}

// ---------------------------------------------------------------------------
// Rig maths
// ---------------------------------------------------------------------------

/**
 * Where the hand ends up, given the arm chain's rotation.
 *
 * The weapon pivot is a sibling of the arm rather than its child — `attachTorch`
 * and the player's weapon trail both parent to `weapon` and expect it to sit at
 * hand height in torso space. So the animation solves the two-bone chain by hand
 * every frame, which is six trig calls and no allocation, and writes the answer
 * into the weapon pivot's position.
 *
 * Mirrors `THREE.Euler` order `XYZ`, which is what `Object3D.rotation` uses.
 */
export function solveHandOffset(
  target: THREE.Vector3,
  upperArm: number,
  forearm: number,
  shoulderX: number,
  shoulderZ: number,
  elbowX: number,
): THREE.Vector3 {
  const along = -(upperArm + forearm * Math.cos(elbowX))
  const ahead = -forearm * Math.sin(elbowX)
  const cosZ = Math.cos(shoulderZ)
  const sinZ = Math.sin(shoulderZ)
  const cosX = Math.cos(shoulderX)
  const sinX = Math.sin(shoulderX)
  return target.set(
    -along * sinZ,
    along * cosZ * cosX - ahead * sinX,
    along * cosZ * sinX + ahead * cosX,
  )
}

// ---------------------------------------------------------------------------
// Beasts
// ---------------------------------------------------------------------------

export type BeastKind = 'wolf' | 'boar' | 'bear' | 'troll'

export interface BeastRig {
  /** Height of the spine above the ground. */
  backHeight: number
  /** Where the shoulder joints sit, relative to the body centre. */
  frontZ: number
  hindZ: number
  frontX: number
  hindX: number
  frontJointY: number
  hindJointY: number
  frontLimb: number
  hindLimb: number
  headY: number
  headZ: number
  tailY: number
  tailZ: number
  /** Radius of the faction ring and the contact shadow under the animal. */
  footprint: number
}

/**
 * Where each animal's joints are.
 *
 * Shared with the engine rather than duplicated there, because a geometry built at
 * one shoulder height and a pivot placed at another is the single easiest way to
 * end up with a wolf whose legs start inside its ribs. Everything is authored at
 * unit size; `BEAST_PROFILES.scale` sizes the animal in the world.
 *
 * The frame is the same for every creature in this module: **+X is right, +Y is
 * up, +Z is the way it is facing.**
 */
export const BEAST_RIG: Record<BeastKind, BeastRig> = {
  wolf: {
    backHeight: 1.06,
    frontZ: 0.6,
    hindZ: -0.62,
    frontX: 0.24,
    hindX: 0.26,
    frontJointY: 0.94,
    hindJointY: 0.92,
    frontLimb: 0.9,
    hindLimb: 0.88,
    headY: 1.24,
    headZ: 1.08,
    tailY: 1.16,
    tailZ: -1.04,
    footprint: 0.8,
  },
  boar: {
    backHeight: 0.94,
    frontZ: 0.5,
    hindZ: -0.58,
    frontX: 0.26,
    hindX: 0.24,
    frontJointY: 0.82,
    hindJointY: 0.8,
    frontLimb: 0.78,
    hindLimb: 0.76,
    headY: 0.86,
    headZ: 1.16,
    tailY: 1.02,
    tailZ: -0.96,
    footprint: 0.82,
  },
  bear: {
    backHeight: 1.32,
    frontZ: 0.6,
    hindZ: -0.66,
    frontX: 0.36,
    hindX: 0.36,
    frontJointY: 1.2,
    hindJointY: 1.14,
    frontLimb: 1.16,
    hindLimb: 1.1,
    headY: 1.44,
    headZ: 1.2,
    tailY: 1.3,
    tailZ: -0.96,
    footprint: 1.05,
  },
  troll: {
    // Barely a quadruped: it stands on its legs and swings its arms at you, so its
    // body is lofted upright and its "front limbs" are arms.
    backHeight: 1.95,
    frontZ: 0.06,
    hindZ: -0.02,
    frontX: 0.62,
    hindX: 0.34,
    frontJointY: 2.36,
    hindJointY: 1.36,
    frontLimb: 1.5,
    hindLimb: 1.32,
    headY: 2.3,
    headZ: 0.42,
    tailY: 1.5,
    tailZ: -0.52,
    footprint: 1.15,
  },
}

/**
 * Lofts a body along **Z** rather than Y.
 *
 * A quadruped's length runs forward, not upward. Building the loft on its own axis
 * and then standing it down is far easier to read than trying to think in a rotated
 * frame: a section's `y` is how far along the animal it sits, `scaleX` is its width
 * and `scaleZ` is its height.
 */
function bodyAlongZ(
  profile: readonly Vec2Like[],
  sections: readonly LoftSection[],
  name: string,
): THREE.BufferGeometry {
  return transformed(loft({ profile, sections, name }), {
    rotation: { x: Math.PI / 2, y: 0, z: 0 },
  })
}

export function buildBeastBody(kind: BeastKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  if (kind === 'wolf') {
    // Deep chest, tucked belly, long back. Predator proportions.
    parts.push(
      bodyAlongZ(
        rectProfile(0.6, 0.78, 0.16),
        [
          { y: -1.04, scaleX: 0.46, scaleZ: 0.4 },
          { y: -0.74, scaleX: 0.84, scaleZ: 0.8 },
          { y: -0.3, scaleX: 0.8, scaleZ: 0.64 },
          { y: 0.18, scaleX: 0.82, scaleZ: 0.74 },
          { y: 0.6, scaleX: 1, scaleZ: 1 },
          { y: 0.94, scaleX: 0.86, scaleZ: 0.88 },
          { y: 1.1, scaleX: 0.58, scaleZ: 0.6 },
        ],
        'wolf-body',
      ),
      // The neck leaves the chest low and forward, so the head is carried below the
      // shoulders. That line is most of what says "wolf" at thirty metres.
      block(
        { width: 0.38, height: 0.52, depth: 0.42, topScale: 0.84, bevel: 0.08 },
        { position: { x: 0, y: 0.16, z: 1.02 }, rotation: { x: 1.18, y: 0, z: 0 } },
      ),
    )
    // Ruff and hackles along the shoulders.
    for (const z of [0.5, 0.72, 0.9]) {
      parts.push(
        block(
          { width: 0.46, height: 0.16, depth: 0.24, topScale: 0.35, bevel: 0.03 },
          { position: { x: 0, y: 0.34, z }, rotation: { x: -0.5, y: 0, z: 0 } },
        ),
      )
    }
  } else if (kind === 'boar') {
    parts.push(
      bodyAlongZ(
        rectProfile(0.66, 0.7, 0.15),
        [
          { y: -0.96, scaleX: 0.42, scaleZ: 0.38 },
          { y: -0.6, scaleX: 0.76, scaleZ: 0.66 },
          { y: -0.2, scaleX: 0.86, scaleZ: 0.78 },
          { y: 0.28, scaleX: 1, scaleZ: 0.96 },
          { y: 0.6, scaleX: 1.06, scaleZ: 1 },
          { y: 0.9, scaleX: 0.82, scaleZ: 0.82 },
          { y: 1.04, scaleX: 0.56, scaleZ: 0.54 },
        ],
        'boar-body',
      ),
      // The hump. A boar's shoulders stand taller than its hips and that is the
      // entire silhouette; it is a separate mass rather than a fatter section so it
      // sits proud of the back instead of inflating the ribs.
      block(
        { width: 0.6, height: 0.34, depth: 0.72, topScale: 0.62, bevel: 0.1 },
        { position: { x: 0, y: 0.4, z: 0.38 } },
      ),
      block(
        { width: 0.4, height: 0.46, depth: 0.4, topScale: 0.86, bevel: 0.07 },
        { position: { x: 0, y: 0.06, z: 0.94 }, rotation: { x: 1.32, y: 0, z: 0 } },
      ),
    )
    // Bristle ridge down the spine.
    for (let index = 0; index < 5; index += 1) {
      parts.push(
        block(
          {
            width: 0.09,
            height: 0.2 + Math.cos((index / 4) * Math.PI * 0.5) * 0.16,
            depth: 0.14,
            topScale: 0.2,
          },
          {
            position: { x: 0, y: 0.44 - index * 0.05, z: 0.5 - index * 0.3 },
            rotation: { x: -0.4, y: 0, z: 0 },
          },
        ),
      )
    }
  } else if (kind === 'bear') {
    parts.push(
      bodyAlongZ(
        rectProfile(0.84, 0.9, 0.2),
        [
          { y: -0.98, scaleX: 0.6, scaleZ: 0.62 },
          { y: -0.6, scaleX: 0.94, scaleZ: 0.94 },
          { y: -0.1, scaleX: 0.94, scaleZ: 0.9 },
          { y: 0.4, scaleX: 1.02, scaleZ: 1 },
          { y: 0.72, scaleX: 1, scaleZ: 1.02 },
          { y: 0.98, scaleX: 0.82, scaleZ: 0.86 },
          { y: 1.12, scaleX: 0.56, scaleZ: 0.58 },
        ],
        'bear-body',
      ),
      // Shoulder mass, the bear's answer to the boar's hump.
      block(
        { width: 0.76, height: 0.3, depth: 0.84, topScale: 0.72, bevel: 0.12 },
        { position: { x: 0, y: 0.38, z: 0.42 } },
      ),
      block(
        { width: 0.56, height: 0.42, depth: 0.52, topScale: 0.9, bevel: 0.1 },
        { position: { x: 0, y: 0.12, z: 1.02 }, rotation: { x: 1.24, y: 0, z: 0 } },
      ),
    )
  } else {
    // Troll: an upright hunched torso with a stone ridge down its spine. It is not
    // lofted along Z, because it does not walk on its hands.
    parts.push(
      loft({
        profile: rectProfile(1, 0.84, 0.18),
        sections: [
          { y: -0.86, scaleX: 0.82, scaleZ: 0.86 },
          { y: -0.5, scaleX: 0.94, scaleZ: 0.94 },
          { y: 0, scaleX: 1.02, scaleZ: 1 },
          { y: 0.42, scaleX: 1.12, scaleZ: 1.04, offsetZ: -0.06 },
          { y: 0.72, scaleX: 1, scaleZ: 0.92, offsetZ: -0.12 },
          { y: 0.9, scaleX: 0.66, scaleZ: 0.7, offsetZ: -0.1 },
        ],
        name: 'troll-body',
      }),
    )
    for (let index = 0; index < 4; index += 1) {
      parts.push(
        spike(0.13 - index * 0.015, 0.3 - index * 0.04, {
          position: { x: 0, y: 0.5 - index * 0.24, z: -0.42 - index * 0.06 },
          rotation: { x: -1.1, y: 0, z: 0 },
        }),
      )
    }
    parts.push(
      block(
        { width: 0.62, height: 0.34, depth: 0.56, topScale: 0.88, bevel: 0.1 },
        { position: { x: 0, y: 0.62, z: 0.2 }, rotation: { x: 0.75, y: 0, z: 0 } },
      ),
    )
  }
  return finish(parts, `beast-body:${kind}`)
}

export function buildBeastHead(kind: BeastKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  if (kind === 'wolf') {
    parts.push(
      bodyAlongZ(
        rectProfile(0.4, 0.4, 0.11),
        [
          { y: -0.42, scaleX: 0.86, scaleZ: 0.9 },
          { y: -0.1, scaleX: 1, scaleZ: 1 },
          { y: 0.16, scaleX: 0.78, scaleZ: 0.82 },
          { y: 0.42, scaleX: 0.5, scaleZ: 0.52 },
          { y: 0.62, scaleX: 0.4, scaleZ: 0.4 },
        ],
        'wolf-skull',
      ),
      // The muzzle drops at the tip, which is what makes it a snout and not a cone.
      block(
        { width: 0.2, height: 0.2, depth: 0.28, topScale: 0.8, bevel: 0.04 },
        { position: { x: 0, y: -0.06, z: 0.56 }, rotation: { x: 0.1, y: 0, z: 0 } },
      ),
      // Pricked ears, set well back.
      ...mirroredPairX(() =>
        plate(
          [
            { x: -0.09, y: -0.1 },
            { x: 0.09, y: -0.12 },
            { x: 0.02, y: 0.26 },
          ],
          0.05,
          { position: { x: 0.15, y: 0.24, z: -0.16 }, rotation: { x: -0.24, y: 0, z: 0.2 } },
        ),
      ),
    )
  } else if (kind === 'boar') {
    parts.push(
      bodyAlongZ(
        rectProfile(0.44, 0.44, 0.12),
        [
          { y: -0.34, scaleX: 1, scaleZ: 1 },
          { y: 0.02, scaleX: 0.9, scaleZ: 0.92 },
          { y: 0.36, scaleX: 0.58, scaleZ: 0.6 },
          { y: 0.6, scaleX: 0.46, scaleZ: 0.48 },
        ],
        'boar-skull',
      ),
      // A blunt disc snout.
      block(
        { width: 0.26, height: 0.24, depth: 0.1, bevel: 0.05 },
        { position: { x: 0, y: -0.02, z: 0.64 } },
      ),
      ...mirroredPairX(() =>
        transformed(
          tubeAlongPoints(
            [
              { x: 0, y: 0, z: 0 },
              { x: 0.03, y: 0.16, z: 0.03 },
              { x: 0.01, y: 0.3, z: -0.06 },
            ],
            {
              radius: (t) => 0.045 * (1 - t) + 0.008,
              radialSegments: 5,
              tubularSegments: 6,
              capStart: true,
              name: 'tusk',
            },
          ),
          { position: { x: 0.13, y: -0.1, z: 0.5 } },
        ),
      ),
      ...mirroredPairX(() =>
        plate(
          [
            { x: -0.07, y: -0.08 },
            { x: 0.07, y: -0.08 },
            { x: 0.03, y: 0.16 },
          ],
          0.04,
          { position: { x: 0.17, y: 0.16, z: -0.14 }, rotation: { x: -0.3, y: 0, z: 0.4 } },
        ),
      ),
    )
  } else if (kind === 'bear') {
    parts.push(
      bodyAlongZ(
        rectProfile(0.5, 0.5, 0.14),
        [
          { y: -0.32, scaleX: 0.96, scaleZ: 0.96 },
          { y: 0.02, scaleX: 1, scaleZ: 1 },
          { y: 0.3, scaleX: 0.7, scaleZ: 0.72 },
          { y: 0.56, scaleX: 0.52, scaleZ: 0.54 },
        ],
        'bear-skull',
      ),
      block(
        { width: 0.24, height: 0.2, depth: 0.14, bevel: 0.05 },
        { position: { x: 0, y: -0.04, z: 0.6 } },
      ),
      // Small round ears, high and wide. A bear's ears are its tell.
      ...mirroredPairX(() =>
        transformed(
          latheProfile(
            [
              { x: 0.001, y: -0.05 },
              { x: 0.11, y: -0.03 },
              { x: 0.11, y: 0.04 },
              { x: 0.001, y: 0.07 },
            ],
            { segments: 7, name: 'bear-ear' },
          ),
          { position: { x: 0.22, y: 0.24, z: -0.1 }, rotation: { x: 0, y: 0, z: Math.PI / 2 } },
        ),
      ),
    )
  } else {
    parts.push(
      bodyAlongZ(
        rectProfile(0.58, 0.54, 0.14),
        [
          { y: -0.34, scaleX: 1.04, scaleZ: 0.96 },
          { y: -0.04, scaleX: 1, scaleZ: 1 },
          { y: 0.24, scaleX: 0.8, scaleZ: 0.84 },
          { y: 0.42, scaleX: 0.52, scaleZ: 0.56 },
        ],
        'troll-skull',
      ),
      // A jaw that juts past the brow, with a lower tooth row.
      block(
        { width: 0.48, height: 0.2, depth: 0.32, topScale: 0.86, bevel: 0.05 },
        { position: { x: 0, y: -0.2, z: 0.24 } },
      ),
      ...mirroredPairX(() =>
        spike(0.05, 0.18, {
          position: { x: 0.15, y: -0.12, z: 0.34 },
          rotation: { x: 0.25, y: 0, z: 0.1 },
        }),
      ),
      // Brow shelf.
      block(
        { width: 0.54, height: 0.11, depth: 0.18, topScale: 0.8, bevel: 0.03 },
        { position: { x: 0, y: 0.14, z: 0.24 }, rotation: { x: -0.28, y: 0, z: 0 } },
      ),
      ...mirroredPairX(() =>
        spike(0.06, 0.22, {
          position: { x: 0.22, y: 0.22, z: -0.04 },
          rotation: { x: -0.2, y: 0, z: 0.42 },
        }),
      ),
    )
  }
  return finish(parts, `beast-head:${kind}`)
}

/** One limb, hanging from its joint at the origin. */
export function buildBeastLimb(
  kind: BeastKind,
  front: boolean,
  length: number,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const thickness =
    kind === 'wolf' ? 0.17 : kind === 'boar' ? 0.19 : kind === 'bear' ? 0.26 : 0.3
  const upper = length * 0.52
  parts.push(
    loft({
      profile: rectProfile(thickness, thickness * 1.15, 0.04),
      sections: [
        { y: 0.06, scaleX: 1.2, scaleZ: 1.24 },
        { y: -upper * 0.5, scaleX: 1.02, scaleZ: 1.08 },
        { y: -upper, scaleX: 0.82, scaleZ: 0.86 },
      ],
      name: 'limb-upper',
    }),
  )
  // Digitigrade animals get a visible hock that kicks backwards; the troll and the
  // bear stand on their heels.
  const hock = kind === 'wolf' || kind === 'boar' ? (front ? 0.06 : -0.12) : 0
  parts.push(
    transformed(
      loft({
        profile: rectProfile(thickness * 0.82, thickness * 0.94, 0.04),
        sections: [
          { y: 0.04, scaleX: 1, scaleZ: 1.04 },
          { y: -(length - upper) * 0.6, scaleX: 0.82, scaleZ: 0.86 },
          { y: -(length - upper), scaleX: 0.74, scaleZ: 0.8 },
        ],
        name: 'limb-lower',
      }),
      { position: { x: 0, y: -upper, z: hock }, rotation: { x: -hock * 1.6, y: 0, z: 0 } },
    ),
  )
  const pawWidth = thickness * (kind === 'bear' || kind === 'troll' ? 1.5 : 1.1)
  parts.push(
    block(
      {
        width: pawWidth,
        height: thickness * 0.6,
        depth: pawWidth * (kind === 'boar' ? 0.9 : 1.35),
        topScale: 0.9,
        bevel: 0.03,
      },
      { position: { x: 0, y: -length + thickness * 0.28, z: hock + pawWidth * 0.12 } },
    ),
  )
  if (kind === 'bear' || kind === 'troll') {
    // Claws. Only worth building on the animals that show them.
    for (const offset of [-0.28, 0, 0.28]) {
      parts.push(
        spike(thickness * 0.14, thickness * 0.5, {
          position: {
            x: offset * pawWidth,
            y: -length + thickness * 0.22,
            z: hock + pawWidth * 0.68,
          },
          rotation: { x: Math.PI / 2 - 0.3, y: 0, z: 0 },
        }),
      )
    }
  }
  return finish(parts, `beast-limb:${kind}:${front ? 'front' : 'hind'}`)
}

export function buildBeastTail(kind: BeastKind): THREE.BufferGeometry {
  if (kind === 'wolf') {
    return finish(
      [
        tubeAlongPoints(
          [
            { x: 0, y: 0, z: 0 },
            { x: 0, y: -0.16, z: -0.36 },
            { x: 0, y: -0.34, z: -0.72 },
            { x: 0, y: -0.44, z: -1.02 },
          ],
          {
            radius: (t) => 0.12 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.7) + 0.03,
            radialSegments: 6,
            tubularSegments: 9,
            capStart: true,
            capEnd: true,
            name: 'wolf-tail',
          },
        ),
      ],
      'beast-tail:wolf',
    )
  }
  if (kind === 'boar') {
    return finish(
      [
        tubeAlongPoints(
          [
            { x: 0, y: 0, z: 0 },
            { x: 0.04, y: 0.12, z: -0.16 },
            { x: -0.04, y: 0.04, z: -0.3 },
          ],
          { radius: 0.035, radialSegments: 5, tubularSegments: 6, capStart: true, name: 'boar-tail' },
        ),
        block(
          { width: 0.09, height: 0.14, depth: 0.06, topScale: 0.3 },
          { position: { x: -0.04, y: -0.04, z: -0.34 }, rotation: { x: -0.6, y: 0, z: 0 } },
        ),
      ],
      'beast-tail:boar',
    )
  }
  // A stub, for animals that have one.
  return finish(
    [
      block(
        { width: 0.16, height: 0.22, depth: 0.16, topScale: 0.4, bevel: 0.04 },
        { rotation: { x: -1.9, y: 0, z: 0 } },
      ),
    ],
    `beast-tail:${kind}`,
  )
}

// ---------------------------------------------------------------------------
// Ambient fauna
// ---------------------------------------------------------------------------

/** Deer torso, neck, head and tail, merged. Origin at the body centre. */
export function buildDeerBody(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    bodyAlongZ(
      rectProfile(0.46, 0.54, 0.13),
      [
        { y: -0.82, scaleX: 0.54, scaleZ: 0.5 },
        { y: -0.54, scaleX: 0.92, scaleZ: 0.86 },
        { y: -0.16, scaleX: 0.94, scaleZ: 0.8 },
        { y: 0.24, scaleX: 0.86, scaleZ: 0.8 },
        { y: 0.58, scaleX: 1, scaleZ: 1 },
        { y: 0.8, scaleX: 0.74, scaleZ: 0.78 },
      ],
      'deer-torso',
    ),
    // The neck is a curve, not a stick: it leaves the chest forward and rises.
    tubeAlongPoints(
      [
        { x: 0, y: 0.12, z: 0.72 },
        { x: 0, y: 0.36, z: 0.88 },
        { x: 0, y: 0.6, z: 1.0 },
        { x: 0, y: 0.7, z: 1.12 },
      ],
      {
        radius: (t) => 0.17 - t * 0.06,
        radialSegments: 6,
        tubularSegments: 7,
        capStart: true,
        name: 'deer-neck',
      },
    ),
    block(
      { width: 0.24, height: 0.24, depth: 0.42, topScale: 0.8, bevel: 0.05, shearZ: 0.06 },
      { position: { x: 0, y: 0.76, z: 1.28 }, rotation: { x: 0.34, y: 0, z: 0 } },
    ),
    ...mirroredPairX(() =>
      plate(
        [
          { x: -0.06, y: -0.1 },
          { x: 0.07, y: -0.1 },
          { x: 0.01, y: 0.2 },
        ],
        0.04,
        { position: { x: 0.15, y: 0.82, z: 1.16 }, rotation: { x: -0.2, y: 0, z: 0.66 } },
      ),
    ),
    block(
      { width: 0.14, height: 0.2, depth: 0.1, topScale: 0.5, bevel: 0.03 },
      { position: { x: 0, y: 0.22, z: -0.84 }, rotation: { x: 0.8, y: 0, z: 0 } },
    ),
  ]
  return finish(parts, 'deer-body')
}

/** Antlers and muzzle: the dark layer of a deer. */
export function buildDeerCrown(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    block(
      { width: 0.15, height: 0.14, depth: 0.16, topScale: 0.72, bevel: 0.03 },
      { position: { x: 0, y: 0.7, z: 1.48 } },
    ),
  ]
  const antlerSide = (): THREE.BufferGeometry[] => {
    const side: THREE.BufferGeometry[] = [
      transformed(
        tubeAlongPoints(
          [
            { x: 0, y: 0, z: 0 },
            { x: 0.1, y: 0.22, z: -0.04 },
            { x: 0.18, y: 0.44, z: -0.14 },
            { x: 0.3, y: 0.56, z: -0.28 },
          ],
          {
            radius: (t) => 0.05 * (1 - t) + 0.012,
            radialSegments: 5,
            tubularSegments: 8,
            capStart: true,
            name: 'antler-beam',
          },
        ),
        { position: { x: 0.1, y: 0.9, z: 1.12 } },
      ),
    ]
    for (const [t, lift] of [
      [0.24, 0.22],
      [0.52, 0.26],
    ] as const) {
      side.push(
        transformed(
          tubeAlongPoints(
            [
              { x: 0, y: 0, z: 0 },
              { x: 0.04, y: lift * 0.6, z: 0.06 },
              { x: 0.06, y: lift, z: 0.14 },
            ],
            {
              radius: (p) => 0.03 * (1 - p) + 0.008,
              radialSegments: 4,
              tubularSegments: 5,
              capStart: true,
              name: 'antler-tine',
            },
          ),
          { position: { x: 0.1 + t * 0.22, y: 0.9 + t * 0.5, z: 1.12 - t * 0.3 } },
        ),
      )
    }
    return side
  }
  parts.push(...antlerSide(), ...antlerSide().map((geometry) => mirrorX(geometry)))
  return finish(parts, 'deer-crown')
}

/** One deer leg, hanging from the hip at the origin. */
export function buildDeerLeg(front: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    loft({
      profile: rectProfile(0.14, 0.16, 0.03),
      sections: [
        { y: 0.06, scaleX: 1.3, scaleZ: 1.3 },
        { y: -0.34, scaleX: 0.86, scaleZ: 0.88 },
        { y: -0.5, scaleX: 0.62, scaleZ: 0.66 },
      ],
      name: 'deer-upper-leg',
    }),
    transformed(
      loft({
        profile: rectProfile(0.09, 0.1, 0.02),
        sections: [
          { y: 0.04, scaleX: 1, scaleZ: 1 },
          { y: -0.36, scaleX: 0.78, scaleZ: 0.8 },
        ],
        name: 'deer-lower-leg',
      }),
      { position: { x: 0, y: -0.5, z: front ? 0.03 : -0.05 }, rotation: { x: front ? -0.06 : 0.1, y: 0, z: 0 } },
    ),
    block(
      { width: 0.1, height: 0.09, depth: 0.14, bevel: 0.02 },
      { position: { x: 0, y: -0.9, z: front ? 0.05 : -0.02 } },
    ),
  ]
  return finish(parts, `deer-leg:${front ? 'front' : 'hind'}`)
}

export function buildBirdBody(): THREE.BufferGeometry {
  // Authored nose-forward in the shared frame rather than lofted upright and
  // rotated afterwards: `BufferGeometry.rotateX` transforms position and normal
  // but not custom attributes, so rotating after `finish` would leave the baked
  // `outlineNormal` pointing along the old axes and crack the ink.
  const parts: THREE.BufferGeometry[] = [
    bodyAlongZ(
      rectProfile(0.19, 0.19, 0.06),
      [
        { y: -0.2, scaleX: 0.34, scaleZ: 0.3 },
        { y: -0.06, scaleX: 0.86, scaleZ: 0.86 },
        { y: 0.1, scaleX: 1, scaleZ: 1 },
        { y: 0.24, scaleX: 0.72, scaleZ: 0.74 },
      ],
      'bird-torso',
    ),
    block(
      { width: 0.14, height: 0.13, depth: 0.15, bevel: 0.04 },
      { position: { x: 0, y: 0.08, z: 0.18 } },
    ),
    // A tail fan, three vanes rather than one bar.
    ...[-0.22, 0, 0.22].map((angle) =>
      block(
        { width: 0.06, height: 0.03, depth: 0.24, bottomScale: 0.6 },
        { position: { x: 0, y: 0.02, z: -0.28 }, rotation: { x: 0.12, y: angle, z: 0 } },
      ),
    ),
  ]
  return finish(parts, 'bird-body')
}

/** Both wings in one buffer, so a single `rotation.z` flaps them in opposition. */
export function buildBirdWing(): THREE.BufferGeometry {
  const parts = mirroredPairX(() =>
    plate(
      [
        { x: 0, y: -0.05 },
        { x: 0.22, y: -0.09 },
        { x: 0.4, y: -0.04 },
        { x: 0.34, y: 0.05 },
        { x: 0.1, y: 0.07 },
      ],
      0.022,
      { rotation: { x: Math.PI / 2, y: 0, z: 0 } },
    ),
  )
  return finish(parts, 'bird-wing')
}

// ---------------------------------------------------------------------------
// The caravan
// ---------------------------------------------------------------------------

/**
 * The game is named after this thing, so it gets built like a cart: a ladder
 * frame, an axle, wheels with spokes, a plank bed, a tilt over five bows, and a
 * team in harness. Length runs along +X, which is the direction it travels.
 */
export function buildWagonFrame(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  // Two side rails running the length of the cart...
  for (const z of [-1.24, 1.24]) {
    parts.push(
      block(
        { width: 5.1, height: 0.22, depth: 0.24, bevel: 0.04 },
        { position: { x: 0, y: 1.5, z } },
      ),
    )
  }
  // ...and five cross members between them. A ladder frame, which is what a cart
  // that carries anything heavier than hay actually needs.
  for (const x of [-2.1, -1.05, 0, 1.05, 2.1]) {
    parts.push(
      block(
        { width: 0.2, height: 0.16, depth: 2.7, bevel: 0.03 },
        { position: { x, y: 1.46, z: 0 } },
      ),
    )
  }
  parts.push(
    // The draw pole and the bolster the front axle swivels on.
    block(
      { width: 2.9, height: 0.18, depth: 0.18, topScale: 0.7, bevel: 0.03 },
      { position: { x: 3.6, y: 1.16, z: 0 }, rotation: { x: 0, y: 0, z: -0.06 } },
    ),
    block(
      { width: 0.36, height: 0.2, depth: 1.6, bevel: 0.04 },
      { position: { x: 2.1, y: 1.3, z: 0 } },
    ),
    // Two braces from the pole up to the frame. They sit on either side of the
    // cart, which is a separation on Z — the wagon runs along X.
    ...mirroredPairZ(() =>
      block(
        { width: 1.5, height: 0.11, depth: 0.11 },
        { position: { x: 2.9, y: 1.3, z: 0.34 }, rotation: { x: 0, y: -0.28, z: 0.12 } },
      ),
    ),
  )
  return finish(parts, 'wagon-frame')
}

export function buildWagonAxle(width: number): THREE.BufferGeometry {
  return finish(
    [
      block(
        { width: 0.17, height: 0.17, depth: width, bevel: 0.03 },
        {},
      ),
      ...mirroredPairZ(() =>
        block(
          { width: 0.24, height: 0.24, depth: 0.22, bevel: 0.03 },
          { position: { x: 0, y: 0, z: width / 2 - 0.16 } },
        ),
      ),
    ],
    'wagon-axle',
  )
}

/** A wheel in the XY plane, so the engine can spin it on Z. */
export function buildWagonWheel(radius: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const width = 0.2
  // Hub.
  parts.push(
    transformed(
      latheProfile(
        [
          { x: 0.001, y: -width * 0.9 },
          { x: 0.15, y: -width * 0.9 },
          { x: 0.19, y: -width * 0.4 },
          { x: 0.19, y: width * 0.4 },
          { x: 0.15, y: width * 0.9 },
          { x: 0.001, y: width * 0.9 },
        ],
        { segments: 9, name: 'wheel-hub' },
      ),
      { rotation: { x: Math.PI / 2, y: 0, z: 0 } },
    ),
  )
  const spokes = 10
  for (let index = 0; index < spokes; index += 1) {
    const angle = (index / spokes) * Math.PI * 2
    parts.push(
      block(
        { width: 0.075, height: radius - 0.12, depth: 0.085, topScale: 0.8, bevel: 0.015 },
        {
          position: {
            x: Math.cos(angle) * (radius * 0.5),
            y: Math.sin(angle) * (radius * 0.5),
            z: 0,
          },
          rotation: { x: 0, y: 0, z: angle - Math.PI / 2 },
        },
      ),
    )
  }
  // Felloe and iron tyre, built as a low-segment lathe ring in the XY plane.
  parts.push(
    transformed(
      latheProfile(
        [
          { x: radius - 0.13, y: -width * 0.5 },
          { x: radius - 0.02, y: -width * 0.5 },
          { x: radius, y: 0 },
          { x: radius - 0.02, y: width * 0.5 },
          { x: radius - 0.13, y: width * 0.5 },
        ],
        { segments: 14, name: 'wheel-rim' },
      ),
      { rotation: { x: Math.PI / 2, y: 0, z: 0 } },
    ),
  )
  return finish(parts, `wagon-wheel:${radius.toFixed(2)}`)
}

export function buildWagonBed(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  // Planks with visible seams. Six boards read as a deck; one box reads as a lid.
  for (let index = 0; index < 6; index += 1) {
    parts.push(
      block(
        { width: 4.9, height: 0.13, depth: 0.4, bevel: 0.02 },
        { position: { x: 0, y: 1.68, z: -1.05 + index * 0.42 } },
      ),
    )
  }
  // Side boards and a tail board.
  for (const z of [-1.3, 1.3]) {
    parts.push(
      block(
        { width: 4.9, height: 0.46, depth: 0.13, topScale: 0.96, bevel: 0.03 },
        { position: { x: 0, y: 1.94, z } },
      ),
    )
  }
  parts.push(
    block(
      { width: 0.13, height: 0.66, depth: 2.6, topScale: 0.94, bevel: 0.03 },
      { position: { x: -2.42, y: 2.02, z: 0 }, rotation: { x: 0, y: 0, z: -0.14 } },
    ),
    block(
      { width: 0.13, height: 0.4, depth: 2.6, bevel: 0.03 },
      { position: { x: 2.42, y: 1.92, z: 0 } },
    ),
    // A bench for whoever is driving.
    block(
      { width: 0.5, height: 0.14, depth: 1.5, bevel: 0.03 },
      { position: { x: 2.05, y: 2.3, z: 0 } },
    ),
    block(
      { width: 0.14, height: 0.42, depth: 1.5, bevel: 0.03 },
      { position: { x: 2.28, y: 2.5, z: 0 }, rotation: { x: 0, y: 0, z: 0.12 } },
    ),
  )
  return finish(parts, 'wagon-bed')
}

/** The tilt: four bows over the front of the bed and the canvas stretched on them. */
export function buildWagonTilt(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  // The tilt covers the front of the bed and stops short of the tail, so the load
  // stays visible. That is also the shape the interaction code needs: `cargo` is
  // what the player robs, and a canopy over the whole bed hides both the crates
  // and the interactable ink that marks them.
  const bowXs = [-0.15, 0.55, 1.25, 1.9]
  for (const x of bowXs) {
    parts.push(
      transformed(
        tubeAlongPoints(
          [
            { x: 0, y: 0, z: -1.3 },
            { x: 0, y: 0.72, z: -1.16 },
            { x: 0, y: 1.16, z: -0.66 },
            { x: 0, y: 1.28, z: 0 },
            { x: 0, y: 1.16, z: 0.66 },
            { x: 0, y: 0.72, z: 1.16 },
            { x: 0, y: 0, z: 1.3 },
          ],
          { radius: 0.055, radialSegments: 5, tubularSegments: 14, name: 'tilt-bow' },
        ),
        { position: { x, y: 2.16, z: 0 } },
      ),
    )
  }
  // The canvas: eight longitudinal panels following the bows, so it creases.
  const arc: readonly (readonly [number, number])[] = [
    [-1.34, 0],
    [-1.2, 0.74],
    [-0.68, 1.2],
    [0, 1.32],
    [0.68, 1.2],
    [1.2, 0.74],
    [1.34, 0],
  ]
  for (let index = 0; index < arc.length - 1; index += 1) {
    const [z0, y0] = arc[index]
    const [z1, y1] = arc[index + 1]
    const midZ = (z0 + z1) / 2
    const midY = (y0 + y1) / 2
    const span = Math.hypot(z1 - z0, y1 - y0)
    parts.push(
      block(
        { width: 2.35, height: 0.05, depth: span * 1.04, bevel: 0.01 },
        {
          position: { x: 0.88, y: 2.16 + midY, z: midZ },
          // A box's depth axis is +Z; rotating it by θ about X sends that axis to
          // (0, −sinθ, cosθ). Aligning it with the arc segment (0, Δy, Δz) is
          // therefore `atan2(−Δy, Δz)`, and the unnegated version lays every
          // panel across its own bow instead of along it.
          rotation: { x: Math.atan2(-(y1 - y0), z1 - z0), y: 0, z: 0 },
        },
      ),
    )
  }
  // A rolled front flap and a scalloped rear hem.
  parts.push(
    transformed(
      tubeAlongPoints(
        [
          { x: 0, y: 0, z: -1.16 },
          { x: 0, y: 0.5, z: -1.02 },
          { x: 0, y: 0.86, z: -0.56 },
          { x: 0, y: 0.96, z: 0 },
          { x: 0, y: 0.86, z: 0.56 },
          { x: 0, y: 0.5, z: 1.02 },
          { x: 0, y: 0, z: 1.16 },
        ],
        { radius: 0.12, radialSegments: 5, tubularSegments: 12, name: 'tilt-roll' },
      ),
      { position: { x: 1.86, y: 2.36, z: 0 } },
    ),
  )
  for (let index = 0; index < 5; index += 1) {
    parts.push(
      block(
        { width: 0.05, height: 0.2, depth: 0.4, bottomScale: 0.4 },
        { position: { x: -0.24, y: 2.02, z: -1.0 + index * 0.5 } },
      ),
    )
  }
  return finish(parts, 'wagon-tilt')
}

export function buildWagonCargo(gilded: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const barrel = (x: number, z: number, height: number): THREE.BufferGeometry =>
    transformed(
      latheProfile(
        [
          { x: 0.001, y: -height / 2 },
          { x: 0.3, y: -height / 2 },
          { x: 0.36, y: -height * 0.2 },
          { x: 0.36, y: height * 0.2 },
          { x: 0.3, y: height / 2 },
          { x: 0.001, y: height / 2 },
        ],
        { segments: 9, name: 'barrel' },
      ),
      { position: { x, y: 1.78 + height / 2, z } },
    )
  parts.push(barrel(-1.5, -0.6, 0.86), barrel(-1.5, 0.6, 0.86), barrel(-0.7, 0, 0.72))
  for (const [x, z, y, size] of [
    [0.6, -0.55, 0, 0.72],
    [0.55, 0.6, 0, 0.62],
    [0.62, -0.2, 0.72, 0.5],
  ] as const) {
    parts.push(
      block(
        { width: size * 1.4, height: size, depth: size * 1.2, bevel: 0.05 },
        { position: { x, y: 1.78 + y + size / 2, z }, rotation: { x: 0, y: x * 0.3, z: 0 } },
      ),
    )
  }
  // Sacks: lumpy, so the load does not read as a stack of dice.
  for (const [x, z] of [
    [1.35, -0.4],
    [1.3, 0.5],
  ] as const) {
    parts.push(
      transformed(
        loft({
          profile: polygonProfile(0.34, 7),
          sections: [
            { y: -0.3, scaleX: 0.66 },
            { y: -0.1, scaleX: 1.04 },
            { y: 0.16, scaleX: 0.92 },
            { y: 0.32, scaleX: 0.4 },
          ],
          name: 'sack',
        }),
        { position: { x, y: 2.1, z } },
      ),
    )
  }
  // Lashings across the whole load.
  for (const x of [-1.5, 0.6]) {
    parts.push(
      block(
        { width: 0.07, height: 0.07, depth: 2.7 },
        { position: { x, y: 2.6, z: 0 } },
      ),
    )
  }
  if (gilded) {
    // A strongbox, because a gilded caravan needs one thing worth stealing.
    parts.push(
      block(
        { width: 0.9, height: 0.5, depth: 0.7, bevel: 0.05 },
        { position: { x: -0.05, y: 2.66, z: 0 } },
      ),
      block(
        { width: 0.96, height: 0.12, depth: 0.16, bevel: 0.03 },
        { position: { x: -0.05, y: 2.92, z: 0 } },
      ),
    )
  }
  return finish(parts, `wagon-cargo:${gilded ? 'gilded' : 'plain'}`).translate(0, -2.45, 0)
}

/** A draft ox: heavy at the shoulder, head carried low. Origin between its feet. */
export function buildOxBody(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    bodyAlongZ(
      rectProfile(0.86, 0.92, 0.18),
      [
        { y: -1.0, scaleX: 0.66, scaleZ: 0.66 },
        { y: -0.6, scaleX: 0.96, scaleZ: 0.92 },
        { y: -0.1, scaleX: 1, scaleZ: 0.98 },
        { y: 0.44, scaleX: 1.04, scaleZ: 1.06 },
        { y: 0.78, scaleX: 0.9, scaleZ: 0.96 },
        { y: 0.98, scaleX: 0.6, scaleZ: 0.66 },
      ],
      'ox-torso',
    ).translate(0, 1.44, 0),
    // Withers hump, the mark of a draft animal.
    block(
      { width: 0.6, height: 0.32, depth: 0.7, topScale: 0.7, bevel: 0.1 },
      { position: { x: 0, y: 1.82, z: 0.42 } },
    ),
    // Neck, dropping forward and down into the yoke.
    block(
      { width: 0.52, height: 0.6, depth: 0.5, topScale: 0.82, bevel: 0.08 },
      { position: { x: 0, y: 1.6, z: 0.94 }, rotation: { x: 1.05, y: 0, z: 0 } },
    ),
    // Dewlap.
    block(
      { width: 0.24, height: 0.4, depth: 0.34, topScale: 0.6, bevel: 0.05 },
      { position: { x: 0, y: 1.24, z: 1.02 }, rotation: { x: 0.4, y: 0, z: 0 } },
    ),
    block(
      { width: 0.12, height: 0.5, depth: 0.12, bottomScale: 0.4, bevel: 0.03 },
      { position: { x: 0, y: 1.5, z: -1.06 }, rotation: { x: -0.35, y: 0, z: 0 } },
    ),
  ]
  for (const [x, z] of [
    [-0.34, 0.6],
    [0.34, 0.6],
    [-0.34, -0.6],
    [0.34, -0.6],
  ] as const) {
    parts.push(
      loft({
        profile: rectProfile(0.24, 0.26, 0.05),
        sections: [
          { y: 0.1, scaleX: 1.3, scaleZ: 1.3 },
          { y: -0.6, scaleX: 0.9, scaleZ: 0.92 },
          { y: -1.1, scaleX: 0.8, scaleZ: 0.84 },
        ],
        name: 'ox-leg',
      }).translate(x, 1.2, z),
      block(
        { width: 0.28, height: 0.14, depth: 0.32, bevel: 0.03 },
        { position: { x, y: 0.14, z } },
      ),
    )
  }
  return finish(parts, 'ox-body')
}

export function buildOxHead(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    bodyAlongZ(
      rectProfile(0.34, 0.38, 0.09),
      [
        { y: -0.28, scaleX: 1, scaleZ: 1 },
        { y: 0.04, scaleX: 0.92, scaleZ: 0.94 },
        { y: 0.34, scaleX: 0.6, scaleZ: 0.66 },
        { y: 0.62, scaleX: 0.52, scaleZ: 0.56 },
      ],
      'ox-skull',
    ),
    // A long blunt muzzle, so the head reads as a head and not as a disc.
    block(
      { width: 0.22, height: 0.2, depth: 0.26, topScale: 0.9, bevel: 0.05 },
      { position: { x: 0, y: -0.05, z: 0.72 } },
    ),
    ...mirroredPairX(() =>
      transformed(
        tubeAlongPoints(
          [
            { x: 0, y: 0, z: 0 },
            { x: 0.14, y: 0.08, z: -0.02 },
            { x: 0.26, y: 0.17, z: -0.08 },
            { x: 0.33, y: 0.29, z: -0.06 },
          ],
          {
            radius: (t) => 0.06 * (1 - t) + 0.012,
            radialSegments: 5,
            tubularSegments: 8,
            capStart: true,
            name: 'ox-horn',
          },
        ),
        { position: { x: 0.13, y: 0.16, z: -0.06 } },
      ),
    ),
    ...mirroredPairX(() =>
      block(
        { width: 0.07, height: 0.17, depth: 0.12, topScale: 0.6, bevel: 0.03 },
        { position: { x: 0.2, y: 0.03, z: -0.1 }, rotation: { x: 0, y: 0, z: 0.7 } },
      ),
    ),
  ]
  return finish(parts, 'ox-head')
}

/** Yoke, traces and collar bars linking the team to the draw pole. */
export function buildHarness(): THREE.BufferGeometry {
  const yokeX = 5.62
  const parts: THREE.BufferGeometry[] = [
    block(
      { width: 0.22, height: 2.5, depth: 0.22, bevel: 0.04 },
      { position: { x: yokeX, y: 2.16, z: 0 }, rotation: { x: Math.PI / 2, y: 0, z: 0 } },
    ),
  ]
  for (const side of [-1, 1]) {
    parts.push(
      // Bows under the neck.
      transformed(
        tubeAlongPoints(
          [
            { x: 0, y: 0, z: -0.34 },
            { x: 0, y: -0.42, z: -0.3 },
            { x: 0, y: -0.56, z: 0 },
            { x: 0, y: -0.42, z: 0.3 },
            { x: 0, y: 0, z: 0.34 },
          ],
          { radius: 0.055, radialSegments: 5, tubularSegments: 10, name: 'yoke-bow' },
        ),
        { position: { x: yokeX, y: 2.16, z: side * WAGON_RIG.oxZ } },
      ),
      // Traces running back to the pole.
      block(
        { width: 2.6, height: 0.07, depth: 0.07 },
        { position: { x: 4.4, y: 1.9, z: side * 0.62 }, rotation: { x: 0, y: side * 0.14, z: 0.14 } },
      ),
    )
  }
  return finish(parts, 'wagon-harness')
}

/** Where the wagon's parts sit, shared with the engine so nothing drifts. */
export const WAGON_RIG = {
  rearWheelRadius: 1.02,
  frontWheelRadius: 0.78,
  rearAxleX: -1.62,
  frontAxleX: 1.66,
  wheelZ: 1.42,
  axleWidth: 3.1,
  oxZ: 0.78,
  oxX: 4.72,
  oxHeadY: 1.74,
  oxHeadZ: 1.24,
} as const






