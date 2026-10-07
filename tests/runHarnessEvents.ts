/**
 * W1-5 — the engine's ten event builders, the loot roll and the road caravan, as data the
 * headless harness can spawn.
 *
 * `GameEngine` builds every fight out of a mesh, a scene and a `THREE.Vector3`, so none of
 * its builders can run in this runner. What *can* run is the part that decides the fight:
 * which roles stand where, on whose side, what they are pointed at, how long the clock is
 * and what winning pays. This file is that part, written once, and
 * `tests/runHarnessFidelity.test.ts` holds it to the shipped builders by loading the real
 * `GameEngine` class and calling its `start…Event` methods with the same random-stream
 * state, the same player position and the same world: every spawn's role, side, position
 * and options has to agree, and so does the number of draws taken. A builder that changes
 * in `src` turns that test red before it can turn a harness number into fiction.
 *
 * W1-2's claim rules — who may load a cart once its escort is down — are not copied at all:
 * `world/CaravanClaim.ts` is pure, so the harness runs it. What is written down here is the
 * wiring around it (who is sampled, what counts as idle, when an escort "fell", where an
 * idle raider walks), and the fidelity test holds that to the engine's own methods too.
 *
 * Two things the shipped builders also do are deliberately **not** reproduced, and both are
 * stated rather than hidden:
 *
 * - Cosmetic draws. `defendHome` and `aftermath` pull a smoke-particle interval from the
 *   event stream every few frames. They move that stream, so a harness run and a browser run
 *   on one seed draw different second events — but they decide nothing about the fight, and
 *   a harness run was never going to replay a browser run anyway: its route is scripted.
 * - Height. The engine measures a few of its distances in three dimensions with the ground
 *   height folded in; this file measures them on the ground plane. The fidelity test pins
 *   the two against each other on flat ground, which is the case where they are the same.
 */

import type { RandomStream } from '../src/game/random/RandomStream.ts'
import {
  getBlueprintRegionBounds,
  getSiteWorldPosition2D,
} from '../src/game/content/registry.ts'
import { areAllegiancesHostile, isBeastRole } from '../src/game/types.ts'
import type {
  ActorRole,
  Allegiance,
  ChronicleWorldEventKind,
  Faction,
  LootRarity,
  LootRewardKind,
  RandomWorldEventKind,
  WorldEventKind,
} from '../src/game/types.ts'
import {
  advanceCaravanClaim,
  createCaravanClaimState,
  type CaravanClaimState,
  type CaravanClaimStep,
  type CaravanLooterSample,
} from '../src/game/world/CaravanClaim.ts'
import { planBeastPack } from '../src/game/world/Fauna.ts'
import { isSquadMember, type SquadMembership } from '../src/game/world/SquadCommand.ts'
import type { PendingMaterialization } from '../src/game/world/Materialization.ts'
import type { RegionChronicleState } from '../src/game/world/Chronicle.ts'
import type {
  FactionObjectiveNode,
  Territory,
  WorldBlueprint,
} from '../src/game/world/worldTypes.ts'

// ---------------------------------------------------------------------------
// Constants, matched to the engine
// ---------------------------------------------------------------------------

/** Matches `GameEngine`'s `EVENT_WEIGHTS`. */
export const HARNESS_EVENT_WEIGHTS: Record<Faction, Record<RandomWorldEventKind, number>> = {
  elf: { richCaravan: 5, defendHome: 1, champion: 2, rescue: 3, bounty: 2 },
  guard: { richCaravan: 1, defendHome: 5, champion: 2, rescue: 3, bounty: 3 },
  villain: { richCaravan: 2, defendHome: 1, champion: 5, rescue: 2, bounty: 3 },
}

/** Matches `EVENT_REQUIRED_SLOTS`: what an event must be able to reserve to start. */
export const HARNESS_EVENT_REQUIRED_SLOTS: Record<WorldEventKind, number> = {
  richCaravan: 3,
  defendHome: 4,
  champion: 1,
  rescue: 3,
  bounty: 1,
  factionRaid: 5,
  caravanAmbush: 4,
  warband: 3,
  aftermath: 2,
  beastRaid: 5,
}

/** Matches `LOCATED_EVENT_REWARDS`. */
export const HARNESS_LOCATED_EVENT_REWARDS: Record<ChronicleWorldEventKind, number> = {
  factionRaid: 110,
  caravanAmbush: 140,
  warband: 80,
  aftermath: 45,
  beastRaid: 95,
}

/** The gold `resolveRandomEventOutcome` pays. A rescue pays in people instead. */
export const HARNESS_RANDOM_EVENT_REWARDS: Record<RandomWorldEventKind, number> = {
  richCaravan: 180,
  defendHome: 90,
  champion: 120,
  rescue: 0,
  bounty: 70,
}

/** `resolveRandomEventOutcome`'s other two payouts. */
export const HARNESS_DEFEND_HOME_HEAL = 8
export const HARNESS_CHAMPION_DAMAGE_STEP = 6
/** Matches `CHAMPION_DAMAGE_CAP`. */
export const HARNESS_CHAMPION_DAMAGE_CAP = 18
/** Matches `FIRST_EVENT_AT`. */
export const HARNESS_FIRST_EVENT_AT = 30
/** Matches `MAX_LOCATED_EVENTS`. */
export const HARNESS_MAX_LOCATED_EVENTS = 2
/** Matches `LOCATED_EVENT_MAX_DISTANCE` / `_MIN_DISTANCE` / `_SCATTER` / `_TIMEOUT`. */
export const HARNESS_LOCATED_EVENT_MAX_DISTANCE = 150
export const HARNESS_LOCATED_EVENT_MIN_DISTANCE = 26
export const HARNESS_LOCATED_EVENT_SCATTER = 9
export const HARNESS_LOCATED_EVENT_TIMEOUT = 150
/** Matches `THREAT_WAVE_FIRST_AT` and `THREAT_WAVE_EVENT_RADIUS`. */
export const HARNESS_THREAT_WAVE_FIRST_AT = 240
export const HARNESS_THREAT_WAVE_EVENT_RADIUS = 45
/** Matches `CONTRACT_TRIGGER_RADIUS`: where a contract's builder goes down. */
export const HARNESS_CONTRACT_TRIGGER_RADIUS = 26
/** Matches `DEFEND_HOME_MAX_DISTANCE`. */
export const HARNESS_DEFEND_HOME_MAX_DISTANCE = 95
/** Matches `BEAST_RAID_DEFENDERS`. */
export const HARNESS_BEAST_RAID_DEFENDERS = 2
/** The distance an `onInteract` accepts, per builder. */
export const HARNESS_CART_INTERACT_RANGE = 7
export const HARNESS_CAPTIVE_INTERACT_RANGE = 5.5
/** How far a robbed rich caravan has to be left behind, and its own clock. */
export const HARNESS_RICH_CARAVAN_ESCAPE = 18
export const HARNESS_RICH_CARAVAN_SPEED = 2.8

