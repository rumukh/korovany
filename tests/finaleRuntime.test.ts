import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import * as THREE from 'three'
import { AchievementTracker } from '../src/game/achievements.ts'
import { createGeneratedEncounterPlans } from '../src/game/content/registry.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { createDoctrineRunState, resolveDoctrineEffects } from '../src/game/run/doctrine.ts'
import type { ActiveRunSaveV3 } from '../src/game/run/runTypes.ts'
import { finalizeRunSnapshot, parseActiveRunSaveV3, type StorageLike } from '../src/game/run/storage.ts'
import { CollisionWorld } from '../src/game/systems/CollisionWorld.ts'
import { actorSpeedForRole, createHealthyBody, type ActorRole, type Faction } from '../src/game/types.ts'
import { ActorBudget } from '../src/game/world/ActorBudget.ts'
import { createCampaignContractState, createChronicleCommitmentState, createGeneratedObjectives } from '../src/game/world/CampaignDirector.ts'
import { buildFinaleView, buildInitialGameView } from '../src/game/world/CampaignView.ts'
import { createChronicleRegions, createChronicleState } from '../src/game/world/Chronicle.ts'
import {
  advanceFinale, captureFinaleBody, createFinaleIdentity, createFinaleState,
  finaleSavedBody, normalizeFinaleState, serializeFinaleState,
  type FinaleAction, type FinaleAttackId,
} from '../src/game/world/FinaleDirector.ts'
import { RegionManager } from '../src/game/world/RegionManager.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { createPlayerMeleeState, type CombatOutcome } from '../src/game/world/CombatResolver.ts'
import {
  advanceCombatMastery, beginEvade, createCombatMasteryState, normalizeCombatMastery,
} from '../src/game/world/CombatMastery.ts'
import { createSquadCommandState } from '../src/game/world/SquadCommand.ts'
import { ExpeditionPlanner } from '../src/game/world/ExpeditionPlanner.ts'

// The browser build resolves extensionless imports. Use Node's existing resolver hook
// to execute the very same engine methods, rather than copying an adapter into a test.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')

function invoke<T = void>(engine: object, method: string, ...args: unknown[]): T {
  const callable: unknown = Reflect.get(engine, method)
  assert.equal(typeof callable, 'function', `${method} must be a production engine method`)
  return Reflect.apply(callable as (...values: unknown[]) => T, engine, args)
}

function makeActor(id: string, faction: Faction, role: ActorRole, x: number, z: number) {
  const mesh = new THREE.Group()
  mesh.position.set(x, 0, z)
  return {
    id, allegiance: faction, role, mesh,
    hp: 100, maxHp: 100, alive: true, speed: actorSpeedForRole(role),
    home: mesh.position.clone(), wanderTarget: mesh.position.clone(),
    targetId: null, aiMode: 'normal', eventOwnerId: null, action: null,
    reaction: 'none', reactionRemaining: 0, poise: 72, maxPoise: 72,
    poiseRecoveryDelay: 0, staggerImmunity: 0, attackCooldown: 0,
    retreatTimer: 0, alertCooldown: 10, velocity: new THREE.Vector3(),
    knockbackVelocity: new THREE.Vector3(), lastHitDirection: new THREE.Vector3(0, 0, 1),
    deathStartPosition: new THREE.Vector3(), deathStartRotation: new THREE.Euler(),
    deathAt: null, deathStyle: null, healthBar: new THREE.Sprite(),
    healthBarTexture: new THREE.Texture(), healthBarVisibleUntil: 0,
    generatedRegionId: null as string | null,
    generatedEncounterId: null as string | null,
    generatedSpawnId: null as string | null,
    generatedObjectiveId: null as string | null,
    generatedUnique: false, hostileToPlayer: true, squadEligible: false,
    objectiveEligible: false, budgetCategory: 'campaign', squadSlot: null as number | null,
    chargeTimer: 0,
  }
}

