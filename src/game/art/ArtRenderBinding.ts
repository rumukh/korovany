import * as THREE from 'three'
import {
  ART_SHADOW_ATTRIBUTE,
  ART_VISIBILITY_ATTRIBUTE,
  artGeometryBytes,
  getArtMaterialFeatures,
  validateArtGeometry,
} from './ArtPresentation.ts'

export interface ArtGeometryLease {
  readonly geometry: THREE.BufferGeometry
  release(): void
}

export interface ArtRenderSourceOptions {
  readonly geometryLease?: ArtGeometryLease
  readonly visibility?: boolean
  readonly shadowParticipation?: boolean
  readonly deformationPadding?: number
}

export interface ArtRenderSourceBinding {
  readonly source: THREE.Mesh
  readonly bounds: THREE.Box3
}

interface SourceState extends ArtRenderSourceBinding {
  original: THREE.BufferGeometry
  geometry: THREE.BufferGeometry
  owned: boolean
  lease?: ArtGeometryLease
  visibility: boolean
  shadowParticipation: boolean
  padding: number
  capacity: number
  matrix?: THREE.InstancedBufferAttribute
  previousDepth: THREE.Material | undefined
  shells: Set<THREE.Mesh>
}

export class ArtRenderBindings {
  private readonly states = new Map<THREE.Mesh, SourceState>()
  private readonly tokens = new WeakMap<ArtRenderSourceBinding, SourceState>()
  private readonly released = new WeakSet<ArtRenderSourceBinding>()
  private readonly markOwned: (geometry: THREE.BufferGeometry) => void
  private readonly releaseShell: (shell: THREE.Mesh) => void

  constructor(
    markOwned: (geometry: THREE.BufferGeometry) => void,
    releaseShell: (shell: THREE.Mesh) => void,
  ) {
    this.markOwned = markOwned
    this.releaseShell = releaseShell
  }

  bind(source: THREE.Mesh, options: ArtRenderSourceOptions, depth?: THREE.MeshDepthMaterial): ArtRenderSourceBinding {
    if (this.states.has(source)) throw new Error(`Art source is already bound: ${source.name}`)
    if (options.geometryLease && options.geometryLease.geometry !== source.geometry) {
      throw new Error('Initial art lease must describe the source geometry; use replacement for a geometry change')
    }
    const original = options.geometryLease?.geometry ?? source.geometry
    const padding = options.deformationPadding ?? 0
    if (!Number.isFinite(padding) || padding < 0) throw new RangeError('Invalid art deformation padding')
    const prepared = this.prepare(source, original, options.visibility === true, options.shadowParticipation === true)
    const state: SourceState = {
      source, original, geometry: prepared.geometry, owned: prepared.owned, lease: options.geometryLease,
      visibility: options.visibility === true, shadowParticipation: options.shadowParticipation === true,
      padding, capacity: source instanceof THREE.InstancedMesh ? source.instanceMatrix.count : 1,
      ...(source instanceof THREE.InstancedMesh ? { matrix: source.instanceMatrix } : {}),
      previousDepth: source.customDepthMaterial, shells: new Set(), bounds: new THREE.Box3(),
    }
    source.geometry = state.geometry
    if (depth) source.customDepthMaterial = depth
    this.states.set(source, state)
    this.tokens.set(state, state)
    this.refresh(state)
    return state
  }

  replace(binding: ArtRenderSourceBinding, lease: ArtGeometryLease): void {
    const state = this.require(binding)
    if (lease === state.lease || lease.geometry === state.original || lease.geometry === state.geometry) {
      throw new Error('Geometry replacement needs a distinct untransferred lease')
    }
    const prepared = this.prepare(state.source, lease.geometry, state.visibility, state.shadowParticipation)
    if (state.shells.size > 0 && state.geometry.hasAttribute('outlineNormal') !== prepared.geometry.hasAttribute('outlineNormal')) {
      if (prepared.owned) prepared.geometry.dispose()
      throw new Error('Outline layout must remain compatible during geometry replacement')
    }
    for (const name of [ART_VISIBILITY_ATTRIBUTE, ART_SHADOW_ATTRIBUTE]) {
      const old = state.geometry.getAttribute(name)
      const next = prepared.geometry.getAttribute(name)
      if (!old || !next) continue
      if (state.source instanceof THREE.InstancedMesh) {
        for (let index = 0; index < next.count; index++) next.setX(index, old.getX(index))
      } else next.array.fill(old.getX(0))
      next.needsUpdate = true
    }
    const previousGeometry = state.geometry
    const previousOwned = state.owned
    const previousLease = state.lease
    // No disposal event runs while a source/ink/depth borrower holds the old
    // geometry. The stable shell nodes preserve existing outline binding arrays.
    for (const shell of state.shells) shell.removeFromParent()
    state.source.geometry = prepared.geometry
    state.geometry = prepared.geometry
    state.original = lease.geometry
    state.owned = prepared.owned
    state.lease = lease
    for (const shell of state.shells) {
      shell.geometry = state.geometry
      state.source.add(shell)
    }
    this.refresh(state)
    this.releaseGeometry(previousOwned ? previousGeometry : undefined, previousLease)
  }

