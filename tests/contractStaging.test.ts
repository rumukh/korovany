/**
 * W1-6 — a contract the player has reached stages even in a square full of the player's own
 * idle soldiers, because the farthest of them that nobody can see step back to make room.
 *
 * The residual, as the corrected harness found it after the commander fix (#110): seed 1's
 * palace guard takes «Зверьё у домиков» beside the elf's and the villain's strongholds, both
 * the guard's own. Its window holds eighteen of the palace's soldiers, nobody is fighting
 * anyone, and a beast raid needs five slots where four are left, so the contract was
 * abandoned as `crowded` however long the guard stood there. Hostile packs are never asked:
 * an enemy that vanishes so a contract can start would be a lie told in plain sight.
 *
 * Everything below drives production engine methods — `syncGeneratedRegions` and the spawner
 * under it, `startContractEvent`, `updateFactionContract`, `makeRoomForStaging`,
 * `recordGeneratedActorDeath` — on the headless engine of `tests/contractRoomField.ts`, with
 * the window read off a real `RegionManager`. Every claim carries a negative control.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {
  describeContractAbandoned,
  describeContractStarted,
  formatRegionGridLabel,
  generatedSiteLabel,
} from '../src/game/content/gameCopy.ts'
import type { GeneratedEncounterPlan } from '../src/game/content/registry.ts'
import type { Faction } from '../src/game/types.ts'
import { MAX_ACTORS } from '../src/game/world/ActorBudget.ts'
import {
  CONTRACT_TEMPLATES,
  findContractTemplate,
  getContractNodes,
} from '../src/game/world/CampaignDirector.ts'
import { RegionManager } from '../src/game/world/RegionManager.ts'
import {
  STAGING_PARK_HOLD_SECONDS,
  STAGING_PARK_MIN_DISTANCE,
  isHiddenFrom,
  type StagingViewer,
} from '../src/game/world/StagingRoom.ts'
import type { FactionObjectiveNode } from '../src/game/world/worldTypes.ts'
import {
  FACTIONS,
  field,
  invoke,
  regionAt,
  siteOf,
  world,
  type HeadlessActor,
  type Probe,
  type World,
} from './contractRoomField.ts'

/** The longest start grace any shipped template has, plus a margin. */
const PAST_GRACE = Math.max(
  ...Object.values(CONTRACT_TEMPLATES).map((template) => template.startGraceSeconds),
) + 3
/** Facing south, the way the guard walks in from its start two squares north. */
const FROM_THE_START = Math.PI
const FACING_NORTH = 0
/** The pack behind a guard walking in from the north, and the one ahead of them. */
const NORTH_PACK = 'encounter-region-4-1'
const SOUTH_PACK = 'encounter-region-4-3'

/** A fresh streamer, so nothing one case writes into a square's delta leaks into the next. */
function freshWorld(seed: number): World {
  const cached = world(seed)
  return { ...cached, manager: new RegionManager(cached.blueprint) }
}

function cull(source: World = world(1)) {
  const node = getContractNodes(source.blueprint, 'guard').find((entry) => entry.contract === 'cull')
  assert.ok(node, 'seed 1 offers the guard «Зверьё у домиков»')
  return node
}

/** The guard on the site of «Зверьё у домиков», the window streamed in, the squad beside them. */
function arrive(options: { staging: boolean; yaw?: number; source?: World }): Probe {
  const source = options.source ?? world(1)
  const probe = field(source, 'guard', {
    node: cull(source),
    staging: options.staging,
    yaw: options.yaw ?? FROM_THE_START,
  })
  probe.squad()
  probe.streamIn()
  return probe
}

const members = (probe: Probe, encounterId: string): HeadlessActor[] =>
  probe.actors.filter((actor) => actor.alive && actor.generatedEncounterId === encounterId)

function abandonedCrowded(probe: Probe, node: FactionObjectiveNode): string {
  const site = probe.blueprint.sites.find((entry) => entry.id === node.siteId)
  const region = probe.blueprint.regions.find((entry) => entry.id === node.regionId)
  assert.ok(site && region && node.contract)
  return describeContractAbandoned(node.contract, {
    regionLabel: formatRegionGridLabel(region.coordinate.x, region.coordinate.y),
    siteLabel: generatedSiteLabel(site.kind),
  }, 'crowded')
}

