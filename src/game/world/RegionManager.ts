import type {
  RegionBlueprint,
  RegionId,
  WorldBlueprint,
} from './worldTypes.ts'
import {
  compareRegions,
  containsPoint,
  normalizeWorldBlueprint,
  type NormalizedRegion,
  type Point2,
  type WorldLayout,
} from './TerrainSystem.ts'
import {
  RegionRuntime,
  normalizeRegionDelta,
  type RegionDelta,
  type RegionLifecycleState,
} from './RegionRuntime.ts'

export interface ManagedRegionRuntime {
  readonly id: RegionId
  readonly blueprint: RegionBlueprint
  readonly state: RegionLifecycleState
  transitionTo(state: RegionLifecycleState): boolean
  update?(deltaSeconds: number): void
  extractDelta(): RegionDelta
  applyDelta(delta: unknown): boolean
  dispose(): void
}

export interface RegionRuntimeFactoryContext {
  regionId: RegionId
  region: NormalizedRegion
  savedDelta?: RegionDelta
}

export type RegionRuntimeFactory = (
  blueprint: RegionBlueprint,
  context: RegionRuntimeFactoryContext,
) => ManagedRegionRuntime

export interface RegionManagerOptions {
  visibleRadius?: number
  simulationRadius?: number
  discoverVisibleRegions?: boolean
}

export interface RegionLifecycleSnapshot {
  regionId: RegionId
  coordinate: Point2
  state: RegionLifecycleState
  visible: boolean
  simulated: boolean
  pinned: boolean
  pinReasons: readonly string[]
  discovered: boolean
  hasDelta: boolean
}

export interface RegionManagerSave {
  version: 1
  currentRegionId?: RegionId
  discoveredRegionIds: RegionId[]
  deltas: Record<string, RegionDelta>
}

export interface RegionManagerUpdate {
  currentRegionId?: RegionId
  visibleRegionIds: RegionId[]
  simulatedRegionIds: RegionId[]
  dormantRegionIds: RegionId[]
}

type UnknownRecord = Record<string, unknown>

const DEFAULT_PIN_REASON = 'manual'

export class RegionManager {
  readonly blueprint: WorldBlueprint
  readonly layout: WorldLayout

  private readonly factory: RegionRuntimeFactory
  private readonly visibleRadius: number
  private readonly simulationRadius: number
  private readonly discoverVisibleRegions: boolean
  private readonly runtimes = new Map<RegionId, ManagedRegionRuntime>()
  private deltas = new Map<RegionId, RegionDelta>()
  private readonly discoveredRegions = new Set<RegionId>()
  private readonly pins = new Map<RegionId, Set<string>>()
  private readonly unloadedRegions = new Set<RegionId>()
  private visibleRegions = new Set<RegionId>()
  private simulatedRegions = new Set<RegionId>()
  private currentRegion?: RegionId
  private disposed = false

  constructor(
    blueprint: WorldBlueprint,
    factory: RegionRuntimeFactory = (regionBlueprint, context) =>
      new RegionRuntime(regionBlueprint, context.regionId),
    options: RegionManagerOptions = {},
  ) {
    this.blueprint = blueprint
    this.layout = normalizeWorldBlueprint(blueprint)
    this.factory = factory
    this.visibleRadius = Math.max(
      0,
      Math.floor(finiteOr(options.visibleRadius, 1)),
    )
    this.simulationRadius = Math.max(
      0,
      Math.floor(finiteOr(options.simulationRadius, 1)),
    )
    this.discoverVisibleRegions = options.discoverVisibleRegions !== false
  }

