/**
 * Equivalence control for the `world/CampaignView.ts` extraction.
 *
 * There used to be two `GameView` builders: `GameEngine.emitView` for the live frame, and
 * `App.tsx`'s hand-rolled `createGeneratedInitialView` for the moment between pressing
 * *start* and the engine's first frame. The second is deleted. This file keeps it verbatim
 * as the "before" side and asserts the surviving builder reproduces it field for field,
 * across seeds, factions, boons and a restored save — because a HUD that shows one
 * campaign for a frame and a different one afterwards is a bug nobody would look for.
 *
 * It also pins the one thing the two builders read from different sources: the playable
 * bounds. `GameEngine` reported `TerrainSystem`'s normalised rectangle and `App` reported
 * the blueprint's. That they agree was an assumption; here it is a measurement.
 *
 * The marker builder is pinned against the engine's deleted inline loop, including the
 * ordering that makes a crowd unable to bury the objective pin.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import {
  createAbilityView,
  createHealthyBody,
  getMaxHealth,
  getMaxStamina,
  getThreatTier,
  normalizeUpgradeLevels,
  type Faction,
  type GameView,
  type MapMarker,
  type Objective,
} from '../src/game/types.ts'
import { getSiteWorldPosition2D } from '../src/game/content/registry.ts'
import { generatedSiteLabel } from '../src/game/content/gameCopy.ts'
import { getStartingBoonEffects } from '../src/game/run/profile.ts'
import type { ActiveRunSaveV3, RunConfig } from '../src/game/run/runTypes.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { TerrainSystem } from '../src/game/world/TerrainSystem.ts'
import {
  createChronicleState,
  getContestedRegionIds,
  isRegionRazed,
  type RegionChronicleState,
} from '../src/game/world/Chronicle.ts'
import { createGeneratedObjectives } from '../src/game/world/CampaignDirector.ts'
import {
  buildAbilityView,
  buildGameView,
  buildInitialGameView,
  buildMapMarkers,
  buildWorldMapView,
  type LiveViewInput,
  type ViewActor,
  type ViewEvent,
  type ViewMarkerSource,
} from '../src/game/world/CampaignView.ts'
import type { WorldBlueprint } from '../src/game/world/worldTypes.ts'

const FACTIONS: readonly Faction[] = ['elf', 'guard', 'villain']

// ---------------------------------------------------------------------------
// The deleted App.tsx builder, copied verbatim
// ---------------------------------------------------------------------------

function legacySerializableNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** `App.tsx`'s deleted `createGeneratedObjectives`. */
function legacyObjectives(blueprint: WorldBlueprint, faction: Faction) {
  return blueprint.objectives[faction].nodes.map((node) => {
    const site = blueprint.sites.find((candidate) => candidate.id === node.siteId)
    return { id: node.id, text: node.kind, done: false, site: site?.kind }
  })
}

/**
 * `App.tsx`'s deleted `createGeneratedInitialView`, with only one change: it took a
 * `GeneratedRunLaunch` and read `launch.config` / `launch.restored` off it, so those two
 * are parameters here instead. Every expression inside is unchanged.
 */