/** What the engine's own camera sees, as `makeRoomForStaging` reads it. */
const sight = (probe: Probe): StagingViewer => invoke<StagingViewer>(probe.engine, 'stagingViewer')

/** Every living body of the generator's packs, by id, with where it stood. */
function generatedBodies(probe: Probe): Map<string, HeadlessActor> {
  return new Map(probe.actors
    .filter((actor) => actor.alive && actor.generatedEncounterId !== null)
    .map((actor) => [actor.id, actor]))
}

// ---------------------------------------------------------------------------
// 1. The residual, and the rule
// ---------------------------------------------------------------------------

test('the guard reaches «Зверьё у домиков» among the palace\'s idle soldiers and the contract starts', () => {
  const node = cull()
  const probe = arrive({ staging: true })
  // The reproduction's window: eighteen of the guard's own, nobody else, nobody fighting.
  const before = generatedBodies(probe)
  assert.equal(before.size, 18)
  assert.ok([...before.values()].every((actor) => !actor.hostileToPlayer))
  assert.equal(probe.chronicleRoom(), 4)
  assert.equal(members(probe, NORTH_PACK).length, 2)
  const viewer = sight(probe)
  for (const actor of before.values()) {
    if (actor.generatedEncounterId !== NORTH_PACK) continue
    const at = { x: actor.mesh.position.x, z: actor.mesh.position.z }
    assert.ok(isHiddenFrom(viewer, at), 'the north pack is in sight of a guard walking south')
    assert.ok(Math.hypot(at.x - viewer.player.x, at.z - viewer.player.z) >= STAGING_PARK_MIN_DISTANCE)
  }

  probe.contractFrames(0.1)
  assert.equal(probe.status(node), 'active')
  assert.ok(probe.notices.includes(describeContractStarted('cull')))
  assert.ok(probe.actors.length <= MAX_ACTORS)
  // Exactly one pack stepped back: the farthest the guard could not see.
  assert.deepEqual(members(probe, NORTH_PACK), [])
  const gone = [...before.keys()].filter((id) => !probe.actors.some((actor) => actor.id === id))
  assert.deepEqual(gone.map((id) => before.get(id)!.generatedEncounterId), [NORTH_PACK, NORTH_PACK])
  assert.deepEqual([...probe.parked().get('region-4-1') ?? []].sort(),
    ['encounter-region-4-1:actor:0', 'encounter-region-4-1:actor:1'])
  // Every stronghold stands, commanders and all.
  for (const actor of before.values()) {
    if (actor.generatedEncounterId?.startsWith('encounter-boss')) {
      assert.ok(probe.actors.includes(actor), `${actor.id} of a stronghold stepped back`)
    }
  }

  // Negative control: with nobody stepping back the same arrival stalls `crowded`, and the
  // contract is abandoned once its grace runs out — the residual, in the engine.
  const control = arrive({ staging: false })
  control.contractFrames(0.1)
  assert.equal(control.status(node), 'offered')
  assert.equal(generatedBodies(control).size, 18)
  control.contractFrames(PAST_GRACE)
  assert.equal(control.status(node), 'failed')
  assert.ok(control.notices.includes(abandonedCrowded(control, node)))
})

test('enemies never step back, however far off and out of sight', () => {
  const node = cull()
  // The same eighteen bodies in the same places, as enemies of the player: once body by
  // body, once as the plans the generator made them from.
  const flips: Array<(probe: Probe) => void> = [
    (probe) => {
      for (const actor of probe.actors) if (actor.generatedEncounterId !== null) actor.hostileToPlayer = true
    },
    (probe) => {
      const plans = Reflect.get(probe.engine, 'generatedEncounterPlans') as Map<string, GeneratedEncounterPlan[]>
      Reflect.set(probe.engine, 'generatedEncounterPlans', new Map([...plans].map(([regionId, list]) =>
        [regionId, list.map((plan) => ({ ...plan, hostileToPlayer: true }))])))
    },
  ]
  for (const flip of flips) {
    const probe = arrive({ staging: true })
    flip(probe)
    const before = generatedBodies(probe)
    probe.contractFrames(0.1)
    assert.equal(probe.status(node), 'offered')
    assert.deepEqual([...generatedBodies(probe).keys()], [...before.keys()], 'an enemy stepped back')
    probe.contractFrames(PAST_GRACE)
    assert.equal(probe.status(node), 'failed')
    assert.ok(probe.notices.includes(abandonedCrowded(probe, node)))
  }
})

