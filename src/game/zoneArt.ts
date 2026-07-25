import type { ZoneId } from './types'

export interface ZoneVisualWeights {
  neutral: number
  palace: number
  forest: number
  fort: number
}

export const ZONE_ART_IDS: readonly ZoneId[] = ['neutral', 'palace', 'forest', 'fort']
