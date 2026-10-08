/**
 * W1-1 — the contract the player chose starts when they arrive, and the game's own random
 * events cannot cancel it.
 *
 * Everything below drives production engine methods — `updateFactionContract`,
 * `updateEvents`, `startRandomEvent` and the shipped builders it calls, `yieldActorSlots`,
 * `materializeCaravanBeat` and `saveGeneratedRun` — on an engine whose render, audio and
 * actor-mesh boundaries are replaced, the way `tests/caravanBeats.test.ts` does it. Every
 * claim carries a negative control: the pre-W1-1 rule is put back on the instance, and the
 * same assertion has to fail against it.
 *
 * The world is the live reproduction's: seed 20261006, the villain. «Жирный корован»
 * (`plunder`) is the signature arm at the B2 settlement and «Пепелище с гостями»
 * (`scavenge`) the alternative at C5. On `4963002` a bounty rolled at 0:30, the villain
 * reached B2 at 0:42, and at about 0:54 the contract was abandoned with «не тот час, не то
 * место» while the C5 arm read «Мимо».
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import { getBlueprintRegionBounds, getSiteWorldPosition2D } from '../src/game/content/registry.ts'
import {
  RICH_CARAVAN_CONFISCATE_DESCRIPTION,
  CARAVAN_CONFISCATE_PROMPT,
  RICH_CARAVAN_CONFISCATED_NOTICE,
  RICH_CARAVAN_LOOT_TAKEN_NOTICE,
  WORLD_EVENT_FAILURE_MESSAGES,
  describeContractAbandoned,
  describeContractQueued,
  describeContractStarted,
  describeContractTitle,
  describeContractWaitsForEvent,
  describeEventHandbackForContract,
  describeRandomEventStoodDown,
  describeRichCaravanConfiscated,
  formatRegionGridLabel,
  generatedSiteLabel,
} from '../src/game/content/gameCopy.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { createDoctrineRunState, resolveDoctrineEffects } from '../src/game/run/doctrine.ts'
import type { ActiveRunSaveV3 } from '../src/game/run/runTypes.ts'
import {
  createHealthyBody,
  type ActorRole,
  type Allegiance,
  type Faction,
  type RandomWorldEventKind,
  type WorldEventKind,
} from '../src/game/types.ts'
import { ActorBudget, MAX_ACTORS } from '../src/game/world/ActorBudget.ts'
import { attachCaravanBeats } from './caravanBeatFixture.ts'
import {
  CONTRACT_TEMPLATES,
  EVENT_RETRY,
  WORLD_EVENT_REWARDS,
  completeObjectiveEntry,
  createCampaignContractState,
  createChronicleCommitmentState,
  createGeneratedObjectives,
  eventCooldownRange,
  getContractNodes,
  getContractStatus,
  normalizeCampaignContractState,
  type CampaignContractState,
} from '../src/game/world/CampaignDirector.ts'
import { createChronicleRegions, createChronicleState } from '../src/game/world/Chronicle.ts'
import { createPlayerMeleeState } from '../src/game/world/CombatResolver.ts'
import { createCombatMasteryState } from '../src/game/world/CombatMastery.ts'
import { ExpeditionPlanner } from '../src/game/world/ExpeditionPlanner.ts'
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
const { GameEngine } = await import('../src/game/GameEngine.ts')
hooks.deregister()

const SEED = 20_261_006
const FRAME = 0.1
/** Read-only for the engine; generated once so every fixture stands in the same world. */
const BLUEPRINT = generateWorld(SEED)
/** The longest start grace any shipped template has, plus a margin. */
const PAST_GRACE = Math.max(
  ...Object.values(CONTRACT_TEMPLATES).map((template) => template.startGraceSeconds),
) + 3

type Category = 'squad' | 'campaign' | 'chronicle' | 'ambient'

interface HeadlessActor {
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
  home: THREE.Vector3
  wanderTarget: THREE.Vector3
  order: null | { kind: string; position: THREE.Vector3; timer: number }
  routTimer: number
  attackCooldown: number
  action: null
  deathAt: number | null
  healthBar: THREE.Sprite
  healthBarTexture: THREE.Texture
  // What the production damage and death paths read and write.
  reaction: string
  reactionRemaining: number
  poise: number
  maxPoise: number
  poiseRecoveryDelay: number
  staggerImmunity: number
  retreatTimer: number
  alertCooldown: number
  chargeTimer: number
  healthBarVisibleUntil: number
  velocity: THREE.Vector3
  knockbackVelocity: THREE.Vector3
  lastHitDirection: THREE.Vector3
  deathStartPosition: THREE.Vector3
  deathStartRotation: THREE.Euler
  deathStyle: string | null
}

interface LiveEvent {
  id: string
  kind: WorldEventKind
  anchor: 'player' | 'located'
  state: 'active' | 'succeeded' | 'failed'
  title: string
  timer: number | null
  contractNodeId?: string | null
  ownedActorIds: string[]
  markerPos: THREE.Vector3
  onKill?(actor: HeadlessActor, context: unknown): void
}

interface Notice {
  message: string
  tone: string
}

interface Point {
  x: number
  z: number
}

function invoke<T = void>(engine: object, method: string, ...args: unknown[]): T {
  const callable: unknown = Reflect.get(engine, method)
  assert.equal(typeof callable, 'function', `${method} must be a production engine method`)
  return Reflect.apply(callable as (...values: unknown[]) => T, engine, args)
}

function achievementState(runId: string, faction: Faction) {
  return {
    runId,
    faction,
    startedAt: '2026-10-06T10:00:00.000Z',
    kills: 0,
    killsSinceDamage: 0,
    bestKillStreak: 0,
    damageTaken: 0,
    injuries: 0,
    limbsLost: 0,
    goldEarned: 0,
    purchases: 0,
    objectivesCompleted: 0,
    eventsCompleted: 0,
    abilitiesUsed: 0,
    shieldBlocks: 0,
    squadCommands: 0,
    caravansRobbed: 0,
    zonesVisited: ['neutral' as const],
    eventKindsCompleted: [],
    unlockedIds: [],
    result: null,
    elapsedAtEnd: 0,
    healthAtEnd: 0,
  }
}

/**
 * The live engine, from the bridge-ambush harness, with the event director's own state on
 * it. The event stream is the real seeded one; `forceRoll` puts one sample in front of it
 * so a test can say which random event the director picks without editing the weights.
 */
