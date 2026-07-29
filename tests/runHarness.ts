/**
 * Headless full-run harness.
 *
 * `tests/aiHarness.ts` measures decisions in an empty room: straight-line movement, no
 * navmesh, no collision, no terrain, no world. It says so itself, and every number it
 * produces is about target selection and morale rather than about a run. This file is the
 * other half — a driver that walks a whole campaign in a real generated world so run-level
 * questions can be *counted* rather than argued about: how long an objective takes, what
 * actually kills a player, and how much of the chronicle a player is ever in a position to
 * witness.
 *
 * ---
 *
 * **WHAT IT IS.** Real shipped code wherever the code is headless-capable:
 *
 * - `generateWorld` — the same world the browser gets, including the 500-seed gate's
 *   campaign graphs.
 * - `TerrainSystem` — real heights, slopes and biomes.
 * - `CollisionWorld` — real bounds, walkable-slope tests and swept movement resolution.
 * - `NavigationSystem` — the real navmesh grid and the real `findPath`, including the grid
 *   build the roadmap's 0.3 is about.
 * - `Chronicle.tickChronicle` and `Materialization.findPendingMaterializations` — the real
 *   off-screen world.
 * - `WorldEnvironment` — the real day/night and weather mix, advanced in the engine's own
 *   per-frame order (chronicle reads the mix *before* the player moves; the weather target
 *   is resolved *after*). That ordering is the whole point of the schedule arms.
 * - `CampaignDirector` — the real objectives, event pacing and chronicle commitments.
 * - `CombatResolver` — the real damage tables, action contract, poise and stagger.
 * - `ActorAi` — the real threat selection, morale and player-pursuit gating.
 * - `Fauna`, `ActorBudget` — the real beast profiles and the real actor cap.
 *
 * ---
 *
 * **WHAT IT IS NOT, AND WHAT THAT COSTS.** The named risk for this harness is false
 * confidence from something that models less than it appears to, so the gaps are listed
 * with what each one biases:
 *
 * 1. **No props, buildings or trees as colliders.** Only the world bounds and the terrain
 *    slope stop a body. Paths are therefore optimistic: a route the harness walks in a
 *    straight line may be a route the game makes you go round. **Bias: travel times are
 *    lower bounds.**
 * 2. **No region streaming cost.** Regions activate instantly. The 20–29 ms median grid
 *    build that roadmap 0.3 is about is *performed* here (so the code is exercised) but
 *    costs no simulated time. **Bias: says nothing about frame pacing.**
 * 3. **No player aim.** The scripted policies swing at whatever is inside reach rather than
 *    at what the player is looking at, and there is no bow, cleave, shield or ability.
 *    **Bias: player damage output is a floor, and blocking never happens, so incoming
 *    damage is a ceiling.**
 * 4. **Events are counted, not fought.** Materialization is real and its *exposure* is what
 *    this harness is for, but a materialized event spawns no actors here. **Bias: fights
 *    are encounter-driven only; event difficulty is not measured at all.**
 * 5. **No rendering, audio, camera, hit-stop or particles.** Nothing here can tell you
 *    whether a fight feels good.
 * 6. **Flanking is still unmeasurable**, for the same reason `aiHarness.ts` gives: an
 *    approach path needs steering and separation, and this file's actors steer only around
 *    terrain.
 *
 * So: a number from this harness describes **the shape of a run** — pacing, exposure,
 * attrition — not the experience of playing one.
 *
 * ---
 *
 * **THE MOVEMENT WARNING FROM `aiHarness.ts` APPLIES HERE TOO.** Twice a behaviour whose
 * whole point was *disengaging* degenerated into standing in a fight not fighting, and both
 * times it silently inverted a measurement. This file's `idle` policy exists as the control
 * for exactly that class of error: it is a run where the player provably does not move, so
 * any metric that fails to separate it from `beeline` is a metric that is not measuring
 * what it claims to.
 */

import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import { getSiteWorldPosition2D } from '../src/game/content/registry.ts'
import {
  areAllegiancesHostile,
  isBeastRole,
  type ActorRole,
  type Allegiance,
  type Faction,
  type Objective,
  type ZoneId,
} from '../src/game/types.ts'
import { CollisionWorld } from '../src/game/systems/CollisionWorld.ts'
import { NavigationSystem } from '../src/game/systems/NavigationSystem.ts'
import { TerrainSystem } from '../src/game/world/TerrainSystem.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import {
  createChronicleRegions,
  createChronicleState,
  getChronicleProtectedRegionIds,
  getContestedRegionIds,
  tickChronicle,
  type ChronicleEvent,
  type ChronicleState,
  type RegionChronicleState,
} from '../src/game/world/Chronicle.ts'
import { findPendingMaterializations } from '../src/game/world/Materialization.ts'
import {
  advanceWeatherMix,
  computeNightFactor,
  computeStormFactor,
  createChronicleEnvironment,
  createWeatherMix,
  weatherKindForBiome,
  type WeatherKind,
  type WeatherMix,
} from '../src/game/world/WorldEnvironment.ts'
import {
  campaignObjectivesComplete,
  commitChronicleTicks,
  completeObjectiveEntry,
  createGeneratedObjectives,
  enemyHealthMultiplier,
  getActiveObjectiveNode,
  isWithinObjectiveArrival,
  playerObjectiveRatio,
  selectChronicleAnnouncements,
} from '../src/game/world/CampaignDirector.ts'
import {
  actionCooldown,
  actionRecovery,
  actionWindup,
  actorMaxPoise,
  advanceReaction,
  applyDamageReaction,
  isWithinContact,
  playerArmor,
  resolveActorDamage,
  resolvePlayerDamage,
  rollMeleeDamage,
  type CombatActor,
} from '../src/game/world/CombatResolver.ts'
import {
  aiDistance,
  beastPackShare,
  evaluateMorale,
  evaluatePlayerPursuit,
  localGroupShare,
  selectThreat,
  THREAT_PLAYER,
  type AiActor,
  type AiPoint,
} from '../src/game/world/ActorAi.ts'
import {
  BEAST_PROFILES,
  BEAST_LEASH_RANGE,
  BEAST_SENSE_RANGE,
  WOLF_PACK_RADIUS,
} from '../src/game/world/Fauna.ts'

