import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import {
  getBlueprintRegionBounds,
  createGeneratedEncounterPlans,
  getFactionStartPosition2D,
  getSiteWorldPosition2D,
  isInsideRegionWater,
} from '../src/game/content/registry.ts'
import {
  BRIDGE_AMBUSH_DELIVERED_SUPPLIES,
  BRIDGE_AMBUSH_SEIZED_GOLD,
  formatRegionGridLabel,
} from '../src/game/content/gameCopy.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import {
  DEFAULT_DOCTRINE_IDS,
  createDoctrineRunState,
  resolveDoctrineEffects,
} from '../src/game/run/doctrine.ts'
import type { ActiveRunSaveV3 } from '../src/game/run/runTypes.ts'
import { normalizeActiveRunSaveV3 } from '../src/game/run/storage.ts'
import { createHealthyBody, type ActorRole, type Allegiance, type Faction } from '../src/game/types.ts'
import { ActorBudget, MAX_ACTORS } from '../src/game/world/ActorBudget.ts'
import {
  createCampaignContractState,
  createChronicleCommitmentState,
  createGeneratedObjectives,
} from '../src/game/world/CampaignDirector.ts'
import { buildInitialGameView } from '../src/game/world/CampaignView.ts'
import {
  BRIDGE_AMBUSH_DELIVERY_ESCORT_RADIUS,
  bridgeAmbushDeliveryProgress,
  bridgeAmbushRemainingEnemies,
  bridgeAmbushReservesStagingPoint,
  buildBridgeAmbushView,
  createBridgeAmbushPlan,
  createBridgeAmbushState,
  normalizeBridgeAmbushState,
  serializeBridgeAmbushState,
  type BridgeAmbushPlan,
  type BridgeAmbushState,
} from '../src/game/world/BridgeAmbush.ts'
import { createChronicleRegions, createChronicleState, type ChronicleState } from '../src/game/world/Chronicle.ts'
import { createPlayerMeleeState } from '../src/game/world/CombatResolver.ts'
import { createCombatMasteryState } from '../src/game/world/CombatMastery.ts'
import { ExpeditionPlanner, validateExpeditionRoute, type ExpeditionInput } from '../src/game/world/ExpeditionPlanner.ts'
import { createFinaleIdentity, createFinaleState } from '../src/game/world/FinaleDirector.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { RegionManager } from '../src/game/world/RegionManager.ts'
import { createSquadCommandState } from '../src/game/world/SquadCommand.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { WORLD_FACTIONS } from '../src/game/world/worldTypes.ts'

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

function invoke<T = void>(engine: object, method: string, ...args: unknown[]): T {
  const callable = Reflect.get(engine, method)
  assert.equal(typeof callable, 'function', `${method} must be a production engine method`)
  return Reflect.apply(callable as (...values: unknown[]) => T, engine, args)
}

function interpolate(plan: BridgeAmbushPlan, progress: number) {
  return {
    x: plan.cargoStart.x + (plan.deliveryEnd.x - plan.cargoStart.x) * progress,
    z: plan.cargoStart.z + (plan.deliveryEnd.z - plan.cargoStart.z) * progress,
  }
}

function readyCombatants(state: BridgeAmbushState, defeated = false): void {
  for (const entry of state.combatants) {
    entry.maxHealth = 60
    entry.health = defeated && entry.enemy ? 0 : 60
    entry.defeated = defeated && entry.enemy
  }
}

test('the signature encounter deterministically chooses a real dry bridge route for every faction', () => {
  const seeds = Array.from({ length: 80 }, (_, index) =>
    (20_260_909 + Math.imul(index, 2_654_435_761)) >>> 0)
  let checked = 0
  for (const seed of seeds) {
    const blueprint = generateWorld(seed)
    const fingerprint = blueprint.fingerprint
    const serialized = JSON.stringify(blueprint)
    for (const faction of WORLD_FACTIONS) {
      const plan = createBridgeAmbushPlan(blueprint, faction)
      const repeat = createBridgeAmbushPlan(blueprint, faction)
      assert.ok(plan, `${seed}/${faction} had no bridge encounter`)
      assert.deepEqual(repeat, plan)
      assert.ok(blueprint.bridges.some((bridge) => bridge.id === plan.bridgeId))
      assert.equal(plan.openingRoute.status, 'road')
      assert.equal(plan.deliveryRoute.status, 'road')
      assert.deepEqual(validateExpeditionRoute(
        // Both routes were produced from the same cached graph; the function only reads it.
        new ExpeditionPlanner(blueprint).graph,
        plan.deliveryRoute,
      ), [])
      assert.ok(plan.deliveryRoute.bridgeIds.length > 0)
      assert.ok(getFactionStartPosition2D(blueprint, faction))
      for (const point of [
        plan.cargoStart,
        plan.deliveryEnd,
        plan.alternateApproach,
        ...plan.spawnPoints,
      ]) {
        assert.equal(
          isInsideRegionWater(blueprint, plan.regionId, point.x, point.z, 0.8),
          false,
          `${seed}/${faction} placed encounter state in water`,
        )
      }
      assert.ok(Math.abs(plan.axis.x) > 0.99, 'generated bridge road axis must frame the crossing')
      assert.ok(Math.hypot(
        plan.deliveryEnd.x - plan.cargoStart.x,
        plan.deliveryEnd.z - plan.cargoStart.z,
      ) > 20)
      checked += 1
    }
    assert.equal(blueprint.fingerprint, fingerprint)
    assert.equal(JSON.stringify(blueprint), serialized)
  }
  assert.equal(checked, seeds.length * 3)
})

test('production collision keeps the cart lane and bank-side formation walkable', () => {
  const seeds = Array.from({ length: 16 }, (_, index) =>
    (31_337 + Math.imul(index, 2_654_435_761)) >>> 0)
  for (const seed of seeds) {
    const blueprint = generateWorld(seed)
    const runtime = new GeneratedWorldRuntime(new THREE.Scene(), blueprint, {
      terrainResolution: 6,
      decorationDensity: 0.35,
    })
    try {
      for (const faction of WORLD_FACTIONS) {
        const plan = createBridgeAmbushPlan(blueprint, faction)
        assert.ok(plan)
        runtime.update({ focus: plan.bridge, deltaSeconds: 0 })
        for (let step = 0; step <= 24; step += 1) {
          const point = interpolate(plan, step / 24)
          assert.equal(
            runtime.collision.isWalkablePosition(point.x, point.z, 1.4),
            true,
            `${seed}/${faction} blocked the physical delivery lane`,
          )
        }
        for (const authored of [plan.alternateApproach, ...plan.spawnPoints]) {
          let found = false
          for (let attempt = 0; attempt < 12; attempt += 1) {
            const ring = attempt === 0 ? 0 : 0.8 + Math.floor((attempt - 1) / 4) * 0.8
            const angle = attempt * Math.PI * 0.5
            if (runtime.collision.isWalkablePosition(
              authored.x + Math.cos(angle) * ring,
              authored.z + Math.sin(angle) * ring,
              0.7,
            )) {
              found = true
              break
            }
          }
          assert.equal(found, true, `${seed}/${faction} blocked a bank-side staging point`)
        }
      }
    } finally {
      runtime.dispose()
    }
  }
})

