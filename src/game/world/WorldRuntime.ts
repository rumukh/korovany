import type {
  RegionBlueprint,
  RegionId,
  WorldBlueprint,
} from './worldTypes.ts'
import type { CollisionWorld } from '../systems/CollisionWorld.ts'
import type {
  NavigationSystem,
  NavigationWaypoint,
} from '../systems/NavigationSystem.ts'
import type { RegionManager } from './RegionManager.ts'
import type {
  Bounds2D,
  Point2,
  Point3,
  TerrainSystem,
} from './TerrainSystem.ts'

export type WorldRuntimeMode = 'legacy' | 'generated'

export interface WorldMarker {
  id: string
  x: number
  z: number
  y?: number
  kind: string
  label?: string
  regionId?: RegionId
  heading?: number
}

export interface WorldRuntimeUpdate {
  deltaSeconds: number
  focus?: Point2
}

export interface WorldRuntimeState {
  currentRegionId?: RegionId
  discoveredRegionIds: readonly RegionId[]
}

export interface WorldRuntime {
  readonly mode: WorldRuntimeMode
  readonly blueprint?: WorldBlueprint
  readonly bounds: Bounds2D
  readonly collision: CollisionWorld
  readonly navigation: NavigationSystem
  readonly currentRegionId?: RegionId
  readonly discoveredRegionIds: readonly RegionId[]

  getRegionAt(x: number, z: number): RegionBlueprint | undefined
  getRegionIdAt(x: number, z: number): RegionId | undefined
  getBiomeAt(x: number, z: number): string | undefined
  sampleHeight(x: number, z: number): number
  sampleNormal(x: number, z: number): Point3
  getMarkers(): readonly WorldMarker[]
  findPath(
    start: Point2,
    destination: Point2,
  ): readonly NavigationWaypoint[] | null
  update(update: WorldRuntimeUpdate): void
  dispose(): void
}

export interface GeneratedWorldRuntime extends WorldRuntime {
  readonly mode: 'generated'
  readonly blueprint: WorldBlueprint
  readonly terrain: TerrainSystem
  readonly regions: RegionManager
}

export interface LegacyWorldRuntime extends WorldRuntime {
  readonly mode: 'legacy'
  readonly blueprint?: undefined
}