function fixture(faction: Faction = 'guard') {
  const blueprint = generateWorld(20260905)
  const identity = createFinaleIdentity(blueprint, faction)
  const finale = createFinaleState(identity)
  const player = new THREE.Group()
  player.position.set(identity.arena.x, 0, identity.arena.z + 3)
  const regions = new RegionManager(blueprint)
  regions.update(identity.regionId)
  const collision = new CollisionWorld({ sampleHeight: () => 0 }, { worldBounds: blueprint.bounds })
  const generatedWorld = {
    bounds: blueprint.bounds, regions, collision,
    getRegionIdAt: (x: number, z: number) => regions.layout.regions.find((region) =>
      x >= region.bounds.minX && x <= region.bounds.maxX && z >= region.bounds.minZ && z <= region.bounds.maxZ)?.id,
    getRegionBounds: (id: string) => regions.layout.regions.find((region) => region.id === id)?.bounds,
    sampleHeight: () => 0,
    getBiomeAt: () => 'fort',
    getSitePosition: () => ({ ...identity.arena, y: 0 }),
  }
  const objectives = createGeneratedObjectives(blueprint, faction)
  for (const objective of objectives) if (objective.id !== identity.objectiveId) objective.done = true
  const plans = Object.values(createGeneratedEncounterPlans(blueprint, faction))
  const finalPlan = plans.find((plan) => plan.encounterId === identity.encounterId)!
  const boss = makeActor(`generated:${identity.bossId}`, identity.enemyFaction, finalPlan.spawns[0].role, identity.arena.x, identity.arena.z)
  Object.assign(boss, {
    generatedRegionId: identity.regionId, generatedEncounterId: identity.encounterId,
    generatedSpawnId: identity.bossId, generatedObjectiveId: identity.objectiveId,
    generatedUnique: true, objectiveEligible: true,
  })
  captureFinaleBody(finale, identity.bossId, {
    health: boss.hp, maxHealth: boss.maxHp, x: boss.mesh.position.x, z: boss.mesh.position.z, heading: 0, cooldown: 0,
  })
  finale.introduced = true
  finale.suspended = false
  const actors = [boss]
  const notices: string[] = []
  const ends: string[] = []
  const drops: unknown[] = []
  const achievementStorage = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, value: {
      getItem: (key: string) => achievementStorage.get(key) ?? null,
      setItem: (key: string, value: string) => { achievementStorage.set(key, value) },
    },
  })
  const achievements = new AchievementTracker()
  achievements.beginRun(faction, 'fort', `finale-test-${faction}`)
  const config = { seed: blueprint.seed, generatorVersion: blueprint.generatorVersion, faction, selectedBoonId: 'provisions' }
  const combatMastery = createCombatMasteryState()
  const melee = createPlayerMeleeState()
  const squadCommand = createSquadCommandState({ x: player.position.x, z: player.position.z, heading: 0 }, false)
  const expeditionPlanner = new ExpeditionPlanner(blueprint)
  const engine: object = Object.create(GameEngine.prototype)
  Object.assign(engine, {
    faction, generatedBlueprint: blueprint, generatedWorld,
    generatedRun: { config, runId: `finale-test-${faction}`, startedAt: '2026-09-05T10:00:00.000Z' },
    finale, actors, player, objectives, achievements, scene: new THREE.Scene(),
    finaleTelegraphs: [], finaleTelegraphAction: null, telegraphPool: [],
    projectiles: [], projectileSourcesToClear: new Set(),
    generatedEncounterPlans: new Map([[identity.regionId, [finalPlan]]]),
    generatedActivationSpawns: new Map([[identity.regionId, new Set([identity.bossId])]]),
    simulatedGeneratedRegions: new Set(regions.getSimulatedRegionIds()),
    generatedNavigationCache: new Map(),
    collisionProbe: new THREE.Vector3(),
    actorBudget: new ActorBudget(), actorSequence: 1,
    chronicleRegions: createChronicleRegions(blueprint), chronicleState: createChronicleState(),
    chronicleCommitments: createChronicleCommitmentState(), campaignContracts: createCampaignContractState(),
    doctrines: createDoctrineRunState([]), doctrineEffects: resolveDoctrineEffects([]),
    generatedRngStreams: {
      combat: new RandomStream(1), director: new RandomStream(2), event: new RandomStream(3),
      loot: new RandomStream(4), chronicle: new RandomStream(5), rumour: new RandomStream(6),
    },
    hints: { pending: () => [] }, lootRng: () => 0.1, combatRng: () => 0.99,
    health: 100, maxHealth: 100, stamina: 100, maxStamina: 100,
    gold: 55, kills: 0, damage: 28, damageFlash: 0, cameraYaw: 0,
    body: createHealthyBody(), upgrades: { blade: 0, vitality: 0, endurance: 0 },
    threatTier: 1, nextThreatWaveAt: 180, championDamageBonus: 0,
    generatedSupplyCount: 2, caravanCooldown: 0, caravanDirection: 1,
    caravan: new THREE.Group(), eventCooldown: 90, eventSequence: 0,
    elapsed: 10, ended: false, paused: false, shieldActive: false,
    combatMastery, melee, honestMelee: true, abilityCooldown: 0, attackCooldown: 0, attackAnimation: 0,
    squadCommand, squadNavigation: new Map(), squadBlockedSeconds: new Map(), squadIntents: new Map(),
    expeditionPlanner, lookGesture: null, mousePointerId: null,
    squadFollowing: false, activeEvents: [], activeContractNodeId: null,
    generatedRunStatus: 'active', runEnding: null, lastZone: 'fort',
    lootPickups: [], lootCollectionBursts: [], keys: new Set(),
    renderer: { domElement: {} },
    palette: {
      warning: new THREE.Color(0xffbb22), success: new THREE.Color(0x4ade80),
      link: new THREE.Color(0x4da6ff), accent: new THREE.Color(0xfd8ea1),
    },
    audio: { setMusicOutcome: () => {}, setEnded: () => {}, setPaused: () => {} },
    callbacks: { onNotice: (text: string) => notices.push(text), onEnd: (result: string) => ends.push(result) },
  })
  // Only render/audio boundaries are replaced. Damage, reactions, death attribution,
  // objective completion, region deltas, save building and terminal finalization are real.
  for (const method of [
    'createBloodBurst', 'createHitParticles', 'drawActorHealthBar', 'spawnDecal',
    'detachActorLimb', 'addTrauma', 'presentCombatFeedback', 'playSound', 'emitView',
    'clearTransientCombatFeedback', 'createSparks', 'removeAndDisposeObject', 'resumeAudio',
    'animateActorCharacter', 'updateChampionAura',
  ]) Reflect.set(engine, method, () => {})
  Reflect.set(engine, 'spawnLoot', (reward: unknown) => drops.push(reward))
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { pointerLockElement: null, activeElement: null },
  })
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: class extends EventTarget {} })
  return { engine, blueprint, identity, finale, actors, boss, player, regions, collision, objectives, achievements, notices, ends, drops, config, combatMastery, melee, squadCommand, expeditionPlanner }
}

