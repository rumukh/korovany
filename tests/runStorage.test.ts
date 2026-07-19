import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_STARTING_BOON_IDS,
  computeRunCompletionReward,
  getStartingBoonEffects,
  selectProfileBoon,
  unlockBoon,
  validateBoonSelection,
} from '../src/game/run/profile.ts'
import {
  ACTIVE_RUN_SAVE_KEY,
  PROFILE_SAVE_KEY,
} from '../src/game/run/runTypes.ts'
import type {
  ActiveRunSaveV2,
  ProfileSaveV1,
  RunHistorySummary,
} from '../src/game/run/runTypes.ts'
import {
  MAX_PROFILE_RUN_HISTORY,
  createDefaultProfile,
  finalizeActiveRun,
  finalizeRunSnapshot,
  loadActiveRun,
  loadProfile,
  normalizeActiveRunSaveV2,
  normalizeProfileSaveV1,
  parseActiveRunSaveV2,
  removeProfile,
  saveActiveRun,
  saveProfile,
} from '../src/game/run/storage.ts'
import type { StorageLike } from '../src/game/run/storage.ts'
import { RegionManager } from '../src/game/world/RegionManager.ts'
import { RegionRuntime } from '../src/game/world/RegionRuntime.ts'

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

class ControlledProfileStorage extends MemoryStorage {
  failProfileWrites = false
  profileWriteAttempts = 0

  setItem(key: string, value: string): void {
    if (key === PROFILE_SAVE_KEY) {
      this.profileWriteAttempts += 1
      if (this.failProfileWrites) throw new Error('profile write failed')
    }
    super.setItem(key, value)
  }
}

function createSingleRegionWorld(regionId = 'forest-1') {
  return {
    seed: 'run-storage-test',
    regionSize: 10,
    bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
    regions: [
      {
        id: regionId,
        coordinate: { x: 0, z: 0 },
        bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
        biomeId: 'forest',
        heightProfile: { baseHeight: 0, amplitude: 0 },
      },
    ],
  }
}

function makeRun(runId = 'run-alpha'): ActiveRunSaveV2 {
  return {
    version: 2,
    runId,
    config: {
      seed: 0x1234_abcd,
      generatorVersion: 3,
      faction: 'elf',
      selectedBoonId: 'provisions',
      modifiers: ['night', 'scarce-shops'],
    },
    status: 'active',
    startedAt: '2026-01-02T03:04:05.000Z',
    updatedAt: '2026-01-02T03:14:05.000Z',
    blueprintFingerprint: 'generator-3:1234abcd',
    currentLocation: {
      regionId: 'forest-2',
      localPosition: [3, 1, -4],
      worldPosition: [103, 1, 196],
      heading: 1.25,
    },
    player: {
      health: 72,
      maxHealth: 100,
      stamina: 64,
      maxStamina: 100,
      gold: 37,
      kills: 9,
      damage: 27,
      body: {
        leftArm: 'healthy',
        rightArm: 'wounded',
        leftLeg: 'healthy',
        rightLeg: 'healthy',
        leftEye: 'healthy',
        rightEye: 'healthy',
        bleeding: 0.5,
      },
      objectives: [
        { id: 'reach-fort', text: 'Reach the fort', done: true },
        { id: 'find-scout', text: 'Find the scout', done: false, progress: 1, target: 3 },
      ],
      upgrades: { blade: 1, vitality: 2, endurance: 0 },
    },
    discoveredRegionIds: ['forest-1', 'forest-2'],
    regionDeltas: {
      'forest-1': {
        version: 1,
        regionId: 'forest-1',
        revision: 5,
        clearedEncounterIds: ['ambush-1'],
        defeatedActorIds: ['captain-1'],
        removedPropIds: ['gate-1'],
        collectedLootIds: ['chest-1'],
        completedInteractionIds: ['shrine-1'],
        completedEventIds: ['rescue-1'],
        state: {
          weather: 'rain',
          encounter: { phase: 2, reinforcements: [1, 3] },
        },
      },
    },
    directorState: {
      elapsedSeconds: 600,
      threat: { tier: 2, budget: 12.5 },
    },
    eventState: {
      activeEventId: null,
      completedEventIds: ['rescue-1'],
    },
    rngStates: {
      world: 123,
      encounters: 456,
      loot: 789,
    },
    achievementRunState: {
      runId,
      faction: 'elf',
      startedAt: '2026-01-02T03:04:05.000Z',
      kills: 9,
      killsSinceDamage: 2,
      bestKillStreak: 4,
      damageTaken: 28,
      injuries: 1,
      limbsLost: 0,
      goldEarned: 75,
      purchases: 2,
      objectivesCompleted: 1,
      eventsCompleted: 1,
      abilitiesUsed: 4,
      shieldBlocks: 0,
      squadCommands: 2,
      caravansRobbed: 0,
      zonesVisited: ['forest', 'neutral'],
      eventKindsCompleted: ['rescue'],
      unlockedIds: ['first-march'],
      result: null,
      elapsedAtEnd: 0,
      healthAtEnd: 0,
    },
  }
}

