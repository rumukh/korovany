import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {
  StylizedArtLibrary, artGeometryBytes, bakeOutlineNormals,
} from '../src/game/art/index.ts'
import {
  assessVisualSubsystemBudget, sumVisualAllocationReceipts,
  type VisualAllocationReceipt, type VisualBudgetEvidence, type VisualSubsystemUsage,
} from '../src/game/diagnostics/VisualBudgetAccounting.ts'
import type { GraphicsDraws, GraphicsPass } from '../src/game/diagnostics/GraphicsFrameMeter.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import {
  VISUAL_SUBSYSTEMS, resolveVisualSubsystemAllocation,
  type VisualSubsystem,
} from '../src/game/visualBudget.ts'
import { MAX_ACTORS } from '../src/game/world/ActorBudget.ts'
import { shadowSubmissionCost } from '../src/game/world/WorldPresentationRegistry.ts'

const qualities = ['high', 'balanced', 'low'] as const
const passes = ['scene', 'ink', 'shadow', 'post'] as const
const allocation = (quality: typeof qualities[number] = 'high', bloomEnabled = true) => {
  const value = resolveVisualSubsystemAllocation(resolveVisualPolicy({
    visualMode: 'enhanced', visualQuality: quality, bloomEnabled,
  }))
  assert.ok(value)
  return value
}

function draws(scene: number, ink: number, shadow: number, post = 0): Record<GraphicsPass, GraphicsDraws> {
  const cost = (calls: number, triangles = calls * 12): GraphicsDraws => ({
    calls, triangles, lines: 0, points: 0,
  })
  return { scene: cost(scene), ink: cost(ink), shadow: cost(shadow), post: cost(post, post) }
}

function fixture(): VisualBudgetEvidence {
  const resources = sumVisualAllocationReceipts([
    { identity: {}, chargedTo: 'dynamicArt', kind: 'geometry', cpuBytes: 100, gpuBytes: 100 },
    { identity: {}, chargedTo: 'world', kind: 'geometry', cpuBytes: 200, gpuBytes: 200 },
    { identity: {}, chargedTo: 'world', kind: 'canonical-sight', cpuBytes: 50, gpuBytes: 0 },
    { identity: {}, chargedTo: 'postAndEffects', kind: 'other', cpuBytes: 100, gpuBytes: 300 },
  ])
  const subsystems = {
    dynamicArt: { draws: draws(3, 3, 3), cpuMs: 1, resources: resources.dynamicArt },
    world: { draws: draws(2, 1, 2), cpuMs: 0.5, resources: resources.world },
    postAndEffects: { draws: draws(2, 0, 0, 16), cpuMs: 0.25, resources: resources.postAndEffects },
  }
  const frameDraws = draws(0, 0, 0)
  const total = { calls: 0, triangles: 0, lines: 0, points: 0 }
  for (const pass of passes) for (const metric of ['calls', 'triangles', 'lines', 'points'] as const) {
    frameDraws[pass][metric] = VISUAL_SUBSYSTEMS.reduce((sum, owner) => sum + subsystems[owner].draws[pass][metric], 0)
    total[metric] += frameDraws[pass][metric]
  }
  return {
    subsystems, resourcesComplete: true, defaultFramebufferBytes: 20,
    worldShadows: { shadowDraws: 2, shadowInstances: 2, shadowTriangles: 24 },
    frame: {
      draws: frameDraws, total, counterAgreement: true, cpuMs: 5,
      resources: {
        trackingActive: true, buffers: 2, textures: 1, renderbuffers: 0, framebuffers: 1,
        programs: 1, shaders: 0, vertexArrays: 1, bufferBytes: 300, textureBytes: 270,
        renderbufferBytes: 0, renderTargetBytes: 270, trackedBytes: 570, peakTrackedBytes: 570,
        allocatedBytes: 570, releasedBytes: 0, creates: 6, deletes: 0, storageCalls: 3,
        unknownFormats: [], implicitMultisampleBytesEstimate: 10,
      },
    },
  }
}