function swing(id: FinaleAttackId, origin: THREE.Vector3): FinaleAction {
  return { id, stage: 'contact', remaining: 0.18, origin: { x: origin.x, z: origin.z },
    originY: origin.y + 1.45, direction: { x: 0, z: 1 }, pitch: 0,
    travelLimit: id === 'charge' ? 7.5 : id === 'advance' ? 5.6 : 0, hitIds: [] }
}

function useHeadlessActorMeshes(value: ReturnType<typeof fixture>): void {
  Reflect.set(value.engine, 'spawnActor', (
    faction: Faction, role: ActorRole, x: number, z: number, _index: number,
    options: { budget: string; generatedSpawnId: string; generatedRegionId: string; generatedEncounterId: string },
  ) => {
    const actor = makeActor(`generated:${options.generatedSpawnId}`, faction, role, x, z)
    Object.assign(actor, options, { budgetCategory: options.budget })
    value.actors.push(actor)
    return actor
  })
}

test('the real engine contact adapter applies armor, shield, injury admission and current-position whiffs', () => {
  const front = fixture()
  invoke(front.engine, 'resolveFinaleContact', front.boss, swing('heavySlam', front.boss.mesh.position))
  assert.equal(Reflect.get(front.engine, 'health'), 100 - 26 * 0.72)
  const blocked = fixture()
  Reflect.set(blocked.engine, 'shieldActive', true)
  let injuryRolls = 0
  Reflect.set(blocked.engine, 'combatRng', () => { injuryRolls += 1; return 0.99 })
  invoke(blocked.engine, 'resolveFinaleContact', blocked.boss, swing('heavySlam', blocked.boss.mesh.position))
  assert.equal(Reflect.get(blocked.engine, 'health'), 100 - 26 * 0.72 * 0.15)
  assert.equal(injuryRolls, 0)
  const moved = fixture()
  moved.player.position.x += 4
  invoke(moved.engine, 'resolveFinaleContact', moved.boss, swing('heavySlam', moved.boss.mesh.position))
  assert.equal(Reflect.get(moved.engine, 'health'), 100)
})

test('a perfect guard interrupts the owned finale and cancels the remaining squad contacts', () => {
  function encounter(late: boolean, omitInterruption = false) {
    const value = fixture()
    const ally = makeActor('guard-companion', 'guard', 'soldier',
      value.boss.mesh.position.x + 0.25, value.boss.mesh.position.z + 2.7)
    ally.hostileToPlayer = false
    ally.squadEligible = true
    ally.budgetCategory = 'squad'
    value.actors.push(ally)
    value.finale.action = swing('heavySlam', value.boss.mesh.position)
    if (omitInterruption) Reflect.set(value.engine, 'interruptFinaleAttack', () => {})
    invoke(value.engine, 'setShield', true)
    if (late) advanceCombatMastery(value.combatMastery, 0.13)
    invoke(value.engine, 'resolveFinaleContact', value.boss, value.finale.action)
    return { ...value, ally }
  }

  const guarded = encounter(false)
  assert.equal(Reflect.get(guarded.engine, 'health'), 100)
  assert.equal(Reflect.get(guarded.engine, 'stamina'), 88)
  assert.equal(guarded.combatMastery.guardWindow, 0)
  assert.equal(guarded.boss.reaction, 'stagger')
  assert.equal(guarded.finale.action?.stage, 'recovery')
  assert.equal(guarded.ally.hp, 100)
  const recovery = guarded.finale.action?.remaining
  invoke(guarded.engine, 'interruptFinaleAttack', guarded.boss.id)
  assert.equal(guarded.finale.action?.remaining, recovery, 'interrupting recovery must not renew it')

  const late = encounter(true)
  assert.ok(Reflect.get(late.engine, 'health') < 100)
  assert.ok(late.ally.hp < 100, 'the control must actually intersect the companion')
  assert.equal(late.finale.action?.stage, 'contact')

  const disconnected = encounter(false, true)
  assert.equal(disconnected.finale.action?.stage, 'contact',
    'removing the integration hook leaves the signature attack pending despite a successful guard')
})

