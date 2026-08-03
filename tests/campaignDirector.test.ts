/**
 * Equivalence control for the `world/CampaignDirector.ts` extraction.
 *
 * Objectives, the world-event director's policy and the chronicle commitments were lifted
 * out of `GameEngine`'s main loop so a headless run harness could drive a campaign. As
 * with `tests/actorAi.test.ts` and `tests/combatResolver.test.ts`, the engine methods
 * cannot be called directly — `GameEngine` needs a WebGL context — so this file
 * re-implements the **pre-extraction** engine code inline and asserts the extracted
 * functions agree with it over a large randomised sample.
 *
 * Two of the re-implementations below are the *deleted duplicate*, not the survivor:
 * `createGeneratedObjectives` existed character-for-character in both `GameEngine` and
 * `App.tsx`, and this file keeps App's copy so the surviving function is pinned against
 * the one the HUD used to show before the engine ever ran. If they had disagreed, a player
 * would have seen one objective list on launch and a different one a frame later.
 *
 * Each block has a negative control: a plausible wrong variant, asserted to disagree.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import { createGeneratedObjectiveText } from '../src/game/content/gameCopy.ts'
import type { Faction, Objective, RandomWorldEventKind } from '../src/game/types.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import {
  CHRONICLE_TICK_SECONDS,
  type ChronicleEvent,
  type ChronicleEventKind,
} from '../src/game/world/Chronicle.ts'
import type { FactionObjectiveNode, WorldBlueprint } from '../src/game/world/worldTypes.ts'
import {
  CHRONICLE_FEED_LIMIT,
  CHRONICLE_MAX_ANNOUNCEMENTS,
  CHRONICLE_MAX_CATCHUP_TICKS,
  advanceEventTimer,
  buildChronicleFeedSignature,
  campaignObjectivesComplete,
  commitChronicleTicks,
  completeObjectiveEntry,
  createGeneratedObjectives,
  enemyDamageMultiplier,
  enemyHealthMultiplier,
  eventCooldownRange,
  getActiveObjectiveNode,
  isObjectiveDone,
  isSalientChronicleEvent,
  isWithinObjectiveArrival,
  objectivePrerequisitesDone,
  playerObjectiveRatio,
  rollEventCooldown,
  selectChronicleAnnouncements,
  selectChronicleFeedEvents,
  selectWeightedEventKind,
  shouldHandBackForStreaming,
  threatWaveInterval,
  type DirectedEvent,
} from '../src/game/world/CampaignDirector.ts'

const FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']

const CHRONICLE_EVENT_KINDS: readonly ChronicleEventKind[] = [
  'regionCaptured',
  'raidRepelled',
  'beastRaid',
  'beastsRepelled',
  'settlementBurned',
  'caravanLost',
  'caravanArrived',
]

// ---------------------------------------------------------------------------
// The pre-extraction code, copied verbatim
// ---------------------------------------------------------------------------

/**
 * `App.tsx`'s deleted `createGeneratedObjectives`, exactly as it stood. The engine's copy
 * was the same expression with the node list threaded in from a different place, so
 * pinning against this one pins both.
 */
function legacyAppObjectives(blueprint: WorldBlueprint, faction: Faction) {
  return blueprint.objectives[faction].nodes.map((node) => {
    const site = blueprint.sites.find((candidate) => candidate.id === node.siteId)
    return {
      id: node.id,
      text: createGeneratedObjectiveText(node.kind, site?.kind),
      done: false,
      // Roadmap 2.1 — the one field the persisted objective gained at build time. The
      // equivalence this file exists to hold is about the *text*: the deleted `App.tsx`
      // copy and the surviving builder must name the same nodes with the same words. That
      // claim is unchanged; carrying the flag here keeps the comparison exact rather than
      // loosening it to ignore a field.
      ...(node.optional === true ? { optional: true } : {}),
    }
  })
}

/** `GameEngine.isObjectiveDone`. */
function legacyIsObjectiveDone(objectives: readonly Objective[], id: string): boolean {
  return objectives.some((objective) => objective.id === id && objective.done)
}

/** `GameEngine.generatedPrerequisitesDone`. */
function legacyPrerequisitesDone(
  node: FactionObjectiveNode,
  objectives: readonly Objective[],
): boolean {
  return node.prerequisiteIds.every((id) => legacyIsObjectiveDone(objectives, id))
}

