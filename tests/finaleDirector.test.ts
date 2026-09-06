import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FINALE_ATTACKS,
  FINALE_ARENA_RADIUS,
  FINALE_PROFILES,
  FINALE_RESUME_SECONDS,
  advanceFinale,
  boundFinaleDestination,
  captureFinaleBody,
  createFinaleIdentity,
  createFinaleState,
  finaleCanSpawn,
  finaleContains,
  finaleEscortPost,
  finaleOwnsActor,
  finaleSavedBody,
  finaleStage,
  firstFinaleCoverHit,
  interruptFinale,
  isFinaleDefeated,
  normalizeFinaleState,
  prepareFinaleResume,
  reconcileFinale,
  recordFinaleDeath,
  resolveFinaleContactTargets,
  serializeFinaleState,
  suspendFinale,
  type FinaleAction,
  type FinaleAttackId,
  type FinaleAuthority,
  type FinaleCombatant,
  type FinaleInput,
  type FinaleIntent,
} from '../src/game/world/FinaleDirector.ts'
import { ActorBudget, MAX_ACTORS } from '../src/game/world/ActorBudget.ts'
import { buildFinaleView, buildInitialGameView } from '../src/game/world/CampaignView.ts'
import { createGeneratedEncounterPlan } from '../src/game/content/registry.ts'
import { createGeneratedObjectives, objectivePrerequisitesDone } from '../src/game/world/CampaignDirector.ts'
import { actorSpeedForRole, type Faction } from '../src/game/types.ts'
import { playerArmor, resolvePlayerDamage } from '../src/game/world/CombatResolver.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { CollisionWorld } from '../src/game/systems/CollisionWorld.ts'

const FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']
const EMPTY_AUTHORITY: FinaleAuthority = { defeatedActorIds: [], clearedEncounterIds: [], objectiveDone: false }

function fixture(faction: Faction = 'guard') {
  const blueprint = generateWorld(20260905)
  const identity = createFinaleIdentity(blueprint, faction)
  const state = createFinaleState(identity)
  const body: FinaleCombatant = {
    x: identity.arena.x, z: identity.arena.z,
    health: FINALE_PROFILES[faction].health, maxHealth: FINALE_PROFILES[faction].health,
    heading: 0, cooldown: 0,
  }
  captureFinaleBody(state, identity.bossId, body)
  const input: FinaleInput = {
    body, active: true, target: { x: body.x, z: body.z + 3 },
    sourceHeight: 1.45, targetHeight: 1.45,
    canSeeTarget: true, interrupted: false,
  }
  return { blueprint, identity, state, body, input }
}

function ready(faction: Faction = 'guard') {
  const value = fixture(faction)
  value.state.introduced = true
  value.state.suspended = false
  return value
}

function action(id: FinaleAttackId): FinaleAction {
  return {
    id, stage: 'contact', remaining: FINALE_ATTACKS[id].contact,
    origin: { x: 0, z: 0 }, originY: 1.45, direction: { x: 0, z: 1 },
    pitch: 0, travelLimit: FINALE_ATTACKS[id].shape === 'charge' ? FINALE_ATTACKS[id].range : 0,
    hitIds: [],
  }
}

function deadBoss(value: ReturnType<typeof fixture>) {
  return {
    generatedRegionId: value.identity.regionId, generatedEncounterId: value.identity.encounterId,
    generatedSpawnId: value.identity.bossId, generatedObjectiveId: value.identity.objectiveId,
    generatedUnique: true, alive: false, hp: 0,
  }
}

function contactIntents(intents: FinaleIntent[]): FinaleIntent[] {
  return intents.filter((intent) => intent.kind === 'contact' || intent.kind === 'charge')
}

