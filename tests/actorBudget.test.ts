import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACTOR_BUDGET,
  ACTOR_BUDGET_PRIORITY,
  ActorBudget,
  MAX_ACTORS,
  createActorBudgetUsage,
  type ActorBudgetCategory,
} from '../src/game/world/ActorBudget.ts'

function total(budget: ActorBudget): number {
  return ACTOR_BUDGET_PRIORITY.reduce(
    (sum, category) => sum + budget.getUsed(category),
    0,
  )
}

test('the reserved categories add up to the actor cap exactly', () => {
  const sum = ACTOR_BUDGET_PRIORITY.reduce(
    (value, category) => value + ACTOR_BUDGET[category],
    0,
  )
  assert.equal(sum, MAX_ACTORS)
  assert.deepEqual(ACTOR_BUDGET_PRIORITY, [
    'squad',
    'campaign',
    'chronicle',
    'ambient',
  ])
})

test('a category can always fill its own reservation', () => {
  const budget = new ActorBudget()
  for (const category of ACTOR_BUDGET_PRIORITY) {
    assert.equal(
      budget.reserve(category, ACTOR_BUDGET[category]),
      true,
      `${category} should fit its own reserve`,
    )
  }
  assert.equal(budget.total, MAX_ACTORS)
  for (const category of ACTOR_BUDGET_PRIORITY) {
    assert.equal(budget.reserve(category, 1), false)
  }
  assert.equal(budget.total, MAX_ACTORS)
})

test('the total never exceeds the actor cap under random pressure', () => {
  const budget = new ActorBudget()
  let state = 12345
  const roll = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
  for (let step = 0; step < 20000; step += 1) {
    const category =
      ACTOR_BUDGET_PRIORITY[Math.floor(roll() * ACTOR_BUDGET_PRIORITY.length)]
    const count = 1 + Math.floor(roll() * 7)
    if (roll() < 0.6) budget.reserve(category, count)
    else budget.release(category, count)
    assert.ok(budget.total <= MAX_ACTORS, `cap breached at step ${step}`)
    assert.ok(budget.getUsed(category) >= 0)
  }
})

test('a category never eats into a higher-priority reservation', () => {
  const budget = new ActorBudget()
  // Ambient can only ever use its own six, even on a completely empty world.
  assert.equal(budget.availableFor('ambient'), ACTOR_BUDGET.ambient)
  assert.equal(budget.reserve('ambient', ACTOR_BUDGET.ambient + 1), false)

  // Chronicle borrows ambient's spare capacity but not campaign's or squad's.
  assert.equal(
    budget.availableFor('chronicle'),
    ACTOR_BUDGET.chronicle + ACTOR_BUDGET.ambient,
  )
  assert.equal(
    budget.availableFor('campaign'),
    ACTOR_BUDGET.campaign + ACTOR_BUDGET.chronicle + ACTOR_BUDGET.ambient,
  )
  assert.equal(budget.availableFor('squad'), MAX_ACTORS)
})

test('ambient yields its slots first when a higher priority needs room', () => {
  const yielded: Array<[ActorBudgetCategory, number]> = []
  const budget = new ActorBudget((category, count) => {
    yielded.push([category, count])
    return count
  })
  for (const category of ACTOR_BUDGET_PRIORITY) {
    budget.reserve(category, ACTOR_BUDGET[category])
  }
  assert.equal(budget.total, MAX_ACTORS)

  // Campaign wants two more slots on a full world; ambient must give way first.
  assert.equal(budget.reserve('campaign', 2), true)
  assert.deepEqual(yielded, [['ambient', 2]])
  assert.equal(budget.getUsed('ambient'), ACTOR_BUDGET.ambient - 2)
  assert.equal(budget.getUsed('chronicle'), ACTOR_BUDGET.chronicle)
  assert.equal(budget.total, MAX_ACTORS)
})

