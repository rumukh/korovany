/**
 * W1-2 — once the player wins a caravan fight, the robbery is theirs.
 *
 * Two layers, both driven through the code the engine actually runs:
 *
 * - `world/CaravanClaim.ts`, the rules, frame by frame.
 * - `GameEngine`'s road cart (`updateCaravanEscort`, `damageActor`, `interact`,
 *   `getGeneratedPrompt`) and the chronicle's ambushed cart (`startCaravanAmbushEvent`,
 *   `finishEvent`), assembled field by field the way `caravanBeats.test.ts` does. Only
 *   presentation and unrelated world plumbing are stubbed.
 *
 * Every claim carries a negative control: the same scene with the one thing the claim is
 * about changed, showing that the harness would have caught the defect.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import {
  CARAVAN_AMBUSH_CONFISCATED_OUTCOME,
  CARAVAN_AMBUSH_DEFENCE_PROMPT,
  CARAVAN_CLAIM_NOTICE,
  CARAVAN_CONFISCATE_PROMPT,
  describeCaravanAlreadyRobbed,
  describeCaravanEmptyPrompt,
  describeCaravanLootInterrupted,
  describeCaravanPlundered,
} from '../src/game/content/gameCopy.ts'
import { areAllegiancesHostile, type ActorRole, type Allegiance, type Faction } from '../src/game/types.ts'
import {
  CARAVAN_CLAIM_HIT_MEMORY,
  CARAVAN_CLAIM_RANGE,
  CARAVAN_CLAIM_SECONDS,
  CARAVAN_LOOT_BREAK_RANGE,
  CARAVAN_LOOT_CHANNEL_SECONDS,
  CARAVAN_LOOT_CUE_RANGE,
  advanceCaravanClaim,
  buildCaravanLootView,
  cancelCaravanLoot,
  caravanLootProgress,
  createCaravanClaimState,
  interruptCaravanLoot,
  noteCaravanEscortHit,
  type CaravanClaimInput,
  type CaravanClaimState,
  type CaravanLooterSample,
  type CaravanLootView,
} from '../src/game/world/CaravanClaim.ts'
import { createChronicleState, type ChronicleState } from '../src/game/world/Chronicle.ts'
import type { PendingMaterialization } from '../src/game/world/Materialization.ts'

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

const FRAME = 0.05
const EPSILON = 1e-9

function invoke<T = void>(engine: object, method: string, ...args: unknown[]): T {
  const callable = Reflect.get(engine, method)
  assert.equal(typeof callable, 'function', `${method} must be a production engine method`)
  return Reflect.apply(callable as (...values: unknown[]) => T, engine, args)
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

function sample(id: string, distance: number, ready = true, beast = false): CaravanLooterSample {
  return { id, distance, ready, beast }
}

function frame(overrides: Partial<CaravanClaimInput> = {}): CaravanClaimInput {
  return {
    delta: FRAME,
    elapsed: 0,
    guarded: false,
    escortFell: false,
    empty: false,
    playerRobs: true,
    playerDistance: 30,
    looter: null,
    candidate: null,
    plunderRange: 3.4,
    ...overrides,
  }
}

/** Starts a channel for `raider` at 2.5 m and returns the state. */
function loading(): CaravanClaimState {
  const state = createCaravanClaimState()
  assert.equal(advanceCaravanClaim(state, frame({ candidate: sample('raider', 2.5) })).started, 'raider')
  return state
}

test('a looter needs the whole channel at the cart, not one frame within reach', () => {
  assert.ok(CARAVAN_LOOT_CHANNEL_SECONDS >= 3 && CARAVAN_LOOT_CHANNEL_SECONDS <= 4)
  const state = createCaravanClaimState()
  const first = advanceCaravanClaim(state, frame({ candidate: sample('raider', 2.5) }))
  assert.equal(first.started, 'raider')
  // The shipped rule took the cart on exactly this frame. Detecting it is the point.
  assert.equal(first.plundered, null)
  let seconds = 0
  let plunderedAt: number | null = null
  for (let index = 0; index < 400 && plunderedAt === null; index += 1) {
    const step = advanceCaravanClaim(state, frame({ looter: sample('raider', 2.5) }))
    seconds += FRAME
    if (step.plundered) {
      plunderedAt = seconds
      assert.deepEqual(step.plundered, { id: 'raider', kind: 'raider' })
    } else {
      assert.ok(caravanLootProgress(state) < 1)
    }
  }
  assert.ok(plunderedAt !== null, 'an uncontested channel must finish')
  assert.ok(plunderedAt >= CARAVAN_LOOT_CHANNEL_SECONDS - EPSILON)
  assert.ok(plunderedAt < CARAVAN_LOOT_CHANNEL_SECONDS + FRAME + EPSILON)
  assert.equal(state.looterId, null)
  assert.equal(caravanLootProgress(state), 0)

  const beast = createCaravanClaimState()
  advanceCaravanClaim(beast, frame({ candidate: sample('wolf', 1, true, true) }))
  let kind: string | null = null
  for (let index = 0; index < 100 && kind === null; index += 1) {
    kind = advanceCaravanClaim(beast, frame({ looter: sample('wolf', 1, true, true) })).plundered?.kind ?? null
  }
  assert.equal(kind, 'beast')
})

