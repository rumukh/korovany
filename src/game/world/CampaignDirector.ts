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
import type { RandomStream } from '../random/RandomStream.ts'
import type {
  Faction,
  Objective,
  RandomWorldEventKind,
  RumourKind,
  RumourOutcome,
  WorldEventKind,
} from '../types.ts'
import { RUMOUR_KINDS } from '../types.ts'
import {
  CARAVAN_BEAST_THRESHOLD,
  CARAVAN_PROGRESS_PER_TICK,
  CHRONICLE_TICK_SECONDS,
  applySabotagedSupply,
  getChronicleProtectedRegionIds,
  getChronicleSettlementSiteIds,
  getCaravanRegionId,
  isProtectedSite,
  isRegionRazed,
  resolveEscortedCaravanDelivery,
  resolveMaterializedCaravan,
  resolveMaterializedRaid,
  type ChronicleEvent,
  type ChronicleState,
  type RegionChronicleState,
} from './Chronicle.ts'
import type { FactionObjectiveNode, WorldBlueprint } from './worldTypes.ts'
import { CONTRACT_IDS, type ContractId, type FactionRecord } from './worldTypes.ts'

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
 * The first ready node.
 *
 * A `.find()`, not a filter: it returns the *first* ready node, so a graph with parallel
 * branches still shows one objective at a time through this function. That was the whole
 * of what the HUD pointed at before roadmap 1.4, and it survives as the **fallback** —
 * `resolveActiveObjectiveNode` is what the engine asks now, and it falls through to this
 * when nothing is pinned. Kept, and kept tested, because "the pin does nothing yet" and
 * "the pin is ignored" have to be different states.
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

/**
 * Roadmap 1.4 — **every** node whose prerequisites are met, in graph order.
 *
 * This is the function that makes the fork visible. `getActiveObjectiveNode` above answers
 * "which one node does the compass point at"; a diamond graph read through that alone
 * would present one objective at a time and the player would never learn there was a
 * choice at all. The HUD draws this list; the marker layer draws a pin per entry.
 */
export function getReadyObjectiveNodes(
  blueprint: WorldBlueprint,
  faction: Faction,
  objectives: readonly Objective[],
): FactionObjectiveNode[] {
  return blueprint.objectives[faction].nodes.filter(
    (node) =>
      !isObjectiveDone(objectives, node.id) &&
      objectivePrerequisitesDone(node, objectives),
  )
}

/**
 * The node the compass, the prompt and the HUD all agree on: the pinned one if it is still
 * ready, otherwise the first ready one.
 *
 * The fallback is not a nicety. A pin can stop being ready for reasons the player did not
 * choose — the node completed, a restore brought back an id this graph no longer has — and
 * a compass pointing at nothing is worse than a compass pointing at the wrong thing.
 */
export function resolveActiveObjectiveNode(
  blueprint: WorldBlueprint,
  faction: Faction,
  objectives: readonly Objective[],
  pinnedNodeId: string | null,
): FactionObjectiveNode | null {
  const ready = getReadyObjectiveNodes(blueprint, faction, objectives)
  if (pinnedNodeId !== null) {
    const pinned = ready.find((node) => node.id === pinnedNodeId)
    if (pinned) return pinned
  }
  return ready[0] ?? null
}

/**
 * The run ends in victory when every node is done.
 *
 * Unchanged by roadmap 1.4, and deliberately so: the branches the 1.4 graph adds are **all
 * required**, so what the player chooses is an order rather than a route, and the persisted
 * `Objective` needs no skipped or optional concept to express that. Replacing this
 * expression is 2.1's cost, gated on what 1.4 measures.
 */
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

// ---------------------------------------------------------------------------
// Roadmap 1.3 — embodied chronicle commitments
// ---------------------------------------------------------------------------

/**
 * The player already influences the chronicle three ways — by standing somewhere, by
 * finishing objectives, and by winning a fight they happened to be near. All three are
 * reactive and none of them is *chosen*, and `GameView.chronicle` never says "this
 * happened because you did that". This section is the choosing.
 *
 * The shape is deliberately small and deliberately general, because roadmap 1.4's contract
 * templates are the same flow with different content: **offer a time-boxed thing with a
 * stated stake, let the player pin exactly one, and resolve it honestly either way.** What
 * 1.4 will reuse is everything below except `findRumourCandidates`.
 *
 * Three rules the design is not allowed to break:
 *
 * 1. **Embodied, never purchased.** Every intervention requires the player's body in a
 *    particular square: alongside the cart, inside the threatened region, or standing at
 *    the depot with a torch. A "pay gold for +pressure" lever is the explicitly rejected
 *    design, and the test for it is simple — if a commitment can be honoured without going
 *    anywhere, it is the rejected one.
 * 2. **An ignored rumour resolves against the player.** It does not evaporate. The
 *    consequence goes through the same hand-back functions a materialized event uses when
 *    the player walks out on it, so the world settles it exactly as it settles everything
 *    else it does off-screen.
 * 3. **A commitment may never strand a run.** `reservedRegionIds` — the chronicle-protected
 *    anchors plus every square holding one of the player's objective sites — is excluded
 *    twice over: once when a rumour is selected, and again when it resolves.
 */

/**
 * `RumourKind` and `RumourOutcome` live in `types.ts` beside the event kinds, so the HUD and
 * the copy can share the vocabulary without importing the director.
 */

/** At most two open at a time. This is a HUD, not a quest log. */
export const RUMOUR_LIMIT = 2
/** Chronicle ticks a rumour stays open. Twelve ticks is 96 s at `CHRONICLE_TICK_SECONDS`. */
export const RUMOUR_DEADLINE_TICKS = 12
/** Ticks between offers, so the feed does not become a queue. */
export const RUMOUR_OFFER_INTERVAL_TICKS = 4
/** Ticks the player must spend in the cart's own square for the escort to count. */
export const RUMOUR_ESCORT_TICKS = 2
/**
 * Ticks of slack an escort is offered on top of the presence it needs, so there is time to
 * get to the cart at all. Without it a rumour raised about a cart two ticks from home is
 * honourable only by somebody already standing next to it — which the browser produced on
 * the first try.
 *
 * One rather than two, because a cart covers its whole route in about six ticks and only
 * the youngest of the three in flight would clear a wider bar; the presence requirement
 * shrinks to fit instead, in `requiredRumourProgressFor`.
 */
export const RUMOUR_ESCORT_APPROACH_TICKS = 1
/** Ticks the player must spend inside the threatened square for the defence to count. */
export const RUMOUR_DEFEND_TICKS = 3
/** How long the HUD keeps the verdict on screen, so the outcome is attributed to a choice. */
export const RUMOUR_VERDICT_TICKS = 2
/** How many ranked candidates the offer draws from. */
export const RUMOUR_CANDIDATE_POOL = 4

