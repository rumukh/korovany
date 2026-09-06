import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {
  SQUAD_BLOCKED_SECONDS,
  SQUAD_FOCUS_RANGE,
  SQUAD_HOLD_LEASH,
  allocateSquadSlot,
  buildSavedSquadRoster,
  createSquadCommandState,
  finishSquadFocus,
  isSquadFocusTarget,
  isSquadHoldStepAllowed,
  isSquadMember,
  issueSquadCommand,
  restoreSquadCommandState,
  selectSquadIntent,
  serializeSquadCommandState,
  squadDistance,
  squadFormationPosition,
} from '../src/game/world/SquadCommand.ts'
import { MAX_ACTORS } from '../src/game/world/ActorBudget.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import {
  SQUAD_FOLLOW_MAX_SPEED, STARTING_SQUAD_VERSION,
  getStartingSquad, shouldInitializeStartingSquad,
} from '../src/game/squadMovement.ts'
import { advanceField, fieldActor, squadField } from './squadRuntimeHarness.ts'

const ANCHOR = { x: 0, z: 0, heading: 0 }
const BOUNDS = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 }
const positionOf = (actor: ReturnType<typeof fieldActor>) => actor.mesh.position

test('versioned orders retain the held anchor and prior stance through Focus and resume', () => {
  const held = issueSquadCommand(createSquadCommandState(ANCHOR), 'hold', { x: 10, z: 12, heading: 0.5 })
  const focus = issueSquadCommand(held, 'focus', ANCHOR, 'enemy:one')
  const serialized = serializeSquadCommandState(focus)
  const restored = restoreSquadCommandState(JSON.parse(JSON.stringify(serialized)), createSquadCommandState(ANCHOR), BOUNDS)
  assert.equal(restored.rejected, false)
  assert.deepEqual(restored.state, focus)
  assert.deepEqual(finishSquadFocus(restored.state), held)
  assert.equal(issueSquadCommand(focus, 'regroup', ANCHOR).baseStance, 'follow')
  assert.notEqual(serialized.anchor, focus.anchor)
})

test('legacy absent blocks preserve both meanings; malformed present commands report rejection', () => {
  for (const following of [true, false]) {
    const fallback = createSquadCommandState({ x: 35, z: -40, heading: 0 }, following)
    const absent = restoreSquadCommandState(undefined, fallback, BOUNDS)
    assert.equal(absent.rejected, false)
    assert.equal(absent.state.mode, following ? 'follow' : 'hold')
    assert.deepEqual(absent.state.anchor, fallback.anchor)
    for (const invalid of [
      null, { ...fallback, version: 2 }, { ...fallback, mode: 'charge' },
      { ...fallback, baseStance: 'regroup' }, { ...fallback, anchor: { ...ANCHOR, x: Infinity } },
      { ...fallback, anchor: { ...ANCHOR, z: 201 } },
      { ...fallback, anchor: { ...ANCHOR, heading: NaN } },
      { ...fallback, mode: 'focus', focusTargetId: '' },
      { ...fallback, mode: 'focus', focusTargetId: 'x'.repeat(129) },
      { ...fallback, mode: 'focus', focusTargetId: 'enemy\u0000id' },
      { ...fallback, focusTargetId: { id: 'enemy' } },
    ]) {
      const result = restoreSquadCommandState(invalid, fallback, BOUNDS)
      assert.equal(result.rejected, true)
      assert.deepEqual(result.state, fallback)
    }
  }
})

test('membership is explicit, not a friendly faction or an eligible role alone', () => {
  const member = fieldActor('party', 0, 0)
  assert.equal(isSquadMember(member, 'guard'), true)
  for (const outsider of [
    { ...member, budgetCategory: 'campaign' as const },
    { ...member, budgetCategory: 'ambient' as const },
    { ...member, eventOwnerId: 'escort' },
    { ...member, role: 'captive' as const, aiMode: 'captive' },
    { ...member, role: 'commander' as const },
    { ...member, role: 'peasant' as const, allegiance: 'civilian' as const },
    { ...member, allegiance: 'villain' as const },
    { ...member, hostileToPlayer: true },
    { ...member, alive: false },
    { ...member, hp: 0 },
  ]) assert.equal(isSquadMember(outsider, 'guard'), false)
  assert.equal(isSquadMember({ ...member, role: 'captive' }, 'guard'), true)
})

