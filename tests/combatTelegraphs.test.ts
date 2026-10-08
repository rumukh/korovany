import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test, { after } from 'node:test'
import * as THREE from 'three'
import type { ActorRole } from '../src/game/types.ts'
import {
  actionWindup,
  actorTelegraphSpec,
  isWithinContact,
} from '../src/game/world/CombatResolver.ts'
import {
  EVADE_DISTANCE,
  EVADE_DURATION,
  PLAYER_WALK_SPEED,
} from '../src/game/world/CombatMastery.ts'
import {
  createFinaleIdentity,
  createFinaleState,
} from '../src/game/world/FinaleDirector.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const documentStub = { hidden: false, hasFocus: () => true }
Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub })
after(() => {
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
  else Reflect.deleteProperty(globalThis, 'document')
})

type ActionKind = 'meleePlayer' | 'meleeActor' | 'eventProp' | 'arrow'

interface ActionProbe {
  kind: ActionKind
  phase: 'windup' | 'recovery'
  elapsed: number
  duration: number
  target: { kind: 'player' } | { kind: 'actor'; id: string } | { kind: 'eventProp'; id: string }
  targetPosition: THREE.Vector3
  headingX: number
  headingZ: number
  headingLocked: boolean
  contactRange: number
}

interface ActorProbe {
  id: string
  role: ActorRole
  mesh: THREE.Group
  alive: boolean
  reaction: 'none' | 'flinch' | 'stagger'
  action: ActionProbe | null
  attackCooldown: number
  velocity: THREE.Vector3
  hostileToPlayer: boolean
  targetId: string | null
  retreatTimer: number
  allegiance: 'guard' | 'villain'
}

interface TelegraphProbe {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  ownerId: string | null
  kind: 'tick' | 'aim' | 'commander' | 'wedge'
}

interface EngineProbe {
  player: THREE.Group
  actors: ActorProbe[]
  health: number
  paused: boolean
  ended: boolean
  reducedMotion: boolean
  telegraphPool: TelegraphProbe[]
  startActorAction(
    actor: ActorProbe,
    kind: ActionKind,
    target: ActionProbe['target'],
    targetPosition: THREE.Vector3,
    contactRange: number,
  ): void
  updateActorAction(actor: ActorProbe, delta: number): void
  resolveActorActionContact(actor: ActorProbe, action: ActionProbe): void
  syncActorTelegraphs(): void
}

function makeActor(
  id: string,
  role: ActorRole,
  z = -2,
  allegiance: 'guard' | 'villain' = 'villain',
): ActorProbe {
  const mesh = new THREE.Group()
  mesh.position.set(0, 0, z)
  return {
    id,
    role,
    mesh,
    alive: true,
    reaction: 'none',
    action: null,
    attackCooldown: 0,
    velocity: new THREE.Vector3(),
    hostileToPlayer: true,
    targetId: null,
    retreatTimer: 0,
    allegiance,
  }
}

function fixture(reducedMotion = false) {
  const scene = new THREE.Scene()
  const player = new THREE.Group()
  const world = generateWorld(20260905)
  let contacts = 0
  let actorContacts = 0
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    player,
    actors: [] as ActorProbe[],
    health: 70,
    paused: false,
    ended: false,
    reducedMotion,
    scene,
    palette: {
      warning: new THREE.Color('#ffcb55'),
      danger: new THREE.Color('#f05545'),
    },
    telegraphPool: [] as TelegraphProbe[],
    telegraphGeometries: new Map(),
    finale: createFinaleState(createFinaleIdentity(world, 'elf')),
    eventPropTargets: new Map(),
    actorAttackInterval: (_actor: ActorProbe, seconds: number) => seconds,
    playActorActionSound() {},
    actorAttackPlayer: () => {
      contacts += 1
    },
    actorAttackActor: () => {
      actorContacts += 1
    },
    groundHeightAt: () => 0,
  }) as EngineProbe
  return {
    engine,
    contacts: () => contacts,
    actorContacts: () => actorContacts,
    dispose() {
      for (const entry of engine.telegraphPool) {
        entry.mesh.geometry.dispose()
        entry.mesh.material.dispose()
      }
    },
  }
}

function startAgainstPlayer(engine: EngineProbe, actor: ActorProbe): ActionProbe {
  engine.startActorAction(actor, 'meleePlayer', { kind: 'player' }, engine.player.position, 2.55)
  assert.ok(actor.action)
  return actor.action
}