test('chronicle yields only after ambient is exhausted', () => {
  const yielded: Array<[ActorBudgetCategory, number]> = []
  const budget = new ActorBudget((category, count) => {
    yielded.push([category, count])
    return count
  })
  budget.reserve('squad', ACTOR_BUDGET.squad)
  budget.reserve('campaign', ACTOR_BUDGET.campaign)
  budget.reserve('chronicle', ACTOR_BUDGET.chronicle)
  budget.reserve('ambient', 1)
  assert.equal(budget.total, 20)

  assert.equal(budget.reserve('campaign', 8), true)
  assert.deepEqual(yielded, [
    ['ambient', 1],
    ['chronicle', 2],
  ])
  assert.equal(budget.getUsed('ambient'), 0)
  assert.equal(budget.getUsed('chronicle'), ACTOR_BUDGET.chronicle - 2)
  assert.equal(budget.getUsed('campaign'), ACTOR_BUDGET.campaign + 8)
  assert.equal(budget.total, MAX_ACTORS)
})

test('a category that refuses to yield leaves the reservation unfilled', () => {
  const budget = new ActorBudget(() => 0)
  for (const category of ACTOR_BUDGET_PRIORITY) {
    budget.reserve(category, ACTOR_BUDGET[category])
  }
  assert.equal(budget.reserve('squad', 1), false)
  assert.equal(budget.getUsed('squad'), ACTOR_BUDGET.squad)
  assert.equal(budget.total, MAX_ACTORS)
})

test('partial reservations grant what fits and report the count', () => {
  const budget = new ActorBudget()
  budget.reserve('campaign', ACTOR_BUDGET.campaign)
  budget.reserve('chronicle', ACTOR_BUDGET.chronicle)
  assert.equal(budget.reserveUpTo('ambient', 10), ACTOR_BUDGET.ambient)
  assert.equal(budget.reserveUpTo('ambient', 4), 0)
  assert.equal(budget.total, MAX_ACTORS - ACTOR_BUDGET.squad)
  assert.equal(budget.reserveUpTo('squad', 9), ACTOR_BUDGET.squad)
  assert.equal(budget.total, MAX_ACTORS)
})

test('syncing against the live actor list clamps to the cap', () => {
  const budget = new ActorBudget()
  budget.sync({ squad: 3, campaign: 8, chronicle: 8, ambient: 6 })
  assert.equal(budget.total, MAX_ACTORS)
  budget.sync({ squad: 40, campaign: 40, chronicle: 40, ambient: 40 })
  assert.ok(budget.total <= MAX_ACTORS)
  budget.sync(createActorBudgetUsage())
  assert.equal(budget.total, 0)
  assert.equal(total(budget), 0)
})

test('releasing never drives a category below zero', () => {
  const budget = new ActorBudget()
  budget.reserve('chronicle', 2)
  budget.release('chronicle', 9)
  assert.equal(budget.getUsed('chronicle'), 0)
  budget.release('ambient', 3)
  assert.equal(budget.getUsed('ambient'), 0)
})

test('non-finite and negative counts are ignored', () => {
  const budget = new ActorBudget()
  assert.equal(budget.reserve('chronicle', Number.NaN), true)
  assert.equal(budget.reserve('chronicle', -4), true)
  assert.equal(budget.getUsed('chronicle'), 0)
  assert.equal(budget.reserveUpTo('chronicle', Number.POSITIVE_INFINITY), 0)
  assert.equal(budget.total, 0)
})

test('capacity reports what a category could take if lower priorities gave way', () => {
  const budget = new ActorBudget()
  budget.reserve('ambient', ACTOR_BUDGET.ambient)
  budget.reserve('chronicle', ACTOR_BUDGET.chronicle)
  assert.equal(budget.availableFor('campaign'), ACTOR_BUDGET.campaign)
  assert.equal(
    budget.capacityFor('campaign'),
    ACTOR_BUDGET.campaign + ACTOR_BUDGET.chronicle + ACTOR_BUDGET.ambient,
  )
  assert.equal(budget.capacityFor('ambient'), 0)
})

