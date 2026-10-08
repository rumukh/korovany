/**
 * W1-6 — a commander on the player's side calls for men only while his own are fighting, and
 * no commander's call ever takes the room a contract would stage in.
 *
 * The defect, as measured on the engine's own window: for the palace guard, the boss slots of
 * the elf's and the villain's finales — the two palace strongholds those sides march on — are
 * not hostile, so they field the guard's own garrisons, each led by a `commander`.
 * `updateCommander` used to call four reinforcements every 25 s from the moment his square
 * streamed in, fight or no fight, and every one of them borrowed `chronicle`'s room. A guard
 * who reached «Домики жгут» beside the palace found it held by eight idle soldiers nobody had
 * asked for, and the contract was abandoned as `crowded`.
 *
 * Everything below drives production engine methods — `syncGeneratedRegions` and the spawner
 * under it, `updateCommander`, `startContractEvent`, `updateFactionContract` and the budget
 * seams — on an engine whose render, audio and actor-mesh boundaries are replaced
 * (`tests/contractRoomField.ts`, the way `tests/contractArrival.test.ts` does it). Every claim
 * carries a negative control: the legacy rule is put back on the instance, and the same
 * assertion has to fail against it.
 *
 * The player's own packs stepping back for a staging — W1-6's second half — is off here
 * unless a case says otherwise, so what these cases measure is the commander rule alone.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {
  REINFORCEMENTS_ORDERED_NOTICE,
  describeContractAbandoned,
  describeContractStarted,
  formatRegionGridLabel,
  generatedSiteLabel,
} from '../src/game/content/gameCopy.ts'
import type { Faction } from '../src/game/types.ts'
import { ACTOR_BUDGET, MAX_ACTORS } from '../src/game/world/ActorBudget.ts'
import {
  CONTRACT_TEMPLATES,
  findContractTemplate,
  getContractNodes,
} from '../src/game/world/CampaignDirector.ts'
import type { FactionObjectiveNode } from '../src/game/world/worldTypes.ts'
import {
  COMMANDER_CALL_INTERVAL,
  FACTIONS,
  FRAME,
  field,
  invoke,
  siteOf,
  world,
  type Category,
  type Probe,
  type World,
} from './contractRoomField.ts'

/** `GameEngine`'s `COMMANDER_REINFORCEMENT_INTERVAL` and `COMMANDER_REINFORCEMENT_LIMIT`. */
const CALL_INTERVAL = COMMANDER_CALL_INTERVAL
const CALL_LIMIT = 4
/** Long enough for all four calls, with a frame to spare. */
const RESIDENCY = CALL_INTERVAL * CALL_LIMIT + 1
/** The reproduction: the guard's «Домики жгут» between the two palace strongholds. */
const REPRO_SEED = 95_029
/** The longest start grace any shipped template has, plus a margin. */
const PAST_GRACE = Math.max(
  ...Object.values(CONTRACT_TEMPLATES).map((template) => template.startGraceSeconds),
) + 3

/**
 * Puts the rule W1-6 replaced back on the instance: every commander gathers men all the
 * time, and each call borrows whatever room the budget would lend.
 */
function restoreLegacyCommanders(probe: Probe): void {
  Reflect.set(probe.engine, 'commanderGathersMen', () => true)
  Reflect.set(probe.engine, 'reserveOwnActorSlots', function legacy(
    this: object,
    category: Category,
    count: number,
  ) {
    return invoke<boolean>(this, 'reserveActorSlots', category, count)
  })
}

/** A friendly palace commander and two of his men, standing alone with the squad. */
function garrison(faction: Faction = 'guard') {
  const source = world(REPRO_SEED)
  const probe = field(source, faction)
  probe.squad()
  const at = { x: probe.player.position.x + 30, z: probe.player.position.z }
  const commander = probe.spawn(faction, 'commander', at.x, at.z, 'campaign', {
    hostileToPlayer: false,
    generatedEncounterId: 'encounter-boss-test',
    generatedRegionId: 'region-test',
  })
  const men = [1, 2].map((index) =>
    probe.spawn(faction, 'soldier', at.x + 3 * index, at.z, 'campaign', {
      hostileToPlayer: false,
      generatedEncounterId: 'encounter-boss-test',
      generatedRegionId: 'region-test',
    }))
  return { probe, commander, men, at }
}

