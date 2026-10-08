/**
 * W3-4 — «Недобитые»: what is left of a pack the player walked away from.
 *
 * The engine streams the generator's packs with their square. Until W3-4 a square that streamed
 * back into the simulated plus fielded every encounter that was not cleared at full health: the
 * members the player had killed stood up again and the wounds they had dealt were gone. Only
 * uniques and cleared encounters were remembered, in the square's delta. A player could kill two
 * of three, step out of the square and back, and be paid for the same two again.
 *
 * This ledger is what the engine and the harness remember instead, per encounter:
 *
 * 1. **Who fell.** A member that died stays dead. When its square streams back in the spawner
 *    treats it the way it treats a defeated unique: done, never fielded again.
 * 2. **Who is hurt.** A living member that leaves the field — its square streamed out, the
 *    budget made it yield, it stepped back for a staging — leaves its health and maximum here.
 *    It comes back on its post, calm, as the **same body**: the maximum it had and the health it
 *    left with. The engine never rescales a live actor when the clock's tier rises, so neither is
 *    a survivor. Nobody heals while the player is away.
 * 3. **Whose people they are.** A square the chronicle hands to another side is re-planned with
 *    the new owners' people under the same spawn ids. The remnant carries the plan's side and
 *    roles (`remnantSignature`), and a remnant that no longer matches its plan is dropped: the new
 *    owners field fresh.
 *
 * A remnant is never a clear. The engine's clear rule is unchanged: an encounter is cleared when
 * its last living member falls with every member accounted for. A remnant's dead are accounted
 * for without being fielded, its survivors are fielded, and it is cleared exactly when the last
 * survivor falls — at which point the ledger forgets it.
 *
 * The ledger is saved (`directorState.encounterRemnants`), so a continue does not refield what a
 * walk out of the square would not. Its size is bounded by the world: one regular encounter per
 * square and one boss slot per finale, at most four members each.
 *
 * Pure data: no THREE, no scene, no clock and no random stream.
 */

export const ENCOUNTER_REMNANTS_VERSION = 1 as const
/**
 * Encounters a save may remember. A world has exactly 28 encounter slots — one regular encounter
 * in each of its 25 squares and one boss slot at each of the three finale sites — so 64 is the
 * world with room to spare, and anything past it is not a save this game wrote.
 */
export const MAX_ENCOUNTER_REMNANTS = 64
/** Members one remnant may name. A plan fields two to four (a boss slot three). */
export const MAX_REMNANT_MEMBERS = 8
/**
 * The largest health a saved survivor may carry. The largest body a plan fields is a champion:
 * 260 base health, capped at x1.65 across the clock's tier and the plan's difficulty, 429.
 * Ten thousand is far past that and still rejects a corrupted number.
 */
export const MAX_REMNANT_HEALTH = 10_000
const MAX_REMNANT_ID_LENGTH = 256
const MAX_REMNANT_SIGNATURE_LENGTH = 512

/** What a remnant needs to know about the plan it belongs to: who fields it, member by member. */
export interface RemnantPlan {
  readonly encounterId: string
  readonly hostileFaction: string
  readonly spawns: readonly { readonly id: string; readonly role: string }[]
}

export interface RemnantWound {
  health: number
  maxHealth: number
}

interface Remnant {
  signature: string
  fallen: Set<string>
  wounds: Map<string, RemnantWound>
}

export interface EncounterRemnants {
  readonly entries: Map<string, Remnant>
}

/** A living member still on the field when a save is written. */
export interface LiveRemnantBody {
  plan: RemnantPlan
  spawnId: string
  health: number
  maxHealth: number
}

/**
 * The saved block. Type aliases rather than interfaces, so the block is a plain JSON value the
 * run save can carry without a cast.
 */
export type EncounterRemnantSave = {
  encounterId: string
  signature: string
  fallen: string[]
  wounds: Array<{ spawnId: string; health: number; maxHealth: number }>
}

export type EncounterRemnantsSave = {
  version: typeof ENCOUNTER_REMNANTS_VERSION
  encounters: EncounterRemnantSave[]
}

/** What the world says about a restored remnant's encounter. */
export interface RemnantWorld {
  /** The encounter's current plan, with the chronicle's owners applied, or undefined. */
  plan(encounterId: string): RemnantPlan | undefined
  /** Whether the encounter is already cleared in its square's delta. */
  cleared(encounterId: string): boolean
  /** The player's own finale, whose bodies `FinaleDirector` saves. */
  finale(encounterId: string): boolean
}

export function createEncounterRemnants(): EncounterRemnants {
  return { entries: new Map() }
}

/** The plan's side and its roles in spawn order: who these people are. */
export function remnantSignature(plan: RemnantPlan): string {
  return `${plan.hostileFaction}/${plan.spawns.map((spawn) => spawn.role).join(',')}`
}

