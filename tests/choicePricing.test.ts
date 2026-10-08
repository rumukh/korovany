/**
 * W2-3 — every choice card quotes its price, and the price is the payment.
 *
 * Three claims, each driven through the functions the game actually calls:
 *
 * - **One table.** `GameEngine.finishEvent` pays every event kind, and every contract on top
 *   of its event, exactly what `WORLD_EVENT_REWARDS` and `contractPayout` say. The
 *   comparator is run against a deliberately drifted table to prove it can see drift.
 * - **Honest cards.** All ten contract templates quote their payout, clock and walk from the
 *   same sources the engine pays and the compass charts, and the card moves when the table
 *   moves. Settled contracts quote nothing.
 * - **No fog leaks.** A card names only discovered dangerous squares; a hidden one is
 *   counted, never named, however hostile the chronicle says it is.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import { getFactionStartPosition2D, getSiteWorldPosition2D } from '../src/game/content/registry.ts'
import {
  CONTRACT_FAILED_TASK,
  describeChoiceDanger,
  describeChoicePayout,
  describeChoiceSummary,
  describeChoiceTravel,
  describeContractKept,
  describeContractTimeLimit,
  describeRandomEventSuccess,
  formatRegionGridLabel,
} from '../src/game/content/gameCopy.ts'
import {
  CHRONICLE_WORLD_EVENT_KINDS,
  RANDOM_WORLD_EVENT_KINDS,
  createHealthyBody,
  isRandomWorldEventKind,
  type CampaignContractView,
  type Faction,
  type WorldEventKind,
} from '../src/game/types.ts'
import {
  CHAMPION_DAMAGE_CAP,
  CONTRACT_TEMPLATES,
  WORLD_EVENT_REWARDS,
  beginContract,
  completeObjectiveEntry,
  contractPayout,
  createCampaignContractState,
  createGeneratedObjectives,
  ensureContractProgress,
  eventDamageGain,
  resolveContract,
  type CampaignContractState,
  type EventReward,
} from '../src/game/world/CampaignDirector.ts'
import { buildCampaignContractViews } from '../src/game/world/CampaignView.ts'
import { createChronicleRegions } from '../src/game/world/Chronicle.ts'
import { PLAYER_WALK_SPEED, playerLegMobility } from '../src/game/world/CombatMastery.ts'
import {
  ExpeditionPlanner,
  TRAVEL_MEMO_STEP,
  buildExpeditionKnowledge,
  estimateChoiceTravel,
  getExpeditionGraph,
  planDirectApproach,
  planExpeditionRoute,
  type ExpeditionKnowledge,
  type ExpeditionPoint,
} from '../src/game/world/ExpeditionPlanner.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import type { ContractId, FactionObjectiveNode, WorldBlueprint } from '../src/game/world/worldTypes.ts'

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

const ALL_KINDS: readonly WorldEventKind[] = [...RANDOM_WORLD_EVENT_KINDS, ...CHRONICLE_WORLD_EVENT_KINDS]

/**
 * The totals the gameplay review quoted from the code, pinned as the player-facing promise.
 * Event gold plus the contract's own bonus; the non-gold parts are asserted separately.
 */
const QUOTED_GOLD: Record<ContractId, number> = {
  unshackle: 90, duel: 220, reprisal: 150,
  bulwark: 200, relief: 225, cull: 200,
  plunder: 300, ambush: 240, muster: 175, scavenge: 120,
}

function invoke<T = void>(engine: object, method: string, ...args: unknown[]): T {
  const callable: unknown = Reflect.get(engine, method)
  assert.equal(typeof callable, 'function', `${method} must be a production engine method`)
  return Reflect.apply(callable as (...values: unknown[]) => T, engine, args)
}

interface Ledger {
  goldEarned: number[]
  caravansRobbed: number
  loot: string[]
  notices: string[]
  noticeMeta: Array<{ tone: string | undefined; origin: string | undefined }>
}

interface Payment {
  gold: number
  heal: number
  damage: number
  loot: string | undefined
  goldEarned: number
}

const START = { gold: 55, health: 40, maxHealth: 100, damage: 26 }

/**
 * An engine with the payment path intact and its exits replaced: the scene cleanup, the
 * sound, the view and the objective completion a kept contract triggers. The loot drop is
 * observed at the one decision the table owns, the rarity it asks for.
 */