function fixture(faction: Faction = 'villain', contracts?: CampaignContractState) {
  const blueprint = BLUEPRINT
  const graph = blueprint.objectives[faction]
  const [signature, alternative] = getContractNodes(blueprint, faction)
  const objectives = createGeneratedObjectives(blueprint, faction)
  for (const rootId of graph.rootNodeIds) completeObjectiveEntry(objectives, rootId)
  const board = contracts ?? createCampaignContractState()
  if (!contracts) board.pinnedNodeId = signature.id
  const start = siteOf(blueprint, graph.nodes.find((node) => node.id === graph.rootNodeIds[0])!)
  const player = new THREE.Group()
  player.position.set(start.x, 0, start.z)
  const actors: HeadlessActor[] = []
  const notices: Notice[] = []
  const worldEvents: Array<{ kind: string; succeeded: boolean }> = []
  const goldEarned: number[] = []
  const regions = new RegionManager(blueprint)
  const regionIds = blueprint.regions.map((region) => String(region.id))
  const runId = `contract-arrival-${faction}`
  const streams = {
    combat: new RandomStream(1),
    director: new RandomStream(2),
    event: new RandomStream(3),
    loot: new RandomStream(4),
    chronicle: new RandomStream(5),
    rumour: new RandomStream(6),
    injury: new RandomStream(7),
  }
  const eventDraws = { count: 0, forced: [] as number[] }
  const walkable = { value: true }
  let serial = 0
  const engine: object = Object.create(GameEngine.prototype)
  const generatedWorld = {
    bounds: blueprint.bounds,
    regions,
    discoveredRegionIds: [...regionIds],
    sampleHeight: () => 0,
    getBiomeAt: () => 'fort',
    getRegionIdAt: (x: number, z: number) => regionIds.find((id) => {
      const bounds = getBlueprintRegionBounds(blueprint, id)
      return bounds !== undefined && bounds !== null &&
        x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
    }),
    getRegionBounds: (id: string) => getBlueprintRegionBounds(blueprint, id),
    getRegionCenter: (id: string) => {
      const bounds = getBlueprintRegionBounds(blueprint, id)
      return bounds
        ? { x: (bounds.minX + bounds.maxX) / 2, y: 0, z: (bounds.minZ + bounds.maxZ) / 2 }
        : undefined
    },
    getSitePosition: (id: string) => {
      const position = getSiteWorldPosition2D(blueprint, id)
      return position ? { ...position, y: 0 } : undefined
    },
  }
  Object.assign(engine, {
    faction,
    generatedBlueprint: blueprint,
    generatedWorld,
    generatedRun: {
      runId,
      config: {
        seed: blueprint.seed,
        generatorVersion: blueprint.generatorVersion,
        faction,
        selectedBoonId: 'provisions',
      },
      startedAt: '2026-10-06T10:00:00.000Z',
    },
    player,
    actors,
    eventPropTargets: new Map(),
    simulatedGeneratedRegions: new Set(regionIds),
    generatedEncounterPlans: new Map(),
    generatedActivationSpawns: new Map(),
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
    objectives,
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
    eventRng: () => {
      eventDraws.count += 1
      return eventDraws.forced.shift() ?? streams.event.next()
    },
    achievements: {
      getRunState: () => achievementState(runId, faction),
      recordGoldEarned: (amount: number) => goldEarned.push(amount),
      recordCaravanRobbed() {},
      recordKill() {},
      recordPlayerDamage() {},
      recordWorldEvent: (kind: string, succeeded: boolean) => worldEvents.push({ kind, succeeded }),
    },
    callbacks: {
      onNotice: (message: string, tone: string) => notices.push({ message, tone }),
      onSaveRequest() {},
    },
    scene: new THREE.Scene(),
    projectiles: [],
    projectileSourcesToClear: new Set(),
    updatingProjectiles: false,
    squadNavigationRevision: '',
    particles: [],
    // The chronicle's own materialization is not under test here; located events are
    // put on the ground explicitly where a test needs one.
    materializeCooldown: Number.POSITIVE_INFINITY,
    materializedSituationIds: new Set(),
    seenAftermathRegionIds: new Set(),
    locatedEventCopy: new Map(),
    generatedCaravanTravelDirection: new THREE.Vector2(1, 0),
    characterHeightSample: () => 0,
    // The damage paths: no injury rolls, legacy presentation, nothing on screen.
    combatRng: () => 0.99,
    damageFlash: 0,
    screenShakeEnabled: true,
    reducedMotion: false,
    lastPlayerDamageRole: null,
    lastPlayerDamageAllegiance: null,
    bledOut: false,
  })
  Reflect.set(engine, 'actorBudget', new ActorBudget((category, count) =>
    invoke<number>(engine, 'yieldActorSlots', category, count)))
  const beat = attachCaravanBeats(engine, blueprint, faction)
  const plan = beat.plan
  const bridgeState = beat.state
  const cart = beat.cart
  for (const method of [
    'emitView',
    'playSound',
    'drawActorHealthBar',
    'releaseActorTelegraph',
    'removeAndDisposeObject',
    'registerNamedInteractableOutline',
    'resumeAudio',
    'spawnDecal',
    'spawnSmokeParticle',
    'spawnEventLoot',
    'createBloodBurst',
    'createHitParticles',
    'createSparks',
    'presentPhysicalContact',
    'presentCombatFeedback',
    'detachActorLimb',
    'addTrauma',
    'interruptFinaleAttack',
  ]) {
    Reflect.set(engine, method, () => {})
  }
  Reflect.set(engine, 'groundHeightAt', () => 0)
  Reflect.set(engine, 'isWalkablePosition', () => walkable.value)
  Reflect.set(engine, 'actorColliderRadiusForRole', () => 0.7)
  Reflect.set(engine, 'createHouseFireEffect', () => new THREE.Group())
  Reflect.set(engine, 'createCaravan', () => {
    const group = new THREE.Group()
    const cargo = new THREE.Mesh()
    cargo.name = 'cargo'
    group.add(cargo)
    return group
  })
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
      poiseRecoveryDelay: 0,
      staggerImmunity: 0,
      retreatTimer: 0,
      alertCooldown: 10,
      chargeTimer: 0,
      healthBarVisibleUntil: 0,
      velocity: new THREE.Vector3(),
      knockbackVelocity: new THREE.Vector3(),
      lastHitDirection: new THREE.Vector3(0, 0, 1),
      deathStartPosition: new THREE.Vector3(),
      deathStartRotation: new THREE.Euler(),
      deathStyle: null,
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
    return spawn(allegiance, role, x, z, budget ?? 'campaign', rest)
  })

  const contractState = (): CampaignContractState => Reflect.get(engine, 'campaignContracts')
  const events = (): LiveEvent[] => Reflect.get(engine, 'activeEvents')
  const probe = {
    engine,
    blueprint,
    faction,
    signature,
    alternative,
    start,
    player,
    actors,
    notices,
    worldEvents,
    goldEarned,
    eventDraws,
    walkable,
    plan,
    bridgeState,
    cart,
    beat,
    spawn,
    events,
    contractState,
    status: (node: FactionObjectiveNode) => getContractStatus(contractState(), node),
    progress: (node: FactionObjectiveNode) =>
      contractState().contracts.find((entry) => entry.nodeId === node.id),
    anchored: () => events().filter((event) => event.anchor === 'player' && !event.contractNodeId),
    contractEvent: () => events().find((event) => event.contractNodeId),
    gold: (): number => Reflect.get(engine, 'gold'),
    eventCooldown: (): number => Reflect.get(engine, 'eventCooldown'),
    standAt(point: Point, towards: Point | null = null, distance = 0) {
      if (!towards) {
        player.position.set(point.x, 0, point.z)
        return
      }
      const length = Math.hypot(towards.x - point.x, towards.z - point.z)
      player.position.set(
        point.x + ((towards.x - point.x) / length) * distance,
        0,
        point.z + ((towards.z - point.z) / length) * distance,
      )
    },
    /** The engine's own order: contracts first, then the event director. */
    frames(seconds: number, { director = true } = {}) {
      const steps = Math.round(seconds / FRAME)
      for (let step = 0; step < steps; step += 1) {
        Reflect.set(engine, 'elapsed', Reflect.get(engine, 'elapsed') + FRAME)
        invoke(engine, 'updateFactionContract', FRAME)
        if (director) invoke(engine, 'updateEvents', FRAME)
      }
    },
    /** One real roll of the director, with the kind chosen by the sample in front. */
    rollRandomEvent(kind: RandomWorldEventKind): LiveEvent {
      const rolls: Record<RandomWorldEventKind, number> = {
        richCaravan: 0,
        defendHome: 0.2,
        champion: 0.4,
        rescue: 0.7,
        bounty: 0.999,
      }
      Reflect.set(engine, 'eventCooldown', 0)
      eventDraws.forced.push(rolls[kind])
      invoke(engine, 'updateEvents', FRAME)
      const [rolled] = events().filter((event) => event.anchor === 'player' && !event.contractNodeId)
      assert.ok(rolled, `the director did not roll a ${kind}`)
      assert.equal(rolled.kind, kind)
      return rolled
    },
  }
  return probe
}

