import type { RandomStream } from '../random/RandomStream.ts'
import type { Faction } from '../types.ts'
import {
  WORLD_FACTIONS,
  type RegionId,
  type SiteId,
  type Territory,
  type WorldBlueprint,
  type WorldRegion,
  type WorldSite,
} from './worldTypes.ts'

export const CHRONICLE_TICK_SECONDS = 8
export const CHRONICLE_LOG_LIMIT = 40
export const CONTROL_FLIP_MARGIN = 0.18
export const PRESSURE_GROWTH = 0.06
export const PRESSURE_DECAY = 0.03
export const PRESSURE_ATTRITION = 0.015
export const CONTROL_FLIP_COOLDOWN_TICKS = 3
export const BEAST_GROWTH_FOREST = 0.05
export const BEAST_GROWTH_FORT = 0.04
export const BEAST_NIGHT_MULTIPLIER = 1.6
export const BEAST_STORM_MULTIPLIER = 1.3
export const BEAST_RAID_THRESHOLD = 0.75
export const BEAST_CONTROL_DECAY = 0.02
export const BEAST_RAID_RESET = 0.35
/**
 * Layer 3 — beast pressure left behind after the player physically drove a pack off.
 * Lower than `BEAST_RAID_RESET`: a raid the chronicle resolved on its own only fed the
 * beasts, one the player broke actually thinned them out.
 */
export const BEAST_RAID_REPELLED_RESET = 0.18
export const SETTLEMENT_RAID_DAMAGE: readonly [number, number] = [18, 34]
export const SETTLEMENT_REGEN = 1.5
export const SETTLEMENT_CALM_TICKS = 4
export const SUPPLY_PRICE_SWING = 0.45
export const SUPPLY_BASELINE = 0.6
export const SUPPLY_DRIFT = 0.04
export const SUPPLY_CARAVAN_GAIN = 0.14
export const SUPPLY_CARAVAN_LOSS = 0.19
export const CHRONICLE_CARAVAN_LIMIT = 3
export const CARAVAN_INTERCEPT_BASE = 0.12
export const CARAVAN_HOSTILE_RISK = 0.18
export const CARAVAN_BEAST_RISK = 0.2
export const CARAVAN_BEAST_THRESHOLD = 0.5
export const CARAVAN_PROGRESS_PER_TICK = 0.18
export const STRENGTH_BASE = 0.25
export const STRENGTH_TERRITORY_SHARE = 0.45
export const STRENGTH_OBJECTIVE_SHARE = 0.3

/**
 * How much of the attacker's pressure survives a materialized raid, measured in the
 * region the assault marched from. A repelled raid costs more than a won one.
 */
export const RAID_SOURCE_SPEND_WON = 0.5
export const RAID_SOURCE_SPEND_REPELLED = 0.35

/** Site kinds that host civilians, trade, and healing — the things a raid can ruin. */
export const CHRONICLE_SETTLEMENT_SITE_KINDS = [
  'settlement',
  'shop',
  'recovery',
] as const

/** Site kinds the campaign needs intact for every generated run to stay completable. */
export const CHRONICLE_PROTECTED_SITE_KINDS = [
  'faction-start',
  'final-stronghold',
] as const

export type ChronicleEventKind =
  | 'regionCaptured'
  | 'raidRepelled'
  | 'beastRaid'
  | 'beastsRepelled'
  | 'settlementBurned'
  | 'caravanLost'
  | 'caravanArrived'

export interface ChronicleEvent {
  id: string
  tick: number
  kind: ChronicleEventKind
  regionId: RegionId
  faction: Faction | null
  siteId: SiteId | null
}

export interface RegionChronicleState {
  /** Mutable control of the region; seeded from `blueprint.territory`. */
  control: Territory
  /** Military pressure per faction, 0..1. */
  pressure: Record<Faction, number>
  /** Beast pressure, 0..1. */
  beastPressure: number
  /** Aggregate integrity of the region's settlement sites, 0..100. */
  settlementIntegrity: number
  /** Trade supply, 0..1; drives shop prices. */
  supply: number
  lastEventTick: number
}

export interface ChronicleCaravan {
  id: string
  ownerFaction: Faction
  fromSiteId: SiteId
  toSiteId: SiteId
  regionPath: RegionId[]
  /** 0..1 along `regionPath`. */
  progress: number
  intact: boolean
}

export interface ChronicleState {
  tick: number
  factionStrength: Record<Faction, number>
  caravans: ChronicleCaravan[]
  /** Bounded ring buffer, newest last. */
  log: ChronicleEvent[]
}

export interface ChronicleEnvironment {
  /** 0 at noon, 1 at midnight. */
  nightFactor: number
  /** 0 in clear weather, 1 in heavy rain or snow. */
  stormFactor: number
}

