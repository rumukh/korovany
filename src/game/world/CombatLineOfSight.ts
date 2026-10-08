import type {
  Collider,
  CollisionWorldDebugStats,
} from '../systems/CollisionWorld.ts'
import type { Bounds2D } from './TerrainSystem.ts'

export const COMBAT_LOS_CACHE_GRID = 4
export const MAX_COMBAT_LOS_QUERIES_PER_FRAME = 64

export interface CombatLosPoint {
  x: number
  z: number
}

export type CombatLosQueryKind =
  | 'archerAdmission'
  | 'npcMelee'
  | 'npcArrow'
  | 'playerMelee'

export type CombatLosResult =
  | { status: 'clear' }
  | { status: 'blocked'; fraction: number }
  | { status: 'deferred' }

export interface CombatLosFrameStats {
  npcBroadPhaseQueries: number
  playerBroadPhaseQueries: number
  cacheHits: number
  archerDeferrals: number
  npcMeleeFailClosed: number
  npcArrowFailClosed: number
  resolverMilliseconds: number
}

export interface CombatCollisionSource {
  queryBounds(bounds: Bounds2D): Collider[]
  getDebugStats(): CollisionWorldDebugStats
}

interface CombatLosSegment {
  start: CombatLosPoint
  end: CombatLosPoint
}

export function isSolidCombatCollider(collider: Collider): boolean {
  if (
    collider.enabled === false ||
    collider.blocksMovement === false
  ) {
    return false
  }
  const tags = collider.tags ?? []
  return (
    !tags.includes('water') &&
    !tags.includes('foliage') &&
    !tags.includes('soft')
  )
}

export function firstSolidCoverHit(
  start: CombatLosPoint,
  end: CombatLosPoint,
  colliders: readonly Collider[],
  radius = 0,
): number | null {
  return firstColliderCoverHit(
    start,
    end,
    colliders,
    radius,
    isSolidCombatCollider,
  )
}

export function firstColliderCoverHit(
  start: CombatLosPoint,
  end: CombatLosPoint,
  colliders: readonly Collider[],
  radius = 0,
  accepts: (collider: Collider) => boolean = () => true,
): number | null {
  if (!Number.isFinite(radius) || radius < 0) {
    throw new RangeError('Combat cover radius must be finite and non-negative')
  }
  const dx = end.x - start.x
  const dz = end.z - start.z
  let first: number | null = null
  for (const collider of colliders) {
    if (!accepts(collider)) continue
    let hit: number | null = null
    if (collider.shape === 'circle') {
      const ox = start.x - collider.x
      const oz = start.z - collider.z
      const combinedRadius = collider.radius + radius
      const a = dx * dx + dz * dz
      const c =
        ox * ox +
        oz * oz -
        combinedRadius * combinedRadius
      const b = ox * dx + oz * dz
      const discriminant = b * b - a * c
      if (c <= 0) {
        hit = 0
      } else if (a > 0 && discriminant >= 0) {
        const fraction = (-b - Math.sqrt(discriminant)) / a
        if (fraction >= 0 && fraction <= 1) hit = fraction
      }
    } else {
      const cosine = Math.cos(collider.rotation ?? 0)
      const sine = Math.sin(collider.rotation ?? 0)
      const ox = start.x - collider.x
      const oz = start.z - collider.z
      const axes = [
        [
          ox * cosine + oz * sine,
          dx * cosine + dz * sine,
          collider.halfWidth + radius,
        ],
        [
          -ox * sine + oz * cosine,
          -dx * sine + dz * cosine,
          collider.halfDepth + radius,
        ],
      ]
      let near = 0
      let far = 1
      for (const [origin, direction, half] of axes) {
        if (Math.abs(direction) < 1e-9) {
          if (Math.abs(origin) > half) {
            far = -1
            break
          }
        } else {
          const left = (-half - origin) / direction
          const right = (half - origin) / direction
          near = Math.max(near, Math.min(left, right))
          far = Math.min(far, Math.max(left, right))
        }
      }
      if (near <= far) hit = near
    }
    if (hit !== null && (first === null || hit < first)) {
      first = hit
    }
  }
  return first
}

function meleeSegments(
  attacker: CombatLosPoint,
  target: CombatLosPoint,
  targetRadius: number,
): CombatLosSegment[] {
  const dx = target.x - attacker.x
  const dz = target.z - attacker.z
  const length = Math.hypot(dx, dz)
  const safeRadius = Number.isFinite(targetRadius)
    ? Math.max(0, targetRadius)
    : 0
  const tangentX = length > 1e-9
    ? -dz / length * safeRadius
    : 0
  const tangentZ = length > 1e-9
    ? dx / length * safeRadius
    : 0
  return [
    { start: attacker, end: target },
    {
      start: attacker,
      end: {
        x: target.x + tangentX,
        z: target.z + tangentZ,
      },
    },
    {
      start: attacker,
      end: {
        x: target.x - tangentX,
        z: target.z - tangentZ,
      },
    },
  ]
}

function emptyFrameStats(): CombatLosFrameStats {
  return {
    npcBroadPhaseQueries: 0,
    playerBroadPhaseQueries: 0,
    cacheHits: 0,
    archerDeferrals: 0,
    npcMeleeFailClosed: 0,
    npcArrowFailClosed: 0,
    resolverMilliseconds: 0,
  }
}

