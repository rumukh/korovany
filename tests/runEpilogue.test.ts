/**
 * The «походная сводка», and the two properties it is not allowed to lose.
 *
 * The roadmap's own risk for this initiative is **save growth**, and its mitigation is
 * "snapshot bounded ids and highlights only" plus "keep the rich сводка for the last ~5 runs
 * only". Both are claims about numbers, so both are measured here rather than asserted in
 * prose:
 *
 * - *Boundedness.* An adversarial snapshot — every square discovered, a full chronicle ring
 *   buffer, a squad of thirty — must still produce an epilogue inside every bound and under a
 *   stated byte budget. The control is the same snapshot projected **without** the bounds:
 *   if the unbounded projection did not blow the budget, the bounded one passing would mean
 *   nothing.
 * - *Decay.* Fifty finalized runs must leave exactly five сводки. The control is a profile
 *   hand-written with fifty of them: a decay that silently stopped happening would sail
 *   through a test that only ever finalizes five runs.
 *
 * The measured growth numbers this file produces are quoted in the pull request. They are
 * printed nowhere — a test that prints is a test nobody reads — but every one of them is
 * asserted against a ceiling, so the quoted number and the gate are the same number.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeRunEpilogue,
  formatActorRole,
  formatRunClock,
} from '../src/game/content/gameCopy.ts'
import {
  MAX_EPILOGUE_BEATS,
  MAX_EPILOGUE_COMPANIONS,
  MAX_EPILOGUE_DOCTRINES,
  MAX_EPILOGUE_ROUTE,
  MAX_EPILOGUE_WOUNDS,
  buildRunEpilogue,
  formatRegionIdLabel,
} from '../src/game/run/epilogue.ts'
import { PROFILE_SAVE_KEY } from '../src/game/run/runTypes.ts'
import type {
  ActiveRunSaveV3,
  ProfileSaveV1,
  RunEpilogue,
  RunHistorySummary,
} from '../src/game/run/runTypes.ts'
import {
  MAX_PROFILE_RUN_HISTORY,
  MAX_RICH_RUN_EPILOGUES,
  createDefaultProfile,
  finalizeRunSnapshot,
  normalizeActiveRunSaveV3,
  normalizeProfileSaveV1,
  saveProfile,
} from '../src/game/run/storage.ts'
import type { StorageLike } from '../src/game/run/storage.ts'
import type { ChronicleEvent } from '../src/game/world/Chronicle.ts'
import { CHRONICLE_LOG_LIMIT } from '../src/game/world/Chronicle.ts'

class MemoryStorage implements StorageLike {
  values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

/** What the profile blob actually costs on disk, in bytes rather than in code units. */
function profileBytes(storage: MemoryStorage): number {
  return Buffer.byteLength(storage.getItem(PROFILE_SAVE_KEY) ?? '', 'utf8')
}

function regionDelta(regionId: string, control: 'neutral' | 'elf' | 'guard' | 'villain') {
  return {
    version: 2 as const,
    regionId,
    revision: 3,
    clearedEncounterIds: [],
    defeatedActorIds: [],
    removedPropIds: [],
    collectedLootIds: [],
    completedInteractionIds: [],
    completedEventIds: [],
    chronicle: {
      control,
      pressure: { elf: 0.2, guard: 0.3, villain: 0.1 },
      beastPressure: 0.2,
      settlementIntegrity: 80,
      supply: 0.5,
      lastEventTick: 4,
    },
    state: {},
  }
}

interface RunShape {
  runId?: string
  status?: 'victory' | 'defeat' | 'abandoned'
  discovered?: string[]
  log?: ChronicleEvent[]
  companions?: ActiveRunSaveV3['companions']
  deltas?: string[]
  ending?: ActiveRunSaveV3['ending']
}