export interface ChronicleTickContext {
  blueprint: WorldBlueprint
  state: ChronicleState
  regions: Map<string, RegionChronicleState>
  rng: RandomStream
  environment: ChronicleEnvironment
  playerFaction: Faction
  /** Share of the player's campaign objectives already completed, 0..1. */
  playerObjectiveRatio: number
  /** Regions that must never change hands — campaign start and finale. */
  protectedRegionIds: ReadonlySet<string>
  /** Regions the player is currently in; Layer 2 materializes their fights instead. */
  frozenRegionIds: ReadonlySet<string>
}

interface ChronicleSiteIndex {
  settlementSiteIds: Map<string, SiteId[]>
  protectedRegionIds: ReadonlySet<string>
  caravanRoutes: CaravanRoute[]
}

interface CaravanRoute {
  id: string
  fromSiteId: SiteId
  toSiteId: SiteId
  regionPath: RegionId[]
}

export function createRegionChronicleState(
  territory: Territory,
): RegionChronicleState {
  return {
    control: territory,
    pressure: {
      elf: territory === 'elf' ? 0.35 : 0,
      guard: territory === 'guard' ? 0.35 : 0,
      villain: territory === 'villain' ? 0.35 : 0,
    },
    beastPressure: 0,
    settlementIntegrity: 100,
    supply: SUPPLY_BASELINE,
    lastEventTick: 0,
  }
}

export function createChronicleState(): ChronicleState {
  return {
    tick: 0,
    factionStrength: { elf: STRENGTH_BASE, guard: STRENGTH_BASE, villain: STRENGTH_BASE },
    caravans: [],
    log: [],
  }
}

export function createChronicleRegions(
  blueprint: WorldBlueprint,
): Map<string, RegionChronicleState> {
  const regions = new Map<string, RegionChronicleState>()
  for (const region of blueprint.regions) {
    regions.set(String(region.id), createRegionChronicleState(region.territory))
  }
  return regions
}

export function cloneRegionChronicleState(
  state: RegionChronicleState,
): RegionChronicleState {
  return {
    control: state.control,
    pressure: { ...state.pressure },
    beastPressure: state.beastPressure,
    settlementIntegrity: state.settlementIntegrity,
    supply: state.supply,
    lastEventTick: state.lastEventTick,
  }
}

export function cloneChronicleState(state: ChronicleState): ChronicleState {
  return {
    tick: state.tick,
    factionStrength: { ...state.factionStrength },
    caravans: state.caravans.map((caravan) => ({
      ...caravan,
      regionPath: [...caravan.regionPath],
    })),
    log: state.log.map((entry) => ({ ...entry })),
  }
}

export function isRegionRazed(state: RegionChronicleState | undefined): boolean {
  return state !== undefined && state.settlementIntegrity <= 0
}

/**
 * Regions on a front line: their control differs from a road-connected neighbour's.
 * O(roadSegments), so it is cheap enough to recompute after every chronicle tick.
 */
export function getContestedRegionIds(
  blueprint: WorldBlueprint,
  regions: ReadonlyMap<string, RegionChronicleState>,
): Set<string> {
  const contested = new Set<string>()
  for (const segment of blueprint.roads.segments) {
    const from = regions.get(String(segment.fromRegionId))
    const to = regions.get(String(segment.toRegionId))
    if (!from || !to || from.control === to.control) continue
    contested.add(String(segment.fromRegionId))
    contested.add(String(segment.toRegionId))
  }
  return contested
}

export function getSupplyPriceMultiplier(
  state: RegionChronicleState | undefined,
): number {
  const supply = state ? clamp01(state.supply) : SUPPLY_BASELINE
  return 1 + (1 - supply) * SUPPLY_PRICE_SWING
}

/**
 * Advances the world by one chronicle tick. Pure with respect to its inputs: given the
 * same state, RNG state, and environment it always produces the same mutations and log.
 */
export function tickChronicle(context: ChronicleTickContext): ChronicleEvent[] {
  const { blueprint, state } = context
  const index = indexBlueprint(blueprint)
  state.tick += 1
  const events: ChronicleEvent[] = []
  let sequence = 0
  const record = (
    kind: ChronicleEventKind,
    regionId: RegionId,
    faction: Faction | null,
    siteId: SiteId | null,
  ): void => {
    sequence += 1
    events.push(
      appendChronicleEvent(
        state,
        `chronicle-${state.tick}-${sequence}`,
        kind,
        regionId,
        faction,
        siteId,
      ),
    )
  }

  updateFactionStrength(context)
  advancePressure(context)
  const captured = resolveFronts(context, index, record)
  for (const regionId of captured) {
    damageSettlements(context, index, regionId, record)
  }
  advanceBeasts(context, index, record)
  advanceSettlements(context)
  advanceCaravans(context, index, record)
  return events
}

