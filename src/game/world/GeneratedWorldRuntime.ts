import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  createProceduralSurfaceTexture,
  type ProceduralSurfacePattern,
} from '../ProceduralSurfaceTexture.ts'
import {
  BIOME_PROFILES,
  SITE_PRESENTATIONS,
  createGeneratedEncounterPlan,
  getSiteWorldPosition2D,
  type GeneratedEncounterPlan,
} from '../content/registry.ts'
import { RandomStream } from '../random/RandomStream.ts'
import { deriveSeed } from '../random/seed.ts'
import { CollisionWorld, type CollisionWorldDebugStats } from '../systems/CollisionWorld.ts'
import {
  NavigationSystem,
  type NavigationDebugStats,
  type NavigationWaypoint,
} from '../systems/NavigationSystem.ts'
import type { Faction, ZoneId } from '../types.ts'
import {
  RegionManager,
  type ManagedRegionRuntime,
  type RegionLifecycleSnapshot,
} from './RegionManager.ts'
import {
  RegionRuntime,
  type RegionDelta,
  type RegionLifecycleState,
} from './RegionRuntime.ts'
import {
  TerrainSystem,
  type Bounds2D,
  type NormalizedRegion,
  type Point2,
  type Point3,
} from './TerrainSystem.ts'
import type {
  GeneratedWorldRuntime as GeneratedWorldRuntimeContract,
  WorldMarker,
  WorldRuntimeUpdate,
} from './WorldRuntime.ts'
import type {
  BridgeCrossing,
  EncounterSlot,
  RegionBlueprint,
  RegionId,
  SiteKind,
  WorldBlueprint,
  WorldSite,
} from './worldTypes.ts'

export interface GeneratedWorldPalette {
  terrain?: Partial<Record<ZoneId, THREE.ColorRepresentation>>
  secondary?: Partial<Record<ZoneId, THREE.ColorRepresentation>>
  accent?: Partial<Record<ZoneId, THREE.ColorRepresentation>>
  road?: THREE.ColorRepresentation
  water?: THREE.ColorRepresentation
  bridge?: THREE.ColorRepresentation
  structure?: THREE.ColorRepresentation
  roof?: THREE.ColorRepresentation
}

export interface GeneratedWorldRuntimeOptions {
  palette?: GeneratedWorldPalette
  terrainResolution?: number
  roadWidth?: number
  riverWidth?: number
  bridgeWidth?: number
  decorationDensity?: number
  castShadows?: boolean
}

export interface GeneratedSitePlacement extends WorldSite {
  label: string
  position: Point3
}

export interface GeneratedRegionRootDebugSnapshot {
  regionId: RegionId
  state: RegionLifecycleState
  attached: boolean
  geometryCount: number
  colliderCount: number
  structuralDecorationCount: number
  cosmeticDecorationCount: number
  maxCosmeticDecorationCount: number
}

export interface GeneratedWorldRuntimeDebugSnapshot {
  disposed: boolean
  currentRegionId?: RegionId
  visibleRegionIds: RegionId[]
  simulatedRegionIds: RegionId[]
  discoveredRegionIds: RegionId[]
  sceneRegionRootCount: number
  materials: {
    owned: number
    disposed: number
  }
  decorations: {
    density: number
    structuralInstanceCount: number
    cosmeticInstanceCount: number
    maxCosmeticInstanceCount: number
  }
  collision: CollisionWorldDebugStats
  navigation: NavigationDebugStats
  regionRoots: GeneratedRegionRootDebugSnapshot[]
  lifecycle: RegionLifecycleSnapshot[]
}

interface RuntimeStyle {
  terrainResolution: number
  roadWidth: number
  riverWidth: number
  bridgeWidth: number
  decorationDensity: number
  castShadows: boolean
}

interface SharedMaterials {
  terrain: Record<ZoneId, THREE.MeshStandardMaterial>
  secondary: Record<ZoneId, THREE.MeshStandardMaterial>
  accent: Record<ZoneId, THREE.MeshStandardMaterial>
  road: THREE.MeshStandardMaterial
  water: THREE.MeshStandardMaterial
  bridge: THREE.MeshStandardMaterial
  structure: Record<ZoneId, THREE.MeshStandardMaterial>
  roof: Record<ZoneId, THREE.MeshStandardMaterial>
  trunk: THREE.MeshStandardMaterial
  groundCover: Record<ZoneId, THREE.MeshStandardMaterial>
  all: THREE.Material[]
  textures: THREE.Texture[]
}

interface SceneRegionRuntimeContext {
  scene: THREE.Scene
  blueprint: WorldBlueprint
  normalizedRegion: NormalizedRegion
  terrain: TerrainSystem
  collision: CollisionWorld
  materials: SharedMaterials
  style: RuntimeStyle
  onDisposed: (regionId: RegionId) => void
}

const ZONE_IDS: readonly ZoneId[] = ['neutral', 'palace', 'forest', 'fort']

export class GeneratedWorldRuntime implements GeneratedWorldRuntimeContract {
  readonly mode = 'generated' as const
  readonly blueprint: WorldBlueprint
  readonly bounds: Bounds2D
  readonly terrain: TerrainSystem
  readonly collision: CollisionWorld
  readonly navigation: NavigationSystem
  readonly regions: RegionManager

  private readonly scene: THREE.Scene
  private readonly style: RuntimeStyle
  private readonly materials: SharedMaterials
  private readonly sceneRegions = new Map<RegionId, SceneRegionRuntime>()
  private readonly sitePositions = new Map<string, Point3>()
  private disposedMaterialCount = 0
  private disposed = false

  constructor(
    scene: THREE.Scene,
    blueprint: WorldBlueprint,
    options: GeneratedWorldRuntimeOptions = {},
  ) {
    this.scene = scene
    this.blueprint = blueprint
    this.style = normalizeStyle(options)
    this.materials = createSharedMaterials(options.palette)
    this.terrain = new TerrainSystem(blueprint, {
      tileResolution: this.style.terrainResolution,
    })
    this.bounds = { ...this.terrain.bounds }
    this.collision = new CollisionWorld(this.terrain, {
      cellSize: 8,
      worldBounds: this.bounds,
    })
    this.navigation = new NavigationSystem(
      blueprint,
      this.terrain,
      this.collision,
      {
        cellSize: 2,
        agentRadius: 0.45,
      },
    )
    this.navigation.setActiveRegions([])
    this.collision.setActiveBounds([])
    this.regions = new RegionManager(
      blueprint,
      (regionBlueprint, context) => {
        const runtime = new SceneRegionRuntime(regionBlueprint, {
          scene: this.scene,
          blueprint: this.blueprint,
          normalizedRegion: context.region,
          terrain: this.terrain,
          collision: this.collision,
          materials: this.materials,
          style: this.style,
          onDisposed: (regionId) => {
            this.sceneRegions.delete(regionId)
          },
        })
        this.sceneRegions.set(context.regionId, runtime)
        return runtime
      },
      {
        visibleRadius: 1,
        simulationRadius: 1,
        discoverVisibleRegions: false,
      },
    )
  }

  get currentRegionId(): RegionId | undefined {
    return this.regions.currentRegionId
  }