function legacyInitialView(
  blueprint: WorldBlueprint,
  config: RunConfig,
  restored: ActiveRunSaveV3 | undefined,
): GameView {
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
  const elapsed = legacySerializableNumber(restored?.directorState.elapsed)
  const discovered = new Set(restored?.discoveredRegionIds ?? [])
  discovered.add(currentRegion.id)
  const chronicleRegions = new Map<string, RegionChronicleState>()
  for (const [regionId, delta] of Object.entries(restored?.regionDeltas ?? {})) {
    chronicleRegions.set(regionId, delta.chronicle)
  }
  const contestedRegionIds = getContestedRegionIds(blueprint, chronicleRegions)

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
    gold: restored?.player.gold ?? 55 + boon.startingGoldBonus,
    kills: restored?.player.kills ?? 0,
    damage:
      restored?.player.damage ??
      (config.faction === 'villain' ? 31 : config.faction === 'guard' ? 28 : 26) +
        boon.startingDamageBonus,
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
    worldMap: {
      bounds: { ...blueprint.bounds },
      currentRegionId: currentRegion.id,
      seed: blueprint.seed,
      generatorVersion: blueprint.generatorVersion,
      regions: blueprint.regions.map((region) => {
        const chronicle = restored?.regionDeltas[region.id]?.chronicle
        return {
          id: region.id,
          gridX: region.coordinate.x,
          gridZ: region.coordinate.y,
          biome: region.biome,
          territory: chronicle?.control ?? region.territory,
          discovered: discovered.has(region.id),
          current: region.id === currentRegion.id,
          contested: contestedRegionIds.has(region.id),
          razed: isRegionRazed(chronicle),
        }
      }),
    },
    chronicle: [],
    shopPriceMultiplier: 1,
    squad: 0,
    elapsed,
    pointerLocked: false,
    paused: false,
    caravanCooldown: legacySerializableNumber(restored?.directorState.caravanCooldown),
    ability: createAbilityView(config.faction, stamina, body),
    activeEvent: null,
    lootToast: null,
    campaignCompleted: objectives.every((objective) => objective.done),
    threatTier: getThreatTier(elapsed),
    upgrades,
  }
}

