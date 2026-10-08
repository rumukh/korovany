/**
 * W2-3 — a rumour is offered only when the player can meet it, its card says how far and how
 * long, and keeping it pays a little, once.
 *
 * Driven through the functions the game calls: `fitRumourOffer` and `offerRumours` for the
 * offer, `estimateRumourReach` for the card's verdict, `buildChronicleRumourViews` for the
 * card, and `GameEngine`'s own commitment step for the offer from where the player stands and
 * for the pay. Each claim carries its control:
 *
 * - a cart rolling toward the player is met where the same cart, for a player behind it, is
 *   not; held still, as a defence of its square, the two players swap, which is what a reach
 *   that ignored the cart's motion would answer;
 * - a defence 30 s away is refused though its card would say «успеешь», because the board
 *   asks for no walk longer than 25 s;
 * - a board filled without the filter offers rumours the player cannot meet, which is the
 *   defect the filter removes, and the filtered board never does;
 * - the same square is offered on two legs and refused on none, so the engine times the walk
 *   on the body it has;
 * - a broken or untaken rumour pays nothing, and a kept one pays once however the run is
 *   saved around it.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import { getFactionStartPosition2D } from '../src/game/content/registry.ts'
import { describeChoiceSummary, describeRumourReach } from '../src/game/content/gameCopy.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import {
  createHealthyBody,
  type BodyState,
  type ChoiceTravelView,
  type Faction,
  type RumourKind,
} from '../src/game/types.ts'
import {
  createChronicleRegions,
  createChronicleState,
  getChronicleProtectedRegionIds,
  tickChronicle,
  type ChronicleState,
  type RegionChronicleState,
} from '../src/game/world/Chronicle.ts'
import {
  RUMOUR_DEADLINE_TICKS,
  RUMOUR_KEPT_GOLD,
  RUMOUR_KEPT_RATIONS,
  RUMOUR_MIN_DEADLINE_TICKS,
  RUMOUR_OFFER_INTERVAL_TICKS,
  RUMOUR_OFFER_WALK_SECONDS,
  createChronicleCommitmentState,
  estimateRumourReach,
  findRumourCandidates,
  findRumourOffers,
  fitRumourOffer,
  getRumourReservedRegionIds,
  normalizeChronicleCommitmentState,
  offerRumours,
  pinRumour,
  rumourKeptReward,
  rumourTargetPoint,
  serializeChronicleCommitmentState,
  type ChronicleCommitmentState,
  type ChronicleRumour,
  type RumourTravelEstimate,
  type RumourWorldContext,
} from '../src/game/world/CampaignDirector.ts'
import { buildChronicleRumourViews } from '../src/game/world/CampaignView.ts'
import { PLAYER_WALK_SPEED, playerLegMobility } from '../src/game/world/CombatMastery.ts'
import { estimateWalkSeconds } from '../src/game/world/ExpeditionPlanner.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL) {
      for (const suffix of ['.ts', '/index.ts']) {
        const url = new URL(specifier + suffix, context.parentURL)
        if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
      }
    }
    return nextResolve(specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
hooks.deregister()

const FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']
const BLUEPRINT = generateWorld(1)

type Point = { x: number; z: number }

/** The middle of a square, where the compass and the cards aim. */
function centre(regionId: string): Point {
  const point = rumourTargetPoint(BLUEPRINT, { kind: 'defend', regionId, siteId: null })
  assert.ok(point, regionId)
  return point
}

/** A walk on a clear, straight road at `speed`: the shape of the estimate the offer uses. */
function straightFrom(from: Point, speed = PLAYER_WALK_SPEED): RumourTravelEstimate {
  return (point) => Math.hypot(point.x - from.x, point.z - from.z) / speed
}

/** A cart setting off east along the middle row, three squares long and five ticks from home. */
function eastboundEscort(): { state: ChronicleState; rumour: ChronicleRumour } {
  const state = createChronicleState()
  state.caravans.push({
    id: 'caravan-east',
    ownerFaction: 'guard',
    fromSiteId: 'site-west',
    toSiteId: 'site-east',
    regionPath: ['region-1-2', 'region-2-2', 'region-3-2'],
    progress: 0,
    intact: true,
  })
  return {
    state,
    rumour: {
      id: 'rumour:escort:caravan-east',
      kind: 'escort',
      regionId: 'region-1-2',
      targetRegionId: 'region-3-2',
      sourceRegionId: null,
      siteId: null,
      caravanId: 'caravan-east',
      faction: null,
      raisedTick: 0,
      deadlineTick: 5,
      progress: 0,
      actioned: false,
    },
  }
}

