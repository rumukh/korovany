import * as THREE from 'three'
import {
  StylizedArtLibrary,
  clearLod,
  createLod,
  hashUnit,
  transformParts,
  type OutlineBinding,
  type OutlineKind,
  type PropPart,
  type PropSurface,
} from '../art/index.ts'
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
  composeSiteLayout,
  type SiteLayout,
} from './SiteComposition.ts'
import {
  TerrainSystem,
  type Bounds2D,
  type NormalizedRegion,
  type Point2,
  type Point3,
} from './TerrainSystem.ts'
import {
  WorldPropLibrary,
  sitePropSurfaces,
  type PropAsset,
  type PropRequest,
} from './WorldPropLibrary.ts'
import type {
  GeneratedWorldRuntime as GeneratedWorldRuntimeContract,
  WorldMarker,
  WorldRuntimeUpdate,
} from './WorldRuntime.ts'
import { WORLD_FACTIONS } from './worldTypes.ts'
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
  /** Blended into the ground-cover tint so foliage sits inside its biome. */
  secondary?: Partial<Record<ZoneId, THREE.ColorRepresentation>>
  road?: THREE.ColorRepresentation
  water?: THREE.ColorRepresentation
}

export interface GeneratedWorldRuntimeOptions {
  palette?: GeneratedWorldPalette
  terrainResolution?: number
  roadWidth?: number
  riverWidth?: number
  bridgeWidth?: number
  decorationDensity?: number
  castShadows?: boolean
  /**
   * The engine's art library, so world surfaces share the game's one material
   * family. When omitted the runtime builds and disposes its own, which is what
   * keeps the Node tests working without a renderer.
   */
  art?: StylizedArtLibrary
  /** Ink silhouettes on structural dressing. Off by default. */
  outlineDressing?: boolean
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
  /** Extra draws per frame this region charged itself for ink outlines. */
  inkDraws: number
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
  outlineDressing: boolean
}

interface SharedMaterials {
  terrain: Record<ZoneId, THREE.MeshStandardMaterial>
  road: THREE.MeshStandardMaterial
  water: THREE.MeshStandardMaterial
  /**
   * The prop family. Every world object built by `PropKit` bakes its colour into
   * the vertices, so one material per *surface* covers the whole world instead of
   * one per biome, per prop or — worst of all — per mesh.
   */
  prop: THREE.MeshStandardMaterial
  propFoliage: THREE.MeshStandardMaterial
  propCloth: THREE.MeshStandardMaterial
  propGlow: THREE.MeshStandardMaterial
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
  art: StylizedArtLibrary
  props: WorldPropLibrary
  style: RuntimeStyle
  onDisposed: (regionId: RegionId) => void
}

const ZONE_IDS: readonly ZoneId[] = ['neutral', 'palace', 'forest', 'fort']

/**
 * Ink draws a visible region may spend, from `docs/08-graphics-foundation-spec.md`.
 *
 * Before this pass exactly one was used — the structural dressing mesh — and the
 * other seven sat idle. They are spent here on the silhouettes that carry a frame:
 * settlement buildings, the props around them, and the tallest tree species.
 */
const OUTLINE_WORLD_DRAWS_MAX = 8

/**
 * How many of those a single site may take, so the trees are never starved.
 *
 * Counted in draws, and a composed site is worth more than one: its tallest
 * building is an LOD over several surface meshes and the ink shells all of them.
 * Four buys the roofline and the clutter around it and still leaves half the
 * region's budget for vegetation.
 */
const OUTLINE_SITE_DRAWS_MAX = 4

