import * as THREE from 'three'
import { ART_WEATHER_ATTRIBUTE, type StylizedAtmosphere } from './ArtPresentation.ts'
import type { StylizedSurface } from './StylizedArtLibrary.ts'

export const ATMOSPHERE_REVISION = 'gfx-05-atmosphere-1'
export const WEATHER_ROUGHNESS_DROP_MAX = 0.3
export const WEATHER_VALUE_DROP_MAX = 0.22
export const WEATHER_ROUGHNESS_FLOOR = 0.35

/** Material defaults; packed geometry may narrow or replace these within the same bounds. */
export const SURFACE_WEATHER_RESPONSE: Readonly<Record<StylizedSurface, readonly [number, number]>> =
  Object.freeze({
    cloth: Object.freeze([0.08, 0.1] as const),
    skin: Object.freeze([0.04, 0.02] as const),
    metal: Object.freeze([0.06, 0.03] as const),
    dark: Object.freeze([0.08, 0.06] as const),
    leather: Object.freeze([0.14, 0.12] as const),
    bark: Object.freeze([0.1, 0.12] as const),
    foliage: Object.freeze([0.08, 0.04] as const),
    stone: Object.freeze([0.18, 0.12] as const),
    ground: Object.freeze([0.2, 0.16] as const),
    water: Object.freeze([0, 0] as const),
    glow: Object.freeze([0, 0] as const),
  })

/** Bake only on exclusive builder geometry, before cache insertion or mixed-surface merging. */
export function bakeWeatherResponse(
  geometry: THREE.BufferGeometry,
  response: readonly [number, number],
): THREE.BufferGeometry {
  if (!Number.isFinite(response[0]) || response[0] < 0 || response[0] > WEATHER_ROUGHNESS_DROP_MAX ||
      !Number.isFinite(response[1]) || response[1] < 0 || response[1] > WEATHER_VALUE_DROP_MAX) {
    throw new RangeError('Invalid baked weather response')
  }
  if (geometry.hasAttribute(ART_WEATHER_ATTRIBUTE)) return geometry
  const position = geometry.getAttribute('position')
  if (!position) throw new Error('Weather response requires geometry positions')
  const values = new Float32Array(position.count * 2)
  for (let index = 0; index < position.count; index++) values.set(response, index * 2)
  geometry.setAttribute(ART_WEATHER_ATTRIBUTE, new THREE.BufferAttribute(values, 2))
  return geometry
}

type MutableAtmosphere = { -readonly [Key in keyof StylizedAtmosphere]: StylizedAtmosphere[Key] }

export function createAtmospherePresentation(): MutableAtmosphere {
  return {
    color: new THREE.Color(), nearDepth: 32, midDepth: 77, farDepth: 132,
    midOpacity: 0.3, farOpacity: 1, baseHeight: 0, heightFalloff: 0.06, heightInfluence: 0.45,
  }
}

/** Technical preview defaults, not the final joined-character/world art grade. */
export function writeAtmospherePresentation(
  target: MutableAtmosphere,
  color: THREE.Color,
  fogNear: number,
  fogFar: number,
): void {
  if (!Number.isFinite(fogNear) || !Number.isFinite(fogFar) || fogNear < 0 || fogFar <= fogNear) {
    throw new RangeError('Atmosphere requires ordered finite fog distances')
  }
  target.color.copy(color)
  target.nearDepth = Math.max(22, fogNear * 2 / 3)
  target.farDepth = Math.max(target.nearDepth + 2, fogFar)
  target.midDepth = target.nearDepth + (target.farDepth - target.nearDepth) * 0.45
}

function unit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function ramp(near: number, far: number, depth: number): number {
  const value = unit((depth - near) / (far - near))
  return value * value * (3 - 2 * value)
}

/** CPU reference for the same analytical shader ramp; callers validate the profile once. */
export function sampleAtmosphereOpacity(profile: StylizedAtmosphere, depth: number, worldHeight: number): number {
  const near = ramp(profile.nearDepth, profile.midDepth, depth)
  const far = ramp(profile.midDepth, profile.farDepth, depth)
  const opacity = profile.midOpacity * near + (profile.farOpacity - profile.midOpacity) * far
  const height = Math.exp(-Math.min(80, Math.max(0, worldHeight - profile.baseHeight) * profile.heightFalloff))
  return opacity * (1 - profile.heightInfluence + profile.heightInfluence * height)
}

export function weatheredRoughness(dry: number, drop: number, wetness: number): number {
  return Math.max(Math.min(dry, WEATHER_ROUGHNESS_FLOOR), dry - Math.min(WEATHER_ROUGHNESS_DROP_MAX, Math.max(0, drop)) * unit(wetness))
}