function paymentProbe(faction: Faction, setup: {
  blueprint?: WorldBlueprint
  contracts?: CampaignContractState
  championDamageBonus?: number
} = {}): { engine: object; ledger: Ledger } {
  const ledger: Ledger = {
    goldEarned: [],
    caravansRobbed: 0,
    loot: [],
    notices: [],
    noticeMeta: [],
  }
  const engine: object = Object.create(GameEngine.prototype)
  Object.assign(engine, {
    faction,
    ...START,
    championDamageBonus: setup.championDamageBonus ?? 0,
    threatTier: 1,
    eventCooldown: 0,
    activeEvents: [],
    activeContractNodeId: null,
    campaignContracts: setup.contracts ?? createCampaignContractState(),
    generatedBlueprint: setup.blueprint ?? { objectives: { [faction]: { nodes: [] } } },
    locatedEventCopy: new Map(),
    player: { position: new THREE.Vector3() },
    achievements: {
      recordWorldEvent() {},
      recordGoldEarned: (amount: number) => ledger.goldEarned.push(amount),
      recordCaravanRobbed: () => { ledger.caravansRobbed += 1 },
    },
    callbacks: {
      onNotice: (message: string, tone?: string, origin?: string) => {
        ledger.notices.push(message)
        ledger.noticeMeta.push({ tone, origin })
      },
    },
    playSound() {},
    releaseEvent() {},
    emitView() {},
    eventRng: () => 0.5,
    regionGridLabel: () => 'B2',
    completeGeneratedObjective: () => true,
    rollLootReward: (minimum: string) => {
      ledger.loot.push(minimum)
      return { kind: 'coins', rarity: minimum, amount: 1, label: 'test' }
    },
    spawnLoot() {},
  })
  return { engine, ledger }
}

function liveEvent(kind: WorldEventKind, contractNodeId: string | null = null) {
  return {
    id: `pricing-${kind}`,
    kind,
    anchor: isRandomWorldEventKind(kind) ? 'player' : 'located',
    state: 'succeeded',
    title: kind,
    timer: null,
    regionId: 'region-1-1',
    markerPos: new THREE.Vector3(3, 0, 4),
    contractNodeId,
    playerContributed: true,
    handBack: () => [],
    ownedActorIds: [],
    ownedProps: [],
  }
}

/** Wins `event` through `finishEvent` and reports what the player was paid. */
function win(engine: object, ledger: Ledger, event: ReturnType<typeof liveEvent>): Payment {
  ;(Reflect.get(engine, 'activeEvents') as unknown[]).push(event)
  invoke(engine, 'finishEvent', event, true)
  return {
    gold: (Reflect.get(engine, 'gold') as number) - START.gold,
    heal: (Reflect.get(engine, 'health') as number) - START.health,
    damage: (Reflect.get(engine, 'damage') as number) - START.damage,
    loot: ledger.loot[0],
    goldEarned: ledger.goldEarned.reduce((sum, amount) => sum + amount, 0),
  }
}

test('an event settled without a player contribution pays half and says so', () => {
  const { engine, ledger } = paymentProbe('elf')
  const event = liveEvent('bounty')
  event.playerContributed = false
  const paid = win(engine, ledger, event)
  assert.equal(paid.gold, Math.floor(WORLD_EVENT_REWARDS.bounty.gold * 0.5))
  assert.match(ledger.notices[0], /без пользователя/i)
  assert.deepEqual(ledger.noticeMeta[0], { tone: 'warning', origin: 'outcome' })

  const contributed = paymentProbe('elf')
  const full = win(contributed.engine, contributed.ledger, liveEvent('bounty'))
  assert.equal(full.gold, WORLD_EVENT_REWARDS.bounty.gold)
  assert.doesNotMatch(contributed.ledger.notices[0], /без пользователя/i)
})

/** Every way the engine's payment for a won event can disagree with `table`. */
function paymentMismatches(table: Readonly<Record<WorldEventKind, EventReward>>): string[] {
  const problems: string[] = []
  for (const kind of ALL_KINDS) {
    const { engine, ledger } = paymentProbe('villain')
    const paid = win(engine, ledger, liveEvent(kind))
    const expected = table[kind]
    if (paid.gold !== expected.gold) problems.push(`${kind} gold ${paid.gold} != ${expected.gold}`)
    if (paid.goldEarned !== expected.gold) problems.push(`${kind} recorded ${paid.goldEarned}`)
    if (paid.heal !== expected.heal) problems.push(`${kind} heal ${paid.heal} != ${expected.heal}`)
    if (paid.damage !== eventDamageGain(expected, 0)) problems.push(`${kind} damage ${paid.damage}`)
    if (paid.loot !== expected.loot) problems.push(`${kind} loot ${String(paid.loot)} != ${expected.loot}`)
  }
  return problems
}

