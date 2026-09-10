import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import * as THREE from 'three'
import {
  GeometryCache, StylizedArtLibrary, createCharacterPresenter, illustratedCharacterPlan, resolveCharacterPlan,
  creaturePresenter, type CharacterContact, type CreaturePresenter, type WagonPresenter,
} from '../src/game/art/index.ts'
import { ContactPresentation, contactResponse, copyPresentationContact, type PresentationContact } from '../src/game/ContactPresentation.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { SecondaryEffectPool } from '../src/game/SecondaryEffectPool.ts'
import { createArtStream } from '../src/game/art/index.ts'
import { createGeneratedRngStreams } from '../src/game/random/GeneratedRngStreams.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import type { ActiveRunSaveV3 } from '../src/game/run/runTypes.ts'
import { parseActiveRunSaveV3 } from '../src/game/run/storage.ts'
import { createHealthyBody } from '../src/game/types.ts'
import { createDoctrineRunState } from '../src/game/run/doctrine.ts'
import { createCampaignContractState, createChronicleCommitmentState, createGeneratedObjectives } from '../src/game/world/CampaignDirector.ts'
import { createChronicleRegions, createChronicleState } from '../src/game/world/Chronicle.ts'
import { createFinaleIdentity, createFinaleState } from '../src/game/world/FinaleDirector.ts'
import { advanceCombatMastery, beginEvade, createCombatMasteryState, raisePerfectGuard } from '../src/game/world/CombatMastery.ts'
import { createPlayerMeleeState } from '../src/game/world/CombatResolver.ts'
import { createSquadCommandState } from '../src/game/world/SquadCommand.ts'
import { ExpeditionPlanner } from '../src/game/world/ExpeditionPlanner.ts'
import { RegionManager } from '../src/game/world/RegionManager.ts'

const loader = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
} })
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()
const ink = { player: 0x282828, enemy: 0x282828, interactable: 0x282828, landmark: 0x282828 }
const scratch = (): CharacterContact => ({ point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: 'skin' })

function artFixture() {
  const art = new StylizedArtLibrary({ enhanced: true, ink })
  const cache = new GeometryCache()
  const guard = createCharacterPresenter(illustratedCharacterPlan(resolveCharacterPlan('guard', 'soldier', 0, false)), art, cache, false)
  const attacker = createCharacterPresenter(illustratedCharacterPlan(resolveCharacterPlan('villain', 'player', 0, true)), art, cache, true)
  return { art, cache, guard, attacker, dispose() { guard.dispose(); attacker.dispose(); art.dispose(); cache.dispose() } }
}

test('cached actual posed contacts follow affine transforms, retain physical surfaces and never traverse per hit', () => {
  const f = artFixture(), resolver = new ContactPresentation(), expected = scratch()
  try {
    f.guard.root.position.set(8, 3, -4)
    f.guard.root.scale.set(0.7, 1.4, 1.1)
    f.guard.root.rotation.set(0.1, 0.4, -0.08)
    f.guard.anatomy.torsoPivot.rotation.x = 0.35
    f.attacker.root.position.set(8, 3, -7)
    f.attacker.syncAttachments()
    f.guard.syncAttachments()
    assert.equal(f.guard.sampleContact('torso', expected), true)
    const original = f.guard.root.position.clone()
    const forbidden = () => { throw new Error('Per-hit scene lookup is forbidden') }
    f.guard.root.getObjectByName = forbidden
    f.guard.root.traverse = forbidden
    f.attacker.root.getObjectByName = forbidden
    const fallback = new THREE.Vector3(8, 4.3, -4), incoming = new THREE.Vector3(0, 0, 1)
    const contact = resolver.actor(f.guard.root, 'torso', fallback, incoming, undefined, f.attacker.root)!
    assert.equal(contact, resolver.contact)
    assert.deepEqual(contact.point, expected.point)
    assert.deepEqual(contact.normal, expected.normal)
    assert.equal(contact.surface, expected.surface)
    assert.equal(contact.origin, 'posed')
    assert.ok(contact.sourceSurface)
    assert.deepEqual(f.guard.root.position, original)
    assert.deepEqual(incoming.toArray(), [0, 0, 1])
    const saved = copyPresentationContact(contact)
    f.guard.anatomy.torsoPivot.rotation.x += 0.3
    resolver.actor(f.guard.root, 'torso', fallback, incoming)
    assert.notDeepEqual(resolver.contact.point, saved.point)
    assert.notEqual(resolver.contact.point, saved.point)
    // Cleanup uses the presenter's owned resources, not the replaced traversal method.
  } finally { f.dispose() }
})

