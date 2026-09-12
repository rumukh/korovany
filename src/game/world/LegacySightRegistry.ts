import * as THREE from 'three'
import { StylizedArtLibrary } from '../art/index.ts'

export interface LegacySightMaterial {
  readonly side: THREE.Side
  readonly transparent: boolean
  readonly opacity: number
}

interface LegacySightBase {
  readonly id: string
  readonly parentId: string | null
  readonly siteId?: string
  readonly matrix: THREE.Matrix4
}

export type LegacySightNode =
  | (LegacySightBase & { readonly kind: 'group' })
  | (LegacySightBase & {
      readonly kind: 'mesh'
      readonly geometry: THREE.BufferGeometry
      readonly materials: LegacySightMaterial | readonly LegacySightMaterial[]
      readonly excluded: boolean
    })

export interface LegacySightBinding {
  readonly regionId: string
  setAttached(attached: boolean): void
  dispose(): void
}

const MARKER = 'legacySightProxy'

export function isLegacySightProxy(object: THREE.Object3D): boolean {
  return object.userData[MARKER] === true
}

/** The old capture predicate, not a current-visibility or active-LOD test. */
export function isLegacySightSource(object: THREE.Object3D): object is THREE.Mesh {
  if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh ||
      StylizedArtLibrary.isOutlineShell(object) || object.userData.cameraPassThrough === true ||
      object.geometry instanceof THREE.PlaneGeometry) return false
  const materials = Array.isArray(object.material) ? object.material : [object.material]
  return materials.some((material) => !material.transparent || material.opacity >= 0.65)
}

/** Capture before enhanced geometry/material/transform changes. Geometry is borrowed. */
export function captureLegacySightHierarchy(root: THREE.Object3D): LegacySightNode[] {
  const result: LegacySightNode[] = []
  const visit = (object: THREE.Object3D, parentId: string | null): void => {
    if (StylizedArtLibrary.isOutlineShell(object) || isLegacySightProxy(object)) return
    // updateMatrix, not updateMatrixWorld: the first AI frame still sees the old
    // world matrices, just as it did before the scene's first render.
    if (object.matrixAutoUpdate) object.updateMatrix()
    const base = {
      id: String(object.id), parentId, matrix: object.matrix.clone(),
      ...(typeof object.userData.generatedSiteId === 'string'
        ? { siteId: object.userData.generatedSiteId } : {}),
    }
    if (object instanceof THREE.Mesh && !(object instanceof THREE.InstancedMesh)) {
      const describe = (material: THREE.Material): LegacySightMaterial => ({
        side: material.side, transparent: material.transparent, opacity: material.opacity,
      })
      result.push({
        ...base, kind: 'mesh', geometry: object.geometry,
        materials: Array.isArray(object.material) ? object.material.map(describe) : describe(object.material),
        excluded: object.userData.cameraPassThrough === true || object.geometry instanceof THREE.PlaneGeometry,
      })
    } else result.push({ ...base, kind: 'group' })
    for (const child of object.children) visit(child, base.id)
  }
  visit(root, null)
  return result
}

interface RegionSight {
  root: THREE.Group
  meshes: THREE.Mesh[]
  sites: Map<string, THREE.Object3D>
}

export class LegacySightRegistry {
  private readonly root = new THREE.Group()
  private readonly regions = new Map<string, RegionSight>()
  private readonly materials = new Map<string, THREE.MeshBasicMaterial>()
  private readonly outputs = new Set<THREE.Object3D[]>()
  private readonly razed = new Set<string>()
  private disposed = false

  constructor(scene: THREE.Scene) {
    this.root.name = 'canonical-legacy-sight'
    this.root.visible = false
    this.root.userData[MARKER] = true
    // Scene.updateMatrixWorld also visits invisible children. Rendering does not.
    scene.add(this.root)
  }

