/**
 * W2-1 — the threat tier answers to the run's progress as well as to the clock, and the
 * doctrine drafts it deals wait for a calm moment.
 *
 * The pure half pins the rules: `countProgressSteps` reads saved state, `getThreatTier` is
 * the clock or the progress whichever is further, and `restoreThreatTier` cannot count a
 * step twice. The engine half drives the production `updateThreat`,
 * `updateDoctrineDraft` and `completeObjective` on an engine whose render, audio and
 * actor-mesh boundaries are replaced, the way `tests/contractArrival.test.ts` does it.
 * Every claim carries a negative control: the pre-W2-1 rule is put back on the instance,
 * and the same assertion has to come out the other way.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import {
  describeDoctrineDraftOpened,
  describeEnemiesStronger,
  describeObjectiveCompleted,
  describeThreatTier,
} from '../src/game/content/gameCopy.ts'
import {
  DEFAULT_DOCTRINE_IDS,
  DOCTRINE_DRAFT_ALERT_RADIUS,
  DOCTRINE_DRAFT_CALM_RADIUS,
  DOCTRINE_DRAFT_TIERS,
  createDoctrineRunState,
  isDoctrineDraftMomentCalm,
  normalizeDoctrineRunState,
  resolveDoctrineEffects,
  serializeDoctrineRunState,
} from '../src/game/run/doctrine.ts'
import {
  MAX_PROGRESS_THREAT_TIER,
  MAX_THREAT_TIER,
  THREAT_TIER_SECONDS,
  getEnemyScalingTier,
  getProgressThreatTier,
  getThreatTier,
  type Faction,
  type Objective,
} from '../src/game/types.ts'
import {
  completeObjectiveEntry,
  countProgressSteps,
  createCampaignContractState,
  createGeneratedObjectives,
  eventCooldownRange,
  restoreThreatTier,
  skipExclusiveAlternatives,
} from '../src/game/world/CampaignDirector.ts'
import { buildInitialGameView } from '../src/game/world/CampaignView.ts'
import { createFinaleIdentity, createFinaleState } from '../src/game/world/FinaleDirector.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import type { ActiveRunSaveV3 } from '../src/game/run/runTypes.ts'

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

const SEED = 20_261_006
const BLUEPRINT = generateWorld(SEED)
const FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']

/** `objective-<faction>-<suffix>`, the ids `createObjectives` gives every graph. */
function nodeId(faction: Faction, suffix: 'start' | 'branch' | 'contract' | 'alt' | 'finale'): string {
  return `objective-${faction}-${suffix}`
}

/** Close a node the way the engine does: mark it done, then skip its fork's other arm. */
function close(objectives: Objective[], faction: Faction, id: string): void {
  completeObjectiveEntry(objectives, id)
  skipExclusiveAlternatives(BLUEPRINT.objectives[faction], objectives, id)
}

function steps(objectives: readonly Objective[], faction: Faction, caravanBeatsResolved?: number): number {
  return countProgressSteps({
    graph: BLUEPRINT.objectives[faction],
    objectives,
    ...(caravanBeatsResolved === undefined ? {} : { caravanBeatsResolved }),
  })
}

