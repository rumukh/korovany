import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import type { GameEngine } from '../src/game/GameEngine.ts'
import { ActorBudget } from '../src/game/world/ActorBudget.ts'
import { actorBaseHealth, actorMaxPoise } from '../src/game/world/CombatResolver.ts'
import { actorSpeedForRole, type ActorRole, type Faction } from '../src/game/types.ts'
import {
  createSquadCommandState,
  type SquadCommandActor,
  type SquadCommandState,
  type SquadCommandView,
  type SquadIntent,
  type SquadPoint,
} from '../src/game/world/SquadCommand.ts'
import { CollisionWorld } from '../src/game/systems/CollisionWorld.ts'
import { NavigationSystem } from '../src/game/systems/NavigationSystem.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import type { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import type { RunCompanionState } from '../src/game/run/runTypes.ts'
import { createFinaleIdentity, createFinaleState } from '../src/game/world/FinaleDirector.ts'

// Load the shipped class, not extracted source or a copy of updateActors. Only its
// browser-style extensionless imports need adapting for the existing Node runner.
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
const { GameEngine: RuntimeEngine } = await import('../src/game/GameEngine.ts')
hooks.deregister()

export interface FieldActor extends SquadCommandActor {
  mesh: THREE.Group
  speed: number
  velocity: THREE.Vector3
  home: THREE.Vector3
  wanderTarget: THREE.Vector3
  targetId: string | null
  action: null | {
    kind: string
    phase: string
    elapsed: number
    duration: number
    target: { kind: string; id?: string }
    targetPosition: THREE.Vector3
    contactRange: number
  }
  phase: number
  reaction: 'none' | 'flinch' | 'stagger'
  reactionRemaining: number
  routTimer: number
  retaliationTimer: number
  attackCooldown: number
  generatedRegionId: string | null
}

export function fieldActor(
  id: string, x: number, z: number, role: ActorRole = 'soldier',
  faction: Faction = 'guard',
): FieldActor {
  const mesh = new THREE.Group()
  mesh.position.set(x, 0, z)
  return {
    id, allegiance: faction, role, mesh, alive: true,
    hp: actorBaseHealth(role), maxHp: actorBaseHealth(role),
    speed: actorSpeedForRole(role), velocity: new THREE.Vector3(),
    home: mesh.position.clone(), wanderTarget: mesh.position.clone(),
    targetId: null, ignoredTargetId: null, packId: null, packKinSize: 1, playerAggro: false,
    squadEligible: true, budgetCategory: 'squad', eventOwnerId: null,
    aiMode: 'normal', hostileToPlayer: false, squadSlot: 2,
    ...{
      wanderTimer: 100, idleTimer: 0, retreatTimer: 0, aggroMemory: 0,
      rageTimer: 0, alertCooldown: 0, retaliationTimer: 0,
      routTimer: 0, rallyTimer: 0, commanderLostTimer: 0,
      moraleTimer: 1_000_000, alertTimer: 0, alertPos: null,
      chargeCooldown: 0, order: null, attackCooldown: 0,
      reaction: 'none' as const, reactionRemaining: 0,
      poise: actorMaxPoise(role), maxPoise: actorMaxPoise(role),
      poiseRecoveryDelay: 0, staggerImmunity: 0,
      knockbackVelocity: new THREE.Vector3(), phase: 0, stride: 0,
      motionBlend: 0, visualSpeed: 0, gaitPhase: 0, turnLean: 0,
      action: null, lastKnownTargetPos: null, generatedRegionId: null,
      eventPropTargetId: null, wanderPace: 1,
    },
  }
}

export interface SquadField extends Pick<GameEngine, 'commandSquad' | 'setInput'> {
  actors: FieldActor[]
  player: THREE.Group
  camera: THREE.PerspectiveCamera
  cameraYaw: number
  faction: Faction
  elapsed: number
  actorSequence: number
  paused: boolean
  ended: boolean
  squadCommand: SquadCommandState
  squadNavigation: Map<string, {
    destination: SquadPoint | null
    path: readonly SquadPoint[] | null
    direct: boolean
  }>
  squadBlockedSeconds: Map<string, number>
  squadIntents: Map<string, SquadIntent<FieldActor>>
  generatedNavigationRegionSignature: string
  contacts: string[]
  notices: string[]
  keys: Set<string>
  updateActors(delta: number): void
  buildLiveSquadCommandView(): SquadCommandView
  spawnGeneratedStartingSquad(): void
  restoreGeneratedCompanions(companions: readonly RunCompanionState[]): void
  assignSquadSlot(actor: FieldActor, preferred?: number): void
  getSquadNavigation(actor: FieldActor, destination: SquadPoint): {
    waypoint: SquadPoint | null
    destination: SquadPoint | null
    blocked: boolean
  }
  updateRoutingActor(actor: FieldActor, delta: number): void
}

