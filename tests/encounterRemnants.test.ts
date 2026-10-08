/**
 * W3-4 — «Недобитые»: the ledger of what is left of a pack the player walked away from.
 *
 * These are the module's own rules. `encounterRemnantsEngine.test.ts` drives the shipped
 * `GameEngine` spawner, deaths, removals and save through it, and
 * `runHarnessRemnants.test.ts` holds the harness's whole runs to it.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ENCOUNTER_REMNANTS_VERSION,
  MAX_ENCOUNTER_REMNANTS,
  MAX_REMNANT_HEALTH,
  MAX_REMNANT_MEMBERS,
  createEncounterRemnants,
  describeRemnant,
  forgetRemnant,
  isRemnantFallen,
  normalizeEncounterRemnants,
  noteRemnantDeparture,
  noteRemnantFall,
  reconcileEncounterRemnants,
  remnantEncounterIds,
  remnantSignature,
  savedRemnantSignature,
  serializeEncounterRemnants,
  takeRemnantWound,
  type RemnantPlan,
} from '../src/game/world/EncounterRemnants.ts'
import { createGeneratedEncounterPlans } from '../src/game/content/registry.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'

const plan: RemnantPlan = {
  encounterId: 'encounter-region-2-2',
  hostileFaction: 'guard',
  spawns: [
    { id: 'encounter-region-2-2:actor:0', role: 'soldier' },
    { id: 'encounter-region-2-2:actor:1', role: 'archer' },
    { id: 'encounter-region-2-2:actor:2', role: 'brute' },
  ],
}
const [first, second, third] = plan.spawns.map((spawn) => spawn.id)

test('a fallen member stays fallen, a hurt one leaves its wound, a whole one leaves nothing', () => {
  const remnants = createEncounterRemnants()
  noteRemnantFall(remnants, plan, first)
  noteRemnantDeparture(remnants, plan, second, 17.5, 45)
  noteRemnantDeparture(remnants, plan, third, 130, 130)
  assert.equal(isRemnantFallen(remnants, plan, first), true)
  assert.equal(isRemnantFallen(remnants, plan, second), false)
  assert.deepEqual(describeRemnant(remnants, plan.encounterId), {
    fallen: [first],
    wounds: { [second]: { health: 17.5, maxHealth: 45 } },
  })
  assert.equal(savedRemnantSignature(remnants, plan.encounterId), remnantSignature(plan))
  assert.deepEqual([...remnantEncounterIds(remnants)], [plan.encounterId])
  // The wound is handed to the body fielded for it, once: the body carries it from then on.
  assert.deepEqual(takeRemnantWound(remnants, plan, second), { health: 17.5, maxHealth: 45 })
  assert.equal(takeRemnantWound(remnants, plan, second), null)
  assert.equal(takeRemnantWound(remnants, plan, third), null)
  // Leaving again whole forgets any wound; a member of another plan is never recorded.
  noteRemnantDeparture(remnants, plan, second, 30, 45)
  noteRemnantDeparture(remnants, plan, second, 45, 45)
  noteRemnantFall(remnants, plan, 'somebody-else')
  assert.deepEqual(describeRemnant(remnants, plan.encounterId), { fallen: [first], wounds: {} })
  // A dead member cannot leave alive, and a corpse is never a wound.
  noteRemnantDeparture(remnants, plan, first, 10, 70)
  assert.deepEqual(describeRemnant(remnants, plan.encounterId), { fallen: [first], wounds: {} })
  // Beaten: nothing left to remember.
  forgetRemnant(remnants, plan.encounterId)
  assert.equal(describeRemnant(remnants, plan.encounterId), null)
  assert.equal(isRemnantFallen(remnants, plan, first), false)
})

test('a square that changed hands fields its new owners fresh', () => {
  const remnants = createEncounterRemnants()
  noteRemnantFall(remnants, plan, first)
  noteRemnantDeparture(remnants, plan, second, 5, 45)
  const villains: RemnantPlan = {
    ...plan,
    hostileFaction: 'villain',
    spawns: plan.spawns.map((spawn) => ({ ...spawn, role: spawn.role === 'brute' ? 'brute' : 'minion' })),
  }
  assert.notEqual(remnantSignature(villains), remnantSignature(plan))
  assert.equal(isRemnantFallen(remnants, villains, first), false)
  assert.equal(takeRemnantWound(remnants, villains, second), null)
  // And the old owners' remnant is gone for good, not waiting for them to come back.
  assert.equal(isRemnantFallen(remnants, plan, first), false)
  // Negative control: the same plan still matches its own remnant.
  const kept = createEncounterRemnants()
  noteRemnantFall(kept, plan, first)
  assert.equal(isRemnantFallen(kept, { ...plan, spawns: [...plan.spawns] }, first), true)
})

test('the save block round-trips, carries the field\'s wounds and leaves the ledger alone', () => {
  const remnants = createEncounterRemnants()
  noteRemnantFall(remnants, plan, first)
  const live = [{ plan, spawnId: third, health: 64, maxHealth: 130 }]
  const saved = serializeEncounterRemnants(remnants, live)
  assert.deepEqual(saved, {
    version: ENCOUNTER_REMNANTS_VERSION,
    encounters: [{
      encounterId: plan.encounterId,
      signature: remnantSignature(plan),
      fallen: [first],
      wounds: [{ spawnId: third, health: 64, maxHealth: 130 }],
    }],
  })
  // Writing a save does not move the live body's wound into the ledger.
  assert.deepEqual(describeRemnant(remnants, plan.encounterId), { fallen: [first], wounds: {} })
  const restored = normalizeEncounterRemnants(JSON.parse(JSON.stringify(saved)))
  assert.equal(restored.rejected, false)
  assert.deepEqual(serializeEncounterRemnants(restored.remnants, []), saved)
  // A continue and another save write the very same block: nothing refreshes.
  const again = normalizeEncounterRemnants(serializeEncounterRemnants(restored.remnants, []))
  assert.deepEqual(serializeEncounterRemnants(again.remnants, []), saved)
})

test('an absent block is an empty ledger, and anything else that is not what we write is rejected whole', () => {
  for (const absent of [undefined, null]) {
    const read = normalizeEncounterRemnants(absent)
    assert.equal(read.rejected, false)
    assert.equal(read.remnants.entries.size, 0)
  }
  const good = serializeEncounterRemnants((() => {
    const remnants = createEncounterRemnants()
    noteRemnantFall(remnants, plan, first)
    noteRemnantDeparture(remnants, plan, second, 12, 45)
    return remnants
  })(), [])
  const entry = good.encounters[0]
  const malformed: unknown[] = [
    'remnants',
    [],
    { ...good, version: 2 },
    { version: 1 },
    { version: 1, encounters: {} },
    { version: 1, encounters: Array.from({ length: MAX_ENCOUNTER_REMNANTS + 1 }, (_, index) => ({ ...entry, encounterId: `e-${index}` })) },
    { version: 1, encounters: [entry, entry] },
    { version: 1, encounters: [{ ...entry, encounterId: '' }] },
    { version: 1, encounters: [{ ...entry, signature: 7 }] },
    { version: 1, encounters: [{ ...entry, fallen: [first, first] }] },
    { version: 1, encounters: [{ ...entry, fallen: Array.from({ length: MAX_REMNANT_MEMBERS + 1 }, (_, index) => `m-${index}`) }] },
    { version: 1, encounters: [{ ...entry, wounds: [{ spawnId: first, health: 5, maxHealth: 45 }] }] },
    { version: 1, encounters: [{ ...entry, wounds: [{ spawnId: second, health: 0, maxHealth: 45 }] }] },
    { version: 1, encounters: [{ ...entry, wounds: [{ spawnId: second, health: 45, maxHealth: 45 }] }] },
    { version: 1, encounters: [{ ...entry, wounds: [{ spawnId: second, health: 50, maxHealth: 45 }] }] },
    { version: 1, encounters: [{ ...entry, wounds: [{ spawnId: second, health: 5, maxHealth: MAX_REMNANT_HEALTH + 1 }] }] },
    { version: 1, encounters: [{ ...entry, wounds: [{ spawnId: second, health: Number.NaN, maxHealth: 45 }] }] },
    { version: 1, encounters: [{ ...entry, wounds: [{ spawnId: second, health: '5', maxHealth: 45 }] }] },
    { version: 1, encounters: [{ ...entry, fallen: [], wounds: [] }] },
  ]
  for (const value of malformed) {
    const read = normalizeEncounterRemnants(value)
    assert.equal(read.rejected, true, JSON.stringify(value).slice(0, 120))
    assert.equal(read.remnants.entries.size, 0)
  }
  // Negative control: the block every malformed case was cut from is accepted.
  assert.equal(normalizeEncounterRemnants(good).rejected, false)
})

test('a restored ledger is held to the world it is restored into', () => {
  const blueprint = generateWorld(20261008)
  const plans = Object.values(createGeneratedEncounterPlans(blueprint, 'elf'))
  const regular = plans.filter((candidate) => candidate.kind !== 'boss')
  const [kept, cleared, crowdedOut, changed, unknownMember] = regular
  const finale = plans.find((candidate) => candidate.kind === 'boss' && candidate.hostileToPlayer)!
  const remnants = createEncounterRemnants()
  for (const target of [kept, cleared, changed, unknownMember, finale]) {
    noteRemnantFall(remnants, target, target.spawns[0].id)
  }
  // Every member of one fell, which a world clears rather than remembers.
  for (const spawn of crowdedOut.spawns) noteRemnantFall(remnants, crowdedOut, spawn.id)
  const saved = serializeEncounterRemnants(remnants, [])
  const tampered = {
    ...saved,
    encounters: saved.encounters.map((entry) => entry.encounterId === unknownMember.encounterId
      ? { ...entry, fallen: ['not-a-member'] }
      : entry.encounterId === changed.encounterId
        ? { ...entry, signature: 'villain/minion,minion' }
        : entry),
  }
  const restored = normalizeEncounterRemnants(tampered)
  assert.equal(restored.rejected, false)
  const byId = new Map(plans.map((candidate) => [candidate.encounterId, candidate]))
  const result = reconcileEncounterRemnants(restored.remnants, {
    plan: (encounterId) => byId.get(encounterId),
    cleared: (encounterId) => encounterId === cleared.encounterId,
    finale: (encounterId) => encounterId === finale.encounterId,
  })
  assert.deepEqual(result, { dropped: 4, changedHands: 1 })
  assert.deepEqual([...restored.remnants.entries.keys()], [kept.encounterId])
  assert.equal(isRemnantFallen(restored.remnants, kept, kept.spawns[0].id), true)
})
