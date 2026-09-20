import * as THREE from 'three'
import { StylizedArtLibrary } from '../art/StylizedArtLibrary.ts'

export const CHARACTER_PORTRAIT_VERSION = 1
export const PORTRAIT_SUBJECTS = ['player', 'companion-0', 'companion-1', 'companion-2'] as const
export const PORTRAIT_VIEWS = ['front', 'three-quarter', 'profile', 'gameplay'] as const
export const PORTRAIT_POSES = ['current', 'idle', 'walk', 'windup', 'contact', 'guard', 'aim'] as const
export type PortraitPose = typeof PORTRAIT_POSES[number]

export interface PortraitCameraFrame {
  readonly position: readonly [number, number, number]
  readonly target: readonly [number, number, number]
  readonly fov: number
  readonly near: number
  readonly far: number
}

export interface GraphicsCharacterPortraitRequest {
  readonly version: typeof CHARACTER_PORTRAIT_VERSION
  readonly subject: typeof PORTRAIT_SUBJECTS[number]
  readonly view: typeof PORTRAIT_VIEWS[number]
  readonly pose: PortraitPose
  /** Optional captured frame for a same-camera comparison, never arbitrary pose code. */
  readonly frame?: PortraitCameraFrame
}

export interface PortraitSubject {
  readonly root: THREE.Group
  readonly id: string
  readonly role: string
  readonly faction: string
  readonly player: boolean
  readonly alive: boolean
  readonly weapon: string | null
}

const MAX_NODES = 512
const MAX_VERTICES = 200_000
const ANGLES = { front: 0, 'three-quarter': Math.PI / 4, profile: Math.PI / 2 } as const

function onlyKeys(value: object, keys: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`Unknown ${label} field`)
}

export function validateCharacterPortrait(value: GraphicsCharacterPortraitRequest): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid character portrait')
  onlyKeys(value, ['version', 'subject', 'view', 'pose', 'frame'], 'portrait')
  if (value.version !== CHARACTER_PORTRAIT_VERSION || !PORTRAIT_SUBJECTS.includes(value.subject) ||
      !PORTRAIT_VIEWS.includes(value.view) || !PORTRAIT_POSES.includes(value.pose)) {
    throw new Error('Unknown portrait version, subject, view or pose preset')
  }
  if (value.view === 'gameplay' && (value.pose !== 'current' || value.frame !== undefined)) {
    throw new Error('The gameplay comparison uses the unmodified current pose and production camera')
  }
  if (value.frame === undefined) return
  const frame = value.frame
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error('Invalid portrait camera frame')
  onlyKeys(frame, ['position', 'target', 'fov', 'near', 'far'], 'portrait camera')
  const finitePoint = (point: readonly number[]) => Array.isArray(point) && point.length === 3 &&
    point.every((number) => Number.isFinite(number) && Math.abs(number) <= 100_000)
  if (!finitePoint(frame.position) || !finitePoint(frame.target) ||
      ![frame.fov, frame.near, frame.far].every(Number.isFinite) ||
      frame.fov < 20 || frame.fov > 65 || frame.near < 0.005 || frame.near > 2 ||
      frame.far < 5 || frame.far > 1000 || frame.far <= frame.near ||
      Math.hypot(...frame.position.map((n, i) => n - frame.target[i])) < 0.2) {
    throw new Error('Portrait camera values are outside the finite capture envelope')
  }
}

interface TransformReceipt {
  readonly node: THREE.Object3D
  readonly position: THREE.Vector3
  readonly rotation: THREE.Euler
  readonly quaternion: THREE.Quaternion
  readonly scale: THREE.Vector3
  readonly matrix: THREE.Matrix4
  readonly matrixAutoUpdate: boolean
}

/** Posed, actually indexed vertices, not a cached rest-pose bounding sphere. */
export function measurePortraitSubject(root: THREE.Group): { body: THREE.Box3; head: THREE.Box3; vertices: number } {
  root.updateWorldMatrix(true, true)
  const headRoot = root.getObjectByName('head-pivot')
  if (!headRoot) throw new Error('Portrait subject has no production head joint')
  const belowHead = (node: THREE.Object3D): boolean => {
    for (let current: THREE.Object3D | null = node; current; current = current.parent) if (current === headRoot) return true
    return false
  }
  const body = new THREE.Box3(), head = new THREE.Box3(), point = new THREE.Vector3()
  let vertices = 0
  let nodes = 0
  root.traverseVisible((node) => {
    if (++nodes > MAX_NODES) throw new Error('Portrait subject exceeds its finite node budget')
    if (!(node instanceof THREE.Mesh) || StylizedArtLibrary.isOutlineShell(node) ||
        node.userData.noComicOutline || !StylizedArtLibrary.isOpaque(node.material)) return
    const position = node.geometry.getAttribute('position')
    const index = node.geometry.index
    const total = index?.count ?? position.count
    const start = Math.max(0, node.geometry.drawRange.start)
    const end = Math.min(total, start + node.geometry.drawRange.count)
    const skin = node.geometry.getAttribute('skinIndex'), weights = node.geometry.getAttribute('skinWeight')
    const headBones = node instanceof THREE.SkinnedMesh ? node.skeleton.bones.map(belowHead) : null
    const entireHead = belowHead(node)
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) throw new Error('Invalid portrait geometry draw range')
    for (let i = start; i < end; i++) {
      if (++vertices > MAX_VERTICES) throw new Error('Portrait vertex measurement exceeded its finite budget')
      const vertex = index ? index.getX(i) : i
      node.getVertexPosition(vertex, point).applyMatrix4(node.matrixWorld)
      if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error('Portrait contains a non-finite posed vertex')
      body.expandByPoint(point)
      let isHead = entireHead
      if (headBones && skin && weights) for (let slot = 0; slot < 4; slot++) {
        if (weights.getComponent(vertex, slot) > 0 && headBones[skin.getComponent(vertex, slot)]) isHead = true
      }
      if (isHead) head.expandByPoint(point)
    }
  })
  if (body.isEmpty() || head.isEmpty()) throw new Error('Portrait subject has no visible physical body or head')
  return { body, head, vertices }
}

