/**
 * W2-3 follow-up — a taken escort's compass leads to where its cart can be met.
 *
 * The cart of an escort rolls about a square every one or two chronicle ticks, so the square
 * it is in now is where it was, not where the player can stand beside it. `findEscortMeeting`
 * names the cart's square at the earliest check the player can be there in time; the
 * compass, the map pin and the card's walk then lead there. Every claim carries the
 * current-square rule as its control:
 *
 * - ahead of a cart, the meeting is a square it is coming to, where the current-square rule
 *   walks the player to where the cart is now and will have left by the time they arrive;
 * - behind it, the meeting is a square it has not reached yet, and with no meeting in time the
 *   compass falls back to the cart's square, as it always did;
 * - the engine works the meeting out once a chronicle tick: over a tick's frames neither the
 *   player's walk nor the clock moves it, so the planner re-plans when the meeting square
 *   changes, and not when the cart merely crosses into another square.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import { describeRumourReach, formatRegionGridLabel } from '../src/game/content/gameCopy.ts'
import { createHealthyBody, type ChoiceTravelView, type ChronicleRumourView } from '../src/game/types.ts'
import {
  createChronicleRegions,
  createChronicleState,
  getCaravanRegionId,
  type ChronicleState,
} from '../src/game/world/Chronicle.ts'
import {
  createChronicleCommitmentState,
  estimateRumourReach,
  findEscortMeeting,
  rumourTargetPoint,
  type ChronicleCommitmentState,
  type ChronicleRumour,
  type RumourTravelEstimate,
} from '../src/game/world/CampaignDirector.ts'
import { buildChronicleRumourViews } from '../src/game/world/CampaignView.ts'
import { PLAYER_WALK_SPEED } from '../src/game/world/CombatMastery.ts'
import { ExpeditionPlanner, type ExpeditionInput } from '../src/game/world/ExpeditionPlanner.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { HARNESS_SHIPPED_ARMS, runHarness, type RunOptions } from './runHarness.ts'

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

const BLUEPRINT = generateWorld(1)

type Point = { x: number; z: number }

/** The middle of a square, where the compass and the cards aim. */
function centre(regionId: string): Point {
  const point = rumourTargetPoint(BLUEPRINT, { kind: 'defend', regionId, siteId: null })
  assert.ok(point, regionId)
  return point
}

function label(regionId: string): string {
  const region = BLUEPRINT.regions.find((entry) => entry.id === regionId)
  assert.ok(region, regionId)
  return formatRegionGridLabel(region.coordinate.x, region.coordinate.y)
}

/** A walk on a clear, straight road at walking pace: the shape of the estimate the engine uses. */
function straightFrom(from: Point): RumourTravelEstimate {
  return (point) => Math.hypot(point.x - from.x, point.z - from.z) / PLAYER_WALK_SPEED
}

/**
 * A cart setting off east along the middle row, three squares long, and the escort the board
 * raised for it: five ticks on the clock, two of them to be spent beside the cart.
 */
