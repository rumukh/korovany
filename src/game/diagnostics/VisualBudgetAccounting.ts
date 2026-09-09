import {
  VISUAL_SUBSYSTEMS,
  type VisualSubsystem,
  type VisualSubsystemAllocation,
} from '../visualBudget.ts'
import type { WorldPresentationDebug } from '../world/WorldPresentationRegistry.ts'
import type { GraphicsDraws, GraphicsFrame, GraphicsPass } from './GraphicsFrameMeter.ts'

export type VisualResourceKind = 'geometry' | 'binding-clone' | 'skin' | 'canonical-sight' | 'other'

/** One physical allocation identity; borrowing never creates another allocation. */
export interface VisualAllocationReceipt {
  readonly identity: object
  readonly chargedTo: VisualSubsystem
  readonly kind: VisualResourceKind
  readonly cpuBytes: number
  readonly gpuBytes: number | null
}

export interface VisualResourceUsage {
  readonly cpuBackingBytes: number
  readonly cpuGeometryBytes: number
  readonly cpuBindingCloneBytes: number
  readonly cpuSkinBytes: number
  readonly cpuCanonicalSightBytes: number
  readonly gpuAllocatedBytes: number | null
}

function amount(value: number, label: string, integral = true): number {
  if (!Number.isFinite(value) || value < 0 || (integral && !Number.isSafeInteger(value))) {
    throw new RangeError(`Invalid visual accounting ${label}`)
  }
  return value
}

/**
 * Snapshot-time accounting only: no disposal, scene walk, storage, timers or GL.
 * Use backing buffers/GL handles as identities, not mesh UUIDs or material keys.
 */
export function sumVisualAllocationReceipts(
  receipts: readonly VisualAllocationReceipt[],
): Readonly<Record<VisualSubsystem, VisualResourceUsage>> {
  const empty = (): VisualResourceUsage => ({
    cpuBackingBytes: 0, cpuGeometryBytes: 0, cpuBindingCloneBytes: 0,
    cpuSkinBytes: 0, cpuCanonicalSightBytes: 0, gpuAllocatedBytes: 0,
  })
  const totals = { dynamicArt: empty(), world: empty(), postAndEffects: empty() }
  const seen = new Map<object, VisualAllocationReceipt>()
  for (const receipt of receipts) {
    if (typeof receipt.identity !== 'object' || receipt.identity === null ||
        !VISUAL_SUBSYSTEMS.includes(receipt.chargedTo) ||
        !['geometry', 'binding-clone', 'skin', 'canonical-sight', 'other'].includes(receipt.kind)) {
      throw new Error('Invalid visual allocation identity, charge owner or kind')
    }
    amount(receipt.cpuBytes, 'CPU bytes')
    if (receipt.gpuBytes !== null) amount(receipt.gpuBytes, 'GPU bytes')
    if (receipt.kind === 'canonical-sight' &&
        (receipt.chargedTo !== 'world' || receipt.gpuBytes !== 0)) {
      throw new Error('Canonical-only sight storage is CPU-only and charged to world')
    }
    const previous = seen.get(receipt.identity)
    if (previous) {
      if (previous.chargedTo !== receipt.chargedTo || previous.kind !== receipt.kind ||
          previous.cpuBytes !== receipt.cpuBytes || previous.gpuBytes !== receipt.gpuBytes) {
        throw new Error('Conflicting receipts for the same visual allocation')
      }
      continue
    }
    seen.set(receipt.identity, receipt)
    const current = totals[receipt.chargedTo]
    totals[receipt.chargedTo] = {
      cpuBackingBytes: current.cpuBackingBytes + receipt.cpuBytes,
      cpuGeometryBytes: current.cpuGeometryBytes +
        (receipt.kind === 'geometry' || receipt.kind === 'binding-clone' ? receipt.cpuBytes : 0),
      cpuBindingCloneBytes: current.cpuBindingCloneBytes + (receipt.kind === 'binding-clone' ? receipt.cpuBytes : 0),
      cpuSkinBytes: current.cpuSkinBytes + (receipt.kind === 'skin' ? receipt.cpuBytes : 0),
      cpuCanonicalSightBytes: current.cpuCanonicalSightBytes + (receipt.kind === 'canonical-sight' ? receipt.cpuBytes : 0),
      gpuAllocatedBytes: current.gpuAllocatedBytes === null || receipt.gpuBytes === null
        ? null : current.gpuAllocatedBytes + receipt.gpuBytes,
    }
  }
  for (const subsystem of VISUAL_SUBSYSTEMS) {
    for (const value of Object.values(totals[subsystem])) {
      if (value !== null) amount(value, 'retained resource total')
    }
    Object.freeze(totals[subsystem])
  }
  return Object.freeze(totals)
}

