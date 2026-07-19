import assert from 'node:assert/strict'
import test from 'node:test'
import { CollisionWorld } from '../src/game/systems/CollisionWorld.ts'
import { NavigationSystem } from '../src/game/systems/NavigationSystem.ts'
import { TerrainSystem } from '../src/game/world/TerrainSystem.ts'

function createNavigationWorld() {
  const region = (
    id: string,
    x: number,
    z: number,
    minX: number,
    minZ: number,
  ) => ({
    id,
    coordinate: { x, z },
    bounds: { minX, maxX: minX + 8, minZ, maxZ: minZ + 8 },
    heightProfile: {
      baseHeight: 0,
      amplitude: 0,
      frequency: 0.02,
      roughness: 0.5,
    },
  })
  return {
    seed: 1234,
    regionSize: 8,
    bounds: { minX: 0, maxX: 24, minZ: 0, maxZ: 16 },
    regions: [
      region('a', 0, 0, 0, 0),
      region('b', 1, 0, 8, 0),
      region('c', 2, 0, 16, 0),
      region('disconnected', 2, 1, 16, 8),
    ],
    connections: [
      {
        from: 'a',
        to: 'b',
        direction: 'east',
        portal: { minZ: 2, maxZ: 6 },
      },
      {
        from: 'b',
        to: 'c',
        direction: 'east',
        portal: { minZ: 2, maxZ: 6 },
      },
    ],
  }
}

function createSystems() {
  const blueprint = createNavigationWorld()
  const terrain = new TerrainSystem(blueprint as never)
  const collision = new CollisionWorld(terrain, {
    cellSize: 2,
    worldBounds: blueprint.bounds,
  })
  const navigation = new NavigationSystem(
    blueprint as never,
    terrain,
    collision,
    {
      cellSize: 1,
      agentRadius: 0.2,
      maxSlope: Math.PI / 4,
    },
  )
  navigation.setActiveRegions(
    blueprint.regions.map((region) => region.id as never),
  )
  return { terrain, collision, navigation }
}

test('A* crosses active connected portals and returns world-space waypoints', () => {
  const { navigation } = createSystems()
  const path = navigation.findPath({ x: 1, z: 4 }, { x: 23, z: 4 })

  assert.ok(path)
  assert.deepEqual(path[0], { x: 1, y: 0, z: 4, regionId: 'a' })
  assert.deepEqual(path[path.length - 1], {
    x: 23,
    y: 0,
    z: 4,
    regionId: 'c',
  })
  assert.ok(path.some((waypoint) => waypoint.regionId === 'b'))
  assert.ok(path.every((waypoint) => Number.isFinite(waypoint.y)))
})

test('navigation rebuilds a changed region grid and routes around blocked cells', () => {
  const { collision, navigation } = createSystems()
  const originalGrid = navigation.getGrid('b' as never)
  assert.ok(originalGrid)
  collision.registerBox({
    id: 'middle-blocker',
    regionId: 'b' as never,
    x: 12,
    z: 4,
    halfWidth: 0.8,
    halfDepth: 0.8,
  })
  const rebuiltGrid = navigation.getGrid('b' as never)
  assert.ok(rebuiltGrid)
  assert.notEqual(rebuiltGrid.revision, originalGrid.revision)

  const path = navigation.findPath({ x: 1, z: 4 }, { x: 23, z: 4 })
  assert.ok(path)
  assert.ok(path.some((waypoint) => Math.abs(waypoint.z - 4) > 0.5))
  for (const waypoint of path) {
    assert.equal(
      collision.overlapsCircle(waypoint.x, waypoint.z, 0.19),
      false,
    )
  }
})

test('navigation rejects disconnected and blocked destinations', () => {
  const { collision, navigation } = createSystems()
  assert.equal(
    navigation.findPath({ x: 1, z: 4 }, { x: 20, z: 12 }),
    null,
  )

  collision.registerCircle({
    id: 'destination-blocker',
    regionId: 'c' as never,
    x: 23,
    z: 4,
    radius: 0.75,
  })
  assert.equal(
    navigation.findPath({ x: 1, z: 4 }, { x: 23, z: 4 }),
    null,
  )
})
