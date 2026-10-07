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
 * - `Fauna` — the real beast profiles and pack plans. The pinned arms cap the field at
 *   `MAX_ACTORS`; the W1-5 arms run the real `ActorBudget`, reservations and yields.
 *
 * **W1-5 added the systems that decide difficulty**, each behind an opt-in arm whose default
 * is the run every pinned number describes (`SquadPolicy`, `SustainPolicy`, `EventModel`,
 * `EventPolicy`, `EventDirector`, `PlayerKit`, `EncounterModel`; `HARNESS_SHIPPED_ARMS`
 * turns them all on):
 *
 * - `getStartingSquad`, `selectSquadIntent`, `getSquadFollowSpeed` — the starters in
 *   formation, fighting through the squad's own threat pass, dead for good; a rescue
 *   recruits its captive.
 * - `shouldInjurePlayer` and `injurePlayer`'s limb table, `playerLegMobility`,
 *   `chooseGeneratedInteraction`, `getShopItemPrice`, `getSupplyPriceMultiplier`,
 *   `rollLootReward` — wounds and bleeding, the starting ration, healers, the trader's
 *   medicine and prostheses, loot, treasure, and every gold source.
 * - The ten event builders, the director's weights and cooldowns, located materialization,
 *   the threat wave and the road caravan — copied as data in `runHarnessEvents.ts` and held
 *   to the shipped `GameEngine` methods by `runHarnessFidelity.test.ts`, draw for draw.
 * - `startContractEvent` and `updateContractNode` as W1-1 left them: a random event the
 *   player was merely near stands down for their contract, located fights are handed back
 *   to make room, the contract waits for a fight the player is in, the director keeps out
 *   within 120 m of an un-started contract, and only a genuine stall spends the grace.
 * - `CaravanClaim.advanceCaravanClaim` — W1-2's rule for who gets a cart once its escort is
 *   down: a 3.5 s loading channel any blow breaks, the player's 9 s claim, the squad kept
 *   off the cargo, the looter holding still and the ambush raiders walking to the cart.
 * - `createGeneratedEncounterPlans` and `FinaleDirector.advanceFinale` — the generator's
 *   own encounters and the finale boss's authored attacks.
 * - `RegionManager`, built with `GeneratedWorldRuntime`'s options, for the squares the
 *   engine simulates. That is the five-square plus around the player's square, not the 3x3
 *   it shows. This follows W1-6's finding, and the fidelity test walks a real runtime over
 *   the whole map to hold it.
 * - `world/StagingRoom.ts` — W1-6's rule for making room: when a contract the player stands
 *   on is short of it, the player's own idle packs out of the camera's sight step back into
 *   their squares and come home later (`StagingModel`). The camera is the third-person one
 *   at rest, held to the engine's `updateCamera` by the fidelity test.
 *
 * ---
 *
 * **WHAT IT IS NOT, AND WHAT THAT COSTS.** The named risk for this harness is false
 * confidence from something that models less than it appears to, so the gaps are listed
 * with what each one biases:
 *
 * 1. **No props, buildings, trees or water as colliders.** Only the world bounds and the
 *    terrain slope stop a body. Paths are therefore optimistic: a route the harness walks in
 *    a straight line may be a route the game makes you go round, an arrow flies through the
 *    hut a real one would hit, and the finale has no cover. **Bias: travel times are lower
 *    bounds; ranged damage is a ceiling.**
 * 2. **No region streaming cost.** Regions activate instantly. The 20–29 ms median grid
 *    build that roadmap 0.3 is about is *performed* here (so the code is exercised) but
 *    costs no simulated time. **Bias: says nothing about frame pacing.**
 * 3. **No player aim, and no defensive kit.** The scripted policies swing at whatever is
 *    inside reach rather than at what the player is looking at, and there is no bow, cleave,
 *    rush, shield, evasion, perfect guard or knockback. **Bias: player damage output is a
 *    floor, and blocking never happens, so incoming damage is a ceiling** — the finale most
 *    of all, whose tells a real player sidesteps.
 * 4. **Events are counted, not fought — unless `eventModel` is `fought`.** In the pinned
 *    arms a materialized event spawns no actors. Fought, the builders' bodies, clocks and
 *    rewards are the engine's, but they draw from the harness's own `harness:events` stream
 *    (the pinned encounter stand-in already reads `gameplay:event`) and skip the builders'
 *    per-frame smoke draws, so a harness run and a browser run on one seed do not meet the
 *    same events — nor would they on one stream, because the harness's route is scripted.
 * 5. **No rendering, audio, camera, hit-stop or particles.** Nothing here can tell you
 *    whether a fight feels good. The one camera there is, W1-6's staging arm's, never looks
 *    round: it trails the heading at rest, so what it counts as out of sight is what a
 *    player who keeps their eyes on the road would not see.
 * 6. **Flanking, separation and commanders' orders are still unmeasurable.** Actors steer
 *    only around terrain; nobody keeps an elbow's distance, sights a stranger for a friend,
 *    obeys or rallies to a commander, or charges like a boar. A commander here is a body
 *    with its role's swing; W1-6's `commanders` arm adds the one thing that changes the
 *    actor budget, his call for reinforcements, and the shipped arms turn it on. Without
 *    knockback or charges, only the blow itself takes a looter off a cart, and an ambush
 *    raider that reaches its post stands there rather than wandering round its spawn.
 * 7. **The squad only follows.** Hold, Focus and Regroup are never ordered; companions
 *    steer straight at their formation slot with no squad pathing, and a routed companion
 *    falls back on where it spawned, as the engine's does.
 * 8. **The sustain policy is a script, not a shopper.** It eats below half health, detours
 *    up to `HARNESS_SERVICE_DETOUR` to a healer or trader when hurt, buys medicine and
 *    prostheses and never an upgrade; loot flies to the player on the magnet's timing
 *    rather than its arc. Eyes are lost with no effect on sight.
 * 9. **Not modelled at all:** the bridge ambush, civilians, ambient prowlers, campfires, the
 *    elf's forest allies, achievements and the profile.
 * 10. **The pinned arms keep what every pinned number was measured with.**
 *    `HARNESS_PLAYER_SPEED` is 6.4 m/s where `updatePlayer` walks at 8.2; the legacy
 *    encounter stand-in senses at 22 m and hunts at 24 m where the engine's soldiers sense
 *    at 15 and hunt at 6.5; the contract stand-in spends start grace on whichever site
 *    the player stands on, as the engine did before W1-1; and they simulate the whole 3x3
 *    visible window, where the engine simulates only the plus inside it (`RegionWindow`).
 *    The `shipped` kit, the shipped encounters and the fought contracts are the engine's,
 *    and so is the window they run in.
 *
 * So: a number from this harness describes **the shape of a run** — pacing, exposure,
 * attrition — not the experience of playing one. With the W1-5 arms on it is a shape with
 * a squad, a body and a director in it; it is still a scripted player's.
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
import {
  createGeneratedEncounterPlan,
  getFactionStartHeading,
  getFactionStartPosition2D,
  getSiteWorldPosition2D,
  type GeneratedEncounterPlan,
} from '../src/game/content/registry.ts'
import {
  SHOP_ITEMS,
  actorSpeedForRole,
  areAllegiancesHostile,
  createHealthyBody,
  getShopItemPrice,
  getThreatTier,
  isBeastRole,
  isRandomWorldEventKind,
  RANDOM_WORLD_EVENT_KINDS,
  type ActorRole,
  type Allegiance,
  type BodyPart,
  type BodyState,
  type ChronicleWorldEventKind,
  type Faction,
  type Objective,
  type ShopItem,
  type ZoneId,
} from '../src/game/types.ts'
import {
  DOCTRINE_DRAFT_TIERS,
  DEFAULT_DOCTRINE_IDS,
  MAX_EQUIPPED_DOCTRINES,
  advanceDoctrineAnchors,
  createDoctrineRunState,
  equipDoctrine,
  getDoctrineOffer,
  pendingDoctrineDraftIndex,
  resolveDoctrineEffects,
  type DoctrineEffects,
  type DoctrineRunState,
} from '../src/game/run/doctrine.ts'
import { CollisionWorld } from '../src/game/systems/CollisionWorld.ts'
import { NavigationSystem } from '../src/game/systems/NavigationSystem.ts'
import { RegionManager } from '../src/game/world/RegionManager.ts'
import { TerrainSystem } from '../src/game/world/TerrainSystem.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import {
  CHRONICLE_TICK_SECONDS,
  createChronicleRegions,
  createChronicleState,
  getChronicleProtectedRegionIds,
  getContestedRegionIds,
  getSupplyPriceMultiplier,
  isRegionRazed,
  isSettlementSite,
  resolveMaterializedBeastRaid,
  resolveMaterializedCaravan,
  resolveMaterializedRaid,
  resolveMaterializedWarband,
  tickChronicle,
  type ChronicleEvent,
  type ChronicleState,
  type RegionChronicleState,
} from '../src/game/world/Chronicle.ts'
import {
  findPendingMaterializations,
  type PendingMaterialization,
} from '../src/game/world/Materialization.ts'
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
  advanceContract,
  advanceEventTimer,
  beginContract,
  campaignObjectivesComplete,
  commitChronicleTicks,
  completeObjectiveEntry,
  countRewardedObjectives,
  createCampaignContractState,
  createChronicleCommitmentState,
  createGeneratedObjectives,
  enemyDamageMultiplier,
  enemyHealthMultiplier,
  ensureContractProgress,
  eventCooldownRange,
  findContractTemplate,
  getContractProgress,
  getContractStatus,
  getPinnedRumour,
  getReadyObjectiveNodes,
  getRumourEscort,
  getRumourReservedRegionIds,
  isContractLive,
  isContractNodeCompletableByArrival,
  isWithinObjectiveArrival,
  advanceRumourProgress,
  markRumourActioned,
  objectivePrerequisitesDone,
  offerRumours,
  pinObjective,
  pinRumour,
  playerObjectiveRatio,
  resolveActiveObjectiveNode,
  resolveContract,
  rollEventCooldown,
  selectChronicleAnnouncements,
  selectWeightedEventKind,
  settleDueRumours,
  shouldHandBackForStreaming,
  skipExclusiveAlternatives,
  threatWaveInterval,
  EVENT_RETRY,
  type CampaignContractState,
  type ChronicleCommitmentState,
  type ChronicleRumour,
  type FactionContractTemplate,
  type RumourWorldContext,
} from '../src/game/world/CampaignDirector.ts'
import {
  actionCooldown,
  actionRecovery,
  actionWindup,
  actorBaseHealth,
  actorMaxPoise,
  advancePlayerMelee,
  advanceReaction,
  applyDamageReaction,
  bufferPlayerMelee,
  cancelPlayerMelee,
  createPlayerMeleeState,
  isPlayerMeleeCommitted,
  isWithinContact,
  killReward,
  nextPlayerMeleeBeat,
  PLAYER_MELEE_BEATS,
  playerArmor,
  playerBeatSpec,
  resolveActorDamage,
  resolvePlayerDamage,
  rollMeleeDamage,
  rollPropBite,
  selectMeleeTarget,
  shouldInjurePlayer,
  type CombatActor,
  type MeleeArcCandidate,
  type PlayerMeleeState,
} from '../src/game/world/CombatResolver.ts'
import {
  aiDistance,
  beastPackShare,
  evaluateMorale,
  evaluatePlayerPursuit,
  isCommanderGroupEngaged,
  isPacifistRole,
  localGroupShare,
  selectThreat,
  THREAT_PLAYER,
  type AiActor,
  type AiPoint,
  type AiPositionOf,
  type MoraleBreak,
} from '../src/game/world/ActorAi.ts'
import type { FactionObjectiveNode, Territory, WorldBlueprint } from '../src/game/world/worldTypes.ts'
import {
  BEAST_PROFILES,
  BEAST_LEASH_RANGE,
  BEAST_ROUT_SECONDS,
  BEAST_SENSE_RANGE,
  WOLF_PACK_RADIUS,
} from '../src/game/world/Fauna.ts'
import { ActorBudget, type ActorBudgetCategory } from '../src/game/world/ActorBudget.ts'
import {
  STAGING_PARK_HOLD_SECONDS,
  canReturnPack,
  choosePacksToPark,
  gatherStagingPacks,
  horizontalHalfFov,
  parkableBodies,
  stagingCapacity,
  type StagingBody,
  type StagingPack,
  type StagingViewer,
} from '../src/game/world/StagingRoom.ts'
import {
  CAMERA_BASE_FOV,
  CAMERA_DEFAULT_PITCH,
  cameraOrbitDistance,
} from '../src/game/cameraAccents.ts'
import {
  getSquadFollowSpeed,
  getStartingSquad,
  startingSquadIdentity,
} from '../src/game/squadMovement.ts'
import {
  SQUAD_ARRIVAL_DISTANCE,
  allocateSquadSlot,
  createSquadCommandState,
  findSquadWalkablePosition,
  isSquadMember,
  selectSquadIntent,
  type SquadCommandState,
} from '../src/game/world/SquadCommand.ts'
import { chooseGeneratedInteraction } from '../src/game/world/GeneratedInteraction.ts'
import { missingPlayerLegs, playerLegMobility } from '../src/game/world/CombatMastery.ts'
import {
  cancelCaravanLoot,
  createCaravanClaimState,
  interruptCaravanLoot,
  noteCaravanEscortHit,
  type CaravanClaimState,
  type CaravanLooterKind,
} from '../src/game/world/CaravanClaim.ts'
import { getStartingBoonEffects } from '../src/game/run/profile.ts'
import {
  FINALE_ARENA_RADIUS,
  FINALE_ATTACKS,
  FINALE_ENGAGE_RADIUS,
  FINALE_PROFILES,
  FINALE_PROJECTILE_RADIUS,
  advanceFinale,
  captureFinaleBody,
  createFinaleIdentity,
  createFinaleState,
  finaleEscortPost,
  interruptFinale,
  resolveFinaleContactTargets,
  suspendFinale,
  type FinaleAction,
  type FinalePoint,
} from '../src/game/world/FinaleDirector.ts'
import {
  getExpeditionGraph,
  planExpeditionRoute,
  type ExpeditionGraph,
} from '../src/game/world/ExpeditionPlanner.ts'
import {
  HARNESS_CAPTIVE_INTERACT_RANGE,
  HARNESS_CARAVAN_ALLEGIANCE,
  HARNESS_CARAVAN_DEFENSE_AID,
  HARNESS_CARAVAN_DEFENSE_AID_COOLDOWN,
  HARNESS_CARAVAN_DEFENSE_CREDIT_RANGE,
  HARNESS_CARAVAN_ESCORT_COUNT,
  HARNESS_CARAVAN_ESCORT_RANGE,
  HARNESS_CARAVAN_ESCORT_RESPAWN_DELAY,
  HARNESS_CARAVAN_PANIC_RANGE,
  HARNESS_CARAVAN_PANIC_SECONDS,
  HARNESS_CARAVAN_PANIC_SPEED_MULTIPLIER,
  HARNESS_CARAVAN_PLUNDER_COOLDOWN,
  HARNESS_CARAVAN_RADIUS,
  HARNESS_CARAVAN_ROBBERY_COOLDOWN,
  HARNESS_CARAVAN_ROBBERY_GOLD,
  HARNESS_CARAVAN_SPEED,
  HARNESS_CART_INTERACT_RANGE,
  HARNESS_CHAMPION_DAMAGE_CAP,
  HARNESS_CHAMPION_DAMAGE_STEP,
  HARNESS_CONTRACT_TRIGGER_RADIUS,
  HARNESS_DEFEND_HOME_HEAL,
  HARNESS_EVENT_REQUIRED_SLOTS,
  HARNESS_EVENT_WEIGHTS,
  HARNESS_FIRST_EVENT_AT,
  HARNESS_LOCATED_EVENT_REWARDS,
  HARNESS_LOOT_BURST_TIME,
  HARNESS_LOOT_FORCE_MAGNET_AGE,
  HARNESS_LOOT_MAGNET_RADIUS,
  HARNESS_LOOT_MAGNET_SPEED,
  HARNESS_LOOT_DAMAGE_CAP,
  HARNESS_MAX_LOCATED_EVENTS,
  HARNESS_ORDER_DURATION,
  HARNESS_ORDER_TOLERANCE,
  HARNESS_RANDOM_EVENT_REWARDS,
  HARNESS_RICH_CARAVAN_SPEED,
  HARNESS_THREAT_WAVE_EVENT_RADIUS,
  HARNESS_THREAT_WAVE_FIRST_AT,
  advanceAmbushLoot,
  advanceRoadCartLoot,
  clampToBounds,
  contractHoldsRandomEvents,
  contractSituation,
  contractStartGate,
  createAmbushLoot,
  evaluateEventFrame,
  evaluateEventKill,
  eventKillParts,
  pickDefendHomePosition,
  planCaravanPatrol,
  planLocatedEvent,
  planRandomEvent,
  planThreatWave,
  playerEngagedWith,
  raiderApproachPoint,
  roadCartGuarded,
  rollKillLoot,
  rollLoot,
  rollTreasure,
  type AmbushLoot,
  type CaravanPatrol,
  type ContractStartOutcome,
  type EventPlan,
  type EventProp,
  type EventWorld,
  type HarnessLootReward,
  type PlanPoint,
} from './runHarnessEvents.ts'

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
/**
 * The pinned arms' walk speed. **Not the engine's:** `updatePlayer` walks at 8.2 m/s, and
 * this always said otherwise. It stays 6.4 because every pinned number was walked at it;
 * `HARNESS_SHIPPED_PLAYER_SPEED` is the shipped kit's.
 */
export const HARNESS_PLAYER_SPEED = 6.4
/** Seconds between the player's swings. Matches the engine's melee cooldown. */
export const HARNESS_PLAYER_ATTACK_COOLDOWN = 0.42
/** The player's reach. */
export const HARNESS_PLAYER_REACH = 2.6
/** How far the player can see an event resolve. Governs the exposure metric. */
export const HARNESS_WITNESS_RADIUS = 60
/**
 * How far the 3x3 window reaches, in regions. The engine's *visible* set has this radius.
 * In the pinned arms it is also the *simulated* set, which is not the engine's: see
 * `RegionWindow`.
 */
export const HARNESS_STREAM_RADIUS = 1
/** Encounter actors spawn when the player comes this close. */
export const HARNESS_ENCOUNTER_TRIGGER = 34
/** A run is abandoned after this many simulated seconds. */
export const HARNESS_TIME_LIMIT = 900
/** Matches the engine's `MATERIALIZE_INTERVAL`: at most one situation per six seconds. */
export const HARNESS_MATERIALIZE_INTERVAL = 6
/** How often the harness looks for encounters to trigger. */
export const HARNESS_ENCOUNTER_SCAN_INTERVAL = 1

// --- roadmap 1.1: the aimed-melee arm --------------------------------------

/**
 * How fast the scripted player turns, in radians per second.
 *
 * This is the whole reason the honest arm can whiff at all, and it is the harness's most
 * consequential invention: the shipped game aims with a mouse and there is no mouse here,
 * so a policy that snapped its aim to the target every frame would report a whiff rate of
 * zero and prove nothing. 6.5 rad/s is ~372°/s — brisk, not instant, and slower than a
 * scout can circle at close range, which is where the misses come from.
 */
export const HARNESS_AIM_TURN_RATE = 6.5
/** How close a hostile has to be before the duelist stops walking and fights. */
export const HARNESS_DUEL_RANGE = 13
/** How long before contact the duelist notices a telegraph and answers it. */
export const HARNESS_REACTION_WINDOW = 0.32
/** Wind-up at or above this reads as a heavy: commander 0.38, champion 0.48, brute 0.56. */
export const HARNESS_HEAVY_WINDUP = 0.32
/** Player stamina regeneration while not sprinting. Matches the engine's `+16/s`. */
export const HARNESS_STAMINA_REGEN = 16
/** Stamina a retreat-sprint burns per second. Matches the engine's `24/s`. */
export const HARNESS_SPRINT_DRAIN = 24
/** How much faster the retreat is than a walk. Matches the engine's sprint multiplier. */
export const HARNESS_SPRINT_MULTIPLIER = 1.65

// --- W1-5: the shipped arms -------------------------------------------------

/**
 * The engine's walk speed, `updatePlayer`'s `8.2 * mobility`.
 *
 * **`HARNESS_PLAYER_SPEED` above is 6.4 and always was**, though its comment says it
 * matches the engine; `updatePlayer` has used 8.2 since before this file existed. It stays
 * 6.4 because every pinned number in this suite was walked at that speed, and the shipped
 * player kit below is the arm that walks at the real one.
 */
export const HARNESS_SHIPPED_PLAYER_SPEED = 8.2
/** `updatePlayer`'s forest bonus: an elf in its own woods moves 14 % faster. */
export const HARNESS_ELF_FOREST_MOBILITY = 1.14
/** The engine's starting damage per faction, before the whetstone boon. */
export const HARNESS_FACTION_DAMAGE: Record<Faction, number> = { elf: 26, guard: 28, villain: 31 }
/** The starting purse, `55 + startingGoldBonus`. */
export const HARNESS_STARTING_GOLD = 55
/**
 * The boon a fresh profile starts with selected — `DEFAULT_STARTING_BOON_IDS[0]`, the one
 * ration in the bag the item brief calls "the starting boon ration".
 */
export const HARNESS_STARTING_BOON = 'provisions'
/** `handleGeneratedInteraction`: what a ration, a healer and the trader's kit restore. */
export const HARNESS_RATION_HEAL = 35
export const HARNESS_RATION_BLEED_RELIEF = 0.35
export const HARNESS_HEALER_HEAL = 40
export const HARNESS_MEDICINE_HEAL = 55
/** `findNearbySite(…, 6)`: how close the player stands to use a site at all. */
export const HARNESS_SITE_REACH = 6
/** The scripted sustain policy: eat below half health, or when a lost limb is bleeding. */
export const HARNESS_RATION_HEALTH = 0.5
export const HARNESS_RATION_BLEED = 0.3
/** Detour to a healer or a trader below this share of health, or while bleeding. */
export const HARNESS_HEAL_HEALTH = 0.65
/** How far the scripted player leaves the road for a healer, a trader or a treasure. */
export const HARNESS_SERVICE_DETOUR = 90
/** A service visited is not visited again for this long — the `visit` placebo's brake. */
export const HARNESS_SERVICE_COOLDOWN = 60
/** Seconds between two presses of `E`. A key, not a frame. */
export const HARNESS_INTERACT_INTERVAL = 0.25
/** How far the `engage` event policy leaves the road for a fight that is not its own. */
export const HARNESS_EVENT_DETOUR = 110
/** `MORALE_CHECK_INTERVAL`, `MORALE_RALLY_SECONDS`, `MORALE_RALLY_POINT_TOLERANCE`. */
export const HARNESS_MORALE_CHECK_INTERVAL = 0.35
export const HARNESS_RALLY_SECONDS = 12
export const HARNESS_RALLY_TOLERANCE = 3
export const HARNESS_LAST_STAND_SECONDS = 2
/** `AGGRO_MEMORY_DURATION`, `RAGE_*`, `ALERT_*`, `NPC_RETALIATION_DURATION`. */
export const HARNESS_AGGRO_MEMORY = 6
export const HARNESS_RAGE_SECONDS = 5
export const HARNESS_RAGE_SPEED = 1.35
export const HARNESS_RAGE_DAMAGE = 3
export const HARNESS_RAGE_COOLDOWN = 0.7
export const HARNESS_RAGE_RANGE = 6
export const HARNESS_ALERT_RADIUS = 14
export const HARNESS_ALERT_COOLDOWN = 1.5
export const HARNESS_RETALIATION_SECONDS = 4
/** `SCOUT_RETREAT_DURATION`: a scout steps back after every swing. */
export const HARNESS_SCOUT_RETREAT = 0.62
/** Archers keep this band (`ARCHER_MIN_RANGE`, `ARCHER_MAX_RANGE`). */
export const HARNESS_ARCHER_MIN_RANGE = 8
export const HARNESS_ARCHER_MAX_RANGE = 12
/** `ACTOR_ARROW_DAMAGE`, `ACTOR_ARROW_SPEED`, the arrow's 1.25 s of flight, its hit radius. */
export const HARNESS_ARROW_DAMAGE = 7
export const HARNESS_ARROW_SPEED = 16
export const HARNESS_ARROW_LIFE = 1.25
export const HARNESS_ARROW_HIT_RADIUS = 0.9
export const HARNESS_ARROW_BRUTE_RADIUS = 1.1
/** `LARGE_ACTOR_COLLIDER_RADIUS`: brutes and champions take a wider body. */
export const HARNESS_LARGE_ACTOR_RADIUS = 0.72
/** `updateEvents`' retry when the director could afford nothing. */
export const HARNESS_EVENT_RETRY = EVENT_RETRY

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InputPolicy = 'beeline' | 'cautious' | 'idle' | 'duelist'

/**
 * Which melee model the scripted player runs.
 *
 * `legacy` is the pre-1.1 swing this file has always driven: a cooldown and a
 * nearest-hostile-in-reach hit that cannot miss and cannot be aimed. `honest` is roadmap
 * 1.1 — `CombatResolver`'s buffered three-beat sequence, the camera-facing arc, the
 * in-arc-only assist and the committing finisher.
 *
 * **The default stays `legacy` on purpose.** Every pinned number in
 * `runHarnessTest`/`runHarnessSchedules`/`runHarnessSweep` describes one fixed simulation,
 * and silently re-pointing them at a different combat model would destroy the baseline the
 * 1.1 arms are compared against. The roadmap asks for melee to be exercised by *a policy*,
 * and that is what this is.
 */
export type MeleeModel = 'legacy' | 'honest'

/**
 * How much of a telegraph the scripted player answers.
 *
 * Three arms because the two signals ask different questions. `none` is the control: the
 * player swings through every wind-up, so "the cancel raised the avoided share" is a
 * comparison rather than a claim. `heavy` is the realistic arm — trade with a scout's
 * 0.18 s jab, get out of a brute's 0.56 s swing — and it is where the whiff rate and the
 * avoided share come from. `all` answers *every* wind-up, which is the only way to
 * exercise the whole 0.18–0.56 s band the roadmap's third signal names.
 */
export type MeleeDefence = 'none' | 'heavy' | 'all'

/**
 * Roadmap 1.3 — how the scripted player treats the chronicle's rumours.
 *
 * Four arms, and the fourth is the one that makes the measurement mean anything:
 *
 * - `off` is **the default and stays the default**, for the same reason `legacy` is the
 *   default melee model: every pinned number in `runHarnessTest`, `runHarnessSchedules` and
 *   `runHarnessSweep` describes one fixed simulation, and an ignored rumour resolving
 *   against the player is a real world change, so switching it on by default would rewrite
 *   those baselines rather than add an arm beside them.
 * - `ignore` is **the no-input baseline the roadmap's signal is measured against**: rumours
 *   are offered and resolve on their clocks, and the player never pins one or walks to one.
 * - `walk` is the **placebo**. The player detours to exactly the same squares the committed
 *   arm detours to, and pins nothing. Presence alone already freezes a region and moves
 *   encounters, so without this arm "committing changed region control" would be indist-
 *   inguishable from "walking somewhere else changed region control".
 * - `commit` is the treatment: pin one, honour it, burn the depot if that is what it asks.
 */
export type RumourPolicy = 'off' | 'ignore' | 'walk' | 'commit'

/**
 * Roadmap 1.4 — how the scripted player picks which arm of the fork to do first.
 *
 * Four arms, and the first one is the baseline the others are measured against:
 *
 * - `firstReady` is **the default and stays the default**. It pins nothing, so the active
 *   objective is whatever `getActiveObjectiveNode` returns — the *first* ready node, which
 *   is exactly what the campaign did before 1.4. Every pinned number in
 *   `runHarness.test.ts` describes this arm. On a 2.1 graph it always takes the faction's
 *   signature arm, because that is the one listed first.
 * - `nearest` pins the ready node the player is actually closest to. A real choice, made
 *   by the geometry of the seed rather than by a coin.
 * - `seeded` pins a draw from its own derived stream, which is the arm that separates
 *   "the fork produced different orders" from "the map produced different orders".
 * - `contrary` is **roadmap 2.1's**, and it exists to make the exclusive choice
 *   measurable rather than merely present. It always pins the *last* ready node, which on a
 *   shipped graph is the fork's alternative arm — so `firstReady` and `contrary` walk the
 *   same world with the same faction down the two different roads, and the difference
 *   between them is the choice with everything else held still. Without it, "the road
 *   moved" would be measured across seeds, where the seed moved too.
 */
export type ContractPolicy = 'firstReady' | 'nearest' | 'seeded' | 'contrary'

/**
 * The anti-placebo controls, and the reason each exists.
 *
 * `branched` is the shipped graph: a required errand plus two **exclusive** contract arms.
 *
 * `chain` is 1.4's placebo. It **linearises** the graph — the second middle node is given
 * the first as a prerequisite — so exactly one node is ever ready and no policy can express
 * a preference. If ordering divergence still showed up there, it would be coming from
 * something other than the fork.
 *
 * `allRequired` is **2.1's placebo, and it is the one that matters now.** It takes the
 * shipped graph and strips `optional` and `exclusiveGroup` from every node, which is
 * exactly 1.4's shape: the same sites, the same contracts, the same two ready nodes, the
 * same policies — and every arm required, so the run walks both. If route divergence still
 * showed up there, it would be produced by something other than an exclusive choice, and
 * the number 2.1 reports would be measuring the harness rather than the feature.
 */
export type CampaignShape = 'branched' | 'chain' | 'allRequired'

/**
 * Roadmap 1.4 — what the scripted player does with a contract it has already started.
 *
 * `honour` is the default: hold the site clear and the contract is kept. `shirk` is the
 * **fail-forward arm**, and it is the only way a headless run can exercise the guarantee
 * end to end — the player starts the contract, walks off to the other arm of the fork, and
 * the clock runs out behind them. What that arm has to show is not that the contract was
 * lost, which is trivial, but that **the run still finishes**: the node it leaves behind is
 * an arrival, and an arrival at a site the reserved set will not let anything burn down.
 */
export type ContractOutcomePolicy = 'honour' | 'shirk'

/**
 * Roadmap 1.6 — what the scripted player does with the doctrine draft.
 *
 * Four arms, and the first and the last are the two that make the middle two mean anything:
 *
 * - `off` is **the default and stays the default**, for the same reason `legacy`,
 *   `off` and `firstReady` are: every pinned number in `runHarness.test.ts`,
 *   `runHarnessSchedules.test.ts` and `runHarnessSweep.test.ts` describes one fixed
 *   simulation, and a drafted rule is a real change to it. No draft opens at all.
 * - `none` is **the placebo**: the anchors are crossed and the offer is computed on every
 *   one of them, but nothing is ever taken. Without it, "the doctrines changed the run"
 *   would be indistinguishable from "reaching tier 2, 3 and 4 changed the run".
 * - `seeded` is the treatment: a card drawn from the harness's own derived stream, which
 *   is what separates "the draft produced different builds" from "the map did".
 * - `first` is **the convergence control**, and it is the one the roadmap's second signal
 *   needs. It always takes the first card on the table, so every run with the same pool
 *   converges on the same equipped set. If a test cannot tell `first` from `seeded`, the
 *   distinct-set count is measuring the offer's existence rather than the player's choice,
 *   and the design has failed even though the number looks fine.
 */
export type DoctrinePolicy = 'off' | 'none' | 'seeded' | 'first'

/**
 * W1-5 — the faction's own companions.
 *
 * - `off` is **the default and stays the default**: every pinned number in this suite was
 *   measured by a player walking alone, and three bodies beside them is a different fight.
 * - `starting` is the treatment: `getStartingSquad`'s three, spawned where
 *   `spawnGeneratedStartingSquad` would put them, following in formation through the real
 *   `selectSquadIntent` and `getSquadFollowSpeed`, fighting through `selectThreat` and the
 *   `CombatResolver` tables, and dead for good when they die. A rescued captive joins them,
 *   as `rescueCaptive` makes it.
 * - `decoy` is **the placebo**: the same three bodies in the same formation, which enemies
 *   can see, chase and kill, and which never swing back. It is what separates "the squad
 *   won the fight" from "the squad stood where the blows were going to land".
 */
export type SquadPolicy = 'off' | 'starting' | 'decoy'

/**
 * W1-5 — the body and the purse: wounds, bleeding, rations, healers, the trader's
 * medicine, loot and gold.
 *
 * - `off` is **the default**: no wound, no ration, no gold — the pinned baseline.
 * - `shipped` is the treatment. Hits roll `shouldInjurePlayer` on the combat stream and
 *   `injurePlayer`'s limb table; a lost limb bleeds and a lost leg slows. The starting boon
 *   ration is in the bag, and the scripted player eats it, detours to healers and traders
 *   and claims treasure by the thresholds named `HARNESS_RATION_*`, `HARNESS_HEAL_*` and
 *   `HARNESS_SERVICE_*`. Gold comes from kills, loot, treasure, events, contracts and
 *   caravans at the engine's rates and is spent at the trader at the square's price.
 * - `visit` is **the placebo**: the same wounds, the same triggers, the same detours and
 *   the same purchases — and no healing from any of them. Without it "healing kept the run
 *   alive" would be indistinguishable from "walking to the healer changed the route".
 */
