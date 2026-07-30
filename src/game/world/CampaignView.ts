/**
 * The one authoritative `GameView` builder.
 *
 * There used to be two. `GameEngine.emitView` built the live view every frame, and
 * `App.tsx` hand-rolled a parallel `createGeneratedInitialView` so the HUD had something
 * to draw between pressing *start* and the engine's first frame. The second one generated
 * its own copy of the world to do it, duplicated the objective builder, and — because it
 * was written separately — could disagree with the first about anything at all. A HUD that
 * shows one campaign for a frame and a different one afterwards is a bug nobody would
 * think to look for.
 *
 * Both now come through here. The live path passes engine state; the launch path passes a
 * blueprint and a save. The pieces they share — the world map, the region flags, the
 * objective list, the ability gating — are shared functions rather than parallel prose.
 *
 * Same rules as the other extracted modules: no THREE, no scene, no DOM. Positions arrive
 * as plain numbers, so `GameEngine` reads them off its meshes and the run harness reads
 * them off its own state.
 */

import { getStartingBoonEffects } from '../run/profile.ts'
import {
  CONTRACT_ERRAND_STAKE,
  CONTRACT_FAILED_TASK,
  describeContractStake,
  describeContractTask,
  describeContractTitle,
  formatRegionGridLabel,
  generatedSiteLabel,
} from '../content/gameCopy.ts'
import { getSiteWorldPosition2D } from '../content/registry.ts'
import {
  createAbilityView,
  createHealthyBody,
  createMeleeView,
  getMaxHealth,
  getMaxStamina,
  getThreatTier,
  normalizeUpgradeLevels,
  type AbilityView,
  type BodyState,
  type CampaignContractView,
  type ChronicleEntryView,
  type ChronicleRumourView,
  type Faction,
  type GameView,
  type LootToastView,
  type MapMarker,
  type MeleeView,
  type Objective,
  type WorldEventView,
  type WorldMapRegion,
  type WorldMapView,
  type ZoneId,
} from '../types.ts'
import type { ActiveRunSaveV3, RunConfig } from '../run/runTypes.ts'
import { getContestedRegionIds, isRegionRazed, type RegionChronicleState } from './Chronicle.ts'
import {
  createGeneratedObjectives,
  findContractTemplate,
  getContractProgress,
  getReadyObjectiveNodes,
  normalizeCampaignContractState,
  type CampaignContractState,
} from './CampaignDirector.ts'
import {
  PLAYER_MELEE_BEATS,
  createPlayerMeleeState,
  isPlayerMeleeCommitted,
  nextPlayerMeleeBeat,
  playerBeatSpec,
  type PlayerMeleeState,
} from './CombatResolver.ts'
import type { WorldBlueprint } from './worldTypes.ts'
/** A world marker as the runtime knows it, before it becomes a `MapMarker`. */
export interface ViewMarkerSource {
  id: string
  x: number
  z: number
  label?: string
}

/** One live actor, reduced to what the minimap needs. */
export interface ViewActor {
  id: string
  x: number
  z: number
  kind: MapMarker['kind']
}

/** One live event, reduced to what the minimap and the banner need. */
export interface ViewEvent {
  markerId: string
  markerX: number
  markerZ: number
  title: string
}

export interface WorldMapInput {
  blueprint: WorldBlueprint
  /**
   * The playable rectangle. Passed in rather than read off the blueprint because the two
   * paths have different sources for it — the engine reports what `TerrainSystem`
   * normalised, the launch path has only the blueprint — and `tests/campaignView.test.ts`
   * measures that those two agree rather than assuming it.
   */
  bounds: WorldMapView['bounds']
  /** Chronicle control per region id, if the run has one yet. */
  chronicleRegions: ReadonlyMap<string, RegionChronicleState>
  discoveredRegionIds: ReadonlySet<string>
  currentRegionId: string | undefined
  contestedRegionIds: ReadonlySet<string>
}

/**
 * The world map panel.
 *
 * Region ids are stringified on the way in and on the way out, because the blueprint's
 * `RegionId` and the runtime's discovered set have historically been different widths of
 * the same value and comparing them raw is how a region silently stops being "current".
 */
