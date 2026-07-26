/**
 * Layer 5 — ambient life, as data.
 *
 * The same shape as `Chronicle`, `Materialization`, `Fauna`, `WorldEnvironment` and
 * `ActorAi`: no THREE, no scene graph, no actor objects. `GameEngine` turns the numbers
 * here into villagers, deer, crows and campfires.
 *
 * **The load-bearing decision in this layer is which of those needs an actor slot, and
 * the answer is: only the villagers.** Layer 5 was scoped as "the cheapest perceived
 * value per actor slot in the whole feature", and the cheapest possible is *zero* slots.
 * Wildlife is explicitly *non-combat*, so a deer that cannot be fought does not need to
 * be an `Actor` — it needs a mesh and a reason to run away. The same goes for campfires,
 * torches and the storm hunch. That leaves the whole `ambient` reserve for the one thing
 * in this layer that can die, and it means none of the rest can ever crowd out a raid.
 *
 * Determinism: every roll takes a seeded `RandomStream`. The only unseeded randomness in
 * Layer 5 is per-frame visual jitter in `GameEngine` (flame flicker, wing flap phase),
 * which no simulation value reads — it is called out at each site.
 */

import type { RandomStream } from '../random/RandomStream.ts'

// ---------------------------------------------------------------------------
// Civilians
// ---------------------------------------------------------------------------

/**
 * Most a settlement ever puts on the board at once, before the `ambient` budget has its
 * say. Deliberately under the six-slot reserve: prowlers and caravan escorts are charged
 * to `ambient` too, and a village that starves the wolves out of the forest would be a
 * worse world than one with two villagers in it.
 */
export const AMBIENT_CIVILIAN_LIMIT = 3
/** How close the player has to be to a settlement before anybody is home. */
export const CIVILIAN_SPAWN_RADIUS = 58
/** Villagers keep to their village; past this from the settlement they turn back. */
export const CIVILIAN_HOME_RADIUS = 16
/** Seconds between civilian population checks. Cheap, but not free. */
export const CIVILIAN_INTERVAL = 5
/** A settlement below this integrity has nobody left to walk between the houses. */
export const CIVILIAN_MIN_INTEGRITY = 25

/**
 * How far a villager notices something worth running from. Shorter than a soldier's
 * 15 m sense range on purpose: a villager reacts to a fight in the street, not to one
 * across the square, so a raid arrives *before* the village empties.
 */
export const CIVILIAN_ALARM_RADIUS = 12
/** Seconds a villager keeps running before it is willing to look back. */
export const CIVILIAN_PANIC_SECONDS = 4
/**
 * How much faster a villager runs in a panic than it walks.
 *
 * **This number was measured, not chosen.** At the `1.15×` every routing actor gets, a
 * villager makes 3.57 m/s against a wolf's 5.4, so it cannot escape and scattering saved
 * exactly zero lives — 180 civilian deaths in 60 fights with the mechanic on and 180 with
 * it off (§9). A behaviour whose whole point is getting away, that never gets away, is
 * dead content in the same way Layer 3's rout rule was.
 *
 * `1.55` puts a panicking villager at 4.8 m/s: a **wolf still runs it down**, slowly, so a
 * raid on a village still reads as a raid on a village — but a bear (3.4) or a troll (2.9)
 * never will, and a villager with a head start can make the treeline. The asymmetry is the
 * point: which beast came out of the forest decides whether the village survives.
 */
export const CIVILIAN_PANIC_SPEED_MULTIPLIER = 1.55
/**
 * Morale immunity after a panic, and it is deliberately far shorter than
 * `MORALE_RALLY_SECONDS`. Panic is a reflex, not nerve: a villager who stops running
 * while the wolf is still there has to be able to start again, or it stands in the road
 * for twelve seconds being eaten.
 */
export const CIVILIAN_PANIC_RECOVERY = 1.5
/**
 * How long the player stays frightening after swinging at something. This is the whole
 * reason a village reacts to the *player* at all: walking through is fine, drawing steel
 * in the square is not.
 */
export const CIVILIAN_MENACE_SECONDS = 6

/**
 * How many villagers a settlement supports, from the chronicle's `settlementIntegrity`.
 *
 * A burned-out square is empty, a scarred one is quiet, an intact one is busy. This is
 * the cheapest possible way to make a chronicle number the player has never seen legible
 * on the ground: the difference between three villagers and none is a whole story.
 */
export function planCivilianCount(settlementIntegrity: number): number {
  if (!Number.isFinite(settlementIntegrity)) return 0
  if (settlementIntegrity < CIVILIAN_MIN_INTEGRITY) return 0
  if (settlementIntegrity < 60) return 1
  if (settlementIntegrity < 85) return 2
  return AMBIENT_CIVILIAN_LIMIT
}

export type CivilianRoutine = 'wander' | 'gather'

/**
 * What a villager is doing right now. By day they walk between the houses; at night they
 * stand around the fire.
 *
 * `nightFactor` must come from `WorldEnvironment.computeNightFactor(elapsed)` — the
 * simulation's night — and never from the renderer's, which is pinned to 0 whenever the
 * day/night cycle is switched off for performance. Turning the cycle off must not empty
 * the campfires.
 */
export function civilianRoutine(nightFactor: number): CivilianRoutine {
  return nightFactor >= CAMPFIRE_NIGHT_THRESHOLD ? 'gather' : 'wander'
}

// ---------------------------------------------------------------------------
// Campfires
// ---------------------------------------------------------------------------

