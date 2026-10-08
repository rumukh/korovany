/**
 * W2-2 — caravan beats: the bridge ambush generalised, every side's own verb, and the
 * consequences each one writes.
 *
 * Grew out of `tests/bridgeAmbush.test.ts`. The bridge's geometry, collision, persistence and
 * guidance claims are kept, now made about the crossing beat, and every new rule carries a
 * negative control. Engine claims drive the production methods on a field-by-field engine
 * (`tests/caravanBeatFixture.ts` attaches the beats the way `initializeCaravanBeatCarts` would).
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import {
  getBlueprintRegionBounds,
  createGeneratedEncounterPlans,
  getFactionStartPosition2D,
  getSiteWorldPosition2D,
  isInsideRegionWater,
} from '../src/game/content/registry.ts'
import {
  CARAVAN_BEAT_PROMPTS,
  describeCaravanBeatOutcome,
  formatPriceFactor,
  formatRegionGridLabel,
} from '../src/game/content/gameCopy.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import {
  DEFAULT_DOCTRINE_IDS,
  createDoctrineRunState,
  resolveDoctrineEffects,
} from '../src/game/run/doctrine.ts'
import type { ActiveRunSaveV3 } from '../src/game/run/runTypes.ts'
import { normalizeActiveRunSaveV3 } from '../src/game/run/storage.ts'
import { createHealthyBody, type ActorRole, type Allegiance, type Faction, type NoticeOrigin, type NoticeTone, type Objective } from '../src/game/types.ts'
import {
  NARROW_NOTICE_LIMITS,
  NOTICE_MAX_WAITING,
  advanceNotices,
  createNoticeQueue,
  nextNoticeDeadline,
  pushNotice,
} from '../src/game/ui/noticeQueue.ts'
import { ACTOR_BUDGET, ActorBudget, MAX_ACTORS } from '../src/game/world/ActorBudget.ts'
import {
  createBridgeAmbushPlan,
  createBridgeAmbushState,
  serializeBridgeAmbushState,
} from '../src/game/world/BridgeAmbush.ts'
import {
  createCampaignContractState,
  createChronicleCommitmentState,
  createGeneratedObjectives,
} from '../src/game/world/CampaignDirector.ts'
import { buildInitialGameView } from '../src/game/world/CampaignView.ts'
import {
  CARAVAN_BEAT_ABANDON_RANGE,
  CARAVAN_BEAT_ABANDON_SECONDS,
  CARAVAN_BEAT_DELIVERY_ESCORT_RADIUS,
  CARAVAN_BEAT_DELIVERY_STALL_SECONDS,
  CARAVAN_BEAT_SQUAD_CAP,
  CARAVAN_BEAT_VALUE,
  advanceCaravanBeatAbandon,
  buildCaravanBeatView,
  caravanBeatChoices,
  caravanBeatCountsAsRobbery,
  caravanBeatDeliveryProgress,
  caravanBeatMarketChange,
  caravanBeatMarketWrite,
  caravanBeatRemainingEnemies,
  caravanBeatReservesStagingPoint,
  caravanBeatReward,
  caravanBeatThinsGarrison,
  caravanSpineGate,
  caravanSpineHoldsCamp,
  createCaravanBeatPlans,
  createCaravanBeatState,
  createCaravanBeatsState,
  declineOtherCaravanOffers,
  normalizeCaravanBeatsState,
  restoreCaravanBeatsState,
  serializeCaravanBeatsState,
  summarizeCaravanBeats,
  type CaravanBeatPlan,
  type CaravanBeatState,
  type CaravanBeatsState,
  type CaravanBeatViewContext,
  type CaravanBeatsView,
} from '../src/game/world/CaravanBeats.ts'
import { restoreCaravanSpine } from '../src/game/world/CaravanSpine.ts'
import {
  CARAVAN_BEAT_CHRONICLE_PREFIX,
  SUPPLY_BASELINE,
  createChronicleRegions,
  createChronicleState,
  getContestedRegionIds,
  type ChronicleState,
} from '../src/game/world/Chronicle.ts'
import { createPlayerMeleeState } from '../src/game/world/CombatResolver.ts'
import { createCombatMasteryState } from '../src/game/world/CombatMastery.ts'
import {
  ExpeditionPlanner,
  isExpeditionSegmentClear,
  validateExpeditionRoute,
  type ExpeditionInput,
} from '../src/game/world/ExpeditionPlanner.ts'
import { captureFinaleBody, createFinaleIdentity, createFinaleState } from '../src/game/world/FinaleDirector.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { RegionManager } from '../src/game/world/RegionManager.ts'
import { createSquadCommandState } from '../src/game/world/SquadCommand.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { WORLD_FACTIONS, type WorldBlueprint } from '../src/game/world/worldTypes.ts'
import { attachCaravanBeats } from './caravanBeatFixture.ts'

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

function invoke<T = void>(engine: object, method: string, ...args: unknown[]): T {
  const callable = Reflect.get(engine, method)
  assert.equal(typeof callable, 'function', `${method} must be a production engine method`)
  return Reflect.apply(callable as (...values: unknown[]) => T, engine, args)
}

function interpolate(plan: CaravanBeatPlan, progress: number) {
  return {
    x: plan.cargoStart.x + (plan.deliveryEnd.x - plan.cargoStart.x) * progress,
    z: plan.cargoStart.z + (plan.deliveryEnd.z - plan.cargoStart.z) * progress,
  }
}

function readyCombatants(state: CaravanBeatState, defeated = false): void {
  for (const entry of state.combatants) {
    entry.maxHealth = 60
    entry.health = defeated && entry.enemy ? 0 : 60
    entry.defeated = defeated && entry.enemy
  }
}

function crossing(blueprint: WorldBlueprint, faction: Faction): CaravanBeatPlan {
  const plan = createCaravanBeatPlans(blueprint, faction)[0]
  assert.ok(plan, `${blueprint.seed}/${faction} has no crossing beat`)
  return plan
}

function viewContext(
  blueprint: WorldBlueprint,
  faction: Faction,
  player: { x: number; z: number },
  overrides: Partial<CaravanBeatViewContext> = {},
): CaravanBeatViewContext {
  return {
    blueprint,
    faction,
    objectives: createGeneratedObjectives(blueprint, faction),
    player,
    heading: 0,
    squadSize: 3,
    garrisonThinned: false,
    garrisonCanThin: true,
    marketSupply: SUPPLY_BASELINE,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Placement: the crossing beat is the old bridge, on a real dry road
// ---------------------------------------------------------------------------

test('the crossing beat keeps the old bridge plan on a real dry route for every faction', () => {
  const seeds = Array.from({ length: 80 }, (_, index) =>
    (20_260_909 + Math.imul(index, 2_654_435_761)) >>> 0)
  let checked = 0
  for (const seed of seeds) {
    const blueprint = generateWorld(seed)
    const fingerprint = blueprint.fingerprint
    const serialized = JSON.stringify(blueprint)
    const shop = blueprint.sites.find((site) => site.kind === 'shop')
    assert.ok(shop, `${seed} has no market`)
    for (const faction of WORLD_FACTIONS) {
      const plans = createCaravanBeatPlans(blueprint, faction)
      assert.deepEqual(createCaravanBeatPlans(blueprint, faction), plans)
      assert.equal(plans.length, 1, 'PR A plans the crossing beat only')
      const plan = plans[0]
      const bridge = createBridgeAmbushPlan(blueprint, faction)
      assert.ok(bridge)
      // The old save's ids and lane, exactly, so a version-1 bridge save migrates without loss.
      assert.equal(plan.id, bridge.id)
      assert.equal(plan.bridgeId, bridge.bridgeId)
      assert.deepEqual(plan.cargoStart, bridge.cargoStart)
      assert.deepEqual(plan.deliveryEnd, bridge.deliveryEnd)
      assert.deepEqual(plan.spawnPoints, bridge.spawnPoints)
      assert.deepEqual(
        createCaravanBeatState(plan).combatants,
        createBridgeAmbushState(blueprint, faction, bridge).combatants,
      )
      // The letter's sides: the guard escorts its own cart; the others rob the guard's.
      assert.equal(plan.owner, 'guard')
      assert.equal(plan.role, faction === 'guard' ? 'defend' : 'rob')
      if (faction === 'guard') assert.ok(plan.opponent === 'elf' || plan.opponent === 'villain')
      else assert.equal(plan.opponent, 'guard')
      assert.equal(plan.protectorRole, faction === 'guard' ? 'soldier' : null)
      assert.equal(plan.marketSiteId, shop.id)
      assert.equal(plan.marketRegionId, shop.regionId)
      assert.equal(plan.openingRoute.status, 'road')
      assert.equal(plan.deliveryRoute.status, 'road')
      assert.deepEqual(validateExpeditionRoute(
        new ExpeditionPlanner(blueprint).graph,
        plan.deliveryRoute,
      ), [])
      assert.ok(plan.deliveryRoute.bridgeIds.length > 0)
      assert.ok(getFactionStartPosition2D(blueprint, faction))
      for (const point of [plan.cargoStart, plan.deliveryEnd, plan.alternateApproach, ...plan.spawnPoints]) {
        assert.equal(
          isInsideRegionWater(blueprint, plan.regionId, point.x, point.z, 0.8),
          false,
          `${seed}/${faction} placed beat state in water`,
        )
      }
      assert.ok(Math.abs(plan.axis.x) > 0.99, 'generated bridge road axis must frame the crossing')
      assert.ok(Math.hypot(
        plan.deliveryEnd.x - plan.cargoStart.x,
        plan.deliveryEnd.z - plan.cargoStart.z,
      ) > 20)
      checked += 1
    }
    assert.equal(blueprint.fingerprint, fingerprint)
    assert.equal(JSON.stringify(blueprint), serialized)
  }
  assert.equal(checked, seeds.length * 3)
})

test('production collision keeps the cart lane and staging formation walkable', () => {
  const seeds = Array.from({ length: 16 }, (_, index) =>
    (31_337 + Math.imul(index, 2_654_435_761)) >>> 0)
  for (const seed of seeds) {
    const blueprint = generateWorld(seed)
    const runtime = new GeneratedWorldRuntime(new THREE.Scene(), blueprint, {
      terrainResolution: 6,
      decorationDensity: 0.35,
    })
    try {
      for (const faction of WORLD_FACTIONS) {
        const plan = crossing(blueprint, faction)
        runtime.update({ focus: plan.anchor, deltaSeconds: 0 })
        for (let step = 0; step <= 24; step += 1) {
          const point = interpolate(plan, step / 24)
          assert.equal(
            runtime.collision.isWalkablePosition(point.x, point.z, 1.4),
            true,
            `${seed}/${faction} blocked the physical delivery lane`,
          )
        }
        for (const authored of [plan.alternateApproach, ...plan.spawnPoints]) {
          let found = false
          for (let attempt = 0; attempt < 12; attempt += 1) {
            const ring = attempt === 0 ? 0 : 0.8 + Math.floor((attempt - 1) / 4) * 0.8
            const angle = attempt * Math.PI * 0.5
            if (runtime.collision.isWalkablePosition(
              authored.x + Math.cos(angle) * ring,
              authored.z + Math.sin(angle) * ring,
              0.7,
            )) {
              found = true
              break
            }
          }
          assert.equal(found, true, `${seed}/${faction} blocked a staging point`)
        }
      }
    } finally {
      runtime.dispose()
    }
  }
})

// ---------------------------------------------------------------------------
// Rules: the letter's verbs, one payout table, and the market
// ---------------------------------------------------------------------------

test('each side has its own verbs, and the guard never pockets cargo', () => {
  const blueprint = generateWorld(20_260_909)
  const robbed = crossing(blueprint, 'elf')
  const escorted = crossing(blueprint, 'guard')
  assert.deepEqual(caravanBeatChoices('elf', robbed), ['take', 'give'])
  assert.deepEqual(caravanBeatChoices('villain', robbed), ['plunder', 'press', 'burn'])
  assert.deepEqual(caravanBeatChoices('guard', escorted), ['deliver', 'release'])
  // A raid order, when the guard meets an enemy's cart: confiscation only.
  assert.deepEqual(caravanBeatChoices('guard', { ...robbed, owner: 'villain' }), ['confiscate'])
  // The guard pockets nothing: no take, plunder or give exists for it, on any cart.
  for (const plan of [escorted, { ...robbed, owner: 'villain' as const }]) {
    for (const outcome of caravanBeatChoices('guard', plan)) {
      assert.ok(!['take', 'plunder', 'give', 'press', 'burn'].includes(outcome), `the guard has ${outcome}`)
    }
  }
  // Every seizure counts once toward «Грабить корованы», the guard's confiscation included,
  // as its rich-caravan and chronicle raids already do; an escort never counts.
  for (const outcome of ['take', 'give', 'plunder', 'press', 'burn', 'confiscate'] as const) {
    assert.equal(caravanBeatCountsAsRobbery(outcome), true, `${outcome} is a seizure`)
  }
  for (const outcome of ['deliver', 'release'] as const) {
    assert.equal(caravanBeatCountsAsRobbery(outcome), false, `${outcome} is an escort`)
  }
  // One payout table, at the standard tier the bridge cart uses.
  assert.equal(robbed.tier, 'standard')
  assert.deepEqual(caravanBeatReward(robbed, 'take'), { gold: 90, rations: 0, recruits: 0, burnsSupply: false })
  assert.deepEqual(caravanBeatReward(robbed, 'plunder'), { gold: 90, rations: 0, recruits: 0, burnsSupply: false })
  assert.deepEqual(caravanBeatReward(robbed, 'give'), { gold: 0, rations: 2, recruits: 0, burnsSupply: false })
  assert.deepEqual(caravanBeatReward(robbed, 'press'), { gold: 0, rations: 0, recruits: 1, burnsSupply: false })
  assert.deepEqual(caravanBeatReward(robbed, 'burn'), { gold: 0, rations: 0, recruits: 0, burnsSupply: true })
  assert.deepEqual(caravanBeatReward(escorted, 'deliver'), { gold: 55, rations: 1, recruits: 0, burnsSupply: false })
  assert.deepEqual(caravanBeatReward(escorted, 'release'), { gold: 0, rations: 0, recruits: 0, burnsSupply: false })
  assert.deepEqual(caravanBeatReward(escorted, 'confiscate'), { gold: 70, rations: 0, recruits: 0, burnsSupply: false })
  assert.deepEqual(
    (['light', 'standard', 'rich'] as const).map((tier) => [
      caravanBeatReward({ ...robbed, tier }, 'take').gold,
      caravanBeatReward({ ...robbed, tier }, 'deliver').gold,
      caravanBeatReward({ ...robbed, tier }, 'confiscate').gold,
      caravanBeatReward({ ...robbed, tier }, 'give').rations,
    ]),
    [[70, 40, 55, 2], [90, 55, 70, 2], [120, 70, 95, 3]],
  )
  assert.equal(CARAVAN_BEAT_VALUE.standard, 90)
  // Burning thins the palace only for the villain, only for the side his assault is against,
  // and only once.
  assert.equal(caravanBeatThinsGarrison('villain', robbed, false), true)
  assert.equal(caravanBeatThinsGarrison('villain', robbed, true), false)
  assert.equal(caravanBeatThinsGarrison('villain', { ...robbed, owner: 'elf' }, false), false)
  assert.equal(caravanBeatThinsGarrison('elf', robbed, false), false)
})

test('every ending moves the one market, and the price line says by how much', () => {
  const blueprint = generateWorld(20_260_909)
  const plan = crossing(blueprint, 'elf')
  const loss = { kind: 'loss', amount: 0.19 }
  const arrival = { kind: 'arrival', amount: 0.14 }
  assert.deepEqual(caravanBeatMarketWrite(plan, 'take'), loss)
  assert.deepEqual(caravanBeatMarketWrite(plan, 'plunder'), loss)
  assert.deepEqual(caravanBeatMarketWrite(plan, 'press'), loss)
  assert.deepEqual(caravanBeatMarketWrite(plan, 'confiscate'), loss)
  assert.deepEqual(caravanBeatMarketWrite(plan, 'lost'), loss)
  assert.deepEqual(caravanBeatMarketWrite(plan, 'burn'), { kind: 'loss', amount: 0.34 })
  assert.deepEqual(caravanBeatMarketWrite(plan, 'give'), arrival)
  assert.deepEqual(caravanBeatMarketWrite(plan, 'deliver'), arrival)
  assert.deepEqual(caravanBeatMarketWrite(plan, 'release'), arrival)
  assert.deepEqual(caravanBeatMarketWrite(plan, 'escaped'), arrival)
  assert.equal(caravanBeatMarketWrite({ ...plan, marketRegionId: null }, 'take'), null)
  const robbed = caravanBeatMarketChange(caravanBeatMarketWrite(plan, 'take'), SUPPLY_BASELINE)
  const delivered = caravanBeatMarketChange(caravanBeatMarketWrite(plan, 'deliver'), SUPPLY_BASELINE)
  const burned = caravanBeatMarketChange(caravanBeatMarketWrite(plan, 'burn'), SUPPLY_BASELINE)
  assert.ok(robbed && delivered && burned)
  assert.equal(formatPriceFactor(robbed.before), '×1,18')
  assert.equal(formatPriceFactor(robbed.after), '×1,27')
  assert.equal(formatPriceFactor(delivered.after), '×1,12')
  assert.equal(formatPriceFactor(burned.after), '×1,33')
  assert.ok(burned.after > robbed.after && robbed.after > robbed.before && delivered.after < delivered.before)
  assert.match(describeCaravanBeatOutcome({
    outcome: 'take', gold: 90, rations: 0, thinnedGarrison: false, unattended: false,
    market: { regionLabel: 'C2', ...robbed },
  }), /\+90 золота\. Цены в лавке C2 ×1,18 → ×1,27\./)
})

test('the walked-away clock settles every engaged cart, and only engaged ones', () => {
  const blueprint = generateWorld(20_260_909)
  const robbed = crossing(blueprint, 'elf')
  const escorted = crossing(blueprint, 'guard')
  const far = CARAVAN_BEAT_ABANDON_RANGE + 1
  const expectations = [
    [robbed, 'fighting', 'escaped'],
    [robbed, 'secured', 'lost'],
    [robbed, 'delivering', 'unattended'],
    [escorted, 'fighting', 'lost'],
    [escorted, 'secured', 'release'],
    [escorted, 'delivering', 'unattended'],
  ] as const
  for (const [plan, phase, ending] of expectations) {
    const state = createCaravanBeatState(plan)
    state.phase = phase
    assert.equal(advanceCaravanBeatAbandon(plan, state, far, CARAVAN_BEAT_ABANDON_SECONDS - 1), null)
    assert.equal(state.abandonRemaining, 1)
    assert.equal(advanceCaravanBeatAbandon(plan, state, far, 1), ending, `${plan.role} ${phase}`)
    assert.equal(state.abandonRemaining, null)
  }
  // Coming back resets the clock to the top, it does not pause it.
  const back = createCaravanBeatState(robbed)
  back.phase = 'fighting'
  advanceCaravanBeatAbandon(robbed, back, far, 20)
  assert.equal(advanceCaravanBeatAbandon(robbed, back, CARAVAN_BEAT_ABANDON_RANGE, 1), null)
  assert.equal(back.abandonRemaining, null)
  assert.equal(advanceCaravanBeatAbandon(robbed, back, far, 20), null)
  // Negative controls: a cart the player stays beside, or never engaged, never settles itself.
  const beside = createCaravanBeatState(robbed)
  beside.phase = 'fighting'
  for (let second = 0; second < 1_000; second += 1) {
    assert.equal(advanceCaravanBeatAbandon(robbed, beside, CARAVAN_BEAT_ABANDON_RANGE, 1), null)
  }
  const untouched = createCaravanBeatState(robbed)
  assert.equal(advanceCaravanBeatAbandon(robbed, untouched, far, 1_000), null)
  assert.equal(untouched.phase, 'approach')
})

// ---------------------------------------------------------------------------
// Persistence and the version-1 bridge migration
// ---------------------------------------------------------------------------

test('beat state normalization preserves wounds and progress but rejects invented outcomes', () => {
  const blueprint = generateWorld(20_260_909)
  const plans = createCaravanBeatPlans(blueprint, 'guard')
  const plan = plans[0]
  const fighting = createCaravanBeatsState(plans)
  readyCombatants(fighting.beats[0])
  fighting.beats[0].phase = 'fighting'
  fighting.beats[0].combatants[0].health = 17
  fighting.beats[0].cargoHealth = 63
  fighting.beats[0].abandonRemaining = 12.5
  const restoredFight = normalizeCaravanBeatsState(
    JSON.parse(JSON.stringify(serializeCaravanBeatsState(fighting))), blueprint, 'guard', plans,
  )
  assert.ok(restoredFight)
  assert.equal(restoredFight.beats[0].combatants[0].health, 17)
  assert.equal(restoredFight.beats[0].cargoHealth, 63)
  assert.equal(restoredFight.beats[0].abandonRemaining, 12.5, 'the walked-away clock is not refreshed')
  const region = blueprint.regions.find((entry) => entry.id === plan.marketRegionId)
  assert.ok(region)
  const secured = createCaravanBeatsState(plans)
  readyCombatants(secured.beats[0], true)
  secured.beats[0].phase = 'secured'
  const view = buildCaravanBeatView(viewContext(blueprint, 'guard', plan.cargoStart), plan, secured.beats[0])
  assert.deepEqual(view.choices.map((choice) => choice.outcome), ['deliver', 'release'])
  assert.match(view.choices[0].detail, /\+55 от командира и \+1 паёк/)
  assert.match(view.choices[0].detail,
    new RegExp(`цены в лавке ${formatRegionGridLabel(region.coordinate.x, region.coordinate.y)}`))

  const delivering = createCaravanBeatsState(plans)
  readyCombatants(delivering.beats[0], true)
  delivering.beats[0].phase = 'delivering'
  delivering.beats[0].outcome = 'deliver'
  const midpoint = interpolate(plan, 0.42)
  delivering.beats[0].cargoX = midpoint.x
  delivering.beats[0].cargoZ = midpoint.z
  delivering.beats[0].progress = caravanBeatDeliveryProgress(plan, midpoint)
  const restoredDelivery = normalizeCaravanBeatsState(
    serializeCaravanBeatsState(delivering), blueprint, 'guard', plans,
  )
  assert.ok(restoredDelivery)
  assert.equal(restoredDelivery.beats[0].progress, delivering.beats[0].progress)

  const forge = (patch: Partial<CaravanBeatState>, faction: Faction = 'guard') => {
    const forged = structuredClone(delivering)
    Object.assign(forged.beats[0], patch)
    return normalizeCaravanBeatsState(serializeCaravanBeatsState(forged), blueprint, faction, plans)
  }
  assert.equal(forge({ phase: 'resolved', rewardPaid: false, consequence: 'free reward' }), null)
  // A walking verb that is not this side's, or a robbery claimed for a defended cart.
  assert.equal(forge({ outcome: 'give' }), null)
  assert.equal(forge({ phase: 'escaped', outcome: null, consequence: 'ушёл', progress: 0,
    cargoX: plan.cargoStart.x, cargoZ: plan.cargoStart.z }), null)
  assert.equal(forge({ abandonRemaining: CARAVAN_BEAT_ABANDON_SECONDS + 1 }), null)
  assert.equal(forge({ placement: 'forest' }), null)
  // Negative control: the unforged delivery is accepted by the same normaliser.
  assert.ok(forge({}))
})

test('version-1 bridge saves migrate phase for phase; a villain mid-walk chooses again', () => {
  const blueprint = generateWorld(20_260_909)
  const legacyFor = (faction: Faction, patch: (state: ReturnType<typeof createBridgeAmbushState>) => void) => {
    const bridge = createBridgeAmbushPlan(blueprint, faction)
    assert.ok(bridge)
    const state = createBridgeAmbushState(blueprint, faction, bridge)
    for (const entry of state.combatants) {
      entry.maxHealth = 60
      entry.health = 60
    }
    patch(state)
    return { bridge, saved: serializeBridgeAmbushState(state) }
  }
  const restore = (faction: Faction, saved: unknown) =>
    restoreCaravanBeatsState({ bridgeAmbush: saved as never }, blueprint, faction,
      createCaravanBeatPlans(blueprint, faction))

  const fighting = legacyFor('guard', (state) => {
    state.phase = 'fighting'
    state.combatants[0].health = 21
    state.cargoHealth = 44
  })
  const fight = restore('guard', fighting.saved)
  assert.equal(fight.rejected, false)
  assert.equal(fight.state?.beats[0].phase, 'fighting')
  assert.equal(fight.state?.beats[0].combatants[0].health, 21)
  assert.equal(fight.state?.beats[0].cargoHealth, 44)

  for (const [faction, outcome] of [['elf', 'take'], ['villain', 'plunder'], ['guard', 'confiscate']] as const) {
    const seized = legacyFor(faction, (state) => {
      for (const entry of state.combatants) if (entry.enemy) {
        entry.health = 0
        entry.defeated = true
      }
      state.phase = 'resolved'
      state.outcome = 'seize'
      state.rewardPaid = true
      state.consequence = 'Груз присвоен: +85 золота.'
    })
    const migrated = restore(faction, seized.saved)
    assert.equal(migrated.rejected, false)
    assert.equal(migrated.state?.beats[0].outcome, outcome)
    assert.equal(migrated.state?.beats[0].rewardPaid, true, 'a paid seizure is never paid again')
    assert.equal(migrated.state?.beats[0].consequence, 'Груз присвоен: +85 золота.')
    // The migrated block normalises as itself on the next continue.
    const saved = serializeCaravanBeatsState(migrated.state!)
    assert.ok(normalizeCaravanBeatsState(saved, blueprint, faction, createCaravanBeatPlans(blueprint, faction)))
  }

  for (const [faction, outcome] of [['elf', 'give'], ['guard', 'deliver']] as const) {
    const walking = legacyFor(faction, (state) => {
      for (const entry of state.combatants) if (entry.enemy) {
        entry.health = 0
        entry.defeated = true
      }
      state.phase = 'delivering'
      state.outcome = 'deliver'
      const midpoint = interpolate(crossing(blueprint, faction), 0.3)
      state.cargoX = midpoint.x
      state.cargoZ = midpoint.z
      state.progress = 0.3
    })
    const migrated = restore(faction, walking.saved)
    assert.equal(migrated.rejected, false)
    assert.equal(migrated.reopened, false)
    assert.equal(migrated.state?.beats[0].phase, 'delivering')
    assert.equal(migrated.state?.beats[0].outcome, outcome)
    assert.equal(migrated.state?.beats[0].progress, 0.3)
    // The next continue reads the migrated walk as a version-1 caravan block.
    assert.ok(normalizeCaravanBeatsState(serializeCaravanBeatsState(migrated.state!), blueprint, faction,
      createCaravanBeatPlans(blueprint, faction)))
  }
  const villainWalk = legacyFor('villain', (state) => {
    for (const entry of state.combatants) if (entry.enemy) {
      entry.health = 0
      entry.defeated = true
    }
    state.phase = 'delivering'
    state.outcome = 'deliver'
    const midpoint = interpolate(crossing(blueprint, 'villain'), 0.3)
    state.cargoX = midpoint.x
    state.cargoZ = midpoint.z
    state.progress = 0.3
  })
  const reopened = restore('villain', villainWalk.saved)
  assert.equal(reopened.reopened, true)
  assert.equal(reopened.state?.beats[0].phase, 'secured')
  assert.equal(reopened.state?.beats[0].outcome, null)
  assert.equal(reopened.state?.beats[0].rewardPaid, false)
  assert.equal(reopened.state?.beats[0].cargoX, crossing(blueprint, 'villain').cargoStart.x)

  // A corrupt old block is still rejected by the shipped normaliser, and nothing is paid.
  const corrupt = restore('elf', { ...legacyFor('elf', () => {}).saved, phase: 'resolved', rewardPaid: true })
  assert.equal(corrupt.rejected, true)
  assert.equal(corrupt.state?.beats[0].phase, 'unavailable')
  assert.equal(corrupt.state?.beats[0].rewardPaid, false)
  // Both blocks: the new one wins. Neither: a run from before the bridge stays without beats.
  const plans = createCaravanBeatPlans(blueprint, 'elf')
  const both = restoreCaravanBeatsState({
    caravanBeats: serializeCaravanBeatsState(createCaravanBeatsState(plans)) as never,
    bridgeAmbush: seizedLegacyFor(blueprint) as never,
  }, blueprint, 'elf', plans)
  assert.equal(both.state?.beats[0].phase, 'approach')
  assert.deepEqual(restoreCaravanBeatsState({}, blueprint, 'elf', plans),
    { state: null, rejected: false, reopened: false })
  // Negative control: the old block read as the new one, without the migration, is refused.
  assert.equal(normalizeCaravanBeatsState(fighting.saved, blueprint, 'guard',
    createCaravanBeatPlans(blueprint, 'guard')), null)
})

function seizedLegacyFor(blueprint: WorldBlueprint) {
  const bridge = createBridgeAmbushPlan(blueprint, 'elf')
  assert.ok(bridge)
  const state = createBridgeAmbushState(blueprint, 'elf', bridge)
  for (const entry of state.combatants) {
    entry.maxHealth = 60
    entry.health = 0
    entry.defeated = true
  }
  state.phase = 'resolved'
  state.outcome = 'seize'
  state.rewardPaid = true
  state.consequence = 'old'
  return serializeBridgeAmbushState(state)
}

test('the сводка reads how each settled beat ended and nothing else', () => {
  const blueprint = generateWorld(20_260_909)
  const plans = createCaravanBeatPlans(blueprint, 'villain')
  const state = createCaravanBeatsState(plans)
  assert.deepEqual(summarizeCaravanBeats(serializeCaravanBeatsState(state)), [])
  readyCombatants(state.beats[0], true)
  state.beats[0].phase = 'resolved'
  state.beats[0].outcome = 'burn'
  state.beats[0].rewardPaid = true
  state.beats[0].consequence = 'Груз сожжён.'
  assert.deepEqual(summarizeCaravanBeats(serializeCaravanBeatsState(state)),
    [{ placement: 'bridge', regionId: plans[0].regionId, ending: 'burn' }])
  assert.deepEqual(summarizeCaravanBeats({ beats: [{ phase: 'resolved', outcome: 'seize' }] }), [])
  assert.deepEqual(summarizeCaravanBeats(null), [])
})

// ---------------------------------------------------------------------------
// The engine: production methods on a field-by-field engine
// ---------------------------------------------------------------------------

interface HarnessActor {
  id: string
  allegiance: Allegiance
  role: ActorRole
  mesh: THREE.Group
  alive: boolean
  hp: number
  maxHp: number
  targetId: string | null
  generatedSpawnId: string | null
  generatedRegionId: string | null
  generatedEncounterId: string | null
  generatedObjectiveId: string | null
  generatedUnique: boolean
  objectiveEligible: boolean
  squadEligible: boolean
  squadSlot: number | null
  budgetCategory: 'squad' | 'campaign' | 'chronicle' | 'ambient'
  eventOwnerId: string | null
  eventPropTargetId: string | null
  aiMode: 'normal' | 'attackEventProp'
  hostileToPlayer: boolean
  home: THREE.Vector3
  wanderTarget: THREE.Vector3
  order: null | { kind: string; position: THREE.Vector3; timer: number }
  routTimer: number
  attackCooldown: number
  action: null
  reaction: string
  playerAggro: boolean
  retaliationTimer: number
  rageTimer: number
  chargeWindup: number
  chargeTimer: number
  knockbackVelocity: THREE.Vector3
  healthBar: THREE.Sprite
  healthBarTexture: THREE.Texture
}

function actor(
  id: string,
  allegiance: Allegiance,
  role: ActorRole,
  category: HarnessActor['budgetCategory'] = 'campaign',
): HarnessActor {
  const mesh = new THREE.Group()
  return {
    id: `generated:${id}`,
    allegiance,
    role,
    mesh,
    alive: true,
    hp: 60,
    maxHp: 60,
    targetId: null,
    generatedSpawnId: id,
    generatedRegionId: null,
    generatedEncounterId: null,
    generatedObjectiveId: null,
    generatedUnique: false,
    objectiveEligible: false,
    squadEligible: false,
    squadSlot: null,
    budgetCategory: category,
    eventOwnerId: null,
    eventPropTargetId: null,
    aiMode: 'normal',
    hostileToPlayer: false,
    home: mesh.position.clone(),
    wanderTarget: mesh.position.clone(),
    order: null,
    routTimer: 0,
    attackCooldown: 0,
    action: null,
    reaction: 'none',
    playerAggro: false,
    retaliationTimer: 0,
    rageTimer: 0,
    chargeWindup: 0,
    chargeTimer: 0,
    knockbackVelocity: new THREE.Vector3(),
    healthBar: new THREE.Sprite(),
    healthBarTexture: new THREE.Texture(),
  }
}

function squadMember(faction: Faction, index: number): HarnessActor {
  const member = actor(`squad:${index}`, faction, 'soldier', 'squad')
  member.id = `squad-member-${index}`
  member.generatedSpawnId = null
  member.squadEligible = true
  return member
}

function achievementState(runId: string, faction: Faction) {
  return {
    runId,
    faction,
    startedAt: '2026-09-09T10:00:00.000Z',
    kills: 0,
    killsSinceDamage: 0,
    bestKillStreak: 0,
    damageTaken: 0,
    injuries: 0,
    limbsLost: 0,
    goldEarned: 0,
    purchases: 0,
    objectivesCompleted: 0,
    eventsCompleted: 0,
    abilitiesUsed: 0,
    shieldBlocks: 0,
    squadCommands: 0,
    caravansRobbed: 0,
    zonesVisited: ['neutral' as const],
    eventKindsCompleted: [],
    unlockedIds: [],
    result: null,
    elapsedAtEnd: 0,
    healthAtEnd: 0,
  }
}

function harness(faction: Faction = 'guard', seed = 20_260_909, options: { spine?: boolean } = {}) {
  const blueprint = generateWorld(seed)
  const player = new THREE.Group()
  const actors: HarnessActor[] = []
  const notices: string[] = []
  const tally = { robbed: 0, gold: 0, objectives: 0 }
  const regions = new RegionManager(blueprint)
  const chronicleRegions = createChronicleRegions(blueprint)
  const finale = createFinaleState(createFinaleIdentity(blueprint, faction))
  const runId = `caravan-beat-test-${faction}`
  const engine: object = Object.create(GameEngine.prototype)
  const generatedWorld = {
    bounds: blueprint.bounds,
    regions,
    discoveredRegionIds: [] as string[],
    sampleHeight: () => 0,
    getRegionIdAt: () => '',
    getRegionBounds: (id: string) => getBlueprintRegionBounds(blueprint, id),
    getSitePosition: (id: string) => {
      const position = getSiteWorldPosition2D(blueprint, id)
      return position ? { ...position, y: 0 } : undefined
    },
  }
  Object.assign(engine, {
    faction,
    generatedBlueprint: blueprint,
    generatedWorld,
    generatedRun: {
      runId,
      config: {
        seed: blueprint.seed,
        generatorVersion: blueprint.generatorVersion,
        faction,
        selectedBoonId: 'provisions',
      },
      startedAt: '2026-09-09T10:00:00.000Z',
    },
    player,
    actors,
    eventPropTargets: new Map(),
    simulatedGeneratedRegions: new Set<string>(),
    generatedEncounterPlans: new Map(),
    generatedActivationSpawns: new Map(),
    generatedNavigationCache: new Map(),
    actorSequence: 0,
    elapsed: 20,
    paused: false,
    ended: false,
    gold: 55,
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    kills: 0,
    damage: 28,
    body: createHealthyBody(),
    objectives: createGeneratedObjectives(blueprint, faction),
    upgrades: { blade: 0, vitality: 0, endurance: 0 },
    generatedSupplyCount: 0,
    generatedHealthBonus: 0,
    generatedStaminaBonus: 0,
    threatTier: 1,
    nextThreatWaveAt: 180,
    championDamageBonus: 0,
    caravan: new THREE.Group(),
    caravanCooldown: 0,
    caravanDirection: 1,
    caravanDefenseCredit: false,
    caravanAidCooldown: 0,
    eventCooldown: 70,
    eventSequence: 0,
    activeEvents: [],
    activeContractNodeId: null,
    materializedSituationIds: new Set(),
    locatedEventCopy: new Map(),
    campaignContracts: createCampaignContractState(),
    chronicleCommitments: createChronicleCommitmentState(),
    chronicleRegions,
    chronicleState: createChronicleState(),
    chronicleContestedRegionIds: new Set(),
    doctrines: createDoctrineRunState([]),
    doctrineEffects: resolveDoctrineEffects([]),
    finale,
    squadCommand: createSquadCommandState({ x: 0, z: 0, heading: 0 }, false),
    squadNavigation: new Map(),
    squadBlockedSeconds: new Map(),
    squadIntents: new Map(),
    expeditionPlanner: new ExpeditionPlanner(blueprint),
    hints: { pending: () => [] },
    lootPickups: [],
    generatedRunStatus: 'active',
    runEnding: null,
    cameraYaw: 0,
    shieldActive: false,
    abilityCooldown: 0,
    attackCooldown: 0,
    combatMastery: createCombatMasteryState(),
    melee: createPlayerMeleeState(),
    honestMelee: true,
    generatedRngStreams: {
      combat: new RandomStream(1),
      director: new RandomStream(2),
      event: new RandomStream(3),
      loot: new RandomStream(4),
      chronicle: new RandomStream(5),
      rumour: new RandomStream(6),
      injury: new RandomStream(7),
    },
    achievements: {
      getRunState: () => achievementState(runId, faction),
      recordGoldEarned: (amount: number) => { tally.gold += amount },
      recordCaravanRobbed: () => { tally.robbed += 1 },
      recordObjectiveCompleted: () => { tally.objectives += 1 },
    },
    callbacks: {
      onNotice: (message: string) => notices.push(message),
      onSaveRequest() {},
    },
    scene: new THREE.Scene(),
    projectiles: [],
    projectileSourcesToClear: new Set(),
    updatingProjectiles: false,
    squadNavigationRevision: '',
  })
  const beat = attachCaravanBeats(engine, blueprint, faction, undefined, { spine: options.spine === true })
  const { plan, state, cart, runtime } = beat
  player.position.set(plan.cargoStart.x, 0, plan.cargoStart.z)
  regions.update(plan.regionId)
  generatedWorld.discoveredRegionIds.push(plan.regionId)
  generatedWorld.getRegionIdAt = () => plan.regionId
  ;(Reflect.get(engine, 'simulatedGeneratedRegions') as Set<string>).add(plan.regionId)
  Reflect.set(engine, 'actorBudget', new ActorBudget((category, count) =>
    invoke<number>(engine, 'yieldActorSlots', category, count)))
  for (const method of [
    'emitView',
    'playSound',
    'drawActorHealthBar',
    'releaseActorTelegraph',
    'removeAndDisposeObject',
    'registerNamedInteractableOutline',
    'resumeAudio',
    'spawnDecal',
    'presentCaravanLooting',
  ]) {
    Reflect.set(engine, method, () => {})
  }
  Reflect.set(engine, 'groundHeightAt', () => 0)
  Reflect.set(engine, 'isWalkablePosition', () => true)
  Reflect.set(engine, 'actorColliderRadiusForRole', () => 0.7)
  Reflect.set(engine, 'moveCharacter', (
    position: THREE.Vector3,
    dx: number,
    dz: number,
  ) => {
    position.x += dx
    position.z += dz
    return false
  })
  Reflect.set(engine, 'spawnActor', (
    allegiance: Allegiance,
    role: ActorRole,
    x: number,
    z: number,
    _index: number,
    options: {
      budget: HarnessActor['budgetCategory']
      generatedSpawnId?: string
      hostileToPlayer?: boolean
      squadEligible?: boolean
    },
  ) => {
    assert.ok(actors.length < MAX_ACTORS)
    const spawned = actor(options.generatedSpawnId ?? `spawned-${actors.length}`, allegiance, role, options.budget)
    spawned.mesh.position.set(x, 0, z)
    Object.assign(spawned, options)
    actors.push(spawned)
    return spawned
  })
  const entry = () => invoke<object>(engine, 'caravanBeatEntry', plan.id)
  const choose = (outcome: string) => invoke<boolean>(engine, 'chooseCaravanBeat', plan.id, outcome)
  const secure = () => {
    readyCombatants(state, true)
    state.phase = 'secured'
    player.position.copy(cart.position)
  }
  return {
    engine, blueprint, plan, state, player, cart, runtime, actors, notices, tally,
    regions, chronicleRegions, finale, entry, choose, secure,
  }
}

function chronicleLog(engine: object): ChronicleState['log'] {
  return (Reflect.get(engine, 'chronicleState') as ChronicleState).log
}

test('the elf takes or gives, from the cart only and once, and the market answers', () => {
  const taken = harness('elf')
  readyCombatants(taken.state)
  taken.state.phase = 'fighting'
  assert.equal(taken.choose('take'), false, 'nothing to take while the escort stands')
  taken.secure()
  const objectivesBefore = JSON.stringify(Reflect.get(taken.engine, 'objectives'))
  taken.player.position.x += 20
  assert.equal(taken.choose('take'), false, 'nothing to take from 20 m away')
  assert.equal(Reflect.get(taken.engine, 'gold'), 55)
  taken.player.position.copy(taken.cart.position)
  // Negative control: another side's verb on the same cart is refused and pays nothing.
  for (const foreign of ['plunder', 'confiscate', 'deliver', 'seize']) {
    assert.equal(taken.choose(foreign), false, `the elf used ${foreign}`)
  }
  assert.equal(Reflect.get(taken.engine, 'gold'), 55)
  const market = taken.chronicleRegions.get(taken.plan.marketRegionId ?? '')
  assert.ok(market)
  const before = market.supply
  assert.equal(taken.choose('take'), true)
  assert.equal(Reflect.get(taken.engine, 'gold'), 145)
  assert.equal(taken.tally.gold, 90)
  assert.equal(taken.tally.robbed, 1, 'a beat robbery counts toward «Грабить корованы»')
  assert.equal(taken.state.phase, 'resolved')
  assert.ok(market.supply < before, 'the market never saw the cargo')
  const written = chronicleLog(taken.engine).filter((event) =>
    event.id.startsWith(CARAVAN_BEAT_CHRONICLE_PREFIX))
  assert.deepEqual(written.map((event) => [event.kind, event.regionId, event.siteId, event.faction]),
    [['caravanLost', taken.plan.regionId, taken.plan.marketSiteId, 'guard']])
  assert.equal(taken.regions.getSavedDelta(taken.plan.marketRegionId ?? '')?.chronicle.supply, market.supply)
  assert.match(taken.state.consequence ?? '', /\+90 золота\. Цены в лавке/)
  assert.ok(taken.notices.includes(taken.state.consequence ?? ''))
  // Once: a second choice, or a continue, pays nothing more.
  assert.equal(taken.choose('take'), false)
  assert.equal(Reflect.get(taken.engine, 'gold'), 145)
  assert.equal(taken.tally.robbed, 1)
  assert.equal(JSON.stringify(Reflect.get(taken.engine, 'objectives')), objectivesBefore)
  const saved = invoke<ActiveRunSaveV3>(taken.engine, 'saveGeneratedRun')
  assert.equal(saved.directorState.bridgeAmbush, undefined, 'the version-1 block is never written again')
  const restored = restoreCaravanBeatsState(saved.directorState, taken.blueprint, 'elf',
    createCaravanBeatPlans(taken.blueprint, 'elf'))
  assert.equal(restored.rejected, false)
  const reloaded = harness('elf')
  attachCaravanBeats(reloaded.engine, reloaded.blueprint, 'elf', restored.state!)
  Reflect.set(reloaded.engine, 'gold', saved.player.gold)
  assert.equal(invoke<boolean>(reloaded.engine, 'chooseCaravanBeat', reloaded.plan.id, 'take'), false)
  assert.equal(Reflect.get(reloaded.engine, 'gold'), 145)

  // Giving: a walk beside the cart, rations from the houses, cheaper prices at the market.
  const given = harness('elf')
  given.secure()
  const givenMarket = given.chronicleRegions.get(given.plan.marketRegionId ?? '')
  assert.ok(givenMarket)
  const givenBefore = givenMarket.supply
  assert.equal(given.choose('give'), true)
  assert.equal(given.state.phase, 'delivering')
  assert.equal(given.tally.robbed, 0, 'counted when the outcome lands, not when the walk starts')
  for (let step = 0; step < 100 && given.state.phase === 'delivering'; step += 1) {
    given.player.position.copy(given.cart.position)
    invoke(given.engine, 'updateCaravanBeatDelivery', given.entry(), 0.25)
  }
  assert.equal(given.state.phase, 'resolved')
  assert.equal(given.state.outcome, 'give')
  assert.equal(Reflect.get(given.engine, 'generatedSupplyCount'), 2)
  assert.equal(Reflect.get(given.engine, 'gold'), 55)
  assert.equal(given.tally.robbed, 1)
  assert.ok(givenMarket.supply > givenBefore, 'the houses trade the goods on')
})

test('the guard walks its own cart in or sends it on, and is paid by the commander only', () => {
  const delivered = harness('guard')
  assert.equal(invoke<boolean>(delivered.engine, 'materializeCaravanBeat', delivered.entry()), true)
  assert.equal(delivered.state.phase, 'fighting')
  assert.ok(Reflect.get(delivered.engine, 'eventPropTargets').has(`caravan-beat:${delivered.plan.id}:cargo`))
  for (const combatant of delivered.state.combatants) {
    if (!combatant.enemy) continue
    const live = delivered.actors.find((entry) => entry.generatedSpawnId === combatant.id)
    assert.ok(live)
    live.alive = false
    live.hp = 0
  }
  invoke(delivered.engine, 'syncCaravanBeatCombat')
  assert.equal(delivered.state.phase, 'secured')
  // The guard never pockets cargo: no robbing verb exists for it, here or anywhere.
  for (const pocket of ['take', 'plunder', 'give', 'press', 'burn', 'confiscate', 'seize']) {
    assert.equal(delivered.choose(pocket), false, `the guard used ${pocket} on its own cart`)
  }
  assert.equal(Reflect.get(delivered.engine, 'gold'), 55)
  assert.equal(delivered.choose('deliver'), true)
  const before = delivered.cart.position.clone()
  delivered.player.position.set(
    delivered.cart.position.x + CARAVAN_BEAT_DELIVERY_ESCORT_RADIUS + 1,
    0,
    delivered.cart.position.z,
  )
  invoke(delivered.engine, 'updateCaravanBeatDelivery', delivered.entry(), 1)
  assert.deepEqual(delivered.cart.position.toArray(), before.toArray(), 'no guide, no movement')
  const market = delivered.chronicleRegions.get(delivered.plan.marketRegionId ?? '')
  assert.ok(market)
  const supplyBefore = market.supply
  for (let step = 0; step < 100 && delivered.state.phase === 'delivering'; step += 1) {
    delivered.player.position.copy(delivered.cart.position)
    invoke(delivered.engine, 'updateCaravanBeatDelivery', delivered.entry(), 0.25)
  }
  assert.equal(delivered.state.phase, 'resolved')
  assert.equal(delivered.state.outcome, 'deliver')
  assert.equal(delivered.state.rewardPaid, true)
  assert.ok(delivered.state.progress >= 0.99)
  assert.equal(Reflect.get(delivered.engine, 'gold'), 110)
  assert.equal(Reflect.get(delivered.engine, 'generatedSupplyCount'), 1)
  assert.equal(delivered.tally.robbed, 0, 'an escort is not a robbery')
  assert.ok(market.supply > supplyBefore)
  assert.deepEqual(chronicleLog(delivered.engine).filter((event) =>
    event.id.startsWith(CARAVAN_BEAT_CHRONICLE_PREFIX)).map((event) =>
    [event.kind, event.regionId, event.siteId, event.faction]),
  [['caravanArrived', delivered.plan.marketRegionId, delivered.plan.marketSiteId, 'guard']])
  invoke(delivered.engine, 'resolveCaravanBeatDelivery', delivered.entry())
  assert.equal(Reflect.get(delivered.engine, 'gold'), 110, 'a resolved walk never pays again')

  const released = harness('guard')
  released.secure()
  const protector = released.state.combatants.find((entry) => !entry.enemy)
  assert.ok(protector)
  invoke(released.engine, 'updateCaravanBeats', 0)
  assert.ok(released.actors.some((entry) => entry.generatedSpawnId === protector.id && entry.alive))
  assert.equal(released.choose('release'), true)
  assert.equal(released.state.phase, 'resolved')
  assert.equal(released.state.outcome, 'release')
  assert.equal(Reflect.get(released.engine, 'gold'), 55, 'sent on alone, unpaid')
  assert.equal(Reflect.get(released.engine, 'generatedSupplyCount'), 0)
  // The cart left the road with the soldier beside it, and neither comes back.
  assert.equal(released.runtime.cart.visible, false)
  invoke(released.engine, 'updateCaravanBeats', 0)
  assert.equal(released.actors.some((entry) => entry.generatedSpawnId === protector.id), false)
})

test('the villain plunders, press-gangs up to the squad cap, or burns the palace short', () => {
  const plundered = harness('villain')
  plundered.secure()
  assert.equal(plundered.choose('plunder'), true)
  assert.equal(Reflect.get(plundered.engine, 'gold'), 145)
  assert.equal(plundered.tally.robbed, 1)

  const pressed = harness('villain')
  for (let index = 0; index < 3; index += 1) pressed.actors.push(squadMember('villain', index))
  pressed.secure()
  assert.equal(pressed.choose('press'), true)
  const recruit = pressed.actors.find((entry) => entry.id === `${pressed.plan.id}:recruit`)
  assert.ok(recruit, 'a real companion joins at the cart')
  assert.equal(recruit.allegiance, 'villain')
  assert.equal(recruit.budgetCategory, 'squad')
  assert.equal(recruit.squadEligible, true)
  assert.equal(pressed.actors.filter((entry) => entry.budgetCategory === 'squad').length, CARAVAN_BEAT_SQUAD_CAP)
  assert.equal(Reflect.get(pressed.engine, 'gold'), 55)
  assert.equal(pressed.tally.robbed, 1)
  const companions = invoke<ActiveRunSaveV3>(pressed.engine, 'saveGeneratedRun').companions ?? []
  assert.ok(companions.some((entry) => entry.id === recruit.id), 'the recruit is saved with the squad')

  // Negative control: at the cap the choice is refused with its reason, and nothing is spent.
  const full = harness('villain')
  for (let index = 0; index < CARAVAN_BEAT_SQUAD_CAP; index += 1) full.actors.push(squadMember('villain', index))
  full.secure()
  assert.equal(full.choose('press'), false)
  assert.equal(full.state.phase, 'secured')
  assert.equal(full.state.outcome, null)
  assert.ok(full.notices.some((notice) => notice.includes('Войско полно')))
  assert.equal(full.actors.length, CARAVAN_BEAT_SQUAD_CAP)

  const burned = harness('villain')
  burned.secure()
  assert.equal(burned.choose('burn'), true)
  assert.equal(burned.finale.escorts.filter((escort) => escort.defeated).length, 1,
    'the palace finale has one escort fewer')
  assert.equal(Reflect.get(burned.engine, 'caravanBeats').garrisonThinned, true)
  assert.match(burned.state.consequence ?? '', /на одного стражника меньше/)
  assert.equal(Reflect.get(burned.engine, 'gold'), 55)
  const market = burned.chronicleRegions.get(burned.plan.marketRegionId ?? '')
  assert.ok(market)
  assert.ok(Math.abs(market.supply - (SUPPLY_BASELINE - 0.34)) < 1e-9, 'burned cargo costs a depot')
  // Negative controls: a second burn thins nothing more, and a finale already begun keeps its garrison.
  const again = harness('villain')
  Reflect.get(again.engine, 'caravanBeats').garrisonThinned = true
  again.secure()
  assert.equal(again.choose('burn'), true)
  assert.equal(again.finale.escorts.filter((escort) => escort.defeated).length, 0)
  const begun = harness('villain')
  begun.finale.introduced = true
  begun.secure()
  assert.equal(begun.choose('burn'), true)
  assert.equal(begun.finale.escorts.filter((escort) => escort.defeated).length, 0)
  assert.doesNotMatch(begun.state.consequence ?? '', /стражника/)
})

test('the burn choice promises exactly what burning does to the palace', () => {
  // Review finding: both palace guards had been on the field before, the panel still promised
  // «на одного стражника меньше», and the burn then thinned nobody. The panel and the burn now
  // ask the same question of the finale, so the promise and the effect cannot part ways.
  const burnDetail = (value: ReturnType<typeof harness>) => invoke<CaravanBeatsView>(
    value.engine, 'buildCaravanBeatsView', { mode: 'campaign', target: null, route: null, guidance: null },
  ).active?.choices.find((choice) => choice.outcome === 'burn')?.detail ?? ''
  const guardBody = { x: 0, z: 0, health: 60, maxHealth: 60, heading: 0, cooldown: 0 }

  // Both guards were seen at the gate on an earlier visit and are not standing there now.
  const seen = harness('villain')
  for (const id of seen.finale.identity.escortIds) captureFinaleBody(seen.finale, id, { ...guardBody })
  seen.secure()
  assert.match(burnDetail(seen), /на одного стражника меньше/)
  assert.equal(seen.choose('burn'), true)
  assert.equal(seen.finale.escorts.filter((escort) => escort.defeated).length, 1)
  assert.match(seen.state.consequence ?? '', /на одного стражника меньше/)

  // Negative control: both guards stand in the world right now. The panel promises nothing,
  // and burning thins nothing, so the player is never paid in a promise.
  const standing = harness('villain')
  for (const id of standing.finale.identity.escortIds) standing.actors.push(actor(id, 'guard', 'soldier'))
  standing.secure()
  assert.match(burnDetail(standing), /Только дым/)
  assert.doesNotMatch(burnDetail(standing), /стражника/)
  assert.equal(standing.choose('burn'), true)
  assert.equal(standing.finale.escorts.filter((escort) => escort.defeated).length, 0)
  assert.doesNotMatch(standing.state.consequence ?? '', /стражника/)
  assert.equal(Reflect.get(standing.engine, 'caravanBeats').garrisonThinned, false)

  // And once the finale has begun, neither the panel nor the burn touches its garrison.
  const begun = harness('villain')
  begun.finale.introduced = true
  begun.secure()
  assert.match(burnDetail(begun), /Только дым/)
})
test('the press-gang cap of four fits the actor budget even in a full world', () => {
  // Three starters and one recruit borrow one slot past the squad's own three. With every
  // other category at its share the world is full, and the finale's three campaign spawns
  // must still be reservable: ambient and chronicle give way, the squad and the cap hold.
  assert.equal(CARAVAN_BEAT_SQUAD_CAP, ACTOR_BUDGET.squad + 1)
  const yielded: string[] = []
  const usage = { squad: CARAVAN_BEAT_SQUAD_CAP, campaign: ACTOR_BUDGET.campaign, chronicle: ACTOR_BUDGET.chronicle,
    ambient: ACTOR_BUDGET.ambient - 1 }
  const budget = new ActorBudget((category, count) => {
    yielded.push(category)
    usage[category] -= count
    return count
  })
  budget.sync(usage)
  assert.equal(budget.total, MAX_ACTORS)
  for (let index = 0; index < 3; index += 1) {
    assert.equal(budget.reserve('campaign', 1), true, `finale spawn ${index}`)
    usage.campaign += 1
    budget.sync(usage)
    assert.ok(budget.total <= MAX_ACTORS)
  }
  assert.equal(usage.squad, CARAVAN_BEAT_SQUAD_CAP, 'the recruit is never what makes room')
  assert.ok(yielded.length > 0 && yielded.every((category) => category === 'ambient' || category === 'chronicle'))
  // Negative control: with nothing below able to give way, a full world refuses even the squad.
  // The 25-actor cap is the budget's to enforce, whatever the press-gang asks for.
  const full = new ActorBudget(() => 0)
  full.sync(usage)
  assert.equal(full.reserve('squad', 1), false)
})

test('destroyed cargo is lost with a market loss, and cannot be chosen afterwards', () => {
  const value = harness('guard')
  assert.equal(invoke<boolean>(value.engine, 'materializeCaravanBeat', value.entry()), true)
  const target = Reflect.get(value.engine, 'eventPropTargets').get(`caravan-beat:${value.plan.id}:cargo`)
  assert.ok(target)
  target.hp = 0
  const market = value.chronicleRegions.get(value.plan.marketRegionId ?? '')
  assert.ok(market)
  const before = market.supply
  invoke(value.engine, 'syncCaravanBeatCombat')
  assert.equal(value.state.phase, 'lost')
  assert.equal(value.state.rewardPaid, false)
  assert.match(value.state.consequence ?? '', /разбили телегу/)
  assert.ok(market.supply < before)
  assert.equal(value.choose('deliver'), false)
  assert.equal(Reflect.get(value.engine, 'gold'), 55)
})

test('cargo loss survives reload with wounded enemies still present and no reopened reward', () => {
  const original = harness('guard')
  invoke(original.engine, 'materializeCaravanBeat', original.entry())
  original.actors[0].hp = 17
  original.actors[1].alive = false
  original.actors[1].hp = 0
  Reflect.get(original.engine, 'eventPropTargets').get(`caravan-beat:${original.plan.id}:cargo`).hp = 0
  invoke(original.engine, 'syncCaravanBeatCombat')
  const saved = invoke<ActiveRunSaveV3>(original.engine, 'saveGeneratedRun')
  const restored = restoreCaravanBeatsState(saved.directorState, original.blueprint, 'guard',
    createCaravanBeatPlans(original.blueprint, 'guard'))
  assert.equal(restored.rejected, false)
  const continued = harness('guard')
  attachCaravanBeats(continued.engine, continued.blueprint, 'guard', restored.state!)
  const state = restored.state!.beats[0]
  invoke(continued.engine, 'updateCaravanBeats', 0)
  assert.equal(state.phase, 'lost')
  assert.equal(state.cargoHealth, 0)
  assert.equal(state.rewardPaid, false)
  assert.equal(continued.actors.length, 3)
  assert.equal(continued.actors.find((entry) =>
    entry.generatedSpawnId === state.combatants[0].id)?.hp, 17)
  assert.equal(continued.actors.some((entry) =>
    entry.generatedSpawnId === state.combatants[1].id), false)
  assert.ok(continued.actors.every((entry) =>
    entry.aiMode === 'normal' && entry.eventPropTargetId === null))
  assert.equal(Reflect.get(continued.engine, 'eventPropTargets').size, 0)
  invoke(continued.engine, 'updateCaravanBeats', 0)
  assert.equal(continued.actors.length, 3, 'a second frame must not duplicate survivors')
  assert.equal(invoke<boolean>(continued.engine, 'chooseCaravanBeat', continued.plan.id, 'deliver'), false)
  assert.equal(Reflect.get(continued.engine, 'gold'), 55)
})

test('a surviving caravan protector also rematerializes after securing or resolving cargo', () => {
  for (const phase of ['secured', 'delivering', 'resolved'] as const) {
    const value = harness('guard')
    readyCombatants(value.state, true)
    const protector = value.state.combatants.find((entry) => !entry.enemy)
    assert.ok(protector)
    protector.health = 23
    value.state.phase = phase
    value.state.outcome = phase === 'secured' ? null : 'deliver'
    value.state.rewardPaid = phase === 'resolved'
    invoke(value.engine, 'updateCaravanBeats', 0)
    assert.equal(value.actors.length, 1)
    assert.equal(value.actors[0].hp, 23)
    assert.equal(value.actors[0].aiMode, 'normal')
    assert.equal(Reflect.get(value.engine, 'generatedSupplyCount'), 0)
    assert.equal(Reflect.get(value.engine, 'gold'), 55)
  }
})

test('a walk the cart cannot finish completes after the stall, and only beside the player', () => {
  const value = harness('elf')
  value.secure()
  assert.equal(value.choose('give'), true)
  // A collider the lane test did not see: the cart cannot move at all.
  Reflect.set(value.engine, 'moveCharacter', () => true)
  for (let step = 0; step < 4 * CARAVAN_BEAT_DELIVERY_STALL_SECONDS && value.state.phase === 'delivering'; step += 1) {
    value.player.position.copy(value.cart.position)
    invoke(value.engine, 'updateCaravanBeatDelivery', value.entry(), 0.25)
  }
  assert.equal(value.state.phase, 'resolved')
  assert.equal(value.state.progress, 1)
  assert.deepEqual([value.state.cargoX, value.state.cargoZ], [value.plan.deliveryEnd.x, value.plan.deliveryEnd.z])
  assert.equal(Reflect.get(value.engine, 'generatedSupplyCount'), 2, 'the player stood by it the whole time')
  // Negative control: a stuck cart nobody stands beside never finishes on its own.
  const alone = harness('elf')
  alone.secure()
  alone.choose('give')
  Reflect.set(alone.engine, 'moveCharacter', () => true)
  alone.player.position.x += CARAVAN_BEAT_DELIVERY_ESCORT_RADIUS + 2
  for (let step = 0; step < 100; step += 1) {
    invoke(alone.engine, 'updateCaravanBeatDelivery', alone.entry(), 0.25)
  }
  assert.equal(alone.state.phase, 'delivering')
})

test('walking away settles an engaged cart: the robbery escapes, the escort goes on alone, the walk ends unpaid', () => {
  const far = (value: ReturnType<typeof harness>) => {
    value.player.position.set(
      value.cart.position.x + CARAVAN_BEAT_ABANDON_RANGE + 5, 0, value.cart.position.z)
  }
  const run = (value: ReturnType<typeof harness>, seconds: number) => {
    for (let step = 0; step < seconds; step += 1) invoke(value.engine, 'updateCaravanBeats', 1)
  }
  const robbery = harness('elf')
  assert.equal(invoke<boolean>(robbery.engine, 'materializeCaravanBeat', robbery.entry()), true)
  far(robbery)
  run(robbery, CARAVAN_BEAT_ABANDON_SECONDS - 1)
  assert.equal(robbery.state.phase, 'fighting')
  assert.equal(robbery.state.abandonRemaining, 1)
  const saved = invoke<ActiveRunSaveV3>(robbery.engine, 'saveGeneratedRun')
  const reloaded = restoreCaravanBeatsState(saved.directorState, robbery.blueprint, 'elf',
    createCaravanBeatPlans(robbery.blueprint, 'elf'))
  assert.equal(reloaded.state?.beats[0].abandonRemaining, 1, 'a continue does not refill the clock')
  const market = robbery.chronicleRegions.get(robbery.plan.marketRegionId ?? '')
  assert.ok(market)
  const before = market.supply
  run(robbery, 1)
  assert.equal(robbery.state.phase, 'escaped')
  assert.equal(robbery.actors.filter((entry) => entry.alive).length, 0, 'the escort left with the cart')
  assert.equal(robbery.runtime.cart.visible, false)
  assert.ok(market.supply > before, 'the cart reached the market')
  assert.equal(robbery.tally.robbed, 0)
  run(robbery, 5)
  assert.equal(robbery.actors.length, 0, 'an escaped escort never comes back')

  const escort = harness('guard')
  escort.secure()
  far(escort)
  run(escort, CARAVAN_BEAT_ABANDON_SECONDS)
  assert.equal(escort.state.phase, 'resolved')
  assert.equal(escort.state.outcome, 'release')
  assert.equal(Reflect.get(escort.engine, 'gold'), 55)

  const walk = harness('guard')
  walk.secure()
  walk.choose('deliver')
  far(walk)
  run(walk, CARAVAN_BEAT_ABANDON_SECONDS)
  assert.equal(walk.state.phase, 'resolved')
  assert.equal(walk.state.outcome, 'deliver')
  assert.equal(walk.state.progress, 1)
  assert.equal(Reflect.get(walk.engine, 'gold'), 55, 'the commander pays the guide, not the cart')
  assert.equal(Reflect.get(walk.engine, 'generatedSupplyCount'), 0)
  assert.match(walk.state.consequence ?? '', /без проводника/)

  const looted = harness('elf')
  looted.secure()
  far(looted)
  run(looted, CARAVAN_BEAT_ABANDON_SECONDS)
  assert.equal(looted.state.phase, 'lost')
  assert.match(looted.state.consequence ?? '', /Брошенный груз растащили/)

  // An escort that was all down when the clock ran out was not escaping anywhere.
  const downed = harness('elf')
  readyCombatants(downed.state, true)
  downed.state.phase = 'fighting'
  invoke(downed.engine, 'settleAbandonedCaravanBeat', downed.entry(), 'escaped')
  assert.equal(downed.state.phase, 'lost')
  // Negative control: with an escort still standing, the same call lets the cart escape.
  const standing = harness('elf')
  readyCombatants(standing.state)
  standing.state.phase = 'fighting'
  invoke(standing.engine, 'settleAbandonedCaravanBeat', standing.entry(), 'escaped')
  assert.equal(standing.state.phase, 'escaped')
})

test('W3-6: how a cart ended without the player is a line the notice queue never drops, even in a dense narrow burst', () => {
  interface Sent { at?: number; message: string; tone: NoticeTone | undefined; origin: NoticeOrigin | undefined }
  const walkAway = (value: ReturnType<typeof harness>, phase: string): Sent => {
    const sent: Sent[] = []
    Reflect.set(value.engine, 'callbacks', {
      onNotice: (message: string, tone?: NoticeTone, origin?: NoticeOrigin) => sent.push({ message, tone, origin }),
      onSaveRequest() {},
    })
    value.player.position.set(value.cart.position.x + CARAVAN_BEAT_ABANDON_RANGE + 5, 0, value.cart.position.z)
    for (let step = 0; step < CARAVAN_BEAT_ABANDON_SECONDS; step += 1) invoke(value.engine, 'updateCaravanBeats', 1)
    assert.equal(value.state.phase, phase)
    assert.deepEqual(sent.map((entry) => entry.message), [value.state.consequence], 'one line per ending')
    return sent[0]
  }
  const released = harness('guard')
  released.secure()
  const delivered = harness('guard')
  delivered.secure()
  assert.equal(delivered.choose('deliver'), true)
  const given = harness('elf')
  given.secure()
  assert.equal(given.choose('give'), true)
  const escaped = harness('elf')
  assert.equal(invoke<boolean>(escaped.engine, 'materializeCaravanBeat', escaped.entry()), true)
  const abandoned = harness('elf')
  abandoned.secure()
  const endings = {
    released: walkAway(released, 'resolved'),
    delivered: walkAway(delivered, 'resolved'),
    given: walkAway(given, 'resolved'),
    escaped: walkAway(escaped, 'escaped'),
    abandoned: walkAway(abandoned, 'lost'),
  }
  // Every ending moves the finale gate's count, so every one says so in a kept line, in the
  // tone of what happened: a delivery or a release succeeded, an escape is a warning, a loss
  // is danger. The three unattended walks used to be plain info.
  for (const [name, line] of Object.entries(endings)) assert.equal(line.origin, 'outcome', name)
  assert.deepEqual(Object.values(endings).map((line) => line.tone),
    ['success', 'success', 'success', 'warning', 'danger'])
  assert.match(endings.released.message, /своим ходом без тебя/)
  assert.match(endings.delivered.message, /без проводника/)
  assert.match(endings.given.message, /забрали телегу сами/)

  // A dense burst on a phone: three dangers hold the one place for news, the five endings and
  // a flavour line arrive behind them, and a dozen warnings overflow the line.
  const flavour = 'У кого-то сдали нервы: бежит и не оборачивается.'
  const burst = (lines: readonly Sent[]): Sent[] => [
    ...[1, 2, 3].map((index): Sent => ({ at: 0, message: `Ранение ${String(index)}.`, tone: 'danger', origin: undefined })),
    ...lines.map((line, index): Sent => ({ ...line, at: 100 + index * 50 })),
    { at: 400, message: flavour, tone: 'info', origin: undefined },
    ...Array.from({ length: NOTICE_MAX_WAITING }, (_, index): Sent =>
      ({ at: 500 + index * 50, message: `По квадрату A${String(index + 1)} ходит ватага.`, tone: 'warning', origin: undefined })),
  ]
  const play = (arrivals: readonly Sent[]) => {
    let queue = createNoticeQueue()
    let due: number | null = null
    let index = 0
    const shown = new Set<string>()
    for (;;) {
      const arrival = arrivals[index]
      const now = Math.min(arrival?.at ?? Infinity, due ?? Infinity)
      if (!Number.isFinite(now)) break
      if (arrival && arrival.at === now) {
        queue = pushNotice(queue, { message: arrival.message, tone: arrival.tone ?? 'info', origin: arrival.origin },
          now, NARROW_NOTICE_LIMITS)
        index += 1
      } else {
        queue = advanceNotices(queue, now, NARROW_NOTICE_LIMITS)
      }
      due = nextNoticeDeadline(queue, NARROW_NOTICE_LIMITS, now)
      for (const notice of queue.shown) shown.add(notice.message)
    }
    return { shown, queue }
  }
  const lines = Object.values(endings)
  const dense = play(burst(lines))
  for (const line of lines) assert.ok(dense.shown.has(line.message), `dropped: ${line.message}`)
  assert.equal(dense.queue.waiting.length, 0)
  // Control: the flavour line in the same burst is dropped, and so is the unattended delivery
  // when it is sent the way it used to be, as plain untagged info.
  assert.equal(dense.shown.has(flavour), false, 'the flavour line survived the burst')
  assert.ok(dense.queue.stats.dropped > 1)
  const untagged = lines.map((line): Sent => line === endings.delivered
    ? { message: line.message, tone: 'info', origin: undefined } : line)
  assert.equal(play(burst(untagged)).shown.has(endings.delivered.message), false)
})

test('a secured cart left standing can be loaded by a passer-by, but never by the squad', () => {
  const value = harness('elf')
  value.secure()
  value.player.position.x += 30
  const raider = actor('passer-by', 'villain', 'soldier')
  raider.mesh.position.copy(value.cart.position)
  value.actors.push(raider)
  for (let step = 0; step < 5 * 30 && value.state.phase === 'secured'; step += 1) {
    Reflect.set(value.engine, 'elapsed', (Reflect.get(value.engine, 'elapsed') as number) + 1 / 30)
    invoke(value.engine, 'updateCaravanBeats', 1 / 30)
  }
  assert.equal(value.state.phase, 'lost')
  assert.match(value.state.consequence ?? '', /растащили без тебя/)
  assert.equal(value.choose('take'), false)

  // Negative control: the elf's own companions stand at the cart all day and take nothing.
  const kept = harness('elf')
  kept.secure()
  kept.player.position.x += 30
  const friend = squadMember('elf', 0)
  friend.mesh.position.copy(kept.cart.position)
  kept.actors.push(friend)
  for (let step = 0; step < 20 * 30; step += 1) {
    Reflect.set(kept.engine, 'elapsed', (Reflect.get(kept.engine, 'elapsed') as number) + 1 / 30)
    invoke(kept.engine, 'updateCaravanBeats', 1 / 30)
  }
  assert.equal(kept.state.phase, 'secured')
})

test('a whole beat draws nothing from the gameplay streams', () => {
  const value = harness('villain')
  const streams = () => invoke<ActiveRunSaveV3>(value.engine, 'saveGeneratedRun').rngStates
  const before = streams()
  invoke(value.engine, 'materializeCaravanBeat', value.entry())
  for (const live of value.actors) {
    live.alive = false
    live.hp = 0
  }
  invoke(value.engine, 'syncCaravanBeatCombat')
  value.player.position.copy(value.cart.position)
  assert.equal(value.choose('burn'), true)
  invoke(value.engine, 'updateCaravanBeats', 1)
  assert.deepEqual(streams(), before)
  // Negative control: one draw from the event stream is visible in the same comparison.
  ;(Reflect.get(value.engine, 'generatedRngStreams') as { event: RandomStream }).event.next()
  assert.notDeepEqual(streams(), before)
})

test('no random event is rolled on a caravan, and a running one is stood down when the cart is reached', () => {
  const value = harness('elf')
  const holds = () => invoke<boolean>(value.engine, 'caravanBeatHoldsRandomEvents')
  value.player.position.set(value.cart.position.x + 100, 0, value.cart.position.z)
  assert.equal(holds(), true, 'an unstarted cart 100 m ahead holds the director')
  value.player.position.set(value.cart.position.x + 130, 0, value.cart.position.z)
  assert.equal(holds(), false)
  value.state.phase = 'fighting'
  assert.equal(holds(), true, 'a cart being fought holds it wherever the player is')
  value.state.phase = 'resolved'
  assert.equal(holds(), false, 'a settled cart does not')

  const stood = harness('elf')
  const event = {
    id: 'random-bounty', kind: 'bounty', anchor: 'player', state: 'active', title: 'Награда за голову',
    regionId: null, situationId: null, markerPos: new THREE.Vector3(1_000, 0, 1_000),
    ownedActorIds: [], cleanup() { this.cleaned = true }, cleaned: false,
  }
  ;(Reflect.get(stood.engine, 'activeEvents') as unknown[]).push(event)
  assert.equal(invoke<boolean>(stood.engine, 'materializeCaravanBeat', stood.entry()), true)
  assert.equal((Reflect.get(stood.engine, 'activeEvents') as unknown[]).length, 0)
  assert.equal(event.cleaned, true)
  // Negative control: an event the player is in the middle of is finished on its own terms.
  const engaged = harness('elf')
  const fight = { ...event, cleaned: false, playerInteracted: true, markerPos: engaged.cart.position.clone() }
  ;(Reflect.get(engaged.engine, 'activeEvents') as unknown[]).push(fight)
  invoke(engaged.engine, 'materializeCaravanBeat', engaged.entry())
  assert.equal((Reflect.get(engaged.engine, 'activeEvents') as unknown[]).length, 1)
  assert.equal(fight.cleaned, false)
})

test('production save captures mid-fight wounds and mid-walk position without changing campaign state', () => {
  const fight = harness('guard')
  readyCombatants(fight.state)
  fight.state.phase = 'fighting'
  fight.state.combatants[0].health = 19
  fight.state.cargoHealth = 57
  Reflect.get(fight.engine, 'eventPropTargets').set(`caravan-beat:${fight.plan.id}:cargo`, {
    id: `caravan-beat:${fight.plan.id}:cargo`,
    ownerId: `caravan-beat:${fight.plan.id}`,
    object: fight.cart,
    hp: 57,
    maxHp: 100,
    position: fight.cart.position,
    attackRange: 4,
  })
  const objectivesBefore = JSON.stringify(Reflect.get(fight.engine, 'objectives'))
  const fightSave = invoke<ActiveRunSaveV3>(fight.engine, 'saveGeneratedRun')
  const parsedFight = normalizeActiveRunSaveV3(JSON.parse(JSON.stringify(fightSave)))
  assert.ok(parsedFight)
  const fightState = restoreCaravanBeatsState(parsedFight.directorState, fight.blueprint, 'guard',
    createCaravanBeatPlans(fight.blueprint, 'guard'))
  assert.equal(fightState.rejected, false)
  assert.equal(fightState.state?.beats[0].combatants[0].health, 19)
  assert.equal(fightState.state?.beats[0].cargoHealth, 57)
  assert.equal(JSON.stringify(Reflect.get(fight.engine, 'objectives')), objectivesBefore)

  const delivery = harness('elf')
  assert.equal(invoke<boolean>(delivery.engine, 'trackCaravanBeat', delivery.plan.id), true)
  readyCombatants(delivery.state, true)
  delivery.state.phase = 'delivering'
  delivery.state.outcome = 'give'
  const point = interpolate(delivery.plan, 0.47)
  delivery.cart.position.set(point.x, 0, point.z)
  delivery.state.cargoX = point.x
  delivery.state.cargoZ = point.z
  delivery.state.progress = caravanBeatDeliveryProgress(delivery.plan, point)
  const deliverySave = invoke<ActiveRunSaveV3>(delivery.engine, 'saveGeneratedRun')
  const parsedDelivery = normalizeActiveRunSaveV3(JSON.parse(JSON.stringify(deliverySave)))
  assert.ok(parsedDelivery)
  const deliveryState = restoreCaravanBeatsState(parsedDelivery.directorState, delivery.blueprint, 'elf',
    createCaravanBeatPlans(delivery.blueprint, 'elf'))
  assert.equal(deliveryState.rejected, false)
  assert.equal(deliveryState.state?.beats[0].phase, 'delivering')
  assert.equal(deliveryState.state?.beats[0].progress, delivery.state.progress)
  assert.equal(deliveryState.state?.beats[0].rewardPaid, false)
  const restoredView = buildInitialGameView({
    blueprint: delivery.blueprint, config: parsedDelivery.config, restored: parsedDelivery,
  })
  assert.equal(restoredView.expedition.mode, 'campaign')
  assert.notEqual(restoredView.expedition.target?.kind, 'caravanBeat')
  assert.equal(restoredView.expedition.notice, null)
  assert.equal(restoredView.caravanBeats.beats[0].phase, 'delivering')
})

test('initial, restored, migrated and legacy launch views expose the same beats', () => {
  const value = harness('elf')
  const config = Reflect.get(value.engine, 'generatedRun').config
  const fresh = buildInitialGameView({ blueprint: value.blueprint, config })
  assert.equal(fresh.caravanBeats.beats[0]?.phase, 'approach')
  assert.equal(fresh.caravanBeats.beats[0]?.active, false)
  assert.equal(fresh.caravanBeats.active, null)
  assert.equal(fresh.markers.some((marker) => marker.id.startsWith('caravan-beat:')), false)
  // PR B — a fresh run is a spine run: the camp's offers are charted, and the crossing waits
  // for the camp's choice before the atlas charts it.
  const offerIds = fresh.caravanBeats.beats.filter((beat) => beat.slot === 'offer').map((beat) => beat.id)
  assert.ok(offerIds.length > 0)
  for (const id of offerIds) {
    assert.ok(fresh.expedition.targets.some((target) => target.kind === 'caravanBeat' && target.id === id))
  }
  assert.equal(fresh.expedition.targets.some((target) =>
    target.kind === 'caravanBeat' && target.id === value.plan.id), false)
  assert.equal(fresh.caravanBeats.beats.find((beat) => beat.id === value.plan.id)?.dormant, true)

  readyCombatants(value.state)
  value.state.phase = 'fighting'
  value.state.combatants[1].health = 23
  value.state.cargoHealth = 71
  assert.equal(invoke<boolean>(value.engine, 'trackCaravanBeat', value.plan.id), true)
  const saved = invoke<ActiveRunSaveV3>(value.engine, 'saveGeneratedRun')
  const restored = buildInitialGameView({ blueprint: value.blueprint, config, restored: saved })
  assert.equal(restored.caravanBeats.active?.phase, 'fighting')
  assert.equal(restored.caravanBeats.active?.cargoHealth, 71)
  assert.equal(restored.caravanBeats.active?.remainingEnemies, 3)
  assert.equal(restored.expedition.target?.kind, 'caravanBeat')
  assert.ok(restored.markers.some((marker) => marker.id === `caravan-beat:${value.plan.id}`))
  assert.ok(
    restored.expedition.route?.status === 'road' ||
    restored.expedition.route?.status === 'arrived',
  )

  // A save written before this change carries the old block and tracks the old kind.
  const migrated = structuredClone(saved)
  delete migrated.directorState.caravanBeats
  const bridge = createBridgeAmbushPlan(value.blueprint, 'elf')
  assert.ok(bridge)
  const legacyState = createBridgeAmbushState(value.blueprint, 'elf', bridge)
  for (const entry of legacyState.combatants) {
    entry.maxHealth = 60
    entry.health = 60
  }
  legacyState.phase = 'fighting'
  legacyState.combatants[1].health = 23
  legacyState.cargoHealth = 71
  migrated.directorState.bridgeAmbush = serializeBridgeAmbushState(legacyState)
  migrated.directorState.expedition = {
    version: 1, mode: 'selected', preference: 'shortest', target: { kind: 'bridgeAmbush', id: bridge.id },
  }
  const migratedView = buildInitialGameView({ blueprint: value.blueprint, config, restored: migrated })
  assert.deepEqual(
    { ...migratedView.caravanBeats, beats: migratedView.caravanBeats.beats.map((beat) => ({ ...beat })) },
    { ...restored.caravanBeats, beats: restored.caravanBeats.beats.map((beat) => ({ ...beat })) },
  )
  assert.equal(migratedView.expedition.target?.kind, 'caravanBeat')

  const legacy = structuredClone(saved)
  delete legacy.directorState.caravanBeats
  const legacyView = buildInitialGameView({ blueprint: value.blueprint, config, restored: legacy })
  assert.deepEqual(legacyView.caravanBeats, { beats: [], active: null, opening: null, gate: null })
  assert.equal(legacyView.markers.some((marker) => marker.id.startsWith('caravan-beat:')), false)
})

test('beat guidance waits for camp arrival and yields to an explicit atlas route until nearby', () => {
  const blueprint = generateWorld(20_260_909)
  const plan = crossing(blueprint, 'elf')
  const start = getFactionStartPosition2D(blueprint, 'elf')
  assert.ok(start)
  const state = createCaravanBeatState(plan)
  const objectives = createGeneratedObjectives(blueprint, 'elf')
  const root = blueprint.objectives.elf.nodes.find((node) => node.siteId === blueprint.starts.elf)
  assert.ok(root)
  const view = (player: { x: number; z: number }, expedition?: CaravanBeatViewContext['expedition']) =>
    buildCaravanBeatView(viewContext(blueprint, 'elf', player, { objectives, expedition }), plan, state)
  assert.equal(view(start).active, false)
  const rootObjective = objectives.find((objective) => objective.id === root.id)
  assert.ok(rootObjective)
  rootObjective.done = true
  assert.equal(view(start).active, true)
  // Another destination chosen in the atlas puts the distant cart away until the player is near.
  const elsewhere = { mode: 'selected' as const, target: null, route: null, guidance: null }
  assert.equal(view(start, elsewhere).active, false)
  assert.equal(view(plan.cargoStart, elsewhere).active, true)
})

test('the beat HUD follows the selected atlas route after a detour, including unavailable roads', () => {
  const value = harness('guard', 2_863_296_181)
  const planner = new ExpeditionPlanner(value.blueprint)
  const objectives = createGeneratedObjectives(value.blueprint, 'guard')
  const positions = [{ x: -80, z: -80 }, { x: -80, z: 0 }, { x: -80, z: 80 }, { x: 80, z: 160 }]
  let originalRouteDisagreed = 0
  let unavailable = 0
  for (const player of positions) {
    const input: ExpeditionInput = {
      ...invoke<ExpeditionInput>(value.engine, 'buildExpeditionInput'),
      player, heading: 0.4,
    }
    assert.equal(planner.select({ kind: 'caravanBeat', id: value.plan.id }, input), true)
    const expedition = planner.buildView(input)
    const context = viewContext(value.blueprint, 'guard', player, { objectives, heading: input.heading })
    const hud = buildCaravanBeatView({ ...context, expedition }, value.plan, value.state)
    const original = buildCaravanBeatView(context, value.plan, value.state)
    assert.ok(expedition.guidance)
    assert.equal(hud.tracked, true)
    assert.equal(hud.bearing, expedition.guidance.bearing)
    assert.equal(hud.distance, expedition.guidance.distance)
    if (Math.abs(original.bearing - hud.bearing) > 0.1) originalRouteDisagreed += 1
    if (expedition.route?.status === 'unavailable') {
      unavailable += 1
      assert.equal(hud.routeLabel, 'по прямой, не дорога')
    }
  }
  assert.ok(originalRouteDisagreed > 0, 'fixture must expose disagreement, not compare identical paths')
  assert.ok(unavailable > 0, 'exercise explicit no-road guidance')
})

test('the beat HUD preserves the cautious route rather than replacing it with the opening itinerary', () => {
  const value = harness('elf', 1)
  const start = getFactionStartPosition2D(value.blueprint, 'elf')
  assert.ok(start)
  value.player.position.set(start.x, 0, start.z)
  for (const region of value.chronicleRegions.values()) region.control = 'neutral'
  const risk = value.chronicleRegions.get('region-0-1')
  assert.ok(risk)
  risk.control = 'guard'
  Reflect.set(value.engine, 'chronicleContestedRegionIds', new Set(['region-0-1']))
  const input = invoke<ExpeditionInput>(value.engine, 'buildExpeditionInput')
  input.discoveredRegionIds = new Set(value.blueprint.regions.map((region) => region.id))
  const planner = new ExpeditionPlanner(value.blueprint)
  planner.select({ kind: 'caravanBeat', id: value.plan.id }, input)
  planner.setPreference('cautious')
  const expedition = planner.buildView(input)
  assert.ok(expedition.cautious && expedition.shortest)
  assert.ok(expedition.cautious.knownRiskDistance < expedition.shortest.knownRiskDistance)
  const afterFork = { x: -160, z: -160 }
  const rerouted = planner.buildView({ ...input, player: afterFork })
  assert.ok(rerouted.guidance)
  const hud = buildCaravanBeatView(
    viewContext(value.blueprint, 'elf', afterFork, { objectives: input.objectives, expedition: rerouted }),
    value.plan, value.state)
  assert.equal(hud.bearing, rerouted.guidance.bearing)
  assert.equal(hud.distance, rerouted.guidance.distance)
  assert.equal(rerouted.preference, 'cautious')
})

test('a restored beat route agrees with the atlas on its very first frame', () => {
  const value = harness('guard', 2_863_296_181)
  invoke(value.engine, 'trackCaravanBeat', value.plan.id)
  const saved = invoke<ActiveRunSaveV3>(value.engine, 'saveGeneratedRun')
  const regionId = 'region-1-1'
  const bounds = getBlueprintRegionBounds(value.blueprint, regionId)
  assert.ok(bounds)
  saved.currentLocation = {
    regionId, worldPosition: [-80, 0, -80],
    localPosition: [-80 - bounds.minX, 0, -80 - bounds.minZ], heading: 0.25,
  }
  const restored = buildInitialGameView({
    blueprint: value.blueprint, config: saved.config, restored: saved,
  })
  assert.ok(restored.expedition.guidance)
  assert.equal(restored.caravanBeats.beats[0].bearing, restored.expedition.guidance.bearing)
  assert.equal(restored.caravanBeats.beats[0].distance, restored.expedition.guidance.distance)
})

test('an unsettled beat defers overlapping ordinary actors, keeps required and ongoing fights, then restores them', () => {
  const value = harness('guard', 2_863_296_181)
  const plans = Object.values(createGeneratedEncounterPlans(value.blueprint, 'guard'))
  const overlapping = plans.find((plan) =>
    plan.regionId === value.plan.regionId &&
    plan.kind !== 'boss' &&
    plan.spawns.some((spawn) => caravanBeatReservesStagingPoint(
      value.plan,
      value.state,
      { x: spawn.worldX, z: spawn.worldZ },
    )))
  assert.ok(overlapping)
  assert.equal(overlapping.encounterId, 'encounter-region-2-3')
  const blueprintBefore = JSON.stringify(value.blueprint)
  const squad = Array.from({ length: 3 }, (_, index) => {
    const member = actor(`astra-squad:${index}`, 'guard', 'soldier', 'squad')
    member.generatedSpawnId = null
    member.squadEligible = true
    return member
  })
  value.actors.push(...squad)
  const usageBefore = invoke(value.engine, 'actorUsageByCategory')
  Reflect.set(value.engine, 'generatedEncounterPlans',
    new Map([[value.plan.regionId, [overlapping]]]))
  Reflect.set(value.engine, 'generatedActivationSpawns',
    new Map([[value.plan.regionId, new Set<string>()]]))

  invoke(value.engine, 'spawnGeneratedRegionEncounters', value.plan.regionId)
  assert.deepEqual(value.actors, squad)
  assert.deepEqual(invoke(value.engine, 'actorUsageByCategory'), usageBefore)
  assert.equal(Reflect.get(value.engine, 'generatedActivationSpawns')
    .get(value.plan.regionId).size, 0)
  assert.equal(value.regions.getSavedDelta(value.plan.regionId)
    ?.defeatedActorIds.some((id) => overlapping.spawns.some((spawn) => spawn.id === id)) ?? false, false)

  const required = structuredClone(overlapping)
  required.id = `${overlapping.id}:required`
  required.encounterId = required.id
  required.spawns = required.spawns.map((spawn, index) => ({
    ...spawn,
    id: `${required.id}:actor:${index}`,
    encounterId: required.id,
    objective: index === 0,
    objectiveEligible: index === 0,
  }))
  Reflect.set(value.engine, 'generatedEncounterPlans',
    new Map([[value.plan.regionId, [required]]]))
  Reflect.set(value.engine, 'generatedActivationSpawns',
    new Map([[value.plan.regionId, new Set<string>()]]))
  invoke(value.engine, 'spawnGeneratedRegionEncounters', value.plan.regionId)
  assert.equal(value.actors.filter((entry) =>
    entry.generatedEncounterId === required.encounterId).length, required.spawns.length)
  assert.ok(squad.every((member) => value.actors.includes(member)))

  value.actors.splice(3)
  const first = actor(
    overlapping.spawns[0].id,
    overlapping.spawns[0].faction,
    overlapping.spawns[0].role,
  )
  first.generatedRegionId = value.plan.regionId
  first.generatedEncounterId = overlapping.encounterId
  value.actors.push(first)
  Reflect.set(value.engine, 'generatedEncounterPlans',
    new Map([[value.plan.regionId, [overlapping]]]))
  Reflect.set(value.engine, 'generatedActivationSpawns',
    new Map([[value.plan.regionId, new Set([overlapping.spawns[0].id])]]))
  invoke(value.engine, 'spawnGeneratedRegionEncounters', value.plan.regionId)
  assert.equal(value.actors.filter((entry) =>
    entry.generatedEncounterId === overlapping.encounterId).length, overlapping.spawns.length)
  assert.ok(value.actors.includes(first), 'ongoing visible actor was despawned')

  value.actors.splice(3)
  value.state.phase = 'resolved'
  value.state.outcome = 'deliver'
  value.state.rewardPaid = true
  value.state.consequence = 'resolved'
  Reflect.set(value.engine, 'generatedActivationSpawns',
    new Map([[value.plan.regionId, new Set<string>()]]))
  invoke(value.engine, 'spawnGeneratedRegionEncounters', value.plan.regionId)
  assert.equal(value.actors.filter((entry) =>
    entry.generatedEncounterId === overlapping.encounterId).length, overlapping.spawns.length)
  assert.ok(squad.every((member) => value.actors.includes(member)))
  assert.ok(value.actors.length <= MAX_ACTORS)
  assert.equal(JSON.stringify(value.blueprint), blueprintBefore)
})

test('paused planning actions and an explicit beat choice remain available until the run ends', () => {
  const value = harness('elf')
  Reflect.set(value.engine, 'paused', true)
  const root = value.blueprint.objectives.elf.nodes.find(
    (node) => node.siteId === value.blueprint.starts.elf,
  )
  assert.ok(root)
  const rootObjective = Reflect.get(value.engine, 'objectives').find(
    (objective: { id: string }) => objective.id === root.id,
  )
  assert.ok(rootObjective)
  assert.equal(rootObjective.done, false)
  const start = getFactionStartPosition2D(value.blueprint, 'elf')
  assert.ok(start)
  value.player.position.set(start.x, 0, start.z)

  assert.equal(invoke<boolean>(value.engine, 'trackCaravanBeat', value.plan.id), true)
  assert.deepEqual(Reflect.get(value.engine, 'expeditionPlanner').serialize().target, {
    kind: 'caravanBeat',
    id: value.plan.id,
  })
  assert.equal(invoke<boolean>(value.engine, 'trackCaravanBeat', 'no-such-beat'), false)
  assert.equal(Reflect.get(value.engine, 'campaignContracts').pinnedNodeId, null)
  const expedition = Reflect.get(value.engine, 'expeditionPlanner').buildView(
    invoke(value.engine, 'buildExpeditionInput'),
  )
  assert.equal(expedition.route?.status, 'road')
  assert.deepEqual(validateExpeditionRoute(
    Reflect.get(value.engine, 'expeditionPlanner').graph,
    expedition.route,
  ), [])
  const trackedBeforeCamp = buildInitialGameView({
    blueprint: value.blueprint,
    config: Reflect.get(value.engine, 'generatedRun').config,
    restored: invoke<ActiveRunSaveV3>(value.engine, 'saveGeneratedRun'),
  })
  assert.equal(trackedBeforeCamp.objectives.find(
    (objective) => objective.id === root.id)?.done, false)
  assert.equal(trackedBeforeCamp.expedition.target?.kind, 'caravanBeat')
  assert.equal(trackedBeforeCamp.caravanBeats.active?.id, value.plan.id)

  const ready = invoke<Array<{ id: string }>>(value.engine, 'getReadyGeneratedObjectives')
  assert.ok(ready.length > 0)
  invoke(value.engine, 'pinObjective', ready[0].id)
  assert.equal(Reflect.get(value.engine, 'campaignContracts').pinnedNodeId, ready[0].id)

  const commitments = Reflect.get(value.engine, 'chronicleCommitments')
  commitments.rumours.push({ id: 'pause-rumour', kind: 'defend' })
  invoke(value.engine, 'pinRumour', 'pause-rumour')
  assert.equal(commitments.pinnedRumourId, 'pause-rumour')

  const doctrines = createDoctrineRunState(DEFAULT_DOCTRINE_IDS)
  doctrines.anchors = 1
  Reflect.set(value.engine, 'doctrines', doctrines)
  Reflect.set(value.engine, 'doctrineEffects', resolveDoctrineEffects([]))
  const offer = invoke<string[]>(value.engine, 'getDoctrineOfferIds')
  assert.ok(offer.length > 0)
  assert.equal(invoke<boolean>(value.engine, 'chooseDoctrine', offer[0]), true)
  assert.deepEqual(doctrines.equipped, [offer[0]])

  value.secure()
  assert.equal(value.choose('give'), true)
  assert.equal(value.state.phase, 'delivering')
  assert.equal(invoke<boolean>(value.engine, 'trackCaravanBeat', value.plan.id), false,
    'a cart being walked is not a destination')

  const ended = harness('elf')
  ended.secure()
  Reflect.set(ended.engine, 'ended', true)
  invoke(ended.engine, 'pinObjective', ready[0].id)
  invoke(ended.engine, 'pinRumour', 'pause-rumour')
  assert.equal(invoke<boolean>(ended.engine, 'chooseDoctrine', offer[0]), false)
  assert.equal(invoke<boolean>(ended.engine, 'trackCaravanBeat', ended.plan.id), false)
  assert.equal(ended.choose('take'), false)
  assert.equal(ended.state.phase, 'secured')
  assert.equal(Reflect.get(ended.engine, 'gold'), 55)
})

test('E at secured cargo releases pointer lock for HTML choices without awarding an outcome', () => {
  const value = harness('elf')
  value.secure()
  const surface = {}
  Reflect.set(value.engine, 'renderer', { domElement: surface })
  let releases = 0
  Reflect.set(value.engine, 'releaseGameplayInput', () => { releases += 1 })
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const documentStub = {
    pointerLockElement: surface as object | null,
    exitPointerLock() { this.pointerLockElement = null },
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: documentStub,
  })
  try {
    assert.equal(invoke<string>(value.engine, 'getCaravanBeatPrompt'), CARAVAN_BEAT_PROMPTS.releaseCursor)
    assert.match(CARAVAN_BEAT_PROMPTS.releaseCursor, /\[E\].*курсор/i)
    invoke(value.engine, 'interact')
    assert.equal(documentStub.pointerLockElement, null)
    assert.equal(releases, 1)
    assert.equal(value.state.phase, 'secured')
    assert.equal(value.state.outcome, null)
    assert.equal(value.state.rewardPaid, false)
    assert.equal(Reflect.get(value.engine, 'gold'), 55)
    assert.ok(value.notices.some((notice) => notice.includes('Курсор свободен')))
  } finally {
    if (previousDocument) {
      Object.defineProperty(globalThis, 'document', previousDocument)
    } else {
      Reflect.deleteProperty(globalThis, 'document')
    }
  }
})

/** The reviewed run as an engine: the villain at the B3 treasure with only the E2 fortress left. */
function reviewedVillain() {
  const value = harness('villain', 20_261_006)
  const { engine, blueprint, player } = value
  const finalId = blueprint.objectives.villain.finalNodeId
  const objectives: Objective[] = Reflect.get(engine, 'objectives')
  for (const objective of objectives) {
    if (objective.id === 'objective-villain-alt') objective.skipped = true
    else objective.done = objective.id !== finalId
  }
  const treasure = blueprint.objectives.villain.nodes.find((node) => node.id === 'objective-villain-branch')
  const start = treasure ? getSiteWorldPosition2D(blueprint, treasure.siteId) : undefined
  assert.ok(start)
  player.position.set(start.x, 0, start.z)
  // Discovery and region lookup follow the walk from the A5 camp to the B3 treasure.
  const walked = new RegionManager(blueprint, undefined, { discoverVisibleRegions: false })
  for (const id of ['region-0-4', 'region-1-4', 'region-1-3', 'region-1-1', 'region-1-2']) walked.update(id)
  Object.assign(Reflect.get(engine, 'generatedWorld'), {
    regions: walked,
    discoveredRegionIds: walked.getDiscoveredRegionIds(),
    getRegionIdAt: (x: number, z: number) => blueprint.regions.find((region) => {
      const bounds = getBlueprintRegionBounds(blueprint, region.id)
      return bounds !== undefined && x >= bounds.minX && x < bounds.maxX && z >= bounds.minZ && z < bounds.maxZ
    })?.id,
  })
  // As the engine derives it at launch and on every chronicle tick.
  Reflect.set(engine, 'chronicleContestedRegionIds', getContestedRegionIds(blueprint, value.chronicleRegions))
  const planner: ExpeditionPlanner = Reflect.get(engine, 'expeditionPlanner')
  // The same call `emitView` makes for the compass on every frame.
  const live = () => planner.buildView(invoke<ExpeditionInput>(engine, 'buildExpeditionInput'))
  const resume = () => {
    const parsed = normalizeActiveRunSaveV3(JSON.parse(JSON.stringify(
      invoke<ActiveRunSaveV3>(engine, 'saveGeneratedRun'))))
    assert.ok(parsed)
    return { parsed, view: buildInitialGameView({ blueprint, config: parsed.config, restored: parsed }) }
  }
  return { ...value, finalId, objectives, start, planner, live, resume }
}