/** Camera distance at which a building swaps to its cheap level. */
const BUILDING_LOD_DISTANCE = 46

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
  private readonly art: StylizedArtLibrary
  /** Shared, reference-counted prop geometry for every streamed region. */
  private readonly props: WorldPropLibrary
  /** True when this runtime built its own library and therefore has to free it. */
  private readonly ownsArt: boolean
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
    this.ownsArt = options.art === undefined
    this.art = options.art ?? createDefaultArtLibrary()
    this.materials = createSharedMaterials(this.art, options.palette)
    this.props = new WorldPropLibrary()
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
          art: this.art,
          props: this.props,
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

  /** Live shared prop geometry entries. Exposed for the streaming budget test. */
  get propCacheSize(): number {
    return this.props.size
  }

  /** Entries the prop cache is holding only so a returning region can reuse them. */
  get retainedPropCount(): number {
    return this.props.retainedCount
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
    return this.walkableNear(x, z)
  }

  /**
   * The nearest position an actor can actually stand, starting from the given point.
   *
   * `GameEngine` writes `getStartPosition` verbatim into the player's position on a
   * fresh run, and `NavigationSystem.findPath` returns `null` when the **start** is
   * unwalkable — so a prop standing on this point silently swallows the first
   * click-to-move of the run, and every AI path request from it, until the player
   * nudges out with direct input.
   *
   * The spawn is deliberately offset about twenty units back along the critical path,
   * which places it *outside* the site clearing, so none of the road, river or clearing
   * keep-outs protect it. Snapping here rather than adding a fourth keep-out covers any
   * prop that ever lands on it, not only the decoration that did.
   *
   * Returns the input untouched when it is already clear — which is the overwhelmingly
   * common case — so this changes no position that was not already broken. The search
   * is a fixed outward spiral, so it is deterministic.
   */
  private walkableNear(x: number, z: number): Point3 {
    const radius = 0.45
    if (this.collision.isWalkablePosition(x, z, radius)) {
      return { x, y: this.sampleHeight(x, z), z }
    }
    for (let ring = 1; ring <= 8; ring += 1) {
      const distance = ring * 0.5
      for (let step = 0; step < 12; step += 1) {
        const angle = (step / 12) * Math.PI * 2
        const candidateX = x + Math.cos(angle) * distance
        const candidateZ = z + Math.sin(angle) * distance
        if (this.collision.isWalkablePosition(candidateX, candidateZ, radius)) {
          return {
            x: candidateX,
            y: this.sampleHeight(candidateX, candidateZ),
            z: candidateZ,
          }
        }
      }
    }
    // Nothing clear within four units: the caller is better off with the designed
    // position than with a point pushed somewhere arbitrary.
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

  /**
   * Turns world ink on or off at runtime.
   *
   * Mutating `style` is what makes regions streamed in later agree with regions
   * already on screen — they read the same record when they build their dressing.
   */
  setOutlineDressing(enabled: boolean): void {
    if (this.disposed) return
    if (this.style.outlineDressing === enabled) return
    this.style.outlineDressing = enabled
    for (const runtime of this.sceneRegions.values()) {
      runtime.setOutlineDressing(enabled)
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
    // The prop cache goes last of the geometry owners: every region has already
    // released its references by now, so this only frees what a partially torn-down
    // region would otherwise strand.
    try {
      this.props.dispose()
    } catch (error) {
      errors.push(error)
    }
    if (this.ownsArt) {
      try {
        this.art.dispose()
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
  /** Geometry this region built for itself and must dispose. */
  private readonly geometries = new Set<THREE.BufferGeometry>()
  /** Shared geometry this region borrowed and must release, never dispose. */
  private readonly propAssets: PropAsset[] = []
  private readonly lods: THREE.LOD[] = []
  private readonly outlines: OutlineBinding[] = []
  private readonly siteClearings: Array<{ x: number; z: number; radius: number }> = []
  private readonly cosmeticDressing: Array<{
    mesh: THREE.InstancedMesh
    maximumCount: number
  }> = []
  private structuralDecorationCount = 0
  private maxCosmeticDecorationCount = 0
  /**
   * Every object whose ink can be toggled at runtime, with the kind it was inked
   * with. Kept so the display setting can add the shells back without rebuilding a
   * region's dressing. None of these are owned here.
   */
  private readonly inkable: Array<{ object: THREE.Object3D; kind: OutlineKind }> = []
  private inkBudget = OUTLINE_WORLD_DRAWS_MAX
  private siteInkSpent = 0
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

  /**
   * Adds or removes this region's ink without rebuilding anything.
   *
   * The list of inkable objects and the budget already spent are decided at build
   * time, so a toggle replays exactly the same choices — a region that only had ink
   * for its trees does not quietly acquire an outlined stronghold on the way back.
   */
  setOutlineDressing(enabled: boolean): void {
    if (this.resourcesDisposed) return
    if (enabled) {
      if (this.outlines.length > 0) return
      for (const entry of this.inkable) {
        this.outlines.push(
          this.context.art.applyOutline(entry.object, entry.kind, {
            instanced: entry.object instanceof THREE.InstancedMesh,
          }),
        )
      }
      return
    }
    for (const binding of this.outlines) {
      this.context.art.releaseOutline(binding)
    }
    this.outlines.length = 0
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
      inkDraws: OUTLINE_WORLD_DRAWS_MAX - this.inkBudget,
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
    // Sites come before dressing so a settlement can claim its clearing, and before
    // the ink budget is spent, because a village is the most valuable silhouette in
    // any frame that contains one.
    this.createSites()
    this.createBridges()
    this.createRoadDressing()
    this.createRiverDressing()
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
    const span = this.context.style.riverWidth + 4
    const width = this.context.style.bridgeWidth
    for (let index = 0; index < bridges.length; index += 1) {
      const bridge = bridges[index]
      const group = new THREE.Group()
      group.name = `bridge:${bridge.id}`
      group.userData.generatedBridgeId = bridge.id
      const y = this.context.terrain.sampleHeight(center.x, center.z)
      group.position.set(center.x, y + index * 0.025, center.z)
      this.root.add(group)

      // A crossing is a landmark and a choke point, so it gets a real LOD: a planked,
      // trestled, railed deck up close and a five-plank version once it is a shape on
      // the horizon. It is a unique mesh, which is the only kind `createLod` is for.
      const near = this.acquireProp({
        kind: 'bridge',
        biome: this.blueprint.biome,
        owner: this.blueprint.territory,
        span,
        width,
        detail: 'near',
      })
      const far = this.acquireProp({
        kind: 'bridge',
        biome: this.blueprint.biome,
        owner: this.blueprint.territory,
        span,
        width,
        detail: 'far',
      })
      const lod = createLod({
        levels: [
          { geometry: near.surfaces[0].geometry, distance: 0 },
          { geometry: far.surfaces[0].geometry, distance: BUILDING_LOD_DISTANCE * 1.6 },
        ],
        material: this.context.materials.prop,
        castShadow: this.context.style.castShadows,
        receiveShadow: true,
        name: `bridge-deck:${bridge.id}`,
      })
      group.add(lod)
      this.lods.push(lod)
      this.tryOutline(lod, 'landmark')
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
    // Per *site*, not per region: the sub-budget exists so one site cannot starve the
    // trees, not so the first site can starve the second. The region-wide `inkBudget`
    // is still the hard cap either way.
    this.siteInkSpent = 0

    const layout = composeSiteLayout({
      siteId: site.id,
      kind: site.kind,
      owner: site.owner,
      biome: this.blueprint.biome,
      seed: this.context.blueprint.seed,
    })
    this.addSiteLayout(group, site, layout, { x, y, z, rotation })
    // Dressing and ground cover both read this, so a village square stays a square
    // instead of growing a forest through the well.
    this.siteClearings.push({ x, z, radius: layout.clearingRadius })
    this.runtime.ownProp(site.id)
    this.runtime.ownMarker(`site:${site.id}`)
  }

  /**
   * Turns a composed layout into meshes.
   *
   * Three shapes of geometry come out of a site and each is handled differently:
   * buildings are unique, expensive and worth a real LOD; fences repeat, so they are
   * instanced; everything else is small and merges into one mesh per surface, which
   * is what keeps a village at four draw calls instead of forty.
   */
  private addSiteLayout(
    group: THREE.Group,
    site: WorldSite,
    layout: SiteLayout,
    origin: { x: number; y: number; z: number; rotation: number },
  ): void {
    const biome = this.blueprint.biome
    const owner = site.owner
    const cos = Math.cos(origin.rotation)
    const sin = Math.sin(origin.rotation)
    const toWorld = (localX: number, localZ: number): Point2 => ({
      x: origin.x + localX * cos + localZ * sin,
      z: origin.z - localX * sin + localZ * cos,
    })
    const groundAt = (localX: number, localZ: number): number => {
      const world = toWorld(localX, localZ)
      return this.context.terrain.sampleHeight(world.x, world.z) - origin.y
    }

    let tallest: THREE.Object3D | null = null
    let tallestHeight = 0

    for (const placement of layout.buildings) {
      const request = {
        kind: 'building',
        spec: placement.spec,
        biome,
        owner,
      } as const
      const near = this.acquireProp({ ...request, detail: 'near' })
      const far = this.acquireProp({ ...request, detail: 'far' })
      const buildingGroup = new THREE.Group()
      buildingGroup.name = `site-building:${site.id}:${placement.id}`
      buildingGroup.position.set(
        placement.x,
        groundAt(placement.x, placement.z),
        placement.z,
      )
      buildingGroup.rotation.y = placement.rotation
      const lod = createLod({
        levels: [
          { geometry: near.surfaces[0].geometry, distance: 0 },
          { geometry: far.surfaces[0].geometry, distance: BUILDING_LOD_DISTANCE },
        ],
        material: this.context.materials.prop,
        castShadow: this.context.style.castShadows,
        receiveShadow: true,
        name: `site-body:${site.id}:${placement.id}`,
      })
      buildingGroup.add(lod)
      this.lods.push(lod)
      const glow = near.surfaces.find((entry) => entry.surface === 'glow')
      if (glow) {
        const windows = new THREE.Mesh(glow.geometry, this.context.materials.propGlow)
        windows.name = `site-windows:${site.id}:${placement.id}`
        windows.castShadow = false
        windows.receiveShadow = false
        windows.userData.noComicOutline = true
        // Parented to the *near* level, not to the building group. The far level has
        // no openings, so a sibling glow mesh would leave lit windows hanging in the
        // air once the LOD swapped.
        lod.levels[0].object.add(windows)
      }
      group.add(buildingGroup)

      const storeyHeight = placement.spec.wallHeight * placement.spec.storeys
      if (storeyHeight > tallestHeight) {
        tallestHeight = storeyHeight
        tallest = lod
      }
      if (placement.radius > 0) {
        const world = toWorld(placement.x, placement.z)
        const colliderId = `site-building:${site.id}:${placement.id}`
        this.context.collision.registerCircle({
          id: colliderId,
          regionId: this.id,
          x: world.x,
          z: world.z,
          radius: placement.radius,
          tags: ['site', site.kind, 'building'],
        })
        this.runtime.ownCollider(colliderId)
      }
    }

    // Fences repeat by construction — a perimeter is the same panel eight times — so
    // they are the one part of a site that earns an instanced mesh.
    const fenceBatches = new Map<
      string,
      { asset: PropAsset; placements: typeof layout.fences }
    >()
    for (const placement of layout.fences) {
      const asset = this.acquireProp({
        kind: 'fence',
        style: placement.style,
        biome,
        owner,
        length: placement.length,
      })
      const batch = fenceBatches.get(asset.key)
      if (batch) batch.placements.push(placement)
      else fenceBatches.set(asset.key, { asset, placements: [placement] })
    }
    let fenceIndex = 0
    for (const batch of [...fenceBatches.values()]) {
      const mesh = new THREE.InstancedMesh(
        batch.asset.surfaces[0].geometry,
        this.context.materials.prop,
        batch.placements.length,
      )
      mesh.name = `site-fence:${site.id}:${String(fenceIndex)}`
      fenceIndex += 1
      mesh.castShadow = this.context.style.castShadows
      mesh.receiveShadow = true
      const matrix = new THREE.Matrix4()
      const quaternion = new THREE.Quaternion()
      const scale = new THREE.Vector3(1, 1, 1)
      const position = new THREE.Vector3()
      const up = new THREE.Vector3(0, 1, 0)
      for (let index = 0; index < batch.placements.length; index += 1) {
        const placement = batch.placements[index]
        quaternion.setFromAxisAngle(up, placement.rotation)
        position.set(
          placement.x,
          groundAt(placement.x, placement.z) - 0.06,
          placement.z,
        )
        matrix.compose(position, quaternion, scale)
        mesh.setMatrixAt(index, matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      group.add(mesh)
    }

    // Everything else — the well, the stalls, the crates, the banners, the braziers —
    // is composed once per site and shared by every later load of this region. A
    // settlement is the most expensive thing a streamed region builds, and the player
    // crosses the same boundary in both directions constantly.
    let propsMesh: THREE.Mesh | null = null
    if (layout.props.length > 0) {
      const asset = this.acquireComposite(
        `site-props:${site.id}`,
        sitePropSurfaces(layout.props.map((placement) => placement.kind)),
        () => {
          const parts: PropPart[] = []
          for (const placement of layout.props) {
            const built = this.context.props.build({
              kind: 'siteProp',
              prop: placement.kind,
              biome,
              owner,
              variant: placement.variant,
              ...(placement.length === undefined ? {} : { length: placement.length }),
            })
            transformParts(built, {
              position: {
                x: placement.x,
                y: groundAt(placement.x, placement.z),
                z: placement.z,
              },
              rotation: { x: 0, y: placement.rotation, z: 0 },
              scale: placement.scale,
            })
            parts.push(...built)
          }
          return parts
        },
      )
      for (const entry of asset.surfaces) {
        const mesh = new THREE.Mesh(
          entry.geometry,
          this.propSurfaceMaterial(entry.surface),
        )
        mesh.name = `site-props:${site.id}:${entry.surface}`
        mesh.castShadow =
          entry.surface !== 'glow' && this.context.style.castShadows
        mesh.receiveShadow = entry.surface !== 'glow'
        if (entry.surface === 'glow') mesh.userData.noComicOutline = true
        if (entry.surface === 'hard') propsMesh = mesh
        group.add(mesh)
      }
    }
    for (const placement of layout.props) {
      if (placement.radius < 0.5) continue
      const world = toWorld(placement.x, placement.z)
      const colliderId = `site-prop:${site.id}:${placement.id}`
      this.context.collision.registerCircle({
        id: colliderId,
        regionId: this.id,
        x: world.x,
        z: world.z,
        radius: placement.radius * placement.scale,
        tags: ['site', site.kind, 'prop'],
      })
      this.runtime.ownCollider(colliderId)
    }

    // Two ink draws per site at most: the tallest roofline and the clutter around it.
    // Those are the two shapes that tell a player at a distance that this is a place.
    if (tallest) this.trySiteOutline(tallest)
    if (propsMesh) this.trySiteOutline(propsMesh)
  }

  /**
   * Vegetation, undergrowth and rock, instanced per kind.
   *
   * A region used to draw one prop repeated at three scales, which is why a forest
   * read as wallpaper. It now draws up to six kinds from a per-biome plan: the tall
   * species that sets the skyline, a second and third canopy shape, undergrowth that
   * fills the middle distance, and rock that gives the ground somewhere to break.
   */
  private createDressing(): void {
    const biome = this.blueprint.biome
    const profile = BIOME_PROFILES[biome]
    const maximumCount = Math.max(
      0,
      Math.floor(10 + profile.foliageDensity * 26 + profile.decorationDensity * 10),
    )
    if (maximumCount === 0) return
    const buckets = dressingPlan(biome)
    if (buckets.length === 0) return

    const bounds = this.context.normalizedRegion.bounds
    const center = boundsCenter(bounds)
    const stream = new RandomStream(
      deriveSeed(
        this.context.blueprint.seed,
        `region-dressing:${String(this.id)}`,
      ),
    )
    const jitterSeed = deriveSeed(
      this.context.blueprint.seed,
      `region-dressing-kind:${String(this.id)}`,
    )
    const placements: DressingPlacement[] = []
    const margin = 6
    const attempts = maximumCount * 10
    for (
      let attempt = 0;
      attempt < attempts && placements.length < maximumCount;
      attempt += 1
    ) {
      const x = stream.range(bounds.minX + margin, bounds.maxX - margin)
      const z = stream.range(bounds.minZ + margin, bounds.maxZ - margin)
      const scale = stream.range(0.72, 1.42)
      const rotation = stream.range(0, Math.PI * 2)
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
      if (this.isInsideSiteClearing(x, z)) continue
      placements.push({ index: placements.length, x, z, scale, rotation })
    }
    if (placements.length === 0) return

    // Which kind a placement gets is a hash of its index, not another draw from the
    // stream: the placement list stays byte-identical to what a single-species build
    // would have produced, so decoration density and collision are unchanged.
    const totalWeight = buckets.reduce((total, bucket) => total + bucket.weight, 0)
    const grouped = buckets.map(() => [] as DressingPlacement[])
    for (const placement of placements) {
      let roll = hashUnit(placement.index, jitterSeed) * totalWeight
      let chosen = buckets.length - 1
      for (let index = 0; index < buckets.length; index += 1) {
        roll -= buckets[index].weight
        if (roll <= 0) {
          chosen = index
          break
        }
      }
      grouped[chosen].push(placement)
    }

    let primaryStructural = true
    const spawnAnchors = this.spawnKeepOutPoints()
    for (let index = 0; index < buckets.length; index += 1) {
      const bucket = buckets[index]
      // A colliding decoration standing on a spawn point traps whatever spawns there.
      // Drop the placement rather than the collider, so there is no invisible boulder
      // and no visible one you can walk through. Only structural buckets collide, so
      // only they need filtering.
      const entries = bucket.structural
        ? grouped[index].filter(
            (placement) =>
              !this.blocksSpawn(
                placement,
                bucket.colliderRadius * placement.scale,
                spawnAnchors,
              ),
          )
        : grouped[index]
      if (entries.length === 0) continue
      const asset = this.acquireProp(bucket.request)
      const name = bucket.structural
        ? primaryStructural
          ? `dressing-structural:${String(this.id)}`
          : `dressing-structural:${String(this.id)}:${bucket.id}`
        : `dressing-cosmetic:${bucket.id}:${String(this.id)}`
      const mesh = this.createDressingMesh(bucket, asset, entries, name)
      this.root.add(mesh)
      this.runtime.ownProp(name)

      if (bucket.ink) {
        // One instanced shell sharing the source matrix buffer inks an entire
        // region's worth of trees for a single extra draw call. The shell is a child
        // of its source and tracks its `count`, so the decoration slider thins the
        // ink along with the trees.
        this.tryOutline(mesh, 'landmark', { instanced: true })
      }

      if (bucket.structural) {
        this.structuralDecorationCount += entries.length
        if (primaryStructural) primaryStructural = false
        for (const placement of entries) {
          const colliderId = `dressing-solid:${String(this.id)}:${String(placement.index)}`
          this.context.collision.registerCircle({
            id: colliderId,
            regionId: this.id,
            x: placement.x,
            z: placement.z,
            radius: bucket.colliderRadius * placement.scale,
            tags: ['decoration', biome],
          })
          this.runtime.ownCollider(colliderId)
        }
      } else {
        this.registerCosmeticDressing(mesh, entries.length)
      }
    }
  }

  /**
   * Encounter actor positions in this region, which decoration must not stand on.
   *
   * **Encounter actors only.** Faction starts are protected by a different mechanism —
   * `getStartPosition` snaps through `walkableNear` — and deliberately so: this runs
   * *during* collider registration, so computing a start position here would query a
   * collision world that is still half-built and make the result depend on bucket
   * order. The two mechanisms cover the two cases; neither covers both.
   *
   * That distinction is written out because the previous version of this comment
   * claimed both, which is the documentation form of the fault this file's spec
   * catalogues: a statement of coverage that nothing checks and that happened to be
   * false. The measured result is what matters and it is unaffected — faction starts
   * blocked went 1/180 to 0/180 — but the reason was the snap, not this.
   *
   * Encounter actors are positioned by world generation, which knows nothing about
   * decoration. Before this pass every decoration collider was a sapling-sized 0.55 and
   * the overlap went unnoticed; a fort boulder is 0.85, which is correct for a boulder
   * and enough to trap a spawn.
   *
   * Shrinking the boulder back is not the fix — at 0.55 the same spawn cleared by 0.012
   * units, so the old result was luck rather than safety. A reviewer's field survey of
   * 180 starts puts 1 blocked, 2 in a 0.25-1 unit band and 61 comfortable or clear, so
   * the mechanism was unguarded rather than the radii being systematically wrong.
   */
  private spawnKeepOutPoints(): readonly { x: number; z: number }[] {
    const points: { x: number; z: number }[] = []
    for (const faction of WORLD_FACTIONS) {
      for (const slot of this.context.blueprint.encounters) {
        if (slot.regionId !== this.id) continue
        const plan = createGeneratedEncounterPlan(
          this.context.blueprint,
          slot,
          faction,
        )
        for (const spawn of plan.spawns) {
          points.push({ x: spawn.worldX, z: spawn.worldZ })
        }
      }
    }
    return points
  }

  /** True when a decoration of this radius would stop an actor standing on a spawn. */
  private blocksSpawn(
    placement: DressingPlacement,
    radius: number,
    anchors: readonly { x: number; z: number }[],
  ): boolean {
    // The agent radius the collision world is queried with, plus a little daylight so a
    // spawn is comfortably clear rather than clear by twelve thousandths.
    const clearance = radius + 0.45 + 0.2
    for (const anchor of anchors) {
      if (Math.hypot(placement.x - anchor.x, placement.z - anchor.z) < clearance) {
        return true
      }
    }
    return false
  }

  private createDressingMesh(
    placement: DressingPlacementStyle,
    asset: PropAsset,
    entries: readonly DressingPlacement[],
    name: string,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(
      asset.surfaces[0].geometry,
      this.propSurfaceMaterial(asset.surfaces[0].surface),
      entries.length,
    )
    mesh.name = name
    mesh.userData.generatedDressingRegionId = this.id
    mesh.castShadow = this.context.style.castShadows
    mesh.receiveShadow = true
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const position = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      quaternion.setFromAxisAngle(up, entry.rotation)
      const uniform = entry.scale * placement.scale
      const vertical = uniform * placement.verticalStretch
      scale.set(uniform, vertical, uniform)
      position.set(
        entry.x,
        this.context.terrain.sampleHeight(entry.x, entry.z) +
          placement.baseLift * vertical,
        entry.z,
      )
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(index, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    return mesh
  }

  /** A waystone where roads meet, and rock along the verge. */
  private createRoadDressing(): void {
    const bounds = this.context.normalizedRegion.bounds
    const center = boundsCenter(bounds)
    if (this.siteClearings.some((clearing) => clearing.radius > 0)) return
    if (!this.hasRoad()) return
    const offset = this.context.style.roadWidth / 2 + 1.6
    const asset = this.acquireComposite(
      `road-props:${String(this.id)}`,
      ['hard'],
      () => {
        const waystone = this.context.props.build({
          kind: 'siteProp',
          prop: 'waystone',
          biome: this.blueprint.biome,
          owner: this.blueprint.territory,
          variant: 0,
        })
        transformParts(waystone, {
          position: {
            x: center.x + offset,
            y: this.context.terrain.sampleHeight(center.x + offset, center.z + offset),
            z: center.z + offset,
          },
          rotation: { x: 0, y: hashUnit(1, this.regionSeed()) * Math.PI * 2, z: 0 },
        })
        return waystone
      },
    )
    for (const entry of asset.surfaces) {
      const mesh = new THREE.Mesh(
        entry.geometry,
        this.propSurfaceMaterial(entry.surface),
      )
      mesh.name = `road-dressing:${String(this.id)}:${entry.surface}`
      mesh.castShadow = this.context.style.castShadows
      mesh.receiveShadow = true
      this.root.add(mesh)
      this.runtime.ownProp(mesh.name)
    }
  }

  /** Reeds along both banks, instanced and density-scaled. */
  private createRiverDressing(): void {
    if (!this.context.blueprint.river.regionPath.includes(this.id)) return
    const bounds = this.context.normalizedRegion.bounds
    const center = boundsCenter(bounds)
    const stream = new RandomStream(
      deriveSeed(
        this.context.blueprint.seed,
        `region-river-dressing:${String(this.id)}`,
      ),
    )
    const half = this.context.style.riverWidth / 2
    const placements: DressingPlacement[] = []
    const attempts = 96
    for (let attempt = 0; attempt < attempts && placements.length < 42; attempt += 1) {
      const side = attempt % 2 === 0 ? -1 : 1
      const x = center.x + side * stream.range(half - 0.6, half + 2.4)
      const z = stream.range(bounds.minZ + 1, bounds.maxZ - 1)
      if (this.isInsideSiteClearing(x, z)) continue
      placements.push({
        index: placements.length,
        x,
        z,
        scale: stream.range(0.7, 1.35),
        rotation: stream.range(0, Math.PI * 2),
      })
    }
    if (placements.length === 0) return
    const asset = this.acquireProp({ kind: 'reeds', biome: this.blueprint.biome })
    const name = `dressing-cosmetic:reeds:${String(this.id)}`
    const mesh = this.createDressingMesh(
      { scale: 1, verticalStretch: 1, baseLift: 0 },
      asset,
      placements,
      name,
    )
    mesh.castShadow = false
    this.root.add(mesh)
    this.registerCosmeticDressing(mesh, placements.length)
    this.runtime.ownProp(name)
  }

  private hasRoad(): boolean {
    return this.context.blueprint.roads.segments.some(
      (segment) =>
        segment.fromRegionId === this.id || segment.toRegionId === this.id,
    )
  }

  private regionSeed(): number {
    return deriveSeed(this.context.blueprint.seed, `region-prop:${String(this.id)}`)
  }

  private isInsideSiteClearing(x: number, z: number): boolean {
    return this.siteClearings.some(
      (clearing) => Math.hypot(clearing.x - x, clearing.z - z) < clearing.radius,
    )
  }

  private propSurfaceMaterial(surface: PropSurface): THREE.MeshStandardMaterial {
    if (surface === 'foliage') return this.context.materials.propFoliage
    if (surface === 'cloth') return this.context.materials.propCloth
    if (surface === 'glow') return this.context.materials.propGlow
    return this.context.materials.prop
  }

  /** Borrows shared geometry and records the reference for teardown. */
  private acquireProp(request: PropRequest): PropAsset {
    const asset = this.context.props.acquire(request)
    this.propAssets.push(asset)
    return asset
  }

  /** Borrows a shared one-off composition — a settlement, a region's road furniture. */
  private acquireComposite(
    key: string,
    surfaces: readonly PropSurface[],
    build: () => PropPart[],
  ): PropAsset {
    const asset = this.context.props.acquireComposite(key, surfaces, build)
    this.propAssets.push(asset)
    return asset
  }

  /**
   * Spends the region's ink draws on an object, if enough are left.
   *
   * The budget is a hard cap rather than a guideline because inverted-hull outlines
   * are a whole extra draw of the source geometry: eight is what the frame can pay
   * for, and a region with a stronghold, a bridge and a dense forest wants twenty.
   *
   * The charge is {@link inkDrawCost}, not one per call. Billing per call was
   * wrong by a factor of four on exactly the props the budget exists to protect —
   * a building LOD is a group of surface meshes and `applyOutline` shells every
   * one of them.
      *
      * An LOD is charged its most expensive level rather than the sum, and that rests on
      * a renderer detail worth naming: `applyOutline` traverses, so shells exist on
      * *every* level at once, and the charge is only honest if a shell under a hidden
      * level is free. It is. `WebGLRenderer.projectObject` early-`return`s on
      * `object.visible === false` rather than continuing, so it never recurses into an
      * invisible level's children; `LOD.update()` sets `visible` per level and a shell is
      * a child of its level's mesh. Exactly one level's shells are ever projected, and
      * that stays true if a level later gains meshes. Confirmed independently by review.
      */
  private tryOutline(
    object: THREE.Object3D,
    kind: OutlineKind,
    options: { instanced?: boolean } = {},
  ): boolean {
    const cost = inkDrawCost(object, options.instanced === true)
    if (cost <= 0 || cost > this.inkBudget) return false
    this.inkBudget -= cost
    // Recorded whether or not ink is on right now, so the display toggle can add the
    // shells later without re-deciding who deserved a draw.
    this.inkable.push({ object, kind })
    if (!this.context.style.outlineDressing) return true
    this.outlines.push(this.context.art.applyOutline(object, kind, options))
    return true
  }

  private trySiteOutline(object: THREE.Object3D): boolean {
    const cost = inkDrawCost(object, false)
    if (this.siteInkSpent + cost > OUTLINE_SITE_DRAWS_MAX) return false
    if (!this.tryOutline(object, 'landmark')) return false
    this.siteInkSpent += cost
    return true
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

      // Ground cover is shared across every region that uses the same biome, so a
      // grass tuft is one buffer for the whole world instead of one per region root.
      const asset = this.acquireProp({ kind: 'groundCover', biome, cover: kind })
      // All four kinds share the biome's vertex-coloured cover material: the colour
      // that distinguishes a flower from a pebble is baked into the geometry, which
      // is one material and one draw setup instead of three.
      const material = this.context.materials.groundCover[biome]
      const mesh = new THREE.InstancedMesh(
        asset.surfaces[0].geometry,
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
            (kind === 'pebble' ? 0.02 : 0.015),
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
    // Sites now claim a composed clearing rather than a fixed radius: a village with
    // a fenced perimeter needs more room than a treasure chest does.
    if (this.isInsideSiteClearing(x, z)) return false
    return this.context.terrain.isWalkableSlope(x, z)
  }

  private registerCosmeticDressing(
    mesh: THREE.InstancedMesh,
    maximumCount: number,
  ): void {
    // three.js computes an instanced bounding sphere lazily, over whatever
    // `count` happens to be at first render, and never invalidates it when the
    // count grows again. `setDecorationDensity` below immediately reduces the
    // count, so the sphere has to be taken here at full capacity — otherwise
    // raising quality later puts live instances outside a stale sphere and
    // frustum culling drops the entire batch.
    mesh.count = Math.min(maximumCount, mesh.instanceMatrix.count)
    if (!mesh.boundingSphere) mesh.computeBoundingSphere()
    this.cosmeticDressing.push({ mesh, maximumCount })
    this.maxCosmeticDecorationCount += maximumCount
    this.setDecorationDensity(this.context.style.decorationDensity)
  }

  private addProjectedStrip(
    start: Point2,
    end: Point2,
    width: number,
    material: THREE.Material,
    name: string,
    heightOffset: number,
  ): void {
    const geometry = createTerrainProjectedStripGeometry(
      this.context.terrain,
      this.context.normalizedRegion.bounds,
      this.context.style.terrainResolution,
      start,
      end,
      width,
      heightOffset,
    )
    const mesh = this.addMesh(this.root, geometry, material, name)
    mesh.receiveShadow = true
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
    // Detach the ink shells first: instanced shells share `instanceMatrix` with their
    // source, so they have to be gone before the source instanced mesh is disposed or
    // one frees the other's buffer.
    for (const binding of this.outlines) {
      try {
        this.context.art.releaseOutline(binding)
      } catch (error) {
        errors.push(error)
      }
    }
    this.outlines.length = 0
    this.inkable.length = 0
    // LOD levels reference shared cached geometry. Dropping the level meshes frees
    // nothing, by design — the cache reference below is what actually releases them.
    for (const lod of this.lods) {
      try {
        clearLod(lod)
      } catch (error) {
        errors.push(error)
      }
    }
    this.lods.length = 0
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
    // Shared props are released, never disposed: a forest tree is very likely still
    // being drawn by the two regions either side of this one.
    for (const asset of this.propAssets) {
      try {
        this.context.props.release(asset)
      } catch (error) {
        errors.push(error)
      }
    }
    this.propAssets.length = 0
    this.cosmeticDressing.length = 0
    this.siteClearings.length = 0
    this.structuralDecorationCount = 0
    this.maxCosmeticDecorationCount = 0
    this.inkBudget = OUTLINE_WORLD_DRAWS_MAX
    this.siteInkSpent = 0
    this.root.clear()
    this.context.onDisposed(this.id)
    // Marked disposed before the throw, deliberately. Every list above is already
    // emptied, so a region that failed to tear down cleanly has still given back
    // everything it held — but if the failure escaped before this line, the region
    // would stay re-enterable and a second pass would walk empty structures believing
    // it had work to do. Report the failure, but only once, and never half-disposed.
    this.resourcesDisposed = true
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Failed to release region ${String(this.id)} resources`,
      )
    }
  }
}

/**
 * Extra draws per frame an ink outline on this object would cost.
 *
 * `applyOutline` builds one shell per qualifying mesh, so a budget that counted
 * calls rather than shells under-charged precisely the props it exists to protect:
 * a building is an LOD whose near level is a group of surface meshes, and one
 * `tryOutline` on it was billed as a single draw while adding four.
 *
 * An LOD is charged its most expensive level rather than the sum, because only one
 * level is ever rendered. Billing the sum would price a building at double what it
 * draws and push the vegetation out of the budget for nothing.
 *
 * Deliberately conservative where it cannot be exact: the library also declines
 * transparent materials, which this does not model, so the estimate may run high by
 * a draw. Over-charging costs a silhouette; under-charging costs frame time, and
 * `tests/worldArt.test.ts` pins the estimate against the shells actually built.
 *
 * Exported for tests, and the export is the point. A mutation campaign replaced this
 * whole function with `return 1` and the entire suite still passed — because every
 * object *this* world outlines is a single mesh, so the recursion and the LOD rule are
 * both inert in production and the system-level assertion has no power over them. The
 * regression named above could be reintroduced silently. A cost function has to be
 * tested where its inputs can vary, which means synthetic hierarchies rather than a
 * world that happens to contain only the trivial case.
 */
export function inkDrawCost(object: THREE.Object3D, instanced: boolean): number {
  if (object instanceof THREE.LOD) {
    let worst = 0
    for (const level of object.levels) {
      worst = Math.max(worst, inkDrawCost(level.object, instanced))
    }
    return worst
  }
  let cost = takesInkShell(object, instanced) ? 1 : 0
  for (const child of object.children) cost += inkDrawCost(child, instanced)
  return cost
}

/** Mirrors the mesh filter inside `StylizedArtLibrary.applyOutline`. */
function takesInkShell(object: THREE.Object3D, instanced: boolean): boolean {
  if (!(object instanceof THREE.Mesh)) return false
  if (object instanceof THREE.InstancedMesh && !instanced) return false
  if (StylizedArtLibrary.isOutlineShell(object)) return false
  if (object.userData.noComicOutline === true) return false
  return object.name !== 'faction-ring'
}

function createDefaultArtLibrary(): StylizedArtLibrary {
  return new StylizedArtLibrary({
    ink: {
      player: 0x1b2436,
      enemy: 0x3a1420,
      interactable: 0x33280f,
      landmark: 0x1a2028,
    },
  })
}

function createSharedMaterials(
  art: StylizedArtLibrary,
  palette: GeneratedWorldPalette = {},
): SharedMaterials {
  const all: THREE.Material[] = []
  const textures: THREE.Texture[] = []
  const stylized = (
    surface: StylizedWorldSurface,
    parameters: StylizedWorldParameters,
  ): THREE.MeshStandardMaterial => {
    const material = art.createMaterial({ ...parameters, surface })
    all.push(material)
    return material
  }
  const textured = (
    key: string,
    base: THREE.ColorRepresentation,
    pattern: ProceduralSurfacePattern,
    repeatX: number,
    repeatY: number,
    surface: StylizedWorldSurface,
    parameters: Omit<StylizedWorldParameters, 'color' | 'map'> = {},
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
    return stylized(surface, {
      ...parameters,
      color: 0xffffff,
      map,
      name: key,
    })
  }
  const terrainPatterns: Record<ZoneId, ProceduralSurfacePattern> = {
    neutral: 'grass',
    palace: 'stone',
    forest: 'grass',
    fort: 'scree',
  }
  const terrainColors = createZoneMaterialRecord(
    (zone) => palette.terrain?.[zone] ?? BIOME_PROFILES[zone].terrainColor,
  )
  const secondaryColors = createZoneMaterialRecord(
    (zone) => palette.secondary?.[zone] ?? BIOME_PROFILES[zone].secondaryColor,
  )
  const terrain = createZoneMaterialRecord((zone) =>
    textured(
      `generated-terrain-${zone}`,
      terrainColors[zone],
      terrainPatterns[zone],
      zone === 'palace' ? 10 : 16,
      zone === 'palace' ? 10 : 16,
      'ground',
      {
        roughness: 0.95,
        metalness: 0,
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
    'ground',
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
    'water',
    {
      roughness: 0.28,
      metalness: 0.05,
      transparent: true,
      opacity: 0.82,
    },
    shadeColor(waterBase, 0.25),
  )
  // The prop family. Four materials cover every world object in the game because
  // `PropKit` bakes colour, contact darkening and sky occlusion into the vertices —
  // a vertex-coloured material on geometry without a `color` attribute renders
  // black, so this pairing is not optional, and it is also what lets a whole village
  // merge into one draw call per surface.
  const prop = stylized('stone', {
    color: 0xffffff,
    vertexColors: true,
    flatShading: false,
    name: 'generated-prop',
  })
  const propFoliage = stylized('foliage', {
    color: 0xffffff,
    vertexColors: true,
    flatShading: false,
    name: 'generated-prop-foliage',
  })
  const propCloth = stylized('cloth', {
    color: 0xffffff,
    vertexColors: true,
    side: THREE.DoubleSide,
    name: 'generated-prop-cloth',
  })
  // Lit windows, lantern panes, brazier coals and rune bands. Emissive rather than
  // merely bright, so bloom picks them up and a settlement reads as inhabited from
  // across a region at night — but kept below the point where a window on a small
  // hut becomes the brightest thing in a daylit frame.
  const propGlow = stylized('glow', {
    color: 0xffffff,
    vertexColors: true,
    emissive: 0xffb066,
    emissiveIntensity: 0.6,
    name: 'generated-prop-glow',
  })
  const groundCover = createZoneMaterialRecord((zone) =>
    stylized('foliage', {
      color: mixColor(terrainColors[zone], secondaryColors[zone], 0.58),
      vertexColors: true,
      flatShading: true,
      roughness: 1,
      side: THREE.DoubleSide,
      name: `generated-ground-cover-${zone}`,
    }),
  )
  return {
    terrain,
    road,
    water,
    prop,
    propFoliage,
    propCloth,
    propGlow,
    groundCover,
    all,
    textures,
  }
}

type StylizedWorldSurface = Parameters<
  StylizedArtLibrary['createMaterial']
>[0]['surface']

type StylizedWorldParameters = Omit<
  Parameters<StylizedArtLibrary['createMaterial']>[0],
  'surface'
>

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
    outlineDressing: options.outlineDressing === true,
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

const PROJECTED_STRIP_UV_LENGTH = 8
const PROJECTED_STRIP_EPSILON = 1e-6

interface ProjectedStripVertex extends Point2 {
  y: number
}

function createTerrainProjectedStripGeometry(
  terrain: TerrainSystem,
  terrainBounds: Bounds2D,
  terrainResolution: number,
  start: Point2,
  end: Point2,
  width: number,
  heightOffset: number,
): THREE.BufferGeometry {
  const deltaX = end.x - start.x
  const deltaZ = end.z - start.z
  const length = Math.hypot(deltaX, deltaZ)
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    throw new Error('Projected strip requires two distinct finite points')
  }
  if (!Number.isFinite(width) || width <= PROJECTED_STRIP_EPSILON) {
    throw new Error('Projected strip requires a positive finite width')
  }

  const segments = Math.max(1, Math.floor(terrainResolution))
  const terrainWidth = terrainBounds.maxX - terrainBounds.minX
  const terrainDepth = terrainBounds.maxZ - terrainBounds.minZ
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const directionX = deltaX / length
  const directionZ = deltaZ / length
  const sideX = directionZ
  const sideZ = -directionX
  const halfWidth = width / 2
  const clipBounds: Point2[] = [
    {
      x: start.x - sideX * halfWidth,
      z: start.z - sideZ * halfWidth,
    },
    {
      x: start.x + sideX * halfWidth,
      z: start.z + sideZ * halfWidth,
    },
    {
      x: end.x + sideX * halfWidth,
      z: end.z + sideZ * halfWidth,
    },
    {
      x: end.x - sideX * halfWidth,
      z: end.z - sideZ * halfWidth,
    },
  ]

  const terrainVertex = (x: number, z: number): ProjectedStripVertex => ({
    x,
    y: terrain.sampleHeight(x, z),
    z,
  })
  const appendPolygon = (polygon: readonly ProjectedStripVertex[]): void => {
    const vertexOffset = positions.length / 3
    for (const vertex of polygon) {
      const normal = terrain.sampleNormal(vertex.x, vertex.z)
      const relativeX = vertex.x - start.x
      const relativeZ = vertex.z - start.z
      positions.push(vertex.x, vertex.y + heightOffset, vertex.z)
      normals.push(normal.x, normal.y, normal.z)
      uvs.push(
        THREE.MathUtils.clamp(
          (relativeX * sideX + relativeZ * sideZ) / width + 0.5,
          0,
          1,
        ),
        (relativeX * directionX + relativeZ * directionZ) /
          PROJECTED_STRIP_UV_LENGTH,
      )
    }
    for (let index = 1; index < polygon.length - 1; index += 1) {
      if (
        Math.abs(
          triangleArea2D(polygon[0], polygon[index], polygon[index + 1]),
        ) <= PROJECTED_STRIP_EPSILON
      ) {
        continue
      }
      indices.push(vertexOffset, vertexOffset + index, vertexOffset + index + 1)
    }
  }

  for (let zIndex = 0; zIndex < segments; zIndex += 1) {
    const minZ = terrainBounds.minZ + (terrainDepth * zIndex) / segments
    const maxZ =
      terrainBounds.minZ + (terrainDepth * (zIndex + 1)) / segments
    for (let xIndex = 0; xIndex < segments; xIndex += 1) {
      const minX = terrainBounds.minX + (terrainWidth * xIndex) / segments
      const maxX =
        terrainBounds.minX + (terrainWidth * (xIndex + 1)) / segments
      const topLeft = terrainVertex(minX, minZ)
      const topRight = terrainVertex(maxX, minZ)
      const bottomLeft = terrainVertex(minX, maxZ)
      const bottomRight = terrainVertex(maxX, maxZ)
      for (const triangle of [
        [topLeft, bottomLeft, topRight],
        [topRight, bottomLeft, bottomRight],
      ]) {
        const polygon = clipProjectedPolygon(triangle, clipBounds)
        if (polygon.length >= 3) appendPolygon(polygon)
      }
    }
  }

  if (indices.length === 0) {
    throw new Error('Projected strip does not overlap its terrain region')
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  )
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(normals, 3),
  )
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function clipProjectedPolygon(
  polygon: readonly ProjectedStripVertex[],
  clipBounds: readonly Point2[],
): ProjectedStripVertex[] {
  let output = [...polygon]
  for (let edgeIndex = 0; edgeIndex < clipBounds.length; edgeIndex += 1) {
    const edgeStart = clipBounds[edgeIndex]
    const edgeEnd = clipBounds[(edgeIndex + 1) % clipBounds.length]
    const input = output
    output = []
    if (input.length === 0) break

    let previous = input[input.length - 1]
    let previousDistance = projectedEdgeDistance(
      edgeStart,
      edgeEnd,
      previous,
    )
    for (const current of input) {
      const currentDistance = projectedEdgeDistance(
        edgeStart,
        edgeEnd,
        current,
      )
      const previousInside = previousDistance >= -PROJECTED_STRIP_EPSILON
      const currentInside = currentDistance >= -PROJECTED_STRIP_EPSILON
      if (currentInside !== previousInside) {
        const denominator = previousDistance - currentDistance
        if (Math.abs(denominator) > PROJECTED_STRIP_EPSILON) {
          const interpolation = previousDistance / denominator
          output.push({
            x: lerp(previous.x, current.x, interpolation),
            y: lerp(previous.y, current.y, interpolation),
            z: lerp(previous.z, current.z, interpolation),
          })
        }
      }
      if (currentInside) output.push(current)
      previous = current
      previousDistance = currentDistance
    }
  }

  return removeDuplicateProjectedVertices(output)
}

function projectedEdgeDistance(
  edgeStart: Point2,
  edgeEnd: Point2,
  point: Point2,
): number {
  return (
    (edgeEnd.x - edgeStart.x) * (point.z - edgeStart.z) -
    (edgeEnd.z - edgeStart.z) * (point.x - edgeStart.x)
  )
}

function removeDuplicateProjectedVertices(
  vertices: readonly ProjectedStripVertex[],
): ProjectedStripVertex[] {
  const unique: ProjectedStripVertex[] = []
  for (const vertex of vertices) {
    const previous = unique[unique.length - 1]
    if (
      previous &&
      Math.abs(previous.x - vertex.x) <= PROJECTED_STRIP_EPSILON &&
      Math.abs(previous.z - vertex.z) <= PROJECTED_STRIP_EPSILON
    ) {
      continue
    }
    unique.push(vertex)
  }
  if (
    unique.length > 1 &&
    Math.abs(unique[0].x - unique[unique.length - 1].x) <=
      PROJECTED_STRIP_EPSILON &&
    Math.abs(unique[0].z - unique[unique.length - 1].z) <=
      PROJECTED_STRIP_EPSILON
  ) {
    unique.pop()
  }
  return unique
}

function triangleArea2D(first: Point2, second: Point2, third: Point2): number {
  return (
    (second.x - first.x) * (third.z - first.z) -
    (second.z - first.z) * (third.x - first.x)
  )
}

function boundsCenter(bounds: Bounds2D): Point2 {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  }
}

interface DressingPlacement {
  index: number
  x: number
  z: number
  scale: number
  rotation: number
}

/**
 * How an instanced kind sits on the ground.
 *
 * Split out from {@link DressingBucket} because river reeds want the same placement
 * maths without pretending to be part of the biome's dressing plan.
 */
interface DressingPlacementStyle {
  scale: number
  verticalStretch: number
  /** Fraction of the instance height to sink into, or lift off, the terrain. */
  baseLift: number
}

/**
 * One instanced kind inside a region's dressing.
 *
 * A bucket is the whole story for a species: which shared geometry it borrows, how
 * often it appears, whether it blocks movement and takes ink, and how it sits on the
 * ground. Adding a species to a biome is one entry in {@link DRESSING_PLANS}.
 */
interface DressingBucket extends DressingPlacementStyle {
  id: string
  request: PropRequest
  /** Structural kinds collide and ignore the decoration-quality slider. */
  structural: boolean
  /** Ink-worthy kinds get an inverted-hull silhouette if the region can pay. */
  ink: boolean
  weight: number
  colliderRadius: number
}

interface DressingBucketPlan {
  id: string
  request: PropRequest
  structural?: boolean
  ink?: boolean
  weight: number
  colliderRadius?: number
  scale?: number
  verticalStretch?: number
  baseLift?: number
}

/**
 * What grows where.
 *
 * Six kinds is the ceiling: each one is an instanced draw call, and a region already
 * spends four on ground cover. The weights are what actually shape a biome — the
 * forest is mostly canopy, the fort is mostly rock, and the neutral lands are the
 * only place with as much undergrowth as timber.
 *
 * Plan order is ink priority. Ink is charged per bucket, the region's budget is
 * finite, and the buckets are listed tallest first so that a region which cannot
 * afford every silhouette keeps the ones that carry the horizon.
 */
function dressingPlan(biome: ZoneId): DressingBucket[] {
  return DRESSING_PLANS[biome].map((plan) => ({
    id: plan.id,
    request: plan.request,
    structural: plan.structural === true,
    // Anything tall enough to read as a landmark earns ink whether or not it
    // blocks movement. Tying the two together left seven of the eight draws idle:
    // only one bucket per biome collides, so only one was ever outlined.
    ink: plan.ink ?? plan.structural === true,
    weight: plan.weight,
    colliderRadius: plan.colliderRadius ?? 0.55,
    scale: plan.scale ?? 1,
    verticalStretch: plan.verticalStretch ?? 1,
    baseLift: plan.baseLift ?? 0,
  }))
}

const DRESSING_PLANS: Record<ZoneId, readonly DressingBucketPlan[]> = {
  forest: [
    {
      id: 'tree-0',
      request: { kind: 'tree', biome: 'forest', slot: 0, detail: 'near' },
      structural: true,
      weight: 0.3,
      colliderRadius: 0.55,
      verticalStretch: 1.2,
    },
    {
      id: 'tree-1',
      request: { kind: 'tree', biome: 'forest', slot: 1, detail: 'near' },
      ink: true,
      weight: 0.18,
      verticalStretch: 1.1,
    },
    {
      id: 'tree-2',
      request: { kind: 'tree', biome: 'forest', slot: 2, detail: 'near' },
      ink: true,
      weight: 0.12,
      verticalStretch: 1.15,
    },
    {
      id: 'under-0',
      request: { kind: 'undergrowth', biome: 'forest', slot: 0 },
      weight: 0.2,
      scale: 1.1,
    },
    {
      id: 'under-1',
      request: { kind: 'undergrowth', biome: 'forest', slot: 1 },
      weight: 0.1,
    },
    {
      id: 'under-2',
      request: { kind: 'undergrowth', biome: 'forest', slot: 2 },
      weight: 0.1,
      baseLift: 0.1,
    },
  ],
  neutral: [
    {
      id: 'tree-0',
      request: { kind: 'tree', biome: 'neutral', slot: 0, detail: 'near' },
      structural: true,
      weight: 0.22,
      colliderRadius: 0.6,
    },
    {
      id: 'tree-1',
      request: { kind: 'tree', biome: 'neutral', slot: 1, detail: 'near' },
      ink: true,
      weight: 0.14,
      verticalStretch: 1.1,
    },
    {
      id: 'under-0',
      request: { kind: 'undergrowth', biome: 'neutral', slot: 0 },
      weight: 0.24,
    },
    {
      id: 'under-1',
      request: { kind: 'undergrowth', biome: 'neutral', slot: 1 },
      weight: 0.2,
      scale: 0.9,
    },
    {
      id: 'rock-0',
      request: { kind: 'rock', biome: 'neutral', slot: 0, detail: 'near' },
      weight: 0.12,
      scale: 0.7,
      baseLift: -0.16,
    },
    {
      id: 'rock-1',
      request: { kind: 'rock', biome: 'neutral', slot: 1, detail: 'near' },
      weight: 0.08,
      scale: 0.8,
    },
  ],
  palace: [
    {
      id: 'tree-0',
      request: { kind: 'tree', biome: 'palace', slot: 0, detail: 'near' },
      ink: true,
      weight: 0.26,
      scale: 1.1,
    },
    {
      id: 'tree-1',
      request: { kind: 'tree', biome: 'palace', slot: 1, detail: 'near' },
      structural: true,
      weight: 0.18,
      colliderRadius: 0.45,
      verticalStretch: 1.15,
    },
    {
      id: 'under-0',
      request: { kind: 'undergrowth', biome: 'palace', slot: 0 },
      weight: 0.18,
      scale: 0.95,
    },
    {
      id: 'rock-0',
      request: { kind: 'rock', biome: 'palace', slot: 0, detail: 'near' },
      weight: 0.2,
      scale: 0.8,
      baseLift: -0.14,
    },
    {
      id: 'rock-1',
      request: { kind: 'rock', biome: 'palace', slot: 1, detail: 'near' },
      ink: true,
      weight: 0.18,
      scale: 1,
    },
  ],
  fort: [
    {
      id: 'tree-0',
      request: { kind: 'tree', biome: 'fort', slot: 0, detail: 'near' },
      structural: true,
      weight: 0.2,
      colliderRadius: 0.5,
      verticalStretch: 1.1,
    },
    {
      id: 'tree-1',
      request: { kind: 'tree', biome: 'fort', slot: 1, detail: 'near' },
      ink: true,
      weight: 0.16,
      scale: 1.1,
    },
    {
      id: 'rock-0',
      request: { kind: 'rock', biome: 'fort', slot: 0, detail: 'near' },
      structural: true,
      weight: 0.24,
      colliderRadius: 0.85,
      baseLift: -0.18,
    },
    {
      id: 'rock-1',
      request: { kind: 'rock', biome: 'fort', slot: 1, detail: 'near' },
      weight: 0.16,
      scale: 0.9,
      baseLift: -0.12,
    },
    {
      id: 'rock-2',
      request: { kind: 'rock', biome: 'fort', slot: 2, detail: 'near' },
      ink: true,
      weight: 0.14,
    },
    {
      id: 'under-0',
      request: { kind: 'undergrowth', biome: 'fort', slot: 0 },
      weight: 0.1,
      scale: 0.85,
    },
  ],
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

/**
 * Ground cover.
 *
 * All four kinds share one vertex-coloured material per biome, so each builder
 * bakes its own colour ramp — a tuft that is dark at the root and bright at the tip
 * costs nothing at runtime and does more for readability than any texture would at
 * this size.
 */

/**
 * Grass height by biome: sparse and clipped at the palace, rank in the forest.
 *
 * Module scope on purpose. Built inside the function it allocated a fresh four-key
 * record **per instance per region load** — up to 420 in a forest region, three regions
 * per boundary crossing — on the streaming path, which is the hot one.
 */
const GRASS_ZONE_SCALE: Record<ZoneId, number> = {
  neutral: 1,
  palace: 0.62,
  forest: 1.18,
  fort: 0.7,
}

function writeGroundCoverScale(
  kind: GroundCoverKind,
  zone: ZoneId,
  placement: GroundCoverPlacement,
  target: THREE.Vector3,
): void {
  if (kind === 'grass') {
    const scale = GRASS_ZONE_SCALE[zone]
    const width = scale * lerp(0.72, 1.35, placement.width)
    const height = scale * lerp(0.72, 1.58, placement.height)
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