test('bridge state normalization preserves wounds and cart progress but rejects invented outcomes', () => {
  const blueprint = generateWorld(20_260_909)
  const plan = createBridgeAmbushPlan(blueprint, 'guard')
  assert.ok(plan)
  const fighting = createBridgeAmbushState(blueprint, 'guard', plan)
  readyCombatants(fighting)
  fighting.phase = 'fighting'
  fighting.combatants[0].health = 17
  fighting.cargoHealth = 63
  const restoredFight = normalizeBridgeAmbushState(
    serializeBridgeAmbushState(fighting),
    blueprint,
    'guard',
    plan,
  )
  assert.equal(restoredFight.rejected, false)
  assert.equal(restoredFight.state.combatants[0].health, 17)
  assert.equal(restoredFight.state.cargoHealth, 63)
  const region = blueprint.regions.find((entry) => entry.id === plan.regionId)
  assert.ok(region)
  const view = buildBridgeAmbushView(
    blueprint,
    'guard',
    createGeneratedObjectives(blueprint, 'guard'),
    plan,
    restoredFight.state,
    plan.cargoStart,
    0,
  )
  assert.ok(view.seizeDetail?.includes(`+${BRIDGE_AMBUSH_SEIZED_GOLD} золота`))
  assert.ok(view.deliverDetail?.includes(`+${BRIDGE_AMBUSH_DELIVERED_SUPPLIES} пайка`))
  assert.match(
    view.deliverDetail ?? '',
    new RegExp(formatRegionGridLabel(region.coordinate.x, region.coordinate.y)),
  )

  const delivering = createBridgeAmbushState(blueprint, 'guard', plan)
  readyCombatants(delivering, true)
  delivering.phase = 'delivering'
  delivering.outcome = 'deliver'
  const midpoint = interpolate(plan, 0.42)
  delivering.cargoX = midpoint.x
  delivering.cargoZ = midpoint.z
  delivering.progress = bridgeAmbushDeliveryProgress(plan, midpoint)
  const restoredDelivery = normalizeBridgeAmbushState(
    serializeBridgeAmbushState(delivering),
    blueprint,
    'guard',
    plan,
  )
  assert.equal(restoredDelivery.rejected, false)
  assert.equal(restoredDelivery.state.progress, delivering.progress)

  const forged = normalizeBridgeAmbushState({
    ...serializeBridgeAmbushState(delivering),
    phase: 'resolved',
    rewardPaid: false,
    consequence: 'free reward',
  }, blueprint, 'guard', plan)
  assert.equal(forged.rejected, true)
  assert.equal(forged.state.phase, 'unavailable')
  assert.equal(forged.state.rewardPaid, false)
})

test('bridge guidance waits for camp arrival and yields to an explicit atlas route until nearby', () => {
  const blueprint = generateWorld(20_260_909)
  const plan = createBridgeAmbushPlan(blueprint, 'elf')
  const start = getFactionStartPosition2D(blueprint, 'elf')
  assert.ok(plan && start)
  const state = createBridgeAmbushState(blueprint, 'elf', plan)
  const objectives = createGeneratedObjectives(blueprint, 'elf')
  const root = blueprint.objectives.elf.nodes.find(
    (node) => node.siteId === blueprint.starts.elf,
  )
  assert.ok(root)

  assert.equal(buildBridgeAmbushView(
    blueprint, 'elf', objectives, plan, state, start, 0,
  ).active, false)
  const rootObjective = objectives.find((objective) => objective.id === root.id)
  assert.ok(rootObjective)
  rootObjective.done = true
  assert.equal(buildBridgeAmbushView(
    blueprint, 'elf', objectives, plan, state, start, 0,
  ).active, true)
  assert.equal(buildBridgeAmbushView(
    blueprint, 'elf', objectives, plan, state, start, 0, true,
  ).active, false)
  assert.equal(buildBridgeAmbushView(
    blueprint, 'elf', objectives, plan, state, plan.cargoStart, 0, true,
  ).active, true)
})

test('bridge HUD follows the selected atlas route after a detour, including unavailable roads', () => {
  const value = harness('guard', 2_863_296_181)
  const planner = new ExpeditionPlanner(value.blueprint)
  const objectives = createGeneratedObjectives(value.blueprint, 'guard')
  const positions = [{ x: -80, z: -80 }, { x: -80, z: 0 }, { x: -80, z: 80 }, { x: 80, z: 160 }]
  let originalRouteDisagreed = 0
  let unavailable = 0
  for (const player of positions) {
    const input: ExpeditionInput = {
      ...invoke<ExpeditionInput>(value.engine, 'buildExpeditionInput'),
      player, heading: 0.4,
    }
    assert.equal(planner.select({ kind: 'bridgeAmbush', id: value.plan.id }, input), true)
    const expedition = planner.buildView(input)
    const hud = buildBridgeAmbushView(value.blueprint, 'guard', objectives,
      value.plan, value.state, player, input.heading, false, true, expedition)
    const original = buildBridgeAmbushView(value.blueprint, 'guard', objectives,
      value.plan, value.state, player, input.heading, false, true)
    assert.ok(expedition.guidance)
    assert.equal(hud.bearing, expedition.guidance.bearing)
    assert.equal(hud.distance, expedition.guidance.distance)
    if (Math.abs(original.bearing - hud.bearing) > 0.1) originalRouteDisagreed += 1
    if (expedition.route?.status === 'unavailable') {
      unavailable += 1
      assert.equal(hud.routeLabel, 'по прямой, не дорога')
    }
  }
  assert.ok(originalRouteDisagreed > 0, 'fixture must expose disagreement, not compare identical paths')
  assert.ok(unavailable > 0, 'exercise explicit no-road guidance')
})

test('bridge HUD preserves the cautious route rather than replacing it with the opening itinerary', () => {
  const value = harness('elf', 1)
  const start = getFactionStartPosition2D(value.blueprint, 'elf')
  assert.ok(start)
  value.player.position.set(start.x, 0, start.z)
  for (const region of value.chronicleRegions.values()) region.control = 'neutral'
  const risk = value.chronicleRegions.get('region-0-1')
  assert.ok(risk)
  risk.control = 'guard'
  Reflect.set(value.engine, 'chronicleContestedRegionIds', new Set(['region-0-1']))
  const input = invoke<ExpeditionInput>(value.engine, 'buildExpeditionInput')
  input.discoveredRegionIds = new Set(value.blueprint.regions.map((region) => region.id))
  const planner = new ExpeditionPlanner(value.blueprint)
  planner.select({ kind: 'bridgeAmbush', id: value.plan.id }, input)
  planner.setPreference('cautious')
  const expedition = planner.buildView(input)
  assert.ok(expedition.cautious && expedition.shortest)
  assert.ok(expedition.cautious.knownRiskDistance < expedition.shortest.knownRiskDistance)
  const afterFork = { x: -160, z: -160 }
  const rerouted = planner.buildView({ ...input, player: afterFork })
  assert.ok(rerouted.guidance)
  const hud = buildBridgeAmbushView(value.blueprint, 'elf', input.objectives,
    value.plan, value.state, afterFork, input.heading, false, true, rerouted)
  assert.equal(hud.bearing, rerouted.guidance.bearing)
  assert.equal(hud.distance, rerouted.guidance.distance)
  assert.equal(rerouted.preference, 'cautious')
})

