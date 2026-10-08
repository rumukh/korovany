/**
 * W3-4 — «Недобитые», in the shipped engine.
 *
 * A headless `GameEngine` — the class itself, with its render and audio boundaries replaced the
 * way `tests/contractArrival.test.ts` does it — streams a real `RegionManager`'s window through
 * its own `syncGeneratedRegions` and the production spawner. Blows land through `damageActor`,
 * deaths through `killActor` and `recordGeneratedActorDeath`, removals through
 * `removeActorById`, and saves through `saveGeneratedRun` and the run storage's own parser.
 *
 * Every test has its negative control: the same script with the ledger wiped before the square
 * comes back, which is the engine before W3-4, fielding the whole pack at full health.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { createGeneratedEncounterPlans, type GeneratedEncounterPlan } from '../src/game/content/registry.ts'
import { ENCOUNTER_REMNANTS_SAVE_WARNING } from '../src/game/content/gameCopy.ts'
import type { ActiveRunSaveV3 } from '../src/game/run/runTypes.ts'
import { parseActiveRunSaveV3 } from '../src/game/run/storage.ts'
import { createFinaleIdentity } from '../src/game/world/FinaleDirector.ts'
import type { Territory, WorldBlueprint } from '../src/game/world/worldTypes.ts'
import { choosePack, farFrom, field, invoke, woundKillAndLeave } from './remnantField.ts'

test('a wounded pack comes back as it was left: the same survivors, the same health, its dead still dead', () => {
  const probe = field('elf')
  const plan = choosePack(probe, true)
  const { wounded, killedId } = woundKillAndLeave(probe, plan)
  assert.equal(probe.cleared(plan), false, 'a remnant is not a clear')
  probe.standIn(String(plan.regionId))
  const back = probe.pack(plan)
  assert.deepEqual(back.map((actor) => actor.generatedSpawnId).sort(),
    plan.spawns.map((spawn) => spawn.id).filter((id) => id !== killedId).sort())
  const again = back.find((actor) => actor.generatedSpawnId === wounded.id)!
  assert.deepEqual([again.hp, again.maxHp], [wounded.hp, wounded.maxHp], 'the same body, no healing')
  for (const fresh of back.filter((actor) => actor.generatedSpawnId !== wounded.id)) {
    assert.equal(fresh.hp, fresh.maxHp, 'an untouched member is whole')
  }
  // Fielded once: streaming in again on the next frame adds nobody.
  invoke(probe.engine, 'syncGeneratedRegions')
  assert.equal(probe.pack(plan).length, back.length)

  // Negative control: the engine before W3-4 — nothing remembered — fields the whole pack whole.
  const control = field('elf')
  woundKillAndLeave(control, plan)
  control.forgetEverything()
  control.standIn(String(plan.regionId))
  const whole = control.pack(plan)
  assert.equal(whole.length, plan.spawns.length)
  assert.ok(whole.every((actor) => actor.hp === actor.maxHp))
})

test('a remnant is never cleared, and is cleared exactly when its last survivor falls', () => {
  const probe = field('villain')
  const plan = choosePack(probe, true)
  woundKillAndLeave(probe, plan)
  probe.standIn(String(plan.regionId))
  const survivors = probe.living(plan)
  assert.ok(survivors.length >= 2)
  // All but one fall: still not beaten.
  for (const survivor of survivors.slice(0, -1)) probe.strike(survivor, 10_000)
  assert.equal(probe.cleared(plan), false)
  // Out and back once more: only the last one stands, at the health it left with.
  const last = survivors[survivors.length - 1]
  if (last.role !== 'brute') {
    probe.strike(last, 9)
    assert.ok(last.hp < last.maxHp)
  }
  const lastHp = last.hp
  probe.standIn(farFrom(probe.blueprint, String(plan.regionId)))
  probe.standIn(String(plan.regionId))
  const alone = probe.living(plan)
  assert.deepEqual(alone.map((actor) => [actor.generatedSpawnId, actor.hp]), [[last.generatedSpawnId, lastHp]])
  assert.equal(probe.cleared(plan), false)
  probe.strike(alone[0], 10_000)
  assert.equal(probe.cleared(plan), true, 'the last survivor falling clears the encounter')
  assert.equal(probe.remnant(plan), null, 'and the ledger forgets it')
  probe.standIn(farFrom(probe.blueprint, String(plan.regionId)))
  probe.standIn(String(plan.regionId))
  assert.equal(probe.pack(plan).length, 0, 'a cleared encounter fields nobody')
})

test('stepping out and back no longer pays for the same kills twice', () => {
  const probe = field('guard')
  const plan = choosePack(probe, true)
  const { killedId, paid } = woundKillAndLeave(probe, plan)
  probe.standIn(String(plan.regionId))
  assert.equal(probe.pack(plan).some((actor) => actor.generatedSpawnId === killedId), false)

  // Negative control: before W3-4 the dead man stood up on his post and paid again.
  const control = field('guard')
  woundKillAndLeave(control, plan)
  control.forgetEverything()
  control.standIn(String(plan.regionId))
  const risen = control.pack(plan).find((actor) => actor.generatedSpawnId === killedId)
  assert.ok(risen, 'the old engine refielded the dead')
  const before = control.gold()
  control.strike(risen, 10_000)
  assert.equal(control.gold() - before, paid)
})

test('W1-6: a pack that stepped back comes home once with its square, without the members it lost', () => {
  const probe = field('guard')
  const plan = choosePack(probe, false)
  probe.standIn(String(plan.regionId))
  const [fallen, ...rest] = probe.pack(plan)
  probe.strikeByOther(fallen, 10_000, 'villain')
  assert.equal(fallen.alive, false)
  invoke(probe.engine, 'parkGeneratedPack', { key: plan.encounterId, regionId: String(plan.regionId), members: [], busy: false })
  assert.equal(probe.living(plan).length, 0, 'the living stepped back')
  assert.ok(rest.every((member) => !probe.actors.includes(member)))
  probe.standIn(farFrom(probe.blueprint, String(plan.regionId)))
  probe.standIn(String(plan.regionId))
  invoke(probe.engine, 'syncGeneratedRegions')
  const home = probe.pack(plan)
  assert.deepEqual(home.map((actor) => actor.generatedSpawnId).sort(),
    rest.map((member) => member.generatedSpawnId).sort(), 'fielded once, minus the fallen')
  assert.ok(home.every((actor) => actor.hp === actor.maxHp))

  // Negative control: before W3-4 the fallen came home with the square too.
  const control = field('guard')
  control.standIn(String(plan.regionId))
  const [controlFallen] = control.pack(plan)
  control.strikeByOther(controlFallen, 10_000, 'villain')
  invoke(control.engine, 'parkGeneratedPack', { key: plan.encounterId, regionId: String(plan.regionId), members: [], busy: false })
  control.standIn(farFrom(control.blueprint, String(plan.regionId)))
  control.forgetEverything()
  control.standIn(String(plan.regionId))
  assert.equal(control.pack(plan).length, plan.spawns.length)
})

test('a square the chronicle hands to another side fields its new owners fresh', () => {
  const probe = field('elf')
  // A square whose people change with its owner: the same spawn ids, somebody else's men.
  let chosen: { plan: GeneratedEncounterPlan; control: Territory } | null = null
  for (const plan of [...probe.plans.values()].flat()) {
    if (plan.kind === 'boss' || plan.spawns.length < 3) continue
    if (String(plan.regionId) === createFinaleIdentity(probe.blueprint, 'elf').regionId) continue
    for (const control of ['guard', 'villain', 'elf'] as const) {
      const region = probe.blueprint.regions.find((candidate) => candidate.id === plan.regionId)!
      if (region.territory === control) continue
      const overlay = invoke<WorldBlueprint>(probe.engine, 'createChronicleBlueprintOverlay', String(plan.regionId), control)
      const replanned = createGeneratedEncounterPlans(overlay, 'elf')[plan.encounterId]
      if (replanned.hostileFaction !== plan.hostileFaction) {
        chosen = { plan, control }
        break
      }
    }
    if (chosen) break
  }
  assert.ok(chosen, 'some square changes its people with its owner')
  const { plan, control } = chosen
  probe.standIn(String(plan.regionId))
  const [killed] = probe.pack(plan)
  probe.strike(killed, 10_000)
  probe.standIn(farFrom(probe.blueprint, String(plan.regionId)))
  assert.ok(probe.remnant(plan)?.fallen.includes(killed.generatedSpawnId!))
  const chronicle = Reflect.get(probe.engine, 'chronicleRegions') as Map<string, { control: Territory }>
  chronicle.get(String(plan.regionId))!.control = control
  invoke(probe.engine, 'refreshChronicleEncounterPlans', String(plan.regionId))
  const replanned = probe.plans.get(String(plan.regionId))!.find((candidate) => candidate.encounterId === plan.encounterId)!
  // The control this test exists for: the fallen man's id is still in the new owners' plan, so a
  // ledger keyed on ids alone would have left one of the new owners standing dead.
  assert.ok(replanned.spawns.some((spawn) => spawn.id === killed.generatedSpawnId))
  assert.notEqual(replanned.hostileFaction, plan.hostileFaction)
  probe.standIn(String(plan.regionId))
  const newcomers = probe.pack(replanned)
  assert.equal(newcomers.length, replanned.spawns.length, 'the new owners field whole')
  assert.ok(newcomers.every((actor) => actor.allegiance === replanned.hostileFaction))
})

test('a continue fields what a walk out of the square would, and a second continue changes nothing', () => {
  const probe = field('villain')
  const plan = choosePack(probe, true)
  const { wounded, killedId } = woundKillAndLeave(probe, plan)
  // Back in the square, and a fresh wound on the field when the save is written.
  probe.standIn(String(plan.regionId))
  const onField = probe.living(plan).find((actor) => actor.generatedSpawnId !== wounded.id && actor.role !== 'brute')
    ?? probe.living(plan).find((actor) => actor.generatedSpawnId !== wounded.id)!
  probe.strike(onField, 11)
  assert.ok(onField.hp < onField.maxHp, 'a fresh wound on the field')
  const fieldWound = [onField.generatedSpawnId, onField.hp, onField.maxHp]
  const saved = parseActiveRunSaveV3(JSON.stringify(invoke<ActiveRunSaveV3>(probe.engine, 'saveGeneratedRun')))
  assert.ok(saved, 'the run storage accepts the save')
  const block = saved.directorState.encounterRemnants

  const restore = (value: unknown) => {
    const continued = field('villain')
    continued.regions.applyState({ version: 1, discoveredRegionIds: saved.discoveredRegionIds, deltas: saved.regionDeltas })
    invoke(continued.engine, 'restoreEncounterRemnants', value)
    continued.standIn(String(plan.regionId))
    return continued
  }
  const continued = restore(block)
  assert.deepEqual(continued.notices, [])
  const back = continued.pack(plan)
  assert.equal(back.some((actor) => actor.generatedSpawnId === killedId), false, 'the dead stay dead')
  const survivor = back.find((actor) => actor.generatedSpawnId === wounded.id)!
  assert.deepEqual([survivor.hp, survivor.maxHp], [wounded.hp, wounded.maxHp])
  const struck = back.find((actor) => actor.generatedSpawnId === fieldWound[0])!
  assert.deepEqual([struck.generatedSpawnId, struck.hp, struck.maxHp], fieldWound, 'a wound on the field is saved too')
  // A second save and continue writes the very same block: nothing refreshes.
  const again = parseActiveRunSaveV3(JSON.stringify(invoke<ActiveRunSaveV3>(continued.engine, 'saveGeneratedRun')))
  assert.deepEqual(again?.directorState.encounterRemnants, block)

  // A save from before W3-4 has no block: no notice, and the pack is fielded whole, dead and all,
  // as every save did then.
  const older = restore(undefined)
  assert.deepEqual(older.notices, [])
  assert.equal(older.pack(plan).length, plan.spawns.length)
  // A block that cannot be trusted is dropped with the warning, and the pack is fielded whole.
  const broken = restore({ version: 1, encounters: [{ encounterId: plan.encounterId, signature: 'x', fallen: [killedId, killedId], wounds: [] }] })
  assert.deepEqual(broken.notices.map((notice) => [notice.message, notice.tone]), [[ENCOUNTER_REMNANTS_SAVE_WARNING, 'warning']])
  const brokenPack = broken.pack(plan)
  assert.equal(brokenPack.length, plan.spawns.length)
  assert.ok(brokenPack.every((actor) => actor.hp === actor.maxHp))
})