export interface VisualSubsystemUsage {
  readonly draws: Readonly<Record<GraphicsPass, Readonly<GraphicsDraws>>> | null
  readonly cpuMs: number | null
  readonly resources: VisualResourceUsage | null
}

export interface VisualBudgetEvidence {
  readonly subsystems: Readonly<Record<VisualSubsystem, VisualSubsystemUsage>>
  readonly frame: Pick<GraphicsFrame, 'draws' | 'total' | 'counterAgreement' | 'cpuMs' | 'resources'>
  /** Explicit inventory closure; known receipts alone do not prove complete coverage. */
  readonly resourcesComplete: boolean
  /** Color resolve + actual MSAA color/depth estimate from the same frame's viewport. */
  readonly defaultFramebufferBytes: number | null
  readonly worldShadows: Pick<WorldPresentationDebug, 'shadowDraws' | 'shadowInstances' | 'shadowTriangles'> | null
}

export interface VisualBudgetIssue {
  readonly scope: VisualSubsystem | 'global' | 'reconciliation'
  readonly metric: string
  readonly observed: number
  readonly limit: number
}

export interface VisualBudgetAssessment {
  readonly status: 'within-provisional-envelope' | 'incomplete' | 'over-budget-or-inconsistent'
  readonly provisional: true
  readonly issues: readonly VisualBudgetIssue[]
  readonly missing: readonly string[]
  readonly remainingFrameCpuMs: number | null
}

const PASSES = ['scene', 'ink', 'shadow', 'post'] as const
const DRAW_METRICS = ['calls', 'triangles', 'lines', 'points'] as const
const RESOURCE_METRICS = [
  'cpuBackingBytes', 'cpuGeometryBytes', 'cpuBindingCloneBytes', 'cpuSkinBytes',
  'cpuCanonicalSightBytes', 'gpuAllocatedBytes',
] as const