test('a channel breaks on a hit, a stumble, a drag, an escort, an emptied cart or a vanished looter', () => {
  const cases: Array<[string, (state: CaravanClaimState) => Partial<CaravanClaimInput>]> = [
    ['hit', (state) => {
      assert.equal(interruptCaravanLoot(state, 'somebody-else'), false, 'only the looter is interrupted')
      assert.equal(interruptCaravanLoot(state, 'raider'), true)
      return { looter: sample('raider', 2.5) }
    }],
    ['stumble', () => ({ looter: sample('raider', 2.5, false) })],
    ['drag', () => ({ looter: sample('raider', CARAVAN_LOOT_BREAK_RANGE + 0.01) })],
    ['escort', () => ({ guarded: true, looter: sample('raider', 2.5) })],
    ['empty', () => ({ empty: true, looter: sample('raider', 2.5) })],
    ['vanished', () => ({ looter: null })],
    ['impostor', () => ({ looter: sample('another', 2.5) })],
  ]
  for (const [name, breakWith] of cases) {
    const state = loading()
    for (let index = 0; index < 20; index += 1) {
      assert.equal(advanceCaravanClaim(state, frame({ looter: sample('raider', 2.5) })).plundered, null)
    }
    const step = advanceCaravanClaim(state, frame(breakWith(state)))
    assert.equal(state.looterId, null, `${name} did not end the channel`)
    if (name !== 'hit') assert.equal(step.broken, 'raider', `${name} was not reported`)
    // Nothing finishes afterwards, however long the same actor keeps standing there.
    for (let index = 0; index < 200; index += 1) {
      assert.equal(advanceCaravanClaim(state, frame({ looter: sample('raider', 2.5) })).plundered, null, name)
    }
  }

  // Negative control: the edge of the break range is still at the cart.
  const edge = loading()
  let finished = false
  for (let index = 0; index < 200 && !finished; index += 1) {
    finished = advanceCaravanClaim(edge, frame({ looter: sample('raider', CARAVAN_LOOT_BREAK_RANGE) })).plundered !== null
  }
  assert.equal(finished, true)
})

test('the claim goes to the robbing side that won the fight, and nobody else loads during it', () => {
  function fall(overrides: Partial<CaravanClaimInput>, hitAgo: number | null = null) {
    const state = createCaravanClaimState()
    advanceCaravanClaim(state, frame({ guarded: true, elapsed: 100 }))
    if (hitAgo !== null) noteCaravanEscortHit(state, 100 - hitAgo)
    const step = advanceCaravanClaim(state, frame({ elapsed: 100, escortFell: true, ...overrides }))
    return { state, step }
  }
  assert.equal(fall({ playerDistance: CARAVAN_CLAIM_RANGE - 0.1 }).step.claimOpened, true)
  assert.equal(fall({ playerDistance: CARAVAN_CLAIM_RANGE + 0.1 }).step.claimOpened, false)
  assert.equal(fall({ playerDistance: 40 }, CARAVAN_CLAIM_HIT_MEMORY - 0.5).step.claimOpened, true)
  assert.equal(fall({ playerDistance: 40 }, CARAVAN_CLAIM_HIT_MEMORY + 0.5).step.claimOpened, false)
  assert.equal(fall({ playerDistance: 2, playerRobs: false }).step.claimOpened, false,
    'the palace guard defends the cart; it has nothing to claim')
  assert.equal(fall({ playerDistance: 2, empty: true }).step.claimOpened, false)

  // An escort that walked off counts as well as one that fell.
  const walked = createCaravanClaimState()
  advanceCaravanClaim(walked, frame({ guarded: true }))
  assert.equal(advanceCaravanClaim(walked, frame({ playerDistance: 4 })).claimOpened, true)
  // A cart that was never guarded has no fight to have won.
  assert.equal(advanceCaravanClaim(createCaravanClaimState(), frame({ playerDistance: 4 })).claimOpened, false)

  const { state } = fall({ playerDistance: 6 })
  assert.equal(state.claim, CARAVAN_CLAIM_SECONDS)
  assert.ok(CARAVAN_CLAIM_SECONDS >= 8 && CARAVAN_CLAIM_SECONDS <= 10)
  let startedAt: number | null = null
  let seconds = 0
  for (let index = 0; index < 400 && startedAt === null; index += 1) {
    seconds += FRAME
    const step = advanceCaravanClaim(state, frame({ candidate: sample('raider', 1), playerDistance: 40 }))
    if (step.started) startedAt = seconds
  }
  assert.ok(startedAt !== null)
  assert.ok(startedAt >= CARAVAN_CLAIM_SECONDS - EPSILON, `a raider started loading ${String(startedAt)} s into the claim`)
  assert.ok(startedAt < CARAVAN_CLAIM_SECONDS + FRAME + EPSILON)
})

test('a claim opening on a cart already being loaded breaks that channel', () => {
  const state = createCaravanClaimState()
  // An escort is alive but off chasing somebody, so the cart is unguarded and a raider loads.
  advanceCaravanClaim(state, frame({ candidate: sample('raider', 2) }))
  advanceCaravanClaim(state, frame({ looter: sample('raider', 2) }))
  assert.equal(state.looterId, 'raider')
  const step = advanceCaravanClaim(state, frame({ escortFell: true, playerDistance: 5, looter: sample('raider', 2) }))
  assert.equal(step.claimOpened, true)
  assert.equal(step.broken, 'raider')
  assert.equal(state.looterId, null)

  // Negative control: the same fall with the player away leaves the channel running.
  const away = createCaravanClaimState()
  advanceCaravanClaim(away, frame({ candidate: sample('raider', 2) }))
  const kept = advanceCaravanClaim(away, frame({ escortFell: true, playerDistance: 30, looter: sample('raider', 2) }))
  assert.equal(kept.claimOpened, false)
  assert.equal(away.looterId, 'raider')
})

test('the HUD cue shows only a channel the player can see, with honest progress', () => {
  const state = loading()
  for (let index = 0; index < 35; index += 1) advanceCaravanClaim(state, frame({ looter: sample('raider', 2) }))
  const view = buildCaravanLootView(state, { playerDistance: 12.4, defend: false })
  assert.ok(view)
  assert.equal(view.looter, 'raider')
  assert.equal(view.defend, false)
  assert.equal(view.distance, 12)
  assert.ok(Math.abs(view.progress - 35 * FRAME / CARAVAN_LOOT_CHANNEL_SECONDS) < 1e-6)
  assert.equal(buildCaravanLootView(state, { playerDistance: CARAVAN_LOOT_CUE_RANGE + 1, defend: false }), null)
  assert.equal(cancelCaravanLoot(state), 'raider')
  assert.equal(buildCaravanLootView(state, { playerDistance: 2, defend: false }), null)
})

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

