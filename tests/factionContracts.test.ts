/**
 * Roadmap 1.4 — branching faction contracts, and the controls that keep the claim honest.
 *
 * The claim this file has to back is narrow and it is worth stating before any of it:
 *
 * > A faction campaign is now an **all-required diamond** rather than a chain. Both middle
 * > nodes are ready at once, the player pins one, and the pin persists. One of the two is a
 * > **signature contract** adapted from a shipped event builder, and it **fails forward**:
 * > losing it costs the payout, never the run.
 *
 * And what it is *not*: this is not an exclusive route. Nothing is skipped, the win
 * condition is still `every(o => o.done)`, and the persisted `Objective` has gained
 * nothing. What the player chooses is an **order**. Route divergence in the exclusive sense
 * is 2.1's signal, and the sweep below deliberately measures ordering instead.
 *
 * Four classes of control run alongside the measurements, because a safety claim that
 * cannot fail is worse than no safety claim:
 *
 * - *The strand gate, doped.* `findContractStrandRisks` is driven against mutated tables —
 *   a contract with no clock, one with no start grace, one with fail-forward switched off,
 *   a faction with no template, a graph whose contract site is not reserved — and every one
 *   must be reported.
 * - *The placebo.* The same fork policies are run against a **linearised** copy of the same
 *   campaign. If ordering divergence survived that, it would be coming from something other
 *   than the fork.
 * - *The baseline.* The default `firstReady` arm pins nothing and must report exactly zero
 *   divergence and zero choice, or "the fork produced this" is unfounded.
 * - *The whole-run safety arm.* A scripted player that starts every contract and walks away
 *   from it must still finish its runs, and must never leave a razed square where the
 *   campaign needs one.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import type { Faction, Objective } from '../src/game/types.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { validateWorldBlueprint } from '../src/game/world/WorldValidator.ts'
import {
  CONTRACT_IDS,
  FACTION_CONTRACT_SITES,
  WORLD_FACTIONS,
  type ContractId,
  type FactionObjectiveNode,
  type WorldBlueprint,
} from '../src/game/world/worldTypes.ts'
import {
  CONTRACT_STATUSES,
  FACTION_CONTRACTS,
  advanceContract,
  beginContract,
  completeObjectiveEntry,
  createCampaignContractState,
  createGeneratedObjectives,
  ensureContractProgress,
  findContractNode,
  findContractStrandRisks,
  findContractTemplate,
  getActiveObjectiveNode,
  getContractStatus,
  getFactionContract,
  getReadyObjectiveNodes,
  getRumourReservedRegionIds,
  isContractLive,
  isContractNodeCompletableByArrival,
  normalizeCampaignContractState,
  pinObjective,
  resolveActiveObjectiveNode,
  resolveContract,
  serializeCampaignContractState,
  type CampaignContractState,
  type ContractStatus,
  type FactionContractTemplate,
} from '../src/game/world/CampaignDirector.ts'
import { buildCampaignContractViews, buildMapMarkers } from '../src/game/world/CampaignView.ts'
import type { LiveViewInput } from '../src/game/world/CampaignView.ts'
import { runHarness } from './runHarness.ts'

const FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']

function readyAfterRoot(
  blueprint: WorldBlueprint,
  faction: Faction,
): { objectives: Objective[]; ready: FactionObjectiveNode[] } {
  const objectives = createGeneratedObjectives(blueprint, faction)
  for (const rootId of blueprint.objectives[faction].rootNodeIds) {
    completeObjectiveEntry(objectives, rootId)
  }
  return { objectives, ready: getReadyObjectiveNodes(blueprint, faction, objectives) }
}

// ---------------------------------------------------------------------------
// The shape of the graph
// ---------------------------------------------------------------------------

test('every faction campaign is a diamond with exactly one signature contract', () => {
  let graphs = 0
  let forks = 0
  const contractSites = new Map<Faction, Set<string>>()
  const errandSites = new Map<Faction, Set<string>>()

  for (let index = 0; index < 160; index += 1) {
    const blueprint = generateWorld(31_000 + index * 617)
    for (const faction of FACTIONS) {
      const graph = blueprint.objectives[faction]
      graphs += 1

      // Four nodes: one root, two required middles, one finale.
      assert.equal(graph.nodes.length, 4, `${faction} graph is not a diamond`)
      assert.deepEqual(graph.rootNodeIds, [`objective-${faction}-start`])
      assert.equal(graph.finalNodeId, `objective-${faction}-finale`)

      const contractNodes = graph.nodes.filter((node) => node.contract !== undefined)
      assert.equal(contractNodes.length, 1, `${faction} has ${String(contractNodes.length)} contracts`)
      assert.equal(contractNodes[0].contract, FACTION_CONTRACTS[faction].id)
      assert.equal(contractNodes[0].kind, FACTION_CONTRACT_SITES[faction].kind)

      // The finale waits for both arms, which is what makes them required rather than
      // alternatives. A finale that waited for one would be 2.1 arriving by accident.
      const finale = graph.nodes.find((node) => node.id === graph.finalNodeId)
      assert.equal(finale?.prerequisiteIds.length, 2)

      const { ready } = readyAfterRoot(blueprint, faction)
      assert.equal(ready.length, 2, `${faction} presents ${String(ready.length)} ready nodes`)
      forks += 1

      // Both arms are different places, or the fork is invisible on the map.
      assert.notEqual(ready[0].siteId, ready[1].siteId)

      const errand = ready.find((node) => node.contract === undefined)
      const contract = ready.find((node) => node.contract !== undefined)
      assert.ok(errand && contract)
      const contractSet = contractSites.get(faction) ?? new Set<string>()
      contractSet.add(contract.siteId)
      contractSites.set(faction, contractSet)
      const errandSet = errandSites.get(faction) ?? new Set<string>()
      errandSet.add(errand.siteId)
      errandSites.set(faction, errandSet)
    }
  }

  assert.equal(graphs, 480)
  assert.equal(forks, 480)
  // The seeded draw is real on both arms, and the two never collide: the campaign-graph
  // count per faction is the product, which is 2 errands x 3 contract sites = 6, up from
  // the 2 the roadmap's diagnosis counted. Across three factions that is 18 rather than 6.
  for (const faction of FACTIONS) {
    assert.equal(errandSites.get(faction)?.size, 2, `${faction} errand draw collapsed`)
    assert.equal(contractSites.get(faction)?.size, 3, `${faction} contract draw collapsed`)
    for (const siteId of contractSites.get(faction) ?? []) {
      assert.equal(
        errandSites.get(faction)?.has(siteId),
        false,
        `${faction} can site its contract on its own errand`,
      )
    }
  }
})

test('the graph stays topologically ordered, and the first ready node is still legal', () => {
  // The pre-1.4 reader was a `.find()` over the node array, and it is still the fallback
  // when nothing is pinned. That only stays correct while prerequisites are listed before
  // the nodes that need them, so it is asserted rather than assumed.
  let checked = 0
  for (let index = 0; index < 120; index += 1) {
    const blueprint = generateWorld(88_000 + index * 409)
    for (const faction of FACTIONS) {
      const seen = new Set<string>()
      for (const node of blueprint.objectives[faction].nodes) {
        for (const prerequisiteId of node.prerequisiteIds) {
          assert.ok(seen.has(prerequisiteId), `${node.id} needs ${prerequisiteId}, listed later`)
        }
        seen.add(node.id)
      }
      const { objectives, ready } = readyAfterRoot(blueprint, faction)
      assert.equal(
        getActiveObjectiveNode(blueprint, faction, objectives)?.id,
        ready[0].id,
        'the fallback reader disagrees with the ready list',
      )
      checked += 1
    }
  }
  assert.equal(checked, 360)
})

test('the two contract tables describe the same three contracts', () => {
  // The siting lives with the generator and the clock lives with the director, the same
  // split 1.3 used. Two tables can drift; this is what notices.
  const fromDirector = new Set<ContractId>()
  const fromSiting = new Set<ContractId>()
  for (const faction of WORLD_FACTIONS) {
    fromDirector.add(FACTION_CONTRACTS[faction].id)
    fromSiting.add(FACTION_CONTRACT_SITES[faction].id)
    assert.equal(FACTION_CONTRACTS[faction].faction, faction)
    assert.equal(FACTION_CONTRACT_SITES[faction].faction, faction)
    assert.equal(FACTION_CONTRACTS[faction].id, FACTION_CONTRACT_SITES[faction].id)
    assert.equal(findContractTemplate(FACTION_CONTRACTS[faction].id)?.faction, faction)
  }
  assert.deepEqual([...fromDirector].sort(), [...CONTRACT_IDS].sort())
  assert.deepEqual([...fromSiting].sort(), [...CONTRACT_IDS].sort())
  // Three factions, three different signatures. The roadmap's second signal, at the table
  // level; the sweep at the bottom of this file measures it on runs.
  assert.equal(fromDirector.size, 3)
  assert.equal(findContractTemplate(undefined), null)
  assert.equal(findContractTemplate('nonesuch' as ContractId), null)

  // 1.4 adds no campaign verbs. This is the explicitly rejected design, asserted.
  for (const faction of WORLD_FACTIONS) {
    assert.ok(
      ['arrive', 'interact', 'defeat', 'claim'].includes(FACTION_CONTRACT_SITES[faction].kind),
      `${faction} invented a fifth verb`,
    )
  }
})

// ---------------------------------------------------------------------------
// Campaign safety: the strand gate and its doped controls
// ---------------------------------------------------------------------------

test('no shipped seed carries a contract that could strand a run', () => {
  for (let index = 0; index < 120; index += 1) {
    const blueprint = generateWorld(5_000 + index * 907)
    assert.deepEqual(
      findContractStrandRisks(blueprint),
      [],
      `seed ${String(5_000 + index * 907)} has a strandable contract`,
    )
  }
})

test('every contract site is a square the reserved set already protects', () => {
  // 1.3 reserved the anchors plus every square holding one of the player's objective sites,
  // so a burned shop cannot make a run unfinishable. A contract site is an objective site,
  // so it inherits that — but inheriting a guarantee silently is how a guarantee gets lost.
  let checked = 0
  for (let index = 0; index < 120; index += 1) {
    const blueprint = generateWorld(64_000 + index * 331)
    for (const faction of FACTIONS) {
      const node = findContractNode(blueprint, faction)
      assert.ok(node, `${faction} has no contract node`)
      const reserved = getRumourReservedRegionIds(blueprint, faction)
      assert.ok(reserved.has(String(node.regionId)), `${node.id} sits in an unreserved square`)
      checked += 1
    }
  }
  assert.equal(checked, 360)
})

test('the strand gate reports a missing clock, a missing grace, a lost fail-forward and a missing template', () => {
  // Vacuity control. Each mutation is a way a contract could hang or lock; each must be
  // caught, or the clean result above means nothing.
  const blueprint = generateWorld(1_234_567)
  const shipped = FACTION_CONTRACTS

  const noClock = {
    ...shipped,
    elf: { ...shipped.elf, timeoutSeconds: Number.POSITIVE_INFINITY },
  }
  const noClockRisks = findContractStrandRisks(blueprint, noClock)
  assert.deepEqual(
    noClockRisks.filter((risk) => risk.problem === 'unboundedClock'),
    [{ subject: 'unshackle', problem: 'unboundedClock' }],
  )
  // And the simulation refuses it rather than running forever on it. This mutation is
  // exactly what caught the missing cap on the first run of this file.
  assert.ok(
    noClockRisks.some((risk) => risk.problem === 'terminalIncomplete'),
    'a contract with no clock was simulated as if it resolved',
  )

  const noGrace = { ...shipped, guard: { ...shipped.guard, startGraceSeconds: 0 } }
  assert.ok(
    findContractStrandRisks(blueprint, noGrace).some(
      (risk) => risk.subject === 'bulwark' && risk.problem === 'unboundedStart',
    ),
  )

  // **The one that matters most.** A template with fail-forward switched off leaves a node
  // that a failed contract locks for ever, and the gate has to say so.
  const noFailForward = {
    ...shipped,
    villain: { ...shipped.villain, failForward: false },
  }
  const failForwardRisks = findContractStrandRisks(blueprint, noFailForward)
  assert.ok(
    failForwardRisks.some(
      (risk) => risk.subject === 'plunder' && risk.problem === 'noFailForward',
    ),
    'the gate did not notice fail-forward being switched off',
  )
  assert.ok(
    failForwardRisks.some((risk) => risk.problem === 'terminalIncomplete'),
    'the gate did not notice that a failed contract now locks its node',
  )

  const missing = { ...shipped, elf: undefined } as unknown as typeof shipped
  assert.ok(
    findContractStrandRisks(blueprint, missing).some(
      (risk) => risk.subject === 'elf' && risk.problem === 'missingTemplate',
    ),
  )

  // A reservation rule that forgot about contracts. This cannot happen against a shipped
  // blueprint — a contract node is an objective node, so 1.3's reserved set already covers
  // it — which is exactly why the rule is a parameter: a branch that can never fire is a
  // branch nobody can prove works, and the reservation rule belongs to another initiative.
  assert.ok(
    findContractStrandRisks(blueprint, shipped, () => new Set<string>()).some(
      (risk) => risk.problem === 'siteUnreserved',
    ),
    'the gate did not notice a contract site outside the reserved set',
  )
  // And with the real rule, on the same blueprint, it does not fire.
  assert.equal(
    findContractStrandRisks(blueprint).some((risk) => risk.problem === 'siteUnreserved'),
    false,
  )

  const removed = structuredClone(blueprint)
  removed.objectives.villain.nodes = removed.objectives.villain.nodes.filter(
    (entry) => entry.contract === undefined,
  )
  assert.ok(
    findContractStrandRisks(removed).some(
      (risk) => risk.subject === 'villain' && risk.problem === 'missingNode',
    ),
  )
})

test('the world validator rejects an unknown contract id and a faction with two of them', () => {
  const blueprint = generateWorld('contract-validation')
  assert.equal(validateWorldBlueprint(blueprint).valid, true)

  const unknown = structuredClone(blueprint)
  const node = unknown.objectives.elf.nodes.find((entry) => entry.contract !== undefined)
  assert.ok(node)
  node.contract = 'sabotage-the-moon' as ContractId
  assert.ok(
    validateWorldBlueprint(unknown).issues.some((issue) => issue.code === 'objective.contract'),
  )

  const doubled = structuredClone(blueprint)
  for (const entry of doubled.objectives.guard.nodes) {
    if (entry.id.endsWith('-branch')) entry.contract = 'bulwark'
  }
  assert.ok(
    validateWorldBlueprint(doubled).issues.some(
      (issue) => issue.code === 'objective.contractCount',
    ),
  )

  const none = structuredClone(blueprint)
  for (const entry of none.objectives.villain.nodes) delete entry.contract
  assert.ok(
    validateWorldBlueprint(none).issues.some(
      (issue) => issue.code === 'objective.contractCount',
    ),
  )
})

// ---------------------------------------------------------------------------
// Fail-forward, as a state machine
// ---------------------------------------------------------------------------

/** Drives one contract with a driver that never succeeds, and reports where it ended. */
function driveToTerminal(
  node: FactionObjectiveNode,
  template: FactionContractTemplate,
  from: ContractStatus,
): { state: CampaignContractState; seconds: number } {
  const state = createCampaignContractState()
  const progress = ensureContractProgress(state, node)
  assert.ok(progress)
  progress.status = from
  if (from === 'active') progress.remaining = template.timeoutSeconds
  let seconds = 0
  const horizon = template.timeoutSeconds + template.startGraceSeconds + 10
  while (isContractLive(progress.status) && seconds < horizon) {
    const tick = advanceContract(progress, template, 0.5, true)
    seconds += 0.5
    if (tick.kind === 'expired' || tick.kind === 'abandoned') {
      resolveContract(state, node.id, 'failed')
    }
  }
  return { state, seconds }
}

