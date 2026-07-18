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
  ShoppingBag,
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
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import './App.css'
import { GameEngine, type FoliageQuality } from './game/GameEngine'
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
  SAVE_KEY,
  SHOP_ITEMS,
  ZONE_INFO,
  type BodyPart,
  type Faction,
  type GameView,
  type PartStatus,
  type SavedGame,
  type ShopItem,
  type WorldEventView,
  createAbilityView,
  createHealthyBody,
  restoreObjectives,
} from './game/types'

interface Notice {
  id: number
  message: string
  tone: 'info' | 'success' | 'warning' | 'danger'
}

type Theme = 'dark' | 'light'

const MUSIC_MUTED_KEY = 'korovany-music-muted'
const THEME_KEY = 'korovany-theme'
const DYNAMIC_DAY_NIGHT_KEY = 'korovany-dynamic-day-night'
const WEATHER_ENABLED_KEY = 'korovany-weather'
const BLOOM_ENABLED_KEY = 'korovany-bloom'
const SCREEN_SHAKE_ENABLED_KEY = 'korovany-screen-shake'
const FOLIAGE_QUALITY_KEY = 'korovany-foliage'

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

const factionIcons: Record<Faction, ReactNode> = {
  elf: <Trees aria-hidden="true" />,
  guard: <Shield aria-hidden="true" />,
  villain: <Skull aria-hidden="true" />,
}

