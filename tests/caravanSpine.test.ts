/**
 * W2-2, PR B — «грабить корованы» as the spine of every run: where the caravans stand, the
 * camp's choice, the finale's gate, and the saves that carry them.
 *
 * Pure claims about `world/CaravanSpine.ts` and the spine rules in `world/CaravanBeats.ts`,
 * each with a control that shows the claim can fail. The engine's side (the camp held and
 * closed, the gate on the finale's spawn, the staging seam) is in `tests/caravanBeats.test.ts`,
 * on the production engine methods.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { getSiteWorldPosition2D, isInsideRegionWater } from '../src/game/content/registry.ts'
import type { SerializableState } from '../src/game/run/runTypes.ts'
import type { Faction } from '../src/game/types.ts'
import {
  CARAVAN_BEAT_STAGING_GIVE_UP_SECONDS,
  CARAVAN_SPINE_FINALE_GATE,
  caravanSpineGate,
  caravanSpineHoldsCamp,
  caravanSpineLeads,
  caravanSpineMetCount,
  caravanSpineProgressBeats,
  chooseCaravanOffer,
  createCaravanBeatPlans,
  createCaravanBeatsState,
  createUnavailableCaravanBeatState,
  declineOtherCaravanOffers,
  isCaravanBeatDormant,
  isCaravanOpeningSettled,
  normalizeCaravanBeatsState,
  serializeCaravanBeatsState,
  type CaravanBeatPlan,
  type CaravanBeatState,
  type CaravanBeatsState,
} from '../src/game/world/CaravanBeats.ts'
import {
  CARAVAN_LANE_CAMP_CLEARANCE,
  CARAVAN_LANE_CROSSING_CLEARANCE,
  CARAVAN_LANE_FINALE_CLEARANCE,
  CARAVAN_LANE_OBJECTIVE_CLEARANCE,
  CARAVAN_OFFER_SEPARATION,
  CARAVAN_ROAD_BEAT_CROSSING_GAP,
  CARAVAN_ROAD_BEAT_OFFER_GAP,
  createCaravanSpine,
  planCaravanSpine,
  restoreCaravanSpine,
} from '../src/game/world/CaravanSpine.ts'
import { getExpeditionGraph } from '../src/game/world/ExpeditionPlanner.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { WORLD_FACTIONS, type WorldBlueprint } from '../src/game/world/worldTypes.ts'

type Point = { x: number; z: number }
const distance = (first: Point, second: Point) => Math.hypot(first.x - second.x, first.z - second.z)
const SEEDS = 500

function objectiveSites(blueprint: WorldBlueprint, faction: Faction): Point[] {
  return blueprint.objectives[faction].nodes
    .filter((node) => node.siteId !== blueprint.starts[faction])
    .map((node) => getSiteWorldPosition2D(blueprint, node.siteId))
    .filter((point): point is Point => point !== undefined && point !== null)
}

/** A cart that has had its fight: spawned, every enemy down, the cargo whole. */
function settle(beat: CaravanBeatState, ending: 'resolved' | 'lost' | 'escaped' | 'unavailable'): void {
  beat.phase = ending
}

