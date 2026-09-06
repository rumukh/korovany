import assert from 'node:assert/strict'
import test from 'node:test'
import { createHealthyBody, type Faction } from '../src/game/types.ts'
import {
  advancePlayerMelee,
  advanceReaction,
  bufferPlayerMelee,
  canStartAction,
  createPlayerMeleeState,
  playerBeatSpec,
  type CombatActor,
} from '../src/game/world/CombatResolver.ts'
import {
  EVADE_COOLDOWN,
  EVADE_DISTANCE,
  EVADE_DURATION,
  EVADE_STAMINA_COST,
  EVADE_WINDOW_END,
  EVADE_WINDOW_START,
  PERFECT_GUARD_COST,
  PERFECT_GUARD_OPENING,
  PERFECT_GUARD_REARM,
  PERFECT_GUARD_WINDOW,
  advanceCombatMastery,
  applyPerfectGuardOpening,
  beginEvade,
  buildCombatMasteryView,
  createCombatMasteryState,
  evadeReadiness,
  isEvadeWindow,
  normalizeCombatMastery,
  raisePerfectGuard,
  resolveCombatMasteryContact,
  serializeCombatMastery,
  settleCombatMastery,
} from '../src/game/world/CombatMastery.ts'
import {
  LOOK_DRAG_THRESHOLD,
  GameplayPointerCaptures,
  beginLookGesture,
  bindGameplayPointerCancellation,
  cameraRelativeMovement,
  finishLookGesture,
  instantGameplayAction,
  moveLookGesture,
} from '../src/game/input/CombatInput.ts'

function context() {
  return {
    body: createHealthyBody(), melee: createPlayerMeleeState(), stamina: 100,
    paused: false, ended: false, moveX: 1, moveZ: 0, aimX: 0, aimZ: -1,
  }
}

function contact(state = createCombatMasteryState()) {
  return {
    state, baseDamage: 20, health: 70, shieldActive: false, hasIncomingDirection: true,
    incomingDotAim: 1, armor: 1, stamina: 100, attackKind: 'allyMelee' as const,
  }
}

test('the shipping timings and costs are fixed, with diagonal and backward directions', () => {
  assert.deepEqual(
    [EVADE_STAMINA_COST, EVADE_DURATION, EVADE_DISTANCE, EVADE_WINDOW_START, EVADE_WINDOW_END, EVADE_COOLDOWN],
    [25, 0.30, 4.2, 0.06, 0.18, 0.85],
  )
  assert.deepEqual([PERFECT_GUARD_WINDOW, PERFECT_GUARD_COST, PERFECT_GUARD_REARM], [0.12, 12, 0.65])
  for (const yaw of [0, Math.PI / 2, -1.8]) {
    const move = cameraRelativeMovement(new Set(['KeyW', 'KeyD']), yaw)
    const state = createCombatMasteryState()
    const result = beginEvade(state, { ...context(), moveX: move.x, moveZ: move.z })
    assert.equal(result.staminaSpent, 25)
    const travelled = advanceCombatMastery(state, EVADE_DURATION)
    assert.ok(Math.abs(Math.hypot(travelled.x, travelled.z) - 4.2) < 1e-9)
    assert.ok(Math.abs(travelled.x / travelled.z - move.x / move.z) < 1e-9)
  }
  const back = createCombatMasteryState()
  beginEvade(back, { ...context(), moveX: 0, moveZ: 0 })
  assert.deepEqual(advanceCombatMastery(back, 0.3), { x: -0, z: 4.2, activeSeconds: 0.3 })
})

test('leg losses and prostheses affect the step, not its cost or defensive clock', () => {
  for (const [leftLeg, rightLeg, scale] of [
    ['healthy', 'healthy', 1], ['missing', 'healthy', 0.53],
    ['prosthetic', 'healthy', 0.9], ['missing', 'prosthetic', 0.53 * 0.9],
    ['prosthetic', 'prosthetic', 0.9],
  ] as const) {
    const input = context()
    input.body.leftLeg = leftLeg
    input.body.rightLeg = rightLeg
    const state = createCombatMasteryState()
    assert.equal(beginEvade(state, input).staminaSpent, 25)
    assert.equal(state.evadeRemaining, 0.3)
    assert.ok(Math.abs(advanceCombatMastery(state, 0.3).x - 4.2 * scale) < 1e-9)
  }
  const input = context()
  input.body.leftLeg = 'missing'
  input.body.rightLeg = 'missing'
  assert.equal(beginEvade(createCombatMasteryState(), input).reason, 'legs')
})

