import type { RegionId, WorldBlueprint } from '../world/worldTypes.ts'
import {
  compareRegions,
  containsPoint,
  normalizeWorldBlueprint,
  type Bounds2D,
  type NormalizedRegion,
  type Point2,
  type Point3,
  type WorldLayout,
} from '../world/TerrainSystem.ts'
import type {
  CollisionQueryOptions,
  CollisionWorld,
} from './CollisionWorld.ts'

export type CardinalDirection = 'north' | 'east' | 'south' | 'west'

export interface NavigationTerrain {
  readonly layout?: WorldLayout
  sampleHeight(x: number, z: number): number
  estimateSlope(x: number, z: number, distance?: number): number
  getRevision?(): number
}

export interface NavigationCollision {
  isWalkablePosition(
    x: number,
    z: number,
    radius?: number,
    options?: CollisionQueryOptions & {
      maxSlope?: number
      slopeSampleDistance?: number
      requireActiveBounds?: boolean
    },
  ): boolean
  getRevision(regionId?: RegionId): number
}

export interface NavigationSystemOptions {
  cellSize?: number
  maxSlope?: number
  agentRadius?: number
  slopeSampleDistance?: number
  maxVisitedNodes?: number
}

export interface NavigationWaypoint extends Point3 {
  regionId: RegionId
}

export interface NavigationPathOptions {
  maxVisitedNodes?: number
  excludeColliderIds?: Iterable<string>
}

export interface NavigationGrid {
  regionId: RegionId
  bounds: Bounds2D
  columns: number
  rows: number
  cellWidth: number
  cellDepth: number
  walkable: Uint8Array
  heights: Float32Array
  terrainRevision: number
  colliderRevision: number
  revision: number
}

export interface NavigationPortal {
  min: number
  max: number
}

export interface NavigationConnection {
  from: RegionId
  to: RegionId
  direction: CardinalDirection
  portal?: NavigationPortal
}

export interface NavigationDebugStats {
  cachedGridCount: number
  gridBuildCount: number
  activeRegionCount: number
  revision: number
}

interface SearchNode {
  key: string
  regionId: RegionId
  index: number
  g: number
  h: number
  f: number
  sequence: number
}

interface GridCell {
  regionId: RegionId
  index: number
  x: number
  y: number
  z: number
}

type UnknownRecord = Record<string, unknown>

const DEFAULT_CELL_SIZE = 2
const DEFAULT_MAX_SLOPE = Math.PI * (42 / 180)
const DEFAULT_AGENT_RADIUS = 0.35
const DEFAULT_MAX_VISITED_NODES = 40_000
const DEFAULT_SLOPE_SAMPLE_DISTANCE = 0.5

export class NavigationSystem {
  readonly blueprint: WorldBlueprint
  readonly layout: WorldLayout

  private readonly terrain: NavigationTerrain
  private readonly collision: NavigationCollision
  private readonly cellSize: number
  private readonly maxSlope: number
  private readonly agentRadius: number
  private readonly slopeSampleDistance: number
  private readonly maxVisitedNodes: number
  private readonly grids = new Map<RegionId, NavigationGrid>()
  private readonly connections = new Map<RegionId, NavigationConnection[]>()
  private activeRegions = new Set<RegionId>()
  private revision = 1
  private gridBuildCount = 0

  constructor(
    blueprint: WorldBlueprint,
    terrain: NavigationTerrain,
    collision: NavigationCollision | CollisionWorld,
    options: NavigationSystemOptions = {},
  ) {
    this.blueprint = blueprint
    this.layout = terrain.layout ?? normalizeWorldBlueprint(blueprint)
    this.terrain = terrain
    this.collision = collision
    this.cellSize = positiveOr(options.cellSize, DEFAULT_CELL_SIZE)
    this.maxSlope = finiteOr(options.maxSlope, DEFAULT_MAX_SLOPE)
    this.agentRadius = Math.max(
      0,
      finiteOr(options.agentRadius, DEFAULT_AGENT_RADIUS),
    )
    this.slopeSampleDistance = positiveOr(
      options.slopeSampleDistance,
      DEFAULT_SLOPE_SAMPLE_DISTANCE,
    )
    this.maxVisitedNodes = Math.max(
      1,
      Math.floor(
        positiveOr(options.maxVisitedNodes, DEFAULT_MAX_VISITED_NODES),
      ),
    )
    for (const region of this.layout.regions) {
      this.activeRegions.add(region.id)
      this.connections.set(region.id, [])
    }
    for (const connection of readConnections(this.layout)) {
      this.addConnection(connection, false)
    }
  }

