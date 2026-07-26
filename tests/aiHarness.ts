/**
 * Headless AI harness.
 *
 * `GameEngine` cannot be instantiated without a WebGL context, so the decision half of
 * actor AI was extracted into the pure `world/ActorAi.ts` (with an equivalence control in
 * `tests/actorAi.test.ts` proving the extraction changed nothing). This file drives that
 * real code over many simulated frames so questions about behaviour can be *counted*
 * rather than reasoned about.
 *
 * WHAT IT IS: the game's actual target selection (`selectCombatTarget`), pack morale
 * (`beastPackShare` + `shouldBeastRout`), player-pursuit gating (`evaluatePlayerPursuit`),
 * and the real `BEAST_PROFILES` numbers, run on a fixed frame delta with a seeded stream.
 *
 * WHAT IT IS NOT: the full simulation. Movement here is a straight line at role speed with
 * no navmesh, no collision, no steering, no separation, and no terrain. Attacks land at
 * contact range on a cooldown with no wind-up, poise, stagger or knockback. So a number
 * from this harness describes **what the decision logic does**, not what a player would
 * experience. Where that distinction could change a conclusion, it is called out at the
 * assertion.
 */

import {
  BEAST_PROFILES,
  shouldBeastRout,
  WOLF_PACK_RADIUS,
  BEAST_SENSE_RANGE,
  BEAST_LEASH_RANGE,
} from '../src/game/world/Fauna.ts'
import {
  aiDistance,
  beastPackShare,
  evaluatePlayerPursuit,
  selectCombatTarget,
  type AiActor,
  type AiPoint,
} from '../src/game/world/ActorAi.ts'
import { isBeastRole, areAllegiancesHostile, type ActorRole, type Allegiance } from '../src/game/types.ts'
import type { RandomStream } from '../src/game/random/RandomStream.ts'

/** One simulated frame. 20 Hz: fine enough for approach and contact, cheap to run. */
export const HARNESS_FRAME = 0.05
/** Melee reach, matching the engine's actor-vs-actor stop distance. */
export const HARNESS_CONTACT_RANGE = 2.45
/** Seconds between melee swings, matching the engine's `meleeActor` cooldown. */
export const HARNESS_ATTACK_COOLDOWN = 1.3

export interface HarnessFighter extends AiActor {
  role: ActorRole
  position: { x: number; y: number; z: number }
  hp: number
  maxHp: number
  speed: number
  damage: number
  hostileToPlayer: boolean
  playerAggro: boolean
  aggroMemory: number
  attackCooldown: number
  routTimer: number
  /** Set once when this fighter breaks, so routs can be counted rather than sampled. */
  routed: boolean
}

export interface HarnessOptions {
  /** Layer 3's wolf rule. Turning it off is the A/B arm for "does routing matter?". */
  packRoutEnabled?: boolean
  /** Player stands still and fights back; omit for an NPC-only brawl. */
  player?: { x: number; z: number; hp: number; damage: number } | null
  /** Frames to run before giving up on a stalemate. */
  maxFrames?: number
}

export interface HarnessResult {
  frames: number
  /** Melee connections, by the allegiance that threw them. Dense: thousands per batch. */
  attacksBy: Record<string, number>
  /** Melee connections, by what was hit: an allegiance, or `player`. */
  attacksAgainst: Record<string, number>
  /** Damage dealt, by attacker allegiance. */
  damageBy: Record<string, number>
  /** Damage taken, by victim allegiance or `player`. */
  damageAgainst: Record<string, number>
  deathsBy: Record<string, number>
  /** Beasts that broke and cleared the field. Alive, but no longer in the fight. */
  fledBy: Record<string, number>
  survivorsBy: Record<string, number>
  routs: number
  playerHp: number
  /** True when one side was wiped out rather than the frame budget running out. */
  resolved: boolean
}

let nextId = 0

export function makeFighter(
  allegiance: Allegiance,
  role: ActorRole,
  x: number,
  z: number,
  options: Partial<HarnessFighter> = {},
): HarnessFighter {
  const beast = isBeastRole(role) ? BEAST_PROFILES[role] : null
  const hp = beast?.hp ?? (role === 'brute' ? 130 : role === 'archer' ? 45 : 70)
  nextId += 1
  return {
    id: options.id ?? `${allegiance}-${role}-${nextId}`,
    allegiance,
    role,
    alive: true,
    ignoredTargetId: null,
    targetId: null,
    packId: null,
    packKinSize: 1,
    position: { x, y: 0, z },
    hp,
    maxHp: hp,
    speed: beast?.speed ?? (role === 'brute' ? 2.6 : 3.7),
    damage: beast?.meleeDamage ?? (role === 'brute' ? 14 : 13),
    hostileToPlayer: true,
    playerAggro: false,
    aggroMemory: 0,
    attackCooldown: 0,
    routTimer: 0,
    routed: false,
    ...options,
  }
}