type Probe = ReturnType<typeof fixture>

function siteOf(blueprint: WorldBlueprint, node: FactionObjectiveNode): Point {
  const position = getSiteWorldPosition2D(blueprint, node.siteId)
  assert.ok(position, `${node.id} has no site position`)
  return position
}

function regionLabel(blueprint: WorldBlueprint, regionId: string): string {
  const region = blueprint.regions.find((candidate) => String(candidate.id) === regionId)
  assert.ok(region)
  return formatRegionGridLabel(region.coordinate.x, region.coordinate.y)
}

function copyContext(probe: Probe, node: FactionObjectiveNode) {
  const site = probe.blueprint.sites.find((candidate) => candidate.id === node.siteId)
  return {
    regionLabel: regionLabel(probe.blueprint, String(node.regionId)),
    siteLabel: site ? generatedSiteLabel(site.kind) : null,
  }
}

/** Puts the pre-W1-1 start gate back: any player-anchored event blocks, and grace burns. */
function restoreLegacyAnchoredGate(probe: Probe): void {
  const shipped = Reflect.get(probe.engine, 'startContractEvent') as (...args: unknown[]) => string
  Reflect.set(probe.engine, 'startContractEvent', function legacy(this: object, ...args: unknown[]) {
    return Reflect.get(this, 'playerAnchoredEvent') ? 'crowded' : Reflect.apply(shipped, this, args)
  })
}

/** `GameEngine`'s `EVENT_ENGAGEMENT_WINDOW`: a fight lasts this long after the last blow. */
const ENGAGEMENT_WINDOW = 10

/** Puts the pre-carve-out rule back: every random event is stood down on arrival. */
function ignoreEngagement(probe: Probe): void {
  Reflect.set(probe.engine, 'isPlayerEngagedWith', () => false)
}

function ownedActor(probe: Probe, event: LiveEvent, index = 0): HeadlessActor {
  const owned = probe.actors.find((candidate) => candidate.id === event.ownedActorIds[index])
  assert.ok(owned, `${event.kind} has no actor ${String(index)}`)
  return owned
}

/** One blow each way, through the production `damageActor` and `damagePlayer`. */
function tradeBlows(probe: Probe, actor: HeadlessActor): void {
  invoke(probe.engine, 'damageActor', actor, 1, probe.player.position.clone(), probe.faction, true, {
    attackKind: 'melee',
  })
  invoke(probe.engine, 'damagePlayer', 1, new THREE.Vector3(0, 0, 1), false, {
    attackKind: 'allyMelee',
    sourceActorId: actor.id,
    source: { role: actor.role, allegiance: actor.allegiance },
  })
}

function strikeDown(probe: Probe, actor: HeadlessActor): void {
  invoke(probe.engine, 'damageActor', actor, actor.hp + 1, probe.player.position.clone(), probe.faction, true, {
    attackKind: 'melee',
  })
}

/**
 * Walks the player onto the signature contract's site with `actor` alongside. One frame is
 * spent just outside the trigger ring first, so the event's marker follows its actor the
 * way it does every frame in play.
 */
function arriveAlongside(probe: Probe, actor: HeadlessActor): void {
  const site = siteOf(probe.blueprint, probe.signature)
  probe.standAt(site, probe.start, 35)
  actor.mesh.position.set(probe.player.position.x + 3, 0, probe.player.position.z)
  probe.frames(FRAME)
  probe.standAt(site)
  actor.mesh.position.set(site.x + 3, 0, site.z)
}