test('every world gets its caravans on its own roads: deterministic, dry, apart, and the world untouched', () => {
  const patterns = new Map<string, number>()
  const placements = new Map<string, number>()
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)
  let lanesNearObjectives = 0
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const blueprint = generateWorld(seed)
    const before = JSON.stringify(blueprint)
    const fingerprint = blueprint.fingerprint
    const graph = getExpeditionGraph(blueprint)
    for (const faction of WORLD_FACTIONS) {
      const spine = planCaravanSpine(blueprint, faction)
      const { plans } = spine
      bump(patterns, `${faction}:${spine.opening}`)
      // The camp, the crossing and the road beat: never fewer than two, so the gate is met.
      assert.ok(plans.length >= 2, `${seed}/${faction} plans ${plans.length}`)
      assert.equal(new Set(plans.map((plan) => plan.id)).size, plans.length, `${seed}/${faction} ids`)
      assert.equal(caravanSpineGate(createCaravanBeatsState(plans, true)).required, CARAVAN_SPINE_FINALE_GATE)
      const crossing = plans.find((plan) => plan.slot === 'crossing') ?? null
      const offers = plans.filter((plan) => plan.slot === 'offer')
      const road = plans.find((plan) => plan.slot === 'road') ?? null
      assert.deepEqual(plans.map((plan) => plan.slot), [
        ...offers.map(() => 'offer'), ...(crossing ? ['crossing'] : []), ...(road ? ['road'] : []),
      ], 'offers first, then the crossing, then the road beat')
      const camp = getSiteWorldPosition2D(blueprint, blueprint.starts[faction])
      const finale = getSiteWorldPosition2D(blueprint, blueprint.finales[faction])
      const sites = objectiveSites(blueprint, faction)
      for (const plan of [...offers, ...(road ? [road] : [])]) {
        bump(placements, `${faction}:${plan.slot}:${plan.placement}`)
        const tag = `${seed}/${faction}/${plan.id}`
        for (const point of [plan.cargoStart, plan.deliveryEnd]) {
          assert.equal(isInsideRegionWater(blueprint, plan.regionId, point.x, point.z, 1.4), false, `${tag} wet`)
        }
        assert.ok(sites.every((site) => distance(site, plan.anchor) >= CARAVAN_LANE_OBJECTIVE_CLEARANCE), `${tag} objective`)
        assert.ok(!camp || distance(camp, plan.anchor) >= CARAVAN_LANE_CAMP_CLEARANCE, `${tag} camp`)
        assert.ok(!finale || distance(finale, plan.anchor) >= CARAVAN_LANE_FINALE_CLEARANCE, `${tag} finale`)
        assert.ok(!crossing || distance(crossing.cargoStart, plan.anchor) >= CARAVAN_LANE_CROSSING_CLEARANCE, `${tag} bridge`)
        assert.equal(plan.openingRoute.status, 'road', `${tag} opening route`)
        assert.equal(plan.deliveryRoute.status, 'road', `${tag} delivery route`)
        assert.equal(plan.bridgeId, null)
      }
      if (offers.length === 2) {
        assert.ok(distance(offers[0].anchor, offers[1].anchor) >= CARAVAN_OFFER_SEPARATION, `${seed}/${faction} offers`)
        assert.deepEqual(offers.map((plan) => plan.tier).sort(), ['light', 'rich'])
        assert.notEqual(offers[0].owner === offers[1].owner && offers[0].role === offers[1].role, true)
        if (faction === 'guard') {
          assert.deepEqual(offers.map((plan) => plan.role).sort(), ['defend', 'rob'], 'an escort and a raid')
          assert.ok(offers.every((plan) => plan.role === 'defend' ? plan.owner === 'guard' : plan.owner !== 'guard'))
        } else {
          assert.ok(offers.every((plan) => plan.role === 'rob' && plan.owner !== faction), 'robbing the others')
        }
      }
      if (road) {
        for (const offer of offers) assert.ok(distance(offer.anchor, road.anchor) >= CARAVAN_ROAD_BEAT_OFFER_GAP)
        const along = spine.along.get(road.id)
        const crossingAlong = crossing ? spine.along.get(crossing.id) : null
        assert.notEqual(along, null, `${seed}/${faction} the road beat is on the way`)
        if (typeof along === 'number' && typeof crossingAlong === 'number') {
          assert.ok(Math.abs(along - crossingAlong) >= CARAVAN_ROAD_BEAT_CROSSING_GAP - 1e-6)
        }
      }
      // The control for the objective rule: candidate legs it turned away exist, so the rule
      // decides something and the assertion above is not true of every lane by accident.
      for (const leg of graph.roads) {
        const length = Math.hypot(leg.edge.x - leg.center.x, leg.edge.z - leg.center.z)
        if (!leg.traversable || length < 37) continue
        const mid = {
          x: leg.center.x + (leg.edge.x - leg.center.x) / length * 24,
          z: leg.center.z + (leg.edge.z - leg.center.z) / length * 24,
        }
        if (sites.some((site) => distance(site, mid) < CARAVAN_LANE_OBJECTIVE_CLEARANCE)) lanesNearObjectives += 1
      }
    }
    assert.equal(JSON.stringify(blueprint), before, `seed ${seed}: the planner wrote to the blueprint`)
    assert.equal(blueprint.fingerprint, fingerprint)
    if (seed % 50 === 0) {
      // Deterministic: a fresh world of the same seed plans the very same caravans.
      const again = generateWorld(seed)
      for (const faction of WORLD_FACTIONS) {
        assert.equal(JSON.stringify(planCaravanSpine(again, faction)), JSON.stringify(planCaravanSpine(blueprint, faction)))
      }
    }
  }
  assert.ok(lanesNearObjectives > SEEDS, 'the objective rule never had a candidate to turn away')
  for (const faction of WORLD_FACTIONS) {
    const count = (pattern: string) => patterns.get(`${faction}:${pattern}`) ?? 0
    // A real choice in almost every world: two offers, on two roads in most of them.
    assert.ok(count('twoRoads') + count('wide') >= SEEDS * 0.9, `${faction} pairs`)
    assert.ok(count('twoRoads') >= SEEDS * 0.5, `${faction} two roads`)
    assert.ok(count('none') <= SEEDS * 0.01, `${faction} none`)
  }
  // The letter's zones: the elves meet their caravans in the forest, the guard on the
  // palace's open roads, the villain on the passes by his fort.
  const share = (faction: Faction, placement: string) => {
    let total = 0
    let hit = 0
    for (const [key, value] of placements) {
      if (!key.startsWith(`${faction}:offer:`)) continue
      total += value
      if (key.endsWith(`:${placement}`)) hit += value
    }
    return hit / total
  }
  assert.ok(share('elf', 'forest') > 0.5, 'elf offers in the forest')
  assert.ok(share('guard', 'open') > 0.5, 'guard offers on open roads')
  assert.ok(share('villain', 'pass') > 0.5, 'villain offers on the passes')
})