/** The pre-W2-1 rule, restated: the clock alone. The equivalence control's other side. */
function legacyThreatTier(elapsed: number): number {
  return Math.min(MAX_THREAT_TIER, 1 + Math.floor(Math.max(0, elapsed) / THREAT_TIER_SECONDS))
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

test('a step is a closed errand or a settled contract arm, read off saved state', () => {
  for (const faction of FACTIONS) {
    const objectives = createGeneratedObjectives(BLUEPRINT, faction)
    assert.equal(steps(objectives, faction), 0, `${faction}: a fresh run has settled nothing`)

    // The camp is a root and free: arriving there is not progress.
    close(objectives, faction, nodeId(faction, 'start'))
    assert.equal(steps(objectives, faction), 0, `${faction}: the camp counted`)

    close(objectives, faction, nodeId(faction, 'branch'))
    assert.equal(steps(objectives, faction), 1, `${faction}: the errand did not count`)

    // One arm closes, the other is skipped. The skipped arm is a road not taken, not a step.
    close(objectives, faction, nodeId(faction, 'alt'))
    assert.equal(objectives.find((entry) => entry.id === nodeId(faction, 'contract'))?.skipped, true)
    assert.equal(steps(objectives, faction), 2, `${faction}: the arm did not count, or the skip did`)

    // The finale ends the run; it is not a step towards anything.
    close(objectives, faction, nodeId(faction, 'finale'))
    assert.equal(steps(objectives, faction), 2, `${faction}: the finale counted`)

    // W2-2's hook adds what it is handed and nothing else.
    assert.equal(steps(objectives, faction, 2), 4)
    assert.equal(steps(objectives, faction, 0), 2)
    assert.equal(steps(objectives, faction, -3), 2)
    assert.equal(steps(objectives, faction, Number.NaN), 2)
    assert.equal(steps(objectives, faction, 1.9), 3)
  }
})

test('a contract that failed forward still counts once its node closes', () => {
  const faction: Faction = 'villain'
  const objectives = createGeneratedObjectives(BLUEPRINT, faction)
  close(objectives, faction, nodeId(faction, 'start'))
  // The fail-forward path closes the node by arrival without the payout: the objective is
  // done either way, and that is all the count reads. A failed contract whose node is not
  // closed yet is not a step — the player still has to walk there.
  assert.equal(steps(objectives, faction), 0)
  close(objectives, faction, nodeId(faction, 'contract'))
  assert.equal(steps(objectives, faction), 1)
})

test('the tier is the clock or the progress, whichever is further, and the clock alone reaches 5', () => {
  // Without steps it is exactly the old rule, at every second of a long run.
  for (let elapsed = 0; elapsed <= 1_200; elapsed += 0.5) {
    assert.equal(getThreatTier(elapsed), legacyThreatTier(elapsed), `t=${elapsed}`)
    assert.equal(getThreatTier(elapsed, 0), legacyThreatTier(elapsed), `t=${elapsed}`)
  }
  // Each step raises it by one while the clock is behind.
  assert.equal(getThreatTier(10, 1), 2)
  assert.equal(getThreatTier(10, 2), 3)
  assert.equal(getThreatTier(10, 3), 4)
  // Progress stops at the last draft anchor; tier 5 stays the clock's.
  assert.equal(MAX_PROGRESS_THREAT_TIER, DOCTRINE_DRAFT_TIERS[DOCTRINE_DRAFT_TIERS.length - 1])
  assert.equal(getThreatTier(10, 9), MAX_PROGRESS_THREAT_TIER)
  assert.equal(getProgressThreatTier(99), MAX_PROGRESS_THREAT_TIER)
  assert.equal(getThreatTier(4 * THREAT_TIER_SECONDS, 3), MAX_THREAT_TIER)
  // The time backstop still works when nothing is ever closed.
  assert.equal(getThreatTier(THREAT_TIER_SECONDS - 0.01, 0), 1)
  assert.equal(getThreatTier(THREAT_TIER_SECONDS, 0), 2)
  // And the max, not a sum: a step the clock has already paid for adds nothing.
  assert.equal(getThreatTier(2 * THREAT_TIER_SECONDS, 1), 3)
  assert.equal(getProgressThreatTier(Number.NaN), 1)
  assert.equal(getProgressThreatTier(-2), 1)
})

test('a continue restores the saved tier and never adds the steps to it again', () => {
  // The saved tier already holds the steps, so restoring it is idempotent however many
  // times the run is suspended and continued.
  let saved = 1
  const objectives = createGeneratedObjectives(BLUEPRINT, 'elf')
  close(objectives, 'elf', nodeId('elf', 'start'))
  close(objectives, 'elf', nodeId('elf', 'branch'))
  close(objectives, 'elf', nodeId('elf', 'contract'))
  saved = getThreatTier(95, steps(objectives, 'elf'))
  assert.equal(saved, 3)
  for (let cycle = 0; cycle < 5; cycle += 1) {
    saved = restoreThreatTier(saved, 95, steps(objectives, 'elf'))
  }
  assert.equal(saved, 3, 'five continues moved the tier')

  // A missing or broken value falls back to what the rules derive.
  assert.equal(restoreThreatTier(undefined, 95, 2), 3)
  assert.equal(restoreThreatTier(Number.NaN, 95, 2), 3)
  assert.equal(restoreThreatTier('3', 400, 0), 3)
  assert.equal(restoreThreatTier(9, 0, 0), MAX_THREAT_TIER)
  assert.equal(restoreThreatTier(0, 0, 0), 1)
  assert.equal(restoreThreatTier(2.7, 0, 0), 2)
  // An older save written when only the clock counted keeps its saved tier on the way in;
  // the engine's first frame raises it, with the notice (pinned below).
  assert.equal(restoreThreatTier(1, 95, 2), 1)

  // Negative control: the additive restore this rule exists to refuse double-counts on the
  // very first continue, so the idempotence assertion above can tell the two apart.
  const additive = (tier: number, progress: number) => Math.min(MAX_THREAT_TIER, tier + progress)
  assert.notEqual(additive(3, steps(objectives, 'elf')), 3)
})

test('the launch view shows the tier the engine restores, on a save with an earned tier', () => {
  const faction: Faction = 'guard'
  const config = {
    seed: BLUEPRINT.seed, generatorVersion: BLUEPRINT.generatorVersion, faction, selectedBoonId: '',
  }
  const objectives = createGeneratedObjectives(BLUEPRINT, faction)
  close(objectives, faction, nodeId(faction, 'start'))
  close(objectives, faction, nodeId(faction, 'branch'))
  const base = buildInitialGameView({ blueprint: BLUEPRINT, config })
  const save = (directorState: Record<string, unknown>): ActiveRunSaveV3 => ({
    version: 3, runId: 'run-w2-1', config, status: 'active',
    startedAt: '2026-10-07T10:00:00.000Z', updatedAt: '2026-10-07T10:02:00.000Z',
    blueprintFingerprint: BLUEPRINT.fingerprint,
    currentLocation: { regionId: base.worldMap.currentRegionId, localPosition: [0, 0, 0], worldPosition: [0, 0, 0] },
    player: {
      health: 80, maxHealth: 100, stamina: 100, maxStamina: 100, gold: 55, kills: 2, damage: 28,
      body: base.body, objectives, upgrades: base.upgrades,
    },
    discoveredRegionIds: [], regionDeltas: {},
    directorState: directorState as ActiveRunSaveV3['directorState'],
    eventState: {}, chronicleState: { tick: 0, factionStrength: { elf: 0, guard: 0, villain: 0 }, caravans: [], log: [] },
    rngStates: {},
  } as unknown as ActiveRunSaveV3)

  // Saved by this build: the saved tier is shown as is.
  assert.equal(buildInitialGameView({ blueprint: BLUEPRINT, config, restored: save({ elapsed: 70, threatTier: 2 }) }).threatTier, 2)
  // No tier in the save: derived from the clock *and* the closed errand.
  assert.equal(buildInitialGameView({ blueprint: BLUEPRINT, config, restored: save({ elapsed: 70 }) }).threatTier, 2)
  // Negative control: the clock-only rule the launch view used to apply would say 1.
  assert.equal(getThreatTier(70), 1)
})

test('the calm predicate refuses a fight at the player and a running finale, and nothing else', () => {
  const chasing = (distance: number) => ({ distance, targetingPlayer: false })
  const aiming = (distance: number) => ({ distance, targetingPlayer: true })
  const calm = (engagedHostiles: Array<{ distance: number; targetingPlayer: boolean }>, finaleEngaged = false) =>
    isDoctrineDraftMomentCalm({ engagedHostiles, finaleEngaged })
  assert.equal(calm([]), true)
  // A pursuer is a fight once it is within the score's combat range, not before.
  assert.equal(calm([chasing(DOCTRINE_DRAFT_CALM_RADIUS + 0.1)]), true)
  assert.equal(calm([chasing(DOCTRINE_DRAFT_CALM_RADIUS)]), false)
  assert.equal(calm([chasing(80), chasing(3)]), false)
  // One winding up or shooting at the player is a fight anywhere in its alert range.
  assert.equal(calm([aiming(DOCTRINE_DRAFT_ALERT_RADIUS)]), false)
  assert.equal(calm([aiming(DOCTRINE_DRAFT_ALERT_RADIUS + 0.1)]), true)
  assert.equal(calm([], true), false)
})

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

interface Notice {
  message: string
  tone: string
}

interface FixtureActor {
  alive: boolean
  hostileToPlayer: boolean
  playerAggro: boolean
  action: null | { target: { kind: string } }
  mesh: { position: THREE.Vector3 }
}

function hostile(distance: number, engaged = true): FixtureActor {
  return {
    alive: true,
    hostileToPlayer: true,
    playerAggro: engaged,
    action: null,
    mesh: { position: new THREE.Vector3(distance, 0, 0) },
  }
}

/** A headless engine with the production threat, draft and objective methods. */
function engineFixture(faction: Faction, options: { elapsed?: number; doctrines?: string[] } = {}) {
  const notices: Notice[] = []
  const waves: number[] = []
  const objectives = createGeneratedObjectives(BLUEPRINT, faction)
  const player = new THREE.Group()
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    generatedBlueprint: BLUEPRINT,
    faction,
    objectives,
    elapsed: options.elapsed ?? 30,
    threatTier: 1,
    announcedScalingTier: getEnemyScalingTier(options.elapsed ?? 30),
    nextThreatWaveAt: 240,
    ended: false,
    actors: [] as FixtureActor[],
    player,
    finale: createFinaleState(createFinaleIdentity(BLUEPRINT, faction)),
    doctrines: createDoctrineRunState(DEFAULT_DOCTRINE_IDS),
    doctrineEffects: resolveDoctrineEffects(options.doctrines ?? []),
    campaignContracts: createCampaignContractState(),
    activeContractNodeId: null,
    activeEvents: [],
    achievements: { recordObjectiveCompleted() {} },
    callbacks: { onNotice: (message: string, tone = 'info') => notices.push({ message, tone }) },
  })
  const stubs: Record<string, unknown> = {
    playSound: () => {},
    emitView: () => {},
    hasNearbyEvent: () => false,
    finaleWithinArena: () => false,
    spawnThreatWave(this: { elapsed: number; threatTier: number }): number {
      waves.push(this.elapsed)
      return Math.min(4, this.threatTier)
    },
  }
  for (const [name, value] of Object.entries(stubs)) Reflect.set(engine, name, value)
  return { engine, notices, waves, objectives, player }
}