/** A located chronicle fight with `size` chronicle actors, built by the engine's own factory. */
function placeLocatedFight(probe: Probe, at: Point, size: number): LiveEvent {
  const regionId = String(invoke<string | null>(probe.engine, 'generatedRegionIdAt', at.x, at.z))
  const id = `test-warband-${regionId}-${String(probe.events().length)}`
  const ownedActorIds: string[] = []
  for (let index = 0; index < size; index += 1) {
    ownedActorIds.push(
      probe.spawn('guard', 'soldier', at.x + index, at.z, 'chronicle', { eventOwnerId: id }).id,
    )
  }
  const event = invoke<LiveEvent>(probe.engine, 'createWorldEvent', {
    id,
    kind: 'warband',
    anchor: 'located',
    regionId,
    situationId: null,
    state: 'active',
    title: 'Чужая ватага',
    description: 'Тест.',
    tone: 'warning',
    timer: 150,
    progress: 0,
    target: size,
    markerId: `${id}-marker`,
    markerPos: new THREE.Vector3(at.x, 0, at.z),
    ownedActorIds,
    ownedProps: [],
    handBack: () => [],
  })
  probe.events().push(event)
  return event
}

function fill(probe: Probe, category: Category, count: number, at: Point): void {
  for (let index = 0; index < count; index += 1) {
    probe.spawn(
      category === 'squad' ? probe.faction : 'guard',
      'soldier',
      at.x + index * 0.5,
      at.z + 60,
      category,
      category === 'squad' ? { squadEligible: true, hostileToPlayer: false } : {},
    )
  }
}

/**
 * The repro, up to the moment that decided it: the director rolls `kind` with the player
 * still far from B2, then the player walks onto the site with it running.
 */
function arriveDuring(kind: RandomWorldEventKind, legacy = false) {
  const probe = fixture('villain')
  if (legacy) restoreLegacyAnchoredGate(probe)
  const site = siteOf(probe.blueprint, probe.signature)
  // At the villain camp, about 219 m from B2 — outside the quiet radius, so the director
  // rolls exactly as it did at 0:30 in the live run.
  assert.ok(Math.hypot(site.x - probe.start.x, site.z - probe.start.z) > 200)
  const interrupted = probe.rollRandomEvent(kind)
  const interruptedActors = [...interrupted.ownedActorIds]
  probe.frames(2)
  assert.equal(interrupted.state, 'active', 'the random event must still be running on arrival')
  probe.standAt(site)
  probe.frames(FRAME)
  const atArrival = {
    status: probe.status(probe.signature),
    anchored: probe.anchored().map((event) => event.kind),
    cooldown: probe.eventCooldown(),
  }
  probe.frames(PAST_GRACE)
  return { probe, interrupted, interruptedActors, atArrival }
}

function assertContractOutrankedTheEvent(outcome: ReturnType<typeof arriveDuring>): void {
  const { probe, interrupted, interruptedActors, atArrival } = outcome
  assert.equal(atArrival.status, 'active', 'the contract did not start on arrival')
  assert.deepEqual(atArrival.anchored, [], 'the random event was still running after the start')
  assert.equal(probe.status(probe.signature), 'active', 'the contract did not survive its grace')
  const live = probe.contractEvent()
  assert.ok(live, 'no contract event on the ground')
  assert.equal(live.contractNodeId, probe.signature.id)
  assert.equal(live.title, describeContractTitle('plunder'))
  // Stood down, not failed: no failure line, no failed-event stat, no reward, no actors left.
  assert.ok(!probe.events().includes(interrupted))
  assert.ok(interruptedActors.every((id) => !probe.actors.some((actor) => actor.id === id)))
  assert.deepEqual(probe.worldEvents, [], 'standing down wrote an event stat')
  assert.equal(probe.gold(), 55)
  assert.deepEqual(probe.goldEarned, [])
  const messages = probe.notices.map((notice) => notice.message)
  assert.ok(messages.includes(describeRandomEventStoodDown(interrupted.title)))
  assert.ok(messages.includes(describeContractStarted('plunder')))
  assert.ok(!messages.includes(WORLD_EVENT_FAILURE_MESSAGES[interrupted.kind as RandomWorldEventKind]))
  assert.ok(!messages.some((message) => message.includes('так и не собрался')))
  assert.ok(probe.notices.every((notice) => notice.tone !== 'danger'), 'a stand-down sounded like a loss')
  // The cooldown is floored as a save floors it — exactly the minimum, so nothing was rolled.
  assert.equal(atArrival.cooldown, eventCooldownRange(1).min)
}

test('a bounty or a champion running on arrival is stood down and the contract starts', () => {
  for (const kind of ['bounty', 'champion', 'rescue', 'richCaravan'] as const) {
    assertContractOutrankedTheEvent(arriveDuring(kind))
  }
  // The champion is the case that used to block every contract: it has no clock at all.
  const champion = arriveDuring('champion')
  assert.equal(champion.interrupted.timer, null)
})

test('**negative control**: the pre-W1-1 gate loses the same contract to the same event', () => {
  for (const kind of ['bounty', 'champion'] as const) {
    const legacy = arriveDuring(kind, true)
    assert.throws(() => assertContractOutrankedTheEvent(legacy), assert.AssertionError)
    // And it lost it the way the live run did: abandoned on site, with the random event
    // still on the ground and the payout gone.
    assert.equal(legacy.probe.status(legacy.probe.signature), 'failed')
    assert.ok(legacy.probe.events().includes(legacy.interrupted))
    assert.ok(legacy.probe.notices.some((notice) => notice.message.includes('так и не собрался')))
  }
})

test('no random event is rolled near the un-started contract the player is heading for', () => {
  const probe = fixture('villain')
  const site = siteOf(probe.blueprint, probe.signature)
  // 100 m out on the road from camp: inside the quiet radius, well outside the trigger ring.
  probe.standAt(site, probe.start, 100)
  Reflect.set(probe.engine, 'eventCooldown', 0)
  const drawsBefore = probe.eventDraws.count
  const streamBefore = Reflect.get(probe.engine, 'generatedRngStreams').event.getState()
  probe.frames(45)
  assert.deepEqual(probe.anchored(), [], 'the director rolled beside the contract')
  assert.ok(probe.eventCooldown() <= EVENT_RETRY)
  assert.equal(probe.eventDraws.count, drawsBefore, 'a held director drew from the event stream')
  assert.deepEqual(Reflect.get(probe.engine, 'generatedRngStreams').event.getState(), streamBefore)
  assert.equal(probe.status(probe.signature), 'offered')

  // Non-vacuity: the same director, the same contract, 135 m out — it rolls within one retry.
  probe.standAt(site, probe.start, 135)
  probe.frames(EVENT_RETRY + 1)
  assert.equal(probe.anchored().length, 1, 'the hold is not limited to the quiet radius')

  // Negative control: without the hold the director rolls at 100 m, right where the
  // contract is about to need the player.
  const control = fixture('villain')
  Reflect.set(control.engine, 'contractHoldsRandomEvents', () => false)
  control.standAt(site, control.start, 100)
  Reflect.set(control.engine, 'eventCooldown', 0)
  control.frames(1)
  assert.equal(control.anchored().length, 1)
})