// ---------------------------------------------------------------------------
// Constants, matched to the engine
// ---------------------------------------------------------------------------

/** Matches `GameEngine`'s player collider. */
export const HARNESS_PLAYER_RADIUS = 0.64
/** Matches `GameEngine`'s ordinary actor collider. */
export const HARNESS_ACTOR_RADIUS = 0.56
/** Matches the engine's actor-vs-player stop distance. */
export const HARNESS_PLAYER_CONTACT = 2.2
/** Matches `MORALE_GROUP_RADIUS`. */
export const HARNESS_MORALE_RADIUS = 14
/** Matches `MORALE_ROUT_SECONDS`. */
export const HARNESS_ROUT_SECONDS = 7
/** Matches `CORPSE_LIFETIME`: how long a body still counts for morale. */
export const HARNESS_CORPSE_LIFETIME = 12
/** Matches `MAX_ACTORS`, the shipped actor cap. */
export const HARNESS_MAX_ACTORS = 25
/** Matches the engine's player walk speed. */
export const HARNESS_PLAYER_SPEED = 6.4
/** Seconds between the player's swings. Matches the engine's melee cooldown. */
export const HARNESS_PLAYER_ATTACK_COOLDOWN = 0.42
/** The player's reach. */
export const HARNESS_PLAYER_REACH = 2.6
/** How far the player can see an event resolve. Governs the exposure metric. */
export const HARNESS_WITNESS_RADIUS = 60
/** How far the streaming window reaches, in regions. Matches the engine's 3x3. */
export const HARNESS_STREAM_RADIUS = 1
/** Encounter actors spawn when the player comes this close. */
export const HARNESS_ENCOUNTER_TRIGGER = 34
/** A run is abandoned after this many simulated seconds. */
export const HARNESS_TIME_LIMIT = 900
/** Matches the engine's `MATERIALIZE_INTERVAL`: at most one situation per six seconds. */
export const HARNESS_MATERIALIZE_INTERVAL = 6
/** How often the harness looks for encounters to trigger. */
export const HARNESS_ENCOUNTER_SCAN_INTERVAL = 1

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InputPolicy = 'beeline' | 'cautious' | 'idle'

/** Why a run ended. `timeout` is the honest answer, not a failure of the harness. */
export type RunOutcome = 'victory' | 'defeat' | 'timeout'

/** What killed the player, attributed to the source that landed the last hit. */
export type DeathCause = 'beast' | 'faction' | 'bleeding' | 'none'

export interface ObjectiveReport {
  id: string
  /** Simulated seconds from run start, or null if never completed. */
  completedAt: number | null
  /** Metres the player actually walked while this objective was the active one. */
  distanceWalked: number
  /** Straight-line metres from where the player stood when it became active. */
  straightLineDistance: number
}

export interface DamageBySource {
  /** Keyed by actor role. */
  byRole: Record<string, number>
  /** Keyed by allegiance, so beast pressure and faction war can be told apart. */
  byAllegiance: Record<string, number>
  bleeding: number
  total: number
}

export interface EventExposure {
  /** Chronicle events the world produced, in total. */
  chronicleEvents: number
  /** How many of those the player was near enough and had discovered to witness. */
  witnessed: number
  /** How many resolved out of sight — the fog-of-war number. */
  offScreen: number
  /** Situations Layer 2 was ready to materialize. */
  materializable: number
  /** How many of those the player was in the region for. */
  materializedNearPlayer: number
}

export interface RunReport {
  seed: number
  faction: Faction
  policy: InputPolicy
  /** Frames per simulated second the run was driven at. */
  hz: number
  outcome: RunOutcome
  elapsed: number
  frames: number
  objectives: ObjectiveReport[]
  objectivesCompleted: number
  objectivesTotal: number
  distanceWalked: number
  damageTaken: DamageBySource
  damageDealt: DamageBySource
  kills: number
  deathCause: DeathCause
  /** Simulated seconds spent in each region, keyed by region id. */
  regionDwell: Record<string, number>
  regionsVisited: number
  eventExposure: EventExposure
  /** Chronicle log ids in order, the "chronicle history" the schedule arms compare. */
  chronicleHistory: string[]
  chronicleTicks: number
  /** Weather target changes, and where the player was standing for each. */
  weatherTargetChanges: number
  finalWeather: WeatherKind
  finalStormFactor: number
  health: number
}