/** A within result is only this frame/inventory against provisional limits, never device approval. */
export function assessVisualSubsystemBudget(
  allocation: VisualSubsystemAllocation,
  evidence: VisualBudgetEvidence,
): VisualBudgetAssessment {
  const issues: VisualBudgetIssue[] = []
  const missing = new Set<string>()
  const check = (scope: VisualBudgetIssue['scope'], metric: string, observed: number, limit: number) => {
    if (observed > limit) issues.push({ scope, metric, observed, limit })
  }
  const reconcile = (metric: string, observed: number, expected: number) => {
    if (Math.abs(observed - expected) > 1e-6) {
      issues.push({ scope: 'reconciliation', metric, observed, limit: expected })
    }
  }
  const frame = evidence.frame
  amount(frame.cpuMs, 'frame CPU duration', false)
  if (!evidence.resourcesComplete) missing.add('complete retained allocation inventory')
  let cpuTotal = 0
  let gpuTotal = 0
  let allCpu = true
  let allGpu = true
  let allDraws = true
  for (const subsystem of VISUAL_SUBSYSTEMS) {
    const usage = evidence.subsystems[subsystem]
    const limit = allocation.limits[subsystem]
    if (usage.cpuMs === null) { missing.add(`${subsystem}.cpuMs`); allCpu = false }
    else {
      cpuTotal += amount(usage.cpuMs, `${subsystem}.cpuMs`, false)
      check(subsystem, 'cpuMs', usage.cpuMs, limit.cpuMs)
    }
    if (!usage.resources) { missing.add(`${subsystem}.resources`); allGpu = false }
    else {
      for (const metric of RESOURCE_METRICS) {
        const value = usage.resources[metric]
        if (value === null) { missing.add(`${subsystem}.${metric}`); allGpu = false; continue }
        amount(value, `${subsystem}.${metric}`)
        check(subsystem, metric, value, limit[metric])
      }
      const memory = usage.resources
      check('reconciliation', `${subsystem}.cloneSubset`, memory.cpuBindingCloneBytes, memory.cpuGeometryBytes)
      check('reconciliation', `${subsystem}.CPUcategories`,
        memory.cpuGeometryBytes + memory.cpuSkinBytes + memory.cpuCanonicalSightBytes, memory.cpuBackingBytes)
      gpuTotal += memory.gpuAllocatedBytes ?? 0
    }
    if (!usage.draws) { missing.add(`${subsystem}.draws`); allDraws = false; continue }
    let calls = 0
    for (const pass of PASSES) {
      for (const metric of DRAW_METRICS) amount(usage.draws[pass][metric], `${subsystem}.${pass}.${metric}`, metric !== 'triangles')
      calls += usage.draws[pass].calls
    }
    check(subsystem, 'wholeFrameDrawCalls', calls, limit.wholeFrameDrawCalls)
    check(subsystem, 'mainViewTriangles',
      usage.draws.scene.triangles + usage.draws.ink.triangles, limit.mainViewTriangles)
    check(subsystem, 'post.calls', usage.draws.post.calls,
      subsystem === 'postAndEffects' && allocation.post.enabled ? allocation.postDraws : 0)
    if (subsystem === 'postAndEffects') {
      check(subsystem, 'transientEffectDraws', calls - usage.draws.post.calls, allocation.transientEffectDraws)
    }
  }
  check('reconciliation', 'disjoint presentation CPU scopes', cpuTotal, frame.cpuMs + 1e-6)
  if (frame.counterAgreement === false) issues.push({
    scope: 'reconciliation', metric: 'GL/renderer counter agreement', observed: 0, limit: 1,
  })
  else if (frame.counterAgreement === null) missing.add('whole-frame GL/renderer counters')
  if (!frame.draws || !frame.total) missing.add('whole-frame pass data')
  else {
    for (const metric of DRAW_METRICS) {
      const actual = amount(frame.total[metric], `frame total ${metric}`, metric !== 'triangles')
      const summedPasses = PASSES.reduce((sum, pass) =>
        sum + amount(frame.draws![pass][metric], `frame ${pass}.${metric}`, metric !== 'triangles'), 0)
      reconcile(`frame total ${metric}`, summedPasses, actual)
      if (allDraws) for (const pass of PASSES) {
        reconcile(`${pass}.${metric}`, VISUAL_SUBSYSTEMS.reduce((sum, subsystem) =>
          sum + evidence.subsystems[subsystem].draws![pass][metric], 0), frame.draws[pass][metric])
      }
    }
    check('global', 'wholeFrameDrawCalls', frame.total.calls, allocation.global.wholeFrameDrawCalls)
    check('global', 'mainViewTriangles', frame.draws.scene.triangles + frame.draws.ink.triangles,
      allocation.global.mainViewTriangles)
  }
  const shadows = evidence.worldShadows
  if (!shadows) missing.add('world submitted-shadow costs')
  else {
    for (const [metric, policyMetric] of [
      ['shadowDraws', 'worldCasterBudget'], ['shadowInstances', 'worldInstanceBudget'],
      ['shadowTriangles', 'worldTriangleBudget'],
    ] as const) {
      check('world', metric, amount(shadows[metric], metric), allocation.worldShadows[policyMetric])
    }
    const draws = evidence.subsystems.world.draws
    if (draws) {
      reconcile('world.shadow.calls', shadows.shadowDraws, draws.shadow.calls)
      reconcile('world.shadow.triangles', shadows.shadowTriangles, draws.shadow.triangles)
    }
  }
  if (evidence.defaultFramebufferBytes === null) missing.add('canvas allocation estimate')
  else amount(evidence.defaultFramebufferBytes, 'canvas allocation estimate')
  if (!frame.resources || !frame.resources.trackingActive) missing.add('active whole-frame allocation ledger')
  else {
    if (frame.resources.unknownFormats.length) missing.add('known sizes for all GPU formats')
    if (evidence.defaultFramebufferBytes !== null) {
      const total = amount(frame.resources.trackedBytes, 'GL storage bytes') +
        amount(frame.resources.implicitMultisampleBytesEstimate, 'implicit MSAA bytes') + evidence.defaultFramebufferBytes
      check('global', 'gpuAllocatedBytes', total, allocation.global.trackedGpuBytes)
      if (allGpu) reconcile('GPU allocation ownership', gpuTotal, total)
    }
  }
  return Object.freeze({
    status: issues.length ? 'over-budget-or-inconsistent' : missing.size ? 'incomplete' : 'within-provisional-envelope',
    provisional: true,
    issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
    missing: Object.freeze([...missing]),
    /** The remaining CPU includes unchanged gameplay/shared work; it is not a free art allowance. */
    remainingFrameCpuMs: allCpu ? Math.max(0, frame.cpuMs - cpuTotal) : null,
  })
}