/** One frame of the production threat pass. */
function frame(engine: { elapsed: number; updateThreat: () => void }, delta = 0.1): void {
  engine.elapsed += delta
  engine.updateThreat()
}

test('closing the errand raises the tier on the next frame, with the line that says why', () => {
  for (const faction of FACTIONS) {
    const { engine, notices } = engineFixture(faction)
    engine.completeObjective(nodeId(faction, 'start'))
    frame(engine)
    assert.equal(engine.threatTier, 1, `${faction}: the camp raised the tier`)

    engine.completeObjective(nodeId(faction, 'branch'))
    assert.equal(engine.threatTier, 1, 'the tier rises on the next frame, after the objective line')
    frame(engine)
    assert.equal(engine.threatTier, 2, `${faction}: the errand did not raise the tier`)
    const lines = notices.map((notice) => notice.message)
    const objectiveLine = lines.indexOf(
      describeObjectiveCompleted(engine.objectives.find((entry: Objective) => entry.id === nodeId(faction, 'branch')).text),
    )
    const tierLine = lines.indexOf(describeThreatTier(2, MAX_THREAT_TIER, 'progress'))
    const draftLine = lines.indexOf(describeDoctrineDraftOpened(1, DOCTRINE_DRAFT_TIERS.length))
    assert.ok(objectiveLine >= 0 && tierLine > objectiveLine, `${faction}: ${lines.join(' | ')}`)
    assert.ok(draftLine > tierLine, `${faction}: the draft did not follow the tier`)
    assert.equal(engine.doctrines.anchors, 1)

    // The arm is the second step, and the second draft point.
    engine.completeObjective(nodeId(faction, 'contract'))
    frame(engine)
    assert.equal(engine.threatTier, 3, `${faction}: the arm did not raise the tier`)
    assert.equal(engine.doctrines.anchors, 2)
    // Idempotent: frames that settle nothing new change nothing.
    const before = notices.length
    for (let index = 0; index < 50; index += 1) frame(engine)
    assert.equal(engine.threatTier, 3)
    assert.equal(notices.length, before, 'a settled step was announced twice')
  }

  // Negative control: put the clock-only rule back and the same step raises nothing.
  const { engine: control } = engineFixture('elf')
  Reflect.set(control, 'threatTierTarget', function (this: { elapsed: number }) {
    return getThreatTier(this.elapsed)
  })
  control.completeObjective(nodeId('elf', 'start'))
  control.completeObjective(nodeId('elf', 'branch'))
  frame(control)
  assert.equal(control.threatTier, 1, 'the control should not have moved')
  assert.equal(control.doctrines.anchors, 0)
})