test('all three campaign profiles bind to the existing reachable boss without changing world identity', () => {
  const expected = {
    elf: ['huntsmaster', 'guard'],
    guard: ['warlord', 'villain'],
    villain: ['marshal', 'guard'],
  }
  const assertIdentities = (profiles: typeof FINALE_PROFILES): void => {
    for (const faction of FACTIONS) assert.deepEqual([profiles[faction].id, profiles[faction].enemyFaction], expected[faction])
    assert.equal(new Set(FACTIONS.map((faction) => profiles[faction].id)).size, 3)
  }
  assertIdentities(FINALE_PROFILES)
  assert.throws(() => assertIdentities({ ...FINALE_PROFILES, elf: FINALE_PROFILES.villain }), assert.AssertionError)
  for (let seed = 0; seed < 40; seed += 1) {
    const world = generateWorld(410_000 + seed)
    const before = JSON.stringify(world)
    for (const campaign of FACTIONS) {
      const identity = createFinaleIdentity(world, campaign)
      const slot = world.encounters.find((candidate) => candidate.id === identity.encounterId)
      assert.ok(slot)
      const plan = createGeneratedEncounterPlan(world, slot, campaign)
      assert.equal(identity.bossId, plan.spawns[0].id)
      assert.equal(identity.enemyFaction, plan.spawns[0].faction)
      assert.equal(identity.siteId, world.finales[campaign])
      assert.equal(identity.escortIds.length, 2)
    }
    assert.equal(JSON.stringify(world), before)
  }
})

test('no unrelated champion, ordinary commander or foreign slot is admitted to finale ownership', () => {
  const value = fixture()
  const owned = deadBoss(value)
  assert.equal(finaleOwnsActor(value.identity, owned), true)
  for (const mutant of [
    { ...owned, generatedSpawnId: null },
    { ...owned, generatedRegionId: 'elsewhere' },
    { ...owned, generatedEncounterId: 'random-champion' },
    { ...owned, generatedSpawnId: 'ordinary-commander' },
    { ...owned, generatedSpawnId: createFinaleIdentity(value.blueprint, 'elf').bossId },
  ]) {
    assert.equal(finaleOwnsActor(value.identity, mutant), false)
    assert.equal(recordFinaleDeath(value.state, mutant, true), false)
  }
  assert.equal(actorSpeedForRole('commander'), 0)
})

test('tell, locked aim, contact and recovery are authoritative at 30/60/144 Hz, with an early-hit control', () => {
  for (const faction of FACTIONS) for (const hz of [30, 60, 144]) {
    const value = ready(faction)
    const first = advanceFinale(value.state, value.input, 1 / hz)
    assert.deepEqual(first, [{ kind: 'tell' }])
    assert.ok(value.state.action)
    const locked = { ...value.state.action.direction }
    const pitch = value.state.action.pitch
    const origin = { ...value.state.action.origin }
    const attack = value.state.action.id
    const tell = FINALE_ATTACKS[attack].tell
    const timings: Array<{ time: number; damaging: boolean }> = [{ time: 0, damaging: contactIntents(first).length > 0 }]
    value.input.target = { x: value.body.x + 12, z: value.body.z - 5 }
    value.input.targetHeight = 5
    let elapsed = 0
    let foundContact = false
    while (elapsed < tell + FINALE_ATTACKS[attack].contact + 0.2) {
      elapsed += 1 / hz
      const intents = advanceFinale(value.state, value.input, 1 / hz)
      const damaging = contactIntents(intents).length > 0
      timings.push({ time: elapsed, damaging })
      if (damaging) foundContact = true
      assert.deepEqual(value.state.action?.direction, locked)
      assert.deepEqual(value.state.action?.origin, origin)
      assert.equal(value.state.action?.pitch, pitch)
    }
    const assertTiming = (trace: typeof timings): void => {
      assert.ok(trace.some((entry) => entry.damaging))
      assert.ok(trace.every((entry) => !entry.damaging || entry.time + 1e-8 >= tell))
    }
    assertTiming(timings)
    assert.throws(() => assertTiming([{ time: 0, damaging: true }, ...timings]), assert.AssertionError)
    assert.equal(foundContact, true)
    assert.equal(value.state.action?.stage, 'recovery')
    assert.ok(FINALE_ATTACKS[attack].tell >= 0.55)
    assert.ok(FINALE_ATTACKS[attack].recovery >= 0.4)
  }
  const value = ready()
  assert.deepEqual(advanceFinale(value.state, value.input, 99), [{ kind: 'tell' }])
  assert.throws(() => advanceFinale(value.state, value.input, Number.NaN), RangeError)
})