test('a pack that is busy, wounded, too near or in sight stays where it is', () => {
  const node = cull()
  // Walking in from the north only the north pack is out of sight, so spoiling it is enough.
  const spoilers: Array<[string, (actor: HeadlessActor, probe: Probe) => void]> = [
    ['hunting', (actor) => { actor.targetId = 'someone' }],
    ['wounded', (actor) => { actor.hp = actor.maxHp - 1 }],
    ['alerted', (actor) => { actor.alertTimer = 3 }],
    ['ordered to escort', (actor) => { actor.order = { kind: 'escort', position: new THREE.Vector3(), timer: 5 } }],
    ['too near', (actor, probe) => {
      actor.mesh.position.set(probe.player.position.x, 0, probe.player.position.z - (STAGING_PARK_MIN_DISTANCE - 1))
    }],
  ]
  for (const [name, spoil] of spoilers) {
    const probe = arrive({ staging: true })
    spoil(members(probe, NORTH_PACK)[0], probe)
    const before = generatedBodies(probe)
    probe.contractFrames(0.1)
    assert.equal(probe.status(node), 'offered', `a ${name} pack stepped back`)
    assert.deepEqual([...generatedBodies(probe).keys()], [...before.keys()])
  }
  // In sight: facing north, the north pack is in front and the south pack, behind, is wounded.
  const facing = arrive({ staging: true, yaw: FACING_NORTH })
  members(facing, SOUTH_PACK)[0].hp -= 1
  facing.contractFrames(0.1)
  assert.equal(facing.status(node), 'offered', 'a pack in sight stepped back')
  assert.equal(members(facing, NORTH_PACK).length, 2)

  // Negative control: the same turn with the south pack whole lets it step back instead.
  const turned = arrive({ staging: true, yaw: FACING_NORTH })
  turned.contractFrames(0.1)
  assert.equal(turned.status(node), 'active')
  assert.equal(members(turned, NORTH_PACK).length, 2)
  assert.deepEqual(members(turned, SOUTH_PACK), [])
})

// ---------------------------------------------------------------------------
// 2. Stepping back is not losing
// ---------------------------------------------------------------------------

test('a pack that stepped back is not beaten, and comes home once, unseen', () => {
  const node = cull()
  const source = freshWorld(1)
  const probe = arrive({ staging: true, source })
  const engine = probe.engine
  const ledger = () => ({
    kills: Reflect.get(engine, 'kills') as number,
    gold: Reflect.get(engine, 'gold') as number,
    loot: (Reflect.get(engine, 'lootPickups') as unknown[]).length,
    deltas: JSON.stringify(source.blueprint.regions.map((region) => source.manager.getSavedDelta(region.id) ?? null)),
  })
  const plans = Reflect.get(engine, 'generatedEncounterPlans') as Map<string, GeneratedEncounterPlan[]>
  const stations = plans.get('region-4-1')!.find((plan) => plan.encounterId === NORTH_PACK)!.spawns
  // Stepping back is not dying: no kill, no gold, no loot, and not a word written into any
  // square's delta, which is everything about the generator's packs that a save carries.
  const before = ledger()
  assert.equal(invoke<boolean>(engine, 'makeRoomForStaging', 'chronicle', 5), true)
  assert.deepEqual(members(probe, NORTH_PACK), [])
  assert.deepEqual(ledger(), before)
  probe.contractFrames(0.1)
  assert.equal(probe.status(node), 'active')

  // It waits while the staging could still ask, and while it would not fit without anyone
  // giving way: the beasts and the defenders hold the room it left.
  probe.streamIn()
  assert.deepEqual(members(probe, NORTH_PACK), [])
  Reflect.set(engine, 'elapsed', Reflect.get(engine, 'parkHoldUntil') + STAGING_PARK_HOLD_SECONDS)
  probe.streamIn()
  assert.deepEqual(members(probe, NORTH_PACK), [], 'it came back by evicting someone')
  // The fight ends and its bodies are cleared away. Facing its stations, it still waits.
  const contract = (Reflect.get(engine, 'activeEvents') as Array<{ contractNodeId?: string; ownedActorIds: string[] }>)
    .find((event) => event.contractNodeId === node.id)
  assert.ok(contract)
  for (const id of contract.ownedActorIds) invoke(engine, 'removeActorById', id)
  probe.face(FACING_NORTH)
  probe.streamIn()
  assert.deepEqual(members(probe, NORTH_PACK), [], 'it came back in sight')

  // Turned away, it is home: each body once, on its station, whole, and never cleared.
  probe.face(FROM_THE_START)
  probe.streamIn()
  probe.streamIn()
  const home = members(probe, NORTH_PACK)
  assert.deepEqual(home.map((actor) => actor.generatedSpawnId).sort(), stations.map((spawn) => spawn.id).sort())
  for (const actor of home) {
    const station = stations.find((spawn) => spawn.id === actor.generatedSpawnId)!
    assert.ok(Math.hypot(actor.mesh.position.x - station.worldX, actor.mesh.position.z - station.worldZ) < 1e-9)
    assert.equal(actor.hp, actor.maxHp)
    assert.equal(actor.hostileToPlayer, false)
  }
  assert.equal(probe.parked().get('region-4-1')?.size ?? 0, 0)
  assert.ok(!(source.manager.getSavedDelta('region-4-1')?.clearedEncounterIds ?? []).includes(NORTH_PACK))

  // Negative control: the same pack cut down instead is beaten — the encounter is written
  // cleared and never comes back — so the checks above can tell the two apart.
  const killedWorld = freshWorld(1)
  const killed = arrive({ staging: false, source: killedWorld })
  for (const actor of members(killed, NORTH_PACK)) {
    actor.alive = false
    invoke(killed.engine, 'recordGeneratedActorDeath', actor)
    invoke(killed.engine, 'removeActorById', actor.id)
  }
  assert.ok((killedWorld.manager.getSavedDelta('region-4-1')?.clearedEncounterIds ?? []).includes(NORTH_PACK))
  killed.streamIn()
  assert.deepEqual(members(killed, NORTH_PACK), [])
})

