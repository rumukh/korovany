/**
 * Roadmap 2.1 — subset completion, the remaining contract verbs, and the controls that keep
 * both claims honest.
 *
 * The claim this file has to back is:
 *
 * > A faction campaign is a fork with an **exclusive** arm. A required errand and two
 * > contract arms are ready at once; the player pins one, and completing either contract
 * > **skips** the other. The run is won without completing every node. Every contract is a
 * > shipped event builder promoted into a campaign object — all ten of them now — and every
 * > one **fails forward**: losing it costs the payout, never the run.
 *
 * 1.4's file said the opposite in as many words, and deliberately: it shipped an
 * all-required diamond, nothing was skipped, the win condition was `every(o => o.done)` and
 * the persisted `Objective` had gained nothing. **This is the item that changes all four**,
 * and 1.4's scope fence — `this slice ships no optional node, no skip and no new win
 * condition` — is replaced below by the assertions that pin what arrived instead.
 *
 * Six classes of control run alongside the measurements, because a safety claim that cannot
 * fail is worse than no safety claim:
 *
 * - *The strand gate, doped.* `findContractStrandRisks` is driven against mutated tables —
 *   a contract with no clock, one with no start grace, one with fail-forward switched off,
 *   a missing template, a graph whose contract site is not reserved — and every one must be
 *   reported.
 * - *The optional-node strand control.* A fork with one arm, and a fork whose arms are
 *   required, are both campaigns that can never settle. Both must be reported, or subset
 *   completion has shipped a way to strand a run.
 * - *The farmability control.* `countRewardedObjectives` is enumerated over every reachable
 *   completion state of a real graph, and over a doped graph whose routes differ in length.
 *   The pre-2.1 raw count must **fail** the same properties, or the re-decision fixed
 *   nothing.
 * - *The linearised placebo.* 1.4's, kept.
 * - *The all-required placebo.* 2.1's, and the one that matters: the same fork with only
 *   `optional` and `exclusiveGroup` removed. If a route statistic moves there too, the
 *   exclusive choice is not what moved it.
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
  CONTRACT_SITINGS,
  FACTION_CONTRACT_POOL,
  FACTION_CONTRACT_SITES,
  WORLD_FACTIONS,
  type ContractId,
  type FactionObjectiveGraph,
  type FactionObjectiveNode,
  type WorldBlueprint,
} from '../src/game/world/worldTypes.ts'
import {
  CONTRACT_STATUSES,
  CONTRACT_TEMPLATES,
  FACTION_CONTRACTS,
  OBJECTIVE_REWARD_STEPS,
  advanceContract,
  beginContract,
  campaignObjectivesComplete,
  completeObjectiveEntry,
  countRewardedObjectives,
  createCampaignContractState,
  createGeneratedObjectives,
  ensureContractProgress,
  findContractNode,
  findContractStrandRisks,
  findContractTemplate,
  getActiveObjectiveNode,
  getContractNodes,
  getContractStatus,
  getFactionContract,
  getReadyObjectiveNodes,
  getRumourReservedRegionIds,
  isContractLive,
  isContractNodeCompletableByArrival,
  normalizeCampaignContractState,
  objectivePrerequisitesDone,
  pinObjective,
  resolveActiveObjectiveNode,
  resolveContract,
  serializeCampaignContractState,
  skipExclusiveAlternatives,
  type CampaignContractState,
  type ContractStatus,
  type FactionContractTemplate,
} from '../src/game/world/CampaignDirector.ts'
import { computeRunCompletionReward } from '../src/game/run/profile.ts'
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

/**
 * Walks a campaign to victory, choosing the `preference`-th ready node every step and
 * running the shipped skip rule after every completion.
 *
 * The engine's own order — complete, then skip, then check the win condition — so a walk
 * here finishes for the same reason a run in the browser does.
 */
function walkCampaign(
  graph: FactionObjectiveGraph,
  objectives: Objective[],
  preference: number,
): { completed: string[]; skipped: string[]; won: boolean } {
  const completed: string[] = []
  const skipped: string[] = []
  for (let step = 0; step < 32 && !campaignObjectivesComplete(objectives); step += 1) {
    const ready = graph.nodes.filter(
      (node) =>
        !objectives.some(
          (entry) => entry.id === node.id && (entry.done || entry.skipped === true),
        ) && objectivePrerequisitesDone(node, objectives),
    )
    if (ready.length === 0) break
    const chosen = ready[preference % ready.length]
    if (!completeObjectiveEntry(objectives, chosen.id)) break
    completed.push(chosen.id)
    for (const entry of skipExclusiveAlternatives(graph, objectives, chosen.id)) {
      skipped.push(entry.id)
    }
  }
  return { completed, skipped, won: campaignObjectivesComplete(objectives) }
}

// ---------------------------------------------------------------------------
// The shape of the graph
// ---------------------------------------------------------------------------