/** How long a fire is worth lighting, and how often a site for one is looked for. */
export const CAMPFIRE_NIGHT_THRESHOLD = 0.45
/**
 * Seconds between attempts to place a fire.
 *
 * Throttling this is a **determinism** requirement, not a performance one: placing a fire
 * draws from the shared seeded `event` stream, and an unthrottled retry would make the
 * number of draws a function of frame rate. See `GameEngine.updateCampfires`.
 */
export const CAMPFIRE_SEARCH_INTERVAL = 3
/** Never more lit fires than this, however many settlements are streaming. */
export const CAMPFIRE_LIMIT = 2
/** How close to the fire the villagers stand. */
export const CAMPFIRE_GATHER_RADIUS = 3.2
/** Seconds between campfire smoke puffs. */
export const CAMPFIRE_SMOKE_INTERVAL = 1.4

// ---------------------------------------------------------------------------
// Wildlife — props, not actors
// ---------------------------------------------------------------------------

export type WildlifeKind = 'deer' | 'bird'

/** Hard cap on wildlife props. They cost no actor slots, so this is a frame budget. */
export const WILDLIFE_DEER_LIMIT = 3
export const WILDLIFE_BIRD_LIMIT = 9
/** Deer graze this far out: close enough to see, far enough not to be underfoot. */
export const WILDLIFE_SPAWN_MIN_RADIUS = 22
export const WILDLIFE_SPAWN_MAX_RADIUS = 54
/** Past this from the player, wildlife is despawned rather than simulated. */
export const WILDLIFE_DESPAWN_RADIUS = 78
/** Seconds between wildlife population checks. */
export const WILDLIFE_INTERVAL = 4

/** How close anything alarming gets before a deer bolts. */
export const DEER_STARTLE_RADIUS = 14
/** A sprinting player is heard from further away — this is the "startled by sprinting". */
export const DEER_SPRINT_STARTLE_BONUS = 7
export const DEER_BOLT_SECONDS = 2.6
export const DEER_BOLT_SPEED = 11
export const DEER_GRAZE_SPEED = 1.5

/** Birds are jumpier than deer and go straight up. */
export const BIRD_STARTLE_RADIUS = 7
export const BIRD_SPRINT_STARTLE_BONUS = 5
export const BIRD_FLIGHT_SECONDS = 3.4
export const BIRD_CLIMB_SPEED = 5.5
export const BIRD_CRUISE_SPEED = 8
/** How close to a corpse a crow will settle. */
export const CROW_CORPSE_RADIUS = 2.6
/** A body has to have been down this long before anything comes to look at it. */
export const CROW_CORPSE_DELAY = 2.5

/**
 * Whether a startle-able animal takes fright, given the closest thing to it.
 *
 * The sprint bonus is the "birds startled by sprinting" from the design list, generalised:
 * anything moving fast is heard further off, which is one rule rather than a bird-specific
 * special case.
 */
export function shouldStartle(
  distance: number,
  radius: number,
  sprintBonus: number,
  sprinting: boolean,
): boolean {
  if (!Number.isFinite(distance)) return false
  return distance <= radius + (sprinting ? sprintBonus : 0)
}

/**
 * Unit vector pointing away from `threat`, or a stable fallback when the two coincide.
 *
 * Returned as a plain pair so this module stays free of THREE. The fallback matters:
 * a zero-length direction would leave the animal standing in place looking startled,
 * which is exactly the "rout as skip your turn" failure that inverted an earlier
 * measurement in this project.
 */
export function fleeDirection(
  fromX: number,
  fromZ: number,
  threatX: number,
  threatZ: number,
  fallbackAngle: number,
): { x: number; z: number } {
  const dx = fromX - threatX
  const dz = fromZ - threatZ
  const length = Math.hypot(dx, dz)
  if (!Number.isFinite(length) || length < 0.0001) {
    return { x: Math.sin(fallbackAngle), z: Math.cos(fallbackAngle) }
  }
  return { x: dx / length, z: dz / length }
}

/** One deer, or a small flock of birds — the forest is loud, the field is not. */
export function planWildlife(rng: RandomStream, forested: boolean): WildlifeKind {
  return rng.chance(forested ? 0.42 : 0.18) ? 'deer' : 'bird'
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

/**
 * How much of its pace an NPC gives up walking through a full storm.
 *
 * **This is applied to non-combat movement only** — wandering, holding an order, walking
 * to an alert — and never to a pursuit. Trudging through sleet is what a storm looks
 * like; fighting 22% slower in it is a balance change nobody asked for, and it would
 * hand every fight to whichever side happened to be indoors in the fiction.
 */
export const AMBIENT_STORM_SLOW = 0.22
/** Radians of forward hunch at full storm. Cosmetic, applied to the torso pivot. */
export const AMBIENT_STORM_HUNCH = 0.22

/**
 * Pace multiplier for non-combat movement in the current weather.
 *
 * `stormFactor` must come from `WorldEnvironment.computeStormFactor(mix)`, whose mix is
 * advanced before the `weatherEnabled` gate. Reading a rendering flag here would make
 * the world simulate differently depending on a graphics setting, which is the exact
 * defect `WorldEnvironment` exists to prevent.
 */
export function weatherPaceMultiplier(stormFactor: number): number {
  return 1 - AMBIENT_STORM_SLOW * clamp01(stormFactor)
}

/** Radians of forward lean for the current weather. */
export function weatherHunch(stormFactor: number): number {
  return AMBIENT_STORM_HUNCH * clamp01(stormFactor)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
