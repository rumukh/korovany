import assert from 'node:assert/strict'
import test from 'node:test'
import { ENCOUNTER_COMPOSITIONS_SAVE_WARNING } from '../src/game/content/gameCopy.ts'
import { parseActiveRunSaveV3 } from '../src/game/run/storage.ts'
import {
  actorBaseHealth,
} from '../src/game/world/CombatResolver.ts'
import {
  combinedEnemyHealthMultiplier,
  createEncounterCompositions,
  encounterDifficultyHealthMultiplier,
  stageEncounterComposition,
} from '../src/game/world/EncounterComposition.ts'
import { enemyHealthMultiplier } from '../src/game/world/CampaignDirector.ts'
import { createFinaleIdentity } from '../src/game/world/FinaleDirector.ts'
import {
  farFrom,
  field,
  invoke,
  woundKillAndLeave,
  type Probe,
} from './remnantField.ts'

function hardestHostilePack(probe: Probe) {
  const startRegion = String(
    probe.blueprint.sites.find(
      (site) => site.id === probe.blueprint.starts[probe.faction],
    )!.regionId,
  )
  const finale = createFinaleIdentity(
    probe.blueprint,
    probe.faction,
  )
  const plans = [...probe.plans.values()]
    .flat()
    .filter(
      (plan) =>
        plan.hostileToPlayer &&
        plan.kind !== 'boss' &&
        String(plan.regionId) !== startRegion &&
        String(plan.regionId) !== finale.regionId,
    )
    .sort(
      (left, right) =>
        right.difficulty - left.difficulty ||
        left.encounterId.localeCompare(right.encounterId),
    )
  assert.ok(plans[0])
  return plans[0]
}

function stagedRoles(probe: Probe, encounterId: string): string[] {
  return probe.actors
    .filter(
      (actor) =>
        actor.alive &&
        actor.generatedEncounterId === encounterId,
    )
    .sort((left, right) =>
      String(left.generatedSpawnId).localeCompare(
        String(right.generatedSpawnId),
      ))
    .map((actor) => actor.role)
}

test('the production spawner fixes a tier mix once and applies the 1.65 combined HP cap', () => {
  const first = field('elf')
  const plan = hardestHostilePack(first)
  assert.ok(plan.difficulty >= 4)
  Reflect.set(first.engine, 'elapsed', 720)
  Reflect.set(first.engine, 'threatTier', 5)
  first.standIn(String(plan.regionId))

  const expected = stageEncounterComposition(
    createEncounterCompositions(),
    plan,
    first.blueprint.seed,
    first.faction,
    5,
  ).plan
  assert.deepEqual(
    stagedRoles(first, plan.encounterId),
    [...expected.spawns]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((spawn) => spawn.role),
  )

  const clock = enemyHealthMultiplier(5, true)
  const combined = combinedEnemyHealthMultiplier(
    clock,
    plan.difficulty,
    true,
  )
  assert.equal(combined, 1.65)
  for (const actor of first.pack(plan)) {
    assert.equal(
      actor.maxHp,
      Math.round(actorBaseHealth(actor.role) * combined),
    )
    const uncapped = Math.round(
      actorBaseHealth(actor.role) *
      clock *
      encounterDifficultyHealthMultiplier(plan.difficulty),
    )
    assert.ok(uncapped > actor.maxHp)
  }
  const wounded = first.pack(plan).find(
    (actor) => actor.role !== 'brute',
  )!
  first.strike(wounded, 1)
  assert.equal(
    invoke<Set<string>>(
      first.engine,
      'protectedEncounterCompositionIds',
    ).has(plan.encounterId),
    true,
    'a live wound is protected before W3-4 captures its departure',
  )

  const frozen = stagedRoles(first, plan.encounterId)
  first.standIn(farFrom(first.blueprint, String(plan.regionId)))
  Reflect.set(first.engine, 'threatTier', 2)
  first.standIn(String(plan.regionId))
  assert.deepEqual(
    stagedRoles(first, plan.encounterId),
    frozen,
    'a staged pack does not re-roll when the tier changes',
  )

  const second = field('elf')
  Reflect.set(second.engine, 'elapsed', 720)
  Reflect.set(second.engine, 'threatTier', 5)
  second.standIn(String(plan.regionId))
  assert.deepEqual(
    stagedRoles(second, plan.encounterId),
    frozen,
    'the same seed and staging tier pick the same mix',
  )
})