export interface ChronicleRumour {
  /** Stable per situation, so one front never becomes two rumours. */
  id: string
  kind: RumourKind
  /** The square the player has to be in. Tracks the cart for an escort. */
  regionId: string
  /** The square that pays for it. Never a reserved one. */
  targetRegionId: string
  /** The square an ignored raid marches from, when there is one. */
  sourceRegionId: string | null
  /** What the player acts on: the cart's destination, the settlement, or the depot. */
  siteId: string | null
  caravanId: string | null
  /** The other side: interceptor, attacker, or whoever is stocking the depot. */
  faction: Faction | null
  raisedTick: number
  deadlineTick: number
  /** Chronicle ticks of qualifying presence. Only the pinned rumour accrues any. */
  progress: number
  /** The decisive act, for the kind that needs one rather than a stay. */
  actioned: boolean
}

/** What happened, and whether it happened because of the player. */
export interface RumourVerdict {
  rumourId: string
  kind: RumourKind
  outcome: RumourOutcome
  /** True when the player had pinned it. A broken promise reads differently from a shrug. */
  committed: boolean
  regionId: string
  targetRegionId: string
  siteId: string | null
  faction: Faction | null
  tick: number
}

/**
 * Everything 1.3 adds to the save, and all of it.
 *
 * It lives in `directorState` for the reason 0.4's hint queue does: the bag is already
 * persisted on `ActiveRunSaveV3`, already normalized as free-form JSON, and already the
 * place run-scoped director bookkeeping goes. Nothing here is derivable from the chronicle
 * — a pin is a decision, and a decision that does not survive a reload is not one.
 */
export interface ChronicleCommitmentState {
  rumours: ChronicleRumour[]
  pinnedRumourId: string | null
  nextOfferTick: number
  verdict: RumourVerdict | null
}

export function createChronicleCommitmentState(): ChronicleCommitmentState {
  return {
    rumours: [],
    pinnedRumourId: null,
    nextOfferTick: RUMOUR_OFFER_INTERVAL_TICKS,
    verdict: null,
  }
}

export function cloneChronicleRumour(rumour: ChronicleRumour): ChronicleRumour {
  return { ...rumour }
}

export function cloneChronicleCommitmentState(
  state: ChronicleCommitmentState,
): ChronicleCommitmentState {
  return {
    rumours: state.rumours.map(cloneChronicleRumour),
    pinnedRumourId: state.pinnedRumourId,
    nextOfferTick: state.nextOfferTick,
    verdict: state.verdict ? { ...state.verdict } : null,
  }
}

export interface RumourWorldContext {
  blueprint: WorldBlueprint
  state: ChronicleState
  regions: Map<string, RegionChronicleState>
  playerFaction: Faction
  /** Anchors plus objective squares. Never a target, never a burned site, never a flip. */
  reservedRegionIds: ReadonlySet<string>
}

/**
 * The squares a rumour may never put at stake.
 *
 * Two sources, and both matter. The chronicle-protected anchors are the campaign's start
 * and finale, and `WorldValidator` already guarantees they never change hands. The second
 * source is this initiative's own: an objective site in a razed square is a run that cannot
 * be finished, because `handleGeneratedInteraction` refuses a burned shop or healer before
 * it ever looks at whether an objective wanted it. So every square holding one of the
 * player's objective sites is off limits too, done or not.
 */
export function getRumourReservedRegionIds(
  blueprint: WorldBlueprint,
  playerFaction: Faction,
): ReadonlySet<string> {
  const reserved = new Set(getChronicleProtectedRegionIds(blueprint))
  for (const node of blueprint.objectives[playerFaction].nodes) {
    reserved.add(String(node.regionId))
    const site = blueprint.sites.find((candidate) => candidate.id === node.siteId)
    if (site) reserved.add(String(site.regionId))
  }
  return reserved
}

const roadNeighbourCache = new WeakMap<WorldBlueprint, Map<string, string[]>>()
/**
 * Site kinds a rival could plausibly be stocking a push from.
 *
 * Wider than `CHRONICLE_SETTLEMENT_SITE_KINDS` on purpose, and measured rather than
 * guessed: a first cut asked for a settlement site in the depot square *and* another in the
 * square it would hit, and across twelve seeds and forty ticks that produced **zero**
 * sabotage rumours — 139 of the rejections were "this square has no settlement at all". A
 * generated world only has a handful of trading squares, so a torch that can only be put to
 * a shop is a verb the player would never meet. Protected sites stay out, which is what
 * keeps the campaign's anchors unburnable.
 */
const SABOTAGE_SITE_KINDS: readonly string[] = [
  'settlement',
  'shop',
  'recovery',
  'landmark',
  'event',
]
const depotSiteCache = new WeakMap<WorldBlueprint, Map<string, string[]>>()

function depotSiteIds(blueprint: WorldBlueprint, regionId: string): readonly string[] {
  let index = depotSiteCache.get(blueprint)
  if (!index) {
    index = new Map<string, string[]>()
    for (const site of blueprint.sites) {
      if (isProtectedSite(site) || !SABOTAGE_SITE_KINDS.includes(site.kind)) continue
      const key = String(site.regionId)
      const list = index.get(key) ?? []
      list.push(String(site.id))
      index.set(key, list)
    }
    for (const list of index.values()) list.sort()
    depotSiteCache.set(blueprint, index)
  }
  return index.get(regionId) ?? []
}
/** Road-adjacent squares, both ways, memoized per blueprint. */
export function getRoadNeighbours(blueprint: WorldBlueprint): Map<string, string[]> {
  const cached = roadNeighbourCache.get(blueprint)
  if (cached) return cached
  const neighbours = new Map<string, string[]>()
  const add = (from: string, to: string): void => {
    const list = neighbours.get(from) ?? []
    if (!list.includes(to)) list.push(to)
    neighbours.set(from, list)
  }
  for (const segment of blueprint.roads.segments) {
    add(String(segment.fromRegionId), String(segment.toRegionId))
    add(String(segment.toRegionId), String(segment.fromRegionId))
  }
  for (const list of neighbours.values()) list.sort()
  return neighbours
}

interface RumourCandidate {
  rumour: ChronicleRumour
  /** How badly the world wants this. Ranking only; never a probability. */
  weight: number
}

/**
 * Every situation the world could currently gossip about, best first.
 *
 * Pure: no RNG, no clock. That is what lets `offerRumours` take exactly one draw from a
 * dedicated stream, and what lets a test enumerate the candidates a given chronicle state
 * produces without running a game.
 */
export function findRumourCandidates(context: RumourWorldContext): ChronicleRumour[] {
  const candidates: RumourCandidate[] = [
    ...findEscortCandidates(context),
    ...findDefendCandidates(context),
    ...findSabotageCandidates(context),
  ]
  candidates.sort(
    (left, right) =>
      right.weight - left.weight ||
      (left.rumour.id < right.rumour.id ? -1 : left.rumour.id > right.rumour.id ? 1 : 0),
  )
  return candidates.map((candidate) => candidate.rumour)
}

function rumourDeadline(state: ChronicleState): number {
  return state.tick + RUMOUR_DEADLINE_TICKS
}