function replaceUsage(evidence: VisualBudgetEvidence, subsystem: VisualSubsystem, update: Partial<VisualSubsystemUsage>) {
  return {
    ...evidence, subsystems: {
      ...evidence.subsystems, [subsystem]: { ...evidence.subsystems[subsystem], ...update },
    },
  }
}

test('named subsystem envelopes partition the actual global policy without changing actor capacity', () => {
  const expected = [[360, 280, 60], [260, 150, 40], [180, 100, 20]]
  for (const [index, quality] of qualities.entries()) {
    const resolved = allocation(quality)
    assert.deepEqual(VISUAL_SUBSYSTEMS.map((owner) => resolved.limits[owner].wholeFrameDrawCalls), expected[index])
    for (const [metric, globalMetric] of [
      ['wholeFrameDrawCalls', 'wholeFrameDrawCalls'],
      ['mainViewTriangles', 'mainViewTriangles'],
      ['gpuAllocatedBytes', 'trackedGpuBytes'],
    ] as const) {
      assert.equal(VISUAL_SUBSYSTEMS.reduce((sum, owner) => sum + resolved.limits[owner][metric], 0),
        resolved.global[globalMetric])
    }
    assert.equal(resolved.population.players, 1)
    assert.equal(resolved.population.npcs, MAX_ACTORS)
    assert.equal(resolved.population.humanoidProofCount, 26)
    assert.equal(resolved.postDraws + resolved.transientEffectDraws, resolved.limits.postAndEffects.wholeFrameDrawCalls)
    assert.equal(Object.isFrozen(resolved), true)
    assert.equal(Object.isFrozen(resolved.firstRole), true)
    for (const owner of VISUAL_SUBSYSTEMS) assert.equal(Object.isFrozen(resolved.limits[owner]), true)
  }
  assert.equal(MAX_ACTORS, 25)
})

test('legacy comparison has no subsystem tier and disabled effects do not donate their reserve', () => {
  assert.equal(resolveVisualSubsystemAllocation(resolveVisualPolicy({ visualMode: 'legacy' })), null)
  assert.equal(resolveVisualSubsystemAllocation(resolveVisualPolicy(
    { visualMode: 'enhanced' }, { enhancedAvailable: false },
  )), null)
  for (const quality of qualities) {
    const on = allocation(quality)
    const off = allocation(quality, false)
    assert.deepEqual(off.limits, on.limits)
    assert.equal(off.postDraws, on.postDraws)
    assert.equal(off.post.enabled, false)
    assert.equal(off.transientEffectDraws, on.transientEffectDraws)
    assert.deepEqual(off.worldShadows, resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: quality }).shadows)
  }
  assert.equal(allocation('low').postDraws, 0)
})

test('global budget drift fails instead of silently lending extra headroom to a subsystem', () => {
  const policy = resolveVisualPolicy({ visualMode: 'enhanced' })
  const budget = policy.budget
  assert.ok(budget)
  for (const metric of ['wholeFrameDrawCalls', 'mainViewTriangles', 'trackedGpuBytes'] as const) {
    assert.throws(() => resolveVisualSubsystemAllocation({
      ...policy, budget: { ...budget, [metric]: budget[metric] + 1 },
    }), /coordinate a revision/)
  }
})

test('first-role fleet projections retain all 26 rigs and leave named dynamic headroom for fauna and caravans', () => {
  const high = allocation('high')
  assert.equal(26 * high.firstRole.nearDraws, 286)
  assert.equal(high.limits.dynamicArt.wholeFrameDrawCalls - 286, 74)
  for (const [quality, expectedDraws] of [['balanced', 187], ['low', 144]] as const) {
    const tier = allocation(quality)
    const prototype = tier.firstRole
    const projected = 8 * prototype.nearDraws + 9 * prototype.midDraws + 9 * prototype.farDraws
    assert.equal(projected, expectedDraws)
    assert.ok(projected < tier.limits.dynamicArt.wholeFrameDrawCalls)
    assert.ok(26 * prototype.nearDraws > tier.limits.dynamicArt.wholeFrameDrawCalls,
      'A per-rig bound must not falsely imply every simultaneous near rig fits')
  }
})

