/**
 * The campaign's decision layer: objectives, the world-event director, and the chronicle
 * commitments that tie them together.
 *
 * These three were welded into `GameEngine`'s main loop. They are deliberately one module
 * rather than three, and deliberately broader than "event director": pulling events out on
 * their own would leave the loop problem exactly where it was, and objectives, events and
 * the chronicle already read each other — an objective's completion ratio feeds the
 * chronicle tick, a chronicle capture reshapes encounter plans, a materialized event hands
 * its result back to the chronicle. One owner is the point.
 *
 * Same shape as `ActorAi`, `CombatResolver`, `Chronicle` and `Materialization`: no THREE,
 * no scene, no audio, no RNG of its own. `GameEngine` keeps everything that spawns a mesh
 * — `startRichCaravanEvent` and its eight siblings stay there, because a raid is a pile of
 * actors and props. What lives here is *when* a raid may start, *which* one, what happens
 * to its timer, and what its outcome is worth.
 *
 * **What this module cannot tell you.** It has no idea whether an event is fun, whether a
 * player noticed it, or whether an objective is reachable — reachability is the world
 * generator's 500-seed gate (`tests/worldGenerator.test.ts`) and exposure is something
 * only the run harness can count.
 */

import {
  createGeneratedObjectiveText,
  type LocatedEventCopyContext,
} from '../content/gameCopy.ts'
import type {
  Faction,
  Objective,
  RandomWorldEventKind,
  WorldEventKind,
} from '../types.ts'
import { CHRONICLE_TICK_SECONDS, type ChronicleEvent } from './Chronicle.ts'
import type { FactionObjectiveNode, WorldBlueprint } from './worldTypes.ts'

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

/**
 * The campaign objective list for a faction.
 *
 * This was written twice — once in `GameEngine.createGeneratedObjectives` and once,
 * character for character, in `App.tsx` so the menu could hand the HUD a list before the
 * engine existed. Two copies of a list the player reads as their campaign is one copy too
 * many; `tests/campaignDirector.test.ts` pins that the surviving one reproduces both.
 */
export function createGeneratedObjectives(
  blueprint: WorldBlueprint,
  faction: Faction,
): Objective[] {
  return blueprint.objectives[faction].nodes.map((node) => {
    const site = blueprint.sites.find((candidate) => candidate.id === node.siteId)
    return {
      id: node.id,
      text: createGeneratedObjectiveText(node.kind, site?.kind),
      done: false,
    }
  })
}

export function isObjectiveDone(
  objectives: readonly Objective[],
  id: string,
): boolean {
  return objectives.some((objective) => objective.id === id && objective.done)
}

export function objectivePrerequisitesDone(
  node: FactionObjectiveNode,
  objectives: readonly Objective[],
): boolean {
  return node.prerequisiteIds.every((id) => isObjectiveDone(objectives, id))
}

/**
 * The objective the HUD points at.
 *
 * A `.find()`, not a filter: it returns the *first* ready node, so a graph with parallel
 * branches would still show one objective at a time. That is a known property rather than
 * an oversight — the roadmap's 1.4 turns on it — and it is pinned here so a later graph
 * change cannot alter what the player sees without this test noticing.
 */
export function getActiveObjectiveNode(
  blueprint: WorldBlueprint,
  faction: Faction,
  objectives: readonly Objective[],
): FactionObjectiveNode | null {
  const graph = blueprint.objectives[faction]
  return (
    graph.nodes.find(
      (node) =>
        !isObjectiveDone(objectives, node.id) &&
        objectivePrerequisitesDone(node, objectives),
    ) ?? null
  )
}

/** The run ends in victory when every node is done, including the optional branches. */
export function campaignObjectivesComplete(objectives: readonly Objective[]): boolean {
  return objectives.every((objective) => objective.done)
}

/**
 * Marks one objective done, in place, and reports whether anything changed.
 *
 * Returns false for an unknown id and for one already done, which is what stops a repeated
 * arrival trigger from re-announcing and re-scoring the same objective every frame.
 */
export function completeObjectiveEntry(
  objectives: Objective[],
  id: string,
): Objective | null {
  const objective = objectives.find((entry) => entry.id === id)
  if (!objective || objective.done) return null
  objective.done = true
  if (objective.target) objective.progress = objective.target
  return objective
}

/** How close the player has to stand before an `arrive` objective completes itself. */
export const OBJECTIVE_ARRIVE_RADIUS = 8