test('an encounter is never written cleared while any of it is away', () => {
  const source = freshWorld(1)
  const probe = arrive({ staging: true, source })
  assert.equal(invoke<boolean>(probe.engine, 'makeRoomForStaging', 'chronicle', 5), true)
  const cleared = (): boolean =>
    (source.manager.getSavedDelta('region-4-1')?.clearedEncounterIds ?? []).includes(NORTH_PACK)
  // The last body of the encounter still on the field falls while the rest are away.
  const fall = (): void => {
    const straggler = probe.spawn('guard', 'soldier', 0, 0, 'campaign', {
      hostileToPlayer: false,
      generatedRegionId: 'region-4-1',
      generatedEncounterId: NORTH_PACK,
      generatedSpawnId: 'straggler',
    })
    straggler.alive = false
    invoke(probe.engine, 'recordGeneratedActorDeath', straggler)
  }
  fall()
  assert.equal(cleared(), false, 'a pack that stepped back was written beaten')
  // Negative control: without the check, the same fall writes the whole encounter cleared.
  Reflect.set(probe.engine, 'isEncounterParked', () => false)
  fall()
  assert.equal(cleared(), true)
})

test('a pack that stepped back leaves with its square and comes back with it, once', () => {
  const source = freshWorld(1)
  const probe = arrive({ staging: true, source })
  assert.equal(invoke<boolean>(probe.engine, 'makeRoomForStaging', 'chronicle', 5), true)
  assert.deepEqual(members(probe, NORTH_PACK), [])
  // Negative control: while the square stays and the staging could still ask, it stays away.
  probe.streamIn()
  assert.deepEqual(members(probe, NORTH_PACK), [])
  // Walk to the far side of the map: the square streams out, and what stood back with it.
  const parkedAt = source.blueprint.regions.find((region) => region.id === 'region-4-1')!
  const away = (region: (typeof source.blueprint.regions)[number]): number =>
    Math.abs(region.coordinate.x - parkedAt.coordinate.x) + Math.abs(region.coordinate.y - parkedAt.coordinate.y)
  const far = [...source.blueprint.regions].sort((left, right) => away(right) - away(left))[0]
  source.manager.update(far.id)
  probe.streamIn()
  assert.ok(!source.manager.getSimulatedRegionIds().map(String).includes('region-4-1'))
  assert.equal(probe.parked().has('region-4-1'), false)
  // And back, the hold still running: the square streams in with the whole pack on its
  // stations, once each, however many frames go by.
  source.manager.update(regionAt(source.blueprint, siteOf(source.blueprint, cull(source))))
  probe.streamIn()
  probe.streamIn()
  probe.streamIn()
  const back = members(probe, NORTH_PACK).map((actor) => actor.generatedSpawnId).sort()
  assert.deepEqual(back, ['encounter-region-4-1:actor:0', 'encounter-region-4-1:actor:1'])
  assert.ok(Reflect.get(probe.engine, 'elapsed') < Reflect.get(probe.engine, 'parkHoldUntil'))
})

