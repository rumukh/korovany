/**
 * Layer 2, §5.2 — what the chronicle would have done if the player were not standing
 * there.
 *
 * The chronicle deliberately freezes simulated regions (`frozenRegionIds`): it never
 * flips control of, or burns a settlement in, a region the player can see, because the
 * player must never watch a building change state from thin air. That leaves a set of
 * *pending* situations — a front about to break, a caravan rolling into hostile ground,
 * a warband holding a square, a settlement already reduced to ashes. This module names
 * them; `GameEngine` turns them into actors and props.
 *
 * Pure data in, pure data out: no THREE, no scene, no actors, no RNG. The materializer
 * is a consumer of chronicle output, never the other way round.
 */

import type { Faction } from '../types.ts'
import {
  BEAST_RAID_THRESHOLD,
  CARAVAN_BEAST_THRESHOLD,
  CONTROL_FLIP_COOLDOWN_TICKS,
  CONTROL_FLIP_MARGIN,
  getCaravanRegionId,
  getChronicleSettlementSiteIds,
  isRegionRazed,
  type ChronicleState,
  type RegionChronicleState,
} from './Chronicle.ts'
import type { Territory, WorldBlueprint } from './worldTypes.ts'

export type MaterializedEventKind =
  | 'factionRaid'
  | 'caravanAmbush'
  | 'warband'
  | 'aftermath'
  | 'beastRaid'

/**
 * Raids materialize a little earlier than the chronicle would flip a region on its own,
 * so the player meets the fight rather than the result of it.
 */
export const MATERIALIZE_RAID_MARGIN = CONTROL_FLIP_MARGIN * 0.6
/** Below this, a faction is holding a square rather than patrolling it. */
export const MATERIALIZE_WARBAND_PRESSURE = 0.32
/**
 * Layer 3 — same rule for the forest: the pack shows up a little before the chronicle
 * would have written the raid down, so the player meets the wolves and not the wreckage.
 */
export const MATERIALIZE_BEAST_PRESSURE = BEAST_RAID_THRESHOLD - 0.12

const RAID_URGENCY_BASE = 0.6
const AMBUSH_URGENCY_BASE = 0.45
const WARBAND_URGENCY_SCALE = 0.35
const AFTERMATH_URGENCY = 0.3
const BEAST_RAID_URGENCY_BASE = 0.5

export interface PendingMaterialization {
  /** Stable across ticks, so one situation never starts two events. */
  id: string
  kind: MaterializedEventKind
  regionId: string
  /** For `factionRaid`: the region the attackers march from. */
  sourceRegionId: string | null
  siteId: string | null
  /** Attacker, caravan owner, or warband owner. Beasts have none — that is the point. */
  faction: Faction | null
  /** Whoever holds the ground. */
  defender: Territory | null
  /** Set for `caravanAmbush`, so the hand-back can find the chronicle's caravan. */
  caravanId: string | null
  /** For `beastRaid`: chronicle beast pressure, which sizes the pack. */
  beastPressure: number
  /** 0..1 — how badly the chronicle wants this to happen. Highest wins. */
  urgency: number
}

export interface MaterializationContext {
  blueprint: WorldBlueprint
  regions: ReadonlyMap<string, RegionChronicleState>
  chronicle: ChronicleState
  /** Regions currently streamed in; only these can host a materialized event. */
  simulatedRegionIds: ReadonlySet<string>
  /** Campaign anchors: their control never changes, so they never host a raid. */
  protectedRegionIds: ReadonlySet<string>
  playerFaction: Faction
  /** Regions whose aftermath the player has already been shown this run. */
  seenAftermathRegionIds: ReadonlySet<string>
}

/**
 * Everything the chronicle is holding back in simulated regions, most urgent first.
 * Deterministic: no RNG, and ties break on the stable situation id.
 */
export function findPendingMaterializations(
  context: MaterializationContext,
): PendingMaterialization[] {
  const pending: PendingMaterialization[] = [
    ...findFactionRaids(context),
    ...findBeastRaids(context),
    ...findCaravanAmbushes(context),
    ...findWarbands(context),
    ...findAftermaths(context),
  ]
  return pending.sort(
    (left, right) =>
      right.urgency - left.urgency || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  )
}

function findFactionRaids(
  context: MaterializationContext,
): PendingMaterialization[] {
  const best = new Map<string, PendingMaterialization>()
  for (const segment of context.blueprint.roads.segments) {
    for (const [sourceId, targetId] of [
      [segment.fromRegionId, segment.toRegionId],
      [segment.toRegionId, segment.fromRegionId],
    ] as const) {
      const target = String(targetId)
      if (!context.simulatedRegionIds.has(target)) continue
      if (context.protectedRegionIds.has(target)) continue
      const source = context.regions.get(String(sourceId))
      const defenderState = context.regions.get(target)
      if (!source || !defenderState) continue
      const attacker = source.control
      if (attacker === 'neutral' || attacker === defenderState.control) continue
      if (isRegionRazed(defenderState)) continue
      // A square that has just been fought over gets the same breathing room the
      // chronicle's own fronts get, so a repelled raid cannot re-form immediately.
      if (
        context.chronicle.tick - defenderState.lastEventTick <
        CONTROL_FLIP_COOLDOWN_TICKS
      ) {
        continue
      }
      const siteId = pickSettlementSiteId(context, target)
      if (!siteId) continue
      const defenderPressure =
        defenderState.control === 'neutral'
          ? 0
          : defenderState.pressure[defenderState.control]
      const advantage = source.pressure[attacker] - defenderPressure
      if (advantage <= MATERIALIZE_RAID_MARGIN) continue
      const candidate: PendingMaterialization = {
        id: `raid:${target}:${attacker}`,
        kind: 'factionRaid',
        regionId: target,
        sourceRegionId: String(sourceId),
        siteId,
        faction: attacker,
        defender: defenderState.control,
        caravanId: null,
        beastPressure: 0,
        urgency: clamp01(RAID_URGENCY_BASE + advantage),
      }
      const existing = best.get(target)
      if (!existing || existing.urgency < candidate.urgency) best.set(target, candidate)
    }
  }
  return [...best.values()]
}