test('leaving a finale suspends both sides instead of leaving an unopposed squad target', () => {
  for (const faction of ['elf', 'guard', 'villain'] as const) {
    const value = fixture(faction)
    const ally = makeActor('held-companion', faction, 'soldier',
      value.boss.mesh.position.x, value.boss.mesh.position.z + 1)
    ally.hostileToPlayer = false
    ally.squadEligible = true
    ally.budgetCategory = 'squad'
    value.actors.push(ally)
    value.boss.hp = 37
    value.player.position.z = value.identity.arena.z + 36
    invoke(value.engine, 'updateFinaleBoss', value.boss, 1 / 60)
    assert.equal(value.finale.suspended, true)
    assert.ok(!invoke<typeof value.actors>(value.engine, 'getCombatTargets').includes(value.boss))
    assert.equal(invoke(value.engine, 'isSquadTargetVisible', value.boss, false), false)

    Object.assign(ally, {
      targetId: value.boss.id, attackCooldown: 1,
      action: {
        kind: 'meleeActor', phase: 'windup', elapsed: 0, duration: 0.26,
        target: { kind: 'actor', id: value.boss.id },
        targetPosition: value.boss.mesh.position.clone(), contactRange: 2.55,
      },
    })
    invoke(value.engine, 'updateActorAction', ally, 1 / 60)
    assert.equal(ally.action, null)
    assert.equal(ally.targetId, null)
    assert.equal(ally.attackCooldown, 1, 'suspension must not refund a pending attack')
    for (const direct of [true, false]) {
      const result = invoke<CombatOutcome>(value.engine, 'damageActor',
        value.boss, 200, ally.mesh.position, faction, direct,
        { attackKind: direct ? 'arrow' : 'allyMelee', sourceActorId: ally.id })
      assert.equal(result.applied, false, 'already-fired projectiles and direct damage must also be gated')
    }
    assert.equal(value.boss.hp, 37)
    assert.equal(value.finale.boss?.health, 37)
    assert.equal(value.finale.defeated, false)
    assert.equal(value.objectives.find((objective) => objective.id === value.identity.objectiveId)?.done, false)

    const ordinary = makeActor('ordinary-enemy', value.identity.enemyFaction, 'soldier',
      ally.mesh.position.x + 1, ally.mesh.position.z)
    value.actors.push(ordinary)
    assert.ok(invoke<typeof value.actors>(value.engine, 'getCombatTargets').includes(ordinary))
    assert.equal(invoke<CombatOutcome>(value.engine, 'damageActor', ordinary, 5,
      ally.mesh.position, faction, false, { attackKind: 'allyMelee', sourceActorId: ally.id }).applied, true)

    value.player.position.z = value.identity.arena.z + 3
    invoke(value.engine, 'updateFinaleBoss', value.boss, 1 / 60)
    assert.equal(value.boss.hp, 37, 'reentry must not heal the suspended boss')
    assert.ok(invoke<typeof value.actors>(value.engine, 'getCombatTargets').includes(value.boss))
    assert.equal(invoke<CombatOutcome>(value.engine, 'damageActor', value.boss, 5,
      ally.mesh.position, faction, false, { attackKind: 'allyMelee', sourceActorId: ally.id }).applied, true)

    const unguarded = fixture(faction)
    unguarded.player.position.z = unguarded.identity.arena.z + 36
    invoke(unguarded.engine, 'updateFinaleBoss', unguarded.boss, 1 / 60)
    Reflect.set(unguarded.engine, 'isInactiveFinaleActor', () => false)
    const bypass = invoke<CombatOutcome>(unguarded.engine, 'damageActor', unguarded.boss,
      200, unguarded.player.position, faction, false, { attackKind: 'allyMelee' })
    assert.equal(bypass.killed, true, 'removing the admission gate reproduces the offscreen finale bypass')
  }
})

test('real finale projectile collision hits cover before a player and does not change ordinary arrows', () => {
  const value = fixture('elf')
  const start = value.boss.mesh.position.clone().add(new THREE.Vector3(0, 1.45, 0))
  const end = start.clone().add(new THREE.Vector3(0, 0, 6))
  value.collision.registerBox({
    id: 'cover', regionId: value.identity.regionId, x: start.x, z: start.z + 1.2, halfWidth: 2, halfDepth: 0.2,
  })
  const projectile = { owner: 'actor', sourceActorId: value.boss.id, allegiance: 'guard', finale: true }
  const hit = invoke<{ player: boolean; actor: unknown; fraction: number }>(
    value.engine, 'findProjectileHit', projectile, start, end,
  )
  assert.equal(hit.player, false)
  assert.equal(hit.actor, null)
  assert.ok(hit.fraction < 0.2)
  const ordinary = invoke<{ player: boolean }>(value.engine, 'findProjectileHit', { ...projectile, finale: false }, start, end)
  assert.equal(ordinary.player, true)
  Reflect.set(value.engine, 'simulatedGeneratedRegions', new Set())
  const inactive = invoke<{ player: boolean; fraction: number }>(value.engine, 'findProjectileHit', projectile, start, end)
  assert.equal(inactive.player, false)
  assert.equal(inactive.fraction, 0)
})

test('real player and allied lethal damage completes the owned finale and finalizes profile currency only once', () => {
  for (const faction of ['elf', 'guard', 'villain'] as const) for (const direct of [true, false]) {
    const value = fixture(faction)
    const ally = makeActor('companion', faction, 'soldier', value.player.position.x, value.player.position.z)
    ally.hostileToPlayer = false
    ally.squadEligible = true
    ally.budgetCategory = 'squad'
    value.actors.push(ally)
    invoke(value.engine, 'damageActor', value.boss, 200, value.player.position, faction, direct,
      { attackKind: direct ? 'melee' : 'allyMelee', sourceActorId: direct ? undefined : ally.id })
    assert.equal(value.boss.alive, false)
    assert.equal(value.objectives.find((objective) => objective.id === value.identity.objectiveId)?.done, true)
    assert.equal(value.finale.defeated, true)
    assert.ok(value.regions.getSavedDelta(value.identity.regionId)?.defeatedActorIds.includes(value.identity.bossId))
    const gold = Reflect.get(value.engine, 'gold')
    const drops = value.drops.length
    invoke(value.engine, 'damageActor', value.boss, 200, value.player.position, faction, direct, { attackKind: 'melee' })
    invoke(value.engine, 'recordGeneratedActorDeath', value.boss)
    invoke(value.engine, 'updateMission')
    invoke(value.engine, 'updateMission')
    assert.deepEqual(value.ends, ['victory'])
    assert.equal(Reflect.get(value.engine, 'gold'), gold)
    assert.equal(value.drops.length, drops)
    const save = invoke<ActiveRunSaveV3>(value.engine, 'saveGeneratedRun')
    assert.equal(save.status, 'victory')
    const records = new Map<string, string>()
    const storage: StorageLike = {
      getItem: (key) => records.get(key) ?? null,
      setItem: (key, data) => { records.set(key, data) },
      removeItem: (key) => { records.delete(key) },
    }
    const first = finalizeRunSnapshot(storage, save)
    const second = finalizeRunSnapshot(storage, save)
    assert.equal(first.outcome, 'finalized')
    assert.equal(second.outcome, 'already-finalized')
    assert.equal(second.profile.profileCurrency, first.profile.profileCurrency)
    assert.equal(second.profile.runHistory.length, 1)
  }
})

