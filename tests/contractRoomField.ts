/**
 * W1-6 — a headless engine standing at a contract site, with the engine's own window of the
 * generated world streamed in around it, for the tests that ask whether a contract the player
 * has reached finds room to stage.
 *
 * The engine is a real `GameEngine` whose render, audio and actor-mesh boundaries are
 * replaced, the way `tests/contractArrival.test.ts` does it: `syncGeneratedRegions` and the
 * production spawner under it, `updateCommander`, `startContractEvent`,
 * `updateFactionContract` and the budget seams all run as they ship. The window is read off a
 * real `RegionManager`.
 *
 * W1-6's second half — the player's own idle packs out of sight stepping back for a staging,
 * `makeRoomForStaging` — is **off** unless a test asks for it with `staging: true`, so a test
 * of the commander rule measures that rule alone. Off means the engine is offered no pack to
 * step back, which is exactly the rule before it.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import {
  CAMERA_BASE_FOV,
  CAMERA_DEFAULT_PITCH,
  CAMERA_PIVOT_HEIGHT,
  cameraOrbitDistance,
} from '../src/game/cameraAccents.ts'
import {
  createGeneratedEncounterPlans,
  getBlueprintRegionBounds,
  getSiteWorldPosition2D,
  type GeneratedEncounterPlan,
} from '../src/game/content/registry.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { createDoctrineRunState, resolveDoctrineEffects } from '../src/game/run/doctrine.ts'
import {
  createHealthyBody,
  type ActorRole,
  type Allegiance,
  type Faction,
} from '../src/game/types.ts'
import { ACTOR_BUDGET, ActorBudget, MAX_ACTORS } from '../src/game/world/ActorBudget.ts'
import {
  completeObjectiveEntry,
  createCampaignContractState,
  createChronicleCommitmentState,
  createGeneratedObjectives,
  getContractStatus,
  type CampaignContractState,
} from '../src/game/world/CampaignDirector.ts'
import { createChronicleRegions, createChronicleState } from '../src/game/world/Chronicle.ts'
import { createPlayerMeleeState } from '../src/game/world/CombatResolver.ts'
import { createCombatMasteryState } from '../src/game/world/CombatMastery.ts'
import { createFinaleIdentity, createFinaleState } from '../src/game/world/FinaleDirector.ts'
import { RegionManager } from '../src/game/world/RegionManager.ts'
import { createSquadCommandState } from '../src/game/world/SquadCommand.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import type { FactionObjectiveNode, WorldBlueprint } from '../src/game/world/worldTypes.ts'

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL) {
      for (const suffix of ['.ts', '/index.ts']) {
        const url = new URL(specifier + suffix, context.parentURL)
        if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
      }
    }
    return nextResolve(specifier, context)
  },
})
export const { GameEngine } = await import('../src/game/GameEngine.ts')
hooks.deregister()

export const FRAME = 0.25
/** `GameEngine`'s `COMMANDER_REINFORCEMENT_INTERVAL`: a spawned actor's first call is this far off. */
export const COMMANDER_CALL_INTERVAL = 25
export const FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']
/** A desktop screen. */
export const CAMERA_ASPECT = 16 / 9

export type Category = 'squad' | 'campaign' | 'chronicle' | 'ambient'

export interface HeadlessActor {
  id: string
  allegiance: Allegiance
  role: ActorRole
  mesh: THREE.Group
  alive: boolean
  hp: number
  maxHp: number
  targetId: string | null
  generatedSpawnId: string | null
  generatedRegionId: string | null
  generatedEncounterId: string | null
  generatedObjectiveId: string | null
  generatedUnique: boolean
  objectiveEligible: boolean
  squadEligible: boolean
  squadSlot: number | null
  budgetCategory: Category
  eventOwnerId: string | null
  eventPropTargetId: string | null
  aiMode: string
  hostileToPlayer: boolean
  playerAggro: boolean
  aggroMemory: number
  rageTimer: number
  retaliationTimer: number
  alertTimer: number
  chargeWindup: number
  chargeTimer: number
  reinforcementTimer: number
  reinforcementsCalled: number
  phase: number
  home: THREE.Vector3
  wanderTarget: THREE.Vector3
  order: null | { kind: string; position: THREE.Vector3; timer: number }
  routTimer: number
  attackCooldown: number
  action: null | { kind: string }
  deathAt: number | null
  healthBar: THREE.Sprite
  healthBarTexture: THREE.Texture
  reaction: string
  reactionRemaining: number
  poise: number
  maxPoise: number
  velocity: THREE.Vector3
  knockbackVelocity: THREE.Vector3
}

export interface Point {
  x: number
  z: number
}