test('every fast role gets the existing tick while established roles keep their shapes', () => {
  for (const role of ['scout', 'minion', 'wolf', 'boar', 'bear', 'troll'] as const) {
    const value = fixture()
    try {
      const actor = makeActor(role, role)
      value.engine.actors = [actor]
      startAgainstPlayer(value.engine, actor)
      value.engine.syncActorTelegraphs()
      assert.equal(value.engine.telegraphPool.length, 1)
      assert.equal(value.engine.telegraphPool[0].kind, 'tick', role)
      assert.equal(value.engine.telegraphPool[0].mesh.visible, true)
    } finally {
      value.dispose()
    }
  }

  for (const [role, kind] of [
    ['archer', 'aim'],
    ['commander', 'commander'],
    ['brute', 'wedge'],
  ] as const) {
    const value = fixture()
    try {
      const actor = makeActor(role, role)
      value.engine.actors = [actor]
      value.engine.startActorAction(
        actor,
        role === 'archer' ? 'arrow' : 'meleePlayer',
        { kind: 'player' },
        value.engine.player.position,
        2.55,
      )
      value.engine.syncActorTelegraphs()
      assert.equal(value.engine.telegraphPool[0].kind, kind)
    } finally {
      value.dispose()
    }
  }
})

test('the eight-slot pool keeps the nearest direct threats and reassigns without growing', () => {
  const value = fixture()
  try {
    const actors = Array.from({ length: 9 }, (_, index) =>
      makeActor(`scout-${String(index)}`, 'scout', -(index + 1)),
    )
    value.engine.actors = actors
    for (const actor of actors) startAgainstPlayer(value.engine, actor)
    value.engine.syncActorTelegraphs()
    assert.equal(value.engine.telegraphPool.length, 8)
    assert.deepEqual(
      new Set(value.engine.telegraphPool.map((entry) => entry.ownerId)),
      new Set(actors.slice(0, 8).map((actor) => actor.id)),
    )

    actors[8].mesh.position.z = -0.5
    value.engine.syncActorTelegraphs()
    assert.equal(value.engine.telegraphPool.length, 8)
    assert.deepEqual(
      new Set(value.engine.telegraphPool.map((entry) => entry.ownerId)),
      new Set([actors[8], ...actors.slice(0, 7)].map((actor) => actor.id)),
    )
    assert.equal(
      value.engine.telegraphPool.some((entry) => entry.ownerId === actors[7].id),
      false,
      'the former farthest selected threat retained a slot',
    )
  } finally {
    value.dispose()
  }
})

test('reduced motion keeps a static full-length tell instead of hiding information', () => {
  const reduced = fixture(true)
  const moving = fixture(false)
  try {
    for (const value of [reduced, moving]) {
      const actor = makeActor('scout', 'scout')
      value.engine.actors = [actor]
      startAgainstPlayer(value.engine, actor)
      value.engine.syncActorTelegraphs()
    }
    const reducedMesh = reduced.engine.telegraphPool[0].mesh
    const movingMesh = moving.engine.telegraphPool[0].mesh
    assert.equal(reducedMesh.visible, true)
    assert.equal(reducedMesh.scale.z, 2.55)
    assert.equal(reducedMesh.material.opacity, movingMesh.material.opacity)
    assert.equal(reducedMesh.material.opacity, 0.34)
    assert.equal(movingMesh.scale.z, 0.08, 'the animated negative control started fully grown')
    const reducedActor = reduced.engine.actors[0]
    const movingActor = moving.engine.actors[0]
    assert.ok(reducedActor.action && movingActor.action)
    reducedActor.action.elapsed = movingActor.action.elapsed = actionWindup('scout') / 2
    reduced.engine.syncActorTelegraphs()
    moving.engine.syncActorTelegraphs()
    assert.equal(reducedMesh.scale.z, 2.55)
    assert.ok(movingMesh.scale.z > 0.08 && movingMesh.scale.z < 2.55)
    assert.equal(reducedMesh.material.opacity, movingMesh.material.opacity)
    assert.ok(reducedMesh.material.opacity > 0.34, 'reduced motion lost the timing ramp')
  } finally {
    reduced.dispose()
    moving.dispose()
  }
})

const MAX_WALK_SPEED = PLAYER_WALK_SPEED * 1.14
const SPRINT_SPEED = PLAYER_WALK_SPEED * 1.65
const EVADE_SPEED = EVADE_DISTANCE / EVADE_DURATION

function shapeClearance(role: ActorRole, forward: number, contactRange: number): number {
  const spec = actorTelegraphSpec(role)
  assert.ok(spec && spec.kind !== 'aim')
  const halfWidth = spec.kind === 'wedge'
    ? spec.width / 2 * forward / contactRange
    : spec.width / 2
  return 0.64 + halfWidth
}