/** A ready node for every one of the ten templates, found on fixed seeds. */
let cases: Array<{ blueprint: WorldBlueprint; node: FactionObjectiveNode; id: ContractId }> | null = null
function contractCases(): Array<{ blueprint: WorldBlueprint; node: FactionObjectiveNode; id: ContractId }> {
  if (cases) return cases
  const found = new Map<ContractId, { blueprint: WorldBlueprint; node: FactionObjectiveNode; id: ContractId }>()
  for (let seed = 1; seed <= 40 && found.size < 10; seed += 1) {
    const blueprint = generateWorld(seed)
    for (const faction of ['elf', 'guard', 'villain'] as const) {
      for (const node of blueprint.objectives[faction].nodes) {
        if (node.contract && !found.has(node.contract)) found.set(node.contract, { blueprint, node, id: node.contract })
      }
    }
  }
  assert.equal(found.size, 10, 'a fixed seed list must reach all ten templates')
  cases = [...found.values()]
  return cases
}

/** The board as the engine builds it: the roots done, so the middle of the fork is ready. */
function board(blueprint: WorldBlueprint, faction: Faction, setup: {
  contracts?: CampaignContractState
  championDamageBonus?: number
  speed?: number
} = {}): CampaignContractView[] {
  const graph = blueprint.objectives[faction]
  const objectives = createGeneratedObjectives(blueprint, faction)
  for (const rootId of graph.rootNodeIds) completeObjectiveEntry(objectives, rootId)
  const start = getFactionStartPosition2D(blueprint, faction)
  assert.ok(start)
  const knowledge = buildExpeditionKnowledge({
    faction, discoveredRegionIds: new Set([graph.nodes[0].regionId]),
    chronicleRegions: createChronicleRegions(blueprint), contestedRegionIds: new Set(),
  }, blueprint)
  return buildCampaignContractViews({
    blueprint, faction, objectives,
    contracts: setup.contracts ?? createCampaignContractState(),
    sitePosition: (id) => getSiteWorldPosition2D(blueprint, id) ?? null,
    championDamageBonus: setup.championDamageBonus ?? 0,
    travel: (point) => estimateChoiceTravel(blueprint, start, point, knowledge,
      setup.speed ?? PLAYER_WALK_SPEED),
  })
}

// ---------------------------------------------------------------------------
// One table
// ---------------------------------------------------------------------------

test('finishEvent pays every event kind exactly what WORLD_EVENT_REWARDS says, and a drifted table is caught', () => {
  assert.deepEqual(paymentMismatches(WORLD_EVENT_REWARDS), [])
  // Negative control: the comparator has to see one gold coin of drift, and only that.
  const drifted = { ...WORLD_EVENT_REWARDS, richCaravan: { ...WORLD_EVENT_REWARDS.richCaravan, gold: 181 } }
  assert.deepEqual(paymentMismatches(drifted), ['richCaravan gold 180 != 181', 'richCaravan recorded 180'])
  const tier = { ...WORLD_EVENT_REWARDS, warband: { ...WORLD_EVENT_REWARDS.warband, loot: 'legendary' as const } }
  assert.deepEqual(paymentMismatches(tier), ['warband loot uncommon != legendary'])
})

test('a champion win adds only what the run-wide cap still allows, and says so', () => {
  for (const [bonus, expected] of [[0, 6], [15, 3], [CHAMPION_DAMAGE_CAP, 0]] as const) {
    const { engine, ledger } = paymentProbe('elf', { championDamageBonus: bonus })
    const paid = win(engine, ledger, liveEvent('champion'))
    assert.equal(paid.damage, expected, `bonus ${bonus}`)
    assert.equal(eventDamageGain(WORLD_EVENT_REWARDS.champion, bonus), expected)
    assert.equal(Reflect.get(engine, 'championDamageBonus'), bonus + expected)
    assert.ok(ledger.notices[0].includes(`+${WORLD_EVENT_REWARDS.champion.gold} золота`))
    assert.equal(ledger.notices[0].includes('к урону'), expected > 0)
  }
})