/** Matches `LOOT_DROP_CHANCE` and `LOOT_DAMAGE_CAP`. */
export const HARNESS_LOOT_DROP_CHANCE = 0.3
export const HARNESS_LOOT_DAMAGE_CAP = 60
/** Matches `LOOT_MAGNET_RADIUS`, `LOOT_FORCE_MAGNET_AGE` and `LOOT_BURST_TIME`. */
export const HARNESS_LOOT_MAGNET_RADIUS = 5.5
export const HARNESS_LOOT_FORCE_MAGNET_AGE = 15
export const HARNESS_LOOT_BURST_TIME = 0.45
/** Matches `LOOT_MAGNET_MAX_SPEED`: how fast a pulled token closes the gap. */
export const HARNESS_LOOT_MAGNET_SPEED = 22

/** Matches the road caravan: `GENERATED_CARAVAN_PATROL_NEAR` / `_FAR` and its collider. */
export const HARNESS_CARAVAN_PATROL_NEAR = 6
export const HARNESS_CARAVAN_PATROL_FAR = 28
export const HARNESS_CARAVAN_RADIUS = 1.4
export const HARNESS_CARAVAN_SPEED = 3.4
/** Matches `CARAVAN_ESCORT_COUNT`, `_RESPAWN_DELAY`, `_RANGE`. */
export const HARNESS_CARAVAN_ESCORT_COUNT = 2
export const HARNESS_CARAVAN_ESCORT_RESPAWN_DELAY = 25
export const HARNESS_CARAVAN_ESCORT_RANGE = 90
/** Matches `CARAVAN_PANIC_RANGE` / `_SECONDS` / `_SPEED_MULTIPLIER`. */
export const HARNESS_CARAVAN_PANIC_RANGE = 16
export const HARNESS_CARAVAN_PANIC_SECONDS = 4
export const HARNESS_CARAVAN_PANIC_SPEED_MULTIPLIER = 1.7
/** Matches `CARAVAN_GUARDED_RANGE`, `CARAVAN_PLUNDER_RANGE`, `CARAVAN_PLUNDER_COOLDOWN`. */
export const HARNESS_CARAVAN_GUARDED_RANGE = 7
export const HARNESS_CARAVAN_PLUNDER_RANGE = 3.4
export const HARNESS_CARAVAN_PLUNDER_COOLDOWN = 55
/** A player robbery: 95 gold and a 40 s empty cart (`interact`). */
export const HARNESS_CARAVAN_ROBBERY_GOLD = 95
export const HARNESS_CARAVAN_ROBBERY_COOLDOWN = 40
/** Matches `CARAVAN_DEFENSE_CREDIT_RANGE` / `CARAVAN_DEFENSE_AID_COOLDOWN` and the +8. */
export const HARNESS_CARAVAN_DEFENSE_CREDIT_RANGE = 20
export const HARNESS_CARAVAN_DEFENSE_AID_COOLDOWN = 30
export const HARNESS_CARAVAN_DEFENSE_AID = 8
/** §5C.6 — the cart belongs to the palace guard. */
export const HARNESS_CARAVAN_ALLEGIANCE: Allegiance = 'guard'
/** Matches `CARAVAN_LOOT_APPROACH_OVERSHOOT`: an idle ambush raider aims this far past the cart. */
export const HARNESS_CARAVAN_LOOT_OVERSHOOT = 2.2
/** Matches `COMMANDER_ORDER_DURATION` and `COMMANDER_ORDER_TOLERANCE`. */
export const HARNESS_ORDER_DURATION = 6
export const HARNESS_ORDER_TOLERANCE = 3.5

const FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']
const TWO_PI = Math.PI * 2

// ---------------------------------------------------------------------------
// The world a builder reads
// ---------------------------------------------------------------------------

export interface PlanPoint {
  x: number
  z: number
}

export interface PlanBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/**
 * Everything a builder reads, and nothing it does not. The harness answers it from its own
 * terrain and collision; the fidelity test answers the engine's fake `this` from the same
 * object, which is what makes the two comparable call for call.
 */
export interface EventWorld {
  readonly blueprint: WorldBlueprint
  readonly faction: Faction
  /** The event stream: `GameEngine.eventRng` and `generatedRngStreams.event` in one. */
  readonly rng: RandomStream
  readonly player: PlanPoint
  readonly bounds: PlanBounds
  isWalkable(x: number, z: number, radius: number): boolean
  /** `GameEngine.generatedCaravanTravelDirection`, which the rich caravan drives along. */
  readonly caravanTravelDirection: PlanPoint
}

export type EventSpawnPart =
  | 'escort'
  | 'attacker'
  | 'champion'
  | 'captive'
  | 'guard'
  | 'target'
  | 'raider'
  | 'defender'
  | 'member'
  | 'looter'
  | 'beast'

export type EventAiMode = 'normal' | 'captive' | 'attackEventProp'

export interface EventSpawn {
  part: EventSpawnPart
  allegiance: Allegiance
  role: ActorRole
  /** Exactly the coordinates the engine hands `spawnActor`. */
  x: number
  z: number
  aiMode: EventAiMode
  /** True on the two rescue guards: `ignoredTargetId` is the captive. */
  ignoresCaptive: boolean
  /** True when `eventPropTargetId` points at the event's prop. */
  targetsProp: boolean
  /** True when the actor belongs to the event's beast pack. */
  pack: boolean
  packKinSize: number
  /** The located builders set `playerAggro = hostileToPlayer` (or a variant of it). */
  aggroIfHostile: boolean
  /** Rich-caravan escorts walk beside the cart at this offset. */
  cartOffset: PlanPoint | null
}

export interface EventProp {
  x: number
  z: number
  hp: number
  maxHp: number
  attackRange: number
}

export interface EventPlan {
  kind: WorldEventKind
  anchor: 'player' | 'located'
  regionId: string | null
  situationId: string | null
  slots: number
  timer: number | null
  target: number
  marker: PlanPoint
  prop: EventProp | null
  /** The rich caravan's moving cart, or the ambush's standing one. */
  cart: (PlanPoint & { direction: number }) | null
  spawns: EventSpawn[]
  /** For a located event: the faction its hand-back is paid in. */
  attacker: Faction | null
}

function spawn(
  part: EventSpawnPart,
  allegiance: Allegiance,
  role: ActorRole,
  x: number,
  z: number,
  extra: Partial<EventSpawn> = {},
): EventSpawn {
  return {
    part,
    allegiance,
    role,
    x,
    z,
    aiMode: 'normal',
    ignoresCaptive: false,
    targetsProp: false,
    pack: false,
    packKinSize: 1,
    aggroIfHostile: false,
    cartOffset: null,
    ...extra,
  }
}

/** `clampWorldPosition`. */
export function clampToBounds(point: PlanPoint, bounds: PlanBounds, radius = 0): PlanPoint {
  return {
    x: Math.min(bounds.maxX - radius, Math.max(bounds.minX + radius, point.x)),
    z: Math.min(bounds.maxZ - radius, Math.max(bounds.minZ + radius, point.z)),
  }
}

function distance(left: PlanPoint, right: PlanPoint): number {
  return Math.hypot(left.x - right.x, left.z - right.z)
}

/** `generatedWorld.getRegionCenter`, on the ground plane. */
export function regionCenter(
  blueprint: WorldBlueprint,
  regionId: string,
): PlanPoint | undefined {
  const region = blueprint.regions.find((candidate) => String(candidate.id) === regionId)
  const bounds = region ? getBlueprintRegionBounds(blueprint, region) : undefined
  if (!bounds) return undefined
  return { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }
}

