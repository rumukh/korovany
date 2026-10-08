import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test, { after } from 'node:test'
import * as THREE from 'three'
import type { ActorRole } from '../src/game/types.ts'
import { actionWindup } from '../src/game/world/CombatResolver.ts'
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

function makeActor(id: string, role: ActorRole, z = -2): ActorProbe {
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
  }
}

function fixture(reducedMotion = false) {
  const scene = new THREE.Scene()
  const player = new THREE.Group()
  const world = generateWorld(20260905)
  let contacts = 0
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
    actorAttackActor() {},
    groundHeightAt: () => 0,
  }) as EngineProbe
  return {
    engine,
    contacts: () => contacts,
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
    assert.equal(reducedMesh.material.opacity, 0.72)
    assert.equal(movingMesh.scale.z, 0.08, 'the animated negative control started fully grown')
    assert.ok(movingMesh.material.opacity < reducedMesh.material.opacity)
  } finally {
    reduced.dispose()
    moving.dispose()
  }
})

test('the final 40 percent locks heading and a perpendicular sidestep beats actual contact', () => {
  for (const hz of [30, 60, 144]) {
    const value = fixture()
    try {
      value.engine.player.position.set(0, 0, 2.4)
      const actor = makeActor(`soldier-${String(hz)}`, 'soldier', 0)
      value.engine.actors = [actor]
      const action = startAgainstPlayer(value.engine, actor)
      const lockAt = actionWindup('soldier') * 0.6
      value.engine.updateActorAction(actor, Math.max(0, lockAt - 1.1 / hz))
      assert.equal(action.headingLocked, false)
      value.engine.player.position.x = 0.2
      value.engine.updateActorAction(actor, 0.25 / hz)
      assert.ok(action.headingX > 0, `${String(hz)} Hz did not track before the lock`)
      value.engine.player.position.x = 0
      while (!action.headingLocked) value.engine.updateActorAction(actor, 1 / hz)
      assert.ok(action.elapsed >= lockAt && action.elapsed < lockAt + 1 / hz + 1e-9)
      const lockedHeading = { x: action.headingX, z: action.headingZ }

      value.engine.player.position.x = 1
      while (action.phase === 'windup') value.engine.updateActorAction(actor, 1 / hz)
      assert.equal(value.contacts(), 0, `${String(hz)} Hz sidestep was still hit`)
      assert.deepEqual(
        { x: action.headingX, z: action.headingZ },
        lockedHeading,
        `${String(hz)} Hz heading kept tracking after the lock`,
      )

      const control = fixture()
      try {
        control.engine.player.position.set(1, 0, 2.4)
        const controlActor = makeActor('tracking-control', 'soldier', 0)
        control.engine.actors = [controlActor]
        const controlAction = startAgainstPlayer(control.engine, controlActor)
        const length = Math.hypot(1, 2.4)
        controlAction.headingX = 1 / length
        controlAction.headingZ = 2.4 / length
        controlAction.headingLocked = false
        control.engine.resolveActorActionContact(controlActor, controlAction)
        assert.equal(control.contacts(), 1, 'the live-tracking negative control did not hit')
      } finally {
        control.dispose()
      }
    } finally {
      value.dispose()
    }
  }
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