test('every kept contract pays its event and its bonus: contractPayout is the payment', () => {
  for (const { blueprint, node, id } of contractCases()) {
    const template = CONTRACT_TEMPLATES[id]
    const contracts = createCampaignContractState()
    ensureContractProgress(contracts, node)
    assert.ok(beginContract(contracts, node, template))
    const { engine, ledger } = paymentProbe(template.faction, { blueprint, contracts })
    const paid = win(engine, ledger, liveEvent(template.eventKind, node.id))
    const promised = contractPayout(template, 0)
    assert.equal(paid.gold, promised.gold, `${id} gold`)
    assert.equal(paid.gold, QUOTED_GOLD[id], `${id} no longer pays what the review quoted`)
    assert.equal(paid.goldEarned, promised.gold, `${id} achievements`)
    assert.equal(paid.heal, promised.heal, `${id} heal`)
    assert.equal(paid.damage, promised.damage, `${id} damage`)
    assert.equal(paid.loot, promised.loot, `${id} loot`)
    assert.equal(contracts.contracts[0].status, 'kept')
    assert.ok(ledger.notices.includes(describeContractKept(id, template.reward)), `${id} said nothing`)
  }
})

test('a won rescue puts the captive in the squad, which is the companion the card promises', () => {
  const spawned: Array<Record<string, unknown> & { id: string; role: string; mesh: THREE.Group }> = []
  const squad: string[] = []
  const engine: object = Object.create(GameEngine.prototype)
  Object.assign(engine, {
    faction: 'elf',
    actors: [],
    player: { position: new THREE.Vector3() },
    eventPropTargets: new Map(),
    reserveActorSlots: () => true,
    nextEventId: () => 'rescue-pricing',
    pickEventPosition: () => new THREE.Vector3(1, 0, 1),
    pickEventEnemyFaction: () => 'guard',
    generatedRegionIdAt: () => 'region-1-1',
    spawnActor: (allegiance: string, role: string, x: number, z: number, _index: number,
      options: Record<string, unknown>) => {
      const mesh = new THREE.Group()
      mesh.position.set(x, 0, z)
      const actor = { ...options, id: `pricing-actor-${spawned.length}`, allegiance, role, alive: true, mesh,
        home: new THREE.Vector3(), wanderTarget: new THREE.Vector3() }
      spawned.push(actor)
      return actor
    },
    assignSquadSlot: (actor: { id: string }) => squad.push(actor.id),
    unbindActorArms() {},
  })
  const event = invoke<{ state: string; onInteract(): boolean }>(engine, 'startRescueEvent', new THREE.Vector3(1, 0, 1))
  const captive = spawned.find((actor) => actor.role === 'captive')
  assert.ok(captive)
  // Negative control: before the win the captive is the event's, not the player's.
  assert.equal(captive.squadEligible, false)
  assert.deepEqual(squad, [])
  assert.equal(event.onInteract(), true)
  assert.equal(event.state, 'succeeded')
  assert.equal(captive.squadEligible, true)
  assert.equal(captive.budgetCategory, 'squad')
  assert.deepEqual(squad, [captive.id])
  // And the table claims a companion for that kind and no other.
  assert.deepEqual(ALL_KINDS.filter((kind) => WORLD_EVENT_REWARDS[kind].companion), ['rescue'])
  assert.equal(contractPayout(CONTRACT_TEMPLATES.unshackle).companion, true)
})

test('guards and villains free a captive who goes home instead of joining their squad', () => {
  for (const faction of ['guard', 'villain'] as const) {
    const spawned: Array<Record<string, unknown> & {
      id: string
      role: string
      mesh: THREE.Group
    }> = []
    let assigned = 0
    const engine: object = Object.assign(Object.create(GameEngine.prototype), {
      faction,
      actors: [],
      player: { position: new THREE.Vector3() },
      eventPropTargets: new Map(),
      reserveActorSlots: () => true,
      nextEventId: () => `rescue-${faction}`,
      pickEventPosition: () => new THREE.Vector3(1, 0, 1),
      pickEventEnemyFaction: () => 'elf',
      generatedRegionIdAt: () => 'region-1-1',
      spawnActor: (allegiance: string, role: string, x: number, z: number, _index: number,
        options: Record<string, unknown>) => {
        const mesh = new THREE.Group()
        mesh.position.set(x, 0, z)
        const actor = {
          ...options,
          id: `${faction}-actor-${spawned.length}`,
          allegiance,
          role,
          alive: true,
          mesh,
          home: new THREE.Vector3(),
          wanderTarget: new THREE.Vector3(),
        }
        spawned.push(actor)
        return actor
      },
      assignSquadSlot: () => { assigned += 1 },
      unbindActorArms() {},
    })
    const event = invoke<{ state: string; companionJoined?: boolean; onInteract(): boolean }>(
      engine,
      'startRescueEvent',
      new THREE.Vector3(1, 0, 1),
    )
    const captive = spawned.find((actor) => actor.role === 'captive')
    assert.ok(captive)
    assert.equal(event.onInteract(), true)
    assert.equal(event.state, 'succeeded')
    assert.equal(event.companionJoined, false)
    assert.equal(captive.squadEligible, false)
    assert.equal(assigned, 0)
    const copy = describeRandomEventSuccess('rescue', { gold: 0, heal: 0 }, false)
    assert.match(copy, /пошёл домой/)
    assert.doesNotMatch(copy, /твоём отряде/)
  }
})