function appendChronicleEvent(
  state: ChronicleState,
  id: string,
  kind: ChronicleEventKind,
  regionId: RegionId,
  faction: Faction | null,
  siteId: SiteId | null,
): ChronicleEvent {
  const event: ChronicleEvent = { id, tick: state.tick, kind, regionId, faction, siteId }
  state.log.push(event)
  if (state.log.length > CHRONICLE_LOG_LIMIT) {
    state.log.splice(0, state.log.length - CHRONICLE_LOG_LIMIT)
  }
  return event
}

/* ------------------------------------------------------------------------------- *
 * Layer 2 hand-back.
 *
 * The chronicle refuses to act in a simulated region — Layer 2 materializes the fight
 * instead. When the player walks away, the fight is not cancelled: whatever was still
 * standing is folded back in here and the chronicle writes down who won. These stay
 * pure (state, regions, rng only) so the materialization layer remains the consumer.
 * ------------------------------------------------------------------------------- */

export interface MaterializedRaidOutcome {
  regionId: RegionId
  /** Region the attackers marched from; their losses are paid out of its pressure. */
  sourceRegionId: RegionId | null
  /** Settlement site under attack, if the raid had one. */
  siteId: SiteId | null
  attacker: Faction
  /** 0..1 — share of the attacking force still standing when the player left. */
  attackerStrength: number
  /** 0..1 — share of the defending force still standing. */
  defenderStrength: number
}

export interface MaterializedRaidResolution {
  events: ChronicleEvent[]
  attackerWon: boolean
}

export interface MaterializedRaidContext {
  state: ChronicleState
  regions: Map<string, RegionChronicleState>
  rng: RandomStream
  protectedRegionIds: ReadonlySet<string>
  /** Unique prefix for the log entries this resolution writes. */
  idPrefix: string
  outcome: MaterializedRaidOutcome
}

/** Settles a raid the player abandoned mid-fight, weighted by who was still alive. */
export function resolveMaterializedRaid(
  context: MaterializedRaidContext,
): MaterializedRaidResolution {
  const { state, regions, rng, outcome } = context
  const region = regions.get(String(outcome.regionId))
  const events: ChronicleEvent[] = []
  if (!region) return { events, attackerWon: false }

  let sequence = 0
  const record = (
    kind: ChronicleEventKind,
    faction: Faction | null,
    siteId: SiteId | null,
  ): void => {
    sequence += 1
    events.push(
      appendChronicleEvent(
        state,
        `${context.idPrefix}-${sequence}`,
        kind,
        outcome.regionId,
        faction,
        siteId,
      ),
    )
  }

  const attackerStrength = clamp01(outcome.attackerStrength)
  const defenderStrength = clamp01(outcome.defenderStrength)
  const total = attackerStrength + defenderStrength
  // No attackers left is a raid the defenders survived, no roll needed.
  const attackerWon =
    attackerStrength <= 0
      ? false
      : total <= 0
        ? true
        : rng.chance(clamp01(attackerStrength / total))
  region.lastEventTick = state.tick

  // The assault force is spent out of the region it marched from — that is the pressure
  // the front is measured on, so this is what stops the same raid re-forming at once.
  const source =
    outcome.sourceRegionId === null
      ? undefined
      : regions.get(String(outcome.sourceRegionId))
  if (source) {
    source.pressure[outcome.attacker] = clamp01(
      source.pressure[outcome.attacker] *
        (attackerWon ? RAID_SOURCE_SPEND_WON : RAID_SOURCE_SPEND_REPELLED),
    )
    source.lastEventTick = state.tick
  }

  if (!attackerWon) {
    region.pressure[outcome.attacker] = clamp01(
      region.pressure[outcome.attacker] * 0.4,
    )
    record('raidRepelled', outcome.attacker, outcome.siteId)
    return { events, attackerWon }
  }

  const defender = region.control
  if (
    !context.protectedRegionIds.has(String(outcome.regionId)) &&
    defender !== outcome.attacker
  ) {
    region.control = outcome.attacker
    region.pressure[outcome.attacker] = clamp01(
      Math.max(region.pressure[outcome.attacker], attackerStrength * 0.6 + 0.2),
    )
    if (defender !== 'neutral') {
      region.pressure[defender] = clamp01(region.pressure[defender] * 0.3)
    }
    record('regionCaptured', outcome.attacker, null)
  }
  if (outcome.siteId !== null && region.settlementIntegrity > 0) {
    const damage = rng.range(SETTLEMENT_RAID_DAMAGE[0], SETTLEMENT_RAID_DAMAGE[1])
    region.settlementIntegrity = Math.max(0, region.settlementIntegrity - damage)
    region.supply = clamp01(region.supply - 0.08)
    if (region.settlementIntegrity <= 0) {
      record('settlementBurned', null, outcome.siteId)
    }
  }
  return { events, attackerWon }
}

