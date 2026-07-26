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
 *
 * Layer 4 adds the rest of the decision surface: threat scoring (which replaces both
 * nearest-wins and the all-or-nothing player override), one morale rule for packs and
 * individuals alike, alert propagation, and flanking ranks. Flanking is the exception
 * that proves the rule about this module: the *rank and angle* are a decision and live
 * here, but whether a flank reads well is a movement question no pure function and no
 * headless harness can answer.
 */

import {
  allegianceRelation,
  areAllegiancesHostile,
  isBeastRole,
  type ActorRole,
  type Allegiance,
  type BeastRole,
} from '../types.ts'
import { BEAST_PROFILES, shouldBeastRout } from './Fauna.ts'

export interface AiPoint {
  x: number
  y: number
  z: number
}

/** The minimum an actor must expose to be reasoned about. `Actor` satisfies it. */
export interface AiActor {
  id: string
  allegiance: Allegiance
  role: ActorRole
  alive: boolean
  /** A protected target, e.g. the captive in a rescue event. */
  ignoredTargetId: string | null
  /** Currently locked target, if any. */
  targetId: string | null
  /** Layer 3 — which pack this beast set out with. */
  packId: string | null
  /** How many of this beast's *own kind* set out in that pack. */
  packKinSize: number
  /** Layer 4 — threat scoring finishes the wounded, morale breaks over its own hp. */
  hp: number
  maxHp: number
  /** Layer 4 — already going for the player, which is how the player's crowd is counted. */
  playerAggro: boolean
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
 * **This is the Layer 3 rule, kept deliberately.** The engine now runs `selectThreat`
 * instead, but a negative control that is a re-implementation of the old rule only proves
 * the re-implementation right; keeping the real thing callable means the A/B arms in
 * `tests/aiQuestions.test.ts` compare shipped code against shipped code. `tests/actorAi.test.ts`
 * still pins it against the engine code it replaced, so it cannot rot unnoticed.
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
 * Layer 3 — share of a beast's own kind in its pack still standing *and still nearby*.
 *
 * Kind, not pack: a wolf takes courage from the other wolves, not from the troll standing
 * next to it. Measuring over the whole pack made the rule unreachable in shipped content,
 * because a wrecker with three times a wolf's health always outlived its escorts and the
 * last one standing was the one role that cannot break (see §9). Distance counts too: a
 * wolf drawn away from its kin is as alone as one whose kin are dead, which is what makes
 * separating a pack a real tactic rather than a way to fight it for free.
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
    if (other.packId !== actor.packId || other.role !== actor.role || !other.alive) {
      continue
    }
    if (other !== actor) {
      const offset = positionOf(other)
      const dx = offset.x - origin.x
      const dy = offset.y - origin.y
      const dz = offset.z - origin.z
      if (dx * dx + dy * dy + dz * dz > radiusSquared) continue
    }
    alive += 1
  }
  return alive / Math.max(1, actor.packKinSize)
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

// ---------------------------------------------------------------------------
// Layer 4 — threat scoring
// ---------------------------------------------------------------------------

/**
 * Returned instead of an actor when the player wins the scoring pass. A sentinel rather
 * than a wrapper object, because `selectThreat` runs once per actor per frame and the
 * whole point of the generic `AiActor` seam is that it allocates nothing.
 */
export const THREAT_PLAYER = 'player'

export type ThreatChoice<T> = T | typeof THREAT_PLAYER | null

export interface PlayerThreat {
  position: AiPoint
  /** 0..1. The player bleeding is as interesting as an NPC bleeding. */
  hpFraction: number
  /** This actor has already been provoked, so the player weighs much heavier. */
  provoked: boolean
}

/**
 * How a role picks its fights. The defaults describe a line soldier; the deviations are
 * the whole content of "role-aware targeting".
 */
export interface ThreatStyle {
  /** Pull toward a wounded target. `0` ignores hp entirely and just takes what is near. */
  wounded: number
  /** Cost added per ally already on that target. **Negative means focus fire.** */
  crowd: number
  /** Multiplier applied to the player. */
  player: number
  /** Multiplier applied to the back rank — archers and commanders. */
  backline: number
  /** Multiplier applied to anything heavy enough to be a bad trade. */
  heavy: number
}