// ---------------------------------------------------------------------------
// Honest cards
// ---------------------------------------------------------------------------

test('all ten contract cards quote the table, their clock and a walk, in plain words', () => {
  for (const { blueprint, node, id } of contractCases()) {
    const template = CONTRACT_TEMPLATES[id]
    const card = board(blueprint, template.faction).find((entry) => entry.id === node.id)
    assert.ok(card, `${id} is not on its board`)
    assert.deepEqual(card.payout, contractPayout(template, 0))
    assert.equal(card.payout?.gold, QUOTED_GOLD[id])
    assert.equal(card.timeLimit, template.timeoutSeconds)
    assert.ok(card.travel && card.travel.meters > 0 && card.travel.seconds > 0, `${id} has no walk`)
    const line = describeChoicePayout(card.payout!)
    assert.ok(line?.startsWith(`Плата: ${QUOTED_GOLD[id]} · без тебя`), `${id}: ${String(line)}`)
    const withoutPlayer = Math.floor(template.reward * 0.5) +
      Math.floor(WORLD_EVENT_REWARDS[template.eventKind].gold * 0.5)
    assert.ok(line?.includes(`без тебя ${String(withoutPlayer)}`), `${id}: ${String(line)}`)
    assert.equal(line?.includes('свой в отряд'), template.eventKind === 'rescue', `${id}: ${String(line)}`)
    assert.equal(line?.includes('+6 к урону'), template.eventKind === 'champion', `${id}: ${String(line)}`)
    assert.equal(line?.includes('легендарный трофей'), template.eventKind === 'champion', `${id}: ${String(line)}`)
    assert.equal(line?.includes('+8 здоровья'), template.eventKind === 'defendHome', `${id}: ${String(line)}`)
    assert.ok(line?.includes('трофей'), `${id}: ${String(line)}`)
    assert.equal(describeContractTimeLimit(template.timeoutSeconds), `Срок: ${template.timeoutSeconds} с с начала`)
  }
})

test('the card moves when the table moves, and quotes nothing once the contract is settled', () => {
  const { blueprint, node } = contractCases().find((entry) => entry.id === 'plunder')!
  const table = WORLD_EVENT_REWARDS as Record<WorldEventKind, EventReward>
  const original = table.richCaravan
  table.richCaravan = { ...original, gold: original.gold + 5 }
  try {
    const moved = board(blueprint, 'villain').find((entry) => entry.id === node.id)
    assert.equal(moved?.payout?.gold, QUOTED_GOLD.plunder + 5, 'the card is not reading the table')
  } finally {
    table.richCaravan = original
  }
  const contracts = createCampaignContractState()
  ensureContractProgress(contracts, node)
  beginContract(contracts, node, CONTRACT_TEMPLATES.plunder)
  const running = board(blueprint, 'villain', { contracts }).find((entry) => entry.id === node.id)
  assert.equal(running?.payout?.gold, QUOTED_GOLD.plunder, 'a running contract still pays')
  assert.equal(running?.timeLimit, null, 'the running clock is timeRemaining, not a quote')
  assert.ok(resolveContract(contracts, node.id, 'failed'))
  const failed = board(blueprint, 'villain', { contracts }).find((entry) => entry.id === node.id)
  assert.equal(failed?.task, CONTRACT_FAILED_TASK)
  assert.equal(failed?.payout, null, 'a failed contract has nothing left to pay')
  assert.equal(failed?.timeLimit, null)
  assert.ok(failed?.travel, 'the fail-forward walk is still a walk')
  const errand = board(blueprint, 'villain').find((entry) => entry.contract === null)
  assert.ok(errand, 'the fork carries its required errand')
  assert.equal(errand.payout, null)
  assert.equal(errand.timeLimit, null)
  assert.ok(errand.travel)
})