export interface MaterializedCaravanOutcome {
  caravanId: string
  regionId: RegionId
  /** True when the caravan was still rolling as the player walked away. */
  intact: boolean
}

/** Settles an ambushed caravan: an intact one simply rejoins the chronicle's route. */
export function resolveMaterializedCaravan(context: {
  state: ChronicleState
  regions: Map<string, RegionChronicleState>
  idPrefix: string
  outcome: MaterializedCaravanOutcome
}): ChronicleEvent[] {
  const { state, regions, outcome } = context
  const caravan = state.caravans.find((entry) => entry.id === outcome.caravanId)
  if (!caravan || outcome.intact) return []
  state.caravans = state.caravans.filter((entry) => entry.id !== outcome.caravanId)
  const destination = regions.get(
    String(caravan.regionPath[caravan.regionPath.length - 1]),
  )
  if (destination) {
    destination.supply = clamp01(destination.supply - SUPPLY_CARAVAN_LOSS)
  }
  return [
    appendChronicleEvent(
      state,
      `${context.idPrefix}-1`,
      'caravanLost',
      outcome.regionId,
      caravan.ownerFaction,
      caravan.toSiteId,
    ),
  ]
}

export interface MaterializedWarbandOutcome {
  regionId: RegionId
  faction: Faction
  /** 0..1 — share of the warband still standing when the player left. */
  survivorShare: number
}
/**
 * A warband the player thinned out loosens its faction's grip on the region. No log
 * entry: nothing happened that the chronicle would have written down on its own.
 */
export function resolveMaterializedWarband(context: {
  regions: Map<string, RegionChronicleState>
  outcome: MaterializedWarbandOutcome
}): void {
  const region = context.regions.get(String(context.outcome.regionId))
  if (!region) return
  const survivors = clamp01(context.outcome.survivorShare)
  region.pressure[context.outcome.faction] = clamp01(
    region.pressure[context.outcome.faction] * (0.3 + 0.7 * survivors),
  )
}

export interface MaterializedBeastRaidOutcome {
  regionId: RegionId
  /** Settlement the pack came for. */
  siteId: SiteId | null
  /** 0..1 — share of the pack still standing when the player left. */
  beastStrength: number
  /** 0..1 — share of the settlement's defenders still standing. */
  defenderStrength: number
}

export interface MaterializedBeastRaidResolution {
  events: ChronicleEvent[]
  beastsWon: boolean
}

/**
 * Layer 3 — settles a beast raid the player abandoned or finished. Beasts hold no
 * territory, so unlike a faction raid nothing changes hands: the only stakes are the
 * settlement and how much fight the forest has left.
 */
export function resolveMaterializedBeastRaid(context: {
  state: ChronicleState
  regions: Map<string, RegionChronicleState>
  rng: RandomStream
  idPrefix: string
  outcome: MaterializedBeastRaidOutcome
}): MaterializedBeastRaidResolution {
  const { state, regions, rng, outcome } = context
  const region = regions.get(String(outcome.regionId))
  const events: ChronicleEvent[] = []
  if (!region) return { events, beastsWon: false }

  let sequence = 0
  const record = (kind: ChronicleEventKind, siteId: SiteId | null): void => {
    sequence += 1
    events.push(
      appendChronicleEvent(
        state,
        `${context.idPrefix}-${sequence}`,
        kind,
        outcome.regionId,
        null,
        siteId,
      ),
    )
  }

  const beastStrength = clamp01(outcome.beastStrength)
  const defenderStrength = clamp01(outcome.defenderStrength)
  const total = beastStrength + defenderStrength
  // A pack that is already dead does not get a roll, and neither does one that ate
  // every defender: a fight the player finished resolves deterministically.
  const beastsWon =
    beastStrength <= 0
      ? false
      : total <= 0
        ? true
        : rng.chance(clamp01(beastStrength / total))
  region.lastEventTick = state.tick

  if (!beastsWon) {
    region.beastPressure = Math.min(region.beastPressure, BEAST_RAID_REPELLED_RESET)
    record('beastsRepelled', outcome.siteId)
    return { events, beastsWon }
  }

  region.beastPressure = BEAST_RAID_RESET
  record('beastRaid', outcome.siteId)
  if (outcome.siteId !== null && region.settlementIntegrity > 0) {
    const damage = rng.range(SETTLEMENT_RAID_DAMAGE[0], SETTLEMENT_RAID_DAMAGE[1])
    region.settlementIntegrity = Math.max(0, region.settlementIntegrity - damage)
    region.supply = clamp01(region.supply - 0.08)
    if (region.settlementIntegrity <= 0) record('settlementBurned', outcome.siteId)
  }
  return { events, beastsWon }
}

