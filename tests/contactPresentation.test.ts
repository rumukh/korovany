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

function combatFixture() {
  const f = artFixture()
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
  })
  return { ...f, actor, engine, contacts, legacyGore, sounds }
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

test('actual paired engine modes reproduce global injury coupling; cosmetic isolation alone misses cold UUID consumption', () => {
  function run(mode: 'legacy' | 'enhanced', isolateBloodControl = false, coldSecondary = false) {
    const f = combatFixture()
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
      scene, secondaryEffects: secondary, generatedBlueprint: { seed: 42 },
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
      Math.random = controlled
      const outcome = f.engine.damageActor(f.actor, 20, new THREE.Vector3(), 'villain', false, {
        attackKind: 'melee', detachChance: 0.75,
      })
      Math.random = originalRandom
      const missing = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'].filter((part) =>
        f.actor.mesh.getObjectByName(part)?.visible === false)
      return { mode, isolateBloodControl, coldSecondary, health: f.actor.hp, dealt: outcome.dealt,
        missing, injuryAdmissions, limbMethodDraws, goreDraws, uuidDraws, globalDraws }
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
  const legacy = run('legacy'), enhanced = run('enhanced')
  const isolatedLegacy = run('legacy', true), isolatedEnhanced = run('enhanced', true)
  const coldEnhanced = run('enhanced', true, true)
  assert.equal(legacy.health, enhanced.health)
  assert.equal(legacy.dealt, enhanced.dealt)
  assert.deepEqual(legacy.missing, [])
  assert.deepEqual(enhanced.missing, ['rightLeg'])
  assert.deepEqual(legacy.injuryAdmissions, [308])
  assert.deepEqual(enhanced.injuryAdmissions, [1])
  assert.equal(legacy.goreDraws, 307)
  assert.deepEqual(isolatedLegacy.missing, isolatedEnhanced.missing,
    'redirecting explicit blood draws removes this warmed-path coupling')
  assert.deepEqual(isolatedLegacy.injuryAdmissions, [1])
  assert.deepEqual(coldEnhanced.missing, [],
    'a real cold Three.js pool constructor consumes global UUID draws before the untouched injury admission')
  assert.ok(coldEnhanced.uuidDraws > 0)
  assert.ok(coldEnhanced.injuryAdmissions[0] > 1)
  console.log(`GFX05_GLOBAL_RANDOM_REPRO ${JSON.stringify({ legacy, enhanced, isolatedLegacy, isolatedEnhanced, coldEnhanced })}`)
})
