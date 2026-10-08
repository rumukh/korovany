/**
 * W2-2, PR B — the caravan spine in the run harness (`tests/runHarnessBeats.ts`).
 *
 * The beat model runs the engine's own rules on the harness's bodies. These tests hold the
 * claims the sweeps in `docs/run-harness.md` rest on: off is inert, the gate binds and never
 * strands, a crowded road waits honestly and then lets the cart through, and each arm does
 * what its name says. Each claim has a control that shows it could fail.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { ActorRole, Allegiance } from '../src/game/types.ts'
import { CARAVAN_BEAT_STAGING_GIVE_UP_SECONDS } from '../src/game/world/CaravanBeats.ts'
import { planCaravanSpine } from '../src/game/world/CaravanSpine.ts'
import { createChronicleRegions, createChronicleState } from '../src/game/world/Chronicle.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { HARNESS_SHIPPED_ARMS, runHarness } from './runHarness.ts'
import { createBeatHarness, type BeatBody, type BeatPort } from './runHarnessBeats.ts'

const spineRun = (overrides: Record<string, unknown> = {}) => runHarness({
  ...HARNESS_SHIPPED_ARMS,
  seed: 1,
  faction: 'villain',
  policy: 'beeline',
  hz: 30,
  timeLimit: 600,
  ...overrides,
})

test('off is inert: no caravans, the camp and the finale as every pinned run has them', () => {
  const port = {} as BeatPort
  const off = createBeatHarness(port, {
    model: 'off', beatPolicy: 'engage', openingPolicy: 'seeded', verbPolicy: 'seeded',
  })
  assert.equal(off.on, false)
  assert.deepEqual(off.gate(), { finaleOpen: true })
  assert.equal(off.holdsCamp(), false)
  assert.equal(off.campNodeId(), null)
  assert.equal(off.progressSteps(), 0)
  assert.equal(off.holdsRandomEvents(120), false)
  assert.equal(off.goal(true), null)
  assert.equal(off.metrics(0), null)
  // The shipped arms carry the spine since it was folded in; `off` is the run before it,
  // and the default an arm left out has.
  assert.equal(HARNESS_SHIPPED_ARMS.caravanBeats, 'shipped')
  const options = { seed: 1, faction: 'villain', policy: 'beeline', hz: 30, timeLimit: 120 } as const
  const report = runHarness({ ...HARNESS_SHIPPED_ARMS, ...options, caravanBeats: 'off' })
  assert.equal(report.caravanBeats, 'off')
  assert.equal(report.balance.beats, null)
  const { caravanBeats: _spine, ...withoutSpine } = HARNESS_SHIPPED_ARMS
  assert.deepEqual(runHarness({ ...withoutSpine, ...options }), report, 'off is the default')
})

test('a spine run decides the camp at a cart, opens the finale after two, and pays from the shipped table', () => {
  const report = spineRun()
  const beats = report.balance.beats
  assert.ok(beats)
  assert.equal(beats.planned, planCaravanSpine(generateWorld(1), 'villain').plans.length)
  assert.ok(beats.opening, 'a camp offer was met')
  assert.equal(beats.endings.declined, 1, 'the other offer went its own way')
  assert.ok(beats.campClosedAt !== null && beats.gateOpenedAt !== null)
  assert.ok(beats.gateOpenedAt >= beats.campClosedAt)
  const settled = ['resolved', 'lost', 'escaped', 'unavailable']
    .reduce((sum, phase) => sum + (beats.endings[phase] ?? 0), 0)
  assert.ok(settled >= 2, `settled ${settled}`)
  // Every gold piece a cart paid went through the run's purse under its own source.
  assert.equal(report.balance.sustain.goldBySource.caravanBeat ?? 0, beats.goldEarned)
  const met = (beats.endings.resolved ?? 0) + (beats.endings.lost ?? 0) + (beats.endings.escaped ?? 0)
  assert.equal(beats.progressSteps, Math.floor(met / 2), 'W2-1 counts two met carts as a step')
  // The finale was fought after the gate, and the camp is closed among the objectives.
  assert.notEqual(report.balance.finaleTier, null)
  assert.ok(report.objectives.some((objective) => objective.completedAt !== null &&
    objective.completedAt === beats.campClosedAt))
  // Deterministic: the same run twice is the same run.
  assert.equal(JSON.stringify(spineRun()), JSON.stringify(report))
})

test('the gate binds: a player who never meets a caravan never reaches the finale', () => {
  const ignoring = spineRun({ beatPolicy: 'ignore' })
  assert.notEqual(ignoring.outcome, 'victory')
  assert.equal(ignoring.balance.finaleTier, null, 'the finale never fielded its garrison')
  assert.equal(ignoring.balance.beats?.campClosedAt, null, 'the camp waits for a caravan')
  assert.equal(ignoring.balance.beats?.gateOpenedAt, null)
  // Control: the same run that meets its caravans gets there.
  assert.notEqual(spineRun().balance.finaleTier, null)
})

test('walking away settles every cart by its clock, and the gate still opens', () => {
  const walking = spineRun({ beatPolicy: 'walk', policy: 'duelist' })
  const beats = walking.balance.beats
  assert.ok(beats)
  assert.deepEqual(beats.verbs, {}, 'nothing was chosen at a cart')
  assert.ok((beats.endings.escaped ?? 0) + (beats.endings.lost ?? 0) >= 2,
    `walked-away endings ${JSON.stringify(beats.endings)}`)
  assert.notEqual(beats.campClosedAt, null)
  assert.notEqual(beats.gateOpenedAt, null)
  assert.equal(beats.goldEarned, 0)
})

function fakePort(room: () => boolean) {
  const blueprint = generateWorld(20_260_909)
  const bodies = new Map<string, BeatBody>()
  const calls: string[] = []
  const plans = planCaravanSpine(blueprint, 'elf').plans
  const offer = plans.find((plan) => plan.slot === 'offer')
  assert.ok(offer)
  const player = { x: offer.cargoStart.x, z: offer.cargoStart.z }
  const port: BeatPort = {
    faction: 'elf',
    blueprint,
    player,
    chronicleState: createChronicleState(),
    chronicleRegions: createChronicleRegions(blueprint),
    caravanMetrics: { robbed: 0, robbedBy: {}, escorted: 0, escortedBy: {}, lost: 0, lostBy: {} },
    body: (id) => bodies.get(id),
    regionSimulated: () => true,
    makeWay: () => { calls.push('makeWay') },
    reserveCampaign: () => {
      calls.push('reserve')
      return room()
    },
    spawn: (input: { id: string; allegiance: Allegiance; role: ActorRole; x: number; z: number }) => {
      const body = { id: input.id, x: input.x, z: input.z, alive: true, hp: 60, maxHp: 60 }
      bodies.set(input.id, body)
      return body
    },
    remove: (id) => { bodies.delete(id) },
    setProp: () => {},
    propHp: () => null,
    earnGold: () => {},
    addSupplies: () => {},
    squadSize: () => 3,
    recruit: () => false,
    thinFinale: () => null,
  }
  return { port, plans, bodies, calls }
}

test('a crowded road holds a cart honestly, makes way first, and then lets it through', () => {
  const { port, bodies, calls } = fakePort(() => false)
  const beats = createBeatHarness(port, {
    model: 'shipped', beatPolicy: 'engage', openingPolicy: 'seeded', verbPolicy: 'seeded',
  })
  let elapsed = 0
  const step = (seconds: number) => {
    elapsed += seconds
    beats.step(seconds, elapsed)
  }
  // Walk to whichever offer the policy took; the fixture's player stands at the first.
  const chosen = beats.goal(false)
  assert.ok(chosen)
  port.player.x = chosen.point.x
  port.player.z = chosen.point.z
  step(0.5)
  assert.deepEqual(calls.slice(0, 2), ['makeWay', 'reserve'], 'W1-1 makes way before the slots are asked')
  assert.equal(bodies.size, 0)
  for (let index = 0; index < 2 * CARAVAN_BEAT_STAGING_GIVE_UP_SECONDS + 4; index += 1) step(0.5)
  const metrics = beats.metrics(elapsed)
  assert.ok(metrics)
  assert.equal(metrics.stagingStalls, 1)
  assert.equal(metrics.stagingFailForwards, 1)
  assert.ok(Math.abs(metrics.stagingStallSeconds - CARAVAN_BEAT_STAGING_GIVE_UP_SECONDS) < 0.6)
  assert.equal(metrics.endings.unavailable, 1)
  assert.equal(beats.holdsCamp(), false, 'the camp settles on the cart that went through')

  // Control: with room the same cart stages on the first try and nothing waits.
  const roomy = fakePort(() => true)
  const staged = createBeatHarness(roomy.port, {
    model: 'shipped', beatPolicy: 'engage', openingPolicy: 'seeded', verbPolicy: 'seeded',
  })
  const target = staged.goal(false)
  assert.ok(target)
  roomy.port.player.x = target.point.x
  roomy.port.player.z = target.point.z
  staged.step(0.5, 0.5)
  assert.ok(roomy.bodies.size >= 2)
  assert.equal(staged.metrics(0.5)?.stagingStalls, 0)
})

test('the arms do what they say: K, steps per cart, the opening and the verbs', () => {
  // Two met carts per W2-1 step is shipped; one per step is the measured alternative.
  const shipped = spineRun({ policy: 'duelist' })
  const each = spineRun({ policy: 'duelist', beatsPerProgressStep: 1 })
  const met = (report: ReturnType<typeof spineRun>) => {
    const endings = report.balance.beats?.endings ?? {}
    return (endings.resolved ?? 0) + (endings.lost ?? 0) + (endings.escaped ?? 0)
  }
  assert.equal(shipped.balance.beats?.progressSteps, Math.floor(met(shipped) / 2))
  assert.equal(each.balance.beats?.progressSteps, met(each))
  // K = 0 opens the finale with the camp; K = 3 asks for one more cart than the shipped two.
  const open = spineRun({ beatGate: 0 })
  assert.ok((open.balance.beats?.gateOpenedAt ?? Infinity) <= (open.balance.beats?.campClosedAt ?? Infinity))
  // The opening arms take the offer they name.
  assert.equal(spineRun({ openingPolicy: 'trunk' }).balance.beats?.opening?.onTrunk, true)
  assert.equal(spineRun({ openingPolicy: 'rich' }).balance.beats?.opening?.tier, 'rich')
  // `gold` takes the side's first verb, `nonGold` the next.
  const gold = spineRun({ verbPolicy: 'gold' }).balance.beats?.verbs ?? {}
  assert.deepEqual(Object.keys(gold).filter((verb) => verb !== 'plunder'), [])
  const nonGold = spineRun({ verbPolicy: 'nonGold' }).balance.beats?.verbs ?? {}
  assert.equal(nonGold.plunder ?? 0, 0)
})