test('a restored bridge route agrees with the atlas on its very first frame', () => {
  const value = harness('guard', 2_863_296_181)
  invoke(value.engine, 'trackBridgeAmbush')
  const saved = invoke<ActiveRunSaveV3>(value.engine, 'saveGeneratedRun')
  const regionId = 'region-1-1'
  const bounds = getBlueprintRegionBounds(value.blueprint, regionId)
  assert.ok(bounds)
  saved.currentLocation = {
    regionId, worldPosition: [-80, 0, -80],
    localPosition: [-80 - bounds.minX, 0, -80 - bounds.minZ], heading: 0.25,
  }
  const restored = buildInitialGameView({
    blueprint: value.blueprint, config: saved.config, restored: saved,
  })
  assert.ok(restored.expedition.guidance)
  assert.equal(restored.bridgeAmbush?.bearing, restored.expedition.guidance.bearing)
  assert.equal(restored.bridgeAmbush?.distance, restored.expedition.guidance.distance)
})

test('astra guard bridge defers overlapping ordinary actors, preserves required/ongoing fights, then restores them', () => {
  const value = harness('guard', 2_863_296_181)
  const plans = Object.values(createGeneratedEncounterPlans(value.blueprint, 'guard'))
  const overlapping = plans.find((plan) =>
    plan.regionId === value.plan.regionId &&
    plan.kind !== 'boss' &&
    plan.spawns.some((spawn) => bridgeAmbushReservesStagingPoint(
      value.plan,
      value.state,
      { x: spawn.worldX, z: spawn.worldZ },
    )))
  assert.ok(overlapping)
  assert.equal(overlapping.encounterId, 'encounter-region-2-3')
  const blueprintBefore = JSON.stringify(value.blueprint)
  const squad = Array.from({ length: 3 }, (_, index) => {
    const member = actor(`astra-squad:${index}`, 'guard', 'soldier', 'squad')
    member.generatedSpawnId = null
    member.squadEligible = true
    return member
  })
  value.actors.push(...squad)
  const usageBefore = invoke(value.engine, 'actorUsageByCategory')
  Reflect.set(value.engine, 'generatedEncounterPlans',
    new Map([[value.plan.regionId, [overlapping]]]))
  Reflect.set(value.engine, 'generatedActivationSpawns',
    new Map([[value.plan.regionId, new Set<string>()]]))

  invoke(value.engine, 'spawnGeneratedRegionEncounters', value.plan.regionId)
  assert.deepEqual(value.actors, squad)
  assert.deepEqual(invoke(value.engine, 'actorUsageByCategory'), usageBefore)
  assert.equal(Reflect.get(value.engine, 'generatedActivationSpawns')
    .get(value.plan.regionId).size, 0)
  assert.equal(value.regions.getSavedDelta(value.plan.regionId)
    ?.defeatedActorIds.some((id) => overlapping.spawns.some((spawn) => spawn.id === id)) ?? false, false)

  const required = structuredClone(overlapping)
  required.id = `${overlapping.id}:required`
  required.encounterId = required.id
  required.spawns = required.spawns.map((spawn, index) => ({
    ...spawn,
    id: `${required.id}:actor:${index}`,
    encounterId: required.id,
    objective: index === 0,
    objectiveEligible: index === 0,
  }))
  Reflect.set(value.engine, 'generatedEncounterPlans',
    new Map([[value.plan.regionId, [required]]]))
  Reflect.set(value.engine, 'generatedActivationSpawns',
    new Map([[value.plan.regionId, new Set<string>()]]))
  invoke(value.engine, 'spawnGeneratedRegionEncounters', value.plan.regionId)
  assert.equal(value.actors.filter((entry) =>
    entry.generatedEncounterId === required.encounterId).length, required.spawns.length)
  assert.ok(squad.every((member) => value.actors.includes(member)))

  value.actors.splice(3)
  const first = actor(
    overlapping.spawns[0].id,
    overlapping.spawns[0].faction,
    overlapping.spawns[0].role,
  )
  first.generatedRegionId = value.plan.regionId
  first.generatedEncounterId = overlapping.encounterId
  value.actors.push(first)
  Reflect.set(value.engine, 'generatedEncounterPlans',
    new Map([[value.plan.regionId, [overlapping]]]))
  Reflect.set(value.engine, 'generatedActivationSpawns',
    new Map([[value.plan.regionId, new Set([overlapping.spawns[0].id])]]))
  invoke(value.engine, 'spawnGeneratedRegionEncounters', value.plan.regionId)
  assert.equal(value.actors.filter((entry) =>
    entry.generatedEncounterId === overlapping.encounterId).length, overlapping.spawns.length)
  assert.ok(value.actors.includes(first), 'ongoing visible actor was despawned')

  value.actors.splice(3)
  value.state.phase = 'resolved'
  value.state.outcome = 'seize'
  value.state.rewardPaid = true
  value.state.consequence = 'resolved'
  Reflect.set(value.engine, 'generatedActivationSpawns',
    new Map([[value.plan.regionId, new Set<string>()]]))
  invoke(value.engine, 'spawnGeneratedRegionEncounters', value.plan.regionId)
  assert.equal(value.actors.filter((entry) =>
    entry.generatedEncounterId === overlapping.encounterId).length, overlapping.spawns.length)
  assert.ok(squad.every((member) => value.actors.includes(member)))
  assert.ok(value.actors.length <= MAX_ACTORS)
  assert.equal(JSON.stringify(value.blueprint), blueprintBefore)
})

interface HarnessActor {
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
  budgetCategory: 'squad' | 'campaign' | 'chronicle' | 'ambient'
  eventOwnerId: string | null
  eventPropTargetId: string | null
  aiMode: 'normal' | 'attackEventProp'
  home: THREE.Vector3
  wanderTarget: THREE.Vector3
  order: null | { kind: string; position: THREE.Vector3; timer: number }
  routTimer: number
  attackCooldown: number
  action: null
  healthBar: THREE.Sprite
  healthBarTexture: THREE.Texture
}

