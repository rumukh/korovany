import {
  Award,
  Bone,
  Castle,
  Check,
  Clock3,
  CloudRain,
  Coins,
  Eye,
  Flag,
  Footprints,
  Hand,
  Heart,
  Home,
  Map as MapIcon,
  Moon,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  Save,
  Shield,
  Skull,
  Sparkles,
  Sword,
  Sun,
  Trees,
  Trophy,
  UserRound,
  Vibrate,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import caravanKeyArt from './assets/caravan-key-art.svg'
import elfEmblem from './assets/factions/elf-emblem.svg'
import guardEmblem from './assets/factions/guard-emblem.svg'
import villainEmblem from './assets/factions/villain-emblem.svg'
import './App.css'
import { SFX_VOLUME_DEFAULT, normalizeSfxVolume } from './game/AudioDirector'
import {
  GameEngine,
  type FoliageQuality,
  type GeneratedRunLaunch,
} from './game/GameEngine'
import {
  ACHIEVEMENT_CATEGORY_LABELS,
  ACHIEVEMENT_CATEGORY_ORDER,
  ACHIEVEMENT_RARITY_LABELS,
  ACHIEVEMENT_RARITY_ORDER,
  readAchievementCatalogue,
  summarizeAchievements,
  type AchievementSummary,
  type AchievementUnlock,
  type AchievementView,
} from './game/achievements'
import {
  FACTION_INFO,
  MAX_HEALTH_PER_LEVEL,
  MAX_STAMINA_PER_LEVEL,
  MAX_THREAT_TIER,
  SAVE_KEY,
  SHOP_ITEMS,
  ZONE_INFO,
  type BodyPart,
  type Faction,
  type GameView,
  type LootRarity,
  type PartStatus,
  type SavedGame,
  type ShopItem,
  type WorldEventView,
  type WorldMapRegion,
  createAbilityView,
  createHealthyBody,
  getMaxHealth,
  getMaxStamina,
  getShopItemPrice,
  getThreatTier,
  normalizeSavedGame,
  normalizeUpgradeLevels,
  restoreObjectives,
} from './game/types'
import { getSiteWorldPosition2D } from './game/content/registry'
import { parseSeed } from './game/random/seed'
import {
  BOON_CATALOGUE,
  getStartingBoonEffects,
  isBoonUnlocked,
  selectProfileBoon,
  unlockBoon,
  validateBoonSelection,
} from './game/run/profile'
import {
  finalizeRunSnapshot,
  loadActiveRun,
  loadProfile,
  saveActiveRun,
  saveProfile,
  type StorageWarning,
} from './game/run/storage'
import type {
  ActiveRunSaveV2,
  ProfileSaveV1,
  RunConfig,
  RunHistorySummary,
} from './game/run/runTypes'
import { generateWorld } from './game/world/WorldGenerator'
import {
  WORLD_GENERATOR_VERSION,
  type SiteKind,
  type WorldBlueprint,
} from './game/world/worldTypes'

interface Notice {
  id: number
  message: string
  tone: 'info' | 'success' | 'warning' | 'danger'
}

interface TerminalRunSummary {
  runId: string
  rewardGranted: number
  summary: RunHistorySummary | null
  profileCurrency: number
  finalizationPending: boolean
}

type Theme = 'dark' | 'light'

const MUSIC_MUTED_KEY = 'korovany-music-muted'
const SFX_VOLUME_KEY = 'korovany-sfx-volume'
const THEME_KEY = 'korovany-theme'
const DYNAMIC_DAY_NIGHT_KEY = 'korovany-dynamic-day-night'
const WEATHER_ENABLED_KEY = 'korovany-weather'
const BLOOM_ENABLED_KEY = 'korovany-bloom'
const INK_OUTLINES_ENABLED_KEY = 'korovany-ink-outlines'
const SCREEN_SHAKE_ENABLED_KEY = 'korovany-screen-shake'
const FOLIAGE_QUALITY_KEY = 'korovany-foliage'

const generatedSiteLabels: Record<SiteKind, string> = {
  'faction-start': 'лагерь фракции',
  'final-stronghold': 'финальная крепость',
  settlement: 'поселение у перепутья',
  shop: 'дорожная лавка',
  recovery: 'придорожное святилище',
  event: 'место события',
  treasure: 'тайник',
  landmark: 'ориентир',
}

const generatedRunStatusLabels: Record<ActiveRunSaveV2['status'], string> = {
  active: 'В пути',
  victory: 'Победа',
  defeat: 'Поражение',
  abandoned: 'Оставлен',
}

const historyStatusLabels: Record<RunHistorySummary['status'], string> = {
  victory: 'Победа',
  defeat: 'Поражение',
  abandoned: 'Оставлен',
}

const territoryLabels: Record<WorldMapRegion['territory'], string> = {
  neutral: 'вольные земли',
  elf: 'эльфы',
  guard: 'гвардия',
  villain: 'злодеи',
}

const warnRunStorage: StorageWarning = (message, error) => {
  if (error === undefined) console.warn(message)
  else console.warn(message, error)
}

function readActiveGeneratedRun(): ActiveRunSaveV2 | null {
  try {
    return loadActiveRun(window.localStorage, warnRunStorage)
  } catch (error) {
    console.warn('Korovany: generated run data could not be read.', error)
    return null
  }
}

function writeActiveGeneratedRun(value: ActiveRunSaveV2): boolean {
  try {
    return saveActiveRun(window.localStorage, value, warnRunStorage)
  } catch (error) {
    console.warn('Korovany: generated run data could not be saved.', error)
    return false
  }
}

function readPlayerProfile(): ProfileSaveV1 {
  try {
    return loadProfile(window.localStorage, warnRunStorage)
  } catch (error) {
    console.warn('Korovany: profile data could not be read.', error)
    return {
      version: 1,
      profileCurrency: 0,
      unlockedBoonIds: BOON_CATALOGUE.filter((boon) => boon.defaultUnlocked).map(
        (boon) => boon.id,
      ),
      unlockedContentIds: [],
      unlockedCosmeticIds: [],
      selectedBoonId: BOON_CATALOGUE.find((boon) => boon.defaultUnlocked)?.id ?? null,
      selectedFaction: null,
      runHistory: [],
      finalizedRunIds: [],
    }
  }
}

function writePlayerProfile(value: ProfileSaveV1): boolean {
  try {
    return saveProfile(window.localStorage, value, warnRunStorage)
  } catch (error) {
    console.warn('Korovany: profile data could not be saved.', error)
    return false
  }
}

function finalizeGeneratedRunSnapshot(snapshot: ActiveRunSaveV2) {
  try {
    return finalizeRunSnapshot(window.localStorage, snapshot, {
      onWarning: warnRunStorage,
    })
  } catch (error) {
    console.warn('Korovany: generated run could not be finalized.', error)
    return null
  }
}

function createRandomSeed(): number {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return parseSeed(values[0])
}

function selectedProfileBoon(profile: ProfileSaveV1): string {
  return (
    validateBoonSelection(profile) ??
    profile.unlockedBoonIds.find((boonId) => isBoonUnlocked(profile, boonId)) ??
    BOON_CATALOGUE[0].id
  )
}

const foliageQualityLabels: Record<FoliageQuality, string> = {
  off: 'выкл.',
  low: 'низк.',
  high: 'высок.',
}

function nextFoliageQuality(quality: FoliageQuality): FoliageQuality {
  if (quality === 'high') return 'low'
  if (quality === 'low') return 'off'
  return 'high'
}

const factionEmblems: Record<Faction, string> = {
  elf: elfEmblem,
  guard: guardEmblem,
  villain: villainEmblem,
}

function FactionEmblem({ faction }: { faction: Faction }) {
  return (
    <img
      className="faction-emblem"
      src={factionEmblems[faction]}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}

const abilityIcons: Record<GameView['ability']['id'], ReactNode> = {
  bow: <Trees aria-hidden="true" />,
  shield: <Shield aria-hidden="true" />,
  cleave: <Sword aria-hidden="true" />,
}

const lootRarityLabels: Record<LootRarity, string> = {
  common: 'Обычная',
  uncommon: 'Необычная',
  rare: 'Редкая',
  legendary: 'Легендарная',
}

const bodyParts: Array<{ id: BodyPart; label: string; short: string; icon: ReactNode }> = [
  { id: 'leftEye', label: 'Левый глаз', short: 'Л. глаз', icon: <Eye aria-hidden="true" /> },
  { id: 'rightEye', label: 'Правый глаз', short: 'П. глаз', icon: <Eye aria-hidden="true" /> },
  { id: 'leftArm', label: 'Левая рука', short: 'Л. рука', icon: <Hand aria-hidden="true" /> },
  { id: 'rightArm', label: 'Правая рука', short: 'П. рука', icon: <Hand aria-hidden="true" /> },
  { id: 'leftLeg', label: 'Левая нога', short: 'Л. нога', icon: <Footprints aria-hidden="true" /> },
  { id: 'rightLeg', label: 'Правая нога', short: 'П. нога', icon: <Footprints aria-hidden="true" /> },
]

function readSavedGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const value = normalizeSavedGame(JSON.parse(raw))
    if (!value) {
      console.warn('Korovany: incompatible saved game ignored.')
      return null
    }
    if (
      Array.isArray(value.objectives) &&
      value.objectives.length > 0 &&
      value.objectives.every((objective) => objective.done)
    ) {
      console.warn('Korovany: completed campaign save ignored.')
      return null
    }
    return value
  } catch (error) {
    console.warn('Korovany: saved game could not be read.', error)
    return null
  }
}

function readMusicMuted(): boolean {
  try {
    return localStorage.getItem(MUSIC_MUTED_KEY) === 'true'
  } catch (error) {
    console.warn('Korovany: music preference could not be read.', error)
    return false
  }
}

function readSfxVolume(): number {
  try {
    const stored = localStorage.getItem(SFX_VOLUME_KEY)
    if (stored === null) return SFX_VOLUME_DEFAULT
    const volume = Number(stored)
    if (Number.isFinite(volume) && volume >= 0 && volume <= 1) return volume
    console.warn('Korovany: invalid SFX volume preference ignored.')
  } catch (error) {
    console.warn('Korovany: SFX volume preference could not be read.', error)
  }
  return SFX_VOLUME_DEFAULT
}

function defaultBloomEnabled(): boolean {
  return !window.matchMedia('(pointer: coarse)').matches
}

function readBloomEnabled(): boolean {
  try {
    const stored = localStorage.getItem(BLOOM_ENABLED_KEY)
    if (stored === 'true' || stored === 'false') return stored === 'true'
  } catch (error) {
    console.warn('Korovany: bloom preference could not be read.', error)
  }
  return defaultBloomEnabled()
}

function readInkOutlinesEnabled(): boolean {
  try {
    return localStorage.getItem(INK_OUTLINES_ENABLED_KEY) !== 'false'
  } catch (error) {
    console.warn('Korovany: ink-outline preference could not be read.', error)
    return true
  }
}

function readFoliageQuality(): FoliageQuality {
  try {
    const stored = localStorage.getItem(FOLIAGE_QUALITY_KEY)
    if (stored === 'off' || stored === 'low' || stored === 'high') return stored
  } catch (error) {
    console.warn('Korovany: foliage preference could not be read.', error)
  }
  return window.matchMedia('(pointer: coarse)').matches ? 'low' : 'high'
}

function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch (error) {
    console.warn('Korovany: theme preference could not be read.', error)
    return 'dark'
  }
}

function readDynamicDayNight(): boolean {
  try {
    return localStorage.getItem(DYNAMIC_DAY_NIGHT_KEY) !== 'false'
  } catch (error) {
    console.warn('Korovany: dynamic time preference could not be read.', error)
    return true
  }
}

function readWeatherEnabled(): boolean {
  try {
    return localStorage.getItem(WEATHER_ENABLED_KEY) !== 'false'
  } catch (error) {
    console.warn('Korovany: weather preference could not be read.', error)
    return true
  }
}

function readScreenShakeEnabled(): boolean {
  try {
    const stored = localStorage.getItem(SCREEN_SHAKE_ENABLED_KEY)
    if (stored === 'true' || stored === 'false') return stored === 'true'
  } catch (error) {
    console.warn('Korovany: screen-shake preference could not be read.', error)
  }
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

function formatSaveDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'неизвестная дата'
    : new Intl.DateTimeFormat('ru', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
}

function createLegacyWorldMap(zone: GameView['zone']): GameView['worldMap'] {
  return {
    mode: 'legacy',
    bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 },
    currentRegionId: zone,
    regions: [
      {
        id: 'neutral',
        gridX: 0,
        gridZ: 0,
        biome: 'neutral',
        territory: 'neutral',
        discovered: true,
        current: zone === 'neutral',
      },
      {
        id: 'palace',
        gridX: 1,
        gridZ: 0,
        biome: 'palace',
        territory: 'guard',
        discovered: true,
        current: zone === 'palace',
      },
      {
        id: 'forest',
        gridX: 0,
        gridZ: 1,
        biome: 'forest',
        territory: 'elf',
        discovered: true,
        current: zone === 'forest',
      },
      {
        id: 'fort',
        gridX: 1,
        gridZ: 1,
        biome: 'fort',
        territory: 'villain',
        discovered: true,
        current: zone === 'fort',
      },
    ],
  }
}

