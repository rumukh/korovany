import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {
  createGeneratedEncounterPlan,
  createGeneratedEncounterPlans,
} from '../src/game/content/registry.ts'
import type { Faction } from '../src/game/types.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import type {
  RegionId,
  WorldBlueprint,
  WorldRegion,
} from '../src/game/world/worldTypes.ts'

const RUNTIME_OPTIONS = {
  terrainResolution: 6,
  decorationDensity: 0.35,
} as const

function createRuntime(
  seed: string | number,
  decorationDensity = RUNTIME_OPTIONS.decorationDensity,
) {
  const scene = new THREE.Scene()
  const blueprint = generateWorld(seed)
  const runtime = new GeneratedWorldRuntime(
    scene,
    blueprint,
    { ...RUNTIME_OPTIONS, decorationDensity },
  )
  return { scene, blueprint, runtime }
}

function regionAt(
  blueprint: WorldBlueprint,
  x: number,
  y: number,
): WorldRegion {
  const region = blueprint.regions.find(
    (candidate) =>
      candidate.coordinate.x === x && candidate.coordinate.y === y,
  )
  assert.ok(region)
  return region
}

function sceneRegionRoots(scene: THREE.Scene): THREE.Group[] {
  return scene.children.filter(
    (child): child is THREE.Group =>
      child instanceof THREE.Group &&
      child.userData.generatedWorldRegionId !== undefined,
  )
}

function colliderIds(runtime: GeneratedWorldRuntime): string[] {
  return runtime.collision
    .queryBounds(runtime.bounds)
    .map((collider) => collider.id)
    .sort()
}

function cosmeticRenderCount(scene: THREE.Scene): number {
  let count = 0
  scene.traverse((object) => {
    if (
      object instanceof THREE.InstancedMesh &&
      object.name.startsWith('dressing-cosmetic:')
    ) {
      count += object.count
    }
  })
  return count
}

function regionRoot(
  scene: THREE.Scene,
  regionId: RegionId,
): THREE.Group | undefined {
  return sceneRegionRoots(scene).find(
    (root) => root.userData.generatedWorldRegionId === regionId,
  )
}

function materialMap(object: THREE.Object3D | undefined): THREE.Texture | null {
  assert.ok(object instanceof THREE.Mesh)
  const material = Array.isArray(object.material)
    ? object.material[0]
    : object.material
  assert.ok(material instanceof THREE.MeshStandardMaterial)
  return material.map
}

function renderedTerrainHeight(
  terrain: THREE.Mesh,
  x: number,
  z: number,
): number {
  const position = terrain.geometry.getAttribute('position')
  const index = terrain.geometry.getIndex()
  assert.ok(index)
  for (let offset = 0; offset < index.count; offset += 3) {
    const first = index.getX(offset)
    const second = index.getX(offset + 1)
    const third = index.getX(offset + 2)
    const ax = position.getX(first)
    const az = position.getZ(first)
    const bx = position.getX(second)
    const bz = position.getZ(second)
    const cx = position.getX(third)
    const cz = position.getZ(third)
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (Math.abs(denominator) <= Number.EPSILON) continue
    const firstWeight =
      ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator
    const secondWeight =
      ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator
    const thirdWeight = 1 - firstWeight - secondWeight
    if (
      firstWeight < -0.0001 ||
      secondWeight < -0.0001 ||
      thirdWeight < -0.0001
    ) {
      continue
    }
    return (
      position.getY(first) * firstWeight +
      position.getY(second) * secondWeight +
      position.getY(third) * thirdWeight
    )
  }
  assert.fail(`Could not sample rendered terrain at (${x}, ${z})`)
}