export type SustainPolicy = 'off' | 'shipped' | 'visit'

/**
 * W1-5 — whether the director's fights are fought.
 *
 * `counted` is **the default and the pre-W1-5 model**: materializations are counted for
 * the exposure metric, no random event runs, and a contract is honoured by holding its
 * site. `fought` puts the engine's builders on the ground: the player-anchored director
 * (`EVENT_WEIGHTS`, the 30 s first event and the tier cooldowns), every contract through
 * its own builder under `startContractEvent`'s rule, located situations materialized one
 * per six seconds when the player is near enough, threat waves from tier 2, and the road
 * caravan with its escort.
 */
export type EventModel = 'counted' | 'fought'

/**
 * W1-5 — what the scripted player does about a fight that is not its contract.
 *
 * `ignore` (the default) walks past a random or located event and fights only what comes
 * to it; `engage` detours up to `HARNESS_EVENT_DETOUR` to win it, and to rob — or, as the
 * guard, to defend — the road caravan. A contract is always fought when `honour` says so.
 */
export type EventPolicy = 'ignore' | 'engage'

/**
 * W1-5 — the player-anchored director, or the control without it.
 *
 * `silent` keeps every other fight and holds the random-event director still. It exists for
 * one comparison: a contract abandoned because "a random event running at arrival" blocked
 * its start has to stop being abandoned when there is no random event, or the harness is
 * reproducing something other than the bug it claims to reproduce.
 */
export type EventDirector = 'shipped' | 'silent'

/**
 * W1-5 — whose numbers the player walks and swings with.
 *
 * `harness` (the default) is this file's original kit: 6.4 m/s, 28 damage for every
 * faction, the continuous damage roll, spawned on the start site. `shipped` is
 * `updatePlayer`'s and `resolveMeleeContact`'s: 8.2 m/s, ×1.14 for an elf in the forest,
 * leg mobility, 26/28/31 damage by faction, `max(8, damage − arm penalty + ⌊roll·7⌋)`, and
 * the spawn twenty metres back along the critical path where `getStartPosition` puts it.
 */
export type PlayerKit = 'harness' | 'shipped'

/**
 * W1-5 — who is standing on the road.
 *
 * `harness` (the default) is this file's original stand-in: two to four random roles that
 * appear when the player comes within 34 m of a slot. `shipped` is
 * `createGeneratedEncounterPlans`: the generator's own plans, spawned when their square
 * streams in, at the plan's positions, health scaled by difficulty and tier, refreshed when
 * the chronicle hands a square to someone else — and the finale boss, which spawns when the
 * last node opens and has to die for the run to end.
 */
export type EncounterModel = 'harness' | 'shipped'

/**
 * Which squares a run simulates (a follow-up to W1-5, found by W1-6).
 *
 * `GeneratedWorldRuntime` builds its `RegionManager` with `visibleRadius: 1` and
 * `simulationRadius: 1`, and the two sets have different shapes. The visible set is the
 * 3x3 Chebyshev block around the player's square. The simulated set is only the
 * five-square plus inside it, Manhattan distance 1. The engine spawns encounters,
 * materializes situations, freezes the chronicle and routes navigation in the simulated
 * plus alone: `syncGeneratedRegions`, `updateMaterialization`, `tickChronicle`'s
 * `frozenRegionIds` and `GeneratedWorldRuntime.update`.
 *
 * `square` (the pinned arms) is this file's original window, which simulates the whole
 * 3x3. Every pinned number was measured in it, so it stays. It is wrong in the same way
 * the 6.4 m/s walk is: four corner squares of encounters, located fights and frozen
 * chronicle that the engine does not have. `engine` reads both sets off a real
 * `RegionManager` built with the runtime's options, and it is the default whenever the
 * shipped encounters or the fought events are on.
 */
export type RegionWindow = 'engine' | 'square'

/** `GeneratedWorldRuntime`'s `RegionManager` options. The fidelity test holds them to it. */
export const HARNESS_ENGINE_REGION_STREAMING = {
  visibleRadius: 1,
  simulationRadius: 1,
  discoverVisibleRegions: false,
} as const

/**
 * W1-6 — what a `commander` does besides swing.
 *
 * `inert` (the default) is this file's commander until W1-6: a body with its role's swing,
 * which every pinned number was measured with. `legacy` is `updateCommander` before W1-6:
 * every commander called a reinforcement every 25 s from the moment he was fielded, four in
 * all, each borrowing whatever room the budget would lend. `shipped` is the engine's rule
 * now: a commander who is not hostile to the player calls only while his own people are
 * fighting (`isCommanderGroupEngaged`), and every call reserves out of its category's own
 * share (`ActorBudget.reserveOwn`), never borrowing and never evicting.
 *
 * Only the guard meets a commander outside its finale. The boss slots of the elf's and the
 * villain's finales are the guard's own strongholds, so for the guard they field friendly
 * garrisons, each led by one. The finale's own commander takes the finale's director and
 * never calls.
 */
export type CommanderModel = 'inert' | 'legacy' | 'shipped'

/** `COMMANDER_REINFORCEMENT_INTERVAL`: seconds between calls. The fidelity test holds it. */
export const HARNESS_COMMANDER_INTERVAL = 25
/** `COMMANDER_REINFORCEMENT_LIMIT`: calls per commander each time he is fielded. */
export const HARNESS_COMMANDER_LIMIT = 4
/** `COMMANDER_ORDER_RANGE`: whose fight counts as his men's fight. */
export const HARNESS_COMMANDER_ORDER_RANGE = 18

/** One commander's reinforcement clock, made with his body, as `spawnActor` arms it. */
export interface CommanderClock {
  timer: number
  called: number
}

export function createCommanderClock(): CommanderClock {
  return { timer: HARNESS_COMMANDER_INTERVAL, called: 0 }
}

/** W1-6 — `commanderGathersMen` under each model: whether his clock runs this frame. */
export function commanderGathers<T extends AiActor & { hostileToPlayer: boolean }>(
  model: CommanderModel,
  commander: T,
  actors: readonly T[],
  positionOf: AiPositionOf<T>,
  attacking: (actor: T) => boolean,
): boolean {
  if (model === 'inert') return false
  if (model === 'legacy' || commander.hostileToPlayer) return true
  return isCommanderGroupEngaged(
    commander,
    actors,
    HARNESS_COMMANDER_ORDER_RANGE,
    positionOf,
    attacking,
  )
}

/**
 * W1-6 — one frame of `updateCommander`'s call for men. `gathers` is whether his clock runs
 * this frame, and `admit` reserves the slot; it is asked only when a call is due and the
 * limit is not reached. True when a reinforcement takes the field.
 */
export function advanceCommanderClock(
  clock: CommanderClock,
  delta: number,
  gathers: boolean,
  admit: () => boolean,
): boolean {
  if (!gathers) return false
  clock.timer -= delta
  if (clock.timer > 0) return false
  clock.timer += HARNESS_COMMANDER_INTERVAL
  if (clock.called >= HARNESS_COMMANDER_LIMIT || !admit()) return false
  clock.called += 1
  return true
}

/**
 * W1-6 — whether the player's own packs step back to make room for a staging the player
 * has reached.
 *
 * `none` (the default) is the rule every pinned number was measured with. `friendly` is the
 * engine's `makeRoomForStaging` (`world/StagingRoom.ts`): when the contract the player stands
 * on is short of room once the game's own events made way, the generator's ordinary packs
 * that are not hostile to the player, idle, unwounded, at least
 * `STAGING_PARK_MIN_DISTANCE` away and out of the camera's sight step back into their
 * squares, farthest first, as many as it is short. They come back when no staging has asked
 * for `STAGING_PARK_HOLD_SECONDS`, the whole pack fits and none of its stations is near the
 * player or in sight. Enemies never step back.
 */
export type StagingModel = 'none' | 'friendly'

/** W1-6 — the screen the staging arm's camera is measured on: a desktop's 16:9. */
export const HARNESS_SCREEN_ASPECT = 16 / 9

/**
 * W1-6 — what the scripted player can see: the third-person camera at its resting pitch,
 * `cameraOrbitDistance` behind the heading, with `CAMERA_BASE_FOV` on a 16:9 screen.
 */
export function harnessStagingViewer(player: { x: number; z: number; heading: number }): StagingViewer {
  const forward = { x: Math.sin(player.heading), z: -Math.cos(player.heading) }
  const behind = cameraOrbitDistance(HARNESS_SCREEN_ASPECT) * Math.cos(CAMERA_DEFAULT_PITCH)
  return {
    player: { x: player.x, z: player.z },
    camera: { x: player.x - forward.x * behind, z: player.z - forward.z * behind },
    forward,
    halfFov: horizontalHalfFov(CAMERA_BASE_FOV, HARNESS_SCREEN_ASPECT),
  }
}

/** How close the scripted player has to be for a contract to be counted as under way. */
export const HARNESS_CONTRACT_RANGE = 6
/**
 * Simulated seconds of standing on a contract's site, with nothing hostile within reach,
 * that the harness treats as honouring it.
 *
 * A stand-in, and a stated one: this file spawns no event actors at all (see the gaps list
 * at the top), so a contract cannot be *fought* here. What it can be is *attempted* — the
 * real `CampaignDirector` state machine runs, the real clock counts down and the real
 * fail-forward path fires when it runs out, which is the half of the contract 1.4 has to be
 * able to measure over 200 runs.
 */
export const HARNESS_CONTRACT_HOLD = 4

/** How close the scripted player has to get to a depot before it torches it. */
export const HARNESS_SABOTAGE_RANGE = 6
/**
 * How far the scripted player will go out of its way for a rumour, in metres.
 *
 * Without a cap the arm degenerates: a policy that abandons the campaign for every rumour
 * on the board measures a player who never finishes a run, and "region control at victory"
 * stops having victories in it. ~260 m is roughly two squares, which is a detour rather
 * than a change of career. Both `commit` and `walk` use it, so the placebo stays matched.
 */
export const HARNESS_RUMOUR_DETOUR = 110

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

/**
 * Roadmap 1.1's four signals, plus the number open disagreement (a) asked for.
 *
 * Every field is a count or a ratio of counts, so a claim about melee can be checked
 * rather than asserted. The two that matter most are `whiffRate` — above zero proves the
 * swing can miss at all — and `avoidableHitRate`, which is the share of *telegraphed
 * heavies* the player got out of the way of.
 */
export interface MeleeMetrics {
  /** Contact frames resolved, whiffs included. Zero in the `legacy` arm. */
  beatsResolved: number
  beatsWhiffed: number
  /** `beatsWhiffed / beatsResolved`, or 0 when nothing swung. */
  whiffRate: number
  /** Contact frames resolved per beat index, so a chain that never reaches three shows. */
  beatsByIndex: number[]
  finishersLanded: number
  /** Stances the finisher broke. The third beat's reason to exist. */
  poiseBreaks: number
  staminaSpent: number
  /** Sequences abandoned by sprint, jump or the faction ability. */
  cancels: number
  /** Melee wind-ups a heavy role started against the player. */
  telegraphedHeavies: number
  /** How many of those failed to connect. */
  telegraphedHeaviesAvoided: number
  /** `telegraphedHeaviesAvoided / telegraphedHeavies`, or 0 when none were thrown. */
  avoidableHitRate: number
  /** Wind-ups the player tried to walk out of, by role. */
  windupClearAttempts: Record<string, number>
  /** How many of those it cleared before contact, by role. */
  windupClears: Record<string, number>
  /** Hits taken while the finisher had the player rooted. The price of committing. */
  hitsWhileCommitted: number
  /** Simulated seconds spent committed to a finisher. */
  committedSeconds: number
  /** Median seconds from an actor's first wound to its death, keyed by role. */
  timeToKillByRole: Record<string, number>
  /** How many deaths each median is made of, so a one-sample median is visible. */
  killsByRole: Record<string, number>
}

/**
 * Roadmap 1.3 — what the commitment loop did, per run.
 *
 * `brokenWhileCommitted` is the honest one: a rumour the player pinned and then failed is
 * not the same event as one they never touched, and a feature that could only ever be
 * kept would not be a stake.
 */
export interface RumourMetrics {
  offered: number
  offeredByKind: Record<string, number>
  pinned: number
  resolved: number
  kept: number
  broken: number
  brokenWhileCommitted: number
  /** Chronicle events the settlements themselves wrote. */
  events: number
  /** Simulated seconds the player spent inside a pinned rumour's square. */
  embodiedSeconds: number
}

/**
 * Roadmap 1.4 — what the fork did, per run.
 *
 * Four of these carry the initiative's signals, and one of them is a negative:
 *
 * - `middleOrder` is the completion order of the two required middle nodes. **Ordering
 *   divergence** is computed across runs from this, and it is an order rather than a route
 *   because both nodes are required — nothing here can be read as an exclusive choice.
 * - `contractId` says which signature contract this faction actually got, which is the
 *   second signal.
 * - `chose` is true when the run pinned a node that was not the one the pre-1.4 `.find()`
 *   would have returned. **Choice rate** is the share of runs where that happened, and the
 *   `firstReady` arm has to report zero or the arm is not the baseline it claims to be.
 * - `failedForward` counts contracts that fell through and left a completable node behind.
 *   A run with `failedForward > 0` that still reports `victory` is the safety guarantee
 *   observed rather than asserted.
 */
export interface ContractMetrics {
  contractId: string | null
  contractNodeId: string | null
  contractSiteId: string | null
  /** Roadmap 2.1 — every contract the run's graph carried, in graph order. */
  contractIds: string[]
  /** Completion order of the fork's arms, by node id. Empty until one completes. */
  middleOrder: string[]
  /** Node ids the run pinned, in order. */
  pins: string[]
  /** True when at least one pin differed from the first-ready node. */
  chose: boolean
  /** Ready nodes seen at once, at the widest. Two is the fork; one is a chain. */
  maxReady: number
  started: number
  kept: number
  failedForward: number
  /** True when the contract node was completed at all, however it got there. */
  completed: boolean
  /**
   * Roadmap 2.1 — the nodes this run closed **by choosing past them**.
   *
   * The exclusive half of the initiative, as a number: a run with a non-empty `skipped` is
   * a run that was won without completing every node, which is the thing 1.4's win
   * condition made impossible.
   */
  skipped: string[]
  /**
   * Contracts that were live on the ground when their node was skipped.
   *
   * Not a failure — the player did not lose them, they chose past them — but they have to
   * be counted somewhere, or a whole-run safety sweep would read them as contracts that
   * neither resolved nor failed.
   */
  skippedLive: number
  /**
   * The **route**: the contract *node* ids the run walked, in completion order.
   *
   * Node ids rather than contract ids on purpose. Which contract a seed drew for its second
   * arm is a generator decision and varies across seeds by itself; which *arm* the run took
   * is the player's, and it is the only thing an exclusive fork changes. Comparing node ids
   * isolates the second from the first, which is what makes the all-required placebo a
   * matched control rather than a differently-seeded one.
   */
  route: string[]
  /** What `RunHistorySummary.objectivesCompleted` would be for this run, re-decided. */
  rewardedObjectives: number
  /**
   * **The campaign-safety property, observed on a whole run.**
   *
   * True when the run stopped with the campaign unfinished and **nothing ready** — no node
   * the player could have walked to, whatever they did next. That is what "may never
   * strand a run" means as something a sweep can count, and it is strictly stronger than
   * "no timeouts": a run that ran out of the harness's clock one node from the finale ran
   * out of *time*, not out of *road*, and counting the two together would report the clock
   * as a safety defect.
   */
  strandedAtEnd: boolean
}

/**
 * Roadmap 1.6 — what the draft did, per run.
 *
 * `capBreaches` is the negative one and it should never move: `equipDoctrine` refuses the
 * fourth card, so a run that reports anything but zero has found a way past the mechanic's
 * own cap rather than past a disabled button.
 */
export interface DoctrineMetrics {
  /** The ids this run could draft from. */
  pool: string[]
  /** Every offer the run was shown, in draft order. */
  offers: string[][]
  /** What it took, in draft order. */
  equipped: string[]
  /** Attempts to equip a fourth card that the mechanic refused. Zero, or the cap leaks. */
  capBreaches: number
  /** Draft points the threat tier crossed. */
  draftsOpened: number
}

/** W1-5 — the squad, from first frame to last. */
export interface CompanionMetrics {
  /** Starting companions that took the field. */
  started: number
  /** Captives a rescue handed over. */
  recruited: number
  /** Companions that died. Death is permanent. */
  lost: number
  /** Killers of companions, by role. */
  lostTo: Record<string, number>
  /**
   * Companions standing on the first frame the final node was ready — the moment the run
   * turns towards its finale. Null when it never opened.
   */
  aliveAtFinale: number | null
  aliveAtEnd: number
  /** Blows and kills the squad landed. */
  damageDealt: number
  kills: number
  damageTaken: number
}

/** W1-5 — wounds, healing and gold. Zero everywhere while `sustain` is off. */
export interface SustainMetrics {
  goldEarned: number
  goldBySource: Record<string, number>
  goldSpent: number
  goldSpentOn: Record<string, number>
  goldAtEnd: number
  healed: number
  healedBySource: Record<string, number>
  rationsEaten: number
  rationsLeft: number
  healerVisits: number
  traderVisits: number
  treasureClaimed: number
  lootDrops: number
  injuries: number
  limbsLost: number
  prostheses: number
  /** Health the healing would have restored, counted in the `visit` placebo too. */
  healingWithheld: number
}

/** W1-5 — the director's fights. */
export interface EventMetrics {
  randomStarted: Record<string, number>
  randomSucceeded: number
  randomFailed: number
  locatedMaterialized: Record<string, number>
  locatedSucceeded: number
  locatedFailed: number
  locatedHandedBack: number
  /** Events won without the player striking an owned actor or interacting with it. */
  wonWithoutPlayer: number
  /** W1-1 — random events stood down because the player reached their contract. */
  randomStoodDown: number
  threatWaves: number
  threatWaveActors: number
}

/** W1-5 — every cart the run met, and who ended up with it. */
export interface CaravanMetrics {
  /** Carts the player robbed: the road cart, rich caravans, ambushed caravans. */
  robbed: number
  robbedBy: Record<string, number>
  /** Carts that reached safety because of the player. */
  escorted: number
  escortedBy: Record<string, number>
  /** Carts that were somebody else's by the time it ended. */
  lost: number
  lostBy: Record<string, number>
  /**
   * The robbery the player did not get: the road cart plundered by an NPC — the run's own
   * companions included — or an ambushed caravan taken by its raiders.
   */
  robberiesLostToNpcs: number
  /** The subset of those taken by the player's own squad. W1-2 keeps it at zero. */
  robbedBySquad: number
  /** W1-2 — the player won an escort fight and kept the cart for `CARAVAN_CLAIM_SECONDS`. */
  claimsOpened: number
  /** W1-2 — somebody started loading a cart. */
  lootsStarted: number
  /** W1-2 — the player's blow knocked a looter off a cart. */
  lootsBrokenByPlayer: number
}

/** W1-5 — the contract half of the fork, as the engine runs it. */
export interface ContractBalanceMetrics {
  started: number
  kept: number
  /** The event went down and lost, or the contract's clock ran out. */
  failed: number
  /** The start grace ran out on site without the builder ever going down. */
  abandoned: number
  /**
   * Why each abandoned contract stalled, in `ContractStartBlock`'s words: `crowded` (no
   * chronicle room even after the game's own events made way) or `noGround`.
   */
  abandonedBy: Record<string, number>
  /**
   * W1-1's symptom — "a random event running at arrival abandons the contract after 12 s of
   * start grace": abandoned while a random event was up. Since the fix the event makes way
   * or the contract waits, so only a stall no event could relieve still produces one.
   */
  lostToEvents: number
  /** W1-1 — seconds a contract on its site waited instead of spending grace, by reason. */
  waitedSeconds: Record<string, number>
  /** W1-1 — located fights handed back to the chronicle to make room for a contract. */
  handedBackForContracts: number
}

/** W1-5 — whether an offered rumour could have been kept at all. */
export interface RumourFeasibility {
  offered: number
  /** Offers whose road ETA from where the player stood exceeded the time to deadline. */
  beyondReach: number
  beyondReachShare: number
  /** Route ETA minus time to deadline, per offer, in seconds. Positive is unreachable. */
  slack: number[]
}

/**
 * How much of the road the generator put in the player's way (a follow-up to W1-5). The
 * pinned arms count their encounter stand-in here, the shipped arms count
 * `createGeneratedEncounterPlans`. The finale's own encounter is not counted.
 */
export interface EncounterMetrics {
  /** Encounters that put at least one body on the field, each counted once. */
  fielded: number
  /** Bodies the encounters spawned. A square that streams back in fields them again. */
  actorsSpawned: number
  /** Live encounter bodies on the field, averaged over the run: how crowded the road was. */
  meanOnField: number
  /** Seconds in which the actor budget turned away at least one encounter body. */
  refusedSeconds: number
  /** W1-6 — soldiers commanders called onto the field. Counted on the road once called. */
  reinforcementsCalled: number
  /** W1-6 — the player's own packs that stepped back to make room for a staging. */
  packsSteppedBack: number
  /** W1-6 — packs that stepped back and came back onto their stations before streaming out. */
  packsReturned: number
}

/**
 * W1-5 — the balance block. Present on every report, populated by the arms that feed it,
 * and computed without a single draw from any stream, so its presence changes nothing the
 * pinned reports describe.
 */
export interface BalanceMetrics {
  /** The highest `getThreatTier` the run reached. */
  maxThreatTier: number
  /** `DOCTRINE_DRAFT_TIERS` crossed, whatever the doctrine arm took from them. */
  draftsReached: number
  /** Damage taken, by the system that spawned the hand that dealt it. */
  damageBySystem: Record<string, number>
  /** The system whose actor landed the last blow, or `bleeding`. */
  deathSystem: string | null
  companions: CompanionMetrics
  sustain: SustainMetrics
  events: EventMetrics
  caravans: CaravanMetrics
  contracts: ContractBalanceMetrics
  rumourFeasibility: RumourFeasibility
  encounters: EncounterMetrics
}

export interface RunReport {
  seed: number
  faction: Faction
  policy: InputPolicy
  meleeModel: MeleeModel
  /** How much of a telegraph the scripted player answered. */
  meleeDefence: MeleeDefence
  /** Roadmap 1.3 — which rumour arm this run was. */
  rumourPolicy: RumourPolicy
  /** Roadmap 1.4 — which fork arm this run was. */
  contractPolicy: ContractPolicy
  /** Roadmap 1.4 — branched, or the linearised placebo. */
  campaignShape: CampaignShape
  /** Roadmap 1.4 — whether the scripted player honoured the contract it started. */
  contractOutcome: ContractOutcomePolicy
  /** Roadmap 1.6 — which doctrine arm this run was. */
  doctrinePolicy: DoctrinePolicy
  /** W1-5 — the arms below default to the pre-W1-5 run every pinned number describes. */
  squad: SquadPolicy
  sustain: SustainPolicy
  eventModel: EventModel
  eventPolicy: EventPolicy
  eventDirector: EventDirector
  playerKit: PlayerKit
  encounterModel: EncounterModel
  /** The window the run simulated in: `engine` under the shipped encounters or events. */
  regionWindow: RegionWindow
  /** W1-6 — what the commanders did besides swing. */
  commanders: CommanderModel
  /** W1-6 — whether the player's own packs stepped back for a staging. */
  staging: StagingModel
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
  /** The role that landed the last blow, when a blow ended it — the epilogue's `causeRole`. */
  deathRole: ActorRole | null
  /** Simulated seconds spent in each region, keyed by region id. */
  regionDwell: Record<string, number>
  regionsVisited: number
  eventExposure: EventExposure
  /** Chronicle log ids in order, the "chronicle history" the schedule arms compare. */
  chronicleHistory: string[]
  /**
   * The chronicle log itself, not only its ids.
   *
   * `chronicleHistory` answers "did two runs write the same history"; this answers "what
   * did the сводка have to choose from", which is what `run/epilogue.ts` ranks into three
   * beats. Carried so a beat-shape measurement can run the shipped selection rather than
   * a re-implementation of it.
   */
  chronicleLog: ChronicleEvent[]
  chronicleTicks: number
  /**
   * Squares the run discovered, in discovery order — the epilogue's `route`, unbounded.
   *
   * The bounded eight-label postcard version is derived from this by `buildRunEpilogue`;
   * `regionDwell` cannot stand in for it, because a streamed-in square is discovered
   * without ever being stood in.
   */
  discoveredRegionIds: string[]
  /** Where the run stopped. The last square the сводка prints. */
  finalRegionId: string
  /**
   * Roadmap 1.3's signal, in its raw form: who held each square when the run stopped.
   *
   * The map, not only the tally. 1.2's epilogues found the *tally* coming out identical
   * across two seeds and two factions, so a metric that only counted squares per faction
   * could report "no change" while every square had swapped owners.
   */
  regionControl: Record<string, Territory>
  /** The same thing counted by holder, which is what the epilogue prints. */
  regionControlTally: Record<Territory, number>
  /**
   * Squares burned to the ground by the time the run stopped.
   *
   * Reported because it is the campaign-safety condition made checkable. It used to be a
   * stranding condition outright — `handleGeneratedInteraction` refused a burned shop or
   * healer before it looked at whether an objective wanted it — and roadmap 1.5 closed
   * that: the node completes, the service does not. What is left to watch is that a
   * reserved square burning still leaves the run finishable.
   */
  razedRegionIds: string[]
  rumours: RumourMetrics
  contracts: ContractMetrics
  doctrines: DoctrineMetrics
  /** Weather target changes, and where the player was standing for each. */
  weatherTargetChanges: number
  finalWeather: WeatherKind
  finalStormFactor: number
  health: number
  melee: MeleeMetrics
  /** W1-5 — the balance block. */
  balance: BalanceMetrics
}

export interface RunOptions {
  seed: number
  faction: Faction
  policy?: InputPolicy
  /** Simulation rate. The scripted schedules are 30, 60 and 144. */
  hz?: number
  timeLimit?: number
  /** Defaults to `legacy`, which is the pre-1.1 model every pinned number describes. */
  meleeModel?: MeleeModel
  /**
   * Whether the player answers a telegraph by cancelling and getting out.
   *
   * The negative control for signal 2: an arm with this set to `none` swings through every
   * heavy wind-up, so "the cancel raised the avoided share" is a comparison rather than a
   * claim.
   */
  meleeDefence?: MeleeDefence
  /** Defaults to `off`, which is the pre-1.3 world every pinned number describes. */
  rumourPolicy?: RumourPolicy
  /** Defaults to `firstReady`, which is the pre-1.4 ordering every pinned number describes. */
  contractPolicy?: ContractPolicy
  /** Defaults to `branched`. `chain` is the anti-placebo control. */
  campaignShape?: CampaignShape
  /** Defaults to `honour`. `shirk` is the fail-forward arm. */
  contractOutcome?: ContractOutcomePolicy
  /** Defaults to `off`, which is the pre-1.6 run every pinned number describes. */
  doctrinePolicy?: DoctrinePolicy
  /**
   * The doctrine ids the run may draft from. Defaults to the three open from run one.
   *
   * A parameter rather than a profile read, because the harness has no profile — and
   * because "what does a wider pool do to the distinct-set count" is precisely the number
   * the roadmap's second signal is about.
   */
  doctrinePool?: readonly string[]
  /**
   * The world to run in, instead of `generateWorld(seed)`.
   *
   * Measurement instrumentation for ablation arms: `tests/worldVariety.ts` already knows
   * how to hold one generator axis still across a corpus, and this is what lets that
   * ablated corpus be *walked* rather than only counted. Nothing in the shipped game hands
   * a blueprint in — the engine always generates its own — so an arm that uses this is
   * declaring itself a control.
   *
   * The blueprint is used as given and may be mutated by the `chain` arm, so a caller that
   * reuses one across runs should pass a copy.
   */
  blueprint?: WorldBlueprint
  /**
   * A nuisance salt on the combat stream only. The noise floor's instrument.
   *
   * With it unset, every stream derives exactly as it always has, so every pinned number
   * in this suite still describes the same run. With it set, the world, the encounters,
   * the chronicle draws and the rumour draws are **identical** and only the damage rolls
   * differ — which is what makes "this metric is reading world structure" a comparison
   * against "this metric is reading dice" rather than an assertion.
   */
  combatNoiseSalt?: number
  /** W1-5 — defaults to `off`: nobody walks with the player. */
  squad?: SquadPolicy
  /** W1-5 — defaults to `off`: no wounds, no healing, no gold. */
  sustain?: SustainPolicy
  /** W1-5 — defaults to `counted`: events are counted, not fought. */
  eventModel?: EventModel
  /** W1-5 — defaults to `ignore`. Only read when `eventModel` is `fought`. */
  eventPolicy?: EventPolicy
  /** W1-5 — defaults to `shipped`. `silent` is the W1-1 control. */
  eventDirector?: EventDirector
  /** W1-5 — defaults to `harness`, this file's original walk and swing. */
  playerKit?: PlayerKit
  /** W1-5 — defaults to `harness`, this file's original encounter stand-in. */
  encounterModel?: EncounterModel
  /**
   * The streaming window (W1-6's finding). Defaults to `engine`, the plus the engine
   * simulates, whenever `encounterModel` is `shipped` or `eventModel` is `fought`.
   * Otherwise it defaults to `square`, the 3x3 every pinned number was measured in.
   * Setting it to `square` under the shipped arms is the control.
   */
  regionWindow?: RegionWindow
  /**
   * W1-6 — defaults to `inert`, the commander every pinned number was measured with: a body
   * and a swing. `legacy` is the engine's call for men before W1-6, `shipped` after it.
   */
  commanders?: CommanderModel
  /**
   * W1-6 — defaults to `none`, the rule every pinned number was measured with: nobody steps
   * back for a staging. `friendly` is the engine's `makeRoomForStaging`. Read only under the
   * shipped encounters, whose packs are the ones that can step back.
   */
  staging?: StagingModel
}

/**
 * W1-5 — every shipped arm at once: the configuration the balance baseline is measured in.
 *
 * Honest melee answering heavies, the nearest arm of the fork and seeded drafts are the
 * gameplay review's sweep; the seven W1-5 arms are what that sweep lacked. Rumours are
 * offered, measured for feasibility and resolved, but not chased: the review's `commit`
 * arm pins every rumour within reach and, with the shipped arms on, measured as a player
 * standing in one square for minutes at a time while the campaign waits, which is a fact
 * about that policy and would swamp the run-length distribution the baseline exists to
 * report. Spread this under a run's own seed, faction and policy.
 *
 * The shipped encounters and fought events also switch the run to the engine's streaming
 * window, `regionWindow: 'engine'`. It is derived rather than listed here, so a run that
 * turns either of them on by hand gets the engine's window too. Pass `regionWindow:
 * 'square'` to measure what the pinned window does to these arms.
 */
export const HARNESS_SHIPPED_ARMS = {
  meleeModel: 'honest',
  meleeDefence: 'heavy',
  rumourPolicy: 'ignore',
  contractPolicy: 'nearest',
  doctrinePolicy: 'seeded',
  squad: 'starting',
  sustain: 'shipped',
  eventModel: 'fought',
  eventPolicy: 'ignore',
  eventDirector: 'shipped',
  playerKit: 'shipped',
  encounterModel: 'shipped',
  commanders: 'shipped',
  staging: 'friendly',
} as const satisfies Partial<RunOptions>

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

/**
 * Which system put an actor on the field. W1-5's damage-by-source and death attribution read
 * it; nothing about how an actor behaves does.
 */
export type ActorSystem =
  | 'encounter'
  | 'squad'
  | 'randomEvent'
  | 'contractEvent'
  | 'locatedEvent'
  | 'threatWave'
  | 'caravan'
  | 'ambush'
  | 'finale'

/**
 * One body on the field.
 *
 * `model` is the switch W1-5 added. `harness` is the original stand-in — a 22 m sense range,
 * a 24 m hunt radius, routing straight away from the player, standing still when idle — and
 * every legacy encounter actor keeps it, so every pinned number keeps it. `engine` is what
 * the shipped arms spawn: `updateActors`' own ranges, rage, alerts, retaliation, morale on
 * its 0.35 s clock with the 12 s rally, routing back to its post, archers that keep their
 * distance and loose arrows, and companions driven by `selectSquadIntent`.
 */