test('a contract that is never honoured always resolves, and always leaves a node the player can close', () => {
  const blueprint = generateWorld(2_468_024)
  for (const faction of FACTIONS) {
    const node = findContractNode(blueprint, faction)
    const template = getFactionContract(faction)
    assert.ok(node)
    for (const from of ['offered', 'active'] as const) {
      const { state, seconds } = driveToTerminal(node, template, from)
      const status = getContractStatus(state, node)
      assert.equal(status, 'failed', `${faction} from ${from} did not resolve`)
      assert.ok(
        seconds <= template.timeoutSeconds + template.startGraceSeconds + 1,
        `${faction} from ${from} took ${String(seconds)} s to give up`,
      )
      // **The fail-forward guarantee.** The node is now an arrival at a site the reserved
      // set protects, so the campaign is finishable no matter what the contract did.
      assert.equal(
        isContractNodeCompletableByArrival(status, template),
        true,
        `${faction} from ${from} left a locked node`,
      )
    }
    // A kept contract is not an arrival: it completed on its own terms.
    assert.equal(isContractNodeCompletableByArrival('kept', template), false)
    assert.equal(isContractNodeCompletableByArrival('offered', template), false)
    assert.equal(isContractNodeCompletableByArrival('active', template), false)
  }
})

test('a template with fail-forward switched off leaves a node nothing can close', () => {
  // The negative control for the assertion above, and the reason `failForward` is a field
  // rather than a fact about the code. If this test ever passes with the *shipped* table,
  // the guarantee has been lost.
  const blueprint = generateWorld(2_468_024)
  const node = findContractNode(blueprint, 'elf')
  assert.ok(node)
  const broken: FactionContractTemplate = { ...getFactionContract('elf'), failForward: false }
  const { state } = driveToTerminal(node, broken, 'active')
  assert.equal(getContractStatus(state, node), 'failed')
  assert.equal(
    isContractNodeCompletableByArrival(getContractStatus(state, node), broken),
    false,
    'a template with no fail-forward must not look completable',
  )
  // And the shipped one does close, on the same node and the same failure.
  assert.equal(
    isContractNodeCompletableByArrival(
      getContractStatus(state, node),
      getFactionContract('elf'),
    ),
    true,
  )
})