/**
 * The never-strand proof. For each world, every way the camp's choice can go (either offer
 * met, or neither stageable) and every combination of endings for every other cart, settled
 * one at a time: the camp settles when its cart does, the gate opens exactly when enough carts
 * have settled, and when every cart has settled the finale is open.
 */
type Ending = 'resolved' | 'lost' | 'escaped' | 'unavailable'
const ENDINGS: readonly Ending[] = ['resolved', 'lost', 'escaped', 'unavailable']

function simulateNeverStrands(
  plans: readonly CaravanBeatPlan[],
  gateOpen: (state: CaravanBeatsState) => boolean,
): boolean {
  const offers = plans.filter((plan) => plan.slot === 'offer')
  const openings: (string | null)[] = [...offers.map((plan) => plan.id), null]
  for (const met of openings) {
    const rest = plans.filter((plan) => plan.slot !== 'offer').map((plan) => plan.id)
    const combos = ENDINGS.length ** rest.length
    for (const metEnding of met === null ? (['unavailable'] as Ending[]) : ENDINGS) {
      for (let combo = 0; combo < combos; combo += 1) {
        const state = createCaravanBeatsState(plans, true)
        const beat = (id: string) => state.beats.find((entry) => entry.id === id) as CaravanBeatState
        if (met === null) {
          for (const offer of offers) settle(beat(offer.id), 'unavailable')
        } else {
          beat(met).phase = 'fighting'
          declineOtherCaravanOffers(plans, state, met)
          // A cart being fought is not a settled one: the camp still holds.
          if (!caravanSpineHoldsCamp(plans, state)) return false
          settle(beat(met), metEnding)
        }
        if (caravanSpineHoldsCamp(plans, state)) return false
        if (plans.some((plan) => isCaravanBeatDormant(plan, plans, state))) return false
        let code = combo
        for (const id of rest) {
          settle(beat(id), ENDINGS[code % ENDINGS.length])
          code = Math.floor(code / ENDINGS.length)
        }
        if (!gateOpen(state)) return false
      }
    }
  }
  return true
}

test('no run is ever stranded: every ending counts, the gate is clamped, and the camp always settles', () => {
  const fullGate = (state: CaravanBeatsState) => caravanSpineGate(state).open
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const blueprint = generateWorld(seed)
    for (const faction of WORLD_FACTIONS) {
      const { plans } = planCaravanSpine(blueprint, faction)
      assert.ok(simulateNeverStrands(plans, fullGate), `${seed}/${faction} stranded`)
    }
  }

  const { plans } = planCaravanSpine(generateWorld(20_260_909), 'villain')
  // Control 1: a gate that counted only the carts robbed or walked in would wait for ever on
  // a run whose carts were lost, escaped or never staged. The simulation catches it.
  const resolvedOnly = (state: CaravanBeatsState) =>
    state.beats.filter((beat) => beat.phase === 'resolved').length >= CARAVAN_SPINE_FINALE_GATE
  assert.equal(simulateNeverStrands(plans, resolvedOnly), false)
  // Control 2: an unclamped gate on a world with fewer carts than it asks for never opens;
  // the shipped gate asks for what is there.
  const twoOffers = plans.filter((plan) => plan.slot === 'offer')
  assert.equal(twoOffers.length, 2)
  const unclamped = (state: CaravanBeatsState) =>
    state.beats.filter((beat) => ['resolved', 'lost', 'escaped', 'unavailable'].includes(beat.phase)).length >=
      CARAVAN_SPINE_FINALE_GATE
  assert.equal(simulateNeverStrands(twoOffers, unclamped), false)
  assert.equal(simulateNeverStrands(twoOffers, fullGate), true)
  assert.equal(caravanSpineGate(createCaravanBeatsState(twoOffers.slice(0, 1), true)).required, 1)
})

