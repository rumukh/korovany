/**
 * W1-5 — the harness's fights, held to the shipped builders.
 *
 * `tests/runHarnessEvents.ts` writes down what `GameEngine`'s ten event builders, its loot
 * roll, its threat wave and its road caravan put on the ground, because none of them can
 * run headless: every one of them builds a mesh. A copy of a rule is only as good as the
 * proof that it is still the rule, so this file loads the **shipped `GameEngine` class** —
 * not extracted source, not a re-implementation — and calls those very methods on a minimal
 * `this` whose world answers from the harness's own terrain and collision. The same random
 * stream state, the same player, the same site: every spawn has to come out with the same
 * side, role, coordinates and orders, every event with the same clock and target, and both
 * streams have to end in the same state, which is what proves the two took the same draws.
 *
 * The lifecycle half drives the engine's own `update` / `onKill` / `onInteract` closures
 * and the harness's `evaluateEvent*` through the same scenarios.
 *
 * W1-2 changed who gets a cart once its escort is down, and the ambush verdict above went
 * red the day it landed — which is what this file is for. The claim rules themselves run as
 * `world/CaravanClaim.ts` on both sides; what is compared is the wiring around them: who may
 * load the road cart, who is free to start, the frame the last escort falls and where an
 * idle raider is sent, driven beside `updateCaravanEscort` and the ambush's `update`.
 *
 * And W1-1. This file first ran `updateContractNode` with a random event standing and the
 * player on the contract's site, and watched it abandon the contract after
 * `startGraceSeconds` — the defect the harness had to reproduce, with a note that the test
 * was meant to fail the day the fix landed. It did. The test now drives the fixed rule: the
 * random event stands down unless the player is in the middle of it, in which case the
 * contract waits with its grace paused. The harness's `contractStartGate` is read beside it
 * on every frame, and the rule W1-1 replaced is kept as the negative control.
 *
 * And the streaming window, which W1-6 found: the engine sees a 3x3 but simulates only the
 * plus inside it. A real `GeneratedWorldRuntime` is walked over the whole map, and the
 * engine's own `syncGeneratedRegions` is run after every step. The harness's `engine`
 * window has to name the squares it spawns encounters in, in its order. The pinned 3x3 is
 * the control, and has to be told apart from the engine on every square.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { getSiteWorldPosition2D } from '../src/game/content/registry.ts'
import {
  areAllegiancesHostile,
  type ActorRole,
  type Allegiance,
  type Faction,
  type LootRarity,
} from '../src/game/types.ts'
import { ActorBudget, type ActorBudgetCategory } from '../src/game/world/ActorBudget.ts'
import {
  createCaravanClaimState,
  interruptCaravanLoot,
  noteCaravanEscortHit,
  type CaravanClaimState,
} from '../src/game/world/CaravanClaim.ts'
import type { SquadMembership } from '../src/game/world/SquadCommand.ts'
import { CollisionWorld } from '../src/game/systems/CollisionWorld.ts'
import { createFinaleIdentity, createFinaleState } from '../src/game/world/FinaleDirector.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { TerrainSystem } from '../src/game/world/TerrainSystem.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import {
  CONTRACT_TEMPLATES,
  createCampaignContractState,
  createGeneratedObjectives,
  getContractProgress,
  getContractStatus,
  pinObjective,
} from '../src/game/world/CampaignDirector.ts'
import type { PendingMaterialization } from '../src/game/world/Materialization.ts'
import type { WorldBlueprint } from '../src/game/world/worldTypes.ts'
import {
  HARNESS_CARAVAN_AMBUSH_DEFENDED_REWARD,
  HARNESS_EVENT_REQUIRED_SLOTS,
  HARNESS_EVENT_WEIGHTS,
  HARNESS_LOCATED_EVENT_REWARDS,
  HARNESS_ORDER_DURATION,
  advanceAmbushLoot,
  advanceRoadCartLoot,
  contractStartGate,
  createAmbushLoot,
  evaluateEventFrame,
  evaluateEventKill,
  eventProgress,
  findCartLooter,
  mayLootRoadCart,
  planBounty,
  planCaravanPatrol,
  planChampion,
  planDefendHome,
  planLocatedEvent,
  planRescue,
  planRichCaravan,
  planThreatWave,
  playerEngagedWith,
  raiderApproachPoint,
  regionCenter,
  rollKillLoot,
  rollLoot,
  sampleCartLooter,
  type EventPlan,
  type EventProgressView,
  type EventWorld,
  type LooterBody,
  type PlanPoint,
} from './runHarnessEvents.ts'
import {
  HARNESS_COMMANDER_INTERVAL,
  HARNESS_COMMANDER_LIMIT,
  HARNESS_SCREEN_ASPECT,
  advanceCommanderClock,
  commanderGathers,
  createCommanderClock,
  createRegionWindow,
  harnessStagingViewer,
  type CommanderModel,
} from './runHarness.ts'
import { CAMERA_BASE_FOV, CAMERA_DEFAULT_PITCH } from '../src/game/cameraAccents.ts'
import type { StagingViewer } from '../src/game/world/StagingRoom.ts'

// The shipped class, through the same extensionless-import adapter `squadRuntimeHarness.ts`
// uses. Nothing here edits it: every method called below is `GameEngine.prototype`'s own.
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
const { GameEngine: RuntimeEngine } = await import('../src/game/GameEngine.ts')
hooks.deregister()

// ---------------------------------------------------------------------------
// A world both sides read
// ---------------------------------------------------------------------------

interface Bench {
  blueprint: WorldBlueprint
  terrain: TerrainSystem
  collision: CollisionWorld
}

const benches = new Map<number, Bench>()
function bench(seed: number): Bench {
  const cached = benches.get(seed)
  if (cached) return cached
  const blueprint = generateWorld(seed)
  const terrain = new TerrainSystem(blueprint)
  const collision = new CollisionWorld(terrain)
  collision.setWorldBounds(terrain.bounds)
  const made = { blueprint, terrain, collision }
  benches.set(seed, made)
  return made
}

interface Recorded {
  allegiance: string
  role: string
  x: number
  z: number
  options: Record<string, unknown>
  actor: FakeActor
}

interface FakeActor {
  id: string
  allegiance: string
  role: string
  alive: boolean
  hp: number
  maxHp: number
  hostileToPlayer: boolean
  playerAggro: boolean
  aiMode: string
  eventOwnerId: string | null
  squadEligible: boolean
  budgetCategory: string
  generatedRegionId: string | null
  squadSlot: number | null
  targetId: string | null
  ignoredTargetId: string | null
  packId: string | null
  packKinSize: number
  mesh: { position: THREE.Vector3; getObjectByName: () => undefined }
  home: THREE.Vector3
  wanderTarget: THREE.Vector3
  // W1-2 — what `sampleCaravanLooter` and `mayLootOrdinaryCaravan` read.
  routTimer: number
  reaction: 'none' | 'flinch' | 'stagger'
  knockbackVelocity: THREE.Vector3
  action: object | null
  retaliationTimer: number
  rageTimer: number
  chargeWindup: number
  chargeTimer: number
  order: { kind: string; position: THREE.Vector3; timer: number } | null | undefined
  generatedEncounterId: string | null
  generatedSpawnId: string | null
}

/**
 * A `GameEngine` with nothing but the fields the builders read. Presentation is a sink;
 * every decision — positions, factions, draws, the event's clock — is the shipped method's.
 */
function engineFor(
  seed: number,
  faction: Faction,
  player: PlanPoint,
  rng: RandomStream,
  caravanDirection: PlanPoint = { x: 1, z: 0 },
) {
  const { blueprint, terrain, collision } = bench(seed)
  const spawned: Recorded[] = []
  const actors: FakeActor[] = []
  const self = Object.assign(Object.create(RuntimeEngine.prototype), {
    faction,
    generatedBlueprint: blueprint,
    generatedRngStreams: { event: rng },
    eventRng: () => rng.next(),
    lootRng: () => rng.next(),
    directorRng: () => rng.next(),
    player: { position: new THREE.Vector3(player.x, 0, player.z) },
    actors,
    threatTier: 1,
    damage: 28,
    elapsed: 0,
    eventSequence: 0,
    actorSequence: 0,
    scene: { add() {} },
    eventPropTargets: new Map(),
    locatedEventCopy: new Map(),
    generatedCaravanTravelDirection: new THREE.Vector2(caravanDirection.x, caravanDirection.z),
    generatedWorld: {
      bounds: terrain.bounds,
      collision,
      getRegionIdAt: (x: number, z: number) => terrain.getRegionIdAt(x, z),
      getSitePosition: (siteId: string) => {
        const position = getSiteWorldPosition2D(blueprint, siteId)
        return position ? { x: position.x, y: 0, z: position.z } : undefined
      },
      getRegionCenter: (regionId: string) => {
        const center = regionCenter(blueprint, String(regionId))
        return center ? { x: center.x, y: 0, z: center.z } : undefined
      },
    },
    reserveActorSlots: () => true,
    reserveActorSlotsUpTo: (_category: string, count: number) => count,
    createCaravan: () => new THREE.Group(),
    registerNamedInteractableOutline: () => null,
    groundHeightAt: () => 0,
    createHouseFireEffect: () => new THREE.Group(),
    createBeastLairEffect: () => new THREE.Group(),
    spawnDecal: () => {},
    spawnSmokeParticle: () => {},
    unbindActorArms: () => {},
    playSound: () => {},
    emitView: () => {},
    callbacks: { onNotice: () => {} },
    spawnActor(
      allegiance: string,
      role: string,
      x: number,
      z: number,
      _index: number,
      options: Record<string, unknown>,
    ): FakeActor {
      const actor: FakeActor = {
        id: `${allegiance}-${role}-${spawned.length}`,
        allegiance,
        role,
        alive: true,
        hp: 70,
        maxHp: 70,
        hostileToPlayer:
          (options.hostileToPlayer as boolean | undefined) ??
          areAllegiancesHostile(allegiance as Faction, faction),
        playerAggro: false,
        aiMode: (options.aiMode as string | undefined) ?? 'normal',
        eventOwnerId: (options.eventOwnerId as string | null | undefined) ?? null,
        squadEligible: (options.squadEligible as boolean | undefined) ?? true,
        budgetCategory: options.budget as string,
        generatedRegionId: (options.generatedRegionId as string | null | undefined) ?? null,
        squadSlot: null,
        targetId: null,
        ignoredTargetId: (options.ignoredTargetId as string | null | undefined) ?? null,
        packId: (options.packId as string | null | undefined) ?? null,
        packKinSize: (options.packKinSize as number | undefined) ?? 1,
        mesh: { position: new THREE.Vector3(x, 0, z), getObjectByName: () => undefined },
        home: new THREE.Vector3(),
        wanderTarget: new THREE.Vector3(),
        routTimer: 0,
        reaction: 'none',
        knockbackVelocity: new THREE.Vector3(),
        action: null,
        retaliationTimer: 0,
        rageTimer: 0,
        chargeWindup: 0,
        chargeTimer: 0,
        order: null,
        generatedEncounterId: null,
        generatedSpawnId: null,
      }
      spawned.push({ allegiance, role, x, z, options, actor })
      actors.push(actor)
      return actor
    },
  })
  return { self, spawned, actors }
}

