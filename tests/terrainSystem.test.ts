import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeWorldBlueprint,
  TerrainSystem,
} from '../src/game/world/TerrainSystem.ts'
import { DEFAULT_REGION_SIZE } from '../src/game/world/worldTypes.ts'

function createWorld() {
  return {
    seed: 'terrain-test-seed',
    regionSize: 16,
    bounds: { minX: 0, maxX: 32, minZ: 0, maxZ: 32 },
    regions: [
      {
        id: 'north-west',
        coordinate: { x: 0, z: 0 },
        bounds: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 },
        biomeId: 'meadow',
        heightProfile: {
          baseHeight: -1,
          relief: 4,
          featureScale: 40,
          detailScale: 12,
          roughnessPermille: 450,
        },
      },
      {
        id: 'north-east',
        coordinate: { x: 1, z: 0 },
        bounds: { minX: 16, maxX: 32, minZ: 0, maxZ: 16 },
        biomeId: 'hills',
        heightProfile: {
          baseHeight: 3,
          relief: 7,
          featureScale: 56,
          detailScale: 15,
          roughnessPermille: 580,
        },
      },
      {
        id: 'south-west',
        coordinate: { x: 0, z: 1 },
        bounds: { minX: 0, maxX: 16, minZ: 16, maxZ: 32 },
        biomeId: 'forest',
        heightProfile: {
          baseHeight: 1,
          relief: 5,
          featureScale: 46,
          detailScale: 13,
          roughnessPermille: 500,
        },
      },
      {
        id: 'south-east',
        coordinate: { x: 1, z: 1 },
        bounds: { minX: 16, maxX: 32, minZ: 16, maxZ: 32 },
        biomeId: 'ridge',
        heightProfile: {
          baseHeight: 5,
          relief: 8,
          featureScale: 62,
          detailScale: 16,
          roughnessPermille: 620,
        },
      },
    ],
  }
}

test('normalization uses the shared 80-unit default region size', () => {
  const world = createWorld()
  const regions = world.regions.map((region) => ({
    id: region.id,
    coordinate: region.coordinate,
    biomeId: region.biomeId,
    heightProfile: region.heightProfile,
  }))
  const layout = normalizeWorldBlueprint({ seed: world.seed, regions } as never)

  assert.equal(layout.regionSize, DEFAULT_REGION_SIZE)
  assert.equal(layout.bounds.maxX - layout.bounds.minX, DEFAULT_REGION_SIZE * 2)
  assert.equal(layout.bounds.maxZ - layout.bounds.minZ, DEFAULT_REGION_SIZE * 2)
})

test('world-space height samples are deterministic and continuous at region borders', () => {
  const world = createWorld()
  const terrain = new TerrainSystem(world as never)
  const reversed = new TerrainSystem(
    { ...world, regions: [...world.regions].reverse() } as never,
  )
  const coordinates = [
    { x: 2.25, z: 3.75 },
    { x: 16, z: 1 },
    { x: 16, z: 8 },
    { x: 16, z: 16 },
    { x: 7, z: 16 },
    { x: 28.5, z: 26.25 },
  ]
  const expected = coordinates.map(({ x, z }) => terrain.sampleHeight(x, z))

  for (let index = coordinates.length - 1; index >= 0; index -= 1) {
    const point = coordinates[index]
    assert.equal(terrain.sampleHeight(point.x, point.z), expected[index])
    assert.equal(reversed.sampleHeight(point.x, point.z), expected[index])
  }

  for (let index = 0; index <= 16; index += 1) {
    const z = index
    const border = terrain.sampleHeight(16, z)
    assert.ok(Math.abs(terrain.sampleHeight(16 - 1e-7, z) - border) < 1e-5)
    assert.ok(Math.abs(terrain.sampleHeight(16 + 1e-7, z) - border) < 1e-5)
  }
})

test('neighboring tile edges use identical positions, heights, and normals', () => {
  const terrain = new TerrainSystem(createWorld() as never)
  const resolution = 8
  const west = terrain.createRegionTileData('north-west' as never, resolution)
  const east = terrain.createRegionTileData('north-east' as never, resolution)
  const side = resolution + 1
  assert.equal(west.uvs.length, side * side * 2)
  assert.deepEqual([...west.uvs.slice(0, 2)], [0, 0])
  assert.deepEqual([...west.uvs.slice(-2)], [1, 1])

  for (let row = 0; row < side; row += 1) {
    const westOffset = (row * side + resolution) * 3
    const eastOffset = row * side * 3
    assert.deepEqual(
      [...west.positions.slice(westOffset, westOffset + 3)],
      [...east.positions.slice(eastOffset, eastOffset + 3)],
    )
    assert.deepEqual(
      [...west.normals.slice(westOffset, westOffset + 3)],
      [...east.normals.slice(eastOffset, eastOffset + 3)],
    )
  }

  const geometry = terrain.createRegionGeometry(
    'north-west' as never,
    resolution,
  )
  assert.equal(geometry.getAttribute('position').count, side * side)
  assert.equal(geometry.getAttribute('normal').count, side * side)
  assert.equal(geometry.getAttribute('uv').count, side * side)
  assert.equal(geometry.getIndex()?.count, resolution * resolution * 6)
  geometry.dispose()
})

test('normal and slope queries remain finite and normalized', () => {
  const terrain = new TerrainSystem(createWorld() as never)
  for (const point of [
    { x: 0, z: 0 },
    { x: 16, z: 16 },
    { x: 31.99, z: 31.99 },
  ]) {
    const normal = terrain.sampleNormal(point.x, point.z)
    const slope = terrain.estimateSlope(point.x, point.z)
    assert.ok(Number.isFinite(normal.x))
    assert.ok(Number.isFinite(normal.y))
    assert.ok(Number.isFinite(normal.z))
    assert.ok(Math.abs(Math.hypot(normal.x, normal.y, normal.z) - 1) < 1e-12)
    assert.ok(Number.isFinite(slope))
    assert.ok(slope >= 0 && slope <= Math.PI / 2)
    assert.equal(
      terrain.isWalkableSlope(point.x, point.z, slope + 1e-9),
      true,
    )
  }
})