test('the engine compass takes the reviewed villain over the C2 bridge without an atlas choice', () => {
  const { engine, blueprint, plan, state, finalId, objectives, start, planner, live, resume } = reviewedVillain()
  const automatic = live()
  assert.equal(automatic.mode, 'campaign')
  assert.equal(automatic.target?.id, finalId)
  assert.ok(automatic.route?.status === 'road' && automatic.target && automatic.guidance?.next)
  assert.deepEqual(validateExpeditionRoute(planner.graph, automatic.route), [])
  assert.deepEqual(automatic.route.bridgeIds, [plan.bridgeId])
  assert.ok(isExpeditionSegmentClear(planner.graph, start, automatic.guidance.next))
  // Negative control: the straight arrow the old default drew runs into the river.
  assert.equal(isExpeditionSegmentClear(planner.graph, start, automatic.target.position), false)

  // The pending cart keeps its own itinerary until tracked, and then follows the atlas.
  const context = viewContext(blueprint, 'villain', start, { objectives })
  assert.deepEqual(
    buildCaravanBeatView({ ...context, expedition: automatic }, plan, state),
    buildCaravanBeatView(context, plan, state),
  )
  assert.equal(invoke<boolean>(engine, 'trackCaravanBeat', plan.id), true)
  const tracked = live()
  assert.equal(tracked.target?.kind, 'caravanBeat')
  const trackedHud = buildCaravanBeatView({ ...context, expedition: tracked }, plan, state)
  assert.equal(trackedHud.bearing, tracked.guidance?.bearing)
  assert.equal(trackedHud.distance, tracked.guidance?.distance)

  // «Убрать маршрут» returns to the fortress road rather than to a bare bearing.
  invoke(engine, 'setExpeditionTarget', null)
  const cleared = live()
  assert.equal(cleared.mode, 'campaign')
  assert.deepEqual(cleared.route, automatic.route)

  // Save and continue: the restored first frame draws the same road, default and explicit alike.
  const resumed = resume()
  assert.deepEqual(resumed.parsed.directorState.expedition,
    { version: 1, mode: 'campaign', preference: 'shortest', target: null })
  assert.deepEqual(resumed.view.expedition, live())
  invoke(engine, 'setExpeditionTarget', { kind: 'objective', id: finalId })
  const explicit = resume()
  assert.equal(explicit.view.expedition.mode, 'selected')
  assert.deepEqual({ ...explicit.view.expedition, mode: 'campaign' }, resumed.view.expedition)
})