function makeTerminalRun(
  runId = 'run-alpha',
  status: 'victory' | 'defeat' = 'victory',
): ActiveRunSaveV2 {
  const run = makeRun(runId)
  run.status = status
  run.updatedAt = '2026-01-02T04:00:00.000Z'
  run.achievementRunState.result = status
  return run
}

function makeSummary(index: number): RunHistorySummary {
  return {
    runId: `history-${index}`,
    status: index % 2 === 0 ? 'victory' : 'defeat',
    seed: index,
    generatorVersion: 3,
    faction: 'guard',
    selectedBoonId: 'scout-map',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:20:00.000Z',
    kills: index,
    objectivesCompleted: 2,
    endingGold: 10,
    profileCurrencyEarned: 20,
    blueprintFingerprint: `fingerprint-${index}`,
  }
}

test('active runs and profiles round-trip without touching legacy storage', () => {
  const storage = new MemoryStorage()
  storage.setItem('korovany-save-v1', '{"legacy":true}')
  storage.setItem('korovany-achievements-v1', '{"version":1}')
  const run = makeRun()
  const profile: ProfileSaveV1 = {
    ...createDefaultProfile(),
    profileCurrency: 83,
    unlockedContentIds: ['region-marsh'],
    unlockedCosmeticIds: ['red-cloak'],
    selectedBoonId: 'scout-map',
    selectedFaction: 'guard',
  }

  assert.equal(saveActiveRun(storage, run), true)
  assert.deepEqual(loadActiveRun(storage), run)
  assert.equal(saveProfile(storage, profile), true)
  assert.deepEqual(loadProfile(storage), profile)
  assert.equal(storage.getItem('korovany-save-v1'), '{"legacy":true}')
  assert.equal(storage.getItem('korovany-achievements-v1'), '{"version":1}')

  assert.equal(removeProfile(storage), true)
  assert.deepEqual(loadProfile(storage), createDefaultProfile())
})

test('runtime region deltas survive manager extraction, active-run storage, and reapplication', () => {
  const world = createSingleRegionWorld()
  const sourceManager = new RegionManager(world as never)
  sourceManager.update('forest-1' as never)
  const runtime = sourceManager.getRuntime('forest-1' as never) as RegionRuntime
  runtime.markEncounterCleared('ambush-1')
  runtime.markActorDefeated('captain-1')
  runtime.markPropRemoved('gate-1')
  runtime.markLootCollected('chest-1')
  runtime.markInteractionCompleted('shrine-1')
  runtime.markEventCompleted('rescue-1')
  runtime.setDeltaValue('simulation', {
    phase: 3,
    waves: [{ actorIds: ['scout-1', 'scout-2'] }],
    flags: { alarmed: true, boss: null },
  })

  const expected = runtime.extractDelta()
  const managerState = sourceManager.saveState()
  assert.deepEqual(managerState.deltas['forest-1'], expected)

  const run = makeRun()
  run.regionDeltas = managerState.deltas
  const normalized = normalizeActiveRunSaveV2(run)
  assert.ok(normalized)
  assert.deepEqual(normalized.regionDeltas['forest-1'], expected)

  managerState.deltas['forest-1'].clearedEncounterIds.push('tampered')
  ;(
    managerState.deltas['forest-1'].state.simulation as {
      waves: { actorIds: string[] }[]
    }
  ).waves[0].actorIds.push('tampered')
  assert.deepEqual(normalized.regionDeltas['forest-1'], expected)

  const storage = new MemoryStorage()
  assert.equal(saveActiveRun(storage, normalized), true)
  const loaded = loadActiveRun(storage)
  assert.ok(loaded)
  assert.deepEqual(loaded.regionDeltas['forest-1'], expected)

  const restoredManager = new RegionManager(world as never)
  assert.equal(
    restoredManager.applyState({
      version: 1,
      currentRegionId: 'forest-1',
      discoveredRegionIds: ['forest-1'],
      deltas: loaded.regionDeltas,
    }),
    true,
  )
  loaded.regionDeltas['forest-1'].completedEventIds.push('tampered')
  ;(
    loaded.regionDeltas['forest-1'].state.simulation as {
      waves: { actorIds: string[] }[]
    }
  ).waves[0].actorIds.push('tampered')

  assert.deepEqual(
    loadActiveRun(storage)?.regionDeltas['forest-1'],
    expected,
  )
  restoredManager.update()
  const restoredRuntime = restoredManager.getRuntime(
    'forest-1' as never,
  ) as RegionRuntime
  assert.deepEqual(restoredRuntime.extractDelta(), expected)

  sourceManager.dispose()
  restoredManager.dispose()
})