/** The north pack steps back as a contract would ask, with the field's room left free. */
function parkNorthPack(rule = true): Probe {
  const probe = arrive({ staging: true })
  // Without the rule: the player's visits to the post are never noted, as before it.
  if (!rule) Reflect.set(probe.engine, 'stagingPostVisited', () => false)
  assert.equal(invoke<boolean>(probe.engine, 'makeRoomForStaging', 'chronicle', 5), true)
  assert.deepEqual(members(probe, NORTH_PACK), [])
  return probe
}

/** Stands the player `away` metres south of the north pack's post, looking along `yaw`. */
function standSouthOfPost(probe: Probe, away: number, yaw: number): void {
  const stations = northStations(probe)
  const x = stations.reduce((sum, station) => sum + station.x, 0) / stations.length
  probe.player.position.set(x, 0, Math.max(...stations.map((station) => station.z)) + away)
  probe.face(yaw)
}

function northStations(probe: Probe): Array<{ id: string; x: number; z: number }> {
  const plans = Reflect.get(probe.engine, 'generatedEncounterPlans') as Map<string, GeneratedEncounterPlan[]>
  return plans.get('region-4-1')!.find((plan) => plan.encounterId === NORTH_PACK)!.spawns
    .map((spawn) => ({ id: spawn.id, x: spawn.worldX, z: spawn.worldZ }))
}

function overHold(probe: Probe): void {
  Reflect.set(probe.engine, 'elapsed', Reflect.get(probe.engine, 'parkHoldUntil'))
}

test('the empty-post rule: a player at the post calls its pack home, and it comes back unseen', () => {
  // The player walks up to the post, 18 m short of it, facing it: it stands empty, and while
  // the player can see its stations it stays empty, though the hold is over and there is room.
  const walkUp = (rule: boolean): Probe => {
    const probe = parkNorthPack(rule)
    overHold(probe)
    standSouthOfPost(probe, 18, FACING_NORTH)
    probe.streamIn()
    assert.deepEqual(members(probe, NORTH_PACK), [], 'the pack came back in sight')
    return probe
  }
  const probe = walkUp(true)
  // The player turns away: every station is behind the camera now, and the pack is home, on
  // its stations, though the player stands well inside 60 m of them.
  probe.face(FROM_THE_START)
  const viewer = sight(probe)
  const stations = northStations(probe)
  for (const station of stations) {
    assert.ok(isHiddenFrom(viewer, station))
    assert.ok(Math.hypot(station.x - viewer.player.x, station.z - viewer.player.z) < STAGING_PARK_MIN_DISTANCE)
  }
  probe.streamIn()
  const home = members(probe, NORTH_PACK)
  assert.deepEqual(home.map((actor) => actor.generatedSpawnId).sort(), stations.map((station) => station.id).sort())
  for (const actor of home) {
    const station = stations.find((entry) => entry.id === actor.generatedSpawnId)!
    assert.ok(Math.hypot(actor.mesh.position.x - station.x, actor.mesh.position.z - station.z) < 1e-9)
  }
  assert.equal(probe.parked().get('region-4-1')?.size ?? 0, 0)

  // Negative control: without the rule the same turn finds the pack still away, because the
  // player stands too near for it to come back; walked 70 m off, it does.
  const control = walkUp(false)
  control.face(FROM_THE_START)
  control.streamIn()
  assert.deepEqual(members(control, NORTH_PACK), [], 'the control came back without the rule')
  standSouthOfPost(control, 70, FROM_THE_START)
  control.streamIn()
  assert.equal(members(control, NORTH_PACK).length, 2)

  // Called home, it does not wait for the player to go 60 m off: having seen the empty post
  // and backed away to 40 m, the player looks away and it is back.
  const backedOff = walkUp(true)
  standSouthOfPost(backedOff, 40, FACING_NORTH)
  backedOff.streamIn()
  assert.deepEqual(members(backedOff, NORTH_PACK), [])
  backedOff.face(FROM_THE_START)
  backedOff.streamIn()
  assert.equal(members(backedOff, NORTH_PACK).length, 2)
  // Negative control: a pack whose post the player never walked up to stays away at 40 m.
  const never = parkNorthPack()
  overHold(never)
  standSouthOfPost(never, 40, FROM_THE_START)
  never.streamIn()
  assert.deepEqual(members(never, NORTH_PACK), [])
})