function trace(faction: Faction, phase: 1 | 2, hz: number): string[] {
  const value = ready(faction)
  value.state.phase = phase
  if (phase === 2) value.body.health = value.body.maxHealth / 2
  const started: string[] = []
  for (let frame = 0; frame < hz * 32; frame += 1) {
    const intents = advanceFinale(value.state, value.input, 1 / hz)
    if (intents.some((intent) => intent.kind === 'tell')) started.push(value.state.action!.id)
    if (started.length === 7) break
  }
  assert.equal(started.length, 7)
  return started
}

test('both phases have different executable traces, including the second heavy tell and aggressive marshal', () => {
  for (const hz of [30, 60, 144]) {
    const first = FACTIONS.map((faction) => trace(faction, 1, hz))
    const second = FACTIONS.map((faction) => trace(faction, 2, hz))
    assert.equal(new Set(first.map((entries) => entries.join(','))).size, 3)
    for (let index = 0; index < FACTIONS.length; index += 1) {
      assert.notDeepEqual(first[index], second[index])
      assert.deepEqual(first[index], trace(FACTIONS[index], 1, 60))
      assert.deepEqual(second[index], trace(FACTIONS[index], 2, 60))
    }
    assert.deepEqual(second[1].slice(0, 3), ['heavyCleave', 'heavySlam', 'charge'])
    assert.deepEqual(second[2].slice(0, 3), ['advance', 'press', 'advance'])
  }
})

test('crossing half health transitions exactly once without healing, immunity or same-frame damage', () => {
  for (const faction of FACTIONS) {
    const value = ready(faction)
    advanceFinale(value.state, value.input, 1 / 60)
    value.body.health = value.body.maxHealth * 0.5 + 0.01
    assert.notEqual(advanceFinale(value.state, value.input, 1 / 60)[0]?.kind, 'transition')
    value.body.health = value.body.maxHealth * 0.5
    assert.deepEqual(advanceFinale(value.state, value.input, 1 / 60), [{ kind: 'transition' }])
    assert.equal(value.state.phase, 2)
    assert.equal(value.state.boss?.health, value.body.health)
    value.body.health -= 20
    for (let frame = 0; frame < 144; frame += 1) {
      assert.ok(advanceFinale(value.state, value.input, 1 / 144).every((intent) => intent.kind !== 'transition'))
    }
    assert.equal(value.state.boss?.health, value.body.health)
  }
})

test('advertised cone/lane and actual collision-resolved charge admit only current hostile bodies once', () => {
  const cone = action('cleave')
  const targets = [
    { id: 'front', x: 0, z: 3, radius: 0.64, alive: true, hostile: true },
    { id: 'side', x: 6, z: 0, radius: 0.64, alive: true, hostile: true },
    { id: 'rear', x: 0, z: -3, radius: 0.64, alive: true, hostile: true },
    { id: 'friend', x: 0, z: 3, radius: 0.64, alive: true, hostile: false },
    { id: 'dead', x: 0, z: 3, radius: 0.64, alive: false, hostile: true },
  ]
  const admitted = resolveFinaleContactTargets(cone, targets, () => true)
  assert.deepEqual(admitted, ['front'])
  assert.deepEqual(resolveFinaleContactTargets(cone, targets, () => true), [])
  assert.equal(finaleContains(action('heavySlam'), { x: 3, z: 3 }, 0.64), false)
  assert.equal(finaleContains(action('heavySlam'), { x: 0, z: 3 }, 0.64), true)
  const charge = action('charge')
  assert.deepEqual(resolveFinaleContactTargets(charge, targets, () => true, {
    start: { x: 0, z: 0 }, end: { x: 0, z: 0.2 },
  }), [])
  assert.deepEqual(resolveFinaleContactTargets(charge, targets, () => true, {
    start: { x: 0, z: 0.2 }, end: { x: 0, z: 3 },
  }), ['front'])
})

