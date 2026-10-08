import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createGeneratedEncounterPlans,
  type GeneratedEncounterPlan,
} from '../src/game/content/registry.ts'
import {
  ENCOUNTER_COMPOSITIONS_VERSION,
  ENEMY_HP_MULTIPLIER_CAP,
  MAX_ENCOUNTER_COMPOSITIONS,
  applyStoredEncounterComposition,
  cappedEncounterHealthScale,
  combinedEnemyHealthMultiplier,
  createEncounterCompositions,
  encounterCompositionPlanSignature,
  encounterDifficultyHealthMultiplier,
  normalizeEncounterCompositions,
  recoverEncounterCompositionFromRemnant,
  serializeEncounterCompositions,
  stageEncounterComposition,
  type EncounterCompositionEntry,
} from '../src/game/world/EncounterComposition.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'

const SEED = 20261008

function hostilePlan(
  faction: 'elf' | 'guard' | 'villain' = 'elf',
): GeneratedEncounterPlan {
  const plans = Object.values(
    createGeneratedEncounterPlans(generateWorld(SEED), faction),
  )
  const plan = plans.find(
    (candidate) =>
      candidate.hostileToPlayer &&
      candidate.kind !== 'boss' &&
      candidate.spawns.length >= 3,
  )
  assert.ok(plan)
  return plan
}

function hostilePlanByOwner(
  owner: 'elf' | 'guard' | 'villain',
): {
  plan: GeneratedEncounterPlan
  playerFaction: 'elf' | 'guard' | 'villain'
} {
  for (const playerFaction of ['elf', 'guard', 'villain'] as const) {
    if (playerFaction === owner) continue
    const plan = Object.values(
      createGeneratedEncounterPlans(
        generateWorld(SEED),
        playerFaction,
      ),
    ).find(
      (candidate) =>
        candidate.hostileToPlayer &&
        candidate.hostileFaction === owner &&
        candidate.kind !== 'boss' &&
        candidate.spawns.length >= 3,
    )
    if (plan) return { plan, playerFaction }
  }
  throw new Error(`No hostile ${owner} encounter plan`)
}

function roles(plan: GeneratedEncounterPlan): string[] {
  return plan.spawns.map((spawn) => spawn.role)
}

test('the combined hostile encounter HP multiplier is capped at 1.65', () => {
  assert.equal(encounterDifficultyHealthMultiplier(1), 1)
  assert.equal(encounterDifficultyHealthMultiplier(5), 1.48)
  assert.equal(combinedEnemyHealthMultiplier(1, 5, true), 1.48)
  assert.equal(
    combinedEnemyHealthMultiplier(1.48, 5, true),
    ENEMY_HP_MULTIPLIER_CAP,
  )
  assert.equal(
    cappedEncounterHealthScale(1.48, 5, true),
    ENEMY_HP_MULTIPLIER_CAP / 1.48,
  )
  assert.equal(
    combinedEnemyHealthMultiplier(1.48, 5, false),
    1.48,
  )

  const uncapped = 1.48 * encounterDifficultyHealthMultiplier(5)
  assert.equal(uncapped, 2.1904)
  assert.ok(uncapped > ENEMY_HP_MULTIPLIER_CAP)
  assert.throws(
    () => cappedEncounterHealthScale(Number.NaN, 1, true),
    RangeError,
  )
})