test('missing/unarmed/hidden anchors reject rather than reuse stale scratch; projectile intersection remains primary', () => {
  const f = artFixture(), resolver = new ContactPresentation(), head = scratch()
  try {
    assert.ok(resolver.actor(f.guard.root, 'torso', new THREE.Vector3(), new THREE.Vector3(0, 0, 1)))
    f.guard.setAppearance({ leftArm: 'missing', rightArm: 'missing' })
    assert.equal(resolver.actor(f.guard.root, 'weaponTip', new THREE.Vector3(99, 99, 99), new THREE.Vector3(1, 0, 0)), null)
    assert.equal(resolver.actor(f.guard.root, 'leftArm', new THREE.Vector3(), new THREE.Vector3(1, 0, 0)), null)
    f.guard.sampleContact('head', head)
    const intersection = head.point.clone().add(new THREE.Vector3(0, 0, 0.04)), before = intersection.clone()
    const normal = new THREE.Vector3(0.2, 0.7, 0.1).normalize()
    const contact = resolver.actor(f.guard.root, 'torso', new THREE.Vector3(99, 99, 99),
      new THREE.Vector3(0, 0, 1), intersection, undefined, normal)!
    assert.equal(contact.origin, 'projectile')
    assert.equal(contact.surface, 'skin')
    assert.deepEqual(contact.point, intersection)
    assert.deepEqual(contact.normal, normal)
    assert.deepEqual(intersection, before)
    f.guard.root.visible = false
    assert.equal(resolver.actor(f.guard.root, 'torso', new THREE.Vector3(), normal), null)
    const unclassified = resolver.actor(f.guard.root, 'torso', new THREE.Vector3(), normal, intersection)!
    assert.equal(unclassified.surface, 'unknown')
    assert.equal(unclassified.origin, 'projectile')
    const legacy = resolver.actor(new THREE.Group(), 'torso', intersection, normal)!
    assert.equal(legacy.origin, 'admitted-legacy')
    assert.equal(legacy.surface, 'unknown')
    assert.deepEqual(legacy.point, intersection)
    assert.notEqual(legacy.point, intersection)
  } finally { f.dispose() }
})

test('actual creature samplers and explicit wagon event fallback use published APIs without a fabricated wagon anchor', () => {
  const art = new StylizedArtLibrary({ enhanced: true, ink }), cache = new GeometryCache()
  const creatures = new Set<CreaturePresenter>(), wagons = new Set<WagonPresenter>()
  const factory = Object.assign(Object.create(GameEngine.prototype), {
    artLibrary: art, artGeometry: cache, creaturePresenters: creatures, wagonPresenters: wagons,
    visualPolicy: resolveVisualPolicy({ visualMode: 'enhanced' }),
    palette: { warning: new THREE.Color(0xfbbf24), bg: new THREE.Color(0x302d29), text: new THREE.Color(0xdedede),
      surface: new THREE.Color(0x45413c), borderStrong: new THREE.Color(0x605e5a) },
  })
  const resolver = new ContactPresentation()
  try {
    const beast = factory.createBeast('wolf') as THREE.Group
    beast.scale.set(1.2, 0.8, 0.7)
    const presenter = creaturePresenter(beast)!
    const expected = scratch()
    presenter.sampleContact('torso', expected)
    const contact = resolver.actor(beast, 'torso', new THREE.Vector3(90, 90, 90), new THREE.Vector3(0, 0, 1))!
    assert.deepEqual(contact.point, expected.point)
    assert.equal(contact.surface, 'hair')
    assert.equal(resolver.actor(beast, 'shield', expected.point, expected.normal), null)
    const wagon = factory.createCaravan() as THREE.Group
    const admitted = new THREE.Vector3(10, 2, 8)
    const event = resolver.event(wagon, admitted, new THREE.Vector3(1, 0, 0), undefined)
    assert.equal(event.origin, 'admitted-event')
    assert.equal(event.surface, 'wood')
    assert.deepEqual(event.point, admitted)
  } finally {
    for (const presenter of wagons) presenter.dispose()
    for (const presenter of creatures) presenter.dispose()
    art.dispose(); cache.dispose()
  }
})

test('world material classification cannot introduce a new height or overwrite the admitted world normal', () => {
  const blueprint = generateWorld(20260906)
  const art = new StylizedArtLibrary({ enhanced: true, ink })
  const runtime = new GeneratedWorldRuntime(new THREE.Scene(), blueprint, { art, decorationDensity: 0,
    visualPolicy: resolveVisualPolicy({ visualMode: 'enhanced' }) })
  const resolver = new ContactPresentation()
  try {
    assert.ok(runtime.surfaces)
    const bridge = runtime.getBridgePosition(blueprint.bridges[0])
    assert.ok(bridge)
    const point = new THREE.Vector3(bridge.x, 123, bridge.z), normal = new THREE.Vector3(0.1, 1, -0.1).normalize()
    const result = resolver.terrain(point, normal, new THREE.Vector3(1, -1, 0), runtime.surfaces)
    assert.equal(result.surface, 'wood')
    assert.equal(result.point.y, 123)
    assert.ok(result.normal.distanceTo(normal) < 1e-12)
    assert.equal(point.y, 123)
    assert.equal(contactResponse('skin', false).kind, 'blood')
    assert.notEqual(contactResponse('skin', true).kind, 'blood')
    assert.equal(contactResponse('metal', false).kind, 'spark')
    assert.equal(contactResponse('metal', false, 'bone').kind, 'chip')
    assert.equal(contactResponse('water', false).kind, 'splash')
    assert.notEqual(contactResponse('wood', false).kind, 'blood')
  } finally { runtime.dispose(); art.dispose() }
})