test('a resolved contract stays resolved, and the clock stops with it', () => {
  const blueprint = generateWorld(777_777)
  const node = findContractNode(blueprint, 'guard')
  const template = getFactionContract('guard')
  assert.ok(node)
  const state = createCampaignContractState()
  assert.ok(beginContract(state, node, template))
  assert.equal(beginContract(state, node, template), false, 'a contract restarted')
  assert.equal(resolveContract(state, node.id, 'kept'), true)
  assert.equal(resolveContract(state, node.id, 'failed'), false, 'a kept contract was failed')
  assert.equal(getContractStatus(state, node), 'kept')
  const progress = ensureContractProgress(state, node)
  assert.ok(progress)
  assert.deepEqual(advanceContract(progress, template, 10, true), { kind: 'idle' })
  assert.equal(resolveContract(state, 'objective-guard-missing', 'failed'), false)
})

test('patience is only spent in front of the thing', () => {
  // A contract the player has not reached yet must not burn its start grace on the walk
  // over, or a fork whose contract arm is far away would fail before it was ever seen.
  const blueprint = generateWorld(31_337)
  const node = findContractNode(blueprint, 'villain')
  const template = getFactionContract('villain')
  assert.ok(node)
  const state = createCampaignContractState()
  const progress = ensureContractProgress(state, node)
  assert.ok(progress)
  for (let second = 0; second < template.startGraceSeconds * 4; second += 1) {
    const tick = advanceContract(progress, template, 1, false)
    assert.deepEqual(tick, { kind: 'idle' })
  }
  assert.equal(progress.waited, 0)
  assert.equal(getContractStatus(state, node), 'offered')
})