function harnessWorld(
  seed: number,
  faction: Faction,
  player: PlanPoint,
  rng: RandomStream,
  caravanDirection: PlanPoint = { x: 1, z: 0 },
): EventWorld {
  const { blueprint, terrain, collision } = bench(seed)
  return {
    blueprint,
    faction,
    rng,
    player,
    bounds: terrain.bounds,
    isWalkable: (x, z, radius) => collision.isWalkablePosition(x, z, radius),
    caravanTravelDirection: caravanDirection,
  }
}

const round = (value: number): number => Math.round(value * 1e6) / 1e6

/** What the engine spawned, in the harness's vocabulary. */
function engineSpawns(recorded: Recorded[]) {
  const captive = recorded.find((entry) => entry.role === 'captive')
  return recorded.map((entry) => ({
    allegiance: entry.allegiance,
    role: entry.role,
    x: round(entry.x),
    z: round(entry.z),
    aiMode: entry.actor.aiMode,
    ignoresCaptive: captive !== undefined && entry.actor.ignoredTargetId === captive.actor.id,
    targetsProp: entry.options.eventPropTargetId !== undefined && entry.options.eventPropTargetId !== null,
    pack: entry.actor.packId !== null,
    packKinSize: entry.actor.packKinSize,
    playerAggro: entry.actor.playerAggro,
  }))
}

/** What the harness plans, after the spawn-time aggro rule is applied as the engine does. */
function planSpawns(plan: EventPlan, faction: Faction) {
  return plan.spawns.map((entry) => {
    const hostile = areAllegiancesHostile(entry.allegiance, faction)
    return {
      allegiance: entry.allegiance,
      role: entry.role,
      x: round(entry.x),
      z: round(entry.z),
      aiMode: entry.aiMode,
      ignoresCaptive: entry.ignoresCaptive,
      targetsProp: entry.targetsProp,
      pack: entry.pack,
      packKinSize: entry.packKinSize,
      playerAggro: entry.aggroIfHostile ? hostile : false,
    }
  })
}

const FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']
const SEEDS = [20261006, 424242, 7919]

/** A spot `distance` metres from a site, along a fixed bearing, for the located pickers. */
function standOff(seed: number, siteId: string, distance: number): PlanPoint {
  const site = getSiteWorldPosition2D(bench(seed).blueprint, siteId)
  if (!site) throw new Error(`missing site ${siteId}`)
  return { x: site.x + distance * 0.6, z: site.z + distance * 0.8 }
}

// ---------------------------------------------------------------------------
// 1. The five player-anchored builders
// ---------------------------------------------------------------------------

test('the five player-anchored plans are the shipped builders, draw for draw', () => {
  let compared = 0
  for (const seed of SEEDS) {
    const { blueprint } = bench(seed)
    for (const faction of FACTIONS) {
      const start = getSiteWorldPosition2D(blueprint, blueprint.starts[faction])
      if (!start) throw new Error('no start')
      const player = { x: start.x + 4, z: start.z - 3 }
      const builders = [
        ['startRichCaravanEvent', (world: EventWorld) => planRichCaravan(world)],
        ['startDefendHomeEvent', (world: EventWorld) => planDefendHome(world)],
        ['startChampionEvent', (world: EventWorld) => planChampion(world)],
        ['startRescueEvent', (world: EventWorld) => planRescue(world)],
        ['startBountyEvent', (world: EventWorld) => planBounty(world)],
      ] as const
      for (const [method, plan] of builders) {
        for (const origin of [undefined, { x: player.x + 30, z: player.z - 10 }]) {
          const engineRng = new RandomStream(seed + compared)
          const harnessRng = new RandomStream(seed + compared)
          const engine = engineFor(seed, faction, player, engineRng, { x: 0.6, z: 0.8 })
          const event = engine.self[method](
            origin ? new THREE.Vector3(origin.x, 0, origin.z) : undefined,
          )
          const planned = origin
            ? method === 'startDefendHomeEvent'
              ? planDefendHome(harnessWorld(seed, faction, player, harnessRng, { x: 0.6, z: 0.8 }), origin)
              : method === 'startRichCaravanEvent'
                ? planRichCaravan(harnessWorld(seed, faction, player, harnessRng, { x: 0.6, z: 0.8 }), origin)
                : method === 'startChampionEvent'
                  ? planChampion(harnessWorld(seed, faction, player, harnessRng), origin)
                  : method === 'startRescueEvent'
                    ? planRescue(harnessWorld(seed, faction, player, harnessRng), origin)
                    : planBounty(harnessWorld(seed, faction, player, harnessRng), origin)
            : plan(harnessWorld(seed, faction, player, harnessRng, { x: 0.6, z: 0.8 }))
          if (event === null) {
            assert.equal(planned, null, `${method} refused on seed ${seed} for ${faction}`)
            continue
          }
          assert.ok(planned, `${method}: the harness refused what the engine built`)
          assert.equal(planned.kind, event.kind)
          assert.equal(planned.anchor, event.anchor)
          assert.equal(planned.timer, event.timer, `${method} clock`)
          assert.equal(planned.target, event.target, `${method} target`)
          assert.equal(planned.slots, event.slots)
          assert.deepEqual(
            planSpawns(planned, faction),
            engineSpawns(engine.spawned),
            `${method} on seed ${seed} as ${faction}${origin ? ' at a contract origin' : ''}`,
          )
          assert.equal(
            harnessRng.state,
            engineRng.state,
            `${method} took a different number of draws`,
          )
          compared += 1
        }
      }
    }
  }
  // Non-vacuity: every builder ran on every seed and faction, with and without an origin.
  assert.ok(compared >= SEEDS.length * FACTIONS.length * 9, `only ${compared} comparisons ran`)
})

test('a changed builder parameter is caught, which is what the comparison is for', () => {
  // The negative control: perturb one plan the way a drifted copy would be wrong, and the
  // same comparison has to refuse it — or the equality above proves nothing.
  const seed = SEEDS[0]
  const { blueprint } = bench(seed)
  const start = getSiteWorldPosition2D(blueprint, blueprint.starts.elf)
  if (!start) throw new Error('no start')
  const engineRng = new RandomStream(5)
  const harnessRng = new RandomStream(5)
  const engine = engineFor(seed, 'elf', start, engineRng)
  engine.self.startRescueEvent()
  const planned = planRescue(harnessWorld(seed, 'elf', start, harnessRng))
  planned.spawns[1] = { ...planned.spawns[1], x: planned.spawns[1].x - 0.5 }
  assert.notDeepEqual(planSpawns(planned, 'elf'), engineSpawns(engine.spawned))
  const roles = planRescue(harnessWorld(seed, 'elf', start, new RandomStream(5)))
  roles.spawns[2] = { ...roles.spawns[2], role: 'brute' }
  assert.notDeepEqual(planSpawns(roles, 'elf'), engineSpawns(engine.spawned))
})

// ---------------------------------------------------------------------------
// 2. The five located builders
// ---------------------------------------------------------------------------

function situationFor(
  seed: number,
  kind: PendingMaterialization['kind'],
  faction: Faction,
): PendingMaterialization | null {
  const { blueprint } = bench(seed)
  const site = blueprint.sites.find(
    (candidate) =>
      candidate.kind === 'settlement' &&
      candidate.regionId !== blueprint.sites.find((start) => start.id === blueprint.starts[faction])?.regionId,
  )
  if (!site) return null
  return {
    id: `fidelity:${kind}:${site.id}`,
    kind,
    regionId: String(site.regionId),
    sourceRegionId: null,
    siteId: kind === 'caravanAmbush' ? site.id : site.id,
    faction: kind === 'beastRaid' ? null : faction === 'elf' ? 'guard' : 'elf',
    defender: faction === 'villain' ? 'guard' : 'villain',
    caravanId: kind === 'caravanAmbush' ? 'caravan-fidelity' : null,
    beastPressure: 0.82,
    urgency: 1,
  }
}

test('the five located plans are the shipped builders, draw for draw', () => {
  let compared = 0
  const builders = [
    ['factionRaid', 'startFactionRaidEvent'],
    ['caravanAmbush', 'startCaravanAmbushEvent'],
    ['warband', 'startWarbandEvent'],
    ['aftermath', 'startAftermathEvent'],
    ['beastRaid', 'startBeastRaidEvent'],
  ] as const
  for (const seed of SEEDS) {
    for (const faction of FACTIONS) {
      for (const [kind, method] of builders) {
        const situation = situationFor(seed, kind, faction)
        if (!situation?.siteId) continue
        // Far enough that the first attempts are allowed to keep their distance, near
        // enough to be inside `LOCATED_EVENT_MAX_DISTANCE`.
        const player = standOff(seed, situation.siteId, 40)
        const engineRng = new RandomStream(seed * 3 + compared)
        const harnessRng = new RandomStream(seed * 3 + compared)
        const engine = engineFor(seed, faction, player, engineRng)
        const event = engine.self[method](situation)
        const planned = planLocatedEvent(
          harnessWorld(seed, faction, player, harnessRng),
          situation,
          () => true,
        )
        if (event === null) {
          assert.equal(planned, null, `${method} refused, the harness did not`)
          continue
        }
        assert.ok(planned, `${method}: the harness refused what the engine built`)
        assert.equal(planned.kind, event.kind)
        assert.equal(planned.anchor, 'located')
        assert.equal(planned.timer, event.timer)
        assert.equal(planned.target, event.target)
        assert.equal(planned.regionId, event.regionId)
        assert.deepEqual(planSpawns(planned, faction), engineSpawns(engine.spawned), `${method} spawns`)
        assert.equal(harnessRng.state, engineRng.state, `${method} took a different number of draws`)
        compared += 1
      }
    }
  }
  assert.ok(compared >= 30, `only ${compared} located comparisons ran`)
})