const DEFAULT_THREAT_STYLE: ThreatStyle = {
  wounded: 0.5,
  crowd: 0.4,
  player: 1,
  backline: 1,
  heavy: 1,
}

/**
 * A brute takes what is in front of it and nothing else: no hp preference, no crowding
 * penalty, no opinion about who is worth hitting. That is what "brutes prefer whatever
 * blocks them" means as an implementation — the *absence* of the other terms, not an
 * extra one.
 */
const BLOCKER_THREAT_STYLE: ThreatStyle = {
  wounded: 0,
  crowd: 0,
  player: 1,
  backline: 1,
  heavy: 1,
}

const THREAT_STYLES: Partial<Record<ActorRole, ThreatStyle>> = {
  // Shoots past the front line at whoever is doing the damage, and does not want a bear
  // walking up to it.
  archer: { wounded: 0.5, crowd: 0.4, player: 0.7, backline: 0.7, heavy: 1.45 },
  scout: { wounded: 0.7, crowd: 0.45, player: 0.85, backline: 0.8, heavy: 1.2 },
  brute: BLOCKER_THREAT_STYLE,
  champion: BLOCKER_THREAT_STYLE,
  bear: BLOCKER_THREAT_STYLE,
  troll: BLOCKER_THREAT_STYLE,
  // A pack piles onto one animal instead of spreading out — the negative `crowd` is the
  // only place in the table where being outnumbered on a target is an *attraction*.
  wolf: { wounded: 0.72, crowd: -0.22, player: 1, backline: 0.95, heavy: 1.15 },
  boar: { wounded: 0.2, crowd: 0.15, player: 1, backline: 1, heavy: 1 },
}

/** A provoked player is treated as if they were this much closer than they are. */
export const THREAT_PROVOKED_BIAS = 0.55
/** Hysteresis: the target already locked has to be beaten by a clear margin. */
export const THREAT_LOCK_BONUS = 0.8
/** However many allies pile on, a target never becomes infinitely unattractive. */
export const THREAT_CROWD_FLOOR = 0.35

export function threatStyle(role: ActorRole): ThreatStyle {
  return THREAT_STYLES[role] ?? DEFAULT_THREAT_STYLE
}

function isBacklineRole(role: ActorRole): boolean {
  return role === 'archer' || role === 'commander'
}

function isHeavyRole(role: ActorRole): boolean {
  return (
    role === 'brute' || role === 'champion' || role === 'bear' || role === 'troll'
  )
}

function threatCost(
  distance: number,
  hpFraction: number,
  engagedAllies: number,
  style: ThreatStyle,
  roleMultiplier: number,
): number {
  const wounded = Math.max(0.15, 1 - style.wounded * (1 - clamp01(hpFraction)))
  const crowd = Math.max(THREAT_CROWD_FLOOR, 1 + style.crowd * engagedAllies)
  return distance * wounded * crowd * roleMultiplier
}

/** How many of this actor's allies already hold `targetId`. */
export function alliesEngagedOn<T extends AiActor>(
  actor: T,
  targetId: string,
  actors: readonly T[],
): number {
  let count = 0
  for (const other of actors) {
    if (
      other !== actor &&
      other.alive &&
      other.targetId === targetId &&
      allegianceRelation(other.allegiance, actor.allegiance) === 'friendly'
    ) {
      count += 1
    }
  }
  return count
}

/** How many of this actor's allies are already going for the player. */
export function alliesOnPlayer<T extends AiActor>(actor: T, actors: readonly T[]): number {
  let count = 0
  for (const other of actors) {
    if (
      other !== actor &&
      other.alive &&
      other.playerAggro &&
      allegianceRelation(other.allegiance, actor.allegiance) === 'friendly'
    ) {
      count += 1
    }
  }
  return count
}

/**
 * Layer 4 — who this actor fights, scoring the player in the *same pass* as every NPC.
 *
 * This replaces two rules at once. `selectCombatTarget` (kept, and now the control arm
 * these are measured against) took the nearest hostile and nothing else; and the engine
 * asked "can I see the player?" *before* it asked "is there anything to fight?", which
 * measured out in §9 as a step function at `BEAST_SENSE_RANGE` — 100% of beast attacks
 * on the player inside 21 m, 100% on the garrison outside it, nothing in between. Here
 * the player is one more candidate with a cost, so a beast with a soldier at its throat
 * and the player across the square fights the soldier.
 *
 * Cost is in metres, so every weight reads as "treats it as if it were this much closer".
 * Lowest cost wins. The player is deliberately **not** range-gated: `evaluatePlayerPursuit`
 * has already decided whether they are a legal candidate at all, and a tracked player
 * 40 m away simply loses to a soldier 4 m away on cost.
 */