function assertSurfaceFollowsRenderedTerrain(
  surface: THREE.Mesh,
  terrain: THREE.Mesh,
  heightOffset: number,
): void {
  assert.equal(surface.geometry.type, 'BufferGeometry')
  const position = surface.geometry.getAttribute('position')
  const index = surface.geometry.getIndex()
  assert.ok(position.count >= 6)
  assert.ok(index)
  assert.ok(index.count > 0)
  const assertPoint = (x: number, y: number, z: number, label: string): void => {
    assert.ok(
      Math.abs(y - renderedTerrainHeight(terrain, x, z) - heightOffset) <
        0.002,
      `${surface.name} ${label} is not projected onto rendered terrain`,
    )
  }
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    assertPoint(
      position.getX(vertex),
      position.getY(vertex),
      position.getZ(vertex),
      `vertex ${vertex}`,
    )
  }
  for (let offset = 0; offset < index.count; offset += 3) {
    const first = index.getX(offset)
    const second = index.getX(offset + 1)
    const third = index.getX(offset + 2)
    assertPoint(
      (position.getX(first) + position.getX(second) + position.getX(third)) /
        3,
      (position.getY(first) + position.getY(second) + position.getY(third)) /
        3,
      (position.getZ(first) + position.getZ(second) + position.getZ(third)) /
        3,
      `triangle ${offset / 3}`,
    )
  }
}

function expectedNeighborhood(
  blueprint: WorldBlueprint,
  focus: WorldRegion,
  radius: number,
  cardinal: boolean,
): RegionId[] {
  return blueprint.regions
    .filter((region) => {
      const dx = Math.abs(region.coordinate.x - focus.coordinate.x)
      const dy = Math.abs(region.coordinate.y - focus.coordinate.y)
      return cardinal ? dx + dy <= radius : Math.max(dx, dy) <= radius
    })
    .map((region) => region.id)
    .sort()
}

test('generated scene regions stream a 3x3 visible and cardinal simulated neighborhood', () => {
  const { scene, blueprint, runtime } = createRuntime('runtime-streaming')
  const centerRegion = regionAt(blueprint, 2, 2)
  const center = runtime.getRegionCenter(centerRegion.id)
  assert.ok(center)

  runtime.update({ deltaSeconds: 1 / 60, focus: center })
  assert.deepEqual(
    [...runtime.regions.getVisibleRegionIds()].sort(),
    expectedNeighborhood(blueprint, centerRegion, 1, false),
  )
  assert.deepEqual(
    [...runtime.regions.getSimulatedRegionIds()].sort(),
    expectedNeighborhood(blueprint, centerRegion, 1, true),
  )
  assert.equal(sceneRegionRoots(scene).length, 9)
  assert.ok(
    sceneRegionRoots(scene).every(
      (root) =>
        root.parent === scene &&
        root.name.startsWith('generated-region:'),
    ),
  )

  const initialRoots = new Map(
    sceneRegionRoots(scene).map((root) => [
      root.userData.generatedWorldRegionId as RegionId,
      root,
    ]),
  )
  const eastRegion = regionAt(blueprint, 3, 2)
  const east = runtime.getRegionCenter(eastRegion.id)
  assert.ok(east)
  runtime.update({ deltaSeconds: 1 / 30, focus: east })

  const nextRoots = new Map(
    sceneRegionRoots(scene).map((root) => [
      root.userData.generatedWorldRegionId as RegionId,
      root,
    ]),
  )
  assert.deepEqual(
    [...nextRoots.keys()].sort(),
    expectedNeighborhood(blueprint, eastRegion, 1, false),
  )
  for (const [regionId, root] of initialRoots) {
    if (nextRoots.has(regionId)) assert.equal(nextRoots.get(regionId), root)
    else assert.equal(root.parent, null)
  }
  assert.equal(runtime.getDebugSnapshot().sceneRegionRootCount, 9)
  runtime.dispose()
})