// ---------------------------------------------------------------------------
// 3. What winning pays, and the director's table
// ---------------------------------------------------------------------------

test('event rewards, weights and slot costs are the engine\'s', () => {
  // `resolveRandomEventOutcome` and `resolveLocatedEventOutcome` run on a counter, so the
  // payout the harness books is the payout the engine pays — not a number copied beside it.
  const gold = (kind: string, located: boolean): number => {
    const { self } = engineFor(SEEDS[0], 'elf', { x: 0, z: 0 }, new RandomStream(1))
    Object.assign(self, {
      gold: 0,
      health: 50,
      maxHealth: 100,
      championDamageBonus: 0,
      achievements: { recordGoldEarned() {}, recordCaravanRobbed() {} },
      handleChronicleEvents: () => {},
    })
    if (located) {
      self.resolveLocatedEventOutcome(
        { id: 'x', kind, regionId: null, handBack: () => [] },
        true,
        true,
      )
    } else {
      self.resolveRandomEventOutcome(
        { id: 'x', kind, companionJoined: kind === 'rescue' },
        true,
        true,
      )
    }
    return self.gold
  }
  assert.deepEqual(
    { richCaravan: gold('richCaravan', false), defendHome: gold('defendHome', false),
      champion: gold('champion', false), rescue: gold('rescue', false), bounty: gold('bounty', false) },
    { richCaravan: 180, defendHome: 90, champion: 120, rescue: 0, bounty: 70 },
  )
  for (const kind of Object.keys(HARNESS_LOCATED_EVENT_REWARDS) as Array<keyof typeof HARNESS_LOCATED_EVENT_REWARDS>) {
    assert.equal(gold(kind, true), HARNESS_LOCATED_EVENT_REWARDS[kind], `${kind} reward`)
  }
  // W2-2 — a defended ambush of one's own cart pays its owners' thanks instead.
  {
    const { self } = engineFor(SEEDS[0], 'guard', { x: 0, z: 0 }, new RandomStream(1))
    Object.assign(self, {
      gold: 0,
      achievements: { recordGoldEarned() {}, recordCaravanRobbed() {} },
      handleChronicleEvents: () => {},
    })
    self.resolveLocatedEventOutcome(
      { id: 'x', kind: 'caravanAmbush', regionId: null, handBack: () => [], lootSite: { defend: true } },
      true,
      true,
    )
    assert.equal(self.gold, HARNESS_CARAVAN_AMBUSH_DEFENDED_REWARD)
  }
  // The weights and costs are read back through the engine's own selection and affordance:
  // a kind is affordable at exactly its slot cost and not one slot below it.
  for (const faction of FACTIONS) {
    const { self } = engineFor(SEEDS[0], faction, { x: 0, z: 0 }, new RandomStream(1))
    for (const [kind, slots] of Object.entries(HARNESS_EVENT_REQUIRED_SLOTS)) {
      Object.assign(self, {
        actorBudget: { sync() {}, availableFor: () => slots },
        actorUsageByCategory: () => ({}),
      })
      assert.equal(self.canAffordEvent(kind), true, `${kind} at ${slots}`)
      Object.assign(self, { actorBudget: { sync() {}, availableFor: () => slots - 1 } })
      assert.equal(self.canAffordEvent(kind), false, `${kind} below ${slots}`)
    }
    // The weighted draw at the edges of each kind's band picks the kind the harness's
    // weights say it should.
    const kinds = ['richCaravan', 'defendHome', 'champion', 'rescue', 'bounty'] as const
    const total = kinds.reduce((sum, kind) => sum + HARNESS_EVENT_WEIGHTS[faction][kind], 0)
    let cumulative = 0
    for (const kind of kinds) {
      const weight = HARNESS_EVENT_WEIGHTS[faction][kind]
      const roll = (cumulative + weight / 2) / total
      cumulative += weight
      const picked: string[] = []
      Object.assign(self, {
        getEligibleEventKinds: () => [...kinds],
        eventRng: () => roll,
        startRichCaravanEvent: () => (picked.push('richCaravan'), null),
        startDefendHomeEvent: () => (picked.push('defendHome'), null),
        startChampionEvent: () => (picked.push('champion'), null),
        startRescueEvent: () => (picked.push('rescue'), null),
        startBountyEvent: () => (picked.push('bounty'), null),
      })
      self.startRandomEvent()
      assert.deepEqual(picked, [kind], `${faction} roll ${roll.toFixed(3)}`)
    }
  }
})

// ---------------------------------------------------------------------------
// 4. Loot, the wave, the cart
// ---------------------------------------------------------------------------

test('the loot roll is `rollLootReward` plus the burst, on the same stream', () => {
  let rolled = 0
  for (const minimum of ['common', 'uncommon', 'rare', 'legendary'] as LootRarity[]) {
    for (const damage of [28, 60]) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const engineRng = new RandomStream(seed * 97 + damage)
        const harnessRng = new RandomStream(seed * 97 + damage)
        const { self } = engineFor(SEEDS[0], 'elf', { x: 0, z: 0 }, engineRng)
        self.damage = damage
        const reward = self.rollLootReward(minimum)
        engineRng.next()
        engineRng.next()
        engineRng.next()
        const planned = rollLoot(harnessRng, minimum, damage)
        assert.deepEqual(
          { kind: planned.kind, rarity: planned.rarity, amount: planned.amount },
          { kind: reward.kind, rarity: reward.rarity, amount: reward.amount },
        )
        assert.equal(harnessRng.state, engineRng.state)
        rolled += 1
      }
    }
  }
  // `trySpawnKillLoot`: the drop chance, and a commander's guaranteed rare.
  for (const role of ['soldier', 'commander', 'wolf'] as const) {
    for (let seed = 1; seed <= 60; seed += 1) {
      const engineRng = new RandomStream(seed)
      const harnessRng = new RandomStream(seed)
      const { self } = engineFor(SEEDS[0], 'elf', { x: 0, z: 0 }, engineRng)
      let dropped: { kind: string; rarity: string; amount: number } | null = null
      Object.assign(self, {
        spawnLoot: (reward: { kind: string; rarity: string; amount: number }) => {
          dropped = { kind: reward.kind, rarity: reward.rarity, amount: reward.amount }
          engineRng.next()
          engineRng.next()
          engineRng.next()
        },
      })
      self.trySpawnKillLoot({ role }, new THREE.Vector3())
      const planned = rollKillLoot(harnessRng, role, 28)
      assert.deepEqual(
        planned ? { kind: planned.kind, rarity: planned.rarity, amount: planned.amount } : null,
        dropped,
      )
      assert.equal(harnessRng.state, engineRng.state)
    }
  }
  assert.ok(rolled >= 300)
})

test('a threat wave is `spawnThreatWave`\'s ring, role for role', () => {
  for (const seed of SEEDS) {
    for (const faction of FACTIONS) {
      for (const tier of [2, 3, 4, 5]) {
        const { blueprint, terrain, collision } = bench(seed)
        const start = getSiteWorldPosition2D(blueprint, blueprint.starts[faction])
        if (!start) throw new Error('no start')
        const engineRng = new RandomStream(seed + tier)
        const harnessRng = new RandomStream(seed + tier)
        const engine = engineFor(seed, faction, start, engineRng)
        engine.self.threatTier = tier
        const spawned = engine.self.spawnThreatWave(0)
        const planned = planThreatWave({
          faction,
          tier,
          granted: Math.min(4, tier),
          rng: harnessRng,
          player: start,
          bounds: terrain.bounds,
          isWalkable: (x, z, radius) => collision.isWalkablePosition(x, z, radius),
          radiusFor: (role) => engine.self.actorColliderRadiusForRole(role),
        })
        assert.equal(planned.length, spawned)
        assert.deepEqual(
          planned.map((entry) => [entry.allegiance, entry.role, round(entry.x), round(entry.z)]),
          engine.spawned.map((entry) => [entry.allegiance, entry.role, round(entry.x), round(entry.z)]),
        )
        assert.equal(harnessRng.state, engineRng.state)
      }
    }
  }
})

test('the road cart patrols `placeGeneratedCaravan`\'s beat', () => {
  for (const seed of SEEDS) {
    for (const faction of FACTIONS) {
      const { blueprint, terrain } = bench(seed)
      const engine = engineFor(seed, faction, { x: 0, z: 0 }, new RandomStream(1))
      Object.assign(engine.self, {
        caravan: { position: new THREE.Vector3() },
        generatedCaravanPatrolStart: new THREE.Vector3(),
        generatedCaravanPatrolEnd: new THREE.Vector3(),
        generatedCaravanTravelDirection: new THREE.Vector2(),
      })
      engine.self.generatedWorld.getStartPosition = () => ({ x: 0, y: 0, z: 0 })
      engine.self.placeGeneratedCaravan()
      const patrol = planCaravanPatrol(blueprint, faction, terrain.bounds, { x: 0, z: 0 })
      assert.deepEqual(
        [round(patrol.start.x), round(patrol.start.z), round(patrol.end.x), round(patrol.end.z)],
        [
          round(engine.self.generatedCaravanPatrolStart.x),
          round(engine.self.generatedCaravanPatrolStart.z),
          round(engine.self.generatedCaravanPatrolEnd.x),
          round(engine.self.generatedCaravanPatrolEnd.z),
        ],
      )
      assert.deepEqual(
        [round(patrol.direction.x), round(patrol.direction.z)],
        [
          round(engine.self.generatedCaravanTravelDirection.x),
          round(engine.self.generatedCaravanTravelDirection.y),
        ],
      )
      assert.equal(patrol.ready, engine.self.generatedCaravanPatrolReady)
    }
  }
})

// ---------------------------------------------------------------------------
// 5. How a live event is won and lost
// ---------------------------------------------------------------------------

