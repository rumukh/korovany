/**
 * W1-6 — a commander on the player's side calls for men only while his own are fighting, and
 * no commander's call ever takes the room a contract would stage in.
 *
 * The defect, as measured on the engine's own window: for the palace guard, the boss slots of
 * the elf's and the villain's finales — the two palace strongholds those sides march on — are
 * not hostile, so they field the guard's own garrisons, each led by a `commander`.
 * `updateCommander` used to call four reinforcements every 25 s from the moment his square
 * streamed in, fight or no fight, and every one of them borrowed `chronicle`'s room. A guard
 * who reached «Домики жгут» beside the palace found it held by eight idle soldiers nobody had
 * asked for, and the contract was abandoned as `crowded`.
 *
 * Everything below drives production engine methods — `syncGeneratedRegions` and the spawner
 * under it, `updateCommander`, `startContractEvent`, `updateFactionContract` and the budget
 * seams — on an engine whose render, audio and actor-mesh boundaries are replaced, the way
 * `tests/contractArrival.test.ts` does it. Every claim carries a negative control: the legacy
 * rule is put back on the instance, and the same assertion has to fail against it.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import {
  createGeneratedEncounterPlans,
  getBlueprintRegionBounds,
  getSiteWorldPosition2D,
  type GeneratedEncounterPlan,
} from '../src/game/content/registry.ts'
import {
  REINFORCEMENTS_ORDERED_NOTICE,
  describeContractAbandoned,
  describeContractStarted,
  formatRegionGridLabel,
  generatedSiteLabel,
} from '../src/game/content/gameCopy.ts'
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
  CONTRACT_TEMPLATES,
  completeObjectiveEntry,
  createCampaignContractState,
  createChronicleCommitmentState,
  createGeneratedObjectives,
  findContractTemplate,
  getContractNodes,
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
const { GameEngine } = await import('../src/game/GameEngine.ts')
hooks.deregister()

const FRAME = 0.25
/** `GameEngine`'s `COMMANDER_REINFORCEMENT_INTERVAL` and `COMMANDER_REINFORCEMENT_LIMIT`. */
const CALL_INTERVAL = 25
const CALL_LIMIT = 4
/** Long enough for all four calls, with a frame to spare. */
const RESIDENCY = CALL_INTERVAL * CALL_LIMIT + 1
const FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']
/** The reproduction: the guard's «Домики жгут» between the two palace strongholds. */
const REPRO_SEED = 95_029
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
  playerAggro: boolean
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

interface Point {
  x: number
  z: number
}

function invoke<T = void>(engine: object, method: string, ...args: unknown[]): T {
  const callable: unknown = Reflect.get(engine, method)
  assert.equal(typeof callable, 'function', `${method} must be a production engine method`)
  return Reflect.apply(callable as (...values: unknown[]) => T, engine, args)
}

/** One generated world, its plans as the engine groups them, and its region streamer. */
interface World {
  seed: number
  blueprint: WorldBlueprint
  manager: RegionManager
  plans: Map<Faction, Map<string, GeneratedEncounterPlan[]>>
}

const worlds = new Map<number, World>()