test('allocation receipts deduplicate borrowed stores and keep clone bytes a geometry subset', () => {
  const geometry: VisualAllocationReceipt = {
    identity: new ArrayBuffer(100), chargedTo: 'dynamicArt', kind: 'geometry', cpuBytes: 100, gpuBytes: 0,
  }
  const clone: VisualAllocationReceipt = {
    identity: new ArrayBuffer(120), chargedTo: 'dynamicArt', kind: 'binding-clone', cpuBytes: 120, gpuBytes: 0,
  }
  const skin: VisualAllocationReceipt = {
    identity: new ArrayBuffer(64), chargedTo: 'dynamicArt', kind: 'skin', cpuBytes: 64, gpuBytes: 0,
  }
  const result = sumVisualAllocationReceipts([geometry, clone, skin, { ...clone }, { ...skin }])
  assert.deepEqual(result.dynamicArt, {
    cpuBackingBytes: 284, cpuGeometryBytes: 220, cpuBindingCloneBytes: 120,
    cpuSkinBytes: 64, cpuCanonicalSightBytes: 0, gpuAllocatedBytes: 0,
  })
  assert.equal(Object.isFrozen(result.dynamicArt), true)
  assert.throws(() => sumVisualAllocationReceipts([geometry, { ...geometry, chargedTo: 'world' }]), /Conflicting/)
  assert.throws(() => sumVisualAllocationReceipts([clone, { ...clone, kind: 'geometry' }]), /Conflicting/)
  assert.throws(() => sumVisualAllocationReceipts([geometry, { ...geometry, cpuBytes: 99 }]), /Conflicting/)
})

test('unknown sizes stay unknown and CPU-only canonical data can never be billed as submitted GPU art', () => {
  const receipt: VisualAllocationReceipt = {
    identity: {}, chargedTo: 'world', kind: 'canonical-sight', cpuBytes: 100, gpuBytes: 0,
  }
  assert.equal(sumVisualAllocationReceipts([receipt]).world.cpuCanonicalSightBytes, 100)
  assert.throws(() => sumVisualAllocationReceipts([{ ...receipt, gpuBytes: 100 }]), /CPU-only/)
  assert.throws(() => sumVisualAllocationReceipts([{ ...receipt, chargedTo: 'dynamicArt' }]), /CPU-only/)
  assert.equal(sumVisualAllocationReceipts([
    { ...receipt, kind: 'geometry', gpuBytes: null },
    { identity: {}, chargedTo: 'world', kind: 'other', cpuBytes: 10, gpuBytes: 20 },
  ]).world.gpuAllocatedBytes, null)
  for (const value of [-1, NaN, Infinity, 0.5]) {
    assert.throws(() => sumVisualAllocationReceipts([{ ...receipt, cpuBytes: value }]), RangeError)
  }
  assert.throws(() => sumVisualAllocationReceipts([
    { ...receipt, cpuBytes: Number.MAX_SAFE_INTEGER },
    { ...receipt, identity: {}, cpuBytes: 1 },
  ]), RangeError)
})

test('actual bound source/ink geometry counts full clone storage once rather than just its visibility channel', () => {
  const art = new StylizedArtLibrary({
    enhanced: true, ink: { player: 0, enemy: 0, interactable: 0, landmark: 0 },
  })
  const original = bakeOutlineNormals(new THREE.BoxGeometry())
  const material = art.acquireMaterial('budget-proof', { color: 0x567899, surface: 'cloth' })
  const source = new THREE.Mesh(original, material)
  const binding = art.bindRenderSource(source, { visibility: true })
  const outline = art.applyOutline(source, 'structural')
  const receipts = (geometry: THREE.BufferGeometry, kind: VisualAllocationReceipt['kind']): VisualAllocationReceipt[] => {
    const buffers = Object.values(geometry.attributes).map((attribute) => attribute.array.buffer)
    if (geometry.index) buffers.push(geometry.index.array.buffer)
    return buffers.map((buffer) => ({
      identity: buffer, chargedTo: 'dynamicArt', kind, cpuBytes: buffer.byteLength, gpuBytes: 0,
    }))
  }
  try {
    const stats = art.getRenderBindingStats()
    const result = sumVisualAllocationReceipts([
      ...receipts(original, 'geometry'), ...receipts(source.geometry, 'binding-clone'),
      ...receipts(outline.shells[0].geometry, 'binding-clone'),
    ])
    assert.equal(stats.geometryBytes, artGeometryBytes(source.geometry))
    assert.equal(result.dynamicArt.cpuGeometryBytes, artGeometryBytes(original) + stats.geometryBytes)
    assert.equal(result.dynamicArt.cpuBindingCloneBytes, stats.geometryBytes)
    assert.ok(stats.geometryBytes > stats.attributeBytes)
    assert.equal(source.geometry, outline.shells[0].geometry)
  } finally {
    art.releaseOutline(outline)
    art.releaseRenderSource(binding)
    original.dispose()
    art.dispose()
  }
})