test('real prop colliders block contacts and shots; rotated boxes, tree trunks, water and inactive scope differ', () => {
  const world = new CollisionWorld()
  world.registerBox({ id: 'wall', regionId: 'arena', x: 0, z: 2, halfWidth: 2, halfDepth: 0.25 })
  const start = { x: 0, z: 0 }
  const target = { x: 0, z: 4 }
  const colliders = world.queryBounds({ minX: -10, minZ: -10, maxX: 10, maxZ: 10 })
  assert.equal(firstFinaleCoverHit(start, target, colliders), 1.75 / 4)
  const clear = (from: typeof start, to: typeof target) => firstFinaleCoverHit(from, to, colliders) === null
  const candidate = { id: 'player', ...target, radius: 0.64, alive: true, hostile: true }
  assert.deepEqual(resolveFinaleContactTargets(action('cleave'), [candidate], clear), [])
  const assertCover = (admit: typeof resolveFinaleContactTargets): void => {
    assert.deepEqual(admit(action('cleave'), [candidate], clear), [])
  }
  assert.throws(() => assertCover((swing, bodies) => resolveFinaleContactTargets(swing, bodies, () => true)), assert.AssertionError)
  assert.equal(firstFinaleCoverHit(start, target, [{
    id: 'water', regionId: 'arena', shape: 'box', x: 0, z: 2, halfWidth: 2, halfDepth: 0.25, tags: ['water'],
  }]), null)
  assert.ok(firstFinaleCoverHit(start, target, [{
    id: 'rotated', regionId: 'arena', shape: 'box', x: 0, z: 2, halfWidth: 1, halfDepth: 0.2, rotation: Math.PI / 4,
  }]) !== null)
  const treeHit = firstFinaleCoverHit(start, target, [{
    id: 'tree', regionId: 'arena', shape: 'circle', x: 0, z: 2, radius: 0.5,
  }], 0.12)
  assert.ok(treeHit !== null && Math.abs(treeHit - (2 - 0.62) / 4) < 1e-9)
  assert.deepEqual(resolveFinaleContactTargets(action('cleave'), [candidate], () => false), [])
})

test('ordinary lateral movement and the existing front shield beat standing inside an attack', () => {
  const candidate = (x: number, z: number) => ({ id: 'player', x, z, radius: 0.64, alive: true, hostile: true })
  const hit = resolveFinaleContactTargets(action('heavySlam'), [candidate(0, 3)], () => true)
  const walked = resolveFinaleContactTargets(action('heavySlam'), [candidate(3.2, 3)], () => true)
  assert.deepEqual(hit, ['player'])
  assert.deepEqual(walked, [])
  // 3.2 units fits in even the shortest tell at normal 8.2-unit walking speed.
  assert.ok(3.2 / 8.2 < FINALE_ATTACKS.heavySlam.tell)
  const damage = (shieldActive: boolean, incomingDotAim: number) => resolvePlayerDamage({
    baseDamage: FINALE_ATTACKS.heavySlam.damage, health: 100, shieldActive, incomingDotAim,
    hasIncomingDirection: true, armor: playerArmor('guard'),
  })
  const standing = damage(false, 1)
  const blocked = damage(true, 1)
  const rear = damage(true, -1)
  assert.equal(blocked.blocked, true)
  assert.ok(blocked.dealt < standing.dealt * 0.2)
  assert.equal(rear.dealt, standing.dealt)
  for (const id of ['cleave', 'heavyCleave', 'commandSweep', 'press'] as const) {
    const spec = FINALE_ATTACKS[id]
    // Even at the front edge of an overlapping body, ordinary walking can leave
    // the entire footprint before contact. Sprint/evasion is not the only answer.
    assert.ok(0.01 + 8.2 * spec.tell > spec.range + 0.64, `${id} has no full backstep window`)
  }
})