test('a duel card quotes the damage the run can still gain', () => {
  const { blueprint, node } = contractCases().find((entry) => entry.id === 'duel')!
  const quote = (bonus: number) => board(blueprint, 'elf', { championDamageBonus: bonus })
    .find((entry) => entry.id === node.id)?.payout
  assert.equal(quote(0)?.damage, 6)
  assert.equal(quote(15)?.damage, 3)
  assert.equal(quote(CHAMPION_DAMAGE_CAP)?.damage, 0)
  assert.equal(describeChoicePayout(quote(CHAMPION_DAMAGE_CAP)!)?.includes('к урону'), false)
})

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

test('a card times the itinerary the compass charts, at the walking pace of the legs the player has', () => {
  const blueprint = generateWorld(20_260_905)
  const faction: Faction = 'villain'
  const start = getFactionStartPosition2D(blueprint, faction)
  assert.ok(start)
  const finalId = blueprint.objectives[faction].finalNodeId
  const objectives = createGeneratedObjectives(blueprint, faction)
    .map((objective) => ({ ...objective, done: objective.id !== finalId }))
  const discoveredRegionIds = new Set([blueprint.criticalPaths[faction].regionIds[0]])
  const chronicleRegions = createChronicleRegions(blueprint)
  const knowledge = buildExpeditionKnowledge({ faction, discoveredRegionIds, chronicleRegions,
    contestedRegionIds: new Set() }, blueprint)
  const contracts = buildCampaignContractViews({
    blueprint, faction, objectives, contracts: createCampaignContractState(),
    sitePosition: (id) => getSiteWorldPosition2D(blueprint, id) ?? null,
    travel: (point) => estimateChoiceTravel(blueprint, start, point, knowledge, PLAYER_WALK_SPEED),
  })
  const view = new ExpeditionPlanner(blueprint).buildView({
    faction, player: start, heading: 0, objectives, activeObjectiveId: finalId, contracts, rumours: [],
    discoveredRegionIds, chronicleRegions, contestedRegionIds: new Set(),
  })
  assert.equal(view.route?.status, 'road')
  assert.ok(view.target?.travel)
  assert.equal(view.target.travel.basis, 'road')
  assert.ok(Math.abs(view.target.travel.meters - (view.route.roadDistance + view.route.connectorDistance)) < 1e-9,
    'the card and the compass measure different walks')
  assert.equal(view.target.travel.seconds, Math.ceil(view.target.travel.meters / PLAYER_WALK_SPEED))
  assert.ok(view.target.payout === null && view.target.timeLimit === null, 'the finale errand pays nothing named')

  const site = getSiteWorldPosition2D(blueprint, blueprint.objectives[faction].nodes
    .find((node) => node.id === finalId)!.siteId)
  assert.ok(site)
  const healthy = estimateChoiceTravel(blueprint, start, site, knowledge, PLAYER_WALK_SPEED)
  const body = { ...createHealthyBody(), leftLeg: 'missing' as const }
  const limping = estimateChoiceTravel(blueprint, start, site, knowledge, PLAYER_WALK_SPEED * playerLegMobility(body))
  assert.equal(limping.meters, healthy.meters)
  assert.equal(limping.seconds, Math.ceil(healthy.meters / (PLAYER_WALK_SPEED * 0.53)))
  assert.ok(limping.seconds > healthy.seconds * 1.8, 'a missing leg must lengthen the quoted walk')
  assert.ok(describeChoiceTravel(healthy).startsWith(`Идти ~${healthy.seconds} с, ${Math.ceil(healthy.meters)} м дороги`))
})

