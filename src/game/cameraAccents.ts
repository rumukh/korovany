export const CAMERA_BASE_FOV = 56
export const CAMERA_FOV_MIN = 52
export const CAMERA_FOV_MAX = 65
export const SPRINT_FOV_BONUS = 4.5
export const SPRINT_BLEND_DAMPING = 6.5
export const CAMERA_FOV_DAMPING = 13
export const CAMERA_FOLLOW_DAMPING = 7.7
export const CAMERA_ACCENT_OFFSET_MIN = -3.5
export const CAMERA_ACCENT_OFFSET_MAX = 7
export const CAMERA_ACCENT_MAX_ENTRIES = 4
export const LANDING_MIN_AIR_TIME = 0.22
export const KILL_ACCENT_RANGE = 14

export type CameraAccentKind = 'cleave' | 'jump' | 'land' | 'block' | 'kill'

export interface CameraAccent {
  kind: CameraAccentKind
  age: number
  duration: number
  magnitude: number
}

export interface AirborneUpdate {
  airborneTime: number
  landed: boolean
  landingAirTime: number
}

export interface JumpAccentLatchUpdate {
  armed: boolean
  triggered: boolean
}

export function dampingAlpha(rate: number, delta: number): number {
  return 1 - Math.exp(-Math.max(0, rate) * Math.max(0, delta))
}

export function dampValue(current: number, target: number, rate: number, delta: number): number {
  return current + (target - current) * dampingAlpha(rate, delta)
}

export function queueCameraAccent(
  accents: CameraAccent[],
  kind: CameraAccentKind,
  magnitude: number,
  duration: number,
  maxEntries = CAMERA_ACCENT_MAX_ENTRIES,
): boolean {
  const strength = Math.abs(magnitude)
  if (strength === 0 || duration <= 0 || maxEntries <= 0) return false

  const existing = accents.find((accent) => accent.kind === kind)
  if (existing) {
    if (strength <= Math.abs(existing.magnitude)) return false
    existing.age = 0
    existing.duration = duration
    existing.magnitude = magnitude
    return true
  }

  if (accents.length < maxEntries) {
    accents.push({ kind, age: 0, duration, magnitude })
    return true
  }

  let replacementIndex = 0
  for (let index = 1; index < accents.length; index += 1) {
    const candidate = accents[index]
    const replacement = accents[replacementIndex]
    const candidateStrength = Math.abs(candidate.magnitude)
    const replacementStrength = Math.abs(replacement.magnitude)
    if (
      candidateStrength < replacementStrength ||
      (candidateStrength === replacementStrength && candidate.age > replacement.age)
    ) {
      replacementIndex = index
    }
  }

  if (strength <= Math.abs(accents[replacementIndex].magnitude)) return false
  accents[replacementIndex] = { kind, age: 0, duration, magnitude }
  return true
}

export function sampleCameraAccent(accent: CameraAccent): number {
  if (accent.duration <= 0) return 0
  const progress = Math.min(1, Math.max(0, accent.age / accent.duration))
  return Math.sin(Math.PI * progress) * accent.magnitude
}

export function advanceCameraAccents(accents: CameraAccent[], delta: number): number {
  const elapsed = Math.max(0, delta)
  let offset = 0
  for (let index = accents.length - 1; index >= 0; index -= 1) {
    const accent = accents[index]
    accent.age += elapsed
    if (accent.age >= accent.duration) {
      accents.splice(index, 1)
      continue
    }
    offset += sampleCameraAccent(accent)
  }
  return Math.min(CAMERA_ACCENT_OFFSET_MAX, Math.max(CAMERA_ACCENT_OFFSET_MIN, offset))
}

export function composeCameraFov(sprintBlend: number, accentOffset: number): number {
  const target =
    CAMERA_BASE_FOV +
    SPRINT_FOV_BONUS * Math.min(1, Math.max(0, sprintBlend)) +
    Math.min(CAMERA_ACCENT_OFFSET_MAX, Math.max(CAMERA_ACCENT_OFFSET_MIN, accentOffset))
  return Math.min(CAMERA_FOV_MAX, Math.max(CAMERA_FOV_MIN, target))
}

export function advanceAirborneState(
  airborneTime: number,
  wasOnGround: boolean,
  isOnGround: boolean,
  delta: number,
): AirborneUpdate {
  const elapsed = Math.max(0, delta)
  if (!wasOnGround && isOnGround) {
    const landingAirTime = Math.max(0, airborneTime) + elapsed
    return {
      airborneTime: 0,
      landed: landingAirTime >= LANDING_MIN_AIR_TIME,
      landingAirTime,
    }
  }
  if (!isOnGround) {
    return {
      airborneTime: (wasOnGround ? 0 : Math.max(0, airborneTime)) + elapsed,
      landed: false,
      landingAirTime: 0,
    }
  }
  return { airborneTime: 0, landed: false, landingAirTime: 0 }
}

export function advanceJumpAccentLatch(
  armed: boolean,
  jumpHeld: boolean,
  tookOff: boolean,
): JumpAccentLatchUpdate {
  if (!jumpHeld) return { armed: true, triggered: false }
  if (tookOff && armed) return { armed: false, triggered: true }
  return { armed, triggered: false }
}