function actor(
  id: string,
  allegiance: Allegiance,
  role: ActorRole,
  category: HarnessActor['budgetCategory'] = 'campaign',
): HarnessActor {
  const mesh = new THREE.Group()
  return {
    id: `generated:${id}`,
    allegiance,
    role,
    mesh,
    alive: true,
    hp: 60,
    maxHp: 60,
    targetId: null,
    generatedSpawnId: id,
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
    home: mesh.position.clone(),
    wanderTarget: mesh.position.clone(),
    order: null,
    routTimer: 0,
    attackCooldown: 0,
    action: null,
    healthBar: new THREE.Sprite(),
    healthBarTexture: new THREE.Texture(),
  }
}

function achievementState(runId: string, faction: Faction) {
  return {
    runId,
    faction,
    startedAt: '2026-09-09T10:00:00.000Z',
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

function harness(faction: Faction = 'guard', seed = 20_260_909) {
  const blueprint = generateWorld(seed)
  const plan = createBridgeAmbushPlan(blueprint, faction)
  assert.ok(plan)
  const state = createBridgeAmbushState(blueprint, faction, plan)
  const player = new THREE.Group()
  player.position.set(plan.cargoStart.x, 0, plan.cargoStart.z)
  const cart = new THREE.Group()
  cart.position.set(plan.cargoStart.x, 0, plan.cargoStart.z)
  const actors: HarnessActor[] = []
  const notices: string[] = []
  const regions = new RegionManager(blueprint)
  regions.update(plan.regionId)
  const chronicleRegions = createChronicleRegions(blueprint)
  const finale = createFinaleState(createFinaleIdentity(blueprint, faction))
  const runId = `bridge-test-${faction}`
  const squadCommand = createSquadCommandState({
    x: player.position.x,
    z: player.position.z,
    heading: 0,
  }, false)
  const engine: object = Object.create(GameEngine.prototype)
  const generatedWorld = {
    bounds: blueprint.bounds,
    regions,
    discoveredRegionIds: [plan.regionId],
    sampleHeight: () => 0,
    getRegionIdAt: () => plan.regionId,
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
    generatedRun: {
      runId,
      config: {
        seed: blueprint.seed,
        generatorVersion: blueprint.generatorVersion,
        faction,
        selectedBoonId: 'provisions',
      },
      startedAt: '2026-09-09T10:00:00.000Z',
    },
    bridgeAmbushPlan: plan,
    bridgeAmbushState: state,
    bridgeAmbushCart: cart,
    bridgeAmbushSpawnRetryAt: 0,
    bridgeAmbushCapacityNoticeShown: false,
    player,
    actors,
    eventPropTargets: new Map(),
    simulatedGeneratedRegions: new Set([plan.regionId]),
    generatedEncounterPlans: new Map(),
    generatedActivationSpawns: new Map(),
    generatedNavigationCache: new Map(),
    actorSequence: 0,
    elapsed: 20,
    paused: false,
    ended: false,
    gold: 55,
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    kills: 0,
    damage: 28,
    body: createHealthyBody(),
    objectives: createGeneratedObjectives(blueprint, faction),
    upgrades: { blade: 0, vitality: 0, endurance: 0 },
    generatedSupplyCount: 0,
    generatedHealthBonus: 0,
    generatedStaminaBonus: 0,
    threatTier: 1,
    nextThreatWaveAt: 180,
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
    chronicleRegions,
    chronicleState: createChronicleState(),
    chronicleContestedRegionIds: new Set(),
    doctrines: createDoctrineRunState([]),
    doctrineEffects: resolveDoctrineEffects([]),
    finale,
    squadCommand,
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
    generatedRngStreams: {
      combat: new RandomStream(1),
      director: new RandomStream(2),
      event: new RandomStream(3),
      loot: new RandomStream(4),
      chronicle: new RandomStream(5),
      rumour: new RandomStream(6),
    },
    achievements: {
      getRunState: () => achievementState(runId, faction),
      recordGoldEarned() {},
      recordCaravanRobbed() {},
    },
    callbacks: {
      onNotice: (message: string) => notices.push(message),
      onSaveRequest() {},
    },
    scene: new THREE.Scene(),
    projectiles: [],
    projectileSourcesToClear: new Set(),
    updatingProjectiles: false,
    squadNavigationRevision: '',
  })
  Reflect.set(engine, 'actorBudget', new ActorBudget((category, count) =>
    invoke<number>(engine, 'yieldActorSlots', category, count)))
  for (const method of [
    'emitView',
    'playSound',
    'drawActorHealthBar',
    'releaseActorTelegraph',
    'removeAndDisposeObject',
    'registerNamedInteractableOutline',
    'resumeAudio',
  ]) {
    Reflect.set(engine, method, () => {})
  }
  Reflect.set(engine, 'groundHeightAt', () => 0)
  Reflect.set(engine, 'isWalkablePosition', () => true)
  Reflect.set(engine, 'actorColliderRadiusForRole', () => 0.7)
  Reflect.set(engine, 'moveCharacter', (
    position: THREE.Vector3,
    dx: number,
    dz: number,
  ) => {
    position.x += dx
    position.z += dz
    return false
  })
  Reflect.set(engine, 'spawnActor', (
    allegiance: Allegiance,
    role: ActorRole,
    x: number,
    z: number,
    _index: number,
    options: {
      budget: HarnessActor['budgetCategory']
      generatedSpawnId: string
      generatedRegionId: string
      generatedEncounterId: string
      generatedUnique: boolean
      eventOwnerId: string
      eventPropTargetId: string | null
      aiMode: HarnessActor['aiMode']
    },
  ) => {
    assert.ok(actors.length < MAX_ACTORS)
    const spawned = actor(options.generatedSpawnId, allegiance, role, options.budget)
    spawned.mesh.position.set(x, 0, z)
    Object.assign(spawned, options)
    actors.push(spawned)
    return spawned
  })
  return { engine, blueprint, plan, state, player, cart, actors, notices, regions, chronicleRegions }
}

test('production choice and delivery methods enforce proximity, movement, consequence, and one payout', () => {
  const seized = harness('elf')
  readyCombatants(seized.state)
  seized.state.phase = 'fighting'
  assert.equal(invoke<boolean>(seized.engine, 'chooseBridgeAmbush', 'seize'), false)
  readyCombatants(seized.state, true)
  seized.state.phase = 'secured'
  const seizedObjectives = JSON.stringify(Reflect.get(seized.engine, 'objectives'))
  seized.player.position.x += 20
  assert.equal(invoke<boolean>(seized.engine, 'chooseBridgeAmbush', 'seize'), false)
  assert.equal(Reflect.get(seized.engine, 'gold'), 55)
  seized.player.position.copy(seized.cart.position)
  assert.equal(invoke<boolean>(seized.engine, 'chooseBridgeAmbush', 'seize'), true)
  assert.equal(Reflect.get(seized.engine, 'gold'), 140)
  assert.equal(invoke<boolean>(seized.engine, 'chooseBridgeAmbush', 'seize'), false)
  assert.equal(Reflect.get(seized.engine, 'gold'), 140)
  assert.equal(JSON.stringify(Reflect.get(seized.engine, 'objectives')), seizedObjectives)
  const seizedSave = invoke<ActiveRunSaveV3>(seized.engine, 'saveGeneratedRun')
  const seizedRestore = normalizeBridgeAmbushState(
    seizedSave.directorState.bridgeAmbush,
    seized.blueprint,
    'elf',
    seized.plan,
  )
  assert.equal(seizedRestore.rejected, false)
  const reloaded = harness('elf')
  Reflect.set(reloaded.engine, 'bridgeAmbushState', seizedRestore.state)
  Reflect.set(reloaded.engine, 'gold', seizedSave.player.gold)
  assert.equal(invoke<boolean>(reloaded.engine, 'chooseBridgeAmbush', 'seize'), false)
  assert.equal(Reflect.get(reloaded.engine, 'gold'), 140)

  const delivered = harness('guard')
  const deliveredObjectives = JSON.stringify(Reflect.get(delivered.engine, 'objectives'))
  const contractsBefore = JSON.stringify(Reflect.get(delivered.engine, 'campaignContracts'))
  assert.equal(invoke<boolean>(delivered.engine, 'materializeBridgeAmbush'), true)
  assert.equal(delivered.state.phase, 'fighting')
  for (const combatant of delivered.state.combatants) {
    if (!combatant.enemy) continue
    const live = delivered.actors.find((entry) => entry.generatedSpawnId === combatant.id)
    assert.ok(live)
    live.alive = false
    live.hp = 0
  }
  invoke(delivered.engine, 'syncBridgeAmbushCombatState')
  assert.equal(delivered.state.phase, 'secured')
  assert.equal(invoke<boolean>(delivered.engine, 'chooseBridgeAmbush', 'deliver'), true)
  const before = delivered.cart.position.clone()
  delivered.player.position.set(
    delivered.cart.position.x + BRIDGE_AMBUSH_DELIVERY_ESCORT_RADIUS + 1,
    0,
    delivered.cart.position.z,
  )
  invoke(delivered.engine, 'updateBridgeAmbushDelivery', 1)
  assert.deepEqual(delivered.cart.position.toArray(), before.toArray())
  const supplyBefore = delivered.chronicleRegions.get(delivered.plan.regionId)?.supply ?? 0
  for (let step = 0; step < 100 && Reflect.get(delivered.state, 'phase') === 'delivering'; step += 1) {
    delivered.player.position.copy(delivered.cart.position)
    invoke(delivered.engine, 'updateBridgeAmbushDelivery', 0.25)
  }
  assert.equal(delivered.state.phase, 'resolved')
  assert.equal(delivered.state.outcome, 'deliver')
  assert.equal(delivered.state.rewardPaid, true)
  assert.ok(delivered.state.progress >= 0.99)
  assert.equal(Reflect.get(delivered.engine, 'generatedSupplyCount'), 2)
  assert.ok((delivered.chronicleRegions.get(delivered.plan.regionId)?.supply ?? 0) > supplyBefore)
  assert.equal(delivered.regions.getSavedDelta(delivered.plan.regionId)?.chronicle.supply,
    delivered.chronicleRegions.get(delivered.plan.regionId)?.supply)
  assert.equal(Reflect.get(delivered.engine, 'chronicleState').log.filter(
    (entry: { id: string }) => entry.id.startsWith('bridge-delivery-')).length, 1)
  invoke(delivered.engine, 'resolveBridgeAmbushDelivery')
  assert.equal(Reflect.get(delivered.engine, 'generatedSupplyCount'), 2)
  const deliveredSave = invoke<ActiveRunSaveV3>(delivered.engine, 'saveGeneratedRun')
  assert.equal(deliveredSave.directorState.supplyCount, 2)
  assert.equal(deliveredSave.regionDeltas[delivered.plan.regionId].chronicle.supply,
    delivered.chronicleRegions.get(delivered.plan.regionId)?.supply)
  const restoredOutcome = normalizeBridgeAmbushState(
    deliveredSave.directorState.bridgeAmbush,
    delivered.blueprint,
    'guard',
    delivered.plan,
  )
  assert.equal(restoredOutcome.rejected, false)
  assert.equal(restoredOutcome.state.outcome, 'deliver')
  assert.equal(restoredOutcome.state.rewardPaid, true)
  assert.equal(JSON.stringify(Reflect.get(delivered.engine, 'objectives')), deliveredObjectives)
  assert.equal(JSON.stringify(Reflect.get(delivered.engine, 'campaignContracts')), contractsBefore)
})

test('destroyed bridge cargo produces an explicit loss and cannot be claimed', () => {
  const value = harness('guard')
  assert.equal(invoke<boolean>(value.engine, 'materializeBridgeAmbush'), true)
  const target = Reflect.get(value.engine, 'eventPropTargets').get('bridge-ambush:cargo')
  assert.ok(target)
  target.hp = 0
  invoke(value.engine, 'syncBridgeAmbushCombatState')
  assert.equal(value.state.phase, 'lost')
  assert.equal(value.state.rewardPaid, false)
  assert.ok(value.state.consequence)
  assert.ok(value.notices.some((notice) => notice.includes('разбили телегу')))
  assert.equal(invoke<boolean>(value.engine, 'chooseBridgeAmbush', 'seize'), false)
  assert.equal(Reflect.get(value.engine, 'gold'), 55)
})

test('cargo loss survives reload with wounded enemies still present and no reopened reward', () => {
  const original = harness('guard')
  invoke(original.engine, 'materializeBridgeAmbush')
  original.actors[0].hp = 17
  original.actors[1].alive = false
  original.actors[1].hp = 0
  Reflect.get(original.engine, 'eventPropTargets').get('bridge-ambush:cargo').hp = 0
  invoke(original.engine, 'syncBridgeAmbushCombatState')
  const saved = invoke<ActiveRunSaveV3>(original.engine, 'saveGeneratedRun')
  const restored = normalizeBridgeAmbushState(
    saved.directorState.bridgeAmbush, original.blueprint, 'guard', original.plan,
  )
  assert.equal(restored.rejected, false)
  const continued = harness('guard')
  Reflect.set(continued.engine, 'bridgeAmbushState', restored.state)
  invoke(continued.engine, 'updateBridgeAmbush', 0)
  assert.equal(restored.state.phase, 'lost')
  assert.equal(restored.state.cargoHealth, 0)
  assert.equal(restored.state.rewardPaid, false)
  assert.equal(continued.actors.length, 3)
  assert.equal(continued.actors.find((entry) =>
    entry.generatedSpawnId === original.state.combatants[0].id)?.hp, 17)
  assert.equal(continued.actors.some((entry) =>
    entry.generatedSpawnId === original.state.combatants[1].id), false)
  assert.ok(continued.actors.every((entry) =>
    entry.aiMode === 'normal' && entry.eventPropTargetId === null))
  assert.equal(Reflect.get(continued.engine, 'eventPropTargets').size, 0)
  invoke(continued.engine, 'updateBridgeAmbush', 0)
  assert.equal(continued.actors.length, 3, 'a second frame must not duplicate survivors')
  assert.equal(invoke<boolean>(continued.engine, 'chooseBridgeAmbush', 'seize'), false)
  assert.equal(Reflect.get(continued.engine, 'gold'), 55)
})

test('a surviving caravan protector also rematerializes after securing or resolving cargo', () => {
  for (const phase of ['secured', 'delivering', 'resolved'] as const) {
    const value = harness('guard')
    readyCombatants(value.state, true)
    const protector = value.state.combatants.find((entry) => !entry.enemy)
    assert.ok(protector)
    protector.health = 23
    value.state.phase = phase
    value.state.outcome = phase === 'secured' ? null : phase === 'resolved' ? 'seize' : 'deliver'
    value.state.rewardPaid = phase === 'resolved'
    invoke(value.engine, 'updateBridgeAmbush', 0)
    assert.equal(value.state.phase, phase)
    assert.equal(value.actors.length, 1)
    assert.equal(value.actors[0].hp, 23)
    assert.equal(value.actors[0].aiMode, 'normal')
    assert.equal(Reflect.get(value.engine, 'generatedSupplyCount'), 0)
    assert.equal(Reflect.get(value.engine, 'gold'), 55)
  }
})

test('bridge deliveries log only a local destination site or a region-only arrival', () => {
  let localDestinations = 0
  let regionalDestinations = 0
  for (const seed of [20_260_909, 2_863_296_181, 2_828_435_045, 1, 2, 3]) {
    for (const faction of WORLD_FACTIONS) {
      const value = harness(faction, seed)
      readyCombatants(value.state, true)
      value.state.phase = 'delivering'
      value.state.outcome = 'deliver'
      const chronicle: ChronicleState = Reflect.get(value.engine, 'chronicleState')
      invoke(value.engine, 'resolveBridgeAmbushDelivery')
      const arrival = chronicle.log.find((entry) => entry.kind === 'caravanArrived')
      assert.ok(arrival)
      assert.equal(arrival.regionId, value.plan.regionId)
      const local = value.blueprint.sites.find((site) =>
        site.regionId === value.plan.regionId &&
        (site.kind === 'settlement' || site.kind === 'shop' || site.kind === 'recovery'))
      assert.equal(arrival.siteId, local?.id ?? null)
      if (local) localDestinations += 1
      else regionalDestinations += 1
      assert.equal(chronicle.caravans.length, 0, 'delivery must not invent a remote camp caravan')
      invoke(value.engine, 'resolveBridgeAmbushDelivery')
      assert.equal(chronicle.log.filter((entry) => entry.kind === 'caravanArrived').length, 1)
    }
  }
  assert.ok(localDestinations > 0)
  assert.ok(regionalDestinations > 0)
})

test('paused planning actions and an explicit bridge choice remain available until the run ends', () => {
  const value = harness('elf')
  Reflect.set(value.engine, 'paused', true)
  const root = value.blueprint.objectives.elf.nodes.find(
    (node) => node.siteId === value.blueprint.starts.elf,
  )
  assert.ok(root)
  const rootObjective = Reflect.get(value.engine, 'objectives').find(
    (objective: { id: string }) => objective.id === root.id,
  )
  assert.ok(rootObjective)
  assert.equal(rootObjective.done, false)
  const start = getFactionStartPosition2D(value.blueprint, 'elf')
  assert.ok(start)
  value.player.position.set(start.x, 0, start.z)

  assert.equal(invoke<boolean>(value.engine, 'trackBridgeAmbush'), true)
  assert.deepEqual(Reflect.get(value.engine, 'expeditionPlanner').serialize().target, {
    kind: 'bridgeAmbush',
    id: value.plan.id,
  })
  assert.equal(Reflect.get(value.engine, 'campaignContracts').pinnedNodeId, null)
  const expedition = Reflect.get(value.engine, 'expeditionPlanner').buildView(
    invoke(value.engine, 'buildExpeditionInput'),
  )
  assert.equal(expedition.route?.status, 'road')
  assert.deepEqual(validateExpeditionRoute(
    Reflect.get(value.engine, 'expeditionPlanner').graph,
    expedition.route,
  ), [])
  const trackedBeforeCamp = buildInitialGameView({
    blueprint: value.blueprint,
    config: Reflect.get(value.engine, 'generatedRun').config,
    restored: invoke<ActiveRunSaveV3>(value.engine, 'saveGeneratedRun'),
  })
  assert.equal(trackedBeforeCamp.objectives.find(
    (objective) => objective.id === root.id)?.done, false)
  assert.equal(trackedBeforeCamp.expedition.target?.kind, 'bridgeAmbush')
  assert.equal(trackedBeforeCamp.bridgeAmbush?.active, true)

  const ready = invoke<Array<{ id: string }>>(value.engine, 'getReadyGeneratedObjectives')
  assert.ok(ready.length > 0)
  invoke(value.engine, 'pinObjective', ready[0].id)
  assert.equal(Reflect.get(value.engine, 'campaignContracts').pinnedNodeId, ready[0].id)

  const commitments = Reflect.get(value.engine, 'chronicleCommitments')
  commitments.rumours.push({ id: 'pause-rumour', kind: 'defend' })
  invoke(value.engine, 'pinRumour', 'pause-rumour')
  assert.equal(commitments.pinnedRumourId, 'pause-rumour')

  const doctrines = createDoctrineRunState(DEFAULT_DOCTRINE_IDS)
  doctrines.anchors = 1
  Reflect.set(value.engine, 'doctrines', doctrines)
  Reflect.set(value.engine, 'doctrineEffects', resolveDoctrineEffects([]))
  const offer = invoke<string[]>(value.engine, 'getDoctrineOfferIds')
  assert.ok(offer.length > 0)
  assert.equal(invoke<boolean>(value.engine, 'chooseDoctrine', offer[0]), true)
  assert.deepEqual(doctrines.equipped, [offer[0]])

  readyCombatants(value.state, true)
  value.state.phase = 'secured'
  value.player.position.copy(value.cart.position)
  assert.equal(invoke<boolean>(value.engine, 'chooseBridgeAmbush', 'deliver'), true)
  assert.equal(value.state.phase, 'delivering')
  assert.equal(invoke<boolean>(value.engine, 'trackBridgeAmbush'), false)

  const ended = harness('elf')
  readyCombatants(ended.state, true)
  ended.state.phase = 'secured'
  Reflect.set(ended.engine, 'ended', true)
  invoke(ended.engine, 'pinObjective', ready[0].id)
  invoke(ended.engine, 'pinRumour', 'pause-rumour')
  assert.equal(invoke<boolean>(ended.engine, 'chooseDoctrine', offer[0]), false)
  assert.equal(invoke<boolean>(ended.engine, 'trackBridgeAmbush'), false)
  assert.equal(invoke<boolean>(ended.engine, 'chooseBridgeAmbush', 'seize'), false)
  assert.equal(ended.state.phase, 'secured')
  assert.equal(Reflect.get(ended.engine, 'gold'), 55)
})

test('E at secured cargo releases pointer lock for HTML choices without awarding an outcome', () => {
  const value = harness('elf')
  readyCombatants(value.state, true)
  value.state.phase = 'secured'
  const surface = {}
  Reflect.set(value.engine, 'renderer', { domElement: surface })
  let releases = 0
  Reflect.set(value.engine, 'releaseGameplayInput', () => { releases += 1 })
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const documentStub = {
    pointerLockElement: surface as object | null,
    exitPointerLock() { this.pointerLockElement = null },
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: documentStub,
  })
  try {
    assert.match(invoke<string>(value.engine, 'getBridgeAmbushPrompt'), /\[E\].*курсор/i)
    invoke(value.engine, 'interact')
    assert.equal(documentStub.pointerLockElement, null)
    assert.equal(releases, 1)
    assert.equal(value.state.phase, 'secured')
    assert.equal(value.state.outcome, null)
    assert.equal(value.state.rewardPaid, false)
    assert.equal(Reflect.get(value.engine, 'gold'), 55)
    assert.ok(value.notices.some((notice) => notice.includes('Курсор свободен')))
  } finally {
    if (previousDocument) {
      Object.defineProperty(globalThis, 'document', previousDocument)
    } else {
      Reflect.deleteProperty(globalThis, 'document')
    }
  }
})