test('with nothing closed the clock still raises the tier at three minutes, with its own line', () => {
  const { engine, notices } = engineFixture('villain', { elapsed: THREAT_TIER_SECONDS - 0.25 })
  frame(engine)
  assert.equal(engine.threatTier, 1)
  frame(engine, 0.2)
  assert.equal(engine.threatTier, 2)
  assert.ok(notices.some((notice) => notice.message === describeThreatTier(2, MAX_THREAT_TIER)))
  assert.equal(
    notices.some((notice) => notice.message === describeThreatTier(2, MAX_THREAT_TIER, 'progress')),
    false,
    'a tier the clock paid for was announced as earned',
  )
  assert.equal(engine.doctrines.anchors, 1, 'the backstop draft did not open')
})

test('the draft waits for the fight to end, while the tier does not', () => {
  const { engine, notices } = engineFixture('elf')
  engine.actors.push(hostile(10))
  engine.completeObjective(nodeId('elf', 'start'))
  engine.completeObjective(nodeId('elf', 'branch'))
  for (let index = 0; index < 30; index += 1) frame(engine)
  assert.equal(engine.threatTier, 2, 'the tier is the run\'s pacing and rises at once')
  assert.equal(engine.doctrines.anchors, 0, 'the draft opened mid-fight')
  assert.equal(
    notices.some((notice) => notice.message === describeDoctrineDraftOpened(1, DOCTRINE_DRAFT_TIERS.length)),
    false,
  )

  // An archer at 25 m drawing on the player is still a fight; a pursuer at that distance is not.
  engine.actors[0].mesh.position.set(25, 0, 0)
  engine.actors[0].action = { target: { kind: 'player' } }
  frame(engine)
  assert.equal(engine.doctrines.anchors, 0, 'the draft opened under fire')
  engine.actors[0].action = null
  frame(engine)
  assert.equal(engine.doctrines.anchors, 1, 'the draft did not open once the fight was over')
  assert.ok(notices.some((notice) => notice.message === describeDoctrineDraftOpened(1, DOCTRINE_DRAFT_TIERS.length)))

  // A finale under way is a fight too.
  const finale = engineFixture('guard')
  finale.engine.finale.introduced = true
  finale.engine.finale.suspended = false
  Reflect.set(finale.engine, 'finaleWithinArena', () => true)
  finale.engine.completeObjective(nodeId('guard', 'start'))
  finale.engine.completeObjective(nodeId('guard', 'branch'))
  frame(finale.engine)
  assert.equal(finale.engine.doctrines.anchors, 0, 'the draft opened during the finale')
  // A dead hostile, an unengaged one, and one swinging at the player without aggro.
  const dead = engineFixture('villain')
  dead.engine.actors.push({ ...hostile(5), alive: false })
  const idle = engineFixture('villain')
  idle.engine.actors.push(hostile(5, false))
  const swinging = engineFixture('villain')
  swinging.engine.actors.push({ ...hostile(5, false), action: { target: { kind: 'player' } } })
  for (const { engine: subject } of [dead, idle, swinging]) {
    subject.completeObjective(nodeId('villain', 'start'))
    subject.completeObjective(nodeId('villain', 'branch'))
    frame(subject)
  }
  assert.equal(dead.engine.doctrines.anchors, 1)
  assert.equal(idle.engine.doctrines.anchors, 1)
  assert.equal(swinging.engine.doctrines.anchors, 0)

  // Negative control: without the gate the same fight gets the cards mid-swing.
  const control = engineFixture('elf')
  Reflect.set(control.engine, 'isDraftMomentCalm', () => true)
  control.engine.actors.push(hostile(10))
  control.engine.completeObjective(nodeId('elf', 'start'))
  control.engine.completeObjective(nodeId('elf', 'branch'))
  frame(control.engine)
  assert.equal(control.engine.doctrines.anchors, 1, 'the control should have opened the draft')
})

