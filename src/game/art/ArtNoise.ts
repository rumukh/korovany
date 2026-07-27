/**
 * Deterministic, allocation-free noise for procedural art.
 *
 * Every function here is pure and integer-hash based, so a displaced rock is
 * byte-identical for a given seed on every machine. Nothing in `src/game/art/`
 * may call `Math.random()`, read the clock, or accumulate state across frames.
 */

const HASH_X = 0x27d4eb2d
const HASH_Y = 0x165667b1
const HASH_Z = 0x9e3779b1
const HASH_SEED = 0x85ebca6b
const UINT32_SCALE = 1 / 0x1_0000_0000

function avalanche(value: number): number {
  let hash = value >>> 0
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d)
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b)
  return (hash ^ (hash >>> 16)) >>> 0
}

/** Hashes an integer lattice point to a uint32. */
export function hashInt3(x: number, y: number, z: number, seed: number): number {
  let hash = Math.imul(x | 0, HASH_X)
  hash = (hash ^ Math.imul(y | 0, HASH_Y)) >>> 0
  hash = (hash ^ Math.imul(z | 0, HASH_Z)) >>> 0
  hash = (hash ^ Math.imul(seed | 0, HASH_SEED)) >>> 0
  return avalanche(hash)
}

/** Hashes an integer lattice point to `[0, 1)`. */
export function hashUnit3(x: number, y: number, z: number, seed: number): number {
  return hashInt3(x, y, z, seed) * UINT32_SCALE
}

/** Hashes a single index to `[0, 1)`. Handy for per-instance jitter. */
export function hashUnit(index: number, seed: number): number {
  return hashInt3(index, index >> 8, index >> 16, seed) * UINT32_SCALE
}

function smoothstepUnit(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * Trilinear value noise in `[-1, 1]`.
 *
 * Value noise rather than gradient noise on purpose: it is cheaper, it has the
 * blocky low-frequency character that suits faceted low-poly shapes, and it needs
 * no permutation table to stay deterministic.
 */
export function valueNoise3(
  x: number,
  y: number,
  z: number,
  seed: number,
): number {
  const floorX = Math.floor(x)
  const floorY = Math.floor(y)
  const floorZ = Math.floor(z)
  const fractionX = smoothstepUnit(x - floorX)
  const fractionY = smoothstepUnit(y - floorY)
  const fractionZ = smoothstepUnit(z - floorZ)

  const c000 = hashUnit3(floorX, floorY, floorZ, seed)
  const c100 = hashUnit3(floorX + 1, floorY, floorZ, seed)
  const c010 = hashUnit3(floorX, floorY + 1, floorZ, seed)
  const c110 = hashUnit3(floorX + 1, floorY + 1, floorZ, seed)
  const c001 = hashUnit3(floorX, floorY, floorZ + 1, seed)
  const c101 = hashUnit3(floorX + 1, floorY, floorZ + 1, seed)
  const c011 = hashUnit3(floorX, floorY + 1, floorZ + 1, seed)
  const c111 = hashUnit3(floorX + 1, floorY + 1, floorZ + 1, seed)

  const x00 = c000 + (c100 - c000) * fractionX
  const x10 = c010 + (c110 - c010) * fractionX
  const x01 = c001 + (c101 - c001) * fractionX
  const x11 = c011 + (c111 - c011) * fractionX
  const y0 = x00 + (x10 - x00) * fractionY
  const y1 = x01 + (x11 - x01) * fractionY
  return (y0 + (y1 - y0) * fractionZ) * 2 - 1
}

/** Fractal Brownian motion over {@link valueNoise3}, normalized to `[-1, 1]`. */
export function fbm3(
  x: number,
  y: number,
  z: number,
  seed: number,
  octaves = 3,
  lacunarity = 2.03,
  gain = 0.5,
): number {
  const steps = Math.max(1, Math.min(6, Math.floor(octaves)))
  let amplitude = 1
  let frequency = 1
  let total = 0
  let normalization = 0
  for (let octave = 0; octave < steps; octave += 1) {
    total +=
      valueNoise3(x * frequency, y * frequency, z * frequency, seed + octave * 977) *
      amplitude
    normalization += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }
  return total / normalization
}

/**
 * Ridged noise in `[0, 1]`. Sharp creases where the noise crosses zero, which is
 * what makes a displaced boulder read as cracked stone rather than a lumpy potato.
 */
export function ridgeNoise3(
  x: number,
  y: number,
  z: number,
  seed: number,
  octaves = 3,
): number {
  const steps = Math.max(1, Math.min(6, Math.floor(octaves)))
  let amplitude = 1
  let frequency = 1
  let total = 0
  let normalization = 0
  for (let octave = 0; octave < steps; octave += 1) {
    const sample =
      1 -
      Math.abs(
        valueNoise3(x * frequency, y * frequency, z * frequency, seed + octave * 613),
      )
    total += sample * sample * amplitude
    normalization += amplitude
    amplitude *= 0.55
    frequency *= 2.11
  }
  return total / normalization
}