/** A defence or a sabotage of the middle square, as the board would raise it at `tick`. */
function standingRumour(kind: RumourKind, tick: number, window = RUMOUR_DEADLINE_TICKS): ChronicleRumour {
  return {
    id: `rumour:${kind}:fixture`,
    kind,
    regionId: 'region-2-2',
    targetRegionId: 'region-2-3',
    sourceRegionId: kind === 'sabotage' ? 'region-2-2' : null,
    siteId: null,
    caravanId: null,
    faction: null,
    raisedTick: tick,
    deadlineTick: tick + window,
    progress: 0,
    actioned: false,
  }
}

interface Situation {
  seed: number
  state: ChronicleState
  regions: Map<string, RegionChronicleState>
  context: RumourWorldContext
  chronicleRng: RandomStream
}

/** A world wound forward `ticks` chronicle ticks with the player nowhere near it. */
function situation(seed: number, faction: Faction, ticks: number): Situation {
  const blueprint = generateWorld(seed)
  const state = createChronicleState()
  const regions = createChronicleRegions(blueprint)
  const world: Situation = {
    seed,
    state,
    regions,
    chronicleRng: new RandomStream(deriveSeed(seed, 'gameplay:chronicle')),
    context: {
      blueprint,
      state,
      regions,
      playerFaction: faction,
      reservedRegionIds: getRumourReservedRegionIds(blueprint, faction),
    },
  }
  for (let tick = 0; tick < ticks; tick += 1) advanceWorld(world)
  return world
}

function advanceWorld(world: Situation): void {
  tickChronicle({
    blueprint: world.context.blueprint,
    state: world.state,
    regions: world.regions,
    rng: world.chronicleRng,
    environment: { nightFactor: 0.15, stormFactor: 0 },
    playerFaction: world.context.playerFaction,
    playerObjectiveRatio: 0.25,
    protectedRegionIds: getChronicleProtectedRegionIds(world.context.blueprint),
    frozenRegionIds: new Set<string>(),
  })
}

function invoke<T = void>(engine: object, method: string, ...args: unknown[]): T {
  const callable: unknown = Reflect.get(engine, method)
  assert.equal(typeof callable, 'function', `${method} must be a production engine method`)
  return Reflect.apply(callable as (...values: unknown[]) => T, engine, args)
}

interface Ledger {
  notices: Array<{ text: string; tone: string }>
  goldEarned: number[]
}

interface CommitmentProbe {
  engine: object
  ledger: Ledger
  commitments: () => ChronicleCommitmentState
  gold: () => number
  rations: () => number
  rumourStream: () => RandomStream
}

/**
 * An engine with the commitment step intact: the real settle, offer and pay, the real copy
 * and the real square labels. The exits — sound, notices, achievements — are recorded.
 */
function commitmentProbe(
  faction: Faction,
  world: Situation,
  at: Point,
  body: BodyState = createHealthyBody(),
): CommitmentProbe {
  const ledger: Ledger = { notices: [], goldEarned: [] }
  const engine: object = Object.create(GameEngine.prototype)
  Object.assign(engine, {
    faction,
    gold: 0,
    generatedSupplyCount: 0,
    body,
    chronicleCommitments: createChronicleCommitmentState(),
    chronicleState: world.state,
    chronicleRegions: world.regions,
    chronicleRumourReserved: world.context.reservedRegionIds,
    generatedBlueprint: world.context.blueprint,
    generatedRngStreams: { rumour: new RandomStream(deriveSeed(world.seed, 'gameplay:rumour')) },
    player: { position: new THREE.Vector3(at.x, 0, at.z) },
    achievements: { recordGoldEarned: (amount: number) => ledger.goldEarned.push(amount) },
    callbacks: { onNotice: (text: string, tone: string) => ledger.notices.push({ text, tone }) },
    playSound() {},
  })
  const read = <T>(key: string): T => Reflect.get(engine, key) as T
  return {
    engine,
    ledger,
    commitments: () => read<ChronicleCommitmentState>('chronicleCommitments'),
    gold: () => read<number>('gold'),
    rations: () => read<number>('generatedSupplyCount'),
    rumourStream: () => read<{ rumour: RandomStream }>('generatedRngStreams').rumour,
  }
}

