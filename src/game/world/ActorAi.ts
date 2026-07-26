/**
 * The part of actor AI that is a decision rather than a movement.
 *
 * `GameEngine.updateActors` mixes three things: deciding *who to fight*, deciding *how to
 * get there* (navmesh, steering, collision), and animating the result. Only the first is
 * a pure function of world state, and it is the one every interesting question about
 * behaviour turns on — who beasts engage, when a pack breaks, whether the player is worth
 * chasing. That part lives here, in the same shape as `Chronicle`, `Materialization`,
 * `Fauna` and `WorldEnvironment`: no THREE, no scene, no actor objects, no RNG.
 *
 * The functions are generic over a minimal `AiActor` so `GameEngine` can pass its own
 * `Actor` array straight through with no per-frame allocation, while a headless harness
 * passes plain objects. That is deliberate: it means the harness exercises the code the
 * game actually runs rather than a re-implementation of it, which is the only way its
 * measurements mean anything.
 *
 * Movement, collision and navigation are *not* here. They need the navmesh and the
 * collision world, so anything measured through this module measures decisions, not
 * outcomes of the full simulation.
 */

import { areAllegiancesHostile, type Allegiance } from '../types.ts'

export interface AiPoint {
  x: number
  y: number
  z: number
}

/** The minimum an actor must expose to be reasoned about. `Actor` satisfies it. */
export interface AiActor {
  id: string
  allegiance: Allegiance
  alive: boolean
  /** A protected target, e.g. the captive in a rescue event. */
  ignoredTargetId: string | null
  /** Currently locked target, if any. */
  targetId: string | null
  /** Layer 3 — which pack this beast set out with. */
  packId: string | null
  packSize: number
}

export type AiPositionOf<T> = (actor: T) => AiPoint

/**
 * How much further than `range` a locked target may drift before it is dropped. Without
 * the hysteresis a target sitting exactly on the range boundary is re-acquired every
 * frame, which makes actors visibly dither.
 */
export const TARGET_LOCK_SLACK = 1.35

export function aiDistance(left: AiPoint, right: AiPoint): number {
  const dx = left.x - right.x
  const dy = left.y - right.y
  const dz = left.z - right.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * Nearest hostile within `range`, keeping a locked target while it stays alive, hostile
 * and roughly in range. Hostility is the §5.3 matrix, never a faction comparison, which
 * is what lets a beast pick a fight with all three sides and a civilian with none.
 *
 * Pure: the caller assigns the result to `targetId`.
 */
export function selectCombatTarget<T extends AiActor>(
  actor: T,
  actors: readonly T[],
  range: number,
  positionOf: AiPositionOf<T>,
): T | null {
  const origin = positionOf(actor)
  if (actor.targetId) {
    const locked = actors.find((other) => other.id === actor.targetId)
    if (
      locked?.alive &&
      locked.id !== actor.ignoredTargetId &&
      areAllegiancesHostile(actor.allegiance, locked.allegiance) &&
      aiDistance(origin, positionOf(locked)) < range * TARGET_LOCK_SLACK
    ) {
      return locked
    }
  }

  let nearest: T | null = null
  let bestDistance = range
  for (const other of actors) {
    if (
      !other.alive ||
      other === actor ||
      other.id === actor.ignoredTargetId ||
      !areAllegiancesHostile(actor.allegiance, other.allegiance)
    ) {
      continue
    }
    const distance = aiDistance(origin, positionOf(other))
    if (distance < bestDistance) {
      nearest = other
      bestDistance = distance
    }
  }
  return nearest
}

/**
 * Layer 3 — share of a beast's original pack still standing *and still nearby*. Distance
 * counts: a wolf drawn away from its pack is as alone as one whose pack is dead, which is
 * what makes separating a pack a real tactic rather than a way to fight it for free.
 */
export function beastPackShare<T extends AiActor>(
  actor: T,
  actors: readonly T[],
  radius: number,
  positionOf: AiPositionOf<T>,
): number {
  if (!actor.packId) return 1
  const origin = positionOf(actor)
  const radiusSquared = radius * radius
  let alive = 0
  for (const other of actors) {
    if (other.packId !== actor.packId || !other.alive) continue
    if (other !== actor) {
      const offset = positionOf(other)
      const dx = offset.x - origin.x
      const dy = offset.y - origin.y
      const dz = offset.z - origin.z
      if (dx * dx + dy * dy + dz * dz > radiusSquared) continue
    }
    alive += 1
  }
  return alive / Math.max(1, actor.packSize)
}

export interface PlayerPursuitInput {
  hostileToPlayer: boolean
  playerAggro: boolean
  /** Seconds of remembered aggression left. */
  aggroMemory: number
  playerDistance: number
  /** How far this actor notices the player unprompted. */
  senseRange: number
  /** How far it will keep chasing one it has already noticed. */
  leashRange: number
}

export interface PlayerPursuit {
  /** The player is in plain sight. */
  canSense: boolean
  /** Out of sight but still being chased. */
  canTrack: boolean
  /** Either of the above, or still angry about it. */
  shouldPursue: boolean
}

/** Whether the player is worth going after, and whether they can currently be seen. */
export function evaluatePlayerPursuit(input: PlayerPursuitInput): PlayerPursuit {
  const canSense = input.hostileToPlayer && input.playerDistance < input.senseRange
  const canTrack =
    input.hostileToPlayer && input.playerAggro && input.playerDistance < input.leashRange
  const aggro = input.playerAggro || canSense || canTrack
  const shouldPursue =
    input.hostileToPlayer && aggro && (canSense || canTrack || input.aggroMemory > 0)
  return { canSense, canTrack, shouldPursue }
}