function findEscortCandidates(context: RumourWorldContext): RumourCandidate[] {
  const { state, regions } = context
  const found: RumourCandidate[] = []
  for (const caravan of state.caravans) {
    if (!caravan.intact) continue
    const currentRegionId = getCaravanRegionId(caravan)
    if (currentRegionId === null) continue
    const destinationId = String(caravan.regionPath[caravan.regionPath.length - 1])
    // Unlike the other two kinds, an escort's destination is *not* filtered against the
    // reserved set, and that is a decision rather than an oversight. The only writes an
    // escort can produce are `supply` at the destination and one log line — no control
    // flip, no settlement damage — so it cannot strand a campaign no matter where the cart
    // is headed, and excluding anchors here would silently delete a third of the routes.
    const destination = regions.get(destinationId)
    const ours =
      caravan.ownerFaction === context.playerFaction ||
      destination === undefined ||
      destination.control === context.playerFaction ||
      destination.control === 'neutral'
    if (!ours) continue
    // How dangerous the road is, as a *weight* rather than a filter. Measured: requiring
    // a hostile or beast-heavy square on the route rejected every cart on a quiet corridor,
    // which across sixteen ticks of one seed was most of them. It is also unnecessary — the
    // stake the rumour states is made true by the resolution, which intercepts an ignored
    // cart through the hand-back path whether or not the chronicle would have.
    let risk = 0
    let interceptor: Faction | null = null
    for (const step of caravan.regionPath) {
      const region = regions.get(String(step))
      if (!region) continue
      if (region.control !== 'neutral' && region.control !== caravan.ownerFaction) {
        risk += 1
        interceptor ??= region.control
      }
      if (region.beastPressure >= CARAVAN_BEAST_THRESHOLD) risk += 1
    }
    if (risk === 0) interceptor = null
    // The clock is the cart's, not the board's. Measured twice. First: with a flat
    // twelve-tick deadline every escort outlived its caravan — a cart covers its route in
    // about six ticks at `CARAVAN_PROGRESS_PER_TICK` — so the chronicle had already settled
    // all but two of forty-five ignored rumours by the time they came due, and "resolves
    // against the player" quietly became "resolves as nothing". Second, in the browser: a
    // cart already most of the way home produced a two-tick escort, which is exactly
    // `RUMOUR_ESCORT_TICKS`, so honouring it required already standing beside the thing at
    // the moment it was offered. A cart with no room left to be escorted is not a rumour.
    const ticksToArrival = Math.ceil((1 - caravan.progress) / CARAVAN_PROGRESS_PER_TICK)
    const escortTicks = Math.min(RUMOUR_DEADLINE_TICKS, ticksToArrival - 1)
    if (escortTicks < RUMOUR_ESCORT_TICKS + RUMOUR_ESCORT_APPROACH_TICKS) continue
    found.push({
      weight: 0.5 + Math.min(0.4, risk * 0.1) + caravan.progress * 0.1,
      rumour: {
        id: `rumour:escort:${caravan.id}`,
        kind: 'escort',
        regionId: String(currentRegionId),
        targetRegionId: destinationId,
        sourceRegionId: null,
        siteId: caravan.toSiteId,
        caravanId: caravan.id,
        faction: interceptor,
        raisedTick: state.tick,
        deadlineTick: state.tick + escortTicks,
        progress: 0,
        actioned: false,
      },
    })
  }
  return found
}

function findDefendCandidates(context: RumourWorldContext): RumourCandidate[] {
  const { blueprint, state, regions } = context
  const neighbours = getRoadNeighbours(blueprint)
  const found: RumourCandidate[] = []
  for (const region of blueprint.regions) {
    const key = String(region.id)
    if (context.reservedRegionIds.has(key)) continue
    const chronicle = regions.get(key)
    if (!chronicle || isRegionRazed(chronicle)) continue
    if (
      chronicle.control !== context.playerFaction &&
      chronicle.control !== 'neutral'
    ) {
      continue
    }
    const siteIds = getChronicleSettlementSiteIds(blueprint, region.id)
    if (siteIds.length === 0) continue
    const defenderPressure =
      chronicle.control === 'neutral' ? 0 : chronicle.pressure[chronicle.control]
    let best: { source: string; attacker: Faction; advantage: number } | null = null
    for (const neighbourId of neighbours.get(key) ?? []) {
      const source = regions.get(neighbourId)
      if (!source || source.control === 'neutral') continue
      if (source.control === chronicle.control) continue
      const advantage = source.pressure[source.control] - defenderPressure
      if (advantage <= 0) continue
      if (!best || advantage > best.advantage) {
        best = { source: neighbourId, attacker: source.control, advantage }
      }
    }
    if (!best) continue
    found.push({
      weight: 0.6 + Math.min(0.35, best.advantage),
      rumour: {
        id: `rumour:defend:${key}:${best.attacker}`,
        kind: 'defend',
        regionId: key,
        targetRegionId: key,
        sourceRegionId: best.source,
        siteId: String(siteIds[0]),
        caravanId: null,
        faction: best.attacker,
        raisedTick: state.tick,
        deadlineTick: rumourDeadline(state),
        progress: 0,
        actioned: false,
      },
    })
  }
  return found
}

function findSabotageCandidates(context: RumourWorldContext): RumourCandidate[] {
  const { blueprint, state, regions } = context
  const neighbours = getRoadNeighbours(blueprint)
  const found: RumourCandidate[] = []
  for (const region of blueprint.regions) {
    const depotId = String(region.id)
    if (context.reservedRegionIds.has(depotId)) continue
    const depot = regions.get(depotId)
    if (!depot || isRegionRazed(depot)) continue
    if (depot.control === 'neutral' || depot.control === context.playerFaction) continue
    const depotSiteIdList = depotSiteIds(blueprint, depotId)
    if (depotSiteIdList.length === 0) continue
    // The depot has to be stocked to be worth burning, and it has to have somewhere to
    // send what it is stocking. Without a target the stake would be a number nobody sees.
    if (depot.supply <= 0.35) continue
    let target: string | null = null
    for (const neighbourId of neighbours.get(depotId) ?? []) {
      if (context.reservedRegionIds.has(neighbourId)) continue
      const candidate = regions.get(neighbourId)
      if (!candidate || isRegionRazed(candidate)) continue
      if (
        candidate.control !== context.playerFaction &&
        candidate.control !== 'neutral'
      ) {
        continue
      }
      if (target === null || neighbourId < target) target = neighbourId
    }
    if (target === null) continue
    found.push({
      weight: 0.45 + depot.supply * 0.4,
      rumour: {
        id: `rumour:sabotage:${depotId}:${target}`,
        kind: 'sabotage',
        regionId: depotId,
        targetRegionId: target,
        sourceRegionId: depotId,
        siteId: depotSiteIdList[0],
        caravanId: null,
        faction: depot.control,
        raisedTick: state.tick,
        deadlineTick: rumourDeadline(state),
        progress: 0,
        actioned: false,
      },
    })
  }
  return found
}