test('nothing is rolled while a contract is on the ground, even a located one far behind', () => {
  const probe = fixture('villain')
  invoke(probe.engine, 'pinObjective', probe.alternative.id)
  const site = siteOf(probe.blueprint, probe.alternative)
  probe.standAt(site)
  probe.frames(FRAME)
  assert.equal(probe.status(probe.alternative), 'active')
  const live = probe.contractEvent()
  assert.ok(live)
  // `scavenge` is a located builder: it never held the director the way an anchored one did.
  assert.equal(live.anchor, 'located')
  probe.standAt(site, probe.start, 150)
  Reflect.set(probe.engine, 'eventCooldown', 0)
  probe.frames(30)
  assert.deepEqual(probe.anchored(), [])
  assert.equal(probe.status(probe.alternative), 'active')

  const control = fixture('villain')
  invoke(control.engine, 'pinObjective', control.alternative.id)
  control.standAt(site)
  control.frames(FRAME)
  assert.equal(control.status(control.alternative), 'active')
  Reflect.set(control.engine, 'contractHoldsRandomEvents', () => false)
  control.standAt(site, control.start, 150)
  Reflect.set(control.engine, 'eventCooldown', 0)
  control.frames(1)
  assert.equal(control.anchored().length, 1, 'the control never rolled, so it proves nothing')
})

test('the arm the player did not take keeps its patience, and a genuine stall names its reason', () => {
  // Pinned on B2; loitering on the C5 site of the arm not taken must not abandon it.
  const probe = fixture('villain')
  probe.standAt(siteOf(probe.blueprint, probe.alternative))
  probe.frames(PAST_GRACE + 5)
  assert.equal(probe.status(probe.alternative), 'offered')
  assert.equal(probe.progress(probe.alternative)?.waited, 0)
  assert.ok(!probe.notices.some((notice) => notice.message.includes('так и не собрался')))

  // Negative control: the same seconds on the same site do abandon it once it is the arm
  // taken and the builder genuinely cannot stage it — and the notice says why.
  const stalled = fixture('villain')
  invoke(stalled.engine, 'pinObjective', stalled.alternative.id)
  stalled.walkable.value = false
  stalled.standAt(siteOf(stalled.blueprint, stalled.alternative))
  let abandonedAfter = 0
  for (let seconds = 0; seconds < PAST_GRACE + 5; seconds += FRAME) {
    stalled.frames(FRAME)
    if (stalled.status(stalled.alternative) === 'failed') {
      abandonedAfter = seconds + FRAME
      break
    }
  }
  const grace = CONTRACT_TEMPLATES.scavenge.startGraceSeconds
  assert.ok(Math.abs(abandonedAfter - grace) <= FRAME * 1.5, `abandoned after ${String(abandonedAfter)} s`)
  assert.ok(stalled.notices.some((notice) => notice.message === describeContractAbandoned(
    'scavenge', copyContext(stalled, stalled.alternative), 'noGround',
  )))
})

test('the chronicle makes room for the contract, farthest fight first', () => {
  const probe = fixture('villain')
  const site = siteOf(probe.blueprint, probe.signature)
  fill(probe, 'squad', 3, site)
  fill(probe, 'campaign', 12, site)
  const near = placeLocatedFight(probe, { x: site.x + 40, z: site.z }, 4)
  const far = placeLocatedFight(probe, { x: site.x + 140, z: site.z + 60 }, 4)
  fill(probe, 'ambient', 2, site)
  assert.equal(probe.actors.length, MAX_ACTORS)
  probe.standAt(site)
  probe.frames(FRAME)
  assert.equal(probe.status(probe.signature), 'active')
  assert.ok(probe.events().includes(near), 'a nearer fight was handed back while a farther one would do')
  assert.ok(!probe.events().includes(far), 'the farthest fight was not the one handed back')
  assert.ok(probe.notices.some((notice) => notice.message === describeEventHandbackForContract(
    regionLabel(probe.blueprint, String(Reflect.get(far, 'regionId'))),
  )))
  assert.ok(probe.actors.length <= MAX_ACTORS)

  // Negative control: without the reclaim the same crowd starves the builder, and the
  // contract is abandoned for being crowded out.
  const control = fixture('villain')
  fill(control, 'squad', 3, site)
  fill(control, 'campaign', 12, site)
  placeLocatedFight(control, { x: site.x + 40, z: site.z }, 4)
  placeLocatedFight(control, { x: site.x + 140, z: site.z + 60 }, 4)
  fill(control, 'ambient', 2, site)
  Reflect.set(control.engine, 'reclaimChronicleSlotsForContract', () => {})
  control.standAt(site)
  control.frames(PAST_GRACE)
  assert.equal(control.status(control.signature), 'failed')
})

test('a budget that cannot be reclaimed is abandoned honestly, without handing anything back', () => {
  const probe = fixture('villain')
  const site = siteOf(probe.blueprint, probe.signature)
  fill(probe, 'squad', 3, site)
  fill(probe, 'campaign', 21, site)
  const located = placeLocatedFight(probe, { x: site.x - 60, z: site.z }, 1)
  assert.equal(probe.actors.length, MAX_ACTORS)
  probe.standAt(site)
  probe.frames(PAST_GRACE)
  assert.equal(probe.status(probe.signature), 'failed')
  assert.ok(probe.events().includes(located), 'a fight was handed back for a start that could not happen')
  assert.ok(probe.notices.some((notice) => notice.message === describeContractAbandoned(
    'plunder', copyContext(probe, probe.signature), 'crowded',
  )))
  assert.ok(!probe.notices.some((notice) => notice.message.includes('не тот час')))
})

