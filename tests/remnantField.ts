/**
 * W3-4 — a headless `GameEngine` on one generated world, for the tests of «Недобитые».
 *
 * The engine is the shipped class with its render and audio boundaries replaced, the way
 * `tests/contractArrival.test.ts` does it: `syncGeneratedRegions` and the production spawner,
 * `damageActor`, `killActor` and `recordGeneratedActorDeath`, `removeActorById`,
 * `parkGeneratedPack` and `saveGeneratedRun` all run as they ship. The window is a real
 * `RegionManager`.
 */
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  createGeneratedEncounterPlans,
  getBlueprintRegionBounds,
  getSiteWorldPosition2D,
  type GeneratedEncounterPlan,
} from '../src/game/content/registry.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { createDoctrineRunState, resolveDoctrineEffects } from '../src/game/run/doctrine.ts'
import { createHealthyBody, type ActorRole, type Allegiance, type Faction } from '../src/game/types.ts'
import { ActorBudget, MAX_ACTORS } from '../src/game/world/ActorBudget.ts'
import {
  createCampaignContractState,
  createChronicleCommitmentState,
  createGeneratedObjectives,
} from '../src/game/world/CampaignDirector.ts'
import { createChronicleRegions, createChronicleState } from '../src/game/world/Chronicle.ts'
import { actorBaseHealth, createPlayerMeleeState } from '../src/game/world/CombatResolver.ts'
import { createCombatMasteryState } from '../src/game/world/CombatMastery.ts'
import { createEncounterRemnants, describeRemnant } from '../src/game/world/EncounterRemnants.ts'
import { ExpeditionPlanner } from '../src/game/world/ExpeditionPlanner.ts'
import { createFinaleIdentity, createFinaleState } from '../src/game/world/FinaleDirector.ts'
import { RegionManager } from '../src/game/world/RegionManager.ts'
import { createSquadCommandState } from '../src/game/world/SquadCommand.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import type { WorldBlueprint } from '../src/game/world/worldTypes.ts'
import { GameEngine, invoke } from './contractRoomField.ts'

export { invoke }

export const SEED = 20261008

export interface Body {
  id: string
  allegiance: Allegiance
  role: ActorRole
  mesh: THREE.Group
  alive: boolean
  hp: number
  maxHp: number
  generatedSpawnId: string | null
  generatedRegionId: string | null
  generatedEncounterId: string | null
  generatedUnique: boolean
  eventOwnerId: string | null
  hostileToPlayer: boolean
  budgetCategory: string
  [key: string]: unknown
}

function achievementState(runId: string, faction: Faction) {
  return {
    runId, faction, startedAt: '2026-10-08T10:00:00.000Z', kills: 0, killsSinceDamage: 0,
    bestKillStreak: 0, damageTaken: 0, injuries: 0, limbsLost: 0, goldEarned: 0, purchases: 0,
    objectivesCompleted: 0, eventsCompleted: 0, abilitiesUsed: 0, shieldBlocks: 0, squadCommands: 0,
    caravansRobbed: 0, zonesVisited: ['neutral' as const], eventKindsCompleted: [], unlockedIds: [],
    result: null, elapsedAtEnd: 0, healthAtEnd: 0,
  }
}

function plansByRegion(blueprint: WorldBlueprint, faction: Faction): Map<string, GeneratedEncounterPlan[]> {
  const byRegion = new Map<string, GeneratedEncounterPlan[]>()
  for (const plan of Object.values(createGeneratedEncounterPlans(blueprint, faction))) {
    const key = String(plan.regionId)
    byRegion.set(key, [...(byRegion.get(key) ?? []), plan])
  }
  return byRegion
}

export function centreOf(blueprint: WorldBlueprint, regionId: string): { x: number; z: number } {
  const bounds = getBlueprintRegionBounds(blueprint, regionId)
  assert.ok(bounds, `no bounds for ${regionId}`)
  return { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }
}

/** A square at least two squares from `regionId`, so it is neither seen nor simulated from there. */
export function farFrom(blueprint: WorldBlueprint, regionId: string): string {
  const origin = blueprint.regions.find((region) => String(region.id) === regionId)!
  const far = blueprint.regions.find((region) =>
    Math.max(
      Math.abs(region.coordinate.x - origin.coordinate.x),
      Math.abs(region.coordinate.y - origin.coordinate.y),
    ) >= 2)
  assert.ok(far, 'a far square exists')
  return String(far.id)
}