// ---------------------------------------------------------------------------
// The engine's small pickers
// ---------------------------------------------------------------------------

/** `pickEventPosition`: a walkable point 22–38 m from the player, or the fallback. */
export function pickEventPosition(world: EventWorld): PlanPoint {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const angle = world.rng.next() * TWO_PI
    const radius = 22 + world.rng.next() * 16
    const position = clampToBounds(
      {
        x: world.player.x + Math.sin(angle) * radius,
        z: world.player.z + Math.cos(angle) * radius,
      },
      world.bounds,
      3,
    )
    if (!world.isWalkable(position.x, position.z, 1)) continue
    return position
  }
  return clampToBounds({ x: world.player.x + 12, z: world.player.z + 12 }, world.bounds, 3)
}

/** `pickEventEnemyFaction`. One draw. */
export function pickEventEnemyFaction(world: EventWorld): Faction {
  const enemies = FACTIONS.filter((faction) => faction !== world.faction)
  return enemies[Math.floor(world.rng.next() * enemies.length)]
}

/** `pickDefendHomePosition`: the nearest settlement within 95 m, or null. No draws. */
export function pickDefendHomePosition(world: EventWorld): PlanPoint | null {
  let best: PlanPoint | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const site of world.blueprint.sites) {
    if (site.kind !== 'settlement') continue
    const position = getSiteWorldPosition2D(world.blueprint, site)
    if (!position) continue
    const away = distance(position, world.player)
    if (away > HARNESS_DEFEND_HOME_MAX_DISTANCE || away >= bestDistance) continue
    bestDistance = away
    best = { x: position.x, z: position.z }
  }
  return best
}

/** `locatedEventAnchor`: the site, or the middle of its square. */
export function locatedEventAnchor(
  world: EventWorld,
  siteId: string | null,
  regionId: string,
): PlanPoint | null {
  const site = siteId ? getSiteWorldPosition2D(world.blueprint, siteId) : undefined
  return site ?? regionCenter(world.blueprint, regionId) ?? null
}

/** `pickLocatedEventPosition`: scattered round the anchor, away from the player at first. */
export function pickLocatedEventPosition(
  world: EventWorld,
  siteId: string | null,
  regionId: string,
): PlanPoint | null {
  const anchor = locatedEventAnchor(world, siteId, regionId)
  if (!anchor) return null
  if (distance(anchor, world.player) > HARNESS_LOCATED_EVENT_MAX_DISTANCE) return null
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const angle = world.rng.next() * TWO_PI
    const radius = world.rng.next() * HARNESS_LOCATED_EVENT_SCATTER
    const position = clampToBounds(
      { x: anchor.x + Math.sin(angle) * radius, z: anchor.z + Math.cos(angle) * radius },
      world.bounds,
      3,
    )
    if (!world.isWalkable(position.x, position.z, 1)) continue
    if (
      attempt < 12 &&
      distance(position, world.player) < HARNESS_LOCATED_EVENT_MIN_DISTANCE
    ) {
      continue
    }
    return position
  }
  return null
}

/** `locatedDefenderFaction`: whoever holds the ground, else the player's own, else a draw. */
export function locatedDefenderFaction(
  world: EventWorld,
  attacker: Faction,
  defender: Territory | null,
): Faction {
  if (defender && defender !== 'neutral' && defender !== attacker) return defender
  if (world.faction !== attacker) return world.faction
  const options = FACTIONS.filter((faction) => faction !== attacker)
  return options[Math.floor(world.rng.next() * options.length)]
}

/** `settlementGarrisonFaction`. */
export function settlementGarrisonFaction(world: EventWorld, defender: Territory | null): Faction {
  return defender && defender !== 'neutral' ? defender : world.faction
}

/** `contractOpponentFaction`: not the player, preferably not whoever holds the square. */
export function contractOpponentFaction(faction: Faction, defender: Territory | null): Faction {
  const options = FACTIONS.filter((candidate) => candidate !== faction)
  return options.find((candidate) => candidate !== defender) ?? options[0]
}

/** `contractSituation`: the record a contract hands a located builder. */
export function contractSituation(
  blueprint: WorldBlueprint,
  faction: Faction,
  node: FactionObjectiveNode,
  eventKind: WorldEventKind,
  chronicle: RegionChronicleState | undefined,
): PendingMaterialization {
  const regionId = String(node.regionId)
  const region = blueprint.regions.find((candidate) => String(candidate.id) === regionId)
  const defender = chronicle?.control ?? region?.territory ?? null
  return {
    id: `contract-${node.id}`,
    kind: eventKind as PendingMaterialization['kind'],
    regionId,
    sourceRegionId: null,
    siteId: node.siteId,
    faction: contractOpponentFaction(faction, defender),
    defender,
    caravanId: `contract-cart-${node.id}`,
    beastPressure: Math.max(0.6, chronicle?.beastPressure ?? 0),
    urgency: 1,
  }
}

// ---------------------------------------------------------------------------
// The five player-anchored builders
// ---------------------------------------------------------------------------

function playerPlan(
  kind: RandomWorldEventKind,
  timer: number | null,
  target: number,
  marker: PlanPoint,
  spawns: EventSpawn[],
  extra: Partial<EventPlan> = {},
): EventPlan {
  return {
    kind,
    anchor: 'player',
    regionId: null,
    situationId: null,
    slots: HARNESS_EVENT_REQUIRED_SLOTS[kind],
    timer,
    target,
    marker: { ...marker },
    prop: null,
    cart: null,
    spawns,
    attacker: null,
    ...extra,
  }
}

/** `startRichCaravanEvent`. A moving fat cart and three guards; rob it, then get away. */
export function planRichCaravan(world: EventWorld, origin?: PlanPoint): EventPlan {
  const position = origin ? { ...origin } : pickEventPosition(world)
  const enemyFaction = pickEventEnemyFaction(world)
  const offsets: Array<[number, number]> = [
    [-4.5, -4],
    [0, 4.5],
    [4.5, -4],
  ]
  const spawns = offsets.map(([x, z], index) => {
    const at = clampToBounds({ x: position.x + x, z: position.z + z }, world.bounds, 3)
    return spawn('escort', enemyFaction, index === 1 ? 'brute' : 'soldier', at.x, at.z, {
      cartOffset: { x, z },
    })
  })
  return playerPlan('richCaravan', 25, HARNESS_RICH_CARAVAN_ESCAPE, position, spawns, {
    cart: { x: position.x, z: position.z, direction: position.x > 0 ? -1 : 1 },
  })
}

/** `startDefendHomeEvent`. Four raiders at the nearest settlement's house; 45 s. */
export function planDefendHome(world: EventWorld, home?: PlanPoint): EventPlan | null {
  const homePosition = home ? { ...home } : pickDefendHomePosition(world)
  if (!homePosition) return null
  const enemyFaction = pickEventEnemyFaction(world)
  const spawns: EventSpawn[] = []
  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2 + world.rng.next() * 0.45
    const radius = 17 + world.rng.next() * 4
    const at = clampToBounds(
      {
        x: homePosition.x + Math.sin(angle) * radius,
        z: homePosition.z + Math.cos(angle) * radius,
      },
      world.bounds,
      3,
    )
    spawns.push(
      spawn('attacker', enemyFaction, index === 3 ? 'brute' : 'soldier', at.x, at.z, {
        aiMode: 'attackEventProp',
        targetsProp: true,
      }),
    )
  }
  return playerPlan('defendHome', 45, 4, homePosition, spawns, {
    prop: { x: homePosition.x, z: homePosition.z, hp: 100, maxHp: 100, attackRange: 5.2 },
  })
}