test('focus refuses friendly, civilian, captive, dead, unseen and doctrine-exempt targets', () => {
  const enemy = { ...fieldActor('enemy', 0, -3, 'minion', 'villain'), hostileToPlayer: true }
  assert.equal(isSquadFocusTarget(enemy, 'guard', ANCHOR, enemy.mesh.position, true), true)
  for (const invalid of [
    { ...enemy, allegiance: 'guard' as const },
    { ...enemy, allegiance: 'civilian' as const, role: 'peasant' as const },
    { ...enemy, role: 'captive' as const },
    { ...enemy, alive: false },
    { ...enemy, hp: 0 },
    { ...enemy, allegiance: 'beast' as const, role: 'wolf' as const, hostileToPlayer: false },
  ]) assert.equal(isSquadFocusTarget(invalid, 'guard', ANCHOR, enemy.mesh.position, true), false)
  assert.equal(isSquadFocusTarget(enemy, 'guard', ANCHOR, enemy.mesh.position, false), false)
  assert.equal(isSquadFocusTarget(enemy, 'guard', ANCHOR, { x: SQUAD_FOCUS_RANGE + 0.01, z: 0 }, true), false)
})

test('identity slots are unique at the cap, remain stable on death, and keep archers behind', () => {
  const occupied = new Set<number>()
  const slots = Array.from({ length: MAX_ACTORS }, (_, index) => {
    const slot = allocateSquadSlot(`companion:${index}`, occupied)
    occupied.add(slot)
    return slot
  })
  assert.equal(new Set(slots).size, MAX_ACTORS)
  const before = slots.map((slot) => squadFormationPosition(slot, 'soldier', ANCHOR, 0))
  occupied.delete(slots[0])
  assert.deepEqual(slots.slice(1).map((slot) => squadFormationPosition(slot, 'soldier', ANCHOR, 0)), before.slice(1))
  for (const slot of slots) {
    assert.ok(squadFormationPosition(slot, 'soldier', ANCHOR, 0).z < 0)
    assert.ok(squadFormationPosition(slot, 'archer', ANCHOR, 0).z > 0)
    assert.ok(squadFormationPosition(slot, 'archer', ANCHOR, Math.PI / 2).x < 0)
  }
})

test('the real engine selects and contacts the focus enemy; removing Focus priority fails', () => {
  const run = (focused: boolean) => {
    const member = fieldActor('party', 0, 0)
    const near = fieldActor('near', -1.8, 0, 'minion', 'villain')
    const selected = fieldActor('selected', 2.1, 0, 'brute', 'villain')
    for (const target of [near, selected]) {
      target.hostileToPlayer = true
      target.squadEligible = false
      target.reaction = 'stagger'
      target.reactionRemaining = 30
    }
    const { field } = squadField([member, near, selected])
    if (focused) assert.equal(field.commandSquad('focus', selected.id), true)
    advanceField(field, 0.6)
    return { target: member.targetId, contacts: field.contacts }
  }
  assert.deepEqual(run(true), { target: 'selected', contacts: ['selected'] })
  const control = run(false)
  assert.equal(control.target, 'near')
  assert.deepEqual(control.contacts, ['near'])
  assert.throws(() => assert.equal(control.contacts[0], 'selected'))
})