test('a taken rumour leads the engine compass, survives save and continue, then hands back', () => {
  const { engine, finalId, planner, live, resume } = reviewedVillain()
  const rumour = {
    id: 'rumour:defend:engine', kind: 'defend' as const, regionId: 'region-0-2', targetRegionId: 'region-0-2',
    sourceRegionId: null, siteId: null, caravanId: null, faction: null, raisedTick: 0, deadlineTick: 8,
    progress: 0, actioned: false,
  }
  Reflect.get(engine, 'chronicleCommitments').rumours.push(rumour)
  assert.equal(live().target?.id, finalId, 'an offer alone does not move the compass')
  assert.equal(resume().view.caravanBeats.active?.active, true,
    'with only the fortress left the bridge card leads')

  invoke(engine, 'pinRumour', rumour.id)
  const taken = live()
  assert.equal(taken.mode, 'campaign')
  assert.equal(taken.target?.kind, 'rumour')
  assert.equal(taken.target?.id, rumour.id)
  assert.ok(taken.route?.status === 'road' || taken.route?.status === 'direct')
  assert.deepEqual(validateExpeditionRoute(planner.graph, taken.route), [])

  // Mid-rumour save: the first restored frame leads to the rumour too, and the distant
  // bridge card stands aside for it exactly as it does for a pinned contract.
  const midRumour = resume()
  assert.equal(Reflect.get(Object(midRumour.parsed.directorState.chronicleCommitments), 'pinnedRumourId'), rumour.id)
  assert.deepEqual(midRumour.view.expedition, taken)
  assert.equal(midRumour.view.caravanBeats.active, null)

  // Dropping it, or running out its clock, hands the compass back to the fortress.
  invoke(engine, 'pinRumour', null)
  assert.equal(live().target?.id, finalId)
  invoke(engine, 'pinRumour', rumour.id)
  assert.equal(live().target?.id, rumour.id)
  Reflect.get(engine, 'chronicleState').tick = rumour.deadlineTick
  const expired = live()
  assert.equal(expired.target?.id, finalId)
  assert.equal(expired.notice, null)
  assert.equal(resume().view.expedition.target?.id, finalId)
})