/** `startChampionEvent`. One champion; no clock. */
export function planChampion(world: EventWorld, origin?: PlanPoint): EventPlan {
  const position = origin ? { ...origin } : pickEventPosition(world)
  const faction = pickEventEnemyFaction(world)
  return playerPlan('champion', null, 1, position, [
    spawn('champion', faction, 'champion', position.x, position.z),
  ])
}

/** `startRescueEvent`. A captive of the player's own side and two guards; no clock. */
export function planRescue(world: EventWorld, origin?: PlanPoint): EventPlan {
  const position = origin ? { ...origin } : pickEventPosition(world)
  const captive = spawn('captive', world.faction, 'captive', position.x, position.z, {
    aiMode: 'captive',
  })
  const enemyFaction = pickEventEnemyFaction(world)
  return playerPlan('rescue', null, 2, position, [
    captive,
    spawn('guard', enemyFaction, 'soldier', position.x - 3.6, position.z - 2.5, {
      ignoresCaptive: true,
    }),
    spawn('guard', enemyFaction, 'soldier', position.x + 3.6, position.z + 2.5, {
      ignoresCaptive: true,
    }),
  ])
}

/** `startBountyEvent`. One marked soldier; 40 s. */
export function planBounty(world: EventWorld, origin?: PlanPoint): EventPlan {
  const position = origin ? { ...origin } : pickEventPosition(world)
  const faction = pickEventEnemyFaction(world)
  return playerPlan('bounty', 40, 1, position, [
    spawn('target', faction, 'soldier', position.x, position.z),
  ])
}

// ---------------------------------------------------------------------------
// The five located builders
// ---------------------------------------------------------------------------

function locatedSpawn(
  world: EventWorld,
  part: EventSpawnPart,
  allegiance: Allegiance,
  role: ActorRole,
  position: PlanPoint,
  offsetX: number,
  offsetZ: number,
  extra: Partial<EventSpawn> = {},
): EventSpawn {
  const at = clampToBounds(
    { x: position.x + offsetX, z: position.z + offsetZ },
    world.bounds,
    3,
  )
  return spawn(part, allegiance, role, at.x, at.z, extra)
}

function locatedPlan(
  kind: ChronicleWorldEventKind,
  situation: PendingMaterialization,
  target: number,
  marker: PlanPoint,
  spawns: EventSpawn[],
  extra: Partial<EventPlan> = {},
): EventPlan {
  return {
    kind,
    anchor: 'located',
    regionId: situation.regionId,
    situationId: situation.id,
    slots: HARNESS_EVENT_REQUIRED_SLOTS[kind],
    timer: HARNESS_LOCATED_EVENT_TIMEOUT,
    target,
    marker: { ...marker },
    prop: null,
    cart: null,
    spawns,
    attacker: situation.faction,
    ...extra,
  }
}

/**
 * `startFactionRaidEvent`. The position is chosen before the budget is asked, exactly as
 * the engine orders it, so a refused reservation still spends the position's draws.
 */
export function planFactionRaid(
  world: EventWorld,
  situation: PendingMaterialization,
  reserve: () => boolean,
): EventPlan | null {
  const attacker = situation.faction
  if (!attacker) return null
  const position = pickLocatedEventPosition(world, situation.siteId, situation.regionId)
  if (!position) return null
  if (!reserve()) return null
  const defenderFaction = locatedDefenderFaction(world, attacker, situation.defender)
  const spawns: EventSpawn[] = []
  for (const [offsetX, offsetZ, role] of [
    [-8.5, -7, 'soldier'],
    [8.5, -6, 'soldier'],
    [0, 9.5, 'brute'],
  ] as const) {
    spawns.push(
      locatedSpawn(world, 'attacker', attacker, role, position, offsetX, offsetZ, {
        aggroIfHostile: true,
      }),
    )
  }
  for (const [offsetX, offsetZ] of [
    [-2.6, 1.8],
    [2.6, -1.8],
  ] as const) {
    spawns.push(
      locatedSpawn(world, 'defender', defenderFaction, 'soldier', position, offsetX, offsetZ),
    )
  }
  return locatedPlan('factionRaid', situation, 3, position, spawns)
}

/** `startCaravanAmbushEvent`. A standing cart, its two guards and two raiders. */
export function planCaravanAmbush(
  world: EventWorld,
  situation: PendingMaterialization,
  reserve: () => boolean,
): EventPlan | null {
  const owner = situation.faction
  if (!owner || !situation.caravanId) return null
  const position = pickLocatedEventPosition(world, null, situation.regionId)
  if (!position) return null
  if (!reserve()) return null
  const raiderFaction = locatedDefenderFaction(world, owner, situation.defender)
  const spawns: EventSpawn[] = []
  for (const [offsetX, offsetZ] of [
    [-3.4, 2.2],
    [3.4, -2.2],
  ] as const) {
    spawns.push(locatedSpawn(world, 'escort', owner, 'soldier', position, offsetX, offsetZ))
  }
  for (const [offsetX, offsetZ] of [
    [-7.5, -6.5],
    [7.5, 6.5],
  ] as const) {
    spawns.push(
      locatedSpawn(world, 'raider', raiderFaction, 'soldier', position, offsetX, offsetZ, {
        aggroIfHostile: true,
      }),
    )
  }
  return locatedPlan('caravanAmbush', situation, 1, position, spawns, {
    cart: { x: position.x, z: position.z, direction: 0 },
    attacker: owner,
  })
}

/** `startWarbandEvent`. Three of the square's holders, standing on it. */
export function planWarband(
  world: EventWorld,
  situation: PendingMaterialization,
  reserve: () => boolean,
): EventPlan | null {
  const faction = situation.faction
  if (!faction) return null
  const position = pickLocatedEventPosition(world, situation.siteId, situation.regionId)
  if (!position) return null
  if (!reserve()) return null
  const spawns: EventSpawn[] = []
  for (const [offsetX, offsetZ, role] of [
    [-3.2, -2.4, 'soldier'],
    [3.2, -1.6, 'archer'],
    [0, 3.4, 'brute'],
  ] as const) {
    spawns.push(
      locatedSpawn(world, 'member', faction, role, position, offsetX, offsetZ, {
        aggroIfHostile: true,
      }),
    )
  }
  return locatedPlan('warband', situation, 3, position, spawns)
}

