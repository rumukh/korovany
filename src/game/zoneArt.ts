import type { ZoneId } from './types'

export interface ZoneVisualWeights {
  neutral: number
  palace: number
  forest: number
  fort: number
}

function smoothstep(min: number, max: number, value: number): number {
  const amount = Math.min(1, Math.max(0, (value - min) / (max - min)))
  return amount * amount * (3 - 2 * amount)
}

export function writeZoneVisualWeights(
  x: number,
  z: number,
  out: ZoneVisualWeights,
  blendWidth = 8,
): void {
  const width = Math.max(0.001, blendWidth)
  const right = smoothstep(-width, width, x)
  const lower = smoothstep(-width, width, z)
  const left = 1 - right
  const upper = 1 - lower

  out.neutral = left * upper
  out.palace = right * upper
  out.forest = left * lower
  out.fort = right * lower
}

export const ZONE_ART_IDS: readonly ZoneId[] = ['neutral', 'palace', 'forest', 'fort']
