import * as THREE from 'three'
import { StylizedArtLibrary } from '../art/index.ts'
import type { VisualAllocationReceipt, VisualResourceKind } from '../diagnostics/VisualBudgetAccounting.ts'

export interface WorldVisualInventory {
  readonly receipts: readonly VisualAllocationReceipt[]
  readonly sources: readonly THREE.Mesh[]
  readonly cacheEntries: number
  readonly materials: number
  readonly textureMipBytes: number
  readonly additionalSightGeometries: number
  readonly complete: false
  readonly missing: readonly string[]
}

/** Snapshot receipts, not another cache, lifetime owner, GL meter or estimate of actual VRAM. */
export function collectWorldArtInventory(
  roots: readonly THREE.Object3D[],
  cache: ReadonlyMap<string, THREE.BufferGeometry>,
  regionGeometry: ReadonlySet<THREE.BufferGeometry>,
  materials: readonly THREE.Material[],
  textures: readonly THREE.Texture[],
  hasCanonicalSight: boolean,
): WorldVisualInventory {
  const receipts: VisualAllocationReceipt[] = []
  const buffers = new Set<ArrayBufferLike>()
  const sources: THREE.Mesh[] = []
  const originals = new Set([...cache.values(), ...regionGeometry])
  const add = (array: ArrayBufferView, kind: VisualResourceKind, gpuBytes: number | null): void => {
    if (buffers.has(array.buffer)) return
    buffers.add(array.buffer)
    receipts.push({ identity: array.buffer, chargedTo: 'world', kind, cpuBytes: array.buffer.byteLength, gpuBytes })
  }
  const geometry = (value: THREE.BufferGeometry, kind: VisualResourceKind): void => {
    const attribute = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) =>
      add(a instanceof THREE.InterleavedBufferAttribute ? a.data.array : a.array, kind,
        kind === 'canonical-sight' ? 0 : null)
    for (const a of Object.values(value.attributes)) attribute(a)
    if (value.index) attribute(value.index)
    for (const list of Object.values(value.morphAttributes)) for (const a of list) attribute(a)
  }
  for (const root of roots) root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || StylizedArtLibrary.isOutlineShell(object)) return
    sources.push(object)
    geometry(object.geometry, originals.has(object.geometry) ? 'geometry' : 'binding-clone')
    if (object instanceof THREE.InstancedMesh) {
      add(object.instanceMatrix.array, 'other', null)
      if (object.instanceColor) add(object.instanceColor.array, 'other', null)
    }
  })
  let additionalSightGeometries = 0
  for (const [key, value] of cache) {
    const canonical = hasCanonicalSight && !key.startsWith('tactile:')
    if (canonical) additionalSightGeometries++
    geometry(value, canonical ? 'canonical-sight' : 'geometry')
  }
  for (const value of regionGeometry) geometry(value, 'geometry')
  let textureMipBytes = 0
  for (const texture of textures) {
    if (!(texture instanceof THREE.DataTexture) || !ArrayBuffer.isView(texture.image.data)) {
      throw new Error(`World art inventory cannot describe texture ${texture.name}`)
    }
    add(texture.image.data, 'other', null)
    let width = texture.image.width, height = texture.image.height
    const levels = texture.generateMipmaps ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1
    for (let level = 0; level < levels; level++) {
      textureMipBytes += width * height * 4
      width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2))
    }
  }
  return {
    receipts, sources, cacheEntries: cache.size, materials: materials.length, textureMipBytes,
    additionalSightGeometries, complete: false,
    missing: ['GL allocation-to-owner attribution', 'JS object/proxy storage', 'temporary construction peak storage'],
  }
}