function updateFactionStrength(context: ChronicleTickContext): void {
  const { blueprint, state, regions } = context
  const total = Math.max(1, blueprint.regions.length)
  const held: Record<Faction, number> = { elf: 0, guard: 0, villain: 0 }
  for (const region of blueprint.regions) {
    const chronicle = regions.get(String(region.id))
    if (chronicle && chronicle.control !== 'neutral') held[chronicle.control] += 1
  }
  for (const faction of WORLD_FACTIONS) {
    const objectiveBonus =
      faction === context.playerFaction
        ? clamp01(context.playerObjectiveRatio) * STRENGTH_OBJECTIVE_SHARE
        : 0
    state.factionStrength[faction] = clamp01(
      STRENGTH_BASE + (held[faction] / total) * STRENGTH_TERRITORY_SHARE + objectiveBonus,
    )
  }
}

function advancePressure(context: ChronicleTickContext): void {
  const { blueprint, state, regions } = context
  for (const region of blueprint.regions) {
    const chronicle = regions.get(String(region.id))
    if (!chronicle) continue
    for (const faction of WORLD_FACTIONS) {
      const current = chronicle.pressure[faction]
      chronicle.pressure[faction] =
        chronicle.control === faction
          ? clamp01(current + (state.factionStrength[faction] - current) * PRESSURE_GROWTH)
          : clamp01(current - PRESSURE_DECAY)
    }
  }
}

function resolveFronts(
  context: ChronicleTickContext,
  index: ChronicleSiteIndex,
  record: (
    kind: ChronicleEventKind,
    regionId: RegionId,
    faction: Faction | null,
    siteId: SiteId | null,
  ) => void,
): RegionId[] {
  const { blueprint, regions, rng } = context
  const captured: RegionId[] = []
  for (const segment of blueprint.roads.segments) {
    for (const [sourceId, targetId] of [
      [segment.fromRegionId, segment.toRegionId],
      [segment.toRegionId, segment.fromRegionId],
    ] as const) {
      const source = regions.get(String(sourceId))
      const target = regions.get(String(targetId))
      if (!source || !target) continue
      const attacker = source.control
      if (attacker === 'neutral' || attacker === target.control) continue
      if (
        index.protectedRegionIds.has(String(targetId)) ||
        context.protectedRegionIds.has(String(targetId)) ||
        context.frozenRegionIds.has(String(targetId))
      ) {
        continue
      }
      const defender = target.control
      if (defender !== 'neutral') {
        target.pressure[defender] = clamp01(
          target.pressure[defender] - PRESSURE_ATTRITION,
        )
      }
      if (context.state.tick - target.lastEventTick < CONTROL_FLIP_COOLDOWN_TICKS) {
        continue
      }
      const attackerPressure = source.pressure[attacker]
      const defenderPressure = defender === 'neutral' ? 0 : target.pressure[defender]
      const advantage = attackerPressure - defenderPressure
      if (advantage <= CONTROL_FLIP_MARGIN) continue
      if (!rng.chance(clamp01((advantage - CONTROL_FLIP_MARGIN) * 2 + 0.2))) continue

      target.control = attacker
      target.pressure[attacker] = clamp01(Math.max(target.pressure[attacker], attackerPressure * 0.6))
      if (defender !== 'neutral') target.pressure[defender] *= 0.3
      source.pressure[attacker] = clamp01(attackerPressure * 0.5)
      target.lastEventTick = context.state.tick
      captured.push(targetId)
      record('regionCaptured', targetId, attacker, null)
    }
  }
  return captured
}

function advanceBeasts(
  context: ChronicleTickContext,
  index: ChronicleSiteIndex,
  record: (
    kind: ChronicleEventKind,
    regionId: RegionId,
    faction: Faction | null,
    siteId: SiteId | null,
  ) => void,
): void {
  const { blueprint, regions, rng, environment } = context
  const nightMultiplier =
    1 + (BEAST_NIGHT_MULTIPLIER - 1) * clamp01(environment.nightFactor)
  const stormMultiplier =
    1 + (BEAST_STORM_MULTIPLIER - 1) * clamp01(environment.stormFactor)
  for (const region of blueprint.regions) {    const chronicle = regions.get(String(region.id))
    if (!chronicle) continue
    const growth = beastGrowthForBiome(region)
    if (growth > 0) {
      chronicle.beastPressure = clamp01(
        chronicle.beastPressure + growth * nightMultiplier * stormMultiplier,
      )
    }
    if (chronicle.control !== 'neutral') {
      chronicle.beastPressure = clamp01(chronicle.beastPressure - BEAST_CONTROL_DECAY)
    }
    if (chronicle.beastPressure < BEAST_RAID_THRESHOLD) continue
    if (context.frozenRegionIds.has(String(region.id))) continue
    if (chronicle.settlementIntegrity <= 0) continue
    const targets = index.settlementSiteIds.get(String(region.id)) ?? []
    if (targets.length === 0) continue
    chronicle.beastPressure = BEAST_RAID_RESET
    const siteId = targets.length === 1 ? targets[0] : rng.pick(targets)
    record('beastRaid', region.id, null, siteId)
    chronicle.lastEventTick = context.state.tick
    applyRaidDamage(context, chronicle, region.id, siteId, record)
  }
}