function makeTerminalRun(shape: RunShape = {}): ActiveRunSaveV3 {
  const runId = shape.runId ?? 'run-epilogue'
  const status = shape.status ?? 'defeat'
  const discovered = shape.discovered ?? [
    'region-0-0',
    'region-1-0',
    'region-1-1',
    'region-2-1',
  ]
  const deltaIds = shape.deltas ?? ['region-0-0', 'region-1-0', 'region-1-1', 'region-2-1']
  const run: ActiveRunSaveV3 = {
    version: 3,
    runId,
    config: {
      seed: 4_242_424,
      generatorVersion: 1,
      faction: 'elf',
      selectedBoonId: 'provisions',
    },
    status,
    startedAt: '2026-05-05T10:00:00.000Z',
    updatedAt: '2026-05-05T10:22:00.000Z',
    blueprintFingerprint: 'generator-1:4242424',
    currentLocation: {
      regionId: 'region-2-1',
      localPosition: [2, 1, 3],
      worldPosition: [220, 1, 140],
      heading: 0.5,
    },
    player: {
      health: 0,
      maxHealth: 100,
      stamina: 30,
      maxStamina: 100,
      gold: 214,
      kills: 37,
      damage: 24,
      body: {
        leftArm: 'healthy',
        rightArm: 'prosthetic',
        leftLeg: 'wounded',
        rightLeg: 'healthy',
        leftEye: 'missing',
        rightEye: 'healthy',
        bleeding: 0.6,
      },
      objectives: [
        { id: 'reach', text: 'Дойти', done: true },
        { id: 'clear', text: 'Зачистить', done: true },
        { id: 'finale', text: 'Финал', done: status === 'victory' },
      ],
      upgrades: { blade: 2, vitality: 1, endurance: 0 },
    },
    companions: shape.companions ?? [
      {
        id: 'ally-1',
        role: 'soldier',
        health: 40,
        maxHealth: 60,
        worldPosition: [1, 0, 1],
      },
      {
        id: 'ally-2',
        role: 'soldier',
        health: 12,
        maxHealth: 60,
        worldPosition: [2, 0, 1],
      },
      {
        id: 'ally-3',
        role: 'archer',
        health: 25,
        maxHealth: 45,
        worldPosition: [3, 0, 1],
      },
    ],
    discoveredRegionIds: discovered,
    regionDeltas: Object.fromEntries(
      deltaIds.map((id, index) => [
        id,
        regionDelta(id, (['elf', 'guard', 'villain', 'neutral'] as const)[index % 4]),
      ]),
    ),
    directorState: { elapsed: 754 },
    eventState: {},
    chronicleState: {
      tick: 40,
      factionStrength: { elf: 0.6, guard: 0.5, villain: 0.4 },
      caravans: [],
      log: shape.log ?? [
        {
          id: 'chronicle-4-1',
          tick: 4,
          kind: 'caravanArrived',
          regionId: 'region-0-0',
          faction: 'guard',
          siteId: null,
        },
        {
          id: 'chronicle-9-1',
          tick: 9,
          kind: 'settlementBurned',
          regionId: 'region-1-1',
          faction: 'villain',
          siteId: null,
        },
        {
          id: 'chronicle-14-1',
          tick: 14,
          kind: 'regionCaptured',
          regionId: 'region-2-1',
          faction: 'elf',
          siteId: null,
        },
        {
          id: 'chronicle-20-1',
          tick: 20,
          kind: 'beastRaid',
          regionId: 'region-4-4',
          faction: null,
          siteId: null,
        },
      ],
    },
    rngStates: { combat: 11, director: 22, event: 33, loot: 44, chronicle: 55 },
    achievementRunState: {
      runId,
      faction: 'elf',
      startedAt: '2026-05-05T10:00:00.000Z',
      kills: 37,
      killsSinceDamage: 0,
      bestKillStreak: 9,
      damageTaken: 220,
      injuries: 3,
      limbsLost: 1,
      goldEarned: 340,
      purchases: 2,
      objectivesCompleted: status === 'victory' ? 3 : 2,
      eventsCompleted: 4,
      abilitiesUsed: 11,
      shieldBlocks: 0,
      squadCommands: 3,
      caravansRobbed: 2,
      zonesVisited: ['forest', 'neutral'],
      eventKindsCompleted: ['rescue'],
      unlockedIds: ['first-march'],
      result: status === 'abandoned' ? null : status,
      elapsedAtEnd: 754,
      healthAtEnd: 0,
    },
    ...(shape.ending === undefined ? {} : { ending: shape.ending }),
  }
  const normalized = normalizeActiveRunSaveV3(run)
  assert.ok(normalized, 'the test fixture itself must be a valid save')
  return normalized
}