/**
 * Tops the board up, at most one rumour per call and never past the limit.
 *
 * One draw from the caller's rumour stream, and only when there is actually something to
 * choose between — a stream that advances on an empty board would make the offer cadence
 * itself a source of divergence between two otherwise identical runs.
 */
export function offerRumours(
  state: ChronicleCommitmentState,
  context: RumourWorldContext,
  rng: RandomStream,
): ChronicleRumour | null {
  if (context.state.tick < state.nextOfferTick) return null
  if (state.rumours.length >= RUMOUR_LIMIT) return null
  const open = new Set(state.rumours.map((rumour) => rumour.id))
  const openKinds = new Set(state.rumours.map((rumour) => rumour.kind))
  const candidates = findRumourCandidates(context).filter(
    (candidate) => !open.has(candidate.id),
  )
  if (candidates.length === 0) return null
  // At most one of each kind on the board. A weaker version of this rule — prefer a fresh
  // kind, fall back to any — let two sabotages fill both slots and then starve the other
  // two verbs for a full deadline: measured on seed 900000 as the guard, escorts were
  // available from tick 9 and the board did not have room for one until tick 15. Two rows
  // that say the same thing are also the worst version of a two-row HUD.
  const fresh = candidates.filter((candidate) => !openKinds.has(candidate.kind))
  if (fresh.length === 0) return null
  const pool = fresh.slice(0, RUMOUR_CANDIDATE_POOL)
  const chosen = pool.length === 1 ? pool[0] : rng.pick(pool)
  state.rumours.push(cloneChronicleRumour(chosen))
  state.nextOfferTick = context.state.tick + RUMOUR_OFFER_INTERVAL_TICKS
  return chosen
}

export function getRumour(
  state: ChronicleCommitmentState,
  rumourId: string | null,
): ChronicleRumour | null {
  if (rumourId === null) return null
  return state.rumours.find((rumour) => rumour.id === rumourId) ?? null
}

export function getPinnedRumour(
  state: ChronicleCommitmentState,
): ChronicleRumour | null {
  return getRumour(state, state.pinnedRumourId)
}

/**
 * Pins one rumour, or clears the pin. Reports whether anything moved.
 *
 * Takes no RNG and reads no clock, because this is a button: a UI event that consumed from
 * a gameplay stream would shift every encounter and loot roll after it, which is the same
 * rule `content/hints.ts` is built around.
 */
export function pinRumour(
  state: ChronicleCommitmentState,
  rumourId: string | null,
): boolean {
  if (rumourId === null) {
    if (state.pinnedRumourId === null) return false
    state.pinnedRumourId = null
    return true
  }
  if (state.pinnedRumourId === rumourId) return false
  if (!state.rumours.some((rumour) => rumour.id === rumourId)) return false
  state.pinnedRumourId = rumourId
  return true
}

/** Ticks of presence, or acts, the kind nominally needs before it counts as honoured. */
export function requiredRumourProgress(kind: RumourKind): number {
  if (kind === 'escort') return RUMOUR_ESCORT_TICKS
  if (kind === 'defend') return RUMOUR_DEFEND_TICKS
  return 1
}

/**
 * What *this* rumour needs, which is not always the nominal figure.
 *
 * An escort borrows its clock from the cart, and a cart three ticks from home cannot be
 * walked beside for three ticks. The requirement shrinks to fit the window rather than the
 * window stretching past the cart's arrival, because a deadline that outlives its subject
 * is the bug that made every ignored escort resolve into nothing.
 */
export function requiredRumourProgressFor(rumour: ChronicleRumour): number {
  const nominal = requiredRumourProgress(rumour.kind)
  if (rumour.kind === 'sabotage') return nominal
  const window = rumour.deadlineTick - rumour.raisedTick
  return Math.max(1, Math.min(nominal, window - 1))
}

export function isRumourHonoured(rumour: ChronicleRumour): boolean {
  if (rumour.kind === 'sabotage') return rumour.actioned
  return rumour.progress >= requiredRumourProgressFor(rumour)
}

/** 0..1, for the HUD's little bar. */
export function rumourProgressShare(rumour: ChronicleRumour): number {
  if (rumour.kind === 'sabotage') return rumour.actioned ? 1 : 0
  return Math.min(1, rumour.progress / requiredRumourProgressFor(rumour))
}

/**
 * The escort the chronicle tick should be told about, if any.
 *
 * Null unless a pinned escort's cart is in the very square the player is standing in, which
 * is the whole of what "embodied" means here.
 */
export function getRumourEscort(
  state: ChronicleCommitmentState,
  context: RumourWorldContext,
  playerRegionId: string | null,
): { caravanId: string; regionId: string } | null {
  const pinned = getPinnedRumour(state)
  if (!pinned || pinned.kind !== 'escort' || pinned.caravanId === null) return null
  if (playerRegionId === null) return null
  const caravan = context.state.caravans.find(
    (entry) => entry.id === pinned.caravanId,
  )
  if (!caravan || !caravan.intact) return null
  const regionId = getCaravanRegionId(caravan)
  if (regionId === null || String(regionId) !== playerRegionId) return null
  return { caravanId: caravan.id, regionId: playerRegionId }
}

/**
 * One tick of embodied bookkeeping: where the cart is now, and whether the player is there.
 *
 * Only the pinned rumour accrues progress. That is the "one at a time" rule expressed as
 * mechanics rather than as a UI restriction — walking through a square you did not commit
 * to buys nothing.
 */
export function advanceRumourProgress(
  state: ChronicleCommitmentState,
  context: RumourWorldContext,
  playerRegionId: string | null,
): void {
  for (const rumour of state.rumours) {
    if (rumour.kind === 'escort' && rumour.caravanId !== null) {
      const caravan = context.state.caravans.find(
        (entry) => entry.id === rumour.caravanId,
      )
      const regionId = caravan ? getCaravanRegionId(caravan) : null
      if (regionId !== null) rumour.regionId = String(regionId)
    }
    if (rumour.id !== state.pinnedRumourId || playerRegionId === null) continue
    if (rumour.kind === 'sabotage') continue
    if (rumour.regionId === playerRegionId) rumour.progress += 1
  }
}

/**
 * The torch. Returns false when the player is not committed to burning this depot, which is
 * what stops a sabotage from being something you stumble into.
 *
 * The supply drop lands here rather than at the deadline, because this is the half of the
 * intervention the player is standing in front of: `getSupplyPriceMultiplier` reads it, so
 * the shop in that square is dearer for its owner on the very next tick.
 */
export function markRumourActioned(
  state: ChronicleCommitmentState,
  context: RumourWorldContext,
  rumourId: string,
): boolean {
  const rumour = getRumour(state, rumourId)
  if (!rumour || rumour.id !== state.pinnedRumourId) return false
  if (rumour.kind !== 'sabotage' || rumour.actioned) return false
  rumour.actioned = true
  const depot = context.regions.get(rumour.regionId)
  if (depot) applySabotagedSupply(depot)
  return true
}

export interface RumourSettlement {
  verdicts: RumourVerdict[]
  events: ChronicleEvent[]
}

