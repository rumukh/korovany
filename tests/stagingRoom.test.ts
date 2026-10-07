/**
 * W1-6 — `world/StagingRoom.ts`, the rule both the engine and the run harness use to decide
 * which of the player's own packs may step back for a staging, and when they come home.
 *
 * Every rule is checked on real generator output where there is one, and every claim has a
 * negative control: the same input with one thing changed, which has to flip the answer.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { createGeneratedEncounterPlans, type GeneratedEncounterPlan } from '../src/game/content/registry.ts'
import {
  ACTOR_BUDGET,
  ACTOR_BUDGET_PRIORITY,
  ActorBudget,
  MAX_ACTORS,
  type ActorBudgetCategory,
  type ActorBudgetUsage,
} from '../src/game/world/ActorBudget.ts'
import {
  STAGING_PARK_MIN_DISTANCE,
  STAGING_POST_RADIUS,
  STAGING_VIEW_MARGIN,
  canParkPack,
  canReturnPack,
  choosePacksToPark,
  gatherStagingPacks,
  horizontalHalfFov,
  isAtPost,
  isHiddenFrom,
  isParkableEncounterPlan,
  packDistance,
  parkableBodies,
  stagingCapacity,
  type StagingBody,
  type StagingPack,
  type StagingPoint,
  type StagingViewer,
} from '../src/game/world/StagingRoom.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'

const DEGREE = Math.PI / 180
/** `CAMERA_BASE_FOV` on a 16:9 screen. */
const HALF_FOV = horizontalHalfFov(56, 16 / 9)

/** The player at the origin, the camera 12 m behind, both looking north (−z). */
function viewer(overrides: Partial<StagingViewer> = {}): StagingViewer {
  return {
    player: { x: 0, z: 0 },
    camera: { x: 0, z: 12 },
    forward: { x: 0, z: -1 },
    halfFov: HALF_FOV,
    ...overrides,
  }
}

/** A point `distance` from the camera, `degrees` off its view axis, on the right. */
function offAxis(degrees: number, distance: number): StagingPoint {
  return { x: Math.sin(degrees * DEGREE) * distance, z: 12 - Math.cos(degrees * DEGREE) * distance }
}

function pack(key: string, members: StagingPoint[], busy = false): StagingPack {
  return { key, regionId: `region-${key}`, members, busy }
}

/** `count` bodies standing `away` metres south of the player: behind the camera. */
function behind(away: number, count: number): StagingPoint[] {
  return Array.from({ length: count }, (_, index) => ({ x: index, z: away }))
}

const plans = Object.values(createGeneratedEncounterPlans(generateWorld(1), 'guard'))

function planOf(predicate: (plan: GeneratedEncounterPlan) => boolean, what: string): GeneratedEncounterPlan {
  const found = plans.find(predicate)
  assert.ok(found, `seed 1 has no ${what} for the guard`)
  return found
}

test('only the player\'s own ordinary packs may step back', () => {
  const own = planOf((plan) => !plan.hostileToPlayer && plan.kind !== 'boss', 'friendly ordinary pack')
  const enemy = planOf((plan) => plan.hostileToPlayer && plan.kind !== 'boss', 'hostile ordinary pack')
  const stronghold = planOf((plan) => plan.kind === 'boss', 'boss slot')
  assert.equal(isParkableEncounterPlan(own), true)
  // Negative controls, one flag each: enemies, a boss slot, and any unique or objective body.
  assert.equal(isParkableEncounterPlan(enemy), false)
  assert.equal(isParkableEncounterPlan({ ...own, hostileToPlayer: true }), false)
  assert.equal(isParkableEncounterPlan(stronghold), false)
  assert.equal(isParkableEncounterPlan({ ...own, kind: 'boss' }), false)
  for (const flag of ['unique', 'objective', 'objectiveEligible'] as const) {
    const [first, ...rest] = own.spawns
    assert.equal(
      isParkableEncounterPlan({ ...own, spawns: [{ ...first, [flag]: true }, ...rest] }),
      false,
      `a pack with a ${flag} body stepped back`,
    )
  }
})