// ---------------------------------------------------------------------------
// What the сводка says
// ---------------------------------------------------------------------------

test('the epilogue carries the route, the map, three beats, the body, the squad and a cause', () => {
  const epilogue = buildRunEpilogue(
    makeTerminalRun({ ending: { cause: 'beast', role: 'bear' } }),
  )

  assert.deepEqual(epilogue.route, ['A1', 'B1', 'B2', 'C2'])
  assert.equal(epilogue.routeTotal, 4)
  assert.equal(epilogue.regionsTotal, 25)
  assert.equal(epilogue.finalRegion, 'C2')
  assert.equal(
    epilogue.route[epilogue.route.length - 1],
    epilogue.finalRegion,
    'a route that ends somewhere other than the body reads as a contradiction',
  )
  assert.deepEqual(epilogue.control, { elf: 1, guard: 1, villain: 1, neutral: 1 })

  // Three beats out of four candidates, and the one dropped is the quiet one that happened
  // where the player never went.
  assert.equal(epilogue.beats.length, 3)
  assert.deepEqual(
    epilogue.beats.map((beat) => beat.kind),
    ['settlementBurned', 'regionCaptured', 'beastRaid'],
  )
  assert.deepEqual(
    epilogue.beats.map((beat) => beat.region),
    ['B2', 'C2', 'E5'],
  )
  // Ordered by tick, so the сводка reads forwards even though the ranking is by loudness.
  assert.deepEqual(
    epilogue.beats.map((beat) => beat.tick),
    [9, 14, 20],
  )

  assert.deepEqual(epilogue.wounds, [
    { part: 'rightArm', status: 'prosthetic' },
    { part: 'leftLeg', status: 'wounded' },
    { part: 'leftEye', status: 'missing' },
  ])
  assert.equal(epilogue.bleeding, true)
  assert.equal(epilogue.limbsLost, 1)
  assert.equal(epilogue.injuries, 3)

  assert.deepEqual(epilogue.companions, [
    { role: 'soldier', count: 2 },
    { role: 'archer', count: 1 },
  ])
  // Roadmap 1.6 fills this. Until then an empty list is the correct answer, not a stub.
  assert.deepEqual(epilogue.doctrines, [])

  assert.equal(epilogue.cause, 'beast')
  assert.equal(epilogue.causeRole, 'bear')
  assert.equal(epilogue.elapsed, 754)
  assert.equal(epilogue.caravansRobbed, 2)
  assert.equal(epilogue.eventsCompleted, 4)
  assert.equal(epilogue.bestKillStreak, 9)
})

test('the terminal state decides the cause when the engine recorded none', () => {
  // A victory is never "killed by" anything, an abandoned run is nobody's kill, and a defeat
  // from a save that predates the engine recording a cause says so rather than picking one.
  assert.equal(buildRunEpilogue(makeTerminalRun({ status: 'victory' })).cause, 'objectives')
  assert.equal(buildRunEpilogue(makeTerminalRun({ status: 'abandoned' })).cause, 'abandoned')
  assert.equal(buildRunEpilogue(makeTerminalRun({ status: 'defeat' })).cause, 'unknown')
  assert.equal(
    buildRunEpilogue(makeTerminalRun({ ending: { cause: 'bleeding' } })).causeRole,
    null,
  )
})

