export type SeedInput = string | number

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
const ZERO_SEED_FALLBACK = 0x6d2b79f5

export function hashString32(value: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

export function parseSeed(input: SeedInput): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new RangeError('Seed numbers must be finite')
    }
    return ensureNonzero(Math.trunc(input) >>> 0)
  }

  const trimmed = input.trim()
  if (/^[+-]?\d+$/.test(trimmed)) {
    return ensureNonzero(Number(BigInt.asUintN(32, BigInt(trimmed))))
  }
  return ensureNonzero(hashString32(input))
}

export function deriveSeed(rootSeed: SeedInput, semanticKey: string): number {
  let hash = FNV_OFFSET_BASIS ^ parseSeed(rootSeed)
  hash = Math.imul(hash ^ 0xff, FNV_PRIME)
  for (let index = 0; index < semanticKey.length; index += 1) {
    hash ^= semanticKey.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  hash ^= semanticKey.length
  return ensureNonzero(avalanche32(hash))
}

export function keyedUint32(rootSeed: SeedInput, semanticKey: string): number {
  return avalanche32(deriveSeed(rootSeed, semanticKey) ^ 0xa5a5a5a5)
}

export function keyedRandom(rootSeed: SeedInput, semanticKey: string): number {
  return keyedUint32(rootSeed, semanticKey) / 0x1_0000_0000
}

function avalanche32(input: number): number {
  let value = input >>> 0
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return (value ^ (value >>> 16)) >>> 0
}

function ensureNonzero(value: number): number {
  const uint32 = value >>> 0
  return uint32 === 0 ? ZERO_SEED_FALLBACK : uint32
}