interface TestActor {
  id: string
  allegiance: Allegiance
  role: ActorRole
  mesh: THREE.Group
  alive: boolean
  hp: number
  maxHp: number
  hostileToPlayer: boolean
  playerAggro: boolean
  aggroMemory: number
  rageTimer: number
  retaliationTimer: number
  targetId: string | null
  action: null
  reaction: 'none' | 'flinch' | 'stagger'
  reactionRemaining: number
  poise: number
  maxPoise: number
  poiseRecoveryDelay: number
  staggerImmunity: number
  routTimer: number
  aiMode: 'normal' | 'captive' | 'attackEventProp'
  chargeWindup: number
  chargeTimer: number
  knockbackVelocity: THREE.Vector3
  lastHitDirection: THREE.Vector3
  velocity: THREE.Vector3
  retreatTimer: number
  healthBarVisibleUntil: number
  lastKnownTargetPos: THREE.Vector3 | null
  alertCooldown: number
  squadEligible: boolean
  budgetCategory: 'squad' | 'campaign' | 'chronicle' | 'ambient'
  eventOwnerId: string | null
  generatedRegionId: string | null
  generatedEncounterId: string | null
  generatedSpawnId: string | null
  order: null | { kind: string; position: THREE.Vector3; timer: number }
  home: THREE.Vector3
  wanderTarget: THREE.Vector3
  phase: number
}

function makeActor(
  id: string,
  allegiance: Allegiance,
  role: ActorRole,
  x: number,
  z: number,
  extra: Partial<TestActor> = {},
): TestActor {
  const mesh = new THREE.Group()
  mesh.position.set(x, 0, z)
  return {
    id, allegiance, role, mesh, alive: true, hp: 60, maxHp: 60,
    hostileToPlayer: false, playerAggro: false, aggroMemory: 0, rageTimer: 0, retaliationTimer: 0,
    targetId: null, action: null, reaction: 'none', reactionRemaining: 0,
    poise: 40, maxPoise: 40, poiseRecoveryDelay: 0, staggerImmunity: 0,
    routTimer: 0, aiMode: 'normal', chargeWindup: 0, chargeTimer: 0,
    knockbackVelocity: new THREE.Vector3(), lastHitDirection: new THREE.Vector3(), velocity: new THREE.Vector3(),
    retreatTimer: 0, healthBarVisibleUntil: 0, lastKnownTargetPos: null, alertCooldown: 0,
    squadEligible: false, budgetCategory: 'campaign', eventOwnerId: null,
    generatedRegionId: null, generatedEncounterId: null, generatedSpawnId: null,
    order: null, home: mesh.position.clone(), wanderTarget: mesh.position.clone(), phase: 0,
    ...extra,
  }
}

function companion(faction: Faction, id: string, x: number, z: number): TestActor {
  return makeActor(id, faction, 'soldier', x, z, { squadEligible: true, budgetCategory: 'squad' })
}

/** Engine plumbing shared by both carts: presentation, alerts and kills are sinks. */
function sinks(notices: string[], sounds: string[]) {
  return {
    paused: false,
    ended: false,
    finale: { identity: { regionId: 'finale', encounterId: 'finale', bossId: 'finale-boss', escortIds: [] } },
    doctrineEffects: { beastTruce: false },
    palette: { warning: new THREE.Color(0xfbbf24), bg: new THREE.Color(0x292929) },
    screenShakeEnabled: true,
    reducedMotion: false,
    callbacks: { onNotice: (message: string) => notices.push(message) },
    resumeAudio() {},
    emitView() {},
    playSound(cue: string) { sounds.push(cue) },
    announceSighting() {},
    alertNearbyAllies() {},
    getSecondaryEffects: () => ({ emit() {} }),
    createBloodBurst() {},
    createHitParticles() {},
    drawActorHealthBar() {},
    releaseActorTelegraph() {},
    interruptFinaleAttack() {},
    presentCombatFeedback() {},
    killActor(actor: TestActor) { actor.alive = false },
  }
}

function roadCart(faction: Faction, playerDistance = 30) {
  const player = new THREE.Group()
  player.position.set(playerDistance, 0, 0)
  const caravan = new THREE.Group()
  const escorts = [
    makeActor('escort-a', 'guard', 'soldier', 2, 1, { hostileToPlayer: faction !== 'guard' }),
    makeActor('escort-b', 'guard', 'soldier', -2, -1, { hostileToPlayer: faction !== 'guard' }),
  ]
  const actors: TestActor[] = [...escorts]
  const notices: string[] = []
  const sounds: string[] = []
  const tally = { robbed: 0, ambushes: 0 }
  const engine: object = Object.assign(Object.create(GameEngine.prototype), sinks(notices, sounds), {
    faction,
    player,
    caravan,
    actors,
    caravanEscortIds: escorts.map((escort) => escort.id),
    caravanEscortRespawnAt: 0,
    caravanPanicTimer: 0,
    caravanCooldown: 0,
    caravanRobbedFlash: 0,
    caravanDefenseCredit: false,
    caravanAidCooldown: 0,
    elapsed: 100,
    gold: 0,
    health: 50,
    maxHealth: 100,
    activeEvents: [],
    achievements: { recordGoldEarned() {}, recordCaravanRobbed: () => { tally.robbed += 1 } },
    handleGeneratedInteraction: () => false,
    generatedInteraction: () => ({ site: null, node: null, kind: 'caravan', targetsObjective: false }),
    spawnAmbush: () => { tally.ambushes += 1 },
    spawnCaravanEscort() {},
  })
  return { engine, player, caravan, escorts, actors, notices, sounds, tally }
}