/** The live engine on one world, streaming the real window around wherever the player stands. */
export function field(faction: Faction, blueprint = generateWorld(SEED)) {
  const plans = plansByRegion(blueprint, faction)
  const regions = new RegionManager(blueprint)
  const regionIds = blueprint.regions.map((region) => String(region.id))
  const runId = `encounter-remnants-${faction}`
  const player = new THREE.Group()
  const actors: Body[] = []
  const notices: Array<{ message: string; tone: string }> = []
  const streams = {
    combat: new RandomStream(1), director: new RandomStream(2), event: new RandomStream(3),
    loot: new RandomStream(4), chronicle: new RandomStream(5), rumour: new RandomStream(6),
    injury: new RandomStream(7),
  }
  let serial = 0
  const engine: object = Object.create(GameEngine.prototype)
  const generatedWorld = {
    bounds: blueprint.bounds,
    regions,
    discoveredRegionIds: [...regionIds],
    sampleHeight: () => 0,
    getBiomeAt: () => 'neutral',
    getRegionIdAt: (x: number, z: number) => regionIds.find((id) => {
      const bounds = getBlueprintRegionBounds(blueprint, id)
      return bounds !== undefined && bounds !== null &&
        x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
    }),
    getRegionBounds: (id: string) => getBlueprintRegionBounds(blueprint, id),
    getSitePosition: (id: string) => {
      const position = getSiteWorldPosition2D(blueprint, id)
      return position ? { ...position, y: 0 } : undefined
    },
  }
  const start = centreOf(blueprint, String(blueprint.sites.find((site) => site.id === blueprint.starts[faction])!.regionId))
  player.position.set(start.x, 0, start.z)
  Object.assign(engine, {
    faction,
    generatedBlueprint: blueprint,
    generatedWorld,
    generatedRun: {
      runId,
      config: { seed: blueprint.seed, generatorVersion: blueprint.generatorVersion, faction, selectedBoonId: 'provisions' },
      startedAt: '2026-10-08T10:00:00.000Z',
    },
    player,
    actors,
    eventPropTargets: new Map(),
    simulatedGeneratedRegions: new Set<string>(),
    generatedEncounterPlans: plans,
    generatedActivationSpawns: new Map(),
    parkedGeneratedSpawns: new Map(),
    parkedPacksCalledHome: new Map(),
    parkHoldUntil: 0,
    encounterRemnants: createEncounterRemnants(),
    chronicleEncounterPlanControl: new Map(blueprint.regions.map((region) => [String(region.id), region.territory])),
    generatedNavigationRegionSignature: '',
    generatedNavigationCache: new Map(),
    actorSequence: 0,
    elapsed: 30,
    paused: false,
    ended: false,
    gold: 55,
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    kills: 0,
    damage: 31,
    body: createHealthyBody(),
    objectives: createGeneratedObjectives(blueprint, faction),
    upgrades: { blade: 0, vitality: 0, endurance: 0 },
    generatedSupplyCount: 0,
    generatedHealthBonus: 0,
    generatedStaminaBonus: 0,
    threatTier: 1,
    nextThreatWaveAt: 240,
    championDamageBonus: 0,
    caravan: new THREE.Group(),
    caravanCooldown: 0,
    caravanDirection: 1,
    caravanDefenseCredit: false,
    caravanAidCooldown: 0,
    eventCooldown: 70,
    eventSequence: 0,
    activeEvents: [],
    activeContractNodeId: null,
    campaignContracts: createCampaignContractState(),
    chronicleCommitments: createChronicleCommitmentState(),
    chronicleRegions: createChronicleRegions(blueprint),
    chronicleState: createChronicleState(),
    chronicleContestedRegionIds: new Set(),
    chronicleProtectedRegionIds: new Set(),
    doctrines: createDoctrineRunState([]),
    doctrineEffects: resolveDoctrineEffects([]),
    finale: createFinaleState(createFinaleIdentity(blueprint, faction)),
    squadCommand: createSquadCommandState({ x: start.x, z: start.z, heading: 0 }, false),
    squadNavigation: new Map(),
    squadBlockedSeconds: new Map(),
    squadIntents: new Map(),
    expeditionPlanner: new ExpeditionPlanner(blueprint),
    hints: { pending: () => [] },
    lootPickups: [],
    generatedRunStatus: 'active',
    runEnding: null,
    cameraYaw: 0,
    shieldActive: false,
    abilityCooldown: 0,
    attackCooldown: 0,
    combatMastery: createCombatMasteryState(),
    melee: createPlayerMeleeState(),
    honestMelee: true,
    generatedRngStreams: streams,
    achievements: {
      getRunState: () => achievementState(runId, faction),
      recordGoldEarned() {},
      recordCaravanRobbed() {},
      recordKill() {},
      recordPlayerDamage() {},
      recordWorldEvent() {},
    },
    callbacks: {
      onNotice: (message: string, tone: string) => notices.push({ message, tone }),
      onSaveRequest() {},
    },
    scene: new THREE.Scene(),
    projectiles: [],
    projectileSourcesToClear: new Set(),
    updatingProjectiles: false,
    particles: [],
    finaleTelegraphs: [],
    finaleTelegraphAction: null,
    combatRng: () => 0.99,
    lootRng: () => 0.99,
    damageFlash: 0,
    screenShakeEnabled: true,
    reducedMotion: false,
  })
  Reflect.set(engine, 'actorBudget', new ActorBudget((category, count) =>
    invoke<number>(engine, 'yieldActorSlots', category, count)))
  for (const method of [
    'emitView', 'playSound', 'drawActorHealthBar', 'releaseActorTelegraph', 'removeAndDisposeObject',
    'registerNamedInteractableOutline', 'spawnDecal', 'spawnSmokeParticle', 'createBloodBurst',
    'createHitParticles', 'createSparks', 'presentPhysicalContact', 'presentCombatFeedback',
    'detachActorLimb', 'addTrauma', 'trySpawnKillLoot', 'clearFinaleThreats',
  ]) {
    Reflect.set(engine, method, () => {})
  }
  Reflect.set(engine, 'groundHeightAt', () => 0)
  Reflect.set(engine, 'isWalkablePosition', () => true)
  Reflect.set(engine, 'actorColliderRadiusForRole', () => 0.7)
  Reflect.set(engine, 'spawnActor', (
    allegiance: Allegiance,
    role: ActorRole,
    x: number,
    z: number,
    _index: number,
    options: Record<string, unknown> & { budget?: string; healthScale?: number },
  ): Body => {
    assert.ok(actors.length < MAX_ACTORS, 'a spawn went past the actor cap')
    serial += 1
    const { budget, healthScale, ...rest } = options
    const maxHp = Math.round(actorBaseHealth(role) * Math.max(0.1, healthScale ?? 1))
    const mesh = new THREE.Group()
    mesh.position.set(x, 0, z)
    const body: Body = {
      id: options.generatedSpawnId ? `generated:${String(options.generatedSpawnId)}` : `actor-${String(serial)}`,
      allegiance, role, mesh, alive: true, hp: maxHp, maxHp,
      generatedSpawnId: null, generatedRegionId: null, generatedEncounterId: null, generatedObjectiveId: null,
      generatedUnique: false, objectiveEligible: false, squadEligible: false, squadSlot: null,
      budgetCategory: budget ?? 'campaign', eventOwnerId: null, eventPropTargetId: null, aiMode: 'normal',
      hostileToPlayer: allegiance !== faction, targetId: null, playerAggro: false, aggroMemory: 0,
      rageTimer: 0, retaliationTimer: 0, alertTimer: 0, chargeWindup: 0, chargeTimer: 0,
      reinforcementTimer: 25, reinforcementsCalled: 0, phase: 0, home: mesh.position.clone(),
      wanderTarget: mesh.position.clone(), order: null, routTimer: 0, attackCooldown: 0, action: null,
      deathAt: null, healthBar: new THREE.Sprite(), healthBarTexture: new THREE.Texture(), reaction: 'none',
      reactionRemaining: 0, poise: 72, maxPoise: 72, poiseRecoveryDelay: 0, staggerImmunity: 0,
      retreatTimer: 0, alertCooldown: 10, healthBarVisibleUntil: 0, velocity: new THREE.Vector3(),
      knockbackVelocity: new THREE.Vector3(), lastHitDirection: new THREE.Vector3(0, 0, 1),
      deathStartPosition: new THREE.Vector3(), deathStartRotation: new THREE.Euler(), deathStyle: null,
      ...rest,
    }
    actors.push(body)
    return body
  })

  const probe = {
    engine,
    blueprint,
    faction,
    regions,
    plans,
    player,
    actors,
    notices,
    /** Walks to the middle of `regionId` and runs the engine's own streaming pass. */
    standIn(regionId: string): void {
      regions.update(regionId)
      const centre = centreOf(blueprint, regionId)
      player.position.set(centre.x, 0, centre.z)
      invoke(engine, 'syncGeneratedRegions')
    },
    pack: (plan: GeneratedEncounterPlan): Body[] =>
      actors.filter((actor) => actor.generatedEncounterId === plan.encounterId),
    living: (plan: GeneratedEncounterPlan): Body[] =>
      actors.filter((actor) => actor.alive && actor.generatedEncounterId === plan.encounterId),
    /** A blow from the player through the production `damageActor`. */
    strike(actor: Body, amount: number): void {
      invoke(engine, 'damageActor', actor, amount, player.position.clone(), faction, true, { attackKind: 'melee' })
    },
    /** A blow from somebody else's spear, which pays the player nothing. */
    strikeByOther(actor: Body, amount: number, by: Allegiance): void {
      invoke(engine, 'damageActor', actor, amount, player.position.clone(), by, false, { attackKind: 'melee' })
    },
    cleared: (plan: GeneratedEncounterPlan): boolean =>
      regions.getSavedDelta(String(plan.regionId))?.clearedEncounterIds.includes(plan.encounterId) ?? false,
    remnant: (plan: GeneratedEncounterPlan) =>
      describeRemnant(Reflect.get(engine, 'encounterRemnants'), plan.encounterId),
    /** The engine before W3-4: nothing remembered when the square comes back. */
    forgetEverything(): void {
      Reflect.set(engine, 'encounterRemnants', createEncounterRemnants())
    },
    gold: (): number => Reflect.get(engine, 'gold'),
  }
  return probe
}