test('production save captures mid-fight wounds and mid-delivery position without changing campaign state', () => {
  const fight = harness('guard')
  readyCombatants(fight.state)
  fight.state.phase = 'fighting'
  fight.state.combatants[0].health = 19
  fight.state.cargoHealth = 57
  Reflect.get(fight.engine, 'eventPropTargets').set('bridge-ambush:cargo', {
    id: 'bridge-ambush:cargo',
    ownerId: 'bridge-ambush',
    object: fight.cart,
    hp: 57,
    maxHp: 100,
    position: fight.cart.position,
    attackRange: 4,
  })
  const objectivesBefore = JSON.stringify(Reflect.get(fight.engine, 'objectives'))
  const fightSave = invoke<ActiveRunSaveV3>(fight.engine, 'saveGeneratedRun')
  const parsedFight = normalizeActiveRunSaveV3(JSON.parse(JSON.stringify(fightSave)))
  assert.ok(parsedFight)
  const fightState = normalizeBridgeAmbushState(
    parsedFight.directorState.bridgeAmbush,
    fight.blueprint,
    'guard',
    fight.plan,
  )
  assert.equal(fightState.rejected, false)
  assert.equal(fightState.state.combatants[0].health, 19)
  assert.equal(fightState.state.cargoHealth, 57)
  assert.equal(JSON.stringify(Reflect.get(fight.engine, 'objectives')), objectivesBefore)

  const delivery = harness('elf')
  assert.equal(invoke<boolean>(delivery.engine, 'trackBridgeAmbush'), true)
  readyCombatants(delivery.state, true)
  delivery.state.phase = 'delivering'
  delivery.state.outcome = 'deliver'
  const point = interpolate(delivery.plan, 0.47)
  delivery.cart.position.set(point.x, 0, point.z)
  delivery.state.cargoX = point.x
  delivery.state.cargoZ = point.z
  delivery.state.progress = bridgeAmbushDeliveryProgress(delivery.plan, point)
  const deliverySave = invoke<ActiveRunSaveV3>(delivery.engine, 'saveGeneratedRun')
  const parsedDelivery = normalizeActiveRunSaveV3(JSON.parse(JSON.stringify(deliverySave)))
  assert.ok(parsedDelivery)
  const deliveryState = normalizeBridgeAmbushState(
    parsedDelivery.directorState.bridgeAmbush,
    delivery.blueprint,
    'elf',
    delivery.plan,
  )
  assert.equal(deliveryState.rejected, false)
  assert.equal(deliveryState.state.phase, 'delivering')
  assert.equal(deliveryState.state.progress, delivery.state.progress)
  assert.equal(deliveryState.state.rewardPaid, false)
  const restoredView = buildInitialGameView({
    blueprint: delivery.blueprint, config: parsedDelivery.config, restored: parsedDelivery,
  })
  assert.equal(restoredView.expedition.mode, 'campaign')
  assert.notEqual(restoredView.expedition.target?.kind, 'bridgeAmbush')
  assert.equal(restoredView.expedition.notice, null)
  assert.equal(restoredView.bridgeAmbush?.phase, 'delivering')
})