test('one contract at a time: the other arm waits without spending its grace', () => {
  const probe = fixture('villain')
  probe.standAt(siteOf(probe.blueprint, probe.signature))
  probe.frames(FRAME)
  assert.equal(probe.status(probe.signature), 'active')
  invoke(probe.engine, 'pinObjective', probe.alternative.id)
  probe.standAt(siteOf(probe.blueprint, probe.alternative))
  probe.frames(PAST_GRACE + 5)
  assert.equal(probe.status(probe.alternative), 'offered')
  assert.equal(probe.progress(probe.alternative)?.waited, 0)
  assert.equal(probe.notices.filter((notice) =>
    notice.message === describeContractQueued('scavenge', 'plunder')).length, 1)
  assert.equal(probe.events().filter((event) => event.contractNodeId).length, 1)

  // The running one's clock is the bound: when it fails forward, the waiting arm starts.
  const running = probe.progress(probe.signature)
  assert.ok(running)
  running.remaining = FRAME / 2
  probe.frames(FRAME * 3)
  assert.equal(probe.status(probe.signature), 'failed')
  assert.equal(probe.status(probe.alternative), 'active')
  assert.equal(probe.contractEvent()?.contractNodeId, probe.alternative.id)

  // Negative control: treated as a stall, the same wait abandons the arm the player took.
  const control = fixture('villain')
  const shipped = Reflect.get(control.engine, 'startContractEvent') as (...args: unknown[]) => string
  Reflect.set(control.engine, 'startContractEvent', function legacy(this: object, ...args: unknown[]) {
    return Reflect.get(this, 'activeContractNodeId') !== null ? 'crowded' : Reflect.apply(shipped, this, args)
  })
  control.standAt(siteOf(control.blueprint, control.signature))
  control.frames(FRAME)
  invoke(control.engine, 'pinObjective', control.alternative.id)
  control.standAt(siteOf(control.blueprint, control.alternative))
  control.frames(PAST_GRACE)
  assert.equal(control.status(control.alternative), 'failed')
})

test('a random event already won on the arrival frame still pays, then the contract starts', () => {
  // `settling`: the event resolved this frame and `updateEvents` has not paid it yet. The
  // contract waits one frame instead of standing down a fight the player already won.
  const won = fixture('villain')
  const bounty = won.rollRandomEvent('bounty')
  bounty.state = 'succeeded'
  bounty.playerContributed = true
  won.standAt(siteOf(won.blueprint, won.signature))
  won.frames(FRAME)
  assert.equal(won.status(won.signature), 'offered', 'the contract raced the payout')
  assert.deepEqual(won.worldEvents, [{ kind: 'bounty', succeeded: true }])
  assert.equal(won.gold(), 55 + 70)
  won.frames(FRAME)
  assert.equal(won.status(won.signature), 'active')
  assert.equal(won.progress(won.signature)?.waited, 0, 'the one-frame wait spent grace')
  assert.ok(!won.notices.some((notice) => notice.message === describeRandomEventStoodDown(bounty.title)))

  // Control: the same bounty still running on arrival is stood down, and pays nothing.
  const running = fixture('villain')
  running.rollRandomEvent('bounty')
  running.standAt(siteOf(running.blueprint, running.signature))
  running.frames(FRAME)
  assert.equal(running.status(running.signature), 'active')
  assert.deepEqual(running.worldEvents, [])
  assert.equal(running.gold(), 55)
})

test('a bounty the player is fighting finishes first: the contract waits, then starts, and the bounty pays', () => {
  const probe = fixture('villain')
  const bounty = probe.rollRandomEvent('bounty')
  const mark = ownedActor(probe, bounty)
  arriveAlongside(probe, mark)
  tradeBlows(probe, mark)
  probe.frames(FRAME)
  assert.equal(probe.status(probe.signature), 'offered', 'the contract erased a fight under the player')
  assert.ok(probe.events().includes(bounty))
  // Longer than the whole grace, still trading blows: the contract waits and spends nothing.
  for (let second = 0; second < PAST_GRACE; second += 1) {
    probe.frames(1)
    tradeBlows(probe, mark)
  }
  assert.equal(probe.status(probe.signature), 'offered')
  assert.equal(probe.progress(probe.signature)?.waited, 0, 'the wait spent grace')
  assert.equal(probe.notices.filter((notice) =>
    notice.message === describeContractWaitsForEvent('plunder', bounty.title)).length, 1)
  // The mark goes down: the bounty pays on its own terms, and the contract starts next.
  strikeDown(probe, mark)
  probe.frames(FRAME)
  assert.deepEqual(probe.worldEvents, [{ kind: 'bounty', succeeded: true }])
  assert.equal(probe.gold(), 55 + 70)
  probe.frames(FRAME)
  assert.equal(probe.status(probe.signature), 'active')
  assert.ok(!probe.notices.some((notice) => notice.message === describeRandomEventStoodDown(bounty.title)))

  // Negative control: without the carve-out the same fight vanishes on arrival, unpaid.
  const control = fixture('villain')
  ignoreEngagement(control)
  const erased = control.rollRandomEvent('bounty')
  const controlMark = ownedActor(control, erased)
  arriveAlongside(control, controlMark)
  tradeBlows(control, controlMark)
  control.frames(FRAME)
  assert.equal(control.status(control.signature), 'active')
  assert.ok(!control.events().includes(erased))
  assert.ok(!control.actors.includes(controlMark), 'the control kept the mark, so it proves nothing')
  assert.equal(control.gold(), 55)
})