test('actual material-group/instance shadow costs are submitted work, not unique selected instances', () => {
  const geometry = new THREE.BoxGeometry()
  const materials = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial())
  const source = new THREE.InstancedMesh(geometry, materials, 10)
  try {
    const cost = shadowSubmissionCost(source)
    assert.deepEqual(cost, { draws: 6, instances: 60, triangles: 120 })
    const evidence = fixture()
    const worldDraws = draws(6, 0, 6)
    worldDraws.shadow.triangles = cost.triangles
    const report = assessVisualSubsystemBudget(allocation('high'), {
      ...replaceUsage(evidence, 'world', { draws: worldDraws }),
      worldShadows: { shadowDraws: cost.draws, shadowInstances: cost.instances, shadowTriangles: cost.triangles },
    })
    assert.ok(report.issues.some((issue) => issue.metric === 'shadowInstances' && issue.observed === 60 && issue.limit === 48))
  } finally {
    source.dispose()
    geometry.dispose()
    for (const material of materials) material.dispose()
  }
})

test('closed same-frame accounting can only return within the provisional envelope, not approval', () => {
  const report = assessVisualSubsystemBudget(allocation(), fixture())
  assert.equal(report.status, 'within-provisional-envelope')
  assert.equal(report.provisional, true)
  assert.deepEqual(report.issues, [])
  assert.deepEqual(report.missing, [])
  assert.equal(report.remainingFrameCpuMs, 3.25)
})

test('per-owner overruns are failures even when other buckets leave the global frame under budget', () => {
  const evidence = fixture()
  const excess = draws(361, 0, 0)
  const report = assessVisualSubsystemBudget(allocation(), replaceUsage(evidence, 'dynamicArt', { draws: excess }))
  assert.ok(report.issues.some((issue) => issue.scope === 'dynamicArt' && issue.metric === 'wholeFrameDrawCalls'))
  assert.equal(report.status, 'over-budget-or-inconsistent')
  const cpu = assessVisualSubsystemBudget(allocation(), replaceUsage(evidence, 'dynamicArt', { cpuMs: 4.1 }))
  assert.ok(cpu.issues.some((issue) => issue.metric === 'cpuMs'))
})

test('one-pass composer proxies, missing group submissions and overlapping CPU scopes cannot reconcile', () => {
  const evidence = fixture()
  const proxy = assessVisualSubsystemBudget(allocation(), {
    ...evidence, frame: { ...evidence.frame, total: { calls: 1, triangles: 1, lines: 0, points: 0 } },
  })
  assert.ok(proxy.issues.some((issue) => issue.metric === 'frame total calls'))
  const lost = assessVisualSubsystemBudget(allocation(), replaceUsage(evidence, 'world', { draws: draws(0, 0, 0) }))
  assert.ok(lost.issues.some((issue) => issue.metric === 'scene.calls'))
  const overlapping = assessVisualSubsystemBudget(allocation(), { ...evidence, frame: { ...evidence.frame, cpuMs: 1 } })
  assert.ok(overlapping.issues.some((issue) => issue.metric === 'disjoint presentation CPU scopes'))
})