/**
 * Layer 3 — the forest coming for a settlement. Unlike a faction raid this has no
 * source region and no attacker faction: `beastPressure` is the whole cause, and the
 * pack is sized from it. A razed square is skipped for the same reason the chronicle
 * skips it — there is nothing left to eat.
 */
function findBeastRaids(context: MaterializationContext): PendingMaterialization[] {
  const pending: PendingMaterialization[] = []
  for (const key of context.simulatedRegionIds) {
    const region = context.regions.get(key)
    if (!region) continue
    if (region.beastPressure < MATERIALIZE_BEAST_PRESSURE) continue
    if (isRegionRazed(region)) continue
    // Same breathing room a square gets after any other fight.
    if (context.chronicle.tick - region.lastEventTick < CONTROL_FLIP_COOLDOWN_TICKS) {
      continue
    }
    const siteId = pickSettlementSiteId(context, key)
    if (!siteId) continue
    pending.push({
      id: `beasts:${key}`,
      kind: 'beastRaid',
      regionId: key,
      sourceRegionId: null,
      siteId,
      faction: null,
      defender: region.control,
      caravanId: null,
      beastPressure: region.beastPressure,
      urgency: clamp01(BEAST_RAID_URGENCY_BASE + region.beastPressure * 0.3),
    })
  }
  return pending
}

function findCaravanAmbushes(
  context: MaterializationContext,
): PendingMaterialization[] {
  const pending: PendingMaterialization[] = []
  for (const caravan of context.chronicle.caravans) {
    if (!caravan.intact) continue
    const regionId = getCaravanRegionId(caravan)
    if (regionId === null) continue
    const key = String(regionId)
    if (!context.simulatedRegionIds.has(key)) continue
    const region = context.regions.get(key)
    if (!region) continue
    const hostileGround =
      region.control !== 'neutral' && region.control !== caravan.ownerFaction
    const beastGround = region.beastPressure >= CARAVAN_BEAST_THRESHOLD
    if (!hostileGround && !beastGround) continue
    pending.push({
      id: `ambush:${caravan.id}`,
      kind: 'caravanAmbush',
      regionId: key,
      sourceRegionId: null,
      siteId: caravan.toSiteId,
      faction: caravan.ownerFaction,
      defender: region.control,
      caravanId: caravan.id,
      beastPressure: region.beastPressure,
      urgency: clamp01(AMBUSH_URGENCY_BASE + (hostileGround ? 0.15 : 0)),
    })
  }
  return pending
}

function findWarbands(context: MaterializationContext): PendingMaterialization[] {
  const pending: PendingMaterialization[] = []
  for (const key of context.simulatedRegionIds) {
    const region = context.regions.get(key)
    if (!region || region.control === 'neutral') continue
    if (region.control === context.playerFaction) continue
    const pressure = region.pressure[region.control]
    if (pressure < MATERIALIZE_WARBAND_PRESSURE) continue
    pending.push({
      id: `warband:${key}:${region.control}`,
      kind: 'warband',
      regionId: key,
      sourceRegionId: null,
      siteId: null,
      faction: region.control,
      defender: region.control,
      caravanId: null,
      beastPressure: region.beastPressure,
      urgency: clamp01(pressure * WARBAND_URGENCY_SCALE),
    })
  }
  return pending
}

function findAftermaths(context: MaterializationContext): PendingMaterialization[] {
  const pending: PendingMaterialization[] = []
  for (const key of context.simulatedRegionIds) {
    if (context.seenAftermathRegionIds.has(key)) continue
    const region = context.regions.get(key)
    if (!region || !isRegionRazed(region)) continue
    pending.push({
      id: `aftermath:${key}`,
      kind: 'aftermath',
      regionId: key,
      sourceRegionId: null,
      siteId: pickSettlementSiteId(context, key),
      faction: region.control === 'neutral' ? null : region.control,
      defender: region.control,
      caravanId: null,
      beastPressure: region.beastPressure,
      urgency: AFTERMATH_URGENCY,
    })
  }
  return pending
}

function pickSettlementSiteId(
  context: MaterializationContext,
  regionId: string,
): string | null {
  const siteIds = getChronicleSettlementSiteIds(context.blueprint, regionId)
  return siteIds.length === 0 ? null : String(siteIds[0])
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
