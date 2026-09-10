import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import {
  GeometryCache, StylizedArtLibrary, createCharacterPresenter, illustratedCharacterPlan, resolveCharacterPlan,
  type CharacterPresenter, type CreaturePresenter, type WagonPresenter,
} from '../src/game/art/index.ts'
import { GraphicsFrameMeter, addGraphicsDraw, type GraphicsRuntimeFrame } from '../src/game/diagnostics/GraphicsFrameMeter.ts'
import { GraphicsResources } from '../src/game/diagnostics/GraphicsResources.ts'
import {
  collectGraphicsSubsystemInventory, graphicsSubsystemBudgetSnapshot, matchingGraphicsCanvasEstimate,
  type GraphicsSubsystemInputs,
} from '../src/game/diagnostics/GraphicsSubsystemInventory.ts'
import {
  GraphicsSourceResolver, GRAPHICS_SOURCE_DETAIL_LIMIT, type GraphicsSourceRoot,
} from '../src/game/diagnostics/GraphicsSubsystemSubmissions.ts'
import type { VisualAllocationReceipt } from '../src/game/diagnostics/VisualBudgetAccounting.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { SecondaryEffectPool } from '../src/game/SecondaryEffectPool.ts'
import { TransientEffectBudget } from '../src/game/TransientEffectBudget.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

/** Only GL/DOM-dependent execution is doubled; the production observers/collector remain intact. */
function instrument(multisampledRenderToTexture = false) {
  const noop = (..._args: unknown[]) => {}
  const multisample = { renderbufferStorageMultisampleEXT: noop, framebufferTexture2DMultisampleEXT: noop }
  const gl = Object.assign(Object.create(null), {
    getExtension: (name: string) =>
      multisampledRenderToTexture && name === 'WEBGL_multisampled_render_to_texture' ? multisample : null,
    isContextLost: () => false, beginQuery: noop,
    bindBuffer: noop, bindVertexArray: noop, bufferData: noop, activeTexture: noop, bindTexture: noop,
    texStorage2D: noop, texStorage3D: noop, texImage2D: noop, texImage3D: noop, texSubImage2D: noop, texSubImage3D: noop,
    compressedTexImage2D: noop, compressedTexImage3D: noop, copyTexImage2D: noop, generateMipmap: noop,
    bindRenderbuffer: noop, renderbufferStorage: noop, renderbufferStorageMultisample: noop,
    framebufferTexture2D: noop, framebufferTextureLayer: noop, framebufferRenderbuffer: noop,
    drawArrays: noop, drawElements: noop, drawArraysInstanced: noop, drawElementsInstanced: noop,
    drawRangeElements: noop, readPixels: noop, blitFramebuffer: noop,
  })
  for (const suffix of ['Buffer', 'Texture', 'Renderbuffer', 'Framebuffer', 'Program', 'Shader', 'VertexArray']) {
    gl[`create${suffix}`] = () => ({})
    gl[`delete${suffix}`] = noop
  }
  const records = new Map<unknown, object>()
  const properties = {
    has: (key: unknown) => records.has(key),
    get: (key: unknown) => records.get(key),
    update: noop, remove: (key: unknown) => { records.delete(key) }, dispose: () => records.clear(),
  }
  let target: THREE.WebGLRenderTarget | null = null
  const renderer = Object.assign(Object.create(null), {
    properties, getContext: () => gl,
    getRenderTarget: () => target,
    setRenderTarget: (value: THREE.WebGLRenderTarget | null) => { target = value },
    info: {
      autoReset: true, render: { calls: 0, triangles: 0, lines: 0, points: 0 },
      reset() { Object.assign(this.render, { calls: 0, triangles: 0, lines: 0, points: 0 }) },
    },
    render: (_scene: THREE.Scene, action: () => void) => action(),
    renderBufferDirect: (_camera: THREE.Camera, _scene: THREE.Scene | null, geometry: THREE.BufferGeometry,
      _material: THREE.Material, source: THREE.Object3D, group: { start: number; count: number } | null) => {
      const count = group?.count ?? geometry.index?.count ?? geometry.getAttribute('position').count
      const instances = source instanceof THREE.InstancedMesh ? source.count : 1
      gl.drawElementsInstanced(0x0004, count, 0x1403, (group?.start ?? 0) * 2, instances)
      addGraphicsDraw(renderer.info.render, 0x0004, count, instances)
    },
  })
  const resources = new GraphicsResources(gl)
  const upload = (view: ArrayBufferView) => {
    const handle = gl.createBuffer()
    gl.bindBuffer(0x8892, handle)
    gl.bufferData(0x8892, view, 0x88e4)
    return handle
  }
  return { gl, renderer, resources, properties, records, upload }
}

const runtime: GraphicsRuntimeFrame = {
  elapsed: 1, paused: false, ended: false, health: 100, npcCount: 25, aliveNpcs: 25,
  movingNpcs: 2, actingNpcs: 1, region: 'a', visibleRegions: ['a'], simulatedRegions: ['a'],
}
const policy = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'high' })
const library = () => new StylizedArtLibrary({
  enhanced: true, ink: { player: 0, enemy: 0, interactable: 0, landmark: 0 },
})
const emptyInputs = (): GraphicsSubsystemInputs => ({
  policy, roots: [], owners: [], standardPipelineTextures: [], missing: [],
})