export function selectThreat<T extends AiActor>(
  actor: T,
  actors: readonly T[],
  range: number,
  positionOf: AiPositionOf<T>,
  player: PlayerThreat | null = null,
): ThreatChoice<T> {
  const origin = positionOf(actor)
  const style = threatStyle(actor.role)
  let best: ThreatChoice<T> = null
  let bestCost = Number.POSITIVE_INFINITY

  if (player) {
    const cost =
      threatCost(
        aiDistance(origin, player.position),
        player.hpFraction,
        alliesOnPlayer(actor, actors),
        style,
        style.player,
      ) * (player.provoked ? THREAT_PROVOKED_BIAS : 1)
    best = THREAT_PLAYER
    bestCost = cost
  }

  for (const other of actors) {
    if (
      !other.alive ||
      other === actor ||
      other.id === actor.ignoredTargetId ||
      !areAllegiancesHostile(actor.allegiance, other.allegiance)
    ) {
      continue
    }
    const locked = other.id === actor.targetId
    const distance = aiDistance(origin, positionOf(other))
    if (distance >= (locked ? range * TARGET_LOCK_SLACK : range)) continue
    const roleMultiplier = isBacklineRole(other.role)
      ? style.backline
      : isHeavyRole(other.role)
        ? style.heavy
        : 1
    const cost =
      threatCost(
        distance,
        other.maxHp > 0 ? other.hp / other.maxHp : 1,
        alliesEngagedOn(actor, other.id, actors),
        style,
        roleMultiplier,
      ) * (locked ? THREAT_LOCK_BONUS : 1)
    if (cost < bestCost) {
      best = other
      bestCost = cost
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Layer 4 — morale
// ---------------------------------------------------------------------------

export type MoraleBreak = 'none' | 'cohesion' | 'individual'

/**
 * How steady a role is before anything happens to it. `null` means it cannot break at
 * all, and each `null` is load-bearing rather than a balance number:
 *
 * - `commander` — he is the thing that rallies everyone else, and a campaign objective
 *   can require killing him. A commander who runs off the map strands the run.
 * - `champion` — a boss that flees is not a boss.
 * - `captive` — not a combatant; the rescue event owns its behaviour.
 *
 * The table is **exhaustive over every non-beast role on purpose**, so the compiler
 * refuses a new role with no answer. The first draft was a `Partial` read with
 * `?? 0`, which quietly turned every `null` back into "breaks like a soldier" — measured
 * as commanders and champions routing in 60 fights out of 60.
 *
 * Beasts are absent, also on purpose: `BEAST_PROFILES[role].routThreshold` already says
 * which of them can break, and duplicating it here would let the two drift apart.
 */
const ROLE_RESOLVE: Record<Exclude<ActorRole, BeastRole>, number | null> = {
  commander: null,
  champion: null,
  captive: null,
  brute: 0.45,
  soldier: 0,
  minion: -0.1,
  archer: -0.12,
  scout: -0.18,
}

/** Steadiness of a role, or `null` when it never breaks. */
export function actorResolve(role: ActorRole): number | null {
  if (isBeastRole(role)) {
    return BEAST_PROFILES[role].routThreshold > 0 ? 0 : null
  }
  return ROLE_RESOLVE[role]
}

/**
 * Being hurt, weighted superlinearly so it barely registers at half health and decides
 * things at the end. Solved against `MORALE_BREAK`: an actor with its group intact and
 * no commander either way breaks just under **21% hp**, which is the "~25%" the spec
 * asks for expressed as a curve rather than a cliff.
 */
export const MORALE_WOUND = 1.6
/** Friends going down around it. Half the local group dead is a 0.35 hit. */
export const MORALE_LOSSES = 0.7
/** The shock of watching the commander fall. */
export const MORALE_COMMANDER_LOSS = 0.35
/** A living commander within rally range is worth more than a light wound. */
export const MORALE_COMMANDER_RALLY = 0.45
/** Morale at or below this breaks the actor. */
export const MORALE_BREAK = 0

export interface MoraleInput {
  /** 0..1 own health. */
  hpFraction: number
  /** 0..1 share of the nearby group still standing — see `localGroupShare`. */
  groupShare: number
  /** Layer 3 kin cohesion. `1` for anything that did not set out with a pack. */
  packShare: number
  /** A commander of this actor's side is alive within rally range. */
  commanderNearby: boolean
  /** A commander of this actor's side went down recently. */
  commanderLost: boolean
}

/**
 * Layer 4 — **one** morale rule, which is the point.
 *
 * Layer 3 shipped pack cohesion for beasts, and Layer 4 was asked for individual morale.
 * Two independent "should I run" systems on the same actor would fight each other, so
 * this is the single entry point and the two rules are two *reasons* it can return a
 * break rather than two mechanisms:
 *
 * - **cohesion** governs packs. A wolf counts wolves; losing half of them breaks it
 *   however healthy it is. Unchanged from Layer 3, delegated to `shouldBeastRout`.
 * - **individual morale** governs everything else, including a beast whose cohesion rule
 *   can never fire. The measured case is `bear+wolf+boar`: that pack carries a single
 *   wolf, so its kin size is 1, its share is permanently 1, and cohesion correctly never
 *   breaks it (§9 measured 0 routs in 60 fights, and that was the right answer for a
 *   *cohesion* rule). Breaking a lone wolf standing over its dead bear is this half's job.
 *
 * `actorResolve` returning `null` is a hard gate checked before either: a boar that
 * "never routs" must not acquire a back door through the individual score.
 */
export function evaluateMorale(role: ActorRole, input: MoraleInput): MoraleBreak {
  const resolve = actorResolve(role)
  if (resolve === null) return 'none'
  if (isBeastRole(role) && shouldBeastRout(role, input.packShare)) return 'cohesion'

  const wound = 1 - clamp01(input.hpFraction)
  const morale =
    1 +
    resolve -
    MORALE_WOUND * wound * wound -
    MORALE_LOSSES * (1 - clamp01(input.groupShare)) -
    (input.commanderLost ? MORALE_COMMANDER_LOSS : 0) +
    (input.commanderNearby ? MORALE_COMMANDER_RALLY : 0)
  return morale <= MORALE_BREAK ? 'individual' : 'none'
}

/**
 * Share of the nearby group still on its feet: standing allies over standing plus fallen.
 *
 * Counting the bodies rather than remembering a roster is deliberate. It needs no state
 * in the save, works for an actor however it was spawned, and measures exactly what the
 * player can see — the fight looks lost when there are more of your side lying down than
 * standing up. The engine keeps corpses in the actor list for `CORPSE_LIFETIME`, so this
 * is a memory of *recent* losses, which is the right window for morale: an hour-old
 * battlefield should not still be breaking people.
 *
 * With nobody nearby either way the answer is `1`: an actor alone has lost nothing, and
 * its hp term decides on its own.
 */
export function localGroupShare<T extends AiActor>(
  actor: T,
  actors: readonly T[],
  radius: number,
  positionOf: AiPositionOf<T>,
): number {
  const origin = positionOf(actor)
  const radiusSquared = radius * radius
  let standing = 0
  let fallen = 0
  for (const other of actors) {
    if (other === actor) continue
    if (allegianceRelation(other.allegiance, actor.allegiance) !== 'friendly') continue
    const offset = positionOf(other)
    const dx = offset.x - origin.x
    const dy = offset.y - origin.y
    const dz = offset.z - origin.z
    if (dx * dx + dy * dy + dz * dz > radiusSquared) continue
    if (other.alive) standing += 1
    else fallen += 1
  }
  if (standing + fallen === 0) return 1
  return standing / (standing + fallen)
}

// ---------------------------------------------------------------------------
// Layer 4 — alert propagation
// ---------------------------------------------------------------------------

export interface AiAlert {
  /** Who shouted; they do not alert themselves. */
  sourceId: string
  allegiance: Allegiance
  /** Where the shouter is standing. The radius is measured from here, not from the target. */
  origin: AiPoint
  /** Where the hostile was seen. */
  target: AiPoint
  /** The hostile's actor id, or `null` when the sighting is of the player. */
  hostileId: string | null
}

/**
 * Layer 4 — whether a shouted sighting reaches this actor and is worth acting on.
 *
 * `alertCooldown` has been on `Actor` since long before this layer and was only ever
 * used for the player. Generalising it is most of the work; the one rule with any
 * substance is the last: **an actor already holding a target of its own does not drop it
 * for hearsay.** Without it, one shout re-aims a whole square onto a single sighting and
 * every fight in earshot dissolves.
 */
export function acceptsAlert<T extends AiActor>(
  listener: T,
  alert: AiAlert,
  radius: number,
  positionOf: AiPositionOf<T>,
): boolean {
  if (!listener.alive || listener.id === alert.sourceId) return false
  if (allegianceRelation(listener.allegiance, alert.allegiance) !== 'friendly') return false
  if (alert.hostileId !== null && listener.ignoredTargetId === alert.hostileId) return false
  if (listener.targetId !== null && listener.targetId !== alert.hostileId) return false
  return aiDistance(positionOf(listener), alert.origin) <= radius
}

// ---------------------------------------------------------------------------
// Layer 4 — flanking
// ---------------------------------------------------------------------------

/**
 * Approach angles for the second and later attackers on one target, in radians off the
 * direct line. The primary comes straight in; the rest fan out to either side.
 *
 * **Every entry is inside ±66°, and that bound is load-bearing rather than taste.** The
 * offset is applied to the approach *direction*, so an angle past 90° gives a negative
 * radial component: the attacker walks away from its target, the distance grows, the
 * blend below stays pinned at full, and it never converges. The first draft of this
 * ladder ran to ±135° and π, which made ranks three and up recede forever — including a
 * raider walking away from the barricade it was sent to knock down. `cos(1.15) ≈ 0.4`, so
 * the slowest flanker still closes at 40% of its speed.
 */
export const FLANK_OFFSETS: readonly number[] = [0, 1.15, -1.15, 0.62, -0.62, 0.95]

/** No approach offset may reach a right angle; see `FLANK_OFFSETS`. */
export const FLANK_MAX_ANGLE = 1.2

/**
 * How far out the offset is still applied. Inside this the approach straightens, so
 * attackers converge on the stop ring instead of orbiting it forever — which is what a
 * naive "always aim at your offset point" implementation does.
 */
export const FLANK_BLEND_DISTANCE = 7

/**
 * This actor's stable place in the queue for `targetId`. `0` is the primary and comes
 * straight in. Rank is by actor id so it does not churn frame to frame, and it survives
 * a flanker dying by simply promoting everyone behind it.
 */
export function engagementRank<T extends AiActor>(
  actor: T,
  targetId: string,
  actors: readonly T[],
): number {
  let rank = 0
  for (const other of actors) {
    if (
      other !== actor &&
      other.alive &&
      other.targetId === targetId &&
      other.id < actor.id &&
      allegianceRelation(other.allegiance, actor.allegiance) === 'friendly'
    ) {
      rank += 1
    }
  }
  return rank
}

/** Radians off the direct approach for an attacker of this rank. */
export function flankApproachAngle(rank: number): number {
  if (rank <= 0) return 0
  return FLANK_OFFSETS[rank % FLANK_OFFSETS.length]
}

/**
 * The same queue for the player, who has no `targetId` to match on. An actor going for
 * the player is exactly one with `playerAggro`, which is the flag the engine already
 * maintains for pursuit.
 */
export function playerEngagementRank<T extends AiActor>(
  actor: T,
  actors: readonly T[],
): number {
  let rank = 0
  for (const other of actors) {
    if (
      other !== actor &&
      other.alive &&
      other.playerAggro &&
      other.id < actor.id &&
      allegianceRelation(other.allegiance, actor.allegiance) === 'friendly'
    ) {
      rank += 1
    }
  }
  return rank
}

/**
 * How much of the flanking angle to apply at this distance: full while approaching,
 * fading to nothing at contact. Without the fade the offset point rotates as fast as the
 * attacker moves and the attacker circles the target instead of reaching it.
 */
export function flankBlend(distance: number, stopDistance: number): number {
  if (distance <= stopDistance) return 0
  const over = distance - stopDistance
  return Math.min(1, over / FLANK_BLEND_DISTANCE)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