function damageSettlements(
  context: ChronicleTickContext,
  index: ChronicleSiteIndex,
  regionId: RegionId,
  record: (
    kind: ChronicleEventKind,
    regionId: RegionId,
    faction: Faction | null,
    siteId: SiteId | null,
  ) => void,
): void {
  const chronicle = context.regions.get(String(regionId))
  const targets = index.settlementSiteIds.get(String(regionId)) ?? []
  if (!chronicle || targets.length === 0) return
  const siteId = targets.length === 1 ? targets[0] : context.rng.pick(targets)
  applyRaidDamage(context, chronicle, regionId, siteId, record)
}

function applyRaidDamage(
  context: ChronicleTickContext,
  chronicle: RegionChronicleState,
  regionId: RegionId,
  siteId: SiteId,
  record: (
    kind: ChronicleEventKind,
    regionId: RegionId,
    faction: Faction | null,
    siteId: SiteId | null,
  ) => void,
): void {
  if (chronicle.settlementIntegrity <= 0) return
  const damage = context.rng.range(SETTLEMENT_RAID_DAMAGE[0], SETTLEMENT_RAID_DAMAGE[1])
  chronicle.settlementIntegrity = Math.max(0, chronicle.settlementIntegrity - damage)
  chronicle.supply = clamp01(chronicle.supply - 0.08)
  if (chronicle.settlementIntegrity > 0) return
  record('settlementBurned', regionId, null, siteId)
}

function advanceSettlements(context: ChronicleTickContext): void {
  const { blueprint, state, regions } = context
  for (const region of blueprint.regions) {
    const chronicle = regions.get(String(region.id))
    if (!chronicle) continue
    chronicle.supply = clamp01(
      chronicle.supply + (SUPPLY_BASELINE - chronicle.supply) * SUPPLY_DRIFT,
    )
    if (chronicle.settlementIntegrity <= 0) continue
    if (state.tick - chronicle.lastEventTick < SETTLEMENT_CALM_TICKS) continue
    chronicle.settlementIntegrity = Math.min(
      100,
      chronicle.settlementIntegrity + SETTLEMENT_REGEN,
    )
  }
}

function advanceCaravans(
  context: ChronicleTickContext,
  index: ChronicleSiteIndex,
  record: (
    kind: ChronicleEventKind,
    regionId: RegionId,
    faction: Faction | null,
    siteId: SiteId | null,
  ) => void,
): void {
  const { state, regions, rng } = context
  const survivors: ChronicleCaravan[] = []
  for (const caravan of state.caravans) {
    if (!caravan.intact || caravan.regionPath.length === 0) continue
    const previousIndex = regionIndexAt(caravan)
    caravan.progress = Math.min(1, caravan.progress + CARAVAN_PROGRESS_PER_TICK)
    const stepIndex = regionIndexAt(caravan)
    const currentRegionId = caravan.regionPath[stepIndex]
    const current = regions.get(String(currentRegionId))
    // An interception is rolled per region traversed, not per tick, and only on
    // hostile or beast-heavy ground: a quiet friendly corridor is simply safe.
    const enteredRegion = stepIndex !== previousIndex
    const hostileGround =
      current !== undefined &&
      current.control !== 'neutral' &&
      current.control !== caravan.ownerFaction
    const beastGround =
      current !== undefined && current.beastPressure >= CARAVAN_BEAST_THRESHOLD
    if (enteredRegion && (hostileGround || beastGround)) {
      const risk =
        CARAVAN_INTERCEPT_BASE +
        (hostileGround ? CARAVAN_HOSTILE_RISK : 0) +
        (beastGround ? (current?.beastPressure ?? 0) * CARAVAN_BEAST_RISK : 0)
      if (rng.chance(Math.min(0.85, risk))) {
        caravan.intact = false
        const destination = regions.get(
          String(caravan.regionPath[caravan.regionPath.length - 1]),
        )
        if (destination) {
          destination.supply = clamp01(destination.supply - SUPPLY_CARAVAN_LOSS)
        }
        record('caravanLost', currentRegionId, caravan.ownerFaction, caravan.toSiteId)
        continue
      }
    }
    if (caravan.progress >= 1) {
      const destination = regions.get(
        String(caravan.regionPath[caravan.regionPath.length - 1]),
      )
      if (destination) destination.supply = clamp01(destination.supply + SUPPLY_CARAVAN_GAIN)
      record('caravanArrived', currentRegionId, caravan.ownerFaction, caravan.toSiteId)
      continue
    }
    survivors.push(caravan)
  }
  state.caravans = survivors

  while (state.caravans.length < CHRONICLE_CARAVAN_LIMIT && index.caravanRoutes.length > 0) {
    const route = rng.pick(index.caravanRoutes)
    const origin = regions.get(String(route.regionPath[0]))
    const ownerFaction: Faction =
      origin && origin.control !== 'neutral' ? origin.control : rng.pick(WORLD_FACTIONS)
    state.caravans.push({
      id: `caravan-${state.tick}-${state.caravans.length + 1}`,
      ownerFaction,
      fromSiteId: route.fromSiteId,
      toSiteId: route.toSiteId,
      regionPath: [...route.regionPath],
      progress: 0,
      intact: true,
    })
  }
}