  setActiveRegions(regionIds: Iterable<RegionId>): void {
    const next = new Set<RegionId>()
    for (const regionId of regionIds) {
      const region = this.resolveRegion(regionId)
      if (region) next.add(region.id)
    }
    if (setsEqual(this.activeRegions, next)) return
    this.activeRegions = next
    this.revision += 1
  }

  getActiveRegions(): RegionId[] {
    return [...this.activeRegions].sort((first, second) =>
      compareRegions(
        this.resolveRegion(first) as NormalizedRegion,
        this.resolveRegion(second) as NormalizedRegion,
      ),
    )
  }

  isRegionActive(regionId: RegionId): boolean {
    const region = this.resolveRegion(regionId)
    return region ? this.activeRegions.has(region.id) : false
  }

  getGrid(regionId: RegionId): NavigationGrid | undefined {
    const region = this.resolveRegion(regionId)
    if (!region) return undefined
    const terrainRevision = this.terrain.getRevision?.() ?? 0
    const colliderRevision = this.collision.getRevision(region.id)
    const cached = this.grids.get(region.id)
    if (
      cached &&
      cached.terrainRevision === terrainRevision &&
      cached.colliderRevision === colliderRevision
    ) {
      return cached
    }

    const grid = this.buildGrid(region, terrainRevision, colliderRevision)
    this.grids.set(region.id, grid)
    return grid
  }

  getRegionGrid(regionId: RegionId): NavigationGrid | undefined {
    return this.getGrid(regionId)
  }

  invalidateRegion(regionId: RegionId): void {
    const region = this.resolveRegion(regionId)
    if (!region || !this.grids.delete(region.id)) return
    this.revision += 1
  }

  invalidateAll(): void {
    if (this.grids.size === 0) return
    this.grids.clear()
    this.revision += 1
  }

  addConnection(
    connection: NavigationConnection,
    reciprocal = true,
  ): void {
    const from = this.resolveRegion(connection.from)
    const to = this.resolveRegion(connection.to)
    if (!from || !to || from.id === to.id) return
    const direction =
      connection.direction ?? inferDirection(from.coordinate, to.coordinate)
    if (!direction) return
    this.storeConnection({
      from: from.id,
      to: to.id,
      direction,
      ...(connection.portal ? { portal: normalizePortal(connection.portal) } : {}),
    })
    if (reciprocal) {
      this.storeConnection({
        from: to.id,
        to: from.id,
        direction: oppositeDirection(direction),
        ...(connection.portal ? { portal: normalizePortal(connection.portal) } : {}),
      })
    }
    this.revision += 1
  }

  removeConnection(fromId: RegionId, toId: RegionId): void {
    const from = this.resolveRegion(fromId)
    const to = this.resolveRegion(toId)
    if (!from || !to) return
    const previous = this.connections.get(from.id) ?? []
    const next = previous.filter(
      (connection) => String(connection.to) !== String(to.id),
    )
    if (next.length === previous.length) return
    this.connections.set(from.id, next)
    this.revision += 1
  }

  getConnections(regionId: RegionId): readonly NavigationConnection[] {
    const region = this.resolveRegion(regionId)
    if (!region) return []
    return (this.connections.get(region.id) ?? []).map((connection) => ({
      ...connection,
      ...(connection.portal ? { portal: { ...connection.portal } } : {}),
    }))
  }

