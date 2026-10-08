/**
 * W3-4 — the streaming hold: turning back into the square just left does not recentre the world
 * for `STREAMING_RETURN_HOLD_METRES`.
 *
 * The rule itself on a grid of 80 m squares; then the real `GeneratedWorldRuntime`, which builds
 * and throws away scene squares as its centre moves; then the shipped `GameEngine` streaming its
 * packs through `syncGeneratedRegions` and the production spawner on top of that runtime. Each
 * has the rule before W3-4 as its negative control: the centre on the player's own square, frame
 * by frame, which is what `recentre` asks for.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { createGeneratedEncounterPlans, getBlueprintRegionBounds } from '../src/game/content/registry.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import {
  STREAMING_RETURN_HOLD_METRES,
  advanceStreamingCentre,
  createStreamingCentreState,
  distanceToSquare,
  recentreStreaming,
  type StreamingSquare,
} from '../src/game/world/StreamingCentre.ts'
import { createFinaleIdentity } from '../src/game/world/FinaleDirector.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import type { WorldBlueprint } from '../src/game/world/worldTypes.ts'
import { field, invoke, SEED } from './remnantField.ts'

// ---------------------------------------------------------------------------
// The rule, on a grid
// ---------------------------------------------------------------------------

const SIZE = 80
const grid = new Map<string, StreamingSquare>()
for (let x = 0; x < 5; x += 1) {
  for (let z = 0; z < 5; z += 1) {
    grid.set(`${x},${z}`, {
      id: `${x},${z}`,
      coordinate: { x, z },
      bounds: { minX: x * SIZE, maxX: (x + 1) * SIZE, minZ: z * SIZE, maxZ: (z + 1) * SIZE },
    })
  }
}
const squareAt = (x: number, z: number): StreamingSquare =>
  grid.get(`${Math.min(4, Math.floor(x / SIZE))},${Math.min(4, Math.floor(z / SIZE))}`)!
const squareOf = (id: string) => grid.get(id)

/** One step of the player at `(x, z)`; true when the centre moved. */
function stepper(holdMetres = STREAMING_RETURN_HOLD_METRES) {
  const state = createStreamingCentreState<string>()
  return {
    state,
    at: (x: number, z: number) => advanceStreamingCentre(state, squareAt(x, z), { x, z }, squareOf, holdMetres),
  }
}

test('walking on moves the centre at the edge, exactly as before', () => {
  const walk = stepper()
  assert.equal(walk.at(200, 200), true)
  assert.equal(walk.state.centre, '2,2')
  // Into the next square: the very first metre recentres.
  assert.equal(walk.at(240.1, 200), true)
  assert.equal(walk.state.centre, '3,2')
  assert.equal(walk.state.previous, '2,2')
  // And on into the one after, without ever turning back.
  assert.equal(walk.at(320.1, 200), true)
  assert.equal(walk.state.centre, '4,2')
})

test('turning back into the square just left waits 16 m before the world recentres on it', () => {
  const walk = stepper()
  walk.at(200, 200)
  walk.at(250, 200)
  assert.equal(walk.state.centre, '3,2')
  for (const depth of [0.1, 1, 8, 15.9]) {
    assert.equal(walk.at(240 - depth, 200), false, `${depth} m back`)
    assert.equal(walk.state.centre, '3,2')
  }
  assert.equal(walk.at(240 - 16, 200), true)
  assert.equal(walk.state.centre, '2,2')
  assert.equal(walk.state.previous, '3,2')
  // The hold works both ways once the player has turned twice.
  assert.equal(walk.at(240 + 10, 200), false)
  assert.equal(walk.state.centre, '2,2')
})

test('an edge walked back and forth inside the hold moves the centre once; the old rule moved it every time', () => {
  for (const [hold, expected] of [[STREAMING_RETURN_HOLD_METRES, 1], [0, 40]] as const) {
    const walk = stepper(hold)
    walk.at(230, 200)
    let moves = 0
    for (let crossing = 0; crossing < 40; crossing += 1) {
      // Ten metres one side, ten the other, in half-metre steps.
      const from = crossing % 2 === 0 ? 230 : 250
      const to = crossing % 2 === 0 ? 250 : 230
      for (let step = 1; step <= 40; step += 1) {
        if (walk.at(from + ((to - from) * step) / 40, 200)) moves += 1
      }
    }
    assert.equal(moves, expected, `hold ${hold} m`)
  }
})

test('a square that is not the one just left never waits: corners, and teleports', () => {
  const walk = stepper()
  walk.at(200, 200)
  walk.at(250, 200)
  // Back into 2,2 near its corner, held...
  walk.at(235, 238)
  assert.equal(walk.state.centre, '3,2')
  // ...and across into 2,3, the held centre's diagonal: at once, or the player's square
  // would not be simulated.
  assert.equal(walk.at(235, 241), true)
  assert.equal(walk.state.centre, '2,3')
  // A teleport recentres at once, with nothing to turn back into.
  assert.equal(recentreStreaming(walk.state, '0,0'), true)
  assert.deepEqual(walk.state, { centre: '0,0', previous: null })
  assert.equal(walk.at(85, 10), true, 'one metre into 1,0 is a new square')
})

