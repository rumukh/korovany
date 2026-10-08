/**
 * W3-5 — the guard's errand at the riverside healer, and the stall the harness reported there.
 *
 * W2-1's and W2-2's sweeps found the guard standing on its «interact» errand until the time ran
 * out. That was seeds 79191 and 142543 under `beeline` and `cautious` on the shipped arms, and
 * 285085 with the caravan spine. In every case the errand had landed on
 * `site-recovery-riverside`, a healer, and an encounter archer held 8–12 m off it. A scripted
 * player who never fights what it cannot reach never touched that archer. The harness then had
 * two stand-ins for the engine's `E`, and both failed:
 *
 * - its errand completed only once nothing hostile was within 12 m of the player;
 * - its own press at the healer, which the arrows made it press 53 to 189 times, healed and
 *   stopped there. It left out the objective that `handleGeneratedInteraction` completes on
 *   the same press.
 *
 * So the player was healed for ever and never finished the errand. The engine has no such
 * rule: `interact` → `handleGeneratedInteraction` → `chooseGeneratedInteraction` targets the
 * active objective whenever the player stands within 6 m of its site, whatever is shooting.
 * The first half below drives those production methods on seed 142543's own world. The second
 * half holds the harness's `errand` arm to them over the four whole runs, against the old
 * stand-in kept as the control.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import { HEALER_TREATED_NOTICE, describeObjectiveCompleted } from '../src/game/content/gameCopy.ts'
import { resolveDoctrineEffects } from '../src/game/run/doctrine.ts'
import { createHealthyBody, type Faction } from '../src/game/types.ts'
import {
  completeObjectiveEntry,
  createCampaignContractState,
  createChronicleCommitmentState,
  createGeneratedObjectives,
  skipExclusiveAlternatives,
} from '../src/game/world/CampaignDirector.ts'
import { createChronicleRegions } from '../src/game/world/Chronicle.ts'
import { createFinaleIdentity, createFinaleState } from '../src/game/world/FinaleDirector.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import type { FactionObjectiveNode } from '../src/game/world/worldTypes.ts'
import {
  HARNESS_ERRAND_CLEAR_RADIUS,
  HARNESS_SHIPPED_ARMS,
  HARNESS_SITE_REACH,
  isErrandNode,
  runHarness,
  type InputPolicy,
} from './runHarness.ts'

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

const SEED = 142543
const FACTION: Faction = 'guard'
const HEALER = 'site-recovery-riverside'
const BLUEPRINT = generateWorld(SEED)
const GRAPH = BLUEPRINT.objectives[FACTION]
const ERRAND = GRAPH.nodes.find((node) => isErrandNode(node)) as FactionObjectiveNode
const CONTRACT = GRAPH.nodes.find((node) => node.id === `objective-${FACTION}-contract`) as FactionObjectiveNode
const ALTERNATIVE = GRAPH.nodes.find((node) => node.id === `objective-${FACTION}-alt`) as FactionObjectiveNode

function invoke<T = void>(engine: object, method: string, ...args: unknown[]): T {
  const callable: unknown = Reflect.get(engine, method)
  assert.equal(typeof callable, 'function', `${method} must be a production engine method`)
  return Reflect.apply(callable as (...values: unknown[]) => T, engine, args)
}

/**
 * The guard on seed 142543 as the harness found it: the start reached and the relief arm kept,
 * so the bulwark arm is skipped and the errand is the only ready node. The engine stands in its
 * real world with its render, audio and HUD boundaries replaced. An enemy archer is 10 m from
 * the player, inside the stand-in's 12 m, as the harness's was.
 */