test('the camp holds the run until a caravan is met: choice, decline, dormancy and progress', () => {
  const blueprint = generateWorld(20_260_909)
  const { plans, state } = createCaravanSpine(blueprint, 'elf')
  const [first, second] = plans.filter((plan) => plan.slot === 'offer')
  const crossing = plans.find((plan) => plan.slot === 'crossing')
  assert.ok(first && second && crossing)
  const beat = (id: string) => state.beats.find((entry) => entry.id === id) as CaravanBeatState
  assert.equal(state.spine, true)
  assert.equal(caravanSpineHoldsCamp(plans, state), true)
  assert.equal(isCaravanBeatDormant(crossing, plans, state), true)
  assert.equal(isCaravanBeatDormant(first, plans, state), false)
  assert.deepEqual(caravanSpineGate(state), { open: false, settled: 0, required: 2 })

  // Before a choice the nearest offer leads, by whatever the caller measures (the road, for the
  // engine): the camp is no place to go. Ties keep the plan's order.
  assert.deepEqual(caravanSpineLeads(plans, state, (point) => distance(point, second.cargoStart)),
    { leading: second.id, trailing: null })
  assert.equal(caravanSpineLeads(plans, state, (point) => distance(point, first.cargoStart)).leading, first.id)
  assert.equal(caravanSpineLeads(plans, state, () => 0).leading, first.id, 'a tie keeps the plan order')

  // «Взяться»: only an offer waiting at an open camp, and once.
  assert.equal(chooseCaravanOffer(plans, state, crossing.id), false)
  assert.equal(chooseCaravanOffer(plans, state, second.id), true)
  assert.equal(chooseCaravanOffer(plans, state, second.id), false)
  const leads = caravanSpineLeads(plans, state, (point) => distance(point, first.cargoStart))
  assert.deepEqual(leads, { leading: second.id, trailing: null },
    'the offer taken leads over the nearer one, and the gate leads nowhere while the camp does')

  // Walking up to the other one takes that one instead: met first is chosen.
  beat(first.id).phase = 'fighting'
  assert.deepEqual(declineOtherCaravanOffers(plans, state, first.id), [second.id])
  assert.equal(state.chosenOfferId, first.id)
  assert.equal(beat(second.id).phase, 'declined')
  assert.equal(caravanSpineHoldsCamp(plans, state), true, 'a fight is not a settled cart')
  assert.equal(caravanSpineMetCount(state), 0)
  settle(beat(first.id), 'escaped')
  assert.equal(caravanSpineHoldsCamp(plans, state), false)
  assert.equal(isCaravanOpeningSettled(plans, state), true)
  assert.equal(isCaravanBeatDormant(crossing, plans, state), false, 'the road wakes with the camp')
  assert.equal(caravanSpineMetCount(state), 1, 'an escaped cart is one the run met')
  assert.equal(caravanSpineProgressBeats(state), 0, 'two met carts make one step of progress')
  // The declined offer is neither counted nor required.
  assert.deepEqual(caravanSpineGate(state), { open: false, settled: 1, required: 2 })
  assert.deepEqual(caravanSpineLeads(plans, state, (point) => distance(point, crossing.cargoStart)),
    { leading: null, trailing: crossing.id }, 'the camp settled: the gate leads to the nearest cart left')
  settle(beat(crossing.id), 'unavailable')
  assert.equal(caravanSpineGate(state).open, true, 'an unstageable cart still counts')
  assert.equal(caravanSpineMetCount(state), 1, '…but nobody met it')
  const road = plans.find((plan) => plan.slot === 'road')
  if (road) {
    settle(beat(road.id), 'resolved')
    assert.equal(caravanSpineProgressBeats(state), 1, 'the second met cart pays the step')
  }

  // An offer that could not be staged settles the camp, and the other stays on the road.
  const fallback = createCaravanSpine(blueprint, 'elf').state
  const fallbackBeat = (id: string) => fallback.beats.find((entry) => entry.id === id) as CaravanBeatState
  Object.assign(fallbackBeat(first.id), createUnavailableCaravanBeatState(first, 'Нет обочины.'))
  assert.equal(caravanSpineHoldsCamp(plans, fallback), false)
  assert.equal(fallbackBeat(second.id).phase, 'approach')
  assert.equal(caravanSpineGate(fallback).required, 2)

  // Control: a run without a spine has nothing to hold, no gate and no beat steps.
  const legacyPlans = createCaravanBeatPlans(blueprint, 'elf')
  const legacy = createCaravanBeatsState(legacyPlans)
  legacy.beats[0].phase = 'resolved'
  assert.equal(caravanSpineHoldsCamp(legacyPlans, legacy), false)
  assert.deepEqual(caravanSpineGate(legacy), { open: true, settled: 0, required: 0 })
  assert.equal(caravanSpineMetCount(legacy), 0)
  assert.equal(caravanSpineProgressBeats(legacy), 0)
  assert.deepEqual(caravanSpineLeads(legacyPlans, legacy, () => 0), { leading: null, trailing: null })
})