test('arrival, a failed contract, an unrelated champion and repeated callbacks cannot invent a final win', () => {
  const value = fixture()
  for (const objective of value.objectives) if (objective.id !== value.identity.objectiveId) objective.done = false
  assert.equal(invoke(value.engine, 'completeGeneratedObjective',
    value.blueprint.objectives.guard.nodes.find((node) => node.id === value.identity.objectiveId)), false)
  assert.equal(invoke(value.engine, 'completeObjective', value.identity.objectiveId), false)
  for (const objective of value.objectives) if (objective.id !== value.identity.objectiveId) objective.done = true
  const unrelated = makeActor('random-champion', 'villain', 'champion', value.player.position.x + 2, value.player.position.z)
  value.actors.push(unrelated)
  invoke(value.engine, 'damageActor', unrelated, 200, value.player.position, 'guard', true, { attackKind: 'melee' })
  invoke(value.engine, 'updateMission')
  assert.equal(value.finale.defeated, false)
  assert.deepEqual(value.ends, [])
  assert.equal(value.objectives.find((objective) => objective.id === value.identity.objectiveId)?.done, false)
})

test('terminal defeat cancels finale projectiles, pending contact and visible telegraphs without victory', () => {
  const value = fixture('elf')
  invoke(value.engine, 'resolveFinaleContact', value.boss, swing('fan', value.boss.mesh.position))
  assert.equal(Reflect.get(value.engine, 'projectiles').length, 3)
  value.finale.action = swing('fan', value.boss.mesh.position)
  value.finale.action.stage = 'tell'
  value.finale.action.remaining = 0.75
  invoke(value.engine, 'updateFinaleTelegraphs')
  const telegraphs: THREE.Mesh[] = Reflect.get(value.engine, 'finaleTelegraphs')
  assert.equal(telegraphs.filter((mesh) => mesh.visible).length, 3)
  for (const mesh of telegraphs) {
    assert.ok(mesh.geometry.boundingSphere!.radius < 30)
    assert.ok(mesh.geometry.getAttribute('position').getY(0) > 0.14)
  }
  invoke(value.engine, 'endGame', 'defeat')
  assert.equal(Reflect.get(value.engine, 'projectiles').length, 0)
  assert.equal(telegraphs.filter((mesh) => mesh.visible).length, 0)
  assert.equal(value.finale.action.stage, 'recovery')
  assert.deepEqual(value.ends, ['defeat'])
  invoke(value.engine, 'endGame', 'victory')
  assert.deepEqual(value.ends, ['defeat'])
})

test('a player arrow killing the boss safely clears earlier finale projectiles without corrupting the projectile loop', () => {
  const value = fixture('elf')
  value.boss.hp = 1
  invoke(value.engine, 'resolveFinaleContact', value.boss, swing('fan', value.boss.mesh.position))
  invoke(value.engine, 'spawnProjectile', 'player', 'elf',
    value.boss.mesh.position.clone().add(new THREE.Vector3(0, 1.45, 0.95)),
    new THREE.Vector3(0, 0, -25), 1, 100, null, 0)
  assert.equal(Reflect.get(value.engine, 'projectiles').length, 4)
  invoke(value.engine, 'updateProjectiles', 1 / 30)
  assert.equal(value.boss.alive, false)
  assert.equal(Reflect.get(value.engine, 'projectiles').length, 0)
  assert.equal(Reflect.get(value.engine, 'updatingProjectiles'), false)
  invoke(value.engine, 'updateMission')
  assert.deepEqual(value.ends, ['victory'])
})

test('a displaced charging boss cannot carry a damaging lane away from its locked telegraph', () => {
  const value = fixture()
  value.finale.action = swing('charge', value.boss.mesh.position)
  value.finale.action.remaining = 0.75
  value.finale.sequenceIndex = 1
  Reflect.set(value.engine, 'animateFinaleActor', () => {})
  invoke(value.engine, 'damageActor', value.boss, 5,
    value.boss.mesh.position.clone().add(new THREE.Vector3(3, 0, 0)), 'guard', true,
    { attackKind: 'melee', knockback: 0.9 })
  assert.ok(value.boss.knockbackVelocity.lengthSq() > 0)
  invoke(value.engine, 'updateFinaleBoss', value.boss, 1 / 60)
  assert.equal(value.finale.action.stage, 'recovery')
  assert.equal(Reflect.get(value.engine, 'health'), 100)
})

test('the real fan spawns three locked projectile directions rather than homing at a moving target', () => {
  const value = fixture('elf')
  invoke(value.engine, 'resolveFinaleContact', value.boss, swing('fan', value.boss.mesh.position))
  const projectiles: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = Reflect.get(value.engine, 'projectiles')
  assert.equal(projectiles.length, 3)
  const velocities = projectiles.map((projectile) => projectile.velocity.toArray())
  assert.ok(velocities[0][0] < 0 && velocities[1][0] === 0 && velocities[2][0] > 0)
  value.player.position.x += 8
  invoke(value.engine, 'updateProjectiles', 1 / 60)
  assert.deepEqual(projectiles.map((projectile) => projectile.velocity.toArray()), velocities)
  assert.equal(Reflect.get(value.engine, 'health'), 100)
  assert.ok(projectiles.every((projectile) => projectile.life < 1.2))
})