test('same real observer attributes actual material groups, double passes, ink, shadows, nested post and instances once', () => {
  const f = instrument(), scene = new THREE.Scene(), post = new THREE.Scene(), camera = new THREE.Camera()
  const art = library()
  const character = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  const world = new THREE.InstancedMesh(new THREE.BoxGeometry(),
    Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial()), 3)
  const fx = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({
    transparent: true, side: THREE.DoubleSide,
  }))
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial())
  const postBuffer = f.upload(quad.geometry.getAttribute('position').array)
  character.userData.visualSubsystem = 'dynamicArt'
  world.userData.visualSubsystem = 'world'
  fx.userData.visualSubsystem = 'postAndEffects'
  const ink = art.applyOutline(character, 'structural')
  ink.shells[0].userData.visualSubsystem = 'world' // A stale shell tag must not steal its source's charge.
  const meter = new GraphicsFrameMeter(f.renderer, scene, f.resources)
  const submit = (source: THREE.Mesh, root: THREE.Scene | null = scene) => {
    const materials = Array.isArray(source.material) ? source.material : [source.material]
    if (Array.isArray(source.material)) {
      for (const group of source.geometry.groups) f.renderer.renderBufferDirect(camera, root, source.geometry,
        materials[group.materialIndex ?? 0], source, group)
    } else f.renderer.renderBufferDirect(camera, root, source.geometry, source.material, source, null)
  }
  try {
    meter.begin(1 / 60, 'active'); meter.endUpdate()
    f.renderer.render(scene, () => {
      submit(character, null)
      submit(world, null)
      submit(character)
      submit(ink.shells[0])
      submit(world)
      submit(fx); submit(fx) // The renderer's real two-side sequence; each GL call is billed.
      f.renderer.render(post, () => submit(quad, post))
      submit(character)
    })
    const frame = meter.end(runtime, 'sample')
    assert.equal(frame.counterAgreement, true)
    assert.equal(frame.subsystems?.reconciled, true)
    assert.equal(frame.subsystems?.attributionComplete, true)
    const owners = frame.subsystems!.byOwner
    assert.equal(owners.dynamicArt.scene.calls, 2)
    assert.equal(owners.dynamicArt.ink.calls, 1)
    assert.equal(owners.dynamicArt.shadow.calls, 1)
    assert.equal(owners.world.scene.calls, 6)
    assert.equal(owners.world.scene.submittedInstances, 18, 'Three instances in each of six real group calls')
    assert.equal(owners.world.shadow.submittedInstances, 18)
    assert.equal(owners.world.shadow.triangles, 36)
    assert.equal(owners.postAndEffects.scene.calls, 2)
    assert.equal(owners.postAndEffects.post.calls, 1)
    assert.equal(frame.total!.calls, 19)
    assert.equal(frame.total!.triangles, 126)
    assert.equal(f.resources.allocationOwnership(new Map()).byOwner.postAndEffects, 48,
      'The real post source is connected to its previously observed GL upload, without an inventory size estimate')
    const details = meter.subsystemSubmissions.sourceDetails()
    assert.equal(details.filter((entry) => entry.sourceId === world.id).length, 12)
    assert.ok(details.filter((entry) => entry.sourceId === world.id).every((entry) => entry.group?.count === 6))
    const shell = details.find((entry) => entry.pass === 'ink')!
    assert.equal(shell.borrowedSourceId, character.id)
    assert.equal(shell.owner, 'dynamicArt')
    const snapshot = graphicsSubsystemBudgetSnapshot(emptyInputs(), frame, details, f.resources, f.properties, 0)
    assert.equal(snapshot.frameId, frame.id)
    assert.equal(snapshot.assessment.status, 'incomplete')
    assert.ok(!snapshot.assessment.issues.some((issue) => issue.scope === 'reconciliation'))
    assert.equal(snapshot.subsystems!.world.cpuMs, null)
  } finally {
    meter.dispose(); art.releaseOutline(ink)
    for (const mesh of [character, world, fx, quad]) {
      mesh.geometry.dispose()
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose()
    }
    world.dispose(); art.dispose(); f.gl.deleteBuffer(postBuffer); f.resources.dispose()
  }
})