/** The marker loop deleted from `GameEngine.emitView`. */
function legacyMarkers(input: {
  blueprint: WorldBlueprint
  playerX: number
  playerZ: number
  playerHeading: number
  caravanX: number
  caravanZ: number
  worldMarkers: readonly ViewMarkerSource[]
  activeSiteId: string | null
  activeSiteX: number | null
  activeSiteZ: number | null
  activeObjectiveId: string | null
  objectives: readonly Objective[]
  events: readonly ViewEvent[]
  actors: readonly ViewActor[]
}): MapMarker[] {
  const markers: MapMarker[] = [
    {
      id: 'player',
      x: input.playerX,
      z: input.playerZ,
      kind: 'player',
      heading: input.playerHeading,
    },
    { id: 'caravan', x: input.caravanX, z: input.caravanZ, kind: 'caravan' },
  ]
  for (const marker of input.worldMarkers) {
    const active = marker.id === `site:${input.activeSiteId ?? undefined}`
    const site = marker.id.startsWith('site:')
      ? input.blueprint.sites.find((candidate) => `site:${candidate.id}` === marker.id)
      : undefined
    const label = site ? generatedSiteLabel(site.kind) : marker.label
    markers.push({
      id: marker.id,
      x: marker.x,
      z: marker.z,
      kind: active ? 'objective' : 'landmark',
      ...(label ? { label } : {}),
    })
  }
  if (
    input.activeSiteId !== null &&
    input.activeSiteX !== null &&
    input.activeSiteZ !== null &&
    !markers.some((marker) => marker.id === `site:${input.activeSiteId ?? undefined}`)
  ) {
    const objective = input.objectives.find(
      (entry) => entry.id === input.activeObjectiveId,
    )
    markers.push({
      id: `site:${input.activeSiteId}`,
      x: input.activeSiteX,
      z: input.activeSiteZ,
      kind: 'objective',
      label: objective?.text,
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
  for (const actor of input.actors) {
    markers.push({ id: actor.id, x: actor.x, z: actor.z, kind: actor.kind })
  }
  return markers
}

function makeRestored(
  blueprint: WorldBlueprint,
  config: RunConfig,
  rng: RandomStream,
): ActiveRunSaveV3 {
  const region = blueprint.regions[rng.integer(0, blueprint.regions.length)]
  const objectives: Objective[] = createGeneratedObjectives(blueprint, config.faction).map(
    (objective) => ({ ...objective, done: rng.chance(0.4) }),
  )
  const regionDeltas: ActiveRunSaveV3['regionDeltas'] = {}
  for (const candidate of blueprint.regions) {
    if (!rng.chance(0.3)) continue
    regionDeltas[candidate.id] = {
      version: 1,
      chronicle: {
        control: rng.pick([...FACTIONS, 'neutral'] as const),
        pressure: { elf: rng.next(), guard: rng.next(), villain: rng.next() },
        beastPressure: rng.next(),
        // A razed region is one whose settlements are gone, and the launch view has to
        // draw it as such — so the sample has to contain some.
        settlementIntegrity: rng.chance(0.35) ? 0 : rng.range(1, 100),
        supply: rng.next(),
        lastEventTick: rng.integer(0, 40),
      },
    } as unknown as ActiveRunSaveV3['regionDeltas'][string]
  }
  return {
    version: 3,
    runId: 'run-1',
    config,
    status: 'active',
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:10:00.000Z',
    blueprintFingerprint: blueprint.fingerprint,
    currentLocation: {
      regionId: region.id,
      localPosition: [0, 0, 0],
      worldPosition: [rng.range(-50, 50), 0, rng.range(-50, 50)],
      heading: rng.range(-Math.PI, Math.PI),
    },
    player: {
      health: rng.range(10, 90),
      maxHealth: rng.range(90, 140),
      stamina: rng.range(5, 60),
      maxStamina: rng.range(60, 100),
      gold: rng.integer(0, 500),
      kills: rng.integer(0, 40),
      damage: rng.integer(20, 60),
      body: createHealthyBody(),
      objectives,
      upgrades: { blade: rng.integer(0, 3), vitality: rng.integer(0, 3), endurance: rng.integer(0, 3) },
    },
    discoveredRegionIds: blueprint.regions
      .filter(() => rng.chance(0.5))
      .map((candidate) => candidate.id),
    regionDeltas,
    directorState: {
      elapsed: rng.range(0, 900),
      caravanCooldown: rng.range(0, 60),
    },
    eventState: {},
    chronicleState: createChronicleState(),
    rngStates: {},
    achievementRunState: { version: 1, runId: 'run-1', counters: {}, unlocked: [] } as unknown as ActiveRunSaveV3['achievementRunState'],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('the launch view reproduces the deleted App.tsx builder on a fresh run', () => {
  let comparisons = 0
  const boons = ['', 'boon-scout-maps', 'boon-fat-purse', 'nonexistent-boon']

  for (let index = 0; index < 60; index += 1) {
    const blueprint = generateWorld(4_000 + index * 811)
    for (const faction of FACTIONS) {
      for (const selectedBoonId of boons) {
        const config: RunConfig = {
          seed: blueprint.seed,
          generatorVersion: blueprint.generatorVersion,
          faction,
          selectedBoonId,
        }
        const expected = legacyInitialView(blueprint, config, undefined)
        const actual = buildInitialGameView({ blueprint, config, restored: undefined })
        assert.deepEqual(actual, expected, `seed ${index}, ${faction}, boon ${selectedBoonId}`)
        comparisons += 1
      }
    }
  }
  assert.ok(comparisons >= 720, `expected a wide sample, got ${comparisons}`)
})

test('the launch view reproduces the deleted builder on a restored run', () => {
  let comparisons = 0
  let withRazedRegions = 0
  let withContested = 0

  for (let index = 0; index < 80; index += 1) {
    const blueprint = generateWorld(21_000 + index * 577)
    for (const faction of FACTIONS) {
      const rng = new RandomStream(deriveSeed('campaign-view', `restored-${index}-${faction}`))
      const config: RunConfig = {
        seed: blueprint.seed,
        generatorVersion: blueprint.generatorVersion,
        faction,
        selectedBoonId: 'boon-scout-maps',
      }
      const restored = makeRestored(blueprint, config, rng)
      const expected = legacyInitialView(blueprint, config, restored)
      const actual = buildInitialGameView({ blueprint, config, restored })
      assert.deepEqual(actual, expected, `seed ${index}, ${faction}`)
      comparisons += 1
      if (actual.worldMap.regions.some((region) => region.razed)) withRazedRegions += 1
      if (actual.worldMap.regions.some((region) => region.contested)) withContested += 1
    }
  }

  assert.ok(comparisons >= 240, `expected a wide sample, got ${comparisons}`)
  // A save with no razed or contested regions would leave two of the flags untested.
  assert.ok(withRazedRegions > 20, `expected razed regions, got ${withRazedRegions}`)
  assert.ok(withContested > 20, `expected contested regions, got ${withContested}`)
})

test('the two bounds sources agree, which the split builders had only assumed', () => {
  // `GameEngine` reported `GeneratedWorldRuntime.bounds`, which is a copy of
  // `TerrainSystem.bounds`; `App` reported `blueprint.bounds`. One authoritative builder
  // takes bounds as a parameter precisely so this stays a measurement rather than a
  // silent merge.
  for (let index = 0; index < 60; index += 1) {
    const blueprint = generateWorld(9_100 + index * 733)
    const terrain = new TerrainSystem(blueprint)
    assert.deepEqual(
      { ...terrain.bounds },
      { ...blueprint.bounds },
      `seed ${index}: the terrain system renormalised the playable rectangle`,
    )
  }
})

test('minimap markers match the engine loop they replaced, in the same order', () => {
  let comparisons = 0
  let syntheticObjectivePins = 0
  let labelledSites = 0

  for (let index = 0; index < 240; index += 1) {
    const blueprint = generateWorld(15_000 + index * 379)
    const rng = new RandomStream(deriveSeed('campaign-view', `markers-${index}`))
    const faction = rng.pick(FACTIONS)
    const objectives = createGeneratedObjectives(blueprint, faction)
    const nodes = blueprint.objectives[faction].nodes
    const activeNode = rng.chance(0.85) ? nodes[rng.integer(0, nodes.length)] : null
    // Sometimes publish the active site as a world marker, sometimes not: the second case
    // is the one that needs the synthetic pin.
    const publishedSites = blueprint.sites.filter(() => rng.chance(0.35))
    const worldMarkers: ViewMarkerSource[] = [
      ...publishedSites.map((site) => ({
        id: `site:${site.id}`,
        x: rng.range(-200, 200),
        z: rng.range(-200, 200),
      })),
      { id: 'bridge:0', x: rng.range(-200, 200), z: rng.range(-200, 200), label: 'мост' },
    ]
    const events: ViewEvent[] = Array.from(
      { length: rng.integer(0, 3) },
      (_, eventIndex) => ({
        markerId: `event-${eventIndex}`,
        markerX: rng.range(-200, 200),
        markerZ: rng.range(-200, 200),
        title: `event ${eventIndex}`,
      }),
    )
    const actors: ViewActor[] = Array.from(
      { length: rng.integer(0, 12) },
      (_, actorIndex) => ({
        id: `actor-${actorIndex}`,
        x: rng.range(-200, 200),
        z: rng.range(-200, 200),
        kind: rng.pick(['ally', 'enemy', 'beast', 'neutral'] as const),
      }),
    )
    const activeSiteKnown = activeNode !== null && rng.chance(0.8)
    const activeSiteX = activeSiteKnown ? rng.range(-200, 200) : null
    const activeSiteZ = activeSiteKnown ? rng.range(-200, 200) : null

    const input = {
      blueprint,
      playerX: rng.range(-200, 200),
      playerZ: rng.range(-200, 200),
      playerHeading: rng.range(-Math.PI, Math.PI),
      caravanX: rng.range(-200, 200),
      caravanZ: rng.range(-200, 200),
      worldMarkers,
      activeSiteId: activeNode?.siteId ?? null,
      activeSiteX,
      activeSiteZ,
      activeObjectiveId: activeNode?.id ?? null,
      objectives,
      events,
      actors,
    }
    const expected = legacyMarkers(input)
    const actual = buildMapMarkers({
      ...input,
      activeObjectiveSiteId: input.activeSiteId,
      activeObjectiveSiteX: input.activeSiteX,
      activeObjectiveSiteZ: input.activeSiteZ,
    } as unknown as LiveViewInput)
    assert.deepEqual(actual, expected, `seed ${index}`)
    comparisons += 1
    if (actual.length > expected.length) throw new Error('unreachable')
    if (
      activeNode &&
      activeSiteKnown &&
      !worldMarkers.some((marker) => marker.id === `site:${activeNode.siteId}`)
    ) {
      syntheticObjectivePins += 1
    }
    labelledSites += actual.filter(
      (marker) => marker.kind === 'landmark' && marker.label !== undefined,
    ).length
  }

  assert.ok(comparisons >= 240, `expected a wide sample, got ${comparisons}`)
  assert.ok(
    syntheticObjectivePins > 20,
    `expected unpublished objective sites, got ${syntheticObjectivePins}`,
  )
  assert.ok(labelledSites > 500, `expected labelled landmarks, got ${labelledSites}`)
})

test('the objective pin is drawn after landmarks so a crowd cannot bury it', () => {
  // The ordering is load-bearing: the HUD draws later markers over earlier ones.
  const blueprint = generateWorld(4_242)
  const faction: Faction = 'elf'
  const objectives = createGeneratedObjectives(blueprint, faction)
  const node = blueprint.objectives[faction].nodes[0]
  const markers = buildMapMarkers({
    blueprint,
    playerX: 0,
    playerZ: 0,
    playerHeading: 0,
    caravanX: 1,
    caravanZ: 1,
    worldMarkers: [{ id: 'bridge:0', x: 2, z: 2, label: 'мост' }],
    activeObjectiveSiteId: node.siteId,
    activeObjectiveSiteX: 3,
    activeObjectiveSiteZ: 3,
    activeObjectiveId: node.id,
    objectives,
    events: [{ markerId: 'event-0', markerX: 4, markerZ: 4, title: 'raid' }],
    actors: [{ id: 'actor-0', x: 5, z: 5, kind: 'enemy' }],
  } as unknown as LiveViewInput)

  const kinds = markers.map((marker) => marker.kind)
  assert.deepEqual(kinds, ['player', 'caravan', 'landmark', 'objective', 'event', 'enemy'])
  assert.equal(markers[3].label, objectives[0].text)
})

test('the ability button matches the engine gating it replaced', () => {
  // The gate that decides whether the HUD's one action button lights up. `emitView` built
  // it inline and mutated three fields on the result; getting the `&&` wrong would light
  // the button during a pause, at the end of a run, or with the shield already up.
  let comparisons = 0
  let ready = 0
  let blockedByRunState = 0

  const rng = new RandomStream(deriveSeed('campaign-view', 'ability'))
  for (let trial = 0; trial < 4_000; trial += 1) {
    const faction = FACTIONS[trial % FACTIONS.length]
    const body = createHealthyBody()
    if (rng.chance(0.25)) body.rightArm = 'missing'
    if (rng.chance(0.15)) body.leftArm = 'wounded'
    const input = {
      faction,
      stamina: rng.range(0, 100),
      body,
      shieldActive: rng.chance(0.3),
      abilityCooldown: rng.chance(0.4) ? rng.range(0.01, 6) : 0,
      paused: rng.chance(0.2),
      ended: rng.chance(0.1),
    }

    // Exactly what `GameEngine.emitView` did.
    const expected = createAbilityView(input.faction, input.stamina, input.body)
    expected.active = input.shieldActive
    expected.cooldown = input.abilityCooldown
    expected.ready =
      expected.ready &&
      !input.paused &&
      !input.ended &&
      !input.shieldActive &&
      input.abilityCooldown <= 0

    const actual = buildAbilityView(input)
    assert.deepEqual(actual, expected, `trial ${trial}`)
    comparisons += 1
    if (actual.ready) ready += 1
    if (
      createAbilityView(input.faction, input.stamina, input.body).ready &&
      !actual.ready
    ) {
      blockedByRunState += 1
    }
  }

  assert.ok(comparisons >= 4_000)
  assert.ok(ready > 200, `expected the button to light up sometimes, got ${ready}`)
  assert.ok(
    blockedByRunState > 200,
    `expected the run-state gate to bite, got ${blockedByRunState}`,
  )
})

test('the live view carries every field the HUD reads', () => {
  // `buildGameView` replaced a 170-line literal inside `emitView`. A field silently
  // dropped from it would blank a HUD panel with no error anywhere, so this asserts the
  // whole shape round-trips rather than spot-checking a few values.
  const blueprint = generateWorld(8_675_309 % 0xffffffff)
  const faction: Faction = 'villain'
  const objectives = createGeneratedObjectives(blueprint, faction)
  const node = blueprint.objectives[faction].nodes[0]
  const body = createHealthyBody()
  const view = buildGameView({
    faction,
    blueprint,
    bounds: blueprint.bounds,
    health: -5,
    maxHealth: 120,
    damageFlash: 0.4,
    stamina: 33,
    maxStamina: 90,
    gold: 210,
    kills: 7,
    damage: 34,
    zone: 'forest',
    body,
    objectives,
    prompt: 'нажми E',
    playerX: 12,
    playerZ: -4,
    playerHeading: 1.2,
    caravanX: 30,
    caravanZ: 8,
    worldMarkers: [{ id: 'bridge:0', x: 1, z: 2, label: 'мост' }],
    activeObjectiveSiteId: node.siteId,
    activeObjectiveSiteX: 5,
    activeObjectiveSiteZ: 6,
    activeObjectiveId: node.id,
    events: [{ markerId: 'e0', markerX: 7, markerZ: 8, title: 'набег' }],
    actors: [{ id: 'a0', x: 9, z: 10, kind: 'beast' }],
    chronicleRegions: new Map(),
    discoveredRegionIds: new Set([blueprint.regions[0].id]),
    contestedRegionIds: new Set(),
    currentRegionId: blueprint.regions[0].id,
    chronicle: [
      { id: 'c0', tick: 3, regionLabel: 'B2', text: 'сгорело', tone: 'danger' },
    ],
    shopPriceMultiplier: 1.2,
    squad: 2,
    elapsed: 321,
    pointerLocked: true,
    paused: false,
    ended: false,
    caravanCooldown: 4.5,
    shieldActive: false,
    abilityCooldown: 0,
    campaignCompleted: false,
    threatTier: 3,
    upgrades: { blade: 1, vitality: 0, endurance: 2 },
    lootToast: null,
    activeEvent: null,
  })

  // Health is clamped on the way out; the engine relied on that and the HUD does not clamp.
  assert.equal(view.health, 0)
  assert.equal(view.zone, 'forest')
  assert.equal(view.prompt, 'нажми E')
  assert.equal(view.squad, 2)
  assert.equal(view.threatTier, 3)
  assert.equal(view.shopPriceMultiplier, 1.2)
  assert.equal(view.pointerLocked, true)
  assert.equal(view.chronicle.length, 1)
  assert.deepEqual(view.upgrades, { blade: 1, vitality: 0, endurance: 2 })
  assert.equal(view.worldMap.regions.length, blueprint.regions.length)
  assert.equal(view.markers[0].id, 'player')
  assert.equal(view.markers.at(-1)?.kind, 'beast')

  // Defensive copies: the HUD keeps the view across frames, and the engine keeps mutating
  // its own state. A shared reference would make yesterday's view change under React.
  body.leftArm = 'missing'
  assert.equal(view.body.leftArm, 'healthy')
  objectives[0].done = true
  assert.equal(view.objectives[0].done, false)

  // Every key the type declares is present, so a dropped field is a failure rather than
  // an `undefined` the HUD renders as a blank.
  const required: Array<keyof GameView> = [
    'faction', 'health', 'maxHealth', 'damageFlash', 'stamina', 'maxStamina', 'gold',
    'kills', 'damage', 'zone', 'body', 'objectives', 'prompt', 'markers', 'worldMap',
    'chronicle', 'shopPriceMultiplier', 'squad', 'elapsed', 'pointerLocked', 'paused',
    'caravanCooldown', 'ability', 'activeEvent', 'lootToast', 'campaignCompleted',
    'threatTier', 'upgrades',
  ]
  for (const key of required) {
    assert.ok(key in view, `the live view dropped ${key}`)
  }
})

test('a deliberately wrong view builder is caught by the same comparisons', () => {
  let boundsDisagreements = 0
  let objectiveLabelDisagreements = 0
  let discoveryDisagreements = 0
  let orderDisagreements = 0

  for (let index = 0; index < 40; index += 1) {
    const blueprint = generateWorld(51_000 + index * 691)
    const config: RunConfig = {
      seed: blueprint.seed,
      generatorVersion: blueprint.generatorVersion,
      faction: 'guard',
      selectedBoonId: 'boon-scout-maps',
    }

    // 1. "Bounds are bounds." Swapping in a padded rectangle must be visible.
    const chronicleRegions = new Map<string, RegionChronicleState>()
    const correct = buildWorldMapView({
      blueprint,
      bounds: blueprint.bounds,
      chronicleRegions,
      discoveredRegionIds: new Set([blueprint.regions[0].id]),
      currentRegionId: blueprint.regions[0].id,
      contestedRegionIds: new Set(),
    })
    const padded = buildWorldMapView({
      blueprint,
      bounds: {
        minX: blueprint.bounds.minX - 1,
        maxX: blueprint.bounds.maxX,
        minZ: blueprint.bounds.minZ,
        maxZ: blueprint.bounds.maxZ,
      },
      chronicleRegions,
      discoveredRegionIds: new Set([blueprint.regions[0].id]),
      currentRegionId: blueprint.regions[0].id,
      contestedRegionIds: new Set(),
    })
    if (JSON.stringify(correct.bounds) !== JSON.stringify(padded.bounds)) {
      boundsDisagreements += 1
    }

    // 2. "The objective text is the node kind." The shape of a builder that forgot the
    //    site lookup, which is what `legacyObjectives` above stands in for.
    const view = buildInitialGameView({ blueprint, config, restored: undefined })
    const wrongObjectives = legacyObjectives(blueprint, config.faction)
    if (
      view.objectives.some(
        (objective, objectiveIndex) =>
          objective.text !== wrongObjectives[objectiveIndex]?.text,
      )
    ) {
      objectiveLabelDisagreements += 1
    }

    // 3. "The starting region is discovered anyway." Dropping the explicit `add` would
    //    launch a run onto a fogged map.
    const discoveredNow = view.worldMap.regions.filter((region) => region.discovered)
    const withoutStart = view.worldMap.regions.filter(
      (region) => region.discovered && !region.current,
    )
    if (discoveredNow.length !== withoutStart.length) discoveryDisagreements += 1

    // 4. "Markers are a set, order does not matter."
    const objectives = createGeneratedObjectives(blueprint, config.faction)
    const node = blueprint.objectives[config.faction].nodes[0]
    const markers = buildMapMarkers({
      blueprint,
      playerX: 0,
      playerZ: 0,
      playerHeading: 0,
      caravanX: 0,
      caravanZ: 0,
      worldMarkers: [],
      activeObjectiveSiteId: node.siteId,
      activeObjectiveSiteX: 1,
      activeObjectiveSiteZ: 1,
      activeObjectiveId: node.id,
      objectives,
      events: [],
      actors: [{ id: 'a', x: 2, z: 2, kind: 'enemy' }],
    } as unknown as LiveViewInput)
    const reversed = [...markers].reverse()
    if (JSON.stringify(markers) !== JSON.stringify(reversed)) orderDisagreements += 1
  }

  assert.ok(boundsDisagreements > 0, 'the bounds comparison must detect a changed rectangle')
  assert.ok(
    objectiveLabelDisagreements > 0,
    'the objective comparison must detect a dropped site label',
  )
  assert.ok(
    discoveryDisagreements > 0,
    'the launch view must actually discover the starting region',
  )
  assert.ok(orderDisagreements > 0, 'the marker comparison must be order-sensitive')
})