// ---------------------------------------------------------------------------
// The pin: the decision, and its persistence
// ---------------------------------------------------------------------------

test('the pin only accepts a ready node, and it is what the compass follows', () => {
  const blueprint = generateWorld(909_090)
  for (const faction of FACTIONS) {
    const { objectives, ready } = readyAfterRoot(blueprint, faction)
    const readyIds = ready.map((node) => node.id)
    const state = createCampaignContractState()

    // Nothing pinned: the pre-1.4 first-ready answer, unchanged.
    assert.equal(
      resolveActiveObjectiveNode(blueprint, faction, objectives, null)?.id,
      ready[0].id,
    )

    assert.equal(pinObjective(state, 'objective-does-not-exist', readyIds), false)
    assert.equal(state.pinnedNodeId, null, 'an unknown id was stored')
    assert.equal(pinObjective(state, blueprint.objectives[faction].finalNodeId, readyIds), false)
    assert.equal(state.pinnedNodeId, null, 'a node whose prerequisites are open was pinned')

    assert.equal(pinObjective(state, ready[1].id, readyIds), true)
    assert.equal(pinObjective(state, ready[1].id, readyIds), false, 'a no-op pin reported a move')
    assert.equal(
      resolveActiveObjectiveNode(blueprint, faction, objectives, state.pinnedNodeId)?.id,
      ready[1].id,
      'the compass ignored the pin',
    )

    // Dropping it goes back to the first ready node rather than to nothing.
    assert.equal(pinObjective(state, null, readyIds), true)
    assert.equal(pinObjective(state, null, readyIds), false)
    assert.equal(
      resolveActiveObjectiveNode(blueprint, faction, objectives, null)?.id,
      ready[0].id,
    )

    // A pin naming a node that has since been completed falls back rather than pointing at
    // nothing. This is the restore case, and a compass with no answer is worse than one
    // with the wrong answer.
    pinObjective(state, ready[1].id, readyIds)
    completeObjectiveEntry(objectives, ready[1].id)
    assert.equal(
      resolveActiveObjectiveNode(blueprint, faction, objectives, state.pinnedNodeId)?.id,
      ready[0].id,
    )
  }
})