test('early beats cancel, but windup and recovery of the finisher remain committed', () => {
  for (const beat of [1, 2, 3]) {
    for (const phase of ['windup', 'recovery'] as const) {
      const input = context()
      Object.assign(input.melee, { beat, phase, phaseRemaining: 0.1, bufferRemaining: 0.3 })
      const before = { ...input.melee }
      const result = beginEvade(createCombatMasteryState(), input)
      assert.equal(result.accepted, beat !== 3)
      if (beat === 3) assert.deepEqual(input.melee, before)
      else assert.deepEqual(input.melee, createPlayerMeleeState())
    }
  }
})

test('unready actions reject without spending or queuing state', () => {
  for (const [patch, expected] of [
    [{ stamina: 24.999 }, 'stamina'], [{ stamina: 0 }, 'stamina'], [{ stamina: NaN }, 'stamina'],
    [{ paused: true }, 'paused'], [{ ended: true }, 'ended'], [{ inputBlocked: true }, 'input'],
  ] as const) {
    const state = createCombatMasteryState()
    assert.equal(beginEvade(state, { ...context(), ...patch }).reason, expected)
    assert.deepEqual(state, createCombatMasteryState())
  }
  const state = createCombatMasteryState()
  beginEvade(state, context())
  const paid = { ...state }
  for (let repeat = 0; repeat < 40; repeat += 1) {
    assert.equal(beginEvade(state, context()).staminaSpent, 0)
    assert.deepEqual(state, paid)
  }
  advanceCombatMastery(state, 0.3)
  assert.equal(beginEvade(state, context()).reason, 'cooldown')
  advanceCombatMastery(state, 0.55)
  assert.equal(evadeReadiness(state, context()), 'ready')
})

test('identical contacts hit / evade / hit at both exact evasion boundaries', () => {
  for (const [age, avoids] of [
    [0, false], [0.059999, false], [0.06, true], [0.12, true],
    [0.18, true], [0.180001, false], [0.3, false],
  ] as const) {
    const state = createCombatMasteryState()
    beginEvade(state, context())
    advanceCombatMastery(state, age)
    let draws = 0
    const result = resolveCombatMasteryContact({
      ...contact(state), baseDamage: () => { draws += 1; return 20 },
    })
    assert.equal(result.defense, avoids ? 'evaded' : 'none', `age ${age}`)
    assert.equal(result.dealt, avoids ? 0 : 20)
    assert.equal(draws, avoids ? 0 : 1)
    assert.equal(result.applied, !avoids)
  }
})

test('environmental damage and corpse contacts do not buy combat protection', () => {
  const state = createCombatMasteryState()
  beginEvade(state, context())
  advanceCombatMastery(state, 0.1)
  assert.equal(resolveCombatMasteryContact({ ...contact(state), eligible: false }).dealt, 20)
  let draws = 0
  assert.equal(resolveCombatMasteryContact({
    ...contact(state), health: 0, baseDamage: () => { draws += 1; return 20 },
  }).applied, false)
  assert.equal(draws, 0)
})

test('perfect guard is frontal, affordable, single-use, and not renewable by tapping', () => {
  const state = createCombatMasteryState()
  raisePerfectGuard(state)
  const input = { ...contact(state), shieldActive: true, armor: 0.72 }
  assert.equal(resolveCombatMasteryContact({ ...input, incomingDotAim: 0.2 }).dealt, 20 * 0.72)
  assert.equal(resolveCombatMasteryContact({ ...input, stamina: 11.999 }).dealt, 20 * 0.72 * 0.15)
  const perfect = resolveCombatMasteryContact({ ...input, stamina: 12 })
  assert.equal(perfect.defense, 'perfectGuard')
  assert.equal(perfect.staminaSpent, 12)
  assert.equal(perfect.dealt, 0)
  assert.equal(perfect.interruptMelee, true)
  assert.equal(resolveCombatMasteryContact(input).dealt, 20 * 0.72 * 0.15)
  advanceCombatMastery(state, 0.4)
  raisePerfectGuard(state)
  assert.equal(state.guardWindow, 0)
  advanceCombatMastery(state, 0.25)
  raisePerfectGuard(state)
  assert.equal(resolveCombatMasteryContact(input).defense, 'perfectGuard')
})

