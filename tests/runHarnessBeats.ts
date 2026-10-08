/**
 * W2-2, PR B — the caravan spine in the run harness.
 *
 * The shipped rules, run on the harness's own bodies: `planCaravanSpine`'s plans and a spine
 * state, the camp held by `caravanSpineHoldsCamp` and decided by `declineOtherCaravanOffers`,
 * `advanceCaravanBeatAbandon` for a cart the player left, `caravanBeatReward` for what a verb
 * pays, the chronicle's own delivery and loss writes for the market, `thinFinaleGarrison`
 * (through the port) for a burn, and `caravanSpineGate` / `caravanSpineProgressBeats` for the
 * campaign. The harness's own are the bodies, the walk, the choice of offer and of verb, and
 * staging, which follows the engine's seam: W1-1's make-way, then a campaign reservation,
 * retried every 2 s, and after `CARAVAN_BEAT_STAGING_GIVE_UP_SECONDS` a cart that goes
 * through without its fight.
 *
 * Off by default (`caravanBeats: 'off'`): every method is then a no-op that leaves the
 * campaign open, so every pinned number is the run it always was.
 */
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import type { ActorRole, Allegiance, Faction } from '../src/game/types.ts'
import type { CampaignGate } from '../src/game/world/CampaignDirector.ts'
import {
  CARAVAN_BEAT_ABANDON_RANGE,
  CARAVAN_BEAT_ACTIVATION_RADIUS,
  CARAVAN_BEAT_DELIVERY_ESCORT_RADIUS,
  CARAVAN_BEAT_DELIVERY_SPEED,
  CARAVAN_BEAT_SQUAD_CAP,
  CARAVAN_BEAT_STAGING_GIVE_UP_SECONDS,
  CARAVAN_SPINE_BEATS_PER_STEP,
  CARAVAN_SPINE_FINALE_GATE,
  advanceCaravanBeatAbandon,
  caravanBeatCanChoose,
  caravanBeatChoices,
  caravanBeatCountsAsRobbery,
  caravanBeatDeliveryProgress,
  caravanBeatMarketWrite,
  caravanBeatRemainingEnemies,
  caravanBeatReward,
  caravanBeatThinsGarrison,
  caravanSpineGate,
  caravanSpineHoldsCamp,
  caravanSpineLeads,
  caravanSpineMetCount,
  chooseCaravanOffer,
  createCaravanBeatsState,
  declineOtherCaravanOffers,
  isCaravanBeatClosed,
  isCaravanBeatDormant,
  isCaravanBeatEngaged,
  isCaravanBeatLaneOutcome,
  type CaravanBeatAbandonEnding,
  type CaravanBeatEnding,
  type CaravanBeatOutcome,
  type CaravanBeatPlan,
  type CaravanBeatState,
  type CaravanBeatsState,
} from '../src/game/world/CaravanBeats.ts'
import { planCaravanSpine } from '../src/game/world/CaravanSpine.ts'
import {
  CARAVAN_BEAT_CHRONICLE_PREFIX,
  resolveRegionalCaravanDelivery,
  resolveRegionalCaravanLoss,
  type ChronicleState,
  type RegionChronicleState,
} from '../src/game/world/Chronicle.ts'
import type { WorldBlueprint } from '../src/game/world/worldTypes.ts'

/** `off` is every pinned number's run; `shipped` is the engine's spine. */
export type CaravanBeatModel = 'off' | 'shipped'
/**
 * How the scripted player treats a caravan. `engage` goes to it, fights and chooses. `walk`
 * goes to it and walks away once its fight begins, so every cart settles by the walked-away
 * clock: the fail-forward control. `ignore` never goes: the gate's negative control.
 */
export type BeatPolicy = 'engage' | 'walk' | 'ignore'
/** Which of the camp's offers: on the road to the finale, off it, by tier, or seeded. */
export type OpeningPolicy = 'seeded' | 'trunk' | 'branch' | 'rich' | 'light'
/** Which verb on a won cart: the side's first (gold), its others, or seeded among them. */
export type VerbPolicy = 'seeded' | 'gold' | 'nonGold'

/** Matches the engine's `CARAVAN_BEAT_SPAWN_RETRY_SECONDS`. */
export const HARNESS_BEAT_SPAWN_RETRY_SECONDS = 2
/** Matches the engine's cargo target: a raider bites the cart from this close. */
export const HARNESS_BEAT_CARGO_REACH = 4.4