/** `startAftermathEvent`. Two looters in the ashes. */
export function planAftermath(
  world: EventWorld,
  situation: PendingMaterialization,
  reserve: () => boolean,
): EventPlan | null {
  const position = pickLocatedEventPosition(world, situation.siteId, situation.regionId)
  if (!position) return null
  if (!reserve()) return null
  const looterFaction =
    situation.faction ?? locatedDefenderFaction(world, world.faction, null)
  const spawns: EventSpawn[] = []
  for (const [offsetX, offsetZ] of [
    [-2.2, 1.4],
    [2.2, -1.4],
  ] as const) {
    spawns.push(
      locatedSpawn(world, 'looter', looterFaction, 'minion', position, offsetX, offsetZ, {
        aggroIfHostile: true,
      }),
    )
  }
  return locatedPlan('aftermath', situation, 2, position, spawns, { attacker: looterFaction })
}

/**
 * `startBeastRaidEvent`. The pack is the shipped `planBeastPack`, drawn from the same
 * stream at the same point, so the roles are the engine's and not a copy of its table.
 */
export function planBeastRaid(
  world: EventWorld,
  situation: PendingMaterialization,
  reserve: () => boolean,
): EventPlan | null {
  const position = pickLocatedEventPosition(world, situation.siteId, situation.regionId)
  if (!position) return null
  if (!reserve()) return null
  const region = world.blueprint.regions.find(
    (candidate) => String(candidate.id) === situation.regionId,
  )
  const pack = planBeastPack({
    beastPressure: situation.beastPressure,
    biome: region?.biome ?? 'forest',
    rng: world.rng,
    maxCount: HARNESS_EVENT_REQUIRED_SLOTS.beastRaid - HARNESS_BEAST_RAID_DEFENDERS,
  })
  if (pack.roles.length === 0) return null
  const kinSize = new Map<ActorRole, number>()
  for (const role of pack.roles) kinSize.set(role, (kinSize.get(role) ?? 0) + 1)
  const spawns: EventSpawn[] = pack.roles.map((role, index) => {
    const angle = (index / pack.roles.length) * TWO_PI + 0.4
    const radius = 11 + index * 1.6
    const wrecker = index === 0 && role !== 'wolf'
    return locatedSpawn(
      world,
      'beast',
      'beast',
      role,
      position,
      Math.sin(angle) * radius,
      Math.cos(angle) * radius,
      {
        pack: true,
        packKinSize: kinSize.get(role) ?? 1,
        aiMode: wrecker ? 'attackEventProp' : 'normal',
        targetsProp: wrecker,
        // `beast.playerAggro = beast.hostileToPlayer && !wrecker`.
        aggroIfHostile: !wrecker,
      },
    )
  })
  const garrison = settlementGarrisonFaction(world, situation.defender)
  for (const [offsetX, offsetZ] of [
    [-2.8, 1.9],
    [2.8, -1.9],
  ] as const) {
    spawns.push(
      locatedSpawn(world, 'defender', garrison, 'soldier', position, offsetX, offsetZ),
    )
  }
  return locatedPlan('beastRaid', situation, pack.roles.length, position, spawns, {
    prop: { x: position.x, z: position.z, hp: 100, maxHp: 100, attackRange: 5 },
    attacker: null,
  })
}

/** `materializeSituation` and `buildContractEvent`'s located half, as one switch. */
export function planLocatedEvent(
  world: EventWorld,
  situation: PendingMaterialization,
  reserve: () => boolean,
): EventPlan | null {
  switch (situation.kind) {
    case 'factionRaid':
      return planFactionRaid(world, situation, reserve)
    case 'caravanAmbush':
      return planCaravanAmbush(world, situation, reserve)
    case 'warband':
      return planWarband(world, situation, reserve)
    case 'aftermath':
      return planAftermath(world, situation, reserve)
    case 'beastRaid':
      return planBeastRaid(world, situation, reserve)
  }
}

/**
 * `buildContractEvent`'s player-anchored half. The five random builders take the contract
 * site as their origin; they still reserve their slots first, which the caller does.
 */
export function planRandomEvent(
  world: EventWorld,
  kind: RandomWorldEventKind,
  origin?: PlanPoint,
): EventPlan | null {
  switch (kind) {
    case 'richCaravan':
      return planRichCaravan(world, origin)
    case 'defendHome':
      return planDefendHome(world, origin)
    case 'champion':
      return planChampion(world, origin)
    case 'rescue':
      return planRescue(world, origin)
    case 'bounty':
      return planBounty(world, origin)
  }
}

// ---------------------------------------------------------------------------
// The rules a live event is judged by
// ---------------------------------------------------------------------------

/** What an event looks like from outside, one frame at a time. */
export interface EventProgressView {
  /** Per spawn index: on the field and standing — `countAliveActors`' reading. */
  alive: readonly boolean[]
  /**
   * Per spawn index: on the field and dead — the `onKill` progress counters' reading. A body
   * the actor budget took off the field is neither alive nor dead to them, exactly as the
   * engine's `actors.find(…)` sees it.
   */
  dead: readonly boolean[]
  /** Per spawn index: removed from the event because it changed sides (the captive). */
  released: readonly boolean[]
  propHp: number | null
  robbed: boolean
  robberyPoint: PlanPoint | null
  /** W1-2 — an ambush raider finished loading the cart. */
  plundered: boolean
  player: PlanPoint
}

export type EventVerdict = 'active' | 'succeeded' | 'failed'

function partAlive(plan: EventPlan, view: EventProgressView, part: EventSpawnPart): number {
  let alive = 0
  plan.spawns.forEach((entry, index) => {
    if (entry.part === part && view.alive[index] && !view.released[index]) alive += 1
  })
  return alive
}

function partDead(plan: EventPlan, view: EventProgressView, part: EventSpawnPart): number {
  let dead = 0
  plan.spawns.forEach((entry, index) => {
    if (entry.part === part && view.dead[index]) dead += 1
  })
  return dead
}

/**
 * The per-frame `update` of each builder, as a verdict. The engine also writes `progress`
 * here; the harness reports it the same way through {@link eventProgress}.
 */
export function evaluateEventFrame(plan: EventPlan, view: EventProgressView): EventVerdict {
  switch (plan.kind) {
    case 'richCaravan':
      if (view.robbed && view.robberyPoint) {
        return distance(view.player, view.robberyPoint) >= plan.target ? 'succeeded' : 'active'
      }
      return 'active'
    case 'defendHome':
      return view.propHp !== null && view.propHp <= 0 ? 'failed' : 'active'
    case 'factionRaid':
      if (partAlive(plan, view, 'attacker') === 0) return 'succeeded'
      return partAlive(plan, view, 'defender') === 0 ? 'failed' : 'active'
    case 'caravanAmbush':
      // W1-2 — losing the escort is no longer losing the cart: a raider has to finish
      // loading it, which `advanceAmbushLoot` decides and `plundered` reports.
      return !view.robbed && view.plundered ? 'failed' : 'active'
    case 'warband':
      return partAlive(plan, view, 'member') === 0 ? 'succeeded' : 'active'
    case 'aftermath':
      return partAlive(plan, view, 'looter') === 0 ? 'succeeded' : 'active'
    case 'beastRaid':
      if (partAlive(plan, view, 'beast') === 0) return 'succeeded'
      return view.propHp !== null && view.propHp <= 0 ? 'failed' : 'active'
    case 'champion':
    case 'rescue':
    case 'bounty':
      return 'active'
  }
}