function createInitialView(faction: Faction, savedGame?: SavedGame): GameView {
  const spawn = savedGame?.position ?? [
    FACTION_INFO[faction].spawn[0],
    0,
    FACTION_INFO[faction].spawn[1],
  ]
  const zone =
    spawn[0] < 0 && spawn[2] < 0
      ? 'neutral'
      : spawn[0] >= 0 && spawn[2] < 0
        ? 'palace'
        : spawn[0] < 0
          ? 'forest'
          : 'fort'
  const body = savedGame ? { ...savedGame.body } : createHealthyBody()
  const stamina = savedGame?.stamina ?? 100
  const upgrades = normalizeUpgradeLevels(savedGame?.upgradeLevels)
  const objectives = restoreObjectives(faction, savedGame?.objectives)
  const maxHealth = getMaxHealth(upgrades)
  const maxStamina = getMaxStamina(upgrades)
  const elapsed = savedGame?.elapsed ?? 0
  const currentStamina = Math.min(maxStamina, stamina)
  return {
    faction,
    health: Math.min(maxHealth, savedGame?.health ?? maxHealth),
    maxHealth,
    damageFlash: 0,
    stamina: currentStamina,
    maxStamina,
    gold: savedGame?.gold ?? 55,
    kills: savedGame?.kills ?? 0,
    damage: savedGame?.damage ?? (faction === 'villain' ? 31 : faction === 'guard' ? 28 : 26),
    zone,
    body,
    objectives,
    prompt: '',
    markers: [],
    worldMap: createLegacyWorldMap(zone),
    squad: 0,
    elapsed,
    pointerLocked: false,
    paused: false,
    caravanCooldown: 0,
    ability: createAbilityView(faction, currentStamina, body),
    activeEvent: null,
    lootToast: null,
    campaignCompleted:
      savedGame?.campaignCompleted === true ||
      objectives.every((objective) => objective.done),
    threatTier: getThreatTier(elapsed),
    upgrades,
  }
}

function createGeneratedObjectives(blueprint: WorldBlueprint, faction: Faction) {
  return blueprint.objectives[faction].nodes.map((node) => {
    const site = blueprint.sites.find((candidate) => candidate.id === node.siteId)
    const label = site ? generatedSiteLabels[site.kind] : 'цель'
    const text =
      node.kind === 'arrive'
        ? `Доберитесь до места «${label}»`
        : node.kind === 'interact'
          ? `Осмотрите место «${label}»`
          : node.kind === 'claim'
            ? `Заберите награду в месте «${label}»`
            : `Одолейте противника у места «${label}»`
    return { id: node.id, text, done: false }
  })
}

function serializableNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function createGeneratedInitialView(launch: GeneratedRunLaunch): GameView {
  const blueprint = generateWorld(launch.config.seed)
  const restored = launch.restored
  const startSite = blueprint.sites.find(
    (site) => site.id === blueprint.starts[launch.config.faction],
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

  const boon = getStartingBoonEffects(launch.config.selectedBoonId)
  const upgrades = normalizeUpgradeLevels(restored?.player.upgrades)
  const baseHealth = getMaxHealth(upgrades)
  const baseStamina = getMaxStamina(upgrades)
  const maxHealth =
    restored?.player.maxHealth ?? baseHealth + boon.startingHealthBonus
  const maxStamina =
    restored?.player.maxStamina ?? baseStamina + boon.startingStaminaBonus
  const health = Math.min(maxHealth, restored?.player.health ?? maxHealth)
  const stamina = Math.min(maxStamina, restored?.player.stamina ?? maxStamina)
  const body = restored ? { ...restored.player.body } : createHealthyBody()
  const objectives =
    restored?.player.objectives.map((objective) => ({ ...objective })) ??
    createGeneratedObjectives(blueprint, launch.config.faction)
  const elapsed = serializableNumber(restored?.directorState.elapsed)
  const discovered = new Set(restored?.discoveredRegionIds ?? [])
  discovered.add(currentRegion.id)

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
    faction: launch.config.faction,
    health,
    maxHealth,
    damageFlash: 0,
    stamina,
    maxStamina,
    gold: restored?.player.gold ?? 55 + boon.startingGoldBonus,
    kills: restored?.player.kills ?? 0,
    damage:
      restored?.player.damage ??
      (launch.config.faction === 'villain'
        ? 31
        : launch.config.faction === 'guard'
          ? 28
          : 26) + boon.startingDamageBonus,
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
      mode: 'generated',
      bounds: { ...blueprint.bounds },
      currentRegionId: currentRegion.id,
      seed: blueprint.seed,
      generatorVersion: blueprint.generatorVersion,
      regions: blueprint.regions.map((region) => ({
        id: region.id,
        gridX: region.coordinate.x,
        gridZ: region.coordinate.y,
        biome: region.biome,
        territory: region.territory,
        discovered: discovered.has(region.id),
        current: region.id === currentRegion.id,
      })),
    },
    squad: 0,
    elapsed,
    pointerLocked: false,
    paused: false,
    caravanCooldown: serializableNumber(restored?.directorState.caravanCooldown),
    ability: createAbilityView(launch.config.faction, stamina, body),
    activeEvent: null,
    lootToast: null,
    campaignCompleted: objectives.every((objective) => objective.done),
    threatTier: getThreatTier(elapsed),
    upgrades,
  }
}

function StatusDot({ status }: { status: PartStatus }) {
  const labels: Record<PartStatus, string> = {
    healthy: 'цела',
    wounded: 'ранена',
    missing: 'утрачена',
    prosthetic: 'протез',
  }
  return <span className={`part-state ${status}`}>{labels[status]}</span>
}

function projectMapMarker(
  coordinate: number,
  minimum: number,
  maximum: number,
): string {
  const span = Math.max(1, maximum - minimum)
  return `${Math.min(100, Math.max(0, ((coordinate - minimum) / span) * 100))}%`
}