/**
 * Resolves every rumour whose clock has run out, honoured or not.
 *
 * A rumour never simply expires: the ignored branch is written into the world through the
 * same hand-back functions Layer 2 uses for a fight the player walked away from, so "you
 * did not go" and "you went and lost" produce the same class of consequence — a real one.
 */
export function settleDueRumours(
  state: ChronicleCommitmentState,
  context: RumourWorldContext,
  rng: RandomStream,
): RumourSettlement {
  const verdicts: RumourVerdict[] = []
  const events: ChronicleEvent[] = []
  const surviving: ChronicleRumour[] = []
  for (const rumour of state.rumours) {
    const gone =
      rumour.kind === 'escort' &&
      rumour.caravanId !== null &&
      !context.state.caravans.some((entry) => entry.id === rumour.caravanId)
    if (context.state.tick < rumour.deadlineTick && !gone) {
      surviving.push(rumour)
      continue
    }
    const committed = state.pinnedRumourId === rumour.id
    const honoured = committed && isRumourHonoured(rumour)
    events.push(...resolveRumour(rumour, context, rng, honoured))
    verdicts.push({
      rumourId: rumour.id,
      kind: rumour.kind,
      outcome: honoured ? 'kept' : 'broken',
      committed,
      regionId: rumour.regionId,
      targetRegionId: rumour.targetRegionId,
      siteId: rumour.siteId,
      faction: rumour.faction,
      tick: context.state.tick,
    })
    if (committed) state.pinnedRumourId = null
  }
  state.rumours = surviving
  if (verdicts.length > 0) state.verdict = verdicts[verdicts.length - 1]
  return { verdicts, events }
}

/**
 * What a rumour does to the world when its clock stops.
 *
 * Exported so a test can drive one resolution in isolation and so the negative controls can
 * assert what an *ignored* one costs. The `protectedRegionIds` handed to the raid resolver
 * is the reserved set, not merely the chronicle's own: that is the second of the two locks
 * on campaign safety, and it holds even if selection were changed to offer a rumour it
 * should not have.
 */
export function resolveRumour(
  rumour: ChronicleRumour,
  context: RumourWorldContext,
  rng: RandomStream,
  honoured: boolean,
): ChronicleEvent[] {
  const idPrefix = `commitment-${String(context.state.tick)}-${rumour.kind}`
  if (rumour.kind === 'escort') {
    if (rumour.caravanId === null) return []
    const caravan = context.state.caravans.find(
      (entry) => entry.id === rumour.caravanId,
    )
    // The chronicle already settled this one on its own — arrival or interception. Writing
    // a second outcome over the top would be the feature lying about what happened.
    if (!caravan) return []
    if (honoured) {
      return resolveEscortedCaravanDelivery({
        state: context.state,
        regions: context.regions,
        idPrefix,
        caravanId: rumour.caravanId,
      })
    }
    return resolveMaterializedCaravan({
      state: context.state,
      regions: context.regions,
      idPrefix,
      outcome: {
        caravanId: rumour.caravanId,
        regionId: rumour.regionId,
        intact: false,
      },
    })
  }

  const attacker = rumour.faction
  if (attacker === null) return []
  const targetReserved = context.reservedRegionIds.has(rumour.targetRegionId)
  const settlementIds = getChronicleSettlementSiteIds(
    context.blueprint,
    rumour.targetRegionId,
  )
  const resolution = resolveMaterializedRaid({
    state: context.state,
    regions: context.regions,
    rng,
    protectedRegionIds: context.reservedRegionIds,
    idPrefix,
    outcome: {
      regionId: rumour.targetRegionId,
      sourceRegionId: rumour.sourceRegionId,
      // Nothing burns in a reserved square, belt to the selection filter's braces.
      siteId: targetReserved || settlementIds.length === 0 ? null : String(settlementIds[0]),
      attacker,
      // A decided outcome, passed as a decided outcome — the caveat on
      // `resolveMaterializedRaid` is about handing it live survivor counts, and these are
      // not counts. Honoured means the push never mustered; ignored means it landed.
      attackerStrength: honoured ? 0 : 1,
      defenderStrength: honoured ? 1 : 0,
    },
  })
  return resolution.events
}

// --- save ownership --------------------------------------------------------

const RUMOUR_OUTCOMES: readonly RumourOutcome[] = ['kept', 'broken']
const RUMOUR_FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']
const MAX_RUMOUR_ID = 128

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readId(value: unknown, maxLength = MAX_RUMOUR_ID): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : null
}

function readCounter(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null
}

/** Like `readCounter`, but for a clock rather than a tally: seconds keep their fraction. */
function readAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function readFaction(value: unknown): Faction | null {
  return typeof value === 'string' && (RUMOUR_FACTIONS as readonly string[]).includes(value)
    ? (value as Faction)
    : null
}

function normalizeRumour(value: unknown): ChronicleRumour | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readId(record.id)
  const kind = record.kind
  const regionId = readId(record.regionId)
  const targetRegionId = readId(record.targetRegionId)
  const raisedTick = readCounter(record.raisedTick)
  const deadlineTick = readCounter(record.deadlineTick)
  const progress = readCounter(record.progress)
  if (
    id === null ||
    typeof kind !== 'string' ||
    !(RUMOUR_KINDS as readonly string[]).includes(kind) ||
    regionId === null ||
    targetRegionId === null ||
    raisedTick === null ||
    deadlineTick === null ||
    progress === null ||
    typeof record.actioned !== 'boolean'
  ) {
    return null
  }
  return {
    id,
    kind: kind as RumourKind,
    regionId,
    targetRegionId,
    sourceRegionId: readId(record.sourceRegionId),
    siteId: readId(record.siteId),
    caravanId: readId(record.caravanId),
    faction: readFaction(record.faction),
    raisedTick,
    deadlineTick,
    progress,
    actioned: record.actioned,
  }
}

function normalizeVerdict(value: unknown): RumourVerdict | null {
  const record = readRecord(value)
  if (!record) return null
  const rumourId = readId(record.rumourId)
  const kind = record.kind
  const outcome = record.outcome
  const regionId = readId(record.regionId)
  const targetRegionId = readId(record.targetRegionId)
  const tick = readCounter(record.tick)
  if (
    rumourId === null ||
    typeof kind !== 'string' ||
    !(RUMOUR_KINDS as readonly string[]).includes(kind) ||
    typeof outcome !== 'string' ||
    !(RUMOUR_OUTCOMES as readonly string[]).includes(outcome) ||
    regionId === null ||
    targetRegionId === null ||
    tick === null
  ) {
    return null
  }
  return {
    rumourId,
    kind: kind as RumourKind,
    outcome: outcome as RumourOutcome,
    committed: record.committed === true,
    regionId,
    targetRegionId,
    siteId: readId(record.siteId),
    faction: readFaction(record.faction),
    tick,
  }
}

/**
 * Reads the commitment back off a save, dropping anything it does not recognise.
 *
 * Same policy as the hint queue rather than the save-level discard-and-report one: this is
 * a field inside a free-form bag, so a rumour written by a build that knew a kind this one
 * does not is forgotten, not fatal. A pin that names a rumour which did not survive the
 * read is cleared, so the state can never claim a commitment to nothing.
 */
