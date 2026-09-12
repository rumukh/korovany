import * as THREE from 'three'
import { StylizedArtLibrary } from '../art/StylizedArtLibrary.ts'
import { VISUAL_SUBSYSTEMS, type VisualSubsystem } from '../visualBudget.ts'
import type { GraphicsDraws, GraphicsPass } from './GraphicsFrameMeter.ts'

export type GraphicsCharge = VisualSubsystem | 'unattributed'
export interface GraphicsSourceRoot { readonly root: THREE.Object3D; readonly subsystem: VisualSubsystem }
export interface GraphicsSubmission extends GraphicsDraws { submittedInstances: number }
export type GraphicsSubmissionPasses = Record<GraphicsPass, GraphicsSubmission>
export const GRAPHICS_PASSES = ['scene', 'ink', 'shadow', 'post'] as const
export const GRAPHICS_CHARGES = [...VISUAL_SUBSYSTEMS, 'unattributed'] as const
export const GRAPHICS_SOURCE_DETAIL_LIMIT = 2048
export const emptySubmission = (): GraphicsSubmission => ({
  calls: 0, triangles: 0, lines: 0, points: 0, submittedInstances: 0,
})
export const emptySubmissionPasses = (): GraphicsSubmissionPasses => ({
  scene: emptySubmission(), ink: emptySubmission(), shadow: emptySubmission(), post: emptySubmission(),
})

export interface GraphicsSourceSubmission {
  readonly sourceId: number | null
  readonly sourceName: string | null
  readonly borrowedSourceId: number | null
  readonly materialId: string | null
  readonly group: { start: number; count: number; materialIndex: number | null } | null
  readonly owner: GraphicsCharge
  readonly pass: GraphicsPass
  readonly reason: string
  readonly work: GraphicsSubmission
}
export interface GraphicsSubsystemFrame {
  readonly byOwner: Record<GraphicsCharge, GraphicsSubmissionPasses>
  readonly reconciled: boolean
  readonly attributionComplete: boolean
  readonly detailOverflow: number
  readonly missing: readonly string[]
}

/** Only parent identity lookup at submission time; never a per-frame scene traversal. */
export class GraphicsSourceResolver {
  private roots = new WeakMap<THREE.Object3D, VisualSubsystem | 'conflict'>()
  private readonly readRoots: () => readonly GraphicsSourceRoot[]
  private readonly rootLimit: number
  rootOverflow = 0

  constructor(readRoots: () => readonly GraphicsSourceRoot[] = () => [], rootLimit = 4096) {
    this.readRoots = readRoots
    this.rootLimit = rootLimit
  }

  beginFrame(): void {
    this.roots = new WeakMap()
    const roots = this.readRoots()
    this.rootOverflow = Math.max(0, roots.length - this.rootLimit)
    for (const { root, subsystem } of roots.slice(0, this.rootLimit)) {
      const previous = this.roots.get(root)
      this.roots.set(root, previous && previous !== subsystem ? 'conflict' : subsystem)
    }
  }

  resolve(object: THREE.Object3D | null, pass: GraphicsPass): { owner: GraphicsCharge; reason: string } {
    if (!object) return { owner: 'unattributed', reason: 'raw GL without a source boundary' }
    // A borrowed shell's copyable userData cannot overrule the actual source.
    let node = StylizedArtLibrary.isOutlineShell(object) ? object.parent : object
    for (let depth = 0; node && depth < 64; depth++, node = node.parent) {
      const explicit: unknown = node.userData.visualSubsystem
      const root = this.roots.get(node)
      if (root === 'conflict') return { owner: 'unattributed', reason: 'conflicting source-root owners' }
      if (explicit !== undefined) {
        const owner = VISUAL_SUBSYSTEMS.find((value) => value === explicit)
        if (!owner || (root && root !== owner)) return { owner: 'unattributed', reason: 'invalid or conflicting source owner' }
        return { owner, reason: 'production source identity' }
      }
      if (root) return { owner: root, reason: 'live production owner root' }
    }
    if (node) return { owner: 'unattributed', reason: 'source ancestor limit exceeded' }
    return pass === 'post'
      ? { owner: 'postAndEffects', reason: 'observed non-world render pass' }
      : { owner: 'unattributed', reason: 'no production source owner' }
  }