export class CombatLineOfSight {
  private readonly candidates = new Map<string, Collider[]>()
  private readonly collision: CombatCollisionSource
  private readonly now: (() => number) | null
  private frameStats = emptyFrameStats()

  constructor(
    collision: CombatCollisionSource,
    now: (() => number) | null = null,
  ) {
    this.collision = collision
    this.now = now
  }

  beginFrame(): void {
    this.candidates.clear()
    this.frameStats = emptyFrameStats()
  }

  snapshot(): CombatLosFrameStats {
    return {
      ...this.frameStats,
    }
  }

  segment(
    start: CombatLosPoint,
    end: CombatLosPoint,
    kind: Exclude<CombatLosQueryKind, 'npcMelee' | 'playerMelee'>,
    radius = 0,
  ): CombatLosResult {
    const started = this.now?.() ?? 0
    const segments = [{ start, end }]
    const candidates = this.queryCandidates(segments, radius, kind)
    let result: CombatLosResult
    if (!candidates) {
      result = this.overflow(kind)
    } else {
      const hit = firstSolidCoverHit(start, end, candidates, radius)
      result = hit === null
        ? { status: 'clear' }
        : { status: 'blocked', fraction: hit }
    }
    this.finishTiming(started)
    return result
  }

  melee(
    attacker: CombatLosPoint,
    target: CombatLosPoint,
    targetRadius: number,
    kind: Extract<CombatLosQueryKind, 'npcMelee' | 'playerMelee'>,
  ): CombatLosResult {
    const started = this.now?.() ?? 0
    const segments = meleeSegments(attacker, target, targetRadius)
    const candidates = this.queryCandidates(segments, 0, kind)
    if (!candidates) {
      const result = this.overflow(kind)
      this.finishTiming(started)
      return result
    }
    let first: number | null = null
    for (const segment of segments) {
      const hit = firstSolidCoverHit(
        segment.start,
        segment.end,
        candidates,
      )
      if (hit === null) {
        this.finishTiming(started)
        return { status: 'clear' }
      }
      first = first === null ? hit : Math.min(first, hit)
    }
    const result: CombatLosResult = {
      status: 'blocked',
      fraction: first ?? 0,
    }
    this.finishTiming(started)
    return result
  }

  private queryCandidates(
    segments: readonly CombatLosSegment[],
    radius: number,
    kind: CombatLosQueryKind,
  ): Collider[] | null {
    const revision = this.collision.getDebugStats().revision
    const bounds = this.cacheBounds(segments, radius)
    const key = [
      revision,
      bounds.minX,
      bounds.minZ,
      bounds.maxX,
      bounds.maxZ,
    ].join(':')
    const cached = this.candidates.get(key)
    if (cached) {
      this.frameStats.cacheHits += 1
      return cached
    }

    if (kind === 'playerMelee') {
      this.frameStats.playerBroadPhaseQueries += 1
    } else {
      if (
        this.frameStats.npcBroadPhaseQueries >=
        MAX_COMBAT_LOS_QUERIES_PER_FRAME
      ) {
        return null
      }
      this.frameStats.npcBroadPhaseQueries += 1
    }
    const colliders = this.collision
      .queryBounds(bounds)
      .filter(isSolidCombatCollider)
    this.candidates.set(key, colliders)
    return colliders
  }

  private cacheBounds(
    segments: readonly CombatLosSegment[],
    radius: number,
  ): Bounds2D {
    let minX = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    for (const segment of segments) {
      minX = Math.min(minX, segment.start.x, segment.end.x)
      minZ = Math.min(minZ, segment.start.z, segment.end.z)
      maxX = Math.max(maxX, segment.start.x, segment.end.x)
      maxZ = Math.max(maxZ, segment.start.z, segment.end.z)
    }
    const safeRadius = Number.isFinite(radius)
      ? Math.max(0, radius)
      : 0
    return {
      minX:
        Math.floor((minX - safeRadius) / COMBAT_LOS_CACHE_GRID) *
        COMBAT_LOS_CACHE_GRID,
      minZ:
        Math.floor((minZ - safeRadius) / COMBAT_LOS_CACHE_GRID) *
        COMBAT_LOS_CACHE_GRID,
      maxX:
        Math.ceil((maxX + safeRadius) / COMBAT_LOS_CACHE_GRID) *
        COMBAT_LOS_CACHE_GRID,
      maxZ:
        Math.ceil((maxZ + safeRadius) / COMBAT_LOS_CACHE_GRID) *
        COMBAT_LOS_CACHE_GRID,
    }
  }

  private overflow(kind: CombatLosQueryKind): CombatLosResult {
    if (kind === 'archerAdmission') {
      this.frameStats.archerDeferrals += 1
      return { status: 'deferred' }
    }
    if (kind === 'npcMelee') {
      this.frameStats.npcMeleeFailClosed += 1
    } else if (kind === 'npcArrow') {
      this.frameStats.npcArrowFailClosed += 1
    }
    return {
      status: 'blocked',
      fraction: 0,
    }
  }

  private finishTiming(started: number): void {
    if (!this.now) return
    this.frameStats.resolverMilliseconds += Math.max(
      0,
      this.now() - started,
    )
  }
}