test('active-run normalization rejects mismatched region keys and malformed deltas', () => {
  const mismatched = makeRun()
  mismatched.regionDeltas['forest-1'] = {
    ...mismatched.regionDeltas['forest-1'],
    regionId: 'forest-2',
  }
  assert.equal(normalizeActiveRunSaveV2(mismatched), null)
  assert.equal(saveActiveRun(new MemoryStorage(), mismatched), false)

  const malformed = structuredClone(makeRun()) as unknown as {
    regionDeltas: Record<string, { completedEventIds?: string[] }>
  }
  delete malformed.regionDeltas['forest-1'].completedEventIds
  assert.equal(normalizeActiveRunSaveV2(malformed), null)
})

test('active-run normalization preserves bounded rescued companions defensively', () => {
  const run = makeRun()
  run.companions = [
    {
      id: 'rescued-captive-1',
      role: 'captive',
      health: 48,
      maxHealth: 70,
      worldPosition: [112, 2, 204],
    },
  ]
  const normalized = normalizeActiveRunSaveV2(run)
  assert.ok(normalized)
  assert.deepEqual(normalized.companions, run.companions)

  run.companions[0].worldPosition[0] = 999
  assert.deepEqual(normalized.companions?.[0].worldPosition, [112, 2, 204])
  assert.equal(
    normalizeActiveRunSaveV2({
      ...makeRun(),
      companions: [
        {
          id: 'invalid-companion',
          role: 'commander',
          health: 10,
          maxHealth: 10,
          worldPosition: [0, 0, 0],
        },
      ],
    }),
    null,
  )
})

test('malformed and incompatible versions are rejected with optional warnings', () => {
  const storage = new MemoryStorage()
  const warnings: string[] = []
  const onWarning = (message: string): void => {
    warnings.push(message)
  }

  assert.equal(parseActiveRunSaveV2('{broken', onWarning), null)
  assert.equal(
    normalizeActiveRunSaveV2({ ...makeRun(), version: 1 }),
    null,
  )
  storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify({ ...makeRun(), player: null }))
  assert.equal(loadActiveRun(storage, onWarning), null)

  storage.setItem(PROFILE_SAVE_KEY, JSON.stringify({ version: 2 }))
  assert.deepEqual(loadProfile(storage, onWarning), createDefaultProfile())
  assert.ok(warnings.length >= 3)
})