const positionOf = (fighter: HarnessFighter): AiPoint => fighter.position

function bump(counter: Record<string, number>, key: string, amount = 1): void {
  counter[key] = (counter[key] ?? 0) + amount
}

function senseRangeFor(fighter: HarnessFighter): number {
  return isBeastRole(fighter.role) ? BEAST_SENSE_RANGE : 15
}

function leashRangeFor(fighter: HarnessFighter): number {
  return isBeastRole(fighter.role) ? BEAST_LEASH_RANGE : 15 * 2.25
}

function step(from: AiPoint, toward: AiPoint, distance: number): void {
  const dx = toward.x - from.x
  const dz = toward.z - from.z
  const length = Math.hypot(dx, dz)
  if (length < 0.0001) return
  const scale = Math.min(distance, length) / length
  ;(from as { x: number }).x += dx * scale
  ;(from as { z: number }).z += dz * scale
}

/** Nearest thing this fighter is at war with, the player included. */
function nearestThreat(
  fighter: HarnessFighter,
  living: readonly HarnessFighter[],
  player: { x: number; z: number; alive: boolean } | null,
): AiPoint | null {
  let nearest: AiPoint | null = null
  let best = Number.POSITIVE_INFINITY
  if (player?.alive && fighter.hostileToPlayer) {
    const point = { x: player.x, y: 0, z: player.z }
    best = aiDistance(fighter.position, point)
    nearest = point
  }
  for (const other of living) {
    if (other === fighter || !other.alive) continue
    if (!areAllegiancesHostile(fighter.allegiance, other.allegiance)) continue
    const distance = aiDistance(fighter.position, other.position)
    if (distance >= best) continue
    best = distance
    nearest = other.position
  }
  return nearest
}

/**
 * Runs one fight to a conclusion. Deterministic given the same fighters and rng state:
 * the only stochastic element is the attack jitter, drawn from the seeded stream.
 */
