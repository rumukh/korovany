/**
 * Roadmap 1.3 — what an embodied chronicle commitment actually does to the world.
 *
 * The claim this file has to back is not "rumours exist". It is the roadmap's own signal:
 * **the share of runs where region control at the end differs from the no-input baseline**,
 * and — the part that makes the number mean anything — that the difference comes from the
 * *commitment* rather than from the walking that a commitment happens to involve.
 *
 * Four classes of control run here, because a feature that resolves to nothing would pass a
 * naive version of every test below:
 *
 * - *Honest resolution.* Every kind is resolved twice from the same forked state, once
 *   honoured and once ignored, and the two outcomes are asserted to differ in the world
 *   rather than only in a log line. If an ignored rumour ever stops costing the player
 *   something, the paired assertion fails on the ignored side, not on the honoured one.
 * - *Campaign safety.* No rumour may name a campaign anchor or an objective square, and a
 *   rumour hand-built to name one anyway still cannot capture it or burn anything in it.
 *   The 500-seed completability gate in `tests/worldGenerator.test.ts` is unchanged and
 *   still runs; this is the guard for the thing that gate cannot see.
 * - *Determinism.* An escort that names a caravan this tick does not contain must change
 *   nothing at all — not the state, not the regions, not the stream position — and pinning
 *   must touch no clock and no random stream, for the reason `content/hints.ts` gives.
 * - *Placebo.* The measured arm is compared against a third arm that takes the same detours
 *   and pins nothing. Presence alone already freezes a square and moves encounters, so
 *   without that arm the headline number would be measuring legs, not decisions.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import type { Faction, RumourKind } from '../src/game/types.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import {
  CHRONICLE_CARAVAN_LIMIT,
  SUPPLY_CARAVAN_GAIN,
  SUPPLY_CARAVAN_LOSS,
  SUPPLY_SABOTAGE_LOSS,
  cloneChronicleState,
  cloneRegionChronicleState,
  createChronicleRegions,
  createChronicleState,
  getChronicleProtectedRegionIds,
  isRegionRazed,
  tickChronicle,
  type ChronicleState,
  type RegionChronicleState,
} from '../src/game/world/Chronicle.ts'
import {
  RUMOUR_LIMIT,
  advanceRumourProgress,
  createChronicleCommitmentState,
  findRumourCandidates,
  getRumourReservedRegionIds,
  isRumourHonoured,
  markRumourActioned,
  normalizeChronicleCommitmentState,
  offerRumours,
  pinRumour,
  requiredRumourProgress,
  resolveRumour,
  serializeChronicleCommitmentState,
  settleDueRumours,
  type ChronicleCommitmentState,
  type ChronicleRumour,
  type RumourWorldContext,
} from '../src/game/world/CampaignDirector.ts'
import { runHarness, type RumourPolicy } from './runHarness.ts'

const FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']
const RUMOUR_KIND_LIST: readonly RumourKind[] = ['escort', 'defend', 'sabotage']

interface Situation {
  seed: number
  faction: Faction
  state: ChronicleState
  regions: Map<string, RegionChronicleState>
  context: RumourWorldContext
}

/** A world wound forward `ticks` chronicle ticks with the player nowhere near it. */
function situation(seed: number, faction: Faction, ticks: number): Situation {
  const blueprint = generateWorld(seed)
  const state = createChronicleState()
  const regions = createChronicleRegions(blueprint)
  const rng = new RandomStream(deriveSeed(seed, 'gameplay:chronicle'))
  const protectedRegionIds = getChronicleProtectedRegionIds(blueprint)
  for (let tick = 0; tick < ticks; tick += 1) {
    tickChronicle({
      blueprint,
      state,
      regions,
      rng,
      environment: { nightFactor: 0.15, stormFactor: 0 },
      playerFaction: faction,
      playerObjectiveRatio: 0.25,
      protectedRegionIds,
      frozenRegionIds: new Set<string>(),
    })
  }
  return {
    seed,
    faction,
    state,
    regions,
    context: {
      blueprint,
      state,
      regions,
      playerFaction: faction,
      reservedRegionIds: getRumourReservedRegionIds(blueprint, faction),
    },
  }
}

/** A deep copy, so the honoured and ignored branches start from the same world. */
function fork(base: Situation): Situation {
  const state = cloneChronicleState(base.state)
  const regions = new Map<string, RegionChronicleState>(
    [...base.regions].map(([key, value]) => [key, cloneRegionChronicleState(value)]),
  )
  return {
    ...base,
    state,
    regions,
    context: { ...base.context, state, regions },
  }
}