test('normalizers clamp numbers and deduplicate bounded collections', () => {
  const run = makeRun()
  run.config.seed = -50
  run.config.generatorVersion = 3.9
  run.config.modifiers = ['night', 'night']
  run.currentLocation.localPosition = [99_000_000, -99_000_000, 3]
  run.player.health = 500
  run.player.maxHealth = 120
  run.player.gold = -5
  run.player.kills = 4.8
  run.player.upgrades = { blade: 999, vitality: -2, endurance: 2.9 }
  run.discoveredRegionIds = ['forest-2', 'forest-2', 'forest-3']
  const delta = run.regionDeltas['forest-1']
  delta.clearedEncounterIds = ['ambush-1', 'ambush-1']
  delta.defeatedActorIds = ['captain-1', 'captain-1']
  delta.removedPropIds = ['gate-1', 'gate-1']
  delta.collectedLootIds = ['chest-1', 'chest-1']
  delta.completedInteractionIds = ['shrine-1', 'shrine-1']
  delta.completedEventIds = ['rescue-1', 'rescue-1']
  delta.state = {
    oversized: Array.from({ length: 600 }, (_, index) => index),
  }
  run.rngStates.world = 2 ** 40
  run.directorState = { pressure: Number.MAX_VALUE }
  run.achievementRunState.kills = -2
  run.achievementRunState.zonesVisited = ['forest', 'forest']

  const normalized = normalizeActiveRunSaveV2(run)
  assert.ok(normalized)
  assert.equal(normalized.config.seed, 0)
  assert.equal(normalized.config.generatorVersion, 3)
  assert.deepEqual(normalized.config.modifiers, ['night'])
  assert.deepEqual(normalized.currentLocation.localPosition, [10_000_000, -10_000_000, 3])
  assert.equal(normalized.player.health, 120)
  assert.equal(normalized.player.gold, 0)
  assert.equal(normalized.player.kills, 4)
  assert.deepEqual(normalized.player.upgrades, { blade: 100, vitality: 0, endurance: 2 })
  assert.deepEqual(normalized.discoveredRegionIds, ['forest-2', 'forest-3'])
  const normalizedDelta = normalized.regionDeltas['forest-1']
  assert.equal(normalizedDelta.revision, 5)
  assert.deepEqual(normalizedDelta.clearedEncounterIds, ['ambush-1'])
  assert.deepEqual(normalizedDelta.defeatedActorIds, ['captain-1'])
  assert.deepEqual(normalizedDelta.removedPropIds, ['gate-1'])
  assert.deepEqual(normalizedDelta.collectedLootIds, ['chest-1'])
  assert.deepEqual(normalizedDelta.completedInteractionIds, ['shrine-1'])
  assert.deepEqual(normalizedDelta.completedEventIds, ['rescue-1'])
  assert.equal((normalizedDelta.state.oversized as number[]).length, 512)
  assert.equal(normalized.rngStates.world, 0xffff_ffff)
  assert.equal(normalized.directorState.pressure, Number.MAX_SAFE_INTEGER)
  assert.equal(normalized.achievementRunState.kills, 0)
  assert.deepEqual(normalized.achievementRunState.zonesVisited, ['forest'])

  const profile = normalizeProfileSaveV1({
    ...createDefaultProfile(),
    profileCurrency: -100,
    unlockedBoonIds: ['provisions', 'provisions', 'trail-rations'],
    unlockedContentIds: ['marsh', 'marsh'],
    selectedBoonId: 'not-a-boon',
    runHistory: Array.from({ length: 60 }, (_, index) => makeSummary(index)),
    finalizedRunIds: ['history-0', 'history-0'],
  })
  assert.ok(profile)
  assert.equal(profile.profileCurrency, 0)
  assert.deepEqual(profile.unlockedBoonIds, [
    ...DEFAULT_STARTING_BOON_IDS,
    'trail-rations',
  ])
  assert.deepEqual(profile.unlockedContentIds, ['marsh'])
  assert.equal(profile.selectedBoonId, null)
  assert.equal(profile.runHistory.length, MAX_PROFILE_RUN_HISTORY)
  assert.equal(new Set(profile.finalizedRunIds).size, profile.finalizedRunIds.length)
})

test('run finalization archives and rewards exactly once and prevents revival', () => {
  const storage = new MemoryStorage()
  const run = makeRun()
  const initialProfile = {
    ...createDefaultProfile(),
    profileCurrency: 5,
  }
  assert.equal(saveProfile(storage, initialProfile), true)
  assert.equal(saveActiveRun(storage, run), true)

  const first = finalizeActiveRun(storage, run.runId, 'victory', {
    now: () => new Date('2026-01-02T04:00:00.000Z'),
  })
  assert.equal(first.outcome, 'finalized')
  assert.equal(first.finalized, true)
  assert.ok(first.summary)
  assert.equal(first.rewardGranted, computeRunCompletionReward(first.summary))
  assert.equal(first.profile.profileCurrency, 5 + first.rewardGranted)
  assert.equal(first.profile.runHistory.length, 1)
  assert.equal(storage.getItem(ACTIVE_RUN_SAVE_KEY), null)

  const repeated = finalizeActiveRun(storage, run.runId, 'defeat')
  assert.equal(repeated.outcome, 'already-finalized')
  assert.equal(repeated.rewardGranted, 0)
  assert.equal(repeated.profile.profileCurrency, first.profile.profileCurrency)
  assert.equal(repeated.profile.runHistory.length, 1)
  assert.equal(saveActiveRun(storage, run), false)
  assert.equal(loadActiveRun(storage), null)

  const nextRun = makeRun('run-beta')
  assert.equal(saveActiveRun(storage, nextRun), true)
  finalizeActiveRun(storage, run.runId, 'victory')
  assert.equal(loadActiveRun(storage)?.runId, nextRun.runId)
})