/** W2-2, PR B — the caravans a spine run met, and what became of them. */
export interface BeatMetrics {
  planned: number
  /** How the camp's offers were found (`CaravanSpinePlan.opening`). */
  openingPattern: string
  /** The offer the run took at the camp: on the trunk or off it, and what it carried. */
  opening: {
    onTrunk: boolean
    tier: string
    owner: Faction
    role: string
  } | null
  /** Endings by phase: resolved, lost, escaped, unavailable, declined. */
  endings: Record<string, number>
  /** The verbs chosen on won carts. */
  verbs: Record<string, number>
  campClosedAt: number | null
  gateOpenedAt: number | null
  /** W2-1 — the progress steps the carts paid for by the run's end. */
  progressSteps: number
  /** Carts that were refused room at least once, seconds they waited, and those let through. */
  stagingStalls: number
  stagingStallSeconds: number
  stagingFailForwards: number
  recruits: number
  garrisonThinned: boolean
  goldEarned: number
  rationsEarned: number
}

/** The part of a harness body the beats read. */
export interface BeatBody {
  id: string
  x: number
  z: number
  alive: boolean
  hp: number
  maxHp: number
}

/** What the beats need from the harness, and nothing more. */
export interface BeatPort {
  readonly faction: Faction
  readonly blueprint: WorldBlueprint
  readonly player: { x: number; z: number }
  readonly chronicleState: ChronicleState
  readonly chronicleRegions: Map<string, RegionChronicleState>
  readonly caravanMetrics: {
    robbed: number
    robbedBy: Record<string, number>
    escorted: number
    escortedBy: Record<string, number>
    lost: number
    lostBy: Record<string, number>
  }
  body(id: string): BeatBody | undefined
  regionSimulated(regionId: string): boolean
  /** W1-1's make-way: a player-anchored random event the player is not in stands down. */
  makeWay(): void
  reserveCampaign(count: number): boolean
  spawn(input: {
    id: string
    allegiance: Allegiance
    role: ActorRole
    x: number
    z: number
    enemy: boolean
    ownerId: string
    propId: string | null
    home: { x: number; z: number }
  }): BeatBody
  remove(id: string): void
  setProp(id: string, prop: { x: number; z: number; hp: number } | null): void
  propHp(id: string): number | null
  earnGold(amount: number): void
  addSupplies(amount: number): void
  squadSize(): number
  recruit(at: { x: number; z: number }): boolean
  guardOrderKept?(
    outcome: 'deliver' | 'confiscate',
    at: { x: number; z: number },
  ): void
  /** `thinFinaleGarrison` on the run's finale: the escort sent away, or null. */
  thinFinale(): string | null
}

export interface BeatGoal {
  point: { x: number; z: number }
  /** A body to fight on the way, by id. */
  actorId: string | null
}

export interface BeatHarness {
  readonly on: boolean
  step(delta: number, elapsed: number): void
  /** Where the player goes for a caravan this frame, if anywhere. */
  goal(objectiveReady: boolean): BeatGoal | null
  gate(): CampaignGate
  holdsCamp(): boolean
  campNodeId(): string | null
  progressSteps(): number
  holdsRandomEvents(quietRadius: number): boolean
  metrics(elapsed: number): BeatMetrics | null
}

interface BeatRuntime {
  cart: { x: number; z: number }
  retryAt: number
  refused: boolean
  stalled: boolean
}

const OFF: BeatHarness = {
  on: false,
  step: () => {},
  goal: () => null,
  gate: () => ({ finaleOpen: true }),
  holdsCamp: () => false,
  campNodeId: () => null,
  progressSteps: () => 0,
  holdsRandomEvents: () => false,
  metrics: () => null,
}

function distance(first: { x: number; z: number }, second: { x: number; z: number }): number {
  return Math.hypot(first.x - second.x, first.z - second.z)
}