test('one live save preserves finale wounds, paid evasion, squad orders and the selected itinerary', () => {
  const value = fixture('villain')
  const evade = beginEvade(value.combatMastery, {
    stamina: 100, body: createHealthyBody(), melee: value.melee, paused: false, ended: false,
    moveX: 1, moveZ: 0, aimX: 0, aimZ: -1,
  })
  assert.equal(evade.accepted, true)
  Reflect.set(value.engine, 'stamina', 100 - evade.staminaSpent)
  advanceCombatMastery(value.combatMastery, 0.1)
  value.squadCommand.anchor.heading = 0.75
  const expedition = new ExpeditionPlanner(value.blueprint, {
    version: 1, mode: 'selected', preference: 'cautious',
    target: { kind: 'objective', id: value.identity.objectiveId },
  })
  Reflect.set(value.engine, 'expeditionPlanner', expedition)
  value.boss.hp = 49
  invoke(value.engine, 'captureLiveFinale')
  advanceFinale(value.finale, {
    body: value.finale.boss!, active: true, target: value.player.position, canSeeTarget: true, interrupted: false,
    sourceHeight: value.boss.mesh.position.y + 1.45, targetHeight: value.player.position.y + 1.45,
  }, 1 / 60)
  const save = invoke<ActiveRunSaveV3>(value.engine, 'saveGeneratedRun')
  assert.ok(JSON.stringify(save.directorState.finale).length < 3000)
  const restored = normalizeFinaleState(save.directorState.finale, value.identity, {
    defeatedActorIds: [], clearedEncounterIds: [], objectiveDone: false,
  })
  assert.equal(restored.rejected, false)
  assert.equal(restored.state.phase, 2)
  assert.equal(finaleSavedBody(restored.state, value.identity.bossId)?.health, 49)
  const persisted = parseActiveRunSaveV3(JSON.stringify(save))
  assert.ok(persisted)
  const initial = buildInitialGameView({ blueprint: value.blueprint, config: value.config, restored: persisted })
  const live = buildFinaleView(value.finale, true)
  assert.equal(initial.finale?.health, live?.health)
  assert.equal(initial.finale?.phase, live?.phase)
  assert.equal(initial.finale?.bossId, live?.bossId)
  assert.deepEqual(serializeFinaleState(restored.state), save.directorState.finale)
  const mastery = normalizeCombatMastery(persisted.directorState.combatMastery, 'villain')
  assert.equal(mastery.state.evadeCooldown, value.combatMastery.evadeCooldown)
  assert.equal(mastery.state.evadeRemaining, value.combatMastery.evadeRemaining)
  assert.equal(initial.stamina, 75)
  assert.equal(initial.combatMastery.evadeActive, true)
  assert.equal(initial.combatMastery.evadeProtected, false)
  assert.equal(initial.squadCommand.mode, 'hold')
  assert.deepEqual(initial.squadCommand.anchor, value.squadCommand.anchor)
  assert.equal(initial.expedition.mode, 'selected')
  assert.equal(initial.expedition.preference, 'cautious')
  assert.equal(initial.expedition.target?.id, value.identity.objectiveId)
  assert.deepEqual(persisted.directorState.expedition, expedition.serialize())
})

test('production spawning defers a full actor budget and admits the boss first when one slot opens', () => {
  const value = fixture()
  value.actors.length = 0
  Reflect.set(value.engine, 'generatedActivationSpawns', new Map([[value.identity.regionId, new Set()]]))
  useHeadlessActorMeshes(value)
  for (let index = 0; index < 25; index += 1) {
    const actor = makeActor(`occupant-${index}`, 'guard', 'soldier', 0, 0)
    actor.budgetCategory = index < 3 ? 'squad' : 'campaign'
    actor.squadEligible = index < 3
    value.actors.push(actor)
  }
  invoke(value.engine, 'spawnGeneratedRegionEncounters', value.identity.regionId)
  assert.equal(value.actors.length, 25)
  assert.equal(value.actors.some((actor) => actor.id === value.boss.id), false)
  invoke(value.engine, 'updateMission')
  assert.deepEqual(value.ends, [])
  invoke(value.engine, 'removeActorById', 'occupant-24')
  invoke(value.engine, 'spawnGeneratedRegionEncounters', value.identity.regionId)
  assert.equal(value.actors.length, 25)
  const spawned = value.actors.find((actor) => actor.generatedSpawnId === value.identity.bossId)
  assert.ok(spawned)
  assert.equal(value.actors.filter((actor) => actor.budgetCategory === 'squad').length, 3)
  assert.equal(value.actors.some((actor) => value.identity.escortIds.includes(actor.generatedSpawnId ?? '')), false)
  invoke(value.engine, 'damageActor', spawned, 200, value.player.position, 'guard', true, { attackKind: 'melee' })
  invoke(value.engine, 'updateMission')
  assert.deepEqual(value.ends, ['victory'])
})

