import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import { resolveDoctrineEffects } from '../src/game/run/doctrine.ts'
import {
  DEFAULT_UPGRADE_LEVELS,
  SHOP_ITEMS,
  createHealthyBody,
  type ActorRole,
  type Faction,
} from '../src/game/types.ts'
import {
  createSquadResourceState,
  type SquadResourceState,
} from '../src/game/world/SquadResource.ts'

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
  const callable: unknown = Reflect.get(engine, method)
  assert.equal(typeof callable, 'function', `${method} must be a production engine method`)
  return Reflect.apply(callable as (...values: unknown[]) => T, engine, args)
}

interface TestSquadActor {
  id: string
  role: ActorRole
  allegiance: Faction
  alive: boolean
  hp: number
  maxHp: number
  hostileToPlayer: boolean
  squadEligible: boolean
  budgetCategory: 'squad'
  eventOwnerId: null
  aiMode: 'normal'
  squadSlot: number | null
  mesh: THREE.Group
  home: THREE.Vector3
  wanderTarget: THREE.Vector3
  healthBarVisibleUntil: number
}

function squadActor(
  faction: Faction,
  id: string,
  health: number,
  x: number,
): TestSquadActor {
  const mesh = new THREE.Group()
  mesh.position.set(x, 0, 0)
  const role: ActorRole = faction === 'villain' ? 'minion' : 'soldier'
  return {
    id,
    role,
    allegiance: faction,
    alive: true,
    hp: health,
    maxHp: 70,
    hostileToPlayer: false,
    squadEligible: true,
    budgetCategory: 'squad' as const,
    eventOwnerId: null,
    aiMode: 'normal',
    squadSlot: 0,
    mesh,
    home: new THREE.Vector3(),
    wanderTarget: new THREE.Vector3(),
    healthBarVisibleUntil: 0,
  }
}

function careFixture(faction: Faction = 'elf') {
  const notices: Array<{
    message: string
    tone: string | undefined
    origin: string | undefined
  }> = []
  const player = new THREE.Group()
  const near = squadActor(faction, `squad:${faction}:near`, 10, 3)
  const far = squadActor(faction, `squad:${faction}:far`, 10, 15)
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    faction,
    actors: [near, far],
    player,
    ended: false,
    elapsed: 10,
    generatedSupplyCount: 1,
    squadResource: createSquadResourceState([]),
    health: 60,
    maxHealth: 100,
    stamina: 80,
    maxStamina: 100,
    body: createHealthyBody(),
    upgrades: { ...DEFAULT_UPGRADE_LEVELS },
    activeShopPriceMultiplier: 1,
    gold: 100,
    doctrineEffects: resolveDoctrineEffects([]),
    callbacks: {
      onNotice: (message: string, tone?: string, origin?: string) =>
        notices.push({ message, tone, origin }),
    },
    achievements: { recordPurchase() {} },
    drawActorHealthBar() {},
    playSound() {},
    emitView() {},
  })
  return { engine, player, near, far, notices }
}

test('a ration treats one chosen nearby companion and spends nothing on invalid targets', () => {
  const value = careFixture()
  assert.equal(invoke<boolean>(
    value.engine,
    'treatCompanionWithRation',
    value.near.id,
  ), true)
  assert.equal(value.near.hp, 45)
  assert.equal(value.far.hp, 10)
  assert.equal(Reflect.get(value.engine, 'health'), 60)
  assert.equal(Reflect.get(value.engine, 'generatedSupplyCount'), 0)
  assert.equal(value.notices.at(-1)?.tone, 'success')
  assert.equal(value.notices.at(-1)?.origin, 'outcome')

  Reflect.set(value.engine, 'generatedSupplyCount', 1)
  assert.equal(invoke<boolean>(
    value.engine,
    'treatCompanionWithRation',
    value.far.id,
  ), false)
  assert.equal(value.far.hp, 10)
  assert.equal(Reflect.get(value.engine, 'generatedSupplyCount'), 1)
  assert.equal(value.notices.at(-1)?.tone, 'warning')
})

