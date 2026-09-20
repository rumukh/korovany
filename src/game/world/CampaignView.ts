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
  DOCTRINE_DRAFT_TIERS,
  MAX_EQUIPPED_DOCTRINES,
  getDoctrineDefinition,
  getDoctrineOffer,
  normalizeDoctrineRunState,
  pendingDoctrineDraftIndex,
  type DoctrineRunState,
} from '../run/doctrine.ts'
import {
  CONTRACT_ERRAND_STAKE,
  CONTRACT_FAILED_TASK,
  BRIDGE_AMBUSH_EXPEDITION_STAKE,
  BRIDGE_AMBUSH_EXPEDITION_TASK,
  BRIDGE_AMBUSH_TITLE,
  describeContractStake,
  describeContractTask,
  describeContractTitle,
  describeRumourTitle,
  describeRumourTask,
  describeRumourStake,
  describeRumourVerdict,
  formatRegionGridLabel,
  generatedSiteLabel,
  FINALE_COPY,
  FINALE_ATTACK_CUES,
  FINALE_RECOVERY_CUE,
  FINALE_RESUME_CUE,
  FINALE_POSITIONING_CUE,
  FINALE_SUSPENDED_CUE,
  FINALE_DEFEATED_CUE,
} from '../content/gameCopy.ts'
import { getBlueprintRegionBounds, getFactionStartHeading, getFactionStartPosition2D, getSiteWorldPosition2D } from '../content/registry.ts'
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
  type DoctrineCardView,
  type DoctrineView,
  type Faction,
  type FinaleView,
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
  isVerdictFresh,
  normalizeCampaignContractState,
  normalizeChronicleCommitmentState,
  resolveActiveObjectiveNode,
  rumourProgressShare,
  rumourSecondsRemaining,
  type CampaignContractState,
  type ChronicleCommitmentState,
  type ChronicleRumour,
} from './CampaignDirector.ts'
import {
  PLAYER_MELEE_BEATS,
  isPlayerMeleeCommitted,
  nextPlayerMeleeBeat,
  playerBeatSpec,
  type PlayerMeleeState,
} from './CombatResolver.ts'
import type { WorldBlueprint } from './worldTypes.ts'
import { ExpeditionPlanner, type ExpeditionView } from './ExpeditionPlanner.ts'
import {
  buildBridgeAmbushView,
  createBridgeAmbushPlan,
  createBridgeAmbushState,
  normalizeBridgeAmbushState,
  type BridgeAmbushView,
} from './BridgeAmbush.ts'
import {
  buildCombatMasteryView,
  normalizeCombatMastery,
  type CameraControlMode,
  type CombatMasteryState,
} from './CombatMastery.ts'
import {
  buildSavedSquadRoster,
  buildSquadCommandView,
  createSquadCommandState,
  restoreSquadCommandState,
  type SquadCommandView,
} from './SquadCommand.ts'
import {
  FINALE_ENGAGE_RADIUS,
  createFinaleIdentity,
  finaleProgress,
  finaleStage,
  normalizeFinaleState,
  prepareFinaleResume,
  type FinaleState,
} from './FinaleDirector.ts'
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
  /** Roadmap 1.6 — the open draft and the rules the run already took. */
  doctrines: DoctrineView
  expedition: ExpeditionView
  bridgeAmbush: BridgeAmbushView | null
  bridgeAmbushX: number | null
  bridgeAmbushZ: number | null
  finale: FinaleView | null
  shopPriceMultiplier: number
  squad: number
  squadCommand: SquadCommandView
  elapsed: number
  pointerLocked: boolean
  paused: boolean
  ended: boolean
  caravanCooldown: number
  shieldActive: boolean
  abilityCooldown: number
  bowAiming?: boolean
  melee: PlayerMeleeState
  combatMastery: CombatMasteryState
  cameraMode: CameraControlMode
  inputBlocked?: boolean
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
  if (
    input.bridgeAmbush &&
    input.bridgeAmbushX !== null &&
    input.bridgeAmbushZ !== null &&
    input.bridgeAmbush.active === true &&
    input.bridgeAmbush.phase !== 'resolved' &&
    input.bridgeAmbush.phase !== 'lost' &&
    input.bridgeAmbush.phase !== 'unavailable'
  ) {
    markers.push({
      id: 'bridge-ambush',
      x: input.bridgeAmbushX,
      z: input.bridgeAmbushZ,
      kind: 'event',
      label: input.bridgeAmbush.title,
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
    // Roadmap 2.1 — the arms of a fork are only exclusive while there is still another arm
    // to lose. Read off the ready list rather than off the node, so the badge disappears
    // on the frame the choice stops being one instead of lying about a decision already
    // made.
    const exclusive =
      node.exclusiveGroup !== undefined &&
      ready.some(
        (candidate) =>
          candidate.id !== node.id && candidate.exclusiveGroup === node.exclusiveGroup,
      )
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
      exclusive,
      status,
      timeRemaining:
        status === 'active' && progress && template ? progress.remaining : null,
      x: position?.x ?? null,
      z: position?.z ?? null,
    }
  })
}