test('initial, restored, and legacy launch views expose the same optional encounter contract', () => {
  const value = harness('elf')
  const config = Reflect.get(value.engine, 'generatedRun').config
  const fresh = buildInitialGameView({ blueprint: value.blueprint, config })
  assert.equal(fresh.bridgeAmbush?.phase, 'approach')
  assert.equal(fresh.bridgeAmbush?.active, false)
  assert.equal(fresh.markers.some((marker) => marker.id === 'bridge-ambush'), false)
  assert.equal(fresh.expedition.targets.some((target) =>
    target.kind === 'bridgeAmbush' && target.id === value.plan.id), true)

  readyCombatants(value.state)
  value.state.phase = 'fighting'
  value.state.combatants[1].health = 23
  value.state.cargoHealth = 71
  assert.equal(invoke<boolean>(value.engine, 'trackBridgeAmbush'), true)
  const saved = invoke<ActiveRunSaveV3>(value.engine, 'saveGeneratedRun')
  const restored = buildInitialGameView({ blueprint: value.blueprint, config, restored: saved })
  assert.equal(restored.bridgeAmbush?.phase, 'fighting')
  assert.equal(restored.bridgeAmbush?.cargoHealth, 71)
  assert.equal(restored.bridgeAmbush?.remainingEnemies, 3)
  assert.equal(restored.expedition.target?.kind, 'bridgeAmbush')
  assert.ok(
    restored.expedition.route?.status === 'road' ||
    restored.expedition.route?.status === 'arrived',
  )

  const legacy = structuredClone(saved)
  delete legacy.directorState.bridgeAmbush
  const legacyView = buildInitialGameView({ blueprint: value.blueprint, config, restored: legacy })
  assert.equal(legacyView.bridgeAmbush, null)
  assert.equal(legacyView.markers.some((marker) => marker.id === 'bridge-ambush'), false)
})