test('guard window expiry, absent direction, and arrows retain their own rules', () => {
  for (const age of [0, 0.119999, 0.12, 0.120001]) {
    const state = createCombatMasteryState()
    raisePerfectGuard(state)
    advanceCombatMastery(state, age)
    const input = { ...contact(state), shieldActive: true }
    assert.equal(resolveCombatMasteryContact({ ...input, hasIncomingDirection: false }).dealt, 20)
    const result = resolveCombatMasteryContact({ ...input, attackKind: 'actorArrow' })
    assert.equal(result.defense, age < 0.12 ? 'perfectGuard' : 'none')
    assert.equal(result.interruptMelee, false)
  }
})

test('the bounded guard interruption uses the existing action/reaction gate, not damage', () => {
  const actor: CombatActor & { action: null; attackCooldown: number } = {
    role: 'champion', alive: true, hp: 230, maxHp: 230, reaction: 'none', reactionRemaining: 0,
    poise: 72, maxPoise: 72, poiseRecoveryDelay: 0, staggerImmunity: 0, action: null, attackCooldown: 0,
  }
  assert.equal(canStartAction(actor), true)
  applyPerfectGuardOpening(actor)
  assert.equal(canStartAction(actor), false)
  assert.equal(actor.reactionRemaining, PERFECT_GUARD_OPENING)
  assert.equal(actor.hp, 230)
  assert.equal(actor.poise, 72)
  advanceReaction(actor, PERFECT_GUARD_OPENING)
  assert.equal(canStartAction(actor), true)
  actor.alive = false
  assert.equal(applyPerfectGuardOpening(actor), false)
})

test('30/60/144 Hz and capped 50 ms frames integrate one step and one cooldown', () => {
  for (const hz of [20, 30, 60, 144]) {
    const state = createCombatMasteryState()
    beginEvade(state, context())
    let time = 0
    let travel = 0
    let firstProtected = -1
    let lastProtected = -1
    while (state.evadeCooldown > 0) {
      time += 1 / hz
      travel += advanceCombatMastery(state, 1 / hz).x
      if (isEvadeWindow(state)) {
        if (firstProtected < 0) firstProtected = time
        lastProtected = time
      }
    }
    assert.ok(Math.abs(travel - 4.2) < 1e-8, `${hz} Hz travel ${travel}`)
    assert.ok(firstProtected >= 0.06 - 1e-9 && firstProtected < 0.06 + 1 / hz)
    assert.ok(lastProtected <= 0.18 + 1e-9 && lastProtected > 0.18 - 1 / hz)
    assert.ok(time >= 0.85 - 1e-9 && time < 0.85 + 1 / hz)
  }
})

test('pause and repeat continue settle protection but preserve paid recovery and cooldowns', () => {
  for (const faction of ['elf', 'guard', 'villain'] satisfies Faction[]) {
    const input = context()
    const state = createCombatMasteryState()
    const spent = beginEvade(state, input).staminaSpent
    advanceCombatMastery(state, 0.1)
    assert.equal(isEvadeWindow(state), true)
    let block = serializeCombatMastery(state, input.melee, 0.2, 0.3, false)
    for (let load = 0; load < 5; load += 1) {
      const restored = normalizeCombatMastery(JSON.parse(JSON.stringify(block)), faction)
      assert.equal(restored.rejected, false)
      assert.equal(isEvadeWindow(restored.state), false)
      assert.ok(Math.abs(restored.state.evadeRemaining - 0.2) < 1e-9)
      assert.equal(restored.state.evadeCooldown, state.evadeCooldown)
      assert.equal(input.stamina - spent, 75)
      block = serializeCombatMastery(restored.state, restored.melee, restored.abilityCooldown, restored.attackCooldown, false)
    }
    settleCombatMastery(state, input.melee)
    assert.equal(isEvadeWindow(state), false)
    assert.deepEqual(advanceCombatMastery(state, 0.1), { x: 0, z: 0, activeSeconds: 0.1 })
  }
})