  refresh(binding: ArtRenderSourceBinding): void {
    const state = this.require(binding)
    if (state.source.geometry !== state.geometry) throw new Error('Replace art geometry through its binding')
    const source = state.source
    if (source instanceof THREE.InstancedMesh &&
        (source.instanceMatrix !== state.matrix || source.count < 0 || source.count > state.capacity ||
          !Number.isInteger(source.count))) throw new Error('Art instance capacity or matrix identity changed')
    state.geometry.computeBoundingBox()
    state.geometry.computeBoundingSphere()
    state.bounds.copy(state.geometry.boundingBox!)
    state.bounds.expandByScalar(state.padding)
    if (source instanceof THREE.InstancedMesh) {
      const count = source.count
      source.count = state.capacity
      source.computeBoundingBox()
      source.computeBoundingSphere()
      source.count = count
      source.boundingBox?.expandByScalar(state.padding)
      if (source.boundingSphere) source.boundingSphere.radius += state.padding
    }
    if (source instanceof THREE.SkinnedMesh) {
      // A rig supplies conservative animation padding once, not an O(vertices)
      // deformed bound on every frame. Pose changes cannot cull the borrowed ink.
      source.boundingBox = state.bounds.clone()
      source.boundingSphere = state.geometry.boundingSphere!.clone()
      source.boundingSphere.radius += state.padding
    }
    for (const shell of state.shells) this.syncShell(source, shell)
  }

  attachShell(source: THREE.Mesh, shell: THREE.Mesh): void {
    this.states.get(source)?.shells.add(shell)
    this.syncShell(source, shell)
  }

  detachShell(shell: THREE.Mesh): void {
    if (shell.parent instanceof THREE.Mesh) this.states.get(shell.parent)?.shells.delete(shell)
  }

  get(source: THREE.Mesh): ArtRenderSourceBinding | undefined { return this.states.get(source) }

  setVisibility(binding: ArtRenderSourceBinding, value: number, instance?: number): void {
    this.setAttribute(this.require(binding), ART_VISIBILITY_ATTRIBUTE, value, instance)
  }

  setShadowParticipation(binding: ArtRenderSourceBinding, value: number, instance?: number): void {
    if (value !== 0 && value !== 1) throw new RangeError('Shadow participation must be zero or one')
    this.setAttribute(this.require(binding), ART_SHADOW_ATTRIBUTE, value, instance)
  }

  getVisibility(binding: ArtRenderSourceBinding, instance = 0): number {
    const state = this.require(binding)
    const attribute = state.geometry.getAttribute(ART_VISIBILITY_ATTRIBUTE)
    if (!attribute || instance < 0 || instance >= attribute.count) throw new RangeError('Invalid art visibility slot')
    return attribute.getX(instance)
  }

  release(binding: ArtRenderSourceBinding): void {
    const state = this.tokens.get(binding)
    if (!state) {
      if (this.released.has(binding)) return
      throw new Error('Art binding belongs to another owner')
    }
    this.tokens.delete(binding)
    this.released.add(binding)
    this.states.delete(state.source)
    const errors: unknown[] = []
    for (const shell of state.shells) {
      try { this.releaseShell(shell) } catch (error) { errors.push(error) }
    }
    state.shells.clear()
    state.source.geometry = state.original
    state.source.customDepthMaterial = state.previousDepth
    const lease = state.lease
    state.lease = undefined
    try { this.releaseGeometry(state.owned ? state.geometry : undefined, lease) } catch (error) { errors.push(error) }
    if (errors.length) throw new AggregateError(errors, 'Art source release was incomplete')
  }