test('a pack called home still waits for the hold, and for room on the field', () => {
  const visit = (rule: boolean) => {
    const probe = parkNorthPack(rule)
    // At the post and looking away while the hold still runs: the visit counts, the hold holds.
    standSouthOfPost(probe, 18, FROM_THE_START)
    probe.streamIn()
    assert.deepEqual(members(probe, NORTH_PACK), [], 'it came back during the hold')
    // The player backs off to 40 m, still looking away, and the field fills meanwhile: an
    // event puts five bodies down at the contract's site.
    standSouthOfPost(probe, 40, FROM_THE_START)
    const site = siteOf(probe.blueprint, cull())
    const filler = Array.from({ length: 5 }, (_, index) =>
      probe.spawn('guard', 'soldier', site.x + index, site.z, 'chronicle', {
        eventOwnerId: 'test-event',
        hostileToPlayer: false,
      }))
    overHold(probe)
    probe.streamIn()
    assert.deepEqual(members(probe, NORTH_PACK), [], 'it came back by evicting someone')
    assert.ok(filler.every((actor) => probe.actors.includes(actor)))
    // One of them goes: now the whole pack fits.
    invoke(probe.engine, 'removeActorById', filler[0].id)
    probe.streamIn()
    return probe
  }
  assert.equal(members(visit(true), NORTH_PACK).length, 2)
  // Negative control: the same visit without the rule leaves the post empty at 40 m.
  assert.deepEqual(members(visit(false), NORTH_PACK), [])
})

// ---------------------------------------------------------------------------
// 3. The same rule for a caravan beat
// ---------------------------------------------------------------------------

test('a beat that needs campaign room asks the same way, and a running contract keeps its own', () => {
  const node = cull()
  const started = (): Probe => {
    const probe = arrive({ staging: true })
    probe.contractFrames(0.1)
    assert.equal(probe.status(node), 'active')
    return probe
  }
  const fightersOf = (probe: Probe): HeadlessActor[] => {
    const contract = (Reflect.get(probe.engine, 'activeEvents') as Array<{ contractNodeId?: string; ownedActorIds: string[] }>)
      .find((event) => event.contractNodeId === node.id)
    assert.ok(contract)
    return probe.actors.filter((actor) => contract.ownedActorIds.includes(actor.id))
  }
  const probe = started()
  const fighters = fightersOf(probe)
  assert.equal(fighters.length, 5)
  // Three campaign slots for a beat: the south pack, behind a guard now facing north, steps
  // back, and the slots are reserved without a single contract body given up.
  probe.face(FACING_NORTH)
  assert.equal(invoke<boolean>(probe.engine, 'makeRoomForStaging', 'campaign', 3), true)
  assert.deepEqual(members(probe, SOUTH_PACK), [])
  assert.equal(invoke<boolean>(probe.engine, 'reserveActorSlots', 'campaign', 3), true)
  for (const fighter of fighters) assert.ok(probe.actors.includes(fighter) && fighter.alive)

  // Negative control: with nobody stepping back the beat finds no room, and the contract's
  // bodies are not what it gets instead.
  const control = started()
  const kept = fightersOf(control)
  Reflect.set(control.engine, 'standAsidePacks', () => [])
  control.face(FACING_NORTH)
  assert.equal(invoke<boolean>(control.engine, 'makeRoomForStaging', 'campaign', 3), false)
  assert.equal(invoke<boolean>(control.engine, 'reserveActorSlots', 'campaign', 3), false)
  assert.equal(members(control, SOUTH_PACK).length, 3)
  for (const fighter of kept) assert.ok(control.actors.includes(fighter) && fighter.alive)
})

// ---------------------------------------------------------------------------
// 4. The guard test: every contract site, every way the player might face
// ---------------------------------------------------------------------------

function demandSeeds(): number[] {
  const raw = Number(process.env.KOROVANY_DEMAND_SEEDS)
  const count = Number.isInteger(raw) && raw > 0 ? raw : 40
  return Array.from({ length: count }, (_, index) => 1 + 7919 * index)
}