test('a checkpoint and a continue neither raise the tier again nor reopen a draft', () => {
  const first = engineFixture('elf', { elapsed: 90 })
  first.engine.completeObjective(nodeId('elf', 'start'))
  first.engine.completeObjective(nodeId('elf', 'branch'))
  first.engine.completeObjective(nodeId('elf', 'alt'))
  frame(first.engine)
  assert.equal(first.engine.threatTier, 3)
  assert.equal(first.engine.doctrines.anchors, 2)

  // Three suspend/continue cycles through the saved fields and the production restore rule.
  interface SavedFields {
    threatTier: number
    elapsed: number
    objectives: Objective[]
    doctrines: Record<string, unknown>
  }
  const snapshot = (engine: typeof first.engine): SavedFields => ({
    threatTier: engine.threatTier,
    elapsed: engine.elapsed,
    objectives: (engine.objectives as Objective[]).map((entry) => ({ ...entry })),
    doctrines: serializeDoctrineRunState(engine.doctrines),
  })
  let saved = snapshot(first.engine)
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const next = engineFixture('elf', { elapsed: saved.elapsed })
    next.engine.objectives = saved.objectives.map((entry) => ({ ...entry }))
    next.engine.doctrines = normalizeDoctrineRunState(saved.doctrines)
    next.engine.threatTier = restoreThreatTier(
      saved.threatTier,
      saved.elapsed,
      steps(next.engine.objectives, 'elf'),
    )
    for (let index = 0; index < 20; index += 1) frame(next.engine)
    assert.equal(next.engine.threatTier, 3, `cycle ${cycle}: the tier moved`)
    assert.equal(next.engine.doctrines.anchors, 2, `cycle ${cycle}: a draft was dealt again`)
    assert.deepEqual(next.notices, [], `cycle ${cycle}: a continue announced something`)
    saved = snapshot(next.engine)
  }

  // An older save, written when only the clock counted, catches up on its first frame —
  // with the line, so the jump is explained rather than silent.
  const old = engineFixture('elf', { elapsed: 90 })
  old.engine.objectives = saved.objectives.map((entry) => ({ ...entry }))
  old.engine.threatTier = restoreThreatTier(1, 90, steps(old.engine.objectives, 'elf'))
  assert.equal(old.engine.threatTier, 1)
  frame(old.engine)
  assert.equal(old.engine.threatTier, 3)
  assert.ok(old.notices.some((notice) => notice.message === describeThreatTier(3, MAX_THREAT_TIER, 'progress')))
})