/**
 * The `onKill` of each builder, run when spawn `index` dies. Returns the verdict the kill
 * produced, or `'active'`; `'rescued'` is the rescue's success, which also hands the captive
 * to the player before the event is released.
 */
export function evaluateEventKill(
  plan: EventPlan,
  view: EventProgressView,
  index: number,
): EventVerdict | 'rescued' {
  const entry = plan.spawns[index]
  if (!entry) return 'active'
  switch (plan.kind) {
    case 'defendHome':
      return partDead(plan, view, 'attacker') >= plan.target && (view.propHp ?? 0) > 0
        ? 'succeeded'
        : 'active'
    case 'champion':
      return entry.part === 'champion' ? 'succeeded' : 'active'
    case 'bounty':
      return entry.part === 'target' ? 'succeeded' : 'active'
    case 'rescue':
      if (entry.part === 'captive') return 'failed'
      if (entry.part !== 'guard') return 'active'
      return partDead(plan, view, 'guard') >= plan.target ? 'rescued' : 'active'
    default:
      return 'active'
  }
}

/** `event.progress`, for the report. */
export function eventProgress(plan: EventPlan, view: EventProgressView): number {
  switch (plan.kind) {
    case 'richCaravan':
      return view.robbed && view.robberyPoint
        ? Math.min(plan.target, distance(view.player, view.robberyPoint))
        : 0
    case 'defendHome':
      return partDead(plan, view, 'attacker')
    case 'factionRaid':
      return plan.target - partAlive(plan, view, 'attacker')
    case 'caravanAmbush':
      return view.robbed ? 1 : 0
    case 'warband':
      return plan.target - partAlive(plan, view, 'member')
    case 'aftermath':
      return plan.target - partAlive(plan, view, 'looter')
    case 'beastRaid':
      return plan.target - partAlive(plan, view, 'beast')
    case 'champion':
      return partAlive(plan, view, 'champion') === 0 ? 1 : 0
    case 'bounty':
      return partAlive(plan, view, 'target') === 0 ? 1 : 0
    case 'rescue':
      return partDead(plan, view, 'guard')
  }
}

/** The spawns a player has to put down for the event to be won, by builder. */
export function eventKillParts(kind: WorldEventKind): readonly EventSpawnPart[] {
  switch (kind) {
    case 'defendHome':
    case 'factionRaid':
      return ['attacker']
    case 'champion':
      return ['champion']
    case 'bounty':
      return ['target']
    case 'rescue':
      return ['guard']
    case 'warband':
      return ['member']
    case 'aftermath':
      return ['looter']
    case 'beastRaid':
      return ['beast']
    case 'richCaravan':
    case 'caravanAmbush':
      return []
  }
}

// ---------------------------------------------------------------------------
// The director's other spawner: the threat wave
// ---------------------------------------------------------------------------

export interface WaveSpawn {
  allegiance: Faction
  role: ActorRole
  x: number
  z: number
}

/**
 * `spawnThreatWave` after its reservation: `granted` actors in a ring 13 m out, one draw
 * from the director stream for the ring's rotation. `radiusFor` is the collider radius
 * the engine walkability-tests each role with.
 */
export function planThreatWave(input: {
  faction: Faction
  tier: number
  granted: number
  rng: RandomStream
  player: PlanPoint
  bounds: PlanBounds
  isWalkable(x: number, z: number, radius: number): boolean
  radiusFor(role: ActorRole): number
}): WaveSpawn[] {
  if (input.granted <= 0) return []
  const enemyFaction: Faction = input.faction === 'guard' ? 'villain' : 'guard'
  const baseAngle = input.rng.next() * TWO_PI
  const spawns: WaveSpawn[] = []
  for (let index = 0; index < input.granted; index += 1) {
    const role: ActorRole =
      input.tier >= 4 && index === input.granted - 1
        ? 'brute'
        : index % 3 === 2
          ? 'archer'
          : enemyFaction === 'villain'
            ? 'minion'
            : 'soldier'
    const radius = 13 + index * 1.2
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const angle = baseAngle + index * 1.8 + attempt * 0.73
      const candidate = clampToBounds(
        {
          x: input.player.x + Math.sin(angle) * radius,
          z: input.player.z + Math.cos(angle) * radius,
        },
        input.bounds,
        input.radiusFor(role) + 1,
      )
      if (!input.isWalkable(candidate.x, candidate.z, input.radiusFor(role))) continue
      spawns.push({ allegiance: enemyFaction, role, x: candidate.x, z: candidate.z })
      break
    }
  }
  return spawns
}

// ---------------------------------------------------------------------------
// Loot and treasure, from the loot stream
// ---------------------------------------------------------------------------

export interface HarnessLootReward {
  kind: LootRewardKind
  rarity: LootRarity
  amount: number
}

const LOOT_RARITY_RANK: Record<LootRarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  legendary: 3,
}

function rollLootInteger(rng: RandomStream, min: number, max: number): number {
  return min + Math.floor(rng.next() * (max - min + 1))
}

/** `rollLootRarity`. */
function rollLootRarity(rng: RandomStream, minimum: LootRarity): LootRarity {
  const roll = rng.next()
  const rolled: LootRarity =
    roll < 0.62 ? 'common' : roll < 0.89 ? 'uncommon' : roll < 0.98 ? 'rare' : 'legendary'
  return LOOT_RARITY_RANK[rolled] < LOOT_RARITY_RANK[minimum] ? minimum : rolled
}

/**
 * `rollLootReward` followed by the three draws `spawnLoot` takes for the token's burst.
 * The burst only throws the token a metre, which the harness does not model, but the draws
 * are taken anyway so the loot stream advances exactly as far per drop as the engine's.
 */
export function rollLoot(
  rng: RandomStream,
  minimum: LootRarity,
  playerDamage: number,
): HarnessLootReward {
  const rarity = rollLootRarity(rng, minimum)
  const kinds: LootRewardKind[] =
    rarity === 'common'
      ? ['coins']
      : rarity === 'uncommon'
        ? ['coins', 'medicine']
        : playerDamage >= HARNESS_LOOT_DAMAGE_CAP
          ? ['coins', 'medicine']
          : ['coins', 'medicine', 'whetstone']
  const kind = kinds[Math.floor(rng.next() * kinds.length)]
  let amount: number
  if (rarity === 'legendary') amount = kind === 'coins' ? 70 : kind === 'medicine' ? 45 : 2
  else if (rarity === 'rare') {
    amount =
      kind === 'coins'
        ? rollLootInteger(rng, 28, 42)
        : kind === 'medicine'
          ? rollLootInteger(rng, 24, 32)
          : 1
  } else if (rarity === 'uncommon') {
    amount = kind === 'coins' ? rollLootInteger(rng, 12, 20) : rollLootInteger(rng, 12, 18)
  } else amount = rollLootInteger(rng, 5, 10)
  rng.next()
  rng.next()
  rng.next()
  return { kind, rarity, amount }
}

/** `trySpawnKillLoot`: a commander always drops, everything else 30 % of the time. */
export function rollKillLoot(
  rng: RandomStream,
  role: ActorRole,
  playerDamage: number,
): HarnessLootReward | null {
  if (role !== 'commander' && rng.next() >= HARNESS_LOOT_DROP_CHANCE) return null
  return rollLoot(rng, role === 'commander' ? 'rare' : 'common', playerDamage)
}