test('Hold bounds a retreating enemy in the real movement loop; ignoring Hold breaks the perimeter', () => {
  const run = (holding: boolean) => {
    const member = fieldActor('party', 0, 0)
    const enemy = fieldActor('runner', 5, 0, 'minion', 'villain')
    enemy.squadEligible = false
    enemy.hostileToPlayer = true
    enemy.reaction = 'stagger'
    enemy.reactionRemaining = 40
    const { field } = squadField([member, enemy])
    if (holding) field.commandSquad('hold')
    let maximum = 0
    for (let step = 0; step < 600; step += 1) {
      enemy.mesh.position.x = 5 + step / 60
      advanceField(field, 1 / 60)
      maximum = Math.max(maximum, squadDistance(member.mesh.position, ANCHOR))
    }
    return maximum
  }
  assert.ok(run(true) <= SQUAD_HOLD_LEASH + 0.01)
  const ignoredHold = run(false)
  assert.ok(ignoredHold > SQUAD_HOLD_LEASH + 1, `negative control only travelled ${ignoredHold}`)
  assert.throws(() => assert.ok(ignoredHold <= SQUAD_HOLD_LEASH))
  assert.equal(isSquadHoldStepAllowed({ x: 7.9, z: 0 }, { x: 8.1, z: 0 }, ANCHOR), false)
})

test('Regroup cancels pursuit, uses bounded physical movement, and completes only on arrival', () => {
  const member = fieldActor('party', 25, 0)
  member.targetId = 'optional-pursuit'
  member.retaliationTimer = 3
  const { field } = squadField([member])
  assert.equal(field.commandSquad('regroup'), true)
  assert.equal(member.targetId, null)
  let previous = member.mesh.position.clone()
  for (let step = 0; step < 600 && field.squadCommand.mode === 'regroup'; step += 1) {
    advanceField(field, 1 / 60)
    assert.ok(previous.distanceTo(member.mesh.position) <= SQUAD_FOLLOW_MAX_SPEED / 60 + 0.001)
    previous = member.mesh.position.clone()
  }
  assert.equal(field.squadCommand.mode, 'follow')
  assert.ok(squadDistance(member.mesh.position, squadFormationPosition(2, 'soldier', ANCHOR, 0)) < 1.7)
})

test('an unreachable live companion is blocked, not dead or falsely regrouped, and retries after geometry changes', () => {
  const member = fieldActor('stranded', 15, 0)
  const { field, collision, navigation } = squadField([member])
  collision.registerBox({ id: 'wall', regionId: 'region-2-2', x: 8, z: 0, halfWidth: 1, halfDepth: 200 })
  const findPath = navigation.findPath.bind(navigation)
  let pathRequests = 0
  navigation.findPath = (start, destination, options) => {
    pathRequests += 1
    return findPath(start, destination, options)
  }
  field.commandSquad('regroup')
  for (let frame = 0; frame < 120; frame += 1) {
    collision.setActiveBounds(BOUNDS)
    advanceField(field, 1 / 60)
  }
  assert.ok(pathRequests >= 2 && pathRequests <= 6, `per-frame replanning: ${pathRequests} requests`)
  assert.equal(field.squadCommand.mode, 'regroup')
  let roster = field.buildLiveSquadCommandView().roster
  assert.equal(roster.length, 1)
  assert.equal(roster[0].status, 'blocked')
  assert.ok((field.squadBlockedSeconds.get(member.id) ?? 0) >= SQUAD_BLOCKED_SECONDS)
  collision.removeCollider('wall')
  advanceField(field, 8)
  assert.equal(field.squadCommand.mode, 'follow')
  member.mesh.position.x = 40
  field.squadBlockedSeconds.clear()
  roster = field.buildLiveSquadCommandView().roster
  assert.equal(roster[0].status, 'distant')
  member.alive = false
  member.hp = 0
  assert.equal(field.buildLiveSquadCommandView().roster.length, 0)
  assert.equal(field.buildLiveSquadCommandView().roster.length, 0)
})

test('routing and hit reactions retain priority over orders', () => {
  const member = fieldActor('hurt', 20, 0)
  member.routTimer = 3
  member.hp = 10
  const { field } = squadField([member])
  let routingCalls = 0
  field.updateRoutingActor = () => { routingCalls += 1 }
  field.commandSquad('regroup')
  advanceField(field, 0.5)
  assert.equal(routingCalls, 30)
  assert.ok(member.routTimer > 2.4)
  assert.equal(member.hp, 10)
  assert.equal(field.squadCommand.mode, 'regroup')
  member.routTimer = 0
  member.reaction = 'stagger'
  member.reactionRemaining = 2
  const before = member.mesh.position.clone()
  advanceField(field, 0.5)
  assert.deepEqual(member.mesh.position, before)
  assert.equal(field.buildLiveSquadCommandView().roster[0].status, 'recovering')
})