test('unknown source, raw GL and root conflicts remain unattributed/incomplete, and detailed retention is bounded', () => {
  const f = instrument(), scene = new THREE.Scene(), camera = new THREE.Camera()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  const meter = new GraphicsFrameMeter(f.renderer, scene, f.resources)
  const submit = () => f.renderer.renderBufferDirect(camera, scene, mesh.geometry, mesh.material, mesh, null)
  try {
    meter.begin(1 / 60, 'active'); meter.endUpdate()
    f.renderer.render(scene, submit)
    f.gl.drawArrays(0x0004, 0, 3); addGraphicsDraw(f.renderer.info.render, 0x0004, 3, 1)
    const frame = meter.end(runtime, 'sample')
    assert.equal(frame.total!.calls, 2)
    assert.equal(frame.subsystems!.byOwner.unattributed.scene.calls, 2)
    assert.equal(frame.subsystems!.reconciled, true)
    assert.equal(frame.subsystems!.attributionComplete, false)
    const snapshot = graphicsSubsystemBudgetSnapshot(emptyInputs(), frame,
      meter.subsystemSubmissions.sourceDetails(), f.resources, f.properties, 0)
    assert.equal(snapshot.assessment.status, 'incomplete', 'Missing ownership is not fabricated as a world overrun')
    assert.ok(snapshot.assessment.missing.includes('unattributed source submissions'))
    assert.ok(!snapshot.assessment.issues.some((issue) => issue.scope === 'reconciliation'))
    mesh.userData.visualSubsystem = 'world'
    meter.begin(1 / 60, 'active'); meter.endUpdate()
    for (let index = 0; index < GRAPHICS_SOURCE_DETAIL_LIMIT + 1; index++) {
      f.renderer.renderBufferDirect(camera, scene, mesh.geometry, mesh.material, mesh, { start: index * 3, count: 3 })
    }
    const bounded = meter.end(runtime, 'sample')
    assert.equal(bounded.subsystems!.byOwner.world.scene.calls, GRAPHICS_SOURCE_DETAIL_LIMIT + 1)
    assert.equal(bounded.subsystems!.detailOverflow, 1)
    assert.equal(meter.subsystemSubmissions.sourceDetails().length, GRAPHICS_SOURCE_DETAIL_LIMIT)
    const roots: GraphicsSourceRoot[] = [
      { root: mesh, subsystem: 'world' }, { root: mesh, subsystem: 'dynamicArt' },
    ]
    const resolver = new GraphicsSourceResolver(() => roots)
    resolver.beginFrame()
    assert.equal(resolver.resolve(mesh, 'scene').owner, 'unattributed')
    roots.length = 0; delete mesh.userData.visualSubsystem
    resolver.beginFrame()
    assert.equal(resolver.resolve(mesh, 'scene').reason, 'no production source owner')
    meter.disableCounters()
    assert.deepEqual(meter.subsystemSubmissions.sourceDetails(), [])
    meter.begin(1 / 60, 'active'); meter.endUpdate(); submit()
    const control = meter.end(runtime, 'sample')
    assert.equal(control.subsystems, null)
    const disabled = graphicsSubsystemBudgetSnapshot(emptyInputs(), control, [], f.resources, f.properties, 0)
    assert.equal(disabled.inventory, null)
    assert.equal(disabled.submissions, null)
  } finally {
    meter.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); f.resources.dispose()
  }
})

test('actual backing uploads map byte-sized GL handles once, not CPU receipt sizes; sharing/conflicts are explicit', () => {
  const f = instrument()
  const bytes = new Uint8Array(128)
  const handle = f.upload(bytes.subarray(8, 24))
  const receipt: VisualAllocationReceipt = {
    identity: bytes.buffer, chargedTo: 'dynamicArt', kind: 'geometry', cpuBytes: 128, gpuBytes: null,
  }
  const inputs: GraphicsSubsystemInputs = {
    ...emptyInputs(), owners: [{ name: 'rig', subsystem: 'dynamicArt', receipts: [receipt, { ...receipt }], sources: [], missing: [] }],
  }
  try {
    const first = collectGraphicsSubsystemInventory(inputs, f.resources, f.properties)
    assert.equal(first.cpu.retainedBytes, 128)
    assert.equal(first.cpu.uniqueBackingCount, 1)
    assert.equal(first.gpu.byOwner.dynamicArt, 16, 'GPU storage is the actual uploaded view, not the 128-byte CPU backing')
    assert.equal(first.gpu.reconciled, true)
    const shared = collectGraphicsSubsystemInventory({
      ...inputs, owners: [...inputs.owners, {
        name: 'world', subsystem: 'world', sources: [], missing: [], receipts: [{ ...receipt, chargedTo: 'world' }],
      }],
    }, f.resources, f.properties)
    assert.equal(shared.cpu.sharedBytes, 128)
    assert.equal(shared.cpu.retainedBytes, 128)
    assert.equal(shared.gpu.sharedBytes, 16)
    assert.equal(shared.gpu.byOwner.dynamicArt, 0)
    assert.equal(shared.gpu.byOwner.world, 0)
    const conflicting = collectGraphicsSubsystemInventory({
      ...inputs, owners: [...inputs.owners, {
        name: 'broken-owner', subsystem: 'dynamicArt', sources: [], missing: [], receipts: [{ ...receipt, cpuBytes: 64, kind: 'skin' }],
      }],
    }, f.resources, f.properties)
    assert.equal(conflicting.cpu.conflicts.length, 1)
    assert.equal(conflicting.cpu.conflictingBytes, 128)
    const unknown = f.gl.createBuffer()
    f.gl.bindBuffer(0x8892, unknown); f.gl.bufferData(0x8892, 37, 0x88e4)
    assert.equal(collectGraphicsSubsystemInventory(inputs, f.resources, f.properties).gpu.unattributedBytes, 37)
    f.gl.deleteBuffer(handle); f.gl.deleteBuffer(unknown)
    assert.equal(collectGraphicsSubsystemInventory(inputs, f.resources, f.properties).gpu.trackedBytes, 0)
  } finally { f.resources.dispose() }
})