test('W1-6: an own-share reservation never borrows and never asks anyone to yield', () => {
  const yielded: Array<[ActorBudgetCategory, number]> = []
  const budget = new ActorBudget((category, count) => {
    yielded.push([category, count])
    return count
  })
  budget.reserve('squad', ACTOR_BUDGET.squad)
  // Campaign fills its own eight, and no ninth, however empty the world below it is.
  for (let index = 0; index < ACTOR_BUDGET.campaign; index += 1) {
    assert.equal(budget.reserveOwn('campaign', 1), true)
  }
  assert.equal(budget.ownAvailableFor('campaign'), 0)
  assert.equal(budget.availableFor('campaign'), ACTOR_BUDGET.chronicle + ACTOR_BUDGET.ambient)
  assert.equal(budget.reserveOwn('campaign', 1), false)
  assert.equal(budget.getUsed('campaign'), ACTOR_BUDGET.campaign)

  // A full world does not make it evict: it waits, even with own room left on paper.
  const crowded = new ActorBudget((category, count) => {
    yielded.push([category, count])
    return count
  })
  crowded.sync({ squad: 5, campaign: 6, chronicle: 8, ambient: 6 })
  assert.equal(crowded.total, MAX_ACTORS)
  assert.equal(crowded.ownAvailableFor('campaign'), 0)
  assert.equal(crowded.reserveOwn('campaign', 1), false)
  assert.equal(crowded.getUsed('chronicle'), ACTOR_BUDGET.chronicle)
  assert.deepEqual(yielded, [])

  // Negative control: the ordinary reservation borrows past the own share in the first
  // world, and in the full one it makes the lower categories give way.
  assert.equal(budget.reserve('campaign', 1), true)
  assert.equal(budget.getUsed('campaign'), ACTOR_BUDGET.campaign + 1)
  assert.equal(crowded.reserve('campaign', 1), true)
  assert.deepEqual(yielded, [['ambient', 1]])
})

test('W1-6: with every category inside its own share, an own-share slot leaves the room below untouched', () => {
  let state = 4242
  const roll = (limit: number): number => {
    state = (state * 1103515245 + 12345) % 2147483648
    return Math.floor((state / 2147483648) * (limit + 1))
  }
  let checked = 0
  let borrowingShrank = 0
  for (let step = 0; step < 4000; step += 1) {
    const usage = {
      squad: roll(ACTOR_BUDGET.squad),
      campaign: roll(ACTOR_BUDGET.campaign),
      chronicle: roll(ACTOR_BUDGET.chronicle),
      ambient: roll(ACTOR_BUDGET.ambient),
    }
    const own = new ActorBudget()
    own.sync(usage)
    const before = {
      chronicle: own.capacityFor('chronicle'),
      ambient: own.capacityFor('ambient'),
      chronicleOwn: own.ownAvailableFor('chronicle'),
    }
    if (!own.reserveOwn('campaign', 1)) {
      assert.equal(usage.campaign, ACTOR_BUDGET.campaign, `refused with own room at ${JSON.stringify(usage)}`)
      continue
    }
    checked += 1
    assert.deepEqual(
      {
        chronicle: own.capacityFor('chronicle'),
        ambient: own.capacityFor('ambient'),
        chronicleOwn: own.ownAvailableFor('chronicle'),
      },
      before,
      `an own-share slot shrank the room below at ${JSON.stringify(usage)}`,
    )
    // Negative control: past its own share, the borrowing reservation takes that room.
    const borrowing = new ActorBudget()
    borrowing.sync({ ...usage, campaign: ACTOR_BUDGET.campaign })
    const capacity = borrowing.capacityFor('chronicle')
    if (borrowing.reserve('campaign', 1) && borrowing.capacityFor('chronicle') < capacity) {
      borrowingShrank += 1
    }
  }
  assert.ok(checked > 1000, `only ${String(checked)} admissions were checked`)
  assert.ok(borrowingShrank > 500, `the borrowing control shrank the room only ${String(borrowingShrank)} times`)
})