function beastGrowthForBiome(region: WorldRegion): number {
  if (region.biome === 'forest') return BEAST_GROWTH_FOREST
  if (region.biome === 'fort') return BEAST_GROWTH_FORT
  return 0
}

function regionIndexAt(caravan: ChronicleCaravan): number {
  return Math.min(
    caravan.regionPath.length - 1,
    Math.floor(caravan.progress * caravan.regionPath.length),
  )
}

/** The region a caravan is currently rolling through. */
export function getCaravanRegionId(caravan: ChronicleCaravan): RegionId | null {
  if (caravan.regionPath.length === 0) return null
  return caravan.regionPath[regionIndexAt(caravan)]
}

const blueprintIndexCache = new WeakMap<WorldBlueprint, ChronicleSiteIndex>()

function indexBlueprint(blueprint: WorldBlueprint): ChronicleSiteIndex {
  const cached = blueprintIndexCache.get(blueprint)
  if (cached) return cached
  const settlementSiteIds = new Map<string, SiteId[]>()
  for (const site of readSites(blueprint)) {
    if (isProtectedSite(site) || !isSettlementSite(site)) continue
    const key = String(site.regionId)
    const list = settlementSiteIds.get(key) ?? []
    list.push(site.id)
    settlementSiteIds.set(key, list)
  }
  const caravanRoutes = readRoadConnections(blueprint)
    .filter((connection) => connection.regionPath.length >= 2)
    .map((connection) => ({
      id: connection.id,
      fromSiteId: connection.fromSiteId,
      toSiteId: connection.toSiteId,
      regionPath: [...connection.regionPath],
    }))
  // Caravans run between places that trade — short branch roads between
  // settlements, shops, and healers — not the length of a campaign highway.
  const tradeSiteIds = new Set(
    readSites(blueprint)
      .filter((site) => isSettlementSite(site))
      .map((site) => site.id),
  )
  const tradeRoutes = caravanRoutes.filter(
    (route) => tradeSiteIds.has(route.fromSiteId) || tradeSiteIds.has(route.toSiteId),
  )
  const index: ChronicleSiteIndex = {
    settlementSiteIds,
    protectedRegionIds: getChronicleProtectedRegionIds(blueprint),
    caravanRoutes: tradeRoutes.length > 0 ? tradeRoutes : caravanRoutes,
  }
  blueprintIndexCache.set(blueprint, index)
  return index
}

function readSites(blueprint: WorldBlueprint): readonly WorldSite[] {
  return Array.isArray(blueprint?.sites) ? blueprint.sites : []
}

function readRoadConnections(
  blueprint: WorldBlueprint,
): readonly { id: string; fromSiteId: SiteId; toSiteId: SiteId; regionPath: RegionId[] }[] {
  const connections = blueprint?.roads?.connections
  return Array.isArray(connections)
    ? connections.filter((connection) => Array.isArray(connection?.regionPath))
    : []
}

/** Regions the chronicle must never capture or raze, so every campaign stays completable. */
export function getChronicleProtectedRegionIds(
  blueprint: WorldBlueprint,
): ReadonlySet<string> {
  const protectedRegionIds = new Set<string>()
  for (const site of readSites(blueprint)) {
    if (isProtectedSite(site)) protectedRegionIds.add(String(site.regionId))
  }
  return protectedRegionIds
}

export function getChronicleSettlementSiteIds(
  blueprint: WorldBlueprint,
  regionId: RegionId,
): readonly SiteId[] {
  return indexBlueprint(blueprint).settlementSiteIds.get(String(regionId)) ?? []
}

export function isSettlementSite(site: WorldSite): boolean {
  return (CHRONICLE_SETTLEMENT_SITE_KINDS as readonly string[]).includes(site.kind)
}

export function isProtectedSite(site: WorldSite): boolean {
  return (CHRONICLE_PROTECTED_SITE_KINDS as readonly string[]).includes(site.kind)
}