test('three beats are three stories, not one square reported three times', () => {
  // A contested square changes hands repeatedly, and the highest-ranked three events of a
  // run can easily all be the same sentence about the same place. Found in the browser: the
  // сводка read "В квадрате D4 сменился хозяин" three times, and React refused the list.
  const repeated: ChronicleEvent[] = [
    { id: 'c-1', tick: 5, kind: 'regionCaptured', regionId: 'region-3-3', faction: 'villain', siteId: null },
    { id: 'c-2', tick: 9, kind: 'regionCaptured', regionId: 'region-3-3', faction: 'guard', siteId: null },
    { id: 'c-3', tick: 12, kind: 'regionCaptured', regionId: 'region-3-3', faction: 'villain', siteId: null },
    { id: 'c-4', tick: 15, kind: 'beastRaid', regionId: 'region-1-1', faction: null, siteId: null },
    { id: 'c-5', tick: 18, kind: 'caravanArrived', regionId: 'region-0-0', faction: 'elf', siteId: null },
  ]
  const beats = buildRunEpilogue(makeTerminalRun({ log: repeated })).beats
  assert.equal(beats.length, 3)
  assert.equal(
    new Set(beats.map((beat) => `${beat.kind}:${beat.region}`)).size,
    3,
    'the same square and kind was reported twice',
  )

  // But a run whose entire chronicle happened in one square still gets three beats: dropping
  // to one would be a different kind of lie about a quiet run.
  const monotonous: ChronicleEvent[] = [
    { id: 'm-1', tick: 2, kind: 'regionCaptured', regionId: 'region-2-2', faction: 'elf', siteId: null },
    { id: 'm-2', tick: 4, kind: 'regionCaptured', regionId: 'region-2-2', faction: 'guard', siteId: null },
    { id: 'm-3', tick: 6, kind: 'regionCaptured', regionId: 'region-2-2', faction: 'elf', siteId: null },
  ]
  assert.equal(buildRunEpilogue(makeTerminalRun({ log: monotonous })).beats.length, 3)
})

test('a dead companion is not a surviving one', () => {
  const epilogue = buildRunEpilogue(
    makeTerminalRun({
      companions: [
        { id: 'ally-1', role: 'soldier', health: 0, maxHealth: 60, worldPosition: [0, 0, 0] },
        { id: 'ally-2', role: 'scout', health: 4, maxHealth: 40, worldPosition: [1, 0, 0] },
      ],
    }),
  )
  assert.deepEqual(epilogue.companions, [{ role: 'scout', count: 1 }])
})

test('building an epilogue twice gives the same сводка, and reads no clock or random stream', () => {
  // Determinism control, in the idiom `tests/hints.test.ts` established: a draw taken for a
  // terminal screen would shift every roll of a run that is still being replayed elsewhere,
  // and wall-clock time is not part of a seeded run.
  const snapshot = makeTerminalRun({ ending: { cause: 'faction', role: 'brute' } })
  const realRandom = Math.random
  const realNow = Date.now
  const realPerformanceNow = performance.now
  const forbidden = (name: string) => () => {
    throw new Error(`the epilogue read ${name}`)
  }
  Math.random = forbidden('Math.random') as typeof Math.random
  Date.now = forbidden('Date.now') as typeof Date.now
  performance.now = forbidden('performance.now') as typeof performance.now
  let first: RunEpilogue
  let second: RunEpilogue
  try {
    first = buildRunEpilogue(snapshot)
    second = buildRunEpilogue(snapshot)
  } finally {
    Math.random = realRandom
    Date.now = realNow
    performance.now = realPerformanceNow
  }
  assert.deepEqual(first, second)
  // Non-vacuity: two empty objects are also deeply equal.
  assert.ok(first.beats.length > 0 && first.route.length > 0)
})

// ---------------------------------------------------------------------------
// Bounded, and measured against the unbounded projection
// ---------------------------------------------------------------------------

/**
 * The per-сводка byte ceiling.
 *
 * Five of these ride in a blob rewritten on every save, so the number that matters is
 * `5 × this`, and it is deliberately small enough to disappear next to the fifty thin
 * summaries the profile already carried.
 */
const EPILOGUE_BYTE_BUDGET = 1_100