export interface HarnessActor extends AiActor, CombatActor {
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
  /** When the player first wounded it. The left-hand end of the time-to-kill measurement. */
  firstHitAt: number | null
  /** Set when a wind-up against the player starts, so the resolution can be attributed. */
  telegraphHeavy: boolean
  /** True once the player has answered *this* wind-up, so a clear is counted once. */
  clearAttempted: boolean
  // --- W1-5 -----------------------------------------------------------------
  model: 'harness' | 'engine'
  system: ActorSystem
  budgetCategory: ActorBudgetCategory
  squadEligible: boolean
  squadSlot: number | null
  eventOwnerId: string | null
  aiMode: 'normal' | 'captive' | 'attackEventProp'
  /** The event prop this actor is pointed at, by event id. */
  propOwnerId: string | null
  homeX: number
  homeZ: number
  /** The `decoy` squad placebo: follows, can be struck, never strikes. */
  inert: boolean
  rageTimer: number
  alertCooldown: number
  retaliationTimer: number
  lastKnownX: number | null
  lastKnownZ: number | null
  rallyTimer: number
  moraleTimer: number
  routReason: MoraleBreak
  retreatTimer: number
  actionKind: 'melee' | 'arrow' | 'prop'
  actionAimX: number
  actionAimZ: number
  /** The finale boss: its death completes this node. */
  objectiveId: string | null
  /** True once the player has landed a blow on it. */
  struckByPlayer: boolean
  /** W1-2 — a standing order's post (`actor.order`), and the seconds it has left. */
  orderX: number | null
  orderZ: number | null
  orderTimer: number
}

/** The beat indexes, so a metric array cannot disagree with the beat table's length. */
const PLAYER_MELEE_BEAT_INDEXES: readonly number[] = PLAYER_MELEE_BEATS.map(
  (spec) => spec.beat,
)

function actorPoint(actor: HarnessActor): AiPoint {
  return { x: actor.x, y: 0, z: actor.z }
}

type W15ActorFields = Pick<
  HarnessActor,
  | 'model'
  | 'system'
  | 'budgetCategory'
  | 'squadEligible'
  | 'squadSlot'
  | 'eventOwnerId'
  | 'aiMode'
  | 'propOwnerId'
  | 'homeX'
  | 'homeZ'
  | 'inert'
  | 'rageTimer'
  | 'alertCooldown'
  | 'retaliationTimer'
  | 'lastKnownX'
  | 'lastKnownZ'
  | 'rallyTimer'
  | 'moraleTimer'
  | 'routReason'
  | 'retreatTimer'
  | 'actionKind'
  | 'actionAimX'
  | 'actionAimZ'
  | 'objectiveId'
  | 'struckByPlayer'
  | 'orderX'
  | 'orderZ'
  | 'orderTimer'
>

/**
 * The W1-5 fields for a legacy encounter actor: the `harness` model, which none of the new
 * code paths touch, so an actor spawned with these behaves exactly as it always did.
 */
function legacyActorDefaults(homeX: number, homeZ: number): W15ActorFields {
  return {
    model: 'harness',
    system: 'encounter',
    budgetCategory: 'campaign',
    squadEligible: false,
    squadSlot: null,
    eventOwnerId: null,
    aiMode: 'normal',
    propOwnerId: null,
    homeX,
    homeZ,
    inert: false,
    rageTimer: 0,
    alertCooldown: 0,
    retaliationTimer: 0,
    lastKnownX: null,
    lastKnownZ: null,
    rallyTimer: 0,
    moraleTimer: 0,
    routReason: 'none',
    retreatTimer: 0,
    actionKind: 'melee',
    actionAimX: 0,
    actionAimZ: 0,
    objectiveId: null,
    struckByPlayer: false,
    orderX: null,
    orderZ: null,
    orderTimer: 0,
  }
}