function markerIsDiscovered(view: GameView, x: number, z: number): boolean {
  if (view.worldMap.mode === 'legacy') return true
  const { bounds, regions } = view.worldMap
  const columns = Math.max(1, ...regions.map((region) => region.gridX + 1))
  const rows = Math.max(1, ...regions.map((region) => region.gridZ + 1))
  const gridX = Math.min(
    columns - 1,
    Math.max(0, Math.floor(((x - bounds.minX) / (bounds.maxX - bounds.minX)) * columns)),
  )
  const gridZ = Math.min(
    rows - 1,
    Math.max(0, Math.floor(((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * rows)),
  )
  return Boolean(
    regions.find((region) => region.gridX === gridX && region.gridZ === gridZ)
      ?.discovered,
  )
}

function RegionBiomeIcon({ biome }: { biome: GameView['zone'] }) {
  if (biome === 'forest') return <Trees aria-hidden="true" />
  if (biome === 'palace') return <Castle aria-hidden="true" />
  if (biome === 'fort') return <Skull aria-hidden="true" />
  return <Home aria-hidden="true" />
}

function MiniMap({ view }: { view: GameView }) {
  const hasObjectiveMarker = view.markers.some((marker) => marker.kind === 'objective')
  const hasEventMarker = view.markers.some((marker) => marker.kind === 'event')
  const generated = view.worldMap.mode === 'generated'
  const discoveredCount = view.worldMap.regions.filter((region) => region.discovered).length
  const visibleMarkers = view.markers.filter(
    (marker) =>
      marker.kind === 'player' || markerIsDiscovered(view, marker.x, marker.z),
  )
  const mapLabel = generated
    ? `Карта сгенерированного мира, открыто ${discoveredCount} из ${view.worldMap.regions.length} регионов`
    : 'Карта четырёх зон'
  const { bounds } = view.worldMap

  return (
    <section
      className={`hud-card minimap-card ${generated ? 'generated' : 'legacy'}`}
      aria-label={mapLabel}
    >
      <header className="hud-card-header">
        <span>
          <MapIcon aria-hidden="true" />
          Карта
        </span>
        <span className="zone-code">
          {generated
            ? `${discoveredCount}/${view.worldMap.regions.length}`
            : '4 зоны'}
        </span>
      </header>
      {generated ? (
        <div className="generated-map-meta">
          <span>seed {view.worldMap.seed}</span>
          <span>v{view.worldMap.generatorVersion}</span>
        </div>
      ) : null}
      <div className={`minimap ${generated ? 'generated-world-map' : 'legacy-world-map'}`}>
        {generated ? (
          view.worldMap.regions.map((region) => {
            const title = region.discovered
              ? `${ZONE_INFO[region.biome].name} · ${territoryLabels[region.territory]}`
              : 'Неизведанный регион'
            return (
              <div
                className={`generated-map-region ${
                  region.discovered
                    ? `discovered biome-${region.biome} territory-${region.territory}`
                    : 'fogged'
                } ${region.current ? 'current' : ''}`}
                key={region.id}
                style={{
                  gridColumn: region.gridX + 1,
                  gridRow: region.gridZ + 1,
                }}
                title={title}
                aria-label={title}
              >
                {region.discovered ? (
                  <>
                    <RegionBiomeIcon biome={region.biome} />
                    <span>{territoryLabels[region.territory]}</span>
                  </>
                ) : (
                  <span aria-hidden="true">?</span>
                )}
              </div>
            )
          })
        ) : (
          <>
            <div className={`map-zone neutral${view.zone === 'neutral' ? ' current' : ''}`}>
              <Home aria-hidden="true" />
              <span>Люди</span>
            </div>
            <div className={`map-zone palace${view.zone === 'palace' ? ' current' : ''}`}>
              <Castle aria-hidden="true" />
              <span>Дворец</span>
            </div>
            <div className={`map-zone forest${view.zone === 'forest' ? ' current' : ''}`}>
              <Trees aria-hidden="true" />
              <span>Эльфы</span>
            </div>
            <div className={`map-zone fort${view.zone === 'fort' ? ' current' : ''}`}>
              <Skull aria-hidden="true" />
              <span>Форт</span>
            </div>
            <div className="map-road horizontal" />
            <div className="map-road vertical" />
          </>
        )}
        {visibleMarkers.map((marker) => (
          <span
            className={`map-marker ${marker.kind}`}
            key={marker.id}
            style={{
              left: projectMapMarker(marker.x, bounds.minX, bounds.maxX),
              top: projectMapMarker(marker.z, bounds.minZ, bounds.maxZ),
            }}
            title={marker.label ?? marker.kind}
          >
            {marker.kind === 'player' ? (
              <span
                className="player-heading"
                style={{ transform: `rotate(${marker.heading ?? 0}rad)` }}
              />
            ) : marker.kind === 'event' ? (
              <Sparkles aria-hidden="true" />
            ) : null}
          </span>
        ))}
      </div>
      <div className="map-legend">
        <span>
          <i className="legend-dot ally" /> свои
        </span>
        <span>
          <i className="legend-dot enemy" /> враги
        </span>
        <span>
          <i className="legend-dot caravan" /> корован
        </span>
        {hasObjectiveMarker ? (
          <span>
            <i className="legend-dot objective" /> {generated ? 'цель' : 'сдача добычи'}
          </span>
        ) : null}
        {hasEventMarker ? (
          <span>
            <i className="legend-dot event" /> событие
          </span>
        ) : null}
      </div>
    </section>
  )
}

function ObjectiveList({ view }: { view: GameView }) {
  const completed = view.objectives.filter((objective) => objective.done).length
  const raidDone = view.objectives.some((objective) => objective.id === 'raid' && objective.done)
  const guards = view.objectives.find((objective) => objective.id === 'guards')
  const lootTurnInReady = raidDone && Boolean(guards?.done)

  return (
    <section className="hud-card objectives-card">
      <header className="hud-card-header">
        <span>
          <Flag aria-hidden="true" />
          Задачи
        </span>
        <span className="zone-code">
          {completed}/{view.objectives.length}
        </span>
      </header>
      <div className="objective-list">
        {view.objectives.map((objective) => {
          const isLootTurnIn = view.faction === 'elf' && objective.id === 'home' && !objective.done
          const lootHint = !isLootTurnIn
            ? null
            : !raidDone
              ? 'Сначала ограбьте корован'
              : !guards?.done
                ? `Добыча при вас • охрана ${guards?.progress ?? 0}/${guards?.target ?? 4}`
                : 'Цель отмечена на карте • нажмите E у маяка'

          return (
            <div
              className={`objective ${objective.done ? 'done' : ''} ${
                isLootTurnIn && lootTurnInReady ? 'ready' : ''
              }`}
              key={objective.id}
            >
              <span className="objective-check">
                {objective.done ? <Check aria-hidden="true" /> : <span />}
              </span>
              <div>
                <p>{objective.text}</p>
                {lootHint ? <span className="objective-hint">{lootHint}</span> : null}
                {objective.target && !objective.done ? (
                  <div className="objective-progress">
                    <i
                      style={{
                        width: `${((objective.progress ?? 0) / objective.target) * 100}%`,
                      }}
                    />
                    <span>
                      {objective.progress ?? 0}/{objective.target}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function EventBanner({ event }: { event: WorldEventView | null }) {
  if (!event) return null
  const progress =
    event.target && event.target > 0
      ? Math.min(100, Math.max(0, ((event.progress ?? 0) / event.target) * 100))
      : 0
  const urgent = event.timeRemaining !== undefined && event.timeRemaining < 10

  return (
    <section
      className={`hud-card event-banner ${event.tone} ${urgent ? 'urgent' : ''}`}
      aria-live="polite"
    >
      <header className="event-banner-header">
        <span>
          <Sparkles aria-hidden="true" />
          Событие
        </span>
        {event.timeRemaining !== undefined ? (
          <strong>
            <Clock3 aria-hidden="true" />
            {Math.ceil(event.timeRemaining)} с
          </strong>
        ) : null}
      </header>
      <h2>{event.title}</h2>
      <p>{event.description}</p>
      {event.target && event.target > 0 ? (
        <div className="event-progress">
          <i style={{ width: `${progress}%` }} />
          <span>
            {Math.floor(event.progress ?? 0)}/{event.target}
          </span>
        </div>
      ) : null}
    </section>
  )
}

function CampaignBanner({ view }: { view: GameView }) {
  if (!view.campaignCompleted || view.worldMap.mode === 'generated') return null

  return (
    <section className="hud-card campaign-banner" aria-label="Кампания завершена">
      <Flag aria-hidden="true" />
      <div>
        <span>Кампания завершена</span>
        <strong>Свободная игра продолжается</strong>
        <small>События, налёты и торговля остаются активны.</small>
      </div>
    </section>
  )
}

function BodyPanel({ view }: { view: GameView }) {
  const healthy =
    view.body.bleeding <= 0 && bodyParts.every((part) => view.body[part.id] === 'healthy')

  return (
    <section className={`body-panel ${healthy ? 'healthy' : ''}`} aria-label="Состояние тела">
      <div className="body-title">
        <Bone aria-hidden="true" />
        <span>Состояние</span>
        {healthy ? (
          <strong className="body-healthy">
            <Check aria-hidden="true" />
            Всё цело
          </strong>
        ) : view.body.bleeding > 0 ? (
          <strong>Кровотечение {view.body.bleeding.toFixed(1)}</strong>
        ) : null}
      </div>
      {!healthy ? (
        <div className="body-parts">
          {bodyParts.map((part) => (
            <div className="body-part" key={part.id} title={part.label}>
              {part.icon}
              <span>{part.short}</span>
              <StatusDot status={view.body[part.id]} />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function formatAchievementDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'дата неизвестна'
    : new Intl.DateTimeFormat('ru', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(date)
}

function AchievementBanner({ achievement }: { achievement: AchievementUnlock | null }) {
  if (!achievement) return null
  return (
    <aside
      className={`achievement-banner rarity-${achievement.rarity}`}
      aria-live="assertive"
      aria-label="Достижение открыто"
    >
      <div className="achievement-banner-icon">
        <Trophy aria-hidden="true" />
      </div>
      <div>
        <span>Достижение открыто · {ACHIEVEMENT_RARITY_LABELS[achievement.rarity]}</span>
        <strong>{achievement.name}</strong>
        <p>{achievement.description}</p>
      </div>
    </aside>
  )
}

function LootToast({ toast }: { toast: GameView['lootToast'] }) {
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {toast
          ? (
              <span key={toast.id}>
                {`${lootRarityLabels[toast.rarity]} награда. ${toast.title}. ${toast.detail}`}
              </span>
            )
          : null}
      </span>
      {toast ? (
        <aside
          className={`loot-toast loot-${toast.rarity}`}
          aria-hidden="true"
          key={toast.id}
        >
          <span className="loot-rarity-shape">
            <i />
          </span>
          <span className="loot-toast-copy">
            <small>{lootRarityLabels[toast.rarity]} награда</small>
            <strong>{toast.title}</strong>
            <span>{toast.detail}</span>
          </span>
        </aside>
      ) : null}
    </>
  )
}

function AchievementGallery({
  achievements,
  onClose,
}: {
  achievements: AchievementView[]
  onClose: () => void
}) {
  const summary = summarizeAchievements(achievements)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="modal-backdrop achievement-backdrop" role="presentation">
      <section
        className="modal achievement-gallery"
        role="dialog"
        aria-modal="true"
        aria-labelledby="achievements-title"
      >
        <header className="modal-header achievement-gallery-header">
          <div>
            <span className="eyebrow">Летопись подвигов</span>
            <h2 id="achievements-title">Достижения</h2>
            <p>Никаких наград — только слава, редкость и право хвастаться.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть достижения">
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="achievement-overview">
          <div className="achievement-total">
            <div className="achievement-total-ring" style={{ '--completion': `${summary.percent}%` } as CSSProperties}>
              <strong>{summary.percent}%</strong>
            </div>
            <div>
              <span>Открыто</span>
              <strong>
                {summary.unlocked} / {summary.total}
              </strong>
              <p>Подвиги сохраняются между всеми кампаниями.</p>
            </div>
          </div>
          <div className="achievement-rarity-breakdown" aria-label="Прогресс по редкости">
            {ACHIEVEMENT_RARITY_ORDER.map((rarity) => (
              <div className={`rarity-${rarity}`} key={rarity}>
                <span>{ACHIEVEMENT_RARITY_LABELS[rarity]}</span>
                <strong>
                  {summary.byRarity[rarity].unlocked}/{summary.byRarity[rarity].total}
                </strong>
              </div>
            ))}
          </div>
        </div>

        <div className="achievement-categories">
          {ACHIEVEMENT_CATEGORY_ORDER.map((category) => {
            const categoryAchievements = achievements.filter(
              (achievement) => achievement.category === category,
            )
            if (categoryAchievements.length === 0) return null
            const categoryUnlocked = categoryAchievements.filter(
              (achievement) => achievement.unlocked,
            ).length
            return (
              <section className="achievement-category" key={category}>
                <header>
                  <div>
                    <Award aria-hidden="true" />
                    <h3>{ACHIEVEMENT_CATEGORY_LABELS[category]}</h3>
                  </div>
                  <span>
                    {categoryUnlocked}/{categoryAchievements.length}
                  </span>
                </header>
                <div className="achievement-grid">
                  {categoryAchievements.map((achievement) => {
                    const concealed = achievement.hidden && !achievement.unlocked
                    const progress = Math.min(
                      100,
                      (achievement.progress / achievement.target) * 100,
                    )
                    return (
                      <article
                        className={`achievement-card rarity-${achievement.rarity} ${
                          achievement.unlocked ? 'unlocked' : 'locked'
                        } ${concealed ? 'hidden-achievement' : ''}`}
                        key={achievement.id}
                      >
                        <div className="achievement-card-icon">
                          {achievement.unlocked ? (
                            <Trophy aria-hidden="true" />
                          ) : (
                            <Award aria-hidden="true" />
                          )}
                        </div>
                        <div className="achievement-card-copy">
                          <span>{ACHIEVEMENT_RARITY_LABELS[achievement.rarity]}</span>
                          <h4>{concealed ? '???' : achievement.name}</h4>
                          <p>
                            {concealed
                              ? 'Условие этого достижения пока скрыто.'
                              : achievement.description}
                          </p>
                        </div>
                        {achievement.unlocked ? (
                          <time dateTime={achievement.unlockedAt ?? undefined}>
                            Открыто {formatAchievementDate(achievement.unlockedAt ?? '')}
                          </time>
                        ) : concealed ? (
                          <div className="achievement-card-hidden-state">
                            <span>Условие скрыто</span>
                          </div>
                        ) : (
                          <div className="achievement-card-progress">
                            <div>
                              <i style={{ transform: `scaleX(${progress / 100})` }} />
                            </div>
                            <span>
                              {Math.floor(achievement.progress)} / {achievement.target}
                            </span>
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function MenuScreen({
  savedGame,
  activeRun,
  activeRunError,
  profile,
  seedInput,
  canonicalSeed,
  achievementSummary,
  theme,
  dynamicDayNight,
  weatherEnabled,
  bloomEnabled,
  inkOutlinesEnabled,
  foliageQuality,
  screenShakeEnabled,
  sfxVolume,
  onStart,
  onContinueGenerated,
  onAbandonGenerated,
  onLoadLegacy,
  onSeedInput,
  onRandomSeed,
  onSelectBoon,
  onUnlockBoon,
  onAchievements,
  onToggleTheme,
  onToggleDynamicDayNight,
  onToggleWeather,
  onToggleBloom,
  onToggleInkOutlines,
  onCycleFoliageQuality,
  onToggleScreenShake,
  onSfxVolumeChange,
}: {
  savedGame: SavedGame | null
  activeRun: ActiveRunSaveV2 | null
  activeRunError: string | null
  profile: ProfileSaveV1
  seedInput: string
  canonicalSeed: number
  achievementSummary: AchievementSummary
  theme: Theme
  dynamicDayNight: boolean
  weatherEnabled: boolean
  bloomEnabled: boolean
  inkOutlinesEnabled: boolean
  foliageQuality: FoliageQuality
  screenShakeEnabled: boolean
  sfxVolume: number
  onStart: (faction: Faction) => void
  onContinueGenerated: () => void
  onAbandonGenerated: () => void
  onLoadLegacy: () => void
  onSeedInput: (value: string) => void
  onRandomSeed: () => void
  onSelectBoon: (boonId: string) => void
  onUnlockBoon: (boonId: string) => void
  onAchievements: () => void
  onToggleTheme: () => void
  onToggleDynamicDayNight: () => void
  onToggleWeather: () => void
  onToggleBloom: () => void
  onToggleInkOutlines: () => void
  onCycleFoliageQuality: () => void
  onToggleScreenShake: () => void
  onSfxVolumeChange: (volume: number) => void
}) {
  const selectedBoonId = selectedProfileBoon(profile)
  const previewWorld = useMemo(() => generateWorld(canonicalSeed), [canonicalSeed])
  const activeElapsed = serializableNumber(activeRun?.directorState.elapsed)
  const recentRuns = profile.runHistory.slice(0, 4)
  const compatibilityError =
    activeRun &&
    activeRun.config.generatorVersion !== WORLD_GENERATOR_VERSION
      ? `Версия мира ${activeRun.config.generatorVersion} не поддерживается этой сборкой.`
      : activeRunError

  return (
    <main className="menu-screen">
      <div className="menu-atmosphere" aria-hidden="true">
        <div className="contour contour-a" />
        <div className="contour contour-b" />
        <div className="contour contour-c" />
      </div>
      <div className="menu-settings">
        <button
          className="theme-toggle secondary-button"
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
          title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
        >
          {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          <span>{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span>
        </button>
        <button
          className="day-night-toggle secondary-button"
          type="button"
          onClick={onToggleDynamicDayNight}
          aria-pressed={dynamicDayNight}
          aria-label={
            dynamicDayNight
              ? 'Отключить динамическое время суток'
              : 'Включить динамическое время суток'
          }
          title={
            dynamicDayNight
              ? 'Отключить динамическое время суток'
              : 'Включить динамическое время суток'
          }
        >
          <Clock3 aria-hidden="true" />
          <span>{dynamicDayNight ? 'Время суток: вкл.' : 'Время суток: выкл.'}</span>
        </button>
        <button
          className="weather-toggle secondary-button"
          type="button"
          onClick={onToggleWeather}
          aria-pressed={weatherEnabled}
          aria-label={weatherEnabled ? 'Отключить динамическую погоду' : 'Включить динамическую погоду'}
          title={weatherEnabled ? 'Отключить динамическую погоду' : 'Включить динамическую погоду'}
        >
          <CloudRain aria-hidden="true" />
          <span>{weatherEnabled ? 'Погода: вкл.' : 'Погода: выкл.'}</span>
        </button>
        <button
          className="bloom-toggle secondary-button"
          type="button"
          onClick={onToggleBloom}
          aria-pressed={bloomEnabled}
          aria-label={bloomEnabled ? 'Отключить свечение' : 'Включить свечение'}
          title={bloomEnabled ? 'Отключить свечение' : 'Включить свечение'}
        >
          <Sparkles aria-hidden="true" />
          <span>{bloomEnabled ? 'Свечение: вкл.' : 'Свечение: выкл.'}</span>
        </button>
        <button
          className="ink-outlines-toggle secondary-button"
          type="button"
          onClick={onToggleInkOutlines}
          aria-pressed={inkOutlinesEnabled}
          aria-label={
            inkOutlinesEnabled
              ? 'Отключить чернильные контуры'
              : 'Включить чернильные контуры'
          }
          title={
            inkOutlinesEnabled
              ? 'Отключить чернильные контуры'
              : 'Включить чернильные контуры'
          }
        >
          <Eye aria-hidden="true" />
          <span>
            {inkOutlinesEnabled
              ? 'Чернильные контуры: вкл.'
              : 'Чернильные контуры: выкл.'}
          </span>
        </button>
        <button
          className="foliage-toggle secondary-button"
          type="button"
          onClick={onCycleFoliageQuality}
          data-quality={foliageQuality}
          aria-label={`Качество растительности: ${foliageQualityLabels[foliageQuality]}`}
          title="Изменить качество растительности"
        >
          <Trees aria-hidden="true" />
          <span>Растительность: {foliageQualityLabels[foliageQuality]}</span>
        </button>
        <button
          className="screen-shake-toggle secondary-button"
          type="button"
          onClick={onToggleScreenShake}
          aria-pressed={screenShakeEnabled}
          aria-label={screenShakeEnabled ? 'Отключить эффекты камеры' : 'Включить эффекты камеры'}
          title={screenShakeEnabled ? 'Отключить эффекты камеры' : 'Включить эффекты камеры'}
        >
          <Vibrate aria-hidden="true" />
          <span>{screenShakeEnabled ? 'Камера: вкл.' : 'Камера: выкл.'}</span>
        </button>
        <label className="sfx-volume-control menu-sfx-volume">
          <Volume2 aria-hidden="true" />
          <span>Громкость эффектов</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={sfxVolume}
            onChange={(event) => onSfxVolumeChange(Number(event.currentTarget.value))}
            aria-label="Громкость эффектов"
          />
          <strong>{Math.round(sfxVolume * 100)}%</strong>
        </label>
      </div>
      <header className="hero-header">
        <div className="hackathon-tag">
          <Sparkles aria-hidden="true" />
          Хакатонная сборка • 3D-экшон
        </div>
        <h1>КОРОВАНЫ</h1>
        <p className="hero-kicker">Джва года в разработке</p>
        <img
          className="hero-key-art"
          src={caravanKeyArt}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <p className="hero-copy">
          Конечный экшен-рогалик на 25 потоковых регионах. Каждый seed собирает новый путь
          через холмы, реки и мосты для любой из трёх сторон конфликта.
        </p>
        <button className="secondary-button achievement-menu-button" type="button" onClick={onAchievements}>
          <Trophy aria-hidden="true" />
          Достижения {achievementSummary.unlocked}/{achievementSummary.total}
        </button>
      </header>

      {activeRun ? (
        <section className="active-run-card" aria-labelledby="active-run-title">
          <div className={`active-run-emblem faction-${activeRun.config.faction}`}>
            <FactionEmblem faction={activeRun.config.faction} />
          </div>
          <div className="active-run-copy">
            <span className="eyebrow">
              {compatibilityError
                ? 'Забег требует внимания'
                : 'Активный сгенерированный забег'}
            </span>
            <h2 id="active-run-title">{FACTION_INFO[activeRun.config.faction].name}</h2>
            <p>
              Seed <strong>{activeRun.config.seed}</strong> · {formatTime(activeElapsed)} ·{' '}
              {generatedRunStatusLabels[activeRun.status]} · открыто{' '}
              {activeRun.discoveredRegionIds.length}/25
            </p>
            <small>Контрольная точка: {formatSaveDate(activeRun.updatedAt)}</small>
            {compatibilityError ? (
              <small className="active-run-error" role="alert">
                {compatibilityError}
              </small>
            ) : null}
          </div>
          <div className="active-run-actions">
            <button
              className="primary-button"
              type="button"
              onClick={onContinueGenerated}
              disabled={Boolean(compatibilityError)}
            >
              <Play aria-hidden="true" />
              {compatibilityError ? 'Продолжение недоступно' : 'Продолжить забег'}
            </button>
            <button
              className="secondary-button danger-button"
              type="button"
              onClick={onAbandonGenerated}
            >
              <X aria-hidden="true" />
              Оставить забег
            </button>
          </div>
        </section>
      ) : null}

      <section
        className={`faction-select ${activeRun ? 'new-run-blocked' : ''}`}
        aria-labelledby="faction-title"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">Новый сгенерированный забег</span>
            <h2 id="faction-title">Выберите, за кого нагибать</h2>
          </div>
          <p>
            Одна жизнь, уникальный мир и отдельный маршрут к финальной крепости для каждой
            фракции.
          </p>
        </div>

        <div className="run-setup">
          <div className="seed-panel">
            <div className="run-setup-heading">
              <div>
                <span className="eyebrow">Seed мира</span>
                <h3>Введите число или любой текст</h3>
              </div>
              <code aria-label={`Канонический seed ${canonicalSeed}`}>{canonicalSeed}</code>
            </div>
            <div className="seed-controls">
              <label>
                <span className="sr-only">Seed нового мира</span>
                <input
                  id="world-seed"
                  name="world-seed"
                  type="text"
                  value={seedInput}
                  onChange={(event) => onSeedInput(event.currentTarget.value)}
                  spellCheck="false"
                  autoComplete="off"
                  placeholder="Например: два года"
                />
              </label>
              <button className="secondary-button random-seed-button" type="button" onClick={onRandomSeed}>
                <RotateCcw aria-hidden="true" />
                Случайный seed
              </button>
            </div>
            <p>
              Канонический uint32: <strong>{canonicalSeed}</strong>. Одинаковый seed всегда
              создаёт тот же мир версии {WORLD_GENERATOR_VERSION}.
            </p>
          </div>

          <div className="boon-panel">
            <div className="run-setup-heading">
              <div>
                <span className="eyebrow">Стартовый дар</span>
                <h3>Один бонус на весь забег</h3>
              </div>
              <div className="profile-currency" title="Валюта профиля">
                <Coins aria-hidden="true" />
                <span>{profile.profileCurrency}</span>
              </div>
            </div>
            <div className="boon-grid">
              {BOON_CATALOGUE.map((boon) => {
                const unlocked = isBoonUnlocked(profile, boon.id)
                const selected = boon.id === selectedBoonId
                const affordable = profile.profileCurrency >= boon.unlockCost
                return (
                  <article
                    className={`boon-card ${unlocked ? 'unlocked' : 'locked'} ${
                      selected ? 'selected' : ''
                    }`}
                    key={boon.id}
                  >
                    <button
                      className="boon-select"
                      type="button"
                      disabled={!unlocked}
                      aria-pressed={selected}
                      onClick={() => onSelectBoon(boon.id)}
                    >
                      <span className="boon-state">
                        {selected ? (
                          <>
                            <Check aria-hidden="true" /> Выбран
                          </>
                        ) : unlocked ? (
                          'Доступен'
                        ) : (
                          'Закрыт'
                        )}
                      </span>
                      <strong>{boon.name}</strong>
                      <small>{boon.description}</small>
                    </button>
                    {!unlocked ? (
                      <button
                        className="boon-unlock"
                        type="button"
                        disabled={!affordable}
                        onClick={() => onUnlockBoon(boon.id)}
                        title={
                          affordable
                            ? `Открыть за ${boon.unlockCost}`
                            : `Нужно ещё ${boon.unlockCost - profile.profileCurrency}`
                        }
                      >
                        <Coins aria-hidden="true" />
                        {boon.unlockCost}
                      </button>
                    ) : null}
                  </article>
                )
              })}
            </div>
          </div>
        </div>

        {activeRun ? (
          <p className="new-run-blocked-note">
            <Shield aria-hidden="true" />
            Новый забег станет доступен после продолжения или явного отказа от активного.
          </p>
        ) : null}

        <div className="faction-grid">
          {(Object.keys(FACTION_INFO) as Faction[]).map((faction) => {
            const info = FACTION_INFO[faction]
            return (
              <article className={`faction-card ${faction}`} key={faction}>
                <div className="faction-scenery" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="faction-icon">
                  <FactionEmblem faction={faction} />
                </div>
                <span className="faction-subtitle">{info.subtitle}</span>
                <h3>{info.name}</h3>
                <p>{info.description}</p>
                <div className="perk">
                  <Sparkles aria-hidden="true" />
                  <span>{info.perk}</span>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  disabled={Boolean(activeRun)}
                  onClick={() => onStart(faction)}
                >
                  <Play aria-hidden="true" />
                  {activeRun ? 'Есть активный забег' : `Начать · seed ${canonicalSeed}`}
                </button>
              </article>
            )
          })}
        </div>
      </section>

      <section className="menu-lower">
        <div className="world-map-card">
          <div className="map-copy">
            <span className="eyebrow">Конечный сгенерированный мир</span>
            <h2>25 регионов, собранных из seed</h2>
            <p>
              Регионы подгружаются вокруг героя. Холмы меняют рельеф, река пересекает карту,
              а мосты связывают маршруты всех трёх фракций.
            </p>
            <div className="feature-pills">
              <span>
                <MapIcon aria-hidden="true" /> 5×5 регионов
              </span>
              <span>
                <CloudRain aria-hidden="true" /> Холмы и река
              </span>
              <span>
                <Castle aria-hidden="true" /> Дороги и мосты
              </span>
              <span>
                <Sparkles aria-hidden="true" /> Уникальный seed
              </span>
            </div>
          </div>
          <div
            className="menu-map generated-preview"
            aria-label={`Предпросмотр мира seed ${canonicalSeed}`}
          >
            {previewWorld.regions.map((region) => {
              const river = previewWorld.river.regionPath.includes(region.id)
              const bridge = previewWorld.bridges.some(
                (crossing) => crossing.regionId === region.id,
              )
              const startFaction = (Object.keys(previewWorld.starts) as Faction[]).find(
                (candidate) =>
                  previewWorld.sites.find(
                    (site) => site.id === previewWorld.starts[candidate],
                  )?.regionId === region.id,
              )
              return (
                <div
                  className={`menu-preview-region biome-${region.biome} ${
                    river ? 'river' : ''
                  } ${bridge ? 'bridge' : ''}`}
                  key={region.id}
                  style={{
                    gridColumn: region.coordinate.x + 1,
                    gridRow: region.coordinate.y + 1,
                  }}
                  title={`${ZONE_INFO[region.biome].name} · ${territoryLabels[region.territory]}`}
                >
                  {startFaction ? (
                    <span className={`preview-start faction-${startFaction}`}>
                      <FactionEmblem faction={startFaction} />
                    </span>
                  ) : null}
                  {bridge ? <i className="preview-bridge" aria-hidden="true" /> : null}
                </div>
              )
            })}
            <code>seed {canonicalSeed}</code>
          </div>
        </div>

        <div className="menu-side-stack">
          {savedGame ? (
            <div className="continue-card legacy-save-card">
              <div className="continue-icon">
                <FactionEmblem faction={savedGame.faction} />
              </div>
              <div className="continue-copy">
                <span className="eyebrow">Legacy campaign · v1</span>
                <h3>{FACTION_INFO[savedGame.faction].name}</h3>
                <p>
                  {formatSaveDate(savedGame.savedAt)} • {savedGame.gold} золота •{' '}
                  {savedGame.kills} побед
                </p>
              </div>
              <button className="secondary-button" type="button" onClick={onLoadLegacy}>
                <RotateCcw aria-hidden="true" />
                Загрузить legacy campaign
              </button>
            </div>
          ) : (
            <div className="continue-card empty legacy-save-card">
              <Save aria-hidden="true" />
              <div>
                <span className="eyebrow">Legacy campaign · v1</span>
                <h3>Старого сохранения нет</h3>
                <p>Формат v1 может сосуществовать с новым забегом.</p>
              </div>
            </div>
          )}

          <section className="profile-card" aria-labelledby="profile-title">
            <header>
              <div>
                <span className="eyebrow">Профиль</span>
                <h3 id="profile-title">История забегов</h3>
              </div>
              <div className="profile-currency">
                <Coins aria-hidden="true" />
                <strong>{profile.profileCurrency}</strong>
              </div>
            </header>
            {recentRuns.length > 0 ? (
              <div className="run-history-list">
                {recentRuns.map((run) => (
                  <article className={`history-run status-${run.status}`} key={run.runId}>
                    <span className="history-faction">
                      <FactionEmblem faction={run.faction} />
                    </span>
                    <div>
                      <strong>{historyStatusLabels[run.status]}</strong>
                      <small>
                        seed {run.seed} · {FACTION_INFO[run.faction].shortName}
                      </small>
                    </div>
                    <span className="history-reward">
                      <Coins aria-hidden="true" />+{run.profileCurrencyEarned}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-history">Завершённые забеги появятся здесь.</p>
            )}
          </section>
        </div>
      </section>
      <footer className="menu-footer">
        <span>WASD — движение</span>
        <span>мышь — камера и удар</span>
        <span>Space — прыжок</span>
        <span>E — действие</span>
        <span>Q — приказ</span>
      </footer>
    </main>
  )
}

function ShopModal({
  view,
  onClose,
  onBuy,
}: {
  view: GameView
  onClose: () => void
  onBuy: (item: ShopItem) => void
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal shop-modal" role="dialog" aria-modal="true" aria-labelledby="shop-title">
        <header className="modal-header">
          <div>
            <span className="eyebrow">Вольные земли</span>
            <h2 id="shop-title">Лекарь & механик</h2>
            <p>«Пришить не обещаю, но протез поставлю надёжный».</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть лавку">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="shop-balance">
          <Coins aria-hidden="true" />
          <span>Ваш кошель</span>
          <strong>{view.gold}</strong>
        </div>
        <div className="shop-grid">
          {SHOP_ITEMS.map((item) => {
            const level = item.upgrade ? view.upgrades[item.upgrade] : 0
            const maxed = Boolean(item.upgrade && level >= (item.maxLevel ?? 0))
            const price = getShopItemPrice(item, view.upgrades)
            const nextState =
              !item.upgrade
                ? null
                : maxed
                  ? `Уровень ${level}/${item.maxLevel} • предел достигнут`
                  : item.upgrade === 'blade'
                    ? `Уровень ${level}/${item.maxLevel} • урон ${view.damage} → ${view.damage + 8}`
                    : item.upgrade === 'vitality'
                      ? `Уровень ${level}/${item.maxLevel} • здоровье ${view.maxHealth} → ${view.maxHealth + MAX_HEALTH_PER_LEVEL}`
                      : `Уровень ${level}/${item.maxLevel} • выносливость ${view.maxStamina} → ${view.maxStamina + MAX_STAMINA_PER_LEVEL}`
            return (
              <article className="shop-item" key={item.id}>
                <div className="shop-item-icon">
                  {item.id === 'medicine' || item.id === 'vitality' ? (
                    <Heart aria-hidden="true" />
                  ) : item.id === 'blade' ? (
                    <Sword aria-hidden="true" />
                  ) : item.id === 'eye' ? (
                    <Eye aria-hidden="true" />
                  ) : item.id === 'arm' ? (
                    <Hand aria-hidden="true" />
                  ) : (
                    <Footprints aria-hidden="true" />
                  )}
                </div>
                <div>
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                  {nextState ? <span className="shop-level">{nextState}</span> : null}
                </div>
                <button
                  className="buy-button"
                  type="button"
                  disabled={maxed || view.gold < price}
                  onClick={() => onBuy(item)}
                >
                  {maxed ? null : <Coins aria-hidden="true" />}
                  {maxed ? 'Макс.' : price}
                </button>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function PauseModal({
  view,
  sfxVolume,
  dynamicDayNight,
  weatherEnabled,
  bloomEnabled,
  inkOutlinesEnabled,
  foliageQuality,
  screenShakeEnabled,
  onResume,
  onSave,
  onMenu,
  onAchievements,
  onToggleDynamicDayNight,
  onToggleWeather,
  onToggleBloom,
  onToggleInkOutlines,
  onCycleFoliageQuality,
  onToggleScreenShake,
  onSfxVolumeChange,
}: {
  view: GameView
  sfxVolume: number
  dynamicDayNight: boolean
  weatherEnabled: boolean
  bloomEnabled: boolean
  inkOutlinesEnabled: boolean
  foliageQuality: FoliageQuality
  screenShakeEnabled: boolean
  onResume: () => void
  onSave: () => void
  onMenu: () => void
  onAchievements: () => void
  onToggleDynamicDayNight: () => void
  onToggleWeather: () => void
  onToggleBloom: () => void
  onToggleInkOutlines: () => void
  onCycleFoliageQuality: () => void
  onToggleScreenShake: () => void
  onSfxVolumeChange: (volume: number) => void
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <div className="pause-symbol">
          <Pause aria-hidden="true" />
        </div>
        <span className="eyebrow">Игра приостановлена</span>
        <h2 id="pause-title">Передышка у костра</h2>
        <p>
          {FACTION_INFO[view.faction].name} • {ZONE_INFO[view.zone].name} • {formatTime(view.elapsed)}
        </p>
        <div className="pause-stats">
          <span>
            <Heart aria-hidden="true" /> {Math.ceil(view.health)}
          </span>
          <span>
            <Coins aria-hidden="true" /> {view.gold}
          </span>
          <span>
            <Sword aria-hidden="true" /> {view.kills}
          </span>
        </div>
        <button
          className="secondary-button pause-setting day-night-setting"
          type="button"
          onClick={onToggleDynamicDayNight}
          aria-pressed={dynamicDayNight}
        >
          <Clock3 aria-hidden="true" />
          <span>Динамическое время суток</span>
          <strong>{dynamicDayNight ? 'Вкл.' : 'Выкл.'}</strong>
        </button>
        <button
          className="secondary-button pause-setting weather-setting"
          type="button"
          onClick={onToggleWeather}
          aria-pressed={weatherEnabled}
        >
          <CloudRain aria-hidden="true" />
          <span>Динамическая погода</span>
          <strong>{weatherEnabled ? 'Вкл.' : 'Выкл.'}</strong>
        </button>
        <button
          className="secondary-button pause-setting bloom-setting"
          type="button"
          onClick={onToggleBloom}
          aria-pressed={bloomEnabled}
        >
          <Sparkles aria-hidden="true" />
          <span>Свечение (bloom)</span>
          <strong>{bloomEnabled ? 'Вкл.' : 'Выкл.'}</strong>
        </button>
        <button
          className="secondary-button pause-setting ink-outlines-setting"
          type="button"
          onClick={onToggleInkOutlines}
          aria-pressed={inkOutlinesEnabled}
        >
          <Eye aria-hidden="true" />
          <span>Чернильные контуры</span>
          <strong>{inkOutlinesEnabled ? 'Вкл.' : 'Выкл.'}</strong>
        </button>
        <button
          className="secondary-button pause-setting foliage-setting"
          type="button"
          onClick={onCycleFoliageQuality}
          data-quality={foliageQuality}
          aria-label={`Качество растительности: ${foliageQualityLabels[foliageQuality]}`}
        >
          <Trees aria-hidden="true" />
          <span>Растительность</span>
          <strong>{foliageQualityLabels[foliageQuality]}</strong>
        </button>
        <button
          className="secondary-button pause-setting screen-shake-setting"
          type="button"
          onClick={onToggleScreenShake}
          aria-pressed={screenShakeEnabled}
        >
          <Vibrate aria-hidden="true" />
          <span>Эффекты камеры</span>
          <strong>{screenShakeEnabled ? 'Вкл.' : 'Выкл.'}</strong>
        </button>
        <label className="pause-setting sfx-volume-control">
          <Volume2 aria-hidden="true" />
          <span>Громкость эффектов</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={sfxVolume}
            onChange={(event) => onSfxVolumeChange(Number(event.currentTarget.value))}
            aria-label="Громкость эффектов"
          />
          <strong>{Math.round(sfxVolume * 100)}%</strong>
        </label>
        <div className="pause-actions">
          <button className="primary-button" type="button" onClick={onResume}>
            <Play aria-hidden="true" />
            Продолжить
          </button>
          <button className="secondary-button" type="button" onClick={onAchievements}>
            <Trophy aria-hidden="true" />
            Достижения
          </button>
          <button className="secondary-button" type="button" onClick={onSave}>
            <Save aria-hidden="true" />
            Сохранить
          </button>
          <button className="text-button" type="button" onClick={onMenu}>
            <Home aria-hidden="true" />
            В главное меню
          </button>
        </div>
      </section>
    </div>
  )
}

function EndModal({
  result,
  view,
  generated,
  terminalRun,
  runAchievements,
  onRetryFinalization,
  onRestart,
  onMenu,
}: {
  result: 'victory' | 'defeat'
  view: GameView
  generated: boolean
  terminalRun: TerminalRunSummary | null
  runAchievements: AchievementView[]
  onRetryFinalization: () => void
  onRestart: () => void
  onMenu: () => void
}) {
  const profileReward =
    terminalRun?.summary?.profileCurrencyEarned ?? terminalRun?.rewardGranted ?? 0
  const eyebrow = generated
    ? result === 'victory'
      ? 'Сгенерированный забег пройден'
      : 'Сгенерированный забег завершён'
    : result === 'victory'
      ? 'Кампания завершена'
      : 'Путешествие окончено'
  const title =
    result === 'victory'
      ? 'Корованы ваши'
      : generated
        ? 'Этот мир вас пережил'
        : 'Вы пали в бою'
  const description =
    result === 'victory'
      ? 'Все задачи выполнены. Летописцы уже преувеличивают ваши подвиги.'
      : generated
        ? 'Павший забег закрыт и записан в историю. Следующая попытка начнётся в новом мире.'
        : 'Загрузите legacy-сохранение или попробуйте ещё раз — желательно с целыми ногами.'

  return (
    <div className="modal-backdrop end-backdrop" role="presentation">
      <section className={`modal end-modal ${result}`} role="dialog" aria-modal="true">
        <div className="end-icon">
          {result === 'victory' ? <Flag aria-hidden="true" /> : <Skull aria-hidden="true" />}
        </div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
        <div className="end-score">
          <span>
            <Clock3 aria-hidden="true" />
            <strong>{formatTime(view.elapsed)}</strong>
            время
          </span>
          <span>
            <Sword aria-hidden="true" />
            <strong>{view.kills}</strong>
            побед
          </span>
          <span>
            <Coins aria-hidden="true" />
            <strong>{view.gold}</strong>
            золота
          </span>
        </div>
        {generated && terminalRun && !terminalRun.finalizationPending ? (
          <div className="terminal-reward" aria-label={`Получено ${profileReward} валюты профиля`}>
            <span className="terminal-reward-icon">
              <Coins aria-hidden="true" />
            </span>
            <div>
              <span>Награда профиля</span>
              <strong>+{profileReward}</strong>
              <small>Новый баланс: {terminalRun.profileCurrency}</small>
            </div>
          </div>
        ) : null}
        {generated && terminalRun?.finalizationPending ? (
          <div className="terminal-finalization-warning" role="alert">
            <span>Итог забега пока не записан. Повторите сохранение перед выходом.</span>
            <button className="secondary-button" type="button" onClick={onRetryFinalization}>
              <Save aria-hidden="true" />
              Повторить сохранение
            </button>
          </div>
        ) : null}
        {runAchievements.length > 0 ? (
          <div className="end-achievements">
            <span className="eyebrow">Открыто за эту кампанию</span>
            {runAchievements.map((achievement) => (
              <div className={`rarity-${achievement.rarity}`} key={achievement.id}>
                <Trophy aria-hidden="true" />
                <span>{achievement.name}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="pause-actions">
          <button className="primary-button" type="button" onClick={onRestart}>
            <RotateCcw aria-hidden="true" />
            {generated ? 'Новый мир' : 'Сыграть снова'}
          </button>
          <button className="text-button" type="button" onClick={onMenu}>
            <Home aria-hidden="true" />
            Главное меню
          </button>
        </div>
      </section>
    </div>
  )
}

function GameScreen({
  view,
  worldRef,
  notices,
  achievementBanner,
  runAchievements,
  paused,
  simulationPaused,
  shopOpen,
  endResult,
  terminalRun,
  onResume,
  onPause,
  onSave,
  onAchievements,
  onMenu,
  onBuy,
  onCloseShop,
  onAttack,
  onAbilityDown,
  onAbilityUp,
  onInteract,
  onCommand,
  onPointerLock,
  onInput,
  onRetryFinalization,
  onRestart,
  musicMuted,
  sfxVolume,
  dynamicDayNight,
  weatherEnabled,
  bloomEnabled,
  inkOutlinesEnabled,
  foliageQuality,
  screenShakeEnabled,
  onToggleMusic,
  onSfxVolumeChange,
  onToggleDynamicDayNight,
  onToggleWeather,
  onToggleBloom,
  onToggleInkOutlines,
  onCycleFoliageQuality,
  onToggleScreenShake,
}: {
  view: GameView
  worldRef: React.RefObject<HTMLDivElement | null>
  notices: Notice[]
  achievementBanner: AchievementUnlock | null
  runAchievements: AchievementView[]
  paused: boolean
  simulationPaused: boolean
  shopOpen: boolean
  endResult: 'victory' | 'defeat' | null
  terminalRun: TerminalRunSummary | null
  onResume: () => void
  onPause: () => void
  onSave: () => void
  onAchievements: () => void
  onMenu: () => void
  onBuy: (item: ShopItem) => void
  onCloseShop: () => void
  onAttack: () => void
  onAbilityDown: () => void
  onAbilityUp: () => void
  onInteract: () => void
  onCommand: () => void
  onPointerLock: () => void
  onInput: (code: string, active: boolean) => void
  onRetryFinalization: () => void
  onRestart: () => void
  musicMuted: boolean
  sfxVolume: number
  dynamicDayNight: boolean
  weatherEnabled: boolean
  bloomEnabled: boolean
  inkOutlinesEnabled: boolean
  foliageQuality: FoliageQuality
  screenShakeEnabled: boolean
  onToggleMusic: () => void
  onSfxVolumeChange: (volume: number) => void
  onToggleDynamicDayNight: () => void
  onToggleWeather: () => void
  onToggleBloom: () => void
  onToggleInkOutlines: () => void
  onCycleFoliageQuality: () => void
  onToggleScreenShake: () => void
}) {
  const [controlsDismissed, setControlsDismissed] = useState(false)
  const info = FACTION_INFO[view.faction]
  const zoneInfo = ZONE_INFO[view.zone]
  const eyeLoss =
    view.body.leftEye === 'missing' ? 'left' : view.body.rightEye === 'missing' ? 'right' : null
  const healthPercent = `${(view.health / view.maxHealth) * 100}%`
  const lowHealth = view.health > 0 && view.health / view.maxHealth <= 0.25
  const staminaPercent = `${(view.stamina / view.maxStamina) * 100}%`
  const abilityProgress = `${
    view.ability.cooldownMax > 0
      ? Math.max(
          0,
          Math.min(
            100,
            (1 - view.ability.cooldown / view.ability.cooldownMax) * 100,
          ),
        )
      : 100
  }%`
  const abilityStatus = view.ability.active
    ? 'Удерживается'
    : view.ability.ready
      ? 'Готово'
      : view.ability.cooldown > 0
        ? `${view.ability.cooldown.toFixed(1)} с`
        : 'Недоступно'

  useEffect(() => {
    let hideTimer: number | undefined
    const dismissAfterMovement = (event: KeyboardEvent) => {
      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        return
      }
      window.removeEventListener('keydown', dismissAfterMovement)
      hideTimer = window.setTimeout(() => setControlsDismissed(true), 1800)
    }
    window.addEventListener('keydown', dismissAfterMovement)
    return () => {
      window.removeEventListener('keydown', dismissAfterMovement)
      if (hideTimer !== undefined) window.clearTimeout(hideTimer)
    }
  }, [])

  const touchHold = (code: string) => ({
    onPointerDown: () => onInput(code, true),
    onPointerUp: () => onInput(code, false),
    onPointerCancel: () => onInput(code, false),
    onPointerLeave: () => onInput(code, false),
  })

  return (
    <main
      className={`game-screen faction-${view.faction}${lowHealth ? ' low-health' : ''}${simulationPaused ? ' simulation-paused' : ''}`}
      data-zone={view.zone}
      style={{ '--zone-accent': zoneInfo.accent } as CSSProperties}
    >
      <div className="world-stage" ref={worldRef} />
      <div className="screen-vignette" aria-hidden="true" />
      <div className="low-health-vignette" aria-hidden="true" />
      <div
        className="damage-vignette"
        style={{ opacity: view.damageFlash }}
        aria-hidden="true"
      />
      {eyeLoss ? <div className={`vision-loss ${eyeLoss}`} aria-label="Потеря части обзора" /> : null}

      <div className="top-hud">
        <div className="identity-panel hud-card">
          <div className="identity-icon">
            <FactionEmblem faction={view.faction} />
          </div>
          <div className="zone-title" key={view.zone}>
            <span
              className="zone-motif"
              data-motif={zoneInfo.motif}
              aria-hidden="true"
            />
            <div>
              <span className="eyebrow">{info.shortName}</span>
              <h1>{zoneInfo.name}</h1>
              <p>{zoneInfo.subtitle}</p>
            </div>
          </div>
          <div className={`threat-chip tier-${view.threatTier}`}>
            <Shield aria-hidden="true" />
            <span>Угроза</span>
            <strong>
              {view.threatTier}/{MAX_THREAT_TIER}
            </strong>
          </div>
          <div className="hud-actions">
            <button
              className={`icon-button hud-music ${musicMuted ? 'muted' : 'playing'}`}
              type="button"
              onClick={onToggleMusic}
              aria-label={musicMuted ? 'Включить музыку' : 'Выключить музыку'}
              title={musicMuted ? 'Включить 8-битную музыку' : 'Выключить 8-битную музыку'}
            >
              {musicMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
            </button>
            <button className="icon-button hud-pause" type="button" onClick={onPause} aria-label="Пауза">
              <Pause aria-hidden="true" />
            </button>
          </div>
        </div>
        <MiniMap view={view} />
      </div>

      <div className="left-hud">
        <div className="vitals hud-card">
          <div className="vital-row">
            <Heart aria-hidden="true" />
            <span>Здоровье</span>
            <strong>
              {Math.ceil(view.health)}/{view.maxHealth}
            </strong>
          </div>
          <div className="meter health">
            <i style={{ width: healthPercent }} />
          </div>
          <div className="vital-row compact">
            <Footprints aria-hidden="true" />
            <span>Выносливость</span>
            <strong>
              {Math.ceil(view.stamina)}/{view.maxStamina}
            </strong>
          </div>
          <div className="meter stamina">
            <i style={{ width: staminaPercent }} />
          </div>
          <div className="stat-strip">
            <span>
              <Coins aria-hidden="true" /> {view.gold}
            </span>
            <span>
              <Sword aria-hidden="true" /> {view.damage}
            </span>
            <span>
              <UserRound aria-hidden="true" /> {view.squad}
            </span>
            <span>
              <Clock3 aria-hidden="true" /> {formatTime(view.elapsed)}
            </span>
          </div>
        </div>
        <div
          className={`ability-chip hud-card ${view.ability.ready ? 'ready' : ''} ${view.ability.active ? 'active' : ''}`}
        >
          <div className="ability-icon">{abilityIcons[view.ability.id]}</div>
          <div className="ability-copy">
            <span>Способность</span>
            <strong>{view.ability.name}</strong>
            <small>{abilityStatus}</small>
          </div>
          <div className="meter ability-meter" aria-hidden="true">
            <i style={{ width: abilityProgress }} />
          </div>
        </div>
        <CampaignBanner view={view} />
        <ObjectiveList view={view} />
        <EventBanner event={view.activeEvent} />
      </div>

      <div className="notice-stack" aria-live="polite">
        {notices.map((notice) => (
          <div className={`notice ${notice.tone}`} key={notice.id}>
            {notice.tone === 'success' ? (
              <Check aria-hidden="true" />
            ) : notice.tone === 'danger' ? (
              <Skull aria-hidden="true" />
            ) : notice.tone === 'warning' ? (
              <Shield aria-hidden="true" />
            ) : (
              <Sparkles aria-hidden="true" />
            )}
            <span>{notice.message}</span>
          </div>
        ))}
      </div>
      <LootToast toast={view.lootToast} />
      <AchievementBanner achievement={achievementBanner} />

      <div className="crosshair" aria-hidden="true">
        <span />
      </div>

      {!view.pointerLocked && !paused && !shopOpen && !endResult ? (
        <button className="capture-prompt" type="button" onClick={onPointerLock}>
          <MousePointer2 aria-hidden="true" />
          Нажмите, чтобы управлять камерой
        </button>
      ) : null}

      {view.prompt ? <div className="action-prompt">{view.prompt}</div> : null}

      <div className="bottom-hud">
        <BodyPanel view={view} />
        <div
          className={`control-ribbon ${controlsDismissed ? 'dismissed' : ''}`}
          aria-hidden={controlsDismissed}
        >
          <span>
            <kbd>WASD</kbd> идти
          </span>
          <span>
            <kbd>Shift</kbd> бег
          </span>
          <span>
            <kbd>Space</kbd> прыгнуть
          </span>
          <span>
            <kbd>ЛКМ</kbd> удар
          </span>
          <span>
            <kbd>ПКМ/R</kbd> {view.ability.name}
          </span>
          <span>
            <kbd>E</kbd> действие
          </span>
          <span>
            <kbd>Q</kbd> приказ
          </span>
          <span>
            <kbd>F</kbd> сохранить
          </span>
        </div>
      </div>

      <div className="touch-controls">
        <div className="touch-move">
          <button type="button" aria-label="Вперёд" {...touchHold('KeyW')}>
            ▲
          </button>
          <button type="button" aria-label="Влево" {...touchHold('KeyA')}>
            ◀
          </button>
          <button type="button" aria-label="Назад" {...touchHold('KeyS')}>
            ▼
          </button>
          <button type="button" aria-label="Вправо" {...touchHold('KeyD')}>
            ▶
          </button>
        </div>
        <div className="touch-actions">
          <button type="button" onClick={onAttack} aria-label="Удар">
            <Sword aria-hidden="true" />
          </button>
          <button
            className={view.ability.active ? 'active' : undefined}
            type="button"
            onPointerDown={(event) => {
              event.preventDefault()
              try {
                event.currentTarget.setPointerCapture(event.pointerId)
              } catch (error) {
                if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
              }
              onAbilityDown()
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
              onAbilityUp()
            }}
            onPointerCancel={onAbilityUp}
            onPointerLeave={onAbilityUp}
            onClick={(event) => {
              if (event.detail !== 0) return
              if (view.ability.active) onAbilityUp()
              else onAbilityDown()
            }}
            aria-label={view.ability.name}
          >
            {abilityIcons[view.ability.id]}
          </button>
          <button type="button" onClick={onInteract} aria-label="Действие">
            E
          </button>
          <button type="button" onClick={onCommand} aria-label="Приказ">
            Q
          </button>
          <button
            type="button"
            onClick={() => {
              onInput('Space', true)
              window.setTimeout(() => onInput('Space', false), 120)
            }}
            aria-label="Прыжок"
          >
            ↑
          </button>
        </div>
      </div>

      {shopOpen ? <ShopModal view={view} onClose={onCloseShop} onBuy={onBuy} /> : null}
      {paused && !shopOpen && !endResult ? (
        <PauseModal
          view={view}
          sfxVolume={sfxVolume}
          dynamicDayNight={dynamicDayNight}
          weatherEnabled={weatherEnabled}
          bloomEnabled={bloomEnabled}
          inkOutlinesEnabled={inkOutlinesEnabled}
          foliageQuality={foliageQuality}
          screenShakeEnabled={screenShakeEnabled}
          onResume={onResume}
          onSave={onSave}
          onMenu={onMenu}
          onAchievements={onAchievements}
          onToggleDynamicDayNight={onToggleDynamicDayNight}
          onToggleWeather={onToggleWeather}
          onToggleBloom={onToggleBloom}
          onToggleInkOutlines={onToggleInkOutlines}
          onCycleFoliageQuality={onCycleFoliageQuality}
          onToggleScreenShake={onToggleScreenShake}
          onSfxVolumeChange={onSfxVolumeChange}
        />
      ) : null}
      {endResult ? (
        <EndModal
          result={endResult}
          view={view}
          generated={view.worldMap.mode === 'generated'}
          terminalRun={terminalRun}
          runAchievements={runAchievements}
          onRetryFinalization={onRetryFinalization}
          onRestart={onRestart}
          onMenu={onMenu}
        />
      ) : null}
    </main>
  )
}

function App() {
  const [screen, setScreen] = useState<'menu' | 'game'>('menu')
  const [profile, setProfile] = useState<ProfileSaveV1>(() => readPlayerProfile())
  const [activeRun, setActiveRun] = useState<ActiveRunSaveV2 | null>(() =>
    readActiveGeneratedRun(),
  )
  const [activeRunError, setActiveRunError] = useState<string | null>(null)
  const [faction, setFaction] = useState<Faction>('elf')
  const [pendingSave, setPendingSave] = useState<SavedGame | undefined>()
  const [pendingGeneratedLaunch, setPendingGeneratedLaunch] =
    useState<GeneratedRunLaunch | null>(null)
  const [savedGame, setSavedGame] = useState<SavedGame | null>(() => readSavedGame())
  const [seedInput, setSeedInput] = useState(() => String(createRandomSeed()))
  const [gameView, setGameView] = useState<GameView | null>(null)
  const [notices, setNotices] = useState<Notice[]>([])
  const [achievementCatalogue, setAchievementCatalogue] = useState<AchievementView[]>(() =>
    readAchievementCatalogue(),
  )
  const [achievementQueue, setAchievementQueue] = useState<AchievementUnlock[]>([])
  const [runAchievements, setRunAchievements] = useState<AchievementView[]>([])
  const [achievementsOpen, setAchievementsOpen] = useState(false)
  const [paused, setPaused] = useState(false)
  const [shopOpen, setShopOpen] = useState(false)
  const [endResult, setEndResult] = useState<'victory' | 'defeat' | null>(null)
  const [terminalRun, setTerminalRun] = useState<TerminalRunSummary | null>(null)
  const [pendingTerminalSnapshot, setPendingTerminalSnapshot] =
    useState<ActiveRunSaveV2 | null>(null)
  const [musicMuted, setMusicMuted] = useState(() => readMusicMuted())
  const [sfxVolume, setSfxVolume] = useState(() => readSfxVolume())
  const [bloomEnabled, setBloomEnabled] = useState(() => readBloomEnabled())
  const [inkOutlinesEnabled, setInkOutlinesEnabled] = useState(() => readInkOutlinesEnabled())
  const [foliageQuality, setFoliageQuality] = useState(() => readFoliageQuality())
  const [screenShakeEnabled, setScreenShakeEnabled] = useState(() => readScreenShakeEnabled())
  const [theme, setTheme] = useState<Theme>(() => readTheme())
  const [dynamicDayNight, setDynamicDayNight] = useState(() => readDynamicDayNight())
  const [weatherEnabled, setWeatherEnabled] = useState(() => readWeatherEnabled())
  const [runId, setRunId] = useState(0)
  const [achievementSessionId] = useState(() => crypto.randomUUID())
  const worldRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<GameEngine | null>(null)
  const achievementsOpenRef = useRef(false)
  const noticeCounter = useRef(0)
  const musicMutedRef = useRef(musicMuted)
  const sfxVolumeRef = useRef(sfxVolume)
  const dynamicDayNightRef = useRef(dynamicDayNight)
  const weatherEnabledRef = useRef(weatherEnabled)
  const bloomEnabledRef = useRef(bloomEnabled)
  const inkOutlinesEnabledRef = useRef(inkOutlinesEnabled)
  const foliageQualityRef = useRef(foliageQuality)
  const screenShakeEnabledRef = useRef(screenShakeEnabled)
  const lastGeneratedRegionRef = useRef<{
    runId: string
    regionId: string
  } | null>(null)
  const achievementSummary = useMemo(
    () => summarizeAchievements(achievementCatalogue),
    [achievementCatalogue],
  )
  const canonicalSeed = useMemo(() => parseSeed(seedInput), [seedInput])

  const addNotice = useMemo(
    () => (message: string, tone: Notice['tone'] = 'info') => {
      const id = ++noticeCounter.current
      setNotices((current) => [...current.slice(-3), { id, message, tone }])
      window.setTimeout(() => {
        setNotices((current) => current.filter((notice) => notice.id !== id))
      }, 4300)
    },
    [],
  )

  const checkpointGeneratedRun = useCallback(
    (
      engine: GameEngine | null = engineRef.current,
      announce = false,
    ): ActiveRunSaveV2 | null => {
      if (!engine) return null
      let snapshot: ActiveRunSaveV2 | null
      try {
        snapshot = engine.saveGeneratedRun()
      } catch (error) {
        console.warn('Korovany: generated run checkpoint could not be created.', error)
        if (announce) addNotice('Не удалось создать контрольную точку.', 'warning')
        return null
      }
      if (!snapshot || snapshot.status !== 'active') return null
      if (!writeActiveGeneratedRun(snapshot)) {
        if (announce) addNotice('Не удалось сохранить контрольную точку.', 'warning')
        return null
      }
      setActiveRun(snapshot)
      if (announce) addNotice('Контрольная точка забега сохранена.', 'success')
      return snapshot
    },
    [addNotice],
  )

  const recordTerminalRun = useCallback(
    (snapshot: ActiveRunSaveV2): boolean => {
      const finalized = finalizeGeneratedRunSnapshot(snapshot)
      const refreshedProfile = finalized?.profile ?? readPlayerProfile()
      const finalizedSafely =
        finalized?.outcome === 'finalized' ||
        finalized?.outcome === 'already-finalized'
      setProfile(refreshedProfile)
      setTerminalRun({
        runId: snapshot.runId,
        rewardGranted: finalized?.rewardGranted ?? 0,
        summary: finalized?.summary ?? null,
        profileCurrency: refreshedProfile.profileCurrency,
        finalizationPending: !finalizedSafely,
      })
      setActiveRun(null)
      if (finalizedSafely) {
        setPendingTerminalSnapshot(null)
      } else {
        setPendingTerminalSnapshot(snapshot)
        addNotice(
          'Не удалось записать итог забега. Повторите сохранение перед выходом.',
          'warning',
        )
      }
      return finalizedSafely
    },
    [addNotice],
  )

  const openAchievements = () => {
    achievementsOpenRef.current = true
    if (screen === 'game') setPaused(true)
    setAchievementCatalogue(
      engineRef.current?.getAchievements() ?? readAchievementCatalogue(),
    )
    setAchievementsOpen(true)
  }

  const closeAchievements = () => {
    achievementsOpenRef.current = false
    setAchievementsOpen(false)
  }

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch (error) {
      console.warn('Korovany: theme preference could not be saved.', error)
    }
  }, [theme])

  useEffect(() => {
    if (achievementQueue.length === 0) return
    const timer = window.setTimeout(() => {
      setAchievementQueue((current) => current.slice(1))
    }, 9000)
    return () => window.clearTimeout(timer)
  }, [achievementQueue])

  useEffect(() => {
    if (screen !== 'game' || !worldRef.current) return
    const launch = pendingGeneratedLaunch
    let engine: GameEngine
    try {
      engine = new GameEngine(
        worldRef.current,
        faction,
        {
        onView: setGameView,
        onNotice: addNotice,
        onShop: () => setShopOpen(true),
        onPauseRequest: () => {
          if (!achievementsOpenRef.current) setPaused((current) => !current)
        },
        onSaveRequest: () => {
          const currentEngine = engineRef.current
          if (launch) {
            checkpointGeneratedRun(currentEngine, true)
            return
          }
          const save = currentEngine?.save()
          if (save) setSavedGame(save)
        },
        onEnd: (result) => {
          const currentEngine = engineRef.current
          if (launch) {
            let terminalSnapshot: ActiveRunSaveV2 | null = null
            try {
              terminalSnapshot = currentEngine?.saveGeneratedRun() ?? null
            } catch (error) {
              console.warn('Korovany: terminal generated run snapshot could not be created.', error)
            }

            if (terminalSnapshot) {
              recordTerminalRun(terminalSnapshot)
            } else {
              const refreshedProfile = readPlayerProfile()
              setProfile(refreshedProfile)
              setActiveRun(null)
              setTerminalRun({
                runId: launch.runId,
                rewardGranted: 0,
                summary: null,
                profileCurrency: refreshedProfile.profileCurrency,
                finalizationPending: true,
              })
              addNotice(
                'Не удалось создать итоговый снимок забега. Повторите сохранение.',
                'warning',
              )
            }
          } else if (result === 'victory') {
            try {
              localStorage.removeItem(SAVE_KEY)
              setSavedGame(null)
            } catch (error) {
              console.warn('Korovany: completed campaign save could not be removed.', error)
            }
          }
          setEndResult(result)
          setRunAchievements(currentEngine?.getCurrentRunAchievements() ?? [])
        },
        onAchievementUnlocked: (achievement) => {
          setAchievementQueue((current) => [...current, achievement])
          setAchievementCatalogue(
            engineRef.current?.getAchievements() ?? readAchievementCatalogue(),
          )
        },
        },
        launch ? undefined : pendingSave,
        {
          musicMuted: musicMutedRef.current,
          sfxVolume: sfxVolumeRef.current,
          dynamicDayNight: dynamicDayNightRef.current,
          weatherEnabled: weatherEnabledRef.current,
          bloomEnabled: bloomEnabledRef.current,
          inkOutlinesEnabled: inkOutlinesEnabledRef.current,
          foliageQuality: foliageQualityRef.current,
          screenShakeEnabled: screenShakeEnabledRef.current,
          achievementRunId: `${achievementSessionId}:${runId}`,
          ...(launch ? { generatedRun: launch } : {}),
        },
      )
    } catch (error) {
      console.error('Korovany: game engine could not start.', error)
      if (launch) {
        const reason =
          error instanceof Error ? error.message : 'неизвестная ошибка совместимости'
        setActiveRunError(`Не удалось продолжить забег: ${reason}`)
        setActiveRun(readActiveGeneratedRun())
      }
      setGameView(null)
      setPendingSave(undefined)
      setPendingGeneratedLaunch(null)
      setPaused(false)
      setScreen('menu')
      return
    }
    engineRef.current = engine
    setAchievementCatalogue(engine.getAchievements())
    setRunAchievements(engine.getCurrentRunAchievements())
    engine.start()
    if (launch && !launch.restored) checkpointGeneratedRun(engine)
    addNotice(
      launch?.restored
        ? `Забег seed ${launch.config.seed} продолжен.`
        : launch
          ? `Мир seed ${launch.config.seed} собран.`
          : pendingSave
            ? 'Legacy-сохранение загружено.'
            : `${FACTION_INFO[faction].name}: legacy-кампания началась.`,
      'success',
    )
    return () => {
      try {
        engine.destroy()
      } catch (error) {
        console.error('Korovany: game engine cleanup was incomplete.', error)
      }
      if (engineRef.current === engine) engineRef.current = null
    }
  }, [
    achievementSessionId,
    addNotice,
    checkpointGeneratedRun,
    faction,
    pendingGeneratedLaunch,
    pendingSave,
    recordTerminalRun,
    runId,
    screen,
  ])

  const retryTerminalFinalization = (): boolean => {
    let snapshot = pendingTerminalSnapshot
    if (!snapshot) {
      try {
        snapshot = engineRef.current?.saveGeneratedRun() ?? null
      } catch (error) {
        console.warn('Korovany: terminal generated run retry failed.', error)
      }
    }
    if (!snapshot) {
      addNotice('Не удалось создать итоговый снимок забега.', 'warning')
      return false
    }
    const finalized = recordTerminalRun(snapshot)
    if (finalized) addNotice('Итог забега сохранён.', 'success')
    return finalized
  }

  useEffect(() => {
    engineRef.current?.setPaused(
      paused || shopOpen || achievementsOpen || Boolean(endResult),
    )
  }, [paused, shopOpen, achievementsOpen, endResult])

  useEffect(() => {
    const launch = pendingGeneratedLaunch
    const regionId =
      gameView?.worldMap.mode === 'generated'
        ? gameView.worldMap.currentRegionId
        : undefined
    if (screen !== 'game' || !launch || !regionId || endResult) return

    const previous = lastGeneratedRegionRef.current
    if (!previous || previous.runId !== launch.runId) {
      lastGeneratedRegionRef.current = { runId: launch.runId, regionId }
      return
    }
    if (previous.regionId === regionId) return
    lastGeneratedRegionRef.current = { runId: launch.runId, regionId }
    checkpointGeneratedRun()
  }, [
    checkpointGeneratedRun,
    endResult,
    gameView,
    pendingGeneratedLaunch,
    screen,
  ])

  const resetGameUi = () => {
    setNotices([])
    setAchievementQueue([])
    setRunAchievements([])
    achievementsOpenRef.current = false
    setAchievementsOpen(false)
    setPaused(false)
    setShopOpen(false)
    setEndResult(null)
    setTerminalRun(null)
    setPendingTerminalSnapshot(null)
    setRunId((current) => current + 1)
    setScreen('game')
  }

  const startLegacyGame = (selectedFaction: Faction, save?: SavedGame) => {
    engineRef.current?.stopAudio()
    setFaction(selectedFaction)
    setPendingSave(save)
    setPendingGeneratedLaunch(null)
    setGameView(createInitialView(selectedFaction, save))
    lastGeneratedRegionRef.current = null
    resetGameUi()
  }

  const launchGeneratedRun = (launch: GeneratedRunLaunch) => {
    engineRef.current?.stopAudio()
    setActiveRunError(null)
    setFaction(launch.config.faction)
    setPendingSave(undefined)
    setPendingGeneratedLaunch(launch)
    setGameView(createGeneratedInitialView(launch))
    lastGeneratedRegionRef.current = null
    resetGameUi()
  }

  const startGeneratedRun = (
    selectedFaction: Faction,
    seed = canonicalSeed,
    boonId = selectedProfileBoon(profile),
    allowRecoveredTerminalRun = false,
  ) => {
    if (
      activeRun ||
      (terminalRun?.finalizationPending && !allowRecoveredTerminalRun)
    ) {
      return
    }
    const config: RunConfig = {
      seed: parseSeed(seed),
      generatorVersion: WORLD_GENERATOR_VERSION,
      faction: selectedFaction,
      selectedBoonId: boonId,
    }
    const launch: GeneratedRunLaunch = {
      runId: crypto.randomUUID(),
      config,
      startedAt: new Date().toISOString(),
    }
    const nextProfile: ProfileSaveV1 = {
      ...profile,
      selectedFaction,
    }
    if (writePlayerProfile(nextProfile)) setProfile(nextProfile)
    setSeedInput(String(config.seed))
    launchGeneratedRun(launch)
  }

  const continueGeneratedRun = () => {
    if (!activeRun) return
    if (activeRun.config.generatorVersion !== WORLD_GENERATOR_VERSION) {
      setActiveRunError(
        `Версия мира ${activeRun.config.generatorVersion} не поддерживается этой сборкой.`,
      )
      return
    }
    launchGeneratedRun({
      runId: activeRun.runId,
      config: {
        ...activeRun.config,
        ...(activeRun.config.modifiers
          ? { modifiers: [...activeRun.config.modifiers] }
          : {}),
      },
      startedAt: activeRun.startedAt,
      restored: activeRun,
    })
  }

  const returnToMenu = () => {
    if (
      terminalRun?.finalizationPending &&
      !retryTerminalFinalization()
    ) {
      return
    }
    if (
      pendingGeneratedLaunch &&
      !endResult &&
      !checkpointGeneratedRun(engineRef.current, true)
    ) {
      return
    }
    engineRef.current?.stopAudio()
    setScreen('menu')
    setGameView(null)
    setPendingSave(undefined)
    setPendingGeneratedLaunch(null)
    setPaused(false)
    setShopOpen(false)
    setEndResult(null)
    setTerminalRun(null)
    setSavedGame(readSavedGame())
    setActiveRun(readActiveGeneratedRun())
    setProfile(readPlayerProfile())
    setAchievementCatalogue(readAchievementCatalogue())
    achievementsOpenRef.current = false
    setAchievementsOpen(false)
    lastGeneratedRegionRef.current = null
  }

  const saveGame = () => {
    if (pendingGeneratedLaunch) {
      checkpointGeneratedRun(engineRef.current, true)
      return
    }
    const save = engineRef.current?.save()
    if (save) setSavedGame(save)
  }

  const buyItem = (item: ShopItem) => {
    const result = engineRef.current?.purchase(item)
    if (result) addNotice(result.message, result.ok ? 'success' : 'warning')
    if (result?.ok && pendingGeneratedLaunch) checkpointGeneratedRun()
  }

  const toggleMusic = () => {
    const next = !musicMutedRef.current
    musicMutedRef.current = next
    setMusicMuted(next)
    engineRef.current?.setMusicMuted(next)
    try {
      localStorage.setItem(MUSIC_MUTED_KEY, String(next))
    } catch (error) {
      console.warn('Korovany: music preference could not be saved.', error)
    }
    addNotice(next ? '8-битная музыка выключена.' : '8-битная музыка включена.', 'info')
  }

  const changeSfxVolume = (volume: number) => {
    const next = normalizeSfxVolume(volume)
    sfxVolumeRef.current = next
    setSfxVolume(next)
    engineRef.current?.setSfxVolume(next)
    try {
      localStorage.setItem(SFX_VOLUME_KEY, String(next))
    } catch (error) {
      console.warn('Korovany: SFX volume preference could not be saved.', error)
    }
  }

  const toggleDynamicDayNight = () => {
    const next = !dynamicDayNightRef.current
    dynamicDayNightRef.current = next
    setDynamicDayNight(next)
    engineRef.current?.setDynamicDayNight(next)
    try {
      localStorage.setItem(DYNAMIC_DAY_NIGHT_KEY, String(next))
    } catch (error) {
      console.warn('Korovany: dynamic time preference could not be saved.', error)
    }
    addNotice(
      next ? 'Динамическое время суток включено.' : 'Время суток зафиксировано на полдне.',
      'info',
    )
  }

  const toggleBloom = () => {
    const next = !bloomEnabledRef.current
    bloomEnabledRef.current = next
    setBloomEnabled(next)
    engineRef.current?.setBloomEnabled(next)
    try {
      localStorage.setItem(BLOOM_ENABLED_KEY, String(next))
    } catch (error) {
      console.warn('Korovany: bloom preference could not be saved.', error)
    }
  }

  const toggleInkOutlines = () => {
    const next = !inkOutlinesEnabledRef.current
    inkOutlinesEnabledRef.current = next
    setInkOutlinesEnabled(next)
    engineRef.current?.setInkOutlinesEnabled(next)
    try {
      localStorage.setItem(INK_OUTLINES_ENABLED_KEY, String(next))
    } catch (error) {
      console.warn('Korovany: ink-outline preference could not be saved.', error)
    }
    addNotice(
      next ? 'Чернильные контуры включены.' : 'Чернильные контуры выключены.',
      'info',
    )
  }

  const toggleWeather = () => {
    const next = !weatherEnabledRef.current
    weatherEnabledRef.current = next
    setWeatherEnabled(next)
    engineRef.current?.setWeatherEnabled(next)
    try {
      localStorage.setItem(WEATHER_ENABLED_KEY, String(next))
    } catch (error) {
      console.warn('Korovany: weather preference could not be saved.', error)
    }
    addNotice(
      next ? 'Динамическая погода включена.' : 'Динамическая погода выключена.',
      'info',
    )
  }

  const cycleFoliageQuality = () => {
    const next = nextFoliageQuality(foliageQualityRef.current)
    foliageQualityRef.current = next
    setFoliageQuality(next)
    engineRef.current?.setFoliageQuality(next)
    try {
      localStorage.setItem(FOLIAGE_QUALITY_KEY, next)
    } catch (error) {
      console.warn('Korovany: foliage preference could not be saved.', error)
    }
  }

  const toggleScreenShake = () => {
    const next = !screenShakeEnabledRef.current
    screenShakeEnabledRef.current = next
    setScreenShakeEnabled(next)
    engineRef.current?.setScreenShakeEnabled(next)
    try {
      localStorage.setItem(SCREEN_SHAKE_ENABLED_KEY, String(next))
    } catch (error) {
      console.warn('Korovany: screen-shake preference could not be saved.', error)
    }
  }

  const selectBoon = (boonId: string) => {
    const nextProfile = selectProfileBoon(profile, boonId)
    if (nextProfile && writePlayerProfile(nextProfile)) setProfile(nextProfile)
  }

  const unlockProfileBoon = (boonId: string) => {
    const result = unlockBoon(profile, boonId)
    if (result.status === 'unlocked' && writePlayerProfile(result.profile)) {
      setProfile(result.profile)
    }
  }

  const abandonGeneratedRun = () => {
    if (!activeRun) return
    const finalized = finalizeGeneratedRunSnapshot({
      ...activeRun,
      status: 'abandoned',
      updatedAt: new Date().toISOString(),
    })
    if (
      finalized?.outcome === 'finalized' ||
      finalized?.outcome === 'already-finalized'
    ) {
      setProfile(finalized.profile)
      setActiveRun(null)
      setActiveRunError(null)
    }
  }

  const restartGame = () => {
    const recoveredTerminalRun =
      terminalRun?.finalizationPending === true
    if (recoveredTerminalRun && !retryTerminalFinalization()) return
    if (pendingGeneratedLaunch) {
      startGeneratedRun(
        faction,
        createRandomSeed(),
        pendingGeneratedLaunch.config.selectedBoonId,
        recoveredTerminalRun,
      )
      return
    }
    startLegacyGame(faction)
  }

  if (screen === 'menu') {
    return (
      <>
        <MenuScreen
          savedGame={savedGame}
          activeRun={activeRun}
          activeRunError={activeRunError}
          profile={profile}
          seedInput={seedInput}
          canonicalSeed={canonicalSeed}
          achievementSummary={achievementSummary}
          theme={theme}
          dynamicDayNight={dynamicDayNight}
          weatherEnabled={weatherEnabled}
          bloomEnabled={bloomEnabled}
          inkOutlinesEnabled={inkOutlinesEnabled}
          foliageQuality={foliageQuality}
          screenShakeEnabled={screenShakeEnabled}
          sfxVolume={sfxVolume}
          onStart={(selectedFaction) => startGeneratedRun(selectedFaction)}
          onContinueGenerated={continueGeneratedRun}
          onAbandonGenerated={abandonGeneratedRun}
          onLoadLegacy={() => {
            if (savedGame) startLegacyGame(savedGame.faction, savedGame)
          }}
          onSeedInput={setSeedInput}
          onRandomSeed={() => setSeedInput(String(createRandomSeed()))}
          onSelectBoon={selectBoon}
          onUnlockBoon={unlockProfileBoon}
          onAchievements={openAchievements}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          onToggleDynamicDayNight={toggleDynamicDayNight}
          onToggleWeather={toggleWeather}
          onToggleBloom={toggleBloom}
          onToggleInkOutlines={toggleInkOutlines}
          onCycleFoliageQuality={cycleFoliageQuality}
          onToggleScreenShake={toggleScreenShake}
          onSfxVolumeChange={changeSfxVolume}
        />
        {achievementsOpen ? (
          <AchievementGallery
            achievements={achievementCatalogue}
            onClose={closeAchievements}
          />
        ) : null}
      </>
    )
  }

  if (!gameView) {
    return (
      <main className="loading-screen">
        <div className="world-stage" ref={worldRef} />
        <div className="loading-mark">
          <Trees aria-hidden="true" />
        </div>
        <span className="eyebrow">
          {pendingGeneratedLaunch ? 'Сборка сгенерированного мира' : 'Генерация мира'}
        </span>
        <h1>
          {pendingGeneratedLaunch
            ? 'Собираем и подгружаем 25 регионов…'
            : 'Сажаем трёхмерные деревья…'}
        </h1>
      </main>
    )
  }

  return (
    <>
      <GameScreen
        view={gameView}
        worldRef={worldRef}
        notices={notices}
        achievementBanner={achievementQueue[0] ?? null}
        runAchievements={runAchievements}
        paused={paused}
        simulationPaused={
          paused || shopOpen || achievementsOpen || Boolean(endResult)
        }
        shopOpen={shopOpen}
        endResult={endResult}
        terminalRun={terminalRun}
        onResume={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onSave={saveGame}
        onAchievements={openAchievements}
        onMenu={returnToMenu}
        onBuy={buyItem}
        onCloseShop={() => setShopOpen(false)}
        onAttack={() => engineRef.current?.attack()}
        onAbilityDown={() => {
          if (faction === 'guard') engineRef.current?.setShield(true)
          else engineRef.current?.useAbility()
        }}
        onAbilityUp={() => engineRef.current?.setShield(false)}
        onInteract={() => engineRef.current?.interact()}
        onCommand={() => engineRef.current?.commandSquad()}
        onPointerLock={() => engineRef.current?.requestPointerLock()}
        onInput={(code, active) => engineRef.current?.setInput(code, active)}
        onRetryFinalization={retryTerminalFinalization}
        onRestart={restartGame}
        musicMuted={musicMuted}
        sfxVolume={sfxVolume}
        bloomEnabled={bloomEnabled}
        inkOutlinesEnabled={inkOutlinesEnabled}
        weatherEnabled={weatherEnabled}
        foliageQuality={foliageQuality}
        screenShakeEnabled={screenShakeEnabled}
        onToggleMusic={toggleMusic}
        onSfxVolumeChange={changeSfxVolume}
        dynamicDayNight={dynamicDayNight}
        onToggleDynamicDayNight={toggleDynamicDayNight}
        onToggleWeather={toggleWeather}
        onToggleBloom={toggleBloom}
        onToggleInkOutlines={toggleInkOutlines}
        onCycleFoliageQuality={cycleFoliageQuality}
        onToggleScreenShake={toggleScreenShake}
      />
      {achievementsOpen ? (
        <AchievementGallery
          achievements={achievementCatalogue}
          onClose={closeAchievements}
        />
      ) : null}
    </>
  )
}

export default App