test('field medicine charges once and heals the selected companion, not the player', () => {
  const value = careFixture()
  const medicine = SHOP_ITEMS.find((item) => item.id === 'medicine')
  assert.ok(medicine)
  const result = invoke<{ ok: boolean; message: string }>(
    value.engine,
    'purchase',
    medicine,
    value.near.id,
  )
  assert.equal(result.ok, true)
  assert.equal(value.near.hp, 65)
  assert.equal(Reflect.get(value.engine, 'health'), 60)
  assert.equal(Reflect.get(value.engine, 'gold'), 65)

  const refused = invoke<{ ok: boolean; message: string }>(
    value.engine,
    'purchase',
    medicine,
    value.far.id,
  )
  assert.equal(refused.ok, false)
  assert.equal(Reflect.get(value.engine, 'gold'), 65)
})

function musterFixture(casualties: number) {
  const notices: Array<{
    message: string
    tone: string | undefined
    origin: string | undefined
  }> = []
  const actors = [
    squadActor('villain', 'squad:villain:starter:0', 70, 0),
    squadActor('villain', 'squad:villain:starter:1', 70, 1),
  ]
  const player = new THREE.Group()
  const resource = createSquadResourceState([], casualties)
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    faction: 'villain',
    player,
    actors,
    actorSequence: 0,
    squadResource: resource,
    generatedBlueprint: { starts: { villain: 'old-fort' } },
    generatedWorld: {
      findNearbySite: () => ({ id: 'old-fort' }),
    },
    actorColliderRadiusForRole: () => 0.5,
    isWalkablePosition: () => true,
    reserveActorSlots: () => true,
    spawnActor: (
      allegiance: Faction,
      role: 'minion',
      x: number,
      z: number,
      _index: number,
      options: Record<string, unknown>,
    ) => {
      const actor = {
        ...squadActor(allegiance, `spawned-${actors.length}`, 70, x),
        ...options,
        role,
      }
      actor.mesh.position.z = z
      actors.push(actor)
      return actor
    },
    assignSquadSlot: (actor: { squadSlot: number | null }) => { actor.squadSlot = 3 },
    callbacks: {
      onNotice: (message: string, tone?: string, origin?: string) =>
        notices.push({ message, tone, origin }),
    },
    playSound() {},
  })
  return { engine, actors, resource, notices }
}

test('the villain spends one old-fort muster only after a casualty', () => {
  const value = musterFixture(1)
  assert.match(invoke<string>(value.engine, 'getVillainMusterPrompt'), /сбор 1\/1/)
  assert.equal(invoke<boolean>(value.engine, 'handleVillainMusterInteraction'), true)
  assert.equal(value.resource.villainMustersUsed, 1)
  assert.equal(value.resource.reinforcements.villainMuster, 1)
  assert.ok(value.actors.some((actor) => actor.id === 'squad:villain:muster:0'))
  assert.equal(value.notices.at(-1)?.tone, 'success')
  assert.equal(value.notices.at(-1)?.origin, 'outcome')
  assert.equal(invoke<boolean>(value.engine, 'handleVillainMusterInteraction'), false)
  assert.match(invoke<string>(value.engine, 'getVillainMusterPrompt'), /уже потрачен · 0\/1/)

  const control = musterFixture(0)
  assert.equal(invoke<string | null>(control.engine, 'getVillainMusterPrompt'), null)
  assert.equal(invoke<boolean>(control.engine, 'handleVillainMusterInteraction'), false)
  assert.equal((Reflect.get(control.engine, 'squadResource') as SquadResourceState).villainMustersUsed, 0)
})