function fixture(options: { offset?: number; pinContract?: boolean } = {}) {
  const world = new GeneratedWorldRuntime(new THREE.Scene(), BLUEPRINT, { decorationDensity: 0 })
  const site = world.getSitePosition(HEALER)
  assert.ok(site, 'the healer has a place in the world')
  const objectives = createGeneratedObjectives(BLUEPRINT, FACTION)
  for (const rootId of GRAPH.rootNodeIds) completeObjectiveEntry(objectives, rootId)
  const contracts = createCampaignContractState()
  if (options.pinContract) {
    contracts.pinnedNodeId = CONTRACT.id
  } else {
    completeObjectiveEntry(objectives, ALTERNATIVE.id)
    skipExclusiveAlternatives(GRAPH, objectives, ALTERNATIVE.id)
  }
  const player = new THREE.Group()
  player.position.set(site.x + (options.offset ?? 0), 0, site.z)
  const archer = {
    id: 'generated:encounter-region-1-4:actor:1',
    role: 'archer',
    allegiance: 'villain',
    alive: true,
    hp: 61,
    maxHp: 61,
    hostileToPlayer: true,
    mesh: new THREE.Group(),
  }
  archer.mesh.position.set(player.position.x, 0, player.position.z + 10)
  const caravan = new THREE.Group()
  caravan.position.set(site.x + 400, 0, site.z + 400)
  const notices: string[] = []
  const engine: object = Object.assign(Object.create(GameEngine.prototype), {
    faction: FACTION,
    generatedBlueprint: BLUEPRINT,
    generatedWorld: world,
    objectives,
    campaignContracts: contracts,
    activeContractNodeId: null,
    activeEvents: [],
    actors: [archer],
    player,
    caravan,
    paused: false,
    ended: false,
    health: 50,
    maxHealth: 100,
    stamina: 20,
    maxStamina: 100,
    body: createHealthyBody(),
    generatedSupplyCount: 0,
    threatTier: 1,
    doctrineEffects: resolveDoctrineEffects([]),
    chronicleCommitments: createChronicleCommitmentState(),
    chronicleRegions: createChronicleRegions(BLUEPRINT),
    chronicleRazedSiteIds: new Set<string>(),
    finale: createFinaleState(createFinaleIdentity(BLUEPRINT, FACTION)),
    callbacks: { onNotice: (message: string) => notices.push(message) },
    achievements: { recordObjectiveCompleted() {}, recordGoldEarned() {} },
    resumeAudio() {},
    emitView() {},
    playSound() {},
  })
  const errandDone = () => objectives.find((objective) => objective.id === ERRAND.id)?.done === true
  return { engine, world, objectives, archer, player, notices, errandDone }
}

test('the engine finishes the guard\'s errand at the healer on E, with an archer 10 m away', () => {
  assert.equal(ERRAND.kind, 'interact')
  assert.equal(ERRAND.siteId, HEALER)
  const value = fixture()
  try {
    assert.equal(invoke<FactionObjectiveNode | null>(value.engine, 'getActiveGeneratedObjective')?.id, ERRAND.id)
    // What the harness's stand-in waited on: something hostile inside its radius.
    const away = value.archer.mesh.position.distanceTo(value.player.position)
    assert.ok(away < HARNESS_ERRAND_CLEAR_RADIUS, `the archer is ${away} m away`)
    // The prompt is up: the errand's own site is the healer, so it offers the healer's verb.
    assert.match(invoke<string>(value.engine, 'getGeneratedPrompt'), /^\[E\] Вылечиться/)

    invoke(value.engine, 'interact')
    assert.equal(value.errandDone(), true, 'one press finished the errand')
    assert.equal(Reflect.get(value.engine, 'health'), 90, 'and healed, on the same press')
    assert.ok(value.notices.includes(HEALER_TREATED_NOTICE), value.notices.join(' | '))
    const errandText = value.objectives.find((objective) => objective.id === ERRAND.id)?.text ?? ''
    assert.ok(value.notices.includes(describeObjectiveCompleted(errandText)), value.notices.join(' | '))
    // The archer was never consulted, and it is still there.
    assert.equal(value.archer.alive, true)
  } finally {
    value.world.dispose()
  }
})

test('control: out of the site\'s reach the same press finishes nothing and heals nobody', () => {
  const value = fixture({ offset: HARNESS_SITE_REACH + 0.5 })
  try {
    assert.equal(value.world.findNearbySite(value.player.position, HARNESS_SITE_REACH), undefined)
    assert.equal(invoke<string>(value.engine, 'getGeneratedPrompt'), '')
    invoke(value.engine, 'interact')
    assert.equal(value.errandDone(), false)
    assert.equal(Reflect.get(value.engine, 'health'), 50)
    assert.deepEqual(value.notices, [])
  } finally {
    value.world.dispose()
  }
})