test('all seeded starting parties have reachable placement and leave without duplicate starters', () => {
  for (const faction of ['elf', 'guard', 'villain'] as const) {
    const world = new GeneratedWorldRuntime(new THREE.Scene(), generateWorld(20260905))
    try {
      const start = world.getStartPosition(faction)
      world.update({ focus: start, deltaSeconds: 0 })
      const { field } = squadField([], world, faction)
      field.player.position.set(start.x, start.y, start.z)
      field.spawnGeneratedStartingSquad()
      field.spawnGeneratedStartingSquad()
      assert.equal(field.actors.length, 3)
      assert.deepEqual(field.actors.map((actor) => actor.role), getStartingSquad(faction).map((member) => member.role))
      for (const actor of field.actors) {
        const radius = actor.role === 'brute' ? 0.72 : 0.56
        assert.ok(world.collision.isWalkablePosition(actor.mesh.position.x, actor.mesh.position.z, radius))
        assert.ok(world.findPath(actor.mesh.position, field.player.position))
      }
      const starts = field.actors.map((actor) => actor.mesh.position.clone())
      const departure = [24, -24].flatMap((offset) => [
        { x: start.x, z: start.z + offset },
        { x: start.x + offset, z: start.z },
      ]).find((point) => world.collision.isWalkablePosition(point.x, point.z, 0.72) &&
        world.findPath(start, point) !== null)
      assert.ok(departure, `${faction}: no real departure path`)
      field.player.position.set(departure.x, world.sampleHeight(departure.x, departure.z), departure.z)
      field.commandSquad('regroup')
      advanceField(field, 15)
      assert.ok(field.actors.every((actor, index) => actor.mesh.position.distanceTo(starts[index]) > 2),
        `${faction}: a companion never left its starting placement`)
      assert.ok(field.actors.every((actor) => actor.mesh.position.distanceTo(field.player.position) < 18))
      assert.ok(field.actors.length <= MAX_ACTORS)
    } finally {
      world.dispose()
    }
  }
})

test('the production squad adapter crosses the generated bridge, never the water shortcut', () => {
  const blueprint = generateWorld(20260905)
  const world = new GeneratedWorldRuntime(new THREE.Scene(), blueprint)
  try {
    const bridge = world.getBridgePosition('bridge-road-critical-villain-region-1-2')
    assert.ok(bridge)
    world.update({ focus: bridge, deltaSeconds: 0 })
    const member = fieldActor('bridge-party', bridge.x - 14, bridge.z - 14)
    member.mesh.position.y = world.sampleHeight(member.mesh.position.x, member.mesh.position.z)
    const { field } = squadField([member], world)
    field.player.position.set(bridge.x + 14, world.sampleHeight(bridge.x + 14, bridge.z - 14), bridge.z - 14)
    assert.ok(world.collision.isWalkablePosition(member.mesh.position.x, member.mesh.position.z, 0.56))
    assert.ok(world.collision.isWalkablePosition(field.player.position.x, field.player.position.z, 0.64))
    assert.equal(world.collision.isWalkablePosition(bridge.x, bridge.z - 14, 0.56), false,
      'negative control must really cross water, not an already clear road')
    field.commandSquad('regroup')
    let usedBridge = false
    for (let frame = 0; frame < 1200 && field.squadCommand.mode === 'regroup'; frame += 1) {
      const before = member.mesh.position.clone()
      advanceField(field, 1 / 60)
      const position = member.mesh.position
      assert.ok(before.distanceTo(position) <= SQUAD_FOLLOW_MAX_SPEED / 60 + 0.01)
      assert.ok(world.collision.isWalkablePosition(position.x, position.z, 0.56),
        `squad walked into a collider at ${position.x},${position.z}`)
      if (Math.abs(position.x - bridge.x) < 2 && Math.abs(position.z - bridge.z) < 6) usedBridge = true
    }
    assert.equal(usedBridge, true)
    assert.ok(member.mesh.position.x > bridge.x + 8)
    assert.equal(field.squadCommand.mode, 'follow')
  } finally {
    world.dispose()
  }
})