export function buildWorldMapView(input: WorldMapInput): WorldMapView {
  const regions: WorldMapRegion[] = input.blueprint.regions.map((region) => {
    const id = String(region.id)
    const chronicle = input.chronicleRegions.get(id)
    return {
      id,
      gridX: region.coordinate.x,
      gridZ: region.coordinate.y,
      biome: region.biome,
      territory: chronicle?.control ?? region.territory,
      discovered: input.discoveredRegionIds.has(id),
      current: id === input.currentRegionId,
      contested: input.contestedRegionIds.has(id),
      razed: isRegionRazed(chronicle),
    }
  })
  return {
    bounds: { ...input.bounds },
    ...(input.currentRegionId === undefined
      ? {}
      : { currentRegionId: input.currentRegionId }),
    seed: input.blueprint.seed,
    generatorVersion: input.blueprint.generatorVersion,
    regions,
  }
}

export interface LiveViewInput {
  faction: Faction
  blueprint: WorldBlueprint
  bounds: WorldMapView['bounds']
  health: number
  maxHealth: number
  damageFlash: number
  stamina: number
  maxStamina: number
  gold: number
  kills: number
  damage: number
  zone: ZoneId
  body: BodyState
  objectives: readonly Objective[]
  prompt: string
  playerX: number
  playerZ: number
  playerHeading: number
  caravanX: number
  caravanZ: number
  /** Landmark markers the world runtime is publishing. */
  worldMarkers: readonly ViewMarkerSource[]
  /** The site the active objective points at, when the world runtime knows where it is. */
  activeObjectiveSiteId: string | null
  activeObjectiveSiteX: number | null
  activeObjectiveSiteZ: number | null
  activeObjectiveId: string | null
  events: readonly ViewEvent[]
  actors: readonly ViewActor[]
  chronicleRegions: ReadonlyMap<string, RegionChronicleState>
  discoveredRegionIds: ReadonlySet<string>
  contestedRegionIds: ReadonlySet<string>
  currentRegionId: string | undefined
  chronicle: readonly ChronicleEntryView[]
  /** Roadmap 1.3 — open rumours and, briefly, the last verdict. */
  rumours: readonly ChronicleRumourView[]
  /** Roadmap 1.4 — every ready campaign node, the pinned one included. */
  contracts: readonly CampaignContractView[]
  shopPriceMultiplier: number
  squad: number
  elapsed: number
  pointerLocked: boolean
  paused: boolean
  ended: boolean
  caravanCooldown: number
  shieldActive: boolean
  abilityCooldown: number
  melee: PlayerMeleeState
  campaignCompleted: boolean
  threatTier: number
  upgrades: GameView['upgrades']
  lootToast: LootToastView | null
  activeEvent: WorldEventView | null
}

/**
 * The minimap's markers, in the order the HUD draws them: the player and the cart first,
 * then landmarks, then the objective, then events, then bodies. The order is load-bearing
 * — later markers draw over earlier ones, so a crowd cannot bury the objective pin.
 */
export function buildMapMarkers(input: LiveViewInput): MapMarker[] {
  const markers: MapMarker[] = [
    {
      id: 'player',
      x: input.playerX,
      z: input.playerZ,
      kind: 'player',
      heading: input.playerHeading,
    },
    {
      id: 'caravan',
      x: input.caravanX,
      z: input.caravanZ,
      kind: 'caravan',
    },
  ]
  const activeSiteMarkerId =
    input.activeObjectiveSiteId === null ? null : `site:${input.activeObjectiveSiteId}`
  for (const marker of input.worldMarkers) {
    const site = marker.id.startsWith('site:')
      ? input.blueprint.sites.find((candidate) => `site:${candidate.id}` === marker.id)
      : undefined
    const label = site ? generatedSiteLabel(site.kind) : marker.label
    markers.push({
      id: marker.id,
      x: marker.x,
      z: marker.z,
      kind: marker.id === activeSiteMarkerId ? 'objective' : 'landmark',
      ...(label ? { label } : {}),
    })
  }
  // A site the world runtime has not published a marker for — an objective in a region
  // that has not streamed in — still needs a pin, or the compass points at nothing.
  if (
    activeSiteMarkerId !== null &&
    input.activeObjectiveSiteX !== null &&
    input.activeObjectiveSiteZ !== null &&
    !markers.some((marker) => marker.id === activeSiteMarkerId)
  ) {
    const objective = input.objectives.find(
      (entry) => entry.id === input.activeObjectiveId,
    )
    markers.push({
      id: activeSiteMarkerId,
      x: input.activeObjectiveSiteX,
      z: input.activeObjectiveSiteZ,
      kind: 'objective',
      ...(objective ? { label: objective.text } : {}),
    })
  }
  for (const event of input.events) {
    markers.push({
      id: event.markerId,
      x: event.markerX,
      z: event.markerZ,
      kind: 'event',
      label: event.title,
    })
  }
  // Roadmap 1.3 — the pinned rumour, and only the pinned one. Drawing both offers would
  // make the map answer a question the player has not been asked yet; drawing the one they
  // took on is what turns "go to C3" from a sentence into a direction.
  const pinned = input.rumours.find(
    (rumour) => rumour.pinned && rumour.x !== null && rumour.z !== null,
  )
  if (pinned && pinned.x !== null && pinned.z !== null) {
    markers.push({
      id: `rumour:${pinned.id}`,
      x: pinned.x,
      z: pinned.z,
      kind: 'rumour',
      label: pinned.title,
    })
  }
  // Roadmap 1.4 — the arms of the fork the player did *not* pin. The active one already
  // has an `objective` pin above; drawing the others is the difference between a campaign
  // that offers a choice and a campaign that merely has one.
  for (const entry of input.contracts) {
    if (entry.x === null || entry.z === null) continue
    if (entry.id === input.activeObjectiveId) continue
    const markerId = `site:${entry.id}`
    if (markers.some((marker) => marker.id === markerId)) continue
    markers.push({
      id: markerId,
      x: entry.x,
      z: entry.z,
      kind: 'contract',
      label: entry.title,
    })
  }
  for (const actor of input.actors) {
    markers.push({ id: actor.id, x: actor.x, z: actor.z, kind: actor.kind })
  }
  return markers
}