export function normalizeChronicleCommitmentState(
  value: unknown,
): ChronicleCommitmentState {
  const record = readRecord(value)
  if (!record) return createChronicleCommitmentState()
  const rumours: ChronicleRumour[] = []
  if (Array.isArray(record.rumours)) {
    for (const entry of record.rumours) {
      if (rumours.length >= RUMOUR_LIMIT) break
      const rumour = normalizeRumour(entry)
      if (rumour && !rumours.some((existing) => existing.id === rumour.id)) {
        rumours.push(rumour)
      }
    }
  }
  const pinnedRumourId = readId(record.pinnedRumourId)
  return {
    rumours,
    pinnedRumourId:
      pinnedRumourId !== null && rumours.some((rumour) => rumour.id === pinnedRumourId)
        ? pinnedRumourId
        : null,
    nextOfferTick: readCounter(record.nextOfferTick) ?? 0,
    verdict: normalizeVerdict(record.verdict),
  }
}

/** The JSON that goes into `directorState`. Bounded by `RUMOUR_LIMIT` by construction. */
export function serializeChronicleCommitmentState(
  state: ChronicleCommitmentState,
): Record<string, unknown> {
  return {
    rumours: state.rumours.map((rumour) => ({ ...rumour })),
    pinnedRumourId: state.pinnedRumourId,
    nextOfferTick: state.nextOfferTick,
    verdict: state.verdict ? { ...state.verdict } : null,
  }
}

/** Seconds left on a rumour's clock, for the HUD. */
export function rumourSecondsRemaining(
  rumour: ChronicleRumour,
  tick: number,
): number {
  return Math.max(0, (rumour.deadlineTick - tick) * CHRONICLE_TICK_SECONDS)
}

/** True while the HUD should still be showing the last verdict. */
export function isVerdictFresh(verdict: RumourVerdict, tick: number): boolean {
  return tick - verdict.tick <= RUMOUR_VERDICT_TICKS
}

// ---------------------------------------------------------------------------
// Roadmap 1.4 — branching faction contracts, the first slice
// ---------------------------------------------------------------------------

/**
 * A signature contract is a shipped event builder promoted into a campaign object.
 *
 * The behaviour is not new and is not written here: `startRichCaravanEvent`,
 * `startDefendHomeEvent` and `startRescueEvent` already ship in `GameEngine`, already spawn
 * their actors and props, already have their own success and failure conditions. Nine new
 * campaign verbs is the explicitly rejected design and this is not it — the node still
 * wears one of the four `ObjectiveKind`s.
 *
 * **What is new is the safety contract, and it is the whole of the work.** An event may
 * fail harmlessly; a campaign objective may never strand a run. Three properties, and each
 * one is a field below rather than a paragraph, so `findContractStrandRisks` can check it
 * and a mutant can break it:
 *
 * 1. **A bounded clock.** `timeoutSeconds` is finite and positive, so `active` always
 *    becomes `kept` or `failed`.
 * 2. **A bounded start.** `startGraceSeconds` caps how long the engine may stand on the
 *    site failing to start the thing — an actor budget with no room, a site position the
 *    streamer has not published — before the contract gives up and fails forward. Without
 *    this the `offered` state would be the one way a contract could hang for ever.
 * 3. **Fail-forward.** `failForward` is true on every shipped template and the gate reports
 *    it if it ever is not. A failed contract does not lock its node: the node degrades to
 *    an arrival at its own site, which is a site the run's reserved set already protects
 *    from being razed, so the campaign is always finishable and the price of failing is the
 *    forfeited payout rather than the run.
 *
 * What the player is *choosing* between the two arms of the fork is an **order**, not a
 * route. Both arms are required. Nothing in this section may be read as saying otherwise.
 */
export type ContractStatus = 'offered' | 'active' | 'kept' | 'failed'

export const CONTRACT_STATUSES: readonly ContractStatus[] = [
  'offered',
  'active',
  'kept',
  'failed',
]

const CONTRACT_FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']
const MAX_CONTRACT_ROWS = 8

export interface FactionContractTemplate {
  id: ContractId
  faction: Faction
  /** The shipped builder this contract is adapted from. Not a new behaviour. */
  eventKind: RandomWorldEventKind
  /** The contract's own clock, in seconds. Finite and positive, always. */
  timeoutSeconds: number
  /** How long the engine may fail to start it on site before it fails forward. */
  startGraceSeconds: number
  /**
   * Whether a failed contract leaves its node completable.
   *
   * Always true on a shipped template. It is a field rather than an invariant baked into
   * the code precisely so `tests/factionContracts.test.ts` can build a template with it
   * false and prove the gate catches that — a safety check nobody can make fail is not one.
   */
  failForward: boolean
  /** Gold the contract pays on top of the event's own reward when it is kept. */
  reward: number
}

/**
 * One signature contract per faction, and the pairing is the faction's own identity rather
 * than a shuffle: the villain robs, the guard protects, the elf frees its own.
 *
 * The clocks differ because the builders do. `defendHome` ships with a 45 s timer of its
 * own and a house that can burn down, so its contract clock only has to outlast that;
 * `richCaravan` and `rescue` have no clock at all, so theirs *is* the clock, and it is long
 * enough to fight through an escort and short enough that a player who wandered off finds
 * out rather than waits.
 */
export const FACTION_CONTRACTS: FactionRecord<FactionContractTemplate> = {
  elf: {
    id: 'unshackle',
    faction: 'elf',
    eventKind: 'rescue',
    timeoutSeconds: 150,
    startGraceSeconds: 12,
    failForward: true,
    reward: 90,
  },
  guard: {
    id: 'bulwark',
    faction: 'guard',
    eventKind: 'defendHome',
    timeoutSeconds: 75,
    startGraceSeconds: 12,
    failForward: true,
    reward: 110,
  },
  villain: {
    id: 'plunder',
    faction: 'villain',
    eventKind: 'richCaravan',
    timeoutSeconds: 150,
    startGraceSeconds: 12,
    failForward: true,
    reward: 120,
  },
}

export function getFactionContract(faction: Faction): FactionContractTemplate {
  return FACTION_CONTRACTS[faction]
}

export function findContractTemplate(
  contract: ContractId | undefined,
): FactionContractTemplate | null {
  if (contract === undefined) return null
  for (const faction of CONTRACT_FACTIONS) {
    if (FACTION_CONTRACTS[faction].id === contract) return FACTION_CONTRACTS[faction]
  }
  return null
}

/** The contract node of a faction's graph, or null on a graph that has none. */
export function findContractNode(
  blueprint: WorldBlueprint,
  faction: Faction,
): FactionObjectiveNode | null {
  return (
    blueprint.objectives[faction].nodes.find((node) => node.contract !== undefined) ?? null
  )
}