function spineSave(blueprint: WorldBlueprint, faction: Faction): { plans: CaravanBeatPlan[]; saved: SerializableState } {
  const { plans, state } = createCaravanSpine(blueprint, faction)
  const [first, second] = plans.filter((plan) => plan.slot === 'offer')
  const crossing = plans.find((plan) => plan.slot === 'crossing')
  assert.ok(first && second && crossing)
  const beat = (id: string) => state.beats.find((entry) => entry.id === id) as CaravanBeatState
  beat(first.id).phase = 'fighting'
  for (const combatant of beat(first.id).combatants) {
    combatant.maxHealth = 60
    combatant.health = 60
  }
  declineOtherCaravanOffers(plans, state, first.id)
  for (const combatant of beat(first.id).combatants) {
    combatant.health = 0
    combatant.defeated = true
  }
  beat(first.id).phase = 'lost'
  beat(first.id).cargoHealth = 0
  beat(first.id).consequence = 'Груз растащили.'
  beat(crossing.id).stagingStalled = 12.5
  return { plans, saved: serializeCaravanBeatsState(state) }
}

test('a spine survives the save as it was, and every story it cannot tell is refused', () => {
  const blueprint = generateWorld(20_260_909)
  const { plans, saved } = spineSave(blueprint, 'villain')
  const restored = normalizeCaravanBeatsState(saved, blueprint, 'villain', plans)
  assert.ok(restored, 'the sound block is read')
  assert.deepEqual(serializeCaravanBeatsState(restored), saved)
  const crossing = plans.find((plan) => plan.slot === 'crossing')
  assert.equal(restored.beats.find((beat) => beat.id === crossing?.id)?.stagingStalled, 12.5,
    'a continue resumes the wait rather than starting it again')

  const mutate = (change: (block: Record<string, unknown>, beats: Record<string, unknown>[]) => void) => {
    const block = structuredClone(saved) as Record<string, unknown>
    change(block, block.beats as Record<string, unknown>[])
    return normalizeCaravanBeatsState(block, blueprint, 'villain', plans)
  }
  const offerIndex = plans.findIndex((plan) => plan.slot === 'offer')
  const otherIndex = plans.findIndex((plan, index) => plan.slot === 'offer' && index !== offerIndex)
  const crossingIndex = plans.findIndex((plan) => plan.slot === 'crossing')
  // Each is a rejection the sound block above passes.
  assert.equal(mutate((block) => { block.version = 3 }), null, 'unknown version')
  assert.equal(mutate((block) => { block.spine = 'yes' }), null, 'spine flag')
  assert.equal(mutate((block) => { block.chosenOfferId = crossing?.id }), null, 'a road beat chosen at the camp')
  assert.equal(mutate((_, beats) => { beats[crossingIndex].stagingStalled = CARAVAN_BEAT_STAGING_GIVE_UP_SECONDS + 1 }),
    null, 'a stall clock past its end')
  assert.equal(mutate((_, beats) => { beats[offerIndex].stagingStalled = 3 }), null, 'a stall clock on a settled cart')
  // An offer declined while no cart was met; the same camp without the decline is sound.
  const undecided = createCaravanSpine(blueprint, 'villain').state
  assert.ok(normalizeCaravanBeatsState(serializeCaravanBeatsState(undecided), blueprint, 'villain', plans))
  undecided.beats[otherIndex].phase = 'declined'
  assert.equal(normalizeCaravanBeatsState(serializeCaravanBeatsState(undecided), blueprint, 'villain', plans), null,
    'an offer declined while no cart was met')
  // Both offers met: the camp's choice is one cart, not two.
  const greedy = createCaravanSpine(blueprint, 'villain').state
  for (const index of [offerIndex, otherIndex]) {
    greedy.beats[index].phase = 'fighting'
    for (const combatant of greedy.beats[index].combatants) {
      combatant.maxHealth = 60
      combatant.health = 60
    }
  }
  assert.equal(normalizeCaravanBeatsState(serializeCaravanBeatsState(greedy), blueprint, 'villain', plans), null,
    'two carts met at the camp')
  // A road beat fought while the camp still waits.
  const early = createCaravanSpine(blueprint, 'villain').state
  const earlyCrossing = early.beats[crossingIndex]
  earlyCrossing.phase = 'fighting'
  for (const combatant of earlyCrossing.combatants) {
    combatant.maxHealth = 60
    combatant.health = 60
  }
  assert.equal(normalizeCaravanBeatsState(serializeCaravanBeatsState(early), blueprint, 'villain', plans), null)
  // The same block against the crossing alone is a different run, and refused.
  assert.equal(normalizeCaravanBeatsState(saved, blueprint, 'villain', createCaravanBeatPlans(blueprint, 'villain')), null)
})