/**
 * One arrival at one contract site, facing `yaw`: the squad, the engine's window through the
 * production spawner, then the production start gate. The contract's builder is replaced by
 * an event stub, so what is measured is whether the gate finds room.
 */
function arriveAt(source: World, faction: Faction, node: FactionObjectiveNode, staging: boolean, yaw: number) {
  const probe = field(source, faction, { node, staging, yaw })
  probe.squad()
  probe.streamIn()
  const hostile = probe.actors.filter((actor) => actor.alive && actor.hostileToPlayer).map((actor) => actor.id)
  const viewer = sight(probe)
  const seen = probe.actors.filter((actor) => actor.alive && !isHiddenFrom(viewer, {
    x: actor.mesh.position.x,
    z: actor.mesh.position.z,
  })).map((actor) => actor.id)
  Reflect.set(probe.engine, 'buildContractEvent', () => invoke(probe.engine, 'createWorldEvent', {
    id: `test-contract-${node.id}`,
    kind: 'champion',
    anchor: 'located',
    regionId: String(node.regionId),
    situationId: null,
    state: 'active',
    title: 'Тест',
    description: 'Тест.',
    tone: 'warning',
    timer: 60,
    progress: 0,
    target: 1,
    markerId: `test-contract-${node.id}-marker`,
    markerPos: new THREE.Vector3(),
    ownedActorIds: [],
    ownedProps: [],
  }))
  const template = findContractTemplate(node.contract)
  assert.ok(template)
  const outcome = invoke<string>(probe.engine, 'startContractEvent', node, template, siteOf(source.blueprint, node))
  const alive = new Set(probe.actors.filter((actor) => actor.alive).map((actor) => actor.id))
  return {
    seed: source.seed,
    faction,
    node: node.id,
    outcome,
    enemiesGone: hostile.filter((id) => !alive.has(id)).length,
    seenGone: seen.filter((id) => !alive.has(id)).length,
    overCap: probe.actors.length > MAX_ACTORS,
  }
}

test('guard test: whichever way the player faces, no contract site is crowded by its own side', () => {
  const seeds = demandSeeds()
  const headings = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
  const staged: ReturnType<typeof arriveAt>[] = []
  const unstaged: ReturnType<typeof arriveAt>[] = []
  for (const seed of seeds) {
    const source = world(seed)
    for (const faction of FACTIONS) {
      for (const node of getContractNodes(source.blueprint, faction)) {
        unstaged.push(arriveAt(source, faction, node, false, 0))
        for (const yaw of headings) staged.push(arriveAt(source, faction, node, true, yaw))
      }
    }
  }
  const crowded = (arrivals: typeof staged, faction: Faction) =>
    arrivals.filter((arrival) => arrival.faction === faction && arrival.outcome === 'crowded')
  if (process.env.KOROVANY_DEMAND_VERBOSE) {
    for (const faction of FACTIONS) {
      console.log(`${faction}: crowded ${String(crowded(unstaged, faction).length)} without, ` +
        `${String(crowded(staged, faction).length)} of ${String(staged.length / 3)} staged arrivals`)
    }
    for (const arrival of [...crowded(staged, 'guard'), ...crowded(staged, 'elf'), ...crowded(staged, 'villain')]) {
      console.log(`  staged crowded: seed ${String(arrival.seed)} ${arrival.faction} ${arrival.node}`)
    }
  }
  assert.equal(unstaged.length, seeds.length * 6)
  for (const arrival of [...staged, ...unstaged]) {
    assert.ok(arrival.outcome === 'started' || arrival.outcome === 'crowded', 'only room decides an arrival here')
    assert.equal(arrival.enemiesGone, 0, `seed ${String(arrival.seed)} ${arrival.node}: an enemy stepped back`)
    assert.equal(arrival.seenGone, 0, `seed ${String(arrival.seed)} ${arrival.node}: a body in sight stepped back`)
    assert.equal(arrival.overCap, false)
  }
  for (const faction of FACTIONS) {
    assert.deepEqual(crowded(staged, faction), [], `${faction} is still crowded with the staging on`)
  }
  // Negative control: without the staging the guard's residual is there to be found.
  if (seeds.includes(1)) assert.ok(crowded(unstaged, 'guard').length >= 1, 'the residual is gone without the fix')
})
