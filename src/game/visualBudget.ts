import type { VisualQualityPolicy } from './visualPolicy.ts'
import type { VisualQuality } from './visualSettings.ts'
import { MAX_ACTORS } from './world/ActorBudget.ts'

export const VISUAL_SUBSYSTEMS = Object.freeze(['dynamicArt', 'world', 'postAndEffects'] as const)
export type VisualSubsystem = typeof VISUAL_SUBSYSTEMS[number]

export interface VisualSubsystemLimits {
  readonly wholeFrameDrawCalls: number
  readonly mainViewTriangles: number
  /** Disjoint presentation update plus render-submission scopes in one frame, not summed p95s. */
  readonly cpuMs: number
  readonly cpuBackingBytes: number
  readonly cpuGeometryBytes: number
  /** Subset of cpuGeometryBytes, including the entire mutable geometry clone. */
  readonly cpuBindingCloneBytes: number
  readonly cpuSkinBytes: number
  /** Only additional canonical-sight backing stores, excluding aliased render geometry. */
  readonly cpuCanonicalSightBytes: number
  /** API allocations plus assigned canvas/implicit-MSAA estimates; not resident VRAM. */
  readonly gpuAllocatedBytes: number
}

export interface VisualRolePrototypeLimits {
  readonly nearDraws: number
  readonly midDraws: number
  readonly farDraws: number
  readonly nearMainViewTriangles: number
  readonly exclusiveCpuBackingBytes: number
  readonly constructionPeakCpuBytes: number
  readonly constructionCpuMs: number
  readonly replacementCpuMs: number
  readonly joints: number
}

export interface VisualSubsystemAllocation {
  readonly revision: 'gfx-subsystems-1'
  readonly provisional: true
  readonly quality: VisualQuality
  readonly global: NonNullable<VisualQualityPolicy['budget']>
  readonly population: { readonly players: 1; readonly npcs: number; readonly humanoidProofCount: number }
  readonly limits: Readonly<Record<VisualSubsystem, VisualSubsystemLimits>>
  readonly worldShadows: VisualQualityPolicy['shadows']
  readonly post: VisualQualityPolicy['post']
  /** Reserved within postAndEffects, never added to the global draw ceiling. */
  readonly postDraws: number
  readonly transientEffectDraws: number
  readonly firstRole: VisualRolePrototypeLimits
}

const MIB = 1024 * 1024
function limits(
  draws: number, triangles: number, cpuMs: number, cpu: number, geometry: number,
  clones: number, skin: number, sight: number, gpu: number,
): VisualSubsystemLimits {
  return Object.freeze({
    wholeFrameDrawCalls: draws, mainViewTriangles: triangles, cpuMs,
    cpuBackingBytes: cpu * MIB, cpuGeometryBytes: geometry * MIB,
    cpuBindingCloneBytes: clones * MIB, cpuSkinBytes: skin * MIB,
    cpuCanonicalSightBytes: sight * MIB, gpuAllocatedBytes: gpu * MIB,
  })
}

const SUBSYSTEM_LIMITS: Readonly<Record<VisualQuality, Readonly<Record<VisualSubsystem, VisualSubsystemLimits>>>> =
  Object.freeze({
    high: Object.freeze({
      dynamicArt: limits(360, 250_000, 4, 64, 40, 24, 8, 0, 32),
      world: limits(280, 330_000, 4, 96, 64, 24, 0, 24, 48),
      postAndEffects: limits(60, 20_000, 2, 32, 8, 0, 0, 0, 176),
    }),
    balanced: Object.freeze({
      dynamicArt: limits(260, 120_000, 3, 48, 30, 18, 6, 0, 24),
      world: limits(150, 170_000, 3, 64, 40, 16, 0, 20, 32),
      postAndEffects: limits(40, 10_000, 1, 24, 6, 0, 0, 0, 136),
    }),
    low: Object.freeze({
      dynamicArt: limits(180, 60_000, 4, 32, 20, 12, 4, 0, 16),
      world: limits(100, 85_000, 4, 48, 30, 12, 0, 12, 24),
      postAndEffects: limits(20, 5_000, 2, 16, 4, 0, 0, 0, 88),
    }),
  })

const ROLE_LIMITS: Readonly<Record<VisualQuality, VisualRolePrototypeLimits>> = Object.freeze({
  high: Object.freeze({
    nearDraws: 11, midDraws: 7, farDraws: 4, nearMainViewTriangles: 8_000,
    exclusiveCpuBackingBytes: 2 * MIB, constructionPeakCpuBytes: 6 * MIB,
    constructionCpuMs: 12, replacementCpuMs: 4, joints: 64,
  }),
  balanced: Object.freeze({
    nearDraws: 11, midDraws: 7, farDraws: 4, nearMainViewTriangles: 6_000,
    exclusiveCpuBackingBytes: 1.5 * MIB, constructionPeakCpuBytes: 4 * MIB,
    constructionCpuMs: 10, replacementCpuMs: 4, joints: 64,
  }),
  low: Object.freeze({
    nearDraws: 9, midDraws: 5, farDraws: 3, nearMainViewTriangles: 4_000,
    exclusiveCpuBackingBytes: MIB, constructionPeakCpuBytes: 3 * MIB,
    constructionCpuMs: 8, replacementCpuMs: 4, joints: 64,
  }),
})

/**
 * Acceptance data for consumers, not a settings system or an actor/LOD controller.
 * Off preferences leave unused capacity reserved; no automatic cross-owner borrowing.
 */
export function resolveVisualSubsystemAllocation(policy: VisualQualityPolicy): VisualSubsystemAllocation | null {
  if (policy.mode !== 'enhanced') return null
  if (!policy.budget) throw new Error('Enhanced allocation requires the shared global performance budget')
  const tier = SUBSYSTEM_LIMITS[policy.quality]
  for (const [subsystemMetric, globalMetric] of [
    ['wholeFrameDrawCalls', 'wholeFrameDrawCalls'],
    ['mainViewTriangles', 'mainViewTriangles'],
    ['gpuAllocatedBytes', 'trackedGpuBytes'],
  ] as const) {
    const total = VISUAL_SUBSYSTEMS.reduce((sum, subsystem) => sum + tier[subsystem][subsystemMetric], 0)
    if (total !== policy.budget[globalMetric]) {
      throw new Error(`Visual subsystem allocations no longer partition ${globalMetric}; coordinate a revision`)
    }
  }
  const postDraws = policy.quality === 'low' ? 0 : 16
  return Object.freeze({
    revision: 'gfx-subsystems-1', provisional: true, quality: policy.quality,
    global: Object.freeze({ ...policy.budget }),
    population: Object.freeze({ players: 1, npcs: MAX_ACTORS, humanoidProofCount: MAX_ACTORS + 1 }),
    limits: tier, worldShadows: Object.freeze({ ...policy.shadows }),
    post: Object.freeze({ ...policy.post }),
    postDraws, transientEffectDraws: tier.postAndEffects.wholeFrameDrawCalls - postDraws,
    firstRole: ROLE_LIMITS[policy.quality],
  })
}