/** `update()`'s own bookkeeping for the road cart, without the rest of the world. */
function advance(engine: object, seconds: number): void {
  const frames = Math.round(seconds / FRAME)
  for (let index = 0; index < frames; index += 1) {
    Reflect.set(engine, 'elapsed', (Reflect.get(engine, 'elapsed') as number) + FRAME)
    Reflect.set(engine, 'caravanCooldown', Math.max(0, (Reflect.get(engine, 'caravanCooldown') as number) - FRAME))
    invoke(engine, 'updateCaravanEscort', FRAME, 'region-road', true)
  }
}

function roadClaim(engine: object): CaravanClaimState {
  const site = Reflect.get(engine, 'ordinaryCaravanLootSite') as { claim: CaravanClaimState } | null
  assert.ok(site, 'the road cart has no claim state; updateCaravanEscort never ran')
  return site.claim
}

function fell(escorts: readonly TestActor[]): void {
  for (const escort of escorts) {
    escort.alive = false
    escort.hp = 0
  }
}

function hit(engine: object, target: TestActor, faction: Faction, options: {
  damage?: number
  byPlayer?: boolean
  attackKind?: string
  knockback?: number
  sourceActorId?: string
} = {}) {
  const player = Reflect.get(engine, 'player') as THREE.Group
  return invoke(engine, 'damageActor', target, options.damage ?? 6, player.position.clone(), faction,
    options.byPlayer ?? true, {
      attackKind: options.attackKind ?? 'melee',
      knockback: options.knockback ?? 0,
      ...(options.sourceActorId ? { sourceActorId: options.sourceActorId } : {}),
    })
}

test('the squad kills the escorts and the player arrives two seconds later: E pays out', () => {
  for (const faction of ['elf', 'villain'] as const) {
    const value = roadCart(faction)
    const ally = companion(faction, 'companion', 1.6, 0)
    value.actors.push(ally)
    advance(value.engine, FRAME)
    // The squad's kill: the player is 30 m away and never touched an escort.
    fell(value.escorts)
    advance(value.engine, 2)
    assert.equal(roadClaim(value.engine).looterId, null, `${faction}: a companion started loading`)
    assert.equal(Reflect.get(value.engine, 'caravanCooldown'), 0)
    value.player.position.set(3, 0, 0)
    assert.equal(invoke<string>(value.engine, 'getGeneratedPrompt'), '[E] ГРАБИТЬ КОРОВАН')
    invoke(value.engine, 'interact')
    assert.equal(Reflect.get(value.engine, 'gold'), 95, `${faction}: the robbery did not pay`)
    assert.equal(value.tally.robbed, 1)
    assert.equal(value.tally.ambushes, 1)
    assert.equal(Reflect.get(value.engine, 'caravanRobbedBy'), 'player')
    assert.equal(invoke<string>(value.engine, 'getGeneratedPrompt'), describeCaravanEmptyPrompt('player'))
  }

  // Negative control: the same actor on the same spot, just not in the squad, is a looter —
  // so the harness would have exposed a companion taking the cart.
  const control = roadCart('elf')
  const stranger = makeActor('stranger', 'elf', 'soldier', 1.6, 0)
  control.actors.push(stranger)
  advance(control.engine, FRAME)
  fell(control.escorts)
  advance(control.engine, 2)
  assert.equal(roadClaim(control.engine).looterId, 'stranger')
  advance(control.engine, 2)
  assert.equal(Reflect.get(control.engine, 'caravanRobbedBy'), 'raider')
  control.player.position.set(3, 0, 0)
  invoke(control.engine, 'interact')
  assert.equal(Reflect.get(control.engine, 'gold'), 0)
  assert.equal(control.notices.at(-1), describeCaravanAlreadyRobbed('raider'))
})

test("companions never load a road cart, however long they stand at it", () => {
  for (const faction of ['elf', 'villain'] as const) {
    const value = roadCart(faction)
    const squad = [companion(faction, 'c1', 1, 0), companion(faction, 'c2', 0, 2), companion(faction, 'c3', -2.5, 0)]
    value.actors.push(...squad)
    fell(value.escorts)
    for (let second = 0; second < 30; second += 1) {
      advance(value.engine, 1)
      assert.equal(roadClaim(value.engine).looterId, null, `${faction} squad loaded at ${String(second)} s`)
    }
    assert.equal(Reflect.get(value.engine, 'caravanCooldown'), 0)
    assert.equal(value.notices.some((notice) => notice.includes('без пользователя')), false)
    // The driver still bolts from them: panic is about knives, not about whose they are.
    assert.ok(Reflect.get(value.engine, 'caravanPanicTimer') as number > 0)

    // Negative control: demote one of them out of the squad and it loads on the next frame.
    squad[0].budgetCategory = 'campaign'
    advance(value.engine, FRAME)
    assert.equal(roadClaim(value.engine).looterId, 'c1')
  }
})