function combatFixture(seed = 42, restored?: ActiveRunSaveV3) {
  const f = artFixture()
  const blueprint = generateWorld(seed), regions = new RegionManager(blueprint)
  const config = { seed: blueprint.seed, generatorVersion: blueprint.generatorVersion, faction: 'villain' as const, selectedBoonId: 'provisions' }
  const runId = 'npc-injury-run', startedAt = '2026-09-10T10:00:00.000Z'
  const chronicleRegions = createChronicleRegions(blueprint)
  const actor = {
    id: 'contact-target', mesh: f.guard.root, role: 'soldier', allegiance: 'guard', alive: true, hp: 100, maxHp: 100,
    reaction: 'none', reactionRemaining: 0, poise: 30, maxPoise: 30, poiseRecoveryDelay: 0, staggerImmunity: 0,
    aiMode: 'normal', hostileToPlayer: true, alertCooldown: 10, healthBar: new THREE.Sprite(),
  }
  actor.mesh.position.set(0, 0, -2)
  const contacts: PresentationContact[] = [], legacyGore: unknown[] = [], sounds: string[] = []
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    player: f.attacker.root, faction: 'villain', actors: [actor], elapsed: 10, paused: false, ended: false,
    visualPolicy: resolveVisualPolicy({ visualMode: 'enhanced' }), doctrineEffects: {}, contactNormal: new THREE.Vector3(),
    secondaryContactPoint: new THREE.Vector3(), cameraYaw: 0, damage: 30, body: {}, attackAnimation: 0,
    isInactiveFinaleActor: () => false, alertNearbyAllies() {}, drawActorHealthBar() {}, applyActorDamageReaction() {},
    createBloodBurst: (...values: unknown[]) => legacyGore.push(values), createHitParticles() {}, detachActorLimb() {},
    presentPhysicalContact: (contact: PresentationContact) => contacts.push(copyPresentationContact(contact)),
    presentCombatFeedback() {}, addTrauma() {}, queueCameraAccent() {}, moveCharacter() {},
    getAimDirection: () => new THREE.Vector3(0, 0, -1), playSound: (sound: string) => sounds.push(sound),
    generatedBlueprint: blueprint, generatedRngStreams: createGeneratedRngStreams(blueprint.seed, restored?.rngStates),
    generatedRun: { runId, startedAt, config }, generatedRunStatus: 'active',
    generatedWorld: {
      regions,
      getRegionIdAt: (x: number, z: number) => regions.layout.regions.find((region) =>
        x >= region.bounds.minX && x <= region.bounds.maxX && z >= region.bounds.minZ && z <= region.bounds.maxZ)?.id,
      getRegionBounds: (id: string) => regions.layout.regions.find((region) => region.id === id)?.bounds,
    },
    chronicleRegions, chronicleState: createChronicleState(), chronicleCommitments: createChronicleCommitmentState(),
    campaignContracts: createCampaignContractState(), doctrines: createDoctrineRunState([]),
    finale: createFinaleState(createFinaleIdentity(blueprint, 'villain')),
    objectives: createGeneratedObjectives(blueprint, 'villain'),
    health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, gold: 55, kills: 0,
    upgrades: { blade: 0, vitality: 0, endurance: 0 }, threatTier: 1, nextThreatWaveAt: 180,
    championDamageBonus: 0, generatedSupplyCount: 2, caravanCooldown: 0, caravanDirection: 1,
    caravan: new THREE.Group(), eventCooldown: 90, eventSequence: 0,
    squadCommand: createSquadCommandState({ x: 0, z: 0, heading: 0 }),
    expeditionPlanner: new ExpeditionPlanner(blueprint), hints: { pending: () => [] },
    combatMastery: createCombatMasteryState(), melee: createPlayerMeleeState(),
    abilityCooldown: 0, attackCooldown: 0, shieldActive: false, lootPickups: [], activeEvents: [],
    achievements: { getRunState: () => ({
      runId, faction: 'villain', startedAt, kills: 0, killsSinceDamage: 0, bestKillStreak: 0,
      damageTaken: 0, injuries: 0, limbsLost: 0, goldEarned: 0, purchases: 0, objectivesCompleted: 0,
      eventsCompleted: 0, abilitiesUsed: 0, shieldBlocks: 0, squadCommands: 0, caravansRobbed: 0,
      zonesVisited: ['fort'], eventKindsCompleted: [], unlockedIds: [], result: null, elapsedAtEnd: 0, healthAtEnd: 100,
    }) },
  })
  engine.body = createHealthyBody()
  return { ...f, actor, engine, contacts, legacyGore, sounds, dispose() { regions.dispose(); f.dispose() } }
}