test('real source/ink borrow geometry and skeleton once, including actual bone texture storage', () => {
  const f = instrument(), art = library(), cache = new GeometryCache()
  const presenter = createCharacterPresenter(illustratedCharacterPlan(resolveCharacterPlan('guard', 'soldier', 0)), art, cache, false)
  presenter.skeleton.computeBoneTexture()
  const ink = art.applyOutline(presenter.root, 'structural')
  const inputs = (): GraphicsSubsystemInputs => ({
    ...emptyInputs(), roots: [{ root: presenter.root, subsystem: 'dynamicArt' }],
    owners: [{ name: 'presenter', subsystem: 'dynamicArt', sources: presenter.sources, receipts: presenter.allocationReceipts(), missing: [] }],
  })
  try {
    const texture = presenter.skeleton.boneTexture!
    const gpu = f.gl.createTexture()
    f.gl.bindTexture(0x0de1, gpu)
    f.gl.texStorage2D(0x0de1, 1, 0x8814, texture.image.width, texture.image.height)
    f.gl.texSubImage2D(0x0de1, 0, 0, 0, texture.image.width, texture.image.height, 0x1908, 0x1406, texture.image.data)
    f.records.set(texture, { __webglTexture: gpu })
    const first = collectGraphicsSubsystemInventory(inputs(), f.resources, f.properties)
    assert.equal(first.cpu.conflicts.length, 0)
    const skeletons = new Set(presenter.sources.flatMap((source) => source instanceof THREE.SkinnedMesh ? [source.skeleton] : []))
    assert.equal(skeletons.size, 2, 'Body and independently articulated weapon skin must both be covered')
    assert.equal(first.byOwner.dynamicArt.cpuSkinBytes,
      [...skeletons].reduce((sum, skeleton) => sum + skeleton.boneMatrices!.byteLength, 0))
    assert.equal(first.gpu.byOwner.dynamicArt, texture.image.width * texture.image.height * 16)
    assert.ok(ink.shells.some((shell) => shell instanceof THREE.SkinnedMesh && shell.skeleton === presenter.skeleton))
    const firstBytes = first.cpu.retainedBytes
    art.releaseOutline(ink)
    const withoutInk = collectGraphicsSubsystemInventory(inputs(), f.resources, f.properties)
    assert.equal(withoutInk.byOwner.dynamicArt.cpuSkinBytes, first.byOwner.dynamicArt.cpuSkinBytes)
    assert.equal(withoutInk.cpu.retainedBytes, firstBytes, 'Ink owns no copy of borrowed body/skin backing stores')
    f.gl.deleteTexture(gpu)
    presenter.dispose()
    const disposed = collectGraphicsSubsystemInventory(emptyInputs(), f.resources, f.properties)
    assert.equal(disposed.cpu.retainedBytes, 0)
    assert.equal(disposed.gpu.trackedBytes, 0)
  } finally {
    art.releaseOutline(ink); presenter.dispose(); cache.dispose(); art.dispose(); f.resources.dispose()
  }
})

test('observed pipeline targets, mip storage and common shadows bill the pipeline once and release without a scene-size estimate', () => {
  const f = instrument(), target = new THREE.WebGLRenderTarget(8, 8), scene = new THREE.Scene()
  const meter = new GraphicsFrameMeter(f.renderer, scene, f.resources)
  try {
    const color = f.gl.createTexture(), depth = f.gl.createRenderbuffer()
    f.gl.bindTexture(0x0de1, color); f.gl.texStorage2D(0x0de1, 4, 0x8058, 8, 8)
    f.gl.bindRenderbuffer(0x8d41, depth); f.gl.renderbufferStorageMultisample(0x8d41, 4, 0x81a6, 8, 8)
    f.records.set(target.texture, { __webglTexture: color })
    f.records.set(target, { __webglDepthRenderbuffer: depth })
    f.renderer.setRenderTarget(target)
    const pipeline = collectGraphicsSubsystemInventory(emptyInputs(), f.resources, f.properties)
    assert.equal(pipeline.gpu.byOwner.postAndEffects, 340 + 1024)
    assert.equal(pipeline.gpu.reconciled, true)
    assert.equal(pipeline.sources.targets, 1)
    f.resources.observeRenderTarget(target, f.properties, true)
    const shadow = collectGraphicsSubsystemInventory(emptyInputs(), f.resources, f.properties)
    assert.equal(shadow.gpu.sharedBytes, 0)
    assert.equal(shadow.gpu.byOwner.postAndEffects, 1364)
    assert.ok(shadow.gpu.allocations.every((entry) => entry.pipeline === 'shadow-target'))
    target.dispose()
    f.gl.deleteTexture(color); f.gl.deleteRenderbuffer(depth)
    assert.equal(f.resources.liveRenderTargets().length, 0)
    assert.equal(collectGraphicsSubsystemInventory(emptyInputs(), f.resources, f.properties).gpu.trackedBytes, 0)
  } finally { meter.dispose(); target.dispose(); f.resources.dispose() }
})