export interface ContractProgress {
  nodeId: string
  contract: ContractId
  status: ContractStatus
  /** Seconds left on the contract's clock while it is `active`. */
  remaining: number
  /** Seconds spent on site failing to start it while it is `offered`. */
  waited: number
  /** How many times the engine has actually put the event on the ground. */
  attempts: number
}

/**
 * Everything 1.4 adds to the save, and all of it.
 *
 * `directorState` for the same reason 1.3's commitments and 0.4's hint queue are there: the
 * bag is already persisted on `ActiveRunSaveV3`, already normalized as free-form JSON, and
 * already where run-scoped director bookkeeping lives. And for the same reason as 1.3, none
 * of it is derivable — **a pin is a decision, and a decision that does not survive a reload
 * is not one.**
 */
export interface CampaignContractState {
  /** The objective node the player took on. Null means "whatever comes first". */
  pinnedNodeId: string | null
  contracts: ContractProgress[]
}

export function createCampaignContractState(): CampaignContractState {
  return { pinnedNodeId: null, contracts: [] }
}

export function cloneCampaignContractState(
  state: CampaignContractState,
): CampaignContractState {
  return {
    pinnedNodeId: state.pinnedNodeId,
    contracts: state.contracts.map((entry) => ({ ...entry })),
  }
}

/**
 * Pins one ready objective, or clears the pin. Reports whether anything moved.
 *
 * Takes no RNG and reads no clock, exactly like `pinRumour`: this is a button, and a UI
 * event that consumed from a gameplay stream would shift every encounter and loot roll
 * after it.
 */
export function pinObjective(
  state: CampaignContractState,
  nodeId: string | null,
  readyNodeIds: readonly string[],
): boolean {
  if (nodeId === null) {
    if (state.pinnedNodeId === null) return false
    state.pinnedNodeId = null
    return true
  }
  if (state.pinnedNodeId === nodeId) return false
  if (!readyNodeIds.includes(nodeId)) return false
  state.pinnedNodeId = nodeId
  return true
}

export function getContractProgress(
  state: CampaignContractState,
  nodeId: string,
): ContractProgress | null {
  return state.contracts.find((entry) => entry.nodeId === nodeId) ?? null
}

export function getContractStatus(
  state: CampaignContractState,
  node: FactionObjectiveNode,
): ContractStatus | null {
  if (node.contract === undefined) return null
  return getContractProgress(state, node.id)?.status ?? 'offered'
}

/** Creates the row on first sight, so an untouched contract still reads as `offered`. */
export function ensureContractProgress(
  state: CampaignContractState,
  node: FactionObjectiveNode,
): ContractProgress | null {
  if (node.contract === undefined) return null
  const existing = getContractProgress(state, node.id)
  if (existing) return existing
  const created: ContractProgress = {
    nodeId: node.id,
    contract: node.contract,
    status: 'offered',
    remaining: 0,
    waited: 0,
    attempts: 0,
  }
  state.contracts.push(created)
  return created
}

/** The event is on the ground: the clock starts and nothing else can restart it. */
export function beginContract(
  state: CampaignContractState,
  node: FactionObjectiveNode,
  template: FactionContractTemplate,
): boolean {
  const progress = ensureContractProgress(state, node)
  if (!progress || progress.status !== 'offered') return false
  progress.status = 'active'
  progress.remaining = template.timeoutSeconds
  progress.waited = 0
  progress.attempts += 1
  return true
}

/** Terminal, and only from `offered` or `active`. A resolved contract stays resolved. */
export function resolveContract(
  state: CampaignContractState,
  nodeId: string,
  outcome: 'kept' | 'failed',
): boolean {
  const progress = getContractProgress(state, nodeId)
  if (!progress) return false
  if (progress.status === 'kept' || progress.status === 'failed') return false
  progress.status = outcome
  progress.remaining = 0
  progress.waited = 0
  return true
}

/**
 * What one frame does to a contract's clock, given whether the player is standing on it.
 *
 * Two clocks, and the second one is the one that closes the last hole. `active` counts the
 * contract's own timer down and fails it at zero. `offered` counts *only while the player
 * is on site and the engine could not put the event on the ground* — a budget with no
 * chronicle slots, a site the streamer has not published — and fails forward when that
 * patience runs out. Without it a contract could sit `offered` for the whole run and the
 * node would never resolve, which is stranding by another name.
 */
export type ContractTick =
  | { kind: 'idle' }
  | { kind: 'waiting'; waited: number }
  | { kind: 'running'; remaining: number }
  | { kind: 'expired' }
  | { kind: 'abandoned' }

export function advanceContract(
  progress: ContractProgress,
  template: FactionContractTemplate,
  delta: number,
  onSite: boolean,
): ContractTick {
  if (progress.status === 'active') {
    progress.remaining = Math.max(0, progress.remaining - delta)
    if (progress.remaining > 0) return { kind: 'running', remaining: progress.remaining }
    return { kind: 'expired' }
  }
  if (progress.status !== 'offered') return { kind: 'idle' }
  if (!onSite) {
    // Patience is only spent in front of the thing. A player who has not arrived has not
    // been kept waiting, and burning the grace on their way over would fail a contract
    // they never saw.
    progress.waited = 0
    return { kind: 'idle' }
  }
  progress.waited += delta
  if (progress.waited < template.startGraceSeconds) {
    return { kind: 'waiting', waited: progress.waited }
  }
  return { kind: 'abandoned' }
}

/**
 * **The fail-forward rule, in one function.**
 *
 * A contract node whose contract has failed completes by arrival — walk to the site, and
 * the campaign moves on. That site is one of the player's objective sites, so
 * `getRumourReservedRegionIds` already keeps it out of every rumour's stake and out of
 * every raid's reach; a burned shop cannot make this unreachable. The player loses the
 * contract's payout and the event's own reward, and keeps the run.
 *
 * `failForward: false` is not a shipped state. It exists so a control can build one and
 * prove `findContractStrandRisks` says so.
 */
export function isContractNodeCompletableByArrival(
  status: ContractStatus | null,
  template: FactionContractTemplate | null,
): boolean {
  if (status !== 'failed') return false
  return template?.failForward === true
}

/** True while the contract is still the player's to win — the node is not free yet. */
export function isContractLive(status: ContractStatus | null): boolean {
  return status === 'offered' || status === 'active'
}

// --- the campaign-safety gate ----------------------------------------------

export type ContractStrandProblem =
  | 'missingTemplate'
  | 'unboundedClock'
  | 'unboundedStart'
  | 'noFailForward'
  | 'missingNode'
  | 'siteMissing'
  | 'siteUnreserved'
  | 'terminalIncomplete'

export interface ContractStrandRisk {
  /** The faction, contract id or node id at fault. */
  readonly subject: string
  readonly problem: ContractStrandProblem
}