export function normalizeRegionChronicleState(
  value: unknown,
): RegionChronicleState | null {
  const record = asRecord(value)
  if (!record) return null
  const control = normalizeTerritory(record.control)
  const pressure = normalizePressure(record.pressure)
  const beastPressure = normalizeUnit(record.beastPressure)
  const settlementIntegrity = normalizeBounded(record.settlementIntegrity, 0, 100)
  const supply = normalizeUnit(record.supply)
  const lastEventTick = normalizeCounter(record.lastEventTick)
  if (
    control === null ||
    pressure === null ||
    beastPressure === null ||
    settlementIntegrity === null ||
    supply === null ||
    lastEventTick === null
  ) {
    return null
  }
  return {
    control,
    pressure,
    beastPressure,
    settlementIntegrity,
    supply,
    lastEventTick,
  }
}

export function normalizeChronicleState(value: unknown): ChronicleState | null {
  const record = asRecord(value)
  if (!record) return null
  const tick = normalizeCounter(record.tick)
  const factionStrength = normalizePressure(record.factionStrength)
  if (tick === null || factionStrength === null) return null
  if (!Array.isArray(record.caravans) || !Array.isArray(record.log)) return null
  if (record.caravans.length > CHRONICLE_CARAVAN_LIMIT * 4) return null
  if (record.log.length > CHRONICLE_LOG_LIMIT) return null

  const caravans: ChronicleCaravan[] = []
  for (const entry of record.caravans) {
    const caravan = normalizeCaravan(entry)
    if (!caravan) return null
    caravans.push(caravan)
  }
  const log: ChronicleEvent[] = []
  for (const entry of record.log) {
    const event = normalizeChronicleEvent(entry)
    if (!event) return null
    log.push(event)
  }
  return { tick, factionStrength, caravans, log }
}

function normalizeCaravan(value: unknown): ChronicleCaravan | null {
  const record = asRecord(value)
  if (!record) return null
  const id = normalizeIdentifier(record.id)
  const ownerFaction = normalizeFaction(record.ownerFaction)
  const fromSiteId = normalizeIdentifier(record.fromSiteId)
  const toSiteId = normalizeIdentifier(record.toSiteId)
  const progress = normalizeUnit(record.progress)
  if (
    !id ||
    !ownerFaction ||
    !fromSiteId ||
    !toSiteId ||
    progress === null ||
    typeof record.intact !== 'boolean' ||
    !Array.isArray(record.regionPath) ||
    record.regionPath.length === 0 ||
    record.regionPath.length > 64
  ) {
    return null
  }
  const regionPath: RegionId[] = []
  for (const entry of record.regionPath) {
    const regionId = normalizeIdentifier(entry)
    if (!regionId) return null
    regionPath.push(regionId)
  }
  return {
    id,
    ownerFaction,
    fromSiteId,
    toSiteId,
    regionPath,
    progress,
    intact: record.intact,
  }
}

function normalizeChronicleEvent(value: unknown): ChronicleEvent | null {
  const record = asRecord(value)
  if (!record) return null
  const id = normalizeIdentifier(record.id)
  const tick = normalizeCounter(record.tick)
  const regionId = normalizeIdentifier(record.regionId)
  const kind = normalizeEventKind(record.kind)
  const faction = record.faction === null ? null : normalizeFaction(record.faction)
  const siteId = record.siteId === null ? null : normalizeIdentifier(record.siteId)
  if (!id || tick === null || !regionId || !kind) return null
  if (record.faction !== null && !faction) return null
  if (record.siteId !== null && !siteId) return null
  return { id, tick, kind, regionId, faction, siteId }
}

const CHRONICLE_EVENT_KINDS: readonly ChronicleEventKind[] = [
  'regionCaptured',
  'raidRepelled',
  'beastRaid',
  'beastsRepelled',
  'settlementBurned',
  'caravanLost',
  'caravanArrived',
]

function normalizeEventKind(value: unknown): ChronicleEventKind | null {
  return typeof value === 'string' &&
    (CHRONICLE_EVENT_KINDS as readonly string[]).includes(value)
    ? (value as ChronicleEventKind)
    : null
}

function normalizeFaction(value: unknown): Faction | null {
  return typeof value === 'string' && (WORLD_FACTIONS as readonly string[]).includes(value)
    ? (value as Faction)
    : null
}

function normalizeTerritory(value: unknown): Territory | null {
  if (value === 'neutral') return 'neutral'
  return normalizeFaction(value)
}

function normalizePressure(value: unknown): Record<Faction, number> | null {
  const record = asRecord(value)
  if (!record) return null
  const elf = normalizeUnit(record.elf)
  const guard = normalizeUnit(record.guard)
  const villain = normalizeUnit(record.villain)
  if (elf === null || guard === null || villain === null) return null
  return { elf, guard, villain }
}

function normalizeUnit(value: unknown): number | null {
  return normalizeBounded(value, 0, 1)
}

function normalizeBounded(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : null
}

function normalizeCounter(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null
}

function normalizeIdentifier(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    ? value
    : null
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
