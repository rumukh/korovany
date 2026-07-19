import { parseSeed, type SeedInput } from './seed.ts'

const UINT32_RANGE = 0x1_0000_0000
const STATE_INCREMENT = 0x6d2b79f5

export interface RandomStreamSnapshot {
  state: number
}

export class RandomStream {
  private currentState: number

  constructor(seed: SeedInput) {
    this.currentState = parseSeed(seed)
  }

  static fromState(state: number): RandomStream {
    const stream = new RandomStream(1)
    stream.setState(state)
    return stream
  }

  get state(): number {
    return this.currentState
  }

  nextUint32(): number {
    this.currentState = (this.currentState + STATE_INCREMENT) >>> 0
    let value = this.currentState
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return (value ^ (value >>> 14)) >>> 0
  }

  next(): number {
    return this.nextUint32() / UINT32_RANGE
  }

  integer(minInclusive: number, maxExclusive: number): number {
    if (
      !Number.isSafeInteger(minInclusive) ||
      !Number.isSafeInteger(maxExclusive) ||
      maxExclusive <= minInclusive
    ) {
      throw new RangeError('Integer bounds must be safe integers with max greater than min')
    }

    const span = maxExclusive - minInclusive
    if (span > UINT32_RANGE) {
      throw new RangeError('Integer range cannot exceed 2^32 values')
    }

    const limit = Math.floor(UINT32_RANGE / span) * span
    let value = this.nextUint32()
    while (value >= limit) value = this.nextUint32()
    return minInclusive + (value % span)
  }

  range(minInclusive: number, maxExclusive: number): number {
    if (
      !Number.isFinite(minInclusive) ||
      !Number.isFinite(maxExclusive) ||
      maxExclusive <= minInclusive
    ) {
      throw new RangeError('Range bounds must be finite with max greater than min')
    }
    return minInclusive + (maxExclusive - minInclusive) * this.next()
  }

  chance(probability: number): boolean {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError('Chance probability must be between 0 and 1')
    }
    if (probability === 0) return false
    if (probability === 1) return true
    return this.next() < probability
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new RangeError('Cannot pick from an empty collection')
    return values[this.integer(0, values.length)]
  }

  shuffle<T>(values: readonly T[]): T[] {
    const shuffled = [...values]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const otherIndex = this.integer(0, index + 1)
      const current = shuffled[index]
      shuffled[index] = shuffled[otherIndex]
      shuffled[otherIndex] = current
    }
    return shuffled
  }

  getState(): number {
    return this.currentState
  }

  setState(state: number): void {
    if (!Number.isInteger(state) || state < 0 || state >= UINT32_RANGE) {
      throw new RangeError('Random stream state must be a uint32')
    }
    this.currentState = state
  }

  snapshot(): RandomStreamSnapshot {
    return { state: this.currentState }
  }

  restore(snapshot: RandomStreamSnapshot): void {
    this.setState(snapshot.state)
  }

  clone(): RandomStream {
    return RandomStream.fromState(this.currentState)
  }
}
