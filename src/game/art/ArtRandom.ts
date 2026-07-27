import { RandomStream } from '../random/RandomStream.ts'
import { deriveSeed, type SeedInput } from '../random/seed.ts'

/**
 * Seeded variation for anything visual.
 *
 * The campaign is reproducible: `WorldValidator` and `tests/worldGenerator.test.ts`
 * both depend on gameplay streams advancing in a fixed order. Art code therefore
 * never draws from a gameplay stream and never calls `Math.random()`. It opens its
 * own stream through {@link createArtStream}, whose labels are namespaced under
 * `art:` so they can never collide with `region-dressing:`, `combat`, `loot` and
 * friends.
 */
const ART_NAMESPACE = 'art:'

/** Opens a dedicated visual stream derived from the world seed. */
export function createArtStream(seed: SeedInput, label: string): RandomStream {
  return new RandomStream(deriveSeed(seed, `${ART_NAMESPACE}${label}`))
}

/** Derives a plain uint32 for noise functions that take a numeric seed. */
export function artNoiseSeed(seed: SeedInput, label: string): number {
  return deriveSeed(seed, `${ART_NAMESPACE}noise:${label}`)
}

export interface ArtVariation {
  /** `[0, 1)` */
  unit(): number
  /** `[-spread, +spread)` */
  signed(spread: number): number
  /** `[base - spread, base + spread)` */
  around(base: number, spread: number): number
  /** `[minimum, maximum)` */
  range(minimum: number, maximum: number): number
  /** `[minInclusive, maxExclusive)` */
  integer(minInclusive: number, maxExclusive: number): number
  pick<T>(values: readonly T[]): T
  chance(probability: number): boolean
  /** `[0, 2π)` */
  angle(): number
  /** The underlying stream, for callers that need snapshots or cloning. */
  readonly stream: RandomStream
}

/**
 * Wraps a visual stream in the handful of shapes art code actually asks for.
 *
 * Wrapping rather than exposing `RandomStream` directly keeps the call sites in
 * geometry builders readable — `variation.around(1, 0.2)` says what it means, and
 * `0.8 + stream.next() * 0.4` does not.
 */
export function artVariation(seed: SeedInput, label: string): ArtVariation {
  return wrapArtVariation(createArtStream(seed, label))
}

/** Wraps an existing stream. Use when a caller already owns the stream. */
export function wrapArtVariation(stream: RandomStream): ArtVariation {
  return {
    stream,
    unit: () => stream.next(),
    signed: (spread: number) => (stream.next() * 2 - 1) * spread,
    around: (base: number, spread: number) => base + (stream.next() * 2 - 1) * spread,
    range: (minimum: number, maximum: number) =>
      maximum > minimum ? stream.range(minimum, maximum) : minimum,
    integer: (minInclusive: number, maxExclusive: number) =>
      stream.integer(minInclusive, maxExclusive),
    pick: <T>(values: readonly T[]) => stream.pick(values),
    chance: (probability: number) => stream.chance(probability),
    angle: () => stream.next() * Math.PI * 2,
  }
}