test('real streaming removal and reentry preserve boss wounds and dead escorts without granting loot or duplicates', () => {
  const value = fixture('villain')
  useHeadlessActorMeshes(value)
  invoke(value.engine, 'spawnGeneratedRegionEncounters', value.identity.regionId)
  assert.equal(value.actors.length, 3)
  const escort = value.actors.find((actor) => actor.generatedSpawnId === value.identity.escortIds[0])!
  invoke(value.engine, 'damageActor', escort, 200, value.player.position, 'villain', true, { attackKind: 'melee' })
  value.boss.hp = 37
  invoke(value.engine, 'captureLiveFinale')
  value.finale.phase = 2
  value.finale.action = swing('advance', value.boss.mesh.position)
  value.finale.action.stage = 'tell'
  value.finale.action.remaining = 0.35
  const gold = Reflect.get(value.engine, 'gold')
  const drops = value.drops.length
  const far = value.blueprint.regions.find((region) =>
    region.coordinate.x < 2 && region.coordinate.y < 2)!
  value.regions.update(far.id)
  invoke(value.engine, 'syncGeneratedRegions')
  assert.equal(value.actors.some((actor) => actor.generatedSpawnId === value.identity.bossId), false)
  assert.equal(value.finale.boss?.health, 37)
  assert.equal(value.finale.action.stage, 'recovery')
  const saved = invoke<ActiveRunSaveV3>(value.engine, 'saveGeneratedRun')
  assert.equal(Reflect.get(value.engine, 'gold'), gold)
  assert.equal(value.drops.length, drops)
  value.regions.update(value.identity.regionId)
  invoke(value.engine, 'syncGeneratedRegions')
  invoke(value.engine, 'syncGeneratedRegions')
  assert.equal(value.actors.length, 2)
  const returned = value.actors.find((actor) => actor.generatedSpawnId === value.identity.bossId)!
  assert.equal(returned.hp, 37)
  assert.equal(value.finale.phase, 2)
  assert.equal(value.actors.some((actor) => actor.generatedSpawnId === escort.generatedSpawnId), false)
  const restored = normalizeFinaleState(saved.directorState.finale, value.identity, {
    defeatedActorIds: saved.regionDeltas[value.identity.regionId].defeatedActorIds,
    clearedEncounterIds: saved.regionDeltas[value.identity.regionId].clearedEncounterIds,
    objectiveDone: false,
  })
  assert.equal(restored.rejected, false)
  assert.equal(restored.state.boss?.health, 37)
  assert.equal(restored.state.escorts[0].defeated, true)
  assert.deepEqual(value.ends, [])
})

test('rejected partial state cannot suppress materialization and strand the actual campaign', () => {
  const value = fixture()
  const result = normalizeFinaleState({
    ...serializeFinaleState(value.finale), defeated: true,
  }, value.identity, { defeatedActorIds: [], clearedEncounterIds: [], objectiveDone: false })
  assert.equal(result.rejected, true)
  assert.equal(result.state.defeated, false)
  Reflect.set(value.engine, 'finale', result.state)
  value.actors.length = 0
  Reflect.set(value.engine, 'generatedActivationSpawns', new Map([[value.identity.regionId, new Set()]]))
  useHeadlessActorMeshes(value)
  invoke(value.engine, 'spawnGeneratedRegionEncounters', value.identity.regionId)
  const boss = value.actors.find((actor) => actor.generatedSpawnId === value.identity.bossId)
  assert.ok(boss)
  invoke(value.engine, 'updateMission')
  assert.deepEqual(value.ends, [])
  invoke(value.engine, 'damageActor', boss, 1000, value.player.position, 'guard', true, { attackKind: 'melee' })
  invoke(value.engine, 'updateMission')
  assert.deepEqual(value.ends, ['victory'])
})

function warningContains(mesh: THREE.Mesh, point: { x: number; z: number }): boolean {
  const positions = mesh.geometry.getAttribute('position')
  const side = (ax: number, az: number, bx: number, bz: number) =>
    (point.x - bx) * (az - bz) - (ax - bx) * (point.z - bz)
  for (let index = 0; index < mesh.geometry.drawRange.count; index += 3) {
    const a = side(positions.getX(index), positions.getZ(index), positions.getX(index + 1), positions.getZ(index + 1))
    const b = side(positions.getX(index + 1), positions.getZ(index + 1), positions.getX(index + 2), positions.getZ(index + 2))
    const c = side(positions.getX(index + 2), positions.getZ(index + 2), positions.getX(index), positions.getZ(index))
    const area = (positions.getX(index + 1) - positions.getX(index)) * (positions.getZ(index + 2) - positions.getZ(index)) -
      (positions.getZ(index + 1) - positions.getZ(index)) * (positions.getX(index + 2) - positions.getX(index))
    if (Math.abs(area) < 0.000001) continue
    if ((a >= -0.00001 && b >= -0.00001 && c >= -0.00001) || (a <= 0.00001 && b <= 0.00001 && c <= 0.00001)) return true
  }
  return false
}

test('a side pillar cannot erase the warning for an unobstructed real advance', () => {
  const value = fixture('villain')
  value.finale.phase = 2
  value.player.position.z = value.boss.mesh.position.z + 4
  value.collision.registerCircle({
    id: 'side-pillar', regionId: value.identity.regionId,
    x: value.boss.mesh.position.x + 1.2, z: value.boss.mesh.position.z, radius: 0.5,
  })
  Reflect.set(value.engine, 'animateFinaleActor', () => {})
  invoke(value.engine, 'updateFinaleBoss', value.boss, 1 / 60)
  const action = value.finale.action!
  assert.equal(action.id, 'advance')
  assert.equal(action.travelLimit, 5.6)
  const warnings: THREE.Mesh[] = Reflect.get(value.engine, 'finaleTelegraphs')
  assert.equal(warnings[0].visible, true)
  assert.ok(warningContains(warnings[0], value.player.position))
  for (let frame = 0; frame < 100; frame += 1) {
    invoke(value.engine, 'updateFinaleBoss', value.boss, 1 / 60)
    if (action.stage === 'recovery') break
  }
  assert.equal(Reflect.get(value.engine, 'health'), 81)
})