export function isWithinObjectiveArrival(
  playerX: number,
  playerZ: number,
  siteX: number,
  siteZ: number,
): boolean {
  return Math.hypot(siteX - playerX, siteZ - playerZ) <= OBJECTIVE_ARRIVE_RADIUS
}

// ---------------------------------------------------------------------------
// The event director's policy
// ---------------------------------------------------------------------------

export const EVENT_COOLDOWN_MIN = 50
export const EVENT_COOLDOWN_MAX = 70
/** How long the director waits before trying again when nothing could be afforded. */
export const EVENT_RETRY = 10
export const THREAT_WAVE_MIN_INTERVAL = 70

export interface EventCooldownRange {
  min: number
  max: number
}

/**
 * Events come faster as the threat tier climbs, with a floor so the world never becomes a
 * queue. The two floors differ because the max shrinks faster than the min.
 */
export function eventCooldownRange(threatTier: number): EventCooldownRange {
  const tierOffset = threatTier - 1
  return {
    min: Math.max(30, EVENT_COOLDOWN_MIN - tierOffset * 5),
    max: Math.max(42, EVENT_COOLDOWN_MAX - tierOffset * 7),
  }
}

export function threatWaveInterval(threatTier: number): number {
  return Math.max(THREAT_WAVE_MIN_INTERVAL, 130 - threatTier * 12)
}

/** Enemies of the player's faction get tougher with the tier; friends never do. */
export function enemyHealthMultiplier(threatTier: number, isHostile: boolean): number {
  return isHostile ? 1 + (threatTier - 1) * 0.12 : 1
}

export function enemyDamageMultiplier(
  threatTier: number,
  hostileToPlayer: boolean,
): number {
  return hostileToPlayer ? 1 + (threatTier - 1) * 0.09 : 1
}

/**
 * Weighted pick over the kinds the director can currently afford.
 *
 * `roll` is a sample in [0, 1) from the caller's seeded event stream. The last eligible
 * kind is the fallback rather than the first, matching the engine: floating-point drift in
 * the running subtraction can leave the loop without a positive hit, and falling through
 * to the last candidate is what stops that being a silent no-event frame.
 */
export function selectWeightedEventKind(
  eligibleKinds: readonly RandomWorldEventKind[],
  weightOf: (kind: RandomWorldEventKind) => number,
  roll: number,
): RandomWorldEventKind | null {
  if (eligibleKinds.length === 0) return null
  const totalWeight = eligibleKinds.reduce((total, kind) => total + weightOf(kind), 0)
  let remaining = roll * totalWeight
  for (const kind of eligibleKinds) {
    remaining -= weightOf(kind)
    if (remaining <= 0) return kind
  }
  return eligibleKinds[eligibleKinds.length - 1]
}

/** The state a live event can be in while the director is looking at it. */
export type DirectedEventState = 'active' | 'succeeded' | 'failed'

export interface DirectedEvent {
  anchor: 'player' | 'located'
  state: DirectedEventState
  /** Seconds left, or null for an event with no clock. */
  timer: number | null
  regionId: string | null
}

/**
 * What the director does with one live event's clock this frame.
 *
 * Split into two decisions rather than one because the engine's loop interleaves them
 * with the event's own `update` callback, which may resolve the event before its clock is
 * ever read. Collapsing them into a single call would have quietly moved that callback.
 */
export type EventTimerDirection =
  | { kind: 'running'; timer: number }
  | { kind: 'handBack'; timer: number }
  | { kind: 'expired'; timer: number }

/**
 * Layer 2's rule, and the reason this is a decision rather than an `if`: a located event
 * whose region streamed out is **not** cancelled. It is handed back to the chronicle,
 * which resolves it off-screen and records who won. An event anchored on the player has
 * nowhere to be handed back to.
 */
export function shouldHandBackForStreaming(
  event: DirectedEvent,
  isRegionSimulated: (regionId: string | null) => boolean,
): boolean {
  return event.anchor === 'located' && !isRegionSimulated(event.regionId)
}

/** Null for an event with no clock, which is most of them. */
export function advanceEventTimer(
  event: DirectedEvent,
  delta: number,
): EventTimerDirection | null {
  if (event.timer === null) return null
  const timer = Math.max(0, event.timer - delta)
  if (timer > 0) return { kind: 'running', timer }
  return { kind: event.anchor === 'located' ? 'handBack' : 'expired', timer }
}

/** Cooldown rolled after a player-anchored event ends. Located events do not reset it. */
export function rollEventCooldown(threatTier: number, roll: number): number {
  const range = eventCooldownRange(threatTier)
  return range.min + roll * (range.max - range.min)
}