  findPath(
    start: Point2,
    destination: Point2,
    options: NavigationPathOptions = {},
  ): NavigationWaypoint[] | null {
    if (
      !Number.isFinite(start.x) ||
      !Number.isFinite(start.z) ||
      !Number.isFinite(destination.x) ||
      !Number.isFinite(destination.z)
    ) {
      return null
    }
    const startRegion = this.regionAt(start.x, start.z)
    const destinationRegion = this.regionAt(destination.x, destination.z)
    if (
      !startRegion ||
      !destinationRegion ||
      !this.activeRegions.has(startRegion.id) ||
      !this.activeRegions.has(destinationRegion.id) ||
      !this.areRegionsConnected(startRegion.id, destinationRegion.id)
    ) {
      return null
    }

    const collisionOptions = {
      excludeIds: options.excludeColliderIds,
      maxSlope: this.maxSlope,
      slopeSampleDistance: this.slopeSampleDistance,
      requireActiveBounds: false,
    }
    if (
      !this.collision.isWalkablePosition(
        destination.x,
        destination.z,
        this.agentRadius,
        collisionOptions,
      )
    ) {
      return null
    }
    if (
      !this.collision.isWalkablePosition(
        start.x,
        start.z,
        this.agentRadius,
        collisionOptions,
      )
    ) {
      return null
    }

    const startGrid = this.getGrid(startRegion.id)
    const destinationGrid = this.getGrid(destinationRegion.id)
    if (!startGrid || !destinationGrid) return null
    const startIndex = worldToCellIndex(startGrid, start.x, start.z)
    const destinationIndex = worldToCellIndex(
      destinationGrid,
      destination.x,
      destination.z,
    )
    if (
      !isGridCellWalkable(startGrid, startIndex) ||
      !isGridCellWalkable(destinationGrid, destinationIndex)
    ) {
      return null
    }

    const startKey = nodeKey(startRegion.id, startIndex)
    const destinationKey = nodeKey(destinationRegion.id, destinationIndex)
    const queue = new MinHeap<SearchNode>(compareSearchNodes)
    const costs = new Map<string, number>([[startKey, 0]])
    const parents = new Map<string, string>()
    const cells = new Map<string, GridCell>()
    const closed = new Set<string>()
    const startCell = gridCell(startGrid, startIndex)
    cells.set(startKey, startCell)
    let sequence = 0
    const initialHeuristic = pathHeuristic(startCell, destination)
    queue.push({
      key: startKey,
      regionId: startRegion.id,
      index: startIndex,
      g: 0,
      h: initialHeuristic,
      f: initialHeuristic,
      sequence,
    })

    const maxVisited = Math.max(
      1,
      Math.floor(
        positiveOr(options.maxVisitedNodes, this.maxVisitedNodes),
      ),
    )
    let visited = 0
    while (queue.size > 0 && visited < maxVisited) {
      const current = queue.pop()
      if (!current) break
      const knownCost = costs.get(current.key)
      if (
        knownCost === undefined ||
        Math.abs(knownCost - current.g) > 1e-9 ||
        closed.has(current.key)
      ) {
        continue
      }
      if (current.key === destinationKey) {
        return this.buildWaypoints(
          start,
          destination,
          destinationKey,
          parents,
          cells,
        )
      }

      closed.add(current.key)
      visited += 1
      for (const neighbor of this.getNeighbors(current.regionId, current.index)) {
        const key = nodeKey(neighbor.regionId, neighbor.index)
        if (closed.has(key)) continue
        const currentCell =
          cells.get(current.key) ??
          gridCell(this.getGrid(current.regionId) as NavigationGrid, current.index)
        const movementCost =
          Math.hypot(neighbor.x - currentCell.x, neighbor.z - currentCell.z) +
          Math.abs(neighbor.y - currentCell.y) * 0.15
        const nextCost = current.g + movementCost
        if (nextCost >= (costs.get(key) ?? Number.POSITIVE_INFINITY) - 1e-9) {
          continue
        }
        costs.set(key, nextCost)
        parents.set(key, current.key)
        cells.set(key, neighbor)
        const heuristic = pathHeuristic(neighbor, destination)
        sequence += 1
        queue.push({
          key,
          regionId: neighbor.regionId,
          index: neighbor.index,
          g: nextCost,
          h: heuristic,
          f: nextCost + heuristic,
          sequence,
        })
      }
    }
    return null
  }

  requestPath(
    start: Point2,
    destination: Point2,
    options: NavigationPathOptions = {},
  ): NavigationWaypoint[] | null {
    return this.findPath(start, destination, options)
  }

