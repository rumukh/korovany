import * as THREE from 'three'
import { VISUAL_SUBSYSTEMS, resolveVisualSubsystemAllocation, type VisualSubsystem } from '../visualBudget.ts'
import type { VisualQualityPolicy } from '../visualPolicy.ts'
import {
  assessVisualSubsystemBudget, sumVisualAllocationReceipts,
  type VisualAllocationReceipt, type VisualResourceKind,
} from './VisualBudgetAccounting.ts'
import type { GraphicsFrame } from './GraphicsFrameMeter.ts'
import { GraphicsResources } from './GraphicsResources.ts'
import {
  GraphicsSourceResolver, type GraphicsSourceRoot, type GraphicsSourceSubmission,
} from './GraphicsSubsystemSubmissions.ts'

export interface GraphicsOwnerInventory {
  readonly name: string
  readonly subsystem: VisualSubsystem
  readonly receipts: readonly VisualAllocationReceipt[]
  readonly sources: readonly THREE.Object3D[]
  readonly missing: readonly string[]
}
export interface GraphicsSubsystemInputs {
  readonly policy: VisualQualityPolicy
  readonly roots: readonly GraphicsSourceRoot[]
  readonly owners: readonly GraphicsOwnerInventory[]
  /** Already-created standard-family ramp/contact maps, billed once to the pipeline by policy. */
  readonly standardPipelineTextures: readonly THREE.Texture[]
  readonly missing: readonly string[]
}
interface CpuAllocation {
  readonly identity: object
  readonly owners: Set<VisualSubsystem>
  readonly kinds: Set<VisualResourceKind>
  readonly bytes: number
  readonly providers: Set<string>
  readonly cpuOnly: boolean
  conflict: boolean
}

const SNAPSHOT_NODE_LIMIT = 100_000
const SNAPSHOT_RECEIPT_LIMIT = 100_000

function textureData(texture: THREE.Texture): object | null {
  const image: unknown = texture.image
  if (!image || typeof image !== 'object') return null
  const data: unknown = Reflect.get(image, 'data')
  return ArrayBuffer.isView(data) ? data.buffer : image
}

/**
 * Inventory is collected only on explicit diagnostic snapshots. No retained mesh
 * registry: LIVE owners are read afresh; JS/driver/temporary peaks remain unknown.
 */
