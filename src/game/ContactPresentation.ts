import * as THREE from 'three'
import {
  characterPresenter, creaturePresenter, wagonPresenter,
  type CharacterContact, type CharacterContactPart, type CharacterPhysicalSurface,
} from './art/index.ts'
import { createWorldSurfaceSample, type WorldSurfaceField } from './world/WorldSurfaceField.ts'

export type ContactSurface = CharacterPhysicalSurface | 'wood' | 'stone' | 'soil' | 'water' | 'unknown'
export type ContactOrigin = 'posed' | 'projectile' | 'admitted-legacy' | 'admitted-event' | 'admitted-world'

export interface PresentationContact {
  readonly point: THREE.Vector3
  readonly normal: THREE.Vector3
  readonly direction: THREE.Vector3
  surface: ContactSurface
  sourceSurface: CharacterPhysicalSurface | null
  origin: ContactOrigin
}

export function createPresentationContact(): PresentationContact {
  return {
    point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), direction: new THREE.Vector3(0, 0, 1),
    surface: 'unknown', sourceSurface: null, origin: 'admitted-legacy',
  }
}

/** Only retained feedback events copy scratch; samplers and synchronous emissions reuse it. */
export function copyPresentationContact(contact: PresentationContact): PresentationContact {
  return { ...contact, point: contact.point.clone(), normal: contact.normal.clone(), direction: contact.direction.clone() }
}

export class ContactPresentation {
  readonly contact = createPresentationContact()
  private readonly target: CharacterContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: 'skin' }
  private readonly source: CharacterContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: 'skin' }
  private readonly probe: CharacterContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: 'skin' }
  private readonly world = createWorldSurfaceSample()
  private sampled = 0
  private rejected = 0
  private projectiles = 0
  private fallbacks = 0

  actor(root: THREE.Object3D, part: CharacterContactPart, admittedPoint: THREE.Vector3,
    incoming: THREE.Vector3, resolvedProjectile?: THREE.Vector3, sourceRoot?: THREE.Object3D,
    resolvedNormal?: THREE.Vector3): PresentationContact | null {
    const presenter = characterPresenter(root) ?? creaturePresenter(root)
    let found = presenter?.sampleContact(part, this.target) === true
    if (presenter && resolvedProjectile && part !== 'shield') {
      let nearest = found ? this.target.point.distanceToSquared(resolvedProjectile) : Infinity
      for (const bodyPart of ['head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const) {
        if (!presenter.sampleContact(bodyPart, this.probe)) continue
        const distance = this.probe.point.distanceToSquared(resolvedProjectile)
        if (distance >= nearest) continue
        nearest = distance
        this.target.point.copy(this.probe.point)
        this.target.normal.copy(this.probe.normal)
        this.target.surface = this.probe.surface
        found = true
      }
    }
    if (presenter && !found && !resolvedProjectile) {
      this.rejected++
      return null
    }
    const result = this.contact
    result.point.copy(resolvedProjectile ?? (found ? this.target.point : admittedPoint))
    result.normal.copy(resolvedProjectile && resolvedNormal ? resolvedNormal : found ? this.target.normal : incoming).normalize()
    if (!found && !resolvedNormal) result.normal.negate()
    if (result.normal.lengthSq() < 1e-8) result.normal.set(0, 1, 0)
    result.direction.copy(incoming).normalize()
    result.surface = found ? this.target.surface : 'unknown'
    result.sourceSurface = null
    result.origin = resolvedProjectile ? 'projectile' : found ? 'posed' : 'admitted-legacy'
    if (resolvedProjectile) this.projectiles++
    else if (found) this.sampled++
    else this.fallbacks++
    const attacker = sourceRoot && (characterPresenter(sourceRoot) ?? creaturePresenter(sourceRoot))
    if (attacker?.sampleContact('weaponTip', this.source)) {
      result.sourceSurface = this.source.surface
      if (!resolvedProjectile) result.direction.copy(result.point).sub(this.source.point).normalize()
    }
    if (result.direction.lengthSq() < 1e-8) result.direction.copy(result.normal).negate()
    return result
  }

  event(root: THREE.Object3D, admittedPoint: THREE.Vector3, incoming: THREE.Vector3,
    knownSurface: ContactSurface | undefined): PresentationContact {
    const result = this.contact
    result.point.copy(admittedPoint)
    result.direction.copy(incoming).normalize()
    result.normal.copy(result.direction).negate()
    if (result.normal.lengthSq() < 1e-8) result.normal.set(0, 1, 0)
    // WagonPresenter has no contact sampler on this base. Its point is explicitly NOT posed.
    result.surface = knownSurface ?? (wagonPresenter(root) ? 'wood' : 'unknown')
    result.sourceSurface = null
    result.origin = 'admitted-event'
    this.fallbacks++
    return result
  }

  terrain(point: THREE.Vector3, normal: THREE.Vector3, incoming: THREE.Vector3,
    surfaces: WorldSurfaceField | null): PresentationContact {
    const result = this.contact
    result.point.copy(point)
    result.normal.copy(normal).normalize()
    result.direction.copy(incoming).normalize()
    result.surface = 'unknown'
    if (surfaces) {
      surfaces.sampleInto(point.x, point.z, this.world)
      result.surface = this.world.material === 'water' ? 'water' : this.world.material === 'bridge' ? 'wood' :
        this.world.material === 'rock' || this.world.material === 'paving' ? 'stone' : 'soil'
    }
    result.sourceSurface = null
    result.origin = 'admitted-world'
    return result
  }

  snapshot() {
    return { sampled: this.sampled, rejected: this.rejected, projectiles: this.projectiles, admittedFallbacks: this.fallbacks }
  }
}

export interface ContactResponse {
  readonly kind: 'spark' | 'chip' | 'dust' | 'blood' | 'splash' | 'shard'
  readonly color: number
  readonly count: number
}

/** Physical response colors are not faction indicators. */
const RESPONSES: Readonly<Record<ContactSurface, ContactResponse>> = {
  metal: { kind: 'spark', color: 0xffd48b, count: 7 },
  dark: { kind: 'chip', color: 0x797478, count: 5 },
  skin: { kind: 'blood', color: 0x962e39, count: 6 },
  hair: { kind: 'blood', color: 0x962e39, count: 4 },
  cloth: { kind: 'dust', color: 0xaaa28f, count: 4 },
  leather: { kind: 'chip', color: 0x886c51, count: 4 },
  bone: { kind: 'chip', color: 0xc2b899, count: 5 },
  wood: { kind: 'chip', color: 0x977958, count: 5 },
  stone: { kind: 'chip', color: 0xa6a49b, count: 5 },
  soil: { kind: 'dust', color: 0x938474, count: 4 },
  water: { kind: 'splash', color: 0xa4bfca, count: 4 },
  unknown: { kind: 'shard', color: 0xa6a49b, count: 3 },
}

export function contactResponse(surface: ContactSurface, defense: boolean, sourceSurface: CharacterPhysicalSurface | null = null): ContactResponse {
  if (defense && (surface === 'skin' || surface === 'hair' || surface === 'unknown')) return RESPONSES.metal
  if (surface === 'metal' && sourceSurface !== null && sourceSurface !== 'metal') return RESPONSES.dark
  return RESPONSES[surface]
}