function viewOf(
  plan: EventPlan,
  actors: FakeActor[],
  extra: Partial<EventProgressView> = {},
): EventProgressView {
  return {
    alive: actors.map((actor) => actor.alive),
    dead: actors.map((actor) => !actor.alive),
    released: plan.spawns.map(() => false),
    propHp: plan.prop?.hp ?? null,
    robbed: false,
    robberyPoint: null,
    plundered: false,
    player: { x: 0, z: 0 },
    ...extra,
  }
}

test('the builders\' own update and onKill agree with the harness\'s verdicts', () => {
  const seed = SEEDS[0]
  const faction: Faction = 'guard'
  const { blueprint } = bench(seed)
  const start = getSiteWorldPosition2D(blueprint, blueprint.starts[faction])
  if (!start) throw new Error('no start')
  const kill = (engine: ReturnType<typeof engineFor>, event: { onKill?: (actor: unknown, context: unknown) => void }, index: number) => {
    engine.actors[index].alive = false
    event.onKill?.(engine.actors[index], { killerAllegiance: 'elf', directPlayerKill: true })
  }
  const origin = { x: start.x + 20, z: start.z - 6 }
  const run = (method: string, build: (world: EventWorld) => EventPlan | null, steps: Array<number | 'prop' | 'update'>) => {
    const engine = engineFor(seed, faction, start, new RandomStream(11))
    const event = engine.self[method](new THREE.Vector3(origin.x, 0, origin.z))
    const plan = build(harnessWorld(seed, faction, start, new RandomStream(11)))
    if (!event || !plan) throw new Error(`${method} did not build`)
    let propHp = plan.prop?.hp ?? null
    let harness: string = 'active'
    for (const step of steps) {
      if (step === 'prop') {
        for (const target of engine.self.eventPropTargets.values()) target.hp = 0
        propHp = 0
        continue
      }
      if (step === 'update') {
        event.update?.(1 / 60)
        const verdict = evaluateEventFrame(plan, viewOf(plan, engine.actors, { propHp }))
        if (harness === 'active' && verdict !== 'active') harness = verdict
        continue
      }
      kill(engine, event, step)
      const verdict = evaluateEventKill(plan, viewOf(plan, engine.actors, { propHp }), step)
      if (harness === 'active' && verdict !== 'active') harness = verdict === 'rescued' ? 'succeeded' : verdict
    }
    event.update?.(1 / 60)
    const frame = evaluateEventFrame(plan, viewOf(plan, engine.actors, { propHp }))
    if (harness === 'active' && frame !== 'active') harness = frame
    return { engine: event.state, harness }
  }
  // Rescue: one guard down is not enough; both is a rescue; the captive dying is a loss.
  assert.deepEqual(run('startRescueEvent', (world) => planRescue(world, origin), [1]), { engine: 'active', harness: 'active' })
  assert.deepEqual(run('startRescueEvent', (world) => planRescue(world, origin), [1, 2]), { engine: 'succeeded', harness: 'succeeded' })
  assert.deepEqual(run('startRescueEvent', (world) => planRescue(world, origin), [0]), { engine: 'failed', harness: 'failed' })
  // Defend home: four raiders down is a defence; a burned house is not.
  assert.deepEqual(run('startDefendHomeEvent', (world) => planDefendHome(world, origin), [0, 1, 2]), { engine: 'active', harness: 'active' })
  assert.deepEqual(run('startDefendHomeEvent', (world) => planDefendHome(world, origin), [0, 1, 2, 3]), { engine: 'succeeded', harness: 'succeeded' })
  assert.deepEqual(run('startDefendHomeEvent', (world) => planDefendHome(world, origin), ['prop', 'update']), { engine: 'failed', harness: 'failed' })
  // Champion and bounty: the mark down is the win.
  assert.deepEqual(run('startChampionEvent', (world) => planChampion(world, origin), [0]), { engine: 'succeeded', harness: 'succeeded' })
  assert.deepEqual(run('startBountyEvent', (world) => planBounty(world, origin), []), { engine: 'active', harness: 'active' })
  assert.deepEqual(run('startBountyEvent', (world) => planBounty(world, origin), [0]), { engine: 'succeeded', harness: 'succeeded' })

  // The located verdicts read `countAliveActors`, which the harness reads as `alive`.
  const located = (kind: PendingMaterialization['kind'], method: string, deaths: number[]) => {
    const situation = situationFor(seed, kind, faction)
    if (!situation?.siteId) throw new Error('no situation')
    const player = standOff(seed, situation.siteId, 40)
    const engine = engineFor(seed, faction, player, new RandomStream(23))
    const event = engine.self[method](situation)
    const plan = planLocatedEvent(harnessWorld(seed, faction, player, new RandomStream(23)), situation, () => true)
    if (!event || !plan) throw new Error(`${method} did not build`)
    for (const index of deaths) engine.actors[index].alive = false
    event.update?.(1 / 60)
    return { engine: event.state, harness: evaluateEventFrame(plan, viewOf(plan, engine.actors)) }
  }
  assert.deepEqual(located('factionRaid', 'startFactionRaidEvent', [0, 1, 2]), { engine: 'succeeded', harness: 'succeeded' })
  assert.deepEqual(located('factionRaid', 'startFactionRaidEvent', [3, 4]), { engine: 'failed', harness: 'failed' })
  assert.deepEqual(located('factionRaid', 'startFactionRaidEvent', [0, 3]), { engine: 'active', harness: 'active' })
  // W1-2 — an ambush whose escort is down is not lost until a raider has loaded the cart;
  // the W1-2 test below drives that channel frame by frame.
  assert.deepEqual(located('caravanAmbush', 'startCaravanAmbushEvent', [0, 1]), { engine: 'active', harness: 'active' })
  assert.deepEqual(located('caravanAmbush', 'startCaravanAmbushEvent', [2, 3]), { engine: 'active', harness: 'active' })
  // W2-2 — an ambush of the player's own side's cart is defended: both raiders down is the
  // win, the escort's deaths are not, and the plan counts the raiders the way the engine does.
  const defended = (deaths: number[]) => {
    const base = situationFor(seed, 'caravanAmbush', faction)
    if (!base?.siteId) throw new Error('no situation')
    const situation = { ...base, faction }
    const player = standOff(seed, base.siteId, 40)
    const engine = engineFor(seed, faction, player, new RandomStream(29))
    const event = engine.self.startCaravanAmbushEvent(situation)
    const plan = planLocatedEvent(harnessWorld(seed, faction, player, new RandomStream(29)), situation, () => true)
    if (!event || !plan) throw new Error('startCaravanAmbushEvent did not build')
    assert.equal(plan.defend, true)
    assert.equal(plan.target, event.target)
    for (const index of deaths) engine.actors[index].alive = false
    event.update?.(1 / 60)
    const view = viewOf(plan, engine.actors)
    assert.equal(eventProgress(plan, view), event.progress)
    return { engine: event.state, harness: evaluateEventFrame(plan, view) }
  }
  assert.deepEqual(defended([2, 3]), { engine: 'succeeded', harness: 'succeeded' })
  assert.deepEqual(defended([2]), { engine: 'active', harness: 'active' })
  assert.deepEqual(defended([0, 1]), { engine: 'active', harness: 'active' })
  // Negative control: the same raider deaths at an enemy's cart win nothing.
  assert.deepEqual(located('caravanAmbush', 'startCaravanAmbushEvent', [2, 3]), { engine: 'active', harness: 'active' })
  assert.deepEqual(located('warband', 'startWarbandEvent', [0, 1, 2]), { engine: 'succeeded', harness: 'succeeded' })
  assert.deepEqual(located('aftermath', 'startAftermathEvent', [0]), { engine: 'active', harness: 'active' })
  assert.deepEqual(located('aftermath', 'startAftermathEvent', [0, 1]), { engine: 'succeeded', harness: 'succeeded' })
})

// ---------------------------------------------------------------------------
// 6. W1-2 — who gets a cart once its escort is down
// ---------------------------------------------------------------------------

/** A harness body read off one of the engine's fake actors. */
function bodyOf(actor: FakeActor): LooterBody & SquadMembership & { id: string } {
  return {
    id: actor.id,
    x: actor.mesh.position.x,
    z: actor.mesh.position.z,
    alive: actor.alive,
    role: actor.role as ActorRole,
    routTimer: actor.routTimer,
    reaction: actor.reaction,
    aiMode: actor.aiMode,
    actionPhase: actor.action ? 'windup' : 'idle',
    targetId: actor.targetId,
    retaliationTimer: actor.retaliationTimer,
    rageTimer: actor.rageTimer,
    hostileToPlayer: actor.hostileToPlayer,
    playerAggro: actor.playerAggro,
    allegiance: actor.allegiance as Allegiance,
    hp: actor.hp,
    squadEligible: actor.squadEligible,
    budgetCategory: actor.budgetCategory as ActorBudgetCategory,
    eventOwnerId: actor.eventOwnerId,
  }
}

const claimOf = (claim: CaravanClaimState) => ({
  looterId: claim.looterId,
  looterKind: claim.looterKind,
  loaded: round(claim.loaded),
  claim: round(claim.claim),
  escortHitAt: claim.escortHitAt,
  wasGuarded: claim.wasGuarded,
})

/** The presentation sinks `advanceCaravanLoot` touches once somebody starts loading. */
function lootPresentation(self: Record<string, unknown>): void {
  Object.assign(self, {
    paused: false,
    ended: false,
    secondaryEffects: { emit() {} },
    palette: { warning: new THREE.Color() },
    visualPolicy: null,
  })
}

const LOOT_DT = 1 / 30