export function invoke<T = void>(engine: object, method: string, ...args: unknown[]): T {
  const callable: unknown = Reflect.get(engine, method)
  assert.equal(typeof callable, 'function', `${method} must be a production engine method`)
  return Reflect.apply(callable as (...values: unknown[]) => T, engine, args)
}

/** One generated world, its plans as the engine groups them, and its region streamer. */
export interface World {
  seed: number
  blueprint: WorldBlueprint
  manager: RegionManager
  plans: Map<Faction, Map<string, GeneratedEncounterPlan[]>>
}

const worlds = new Map<number, World>()

export function world(seed: number): World {
  const cached = worlds.get(seed)
  if (cached) return cached
  const blueprint = generateWorld(seed)
  const plans = new Map<Faction, Map<string, GeneratedEncounterPlan[]>>()
  for (const faction of FACTIONS) {
    // The constructor's grouping. Its chronicle refresh is a no-op on a fresh run, because
    // every square's control is still its territory.
    const byRegion = new Map<string, GeneratedEncounterPlan[]>()
    for (const plan of Object.values(createGeneratedEncounterPlans(blueprint, faction))) {
      const key = String(plan.regionId)
      byRegion.set(key, [...(byRegion.get(key) ?? []), plan])
    }
    plans.set(faction, byRegion)
  }
  const created: World = { seed, blueprint, manager: new RegionManager(blueprint), plans }
  worlds.set(seed, created)
  return created
}

export function siteOf(blueprint: WorldBlueprint, node: FactionObjectiveNode): Point {
  const position = getSiteWorldPosition2D(blueprint, node.siteId)
  assert.ok(position, `${node.id} has no site position`)
  return position
}

/** The square a point stands in. */
export function regionAt(blueprint: WorldBlueprint, point: Point): string {
  const regionId = blueprint.regions.find((region) => {
    const bounds = getBlueprintRegionBounds(blueprint, region.id)
    return bounds !== undefined && bounds !== null &&
      point.x >= bounds.minX && point.x <= bounds.maxX &&
      point.z >= bounds.minZ && point.z <= bounds.maxZ
  })?.id
  assert.ok(regionId, 'the point stands in a square')
  return String(regionId)
}

export interface FieldOptions {
  /** The contract the player has taken on and stands at. */
  node?: FactionObjectiveNode
  /** Simulate the 3x3 visible square, as the harness once did, instead of the engine's plus. */
  wide?: boolean
  /** Let the player's own idle packs out of sight step back for a staging. Off by default. */
  staging?: boolean
  /** Where the camera looks, as `cameraYaw`: 0 looks north (−z), π/2 east (+x). */
  yaw?: number
}

/**
 * A fresh engine with the player at `options.node`'s site (or the start), the engine's own
 * window streamed in around them, and nothing spawned yet.
 */