test('a save cannot reopen a guard window or skip/duplicate a committed contact', () => {
  const state = createCombatMasteryState()
  const melee = createPlayerMeleeState()
  raisePerfectGuard(state)
  advanceCombatMastery(state, 0.04)
  const guard = normalizeCombatMastery(serializeCombatMastery(state, melee, 0, 0, true), 'guard')
  assert.equal(guard.state.guardWindow, 0)
  assert.ok(Math.abs(guard.state.guardRearm - 0.61) < 1e-9)
  assert.equal(guard.abilityCooldown, 0.4)
  raisePerfectGuard(guard.state)
  assert.equal(guard.state.guardWindow, 0)

  for (const phase of ['windup', 'recovery'] as const) {
    Object.assign(melee, { beat: 3, phase, phaseRemaining: 0.1, bufferRemaining: 0.4 })
    const loaded = normalizeCombatMastery(serializeCombatMastery(state, melee, 0, 0, false), 'elf')
    assert.equal(loaded.melee.bufferRemaining, 0)
    assert.equal(beginEvade(loaded.state, { ...context(), melee: loaded.melee }).reason, 'committed')
    const step = advancePlayerMelee(loaded.melee, { delta: 0.101, stamina: 0 })
    assert.equal(step.contactBeat, phase === 'windup' ? 3 : 0)
    assert.equal(step.staminaSpent, 0)
  }
})

test('old absent saves are inactive; malformed present blocks are reported and never protected', () => {
  assert.equal(normalizeCombatMastery(undefined, 'elf').rejected, false)
  const state = createCombatMasteryState()
  const block = serializeCombatMastery(state, createPlayerMeleeState(), 0, 0, false)
  for (const corrupt of [
    null, {}, { ...block, version: 9 }, { ...block, evadeRemaining: NaN },
    { ...block, evadeCooldown: Infinity }, { ...block, guardRearm: -10 },
    { ...block, evadeCooldown: 100 }, { ...block, melee: { ...block.melee, phase: 'invincible' } },
  ]) {
    const result = normalizeCombatMastery(corrupt, 'elf')
    assert.equal(result.rejected, true)
    assert.equal(isEvadeWindow(result.state), false)
    assert.equal(result.state.guardWindow, 0)
    assert.ok(Number.isFinite(result.state.evadeRemaining))
    assert.ok(result.state.evadeCooldown <= 0.85)
  }
})

test('corrupt timers cannot erase cooldowns or manufacture a finisher contact on continue', () => {
  const melee = createPlayerMeleeState()
  Object.assign(melee, { beat: 3, phase: 'windup', phaseRemaining: 0.1 })
  const block = serializeCombatMastery(createCombatMasteryState(), melee, 0, 0, false)
  const restored = normalizeCombatMastery({
    ...block, evadeCooldown: -1, melee: { ...block.melee, phaseRemaining: NaN },
  }, 'guard')
  assert.equal(restored.rejected, true)
  assert.equal(restored.state.evadeCooldown, EVADE_COOLDOWN)
  assert.equal(restored.state.guardRearm, PERFECT_GUARD_REARM)
  assert.equal(restored.melee.phase, 'recovery')
  assert.equal(advancePlayerMelee(restored.melee, { delta: 0.3, stamina: 100 }).contactBeat, 0)
})

test('the HUD reports committed/stamina/cooldown states and does not advertise an active guard twice', () => {
  const input = context()
  const state = createCombatMasteryState()
  const viewInput = { ...input, state, faction: 'guard' as const, shieldActive: false, abilityCooldown: 0, cameraMode: 'drag' as const }
  assert.equal(buildCombatMasteryView(viewInput).evadeReady, true)
  assert.equal(buildCombatMasteryView({ ...viewInput, stamina: 24 }).evadeReason, 'stamina')
  bufferPlayerMelee(input.melee)
  Object.assign(input.melee, { beat: 3, phase: 'windup', phaseRemaining: playerBeatSpec(3).windup })
  assert.equal(buildCombatMasteryView(viewInput).evadeReason, 'committed')
  assert.equal(buildCombatMasteryView(viewInput).perfectGuard?.ready, false)
  input.melee = createPlayerMeleeState()
  raisePerfectGuard(state)
  const guarding = { ...viewInput, melee: input.melee, shieldActive: true }
  assert.equal(buildCombatMasteryView(guarding).perfectGuard?.window, true)
  resolveCombatMasteryContact({ ...contact(state), shieldActive: true })
  assert.equal(buildCombatMasteryView(guarding).perfectGuard?.window, false)
})