test('generated world bounds are centered and site positions belong to their regions', () => {
  const { blueprint, runtime } = createRuntime('runtime-positioning')
  assert.deepEqual(runtime.bounds, {
    minX: -200,
    maxX: 200,
    minZ: -200,
    maxZ: 200,
  })
  assert.deepEqual(blueprint.origin, { x: -200, z: -200 })
  assert.equal(blueprint.regionSize, 80)

  for (const faction of ['elf', 'guard', 'villain'] as const) {
    for (const [siteId, position] of [
      [blueprint.starts[faction], runtime.getStartPosition(faction)],
      [blueprint.finales[faction], runtime.getFinalePosition(faction)],
    ] as const) {
      const site = blueprint.sites.find((candidate) => candidate.id === siteId)
      assert.ok(site)
      assert.equal(runtime.getRegionIdAt(position.x, position.z), site.regionId)
      assert.ok(Number.isFinite(position.y))
      assert.equal(position.y, runtime.sampleHeight(position.x, position.z))
      const bounds = runtime.getRegionBounds(site.regionId)
      assert.ok(bounds)
      assert.ok(position.x >= bounds.minX && position.x <= bounds.maxX)
      assert.ok(position.z >= bounds.minZ && position.z <= bounds.maxZ)
    }
  }

  const center = runtime.getRegionCenter(regionAt(blueprint, 2, 2).id)
  assert.ok(center)
  assert.ok(Number.isFinite(center.y))
  runtime.dispose()
})

test('river water blocks ordinary crossings while bridge gaps remain traversable', () => {
  const { blueprint, runtime } = createRuntime('generated-runtime-test')
  const bridgedRegionId = blueprint.bridges[0]?.regionId
  const bridgeRegionIds = new Set(
    blueprint.bridges.map((bridge) => bridge.regionId),
  )
  const blockedRegionId = blueprint.river.regionPath.find(
    (regionId) => !bridgeRegionIds.has(regionId),
  )
  assert.ok(bridgedRegionId)
  assert.ok(blockedRegionId)

  const bridgeCenter = runtime.getRegionCenter(bridgedRegionId)
  assert.ok(bridgeCenter)
  runtime.update({ deltaSeconds: 0, focus: bridgeCenter })
  assert.equal(
    runtime.collision.overlapsCircle(
      bridgeCenter.x,
      bridgeCenter.z,
      0.45,
    ),
    false,
  )
  const bridgeCrossing = runtime.collision.resolveMovement(
    { x: bridgeCenter.x - 9, z: bridgeCenter.z },
    { x: bridgeCenter.x + 9, z: bridgeCenter.z },
    0.45,
  )
  assert.ok(bridgeCrossing.x > bridgeCenter.x + 8)
  assert.equal(
    bridgeCrossing.collisionIds.some((id) => id.startsWith('water:')),
    false,
  )

  const blockedCenter = runtime.getRegionCenter(blockedRegionId)
  assert.ok(blockedCenter)
  runtime.update({ deltaSeconds: 0, focus: blockedCenter })
  assert.equal(
    runtime.collision.overlapsCircle(
      blockedCenter.x,
      blockedCenter.z,
      0.45,
    ),
    true,
  )
  const blockedCrossing = runtime.collision.resolveMovement(
    { x: blockedCenter.x - 9, z: blockedCenter.z },
    { x: blockedCenter.x + 9, z: blockedCenter.z },
    0.45,
  )
  assert.equal(blockedCrossing.blocked, true)
  assert.ok(
    blockedCrossing.collisionIds.some((id) => id.startsWith('water:')),
  )
  runtime.dispose()
})