test('real damageActor preserves damage/reaction vectors and routes one admitted posed contact, not a miss/dead target', () => {
  const f = combatFixture()
  try {
    const source = new THREE.Vector3()
    const result = f.engine.damageActor(f.actor, 20, source, 'villain', true, { attackKind: 'melee' })
    assert.equal(f.actor.hp, 80)
    assert.deepEqual(result.direction.toArray(), [0, 0, -1])
    assert.deepEqual(result.position.toArray(), [0, 1.3, -2])
    assert.equal(f.contacts.length, 1)
    assert.equal(f.contacts[0].origin, 'posed')
    assert.equal(f.legacyGore.length, 0)
    const expected = scratch()
    f.guard.sampleContact('torso', expected)
    assert.deepEqual(f.contacts[0].point, expected.point)
    assert.notEqual(result.presentationContact.point, f.engine.getContactPresentation().contact.point)
    f.actor.alive = false
    const rejected = f.engine.damageActor(f.actor, 20, source, 'villain', true, { attackKind: 'melee' })
    assert.equal(rejected.applied, false)
    assert.equal(f.contacts.length, 1)
    f.actor.alive = true
    f.engine.damageActor(f.actor, 0, source, 'villain', true, { attackKind: 'melee' })
    assert.equal(f.contacts.length, 1, 'zero damage is not a blood contact')
    assert.deepEqual(source.toArray(), [0, 0, 0])
  } finally { f.dispose() }
})

test('actual cleave emits once per admitted target and summary feedback adds no physical centroid or extra sound', () => {
  const f = combatFixture()
  try {
    f.engine.damage = 5
    f.actor.hp = 1000
    let legacySparks = 0, summaries = 0
    f.engine.createSparks = () => { legacySparks++ }
    f.engine.presentCleaveFeedback = () => { summaries++ }
    f.engine.cleave()
    assert.equal(f.contacts.length, 1)
    assert.equal(legacySparks, 0)
    assert.equal(summaries, 1)
    assert.deepEqual(f.sounds, ['cleave'])
    f.actor.mesh.position.set(100, 0, 100)
    f.engine.cleave()
    assert.equal(f.contacts.length, 1)
    assert.equal(summaries, 1)
    // The real summary path has only its original cosmetic/text/audio channels.
    f.engine.presentCombatFeedback = (_event: unknown, channels: { ray: boolean }) => { assert.equal(channels.ray, false) }
    f.engine.requestHitStop = () => {}
    Reflect.get(GameEngine.prototype, 'presentCleaveFeedback').call(f.engine, [{
      applied: true, dealt: 10, weight: 'normal', killed: false, attackKind: 'cleave', targetId: f.actor.id,
      directPlayerAction: true, position: new THREE.Vector3(), direction: new THREE.Vector3(0, 0, -1),
    }])
    assert.equal(f.contacts.length, 1)
  } finally { f.dispose() }
})

test('actual projectile path passes the resolved intersection and copies it before projectile disposal', () => {
  const f = combatFixture()
  try {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    mesh.position.set(0, 1.45, -1)
    const projectile = { mesh, velocity: new THREE.Vector3(0, 0, -10), life: 1, travelled: 0,
      owner: 'player', allegiance: 'villain', damage: 20, sourceActorId: null, detachChance: 0, finale: false, straight: true }
    Object.assign(f.engine, {
      projectiles: [projectile], projectileSourcesToClear: new Set(), updatingProjectiles: false,
      scene: new THREE.Scene(), findProjectileHit: () => ({ fraction: 0.3, player: false, actor: f.actor }),
    })
    f.engine.scene.add(mesh)
    f.engine.updateProjectiles(0.05)
    assert.equal(f.engine.projectiles.length, 0)
    assert.equal(f.contacts.length, 1)
    assert.equal(f.contacts[0].origin, 'projectile')
    assert.deepEqual(f.contacts[0].point.toArray(), [0, 1.45, -1.15])
    mesh.position.set(99, 99, 99)
    assert.deepEqual(f.contacts[0].point.toArray(), [0, 1.45, -1.15])
  } finally { f.dispose() }
})