test('the base game keeps its waves on the clock and «Устав дозора» keeps them on closure', () => {
  // The base game: closing a step at tier 2 spawns nothing; the clock does, at 240 s.
  const base = engineFixture('guard', { elapsed: 60 })
  base.engine.completeObjective(nodeId('guard', 'start'))
  base.engine.completeObjective(nodeId('guard', 'branch'))
  frame(base.engine)
  assert.equal(base.engine.threatTier, 2)
  base.engine.completeObjective(nodeId('guard', 'contract'))
  frame(base.engine)
  assert.deepEqual(base.waves, [], 'the base game threw a wave on a closed objective')
  base.engine.elapsed = 239.95
  frame(base.engine)
  assert.equal(base.waves.length, 1, 'the clock wave did not come at 240 s')

  // «Устав дозора»: the same closure throws a wave, and the clock never does.
  const vanguard = engineFixture('guard', { elapsed: 60, doctrines: ['vanguard'] })
  vanguard.engine.completeObjective(nodeId('guard', 'start'))
  vanguard.engine.completeObjective(nodeId('guard', 'branch'))
  frame(vanguard.engine)
  vanguard.engine.completeObjective(nodeId('guard', 'contract'))
  assert.equal(vanguard.waves.length, 1, 'vanguard did not answer the closure')
  vanguard.engine.elapsed = 239.95
  for (let index = 0; index < 600; index += 1) frame(vanguard.engine)
  assert.equal(vanguard.waves.length, 1, 'vanguard was thrown a clock wave')
})