/** `GameEngine.getActiveGeneratedObjective`, `.find()` semantics and all. */
function legacyActiveObjective(
  blueprint: WorldBlueprint,
  faction: Faction,
  objectives: readonly Objective[],
): FactionObjectiveNode | null {
  const graph = blueprint.objectives[faction]
  return (
    graph.nodes.find(
      (node) =>
        !legacyIsObjectiveDone(objectives, node.id) &&
        legacyPrerequisitesDone(node, objectives),
    ) ?? null
  )
}

/** `GameEngine.eventCooldownRange`. */
function legacyCooldownRange(threatTier: number): { min: number; max: number } {
  const tierOffset = threatTier - 1
  return {
    min: Math.max(30, 50 - tierOffset * 5),
    max: Math.max(42, 70 - tierOffset * 7),
  }
}

/** `GameEngine.threatWaveInterval`. */
function legacyThreatWaveInterval(threatTier: number): number {
  return Math.max(70, 130 - threatTier * 12)
}

/** The weighted pick inside `GameEngine.startRandomEvent`. */
function legacySelectEventKind(
  eligibleKinds: readonly RandomWorldEventKind[],
  weightOf: (kind: RandomWorldEventKind) => number,
  sample: number,
): RandomWorldEventKind | null {
  if (eligibleKinds.length === 0) return null
  const totalWeight = eligibleKinds.reduce((total, kind) => total + weightOf(kind), 0)
  let roll = sample * totalWeight
  let selected = eligibleKinds[eligibleKinds.length - 1]
  for (const kind of eligibleKinds) {
    roll -= weightOf(kind)
    if (roll <= 0) {
      selected = kind
      break
    }
  }
  return selected
}

type LegacyEventAction = 'handBack' | 'fail' | 'run'

/** The live-event branch of `GameEngine.updateEvents`, with the callbacks removed. */
function legacyDirectEvent(
  event: DirectedEvent,
  delta: number,
  isRegionSimulated: (regionId: string | null) => boolean,
): { action: LegacyEventAction; timer: number | null } {
  if (event.anchor === 'located' && !isRegionSimulated(event.regionId)) {
    return { action: 'handBack', timer: event.timer }
  }
  if (event.timer === null) return { action: 'run', timer: null }
  const timer = Math.max(0, event.timer - delta)
  if (timer <= 0) {
    if (event.anchor === 'located') return { action: 'handBack', timer }
    return { action: 'fail', timer }
  }
  return { action: 'run', timer }
}

/** The accumulator loop from `GameEngine.updateChronicle`. */
function legacyCommitTicks(
  accumulator: number,
  delta: number,
): { ticks: number; accumulator: number } {
  let carried = accumulator + delta
  if (carried < CHRONICLE_TICK_SECONDS) return { ticks: 0, accumulator: carried }
  let ticks = 0
  while (carried >= CHRONICLE_TICK_SECONDS && ticks < 8) {
    carried -= CHRONICLE_TICK_SECONDS
    ticks += 1
  }
  if (carried >= CHRONICLE_TICK_SECONDS) carried = 0
  return { ticks, accumulator: carried }
}

/** The announcement loop from `GameEngine.handleChronicleEvents`. */
function legacyAnnouncements(
  events: readonly ChronicleEvent[],
  discovered: ReadonlySet<string>,
): ChronicleEvent[] {
  const announcedEvents: ChronicleEvent[] = []
  let announced = 0
  for (const event of events) {
    const regionId = String(event.regionId)
    const salient =
      event.kind === 'settlementBurned' ||
      event.kind === 'regionCaptured' ||
      event.kind === 'caravanLost'
    if (!salient || announced >= 2 || !discovered.has(regionId)) continue
    announced += 1
    announcedEvents.push(event)
  }
  return announcedEvents
}

/** `GameEngine.buildChronicleFeed`'s selection half. */
function legacyFeedEvents(
  log: readonly ChronicleEvent[],
  discovered: ReadonlySet<string>,
): ChronicleEvent[] {
  return log
    .filter((event) => discovered.has(String(event.regionId)))
    .slice(-8)
    .reverse()
}