test('W1-2: who may load the road cart, and who is free to start, are the engine\'s', () => {
  const faction: Faction = 'elf'
  const engine = engineFor(SEEDS[0], faction, { x: 30, z: 0 }, new RandomStream(1))
  const identity = { regionId: 'finale-square', encounterId: 'finale', bossId: 'boss', escortIds: [] }
  Object.assign(engine.self, { caravanEscortIds: [] as string[], finale: { identity } })
  const spawn = (allegiance: string, role: string, x: number, options: Record<string, unknown> = {}) =>
    engine.self.spawnActor(allegiance, role, x, 0, 0, options) as FakeActor

  // One body per clause of `mayLootOrdinaryCaravan`.
  const raider = spawn('villain', 'soldier', 1)
  spawn('beast', 'wolf', 1.5)
  const escort = spawn('guard', 'soldier', 2)
  const companion = spawn('elf', 'soldier', 2.5, { budget: 'squad', squadEligible: true, hostileToPlayer: false })
  const ally = spawn('elf', 'archer', 3, { budget: 'campaign', squadEligible: false, hostileToPlayer: false })
  spawn('civilian', 'peasant', 1)
  spawn('villain', 'soldier', 0.5).alive = false
  const boss = spawn('villain', 'brute', 1)
  Object.assign(boss, { generatedRegionId: 'finale-square', generatedEncounterId: 'finale', generatedSpawnId: 'boss' })
  engine.self.caravanEscortIds = [escort.id]
  const harnessRule = (body: ReturnType<typeof bodyOf>) =>
    mayLootRoadCart(body, { faction, escortIds: [escort.id], finaleOwned: (entry) => entry.id === boss.id })
  for (const actor of engine.actors) {
    assert.equal(harnessRule(bodyOf(actor)), engine.self.mayLootOrdinaryCaravan(actor), `${actor.id}`)
  }
  // Non-vacuity: the rule admits a raider and an ally who is not in the squad, and refuses
  // the companion standing next to them.
  assert.equal(engine.self.mayLootOrdinaryCaravan(raider), true)
  assert.equal(engine.self.mayLootOrdinaryCaravan(ally), true)
  assert.equal(engine.self.mayLootOrdinaryCaravan(companion), false)
  // The negative control: the pre-W1-2 rule — anything hostile to the cart but its escort —
  // is told apart from the engine on exactly that companion.
  const touchRule = (body: ReturnType<typeof bodyOf>) =>
    body.alive && areAllegiancesHostile(body.allegiance, 'guard') && body.id !== escort.id
  assert.notEqual(touchRule(bodyOf(companion)), engine.self.mayLootOrdinaryCaravan(companion))

  // `sampleCaravanLooter`, one field at a time, as a looter at work and as a candidate.
  const cart = { x: 0, z: 0 }
  const cartVector = new THREE.Vector3()
  const toggles: Array<[string, (actor: FakeActor) => void]> = [
    ['fresh', () => {}],
    ['routing', (actor) => { actor.routTimer = 2 }],
    ['staggered', (actor) => { actor.reaction = 'stagger' }],
    ['flinching', (actor) => { actor.reaction = 'flinch' }],
    ['captive', (actor) => { actor.aiMode = 'captive' }],
    ['swinging', (actor) => { actor.action = {} }],
    ['fighting someone', (actor) => { actor.targetId = raider.id }],
    ['retaliating', (actor) => { actor.retaliationTimer = 1 }],
    ['enraged', (actor) => { actor.rageTimer = 1 }],
    ['hunting the player', (actor) => { actor.playerAggro = true }],
    ['dead', (actor) => { actor.alive = false }],
  ]
  let ready = 0
  for (const [label, apply] of toggles) {
    const body = spawn('villain', 'soldier', 2.4)
    apply(body)
    for (const candidate of [false, true]) {
      const engineSample = engine.self.sampleCaravanLooter(body, cartVector, candidate)
      assert.deepEqual(sampleCartLooter(bodyOf(body), cart, candidate), engineSample, `${label} (${candidate})`)
      if (engineSample.ready) ready += 1
    }
  }
  assert.ok(ready > 2 && ready < toggles.length * 2, `${ready} ready samples cannot tell the toggles apart`)

  // `findCaravanLooter`: nearest first, within the 3.4 m tailgate, and only what may loot.
  const reach = engineFor(SEEDS[0], faction, { x: 30, z: 0 }, new RandomStream(1))
  Object.assign(reach.self, { caravanEscortIds: [], finale: { identity } })
  const near = reach.self.spawnActor('villain', 'soldier', 3.3, 0, 0, {}) as FakeActor
  reach.self.spawnActor('villain', 'soldier', 3.35, 0, 0, {})
  reach.self.spawnActor('elf', 'soldier', 1, 0, 0, { budget: 'squad', squadEligible: true, hostileToPlayer: false })
  const rule = (body: ReturnType<typeof bodyOf>) =>
    mayLootRoadCart(body, { faction, escortIds: [], finaleOwned: () => false })
  const pick = () => ({
    engine: reach.self.findCaravanLooter(cartVector, (actor: FakeActor) => reach.self.mayLootOrdinaryCaravan(actor))?.id ?? null,
    harness: findCartLooter(reach.actors.map(bodyOf), cart, rule)?.id ?? null,
  })
  assert.deepEqual(pick(), { engine: near.id, harness: near.id })
  for (const actor of reach.actors) if (actor.allegiance === 'villain') actor.mesh.position.x = 3.45
  assert.deepEqual(pick(), { engine: null, harness: null })
})

test('W1-2: the road cart goes to whoever finishes loading it, and never to the squad', () => {
  for (const faction of FACTIONS) {
    const engine = engineFor(SEEDS[0], faction, { x: 40, z: 0 }, new RandomStream(1))
    lootPresentation(engine.self)
    Object.assign(engine.self, {
      caravan: new THREE.Group(),
      caravanEscortIds: [] as string[],
      caravanEscortRespawnAt: Number.POSITIVE_INFINITY,
      caravanPanicTimer: 0,
      caravanCooldown: 0,
      caravanDefenseCredit: false,
      caravanRobbedFlash: 0,
      ordinaryCaravanLootSite: null,
      finale: { identity: { regionId: 'none', encounterId: 'none', bossId: 'none', escortIds: [] } },
      removeActorById: () => {},
      announceSighting: () => {},
    })
    const spawn = (allegiance: string, x: number, options: Record<string, unknown> = {}) =>
      engine.self.spawnActor(allegiance, 'soldier', x, 0, 0, options) as FakeActor
    const escorts = [spawn('guard', 2), spawn('guard', -2)]
    engine.self.caravanEscortIds = escorts.map((actor) => actor.id)
    // The companion is at the tailgate first; the raider is still inside the 3.4 m reach.
    const companion = spawn(faction, 1, { budget: 'squad', squadEligible: true, hostileToPlayer: false })
    const raider = spawn(faction === 'villain' ? 'elf' : 'villain', 2.6, { hostileToPlayer: true })

    const claim = createCaravanClaimState()
    let escortIds = escorts.map((actor) => actor.id)
    let cooldown = 0
    const started: string[] = []
    const plundered = { engine: -1, harness: -1 }
    for (let frame = 0; frame < 160; frame += 1) {
      engine.self.elapsed = frame * LOOT_DT
      if (frame === 4) for (const escort of escorts) escort.alive = false
      const before = engine.self.caravanCooldown
      engine.self.updateCaravanEscort(LOOT_DT, 'square', true)
      if (before <= 0 && engine.self.caravanCooldown > 0 && plundered.engine < 0) plundered.engine = frame

      // The harness's `updateRoadCart`: its escort bookkeeping, then the step it calls.
      const standing = escortIds.length
      escortIds = escortIds.filter((id) => engine.actors.find((actor) => actor.id === id)?.alive)
      const step = advanceRoadCartLoot(claim, {
        delta: LOOT_DT,
        elapsed: engine.self.elapsed,
        cart: { x: 0, z: 0 },
        player: { x: 40, z: 0 },
        faction,
        escortIds,
        escortFell: standing > 0 && escortIds.length === 0,
        empty: cooldown > 0,
        bodies: engine.actors.map(bodyOf),
        finaleOwned: () => false,
      })
      if (step.started) started.push(step.started)
      if (step.plundered && plundered.harness < 0) {
        plundered.harness = frame
        cooldown = 55
      }
      assert.deepEqual(claimOf(claim), claimOf(engine.self.ordinaryCaravanLootSite.claim), `${faction} frame ${frame}`)
    }
    assert.equal(plundered.harness, plundered.engine, `${faction}: plundered on different frames`)
    // The escort fell on frame 4 and the raider loaded for the full channel from frame 5.
    assert.ok(plundered.engine >= 4 + 3.5 / LOOT_DT, `${faction}: plundered on frame ${plundered.engine}`)
    assert.deepEqual(started, [raider.id], `${faction}: only the raider ever started loading`)
    assert.ok(!started.includes(companion.id))
    assert.equal(engine.self.caravanRobbedBy, 'raider')
  }
})