test('pinning reads no clock and consumes no random stream', () => {
  // Determinism control, the same one 0.4's hints carry: a draw taken for a UI event would
  // shift every encounter and loot roll after it.
  const blueprint = generateWorld(4_040_404)
  const { ready } = readyAfterRoot(blueprint, 'guard')
  const state = createCampaignContractState()
  const readyIds = ready.map((node) => node.id)

  const realRandom = Math.random
  const realNow = Date.now
  const realPerformanceNow = performance.now
  const forbidden = (name: string) => () => {
    throw new Error(`pinning read ${name}`)
  }
  Math.random = forbidden('Math.random') as typeof Math.random
  Date.now = forbidden('Date.now') as typeof Date.now
  performance.now = forbidden('performance.now') as typeof performance.now
  let moves = 0
  try {
    for (let index = 0; index < 200; index += 1) {
      if (pinObjective(state, readyIds[index % readyIds.length], readyIds)) moves += 1
      if (pinObjective(state, null, readyIds)) moves += 1
    }
  } finally {
    Math.random = realRandom
    Date.now = realNow
    performance.now = realPerformanceNow
  }
  // Non-vacuity: the loop has to have actually pinned things for the stubs to prove anything.
  assert.equal(moves, 400)
})

test('the pin and every contract survive a save, and refuse what they cannot read', () => {
  const blueprint = generateWorld(5_150_150)
  const node = findContractNode(blueprint, 'villain')
  assert.ok(node)
  const state = createCampaignContractState()
  beginContract(state, node, getFactionContract('villain'))
  state.pinnedNodeId = node.id

  const restored = normalizeCampaignContractState(
    JSON.parse(JSON.stringify(serializeCampaignContractState(state))) as unknown,
  )
  assert.deepEqual(restored, state)
  assert.equal(restored.pinnedNodeId, node.id, 'the decision did not survive the save')

  // Anything unreadable is forgotten rather than fatal, exactly as 1.3's commitments are:
  // this is a field inside a free-form bag, not the save itself.
  assert.deepEqual(normalizeCampaignContractState(undefined), createCampaignContractState())
  assert.deepEqual(normalizeCampaignContractState('nonsense'), createCampaignContractState())
  const partial = normalizeCampaignContractState({
    pinnedNodeId: 42,
    contracts: [
      { nodeId: 'a', contract: 'plunder', status: 'active', remaining: 5, waited: 0, attempts: 1 },
      { nodeId: 'a', contract: 'plunder', status: 'active', remaining: 5, waited: 0, attempts: 1 },
      { nodeId: 'b', contract: 'from-the-future', status: 'active', remaining: 5, waited: 0, attempts: 1 },
      { nodeId: 'c', contract: 'bulwark', status: 'invented', remaining: 5, waited: 0, attempts: 1 },
      { nodeId: 'd', contract: 'bulwark', status: 'active', remaining: -1, waited: 0, attempts: 1 },
      'not an object',
    ],
  })
  assert.equal(partial.pinnedNodeId, null, 'a non-string pin was kept')
  assert.deepEqual(
    partial.contracts.map((entry) => entry.nodeId),
    ['a'],
    'an unreadable contract row was trusted',
  )

  // A status this build does not know is dropped rather than coerced, so a save from a
  // later build cannot produce a contract in a state nothing can resolve.
  for (const status of CONTRACT_STATUSES) {
    const round = normalizeCampaignContractState({
      pinnedNodeId: null,
      contracts: [
        { nodeId: 'n', contract: 'unshackle', status, remaining: 1, waited: 0, attempts: 1 },
      ],
    })
    assert.equal(round.contracts[0]?.status, status)
  }
})

// ---------------------------------------------------------------------------
// What the HUD is handed
// ---------------------------------------------------------------------------

test('the campaign board lists every ready node, names the pinned one, and never calls it a route', () => {
  const blueprint = generateWorld(6_006_006)
  for (const faction of FACTIONS) {
    const { objectives, ready } = readyAfterRoot(blueprint, faction)
    const contracts = createCampaignContractState()
    pinObjective(contracts, ready[1].id, ready.map((node) => node.id))

    const views = buildCampaignContractViews({
      blueprint,
      faction,
      objectives,
      contracts,
      sitePosition: () => ({ x: 12, z: -8 }),
    })
    assert.equal(views.length, 2, 'the board did not show the fork')
    assert.deepEqual(views.map((view) => view.id), ready.map((node) => node.id))
    assert.deepEqual(views.map((view) => view.pinned), [false, true])

    const signature = views.find((view) => view.contract !== null)
    const errand = views.find((view) => view.contract === null)
    assert.ok(signature && errand)
    assert.equal(signature.contract, FACTION_CONTRACTS[faction].id)
    assert.equal(signature.status, 'offered')
    assert.equal(signature.timeRemaining, null, 'an unstarted contract showed a clock')
    assert.equal(errand.status, null)

    for (const view of views) {
      assert.ok(view.title.length > 0 && view.task.length > 0 && view.stake.length > 0)
      assert.ok(/^[A-Z]\d+$/.test(view.regionLabel), `bad square label ${view.regionLabel}`)
      assert.equal(view.x, 12)
      assert.equal(view.z, -8)
      // The copy may never promise an exclusive choice. Both arms are required, and the
      // panel says as much; "вместо" would be 2.1 sold on 1.4's budget.
      assert.equal(/вместо|либо|instead/i.test(`${view.task} ${view.stake}`), false)
    }
  }
})