test('event-prop damage retains the existing bite RNG/audio path but cannot emit after rejected dead contacts', () => {
  const f = combatFixture()
  try {
    let draws = 0
    f.engine.eventRng = () => { draws++; return 0.5 }
    f.engine.eventSequence = 1
    const target = { object: new THREE.Group(), hp: 100, position: new THREE.Vector3(1, 0, 1), presentationSurface: 'wood' }
    f.engine.actorAttackEventProp(f.actor, target)
    assert.equal(draws, 1)
    assert.ok(target.hp < 100)
    assert.equal(f.contacts.length, 1)
    assert.equal(f.contacts[0].surface, 'wood')
    assert.equal(f.contacts[0].origin, 'admitted-event')
    assert.deepEqual(f.sounds, ['hitLight'])
    target.hp = 0
    f.engine.actorAttackEventProp(f.actor, target)
    assert.equal(draws, 2, 'presentation must not change the existing simulation draw site')
    assert.equal(f.contacts.length, 1)
  } finally { f.dispose() }
})

test('physical primary cue is depth-tested, uses sampled position/direction and stays compact under reduced motion', () => {
  const f = combatFixture()
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial())
  const entry = { sprite, material: sprite.material, age: 0, lifetime: 1, active: false, priority: 0, weight: 'normal' }
  try {
    Object.assign(f.engine, {
      camera: new THREE.PerspectiveCamera(), acquireImpactRayFx: () => entry, impactRayFx: [entry],
      reducedMotion: true,
    })
    const contact = new ContactPresentation().actor(f.guard.root, 'torso', new THREE.Vector3(), new THREE.Vector3(1, 0, 0))!
    f.engine.spawnImpactRay({ position: contact.point, direction: contact.direction, weight: 'normal',
      targetId: f.actor.id, directPlayerAction: true, presentationContact: contact })
    assert.deepEqual(sprite.position, contact.point)
    assert.equal(sprite.material.depthTest, true)
    f.engine.updateImpactRayFx(0.05)
    assert.equal(sprite.scale.x, 0.38)
    assert.ok(sprite.material.opacity > 0 && sprite.material.opacity < 1)
    f.engine.updateImpactRayFx(1)
    assert.equal(sprite.visible, false)
  } finally { sprite.material.dispose(); f.dispose() }
})