  registerLegacySightRegion(regionId: string, hierarchy: readonly LegacySightNode[]): LegacySightBinding {
    if (this.disposed || this.regions.has(regionId)) throw new Error(`Invalid legacy sight registration: ${regionId}`)
    const nodes = new Map<string, THREE.Object3D>()
    const region: RegionSight = { root: new THREE.Group(), meshes: [], sites: new Map() }
    region.root.name = `canonical-region:${regionId}`
    region.root.userData[MARKER] = true
    for (const node of hierarchy) {
      if (nodes.has(node.id) || !node.matrix.elements.every(Number.isFinite)) {
        throw new Error(`Invalid canonical sight node: ${node.id}`)
      }
      const object = node.kind === 'mesh'
        ? new THREE.Mesh(node.geometry, Array.isArray(node.materials)
          ? node.materials.map((material) => this.rayMaterial(material))
          : this.rayMaterial(node.materials as LegacySightMaterial))
        : new THREE.Group()
      object.name = `canonical-node:${node.id}`
      object.userData[MARKER] = true
      object.matrixAutoUpdate = false
      object.matrix.copy(node.matrix)
      object.matrix.decompose(object.position, object.quaternion, object.scale)
      if (node.kind === 'mesh') {
        object.userData.cameraPassThrough = node.excluded
        region.meshes.push(object as THREE.Mesh)
      }
      nodes.set(node.id, object)
      if (node.siteId) {
        if (region.sites.has(node.siteId)) throw new Error(`Duplicate canonical site: ${node.siteId}`)
        region.sites.set(node.siteId, object)
      }
    }
    for (const node of hierarchy) {
      const object = nodes.get(node.id)!
      const parent = node.parentId === null ? region.root : nodes.get(node.parentId)
      if (!parent) throw new Error(`Unknown canonical parent: ${node.parentId}`)
      let cursor: string | null = node.parentId
      const visited = new Set([node.id])
      while (cursor !== null) {
        if (visited.has(cursor)) throw new Error(`Cyclic canonical hierarchy: ${node.id}`)
        visited.add(cursor)
        const descriptor = hierarchy.find((entry) => entry.id === cursor)
        if (!descriptor) throw new Error(`Unknown canonical parent: ${cursor}`)
        cursor = descriptor.parentId
      }
      parent.add(object)
    }
    this.regions.set(regionId, region)
    // Raze is replayed by the engine after capture, matching baseline membership.
    let released = false
    return {
      regionId,
      setAttached: (attached) => {
        if (released) throw new Error(`Legacy sight binding released: ${regionId}`)
        if (attached) this.root.add(region.root)
        else region.root.removeFromParent()
      },
      dispose: () => {
        if (released) return
        released = true
        region.root.removeFromParent()
        for (const output of this.outputs) {
          for (let index = output.length - 1; index >= 0; index--) {
            if (region.meshes.includes(output[index] as THREE.Mesh)) output.splice(index, 1)
          }
        }
        this.regions.delete(regionId)
        region.root.clear()
        region.meshes.length = 0
        region.sites.clear()
      },
    }
  }

  collectLegacySightSources(target: THREE.Object3D[]): void {
    if (this.disposed) throw new Error('Canonical sight registry is disposed')
    target.length = 0
    this.outputs.add(target)
    for (const region of this.regions.values()) {
      if (region.root.parent !== this.root) continue
      for (const mesh of region.meshes) if (isLegacySightSource(mesh)) target.push(mesh)
    }
  }

  setRazedSite(siteId: string, side: THREE.Side = THREE.FrontSide): void {
    this.razed.add(siteId)
    for (const region of this.regions.values()) {
      const site = region.sites.get(siteId)
      if (!site || site.userData.razed === true) continue
      site.userData.razed = true
      site.scale.set(1, 0.68, 1)
      site.updateMatrix()
      const material = this.rayMaterial({ side, transparent: false, opacity: 1 })
      site.traverse((object) => {
        if (object instanceof THREE.Mesh && !StylizedArtLibrary.isOutlineShell(object)) object.material = material
      })
    }
  }

  get regionCount(): number { return this.regions.size }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const output of this.outputs) output.length = 0
    this.outputs.clear()
    this.root.removeFromParent()
    this.root.clear()
    this.regions.clear()
    this.razed.clear()
    for (const material of this.materials.values()) material.dispose()
    this.materials.clear()
  }

  private rayMaterial(input: LegacySightMaterial): THREE.MeshBasicMaterial {
    if (![THREE.FrontSide, THREE.BackSide, THREE.DoubleSide].includes(input.side) ||
        !Number.isFinite(input.opacity)) throw new Error('Invalid canonical ray material')
    const key = `${input.side}:${input.transparent}:${input.opacity}`
    const found = this.materials.get(key)
    if (found) return found
    if (this.materials.size >= 32) throw new Error('Canonical ray-material budget exceeded')
    const material = new THREE.MeshBasicMaterial(input)
    this.materials.set(key, material)
    return material
  }
}