  get discoveredRegionIds(): readonly RegionId[] {
    return this.regions.getDiscoveredRegionIds()
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  getRegionAt(x: number, z: number): RegionBlueprint | undefined {
    return this.terrain.getRegionAt(x, z)?.blueprint
  }

  getRegionIdAt(x: number, z: number): RegionId | undefined {
    return this.terrain.getRegionIdAt(x, z)
  }

  getBiomeAt(x: number, z: number): string | undefined {
    return this.terrain.getBiomeAt(x, z)
  }

  sampleHeight(x: number, z: number): number {
    return this.terrain.sampleHeight(x, z)
  }

  sampleNormal(x: number, z: number): Point3 {
    return this.terrain.sampleNormal(x, z)
  }

  getRegionBounds(regionId: RegionId): Bounds2D | undefined {
    const bounds = this.terrain.getRegion(regionId)?.bounds
    return bounds ? { ...bounds } : undefined
  }

  getRegionCenter(regionId: RegionId): Point3 | undefined {
    const bounds = this.getRegionBounds(regionId)
    if (!bounds) return undefined
    const x = (bounds.minX + bounds.maxX) / 2
    const z = (bounds.minZ + bounds.maxZ) / 2
    return { x, y: this.sampleHeight(x, z), z }
  }

  getSitePosition(siteOrId: WorldSite | string): Point3 | undefined {
    const site =
      typeof siteOrId === 'string'
        ? this.blueprint.sites.find((candidate) => candidate.id === siteOrId)
        : siteOrId
    if (!site) return undefined
    const cached = this.sitePositions.get(site.id)
    if (cached) return { ...cached }
    const position = getSiteWorldPosition2D(this.blueprint, site)
    if (!position) return undefined
    const located = {
      x: position.x,
      y: this.sampleHeight(position.x, position.z),
      z: position.z,
    }
    this.sitePositions.set(site.id, located)
    return { ...located }
  }

  getStartPosition(faction: Faction): Point3 {
    const startSiteId = this.blueprint.starts[faction]
    const sitePosition = this.requireSitePosition(startSiteId)
    const path = this.blueprint.criticalPaths[faction].regionIds
    const nextRegion = path[1] ? this.getRegionCenter(path[1]) : undefined
    if (!nextRegion) return sitePosition
    const directionX = nextRegion.x - sitePosition.x
    const directionZ = nextRegion.z - sitePosition.z
    const length = Math.hypot(directionX, directionZ)
    if (length <= 0.001) return sitePosition
    const startRegionId = this.blueprint.sites.find(
      (site) => site.id === startSiteId,
    )?.regionId
    const bounds = startRegionId ? this.getRegionBounds(startRegionId) : undefined
    const margin = 12
    const candidateX = sitePosition.x - (directionX / length) * 20
    const candidateZ = sitePosition.z - (directionZ / length) * 20
    const x = bounds
      ? THREE.MathUtils.clamp(candidateX, bounds.minX + margin, bounds.maxX - margin)
      : candidateX
    const z = bounds
      ? THREE.MathUtils.clamp(candidateZ, bounds.minZ + margin, bounds.maxZ - margin)
      : candidateZ
    return { x, y: this.sampleHeight(x, z), z }
  }

  getFinalePosition(faction: Faction): Point3 {
    return this.requireSitePosition(this.blueprint.finales[faction])
  }

  getSitesInRegion(regionId: RegionId): GeneratedSitePlacement[] {
    return this.blueprint.sites
      .filter((site) => site.regionId === regionId)
      .sort((first, second) => first.id.localeCompare(second.id))
      .map((site) => this.locateSite(site))
  }

  findNearbySite(
    position: Point2,
    maxDistance?: number,
    kinds?: readonly SiteKind[],
  ): GeneratedSitePlacement | undefined
  findNearbySite(
    x: number,
    z: number,
    maxDistance?: number,
    kinds?: readonly SiteKind[],
  ): GeneratedSitePlacement | undefined
  findNearbySite(
    positionOrX: Point2 | number,
    zOrDistance = 12,
    distanceOrKinds: number | readonly SiteKind[] = 12,
    maybeKinds?: readonly SiteKind[],
  ): GeneratedSitePlacement | undefined {
    const x = typeof positionOrX === 'number' ? positionOrX : positionOrX.x
    const z = typeof positionOrX === 'number' ? zOrDistance : positionOrX.z
    const maxDistance =
      typeof positionOrX === 'number'
        ? typeof distanceOrKinds === 'number'
          ? distanceOrKinds
          : 12
        : zOrDistance
    const kinds =
      typeof positionOrX === 'number'
        ? maybeKinds ??
          (typeof distanceOrKinds === 'number' ? undefined : distanceOrKinds)
        : typeof distanceOrKinds === 'number'
          ? maybeKinds
          : distanceOrKinds
    const allowedKinds = kinds ? new Set(kinds) : undefined
    let nearest: GeneratedSitePlacement | undefined
    let nearestDistance = Math.max(0, maxDistance)
    for (const site of this.blueprint.sites) {
      if (allowedKinds && !allowedKinds.has(site.kind)) continue
      const placement = this.locateSite(site)
      const distance = Math.hypot(
        placement.position.x - x,
        placement.position.z - z,
      )
      if (
        distance <= nearestDistance &&
        (!nearest ||
          distance < nearestDistance ||
          site.id.localeCompare(nearest.id) < 0)
      ) {
        nearest = placement
        nearestDistance = distance
      }
    }
    return nearest
  }

  getBridgePosition(
    bridgeOrId: BridgeCrossing | string,
  ): Point3 | undefined {
    const bridge =
      typeof bridgeOrId === 'string'
        ? this.blueprint.bridges.find(
            (candidate) => candidate.id === bridgeOrId,
          )
        : bridgeOrId
    return bridge ? this.getRegionCenter(bridge.regionId) : undefined
  }

  getEncounterPlan(
    slotOrId: EncounterSlot | string,
    playerFaction: Faction,
  ): GeneratedEncounterPlan | undefined {
    const slot =
      typeof slotOrId === 'string'
        ? this.blueprint.encounters.find(
            (candidate) => candidate.id === slotOrId,
          )
        : slotOrId
    return slot
      ? createGeneratedEncounterPlan(this.blueprint, slot, playerFaction)
      : undefined
  }

  getEncounterSpawnPlan(
    slotOrId: EncounterSlot | string,
    playerFaction: Faction,
  ): GeneratedEncounterPlan | undefined {
    return this.getEncounterPlan(slotOrId, playerFaction)
  }

  getEncounterPlansInRegion(
    regionId: RegionId,
    playerFaction: Faction,
  ): GeneratedEncounterPlan[] {
    return this.blueprint.encounters
      .filter((slot) => slot.regionId === regionId)
      .sort((first, second) => first.id.localeCompare(second.id))
      .map((slot) =>
        createGeneratedEncounterPlan(this.blueprint, slot, playerFaction),
      )
  }

  getMarkers(): readonly WorldMarker[] {
    const discovered = new Set(this.discoveredRegionIds)
    const markers: WorldMarker[] = []
    for (const site of [...this.blueprint.sites].sort((first, second) =>
      first.id.localeCompare(second.id),
    )) {
      if (!discovered.has(site.regionId)) continue
      const position = this.requireSitePosition(site.id)
      markers.push({
        id: `site:${site.id}`,
        x: position.x,
        y: position.y,
        z: position.z,
        kind: site.kind,
        label: SITE_PRESENTATIONS[site.kind].markerLabel,
        regionId: site.regionId,
      })
    }

    if (this.currentRegionId) {
      const region = this.terrain.getRegion(this.currentRegionId)
      const center = this.getRegionCenter(this.currentRegionId)
      const biome = region?.blueprint.biome
      if (center && biome) {
        markers.push({
          id: `region-current:${this.currentRegionId}`,
          x: center.x,
          y: center.y,
          z: center.z,
          kind: 'current-region',
          label: BIOME_PROFILES[biome].label,
          regionId: this.currentRegionId,
        })
      }
    }
    return markers
  }

  findPath(
    start: Point2,
    destination: Point2,
  ): readonly NavigationWaypoint[] | null {
    return this.navigation.findPath(start, destination)
  }

  setDecorationDensity(density: number): void {
    if (this.disposed) return
    const normalized = normalizeDecorationDensity(density)
    if (normalized === this.style.decorationDensity) return
    this.style.decorationDensity = normalized
    for (const runtime of this.sceneRegions.values()) {
      runtime.setDecorationDensity(normalized)
    }
  }

  update(update: WorldRuntimeUpdate): void {
    if (this.disposed) return
    const deltaSeconds =
      Number.isFinite(update.deltaSeconds) && update.deltaSeconds >= 0
        ? update.deltaSeconds
        : 0
    let updateError: unknown
    try {
      if (update.focus) {
        const regionId = this.getRegionIdAt(update.focus.x, update.focus.z)
        if (!regionId) return
        this.regions.update(regionId, deltaSeconds)
      } else if (this.currentRegionId) {
        this.regions.update(undefined, deltaSeconds)
      } else {
        return
      }
    } catch (error) {
      updateError = error
    }

    const visibleRegionIds = this.regions.getVisibleRegionIds()
    const activeBounds = visibleRegionIds
      .map((regionId) => this.getRegionBounds(regionId))
      .filter((bounds): bounds is Bounds2D => bounds !== undefined)
    this.collision.setActiveBounds(activeBounds)
    this.navigation.setActiveRegions(this.regions.getSimulatedRegionIds())
    if (updateError !== undefined) throw updateError
  }

  getDebugSnapshot(): GeneratedWorldRuntimeDebugSnapshot {
    const regionRoots = [...this.sceneRegions.values()]
      .map((runtime) => runtime.getDebugSnapshot())
      .sort((first, second) =>
        String(first.regionId).localeCompare(String(second.regionId)),
      )
    return {
      disposed: this.disposed,
      ...(this.currentRegionId === undefined
        ? {}
        : { currentRegionId: this.currentRegionId }),
      visibleRegionIds: this.regions.getVisibleRegionIds(),
      simulatedRegionIds: this.regions.getSimulatedRegionIds(),
      discoveredRegionIds: this.regions.getDiscoveredRegionIds(),
      sceneRegionRootCount: this.scene.children.filter(
        (child) => child.userData.generatedWorldRegionId !== undefined,
      ).length,
      materials: {
        owned: this.materials.all.length,
        disposed: this.disposedMaterialCount,
      },
      decorations: {
        density: this.style.decorationDensity,
        structuralInstanceCount: regionRoots.reduce(
          (total, root) => total + root.structuralDecorationCount,
          0,
        ),
        cosmeticInstanceCount: regionRoots.reduce(
          (total, root) => total + root.cosmeticDecorationCount,
          0,
        ),
        maxCosmeticInstanceCount: regionRoots.reduce(
          (total, root) => total + root.maxCosmeticDecorationCount,
          0,
        ),
      },
      collision: this.collision.getDebugStats(),
      navigation: this.navigation.getDebugStats(),
      regionRoots,
      lifecycle: this.regions.getLifecycleSnapshots(),
    }
  }

  getLifecycleDebugSnapshot(): GeneratedWorldRuntimeDebugSnapshot {
    return this.getDebugSnapshot()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const errors: unknown[] = []
    try {
      this.regions.dispose()
    } catch (error) {
      errors.push(error)
    }
    for (const runtime of [...this.sceneRegions.values()]) {
      try {
        runtime.dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    this.sceneRegions.clear()
    this.sitePositions.clear()
    this.collision.clear()
    this.collision.setActiveBounds([])
    try {
      this.navigation.dispose()
    } catch (error) {
      errors.push(error)
    }
    for (const material of this.materials.all) {
      try {
        material.dispose()
        this.disposedMaterialCount += 1
      } catch (error) {
        errors.push(error)
      }
    }
    for (const texture of this.materials.textures) {
      try {
        texture.dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Failed to dispose the generated world')
    }
  }

  private locateSite(site: WorldSite): GeneratedSitePlacement {
    return {
      ...site,
      label: SITE_PRESENTATIONS[site.kind].label,
      position: this.requireSitePosition(site.id),
    }
  }

  private requireSitePosition(siteId: string): Point3 {
    const position = this.getSitePosition(siteId)
    if (!position) throw new Error(`Unknown generated world site: ${siteId}`)
    return position
  }
}

class SceneRegionRuntime implements ManagedRegionRuntime {
  readonly id: RegionId
  readonly blueprint: RegionBlueprint
  readonly root: THREE.Group

  private readonly context: SceneRegionRuntimeContext
  private readonly runtime: RegionRuntime
  private readonly geometries = new Set<THREE.BufferGeometry>()
  private readonly cosmeticDressing: Array<{
    mesh: THREE.InstancedMesh
    maximumCount: number
  }> = []
  private structuralDecorationCount = 0
  private maxCosmeticDecorationCount = 0
  private resourcesDisposed = false

  constructor(
    blueprint: RegionBlueprint,
    context: SceneRegionRuntimeContext,
  ) {
    this.id = context.normalizedRegion.id
    this.blueprint = blueprint
    this.context = context
    this.root = new THREE.Group()
    this.root.name = `generated-region:${String(this.id)}`
    this.root.userData.generatedWorldRegionId = this.id
    this.runtime = new RegionRuntime(blueprint, this.id, {
      onTransition: (_runtime, _previous, next) => {
        this.handleTransition(next)
      },
      onDispose: () => {
        this.releaseResources()
      },
    })
    try {
      this.build()
    } catch (error) {
      try {
        this.releaseResources()
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Failed to build and clean region ${String(this.id)}`,
        )
      }
      throw error
    }
  }

  get state(): RegionLifecycleState {
    return this.runtime.state
  }

  transitionTo(state: RegionLifecycleState): boolean {
    return this.runtime.transitionTo(state)
  }

  update(deltaSeconds: number): void {
    this.runtime.update(deltaSeconds)
  }

  extractDelta(): RegionDelta {
    return this.runtime.extractDelta()
  }

  applyDelta(delta: unknown): boolean {
    return this.runtime.applyDelta(delta)
  }

  setDecorationDensity(density: number): void {
    const normalized = normalizeDecorationDensity(density)
    for (const dressing of this.cosmeticDressing) {
      const count = Math.floor(dressing.maximumCount * normalized)
      dressing.mesh.count = count
      dressing.mesh.visible = count > 0
    }
  }

  dispose(): void {
    this.runtime.dispose()
    this.releaseResources()
  }

  getDebugSnapshot(): GeneratedRegionRootDebugSnapshot {
    return {
      regionId: this.id,
      state: this.state,
      attached: this.root.parent === this.context.scene,
      geometryCount: this.geometries.size,
      colliderCount: this.runtime.colliderIds.size,
      structuralDecorationCount: this.structuralDecorationCount,
      cosmeticDecorationCount: this.cosmeticDressing.reduce(
        (total, dressing) => total + dressing.mesh.count,
        0,
      ),
      maxCosmeticDecorationCount: this.maxCosmeticDecorationCount,
    }
  }

  private handleTransition(next: RegionLifecycleState): void {
    if (next === 'visible' || next === 'simulated') {
      if (this.root.parent !== this.context.scene) {
        this.context.scene.add(this.root)
      }
      return
    }
    if (this.root.parent) this.root.removeFromParent()
    if (next === 'unloaded') this.releaseResources()
  }

  private build(): void {
    this.createTerrain()
    this.createRoads()
    this.createRiver()
    this.createBridges()
    this.createSites()
    this.createDressing()
    this.createGroundCover()
  }

  private createTerrain(): void {
    const geometry = this.context.terrain.createRegionGeometry(
      this.id,
      this.context.style.terrainResolution,
    )
    this.geometries.add(geometry)
    const biome = this.blueprint.biome
    const mesh = new THREE.Mesh(
      geometry,
      this.context.materials.terrain[biome],
    )
    mesh.name = `terrain:${String(this.id)}`
    mesh.receiveShadow = true
    mesh.castShadow = false
    mesh.userData.generatedTerrainRegionId = this.id
    this.root.add(mesh)
  }

  private createRoads(): void {
    const directions = new Set<string>()
    const regionById = new Map(
      this.context.blueprint.regions.map((region) => [region.id, region]),
    )
    for (const segment of this.context.blueprint.roads.segments) {
      if (
        segment.fromRegionId !== this.id &&
        segment.toRegionId !== this.id
      ) {
        continue
      }
      const otherId =
        segment.fromRegionId === this.id
          ? segment.toRegionId
          : segment.fromRegionId
      const other = regionById.get(otherId)
      if (!other) continue
      const direction = directionBetween(this.blueprint, other)
      if (direction) directions.add(direction)
    }
    if (directions.size === 0) return

    const bounds = this.context.normalizedRegion.bounds
    const center = boundsCenter(bounds)
    for (const direction of [...directions].sort()) {
      const edge = edgeCenter(bounds, direction)
      this.addProjectedStrip(
        center,
        edge,
        this.context.style.roadWidth,
        0.12,
        5,
        this.context.materials.road,
        `road:${String(this.id)}:${direction}`,
        0.14,
      )
    }
  }

  private createRiver(): void {
    if (!this.context.blueprint.river.regionPath.includes(this.id)) return
    const bounds = this.context.normalizedRegion.bounds
    const center = boundsCenter(bounds)
    this.addProjectedStrip(
      { x: center.x, z: bounds.minZ },
      { x: center.x, z: bounds.maxZ },
      this.context.style.riverWidth,
      0.1,
      8,
      this.context.materials.water,
      `river:${String(this.id)}`,
      0.1,
    )

    const bridges = this.context.blueprint.bridges.filter(
      (bridge) => bridge.regionId === this.id,
    )
    if (bridges.length === 0) {
      this.registerWaterCollider(
        `water:${String(this.id)}:full`,
        bounds.minZ,
        bounds.maxZ,
      )
      return
    }

    const gap = Math.max(6, this.context.style.bridgeWidth + 1.5)
    this.registerWaterCollider(
      `water:${String(this.id)}:north`,
      bounds.minZ,
      center.z - gap / 2,
    )
    this.registerWaterCollider(
      `water:${String(this.id)}:south`,
      center.z + gap / 2,
      bounds.maxZ,
    )
  }

  private createBridges(): void {
    const bridges = this.context.blueprint.bridges
      .filter((bridge) => bridge.regionId === this.id)
      .sort((first, second) => first.id.localeCompare(second.id))
    if (bridges.length === 0) return
    const center = boundsCenter(this.context.normalizedRegion.bounds)
    for (let index = 0; index < bridges.length; index += 1) {
      const bridge = bridges[index]
      const group = new THREE.Group()
      group.name = `bridge:${bridge.id}`
      group.userData.generatedBridgeId = bridge.id
      const y = this.context.terrain.sampleHeight(center.x, center.z)
      group.position.set(center.x, y + index * 0.025, center.z)

      const deckGeometry = new THREE.BoxGeometry(
        this.context.style.riverWidth + 4,
        0.42,
        this.context.style.bridgeWidth,
      )
      const deck = this.addMesh(
        group,
        deckGeometry,
        this.context.materials.bridge,
        `bridge-deck:${bridge.id}`,
      )
      deck.position.y = 0.28
      deck.castShadow = this.context.style.castShadows
      deck.receiveShadow = true

      for (const side of [-1, 1]) {
        const railGeometry = new THREE.BoxGeometry(
          this.context.style.riverWidth + 4,
          0.5,
          0.18,
        )
        const rail = this.addMesh(
          group,
          railGeometry,
          this.context.materials.bridge,
          `bridge-rail:${bridge.id}:${side}`,
        )
        rail.position.set(
          0,
          0.68,
          side * (this.context.style.bridgeWidth / 2 - 0.18),
        )
      }
      this.root.add(group)
      this.runtime.ownProp(bridge.id)
    }
  }

  private createSites(): void {
    const sites = this.context.blueprint.sites
      .filter((site) => site.regionId === this.id)
      .sort((first, second) => first.id.localeCompare(second.id))
    for (const site of sites) this.createSitePrefab(site)
  }

  private createSitePrefab(site: WorldSite): void {
    const anchor = getSiteWorldPosition2D(this.context.blueprint, site)
    if (!anchor) return
    const presentation = SITE_PRESENTATIONS[site.kind]
    const prefab = presentation.prefab
    const bounds = this.context.normalizedRegion.bounds
    const regionCenter = boundsCenter(bounds)
    const radialX = anchor.x - regionCenter.x
    const radialZ = anchor.z - regionCenter.z
    const radialLength = Math.hypot(radialX, radialZ) || 1
    const forwardX = radialX / radialLength
    const forwardZ = radialZ / radialLength
    const offset = prefab.footprintDepth / 2 + 2.5
    const x = clamp(
      anchor.x + forwardX * offset,
      bounds.minX + prefab.footprintWidth / 2 + 2,
      bounds.maxX - prefab.footprintWidth / 2 - 2,
    )
    const z = clamp(
      anchor.z + forwardZ * offset,
      bounds.minZ + prefab.footprintDepth / 2 + 2,
      bounds.maxZ - prefab.footprintDepth / 2 - 2,
    )
    const y = this.context.terrain.sampleHeight(x, z)
    const rotation = Math.atan2(forwardX, forwardZ)
    const group = new THREE.Group()
    group.name = `site:${site.id}`
    group.userData.generatedSiteId = site.id
    group.userData.generatedSiteKind = site.kind
    group.position.set(x, y, z)
    group.rotation.y = rotation
    this.root.add(group)

    this.addPrefabBody(group, site)
    if (
      prefab.solid &&
      Math.max(prefab.footprintWidth, prefab.footprintDepth) >= 3
    ) {
      const colliderId = `site-solid:${site.id}`
      this.context.collision.registerBox({
        id: colliderId,
        regionId: this.id,
        x,
        z,
        halfWidth: prefab.footprintWidth / 2,
        halfDepth: prefab.footprintDepth / 2,
        rotation,
        tags: ['site', site.kind],
      })
      this.runtime.ownCollider(colliderId)
    }
    this.runtime.ownProp(site.id)
    this.runtime.ownMarker(`site:${site.id}`)
  }

  private addPrefabBody(group: THREE.Group, site: WorldSite): void {
    const prefab = SITE_PRESENTATIONS[site.kind].prefab
    const biome = this.blueprint.biome
    const structure = this.context.materials.structure[biome]
    const accent = this.context.materials.accent[biome]
    const roof = this.context.materials.roof[biome]
    const width = prefab.footprintWidth
    const depth = prefab.footprintDepth
    const height = prefab.wallHeight

    if (prefab.shape === 'shrine') {
      for (const x of [-width * 0.32, width * 0.32]) {
        const pillar = this.addMesh(
          group,
          new THREE.CylinderGeometry(0.22, 0.3, height, 6),
          structure,
          `site-pillar:${site.id}`,
        )
        pillar.position.set(x, height / 2, 0)
      }
      const canopy = this.addMesh(
        group,
        new THREE.ConeGeometry(width * 0.55, prefab.roofHeight, 6),
        accent,
        `site-canopy:${site.id}`,
      )
      canopy.position.y = height + prefab.roofHeight / 2
    } else if (prefab.shape === 'obelisk') {
      const obelisk = this.addMesh(
        group,
        new THREE.ConeGeometry(width * 0.34, height, 4),
        accent,
        `site-obelisk:${site.id}`,
      )
      obelisk.position.y = height / 2
      obelisk.rotation.y = Math.PI / 4
    } else if (prefab.shape === 'monument') {
      const column = this.addMesh(
        group,
        new THREE.CylinderGeometry(
          width * 0.2,
          width * 0.34,
          height,
          7,
        ),
        structure,
        `site-monument:${site.id}`,
      )
      column.position.y = height / 2
      const cap = this.addMesh(
        group,
        new THREE.ConeGeometry(width * 0.4, prefab.roofHeight + 0.6, 7),
        accent,
        `site-monument-cap:${site.id}`,
      )
      cap.position.y = height + (prefab.roofHeight + 0.6) / 2
    } else if (prefab.shape === 'chest') {
      const chest = this.addMesh(
        group,
        new THREE.BoxGeometry(width, height, depth),
        structure,
        `site-chest:${site.id}`,
      )
      chest.position.y = height / 2
      const lid = this.addMesh(
        group,
        new THREE.BoxGeometry(width + 0.08, prefab.roofHeight, depth + 0.08),
        accent,
        `site-chest-lid:${site.id}`,
      )
      lid.position.y = height + prefab.roofHeight / 2
    } else if (prefab.shape === 'camp') {
      const tent = this.addMesh(
        group,
        new THREE.ConeGeometry(width * 0.52, height + prefab.roofHeight, 4),
        accent,
        `site-tent:${site.id}`,
      )
      tent.position.y = (height + prefab.roofHeight) / 2
      tent.rotation.y = Math.PI / 4
    } else {
      const body = this.addMesh(
        group,
        new THREE.BoxGeometry(width, height, depth),
        structure,
        `site-body:${site.id}`,
      )
      body.position.y = height / 2
      const roofGeometry =
        prefab.shape === 'stall'
          ? new THREE.BoxGeometry(
              width + 0.8,
              Math.max(0.3, prefab.roofHeight),
              depth + 0.8,
            )
          : new THREE.ConeGeometry(
              Math.max(width, depth) * 0.7,
              Math.max(0.6, prefab.roofHeight),
              4,
            )
      const roofMesh = this.addMesh(
        group,
        roofGeometry,
        roof,
        `site-roof:${site.id}`,
      )
      roofMesh.position.y = height + Math.max(0.3, prefab.roofHeight) / 2
      if (prefab.shape !== 'stall') roofMesh.rotation.y = Math.PI / 4

      if (prefab.shape === 'houses') {
        const annex = this.addMesh(
          group,
          new THREE.BoxGeometry(width * 0.42, height * 0.72, depth * 0.55),
          accent,
          `site-annex:${site.id}`,
        )
        annex.position.set(
          -width * 0.55,
          (height * 0.72) / 2,
          depth * 0.12,
        )
      }
    }

    for (let index = 0; index < prefab.towerCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1
      const towerHeight = height + 2
      const tower = this.addMesh(
        group,
        new THREE.CylinderGeometry(1.35, 1.55, towerHeight, 7),
        structure,
        `site-tower:${site.id}:${index}`,
      )
      tower.position.set(
        side * (width / 2 - 0.8),
        towerHeight / 2,
        depth * 0.28,
      )
    }

    for (let index = 0; index < prefab.detailCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1
      const pole = this.addMesh(
        group,
        new THREE.CylinderGeometry(0.08, 0.1, 2.2, 5),
        accent,
        `site-detail:${site.id}:${index}`,
      )
      pole.position.set(
        side * (width / 2 + 0.55),
        1.1,
        -depth / 2 + 0.7 + index * 0.55,
      )
    }

    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = this.context.style.castShadows
      object.receiveShadow = true
    })
  }

  private createDressing(): void {
    const profile = BIOME_PROFILES[this.blueprint.biome]
    const maximumCount = Math.max(
      0,
      Math.floor(
        8 + profile.foliageDensity * 20 + profile.decorationDensity * 8,
      ),
    )
    if (maximumCount === 0) return
    const bounds = this.context.normalizedRegion.bounds
    const center = boundsCenter(bounds)
    const stream = new RandomStream(
      deriveSeed(
        this.context.blueprint.seed,
        `region-dressing:${String(this.id)}`,
      ),
    )
    const sites = this.context.blueprint.sites
      .filter((site) => site.regionId === this.id)
      .map((site) => getSiteWorldPosition2D(this.context.blueprint, site))
      .filter((position): position is Point2 => position !== undefined)
    const placements: Array<{
      index: number
      x: number
      z: number
      scale: number
      rotation: number
    }> = []
    const margin = 6
    const attempts = maximumCount * 10
    for (
      let attempt = 0;
      attempt < attempts && placements.length < maximumCount;
      attempt += 1
    ) {
      const x = stream.range(bounds.minX + margin, bounds.maxX - margin)
      const z = stream.range(bounds.minZ + margin, bounds.maxZ - margin)
      if (
        Math.abs(x - center.x) < this.context.style.roadWidth + 2 ||
        Math.abs(z - center.z) < this.context.style.roadWidth + 2
      ) {
        continue
      }
      if (
        this.context.blueprint.river.regionPath.includes(this.id) &&
        Math.abs(x - center.x) < this.context.style.riverWidth / 2 + 3
      ) {
        continue
      }
      if (
        sites.some((site) => Math.hypot(site.x - x, site.z - z) < 12)
      ) {
        continue
      }
      placements.push({
        index: placements.length,
        x,
        z,
        scale: stream.range(0.72, 1.42),
        rotation: stream.range(0, Math.PI * 2),
      })
    }
    if (placements.length === 0) return

    const geometry = dressingGeometry(this.blueprint.biome)
    this.geometries.add(geometry)
    const material = dressingMaterial(
      this.blueprint.biome,
      this.context.materials,
    )
    const structuralPlacements = placements.filter((placement) =>
      isStructuralDressing(this.blueprint.biome, placement.index),
    )
    const cosmeticPlacements = placements.filter(
      (placement) =>
        !isStructuralDressing(this.blueprint.biome, placement.index),
    )
    const createMesh = (
      entries: typeof placements,
      name: string,
    ): THREE.InstancedMesh | null => {
      if (entries.length === 0) return null
      const mesh = new THREE.InstancedMesh(
        geometry,
        material,
        entries.length,
      )
      mesh.name = name
      mesh.userData.generatedDressingRegionId = this.id
      mesh.castShadow = this.context.style.castShadows
      mesh.receiveShadow = true
      const matrix = new THREE.Matrix4()
      const quaternion = new THREE.Quaternion()
      const scale = new THREE.Vector3()
      const position = new THREE.Vector3()
      const up = new THREE.Vector3(0, 1, 0)
      for (let index = 0; index < entries.length; index += 1) {
        const placement = entries[index]
        quaternion.setFromAxisAngle(up, placement.rotation)
        const verticalScale =
          this.blueprint.biome === 'forest'
            ? placement.scale * 1.25
            : placement.scale
        scale.set(placement.scale, verticalScale, placement.scale)
        position.set(
          placement.x,
          this.context.terrain.sampleHeight(placement.x, placement.z) +
            dressingBaseHeight(this.blueprint.biome) * verticalScale,
          placement.z,
        )
        matrix.compose(position, quaternion, scale)
        mesh.setMatrixAt(index, matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      this.root.add(mesh)
      return mesh
    }

    const structuralMesh = createMesh(
      structuralPlacements,
      `dressing-structural:${String(this.id)}`,
    )
    this.structuralDecorationCount = structuralPlacements.length
    if (structuralMesh) {
      this.runtime.ownProp(`dressing-structural:${String(this.id)}`)
    }
    for (const placement of structuralPlacements) {
      const colliderId = `dressing-solid:${String(this.id)}:${placement.index}`
      this.context.collision.registerCircle({
        id: colliderId,
        regionId: this.id,
        x: placement.x,
        z: placement.z,
        radius: 0.55 * placement.scale,
        tags: ['decoration', this.blueprint.biome],
      })
      this.runtime.ownCollider(colliderId)
    }

    const cosmeticDressing = createMesh(
      cosmeticPlacements,
      `dressing-cosmetic:${String(this.id)}`,
    )
    if (cosmeticDressing) {
      this.registerCosmeticDressing(
        cosmeticDressing,
        cosmeticPlacements.length,
      )
      this.runtime.ownProp(`dressing-cosmetic:${String(this.id)}`)
    }
  }

  private createGroundCover(): void {
    const biome = this.blueprint.biome
    const profile = GROUND_COVER_COUNTS[biome]
    for (const kind of GROUND_COVER_KINDS) {
      const placements = this.collectGroundCoverPlacements(
        kind,
        profile[kind],
      )
      if (placements.length === 0) continue

      const geometry = groundCoverGeometry(kind)
      this.geometries.add(geometry)
      const material =
        kind === 'flower'
          ? this.context.materials.accent[biome]
          : kind === 'pebble'
            ? this.context.materials.secondary[biome]
            : this.context.materials.groundCover[biome]
      const mesh = new THREE.InstancedMesh(
        geometry,
        material,
        placements.length,
      )
      const name = `dressing-cosmetic:ground-${kind}:${String(this.id)}`
      mesh.name = name
      mesh.userData.generatedGroundCoverRegionId = this.id
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
      const matrix = new THREE.Matrix4()
      const quaternion = new THREE.Quaternion()
      const scale = new THREE.Vector3()
      const position = new THREE.Vector3()
      const up = new THREE.Vector3(0, 1, 0)

      for (let index = 0; index < placements.length; index += 1) {
        const placement = placements[index]
        quaternion.setFromAxisAngle(up, placement.rotation)
        writeGroundCoverScale(kind, biome, placement, scale)
        position.set(
          placement.x,
          this.context.terrain.sampleHeight(placement.x, placement.z) +
            (kind === 'pebble' ? 0.08 : 0.015),
          placement.z,
        )
        matrix.compose(position, quaternion, scale)
        mesh.setMatrixAt(index, matrix)
      }

      mesh.instanceMatrix.needsUpdate = true
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.computeBoundingSphere()
      this.root.add(mesh)
      this.registerCosmeticDressing(mesh, placements.length)
      this.runtime.ownProp(name)
    }
  }

  private collectGroundCoverPlacements(
    kind: GroundCoverKind,
    maximumCount: number,
  ): GroundCoverPlacement[] {
    if (maximumCount <= 0) return []
    const bounds = this.context.normalizedRegion.bounds
    const stream = new RandomStream(
      deriveSeed(
        this.context.blueprint.seed,
        `region-ground-cover:${String(this.id)}:${kind}`,
      ),
    )
    const placements: GroundCoverPlacement[] = []
    const margin = 2
    const attempts = maximumCount * 12
    for (
      let attempt = 0;
      attempt < attempts && placements.length < maximumCount;
      attempt += 1
    ) {
      const x = stream.range(bounds.minX + margin, bounds.maxX - margin)
      const z = stream.range(bounds.minZ + margin, bounds.maxZ - margin)
      if (!this.canPlaceGroundCover(x, z)) continue
      placements.push({
        x,
        z,
        rotation: stream.range(0, Math.PI * 2),
        width: stream.next(),
        height: stream.next(),
      })
    }
    return placements
  }

  private canPlaceGroundCover(x: number, z: number): boolean {
    const center = boundsCenter(this.context.normalizedRegion.bounds)
    const roadClearance = this.context.style.roadWidth / 2 + 1.1
    if (
      Math.abs(x - center.x) < roadClearance ||
      Math.abs(z - center.z) < roadClearance
    ) {
      return false
    }
    if (
      this.context.blueprint.river.regionPath.includes(this.id) &&
      Math.abs(x - center.x) < this.context.style.riverWidth / 2 + 1.4
    ) {
      return false
    }
    for (const site of this.context.blueprint.sites) {
      if (site.regionId !== this.id) continue
      const position = getSiteWorldPosition2D(this.context.blueprint, site)
      if (position && Math.hypot(position.x - x, position.z - z) < 11) {
        return false
      }
    }
    return this.context.terrain.isWalkableSlope(x, z)
  }

  private registerCosmeticDressing(
    mesh: THREE.InstancedMesh,
    maximumCount: number,
  ): void {
    this.cosmeticDressing.push({ mesh, maximumCount })
    this.maxCosmeticDecorationCount += maximumCount
    this.setDecorationDensity(this.context.style.decorationDensity)
  }

  private addProjectedStrip(
    start: Point2,
    end: Point2,
    width: number,
    thickness: number,
    segments: number,
    material: THREE.Material,
    name: string,
    heightOffset: number,
  ): void {
    for (let index = 0; index < segments; index += 1) {
      const startT = index / segments
      const endT = (index + 1) / segments
      const startX = lerp(start.x, end.x, startT)
      const startZ = lerp(start.z, end.z, startT)
      const endX = lerp(start.x, end.x, endT)
      const endZ = lerp(start.z, end.z, endT)
      const x = (startX + endX) / 2
      const z = (startZ + endZ) / 2
      const length = Math.hypot(endX - startX, endZ - startZ)
      const geometry = new THREE.BoxGeometry(width, thickness, length + 0.04)
      const mesh = this.addMesh(
        this.root,
        geometry,
        material,
        `${name}:${index}`,
      )
      mesh.position.set(
        x,
        this.context.terrain.sampleHeight(x, z) + heightOffset,
        z,
      )
      mesh.rotation.y = Math.atan2(endX - startX, endZ - startZ)
      mesh.receiveShadow = true
    }
  }

  private registerWaterCollider(
    id: string,
    minZ: number,
    maxZ: number,
  ): void {
    if (maxZ - minZ <= 0.1) return
    const center = boundsCenter(this.context.normalizedRegion.bounds)
    this.context.collision.registerBox({
      id,
      regionId: this.id,
      x: center.x,
      z: (minZ + maxZ) / 2,
      halfWidth: this.context.style.riverWidth / 2,
      halfDepth: (maxZ - minZ) / 2,
      tags: ['water', 'river'],
    })
    this.runtime.ownCollider(id)
  }

  private addMesh(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    name: string,
  ): THREE.Mesh {
    this.geometries.add(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    parent.add(mesh)
    return mesh
  }

  private releaseResources(): void {
    if (this.resourcesDisposed) return
    const errors: unknown[] = []
    if (this.root.parent) this.root.removeFromParent()
    try {
      this.context.collision.removeRegion(this.id)
    } catch (error) {
      errors.push(error)
    }
    this.root.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) {
        try {
          object.dispose()
        } catch (error) {
          errors.push(error)
        }
      }
    })
    for (const geometry of [...this.geometries]) {
      try {
        geometry.dispose()
        this.geometries.delete(geometry)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Failed to release region ${String(this.id)} resources`,
      )
    }
    this.cosmeticDressing.length = 0
    this.structuralDecorationCount = 0
    this.maxCosmeticDecorationCount = 0
    this.root.clear()
    this.context.onDisposed(this.id)
    this.resourcesDisposed = true
  }
}

function createSharedMaterials(
  palette: GeneratedWorldPalette = {},
): SharedMaterials {
  const all: THREE.Material[] = []
  const textures: THREE.Texture[] = []
  const standard = (
    parameters: THREE.MeshStandardMaterialParameters,
  ): THREE.MeshStandardMaterial => {
    const material = new THREE.MeshStandardMaterial(parameters)
    material.userData.generatedWorldShared = true
    all.push(material)
    return material
  }
  const textured = (
    key: string,
    base: THREE.ColorRepresentation,
    pattern: ProceduralSurfacePattern,
    repeatX: number,
    repeatY: number,
    parameters: Omit<
      THREE.MeshStandardMaterialParameters,
      'color' | 'map'
    > = {},
    detail = shadeColor(base, -0.28),
  ): THREE.MeshStandardMaterial => {
    const map = createProceduralSurfaceTexture({
      key,
      base,
      detail,
      pattern,
      repeatX,
      repeatY,
    })
    map.anisotropy = 4
    textures.push(map)
    return standard({
      ...parameters,
      color: 0xffffff,
      map,
    })
  }
  const terrainPatterns: Record<ZoneId, ProceduralSurfacePattern> = {
    neutral: 'grass',
    palace: 'stone',
    forest: 'grass',
    fort: 'scree',
  }
  const secondaryPatterns: Record<ZoneId, ProceduralSurfacePattern> = {
    neutral: 'leaves',
    palace: 'stone',
    forest: 'leaves',
    fort: 'scree',
  }
  const accentPatterns: Record<ZoneId, ProceduralSurfacePattern> = {
    neutral: 'roof',
    palace: 'roof',
    forest: 'leaves',
    fort: 'scree',
  }
  const structurePatterns: Record<ZoneId, ProceduralSurfacePattern> = {
    neutral: 'wood',
    palace: 'stone',
    forest: 'wood',
    fort: 'stone',
  }
  const roofPatterns: Record<ZoneId, ProceduralSurfacePattern> = {
    neutral: 'roof',
    palace: 'roof',
    forest: 'leaves',
    fort: 'roof',
  }
  const terrainColors = createZoneMaterialRecord(
    (zone) => palette.terrain?.[zone] ?? BIOME_PROFILES[zone].terrainColor,
  )
  const secondaryColors = createZoneMaterialRecord(
    (zone) => palette.secondary?.[zone] ?? BIOME_PROFILES[zone].secondaryColor,
  )
  const accentColors = createZoneMaterialRecord(
    (zone) => palette.accent?.[zone] ?? BIOME_PROFILES[zone].accentColor,
  )
  const terrain = createZoneMaterialRecord((zone) =>
    textured(
      `generated-terrain-${zone}`,
      terrainColors[zone],
      terrainPatterns[zone],
      zone === 'palace' ? 10 : 16,
      zone === 'palace' ? 10 : 16,
      {
        roughness: 0.95,
        metalness: 0,
      },
    ),
  )
  const secondary = createZoneMaterialRecord((zone) =>
    textured(
      `generated-secondary-${zone}`,
      secondaryColors[zone],
      secondaryPatterns[zone],
      3,
      3,
      {
        roughness: 0.9,
      },
    ),
  )
  const accent = createZoneMaterialRecord((zone) =>
    textured(
      `generated-accent-${zone}`,
      accentColors[zone],
      accentPatterns[zone],
      4,
      4,
      {
        roughness: 0.72,
      },
    ),
  )
  const roadBase = palette.road ?? 0x70553b
  const road = textured(
    'generated-road',
    roadBase,
    'dirt',
    5,
    2,
    {
      roughness: 1,
    },
  )
  const waterBase = palette.water ?? 0x2f7187
  const water = textured(
    'generated-water',
    waterBase,
    'water',
    5,
    2,
    {
      roughness: 0.28,
      metalness: 0.05,
      transparent: true,
      opacity: 0.82,
    },
    shadeColor(waterBase, 0.25),
  )
  const bridgeBase = palette.bridge ?? 0x72543b
  const bridge = textured(
    'generated-bridge',
    bridgeBase,
    'wood',
    5,
    2,
    {
      roughness: 0.86,
    },
  )
  const structureBase = palette.structure ?? 0x85817a
  const structure = createZoneMaterialRecord((zone) => {
    const color = mixColor(
      structureBase,
      secondaryColors[zone],
      zone === 'palace' || zone === 'fort' ? 0.2 : 0.32,
    )
    return textured(
      `generated-structure-${zone}`,
      color,
      structurePatterns[zone],
      5,
      4,
      {
        roughness: 0.9,
      },
    )
  })
  const roofBase = palette.roof ?? 0x4b3940
  const roof = createZoneMaterialRecord((zone) => {
    const color = mixColor(roofBase, accentColors[zone], 0.32)
    return textured(
      `generated-roof-${zone}`,
      color,
      roofPatterns[zone],
      5,
      4,
      {
        roughness: 0.82,
      },
    )
  })
  const trunk = textured(
    'generated-tree-bark',
    shadeColor(bridgeBase, -0.12),
    'wood',
    2,
    5,
    {
      roughness: 0.95,
    },
  )
  const groundCover = createZoneMaterialRecord((zone) =>
    standard({
      color: mixColor(terrainColors[zone], secondaryColors[zone], 0.58),
      flatShading: true,
      roughness: 1,
      side: THREE.DoubleSide,
    }),
  )
  return {
    terrain,
    secondary,
    accent,
    road,
    water,
    bridge,
    structure,
    roof,
    trunk,
    groundCover,
    all,
    textures,
  }
}

function createZoneMaterialRecord<T>(
  create: (zone: ZoneId) => T,
): Record<ZoneId, T> {
  return {
    neutral: create('neutral'),
    palace: create('palace'),
    forest: create('forest'),
    fort: create('fort'),
  }
}

function normalizeStyle(options: GeneratedWorldRuntimeOptions): RuntimeStyle {
  return {
    terrainResolution: Math.max(
      4,
      Math.min(64, Math.floor(finiteOr(options.terrainResolution, 16))),
    ),
    roadWidth: positiveOr(options.roadWidth, 4.5),
    riverWidth: positiveOr(options.riverWidth, 10),
    bridgeWidth: positiveOr(options.bridgeWidth, 6),
    decorationDensity: normalizeDecorationDensity(options.decorationDensity),
    castShadows: options.castShadows === true,
  }
}

function directionBetween(
  region: RegionBlueprint,
  other: RegionBlueprint,
): 'east' | 'north' | 'south' | 'west' | undefined {
  const dx = other.coordinate.x - region.coordinate.x
  const dz = other.coordinate.y - region.coordinate.y
  if (dx === 1 && dz === 0) return 'east'
  if (dx === -1 && dz === 0) return 'west'
  if (dx === 0 && dz === 1) return 'south'
  if (dx === 0 && dz === -1) return 'north'
  return undefined
}

function edgeCenter(
  bounds: Bounds2D,
  direction: string,
): Point2 {
  const center = boundsCenter(bounds)
  if (direction === 'east') return { x: bounds.maxX, z: center.z }
  if (direction === 'west') return { x: bounds.minX, z: center.z }
  if (direction === 'north') return { x: center.x, z: bounds.minZ }
  return { x: center.x, z: bounds.maxZ }
}

function boundsCenter(bounds: Bounds2D): Point2 {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  }
}

function dressingGeometry(zone: ZoneId): THREE.BufferGeometry {
  if (zone === 'forest') return forestTreeGeometry()
  if (zone === 'palace') {
    return new THREE.CylinderGeometry(0.45, 0.62, 2.8, 6)
  }
  if (zone === 'fort') return new THREE.DodecahedronGeometry(1.15, 0)
  return new THREE.ConeGeometry(0.55, 1.35, 5)
}

function dressingMaterial(
  zone: ZoneId,
  materials: SharedMaterials,
): THREE.Material | THREE.Material[] {
  if (zone === 'forest') {
    return [
      materials.trunk,
      materials.secondary.forest,
      materials.secondary.forest,
      materials.secondary.forest,
    ]
  }
  return materials.secondary[zone]
}

function forestTreeGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.CylinderGeometry(0.32, 0.58, 4.2, 7),
    new THREE.ConeGeometry(1.75, 3.4, 8).translate(0, 1.6, 0),
    new THREE.ConeGeometry(1.35, 3, 8).translate(0, 3, 0),
    new THREE.ConeGeometry(0.9, 2.4, 8).translate(0, 4.2, 0),
  ]
  const geometry = mergeGeometries(parts, true)
  parts.forEach((part) => part.dispose())
  if (!geometry) {
    throw new Error('Could not build generated forest tree geometry')
  }
  geometry.computeVertexNormals()
  return geometry
}

function dressingBaseHeight(zone: ZoneId): number {
  if (zone === 'forest') return 2.1
  if (zone === 'palace') return 1.4
  if (zone === 'fort') return 0.75
  return 0.68
}

type GroundCoverKind = 'fern' | 'flower' | 'grass' | 'pebble'

interface GroundCoverPlacement {
  x: number
  z: number
  rotation: number
  width: number
  height: number
}

const GROUND_COVER_KINDS: readonly GroundCoverKind[] = [
  'grass',
  'fern',
  'flower',
  'pebble',
]

const GROUND_COVER_COUNTS: Record<
  ZoneId,
  Record<GroundCoverKind, number>
> = {
  neutral: { grass: 260, fern: 0, flower: 36, pebble: 18 },
  palace: { grass: 45, fern: 0, flower: 0, pebble: 35 },
  forest: { grass: 420, fern: 90, flower: 28, pebble: 12 },
  fort: { grass: 70, fern: 0, flower: 0, pebble: 120 },
}

function groundCoverGeometry(kind: GroundCoverKind): THREE.BufferGeometry {
  if (kind === 'grass') {
    return new THREE.ConeGeometry(0.08, 0.62, 3).translate(0, 0.31, 0)
  }
  if (kind === 'fern') return fernGeometry()
  if (kind === 'flower') return flowerGeometry()
  return new THREE.DodecahedronGeometry(0.2, 0)
}

function fernGeometry(): THREE.BufferGeometry {
  const vertices: number[] = []
  for (let frond = 0; frond < 4; frond += 1) {
    const angle = (frond / 4) * Math.PI * 2
    const outwardX = Math.sin(angle)
    const outwardZ = Math.cos(angle)
    const sideX = Math.cos(angle)
    const sideZ = -Math.sin(angle)
    const point = (
      side: number,
      outward: number,
      y: number,
    ): [number, number, number] => [
      sideX * side + outwardX * outward,
      y,
      sideZ * side + outwardZ * outward,
    ]
    const baseLeft = point(-0.025, 0, 0)
    const baseRight = point(0.025, 0, 0)
    const middleLeft = point(-0.1, 0.18, 0.34)
    const middleRight = point(0.1, 0.18, 0.34)
    const tip = point(0, 0.4, 0.62)
    vertices.push(
      ...baseLeft,
      ...baseRight,
      ...middleRight,
      ...baseLeft,
      ...middleRight,
      ...middleLeft,
      ...middleLeft,
      ...middleRight,
      ...tip,
    )
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  )
  geometry.computeVertexNormals()
  return geometry
}

function flowerGeometry(): THREE.BufferGeometry {
  const stemSource = new THREE.CylinderGeometry(
    0.025,
    0.035,
    0.52,
    5,
  ).translate(0, 0.26, 0)
  const bloomSource = new THREE.OctahedronGeometry(0.12, 0).translate(
    0,
    0.6,
    0,
  )
  const stem = stemSource.toNonIndexed()
  const bloom = bloomSource.index ? bloomSource.toNonIndexed() : bloomSource
  stemSource.dispose()
  if (bloom !== bloomSource) bloomSource.dispose()
  const geometry = mergeGeometries([stem, bloom])
  stem.dispose()
  bloom.dispose()
  if (!geometry) {
    throw new Error('Could not build generated flower geometry')
  }
  return geometry
}

function writeGroundCoverScale(
  kind: GroundCoverKind,
  zone: ZoneId,
  placement: GroundCoverPlacement,
  target: THREE.Vector3,
): void {
  if (kind === 'grass') {
    const zoneScale: Record<ZoneId, number> = {
      neutral: 1,
      palace: 0.62,
      forest: 1.18,
      fort: 0.7,
    }
    const width = zoneScale[zone] * lerp(0.72, 1.35, placement.width)
    const height = zoneScale[zone] * lerp(0.72, 1.58, placement.height)
    target.set(width, height, width)
    return
  }
  if (kind === 'fern') {
    const width = lerp(0.76, 1.4, placement.width)
    target.set(width, lerp(0.82, 1.5, placement.height), width)
    return
  }
  if (kind === 'flower') {
    const width = lerp(0.8, 1.25, placement.width)
    target.set(width, lerp(0.82, 1.35, placement.height), width)
    return
  }
  target.set(
    lerp(0.55, 1.6, placement.width),
    lerp(0.35, 0.9, placement.height),
    lerp(0.55, 1.45, 1 - placement.width),
  )
}

function shadeColor(
  color: THREE.ColorRepresentation,
  amount: number,
): THREE.Color {
  const target = amount >= 0 ? new THREE.Color(0xffffff) : new THREE.Color(0x08090b)
  return new THREE.Color(color).lerp(target, Math.abs(clamp(amount, -1, 1)))
}

function mixColor(
  first: THREE.ColorRepresentation,
  second: THREE.ColorRepresentation,
  amount: number,
): THREE.Color {
  return new THREE.Color(first).lerp(new THREE.Color(second), clamp(amount, 0, 1))
}

function isStructuralDressing(zone: ZoneId, index: number): boolean {
  return (
    (zone === 'forest' && index % 4 === 0) ||
    (zone === 'fort' && index % 7 === 0)
  )
}

function normalizeDecorationDensity(value: number | undefined): number {
  return clamp(finiteOr(value, 1), 0, 1)
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

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

export const GENERATED_WORLD_ZONE_IDS = ZONE_IDS
