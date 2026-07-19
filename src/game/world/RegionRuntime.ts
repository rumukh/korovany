import type { RegionBlueprint, RegionId } from './worldTypes.ts'

export type RegionLifecycleState =
  | 'blueprint-only'
  | 'visible'
  | 'simulated'
  | 'dormant'
  | 'unloaded'

export type RegionOwnershipKind =
  | 'collider'
  | 'actor'
  | 'prop'
  | 'marker'
  | 'interaction'
  | 'loot'
  | 'event'
  | 'projectile'
  | 'fx'
  | 'outline'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

export const REGION_DELTA_VERSION = 1 as const

export interface RegionDelta {
  version: typeof REGION_DELTA_VERSION
  regionId: RegionId
  revision: number
  clearedEncounterIds: string[]
  defeatedActorIds: string[]
  removedPropIds: string[]
  collectedLootIds: string[]
  completedInteractionIds: string[]
  completedEventIds: string[]
  state: Record<string, JsonValue>
}

export interface RegionRuntimeHooks {
  onTransition?: (
    runtime: RegionRuntime,
    previous: RegionLifecycleState,
    next: RegionLifecycleState,
  ) => void
  onUpdate?: (runtime: RegionRuntime, deltaSeconds: number) => void
  onDispose?: (runtime: RegionRuntime) => void
}

export interface RegionOwnershipSnapshot {
  colliders: readonly string[]
  actors: readonly string[]
  props: readonly string[]
  markers: readonly string[]
  interactions: readonly string[]
  loot: readonly string[]
  events: readonly string[]
  projectiles: readonly string[]
  fx: readonly string[]
  outlines: readonly string[]
  disposableCount: number
}

type UnknownRecord = Record<string, unknown>

export class RegionRuntime {
  readonly id: RegionId
  readonly blueprint: RegionBlueprint
  readonly colliderIds = new Set<string>()
  readonly actorIds = new Set<string>()
  readonly propIds = new Set<string>()
  readonly markerIds = new Set<string>()
  readonly interactionIds = new Set<string>()
  readonly lootIds = new Set<string>()
  readonly eventIds = new Set<string>()
  readonly projectileIds = new Set<string>()
  readonly fxIds = new Set<string>()
  readonly outlineIds = new Set<string>()

  private readonly hooks: RegionRuntimeHooks
  private readonly disposables = new Map<number, () => void>()
  private readonly clearedEncounterIds = new Set<string>()
  private readonly defeatedActorIds = new Set<string>()
  private readonly removedPropIds = new Set<string>()
  private readonly collectedLootIds = new Set<string>()
  private readonly completedInteractionIds = new Set<string>()
  private readonly completedEventIds = new Set<string>()
  private deltaState: Record<string, JsonValue> = {}
  private nextDisposableId = 1
  private lifecycleState: RegionLifecycleState = 'blueprint-only'
  private deltaRevision = 0
  private disposed = false

  constructor(
    blueprint: RegionBlueprint,
    regionId?: RegionId,
    hooks: RegionRuntimeHooks = {},
  ) {
    this.blueprint = blueprint
    this.id = regionId ?? readRegionId(blueprint)
    this.hooks = hooks
  }

  get state(): RegionLifecycleState {
    return this.lifecycleState
  }

