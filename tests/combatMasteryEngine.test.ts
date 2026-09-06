import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test, { after, beforeEach } from 'node:test'
import * as THREE from 'three'
import { createHealthyBody, type BodyState, type Faction } from '../src/game/types.ts'
import { CollisionWorld } from '../src/game/systems/CollisionWorld.ts'
import {
  createPlayerMeleeState,
  playerBeatSpec,
  type CombatActor,
  type CombatAttackKind,
  type CombatOutcome,
  type PlayerMeleeState,
} from '../src/game/world/CombatResolver.ts'
import {
  EVADE_COOLDOWN,
  EVADE_DISTANCE,
  createCombatMasteryState,
  isEvadeWindow,
  normalizeCombatMastery,
  serializeCombatMastery,
  type CombatMasteryState,
} from '../src/game/world/CombatMastery.ts'
import type { LookGesture } from '../src/game/input/CombatInput.ts'
import type { SoundCue } from '../src/game/AudioDirector.ts'
import { createFinaleIdentity, createFinaleState } from '../src/game/world/FinaleDirector.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'

// Load the production class with Node's TS support, including its Vite-style imports.
// Only construction/presentation are replaced below; inputs, movement and damage are real methods.
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()
const blueprint = generateWorld(20260905)

class TestElement extends EventTarget {
  editable = false
  captures = new Set<number>()
  closest() { return this.editable ? this : null }
  focus() { dom.activeElement = this }
  setPointerCapture(id: number) { this.captures.add(id) }
  hasPointerCapture(id: number) { return this.captures.has(id) }
  releasePointerCapture(id: number) { this.captures.delete(id) }
  requestPointerLock(): Promise<void> { return Promise.reject(new DOMException('Embedded document', 'WrongDocumentError')) }
}
const dom: { activeElement: TestElement | null; pointerLockElement: TestElement | null; hidden: boolean; exitPointerLock: () => void } = {
  activeElement: null, pointerLockElement: null, hidden: false,
  exitPointerLock: () => { dom.pointerLockElement = null },
}
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const oldElement = Object.getOwnPropertyDescriptor(globalThis, 'Element')
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom })
Object.defineProperty(globalThis, 'Element', { configurable: true, value: TestElement })
after(() => {
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
  else Reflect.deleteProperty(globalThis, 'document')
  if (oldElement) Object.defineProperty(globalThis, 'Element', oldElement)
  else Reflect.deleteProperty(globalThis, 'Element')
})
beforeEach(() => { dom.activeElement = null; dom.pointerLockElement = null; dom.hidden = false })

function key(code: string, repeat = false) {
  return {
    code, repeat, defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false,
    target: dom.activeElement, preventDefault() { this.defaultPrevented = true },
  }
}

function pointer(pointerId: number, x: number, y: number, pointerType = 'mouse') {
  return {
    pointerId, clientX: x, clientY: y, pointerType, button: 0, buttons: 1, ctrlKey: false,
    altKey: false, metaKey: false, type: 'pointerdown', preventDefault() {},
  }
}

interface Attacker extends CombatActor {
  id: string
  mesh: THREE.Group
  attackCooldown: number
  action: object | null
  chargeTimer: number
  velocity: THREE.Vector3
}

interface EngineProbe {
  faction: Faction
  keys: Set<string>
  player: THREE.Group
  body: BodyState
  health: number
  stamina: number
  maxStamina: number
  damage: number
  abilityCooldown: number
  attackCooldown: number
  attackAnimation: number
  shieldActive: boolean
  cameraYaw: number
  cameraPitch: number
  paused: boolean
  ended: boolean
  honestMelee: boolean
  elapsed: number
  melee: PlayerMeleeState
  combatMastery: CombatMasteryState
  actors: Attacker[]
  renderer: { domElement: TestElement }
  pointerFallback: boolean
  lookGesture: LookGesture | null
  setInput(code: string, active: boolean): void
  onKeyDown(event: ReturnType<typeof key>): void
  onKeyUp(event: ReturnType<typeof key>): void
  onWorldPointerDown(event: ReturnType<typeof pointer>): void
  onWorldPointerMove(event: ReturnType<typeof pointer>): void
  onWorldPointerUp(event: ReturnType<typeof pointer>): void
  onWorldPointerCancel(event: ReturnType<typeof pointer>): void
  onMouseDown(event: ReturnType<typeof pointer> & { target: TestElement }): void
  onMouseUp(event: ReturnType<typeof pointer> & { target: TestElement }): void
  onPointerLockChange(): void
  onWindowBlur(): void
  onVisibilityChange(): void
  setPaused(paused: boolean): void
  evade(): void
  attack(): void
  setShield(active: boolean): void
  useAbility(): void
  updatePlayer(delta: number): void
  updatePlayerMelee(delta: number): void
  actorAttackPlayer(actor: Attacker): void
  damagePlayer(damage: number | (() => number), incoming: THREE.Vector3, canInjure: boolean, options: {
    attackKind: CombatAttackKind; sourceActorId?: string
  }): CombatOutcome
}