test('gathering asks only about packs that may step back, and keeps the living', () => {
  const own = planOf((plan) => !plan.hostileToPlayer && plan.kind !== 'boss', 'friendly ordinary pack')
  const enemy = planOf((plan) => plan.hostileToPlayer && plan.kind !== 'boss', 'hostile ordinary pack')
  const body = (x: number, extra: Partial<StagingBody> = {}): StagingBody => ({
    alive: true,
    hostileToPlayer: false,
    x,
    z: 0,
    busy: false,
    untouchable: false,
    ...extra,
  })
  const asked: string[] = []
  const field = new Map<string, StagingBody[]>([
    [own.encounterId, [body(1), body(2, { alive: false }), body(3)]],
    [enemy.encounterId, [body(9, { hostileToPlayer: true })]],
  ])
  const gather = (overrides: Map<string, StagingBody[]> = field) =>
    gatherStagingPacks(['region-a'], () => [own, enemy], (regionId, encounterId) => {
      asked.push(`${regionId}/${encounterId}`)
      return overrides.get(encounterId) ?? []
    })
  const [gathered, ...others] = gather()
  assert.deepEqual(others, [])
  assert.deepEqual(asked, [`region-a/${own.encounterId}`], 'an enemy pack was looked at')
  assert.equal(gathered.key, own.encounterId)
  assert.equal(gathered.regionId, 'region-a')
  assert.deepEqual(gathered.members, [{ x: 1, z: 0 }, { x: 3, z: 0 }], 'the fallen were counted as members')
  assert.equal(gathered.busy, false)
  // One busy, untouchable or hostile member keeps the whole pack on the field.
  for (const spoiler of [{ busy: true }, { untouchable: true }, { hostileToPlayer: true }]) {
    const [spoiled] = gather(new Map([[own.encounterId, [body(1), body(3, spoiler)]]]))
    assert.equal(spoiled.busy, true, `${JSON.stringify(spoiler)} did not hold the pack`)
  }
  // Nobody alive, no pack.
  assert.deepEqual(gather(new Map([[own.encounterId, [body(1, { alive: false })]]])), [])
})

test('the view cone is the camera\'s, widened by the margin, and has no far edge', () => {
  assert.ok(Math.abs(horizontalHalfFov(56, 1) - 28 * DEGREE) < 1e-12)
  assert.ok(Math.abs(HALF_FOV / DEGREE - 43.39) < 0.01)
  const view = viewer()
  // Straight ahead is in sight however far off, behind is not.
  assert.equal(isHiddenFrom(view, offAxis(0, 500)), false)
  assert.equal(isHiddenFrom(view, offAxis(180, 70)), true)
  assert.equal(isHiddenFrom(view, offAxis(-120, 70)), true)
  // Just past the screen's edge is still inside the margin; past the margin is out of sight.
  const edge = (HALF_FOV + STAGING_VIEW_MARGIN) / DEGREE
  assert.equal(isHiddenFrom(view, offAxis(HALF_FOV / DEGREE + 5, 80)), false, 'the margin is not applied')
  assert.equal(isHiddenFrom(view, offAxis(edge - 0.5, 80)), false)
  assert.equal(isHiddenFrom(view, offAxis(edge + 0.5, 80)), true)
  assert.equal(isHiddenFrom(view, offAxis(-(edge + 0.5), 80)), true)
  // The length of the view direction does not matter; its absence does.
  assert.equal(isHiddenFrom(viewer({ forward: { x: 0, z: -7 } }), offAxis(edge + 0.5, 80)), true)
  assert.equal(isHiddenFrom(viewer({ forward: { x: 0, z: 0 } }), offAxis(180, 70)), false)
  assert.equal(isHiddenFrom(view, { x: Number.NaN, z: 70 }), false)
  // The cone is the camera's: a body beside the player is in front of a camera behind them.
  const beside = { x: 15, z: 0 }
  assert.equal(isHiddenFrom(view, beside), false)
  assert.equal(isHiddenFrom(viewer({ camera: { x: 0, z: 0 } }), beside), true)
})

test('a pack steps back only when every member is far, unseen and the pack is idle', () => {
  const view = viewer()
  const far = STAGING_PARK_MIN_DISTANCE
  assert.equal(canParkPack(view, pack('a', behind(far, 3))), true)
  assert.equal(packDistance(view, pack('a', [...behind(far + 30, 1), ...behind(far + 5, 1)])), far + 5)
  // Negative controls: one member a step too close, one in sight, a busy pack, an empty one.
  assert.equal(canParkPack(view, pack('a', [...behind(far, 2), ...behind(far - 1, 1)])), false)
  assert.equal(canParkPack(view, pack('a', [...behind(far, 2), offAxis(0, 90)])), false)
  assert.equal(canParkPack(view, pack('a', behind(far, 3), true)), false)
  assert.equal(canParkPack(view, pack('a', [])), false)
  // Coming home answers to the same two rules, on the stations.
  assert.equal(canReturnPack(view, behind(far, 3), false), true)
  assert.equal(canReturnPack(view, [...behind(far, 2), ...behind(far - 1, 1)], false), false)
  assert.equal(canReturnPack(view, [...behind(far, 2), offAxis(10, 90)], false), false)
  assert.equal(canReturnPack(view, [], false), false)
})

