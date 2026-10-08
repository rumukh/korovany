import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/systems/CollisionWorld.ts'
import { createHealthyBody, type ActorRole } from '../src/game/types.ts'
import {
  CombatLineOfSight,
} from '../src/game/world/CombatLineOfSight.ts'
import {
  createFinaleIdentity,
  createFinaleState,
} from '../src/game/world/FinaleDirector.ts'
import {
  playerBeatSpec,
} from '../src/game/world/CombatResolver.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier.startsWith('.') && !extname(specifier)
        ? `${specifier}.ts`
        : specifier,
      context,
    )
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

interface ActorProbe {
  id: string
  allegiance: 'guard' | 'villain'
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

interface ActionProbe {
  kind: 'meleePlayer' | 'meleeActor' | 'eventProp' | 'arrow'
  phase: 'windup' | 'recovery'
  elapsed: number
  duration: number
  target:
    | { kind: 'player' }
    | { kind: 'actor'; id: string }
    | { kind: 'eventProp'; id: string }
  targetPosition: THREE.Vector3
  headingX: number
  headingZ: number
  headingLocked: boolean
  contactRange: number
}

function actor(
  id: string,
  role: ActorRole,
  x: number,
  z: number,
): ActorProbe {
  const mesh = new THREE.Group()
  mesh.position.set(x, 0, z)
  return {
    id,
    allegiance: 'villain',
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

function invoke<T>(
  engine: object,
  method: string,
  ...args: unknown[]
): T {
  const callable: unknown = Reflect.get(engine, method)
  assert.equal(typeof callable, 'function')
  return Reflect.apply(
    callable as (...values: unknown[]) => T,
    engine,
    args,
  )
}

function fixture() {
  const blueprint = generateWorld(20261008)
  const player = new THREE.Group()
  const collision = new CollisionWorld()
  const lineOfSight = new CombatLineOfSight(collision)
  let npcContacts = 0
  let playerContacts = 0
  let arrowReleases = 0
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    faction: 'guard',
    generatedBlueprint: blueprint,
    player,
    actors: [] as ActorProbe[],
    health: 100,
    maxHealth: 100,
    damage: 31,
    body: createHealthyBody(),
    cameraYaw: 0,
    finale: createFinaleState(
      createFinaleIdentity(blueprint, 'guard'),
    ),
    eventPropTargets: new Map(),
    combatLineOfSight: lineOfSight,
    blockedArcherHoldSeconds: new Map(),
    combatRng: () => 0,
    projectileCenter: new THREE.Vector3(),
    actorAttackInterval: (
      _actor: ActorProbe,
      seconds: number,
    ) => seconds,
    playActorActionSound() {},
    playSound() {},
    actorAttackPlayer: () => {
      npcContacts += 1
    },
    actorAttackActor: () => {
      npcContacts += 1
    },
    damageActor: () => {
      playerContacts += 1
      return {
        applied: true,
        dealt: 1,
        killed: false,
        weight: 'normal',
      }
    },
    fireActorArrow: () => {
      arrowReleases += 1
    },
    groundHeightAt: () => -10,
  })
  return {
    engine,
    player,
    collision,
    lineOfSight,
    npcContacts: () => npcContacts,
    playerContacts: () => playerContacts,
    arrowReleases: () => arrowReleases,
  }
}

function startMeleeAgainstPlayer(
  value: ReturnType<typeof fixture>,
  attacker: ActorProbe,
): ActionProbe {
  invoke(
    value.engine,
    'startActorAction',
    attacker,
    'meleePlayer',
    { kind: 'player' },
    value.player.position,
    2.55,
  )
  assert.ok(attacker.action)
  return attacker.action
}

test('ordinary NPC and player melee use exposed tangents but not a full wall', () => {
  const npcCorner = fixture()
  npcCorner.player.position.set(0, 0, 2.3)
  const attacker = actor('attacker', 'soldier', 0, 0)
  npcCorner.engine.actors = [attacker]
  npcCorner.collision.registerCircle({
    id: 'corner',
    regionId: 'arena',
    x: 0,
    z: 1.15,
    radius: 0.1,
  })
  npcCorner.lineOfSight.beginFrame()
  invoke(
    npcCorner.engine,
    'resolveActorActionContact',
    attacker,
    startMeleeAgainstPlayer(npcCorner, attacker),
  )
  assert.equal(npcCorner.npcContacts(), 1)

  const npcWall = fixture()
  npcWall.player.position.set(0, 0, 2.3)
  const blockedAttacker = actor('blocked', 'soldier', 0, 0)
  npcWall.engine.actors = [blockedAttacker]
  npcWall.collision.registerBox({
    id: 'wall',
    regionId: 'arena',
    x: 0,
    z: 1.15,
    halfWidth: 1.5,
    halfDepth: 0.2,
  })
  npcWall.lineOfSight.beginFrame()
  invoke(
    npcWall.engine,
    'resolveActorActionContact',
    blockedAttacker,
    startMeleeAgainstPlayer(npcWall, blockedAttacker),
  )
  assert.equal(npcWall.npcContacts(), 0)

  const playerCorner = fixture()
  const cornerTarget = actor('corner-target', 'soldier', 0, -2.3)
  playerCorner.engine.actors = [cornerTarget]
  playerCorner.collision.registerCircle({
    id: 'corner',
    regionId: 'arena',
    x: 0,
    z: -1.15,
    radius: 0.1,
  })
  playerCorner.lineOfSight.beginFrame()
  invoke(
    playerCorner.engine,
    'resolveMeleeContact',
    playerBeatSpec(1),
  )
  assert.equal(playerCorner.playerContacts(), 1)

  const playerWall = fixture()
  const wallTarget = actor('wall-target', 'soldier', 0, -2.3)
  playerWall.engine.actors = [wallTarget]
  playerWall.collision.registerBox({
    id: 'wall',
    regionId: 'arena',
    x: 0,
    z: -1.15,
    halfWidth: 1.5,
    halfDepth: 0.2,
  })
  playerWall.lineOfSight.beginFrame()
  invoke(
    playerWall.engine,
    'resolveMeleeContact',
    playerBeatSpec(1),
  )
  assert.equal(playerWall.playerContacts(), 0)

  const clear = fixture()
  clear.engine.actors = [actor('clear', 'soldier', 0, -2.3)]
  clear.lineOfSight.beginFrame()
  invoke(clear.engine, 'resolveMeleeContact', playerBeatSpec(1))
  assert.equal(clear.playerContacts(), 1)
})

test('an in-band archer holds, rechecks at release, and shoots only on a clear line', () => {
  const blocked = fixture()
  blocked.player.position.set(0, 0, 10)
  const archer = actor('archer', 'archer', 0, 0)
  blocked.engine.actors = [archer]
  blocked.collision.registerBox({
    id: 'wall',
    regionId: 'arena',
    x: 0,
    z: 5,
    halfWidth: 2,
    halfDepth: 0.2,
  })
  blocked.lineOfSight.beginFrame()
  assert.equal(
    invoke(
      blocked.engine,
      'tryStartArcherAction',
      archer,
      null,
      blocked.player.position,
    ),
    'blocked',
  )
  assert.equal(archer.action, null)

  const clear = fixture()
  clear.player.position.set(0, 0, 10)
  const clearArcher = actor('archer', 'archer', 0, 0)
  clear.engine.actors = [clearArcher]
  clear.lineOfSight.beginFrame()
  assert.equal(
    invoke(
      clear.engine,
      'tryStartArcherAction',
      clearArcher,
      null,
      clear.player.position,
    ),
    'clear',
  )
  assert.ok(clearArcher.action)

  clear.collision.registerBox({
    id: 'late-wall',
    regionId: 'arena',
    x: 0,
    z: 5,
    halfWidth: 2,
    halfDepth: 0.2,
  })
  clear.lineOfSight.beginFrame()
  invoke(
    clear.engine,
    'resolveActorActionContact',
    clearArcher,
    clearArcher.action,
  )
  assert.equal(clear.arrowReleases(), 0)

  clear.collision.removeCollider('late-wall')
  clear.lineOfSight.beginFrame()
  invoke(
    clear.engine,
    'resolveActorActionContact',
    clearArcher,
    clearArcher.action,
  )
  assert.equal(clear.arrowReleases(), 1)
})

test('an ordinary NPC arrow segment stops at solids but not foliage', () => {
  const value = fixture()
  value.player.position.set(0, 0, 4)
  const start = new THREE.Vector3(0, 1.45, 0)
  const end = new THREE.Vector3(0, 1.45, 4)
  const projectile = {
    owner: 'actor',
    sourceActorId: null,
    allegiance: 'villain',
    finale: false,
  }

  value.collision.registerBox({
    id: 'wall',
    regionId: 'arena',
    x: 0,
    z: 2,
    halfWidth: 1,
    halfDepth: 0.2,
  })
  value.lineOfSight.beginFrame()
  const wallHit = invoke<{
    player: boolean
    actor: unknown
    fraction: number
  }>(
    value.engine,
    'findProjectileHit',
    projectile,
    start,
    end,
  )
  assert.equal(wallHit.player, false)
  assert.equal(wallHit.actor, null)
  assert.ok(wallHit.fraction < 0.5)

  value.collision.removeCollider('wall')
  value.collision.registerBox({
    id: 'foliage',
    regionId: 'arena',
    x: 0,
    z: 2,
    halfWidth: 1,
    halfDepth: 0.2,
    tags: ['foliage'],
  })
  value.lineOfSight.beginFrame()
  const foliageHit = invoke<{ player: boolean }>(
    value.engine,
    'findProjectileHit',
    projectile,
    start,
    end,
  )
  assert.equal(foliageHit.player, true)

  value.collision.removeCollider('foliage')
  value.lineOfSight.beginFrame()
  const clearHit = invoke<{ player: boolean }>(
    value.engine,
    'findProjectileHit',
    projectile,
    start,
    end,
  )
  assert.equal(clearHit.player, true)
})