function elfDefenseFixture(full = false) {
  const notices: Array<{
    message: string
    tone: string | undefined
    origin: string | undefined
  }> = []
  const actors = Array.from(
    { length: full ? 4 : 2 },
    (_, index) => squadActor('elf', `squad:elf:${index}`, 70, index),
  )
  const player = new THREE.Group()
  const event = {
    id: 'defend-home-test',
    kind: 'defendHome',
    anchor: 'player',
    state: 'succeeded',
    title: 'Дом в огне',
    description: '',
    tone: 'danger',
    timer: 0,
    progress: 4,
    target: 4,
    markerId: 'defend-home-test-marker',
    markerPos: new THREE.Vector3(4, 0, 5),
    ownedActorIds: [],
    ownedProps: [],
    contractNodeId: null,
    playerContributed: true,
  }
  const activeEvents = [event]
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    faction: 'elf',
    actors,
    player,
    actorSequence: 0,
    squadResource: createSquadResourceState([]),
    activeEvents,
    threatTier: 1,
    eventCooldown: 0,
    health: 100,
    maxHealth: 100,
    gold: 0,
    championDamageBonus: 0,
    generatedBlueprint: { objectives: { elf: { nodes: [] } } },
    actorColliderRadiusForRole: () => 0.5,
    isWalkablePosition: () => true,
    reserveActorSlots: () => true,
    spawnActor: (
      allegiance: Faction,
      role: 'scout',
      x: number,
      z: number,
      _index: number,
      options: Record<string, unknown>,
    ) => {
      const actor = {
        ...squadActor(allegiance, `spawned-${actors.length}`, 55, x),
        ...options,
        role,
      }
      actor.mesh.position.z = z
      actors.push(actor)
      return actor
    },
    assignSquadSlot: (actor: { squadSlot: number | null }) => { actor.squadSlot = 3 },
    achievements: {
      recordWorldEvent() {},
      recordGoldEarned() {},
      recordCaravanRobbed() {},
    },
    callbacks: {
      onNotice: (message: string, tone?: string, origin?: string) =>
        notices.push({ message, tone, origin }),
    },
    spawnEventLoot() {},
    releaseEvent: () => { activeEvents.length = 0 },
    eventRng: () => 0.5,
    playSound() {},
    emitView() {},
  })
  return { engine, actors, notices, event }
}

test('a defended wooden house adds one elf partisan, but a full squad adds none', () => {
  const value = elfDefenseFixture()
  invoke(value.engine, 'finishEvent', value.event, true)
  const partisan = value.actors.find((actor) => actor.id === 'defend-home-test:partisan')
  assert.ok(partisan)
  assert.equal(partisan.role, 'scout')
  assert.equal(value.notices[0]?.tone, 'success')
  assert.equal(value.notices[0]?.origin, 'outcome')
  assert.equal(value.notices.at(-1)?.tone, 'success')
  assert.equal(value.notices.at(-1)?.origin, 'outcome')

  const full = elfDefenseFixture(true)
  invoke(full.engine, 'finishEvent', full.event, true)
  assert.equal(
    full.actors.some((actor) => actor.id === 'defend-home-test:partisan'),
    false,
  )
  assert.equal(full.actors.length, 4)
  assert.equal(full.notices.at(-1)?.tone, 'warning')
})

test('a hit, blocked contact, or event interaction records durable full-credit contribution', () => {
  const resource = createSquadResourceState([])
  const event = {
    id: 'credit-event',
    kind: 'bounty',
    contractNodeId: 'contract-one',
    situationId: null,
    ownedActorIds: ['credit-target'],
    onInteract: () => true,
    playerInteracted: false,
    playerContributed: false,
  }
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    faction: 'guard',
    squadResource: resource,
    activeEvents: [event],
    elapsed: 12,
    paused: false,
    ended: false,
    focusCaravanBeatChoice: () => false,
    resumeAudio() {},
    emitView() {},
  })

  invoke(engine, 'notePlayerExchange', 'credit-target')
  assert.equal(event.playerContributed, true)
  assert.deepEqual(resource.contributedFightKeys, ['contract:contract-one'])

  event.playerContributed = false
  assert.equal(invoke<boolean>(engine, 'eventHasPlayerContribution', event), true)

  resource.contributedFightKeys.length = 0
  invoke(engine, 'interact')
  assert.equal(event.playerInteracted, true)
  assert.equal(event.playerContributed, true)
  assert.deepEqual(resource.contributedFightKeys, ['contract:contract-one'])
})