export function squadField(
  actors: FieldActor[] = [],
  world?: GeneratedWorldRuntime,
  faction: Faction = 'guard',
): { field: SquadField; collision: CollisionWorld; navigation: NavigationSystem } {
  const blueprint = generateWorld(20260905)
  const terrain = { sampleHeight: () => 0, estimateSlope: () => 0 }
  const collision = world?.collision ?? new CollisionWorld(terrain, { worldBounds: blueprint.bounds })
  const navigation = world?.navigation ?? new NavigationSystem(blueprint, terrain, collision)
  const player = new THREE.Group()
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 150)
  camera.position.set(0, 10, 20)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const contacts: string[] = []
  const notices: string[] = []
  const generatedWorld = world ?? {
    bounds: blueprint.bounds, collision, navigation,
    sampleHeight: terrain.sampleHeight,
    findPath: (from: SquadPoint, to: SquadPoint) => navigation.findPath(from, to),
  }
  const field: SquadField = Object.assign(Object.create(RuntimeEngine.prototype), {
    actors, player, camera, faction, elapsed: 0, cameraYaw: 0,
    paused: false, ended: false, health: 100, maxHealth: 100,
    keys: new Set<string>(), actorSequence: 0, actorBudget: new ActorBudget(),
    squadCommand: createSquadCommandState({ x: 0, z: 0, heading: 0 }),
    finale: createFinaleState(createFinaleIdentity(blueprint, faction)),
    squadNavigation: new Map(), squadBlockedSeconds: new Map(), squadIntents: new Map(),
    squadNavigationRevision: '', squadSightRaycaster: new THREE.Raycaster(),
    generatedNavigationRegionSignature: 'field',
    generatedNavigationCache: new Map(), navigationWaypoint: new THREE.Vector3(),
    generatedWorld, collisionProbe: new THREE.Vector3(),
    ambientStormPace: 1, fledBeastIds: [], eventPropTargets: new Map(),
    cameraObstacles: [], combatRng: () => 0.5, contacts, notices,
    callbacks: { onNotice: (message: string) => notices.push(message) },
    achievements: { recordSquadCommand() {} },
    // Presentation and damage bookkeeping are sinks. Target selection, action
    // windup/contact, reactions, separation, steering, collision and pathfinding are real.
    updateActorIndicators() {}, updateActorDeathMotion() {},
    animateActorCharacter() {}, updateChampionAura() {},
    acquireActorTelegraph() {}, updateActorTelegraph() {}, releaseActorTelegraph() {},
    playSound() {}, resumeAudio() {}, emitView() {}, unbindActorArms() {},
    damageActor(target: FieldActor) { contacts.push(target.id) },
    spawnActor(
      side: Faction, role: ActorRole, x: number, z: number, _index: number,
      options: { budget: FieldActor['budgetCategory']; squadEligible?: boolean; hostileToPlayer?: boolean },
    ) {
      const actor = fieldActor(`spawn:${actors.length}`, x, z, role, side)
      actor.squadSlot = null
      actor.budgetCategory = options.budget
      actor.squadEligible = options.squadEligible ?? true
      actor.hostileToPlayer = options.hostileToPlayer ?? false
      actor.mesh.position.y = world?.sampleHeight(x, z) ?? 0
      actors.push(actor)
      return actor
    },
  })
  return { field, collision, navigation }
}

export function advanceField(field: SquadField, seconds: number, hz = 60): void {
  for (let frame = 0; frame < Math.ceil(seconds * hz); frame += 1) {
    field.elapsed += 1 / hz
    field.updateActors(1 / hz)
  }
}