export interface RunOptions {
  seed: number
  faction: Faction
  policy?: InputPolicy
  /** Simulation rate. The scripted schedules are 30, 60 and 144. */
  hz?: number
  timeLimit?: number
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

interface HarnessActor extends AiActor, CombatActor {
  x: number
  z: number
  allegiance: Allegiance
  speed: number
  attackCooldown: number
  actionPhase: 'idle' | 'windup' | 'recovery'
  actionRemaining: number
  actionTargetIsPlayer: boolean
  actionTargetId: string | null
  hostileToPlayer: boolean
  aggroMemory: number
  routTimer: number
  deathAt: number | null
  regionId: string
  encounterId: string
}

function actorPoint(actor: HarnessActor): AiPoint {
  return { x: actor.x, y: 0, z: actor.z }
}

function emptyDamage(): DamageBySource {
  return { byRole: {}, byAllegiance: {}, bleeding: 0, total: 0 }
}

function record(
  into: DamageBySource,
  role: string,
  allegiance: string,
  amount: number,
): void {
  into.byRole[role] = (into.byRole[role] ?? 0) + amount
  into.byAllegiance[allegiance] = (into.byAllegiance[allegiance] ?? 0) + amount
  into.total += amount
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/**
 * Drives one run to victory, defeat or the time limit, and reports what happened.
 *
 * Deterministic: every roll comes from a stream derived from the seed, exactly as
 * `GameEngine` derives its five. Nothing here calls `Math.random`, `Date.now` or
 * `performance.now`, so the same arguments always produce the same report.
 */
export function runHarness(options: RunOptions): RunReport {
  const policy = options.policy ?? 'beeline'
  const hz = options.hz ?? 60
  const delta = 1 / hz
  const timeLimit = options.timeLimit ?? HARNESS_TIME_LIMIT

  const blueprint = generateWorld(options.seed)
  const terrain = new TerrainSystem(blueprint)
  const collision = new CollisionWorld(terrain)
  collision.setWorldBounds(terrain.bounds)
  const navigation = new NavigationSystem(blueprint, terrain, collision)

  const combatRng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:combat'))
  const eventRng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:event'))
  const chronicleRng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:chronicle'))

  const chronicleState: ChronicleState = createChronicleState()
  const chronicleRegions: Map<string, RegionChronicleState> =
    createChronicleRegions(blueprint)
  const protectedRegionIds = getChronicleProtectedRegionIds(blueprint)

  const objectives: Objective[] = createGeneratedObjectives(blueprint, options.faction)
  const objectiveReports = new Map<string, ObjectiveReport>()

  const startSite = blueprint.sites.find(
    (site) => site.id === blueprint.starts[options.faction],
  )
  if (!startSite) throw new Error('Generated start site is missing')
  const start = getSiteWorldPosition2D(blueprint, startSite)
  if (!start) throw new Error('Generated start position is missing')

  const player = {
    x: start.x,
    z: start.z,
    health: 100,
    maxHealth: 100,
    damage: 28,
    bleeding: 0,
    attackCooldown: 0,
  }

  let elapsed = 0
  let frames = 0
  let chronicleAccumulator = 0
  let chronicleTicks = 0
  let distanceWalked = 0
  let kills = 0
  let deathCause: DeathCause = 'none'
  let outcome: RunOutcome = 'timeout'
  const damageTaken = emptyDamage()
  const damageDealt = emptyDamage()
  const regionDwell: Record<string, number> = {}
  const discoveredRegionIds = new Set<string>()
  const triggeredEncounterIds = new Set<string>()
  const materializedSituationIds = new Set<string>()
  const seenAftermathRegionIds = new Set<string>()
  const exposure: EventExposure = {
    chronicleEvents: 0,
    witnessed: 0,
    offScreen: 0,
    materializable: 0,
    materializedNearPlayer: 0,
  }
  let weatherTargetChanges = 0
  let announcedChronicleLines = 0
  let materializeCooldown = 0
  let encounterScanCooldown = 0
  let lastAttackerCause: DeathCause = 'none'

  const actors: HarnessActor[] = []
  let actorSequence = 0

  const zoneAt = (x: number, z: number): ZoneId => {
    const biome = terrain.getBiomeAt(x, z)
    return biome === 'neutral' || biome === 'palace' || biome === 'forest' || biome === 'fort'
      ? biome
      : 'neutral'
  }
  const regionIdAt = (x: number, z: number): string => {
    const id = terrain.getRegionIdAt(x, z)
    return id === undefined ? '' : String(id)
  }

  let weatherZone = zoneAt(player.x, player.z)
  let weatherTarget: WeatherKind = weatherKindForBiome(weatherZone)
  const weatherMix: WeatherMix = createWeatherMix(weatherTarget)

  const activeRegionIds = (): string[] => {
    const current = terrain.getRegionAt(player.x, player.z)
    if (!current) return []
    const ids: string[] = []
    for (const region of terrain.layout.regions) {
      if (
        Math.abs(region.coordinate.x - current.coordinate.x) <= HARNESS_STREAM_RADIUS &&
        Math.abs(region.coordinate.z - current.coordinate.z) <= HARNESS_STREAM_RADIUS
      ) {
        ids.push(String(region.id))
      }
    }
    return ids
  }

  let simulatedRegionIds = new Set(activeRegionIds())
  navigation.setActiveRegions(simulatedRegionIds)
  discoveredRegionIds.add(regionIdAt(player.x, player.z))

  // --- objective bookkeeping -------------------------------------------------

  let trackedObjectiveId: string | null = null
  let trackedFrom: { x: number; z: number } | null = null

  const trackObjective = (id: string | null): void => {
    if (id === trackedObjectiveId) return
    trackedObjectiveId = id
    trackedFrom = id === null ? null : { x: player.x, z: player.z }
    if (id !== null && !objectiveReports.has(id)) {
      objectiveReports.set(id, {
        id,
        completedAt: null,
        distanceWalked: 0,
        straightLineDistance: 0,
      })
    }
  }

  // --- pathing ---------------------------------------------------------------

  let waypoints: Array<readonly [number, number]> = []
  let repathAt = -1

  const pathTo = (targetX: number, targetZ: number): void => {
    const path = navigation.findPath(
      { x: player.x, z: player.z },
      { x: targetX, z: targetZ },
    )
    waypoints = path ? path.map((point) => [point.x, point.z] as const) : []
  }

  // --- spawning --------------------------------------------------------------

  const spawnEncounter = (regionId: string): void => {
    for (const slot of blueprint.encounters) {
      if (String(slot.regionId) !== regionId) continue
      if (triggeredEncounterIds.has(slot.id)) continue
      const site = slot.siteId ? getSiteWorldPosition2D(blueprint, slot.siteId) : undefined
      const anchorX = site?.x ?? player.x
      const anchorZ = site?.z ?? player.z
      if (Math.hypot(anchorX - player.x, anchorZ - player.z) > HARNESS_ENCOUNTER_TRIGGER) {
        continue
      }
      triggeredEncounterIds.add(slot.id)
      const chronicle = chronicleRegions.get(regionId)
      const beastLed = (chronicle?.beastPressure ?? 0) > 0.55
      const count = Math.min(4, 2 + Math.floor(eventRng.next() * 3))
      for (let index = 0; index < count; index += 1) {
        if (actors.filter((actor) => actor.alive).length >= HARNESS_MAX_ACTORS) break
        const role: ActorRole = beastLed
          ? (['wolf', 'wolf', 'boar', 'bear'] as ActorRole[])[eventRng.integer(0, 4)]
          : (['soldier', 'soldier', 'scout', 'brute'] as ActorRole[])[
              eventRng.integer(0, 4)
            ]
        const allegiance: Allegiance = beastLed
          ? 'beast'
          : ((['elf', 'guard', 'villain'] as Faction[]).filter(
              (candidate) => candidate !== options.faction,
            )[eventRng.integer(0, 2)] as Allegiance)
        const beast = isBeastRole(role) ? BEAST_PROFILES[role] : null
        const maxHp = Math.round(
          (beast?.hp ?? 90) * enemyHealthMultiplier(1, areAllegiancesHostile(options.faction, allegiance)),
        )
        const angle = eventRng.next() * Math.PI * 2
        const radius = 8 + eventRng.next() * 10
        actorSequence += 1
        actors.push({
          id: `actor-${actorSequence}`,
          allegiance,
          role,
          alive: true,
          ignoredTargetId: null,
          targetId: null,
          packId: beastLed ? `pack-${slot.id}` : null,
          packKinSize: beastLed ? count : 1,
          hp: maxHp,
          maxHp,
          playerAggro: false,
          x: anchorX + Math.cos(angle) * radius,
          z: anchorZ + Math.sin(angle) * radius,
          speed: beast?.speed ?? 3.7,
          attackCooldown: 0,
          actionPhase: 'idle',
          actionRemaining: 0,
          actionTargetIsPlayer: false,
          actionTargetId: null,
          hostileToPlayer: areAllegiancesHostile(options.faction, allegiance),
          aggroMemory: 0,
          routTimer: 0,
          deathAt: null,
          reaction: 'none',
          reactionRemaining: 0,
          poise: actorMaxPoise(role),
          maxPoise: actorMaxPoise(role),
          poiseRecoveryDelay: 0,
          staggerImmunity: 0,
          regionId,
          encounterId: slot.id,
        })
      }
    }
  }

  // --- the loop --------------------------------------------------------------

  while (elapsed < timeLimit) {
    frames += 1
    elapsed += delta

    // 1. Chronicle, against the weather mix as it stood before the player moved. This is
    //    the engine's order, and it is what the 30/60/144 Hz arms are testing.
    const environment = createChronicleEnvironment(elapsed, weatherMix)
    const commitment = commitChronicleTicks(chronicleAccumulator, delta)
    chronicleAccumulator = commitment.accumulator
    if (commitment.ticks > 0) {
      const ratio = playerObjectiveRatio(objectives)
      const produced: ChronicleEvent[] = []
      for (let tick = 0; tick < commitment.ticks; tick += 1) {
        produced.push(
          ...tickChronicle({
            blueprint,
            state: chronicleState,
            regions: chronicleRegions,
            rng: chronicleRng,
            environment,
            playerFaction: options.faction,
            playerObjectiveRatio: ratio,
            protectedRegionIds,
            frozenRegionIds: simulatedRegionIds,
          }),
        )
        chronicleTicks += 1
      }
      getContestedRegionIds(blueprint, chronicleRegions)
      exposure.chronicleEvents += produced.length
      // The three gates that decide whether the player is ever told: salience, the
      // two-line batch cap, and fog of war. `announced` is the subset that would have
      // reached the notice channel; `witnessed` is the wider "was in a position to see it".
      const announced = selectChronicleAnnouncements(produced, discoveredRegionIds)
      announcedChronicleLines += announced.length
      for (const event of produced) {
        const regionId = String(event.regionId)
        const region = terrain.getRegion(regionId)
        // Distance to the region's *rectangle*, not to its centre. A region is roughly
        // 140 m across, so a centre test would call the square the player is standing in
        // "off-screen" whenever they were near its edge, and the exposure number would be
        // a measurement of region size rather than of what a player can see.
        const distance = region
          ? distanceToBounds(player.x, player.z, region.bounds)
          : Number.POSITIVE_INFINITY
        if (distance <= HARNESS_WITNESS_RADIUS && discoveredRegionIds.has(regionId)) {
          exposure.witnessed += 1
        } else {
          exposure.offScreen += 1
        }
      }
    }

    // 2. Materialization, which is the other half of exposure. Gated on the engine's own
    //    interval rather than run every frame: the engine materializes at most one
    //    situation every `MATERIALIZE_INTERVAL` seconds, and scanning per frame would both
    //    cost more than the engine does and count situations the engine would never see.
    materializeCooldown -= delta
    if (materializeCooldown <= 0) {
      materializeCooldown = HARNESS_MATERIALIZE_INTERVAL
      const pending = findPendingMaterializations({
        blueprint,
        regions: chronicleRegions,
        chronicle: chronicleState,
        simulatedRegionIds,
        protectedRegionIds,
        playerFaction: options.faction,
        seenAftermathRegionIds,
      })
      for (const situation of pending) {
        if (materializedSituationIds.has(situation.id)) continue
        materializedSituationIds.add(situation.id)
        exposure.materializable += 1
        if (simulatedRegionIds.has(situation.regionId)) exposure.materializedNearPlayer += 1
        if (situation.kind === 'aftermath') seenAftermathRegionIds.add(situation.regionId)
      }
    }

    // 3. The player.
    const activeNode = getActiveObjectiveNode(blueprint, options.faction, objectives)
    trackObjective(activeNode?.id ?? null)
    const objectiveSite = activeNode
      ? getSiteWorldPosition2D(blueprint, activeNode.siteId)
      : undefined

    if (policy !== 'idle' && objectiveSite) {
      const retreating =
        policy === 'cautious' && player.health < player.maxHealth * 0.35
      if (elapsed >= repathAt || waypoints.length === 0) {
        repathAt = elapsed + 2
        pathTo(objectiveSite.x, objectiveSite.z)
      }
      let targetX = objectiveSite.x
      let targetZ = objectiveSite.z
      if (waypoints.length > 0) {
        const [wx, wz] = waypoints[0]
        if (Math.hypot(wx - player.x, wz - player.z) < 1.5) waypoints.shift()
        else {
          targetX = wx
          targetZ = wz
        }
      }
      if (retreating) {
        // Away from the nearest threat rather than toward the objective. The `idle`
        // control exists because a "retreat" that does not move is the degenerate case
        // `aiHarness.ts` warns about twice.
        const threat = nearestHostile(actors, player)
        if (threat) {
          targetX = player.x + (player.x - threat.x)
          targetZ = player.z + (player.z - threat.z)
        }
      }
      const dx = targetX - player.x
      const dz = targetZ - player.z
      const length = Math.hypot(dx, dz)
      if (length > 0.001) {
        const step = Math.min(HARNESS_PLAYER_SPEED * delta, length)
        const moved = collision.resolveMovement(
          { x: player.x, z: player.z },
          { x: player.x + (dx / length) * step, z: player.z + (dz / length) * step },
          HARNESS_PLAYER_RADIUS,
        )
        const travelled = Math.hypot(moved.x - player.x, moved.z - player.z)
        player.x = moved.x
        player.z = moved.z
        distanceWalked += travelled
        const tracked = trackedObjectiveId
          ? objectiveReports.get(trackedObjectiveId)
          : undefined
        if (tracked) tracked.distanceWalked += travelled
      }
    }

    // 4. Streaming, dwell and discovery.
    const currentRegionId = regionIdAt(player.x, player.z)
    if (currentRegionId) {
      regionDwell[currentRegionId] = (regionDwell[currentRegionId] ?? 0) + delta
      discoveredRegionIds.add(currentRegionId)
    }
    const nextActive = new Set(activeRegionIds())
    if (!sameSet(nextActive, simulatedRegionIds)) {
      simulatedRegionIds = nextActive
      navigation.setActiveRegions(simulatedRegionIds)
      encounterScanCooldown = 0
    }
    // Streamed-in regions count as discovered, exactly as they do in the engine: the fog
    // lifts on the 3x3 window, not only on the square the player is standing in. That is
    // what makes the exposure number a measure of the *player's* view rather than of the
    // one square under their feet.
    for (const regionId of simulatedRegionIds) discoveredRegionIds.add(regionId)
    encounterScanCooldown -= delta
    if (encounterScanCooldown <= 0) {
      encounterScanCooldown = HARNESS_ENCOUNTER_SCAN_INTERVAL
      for (const regionId of simulatedRegionIds) spawnEncounter(regionId)
    }

    // 5. Actors: real decisions, real damage.
    stepActors({
      actors,
      player,
      delta,
      elapsed,
      faction: options.faction,
      combatRng,
      collision,
      damageTaken,
      onKill: () => {
        kills += 1
      },
      onPlayerHit: (actor, amount) => {
        record(damageTaken, actor.role, actor.allegiance, amount)
        lastAttackerCause = actor.allegiance === 'beast' ? 'beast' : 'faction'
      },
    })

    // 6. The player's swing. No aim, no ability: the stated limit.
    player.attackCooldown = Math.max(0, player.attackCooldown - delta)
    if (policy !== 'idle' && player.attackCooldown <= 0) {
      const victim = nearestHostileInReach(actors, player)
      if (victim) {
        player.attackCooldown = HARNESS_PLAYER_ATTACK_COOLDOWN
        const outcomeHit = resolveActorDamage({
          target: victim,
          baseDamage: player.damage + combatRng.next() * 7,
          attackKind: 'melee',
          facingDotToSource: null,
        })
        victim.hp = Math.max(0, victim.hp - outcomeHit.dealt)
        record(damageDealt, victim.role, victim.allegiance, outcomeHit.dealt)
        applyDamageReaction(victim, outcomeHit, 'melee')
        if (outcomeHit.killed) {
          victim.alive = false
          victim.deathAt = elapsed
          kills += 1
        }
      }
    }

    // 7. Objective arrival.
    if (activeNode?.kind === 'arrive' && objectiveSite) {
      if (
        isWithinObjectiveArrival(player.x, player.z, objectiveSite.x, objectiveSite.z)
      ) {
        completeObjectiveEntry(objectives, activeNode.id)
        finishObjective(activeNode.id)
      }
    }
    // Anything that is not an arrival completes when the player is standing on it and
    // nothing hostile is left within reach — a stand-in for the interaction the engine
    // gates on a keypress, and a stated simplification.
    if (activeNode && activeNode.kind !== 'arrive' && objectiveSite) {
      const onSite = Math.hypot(
        objectiveSite.x - player.x,
        objectiveSite.z - player.z,
      ) <= 6
      const clear = !actors.some(
        (actor) =>
          actor.alive &&
          actor.hostileToPlayer &&
          Math.hypot(actor.x - player.x, actor.z - player.z) < 12,
      )
      if (onSite && clear && policy !== 'idle') {
        completeObjectiveEntry(objectives, activeNode.id)
        finishObjective(activeNode.id)
      }
    }

    // 8. Bleeding, then the run-ending checks, in the engine's order.
    if (player.bleeding > 0) {
      const amount = player.bleeding * delta
      player.health -= amount
      damageTaken.bleeding += amount
      damageTaken.total += amount
    }
    if (player.health <= 0) {
      outcome = 'defeat'
      deathCause = lastAttackerCause
      break
    }
    if (campaignObjectivesComplete(objectives)) {
      outcome = 'victory'
      break
    }

    // 9. Weather, last, against the player's *new* position. The hazard the roadmap names:
    //    `advanceWeatherMix` composes exactly for a fixed target, so the mix is not the
    //    problem — *when* the target changes, and where the player was standing when it
    //    did, is.
    const nextZone = zoneAt(player.x, player.z)
    if (nextZone !== weatherZone) {
      weatherZone = nextZone
      weatherTarget = weatherKindForBiome(nextZone)
      weatherTargetChanges += 1
    }
    advanceWeatherMix(weatherMix, weatherTarget, delta)

    // Corpses drop off the morale roster on the same schedule as the engine's.
    for (let index = actors.length - 1; index >= 0; index -= 1) {
      const actor = actors[index]
      if (!actor.alive && actor.deathAt !== null && elapsed - actor.deathAt > HARNESS_CORPSE_LIFETIME) {
        actors.splice(index, 1)
      }
    }
  }

  function finishObjective(id: string): void {
    const report = objectiveReports.get(id)
    if (!report || report.completedAt !== null) return
    report.completedAt = elapsed
    if (trackedFrom) {
      report.straightLineDistance = Math.hypot(
        player.x - trackedFrom.x,
        player.z - trackedFrom.z,
      )
    }
  }

  const reports: ObjectiveReport[] = objectives.map(
    (objective) =>
      objectiveReports.get(objective.id) ?? {
        id: objective.id,
        completedAt: null,
        distanceWalked: 0,
        straightLineDistance: 0,
      },
  )

  return {
    seed: blueprint.seed,
    faction: options.faction,
    policy,
    hz,
    outcome,
    elapsed,
    frames,
    objectives: reports,
    objectivesCompleted: objectives.filter((objective) => objective.done).length,
    objectivesTotal: objectives.length,
    distanceWalked,
    damageTaken,
    damageDealt,
    kills,
    deathCause,
    regionDwell,
    regionsVisited: Object.keys(regionDwell).length,
    eventExposure: exposure,
    chronicleHistory: chronicleState.log.map((event) => event.id),
    chronicleTicks,
    weatherTargetChanges,
    finalWeather: weatherTarget,
    finalStormFactor: computeStormFactor(weatherMix),
    health: Math.max(0, player.health),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sameSet(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
  if (first.size !== second.size) return false
  for (const value of first) if (!second.has(value)) return false
  return true
}

/** Zero inside the rectangle, otherwise the shortest distance to its edge. */
function distanceToBounds(
  x: number,
  z: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): number {
  const dx = Math.max(bounds.minX - x, 0, x - bounds.maxX)
  const dz = Math.max(bounds.minZ - z, 0, z - bounds.maxZ)
  return Math.hypot(dx, dz)
}

function nearestHostile(
  actors: readonly HarnessActor[],
  player: { x: number; z: number },
): HarnessActor | null {
  let best: HarnessActor | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const actor of actors) {
    if (!actor.alive || !actor.hostileToPlayer) continue
    const distance = Math.hypot(actor.x - player.x, actor.z - player.z)
    if (distance < bestDistance) {
      bestDistance = distance
      best = actor
    }
  }
  return best
}

function nearestHostileInReach(
  actors: readonly HarnessActor[],
  player: { x: number; z: number },
): HarnessActor | null {
  const nearest = nearestHostile(actors, player)
  if (!nearest) return null
  return Math.hypot(nearest.x - player.x, nearest.z - player.z) <= HARNESS_PLAYER_REACH
    ? nearest
    : null
}

interface StepContext {
  actors: HarnessActor[]
  player: { x: number; z: number; health: number; maxHealth: number; bleeding: number }
  delta: number
  elapsed: number
  faction: Faction
  combatRng: RandomStream
  collision: CollisionWorld
  damageTaken: DamageBySource
  onKill: () => void
  onPlayerHit: (actor: HarnessActor, amount: number) => void
}

/**
 * One actor step: the real threat scoring, the real morale rule, the real player-pursuit
 * gate, the real action contract and the real damage.
 *
 * Movement is a collision-resolved step toward the chosen target — real terrain and world
 * bounds, but no props, which is limit 1 in this file's header.
 */
function stepActors(context: StepContext): void {
  const { actors, player, delta, elapsed, combatRng, collision } = context
  const living = actors.filter((actor) => actor.alive)
  const playerPoint: AiPoint = { x: player.x, y: 0, z: player.z }

  for (const actor of living) {
    advanceReaction(actor, delta)
    actor.attackCooldown = Math.max(0, actor.attackCooldown - delta)
    actor.aggroMemory = Math.max(0, actor.aggroMemory - delta)

    const distanceToPlayer = aiDistance(actorPoint(actor), playerPoint)
    const pursuit = evaluatePlayerPursuit({
      hostileToPlayer: actor.hostileToPlayer,
      playerAggro: actor.playerAggro,
      aggroMemory: actor.aggroMemory,
      playerDistance: distanceToPlayer,
      senseRange: isBeastRole(actor.role) ? BEAST_SENSE_RANGE : 22,
      leashRange: isBeastRole(actor.role) ? BEAST_LEASH_RANGE : 60,
    }).shouldPursue

    const groupShare = localGroupShare(actor, actors, HARNESS_MORALE_RADIUS, actorPoint)
    const morale = evaluateMorale(actor.role, {
      hpFraction: actor.hp / Math.max(1, actor.maxHp),
      groupShare,
      packShare: beastPackShare(actor, actors, WOLF_PACK_RADIUS, actorPoint),
      commanderNearby: false,
      commanderLost: false,
      alarmDistance: Number.POSITIVE_INFINITY,
    })
    if (morale !== 'none' && actor.routTimer <= 0) actor.routTimer = HARNESS_ROUT_SECONDS
    if (actor.routTimer > 0) {
      actor.routTimer = Math.max(0, actor.routTimer - delta)
      // A routed actor *leaves*. The `aiHarness.ts` warning in this file's header is
      // exactly about this branch degenerating into standing still.
      moveActor(actor, actor.x - (player.x - actor.x), actor.z - (player.z - actor.z), delta, collision)
      continue
    }

    const threat = selectThreat(
      actor,
      actors,
      24,
      actorPoint,
      pursuit
        ? {
            position: playerPoint,
            hpFraction: player.health / Math.max(1, player.maxHealth),
            provoked: actor.playerAggro,
          }
        : null,
    )

    let targetX = actor.x
    let targetZ = actor.z
    let targetIsPlayer = false
    let target: HarnessActor | null = null
    if (threat === THREAT_PLAYER) {
      targetX = player.x
      targetZ = player.z
      targetIsPlayer = true
    } else if (threat) {
      target = threat as HarnessActor
      targetX = target.x
      targetZ = target.z
      actor.targetId = target.id
    } else {
      continue
    }

    const distance = Math.hypot(targetX - actor.x, targetZ - actor.z)
    const contactRange = targetIsPlayer ? HARNESS_PLAYER_CONTACT : 2.45

    if (actor.actionPhase !== 'idle') {
      actor.actionRemaining -= delta
      if (actor.actionRemaining <= 0) {
        if (actor.actionPhase === 'windup') {
          if (isWithinContact(distance, contactRange) && actor.reaction !== 'stagger') {
            if (targetIsPlayer) {
              const base = rollMeleeDamage(actor.role, 'player', () => combatRng.next())
              const hit = resolvePlayerDamage({
                baseDamage: base,
                health: player.health,
                shieldActive: false,
                hasIncomingDirection: true,
                incomingDotAim: 0,
                armor: playerArmor(context.faction),
              })
              if (hit.applied) {
                player.health = Math.max(0, player.health - hit.dealt)
                context.onPlayerHit(actor, hit.dealt)
              }
            } else if (target) {
              const base = rollMeleeDamage(actor.role, 'actor', () => combatRng.next())
              const hit = resolveActorDamage({
                target,
                baseDamage: base,
                attackKind: 'allyMelee',
                facingDotToSource: null,
              })
              target.hp = Math.max(0, target.hp - hit.dealt)
              applyDamageReaction(target, hit, 'allyMelee')
              if (hit.killed) {
                target.alive = false
                target.deathAt = elapsed
              }
            }
          }
          actor.actionPhase = 'recovery'
          actor.actionRemaining = actionRecovery(actor.role)
        } else {
          actor.actionPhase = 'idle'
          actor.actionRemaining = 0
        }
      }
      continue
    }

    if (isWithinContact(distance, contactRange) && actor.attackCooldown <= 0) {
      actor.actionPhase = 'windup'
      actor.actionRemaining = actionWindup(actor.role)
      actor.attackCooldown = actionCooldown(
        targetIsPlayer ? 'meleePlayer' : 'meleeActor',
        actor.role,
      )
      continue
    }
    if (distance > contactRange) moveActor(actor, targetX, targetZ, delta, collision)
  }
}

function moveActor(
  actor: HarnessActor,
  targetX: number,
  targetZ: number,
  delta: number,
  collision: CollisionWorld,
): void {
  const dx = targetX - actor.x
  const dz = targetZ - actor.z
  const length = Math.hypot(dx, dz)
  if (length < 0.001) return
  const step = Math.min(actor.speed * delta, length)
  const moved = collision.resolveMovement(
    { x: actor.x, z: actor.z },
    { x: actor.x + (dx / length) * step, z: actor.z + (dz / length) * step },
    HARNESS_ACTOR_RADIUS,
  )
  actor.x = moved.x
  actor.z = moved.z
}

/** The night factor the chronicle read at a given moment, for reporting. */
export function harnessNightFactor(elapsed: number): number {
  return computeNightFactor(elapsed)
}

// ---------------------------------------------------------------------------
// Sweeps
// ---------------------------------------------------------------------------

export interface SweepOptions {
  /** How many seeds to run. The roadmap's figure is 500. */
  seeds: number
  /** First seed; each subsequent one is `seed + index * stride`. */
  firstSeed?: number
  stride?: number
  /** Rotate through the three factions, or pin one. */
  faction?: Faction
  policy?: InputPolicy
  hz?: number
  timeLimit?: number
}

export interface SweepReport {
  seeds: number
  policy: InputPolicy
  hz: number
  outcomes: Record<RunOutcome, number>
  /** Share of runs that finished the campaign. */
  completionRate: number
  deathCauses: Record<DeathCause, number>
  medianElapsed: number
  medianDistanceWalked: number
  medianRegionsVisited: number
  /** Median simulated seconds to the first objective, over runs that reached it. */
  medianFirstObjectiveTime: number
  /** Median metres walked to the first objective. */
  medianFirstObjectiveDistance: number
  meanDamageTaken: number
  meanDamageDealt: number
  meanKills: number
  /** Damage taken per allegiance, summed over the sweep. */
  damageTakenByAllegiance: Record<string, number>
  totalChronicleEvents: number
  totalWitnessed: number
  totalOffScreen: number
  /** Share of chronicle history a player was in a position to see. */
  witnessShare: number
}

const FACTION_ROTATION: readonly Faction[] = ['elf', 'guard', 'villain']

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Runs a scripted policy over many seeds and aggregates the reports.
 *
 * Deterministic in the same way one run is: the seed sequence is arithmetic, every run
 * derives its own streams, and nothing consults the clock. Two calls with the same options
 * produce identical reports.
 */
export function sweepRuns(options: SweepOptions): SweepReport {
  const policy = options.policy ?? 'beeline'
  const hz = options.hz ?? 20
  const firstSeed = options.firstSeed ?? 1
  const stride = options.stride ?? 7919
  const outcomes: Record<RunOutcome, number> = { victory: 0, defeat: 0, timeout: 0 }
  const deathCauses: Record<DeathCause, number> = {
    beast: 0,
    faction: 0,
    bleeding: 0,
    none: 0,
  }
  const damageTakenByAllegiance: Record<string, number> = {}
  const elapsedValues: number[] = []
  const distanceValues: number[] = []
  const regionValues: number[] = []
  const firstObjectiveTimes: number[] = []
  const firstObjectiveDistances: number[] = []
  let damageTaken = 0
  let damageDealt = 0
  let kills = 0
  let chronicleEvents = 0
  let witnessed = 0
  let offScreen = 0

  for (let index = 0; index < options.seeds; index += 1) {
    const report = runHarness({
      seed: firstSeed + index * stride,
      faction: options.faction ?? FACTION_ROTATION[index % FACTION_ROTATION.length],
      policy,
      hz,
      ...(options.timeLimit === undefined ? {} : { timeLimit: options.timeLimit }),
    })
    outcomes[report.outcome] += 1
    deathCauses[report.deathCause] += 1
    elapsedValues.push(report.elapsed)
    distanceValues.push(report.distanceWalked)
    regionValues.push(report.regionsVisited)
    const first = report.objectives[0]
    if (first?.completedAt !== null && first !== undefined) {
      firstObjectiveTimes.push(first.completedAt)
      firstObjectiveDistances.push(first.distanceWalked)
    }
    damageTaken += report.damageTaken.total
    damageDealt += report.damageDealt.total
    kills += report.kills
    chronicleEvents += report.eventExposure.chronicleEvents
    witnessed += report.eventExposure.witnessed
    offScreen += report.eventExposure.offScreen
    for (const [allegiance, amount] of Object.entries(report.damageTaken.byAllegiance)) {
      damageTakenByAllegiance[allegiance] =
        (damageTakenByAllegiance[allegiance] ?? 0) + amount
    }
  }

  return {
    seeds: options.seeds,
    policy,
    hz,
    outcomes,
    completionRate: options.seeds === 0 ? 0 : outcomes.victory / options.seeds,
    deathCauses,
    medianElapsed: median(elapsedValues),
    medianDistanceWalked: median(distanceValues),
    medianRegionsVisited: median(regionValues),
    medianFirstObjectiveTime: median(firstObjectiveTimes),
    medianFirstObjectiveDistance: median(firstObjectiveDistances),
    meanDamageTaken: options.seeds === 0 ? 0 : damageTaken / options.seeds,
    meanDamageDealt: options.seeds === 0 ? 0 : damageDealt / options.seeds,
    meanKills: options.seeds === 0 ? 0 : kills / options.seeds,
    damageTakenByAllegiance,
    totalChronicleEvents: chronicleEvents,
    totalWitnessed: witnessed,
    totalOffScreen: offScreen,
    witnessShare: chronicleEvents === 0 ? 0 : witnessed / chronicleEvents,
  }
}