test('the live villain brute grid-cell regression walks a local connector rather than remaining stuck', () => {
  const world = new GeneratedWorldRuntime(new THREE.Scene(), generateWorld(20260905))
  try {
    const player = { x: -157.9377480522768, z: 169.07303360319 }
    world.update({ focus: player, deltaSeconds: 0 })
    const brute = fieldActor('squad:villain:starter:1', -155.78060862231212, 185.74881228450613, 'brute', 'villain')
    brute.squadSlot = 3
    brute.mesh.position.y = world.sampleHeight(brute.mesh.position.x, brute.mesh.position.z)
    const { field } = squadField([brute], world, 'villain')
    field.player.position.set(player.x, world.sampleHeight(player.x, player.z), player.z)
    field.cameraYaw = -0.05770979613889906
    const destination = squadFormationPosition(3, 'brute', player, field.cameraYaw)
    assert.equal(world.collision.isWalkablePosition(brute.mesh.position.x, brute.mesh.position.z, 0.72), true)
    assert.equal(world.findPath(brute.mesh.position, destination), null,
      'the raw path query must reproduce the live grid-cell failure')
    field.commandSquad('regroup')
    for (let frame = 0; frame < 720 && field.squadCommand.mode === 'regroup'; frame += 1) {
      const before = brute.mesh.position.clone()
      advanceField(field, 1 / 60)
      assert.ok(squadDistance(before, brute.mesh.position) <= SQUAD_FOLLOW_MAX_SPEED / 60 + 0.001)
      assert.ok(world.collision.isWalkablePosition(brute.mesh.position.x, brute.mesh.position.z, 0.72))
    }
    assert.equal(field.squadCommand.mode, 'follow')
    assert.ok(squadDistance(brute.mesh.position, destination) < 1.7)
  } finally {
    world.dispose()
  }
})

test('restoring companion IDs, roles, health and slots does not revive dead members or add a second party', () => {
  const companions = [
    { id: 'old-guard-8', role: 'soldier' as const, formationSlot: 3, health: 31, maxHealth: 72, worldPosition: [2, 0, 3] as [number, number, number] },
    { id: 'rescued-9', role: 'captive' as const, formationSlot: 10, health: 20, maxHealth: 40, worldPosition: [40, 0, 0] as [number, number, number] },
    { id: 'dead-10', role: 'archer' as const, formationSlot: 7, health: 0, maxHealth: 50, worldPosition: [0, 0, 0] as [number, number, number] },
  ]
  const { field } = squadField()
  field.restoreGeneratedCompanions(companions)
  field.restoreGeneratedCompanions(companions)
  assert.equal(field.actors.length, 2)
  const roster = field.buildLiveSquadCommandView().roster
  assert.deepEqual(roster.map((member) => [member.id, member.role, member.health, member.slot]),
    [['old-guard-8', 'soldier', 31, 3], ['rescued-9', 'captive', 20, 10]])
  assert.equal(roster[1].status, 'distant')
  assert.deepEqual(buildSavedSquadRoster(companions, field.squadCommand, 'guard', ANCHOR)
    .map((member) => [member.id, member.health, member.slot]), roster.map((member) => [member.id, member.health, member.slot]))
  assert.equal(shouldInitializeStartingSquad(undefined, companions.length), false)
  assert.equal(shouldInitializeStartingSquad(STARTING_SQUAD_VERSION, 0), false)
})

test('paused quick commands and held inputs are ignored, while explicit panel confirmation revalidates', () => {
  const { field } = squadField([fieldActor('party', 0, 0)])
  field.paused = true
  const before = field.squadCommand
  assert.equal(field.commandSquad(), false)
  assert.equal(field.squadCommand, before)
  field.setInput('KeyW', true)
  assert.equal(field.keys.size, 0)
  assert.equal(field.commandSquad('hold'), true)
  assert.equal(field.commandSquad('focus', 'not-here'), false)
  assert.equal(field.squadCommand.mode, 'hold')
  const intent = selectSquadIntent(field.actors[0], field.actors, 'guard', field.squadCommand, ANCHOR, 0, positionOf)
  assert.equal(intent?.target, null)
})