test('road and river surfaces form continuous terrain-projected ribbons', () => {
  const { scene, blueprint, runtime } = createRuntime(3_427_774_947)
  const northRegionId = blueprint.river.regionPath[2]
  const southRegionId = blueprint.river.regionPath[3]
  assert.ok(northRegionId)
  assert.ok(southRegionId)
  const focus = runtime.getRegionCenter(northRegionId)
  assert.ok(focus)
  runtime.update({ deltaSeconds: 0, focus })

  const northRoot = regionRoot(scene, northRegionId)
  const southRoot = regionRoot(scene, southRegionId)
  assert.ok(northRoot)
  assert.ok(southRoot)
  const northRiver = northRoot.getObjectByName(`river:${northRegionId}`)
  const southRiver = southRoot.getObjectByName(`river:${southRegionId}`)
  assert.ok(northRiver instanceof THREE.Mesh)
  assert.ok(southRiver instanceof THREE.Mesh)
  const roadSurfaces = northRoot.children.filter(
    (child): child is THREE.Mesh =>
      child instanceof THREE.Mesh && child.name.startsWith(`road:${northRegionId}:`),
  )
  assert.ok(roadSurfaces.length > 0)
  const roadHeights = roadSurfaces.flatMap((surface) => {
    const position = surface.geometry.getAttribute('position')
    return Array.from({ length: position.count }, (_, index) =>
      position.getY(index),
    )
  })
  assert.ok(Math.max(...roadHeights) - Math.min(...roadHeights) > 3)

  const northTerrain = northRoot.getObjectByName(`terrain:${northRegionId}`)
  const southTerrain = southRoot.getObjectByName(`terrain:${southRegionId}`)
  assert.ok(northTerrain instanceof THREE.Mesh)
  assert.ok(southTerrain instanceof THREE.Mesh)
  for (const surface of [northRiver, ...roadSurfaces]) {
    assertSurfaceFollowsRenderedTerrain(
      surface,
      northTerrain,
      surface.name.startsWith('river:') ? 0.1 : 0.14,
    )
  }
  assertSurfaceFollowsRenderedTerrain(southRiver, southTerrain, 0.1)

  const northBounds = runtime.getRegionBounds(northRegionId)
  assert.ok(northBounds)
  const boundaryZ = northBounds.maxZ
  const boundaryVertices = (
    mesh: THREE.Mesh,
    axis: 'x' | 'z',
    boundary: number,
  ): Array<[number, number]> => {
    const position = mesh.geometry.getAttribute('position')
    const vertices = new Map<string, [number, number]>()
    for (let index = 0; index < position.count; index += 1) {
      const boundaryCoordinate =
        axis === 'x' ? position.getX(index) : position.getZ(index)
      if (Math.abs(boundaryCoordinate - boundary) >= 0.001) continue
      const vertex: [number, number] = [
        Number(
          (axis === 'x'
            ? position.getZ(index)
            : position.getX(index)
          ).toFixed(4),
        ),
        Number(position.getY(index).toFixed(4)),
      ]
      vertices.set(vertex.join(':'), vertex)
    }
    return [...vertices.values()].sort((first, second) => first[0] - second[0])
  }
  assert.deepEqual(
    boundaryVertices(northRiver, 'z', boundaryZ),
    boundaryVertices(southRiver, 'z', boundaryZ),
  )

  const region = blueprint.regions.find(
    (candidate) => candidate.id === northRegionId,
  )
  assert.ok(region)
  const direction = roadSurfaces[0].name.split(':').at(-1)
  assert.ok(direction)
  const offsets: Record<string, [number, number]> = {
    north: [0, -1],
    south: [0, 1],
    east: [1, 0],
    west: [-1, 0],
  }
  const opposites: Record<string, string> = {
    north: 'south',
    south: 'north',
    east: 'west',
    west: 'east',
  }
  const offset = offsets[direction]
  assert.ok(offset)
  const adjacentRegion = regionAt(
    blueprint,
    region.coordinate.x + offset[0],
    region.coordinate.y + offset[1],
  )
  const adjacentRoot = regionRoot(scene, adjacentRegion.id)
  assert.ok(adjacentRoot)
  const adjacentRoad = adjacentRoot.getObjectByName(
    `road:${adjacentRegion.id}:${opposites[direction]}`,
  )
  assert.ok(adjacentRoad instanceof THREE.Mesh)
  const roadAxis = direction === 'east' || direction === 'west' ? 'x' : 'z'
  const roadBoundary =
    direction === 'east'
      ? northBounds.maxX
      : direction === 'west'
        ? northBounds.minX
        : direction === 'north'
          ? northBounds.minZ
          : northBounds.maxZ
  assert.deepEqual(
    boundaryVertices(roadSurfaces[0], roadAxis, roadBoundary),
    boundaryVertices(adjacentRoad, roadAxis, roadBoundary),
  )
  runtime.dispose()
})