test('older saves keep their campaign, and a broken spine fails forward', () => {
  const blueprint = generateWorld(20_260_909)
  const legacyPlans = createCaravanBeatPlans(blueprint, 'elf')
  // PR A's version-1 block: the crossing alone, no spine, no camp to hold, no gate.
  const pullRequestA = {
    version: 1,
    garrisonThinned: false,
    beats: createCaravanBeatsState(legacyPlans).beats.map((beat) => {
      const { stagingStalled: _stalled, ...rest } = beat
      return rest
    }),
  }
  const fromA = restoreCaravanSpine({ caravanBeats: pullRequestA } as unknown as SerializableState, blueprint, 'elf')
  assert.equal(fromA.rejected, false)
  assert.deepEqual(fromA.plans.map((plan) => plan.slot), ['crossing'])
  assert.equal(fromA.state?.spine, false)
  assert.equal(caravanSpineHoldsCamp(fromA.plans, fromA.state ?? null), false)
  assert.equal(caravanSpineGate(fromA.state ?? null).open, true)
  // A run from before any caravan keeps none.
  assert.equal(restoreCaravanSpine({} as SerializableState, blueprint, 'elf').state, null)
  // A fresh run's block round-trips as a spine.
  const fresh = createCaravanSpine(blueprint, 'elf')
  const again = restoreCaravanSpine({ caravanBeats: serializeCaravanBeatsState(fresh.state) } as SerializableState,
    blueprint, 'elf')
  assert.equal(again.rejected, false)
  assert.equal(again.state?.spine, true)
  assert.deepEqual(again.plans.map((plan) => plan.id), fresh.plans.map((plan) => plan.id))

  // A broken spine is refused, not repaired: every cart closes without a reward, which settles
  // the camp and opens the gate, so the run goes on rather than waiting on carts it cannot meet.
  const broken = { ...serializeCaravanBeatsState(fresh.state), beats: [] }
  const failed = restoreCaravanSpine({ caravanBeats: broken } as unknown as SerializableState, blueprint, 'elf')
  assert.equal(failed.rejected, true)
  assert.equal(failed.state?.spine, true)
  assert.ok(failed.state?.beats.every((beat) => beat.phase === 'unavailable' && !beat.rewardPaid))
  assert.equal(caravanSpineHoldsCamp(failed.plans, failed.state ?? null), false)
  assert.equal(caravanSpineGate(failed.state ?? null).open, true)
})