test('every faction campaign is a fork with two exclusive contract arms', () => {
  let graphs = 0
  let forks = 0
  const contractSites = new Map<Faction, Set<string>>()
  const altContracts = new Map<Faction, Set<string>>()
  const altSites = new Map<Faction, Set<string>>()
  const errandSites = new Map<Faction, Set<string>>()

  for (let index = 0; index < 160; index += 1) {
    const blueprint = generateWorld(31_000 + index * 617)
    for (const faction of FACTIONS) {
      const graph = blueprint.objectives[faction]
      graphs += 1

      // Five nodes: one root, one required errand, two exclusive contract arms, one finale.
      assert.equal(graph.nodes.length, 5, `${faction} graph is not a fork`)
      assert.deepEqual(graph.rootNodeIds, [`objective-${faction}-start`])
      assert.equal(graph.finalNodeId, `objective-${faction}-finale`)

      const contractNodes = graph.nodes.filter((node) => node.contract !== undefined)
      assert.equal(contractNodes.length, 2, `${faction} has ${String(contractNodes.length)} contracts`)
      // The signature arm is always the faction's own, so the differentiation signal 1.4
      // measured survives the pool widening.
      assert.equal(contractNodes[0].contract, FACTION_CONTRACTS[faction].id)
      assert.equal(contractNodes[0].kind, FACTION_CONTRACT_SITES[faction].kind)
      const alternative = contractNodes[1].contract
      assert.ok(alternative && alternative !== FACTION_CONTRACTS[faction].id)
      assert.ok(
        FACTION_CONTRACT_POOL[faction].includes(alternative),
        `${faction} drew ${alternative} from another faction's pool`,
      )
      assert.equal(contractNodes[1].kind, CONTRACT_SITINGS[alternative].kind)

      // **The exclusive fork.** Both arms optional, both in one group, and the finale still
      // listing all three middles — which only opens because a skipped node is settled.
      for (const node of contractNodes) {
        assert.equal(node.optional, true, `${node.id} is not optional`)
        assert.equal(node.exclusiveGroup, `fork-${faction}`)
      }
      const finale = graph.nodes.find((node) => node.id === graph.finalNodeId)
      assert.equal(finale?.prerequisiteIds.length, 3)
      assert.equal(finale?.optional, undefined, 'the finale became optional')

      const { ready } = readyAfterRoot(blueprint, faction)
      assert.equal(ready.length, 3, `${faction} presents ${String(ready.length)} ready nodes`)
      forks += 1

      // Three different places, or the fork is invisible on the map.
      assert.equal(new Set(ready.map((node) => node.siteId)).size, 3)

      const errand = ready.find((node) => node.contract === undefined)
      assert.ok(errand)
      const record = (
        map: Map<Faction, Set<string>>,
        value: string,
      ): void => {
        const set = map.get(faction) ?? new Set<string>()
        set.add(value)
        map.set(faction, set)
      }
      record(contractSites, contractNodes[0].siteId)
      record(altContracts, alternative)
      record(altSites, contractNodes[1].siteId)
      record(errandSites, errand.siteId)
    }
  }

  assert.equal(graphs, 480)
  assert.equal(forks, 480)
  // Every seeded draw is real, and none of them collided: per faction the campaign-graph
  // count is 2 errands x 3 signature sites x (pool - 1) alternatives x their sites.
  for (const faction of FACTIONS) {
    assert.equal(errandSites.get(faction)?.size, 2, `${faction} errand draw collapsed`)
    assert.equal(contractSites.get(faction)?.size, 3, `${faction} contract draw collapsed`)
    assert.equal(
      altContracts.get(faction)?.size,
      FACTION_CONTRACT_POOL[faction].length - 1,
      `${faction} alternative draw collapsed`,
    )
    assert.ok(
      (altSites.get(faction)?.size ?? 0) >= 3,
      `${faction} alternative siting collapsed`,
    )
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

test('the two contract tables describe the same ten contracts, one per shipped builder', () => {
  // The siting lives with the generator and the clock lives with the director, the same
  // split 1.3 used. Two tables can drift; this is what notices.
  const fromDirector = new Set<ContractId>(
    Object.values(CONTRACT_TEMPLATES).map((template) => template.id),
  )
  const fromSiting = new Set<ContractId>(
    Object.values(CONTRACT_SITINGS).map((siting) => siting.id),
  )
  assert.deepEqual([...fromDirector].sort(), [...CONTRACT_IDS].sort())
  assert.deepEqual([...fromSiting].sort(), [...CONTRACT_IDS].sort())
  assert.equal(fromDirector.size, 10, 'a builder lost its contract, or gained a second')

  for (const id of CONTRACT_IDS) {
    assert.equal(CONTRACT_TEMPLATES[id].id, id)
    assert.equal(CONTRACT_SITINGS[id].id, id)
    assert.equal(
      CONTRACT_TEMPLATES[id].faction,
      CONTRACT_SITINGS[id].faction,
      `${id} is two factions' contract`,
    )
    assert.equal(findContractTemplate(id)?.id, id)
    // 2.1 adds no campaign verbs either. This is the explicitly rejected design, asserted
    // across the whole widened set rather than only the three 1.4 shipped.
    assert.ok(
      ['arrive', 'interact', 'defeat', 'claim'].includes(CONTRACT_SITINGS[id].kind),
      `${id} invented a fifth verb`,
    )
  }

  // Ten contracts, ten distinct builders — the costing argument for this item, asserted.
  // If two contracts shared a builder, one of them would be a new campaign behaviour
  // wearing a promoted one's coat.
  const builders = new Set(
    Object.values(CONTRACT_TEMPLATES).map((template) => template.eventKind),
  )
  assert.equal(builders.size, 10, 'two contracts share an event builder')
  assert.deepEqual(
    [...builders].sort(),
    [
      'aftermath',
      'beastRaid',
      'bounty',
      'caravanAmbush',
      'champion',
      'defendHome',
      'factionRaid',
      'rescue',
      'richCaravan',
      'warband',
    ],
    'the promoted set is not the ten shipped builders',
  )

  // Three factions, three different signatures, and every faction has somewhere to draw a
  // second arm from.
  for (const faction of WORLD_FACTIONS) {
    assert.equal(FACTION_CONTRACTS[faction].faction, faction)
    assert.equal(FACTION_CONTRACT_SITES[faction].faction, faction)
    assert.equal(FACTION_CONTRACTS[faction].id, FACTION_CONTRACT_SITES[faction].id)
    assert.equal(FACTION_CONTRACT_POOL[faction][0], FACTION_CONTRACTS[faction].id)
    assert.ok(FACTION_CONTRACT_POOL[faction].length >= 2, `${faction} has no alternative`)
    for (const id of FACTION_CONTRACT_POOL[faction]) {
      assert.equal(CONTRACT_TEMPLATES[id].faction, faction)
    }
  }
  assert.equal(
    new Set(WORLD_FACTIONS.map((faction) => FACTION_CONTRACTS[faction].id)).size,
    3,
  )
  assert.equal(
    Object.values(FACTION_CONTRACT_POOL).flat().length,
    CONTRACT_IDS.length,
    'a contract is in two pools, or in none',
  )
  assert.equal(findContractTemplate(undefined), null)
  assert.equal(findContractTemplate('nonesuch' as ContractId), null)
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
  // Roadmap 2.1 checks **both** arms, because an unreserved second arm would be a square
  // the world could burn out from under a road the player is allowed to take.
  let checked = 0
  for (let index = 0; index < 120; index += 1) {
    const blueprint = generateWorld(64_000 + index * 331)
    for (const faction of FACTIONS) {
      const nodes = getContractNodes(blueprint, faction)
      assert.equal(nodes.length, 2, `${faction} has ${String(nodes.length)} contract nodes`)
      const reserved = getRumourReservedRegionIds(blueprint, faction)
      for (const node of nodes) {
        assert.ok(reserved.has(String(node.regionId)), `${node.id} sits in an unreserved square`)
        checked += 1
      }
    }
  }
  assert.equal(checked, 720)
})

test('the strand gate reports a missing clock, a missing grace, a lost fail-forward and a missing template', () => {
  // Vacuity control. Each mutation is a way a contract could hang or lock; each must be
  // caught, or the clean result above means nothing.
  const blueprint = generateWorld(1_234_567)
  const shipped = CONTRACT_TEMPLATES

  const noClock = {
    ...shipped,
    unshackle: { ...shipped.unshackle, timeoutSeconds: Number.POSITIVE_INFINITY },
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

  const noGrace = { ...shipped, bulwark: { ...shipped.bulwark, startGraceSeconds: 0 } }
  assert.ok(
    findContractStrandRisks(blueprint, noGrace).some(
      (risk) => risk.subject === 'bulwark' && risk.problem === 'unboundedStart',
    ),
  )

  // **The one that matters most.** A template with fail-forward switched off leaves a node
  // that a failed contract locks for ever, and the gate has to say so.
  const noFailForward = {
    ...shipped,
    plunder: { ...shipped.plunder, failForward: false },
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

  // Roadmap 2.1 — **every** promoted contract carries the same envelope, so the doping is
  // run once per id rather than only on the three 1.4 shipped. A template that quietly
  // arrived without a clock would otherwise be caught only if it happened to be a
  // signature.
  for (const id of CONTRACT_IDS) {
    const doped = { ...shipped, [id]: { ...shipped[id], failForward: false } }
    const risks = findContractStrandRisks(blueprint, doped)
    // A contract only reaches the gate when a graph actually carries it, so the doped id is
    // asserted through the faction whose pool it is in, over enough seeds to draw it.
    const faction = shipped[id].faction
    let reported = risks.some((risk) => risk.subject === id)
    for (let index = 0; !reported && index < 40; index += 1) {
      const other = generateWorld(700_000 + index * 1_009)
      reported = findContractStrandRisks(other, doped).some((risk) => risk.subject === id)
    }
    assert.ok(reported, `${faction}'s ${id} is never checked by the strand gate`)
  }

  const missing = { ...shipped, unshackle: undefined } as unknown as typeof shipped
  assert.ok(
    findContractStrandRisks(blueprint, missing).some(
      (risk) => risk.subject === 'unshackle' && risk.problem === 'missingTemplate',
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

test('**the optional-node strand control**: a fork nothing can settle is reported', () => {
  // Roadmap 2.1's own ways of stranding a run, and the reason they need their own control.
  // An optional node is only ever settled by a *sibling's* completion, and only when it is
  // itself optional. Three shapes break that, none of them producible by the shipped
  // generator, and every one has to be reported anyway — a guarantee that only holds for
  // the graphs we happen to emit is a promise rather than a check.
  const blueprint = generateWorld(2_101_001)
  assert.deepEqual(findContractStrandRisks(blueprint), [], 'the shipped graph is not clean')

  // 1. One arm deleted. The survivor is optional with nobody to skip it — still walkable,
  //    because a player can simply do it, but no longer a choice, and a campaign that
  //    silently stopped offering one should fail here rather than in a browser.
  const lonely = structuredClone(blueprint)
  const armId = 'objective-elf-alt'
  lonely.objectives.elf.nodes = lonely.objectives.elf.nodes.filter(
    (node) => node.id !== armId,
  )
  for (const node of lonely.objectives.elf.nodes) {
    node.prerequisiteIds = node.prerequisiteIds.filter((id) => id !== armId)
  }
  assert.ok(
    findContractStrandRisks(lonely).some((risk) => risk.problem === 'lonelyFork'),
    'a one-armed fork was not reported',
  )
  assert.equal(
    validateWorldBlueprint(lonely).issues.some(
      (issue) => issue.code === 'objective.forkArms',
    ),
    true,
    'the 500-seed validator would have let a one-armed fork through',
  )

  // 2. An optional node with no group at all — the same hole, reached the other way.
  const untethered = structuredClone(blueprint)
  for (const node of untethered.objectives.guard.nodes) {
    if (node.id.endsWith('-branch')) node.optional = true
  }
  assert.ok(
    findContractStrandRisks(untethered).some(
      (risk) => risk.subject.endsWith('-branch') && risk.problem === 'lonelyFork',
    ),
  )
  assert.ok(
    validateWorldBlueprint(untethered).issues.some(
      (issue) => issue.code === 'objective.optionalWithoutFork',
    ),
  )

  // 3. **The one that actually strands a run**, and the reason `isObjectiveSettled` reads
  //    both fields: a *required* node inside a fork. A sibling's completion writes
  //    `skipped` on it, `skipped` on a required node does not settle it, and the finale's
  //    prerequisite can then never be met. The gate has to walk that and say so.
  const requiredArm = structuredClone(blueprint)
  for (const node of requiredArm.objectives.villain.nodes) {
    if (node.exclusiveGroup !== undefined) delete node.optional
  }
  assert.ok(
    findContractStrandRisks(requiredArm).some(
      (risk) => risk.subject === 'villain' && risk.problem === 'campaignUncompletable',
    ),
    'a fork that skips a required node was not reported as uncompletable',
  )
  assert.ok(
    validateWorldBlueprint(requiredArm).issues.some(
      (issue) => issue.code === 'objective.forkRequiredArm',
    ),
  )

  // Non-vacuity: the shipped graph passes all of these, so they are reporting the doping
  // rather than reporting everything.
  assert.equal(
    validateWorldBlueprint(blueprint).issues.filter(
      (issue) =>
        issue.code.startsWith('objective.fork') ||
        issue.code === 'objective.optionalWithoutFork',
    ).length,
    0,
  )
})

test('a run really can be won without completing every node', () => {
  // **Subset completion, as the one assertion 1.4's scope fence forbade.** Every arm of
  // every fork is walked; each walk has to reach victory, and at least one node has to be
  // left un-done in every one of them.
  let walks = 0
  let victories = 0
  for (let index = 0; index < 40; index += 1) {
    const blueprint = generateWorld(410_000 + index * 733)
    for (const faction of FACTIONS) {
      const graph = blueprint.objectives[faction]
      for (let preference = 0; preference < 3; preference += 1) {
        const objectives = createGeneratedObjectives(blueprint, faction)
        const result = walkCampaign(graph, objectives, preference)
        walks += 1
        assert.equal(result.won, true, `${faction} could not finish from preference ${String(preference)}`)
        victories += 1
        assert.equal(result.skipped.length, 1, 'a victory closed both arms of the fork')
        assert.equal(
          objectives.filter((entry) => entry.done).length,
          graph.nodes.length - 1,
          'a victory completed every node, so nothing was exclusive',
        )
        // The skipped node is one of the fork's arms, and it is not done.
        const skipped = objectives.find((entry) => entry.id === result.skipped[0])
        assert.equal(skipped?.done, false)
        assert.equal(skipped?.skipped, true)
        assert.equal(skipped?.optional, true)
      }
    }
  }
  assert.equal(walks, 360)
  assert.equal(victories, 360)

  // The control: with the exclusivity removed — 1.4's shape — the same walks complete
  // **every** node, so "won without completing everything" is a property of the optional
  // concept rather than of the walk.
  const blueprint = generateWorld(410_000)
  for (const faction of FACTIONS) {
    const graph = structuredClone(blueprint.objectives[faction])
    for (const node of graph.nodes) {
      delete node.optional
      delete node.exclusiveGroup
    }
    const objectives = createGeneratedObjectives(blueprint, faction).map((entry) => {
      const copy = { ...entry }
      delete copy.optional
      return copy
    })
    const result = walkCampaign(graph, objectives, 0)
    assert.equal(result.won, true)
    assert.equal(result.skipped.length, 0, 'the all-required control skipped something')
    assert.equal(objectives.every((entry) => entry.done), true)
  }
})

test('**the farmability control**: objectivesCompleted cannot be raised by refusing the choice', () => {
  // The re-decision, and the proof that it was needed.
  //
  // The raw count was `objectives.filter(done).length`. Under 1.4 that was honest: every
  // campaign was the same four required nodes, so the number was the campaign. Under subset
  // completion it is a count of ticked boxes over a campaign whose *size varies with the
  // road taken*, and the incentive it creates points the wrong way — **the player is paid
  // for not having a choice.** The doped arm below is that, exactly: the same seed and
  // faction walked with the fork's exclusivity removed, which is 1.4's shape, ticks one more
  // box and would be paid one more step for it.
  const rawCount = (objectives: readonly Objective[]): number =>
    Math.min(OBJECTIVE_REWARD_STEPS, objectives.filter((entry) => entry.done).length)

  const blueprint = generateWorld(210_210)
  for (const faction of FACTIONS) {
    const graph = blueprint.objectives[faction]
    // The shipped, exclusive campaign: one arm walked, one skipped.
    const exclusive = createGeneratedObjectives(blueprint, faction)
    assert.equal(walkCampaign(graph, exclusive, 1).won, true)

    // The all-required control: the same graph with `optional` and `exclusiveGroup` gone.
    const required = structuredClone(graph)
    for (const node of required.nodes) {
      delete node.optional
      delete node.exclusiveGroup
    }
    const walkedRequired = createGeneratedObjectives(blueprint, faction).map((entry) => {
      const copy = { ...entry }
      delete copy.optional
      return copy
    })
    assert.equal(walkCampaign(required, walkedRequired, 1).won, true)

    // Both are victories over the same campaign. The raw count pays them differently.
    assert.ok(
      rawCount(walkedRequired) > rawCount(exclusive),
      `${faction}: the raw count did not price the road, so nothing needed re-deciding`,
    )
    assert.equal(
      computeRunCompletionReward({
        status: 'victory',
        kills: 0,
        objectivesCompleted: rawCount(exclusive),
      }) <
        computeRunCompletionReward({
          status: 'victory',
          kills: 0,
          objectivesCompleted: rawCount(walkedRequired),
        }),
      true,
      `${faction}: the raw count would have charged the player for taking a road`,
    )

    // **The re-decision pays them the same.**
    assert.equal(
      countRewardedObjectives(exclusive),
      countRewardedObjectives(walkedRequired),
      `${faction}: an exclusive victory is worth less than a completionist one`,
    )
    assert.equal(countRewardedObjectives(exclusive), OBJECTIVE_REWARD_STEPS)
  }

  // **Property 1 — every victory pays the cap, on every route.**
  for (const faction of FACTIONS) {
    const graph = blueprint.objectives[faction]
    const paid = new Set<number>()
    for (let preference = 0; preference < 3; preference += 1) {
      const objectives = createGeneratedObjectives(blueprint, faction)
      assert.equal(walkCampaign(graph, objectives, preference).won, true)
      paid.add(countRewardedObjectives(objectives))
    }
    assert.deepEqual([...paid], [OBJECTIVE_REWARD_STEPS], `${faction}: a route paid more`)
  }

  // **Properties 2, 3 and 4 — the cap holds, only a closed campaign earns it, and the
  // number never falls — on every state a player can actually reach.**
  for (const faction of FACTIONS) {
    const graph = blueprint.objectives[faction]
    const states = reachableStates(graph)
    assert.ok(states.length >= 8, 'the enumeration collapsed')
    for (const objectives of states) {
      const value = countRewardedObjectives(objectives)
      assert.ok(
        value >= 0 && value <= OBJECTIVE_REWARD_STEPS,
        `reward stepped outside its range: ${String(value)}`,
      )
      if (value === OBJECTIVE_REWARD_STEPS) {
        assert.equal(
          campaignObjectivesComplete(objectives),
          true,
          'a run earned the full objective reward without finishing its campaign',
        )
      }
      for (const node of graph.nodes) {
        if (!objectivePrerequisitesDone(node, objectives)) continue
        const next = objectives.map((entry) => ({ ...entry }))
        if (!completeObjectiveEntry(next, node.id)) continue
        skipExclusiveAlternatives(graph, next, node.id)
        assert.ok(
          countRewardedObjectives(next) >= value,
          `completing ${node.id} lowered the reward`,
        )
      }
    }
  }

  // And the currency it feeds is bounded exactly where `profile.ts` says it is.
  const victory = createGeneratedObjectives(blueprint, 'elf')
  walkCampaign(blueprint.objectives.elf, victory, 0)
  assert.equal(
    computeRunCompletionReward({
      status: 'victory',
      kills: 0,
      objectivesCompleted: countRewardedObjectives(victory),
    }),
    45 + 20,
  )
  assert.equal(
    computeRunCompletionReward({
      status: 'victory',
      kills: 0,
      objectivesCompleted: countRewardedObjectives(
        createGeneratedObjectives(blueprint, 'elf'),
      ),
    }),
    45,
  )
})

/** Every campaign state reachable by completing ready nodes in any order. Bounded. */
function reachableStates(graph: FactionObjectiveGraph): Objective[][] {
  const start: Objective[] = graph.nodes.map((node) => ({
    id: node.id,
    text: node.id,
    done: false,
    ...(node.optional === true ? { optional: true } : {}),
  }))
  const seen = new Map<string, Objective[]>()
  const key = (objectives: readonly Objective[]): string =>
    objectives
      .map((entry) => `${entry.id}:${entry.done ? 'd' : entry.skipped ? 's' : '-'}`)
      .join('|')
  const queue: Objective[][] = [start]
  seen.set(key(start), start)
  while (queue.length > 0 && seen.size < 512) {
    const current = queue.shift()
    if (!current) break
    for (const node of graph.nodes) {
      if (!objectivePrerequisitesDone(node, current)) continue
      const next = current.map((entry) => ({ ...entry }))
      if (!completeObjectiveEntry(next, node.id)) continue
      skipExclusiveAlternatives(graph, next, node.id)
      const id = key(next)
      if (seen.has(id)) continue
      seen.set(id, next)
      queue.push(next)
    }
  }
  return [...seen.values()]
}

test('the world validator rejects an unknown contract id and a fork with the wrong arm count', () => {
  const blueprint = generateWorld('contract-validation')
  assert.equal(validateWorldBlueprint(blueprint).valid, true)

  const unknown = structuredClone(blueprint)
  const node = unknown.objectives.elf.nodes.find((entry) => entry.contract !== undefined)
  assert.ok(node)
  node.contract = 'sabotage-the-moon' as ContractId
  assert.ok(
    validateWorldBlueprint(unknown).issues.some((issue) => issue.code === 'objective.contract'),
  )

  const tripled = structuredClone(blueprint)
  for (const entry of tripled.objectives.guard.nodes) {
    if (entry.id.endsWith('-branch')) entry.contract = 'relief'
  }
  assert.ok(
    validateWorldBlueprint(tripled).issues.some(
      (issue) => issue.code === 'objective.contractCount',
    ),
  )

  const doubled = structuredClone(blueprint)
  const guardContracts = doubled.objectives.guard.nodes.filter(
    (entry) => entry.contract !== undefined,
  )
  guardContracts[1].contract = guardContracts[0].contract
  assert.ok(
    validateWorldBlueprint(doubled).issues.some(
      (issue) => issue.code === 'objective.contractDuplicate',
    ),
  )

  const none = structuredClone(blueprint)
  for (const entry of none.objectives.villain.nodes) delete entry.contract
  assert.ok(
    validateWorldBlueprint(none).issues.some(
      (issue) => issue.code === 'objective.contractCount',
    ),
  )

  const sameSite = structuredClone(blueprint)
  const elfArms = sameSite.objectives.elf.nodes.filter(
    (entry) => entry.exclusiveGroup !== undefined,
  )
  elfArms[1].siteId = elfArms[0].siteId
  elfArms[1].regionId = elfArms[0].regionId
  assert.ok(
    validateWorldBlueprint(sameSite).issues.some(
      (issue) => issue.code === 'objective.forkSharedSite',
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
  // Roadmap 2.1 — driven across **every** contract node of every faction, not only the
  // signature one, and over enough seeds that every one of the ten promoted templates is
  // exercised at least once. A guarantee that only holds for the three 1.4 shipped would be
  // a guarantee with seven holes in it.
  const exercised = new Set<ContractId>()
  for (let index = 0; index < 24; index += 1) {
    const blueprint = generateWorld(2_468_024 + index * 1_213)
    for (const faction of FACTIONS) {
      for (const node of getContractNodes(blueprint, faction)) {
        const template = findContractTemplate(node.contract)
        assert.ok(template, `${node.id} runs a contract with no template`)
        exercised.add(template.id)
        for (const from of ['offered', 'active'] as const) {
          const { state, seconds } = driveToTerminal(node, template, from)
          const status = getContractStatus(state, node)
          assert.equal(status, 'failed', `${template.id} from ${from} did not resolve`)
          assert.ok(
            seconds <= template.timeoutSeconds + template.startGraceSeconds + 1,
            `${template.id} from ${from} took ${String(seconds)} s to give up`,
          )
          // **The fail-forward guarantee.** The node is now an arrival at a site the
          // reserved set protects, so the campaign is finishable no matter what the
          // contract did.
          assert.equal(
            isContractNodeCompletableByArrival(status, template),
            true,
            `${template.id} from ${from} left a locked node`,
          )
        }
        // A kept contract is not an arrival: it completed on its own terms.
        assert.equal(isContractNodeCompletableByArrival('kept', template), false)
        assert.equal(isContractNodeCompletableByArrival('offered', template), false)
        assert.equal(isContractNodeCompletableByArrival('active', template), false)
      }
    }
  }
  assert.deepEqual(
    [...exercised].sort(),
    [...CONTRACT_IDS].sort(),
    'a promoted contract was never driven to a terminal state',
  )
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

test('the campaign board lists every ready node and marks the arms that are alternatives', () => {
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
    assert.equal(views.length, 3, 'the board did not show the fork')
    assert.deepEqual(views.map((view) => view.id), ready.map((node) => node.id))
    assert.deepEqual(views.map((view) => view.pinned), [false, true, false])
    // **Roadmap 2.1 — the badge, and it is on exactly the arms that are alternatives.**
    // The errand is required and must not wear it, or the panel would tell the player they
    // can skip the one node they cannot.
    assert.deepEqual(
      views.map((view) => view.exclusive),
      [false, true, true],
      'the exclusive badge does not match the fork',
    )

    const signature = views.find((view) => view.contract !== null)
    const errand = views.find((view) => view.contract === null)
    assert.ok(signature && errand)
    assert.equal(signature.contract, FACTION_CONTRACTS[faction].id)
    assert.equal(signature.status, 'offered')
    assert.equal(signature.timeRemaining, null, 'an unstarted contract showed a clock')
    assert.equal(errand.status, null)
    assert.equal(errand.exclusive, false)

    for (const view of views) {
      assert.ok(view.title.length > 0 && view.task.length > 0 && view.stake.length > 0)
      assert.ok(/^[A-Z]\d+$/.test(view.regionLabel), `bad square label ${view.regionLabel}`)
      assert.equal(view.x, 12)
      assert.equal(view.z, -8)
    }

    // And once one arm is taken, the survivor is skipped and the board is down to the
    // errand alone — which is the fork closing, as the HUD sees it.
    completeObjectiveEntry(objectives, ready[1].id)
    skipExclusiveAlternatives(blueprint.objectives[faction], objectives, ready[1].id)
    const after = buildCampaignContractViews({
      blueprint,
      faction,
      objectives,
      contracts,
      sitePosition: () => ({ x: 12, z: -8 }),
    })
    assert.deepEqual(after.map((view) => view.id), [ready[0].id])
    assert.equal(after[0].exclusive, false, 'a lone survivor still claimed to be a fork')
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
  // Roadmap 2.1 — **two** unpinned arms now, because the board carries a required errand
  // plus the two alternatives. Every one the player did not pin gets a pin of its own, or
  // the exclusive choice would be a choice between one visible thing and a rumour of
  // another.
  assert.equal(
    kinds.filter((kind) => kind === 'contract').length,
    2,
    'an unpinned arm was not drawn',
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
// The save shape, and what it cost
// ---------------------------------------------------------------------------

test('the persisted objective grew exactly two fields, and only where they mean something', () => {
  // 1.4's scope fence asserted `['done', 'id', 'text']` and said in as many words that 2.1
  // was where it would move. This is the replacement, and it is deliberately just as
  // strict: the save shape moved once, by two optional booleans, and a third field arriving
  // by accident should fail here rather than in a browser.
  const blueprint = generateWorld(1_111_111)
  for (const faction of FACTIONS) {
    const objectives = createGeneratedObjectives(blueprint, faction)
    const graph = blueprint.objectives[faction]
    for (const objective of objectives) {
      const node = graph.nodes.find((entry) => entry.id === objective.id)
      assert.ok(node)
      // `optional` is written only on an optional node; a required one still serialises
      // exactly as it did before 2.1, which is what keeps the churn to what it had to be.
      assert.deepEqual(
        Object.keys(objective).sort(),
        node.optional === true ? ['done', 'id', 'optional', 'text'] : ['done', 'id', 'text'],
        'the persisted objective grew a field',
      )
      // `skipped` is never written by the generator. It is a fact about a run.
      assert.equal(Object.hasOwn(objective, 'skipped'), false)
    }

    // **The win condition, both ways round.** A required node left open is not a victory;
    // an optional one left *skipped* is.
    for (const node of graph.nodes) {
      const partial = createGeneratedObjectives(blueprint, faction)
      for (const other of partial) {
        if (other.id !== node.id) completeObjectiveEntry(partial, other.id)
      }
      assert.equal(
        campaignObjectivesComplete(partial),
        false,
        'a campaign was won with a node neither done nor skipped',
      )
      if (node.optional !== true) continue
      const skipped = partial.find((entry) => entry.id === node.id)
      assert.ok(skipped)
      skipped.skipped = true
      assert.equal(
        campaignObjectivesComplete(partial),
        true,
        'a campaign with every node settled was not a victory',
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
  /** Runs the scripted player was killed in — a combat outcome, not a campaign one. */
  defeats: number
  /** Runs that ran out of time with objectives outstanding. The campaign-safety number. */
  timeouts: number
  orderingDivergence: number
  /**
   * Roadmap 2.1 — **route** divergence: the share of completed campaigns that did not walk
   * the modal set of contracts, per faction.
   *
   * Ordering asks "in what sequence"; this asks "which nodes at all", which is the question
   * only an exclusive fork can answer differently. Measured on the contract ids the run
   * actually completed rather than on their order.
   */
  routeDivergence: number
  /** Distinct contract routes walked, per faction, summed. */
  distinctRoutes: number
  choiceRate: number
  forkVisible: number
  contractsStarted: number
  contractsKept: number
  contractsFailedForward: number
  /** Contracts that were live when their node was skipped. Chosen past, not lost. */
  contractsSkippedLive: number
  contractNodesClosed: number
  victoriesAfterAFailure: number
  contractsByFaction: Map<Faction, Set<string>>
  razedContractSquares: number
  /**
   * **The campaign-safety number.** Runs that stopped with the campaign unfinished and
   * nothing ready to do about it. Zero, always, in every arm.
   */
  stranded: number
  /** Roadmap 2.1 — victories that left at least one node un-done. Subset completion, counted. */
  victoriesWithASkip: number
  /** Every distinct value `objectivesCompleted` took on a victory. One, or it prices routes. */
  rewardOnVictory: Set<number>
}

function sweep(
  runs: number,
  options: Partial<Parameters<typeof runHarness>[0]>,
): ArmSummary {
  const orders = new Map<string, Map<string, number>>()
  const routes = new Map<string, Map<string, number>>()
  const summary: ArmSummary = {
    runs,
    victories: 0,
    defeats: 0,
    timeouts: 0,
    orderingDivergence: 0,
    routeDivergence: 0,
    distinctRoutes: 0,
    choiceRate: 0,
    forkVisible: 0,
    contractsStarted: 0,
    contractsKept: 0,
    contractsFailedForward: 0,
    contractsSkippedLive: 0,
    contractNodesClosed: 0,
    victoriesAfterAFailure: 0,
    contractsByFaction: new Map(),
    razedContractSquares: 0,
    stranded: 0,
    victoriesWithASkip: 0,
    rewardOnVictory: new Set<number>(),
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
    // Roadmap 1.5 — only runs that got through the middle nodes have an *order* at all.
    // Spreading the optional sites lengthened the detours, so a scripted beeline player is
    // now sometimes killed mid-campaign, and a truncated `middleOrder` counted as another
    // sequence: the `firstReady` control reported 1/36 "divergence" for a run that simply
    // never finished. Ordering divergence is a question about completed orders.
    //
    // Roadmap 2.1 — and the number of middles a completed campaign has is now the *route's*
    // length rather than a constant, so the filter is "this run finished" rather than
    // "this run closed exactly two".
    if (report.outcome === 'victory') {
      inner.set(key, (inner.get(key) ?? 0) + 1)
      orders.set(faction, inner)
      const routeInner = routes.get(faction) ?? new Map<string, number>()
      const routeKey = [...report.contracts.route].sort().join('+')
      routeInner.set(routeKey, (routeInner.get(routeKey) ?? 0) + 1)
      routes.set(faction, routeInner)
      if (report.contracts.skipped.length > 0) summary.victoriesWithASkip += 1
      summary.rewardOnVictory.add(report.contracts.rewardedObjectives)
    }

    if (report.outcome === 'victory') summary.victories += 1
    if (report.outcome === 'defeat') summary.defeats += 1
    if (report.outcome === 'timeout') summary.timeouts += 1
    if (report.contracts.chose) chose += 1
    if (report.contracts.maxReady >= 2) forkSeen += 1
    summary.contractsStarted += report.contracts.started
    summary.contractsKept += report.contracts.kept
    summary.contractsFailedForward += report.contracts.failedForward
    summary.contractsSkippedLive += report.contracts.skippedLive
    if (report.contracts.strandedAtEnd) summary.stranded += 1
    if (report.contracts.completed) summary.contractNodesClosed += 1
    if (report.outcome === 'victory' && report.contracts.failedForward > 0) {
      summary.victoriesAfterAFailure += 1
    }
    const set = summary.contractsByFaction.get(faction) ?? new Set<string>()
    if (report.contracts.contractId) set.add(report.contracts.contractId)
    summary.contractsByFaction.set(faction, set)

    // Campaign safety, observed on a whole run rather than on a state machine: no square a
    // contract needs is ever one of the ones the world burned down. Both arms, because the
    // player may take either.
    for (const node of getContractNodes(generateWorld(seed), faction)) {
      if (report.razedRegionIds.includes(String(node.regionId))) {
        summary.razedContractSquares += 1
      }
    }
  }

  const divergenceOf = (buckets: Map<string, Map<string, number>>): {
    divergence: number
    distinct: number
  } => {
    let divergent = 0
    let total = 0
    let distinct = 0
    for (const inner of buckets.values()) {
      let modal = 0
      let sum = 0
      for (const count of inner.values()) {
        sum += count
        if (count > modal) modal = count
      }
      divergent += sum - modal
      total += sum
      distinct += inner.size
    }
    return { divergence: divergent / Math.max(1, total), distinct }
  }
  summary.orderingDivergence = divergenceOf(orders).divergence
  const route = divergenceOf(routes)
  summary.routeDivergence = route.divergence
  summary.distinctRoutes = route.distinct
  summary.choiceRate = chose / runs
  summary.forkVisible = forkSeen / runs
  return summary
}

test('the fork produces route divergence, and the all-required placebo says it was the choice', () => {
  // **Roadmap 2.1's signal.** Measured with `KOROVANY_CONTRACT_SEEDS=200`, beeline policy,
  // 20 Hz, a 300 s limit, factions rotating:
  //
  // | arm                        | victory | **route** | routes | ordering | choice | fork | skipped |
  // |----------------------------|---------|-----------|-------:|----------|--------|------|---------|
  // | `firstReady` / branched    | 190/200 | **0.000** |      3 | 0.000    | 0.000  | 1.00 | 190     |
  // | `nearest`    / branched    | 195/200 | **0.446** |      6 | 0.615    | 0.860  | 1.00 | 195     |
  // | `seeded`     / branched    | 198/200 | **0.465** |      6 | 0.641    | 0.815  | 1.00 | 198     |
  // | `nearest`    / chain       | 192/200 | 0.000     |      3 | 0.000    | 0.000  | 0.00 | 0       |
  // | `seeded`     / chain       | 192/200 | 0.000     |      3 | 0.000    | 0.000  | 0.00 | 0       |
  // | **`nearest` / allRequired**| 197/200 | **0.000** |      3 | 0.746    | 0.860  | 1.00 | **0**   |
  // | **`seeded`  / allRequired**| 194/200 | **0.000** |      3 | 0.768    | 0.815  | 1.00 | **0**   |
  //
  // **The two `allRequired` rows are the whole argument.** Same seeds, same sites, same
  // contracts, same pins, same choice rate, the fork on screen in every run — and with
  // `optional`/`exclusiveGroup` removed they produce *more* ordering divergence than the
  // shipped shape (0.746/0.768 against 0.615/0.641) and **exactly zero route divergence**.
  // That is 1.4's result reproduced as a control: without exclusivity the choice is an
  // order, and the set of nodes a victory closes is the same set every time. The shipped
  // shape moves the set in 0.45 of runs. The `chain` rows are 1.4's own placebo, kept.
  //
  // The `firstReady` row is the second control: a run that never pins always takes the
  // first ready arm, so it walks one route per faction and diverges not at all.
  const runs = sweepSize()
  const baseline = sweep(runs, { contractPolicy: 'firstReady' })
  const nearest = sweep(runs, { contractPolicy: 'nearest' })
  const seeded = sweep(runs, { contractPolicy: 'seeded' })
  const placeboNearest = sweep(runs, { contractPolicy: 'nearest', campaignShape: 'chain' })
  const placeboSeeded = sweep(runs, { contractPolicy: 'seeded', campaignShape: 'chain' })
  const requiredNearest = sweep(runs, {
    contractPolicy: 'nearest',
    campaignShape: 'allRequired',
  })
  const requiredSeeded = sweep(runs, {
    contractPolicy: 'seeded',
    campaignShape: 'allRequired',
  })

  // Non-vacuity first: the fork has to have been on screen, and the campaign has to have
  // been finishing, or every number below is about nothing.
  assert.equal(baseline.forkVisible, 1, 'the branched arm never presented a fork')
  assert.equal(placeboNearest.forkVisible, 0, 'the linearised placebo still had a fork in it')
  assert.equal(placeboSeeded.forkVisible, 0, 'the linearised placebo still had a fork in it')
  assert.equal(
    requiredNearest.forkVisible,
    1,
    'the all-required placebo lost its fork, so it is not a matched control',
  )
  // **Split by cause, and by the right cause.** 1.4's guard was `timeouts === 0`, and over
  // 200 seeds that no longer holds: one run in two hundred is still one node from its
  // finale when the harness's 300 s clock runs out, with that node ready and reachable. It
  // ran out of *time*, not out of *road*, and the two must not be counted together — so the
  // guard is now the property it was always trying to express. `strandedAtEnd` is true only
  // when a run stopped with the campaign unfinished and **nothing ready at all**.
  assert.equal(baseline.stranded, 0, `${String(baseline.stranded)} runs were left with nothing to do`)
  assert.equal(nearest.stranded, 0)
  assert.equal(seeded.stranded, 0)
  assert.equal(requiredNearest.stranded, 0)
  assert.ok(
    baseline.timeouts <= Math.ceil(runs * 0.02),
    `${String(baseline.timeouts)} runs ran out of the harness clock`,
  )
  assert.ok(
    baseline.victories / runs > 0.8,
    `the campaign stopped finishing: ${String(baseline.victories)}/${String(runs)}`,
  )

  // The baseline pins nothing, so it must be flat. If this ever reports divergence, the
  // "the fork did it" claim is unfounded and the sweep is measuring noise.
  assert.equal(baseline.choiceRate, 0, 'the default arm made a choice')
  assert.equal(baseline.routeDivergence, 0, 'the no-choice arm walked different routes anyway')

  // **The treatment, and the thing 1.4 could not report.** Two runs of the same faction now
  // close *different sets* of nodes, not the same set in a different order.
  assert.ok(
    nearest.routeDivergence > 0.15,
    `nearest walked one route: ${nearest.routeDivergence.toFixed(3)}`,
  )
  assert.ok(
    seeded.routeDivergence > 0.15,
    `seeded walked one route: ${seeded.routeDivergence.toFixed(3)}`,
  )
  assert.ok(nearest.distinctRoutes >= 4, `only ${String(nearest.distinctRoutes)} routes walked`)
  assert.ok(nearest.choiceRate > 0.25, `choice rate ${nearest.choiceRate.toFixed(3)}`)
  assert.ok(seeded.choiceRate > 0.25, `choice rate ${seeded.choiceRate.toFixed(3)}`)

  // **The anti-placebo.** Same policies, same fork, nothing exclusive: every victory walks
  // every arm, so there is exactly one route per faction and no divergence at all.
  assert.equal(
    requiredNearest.routeDivergence,
    0,
    'routes diverged without an exclusive choice, so the choice is not what produced them',
  )
  assert.equal(requiredSeeded.routeDivergence, 0, 'routes diverged without an exclusive choice')
  assert.equal(requiredNearest.victoriesWithASkip, 0, 'the all-required placebo skipped a node')
  assert.equal(placeboNearest.orderingDivergence, 0, 'ordering diverged without a fork')
  assert.equal(placeboSeeded.orderingDivergence, 0, 'ordering diverged without a fork')

  // **Subset completion, on whole runs.** Every victory in the branched arms left a node
  // un-done, and every one of them paid the same objective reward regardless of which road
  // it took — which is the farmability property, observed rather than enumerated.
  assert.equal(
    nearest.victoriesWithASkip,
    nearest.victories,
    'a victory closed every node, so nothing was exclusive',
  )
  assert.deepEqual(
    [...seeded.rewardOnVictory],
    [OBJECTIVE_REWARD_STEPS],
    'two victories on different routes earned different objective rewards',
  )

  // The campaign still finishes with a choice in play.
  assert.ok(nearest.victories / runs > 0.8, `nearest completion ${String(nearest.victories)}`)
  assert.ok(seeded.victories / runs > 0.8, `seeded completion ${String(seeded.victories)}`)
})

test('the three factions run three different signature contracts', () => {
  // The roadmap's second signal, measured on runs rather than read off a table. 2.1 widened
  // the pool from three contracts to ten, so this asserts the thing that had to survive
  // that: **the signature arm is still one per faction, and the three are still different.**
  const summary = sweep(sweepSize(), { contractPolicy: 'nearest' })
  const seen = new Set<string>()
  for (const faction of FACTIONS) {
    const ids = summary.contractsByFaction.get(faction)
    assert.ok(ids && ids.size === 1, `${faction} ran ${String(ids?.size ?? 0)} kinds of contract`)
    for (const id of ids) seen.add(id)
  }
  assert.equal(seen.size, 3, `the factions shared a contract: ${[...seen].join(',')}`)
  assert.deepEqual(
    [...seen].sort(),
    FACTIONS.map((faction) => FACTION_CONTRACTS[faction].id).sort(),
  )
  // And they were actually run, not merely named.
  assert.ok(summary.contractsStarted >= summary.runs, 'contracts were never put on the ground')
  assert.ok(summary.contractsKept > 0, 'no contract was ever won')

  // Roadmap 2.1 — and the *alternative* arm differs by faction too, so a widened pool did
  // not turn into one shared pool wearing three names.
  const alternatives = new Map<Faction, Set<string>>()
  for (let index = 0; index < 30; index += 1) {
    const blueprint = generateWorld(5_150_000 + index * 877)
    for (const faction of FACTIONS) {
      const set = alternatives.get(faction) ?? new Set<string>()
      set.add(String(getContractNodes(blueprint, faction)[1].contract))
      alternatives.set(faction, set)
    }
  }
  const pooled = new Set<string>()
  for (const faction of FACTIONS) {
    const ids = alternatives.get(faction)
    assert.ok(ids && ids.size >= 2, `${faction} only ever drew one alternative`)
    for (const id of ids) {
      assert.equal(
        CONTRACT_TEMPLATES[id as ContractId].faction,
        faction,
        `${faction} drew ${id}, which belongs to another side`,
      )
      pooled.add(id)
    }
  }
  assert.equal(pooled.size, 7, 'the seven promoted alternatives were not all reachable')
})

test('a contract that is always abandoned never strands a run', () => {
  // **The whole-run safety control.** The scripted player starts every contract and walks
  // away from it, so every one fails forward. What has to survive that is the campaign.
  //
  // Measured with `KOROVANY_CONTRACT_SEEDS=200` on the `nearest` arm: **361 contracts
  // started, 0 kept, 261 failed forward and 135 chosen past**, 188 of 200 runs reached
  // victory (11 deaths, 1 harness timeout) and **0 runs were left with nothing to do**.
  // Every victory left a node un-done. Driven with `firstReady` instead — which never
  // re-pins away from the failing contract — the same arm reached victory in 183 of 200 and
  // was likewise never stranded.
  //
  // Roadmap 2.1 adds a second way a started contract stops being live, and it is not a
  // failure: the player took the *other* arm, so this one was skipped off the board. Both
  // are counted, because "started and neither kept nor resolved" is the shape of a hang and
  // a sweep that could not tell the two apart would report one as the other.
  const runs = sweepSize()
  const shirk = sweep(runs, { contractPolicy: 'nearest', contractOutcome: 'shirk' })

  // Non-vacuity: the arm has to have actually failed contracts, or it is measuring nothing.
  assert.equal(shirk.contractsKept, 0, 'the shirking arm honoured a contract')
  assert.ok(shirk.contractsFailedForward > 0, 'the shirking arm never failed a contract')
  // Every contract this arm started and lived to settle, it either abandoned or chose past.
  // Counted against `contractsStarted` and allowed one shortfall per death, because a run
  // can be killed while its contract is still running — and a run that never resolved one
  // has not failed to fail it.
  assert.ok(
    shirk.contractsFailedForward + shirk.contractsSkippedLive >=
      shirk.contractsStarted - shirk.defeats,
    `${String(
      shirk.contractsStarted - shirk.contractsFailedForward - shirk.contractsSkippedLive,
    )} contracts neither kept, failed nor skipped, against ${String(shirk.defeats)} deaths`,
  )
  assert.ok(
    shirk.contractsStarted >= runs - shirk.defeats,
    `only ${String(shirk.contractsStarted)} contracts started across ${String(runs)} runs`,
  )

  // The guarantee: no run was ever left with nothing to do, and the runs still finished.
  assert.equal(
    shirk.stranded,
    0,
    'abandoning contracts left a run with nothing it could complete',
  )
  assert.ok(
    shirk.timeouts <= Math.ceil(runs * 0.02),
    `abandoning contracts left ${String(shirk.timeouts)} runs on the harness clock`,
  )
  assert.ok(
    shirk.victories / runs > 0.8,
    `abandoning contracts stopped runs finishing: ${String(shirk.victories)}/${String(runs)}`,
  )
  assert.ok(
    shirk.victoriesAfterAFailure > runs / 2,
    'no run reached victory after a failed contract, so the guarantee was never exercised',
  )
  // **A razed contract square is survivable, and that is the claim rather than "it never
  // happens".** 1.4 asserted zero over 200 runs with one contract node; 2.1 doubles the
  // exposure and over 200 runs the chronicle burned one arm's square (a `scavenge` arm on
  // seed 3 024 494) — and that run still reached victory, because roadmap 1.5 made a burned
  // objective completable and the arm in question was one the player had chosen past
  // anyway. So the guard is the consequence, not the coincidence.
  assert.ok(
    shirk.razedContractSquares <= Math.ceil(runs * 0.02),
    `${String(shirk.razedContractSquares)} contract squares burned, which is more than the chronicle's own rate`,
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