test('map markers reveal discovered sites and current region without global spoilers', () => {
  const { blueprint, runtime } = createRuntime('runtime-discovery')
  assert.deepEqual(runtime.getMarkers(), [])

  const centerRegion = regionAt(blueprint, 2, 2)
  const center = runtime.getRegionCenter(centerRegion.id)
  assert.ok(center)
  runtime.update({ deltaSeconds: 0, focus: center })
  const firstMarkers = runtime.getMarkers()
  const discovered = new Set(runtime.discoveredRegionIds)
  assert.ok(
    firstMarkers.some(
      (marker) =>
        marker.kind === 'current-region' &&
        marker.regionId === centerRegion.id,
    ),
  )
  assert.ok(
    firstMarkers
      .filter((marker) => marker.kind !== 'current-region')
      .every(
        (marker) =>
          marker.regionId !== undefined && discovered.has(marker.regionId),
      ),
  )

  const elfStartId = blueprint.starts.elf
  const elfStartSite = blueprint.sites.find((site) => site.id === elfStartId)
  assert.ok(elfStartSite)
  assert.equal(discovered.has(elfStartSite.regionId), false)
  assert.equal(
    firstMarkers.some((marker) => marker.id === `site:${elfStartId}`),
    false,
  )

  const elfStart = runtime.getStartPosition('elf')
  runtime.update({ deltaSeconds: 0, focus: elfStart })
  assert.ok(
    runtime
      .getMarkers()
      .some((marker) => marker.id === `site:${elfStartId}`),
  )
  runtime.dispose()
})

test('streamed regions retain textured surfaces, composite trees, and ground cover', () => {
  const { scene, blueprint, runtime } = createRuntime(
    'runtime-surface-detail',
    1,
  )
  const forestRegion = blueprint.regions.find(
    (region) => region.biome === 'forest',
  )
  assert.ok(forestRegion)
  const forestCenter = runtime.getRegionCenter(forestRegion.id)
  assert.ok(forestCenter)
  runtime.update({ deltaSeconds: 0, focus: forestCenter })

  const forestRoot = regionRoot(scene, forestRegion.id)
  assert.ok(forestRoot)
  const terrain = forestRoot.getObjectByName(`terrain:${forestRegion.id}`)
  assert.ok(terrain instanceof THREE.Mesh)
  assert.ok(terrain.geometry.getAttribute('uv'))
  const terrainTexture = materialMap(terrain)
  assert.ok(terrainTexture instanceof THREE.DataTexture)
  assert.equal(terrainTexture.wrapS, THREE.RepeatWrapping)
  assert.equal(terrainTexture.wrapT, THREE.RepeatWrapping)
  const textureBytes = terrainTexture.image.data as Uint8Array
  assert.ok(new Set(textureBytes).size > 8)

  const trees = forestRoot.getObjectByName(
    `dressing-structural:${forestRegion.id}`,
  )
  assert.ok(trees instanceof THREE.InstancedMesh)
  assert.ok(Array.isArray(trees.material))
  assert.equal(trees.material.length, 4)
  assert.ok(
    trees.material.every(
      (material) =>
        material instanceof THREE.MeshStandardMaterial &&
        material.map instanceof THREE.DataTexture,
    ),
  )

  const grass = forestRoot.getObjectByName(
    `dressing-cosmetic:ground-grass:${forestRegion.id}`,
  )
  const ferns = forestRoot.getObjectByName(
    `dressing-cosmetic:ground-fern:${forestRegion.id}`,
  )
  assert.ok(grass instanceof THREE.InstancedMesh)
  assert.ok(ferns instanceof THREE.InstancedMesh)
  assert.ok(grass.count > 0)
  assert.ok(ferns.count > 0)

  const stronghold = blueprint.sites.find(
    (site) => site.kind === 'final-stronghold',
  )
  assert.ok(stronghold)
  const strongholdCenter = runtime.getRegionCenter(stronghold.regionId)
  assert.ok(strongholdCenter)
  runtime.update({ deltaSeconds: 0, focus: strongholdCenter })
  const strongholdRoot = regionRoot(scene, stronghold.regionId)
  assert.ok(strongholdRoot)
  const bodyTexture = materialMap(
    strongholdRoot.getObjectByName(`site-body:${stronghold.id}`),
  )
  const roofTexture = materialMap(
    strongholdRoot.getObjectByName(`site-roof:${stronghold.id}`),
  )
  assert.ok(bodyTexture instanceof THREE.DataTexture)
  assert.ok(roofTexture instanceof THREE.DataTexture)
  assert.notEqual(bodyTexture, roofTexture)

  let terrainTextureDisposed = false
  terrainTexture.addEventListener('dispose', () => {
    terrainTextureDisposed = true
  })
  runtime.dispose()
  assert.equal(terrainTextureDisposed, true)
})