test('with no road to plan the card quotes the straight line and says so', () => {
  const blueprint = generateWorld(20_261_006)
  const graph = getExpeditionGraph(blueprint)
  const target = getSiteWorldPosition2D(blueprint, blueprint.objectives.villain.nodes
    .find((node) => node.id === blueprint.objectives.villain.finalNodeId)!.siteId)
  assert.ok(target)
  let checked = 0
  for (const site of blueprint.sites) {
    const position = getSiteWorldPosition2D(blueprint, site)
    if (!position) continue
    const from = { x: position.x + 7, z: position.z - 5 }
    const road = planExpeditionRoute(graph, from, target, unknownKnowledge())
    if (road.status !== 'unavailable' || planDirectApproach(graph, from, target, unknownKnowledge(), road)) continue
    const travel = estimateChoiceTravel(blueprint, from, target, unknownKnowledge(), PLAYER_WALK_SPEED)
    assert.equal(travel.basis, 'straight')
    assert.ok(Math.abs(travel.meters - Math.hypot(target.x - from.x, target.z - from.z)) < 1e-9)
    assert.ok(describeChoiceTravel(travel).endsWith('по прямой: дороги нет'))
    checked += 1
  }
  assert.ok(checked > 0, 'this seed must have an off-road start, or the fallback is untested')
})

function unknownKnowledge(): ExpeditionKnowledge {
  return { discoveredRegionIds: new Set(), risks: new Map() }
}

test('a card names only discovered danger; a hostile square in fog is counted, never named', () => {
  const blueprint = generateWorld(20_260_905)
  const faction: Faction = 'villain'
  const start = getFactionStartPosition2D(blueprint, faction)
  assert.ok(start)
  const finalSite = getSiteWorldPosition2D(blueprint, blueprint.objectives[faction].nodes
    .find((node) => node.id === blueprint.objectives[faction].finalNodeId)!.siteId)
  assert.ok(finalSite)
  const route = planExpeditionRoute(getExpeditionGraph(blueprint), start, finalSite, unknownKnowledge())
  assert.equal(route.status, 'road')
  const hidden = route.regionIds[Math.floor(route.regionIds.length / 2)]
  const label = (id: string) => {
    const region = blueprint.regions.find((entry) => entry.id === id)!
    return formatRegionGridLabel(region.coordinate.x, region.coordinate.y)
  }
  // The real knowledge builder, fed a chronicle that has every square hostile: what the
  // player has not seen cannot reach the card, so nothing is named and everything is fog.
  const poisoned = createChronicleRegions(blueprint)
  for (const state of poisoned.values()) state.control = 'guard'
  const fogged = estimateChoiceTravel(blueprint, start, finalSite, buildExpeditionKnowledge({
    faction, discoveredRegionIds: new Set(), chronicleRegions: poisoned, contestedRegionIds: new Set(),
  }, blueprint), PLAYER_WALK_SPEED)
  assert.deepEqual(fogged.danger, [])
  assert.equal(fogged.unscouted, route.regionIds.length)
  assert.ok(describeChoiceDanger(fogged).startsWith('В тумане: '), describeChoiceDanger(fogged))
  assert.equal(describeChoiceDanger(fogged).includes('Опасно'), false)
  // Negative control: the same square, once discovered, is named — so the empty list above
  // is the fog doing its job, not a card that never names anything.
  const seen = estimateChoiceTravel(blueprint, start, finalSite, buildExpeditionKnowledge({
    faction, discoveredRegionIds: new Set([hidden]), chronicleRegions: poisoned, contestedRegionIds: new Set(),
  }, blueprint), PLAYER_WALK_SPEED)
  assert.deepEqual(seen.danger, [label(hidden)])
  assert.equal(seen.unscouted, route.regionIds.length - 1)
  assert.equal(seen.meters, fogged.meters, 'knowing a square must not change the shortest walk')
  assert.ok(describeChoiceDanger(seen).startsWith(`Опасно: ${label(hidden)}`))
  // A hand-built knowledge that claims a hidden square is hostile is ignored the same way.
  const claimed: ExpeditionKnowledge = { discoveredRegionIds: new Set(),
    risks: new Map([[hidden, { hostile: true, contested: true }]]) }
  assert.deepEqual(estimateChoiceTravel(blueprint, start, finalSite, claimed, PLAYER_WALK_SPEED).danger, [])
})