test('boss-first budget admission does not require optional escorts or evict companions', () => {
  for (const slots of [0, 1, 2, 3]) {
    const value = ready()
    const budget = new ActorBudget()
    budget.sync({ squad: 3, campaign: MAX_ACTORS - 3 - slots })
    const spawned: string[] = []
    for (const id of [value.identity.bossId, ...value.identity.escortIds]) {
      if (finaleCanSpawn(value.state, id) && budget.reserve('campaign', 1)) spawned.push(id)
    }
    assert.equal(budget.getUsed('squad'), 3)
    assert.ok(budget.total <= MAX_ACTORS)
    if (slots === 0) {
      assert.deepEqual(spawned, [])
      assert.equal(value.state.defeated, false)
    } else {
      assert.equal(spawned[0], value.identity.bossId)
      assert.equal(recordFinaleDeath(value.state, deadBoss(value), true), true)
      assert.equal(finaleCanSpawn(value.state, value.identity.escortIds[0]), false)
    }
  }
})

test('saved health, phase, aim and remaining tells round-trip; consumed contacts cannot replay', () => {
  const value = ready('elf')
  advanceFinale(value.state, value.input, 1 / 60)
  for (let index = 0; index < 11; index += 1) advanceFinale(value.state, value.input, 1 / 60)
  value.body.health -= 60
  captureFinaleBody(value.state, value.identity.bossId, value.body)
  captureFinaleBody(value.state, value.identity.escortIds[0], { ...value.body, health: 14, maxHealth: 70 })
  const encoded = serializeFinaleState(value.state)
  const restored = normalizeFinaleState(JSON.parse(JSON.stringify(encoded)), value.identity, EMPTY_AUTHORITY)
  assert.equal(restored.rejected, false)
  assert.deepEqual(serializeFinaleState(restored.state), encoded)
  assert.equal(finaleSavedBody(restored.state, value.identity.bossId)?.health, 280)
  assert.equal(finaleSavedBody(restored.state, value.identity.escortIds[0])?.health, 14)
  const remaining = restored.state.action!.remaining
  prepareFinaleResume(restored.state)
  assert.equal(restored.state.action?.remaining, remaining)
  assert.equal(restored.state.resumeRemaining, FINALE_RESUME_SECONDS)
  for (let index = 0; index < 30; index += 1) assert.equal(contactIntents(advanceFinale(restored.state, value.input, 1 / 60)).length, 0)
  assert.equal(restored.state.action?.remaining, remaining)
  const graceRemaining = restored.state.resumeRemaining
  prepareFinaleResume(restored.state)
  assert.equal(restored.state.resumeRemaining, graceRemaining)
  advanceFinale(restored.state, value.input, 1 / 60)
  assert.ok(restored.state.resumeRemaining < graceRemaining)
  restored.state.action!.stage = 'contact'
  restored.state.action!.remaining = 0.1
  restored.state.action!.hitIds = ['player']
  prepareFinaleResume(restored.state)
  assert.equal(restored.state.action?.stage, 'recovery')
  assert.deepEqual(restored.state.action?.hitIds, ['player'])
})