test("a raider's channel broken by the player's blow takes nothing, and the player can still rob", () => {
  const blows: Array<[string, Parameters<typeof hit>[3]]> = [
    ['jab', {}],
    ['finisher stagger and knockback', { attackKind: 'finisher', knockback: 2.6 }],
    ['kill', { damage: 200 }],
    ['arrow', { attackKind: 'arrow' }],
  ]
  for (const [name, blow] of blows) {
    const value = roadCart('elf')
    const raider = makeActor('raider', 'villain', 'soldier', 2, 0, { hostileToPlayer: true })
    value.actors.push(raider)
    fell(value.escorts)
    advance(value.engine, 1.5)
    assert.equal(roadClaim(value.engine).looterId, 'raider', name)
    const cue = invoke<CaravanLootView | null>(value.engine, 'buildCaravanLootCue')
    assert.ok(cue && cue.progress > 0.3 && cue.progress < 0.5 && cue.defend === false, name)

    hit(value.engine, raider, 'elf', blow)
    assert.equal(roadClaim(value.engine).looterId, null, `${name} did not break the channel`)
    assert.equal(value.notices.at(-1), describeCaravanLootInterrupted(false), name)
    advance(value.engine, 5)
    assert.equal(Reflect.get(value.engine, 'caravanCooldown'), 0, `${name}: the cart was taken anyway`)
    assert.equal(value.notices.includes(describeCaravanPlundered(false)), false, name)
    value.player.position.set(3, 0, 0)
    invoke(value.engine, 'interact')
    assert.equal(Reflect.get(value.engine, 'gold'), 95, name)
  }

  // Somebody else's blow breaks it as well, without the player's line.
  const other = roadCart('elf')
  const looter = makeActor('raider', 'villain', 'soldier', 2, 0, { hostileToPlayer: true })
  const patrol = makeActor('patrol', 'guard', 'soldier', 3, 0)
  other.actors.push(looter, patrol)
  fell(other.escorts)
  advance(other.engine, 1)
  hit(other.engine, looter, 'guard', { byPlayer: false, sourceActorId: patrol.id })
  assert.equal(roadClaim(other.engine).looterId, null)
  assert.equal(other.notices.includes(describeCaravanLootInterrupted(false)), false)

  // Negative control: the same scene without the blow loses the cart.
  const control = roadCart('elf')
  control.actors.push(makeActor('raider', 'villain', 'soldier', 2, 0, { hostileToPlayer: true }))
  fell(control.escorts)
  advance(control.engine, 5)
  assert.equal(Reflect.get(control.engine, 'caravanRobbedBy'), 'raider')
  assert.ok(control.notices.includes(describeCaravanPlundered(false)))
})

test('an uninterrupted channel plunders only once it completes, and the prompt says who took the cart', () => {
  for (const [role, allegiance, kind] of [
    ['soldier', 'villain', 'raider'],
    ['wolf', 'beast', 'beast'],
  ] as const) {
    const value = roadCart('elf')
    value.actors.push(makeActor('looter', allegiance, role, 2, 0, { hostileToPlayer: true }))
    fell(value.escorts)
    advance(value.engine, FRAME)
    assert.equal(roadClaim(value.engine).looterId, 'looter')
    // The shipped rule emptied the cart on this frame.
    assert.equal(Reflect.get(value.engine, 'caravanCooldown'), 0)
    advance(value.engine, CARAVAN_LOOT_CHANNEL_SECONDS - 2 * FRAME)
    assert.equal(Reflect.get(value.engine, 'caravanCooldown'), 0, `${kind}: plundered before the channel finished`)
    advance(value.engine, 3 * FRAME)
    assert.ok((Reflect.get(value.engine, 'caravanCooldown') as number) > 50, `${kind}: the channel never finished`)
    assert.equal(Reflect.get(value.engine, 'caravanRobbedBy'), kind)
    assert.ok(value.notices.includes(describeCaravanPlundered(kind === 'beast')))
    value.player.position.set(3, 0, 0)
    assert.equal(invoke<string>(value.engine, 'getGeneratedPrompt'), describeCaravanEmptyPrompt(kind))
    invoke(value.engine, 'interact')
    assert.equal(value.notices.at(-1), describeCaravanAlreadyRobbed(kind))
    assert.equal(Reflect.get(value.engine, 'gold'), 0)
  }
  // After a continue the engine no longer knows who did it, and says only what is true.
  assert.equal(describeCaravanEmptyPrompt(null), 'Корован уже ограбили')
})

test('the cart stands still while it is loaded, so the channel can be reached', () => {
  const value = roadCart('elf')
  Object.assign(value.engine, {
    generatedRegionIdAt: () => 'region-road',
    generatedCaravanPatrolReady: true,
    simulatedGeneratedRegions: new Set(['region-road']),
    generatedCaravanPatrolStart: new THREE.Vector3(-200, 0, 0),
    generatedCaravanPatrolEnd: new THREE.Vector3(200, 0, 0),
    caravanDirection: 1,
    getNavigationWaypoint: () => null,
    moveCharacter(position: THREE.Vector3, dx: number, dz: number) {
      position.x += dx
      position.z += dz
      return false
    },
    groundHeightAt: () => 0,
  })
  const raider = makeActor('raider', 'villain', 'soldier', 2, 0, { hostileToPlayer: true })
  value.actors.push(raider)
  fell(value.escorts)
  invoke(value.engine, 'updateCaravan', FRAME)
  assert.equal(roadClaim(value.engine).looterId, 'raider')
  const parked = value.caravan.position.clone()
  for (let index = 0; index < 20; index += 1) invoke(value.engine, 'updateCaravan', FRAME)
  assert.equal(value.caravan.position.distanceTo(parked), 0)
  // Negative control: break the channel and the same call moves the cart again.
  hit(value.engine, raider, 'elf')
  invoke(value.engine, 'updateCaravan', FRAME)
  assert.ok(value.caravan.position.distanceTo(parked) > 0.1)
})