function adversarialRun(): ActiveRunSaveV3 {
  const discovered: string[] = []
  for (let x = 0; x < 5; x += 1) {
    for (let z = 0; z < 5; z += 1) discovered.push(`region-${String(x)}-${String(z)}`)
  }
  const log: ChronicleEvent[] = []
  for (let index = 0; index < CHRONICLE_LOG_LIMIT; index += 1) {
    log.push({
      id: `chronicle-${String(index)}-1`,
      tick: index,
      kind: index % 2 === 0 ? 'settlementBurned' : 'regionCaptured',
      regionId: discovered[index % discovered.length],
      faction: 'villain',
      siteId: 'site-settlement-crossroads',
    })
  }
  const companions: NonNullable<ActiveRunSaveV3['companions']> = []
  for (let index = 0; index < 30; index += 1) {
    companions.push({
      id: `ally-${String(index)}`,
      role: (['soldier', 'scout', 'archer', 'brute', 'champion', 'minion', 'captive'] as const)[
        index % 7
      ],
      health: 30,
      maxHealth: 60,
      worldPosition: [index, 0, index],
    })
  }
  return makeTerminalRun({
    runId: 'run-adversarial',
    discovered,
    deltas: discovered,
    log,
    companions,
    ending: { cause: 'faction', role: 'champion' },
  })
}

test('a maximal run still produces a bounded сводка, and the unbounded one would not', () => {
  const snapshot = adversarialRun()
  const epilogue = buildRunEpilogue(snapshot)

  assert.equal(epilogue.route.length, MAX_EPILOGUE_ROUTE)
  assert.equal(epilogue.beats.length, MAX_EPILOGUE_BEATS)
  assert.ok(epilogue.wounds.length <= MAX_EPILOGUE_WOUNDS)
  assert.equal(epilogue.companions.length, MAX_EPILOGUE_COMPANIONS)
  assert.ok(epilogue.doctrines.length <= MAX_EPILOGUE_DOCTRINES)
  // Truncated, but honest about it: the full count is still reported, and the square the run
  // ended in is still the square the route ends on.
  assert.equal(epilogue.routeTotal, 25)
  assert.equal(epilogue.route[epilogue.route.length - 1], epilogue.finalRegion)
  assert.equal(epilogue.finalRegion, 'C2')
  assert.equal(new Set(epilogue.route).size, epilogue.route.length, 'a square is printed twice')

  const bounded = Buffer.byteLength(JSON.stringify(epilogue), 'utf8')
  assert.ok(
    bounded <= EPILOGUE_BYTE_BUDGET,
    `a maximal сводка cost ${String(bounded)} bytes, over the ${String(EPILOGUE_BYTE_BUDGET)} budget`,
  )

  // The control. Project the same snapshot with the bounds removed: if this did not blow the
  // budget, the bounded result passing would be telling us nothing about the bounds.
  const unbounded = Buffer.byteLength(
    JSON.stringify({
      ...epilogue,
      route: snapshot.discoveredRegionIds.map(formatRegionIdLabel),
      beats: snapshot.chronicleState.log,
      companions: snapshot.companions,
    }),
    'utf8',
  )
  assert.ok(
    unbounded > EPILOGUE_BYTE_BUDGET * 4,
    `the unbounded projection cost only ${String(unbounded)} bytes against a ${String(
      EPILOGUE_BYTE_BUDGET,
    )} budget — the bounds are not doing the work this test claims`,
  )
})

// ---------------------------------------------------------------------------
// The decay
// ---------------------------------------------------------------------------

function finalizeRuns(storage: MemoryStorage, count: number): void {
  const raw = storage.getItem(PROFILE_SAVE_KEY)
  const already = raw ? ((JSON.parse(raw) as ProfileSaveV1).finalizedRunIds.length ?? 0) : 0
  for (let index = already; index < already + count; index += 1) {
    const result = finalizeRunSnapshot(
      storage,
      makeTerminalRun({
        runId: `run-${String(index).padStart(3, '0')}`,
        status: index % 3 === 0 ? 'victory' : 'defeat',
        ending: { cause: 'faction', role: 'brute' },
      }),
    )
    assert.equal(result.outcome, 'finalized', `run ${String(index)} did not finalize`)
  }
}

function historyFrom(storage: MemoryStorage): RunHistorySummary[] {
  const raw = storage.getItem(PROFILE_SAVE_KEY)
  assert.ok(raw)
  const profile = normalizeProfileSaveV1(JSON.parse(raw) as unknown)
  assert.ok(profile)
  return profile.runHistory
}