test('unload/disengage forfeits unspent contact, preserves health and dead escorts, and never refreshes recovery', () => {
  const value = ready('villain')
  advanceFinale(value.state, value.input, 1 / 60)
  value.body.health = 180
  advanceFinale(value.state, value.input, 1 / 60)
  assert.equal(value.state.phase, 2)
  value.state.transitionRemaining = 0
  advanceFinale(value.state, value.input, 1 / 60)
  const deadEscort = { ...deadBoss(value), generatedSpawnId: value.identity.escortIds[0], generatedUnique: false, generatedObjectiveId: null }
  recordFinaleDeath(value.state, deadEscort, true)
  suspendFinale(value.state)
  const remaining = value.state.action?.remaining
  suspendFinale(value.state)
  assert.equal(value.state.action?.remaining, remaining)
  for (let index = 0; index < 300; index += 1) {
    const intents = advanceFinale(value.state, { ...value.input, active: false }, 1 / 60)
    assert.equal(contactIntents(intents).length, 0)
    assert.equal(value.state.boss?.health, 180)
  }
  assert.equal(finaleCanSpawn(value.state, value.identity.escortIds[0]), false)
  const restored = normalizeFinaleState(serializeFinaleState(value.state), value.identity, EMPTY_AUTHORITY)
  assert.equal(restored.rejected, false)
  assert.equal(restored.state.phase, 2)
  assert.equal(finaleCanSpawn(restored.state, value.identity.escortIds[0]), false)
})

test('poise/perfect-guard interruption uses bounded recovery rather than a new action or repeated stunlock', () => {
  const value = ready()
  advanceFinale(value.state, value.input, 1 / 60)
  assert.equal(interruptFinale(value.state), true)
  assert.equal(value.state.action?.stage, 'recovery')
  assert.equal(value.state.action?.remaining, FINALE_ATTACKS.cleave.recovery)
  advanceFinale(value.state, value.input, 0.05)
  const remaining = value.state.action?.remaining
  assert.equal(interruptFinale(value.state), false)
  assert.equal(value.state.action?.remaining, remaining)
})

test('authoritative defeated deltas override stale state and legacy completion without awarding another outcome', () => {
  for (const authority of [
    { ...EMPTY_AUTHORITY, objectiveDone: true },
    { ...EMPTY_AUTHORITY, defeatedActorIds: [fixture().identity.bossId] },
    { ...EMPTY_AUTHORITY, clearedEncounterIds: [fixture().identity.encounterId] },
  ]) {
    const value = ready()
    const restored = normalizeFinaleState(serializeFinaleState(value.state), value.identity, authority)
    assert.equal(restored.state.defeated, true)
    assert.equal(restored.state.boss?.health, 0)
    assert.equal(finaleCanSpawn(restored.state, value.identity.bossId), false)
    assert.deepEqual(advanceFinale(restored.state, value.input, 1 / 60), [])
    assert.equal(recordFinaleDeath(restored.state, deadBoss(value), true), false)
    assert.equal(normalizeFinaleState(undefined, value.identity, authority).state.defeated, true)
  }
})

test('only an owned real lethal hit after prerequisites completes once', () => {
  for (const faction of FACTIONS) {
    const value = ready(faction)
    const node = value.blueprint.objectives[faction].nodes.find((entry) => entry.id === value.identity.objectiveId)!
    const objectives = createGeneratedObjectives(value.blueprint, faction)
    assert.equal(recordFinaleDeath(value.state, deadBoss(value), objectivePrerequisitesDone(node, objectives)), false)
    for (const objective of objectives) if (objective.id !== node.id) objective.done = true
    let completions = 0
    let finalized = false
    for (let duplicate = 0; duplicate < 3; duplicate += 1) {
      if (recordFinaleDeath(value.state, deadBoss(value), objectivePrerequisitesDone(node, objectives))) {
        completions += 1
        finalized = true
      }
    }
    assert.equal(completions, 1, faction)
    assert.equal(finalized, true)
    assert.equal(finaleStage(value.state), 'defeated')
  }
  const value = ready()
  for (const mutant of [
    { ...deadBoss(value), alive: true },
    { ...deadBoss(value), hp: 1 },
    { ...deadBoss(value), generatedUnique: false },
    { ...deadBoss(value), generatedObjectiveId: null },
  ]) assert.equal(recordFinaleDeath(value.state, mutant, true), false)
})