export type Probe = ReturnType<typeof field>

/** A pack of three or more of the generator's own, outside the start and the finale squares. */
export function choosePack(probe: Probe, hostile: boolean): GeneratedEncounterPlan {
  const startRegion = String(probe.blueprint.sites.find((site) => site.id === probe.blueprint.starts[probe.faction])!.regionId)
  const finale = createFinaleIdentity(probe.blueprint, probe.faction)
  for (const list of probe.plans.values()) {
    for (const plan of list) {
      if (plan.kind === 'boss' || plan.hostileToPlayer !== hostile || plan.spawns.length < 3) continue
      if (String(plan.regionId) === startRegion || String(plan.regionId) === finale.regionId) continue
      return plan
    }
  }
  throw new Error(`no ${hostile ? 'hostile' : 'friendly'} pack of three for the ${probe.faction}`)
}

/** Wounds one member, kills another, and walks far enough for the square to stream out. */
export function woundKillAndLeave(probe: Probe, plan: GeneratedEncounterPlan) {
  probe.standIn(String(plan.regionId))
  const pack = probe.pack(plan)
  assert.equal(pack.length, plan.spawns.length, 'the whole pack is fielded on the first visit')
  // A brute can turn a frontal blow on its guard, so the wound goes to somebody else.
  const wounded = pack.find((actor) => actor.role !== 'brute')!
  const killed = pack.find((actor) => actor !== wounded)!
  probe.strike(wounded, 23)
  assert.ok(wounded.alive && wounded.hp < wounded.maxHp, 'the blow wounded without killing')
  const goldBefore = probe.gold()
  probe.strike(killed, 10_000)
  assert.equal(killed.alive, false)
  const paid = probe.gold() - goldBefore
  assert.ok(paid > 0, 'the kill paid')
  const left = { id: wounded.generatedSpawnId!, hp: wounded.hp, maxHp: wounded.maxHp }
  probe.standIn(farFrom(probe.blueprint, String(plan.regionId)))
  assert.equal(probe.pack(plan).length, 0, 'the pack left the field with its square')
  return { wounded: left, killedId: killed.generatedSpawnId!, paid }
}

