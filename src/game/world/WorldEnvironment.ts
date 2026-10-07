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

/**
 * Seconds of run time per full day/night cycle.
 *
 * W2-1 — nine minutes, about one whole run: a run meets one night, in its middle, rather
 * than spending most of itself in the dark. Was 240, which put a three-minute run more than
 * half at night.
 */
export const DAY_LENGTH = 540
/**
 * Where in the cycle a run starts, so nobody spawns at midnight.
 *
 * W2-1 — chosen so the first dusk (the night factor reaching the campfire threshold, 0.45)
 * falls about four and a half minutes in, after the opening has been read in daylight.
 */
export const DAY_START_OFFSET = 0.11
/**
 * W2-1 — how hard the day clock leans towards noon, applied twice.
 *
 * Each pass is `u − (k/2π)·sin(2π(u − ¼))`: it keeps noon and midnight where they are,
 * slows the sun around noon and hurries it through midnight. Twice at 0.52 the sun moves at
 * (1−k)² ≈ 0.23 of its average speed at noon and (1+k)² ≈ 2.3 at midnight, and the night
 * (night factor at or above 0.45) is 28% of the cycle instead of 56%. The sun's path, the
 * light keyframes and the night factor are all still read off one phase, so the rendered
 * night and the simulated one stay the same night; only its length changed.
 */
export const DAY_PHASE_WARP = 0.52
/** Exponential response so a weather change is ~95% applied after 6 seconds. */
export const WEATHER_RESPONSE_RATE = -Math.log(0.05) / 6

/** Blend weights across weather kinds; always sums to 1. */
export type WeatherMix = Record<WeatherKind, number>

export function smoothstep(min: number, max: number, value: number): number {
  const amount = Math.min(1, Math.max(0, (value - min) / (max - min)))
  return amount * amount * (3 - 2 * amount)
}

function leanTowardsNoon(clock: number): number {
  return clock - (DAY_PHASE_WARP / (Math.PI * 2)) * Math.sin(Math.PI * 2 * (clock - 0.25))
}

function wrapUnit(value: number): number {
  const wrapped = value % 1
  return wrapped < 0 ? wrapped + 1 : wrapped
}

/** 0 dawn, 0.25 noon, 0.5 dusk, 0.75 midnight. Depends on elapsed run time alone. */
export function computeDayPhase(elapsed: number): number {
  const clock = Number.isFinite(elapsed)
    ? wrapUnit(elapsed / DAY_LENGTH + DAY_START_OFFSET)
    : DAY_START_OFFSET
  return wrapUnit(leanTowardsNoon(leanTowardsNoon(clock)))
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

/**
 * W2-1 — true on the one step of run time that carries the world from day into night.
 *
 * An edge, not a level, and that is the whole of "once per night": the step that crosses
 * `threshold` is the only one that answers true, so a continue in the middle of a night says
 * nothing — its first step starts dark — while a save made just before dusk still hears it.
 * Nothing about it is saved, and nothing about it reads a display setting.
 */
export function nightFellBetween(
  previousElapsed: number,
  elapsed: number,
  threshold: number,
): boolean {
  return (
    computeNightFactor(previousElapsed) < threshold &&
    computeNightFactor(elapsed) >= threshold
  )
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