function eastbound(): { state: ChronicleState; rumour: ChronicleRumour } {
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

/** One chronicle tick of the cart, as `tickChronicle` and `advanceRumourProgress` move it. */
function roll(state: ChronicleState, rumour: ChronicleRumour): void {
  state.tick += 1
  const caravan = state.caravans[0]
  caravan.progress = Math.min(1, caravan.progress + 0.18)
  rumour.regionId = String(getCaravanRegionId(caravan))
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

test('ahead of a cart the meeting is a square it is coming to; the current-square rule points back at it', () => {
  const { state, rumour } = eastbound()
  const context = { blueprint: BLUEPRINT, state }
  const meet = (from: Point) => findEscortMeeting(rumour, context, straightFrom(from), state.tick)

  // Two squares ahead: the cart is met in the square between, the first one both reach in
  // time. A square ahead: the same. In that square: wait where you stand.
  assert.equal(meet(centre('region-4-2')), 'region-2-2')
  assert.equal(meet(centre('region-3-2')), 'region-2-2')
  assert.equal(meet(centre('region-2-2')), 'region-2-2')
  // Control: the rule the compass followed before leads every one of them to the square the
  // cart is in now: from two squares ahead a 30 s walk, and the cart leaves it after 16.
  assert.deepEqual(rumourTargetPoint(BLUEPRINT, rumour), centre('region-1-2'))
  assert.equal(Math.ceil(straightFrom(centre('region-4-2'))(centre('region-1-2')) ?? 0), 30)
  assert.notEqual(meet(centre('region-4-2')), rumour.regionId)
})

test('behind a cart the meeting is still ahead of it; with no meeting in time there is none to lead to', () => {
  const { state, rumour } = eastbound()
  const context = { blueprint: BLUEPRINT, state }
  const meet = (from: Point) => findEscortMeeting(rumour, context, straightFrom(from), state.tick)
  const reach = (from: Point) => estimateRumourReach(rumour, context, straightFrom(from), state.tick)

  // A square behind: only without the margin, and only where the cart will be, not where it is.
  assert.equal(reach(centre('region-0-2')), 'tight')
  assert.equal(meet(centre('region-0-2')), 'region-2-2')
  // Off the road: no meeting fits, so the caller falls back to the cart's square.
  assert.equal(reach(centre('region-0-0')), 'no')
  assert.equal(meet(centre('region-0-0')), null)

  // Nothing to meet: a kept escort, a lost cart, and a rumour that is not an escort.
  assert.equal(findEscortMeeting({ ...rumour, progress: 2 }, context, straightFrom(centre('region-2-2')), 0), null)
  const lost = createChronicleState()
  assert.equal(findEscortMeeting(rumour, { blueprint: BLUEPRINT, state: lost }, straightFrom(centre('region-2-2')), 0), null)
  assert.equal(findEscortMeeting({ ...rumour, kind: 'defend', caravanId: null }, context,
    straightFrom(centre('region-2-2')), 0), null)
})

// ---------------------------------------------------------------------------
// The card and the pin
// ---------------------------------------------------------------------------

test('a taken escort’s card, pin and walk lead to the meeting square and say so; an untaken one does not', () => {
  const { state, rumour } = eastbound()
  const from = centre('region-4-2')
  const travel = (point: Point): ChoiceTravelView => {
    const meters = Math.hypot(point.x - from.x, point.z - from.z)
    return { meters, seconds: Math.ceil(meters / PLAYER_WALK_SPEED), basis: 'straight', danger: [], unscouted: 0 }
  }
  const board: ChronicleCommitmentState = { ...createChronicleCommitmentState(), rumours: [rumour] }
  let asked = 0
  const views = () => buildChronicleRumourViews(BLUEPRINT, board, 0, {
    faction: 'guard', chronicle: state, travel,
    meeting: (entry) => {
      asked += 1
      return findEscortMeeting(entry, { blueprint: BLUEPRINT, state }, (point) => travel(point).seconds, 0)
    },
  })[0]

  // Control: offered but not taken, the card leads to the cart and nobody asks where to meet it.
  const offered = views()
  assert.equal(asked, 0)
  assert.deepEqual({ x: offered.x, z: offered.z }, centre('region-1-2'))
  assert.equal(offered.meetLabel, null)
  assert.equal(offered.travel?.seconds, 30)

  board.pinnedRumourId = rumour.id
  const taken = views()
  assert.equal(asked, 1)
  assert.deepEqual({ x: taken.x, z: taken.z }, centre('region-2-2'))
  assert.equal(taken.meetLabel, label('region-2-2'))
  assert.equal(taken.travel?.seconds, 20)
  assert.equal(taken.reach, 'yes')
  assert.equal(taken.regionLabel, label('region-1-2'), 'the task still says where the cart is now')
  assert.equal(
    describeRumourReach(taken.travel?.seconds ?? null, taken.timeRemaining, taken.reach ?? null, taken.meetLabel ?? null),
    `встретить в ${label('region-2-2')} · идти ~20 с · осталось 40 с · успеешь`,
  )

  // Met in the square it is in now: nothing to add to the card.
  rumour.regionId = 'region-3-2'
  state.caravans[0].progress = 0.7
  assert.equal(views().meetLabel, null)
})

// ---------------------------------------------------------------------------
// The engine and the compass
// ---------------------------------------------------------------------------

function invoke<T = void>(engine: object, method: string, ...args: unknown[]): T {
  const callable: unknown = Reflect.get(engine, method)
  assert.equal(typeof callable, 'function', `${method} must be a production engine method`)
  return Reflect.apply(callable as (...values: unknown[]) => T, engine, args)
}

test('the engine meets the cart once a tick, and the compass re-plans when the meeting square changes', () => {
  const { state, rumour } = eastbound()
  const commitments: ChronicleCommitmentState = {
    ...createChronicleCommitmentState(), rumours: [rumour], pinnedRumourId: rumour.id,
  }
  const planner = new ExpeditionPlanner(BLUEPRINT)
  const engine: object = Object.create(GameEngine.prototype)
  const player = new THREE.Vector3(centre('region-4-2').x, 0, centre('region-4-2').z)
  Object.assign(engine, {
    faction: 'guard',
    body: createHealthyBody(),
    generatedBlueprint: BLUEPRINT,
    chronicleCommitments: commitments,
    chronicleState: state,
    chronicleAccumulator: 0,
    escortMeeting: null,
    expeditionPlanner: planner,
    player: { position: player },
  })
  const knowledge = {
    faction: 'guard' as const, discoveredRegionIds: new Set<string>(),
    chronicleRegions: createChronicleRegions(BLUEPRINT), contestedRegionIds: new Set<string>(),
  }
  const at = (): Point => ({ x: player.x, z: player.z })
  const input = (rumours: readonly ChronicleRumourView[]): ExpeditionInput => ({
    ...knowledge, player: at(), heading: 0, objectives: [], contracts: [], rumours, activeObjectiveId: null,
  })
  const frame = () => {
    const rumours = invoke<ChronicleRumourView[]>(engine, 'buildRumourViews', knowledge, at(), PLAYER_WALK_SPEED)
    return planner.buildView(input(rumours))
  }
  // Control: the same frames with the cart's square as the target, the compass before W2-3.
  const control = new ExpeditionPlanner(BLUEPRINT)
  const controlFrame = () => control.buildView(input(buildChronicleRumourViews(BLUEPRINT, commitments, state.tick)))

  const first = frame()
  controlFrame()
  assert.equal(first.target?.id, rumour.id)
  assert.deepEqual(first.target?.position, centre('region-2-2'))
  assert.equal(planner.getStats().planCount, 1)

  // A tick's frames: the clock runs and nothing re-plans.
  for (let frameIndex = 0; frameIndex < 40; frameIndex += 1) {
    Reflect.set(engine, 'chronicleAccumulator', frameIndex * 0.2)
    frame()
    controlFrame()
  }
  assert.equal(planner.getStats().planCount, 1)
  assert.equal(control.getStats().planCount, 1)

  // A tick on, the cart is still in its square, but the first square it can be met in has
  // moved on: the compass re-plans and the current-square rule does not.
  roll(state, rumour)
  Reflect.set(engine, 'chronicleAccumulator', 0)
  assert.deepEqual(frame().target?.position, centre('region-3-2'))
  controlFrame()
  assert.equal(rumour.regionId, 'region-1-2')
  assert.equal(planner.getStats().planCount, 2, 'the meeting square changed')
  assert.equal(control.getStats().planCount, 1, 'the cart did not change square')

  // Another tick, and the cart crosses into the next square: now the current-square rule
  // re-plans, and the compass, whose meeting square is the same, does not.
  roll(state, rumour)
  Reflect.set(engine, 'chronicleAccumulator', 0)
  assert.deepEqual(frame().target?.position, centre('region-3-2'))
  controlFrame()
  assert.equal(rumour.regionId, 'region-2-2')
  assert.equal(planner.getStats().planCount, 2, 'the meeting square did not change')
  assert.equal(control.getStats().planCount, 2, 'the cart changed square')

  // Walking somewhere else mid-tick does not move the meeting until the next tick works it out
  // again, though worked out now it would be another square.
  player.set(centre('region-2-2').x, 0, centre('region-2-2').z)
  Reflect.set(engine, 'chronicleAccumulator', 3)
  assert.equal(findEscortMeeting(rumour, { blueprint: BLUEPRINT, state }, straightFrom(at()), state.tick, 3),
    'region-2-2')
  assert.deepEqual(frame().target?.position, centre('region-3-2'))

  // The next tick does work it out again. From C3 the cart, already past, can no longer be
  // met in time, so the compass falls back to the cart's own square.
  roll(state, rumour)
  Reflect.set(engine, 'chronicleAccumulator', 0)
  const fallback = frame()
  assert.equal(findEscortMeeting(rumour, { blueprint: BLUEPRINT, state }, straightFrom(at()), state.tick), null)
  assert.deepEqual(fallback.target?.position, rumourTargetPoint(BLUEPRINT, rumour))
  assert.equal(fallback.target?.regionId, rumour.regionId)
})

// ---------------------------------------------------------------------------
// The run harness
// ---------------------------------------------------------------------------

test('the harness walks an escort to its meeting square under `meeting`; `cart` is the default and the control', () => {
  const review: Partial<RunOptions> = {
    faction: 'guard', policy: 'beeline', hz: 20, timeLimit: 240, meleeModel: 'honest', meleeDefence: 'heavy',
    rumourPolicy: 'commit', contractPolicy: 'nearest', doctrinePolicy: 'seeded', regionWindow: 'engine',
  }
  const strip = (report: ReturnType<typeof runHarness>) => ({ ...report, rumourSteering: null })
  let changed = 0
  let untouched = 0
  for (const seed of [1, 23_758, 126_705]) {
    const plain = runHarness({ ...review, seed } as RunOptions)
    const cart = runHarness({ ...review, seed, rumourSteering: 'cart' } as RunOptions)
    const met = runHarness({ ...review, seed, rumourSteering: 'meeting' } as RunOptions)
    // The default is the control: every pinned number in this suite walked to the cart.
    assert.equal(plain.rumourSteering, 'cart')
    assert.deepEqual(cart, plain)
    assert.equal(met.rumourSteering, 'meeting')
    // A defence or a sabotage is walked to the same spot either way, so a run that is never
    // offered an escort is the same run.
    if (!plain.rumours.offeredByKind.escort && !met.rumours.offeredByKind.escort) {
      assert.deepEqual(strip(met), strip(plain), `seed ${String(seed)}`)
      untouched += 1
    } else if (JSON.stringify(strip(met)) !== JSON.stringify(strip(plain))) {
      changed += 1
    }
  }
  assert.ok(changed > 0, `the meeting square changed no escort run (${String(untouched)} had none)`)
  // The shipped compass is what a run over the shipped arms follows once it takes rumours.
  assert.equal(HARNESS_SHIPPED_ARMS.rumourSteering, 'meeting')
})