test('losing the last member is not reported as a successful regroup', () => {
  const member = fieldActor('last-member', 20, 0)
  const { field } = squadField([member])
  field.commandSquad('regroup')
  const noticesBeforeDeath = field.notices.length
  member.alive = false
  member.hp = 0
  advanceField(field, 0.5)
  assert.equal(field.buildLiveSquadCommandView().roster.length, 0)
  assert.equal(field.squadCommand.mode, 'regroup')
  assert.equal(field.notices.length, noticesBeforeDeath)
})

test('cached pursuit yields to archer range as soon as the obstruction clears', () => {
  const firstShotDistance = (keepWaypointPriority: boolean) => {
    const archer = fieldActor('archer', 0, 0, 'archer')
    const target = fieldActor('focused', 10, 0, 'minion', 'villain')
    target.hostileToPlayer = true
    target.reaction = 'stagger'
    target.reactionRemaining = 60
    const { field, collision } = squadField([archer, target])
    field.player.position.set(10, 0, 10)
    collision.registerBox({
      id: 'cover', regionId: 'region-2-2', x: 5, z: 0, halfWidth: 1, halfDepth: 4,
    })
    if (keepWaypointPriority) {
      const navigate = field.getSquadNavigation.bind(field)
      field.getSquadNavigation = (actor, destination) => {
        const result = navigate(actor, destination)
        return !result.blocked && !result.waypoint && result.destination &&
          squadDistance(actor.mesh.position, result.destination) > 0.8
          ? { ...result, waypoint: result.destination } : result
      }
    }
    assert.equal(field.commandSquad('focus', target.id), true)
    for (let frame = 0; frame < 600 && !archer.action; frame += 1) advanceField(field, 1 / 60)
    assert.equal(archer.action?.kind, 'arrow')
    return squadDistance(archer.mesh.position, target.mesh.position)
  }
  assert.ok(firstShotDistance(false) > 5, 'archer must not walk into melee range before firing')
  const control = firstShotDistance(true)
  assert.ok(control < 2)
  assert.throws(() => assert.ok(control > 5))
})

test('regroup arrival requires a clear final connection, not proximity through a wall', () => {
  for (const cachedPath of [false, true]) {
    const archer = fieldActor('party', 0, cachedPath ? 0.8 : 3.8, 'archer')
    const { field, collision } = squadField([archer])
    field.player.position.z = cachedPath ? -3.6 : -0.6
    collision.registerBox({
      id: 'arrival-wall', regionId: 'region-2-2', x: 0, z: cachedPath ? 0 : 3,
      halfWidth: cachedPath ? 4 : 1000, halfDepth: 0.15,
    })
    assert.equal(field.commandSquad('regroup'), true)
    advanceField(field, 1 / 60)
    assert.equal(Boolean(field.squadNavigation.get(archer.id)?.path), cachedPath)
    assert.equal(field.squadCommand.mode, 'regroup', 'being near a slot on the other side is not arriving')
    advanceField(field, 4)
    assert.equal(field.squadCommand.mode, 'regroup')
    assert.equal(field.buildLiveSquadCommandView().roster[0].status, 'blocked')
    collision.removeCollider('arrival-wall')
    advanceField(field, 3)
    assert.equal(field.squadCommand.mode, 'follow')
  }
})

test('persisted identity text cannot overflow the runtime actor sequence', () => {
  const { field } = squadField()
  const id = `guard-archer-${'9'.repeat(60)}`
  field.restoreGeneratedCompanions([{
    id, role: 'archer', health: 45, maxHealth: 45, worldPosition: [0, 0, 0],
  }])
  assert.ok(Number.isSafeInteger(field.actorSequence) && field.actorSequence < 100)
  assert.equal(field.actors[0].id, id)
  field.restoreGeneratedCompanions([{
    id: 'guard-soldier-20', role: 'soldier', health: 70, maxHealth: 70, worldPosition: [3, 0, 0],
  }])
  assert.equal(field.actorSequence, 21)
})