test('the engine prices its board with the planner, the champion bonus and the legs it has', () => {
  const { blueprint, node } = contractCases().find((entry) => entry.id === 'duel')!
  const faction: Faction = 'elf'
  const graph = blueprint.objectives[faction]
  const objectives = createGeneratedObjectives(blueprint, faction)
  for (const rootId of graph.rootNodeIds) completeObjectiveEntry(objectives, rootId)
  const start = getFactionStartPosition2D(blueprint, faction)
  assert.ok(start)
  const discovered = [String(graph.nodes[0].regionId)]
  const engine: object = Object.create(GameEngine.prototype)
  const player = new THREE.Group()
  player.position.set(start.x, 0, start.z)
  Object.assign(engine, {
    faction, player, cameraYaw: 0, objectives, generatedBlueprint: blueprint,
    campaignContracts: createCampaignContractState(),
    generatedWorld: {
      discoveredRegionIds: discovered,
      getSitePosition: (id: string) => {
        const position = getSiteWorldPosition2D(blueprint, id)
        return position ? { ...position, y: 0 } : undefined
      },
    },
    championDamageBonus: 15, body: createHealthyBody(),
    expeditionPlanner: new ExpeditionPlanner(blueprint),
    chronicleRegions: createChronicleRegions(blueprint), chronicleContestedRegionIds: new Set(),
    getActiveGeneratedObjective: () => null,
    buildRumourViews: () => [],
    bridgeAmbushExpeditionTarget: () => null,
  })
  const card = () => invoke<{ contracts: CampaignContractView[] }>(engine, 'buildExpeditionInput')
    .contracts.find((entry) => entry.id === node.id)
  const healthy = card()
  assert.ok(healthy?.travel)
  assert.deepEqual(healthy.payout, contractPayout(CONTRACT_TEMPLATES.duel, 15))
  assert.equal(healthy.payout?.damage, 3)
  const expected = estimateChoiceTravel(blueprint, start, getSiteWorldPosition2D(blueprint, node.siteId)!,
    buildExpeditionKnowledge({ faction, discoveredRegionIds: new Set(discovered),
      chronicleRegions: createChronicleRegions(blueprint), contestedRegionIds: new Set() }, blueprint),
    PLAYER_WALK_SPEED)
  assert.deepEqual(healthy.travel, expected)
  Reflect.set(engine, 'body', { ...createHealthyBody(), rightLeg: 'missing' })
  const limping = card()
  assert.equal(limping?.travel?.meters, expected.meters)
  assert.equal(limping?.travel?.seconds, Math.ceil(expected.meters / (PLAYER_WALK_SPEED * 0.53)))
})

test('the memoised card walk is the estimate, and only re-plans when the player has moved', () => {
  const blueprint = generateWorld(20_260_905)
  const planner = new ExpeditionPlanner(blueprint)
  const start = getFactionStartPosition2D(blueprint, 'guard')
  assert.ok(start)
  const site = getSiteWorldPosition2D(blueprint, blueprint.objectives.guard.nodes[1].siteId)
  assert.ok(site)
  const input = { faction: 'guard' as const, discoveredRegionIds: new Set<string>(),
    chronicleRegions: createChronicleRegions(blueprint), contestedRegionIds: new Set<string>() }
  const knowledge = buildExpeditionKnowledge(input, blueprint)
  // On a memo cell's centre, so a 0.4 m step stays inside the same cell.
  const from: ExpeditionPoint = {
    x: Math.round(start.x / TRAVEL_MEMO_STEP) * TRAVEL_MEMO_STEP,
    z: Math.round(start.z / TRAVEL_MEMO_STEP) * TRAVEL_MEMO_STEP,
  }
  const first = planner.measureTravel(input, from, site, PLAYER_WALK_SPEED)
  assert.deepEqual(first, estimateChoiceTravel(blueprint, from, site, knowledge, PLAYER_WALK_SPEED))
  first.danger.push('Z9')
  const step = { x: from.x + 0.4, z: from.z }
  const again = planner.measureTravel(input, step, site, PLAYER_WALK_SPEED)
  assert.equal(again.danger.includes('Z9'), false, 'a caller must not be able to edit the memo')
  assert.notEqual(estimateChoiceTravel(blueprint, step, site, knowledge, PLAYER_WALK_SPEED).meters, first.meters,
    'the step has to be one a fresh estimate would notice')
  assert.equal(again.meters, first.meters, 'a step inside the same cell re-used the estimate')
  const moved = planner.measureTravel(input, { x: from.x + 30, z: from.z }, site, PLAYER_WALK_SPEED)
  assert.deepEqual(moved, estimateChoiceTravel(blueprint, { x: from.x + 30, z: from.z }, site,
    knowledge, PLAYER_WALK_SPEED))
  assert.equal(describeChoiceSummary(contractPayout(CONTRACT_TEMPLATES.relief), moved),
    `225 золотых · идти ~${moved.seconds} с`)
})