/**
 * Roadmap 1.4 — the campaign board: every node the player could take on right now.
 *
 * Shared by both view paths for the same reason the objective list is: the launch view and
 * the live view must not be able to disagree about which fork the player is looking at.
 *
 * `sitePosition` is a callback rather than a map because the two callers know where a site
 * is by different means — the engine asks its streamed world runtime, the launch path
 * derives it from the blueprint — and a node whose region has not streamed in yet has no
 * position at all, which the HUD renders as "no pin yet" rather than as the origin.
 */
export interface CampaignContractInput {
  blueprint: WorldBlueprint
  faction: Faction
  objectives: readonly Objective[]
  contracts: CampaignContractState
  sitePosition: (siteId: string) => { x: number; z: number } | null
}

export function buildCampaignContractViews(
  input: CampaignContractInput,
): CampaignContractView[] {
  const ready = getReadyObjectiveNodes(input.blueprint, input.faction, input.objectives)
  return ready.map((node) => {
    const site = input.blueprint.sites.find((candidate) => candidate.id === node.siteId)
    const region = input.blueprint.regions.find(
      (candidate) => String(candidate.id) === String(node.regionId),
    )
    const regionLabel = region
      ? formatRegionGridLabel(region.coordinate.x, region.coordinate.y)
      : '??'
    const siteLabel = site ? generatedSiteLabel(site.kind) : null
    const position = input.sitePosition(node.siteId)
    const objective = input.objectives.find((entry) => entry.id === node.id)
    const template = findContractTemplate(node.contract)
    const progress = getContractProgress(input.contracts, node.id)
    const status = node.contract === undefined ? null : (progress?.status ?? 'offered')
    const contractId = node.contract ?? null
    const title =
      contractId === null
        ? (objective?.text ?? 'Пункт похода')
        : describeContractTitle(contractId)
    const task =
      contractId === null
        ? (objective?.text ?? 'Пункт похода')
        : status === 'failed'
          ? CONTRACT_FAILED_TASK
          : describeContractTask(contractId, { regionLabel, siteLabel })
    const stake =
      contractId === null
        ? CONTRACT_ERRAND_STAKE
        : describeContractStake(contractId, { regionLabel, siteLabel })
    return {
      id: node.id,
      contract: contractId,
      title,
      task,
      stake,
      regionLabel,
      pinned: input.contracts.pinnedNodeId === node.id,
      status,
      timeRemaining:
        status === 'active' && progress && template ? progress.remaining : null,
      x: position?.x ?? null,
      z: position?.z ?? null,
    }
  })
}

/**
 * The ability button.
 *
 * `createAbilityView` answers "can this faction use its ability at this stamina with these
 * limbs"; the run state answers "and is the game actually running". Both have to agree
 * before the button lights up, which is why the readiness is an `&&` rather than a
 * reassignment.
 */