test('already-created standard maps, common shadow storage and matching estimates bill the established pipeline once despite consumers', () => {
  const f = instrument(true), art = library(), scene = new THREE.Scene()
  const meter = new GraphicsFrameMeter(f.renderer, scene, f.resources)
  const target = new THREE.WebGLRenderTarget(8, 8)
  const materials: THREE.Material[] = []
  const gpuTextures: object[] = []
  const shared = new Uint8Array(32)
  const sharedBuffer = f.upload(shared)
  let depth: object | null = null
  try {
    const initial = art.getStandardTextureInventory()
    assert.deepEqual(initial, [art.rampTexture])
    assert.equal(art.libraryOwnedMaterialCount, 0, 'Diagnostic access must not allocate a contact map/material')
    const contact = art.createContactShadow()
    const maps = art.getStandardTextureInventory()
    assert.equal(maps.length, 2)
    assert.ok(contact.material instanceof THREE.MeshBasicMaterial)
    assert.equal(maps[1], contact.material.map)
    assert.notEqual(maps, art.getStandardTextureInventory(), 'Callers do not mutate an internal owner list')
    const originalRamp = art.rampTexture
    const duplicateMaps = [...maps, ...maps]
    const mapBacking = (map: THREE.DataTexture) => {
      assert.ok(map.image.data)
      return map.image.data.buffer
    }
    const roots: GraphicsSourceRoot[] = []
    let mapBytes = 0
    for (const [index, map] of maps.entries()) {
      const handle = f.gl.createTexture()
      gpuTextures.push(handle)
      f.gl.bindTexture(0x0de1, handle)
      const bpp = index === 0 ? 1 : 4
      f.gl.texStorage2D(0x0de1, 1, index === 0 ? 0x8229 : 0x8058, map.image.width, map.image.height)
      f.gl.texSubImage2D(0x0de1, 0, 0, 0, map.image.width, map.image.height,
        index === 0 ? 0x1903 : 0x1908, 0x1401, map.image.data)
      f.records.set(map, { __webglTexture: handle })
      mapBytes += map.image.width * map.image.height * bpp
      for (const subsystem of ['dynamicArt', 'world'] as const) {
        const material = new THREE.SpriteMaterial({ map })
        materials.push(material)
        const source = new THREE.Sprite(material)
        roots.push({ root: source, subsystem })
        f.resources.observeSource(source, subsystem, f.properties)
      }
    }
    const color = f.gl.createTexture()
    gpuTextures.push(color)
    depth = f.gl.createRenderbuffer()
    f.gl.bindTexture(0x0de1, color); f.gl.texStorage2D(0x0de1, 1, 0x8058, 8, 8)
    const extension = f.gl.getExtension('WEBGL_multisampled_render_to_texture')
    extension.framebufferTexture2DMultisampleEXT(0x8d40, 0x8ce0, 0x0de1, color, 0, 4)
    f.gl.bindRenderbuffer(0x8d41, depth); f.gl.renderbufferStorageMultisample(0x8d41, 4, 0x81a6, 8, 8)
    f.records.set(target.texture, { __webglTexture: color })
    f.records.set(target, { __webglDepthRenderbuffer: depth })
    f.renderer.setRenderTarget(target)
    f.resources.observeRenderTarget(target, f.properties, true)
    f.resources.observeRenderTarget(target, f.properties, true)
    for (const subsystem of ['dynamicArt', 'world'] as const) {
      const material = new THREE.SpriteMaterial({ map: target.texture })
      materials.push(material)
      const source = new THREE.Sprite(material)
      roots.push({ root: source, subsystem })
      f.resources.observeSource(source, subsystem, f.properties)
    }
    const inputs: GraphicsSubsystemInputs = {
      ...emptyInputs(), roots, standardPipelineTextures: duplicateMaps,
      owners: (['dynamicArt', 'world'] as const).map((subsystem) => ({
        name: subsystem, subsystem, sources: [], missing: [],
        receipts: [
          { identity: shared.buffer, chargedTo: subsystem, kind: 'geometry', cpuBytes: 32, gpuBytes: null },
          ...maps.map((map): VisualAllocationReceipt => ({
            identity: mapBacking(map), chargedTo: subsystem, kind: 'other',
            cpuBytes: mapBacking(map).byteLength, gpuBytes: null,
          })),
        ],
      })),
    }
    meter.begin(1 / 60, 'active'); meter.endUpdate()
    const frame = meter.end(runtime, 'sample')
    frame.bufferDimensions = { width: 8, height: 8 }
    const canvas = matchingGraphicsCanvasEstimate(frame, 8, 8, 4)
    assert.equal(canvas, 2304)
    const snapshot = graphicsSubsystemBudgetSnapshot(inputs, frame, [], f.resources, f.properties, canvas)
    const inventory = snapshot.inventory!
    const pipelineBytes = mapBytes + 256 + 1024
    assert.equal(inventory.gpu.byOwner.postAndEffects, pipelineBytes)
    assert.equal(inventory.gpu.sharedBytes, 32, 'Unrelated cross-owner geometry is NOT pipeline billing')
    assert.equal(inventory.gpu.byOwner.dynamicArt, 0)
    assert.equal(inventory.gpu.byOwner.world, 0)
    assert.equal(inventory.gpu.reconciled, true)
    const sharedSpriteBuffers = new Set(roots.flatMap(({ root }) => root instanceof THREE.Sprite
      ? [...Object.values(root.geometry.attributes).map((attribute) => attribute.array.buffer),
        ...(root.geometry.index ? [root.geometry.index.array.buffer] : [])] : []))
    assert.equal(inventory.cpu.sharedBytes,
      32 + [...sharedSpriteBuffers].reduce((sum, buffer) => sum + buffer.byteLength, 0),
      'Shared sprite geometry and the unrelated buffer are not standard-map allocations')
    assert.equal(inventory.cpu.conflictingBytes, 0)
    assert.equal(inventory.byOwner.postAndEffects.cpuBackingBytes,
      maps.reduce((sum, map) => sum + mapBacking(map).byteLength, 0))
    const common = inventory.gpu.allocations.filter((entry) => entry.pipeline !== null)
    assert.equal(common.length, 4)
    assert.equal(common.filter((entry) => entry.pipeline === 'shadow-target').length, 2)
    assert.equal(common.filter((entry) => entry.pipeline === 'standard-map').length, 2)
    assert.ok(common.filter((entry) => entry.kind === 'texture').every((entry) =>
      entry.claimantOwners.includes('dynamicArt') && entry.claimantOwners.includes('world')))
    assert.deepEqual(snapshot.knownGpuBudgetLowerBounds!.pipeline, {
      observedStorageBytes: pipelineBytes,
      estimatedDefaultFramebufferBytes: 2304,
      estimatedImplicitMultisampleBytes: 1024,
      estimatesComplete: true,
      scope: 'Known observed pipeline storage plus available same-frame canvas/implicit-MSAA estimates; not resident VRAM or complete ownership',
    })
    assert.equal(snapshot.knownGpuBudgetLowerBounds!.byOwner.postAndEffects, pipelineBytes + 2304 + 1024)
    assert.equal(snapshot.subsystems!.postAndEffects.resources.gpuAllocatedBytes, null)
    assert.equal(snapshot.assessment.status, 'incomplete')
    assert.ok(!snapshot.assessment.issues.some((issue) => issue.scope === 'reconciliation'))
    art.dispose()
    assert.deepEqual(art.getStandardTextureInventory(), [])
    assert.equal(initial[0], originalRamp, 'Accessor did not replace the library-owned resource')
  } finally {
    meter.dispose(); target.dispose()
    for (const material of materials) material.dispose()
    for (const handle of gpuTextures) f.gl.deleteTexture(handle)
    if (depth) f.gl.deleteRenderbuffer(depth)
    f.gl.deleteBuffer(sharedBuffer); art.dispose(); f.resources.dispose()
  }
})