  getDebugStats(): NavigationDebugStats {
    return {
      cachedGridCount: this.grids.size,
      gridBuildCount: this.gridBuildCount,
      activeRegionCount: this.activeRegions.size,
      revision: this.revision,
    }
  }

  dispose(): void {
    this.grids.clear()
    this.activeRegions.clear()
    this.connections.clear()
    this.revision += 1
  }

  private buildGrid(
    region: NormalizedRegion,
    terrainRevision: number,
    colliderRevision: number,
  ): NavigationGrid {
    const width = region.bounds.maxX - region.bounds.minX
    const depth = region.bounds.maxZ - region.bounds.minZ
    const columns = Math.max(1, Math.ceil(width / this.cellSize))
    const rows = Math.max(1, Math.ceil(depth / this.cellSize))
    const cellWidth = width / columns
    const cellDepth = depth / rows
    const walkable = new Uint8Array(columns * rows)
    const heights = new Float32Array(columns * rows)
    const collisionOptions = {
      maxSlope: this.maxSlope,
      slopeSampleDistance: this.slopeSampleDistance,
      requireActiveBounds: false,
    }

    for (let row = 0; row < rows; row += 1) {
      const z = region.bounds.minZ + (row + 0.5) * cellDepth
      for (let column = 0; column < columns; column += 1) {
        const x = region.bounds.minX + (column + 0.5) * cellWidth
        const index = row * columns + column
        heights[index] = this.terrain.sampleHeight(x, z)
        walkable[index] = this.collision.isWalkablePosition(
          x,
          z,
          this.agentRadius,
          collisionOptions,
        )
          ? 1
          : 0
      }
    }

    this.gridBuildCount += 1
    this.revision += 1
    return {
      regionId: region.id,
      bounds: { ...region.bounds },
      columns,
      rows,
      cellWidth,
      cellDepth,
      walkable,
      heights,
      terrainRevision,
      colliderRevision,
      revision: this.revision,
    }
  }

  private getNeighbors(regionId: RegionId, index: number): GridCell[] {
    const grid = this.getGrid(regionId)
    if (!grid) return []
    const column = index % grid.columns
    const row = Math.floor(index / grid.columns)
    const candidates = [
      { column, row: row - 1, direction: 'north' as const },
      { column: column + 1, row, direction: 'east' as const },
      { column, row: row + 1, direction: 'south' as const },
      { column: column - 1, row, direction: 'west' as const },
    ]
    const neighbors: GridCell[] = []
    for (const candidate of candidates) {
      if (
        candidate.column >= 0 &&
        candidate.column < grid.columns &&
        candidate.row >= 0 &&
        candidate.row < grid.rows
      ) {
        const candidateIndex =
          candidate.row * grid.columns + candidate.column
        if (isGridCellWalkable(grid, candidateIndex)) {
          neighbors.push(gridCell(grid, candidateIndex))
        }
        continue
      }
      for (const connection of this.connections.get(regionId) ?? []) {
        if (
          connection.direction !== candidate.direction ||
          !this.activeRegions.has(connection.to)
        ) {
          continue
        }
        const currentCell = gridCell(grid, index)
        const portalCoordinate =
          candidate.direction === 'east' || candidate.direction === 'west'
            ? currentCell.z
            : currentCell.x
        if (
          connection.portal &&
          (portalCoordinate < connection.portal.min ||
            portalCoordinate > connection.portal.max)
        ) {
          continue
        }
        const targetGrid = this.getGrid(connection.to)
        if (!targetGrid) continue
        const targetPosition = crossingTarget(
          targetGrid,
          candidate.direction,
          currentCell,
        )
        const targetIndex = worldToCellIndex(
          targetGrid,
          targetPosition.x,
          targetPosition.z,
        )
        if (isGridCellWalkable(targetGrid, targetIndex)) {
          neighbors.push(gridCell(targetGrid, targetIndex))
        }
      }
    }
    neighbors.sort((first, second) => {
      const firstRegion = this.resolveRegion(first.regionId)
      const secondRegion = this.resolveRegion(second.regionId)
      return (
        (firstRegion && secondRegion
          ? compareRegions(firstRegion, secondRegion)
          : String(first.regionId).localeCompare(String(second.regionId))) ||
        first.index - second.index
      )
    })
    return neighbors
  }