test('streaming and actor eviction preserve living enemy health and never count absence as defeat', () => {
  const value = harness('elf')
  readyCombatants(value.state)
  value.state.phase = 'fighting'
  for (const combatant of value.state.combatants) {
    const live = actor(combatant.id, combatant.allegiance, combatant.role)
    live.generatedRegionId = value.plan.regionId
    live.generatedEncounterId = value.plan.id
    live.generatedUnique = true
    live.eventOwnerId = `caravan-beat:${value.plan.id}`
    value.actors.push(live)
  }
  value.actors[0].hp = 31
  const far = value.blueprint.regions.find((region) => region.id !== value.plan.regionId)
  assert.ok(far)
  value.regions.update(far.id)
  invoke(value.engine, 'syncGeneratedRegions')
  assert.equal(value.actors.length, 0)
  assert.equal(value.state.combatants[0].health, 31)
  assert.equal(value.state.combatants[0].defeated, false)
  assert.equal(caravanBeatRemainingEnemies(value.state), 3)

  value.regions.update(value.plan.regionId)
  invoke(value.engine, 'syncGeneratedRegions')
  invoke(value.engine, 'materializeCaravanBeat', value.entry())
  assert.equal(value.actors.length, 3)
  assert.equal(value.actors.find(
    (entry) => entry.generatedSpawnId === value.state.combatants[0].id)?.hp, 31)
  assert.equal(caravanBeatRemainingEnemies(value.state), 3)

  const defeated = value.actors[0]
  defeated.alive = false
  defeated.hp = 0
  invoke(value.engine, 'removeActorById', defeated.id)
  invoke(value.engine, 'materializeCaravanBeat', value.entry())
  assert.equal(value.actors.some((entry) => entry.generatedSpawnId === defeated.generatedSpawnId), false)
  assert.equal(caravanBeatRemainingEnemies(value.state), 2)
})