// ---------------------------------------------------------------------------
// 1. The rule
// ---------------------------------------------------------------------------

test('an idle garrison commander on the player\'s side calls nobody, and his clock stands still', () => {
  const { probe, commander } = garrison()
  probe.residency(RESIDENCY * 2)
  assert.equal(probe.reinforcements().length, 0)
  assert.equal(commander.reinforcementsCalled, 0)
  assert.equal(commander.reinforcementTimer, CALL_INTERVAL, 'idle time was counted towards a call')
  assert.ok(!probe.notices.includes(REINFORCEMENTS_ORDERED_NOTICE))

  // Negative control: the legacy rule calls all four, one every 25 s, into a quiet square.
  const control = garrison()
  restoreLegacyCommanders(control.probe)
  control.probe.residency(CALL_INTERVAL - FRAME)
  assert.equal(control.probe.reinforcements().length, 0)
  control.probe.residency(FRAME * 2)
  assert.equal(control.probe.reinforcements().length, 1)
  control.probe.residency(RESIDENCY)
  assert.equal(control.probe.reinforcements().length, CALL_LIMIT)
})

test('an engaged commander on the player\'s side calls his men, and only fighting time counts', () => {
  const { probe, commander, men, at } = garrison()
  const raider = probe.spawn('elf', 'soldier', at.x + 8, at.z, 'chronicle')
  // Twenty seconds of a fight: not yet a call.
  men[0].targetId = raider.id
  probe.residency(20)
  assert.equal(probe.reinforcements().length, 0)
  assert.ok(Math.abs(commander.reinforcementTimer - (CALL_INTERVAL - 20)) < 1e-9)
  // The fight stops for a minute; the clock stops with it.
  men[0].targetId = null
  probe.residency(60)
  assert.equal(probe.reinforcements().length, 0)
  assert.ok(Math.abs(commander.reinforcementTimer - (CALL_INTERVAL - 20)) < 1e-9)
  // It starts again: five more seconds of fighting complete the first call.
  men[1].action = { kind: 'meleeActor' }
  probe.residency(5 + FRAME)
  const [first] = probe.reinforcements()
  assert.ok(first, 'twenty-five seconds of fighting did not call anyone')
  assert.equal(first.allegiance, commander.allegiance)
  assert.equal(first.budgetCategory, 'campaign')
  assert.equal(first.hostileToPlayer, false)
  assert.equal(first.generatedRegionId, 'region-test')
  // Kept up, the fight brings the rest, and never more than four.
  probe.residency(RESIDENCY)
  assert.equal(probe.reinforcements().length, CALL_LIMIT)
  assert.equal(commander.reinforcementsCalled, CALL_LIMIT)
  assert.ok(probe.notices.includes(REINFORCEMENTS_ORDERED_NOTICE), 'the call near the player is not announced')

  // Negative control: the same fight out of his earshot is not his men's fight.
  const far = garrison()
  const distant = far.probe.spawn('guard', 'soldier', far.at.x + 40, far.at.z, 'campaign', { hostileToPlayer: false })
  const prey = far.probe.spawn('elf', 'soldier', far.at.x + 44, far.at.z, 'chronicle')
  distant.targetId = prey.id
  far.probe.residency(RESIDENCY)
  assert.equal(far.probe.reinforcements().length, 0, 'a fight out of his earshot called his men')
})