/**
 * Every way a contract could leave a run unfinishable, reported rather than asserted.
 *
 * Written as a function taking its inputs as parameters — the same shape as
 * `findHudCoverageGaps` — because a campaign-safety check that cannot be driven against a
 * mutated table is a check nobody can prove fires. `tests/factionContracts.test.ts` runs it
 * against the shipped tables and then against a template with no clock, a template with no
 * fail-forward, and a graph whose contract site is not reserved, and requires each to be
 * reported.
 *
 * The last check is the load-bearing one and it is a simulation rather than an assertion:
 * every status is driven forward with a driver that never succeeds, and the contract has to
 * reach a state the player can complete within the clock plus the grace. That is what
 * "may never strand a run" means as something a machine can check.
 */
export function findContractStrandRisks(
  blueprint: WorldBlueprint,
  templates: FactionRecord<FactionContractTemplate> = FACTION_CONTRACTS,
  reservedFor: (
    blueprint: WorldBlueprint,
    faction: Faction,
  ) => ReadonlySet<string> = getRumourReservedRegionIds,
): ContractStrandRisk[] {
  const risks: ContractStrandRisk[] = []
  for (const faction of CONTRACT_FACTIONS) {
    const template = templates[faction] as FactionContractTemplate | undefined
    if (!template) {
      risks.push({ subject: faction, problem: 'missingTemplate' })
      continue
    }
    if (!Number.isFinite(template.timeoutSeconds) || template.timeoutSeconds <= 0) {
      risks.push({ subject: template.id, problem: 'unboundedClock' })
    }
    if (!Number.isFinite(template.startGraceSeconds) || template.startGraceSeconds <= 0) {
      risks.push({ subject: template.id, problem: 'unboundedStart' })
    }
    if (template.failForward !== true) {
      risks.push({ subject: template.id, problem: 'noFailForward' })
    }

    const node = findContractNode(blueprint, faction)
    if (!node) {
      risks.push({ subject: faction, problem: 'missingNode' })
      continue
    }
    const site = blueprint.sites.find((candidate) => candidate.id === node.siteId)
    if (!site) {
      risks.push({ subject: node.id, problem: 'siteMissing' })
      continue
    }
    // The second lock, and it is 1.3's: the reserved set is the anchors plus every square
    // holding one of this faction's objective sites, and a contract site that fell outside
    // it could be razed out from under the run.
    //
    // Against a shipped blueprint this can never fire, because a contract node *is* an
    // objective node and `getRumourReservedRegionIds` reserves both its square and its
    // site's. That is the guarantee rather than an excuse to delete the check — the
    // reservation rule is 1.3's and could change without anyone thinking about contracts —
    // so the reserved set is a parameter and `tests/factionContracts.test.ts` drives it
    // with a rule that forgets, which is the only way to prove this branch can report.
    const reserved = reservedFor(blueprint, faction)
    if (
      !reserved.has(String(node.regionId)) ||
      !reserved.has(String(site.regionId))
    ) {
      risks.push({ subject: node.id, problem: 'siteUnreserved' })
    }

    if (!simulateContractAlwaysResolves(node, template)) {
      risks.push({ subject: node.id, problem: 'terminalIncomplete' })
    }
  }
  return risks
}

/**
 * Drives one contract from every status with a driver that never succeeds, and reports
 * whether the player is always left with something they can finish.
 *
 * The frame is a whole second and the horizon is generous on purpose: this is a proof that
 * a bound exists, not a measurement of where it is. It is also *capped*, which is not
 * decoration — a template whose clock is not finite would otherwise put this loop in an
 * infinite one, and a safety check that hangs on the input it exists to reject is worse
 * than one that misses it. A non-finite clock is reported as a risk rather than simulated.
 */
const CONTRACT_SIMULATION_MAX_STEPS = 4_096

function simulateContractAlwaysResolves(
  node: FactionObjectiveNode,
  template: FactionContractTemplate,
): boolean {
  if (
    !Number.isFinite(template.timeoutSeconds) ||
    !Number.isFinite(template.startGraceSeconds)
  ) {
    return false
  }
  for (const start of CONTRACT_STATUSES) {
    if (start === 'kept') continue
    const state = createCampaignContractState()
    const progress = ensureContractProgress(state, node)
    if (!progress) return false
    progress.status = start
    if (start === 'active') progress.remaining = template.timeoutSeconds
    const horizon = Math.min(
      CONTRACT_SIMULATION_MAX_STEPS,
      Math.ceil(template.timeoutSeconds + template.startGraceSeconds) + 4,
    )
    let resolved = start === 'failed'
    for (let second = 0; second < horizon && !resolved; second += 1) {
      const tick = advanceContract(progress, template, 1, true)
      if (tick.kind === 'expired' || tick.kind === 'abandoned') {
        resolveContract(state, node.id, 'failed')
        resolved = true
      }
    }
    if (!resolved) return false
    if (
      !isContractNodeCompletableByArrival(
        getContractStatus(state, node),
        template,
      )
    ) {
      return false
    }
  }
  return true
}

// --- save ownership --------------------------------------------------------

function normalizeContractProgress(value: unknown): ContractProgress | null {
  const record = readRecord(value)
  if (!record) return null
  const nodeId = readId(record.nodeId)
  const contract = record.contract
  const status = record.status
  const remaining = readAmount(record.remaining)
  const waited = readAmount(record.waited)
  const attempts = readCounter(record.attempts)
  if (
    nodeId === null ||
    typeof contract !== 'string' ||
    !(CONTRACT_IDS as readonly string[]).includes(contract) ||
    typeof status !== 'string' ||
    !(CONTRACT_STATUSES as readonly string[]).includes(status) ||
    remaining === null ||
    waited === null ||
    attempts === null
  ) {
    return null
  }
  return {
    nodeId,
    contract: contract as ContractId,
    status: status as ContractStatus,
    remaining,
    waited,
    attempts,
  }
}

/**
 * Reads the campaign board back off a save, dropping anything it does not recognise.
 *
 * Same policy as the hint queue and 1.3's commitments rather than the save-level
 * discard-and-report one: this is a field inside a free-form bag, so a contract written by
 * a build that knew an id this one does not is forgotten, not fatal. A pin naming a node
 * this graph does not have is cleared by `resolveActiveObjectiveNode` on the first frame,
 * which is why the pin is read as a plain id here rather than validated against a blueprint
 * this function does not have.
 */
export function normalizeCampaignContractState(value: unknown): CampaignContractState {
  const record = readRecord(value)
  if (!record) return createCampaignContractState()
  const contracts: ContractProgress[] = []
  if (Array.isArray(record.contracts)) {
    for (const entry of record.contracts) {
      if (contracts.length >= MAX_CONTRACT_ROWS) break
      const progress = normalizeContractProgress(entry)
      if (progress && !contracts.some((existing) => existing.nodeId === progress.nodeId)) {
        contracts.push(progress)
      }
    }
  }
  return { pinnedNodeId: readId(record.pinnedNodeId), contracts }
}

/** The JSON that goes into `directorState`. Bounded by `MAX_CONTRACT_ROWS`. */
export function serializeCampaignContractState(
  state: CampaignContractState,
): Record<string, unknown> {
  return {
    pinnedNodeId: state.pinnedNodeId,
    contracts: state.contracts.map((entry) => ({ ...entry })),
  }
}