export function collectGraphicsSubsystemInventory(
  inputs: GraphicsSubsystemInputs,
  resources: GraphicsResources,
  properties: THREE.WebGLRenderer['properties'],
) {
  const missing = new Set(inputs.missing)
  const cpu = new Map<object, CpuAllocation>()
  const claims = new Map<object, Set<VisualSubsystem>>()
  const standardPipelineTextures = new Set(inputs.standardPipelineTextures)
  const standardMapBackings = new Set([...standardPipelineTextures].map(textureData).filter((value) => value !== null))
  const resolver = new GraphicsSourceResolver(() => [
    ...inputs.roots,
    ...inputs.owners.flatMap((owner) => owner.sources.map((root) => ({ root, subsystem: owner.subsystem }))),
  ])
  resolver.beginFrame()
  const visited = new Set<THREE.Object3D>()
  const materials = new Map<THREE.Material, Set<VisualSubsystem>>()
  const textures = new Map<THREE.Texture, Set<VisualSubsystem>>()
  let receiptCount = 0, duplicateReceipts = 0, unownedSources = 0
  const unownedBackings = new Map<object, number>()
  const addClaim = (identity: object, owner: VisualSubsystem) => {
    let owners = claims.get(identity)
    if (!owners) { owners = new Set(); claims.set(identity, owners) }
    owners.add(owner)
  }
  const receipt = (value: VisualAllocationReceipt, provider: string, authoritative = true) => {
    if (++receiptCount > SNAPSHOT_RECEIPT_LIMIT) {
      missing.add('receipt inventory capacity exceeded')
      return
    }
    // Reuse the production receipt validator, including canonical-sight's CPU-only invariant.
    sumVisualAllocationReceipts([value])
    addClaim(value.identity, value.chargedTo)
    const billedOwner = value.kind === 'other' && standardMapBackings.has(value.identity)
      ? 'postAndEffects' : value.chargedTo
    const existing = cpu.get(value.identity)
    if (existing) {
      duplicateReceipts++
      existing.owners.add(billedOwner)
      existing.providers.add(provider)
      if (authoritative) existing.kinds.add(value.kind)
      existing.conflict ||= existing.bytes !== value.cpuBytes ||
        (authoritative && existing.cpuOnly !== (value.gpuBytes === 0))
      return
    }
    cpu.set(value.identity, {
      identity: value.identity, owners: new Set([billedOwner]), kinds: new Set([value.kind]),
      bytes: value.cpuBytes, cpuOnly: value.gpuBytes === 0, providers: new Set([provider]), conflict: false,
    })
  }
  for (const owner of inputs.owners) {
    for (const item of owner.receipts) receipt(item, owner.name)
  }

  const backing = (array: ArrayBufferView, owner: VisualSubsystem | 'unattributed',
    kind: VisualResourceKind, provider: string) => {
    if (owner === 'unattributed') {
      unownedBackings.set(array.buffer, array.buffer.byteLength)
      return
    }
    receipt({ identity: array.buffer, chargedTo: owner, kind, cpuBytes: array.buffer.byteLength,
      gpuBytes: null }, provider, false)
  }
  const geometry = (value: THREE.BufferGeometry, owner: VisualSubsystem | 'unattributed', provider: string) => {
    for (const attribute of [
      ...Object.values(value.attributes), ...(value.index ? [value.index] : []),
      ...Object.values(value.morphAttributes).flat(),
    ]) {
      backing(attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : attribute.array,
        owner, 'geometry', provider)
    }
  }
  const markMaterial = (material: THREE.Material, owner: VisualSubsystem) => {
    let owners = materials.get(material)
    if (!owners) { owners = new Set(); materials.set(material, owners) }
    owners.add(owner)
  }
  const visit = (object: THREE.Object3D) => {
    if (visited.has(object)) return
    if (visited.size >= SNAPSHOT_NODE_LIMIT) { missing.add('source inventory node capacity exceeded'); return }
    visited.add(object)
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite ||
      object instanceof THREE.Points || object instanceof THREE.Line)) return
    const { owner } = resolver.resolve(object, 'scene')
    if (owner === 'unattributed') unownedSources++
    if ('geometry' in object) geometry(object.geometry, owner, `source:${object.id}`)
    if (object instanceof THREE.InstancedMesh) {
      backing(object.instanceMatrix.array, owner, 'geometry', `instance:${object.id}`)
      if (object.instanceColor) backing(object.instanceColor.array, owner, 'geometry', `instance:${object.id}`)
    }
    if (object instanceof THREE.SkinnedMesh) {
      if (object.skeleton.boneMatrices) backing(object.skeleton.boneMatrices, owner, 'skin', `skeleton:${object.skeleton.uuid}`)
      if (object.skeleton.boneTexture && owner !== 'unattributed') {
        const owners = textures.get(object.skeleton.boneTexture) ?? new Set<VisualSubsystem>()
        owners.add(owner)
        textures.set(object.skeleton.boneTexture, owners)
      }
    }
    if (owner !== 'unattributed') {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) markMaterial(material, owner)
      if (object instanceof THREE.Mesh && object.customDepthMaterial) markMaterial(object.customDepthMaterial, owner)
    }
  }
  // Iterative, bounded snapshot traversal. Shells are visited for material/skin
  // identities but borrow the source's charge; buffers are deduplicated below.
  const pending = [
    ...inputs.roots.map((entry) => entry.root),
    ...inputs.owners.flatMap((entry) => entry.sources),
  ]
  while (pending.length) {
    const object = pending.pop()!
    if (visited.has(object)) continue
    if (visited.size >= SNAPSHOT_NODE_LIMIT) { missing.add('source inventory node capacity exceeded'); break }
    visit(object)
    pending.push(...object.children)
  }
  const texture = (value: THREE.Texture, owners: ReadonlySet<VisualSubsystem>) => {
    const previous = textures.get(value) ?? new Set<VisualSubsystem>()
    for (const owner of owners) previous.add(owner)
    textures.set(value, previous)
  }
  for (const [material, owners] of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) texture(value, owners)
    if (material instanceof THREE.ShaderMaterial) {
      for (const uniform of Object.values(material.uniforms)) {
        if (uniform.value instanceof THREE.Texture) texture(uniform.value, owners)
        if (Array.isArray(uniform.value)) {
          for (const value of uniform.value) if (value instanceof THREE.Texture) texture(value, owners)
        }
      }
    }
  }
  for (const value of standardPipelineTextures) {
    if (!textures.has(value)) textures.set(value, new Set())
  }
  const targets = resources.liveRenderTargets()
  for (const target of targets) {
    // Physical target ownership is decided by the renderer observer. Do not
    // assign all targets to the scene whose color/shadow happens to use them.
    for (const value of target.textures) resources.linkTexture(value, properties)
    if (target.depthTexture) resources.linkTexture(target.depthTexture, properties)
  }
  for (const [value, owners] of textures) {
    const standardMap = standardPipelineTextures.has(value)
    resources.linkTexture(value, properties, standardMap)
    if (standardMap) {
      const data = textureData(value)
      if (data instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && data instanceof SharedArrayBuffer)) {
        receipt({ identity: data, chargedTo: 'postAndEffects', kind: 'other',
          cpuBytes: data.byteLength, gpuBytes: null }, `standard-map:${value.id}`, false)
      }
    }
    for (const owner of owners) {
      addClaim(value, owner)
      const data = textureData(value)
      if (data instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && data instanceof SharedArrayBuffer)) {
        const existing = cpu.get(data)
        receipt({ identity: data, chargedTo: owner, kind: existing?.kinds.has('skin') ? 'skin' : 'other',
          cpuBytes: data.byteLength, gpuBytes: null }, `texture:${value.id}`, false)
      } else if (data) {
        addClaim(data, owner)
        missing.add('canvas/image backing storage is not byte-addressable')
      }
    }
  }
  const gpu = resources.allocationOwnership(claims)
  const normalized: VisualAllocationReceipt[] = []
  const conflicts: Array<{ owners: string[]; kinds: string[]; bytes: number; providers: string[] }> = []
  let sharedCpuBytes = 0, conflictingCpuBytes = 0
  for (const entry of cpu.values()) {
    if (entry.conflict || entry.kinds.size !== 1) {
      conflictingCpuBytes += entry.bytes
      conflicts.push({ owners: [...entry.owners], kinds: [...entry.kinds], bytes: entry.bytes, providers: [...entry.providers] })
      continue
    }
    if (entry.owners.size > 1) { sharedCpuBytes += entry.bytes; continue }
    normalized.push({
      identity: entry.identity, chargedTo: [...entry.owners][0], kind: [...entry.kinds][0],
      cpuBytes: entry.bytes, gpuBytes: 0,
    })
  }
  const totals = sumVisualAllocationReceipts(normalized)
  const unmapped = [...cpu.values()].filter((entry) => !entry.cpuOnly && !gpu.mappedBackings.has(entry.identity))
  const canonicalOnGpu = [...cpu.values()].filter((entry) =>
    entry.kinds.has('canonical-sight') && gpu.mappedBackings.has(entry.identity))
  if (sharedCpuBytes || gpu.sharedBytes) missing.add('unassigned cross-owner physical allocations remain shared outside known pipeline billing')
  if (conflicts.length) missing.add('conflicting live allocation receipts')
  if (unmapped.length) missing.add(`${unmapped.length} CPU backing identities have no observed GL storage mapping (including unuploaded retained geometry)`)
  if (canonicalOnGpu.length) missing.add('canonical-only sight backing unexpectedly observed in GPU storage')
  if (gpu.unattributedBytes) missing.add('GPU storage without a live owner mapping')
  if (unownedSources) missing.add(`${unownedSources} live sources have no subsystem owner`)
  if (resolver.rootOverflow) missing.add('source root inventory capacity exceeded')
  const ledger = resources.snapshot()
  if (ledger.unknownFormats.length) missing.add('unknown GL storage formats')
  if (!ledger.trackingActive) missing.add('allocation observers disabled')
  missing.add('temporary construction peaks and JS/uniform/driver storage are not inventoried')
  missing.add('disjoint per-subsystem presentation-update CPU scopes are not instrumented')
  const byOwner = Object.fromEntries(VISUAL_SUBSYSTEMS.map((owner) => [owner, {
    ...totals[owner],
    // Known mapped GPU bytes are reported independently. A partial GPU inventory
    // must not become a success-shaped subsystem total.
    gpuAllocatedBytes: null,
  }]))
  return {
    byOwner: {
      dynamicArt: byOwner.dynamicArt,
      world: byOwner.world,
      postAndEffects: byOwner.postAndEffects,
    },
    cpu: {
      uniqueBackingCount: cpu.size, receiptCount, duplicateReceipts,
      retainedBytes: [...cpu.values()].reduce((sum, entry) => sum + entry.bytes, 0),
      sharedBytes: sharedCpuBytes, conflictingBytes: conflictingCpuBytes,
      unattributedBytes: [...unownedBackings].reduce((sum, [identity, bytes]) => sum + (cpu.has(identity) ? 0 : bytes), 0),
      conflicts,
    },
    gpu: {
      byOwner: gpu.byOwner, sharedBytes: gpu.sharedBytes, unattributedBytes: gpu.unattributedBytes,
      trackedBytes: gpu.trackedBytes, reconciled: gpu.reconciled,
      allocations: gpu.allocations, unmappedCpuBackingCount: unmapped.length,
      canonicalSightGpuMappings: canonicalOnGpu.length,
      implicitMultisampleBytesEstimate: ledger.implicitMultisampleBytesEstimate,
      unknownFormats: ledger.unknownFormats,
    },
    sources: { visited: visited.size, unattributed: unownedSources, materials: materials.size, textures: textures.size, targets: targets.length },
    providers: inputs.owners.map((owner) => ({
      name: owner.name, subsystem: owner.subsystem, sourceCount: owner.sources.length,
      receiptCount: owner.receipts.length, rawProviderMissing: owner.missing,
    })),
    complete: false as const,
    missing: [...missing],
  }
}