test('a rich caravan the player has robbed is not erased before its escape or its clock', () => {
  const site = siteOf(BLUEPRINT, getContractNodes(BLUEPRINT, 'villain')[0])
  const robNearSite = (probe: Probe): LiveEvent => {
    const caravan = probe.rollRandomEvent('richCaravan')
    const [cart] = Reflect.get(caravan, 'ownedProps') as THREE.Object3D[]
    // The cart rolled into B2, and the villain robs it ten metres short of the site.
    cart.position.set(site.x + 10, 0, site.z)
    probe.standAt({ x: site.x + 10, z: site.z + 2 })
    invoke(probe.engine, 'interact')
    assert.ok(probe.notices.some((notice) => notice.message === RICH_CARAVAN_LOOT_TAKEN_NOTICE))
    return caravan
  }

  // The escape: eighteen metres from the robbery point, still on the contract's site.
  const escaped = fixture('villain')
  const loot = robNearSite(escaped)
  escaped.frames(5)
  assert.equal(escaped.status(escaped.signature), 'offered')
  assert.ok(escaped.events().includes(loot), 'a robbed cart was erased before its escape')
  assert.equal(escaped.notices.filter((notice) =>
    notice.message === describeContractWaitsForEvent('plunder', loot.title)).length, 1)
  escaped.standAt({ x: site.x - 9, z: site.z + 2 })
  escaped.frames(FRAME)
  assert.deepEqual(escaped.worldEvents, [{ kind: 'richCaravan', succeeded: true }])
  assert.equal(escaped.gold(), 55 + 180)
  escaped.frames(FRAME)
  assert.equal(escaped.status(escaped.signature), 'active')

  // The clock: robbed and never carried off, the cart runs out its own 25 s first.
  const lingered = fixture('villain')
  const kept = robNearSite(lingered)
  lingered.frames(20)
  assert.ok(lingered.events().includes(kept), 'a robbed cart was erased before its clock ran out')
  assert.equal(lingered.status(lingered.signature), 'offered')
  assert.equal(lingered.progress(lingered.signature)?.waited, 0)
  lingered.frames(10)
  assert.ok(!lingered.events().some((event) => event === kept))
  assert.deepEqual(lingered.worldEvents, [{ kind: 'richCaravan', succeeded: false }])
  assert.equal(lingered.status(lingered.signature), 'active')

  // Negative control: without the carve-out the robbed cart vanishes on arrival, unpaid.
  const control = fixture('villain')
  ignoreEngagement(control)
  const robbed = robNearSite(control)
  control.frames(FRAME)
  assert.equal(control.status(control.signature), 'active')
  assert.ok(!control.events().includes(robbed))
  assert.equal(control.gold(), 55)
})

test('a champion the player stopped fighting, or walked away from, is stood down as before', () => {
  // Stopped fighting: the contract waits out the engagement window, then stands it down.
  const probe = fixture('villain')
  const champion = probe.rollRandomEvent('champion')
  const body = ownedActor(probe, champion)
  arriveAlongside(probe, body)
  tradeBlows(probe, body)
  let startedAfter = -1
  for (let waited = FRAME; waited <= 15; waited += FRAME) {
    probe.frames(FRAME)
    if (probe.status(probe.signature) === 'active') {
      startedAfter = waited
      break
    }
  }
  assert.ok(
    Math.abs(startedAfter - ENGAGEMENT_WINDOW) <= FRAME * 1.5,
    `the champion was stood down after ${String(startedAfter)} s`,
  )
  const messages = probe.notices.map((notice) => notice.message)
  assert.ok(messages.includes(describeContractWaitsForEvent('plunder', champion.title)))
  assert.ok(messages.includes(describeRandomEventStoodDown(champion.title)))
  assert.deepEqual(probe.worldEvents, [])
  assert.equal(probe.gold(), 55)

  // Walked away: the blow is fresh, but the champion is 70 m off, so it goes at once.
  const far = fixture('villain')
  const distant = far.rollRandomEvent('champion')
  const farBody = ownedActor(far, distant)
  const site = siteOf(far.blueprint, far.signature)
  far.standAt(site, far.start, 35)
  farBody.mesh.position.set(site.x + 70, 0, site.z)
  far.frames(FRAME)
  far.standAt(site)
  tradeBlows(far, farBody)
  far.frames(FRAME)
  assert.equal(far.status(far.signature), 'active')
  assert.ok(!far.events().includes(distant))

  // Negative control: an engagement that never lapsed would hold the contract for as long
  // as a timerless champion lives, which is the strand the disengagement bound prevents.
  const held = fixture('villain')
  Reflect.set(held.engine, 'isPlayerEngagedWith', () => true)
  const forever = held.rollRandomEvent('champion')
  arriveAlongside(held, ownedActor(held, forever))
  held.frames(60)
  assert.equal(held.status(held.signature), 'offered')
  assert.ok(held.events().includes(forever))
})

/** The production materialization of the fixture's bridge beat. */
function materializeBeat(value: { engine: object; plan: { id: string } }): boolean {
  return invoke<boolean>(value.engine, 'materializeCaravanBeat', invoke(value.engine, 'caravanBeatEntry', value.plan.id))
}

test('the bridge ambush and a contract never cancel each other, and neither strands', () => {
  // The elf's `reprisal` is a one-actor bounty: take that actor away and the contract can
  // never be won, which is the silent cancellation this guards against.
  const probe = fixture('elf')
  invoke(probe.engine, 'pinObjective', probe.alternative.id)
  assert.equal(probe.alternative.contract, 'reprisal')
  const site = siteOf(probe.blueprint, probe.alternative)
  probe.standAt(site)
  probe.frames(FRAME)
  assert.equal(probe.status(probe.alternative), 'active')
  const live = probe.contractEvent()
  assert.ok(live)
  const target = [...live.ownedActorIds]
  fill(probe, 'squad', 3, site)
  fill(probe, 'campaign', 19, site)
  fill(probe, 'ambient', 2, site)
  assert.equal(probe.actors.length, MAX_ACTORS)
  probe.standAt(probe.plan.cargoStart)

  assert.equal(materializeBeat(probe), false)
  assert.equal(probe.bridgeState.phase, 'approach', 'the ambush must wait, not give up')
  assert.ok(target.every((id) => probe.actors.some((actor) => actor.id === id)),
    'the bridge ambush took the contract\'s mark off the ground')
  assert.ok(probe.notices.some((notice) => notice.message.includes('слишком людно')))
  assert.ok(probe.beat.runtime.spawnRetryAt > Reflect.get(probe.engine, 'elapsed'))

  // Neither strands: once the contract's clock settles it, the ambush materializes.
  const running = probe.progress(probe.alternative)
  assert.ok(running)
  running.remaining = FRAME / 2
  probe.frames(FRAME * 3)
  assert.equal(probe.status(probe.alternative), 'failed')
  assert.equal(probe.contractEvent(), undefined)
  Reflect.set(probe.engine, 'elapsed', probe.beat.runtime.spawnRetryAt)
  assert.equal(materializeBeat(probe), true)
  assert.equal(probe.bridgeState.phase, 'fighting')

  // The other direction: a contract that starts beside a live ambush never thins it out.
  const beside = fixture('elf')
  invoke(beside.engine, 'pinObjective', beside.alternative.id)
  assert.equal(materializeBeat(beside), true)
  const ambush = beside.actors.filter((actor) => actor.budgetCategory === 'campaign').map((actor) => actor.id)
  assert.equal(ambush.length, 3)
  fill(beside, 'squad', 3, site)
  fill(beside, 'campaign', 18, site)
  fill(beside, 'ambient', 1, site)
  assert.equal(beside.actors.length, MAX_ACTORS)
  beside.standAt(site)
  beside.frames(FRAME)
  assert.equal(beside.status(beside.alternative), 'active')
  assert.ok(ambush.every((id) => beside.actors.some((actor) => actor.id === id)))

  // Negative control: without the protection the ambush pays for itself with the mark.
  const control = fixture('elf')
  invoke(control.engine, 'pinObjective', control.alternative.id)
  control.standAt(site)
  control.frames(FRAME)
  const mark = [...(control.contractEvent()?.ownedActorIds ?? [])]
  assert.equal(mark.length, 1)
  fill(control, 'squad', 3, site)
  fill(control, 'campaign', 19, site)
  fill(control, 'ambient', 2, site)
  Reflect.set(control.engine, 'isContractOwnedActor', () => false)
  assert.equal(materializeBeat(control), true)
  assert.ok(!control.actors.some((actor) => actor.id === mark[0]), 'the control kept the mark, so it proves nothing')
})