test('on any walk the player stands in the simulated plus, and away from edges the plus is centred on them', () => {
  const walk = stepper()
  let x = 200
  let z = 200
  let heading = 0
  let seed = 12345
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  let holds = 0
  for (let step = 0; step < 50_000; step += 1) {
    if (random() < 0.02) heading = random() * Math.PI * 2
    x = Math.min(399.9, Math.max(0.1, x + Math.cos(heading) * 1.2))
    z = Math.min(399.9, Math.max(0.1, z + Math.sin(heading) * 1.2))
    walk.at(x, z)
    const here = squareAt(x, z)
    const centre = squareOf(walk.state.centre!)!
    const manhattan = Math.abs(here.coordinate.x - centre.coordinate.x) + Math.abs(here.coordinate.z - centre.coordinate.z)
    assert.ok(manhattan <= 1, `step ${step}: the player's square ${here.id} is outside the plus of ${centre.id}`)
    if (here.id !== centre.id) {
      holds += 1
      assert.ok(distanceToSquare({ x, z }, centre.bounds) < STREAMING_RETURN_HOLD_METRES)
    }
  }
  assert.ok(holds > 100, `the walk turned back across an edge only ${holds} times`)
})

// ---------------------------------------------------------------------------
// The real runtime
// ---------------------------------------------------------------------------

interface EdgeCase {
  blueprint: WorldBlueprint
  /** The square the edge walk starts in, and the one beyond the edge. */
  west: string
  east: string
  /** The edge between them, and a row through the middle of both. */
  edgeX: number
  rowZ: number
  /** East's own east neighbour, which only the eastern centre simulates, and its hostile pack. */
  beyond: string
}

/** Two interior squares side by side, the second with a hostile pack beyond it in the same row. */
function edgeCase(faction: 'elf' | 'guard' | 'villain' = 'elf'): EdgeCase {
  const blueprint = generateWorld(SEED)
  const plans = Object.values(createGeneratedEncounterPlans(blueprint, faction))
  const start = String(blueprint.sites.find((site) => site.id === blueprint.starts[faction])!.regionId)
  const finale = createFinaleIdentity(blueprint, faction).regionId
  const at = (x: number, y: number) => blueprint.regions.find((region) => region.coordinate.x === x && region.coordinate.y === y)
  for (const region of blueprint.regions) {
    // Interior rows and a west square with a column beyond it, so every column moved is three squares.
    if (region.coordinate.x < 1 || region.coordinate.y < 1 || region.coordinate.y > 3) continue
    const east = at(region.coordinate.x + 1, region.coordinate.y)
    const beyond = at(region.coordinate.x + 2, region.coordinate.y)
    if (!east || !beyond) continue
    const ids = [region, east, beyond].map((candidate) => String(candidate.id))
    if (ids.includes(start) || ids.includes(finale)) continue
    const pack = plans.find((plan) =>
      String(plan.regionId) === String(beyond.id) && plan.kind !== 'boss' && plan.hostileToPlayer && plan.spawns.length >= 2)
    if (!pack) continue
    const westBounds = getBlueprintRegionBounds(blueprint, region.id)!
    return {
      blueprint,
      west: String(region.id),
      east: String(east.id),
      edgeX: westBounds.maxX,
      rowZ: (westBounds.minZ + westBounds.maxZ) / 2,
      beyond: String(beyond.id),
    }
  }
  throw new Error('no row of three squares with a hostile pack at its end')
}

/** The edge walk: from the middle of `west` into `east`, then 20 crossings ten metres either side. */
function edgeWalk(edge: EdgeCase): Array<{ x: number; z: number }> {
  const points: Array<{ x: number; z: number }> = []
  for (let x = edge.edgeX - 40; x <= edge.edgeX + 10; x += 0.5) points.push({ x, z: edge.rowZ })
  for (let crossing = 0; crossing < 20; crossing += 1) {
    const from = crossing % 2 === 0 ? edge.edgeX + 10 : edge.edgeX - 10
    const to = crossing % 2 === 0 ? edge.edgeX - 10 : edge.edgeX + 10
    for (let step = 1; step <= 40; step += 1) points.push({ x: from + ((to - from) * step) / 40, z: edge.rowZ })
  }
  return points
}

