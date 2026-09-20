import type { RuntimeRngStateMap } from '../run/runTypes.ts'
import { RandomStream } from './RandomStream.ts'
import { deriveSeed } from './seed.ts'

export type GeneratedRngStreams = Record<
  'combat' | 'director' | 'event' | 'loot' | 'chronicle' | 'rumour' | 'injury',
  RandomStream
>

/** Construction/restore shared by every visual mode; missing old-save keys retain their derived seed. */
export function createGeneratedRngStreams(seed: number, restored?: Readonly<RuntimeRngStateMap>): GeneratedRngStreams {
  const streams: GeneratedRngStreams = {
    combat: new RandomStream(deriveSeed(seed, 'gameplay:combat')),
    director: new RandomStream(deriveSeed(seed, 'gameplay:director')),
    event: new RandomStream(deriveSeed(seed, 'gameplay:event')),
    loot: new RandomStream(deriveSeed(seed, 'gameplay:loot')),
    chronicle: new RandomStream(deriveSeed(seed, 'gameplay:chronicle')),
    // Rumour offers must not move the next chronicle front, event or loot roll.
    rumour: new RandomStream(deriveSeed(seed, 'gameplay:rumour')),
    // NPC limb decisions must not share cosmetic variation or Three.js UUID randomness.
    injury: new RandomStream(deriveSeed(seed, 'gameplay:injury')),
  }
  if (restored) {
    for (const key of Object.keys(streams) as Array<keyof GeneratedRngStreams>) {
      const state = restored[key]
      if (Number.isInteger(state) && state >= 0 && state <= 0xffffffff) streams[key].setState(state)
    }
  }
  return streams
}