test('a palace guard who knocks a looter off the cart has defended it, and is paid for that once', () => {
  const value = roadCart('guard', 5)
  const raider = makeActor('raider', 'elf', 'soldier', 2, 0, { hostileToPlayer: true })
  value.actors.push(raider)
  advance(value.engine, FRAME)
  // The guard stands 5 m away when the last escort falls: a defender gets no claim, the
  // raider starts loading at once, and the moment to defend is now.
  fell(value.escorts)
  advance(value.engine, 1)
  assert.equal(roadClaim(value.engine).looterId, 'raider')
  assert.equal(value.notices.includes(CARAVAN_CLAIM_NOTICE), false)
  assert.equal(invoke<string>(value.engine, 'getGeneratedPrompt'), '', 'the cue speaks; the prompt must not say «под охраной»')
  assert.equal(invoke<CaravanLootView | null>(value.engine, 'buildCaravanLootCue')?.defend, true)
  assert.equal(Reflect.get(value.engine, 'caravanDefenseCredit'), false)

  hit(value.engine, raider, 'guard')
  assert.equal(roadClaim(value.engine).looterId, null)
  assert.equal(Reflect.get(value.engine, 'caravanDefenseCredit'), true)
  assert.equal(value.notices.at(-1), describeCaravanLootInterrupted(true))
  value.player.position.set(3, 0, 0)
  invoke(value.engine, 'interact')
  assert.equal(Reflect.get(value.engine, 'health'), 58)
  invoke(value.engine, 'interact')
  assert.equal(Reflect.get(value.engine, 'health'), 58, 'the aid is still bounded by its cooldown')

  // Negative control 1: a blow from somebody else saves the cart but earns the guard nothing.
  const helped = roadCart('guard')
  const looter = makeActor('raider', 'elf', 'soldier', 2, 0, { hostileToPlayer: true })
  const patrol = makeActor('patrol', 'guard', 'soldier', 3, 0)
  helped.actors.push(looter, patrol)
  fell(helped.escorts)
  advance(helped.engine, 1)
  hit(helped.engine, looter, 'guard', { byPlayer: false, sourceActorId: patrol.id })
  assert.equal(roadClaim(helped.engine).looterId, null)
  assert.equal(Reflect.get(helped.engine, 'caravanDefenseCredit'), false)

  // Negative control 2: nobody intervenes, the cart is lost, and the guard is told so.
  const lost = roadCart('guard')
  lost.actors.push(makeActor('raider', 'elf', 'soldier', 2, 0, { hostileToPlayer: true }))
  fell(lost.escorts)
  advance(lost.engine, 5)
  assert.equal(Reflect.get(lost.engine, 'caravanDefenseCredit'), false)
  lost.player.position.set(3, 0, 0)
  assert.equal(invoke<string>(lost.engine, 'getGeneratedPrompt'), describeCaravanEmptyPrompt('raider'))
})

test('a player who hit an escort, or stood by when it fell, keeps the cart for the claim window', () => {
  function scene(options: { hitEscort: boolean; playerDistance: number }) {
    const value = roadCart('elf', options.playerDistance)
    const raider = makeActor('raider', 'villain', 'soldier', 2, 0, { hostileToPlayer: true })
    value.actors.push(raider)
    advance(value.engine, FRAME)
    if (options.hitEscort) hit(value.engine, value.escorts[0], 'elf')
    advance(value.engine, 3)
    fell(value.escorts)
    advance(value.engine, FRAME)
    return value
  }

  for (const [name, options] of [
    ['hit an escort 3 s earlier, from 20 m', { hitEscort: true, playerDistance: 20 }],
    ['stood 8 m away', { hitEscort: false, playerDistance: 8 }],
  ] as const) {
    const value = scene(options)
    assert.ok(value.notices.includes(CARAVAN_CLAIM_NOTICE), `${name}: no claim`)
    for (let second = 0; second < CARAVAN_CLAIM_SECONDS - 1; second += 1) {
      advance(value.engine, 1)
      assert.equal(roadClaim(value.engine).looterId, null, `${name}: a raider loaded ${String(second)} s into the claim`)
    }
    // Five seconds after the fall the player walks up and takes it.
    value.player.position.set(3, 0, 0)
    invoke(value.engine, 'interact')
    assert.equal(Reflect.get(value.engine, 'gold'), 95, name)
  }

  // The claim is a window, not a lock: a player who never comes still loses the cart.
  const absent = scene({ hitEscort: true, playerDistance: 20 })
  advance(absent.engine, CARAVAN_CLAIM_SECONDS + 0.2)
  assert.equal(roadClaim(absent.engine).looterId, 'raider')
  advance(absent.engine, CARAVAN_LOOT_CHANNEL_SECONDS + 0.1)
  assert.equal(Reflect.get(absent.engine, 'caravanRobbedBy'), 'raider')

  // Negative control: no hit and 20 m away — the raider loads on the first unguarded frame.
  const control = scene({ hitEscort: false, playerDistance: 20 })
  assert.equal(control.notices.includes(CARAVAN_CLAIM_NOTICE), false)
  assert.equal(roadClaim(control.engine).looterId, 'raider')
})

// ---------------------------------------------------------------------------
// The chronicle's ambushed cart
// ---------------------------------------------------------------------------