test('composition is deterministic, tier one is exact, and tiers use faction roles', () => {
  const {
    plan: base,
    playerFaction,
  } = hostilePlanByOwner('elf')
  const firstState = createEncounterCompositions()
  const secondState = createEncounterCompositions()
  const tierOne = stageEncounterComposition(
    firstState,
    base,
    SEED,
    playerFaction,
    1,
  )
  assert.deepEqual(roles(tierOne.plan), roles(base))

  const first = stageEncounterComposition(
    createEncounterCompositions(),
    base,
    SEED,
    playerFaction,
    4,
  )
  const second = stageEncounterComposition(
    secondState,
    base,
    SEED,
    playerFaction,
    4,
  )
  assert.deepEqual(roles(first.plan), roles(second.plan))
  assert.equal(first.plan.spawns.length, base.spawns.length)
  assert.ok(first.plan.spawns.some((spawn) => spawn.role === 'archer'))
  assert.ok(first.plan.spawns.some((spawn) => spawn.role === 'scout'))
  assert.notDeepEqual(
    roles(first.plan),
    roles(tierOne.plan),
    'the tiered arm must differ from its legacy control on this plan',
  )

  const {
    plan: guard,
    playerFaction: guardOpponent,
  } = hostilePlanByOwner('guard')
  const tierFive = stageEncounterComposition(
    createEncounterCompositions(),
    guard,
    SEED,
    guardOpponent,
    5,
  )
  assert.ok(tierFive.plan.spawns.some(
    (spawn) => spawn.role === 'commander',
  ))
  const tierFour = stageEncounterComposition(
    createEncounterCompositions(),
    guard,
    SEED,
    guardOpponent,
    4,
  )
  assert.equal(
    tierFour.plan.spawns.some((spawn) => spawn.role === 'commander'),
    false,
  )
})

test('a staged plan is frozen while later tiers rise, and exclusions remain unchanged', () => {
  const plan = hostilePlan('villain')
  const state = createEncounterCompositions()
  const staged = stageEncounterComposition(
    state,
    plan,
    SEED,
    'villain',
    2,
  )
  const later = stageEncounterComposition(
    state,
    plan,
    SEED,
    'villain',
    5,
  )
  assert.deepEqual(roles(later.plan), roles(staged.plan))
  assert.equal(later.entry?.stagedTier, 2)

  const friendly = {
    ...plan,
    hostileToPlayer: false,
  }
  const friendlyResult = stageEncounterComposition(
    createEncounterCompositions(),
    friendly,
    SEED,
    'villain',
    5,
  )
  assert.strictEqual(friendlyResult.plan, friendly)
  assert.equal(friendlyResult.entry, null)

  const boss = Object.values(
    createGeneratedEncounterPlans(generateWorld(SEED), 'villain'),
  ).find((candidate) => candidate.kind === 'boss')
  assert.ok(boss)
  const bossResult = stageEncounterComposition(
    createEncounterCompositions(),
    boss,
    SEED,
    'villain',
    5,
  )
  assert.strictEqual(bossResult.plan, boss)
})

test('a stored decision applies only to the base plan and owner that wrote it', () => {
  const plan = hostilePlan()
  const state = createEncounterCompositions()
  const staged = stageEncounterComposition(
    state,
    plan,
    SEED,
    'elf',
    4,
  )
  assert.deepEqual(
    roles(applyStoredEncounterComposition(
      state,
      plan,
      SEED,
      'elf',
    )!),
    roles(staged.plan),
  )

  const changedOwner: GeneratedEncounterPlan = {
    ...plan,
    hostileFaction:
      plan.hostileFaction === 'guard'
        ? 'villain'
        : 'guard',
    spawns: plan.spawns.map((spawn) => ({
      ...spawn,
      faction:
        plan.hostileFaction === 'guard'
          ? 'villain'
          : 'guard',
    })),
  }
  assert.equal(
    applyStoredEncounterComposition(
      state,
      changedOwner,
      SEED,
      'elf',
    ),
    null,
  )
  assert.equal(state.entries.has(plan.encounterId), false)
})