export function buildAbilityView(input: {
  faction: Faction
  stamina: number
  body: BodyState
  shieldActive: boolean
  abilityCooldown: number
  paused: boolean
  ended: boolean
}): AbilityView {
  const ability = createAbilityView(input.faction, input.stamina, input.body)
  ability.active = input.shieldActive
  ability.cooldown = input.abilityCooldown
  ability.ready =
    ability.ready &&
    !input.paused &&
    !input.ended &&
    !input.shieldActive &&
    input.abilityCooldown <= 0
  return ability
}

/**
 * The beat counter.
 *
 * `finisherReady` is deliberately about the *next press* rather than about the state the
 * sequence is in: what the player needs to know before pressing is whether the button is
 * about to spend stamina, and the answer is no while the sequence is closed even though
 * the bar is full.
 */
export function buildMeleeView(input: {
  melee: PlayerMeleeState
  stamina: number
  paused: boolean
  ended: boolean
}): MeleeView {
  const finisher = playerBeatSpec(PLAYER_MELEE_BEATS.length)
  const view = createMeleeView(PLAYER_MELEE_BEATS.length, finisher.staminaCost)
  view.beat = input.melee.beat
  view.committed = isPlayerMeleeCommitted(input.melee)
  view.finisherReady =
    !input.paused &&
    !input.ended &&
    nextPlayerMeleeBeat(input.melee) === PLAYER_MELEE_BEATS.length &&
    input.stamina >= finisher.staminaCost
  return view
}

/** The live view, emitted every frame. */
export function buildGameView(input: LiveViewInput): GameView {
  return {
    faction: input.faction,
    health: Math.max(0, input.health),
    maxHealth: input.maxHealth,
    damageFlash: input.damageFlash,
    stamina: input.stamina,
    maxStamina: input.maxStamina,
    gold: input.gold,
    kills: input.kills,
    damage: input.damage,
    zone: input.zone,
    body: { ...input.body },
    objectives: input.objectives.map((objective) => ({ ...objective })),
    prompt: input.prompt,
    markers: buildMapMarkers(input),
    worldMap: buildWorldMapView({
      blueprint: input.blueprint,
      bounds: input.bounds,
      chronicleRegions: input.chronicleRegions,
      discoveredRegionIds: input.discoveredRegionIds,
      currentRegionId: input.currentRegionId,
      contestedRegionIds: input.contestedRegionIds,
    }),
    chronicle: [...input.chronicle],
    rumours: input.rumours.map((rumour) => ({ ...rumour })),
    contracts: input.contracts.map((entry) => ({ ...entry })),
    shopPriceMultiplier: input.shopPriceMultiplier,
    squad: input.squad,
    elapsed: input.elapsed,
    pointerLocked: input.pointerLocked,
    paused: input.paused,
    caravanCooldown: input.caravanCooldown,
    ability: buildAbilityView(input),
    melee: buildMeleeView(input),
    campaignCompleted: input.campaignCompleted,
    threatTier: input.threatTier,
    upgrades: { ...input.upgrades },
    lootToast: input.lootToast ? { ...input.lootToast } : null,
    activeEvent: input.activeEvent,
  }
}

// ---------------------------------------------------------------------------
// The launch view
// ---------------------------------------------------------------------------

export interface InitialViewInput {
  blueprint: WorldBlueprint
  config: RunConfig
  restored: ActiveRunSaveV3 | undefined
}

function serializableNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Starting damage per faction, before the boon. */
export function startingDamage(faction: Faction): number {
  return faction === 'villain' ? 31 : faction === 'guard' ? 28 : 26
}

/** Starting gold, before the boon. */
export const STARTING_GOLD = 55

/**
 * The view the HUD draws between pressing *start* and the engine's first frame.
 *
 * Everything it can share with the live builder, it shares. What it cannot share is the
 * part that has no engine yet: there are no actors, no events and no chronicle history, so
 * those are empty rather than absent, and the only marker is the player.
 */