/** `handleGeneratedInteraction`'s treasure: 28–70 gold, one draw. */
export function rollTreasure(rng: RandomStream): number {
  return 28 + Math.floor(rng.next() * 43)
}

// ---------------------------------------------------------------------------
// The road caravan's patrol
// ---------------------------------------------------------------------------

export interface CaravanPatrol {
  start: PlanPoint
  end: PlanPoint
  /** Unit vector from the start square towards the next one on the critical path. */
  direction: PlanPoint
  ready: boolean
}

/** `placeGeneratedCaravan`: a short beat of road out of the faction's first square. */
export function planCaravanPatrol(
  blueprint: WorldBlueprint,
  faction: Faction,
  bounds: PlanBounds,
  fallback: PlanPoint,
): CaravanPatrol {
  const path = blueprint.criticalPaths[faction]
  const start = regionCenter(blueprint, String(path.regionIds[0])) ?? fallback
  const destination =
    regionCenter(blueprint, String(path.regionIds[1] ?? path.regionIds[0])) ?? fallback
  let directionX = destination.x - start.x
  let directionZ = destination.z - start.z
  const length = Math.hypot(directionX, directionZ)
  if (length > 0) {
    directionX /= length
    directionZ /= length
  } else {
    directionX = 1
    directionZ = 0
  }
  const patrolStart = clampToBounds(
    {
      x: start.x + directionX * HARNESS_CARAVAN_PATROL_NEAR,
      z: start.z + directionZ * HARNESS_CARAVAN_PATROL_NEAR,
    },
    bounds,
    HARNESS_CARAVAN_RADIUS,
  )
  const patrolEnd = clampToBounds(
    {
      x: start.x + directionX * HARNESS_CARAVAN_PATROL_FAR,
      z: start.z + directionZ * HARNESS_CARAVAN_PATROL_FAR,
    },
    bounds,
    HARNESS_CARAVAN_RADIUS,
  )
  return {
    start: patrolStart,
    end: patrolEnd,
    direction: { x: directionX, z: directionZ },
    ready:
      (patrolStart.x - patrolEnd.x) ** 2 + (patrolStart.z - patrolEnd.z) ** 2 > 1,
  }
}

// ---------------------------------------------------------------------------
// W1-2 — who gets a cart once its escort is down
// ---------------------------------------------------------------------------

/**
 * One body next to one cart, in the fields `sampleCaravanLooter` reads. A harness actor
 * satisfies it as it stands. Knockback and the boar's charge are not modelled by the
 * harness, so neither ever takes a body off the job here.
 */
export interface LooterBody {
  id: string
  x: number
  z: number
  alive: boolean
  role: ActorRole
  routTimer: number
  reaction: string
  aiMode: string
  /** `'idle'` is the engine's `action === null`. */
  actionPhase: string
  targetId: string | null
  retaliationTimer: number
  rageTimer: number
  hostileToPlayer: boolean
  playerAggro: boolean
}

/**
 * `sampleCaravanLooter`: a looter at work only has to stay on its feet; a candidate also
 * has to be idle, so nothing starts loading in the middle of a fight.
 */
export function sampleCartLooter(
  body: LooterBody,
  cart: PlanPoint,
  candidate: boolean,
): CaravanLooterSample {
  const steady = body.alive && body.routTimer <= 0 && body.reaction !== 'stagger'
  const idle =
    body.aiMode === 'normal' &&
    body.actionPhase === 'idle' &&
    body.reaction === 'none' &&
    body.targetId === null &&
    body.retaliationTimer <= 0 &&
    body.rageTimer <= 0 &&
    !(body.hostileToPlayer && body.playerAggro)
  return {
    id: body.id,
    distance: Math.hypot(body.x - cart.x, body.z - cart.z),
    ready: candidate ? steady && idle : steady,
    beast: isBeastRole(body.role),
  }
}

/** `findCaravanLooter`: the nearest idle body within reach that `mayLoot` lets near the cargo. */
export function findCartLooter<Body extends LooterBody>(
  bodies: Iterable<Body>,
  cart: PlanPoint,
  mayLoot: (body: Body) => boolean,
): CaravanLooterSample | null {
  let best: CaravanLooterSample | null = null
  for (const body of bodies) {
    if (!body.alive || !mayLoot(body)) continue
    const sample = sampleCartLooter(body, cart, true)
    if (!sample.ready || sample.distance > HARNESS_CARAVAN_PLUNDER_RANGE) continue
    if (!best || sample.distance < best.distance) best = sample
  }
  return best
}

export interface CartLootInput<Body extends LooterBody> {
  delta: number
  elapsed: number
  cart: PlanPoint
  player: PlanPoint
  /** A living, steady escort is guarding the cart. */
  guarded: boolean
  /** The last living escort went down this frame. */
  escortFell: boolean
  /** Nothing left to take. */
  empty: boolean
  /** The player's side robs this cart; the side that owns it defends it instead. */
  playerRobs: boolean
  /** Every body on the field, standing or not: the engine's `this.actors`. */
  bodies: readonly Body[]
  mayLoot: (body: Body) => boolean
}

/** `advanceCaravanLoot`'s decision half: sample the field, then let the claim rules decide. */
export function advanceCartLoot<Body extends LooterBody>(
  claim: CaravanClaimState,
  input: CartLootInput<Body>,
): CaravanClaimStep {
  const looterId = claim.looterId
  const current =
    looterId === null ? undefined : input.bodies.find((body) => body.id === looterId)
  return advanceCaravanClaim(claim, {
    delta: input.delta,
    elapsed: input.elapsed,
    guarded: input.guarded,
    escortFell: input.escortFell,
    empty: input.empty,
    playerRobs: input.playerRobs,
    playerDistance: Math.hypot(input.player.x - input.cart.x, input.player.z - input.cart.z),
    looter: current ? sampleCartLooter(current, input.cart, false) : null,
    candidate:
      looterId !== null || input.guarded || input.empty
        ? null
        : findCartLooter(input.bodies, input.cart, input.mayLoot),
    plunderRange: HARNESS_CARAVAN_PLUNDER_RANGE,
  })
}

/** A chronicle ambush's cart, as its `update` closure keeps it. */
export interface AmbushLoot {
  claim: CaravanClaimState
  /** Escorts standing on the previous frame, so the frame the last one falls is seen. */
  escortsStanding: number
  plundered: boolean
}

export function createAmbushLoot(escorts: number): AmbushLoot {
  return { claim: createCaravanClaimState(), escortsStanding: escorts, plundered: false }
}

/**
 * The located caravan ambush's `update`, after W1-2: count the escort, run the claim with
 * only the ambush's own raiders allowed at the cargo, and say whether the idle raiders
 * should walk to the cart (`directCaravanRaiders`' `approach`). The caller stops calling
 * it once the cart is robbed or plundered, as the closure returns early.
 */
