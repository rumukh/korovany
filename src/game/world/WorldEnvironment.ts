import type { ZoneId } from '../types.ts'
import type { ChronicleEnvironment } from './Chronicle.ts'

/**
 * Simulation-side day/night and weather.
 *
 * These values describe what the world *is doing*, not what is being drawn. They are
 * derived from elapsed run time and the biome under the player, never from a display
 * setting, so turning off the day/night cycle or weather for performance cannot change
 * how the world simulates. `GameEngine` uses the same functions to drive rendering, so
 * there is exactly one source of truth for both.
 */

export type WeatherKind = 'clear' | 'overcast' | 'rain' | 'snow'

export const WEATHER_KINDS: readonly WeatherKind[] = [
  'clear',
  'overcast',
  'rain',
  'snow',
]

export const WEATHER_BY_ZONE: Record<ZoneId, WeatherKind> = {
  neutral: 'overcast',
  palace: 'clear',
  forest: 'rain',
  fort: 'snow',
}

/** Seconds of run time per full day/night cycle. */
export const DAY_LENGTH = 240
/** Where in the cycle a run starts, so nobody spawns at midnight. */
export const DAY_START_OFFSET = 0.18
/** Exponential response so a weather change is ~95% applied after 6 seconds. */
export const WEATHER_RESPONSE_RATE = -Math.log(0.05) / 6

/** Blend weights across weather kinds; always sums to 1. */
export type WeatherMix = Record<WeatherKind, number>

export function smoothstep(min: number, max: number, value: number): number {
  const amount = Math.min(1, Math.max(0, (value - min) / (max - min)))
  return amount * amount * (3 - 2 * amount)
}

export function computeDayPhase(elapsed: number): number {
  if (!Number.isFinite(elapsed)) return DAY_START_OFFSET
  const phase = (elapsed / DAY_LENGTH + DAY_START_OFFSET) % 1
  return phase < 0 ? phase + 1 : phase
}

export function computeSunAngle(elapsed: number): number {
  return computeDayPhase(elapsed) * Math.PI * 2
}

export function computeSunElevation(elapsed: number): number {
  return Math.sin(computeSunAngle(elapsed))
}

/** 0 in full daylight, 1 at deep night. Depends on elapsed run time alone. */
export function computeNightFactor(elapsed: number): number {
  return 1 - smoothstep(-0.08, 0.45, computeSunElevation(elapsed))
}

export function weatherKindForBiome(biome: ZoneId): WeatherKind {
  return WEATHER_BY_ZONE[biome]
}

export function createWeatherMix(kind: WeatherKind): WeatherMix {
  return {
    clear: kind === 'clear' ? 1 : 0,
    overcast: kind === 'overcast' ? 1 : 0,
    rain: kind === 'rain' ? 1 : 0,
    snow: kind === 'snow' ? 1 : 0,
  }
}

export function snapWeatherMix(mix: WeatherMix, kind: WeatherKind): void {
  for (const weatherKind of WEATHER_KINDS) {
    mix[weatherKind] = weatherKind === kind ? 1 : 0
  }
}

export function advanceWeatherMix(
  mix: WeatherMix,
  target: WeatherKind,
  deltaSeconds: number,
): void {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return
  const response = 1 - Math.exp(-WEATHER_RESPONSE_RATE * deltaSeconds)
  let total = 0
  for (const kind of WEATHER_KINDS) {
    mix[kind] += ((kind === target ? 1 : 0) - mix[kind]) * response
    total += mix[kind]
  }
  if (total <= 0) return
  for (const kind of WEATHER_KINDS) mix[kind] /= total
}

/** 0 in clear or overcast weather, 1 in full rain or snow. */
export function computeStormFactor(mix: WeatherMix): number {
  return Math.min(1, Math.max(0, mix.rain + mix.snow))
}

/**
 * The environment the chronicle ticks against. Takes only elapsed run time and the
 * current weather mix — there is deliberately no parameter through which a rendering
 * setting could reach the simulation.
 */
export function createChronicleEnvironment(
  elapsed: number,
  mix: WeatherMix,
): ChronicleEnvironment {
  return {
    nightFactor: computeNightFactor(elapsed),
    stormFactor: computeStormFactor(mix),
  }
}