  private areRegionsConnected(from: RegionId, to: RegionId): boolean {
    if (String(from) === String(to)) return true
    const queue = [from]
    const visited = new Set<string>([String(from)])
    while (queue.length > 0) {
      const current = queue.shift() as RegionId
      for (const connection of this.connections.get(current) ?? []) {
        if (!this.activeRegions.has(connection.to)) continue
        if (String(connection.to) === String(to)) return true
        if (visited.has(String(connection.to))) continue
        visited.add(String(connection.to))
        queue.push(connection.to)
      }
    }
    return false
  }

  private buildWaypoints(
    start: Point2,
    destination: Point2,
    destinationKey: string,
    parents: ReadonlyMap<string, string>,
    cells: ReadonlyMap<string, GridCell>,
  ): NavigationWaypoint[] {
    const path: GridCell[] = []
    let key: string | undefined = destinationKey
    while (key) {
      const cell = cells.get(key)
      if (cell) path.push(cell)
      key = parents.get(key)
    }
    path.reverse()
    const firstRegion = path[0]?.regionId ?? this.regionAt(start.x, start.z)?.id
    const lastRegion =
      path[path.length - 1]?.regionId ??
      this.regionAt(destination.x, destination.z)?.id
    if (firstRegion === undefined || lastRegion === undefined) return []

    const waypoints: NavigationWaypoint[] = [
      {
        x: start.x,
        y: this.terrain.sampleHeight(start.x, start.z),
        z: start.z,
        regionId: firstRegion,
      },
      ...path.map((cell) => ({
        x: cell.x,
        y: cell.y,
        z: cell.z,
        regionId: cell.regionId,
      })),
      {
        x: destination.x,
        y: this.terrain.sampleHeight(destination.x, destination.z),
        z: destination.z,
        regionId: lastRegion,
      },
    ]
    return simplifyWaypoints(dedupeWaypoints(waypoints))
  }

  private storeConnection(connection: NavigationConnection): void {
    const list = this.connections.get(connection.from) ?? []
    const duplicateIndex = list.findIndex(
      (entry) =>
        String(entry.to) === String(connection.to) &&
        entry.direction === connection.direction,
    )
    if (duplicateIndex >= 0) {
      list[duplicateIndex] = connection
    } else {
      list.push(connection)
    }
    list.sort((first, second) => {
      const directionOrder =
        cardinalIndex(first.direction) - cardinalIndex(second.direction)
      return directionOrder || String(first.to).localeCompare(String(second.to))
    })
    this.connections.set(connection.from, list)
  }

  private resolveRegion(regionId: RegionId): NormalizedRegion | undefined {
    const direct = this.layout.regionById.get(regionId)
    if (direct) return direct
    const id = String(regionId)
    return this.layout.regions.find((region) => String(region.id) === id)
  }

  private regionAt(x: number, z: number): NormalizedRegion | undefined {
    if (!containsPoint(this.layout.bounds, x, z)) return undefined
    return this.layout.regions.find((region) =>
      containsPoint(region.bounds, x, z),
    )
  }
}