/** Shared by the live board and restored atlas; expired offers are never destinations. */
export function buildChronicleRumourViews(
  blueprint: WorldBlueprint,
  commitments: ChronicleCommitmentState,
  tick: number,
): ChronicleRumourView[] {
  const gridLabel = (id: string) => {
    const region = blueprint.regions.find((entry) => entry.id === id)
    return region ? formatRegionGridLabel(region.coordinate.x, region.coordinate.y) : '??'
  }
  const copyFor = (source: Pick<ChronicleRumour, 'regionId' | 'targetRegionId' | 'siteId' | 'faction'>) => {
    const site = blueprint.sites.find((entry) => entry.id === source.siteId)
    return {
      regionLabel: gridLabel(source.regionId), targetLabel: gridLabel(source.targetRegionId),
      siteLabel: site ? generatedSiteLabel(site.kind) : null, faction: source.faction,
    }
  }
  const views: ChronicleRumourView[] = commitments.rumours
    .filter((rumour) => rumourSecondsRemaining(rumour, tick) > 0)
    .map((rumour) => {
      const copy = copyFor(rumour)
      const bounds = getBlueprintRegionBounds(blueprint, rumour.regionId)
      const position = rumour.kind === 'sabotage' && rumour.siteId
        ? getSiteWorldPosition2D(blueprint, rumour.siteId)
        : bounds ? { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 } : undefined
      return {
        id: rumour.id, kind: rumour.kind, title: describeRumourTitle(rumour.kind),
        task: describeRumourTask(rumour.kind, copy), stake: describeRumourStake(rumour.kind, copy),
        regionLabel: copy.regionLabel, timeRemaining: rumourSecondsRemaining(rumour, tick),
        pinned: commitments.pinnedRumourId === rumour.id, progress: rumourProgressShare(rumour),
        x: position?.x ?? null, z: position?.z ?? null, outcome: null, outcomeText: null,
      }
    })
  const verdict = commitments.verdict
  if (verdict && isVerdictFresh(verdict, tick)) {
    const copy = copyFor(verdict)
    views.push({
      id: `${verdict.rumourId}:verdict`, kind: verdict.kind, title: describeRumourTitle(verdict.kind),
      task: '', stake: '', regionLabel: copy.regionLabel, timeRemaining: 0, pinned: false, progress: 1,
      x: null, z: null, outcome: verdict.outcome,
      outcomeText: describeRumourVerdict(verdict.kind, verdict.outcome, verdict.committed, copy),
    })
  }
  return views
}