test('beat materialization respects the 25-actor cap and preserves squad slots', () => {
  const value = harness('elf')
  for (let index = 0; index < MAX_ACTORS; index += 1) {
    const category = index < 3 ? 'squad' : index < 11 ? 'campaign' : index < 19 ? 'chronicle' : 'ambient'
    const occupant = actor(`occupant:${index}`, index < 3 ? 'elf' : 'guard', 'soldier', category)
    occupant.generatedSpawnId = null
    occupant.squadEligible = index < 3
    value.actors.push(occupant)
  }
  assert.equal(invoke<boolean>(value.engine, 'materializeCaravanBeat', value.entry()), true)
  assert.equal(value.actors.length, MAX_ACTORS)
  assert.equal(value.actors.filter((entry) => entry.budgetCategory === 'squad').length, 3)
  assert.equal(value.actors.filter((entry) =>
    value.state.combatants.some((combatant) => combatant.id === entry.generatedSpawnId)).length, 3)
  assert.equal(value.state.phase, 'fighting')
})

test('ordinary caravan robbery requires escorts down and guard aid is earned, bounded, and cooled down', () => {
  function ordinary(faction: Faction) {
    const player = new THREE.Group()
    const caravan = new THREE.Group()
    const escort = actor('ordinary-escort', 'guard', 'soldier', 'ambient')
    const notices: string[] = []
    let ambushes = 0
    const engine: object = Object.assign(Object.create(GameEngine.prototype), {
      faction,
      player,
      caravan,
      actors: [escort],
      caravanEscortIds: [escort.id],
      activeEvents: [],
      paused: false,
      ended: false,
      caravanCooldown: 0,
      caravanDefenseCredit: false,
      caravanAidCooldown: 0,
      caravanRobbedFlash: 0,
      gold: 0,
      health: 50,
      maxHealth: 100,
      callbacks: { onNotice: (message: string) => notices.push(message) },
      achievements: { recordGoldEarned() {}, recordCaravanRobbed() {} },
      handleGeneratedInteraction: () => false,
      generatedInteraction: () => ({ site: null, node: null, kind: 'caravan', targetsObjective: false }),
      resumeAudio() {},
      emitView() {},
      playSound() {},
      spawnAmbush: () => { ambushes += 1 },
    })
    return { engine, escort, notices, ambushes: () => ambushes }
  }

  const raider = ordinary('elf')
  assert.match(invoke<string>(raider.engine, 'getGeneratedPrompt'), /охрана/i)
  invoke(raider.engine, 'interact')
  assert.equal(Reflect.get(raider.engine, 'gold'), 0)
  assert.equal(raider.ambushes(), 0)
  raider.escort.alive = false
  assert.match(invoke<string>(raider.engine, 'getGeneratedPrompt'), /\[E\]/)
  invoke(raider.engine, 'interact')
  assert.equal(Reflect.get(raider.engine, 'gold'), 95)
  assert.equal(raider.ambushes(), 1)

  const guard = ordinary('guard')
  invoke(guard.engine, 'interact')
  invoke(guard.engine, 'interact')
  assert.equal(Reflect.get(guard.engine, 'health'), 50)
  Reflect.set(guard.engine, 'caravanDefenseCredit', true)
  assert.match(invoke<string>(guard.engine, 'getGeneratedPrompt'), /перевязку/i)
  invoke(guard.engine, 'interact')
  assert.equal(Reflect.get(guard.engine, 'health'), 58)
  invoke(guard.engine, 'interact')
  assert.equal(Reflect.get(guard.engine, 'health'), 58)
  assert.ok(Reflect.get(guard.engine, 'caravanAidCooldown') > 0)
})