test('W1-2: an ambushed cart is lost only to a raider who finishes loading it, frame for frame', () => {
  const seed = SEEDS[0]
  const scenario = (input: {
    faction: Faction
    owner?: Faction
    /** Metres from the cart the player stands. */
    playerOffset: number
    fallAt: number
    escortHitAt?: number
    blowAt?: number
    frames: number
  }) => {
    const base = situationFor(seed, 'caravanAmbush', input.faction)
    if (!base?.siteId) throw new Error('no situation')
    const situation = { ...base, faction: input.owner ?? base.faction }
    const owner = situation.faction
    if (!owner) throw new Error('no owner')
    const start = standOff(seed, base.siteId, 40)
    const engine = engineFor(seed, input.faction, start, new RandomStream(23))
    lootPresentation(engine.self)
    const event = engine.self.startCaravanAmbushEvent(situation)
    const plan = planLocatedEvent(harnessWorld(seed, input.faction, start, new RandomStream(23)), situation, () => true)
    if (!event || !plan?.cart) throw new Error('no ambush')
    engine.self.activeEvents = [event]
    const cart = { x: plan.cart.x, z: plan.cart.z }
    assert.deepEqual(
      [round(cart.x), round(cart.z)],
      [round(event.lootSite.cart.position.x), round(event.lootSite.cart.position.z)],
    )
    const player = { x: cart.x + input.playerOffset, z: cart.z }
    engine.self.player.position.set(player.x, 0, player.z)
    const escorts = engine.actors.slice(0, 2)
    const raiders = engine.actors.slice(2, 4)
    const escortIds = escorts.map((actor) => actor.id)
    const raiderIds = raiders.map((actor) => actor.id)
    // One raider at the tailgate, one where the builder put it; neither is chasing anybody.
    raiders[0].mesh.position.set(cart.x + 1, 0, cart.z)
    for (const raider of raiders) raider.playerAggro = false

    const loot = createAmbushLoot(escortIds.length)
    const playerRobs = areAllegiancesHostile(input.faction, owner)
    const failed = { engine: -1, harness: -1 }
    let claimed = false
    let posts = 0
    for (let frame = 0; frame < input.frames; frame += 1) {
      engine.self.elapsed = frame * LOOT_DT
      if (frame === input.escortHitAt) {
        engine.self.noteCaravanLootHit(escorts[0], { applied: true, dealt: 4 }, true)
        noteCaravanEscortHit(loot.claim, engine.self.elapsed)
      }
      if (frame === input.fallAt) for (const escort of escorts) escort.alive = false
      if (frame === input.blowAt) {
        // Anybody's blow, not only the player's, knocks the looter off the cart.
        engine.self.noteCaravanLootHit(raiders[0], { applied: true, dealt: 6 }, false)
        interruptCaravanLoot(loot.claim, raiders[0].id)
      }
      if (event.state === 'active') event.update(LOOT_DT)
      const { approach } = advanceAmbushLoot(loot, {
        delta: LOOT_DT,
        elapsed: engine.self.elapsed,
        cart,
        player,
        playerRobs,
        bodies: engine.actors.map(bodyOf),
        escortIds,
        raiderIds,
      })
      const verdict = evaluateEventFrame(plan, viewOf(plan, engine.actors, { plundered: loot.plundered }))
      assert.deepEqual(claimOf(loot.claim), claimOf(event.lootSite.claim), `frame ${frame}`)
      if (loot.claim.claim > 0) claimed = true
      if (event.state === 'failed') failed.engine = frame
      if (verdict === 'failed') failed.harness = frame
      // `directCaravanRaiders`: the raider still waiting is sent where the harness sends it.
      const waiting = raiders[1]
      if (!loot.plundered && approach) {
        const post = raiderApproachPoint(bodyOf(waiting), cart)
        assert.deepEqual(
          [round(waiting.order?.position.x ?? NaN), round(waiting.order?.position.z ?? NaN), waiting.order?.timer],
          [round(post.x), round(post.z), HARNESS_ORDER_DURATION],
          `frame ${frame}: the waiting raider's post`,
        )
        posts += 1
      } else if (!loot.plundered) {
        assert.ok(waiting.order?.kind !== 'assault', `frame ${frame}: a raider walked in during a claim`)
      }
      if (failed.engine >= 0 || failed.harness >= 0) break
    }
    return { failed, claimed, posts }
  }
  const channel = Math.ceil(3.5 / LOOT_DT)

  // Nobody contests the cart: the escort falls and the raider at the tailgate loads it.
  const open = scenario({ faction: 'elf', playerOffset: 30, fallAt: 3, frames: 400 })
  assert.equal(open.failed.harness, open.failed.engine)
  assert.ok(Math.abs(open.failed.engine - (3 + channel)) <= 2, `lost on frame ${open.failed.engine}`)
  assert.equal(open.claimed, false)
  assert.ok(open.posts > 0, 'the waiting raider was never sent to the cart')

  // The player stood within 10 m when the escort fell: nobody else starts for 9 s.
  const near = scenario({ faction: 'elf', playerOffset: 6, fallAt: 3, frames: 600 })
  assert.equal(near.failed.harness, near.failed.engine)
  assert.equal(near.claimed, true)
  assert.ok(near.failed.engine > open.failed.engine + 8.9 / LOOT_DT, `claimed cart lost on frame ${near.failed.engine}`)

  // A player blow on an escort two seconds before it fell is a claim from 30 m away.
  const struck = scenario({ faction: 'elf', playerOffset: 30, escortHitAt: 3, fallAt: 63, frames: 700 })
  assert.equal(struck.failed.harness, struck.failed.engine)
  assert.equal(struck.claimed, true)

  // A blow mid-channel restarts the load from nothing.
  const broken = scenario({ faction: 'elf', playerOffset: 30, fallAt: 3, blowAt: 60, frames: 600 })
  assert.equal(broken.failed.harness, broken.failed.engine)
  assert.ok(broken.failed.engine > open.failed.engine + 50, `broken channel lost on frame ${broken.failed.engine}`)

  // The palace guard defends its own side's cart, so standing beside it is no claim.
  const defended = scenario({ faction: 'guard', owner: 'guard', playerOffset: 6, fallAt: 3, frames: 400 })
  assert.equal(defended.failed.harness, defended.failed.engine)
  assert.equal(defended.claimed, false)
  assert.ok(Math.abs(defended.failed.engine - (3 + channel)) <= 2)
})

// ---------------------------------------------------------------------------
// 7. W1-1 — a contract outranks the game's own random events
// ---------------------------------------------------------------------------

test('W1-1: the shipped rule stands a random event down, and waits only while the player fights it', () => {
  // `updateContractNode`, frame by frame, with the player on the elf's signature contract
  // site. The harness's `contractStartGate` and `playerEngagedWith` read the same state
  // before every frame: where they say go, the engine started the contract on that frame;
  // where they say wait, it did not and the start grace was not touched; where they say
  // `crowded`, the grace was spent.
  const seed = SEEDS[0]
  const faction: Faction = 'elf'
  const { blueprint } = bench(seed)
  const graph = blueprint.objectives[faction]
  const contractNode = graph.nodes.find((node) => node.contract !== undefined)
  if (!contractNode) throw new Error('no contract')
  const template = CONTRACT_TEMPLATES[contractNode.contract as keyof typeof CONTRACT_TEMPLATES]
  const site = getSiteWorldPosition2D(blueprint, contractNode.siteId)
  if (!site) throw new Error('no site')
  const required = HARNESS_EVENT_REQUIRED_SLOTS[template.eventKind]
  const fightFor = 5

  type Arrival = 'clear' | 'near' | 'fighting' | 'settling' | 'queued' | 'crowded'
  const drive = (arrival: Arrival) => {
    const engine = engineFor(seed, faction, site, new RandomStream(3))
    const objectives = createGeneratedObjectives(blueprint, faction)
    const start = objectives.find((objective) => graph.rootNodeIds.includes(objective.id))
    if (start) start.done = true
    const contracts = createCampaignContractState()
    pinObjective(contracts, contractNode.id, [contractNode.id])
    // A random champion 8 m off, unless the arrival is clear of it.
    const random =
      arrival === 'clear' || arrival === 'queued' || arrival === 'crowded'
        ? null
        : {
            id: 'event-champion-1',
            anchor: 'player',
            state: arrival === 'settling' ? 'succeeded' : 'active',
            kind: 'champion',
            title: 'Чемпион',
            markerPos: new THREE.Vector3(site.x + 8, 0, site.z),
            ownedActorIds: [] as string[],
            playerExchangeAt: undefined as number | undefined,
            cleanup() {},
          }
    Object.assign(engine.self, {
      objectives,
      campaignContracts: contracts,
      activeContractNodeId: arrival === 'queued' ? 'the-other-arm' : null,
      activeEvents: random ? [random] : [],
      finale: { identity: { objectiveId: graph.finalNodeId } },
      actorBudget: new ActorBudget(),
      eventCooldown: 0,
    })
    if (arrival === 'crowded') {
      // The campaign's own bodies fill the field: nothing the game's events could hand back
      // would make room.
      for (let index = 0; index < 25; index += 1) {
        engine.self.spawnActor('guard', 'soldier', site.x + 30, site.z, index, { budget: 'campaign' })
      }
    }
    const usage = { squad: 0, campaign: 0, chronicle: 0, ambient: 0 }
    for (const actor of engine.actors) usage[actor.budgetCategory as ActorBudgetCategory] += 1
    const ledger = new ActorBudget()
    ledger.sync(usage)
    const room = ledger.capacityFor('chronicle') >= required

    const status = () => getContractStatus(contracts, contractNode)
    const gates = new Set<string>()
    let frames = 0
    let waited = 0
    let spent = 0
    while (frames < 60 * 30 && status() === 'offered') {
      const elapsed = frames / 60
      engine.self.elapsed = elapsed
      if (random && arrival === 'fighting' && elapsed < fightFor) random.playerExchangeAt = elapsed
      const up = random !== null && engine.self.activeEvents.includes(random)
      const gate = contractStartGate({
        contractRunning: arrival === 'queued',
        interrupted:
          up && random
            ? {
                active: random.state === 'active',
                engaged: playerEngagedWith({
                  away: 8,
                  interacted: false,
                  exchangeAt: random.playerExchangeAt ?? null,
                  elapsed,
                }),
              }
            : null,
        roomOnceEventsMakeWay: room,
      })
      gates.add(gate ?? 'go')
      engine.self.updateContractNode(contractNode, 1 / 60)
      const grace: number = getContractProgress(contracts, contractNode.id)?.waited ?? 0
      if (gate === null) assert.equal(status(), 'active', `${arrival} frame ${frames}: the harness says go`)
      else if (gate === 'crowded') {
        spent += 1 / 60
        if (status() === 'offered') assert.ok(Math.abs(grace - spent) < 1e-9, `${arrival}: the stall did not spend grace`)
      } else {
        assert.equal(status(), 'offered', `${arrival} frame ${frames}: the harness says ${gate}`)
        assert.equal(grace, 0, `${arrival}: a wait spent the grace`)
        waited += 1
      }
      frames += 1
    }
    return {
      status: status(),
      seconds: frames / 60,
      waited: waited / 60,
      gates: [...gates],
      stoodDown: random !== null && !engine.self.activeEvents.includes(random),
    }
  }

  const clear = drive('clear')
  assert.deepEqual([clear.status, clear.gates], ['active', ['go']])
  assert.ok(clear.seconds < 0.05)
  // Merely near it: the game's own event makes way on the frame the player arrives.
  const near = drive('near')
  assert.deepEqual([near.status, near.stoodDown, near.gates], ['active', true, ['go']])
  assert.ok(near.seconds < 0.05, `started after ${near.seconds} s`)
  // In the middle of it: the contract waits, past the 12 s the old rule allowed, until the
  // fight has been quiet for the engagement window — and only then does the event go.
  const fighting = drive('fighting')
  assert.deepEqual([fighting.status, fighting.stoodDown, fighting.gates], ['active', true, ['engaged', 'go']])
  assert.ok(
    Math.abs(fighting.seconds - (fightFor + 10)) < 0.1 && fighting.seconds > template.startGraceSeconds,
    `started after ${fighting.seconds} s`,
  )
  assert.ok(fighting.waited > template.startGraceSeconds)
  // Resolved but not yet paid, and a contract already on the ground: both wait, for free.
  const settling = drive('settling')
  assert.deepEqual([settling.status, settling.gates], ['offered', ['settling']])
  assert.ok(settling.waited > template.startGraceSeconds)
  const queued = drive('queued')
  assert.deepEqual([queued.status, queued.gates], ['offered', ['queued']])
  // No room even after the game's own events made way: a genuine stall, and the grace runs.
  const crowded = drive('crowded')
  assert.deepEqual([crowded.status, crowded.gates], ['failed', ['crowded']])
  assert.ok(Math.abs(crowded.seconds - template.startGraceSeconds) < 0.05, `abandoned after ${crowded.seconds} s`)

  // The negative control: the rule W1-1 replaced — refuse while any player-anchored event
  // is up, spend the grace on site — run over the `near` arrival, loses this contract.
  const replaced = (eventUp: boolean): 'started' | 'abandoned' => {
    let spent = 0
    for (let frame = 0; frame < 60 * 30; frame += 1) {
      if (!eventUp) return 'started'
      spent += 1 / 60
      if (spent >= template.startGraceSeconds) return 'abandoned'
    }
    return 'abandoned'
  }
  assert.equal(replaced(false), 'started')
  assert.equal(replaced(true), 'abandoned')
})