  clear(): void { this.roots = new WeakMap(); this.rootOverflow = 0 }
}

export class GraphicsSubsystemSubmissions {
  readonly resolver: GraphicsSourceResolver
  private bins = this.emptyBins()
  private details = new Map<string, GraphicsSourceSubmission>()
  private overflow = 0
  private context: Omit<GraphicsSourceSubmission, 'work'> | null = null

  constructor(readRoots?: () => readonly GraphicsSourceRoot[]) {
    this.resolver = new GraphicsSourceResolver(readRoots)
  }

  private emptyBins(): Record<GraphicsCharge, GraphicsSubmissionPasses> {
    return {
      dynamicArt: emptySubmissionPasses(), world: emptySubmissionPasses(),
      postAndEffects: emptySubmissionPasses(), unattributed: emptySubmissionPasses(),
    }
  }

  begin(): void {
    this.bins = this.emptyBins()
    this.details = new Map()
    this.overflow = 0
    this.context = null
    this.resolver.beginFrame()
  }

  withSource<T>(object: THREE.Object3D | null, material: THREE.Material | null,
    group: { start: number; count: number; materialIndex?: number } | null,
    pass: GraphicsPass, action: () => T): T {
    const previous = this.context
    const resolved = this.resolver.resolve(object, pass)
    this.context = {
      sourceId: object?.id ?? null, sourceName: object?.name ?? null,
      borrowedSourceId: object && StylizedArtLibrary.isOutlineShell(object) ? object.parent?.id ?? null : null,
      materialId: material?.uuid ?? null,
      group: group ? { start: group.start, count: group.count, materialIndex: group.materialIndex ?? null } : null,
      pass, ...resolved,
    }
    try { return action() } finally { this.context = previous }
  }

  /** Takes the delta of the ONE existing GL counter, never increments renderer.info. */
  record(pass: GraphicsPass, delta: GraphicsDraws, instances: number): void {
    const context = this.context ?? {
      sourceId: null, sourceName: null, borrowedSourceId: null, materialId: null, group: null,
      owner: 'unattributed' as const, pass, reason: 'raw GL without a source boundary',
    }
    const add = (target: GraphicsSubmission) => {
      for (const key of ['calls', 'triangles', 'lines', 'points'] as const) target[key] += delta[key]
      target.submittedInstances += instances
    }
    add(this.bins[context.owner][pass])
    const key = `${context.sourceId}:${context.materialId}:${pass}:${context.owner}:${context.group?.start}:${context.group?.count}:${context.group?.materialIndex}`
    let detail = this.details.get(key)
    if (!detail && this.details.size < GRAPHICS_SOURCE_DETAIL_LIMIT) {
      detail = { ...context, pass, work: emptySubmission() }
      this.details.set(key, detail)
    }
    if (detail) add(detail.work)
    else this.overflow++
  }

  snapshot(wholeFrame: Record<GraphicsPass, GraphicsDraws>): GraphicsSubsystemFrame {
    const missing: string[] = []
    const reconciled = GRAPHICS_PASSES.every((pass) =>
      (['calls', 'triangles', 'lines', 'points'] as const).every((metric) =>
        Math.abs(GRAPHICS_CHARGES.reduce((sum, owner) => sum + this.bins[owner][pass][metric], 0) -
          wholeFrame[pass][metric]) < 1e-6))
    if (GRAPHICS_PASSES.some((pass) => this.bins.unattributed[pass].calls > 0)) missing.push('unattributed source submissions')
    if (this.resolver.rootOverflow) missing.push(`source root overflow: ${this.resolver.rootOverflow}`)
    if (this.overflow) missing.push(`source detail overflow: ${this.overflow}`)
    return {
      byOwner: this.bins, reconciled,
      attributionComplete: reconciled && missing.length === 0,
      detailOverflow: this.overflow, missing,
    }
  }

  sourceDetails(): readonly GraphicsSourceSubmission[] { return [...this.details.values()] }

  clear(): void {
    this.resolver.clear()
    this.details.clear()
    this.context = null
    this.bins = this.emptyBins()
  }
}