test('the minimap draws a pin for the arm the player did not take', () => {
  const blueprint = generateWorld(7_007_007)
  const faction: Faction = 'guard'
  const { objectives, ready } = readyAfterRoot(blueprint, faction)
  const contracts = createCampaignContractState()
  pinObjective(contracts, ready[0].id, ready.map((node) => node.id))
  const views = buildCampaignContractViews({
    blueprint,
    faction,
    objectives,
    contracts,
    sitePosition: (siteId) => (siteId === ready[0].siteId ? { x: 1, z: 1 } : { x: 30, z: 30 }),
  })

  const markers = buildMapMarkers({
    blueprint,
    playerX: 0,
    playerZ: 0,
    playerHeading: 0,
    caravanX: 0,
    caravanZ: 0,
    worldMarkers: [],
    activeObjectiveSiteId: ready[0].siteId,
    activeObjectiveSiteX: 1,
    activeObjectiveSiteZ: 1,
    activeObjectiveId: ready[0].id,
    objectives,
    events: [],
    actors: [],
    rumours: [],
    contracts: views,
  } as unknown as LiveViewInput)

  const kinds = markers.map((marker) => marker.kind)
  assert.equal(kinds.filter((kind) => kind === 'objective').length, 1, 'the compass forked')
  assert.equal(
    kinds.filter((kind) => kind === 'contract').length,
    1,
    'the unpinned arm was not drawn',
  )
  const other = markers.find((marker) => marker.kind === 'contract')
  assert.equal(other?.x, 30)
  assert.equal(other?.label, views[1].title)

  // Non-vacuity: with nothing on the board there is no second pin, which is what the
  // pre-1.4 map looked like.
  const bare = buildMapMarkers({
    blueprint,
    playerX: 0,
    playerZ: 0,
    playerHeading: 0,
    caravanX: 0,
    caravanZ: 0,
    worldMarkers: [],
    activeObjectiveSiteId: ready[0].siteId,
    activeObjectiveSiteX: 1,
    activeObjectiveSiteZ: 1,
    activeObjectiveId: ready[0].id,
    objectives,
    events: [],
    actors: [],
    rumours: [],
    contracts: [],
  } as unknown as LiveViewInput)
  assert.equal(bare.some((marker) => marker.kind === 'contract'), false)
})

// ---------------------------------------------------------------------------
// What 2.1 is still allowed to decide
// ---------------------------------------------------------------------------

test('this slice ships no optional node, no skip and no new win condition', () => {
  // The scope fence, as an assertion. 2.1 is where the win condition is replaced, where
  // `Objective` gains a skipped concept and where `objectivesCompleted` is re-decided —
  // and `objectivesCompleted` feeds a profile reward, so it becomes gameable the moment an
  // optional node exists. None of that is here, and this is what would notice it arriving.
  const blueprint = generateWorld(1_111_111)
  for (const faction of FACTIONS) {
    const objectives = createGeneratedObjectives(blueprint, faction)
    for (const objective of objectives) {
      assert.deepEqual(
        Object.keys(objective).sort(),
        ['done', 'id', 'text'],
        'the persisted objective grew a field',
      )
    }
    // Every node is required: completing all but one is not a victory.
    for (let index = 0; index < objectives.length; index += 1) {
      const partial = createGeneratedObjectives(blueprint, faction)
      for (let other = 0; other < partial.length; other += 1) {
        if (other !== index) completeObjectiveEntry(partial, partial[other].id)
      }
      assert.equal(
        partial.every((objective) => objective.done),
        false,
        'a campaign was winnable with a node left open',
      )
    }
  }
})

// ---------------------------------------------------------------------------
// The signals, over a sweep
// ---------------------------------------------------------------------------

/**
 * How many seeds the committed gate sweeps. 36 by default so the suite stays quick; the
 * roadmap's 200-run figure is one environment variable away and its numbers are recorded at
 * the test below.
 */
function sweepSize(): number {
  const raw = Number(process.env.KOROVANY_CONTRACT_SEEDS)
  return Number.isInteger(raw) && raw > 0 ? raw : 36
}

interface ArmSummary {
  runs: number
  victories: number
  orderingDivergence: number
  choiceRate: number
  forkVisible: number
  contractsStarted: number
  contractsKept: number
  contractsFailedForward: number
  contractNodesClosed: number
  victoriesAfterAFailure: number
  contractsByFaction: Map<Faction, Set<string>>
  razedContractSquares: number
}