// ---------------------------------------------------------------------------
// 8. The squares the engine simulates (W1-6's finding)
// ---------------------------------------------------------------------------

test('the shipped arms simulate the squares the engine simulates, and the pinned 3x3 does not', () => {
  // A real `GeneratedWorldRuntime` walked over every square of the map, and the engine's
  // own `syncGeneratedRegions` run on it after each step: the squares it spawns encounters
  // in, in the order it spawns them, and the squares its navigation routes through. The
  // harness's `engine` window has to name the same squares in the same order; the pinned
  // `square` window is the negative control, and has to be told apart on every square.
  let visited = 0
  for (const seed of [SEEDS[0], SEEDS[1]]) {
    const { blueprint, terrain } = bench(seed)
    const runtime = new GeneratedWorldRuntime(new THREE.Scene(), blueprint, {
      decorationDensity: 0,
      terrainResolution: 6,
    })
    try {
      const faction: Faction = 'elf'
      const finale = createFinaleState(createFinaleIdentity(blueprint, faction))
      const spawnedIn: string[] = []
      const engine = Object.assign(Object.create(RuntimeEngine.prototype), {
        generatedWorld: runtime,
        generatedNavigationRegionSignature: '',
        generatedNavigationCache: new Map(),
        simulatedGeneratedRegions: new Set<string>(),
        generatedActivationSpawns: new Map<string, Set<string>>(),
        actors: [],
        faction,
        finale,
        spawnGeneratedRegionEncounters: (regionId: string) => {
          spawnedIn.push(regionId)
        },
        removeActorById: () => {},
        clearFinaleThreats: () => {},
      })
      const shipped = createRegionWindow(blueprint, terrain, 'engine')
      const pinned = createRegionWindow(blueprint, terrain, 'square')
      const finaleFirst = (left: string, right: string) =>
        Number(right === finale.identity.regionId) - Number(left === finale.identity.regionId)
      const sorted = (ids: readonly string[]) => [...ids].sort()
      // A serpentine walk, so each step streams in a row's worth of squares, not nine.
      const rows = new Map<number, typeof terrain.layout.regions>()
      for (const region of terrain.layout.regions) {
        rows.set(region.coordinate.z, [...(rows.get(region.coordinate.z) ?? []), region])
      }
      const walk = [...rows.entries()]
        .sort(([left], [right]) => left - right)
        .flatMap(([, row], index) =>
          [...row].sort((left, right) =>
            index % 2 === 0
              ? left.coordinate.x - right.coordinate.x
              : right.coordinate.x - left.coordinate.x,
          ),
        )
      for (const region of walk) {
        const x = (region.bounds.minX + region.bounds.maxX) / 2
        const z = (region.bounds.minZ + region.bounds.maxZ) / 2
        runtime.update({ focus: { x, z }, deltaSeconds: 0 })
        spawnedIn.length = 0
        engine.syncGeneratedRegions()
        const simulated = runtime.regions.getSimulatedRegionIds().map(String)
        const visible = runtime.regions.getVisibleRegionIds().map(String)
        const ours = shipped(x, z)
        const label = `seed ${seed}, square ${String(region.id)}`
        assert.deepEqual([...ours.simulated], simulated, `${label}: simulated`)
        assert.deepEqual([...ours.visible], visible, `${label}: visible`)
        assert.deepEqual([...ours.simulated].sort(finaleFirst), spawnedIn, `${label}: spawn order`)
        assert.deepEqual(
          sorted(runtime.navigation.getActiveRegions().map(String)),
          sorted(ours.simulated),
          `${label}: navigation`,
        )
        // The pinned window is the engine's *visible* set, and simulates all of it.
        const square = pinned(x, z)
        assert.deepEqual(sorted(square.visible), sorted(visible), `${label}: the 3x3 is what is seen`)
        assert.notDeepEqual(sorted(square.simulated), sorted(simulated), `${label}: control`)
        assert.ok(square.simulated.length > simulated.length)
        visited += 1
      }
    } finally {
      runtime.dispose()
    }
  }
  // Non-vacuity: the whole map, corners, edges and middle, on both seeds.
  assert.equal(visited, 50)
})

test('W3-4: the held window turns back with the engine on edge walks, and the instant window does not', () => {
  // The same real `GeneratedWorldRuntime` and the engine's own `syncGeneratedRegions`, walked
  // frame by frame over paths that turn back across an edge: back and forth inside the hold, a
  // return deeper than it, and round a corner of four squares. The harness's `held` window has
  // to name the squares the engine simulates and sees, in its spawn order, on every frame; the
  // `instant` window, the rule before W3-4, has to be told apart on the walks that turn back.
  const { blueprint, terrain } = bench(SEEDS[0])
  const square = (x: number, y: number) =>
    terrain.layout.regions.find((region) => region.coordinate.x === x && region.coordinate.z === y)!
  const west = square(1, 2)
  const north = square(1, 1)
  assert.ok(square(2, 2), 'the walks cross into the square east of the start')
  const edgeX = west.bounds.maxX
  const rowZ = (west.bounds.minZ + west.bounds.maxZ) / 2
  const cornerZ = west.bounds.minZ
  const line = (from: { x: number; z: number }, to: { x: number; z: number }, steps: number) =>
    Array.from({ length: steps }, (_, index) => ({
      x: from.x + ((to.x - from.x) * (index + 1)) / steps,
      z: from.z + ((to.z - from.z) * (index + 1)) / steps,
    }))
  const start = { x: edgeX - 40, z: rowZ }
  const paths: Record<string, Array<{ x: number; z: number }>> = {
    oscillation: [start, ...line(start, { x: edgeX + 10, z: rowZ }, 100), ...Array.from({ length: 8 }, (_, index) =>
      line({ x: edgeX + (index % 2 === 0 ? 10 : -10), z: rowZ }, { x: edgeX + (index % 2 === 0 ? -10 : 10), z: rowZ }, 40)).flat()],
    deepReturn: [start, ...line(start, { x: edgeX + 30, z: rowZ }, 140), ...line({ x: edgeX + 30, z: rowZ }, { x: edgeX - 30, z: rowZ }, 120),
      ...line({ x: edgeX - 30, z: rowZ }, { x: edgeX + 30, z: rowZ }, 120)],
    corner: [start, ...line(start, { x: edgeX + 6, z: cornerZ + 6 }, 120), ...line({ x: edgeX + 6, z: cornerZ + 6 }, { x: edgeX - 6, z: cornerZ + 6 }, 24),
      ...line({ x: edgeX - 6, z: cornerZ + 6 }, { x: edgeX - 6, z: cornerZ - 6 }, 24), ...line({ x: edgeX - 6, z: cornerZ - 6 }, { x: edgeX + 6, z: cornerZ - 6 }, 24)],
  }
  assert.equal(north.coordinate.z, west.coordinate.z - 1, 'the corner walk goes round four squares')
  const differences: Record<string, number> = {}
  let frames = 0
  for (const [name, path] of Object.entries(paths)) {
    const runtime = new GeneratedWorldRuntime(new THREE.Scene(), blueprint, { decorationDensity: 0, terrainResolution: 6 })
    try {
      const finale = createFinaleState(createFinaleIdentity(blueprint, 'elf'))
      const spawnedIn: string[] = []
      const engine = Object.assign(Object.create(RuntimeEngine.prototype), {
        generatedWorld: runtime,
        generatedNavigationRegionSignature: '',
        generatedNavigationCache: new Map(),
        simulatedGeneratedRegions: new Set<string>(),
        generatedActivationSpawns: new Map<string, Set<string>>(),
        actors: [],
        faction: 'elf',
        finale,
        spawnGeneratedRegionEncounters: (regionId: string) => {
          spawnedIn.push(regionId)
        },
        removeActorById: () => {},
        clearFinaleThreats: () => {},
      })
      const held = createRegionWindow(blueprint, terrain, 'engine', 'held')
      const instant = createRegionWindow(blueprint, terrain, 'engine', 'instant')
      const finaleFirst = (left: string, right: string) =>
        Number(right === finale.identity.regionId) - Number(left === finale.identity.regionId)
      differences[name] = 0
      for (const [index, point] of path.entries()) {
        runtime.update({ focus: point, deltaSeconds: 1 / 30 })
        spawnedIn.length = 0
        engine.syncGeneratedRegions()
        const simulated = runtime.regions.getSimulatedRegionIds().map(String)
        const visible = runtime.regions.getVisibleRegionIds().map(String)
        const ours = held(point.x, point.z)
        const label = `${name}, frame ${index} at (${point.x.toFixed(1)}, ${point.z.toFixed(1)})`
        assert.deepEqual([...ours.simulated], simulated, `${label}: simulated`)
        assert.deepEqual([...ours.visible], visible, `${label}: visible`)
        assert.deepEqual([...ours.simulated].sort(finaleFirst), spawnedIn, `${label}: spawn order`)
        const old = instant(point.x, point.z)
        if (old.simulated.join('|') !== simulated.join('|')) differences[name] += 1
        frames += 1
      }
    } finally {
      runtime.dispose()
    }
  }
  // The control tells the rules apart wherever the walk turns back inside the hold.
  assert.ok(differences.oscillation > 100, `instant differed on ${differences.oscillation} oscillation frames`)
  assert.ok(differences.deepReturn > 0)
  assert.ok(differences.corner > 0)
  assert.ok(frames > 900)
})