/** One commitment step at the world's current tick, the player in no square of interest. */
function step(probe: CommitmentProbe, world: Situation): void {
  invoke(probe.engine, 'advanceChronicleCommitments', world.context, null)
}

// ---------------------------------------------------------------------------
// The reach
// ---------------------------------------------------------------------------

test('an escort is met where its cart will be: ahead is «успеешь», behind «впритык», off the road «не успеть»', () => {
  const { state, rumour } = eastboundEscort()
  const context = { blueprint: BLUEPRINT, state }
  const reach = (from: Point) => estimateRumourReach(rumour, context, straightFrom(from), 0)
  assert.equal(reach(centre('region-3-2')), 'yes', 'the cart rolls into the square ahead of it')
  assert.equal(reach(centre('region-4-2')), 'yes', 'and on into the one beyond')
  assert.equal(reach(centre('region-0-2')), 'tight', 'behind a cart that rolls away, only with no margin')
  assert.equal(reach(centre('region-0-0')), 'no')

  // Control: held still, as a defence of the cart's square on the same clock, the players
  // ahead and behind swap. A reach that ignored the cart's motion would answer this way.
  const still: ChronicleRumour = { ...rumour, id: 'rumour:defend:still', kind: 'defend', caravanId: null }
  const stillReach = (from: Point) => estimateRumourReach(still, context, straightFrom(from), 0)
  assert.notEqual(stillReach(centre('region-3-2')), 'yes')
  assert.equal(stillReach(centre('region-0-2')), 'yes')
})

test('an escort is offered only where the card would say «успеешь», and keeps its cart’s clock', () => {
  const { state, rumour } = eastboundEscort()
  const context = { blueprint: BLUEPRINT, state }
  const offerFrom = (from: Point) => fitRumourOffer(rumour, context, straightFrom(from))
  for (const regionId of ['region-3-2', 'region-4-2']) {
    const offer = offerFrom(centre(regionId))
    assert.ok(offer, `${regionId}: the cart comes to the player`)
    assert.equal(offer.deadlineTick, rumour.deadlineTick, 'an escort keeps its cart’s clock')
  }
  // Control: a card that would read «впритык» or «не успеть» is never put on the board.
  assert.equal(offerFrom(centre('region-0-2')), null, 'a cart that rolls away is chased, not joined')
  assert.equal(offerFrom(centre('region-0-0')), null)
})

test('a defence or a sabotage gets a clock fitted to the walk, and nothing past it', () => {
  const state = createChronicleState()
  state.tick = 20
  const context = { blueprint: BLUEPRINT, state }
  const window = (kind: RumourKind, walk: number): number | null => {
    const offer = fitRumourOffer(standingRumour(kind, state.tick), context, () => walk)
    return offer === null ? null : offer.deadlineTick - state.tick
  }
  // walk × 1.5 + 8 s is the arrival; a defence then holds three ticks, a sabotage needs one,
  // and two spare ticks follow, never under the 48 s floor. Nothing past a 25 s walk.
  assert.equal(RUMOUR_OFFER_WALK_SECONDS, 25, 'the table below is written for a 25 s walk')
  assert.deepEqual(
    [0, 20, 25, 26].map((walk) => window('defend', walk)),
    [RUMOUR_MIN_DEADLINE_TICKS, 9, 10, null],
  )
  assert.deepEqual(
    [0, 20, 25, 26].map((walk) => window('sabotage', walk)),
    [RUMOUR_MIN_DEADLINE_TICKS, 7, 8, null],
  )
  assert.equal(fitRumourOffer(standingRumour('defend', state.tick), context, () => null), null,
    'a walk that cannot be timed is not offered')

  // Control for the walk's ceiling: a defence 30 s away still fits its 96 s clock, so its card
  // would say «успеешь», but the board does not ask for a walk that long.
  const far = standingRumour('defend', state.tick)
  assert.equal(estimateRumourReach(far, context, () => 30, state.tick), 'yes')
  assert.equal(fitRumourOffer(far, context, () => 30), null)
  assert.ok(fitRumourOffer(far, context, () => RUMOUR_OFFER_WALK_SECONDS), 'the ceiling itself is offered')
})

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