// ---------------------------------------------------------------------------
// Pacing and scaling: one tier for attention, the clock's for enemy stats
// ---------------------------------------------------------------------------

const near = (actual: number, expected: number) => Math.abs(actual - expected) < 1e-9

test('the enemy scaling tier is the clock alone, and the pacing tier never falls below it', () => {
  for (let elapsed = 0; elapsed <= 1_200; elapsed += 0.5) {
    assert.equal(getEnemyScalingTier(elapsed), legacyThreatTier(elapsed), `t=${elapsed}`)
    for (const progress of [0, 1, 2, 3, 9]) {
      assert.ok(getThreatTier(elapsed, progress) >= getEnemyScalingTier(elapsed))
    }
  }
  // Progress moves the pacing tier and leaves the scaling tier where the clock put it.
  assert.equal(getThreatTier(60, 2), 3)
  assert.equal(getEnemyScalingTier(60), 1)
})

test('enemy health and damage follow the clock even when the run has earned a higher tier', () => {
  const { engine } = engineFixture('elf', { elapsed: 60 })
  engine.completeObjective(nodeId('elf', 'start'))
  engine.completeObjective(nodeId('elf', 'branch'))
  engine.completeObjective(nodeId('elf', 'contract'))
  frame(engine)
  assert.equal(engine.threatTier, 3, 'the run earned tier 3')
  // The elf's enemies spawn and hit as at tier 1, because the clock is at tier 1.
  assert.ok(near(engine.enemyHealthMultiplier('guard'), 1))
  assert.ok(near(engine.enemyDamageMultiplier({ hostileToPlayer: true }), 1))
  assert.ok(near(engine.enemyHealthMultiplier('elf'), 1), 'friends never scale')

  // Three minutes in, the clock's tier 2 does make them tougher, under the same tier 3.
  engine.elapsed = THREAT_TIER_SECONDS + 1
  frame(engine)
  assert.equal(engine.threatTier, 3)
  assert.ok(near(engine.enemyHealthMultiplier('guard'), 1.12))
  assert.ok(near(engine.enemyDamageMultiplier({ hostileToPlayer: true }), 1.09))

  // Negative control: scale by the tier on the HUD and the earned tier inflates their stats.
  Reflect.set(engine, 'enemyScalingTier', function (this: { threatTier: number }) {
    return this.threatTier
  })
  assert.ok(near(engine.enemyHealthMultiplier('guard'), 1.24))
  assert.ok(near(engine.enemyDamageMultiplier({ hostileToPlayer: true }), 1.18))
})