test('terminal run snapshots authoritatively archive the latest progress', () => {
  const storage = new ControlledProfileStorage()
  const checkpoint = makeRun()
  assert.equal(saveActiveRun(storage, checkpoint), true)

  const terminal = makeTerminalRun()
  terminal.player.kills = 17
  terminal.player.gold = 143
  terminal.player.objectives[1].done = true
  terminal.achievementRunState.kills = 17
  terminal.achievementRunState.objectivesCompleted = 2
  storage.profileWriteAttempts = 0

  const result = finalizeRunSnapshot(storage, terminal, {
    now: () => new Date('2026-01-02T04:00:00.000Z'),
  })

  assert.equal(result.outcome, 'finalized')
  assert.equal(storage.profileWriteAttempts, 1)
  assert.equal(result.summary?.kills, 17)
  assert.equal(result.summary?.objectivesCompleted, 2)
  assert.equal(result.summary?.endingGold, 143)
  assert.deepEqual(result.profile.runHistory[0], result.summary)
  assert.equal(storage.getItem(ACTIVE_RUN_SAVE_KEY), null)
})

test('terminal run snapshots finalize without a checkpoint and remain exact-once', () => {
  const storage = new ControlledProfileStorage()
  const terminal = makeTerminalRun('memory-only-run', 'defeat')

  const first = finalizeRunSnapshot(storage, terminal)
  assert.equal(first.outcome, 'finalized')
  assert.equal(first.summary?.endedAt, terminal.updatedAt)
  assert.equal(first.profile.runHistory.length, 1)
  assert.equal(storage.profileWriteAttempts, 1)

  const repeated = finalizeRunSnapshot(storage, terminal)
  assert.equal(repeated.outcome, 'already-finalized')
  assert.equal(repeated.rewardGranted, 0)
  assert.equal(repeated.profile.profileCurrency, first.profile.profileCurrency)
  assert.equal(repeated.profile.runHistory.length, 1)
  assert.equal(storage.profileWriteAttempts, 1)
})

test('abandoned run snapshots archive exactly once without profile rewards', () => {
  const storage = new ControlledProfileStorage()
  const abandoned = makeRun('abandoned-run')
  abandoned.status = 'abandoned'
  abandoned.updatedAt = '2026-01-02T05:00:00.000Z'

  const first = finalizeRunSnapshot(storage, abandoned)
  assert.equal(first.outcome, 'finalized')
  assert.equal(first.rewardGranted, 0)
  assert.equal(first.summary?.status, 'abandoned')
  assert.equal(first.profile.profileCurrency, 0)
  assert.equal(first.profile.runHistory.length, 1)

  const repeated = finalizeRunSnapshot(storage, abandoned)
  assert.equal(repeated.outcome, 'already-finalized')
  assert.equal(repeated.rewardGranted, 0)
  assert.equal(repeated.profile.runHistory.length, 1)
})