test('malformed present blocks are rejected, bounded, and cannot forge completion or change campaign identity', () => {
  const value = ready()
  const saved = serializeFinaleState(value.state)
  for (const bad of [
    null, {}, { ...saved, version: 99 }, { ...saved, phase: 3 },
    { ...saved, boss: { ...value.body, health: Number.NaN } },
    { ...saved, sequenceIndex: 9 }, { ...saved, escorts: Array(3).fill(null) },
    { ...saved, defeated: true }, { ...saved, transitionRemaining: Infinity },
    { ...saved, identity: { ...value.identity, profile: 'marshal' } },
  ]) {
    const rejected = normalizeFinaleState(bad, value.identity, EMPTY_AUTHORITY)
    assert.equal(rejected.rejected, true)
    assert.deepEqual(rejected.state, createFinaleState(value.identity))
  }
  const legacy = normalizeFinaleState(undefined, value.identity, EMPTY_AUTHORITY)
  assert.equal(legacy.rejected, false)
  assert.equal(legacy.state.introduced, false)
  const authoritative = normalizeFinaleState(null, value.identity, { ...EMPTY_AUTHORITY, objectiveDone: true })
  assert.equal(authoritative.rejected, true)
  assert.equal(authoritative.state.defeated, true)
})

test('version-one migration preserves wounds and phase without replaying an unmodelled tell', () => {
  const value = ready('elf')
  value.body.health = 73
  captureFinaleBody(value.state, value.identity.bossId, value.body)
  value.state.phase = 2
  const migrated = normalizeFinaleState({
    ...serializeFinaleState(value.state),
    version: 1,
    action: {
      id: 'lane', stage: 'tell', remaining: 0.1,
      origin: { x: value.body.x, z: value.body.z },
      direction: { x: 0, z: 1 }, hitIds: [],
    },
  }, value.identity, EMPTY_AUTHORITY)
  assert.equal(migrated.rejected, false)
  assert.equal(migrated.state.version, 2)
  assert.equal(migrated.state.boss?.health, 73)
  assert.equal(migrated.state.phase, 2)
  assert.equal(migrated.state.action?.stage, 'recovery')
  assert.equal(migrated.state.action?.remaining, FINALE_ATTACKS.lane.recovery)
})

test('arena bounds and two escort frontage posts are explicit and do not demand a replacement escort', () => {
  const value = ready('villain')
  const far = boundFinaleDestination(value.identity, { x: value.body.x + 1000, z: value.body.z + 1000 })
  assert.ok(Math.hypot(far.x - value.body.x, far.z - value.body.z) <= FINALE_ARENA_RADIUS + 1e-8)
  const left = finaleEscortPost(value.state, 0)
  const right = finaleEscortPost(value.state, 1)
  assert.ok(left.x < value.body.x && right.x > value.body.x)
  assert.ok(left.z > value.body.z && right.z > value.body.z)
  reconcileFinale(value.state, { ...EMPTY_AUTHORITY, defeatedActorIds: [value.identity.escortIds[0]] })
  assert.equal(finaleCanSpawn(value.state, value.identity.escortIds[0]), false)
  assert.equal(isFinaleDefeated(value.identity, EMPTY_AUTHORITY), false)
})

test('the view is identity-scoped, copied, and absent for an unseen or completed legacy encounter', () => {
  const value = fixture()
  assert.equal(buildFinaleView(value.state, true), null)
  value.state.introduced = true
  value.state.suspended = false
  const view = buildFinaleView(value.state, true)
  assert.ok(view)
  assert.equal(view.profile, 'warlord')
  assert.equal(view.health, value.body.health)
  assert.equal(buildFinaleView(value.state, false), null)
  const initial = buildInitialGameView({
    blueprint: value.blueprint,
    config: { seed: value.blueprint.seed, faction: 'guard', generatorVersion: value.blueprint.generatorVersion, selectedBoonId: 'provisions' },
    restored: undefined,
  })
  assert.equal(initial.finale, null)
})