function chronicleAmbush(faction: Faction, owner: Faction, defender: Faction, playerDistance = 40) {
  const player = new THREE.Group()
  player.position.set(playerDistance, 0, 0)
  const actors: TestActor[] = []
  const notices: string[] = []
  const sounds: string[] = []
  const tally = { robbed: 0, gold: 0, worldEvents: [] as Array<[string, boolean]> }
  const chronicleState: ChronicleState = createChronicleState()
  chronicleState.caravans.push({
    id: 'caravan-test', ownerFaction: owner, fromSiteId: 'site-a', toSiteId: 'site-b',
    regionPath: ['region-a', 'region-b'], progress: 0.5, intact: true,
  } as ChronicleState['caravans'][number])
  const engine: object = Object.assign(Object.create(GameEngine.prototype), sinks(notices, sounds), {
    faction,
    player,
    actors,
    activeEvents: [],
    eventSequence: 0,
    actorSequence: 0,
    elapsed: 50,
    gold: 0,
    scene: new THREE.Scene(),
    locatedEventCopy: new Map(),
    materializedSituationIds: new Set(),
    eventPropTargets: new Map(),
    chronicleState,
    chronicleRegions: new Map(),
    achievements: {
      recordGoldEarned: (amount: number) => { tally.gold += amount },
      recordCaravanRobbed: () => { tally.robbed += 1 },
      recordWorldEvent: (kind: string, succeeded: boolean) => { tally.worldEvents.push([kind, succeeded]) },
    },
    pickLocatedEventPosition: () => new THREE.Vector3(0, 0, 0),
    reserveActorSlots: () => true,
    createCaravan: () => {
      const cart = new THREE.Group()
      const cargo = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
      cargo.name = 'cargo'
      cart.add(cargo)
      return cart
    },
    groundHeightAt: () => 0,
    registerNamedInteractableOutline() {},
    clampWorldPosition() {},
    spawnActor(allegiance: Allegiance, role: ActorRole, x: number, z: number, index: number,
      options: { budget: TestActor['budgetCategory']; eventOwnerId: string; generatedRegionId: string }) {
      const actor = makeActor(`located-${String(index)}`, allegiance, role, x, z, {
        budgetCategory: options.budget,
        eventOwnerId: options.eventOwnerId,
        generatedRegionId: options.generatedRegionId,
        hostileToPlayer: areAllegiancesHostile(allegiance, faction),
      })
      actors.push(actor)
      return actor
    },
    locatedCopyContext: () => ({ regionLabel: 'B2', siteLabel: null, faction: owner, defender }),
    spawnEventLoot() {},
    removeEventParticles() {},
    removeAndDisposeObject() {},
    handleChronicleEvents() {},
    removeActorById(actorId: string) {
      const index = actors.findIndex((actor) => actor.id === actorId)
      if (index >= 0) actors.splice(index, 1)
    },
    focusCaravanBeatChoice: () => false,
  })
  const situation: PendingMaterialization = {
    id: 'ambush:caravan-test', kind: 'caravanAmbush', regionId: 'region-b', sourceRegionId: null,
    siteId: 'site-b', faction: owner, defender, caravanId: 'caravan-test', beastPressure: 0, urgency: 0.6,
  }
  const event = invoke<{
    state: 'active' | 'succeeded' | 'failed'
    update(delta: number): void
    handBack(): Array<{ kind: string }>
    lootSite?: { claim: CaravanClaimState; defend: boolean }
  } | null>(engine, 'startCaravanAmbushEvent', situation)
  assert.ok(event)
  ;(Reflect.get(engine, 'activeEvents') as unknown[]).push(event)
  const escorts = actors.filter((actor) => actor.allegiance === owner)
  const raiders = actors.filter((actor) => actor.allegiance !== owner)
  assert.equal(escorts.length, 2)
  assert.equal(raiders.length, 2)
  // Raiders spawn chasing a hostile player. The live AI drops that chase once the player is
  // past a soldier's 33.75 m leash; with no AI running here, do what it would have done.
  if (playerDistance > 34) for (const raider of raiders) raider.playerAggro = false
  function run(seconds: number): void {
    const frames = Math.round(seconds / FRAME)
    for (let index = 0; index < frames && event?.state === 'active'; index += 1) {
      Reflect.set(engine, 'elapsed', (Reflect.get(engine, 'elapsed') as number) + FRAME)
      event?.update(FRAME)
    }
  }
  return { engine, event, player, actors, escorts, raiders, notices, tally, chronicleState, run }
}

test('chronicle raiders who outlive the escort must still load the cart, over a channel', () => {
  const value = chronicleAmbush('elf', 'guard', 'villain')
  value.run(FRAME)
  fell(value.escorts)
  value.run(FRAME)
  // The shipped rule failed the event on this frame, wherever the raiders stood.
  assert.equal(value.event.state, 'active')
  value.run(2)
  assert.equal(value.event.state, 'active', 'nobody stood at the cart, so nothing was taken')
  // Idle raiders are sent at the cart, aimed past it so they arrive at the tailgate.
  for (const raider of value.raiders) {
    assert.equal(raider.order?.kind, 'assault')
    const post = raider.order!.position
    assert.ok(Math.hypot(post.x, post.z) > 2 && Math.hypot(post.x, post.z) < 2.4)
    assert.ok(post.x * raider.mesh.position.x + post.z * raider.mesh.position.z < 0,
      'the post must lie beyond the cart from the raider')
  }
  value.raiders[0].mesh.position.set(1.5, 0, 0)
  value.run(FRAME)
  assert.equal(value.event.lootSite?.claim.looterId, value.raiders[0].id)
  value.run(CARAVAN_LOOT_CHANNEL_SECONDS - 3 * FRAME)
  assert.equal(value.event.state, 'active')
  value.run(4 * FRAME)
  assert.equal(value.event.state, 'failed')
  const outcome = value.event.handBack()
  assert.deepEqual(outcome.map((entry) => entry.kind), ['caravanLost'])
  invoke(value.engine, 'finishEvent', value.event, false)
  assert.equal(value.tally.robbed, 0)
  assert.deepEqual(value.tally.worldEvents, [['caravanAmbush', false]])
})