// ---------------------------------------------------------------------------
// W1-6 — a commander's call for men
// ---------------------------------------------------------------------------

test('W1-6: a commander calls for men when `updateCommander` does, frame for frame', () => {
  // The engine's own `updateCommander`, `commanderGathersMen` and budget seams, beside the
  // harness's `commanderGathers` and `advanceCommanderClock` reading the same bodies before
  // every frame. Where the harness calls, the engine has to have put a soldier down on that
  // frame, and where it does not, the engine must not have.
  const HZ = 30
  const SECONDS = 130
  interface Script {
    hostile: boolean
    /** Spans of the run, in seconds, in which one of his men has a living enemy picked out. */
    fights: ReadonlyArray<readonly [number, number]>
    /** Six more campaign bodies elsewhere, so campaign's own share is already spent. */
    fullShare: boolean
  }
  const harnessBody = (actor: FakeActor) => ({
    id: actor.id,
    allegiance: actor.allegiance as Allegiance,
    role: actor.role as ActorRole,
    alive: actor.alive,
    ignoredTargetId: actor.ignoredTargetId,
    targetId: actor.targetId,
    packId: actor.packId,
    packKinSize: actor.packKinSize,
    hp: actor.hp,
    maxHp: actor.maxHp,
    playerAggro: actor.playerAggro,
    hostileToPlayer: actor.hostileToPlayer,
    x: actor.mesh.position.x,
    z: actor.mesh.position.z,
    actionPhase: actor.action ? 'windup' : 'idle',
  })
  const drive = (model: 'legacy' | 'shipped', script: Script, harnessModel: CommanderModel = model) => {
    const { self, actors } = engineFor(SEEDS[0], 'guard', { x: 0, z: 0 }, new RandomStream(1))
    // The real budget seams, not the builders' stubs.
    for (const seam of ['reserveActorSlots', 'reserveActorSlotsUpTo']) Reflect.deleteProperty(self, seam)
    self.actorBudget = new ActorBudget()
    if (model === 'legacy') {
      // The rule W1-6 replaced, put back on the instance.
      self.commanderGathersMen = () => true
      self.reserveOwnActorSlots = (category: string, count: number) =>
        self.reserveActorSlots(category, count)
    }
    const side = script.hostile ? 'villain' : 'guard'
    for (let index = 0; index < 3; index += 1) {
      self.spawnActor('guard', 'soldier', 1 + index, 1, index, { budget: 'squad', hostileToPlayer: false })
    }
    const commander = self.spawnActor(side, 'commander', 30, 0, 0, {
      budget: 'campaign',
      hostileToPlayer: script.hostile,
    }) as FakeActor & { reinforcementTimer: number; reinforcementsCalled: number; phase: number }
    Object.assign(commander, { reinforcementTimer: HARNESS_COMMANDER_INTERVAL, reinforcementsCalled: 0, phase: 0 })
    const man = self.spawnActor(side, 'soldier', 33, 0, 0, { budget: 'campaign', hostileToPlayer: script.hostile }) as FakeActor
    self.spawnActor(side, 'soldier', 36, 0, 0, { budget: 'campaign', hostileToPlayer: script.hostile })
    const enemy = self.spawnActor(script.hostile ? 'elf' : 'villain', 'soldier', 40, 0, 0, { budget: 'chronicle' }) as FakeActor
    if (script.fullShare) {
      for (let index = 0; index < 6; index += 1) {
        self.spawnActor('guard', 'soldier', -80, index * 2, 0, { budget: 'campaign', hostileToPlayer: false })
      }
    }
    const clock = createCommanderClock()
    const ledger = new ActorBudget()
    const usage = () => {
      const counts: Record<ActorBudgetCategory, number> = { squad: 0, campaign: 0, chronicle: 0, ambient: 0 }
      for (const actor of actors) counts[actor.budgetCategory as ActorBudgetCategory] += 1
      return counts
    }
    const calls: number[] = []
    let disagreements = 0
    for (let frame = 1; frame <= SECONDS * HZ; frame += 1) {
      const second = frame / HZ
      man.targetId = script.fights.some(([from, to]) => second > from && second <= to) ? enemy.id : null
      const bodies = actors.map(harnessBody)
      const leader = bodies.find((body) => body.id === commander.id)
      assert.ok(leader)
      const harnessCalls = advanceCommanderClock(
        clock,
        1 / HZ,
        commanderGathers(harnessModel, leader, bodies, (body) => ({ x: body.x, y: 0, z: body.z }),
          (body) => body.actionPhase !== 'idle'),
        () => {
          ledger.sync(usage())
          return harnessModel === 'shipped' ? ledger.reserveOwn('campaign', 1) : ledger.reserve('campaign', 1)
        },
      )
      const before = actors.length
      self.updateCommander(commander, 1 / HZ)
      const engineCalled = actors.length > before
      if (engineCalled !== harnessCalls) disagreements += 1
      if (engineCalled) calls.push(Math.round(second))
    }
    return { calls, disagreements, called: commander.reinforcementsCalled }
  }

  const fighting: Script = { hostile: false, fights: [[10, 40], [70, 100]], fullShare: false }
  const idle: Script = { hostile: false, fights: [], fullShare: false }
  const hostile: Script = { hostile: true, fights: [], fullShare: false }
  const crowded: Script = { hostile: false, fights: [[0, SECONDS]], fullShare: true }
  const everyCall = Array.from({ length: HARNESS_COMMANDER_LIMIT }, (_, index) => (index + 1) * HARNESS_COMMANDER_INTERVAL)

  const shipped = {
    fighting: drive('shipped', fighting),
    idle: drive('shipped', idle),
    hostile: drive('shipped', hostile),
    crowded: drive('shipped', crowded),
  }
  const legacy = { idle: drive('legacy', idle), crowded: drive('legacy', crowded) }
  for (const [name, result] of [...Object.entries(shipped), ...Object.entries(legacy)]) {
    assert.equal(result.disagreements, 0, `${name}: the harness and the engine called on different frames`)
  }
  // Twenty-five seconds of fighting a call: the first at 35 s, the second after a lull, at
  // 90 s; ten seconds into the next span the fight ends short of a third.
  assert.deepEqual(shipped.fighting.calls, [35, 90])
  assert.deepEqual(shipped.idle.calls, [])
  assert.deepEqual(shipped.hostile.calls, everyCall)
  assert.deepEqual(shipped.crowded.calls, [], 'a call borrowed past campaign\'s own share')
  assert.deepEqual(legacy.idle.calls, everyCall)
  assert.deepEqual(legacy.crowded.calls, everyCall)
  assert.equal(legacy.idle.called, HARNESS_COMMANDER_LIMIT)

  // The negative control: a harness still on the old rule is told apart from the engine
  // on the idle garrison and on the spent share.
  assert.ok(drive('shipped', idle, 'legacy').disagreements > 0)
  assert.ok(drive('shipped', crowded, 'legacy').disagreements > 0)
})

// ---------------------------------------------------------------------------
// W1-6 — what the player can see when a staging asks for room
// ---------------------------------------------------------------------------

test('W1-6: the staging arm sees from where `updateCamera` puts the camera, and as far round', () => {
  // The engine's own `updateCamera` — the classic path, its collision and presentation
  // boundaries replaced — poses the engine's camera behind a player facing each heading, and
  // the engine's own `stagingViewer` reads it back. The harness has to see the same cone from
  // the same place, or its staging would step back packs the player could see.
  const engineView = (heading: number, at: PlanPoint): StagingViewer => {
    const self = Object.assign(Object.create(RuntimeEngine.prototype), {
      player: { position: new THREE.Vector3(at.x, 0, at.z) },
      camera: new THREE.PerspectiveCamera(CAMERA_BASE_FOV, HARNESS_SCREEN_ASPECT, 0.1, 240),
      cameraYaw: heading,
      cameraPitch: CAMERA_DEFAULT_PITCH,
      cameraFollowPosition: new THREE.Vector3(),
      bowAiming: false,
      visualPolicy: { camera: { collision: 'classic' } },
      screenShakeEnabled: false,
      trauma: 0,
      resolveCameraPosition: (_target: THREE.Vector3, desired: THREE.Vector3) => desired.clone(),
      updateCameraFov() {},
      updatePlayerOutlineVisibility() {},
      updateFoliageOcclusion() {},
    })
    self.updateCamera(0, true)
    return self.stagingViewer() as StagingViewer
  }
  const unit = (point: PlanPoint): PlanPoint => {
    const length = Math.hypot(point.x, point.z)
    return { x: point.x / length, z: point.z / length }
  }
  const apart = (left: PlanPoint, right: PlanPoint): number => Math.hypot(left.x - right.x, left.z - right.z)
  const at = { x: 146.1, z: 11.4 }
  for (const heading of [0, 0.7, Math.PI / 2, 2.4, Math.PI, -1.1]) {
    const engine = engineView(heading, at)
    const harness = harnessStagingViewer({ ...at, heading })
    assert.ok(apart(engine.player, harness.player) < 1e-9)
    assert.ok(apart(engine.camera, harness.camera) < 1e-6, `heading ${heading}: the camera stands elsewhere`)
    assert.ok(apart(unit(engine.forward), unit(harness.forward)) < 1e-6, `heading ${heading}: it looks elsewhere`)
    assert.ok(Math.abs(engine.halfFov - harness.halfFov) < 1e-12)
  }
  // Negative control: a harness that read the heading the other way round would stand its
  // camera in front of the player and look back at them, and is told apart.
  const engine = engineView(0.7, at)
  const flipped = harnessStagingViewer({ ...at, heading: 0.7 + Math.PI })
  assert.ok(apart(engine.camera, flipped.camera) > 20)
  assert.ok(apart(unit(engine.forward), unit(flipped.forward)) > 1.9)
})