test('a pinned campaign route suppresses distant bridge HUD without removing its atlas destination', () => {
  const value = harness('elf')
  const root = value.blueprint.objectives.elf.nodes.find(
    (node) => node.siteId === value.blueprint.starts.elf,
  )
  assert.ok(root)
  const rootObjective = Reflect.get(value.engine, 'objectives').find(
    (objective: { id: string }) => objective.id === root.id,
  )
  assert.ok(rootObjective)
  rootObjective.done = true
  const ready = invoke<Array<{ id: string }>>(value.engine, 'getReadyGeneratedObjectives')
  assert.ok(ready.length > 0)
  invoke(value.engine, 'pinObjective', ready[0].id)
  const start = getFactionStartPosition2D(value.blueprint, 'elf')
  assert.ok(start)
  value.player.position.set(start.x, 0, start.z)
  const config = Reflect.get(value.engine, 'generatedRun').config

  const campaignView = buildInitialGameView({
    blueprint: value.blueprint,
    config,
    restored: invoke<ActiveRunSaveV3>(value.engine, 'saveGeneratedRun'),
  })
  assert.equal(campaignView.expedition.target?.kind, 'objective')
  assert.equal(campaignView.expedition.target?.committed, true)
  assert.equal(campaignView.bridgeAmbush?.active, false)
  assert.ok(campaignView.expedition.targets.some((target) =>
    target.kind === 'bridgeAmbush'))

  assert.equal(invoke<boolean>(value.engine, 'trackBridgeAmbush'), true)
  const bridgeView = buildInitialGameView({
    blueprint: value.blueprint,
    config,
    restored: invoke<ActiveRunSaveV3>(value.engine, 'saveGeneratedRun'),
  })
  assert.equal(bridgeView.expedition.target?.kind, 'bridgeAmbush')
  assert.equal(bridgeView.bridgeAmbush?.active, true)
})