export function advanceAmbushLoot<Body extends LooterBody>(
  loot: AmbushLoot,
  input: {
    delta: number
    elapsed: number
    cart: PlanPoint
    player: PlanPoint
    playerRobs: boolean
    bodies: readonly Body[]
    escortIds: readonly string[]
    raiderIds: readonly string[]
  },
): { step: CaravanClaimStep; approach: boolean } {
  let standing = 0
  for (const id of input.escortIds) {
    if (input.bodies.find((body) => body.id === id)?.alive) standing += 1
  }
  const guarded = input.bodies.some(
    (body) => body.alive && body.routTimer <= 0 && input.escortIds.includes(body.id),
  )
  const step = advanceCartLoot(loot.claim, {
    delta: input.delta,
    elapsed: input.elapsed,
    cart: input.cart,
    player: input.player,
    guarded,
    escortFell: loot.escortsStanding > 0 && standing === 0,
    empty: false,
    playerRobs: input.playerRobs,
    bodies: input.bodies,
    mayLoot: (body) => input.raiderIds.includes(body.id),
  })
  loot.escortsStanding = standing
  if (step.plundered) loot.plundered = true
  return { step, approach: !guarded && loot.claim.claim <= 0 }
}

/** `directCaravanRaiders`: the post an idle raider is ordered to, just past the cart. */
export function raiderApproachPoint(raider: PlanPoint, cart: PlanPoint): PlanPoint {
  const dx = cart.x - raider.x
  const dz = cart.z - raider.z
  const length = Math.hypot(dx, dz)
  const scale = length > 0.001 ? HARNESS_CARAVAN_LOOT_OVERSHOOT / length : 0
  return { x: cart.x + dx * scale, z: cart.z + dz * scale }
}

/**
 * `mayLootOrdinaryCaravan`: who may load the road cart — anything hostile to the palace
 * guard's cart except its own escort, the player's squad and a finale's actors.
 */
export function mayLootRoadCart<Body extends SquadMembership & { id: string }>(
  body: Body,
  input: {
    faction: Faction
    escortIds: readonly string[]
    finaleOwned: (body: Body) => boolean
  },
): boolean {
  return (
    body.alive &&
    areAllegiancesHostile(body.allegiance, HARNESS_CARAVAN_ALLEGIANCE) &&
    !input.escortIds.includes(body.id) &&
    !isSquadMember(body, input.faction) &&
    !input.finaleOwned(body)
  )
}

/** `isOrdinaryCaravanGuarded`: a living, unbroken escort within `CARAVAN_GUARDED_RANGE`. */
export function roadCartGuarded(
  bodies: readonly LooterBody[],
  escortIds: readonly string[],
  cart: PlanPoint,
): boolean {
  return bodies.some(
    (body) =>
      body.alive &&
      escortIds.includes(body.id) &&
      body.routTimer <= 0 &&
      Math.hypot(body.x - cart.x, body.z - cart.z) <= HARNESS_CARAVAN_GUARDED_RANGE,
  )
}

/**
 * `updateCaravanEscort`'s W1-2 half, one frame of the road cart's claim: guarded by its
 * escort, robbed by every side but the palace guard, loaded by anything
 * {@link mayLootRoadCart} admits. `escortIds` are the escorts still standing.
 */
export function advanceRoadCartLoot<Body extends LooterBody & SquadMembership>(
  claim: CaravanClaimState,
  input: {
    delta: number
    elapsed: number
    cart: PlanPoint
    player: PlanPoint
    faction: Faction
    escortIds: readonly string[]
    escortFell: boolean
    empty: boolean
    bodies: readonly Body[]
    finaleOwned: (body: Body) => boolean
  },
): CaravanClaimStep {
  return advanceCartLoot(claim, {
    delta: input.delta,
    elapsed: input.elapsed,
    cart: input.cart,
    player: input.player,
    guarded: roadCartGuarded(input.bodies, input.escortIds, input.cart),
    escortFell: input.escortFell,
    empty: input.empty,
    playerRobs: areAllegiancesHostile(input.faction, HARNESS_CARAVAN_ALLEGIANCE),
    bodies: input.bodies,
    mayLoot: (body) =>
      mayLootRoadCart(body, {
        faction: input.faction,
        escortIds: input.escortIds,
        finaleOwned: input.finaleOwned,
      }),
  })
}

// ---------------------------------------------------------------------------
// W1-1 — a contract outranks the game's own random events
// ---------------------------------------------------------------------------

/** Matches `CONTRACT_QUIET_RADIUS`: no new random event this near an un-started contract. */
export const HARNESS_CONTRACT_QUIET_RADIUS = 120
/** Matches `EVENT_ENGAGEMENT_WINDOW`: a blow traded this recently is still a fight. */
export const HARNESS_EVENT_ENGAGEMENT_WINDOW = 10
/** Matches `EVENT_ENGAGEMENT_RADIUS`: beyond this from its marker the player has left it. */
export const HARNESS_EVENT_ENGAGEMENT_RADIUS = 60

/**
 * What one attempt to start a contract on arrival came to, as `startContractEvent` names it.
 * Only `crowded` and `noGround` — a genuine stall — spend start grace.
 */
export type ContractStartOutcome =
  | 'started'
  | 'queued'
  | 'engaged'
  | 'settling'
  | 'crowded'
  | 'noGround'

/**
 * `isPlayerEngagedWith`: within reach of the event's marker, and either the player acted on
 * it (robbed its cart, cut its captive loose) or traded a blow with one of its actors lately.
 */
export function playerEngagedWith(input: {
  /** Metres from the player to the event's marker. */
  away: number
  interacted: boolean
  /** `elapsed` at the last blow traded with one of its actors, or null. */
  exchangeAt: number | null
  elapsed: number
}): boolean {
  if (input.away > HARNESS_EVENT_ENGAGEMENT_RADIUS) return false
  if (input.interacted) return true
  return (
    input.exchangeAt !== null && input.elapsed - input.exchangeAt <= HARNESS_EVENT_ENGAGEMENT_WINDOW
  )
}

/**
 * `startContractEvent` before its builder runs: wait behind a contract already on the
 * ground, wait one frame for an event that has just resolved, wait for a random event the
 * player is in the middle of, stall when even the game's own events making way would not
 * leave room — or, `null`, go: the random event stands down and the builder runs.
 */
export function contractStartGate(input: {
  contractRunning: boolean
  /** The player-anchored random event up when the player arrived, if any. */
  interrupted: { active: boolean; engaged: boolean } | null
  roomOnceEventsMakeWay: boolean
}): 'queued' | 'settling' | 'engaged' | 'crowded' | null {
  if (input.contractRunning) return 'queued'
  if (input.interrupted && !input.interrupted.active) return 'settling'
  if (input.interrupted?.engaged) return 'engaged'
  if (!input.roomOnceEventsMakeWay) return 'crowded'
  return null
}

/**
 * `contractHoldsRandomEvents`: the director rolls nothing while a contract is on the ground,
 * or while the objective the player is heading for is an un-started contract whose site is
 * within {@link HARNESS_CONTRACT_QUIET_RADIUS}.
 */
export function contractHoldsRandomEvents(input: {
  contractRunning: boolean
  /** Metres to the active objective's site when it is an `offered` contract, else null. */
  offeredContractDistance: number | null
}): boolean {
  if (input.contractRunning) return true
  return (
    input.offeredContractDistance !== null &&
    input.offeredContractDistance <= HARNESS_CONTRACT_QUIET_RADIUS
  )
}
