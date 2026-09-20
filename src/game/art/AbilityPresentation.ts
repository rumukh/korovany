export const BOW_RELEASE_SECONDS = 0.32
export const GUARD_ARM_PITCH = -1.82
export const GUARD_ARM_ROLL = 0.8
export const GUARD_ELBOW_PITCH = 1.21

/** The shot is instant; only its follow-through occupies the existing cooldown. */
export function bowReleaseProgress(cooldown: number, cooldownMax: number): number | null {
  if (!Number.isFinite(cooldown) || !Number.isFinite(cooldownMax) || cooldown <= 0) return null
  const elapsed = cooldownMax - cooldown
  if (elapsed < 0 || elapsed >= BOW_RELEASE_SECONDS) return null
  return elapsed / BOW_RELEASE_SECONDS
}
