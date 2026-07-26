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

test('a generated run remains restorable after another run starts', () => {
  const storage = new MemoryLocalStorage()
  withLocalStorage(storage, () => {
    const generated = new AchievementTracker()
    generated.beginRun('elf', 'forest', 'generated-run')
    generated.recordKill('soldier', 'guard')
    const snapshot = generated.getRunState()
    assert.ok(snapshot)

    const other = new AchievementTracker()
    other.beginRun('guard', 'palace', 'other-run')
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

test('partial cumulative achievement data and unlock timestamps remain readable', () => {
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
    tracker.beginRun('elf', 'forest', 'partial-store')
    const persisted = readAchievementStore(storage)
    assert.equal(persisted.stats.runsStarted, 8)
    assert.equal(persisted.stats.kills, 11)
    assert.equal(persisted.unlocked['first-march'], '2020-01-02T03:04:05.000Z')
  })
})


/**
 * Layer 3 widened `ActorRole`, and `killsByRole` is a `NumericMap<ActorRole>` written to
 * the achievements profile — the one persisted shape this change actually touched. There
 * is no version bump because `parseNumericMap` is key-driven: it reads the current key
 * list and defaults anything absent to 0. This pins that, so a pre-Layer-3 profile keeps
 * its counts instead of turning into `NaN`.
 */
test('a pre-Layer-3 profile gains the beast tallies without losing or corrupting its own', () => {
  const storage = new MemoryLocalStorage()
  storage.setItem(
    ACHIEVEMENTS_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      unlocked: {},
      stats: {
        runsStarted: 4,
        kills: 37,
        // Exactly the eight roles that existed before beasts.
        killsByRole: {
          soldier: 12,
          scout: 5,
          commander: 2,
          minion: 9,
          archer: 6,
          brute: 2,
          champion: 1,
          captive: 0,
        },
        killsByFaction: { elf: 10, guard: 15, villain: 12 },
        goldEarned: 900,
      },
    }),
  )

  withLocalStorage(storage, () => {
    const tracker = new AchievementTracker()
    tracker.beginRun('elf', 'forest', 'legacy-profile')
    tracker.recordKill('wolf', null)
    tracker.recordKill('soldier', 'guard')
  })

  const raw = storage.getItem(ACHIEVEMENTS_STORAGE_KEY)
  assert.ok(raw)
  const stats = JSON.parse(raw).stats

  for (const [role, value] of Object.entries(stats.killsByRole)) {
    assert.ok(Number.isFinite(value), `${role} normalized to ${value}`)
  }
  assert.equal(stats.killsByRole.soldier, 13, 'a legacy tally must survive and increment')
  assert.equal(stats.killsByRole.wolf, 1, 'a beast kill is counted by role')
  assert.equal(stats.killsByRole.boar, 0, 'an absent beast key defaults to zero')

  // §5.3 — a wolf belongs to no faction, so it counts as a kill but is not tallied
  // against one of the three sides.
  assert.equal(stats.kills, 39, 'both kills counted')
  assert.equal(stats.killsByFaction.guard, 16)
  assert.equal(
    stats.killsByFaction.elf + stats.killsByFaction.guard + stats.killsByFaction.villain,
    38,
    'the beast kill must not leak into the faction tallies',
  )
})