test('matching canvas and implicit-MSAA estimates expose a partial pipeline overrun without inventing stale or unknown bytes', () => {
  const f = instrument(true), scene = new THREE.Scene(), target = new THREE.WebGLRenderTarget(4096, 4096)
  const meter = new GraphicsFrameMeter(f.renderer, scene, f.resources)
  const size = 4096
  const actualBytes = size * size * 4
  const matchingSize = { width: 4096, height: 2048 }
  try {
    const color = f.gl.createTexture()
    f.gl.bindTexture(0x0de1, color); f.gl.texStorage2D(0x0de1, 1, 0x8058, size, size)
    const extension = f.gl.getExtension('WEBGL_multisampled_render_to_texture')
    extension.framebufferTexture2DMultisampleEXT(0x8d40, 0x8ce0, 0x0de1, color, 0, 2)
    f.records.set(target.texture, { __webglTexture: color })
    f.renderer.setRenderTarget(target)
    f.resources.observeRenderTarget(target, f.properties, true)
    meter.begin(1 / 60, 'active'); meter.endUpdate()
    const frame = meter.end(runtime, 'sample')
    frame.bufferDimensions = matchingSize
    const canvas = matchingGraphicsCanvasEstimate(frame, 4096, 2048, 1)
    assert.equal(canvas, 64 * 1024 * 1024)
    const snapshot = graphicsSubsystemBudgetSnapshot(emptyInputs(), frame, [], f.resources, f.properties, canvas)
    assert.equal(snapshot.inventory!.gpu.byOwner.postAndEffects, actualBytes)
    assert.equal(snapshot.knownGpuBudgetLowerBounds!.pipeline.estimatedImplicitMultisampleBytes, 2 * actualBytes)
    assert.equal(snapshot.knownGpuBudgetLowerBounds!.byOwner.postAndEffects, 256 * 1024 * 1024)
    assert.ok(snapshot.assessment.issues.some((issue) =>
      issue.scope === 'postAndEffects' && issue.metric === 'knownPipelineGpuBytesIncludingEstimates' &&
      issue.observed === 256 * 1024 * 1024 && issue.limit === 176 * 1024 * 1024))
    assert.ok(!snapshot.assessment.issues.some((issue) => issue.scope === 'global'),
      'The existing global ledger remains within256MiB; the assigned pipeline exceeds176MiB')
    assert.equal(snapshot.inventory!.complete, false)
    assert.equal(snapshot.subsystems!.postAndEffects.resources.gpuAllocatedBytes, null)
    assert.equal(matchingGraphicsCanvasEstimate(frame, 390, 844, 1), null, 'Resized canvas is not the measured frame')
    assert.equal(matchingGraphicsCanvasEstimate(frame, 4096, 2048, null), null, 'Unknown sample count has no made-up estimate')
    assert.equal(matchingGraphicsCanvasEstimate(null, 4096, 2048, 1), null)
    const noCanvas = graphicsSubsystemBudgetSnapshot(emptyInputs(), frame, [], f.resources, f.properties,
      matchingGraphicsCanvasEstimate(frame, 390, 844, 1))
    assert.equal(noCanvas.knownGpuBudgetLowerBounds!.pipeline.estimatedDefaultFramebufferBytes, null)
    assert.equal(noCanvas.knownGpuBudgetLowerBounds!.byOwner.postAndEffects, 192 * 1024 * 1024)
    assert.ok(noCanvas.assessment.missing.includes('same-frame canvas allocation estimate unavailable'))
    extension.framebufferTexture2DMultisampleEXT(0x8d40, 0x8ce0, 0x0de1, color, 0, 4)
    const staleMsaa = graphicsSubsystemBudgetSnapshot(emptyInputs(), frame, [], f.resources, f.properties, canvas)
    assert.equal(staleMsaa.sameFrameStorage, false, 'Implicit MSAA can change without a storage-call counter change')
    assert.equal(staleMsaa.knownGpuBudgetLowerBounds!.pipeline.estimatedImplicitMultisampleBytes, null)
    extension.framebufferTexture2DMultisampleEXT(0x8d40, 0x8ce0, 0x0de1, color, 0, 2)
    const added = f.upload(new Uint8Array(4))
    const stale = graphicsSubsystemBudgetSnapshot(emptyInputs(), frame, [], f.resources, f.properties, canvas)
    assert.equal(stale.sameFrameStorage, false)
    assert.equal(stale.knownGpuBudgetLowerBounds!.pipeline.estimatedDefaultFramebufferBytes, null)
    assert.equal(stale.knownGpuBudgetLowerBounds!.pipeline.estimatedImplicitMultisampleBytes, null)
    assert.equal(stale.knownGpuBudgetLowerBounds!.byOwner.postAndEffects, actualBytes)
    assert.ok(stale.assessment.missing.includes('same-frame implicit-MSAA allocation estimate unavailable'))
    f.gl.deleteBuffer(added); f.gl.deleteTexture(color)
  } finally { meter.dispose(); target.dispose(); f.resources.dispose() }
})