test('encounter plans are deterministic, serializable, and respect actor budgets', () => {
  const blueprint = generateWorld('runtime-encounters')
  const completePlans = createGeneratedEncounterPlans(blueprint, 'elf')
  assert.deepEqual(Object.keys(completePlans).sort(), [
    ...blueprint.encounters.map((slot) => slot.id).sort(),
  ])

  for (const slot of blueprint.encounters) {
    const playerFaction = slot.hostileTo[0] as Faction
    const first = createGeneratedEncounterPlan(
      blueprint,
      slot,
      playerFaction,
    )
    const second = createGeneratedEncounterPlan(
      blueprint,
      slot,
      playerFaction,
    )
    assert.deepEqual(first, second)
    assert.deepEqual(JSON.parse(JSON.stringify(first)), first)
    assert.notEqual(first.hostileFaction, playerFaction)
    assert.ok(
      first.spawns.every(
        (spawn) =>
          spawn.id.startsWith(`${slot.id}:actor:`) &&
          spawn.encounterId === slot.id &&
          Number.isFinite(spawn.localX) &&
          Number.isFinite(spawn.localZ) &&
          Number.isFinite(spawn.worldX) &&
          Number.isFinite(spawn.worldZ),
      ),
    )

    if (slot.kind === 'boss') {
      assert.equal(first.bossCount, 1)
      assert.equal(first.ordinaryCount, 2)
      assert.equal(first.spawns.length, 3)
      const bosses = first.spawns.filter((spawn) => spawn.unique)
      assert.equal(bosses.length, 1)
      assert.equal(bosses[0].objective, true)
      assert.ok(
        bosses[0].role === 'commander' || bosses[0].role === 'champion',
      )
    } else {
      assert.equal(first.bossCount, 0)
      assert.ok(first.spawns.length >= 2 && first.spawns.length <= 4)
      assert.equal(first.ordinaryCount, first.spawns.length)
      assert.equal(first.spawns.some((spawn) => spawn.unique), false)
    }

    for (const faction of ['elf', 'guard', 'villain'] as const) {
      const plan = createGeneratedEncounterPlan(blueprint, slot, faction)
      const hostileToPlayer = slot.hostileTo.includes(faction)
      assert.equal(plan.hostileToPlayer, hostileToPlayer)
      if (hostileToPlayer) {
        assert.notEqual(plan.hostileFaction, faction)
      } else {
        assert.equal(plan.hostileFaction, faction)
        assert.ok(plan.spawns.every((spawn) => spawn.faction === faction))
      }
    }
  }
})

test('decoration quality changes only deterministic nonblocking cosmetics', () => {
  const densities = [0, 0.55, 1] as const
  const snapshots = densities.map((density) => {
    const { scene, blueprint, runtime } = createRuntime(
      'runtime-decoration-quality',
      density,
    )
    const center = runtime.getRegionCenter(regionAt(blueprint, 2, 2).id)
    assert.ok(center)
    runtime.update({ deltaSeconds: 0, focus: center })
    const debug = runtime.getDebugSnapshot()
    const snapshot = {
      runtime,
      ids: colliderIds(runtime),
      colliderCount: debug.collision.colliderCount,
      structuralCount: debug.decorations.structuralInstanceCount,
      cosmeticCount: debug.decorations.cosmeticInstanceCount,
      maximumCosmeticCount: debug.decorations.maxCosmeticInstanceCount,
      renderCount: cosmeticRenderCount(scene),
    }
    assert.equal(snapshot.cosmeticCount, snapshot.renderCount)
    return snapshot
  })

  assert.deepEqual(snapshots[0].ids, snapshots[1].ids)
  assert.deepEqual(snapshots[0].ids, snapshots[2].ids)
  assert.equal(snapshots[0].colliderCount, snapshots[1].colliderCount)
  assert.equal(snapshots[0].colliderCount, snapshots[2].colliderCount)
  assert.equal(snapshots[0].structuralCount, snapshots[1].structuralCount)
  assert.equal(snapshots[0].structuralCount, snapshots[2].structuralCount)
  assert.equal(
    snapshots[0].maximumCosmeticCount,
    snapshots[1].maximumCosmeticCount,
  )
  assert.equal(
    snapshots[0].maximumCosmeticCount,
    snapshots[2].maximumCosmeticCount,
  )
  assert.equal(snapshots[0].cosmeticCount, 0)
  assert.ok(snapshots[1].cosmeticCount > snapshots[0].cosmeticCount)
  assert.ok(snapshots[2].cosmeticCount > snapshots[1].cosmeticCount)

  for (const snapshot of snapshots) snapshot.runtime.dispose()
})

