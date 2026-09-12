import { createArtStream } from '../art/ArtRandom.ts'
import { createWeatherMix, WEATHER_KINDS, type WeatherKind, type WeatherMix } from '../world/WorldEnvironment.ts'

export const GRAPHICS_DIAGNOSTICS_VERSION = 1
export const GRAPHICS_VISUAL_REVISION = 'gfx-01-baseline-1'

export interface GraphicsClockOptions {
  seed: number
  timeSeconds: number
  weather: WeatherKind | null
}

export function graphicsClockOptions(search: string): GraphicsClockOptions | null {
  const params = new URLSearchParams(search)
  if (params.get('graphicsDiagnostics') !== '1') return null
  const seed = Number(params.get('visualSeed') ?? '20260906')
  const timeSeconds = Number(params.get('visualTime') ?? '0')
  const weather = params.get('visualWeather')
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('Graphics diagnostics: visualSeed must be a uint32')
  }
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    throw new Error('Graphics diagnostics: visualTime must be finite and non-negative')
  }
  if (weather !== null && !WEATHER_KINDS.some((kind) => kind === weather)) {
    throw new Error(`Graphics diagnostics: unknown visualWeather ${weather}`)
  }
  return { seed, timeSeconds, weather: WEATHER_KINDS.find((kind) => kind === weather) ?? null }
}

/**
 * A presentation clock, not a replacement for the run clock. The environment and
 * chronicle continue to read their original elapsed time and weather mix.
 */
export class GraphicsClock {
  readonly options: Readonly<GraphicsClockOptions>
  readonly weather: Readonly<WeatherMix> | null
  private readonly weatherRandom
  private seconds = 0

  constructor(options: GraphicsClockOptions) {
    if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff
      || !Number.isFinite(options.timeSeconds) || options.timeSeconds < 0
      || (options.weather !== null && !WEATHER_KINDS.includes(options.weather))) {
      throw new Error('Invalid graphics presentation clock options')
    }
    this.options = Object.freeze({ ...options })
    this.weather = options.weather === null ? null : Object.freeze(createWeatherMix(options.weather))
    this.weatherRandom = createArtStream(options.seed, 'graphics-fixture:weather')
  }

  get timeSeconds(): number {
    return this.options.timeSeconds + this.seconds
  }

  advance(delta: number): void {
    if (!Number.isFinite(delta) || delta < 0) throw new Error('Invalid graphics clock delta')
    this.seconds += delta
  }

  createRandom(label: 'rain' | 'snow'): () => number {
    const stream = createArtStream(this.options.seed, `graphics-fixture:${label}`)
    return () => stream.next()
  }

  randomWeather(): number {
    return this.weatherRandom.next()
  }
}