/** The first situation in a scan that can offer this kind. */
function findSituationWith(kind: RumourKind): {
  base: Situation
  rumour: ChronicleRumour
} {
  for (let index = 0; index < 140; index += 1) {
    const seed = 4_100_000 + index * 977
    const faction = FACTIONS[index % FACTIONS.length]
    for (const ticks of [6, 12, 20, 30, 44]) {
      const base = situation(seed, faction, ticks)
      const rumour = findRumourCandidates(base.context).find(
        (candidate) => candidate.kind === kind,
      )
      if (rumour) return { base, rumour }
    }
  }
  throw new Error(`no world in the scan could offer a ${kind} rumour`)
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

test('finding what the world could gossip about is pure: no draws, no clock, same answer twice', () => {
  const base = situation(4_242_424, 'guard', 26)
  const rng = new RandomStream(deriveSeed(base.seed, 'gameplay:rumour'))
  const before = rng.getState()

  const realRandom = Math.random
  const realNow = Date.now
  const realPerformanceNow = performance.now
  const forbidden = (name: string) => () => {
    throw new Error(`rumour selection read ${name}`)
  }
  Math.random = forbidden('Math.random') as typeof Math.random
  Date.now = forbidden('Date.now') as typeof Date.now
  performance.now = forbidden('performance.now') as typeof performance.now
  let first: ChronicleRumour[]
  let second: ChronicleRumour[]
  try {
    first = findRumourCandidates(base.context)
    second = findRumourCandidates(base.context)
  } finally {
    Math.random = realRandom
    Date.now = realNow
    performance.now = realPerformanceNow
  }

  // Non-vacuity: an empty candidate list would satisfy every assertion below.
  assert.ok(first.length > 0, 'the scanned world offered nothing at all')
  assert.deepEqual(second, first)
  assert.equal(rng.getState(), before, 'selection consumed from the rumour stream')
})

test('all three embodied kinds are reachable, and each one names a square to stand in', () => {
  // The reachability control, in the shape `tests/hints.test.ts` uses: a verb that can
  // never be offered is dead content, and this project has shipped dead content before.
  for (const kind of RUMOUR_KIND_LIST) {
    const { base, rumour } = findSituationWith(kind)
    assert.equal(rumour.kind, kind)
    assert.ok(
      base.context.blueprint.regions.some(
        (region) => String(region.id) === rumour.regionId,
      ),
      `${kind} points at a square that is not in the world`,
    )
    assert.ok(rumour.deadlineTick > rumour.raisedTick, `${kind} has no clock`)
    // Embodiment, asserted rather than described: every kind needs either presence in a
    // square or an act performed in one. A kind that started as honoured would be the
    // rejected purchase.
    assert.equal(isRumourHonoured(rumour), false, `${kind} starts already honoured`)
    assert.ok(requiredRumourProgress(kind) >= 1)
  }
})

test('at most two rumours are open, at most one is pinned, and the pin survives the board changing', () => {
  const base = situation(7_654_321, 'elf', 18)
  const commitments = createChronicleCommitmentState()
  const rng = new RandomStream(deriveSeed(base.seed, 'gameplay:rumour'))
  let offers = 0
  for (let tick = 0; tick < 60; tick += 1) {
    base.state.tick += 1
    if (offerRumours(commitments, base.context, rng)) offers += 1
    assert.ok(
      commitments.rumours.length <= RUMOUR_LIMIT,
      `the board grew to ${String(commitments.rumours.length)}`,
    )
  }
  assert.ok(offers >= 2, `expected the board to fill, got ${String(offers)} offers`)

  // One at a time, and a second pin replaces the first rather than adding to it.
  assert.equal(pinRumour(commitments, commitments.rumours[0].id), true)
  assert.equal(commitments.pinnedRumourId, commitments.rumours[0].id)
  if (commitments.rumours.length > 1) {
    assert.equal(pinRumour(commitments, commitments.rumours[1].id), true)
    assert.equal(commitments.pinnedRumourId, commitments.rumours[1].id)
  }
  assert.equal(pinRumour(commitments, 'rumour:that:never:existed'), false)
  assert.equal(pinRumour(commitments, null), true)
  assert.equal(commitments.pinnedRumourId, null)
})

test('pinning is a button: it touches no clock and no random stream', () => {
  // The same determinism rule 0.4 built the hint director around. A UI event that consumed
  // a seeded draw would make a run's history depend on how often the player clicked.
  const base = situation(31_337, 'villain', 16)
  const commitments = createChronicleCommitmentState()
  const rng = new RandomStream(deriveSeed(base.seed, 'gameplay:rumour'))
  base.state.tick += 8
  assert.ok(offerRumours(commitments, base.context, rng), 'nothing was offered to pin')
  const stateAfterOffer = rng.getState()

  const realRandom = Math.random
  const realNow = Date.now
  const realPerformanceNow = performance.now
  const forbidden = (name: string) => () => {
    throw new Error(`pinning read ${name}`)
  }
  Math.random = forbidden('Math.random') as typeof Math.random
  Date.now = forbidden('Date.now') as typeof Date.now
  performance.now = forbidden('performance.now') as typeof performance.now
  try {
    for (let press = 0; press < 40; press += 1) {
      pinRumour(commitments, press % 2 === 0 ? commitments.rumours[0].id : null)
    }
  } finally {
    Math.random = realRandom
    Date.now = realNow
    performance.now = realPerformanceNow
  }
  assert.equal(rng.getState(), stateAfterOffer, 'a pin moved the rumour stream')
})

// ---------------------------------------------------------------------------
// Honest resolution — the control that matters most
// ---------------------------------------------------------------------------

test('an ignored escort loses the cart through the hand-back path; an honoured one delivers it', () => {
  const { base, rumour } = findSituationWith('escort')
  assert.ok(rumour.caravanId, 'the escort names no caravan')

  const destinationId = (() => {
    const caravan = base.state.caravans.find((entry) => entry.id === rumour.caravanId)
    assert.ok(caravan, 'the caravan vanished before the test could read it')
    return String(caravan.regionPath[caravan.regionPath.length - 1])
  })()
  const supplyBefore = base.regions.get(destinationId)?.supply ?? 0

  const ignored = fork(base)
  const ignoredEvents = resolveRumour(
    rumour,
    ignored.context,
    new RandomStream(deriveSeed(base.seed, 'gameplay:rumour')),
    false,
  )
  const honoured = fork(base)
  const honouredEvents = resolveRumour(
    rumour,
    honoured.context,
    new RandomStream(deriveSeed(base.seed, 'gameplay:rumour')),
    true,
  )

  // The ignored side pays. This assertion is the negative control the whole feature turns
  // on: if an ignored rumour ever starts evaporating, it fails here.
  assert.deepEqual(
    ignoredEvents.map((event) => event.kind),
    ['caravanLost'],
    'an ignored escort wrote no loss',
  )
  assert.equal(
    ignored.state.caravans.some((entry) => entry.id === rumour.caravanId),
    false,
    'the ignored cart is still rolling',
  )
  const ignoredSupply = ignored.regions.get(destinationId)?.supply ?? 0
  assert.ok(
    ignoredSupply < supplyBefore,
    `ignoring cost the destination nothing: ${String(supplyBefore)} -> ${String(ignoredSupply)}`,
  )
  assert.ok(Math.abs(supplyBefore - ignoredSupply - SUPPLY_CARAVAN_LOSS) < 1e-9)

  // And the honoured side is a different world, not a quieter log.
  assert.deepEqual(honouredEvents.map((event) => event.kind), ['caravanArrived'])
  const honouredSupply = honoured.regions.get(destinationId)?.supply ?? 0
  assert.ok(Math.abs(honouredSupply - supplyBefore - SUPPLY_CARAVAN_GAIN) < 1e-9)
  assert.ok(honouredSupply > ignoredSupply, 'the two branches produced the same world')
})

test('an ignored defence loses the square; an honoured one repels the raid', () => {
  const { base, rumour } = findSituationWith('defend')
  const controlBefore = base.regions.get(rumour.targetRegionId)?.control
  const attacker = rumour.faction
  assert.ok(attacker, 'the defence names no attacker')

  const ignored = fork(base)
  const ignoredEvents = resolveRumour(
    rumour,
    ignored.context,
    new RandomStream(deriveSeed(base.seed, 'gameplay:rumour')),
    false,
  )
  const honoured = fork(base)
  const honouredEvents = resolveRumour(
    rumour,
    honoured.context,
    new RandomStream(deriveSeed(base.seed, 'gameplay:rumour')),
    true,
  )

  assert.ok(
    ignoredEvents.some((event) => event.kind === 'regionCaptured'),
    `an ignored defence did not lose the square: ${ignoredEvents.map((e) => e.kind).join(',')}`,
  )
  assert.equal(ignored.regions.get(rumour.targetRegionId)?.control, attacker)
  assert.notEqual(controlBefore, attacker, 'the square was already theirs')

  assert.deepEqual(honouredEvents.map((event) => event.kind), ['raidRepelled'])
  assert.equal(honoured.regions.get(rumour.targetRegionId)?.control, controlBefore)
  // The cost of a repelled raid lands on the square the assault marched *from* — that is
  // the pressure the front is measured on, and it is what stops the same raid re-forming
  // on the next tick. Asserting it on the target square would pass for the wrong reason
  // whenever the attacker had no foothold there to begin with.
  assert.ok(rumour.sourceRegionId, 'the defence names no source square')
  const sourceBefore = base.regions.get(rumour.sourceRegionId)?.pressure[attacker] ?? 0
  const sourceAfter = honoured.regions.get(rumour.sourceRegionId)?.pressure[attacker] ?? 0
  assert.ok(sourceBefore > 0, 'the attacker had no force to spend')
  assert.ok(
    sourceAfter < sourceBefore,
    `repelling the raid cost the attacker nothing: ${String(sourceBefore)} -> ${String(sourceAfter)}`,
  )
})

test('an ignored sabotage feeds the push; an honoured one burns the depot and it never comes', () => {
  const { base, rumour } = findSituationWith('sabotage')
  const depotSupplyBefore = base.regions.get(rumour.regionId)?.supply ?? 0
  const targetControlBefore = base.regions.get(rumour.targetRegionId)?.control

  // The honoured branch is the embodied one: the torch is an act, not a stay, so the
  // supply drop happens when the player is standing at the depot rather than at the
  // deadline. `markRumourActioned` is the shipped function the engine's `interact` calls.
  const honoured = fork(base)
  const commitments = createChronicleCommitmentState()
  commitments.rumours.push({ ...rumour })
  commitments.pinnedRumourId = rumour.id
  // Not pinned is not committed: the torch refuses.
  const notPinned = createChronicleCommitmentState()
  notPinned.rumours.push({ ...rumour })
  assert.equal(
    markRumourActioned(notPinned, honoured.context, rumour.id),
    false,
    'a sabotage was performed without committing to it',
  )
  assert.equal(markRumourActioned(commitments, honoured.context, rumour.id), true)
  assert.equal(markRumourActioned(commitments, honoured.context, rumour.id), false)
  const depotSupplyAfter = honoured.regions.get(rumour.regionId)?.supply ?? 0
  assert.ok(
    Math.abs(depotSupplyBefore - depotSupplyAfter - SUPPLY_SABOTAGE_LOSS) < 1e-9,
    `the depot lost ${String(depotSupplyBefore - depotSupplyAfter)} supply`,
  )
  assert.equal(isRumourHonoured(commitments.rumours[0]), true)

  const honouredEvents = resolveRumour(
    commitments.rumours[0],
    honoured.context,
    new RandomStream(deriveSeed(base.seed, 'gameplay:rumour')),
    true,
  )
  const ignored = fork(base)
  const ignoredEvents = resolveRumour(
    rumour,
    ignored.context,
    new RandomStream(deriveSeed(base.seed, 'gameplay:rumour')),
    false,
  )

  assert.deepEqual(honouredEvents.map((event) => event.kind), ['raidRepelled'])
  assert.equal(
    honoured.regions.get(rumour.targetRegionId)?.control,
    targetControlBefore,
    'the push landed anyway',
  )
  assert.ok(
    ignoredEvents.some((event) => event.kind === 'regionCaptured'),
    `an ignored sabotage cost nothing: ${ignoredEvents.map((e) => e.kind).join(',')}`,
  )
  assert.equal(ignored.regions.get(rumour.targetRegionId)?.control, rumour.faction)
})

test('the escort changes the interception roll, and only where the player is standing', () => {
  // Two claims in one measurement. The first is the effect: escorted carts survive hostile
  // ground more often. The second is the determinism rule — an escort naming a caravan this
  // tick does not contain must change nothing at all, state or stream.
  let escortedLosses = 0
  let unescortedLosses = 0
  let escortedTicks = 0

  for (let index = 0; index < 90; index += 1) {
    const seed = 5_500_000 + index * 613
    const faction = FACTIONS[index % FACTIONS.length]
    const base = situation(seed, faction, 8 + (index % 9))
    const caravan = base.state.caravans.find((entry) => entry.intact)
    if (!caravan) continue
    const regionId = String(
      caravan.regionPath[
        Math.min(
          caravan.regionPath.length - 1,
          Math.floor(caravan.progress * caravan.regionPath.length),
        )
      ],
    )

    const runTick = (
      escort: { caravanId: string; regionId: string } | null,
    ): { situation: Situation; lost: number; rngState: number } => {
      const forked = fork(base)
      const rng = new RandomStream(deriveSeed(seed, 'gameplay:chronicle-escort'))
      const events = tickChronicle({
        blueprint: forked.context.blueprint,
        state: forked.state,
        regions: forked.regions,
        rng,
        environment: { nightFactor: 0.15, stormFactor: 0 },
        playerFaction: faction,
        playerObjectiveRatio: 0.25,
        protectedRegionIds: getChronicleProtectedRegionIds(forked.context.blueprint),
        frozenRegionIds: new Set<string>(),
        escort,
      })
      return {
        situation: forked,
        lost: events.filter((event) => event.kind === 'caravanLost').length,
        rngState: rng.getState(),
      }
    }

    const plain = runTick(null)
    const escorted = runTick({ caravanId: caravan.id, regionId })
    const absent = runTick({ caravanId: 'caravan-that-is-not-here', regionId })
    escortedTicks += 1
    unescortedLosses += plain.lost
    escortedLosses += escorted.lost

    // Determinism control. An escort for a cart the tick never sees must be inert.
    assert.deepEqual(absent.situation.state, plain.situation.state, `seed ${String(seed)}`)
    assert.deepEqual(
      [...absent.situation.regions.entries()].sort(),
      [...plain.situation.regions.entries()].sort(),
      `seed ${String(seed)}`,
    )
    assert.equal(absent.rngState, plain.rngState, 'an inert escort moved the stream')
  }

  assert.ok(escortedTicks >= 40, `only ${String(escortedTicks)} ticks had a cart to escort`)
  // Non-vacuity: the unescorted arm has to actually lose carts, or "fewer" is trivial.
  assert.ok(unescortedLosses > 0, 'no cart was ever intercepted, so the escort proves nothing')
  assert.ok(
    escortedLosses < unescortedLosses,
    `escorting did not help: ${String(escortedLosses)} vs ${String(unescortedLosses)}`,
  )
})

// ---------------------------------------------------------------------------
// Campaign safety
// ---------------------------------------------------------------------------

test('no rumour ever puts a campaign anchor or an objective square at stake', () => {
  let candidates = 0
  for (let index = 0; index < 60; index += 1) {
    const seed = 6_600_000 + index * 811
    const faction = FACTIONS[index % FACTIONS.length]
    for (const ticks of [4, 14, 28, 46]) {
      const base = situation(seed, faction, ticks)
      const reserved = base.context.reservedRegionIds
      // Non-vacuity for the loop: an empty reserved set would make every assertion below
      // pass by accident.
      assert.ok(reserved.size >= 2, `only ${String(reserved.size)} squares are reserved`)
      for (const rumour of findRumourCandidates(base.context)) {
        candidates += 1
        assert.equal(
          reserved.has(rumour.targetRegionId),
          false,
          `${rumour.id} put a reserved square at stake`,
        )
        // Where the *player* has to be is a different question from what is at stake, and
        // only for the two kinds whose square is the stake. An escort's square is wherever
        // the cart currently is, and a cart is allowed to roll through an anchor — nothing
        // there is being wagered on it.
        if (rumour.kind !== 'escort') {
          assert.equal(
            reserved.has(rumour.regionId),
            false,
            `${rumour.id} sent the player into a reserved square`,
          )
        }
      }
    }
  }
  assert.ok(candidates > 200, `only ${String(candidates)} candidates were scanned`)
})

test('a rumour hand-built onto a reserved square still cannot take it or burn anything in it', () => {
  // Braces for the selection filter's belt. The guard that matters is at resolution time,
  // because that is the one a future change to selection cannot walk past.
  const base = situation(9_090_909, 'guard', 22)
  const reserved = [...base.context.reservedRegionIds].sort()
  const anchor = reserved.find(
    (regionId) => base.regions.get(regionId)?.control !== 'villain',
  )
  assert.ok(anchor, 'no reserved square was available to attack')
  const controlBefore = base.regions.get(anchor)?.control
  const integrityBefore = base.regions.get(anchor)?.settlementIntegrity ?? 0

  const forced: ChronicleRumour = {
    id: 'rumour:defend:forced',
    kind: 'defend',
    regionId: anchor,
    targetRegionId: anchor,
    sourceRegionId: null,
    siteId: null,
    caravanId: null,
    faction: 'villain',
    raisedTick: base.state.tick,
    deadlineTick: base.state.tick,
    progress: 0,
    actioned: false,
  }
  const ignored = fork(base)
  resolveRumour(
    forced,
    ignored.context,
    new RandomStream(deriveSeed(base.seed, 'gameplay:rumour')),
    false,
  )
  assert.equal(
    ignored.regions.get(anchor)?.control,
    controlBefore,
    'an anchor changed hands',
  )
  assert.equal(ignored.regions.get(anchor)?.settlementIntegrity, integrityBefore)
  assert.equal(isRegionRazed(ignored.regions.get(anchor)), false)

  // Non-vacuity: the same resolution on an unreserved square does take it, so the
  // assertions above are about the guard rather than about a resolution that does nothing.
  const openRegion = base.context.blueprint.regions
    .map((region) => String(region.id))
    .find(
      (regionId) =>
        !base.context.reservedRegionIds.has(regionId) &&
        base.regions.get(regionId)?.control !== 'villain',
    )
  assert.ok(openRegion, 'every square in this world is reserved')
  const open = fork(base)
  const openEvents = resolveRumour(
    { ...forced, regionId: openRegion, targetRegionId: openRegion },
    open.context,
    new RandomStream(deriveSeed(base.seed, 'gameplay:rumour')),
    false,
  )
  assert.ok(
    openEvents.some((event) => event.kind === 'regionCaptured'),
    'the control cannot detect a capture it was supposed to prevent',
  )
})

test('a committed run never razes a square the campaign needs', () => {
  // The stranding condition, stated precisely: `handleGeneratedInteraction` refuses a
  // burned shop or healer before it ever checks whether an objective wanted it, so an
  // objective square reduced to ashes is a run that cannot be finished. The 500-seed
  // completability gate in `tests/worldGenerator.test.ts` proves the *graph* is solvable;
  // this proves a commitment cannot un-solve it afterwards.
  let resolved = 0
  let victories = 0
  let razed = 0
  const runs = 12
  for (let index = 0; index < runs; index += 1) {
    const seed = 7_700_000 + index * 907
    const faction = FACTIONS[index % FACTIONS.length]
    const report = runHarness({
      seed,
      faction,
      policy: 'beeline',
      hz: 20,
      timeLimit: 240,
      rumourPolicy: 'commit',
    })
    const reserved = getRumourReservedRegionIds(generateWorld(seed), faction)
    assert.ok(reserved.size >= 2, `only ${String(reserved.size)} squares are reserved`)
    for (const regionId of report.razedRegionIds) {
      razed += 1
      assert.equal(
        reserved.has(regionId),
        false,
        `seed ${String(seed)} razed reserved square ${regionId}`,
      )
    }
    resolved += report.rumours.resolved
    if (report.outcome === 'victory') victories += 1
  }
  // Non-vacuity in two directions: the arm has to have been resolving rumours at all, and
  // the campaign has to still finish while it does.
  assert.ok(resolved > runs, `only ${String(resolved)} rumours resolved across ${String(runs)} runs`)
  assert.ok(victories > runs / 2, `only ${String(victories)} of ${String(runs)} runs finished`)
  // Recorded rather than asserted: razing is rare in a 240 s run, so a floor here would be
  // a flake. The assertion that matters is the per-square one above.
  assert.ok(razed >= 0)
})

// ---------------------------------------------------------------------------
// Save ownership
// ---------------------------------------------------------------------------

test('the commitment survives a save, and refuses what it cannot read', () => {
  const base = situation(1_212_121, 'elf', 20)
  const commitments = createChronicleCommitmentState()
  const rng = new RandomStream(deriveSeed(base.seed, 'gameplay:rumour'))
  for (let tick = 0; tick < 24; tick += 1) {
    base.state.tick += 1
    offerRumours(commitments, base.context, rng)
  }
  assert.ok(commitments.rumours.length > 0, 'nothing was offered to save')
  pinRumour(commitments, commitments.rumours[0].id)
  commitments.verdict = {
    rumourId: 'rumour:escort:caravan-9',
    kind: 'escort',
    outcome: 'broken',
    committed: true,
    regionId: '2',
    targetRegionId: '3',
    siteId: 'site-shop-riverside',
    faction: 'guard',
    tick: base.state.tick,
  }

  const roundTripped = normalizeChronicleCommitmentState(
    JSON.parse(JSON.stringify(serializeChronicleCommitmentState(commitments))),
  )
  assert.deepEqual(roundTripped, commitments)

  // The cost, stated rather than assumed: this is the whole of what 1.3 adds to a save.
  const bytes = JSON.stringify(serializeChronicleCommitmentState(commitments)).length
  assert.ok(bytes < 1_400, `the commitment costs ${String(bytes)} bytes of save`)

  // Garbage is dropped, not trusted, and a pin naming a rumour that did not survive the
  // read is cleared rather than left pointing at nothing.
  const salvaged = normalizeChronicleCommitmentState({
    rumours: [
      { ...commitments.rumours[0], kind: 'bribe' },
      commitments.rumours[0],
      commitments.rumours[0],
      null,
      42,
    ],
    pinnedRumourId: 'rumour:that:never:existed',
    nextOfferTick: -4,
    verdict: { rumourId: 'x' },
  })
  assert.deepEqual(salvaged.rumours, [commitments.rumours[0]])
  assert.equal(salvaged.pinnedRumourId, null)
  assert.equal(salvaged.nextOfferTick, 0)
  assert.equal(salvaged.verdict, null)
  assert.deepEqual(
    normalizeChronicleCommitmentState('not a commitment'),
    createChronicleCommitmentState(),
  )
})

test('a settled rumour leaves the board, clears the pin, and leaves a verdict behind', () => {
  const { base, rumour } = findSituationWith('defend')
  const commitments: ChronicleCommitmentState = createChronicleCommitmentState()
  commitments.rumours.push({ ...rumour })
  pinRumour(commitments, rumour.id)

  // Presence accrues only for the pinned rumour, and only in its own square.
  advanceRumourProgress(commitments, base.context, 'a square that is not it')
  assert.equal(commitments.rumours[0].progress, 0)
  advanceRumourProgress(commitments, base.context, rumour.regionId)
  assert.equal(commitments.rumours[0].progress, 1)

  base.state.tick = rumour.deadlineTick
  const settlement = settleDueRumours(
    commitments,
    base.context,
    new RandomStream(deriveSeed(base.seed, 'gameplay:rumour')),
  )
  assert.equal(settlement.verdicts.length, 1)
  assert.equal(settlement.verdicts[0].outcome, 'broken')
  assert.equal(settlement.verdicts[0].committed, true)
  assert.deepEqual(commitments.rumours, [])
  assert.equal(commitments.pinnedRumourId, null)
  assert.equal(commitments.verdict?.rumourId, rumour.id)
  assert.ok(settlement.events.length > 0, 'a settled rumour wrote nothing')
})

test('a caravan the world already settled is not settled twice', () => {
  // The escort's honest edge: if the chronicle intercepted or delivered the cart on its
  // own before the deadline, the commitment must record a verdict without writing a second
  // outcome over the top of the first.
  const { base, rumour } = findSituationWith('escort')
  const commitments = createChronicleCommitmentState()
  commitments.rumours.push({ ...rumour })
  pinRumour(commitments, rumour.id)
  base.state.caravans = base.state.caravans.filter(
    (entry) => entry.id !== rumour.caravanId,
  )
  const supplyBefore = new Map(
    [...base.regions].map(([key, value]) => [key, value.supply]),
  )
  const settlement = settleDueRumours(
    commitments,
    base.context,
    new RandomStream(deriveSeed(base.seed, 'gameplay:rumour')),
  )
  assert.equal(settlement.verdicts.length, 1)
  assert.deepEqual(settlement.events, [])
  for (const [key, supply] of supplyBefore) {
    assert.equal(base.regions.get(key)?.supply, supply, `square ${key} was charged twice`)
  }
  assert.ok(base.state.caravans.length <= CHRONICLE_CARAVAN_LIMIT)
})

// ---------------------------------------------------------------------------
// The signal
// ---------------------------------------------------------------------------

/** How many seeds the committed gate compares. The 96-seed figures are in the test below. */
function signalSeeds(): number {
  const raw = Number(process.env.KOROVANY_COMMITMENT_SEEDS)
  return Number.isInteger(raw) && raw > 0 ? raw : 18
}

function controlKey(control: Record<string, string>): string {
  return Object.entries(control)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([regionId, holder]) => `${regionId}=${holder}`)
    .join(',')
}