test('live decoration density updates render counts without rebuilding collision', () => {
  const { scene, blueprint, runtime } = createRuntime(
    'runtime-live-decoration-quality',
    1,
  )
  const center = runtime.getRegionCenter(regionAt(blueprint, 2, 2).id)
  assert.ok(center)
  runtime.update({ deltaSeconds: 0, focus: center })
  const initialColliderIds = colliderIds(runtime)
  const initial = runtime.getDebugSnapshot().decorations
  assert.equal(initial.cosmeticInstanceCount, cosmeticRenderCount(scene))
  assert.equal(initial.cosmeticInstanceCount, initial.maxCosmeticInstanceCount)

  runtime.setDecorationDensity(0)
  const off = runtime.getDebugSnapshot().decorations
  assert.equal(off.density, 0)
  assert.equal(off.cosmeticInstanceCount, 0)
  assert.equal(cosmeticRenderCount(scene), 0)
  assert.deepEqual(colliderIds(runtime), initialColliderIds)

  runtime.setDecorationDensity(0.55)
  const low = runtime.getDebugSnapshot().decorations
  assert.ok(low.cosmeticInstanceCount > 0)
  assert.ok(low.cosmeticInstanceCount < low.maxCosmeticInstanceCount)
  assert.equal(low.cosmeticInstanceCount, cosmeticRenderCount(scene))
  assert.deepEqual(colliderIds(runtime), initialColliderIds)

  runtime.setDecorationDensity(1)
  const high = runtime.getDebugSnapshot().decorations
  assert.equal(high.cosmeticInstanceCount, high.maxCosmeticInstanceCount)
  assert.equal(high.cosmeticInstanceCount, cosmeticRenderCount(scene))
  assert.deepEqual(colliderIds(runtime), initialColliderIds)

  runtime.setDecorationDensity(0)
  const corner = runtime.getRegionCenter(regionAt(blueprint, 0, 0).id)
  assert.ok(corner)
  runtime.update({ deltaSeconds: 0, focus: corner })
  assert.equal(runtime.getDebugSnapshot().decorations.cosmeticInstanceCount, 0)
  assert.equal(cosmeticRenderCount(scene), 0)
  runtime.dispose()
})

test('dispose removes region roots and colliders exactly once', () => {
  const { scene, blueprint, runtime } = createRuntime('runtime-dispose')
  const center = runtime.getRegionCenter(regionAt(blueprint, 2, 2).id)
  assert.ok(center)
  runtime.update({ deltaSeconds: 0, focus: center })
  assert.equal(sceneRegionRoots(scene).length, 9)
  assert.ok(runtime.collision.size > 0)

  runtime.dispose()
  const disposed = runtime.getDebugSnapshot()
  assert.equal(sceneRegionRoots(scene).length, 0)
  assert.equal(disposed.sceneRegionRootCount, 0)
  assert.equal(disposed.collision.colliderCount, 0)
  assert.equal(disposed.regionRoots.length, 0)
  assert.equal(disposed.materials.disposed, disposed.materials.owned)

  assert.doesNotThrow(() => runtime.dispose())
  assert.deepEqual(runtime.getDebugSnapshot().materials, disposed.materials)
})