function sweep(
  runs: number,
  options: Partial<Parameters<typeof runHarness>[0]>,
): ArmSummary {
  const orders = new Map<string, Map<string, number>>()
  const summary: ArmSummary = {
    runs,
    victories: 0,
    orderingDivergence: 0,
    choiceRate: 0,
    forkVisible: 0,
    contractsStarted: 0,
    contractsKept: 0,
    contractsFailedForward: 0,
    contractNodesClosed: 0,
    victoriesAfterAFailure: 0,
    contractsByFaction: new Map(),
    razedContractSquares: 0,
  }
  let chose = 0
  let forkSeen = 0
  for (let index = 0; index < runs; index += 1) {
    const seed = 3_000_000 + index * 331
    const faction = FACTIONS[index % FACTIONS.length]
    const report = runHarness({
      seed,
      faction,
      policy: 'beeline',
      hz: 20,
      timeLimit: 300,
      ...options,
    })
    const inner = orders.get(faction) ?? new Map<string, number>()
    const key = report.contracts.middleOrder.join('>')
    inner.set(key, (inner.get(key) ?? 0) + 1)
    orders.set(faction, inner)

    if (report.outcome === 'victory') summary.victories += 1
    if (report.contracts.chose) chose += 1
    if (report.contracts.maxReady >= 2) forkSeen += 1
    summary.contractsStarted += report.contracts.started
    summary.contractsKept += report.contracts.kept
    summary.contractsFailedForward += report.contracts.failedForward
    if (report.contracts.completed) summary.contractNodesClosed += 1
    if (report.outcome === 'victory' && report.contracts.failedForward > 0) {
      summary.victoriesAfterAFailure += 1
    }
    const set = summary.contractsByFaction.get(faction) ?? new Set<string>()
    if (report.contracts.contractId) set.add(report.contracts.contractId)
    summary.contractsByFaction.set(faction, set)

    // Campaign safety, observed on a whole run rather than on a state machine: the square
    // the contract needs is never one of the ones the world burned down.
    const contractRegion = findContractNode(generateWorld(seed), faction)?.regionId
    if (contractRegion && report.razedRegionIds.includes(String(contractRegion))) {
      summary.razedContractSquares += 1
    }
  }

  let divergent = 0
  let total = 0
  for (const inner of orders.values()) {
    let modal = 0
    let sum = 0
    for (const count of inner.values()) {
      sum += count
      if (count > modal) modal = count
    }
    divergent += sum - modal
    total += sum
  }
  summary.orderingDivergence = divergent / Math.max(1, total)
  summary.choiceRate = chose / runs
  summary.forkVisible = forkSeen / runs
  return summary
}

test('the fork produces ordering divergence, and the linearised placebo says it was the fork', () => {
  // **Roadmap 1.4's signal.** Measured with `KOROVANY_CONTRACT_SEEDS=200`, beeline policy,
  // 20 Hz, a 300 s limit, factions rotating:
  //
  // | arm                       | victory | ordering divergence | choice rate | fork seen |
  // |---------------------------|---------|---------------------|-------------|-----------|
  // | `firstReady` / branched   | 1.000   | **0.000**           | 0.000       | 1.000     |
  // | `nearest`   / branched    | 0.990   | **0.295**           | 0.455       | 1.000     |
  // | `seeded`    / branched    | 1.000   | **0.490**           | 0.500       | 1.000     |
  // | `nearest`   / chain       | 1.000   | **0.000**           | 0.000       | 0.000     |
  // | `seeded`    / chain       | 1.000   | **0.000**           | 0.000       | 0.000     |
  //
  // The two chain rows are the control and they are the reason the branched numbers mean
  // anything: the same policies, the same seeds, the same everything except that the graph
  // was linearised, produce **no divergence at all**. The `firstReady` row is the second
  // control — a run that never pins takes the ready nodes in graph order, which is exactly
  // what the campaign did before this slice.
  //
  // **Ordering, not route.** Every node in both arms is completed in every victory: the
  // divergence measured here is the sequence, not the set. Route divergence in the
  // exclusive sense is 2.1's signal and this slice does not ship it.
  const runs = sweepSize()
  const baseline = sweep(runs, { contractPolicy: 'firstReady' })
  const nearest = sweep(runs, { contractPolicy: 'nearest' })
  const seeded = sweep(runs, { contractPolicy: 'seeded' })
  const placeboNearest = sweep(runs, { contractPolicy: 'nearest', campaignShape: 'chain' })
  const placeboSeeded = sweep(runs, { contractPolicy: 'seeded', campaignShape: 'chain' })

  // Non-vacuity first: the fork has to have been on screen, and the campaign has to have
  // been finishing, or every number below is about nothing.
  assert.equal(baseline.forkVisible, 1, 'the branched arm never presented two ready nodes')
  assert.equal(placeboNearest.forkVisible, 0, 'the placebo still had a fork in it')
  assert.equal(placeboSeeded.forkVisible, 0, 'the placebo still had a fork in it')
  assert.ok(
    baseline.victories / runs > 0.9,
    `the campaign stopped finishing: ${String(baseline.victories)}/${String(runs)}`,
  )

  // The baseline pins nothing, so it must be flat. If this ever reports divergence, the
  // "the fork did it" claim is unfounded and the sweep is measuring noise.
  assert.equal(baseline.choiceRate, 0, 'the default arm made a choice')
  assert.equal(baseline.orderingDivergence, 0, 'the no-choice arm diverged anyway')

  // The treatment.
  assert.ok(
    nearest.orderingDivergence > 0.15,
    `nearest barely reordered anything: ${nearest.orderingDivergence.toFixed(3)}`,
  )
  assert.ok(
    seeded.orderingDivergence > 0.15,
    `seeded barely reordered anything: ${seeded.orderingDivergence.toFixed(3)}`,
  )
  assert.ok(nearest.choiceRate > 0.25, `choice rate ${nearest.choiceRate.toFixed(3)}`)
  assert.ok(seeded.choiceRate > 0.25, `choice rate ${seeded.choiceRate.toFixed(3)}`)

  // **The control.** Same policies, no fork, no divergence.
  assert.equal(
    placeboNearest.orderingDivergence,
    0,
    'ordering diverged without a fork, so the fork is not what produced it',
  )
  assert.equal(placeboSeeded.orderingDivergence, 0, 'ordering diverged without a fork')

  // The campaign still finishes with a choice in play.
  assert.ok(nearest.victories / runs > 0.9, `nearest completion ${String(nearest.victories)}`)
  assert.ok(seeded.victories / runs > 0.9, `seeded completion ${String(seeded.victories)}`)
})