test('the road cart remembers its dead escorts across walking away and a continue', () => {
  function roadCart(saved?: { caravanEscortsDown?: number; caravanEscortRespawnIn?: number }) {
    const player = new THREE.Group()
    const caravan = new THREE.Group()
    const actors: HarnessActor[] = []
    let spawned = 0
    const engine: object = Object.assign(Object.create(GameEngine.prototype), {
      faction: 'elf' as Faction,
      player,
      caravan,
      actors,
      activeEvents: [],
      caravanEscortIds: [] as string[],
      caravanPanicTimer: 0,
      caravanCooldown: 0,
      elapsed: 100,
      ordinaryCaravanLootSite: null,
      finale: createFinaleState(createFinaleIdentity(generateWorld(20_260_909), 'elf')),
      callbacks: { onNotice() {} },
    })
    // As the constructor restores it: an older save has neither field.
    Reflect.set(engine, 'caravanEscortsDown', Math.max(0, Math.min(2, saved?.caravanEscortsDown ?? 0)))
    Reflect.set(engine, 'caravanEscortRespawnAt', 100 + (saved?.caravanEscortRespawnIn ?? 0))
    Reflect.set(engine, 'spawnCaravanEscort', () => {
      const guard = actor(`escort-${spawned}`, 'guard', 'soldier', 'ambient')
      guard.id = `escort-${spawned}`
      spawned += 1
      actors.push(guard)
      ;(Reflect.get(engine, 'caravanEscortIds') as string[]).push(guard.id)
    })
    Reflect.set(engine, 'removeActorById', (id: string) => {
      const index = actors.findIndex((entry) => entry.id === id)
      if (index >= 0) actors.splice(index, 1)
    })
    for (const method of ['announceSighting', 'presentCaravanLooting', 'playSound']) {
      Reflect.set(engine, method, () => {})
    }
    const frame = (seconds = 1 / 30, streaming = true) => {
      Reflect.set(engine, 'elapsed', (Reflect.get(engine, 'elapsed') as number) + seconds)
      return invoke<boolean>(engine, 'updateCaravanEscort', seconds, 'region-test', streaming)
    }
    const living = () => (Reflect.get(engine, 'caravanEscortIds') as string[]).length
    return { engine, actors, frame, living }
  }
  const value = roadCart()
  value.frame()
  value.frame()
  assert.equal(value.living(), 2)
  value.actors[0].alive = false
  value.frame()
  assert.equal(value.living(), 1)
  value.frame()
  assert.equal(value.living(), 1, 'the gap waits for the road office')
  // Walking away and back does not refill it.
  value.frame(1, false)
  assert.equal(value.living(), 0)
  value.frame()
  value.frame()
  assert.equal(value.living(), 1, 'only the guard still standing comes back')
  // The save carries the gap and the remaining time.
  const saved = {
    caravanEscortsDown: Reflect.get(value.engine, 'caravanEscortsDown') as number,
    caravanEscortRespawnIn: (Reflect.get(value.engine, 'caravanEscortRespawnAt') as number) -
      (Reflect.get(value.engine, 'elapsed') as number),
  }
  assert.equal(saved.caravanEscortsDown, 1)
  assert.ok(saved.caravanEscortRespawnIn > 20 && saved.caravanEscortRespawnIn <= 25)
  const continued = roadCart(saved)
  continued.frame()
  continued.frame()
  assert.equal(continued.living(), 1, 'a continue brings back only the guard still standing')
  continued.frame(saved.caravanEscortRespawnIn)
  continued.frame()
  assert.equal(continued.living(), 2, 'the replacement arrives when its time is up')
  // Negative control: a save from before this change brings both back at once, as it always did.
  const legacy = roadCart()
  legacy.frame()
  legacy.frame()
  assert.equal(legacy.living(), 2)
})