test('the generated gate advertises zero/short-path contact caps at every frame schedule and saves their reach', () => {
  const world = generateWorld(20260905)
  const runtime = new GeneratedWorldRuntime(new THREE.Scene(), world, { terrainResolution: 6, decorationDensity: 0.35 })
  const origin = { x: 138.31783314093516, z: -82.66418486705892 }
  const direction = { x: 0.5571153681777694, z: 0.8304351067603948 }
  runtime.update({ focus: origin, deltaSeconds: 1 / 60 })
  try {
    for (const offset of [0, 0.08]) for (const hz of [30, 60, 144]) for (const near of [true, false]) {
      const value = fixture('villain')
      Reflect.set(value.engine, 'generatedWorld', runtime)
      Reflect.set(value.engine, 'simulatedGeneratedRegions', new Set(runtime.regions.getSimulatedRegionIds()))
      Reflect.set(value.engine, 'animateFinaleActor', () => {})
      value.boss.mesh.position.set(origin.x + direction.x * offset, 0, origin.z + direction.z * offset)
      value.boss.mesh.position.y = runtime.sampleHeight(value.boss.mesh.position.x, value.boss.mesh.position.z)
      value.player.position.copy(value.boss.mesh.position).add(new THREE.Vector3(direction.x * 4, 0, direction.z * 4))
      value.player.position.y = runtime.sampleHeight(value.player.position.x, value.player.position.z)
      value.finale.phase = 2
      invoke(value.engine, 'updateFinaleBoss', value.boss, 1 / hz)
      const action = value.finale.action!
      assert.equal(action.id, 'advance')
      assert.ok(action.travelLimit <= 0.100001)
      if (offset > 0) assert.equal(action.travelLimit, 0)
      const normalized = normalizeFinaleState(serializeFinaleState(value.finale), value.identity, {
        defeatedActorIds: [], clearedEncounterIds: [], objectiveDone: false,
      })
      assert.equal(normalized.rejected, false)
      assert.equal(normalized.state.action?.travelLimit, action.travelLimit)
      if (near) {
        value.player.position.set(138.53267974814648, 0, -81.26695870949895)
        value.player.position.y = runtime.sampleHeight(value.player.position.x, value.player.position.z)
      }
      const warnings: THREE.Mesh[] = Reflect.get(value.engine, 'finaleTelegraphs')
      assert.equal(warningContains(warnings[0], value.player.position), near)
      for (let frame = 0; frame < hz * 2; frame += 1) {
        invoke(value.engine, 'updateFinaleBoss', value.boss, 1 / hz)
        if (action.stage === 'recovery') break
      }
      assert.equal(Reflect.get(value.engine, 'health'), near ? 81 : 100, `${offset}:${hz}:${near}`)
      assert.ok(Math.hypot(value.boss.mesh.position.x - action.origin.x, value.boss.mesh.position.z - action.origin.z) <= action.travelLimit + 0.00001)
    }
  } finally {
    runtime.dispose()
  }
})

test('real Huntsmaster shots lock elevation on the generated slope; the former horizontal-only control misses', () => {
  const run = (flatten: boolean): number => {
    const value = fixture('elf')
    const runtime = new GeneratedWorldRuntime(new THREE.Scene(), value.blueprint, { terrainResolution: 6, decorationDensity: 0.35 })
    value.boss.mesh.position.set(161.1978545028166, 0, 59.77001474142246)
    value.player.position.set(161.1978545028166, 0, 77.77001474142246)
    runtime.update({ focus: value.boss.mesh.position, deltaSeconds: 1 / 60 })
    value.boss.mesh.position.y = runtime.sampleHeight(value.boss.mesh.position.x, value.boss.mesh.position.z)
    value.player.position.y = runtime.sampleHeight(value.player.position.x, value.player.position.z)
    Reflect.set(value.engine, 'generatedWorld', runtime)
    Reflect.set(value.engine, 'simulatedGeneratedRegions', new Set(runtime.regions.getSimulatedRegionIds()))
    Reflect.set(value.engine, 'animateFinaleActor', () => {})
    try {
      invoke(value.engine, 'updateFinaleBoss', value.boss, 1 / 60)
      const action = value.finale.action!
      assert.equal(action.id, 'fan')
      assert.ok(action.pitch < 0)
      const normalized = normalizeFinaleState(serializeFinaleState(value.finale), value.identity, {
        defeatedActorIds: [], clearedEncounterIds: [], objectiveDone: false,
      })
      assert.equal(normalized.rejected, false)
      assert.equal(normalized.state.action?.pitch, action.pitch)
      assert.equal(normalized.state.action?.originY, action.originY)
      if (flatten) action.pitch = 0
      for (let frame = 0; frame < 60; frame += 1) {
        invoke(value.engine, 'updateFinaleBoss', value.boss, 1 / 60)
        if (Reflect.get(value.engine, 'projectiles').length > 0) break
      }
      for (let frame = 0; frame < 90; frame += 1) invoke(value.engine, 'updateProjectiles', 1 / 60)
      return Reflect.get(value.engine, 'health')
    } finally {
      runtime.dispose()
    }
  }
  assert.equal(run(false), 91)
  assert.equal(run(true), 100)
})