test('canonical CPU-only sight controls and failed observer installation cannot masquerade as complete accounting', () => {
  const f = instrument()
  const sight = new Uint8Array(24)
  const handle = f.upload(sight)
  const inputs: GraphicsSubsystemInputs = {
    ...emptyInputs(), owners: [{
      name: 'canonical-sight', subsystem: 'world', sources: [], missing: [], receipts: [{
        identity: sight.buffer, kind: 'canonical-sight', chargedTo: 'world', cpuBytes: 24, gpuBytes: 0,
      }],
    }],
  }
  try {
    const inventory = collectGraphicsSubsystemInventory(inputs, f.resources, f.properties)
    assert.equal(inventory.byOwner.world.cpuCanonicalSightBytes, 24)
    assert.equal(inventory.gpu.canonicalSightGpuMappings, 1)
    assert.ok(inventory.missing.some((item) => item.includes('canonical-only sight backing unexpectedly')))
    const render = f.renderer.render, draw = f.gl.drawElements
    f.renderer.setRenderTarget = undefined
    assert.throws(() => new GraphicsFrameMeter(f.renderer, new THREE.Scene(), f.resources), /installation failed/)
    assert.equal(f.renderer.info.autoReset, true)
    assert.equal(f.renderer.render, render)
    assert.equal(f.gl.drawElements, draw)
  } finally { f.gl.deleteBuffer(handle); f.resources.dispose() }
})

test('known mapped GPU storage can exceed its owner budget even while complete GPU ownership remains unknown', () => {
  const f = instrument(), scene = new THREE.Scene(), target = new THREE.WebGLRenderTarget(8192, 8192)
  const meter = new GraphicsFrameMeter(f.renderer, scene, f.resources)
  try {
    const handle = f.gl.createTexture()
    f.gl.bindTexture(0x0de1, handle)
    f.gl.texStorage2D(0x0de1, 1, 0x8058, 8192, 8192)
    f.records.set(target.texture, { __webglTexture: handle })
    f.renderer.setRenderTarget(target)
    meter.begin(1 / 60, 'active'); meter.endUpdate()
    const frame = meter.end(runtime, 'sample')
    const snapshot = graphicsSubsystemBudgetSnapshot(emptyInputs(), frame, [], f.resources, f.properties, 0)
    assert.equal(snapshot.assessment.status, 'over-budget-or-inconsistent')
    assert.ok(snapshot.assessment.issues.some((issue) =>
      issue.scope === 'postAndEffects' && issue.metric === 'knownPipelineGpuBytesIncludingEstimates' && issue.observed === 268435456))
    assert.equal(snapshot.subsystems!.postAndEffects.resources.gpuAllocatedBytes, null)
    f.gl.deleteTexture(handle)
    const stale = graphicsSubsystemBudgetSnapshot(emptyInputs(), frame, [], f.resources, f.properties, 0)
    assert.equal(stale.sameFrameStorage, false)
    assert.ok(stale.assessment.missing.includes('live inventory storage changed since the measured frame'))
  } finally { meter.dispose(); target.dispose(); f.resources.dispose() }
})