test('contract persistence holds before, during and after the arrival, and grace does not refresh', () => {
  const probe = fixture('villain')
  probe.rollRandomEvent('bounty')
  probe.frames(1)
  const before = invoke<ActiveRunSaveV3>(probe.engine, 'saveGeneratedRun')
  const beforeBoard = normalizeCampaignContractState(before.directorState.campaignContracts)
  assert.equal(beforeBoard.pinnedNodeId, probe.signature.id)
  assert.equal(getContractStatus(beforeBoard, probe.signature), 'offered')
  assert.equal(before.eventState.active, false)

  probe.standAt(siteOf(probe.blueprint, probe.signature))
  probe.frames(FRAME * 5)
  const during = invoke<ActiveRunSaveV3>(probe.engine, 'saveGeneratedRun')
  const duringBoard = normalizeCampaignContractState(during.directorState.campaignContracts)
  assert.equal(getContractStatus(duringBoard, probe.signature), 'active')
  const remaining = duringBoard.contracts.find((entry) => entry.nodeId === probe.signature.id)?.remaining ?? 0
  assert.ok(remaining > 0 && remaining < CONTRACT_TEMPLATES.plunder.timeoutSeconds)
  // The stood-down bounty leaves nothing in the save but the floored cooldown.
  assert.equal(during.eventState.active, false)
  assert.ok(Number(during.eventState.eventCooldown) >= eventCooldownRange(1).min)
  assert.equal(during.player.gold, 55)

  const running = probe.progress(probe.signature)
  assert.ok(running)
  running.remaining = FRAME / 2
  probe.frames(FRAME * 3)
  const after = invoke<ActiveRunSaveV3>(probe.engine, 'saveGeneratedRun')
  assert.equal(
    getContractStatus(normalizeCampaignContractState(after.directorState.campaignContracts), probe.signature),
    'failed',
  )

  // A genuine stall carries its spent patience across a suspend and continue: 8 s before
  // the save and the remainder after it, never a fresh twelve.
  const stalled = fixture('villain')
  invoke(stalled.engine, 'pinObjective', stalled.alternative.id)
  stalled.walkable.value = false
  stalled.standAt(siteOf(stalled.blueprint, stalled.alternative))
  stalled.frames(8)
  const suspended = invoke<ActiveRunSaveV3>(stalled.engine, 'saveGeneratedRun')
  const restored = normalizeCampaignContractState(suspended.directorState.campaignContracts)
  const waited = restored.contracts.find((entry) => entry.nodeId === stalled.alternative.id)?.waited ?? 0
  assert.ok(Math.abs(waited - 8) < FRAME * 1.5, `waited ${String(waited)} s before the save`)
  const continued = fixture('villain', restored)
  continued.walkable.value = false
  continued.standAt(siteOf(continued.blueprint, continued.alternative))
  continued.frames(CONTRACT_TEMPLATES.scavenge.startGraceSeconds - 8 + FRAME * 2)
  assert.equal(continued.status(continued.alternative), 'failed', 'the grace refreshed across the save')
})

test("the palace guard confiscates a rich caravan for the palace, it does not rob one", () => {
  // W2-2 — the same event and the same 180, in the guard's own words.
  const guard = fixture('guard')
  // The guard's camp sits inside W1-1's quiet radius of its contract; that hold is not under test.
  Reflect.set(guard.engine, 'contractHoldsRandomEvents', () => false)
  const caravan = guard.rollRandomEvent('richCaravan')
  const [cart] = Reflect.get(caravan, 'ownedProps') as THREE.Object3D[]
  guard.standAt({ x: cart.position.x, z: cart.position.z + 2 })
  const prompt = Reflect.get(caravan, 'getPrompt') as () => string | null
  assert.equal(prompt(), CARAVAN_CONFISCATE_PROMPT)
  assert.equal(Reflect.get(caravan, 'description'), RICH_CARAVAN_CONFISCATE_DESCRIPTION)
  invoke(guard.engine, 'interact')
  assert.ok(guard.notices.some((notice) => notice.message === RICH_CARAVAN_CONFISCATED_NOTICE))
  assert.ok(!guard.notices.some((notice) => notice.message === RICH_CARAVAN_LOOT_TAKEN_NOTICE))
  guard.standAt({ x: cart.position.x + 30, z: cart.position.z + 2 })
  guard.frames(FRAME)
  assert.deepEqual(guard.worldEvents, [{ kind: 'richCaravan', succeeded: true }])
  assert.equal(guard.gold(), 55 + 180)
  assert.ok(guard.notices.some((notice) =>
    notice.message === describeRichCaravanConfiscated(WORLD_EVENT_REWARDS.richCaravan.gold)))
  // Negative control: the villain at the same cart robs it, in the robber's words.
  const villain = fixture('villain')
  const robbed = villain.rollRandomEvent('richCaravan')
  const [robbedCart] = Reflect.get(robbed, 'ownedProps') as THREE.Object3D[]
  villain.standAt({ x: robbedCart.position.x, z: robbedCart.position.z + 2 })
  assert.equal((Reflect.get(robbed, 'getPrompt') as () => string | null)(), '[E] Ограбить богатый корован')
  invoke(villain.engine, 'interact')
  assert.ok(villain.notices.some((notice) => notice.message === RICH_CARAVAN_LOOT_TAKEN_NOTICE))
  assert.ok(!villain.notices.some((notice) => notice.message === RICH_CARAVAN_CONFISCATED_NOTICE))
})