test('event cadence and threat waves follow the tier the run earned', () => {
  const { engine } = engineFixture('villain', { elapsed: 60 })
  engine.completeObjective(nodeId('villain', 'start'))
  engine.completeObjective(nodeId('villain', 'branch'))
  engine.completeObjective(nodeId('villain', 'alt'))
  frame(engine)
  assert.equal(engine.threatTier, 3)
  // The director's cooldown reads the earned tier: events come sooner after progress.
  assert.deepEqual(engine.eventCooldownRange(), eventCooldownRange(3))
  // Control: the clock's tier would have kept the slow tier-1 cadence.
  assert.notDeepEqual(eventCooldownRange(getEnemyScalingTier(engine.elapsed)), eventCooldownRange(3))

  // A wave is sized by the earned tier too: the production method asks the budget for three.
  const requests: number[] = []
  Reflect.set(engine, 'reserveActorSlotsUpTo', (_category: string, count: number) => {
    requests.push(count)
    return 0
  })
  Reflect.set(engine, 'spawnThreatWave', Reflect.get(GameEngine.prototype, 'spawnThreatWave'))
  assert.equal(engine.spawnThreatWave(engine.elapsed), 0)
  assert.deepEqual(requests, [3])
})

test('each line says what rose: attention for an earned tier, stronger enemies for the clock', () => {
  const { engine, notices } = engineFixture('guard', { elapsed: 60 })
  const said = (line: string) => notices.filter((notice) => notice.message === line).length
  engine.completeObjective(nodeId('guard', 'start'))
  engine.completeObjective(nodeId('guard', 'branch'))
  frame(engine)
  engine.completeObjective(nodeId('guard', 'contract'))
  frame(engine)
  assert.equal(said(describeThreatTier(2, MAX_THREAT_TIER, 'progress')), 1)
  assert.equal(said(describeThreatTier(3, MAX_THREAT_TIER, 'progress')), 1)
  assert.equal(
    notices.some((notice) => notice.message.includes('сильнее') || notice.message.includes('крепче')),
    false,
    'an earned tier claimed stronger enemies',
  )

  // The clock passes three minutes under the earned tier 3: the HUD does not move, the
  // enemies do, and the player is told so once. Non-vacuity: this tick is the one that
  // changed their stats, so a silent tick here would be a stat change nobody announced.
  const toughnessBefore = engine.enemyHealthMultiplier('villain')
  engine.elapsed = THREAT_TIER_SECONDS - 0.05
  for (let index = 0; index < 20; index += 1) frame(engine)
  assert.equal(engine.threatTier, 3)
  assert.ok(engine.enemyHealthMultiplier('villain') > toughnessBefore, 'the clock tick changed nothing')
  assert.equal(said(describeEnemiesStronger(2, MAX_THREAT_TIER)), 1)
  engine.elapsed = 2 * THREAT_TIER_SECONDS - 0.05
  for (let index = 0; index < 20; index += 1) frame(engine)
  assert.equal(said(describeEnemiesStronger(3, MAX_THREAT_TIER)), 1)

  // At nine minutes the clock overtakes the earned tier: both rise together, and the one
  // line that says so is the clock's, «сильнее» included — no second line for the same rise.
  engine.elapsed = 3 * THREAT_TIER_SECONDS - 0.05
  for (let index = 0; index < 20; index += 1) frame(engine)
  assert.equal(engine.threatTier, 4)
  assert.equal(said(describeThreatTier(4, MAX_THREAT_TIER, 'time')), 1)
  assert.equal(said(describeEnemiesStronger(4, MAX_THREAT_TIER)), 0)
  assert.ok(describeThreatTier(4, MAX_THREAT_TIER, 'time').includes('сильнее'))

  // Negative control: a continue derives what the clock already announced from `elapsed`,
  // so restoring at seven minutes says nothing; restoring with the field left at the launch
  // value would announce two tiers the player had already been told about.
  const continued = engineFixture('guard', { elapsed: 420 })
  continued.engine.threatTier = 3
  for (let index = 0; index < 20; index += 1) frame(continued.engine)
  assert.equal(continued.notices.filter((notice) => notice.message.startsWith('Время берёт своё')).length, 0)
  const stale = engineFixture('guard', { elapsed: 420 })
  stale.engine.threatTier = 3
  stale.engine.announcedScalingTier = 1
  for (let index = 0; index < 20; index += 1) frame(stale.engine)
  assert.equal(stale.notices.filter((notice) => notice.message.startsWith('Время берёт своё')).length, 1)
})