test('the empty-post rule: walk up to the post, and only sight keeps its pack away', () => {
  const view = viewer()
  // 20 m behind the player is 8 m behind the camera: out of sight, but well inside 60 m.
  const post = behind(20, 2)
  assert.equal(isAtPost(view, post), true)
  assert.equal(canReturnPack(view, post, true), true)
  // Negative control: without the call home, the same stations are too near to come back to.
  assert.equal(canReturnPack(view, post, false), false)
  // Called home or not, a station in sight keeps the pack away: in front of the player, and
  // just behind them, where it stands between the camera and the player.
  assert.equal(canReturnPack(view, [...post, { x: 0, z: -15 }], true), false)
  assert.equal(canReturnPack(view, [...post, { x: 0, z: 5 }], true), false)
  // The post is any station within the radius, the edge included.
  assert.equal(isAtPost(view, [{ x: 0, z: STAGING_POST_RADIUS }, { x: 0, z: 90 }]), true)
  assert.equal(isAtPost(view, [{ x: 0, z: STAGING_POST_RADIUS + 0.5 }, { x: 0, z: 90 }]), false)
  assert.equal(isAtPost(view, []), false)
})

test('the farthest packs step back first, and only as many as the staging is short', () => {
  const view = viewer()
  const near = pack('near', behind(70, 2))
  const middle = pack('middle', behind(90, 3))
  const far = pack('far', behind(120, 2))
  const all = [near, middle, far]
  assert.deepEqual(choosePacksToPark(view, all, 0), [])
  assert.deepEqual(choosePacksToPark(view, all, 2)?.map((entry) => entry.key), ['far'])
  assert.deepEqual(choosePacksToPark(view, all, 3)?.map((entry) => entry.key), ['far', 'middle'])
  assert.deepEqual(choosePacksToPark(view, all, 7)?.map((entry) => entry.key), ['far', 'middle', 'near'])
  assert.equal(parkableBodies(view, all), 7)
  // Nobody goes for a staging the eligible packs could not cover.
  assert.equal(choosePacksToPark(view, all, 8), null)
  // An ineligible pack is passed over, however far it stands.
  const busyFar = pack('far', behind(120, 2), true)
  assert.deepEqual(choosePacksToPark(view, [near, middle, busyFar], 2)?.map((entry) => entry.key), ['middle'])
  assert.equal(parkableBodies(view, [near, middle, busyFar]), 5)
  // The choice does not depend on the order the packs were listed in, ties included.
  const twinA = pack('twin-a', behind(100, 1))
  const twinB = pack('twin-b', behind(100, 1))
  for (const order of [[twinA, twinB], [twinB, twinA]]) {
    assert.deepEqual(choosePacksToPark(view, order, 1)?.map((entry) => entry.key), ['twin-a'])
  }
})

/**
 * The slots `category` gets by asking a real `ActorBudget` for more and more, with every
 * category below it yielding all it holds except `pinned`: what `stagingCapacity` claims to
 * compute without asking.
 */
function bruteForceRoom(
  usage: ActorBudgetUsage,
  category: ActorBudgetCategory,
  pinned: Partial<ActorBudgetUsage>,
): number {
  let best = 0
  for (let wanted = 1; wanted <= MAX_ACTORS; wanted += 1) {
    const held = { ...usage }
    const budget = new ActorBudget((other, count) => {
      const freed = Math.min(count, Math.max(0, held[other] - (pinned[other] ?? 0)))
      held[other] -= freed
      return freed
    })
    budget.sync(held)
    if (budget.reserve(category, wanted)) best = wanted
  }
  return best
}

function* usages(): Generator<ActorBudgetUsage> {
  let state = 0x5eed
  const next = (limit: number): number => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    return state % (limit + 1)
  }
  for (let index = 0; index < 400; index += 1) {
    const usage: ActorBudgetUsage = {
      squad: next(ACTOR_BUDGET.squad),
      campaign: next(18),
      chronicle: next(ACTOR_BUDGET.chronicle),
      ambient: next(ACTOR_BUDGET.ambient),
    }
    const total = ACTOR_BUDGET_PRIORITY.reduce((sum, category) => sum + usage[category], 0)
    if (total <= MAX_ACTORS) yield usage
  }
}

test('the room a staging could have is what the budget would grant once the rest yielded', () => {
  let checked = 0
  let pinnedMattered = 0
  for (const usage of usages()) {
    // Nothing pinned: exactly `capacityFor`, which W1-1's dry run reads.
    const ledger = new ActorBudget()
    ledger.sync(usage)
    assert.equal(stagingCapacity(usage, 'chronicle'), ledger.capacityFor('chronicle'), JSON.stringify(usage))
    // A contract's own bodies never yield, in whichever category they stand.
    const pinned: Partial<ActorBudgetUsage> = {
      chronicle: Math.min(usage.chronicle, 4),
      ambient: Math.min(usage.ambient, 1),
    }
    for (const category of ['campaign', 'chronicle'] as const) {
      const expected = bruteForceRoom(usage, category, pinned)
      assert.equal(stagingCapacity(usage, category, pinned), expected, `${category} ${JSON.stringify(usage)}`)
      // Negative control: forgetting the pins over-promises whenever a pinned body is binding.
      if (stagingCapacity(usage, category) !== expected) pinnedMattered += 1
    }
    checked += 1
  }
  assert.ok(checked >= 100, `only ${String(checked)} usages were checked`)
  assert.ok(pinnedMattered > 0, 'no case where the pins mattered, so the check proves nothing')
})