test('composition saves round-trip strictly and malformed blocks are rejected whole', () => {
  const plan = hostilePlan()
  const state = createEncounterCompositions()
  stageEncounterComposition(state, plan, SEED, 'elf', 4)
  const saved = serializeEncounterCompositions(state)
  assert.equal(saved.version, ENCOUNTER_COMPOSITIONS_VERSION)
  const restored = normalizeEncounterCompositions(
    JSON.parse(JSON.stringify(saved)),
  )
  assert.equal(restored.rejected, false)
  assert.deepEqual(
    serializeEncounterCompositions(restored.compositions),
    saved,
  )

  for (const malformed of [
    'composition',
    { ...saved, version: 2 },
    { ...saved, nextOrdinal: 1 },
    {
      ...saved,
      encounters: [
        saved.encounters[0],
        saved.encounters[0],
      ],
    },
    {
      ...saved,
      encounters: [{
        ...saved.encounters[0],
        roles: [{
          ...saved.encounters[0].roles[0],
          role: 'dragon',
        }],
      }],
    },
  ]) {
    const read = normalizeEncounterCompositions(malformed)
    assert.equal(read.rejected, true)
    assert.equal(read.compositions.entries.size, 0)
  }
  assert.equal(
    normalizeEncounterCompositions(undefined).rejected,
    false,
  )
})

function syntheticEntry(index: number): EncounterCompositionEntry {
  return {
    encounterId: `encounter-${String(index).padStart(2, '0')}`,
    planSignature: `signature-${index}`,
    stagedTier: 1,
    ordinal: index + 1,
    roles: new Map([[`spawn-${index}`, 'soldier']]),
  }
}

test('capacity evicts the oldest unprotected entry and never a remnant-backed one', () => {
  const plan = hostilePlan()
  const state = createEncounterCompositions()
  for (let index = 0; index < MAX_ENCOUNTER_COMPOSITIONS; index += 1) {
    const entry = syntheticEntry(index)
    state.entries.set(entry.encounterId, entry)
  }
  state.nextOrdinal = MAX_ENCOUNTER_COMPOSITIONS + 1
  const protectedIds = new Set(['encounter-00'])
  const staged = stageEncounterComposition(
    state,
    plan,
    SEED,
    'elf',
    4,
    protectedIds,
  )
  assert.equal(staged.overflow, false)
  assert.equal(staged.evictedEncounterId, 'encounter-01')
  assert.equal(state.entries.has('encounter-00'), true)
  assert.equal(state.entries.has('encounter-01'), false)
  assert.equal(state.entries.has(plan.encounterId), true)

  const allProtected = createEncounterCompositions()
  for (let index = 0; index < MAX_ENCOUNTER_COMPOSITIONS; index += 1) {
    const entry = syntheticEntry(index)
    allProtected.entries.set(entry.encounterId, entry)
  }
  allProtected.nextOrdinal = MAX_ENCOUNTER_COMPOSITIONS + 1
  const overflow = stageEncounterComposition(
    allProtected,
    plan,
    SEED,
    'elf',
    4,
    new Set(allProtected.entries.keys()),
  )
  assert.equal(overflow.overflow, true)
  assert.equal(overflow.entry, null)
  assert.equal(allProtected.entries.size, MAX_ENCOUNTER_COMPOSITIONS)
})

test('a valid remnant role signature rebuilds a rejected composition decision', () => {
  const {
    plan,
    playerFaction,
  } = hostilePlanByOwner('guard')
  const original = stageEncounterComposition(
    createEncounterCompositions(),
    plan,
    SEED,
    playerFaction,
    5,
  )
  assert.ok(original.entry)
  const signature = `${plan.hostileFaction}/${roles(original.plan).join(',')}`
  const recoveredState = createEncounterCompositions()
  const recovered = recoverEncounterCompositionFromRemnant(
    recoveredState,
    plan,
    signature,
    SEED,
    playerFaction,
    new Set([plan.encounterId]),
  )
  assert.ok(recovered)
  assert.deepEqual(roles(recovered.plan), roles(original.plan))
  assert.equal(
    recovered.entry?.planSignature,
    encounterCompositionPlanSignature(plan),
  )

  assert.equal(
    recoverEncounterCompositionFromRemnant(
      createEncounterCompositions(),
      plan,
      `${plan.hostileFaction}/dragon`,
      SEED,
      playerFaction,
      new Set([plan.encounterId]),
    ),
    null,
  )
})