test('the runtime builds no square and moves no plus while an edge is walked back and forth', () => {
  const edge = edgeCase()
  const walk = edgeWalk(edge)
  const firstCrossing = walk.findIndex((point) => point.x > edge.edgeX)
  const observe = (recentre: boolean) => {
    const runtime = new GeneratedWorldRuntime(new THREE.Scene(), edge.blueprint, { decorationDensity: 0, terrainResolution: 6 })
    try {
      let builtAfterCrossing = 0
      let simulatedSets = new Set<string>()
      let squares = new Set<string>()
      for (const [index, point] of walk.entries()) {
        const before = runtime.regionBuildCount
        runtime.update({ focus: point, deltaSeconds: 1 / 30, recentre })
        if (index > firstCrossing) {
          builtAfterCrossing += runtime.regionBuildCount - before
          simulatedSets.add(runtime.regions.getSimulatedRegionIds().map(String).join('|'))
          squares.add(String(runtime.currentRegionId))
        }
        // The player's own square is always simulated.
        assert.ok(runtime.regions.getSimulatedRegionIds().map(String).includes(String(runtime.currentRegionId)))
      }
      return { builtAfterCrossing, simulatedSets: simulatedSets.size, squares: [...squares].sort(), centre: String(runtime.streamingCentreId), discovered: runtime.discoveredRegionIds.map(String) }
    } finally {
      runtime.dispose()
    }
  }
  const held = observe(false)
  assert.equal(held.builtAfterCrossing, 0, 'no scene square was built')
  assert.equal(held.simulatedSets, 1, 'the plus never moved')
  assert.equal(held.centre, edge.east)
  // `currentRegionId` still names the square the player stands in, both of them.
  assert.deepEqual(held.squares, [edge.east, edge.west].sort())
  // The control: the rule before W3-4 rebuilt three squares on every one of the 20 crossings.
  const instant = observe(true)
  assert.equal(instant.builtAfterCrossing, 3 * 20)
  assert.equal(instant.simulatedSets, 2)
  // Discovery is the squares stepped into, in the order they were stepped into, either way.
  assert.deepEqual(held.discovered, instant.discovered)
})

// ---------------------------------------------------------------------------
// The engine on top of it
// ---------------------------------------------------------------------------

test('the engine keeps the same pack, wounds and all, while the player steps back and forth over an edge', () => {
  const edge = edgeCase()
  const run = (recentre: boolean) => {
    const probe = field('elf', edge.blueprint, { runtime: true })
    try {
      const walkTo = (x: number, z: number) => {
        probe.player.position.set(x, 0, z)
        probe.runtime!.update({ focus: { x, z }, deltaSeconds: 1 / 30, recentre })
        invoke(probe.engine, 'syncGeneratedRegions')
      }
      let spawned = 0
      let removed = 0
      const spawnActor = Reflect.get(probe.engine, 'spawnActor') as (...args: unknown[]) => unknown
      Reflect.set(probe.engine, 'spawnActor', (...args: unknown[]) => {
        spawned += 1
        return spawnActor(...args)
      })
      const removeActorById = Reflect.get(probe.engine, 'removeActorById') as (id: string) => void
      Reflect.set(probe.engine, 'removeActorById', (id: string) => {
        removed += 1
        return Reflect.apply(removeActorById, probe.engine, [id])
      })
      const walk = edgeWalk(edge)
      const firstCrossing = walk.findIndex((point) => point.x > edge.edgeX)
      for (const point of walk.slice(0, firstCrossing + 1)) walkTo(point.x, point.z)
      // East is the centre now, so the pack beyond it is on the field: wound one of them.
      const pack = probe.actors.filter((actor) => actor.alive && actor.generatedRegionId === edge.beyond)
      assert.ok(pack.length >= 2, 'the pack beyond the edge is fielded')
      const target = pack.find((actor) => actor.role !== 'brute') ?? pack[0]
      probe.strike(target, 9)
      const wounded = { id: target.generatedSpawnId, hp: target.hp }
      spawned = 0
      removed = 0
      for (const point of walk.slice(firstCrossing + 1)) walkTo(point.x, point.z)
      const now = probe.actors.find((actor) => actor.generatedSpawnId === wounded.id)
      return { spawned, removed, sameBody: now === target, hp: now?.hp, wounded }
    } finally {
      probe.dispose()
    }
  }
  const held = run(false)
  assert.equal(held.spawned, 0, 'nobody was fielded again')
  assert.equal(held.removed, 0, 'nobody was sent home')
  assert.equal(held.sameBody, true, 'the very same body stands on the field')
  assert.equal(held.hp, held.wounded.hp)
  // The control: the rule before W3-4 sent the pack home and fielded it again on every crossing.
  // The ledger at least brings it back with its wound, but it is a new body each time.
  const instant = run(true)
  assert.ok(instant.spawned >= 10 * 2, `only ${instant.spawned} bodies fielded again`)
  assert.ok(instant.removed >= 10 * 2, `only ${instant.removed} bodies sent home`)
  assert.equal(instant.sameBody, false)
  assert.equal(instant.hp, instant.wounded.hp, 'W3-4 remnants still keep the wound across the crossings')
})