  get currentRegionId(): RegionId | undefined {
    return this.currentRegion
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  update(
    current?: RegionId | Point2,
    deltaSeconds = 0,
  ): RegionManagerUpdate {
    if (this.disposed) return this.getUpdateSnapshot()
    const nextCurrent =
      current === undefined ? this.resolveRegion(this.currentRegion) : this.resolveInput(current)
    if (!nextCurrent) {
      if (current === undefined && this.currentRegion === undefined) {
        return this.getUpdateSnapshot()
      }
      throw new Error(`Unknown current region: ${String(current)}`)
    }

    const previousCurrent = this.currentRegion
    const nextVisible = new Set(
      this.layout.regions
        .filter(
          (region) =>
            Math.max(
              Math.abs(region.coordinate.x - nextCurrent.coordinate.x),
              Math.abs(region.coordinate.z - nextCurrent.coordinate.z),
            ) <= this.visibleRadius,
        )
        .map((region) => region.id),
    )
    const nextSimulated = new Set(
      this.layout.regions
        .filter(
          (region) =>
            nextVisible.has(region.id) &&
            Math.abs(region.coordinate.x - nextCurrent.coordinate.x) +
              Math.abs(region.coordinate.z - nextCurrent.coordinate.z) <=
              this.simulationRadius,
        )
        .map((region) => region.id),
    )

    const incoming = this.sortedRegions(nextVisible)
    const activated: Array<{
      regionId: RegionId
      runtime: ManagedRegionRuntime
      previousState: RegionLifecycleState
      created: boolean
    }> = []
    try {
      for (const region of incoming) {
        const existing = this.runtimes.get(region.id)
        const runtime = existing ?? this.ensureRuntime(region)
        activated.push({
          regionId: region.id,
          runtime,
          previousState: runtime.state,
          created: existing === undefined,
        })
        runtime.transitionTo(
          nextSimulated.has(region.id) ? 'simulated' : 'visible',
        )
      }
    } catch (error) {
      const rollbackErrors: unknown[] = [error]
      for (const activation of activated.reverse()) {
        if (activation.created) {
          try {
            activation.runtime.transitionTo('unloaded')
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
          try {
            activation.runtime.dispose()
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          } finally {
            this.runtimes.delete(activation.regionId)
            this.unloadedRegions.add(activation.regionId)
          }
        } else if (activation.runtime.state !== activation.previousState) {
          try {
            activation.runtime.transitionTo(activation.previousState)
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }
      }
      this.currentRegion = previousCurrent
      throw new AggregateError(
        rollbackErrors,
        'Failed to activate incoming regions',
      )
    }
    this.currentRegion = nextCurrent.id

    const outgoing = this.sortedRuntimeEntries().filter(
      ([regionId]) => !nextVisible.has(regionId),
    )
    const unloadErrors: unknown[] = []
    for (const [regionId, runtime] of outgoing) {
      if (this.isPinned(regionId)) {
        runtime.transitionTo('dormant')
        continue
      }
      try {
        this.saveRuntimeDelta(runtime)
      } catch (error) {
        unloadErrors.push(error)
      }
      try {
        runtime.transitionTo('unloaded')
      } catch (error) {
        unloadErrors.push(error)
      }
      try {
        runtime.dispose()
      } catch (error) {
        unloadErrors.push(error)
      } finally {
        this.runtimes.delete(regionId)
        this.unloadedRegions.add(regionId)
      }
    }

    this.visibleRegions = nextVisible
    this.simulatedRegions = nextSimulated
    if (this.discoverVisibleRegions) {
      for (const regionId of nextVisible) this.discoveredRegions.add(regionId)
    } else {
      this.discoveredRegions.add(nextCurrent.id)
    }

    if (Number.isFinite(deltaSeconds) && deltaSeconds >= 0) {
      for (const region of this.sortedRegions(nextSimulated)) {
        this.runtimes.get(region.id)?.update?.(deltaSeconds)
      }
    }
    if (unloadErrors.length > 0) {
      throw new AggregateError(unloadErrors, 'Failed to unload every outgoing region')
    }
    return this.getUpdateSnapshot()
  }

  setCurrentRegion(
    current: RegionId | Point2,
    deltaSeconds = 0,
  ): RegionManagerUpdate {
    return this.update(current, deltaSeconds)
  }

  getRuntime(regionId: RegionId): ManagedRegionRuntime | undefined {
    const region = this.resolveRegion(regionId)
    return region ? this.runtimes.get(region.id) : undefined
  }

  getVisibleRegionIds(): RegionId[] {
    return this.sortedRegions(this.visibleRegions).map((region) => region.id)
  }

  getSimulatedRegionIds(): RegionId[] {
    return this.sortedRegions(this.simulatedRegions).map((region) => region.id)
  }

  getDormantRegionIds(): RegionId[] {
    return this.sortedRuntimeEntries()
      .filter(([, runtime]) => runtime.state === 'dormant')
      .map(([regionId]) => regionId)
  }

  getDiscoveredRegionIds(): RegionId[] {
    return this.sortedRegions(this.discoveredRegions).map(
      (region) => region.id,
    )
  }

  isDiscovered(regionId: RegionId): boolean {
    const region = this.resolveRegion(regionId)
    return region ? this.discoveredRegions.has(region.id) : false
  }

  markDiscovered(regionId: RegionId): boolean {
    const region = this.resolveRegion(regionId)
    if (!region || this.discoveredRegions.has(region.id)) return false
    this.discoveredRegions.add(region.id)
    return true
  }

  pinRegion(regionId: RegionId, reason = DEFAULT_PIN_REASON): boolean {
    const region = this.resolveRegion(regionId)
    if (!region || reason.length === 0) return false
    let reasons = this.pins.get(region.id)
    if (!reasons) {
      reasons = new Set()
      this.pins.set(region.id, reasons)
    }
    const previousSize = reasons.size
    reasons.add(reason)
    return reasons.size !== previousSize
  }

  createPin(
    regionId: RegionId,
    reason = DEFAULT_PIN_REASON,
  ): () => void {
    this.pinRegion(regionId, reason)
    let released = false
    return () => {
      if (released) return
      released = true
      this.unpinRegion(regionId, reason)
    }
  }

  pinObjective(regionId: RegionId, objectiveId: string): boolean {
    return this.pinRegion(regionId, `objective:${objectiveId}`)
  }

  pinUniqueActor(regionId: RegionId, actorId: string): boolean {
    return this.pinRegion(regionId, `actor:${actorId}`)
  }

  unpinRegion(
    regionId: RegionId,
    reason = DEFAULT_PIN_REASON,
  ): boolean {
    const region = this.resolveRegion(regionId)
    const reasons = region ? this.pins.get(region.id) : undefined
    if (!region || !reasons?.delete(reason)) return false
    if (reasons.size === 0) this.pins.delete(region.id)
    return true
  }

  isPinned(regionId: RegionId): boolean {
    const region = this.resolveRegion(regionId)
    return region ? (this.pins.get(region.id)?.size ?? 0) > 0 : false
  }

  getPinReasons(regionId: RegionId): readonly string[] {
    const region = this.resolveRegion(regionId)
    return region ? [...(this.pins.get(region.id) ?? [])].sort() : []
  }

  saveRegionDelta(regionId: RegionId): RegionDelta | undefined {
    const runtime = this.getRuntime(regionId)
    if (runtime) this.saveRuntimeDelta(runtime)
    return this.getSavedDelta(regionId)
  }

  getSavedDelta(regionId: RegionId): RegionDelta | undefined {
    const region = this.resolveRegion(regionId)
    const delta = region ? this.deltas.get(region.id) : undefined
    return delta ? cloneDelta(delta) : undefined
  }

  applyRegionDelta(regionId: RegionId, value: unknown): boolean {
    const region = this.resolveRegion(regionId)
    if (!region) return false
    const delta = normalizeRegionDelta(value, region.id)
    if (!delta) return false
    this.deltas.set(region.id, cloneDelta(delta))
    this.runtimes.get(region.id)?.applyDelta(cloneDelta(delta))
    return true
  }

  saveState(): RegionManagerSave {
    for (const [, runtime] of this.sortedRuntimeEntries()) {
      this.saveRuntimeDelta(runtime)
    }
    const deltas: Record<string, RegionDelta> = {}
    for (const region of this.layout.regions) {
      const delta = this.deltas.get(region.id)
      if (delta) deltas[String(region.id)] = cloneDelta(delta)
    }
    return {
      version: 1,
      ...(this.currentRegion === undefined
        ? {}
        : { currentRegionId: this.currentRegion }),
      discoveredRegionIds: this.getDiscoveredRegionIds(),
      deltas,
    }
  }

  extractState(): RegionManagerSave {
    return this.saveState()
  }

  applyState(value: unknown): boolean {
    if (this.disposed) return false
    const record = asRecord(value)
    if (!record || (record.version !== undefined && record.version !== 1)) {
      return false
    }

    const discovered =
      record.discoveredRegionIds ?? record.discoveredRegions
    const discoveredRegions: RegionId[] = []
    if (Array.isArray(discovered)) {
      for (const regionId of discovered) {
        const region = this.resolveRegionValue(regionId)
        if (region) discoveredRegions.push(region.id)
      }
    }

    const rawDeltas = record.deltas ?? record.regionDeltas
    if (rawDeltas === undefined) return false
    const deltaEntries = readDeltaEntries(rawDeltas)
    if (!deltaEntries) return false
    const replacementDeltas = new Map<RegionId, RegionDelta>()
    for (const [regionKey, valueEntry] of deltaEntries) {
      const valueRecord = asRecord(valueEntry)
      const keyedRegion = this.resolveRegionValue(regionKey)
      const valueRegion = this.resolveRegionValue(valueRecord?.regionId)
      if (
        !keyedRegion ||
        !valueRegion ||
        String(keyedRegion.id) !== String(valueRegion.id)
      ) {
        return false
      }
      const delta = normalizeRegionDelta(valueEntry, keyedRegion.id)
      if (!delta) return false
      replacementDeltas.set(keyedRegion.id, cloneDelta(delta))
    }

    const current = this.resolveRegionValue(record.currentRegionId)

    this.deltas = replacementDeltas
    if (Array.isArray(discovered)) {
      this.discoveredRegions.clear()
      for (const regionId of discoveredRegions) {
        this.discoveredRegions.add(regionId)
      }
    }
    for (const [regionId, runtime] of this.sortedRuntimeEntries()) {
      const replacement =
        replacementDeltas.get(regionId) ?? createEmptyDelta(regionId)
      runtime.applyDelta(cloneDelta(replacement))
    }

    if (current) this.currentRegion = current.id
    return true
  }

  getLifecycleSnapshots(): RegionLifecycleSnapshot[] {
    return this.layout.regions.map((region) => {
      const runtime = this.runtimes.get(region.id)
      return {
        regionId: region.id,
        coordinate: { ...region.coordinate },
        state:
          runtime?.state ??
          (this.unloadedRegions.has(region.id)
            ? 'unloaded'
            : 'blueprint-only'),
        visible: this.visibleRegions.has(region.id),
        simulated: this.simulatedRegions.has(region.id),
        pinned: this.isPinned(region.id),
        pinReasons: this.getPinReasons(region.id),
        discovered: this.discoveredRegions.has(region.id),
        hasDelta: this.deltas.has(region.id),
      }
    })
  }

  getLifecycleSnapshot(regionId: RegionId): RegionLifecycleSnapshot | undefined {
    const id = String(regionId)
    return this.getLifecycleSnapshots().find(
      (snapshot) => String(snapshot.regionId) === id,
    )
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const errors: unknown[] = []
    for (const [regionId, runtime] of this.sortedRuntimeEntries()) {
      try {
        this.saveRuntimeDelta(runtime)
      } catch (error) {
        errors.push(error)
      }
      try {
        runtime.transitionTo('unloaded')
      } catch (error) {
        errors.push(error)
      }
      try {
        runtime.dispose()
      } catch (error) {
        errors.push(error)
      }
      this.unloadedRegions.add(regionId)
    }
    this.runtimes.clear()
    this.visibleRegions.clear()
    this.simulatedRegions.clear()
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Failed to dispose every managed region')
    }
  }

  private ensureRuntime(region: NormalizedRegion): ManagedRegionRuntime {
    const existing = this.runtimes.get(region.id)
    if (existing) return existing
    const savedDelta = this.deltas.get(region.id)
    const runtime = this.factory(region.blueprint, {
      regionId: region.id,
      region,
      ...(savedDelta ? { savedDelta: cloneDelta(savedDelta) } : {}),
    })
    if (String(runtime.id) !== String(region.id)) {
      runtime.dispose()
      throw new Error(
        `Runtime id ${String(runtime.id)} does not match region ${String(region.id)}`,
      )
    }
    if (savedDelta) runtime.applyDelta(cloneDelta(savedDelta))
    this.runtimes.set(region.id, runtime)
    this.unloadedRegions.delete(region.id)
    return runtime
  }

  private saveRuntimeDelta(runtime: ManagedRegionRuntime): void {
    const region = this.resolveRegion(runtime.id)
    if (!region) return
    const delta = normalizeRegionDelta(runtime.extractDelta(), region.id)
    if (delta) this.deltas.set(region.id, cloneDelta(delta))
  }

  private getUpdateSnapshot(): RegionManagerUpdate {
    return {
      ...(this.currentRegion === undefined
        ? {}
        : { currentRegionId: this.currentRegion }),
      visibleRegionIds: this.getVisibleRegionIds(),
      simulatedRegionIds: this.getSimulatedRegionIds(),
      dormantRegionIds: this.getDormantRegionIds(),
    }
  }

  private sortedRegions(regionIds: Iterable<RegionId>): NormalizedRegion[] {
    const ids = new Set([...regionIds].map(String))
    return this.layout.regions
      .filter((region) => ids.has(String(region.id)))
      .sort(compareRegions)
  }

  private sortedRuntimeEntries(): [RegionId, ManagedRegionRuntime][] {
    return [...this.runtimes.entries()].sort(([first], [second]) => {
      const firstRegion = this.resolveRegion(first)
      const secondRegion = this.resolveRegion(second)
      if (!firstRegion || !secondRegion) {
        return String(first).localeCompare(String(second))
      }
      return compareRegions(firstRegion, secondRegion)
    })
  }

  private resolveInput(
    value: RegionId | Point2,
  ): NormalizedRegion | undefined {
    if (
      typeof value === 'object' &&
      value !== null &&
      'x' in value &&
      'z' in value
    ) {
      const position = value as Point2
      return this.layout.regions.find((region) =>
        containsPoint(region.bounds, position.x, position.z),
      )
    }
    return this.resolveRegion(value as RegionId)
  }

  private resolveRegion(
    regionId: RegionId | undefined,
  ): NormalizedRegion | undefined {
    return regionId === undefined
      ? undefined
      : this.resolveRegionValue(regionId)
  }

  private resolveRegionValue(value: unknown): NormalizedRegion | undefined {
    if (value === undefined || value === null) return undefined
    const id = String(value)
    return this.layout.regions.find((region) => String(region.id) === id)
  }
}

function readDeltaEntries(value: unknown): [unknown, unknown][] | null {
  if (Array.isArray(value)) {
    return value.map((entry) => [asRecord(entry)?.regionId, entry])
  }
  const record = asRecord(value)
  return record ? Object.entries(record) : null
}

function cloneDelta(delta: RegionDelta): RegionDelta {
  return {
    version: delta.version,
    regionId: delta.regionId,
    revision: delta.revision,
    clearedEncounterIds: [...delta.clearedEncounterIds],
    defeatedActorIds: [...delta.defeatedActorIds],
    removedPropIds: [...delta.removedPropIds],
    collectedLootIds: [...delta.collectedLootIds],
    completedInteractionIds: [...delta.completedInteractionIds],
    completedEventIds: [...delta.completedEventIds],
    state: JSON.parse(JSON.stringify(delta.state)) as RegionDelta['state'],
  }
}

function createEmptyDelta(regionId: RegionId): RegionDelta {
  return {
    version: 1,
    regionId,
    revision: 0,
    clearedEncounterIds: [],
    defeatedActorIds: [],
    removedPropIds: [],
    collectedLootIds: [],
    completedInteractionIds: [],
    completedEventIds: [],
    state: {},
  }
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback
}