test('actual paired engine modes keep NPC injury independent of warm cosmetics and cold UUID allocations', () => {
  function run(mode: 'legacy' | 'enhanced', seed: number, isolateBloodControl = false, coldSecondary = false) {
    const f = combatFixture(seed)
    const scene = new THREE.Scene()
    const secondary = coldSecondary ? null : new SecondaryEffectPool(scene, 42)
    const originalRandom = Math.random
    const artRandom = createArtStream(42, 'coupling-control-only')
    let globalDraws = 0, goreDraws = 0, uuidDraws = 0
    const injuryAdmissions: number[] = [], limbMethodDraws: number[] = []
    const controlled = () => {
      globalDraws++
      const stack = new Error().stack ?? ''
      if (stack.includes('generateUUID')) uuidDraws++
      else if (stack.includes('createBloodBurst')) goreDraws++
      else if (stack.includes('detachActorLimb')) limbMethodDraws.push(globalDraws)
      else if (stack.includes('damageActor')) injuryAdmissions.push(globalDraws)
      return globalDraws === 1 ? 0.1 : 0.95
    }
    Object.assign(f.engine, {
      visualPolicy: resolveVisualPolicy({ visualMode: mode }),
      scene, secondaryEffects: secondary,
      artLibrary: f.art, activeGore: 0, particles: [], inactiveGoreParticles: [],
      contactColor: new THREE.Color(), camera: new THREE.PerspectiveCamera(), spawnImpactRay() {},
      allegianceColor: () => new THREE.Color(0x4da6ff),
      createBloodBurst: Reflect.get(GameEngine.prototype, 'createBloodBurst'),
      detachActorLimb: Reflect.get(GameEngine.prototype, 'detachActorLimb'),
      presentPhysicalContact: Reflect.get(GameEngine.prototype, 'presentPhysicalContact'),
    })
    // Hold initial geometry/pose and allocation state constant. The real gore helper
    // uses these warm slots; the cold-secondary arm deliberately removes that control.
    const warm = []
    for (let index = 0; index < 64; index++) warm.push(f.engine.acquireGoreParticle())
    f.engine.inactiveGoreParticles.push(...warm)
    if (isolateBloodControl) {
      const realBlood = f.engine.createBloodBurst.bind(f.engine)
      f.engine.createBloodBurst = (...args: unknown[]) => {
        // Test-only counterfactual: execute the real helper with art randomness.
        // Never use this global swapping technique as a production fix.
        Math.random = () => artRandom.next()
        try { return realBlood(...args) } finally { Math.random = controlled }
      }
    }
    try {
      const initialSave: ActiveRunSaveV3 = f.engine.saveGeneratedRun()
      const expected = RandomStream.fromState(initialSave.rngStates.injury)
      const expectedLoss = expected.next() < 0.75
      const expectedLimb = expectedLoss ? ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'][Math.floor(expected.next() * 4)] : null
      Math.random = controlled
      const outcome = f.engine.damageActor(f.actor, 20, new THREE.Vector3(), 'villain', false, {
        attackKind: 'melee', detachChance: 0.75,
      })
      Math.random = originalRandom
      const missing = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'].filter((part) =>
        f.actor.mesh.getObjectByName(part)?.visible === false)
      const saved: ActiveRunSaveV3 = f.engine.saveGeneratedRun()
      assert.equal(saved.rngStates.injury, expected.getState())
      assert.deepEqual(missing, expectedLimb ? [expectedLimb] : [])
      for (const key of ['combat', 'director', 'event', 'loot', 'chronicle', 'rumour']) {
        assert.equal(saved.rngStates[key], initialSave.rngStates[key])
      }
      assert.deepEqual(injuryAdmissions, [], 'NPC injury admission must not read Math.random')
      return { mode, seed, isolateBloodControl, coldSecondary, health: f.actor.hp, dealt: outcome.dealt,
        missing, injuryState: saved.rngStates.injury, injuryAdmissions, limbMethodDraws, goreDraws, uuidDraws, globalDraws }
    } finally {
      Math.random = originalRandom
      f.engine.secondaryEffects?.dispose()
      const geometry = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        geometry.add(object.geometry)
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
      })
      for (const entry of geometry) entry.dispose()
      for (const entry of materials) entry.dispose()
      f.dispose()
    }
  }
  const results = []
  for (const seed of [42, 20260906, 20260910]) {
    const legacy = run('legacy', seed), enhanced = run('enhanced', seed)
    const isolatedLegacy = run('legacy', seed, true), isolatedEnhanced = run('enhanced', seed, true)
    const coldEnhanced = run('enhanced', seed, true, true)
    for (const arm of [enhanced, isolatedLegacy, isolatedEnhanced, coldEnhanced]) {
      assert.equal(arm.health, legacy.health)
      assert.equal(arm.dealt, legacy.dealt)
      assert.deepEqual(arm.missing, legacy.missing)
      assert.equal(arm.injuryState, legacy.injuryState)
    }
    assert.ok(legacy.goreDraws >= 307, 'the real cosmetic consumer must still be exercised')
    assert.ok(coldEnhanced.uuidDraws >= 12, 'the cold real pool must still allocate Three.js resources')
    results.push({ legacy, enhanced, isolatedLegacy, isolatedEnhanced, coldEnhanced })
  }
  assert.ok(results.some((arms) => arms.legacy.missing.length > 0), 'exercise a real detachment, not only failed chances')
  console.log(`GFX05_INJURY_STREAM_REPRO ${JSON.stringify(results)}`)
})

const injuryLimbs = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const

function enableRealNpcDetachment(f: ReturnType<typeof combatFixture>, mode: 'legacy' | 'enhanced') {
  const scene = new THREE.Scene()
  Object.assign(f.engine, {
    scene, artLibrary: f.art, particles: [], visualPolicy: resolveVisualPolicy({ visualMode: mode }),
    detachActorLimb: Reflect.get(GameEngine.prototype, 'detachActorLimb'),
    allegianceColor: () => new THREE.Color(0x4da6ff),
  })
  return () => {
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
    })
  }
}

