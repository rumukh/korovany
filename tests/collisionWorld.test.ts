import assert from 'node:assert/strict'
import test from 'node:test'
import { CollisionWorld } from '../src/game/systems/CollisionWorld.ts'

function createFlatTerrain() {
  return {
    bounds: { minX: 0, maxX: 200, minZ: 0, maxZ: 200 },
    sampleHeight: (x: number, z: number) => x * 0.1 + z * 0.05,
    estimateSlope: () => 0,
    isWalkableSlope: () => true,
  }
}

test('spatial queries handle circles and oriented boxes without scanning the world', () => {
  const collision = new CollisionWorld(createFlatTerrain(), { cellSize: 4 })
  collision.registerCircle({
    id: 'circle',
    regionId: 'near' as never,
    x: 8,
    z: 8,
    radius: 1,
  })
  collision.registerBox({
    id: 'rotated',
    regionId: 'near' as never,
    x: 16,
    z: 16,
    halfWidth: 3,
    halfDepth: 0.4,
    rotation: Math.PI / 4,
  })
  for (let index = 0; index < 40; index += 1) {
    collision.registerCircle({
      id: `far-${index}`,
      regionId: 'far' as never,
      x: 80 + (index % 8) * 5,
      z: 80 + Math.floor(index / 8) * 5,
      radius: 0.5,
    })
  }

  assert.deepEqual(
    collision.queryCircle(8.5, 8, 0.25).map((entry) => entry.id),
    ['circle'],
  )
  const alongBoxAxis = {
    x: 16 + Math.cos(Math.PI / 4) * 2,
    z: 16 + Math.sin(Math.PI / 4) * 2,
  }
  assert.equal(
    collision.overlapsCircle(alongBoxAxis.x, alongBoxAxis.z, 0.1),
    true,
  )
  const awayFromBoxAxis = {
    x: 16 - Math.sin(Math.PI / 4) * 1.2,
    z: 16 + Math.cos(Math.PI / 4) * 1.2,
  }
  assert.equal(
    collision.overlapsCircle(awayFromBoxAxis.x, awayFromBoxAxis.z, 0.1),
    false,
  )
  assert.ok(collision.getDebugStats().lastQueryCandidateCount < collision.size)
})

test('movement resolution pushes a circular actor out and samples terrain height', () => {
  const collision = new CollisionWorld(createFlatTerrain(), {
    cellSize: 2,
    worldBounds: { minX: 0, maxX: 30, minZ: 0, maxZ: 30 },
  })
  collision.registerBox({
    id: 'wall',
    regionId: 'center' as never,
    x: 10,
    z: 10,
    halfWidth: 0.4,
    halfDepth: 4,
  })

  const result = collision.resolveMovement(
    { x: 5, z: 10 },
    { x: 15, z: 10 },
    0.5,
  )
  assert.equal(result.blocked, true)
  assert.deepEqual(result.collisionIds, ['wall'])
  assert.ok(result.x <= 9.100001)
  assert.ok(result.x >= 9.099)
  assert.equal(result.z, 10)
  assert.equal(result.y, collision.sampleHeight(result.x, result.z))
  assert.equal(collision.overlapsCircle(result.x, result.z, 0.5), false)
})

test('active bounds and terrain slope participate in walkability', () => {
  const terrain = {
    ...createFlatTerrain(),
    estimateSlope: (x: number) => (x > 10 ? Math.PI / 3 : 0),
    isWalkableSlope: (x: number, _z: number, maxSlope = Math.PI / 4) =>
      (x > 10 ? Math.PI / 3 : 0) <= maxSlope,
  }
  const collision = new CollisionWorld(terrain, {
    worldBounds: { minX: 0, maxX: 30, minZ: 0, maxZ: 30 },
  })
  collision.setActiveBounds({ minX: 2, maxX: 20, minZ: 2, maxZ: 20 })
  assert.equal(collision.isWalkablePosition(5, 5, 0.5), true)
  assert.equal(collision.isWalkablePosition(1, 5, 0.5), false)
  assert.equal(collision.isWalkablePosition(15, 5, 0.5), false)
})

test('movement clamps a full actor circle inside adjacent active bounds', () => {
  const collision = new CollisionWorld(createFlatTerrain(), {
    worldBounds: { minX: 0, maxX: 30, minZ: 0, maxZ: 10 },
  })
  collision.setActiveBounds([
    { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
    { minX: 10, maxX: 20, minZ: 0, maxZ: 10 },
  ])

  const result = collision.resolveMovement(
    { x: 15, z: 5 },
    { x: 21, z: 5 },
    1,
  )
  assert.equal(result.x, 19)
  assert.equal(result.z, 5)
  assert.equal(collision.isWithinBounds(result.x, result.z, 1), true)
  assert.equal(collision.isWithinBounds(10, 5, 1), true)
})

test('removing a region clears every collider and stale spatial bucket reference', () => {
  const collision = new CollisionWorld(createFlatTerrain(), { cellSize: 2 })
  collision.registerCircle({
    id: 'a-circle',
    regionId: 'a' as never,
    x: 4,
    z: 4,
    radius: 1.5,
  })
  collision.registerBox({
    id: 'a-box',
    regionId: 'a' as never,
    x: 7,
    z: 4,
    halfWidth: 1,
    halfDepth: 1,
  })
  collision.registerCircle({
    id: 'b-circle',
    regionId: 'b' as never,
    x: 40,
    z: 40,
    radius: 1,
  })
  const revision = collision.getRegionRevision('a' as never)

  assert.equal(collision.removeRegion('a' as never), 2)
  assert.equal(collision.hasCollider('a-circle'), false)
  assert.equal(collision.hasCollider('a-box'), false)
  assert.equal(collision.hasCollider('b-circle'), true)
  assert.equal(collision.queryBounds({ minX: 0, maxX: 10, minZ: 0, maxZ: 10 }).length, 0)
  assert.ok(collision.getRegionRevision('a' as never) > revision)
  assert.equal(collision.getDebugStats().colliderCount, 1)
  const onlyRegionB = new CollisionWorld(createFlatTerrain(), { cellSize: 2 })
  onlyRegionB.registerCircle({
    id: 'b-circle',
    regionId: 'b' as never,
    x: 40,
    z: 40,
    radius: 1,
  })
  assert.equal(
    collision.getDebugStats().bucketCount,
    onlyRegionB.getDebugStats().bucketCount,
  )
  assert.equal(collision.removeRegion('a' as never), 0)
})