export function matchingGraphicsCanvasEstimate(
  frame: Pick<GraphicsFrame, 'bufferDimensions'> | null,
  width: number, height: number, samples: number | null,
): number | null {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1 ||
    samples === null || !Number.isSafeInteger(samples) || samples < 0 ||
    frame?.bufferDimensions?.width !== width || frame.bufferDimensions.height !== height) return null
  const bytes = width * height * 4 * (1 + (samples > 1 ? samples : 0) + Math.max(1, samples))
  return Number.isSafeInteger(bytes) ? bytes : null
}

export function graphicsSubsystemBudgetSnapshot(
  inputs: GraphicsSubsystemInputs, frame: GraphicsFrame | null,
  sourceDetails: readonly GraphicsSourceSubmission[],
  resources: GraphicsResources, properties: THREE.WebGLRenderer['properties'],
  defaultFramebufferBytes: number | null,
) {
  const allocation = resolveVisualSubsystemAllocation(inputs.policy)
  const ledger = resources.snapshot()
  if (!ledger.trackingActive) return {
    revision: 'gfx-subsystem-observer-1', frameId: frame?.id ?? null, provisional: true, allocation,
    subsystems: null, submissions: null, sourceDetails: [], inventory: null, sameFrameStorage: false,
    assessment: {
      status: 'incomplete', provisional: true, issues: [],
      missing: ['subsystem/allocation observers disabled; historical storage is not live evidence'],
      remainingFrameCpuMs: null,
    },
  }
  const inventory = collectGraphicsSubsystemInventory(inputs, resources, properties)
  const sameFrameStorage = frame?.resources !== null && frame?.resources !== undefined &&
    ['allocatedBytes', 'releasedBytes', 'creates', 'deletes', 'implicitMultisampleBytesEstimate'].every((key) =>
      Reflect.get(frame.resources!, key) === Reflect.get(ledger, key))
  const canvasEstimate = sameFrameStorage ? defaultFramebufferBytes : null
  const implicitMsaaEstimate = sameFrameStorage ? frame!.resources!.implicitMultisampleBytesEstimate : null
  for (const value of [canvasEstimate, implicitMsaaEstimate]) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError('Invalid same-frame pipeline allocation estimate')
    }
  }
  const knownGpuBudgetLowerBounds = {
    byOwner: {
      ...inventory.gpu.byOwner,
      postAndEffects: inventory.gpu.byOwner.postAndEffects + (canvasEstimate ?? 0) + (implicitMsaaEstimate ?? 0),
    },
    pipeline: {
      observedStorageBytes: inventory.gpu.byOwner.postAndEffects,
      estimatedDefaultFramebufferBytes: canvasEstimate,
      estimatedImplicitMultisampleBytes: implicitMsaaEstimate,
      estimatesComplete: canvasEstimate !== null && implicitMsaaEstimate !== null,
      scope: 'Known observed pipeline storage plus available same-frame canvas/implicit-MSAA estimates; not resident VRAM or complete ownership',
    },
  }
  const submissions = frame?.subsystems ?? null
  const subsystems = {
    dynamicArt: { draws: submissions?.byOwner.dynamicArt ?? null, cpuMs: null, resources: inventory.byOwner.dynamicArt },
    world: { draws: submissions?.byOwner.world ?? null, cpuMs: null, resources: inventory.byOwner.world },
    postAndEffects: { draws: submissions?.byOwner.postAndEffects ?? null, cpuMs: null, resources: inventory.byOwner.postAndEffects },
  }
  const assessed = allocation && frame ? assessVisualSubsystemBudget(allocation, {
    frame, subsystems, resourcesComplete: false, defaultFramebufferBytes: canvasEstimate,
    unattributedDraws: submissions?.byOwner.unattributed,
    worldShadows: submissions ? {
      shadowDraws: submissions.byOwner.world.shadow.calls,
      shadowInstances: submissions.byOwner.world.shadow.submittedInstances,
      shadowTriangles: submissions.byOwner.world.shadow.triangles,
    } : null,
  }) : null
  const missing = [...new Set([
    ...inventory.missing, ...(submissions?.missing ?? ['same-frame source submissions unavailable']),
    ...(!sameFrameStorage ? ['live inventory storage changed since the measured frame'] : []),
    ...(canvasEstimate === null ? ['same-frame canvas allocation estimate unavailable'] : []),
    ...(implicitMsaaEstimate === null ? ['same-frame implicit-MSAA allocation estimate unavailable'] : []),
    ...(!allocation ? ['legacy policy has no subsystem tier allocation'] : []),
    ...(!frame ? ['no completed diagnostic frame'] : []),
    ...(assessed?.missing ?? []),
  ])]
  const knownGpuOverruns = allocation ? VISUAL_SUBSYSTEMS.flatMap((owner) => {
    const observed = knownGpuBudgetLowerBounds.byOwner[owner]
    const limit = allocation.limits[owner].gpuAllocatedBytes
    return observed > limit ? [{
      scope: owner,
      metric: owner === 'postAndEffects' ? 'knownPipelineGpuBytesIncludingEstimates' : 'knownMappedGpuBytes',
      observed, limit,
    }] : []
  }) : []
  const issues = [...(assessed?.issues ?? []), ...knownGpuOverruns]
  return {
    revision: 'gfx-subsystem-observer-1', frameId: frame?.id ?? null,
    provisional: true, allocation, subsystems,
    submissions, sourceDetails, inventory, sameFrameStorage, knownGpuBudgetLowerBounds,
    inventorySample: 'live retained owners at snapshot time; not a construction-peak or historical-frame inventory',
    assessment: {
      status: issues.length ? 'over-budget-or-inconsistent' : 'incomplete',
      provisional: true, issues, missing, remainingFrameCpuMs: null,
    },
  }
}