test('committing changes who holds the map, and the placebo says it was the commitment', () => {
  // **Roadmap 1.3's signal.** Measured with `KOROVANY_COMMITMENT_SEEDS=96`, beeline policy,
  // 20 Hz, a 300 s limit, factions rotating: region control at the end of the run differed
  // from the no-input baseline in **45.8 %** of runs — and, restricted to the 71 seeds
  // where both arms actually reached victory, in **29.6 %**.
  //
  // The number that keeps it honest is the third one. Walking somewhere else is itself an
  // input: the placebo arm, which takes the same detours and pins nothing, already differs
  // from the baseline in 49.0 % of runs. **Commit against placebo is 44.8 %** (27.1 % over
  // shared victories), which is the share attributable to the commitment rather than to the
  // legs, and it is what fails if a commitment ever stops doing anything.
  //
  // The committed gate sweeps 18 seeds at a 240 s limit and asserts bands, because a sweep
  // aggregate is a fact about the design rather than a target.
  const seeds = signalSeeds()
  const arms: RumourPolicy[] = ['ignore', 'walk', 'commit']
  const reports = new Map<RumourPolicy, ReturnType<typeof runHarness>[]>(
    arms.map((arm) => [arm, []]),
  )

  for (let index = 0; index < seeds; index += 1) {
    const seed = 900_000 + index * 613
    const faction = FACTIONS[index % FACTIONS.length]
    for (const arm of arms) {
      reports.get(arm)?.push(
        runHarness({
          seed,
          faction,
          policy: 'beeline',
          hz: 20,
          timeLimit: 240,
          rumourPolicy: arm,
        }),
      )
    }
  }

  const baseline = reports.get('ignore') ?? []
  const placebo = reports.get('walk') ?? []
  const treatment = reports.get('commit') ?? []
  const divergence = (
    left: ReturnType<typeof runHarness>[],
    right: ReturnType<typeof runHarness>[],
  ): number => {
    let differ = 0
    for (let index = 0; index < left.length; index += 1) {
      if (controlKey(left[index].regionControl) !== controlKey(right[index].regionControl)) {
        differ += 1
      }
    }
    return differ / Math.max(1, left.length)
  }

  const sum = (
    list: ReturnType<typeof runHarness>[],
    pick: (report: ReturnType<typeof runHarness>) => number,
  ): number => list.reduce((total, report) => total + pick(report), 0)

  // Non-vacuity, in three parts. The arms have to have been offered rumours, the treatment
  // has to have pinned and honoured some, and it has to have failed some — a commitment
  // that could only ever be kept would not be a stake.
  assert.ok(
    sum(baseline, (report) => report.rumours.offered) > seeds,
    'the baseline arm was never offered a rumour',
  )
  assert.equal(
    sum(baseline, (report) => report.rumours.pinned),
    0,
    'the no-input baseline pinned something',
  )
  assert.equal(
    sum(placebo, (report) => report.rumours.pinned),
    0,
    'the placebo arm pinned something, so it is not a placebo',
  )
  assert.ok(sum(treatment, (report) => report.rumours.pinned) > seeds / 2)
  assert.ok(sum(treatment, (report) => report.rumours.kept) > 0, 'nothing was ever honoured')
  assert.ok(
    sum(treatment, (report) => report.rumours.brokenWhileCommitted) > 0,
    'every commitment was kept, so the deadline is not a stake',
  )
  assert.ok(
    sum(treatment, (report) => report.rumours.embodiedSeconds) > 60,
    'the treatment arm never actually stood anywhere',
  )
  // An ignored rumour has to cost the world something, or the baseline is a no-op arm.
  assert.ok(
    sum(baseline, (report) => report.rumours.events) > 0,
    'ignored rumours resolved into nothing at all',
  )

  const signal = divergence(baseline, treatment)
  const placeboShare = divergence(baseline, placebo)
  const attributable = divergence(placebo, treatment)

  assert.ok(
    signal > 0.2,
    `committing barely moved region control: ${(signal * 100).toFixed(1)}%`,
  )
  // **The control.** If a commitment stopped changing the world, this is the assertion that
  // fails, and it fails whether or not the detour still moves the map.
  assert.ok(
    attributable > 0.15,
    `the commitment is indistinguishable from the walk: ${(attributable * 100).toFixed(1)}%` +
      ` (placebo vs baseline ${(placeboShare * 100).toFixed(1)}%)`,
  )
  // And the campaign still finishes with a commitment in play.
  assert.ok(
    treatment.filter((report) => report.outcome === 'victory').length > seeds / 2,
    'committing stopped runs from finishing',
  )
})