function playerContactAtSpeed(
  role: ActorRole,
  hz: number,
  speed: number,
): { contacts: number; action: ActionProbe } {
  const value = fixture()
  const forward = 2.55
  value.engine.player.position.set(0, 0, forward)
  const actor = makeActor(`${role}-${String(hz)}-${String(speed)}`, role, 0)
  value.engine.actors = [actor]
  const action = startAgainstPlayer(value.engine, actor)
  const spec = actorTelegraphSpec(role)
  assert.ok(spec)
  const lockAt = action.duration * (1 - spec.lockShare)
  const lockDuration = action.duration - lockAt
  const effectiveSpeed = speed > MAX_WALK_SPEED
    ? Math.min(speed, (shapeClearance(role, forward, action.contactRange) + 0.001) / lockDuration)
    : speed
  value.engine.updateActorAction(actor, lockAt)
  assert.equal(action.headingLocked, true)
  while (action.phase === 'windup') {
    const nextElapsed = action.elapsed + 1 / hz
    value.engine.player.position.x = effectiveSpeed * Math.max(0, nextElapsed - lockAt)
    value.engine.updateActorAction(actor, 1 / hz)
  }
  const result = {
    contacts: value.contacts(),
    action,
  }
  value.dispose()
  return result
}

test('walking stays inside each tell while sprint and evade clear it at 30/60/144 Hz', () => {
  for (const role of ['scout', 'soldier', 'commander', 'brute', 'champion'] as const) {
    for (const hz of [30, 60, 144]) {
      const walking = playerContactAtSpeed(role, hz, MAX_WALK_SPEED)
      assert.equal(walking.contacts, 1, `${role}/${String(hz)}: walking dodged`)
      const sprinting = playerContactAtSpeed(role, hz, SPRINT_SPEED)
      assert.equal(sprinting.contacts, 0, `${role}/${String(hz)}: sprint was hit`)
      const evading = playerContactAtSpeed(role, hz, EVADE_SPEED)
      assert.equal(evading.contacts, 0, `${role}/${String(hz)}: evade movement was hit`)

      const control = fixture()
      try {
        const controlForward = 2.3
        const controlX = shapeClearance(role, controlForward, 2.55) + 0.001
        control.engine.player.position.set(controlX, 0, controlForward)
        const actor = makeActor(`tracking-${role}-${String(hz)}`, role, 0)
        control.engine.actors = [actor]
        const action = startAgainstPlayer(control.engine, actor)
        const length = Math.hypot(controlX, controlForward)
        action.headingX = controlX / length
        action.headingZ = controlForward / length
        control.engine.resolveActorActionContact(actor, action)
        assert.equal(control.contacts(), 1, `${role}/${String(hz)}: tracking control missed`)
      } finally {
        control.dispose()
      }
    }
  }
})

test('ordinary NPC walking creates no actor-vs-actor shape misses in the engine sample', () => {
  let formerContacts = 0
  let shapeMisses = 0
  for (const role of ['scout', 'soldier', 'commander', 'brute', 'champion'] as const) {
    for (const hz of [30, 60, 144]) {
      const value = fixture()
      try {
        const attacker = makeActor(`attacker-${role}-${String(hz)}`, role, 0, 'guard')
        const target = makeActor(`target-${role}-${String(hz)}`, 'soldier', 2.3, 'villain')
        value.engine.actors = [attacker, target]
        value.engine.startActorAction(
          attacker,
          'meleeActor',
          { kind: 'actor', id: target.id },
          target.mesh.position,
          2.55,
        )
        assert.ok(attacker.action)
        const spec = actorTelegraphSpec(role)
        assert.ok(spec)
        const lockAt = attacker.action.duration * (1 - spec.lockShare)
        value.engine.updateActorAction(attacker, lockAt)
        assert.equal(attacker.action.headingLocked, true)
        while (attacker.action.phase === 'windup') {
          const nextElapsed = attacker.action.elapsed + 1 / hz
          target.mesh.position.x = 5.4 * Math.max(0, nextElapsed - lockAt)
          value.engine.updateActorAction(attacker, 1 / hz)
        }
        const oldDistance = Math.hypot(target.mesh.position.x, target.mesh.position.z)
        if (isWithinContact(oldDistance, 2.55)) {
          formerContacts += 1
          if (value.actorContacts() === 0) shapeMisses += 1
        }
      } finally {
        value.dispose()
      }
    }
  }
  assert.equal(formerContacts, 15)
  assert.equal(shapeMisses, 0, `shape missed ${String(shapeMisses)}/${String(formerContacts)}`)
})

test('arrows keep tracking through their wind-up', () => {
  const value = fixture()
  try {
    value.engine.player.position.set(0, 0, 8)
    const archer = makeActor('archer', 'archer', 0)
    value.engine.actors = [archer]
    value.engine.startActorAction(
      archer,
      'arrow',
      { kind: 'player' },
      value.engine.player.position,
      15,
    )
    assert.ok(archer.action)
    value.engine.updateActorAction(archer, actionWindup('archer') * 0.7)
    value.engine.player.position.x = 3
    value.engine.updateActorAction(archer, actionWindup('archer') * 0.1)
    assert.equal(archer.action.headingLocked, false)
    assert.ok(archer.action.headingX > 0)
  } finally {
    value.dispose()
  }
})