test("a chronicle raider's channel breaks on the player's blow, and the player keeps a won cart", () => {
  const interrupted = chronicleAmbush('elf', 'guard', 'villain')
  interrupted.run(FRAME)
  fell(interrupted.escorts)
  interrupted.raiders[0].mesh.position.set(1.5, 0, 0)
  interrupted.run(1)
  assert.equal(interrupted.event.lootSite?.claim.looterId, interrupted.raiders[0].id)
  // An elf's arrow from 40 m is as good a blow as any.
  hit(interrupted.engine, interrupted.raiders[0], 'elf', { attackKind: 'arrow' })
  assert.equal(interrupted.event.lootSite?.claim.looterId, null)
  interrupted.run(6)
  assert.equal(interrupted.event.state, 'active')

  // Raiders on the player's own side (a villain robbing a guard cart beside villain
  // raiders) cannot be hit — the claim is what keeps the cart the player's.
  const won = chronicleAmbush('villain', 'guard', 'villain', 6)
  won.run(FRAME)
  hit(won.engine, won.escorts[0], 'villain')
  fell(won.escorts)
  won.raiders[0].mesh.position.set(1.5, 0, 0)
  won.run(FRAME)
  assert.ok(won.notices.includes(CARAVAN_CLAIM_NOTICE))
  won.run(CARAVAN_CLAIM_SECONDS - 1)
  assert.equal(won.event.lootSite?.claim.looterId, null)
  won.player.position.set(2, 0, 0)
  invoke(won.engine, 'interact')
  assert.equal(won.event.state, 'succeeded')
  invoke(won.engine, 'finishEvent', won.event, true)
  invoke(won.engine, 'finishEvent', won.event, true)
  assert.equal(won.tally.robbed, 1, 'a chronicle robbery counts once toward «Грабить корованы»')
  assert.equal(won.tally.gold, 140)
  assert.deepEqual(won.tally.worldEvents, [['caravanAmbush', true]])

  // Negative control: the same allied raiders with the player far away take it.
  const lost = chronicleAmbush('villain', 'guard', 'villain')
  lost.run(FRAME)
  fell(lost.escorts)
  lost.raiders[0].mesh.position.set(1.5, 0, 0)
  lost.run(CARAVAN_LOOT_CHANNEL_SECONDS + 0.2)
  assert.equal(lost.event.state, 'failed')
})

test('companions never load a chronicle cart either', () => {
  const value = chronicleAmbush('elf', 'guard', 'villain')
  const squad = [companion('elf', 'c1', 1, 0), companion('elf', 'c2', -1, 0)]
  value.actors.push(...squad)
  value.run(FRAME)
  fell(value.escorts)
  for (const raider of value.raiders) raider.alive = false
  value.run(20)
  assert.equal(value.event.state, 'active')
  assert.equal(value.event.lootSite?.claim.looterId, null)

  // Negative control: a raider of the event on the same spot does load.
  value.raiders[0].alive = true
  value.raiders[0].mesh.position.set(1, 0, 1)
  value.run(FRAME)
  assert.equal(value.event.lootSite?.claim.looterId, value.raiders[0].id)
})

test("a chronicle ambush of the player's own side's cart is defended, never robbed", () => {
  // W1-2 backlog: the palace guard stood beside a guard cart and was offered «Забрать груз».
  const value = chronicleAmbush('guard', 'guard', 'villain', 6)
  const event = value.event as typeof value.event & {
    onInteract(): boolean
    getPrompt(): string | null
    target: number
    playerContributed?: boolean
  }
  assert.equal(event.lootSite?.defend, true)
  assert.equal(event.target, value.raiders.length)
  value.run(FRAME)
  value.player.position.set(2, 0, 0)
  assert.equal(event.onInteract(), false, 'there is nothing for the guard to take')
  assert.equal(event.getPrompt(), CARAVAN_AMBUSH_DEFENCE_PROMPT)
  assert.equal(event.state, 'active')
  for (const raider of value.raiders) {
    raider.alive = false
    raider.hp = 0
  }
  value.run(FRAME)
  assert.equal(event.state, 'succeeded')
  assert.deepEqual(event.handBack(), [], 'a defended cart rolls on with its cargo')
  assert.equal(value.chronicleState.caravans.length, 1)
  event.playerContributed = true
  invoke(value.engine, 'finishEvent', event, true)
  assert.equal(value.tally.gold, 90, 'the owners pay the defenders, less than the cargo is worth')
  assert.equal(value.tally.robbed, 0, 'a defence is not a robbery')
  assert.ok(value.notices.some((notice) => notice.includes('Корован отбит')))

  // Lost the other way: the escort falls, nobody stops a raider, the cart is gone.
  const lost = chronicleAmbush('guard', 'guard', 'villain')
  lost.run(FRAME)
  fell(lost.escorts)
  lost.raiders[0].mesh.position.set(1.5, 0, 0)
  lost.run(CARAVAN_LOOT_CHANNEL_SECONDS + 0.2)
  assert.equal(lost.event.state, 'failed')
  assert.deepEqual(lost.event.handBack().map((entry) => entry.kind), ['caravanLost'])

  // Negative control: an elf at the same guard cart takes the cargo, as before.
  const robbed = chronicleAmbush('elf', 'guard', 'villain', 6)
  const robbedEvent = robbed.event as typeof robbed.event & { onInteract(): boolean }
  assert.equal(robbed.event.lootSite?.defend, false)
  robbed.run(FRAME)
  hit(robbed.engine, robbed.escorts[0], 'elf')
  fell(robbed.escorts)
  robbed.run(FRAME)
  robbed.player.position.set(2, 0, 0)
  assert.equal(robbedEvent.onInteract(), true)
  assert.equal(robbed.event.state, 'succeeded')
  invoke(robbed.engine, 'finishEvent', robbed.event, true)
  assert.equal(robbed.tally.gold, 140)
  assert.equal(robbed.tally.robbed, 1)

  // The guard at an enemy's cart raids it for the palace: same 140, a confiscation in words.
  const raid = chronicleAmbush('guard', 'elf', 'villain', 6)
  const raidEvent = raid.event as typeof raid.event & { onInteract(): boolean; getPrompt(): string | null }
  assert.equal(raid.event.lootSite?.defend, false)
  raid.run(FRAME)
  hit(raid.engine, raid.escorts[0], 'guard')
  fell(raid.escorts)
  raid.run(FRAME)
  raid.player.position.set(2, 0, 0)
  assert.equal(raidEvent.getPrompt(), CARAVAN_CONFISCATE_PROMPT)
  assert.equal(raidEvent.onInteract(), true)
  invoke(raid.engine, 'finishEvent', raid.event, true)
  assert.equal(raid.tally.gold, 140)
  assert.ok(raid.notices.includes(CARAVAN_AMBUSH_CONFISCATED_OUTCOME))
})