function fixture(faction: Faction = 'elf', collision = new CollisionWorld({
  bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
  sampleHeight: () => 0, isWalkableSlope: () => true,
})) {
  dom.activeElement = null
  const counts = { draws: 0, injuries: 0, damageRecords: 0, hitFx: 0, attacks: 0, pauses: 0, saves: 0, sounds: [] as SoundCue[], notices: [] as string[] }
  const player = new THREE.Group()
  const surface = new TestElement()
  const attacker: Attacker = {
    id: 'attacker', role: 'soldier', mesh: new THREE.Group(), alive: true, hp: 100, maxHp: 100,
    reaction: 'none', reactionRemaining: 0, poise: 28, maxPoise: 28, poiseRecoveryDelay: 0,
    staggerImmunity: 0, attackCooldown: 0, action: {}, chargeTimer: 0, velocity: new THREE.Vector3(),
  }
  attacker.mesh.position.set(0, 0, -2)
  const engine: EngineProbe = Object.assign(Object.create(GameEngine.prototype), {
    faction, player, renderer: { domElement: surface }, keys: new Set<string>(),
    body: createHealthyBody(), health: 70, stamina: 100, maxStamina: 100, damage: 26,
    abilityCooldown: 0, attackCooldown: 0, attackAnimation: 0, shieldActive: false,
    cameraYaw: 0, cameraPitch: 0.38, paused: false, ended: false, honestMelee: true,
    elapsed: 0, melee: createPlayerMeleeState(), combatMastery: createCombatMasteryState(),
    finale: createFinaleState(createFinaleIdentity(blueprint, faction)),
    finaleTelegraphs: [], finaleTelegraphAction: null,
    actors: [attacker], generatedWorld: { collision }, doctrineEffects: { forcedMarch: false },
    onGround: true, verticalVelocity: 0, airborneTime: 0, jumpAccentArmed: true,
    wasSprinting: false, isSprinting: false, reducedMotion: false, damageFlash: 0,
    playerPose: { stride: 0, attack: 0, anticipation: 0, recovery: 0, flinch: 0, stagger: 0 },
    pointerFallback: false, pointerLockPending: false, inputDisposed: false, lookGesture: null, mousePointerId: null,
    weaponTrail: { visible: false, material: { opacity: 0 } },
    damageNumberFx: [], comicCalloutFx: [], impactRayFx: [],
    audio: { setPaused() {}, setHidden() {} },
    callbacks: {
      onNotice: (text: string) => counts.notices.push(text),
      onPauseRequest: () => { counts.pauses += 1 },
      onSaveRequest: () => { counts.saves += 1 },
    },
    achievements: { recordPlayerDamage: () => { counts.damageRecords += 1 }, recordAbilityUse() {} },
    combatRng: () => { counts.draws += 1; return 0 },
    emitView() {}, resumeAudio() {}, animateCharacter() {}, updateShieldPose() {},
    groundHeightAt: () => 0, zoneAtPosition: () => 'neutral', queueCameraAccent() {},
    actorDamageWithAura: (_actor: Attacker, damage: number) => damage,
    enemyDamageMultiplier: () => 1,
    addTrauma() {}, createSparks() {}, createBloodBurst() {}, createHitParticles() {},
    injurePlayer: () => { counts.injuries += 1 },
    presentCombatFeedback: () => { counts.hitFx += 1 },
    playSound: (cue: SoundCue) => { counts.sounds.push(cue) },
    resetCameraMotion() {}, releaseActorTelegraph() {}, releaseAllTelegraphs() {},
  })
  const attack = engine.attack.bind(engine)
  engine.attack = () => { counts.attacks += 1; attack() }
  return { engine, counts, attacker, collision, surface }
}