test('the newest five runs keep a сводка and the sixth decays the oldest', () => {
  const storage = new MemoryStorage()
  finalizeRuns(storage, MAX_RICH_RUN_EPILOGUES)
  assert.equal(
    historyFrom(storage).filter((summary) => summary.epilogue).length,
    MAX_RICH_RUN_EPILOGUES,
    'five runs should all still be rich',
  )

  finalizeRuns(storage, 1)
  const history = historyFrom(storage)
  assert.equal(history.length, MAX_RICH_RUN_EPILOGUES + 1)
  assert.deepEqual(
    history.map((summary) => summary.epilogue !== undefined),
    [true, true, true, true, true, false],
    'the sixth run did not push the oldest сводка off the end',
  )

  // The decayed entry is a thin summary, not a broken one: everything the profile screen and
  // the reward maths read is still there.
  const decayed = history[history.length - 1]
  assert.equal(decayed.runId, 'run-000')
  assert.equal(decayed.epilogue, undefined)
  assert.equal(decayed.seed, 4_242_424)
  assert.equal(decayed.kills, 37)
  assert.ok(decayed.profileCurrencyEarned > 0)
})

test('a profile hand-written with fifty сводки is normalized down to five', () => {
  // The control for a decay that silently stops happening. A test that only ever finalizes
  // six runs would keep passing if the bound were removed and the profile simply never grew
  // past six; this one starts from the state such a bug produces.
  const epilogue = buildRunEpilogue(makeTerminalRun())
  const base = createDefaultProfile()
  const rich: RunHistorySummary[] = []
  for (let index = 0; index < MAX_PROFILE_RUN_HISTORY; index += 1) {
    rich.push({
      runId: `history-${String(index)}`,
      status: 'defeat',
      seed: index,
      generatorVersion: 1,
      faction: 'guard',
      selectedBoonId: 'provisions',
      startedAt: '2026-05-05T10:00:00.000Z',
      endedAt: '2026-05-05T10:20:00.000Z',
      kills: index,
      objectivesCompleted: 1,
      endingGold: 10,
      profileCurrencyEarned: 20,
      blueprintFingerprint: `fingerprint-${String(index)}`,
      epilogue,
    })
  }
  // Non-vacuity: the input really does carry fifty of them.
  assert.equal(rich.filter((summary) => summary.epilogue).length, MAX_PROFILE_RUN_HISTORY)

  const normalized = normalizeProfileSaveV1({ ...base, runHistory: rich })
  assert.ok(normalized)
  assert.equal(normalized.runHistory.length, MAX_PROFILE_RUN_HISTORY)
  assert.equal(
    normalized.runHistory.filter((summary) => summary.epilogue).length,
    MAX_RICH_RUN_EPILOGUES,
  )
  assert.deepEqual(
    normalized.runHistory.slice(MAX_RICH_RUN_EPILOGUES).map((summary) => summary.epilogue),
    Array.from({ length: MAX_PROFILE_RUN_HISTORY - MAX_RICH_RUN_EPILOGUES }, () => undefined),
  )

  // And the decay survives the write, not just the read: a profile saved from this state is
  // stored thin, so the cost is never paid again.
  const storage = new MemoryStorage()
  assert.equal(saveProfile(storage, { ...base, runHistory: rich }), true)
  assert.equal(
    historyFrom(storage).filter((summary) => summary.epilogue).length,
    MAX_RICH_RUN_EPILOGUES,
  )
})