  get lifecycle(): RegionLifecycleState {
    return this.lifecycleState
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  get revision(): number {
    return this.deltaRevision
  }

  transitionTo(next: RegionLifecycleState): boolean {
    if (next === this.lifecycleState) return false
    if (this.disposed || this.lifecycleState === 'unloaded') return false
    if (next === 'unloaded') {
      this.dispose()
      return true
    }

    const previous = this.lifecycleState
    this.lifecycleState = next
    this.hooks.onTransition?.(this, previous, next)
    return true
  }

  setLifecycleState(next: RegionLifecycleState): boolean {
    return this.transitionTo(next)
  }

  update(deltaSeconds: number): void {
    if (
      this.disposed ||
      this.lifecycleState !== 'simulated' ||
      !Number.isFinite(deltaSeconds) ||
      deltaSeconds < 0
    ) {
      return
    }
    this.hooks.onUpdate?.(this, deltaSeconds)
  }

  own(kind: RegionOwnershipKind, id: string): boolean {
    if (this.disposed || id.length === 0) return false
    const registry = this.registryFor(kind)
    const previousSize = registry.size
    registry.add(id)
    return registry.size !== previousSize
  }

  release(kind: RegionOwnershipKind, id: string): boolean {
    return this.registryFor(kind).delete(id)
  }

  hasOwned(kind: RegionOwnershipKind, id: string): boolean {
    return this.registryFor(kind).has(id)
  }

  getOwnedIds(kind: RegionOwnershipKind): readonly string[] {
    return [...this.registryFor(kind)].sort()
  }

  ownCollider(id: string): boolean {
    return this.own('collider', id)
  }

  ownActor(id: string): boolean {
    return this.own('actor', id)
  }

  ownProp(id: string): boolean {
    return this.own('prop', id)
  }

  ownMarker(id: string): boolean {
    return this.own('marker', id)
  }

  ownInteraction(id: string): boolean {
    return this.own('interaction', id)
  }

  ownLoot(id: string): boolean {
    return this.own('loot', id)
  }

  ownEvent(id: string): boolean {
    return this.own('event', id)
  }

  ownProjectile(id: string): boolean {
    return this.own('projectile', id)
  }

  ownFx(id: string): boolean {
    return this.own('fx', id)
  }

  ownOutline(id: string): boolean {
    return this.own('outline', id)
  }

  addDisposable(callback: () => void): () => void {
    if (this.disposed) {
      callback()
      return () => undefined
    }
    const id = this.nextDisposableId
    this.nextDisposableId += 1
    this.disposables.set(id, callback)
    return () => {
      this.disposables.delete(id)
    }
  }

  registerDisposable(callback: () => void): () => void {
    return this.addDisposable(callback)
  }

  markEncounterCleared(id: string): boolean {
    return this.addDeltaId(this.clearedEncounterIds, id)
  }

  markActorDefeated(id: string): boolean {
    return this.addDeltaId(this.defeatedActorIds, id)
  }

  markUniqueActorDefeated(id: string): boolean {
    return this.markActorDefeated(id)
  }

  markPropRemoved(id: string): boolean {
    return this.addDeltaId(this.removedPropIds, id)
  }

  markPropDestroyed(id: string): boolean {
    return this.markPropRemoved(id)
  }

  markLootCollected(id: string): boolean {
    return this.addDeltaId(this.collectedLootIds, id)
  }

  markLootedInteraction(id: string): boolean {
    return this.markLootCollected(id)
  }

  markInteractionCompleted(id: string): boolean {
    return this.addDeltaId(this.completedInteractionIds, id)
  }

  markEventCompleted(id: string): boolean {
    return this.addDeltaId(this.completedEventIds, id)
  }

  setDeltaValue(key: string, value: unknown): boolean {
    if (this.disposed || !isSafeKey(key)) return false
    const sanitized = sanitizeJson(value)
    if (sanitized === undefined) return false
    const previous = this.deltaState[key]
    if (jsonEqual(previous, sanitized)) return false
    this.deltaState[key] = sanitized
    this.deltaRevision += 1
    return true
  }

  deleteDeltaValue(key: string): boolean {
    if (!Object.hasOwn(this.deltaState, key)) return false
    delete this.deltaState[key]
    this.deltaRevision += 1
    return true
  }

  getDeltaValue(key: string): JsonValue | undefined {
    const value = this.deltaState[key]
    return value === undefined ? undefined : cloneJson(value)
  }

  extractDelta(): RegionDelta {
    return {
      version: REGION_DELTA_VERSION,
      regionId: this.id,
      revision: this.deltaRevision,
      clearedEncounterIds: sorted(this.clearedEncounterIds),
      defeatedActorIds: sorted(this.defeatedActorIds),
      removedPropIds: sorted(this.removedPropIds),
      collectedLootIds: sorted(this.collectedLootIds),
      completedInteractionIds: sorted(this.completedInteractionIds),
      completedEventIds: sorted(this.completedEventIds),
      state: cloneJson(this.deltaState),
    }
  }

  applyDelta(value: unknown): boolean {
    const delta = normalizeRegionDelta(value, this.id)
    if (!delta) return false
    replaceSet(this.clearedEncounterIds, delta.clearedEncounterIds)
    replaceSet(this.defeatedActorIds, delta.defeatedActorIds)
    replaceSet(this.removedPropIds, delta.removedPropIds)
    replaceSet(this.collectedLootIds, delta.collectedLootIds)
    replaceSet(this.completedInteractionIds, delta.completedInteractionIds)
    replaceSet(this.completedEventIds, delta.completedEventIds)
    this.deltaState = cloneJson(delta.state)
    this.deltaRevision = Math.max(this.deltaRevision, delta.revision)
    return true
  }

  getOwnershipSnapshot(): RegionOwnershipSnapshot {
    return {
      colliders: sorted(this.colliderIds),
      actors: sorted(this.actorIds),
      props: sorted(this.propIds),
      markers: sorted(this.markerIds),
      interactions: sorted(this.interactionIds),
      loot: sorted(this.lootIds),
      events: sorted(this.eventIds),
      projectiles: sorted(this.projectileIds),
      fx: sorted(this.fxIds),
      outlines: sorted(this.outlineIds),
      disposableCount: this.disposables.size,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const errors: unknown[] = []
    const previous = this.lifecycleState
    this.lifecycleState = 'unloaded'
    if (previous !== 'unloaded') {
      try {
        this.hooks.onTransition?.(this, previous, 'unloaded')
      } catch (error) {
        errors.push(error)
      }
    }

    const callbacks = [...this.disposables.values()]
    this.disposables.clear()
    for (const callback of callbacks) {
      try {
        callback()
      } catch (error) {
        errors.push(error)
      }
    }
    this.clearOwnership()
    try {
      this.hooks.onDispose?.(this)
    } catch (error) {
      errors.push(error)
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `Failed to dispose region ${String(this.id)}`)
    }
  }

  private addDeltaId(registry: Set<string>, id: string): boolean {
    if (this.disposed || id.length === 0 || registry.has(id)) return false
    registry.add(id)
    this.deltaRevision += 1
    return true
  }

  private registryFor(kind: RegionOwnershipKind): Set<string> {
    switch (kind) {
      case 'collider':
        return this.colliderIds
      case 'actor':
        return this.actorIds
      case 'prop':
        return this.propIds
      case 'marker':
        return this.markerIds
      case 'interaction':
        return this.interactionIds
      case 'loot':
        return this.lootIds
      case 'event':
        return this.eventIds
      case 'projectile':
        return this.projectileIds
      case 'fx':
        return this.fxIds
      case 'outline':
        return this.outlineIds
    }
  }

  private clearOwnership(): void {
    this.colliderIds.clear()
    this.actorIds.clear()
    this.propIds.clear()
    this.markerIds.clear()
    this.interactionIds.clear()
    this.lootIds.clear()
    this.eventIds.clear()
    this.projectileIds.clear()
    this.fxIds.clear()
    this.outlineIds.clear()
  }
}

export function normalizeRegionDelta(
  value: unknown,
  expectedRegionId?: RegionId,
): RegionDelta | null {
  const record = asRecord(value)
  if (!record || record.version !== REGION_DELTA_VERSION) {
    return null
  }
  const rawRegionId = record.regionId
  if (
    typeof rawRegionId !== 'string' ||
    rawRegionId.length === 0 ||
    (expectedRegionId !== undefined &&
      String(rawRegionId) !== String(expectedRegionId))
  ) {
    return null
  }
  const revision = normalizeRevision(record.revision)
  const clearedEncounterIds = sanitizeIdList(record.clearedEncounterIds)
  const defeatedActorIds = sanitizeIdList(record.defeatedActorIds)
  const removedPropIds = sanitizeIdList(record.removedPropIds)
  const collectedLootIds = sanitizeIdList(record.collectedLootIds)
  const completedInteractionIds = sanitizeIdList(
    record.completedInteractionIds,
  )
  const completedEventIds = sanitizeIdList(record.completedEventIds)
  const state = sanitizeState(record.state)
  if (
    revision === null ||
    !clearedEncounterIds ||
    !defeatedActorIds ||
    !removedPropIds ||
    !collectedLootIds ||
    !completedInteractionIds ||
    !completedEventIds ||
    !state
  ) {
    return null
  }

  return {
    version: REGION_DELTA_VERSION,
    regionId: rawRegionId as RegionId,
    revision,
    clearedEncounterIds,
    defeatedActorIds,
    removedPropIds,
    collectedLootIds,
    completedInteractionIds,
    completedEventIds,
    state,
  }
}

function readRegionId(blueprint: RegionBlueprint): RegionId {
  const record = asRecord(blueprint)
  const id = record?.id ?? record?.regionId ?? record?.key
  if (id === undefined || id === null) {
    throw new Error('Region runtime requires a region id')
  }
  return String(id) as RegionId
}

function sanitizeIdList(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || entry.length === 0)
  ) {
    return null
  }
  return [...new Set(value)].sort()
}

