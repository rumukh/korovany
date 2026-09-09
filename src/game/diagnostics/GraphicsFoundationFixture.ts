import * as THREE from 'three'
import {
  ART_SURFACE_ATTRIBUTE,
  ART_WIND_ATTRIBUTE,
  StylizedArtLibrary,
  bakeOutlineNormals,
  ensureVertexColors,
  taperedBox,
  type ArtRenderSourceBinding,
  type OutlineBinding,
} from '../art/index.ts'

/** Opt-in diagnostic geometry only; never a replacement actor or gameplay collider. */
export class GraphicsFoundationFixture {
  private readonly art: StylizedArtLibrary
  private readonly root = new THREE.Group()
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly bindings: ArtRenderSourceBinding[] = []
  private readonly outlines: OutlineBinding[] = []
  private body!: THREE.SkinnedMesh
  private upper!: THREE.Bone
  private skeleton!: THREE.Skeleton
  private canopy!: THREE.InstancedMesh
  private disposed = false

  constructor(art: StylizedArtLibrary, scene: THREE.Scene, anchor: THREE.Vector3, yaw: number) {
    if (!art.enhanced) throw new Error('The skin/wind/depth fixture requires the explicit enhanced preview')
    this.art = art
    this.root.name = 'graphics-foundation-fixture'
    this.root.userData.cameraPassThrough = true
    this.root.position.copy(anchor)
    this.root.rotation.y = -yaw
    scene.add(this.root)
    try {
      this.build()
    } catch (error) {
      try { this.dispose() } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Foundation fixture construction and cleanup failed')
      }
      throw error
    }
  }

  private build(): void {
    const art = this.art
    const bodyGeometry = ensureVertexColors(bakeOutlineNormals(taperedBox({
      width: 1.2, depth: 0.7, height: 2.6, segments: 6, anchor: 'base',
    })))
    this.geometries.push(bodyGeometry)
    const positions = bodyGeometry.getAttribute('position')
    const count = positions.count
    const skinIndices = new Uint16Array(count * 4)
    const skinWeights = new Float32Array(count * 4)
    const surfaces = new Float32Array(count * 4)
    const color = bodyGeometry.getAttribute('color')
    const skinColor = new THREE.Color(0xdab08e), clothColor = new THREE.Color(0x547ba8)
    for (let index = 0; index < count; index++) {
      const height = positions.getY(index)
      const weight = THREE.MathUtils.smoothstep(height, 0.7, 1.9)
      skinIndices.set([0, 1, 0, 0], index * 4)
      skinWeights.set([1 - weight, weight, 0, 0], index * 4)
      surfaces.set(height > 1.9 ? [0.78, 0, 0.7, 0.2] : [0.48, 0.28, 0.8, 0.3], index * 4)
      const value = height > 1.9 ? skinColor : clothColor
      color.setXYZ(index, value.r, value.g, value.b)
    }
    bodyGeometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4))
    bodyGeometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4))
    bodyGeometry.setAttribute(ART_SURFACE_ATTRIBUTE, new THREE.BufferAttribute(surfaces, 4))
    this.body = new THREE.SkinnedMesh(bodyGeometry, art.acquireMaterial('diagnostic:packed-body', {
      color: 0xffffff, surface: 'cloth', vertexColors: true, attributes: { surfaceResponse: true },
    }))
    this.body.name = 'diagnostic-skinned-source'
    this.body.position.set(-2, 0, -4)
    const lower = new THREE.Bone()
    this.upper = new THREE.Bone()
    this.upper.position.y = 1.1
    lower.add(this.upper)
    this.body.add(lower)
    this.root.add(this.body)
    this.skeleton = new THREE.Skeleton([lower, this.upper])
    this.body.bind(this.skeleton)
    this.body.castShadow = this.body.receiveShadow = true
    this.bindings.push(art.bindRenderSource(this.body, { visibility: true, deformationPadding: 3 }))
    this.outlines.push(art.applyOutline(this.body, 'structural'))

    const canopyGeometry = ensureVertexColors(bakeOutlineNormals(taperedBox({
      width: 1.8, depth: 0.35, height: 3.4, topScale: 0.6, segments: 6, anchor: 'base',
    })), 0x829958)
    this.geometries.push(canopyGeometry)
    const canopyPositions = canopyGeometry.getAttribute('position')
    const wind = new Float32Array(canopyPositions.count * 2)
    for (let index = 0; index < canopyPositions.count; index++) {
      wind.set([THREE.MathUtils.smoothstep(canopyPositions.getY(index), 0.8, 3.4), 0.15], index * 2)
    }
    canopyGeometry.setAttribute(ART_WIND_ATTRIBUTE, new THREE.BufferAttribute(wind, 2))
    this.canopy = new THREE.InstancedMesh(canopyGeometry, art.acquireMaterial('diagnostic:wind-canopy', {
      color: 0xffffff, surface: 'foliage', vertexColors: true, attributes: { wind: true },
    }), 2)
    this.canopy.name = 'diagnostic-wind-source'
    this.canopy.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 0, -4))
    this.canopy.setMatrixAt(1, new THREE.Matrix4().makeTranslation(3.5, 0, -4))
    this.canopy.castShadow = this.canopy.receiveShadow = true
    this.root.add(this.canopy)
    const canopyBinding = art.bindRenderSource(this.canopy, {
      visibility: true, shadowParticipation: true, deformationPadding: 0.4,
    })
    this.bindings.push(canopyBinding)
    art.setShadowParticipation(canopyBinding, 1)
    art.setSourceVisibility(canopyBinding, 0.25, 1)
    this.outlines.push(art.applyOutline(this.canopy, 'structural', { instanced: true }))
  }

  update(timeSeconds: number): void {
    if (this.disposed) throw new Error('Foundation fixture is disposed')
    this.upper.rotation.z = Math.sin(timeSeconds * 2) * 0.65
    this.upper.rotation.x = Math.sin(timeSeconds * 1.3) * 0.22
  }

  snapshot() {
    const shell = this.outlines[0].shells[0]
    const position = this.body.getVertexPosition(0, new THREE.Vector3()).applyMatrix4(this.body.matrixWorld)
    const inkPosition = shell instanceof THREE.SkinnedMesh
      ? shell.getVertexPosition(0, new THREE.Vector3()).applyMatrix4(shell.matrixWorld) : null
    return {
      label: 'STAGED production-material skin/wind/ink/depth fixture; not a gameplay actor',
      bodyBoneCount: this.skeleton.bones.length,
      borrowedSkeleton: shell instanceof THREE.SkinnedMesh && shell.skeleton === this.skeleton,
      sourceInkPositionError: inkPosition ? inkPosition.distanceTo(position) : null,
      canopyInstances: this.canopy.count,
      fadedInstance: 1,
      cameraFadeAffectsShadow: false,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.root.removeFromParent()
    const errors: unknown[] = []
    const attempt = (action: () => void) => { try { action() } catch (error) { errors.push(error) } }
    for (const outline of this.outlines.splice(0)) attempt(() => this.art.releaseOutline(outline))
    for (const binding of this.bindings.splice(0)) attempt(() => this.art.releaseRenderSource(binding))
    attempt(() => this.canopy?.dispose())
    for (const geometry of this.geometries.splice(0)) attempt(() => geometry.dispose())
    attempt(() => this.skeleton?.dispose())
    this.root.clear()
    if (errors.length) throw new AggregateError(errors, 'Foundation fixture cleanup was incomplete')
  }
}