test('save growth stays flat once the сводки start decaying', () => {
  // The measured claim. Runs one to five each add a rich entry; every run after that adds a
  // thin one, so the marginal cost must fall and stay fallen.
  const storage = new MemoryStorage()
  finalizeRuns(storage, 1)
  const afterOne = profileBytes(storage)
  finalizeRuns(storage, 4)
  const afterFive = profileBytes(storage)
  const richMarginal = (afterFive - afterOne) / 4

  const before = storage.values.size
  finalizeRuns(storage, 45)
  const afterFifty = profileBytes(storage)
  const thinMarginal = (afterFifty - afterFive) / 45
  assert.equal(storage.values.size, before, 'finalization should not spill into new keys')

  assert.ok(
    thinMarginal < richMarginal / 2,
    `a decayed run costs ${String(Math.round(thinMarginal))} bytes against a rich run's ${String(
      Math.round(richMarginal),
    )} — the decay is not flattening the curve`,
  )
  assert.ok(
    thinMarginal < 400,
    `a decayed run costs ${String(Math.round(thinMarginal))} bytes, which is no longer a thin summary`,
  )

  // A hundred runs is a heavy player's whole profile. History is capped at fifty and only
  // five of those are rich, so the blob has to have stopped growing on the history axis.
  finalizeRuns(storage, 50)
  const afterHundred = profileBytes(storage)
  assert.ok(
    afterHundred - afterFifty < (afterFifty - afterFive) / 2,
    `runs 51-100 added ${String(afterHundred - afterFifty)} bytes against runs 6-50's ${String(
      afterFifty - afterFive,
    )}`,
  )
  assert.ok(
    afterHundred < 32_768,
    `a hundred-run profile is ${String(afterHundred)} bytes, which is no longer small`,
  )
  assert.equal(historyFrom(storage).length, MAX_PROFILE_RUN_HISTORY)
})

// ---------------------------------------------------------------------------
// Round trip, and what a сводка is not allowed to smuggle
// ---------------------------------------------------------------------------

test('a сводка survives a save and load unchanged', () => {
  const storage = new MemoryStorage()
  const finalized = finalizeRunSnapshot(
    storage,
    makeTerminalRun({ ending: { cause: 'beast', role: 'troll' } }),
  )
  assert.equal(finalized.outcome, 'finalized')
  assert.deepEqual(historyFrom(storage)[0].epilogue, finalized.summary?.epilogue)
})

test('a malformed сводка is discarded with the profile rather than repaired', () => {
  // The project's policy is discard-and-report, not migrate. A сводка that half-parses would
  // be a story that quietly lies, so it fails the whole profile exactly like any other
  // malformed field — while an *absent* one is simply a decayed entry.
  const storage = new MemoryStorage()
  finalizeRuns(storage, 1)
  const raw = storage.getItem(PROFILE_SAVE_KEY)
  assert.ok(raw)
  const profile = JSON.parse(raw) as ProfileSaveV1

  assert.ok(normalizeProfileSaveV1(profile), 'the fixture profile must start out valid')

  for (const mutate of [
    (epilogue: RunEpilogue) => ({ ...epilogue, cause: 'devoured-by-lore' }),
    (epilogue: RunEpilogue) => ({ ...epilogue, beats: [{ kind: 'notAKind' }] }),
    (epilogue: RunEpilogue) => ({ ...epilogue, bleeding: 'yes' }),
    (epilogue: RunEpilogue) => ({
      ...epilogue,
      route: Array.from({ length: MAX_EPILOGUE_ROUTE + 1 }, () => 'A1'),
    }),
    (epilogue: RunEpilogue) => ({ ...epilogue, control: { elf: 'many' } }),
  ]) {
    const broken = {
      ...profile,
      runHistory: profile.runHistory.map((summary) => ({
        ...summary,
        epilogue: mutate(summary.epilogue as RunEpilogue),
      })),
    }
    assert.equal(normalizeProfileSaveV1(broken), null)
  }

  const decayed = {
    ...profile,
    runHistory: profile.runHistory.map(({ epilogue: _dropped, ...thin }) => thin),
  }
  assert.ok(normalizeProfileSaveV1(decayed), 'an absent сводка is a decayed entry, not a fault')
})

test('a beast cannot be smuggled into the squad through a сводка', () => {
  const storage = new MemoryStorage()
  finalizeRuns(storage, 1)
  const raw = storage.getItem(PROFILE_SAVE_KEY)
  assert.ok(raw)
  const profile = JSON.parse(raw) as ProfileSaveV1
  const smuggled = {
    ...profile,
    runHistory: profile.runHistory.map((summary) => ({
      ...summary,
      epilogue: {
        ...(summary.epilogue as RunEpilogue),
        companions: [{ role: 'wolf', count: 3 }],
      },
    })),
  }
  assert.equal(normalizeProfileSaveV1(smuggled), null)
})