test('terminal run finalization rejects result mismatches and unrelated active runs', () => {
  const mismatchStorage = new MemoryStorage()
  const checkpoint = makeRun()
  assert.equal(saveActiveRun(mismatchStorage, checkpoint), true)
  const mismatchedResult = makeTerminalRun()
  mismatchedResult.achievementRunState.result = 'defeat'

  const invalid = finalizeRunSnapshot(mismatchStorage, mismatchedResult)
  assert.equal(invalid.outcome, 'invalid-input')
  assert.equal(loadActiveRun(mismatchStorage)?.runId, checkpoint.runId)
  assert.equal(loadProfile(mismatchStorage).runHistory.length, 0)

  const unrelatedStorage = new MemoryStorage()
  const unrelated = makeRun('unrelated-run')
  assert.equal(saveActiveRun(unrelatedStorage, unrelated), true)
  const rejected = finalizeRunSnapshot(
    unrelatedStorage,
    makeTerminalRun('terminal-run'),
  )
  assert.equal(rejected.outcome, 'run-id-mismatch')
  assert.equal(loadActiveRun(unrelatedStorage)?.runId, unrelated.runId)
  assert.equal(loadProfile(unrelatedStorage).runHistory.length, 0)
})

test('terminal run finalization never removes active data when profile persistence fails', () => {
  const storage = new ControlledProfileStorage()
  const checkpoint = makeRun()
  assert.equal(saveActiveRun(storage, checkpoint), true)
  const profileBefore = loadProfile(storage)
  storage.failProfileWrites = true

  const result = finalizeRunSnapshot(storage, makeTerminalRun())

  assert.equal(result.outcome, 'storage-error')
  assert.equal(result.rewardGranted, 0)
  assert.equal(loadActiveRun(storage)?.runId, checkpoint.runId)
  assert.deepEqual(loadProfile(storage), profileBefore)
})

test('profile run history remains bounded as runs are finalized', () => {
  const storage = new MemoryStorage()
  for (let index = 0; index < MAX_PROFILE_RUN_HISTORY + 5; index += 1) {
    const run = makeRun(`bounded-${index}`)
    assert.equal(saveActiveRun(storage, run), true)
    const result = finalizeActiveRun(storage, run.runId, 'defeat', {
      now: () => new Date('2026-01-03T00:00:00.000Z'),
    })
    assert.equal(result.outcome, 'finalized')
  }

  const profile = loadProfile(storage)
  assert.equal(profile.runHistory.length, MAX_PROFILE_RUN_HISTORY)
  assert.equal(profile.runHistory[0].runId, `bounded-${MAX_PROFILE_RUN_HISTORY + 4}`)
  assert.equal(profile.runHistory.at(-1)?.runId, 'bounded-5')
  assert.equal(profile.finalizedRunIds.length, MAX_PROFILE_RUN_HISTORY + 5)
})

test('boons validate selections, apply modest effects, unlock immutably, and reward deterministically', () => {
  const profile = createDefaultProfile()
  assert.equal(validateBoonSelection(profile, 'scout-map'), 'scout-map')
  assert.equal(validateBoonSelection(profile, 'trail-rations'), null)
  assert.equal(validateBoonSelection(profile, 'unknown'), null)

  assert.deepEqual(getStartingBoonEffects('provisions'), {
    startingHealthBonus: 0,
    startingStaminaBonus: 0,
    startingGoldBonus: 0,
    startingSupplyCount: 1,
    revealAdjacentRegions: false,
    startingDamageBonus: 0,
  })
  assert.equal(getStartingBoonEffects('sturdy-gear').startingHealthBonus, 8)
  assert.equal(getStartingBoonEffects('scout-map').revealAdjacentRegions, true)
  assert.deepEqual(getStartingBoonEffects('unknown'), getStartingBoonEffects(null))

  const insufficient = unlockBoon(profile, 'trail-rations')
  assert.equal(insufficient.status, 'insufficient-currency')
  const funded = { ...profile, profileCurrency: 100 }
  const unlocked = unlockBoon(funded, 'trail-rations')
  assert.equal(unlocked.status, 'unlocked')
  assert.equal(unlocked.profile.profileCurrency, 55)
  assert.equal(funded.profileCurrency, 100)
  assert.equal(funded.unlockedBoonIds.includes('trail-rations'), false)
  assert.equal(selectProfileBoon(unlocked.profile, 'trail-rations')?.selectedBoonId, 'trail-rations')

  const victory = makeSummary(1)
  victory.status = 'victory'
  const defeat = { ...victory, status: 'defeat' as const }
  const abandoned = { ...victory, status: 'abandoned' as const }
  assert.equal(computeRunCompletionReward(victory), computeRunCompletionReward({ ...victory }))
  assert.ok(computeRunCompletionReward(victory) > computeRunCompletionReward(defeat))
  assert.equal(computeRunCompletionReward(abandoned), 0)
})