test('actual save and constructor stream initializer continue NPC injury identically across restored visual modes', () => {
  const probabilities = [1, 0.4, 0.75, 0.6, 1, 0.3]
  const uninterrupted = combatFixture()
  const cleanup = enableRealNpcDetachment(uninterrupted, 'legacy')
  const decide = (f: ReturnType<typeof combatFixture>, probability: number) => {
    // A subsequent fresh admitted NPC, not a claim that ordinary NPC limb appearances
    // have acquired a new save schema. Both continuations use this same real candidate set.
    f.guard.setAppearance({ leftArm: 'healthy', rightArm: 'healthy', leftLeg: 'healthy', rightLeg: 'healthy' })
    f.actor.hp = 100
    const before: ActiveRunSaveV3 = f.engine.saveGeneratedRun()
    const expected = RandomStream.fromState(before.rngStates.injury)
    const chosen = expected.next() < probability
    const limb = chosen ? injuryLimbs[Math.floor(expected.next() * injuryLimbs.length)] : null
    const result = f.engine.damageActor(f.actor, 20, new THREE.Vector3(), 'villain', false, {
      attackKind: 'melee', detachChance: probability,
    })
    const after: ActiveRunSaveV3 = f.engine.saveGeneratedRun()
    const missing = injuryLimbs.filter((part) => f.actor.mesh.getObjectByName(part)?.visible === false)
    assert.deepEqual(missing, limb ? [limb] : [])
    assert.equal(after.rngStates.injury, expected.getState())
    for (const key of Object.keys(before.rngStates).filter((key) => key !== 'injury')) {
      assert.equal(after.rngStates[key], before.rngStates[key])
    }
    return { missing, dealt: result.dealt, health: f.actor.hp, rngStates: after.rngStates }
  }
  try {
    const initial: ActiveRunSaveV3 = uninterrupted.engine.saveGeneratedRun()
    for (const probability of probabilities.slice(0, 3)) decide(uninterrupted, probability)
    const checkpoint: ActiveRunSaveV3 = uninterrupted.engine.saveGeneratedRun()
    assert.notEqual(checkpoint.rngStates.injury, initial.rngStates.injury)
    const raw = JSON.stringify(checkpoint)
    const saved = parseActiveRunSaveV3(raw)
    assert.ok(saved)
    assert.equal(saved.version, 3)
    const next = probabilities.slice(3).map((probability) => decide(uninterrupted, probability))
    for (const mode of ['legacy', 'enhanced'] as const) {
      const restored = combatFixture(saved.config.seed, saved)
      const release = enableRealNpcDetachment(restored, mode)
      try {
        const restoredSave: ActiveRunSaveV3 = restored.engine.saveGeneratedRun()
        assert.deepEqual(restoredSave.rngStates, saved.rngStates)
        assert.equal(restoredSave.blueprintFingerprint, checkpoint.blueprintFingerprint)
        assert.equal(restoredSave.rulesetFingerprint, checkpoint.rulesetFingerprint)
        assert.deepEqual(probabilities.slice(3).map((probability) => decide(restored, probability)), next)
        assert.equal(JSON.stringify(saved), raw, 'restore must not rewrite the input save')
      } finally { release(); restored.dispose() }
    }
  } finally { cleanup(); uninterrupted.dispose() }
})

test('old valid saves without injury remain accepted and start at the deterministic blueprint-derived decision', () => {
  const source = combatFixture(20260906)
  const old: ActiveRunSaveV3 = source.engine.saveGeneratedRun()
  source.dispose()
  delete old.rngStates.injury
  const serialized = JSON.stringify(old)
  const valid = parseActiveRunSaveV3(serialized)
  assert.ok(valid)
  assert.equal(Object.hasOwn(valid.rngStates, 'injury'), false)
  const outcomes = []
  for (const mode of ['legacy', 'enhanced'] as const) {
    const restored = combatFixture(valid.config.seed, valid)
    const cleanup = enableRealNpcDetachment(restored, mode)
    try {
      const initialized: ActiveRunSaveV3 = restored.engine.saveGeneratedRun()
      assert.equal(initialized.rngStates.injury, deriveSeed(valid.config.seed, 'gameplay:injury'))
      for (const [key, state] of Object.entries(valid.rngStates)) assert.equal(initialized.rngStates[key], state)
      const expected = RandomStream.fromState(initialized.rngStates.injury)
      expected.next() // A probability of one still pays the original chance draw.
      const limb = injuryLimbs[Math.floor(expected.next() * injuryLimbs.length)]
      restored.engine.damageActor(restored.actor, 20, new THREE.Vector3(), 'villain', false, {
        attackKind: 'melee', detachChance: 1,
      })
      const saved: ActiveRunSaveV3 = restored.engine.saveGeneratedRun()
      const missing = injuryLimbs.filter((part) => restored.actor.mesh.getObjectByName(part)?.visible === false)
      assert.deepEqual(missing, [limb])
      assert.equal(saved.rngStates.injury, expected.getState())
      outcomes.push({ missing, state: saved.rngStates.injury })
    } finally { cleanup(); restored.dispose() }
  }
  assert.deepEqual(outcomes[0], outcomes[1])
  assert.equal(JSON.stringify(valid), serialized, 'old source save remains unchanged')
})