export function field(source: World, faction: Faction, options: FieldOptions = {}) {
  const { blueprint, manager } = source
  const graph = blueprint.objectives[faction]
  const objectives = createGeneratedObjectives(blueprint, faction)
  for (const rootId of graph.rootNodeIds) completeObjectiveEntry(objectives, rootId)
  const board: CampaignContractState = createCampaignContractState()
  const node = options.node ?? null
  if (node) {
    for (const id of node.prerequisiteIds) completeObjectiveEntry(objectives, id)
    board.pinnedNodeId = node.id
  }
  const start = siteOf(blueprint, graph.nodes.find((entry) => entry.id === graph.rootNodeIds[0])!)
  const standing = node ? siteOf(blueprint, node) : start
  manager.update(regionAt(blueprint, standing))
  const player = new THREE.Group()
  player.position.set(standing.x, 0, standing.z)
  const camera = new THREE.PerspectiveCamera(CAMERA_BASE_FOV, CAMERA_ASPECT, 0.1, 240)
  const actors: HeadlessActor[] = []
  const notices: string[] = []
  const regionIds = blueprint.regions.map((region) => String(region.id))
  const called = new Set<string>()
  let serial = 0
  const engine: object = Object.create(GameEngine.prototype)
  const generatedWorld = {
    bounds: blueprint.bounds,
    // The engine reads its window off the streamer; `wide` swaps in the visible 3x3.
    regions: {
      getSimulatedRegionIds: () =>
        options.wide ? manager.getVisibleRegionIds() : manager.getSimulatedRegionIds(),
      getVisibleRegionIds: () => manager.getVisibleRegionIds(),
      getSavedDelta: (id: string) => manager.getSavedDelta(id),
      applyRegionDelta: (id: string, delta: unknown) => manager.applyRegionDelta(id, delta),
    },
    discoveredRegionIds: [...regionIds],
    sampleHeight: () => 0,
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
  Object.assign(engine, {
    faction,
    generatedBlueprint: blueprint,
    generatedWorld,
    bridgeAmbushPlan: null,
    bridgeAmbushState: null,
    bridgeAmbushCart: null,
    player,
    actors,
    eventPropTargets: new Map(),
    simulatedGeneratedRegions: new Set<string>(),
    generatedEncounterPlans: source.plans.get(faction),
    generatedActivationSpawns: new Map(),
    parkedGeneratedSpawns: new Map(),
    parkHoldUntil: 0,
    generatedNavigationCache: new Map(),
    actorSequence: 0,
    elapsed: 30,
    paused: false,
    ended: false,
    gold: 55,
    kills: 0,
    objectives,
    threatTier: 1,
    eventCooldown: 70,
    eventSequence: 0,
    activeEvents: [],
    activeContractNodeId: null,
    contractWaitExplained: null,
    campaignContracts: board,
    chronicleCommitments: createChronicleCommitmentState(),
    chronicleRegions: createChronicleRegions(blueprint),
    chronicleState: createChronicleState(),
    chronicleContestedRegionIds: new Set(),
    chronicleProtectedRegionIds: new Set(),
    doctrines: createDoctrineRunState([]),
    doctrineEffects: resolveDoctrineEffects([]),
    finale: createFinaleState(createFinaleIdentity(blueprint, faction)),
    squadCommand: createSquadCommandState({ x: standing.x, z: standing.z, heading: 0 }, false),
    squadNavigation: new Map(),
    squadBlockedSeconds: new Map(),
    squadIntents: new Map(),
    hints: { pending: () => [] },
    lootPickups: [],
    cameraYaw: 0,
    cameraPitch: CAMERA_DEFAULT_PITCH,
    camera,
    body: createHealthyBody(),
    combatMastery: createCombatMasteryState(),
    melee: createPlayerMeleeState(),
    callbacks: {
      onNotice: (message: string) => notices.push(message),
      onSaveRequest() {},
    },
    scene: new THREE.Scene(),
    projectiles: [],
    projectileSourcesToClear: new Set(),
    updatingProjectiles: false,
    particles: [],
    materializeCooldown: Number.POSITIVE_INFINITY,
    materializedSituationIds: new Set(),
    seenAftermathRegionIds: new Set(),
    locatedEventCopy: new Map(),
    finaleTelegraphs: [],
    finaleTelegraphAction: null,
  })
  const stream = new RandomStream(3)
  Reflect.set(engine, 'generatedRngStreams', {
    combat: new RandomStream(1),
    director: new RandomStream(2),
    event: stream,
    loot: new RandomStream(4),
    chronicle: new RandomStream(5),
    rumour: new RandomStream(6),
    injury: new RandomStream(7),
  })
  Reflect.set(engine, 'eventRng', () => stream.next())
  Reflect.set(engine, 'actorBudget', new ActorBudget((category, count) =>
    invoke<number>(engine, 'yieldActorSlots', category, count)))
  for (const method of [
    'emitView',
    'playSound',
    'drawActorHealthBar',
    'releaseActorTelegraph',
    'removeAndDisposeObject',
    'registerNamedInteractableOutline',
    'spawnDecal',
    'spawnSmokeParticle',
  ]) {
    Reflect.set(engine, method, () => {})
  }
  Reflect.set(engine, 'groundHeightAt', () => 0)
  Reflect.set(engine, 'isWalkablePosition', () => true)
  Reflect.set(engine, 'createHouseFireEffect', () => new THREE.Group())
  Reflect.set(engine, 'createBeastLairEffect', () => new THREE.Group())
  // Off: nobody is offered to step back, which is the rule before W1-6's second half.
  if (!options.staging) Reflect.set(engine, 'standAsidePacks', () => [])
  const spawn = (
    allegiance: Allegiance,
    role: ActorRole,
    x: number,
    z: number,
    category: Category,
    extra: Partial<HeadlessActor> = {},
  ): HeadlessActor => {
    assert.ok(actors.length < MAX_ACTORS, 'a spawn went past the actor cap')
    serial += 1
    const mesh = new THREE.Group()
    mesh.position.set(x, 0, z)
    const spawned: HeadlessActor = {
      id: `actor-${String(serial)}`,
      allegiance,
      role,
      mesh,
      alive: true,
      hp: 60,
      maxHp: 60,
      targetId: null,
      generatedSpawnId: null,
      generatedRegionId: null,
      generatedEncounterId: null,
      generatedObjectiveId: null,
      generatedUnique: false,
      objectiveEligible: false,
      squadEligible: false,
      squadSlot: null,
      budgetCategory: category,
      eventOwnerId: null,
      eventPropTargetId: null,
      aiMode: 'normal',
      hostileToPlayer: allegiance !== faction,
      playerAggro: false,
      aggroMemory: 0,
      rageTimer: 0,
      retaliationTimer: 0,
      alertTimer: 0,
      chargeWindup: 0,
      chargeTimer: 0,
      // `spawnActor`'s own start: the first call comes a full interval after spawning.
      reinforcementTimer: COMMANDER_CALL_INTERVAL,
      reinforcementsCalled: 0,
      phase: 0,
      home: mesh.position.clone(),
      wanderTarget: mesh.position.clone(),
      order: null,
      routTimer: 0,
      attackCooldown: 0,
      action: null,
      deathAt: null,
      healthBar: new THREE.Sprite(),
      healthBarTexture: new THREE.Texture(),
      reaction: 'none',
      reactionRemaining: 0,
      poise: 72,
      maxPoise: 72,
      velocity: new THREE.Vector3(),
      knockbackVelocity: new THREE.Vector3(),
      ...extra,
    }
    actors.push(spawned)
    return spawned
  }
  Reflect.set(engine, 'spawnActor', (
    allegiance: Allegiance,
    role: ActorRole,
    x: number,
    z: number,
    _index: number,
    options: Partial<HeadlessActor> & { budget?: Category },
  ) => {
    const { budget, ...rest } = options
    const spawned = spawn(allegiance, role, x, z, budget ?? 'campaign', rest)
    // A commander's call is the one engine spawn with neither a generator slot nor an event.
    if (options.generatedEncounterId === undefined && options.eventOwnerId === undefined) {
      called.add(spawned.id)
    }
    return spawned
  })

  const probe = {
    engine,
    blueprint,
    faction,
    node,
    player,
    camera,
    actors,
    notices,
    spawn,
    /** The squad that walked here with the player. */
    squad(count = ACTOR_BUDGET.squad): HeadlessActor[] {
      return Array.from({ length: count }, (_, index) =>
        spawn(faction, 'soldier', standing.x + 1 + index, standing.z + 1, 'squad', {
          squadEligible: true,
          hostileToPlayer: false,
        }))
    },
    /**
     * Turns the view to `yaw` and poses the camera the way `updateCamera` does at rest:
     * `cameraOrbitDistance` back along the aim at `CAMERA_DEFAULT_PITCH`, looking along the
     * view direction.
     */
    face(yaw: number): void {
      Reflect.set(engine, 'cameraYaw', yaw)
      Reflect.set(engine, 'cameraPitch', CAMERA_DEFAULT_PITCH)
      const orbit = cameraOrbitDistance(camera.aspect)
      const behind = orbit * Math.cos(CAMERA_DEFAULT_PITCH)
      camera.position.set(
        player.position.x - Math.sin(yaw) * behind,
        CAMERA_PIVOT_HEIGHT + orbit * Math.sin(CAMERA_DEFAULT_PITCH),
        player.position.z + Math.cos(yaw) * behind,
      )
      const view = invoke<THREE.Vector3>(engine, 'getViewDirection')
      camera.lookAt(camera.position.clone().add(view))
    },
    /** The engine's own streaming pass: the window's packs, through the production spawner. */
    streamIn(): void {
      invoke(engine, 'syncGeneratedRegions')
    },
    commanders: (): HeadlessActor[] =>
      actors.filter((actor) => actor.alive && actor.role === 'commander'),
    /** The soldiers a commander's call put on the field, and nobody else. */
    reinforcements: (): HeadlessActor[] => actors.filter((actor) => called.has(actor.id)),
    usage: (): Record<Category, number> => invoke(engine, 'actorUsageByCategory'),
    chronicleRoom: (): number => invoke<number>(engine, 'chronicleCapacity'),
    /** The spawns standing back from each square, as the engine keeps them. */
    parked: (): Map<string, Set<string>> => Reflect.get(engine, 'parkedGeneratedSpawns'),
    /** `seconds` of the production `updateCommander` for every living commander. */
    residency(seconds: number): void {
      const steps = Math.round(seconds / FRAME)
      for (let step = 0; step < steps; step += 1) {
        Reflect.set(engine, 'elapsed', Reflect.get(engine, 'elapsed') + FRAME)
        for (const commander of probe.commanders()) {
          invoke(engine, 'updateCommander', commander, FRAME)
        }
      }
    },
    status: (target: FactionObjectiveNode) =>
      getContractStatus(Reflect.get(engine, 'campaignContracts'), target),
    /** The engine's own contract frames, as `update` runs them. */
    contractFrames(seconds: number): void {
      const steps = Math.round(seconds / 0.1)
      for (let step = 0; step < steps; step += 1) {
        Reflect.set(engine, 'elapsed', Reflect.get(engine, 'elapsed') + 0.1)
        invoke(engine, 'updateFactionContract', 0.1)
      }
    },
  }
  probe.face(options.yaw ?? 0)
  return probe
}

export type Probe = ReturnType<typeof field>