/** `actorColliderRadiusForRole`. */
function actorRadius(role: ActorRole): number {
  if (isBeastRole(role)) return BEAST_PROFILES[role].colliderRadius
  return role === 'brute' || role === 'champion'
    ? HARNESS_LARGE_ACTOR_RADIUS
    : HARNESS_ACTOR_RADIUS
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
  const meleeModel = options.meleeModel ?? 'legacy'
  const meleeDefence = options.meleeDefence ?? 'heavy'
  const rumourPolicy = options.rumourPolicy ?? 'off'
  const contractPolicy = options.contractPolicy ?? 'firstReady'
  const campaignShape = options.campaignShape ?? 'branched'
  const contractOutcome = options.contractOutcome ?? 'honour'
  const doctrinePolicy = options.doctrinePolicy ?? 'off'
  // W1-5 — every new arm defaults to the run the pinned numbers describe.
  const squadPolicy = options.squad ?? 'off'
  const sustainPolicy = options.sustain ?? 'off'
  const eventModel = options.eventModel ?? 'counted'
  const eventPolicy = options.eventPolicy ?? 'ignore'
  const eventDirector = options.eventDirector ?? 'shipped'
  const playerKit = options.playerKit ?? 'harness'
  const encounterModel = options.encounterModel ?? 'harness'
  const squadOn = squadPolicy !== 'off'
  const sustainOn = sustainPolicy !== 'off'
  const healingOn = sustainPolicy === 'shipped'
  const eventsFought = eventModel === 'fought'
  const shippedKit = playerKit === 'shipped'
  const shippedEncounters = encounterModel === 'shipped'
  // W1-6 — the engine's window whenever its encounters or its fights are on.
  const regionWindow: RegionWindow =
    options.regionWindow ?? (shippedEncounters || eventsFought ? 'engine' : 'square')
  const commanderModel: CommanderModel = options.commanders ?? 'inert'
  const stagingModel: StagingModel = options.staging ?? 'none'
  // W1-6 — only the generator's own packs can step back, so only its shipped encounters can.
  const stagingOn = stagingModel === 'friendly' && shippedEncounters

  const blueprint = options.blueprint ?? generateWorld(options.seed)
  // The two placebos. Both leave every site, encounter, road and chronicle seed identical
  // and remove exactly one thing — the fork itself, or only its exclusivity — which is what
  // makes "the fork produced the divergence" a comparison rather than a claim.
  if (campaignShape === 'chain') linearizeCampaignGraph(blueprint, options.faction)
  if (campaignShape === 'allRequired') unmakeExclusiveArms(blueprint, options.faction)
  const terrain = new TerrainSystem(blueprint)
  const collision = new CollisionWorld(terrain)
  collision.setWorldBounds(terrain.bounds)
  const navigation = new NavigationSystem(blueprint, terrain, collision)

  // The noise arm salts this one stream and nothing else, so an unsalted run derives
  // exactly what it always derived.
  const combatRng = new RandomStream(
    deriveSeed(
      blueprint.seed,
      options.combatNoiseSalt === undefined
        ? 'gameplay:combat'
        : `harness:combat-noise:${options.combatNoiseSalt}`,
    ),
  )
  const eventRng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:event'))
  const chronicleRng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:chronicle'))
  // Roadmap 1.3 — the engine's own dedicated stream, derived the same way, so a rumour
  // offer never moves a draw the chronicle tick was going to take.
  const rumourRng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:rumour'))

  const chronicleState: ChronicleState = createChronicleState()
  const chronicleRegions: Map<string, RegionChronicleState> =
    createChronicleRegions(blueprint)
  const protectedRegionIds = getChronicleProtectedRegionIds(blueprint)

  const objectives: Objective[] = createGeneratedObjectives(blueprint, options.faction)
  const objectiveReports = new Map<string, ObjectiveReport>()

  // --- roadmap 1.3: the commitment loop ---------------------------------------
  const commitments: ChronicleCommitmentState = createChronicleCommitmentState()
  const rumourReservedRegionIds = getRumourReservedRegionIds(blueprint, options.faction)
  const rumours: RumourMetrics = {
    offered: 0,
    offeredByKind: {},
    pinned: 0,
    resolved: 0,
    kept: 0,
    broken: 0,
    brokenWhileCommitted: 0,
    events: 0,
    embodiedSeconds: 0,
  }
  const rumourContext = (): RumourWorldContext => ({
    blueprint,
    state: chronicleState,
    regions: chronicleRegions,
    playerFaction: options.faction,
    reservedRegionIds: rumourReservedRegionIds,
  })

  // --- roadmap 1.4 / 2.1: the fork ---------------------------------------------
  const contracts: CampaignContractState = createCampaignContractState()
  const graph = blueprint.objectives[options.faction]
  // Roadmap 2.1 — every contract node, not the one. `contractNode` stays as the signature
  // arm, because the faction-differentiation signal and the reserved-square guarantee are
  // both about that one specifically.
  const contractNodes = graph.nodes.filter((node) => node.contract !== undefined)
  const contractNode = contractNodes[0] ?? null
  const middleNodeIds = new Set(
    graph.nodes
      .filter((node) => !graph.rootNodeIds.includes(node.id) && node.id !== graph.finalNodeId)
      .map((node) => node.id),
  )
  const contractMetrics: ContractMetrics = {
    contractId: contractNode?.contract ?? null,
    contractNodeId: contractNode?.id ?? null,
    contractSiteId: contractNode?.siteId ?? null,
    contractIds: contractNodes.map((node) => String(node.contract)),
    middleOrder: [],
    pins: [],
    chose: false,
    maxReady: 0,
    started: 0,
    kept: 0,
    failedForward: 0,
    completed: false,
    skipped: [],
    skippedLive: 0,
    route: [],
    rewardedObjectives: 0,
    strandedAtEnd: false,
  }
  // Its own derived stream, for the same reason 1.3's rumours got one: a pin drawn from the
  // event stream would move the next encounter roll, and the arm would then be changing the
  // world simply by existing.
  const contractRng = new RandomStream(deriveSeed(blueprint.seed, 'harness:contract'))
  /** Nodes the `shirk` arm has already walked away from. Shirking is a one-time decision. */
  const shirkedNodeIds = new Set<string>()
  /** Simulated seconds the player has held each live contract's site with nothing hostile near. */
  const contractHold = new Map<string, number>()
  /**
   * Roadmap 2.1 — the shipped skip rule, run from the harness.
   *
   * `skipExclusiveAlternatives` is `CampaignDirector`'s own, not a re-implementation, so a
   * run that finishes here finishes for the same reason a run in the browser does.
   */
  const settleSkips = (completedNodeId: string): void => {
    for (const objective of skipExclusiveAlternatives(graph, objectives, completedNodeId)) {
      contractMetrics.skipped.push(objective.id)
      // Only a contract that was actually on the ground counts as chosen past. An `offered`
      // arm the player never reached is simply an arm they never reached, and counting it
      // would inflate the number the whole-run safety sweep balances against `started`.
      const progress = getContractProgress(contracts, objective.id)
      if (progress && isContractLive(progress.status)) {
        if (progress.status === 'active') contractMetrics.skippedLive += 1
        resolveContract(contracts, objective.id, 'failed')
      }
      if (contracts.pinnedNodeId === objective.id) contracts.pinnedNodeId = null
    }
  }

  // --- roadmap 1.6: the draft --------------------------------------------------
  const doctrineState: DoctrineRunState = createDoctrineRunState(
    options.doctrinePool ?? DEFAULT_DOCTRINE_IDS,
  )
  const doctrineMetrics: DoctrineMetrics = {
    pool: [...doctrineState.pool],
    offers: [],
    equipped: [],
    capBreaches: 0,
    draftsOpened: 0,
  }
  // Its own derived stream, for the same reason 1.3's rumours and 1.4's pins got theirs.
  // Note that this is the *policy's* coin, not the offer's: `rollDoctrineOffer` builds and
  // discards its own stream from the world seed, so the three cards on the table are the
  // same in every arm and only the pick differs.
  const doctrineRng = new RandomStream(deriveSeed(blueprint.seed, 'harness:doctrine'))
  let doctrineEffects: DoctrineEffects = resolveDoctrineEffects([])

  /**
   * One tick of the draft, in the engine's order: cross the anchors, then answer.
   *
   * The functions are the shipped ones. `capBreaches` counts a refusal that should be
   * impossible — the policy never asks for a fourth card, so anything but zero means the
   * ledger and the cap disagree.
   */
  const advanceDoctrines = (): void => {
    if (doctrinePolicy === 'off') return
    if (advanceDoctrineAnchors(doctrineState, getThreatTier(elapsed))) {
      doctrineMetrics.draftsOpened = doctrineState.anchors
    }
    const index = pendingDoctrineDraftIndex(doctrineState)
    if (index === null) return
    // One row per draft, not one per frame. An unanswered offer stays the same offer — the
    // engine shows one at a time and a player who walks past it meets it again — so the
    // `none` arm records exactly one row and holds it for the rest of the run.
    if (doctrineMetrics.offers.length > index) return
    const offer = getDoctrineOffer(doctrineState, blueprint.seed)
    if (offer.length === 0) return
    doctrineMetrics.offers.push([...offer])
    if (doctrinePolicy === 'none') return
    const pick = doctrinePolicy === 'first' ? offer[0] : doctrineRng.pick(offer)
    if (equipDoctrine(doctrineState, blueprint.seed, pick)) {
      doctrineMetrics.equipped.push(pick)
      doctrineEffects = resolveDoctrineEffects(doctrineState.equipped)
    } else if (doctrineState.equipped.length < MAX_EQUIPPED_DOCTRINES) {
      doctrineMetrics.capBreaches += 1
    }
  }

  const startSite = blueprint.sites.find(
    (site) => site.id === blueprint.starts[options.faction],
  )
  if (!startSite) throw new Error('Generated start site is missing')
  const siteStart = getSiteWorldPosition2D(blueprint, startSite)
  if (!siteStart) throw new Error('Generated start position is missing')
  // W1-5 — the shipped kit spawns where `getStartPosition` does: twenty metres back along
  // the critical path, so the first objective is a walk rather than the frame you load in.
  const start = shippedKit
    ? (getFactionStartPosition2D(blueprint, options.faction) ?? siteStart)
    : siteStart
  const boon = getStartingBoonEffects(HARNESS_STARTING_BOON)

  const player = {
    x: start.x,
    z: start.z,
    health: 100,
    maxHealth: 100,
    damage: shippedKit
      ? HARNESS_FACTION_DAMAGE[options.faction] + boon.startingDamageBonus
      : 28,
    bleeding: 0,
    attackCooldown: 0,
    // --- roadmap 1.1 ---------------------------------------------------------
    stamina: 100,
    maxStamina: 100,
    /** Where the camera points. `(sin, cos)` of it is the aim vector the arc tests. */
    aimYaw: 0,
    melee: createPlayerMeleeState() as PlayerMeleeState,
    // --- W1-5 ----------------------------------------------------------------
    body: createHealthyBody() as BodyState,
    gold: sustainOn ? HARNESS_STARTING_GOLD + boon.startingGoldBonus : 0,
    supplies: sustainOn ? boon.startingSupplyCount : 0,
    /** `cameraYaw`: the squad's formation faces where the player last walked. */
    heading: getFactionStartHeading(blueprint, options.faction, start),
  }

  const melee: MeleeMetrics = {
    beatsResolved: 0,
    beatsWhiffed: 0,
    whiffRate: 0,
    beatsByIndex: PLAYER_MELEE_BEAT_INDEXES.map(() => 0),
    finishersLanded: 0,
    poiseBreaks: 0,
    staminaSpent: 0,
    cancels: 0,
    telegraphedHeavies: 0,
    telegraphedHeaviesAvoided: 0,
    avoidableHitRate: 0,
    windupClearAttempts: {},
    windupClears: {},
    hitsWhileCommitted: 0,
    committedSeconds: 0,
    timeToKillByRole: {},
    killsByRole: {},
  }
  const killTimes = new Map<string, number[]>()
  const recordKill = (role: string, seconds: number): void => {
    const bucket = killTimes.get(role)
    if (bucket) bucket.push(seconds)
    else killTimes.set(role, [seconds])
  }

  let elapsed = 0
  let frames = 0
  let chronicleAccumulator = 0
  let chronicleTicks = 0
  let distanceWalked = 0
  let kills = 0
  let deathCause: DeathCause = 'none'
  let deathRole: ActorRole | null = null
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
  let lastAttackerRole: ActorRole | null = null

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

  // The streaming window. `simulatedRegionIds` is what the engine would be simulating:
  // encounters, materialization, the chronicle's freeze and navigation all read it. The
  // pinned `square` window simulates its whole visible block, so there the two are one.
  const windowAt = createRegionWindow(blueprint, terrain, regionWindow)
  let simulatedRegionIds = new Set(windowAt(player.x, player.z).simulated)
  navigation.setActiveRegions(simulatedRegionIds)
  discoveredRegionIds.add(regionIdAt(player.x, player.z))

  // ---------------------------------------------------------------------------
  // W1-5 — the shipped arms: state
  // ---------------------------------------------------------------------------

  // Streams the pinned arms never read, each the engine's own derivation, so nothing a W1-5
  // arm draws can move a draw an older arm takes. The fights get the harness's own stream:
  // the legacy encounter stand-in already draws from `gameplay:event`, and an event arm that
  // moved it would change the very encounters it is being compared against.
  const lootRng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:loot'))
  const directorRng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:director'))
  const fightRng = new RandomStream(deriveSeed(blueprint.seed, 'harness:events'))

  const companionMetrics: CompanionMetrics = {
    started: 0,
    recruited: 0,
    lost: 0,
    lostTo: {},
    aliveAtFinale: null,
    aliveAtEnd: 0,
    damageDealt: 0,
    kills: 0,
    damageTaken: 0,
  }
  const sustainMetrics: SustainMetrics = {
    goldEarned: 0,
    goldBySource: {},
    goldSpent: 0,
    goldSpentOn: {},
    goldAtEnd: 0,
    healed: 0,
    healedBySource: {},
    rationsEaten: 0,
    rationsLeft: 0,
    healerVisits: 0,
    traderVisits: 0,
    treasureClaimed: 0,
    lootDrops: 0,
    injuries: 0,
    limbsLost: 0,
    prostheses: 0,
    healingWithheld: 0,
  }
  const eventMetrics: EventMetrics = {
    randomStarted: {},
    randomSucceeded: 0,
    randomFailed: 0,
    locatedMaterialized: {},
    locatedSucceeded: 0,
    locatedFailed: 0,
    locatedHandedBack: 0,
    wonWithoutPlayer: 0,
    randomStoodDown: 0,
    threatWaves: 0,
    threatWaveActors: 0,
  }
  const caravanMetrics: CaravanMetrics = {
    robbed: 0,
    robbedBy: {},
    escorted: 0,
    escortedBy: {},
    lost: 0,
    lostBy: {},
    robberiesLostToNpcs: 0,
    robbedBySquad: 0,
    claimsOpened: 0,
    lootsStarted: 0,
    lootsBrokenByPlayer: 0,
  }
  const contractBalance: ContractBalanceMetrics = {
    started: 0,
    kept: 0,
    failed: 0,
    abandoned: 0,
    abandonedBy: {},
    lostToEvents: 0,
    waitedSeconds: {},
    handedBackForContracts: 0,
  }
  const feasibility: RumourFeasibility = {
    offered: 0,
    beyondReach: 0,
    beyondReachShare: 0,
    slack: [],
  }
  const encounterMetrics: EncounterMetrics = {
    fielded: 0,
    actorsSpawned: 0,
    meanOnField: 0,
    refusedSeconds: 0,
    reinforcementsCalled: 0,
    packsSteppedBack: 0,
    packsReturned: 0,
  }
  const fieldedEncounterIds = new Set<string>()
  /** Live encounter bodies times seconds, divided out into `meanOnField` at the end. */
  let encounterBodySeconds = 0
  /** The budget turned an encounter body away on this frame. */
  let encounterRefusedThisFrame = false
  const damageBySystem: Record<string, number> = {}
  let lastAttackerSystem: string | null = null
  let bledOut = false
  let threatTier = getThreatTier(0)
  let maxThreatTier = threatTier
  let championDamageBonus = 0
  let interactCooldown = 0

  const bump = (into: Record<string, number>, key: string, amount = 1): void => {
    into[key] = (into[key] ?? 0) + amount
  }

  // --- the actor budget, as `GameEngine` keeps it ------------------------------

  /** `actorYieldRank`: corpses first, then the far away, objective holders last. */
  const yieldRank = (actor: HarnessActor): number =>
    actor.alive
      ? (actor.objectiveId ? 800 : 0) - Math.hypot(actor.x - player.x, actor.z - player.z)
      : -1_000_000
  const budgetUsage = (): Record<ActorBudgetCategory, number> => {
    const usage: Record<ActorBudgetCategory, number> = {
      squad: 0,
      campaign: 0,
      chronicle: 0,
      ambient: 0,
    }
    for (const actor of actors) usage[actor.budgetCategory] += 1
    return usage
  }
  // `yieldActorSlots`. Assigned once the event runtime below exists, because handing a
  // located fight back to the chronicle is the first thing the chronicle budget gives up.
  let yieldSlots: (category: ActorBudgetCategory, count: number) => number = () => 0
  const actorBudget = new ActorBudget((category, count) => yieldSlots(category, count))
  const reserveSlots = (category: ActorBudgetCategory, count: number): boolean => {
    actorBudget.sync(budgetUsage())
    return actorBudget.reserve(category, count)
  }
  const reserveSlotsUpTo = (category: ActorBudgetCategory, count: number): number => {
    actorBudget.sync(budgetUsage())
    return actorBudget.reserveUpTo(category, count)
  }
  /** W1-6 — `reserveOwnActorSlots`: the category's own share only, nothing borrowed. */
  const reserveOwnSlots = (category: ActorBudgetCategory, count: number): boolean => {
    actorBudget.sync(budgetUsage())
    return actorBudget.reserveOwn(category, count)
  }
  const availableSlots = (category: ActorBudgetCategory): number => {
    actorBudget.sync(budgetUsage())
    return actorBudget.availableFor(category)
  }
  const removeActor = (actorId: string): void => {
    const index = actors.findIndex((actor) => actor.id === actorId)
    if (index >= 0) actors.splice(index, 1)
  }
  /** `claimActorSlot`: the hard gate, evicting the cheapest lower-priority body if full. */
  const claimSlot = (category: ActorBudgetCategory): void => {
    if (reserveSlots(category, 1)) return
    const order: readonly ActorBudgetCategory[] = ['squad', 'campaign', 'chronicle', 'ambient']
    const claimant = order.indexOf(category)
    while (actors.length >= HARNESS_MAX_ACTORS) {
      let victim: HarnessActor | null = null
      let best = Number.POSITIVE_INFINITY
      for (const actor of actors) {
        const priority = order.indexOf(actor.budgetCategory)
        if (priority < claimant) continue
        const score = -priority * 10_000_000 + yieldRank(actor)
        if (score >= best) continue
        best = score
        victim = actor
      }
      if (!victim) break
      removeActor(victim.id)
    }
  }

  interface EngineSpawn {
    allegiance: Allegiance
    role: ActorRole
    x: number
    z: number
    system: ActorSystem
    budget: ActorBudgetCategory
    hostileToPlayer?: boolean
    healthScale?: number
    maxHp?: number
    speed?: number
    eventOwnerId?: string | null
    aiMode?: HarnessActor['aiMode']
    propOwnerId?: string | null
    ignoredTargetId?: string | null
    packId?: string | null
    packKinSize?: number
    squadEligible?: boolean
    encounterId?: string
    objectiveId?: string | null
  }

  /**
   * `spawnActor`, for the `engine` model: health from `actorBaseHealth` times the tier and
   * the plan's difficulty, the role's own speed, the beast truce at spawn time, and the
   * body nudged out of anything it was placed inside.
   */
  const spawnEngineActor = (input: EngineSpawn): HarnessActor => {
    claimSlot(input.budget)
    const beast = isBeastRole(input.role) ? BEAST_PROFILES[input.role] : null
    const radius = actorRadius(input.role)
    const placed = collision.resolveMovement(
      { x: input.x, z: input.z },
      { x: input.x, z: input.z },
      radius,
    )
    const at = clampToBounds({ x: placed.x, z: placed.z }, terrain.bounds, radius)
    const maxHp =
      input.maxHp ??
      Math.round(
        actorBaseHealth(input.role) *
          enemyHealthMultiplier(threatTier, areAllegiancesHostile(options.faction, input.allegiance)) *
          Math.max(0.1, input.healthScale ?? 1),
      )
    actorSequence += 1
    const actor: HarnessActor = {
      id: `${input.allegiance}-${input.role}-${actorSequence}`,
      allegiance: input.allegiance,
      role: input.role,
      alive: true,
      ignoredTargetId: input.ignoredTargetId ?? null,
      targetId: null,
      packId: input.packId ?? null,
      packKinSize: Math.max(1, input.packKinSize ?? 1),
      hp: maxHp,
      maxHp,
      playerAggro: false,
      x: at.x,
      z: at.z,
      speed: input.speed ?? beast?.speed ?? actorSpeedForRole(input.role),
      attackCooldown: 0,
      actionPhase: 'idle',
      actionRemaining: 0,
      actionTargetIsPlayer: false,
      actionTargetId: null,
      hostileToPlayer:
        doctrineEffects.beastTruce && isBeastRole(input.role)
          ? false
          : (input.hostileToPlayer ??
            areAllegiancesHostile(input.allegiance, options.faction)),
      aggroMemory: 0,
      routTimer: 0,
      deathAt: null,
      reaction: 'none',
      reactionRemaining: 0,
      poise: actorMaxPoise(input.role),
      maxPoise: actorMaxPoise(input.role),
      poiseRecoveryDelay: 0,
      staggerImmunity: 0,
      regionId: regionIdAt(at.x, at.z),
      encounterId: input.encounterId ?? '',
      firstHitAt: null,
      telegraphHeavy: false,
      clearAttempted: false,
      ...legacyActorDefaults(at.x, at.z),
      model: 'engine',
      system: input.system,
      budgetCategory: input.budget,
      squadEligible: input.squadEligible ?? false,
      eventOwnerId: input.eventOwnerId ?? null,
      aiMode: input.aiMode ?? 'normal',
      propOwnerId: input.propOwnerId ?? null,
      moraleTimer: (actorSequence % 7) * (HARNESS_MORALE_CHECK_INTERVAL / 7),
      objectiveId: input.objectiveId ?? null,
    }
    actors.push(actor)
    return actor
  }

  // --- W1-5: the squad ----------------------------------------------------------

  /** The formation's anchor and stance. Follow is the stance the run starts in and keeps. */
  const squadState: SquadCommandState = createSquadCommandState({
    x: player.x,
    z: player.z,
    heading: player.heading,
  })
  const companions = (): HarnessActor[] =>
    squadOn ? actors.filter((actor) => isSquadMember(actor, options.faction)) : []
  /** `assignSquadSlot`: a stable hash of the id into a slot nobody else holds. */
  const assignSquadSlot = (actor: HarnessActor): void => {
    const occupied = new Set<number>()
    for (const other of companions()) {
      if (other !== actor && other.squadSlot !== null) occupied.add(other.squadSlot)
    }
    actor.squadSlot = allocateSquadSlot(actor.id, occupied)
  }
  /** `isMovementPathClear`, against this file's collision world. */
  const pathClear = (x0: number, z0: number, x1: number, z1: number, radius: number): boolean => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.32))
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps
      if (!collision.isWalkablePosition(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, radius)) {
        return false
      }
    }
    return true
  }
  /** `spawnGeneratedStartingSquad`, at the same offsets from the player's spawn. */
  const spawnStartingSquad = (): void => {
    if (!squadOn) return
    for (const [index, member] of getStartingSquad(options.faction).entries()) {
      if (!reserveSlots('squad', 1)) break
      const radius = actorRadius(member.role)
      const desired = { x: player.x + member.offsetX, z: player.z + member.offsetZ }
      const position = findSquadWalkablePosition(
        desired,
        (point) =>
          collision.isWalkablePosition(point.x, point.z, radius) &&
          (pathClear(point.x, point.z, player.x, player.z, radius) ||
            navigation.findPath(point, player) !== null),
        8,
      )
      if (!position) continue
      const actor = spawnEngineActor({
        allegiance: options.faction,
        role: member.role,
        x: position.x,
        z: position.z,
        system: 'squad',
        budget: 'squad',
        hostileToPlayer: false,
        squadEligible: true,
      })
      actor.id = startingSquadIdentity(options.faction, index)
      actor.inert = squadPolicy === 'decoy'
      assignSquadSlot(actor)
      companionMetrics.started += 1
    }
  }

  // --- W1-5: the body and the purse ---------------------------------------------

  const BODY_PARTS: readonly BodyPart[] = [
    'leftArm',
    'rightArm',
    'leftLeg',
    'rightLeg',
    'leftEye',
    'rightEye',
  ]
  const hasWounds = (): boolean => BODY_PARTS.some((part) => player.body[part] === 'wounded')
  /** `armPenalty`. */
  const armPenalty = (): number =>
    (player.body.leftArm === 'missing' ? 5 : 0) + (player.body.rightArm === 'missing' ? 9 : 0)
  const earnGold = (amount: number, source: string): void => {
    if (!sustainOn || amount <= 0) return
    player.gold += amount
    sustainMetrics.goldEarned += amount
    bump(sustainMetrics.goldBySource, source, amount)
  }
  const spendGold = (amount: number, item: string): void => {
    player.gold -= amount
    sustainMetrics.goldSpent += amount
    bump(sustainMetrics.goldSpentOn, item, amount)
  }
  /**
   * Restores health, or — in the `visit` placebo — counts what would have been restored
   * and restores nothing. Every heal in the body arm goes through here, so the placebo
   * cannot leak through a path somebody forgot.
   */
  const heal = (amount: number, source: string): number => {
    if (!sustainOn) return 0
    const restored = Math.min(Math.max(0, player.maxHealth - player.health), amount)
    if (!healingOn) {
      sustainMetrics.healingWithheld += restored
      return 0
    }
    player.health += restored
    sustainMetrics.healed += restored
    bump(sustainMetrics.healedBySource, source, restored)
    return restored
  }
  const stopBleeding = (relief: number | 'all'): void => {
    if (!healingOn) return
    player.bleeding = relief === 'all' ? 0 : Math.max(0, player.bleeding - relief)
  }
  const healWounds = (): void => {
    if (!healingOn) return
    for (const part of BODY_PARTS) if (player.body[part] === 'wounded') player.body[part] = 'healthy'
  }
  /** `injurePlayer`: a limb from the combat stream, and the bleed it opens. */
  const injurePlayer = (): void => {
    const available = BODY_PARTS.filter(
      (part) => player.body[part] === 'healthy' || player.body[part] === 'wounded',
    )
    if (available.length === 0) return
    const part = available[Math.floor(combatRng.next() * available.length)]
    const wasWounded = player.body[part] === 'wounded'
    const severe = wasWounded || combatRng.next() < 0.4
    sustainMetrics.injuries += 1
    if (severe) {
      player.body[part] = 'missing'
      sustainMetrics.limbsLost += 1
      if (!part.includes('Eye')) {
        player.bleeding = Math.min(2.1, player.bleeding + (part.includes('Leg') ? 0.48 : 0.34))
      }
    } else {
      player.body[part] = 'wounded'
      player.bleeding = Math.min(1.2, player.bleeding + 0.12)
    }
  }
  /** The walk, in whichever kit this run carries. */
  const walkSpeed = (): number => {
    let speed = shippedKit ? HARNESS_SHIPPED_PLAYER_SPEED : HARNESS_PLAYER_SPEED
    if (sustainOn) speed *= playerLegMobility(player.body)
    if (
      shippedKit &&
      options.faction === 'elf' &&
      zoneAt(player.x, player.z) === 'forest'
    ) {
      speed *= HARNESS_ELF_FOREST_MOBILITY
    }
    return speed
  }
  /** A melee blow from the player, in this run's kit. One combat draw, as in both engines. */
  const playerBlow = (multiplier: number): number =>
    shippedKit
      ? Math.max(8, player.damage - armPenalty() + Math.floor(combatRng.next() * 7)) *
        multiplier
      : (player.damage + combatRng.next() * 7) * multiplier

  // Loot tokens on the ground. A token is pulled in once the player is within the magnet
  // radius or once it is old enough to come anyway, and it lands after the flight the
  // magnet's top speed allows — the engine's arc, reduced to its timing.
  interface GroundLoot {
    reward: HarnessLootReward
    x: number
    z: number
    age: number
    arriveAt: number | null
  }
  const groundLoot: GroundLoot[] = []
  const dropLoot = (reward: HarnessLootReward | null, at: PlanPoint): void => {
    if (!reward) return
    sustainMetrics.lootDrops += 1
    groundLoot.push({ reward, x: at.x, z: at.z, age: 0, arriveAt: null })
  }
  /** `applyLootReward`. */
  const collectLoot = (reward: HarnessLootReward): void => {
    if (reward.kind === 'coins') earnGold(reward.amount, 'loot')
    else if (reward.kind === 'medicine') {
      if (player.health >= player.maxHealth) earnGold(Math.ceil(reward.amount / 2), 'loot')
      else heal(reward.amount, 'loot')
    } else {
      const usable = Math.min(reward.amount, Math.max(0, HARNESS_LOOT_DAMAGE_CAP - player.damage))
      player.damage += usable
      earnGold((reward.amount - usable) * 25, 'loot')
    }
  }
  const updateLoot = (): void => {
    for (let index = groundLoot.length - 1; index >= 0; index -= 1) {
      const token = groundLoot[index]
      token.age += delta
      if (token.arriveAt === null && token.age >= HARNESS_LOOT_BURST_TIME) {
        const away = Math.hypot(token.x - player.x, token.z - player.z)
        if (away <= HARNESS_LOOT_MAGNET_RADIUS || token.age >= HARNESS_LOOT_FORCE_MAGNET_AGE) {
          token.arriveAt = elapsed + away / HARNESS_LOOT_MAGNET_SPEED
        }
      }
      if (token.arriveAt !== null && elapsed >= token.arriveAt && player.health > 0) {
        groundLoot.splice(index, 1)
        collectLoot(token.reward)
      }
    }
  }

  // --- W1-5: healers, traders, treasure ------------------------------------------

  interface ServiceSite {
    id: string
    kind: 'recovery' | 'shop' | 'treasure'
    regionId: string
    x: number
    z: number
    settlement: boolean
  }
  const services: ServiceSite[] = []
  for (const site of blueprint.sites) {
    if (site.kind !== 'recovery' && site.kind !== 'shop' && site.kind !== 'treasure') continue
    const position = getSiteWorldPosition2D(blueprint, site)
    if (!position) continue
    services.push({
      id: site.id,
      kind: site.kind,
      regionId: String(site.regionId),
      x: position.x,
      z: position.z,
      settlement: isSettlementSite(site),
    })
  }
  const serviceCooldown = new Map<string, number>()
  const collectedSiteIds = new Set<string>()
  const MEDICINE = SHOP_ITEMS.find((item) => item.id === 'medicine') as ShopItem
  const LEG = SHOP_ITEMS.find((item) => item.id === 'leg') as ShopItem
  const ARM = SHOP_ITEMS.find((item) => item.id === 'arm') as ShopItem
  const NO_UPGRADES = { blade: 0, vitality: 0, endurance: 0 }
  const serviceRazed = (site: ServiceSite): boolean =>
    site.settlement && isRegionRazed(chronicleRegions.get(site.regionId))
  /** `getShopItemPrice` at the square's supply, or flat under «Интендантский устав». */
  const priceAt = (site: ServiceSite, item: ShopItem): number =>
    getShopItemPrice(
      item,
      NO_UPGRADES,
      doctrineEffects.tradeOnlyCare ? 1 : getSupplyPriceMultiplier(chronicleRegions.get(site.regionId)),
    )
  const needsCare = (): boolean =>
    player.health < player.maxHealth * HARNESS_HEAL_HEALTH || player.bleeding > 0 || hasWounds()
  const wantsTrader = (site: ServiceSite): boolean =>
    (needsCare() && player.gold >= priceAt(site, MEDICINE)) ||
    (missingPlayerLegs(player.body) > 0 && player.gold >= priceAt(site, LEG))
  /**
   * The service the scripted player would leave the road for right now, if any: the nearest
   * healer or trader when hurt, otherwise the nearest unclaimed treasure.
   */
  const chooseService = (): ServiceSite | null => {
    if (!sustainOn || policy === 'idle') return null
    let best: ServiceSite | null = null
    let bestDistance = HARNESS_SERVICE_DETOUR
    let bestCare = false
    for (const site of services) {
      if ((serviceCooldown.get(site.id) ?? -1) > elapsed) continue
      const care =
        site.kind === 'recovery'
          ? needsCare() && !serviceRazed(site)
          : site.kind === 'shop'
            ? wantsTrader(site) && !serviceRazed(site)
            : false
      const treasure = site.kind === 'treasure' && !collectedSiteIds.has(site.id)
      if (!care && !treasure) continue
      const away = Math.hypot(site.x - player.x, site.z - player.z)
      if (away > HARNESS_SERVICE_DETOUR) continue
      // Care outranks treasure; within a rank, the nearer wins.
      if (bestCare && !care) continue
      if (care === bestCare && away >= bestDistance) continue
      best = site
      bestDistance = away
      bestCare = care
    }
    return best
  }
  /** `findNearbySite(…, 6)`: the closest site of any kind within reach. */
  const nearbySite = (): { id: string; kind: ServiceSite['kind'] | string; x: number; z: number } | null => {
    let best: { id: string; kind: string; x: number; z: number } | null = null
    let bestDistance = HARNESS_SITE_REACH
    for (const site of blueprint.sites) {
      const position = getSiteWorldPosition2D(blueprint, site)
      if (!position) continue
      const away = Math.hypot(position.x - player.x, position.z - player.z)
      if (away > bestDistance) continue
      bestDistance = away
      best = { id: site.id, kind: site.kind, x: position.x, z: position.z }
    }
    return best
  }
  /**
   * One press of `E` at a healer, trader or treasure: `handleGeneratedInteraction`'s three
   * service branches. The trader's window pauses the game, so everything bought in one
   * visit is bought in one press.
   */
  const visitService = (site: ServiceSite): void => {
    if (site.kind === 'recovery') {
      if (serviceRazed(site)) return
      sustainMetrics.healerVisits += 1
      heal(HARNESS_HEALER_HEAL, 'healer')
      if (healingOn) player.stamina = player.maxStamina
      stopBleeding('all')
      healWounds()
      return
    }
    if (site.kind === 'shop') {
      if (serviceRazed(site)) return
      sustainMetrics.traderVisits += 1
      const medicine = priceAt(site, MEDICINE)
      if (
        (player.health < player.maxHealth || player.bleeding > 0 || hasWounds()) &&
        player.gold >= medicine
      ) {
        spendGold(medicine, 'medicine')
        heal(HARNESS_MEDICINE_HEAL, 'medicine')
        stopBleeding('all')
        healWounds()
      }
      for (const [item, parts] of [
        [LEG, ['leftLeg', 'rightLeg']],
        [ARM, ['leftArm', 'rightArm']],
      ] as const) {
        const missing = parts.find((part) => player.body[part] === 'missing')
        const price = priceAt(site, item)
        if (!missing || player.gold < price) continue
        spendGold(price, 'prosthesis')
        sustainMetrics.prostheses += 1
        if (healingOn) player.body[missing] = 'prosthetic'
      }
      return
    }
    if (collectedSiteIds.has(site.id)) return
    collectedSiteIds.add(site.id)
    sustainMetrics.treasureClaimed += 1
    earnGold(rollTreasure(lootRng), 'treasure')
  }

  // --- W1-5: the director's fights ------------------------------------------------

  interface LiveEvent {
    id: string
    plan: EventPlan
    system: 'randomEvent' | 'contractEvent' | 'locatedEvent'
    /** Per spawn: the actor it became. Kept after the budget takes it off the field. */
    actors: HarnessActor[]
    /** Per spawn: the actor's id, for the bookkeeping that only needs a name. */
    actorIds: Array<string | null>
    /** Per spawn: handed over to the player (the rescued captive). */
    released: boolean[]
    state: 'active' | 'succeeded' | 'failed'
    timer: number | null
    robbed: boolean
    robberyPoint: PlanPoint | null
    cart: (PlanPoint & { direction: number }) | null
    contractNodeId: string | null
    situation: PendingMaterialization | null
    /** The player struck one of its actors or used its prop. */
    playerTouched: boolean
    /** W1-1 — `elapsed` at the last blow traded between the player and one of its actors. */
    playerExchangeAt: number | null
    /** W1-1 — the player acted on it: robbed its cart, cut its captive loose. */
    playerInteracted: boolean
    /** W1-2 — a chronicle ambush's cart: the claim, and whether its raiders took it. */
    loot: AmbushLoot | null
  }
  const activeEvents: LiveEvent[] = []
  const eventProps = new Map<string, EventProp>()
  let eventSequence = 0
  let eventCooldown = HARNESS_FIRST_EVENT_AT
  let liveMaterializeCooldown = HARNESS_MATERIALIZE_INTERVAL
  const liveSituationIds = new Set<string>()
  const liveSeenAftermath = new Set<string>()
  let activeContractNodeId: string | null = null
  let nextThreatWaveAt = HARNESS_THREAT_WAVE_FIRST_AT
  /** Why each contract last stalled on its site: the only reasons that spend start grace. */
  const contractStall = new Map<string, 'crowded' | 'noGround'>()
  /** Whether a random event was up on the contract's last stalled frame. */
  const contractStallWithEvent = new Map<string, boolean>()
  const caravanPatrol: CaravanPatrol = planCaravanPatrol(
    blueprint,
    options.faction,
    terrain.bounds,
    start,
  )
  const eventWorld = (): EventWorld => ({
    blueprint,
    faction: options.faction,
    rng: fightRng,
    player: { x: player.x, z: player.z },
    bounds: terrain.bounds,
    isWalkable: (x, z, radius) => collision.isWalkablePosition(x, z, radius),
    caravanTravelDirection: caravanPatrol.direction,
  })
  const playerAnchoredEvent = (): LiveEvent | null =>
    activeEvents.find((event) => event.plan.anchor === 'player') ?? null
  const locatedEventsLive = (): LiveEvent[] =>
    activeEvents.filter((event) => event.plan.anchor === 'located')
  const actorById = (id: string | null): HarnessActor | undefined =>
    id === null ? undefined : actors.find((actor) => actor.id === id)
  /**
   * The builders read their bodies two ways, and the harness keeps both: through
   * `actors.find`, where a body the budget took off the field is simply gone, and through
   * the closure that spawned it, where that body is still standing where it was.
   */
  const onField = (actor: HarnessActor | undefined): boolean =>
    actor !== undefined && actors.includes(actor)
  const eventView = (live: LiveEvent) => ({
    alive: live.actors.map((actor) => onField(actor) && actor.alive),
    dead: live.actors.map((actor) => onField(actor) && !actor.alive),
    released: live.released,
    propHp: eventProps.get(live.id)?.hp ?? null,
    robbed: live.robbed,
    robberyPoint: live.robberyPoint,
    plundered: live.loot?.plundered ?? false,
    player: { x: player.x, z: player.z },
  })
  const markerOf = (live: LiveEvent): PlanPoint => {
    if (live.robberyPoint) return live.robberyPoint
    if (live.cart) return live.cart
    const lead = live.plan.spawns.findIndex(
      (entry) => entry.part === 'champion' || entry.part === 'target' || entry.part === 'captive',
    )
    const actor = lead >= 0 ? live.actors[lead] : undefined
    return actor ? { x: actor.x, z: actor.z } : live.plan.marker
  }

  /** Puts a planned event's bodies on the ground, exactly as the builder lists them. */
  const startPlannedEvent = (
    plan: EventPlan,
    system: LiveEvent['system'],
    situation: PendingMaterialization | null,
  ): LiveEvent => {
    eventSequence += 1
    const id = `event-${plan.kind}-${eventSequence}`
    const live: LiveEvent = {
      id,
      plan,
      system,
      actors: [],
      actorIds: [],
      released: plan.spawns.map(() => false),
      state: 'active',
      timer: plan.timer,
      robbed: false,
      robberyPoint: null,
      cart: plan.cart ? { ...plan.cart } : null,
      contractNodeId: null,
      situation,
      playerTouched: false,
      playerExchangeAt: null,
      playerInteracted: false,
      loot:
        plan.kind === 'caravanAmbush'
          ? createAmbushLoot(plan.spawns.filter((entry) => entry.part === 'escort').length)
          : null,
    }
    if (plan.prop) eventProps.set(id, { ...plan.prop })
    let captiveId: string | null = null
    for (const entry of plan.spawns) {
      const actor = spawnEngineActor({
        allegiance: entry.allegiance,
        role: entry.role,
        x: entry.x,
        z: entry.z,
        system,
        budget: 'chronicle',
        eventOwnerId: id,
        aiMode: entry.aiMode,
        propOwnerId: entry.targetsProp ? id : null,
        ignoredTargetId: entry.ignoresCaptive ? captiveId : null,
        packId: entry.pack ? `${id}-pack` : null,
        packKinSize: entry.packKinSize,
      })
      if (entry.part === 'captive') captiveId = actor.id
      if (entry.aggroIfHostile) actor.playerAggro = actor.hostileToPlayer
      live.actors.push(actor)
      live.actorIds.push(actor.id)
    }
    activeEvents.push(live)
    return live
  }

  /** `releaseEvent`: every owned body goes with the event, standing or not. */
  const releaseEvent = (live: LiveEvent): void => {
    live.actors.forEach((actor, index) => {
      if (!live.released[index]) removeActor(actor.id)
    })
    eventProps.delete(live.id)
    const index = activeEvents.indexOf(live)
    if (index >= 0) activeEvents.splice(index, 1)
    if (live.situation) liveSituationIds.delete(live.situation.id)
  }

  const aliveShare = (live: LiveEvent, part: string): number => {
    let total = 0
    let alive = 0
    live.plan.spawns.forEach((entry, index) => {
      if (entry.part !== part) return
      total += 1
      const actor = live.actors[index]
      if (onField(actor) && actor.alive) alive += 1
    })
    return alive / Math.max(1, total)
  }
  /** The ids a builder kept for one part of its spawn list (`escortIds`, `raiderIds`). */
  const partIds = (live: LiveEvent, part: string): string[] => {
    const ids: string[] = []
    live.plan.spawns.forEach((entry, index) => {
      const id = live.actorIds[index]
      if (entry.part === part && id) ids.push(id)
    })
    return ids
  }

  /** The located builders' `handBack`: the chronicle writes down who won. */
  const handBack = (live: LiveEvent): void => {
    const situation = live.situation
    if (!situation) return
    const idPrefix = `handback-${situation.id}-${chronicleState.tick}-${eventSequence}`
    switch (live.plan.kind) {
      case 'factionRaid':
        if (live.plan.attacker) {
          resolveMaterializedRaid({
            state: chronicleState,
            regions: chronicleRegions,
            rng: fightRng,
            protectedRegionIds,
            idPrefix,
            outcome: {
              regionId: situation.regionId,
              sourceRegionId: situation.sourceRegionId,
              siteId: situation.siteId,
              attacker: live.plan.attacker,
              attackerStrength: aliveShare(live, 'attacker'),
              defenderStrength: aliveShare(live, 'defender'),
            },
          })
        }
        return
      case 'caravanAmbush':
        resolveMaterializedCaravan({
          state: chronicleState,
          regions: chronicleRegions,
          idPrefix,
          outcome: {
            caravanId: situation.caravanId ?? '',
            regionId: situation.regionId,
            intact: !live.robbed && !live.loot?.plundered && aliveShare(live, 'escort') > 0,
          },
        })
        return
      case 'warband':
        if (situation.faction) {
          resolveMaterializedWarband({
            regions: chronicleRegions,
            outcome: {
              regionId: situation.regionId,
              faction: situation.faction,
              survivorShare: aliveShare(live, 'member'),
            },
          })
        }
        return
      case 'beastRaid': {
        const lost = (eventProps.get(live.id)?.hp ?? 1) <= 0
        resolveMaterializedBeastRaid({
          state: chronicleState,
          regions: chronicleRegions,
          rng: fightRng,
          idPrefix,
          outcome: {
            regionId: situation.regionId,
            siteId: situation.siteId,
            beastStrength: aliveShare(live, 'beast'),
            defenderStrength: lost ? 0 : aliveShare(live, 'defender'),
          },
        })
        return
      }
      default:
        return
    }
  }

  /** `dematerializeEvent`: a located fight handed back unfinished. */
  const dematerialize = (live: LiveEvent): void => {
    if (!activeEvents.includes(live)) return
    handBack(live)
    eventMetrics.locatedHandedBack += 1
    if (
      live.plan.kind === 'caravanAmbush' &&
      !live.robbed &&
      !live.loot?.plundered &&
      aliveShare(live, 'escort') > 0
    ) {
      caravanMetrics.escorted += live.playerTouched ? 1 : 0
      if (live.playerTouched) bump(caravanMetrics.escortedBy, 'ambushHeld')
    }
    releaseEvent(live)
  }

  // `yieldActorSlots`, now that a located fight can be handed back. W1-1 — the player's
  // contract is never the slot another spawn is paid for with: whoever asked retries.
  yieldSlots = (category, count) => {
    let freed = 0
    if (category === 'chronicle') {
      const byDistance = locatedEventsLive().sort(
        (left, right) =>
          Math.hypot(right.plan.marker.x - player.x, right.plan.marker.z - player.z) -
          Math.hypot(left.plan.marker.x - player.x, left.plan.marker.z - player.z),
      )
      for (const live of byDistance) {
        if (freed >= count) break
        if (live.contractNodeId) continue
        const owned = live.actors.filter((actor) => onField(actor)).length
        if (owned === 0) continue
        dematerialize(live)
        freed += owned
      }
    }
    const ranked = actors
      .filter((actor) => actor.budgetCategory === category)
      .sort((left, right) => yieldRank(left) - yieldRank(right))
    for (const actor of ranked) {
      if (freed >= count) break
      if (contractOwned(actor.id)) continue
      removeActor(actor.id)
      freed += 1
    }
    return freed
  }
  /** `isContractOwnedActor`: alive or dead, since a contract may count its own corpses. */
  const contractOwned = (actorId: string): boolean =>
    activeEvents.some((live) => live.contractNodeId !== null && live.actorIds.includes(actorId))

  /** `failContractForward`: the payout is gone, the node becomes an arrival. */
  const failContractForward = (
    node: FactionObjectiveNode,
    reason: 'expired' | 'abandoned' | 'lost',
  ): void => {
    if (!resolveContract(contracts, node.id, 'failed')) return
    if (activeContractNodeId === node.id) {
      const live = activeEvents.find((event) => event.contractNodeId === node.id)
      if (live && live.state === 'active') live.state = 'failed'
      activeContractNodeId = null
    }
    contractMetrics.failedForward += 1
    if (reason === 'abandoned') {
      // Since W1-1 only a genuine stall spends the start grace. A random event can still be
      // up while one runs out — when even its making way would not leave room — and that is
      // W1-1's symptom, so it is still counted as `lostToEvents`.
      contractBalance.abandoned += 1
      bump(contractBalance.abandonedBy, contractStall.get(node.id) ?? 'crowded')
      if (contractStallWithEvent.get(node.id)) contractBalance.lostToEvents += 1
    } else contractBalance.failed += 1
  }

  /** `resolveContractEvent`: a won contract pays and closes its node. */
  const resolveContractEvent = (live: LiveEvent, succeeded: boolean): void => {
    const nodeId = live.contractNodeId
    if (!nodeId) return
    if (activeContractNodeId === nodeId) activeContractNodeId = null
    const node = graph.nodes.find((candidate) => candidate.id === nodeId)
    const template = node ? findContractTemplate(node.contract) : null
    if (!node || !template) return
    if (!succeeded) {
      failContractForward(node, 'lost')
      return
    }
    if (!resolveContract(contracts, nodeId, 'kept')) return
    earnGold(template.reward, 'contract')
    contractMetrics.kept += 1
    contractBalance.kept += 1
    if (objectivePrerequisitesDone(node, objectives) && completeObjectiveEntry(objectives, node.id)) {
      settleSkips(node.id)
      finishObjective(node.id)
    }
  }

  const caravanOutcome = (live: LiveEvent, succeeded: boolean): void => {
    const kind = live.plan.kind
    if (kind !== 'richCaravan' && kind !== 'caravanAmbush') return
    const key = live.contractNodeId ? 'contract' : kind
    if (succeeded) {
      caravanMetrics.robbed += 1
      bump(caravanMetrics.robbedBy, key)
      return
    }
    caravanMetrics.lost += 1
    if (kind === 'richCaravan') bump(caravanMetrics.lostBy, live.robbed ? 'notAway' : 'drove')
    else if (live.loot?.plundered) {
      bump(caravanMetrics.lostBy, 'raiders')
      caravanMetrics.robberiesLostToNpcs += 1
    } else {
      // A contract's clock ran out on the ambush: nobody loaded the cart.
      bump(caravanMetrics.lostBy, 'expired')
    }
  }

  /** `finishEvent`: rewards, loot, the contract's half, then the bodies go. */
  const finishEvent = (live: LiveEvent, succeeded: boolean): void => {
    if (!activeEvents.includes(live)) return
    const kind = live.plan.kind
    const source = live.contractNodeId ? 'contractEvent' : live.system
    if (isRandomWorldEventKind(kind)) {
      if (live.system === 'randomEvent') {
        if (succeeded) eventMetrics.randomSucceeded += 1
        else eventMetrics.randomFailed += 1
      }
      if (succeeded) {
        earnGold(HARNESS_RANDOM_EVENT_REWARDS[kind], source)
        if (kind === 'defendHome') heal(HARNESS_DEFEND_HOME_HEAL, 'event')
        if (kind === 'champion') {
          const bonus = Math.min(
            HARNESS_CHAMPION_DAMAGE_STEP,
            Math.max(0, HARNESS_CHAMPION_DAMAGE_CAP - championDamageBonus),
          )
          championDamageBonus += bonus
          player.damage += bonus
        }
      }
    } else {
      if (live.system === 'locatedEvent') {
        if (succeeded) eventMetrics.locatedSucceeded += 1
        else eventMetrics.locatedFailed += 1
      }
      handBack(live)
      if (succeeded) {
        earnGold(HARNESS_LOCATED_EVENT_REWARDS[kind as ChronicleWorldEventKind], source)
      }
    }
    caravanOutcome(live, succeeded)
    if (succeeded && !live.playerTouched) eventMetrics.wonWithoutPlayer += 1
    if (succeeded && sustainOn) {
      // `spawnEventLoot`: legendary for a champion, where the fight stood when it was located.
      const legendary = kind === 'champion'
      const at =
        legendary || live.plan.anchor === 'located' ? markerOf(live) : { x: player.x, z: player.z }
      dropLoot(rollLoot(lootRng, legendary ? 'legendary' : 'uncommon', player.damage), at)
    }
    if (live.contractNodeId) resolveContractEvent(live, succeeded)
    releaseEvent(live)
    if (live.plan.anchor === 'player') {
      eventCooldown = rollEventCooldown(threatTier, fightRng.next())
    }
  }

  /**
   * `rescueCaptive`: the ropes come off and the captive is the player's. A captive the actor
   * budget already took off the field is still "rescued" — the engine's closure still holds
   * it — but there is nobody left to walk with the player, so nobody joins.
   */
  const rescueCaptive = (live: LiveEvent): void => {
    const index = live.plan.spawns.findIndex((entry) => entry.part === 'captive')
    const captive = live.actors[index]
    if (!captive?.alive || live.state !== 'active') return
    live.released[index] = true
    live.state = 'succeeded'
    if (!onField(captive)) return
    if (!squadOn) {
      // With the squad arm off nobody walks with the player, rescued or not: the captive
      // is freed and leaves, so the arm stays what it says it is.
      removeActor(captive.id)
      return
    }
    captive.eventOwnerId = null
    captive.aiMode = 'normal'
    captive.squadEligible = true
    captive.budgetCategory = 'squad'
    captive.system = 'squad'
    captive.inert = squadPolicy === 'decoy'
    captive.homeX = captive.x
    captive.homeZ = captive.z
    assignSquadSlot(captive)
    companionMetrics.recruited += 1
  }

  /** The builders' `onKill`, for a death anywhere on the field. */
  const eventsSawDeath = (victim: HarnessActor): void => {
    for (const live of [...activeEvents]) {
      if (live.state !== 'active') continue
      const index = live.actorIds.indexOf(victim.id)
      if (index < 0) continue
      const verdict = evaluateEventKill(live.plan, eventView(live), index)
      if (verdict === 'rescued') rescueCaptive(live)
      else if (verdict !== 'active') live.state = verdict
    }
  }

  /** The builders' `onInteract`, in event order: the first that accepts the press wins it. */
  const interactWithEvents = (): boolean => {
    for (const live of activeEvents) {
      if (live.state !== 'active') continue
      const kind = live.plan.kind
      if (kind === 'richCaravan' && live.cart && !live.robbed) {
        if (Math.hypot(live.cart.x - player.x, live.cart.z - player.z) >= HARNESS_CART_INTERACT_RANGE) {
          continue
        }
        live.robbed = true
        live.robberyPoint = { x: player.x, z: player.z }
        live.playerTouched = true
        live.playerInteracted = true
        return true
      }
      if (kind === 'rescue') {
        const index = live.plan.spawns.findIndex((entry) => entry.part === 'captive')
        const captive = live.actors[index]
        if (!captive || live.released[index]) continue
        if (Math.hypot(captive.x - player.x, captive.z - player.z) >= HARNESS_CAPTIVE_INTERACT_RANGE) {
          continue
        }
        live.playerTouched = true
        live.playerInteracted = true
        rescueCaptive(live)
        return true
      }
      if (kind === 'caravanAmbush' && live.cart && !live.robbed && !live.loot?.plundered) {
        if (Math.hypot(live.cart.x - player.x, live.cart.z - player.z) >= HARNESS_CART_INTERACT_RANGE) {
          continue
        }
        live.robbed = true
        if (live.loot) cancelCaravanLoot(live.loot.claim)
        live.playerTouched = true
        live.playerInteracted = true
        live.state = 'succeeded'
        return true
      }
    }
    return false
  }

  /** Each builder's `update`: the rich caravan drives, and every verdict is re-read. */
  const updateEventFrame = (live: LiveEvent): void => {
    if (live.plan.kind === 'richCaravan' && live.cart && !live.robbed) {
      const cart = live.cart
      const previousX = cart.x
      const previousZ = cart.z
      const moved = clampToBounds(
        {
          x: cart.x + caravanPatrol.direction.x * cart.direction * delta * HARNESS_RICH_CARAVAN_SPEED,
          z: cart.z + caravanPatrol.direction.z * cart.direction * delta * HARNESS_RICH_CARAVAN_SPEED,
        },
        terrain.bounds,
        3,
      )
      cart.x = moved.x
      cart.z = moved.z
      if (Math.abs(cart.x - previousX) < 0.0001 && Math.abs(cart.z - previousZ) < 0.0001) {
        cart.direction *= -1
      }
      live.plan.spawns.forEach((entry, index) => {
        const escort = live.actors[index]
        if (!escort?.alive || !entry.cartOffset) return
        escort.homeX = cart.x + entry.cartOffset.x
        escort.homeZ = cart.z + entry.cartOffset.z
      })
    }
    if (live.loot && live.cart && !live.robbed && !live.loot.plundered) {
      // W1-2 — the ambush's raiders take the cargo only by loading it at the cart.
      const cart = live.cart
      const raiderIds = partIds(live, 'raider')
      const { step, approach } = advanceAmbushLoot(live.loot, {
        delta,
        elapsed,
        cart,
        player,
        playerRobs: live.situation?.faction
          ? areAllegiancesHostile(options.faction, live.situation.faction)
          : true,
        bodies: actors,
        escortIds: partIds(live, 'escort'),
        raiderIds,
      })
      if (step.claimOpened) caravanMetrics.claimsOpened += 1
      if (step.started) caravanMetrics.lootsStarted += 1
      // `directCaravanRaiders`: idle raiders walk to the cart; during a claim they stand back.
      for (const raider of actors) {
        if (!raider.alive || !raiderIds.includes(raider.id) || raider.id === live.loot.claim.looterId) {
          continue
        }
        if (!approach) {
          raider.orderX = null
          raider.orderZ = null
          continue
        }
        const post = raiderApproachPoint(raider, cart)
        raider.orderX = post.x
        raider.orderZ = post.z
        raider.orderTimer = HARNESS_ORDER_DURATION
      }
    }
    const verdict = evaluateEventFrame(live.plan, eventView(live))
    if (verdict !== 'active') live.state = verdict
  }

  /** `chronicleCapacity`: chronicle slots a builder could take if the categories below yielded. */
  const chronicleCapacity = (): number => {
    actorBudget.sync(budgetUsage())
    return actorBudget.capacityFor('chronicle')
  }
  /**
   * `chronicleRoomOnceEventsMakeWay`: the scratch-ledger sum of what the interrupted random
   * event and every located fight that is not a contract would hand back, and, under W1-6's
   * staging, the player's own packs that could step back right now.
   */
  const roomOnceEventsMakeWay = (required: number, interrupted: LiveEvent | null): boolean => {
    const usage = budgetUsage()
    for (const live of [
      ...(interrupted ? [interrupted] : []),
      ...locatedEventsLive().filter((located) => located.contractNodeId === null),
    ]) {
      usage.chronicle -= actors.filter(
        (actor) => actor.budgetCategory === 'chronicle' && live.actorIds.includes(actor.id),
      ).length
    }
    if (stagingOn) {
      const packs = standAsidePacks()
      if (packs.length > 0) usage.campaign -= parkableBodies(harnessStagingViewer(player), packs)
    }
    const ledger = new ActorBudget()
    ledger.sync(usage)
    return ledger.capacityFor('chronicle') >= required
  }
  /** `isPlayerEngagedWith`, on the harness's own marker for the event. */
  const engagedWith = (live: LiveEvent): boolean => {
    const marker = markerOf(live)
    return playerEngagedWith({
      away: Math.hypot(marker.x - player.x, marker.z - player.z),
      interacted: live.playerInteracted,
      exchangeAt: live.playerExchangeAt,
      elapsed,
    })
  }
  /** `notePlayerExchange`: a blow between the player and an actor keeps its event engaged. */
  const notePlayerExchange = (actorId: string): void => {
    if (!eventsFought) return
    for (const live of activeEvents) {
      if (live.actorIds.includes(actorId)) live.playerExchangeAt = elapsed
    }
  }
  /**
   * `standDownRandomEvent`: the player reached their contract, so the game's own event goes
   * the way a save closes one — no payout, no failure, no stat, and the director's cooldown
   * floored without a draw.
   */
  const standDownRandomEvent = (live: LiveEvent): void => {
    releaseEvent(live)
    eventCooldown = Math.max(eventCooldown, eventCooldownRange(threatTier).min)
    eventMetrics.randomStoodDown += 1
  }
  /** `reclaimChronicleSlotsForContract`: located fights handed back, farthest first. */
  const reclaimChronicleSlotsForContract = (required: number): void => {
    const byDistance = locatedEventsLive().sort(
      (left, right) =>
        Math.hypot(right.plan.marker.x - player.x, right.plan.marker.z - player.z) -
        Math.hypot(left.plan.marker.x - player.x, left.plan.marker.z - player.z),
    )
    for (const live of byDistance) {
      if (chronicleCapacity() >= required) return
      if (live.contractNodeId) continue
      dematerialize(live)
      contractBalance.handedBackForContracts += 1
    }
  }

  /**
   * `startContractEvent` and `buildContractEvent`, as W1-1 left them: the game's own events
   * make way for the contract the player took on — a random event the player was merely
   * near stands down, located fights are handed back — unless another contract is on the
   * ground or the player is in the middle of that random event, which the contract waits
   * for. Only a genuine stall, no room or no ground, is a refusal. W1-6's staging adds the
   * player's own idle packs out of sight to what makes way.
   */
  const startContractEvent = (
    node: FactionObjectiveNode,
    template: FactionContractTemplate,
    site: PlanPoint,
  ): ContractStartOutcome => {
    const kind = template.eventKind
    const required = HARNESS_EVENT_REQUIRED_SLOTS[kind]
    const interrupted = playerAnchoredEvent()
    const gate = contractStartGate({
      contractRunning:
        activeContractNodeId !== null || activeEvents.some((live) => live.contractNodeId !== null),
      interrupted: interrupted
        ? { active: interrupted.state === 'active', engaged: engagedWith(interrupted) }
        : null,
      roomOnceEventsMakeWay: roomOnceEventsMakeWay(required, interrupted),
    })
    if (gate) return gate
    if (interrupted) standDownRandomEvent(interrupted)
    reclaimChronicleSlotsForContract(required)
    if (stagingOn) makeRoomForStaging('chronicle', required)
    let plan: EventPlan | null
    let situation: PendingMaterialization | null = null
    if (isRandomWorldEventKind(kind)) {
      plan = reserveSlots('chronicle', required) ? planRandomEvent(eventWorld(), kind, site) : null
    } else {
      situation = contractSituation(
        blueprint,
        options.faction,
        node,
        kind,
        chronicleRegions.get(String(node.regionId)),
      )
      plan = planLocatedEvent(eventWorld(), situation, () => reserveSlots('chronicle', required))
    }
    if (!plan) return chronicleCapacity() < required ? 'crowded' : 'noGround'
    const live = startPlannedEvent(plan, 'contractEvent', situation)
    live.contractNodeId = node.id
    live.timer = template.timeoutSeconds
    activeContractNodeId = node.id
    return 'started'
  }

  /** `updateContractNode`, one contract, one frame. */
  const updateContractFought = (
    node: FactionObjectiveNode,
    activeNodeId: string | null,
  ): void => {
    const template = findContractTemplate(node.contract)
    if (!template) return
    const objective = objectives.find((entry) => entry.id === node.id)
    if (!objective || objective.done || objective.skipped === true) return
    const progress = ensureContractProgress(contracts, node)
    if (!progress || !isContractLive(progress.status)) return
    const site = getSiteWorldPosition2D(blueprint, node.siteId)
    const onSite =
      site !== undefined &&
      Math.hypot(site.x - player.x, site.z - player.z) <= HARNESS_CONTRACT_TRIGGER_RADIUS
    // W1-1 — only a genuine inability to stage the contract spends its start grace. Standing
    // beside the arm the player did not take, a queue behind the contract already on the
    // ground and a random event of the game's own making are none of them that.
    let stalled: 'crowded' | 'noGround' | null = null
    if (
      progress.status === 'offered' &&
      onSite &&
      site &&
      objectivePrerequisitesDone(node, objectives) &&
      activeNodeId === node.id
    ) {
      const outcome = startContractEvent(node, template, site)
      if (outcome === 'started') {
        beginContract(contracts, node, template)
        contractMetrics.started += 1
        contractBalance.started += 1
        return
      }
      if (outcome === 'queued' || outcome === 'engaged' || outcome === 'settling') {
        // A wait is not a stall and not a departure: the grace is paused.
        bump(contractBalance.waitedSeconds, outcome, delta)
        return
      }
      stalled = outcome
      contractStall.set(node.id, outcome)
      const up = playerAnchoredEvent()
      contractStallWithEvent.set(node.id, up !== null && up.contractNodeId === null)
    }
    const tick = advanceContract(progress, template, delta, stalled !== null)
    if (tick.kind === 'expired' || tick.kind === 'abandoned') {
      failContractForward(node, tick.kind)
    }
  }

  /** `startRandomEvent`: a weighted draw over what the chronicle budget can afford. */
  const startRandomEvent = (): boolean => {
    const world = eventWorld()
    const eligible = RANDOM_WORLD_EVENT_KINDS.filter((kind) => {
      if (availableSlots('chronicle') < HARNESS_EVENT_REQUIRED_SLOTS[kind]) return false
      if (kind === 'defendHome') return pickDefendHomePosition(world) !== null
      return true
    })
    const selected = selectWeightedEventKind(
      eligible,
      (kind) => HARNESS_EVENT_WEIGHTS[options.faction][kind],
      eligible.length === 0 ? 0 : fightRng.next(),
    )
    if (!selected) return false
    if (!reserveSlots('chronicle', HARNESS_EVENT_REQUIRED_SLOTS[selected])) return false
    const plan = planRandomEvent(world, selected)
    if (!plan) return false
    startPlannedEvent(plan, 'randomEvent', null)
    bump(eventMetrics.randomStarted, selected)
    return true
  }

  /** `updateMaterialization`: one located fight per interval, two at most, never doubled up. */
  const updateLiveMaterialization = (): void => {
    liveMaterializeCooldown -= delta
    if (liveMaterializeCooldown > 0) return
    liveMaterializeCooldown = HARNESS_MATERIALIZE_INTERVAL
    if (locatedEventsLive().length >= HARNESS_MAX_LOCATED_EVENTS) return
    const pending = findPendingMaterializations({
      blueprint,
      regions: chronicleRegions,
      chronicle: chronicleState,
      simulatedRegionIds,
      protectedRegionIds,
      playerFaction: options.faction,
      seenAftermathRegionIds: liveSeenAftermath,
    })
    for (const situation of pending) {
      if (liveSituationIds.has(situation.id)) continue
      if (activeEvents.some((live) => live.plan.regionId === situation.regionId)) continue
      const plan = planLocatedEvent(eventWorld(), situation, () =>
        reserveSlots('chronicle', HARNESS_EVENT_REQUIRED_SLOTS[situation.kind]),
      )
      if (!plan) continue
      startPlannedEvent(plan, 'locatedEvent', situation)
      liveSituationIds.add(situation.id)
      if (situation.kind === 'aftermath') liveSeenAftermath.add(situation.regionId)
      bump(eventMetrics.locatedMaterialized, situation.kind)
      return
    }
  }

  /** `hasNearbyEvent`: a wave holds off while the player has a fight of their own. */
  const hasNearbyEvent = (radius: number): boolean =>
    activeEvents.some(
      (live) =>
        live.plan.anchor === 'player' ||
        Math.hypot(markerOf(live).x - player.x, markerOf(live).z - player.z) <= radius,
    )

  /** `spawnThreatWave`. */
  const spawnThreatWave = (): number => {
    const granted = reserveSlotsUpTo('campaign', Math.min(4, threatTier))
    const spawns = planThreatWave({
      faction: options.faction,
      tier: threatTier,
      granted,
      rng: directorRng,
      player: { x: player.x, z: player.z },
      bounds: terrain.bounds,
      isWalkable: (x, z, radius) => collision.isWalkablePosition(x, z, radius),
      radiusFor: actorRadius,
    })
    for (const entry of spawns) {
      const actor = spawnEngineActor({
        allegiance: entry.allegiance,
        role: entry.role,
        x: entry.x,
        z: entry.z,
        system: 'threatWave',
        budget: 'campaign',
      })
      actor.playerAggro = true
      actor.aggroMemory = HARNESS_AGGRO_MEMORY
      actor.lastKnownX = player.x
      actor.lastKnownZ = player.z
    }
    if (spawns.length > 0) {
      eventMetrics.threatWaves += 1
      eventMetrics.threatWaveActors += spawns.length
    }
    return spawns.length
  }

  /** `updateThreat`'s wave half: tier 2 and up, on the clock, unless a fight is near. */
  const updateThreatWaves = (): void => {
    if (
      threatTier < 2 ||
      doctrineEffects.threatWavesOnObjective ||
      elapsed < nextThreatWaveAt ||
      hasNearbyEvent(HARNESS_THREAT_WAVE_EVENT_RADIUS)
    ) {
      return
    }
    nextThreatWaveAt = elapsed + threatWaveInterval(threatTier)
    spawnThreatWave()
  }

  /** `updateEvents`: the builders' updates and clocks, materialization, then the director. */
  const updateEvents = (): void => {
    for (const live of [...activeEvents]) {
      if (live.state === 'active') {
        if (
          shouldHandBackForStreaming(
            {
              anchor: live.plan.anchor,
              state: live.state,
              timer: live.timer,
              regionId: live.plan.regionId,
            },
            (regionId) => regionId !== null && simulatedRegionIds.has(regionId),
          )
        ) {
          dematerialize(live)
          continue
        }
        updateEventFrame(live)
        if (live.state === 'active') {
          const direction = advanceEventTimer(
            {
              anchor: live.plan.anchor,
              state: live.state,
              timer: live.timer,
              regionId: live.plan.regionId,
            },
            delta,
          )
          if (direction) {
            live.timer = direction.timer
            if (direction.kind === 'handBack') {
              dematerialize(live)
              continue
            }
            if (direction.kind === 'expired') live.state = 'failed'
          }
        }
      }
      if (live.state !== 'active') finishEvent(live, live.state === 'succeeded')
    }
    updateLiveMaterialization()
    if (eventDirector === 'silent' || playerAnchoredEvent()) return
    eventCooldown = Math.max(0, eventCooldown - delta)
    if (eventCooldown > 0) return
    // W1-1 — the director keeps out of the player's contract, waiting as it waits when it
    // can afford nothing, and drawing nothing from the event stream while it does.
    const activeNode = resolveActiveObjectiveNode(
      blueprint,
      options.faction,
      objectives,
      contracts.pinnedNodeId,
    )
    const offeredSite =
      activeNode && getContractStatus(contracts, activeNode) === 'offered'
        ? getSiteWorldPosition2D(blueprint, activeNode.siteId)
        : undefined
    if (
      contractHoldsRandomEvents({
        contractRunning:
          activeContractNodeId !== null || activeEvents.some((live) => live.contractNodeId !== null),
        offeredContractDistance: offeredSite
          ? Math.hypot(offeredSite.x - player.x, offeredSite.z - player.z)
          : null,
      })
    ) {
      eventCooldown = HARNESS_EVENT_RETRY
      return
    }
    if (!startRandomEvent()) eventCooldown = HARNESS_EVENT_RETRY
  }

  // --- W1-5: the road caravan --------------------------------------------------------

  /**
   * `this.caravan` and its escort: `placeGeneratedCaravan`, `updateCaravan`,
   * `updateCaravanEscort`, `plunderCaravan`, `interact`'s robbery and the guard's aid. It
   * patrols a short beat out of the faction's first square, which is the only road cart a
   * run is guaranteed to pass. Since W1-2 nobody takes it by touching it: `claim` is the
   * engine's `ordinaryCaravanLootSite.claim`, run by `world/CaravanClaim.ts` itself.
   */
  const roadCart = {
    x: caravanPatrol.start.x,
    z: caravanPatrol.start.z,
    heading: 0,
    direction: 1,
    cooldown: 0,
    aidCooldown: 0,
    defenseCredit: false,
    panic: 0,
    escortIds: [] as string[],
    respawnAt: 0,
    claim: createCaravanClaimState() as CaravanClaimState,
  }
  const livingEscorts = (): HarnessActor[] =>
    actors.filter((actor) => actor.alive && roadCart.escortIds.includes(actor.id))
  const cartGuarded = (): boolean => roadCartGuarded(actors, roadCart.escortIds, roadCart)
  /** `nearestCaravanThreat`: anything hostile to the palace guard's cart, companions too. */
  const nearestCartThreat = (): HarnessActor | null => {
    let nearest: HarnessActor | null = null
    let best = HARNESS_CARAVAN_PANIC_RANGE
    for (const actor of actors) {
      if (!actor.alive || actor.routTimer > 0) continue
      if (roadCart.escortIds.includes(actor.id)) continue
      if (!areAllegiancesHostile(actor.allegiance, HARNESS_CARAVAN_ALLEGIANCE)) continue
      const away = Math.hypot(actor.x - roadCart.x, actor.z - roadCart.z)
      if (away >= best) continue
      best = away
      nearest = actor
    }
    return nearest
  }
  const spawnCartEscort = (): void => {
    if (reserveSlotsUpTo('ambient', 1) < 1) return
    const angle = roadCart.heading + (roadCart.escortIds.length ? 2.1 : -2.1)
    const at = clampToBounds(
      { x: roadCart.x + Math.sin(angle) * 2.6, z: roadCart.z + Math.cos(angle) * 2.6 },
      terrain.bounds,
      3,
    )
    if (!collision.isWalkablePosition(at.x, at.z, 1)) return
    const guard = spawnEngineActor({
      allegiance: HARNESS_CARAVAN_ALLEGIANCE,
      role: 'soldier',
      x: at.x,
      z: at.z,
      system: 'caravan',
      budget: 'ambient',
    })
    guard.homeX = roadCart.x
    guard.homeZ = roadCart.z
    roadCart.escortIds.push(guard.id)
  }
  /** `plunderCaravan`: escort down, a looter's channel run out, nobody paid. */
  const plunderCart = (looterId: string, kind: CaravanLooterKind): void => {
    roadCart.cooldown = HARNESS_CARAVAN_PLUNDER_COOLDOWN
    roadCart.defenseCredit = false
    caravanMetrics.lost += 1
    caravanMetrics.robberiesLostToNpcs += 1
    // W1-2 keeps the squad off the cargo; this stays counted so a regression would show.
    const looter = actorById(looterId)
    const bySquad = looter !== undefined && isSquadMember(looter, options.faction)
    if (bySquad) caravanMetrics.robbedBySquad += 1
    bump(caravanMetrics.lostBy, bySquad ? 'squadPlunder' : kind === 'beast' ? 'beastPlunder' : 'npcPlunder')
  }
  /** Every cart a looter can be at this frame: the road cart's claim and each ambush's. */
  const cartClaims = (): Array<{ claim: CaravanClaimState; escortIds: readonly string[]; road: boolean }> => {
    const claims = [{ claim: roadCart.claim, escortIds: roadCart.escortIds, road: true }]
    for (const live of activeEvents) {
      if (!live.loot) continue
      claims.push({ claim: live.loot.claim, escortIds: partIds(live, 'escort'), road: false })
    }
    return claims
  }
  /** `caravanLootCartFor`: the body is loading a cart, so it holds still at it. */
  const loadingCart = (actor: HarnessActor): boolean => {
    if (!eventsFought) return false
    if (roadCart.claim.looterId === actor.id) return true
    return activeEvents.some((live) => live.loot?.claim.looterId === actor.id)
  }
  /**
   * `noteCaravanLootHit`: any blow that lands on a looter makes it drop the load, whoever
   * swung, and the player's blow on an escort is remembered for the claim. A palace guard
   * who knocks a looter off the road cart has defended it.
   */
  const noteLootHit = (target: HarnessActor, landed: boolean, byPlayer: boolean): void => {
    if (!eventsFought || !landed) return
    for (const site of cartClaims()) {
      if (byPlayer && site.escortIds.includes(target.id)) noteCaravanEscortHit(site.claim, elapsed)
      if (!interruptCaravanLoot(site.claim, target.id) || !byPlayer) continue
      caravanMetrics.lootsBrokenByPlayer += 1
      if (site.road && options.faction === 'guard' && roadCart.cooldown <= 0) {
        creditCartDefense('guardInterrupt')
      }
    }
  }
  /** The guard's bounded caravan aid is earned: count the defence once per credit. */
  const creditCartDefense = (how: string): void => {
    if (!roadCart.defenseCredit) {
      caravanMetrics.escorted += 1
      bump(caravanMetrics.escortedBy, how)
    }
    roadCart.defenseCredit = true
  }
  const updateRoadCart = (): void => {
    roadCart.cooldown = Math.max(0, roadCart.cooldown - delta)
    roadCart.aidCooldown = Math.max(0, roadCart.aidCooldown - delta)
    roadCart.panic = Math.max(0, roadCart.panic - delta)
    const cartRegion = regionIdAt(roadCart.x, roadCart.z)
    const streaming = caravanPatrol.ready && cartRegion !== '' && simulatedRegionIds.has(cartRegion)
    const before = roadCart.escortIds.length
    roadCart.escortIds = roadCart.escortIds.filter((id) => actorById(id)?.alive === true)
    if (roadCart.escortIds.length < before) {
      roadCart.respawnAt = elapsed + HARNESS_CARAVAN_ESCORT_RESPAWN_DELAY
    }
    const escortFell = before > 0 && roadCart.escortIds.length === 0
    // `updateCaravanEscort` answers "panicking?" only for a cart it is simulating.
    let panicking = false
    if (
      !streaming ||
      Math.hypot(player.x - roadCart.x, player.z - roadCart.z) > HARNESS_CARAVAN_ESCORT_RANGE
    ) {
      for (const id of roadCart.escortIds) removeActor(id)
      roadCart.escortIds = []
      // Nobody loads a cart the world is not simulating, and a claim does not outlive the
      // fight it was won in.
      cancelCaravanLoot(roadCart.claim)
      roadCart.claim.claim = 0
      roadCart.claim.wasGuarded = false
    } else {
      if (
        roadCart.escortIds.length < HARNESS_CARAVAN_ESCORT_COUNT &&
        elapsed >= roadCart.respawnAt
      ) {
        spawnCartEscort()
      }
      for (const guard of livingEscorts()) {
        guard.homeX = roadCart.x
        guard.homeZ = roadCart.z
      }
      if (nearestCartThreat()) roadCart.panic = HARNESS_CARAVAN_PANIC_SECONDS
      const step = advanceRoadCartLoot(roadCart.claim, {
        delta,
        elapsed,
        cart: roadCart,
        player,
        faction: options.faction,
        escortIds: roadCart.escortIds,
        escortFell,
        empty: roadCart.cooldown > 0,
        bodies: actors,
        finaleOwned,
      })
      if (step.claimOpened) caravanMetrics.claimsOpened += 1
      if (step.started) caravanMetrics.lootsStarted += 1
      if (step.plundered) plunderCart(step.plundered.id, step.plundered.kind)
      panicking = roadCart.panic > 0
    }
    // A cart somebody is loading stands still: the looter has the oxen by the yoke.
    if (!streaming || roadCart.claim.looterId !== null) return
    let destination = roadCart.direction > 0 ? caravanPatrol.end : caravanPatrol.start
    if (Math.hypot(destination.x - roadCart.x, destination.z - roadCart.z) <= 1.1) {
      roadCart.direction *= -1
      destination = roadCart.direction > 0 ? caravanPatrol.end : caravanPatrol.start
    }
    const dx = destination.x - roadCart.x
    const dz = destination.z - roadCart.z
    const length = Math.hypot(dx, dz)
    if (length <= 0.001) return
    const speed =
      HARNESS_CARAVAN_SPEED * (panicking ? HARNESS_CARAVAN_PANIC_SPEED_MULTIPLIER : 1)
    const requested = Math.min(delta * speed, length)
    const moved = collision.resolveMovement(
      { x: roadCart.x, z: roadCart.z },
      { x: roadCart.x + (dx / length) * requested, z: roadCart.z + (dz / length) * requested },
      HARNESS_CARAVAN_RADIUS,
    )
    const travelled = Math.hypot(moved.x - roadCart.x, moved.z - roadCart.z)
    if (travelled < 0.0001 || (moved.blocked && travelled < requested * 0.2)) {
      roadCart.direction *= -1
    } else {
      roadCart.heading = Math.atan2(-(moved.z - roadCart.z), moved.x - roadCart.x)
    }
    roadCart.x = moved.x
    roadCart.z = moved.z
  }
  /** `interact`'s cart branch: the guard's aid, or everyone else's robbery. */
  const interactWithCart = (): boolean => {
    if (!eventsFought) return false
    if (Math.hypot(player.x - roadCart.x, player.z - roadCart.z) >= HARNESS_CART_INTERACT_RANGE) {
      return false
    }
    if (options.faction === 'guard') {
      if (
        roadCart.aidCooldown <= 0 &&
        roadCart.defenseCredit &&
        player.health < player.maxHealth
      ) {
        heal(Math.min(HARNESS_CARAVAN_DEFENSE_AID, player.maxHealth - player.health), 'caravanAid')
        roadCart.defenseCredit = false
        roadCart.aidCooldown = HARNESS_CARAVAN_DEFENSE_AID_COOLDOWN
        caravanMetrics.escorted += 1
        bump(caravanMetrics.escortedBy, 'guardAid')
      }
      return true
    }
    if (cartGuarded() || roadCart.cooldown > 0) return true
    earnGold(HARNESS_CARAVAN_ROBBERY_GOLD, 'caravan')
    roadCart.cooldown = HARNESS_CARAVAN_ROBBERY_COOLDOWN
    // W1-2 — the player got there first: whoever was loading is loading an empty cart.
    cancelCaravanLoot(roadCart.claim)
    caravanMetrics.robbed += 1
    bump(caravanMetrics.robbedBy, 'roadCart')
    // `spawnAmbush`: two of the palace's soldiers come for the thief.
    const granted = reserveSlotsUpTo('campaign', 2)
    for (const [index, [offsetX, offsetZ]] of [
      [-5, -4],
      [5, 4],
    ].entries()) {
      if (index >= granted) break
      spawnEngineActor({
        allegiance: 'guard',
        role: 'soldier',
        x: roadCart.x + offsetX,
        z: roadCart.z + offsetZ,
        system: 'ambush',
        budget: 'campaign',
      })
    }
    return true
  }

  // --- W1-5: the generator's own encounters ---------------------------------------

  const finaleIdentity = createFinaleIdentity(blueprint, options.faction)
  /** The shipped `FinaleDirector` state the boss is driven by, under shipped encounters. */
  const finaleState = createFinaleState(finaleIdentity)
  const finaleBossActorId = `generated:${finaleIdentity.bossId}`
  const finaleEscortActorIds = finaleIdentity.escortIds.map((id) => `generated:${id}`)
  const startRegionId = String(startSite.regionId)
  const encounterActivated = new Map<string, Set<string>>()
  const clearedEncounterIds = new Set<string>()
  const defeatedUniqueIds = new Set<string>()
  const uniqueSpawnIds = new Set<string>()
  const encounterSpawnIds = new Map<string, string[]>()
  let finaleDefeated = false
  /**
   * `refreshChronicleEncounterPlans` / `createChronicleBlueprintOverlay`: a square the
   * chronicle handed to someone else fields their people, not the generator's original
   * owners'.
   */
  const encounterPlanCache = new Map<string, GeneratedEncounterPlan[]>()
  const encounterPlansFor = (regionId: string): GeneratedEncounterPlan[] => {
    const control = chronicleRegions.get(regionId)?.control
    const key = `${regionId}:${control ?? ''}`
    const cached = encounterPlanCache.get(key)
    if (cached) return cached
    const slots = blueprint.encounters.filter((slot) => String(slot.regionId) === regionId)
    const region = blueprint.regions.find((candidate) => String(candidate.id) === regionId)
    const source =
      control === undefined || control === region?.territory
        ? blueprint
        : {
            ...blueprint,
            regions: blueprint.regions.map((candidate) =>
              String(candidate.id) === regionId ? { ...candidate, territory: control } : candidate,
            ),
            sites: blueprint.sites.map((site) =>
              String(site.regionId) === regionId &&
              site.kind !== 'faction-start' &&
              site.kind !== 'final-stronghold'
                ? { ...site, owner: control }
                : site,
            ),
          }
    const plans = slots.map((slot) => createGeneratedEncounterPlan(source, slot, options.faction))
    encounterPlanCache.set(key, plans)
    return plans
  }
  /** `spawnGeneratedRegionEncounters`, every frame, for every square that is streamed in. */
  const spawnShippedEncounters = (regionId: string): void => {
    const activated = encounterActivated.get(regionId)
    if (!activated) return
    const finalNode = graph.nodes.find((node) => node.id === graph.finalNodeId)
    const finalReady = finalNode ? objectivePrerequisitesDone(finalNode, objectives) : false
    const plans = [...encounterPlansFor(regionId)].sort(
      (left, right) =>
        Number(right.encounterId === finaleIdentity.encounterId) -
        Number(left.encounterId === finaleIdentity.encounterId),
    )
    for (const plan of plans) {
      encounterSpawnIds.set(plan.encounterId, plan.spawns.map((entry) => entry.id))
      for (const entry of plan.spawns) if (entry.unique) uniqueSpawnIds.add(entry.id)
      if (clearedEncounterIds.has(plan.encounterId)) continue
      if (regionId === startRegionId && plan.kind !== 'boss') continue
      const isFinal = plan.encounterId === finaleIdentity.encounterId
      if (isFinal && (!finalReady || finaleDefeated)) continue
      for (const entry of plan.spawns) {
        if (activated.has(entry.id)) continue
        if (actors.some((actor) => actor.id === `generated:${entry.id}`)) {
          activated.add(entry.id)
          continue
        }
        if ((entry.unique || isFinal) && defeatedUniqueIds.has(entry.id)) {
          activated.add(entry.id)
          continue
        }
        if (!reserveSlots('campaign', 1)) {
          if (!isFinal) encounterRefusedThisFrame = true
          return
        }
        const boss = isFinal && entry.id === finaleIdentity.bossId
        const profile = FINALE_PROFILES[options.faction]
        const actor = spawnEngineActor({
          allegiance: entry.faction,
          role: entry.role,
          x: entry.worldX,
          z: entry.worldZ,
          system: isFinal ? 'finale' : 'encounter',
          budget: 'campaign',
          hostileToPlayer: plan.hostileToPlayer,
          healthScale: 1 + Math.max(0, plan.difficulty - 1) * 0.12,
          encounterId: plan.encounterId,
          objectiveId: entry.objective && isFinal ? graph.finalNodeId : null,
          ...(boss
            ? {
                maxHp: Math.round(
                  profile.health *
                    enemyHealthMultiplier(
                      threatTier,
                      areAllegiancesHostile(options.faction, entry.faction),
                    ),
                ),
                speed: profile.speed[0],
              }
            : {}),
        })
        actor.id = `generated:${entry.id}`
        actor.playerAggro = plan.hostileToPlayer
        activated.add(entry.id)
        if (!isFinal) {
          encounterMetrics.actorsSpawned += 1
          if (!fieldedEncounterIds.has(plan.encounterId)) {
            fieldedEncounterIds.add(plan.encounterId)
            encounterMetrics.fielded += 1
          }
        }
      }
    }
  }
  /** `syncGeneratedRegions`' despawn half, for the bodies the shipped arms put down. */
  const streamOut = (regionId: string): void => {
    for (const actor of [...actors]) {
      if (actor.model !== 'engine' || actor.regionId !== regionId) continue
      if (squadOn && isSquadMember(actor, options.faction)) continue
      if (actor.encounterId === '' && actor.eventOwnerId !== null) continue
      removeActor(actor.id)
    }
    encounterActivated.delete(regionId)
    // W1-6 — a pack that stepped back leaves with its square, and comes back with it once.
    parkedSpawns.delete(regionId)
  }
  /** `recordGeneratedActorDeath`: uniques stay dead, an emptied encounter stays cleared. */
  const recordEncounterDeath = (actor: HarnessActor): void => {
    if (!shippedEncounters || actor.encounterId === '') return
    const spawnId = actor.id.startsWith('generated:') ? actor.id.slice('generated:'.length) : null
    const isFinal = actor.encounterId === finaleIdentity.encounterId
    if (spawnId && (isFinal || uniqueSpawnIds.has(spawnId))) defeatedUniqueIds.add(spawnId)
    if (actor.objectiveId && isFinal) {
      finaleDefeated = true
      finaleState.defeated = true
      finaleState.suspended = true
      finaleState.action = null
      for (const escort of [...actors]) {
        if (escort !== actor && finaleEscortActorIds.includes(escort.id)) removeActor(escort.id)
      }
      const node = graph.nodes.find((candidate) => candidate.id === actor.objectiveId)
      if (node && objectivePrerequisitesDone(node, objectives) && completeObjectiveEntry(objectives, node.id)) {
        settleSkips(node.id)
        finishObjective(node.id)
      }
    }
    const living = actors.some(
      (other) => other !== actor && other.alive && other.encounterId === actor.encounterId,
    )
    const activated = encounterActivated.get(actor.regionId)
    const spawnIds = encounterSpawnIds.get(actor.encounterId) ?? []
    // W1-6 — a pack that stepped back to make room was not beaten.
    const away = [...parkedSpawns.values()].some((parked) => spawnIds.some((id) => parked.has(id)))
    if (!living && !away && activated && spawnIds.every((id) => activated.has(id))) {
      clearedEncounterIds.add(actor.encounterId)
    }
  }

  // --- W1-6: the player's own packs make room for a staging ----------------------

  /** `parkedGeneratedSpawns`: spawns standing back from each square, still activated. */
  const parkedSpawns = new Map<string, Set<string>>()
  let parkHoldUntil = 0
  /** `stagingBody`: whether a body is idle, and whether it may go at all. */
  const stagingBody = (actor: HarnessActor): StagingBody => ({
    alive: actor.alive,
    hostileToPlayer: actor.hostileToPlayer,
    x: actor.x,
    z: actor.z,
    busy:
      actor.targetId !== null ||
      actor.actionPhase !== 'idle' ||
      actor.playerAggro ||
      actor.aggroMemory > 0 ||
      actor.routTimer > 0 ||
      actor.rageTimer > 0 ||
      actor.retaliationTimer > 0 ||
      actor.reaction !== 'none' ||
      actor.hp < actor.maxHp ||
      actor.orderX !== null ||
      loadingCart(actor),
    untouchable:
      actor.budgetCategory !== 'campaign' ||
      actor.squadSlot !== null ||
      actor.eventOwnerId !== null ||
      actor.role === 'commander' ||
      actor.system === 'finale' ||
      actor.objectiveId !== null ||
      uniqueSpawnIds.has(actor.id.slice('generated:'.length)),
  })
  /** `standAsidePacks`: the player's own packs in the simulated squares. */
  const standAsidePacks = (): StagingPack[] =>
    gatherStagingPacks(simulatedRegionIds, encounterPlansFor, (_regionId, encounterId) =>
      actors
        .filter(
          (actor) =>
            actor.model === 'engine' &&
            actor.id.startsWith('generated:') &&
            actor.encounterId === encounterId,
        )
        .map(stagingBody))
  /** `stagingRoom`: what `category` could take once everything below it but a contract yielded. */
  const stagingRoom = (category: ActorBudgetCategory): number => {
    const pinned: Record<ActorBudgetCategory, number> = { squad: 0, campaign: 0, chronicle: 0, ambient: 0 }
    for (const actor of actors) if (contractOwned(actor.id)) pinned[actor.budgetCategory] += 1
    return stagingCapacity(budgetUsage(), category, pinned)
  }
  /** `parkGeneratedPack`: the living step back, the unfielded with them, the fallen stay. */
  const parkPack = (pack: StagingPack): void => {
    const plan = encounterPlansFor(pack.regionId).find((candidate) => candidate.encounterId === pack.key)
    const activated = encounterActivated.get(pack.regionId)
    if (!plan || !activated) return
    let parked = parkedSpawns.get(pack.regionId)
    if (!parked) {
      parked = new Set()
      parkedSpawns.set(pack.regionId, parked)
    }
    for (const entry of plan.spawns) {
      const body = actors.find((actor) => actor.id === `generated:${entry.id}`)
      if (body) {
        if (!body.alive) continue
        removeActor(body.id)
        parked.add(entry.id)
      } else if (!activated.has(entry.id)) {
        activated.add(entry.id)
        parked.add(entry.id)
      }
    }
    encounterMetrics.packsSteppedBack += 1
  }
  /** `makeRoomForStaging`: as many of the player's own packs as the staging is short. */
  const makeRoomForStaging = (category: ActorBudgetCategory, count: number): boolean => {
    parkHoldUntil = Math.max(parkHoldUntil, elapsed + STAGING_PARK_HOLD_SECONDS)
    const shortfall = count - stagingRoom(category)
    if (shortfall <= 0) return true
    const packs = standAsidePacks()
    if (packs.length === 0) return false
    const chosen = choosePacksToPark(harnessStagingViewer(player), packs, shortfall)
    if (!chosen) return false
    for (const pack of chosen) parkPack(pack)
    return stagingRoom(category) >= count
  }
  /** `returnParkedPacks`: home, once nobody asks, the pack fits and nobody would see it. */
  const returnParkedPacks = (regionId: string): void => {
    const parked = parkedSpawns.get(regionId)
    if (!parked || parked.size === 0 || elapsed < parkHoldUntil) return
    const activated = encounterActivated.get(regionId)
    if (!activated) return
    const viewer = harnessStagingViewer(player)
    for (const plan of encounterPlansFor(regionId)) {
      const away = plan.spawns.filter((entry) => parked.has(entry.id))
      if (away.length === 0) continue
      if (!canReturnPack(viewer, away.map((entry) => ({ x: entry.worldX, z: entry.worldZ })))) continue
      if (availableSlots('campaign') < away.length) continue
      for (const entry of away) {
        parked.delete(entry.id)
        activated.delete(entry.id)
      }
      encounterMetrics.packsReturned += 1
    }
  }

  // --- W1-5: deaths, blows and the `E` key ---------------------------------------------

  /**
   * Everything a death means beyond the body falling: a companion lost, a kill's bounty and
   * loot, the guard's credit for defending the cart, the builders' `onKill`, and the
   * generator's own bookkeeping. `killer` is the player, an actor, or nobody (a stray arrow
   * whose shooter is already dead).
   */
  const handleDeath = (victim: HarnessActor, killer: 'player' | HarnessActor | null): void => {
    if (squadOn && victim.budgetCategory === 'squad' && victim.allegiance === options.faction) {
      companionMetrics.lost += 1
      bump(companionMetrics.lostTo, killer === 'player' ? 'player' : (killer?.role ?? 'unknown'))
    }
    if (
      killer !== 'player' &&
      killer !== null &&
      squadOn &&
      killer.budgetCategory === 'squad' &&
      killer.allegiance === options.faction
    ) {
      companionMetrics.kills += 1
    }
    if (
      killer === 'player' &&
      eventsFought &&
      options.faction === 'guard' &&
      areAllegiancesHostile(victim.allegiance, HARNESS_CARAVAN_ALLEGIANCE) &&
      Math.hypot(victim.x - roadCart.x, victim.z - roadCart.z) <= HARNESS_CARAVAN_DEFENSE_CREDIT_RANGE &&
      roadCart.cooldown <= 0
    ) {
      creditCartDefense('guardDefense')
    }
    recordEncounterDeath(victim)
    eventsSawDeath(victim)
    if (killer === 'player' && victim.allegiance !== 'civilian' && victim.eventOwnerId === null) {
      earnGold(killReward(victim.role), 'kills')
      if (sustainOn) dropLoot(rollKillLoot(lootRng, victim.role, player.damage), victim)
    }
  }

  /** `damageActor`'s player half: the struck remember, rage and shout. */
  const onPlayerStrike = (victim: HarnessActor): void => {
    victim.struckByPlayer = true
    notePlayerExchange(victim.id)
    if (victim.eventOwnerId) {
      const live = activeEvents.find((event) => event.id === victim.eventOwnerId)
      if (live) live.playerTouched = true
    }
    if (victim.model !== 'engine' || victim.aiMode === 'captive' || !victim.hostileToPlayer) return
    victim.playerAggro = true
    victim.aggroMemory = HARNESS_AGGRO_MEMORY
    victim.rageTimer = HARNESS_RAGE_SECONDS
    victim.lastKnownX = player.x
    victim.lastKnownZ = player.z
    if (victim.alertCooldown > 0) return
    victim.alertCooldown = HARNESS_ALERT_COOLDOWN
    for (const ally of actors) {
      if (
        ally === victim ||
        !ally.alive ||
        ally.model !== 'engine' ||
        ally.aiMode !== 'normal' ||
        !ally.hostileToPlayer ||
        ally.allegiance !== victim.allegiance ||
        Math.hypot(ally.x - victim.x, ally.z - victim.z) > HARNESS_ALERT_RADIUS
      ) {
        continue
      }
      ally.playerAggro = true
      ally.aggroMemory = Math.max(ally.aggroMemory, HARNESS_AGGRO_MEMORY)
      ally.lastKnownX = player.x
      ally.lastKnownZ = player.z
    }
  }

  /** What a hit on the player costs beyond the health: the wound roll, and who dealt it. */
  const onPlayerWounded = (actor: HarnessActor, canInjure: boolean): void => {
    lastAttackerSystem = actor.system
    bledOut = false
    if (sustainOn && canInjure && shouldInjurePlayer(combatRng.next(), player.health)) {
      injurePlayer()
    }
  }

  const eatRation = (): void => {
    player.supplies -= 1
    sustainMetrics.rationsEaten += 1
    heal(HARNESS_RATION_HEAL, 'ration')
    stopBleeding(HARNESS_RATION_BLEED_RELIEF)
  }

  /**
   * One press of `E`, in `interact`'s order: an event that accepts it, else
   * `chooseGeneratedInteraction`'s ration or service, else the road cart.
   */
  const pressInteract = (activeNode: FactionObjectiveNode | null): void => {
    if (eventsFought && interactWithEvents()) return
    const site = nearbySite()
    const service = site ? services.find((entry) => entry.id === site.id) : undefined
    const choice = chooseGeneratedInteraction({
      site: site ? { id: site.id, kind: site.kind as ServiceSite['kind'] } : null,
      objective: activeNode
        ? {
            siteId: activeNode.siteId,
            kind: activeNode.kind,
            liveContract:
              activeNode.contract !== undefined &&
              isContractLive(getContractStatus(contracts, activeNode)),
          }
        : null,
      sabotage: false,
      razed: service ? serviceRazed(service) : false,
      caravanDistance: eventsFought
        ? Math.hypot(player.x - roadCart.x, player.z - roadCart.z)
        : Number.POSITIVE_INFINITY,
      supplyCount: sustainOn ? player.supplies : 0,
      health: player.health,
      maxHealth: player.maxHealth,
      rationOnBleed: doctrineEffects.rationOnBleed,
    })
    if (choice.kind === 'ration') {
      eatRation()
      return
    }
    if (service && sustainOn && (choice.kind === 'recovery' || choice.kind === 'shop' || choice.kind === 'treasure')) {
      visitService(service)
      const keepHealing =
        service.kind === 'recovery' && healingOn && player.health < player.maxHealth
      if (!keepHealing) serviceCooldown.set(service.id, elapsed + HARNESS_SERVICE_COOLDOWN)
      return
    }
    if (site && choice.kind !== 'caravan' && choice.kind !== 'none') return
    interactWithCart()
  }

  interface W15Goal {
    point: PlanPoint
    actor: HarnessActor | null
    /** Press `E` once the player is this close to `point`. */
    pressWithin: number | null
  }

  /** The fight an event asks the player for: its interactable, or its nearest killable. */
  const engageEvent = (live: LiveEvent): W15Goal | null => {
    const kind = live.plan.kind
    if (kind === 'richCaravan' && live.cart) {
      if (!live.robbed) return { point: live.cart, actor: null, pressWithin: HARNESS_CART_INTERACT_RANGE - 0.5 }
      const from = live.robberyPoint ?? live.cart
      let awayX = player.x - from.x
      let awayZ = player.z - from.z
      const length = Math.hypot(awayX, awayZ)
      if (length < 0.5) {
        awayX = player.x - live.cart.x || 1
        awayZ = player.z - live.cart.z
      }
      const norm = Math.hypot(awayX, awayZ) || 1
      return {
        point: { x: from.x + (awayX / norm) * 25, z: from.z + (awayZ / norm) * 25 },
        actor: null,
        pressWithin: null,
      }
    }
    if (kind === 'caravanAmbush' && live.cart && !live.robbed) {
      return { point: live.cart, actor: null, pressWithin: HARNESS_CART_INTERACT_RANGE - 0.5 }
    }
    if (kind === 'rescue') {
      const index = live.plan.spawns.findIndex((entry) => entry.part === 'captive')
      const captive = live.actors[index]
      if (captive?.alive && !live.released[index]) {
        return {
          point: { x: captive.x, z: captive.z },
          actor: null,
          pressWithin: HARNESS_CAPTIVE_INTERACT_RANGE - 0.5,
        }
      }
      return null
    }
    const parts = eventKillParts(kind)
    let best: HarnessActor | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    live.plan.spawns.forEach((entry, index) => {
      if (!parts.includes(entry.part)) return
      const actor = live.actors[index]
      if (!actor?.alive || !actor.hostileToPlayer || !onField(actor)) return
      const away = Math.hypot(actor.x - player.x, actor.z - player.z)
      if (away >= bestDistance) return
      bestDistance = away
      best = actor
    })
    const target = best as HarnessActor | null
    return target ? { point: { x: target.x, z: target.z }, actor: target, pressWithin: null } : null
  }

  /**
   * Where the W1-5 arms send the scripted player this frame, ahead of the rumour and the
   * objective: a healer or trader when hurt, its contract's fight, then — under `engage` —
   * the nearest event and the road cart, then treasure. Null leaves the pre-W1-5 steering
   * exactly as it was.
   */
  const chooseGoal = (activeNode: FactionObjectiveNode | null): W15Goal | null => {
    if (policy === 'idle') return null
    const service = chooseService()
    if (service && service.kind !== 'treasure') {
      return { point: service, actor: null, pressWithin: HARNESS_SITE_REACH - 0.5 }
    }
    if (eventsFought) {
      if (contractOutcome === 'honour' && activeContractNodeId !== null && activeNode?.id === activeContractNodeId) {
        const live = activeEvents.find((event) => event.contractNodeId === activeContractNodeId)
        const goal = live ? engageEvent(live) : null
        if (goal) return goal
      }
      if (eventPolicy === 'engage') {
        let nearest: { live: LiveEvent; away: number } | null = null
        for (const live of activeEvents) {
          if (live.contractNodeId || live.state !== 'active') continue
          const marker = markerOf(live)
          const away = Math.hypot(marker.x - player.x, marker.z - player.z)
          if (live.plan.anchor === 'located' && away > HARNESS_EVENT_DETOUR) continue
          if (nearest && away >= nearest.away) continue
          nearest = { live, away }
        }
        const goal = nearest ? engageEvent(nearest.live) : null
        if (goal) return goal
        const toCart = Math.hypot(roadCart.x - player.x, roadCart.z - player.z)
        if (toCart <= HARNESS_EVENT_DETOUR) {
          if (options.faction === 'guard') {
            const threat = nearestCartThreat()
            if (threat?.hostileToPlayer) {
              return { point: { x: threat.x, z: threat.z }, actor: threat, pressWithin: null }
            }
            if (roadCart.defenseCredit && roadCart.aidCooldown <= 0 && player.health < player.maxHealth) {
              return { point: roadCart, actor: null, pressWithin: HARNESS_CART_INTERACT_RANGE - 0.5 }
            }
          } else if (roadCart.cooldown <= 0) {
            const escort = livingEscorts()
              .filter((guard) => guard.hostileToPlayer)
              .sort(
                (left, right) =>
                  Math.hypot(left.x - player.x, left.z - player.z) -
                  Math.hypot(right.x - player.x, right.z - player.z),
              )[0]
            if (escort && cartGuarded()) {
              return { point: { x: escort.x, z: escort.z }, actor: escort, pressWithin: null }
            }
            return { point: roadCart, actor: null, pressWithin: HARNESS_CART_INTERACT_RANGE - 0.5 }
          }
        }
      }
    }
    if (service) return { point: service, actor: null, pressWithin: HARNESS_SITE_REACH - 0.5 }
    return null
  }

  /** Whether this frame's sustain policy wants a ration eaten. */
  const wantsRation = (): boolean =>
    sustainOn &&
    player.supplies > 0 &&
    !doctrineEffects.rationOnBleed &&
    (player.health < player.maxHealth * HARNESS_RATION_HEALTH ||
      (player.bleeding >= HARNESS_RATION_BLEED && player.health < player.maxHealth))

  // --- W1-5: `updateActors` for the shipped arms' bodies ----------------------------

  interface HarnessProjectile {
    x: number
    z: number
    vx: number
    vz: number
    life: number
    damage: number
    allegiance: Allegiance
    sourceId: string
    /** A finale volley: straight, and hits by body radius plus `FINALE_PROJECTILE_RADIUS`. */
    finale: boolean
  }
  const projectiles: HarnessProjectile[] = []

  const isCompanion = (actor: HarnessActor): boolean =>
    actor.budgetCategory === 'squad' && actor.allegiance === options.faction
  /** `nearestThreatPosition`: the nearest thing at war with it, the player included. */
  const nearestThreatPoint = (actor: HarnessActor): PlanPoint => {
    let nearest: PlanPoint = { x: player.x, z: player.z }
    let best = actor.hostileToPlayer
      ? Math.hypot(actor.x - player.x, actor.z - player.z)
      : Number.POSITIVE_INFINITY
    for (const other of actors) {
      if (!other.alive || other === actor) continue
      if (!areAllegiancesHostile(actor.allegiance, other.allegiance)) continue
      const away = Math.hypot(actor.x - other.x, actor.z - other.z)
      if (away >= best) continue
      best = away
      nearest = { x: other.x, z: other.z }
    }
    return nearest
  }
  const moveBody = (
    actor: HarnessActor,
    targetX: number,
    targetZ: number,
    speed: number,
    limit = Number.POSITIVE_INFINITY,
  ): void => {
    const dx = targetX - actor.x
    const dz = targetZ - actor.z
    const length = Math.hypot(dx, dz)
    if (length < 0.001) return
    const step = Math.min(speed * delta, length, limit)
    const moved = collision.resolveMovement(
      { x: actor.x, z: actor.z },
      { x: actor.x + (dx / length) * step, z: actor.z + (dz / length) * step },
      actorRadius(actor.role),
    )
    actor.x = moved.x
    actor.z = moved.z
  }
  const cancelAction = (actor: HarnessActor): void => {
    actor.actionPhase = 'idle'
    actor.actionRemaining = 0
    actor.retreatTimer = 0
  }

  /** `damagePlayer` for an engine-model hand: armour, attribution, and the wound roll. */
  const strikePlayer = (actor: HarnessActor, baseDamage: number, canInjure: boolean): void => {
    // W1-1 — a blow at the player, landed or not, keeps them in the middle of its event.
    notePlayerExchange(actor.id)
    const hit = resolvePlayerDamage({
      baseDamage,
      health: player.health,
      shieldActive: false,
      hasIncomingDirection: true,
      incomingDotAim: 0,
      armor: playerArmor(options.faction),
    })
    if (!hit.applied) return
    player.health = Math.max(0, player.health - hit.dealt)
    record(damageTaken, actor.role, actor.allegiance, hit.dealt)
    bump(damageBySystem, actor.system, hit.dealt)
    lastAttackerCause = actor.allegiance === 'beast' ? 'beast' : 'faction'
    lastAttackerRole = actor.role
    onPlayerWounded(actor, canInjure)
  }

  /** `damageActor` between two actors: retaliation, a broken stance, and the death. */
  const strikeActor = (
    attacker: HarnessActor | null,
    target: HarnessActor,
    baseDamage: number,
    attackKind: 'allyMelee' | 'actorArrow',
  ): void => {
    if (!target.alive || finaleInactive(target)) return
    const hit = resolveActorDamage({ target, baseDamage, attackKind, facingDotToSource: null })
    target.hp = Math.max(0, target.hp - hit.dealt)
    if (attacker && squadOn && isCompanion(attacker)) companionMetrics.damageDealt += hit.dealt
    if (squadOn && isCompanion(target)) companionMetrics.damageTaken += hit.dealt
    if (
      attacker?.alive &&
      target.model === 'engine' &&
      target.aiMode !== 'captive' &&
      !isPacifistRole(target.role) &&
      areAllegiancesHostile(target.allegiance, attacker.allegiance)
    ) {
      target.targetId = attacker.id
      target.retaliationTimer = HARNESS_RETALIATION_SECONDS
    }
    if (applyDamageReaction(target, hit, attackKind) && target.model === 'engine') {
      cancelAction(target)
    }
    noteLootHit(target, hit.applied && hit.dealt > 0, false)
    if (hit.killed) {
      target.alive = false
      target.deathAt = elapsed
      handleDeath(target, attacker)
    }
  }

  const fireArrow = (actor: HarnessActor, aimX: number, aimZ: number): void => {
    const dx = aimX - actor.x
    const dz = aimZ - actor.z
    const length = Math.hypot(dx, dz) || 1
    projectiles.push({
      x: actor.x + (dx / length) * 0.85,
      z: actor.z + (dz / length) * 0.85,
      vx: (dx / length) * HARNESS_ARROW_SPEED,
      vz: (dz / length) * HARNESS_ARROW_SPEED,
      life: HARNESS_ARROW_LIFE,
      damage:
        (HARNESS_ARROW_DAMAGE + (actor.rageTimer > 0 ? HARNESS_RAGE_DAMAGE : 0)) *
        enemyDamageMultiplier(threatTier, actor.hostileToPlayer),
      allegiance: actor.allegiance,
      sourceId: actor.id,
      finale: false,
    })
  }

  /** Where a segment first enters a circle, as a fraction of its length; null if never. */
  const segmentEnters = (
    sx: number,
    sz: number,
    ex: number,
    ez: number,
    cx: number,
    cz: number,
    radius: number,
  ): number | null => {
    const dx = ex - sx
    const dz = ez - sz
    const fx = sx - cx
    const fz = sz - cz
    const c = fx * fx + fz * fz - radius * radius
    if (c <= 0) return 0
    const a = dx * dx + dz * dz
    if (a < 1e-12) return null
    const b = 2 * (fx * dx + fz * dz)
    const discriminant = b * b - 4 * a * c
    if (discriminant < 0) return null
    const t = (-b - Math.sqrt(discriminant)) / (2 * a)
    return t >= 0 && t <= 1 ? t : null
  }

  /**
   * `updateProjectiles` on the ground plane: an arrow hits the first body it reaches that
   * its side is at war with, and dies with its archer.
   */
  const stepProjectiles = (): void => {
    for (let index = projectiles.length - 1; index >= 0; index -= 1) {
      const arrow = projectiles[index]
      const source = actorById(arrow.sourceId)
      const step = Math.min(delta, Math.max(0, arrow.life))
      if (!source?.alive || step <= 0) {
        projectiles.splice(index, 1)
        continue
      }
      const endX = arrow.x + arrow.vx * step
      const endZ = arrow.z + arrow.vz * step
      arrow.life -= step
      let best: { fraction: number; actor: HarnessActor | null } | null = null
      if (source.hostileToPlayer && player.health > 0) {
        const radius = arrow.finale
          ? HARNESS_PLAYER_RADIUS + FINALE_PROJECTILE_RADIUS
          : HARNESS_ARROW_HIT_RADIUS
        const fraction = segmentEnters(arrow.x, arrow.z, endX, endZ, player.x, player.z, radius)
        if (fraction !== null) best = { fraction, actor: null }
      }
      for (const actor of actors) {
        if (!actor.alive || !areAllegiancesHostile(arrow.allegiance, actor.allegiance)) continue
        const radius = arrow.finale
          ? actorRadius(actor.role) + FINALE_PROJECTILE_RADIUS
          : actor.role === 'brute'
            ? HARNESS_ARROW_BRUTE_RADIUS
            : HARNESS_ARROW_HIT_RADIUS
        const fraction = segmentEnters(arrow.x, arrow.z, endX, endZ, actor.x, actor.z, radius)
        if (fraction === null || (best && fraction >= best.fraction)) continue
        best = { fraction, actor }
      }
      if (best) {
        projectiles.splice(index, 1)
        if (best.actor) strikeActor(source, best.actor, arrow.damage, 'actorArrow')
        else strikePlayer(source, arrow.damage, false)
        continue
      }
      arrow.x = endX
      arrow.z = endZ
      if (
        arrow.life <= 0 ||
        endX < terrain.bounds.minX - 4 ||
        endX > terrain.bounds.maxX + 4 ||
        endZ < terrain.bounds.minZ - 4 ||
        endZ > terrain.bounds.maxZ + 4
      ) {
        projectiles.splice(index, 1)
      }
    }
  }

  /** `startActorAction`. */
  const startAction = (
    actor: HarnessActor,
    kind: HarnessActor['actionKind'],
    targetIsPlayer: boolean,
    target: HarnessActor | null,
    aim: PlanPoint,
  ): void => {
    if (!actor.alive || actor.actionPhase !== 'idle' || actor.reaction === 'stagger') return
    const cooldownKind =
      kind === 'arrow' ? 'arrow' : kind === 'prop' ? 'eventProp' : targetIsPlayer ? 'meleePlayer' : 'meleeActor'
    actor.attackCooldown =
      actionCooldown(cooldownKind, actor.role) * (actor.rageTimer > 0 ? HARNESS_RAGE_COOLDOWN : 1)
    actor.actionPhase = 'windup'
    actor.actionRemaining = actionWindup(actor.role)
    actor.actionKind = kind
    actor.actionTargetIsPlayer = targetIsPlayer
    actor.actionTargetId = target?.id ?? null
    actor.actionAimX = aim.x
    actor.actionAimZ = aim.z
    actor.clearAttempted = false
    actor.telegraphHeavy =
      targetIsPlayer && kind === 'melee' && actionWindup(actor.role) >= HARNESS_HEAVY_WINDUP
    if (actor.telegraphHeavy) melee.telegraphedHeavies += 1
  }

  /** `resolveActorActionContact`: the swing lands on what is still in reach, or on air. */
  const resolveAction = (actor: HarnessActor, playerCommitted: boolean): void => {
    const rage = actor.rageTimer > 0 ? HARNESS_RAGE_DAMAGE : 0
    if (actor.actionKind === 'arrow') {
      const target = actorById(actor.actionTargetId)
      const live = actor.actionTargetIsPlayer
        ? player.health > 0 && actor.hostileToPlayer
          ? { x: player.x, z: player.z }
          : null
        : target?.alive && areAllegiancesHostile(actor.allegiance, target.allegiance)
          ? { x: target.x, z: target.z }
          : null
      fireArrow(actor, live?.x ?? actor.actionAimX, live?.z ?? actor.actionAimZ)
      return
    }
    if (actor.actionKind === 'prop') {
      const prop = actor.propOwnerId ? eventProps.get(actor.propOwnerId) : undefined
      if (
        prop &&
        prop.hp > 0 &&
        isWithinContact(Math.hypot(prop.x - actor.x, prop.z - actor.z), prop.attackRange)
      ) {
        prop.hp = Math.max(0, prop.hp - rollPropBite(actor.role, fightRng.next()))
      }
      return
    }
    if (actor.actionTargetIsPlayer) {
      const connected =
        player.health > 0 &&
        actor.hostileToPlayer &&
        isWithinContact(Math.hypot(player.x - actor.x, player.z - actor.z), 2.55)
      if (actor.telegraphHeavy && !connected) melee.telegraphedHeaviesAvoided += 1
      if (actor.clearAttempted && !connected) {
        melee.windupClears[actor.role] = (melee.windupClears[actor.role] ?? 0) + 1
      }
      if (connected && playerCommitted) melee.hitsWhileCommitted += 1
      if (connected) {
        const base = rollMeleeDamage(actor.role, 'player', () => combatRng.next())
        strikePlayer(actor, (base + rage) * enemyDamageMultiplier(threatTier, actor.hostileToPlayer), true)
      }
      return
    }
    const target = actorById(actor.actionTargetId)
    if (
      target?.alive &&
      areAllegiancesHostile(actor.allegiance, target.allegiance) &&
      isWithinContact(Math.hypot(target.x - actor.x, target.z - actor.z), 2.45)
    ) {
      const base = rollMeleeDamage(actor.role, 'actor', () => combatRng.next())
      strikeActor(actor, target, base + rage, 'allyMelee')
    }
  }

  /** `updateRoutingActor`: a beast runs from what broke it; a soldier back to its post. */
  const routBody = (actor: HarnessActor): void => {
    let awayX: number
    let awayZ: number
    if (isBeastRole(actor.role)) {
      const threat = nearestThreatPoint(actor)
      awayX = actor.x - threat.x
      awayZ = actor.z - threat.z
    } else {
      awayX = actor.homeX - actor.x
      awayZ = actor.homeZ - actor.z
      if (Math.hypot(awayX, awayZ) <= HARNESS_RALLY_TOLERANCE) {
        const threat = nearestThreatPoint(actor)
        awayX = actor.x - threat.x
        awayZ = actor.z - threat.z
        actor.routTimer = Math.min(actor.routTimer, HARNESS_LAST_STAND_SECONDS)
      }
    }
    const length = Math.hypot(awayX, awayZ)
    if (length < 0.0001) {
      awayX = 1
      awayZ = 0
    }
    moveBody(actor, actor.x + awayX * 10, actor.z + awayZ * 10, actor.speed * 1.15)
    if (
      isBeastRole(actor.role) &&
      Math.hypot(actor.x - player.x, actor.z - player.z) > BEAST_LEASH_RANGE
    ) {
      removeActor(actor.id)
    }
  }

  /** Close in on a target and swing, or — for an archer — keep the band and loose. */
  const engageTarget = (
    actor: HarnessActor,
    target: HarnessActor | null,
    speed: number,
  ): void => {
    const targetsPlayer = target === null
    const tx = target ? target.x : player.x
    const tz = target ? target.z : player.z
    const distance = Math.hypot(tx - actor.x, tz - actor.z)
    if (actor.role === 'archer') {
      if (distance < HARNESS_ARCHER_MIN_RANGE) {
        moveBody(actor, actor.x - (tx - actor.x), actor.z - (tz - actor.z), speed)
      } else if (distance > HARNESS_ARCHER_MAX_RANGE) {
        moveBody(actor, tx, tz, speed)
      }
      if (distance <= HARNESS_ARCHER_MAX_RANGE + 0.75 && actor.attackCooldown <= 0) {
        startAction(actor, 'arrow', targetsPlayer, target, { x: tx, z: tz })
      }
      return
    }
    if (actor.retreatTimer > 0) {
      moveBody(actor, actor.x - (tx - actor.x), actor.z - (tz - actor.z), speed)
      return
    }
    const stop = targetsPlayer ? 2.55 : 2.45
    if (distance > stop) moveBody(actor, tx, tz, speed)
    else if (actor.attackCooldown <= 0) startAction(actor, 'melee', targetsPlayer, target, { x: tx, z: tz })
  }

  // --- W1-5: the finale, through `FinaleDirector` -----------------------------------

  /** `finaleWithinArena`: the boss fights only while the player is in its ring. */
  const finaleWithinArena = (): boolean => {
    const boss = finaleState.boss
    return (
      !finaleState.defeated &&
      boss !== null &&
      player.health > 0 &&
      simulatedRegionIds.has(finaleIdentity.regionId) &&
      Math.hypot(player.x - finaleIdentity.arena.x, player.z - finaleIdentity.arena.z) <=
        FINALE_ENGAGE_RADIUS &&
      Math.hypot(player.x - boss.x, player.z - boss.z) <= FINALE_ENGAGE_RADIUS
    )
  }
  const finaleOwned = (actor: HarnessActor): boolean =>
    shippedEncounters &&
    (actor.id === finaleBossActorId || finaleEscortActorIds.includes(actor.id))
  /** `isInactiveFinaleActor`: out of its arena, a finale body can be neither hit nor chosen. */
  const finaleInactive = (actor: HarnessActor): boolean => finaleOwned(actor) && !finaleWithinArena()
  const captureBoss = (actor: HarnessActor): void => {
    captureFinaleBody(finaleState, finaleIdentity.bossId, {
      health: actor.hp,
      maxHealth: actor.maxHp,
      x: actor.x,
      z: actor.z,
      heading: 0,
      cooldown: actor.attackCooldown,
    })
  }
  /** `clearFinaleThreats`: the volleys in flight and the escorts' swings, gone. */
  const clearFinaleThreats = (): void => {
    for (let index = projectiles.length - 1; index >= 0; index -= 1) {
      if (projectiles[index].finale) projectiles.splice(index, 1)
    }
    for (const actor of actors) if (finaleEscortActorIds.includes(actor.id)) cancelAction(actor)
  }
  const moveBodyBy = (actor: HarnessActor, destination: FinalePoint, distance: number): void => {
    const away = Math.hypot(destination.x - actor.x, destination.z - actor.z)
    if (away < 0.05) return
    moveBody(actor, destination.x, destination.z, Number.POSITIVE_INFINITY, Math.min(distance, away))
  }
  /** `planFinaleCharge`: how far a charge can go before the ring or the ground stops it. */
  const planFinaleCharge = (actor: HarnessActor, action: FinaleAction): number => {
    const range = FINALE_ATTACKS[action.id].range
    const steps = Math.ceil(range / 0.1)
    let probe = { x: actor.x, z: actor.z }
    let reached = 0
    for (let index = 1; index <= steps; index += 1) {
      const along = (range * index) / steps
      const x = action.origin.x + action.direction.x * along
      const z = action.origin.z + action.direction.z * along
      if (Math.hypot(x - finaleIdentity.arena.x, z - finaleIdentity.arena.z) > FINALE_ARENA_RADIUS) break
      const moved = collision.resolveMovement(probe, { x, z }, actorRadius(actor.role))
      if (moved.blocked) break
      probe = { x: moved.x, z: moved.z }
      reached = along
    }
    return reached
  }
  /** `resolveFinaleContact`: a volley loosed, or the footprint's bodies struck once each. */
  const resolveFinaleContact = (
    actor: HarnessActor,
    action: FinaleAction,
    sweep?: { start: FinalePoint; end: FinalePoint },
  ): void => {
    if (!actor.alive || finaleState.defeated || !finaleWithinArena()) return
    const spec = FINALE_ATTACKS[action.id]
    const scale = enemyDamageMultiplier(threatTier, actor.hostileToPlayer)
    if (spec.speed > 0 && spec.shape !== 'charge') {
      for (const angle of spec.angles) {
        const dx = action.direction.x * Math.cos(angle) + action.direction.z * Math.sin(angle)
        const dz = action.direction.z * Math.cos(angle) - action.direction.x * Math.sin(angle)
        projectiles.push({
          x: action.origin.x,
          z: action.origin.z,
          vx: dx * spec.speed,
          vz: dz * spec.speed,
          life: spec.range / spec.speed,
          damage: spec.damage * scale,
          allegiance: actor.allegiance,
          sourceId: actor.id,
          finale: true,
        })
      }
      return
    }
    const hits = resolveFinaleContactTargets(
      action,
      [
        {
          id: 'player',
          x: player.x,
          z: player.z,
          radius: HARNESS_PLAYER_RADIUS,
          alive: player.health > 0,
          hostile: actor.hostileToPlayer,
        },
        ...actors.map((target) => ({
          id: target.id,
          x: target.x,
          z: target.z,
          radius: actorRadius(target.role),
          alive: target.alive,
          hostile: areAllegiancesHostile(actor.allegiance, target.allegiance),
        })),
      ],
      () => true,
      sweep,
    )
    for (const id of hits) {
      if (id === 'player') strikePlayer(actor, spec.damage * scale, true)
      else {
        const target = actorById(id)
        if (target?.alive) strikeActor(actor, target, spec.damage, 'allyMelee')
      }
    }
  }
  /**
   * `updateFinaleBoss`: `advanceFinale`'s intents carried out — tells, the signature
   * attacks' footprints, charges along their lane, volleys as projectiles. The tell is
   * mirrored onto the body's action so the duelist can read and answer it.
   */
  const stepFinaleBoss = (actor: HarnessActor): void => {
    captureBoss(actor)
    const active = finaleWithinArena()
    const choice = selectThreat(
      actor,
      actors,
      FINALE_ENGAGE_RADIUS,
      actorPoint,
      active
        ? {
            position: { x: player.x, y: 0, z: player.z },
            hpFraction: player.health / Math.max(1, player.maxHealth),
            provoked: true,
          }
        : null,
    )
    const target =
      choice === THREAT_PLAYER ? { x: player.x, z: player.z } : choice ? { x: choice.x, z: choice.z } : null
    const pending = finaleState.action
    if (
      pending?.stage === 'tell' &&
      Math.hypot(actor.x - pending.origin.x, actor.z - pending.origin.z) > 0.12
    ) {
      interruptFinale(finaleState)
    }
    if (actor.reaction === 'stagger') interruptFinale(finaleState)
    const body = finaleState.boss
    if (!body) return
    const intents = advanceFinale(
      finaleState,
      {
        body,
        active,
        target,
        canSeeTarget: target !== null,
        sourceHeight: 1.45,
        targetHeight: 1.45,
        interrupted: actor.reaction === 'stagger',
      },
      delta,
    )
    for (const intent of intents) {
      if (intent.kind === 'introduction' || intent.kind === 'transition') clearFinaleThreats()
      else if (intent.kind === 'tell') {
        const next = finaleState.action
        if (next && FINALE_ATTACKS[next.id].shape === 'charge') {
          next.travelLimit = planFinaleCharge(actor, next)
        }
      } else if (intent.kind === 'move') {
        if (actor.reaction !== 'stagger') moveBodyBy(actor, intent.destination, intent.distance)
      } else if (intent.kind === 'contact') resolveFinaleContact(actor, intent.action)
      else if (intent.kind === 'charge') {
        const start = { x: actor.x, z: actor.z }
        const direction = intent.action.direction
        const along =
          (start.x - intent.action.origin.x) * direction.x +
          (start.z - intent.action.origin.z) * direction.z
        const left = Math.max(0, intent.action.travelLimit - along)
        const distance = Math.min(intent.distance, left)
        const end = { x: start.x + direction.x * distance, z: start.z + direction.z * distance }
        const outside =
          Math.hypot(end.x - finaleIdentity.arena.x, end.z - finaleIdentity.arena.z) >
          FINALE_ARENA_RADIUS
        const moved = collision.resolveMovement(start, end, actorRadius(actor.role))
        if (!outside && !moved.blocked) {
          actor.x = moved.x
          actor.z = moved.z
        } else interruptFinale(finaleState)
        resolveFinaleContact(actor, intent.action, { start, end: { x: actor.x, z: actor.z } })
        if (distance >= left - 0.0001) interruptFinale(finaleState)
      }
    }
    captureBoss(actor)
    const tell = finaleState.action
    const shape = tell ? FINALE_ATTACKS[tell.id].shape : null
    actor.actionPhase = tell?.stage === 'tell' ? 'windup' : tell ? 'recovery' : 'idle'
    actor.actionRemaining = tell?.remaining ?? 0
    actor.actionKind = shape === 'fan' || shape === 'lane' ? 'arrow' : 'melee'
    actor.actionTargetIsPlayer = choice === THREAT_PLAYER
  }
  /** `updateFinaleEscort`'s waiting half: off the ring, or before the fight, hold the post. */
  const stepFinaleEscortWaiting = (actor: HarnessActor): boolean => {
    const index = finaleEscortActorIds.indexOf(actor.id)
    if (index < 0) return false
    const waiting =
      !finaleWithinArena() ||
      !finaleState.introduced ||
      finaleState.introRemaining > 0 ||
      finaleState.transitionRemaining > 0 ||
      finaleState.resumeRemaining > 0
    const outside =
      Math.hypot(actor.x - finaleIdentity.arena.x, actor.z - finaleIdentity.arena.z) >
      FINALE_ARENA_RADIUS
    if (!waiting && !outside) return false
    cancelAction(actor)
    actor.attackCooldown = Math.max(actor.attackCooldown, 0.65)
    if (actor.reaction !== 'stagger') {
      const post = finaleEscortPost(finaleState, index)
      moveBodyBy(actor, post, actor.speed * delta)
    }
    return true
  }

  /**
   * W1-6 — `updateCommander`'s call for men. Each commander's clock is made with his body,
   * so a commander the streamer fields again calls again, as the engine's fresh actor does.
   * The call takes his position's square and his side, and joins the road as one of the
   * encounter's bodies.
   */
  const commanderClocks = new WeakMap<HarnessActor, CommanderClock>()
  const stepCommander = (actor: HarnessActor): void => {
    let clock = commanderClocks.get(actor)
    if (!clock) {
      clock = createCommanderClock()
      commanderClocks.set(actor, clock)
    }
    const gathers = commanderGathers(
      commanderModel,
      actor,
      actors,
      actorPoint,
      (member) => member.actionPhase !== 'idle',
    )
    const category = actor.budgetCategory
    const called = advanceCommanderClock(clock, delta, gathers, () =>
      commanderModel === 'shipped' ? reserveOwnSlots(category, 1) : reserveSlots(category, 1))
    if (!called) return
    const angle = (clock.called - 1) * 1.9
    spawnEngineActor({
      allegiance: actor.allegiance,
      role: 'soldier',
      x: actor.x + Math.sin(angle) * 3.2,
      z: actor.z + Math.cos(angle) * 3.2,
      system: actor.system,
      budget: category,
      hostileToPlayer: actor.hostileToPlayer,
    })
    encounterMetrics.reinforcementsCalled += 1
  }

  /**
   * One `engine`-model body, one frame: `updateActors`' order — timers, stance, morale on
   * its own clock, the action in flight, stagger, ropes, the rout — then either the squad's
   * `selectSquadIntent` or the world's `selectThreat`, at the engine's own ranges.
   */
  const stepEngineActor = (actor: HarnessActor, playerCommitted: boolean): void => {
    advanceReaction(actor, delta)
    if (finaleOwned(actor)) {
      if (actor.id === finaleBossActorId) {
        stepFinaleBoss(actor)
        return
      }
      if (stepFinaleEscortWaiting(actor)) return
    }
    actor.attackCooldown = Math.max(0, actor.attackCooldown - delta)
    actor.aggroMemory = Math.max(0, actor.aggroMemory - delta)
    actor.rageTimer = Math.max(0, actor.rageTimer - delta)
    actor.alertCooldown = Math.max(0, actor.alertCooldown - delta)
    actor.retaliationTimer = Math.max(0, actor.retaliationTimer - delta)
    actor.retreatTimer = Math.max(0, actor.retreatTimer - delta)
    actor.routTimer = Math.max(0, actor.routTimer - delta)
    actor.rallyTimer = Math.max(0, actor.rallyTimer - delta)
    if (actor.orderX !== null) {
      actor.orderTimer -= delta
      if (actor.orderTimer <= 0) {
        actor.orderX = null
        actor.orderZ = null
      }
    }
    // W1-6 — where `updateActors` calls `updateCommander`: after the finale's own bodies,
    // before morale, and never while he is staggered.
    if (commanderModel !== 'inert' && actor.role === 'commander' && actor.reaction !== 'stagger') {
      stepCommander(actor)
    }

    actor.moraleTimer -= delta
    if (actor.moraleTimer <= 0) {
      actor.moraleTimer += HARNESS_MORALE_CHECK_INTERVAL
      if (actor.aiMode !== 'captive' && actor.rallyTimer <= 0 && actor.routTimer <= 0) {
        if (actor.routReason !== 'none') {
          actor.routReason = 'none'
          actor.rallyTimer = HARNESS_RALLY_SECONDS
        } else {
          const broke = evaluateMorale(actor.role, {
            hpFraction: actor.hp / Math.max(1, actor.maxHp),
            groupShare: localGroupShare(actor, actors, HARNESS_MORALE_RADIUS, actorPoint),
            packShare: beastPackShare(actor, actors, WOLF_PACK_RADIUS, actorPoint),
            commanderNearby: false,
            commanderLost: false,
            alarmDistance: Number.POSITIVE_INFINITY,
          })
          if (broke !== 'none' && !(doctrineEffects.beastTruce && broke !== 'panic')) {
            actor.routTimer = isBeastRole(actor.role) ? BEAST_ROUT_SECONDS : HARNESS_ROUT_SECONDS
            actor.routReason = broke
            cancelAction(actor)
            actor.targetId = null
            actor.playerAggro = false
            actor.aggroMemory = 0
            actor.lastKnownX = null
            actor.lastKnownZ = null
          }
        }
      }
    }

    if (actor.actionPhase !== 'idle') {
      actor.actionRemaining -= delta
      if (actor.actionRemaining > 0) return
      if (actor.actionPhase === 'windup') {
        resolveAction(actor, playerCommitted)
        if (!actor.alive || actor.reaction === 'stagger' || actor.actionPhase !== 'windup') return
        if (actor.role === 'scout') actor.retreatTimer = HARNESS_SCOUT_RETREAT
        actor.actionPhase = 'recovery'
        actor.actionRemaining = actionRecovery(actor.role)
      } else {
        actor.actionPhase = 'idle'
        actor.actionRemaining = 0
      }
      return
    }
    if (actor.reaction === 'stagger' || actor.aiMode === 'captive') return
    if (actor.routTimer > 0) {
      routBody(actor)
      return
    }
    // W1-2 — a looter at a cart is busy with the cargo, not the fight: it stays put and
    // keeps loading until a blow, a rout or an escort takes it off the job.
    if (loadingCart(actor)) return

    const playerDistance = Math.hypot(actor.x - player.x, actor.z - player.z)
    const enraged = actor.rageTimer > 0
    const rageSpeed = enraged ? HARNESS_RAGE_SPEED : 1

    if (squadOn && isSquadMember(actor, options.faction)) {
      actor.retaliationTimer = 0
      actor.targetId = null
      const intent = selectSquadIntent(
        actor,
        actors.filter((other) => !finaleInactive(other)),
        options.faction,
        squadState,
        { x: player.x, z: player.z },
        player.heading,
        actorPoint,
      )
      if (!intent) return
      if (intent.target && !actor.inert) {
        actor.targetId = intent.target.id
        engageTarget(actor, intent.target, actor.speed * rageSpeed)
        return
      }
      const destination = intent.destination
      const away = Math.hypot(destination.x - actor.x, destination.z - actor.z)
      if (away <= SQUAD_ARRIVAL_DISTANCE) return
      const speed = intent.catchUp ? getSquadFollowSpeed(actor.speed, playerDistance) : actor.speed
      moveBody(actor, destination.x, destination.z, speed, away)
      return
    }

    const beast = isBeastRole(actor.role)
    const senseRange =
      (beast ? BEAST_SENSE_RANGE : actor.role === 'archer' ? 18 : 15) +
      (enraged ? HARNESS_RAGE_RANGE : 0)
    const leashRange = beast ? BEAST_LEASH_RANGE : senseRange * 2.25
    const canSense = actor.hostileToPlayer && playerDistance < senseRange
    const canTrack = actor.hostileToPlayer && actor.playerAggro && playerDistance < leashRange
    if (canSense || canTrack) {
      actor.playerAggro = true
      actor.aggroMemory = HARNESS_AGGRO_MEMORY
      actor.lastKnownX = player.x
      actor.lastKnownZ = player.z
    }
    const pursuit = evaluatePlayerPursuit({
      hostileToPlayer: actor.hostileToPlayer,
      playerAggro: actor.playerAggro,
      aggroMemory: actor.aggroMemory,
      playerDistance,
      senseRange,
      leashRange,
    })
    if (!pursuit.shouldPursue) {
      actor.playerAggro = false
      actor.aggroMemory = 0
      actor.lastKnownX = null
      actor.lastKnownZ = null
    }

    if (actor.retaliationTimer > 0 && actor.targetId) {
      const candidate = actorById(actor.targetId)
      if (
        candidate?.alive &&
        candidate.id !== actor.ignoredTargetId &&
        areAllegiancesHostile(actor.allegiance, candidate.allegiance)
      ) {
        engageTarget(actor, candidate, actor.speed * 1.25 * rageSpeed)
        return
      }
      actor.retaliationTimer = 0
      actor.targetId = null
    }

    const prop =
      actor.aiMode === 'attackEventProp' && actor.propOwnerId
        ? eventProps.get(actor.propOwnerId)
        : undefined
    if (prop && prop.hp > 0 && !enraged) {
      actor.targetId = null
      actor.playerAggro = false
      const distance = Math.hypot(prop.x - actor.x, prop.z - actor.z)
      if (distance > prop.attackRange) moveBody(actor, prop.x, prop.z, actor.speed)
      else if (actor.attackCooldown <= 0) startAction(actor, 'prop', false, null, prop)
      return
    }

    const huntRadius = beast ? BEAST_SENSE_RANGE : actor.role === 'archer' ? 15 : 6.5
    const canHunt = actor.role !== 'commander' && (playerDistance < 32 || beast)
    const playerThreat =
      pursuit.shouldPursue && (pursuit.canSense || pursuit.canTrack)
        ? {
            position: { x: player.x, y: 0, z: player.z },
            hpFraction: player.maxHealth > 0 ? player.health / player.maxHealth : 1,
            provoked: actor.playerAggro,
          }
        : null
    const choice =
      canHunt || playerThreat
        ? selectThreat(actor, actors, canHunt ? huntRadius : 0, actorPoint, playerThreat)
        : null
    if (choice === THREAT_PLAYER) {
      actor.targetId = null
      engageTarget(actor, null, actor.speed * 1.25 * rageSpeed)
      return
    }
    if (choice) {
      actor.targetId = choice.id
      engageTarget(actor, choice, actor.speed * rageSpeed)
      return
    }
    actor.targetId = null
    if (pursuit.shouldPursue && actor.lastKnownX !== null && actor.lastKnownZ !== null) {
      const away = Math.hypot(actor.lastKnownX - actor.x, actor.lastKnownZ - actor.z)
      if (away > 0.75) moveBody(actor, actor.lastKnownX, actor.lastKnownZ, actor.speed * 1.25 * rageSpeed)
      return
    }
    // `moveToOrderPost`: a standing order beats wandering — the ambush raider sent to the
    // cart (W1-2). At its post it stands, where the engine would wander round `home`.
    if (actor.orderX !== null && actor.orderZ !== null) {
      const toPost = Math.hypot(actor.orderX - actor.x, actor.orderZ - actor.z)
      if (toPost > HARNESS_ORDER_TOLERANCE) {
        moveBody(actor, actor.orderX, actor.orderZ, actor.speed, toPost)
      }
      return
    }
    // A post to hold — a cart to walk beside, a site to stand on — stands in for both the
    // standing order and the wander round `home`.
    const fromHome = Math.hypot(actor.homeX - actor.x, actor.homeZ - actor.z)
    if (fromHome > 3.5) moveBody(actor, actor.homeX, actor.homeZ, actor.speed, fromHome)
  }

  /** The frame's opening: the tier, the loot on the ground, the clock's threat waves. */
  const w15FrameStart = (): void => {
    threatTier = getThreatTier(elapsed)
    if (threatTier > maxThreatTier) maxThreatTier = threatTier
    interactCooldown = Math.max(0, interactCooldown - delta)
    if (sustainOn) updateLoot()
    if (eventsFought) updateThreatWaves()
    if (shippedEncounters && finaleState.boss && !finaleWithinArena()) {
      suspendFinale(finaleState)
      clearFinaleThreats()
    }
  }

  /** The squares that just streamed in or out: the generator's encounters, and despawns. */
  const w15Streamed = (previous: ReadonlySet<string>): void => {
    for (const regionId of previous) {
      if (!simulatedRegionIds.has(regionId)) streamOut(regionId)
    }
    if (!shippedEncounters) return
    for (const regionId of simulatedRegionIds) {
      if (!encounterActivated.has(regionId)) encounterActivated.set(regionId, new Set())
    }
  }

  spawnStartingSquad()
  w15Streamed(new Set())

  // --- roadmap 1.3: where a rumour sends the player ---------------------------

  /**
   * The spot a rumour asks the scripted player to stand on.
   *
   * A sabotage points at the depot itself, because the torch needs the player within
   * `HARNESS_SABOTAGE_RANGE` of it. The other two point at the square's centre, which is
   * the same rule the engine's map pin follows.
   */
  const rumourTarget = (
    rumour: ChronicleRumour,
  ): { x: number; z: number } | null => {
    if (rumour.kind === 'sabotage' && rumour.siteId) {
      const site = getSiteWorldPosition2D(blueprint, rumour.siteId)
      if (site) return { x: site.x, z: site.z }
    }
    const region = terrain.getRegion(rumour.regionId)
    if (!region) return null
    return {
      x: (region.bounds.minX + region.bounds.maxX) / 2,
      z: (region.bounds.minZ + region.bounds.maxZ) / 2,
    }
  }

  /**
   * The rumour the policy is currently walking toward.
   *
   * `commit` follows the pin. `walk` — the placebo — follows the *first offered* rumour
   * without ever pinning it, so the two arms take the same detours and differ only in
   * whether a commitment exists. Both are capped by `HARNESS_RUMOUR_DETOUR`.
   */
  const steeringRumour = (): ChronicleRumour | null => {
    const candidate =
      rumourPolicy === 'commit'
        ? getPinnedRumour(commitments)
        : rumourPolicy === 'walk'
          ? (commitments.rumours.find((rumour) => withinDetour(rumour)) ?? null)
          : null
    if (!candidate) return null
    return withinDetour(candidate) ? candidate : null
  }

  /** True when the rumour is close enough to be worth leaving the road for. */
  const withinDetour = (rumour: ChronicleRumour): boolean => {
    const target = rumourTarget(rumour)
    if (!target) return false
    return Math.hypot(target.x - player.x, target.z - player.z) <= HARNESS_RUMOUR_DETOUR
  }

  /**
   * W1-5 — could the player have kept this rumour at all? The atlas's own road route from
   * where they stood when it was offered, at this kit's walk, against the time the board
   * gives it. Pure bookkeeping: no stream is read, so it runs in every rumour arm.
   */
  let expeditionGraph: ExpeditionGraph | null = null
  const measureFeasibility = (rumour: ChronicleRumour): void => {
    const target = rumourTarget(rumour)
    if (!target) return
    expeditionGraph ??= getExpeditionGraph(blueprint)
    const route = planExpeditionRoute(
      expeditionGraph,
      { x: player.x, z: player.z },
      target,
      { discoveredRegionIds: discoveredRegionIds, risks: new Map() },
      'shortest',
    )
    const metres =
      route.status === 'road'
        ? route.roadDistance + route.connectorDistance
        : route.status === 'arrived'
          ? 0
          : route.directDistance
    const eta = metres / walkSpeed()
    const remaining = (rumour.deadlineTick - chronicleState.tick) * CHRONICLE_TICK_SECONDS
    const slack = eta - remaining
    feasibility.offered += 1
    feasibility.slack.push(slack)
    if (slack > 0) feasibility.beyondReach += 1
  }

  /**
   * One tick of the commitment loop, in the engine's order: progress, settle, offer.
   * The functions are the shipped ones, not a re-implementation.
   */
  const advanceCommitments = (playerRegionId: string): ChronicleEvent[] => {
    if (rumourPolicy === 'off') return []
    const context = rumourContext()
    advanceRumourProgress(commitments, context, playerRegionId || null)
    const settlement = settleDueRumours(commitments, context, rumourRng)
    rumours.events += settlement.events.length
    for (const verdict of settlement.verdicts) {
      rumours.resolved += 1
      if (verdict.outcome === 'kept') rumours.kept += 1
      else {
        rumours.broken += 1
        if (verdict.committed) rumours.brokenWhileCommitted += 1
      }
    }
    const offered = offerRumours(commitments, context, rumourRng)
    if (offered) {
      rumours.offered += 1
      rumours.offeredByKind[offered.kind] =
        (rumours.offeredByKind[offered.kind] ?? 0) + 1
      measureFeasibility(offered)
    }
    if (rumourPolicy === 'commit' && getPinnedRumour(commitments) === null) {
      // Only pin what the policy is actually willing to walk to. A commitment the arm
      // never honours because it is half a map away would measure indifference, not a
      // decision.
      const next = commitments.rumours.find((rumour) => withinDetour(rumour))
      if (next && pinRumour(commitments, next.id)) rumours.pinned += 1
    }
    return settlement.events
  }

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
      encounterMetrics.fielded += 1
      const chronicle = chronicleRegions.get(regionId)
      const beastLed = (chronicle?.beastPressure ?? 0) > 0.55
      const count = Math.min(4, 2 + Math.floor(eventRng.next() * 3))
      for (let index = 0; index < count; index += 1) {
        if (actors.filter((actor) => actor.alive).length >= HARNESS_MAX_ACTORS) {
          encounterRefusedThisFrame = true
          break
        }
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
          hostileToPlayer:
            // Roadmap 1.6 — «Устав звериного перемирия», the other doctrine rule this
            // harness models. A beast under the truce simply is not the player's enemy, so
            // threat selection, morale and the damage tally all agree without a special case.
            doctrineEffects.beastTruce && isBeastRole(role)
              ? false
              : areAllegiancesHostile(options.faction, allegiance),
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
          firstHitAt: null,
          telegraphHeavy: false,
          clearAttempted: false,
          ...legacyActorDefaults(anchorX, anchorZ),
        })
        encounterMetrics.actorsSpawned += 1
      }
    }
  }

  // --- the loop --------------------------------------------------------------

  while (elapsed < timeLimit) {
    frames += 1
    elapsed += delta
    advanceDoctrines()
    w15FrameStart()

    // 1. Chronicle, against the weather mix as it stood before the player moved. This is
    //    the engine's order, and it is what the 30/60/144 Hz arms are testing.
    const environment = createChronicleEnvironment(elapsed, weatherMix)
    const commitment = commitChronicleTicks(chronicleAccumulator, delta)
    chronicleAccumulator = commitment.accumulator
    if (commitment.ticks > 0) {
      const ratio = playerObjectiveRatio(objectives)
      const produced: ChronicleEvent[] = []
      for (let tick = 0; tick < commitment.ticks; tick += 1) {
        const playerRegionId = regionIdAt(player.x, player.z)
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
            escort:
              rumourPolicy === 'off'
                ? null
                : getRumourEscort(commitments, rumourContext(), playerRegionId || null),
          }),
        )
        produced.push(...advanceCommitments(playerRegionId))
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
    // Roadmap 1.4 — every ready node, then the pin, then the one the compass follows. The
    // order matters: a policy that pinned after resolving would spend a frame walking to
    // the node it was about to stop caring about.
    const readyNodes = getReadyObjectiveNodes(blueprint, options.faction, objectives)
    if (readyNodes.length > contractMetrics.maxReady) {
      contractMetrics.maxReady = readyNodes.length
    }
    if (contractPolicy !== 'firstReady' && readyNodes.length > 1) {
      const pinnedStillReady = readyNodes.some(
        (node) => node.id === contracts.pinnedNodeId,
      )
      // Roadmap 1.4's fail-forward arm: a contract already on the clock is walked away
      // from, which is what makes the guarantee something a whole run can be measured
      // against rather than something a unit test asserts in isolation.
      //
      // Roadmap 2.1 — **once per node**, and the qualifier is not cosmetic. With three
      // ready nodes the unqualified rule thrashed: the policy re-pinned every frame the
      // pinned arm was live, `nearest` sent the player back toward whichever was closest,
      // and one 36-seed panel spent 300 s making 1 083 pins without ever arriving anywhere.
      // That measured the policy oscillating, not the campaign stranding — the two failed
      // contracts were both completable by arrival the whole time. Shirking a contract is a
      // decision a player makes once.
      const shirking =
        contractOutcome === 'shirk' &&
        contracts.pinnedNodeId !== null &&
        !shirkedNodeIds.has(contracts.pinnedNodeId) &&
        getContractStatus(
          contracts,
          readyNodes.find((node) => node.id === contracts.pinnedNodeId) ?? readyNodes[0],
        ) === 'active'
      if (!pinnedStillReady || shirking) {
        if (shirking && contracts.pinnedNodeId !== null) {
          shirkedNodeIds.add(contracts.pinnedNodeId)
        }
        const options_ = shirking
          ? readyNodes.filter((node) => node.id !== contracts.pinnedNodeId)
          : readyNodes
        const pool = options_.length > 0 ? options_ : readyNodes
        const chosen =
          contractPolicy === 'contrary'
            ? pool[pool.length - 1]
            : contractPolicy === 'nearest'
              ? pool.reduce((best, node) => {
                  const bestSite = getSiteWorldPosition2D(blueprint, best.siteId)
                  const site = getSiteWorldPosition2D(blueprint, node.siteId)
                  if (!site) return best
                  if (!bestSite) return node
                  return Math.hypot(site.x - player.x, site.z - player.z) <
                    Math.hypot(bestSite.x - player.x, bestSite.z - player.z)
                    ? node
                    : best
                }, pool[0])
              : contractRng.pick(pool)
        if (pinObjective(contracts, chosen.id, readyNodes.map((node) => node.id))) {
          contractMetrics.pins.push(chosen.id)
          if (chosen.id !== readyNodes[0].id) contractMetrics.chose = true
        }
      }
    }
    const activeNode = resolveActiveObjectiveNode(
      blueprint,
      options.faction,
      objectives,
      contracts.pinnedNodeId,
    )
    trackObjective(activeNode?.id ?? null)
    const objectiveSite = activeNode
      ? getSiteWorldPosition2D(blueprint, activeNode.siteId)
      : undefined
    // W1-5 — the squad's count on the first frame the finale opened.
    if (
      squadOn &&
      companionMetrics.aliveAtFinale === null &&
      readyNodes.some((node) => node.id === graph.finalNodeId)
    ) {
      companionMetrics.aliveAtFinale = companions().length
    }
    // W1-5 — a healer, a contract's fight, an event, the road cart. Null in every pinned arm.
    const goal = chooseGoal(activeNode)

    // Roadmap 1.1 — the inbound telegraph the duelist answers, found before anything
    // moves so the answer is a reaction to this frame rather than to the last one.
    const inbound =
      policy === 'duelist' && meleeDefence !== 'none'
        ? inboundWindup(actors, player, meleeDefence === 'heavy')
        : null
    if (inbound) {
      // The defensive verb, exactly as the engine spends it: sprint/jump/ability drop the
      // buffer and the beat in flight, and are refused outright while the finisher is
      // committed. `cancelPlayerMelee` is the shipped function, not a re-implementation.
      if (meleeModel === 'honest' && cancelPlayerMelee(player.melee)) melee.cancels += 1
      if (!inbound.actor.clearAttempted) {
        inbound.actor.clearAttempted = true
        const role = inbound.actor.role
        melee.windupClearAttempts[role] = (melee.windupClearAttempts[role] ?? 0) + 1
      }
    }
    const duelTarget =
      policy === 'duelist' ? nearestHostileWithin(actors, player, HARNESS_DUEL_RANGE) : null
    const fightTarget = duelTarget ?? goal?.actor ?? null

    // Roadmap 1.3 — the detour. `commit` follows its pin and `walk` follows the same square
    // without one, which is the placebo that keeps "the commitment did it" from meaning
    // "walking somewhere else did it". `travelSite` replaces the objective as a destination
    // only; objective completion below still reads `objectiveSite`.
    const steering = steeringRumour()
    const rumourSite = steering ? rumourTarget(steering) : null
    const travelSite = goal?.point ?? rumourSite ?? objectiveSite

    if (policy !== 'idle' && (travelSite || fightTarget)) {
      const retreating =
        policy === 'cautious' && player.health < player.maxHealth * 0.35
      if (travelSite && (elapsed >= repathAt || waypoints.length === 0)) {
        repathAt = elapsed + 2
        pathTo(travelSite.x, travelSite.z)
      }
      let targetX = travelSite?.x ?? player.x
      let targetZ = travelSite?.z ?? player.z
      if (travelSite && waypoints.length > 0) {
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
      // A duelist stops for a fight, and gets out of the way of a telegraph. Both are the
      // whole point of the arm: a player who walks past every enemy measures travel, not
      // combat, and a player who never reacts measures nothing about the defensive verb.
      let sprinting = false
      let holding = false
      if (inbound) {
        targetX = player.x + (player.x - inbound.actor.x)
        targetZ = player.z + (player.z - inbound.actor.z)
        sprinting = player.stamina > 2 && (!sustainOn || missingPlayerLegs(player.body) === 0)
      } else if (fightTarget) {
        const spec = playerBeatSpec(nextPlayerMeleeBeat(player.melee))
        const engageRange =
          meleeModel === 'honest' ? spec.reach - 0.5 : HARNESS_PLAYER_REACH - 0.4
        const distance = Math.hypot(fightTarget.x - player.x, fightTarget.z - player.z)
        if (distance <= engageRange) holding = true
        else {
          targetX = fightTarget.x
          targetZ = fightTarget.z
        }
      }

      // The finisher's root. `isPlayerMeleeCommitted` is the same predicate the engine
      // gates movement on, so the price of the third beat is paid identically in both.
      const committed = meleeModel === 'honest' && isPlayerMeleeCommitted(player.melee)
      if (committed) melee.committedSeconds += delta
      const dx = targetX - player.x
      const dz = targetZ - player.z
      const length = Math.hypot(dx, dz)
      const moving = length > 0.001 && !holding && !committed
      // Roadmap 1.6 — «Устав скорого шага», one of the two doctrine rules this harness
      // models. The drain is gone rather than smaller, and recovery is conditional on
      // moving rather than on not sprinting.
      if (sprinting) {
        if (!doctrineEffects.forcedMarch) {
          player.stamina = Math.max(0, player.stamina - delta * HARNESS_SPRINT_DRAIN)
        }
      } else if (!doctrineEffects.forcedMarch || moving) {
        player.stamina = Math.min(
          player.maxStamina,
          player.stamina + delta * HARNESS_STAMINA_REGEN,
        )
      }

      if (moving) {
        const speed = walkSpeed() * (sprinting ? HARNESS_SPRINT_MULTIPLIER : 1)
        const step = Math.min(speed * delta, length)
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
        // W1-5 — the camera trails the walk, and the squad's formation faces the camera.
        player.heading = Math.atan2(dx, -dz)
      }
    }

    // W1-5 — `E`, pressed when the policy wants something within reach: a ration, a
    // healer, a captive, a cart. The engine decides what the press actually does.
    if (policy !== 'idle' && interactCooldown <= 0) {
      const atGoal =
        goal?.pressWithin != null &&
        Math.hypot(goal.point.x - player.x, goal.point.z - player.z) <= goal.pressWithin
      if (atGoal || wantsRation()) {
        interactCooldown = HARNESS_INTERACT_INTERVAL
        pressInteract(activeNode)
      }
    }

    // 4. Streaming, dwell and discovery.
    const currentRegionId = regionIdAt(player.x, player.z)
    if (currentRegionId) {
      regionDwell[currentRegionId] = (regionDwell[currentRegionId] ?? 0) + delta
      discoveredRegionIds.add(currentRegionId)
    }

    // Roadmap 1.3 — the embodied half, checked after the player has moved. The torch is the
    // only one of the three interventions that is an act rather than a stay, and it is
    // gated on distance to the depot for exactly the reason the design is: a sabotage that
    // could be done from the HUD would be the rejected purchase.
    if (rumourPolicy === 'commit') {
      const pinned = getPinnedRumour(commitments)
      if (pinned && pinned.regionId === currentRegionId) {
        rumours.embodiedSeconds += delta
      }
      if (pinned && pinned.kind === 'sabotage' && !pinned.actioned && pinned.siteId) {
        const depot = getSiteWorldPosition2D(blueprint, pinned.siteId)
        if (
          depot &&
          Math.hypot(depot.x - player.x, depot.z - player.z) <= HARNESS_SABOTAGE_RANGE
        ) {
          markRumourActioned(commitments, rumourContext(), pinned.id)
        }
      }
    }
    const streamWindow = windowAt(player.x, player.z)
    const nextActive = new Set(streamWindow.simulated)
    if (!sameSet(nextActive, simulatedRegionIds)) {
      const previous = simulatedRegionIds
      simulatedRegionIds = nextActive
      navigation.setActiveRegions(simulatedRegionIds)
      encounterScanCooldown = 0
      w15Streamed(previous)
    }
    // Streamed-in regions count as discovered here, which is **not** what the engine does
    // and is stated rather than assumed. `GeneratedWorldRuntime` builds its `RegionManager`
    // with `discoverVisibleRegions: false`, so the shipped game lifts the fog on the one
    // square under the player's feet; this file lifts it on the 3x3 window, because the
    // exposure numbers it exists to produce are about what the player was in a position to
    // see. The consequence for the route measurement is worth naming: the harness's
    // discovery order starts at the square the player starts on (line above, and it is
    // added first) and then admits whole streamed blocks in layout order, so it is a
    // slightly *wider* and slightly *flatter* path than the engine's. It is a proxy, and
    // the numbers this module reports about routes are proxy numbers. The 3x3 is the
    // *visible* window in both streaming arms, so the engine window leaves this alone.
    for (const regionId of streamWindow.visible) discoveredRegionIds.add(regionId)
    if (shippedEncounters) {
      // W1-5 — the generator's own plans, every frame, as `syncGeneratedRegions` does: the
      // finale's square first, so its boss is never the one the budget turns away.
      const ordered = [...simulatedRegionIds].sort(
        (left, right) =>
          Number(right === finaleIdentity.regionId) - Number(left === finaleIdentity.regionId),
      )
      for (const regionId of ordered) {
        if (stagingOn) returnParkedPacks(regionId)
        spawnShippedEncounters(regionId)
      }
    } else {
      encounterScanCooldown -= delta
      if (encounterScanCooldown <= 0) {
        encounterScanCooldown = HARNESS_ENCOUNTER_SCAN_INTERVAL
        for (const regionId of simulatedRegionIds) spawnEncounter(regionId)
      }
    }
    // How crowded the road is, read where the encounters are spawned. Counting only.
    let encounterBodies = 0
    for (const actor of actors) {
      if (actor.alive && actor.system === 'encounter') encounterBodies += 1
    }
    encounterBodySeconds += encounterBodies * delta
    if (encounterRefusedThisFrame) encounterMetrics.refusedSeconds += delta
    encounterRefusedThisFrame = false

    // W1-5 — the road cart and the arrows in flight, ahead of the actors as in `update`.
    if (eventsFought) updateRoadCart()
    stepProjectiles()

    // 5. Actors: real decisions, real damage.
    const playerCommitted = meleeModel === 'honest' && isPlayerMeleeCommitted(player.melee)
    stepActors({
      actors,
      player,
      delta,
      elapsed,
      faction: options.faction,
      combatRng,
      collision,
      damageTaken,
      melee,
      playerCommitted,
      onKill: () => {
        kills += 1
      },
      onPlayerHit: (actor, amount) => {
        notePlayerExchange(actor.id)
        record(damageTaken, actor.role, actor.allegiance, amount)
        lastAttackerCause = actor.allegiance === 'beast' ? 'beast' : 'faction'
        lastAttackerRole = actor.role
        bump(damageBySystem, actor.system, amount)
        onPlayerWounded(actor, true)
      },
      stepEngine: (actor) => stepEngineActor(actor, playerCommitted),
      onActorStruck: (attacker, target, dealt, killed) => {
        if (squadOn && isCompanion(target)) companionMetrics.damageTaken += dealt
        if (target.model === 'engine') {
          if (
            target.aiMode !== 'captive' &&
            !isPacifistRole(target.role) &&
            areAllegiancesHostile(target.allegiance, attacker.allegiance)
          ) {
            target.targetId = attacker.id
            target.retaliationTimer = HARNESS_RETALIATION_SECONDS
          }
          if (target.reaction === 'stagger') cancelAction(target)
        }
        noteLootHit(target, dealt > 0, false)
        if (killed) handleDeath(target, attacker)
      },
      holdsCart: eventsFought ? loadingCart : undefined,
    })

    // 6. The player's swing.
    //
    //    `legacy` is the pre-1.1 model: a cooldown and a nearest-hostile-in-reach hit that
    //    cannot miss and cannot be aimed — the stated limit this file has always carried.
    //    `honest` is roadmap 1.1 driven through `CombatResolver`'s own functions, with a
    //    finite turn rate standing in for a mouse, so a swing can land behind its target.
    if (meleeModel === 'legacy') {
      player.attackCooldown = Math.max(0, player.attackCooldown - delta)
      if (policy !== 'idle' && player.attackCooldown <= 0) {
        const victim = nearestHostileInReach(actors, player)
        if (victim) {
          player.attackCooldown = HARNESS_PLAYER_ATTACK_COOLDOWN
          const outcomeHit = resolveActorDamage({
            target: victim,
            baseDamage: shippedKit ? playerBlow(1) : player.damage + combatRng.next() * 7,
            attackKind: 'melee',
            facingDotToSource: null,
          })
          if (victim.firstHitAt === null) victim.firstHitAt = elapsed
          victim.hp = Math.max(0, victim.hp - outcomeHit.dealt)
          record(damageDealt, victim.role, victim.allegiance, outcomeHit.dealt)
          if (applyDamageReaction(victim, outcomeHit, 'melee') && victim.model === 'engine') {
            cancelAction(victim)
          }
          noteLootHit(victim, outcomeHit.applied && outcomeHit.dealt > 0, true)
          onPlayerStrike(victim)
          if (outcomeHit.killed) {
            victim.alive = false
            victim.deathAt = elapsed
            recordKill(victim.role, elapsed - (victim.firstHitAt ?? elapsed))
            kills += 1
            handleDeath(victim, 'player')
          }
        }
      }
    } else if (policy !== 'idle') {
      const aimTarget = nearestHostileWithin(actors, player, HARNESS_DUEL_RANGE)
      if (aimTarget) {
        player.aimYaw = turnToward(
          player.aimYaw,
          Math.atan2(aimTarget.x - player.x, aimTarget.z - player.z),
          HARNESS_AIM_TURN_RATE * delta,
        )
      }
      // Press whenever the *next* beat could reach something. The buffer decides when it
      // becomes a swing; nothing here resolves a hit, which is the point.
      const pending = playerBeatSpec(nextPlayerMeleeBeat(player.melee))
      const reachable = nearestHostileWithin(actors, player, pending.reach)
      if (reachable && !inbound) bufferPlayerMelee(player.melee)

      const step = advancePlayerMelee(player.melee, { delta, stamina: player.stamina })
      if (step.startedBeat > 0) {
        player.stamina = Math.max(0, player.stamina - step.staminaSpent)
        melee.staminaSpent += step.staminaSpent
      }
      if (step.contactBeat > 0) {
        const spec = playerBeatSpec(step.contactBeat)
        melee.beatsResolved += 1
        melee.beatsByIndex[step.contactBeat - 1] += 1
        const aimX = Math.sin(player.aimYaw)
        const aimZ = Math.cos(player.aimYaw)
        const candidates: MeleeArcCandidate[] = []
        for (const actor of actors) {
          if (!actor.alive || !actor.hostileToPlayer) continue
          const offsetX = actor.x - player.x
          const offsetZ = actor.z - player.z
          const distance = Math.hypot(offsetX, offsetZ)
          if (distance > spec.reach) continue
          candidates.push({
            id: actor.id,
            distance,
            aimDot:
              distance > 0.001 ? (offsetX * aimX + offsetZ * aimZ) / distance : 1,
            hostile: true,
          })
        }
        const chosen = selectMeleeTarget(candidates, spec)
        const victim = chosen
          ? actors.find((actor) => actor.id === chosen.id) ?? null
          : null
        if (!victim?.alive) {
          melee.beatsWhiffed += 1
        } else {
          const outcomeHit = resolveActorDamage({
            target: victim,
            baseDamage: shippedKit
              ? playerBlow(spec.damageMultiplier)
              : (player.damage + combatRng.next() * 7) * spec.damageMultiplier,
            attackKind: spec.attackKind,
            facingDotToSource: null,
          })
          if (victim.firstHitAt === null) victim.firstHitAt = elapsed
          victim.hp = Math.max(0, victim.hp - outcomeHit.dealt)
          record(damageDealt, victim.role, victim.allegiance, outcomeHit.dealt)
          const broke = applyDamageReaction(victim, outcomeHit, spec.attackKind)
          if (broke) melee.poiseBreaks += 1
          if (broke && victim.model === 'engine') cancelAction(victim)
          if (spec.commits) melee.finishersLanded += 1
          noteLootHit(victim, outcomeHit.applied && outcomeHit.dealt > 0, true)
          onPlayerStrike(victim)
          if (outcomeHit.killed) {
            victim.alive = false
            victim.deathAt = elapsed
            recordKill(victim.role, elapsed - (victim.firstHitAt ?? elapsed))
            kills += 1
            handleDeath(victim, 'player')
          }
        }
      }
    }

    // 7. Roadmap 1.4 / 2.1 — every live contract, then objective completion.
    //
    // The contract state machine is the shipped one: `beginContract`, `advanceContract`,
    // `resolveContract` and the fail-forward rule all come from `CampaignDirector`. What
    // the harness supplies is the *outcome driver*, and it is a stated simplification —
    // this file spawns no event actors, so a contract is honoured by holding its site
    // clear rather than by fighting through an escort. What that does measure honestly is
    // the half the initiative is about: contracts that run out of clock fail forward, and
    // the node they leave behind is one the run can still finish.
    //
    // 2.1 made this a loop, and added one rule: **a skipped node's clock stops.** The arm
    // the run chose past is finished with, and a contract that kept counting behind it
    // would report a failure for a road that no longer exists.
    //
    // W1-5 — with the director's fights fought, the hold stand-in steps aside and the
    // contract runs as `updateContractNode` runs it: its own builder at its own site, the
    // game's own events making way for it (W1-1), and the start grace spent only on a
    // genuine stall.
    if (eventsFought) {
      for (const node of contractNodes) updateContractFought(node, activeNode?.id ?? null)
    } else for (const node of contractNodes) {
      const template = findContractTemplate(node.contract)
      const objective = objectives.find((entry) => entry.id === node.id)
      if (!template || !objective || objective.done || objective.skipped === true) continue
      const progress = ensureContractProgress(contracts, node)
      const contractSite = getSiteWorldPosition2D(blueprint, node.siteId)
      if (!progress || !contractSite) continue

      const onSite =
        Math.hypot(contractSite.x - player.x, contractSite.z - player.z) <=
        HARNESS_CONTRACT_RANGE
      const clear = !actors.some(
        (actor) =>
          actor.alive &&
          actor.hostileToPlayer &&
          Math.hypot(actor.x - player.x, actor.z - player.z) < 12,
      )
      const isActive = activeNode?.id === node.id
      if (progress.status === 'offered' && onSite && isActive && policy !== 'idle') {
        if (beginContract(contracts, node, template)) {
          contractMetrics.started += 1
          contractHold.set(node.id, 0)
        }
      } else if (progress.status === 'active') {
        const holding =
          contractOutcome === 'honour' && onSite && clear && isActive && policy !== 'idle'
        const held = holding ? (contractHold.get(node.id) ?? 0) + delta : 0
        contractHold.set(node.id, held)
        if (held >= HARNESS_CONTRACT_HOLD) {
          resolveContract(contracts, node.id, 'kept')
          contractMetrics.kept += 1
          completeObjectiveEntry(objectives, node.id)
          settleSkips(node.id)
          finishObjective(node.id)
        }
      }
      // The clock runs whether or not the pin is still on it: a contract on the ground is
      // a thing happening in the world, not a thing the HUD is looking at.
      if (getContractStatus(contracts, node) !== 'kept') {
        const tick = advanceContract(progress, template, delta, onSite)
        if (tick.kind === 'expired' || tick.kind === 'abandoned') {
          resolveContract(contracts, node.id, 'failed')
          contractMetrics.failedForward += 1
        }
      }
    }

    // 7b. Objective arrival — and the fail-forward path, which is an arrival too.
    const contractFailedForward =
      activeNode !== null &&
      activeNode.contract !== undefined &&
      isContractNodeCompletableByArrival(
        getContractStatus(contracts, activeNode),
        findContractTemplate(activeNode.contract),
      )
    if (activeNode && objectiveSite && (activeNode.kind === 'arrive' || contractFailedForward)) {
      if (
        isWithinObjectiveArrival(player.x, player.z, objectiveSite.x, objectiveSite.z)
      ) {
        completeObjectiveEntry(objectives, activeNode.id)
        settleSkips(activeNode.id)
        finishObjective(activeNode.id)
      }
    }
    // Anything that is not an arrival and is not a live contract completes when the player
    // is standing on it and nothing hostile is left within reach — a stand-in for the
    // interaction the engine gates on a keypress, and a stated simplification. W1-5's
    // shipped encounters take the finale out of it: there, only the boss's death ends it.
    if (
      activeNode &&
      activeNode.kind !== 'arrive' &&
      activeNode.contract === undefined &&
      objectiveSite &&
      !(shippedEncounters && activeNode.id === graph.finalNodeId)
    ) {
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
        // W1-5 — the interaction is the site's own: a healer heals, a treasure pays.
        const service = sustainOn
          ? services.find((entry) => entry.id === activeNode.siteId)
          : undefined
        if (service) visitService(service)
        completeObjectiveEntry(objectives, activeNode.id)
        settleSkips(activeNode.id)
        finishObjective(activeNode.id)
      }
    }

    // W1-5 — the director's fights, after the contracts, as `update` orders them.
    if (eventsFought) updateEvents()

    // 8. Bleeding, then the run-ending checks, in the engine's order.
    if (player.bleeding > 0 && sustainOn && doctrineEffects.rationOnBleed && player.supplies > 0) {
      // Roadmap 1.6 — «Устав сухого пайка»: the wound spends the ration, not the player.
      player.supplies -= 1
      sustainMetrics.rationsEaten += 1
      if (healingOn) player.bleeding = 0
    } else if (player.bleeding > 0) {
      const healthBefore = player.health
      const amount = player.bleeding * delta
      player.health -= amount
      damageTaken.bleeding += amount
      damageTaken.total += amount
      if (healthBefore > 0 && player.health <= 0) bledOut = true
    }
    if (player.health <= 0) {
      outcome = 'defeat'
      deathCause = bledOut ? 'bleeding' : lastAttackerCause
      deathRole = lastAttackerRole
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
      // W1-5 — `cleanupDeadActors` leaves an event's dead to the event, which counts them.
      if (actor.eventOwnerId !== null && activeEvents.some((live) => live.id === actor.eventOwnerId)) {
        continue
      }
      if (!actor.alive && actor.deathAt !== null && elapsed - actor.deathAt > HARNESS_CORPSE_LIFETIME) {
        actors.splice(index, 1)
      }
    }
  }

  function finishObjective(id: string): void {
    // W1-5 — «Устав дозора»: with the waves off the clock, a closed objective brings one.
    if (
      eventsFought &&
      doctrineEffects.threatWavesOnObjective &&
      threatTier >= 2 &&
      !objectiveReports.get(id)?.completedAt
    ) {
      spawnThreatWave()
    }
    if (middleNodeIds.has(id) && !contractMetrics.middleOrder.includes(id)) {
      contractMetrics.middleOrder.push(id)
    }
    if (id === contractMetrics.contractNodeId) contractMetrics.completed = true
    // Roadmap 2.1 — the *route*, as the contract **node ids** walked, in order. This is
    // what an exclusive fork changes and an ordering does not: two runs of the same seed
    // that took different arms print different routes rather than the same set reordered.
    const node = contractNodes.find((candidate) => candidate.id === id)
    if (node?.contract !== undefined && !contractMetrics.route.includes(node.id)) {
      contractMetrics.route.push(node.id)
    }
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
  // The shipped re-decision, run from the harness rather than re-implemented, so a sweep
  // can assert the farmability properties on real runs rather than on a fixture.
  contractMetrics.rewardedObjectives = countRewardedObjectives(objectives)
  contractMetrics.strandedAtEnd =
    !campaignObjectivesComplete(objectives) &&
    getReadyObjectiveNodes(blueprint, options.faction, objectives).length === 0

  melee.whiffRate =
    melee.beatsResolved > 0 ? melee.beatsWhiffed / melee.beatsResolved : 0
  melee.avoidableHitRate =
    melee.telegraphedHeavies > 0
      ? melee.telegraphedHeaviesAvoided / melee.telegraphedHeavies
      : 0
  for (const [role, times] of killTimes) {
    melee.timeToKillByRole[role] = median(times)
    melee.killsByRole[role] = times.length
  }

  const regionControl: Record<string, Territory> = {}
  const regionControlTally: Record<Territory, number> = {
    neutral: 0,
    elf: 0,
    guard: 0,
    villain: 0,
  }
  const razedRegionIds: string[] = []
  for (const region of blueprint.regions) {
    const key = String(region.id)
    const chronicle = chronicleRegions.get(key)
    const control = chronicle?.control ?? region.territory
    regionControl[key] = control
    regionControlTally[control] += 1
    if (isRegionRazed(chronicle)) razedRegionIds.push(key)
  }

  // W1-5 — the balance block, closed out.
  companionMetrics.aliveAtEnd = companions().length
  sustainMetrics.goldAtEnd = player.gold
  sustainMetrics.rationsLeft = player.supplies
  feasibility.beyondReachShare =
    feasibility.offered > 0 ? feasibility.beyondReach / feasibility.offered : 0
  if (damageTaken.bleeding > 0) damageBySystem.bleeding = damageTaken.bleeding
  encounterMetrics.meanOnField = elapsed > 0 ? encounterBodySeconds / elapsed : 0
  const balance: BalanceMetrics = {
    maxThreatTier,
    draftsReached: DOCTRINE_DRAFT_TIERS.filter((tier) => maxThreatTier >= tier).length,
    damageBySystem,
    deathSystem: outcome === 'defeat' ? (bledOut ? 'bleeding' : lastAttackerSystem) : null,
    companions: companionMetrics,
    sustain: sustainMetrics,
    events: eventMetrics,
    caravans: caravanMetrics,
    contracts: contractBalance,
    rumourFeasibility: feasibility,
    encounters: encounterMetrics,
  }

  return {
    seed: blueprint.seed,
    faction: options.faction,
    policy,
    meleeModel,
    meleeDefence,
    rumourPolicy,
    contractPolicy,
    campaignShape,
    contractOutcome,
    doctrinePolicy,
    squad: squadPolicy,
    sustain: sustainPolicy,
    eventModel,
    eventPolicy,
    eventDirector,
    playerKit,
    encounterModel,
    regionWindow,
    commanders: commanderModel,
    staging: stagingModel,
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
    deathRole,
    regionDwell,
    regionsVisited: Object.keys(regionDwell).length,
    eventExposure: exposure,
    chronicleHistory: chronicleState.log.map((event) => event.id),
    chronicleLog: chronicleState.log.map((event) => ({ ...event })),
    chronicleTicks,
    discoveredRegionIds: [...discoveredRegionIds],
    finalRegionId: regionIdAt(player.x, player.z),
    regionControl,
    regionControlTally,
    razedRegionIds,
    rumours,
    contracts: contractMetrics,
    doctrines: doctrineMetrics,
    weatherTargetChanges,
    finalWeather: weatherTarget,
    finalStormFactor: computeStormFactor(weatherMix),
    health: Math.max(0, player.health),
    melee,
    balance,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The squares a run sees and the squares it simulates, for one position of the player. */
export interface RegionWindowSets {
  visible: readonly string[]
  simulated: readonly string[]
}

/**
 * The streaming window, as a function of where the player stands.
 *
 * `square` is the pinned window, computed exactly as it always was: every square within
 * Chebyshev distance `HARNESS_STREAM_RADIUS`, in layout order, both seen and simulated,
 * and nothing at all off the map. `engine` asks a real `RegionManager` built with
 * `HARNESS_ENGINE_REGION_STREAMING`, and returns the squares in the order its getters
 * return them, which is the order `syncGeneratedRegions` spawns in. When the player
 * stands on no square it keeps the last sets, as `GeneratedWorldRuntime.update` does.
 */
export function createRegionWindow(
  blueprint: WorldBlueprint,
  terrain: TerrainSystem,
  window: RegionWindow,
): (x: number, z: number) => RegionWindowSets {
  if (window === 'square') {
    return (x, z) => {
      const current = terrain.getRegionAt(x, z)
      if (!current) return { visible: [], simulated: [] }
      const ids: string[] = []
      for (const region of terrain.layout.regions) {
        if (
          Math.abs(region.coordinate.x - current.coordinate.x) <= HARNESS_STREAM_RADIUS &&
          Math.abs(region.coordinate.z - current.coordinate.z) <= HARNESS_STREAM_RADIUS
        ) {
          ids.push(String(region.id))
        }
      }
      return { visible: ids, simulated: ids }
    }
  }
  const manager = new RegionManager(blueprint, undefined, HARNESS_ENGINE_REGION_STREAMING)
  let currentId: string | null = null
  let sets: RegionWindowSets = { visible: [], simulated: [] }
  return (x, z) => {
    const regionId = terrain.getRegionIdAt(x, z)
    if (regionId === undefined || String(regionId) === currentId) return sets
    manager.update(regionId)
    currentId = String(regionId)
    sets = {
      visible: manager.getVisibleRegionIds().map(String),
      simulated: manager.getSimulatedRegionIds().map(String),
    }
    return sets
  }
}

/**
 * Roadmap 1.4's placebo: the same campaign, with the fork taken out.
 *
 * Every middle node is given the previous one as its prerequisite, so exactly one node is
 * ever ready and no contract policy can express a preference. Deliberately a mutation of an
 * already-generated blueprint rather than a second generator path — the point of a placebo
 * is that everything except the one variable is identical, and re-deriving the world would
 * change the encounters, the river and the sites along with it.
 *
 * The mutated blueprint's fingerprint no longer matches its contents, which is fine here
 * and would not be anywhere else: nothing in a harness run reads it.
 */
function linearizeCampaignGraph(blueprint: WorldBlueprint, faction: Faction): void {
  const graph = blueprint.objectives[faction]
  const middles = graph.nodes.filter(
    (node) => !graph.rootNodeIds.includes(node.id) && node.id !== graph.finalNodeId,
  )
  for (let index = 1; index < middles.length; index += 1) {
    middles[index].prerequisiteIds = [middles[index - 1].id]
  }
  // Roadmap 2.1 — a linearised graph has no fork, so it can have no exclusive arms either:
  // leaving them would let the *first* node skip the ones behind it and the placebo would
  // quietly become the treatment.
  for (const node of graph.nodes) {
    delete node.optional
    delete node.exclusiveGroup
  }
}

/**
 * **Roadmap 2.1's placebo: the same campaign, with the exclusivity taken out.**
 *
 * The fork is left exactly where it is — same sites, same contracts, same two ready nodes,
 * same policies, same pins — and only `optional` and `exclusiveGroup` are removed, which
 * makes every arm required and reproduces 1.4's shape precisely. It is the control that
 * separates "the player chose a road" from "the map has two roads on it": any route
 * divergence this arm still produces is not produced by an exclusive choice.
 *
 * Deliberately a mutation of an already-generated blueprint rather than a second generator
 * path, for the same reason as the linearised arm: everything except the one variable has
 * to be identical.
 */
function unmakeExclusiveArms(blueprint: WorldBlueprint, faction: Faction): void {
  for (const node of blueprint.objectives[faction].nodes) {
    delete node.optional
    delete node.exclusiveGroup
  }
}

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

function nearestHostileWithin(
  actors: readonly HarnessActor[],
  player: { x: number; z: number },
  range: number,
): HarnessActor | null {
  const nearest = nearestHostile(actors, player)
  if (!nearest) return null
  return Math.hypot(nearest.x - player.x, nearest.z - player.z) <= range ? nearest : null
}

/**
 * A wind-up aimed at the player that is about to land.
 *
 * The duelist reacts to it and nothing else: reacting to a hostile merely being *near*
 * would make the arm a measurement of proximity, and reacting after contact would measure
 * nothing at all. `HARNESS_REACTION_WINDOW` is the notice a player gets from a telegraph
 * decal and the `attackTell` cue, which is what the enemy half already spends on being
 * readable.
 */
function inboundWindup(
  actors: readonly HarnessActor[],
  player: { x: number; z: number },
  heavyOnly: boolean,
): { actor: HarnessActor; remaining: number } | null {
  let best: { actor: HarnessActor; remaining: number } | null = null
  for (const actor of actors) {
    if (!actor.alive || !actor.hostileToPlayer) continue
    if (actor.actionPhase !== 'windup' || !actor.actionTargetIsPlayer) continue
    // W1-5 — an archer's draw is not a melee telegraph, and stepping back does not dodge it.
    if (actor.actionKind === 'arrow') continue
    if (heavyOnly && actionWindup(actor.role) < HARNESS_HEAVY_WINDUP) continue
    if (actor.actionRemaining > HARNESS_REACTION_WINDOW) continue
    if (
      Math.hypot(actor.x - player.x, actor.z - player.z) >
      HARNESS_PLAYER_CONTACT + 2.5
    ) {
      continue
    }
    if (best === null || actor.actionRemaining < best.remaining) {
      best = { actor, remaining: actor.actionRemaining }
    }
  }
  return best
}

/** Turn `from` toward `to` by at most `maxStep` radians, the short way round. */
function turnToward(from: number, to: number, maxStep: number): number {
  let difference = to - from
  while (difference > Math.PI) difference -= Math.PI * 2
  while (difference < -Math.PI) difference += Math.PI * 2
  if (Math.abs(difference) <= maxStep) return to
  return from + Math.sign(difference) * maxStep
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
  melee: MeleeMetrics
  /** True while the finisher has the player rooted, so a hit taken then is attributable. */
  playerCommitted: boolean
  onKill: () => void
  onPlayerHit: (actor: HarnessActor, amount: number) => void
  /** W1-5 — steps an `engine`-model body. Never called while no arm spawned one. */
  stepEngine?: (actor: HarnessActor) => void
  /** W1-5 — what a legacy hand's blow means to the body it landed on, and its death. */
  onActorStruck?: (
    attacker: HarnessActor,
    target: HarnessActor,
    dealt: number,
    killed: boolean,
  ) => void
  /** W1-2 — this body is loading a cart, so it holds still at it. */
  holdsCart?: (actor: HarnessActor) => boolean
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
    // W1-5 — a body the shipped arms put down runs the engine's rules, not this loop's.
    if (actor.model === 'engine') {
      if (actor.alive) context.stepEngine?.(actor)
      continue
    }
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
    if (context.holdsCart?.(actor)) continue

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
          const connected =
            isWithinContact(distance, contactRange) && actor.reaction !== 'stagger'
          // Roadmap 1.1's signal 2 and signal 3, both counted at the one moment that can
          // answer them: a telegraph either reached the player or it did not.
          if (actor.actionTargetIsPlayer) {
            if (actor.telegraphHeavy && !connected) {
              context.melee.telegraphedHeaviesAvoided += 1
            }
            if (actor.clearAttempted && !connected) {
              context.melee.windupClears[actor.role] =
                (context.melee.windupClears[actor.role] ?? 0) + 1
            }
            if (connected && context.playerCommitted) {
              context.melee.hitsWhileCommitted += 1
            }
          }
          if (connected) {
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
              if (hit.applied) context.onActorStruck?.(actor, target, hit.dealt, hit.killed)
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
      // `actionTargetIsPlayer` was declared and never written before 1.1. It is what makes
      // "a telegraph aimed at the player" a thing the harness can count, so it is written
      // here, at the one place a wind-up begins.
      actor.actionTargetIsPlayer = targetIsPlayer
      actor.actionTargetId = target?.id ?? null
      actor.clearAttempted = false
      actor.telegraphHeavy =
        targetIsPlayer && actionWindup(actor.role) >= HARNESS_HEAVY_WINDUP
      if (actor.telegraphHeavy) context.melee.telegraphedHeavies += 1
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

// ---------------------------------------------------------------------------
// W1-5 — the balance sweep
// ---------------------------------------------------------------------------

export interface BalanceSweepOptions {
  /** Seeds per faction and policy. Every cell walks the same seeds, so cells pair up. */
  seeds: number
  firstSeed?: number
  stride?: number
  factions?: readonly Faction[]
  policies?: readonly InputPolicy[]
  hz?: number
  timeLimit?: number
  /** Arms spread under every run. Defaults to `HARNESS_SHIPPED_ARMS`. */
  arms?: Partial<Omit<RunOptions, 'seed' | 'faction' | 'policy' | 'hz' | 'timeLimit'>>
}

/** One faction under one policy, over the sweep's seeds. */
export interface BalanceCell {
  policy: InputPolicy
  faction: Faction
  runs: number
  outcomes: Record<RunOutcome, number>
  winRate: number
  /** The victories' run length, nearest-rank percentiles, in seconds. Zero with no wins. */
  victoryLength: { p10: number; p50: number; p90: number }
  /** Every run's length, in minute buckets: `0-1`, `1-2`, …, and `10+`. */
  lengthHistogram: Record<string, number>
  deathCauses: Record<DeathCause, number>
  deathSystems: Record<string, number>
  meanDamageTaken: number
  /** Mean damage taken per run, by the system that spawned the hand. */
  damageBySystem: Record<string, number>
  meanKills: number
  /** Companions standing when the finale opened, over the runs where it did. */
  companionsAtFinale: { mean: number; atLeastOne: number; opened: number }
  meanCompanionsAtEnd: number
  meanCompanionKills: number
  draftsReached: { median: number; max: number }
  maxThreatTier: { median: number; max: number }
  /** Totals over the cell's runs. */
  caravans: {
    robbed: number
    escorted: number
    lost: number
    robberiesLostToNpcs: number
    robbedBySquad: number
    claimsOpened: number
    lootsStarted: number
    lootsBrokenByPlayer: number
  }
  contracts: {
    started: number
    kept: number
    failed: number
    abandoned: number
    lostToEvents: number
    abandonedBy: Record<string, number>
    /** W1-1 — seconds contracts waited on their sites, by reason. */
    waitedSeconds: Record<string, number>
    handedBackForContracts: number
  }
  events: {
    random: number
    located: number
    threatWaves: number
    wonWithoutPlayer: number
    /** W1-1 — random events stood down for a contract. */
    stoodDown: number
  }
  rumours: { offered: number; beyondReach: number; beyondReachShare: number }
  /** Per-run means of the encounter block. */
  encounters: {
    meanFielded: number
    meanActorsSpawned: number
    meanOnField: number
    meanRefusedSeconds: number
    /** W1-6 — soldiers commanders called, per run. */
    meanReinforcements: number
    /** W1-6 — the player's own packs that stepped back for a staging, per run. */
    meanPacksSteppedBack: number
  }
  meanGoldEarned: number
  meanGoldSpent: number
  meanHealed: number
  healedBySource: Record<string, number>
}

export interface BalanceSweepReport {
  seeds: number
  hz: number
  timeLimit: number
  cells: BalanceCell[]
}

function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))]
}