function readConnections(layout: WorldLayout): NavigationConnection[] {
  const connections: NavigationConnection[] = []
  const world = asRecord(layout.blueprint) ?? {}
  let hasExplicitConnections =
    Object.hasOwn(world, 'connections') ||
    Object.hasOwn(world, 'regionConnections') ||
    Object.hasOwn(world, 'portals')
  const worldConnections =
    world.connections ?? world.regionConnections ?? world.portals
  if (Array.isArray(worldConnections)) {
    for (const value of worldConnections) {
      const parsed = parseConnection(value, undefined, layout)
      if (parsed) connections.push(...parsed)
    }
  }

  for (const region of layout.regions) {
    const record = asRecord(region.blueprint) ?? {}
    const candidates = [
      record.connections,
      record.neighbors,
      record.portals,
      record.edges,
    ]
    if (
      Object.hasOwn(record, 'connections') ||
      Object.hasOwn(record, 'neighbors') ||
      Object.hasOwn(record, 'portals') ||
      Object.hasOwn(record, 'edges')
    ) {
      hasExplicitConnections = true
    }
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        for (const value of candidate) {
          const parsed = parseConnection(value, region, layout)
          if (parsed) connections.push(...parsed)
        }
      } else {
        const directional = asRecord(candidate)
        if (!directional) continue
        for (const direction of cardinalDirections()) {
          const value = directional[direction]
          if (value === undefined) continue
          const parsed = parseConnection(
            typeof value === 'object' && value !== null
              ? { ...(asRecord(value) ?? {}), direction }
              : { to: value, direction },
            region,
            layout,
          )
          if (parsed) connections.push(...parsed)
        }
      }
    }
  }

  if (!hasExplicitConnections) {
    for (const region of layout.regions) {
      for (const direction of ['east', 'south'] as const) {
        const offset = directionOffset(direction)
        const neighbor = layout.regionByCoordinate.get(
          coordinateKey(
            region.coordinate.x + offset.x,
            region.coordinate.z + offset.z,
          ),
        )
        if (!neighbor) continue
        connections.push(
          { from: region.id, to: neighbor.id, direction },
          {
            from: neighbor.id,
            to: region.id,
            direction: oppositeDirection(direction),
          },
        )
      }
    }
  }

  const expanded: NavigationConnection[] = []
  for (const connection of connections) {
    expanded.push(connection)
    const reverseExists = connections.some(
      (candidate) =>
        String(candidate.from) === String(connection.to) &&
        String(candidate.to) === String(connection.from),
    )
    if (!reverseExists) {
      expanded.push({
        from: connection.to,
        to: connection.from,
        direction: oppositeDirection(connection.direction),
        ...(connection.portal ? { portal: { ...connection.portal } } : {}),
      })
    }
  }

  const unique = new Map<string, NavigationConnection>()
  for (const connection of expanded) {
    unique.set(
      `${String(connection.from)}>${String(connection.to)}:${connection.direction}`,
      connection,
    )
  }
  return [...unique.values()]
}

function parseConnection(
  value: unknown,
  sourceRegion: NormalizedRegion | undefined,
  layout: WorldLayout,
): NavigationConnection[] | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    if (!sourceRegion) return undefined
    const target = findRegion(layout, value)
    if (!target) return undefined
    const direction = inferDirection(sourceRegion.coordinate, target.coordinate)
    return direction
      ? [{ from: sourceRegion.id, to: target.id, direction }]
      : undefined
  }
  const record = asRecord(value)
  if (!record) return undefined
  const source =
    sourceRegion ??
    findRegion(
      layout,
      record.from ??
        record.fromRegionId ??
        record.source ??
        record.sourceRegionId,
    )
  const target = findRegion(
    layout,
    record.to ??
      record.toRegionId ??
      record.target ??
      record.targetRegionId ??
      record.regionId ??
      record.neighborId,
  )
  if (!source || !target || source.id === target.id) return undefined
  const direction =
    parseDirection(record.direction ?? record.side ?? record.edge) ??
    inferDirection(source.coordinate, target.coordinate)
  if (!direction) return undefined
  const portal = readPortal(record.portal ?? record, source, direction)
  return [
    {
      from: source.id,
      to: target.id,
      direction,
      ...(portal ? { portal } : {}),
    },
  ]
}

function readPortal(
  value: unknown,
  source: NormalizedRegion,
  direction: CardinalDirection,
): NavigationPortal | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const axisIsZ = direction === 'east' || direction === 'west'
  const minimum =
    finiteNumber(record[axisIsZ ? 'minZ' : 'minX']) ??
    finiteNumber(record.min) ??
    finiteNumber(record.start)
  const maximum =
    finiteNumber(record[axisIsZ ? 'maxZ' : 'maxX']) ??
    finiteNumber(record.max) ??
    finiteNumber(record.end)
  if (minimum !== undefined && maximum !== undefined) {
    return normalizePortal({ min: minimum, max: maximum })
  }

  const center =
    finiteNumber(record[axisIsZ ? 'z' : 'x']) ??
    finiteNumber(record.center) ??
    finiteNumber(record.offset)
  const width = finiteNumber(record.width) ?? finiteNumber(record.size)
  if (center === undefined || width === undefined || width <= 0) return undefined
  const edgeMinimum = axisIsZ ? source.bounds.minZ : source.bounds.minX
  const edgeMaximum = axisIsZ ? source.bounds.maxZ : source.bounds.maxX
  const worldCenter =
    record.offset !== undefined && record.center === undefined
      ? edgeMinimum + center
      : center
  return normalizePortal({
    min: clamp(worldCenter - width / 2, edgeMinimum, edgeMaximum),
    max: clamp(worldCenter + width / 2, edgeMinimum, edgeMaximum),
  })
}