/**
 * Roadmap 1.6 — the draft panel and the equipped strip.
 *
 * Shared by both view paths for the same reason everything else here is: the launch view
 * has to be able to draw an equipped strip before the engine's first frame, or a player who
 * checkpoints mid-run and continues would watch their doctrines blink into existence. The
 * offer is *recomputed* from the seed and the ledger rather than read out of a stored list,
 * which is what makes "the same seed and tier show the same three cards" structural instead
 * of a promise.
 */
export function buildDoctrineView(
  state: DoctrineRunState,
  seed: number,
): DoctrineView {
  const draftIndex = pendingDoctrineDraftIndex(state)
  return {
    equipped: state.equipped.map(toDoctrineCardView).filter(isDoctrineCard),
    offer: getDoctrineOffer(state, seed).map(toDoctrineCardView).filter(isDoctrineCard),
    draft: draftIndex === null ? null : draftIndex + 1,
    draftsTotal: DOCTRINE_DRAFT_TIERS.length,
    slots: MAX_EQUIPPED_DOCTRINES,
  }
}

function toDoctrineCardView(doctrineId: string): DoctrineCardView | null {
  const definition = getDoctrineDefinition(doctrineId)
  if (!definition) return null
  return {
    id: definition.id,
    name: definition.name,
    rule: definition.rule,
    gives: definition.gives,
    takes: definition.takes,
  }
}