function addInto(into: Record<string, number>, from: Record<string, number>, scale = 1): void {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + value * scale
}

/**
 * The W1-5 instrument: every faction under every policy, on the same seeds, with the shipped
 * arms on unless told otherwise. Deterministic in the way one run is.
 */
export function sweepBalance(options: BalanceSweepOptions): BalanceSweepReport {
  const hz = options.hz ?? 30
  const timeLimit = options.timeLimit ?? HARNESS_TIME_LIMIT
  const firstSeed = options.firstSeed ?? 1
  const stride = options.stride ?? 7919
  const factions = options.factions ?? FACTION_ROTATION
  const policies = options.policies ?? (['beeline', 'cautious', 'duelist'] as const)
  const arms = options.arms ?? HARNESS_SHIPPED_ARMS
  const cells: BalanceCell[] = []
  for (const policy of policies) {
    for (const faction of factions) {
      const reports: RunReport[] = []
      for (let index = 0; index < options.seeds; index += 1) {
        reports.push(
          runHarness({
            ...arms,
            seed: firstSeed + index * stride,
            faction,
            policy,
            hz,
            timeLimit,
          }),
        )
      }
      cells.push(summarizeCell(policy, faction, reports))
    }
  }
  return { seeds: options.seeds, hz, timeLimit, cells }
}