test('click/drag threshold, cancellation, returning to origin and a second finger cannot create a swing', () => {
  const click = beginLookGesture(1, 100, 100)
  assert.deepEqual(moveLookGesture(click, 1, 100 + LOOK_DRAG_THRESHOLD - 0.01, 100), { x: 0, y: 0 })
  assert.equal(finishLookGesture(click, 1, false), true)
  const drag = beginLookGesture(2, 100, 100)
  assert.deepEqual(moveLookGesture(drag, 3, 250, 400), { x: 0, y: 0 })
  assert.equal(drag.dragged, false)
  assert.equal(finishLookGesture(drag, 3, false), false)
  assert.deepEqual(moveLookGesture(drag, 2, 106, 100), { x: 6, y: 0 })
  moveLookGesture(drag, 2, 100, 100)
  assert.equal(finishLookGesture(drag, 2, false), false)
  assert.equal(finishLookGesture(click, 1, true), false)
})

test('instant actions accept a secondary pointer without needing a synthetic click or duplicating it', () => {
  let actions = 0
  let prevented = 0
  const handlers = instantGameplayAction(() => { actions += 1 })
  const secondaryPointer = { button: 0, isPrimary: false, preventDefault: () => { prevented += 1 } }
  handlers.onPointerDown(secondaryPointer)
  assert.equal(actions, 1, 'the second finger must act even if no click follows')
  assert.equal(prevented, 1)
  handlers.onClick({ detail: 1 })
  assert.equal(actions, 1, 'a compatibility click must not duplicate the action')
  handlers.onClick({ detail: 0 })
  assert.equal(actions, 2, 'keyboard activation must still work')
  handlers.onPointerDown({ ...secondaryPointer, button: 2 })
  assert.equal(actions, 2)
})

test('HUD capture ownership releases every held pointer on pause/blur and tolerates lost capture', () => {
  const target = () => {
    const held = new Set<number>()
    return {
      held,
      setPointerCapture: (id: number) => { held.add(id) },
      hasPointerCapture: (id: number) => held.has(id),
      releasePointerCapture: (id: number) => { held.delete(id) },
    }
  }
  const movement = target()
  const shield = target()
  const captures = new GameplayPointerCaptures()
  captures.capture(movement, 4)
  captures.capture(shield, 7)
  assert.equal(movement.held.size + shield.held.size, 2)
  captures.releaseAll()
  assert.equal(movement.held.size + shield.held.size, 0)
  captures.releaseAll()
  captures.capture(movement, 11)
  movement.held.clear()
  captures.release(11)
  assert.equal(movement.held.size, 0)
})

test('delayed clicks from cancelled HUD touches cannot open a different overlay or the next screen', () => {
  const document = new EventTarget()
  const captures = new GameplayPointerCaptures()
  const unbind = bindGameplayPointerCancellation(document, captures)
  const held = new Set<number>()
  const target = {
    setPointerCapture: (id: number) => { held.add(id) },
    hasPointerCapture: (id: number) => held.has(id),
    releasePointerCapture: (id: number) => { held.delete(id) },
  }
  let activations = 0
  document.addEventListener('click', () => { activations += 1 })
  const event = (type: string, id: number) => {
    const input = new Event(type, { cancelable: true })
    Object.defineProperty(input, 'pointerId', { value: id })
    return input
  }
  captures.capture(target, 18)
  captures.releaseAll()
  assert.equal(document.dispatchEvent(event('click', 18)), false)
  assert.equal(activations, 0)
  document.dispatchEvent(event('click', -1))
  assert.equal(activations, 1, 'keyboard activation is not part of the cancelled gesture')
  captures.capture(target, 1)
  captures.releaseAll()
  document.dispatchEvent(event('pointerdown', 1))
  document.dispatchEvent(event('click', 1))
  assert.equal(activations, 2, 'a fresh mouse press must not inherit the cancelled click')
  captures.cancel(42)
  assert.equal(document.dispatchEvent(event('click', 42)), false, 'world gestures share the App-owned cancellation ledger')
  assert.equal(activations, 2)
  unbind()
})