test('NPC injury admission consumes only its chance/selected-limb draws and never a rejected or no-detach path', () => {
  for (const mode of ['legacy', 'enhanced'] as const) {
    for (const scenario of ['no-option', 'zero-chance', 'zero-damage', 'dead', 'inactive', 'brute', 'paused', 'ended',
      'chance-fails', 'chance-one', 'no-limbs', 'direct-no-limbs', 'direct-selection'] as const) {
      const f = combatFixture()
      const release = enableRealNpcDetachment(f, mode)
      try {
        const save: ActiveRunSaveV3 = f.engine.saveGeneratedRun()
        const expected = RandomStream.fromState(save.rngStates.injury)
        const options: { attackKind: 'melee'; detachChance?: number } = { attackKind: 'melee', detachChance: 1 }
        if (scenario === 'no-option') delete options.detachChance
        if (scenario === 'zero-chance') options.detachChance = 0
        if (scenario === 'dead') f.actor.alive = false
        if (scenario === 'inactive') f.engine.isInactiveFinaleActor = () => true
        if (scenario === 'brute') f.actor.role = 'brute'
        if (scenario === 'paused') f.engine.paused = true
        if (scenario === 'ended') f.engine.ended = true
        if (scenario === 'chance-fails') options.detachChance = Number.MIN_VALUE
        if (scenario === 'no-limbs' || scenario === 'direct-no-limbs') {
          f.guard.setAppearance({ leftArm: 'missing', rightArm: 'missing', leftLeg: 'missing', rightLeg: 'missing' })
        }
        const before = injuryLimbs.filter((part) => f.actor.mesh.getObjectByName(part)?.visible === false)
        if (scenario.startsWith('direct-')) f.engine.detachActorLimb(f.actor)
        else f.engine.damageActor(f.actor, scenario === 'zero-damage' ? 0 : 20, new THREE.Vector3(), 'villain', false, options)
        const drawCount = scenario === 'chance-one' ? 2 :
          ['chance-fails', 'no-limbs', 'direct-selection'].includes(scenario) ? 1 : 0
        for (let index = 0; index < drawCount; index++) expected.next()
        const after: ActiveRunSaveV3 = f.engine.saveGeneratedRun()
        assert.equal(after.rngStates.injury, expected.getState(), `${mode}/${scenario}`)
        for (const key of Object.keys(save.rngStates).filter((key) => key !== 'injury')) {
          assert.equal(after.rngStates[key], save.rngStates[key], `${mode}/${scenario}/${key}`)
        }
        const missing = injuryLimbs.filter((part) => f.actor.mesh.getObjectByName(part)?.visible === false)
        assert.equal(missing.length, before.length + (scenario === 'chance-one' || scenario === 'direct-selection' ? 1 : 0))
      } finally { release(); f.dispose() }
    }
  }
})

test('player damage, block, perfect guard and evasion retain combat RNG ownership and never consume NPC injury', () => {
  for (const mode of ['legacy', 'enhanced'] as const) {
    for (const contact of ['ordinary', 'block', 'perfect', 'evaded', 'paused', 'ended'] as const) {
      const f = combatFixture()
      Object.assign(f.engine, {
        visualPolicy: resolveVisualPolicy({ visualMode: mode }), damageFlash: 0,
        combatRng: () => f.engine.generatedRngStreams.combat.next(),
        injurePlayer() {}, createSparks() {}, emitView() {},
      })
      f.engine.achievements.recordPlayerDamage = () => {}
      f.engine.health = 70
      if (contact === 'block' || contact === 'perfect') f.engine.shieldActive = true
      if (contact === 'perfect') raisePerfectGuard(f.engine.combatMastery)
      if (contact === 'evaded') {
        const result = beginEvade(f.engine.combatMastery, {
          stamina: 100, body: f.engine.body, melee: f.engine.melee, paused: false, ended: false,
          moveX: 1, moveZ: 0, aimX: 0, aimZ: -1,
        })
        assert.equal(result.accepted, true)
        advanceCombatMastery(f.engine.combatMastery, 0.1)
      }
      if (contact === 'paused') f.engine.paused = true
      if (contact === 'ended') f.engine.ended = true
      try {
        const before: ActiveRunSaveV3 = f.engine.saveGeneratedRun()
        const combat = RandomStream.fromState(before.rngStates.combat)
        if (contact === 'ordinary') combat.next()
        f.engine.damagePlayer(20, new THREE.Vector3(0, 0, -1), true, { attackKind: 'allyMelee' })
        const after: ActiveRunSaveV3 = f.engine.saveGeneratedRun()
        assert.equal(after.rngStates.combat, combat.getState(), `${mode}/${contact}`)
        assert.equal(after.rngStates.injury, before.rngStates.injury, `${mode}/${contact}`)
      } finally { f.dispose() }
    }
  }
})

test('visual settings and repeated serialization cannot advance the saved injury stream', () => {
  const f = combatFixture()
  Object.assign(f.engine, {
    weatherEnabled: true, dynamicDayNight: true, reducedMotion: false, weatherTarget: 'clear',
    renderer: { domElement: { dataset: {} } },
    updateDayNight() {}, updateWeather() {}, updateAtmosphere() {}, resetCameraMotion() {},
    postProcessor: { setEnabled() {} }, hitStopRemaining: 0,
  })
  try {
    const before: ActiveRunSaveV3 = f.engine.saveGeneratedRun()
    for (const value of [false, true, false, true]) {
      f.engine.setWeatherEnabled(value)
      f.engine.setDynamicDayNight(value)
      f.engine.setBloomEnabled(value)
      f.engine.setScreenShakeEnabled(value)
      assert.deepEqual((f.engine.saveGeneratedRun() as ActiveRunSaveV3).rngStates, before.rngStates)
    }
  } finally { f.dispose() }
})