function mouseDown(engine: EngineProbe, event: ReturnType<typeof pointer>): void {
  engine.onWorldPointerDown(event)
  engine.onMouseDown({ ...event, target: engine.renderer.domElement })
}

function mouseUp(engine: EngineProbe, event: ReturnType<typeof pointer>): void {
  engine.onWorldPointerUp(event)
  engine.onMouseUp({ ...event, target: engine.renderer.domElement })
}

test('real keyboard and public touch action spend once, normalize diagonals and travel within 4.2', () => {
  for (const faction of ['elf', 'guard', 'villain'] as const) {
    for (const hz of [30, 60, 144]) {
      for (const touch of [false, true]) {
        const { engine } = fixture(faction)
        engine.setInput('KeyW', true)
        engine.setInput('KeyD', true)
        if (touch) engine.evade()
        else engine.onKeyDown(key('KeyC'))
        assert.equal(engine.stamina, 75)
        while (engine.combatMastery.evadeRemaining > 0) {
          if (!touch) engine.onKeyDown(key('KeyC', true))
          engine.updatePlayerMelee(1 / hz)
          engine.updatePlayer(1 / hz)
        }
        assert.equal(engine.stamina, 75, 'an active step must not regenerate or spend twice')
        assert.ok(Math.abs(Math.hypot(engine.player.position.x, engine.player.position.z) - EVADE_DISTANCE) < 1e-8)
        assert.ok(Math.abs(engine.player.position.x + engine.player.position.z) < 1e-8)
        assert.equal(engine.melee.bufferRemaining, 0)
      }
    }
  }
})

test('engine rejects actions during evasion and does not change the honestMelee off arm', () => {
  const { engine } = fixture('guard')
  engine.setShield(true)
  engine.evade()
  assert.equal(engine.shieldActive, false)
  engine.attack()
  engine.setShield(true)
  engine.useAbility()
  assert.equal(engine.melee.bufferRemaining, 0)
  assert.equal(engine.shieldActive, false)
  assert.equal(engine.stamina, 75)

  const legacy = fixture()
  legacy.engine.honestMelee = false
  legacy.engine.actors = []
  legacy.engine.attack()
  assert.equal(legacy.engine.attackCooldown, 0.52)
  assert.equal(legacy.engine.melee.beat, 0)
  legacy.engine.evade()
  legacy.engine.attackCooldown = 0
  legacy.engine.attack()
  assert.equal(legacy.engine.attackCooldown, 0, 'even the comparison arm cannot attack during a step')
})

test('the actual actor melee path admits defense before damage RNG, injury, achievement or feedback', () => {
  for (const [time, avoids] of [[0.05, false], [0.1, true], [0.2, false]] as const) {
    const { engine, attacker, counts } = fixture()
    engine.evade()
    engine.updatePlayer(time)
    engine.actorAttackPlayer(attacker)
    assert.equal(engine.health, avoids ? 70 : 64)
    assert.equal(counts.draws, avoids ? 0 : 2, 'ordinary melee damage and injury each draw only after admission')
    assert.equal(counts.injuries, avoids ? 0 : 1)
    assert.equal(counts.damageRecords, avoids ? 0 : 1)
    assert.equal(counts.hitFx, avoids ? 0 : 1)
  }
  const control = fixture()
  control.engine.evade()
  control.engine.updatePlayer(0.1)
  control.engine.combatMastery.evadeProtection = false
  control.engine.actorAttackPlayer(control.attacker)
  assert.notEqual(control.engine.health, 70, 'removing admission must fail the avoided-contact scenario')
  assert.ok(control.counts.injuries > 0)
})