test('streaming and actor eviction preserve living enemy health and never count absence as defeat', () => {
  const value = harness('elf')
  readyCombatants(value.state)
  value.state.phase = 'fighting'
  for (const combatant of value.state.combatants) {
    const live = actor(combatant.id, combatant.allegiance, combatant.role)
    live.generatedRegionId = value.plan.regionId
    live.generatedEncounterId = value.plan.id
    live.generatedUnique = true
    live.eventOwnerId = 'bridge-ambush'
    value.actors.push(live)
  }
  value.actors[0].hp = 31
  const far = value.blueprint.regions.find((region) => region.id !== value.plan.regionId)
  assert.ok(far)
  value.regions.update(far.id)
  invoke(value.engine, 'syncGeneratedRegions')
  assert.equal(value.actors.length, 0)
  assert.equal(value.state.combatants[0].health, 31)
  assert.equal(value.state.combatants[0].defeated, false)
  assert.equal(bridgeAmbushRemainingEnemies(value.state), 3)

  value.regions.update(value.plan.regionId)
  invoke(value.engine, 'syncGeneratedRegions')
  invoke(value.engine, 'materializeBridgeAmbush')
  assert.equal(value.actors.length, 3)
  assert.equal(value.actors.find(
    (entry) => entry.generatedSpawnId === value.state.combatants[0].id)?.hp, 31)
  assert.equal(bridgeAmbushRemainingEnemies(value.state), 3)

  const defeated = value.actors[0]
  defeated.alive = false
  defeated.hp = 0
  invoke(value.engine, 'removeActorById', defeated.id)
  invoke(value.engine, 'materializeBridgeAmbush')
  assert.equal(value.actors.some((entry) => entry.generatedSpawnId === defeated.generatedSpawnId), false)
  assert.equal(bridgeAmbushRemainingEnemies(value.state), 2)
})

test('bridge materialization respects the 25-actor cap and preserves squad slots', () => {
  const value = harness('elf')
  for (let index = 0; index < MAX_ACTORS; index += 1) {
    const category = index < 3 ? 'squad' : index < 11 ? 'campaign' : index < 19 ? 'chronicle' : 'ambient'
    const occupant = actor(`occupant:${index}`, index < 3 ? 'elf' : 'guard', 'soldier', category)
    occupant.generatedSpawnId = null
    occupant.squadEligible = index < 3
    value.actors.push(occupant)
  }
  assert.equal(invoke<boolean>(value.engine, 'materializeBridgeAmbush'), true)
  assert.equal(value.actors.length, MAX_ACTORS)
  assert.equal(value.actors.filter((entry) => entry.budgetCategory === 'squad').length, 3)
  assert.equal(value.actors.filter((entry) =>
    value.state.combatants.some((combatant) => combatant.id === entry.generatedSpawnId)).length, 3)
  assert.equal(value.state.phase, 'fighting')
})

test('ordinary caravan robbery requires escorts down and guard aid is earned, bounded, and cooled down', () => {
  function ordinary(faction: Faction) {
    const player = new THREE.Group()
    const caravan = new THREE.Group()
    const escort = actor('ordinary-escort', 'guard', 'soldier', 'ambient')
    const notices: string[] = []
    let ambushes = 0
    const engine: object = Object.assign(Object.create(GameEngine.prototype), {
      faction,
      player,
      caravan,
      actors: [escort],
      caravanEscortIds: [escort.id],
      activeEvents: [],
      paused: false,
      ended: false,
      caravanCooldown: 0,
      caravanDefenseCredit: false,
      caravanAidCooldown: 0,
      caravanRobbedFlash: 0,
      gold: 0,
      health: 50,
      maxHealth: 100,
      callbacks: { onNotice: (message: string) => notices.push(message) },
      achievements: { recordGoldEarned() {}, recordCaravanRobbed() {} },
      handleGeneratedInteraction: () => false,
      generatedInteraction: () => ({ site: null, node: null, kind: 'caravan', targetsObjective: false }),
      resumeAudio() {},
      emitView() {},
      playSound() {},
      spawnAmbush: () => { ambushes += 1 },
    })
    return { engine, escort, notices, ambushes: () => ambushes }
  }

  const raider = ordinary('elf')
  assert.match(invoke<string>(raider.engine, 'getGeneratedPrompt'), /охрана/i)
  invoke(raider.engine, 'interact')
  assert.equal(Reflect.get(raider.engine, 'gold'), 0)
  assert.equal(raider.ambushes(), 0)
  raider.escort.alive = false
  assert.match(invoke<string>(raider.engine, 'getGeneratedPrompt'), /\[E\]/)
  invoke(raider.engine, 'interact')
  assert.equal(Reflect.get(raider.engine, 'gold'), 95)
  assert.equal(raider.ambushes(), 1)

  const guard = ordinary('guard')
  invoke(guard.engine, 'interact')
  invoke(guard.engine, 'interact')
  assert.equal(Reflect.get(guard.engine, 'health'), 50)
  Reflect.set(guard.engine, 'caravanDefenseCredit', true)
  assert.match(invoke<string>(guard.engine, 'getGeneratedPrompt'), /перевязку/i)
  invoke(guard.engine, 'interact')
  assert.equal(Reflect.get(guard.engine, 'health'), 58)
  invoke(guard.engine, 'interact')
  assert.equal(Reflect.get(guard.engine, 'health'), 58)
  assert.ok(Reflect.get(guard.engine, 'caravanAidCooldown') > 0)
})