test('the board offers only what the player can meet, and a board it cannot fill draws nothing', () => {
  const world = situation(1, 'elf', 2)
  assert.ok(findRumourCandidates(world.context).length >= 2, 'the fixture needs two kinds on offer')
  const far: RumourTravelEstimate = () => 10_000
  const near: RumourTravelEstimate = () => 0
  const board = createChronicleCommitmentState()
  board.nextOfferTick = world.state.tick
  const rng = new RandomStream(deriveSeed(world.seed, 'gameplay:rumour'))
  const before = rng.state

  assert.deepEqual(findRumourOffers(board, world.context, far), [])
  assert.equal(offerRumours(board, world.context, rng, far), null)
  assert.equal(rng.state, before, 'no draw for a board it cannot fill')
  assert.equal(board.nextOfferTick, world.state.tick, 'the next tick may try again')
  assert.equal(board.rumours.length, 0)

  // Control: the same board with the player next door.
  const offered = offerRumours(board, world.context, rng, near)
  assert.ok(offered)
  assert.equal(board.nextOfferTick, world.state.tick + RUMOUR_OFFER_INTERVAL_TICKS)

  // One commitment at a time: a pin stops the board from growing, and dropping it lets it grow.
  assert.ok(pinRumour(board, offered.id))
  board.nextOfferTick = world.state.tick
  assert.equal(offerRumours(board, world.context, rng, near), null)
  assert.ok(pinRumour(board, null))
  assert.ok(offerRumours(board, world.context, rng, near), 'the unpinned board grows again')
})

test('a board filled without the filter offers rumours the player cannot meet; the filtered one never does', () => {
  let filtered = 0
  let unfilteredUnmeetable = 0
  for (const seed of [1, 7920, 15839]) {
    for (const faction of FACTIONS) {
      const world = situation(seed, faction, 0)
      const start = getFactionStartPosition2D(world.context.blueprint, faction)
      assert.ok(start)
      const travel: RumourTravelEstimate = (point) =>
        estimateWalkSeconds(world.context.blueprint, start, point, PLAYER_WALK_SPEED)
      const reach = { blueprint: world.context.blueprint, state: world.state }
      const boards = [createChronicleCommitmentState(), createChronicleCommitmentState()]
      const streams = boards.map(() => new RandomStream(deriveSeed(seed, 'gameplay:rumour')))
      for (let tick = 0; tick < 40; tick += 1) {
        advanceWorld(world)
        // Expire rather than settle, so the two boards never write into the world they share.
        for (const board of boards) {
          board.rumours = board.rumours.filter((rumour) => rumour.deadlineTick > world.state.tick)
        }
        const offered = offerRumours(boards[0], world.context, streams[0], travel)
        if (offered) {
          filtered += 1
          assert.equal(estimateRumourReach(offered, reach, travel, world.state.tick), 'yes', `${seed}/${faction}`)
        }
        const loose = offerRumours(boards[1], world.context, streams[1], () => 0)
        if (loose && estimateRumourReach(loose, reach, travel, world.state.tick) === 'no') {
          unfilteredUnmeetable += 1
        }
      }
    }
  }
  assert.ok(filtered > 0, 'the filtered board offered nothing at all')
  assert.ok(unfilteredUnmeetable > 0, 'without the filter every offer was in reach anyway')
})

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