test('real shield contacts distinguish perfect, second, rear, late, poor and arrow cases', () => {
  const front = new THREE.Vector3(0, 0, -1)
  const perfect = fixture('guard')
  perfect.engine.setShield(true)
  perfect.engine.actorAttackPlayer(perfect.attacker)
  assert.equal(perfect.engine.health, 70)
  assert.equal(perfect.engine.stamina, 88)
  assert.equal(perfect.attacker.reaction, 'stagger')
  assert.equal(perfect.attacker.action, null)
  assert.equal(perfect.attacker.hp, 100)
  assert.equal(perfect.counts.draws, 0)
  perfect.engine.actorAttackPlayer(perfect.attacker)
  assert.ok(perfect.engine.health < 70)
  assert.equal(perfect.engine.stamina, 88)
  assert.equal(perfect.counts.injuries, 0)

  for (const kind of ['rear', 'late', 'poor', 'arrow'] as const) {
    const { engine, attacker } = fixture('guard')
    if (kind === 'poor') engine.stamina = 11
    engine.setShield(true)
    if (kind === 'late') engine.updatePlayer(0.13)
    const result = engine.damagePlayer(20, kind === 'rear' ? front.clone().negate() : front, true, {
      attackKind: kind === 'arrow' ? 'actorArrow' : 'allyMelee', sourceActorId: attacker.id,
    })
    if (kind === 'arrow') {
      assert.equal(result.dealt, 0)
      assert.equal(engine.stamina, 88)
    } else assert.equal(result.dealt, 20 * 0.72 * (kind === 'rear' ? 1 : 0.15))
    assert.equal(attacker.reaction, 'none', `${kind} must not interrupt a melee attacker`)
  }
  const orphan = fixture('guard')
  orphan.engine.setShield(true)
  assert.equal(orphan.engine.damagePlayer(20, front, false, {
    attackKind: 'actorArrow', sourceActorId: 'gone',
  }).dealt, 0)
  const exhausted = fixture('guard')
  exhausted.engine.stamina = 12
  exhausted.engine.setShield(true)
  exhausted.engine.damagePlayer(20, front, false, { attackKind: 'allyMelee' })
  assert.equal(exhausted.engine.stamina, 0)
  assert.equal(exhausted.engine.shieldActive, false)
  assert.equal(exhausted.engine.damagePlayer(20, front, false, { attackKind: 'allyMelee' }).dealt, 20 * 0.72)
})

test('engine evasion uses the normal collision path for walls, water, bridges, slopes and streaming bounds', () => {
  for (const hz of [20, 30, 60, 144]) {
    for (const obstacle of ['wall', 'water', 'bridge', 'boundary', 'slope'] as const) {
      const collision = new CollisionWorld({
        bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
        sampleHeight: () => 0,
        isWalkableSlope: (x: number) => obstacle !== 'slope' || x <= 1.3,
      })
      if (obstacle === 'wall' || obstacle === 'water') {
        collision.registerBox({
          id: obstacle, regionId: 'region:0:0', x: 2, z: 0, halfWidth: 0.2, halfDepth: 10,
          tags: obstacle === 'water' ? ['water', 'river'] : [],
        })
      }
      if (obstacle === 'bridge') {
        for (const z of [-6, 6]) collision.registerBox({
          id: `water:${z}`, regionId: 'region:0:0', x: 2, z, halfWidth: 0.2, halfDepth: 4,
          tags: ['water', 'river'],
        })
      }
      if (obstacle === 'boundary') collision.setActiveBounds({ minX: -10, maxX: 2, minZ: -10, maxZ: 10 })
      const { engine } = fixture('elf', collision)
      engine.setInput('KeyD', true)
      engine.evade()
      while (engine.combatMastery.evadeRemaining > 0) engine.updatePlayer(1 / hz)
      assert.equal(engine.stamina, 75)
      assert.ok(engine.combatMastery.evadeCooldown < EVADE_COOLDOWN)
      if (obstacle === 'bridge') assert.ok(Math.abs(engine.player.position.x - 4.2) < 1e-8)
      else assert.ok(engine.player.position.x <= 1.360001, `${obstacle} tunneled at ${hz} Hz`)
      assert.equal(collision.isWalkablePosition(engine.player.position.x, engine.player.position.z, 0.64), true)
    }
  }
})