// ---------------------------------------------------------------------------
// The postcard
// ---------------------------------------------------------------------------

test('the postcard names the seed, the route, the beats and the cause, in Russian', () => {
  const snapshot = makeTerminalRun({
    status: 'victory',
    ending: { cause: 'objectives' },
  })
  const storage = new MemoryStorage()
  const finalized = finalizeRunSnapshot(storage, snapshot)
  const summary = finalized.summary
  assert.ok(summary?.epilogue)

  const copy = describeRunEpilogue(summary, summary.epilogue)
  assert.match(copy.title, /^Походная сводка/)
  assert.ok(copy.subtitle.includes('seed 4242424'))
  assert.ok(copy.subtitle.includes('лесные эльфы'))
  assert.ok(copy.subtitle.includes(formatRunClock(754)))
  assert.equal(formatRunClock(754), '12:34')
  assert.ok(copy.route.includes('A1 → B1 → B2 → C2'))
  assert.ok(copy.route.includes('4 квадрата из 25'))
  assert.equal(copy.beats.length, 3)
  assert.ok(copy.body.includes('правая рука — протез'))
  assert.ok(copy.squad.includes('2 солдата'))
  assert.ok(copy.cause.includes('все задачи закрыты'))
  // Doctrines are roadmap 1.6. Nothing at all, rather than an empty heading.
  assert.equal(copy.doctrines, null)
  assert.equal(copy.text.includes('Доктрины'), false)

  // The copyable block is the panel: every line a reader was shown is in the text they paste.
  for (const line of [copy.subtitle, copy.route, copy.map, copy.body, copy.squad, copy.cause]) {
    assert.ok(copy.text.includes(line), `the copyable text dropped "${line}"`)
  }
  for (const beat of copy.beats) assert.ok(copy.text.includes(beat))
  assert.ok(copy.text.includes('Повторить этот мир: seed 4242424'))
  // Cyrillic, because there is no i18n layer and there is not going to be one.
  assert.match(copy.text, /[А-Яа-я]/)
})

test('every cause and every killer role produces a finished sentence', () => {
  const storage = new MemoryStorage()
  const finalized = finalizeRunSnapshot(storage, makeTerminalRun())
  const summary = finalized.summary
  assert.ok(summary?.epilogue)
  const base = summary.epilogue

  const causes = ['objectives', 'faction', 'beast', 'bleeding', 'abandoned', 'unknown'] as const
  const roles = [
    'soldier',
    'scout',
    'commander',
    'minion',
    'archer',
    'brute',
    'champion',
    'captive',
    'peasant',
    'wolf',
    'boar',
    'bear',
    'troll',
  ] as const
  for (const cause of causes) {
    for (const role of [null, ...roles]) {
      const copy = describeRunEpilogue(summary, { ...base, cause, causeRole: role })
      assert.match(copy.cause, /^Итог: .+[.!]$/, `${cause}/${String(role)} is not a sentence`)
      if (role) assert.equal(typeof formatActorRole(role), 'string')
    }
  }
})

test('an empty run reads as an empty run rather than as a broken one', () => {
  const storage = new MemoryStorage()
  const finalized = finalizeRunSnapshot(
    storage,
    makeTerminalRun({
      runId: 'run-empty',
      discovered: [],
      deltas: [],
      log: [],
      companions: [],
    }),
  )
  const summary = finalized.summary
  assert.ok(summary?.epilogue)
  const copy = describeRunEpilogue(summary, summary.epilogue)
  assert.deepEqual(copy.beats, [])
  assert.ok(copy.route.includes('с места так и не сдвинулись'))
  assert.ok(copy.map.includes('разведка не доложила'))
  assert.ok(copy.squad.includes('не дошёл никто'))
  assert.equal(copy.text.includes('Летопись'), false)
})