export function runFight(
  fighters: HarnessFighter[],
  rng: RandomStream,
  options: HarnessOptions = {},
): HarnessResult {
  const packRoutEnabled = options.packRoutEnabled ?? true
  const maxFrames = options.maxFrames ?? 3_000
  const player = options.player ? { ...options.player, alive: true } : null

  const result: HarnessResult = {
    frames: 0,
    attacksBy: {},
    attacksAgainst: {},
    damageBy: {},
    damageAgainst: {},
    deathsBy: {},
    fledBy: {},
    survivorsBy: {},
    routs: 0,
    playerHp: player?.hp ?? 0,
    resolved: false,
  }

  const kill = (fighter: HarnessFighter): void => {
    fighter.alive = false
    bump(result.deathsBy, fighter.allegiance)
  }

  for (let frame = 0; frame < maxFrames; frame += 1) {
    result.frames = frame + 1
    const living = fighters.filter((fighter) => fighter.alive)
    const sides = new Set(living.map((fighter) => fighter.allegiance))
    // Over when nothing left can fight anything else.
    const anyHostility =
      living.some(
        (fighter) =>
          player?.alive &&
          fighter.hostileToPlayer &&
          !(packRoutEnabled && fighter.routTimer > 0),
      ) ||
      living.some((fighter) =>
        living.some(
          (other) =>
            other !== fighter &&
            selectCombatTarget(fighter, living, 1_000, positionOf) === other,
        ),
      )
    if (!anyHostility || (sides.size === 0 && !player?.alive)) {
      result.resolved = true
      break
    }

    for (const fighter of living) {
      fighter.attackCooldown = Math.max(0, fighter.attackCooldown - HARNESS_FRAME)
      fighter.aggroMemory = Math.max(0, fighter.aggroMemory - HARNESS_FRAME)
      fighter.routTimer = Math.max(0, fighter.routTimer - HARNESS_FRAME)

      // Layer 3 morale, using the real rule.
      if (packRoutEnabled && isBeastRole(fighter.role) && fighter.routTimer <= 0) {
        const share = beastPackShare(fighter, living, WOLF_PACK_RADIUS, positionOf)
        if (shouldBeastRout(fighter.role as never, share)) {
          fighter.routTimer = 9
          fighter.targetId = null
          fighter.playerAggro = false
          if (!fighter.routed) {
            fighter.routed = true
            result.routs += 1
          }
        }
      }
      // A routed beast runs, exactly as `GameEngine.updateRoutingBeast` does — it does
      // not stand there absorbing hits. Modelling the rout as "skip your turn" inverted
      // the first measurement taken with this harness, so the flee is not optional.
      if (packRoutEnabled && fighter.routTimer > 0) {
        const threat = nearestThreat(fighter, living, player)
        if (threat) {
          const away = {
            x: fighter.position.x * 2 - threat.x,
            y: 0,
            z: fighter.position.z * 2 - threat.z,
          }
          step(fighter.position, away, fighter.speed * 1.15 * HARNESS_FRAME)
          // Cleared the field: gone, not dead. The engine removes it the same way.
          if (aiDistance(fighter.position, threat) > BEAST_LEASH_RANGE) {
            fighter.alive = false
            bump(result.fledBy, fighter.allegiance)
          }
        }
        continue
      }

      // The player, if present and worth chasing.
      let targetPosition: AiPoint | null = null
      let targetFighter: HarnessFighter | null = null
      if (player?.alive) {
        const playerPoint = { x: player.x, y: 0, z: player.z }
        const pursuit = evaluatePlayerPursuit({
          hostileToPlayer: fighter.hostileToPlayer,
          playerAggro: fighter.playerAggro,
          aggroMemory: fighter.aggroMemory,
          playerDistance: aiDistance(fighter.position, playerPoint),
          senseRange: senseRangeFor(fighter),
          leashRange: leashRangeFor(fighter),
        })
        if (pursuit.canSense || pursuit.canTrack) {
          fighter.playerAggro = true
          fighter.aggroMemory = 6
        }
        if (pursuit.shouldPursue) targetPosition = playerPoint
      }

      // Otherwise the nearest hostile actor, chosen by the game's own selector.
      if (!targetPosition) {
        targetFighter = selectCombatTarget(
          fighter,
          living,
          senseRangeFor(fighter),
          positionOf,
        )
        fighter.targetId = targetFighter?.id ?? null
        if (targetFighter) targetPosition = targetFighter.position
      }
      if (!targetPosition) continue

      const distance = aiDistance(fighter.position, targetPosition)
      if (distance > HARNESS_CONTACT_RANGE) {
        step(fighter.position, targetPosition, fighter.speed * HARNESS_FRAME)
        continue
      }
      if (fighter.attackCooldown > 0) continue

      fighter.attackCooldown = HARNESS_ATTACK_COOLDOWN
      const dealt = fighter.damage * rng.range(0.9, 1.1)
      bump(result.attacksBy, fighter.allegiance)
      bump(result.damageBy, fighter.allegiance, dealt)
      if (targetFighter) {
        bump(result.attacksAgainst, targetFighter.allegiance)
        bump(result.damageAgainst, targetFighter.allegiance, dealt)
        targetFighter.hp -= dealt
        if (targetFighter.hp <= 0) kill(targetFighter)
      } else if (player?.alive) {
        bump(result.attacksAgainst, 'player')
        bump(result.damageAgainst, 'player', dealt)
        player.hp -= dealt
        if (player.hp <= 0) player.alive = false
      }
    }
  }

  for (const fighter of fighters) {
    if (fighter.alive) bump(result.survivorsBy, fighter.allegiance)
  }
  result.playerHp = player ? Math.max(0, player.hp) : 0
  return result
}

/** Sums many fights into one set of counts, so the metrics are dense enough to read. */
export function accumulate(results: readonly HarnessResult[]): HarnessResult {
  const total: HarnessResult = {
    frames: 0,
    attacksBy: {},
    attacksAgainst: {},
    damageBy: {},
    damageAgainst: {},
    deathsBy: {},
    fledBy: {},
    survivorsBy: {},
    routs: 0,
    playerHp: 0,
    resolved: true,
  }
  for (const result of results) {
    total.frames += result.frames
    total.routs += result.routs
    total.playerHp += result.playerHp
    total.resolved = total.resolved && result.resolved
    for (const key of ['attacksBy', 'attacksAgainst', 'damageBy', 'damageAgainst', 'deathsBy', 'fledBy', 'survivorsBy'] as const) {
      for (const [name, value] of Object.entries(result[key])) {
        bump(total[key], name, value)
      }
    }
  }
  return total
}