test('the engine releases inputs without renewing defenses or cancelling committed finishers', () => {
  for (const cancel of ['blur', 'pause', 'pointercancel', 'hidden', 'unlock'] as const) {
    const { engine, surface } = fixture('guard')
    engine.pointerFallback = true
    mouseDown(engine, pointer(3, 0, 0))
    assert.ok(surface.hasPointerCapture(3))
    engine.setInput('KeyW', true)
    engine.evade()
    engine.updatePlayer(0.1)
    const remaining = engine.combatMastery.evadeRemaining
    const cooldown = engine.combatMastery.evadeCooldown
    assert.equal(isEvadeWindow(engine.combatMastery), true)
    if (cancel === 'blur') engine.onWindowBlur()
    if (cancel === 'pause') engine.setPaused(true)
    if (cancel === 'pointercancel') engine.onWorldPointerCancel({ ...pointer(3, 0, 0), type: 'pointercancel' })
    if (cancel === 'hidden') { dom.hidden = true; engine.onVisibilityChange() }
    if (cancel === 'unlock') engine.onPointerLockChange()
    assert.equal(engine.keys.size, 0)
    assert.equal(surface.captures.size, 0)
    assert.equal(engine.lookGesture, null)
    assert.equal(isEvadeWindow(engine.combatMastery), false)
    assert.equal(engine.combatMastery.evadeRemaining, remaining)
    assert.equal(engine.combatMastery.evadeCooldown, cooldown)
    assert.equal(engine.stamina, 75)
  }
  const { engine } = fixture()
  Object.assign(engine.melee, { beat: 3, phase: 'windup', phaseRemaining: 0.1, bufferRemaining: 0.4 })
  engine.onWindowBlur()
  assert.equal(engine.melee.phase, 'windup')
  assert.equal(engine.melee.phaseRemaining, 0.1)
  assert.equal(engine.melee.bufferRemaining, 0)
  engine.setPaused(true)
  engine.setPaused(false)
  engine.evade()
  assert.equal(engine.combatMastery.evadeRemaining, 0)
  assert.equal(engine.melee.beat, 3)
})

test('repeat C, browser shortcuts, text entry, pause and death cannot create an input action', () => {
  for (const blocked of ['repeat', 'shortcut', 'text', 'paused', 'ended', 'prevented'] as const) {
    const { engine } = fixture()
    const event = key('KeyC', blocked === 'repeat')
    if (blocked === 'shortcut') event.ctrlKey = true
    if (blocked === 'text') {
      const input = new TestElement()
      input.editable = true
      event.target = input
      dom.activeElement = input
    }
    if (blocked === 'paused') engine.paused = true
    if (blocked === 'ended') engine.ended = true
    if (blocked === 'prevented') event.defaultPrevented = true
    engine.onKeyDown(event)
    assert.equal(engine.stamina, 100, blocked)
    assert.equal(engine.combatMastery.evadeRemaining, 0, blocked)
  }
})

test('F still saves a paused run without capturing browser shortcuts or repeating writes', () => {
  const { engine, counts } = fixture()
  engine.setPaused(true)
  engine.onKeyDown(key('KeyF'))
  engine.onKeyDown(key('KeyF', true))
  engine.onKeyDown(key('KeyF'))
  assert.equal(counts.saves, 1)
  engine.onKeyUp(key('KeyF'))
  engine.onKeyDown({ ...key('KeyF'), ctrlKey: true })
  assert.equal(counts.saves, 1)
  engine.ended = true
  engine.onKeyDown(key('KeyF'))
  assert.equal(counts.saves, 1)
})

test('Escape can close an overlay from a focused field, while typing, composition and shortcuts stay local', () => {
  const { engine, counts } = fixture()
  const input = new TestElement()
  input.editable = true
  dom.activeElement = input
  engine.setPaused(true)
  engine.onKeyDown(key('Escape'))
  assert.equal(counts.pauses, 1)
  engine.onKeyDown(key('Escape', true))
  engine.onKeyDown({ ...key('Escape'), ctrlKey: true })
  engine.onKeyDown({ ...key('Escape'), isComposing: true })
  engine.onKeyDown(key('KeyP'))
  engine.onKeyDown(key('KeyC'))
  assert.equal(counts.pauses, 1)
  assert.equal(engine.stamina, 100)
})

test('failed native capture enables live click/drag camera handling without attack duplication or retry loops', async () => {
  const { engine, surface, counts } = fixture()
  let requests = 0
  surface.requestPointerLock = () => {
    requests += 1
    return Promise.reject(new DOMException('embedded', 'WrongDocumentError'))
  }
  mouseDown(engine, pointer(1, 100, 100))
  await Promise.resolve()
  mouseUp(engine, pointer(1, 100, 100))
  assert.equal(engine.pointerFallback, true)
  assert.equal(counts.notices.length, 1)
  assert.equal(counts.attacks, 0)
  mouseDown(engine, pointer(1, 100, 100))
  mouseUp(engine, pointer(1, 100, 100))
  assert.equal(counts.attacks, 1)
  assert.ok(engine.melee.bufferRemaining > 0)
  mouseDown(engine, pointer(2, 100, 100))
  engine.onWorldPointerMove(pointer(2, 140, 110))
  engine.onWorldPointerMove(pointer(99, 700, 300))
  mouseUp(engine, pointer(2, 140, 110))
  assert.equal(engine.cameraYaw, 40 * 0.0028)
  assert.equal(counts.attacks, 1)
  assert.equal(requests, 1)
  assert.equal(surface.captures.size, 0)
})