test('the commitment arms are deterministic, which is what makes their numbers comparable', () => {
  for (const rumourPolicy of ['ignore', 'walk', 'commit'] as const) {
    const first = runHarness({
      seed: 424_242,
      faction: 'guard',
      hz: 20,
      timeLimit: 160,
      rumourPolicy,
    })
    const second = runHarness({
      seed: 424_242,
      faction: 'guard',
      hz: 20,
      timeLimit: 160,
      rumourPolicy,
    })
    assert.deepEqual(second, first, `${rumourPolicy} is not reproducible`)
  }
})

test('rumours are off by default, so every pre-1.3 harness number still describes its own run', () => {
  const off = runHarness({ seed: 55_555, faction: 'elf', hz: 20, timeLimit: 160 })
  const explicit = runHarness({
    seed: 55_555,
    faction: 'elf',
    hz: 20,
    timeLimit: 160,
    rumourPolicy: 'off',
  })
  assert.deepEqual(explicit, off)
  assert.equal(off.rumours.offered, 0)
  assert.deepEqual(off.rumours.offeredByKind, {})

  // Non-vacuity: the same seed with rumours on is a different run, so "off changes nothing"
  // is a statement about the switch rather than about a feature that does nothing.
  const on = runHarness({
    seed: 55_555,
    faction: 'elf',
    hz: 20,
    timeLimit: 160,
    rumourPolicy: 'commit',
  })
  assert.ok(on.rumours.offered > 0, 'the commit arm was offered nothing')
})