function inside(bounds: THREE.Box3, camera: THREE.PerspectiveCamera): boolean {
  const point = new THREE.Vector3()
  for (let corner = 0; corner < 8; corner++) {
    point.set(corner & 1 ? bounds.max.x : bounds.min.x, corner & 2 ? bounds.max.y : bounds.min.y,
      corner & 4 ? bounds.max.z : bounds.min.z).project(camera)
    if (![point.x, point.y, point.z].every(Number.isFinite) ||
        Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || Math.abs(point.z) > 1) return false
  }
  return true
}

/**
 * A finite manual diagnostic presentation, using the engine's real subject and pose writer.
 * Restores authored local transforms between poses and at release; never edits visibility,
 * geometry, appearance masks, actor roots, action clocks or gameplay state.
 */
export class GraphicsCharacterPortrait {
  readonly request: Readonly<GraphicsCharacterPortraitRequest>
  readonly subject: PortraitSubject
  private readonly transforms: TransformReceipt[] = []
  private readonly pose: (subject: PortraitSubject, pose: PortraitPose) => void
  private cameraSaved: { camera: THREE.PerspectiveCamera; fov: number; near: number; far: number; zoom: number;
    position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null
  private last: ReturnType<GraphicsCharacterPortrait['metadata']> | null = null
  private disposed = false

  constructor(request: GraphicsCharacterPortraitRequest, subject: PortraitSubject,
    pose: (subject: PortraitSubject, pose: PortraitPose) => void) {
    validateCharacterPortrait(request)
    if (!subject.alive && request.pose !== 'current') throw new Error('A dead subject permits only its current pose')
    if (request.pose === 'guard' && (!subject.root.getObjectByName('shield') ||
        !subject.root.getObjectByName('shield')!.visible)) throw new Error('Guard portrait requires existing visible shield equipment')
    if (request.pose === 'aim' && subject.weapon !== 'bow') throw new Error('Aim portrait requires an already equipped production bow')
    this.request = Object.freeze({ ...request, ...(request.frame ? { frame: Object.freeze({
      ...request.frame,
      position: Object.freeze<[number, number, number]>([request.frame.position[0], request.frame.position[1], request.frame.position[2]]),
      target: Object.freeze<[number, number, number]>([request.frame.target[0], request.frame.target[1], request.frame.target[2]]),
    }) } : {}) })
    this.subject = subject
    this.pose = pose
    subject.root.traverse((node) => {
      if (node === subject.root || StylizedArtLibrary.isOutlineShell(node)) return
      if (this.transforms.length >= MAX_NODES) throw new Error('Portrait rig exceeds the finite transform budget')
      this.transforms.push({ node, position: node.position.clone(), rotation: node.rotation.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone(), matrix: node.matrix.clone(), matrixAutoUpdate: node.matrixAutoUpdate })
    })
    measurePortraitSubject(subject.root)
  }

  private restorePose(): void {
    for (const receipt of this.transforms) {
      const { node } = receipt
      node.position.copy(receipt.position)
      node.rotation.copy(receipt.rotation)
      node.quaternion.copy(receipt.quaternion)
      node.scale.copy(receipt.scale)
      node.matrix.copy(receipt.matrix)
      node.matrixAutoUpdate = receipt.matrixAutoUpdate
      node.matrixWorldNeedsUpdate = true
    }
  }

  present(camera: THREE.PerspectiveCamera): void {
    if (this.disposed) throw new Error('Portrait presentation is disposed')
    const position = camera.position.clone(), quaternion = camera.quaternion.clone()
    const projection = { fov: camera.fov, near: camera.near, far: camera.far, zoom: camera.zoom }
    try { this.renderPortrait(camera) }
    catch (error) {
      this.restorePose()
      camera.position.copy(position); camera.quaternion.copy(quaternion)
      Object.assign(camera, projection)
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld(true)
      throw error
    }
  }

  private renderPortrait(camera: THREE.PerspectiveCamera): void {
    this.restorePose()
    if (this.request.pose !== 'current') this.pose(this.subject, this.request.pose)
    const bounds = measurePortraitSubject(this.subject.root)
    if (this.request.view === 'gameplay') {
      camera.updateMatrixWorld(true)
      this.last = this.metadata(camera, bounds, null, inside(bounds.head, camera))
      return
    }
    const focus = bounds.head.clone()
    focus.min.y -= Math.min(0.6, (bounds.body.max.y - bounds.body.min.y) * 0.17)
    focus.expandByScalar(0.035)
    const center = focus.getCenter(new THREE.Vector3())
    const radius = focus.getSize(new THREE.Vector3()).length() * 0.5
    if (!(radius > 0) || radius > 8 || !Number.isFinite(camera.aspect) || camera.aspect <= 0) {
      throw new Error('Portrait bounds or camera aspect are outside the capture envelope')
    }
    if (!this.cameraSaved) this.cameraSaved = { camera, fov: camera.fov, near: camera.near, far: camera.far, zoom: camera.zoom,
      position: camera.position.clone(), quaternion: camera.quaternion.clone() }
    const frame = this.request.frame
    if (frame && (center.distanceTo(new THREE.Vector3(...frame.target)) > 8 ||
        center.distanceTo(new THREE.Vector3(...frame.position)) > 32)) throw new Error('Reference camera is not local to this subject')
    if (frame) {
      camera.position.fromArray(frame.position)
      camera.fov = frame.fov; camera.near = frame.near; camera.far = frame.far
      camera.zoom = 1
      camera.lookAt(new THREE.Vector3(...frame.target))
    } else {
      const forward = new THREE.Vector3(0, 0, 1).transformDirection(this.subject.root.matrixWorld)
      const yaw = Math.atan2(forward.x, forward.z) + ANGLES[this.request.view]
      camera.fov = 38
      camera.zoom = 1
      const halfFov = THREE.MathUtils.degToRad(camera.fov) * 0.5
      const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect))
      const distance = radius / Math.sin(limitingFov) * 1.14
      if (distance > 32) throw new Error('Portrait cannot fit within its local camera envelope')
      camera.position.set(Math.sin(yaw), 0.035, Math.cos(yaw)).normalize().multiplyScalar(distance).add(center)
      camera.near = Math.max(0.005, Math.min(0.1, (distance - radius) * 0.25))
      camera.far = Math.max(this.cameraSaved.far, distance + radius + 5)
      camera.lookAt(center)
    }
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    const target: [number, number, number] = frame ? [frame.target[0], frame.target[1], frame.target[2]] : center.toArray()
    this.last = this.metadata(camera, bounds, target, inside(focus, camera))
    if (!frame && !this.last.focusInsideClip) throw new Error('Computed portrait frame clipped its actual posed bounds')
  }

  private metadata(camera: THREE.PerspectiveCamera, bounds: ReturnType<typeof measurePortraitSubject>,
    target: [number, number, number] | null, focusInsideClip: boolean) {
    return {
      version: CHARACTER_PORTRAIT_VERSION, staged: true,
      cameraMode: this.request.view === 'gameplay' ? 'production-gameplay' : 'diagnostic-portrait-override',
      collisionEvidence: false, simulationAdvanced: false, request: this.request,
      subject: { id: this.subject.id, role: this.subject.role, faction: this.subject.faction,
        player: this.subject.player, alive: this.subject.alive, weapon: this.subject.weapon,
        rootPosition: this.subject.root.position.toArray(), rootQuaternion: this.subject.root.quaternion.toArray() },
      bounds: { body: { min: bounds.body.min.toArray(), max: bounds.body.max.toArray() },
        head: { min: bounds.head.min.toArray(), max: bounds.head.max.toArray() }, measuredVertices: bounds.vertices },
      camera: { position: camera.position.toArray(), target, fov: camera.fov, near: camera.near, far: camera.far,
        zoom: camera.zoom, aspect: camera.aspect, quaternion: camera.quaternion.toArray(),
        projectionMatrix: [...camera.projectionMatrix.elements] },
      focusInsideClip, referenceFrameApplied: this.request.frame !== undefined,
    }
  }

  snapshot() { return this.last }

  restoreCameraProjection(): void {
    if (!this.cameraSaved) return
    const { camera, fov, near, far, zoom } = this.cameraSaved
    camera.fov = fov; camera.near = near; camera.far = far; camera.zoom = zoom
    camera.updateProjectionMatrix()
  }

  dispose(): void {
    if (this.disposed) return
    this.restorePose()
    this.restoreCameraProjection()
    if (this.cameraSaved) {
      this.cameraSaved.camera.position.copy(this.cameraSaved.position)
      this.cameraSaved.camera.quaternion.copy(this.cameraSaved.quaternion)
      this.cameraSaved.camera.updateMatrixWorld(true)
    }
    this.subject.root.updateWorldMatrix(true, true)
    this.disposed = true
  }
}