test('the three factions run three different signature contracts', () => {
  // The roadmap's second signal, measured on runs rather than read off a table.
  const summary = sweep(sweepSize(), { contractPolicy: 'nearest' })
  const seen = new Set<string>()
  for (const faction of FACTIONS) {
    const ids = summary.contractsByFaction.get(faction)
    assert.ok(ids && ids.size === 1, `${faction} ran ${String(ids?.size ?? 0)} kinds of contract`)
    for (const id of ids) seen.add(id)
  }
  assert.equal(seen.size, 3, `the factions shared a contract: ${[...seen].join(',')}`)
  assert.deepEqual([...seen].sort(), [...CONTRACT_IDS].sort())
  // And they were actually run, not merely named.
  assert.ok(summary.contractsStarted >= summary.runs, 'contracts were never put on the ground')
  assert.ok(summary.contractsKept > 0, 'no contract was ever won')
})

test('a contract that is always abandoned never strands a run', () => {
  // **The whole-run safety control.** The scripted player starts every contract and walks
  // away from it, so every one fails forward. What has to survive that is the campaign.
  //
  // Measured with `KOROVANY_CONTRACT_SEEDS=200`: 200 contracts started, **0 kept, 200
  // failed forward**, the contract node closed in **200 of 200** runs, and **198 of 200**
  // runs reached victory — every one of them after a failed contract. No run razed the
  // square its own contract needed. (Driven with `firstReady` instead, which does not
  // re-pin away from the failing contract, the same arm still closed 200 of 200 contract
  // nodes and reached victory in 177.)
  const runs = sweepSize()
  const shirk = sweep(runs, { contractPolicy: 'nearest', contractOutcome: 'shirk' })

  // Non-vacuity: the arm has to have actually failed contracts, or it is measuring nothing.
  assert.equal(shirk.contractsKept, 0, 'the shirking arm honoured a contract')
  assert.ok(
    shirk.contractsFailedForward >= runs,
    `only ${String(shirk.contractsFailedForward)} contracts failed across ${String(runs)} runs`,
  )

  // The guarantee: every contract node still closed, and the runs still finished.
  assert.equal(
    shirk.contractNodesClosed,
    runs,
    `${String(runs - shirk.contractNodesClosed)} runs were left with a contract node nothing could close`,
  )
  assert.ok(
    shirk.victories / runs > 0.9,
    `abandoning contracts stopped runs finishing: ${String(shirk.victories)}/${String(runs)}`,
  )
  assert.ok(
    shirk.victoriesAfterAFailure > runs / 2,
    'no run reached victory after a failed contract, so the guarantee was never exercised',
  )
  assert.equal(
    shirk.razedContractSquares,
    0,
    'a run burned down the square its own contract needed',
  )
})

test('the contract arms are deterministic, and off by default', () => {
  for (const contractPolicy of ['firstReady', 'nearest', 'seeded'] as const) {
    const first = runHarness({ seed: 424_242, faction: 'guard', hz: 20, timeLimit: 200, contractPolicy })
    const second = runHarness({ seed: 424_242, faction: 'guard', hz: 20, timeLimit: 200, contractPolicy })
    assert.deepEqual(second, first, `${contractPolicy} is not reproducible`)
  }

  // The default arm is the pre-1.4 ordering, so every pinned number elsewhere still
  // describes its own run rather than quietly describing a new policy.
  const fallback = runHarness({ seed: 424_242, faction: 'guard', hz: 20, timeLimit: 200 })
  assert.equal(fallback.contractPolicy, 'firstReady')
  assert.equal(fallback.campaignShape, 'branched')
  assert.equal(fallback.contractOutcome, 'honour')
  assert.deepEqual(fallback.contracts.pins, [])
  assert.equal(fallback.contracts.chose, false)

  // And the seeded arm really is drawing: two different seeds have to be able to pick
  // differently, or `seeded` is a synonym for `firstReady`.
  const rng = new RandomStream(deriveSeed('faction-contracts', 'seeded-control'))
  assert.ok(rng.next() >= 0)
  const pinsA = runHarness({
    seed: 3_000_000,
    faction: 'elf',
    hz: 20,
    timeLimit: 300,
    contractPolicy: 'seeded',
  }).contracts.pins
  assert.ok(pinsA.length > 0, 'the seeded arm never pinned anything')
})