test('a card quotes the walk, the clock and the pay, and says «не успеть» once the walk outgrows the clock', () => {
  const board = createChronicleCommitmentState()
  board.rumours.push(standingRumour('defend', 0, RUMOUR_MIN_DEADLINE_TICKS))
  const chronicle = createChronicleState()
  const travelView = (from: Point) => (point: Point): ChoiceTravelView => {
    const meters = Math.hypot(point.x - from.x, point.z - from.z)
    return { meters, seconds: Math.ceil(meters / PLAYER_WALK_SPEED), basis: 'straight', danger: [], unscouted: 0 }
  }
  const card = (from: Point, faction: Faction = 'guard') =>
    buildChronicleRumourViews(BLUEPRINT, board, 0, { faction, chronicle, travel: travelView(from) })[0]

  const here = card(centre('region-2-2'))
  assert.equal(here.travel?.seconds, 0)
  assert.equal(here.reach, 'yes')
  assert.deepEqual(here.reward, rumourKeptReward('guard'))
  assert.equal(here.reward?.gold, RUMOUR_KEPT_GOLD)
  assert.equal(
    describeRumourReach(here.travel?.seconds ?? null, here.timeRemaining, here.reach ?? null),
    'ты на месте · осталось 48 с · успеешь',
  )

  const twoSquaresOff = card(centre('region-2-0'))
  assert.equal(twoSquaresOff.travel?.seconds, 20)
  assert.equal(twoSquaresOff.reach, 'tight')
  assert.equal(describeRumourReach(20, twoSquaresOff.timeRemaining, 'tight'), 'идти ~20 с · осталось 48 с · впритык')

  assert.equal(card(centre('region-0-0')).reach, 'tight', 'the corner is a 28 s walk: the three ticks still fit')
  assert.equal(card({ x: -200, z: -200 }).reach, 'no')

  const elf = card(centre('region-2-2'), 'elf')
  assert.equal(elf.reward?.gold, 0)
  assert.equal(elf.reward?.supplies, RUMOUR_KEPT_RATIONS)
  // The atlas row's short price names the ration when there is no gold to name.
  assert.equal(describeChoiceSummary(rumourKeptReward('elf'), null), '1 паёк')
  assert.equal(describeChoiceSummary(rumourKeptReward('villain'), null), '15 золотых')

  // Control: with nothing to time it by, a card quotes nothing rather than guessing.
  const bare = buildChronicleRumourViews(BLUEPRINT, board, 0)[0]
  assert.equal(bare.travel, null)
  assert.equal(bare.reach, null)
  assert.equal(bare.reward, null)
})

// ---------------------------------------------------------------------------
// The engine: where the offer is timed from, and what keeping it pays
// ---------------------------------------------------------------------------

test('the engine offers what can be met from where the player stands, on the legs they have', () => {
  const world = situation(1, 'elf', 2)
  const candidates = findRumourCandidates(world.context)
  const target = rumourTargetPoint(world.context.blueprint, candidates[0])
  assert.ok(target)
  const crawling: BodyState = { ...createHealthyBody(), leftLeg: 'missing', rightLeg: 'missing' }
  const poolAt = (at: Point, body: BodyState) =>
    findRumourOffers(createChronicleCommitmentState(), world.context, (point) =>
      estimateWalkSeconds(world.context.blueprint, at, point, PLAYER_WALK_SPEED * playerLegMobility(body)))

  const offerAt = (at: Point, body: BodyState): { probe: CommitmentProbe; drew: boolean } => {
    const probe = commitmentProbe('elf', world, at, body)
    probe.commitments().nextOfferTick = world.state.tick
    const before = probe.rumourStream().state
    step(probe, world)
    return { probe, drew: probe.rumourStream().state !== before }
  }

  const beside = offerAt(target, createHealthyBody())
  assert.equal(beside.probe.commitments().rumours.length, 1, 'standing on it, the player is offered it')

  // A square the player can reach on two legs and not on none: the walk is timed on the body.
  const squares = BLUEPRINT.regions.map((region) => centre(String(region.id)))
  const telling = squares.find((at) =>
    poolAt(at, createHealthyBody()).length > 0 && poolAt(at, crawling).length === 0)
  assert.ok(telling, 'the fixture needs a square that legs decide')
  const walking = offerAt(telling, createHealthyBody())
  assert.equal(walking.probe.commitments().rumours.length, 1)
  const crawl = offerAt(telling, crawling)
  assert.equal(crawl.probe.commitments().rumours.length, 0)
  assert.equal(crawl.drew, false, 'nothing drawn for an offer that was not made')
  assert.equal(crawl.probe.commitments().nextOfferTick, world.state.tick)
})

/** A defence the player has honoured, or not, falling due on this very tick. */
function dueDefence(world: Situation, honoured: boolean): ChronicleRumour {
  const tick = world.state.tick
  return {
    ...standingRumour('defend', tick - RUMOUR_MIN_DEADLINE_TICKS, RUMOUR_MIN_DEADLINE_TICKS),
    progress: honoured ? 3 : 0,
  }
}