// ---------------------------------------------------------------------------
// PR B — the spine on the engine: the camp decided, the road waking, the gate, the seam
// ---------------------------------------------------------------------------

function spineOf(value: ReturnType<typeof harness>) {
  const plans = Reflect.get(value.engine, 'caravanBeatPlans') as CaravanBeatPlan[]
  const beats = Reflect.get(value.engine, 'caravanBeats') as CaravanBeatsState
  const runtime = Reflect.get(value.engine, 'caravanBeatRuntime') as Map<string, {
    cart: THREE.Group
    stagingRefused?: boolean
  }>
  const slot = (kind: CaravanBeatPlan['slot']) => plans.filter((plan) => plan.slot === kind)
  const state = (id: string) => beats.beats.find((entry) => entry.id === id) as CaravanBeatState
  return { plans, beats, runtime, slot, state }
}

/** The player at a cart, its square streamed in as the engine's window would have it. */
function standAt(value: ReturnType<typeof harness>, plan: CaravanBeatPlan): void {
  value.player.position.set(plan.cargoStart.x, 0, plan.cargoStart.z)
  value.regions.update(plan.regionId)
  ;(Reflect.get(value.engine, 'simulatedGeneratedRegions') as Set<string>).add(plan.regionId)
}

/** The fight at a cart won: every enemy the engine staged there is down. */
function winFightAt(value: ReturnType<typeof harness>, beat: CaravanBeatState): void {
  for (const entry of value.actors) {
    if (!beat.combatants.some((combatant) => combatant.enemy && combatant.id === entry.generatedSpawnId)) continue
    entry.alive = false
    entry.hp = 0
  }
  invoke(value.engine, 'syncCaravanBeatCombat')
}