test('a rejected composition block rebuilds exact roles from a valid wounded remnant', () => {
  const original = field('guard')
  const plan = hardestHostilePack(original)
  Reflect.set(original.engine, 'threatTier', 4)
  original.standIn(String(plan.regionId))
  const fullRoles = new Map(
    original.pack(plan).map((actor) => [
      actor.generatedSpawnId,
      actor.role,
    ]),
  )
  const { wounded, killedId } = woundKillAndLeave(original, plan)
  const saved = parseActiveRunSaveV3(
    JSON.stringify(invoke(original.engine, 'saveGeneratedRun')),
  )
  assert.ok(saved)
  assert.ok(saved.directorState.encounterCompositions)

  const continued = field('guard')
  continued.regions.applyState({
    version: 1,
    discoveredRegionIds: saved.discoveredRegionIds,
    deltas: saved.regionDeltas,
  })
  invoke(
    continued.engine,
    'restoreEncounterRemnants',
    saved.directorState.encounterRemnants,
    { version: 99, encounters: [] },
  )
  continued.standIn(String(plan.regionId))

  const survivors = continued.pack(plan)
  assert.equal(
    survivors.some(
      (actor) => actor.generatedSpawnId === killedId,
    ),
    false,
  )
  for (const actor of survivors) {
    assert.equal(
      actor.role,
      fullRoles.get(actor.generatedSpawnId),
      String(actor.generatedSpawnId),
    )
  }
  const hurt = survivors.find(
    (actor) => actor.generatedSpawnId === wounded.id,
  )
  assert.deepEqual(
    [hurt?.hp, hurt?.maxHp],
    [wounded.hp, wounded.maxHp],
  )
  assert.deepEqual(
    continued.notices,
    [{
      message: ENCOUNTER_COMPOSITIONS_SAVE_WARNING,
      tone: 'warning',
    }],
  )

  const tamperedBlock = structuredClone(
    saved.directorState.encounterCompositions,
  ) as {
    encounters: Array<{
      encounterId: string
      roles: Array<{ role: string }>
    }>
  }
  const tamperedEntry = tamperedBlock.encounters.find(
    (entry) => entry.encounterId === plan.encounterId,
  )
  assert.ok(tamperedEntry?.roles[0])
  tamperedEntry.roles[0].role =
    tamperedEntry.roles[0].role === 'archer'
      ? 'soldier'
      : 'archer'
  const recovered = field('guard')
  recovered.regions.applyState({
    version: 1,
    discoveredRegionIds: saved.discoveredRegionIds,
    deltas: saved.regionDeltas,
  })
  invoke(
    recovered.engine,
    'restoreEncounterRemnants',
    saved.directorState.encounterRemnants,
    tamperedBlock,
  )
  recovered.standIn(String(plan.regionId))
  for (const actor of recovered.pack(plan)) {
    assert.equal(
      actor.role,
      fullRoles.get(actor.generatedSpawnId),
      'the remnant repaired a valid-looking tampered role map',
    )
  }
  assert.ok(
    recovered.notices.some(
      (notice) =>
        notice.message === ENCOUNTER_COMPOSITIONS_SAVE_WARNING,
    ),
  )

  const again = parseActiveRunSaveV3(
    JSON.stringify(invoke(continued.engine, 'saveGeneratedRun')),
  )
  assert.ok(again?.directorState.encounterCompositions)
})