function crossingTarget(
  target: NavigationGrid,
  direction: CardinalDirection,
  current: GridCell,
): Point2 {
  switch (direction) {
    case 'north':
      return {
        x: clamp(
          current.x,
          target.bounds.minX + target.cellWidth / 2,
          target.bounds.maxX - target.cellWidth / 2,
        ),
        z: target.bounds.maxZ - target.cellDepth / 2,
      }
    case 'east':
      return {
        x: target.bounds.minX + target.cellWidth / 2,
        z: clamp(
          current.z,
          target.bounds.minZ + target.cellDepth / 2,
          target.bounds.maxZ - target.cellDepth / 2,
        ),
      }
    case 'south':
      return {
        x: clamp(
          current.x,
          target.bounds.minX + target.cellWidth / 2,
          target.bounds.maxX - target.cellWidth / 2,
        ),
        z: target.bounds.minZ + target.cellDepth / 2,
      }
    case 'west':
      return {
        x: target.bounds.maxX - target.cellWidth / 2,
        z: clamp(
          current.z,
          target.bounds.minZ + target.cellDepth / 2,
          target.bounds.maxZ - target.cellDepth / 2,
        ),
      }
  }
}

function gridCell(grid: NavigationGrid, index: number): GridCell {
  const column = index % grid.columns
  const row = Math.floor(index / grid.columns)
  return {
    regionId: grid.regionId,
    index,
    x: grid.bounds.minX + (column + 0.5) * grid.cellWidth,
    y: grid.heights[index] ?? 0,
    z: grid.bounds.minZ + (row + 0.5) * grid.cellDepth,
  }
}

function worldToCellIndex(
  grid: NavigationGrid,
  x: number,
  z: number,
): number {
  const column = clamp(
    Math.floor((x - grid.bounds.minX) / grid.cellWidth),
    0,
    grid.columns - 1,
  )
  const row = clamp(
    Math.floor((z - grid.bounds.minZ) / grid.cellDepth),
    0,
    grid.rows - 1,
  )
  return row * grid.columns + column
}

function isGridCellWalkable(grid: NavigationGrid, index: number): boolean {
  return index >= 0 && index < grid.walkable.length && grid.walkable[index] === 1
}

function nodeKey(regionId: RegionId, index: number): string {
  return `${String(regionId).length}:${String(regionId)}:${index}`
}

function pathHeuristic(point: Point2, destination: Point2): number {
  return Math.abs(point.x - destination.x) + Math.abs(point.z - destination.z)
}

function compareSearchNodes(first: SearchNode, second: SearchNode): number {
  return (
    first.f - second.f ||
    first.h - second.h ||
    first.key.localeCompare(second.key) ||
    first.sequence - second.sequence
  )
}

function dedupeWaypoints(
  waypoints: readonly NavigationWaypoint[],
): NavigationWaypoint[] {
  const result: NavigationWaypoint[] = []
  for (const waypoint of waypoints) {
    const previous = result[result.length - 1]
    if (
      previous &&
      Math.hypot(previous.x - waypoint.x, previous.z - waypoint.z) < 1e-7
    ) {
      result[result.length - 1] = waypoint
    } else {
      result.push(waypoint)
    }
  }
  return result
}