function campDone(value: ReturnType<typeof harness>): boolean {
  const camp = invoke<{ id: string } | null>(value.engine, 'campNode')
  assert.ok(camp)
  return (Reflect.get(value.engine, 'objectives') as Objective[]).some((entry) => entry.id === camp.id && entry.done)
}

test('PR B — the camp is decided by the caravan met, the other goes its way, and the road waits for it', () => {
  const value = harness('elf', 20_260_909, { spine: true })
  const { beats, runtime, slot, state } = spineOf(value)
  const [first, second] = slot('offer')
  const [crossing] = slot('crossing')
  assert.ok(first && second && crossing)

  // The road waits: at the bridge before the camp's choice, nothing stages and no cart stands.
  standAt(value, crossing)
  invoke(value.engine, 'updateCaravanBeats', 0.5)
  assert.equal(state(crossing.id).phase, 'approach')
  assert.equal(runtime.get(crossing.id)?.cart.visible, false)
  assert.equal(value.actors.length, 0)
  invoke(value.engine, 'settleCaravanOpening')
  assert.equal(campDone(value), false)

  // Walking up to the second offer is choosing it: it stages and the first goes its own way.
  standAt(value, second)
  invoke(value.engine, 'updateCaravanBeats', 0.5)
  assert.equal(state(second.id).phase, 'fighting')
  assert.equal(state(first.id).phase, 'declined')
  assert.equal(beats.chosenOfferId, second.id)
  assert.ok(value.notices.some((notice) => notice.includes('ушёл своей дорогой')))
  invoke(value.engine, 'settleCaravanOpening')
  assert.equal(campDone(value), false, 'a cart being fought is not a settled one')

  // Won and taken: the camp closes, once, and the road wakes.
  winFightAt(value, state(second.id))
  assert.equal(state(second.id).phase, 'secured')
  value.player.position.set(state(second.id).cargoX, 0, state(second.id).cargoZ)
  assert.equal(invoke<boolean>(value.engine, 'chooseCaravanBeat', second.id, 'take'), true)
  invoke(value.engine, 'settleCaravanOpening')
  invoke(value.engine, 'settleCaravanOpening')
  assert.equal(campDone(value), true)
  assert.equal(value.tally.objectives, 1, 'the camp closes once')
  standAt(value, crossing)
  invoke(value.engine, 'updateCaravanBeats', 0.5)
  assert.equal(state(crossing.id).phase, 'fighting', 'the bridge stages once the camp has chosen')
  // The offer not taken never stages, with the player standing at it.
  standAt(value, first)
  invoke(value.engine, 'updateCaravanBeats', 0.5)
  assert.equal(state(first.id).phase, 'declined')
  assert.equal(runtime.get(first.id)?.cart.visible, false)
})

test('PR B — the finale waits for two caravans, every ending counts, and two met ones are a step', () => {
  const value = harness('villain', 20_260_909, { spine: true })
  const { plans, beats, slot, state } = spineOf(value)
  const graph = value.blueprint.objectives.villain
  const finalNode = graph.nodes.find((node) => node.id === graph.finalNodeId)
  assert.ok(finalNode)
  for (const objective of Reflect.get(value.engine, 'objectives') as Objective[]) {
    if (objective.id !== graph.finalNodeId) objective.done = true
  }
  const ready = () => invoke<{ id: string }[]>(value.engine, 'getReadyGeneratedObjectives').map((node) => node.id)
  const steps = () => invoke<number>(value.engine, 'campaignProgressSteps')
  const before = steps()
  assert.equal(invoke<boolean>(value.engine, 'generatedPrerequisitesDone', finalNode), false)
  assert.equal(ready().includes(finalNode.id), false)
  assert.equal(invoke(value.engine, 'getActiveGeneratedObjective'), null)

  // The finale's own square fields nobody while the gate is shut.
  const identity = value.finale.identity
  const finalPlan = Object.values(createGeneratedEncounterPlans(value.blueprint, 'villain'))
    .find((plan) => plan.encounterId === identity.encounterId)
  assert.ok(finalPlan)
  Reflect.set(value.engine, 'generatedEncounterPlans', new Map([[identity.regionId, [finalPlan]]]))
  const field = () => {
    Reflect.set(value.engine, 'generatedActivationSpawns', new Map([[identity.regionId, new Set<string>()]]))
    invoke(value.engine, 'spawnGeneratedRegionEncounters', identity.regionId)
    return value.actors.filter((entry) => entry.generatedEncounterId === identity.encounterId).length
  }
  assert.equal(field(), 0)

  const [first] = slot('offer')
  const [crossing] = slot('crossing')
  state(first.id).phase = 'fighting'
  declineOtherCaravanOffers(plans, beats, first.id)
  state(first.id).phase = 'unavailable'
  assert.equal(steps(), before, 'an unstageable cart is nobody\'s step')
  assert.deepEqual(caravanSpineGate(beats), { open: false, settled: 1, required: 2 })
  assert.equal(ready().includes(finalNode.id), false)
  state(crossing.id).phase = 'lost'
  assert.equal(steps(), before, 'one met cart is half a step')
  assert.equal(caravanSpineGate(beats).open, true, 'every ending counts for the gate')
  assert.equal(invoke<boolean>(value.engine, 'generatedPrerequisitesDone', finalNode), true)
  assert.ok(ready().includes(finalNode.id))
  assert.ok(field() > 0, 'the finale fields its garrison once the gate opens')
  // Had the camp's cart been met (it escaped), the two met carts would pay one step.
  state(first.id).phase = 'escaped'
  assert.equal(steps(), before + 1, 'two met carts, lost and escaped, pay one step')

  // Control: the same campaign without a spine has its finale ready at once.
  const legacy = harness('villain')
  for (const objective of Reflect.get(legacy.engine, 'objectives') as Objective[]) {
    if (objective.id !== graph.finalNodeId) objective.done = true
  }
  assert.ok(invoke<{ id: string }[]>(legacy.engine, 'getReadyGeneratedObjectives')
    .some((node) => node.id === finalNode.id))
  assert.equal(caravanSpineGate(Reflect.get(legacy.engine, 'caravanBeats')).open, true)
})

test('PR B — a crowded road holds a caravan honestly, the wait survives a continue, and then it goes through', () => {
  const value = harness('guard', 20_260_909, { spine: true })
  const { plans, runtime, slot, state } = spineOf(value)
  const [first, second] = slot('offer')
  standAt(value, first)
  // A world full of bodies that cannot give way to a cart: the squad and the campaign's own.
  for (let index = 0; index < MAX_ACTORS; index += 1) {
    const filler = actor(`filler-${index}`, 'guard', 'soldier', index < 3 ? 'squad' : 'campaign')
    filler.mesh.position.set(first.cargoStart.x + 200, 0, first.cargoStart.z)
    value.actors.push(filler)
  }
  const step = (seconds: number) => {
    Reflect.set(value.engine, 'elapsed', Reflect.get(value.engine, 'elapsed') + seconds)
    invoke(value.engine, 'updateCaravanBeats', seconds)
  }
  step(0.5)
  assert.equal(state(first.id).phase, 'approach')
  assert.equal(runtime.get(first.id)?.stagingRefused, true)
  assert.ok(value.notices.some((notice) => notice.includes('слишком людно')))
  for (let index = 0; index < 20; index += 1) step(0.5)
  assert.ok(Math.abs(state(first.id).stagingStalled - 10) < 0.01, `stalled ${state(first.id).stagingStalled}`)
  const view = invoke<CaravanBeatsView>(value.engine, 'buildCaravanBeatsView',
    { mode: 'campaign', target: null, route: null, guidance: null })
  assert.match(view.beats.find((beat) => beat.id === first.id)?.description ?? '', /Корован ждёт ещё 20 с/)

  // The wait is saved: a continue resumes it rather than starting it again.
  const saved = invoke<ActiveRunSaveV3>(value.engine, 'saveGeneratedRun')
  const restored = restoreCaravanSpine(saved.directorState, value.blueprint, 'guard')
  assert.equal(restored.rejected, false)
  assert.ok(Math.abs((restored.state?.beats.find((beat) => beat.id === first.id)?.stagingStalled ?? 0) - 10) < 0.01)

  // Twenty more seconds by the cart, and it goes through without its fight: the run moves on.
  // W3-6 — that still counts for the gate, so it says so in a line the queue never drops.
  const sent: [string, NoticeTone | undefined, NoticeOrigin | undefined][] = []
  const callbacks = Reflect.get(value.engine, 'callbacks') as {
    onNotice: (message: string, tone?: NoticeTone, origin?: NoticeOrigin) => void
  }
  Reflect.set(value.engine, 'callbacks', {
    ...callbacks,
    onNotice: (message: string, tone?: NoticeTone, origin?: NoticeOrigin) => {
      sent.push([message, tone, origin])
      callbacks.onNotice(message, tone, origin)
    },
  })
  for (let index = 0; index < 41 && state(first.id).phase === 'approach'; index += 1) step(0.5)
  assert.equal(state(first.id).phase, 'unavailable')
  assert.match(state(first.id).unavailableReason ?? '', /проехал без драки/)
  assert.deepEqual(sent.filter(([message]) => message === state(first.id).unavailableReason),
    [[state(first.id).unavailableReason, 'warning', 'outcome']])
  assert.equal(state(first.id).rewardPaid, false)
  assert.equal(caravanSpineHoldsCamp(plans, Reflect.get(value.engine, 'caravanBeats')), false, 'the camp settles')
  assert.equal(state(second.id).phase, 'approach', 'the other offer is still on its road')
  assert.equal(value.actors.length, MAX_ACTORS)

  // Control: with room, the same cart stages on the first try and its clock never runs.
  const roomy = harness('guard', 20_260_909, { spine: true })
  standAt(roomy, first)
  invoke(roomy.engine, 'updateCaravanBeats', 0.5)
  assert.equal(spineOf(roomy).state(first.id).phase, 'fighting')
  assert.equal(spineOf(roomy).state(first.id).stagingStalled, 0)
})

test('PR B — the staging seam makes way for a cart as W1-1 does, and never for an event the player is in', () => {
  const value = harness('elf', 20_260_909, { spine: true })
  let cleaned = 0
  const event = (marker: THREE.Vector3, interacted: boolean) => ({
    id: `random-${String(cleaned)}`,
    anchor: 'player',
    state: 'active',
    contractNodeId: null,
    title: 'Засада на дороге',
    markerPos: marker,
    playerInteracted: interacted,
    situationId: null,
    cleanup: () => { cleaned += 1 },
  })
  Reflect.set(value.engine, 'activeEvents', [event(new THREE.Vector3(9_999, 0, 9_999), false)])
  assert.equal(invoke<boolean>(value.engine, 'requestBeatStagingRoom', 3), true)
  assert.equal(cleaned, 1)
  assert.deepEqual(Reflect.get(value.engine, 'activeEvents'), [])
  assert.ok(value.notices.some((notice) => notice.includes('Засада на дороге')))
  // Control: an event the player is in the middle of finishes on its own terms.
  const engaged = event(value.player.position.clone(), true)
  Reflect.set(value.engine, 'activeEvents', [engaged])
  assert.equal(invoke<boolean>(value.engine, 'requestBeatStagingRoom', 3), true)
  assert.equal(cleaned, 1)
  assert.deepEqual(Reflect.get(value.engine, 'activeEvents'), [engaged])
})

test('PR B — the compass leads to the camp\'s nearest offer by road, and «Взяться» retargets it', () => {
  const value = harness('villain', 20_260_909, { spine: true })
  const { slot } = spineOf(value)
  const [first, second] = slot('offer')
  const [crossing] = slot('crossing')
  const start = getFactionStartPosition2D(value.blueprint, 'villain')
  assert.ok(start)
  value.player.position.set(start.x, 0, start.z)
  const input = () => invoke<ExpeditionInput>(value.engine, 'buildExpeditionInput')
  const planner = Reflect.get(value.engine, 'expeditionPlanner') as ExpeditionPlanner
  // Before a choice the camp is no place to go: the nearer offer by the road its card quotes leads.
  const road = (id: string) => input().caravanBeats?.find((target) => target.id === id)?.travel?.meters
  const [firstRoad, secondRoad] = [road(first.id), road(second.id)]
  assert.ok(firstRoad !== undefined && secondRoad !== undefined && firstRoad !== secondRoad)
  const [nearest, other] = firstRoad < secondRoad ? [first, second] : [second, first]
  assert.equal(input().leadingCaravanBeatId, nearest.id)
  const before = planner.buildView(input())
  assert.equal(before.target?.kind, 'caravanBeat', 'the camp no longer leads')
  assert.equal(before.target?.id, nearest.id)
  // Controls first: a road beat is no camp offer.
  assert.equal(invoke<boolean>(value.engine, 'chooseCaravanOffer', crossing.id), false)
  assert.equal(invoke<boolean>(value.engine, 'chooseCaravanOffer', other.id), true)
  // Both offers often share a road's name, so the notice names the square.
  const square = value.blueprint.regions.find((region) => region.id === other.regionId)
  assert.ok(square)
  const label = formatRegionGridLabel(square.coordinate.x, square.coordinate.y)
  assert.ok(value.notices.some((notice) => notice.startsWith('Взялся:') && notice.includes(`» в ${label}.`)))
  assert.equal(input().leadingCaravanBeatId, other.id)
  const led = planner.buildView(input())
  assert.equal(led.target?.kind, 'caravanBeat')
  assert.equal(led.target?.id, other.id, '«Взяться» on the farther card retargets the compass')
  assert.ok(led.target?.payout && led.target.travel, 'the atlas prices the cart it leads to')
  // An atlas choice still comes first.
  assert.equal(planner.select({ kind: 'caravanBeat', id: nearest.id }, input()), true)
  assert.equal(planner.buildView(input()).target?.id, nearest.id)
  // The dormant bridge is not charted while the camp chooses.
  assert.equal(input().caravanBeats?.some((target) => target.id === crossing.id), false)
  // Control: a run without a spine keeps W1-3's camp rule.
  const legacy = harness('villain')
  legacy.player.position.set(start.x, 0, start.z)
  const legacyInput = invoke<ExpeditionInput>(legacy.engine, 'buildExpeditionInput')
  assert.equal(legacyInput.leadingCaravanBeatId, null)
  const legacyView = (Reflect.get(legacy.engine, 'expeditionPlanner') as ExpeditionPlanner).buildView(legacyInput)
  assert.equal(legacyView.target?.kind, 'objective')
  assert.equal(legacyView.target?.id, invoke<{ id: string } | null>(legacy.engine, 'campNode')?.id)
})

test('PR B — standing at the camp closes nothing, and a run without a spine still closes it there', () => {
  /** The player on the camp's site, on a frame whose zone is the one already recorded. */
  const atCamp = (value: ReturnType<typeof harness>) => {
    const camp = invoke<{ siteId: string } | null>(value.engine, 'campNode')
    assert.ok(camp)
    const site = getSiteWorldPosition2D(value.blueprint, camp.siteId)
    assert.ok(site)
    value.player.position.set(site.x, 0, site.z)
    Reflect.set(value.engine, 'zoneAtPosition', () => 'neutral')
    Reflect.set(value.engine, 'lastZone', 'neutral')
  }
  const value = harness('elf', 20_260_909, { spine: true })
  atCamp(value)
  invoke(value.engine, 'updateMission')
  invoke(value.engine, 'updateMission')
  assert.equal(campDone(value), false, 'the camp waits for its caravan')
  assert.equal(value.tally.objectives, 0)
  // Control: a run without a spine closes its camp on the same arrival.
  const legacy = harness('elf')
  atCamp(legacy)
  invoke(legacy.engine, 'updateMission')
  assert.equal(campDone(legacy), true)
})

test('PR B — no random event is rolled while the camp chooses its caravan', () => {
  const value = harness('elf', 20_260_909, { spine: true })
  value.player.position.set(value.blueprint.bounds.maxX - 5, 0, value.blueprint.bounds.maxZ - 5)
  assert.equal(invoke<boolean>(value.engine, 'caravanBeatHoldsRandomEvents'), true)
  // Control: a run without a spine, far from its bridge, holds nothing.
  const legacy = harness('elf')
  legacy.player.position.set(legacy.blueprint.bounds.maxX - 5, 0, legacy.blueprint.bounds.maxZ - 5)
  assert.equal(invoke<boolean>(legacy.engine, 'caravanBeatHoldsRandomEvents'), false)
})