test('production engine diagnostic adapter consumes live Character/Creature/Wagon/world/effect inventories and releases them', () => {
  const f = instrument(), art = library(), cache = new GeometryCache(), scene = new THREE.Scene()
  const world = new GeneratedWorldRuntime(scene, generateWorld(20260906), {
    art, visualPolicy: policy, terrainResolution: 6, decorationDensity: 0.2, outlineDressing: true,
  })
  world.update({ focus: world.getStartPosition('guard'), deltaSeconds: 0 })
  const characters = new Set<CharacterPresenter>(), creatures = new Set<CreaturePresenter>(), wagons = new Set<WagonPresenter>()
  const effects = new SecondaryEffectPool(scene, 7)
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    artLibrary: art, artGeometry: cache, generatedWorld: world, visualPolicy: policy,
    characterPresenters: characters, creaturePresenters: creatures, wagonPresenters: wagons,
    actors: [], atmosphereRoot: new THREE.Group(), flames: [],
    palette: {
      success: new THREE.Color(0x4ade80), link: new THREE.Color(0x4da6ff), accent: new THREE.Color(0xfd8ea1),
      warning: new THREE.Color(0xfbbf24), bg: new THREE.Color(0x302d29), text: new THREE.Color(0xdedede),
      surface: new THREE.Color(0x45413c), borderStrong: new THREE.Color(0x605e5a),
    },
    secondaryEffects: effects, transientBudget: new TransientEffectBudget(),
    weaponTrail: new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()),
    rain: new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial()),
    snow: new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial()),
    particles: [], inactiveGoreParticles: [], decals: [], damageNumberFx: [], comicCalloutFx: [], impactRayFx: [],
    projectiles: [], telegraphPool: [], finaleTelegraphs: [], lootPickups: [], lootCollectionBursts: [],
  })
  engine.player = engine.createCharacter('guard', true)
  engine.caravan = engine.createCaravan()
  const beast = engine.createBeast('wolf')
  engine.actors.push({ mesh: beast })
  for (const source of [engine.weaponTrail, engine.rain, engine.snow]) source.userData.visualSubsystem = 'postAndEffects'
  try {
    const inputs: GraphicsSubsystemInputs = engine.graphicsSubsystemInventory()
    assert.ok(inputs.owners.some((owner) => owner.name.startsWith('character:')))
    assert.ok(inputs.owners.filter((owner) => owner.name.startsWith('creature:')).length >= 4,
      'Wagon frame, two draft oxen and beast owners must be actual live presenters')
    assert.ok(inputs.roots.some((entry) => entry.root === engine.caravan))
    const first = collectGraphicsSubsystemInventory(inputs, f.resources, f.properties)
    assert.ok(first.byOwner.dynamicArt.cpuBackingBytes > 0)
    assert.ok(first.byOwner.world.cpuGeometryBytes > 0)
    assert.ok(first.byOwner.world.cpuCanonicalSightBytes > 0)
    assert.ok(first.byOwner.postAndEffects.cpuBackingBytes > 0)
    assert.equal(first.gpu.trackedBytes, 0, 'Constructing real art in Node is not evidence of any GPU upload')
    assert.equal(first.byOwner.dynamicArt.gpuAllocatedBytes, null)
    assert.equal(first.complete, false)
    assert.equal(first.cpu.conflicts.length, 0)
    assert.equal(first.sources.unattributed, 0, 'Inactive pooled effect sources retain their real inventory owner')
    effects.dispose()
    world.dispose()
    for (const presenter of characters) presenter.dispose()
    for (const presenter of creatures) presenter.dispose()
    for (const presenter of wagons) presenter.dispose()
    characters.clear(); creatures.clear(); wagons.clear(); engine.actors.length = 0
    const after: GraphicsSubsystemInputs = engine.graphicsSubsystemInventory()
    const remaining = collectGraphicsSubsystemInventory(after, f.resources, f.properties)
    assert.equal(remaining.byOwner.world.cpuCanonicalSightBytes, 0)
    assert.ok(remaining.cpu.retainedBytes < first.cpu.retainedBytes)
    assert.equal(remaining.cpu.conflicts.length, 0)
  } finally {
    for (const presenter of characters) presenter.dispose()
    for (const presenter of creatures) presenter.dispose()
    for (const presenter of wagons) presenter.dispose()
    for (const mesh of [engine.weaponTrail, engine.rain, engine.snow]) { mesh.geometry.dispose(); mesh.material.dispose() }
    effects.dispose(); world.dispose(); cache.dispose(); art.dispose(); f.resources.dispose()
  }
})