function isDoctrineCard(card: DoctrineCardView | null): card is DoctrineCardView {
  return card !== null
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
  bowAiming?: boolean
  abilityCooldown: number
  paused: boolean
  ended: boolean
  melee?: PlayerMeleeState
  combatMastery?: CombatMasteryState
  inputBlocked?: boolean
}): AbilityView {
  const ability = createAbilityView(input.faction, input.stamina, input.body)
  ability.active = ability.id === 'bow' ? input.bowAiming === true : input.shieldActive
  ability.cooldown = input.abilityCooldown
  ability.ready =
    ability.ready &&
    !input.paused &&
    !input.ended &&
    !input.shieldActive &&
    input.abilityCooldown <= 0 &&
    !input.inputBlocked &&
    !(input.melee && isPlayerMeleeCommitted(input.melee)) &&
    !(input.combatMastery && input.combatMastery.evadeRemaining > 0)
  ability.aimAvailable = ability.aimAvailable && !input.paused && !input.ended && !input.inputBlocked &&
    !(input.melee && isPlayerMeleeCommitted(input.melee)) &&
    !(input.combatMastery && input.combatMastery.evadeRemaining > 0)
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

export function buildFinaleView(state: FinaleState, relevant: boolean): FinaleView | null {
  if (!relevant || !state.introduced || !state.boss) return null
  const stage = finaleStage(state)
  const copy = FINALE_COPY[state.identity.profile]
  const cue = stage === 'defeated' ? FINALE_DEFEATED_CUE
    : stage === 'introduction' ? copy.introduction
      : stage === 'transition' ? copy.transition
        : stage === 'resuming' ? FINALE_RESUME_CUE
          : stage === 'suspended' ? FINALE_SUSPENDED_CUE
            : stage === 'recovery' ? FINALE_RECOVERY_CUE
              : state.action ? FINALE_ATTACK_CUES[state.action.id]
                : FINALE_POSITIONING_CUE
  return {
    profile: state.identity.profile,
    encounterId: state.identity.encounterId,
    bossId: `generated:${state.identity.bossId}`,
    name: copy.name,
    enemyFaction: state.identity.enemyFaction,
    health: Math.max(0, state.boss.health),
    maxHealth: state.boss.maxHealth,
    phase: state.phase,
    stage, cue, progress: finaleProgress(state),
    escortsAlive: state.defeated ? 0 : state.escorts.filter((escort) =>
      !escort.defeated && escort.body !== null && escort.body.health > 0).length,
  }
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
    doctrines: {
      equipped: input.doctrines.equipped.map((card) => ({ ...card })),
      offer: input.doctrines.offer.map((card) => ({ ...card })),
      draft: input.doctrines.draft,
      draftsTotal: input.doctrines.draftsTotal,
      slots: input.doctrines.slots,
    },
    expedition: input.expedition,
    bridgeAmbush: input.bridgeAmbush ? { ...input.bridgeAmbush } : null,
    finale: input.finale ? { ...input.finale } : null,
    shopPriceMultiplier: input.shopPriceMultiplier,
    squad: input.squad,
    squadCommand: buildSquadCommandView({
      version: 1,
      mode: input.squadCommand.mode,
      baseStance: input.squadCommand.baseStance,
      anchor: input.squadCommand.anchor ?? { x: input.playerX, z: input.playerZ, heading: input.playerHeading },
      focusTargetId: input.squadCommand.focusTargetId,
    }, input.squadCommand.roster, input.squadCommand.targets, input.squadCommand.focus),
    elapsed: input.elapsed,
    pointerLocked: input.pointerLocked,
    paused: input.paused,
    caravanCooldown: input.caravanCooldown,
    ability: buildAbilityView({ ...input, ended: input.ended || input.health <= 0 }),
    melee: buildMeleeView(input),
    combatMastery: buildCombatMasteryView({
      ...input, state: input.combatMastery, ended: input.ended || input.health <= 0,
    }),
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
  restored?: ActiveRunSaveV3
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
  const startPosition = getFactionStartPosition2D(blueprint, config.faction)
  if (!startPosition) throw new Error('Generated start position is missing')

  const position = restored?.currentLocation.worldPosition ?? [
    startPosition.x,
    0,
    startPosition.z,
  ]
  const currentRegionId = restored?.currentLocation.regionId ?? startSite.regionId
  const heading = restored?.currentLocation.heading ??
    getFactionStartHeading(blueprint, config.faction, { x: position[0], z: position[2] })
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
  // Roadmap 1.6 — the same reasoning as the campaign board below: the strip is derived from
  // the seed and the persisted ledger, neither of which needs a frame of engine, so a
  // continued run shows what it is already committed to before the first frame rather than
  // after it. A run that has not launched yet has an empty ledger and draws nothing.
  const doctrines = buildDoctrineView(
    normalizeDoctrineRunState(restored?.directorState.doctrines),
    blueprint.seed,
  )
  const mastery = normalizeCombatMastery(restored?.directorState.combatMastery, config.faction)
  const squadState = restoreSquadCommandState(
    restored?.directorState.squadCommand,
    createSquadCommandState({
      x: position[0], z: position[2],
      heading: Math.atan2(Math.sin(heading), Math.cos(heading)),
    }, restored ? restored.directorState.squadFollowing === true : true),
    blueprint.bounds,
  ).state
  const squadCommand = buildSquadCommandView(squadState,
    buildSavedSquadRoster(restored?.companions ?? [], squadState, config.faction,
      { x: position[0], z: position[2] }))
  const finaleIdentity = createFinaleIdentity(blueprint, config.faction)
  const finaleDelta = restored?.regionDeltas[finaleIdentity.regionId]
  const finaleState = normalizeFinaleState(restored?.directorState.finale, finaleIdentity, {
    defeatedActorIds: finaleDelta?.defeatedActorIds ?? [],
    clearedEncounterIds: finaleDelta?.clearedEncounterIds ?? [],
    objectiveDone: objectives.some((objective) => objective.id === finaleIdentity.objectiveId && objective.done),
  }).state
  if (restored) prepareFinaleResume(finaleState)
  const finale = buildFinaleView(finaleState, finaleState.boss !== null &&
    Math.hypot(position[0] - finaleState.boss.x, position[2] - finaleState.boss.z) <= FINALE_ENGAGE_RADIUS)

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

  const bridgePlan = createBridgeAmbushPlan(blueprint, config.faction)
  const bridgeState = restored
    ? restored.directorState.bridgeAmbush === undefined ||
      restored.directorState.bridgeAmbush === null
      ? null
      : normalizeBridgeAmbushState(
          restored.directorState.bridgeAmbush,
          blueprint,
          config.faction,
          bridgePlan,
        ).state
    : createBridgeAmbushState(blueprint, config.faction, bridgePlan)
  const bridgeTarget = bridgeState &&
    bridgePlan &&
    bridgeState.phase !== 'delivering' &&
    bridgeState.phase !== 'resolved' &&
    bridgeState.phase !== 'lost' &&
    bridgeState.phase !== 'unavailable'
    ? {
        id: bridgePlan.id,
        title: BRIDGE_AMBUSH_TITLE,
        regionId: bridgePlan.regionId,
        position: { x: bridgeState.cargoX, z: bridgeState.cargoZ },
        task: BRIDGE_AMBUSH_EXPEDITION_TASK,
        stake: BRIDGE_AMBUSH_EXPEDITION_STAKE,
      }
    : null
  const expedition = new ExpeditionPlanner(blueprint, restored?.directorState.expedition).buildView({
    faction: config.faction, player: { x: position[0], z: position[2] },
    heading, objectives, contracts,
    rumours: buildChronicleRumourViews(blueprint,
      normalizeChronicleCommitmentState(restored?.directorState.chronicleCommitments),
      restored?.chronicleState.tick ?? 0),
    activeObjectiveId: resolveActiveObjectiveNode(blueprint, config.faction, objectives,
      normalizeCampaignContractState(restored?.directorState.campaignContracts).pinnedNodeId)?.id ?? null,
    discoveredRegionIds: discovered, chronicleRegions, contestedRegionIds,
    bridgeAmbush: bridgeTarget,
  })
  const bridgeAmbush = bridgeState
    ? buildBridgeAmbushView(
        blueprint,
        config.faction,
        objectives,
        bridgePlan,
        bridgeState,
        { x: position[0], z: position[2] },
        heading,
        (expedition.mode === 'selected' &&
          expedition.target?.kind !== 'bridgeAmbush') ||
          (expedition.mode === 'campaign' &&
            expedition.target?.committed === true),
        expedition.mode === 'selected' &&
          expedition.target?.kind === 'bridgeAmbush',
        expedition,
      )
    : null

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
        heading,
      },
      ...(bridgeAmbush &&
      bridgePlan &&
      bridgeAmbush.active === true &&
      bridgeAmbush.phase !== 'resolved' &&
      bridgeAmbush.phase !== 'lost' &&
      bridgeAmbush.phase !== 'unavailable'
        ? [{
            id: 'bridge-ambush',
            x: bridgeState?.cargoX ?? bridgePlan.cargoStart.x,
            z: bridgeState?.cargoZ ?? bridgePlan.cargoStart.z,
            kind: 'event' as const,
            label: bridgeAmbush.title,
          }]
        : []),
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
    doctrines,
    expedition,
    bridgeAmbush,
    finale,
    shopPriceMultiplier: 1,
    squad: squadCommand.roster.length,
    squadCommand,
    elapsed,
    pointerLocked: false,
    paused: false,
    caravanCooldown: serializableNumber(restored?.directorState.caravanCooldown),
    ability: buildAbilityView({
      faction: config.faction, stamina, body, shieldActive: false,
      abilityCooldown: mastery.abilityCooldown, paused: false, ended: false,
      melee: mastery.melee, combatMastery: mastery.state,
    }),
    melee: buildMeleeView({
      melee: mastery.melee,
      stamina,
      paused: false,
      ended: false,
    }),
    combatMastery: buildCombatMasteryView({
      state: mastery.state, melee: mastery.melee, faction: config.faction, stamina, body,
      paused: false, ended: false, shieldActive: false,
      abilityCooldown: mastery.abilityCooldown, cameraMode: 'capture',
    }),
    activeEvent: null,
    lootToast: null,
    campaignCompleted: objectives.every((objective) => objective.done),
    threatTier: getThreatTier(elapsed),
    upgrades,
  }
}