/** The remnant of `plan`'s encounter, dropped first if the square has changed hands since. */
function currentRemnant(remnants: EncounterRemnants, plan: RemnantPlan): Remnant | undefined {
  const entry = remnants.entries.get(plan.encounterId)
  if (!entry) return undefined
  if (entry.signature === remnantSignature(plan)) return entry
  remnants.entries.delete(plan.encounterId)
  return undefined
}

function ensureRemnant(remnants: EncounterRemnants, plan: RemnantPlan): Remnant {
  const existing = currentRemnant(remnants, plan)
  if (existing) return existing
  const created: Remnant = { signature: remnantSignature(plan), fallen: new Set(), wounds: new Map() }
  remnants.entries.set(plan.encounterId, created)
  return created
}

function prune(remnants: EncounterRemnants, encounterId: string): void {
  const entry = remnants.entries.get(encounterId)
  if (entry && entry.fallen.size === 0 && entry.wounds.size === 0) remnants.entries.delete(encounterId)
}

function planHas(plan: RemnantPlan, spawnId: string): boolean {
  return plan.spawns.some((spawn) => spawn.id === spawnId)
}

/** A member died. It stays dead whenever its square streams back in. */
export function noteRemnantFall(remnants: EncounterRemnants, plan: RemnantPlan, spawnId: string): void {
  if (!planHas(plan, spawnId)) return
  const entry = ensureRemnant(remnants, plan)
  entry.fallen.add(spawnId)
  entry.wounds.delete(spawnId)
}

/**
 * A living member left the field. Hurt, it leaves its health and maximum behind; whole, it leaves
 * nothing, and any older wound it carried is forgotten.
 */
export function noteRemnantDeparture(
  remnants: EncounterRemnants,
  plan: RemnantPlan,
  spawnId: string,
  health: number,
  maxHealth: number,
): void {
  if (!planHas(plan, spawnId) || !Number.isFinite(health) || !Number.isFinite(maxHealth)) return
  if (!(health > 0) || !(maxHealth > 0) || maxHealth > MAX_REMNANT_HEALTH) return
  if (health >= maxHealth) {
    const entry = currentRemnant(remnants, plan)
    if (!entry) return
    entry.wounds.delete(spawnId)
    prune(remnants, plan.encounterId)
    return
  }
  const existing = currentRemnant(remnants, plan)
  if (existing?.fallen.has(spawnId)) return
  const entry = existing ?? ensureRemnant(remnants, plan)
  entry.wounds.set(spawnId, { health, maxHealth })
}

/** Whether `spawnId` fell on an earlier visit and must not be fielded again. */
export function isRemnantFallen(remnants: EncounterRemnants, plan: RemnantPlan, spawnId: string): boolean {
  return currentRemnant(remnants, plan)?.fallen.has(spawnId) ?? false
}

/**
 * The wound a member left with, handed to the body that was just fielded for it, and forgotten
 * here: from now on the body carries it. Ask only once the spawn has happened, so a refused slot
 * never loses a wound.
 */
export function takeRemnantWound(
  remnants: EncounterRemnants,
  plan: RemnantPlan,
  spawnId: string,
): RemnantWound | null {
  const entry = currentRemnant(remnants, plan)
  const wound = entry?.wounds.get(spawnId)
  if (!entry || !wound) return null
  entry.wounds.delete(spawnId)
  prune(remnants, plan.encounterId)
  return { ...wound }
}

/** The encounter was cleared: there is nothing left to remember. */
export function forgetRemnant(remnants: EncounterRemnants, encounterId: string): void {
  remnants.entries.delete(encounterId)
}

/** A copy of what is remembered for one encounter, for tests and diagnostics. */
export function describeRemnant(
  remnants: EncounterRemnants,
  encounterId: string,
): { fallen: string[]; wounds: Record<string, RemnantWound> } | null {
  const entry = remnants.entries.get(encounterId)
  if (!entry) return null
  return {
    fallen: [...entry.fallen].sort(),
    wounds: Object.fromEntries(
      [...entry.wounds.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([spawnId, wound]) => [spawnId, { ...wound }]),
    ),
  }
}

/** The role-bearing signature saved for one wounded or partly dead pack. */
export function savedRemnantSignature(
  remnants: EncounterRemnants,
  encounterId: string,
): string | null {
  return remnants.entries.get(encounterId)?.signature ?? null
}

/** Encounter ids whose composition cannot be evicted while this remnant exists. */
export function remnantEncounterIds(
  remnants: EncounterRemnants,
): Set<string> {
  return new Set(remnants.entries.keys())
}

/**
 * The save block: what the ledger remembers, plus the wounds of every member still on the field,
 * so a mid-fight save keeps them too. The ledger itself is not changed.
 */