function summarizeCell(
  policy: InputPolicy,
  faction: Faction,
  reports: readonly RunReport[],
): BalanceCell {
  const runs = Math.max(1, reports.length)
  const outcomes: Record<RunOutcome, number> = { victory: 0, defeat: 0, timeout: 0 }
  const deathCauses: Record<DeathCause, number> = { beast: 0, faction: 0, bleeding: 0, none: 0 }
  const deathSystems: Record<string, number> = {}
  const lengthHistogram: Record<string, number> = {}
  const damageBySystem: Record<string, number> = {}
  const healedBySource: Record<string, number> = {}
  const abandonedBy: Record<string, number> = {}
  const victories: number[] = []
  const finale: number[] = []
  const drafts: number[] = []
  const tiers: number[] = []
  const caravans = {
    robbed: 0,
    escorted: 0,
    lost: 0,
    robberiesLostToNpcs: 0,
    robbedBySquad: 0,
    claimsOpened: 0,
    lootsStarted: 0,
    lootsBrokenByPlayer: 0,
  }
  const waitedSeconds: Record<string, number> = {}
  const contracts = {
    started: 0,
    kept: 0,
    failed: 0,
    abandoned: 0,
    lostToEvents: 0,
    abandonedBy,
    waitedSeconds,
    handedBackForContracts: 0,
  }
  const events = { random: 0, located: 0, threatWaves: 0, wonWithoutPlayer: 0, stoodDown: 0 }
  const rumours = { offered: 0, beyondReach: 0, beyondReachShare: 0 }
  const encounters = {
    meanFielded: 0,
    meanActorsSpawned: 0,
    meanOnField: 0,
    meanRefusedSeconds: 0,
    meanReinforcements: 0,
    meanPacksSteppedBack: 0,
  }
  let damage = 0
  let kills = 0
  let companionsAtEnd = 0
  let companionKills = 0
  let goldEarned = 0
  let goldSpent = 0
  let healed = 0
  for (const report of reports) {
    const balance = report.balance
    outcomes[report.outcome] += 1
    deathCauses[report.deathCause] += 1
    if (balance.deathSystem) deathSystems[balance.deathSystem] = (deathSystems[balance.deathSystem] ?? 0) + 1
    if (report.outcome === 'victory') victories.push(report.elapsed)
    const minute = Math.floor(report.elapsed / 60)
    const bucket = minute >= 10 ? '10+' : `${minute}-${minute + 1}`
    lengthHistogram[bucket] = (lengthHistogram[bucket] ?? 0) + 1
    damage += report.damageTaken.total
    kills += report.kills
    addInto(damageBySystem, balance.damageBySystem, 1 / runs)
    if (balance.companions.aliveAtFinale !== null) finale.push(balance.companions.aliveAtFinale)
    companionsAtEnd += balance.companions.aliveAtEnd
    companionKills += balance.companions.kills
    drafts.push(balance.draftsReached)
    tiers.push(balance.maxThreatTier)
    caravans.robbed += balance.caravans.robbed
    caravans.escorted += balance.caravans.escorted
    caravans.lost += balance.caravans.lost
    caravans.robberiesLostToNpcs += balance.caravans.robberiesLostToNpcs
    caravans.robbedBySquad += balance.caravans.robbedBySquad
    caravans.claimsOpened += balance.caravans.claimsOpened
    caravans.lootsStarted += balance.caravans.lootsStarted
    caravans.lootsBrokenByPlayer += balance.caravans.lootsBrokenByPlayer
    contracts.started += balance.contracts.started
    contracts.kept += balance.contracts.kept
    contracts.failed += balance.contracts.failed
    contracts.abandoned += balance.contracts.abandoned
    contracts.lostToEvents += balance.contracts.lostToEvents
    addInto(abandonedBy, balance.contracts.abandonedBy)
    addInto(waitedSeconds, balance.contracts.waitedSeconds)
    contracts.handedBackForContracts += balance.contracts.handedBackForContracts
    events.random += Object.values(balance.events.randomStarted).reduce((sum, value) => sum + value, 0)
    events.located += Object.values(balance.events.locatedMaterialized).reduce((sum, value) => sum + value, 0)
    events.threatWaves += balance.events.threatWaves
    events.wonWithoutPlayer += balance.events.wonWithoutPlayer
    events.stoodDown += balance.events.randomStoodDown
    rumours.offered += balance.rumourFeasibility.offered
    rumours.beyondReach += balance.rumourFeasibility.beyondReach
    encounters.meanFielded += balance.encounters.fielded / runs
    encounters.meanActorsSpawned += balance.encounters.actorsSpawned / runs
    encounters.meanOnField += balance.encounters.meanOnField / runs
    encounters.meanRefusedSeconds += balance.encounters.refusedSeconds / runs
    encounters.meanReinforcements += balance.encounters.reinforcementsCalled / runs
    encounters.meanPacksSteppedBack += balance.encounters.packsSteppedBack / runs
    goldEarned += balance.sustain.goldEarned
    goldSpent += balance.sustain.goldSpent
    healed += balance.sustain.healed
    addInto(healedBySource, balance.sustain.healedBySource, 1 / runs)
  }
  rumours.beyondReachShare = rumours.offered > 0 ? rumours.beyondReach / rumours.offered : 0
  return {
    policy,
    faction,
    runs: reports.length,
    outcomes,
    winRate: reports.length > 0 ? outcomes.victory / reports.length : 0,
    victoryLength: {
      p10: percentile(victories, 0.1),
      p50: percentile(victories, 0.5),
      p90: percentile(victories, 0.9),
    },
    lengthHistogram,
    deathCauses,
    deathSystems,
    meanDamageTaken: damage / runs,
    damageBySystem,
    meanKills: kills / runs,
    companionsAtFinale: {
      mean: finale.length > 0 ? finale.reduce((sum, value) => sum + value, 0) / finale.length : 0,
      atLeastOne: finale.filter((value) => value >= 1).length,
      opened: finale.length,
    },
    meanCompanionsAtEnd: companionsAtEnd / runs,
    meanCompanionKills: companionKills / runs,
    draftsReached: { median: median(drafts), max: Math.max(0, ...drafts) },
    maxThreatTier: { median: median(tiers), max: Math.max(0, ...tiers) },
    caravans,
    contracts,
    events,
    rumours,
    encounters,
    meanGoldEarned: goldEarned / runs,
    meanGoldSpent: goldSpent / runs,
    meanHealed: healed / runs,
    healedBySource,
  }
}