test('a commander hostile to the player keeps the old cadence', () => {
  // The elf's view of the same garrison: hostile, so his men gather before anyone swings.
  const { probe, commander } = garrison('elf')
  for (const actor of probe.actors.filter((entry) => entry.generatedEncounterId === 'encounter-boss-test')) {
    actor.allegiance = 'guard'
    actor.hostileToPlayer = true
  }
  const legacy = garrison('elf')
  for (const actor of legacy.probe.actors.filter((entry) => entry.generatedEncounterId === 'encounter-boss-test')) {
    actor.allegiance = 'guard'
    actor.hostileToPlayer = true
  }
  restoreLegacyCommanders(legacy.probe)
  const calls = (target: Probe): number[] => {
    const times: number[] = []
    for (let second = 0; second < RESIDENCY; second += FRAME) {
      const before = target.reinforcements().length
      target.residency(FRAME)
      if (target.reinforcements().length > before) times.push(Math.round(second + FRAME))
    }
    return times
  }
  const shipped = calls(probe)
  assert.deepEqual(shipped, [25, 50, 75, 100])
  assert.deepEqual(calls(legacy.probe), shipped, 'the hostile cadence changed')
  assert.equal(commander.reinforcementsCalled, CALL_LIMIT)

  // Negative control: the same commander on the player's side, idle, calls nobody.
  const friendly = garrison('elf')
  for (const actor of friendly.probe.actors.filter((entry) => entry.generatedEncounterId === 'encounter-boss-test')) {
    actor.allegiance = 'guard'
    actor.hostileToPlayer = false
  }
  assert.deepEqual(calls(friendly.probe), [])
})

test('a reinforcement never takes the room a contract would stage in', () => {
  // The reproduction's window: the palace garrisons are already past campaign's own eight.
  const source = world(REPRO_SEED)
  const [signature] = getContractNodes(source.blueprint, 'guard')
  const probe = field(source, 'guard', { node: signature })
  probe.squad()
  probe.streamIn()
  assert.ok(probe.usage().campaign > ACTOR_BUDGET.campaign)
  const room = probe.chronicleRoom()
  // Every one of his men fighting, so every call is due.
  Reflect.set(probe.engine, 'commanderGathersMen', () => true)
  probe.residency(RESIDENCY)
  assert.equal(probe.reinforcements().length, 0, 'a call borrowed past campaign\'s own share')
  assert.equal(probe.chronicleRoom(), room)

  // Inside campaign's own share a call is answered, and the room below is untouched.
  const quiet = garrison()
  Reflect.set(quiet.probe.engine, 'commanderGathersMen', () => true)
  const quietRoom = quiet.probe.chronicleRoom()
  quiet.probe.residency(RESIDENCY)
  assert.equal(quiet.probe.reinforcements().length, CALL_LIMIT)
  assert.ok(quiet.probe.usage().campaign <= ACTOR_BUDGET.campaign)
  assert.equal(quiet.probe.chronicleRoom(), quietRoom)

  // Negative control: the borrowing reservation fills the contract's room with soldiers.
  const control = field(source, 'guard', { node: signature })
  control.squad()
  control.streamIn()
  restoreLegacyCommanders(control)
  control.residency(RESIDENCY)
  assert.ok(control.reinforcements().length > 0)
  assert.ok(control.chronicleRoom() < room, 'the control left the room alone, so it proves nothing')
})

// ---------------------------------------------------------------------------
// 2. The contract it starved
// ---------------------------------------------------------------------------

test('the guard reaches «Домики жгут» beside an idle palace garrison and the contract starts', () => {
  const source = world(REPRO_SEED)
  const [signature] = getContractNodes(source.blueprint, 'guard')
  assert.equal(signature.contract, 'bulwark')
  const template = findContractTemplate(signature.contract)
  assert.ok(template)
  const arrive = (legacy: boolean): Probe => {
    const probe = field(source, 'guard', { node: signature })
    if (legacy) restoreLegacyCommanders(probe)
    probe.squad()
    probe.streamIn()
    // Two garrisons, at the strongholds the villain and the elves march on: a commander and
    // two men each, all of them the guard's own.
    assert.equal(probe.commanders().length, 2)
    assert.ok(probe.actors.every((actor) => !actor.hostileToPlayer), 'every body in this window is the guard\'s own')
    probe.residency(RESIDENCY)
    probe.contractFrames(0.1)
    return probe
  }

  const shipped = arrive(false)
  assert.equal(shipped.reinforcements().length, 0)
  assert.equal(shipped.status(signature), 'active')
  assert.ok(shipped.notices.includes(describeContractStarted('bulwark')))
  assert.ok(shipped.actors.length <= MAX_ACTORS)

  // Negative control: under the legacy rule the same arrival stalls `crowded` and the
  // contract is abandoned once its grace runs out — W1-6's finding, in the engine.
  const legacy = arrive(true)
  assert.equal(legacy.reinforcements().length, 2 * CALL_LIMIT)
  assert.equal(legacy.status(signature), 'offered')
  legacy.contractFrames(PAST_GRACE)
  assert.equal(legacy.status(signature), 'failed')
  const site = source.blueprint.sites.find((entry) => entry.id === signature.siteId)
  const region = source.blueprint.regions.find((entry) => entry.id === signature.regionId)
  assert.ok(site && region)
  assert.ok(legacy.notices.includes(describeContractAbandoned('bulwark', {
    regionLabel: formatRegionGridLabel(region.coordinate.x, region.coordinate.y),
    siteLabel: generatedSiteLabel(site.kind),
  }, 'crowded')))
})