export function serializeEncounterRemnants(
  remnants: EncounterRemnants,
  live: Iterable<LiveRemnantBody>,
): EncounterRemnantsSave {
  const copy: EncounterRemnants = { entries: new Map() }
  for (const [encounterId, entry] of remnants.entries) {
    copy.entries.set(encounterId, {
      signature: entry.signature,
      fallen: new Set(entry.fallen),
      wounds: new Map([...entry.wounds].map(([spawnId, wound]) => [spawnId, { ...wound }])),
    })
  }
  for (const body of live) {
    noteRemnantDeparture(copy, body.plan, body.spawnId, body.health, body.maxHealth)
  }
  const encounters = [...copy.entries.entries()]
    .filter(([, entry]) => entry.fallen.size > 0 || entry.wounds.size > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAX_ENCOUNTER_REMNANTS)
    .map(([encounterId, entry]) => ({
      encounterId,
      signature: entry.signature,
      fallen: [...entry.fallen].sort(),
      wounds: [...entry.wounds.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([spawnId, wound]) => ({ spawnId, health: wound.health, maxHealth: wound.maxHealth })),
    }))
  return { version: ENCOUNTER_REMNANTS_VERSION, encounters }
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function readId(value: unknown, limit = MAX_REMNANT_ID_LENGTH): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= limit ? value : null
}

function readRemnant(value: unknown): [string, Remnant] | null {
  const record = asRecord(value)
  if (!record) return null
  const encounterId = readId(record.encounterId)
  const signature = readId(record.signature, MAX_REMNANT_SIGNATURE_LENGTH)
  if (!encounterId || !signature) return null
  if (!Array.isArray(record.fallen) || record.fallen.length > MAX_REMNANT_MEMBERS) return null
  if (!Array.isArray(record.wounds) || record.wounds.length > MAX_REMNANT_MEMBERS) return null
  const fallen = new Set<string>()
  for (const entry of record.fallen) {
    const spawnId = readId(entry)
    if (!spawnId || fallen.has(spawnId)) return null
    fallen.add(spawnId)
  }
  const wounds = new Map<string, RemnantWound>()
  for (const entry of record.wounds) {
    const wound = asRecord(entry)
    const spawnId = readId(wound?.spawnId)
    const health = wound?.health
    const maxHealth = wound?.maxHealth
    if (
      !spawnId ||
      fallen.has(spawnId) ||
      wounds.has(spawnId) ||
      typeof health !== 'number' ||
      typeof maxHealth !== 'number' ||
      !Number.isFinite(health) ||
      !Number.isFinite(maxHealth) ||
      health <= 0 ||
      maxHealth > MAX_REMNANT_HEALTH ||
      health >= maxHealth
    ) {
      return null
    }
    wounds.set(spawnId, { health, maxHealth })
  }
  if (fallen.size === 0 && wounds.size === 0) return null
  return [encounterId, { signature, fallen, wounds }]
}

/**
 * Reads a saved block. An absent block — every save from before W3-4 — is an empty ledger and not
 * an error. A present block that is not exactly what `serializeEncounterRemnants` writes is
 * rejected whole: the ledger starts empty, every pack is fielded whole, and `rejected` says so.
 */
export function normalizeEncounterRemnants(value: unknown): {
  remnants: EncounterRemnants
  rejected: boolean
} {
  const remnants = createEncounterRemnants()
  if (value === undefined || value === null) return { remnants, rejected: false }
  const record = asRecord(value)
  const encounters = record?.encounters
  if (
    !record ||
    record.version !== ENCOUNTER_REMNANTS_VERSION ||
    !Array.isArray(encounters) ||
    encounters.length > MAX_ENCOUNTER_REMNANTS
  ) {
    return { remnants, rejected: true }
  }
  for (const entry of encounters) {
    const read = readRemnant(entry)
    if (!read || remnants.entries.has(read[0])) return { remnants: createEncounterRemnants(), rejected: true }
    remnants.entries.set(read[0], read[1])
  }
  return { remnants, rejected: false }
}

/**
 * Holds a restored ledger to the world it is restored into. A remnant of an encounter the world
 * does not have, of the player's own finale, of an encounter already cleared, naming a member its
 * plan does not have, or whose every member fell is not something a save of this world could
 * hold: it is dropped and counted in `dropped`, which the engine reports with the save warning. A
 * remnant whose people changed hands — the chronicle gave the square to another side — is dropped
 * silently and counted in `changedHands`: the new owners field fresh.
 */
export function reconcileEncounterRemnants(
  remnants: EncounterRemnants,
  world: RemnantWorld,
): { dropped: number; changedHands: number } {
  let dropped = 0
  let changedHands = 0
  for (const [encounterId, entry] of [...remnants.entries]) {
    const plan = world.plan(encounterId)
    const members = new Set(plan?.spawns.map((spawn) => spawn.id) ?? [])
    const named = [...entry.fallen, ...entry.wounds.keys()]
    if (
      !plan ||
      world.finale(encounterId) ||
      world.cleared(encounterId) ||
      named.some((spawnId) => !members.has(spawnId)) ||
      entry.fallen.size >= members.size
    ) {
      remnants.entries.delete(encounterId)
      dropped += 1
      continue
    }
    if (entry.signature !== remnantSignature(plan)) {
      remnants.entries.delete(encounterId)
      changedHands += 1
    }
  }
  return { dropped, changedHands }
}