function simplifyWaypoints(
  waypoints: readonly NavigationWaypoint[],
): NavigationWaypoint[] {
  if (waypoints.length < 3) return [...waypoints]
  const result = [waypoints[0]]
  for (let index = 1; index < waypoints.length - 1; index += 1) {
    const previous = result[result.length - 1]
    const current = waypoints[index]
    const next = waypoints[index + 1]
    const firstDirection = normalizedDirection(
      current.x - previous.x,
      current.z - previous.z,
    )
    const secondDirection = normalizedDirection(
      next.x - current.x,
      next.z - current.z,
    )
    const collinear =
      Math.abs(
        firstDirection.x * secondDirection.z -
          firstDirection.z * secondDirection.x,
      ) < 1e-7 &&
      firstDirection.x * secondDirection.x +
        firstDirection.z * secondDirection.z >
        0
    if (!collinear || String(previous.regionId) !== String(next.regionId)) {
      result.push(current)
    }
  }
  result.push(waypoints[waypoints.length - 1])
  return result
}

function normalizedDirection(x: number, z: number): Point2 {
  const length = Math.hypot(x, z)
  return length <= 1e-9 ? { x: 0, z: 0 } : { x: x / length, z: z / length }
}

function findRegion(
  layout: WorldLayout,
  id: unknown,
): NormalizedRegion | undefined {
  if (id === undefined || id === null) return undefined
  return layout.regions.find((region) => String(region.id) === String(id))
}

function inferDirection(
  from: Point2,
  to: Point2,
): CardinalDirection | undefined {
  const deltaX = to.x - from.x
  const deltaZ = to.z - from.z
  if (Math.abs(deltaX) + Math.abs(deltaZ) !== 1) return undefined
  if (deltaX === 1) return 'east'
  if (deltaX === -1) return 'west'
  if (deltaZ === 1) return 'south'
  return 'north'
}

function parseDirection(value: unknown): CardinalDirection | undefined {
  if (typeof value !== 'string') return undefined
  switch (value.toLowerCase()) {
    case 'n':
    case 'north':
    case 'top':
      return 'north'
    case 'e':
    case 'east':
    case 'right':
      return 'east'
    case 's':
    case 'south':
    case 'bottom':
      return 'south'
    case 'w':
    case 'west':
    case 'left':
      return 'west'
    default:
      return undefined
  }
}

function oppositeDirection(direction: CardinalDirection): CardinalDirection {
  switch (direction) {
    case 'north':
      return 'south'
    case 'east':
      return 'west'
    case 'south':
      return 'north'
    case 'west':
      return 'east'
  }
}

function directionOffset(direction: CardinalDirection): Point2 {
  switch (direction) {
    case 'north':
      return { x: 0, z: -1 }
    case 'east':
      return { x: 1, z: 0 }
    case 'south':
      return { x: 0, z: 1 }
    case 'west':
      return { x: -1, z: 0 }
  }
}

function cardinalDirections(): readonly CardinalDirection[] {
  return ['north', 'east', 'south', 'west']
}

function cardinalIndex(direction: CardinalDirection): number {
  return cardinalDirections().indexOf(direction)
}

function coordinateKey(x: number, z: number): string {
  return `${x}:${z}`
}

function normalizePortal(portal: NavigationPortal): NavigationPortal {
  return {
    min: Math.min(portal.min, portal.max),
    max: Math.max(portal.min, portal.max),
  }
}

function setsEqual<T>(first: ReadonlySet<T>, second: ReadonlySet<T>): boolean {
  if (first.size !== second.size) return false
  for (const value of first) {
    if (!second.has(value)) return false
  }
  return true
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

class MinHeap<T> {
  private readonly values: T[] = []
  private readonly compare: (first: T, second: T) => number

  constructor(compare: (first: T, second: T) => number) {
    this.compare = compare
  }

  get size(): number {
    return this.values.length
  }

  push(value: T): void {
    this.values.push(value)
    let index = this.values.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.compare(this.values[parent], value) <= 0) break
      this.values[index] = this.values[parent]
      index = parent
    }
    this.values[index] = value
  }

  pop(): T | undefined {
    const first = this.values[0]
    const last = this.values.pop()
    if (this.values.length === 0 || last === undefined) return first
    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      if (left >= this.values.length) break
      const child =
        right < this.values.length &&
        this.compare(this.values[right], this.values[left]) < 0
          ? right
          : left
      if (this.compare(this.values[child], last) >= 0) break
      this.values[index] = this.values[child]
      index = child
    }
    this.values[index] = last
    return first
  }
}