// ---------------------------------------------------------------------------
// 3. The guard test: every contract site, the engine's own window
// ---------------------------------------------------------------------------

type Rule = 'none' | 'shipped' | 'engaged' | 'legacy'

interface Arrival {
  seed: number
  faction: Faction
  node: string
  contract: string
  outcome: string
  called: number
}

/**
 * One arrival at one contract site: the squad, the engine's window through the production
 * spawner, `RESIDENCY` seconds of the window's commanders under `rule`, then the production
 * start gate. The contract's own builder is replaced by an event stub: what is under test is
 * whether the gate finds room, not what the builder puts there.
 *
 * - `none`: no commander ever updates — what the window alone holds.
 * - `shipped`: the production rule, with nobody fighting.
 * - `engaged`: the production reservation with every commander's men fighting throughout.
 * - `legacy`: the rule W1-6 replaced.
 *
 * `friendlyOnly` takes every pack hostile to the player off the field before the residency,
 * as a player who cleared them on the way would; the garrisons stay, because nobody fights
 * them.
 */
function arriveAt(
  source: World,
  faction: Faction,
  node: FactionObjectiveNode,
  rule: Rule,
  options: { wide?: boolean; friendlyOnly?: boolean } = {},
): Arrival {
  const probe = field(source, faction, { node, wide: options.wide })
  probe.squad()
  probe.streamIn()
  if (options.friendlyOnly) {
    for (const actor of [...probe.actors]) {
      if (actor.hostileToPlayer && actor.generatedEncounterId !== null) {
        invoke(probe.engine, 'removeActorById', actor.id)
      }
    }
  }
  if (rule === 'legacy') restoreLegacyCommanders(probe)
  if (rule === 'engaged') Reflect.set(probe.engine, 'commanderGathersMen', () => true)
  if (rule !== 'none') probe.residency(RESIDENCY)
  Reflect.set(probe.engine, 'buildContractEvent', () => invoke(probe.engine, 'createWorldEvent', {
    id: `test-contract-${node.id}`,
    kind: 'champion',
    anchor: 'located',
    regionId: String(node.regionId),
    situationId: null,
    state: 'active',
    title: 'Тест',
    description: 'Тест.',
    tone: 'warning',
    timer: 60,
    progress: 0,
    target: 1,
    markerId: `test-contract-${node.id}-marker`,
    markerPos: new THREE.Vector3(),
    ownedActorIds: [],
    ownedProps: [],
  }))
  const template = findContractTemplate(node.contract)
  assert.ok(template)
  const outcome = invoke<string>(probe.engine, 'startContractEvent', node, template, siteOf(source.blueprint, node))
  assert.ok(probe.actors.length <= MAX_ACTORS)
  return {
    seed: source.seed,
    faction,
    node: node.id,
    contract: template.id,
    outcome,
    called: probe.reinforcements().length,
  }
}

function demandSeeds(): number[] {
  const raw = Number(process.env.KOROVANY_DEMAND_SEEDS)
  const count = Number.isInteger(raw) && raw > 0 ? raw : 40
  return Array.from({ length: count }, (_, index) => 1 + 7919 * index)
}