test('control: with the contract arm pinned, the healer heals but the errand waits for its own press', () => {
  // `chooseGeneratedInteraction` targets the *active* objective, which a pin moves. The press
  // that heals is the same press; only what it completes changed.
  const value = fixture({ pinContract: true })
  try {
    assert.equal(invoke<FactionObjectiveNode | null>(value.engine, 'getActiveGeneratedObjective')?.id, CONTRACT.id)
    invoke(value.engine, 'interact')
    assert.equal(Reflect.get(value.engine, 'health'), 90)
    assert.equal(value.errandDone(), false)
  } finally {
    value.world.dispose()
  }
})

// ---------------------------------------------------------------------------
// The harness, held to it
// ---------------------------------------------------------------------------

/** The four runs W2-1 timed out, cut to 240 s: the stall begins at about 65 s. */
const STALLS: ReadonlyArray<readonly [number, InputPolicy]> = [
  [79191, 'beeline'],
  [79191, 'cautious'],
  [142543, 'beeline'],
  [142543, 'cautious'],
]

test('the harness presses its errand done the way the engine does, and its old stand-in still stalls', () => {
  for (const [seed, policy] of STALLS) {
    const options = { ...HARNESS_SHIPPED_ARMS, seed, faction: FACTION, policy, hz: 30, timeLimit: 240 } as const
    const pressed = runHarness(options)
    const waited = runHarness({ ...options, errand: 'clear' })
    const label = `${policy} ${seed}`
    assert.equal(pressed.errand, 'press')
    assert.equal(waited.errand, 'clear')

    // Both reach the errand's site on the same frame: nothing before it differs.
    const reached = pressed.balance.errandSite.reachedAt
    assert.ok(reached !== null && reached < 70, `${label}: reached at ${reached}`)
    assert.equal(waited.balance.errandSite.reachedAt, reached)

    // `press`: the errand completes on the frame the prompt is up, with something hostile
    // within 12 m, which is the one frame of `heldSeconds`.
    assert.equal(pressed.balance.errandSite.completedAt, reached, `${label}: pressed on arrival`)
    assert.ok(pressed.balance.errandSite.heldSeconds > 0, `${label}: the site was held when it was pressed`)
    assert.ok(pressed.balance.errandSite.heldSeconds < 0.1, `${label}: and not waited on`)
    const errandId: string | undefined = generateWorld(seed).objectives[FACTION].nodes
      .find((node) => isErrandNode(node))?.id
    assert.equal(
      pressed.objectives.find((objective): boolean => objective.id === errandId)?.completedAt,
      reached,
    )

    // The control: the old stand-in, which waits for the archer to go, never completes it.
    assert.equal(waited.balance.errandSite.completedAt, null, `${label}: the stand-in completed it`)
    assert.ok(waited.balance.errandSite.heldSeconds >= 150, `${label}: held ${waited.balance.errandSite.heldSeconds} s`)
    assert.equal(waited.outcome, 'timeout')
    assert.equal(waited.objectives.find((objective): boolean => objective.id === errandId)?.completedAt ?? null, null)
  }
})

test('the beeline runs that stalled now end long before the limit', () => {
  // The cautious 142543 run finishes the errand too, and then meets the cautious finale stall,
  // a different class `docs/run-harness.md` names. The beeline runs have no such retreat.
  for (const seed of [79191, 142543]) {
    const report = runHarness({
      ...HARNESS_SHIPPED_ARMS,
      seed,
      faction: FACTION,
      policy: 'beeline',
      hz: 30,
      timeLimit: 600,
    })
    assert.notEqual(report.outcome, 'timeout', `beeline ${seed} still timed out`)
    assert.ok(report.elapsed < 150, `beeline ${seed} ran ${report.elapsed} s`)
  }
})