export function createBeatHarness(
  port: BeatPort,
  options: {
    model: CaravanBeatModel
    beatPolicy: BeatPolicy
    openingPolicy: OpeningPolicy
    verbPolicy: VerbPolicy
    /** The finale gate's K; the shipped `CARAVAN_SPINE_FINALE_GATE` unless measured. */
    gate?: number
    /** Met carts per progress step: the shipped CARAVAN_SPINE_BEATS_PER_STEP unless measured. */
    beatsPerStep?: number
  },
): BeatHarness {
  if (options.model === 'off') return OFF
  const { blueprint, faction, player } = port
  const spine = planCaravanSpine(blueprint, faction)
  const plans = spine.plans
  const state: CaravanBeatsState = createCaravanBeatsState(plans, true)
  const gateK = options.gate ?? CARAVAN_SPINE_FINALE_GATE
  const beatsPerStep = Math.max(1, Math.floor(options.beatsPerStep ?? CARAVAN_SPINE_BEATS_PER_STEP))
  // Its own stream, so a seeded opening or verb never moves a draw the world was going to take.
  const rng = new RandomStream(deriveSeed(blueprint.seed, 'harness:caravan-beats'))
  const graph = blueprint.objectives[faction]
  const camp = graph.nodes.find((node) =>
    graph.rootNodeIds.includes(node.id) && node.siteId === blueprint.starts[faction]) ?? null
  const runtime = new Map<string, BeatRuntime>(plans.map((plan) => [plan.id, {
    cart: { ...plan.cargoStart }, retryAt: 0, refused: false, stalled: false,
  }]))
  const beatOf = (plan: CaravanBeatPlan) => state.beats.find((entry) => entry.id === plan.id) as CaravanBeatState
  const runtimeOf = (plan: CaravanBeatPlan) => runtime.get(plan.id) as BeatRuntime
  const bodyId = (combatantId: string) => `beat:${combatantId}`
  const propId = (plan: CaravanBeatPlan) => `caravan-beat:${plan.id}`
  const metrics: BeatMetrics = {
    planned: plans.length,
    openingPattern: spine.opening,
    opening: null,
    endings: {},
    verbs: {},
    campClosedAt: null,
    gateOpenedAt: null,
    progressSteps: 0,
    stagingStalls: 0,
    stagingStallSeconds: 0,
    stagingFailForwards: 0,
    recruits: 0,
    garrisonThinned: false,
    goldEarned: 0,
    rationsEarned: 0,
  }
  const bump = (into: Record<string, number>, key: string) => { into[key] = (into[key] ?? 0) + 1 }
  const close = (beat: CaravanBeatState) => bump(metrics.endings, beat.phase)

  // The camp's choice, as the policy takes it on the first frame: «Взяться» on one offer.
  const offers = plans.filter((plan) => plan.slot === 'offer')
  const onTrunk = (plan: CaravanBeatPlan) => spine.along.get(plan.id) !== null
  const preferred = (() => {
    switch (options.openingPolicy) {
      case 'trunk': return offers.find(onTrunk) ?? offers[0]
      case 'branch': return offers.find((plan) => !onTrunk(plan)) ?? offers[0]
      case 'rich': return offers.find((plan) => plan.tier === 'rich') ?? offers[0]
      case 'light': return offers.find((plan) => plan.tier === 'light') ?? offers[0]
      case 'seeded': return offers.length > 0 ? offers[Math.floor(rng.next() * offers.length)] : undefined
    }
  })()
  if (preferred) chooseCaravanOffer(plans, state, preferred.id)

  const writeMarket = (plan: CaravanBeatPlan, ending: CaravanBeatEnding) => {
    const write = caravanBeatMarketWrite(plan, ending)
    if (!write || !plan.marketRegionId) return
    const idPrefix = `${CARAVAN_BEAT_CHRONICLE_PREFIX}${plan.id}`
    if (write.kind === 'arrival') {
      resolveRegionalCaravanDelivery({
        state: port.chronicleState, regions: port.chronicleRegions, idPrefix,
        regionId: plan.marketRegionId, faction: plan.owner, siteId: plan.marketSiteId,
      })
    } else {
      resolveRegionalCaravanLoss({
        state: port.chronicleState, regions: port.chronicleRegions, idPrefix,
        regionId: plan.regionId, supplyRegionId: plan.marketRegionId,
        faction: plan.owner, siteId: plan.marketSiteId, loss: write.amount,
      })
    }
  }

  /** The cart and whoever still walks with it leave the road. */
  const sendOnItsWay = (plan: CaravanBeatPlan, beat: CaravanBeatState) => {
    for (const combatant of beat.combatants) port.remove(bodyId(combatant.id))
    port.setProp(propId(plan), null)
  }

  const apply = (plan: CaravanBeatPlan, beat: CaravanBeatState, outcome: CaravanBeatOutcome, unattended: boolean) => {
    const reward = caravanBeatReward(plan, outcome)
    const gold = unattended ? 0 : reward.gold
    const rations = unattended ? 0 : reward.rations
    if (gold > 0) {
      port.earnGold(gold)
      metrics.goldEarned += gold
    }
    if (rations > 0) {
      port.addSupplies(rations)
      metrics.rationsEarned += rations
    }
    if (
      faction === 'guard' &&
      !unattended &&
      (outcome === 'deliver' || outcome === 'confiscate')
    ) {
      port.guardOrderKept?.(outcome, { x: beat.cargoX, z: beat.cargoZ })
    }
    if (reward.burnsSupply && caravanBeatThinsGarrison(faction, plan, state.garrisonThinned) &&
      port.thinFinale() !== null) {
      state.garrisonThinned = true
      metrics.garrisonThinned = true
    }
    if (caravanBeatCountsAsRobbery(outcome)) {
      port.caravanMetrics.robbed += 1
      bump(port.caravanMetrics.robbedBy, 'caravanBeat')
    } else {
      port.caravanMetrics.escorted += 1
      bump(port.caravanMetrics.escortedBy, 'caravanBeat')
    }
    writeMarket(plan, outcome)
    if (outcome === 'release') sendOnItsWay(plan, beat)
    close(beat)
  }

  const lose = (plan: CaravanBeatPlan, beat: CaravanBeatState) => {
    beat.phase = 'lost'
    beat.cargoHealth = 0
    beat.abandonRemaining = null
    port.setProp(propId(plan), null)
    port.caravanMetrics.lost += 1
    bump(port.caravanMetrics.lostBy, 'caravanBeat')
    writeMarket(plan, 'lost')
    close(beat)
  }

  const settleAbandoned = (plan: CaravanBeatPlan, beat: CaravanBeatState, ending: CaravanBeatAbandonEnding) => {
    if (ending === 'unattended' && beat.outcome) {
      beat.phase = 'resolved'
      beat.rewardPaid = true
      apply(plan, beat, beat.outcome, true)
      return
    }
    if (ending === 'lost' || (ending === 'escaped' && caravanBeatRemainingEnemies(beat) === 0)) {
      lose(plan, beat)
      return
    }
    if (ending === 'release') {
      beat.phase = 'resolved'
      beat.outcome = 'release'
      beat.rewardPaid = true
      apply(plan, beat, 'release', true)
      return
    }
    beat.phase = 'escaped'
    writeMarket(plan, 'escaped')
    sendOnItsWay(plan, beat)
    close(beat)
  }

  const stage = (plan: CaravanBeatPlan, beat: CaravanBeatState, place: BeatRuntime, elapsed: number) => {
    port.makeWay()
    const missing = beat.combatants.filter((combatant) => !combatant.defeated)
    if (!port.reserveCampaign(missing.length)) {
      place.retryAt = elapsed + HARNESS_BEAT_SPAWN_RETRY_SECONDS
      place.refused = true
      if (!place.stalled) {
        place.stalled = true
        metrics.stagingStalls += 1
      }
      return
    }
    place.refused = false
    beat.stagingStalled = 0
    const firstEnemy = beat.combatants.find((combatant) => combatant.enemy)
    if (plan.role === 'defend') {
      port.setProp(propId(plan), { x: place.cart.x, z: place.cart.z, hp: beat.cargoHealth })
    }
    for (const combatant of missing) {
      const point = plan.spawnPoints.find((entry) => entry.combatantId === combatant.id) ?? plan.cargoStart
      const body = port.spawn({
        id: bodyId(combatant.id),
        allegiance: combatant.allegiance,
        role: combatant.role,
        x: point.x,
        z: point.z,
        enemy: combatant.enemy,
        ownerId: propId(plan),
        propId: plan.role === 'defend' && combatant === firstEnemy ? propId(plan) : null,
        home: place.cart,
      })
      combatant.maxHealth = body.maxHp
      combatant.health = body.hp
    }
    beat.phase = 'fighting'
    if (plan.slot === 'offer') {
      const declined = declineOtherCaravanOffers(plans, state, plan.id).length
      if (declined > 0) metrics.endings.declined = (metrics.endings.declined ?? 0) + declined
      metrics.opening = { onTrunk: onTrunk(plan), tier: plan.tier, owner: plan.owner, role: plan.role }
    }
  }

  const chooseVerb = (plan: CaravanBeatPlan): CaravanBeatOutcome => {
    const choices = caravanBeatChoices(faction, plan)
      .filter((outcome) => outcome !== 'press' || port.squadSize() < CARAVAN_BEAT_SQUAD_CAP)
    switch (options.verbPolicy) {
      case 'gold': return choices[0]
      case 'nonGold': return choices[1] ?? choices[0]
      case 'seeded': return choices[Math.floor(rng.next() * choices.length)]
    }
  }

  const step = (delta: number, elapsed: number) => {
    for (const plan of plans) {
      const beat = beatOf(plan)
      if (isCaravanBeatClosed(beat) || isCaravanBeatDormant(plan, plans, state)) continue
      const place = runtimeOf(plan)
      const away = distance(player, place.cart)
      const ending = advanceCaravanBeatAbandon(plan, beat, away, delta)
      if (ending) {
        settleAbandoned(plan, beat, ending)
        continue
      }
      if (beat.phase === 'approach') {
        const waiting = away <= CARAVAN_BEAT_ACTIVATION_RADIUS && port.regionSimulated(plan.regionId)
        if (waiting && place.refused) {
          beat.stagingStalled = Math.min(CARAVAN_BEAT_STAGING_GIVE_UP_SECONDS, beat.stagingStalled + delta)
          metrics.stagingStallSeconds += delta
          if (beat.stagingStalled >= CARAVAN_BEAT_STAGING_GIVE_UP_SECONDS) {
            beat.phase = 'unavailable'
            beat.stagingStalled = 0
            metrics.stagingFailForwards += 1
            close(beat)
            continue
          }
        }
        if (waiting && elapsed >= place.retryAt) stage(plan, beat, place, elapsed)
        continue
      }
      if (beat.phase === 'fighting') {
        for (const combatant of beat.combatants) {
          if (combatant.defeated) continue
          const body = port.body(bodyId(combatant.id))
          if (!body || !body.alive) {
            combatant.defeated = true
            combatant.health = 0
          } else {
            combatant.health = Math.max(0, body.hp)
          }
        }
        if (plan.role === 'defend') {
          beat.cargoHealth = port.propHp(propId(plan)) ?? beat.cargoHealth
          if (beat.cargoHealth <= 0) {
            lose(plan, beat)
            continue
          }
        }
        if (caravanBeatRemainingEnemies(beat) === 0) {
          beat.phase = 'secured'
          port.setProp(propId(plan), null)
        }
      }
      if (beat.phase === 'secured' && options.beatPolicy === 'engage' && caravanBeatCanChoose(beat, player)) {
        const outcome = chooseVerb(plan)
        bump(metrics.verbs, outcome)
        beat.outcome = outcome
        beat.abandonRemaining = null
        if (outcome === 'press' && port.recruit(place.cart)) metrics.recruits += 1
        if (isCaravanBeatLaneOutcome(outcome)) {
          beat.phase = 'delivering'
        } else {
          beat.phase = 'resolved'
          beat.rewardPaid = true
          apply(plan, beat, outcome, false)
        }
        continue
      }
      if (beat.phase === 'delivering' && beat.outcome && away <= CARAVAN_BEAT_DELIVERY_ESCORT_RADIUS) {
        const left = distance(place.cart, plan.deliveryEnd)
        const move = Math.min(left, CARAVAN_BEAT_DELIVERY_SPEED * delta)
        if (left > 1e-6) {
          place.cart.x += (plan.deliveryEnd.x - place.cart.x) / left * move
          place.cart.z += (plan.deliveryEnd.z - place.cart.z) / left * move
        }
        beat.cargoX = place.cart.x
        beat.cargoZ = place.cart.z
        beat.progress = caravanBeatDeliveryProgress(plan, place.cart)
        if (beat.progress >= 0.995) {
          beat.phase = 'resolved'
          beat.progress = 1
          beat.rewardPaid = true
          apply(plan, beat, beat.outcome, false)
        }
      }
    }
    if (metrics.campClosedAt === null && !caravanSpineHoldsCamp(plans, state)) metrics.campClosedAt = elapsed
    if (metrics.gateOpenedAt === null && caravanSpineGate(state, gateK).open) metrics.gateOpenedAt = elapsed
  }

  const goal = (objectiveReady: boolean): BeatGoal | null => {
    if (options.beatPolicy === 'ignore') return null
    // An engaged cart within reach: fight for it, choose at it, walk it — or, under `walk`,
    // walk off until the walked-away clock settles it.
    let engaged: { plan: CaravanBeatPlan; beat: CaravanBeatState; away: number } | null = null
    for (const plan of plans) {
      const beat = beatOf(plan)
      if (!isCaravanBeatEngaged(beat)) continue
      const away = distance(player, runtimeOf(plan).cart)
      // A cart left behind past the walked-away range is the clock's now, unless the player
      // is walking away on purpose and must keep going until it settles.
      if (away > CARAVAN_BEAT_ABANDON_RANGE && options.beatPolicy !== 'walk') continue
      if (!engaged || away < engaged.away) engaged = { plan, beat, away }
    }
    if (engaged) {
      const cart = runtimeOf(engaged.plan).cart
      if (options.beatPolicy === 'walk') {
        const dx = player.x - cart.x
        const dz = player.z - cart.z
        const length = Math.hypot(dx, dz) || 1
        const reach = CARAVAN_BEAT_ABANDON_RANGE + 30
        return { point: { x: cart.x + dx / length * reach, z: cart.z + dz / length * reach }, actorId: null }
      }
      if (engaged.beat.phase === 'fighting') {
        let target: { id: string; away: number; at: { x: number; z: number } } | null = null
        for (const combatant of engaged.beat.combatants) {
          if (!combatant.enemy || combatant.defeated) continue
          const body = port.body(bodyId(combatant.id))
          if (!body?.alive) continue
          const away = distance(player, body)
          if (!target || away < target.away) target = { id: body.id, away, at: { x: body.x, z: body.z } }
        }
        return target ? { point: target.at, actorId: target.id } : { point: { ...cart }, actorId: null }
      }
      return { point: { ...cart }, actorId: null }
    }
    // The camp's chosen cart, ahead of everything while the camp holds; then, with no objective
    // left before a shut finale, the nearest cart the run can still meet. The shipped gate is
    // `caravanSpineLeads`'s; a measured K asks its own gate the same question.
    const leads = caravanSpineLeads(plans, state, (point) => distance(player, point))
    let led = leads.leading
    if (!led && !objectiveReady && !caravanSpineHoldsCamp(plans, state) && !caravanSpineGate(state, gateK).open) {
      let best = Number.POSITIVE_INFINITY
      for (const plan of plans) {
        const beat = beatOf(plan)
        if (isCaravanBeatClosed(beat) || isCaravanBeatDormant(plan, plans, state)) continue
        const away = distance(player, runtimeOf(plan).cart)
        if (away < best) {
          best = away
          led = plan.id
        }
      }
    }
    const plan = led ? plans.find((entry) => entry.id === led) : undefined
    return plan ? { point: { ...runtimeOf(plan).cart }, actorId: null } : null
  }

  return {
    on: true,
    step,
    goal,
    gate: () => ({ finaleOpen: caravanSpineGate(state, gateK).open }),
    holdsCamp: () => caravanSpineHoldsCamp(plans, state),
    campNodeId: () => camp?.id ?? null,
    progressSteps: () => Math.floor(caravanSpineMetCount(state) / beatsPerStep),
    holdsRandomEvents: (quietRadius) => caravanSpineHoldsCamp(plans, state) ||
      state.beats.some((beat) => isCaravanBeatEngaged(beat)) ||
      plans.some((plan) => {
        const beat = beatOf(plan)
        return beat.phase === 'approach' && !isCaravanBeatDormant(plan, plans, state) &&
          distance(player, runtimeOf(plan).cart) <= quietRadius
      }),
    metrics: () => ({ ...metrics, progressSteps: Math.floor(caravanSpineMetCount(state) / beatsPerStep) }),
  }
}