test('guard test: on the engine\'s own window no commander crowds out a contract', () => {
  const seeds = demandSeeds()
  const variants = {
    window: { rule: 'none', options: {} },
    shipped: { rule: 'shipped', options: {} },
    engaged: { rule: 'engaged', options: {} },
    legacy: { rule: 'legacy', options: {} },
    friendlyWindow: { rule: 'none', options: { friendlyOnly: true } },
    friendlyShipped: { rule: 'shipped', options: { friendlyOnly: true } },
    friendlyLegacy: { rule: 'legacy', options: { friendlyOnly: true } },
    wide: { rule: 'none', options: { wide: true } },
  } as const
  type Variant = keyof typeof variants
  const results = new Map<Variant, Arrival[]>()
  for (const name of Object.keys(variants) as Variant[]) results.set(name, [])
  for (const seed of seeds) {
    const source = world(seed)
    for (const faction of FACTIONS) {
      for (const node of getContractNodes(source.blueprint, faction)) {
        for (const name of Object.keys(variants) as Variant[]) {
          const { rule, options } = variants[name]
          results.get(name)!.push(arriveAt(source, faction, node, rule, options))
        }
      }
    }
  }
  const crowded = (name: Variant, faction?: Faction): Arrival[] =>
    results.get(name)!.filter((arrival) =>
      arrival.outcome === 'crowded' && (faction === undefined || arrival.faction === faction))
  const sites = results.get('window')!.length
  assert.equal(sites, seeds.length * 6)
  for (const arrivals of results.values()) {
    assert.ok(arrivals.every((arrival) => arrival.outcome === 'started' || arrival.outcome === 'crowded'),
      'only room decides an arrival here')
  }

  if (process.env.KOROVANY_DEMAND_VERBOSE) {
    for (const name of Object.keys(variants) as Variant[]) {
      const counts = FACTIONS.map((faction) => `${faction} ${String(crowded(name, faction).length)}/${String(sites / 3)}`)
      console.log(`${name.padEnd(16)} crowded: ${counts.join(', ')}`)
    }
    for (const arrival of crowded('legacy')) {
      console.log(`  legacy: seed ${String(arrival.seed)} ${arrival.faction} ${arrival.node} ${arrival.contract}`)
    }
    for (const arrival of crowded('shipped')) {
      console.log(`  shipped: seed ${String(arrival.seed)} ${arrival.faction} ${arrival.node} ${arrival.contract}`)
    }
  }

  // What the window alone holds: at most one site per faction, before any commander calls.
  for (const faction of FACTIONS) {
    assert.ok(crowded('window', faction).length <= Math.ceil(seeds.length / 40),
      `${faction}: ${String(crowded('window', faction).length)} sites crowded by the window alone`)
  }
  // The rule: idle garrisons add nothing, and even commanders fighting throughout add nothing
  // a contract would need, site for site.
  const outcomes = (name: Variant): string[] => results.get(name)!.map((arrival) => arrival.outcome)
  assert.deepEqual(outcomes('shipped'), outcomes('window'))
  assert.deepEqual(outcomes('engaged'), outcomes('window'))
  assert.ok(results.get('shipped')!.every((arrival) => arrival.called === 0), 'an idle garrison called someone')
  assert.deepEqual(outcomes('friendlyShipped'), outcomes('friendlyWindow'))

  // Negative control: the legacy rule is the finding — the guard's garrisons crowd out its
  // own contracts, and nobody else has a commander outside the finale to do it with.
  if (seeds.length >= 40) {
    assert.ok(crowded('legacy', 'guard').length >= 10, `legacy crowded ${String(crowded('legacy', 'guard').length)} guard sites`)
    assert.ok(crowded('friendlyLegacy', 'guard').length >= 8,
      `legacy crowded ${String(crowded('friendlyLegacy', 'guard').length)} guard sites with the hostiles cleared`)
  }
  assert.ok(crowded('legacy', 'guard').length > crowded('window', 'guard').length)
  for (const faction of ['elf', 'villain'] as const) {
    assert.equal(crowded('legacy', faction).length, crowded('window', faction).length)
  }

  // And the window is the engine's: the 3x3 square the harness once simulated crowds out
  // most contracts with no commander at all, so this instrument tells the two apart.
  assert.ok(crowded('wide').length >= sites / 2, `the 3x3 crowded only ${String(crowded('wide').length)} of ${String(sites)}`)
})