function world(seed: number): World {
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

function siteOf(blueprint: WorldBlueprint, node: FactionObjectiveNode): Point {
  const position = getSiteWorldPosition2D(blueprint, node.siteId)
  assert.ok(position, `${node.id} has no site position`)
  return position
}

interface FieldOptions {
  /** The contract the player has taken on and stands at. */
  node?: FactionObjectiveNode
  /** Simulate the 3x3 visible square, as the harness once did, instead of the engine's plus. */
  wide?: boolean
}

/**
 * A fresh engine with the player at `options.node`'s site (or the start), the engine's own
 * window streamed in around them, and nothing spawned yet.
 */
function field(source: World, faction: Faction, options: FieldOptions = {}) {
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
  const regionId = blueprint.regions.find((region) => {
    const bounds = getBlueprintRegionBounds(blueprint, region.id)
    return bounds !== undefined && bounds !== null &&
      standing.x >= bounds.minX && standing.x <= bounds.maxX &&
      standing.z >= bounds.minZ && standing.z <= bounds.maxZ
  })?.id
  assert.ok(regionId, 'the player stands in a square')
  manager.update(regionId)
  const player = new THREE.Group()
  player.position.set(standing.x, 0, standing.z)
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
    generatedNavigationCache: new Map(),
    actorSequence: 0,
    elapsed: 30,
    paused: false,
    ended: false,
    gold: 55,
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
      // `spawnActor`'s own start: the first call comes a full interval after spawning.
      reinforcementTimer: CALL_INTERVAL,
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
  return probe
}

type Probe = ReturnType<typeof field>

/**
 * Puts the rule W1-6 replaced back on the instance: every commander gathers men all the
 * time, and each call borrows whatever room the budget would lend.
 */
function restoreLegacyCommanders(probe: Probe): void {
  Reflect.set(probe.engine, 'commanderGathersMen', () => true)
  Reflect.set(probe.engine, 'reserveOwnActorSlots', function legacy(
    this: object,
    category: Category,
    count: number,
  ) {
    return invoke<boolean>(this, 'reserveActorSlots', category, count)
  })
}

/** A friendly palace commander and two of his men, standing alone with the squad. */
function garrison(faction: Faction = 'guard') {
  const source = world(REPRO_SEED)
  const probe = field(source, faction)
  probe.squad()
  const at = { x: probe.player.position.x + 30, z: probe.player.position.z }
  const commander = probe.spawn(faction, 'commander', at.x, at.z, 'campaign', {
    hostileToPlayer: false,
    generatedEncounterId: 'encounter-boss-test',
    generatedRegionId: 'region-test',
  })
  const men = [1, 2].map((index) =>
    probe.spawn(faction, 'soldier', at.x + 3 * index, at.z, 'campaign', {
      hostileToPlayer: false,
      generatedEncounterId: 'encounter-boss-test',
      generatedRegionId: 'region-test',
    }))
  return { probe, commander, men, at }
}

// ---------------------------------------------------------------------------
// 1. The rule
// ---------------------------------------------------------------------------

test('an idle garrison commander on the player\'s side calls nobody, and his clock stands still', () => {
  const { probe, commander } = garrison()
  probe.residency(RESIDENCY * 2)
  assert.equal(probe.reinforcements().length, 0)
  assert.equal(commander.reinforcementsCalled, 0)
  assert.equal(commander.reinforcementTimer, CALL_INTERVAL, 'idle time was counted towards a call')
  assert.ok(!probe.notices.includes(REINFORCEMENTS_ORDERED_NOTICE))

  // Negative control: the legacy rule calls all four, one every 25 s, into a quiet square.
  const control = garrison()
  restoreLegacyCommanders(control.probe)
  control.probe.residency(CALL_INTERVAL - FRAME)
  assert.equal(control.probe.reinforcements().length, 0)
  control.probe.residency(FRAME * 2)
  assert.equal(control.probe.reinforcements().length, 1)
  control.probe.residency(RESIDENCY)
  assert.equal(control.probe.reinforcements().length, CALL_LIMIT)
})

test('an engaged commander on the player\'s side calls his men, and only fighting time counts', () => {
  const { probe, commander, men, at } = garrison()
  const raider = probe.spawn('elf', 'soldier', at.x + 8, at.z, 'chronicle')
  // Twenty seconds of a fight: not yet a call.
  men[0].targetId = raider.id
  probe.residency(20)
  assert.equal(probe.reinforcements().length, 0)
  assert.ok(Math.abs(commander.reinforcementTimer - (CALL_INTERVAL - 20)) < 1e-9)
  // The fight stops for a minute; the clock stops with it.
  men[0].targetId = null
  probe.residency(60)
  assert.equal(probe.reinforcements().length, 0)
  assert.ok(Math.abs(commander.reinforcementTimer - (CALL_INTERVAL - 20)) < 1e-9)
  // It starts again: five more seconds of fighting complete the first call.
  men[1].action = { kind: 'meleeActor' }
  probe.residency(5 + FRAME)
  const [first] = probe.reinforcements()
  assert.ok(first, 'twenty-five seconds of fighting did not call anyone')
  assert.equal(first.allegiance, commander.allegiance)
  assert.equal(first.budgetCategory, 'campaign')
  assert.equal(first.hostileToPlayer, false)
  assert.equal(first.generatedRegionId, 'region-test')
  // Kept up, the fight brings the rest, and never more than four.
  probe.residency(RESIDENCY)
  assert.equal(probe.reinforcements().length, CALL_LIMIT)
  assert.equal(commander.reinforcementsCalled, CALL_LIMIT)
  assert.ok(probe.notices.includes(REINFORCEMENTS_ORDERED_NOTICE), 'the call near the player is not announced')

  // Negative control: the same fight out of his earshot is not his men's fight.
  const far = garrison()
  const distant = far.probe.spawn('guard', 'soldier', far.at.x + 40, far.at.z, 'campaign', { hostileToPlayer: false })
  const prey = far.probe.spawn('elf', 'soldier', far.at.x + 44, far.at.z, 'chronicle')
  distant.targetId = prey.id
  far.probe.residency(RESIDENCY)
  assert.equal(far.probe.reinforcements().length, 0, 'a fight out of his earshot called his men')
})

test('a commander hostile to the player keeps the old cadence', () => {
  // The elf's view of the same garrison: hostile, so his men gather before anyone swings.
  const { probe, commander } = garrison('elf')
  for (const actor of probe.actors.filter((entry) => entry.generatedEncounterId === 'encounter-boss-test')) {
    actor.allegiance = 'guard'
    actor.hostileToPlayer = true
  }
  const legacy = garrison('elf')
  for (const actor of legacy.probe.actors.filter((entry) => entry.generatedEncounterId === 'encounter-boss-test')) {
    actor.allegiance = 'guard'
    actor.hostileToPlayer = true
  }
  restoreLegacyCommanders(legacy.probe)
  const calls = (target: Probe): number[] => {
    const times: number[] = []
    for (let second = 0; second < RESIDENCY; second += FRAME) {
      const before = target.reinforcements().length
      target.residency(FRAME)
      if (target.reinforcements().length > before) times.push(Math.round(second + FRAME))
    }
    return times
  }
  const shipped = calls(probe)
  assert.deepEqual(shipped, [25, 50, 75, 100])
  assert.deepEqual(calls(legacy.probe), shipped, 'the hostile cadence changed')
  assert.equal(commander.reinforcementsCalled, CALL_LIMIT)

  // Negative control: the same commander on the player's side, idle, calls nobody.
  const friendly = garrison('elf')
  for (const actor of friendly.probe.actors.filter((entry) => entry.generatedEncounterId === 'encounter-boss-test')) {
    actor.allegiance = 'guard'
    actor.hostileToPlayer = false
  }
  assert.deepEqual(calls(friendly.probe), [])
})

test('a reinforcement never takes the room a contract would stage in', () => {
  // The reproduction's window: the palace garrisons are already past campaign's own eight.
  const source = world(REPRO_SEED)
  const [signature] = getContractNodes(source.blueprint, 'guard')
  const probe = field(source, 'guard', { node: signature })
  probe.squad()
  probe.streamIn()
  assert.ok(probe.usage().campaign > ACTOR_BUDGET.campaign)
  const room = probe.chronicleRoom()
  // Every one of his men fighting, so every call is due.
  Reflect.set(probe.engine, 'commanderGathersMen', () => true)
  probe.residency(RESIDENCY)
  assert.equal(probe.reinforcements().length, 0, 'a call borrowed past campaign\'s own share')
  assert.equal(probe.chronicleRoom(), room)

  // Inside campaign's own share a call is answered, and the room below is untouched.
  const quiet = garrison()
  Reflect.set(quiet.probe.engine, 'commanderGathersMen', () => true)
  const quietRoom = quiet.probe.chronicleRoom()
  quiet.probe.residency(RESIDENCY)
  assert.equal(quiet.probe.reinforcements().length, CALL_LIMIT)
  assert.ok(quiet.probe.usage().campaign <= ACTOR_BUDGET.campaign)
  assert.equal(quiet.probe.chronicleRoom(), quietRoom)

  // Negative control: the borrowing reservation fills the contract's room with soldiers.
  const control = field(source, 'guard', { node: signature })
  control.squad()
  control.streamIn()
  restoreLegacyCommanders(control)
  control.residency(RESIDENCY)
  assert.ok(control.reinforcements().length > 0)
  assert.ok(control.chronicleRoom() < room, 'the control left the room alone, so it proves nothing')
})

// ---------------------------------------------------------------------------
// 2. The contract it starved
// ---------------------------------------------------------------------------

test('the guard reaches «Домики жгут» beside an idle palace garrison and the contract starts', () => {
  const source = world(REPRO_SEED)
  const [signature] = getContractNodes(source.blueprint, 'guard')
  assert.equal(signature.contract, 'bulwark')
  const template = findContractTemplate(signature.contract)
  assert.ok(template)
  const arrive = (legacy: boolean): Probe => {
    const probe = field(source, 'guard', { node: signature })
    if (legacy) restoreLegacyCommanders(probe)
    probe.squad()
    probe.streamIn()
    // Two garrisons, at the strongholds the villain and the elves march on: a commander and
    // two men each, all of them the guard's own.
    assert.equal(probe.commanders().length, 2)
    assert.ok(probe.actors.every((actor) => !actor.hostileToPlayer), 'every body in this window is the guard\'s own')
    probe.residency(RESIDENCY)
    probe.contractFrames(0.1)
    return probe
  }

  const shipped = arrive(false)
  assert.equal(shipped.reinforcements().length, 0)
  assert.equal(shipped.status(signature), 'active')
  assert.ok(shipped.notices.includes(describeContractStarted('bulwark')))
  assert.ok(shipped.actors.length <= MAX_ACTORS)

  // Negative control: under the legacy rule the same arrival stalls `crowded` and the
  // contract is abandoned once its grace runs out — W1-6's finding, in the engine.
  const legacy = arrive(true)
  assert.equal(legacy.reinforcements().length, 2 * CALL_LIMIT)
  assert.equal(legacy.status(signature), 'offered')
  legacy.contractFrames(PAST_GRACE)
  assert.equal(legacy.status(signature), 'failed')
  const site = source.blueprint.sites.find((entry) => entry.id === signature.siteId)
  const region = source.blueprint.regions.find((entry) => entry.id === signature.regionId)
  assert.ok(site && region)
  assert.ok(legacy.notices.includes(describeContractAbandoned('bulwark', {
    regionLabel: formatRegionGridLabel(region.coordinate.x, region.coordinate.y),
    siteLabel: generatedSiteLabel(site.kind),
  }, 'crowded')))
})

// ---------------------------------------------------------------------------
// 3. The guard test: every contract site, the engine's own window
// ---------------------------------------------------------------------------

type Rule = 'none' | 'shipped' | 'engaged' | 'legacy'

interface Arrival {
  seed: number
  faction: Faction
  node: string
  contract: string
  outcome: string
  called: number
}

/**
 * One arrival at one contract site: the squad, the engine's window through the production
 * spawner, `RESIDENCY` seconds of the window's commanders under `rule`, then the production
 * start gate. The contract's own builder is replaced by an event stub: what is under test is
 * whether the gate finds room, not what the builder puts there.
 *
 * - `none`: no commander ever updates — what the window alone holds.
 * - `shipped`: the production rule, with nobody fighting.
 * - `engaged`: the production reservation with every commander's men fighting throughout.
 * - `legacy`: the rule W1-6 replaced.
 *
 * `friendlyOnly` takes every pack hostile to the player off the field before the residency,
 * as a player who cleared them on the way would; the garrisons stay, because nobody fights
 * them.
 */
function arriveAt(
  source: World,
  faction: Faction,
  node: FactionObjectiveNode,
  rule: Rule,
  options: { wide?: boolean; friendlyOnly?: boolean } = {},
): Arrival {
  const probe = field(source, faction, { node, wide: options.wide })
  probe.squad()
  probe.streamIn()
  if (options.friendlyOnly) {
    for (const actor of [...probe.actors]) {
      if (actor.hostileToPlayer && actor.generatedEncounterId !== null) {
        invoke(probe.engine, 'removeActorById', actor.id)
      }
    }
  }
  if (rule === 'legacy') restoreLegacyCommanders(probe)
  if (rule === 'engaged') Reflect.set(probe.engine, 'commanderGathersMen', () => true)
  if (rule !== 'none') probe.residency(RESIDENCY)
  Reflect.set(probe.engine, 'buildContractEvent', () => invoke(probe.engine, 'createWorldEvent', {
    id: `test-contract-${node.id}`,
    kind: 'champion',
    anchor: 'located',
    regionId: String(node.regionId),
    situationId: null,
    state: 'active',
    title: 'Тест',
    description: 'Тест.',
    tone: 'warning',
    timer: 60,
    progress: 0,
    target: 1,
    markerId: `test-contract-${node.id}-marker`,
    markerPos: new THREE.Vector3(),
    ownedActorIds: [],
    ownedProps: [],
  }))
  const template = findContractTemplate(node.contract)
  assert.ok(template)
  const outcome = invoke<string>(probe.engine, 'startContractEvent', node, template, siteOf(source.blueprint, node))
  assert.ok(probe.actors.length <= MAX_ACTORS)
  return {
    seed: source.seed,
    faction,
    node: node.id,
    contract: template.id,
    outcome,
    called: probe.reinforcements().length,
  }
}

function demandSeeds(): number[] {
  const raw = Number(process.env.KOROVANY_DEMAND_SEEDS)
  const count = Number.isInteger(raw) && raw > 0 ? raw : 40
  return Array.from({ length: count }, (_, index) => 1 + 7919 * index)
}

test('guard test: on the engine\'s own window no commander crowds out a contract', () => {
  const seeds = demandSeeds()
  const variants = {
    window: { rule: 'none', options: {} },
    shipped: { rule: 'shipped', options: {} },
    engaged: { rule: 'engaged', options: {} },
    legacy: { rule: 'legacy', options: {} },
    friendlyWindow: { rule: 'none', options: { friendlyOnly: true } },
    friendlyShipped: { rule: 'shipped', options: { friendlyOnly: true } },
    friendlyLegacy: { rule: 'legacy', options: { friendlyOnly: true } },
    wide: { rule: 'none', options: { wide: true } },
  } as const
  type Variant = keyof typeof variants
  const results = new Map<Variant, Arrival[]>()
  for (const name of Object.keys(variants) as Variant[]) results.set(name, [])
  for (const seed of seeds) {
    const source = world(seed)
    for (const faction of FACTIONS) {
      for (const node of getContractNodes(source.blueprint, faction)) {
        for (const name of Object.keys(variants) as Variant[]) {
          const { rule, options } = variants[name]
          results.get(name)!.push(arriveAt(source, faction, node, rule, options))
        }
      }
    }
  }
  const crowded = (name: Variant, faction?: Faction): Arrival[] =>
    results.get(name)!.filter((arrival) =>
      arrival.outcome === 'crowded' && (faction === undefined || arrival.faction === faction))
  const sites = results.get('window')!.length
  assert.equal(sites, seeds.length * 6)
  for (const arrivals of results.values()) {
    assert.ok(arrivals.every((arrival) => arrival.outcome === 'started' || arrival.outcome === 'crowded'),
      'only room decides an arrival here')
  }

  if (process.env.KOROVANY_DEMAND_VERBOSE) {
    for (const name of Object.keys(variants) as Variant[]) {
      const counts = FACTIONS.map((faction) => `${faction} ${String(crowded(name, faction).length)}/${String(sites / 3)}`)
      console.log(`${name.padEnd(16)} crowded: ${counts.join(', ')}`)
    }
    for (const arrival of crowded('legacy')) {
      console.log(`  legacy: seed ${String(arrival.seed)} ${arrival.faction} ${arrival.node} ${arrival.contract}`)
    }
    for (const arrival of crowded('shipped')) {
      console.log(`  shipped: seed ${String(arrival.seed)} ${arrival.faction} ${arrival.node} ${arrival.contract}`)
    }
  }

  // What the window alone holds: at most one site per faction, before any commander calls.
  for (const faction of FACTIONS) {
    assert.ok(crowded('window', faction).length <= Math.ceil(seeds.length / 40),
      `${faction}: ${String(crowded('window', faction).length)} sites crowded by the window alone`)
  }
  // The rule: idle garrisons add nothing, and even commanders fighting throughout add nothing
  // a contract would need, site for site.
  const outcomes = (name: Variant): string[] => results.get(name)!.map((arrival) => arrival.outcome)
  assert.deepEqual(outcomes('shipped'), outcomes('window'))
  assert.deepEqual(outcomes('engaged'), outcomes('window'))
  assert.ok(results.get('shipped')!.every((arrival) => arrival.called === 0), 'an idle garrison called someone')
  assert.deepEqual(outcomes('friendlyShipped'), outcomes('friendlyWindow'))

  // Negative control: the legacy rule is the finding — the guard's garrisons crowd out its
  // own contracts, and nobody else has a commander outside the finale to do it with.
  if (seeds.length >= 40) {
    assert.ok(crowded('legacy', 'guard').length >= 10, `legacy crowded ${String(crowded('legacy', 'guard').length)} guard sites`)
    assert.ok(crowded('friendlyLegacy', 'guard').length >= 8,
      `legacy crowded ${String(crowded('friendlyLegacy', 'guard').length)} guard sites with the hostiles cleared`)
  }
  assert.ok(crowded('legacy', 'guard').length > crowded('window', 'guard').length)
  for (const faction of ['elf', 'villain'] as const) {
    assert.equal(crowded('legacy', faction).length, crowded('window', faction).length)
  }

  // And the window is the engine's: the 3x3 square the harness once simulated crowds out
  // most contracts with no commander at all, so this instrument tells the two apart.
  assert.ok(crowded('wide').length >= sites / 2, `the 3x3 crowded only ${String(crowded('wide').length)} of ${String(sites)}`)
})