export function buildInitialGameView(input: InitialViewInput): GameView {
  const { blueprint, config, restored } = input
  const startSite = blueprint.sites.find(
    (site) => site.id === blueprint.starts[config.faction],
  )
  if (!startSite) throw new Error('Generated start site is missing')
  const startPosition = getSiteWorldPosition2D(blueprint, startSite)
  if (!startPosition) throw new Error('Generated start position is missing')

  const position = restored?.currentLocation.worldPosition ?? [
    startPosition.x,
    0,
    startPosition.z,
  ]
  const currentRegionId = restored?.currentLocation.regionId ?? startSite.regionId
  const currentRegion =
    blueprint.regions.find((region) => region.id === currentRegionId) ??
    blueprint.regions.find((region) => region.id === startSite.regionId)
  if (!currentRegion) throw new Error('Generated start region is missing')

  const boon = getStartingBoonEffects(config.selectedBoonId)
  const upgrades = normalizeUpgradeLevels(restored?.player.upgrades)
  const baseHealth = getMaxHealth(upgrades)
  const baseStamina = getMaxStamina(upgrades)
  const maxHealth = restored?.player.maxHealth ?? baseHealth + boon.startingHealthBonus
  const maxStamina =
    restored?.player.maxStamina ?? baseStamina + boon.startingStaminaBonus
  const health = Math.min(maxHealth, restored?.player.health ?? maxHealth)
  const stamina = Math.min(maxStamina, restored?.player.stamina ?? maxStamina)
  const body = restored ? { ...restored.player.body } : createHealthyBody()
  const objectives =
    restored?.player.objectives.map((objective) => ({ ...objective })) ??
    createGeneratedObjectives(blueprint, config.faction)
  const elapsed = serializableNumber(restored?.directorState.elapsed)
  const discovered = new Set(restored?.discoveredRegionIds ?? [])
  discovered.add(currentRegion.id)
  const chronicleRegions = new Map<string, RegionChronicleState>()
  for (const [regionId, delta] of Object.entries(restored?.regionDeltas ?? {})) {
    chronicleRegions.set(regionId, delta.chronicle)
  }
  const contestedRegionIds = getContestedRegionIds(blueprint, chronicleRegions)
  const contracts = buildCampaignContractViews({
    blueprint,
    faction: config.faction,
    objectives,
    contracts: normalizeCampaignContractState(restored?.directorState.campaignContracts),
    sitePosition: (siteId) => {
      const position = getSiteWorldPosition2D(blueprint, siteId)
      return position ? { x: position.x, z: position.z } : null
    },
  })

  if (!restored && boon.revealAdjacentRegions) {
    for (const region of blueprint.regions) {
      if (
        Math.abs(region.coordinate.x - currentRegion.coordinate.x) <= 1 &&
        Math.abs(region.coordinate.y - currentRegion.coordinate.y) <= 1
      ) {
        discovered.add(region.id)
      }
    }
  }

  return {
    faction: config.faction,
    health,
    maxHealth,
    damageFlash: 0,
    stamina,
    maxStamina,
    gold: restored?.player.gold ?? STARTING_GOLD + boon.startingGoldBonus,
    kills: restored?.player.kills ?? 0,
    damage:
      restored?.player.damage ?? startingDamage(config.faction) + boon.startingDamageBonus,
    zone: currentRegion.biome,
    body,
    objectives,
    prompt: '',
    markers: [
      {
        id: 'player',
        x: position[0],
        z: position[2],
        kind: 'player',
        heading: restored?.currentLocation.heading ?? 0,
      },
    ],
    worldMap: buildWorldMapView({
      blueprint,
      bounds: blueprint.bounds,
      chronicleRegions,
      discoveredRegionIds: discovered,
      currentRegionId: currentRegion.id,
      contestedRegionIds,
    }),
    chronicle: [],
    // The launch view predates the first chronicle tick, so there is nothing to be offered
    // yet even on a restored run: `settleDueRumours` runs in the engine, and showing a
    // rumour whose clock the engine has not yet checked would be showing a stale deadline.
    rumours: [],
    // The campaign board is the other way round, and deliberately so: it is derived from
    // the blueprint, the objective list and the persisted pin, none of which needs a frame
    // of engine to be true. Drawing it at launch is what makes "the pin survived the
    // reload" visible before the first frame rather than after it.
    contracts,
    shopPriceMultiplier: 1,
    squad: 0,
    elapsed,
    pointerLocked: false,
    paused: false,
    caravanCooldown: serializableNumber(restored?.directorState.caravanCooldown),
    ability: createAbilityView(config.faction, stamina, body),
    melee: buildMeleeView({
      melee: createPlayerMeleeState(),
      stamina,
      paused: false,
      ended: false,
    }),
    activeEvent: null,
    lootToast: null,
    campaignCompleted: objectives.every((objective) => objective.done),
    threatTier: getThreatTier(elapsed),
    upgrades,
  }
}