/** Gold a completed chronicle-materialized event pays. */
export function locatedEventReward(
  rewards: Readonly<Record<string, number>>,
  kind: WorldEventKind,
): number {
  return rewards[kind] ?? 0
}

/** The fallback copy context used when an event's own context was already released. */
export function fallbackLocatedCopyContext(
  regionLabel: string,
): LocatedEventCopyContext {
  return { regionLabel, siteLabel: null, faction: null, defender: null }
}

// ---------------------------------------------------------------------------
// Chronicle commitments
// ---------------------------------------------------------------------------

/**
 * How many chronicle ticks a frame may catch up on before the rest is dropped.
 *
 * Without the cap, a tab restored after five minutes in the background would run about
 * forty ticks inside one `update()` and burn a settlement per frame. With it, a long stall
 * loses history rather than compressing it, which is the deliberate trade.
 */
export const CHRONICLE_MAX_CATCHUP_TICKS = 8
export const CHRONICLE_FEED_LIMIT = 8
/** How many chronicle lines a single tick batch may put on screen. */
export const CHRONICLE_MAX_ANNOUNCEMENTS = 2

export interface ChronicleCommitment {
  /** How many ticks to run this frame. */
  ticks: number
  /** The accumulator to carry into the next frame. */
  accumulator: number
}

/**
 * The tick accumulator, extracted whole because it is the one piece of the main loop the
 * scripted-schedule arms in `tests/runHarness.test.ts` are about.
 *
 * A frame contributes its delta and then runs as many whole ticks as have accrued, capped.
 * The remainder carries; if the cap was hit and a remainder still exceeds a tick, the
 * remainder is dropped rather than carried, so a long stall cannot leave a permanent
 * backlog that fires an extra tick on every subsequent frame.
 */
export function commitChronicleTicks(
  accumulator: number,
  delta: number,
): ChronicleCommitment {
  let carried = accumulator + delta
  let ticks = 0
  while (carried >= CHRONICLE_TICK_SECONDS && ticks < CHRONICLE_MAX_CATCHUP_TICKS) {
    carried -= CHRONICLE_TICK_SECONDS
    ticks += 1
  }
  if (carried >= CHRONICLE_TICK_SECONDS) carried = 0
  return { ticks, accumulator: carried }
}

/** The player's share of their own campaign, which the chronicle tick reads. */
export function playerObjectiveRatio(objectives: readonly Objective[]): number {
  if (objectives.length === 0) return 0
  return objectives.filter((objective) => objective.done).length / objectives.length
}

/** The three kinds worth interrupting the player for. Everything else goes to the feed. */
export function isSalientChronicleEvent(kind: ChronicleEvent['kind']): boolean {
  return (
    kind === 'settlementBurned' || kind === 'regionCaptured' || kind === 'caravanLost'
  )
}

/**
 * Which chronicle events become notices.
 *
 * Three gates, in the engine's order: salience, a per-batch cap, and fog of war. The fog
 * gate is why a run can rack up history the player never hears about — the number the run
 * harness reports as event exposure.
 */
export function selectChronicleAnnouncements(
  events: readonly ChronicleEvent[],
  discoveredRegionIds: ReadonlySet<string>,
): ChronicleEvent[] {
  const announced: ChronicleEvent[] = []
  for (const event of events) {
    if (announced.length >= CHRONICLE_MAX_ANNOUNCEMENTS) break
    if (!isSalientChronicleEvent(event.kind)) continue
    if (!discoveredRegionIds.has(String(event.regionId))) continue
    announced.push(event)
  }
  return announced
}

/**
 * The feed's cache key.
 *
 * The feed is rebuilt only when this changes, which is what keeps `emitView` off a
 * `.filter().slice().reverse().map()` over the whole log at 60 Hz. It has to include the
 * discovered count: revealing a region changes which past events are visible without
 * changing the tick or the log length.
 */
export function buildChronicleFeedSignature(
  tick: number,
  discoveredCount: number,
  log: readonly ChronicleEvent[],
): string {
  return `${tick}:${discoveredCount}:${log.length}:${log[log.length - 1]?.id ?? ''}`
}

/** The events the feed shows: discovered regions only, newest first, capped. */
export function selectChronicleFeedEvents(
  log: readonly ChronicleEvent[],
  discoveredRegionIds: ReadonlySet<string>,
): ChronicleEvent[] {
  return log
    .filter((event) => discoveredRegionIds.has(String(event.regionId)))
    .slice(-CHRONICLE_FEED_LIMIT)
    .reverse()
}