test('a real no-post policy rejects post work without automatically donating the post reservation to FX', () => {
  const report = assessVisualSubsystemBudget(allocation('high', false), fixture())
  assert.ok(report.issues.some((issue) => issue.scope === 'postAndEffects' && issue.metric === 'post.calls' && issue.limit === 0))
  const evidence = fixture()
  const extraFx = assessVisualSubsystemBudget(allocation('high', false),
    replaceUsage(evidence, 'postAndEffects', { draws: draws(45, 0, 0) }))
  assert.ok(extraFx.issues.some((issue) => issue.metric === 'transientEffectDraws' && issue.limit === 44))
})

test('GPU reconciliation includes canvas and implicit MSAA but does not add renderTargetBytes twice', () => {
  const evidence = fixture()
  assert.equal(assessVisualSubsystemBudget(allocation(), evidence).status, 'within-provisional-envelope')
  const noCanvas = assessVisualSubsystemBudget(allocation(), { ...evidence, defaultFramebufferBytes: 0 })
  assert.ok(noCanvas.issues.some((issue) => issue.metric === 'GPU allocation ownership'))
  const memory = evidence.subsystems.dynamicArt.resources!
  const duplicate = assessVisualSubsystemBudget(allocation(), replaceUsage(evidence, 'dynamicArt', {
    resources: { ...memory, gpuAllocatedBytes: memory.gpuAllocatedBytes! + evidence.frame.resources!.renderTargetBytes },
  }))
  assert.ok(duplicate.issues.some((issue) => issue.metric === 'GPU allocation ownership'))
})

test('partial inventories, unknown formats, and counter-disabled controls remain incomplete rather than fake zeros', () => {
  const evidence = fixture()
  const partials: VisualBudgetEvidence[] = [
    { ...evidence, resourcesComplete: false },
    { ...evidence, defaultFramebufferBytes: null },
    { ...evidence, worldShadows: null },
    replaceUsage(evidence, 'dynamicArt', { cpuMs: null }),
    replaceUsage(evidence, 'world', { resources: null }),
    replaceUsage(evidence, 'dynamicArt', {
      resources: { ...evidence.subsystems.dynamicArt.resources!, gpuAllocatedBytes: null },
    }),
    { ...evidence, frame: { ...evidence.frame, resources: { ...evidence.frame.resources!, unknownFormats: [0xdead] } } },
    { ...evidence, frame: { ...evidence.frame, draws: null, total: null, resources: null, counterAgreement: null } },
  ]
  for (const partial of partials) {
    const report = assessVisualSubsystemBudget(allocation(), partial)
    assert.equal(report.status, 'incomplete')
    assert.ok(report.missing.length > 0)
  }
})

test('aggregate resource subsets, allocated ceilings and invalid inputs are checked independently', () => {
  const evidence = fixture()
  const memory = evidence.subsystems.dynamicArt.resources!
  const badSubset = assessVisualSubsystemBudget(allocation(), replaceUsage(evidence, 'dynamicArt', {
    resources: { ...memory, cpuBindingCloneBytes: memory.cpuGeometryBytes + 1 },
  }))
  assert.ok(badSubset.issues.some((issue) => issue.metric === 'dynamicArt.cloneSubset'))
  const tooMuch = assessVisualSubsystemBudget(allocation(), replaceUsage(evidence, 'dynamicArt', {
    resources: { ...memory, cpuBackingBytes: allocation().limits.dynamicArt.cpuBackingBytes + 1 },
  }))
  assert.ok(tooMuch.issues.some((issue) => issue.metric === 'cpuBackingBytes'))
  assert.throws(() => assessVisualSubsystemBudget(allocation(),
    replaceUsage(evidence, 'dynamicArt', { cpuMs: NaN })), RangeError)
  const badDraw = draws(-1, 0, 0)
  assert.throws(() => assessVisualSubsystemBudget(allocation(),
    replaceUsage(evidence, 'world', { draws: badDraw })), RangeError)
  const disagreement = assessVisualSubsystemBudget(allocation(), {
    ...evidence, frame: { ...evidence.frame, counterAgreement: false },
  })
  assert.ok(disagreement.issues.some((issue) => issue.metric === 'GL/renderer counter agreement'))
})