const abilityIcons: Record<GameView['ability']['id'], ReactNode> = {
  bow: <Trees aria-hidden="true" />,
  shield: <Shield aria-hidden="true" />,
  cleave: <Sword aria-hidden="true" />,
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
  const raw = localStorage.getItem(SAVE_KEY)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as SavedGame
    if (value.version !== 1 || !FACTION_INFO[value.faction]) {
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
  return {
    faction,
    health: savedGame?.health ?? 100,
    maxHealth: 100,
    damageFlash: 0,
    stamina,
    gold: savedGame?.gold ?? 55,
    kills: savedGame?.kills ?? 0,
    damage: savedGame?.damage ?? (faction === 'villain' ? 31 : faction === 'guard' ? 28 : 26),
    zone,
    body,
    objectives: restoreObjectives(faction, savedGame?.objectives),
    prompt: '',
    markers: [],
    squad: 0,
    elapsed: savedGame?.elapsed ?? 0,
    pointerLocked: false,
    paused: false,
    caravanCooldown: 0,
    ability: createAbilityView(faction, stamina, body),
    activeEvent: null,
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

function MiniMap({ view }: { view: GameView }) {
  const hasObjectiveMarker = view.markers.some((marker) => marker.kind === 'objective')
  const hasEventMarker = view.markers.some((marker) => marker.kind === 'event')

  return (
    <section className="hud-card minimap-card" aria-label="Карта четырёх зон">
      <header className="hud-card-header">
        <span>
          <MapIcon aria-hidden="true" />
          Карта
        </span>
        <span className="zone-code">4 зоны</span>
      </header>
      <div className="minimap">
        <div className="map-zone neutral">
          <Home aria-hidden="true" />
          <span>Люди</span>
        </div>
        <div className="map-zone palace">
          <Castle aria-hidden="true" />
          <span>Дворец</span>
        </div>
        <div className="map-zone forest">
          <Trees aria-hidden="true" />
          <span>Эльфы</span>
        </div>
        <div className="map-zone fort">
          <Skull aria-hidden="true" />
          <span>Форт</span>
        </div>
        <div className="map-road horizontal" />
        <div className="map-road vertical" />
        {view.markers.map((marker) => (
          <span
            className={`map-marker ${marker.kind}`}
            key={marker.id}
            style={{
              left: `${((marker.x + 80) / 160) * 100}%`,
              top: `${((marker.z + 80) / 160) * 100}%`,
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
            <i className="legend-dot objective" /> сдача добычи
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
  achievementSummary,
  theme,
  dynamicDayNight,
  weatherEnabled,
  bloomEnabled,
  foliageQuality,
  screenShakeEnabled,
  onStart,
  onLoad,
  onAchievements,
  onToggleTheme,
  onToggleDynamicDayNight,
  onToggleWeather,
  onToggleBloom,
  onCycleFoliageQuality,
  onToggleScreenShake,
}: {
  savedGame: SavedGame | null
  achievementSummary: AchievementSummary
  theme: Theme
  dynamicDayNight: boolean
  weatherEnabled: boolean
  bloomEnabled: boolean
  foliageQuality: FoliageQuality
  screenShakeEnabled: boolean
  onStart: (faction: Faction) => void
  onLoad: () => void
  onAchievements: () => void
  onToggleTheme: () => void
  onToggleDynamicDayNight: () => void
  onToggleWeather: () => void
  onToggleBloom: () => void
  onCycleFoliageQuality: () => void
  onToggleScreenShake: () => void
}) {
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
          aria-label={screenShakeEnabled ? 'Отключить тряску экрана' : 'Включить тряску экрана'}
          title={screenShakeEnabled ? 'Отключить тряску экрана' : 'Включить тряску экрана'}
        >
          <Vibrate aria-hidden="true" />
          <span>{screenShakeEnabled ? 'Тряска: вкл.' : 'Тряска: выкл.'}</span>
        </button>
      </div>
      <header className="hero-header">
        <div className="hackathon-tag">
          <Sparkles aria-hidden="true" />
          Хакатонная сборка • 3D-экшон
        </div>
        <h1>КОРОВАНЫ</h1>
        <p className="hero-kicker">Джва года в разработке</p>
        <p className="hero-copy">
          Четыре земли. Три стороны конфликта. Один корован, который совершенно точно можно
          ограбить.
        </p>
        <button className="secondary-button achievement-menu-button" type="button" onClick={onAchievements}>
          <Trophy aria-hidden="true" />
          Достижения {achievementSummary.unlocked}/{achievementSummary.total}
        </button>
      </header>

      <section className="faction-select" aria-labelledby="faction-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Новая кампания</span>
            <h2 id="faction-title">Выберите, за кого нагибать</h2>
          </div>
          <p>Каждая сторона начинает в своей зоне и получает отдельную цепочку задач.</p>
        </div>
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
                <div className="faction-icon">{factionIcons[faction]}</div>
                <span className="faction-subtitle">{info.subtitle}</span>
                <h3>{info.name}</h3>
                <p>{info.description}</p>
                <div className="perk">
                  <Sparkles aria-hidden="true" />
                  <span>{info.perk}</span>
                </div>
                <button className="primary-button" type="button" onClick={() => onStart(faction)}>
                  <Play aria-hidden="true" />
                  Начать
                </button>
              </article>
            )
          })}
        </div>
      </section>

      <section className="menu-lower">
        <div className="world-map-card">
          <div className="map-copy">
            <span className="eyebrow">Открытая карта</span>
            <h2>Четыре зоны без загрузок</h2>
            <p>
              Нейтральная деревня с лекарем, дворец императора, густой эльфийский лес и старый
              форт в горах.
            </p>
            <div className="feature-pills">
              <span>
                <Trees aria-hidden="true" /> LOD-деревья
              </span>
              <span>
                <Sword aria-hidden="true" /> Бои и трупы 3D
              </span>
              <span>
                <ShoppingBag aria-hidden="true" /> Торговля
              </span>
              <span>
                <Save aria-hidden="true" /> Сохранения
              </span>
            </div>
          </div>
          <div className="menu-map" aria-label="Схема мира">
            <div className="menu-zone neutral">
              <Home aria-hidden="true" />
              <strong>Вольные земли</strong>
              <span>люди • лекарь</span>
            </div>
            <div className="menu-zone palace">
              <Castle aria-hidden="true" />
              <strong>Имперский удел</strong>
              <span>дворец • командир</span>
            </div>
            <div className="menu-zone forest">
              <Trees aria-hidden="true" />
              <strong>Чаща Эленвуда</strong>
              <span>лес • деревянные дома</span>
            </div>
            <div className="menu-zone fort">
              <Skull aria-hidden="true" />
              <strong>Чёрный кряж</strong>
              <span>горы • старый форт</span>
            </div>
            <div className="caravan-route">
              <span>КОРОВАН</span>
            </div>
          </div>
        </div>

        {savedGame ? (
          <div className="continue-card">
            <div className="continue-icon">{factionIcons[savedGame.faction]}</div>
            <div className="continue-copy">
              <span className="eyebrow">Последнее сохранение</span>
              <h3>{FACTION_INFO[savedGame.faction].name}</h3>
              <p>
                {formatSaveDate(savedGame.savedAt)} • {savedGame.gold} золота • {savedGame.kills}{' '}
                побед
              </p>
            </div>
            <button className="secondary-button" type="button" onClick={onLoad}>
              <RotateCcw aria-hidden="true" />
              Продолжить
            </button>
          </div>
        ) : (
          <div className="continue-card empty">
            <Save aria-hidden="true" />
            <div>
              <span className="eyebrow">Сохранение</span>
              <h3>Пока пусто</h3>
              <p>Во время игры нажмите F или откройте паузу.</p>
            </div>
          </div>
        )}
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
          {SHOP_ITEMS.map((item) => (
            <article className="shop-item" key={item.id}>
              <div className="shop-item-icon">
                {item.id === 'medicine' ? (
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
              </div>
              <button
                className="buy-button"
                type="button"
                disabled={view.gold < item.price}
                onClick={() => onBuy(item)}
              >
                <Coins aria-hidden="true" />
                {item.price}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function PauseModal({
  view,
  dynamicDayNight,
  weatherEnabled,
  bloomEnabled,
  foliageQuality,
  screenShakeEnabled,
  onResume,
  onSave,
  onMenu,
  onAchievements,
  onToggleDynamicDayNight,
  onToggleWeather,
  onToggleBloom,
  onCycleFoliageQuality,
  onToggleScreenShake,
}: {
  view: GameView
  dynamicDayNight: boolean
  weatherEnabled: boolean
  bloomEnabled: boolean
  foliageQuality: FoliageQuality
  screenShakeEnabled: boolean
  onResume: () => void
  onSave: () => void
  onMenu: () => void
  onAchievements: () => void
  onToggleDynamicDayNight: () => void
  onToggleWeather: () => void
  onToggleBloom: () => void
  onCycleFoliageQuality: () => void
  onToggleScreenShake: () => void
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
          <span>Тряска экрана</span>
          <strong>{screenShakeEnabled ? 'Вкл.' : 'Выкл.'}</strong>
        </button>
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
  runAchievements,
  onRestart,
  onMenu,
}: {
  result: 'victory' | 'defeat'
  view: GameView
  runAchievements: AchievementView[]
  onRestart: () => void
  onMenu: () => void
}) {
  return (
    <div className="modal-backdrop end-backdrop" role="presentation">
      <section className={`modal end-modal ${result}`} role="dialog" aria-modal="true">
        <div className="end-icon">
          {result === 'victory' ? <Flag aria-hidden="true" /> : <Skull aria-hidden="true" />}
        </div>
        <span className="eyebrow">{result === 'victory' ? 'Кампания завершена' : 'Путешествие окончено'}</span>
        <h2>{result === 'victory' ? 'Корованы ваши' : 'Вы пали в бою'}</h2>
        <p>
          {result === 'victory'
            ? 'Все задачи выполнены. Летописцы уже преувеличивают ваши подвиги.'
            : 'Загрузите сохранение или попробуйте ещё раз — желательно с целыми ногами.'}
        </p>
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
            Сыграть снова
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
  shopOpen,
  endResult,
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
  onRestart,
  musicMuted,
  dynamicDayNight,
  weatherEnabled,
  bloomEnabled,
  foliageQuality,
  screenShakeEnabled,
  onToggleMusic,
  onToggleDynamicDayNight,
  onToggleWeather,
  onToggleBloom,
  onCycleFoliageQuality,
  onToggleScreenShake,
}: {
  view: GameView
  worldRef: React.RefObject<HTMLDivElement | null>
  notices: Notice[]
  achievementBanner: AchievementUnlock | null
  runAchievements: AchievementView[]
  paused: boolean
  shopOpen: boolean
  endResult: 'victory' | 'defeat' | null
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
  onRestart: () => void
  musicMuted: boolean
  dynamicDayNight: boolean
  weatherEnabled: boolean
  bloomEnabled: boolean
  foliageQuality: FoliageQuality
  screenShakeEnabled: boolean
  onToggleMusic: () => void
  onToggleDynamicDayNight: () => void
  onToggleWeather: () => void
  onToggleBloom: () => void
  onCycleFoliageQuality: () => void
  onToggleScreenShake: () => void
}) {
  const [controlsDismissed, setControlsDismissed] = useState(false)
  const info = FACTION_INFO[view.faction]
  const eyeLoss =
    view.body.leftEye === 'missing' ? 'left' : view.body.rightEye === 'missing' ? 'right' : null
  const healthPercent = `${(view.health / view.maxHealth) * 100}%`
  const lowHealth = view.health > 0 && view.health / view.maxHealth <= 0.25
  const staminaPercent = `${view.stamina}%`
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
    <main className={`game-screen faction-${view.faction}${lowHealth ? ' low-health' : ''}`}>
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
          <div className="identity-icon">{factionIcons[view.faction]}</div>
          <div>
            <span className="eyebrow">{info.shortName}</span>
            <h1>{ZONE_INFO[view.zone].name}</h1>
            <p>{ZONE_INFO[view.zone].subtitle}</p>
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
            <strong>{Math.ceil(view.health)}</strong>
          </div>
          <div className="meter health">
            <i style={{ width: healthPercent }} />
          </div>
          <div className="vital-row compact">
            <Footprints aria-hidden="true" />
            <span>Выносливость</span>
            <strong>{Math.ceil(view.stamina)}</strong>
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
              event.currentTarget.setPointerCapture(event.pointerId)
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
          dynamicDayNight={dynamicDayNight}
          weatherEnabled={weatherEnabled}
          bloomEnabled={bloomEnabled}
          foliageQuality={foliageQuality}
          screenShakeEnabled={screenShakeEnabled}
          onResume={onResume}
          onSave={onSave}
          onMenu={onMenu}
          onAchievements={onAchievements}
          onToggleDynamicDayNight={onToggleDynamicDayNight}
          onToggleWeather={onToggleWeather}
          onToggleBloom={onToggleBloom}
          onCycleFoliageQuality={onCycleFoliageQuality}
          onToggleScreenShake={onToggleScreenShake}
        />
      ) : null}
      {endResult ? (
        <EndModal
          result={endResult}
          view={view}
          runAchievements={runAchievements}
          onRestart={onRestart}
          onMenu={onMenu}
        />
      ) : null}
    </main>
  )
}

function App() {
  const [screen, setScreen] = useState<'menu' | 'game'>('menu')
  const [faction, setFaction] = useState<Faction>('elf')
  const [pendingSave, setPendingSave] = useState<SavedGame | undefined>()
  const [savedGame, setSavedGame] = useState<SavedGame | null>(() => readSavedGame())
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
  const [musicMuted, setMusicMuted] = useState(() => readMusicMuted())
  const [bloomEnabled, setBloomEnabled] = useState(() => readBloomEnabled())
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
  const dynamicDayNightRef = useRef(dynamicDayNight)
  const weatherEnabledRef = useRef(weatherEnabled)
  const bloomEnabledRef = useRef(bloomEnabled)
  const foliageQualityRef = useRef(foliageQuality)
  const screenShakeEnabledRef = useRef(screenShakeEnabled)
  const achievementSummary = useMemo(
    () => summarizeAchievements(achievementCatalogue),
    [achievementCatalogue],
  )

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
    const engine = new GameEngine(
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
          const save = engineRef.current?.save()
          if (save) setSavedGame(save)
        },
        onEnd: (result) => {
          if (result === 'victory') {
            try {
              localStorage.removeItem(SAVE_KEY)
              setSavedGame(null)
            } catch (error) {
              console.warn('Korovany: completed campaign save could not be removed.', error)
            }
          }
          setEndResult(result)
          setRunAchievements(engineRef.current?.getCurrentRunAchievements() ?? [])
        },
        onAchievementUnlocked: (achievement) => {
          setAchievementQueue((current) => [...current, achievement])
          setAchievementCatalogue(
            engineRef.current?.getAchievements() ?? readAchievementCatalogue(),
          )
        },
      },
      pendingSave,
      {
        musicMuted: musicMutedRef.current,
        dynamicDayNight: dynamicDayNightRef.current,
        weatherEnabled: weatherEnabledRef.current,
        bloomEnabled: bloomEnabledRef.current,
        foliageQuality: foliageQualityRef.current,
        screenShakeEnabled: screenShakeEnabledRef.current,
        achievementRunId: `${achievementSessionId}:${runId}`,
      },
    )
    engineRef.current = engine
    setAchievementCatalogue(engine.getAchievements())
    setRunAchievements(engine.getCurrentRunAchievements())
    engine.start()
    addNotice(
      pendingSave ? 'Сохранение загружено.' : `${FACTION_INFO[faction].name}: кампания началась.`,
      'success',
    )
    return () => {
      engine.destroy()
      if (engineRef.current === engine) engineRef.current = null
    }
  }, [achievementSessionId, addNotice, faction, pendingSave, runId, screen])

  useEffect(() => {
    engineRef.current?.setPaused(
      paused || shopOpen || achievementsOpen || Boolean(endResult),
    )
  }, [paused, shopOpen, achievementsOpen, endResult])

  const startGame = (selectedFaction: Faction, save?: SavedGame) => {
    engineRef.current?.stopAudio()
    setFaction(selectedFaction)
    setPendingSave(save)
    setGameView(createInitialView(selectedFaction, save))
    setNotices([])
    setAchievementQueue([])
    setRunAchievements([])
    achievementsOpenRef.current = false
    setAchievementsOpen(false)
    setPaused(false)
    setShopOpen(false)
    setEndResult(null)
    setRunId((current) => current + 1)
    setScreen('game')
  }

  const returnToMenu = () => {
    engineRef.current?.stopAudio()
    setScreen('menu')
    setGameView(null)
    setPaused(false)
    setShopOpen(false)
    setEndResult(null)
    setSavedGame(readSavedGame())
    setAchievementCatalogue(readAchievementCatalogue())
    achievementsOpenRef.current = false
    setAchievementsOpen(false)
  }

  const saveGame = () => {
    const save = engineRef.current?.save()
    if (save) setSavedGame(save)
  }

  const buyItem = (item: ShopItem) => {
    const result = engineRef.current?.purchase(item)
    if (result) addNotice(result.message, result.ok ? 'success' : 'warning')
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

  if (screen === 'menu') {
    return (
      <>
        <MenuScreen
          savedGame={savedGame}
          achievementSummary={achievementSummary}
          theme={theme}
          dynamicDayNight={dynamicDayNight}
          weatherEnabled={weatherEnabled}
          bloomEnabled={bloomEnabled}
          foliageQuality={foliageQuality}
          screenShakeEnabled={screenShakeEnabled}
          onStart={(selectedFaction) => startGame(selectedFaction)}
          onLoad={() => {
            if (savedGame) startGame(savedGame.faction, savedGame)
          }}
          onAchievements={openAchievements}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          onToggleDynamicDayNight={toggleDynamicDayNight}
          onToggleWeather={toggleWeather}
          onToggleBloom={toggleBloom}
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

  if (!gameView) {
    return (
      <main className="loading-screen">
        <div className="world-stage" ref={worldRef} />
        <div className="loading-mark">
          <Trees aria-hidden="true" />
        </div>
        <span className="eyebrow">Генерация мира</span>
        <h1>Сажаем трёхмерные деревья…</h1>
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
        shopOpen={shopOpen}
        endResult={endResult}
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
        onRestart={() => startGame(faction)}
        musicMuted={musicMuted}
        bloomEnabled={bloomEnabled}
        weatherEnabled={weatherEnabled}
        foliageQuality={foliageQuality}
        screenShakeEnabled={screenShakeEnabled}
        onToggleMusic={toggleMusic}
        dynamicDayNight={dynamicDayNight}
        onToggleDynamicDayNight={toggleDynamicDayNight}
        onToggleWeather={toggleWeather}
        onToggleBloom={toggleBloom}
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