  dispose(): void {
    const errors: unknown[] = []
    for (const state of [...this.states.values()]) {
      try { this.release(state) } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Art source cleanup was incomplete')
  }

  getStats(): { sources: number; ownedGeometries: number; geometryBytes: number; attributeBytes: number } {
    let ownedGeometries = 0
    let geometryBytes = 0
    let attributeBytes = 0
    for (const state of this.states.values()) {
      if (state.owned) {
        ownedGeometries++
        geometryBytes += artGeometryBytes(state.geometry)
        for (const name of [ART_VISIBILITY_ATTRIBUTE, ART_SHADOW_ATTRIBUTE]) {
          attributeBytes += state.geometry.getAttribute(name)?.array.byteLength ?? 0
        }
      }
    }
    return { sources: this.states.size, ownedGeometries, geometryBytes, attributeBytes }
  }

  private require(binding: ArtRenderSourceBinding): SourceState {
    const state = this.tokens.get(binding)
    if (!state) throw new Error('Art binding is released or belongs to another library')
    return state
  }

  private prepare(source: THREE.Mesh, original: THREE.BufferGeometry, visibility: boolean, shadow: boolean) {
    if (source instanceof THREE.InstancedMesh && (!Number.isInteger(source.count) ||
        source.count < 0 || source.count > source.instanceMatrix.count)) throw new Error('Invalid art instance count')
    const owned = visibility || shadow
    const geometry = owned ? original.clone() : original
    try {
      for (const [name, enabled] of [[ART_VISIBILITY_ATTRIBUTE, visibility], [ART_SHADOW_ATTRIBUTE, shadow]] as const) {
        if (!enabled) continue
        const count = source instanceof THREE.InstancedMesh ? source.instanceMatrix.count : geometry.getAttribute('position').count
        const values = new Float32Array(count).fill(name === ART_VISIBILITY_ATTRIBUTE ? 1 : 0)
        const attribute = source instanceof THREE.InstancedMesh
          ? new THREE.InstancedBufferAttribute(values, 1) : new THREE.BufferAttribute(values, 1)
        attribute.setUsage(THREE.DynamicDrawUsage)
        geometry.setAttribute(name, attribute)
      }
      validateArtGeometry(source, geometry)
      if (visibility && (Array.isArray(source.material) ? source.material : [source.material])
        .some((material) => !getArtMaterialFeatures(material)?.enhanced || material.transparent)) {
        throw new Error('Camera fade requires opaque enhanced art materials')
      }
      if (owned) this.markOwned(geometry)
      return { geometry, owned }
    } catch (error) {
      if (owned) geometry.dispose()
      throw error
    }
  }

  private setAttribute(state: SourceState, name: string, value: number, instance?: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Invalid art visibility value')
    if (!state.owned || (name === ART_VISIBILITY_ATTRIBUTE ? !state.visibility : !state.shadowParticipation)) {
      throw new Error(`Art binding does not own ${name}`)
    }
    const attribute = state.geometry.getAttribute(name)
    if (!(attribute instanceof THREE.BufferAttribute)) throw new Error('Mutable art state must be an owned buffer attribute')
    if (instance !== undefined) {
      if (!(state.source instanceof THREE.InstancedMesh) || !Number.isInteger(instance) ||
          instance < 0 || instance >= state.capacity) throw new RangeError('Invalid art instance index')
      if (attribute.getX(instance) === value) return
      attribute.setX(instance, value)
      attribute.clearUpdateRanges()
    } else {
      if (!(state.source instanceof THREE.InstancedMesh) && attribute.getX(0) === value) return
      attribute.array.fill(value)
      attribute.clearUpdateRanges()
    }
    attribute.needsUpdate = true
  }

  private releaseGeometry(geometry?: THREE.BufferGeometry, lease?: ArtGeometryLease): void {
    const errors: unknown[] = []
    try { geometry?.dispose() } catch (error) { errors.push(error) }
    try { lease?.release() } catch (error) { errors.push(error) }
    if (errors.length) throw new AggregateError(errors, 'Art geometry release was incomplete')
  }

  private syncShell(source: THREE.Mesh, shell: THREE.Mesh): void {
    shell.geometry = source.geometry
    if (source instanceof THREE.InstancedMesh && shell instanceof THREE.InstancedMesh) {
      shell.count = source.count
      shell.boundingBox = source.boundingBox
      shell.boundingSphere = source.boundingSphere
    }
    if (source instanceof THREE.SkinnedMesh && shell instanceof THREE.SkinnedMesh) {
      shell.skeleton = source.skeleton
      shell.bindMode = source.bindMode
      shell.bindMatrix.copy(source.bindMatrix)
      shell.bindMatrixInverse.copy(source.bindMatrixInverse)
      shell.boundingBox = source.boundingBox
      shell.boundingSphere = source.boundingSphere
    }
  }
}