test('both mouse chord orders attack once and release the shield in native and fallback modes', () => {
  for (const locked of [false, true]) {
    for (const firstButton of [0, 2]) {
      const { engine, surface, counts } = fixture('guard')
      engine.pointerFallback = !locked
      dom.pointerLockElement = locked ? surface : null
      const secondButton = firstButton === 0 ? 2 : 0
      const firstMask = firstButton === 0 ? 1 : 2
      const secondMask = secondButton === 0 ? 1 : 2
      const edge = (button: number, buttons: number) => ({ ...pointer(1, 100, 100), button, buttons })
      mouseDown(engine, edge(firstButton, firstMask))
      // A chord's intermediate press/release is pointermove, not pointerdown/up.
      engine.onWorldPointerMove(edge(secondButton, 3))
      engine.onMouseDown({ ...edge(secondButton, 3), target: surface })
      assert.equal(engine.shieldActive, true)
      engine.onWorldPointerMove(edge(firstButton, secondMask))
      engine.onMouseUp({ ...edge(firstButton, secondMask), target: surface })
      if (firstButton === 2) assert.equal(engine.shieldActive, false)
      mouseUp(engine, edge(secondButton, 0))
      assert.equal(engine.shieldActive, false)
      assert.equal(engine.lookGesture, null)
      assert.equal(counts.attacks, 1)
    }
  }
})

test('a paid saved finisher expires in legacy mode and resolves its remaining contact only once', () => {
  for (const phase of ['windup', 'recovery'] as const) {
    const { engine, counts } = fixture()
    const melee = createPlayerMeleeState()
    Object.assign(melee, { beat: 3, phase, phaseRemaining: 0.1 })
    const restored = normalizeCombatMastery(
      serializeCombatMastery(createCombatMasteryState(), melee, 0, 0, false), 'elf',
    )
    engine.honestMelee = false
    engine.melee = restored.melee
    engine.stamina = 100 - playerBeatSpec(3).staminaCost
    engine.actors = []
    engine.attack()
    assert.equal(engine.attackCooldown, 0, 'legacy attacks must not bypass the saved commitment')
    for (let frame = 0; frame < 600; frame += 1) engine.updatePlayerMelee(1 / 60)
    assert.equal(engine.melee.phase, 'idle')
    assert.equal(engine.melee.lockout, 0)
    assert.equal(counts.sounds.filter(cue => cue === 'whiff').length, phase === 'windup' ? 1 : 0)
    assert.equal(engine.stamina, 78, 'continuing cannot charge the finisher twice')
    engine.attack()
    assert.equal(engine.attackCooldown, 0.52)
    assert.equal(engine.melee.bufferRemaining, 0, 'future legacy swings must not start a new combo')
    engine.evade()
    assert.equal(engine.combatMastery.evadeRemaining, 0.3)
    assert.equal(engine.stamina, 53)
  }
})

test('touch camera and movement pointers stay independent; pointer cancellation never completes a click', () => {
  const { engine, counts } = fixture('guard')
  engine.setInput('KeyW', true)
  engine.onWorldPointerDown(pointer(7, 100, 100, 'touch'))
  engine.onWorldPointerMove(pointer(7, 130, 100, 'touch'))
  engine.onWorldPointerMove(pointer(8, 900, 600, 'touch'))
  engine.onWorldPointerUp(pointer(8, 900, 600, 'touch'))
  assert.ok(engine.keys.has('KeyW'))
  assert.equal(engine.lookGesture?.pointerId, 7)
  assert.equal(engine.cameraYaw, 30 * 0.0028)
  engine.onWorldPointerCancel({ ...pointer(7, 130, 100, 'touch'), type: 'pointercancel' })
  engine.onWorldPointerUp(pointer(7, 130, 100, 'touch'))
  assert.equal(counts.attacks, 0)
  assert.equal(engine.keys.size, 0)
  engine.onKeyDown(key('KeyR'))
  assert.equal(engine.shieldActive, true, 'R must work without native pointer lock')
  engine.onKeyUp(key('KeyR'))
  assert.equal(engine.shieldActive, false)
})
