import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACHIEVEMENTS_STORAGE_KEY,
  AchievementTracker,
  cloneAchievementRunState,
  normalizeAchievementRunState,
} from '../src/game/achievements.ts'
import type { AchievementRunState } from '../src/game/achievements.ts'

class MemoryLocalStorage {
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

function withLocalStorage<T>(storage: MemoryLocalStorage, action: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
    writable: true,
  })
  try {
    return action()
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'localStorage', descriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage')
    }
  }
}

function readAchievementStore(storage: MemoryLocalStorage): {
  stats: {
    runsStarted: number
    kills: number
    victories: number
    defeats: number
    completedRunSeconds: number
  }
  unlocked: Record<string, string>
} {
  const raw = storage.getItem(ACHIEVEMENTS_STORAGE_KEY)
  assert.ok(raw)
  return JSON.parse(raw)
}

test('achievement run snapshots restore local progress without restarting the run', () => {
  const storage = new MemoryLocalStorage()
  withLocalStorage(storage, () => {
    const original = new AchievementTracker()
    original.beginRun('elf', 'forest', 'resume-me')
    original.recordKill('soldier', 'guard')
    original.recordGoldEarned(25.5)
    original.recordWorldEvent('rescue', true)
    original.recordZone('neutral')

    const snapshot = original.getRunState()
    assert.ok(snapshot)
    assert.equal(readAchievementStore(storage).stats.runsStarted, 1)

    const resumed = new AchievementTracker()
    assert.equal(resumed.restoreRun(snapshot), true)
    assert.deepEqual(resumed.getRunState(), snapshot)
    assert.equal(resumed.getRunState()?.goldEarned, 25.5)
    assert.equal(readAchievementStore(storage).stats.runsStarted, 1)

    resumed.recordKill('scout', 'villain')
    assert.equal(resumed.getRunState()?.kills, 2)
    const persisted = readAchievementStore(storage)
    assert.equal(persisted.stats.runsStarted, 1)
    assert.equal(persisted.stats.kills, 2)
  })
})

test('a generated run remains restorable after a legacy run starts', () => {
  const storage = new MemoryLocalStorage()
  withLocalStorage(storage, () => {
    const generated = new AchievementTracker()
    generated.beginRun('elf', 'forest', 'generated-run')
    generated.recordKill('soldier', 'guard')
    const snapshot = generated.getRunState()
    assert.ok(snapshot)

    const legacy = new AchievementTracker()
    legacy.beginRun('guard', 'palace', 'legacy-run')
    assert.equal(readAchievementStore(storage).stats.runsStarted, 2)

    const resumed = new AchievementTracker()
    assert.equal(resumed.restoreRun(snapshot), true)
    assert.deepEqual(resumed.getRunState(), snapshot)
    assert.equal(readAchievementStore(storage).stats.runsStarted, 2)
  })
})

test('achievement snapshots and clone helpers return defensive serializable copies', () => {
  const storage = new MemoryLocalStorage()
  withLocalStorage(storage, () => {
    const tracker = new AchievementTracker()
    tracker.beginRun('guard', 'palace', 'defensive-copy')
    tracker.recordWorldEvent('champion', true)
    const snapshot = tracker.getRunState()
    assert.ok(snapshot)

    snapshot.kills = 999
    snapshot.zonesVisited.push('fort')
    snapshot.eventKindsCompleted.length = 0
    assert.equal(tracker.getRunState()?.kills, 0)
    assert.deepEqual(tracker.getRunState()?.zonesVisited, ['palace'])
    assert.deepEqual(tracker.getRunState()?.eventKindsCompleted, ['champion'])

    const cloned = cloneAchievementRunState(tracker.getRunState())
    assert.ok(cloned)
    cloned.unlockedIds.push('external-mutation')
    assert.equal(tracker.getRunState()?.unlockedIds.includes('external-mutation'), false)
    assert.doesNotThrow(() => JSON.stringify(tracker.getRunState()))
  })
})

test('restore rejects malformed, finalized, and mismatched achievement run state', () => {
  const storage = new MemoryLocalStorage()
  withLocalStorage(storage, () => {
    const tracker = new AchievementTracker()
    tracker.beginRun('villain', 'fort', 'current-run')
    const current = tracker.getRunState()
    assert.ok(current)

    assert.equal(normalizeAchievementRunState({ ...current, faction: 'unknown' }), null)
    assert.equal(
      normalizeAchievementRunState({ ...current, zonesVisited: ['forest', 5] }),
      null,
    )

    const finalized: AchievementRunState = {
      ...current,
      result: 'victory',
      elapsedAtEnd: 120,
      healthAtEnd: 50,
    }
    assert.equal(tracker.restoreRun(finalized), false)
    assert.equal(tracker.restoreRun({ ...current, runId: 'other-run' }), false)
    assert.equal(tracker.getRunState()?.runId, 'current-run')
  })
})

test('duplicate campaign end callbacks do not double-count cumulative results', () => {
  const storage = new MemoryLocalStorage()
  withLocalStorage(storage, () => {
    const tracker = new AchievementTracker()
    tracker.beginRun('guard', 'palace', 'finish-once')
    tracker.recordCampaignEnd('victory', 90, 40)
    const first = tracker.getRunState()
    tracker.recordCampaignEnd('defeat', 900, 0)

    assert.deepEqual(tracker.getRunState(), first)
    const persisted = readAchievementStore(storage)
    assert.equal(persisted.stats.victories, 1)
    assert.equal(persisted.stats.defeats, 0)
    assert.equal(persisted.stats.completedRunSeconds, 90)
  })
})

test('legacy cumulative achievement data and unlock timestamps remain readable', () => {
  const storage = new MemoryLocalStorage()
  storage.setItem(
    ACHIEVEMENTS_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      stats: { runsStarted: 7, kills: 11 },
      unlocked: { 'first-march': '2020-01-02T03:04:05.000Z' },
      lastStartedRunId: null,
    }),
  )

  withLocalStorage(storage, () => {
    const tracker = new AchievementTracker()
    const firstMarch = tracker.getCatalogue().find((achievement) => achievement.id === 'first-march')
    assert.equal(firstMarch?.unlocked, true)
    assert.equal(firstMarch?.unlockedAt, '2020-01-02T03:04:05.000Z')
    tracker.beginRun('elf', 'forest', 'legacy-compatible')
    const persisted = readAchievementStore(storage)
    assert.equal(persisted.stats.runsStarted, 8)
    assert.equal(persisted.stats.kills, 11)
    assert.equal(persisted.unlocked['first-march'], '2020-01-02T03:04:05.000Z')
  })
})