function buildEvents(rng: RandomStream, count: number): ChronicleEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${index}`,
    tick: index,
    kind: rng.pick(CHRONICLE_EVENT_KINDS),
    regionId: `r${rng.integer(0, 6)}`,
    faction: rng.chance(0.6) ? rng.pick(FACTIONS) : null,
    siteId: rng.chance(0.5) ? `s${index}` : null,
  }))
}

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

test('the surviving objective builder reproduces the deleted App.tsx copy', () => {
  // Seeds chosen to be a wide spread of campaign graphs rather than a run of neighbours.
  let comparisons = 0
  let nodes = 0
  for (let index = 0; index < 120; index += 1) {
    const blueprint = generateWorld(1_000 + index * 977)
    for (const faction of FACTIONS) {
      const expected = legacyAppObjectives(blueprint, faction)
      const actual = createGeneratedObjectives(blueprint, faction)
      assert.deepEqual(actual, expected, `seed ${index}, ${faction}`)
      comparisons += 1
      nodes += actual.length
    }
  }
  assert.equal(comparisons, 360)
  // A campaign with no nodes would make the agreement vacuous.
  assert.ok(nodes > 1_000, `expected real objective graphs, got ${nodes} nodes`)
})

test('every shipped campaign graph lists prerequisites before the nodes that need them', () => {
  // Measured rather than assumed, because it is the reason `getActiveObjectiveNode`'s
  // prerequisite gate never changes the answer on a shipped seed: with a topologically
  // ordered node array the first not-done node always has its prerequisites satisfied.
  // A future generator that emits a different order would change what the HUD shows, and
  // this is the assertion that would notice.
  let nodes = 0
  let nodesWithPrerequisites = 0
  for (let index = 0; index < 140; index += 1) {
    const blueprint = generateWorld(7_000 + index * 613)
    for (const faction of FACTIONS) {
      const seen = new Set<string>()
      for (const node of blueprint.objectives[faction].nodes) {
        for (const prerequisiteId of node.prerequisiteIds) {
          assert.ok(
            seen.has(prerequisiteId),
            `seed ${index}, ${faction}: ${node.id} needs ${prerequisiteId}, listed later`,
          )
        }
        if (node.prerequisiteIds.length > 0) nodesWithPrerequisites += 1
        seen.add(node.id)
        nodes += 1
      }
    }
  }
  assert.ok(nodes > 1_000, `expected real graphs, got ${nodes} nodes`)
  assert.ok(
    nodesWithPrerequisites > 500,
    `an order claim about graphs with no edges is vacuous, got ${nodesWithPrerequisites}`,
  )
})

test('objective traversal matches the engine code it replaced', () => {  let comparisons = 0
  let activeFound = 0
  let blockedByPrerequisite = 0

  for (let index = 0; index < 140; index += 1) {
    const blueprint = generateWorld(7_000 + index * 613)
    for (const faction of FACTIONS) {
      const rng = new RandomStream(deriveSeed('campaign-director', `objectives-${index}-${faction}`))
      const objectives = createGeneratedObjectives(blueprint, faction)
      // Walk the graph forward through a randomised completion order, checking agreement
      // at every step rather than only on a fresh list.
      for (let step = 0; step < 12; step += 1) {
        const expected = legacyActiveObjective(blueprint, faction, objectives)
        const actual = getActiveObjectiveNode(blueprint, faction, objectives)
        assert.equal(actual?.id ?? null, expected?.id ?? null, `step ${step}`)
        comparisons += 1
        if (actual) activeFound += 1

        for (const node of blueprint.objectives[faction].nodes) {
          assert.equal(
            objectivePrerequisitesDone(node, objectives),
            legacyPrerequisitesDone(node, objectives),
            `prerequisites ${node.id}`,
          )
          assert.equal(
            isObjectiveDone(objectives, node.id),
            legacyIsObjectiveDone(objectives, node.id),
            `done ${node.id}`,
          )
          comparisons += 2
          if (
            !isObjectiveDone(objectives, node.id) &&
            !objectivePrerequisitesDone(node, objectives)
          ) {
            blockedByPrerequisite += 1
          }
        }

        // Complete a random pending objective — sometimes out of order, which is what
        // makes the prerequisite gate observable.
        const pending = objectives.filter((objective) => !objective.done)
        if (pending.length === 0) break
        completeObjectiveEntry(objectives, rng.pick(pending).id)
      }
      assert.equal(
        campaignObjectivesComplete(objectives),
        objectives.every((objective) => objective.done),
      )
    }
  }

  assert.ok(comparisons > 10_000, `expected a large sample, got ${comparisons}`)
  assert.ok(activeFound > 500, `expected live objectives, got ${activeFound}`)
  assert.ok(
    blockedByPrerequisite > 500,
    `expected the prerequisite gate to bite, got ${blockedByPrerequisite}`,
  )
})

test('completing an objective is idempotent and reports whether it did anything', () => {
  const objectives: Objective[] = [
    { id: 'a', text: 'first', done: false },
    { id: 'b', text: 'second', done: false, progress: 0, target: 3 },
  ]
  assert.equal(completeObjectiveEntry(objectives, 'missing'), null)
  const first = completeObjectiveEntry(objectives, 'a')
  assert.equal(first?.id, 'a')
  assert.equal(
    completeObjectiveEntry(objectives, 'a'),
    null,
    'a second completion must not re-announce or re-score',
  )
  const second = completeObjectiveEntry(objectives, 'b')
  assert.equal(second?.progress, 3, 'a counted objective is filled to its target')
})

test('arrival radius matches the engine literal it replaced', () => {
  const rng = new RandomStream(deriveSeed('campaign-director', 'arrival'))
  let inside = 0
  let outside = 0
  for (let trial = 0; trial < 5_000; trial += 1) {
    const px = rng.range(-30, 30)
    const pz = rng.range(-30, 30)
    const sx = rng.range(-30, 30)
    const sz = rng.range(-30, 30)
    const actual = isWithinObjectiveArrival(px, pz, sx, sz)
    assert.equal(actual, Math.hypot(sx - px, sz - pz) <= 8, `trial ${trial}`)
    if (actual) inside += 1
    else outside += 1
  }
  assert.ok(inside > 100 && outside > 100, `both sides must occur: ${inside}/${outside}`)
})

// ---------------------------------------------------------------------------
// Event director
// ---------------------------------------------------------------------------

test('event pacing matches the engine code it replaced', () => {
  for (let tier = 1; tier <= 8; tier += 1) {
    assert.deepEqual(eventCooldownRange(tier), legacyCooldownRange(tier), `tier ${tier}`)
    assert.equal(threatWaveInterval(tier), legacyThreatWaveInterval(tier), `wave ${tier}`)
    for (const hostileToPlayer of [true, false]) {
      assert.equal(
        enemyHealthMultiplier(tier, hostileToPlayer),
        hostileToPlayer ? 1 + (tier - 1) * 0.12 : 1,
      )
      assert.equal(
        enemyDamageMultiplier(tier, hostileToPlayer),
        hostileToPlayer ? 1 + (tier - 1) * 0.09 : 1,
      )
    }
  }
  // Both floors bite, and they bite at different tiers, which is the reason the range is
  // two numbers rather than one scaled pair.
  assert.equal(eventCooldownRange(5).min, 30)
  assert.equal(eventCooldownRange(5).max, 42)
  assert.equal(threatWaveInterval(5), 70)

  const rng = new RandomStream(deriveSeed('campaign-director', 'cooldown'))
  for (let trial = 0; trial < 2_000; trial += 1) {
    const tier = rng.integer(1, 6)
    const roll = rng.next()
    const range = legacyCooldownRange(tier)
    assert.equal(
      rollEventCooldown(tier, roll),
      range.min + roll * (range.max - range.min),
      `trial ${trial}`,
    )
  }
})

test('weighted event selection matches the engine code it replaced', () => {
  const kinds: readonly RandomWorldEventKind[] = [
    'richCaravan',
    'defendHome',
    'champion',
    'rescue',
    'bounty',
  ]
  let comparisons = 0
  const picked = new Set<RandomWorldEventKind>()

  for (let trial = 0; trial < 2_500; trial += 1) {
    const rng = new RandomStream(deriveSeed('campaign-director', `weights-${trial}`))
    const weights = new Map<RandomWorldEventKind, number>(
      kinds.map((kind) => [kind, rng.integer(1, 9)]),
    )
    const weightOf = (kind: RandomWorldEventKind): number => weights.get(kind) ?? 0
    const eligible = kinds.filter(() => rng.chance(0.7))
    const roll = rng.next()
    const expected = legacySelectEventKind(eligible, weightOf, roll)
    const actual = selectWeightedEventKind(eligible, weightOf, roll)
    assert.equal(actual, expected, `trial ${trial}, eligible ${eligible.join(',')}`)
    comparisons += 1
    if (actual) picked.add(actual)
  }

  assert.ok(comparisons >= 2_500)
  assert.equal(picked.size, kinds.length, 'every kind must be reachable')
  assert.equal(selectWeightedEventKind([], () => 1, 0.5), null)
})

test('the weighted fallback arm is real, rare, and returns the last eligible kind', () => {
  // Measured, not assumed. The post-loop fallback looks like dead code — for exact
  // arithmetic the running subtraction is always <= 0 by the final iteration — but with
  // a huge total weight and a roll just under one, the subtractions do not exactly reach
  // the product and a tiny positive remainder survives. That is the case the engine's
  // `let selected = last` default existed for, and it is rare enough that a uniform
  // random sample of a few thousand draws finds only a handful. So it is provoked here on
  // purpose, and the fallback's *identity* is pinned: last, not first.
  const kinds: readonly RandomWorldEventKind[] = [
    'richCaravan',
    'defendHome',
    'champion',
    'rescue',
    'bounty',
  ]
  let loopReturns = 0
  let fallbackReturns = 0

  const drift = [1 - Number.EPSILON, 1 - Number.EPSILON / 2, 1, 0.9999999999999999]
  const magnitudes = [1e6, 1e9, 1e12, 1e15, 7.3e13, 3.1e11]
  const rng = new RandomStream(deriveSeed('campaign-director', 'fallback'))

  for (let trial = 0; trial < 6_000; trial += 1) {
    const nearOne = trial % 3 !== 0
    const roll = nearOne ? drift[trial % drift.length] : rng.next()
    const scale = magnitudes[trial % magnitudes.length]
    const weights = kinds.map(() =>
      nearOne ? rng.range(scale / 3, scale) : rng.range(1, 9),
    )
    const weightOf = (kind: RandomWorldEventKind): number =>
      weights[kinds.indexOf(kind)] ?? 0
    const eligible = kinds.filter(() => rng.chance(0.75))
    if (eligible.length === 0) continue

    const total = eligible.reduce((sum, kind) => sum + weightOf(kind), 0)
    let remaining = roll * total
    let returnedInLoop = false
    for (const kind of eligible) {
      remaining -= weightOf(kind)
      if (remaining <= 0) {
        returnedInLoop = true
        break
      }
    }
    if (returnedInLoop) {
      loopReturns += 1
    } else {
      fallbackReturns += 1
      assert.equal(
        selectWeightedEventKind(eligible, weightOf, roll),
        eligible[eligible.length - 1],
        `the fallback must pick the last eligible kind, trial ${trial}`,
      )
      assert.equal(
        selectWeightedEventKind(eligible, weightOf, roll),
        legacySelectEventKind(eligible, weightOf, roll),
        `the fallback must match the engine, trial ${trial}`,
      )
    }
  }

  assert.ok(loopReturns > 1_000, `expected a large sample, got ${loopReturns}`)
  assert.ok(
    fallbackReturns > 0,
    'the fallback arm must be exercised, or mutating it would be invisible',
  )
})

test('the event timer decision matches the engine code it replaced', () => {
  let comparisons = 0
  let handBacks = 0
  let expiries = 0
  let clockless = 0

  for (let trial = 0; trial < 6_000; trial += 1) {
    const rng = new RandomStream(deriveSeed('campaign-director', `timer-${trial}`))
    const event: DirectedEvent = {
      anchor: rng.chance(0.5) ? 'located' : 'player',
      state: 'active',
      timer: rng.chance(0.25) ? null : rng.range(0, 4),
      regionId: rng.chance(0.9) ? `r${rng.integer(0, 4)}` : null,
    }
    const simulated = new Set(['r0', 'r1'])
    const isRegionSimulated = (regionId: string | null): boolean =>
      regionId !== null && simulated.has(regionId)
    const delta = rng.range(0, 2)

    const expected = legacyDirectEvent(event, delta, isRegionSimulated)
    const streamedOut = shouldHandBackForStreaming(event, isRegionSimulated)
    if (streamedOut) {
      assert.equal(expected.action, 'handBack', `trial ${trial}`)
      handBacks += 1
    } else {
      const direction = advanceEventTimer(event, delta)
      if (direction === null) {
        assert.equal(expected.action, 'run', `clockless, trial ${trial}`)
        assert.equal(expected.timer, null)
        clockless += 1
      } else {
        assert.equal(direction.timer, expected.timer, `timer, trial ${trial}`)
        const mapped =
          direction.kind === 'running'
            ? 'run'
            : direction.kind === 'handBack'
              ? 'handBack'
              : 'fail'
        assert.equal(mapped, expected.action, `action, trial ${trial}`)
        if (mapped === 'handBack') handBacks += 1
        if (mapped === 'fail') expiries += 1
      }
    }
    comparisons += 1
  }

  assert.ok(comparisons >= 6_000)
  assert.ok(handBacks > 200, `expected hand-backs, got ${handBacks}`)
  assert.ok(expiries > 200, `expected player-anchored expiries, got ${expiries}`)
  assert.ok(clockless > 200, `expected clockless events, got ${clockless}`)
})

// ---------------------------------------------------------------------------
// Chronicle commitments
// ---------------------------------------------------------------------------

test('the chronicle tick accumulator matches the engine code it replaced', () => {
  let comparisons = 0
  let multiTickFrames = 0
  let cappedFrames = 0

  for (let trial = 0; trial < 400; trial += 1) {
    const rng = new RandomStream(deriveSeed('campaign-director', `ticks-${trial}`))
    let legacyAccumulator = 0
    let actualAccumulator = 0
    for (let frame = 0; frame < 200; frame += 1) {
      // Ordinary frame deltas, plus the occasional restored-tab stall that is the whole
      // reason the catch-up cap exists.
      const delta = rng.chance(0.03) ? rng.range(20, 400) : rng.range(0.004, 0.05)
      const expected = legacyCommitTicks(legacyAccumulator, delta)
      const actual = commitChronicleTicks(actualAccumulator, delta)
      assert.equal(actual.ticks, expected.ticks, `trial ${trial}, frame ${frame}`)
      assert.ok(
        Math.abs(actual.accumulator - expected.accumulator) < 1e-12,
        `accumulator, trial ${trial}, frame ${frame}`,
      )
      legacyAccumulator = expected.accumulator
      actualAccumulator = actual.accumulator
      comparisons += 1
      if (actual.ticks > 1) multiTickFrames += 1
      if (actual.ticks === CHRONICLE_MAX_CATCHUP_TICKS) cappedFrames += 1
    }
  }

  assert.ok(comparisons > 10_000, `expected a large sample, got ${comparisons}`)
  assert.ok(multiTickFrames > 100, `expected catch-up frames, got ${multiTickFrames}`)
  assert.ok(cappedFrames > 100, `expected the cap to bite, got ${cappedFrames}`)
})

test('a capped catch-up drops the backlog rather than carrying it', () => {
  // The property the extraction has to keep: after a very long stall the next frame runs
  // one tick, not another eight. Carrying the remainder would make a restored tab burn a
  // settlement per frame for a minute.
  const stalled = commitChronicleTicks(0, CHRONICLE_TICK_SECONDS * 40)
  assert.equal(stalled.ticks, CHRONICLE_MAX_CATCHUP_TICKS)
  assert.equal(stalled.accumulator, 0)
  const next = commitChronicleTicks(stalled.accumulator, CHRONICLE_TICK_SECONDS)
  assert.equal(next.ticks, 1)
})

test('chronicle announcements and the feed match the engine code they replaced', () => {
  let comparisons = 0
  let announcedTotal = 0
  let hiddenSalient = 0
  let cappedBatches = 0

  for (let trial = 0; trial < 900; trial += 1) {
    const rng = new RandomStream(deriveSeed('campaign-director', `feed-${trial}`))
    const events = buildEvents(rng, rng.integer(1, 14))
    const discovered = new Set(
      ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'].filter(() => rng.chance(0.5)),
    )

    const expectedAnnounced = legacyAnnouncements(events, discovered)
    const actualAnnounced = selectChronicleAnnouncements(events, discovered)
    assert.deepEqual(
      actualAnnounced.map((event) => event.id),
      expectedAnnounced.map((event) => event.id),
      `announcements, trial ${trial}`,
    )
    comparisons += 1
    announcedTotal += actualAnnounced.length
    if (actualAnnounced.length === CHRONICLE_MAX_ANNOUNCEMENTS) cappedBatches += 1
    hiddenSalient += events.filter(
      (event) =>
        isSalientChronicleEvent(event.kind) && !discovered.has(String(event.regionId)),
    ).length

    const log = buildEvents(rng, rng.integer(0, 30))
    assert.deepEqual(
      selectChronicleFeedEvents(log, discovered).map((event) => event.id),
      legacyFeedEvents(log, discovered).map((event) => event.id),
      `feed, trial ${trial}`,
    )
    assert.ok(selectChronicleFeedEvents(log, discovered).length <= CHRONICLE_FEED_LIMIT)
    comparisons += 1

    assert.equal(
      buildChronicleFeedSignature(trial, discovered.size, log),
      `${trial}:${discovered.size}:${log.length}:${log[log.length - 1]?.id ?? ''}`,
      `signature, trial ${trial}`,
    )
    comparisons += 1
  }

  assert.ok(comparisons > 2_500, `expected a large sample, got ${comparisons}`)
  assert.ok(announcedTotal > 200, `expected real announcements, got ${announcedTotal}`)
  assert.ok(cappedBatches > 50, `expected the two-line cap to bite, got ${cappedBatches}`)
  // The number the run harness reports as event exposure exists because of this: salient
  // history routinely resolves in regions the player has never seen.
  assert.ok(hiddenSalient > 200, `expected fog-hidden history, got ${hiddenSalient}`)
})

test('the feed signature notices a discovery that changes nothing else', () => {
  // The case the cache key exists for: revealing a region changes which past events are
  // visible without changing the tick or the log length.
  const log: ChronicleEvent[] = [
    { id: 'e1', tick: 1, kind: 'regionCaptured', regionId: 'r0', faction: 'elf', siteId: null },
  ]
  const before = buildChronicleFeedSignature(4, 1, log)
  const after = buildChronicleFeedSignature(4, 2, log)
  assert.notEqual(before, after)
})

test('the objective ratio the chronicle reads matches the engine expression', () => {
  assert.equal(playerObjectiveRatio([]), 0, 'an empty campaign is not a finished one')
  const rng = new RandomStream(deriveSeed('campaign-director', 'ratio'))
  for (let trial = 0; trial < 2_000; trial += 1) {
    const objectives: Objective[] = Array.from(
      { length: rng.integer(1, 12) },
      (_, index) => ({ id: `o${index}`, text: `o${index}`, done: rng.chance(0.5) }),
    )
    assert.equal(
      playerObjectiveRatio(objectives),
      objectives.filter((objective) => objective.done).length / objectives.length,
      `trial ${trial}`,
    )
  }
})

// ---------------------------------------------------------------------------
// Negative controls
// ---------------------------------------------------------------------------

test('a deliberately wrong director implementation is caught by the same comparisons', () => {
  let objectiveDisagreements = 0
  let activeDisagreements = 0
  let tickDisagreements = 0
  let announcementDisagreements = 0
  let feedDisagreements = 0
  let weightDisagreements = 0
  let timerDisagreements = 0

  for (let trial = 0; trial < 120; trial += 1) {
    const blueprint = generateWorld(31_000 + trial * 449)
    const rng = new RandomStream(deriveSeed('campaign-director', `negative-${trial}`))

    // 1. "The site lookup is redundant, the kind is enough." Drops the site-specific copy.
    for (const faction of FACTIONS) {
      const correct = createGeneratedObjectives(blueprint, faction)
      const wrong = blueprint.objectives[faction].nodes.map((node) => ({
        id: node.id,
        text: createGeneratedObjectiveText(node.kind),
        done: false,
      }))
      if (JSON.stringify(correct) !== JSON.stringify(wrong)) objectiveDisagreements += 1
    }

    // 2. "Prerequisites are implied by order." Drops the gate.
    //
    // On the shipped graphs this is measurably a no-op, and that is worth writing down:
    // `objectiveOrder` above proves every node's prerequisites appear earlier in the
    // array, so the first not-done node always has its prerequisites satisfied and the
    // two rules agree by construction. The gate earns its place against a *future*
    // generator that emits nodes in a different order, so the control is built on a list
    // in that order rather than on a blueprint that cannot produce one.
    const outOfOrder: FactionObjectiveNode[] = [
      { id: 'second', kind: 'defeat', siteId: 's2', regionId: 'r1', prerequisiteIds: ['first'] },
      { id: 'first', kind: 'arrive', siteId: 's1', regionId: 'r0', prerequisiteIds: [] },
    ]
    const pendingBoth: Objective[] = [
      { id: 'second', text: 'second', done: false },
      { id: 'first', text: 'first', done: false },
    ]
    const gated =
      outOfOrder.find(
        (node) =>
          !isObjectiveDone(pendingBoth, node.id) &&
          objectivePrerequisitesDone(node, pendingBoth),
      ) ?? null
    const ungated =
      outOfOrder.find((node) => !isObjectiveDone(pendingBoth, node.id)) ?? null
    if ((gated?.id ?? null) !== (ungated?.id ?? null)) activeDisagreements += 1

    // 3. "The catch-up cap is paranoid, carry the remainder." Restores the backlog bug.
    const stall = rng.range(60, 400)
    const correctTicks = commitChronicleTicks(0, stall)
    const wrongTicks = {
      ticks: Math.floor(stall / CHRONICLE_TICK_SECONDS),
      accumulator: stall % CHRONICLE_TICK_SECONDS,
    }
    if (
      correctTicks.ticks !== wrongTicks.ticks ||
      correctTicks.accumulator !== wrongTicks.accumulator
    ) {
      tickDisagreements += 1
    }

    // 4. "Fog of war should not hide the news." Drops the discovered gate.
    const events = buildEvents(rng, 12)
    const discovered = new Set(['r0', 'r1'])
    const correctAnnounced = selectChronicleAnnouncements(events, discovered)
    const wrongAnnounced = events
      .filter((event) => isSalientChronicleEvent(event.kind))
      .slice(0, CHRONICLE_MAX_ANNOUNCEMENTS)
    if (
      correctAnnounced.map((event) => event.id).join(',') !==
      wrongAnnounced.map((event) => event.id).join(',')
    ) {
      announcementDisagreements += 1
    }

    // 5. "Newest last reads fine." Drops the reverse.
    const log = buildEvents(rng, 20)
    const correctFeed = selectChronicleFeedEvents(log, discovered)
    const wrongFeed = log
      .filter((event) => discovered.has(String(event.regionId)))
      .slice(-CHRONICLE_FEED_LIMIT)
    if (
      correctFeed.map((event) => event.id).join(',') !==
      wrongFeed.map((event) => event.id).join(',')
    ) {
      feedDisagreements += 1
    }

    // 6. "The weights are cosmetic, pick uniformly."
    const kinds: readonly RandomWorldEventKind[] = [
      'richCaravan',
      'defendHome',
      'champion',
      'rescue',
      'bounty',
    ]
    const skewed = (kind: RandomWorldEventKind): number =>
      kind === 'bounty' ? 20 : 1
    const roll = rng.next()
    if (
      selectWeightedEventKind(kinds, skewed, roll) !==
      selectWeightedEventKind(kinds, () => 1, roll)
    ) {
      weightDisagreements += 1
    }

    // 7. "An expired event is an expired event." Drops the located hand-back.
    const expiring: DirectedEvent = {
      anchor: 'located',
      state: 'active',
      timer: 0.01,
      regionId: 'r0',
    }
    const direction = advanceEventTimer(expiring, 1)
    if (direction?.kind !== 'expired') timerDisagreements += 1
  }

  assert.ok(
    objectiveDisagreements > 0,
    'the objective comparison must detect dropped site copy',
  )
  assert.ok(
    activeDisagreements > 0,
    'the traversal comparison must detect a dropped prerequisite gate',
  )
  assert.ok(
    tickDisagreements > 0,
    'the accumulator comparison must detect a carried backlog',
  )
  assert.ok(
    announcementDisagreements > 0,
    'the announcement comparison must detect a dropped fog gate',
  )
  assert.ok(feedDisagreements > 0, 'the feed comparison must detect a dropped reverse')
  assert.ok(
    weightDisagreements > 0,
    'the selection comparison must detect flattened weights',
  )
  assert.ok(
    timerDisagreements > 0,
    'a located event must hand back rather than fail when its clock runs out',
  )
})