function sanitizeState(value: unknown): Record<string, JsonValue> | null {
  const record = asRecord(value)
  if (!record) return null
  const result: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (!isSafeKey(key)) continue
    const sanitized = sanitizeJson(entry)
    if (sanitized !== undefined) result[key] = sanitized
  }
  return result
}

function sanitizeJson(
  value: unknown,
  seen = new Set<object>(),
  depth = 0,
): JsonValue | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (depth >= 32 || typeof value !== 'object' || value === null) {
    return undefined
  }
  if (seen.has(value)) return undefined
  seen.add(value)
  if (Array.isArray(value)) {
    const result: JsonValue[] = []
    for (const entry of value) {
      const sanitized = sanitizeJson(entry, seen, depth + 1)
      if (sanitized !== undefined) result.push(sanitized)
    }
    seen.delete(value)
    return result
  }
  const record = asRecord(value)
  if (!record) {
    seen.delete(value)
    return undefined
  }
  const result: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (!isSafeKey(key)) continue
    const sanitized = sanitizeJson(entry, seen, depth + 1)
    if (sanitized !== undefined) result[key] = sanitized
  }
  seen.delete(value)
  return result
}

function cloneJson<T extends JsonValue>(value: T): T {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJson(entry)) as T
  }
  const result: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    result[key] = cloneJson(entry)
  }
  return result as T
}

function jsonEqual(first: JsonValue | undefined, second: JsonValue): boolean {
  return first !== undefined && JSON.stringify(first) === JSON.stringify(second)
}

function normalizeRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null
}

function isSafeKey(key: string): boolean {
  return key.length > 0 && key !== '__proto__' && key !== 'constructor'
}

function replaceSet(target: Set<string>, values: readonly string[]): void {
  target.clear()
  for (const value of values) target.add(value)
}

function sorted(values: ReadonlySet<string>): string[] {
  return [...values].sort()
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined
}