const KEPT_LINES: Record<Faction, string> = {
  guard: 'Командир доволен: +15 золота.',
  villain: 'Сам себе командир — сам себе и премия: +15 золота.',
  elf: 'Домики деревяные делятся пайком: +1 паёк.',
}

test('a kept rumour pays once, in the faction’s own voice; a broken or untaken one pays nothing', () => {
  for (const faction of FACTIONS) {
    const world = situation(1, faction, 8)
    const probe = commitmentProbe(faction, world, centre('region-2-2'))
    const board = probe.commitments()
    board.nextOfferTick = Number.MAX_SAFE_INTEGER
    const kept = dueDefence(world, true)
    board.rumours.push(kept)
    assert.ok(pinRumour(board, kept.id))

    step(probe, world)
    const reward = rumourKeptReward(faction)
    assert.equal(probe.gold(), reward.gold, faction)
    assert.equal(probe.rations(), reward.supplies, faction)
    assert.deepEqual(probe.ledger.goldEarned, reward.gold > 0 ? [RUMOUR_KEPT_GOLD] : [], faction)
    assert.equal(probe.ledger.notices.length, 1)
    assert.equal(probe.ledger.notices[0].tone, 'success')
    assert.ok(probe.ledger.notices[0].text.endsWith(KEPT_LINES[faction]), probe.ledger.notices[0].text)
    assert.equal(board.rumours.length, 0, 'the kept rumour leaves the board with its pay')

    step(probe, world)
    assert.equal(probe.gold(), reward.gold, `${faction}: paid twice`)
    assert.equal(probe.rations(), reward.supplies, `${faction}: fed twice`)

    // Controls: pinned and failed, and done but never taken.
    for (const [rumour, pinned, tone] of [
      [dueDefence(world, false), true, 'danger'],
      [dueDefence(world, true), false, 'warning'],
    ] as const) {
      const other = commitmentProbe(faction, world, centre('region-2-2'))
      other.commitments().nextOfferTick = Number.MAX_SAFE_INTEGER
      other.commitments().rumours.push(rumour)
      if (pinned) assert.ok(pinRumour(other.commitments(), rumour.id))
      step(other, world)
      assert.equal(other.gold(), 0, `${faction}: a ${tone} verdict paid`)
      assert.equal(other.rations(), 0)
      assert.deepEqual(other.ledger.goldEarned, [])
      assert.equal(other.ledger.notices[0]?.tone, tone)
      assert.ok(!other.ledger.notices[0].text.includes(KEPT_LINES[faction]))
    }
  }
})

test('a save taken either side of the verdict pays exactly once and keeps the clock', () => {
  const world = situation(1, 'guard', 8)
  const original = commitmentProbe('guard', world, centre('region-2-2'))
  const board = original.commitments()
  board.nextOfferTick = Number.MAX_SAFE_INTEGER
  const kept = dueDefence(world, true)
  board.rumours.push(kept)
  assert.ok(pinRumour(board, kept.id))

  // Saved before the verdict: the continued run pays once, as the original does.
  const before = normalizeChronicleCommitmentState(
    JSON.parse(JSON.stringify(serializeChronicleCommitmentState(board))),
  )
  assert.equal(before.rumours[0]?.deadlineTick, kept.deadlineTick, 'a save does not wind the clock back')
  const continued = commitmentProbe('guard', world, centre('region-2-2'))
  Reflect.set(continued.engine, 'chronicleCommitments', before)
  step(continued, world)
  step(continued, world)
  assert.equal(continued.gold(), RUMOUR_KEPT_GOLD)

  step(original, world)
  assert.equal(original.gold(), RUMOUR_KEPT_GOLD)

  // Saved after it: nothing left to pay.
  const after = normalizeChronicleCommitmentState(
    JSON.parse(JSON.stringify(serializeChronicleCommitmentState(original.commitments()))),
  )
  const resumed = commitmentProbe('guard', world, centre('region-2-2'))
  Reflect.set(resumed.engine, 'chronicleCommitments', after)
  step(resumed, world)
  assert.equal(resumed.gold(), 0)
  assert.deepEqual(resumed.ledger.notices, [])
})
