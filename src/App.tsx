import {
  Bone,
  Castle,
  Check,
  Clock3,
  Coins,
  Eye,
  Flag,
  Footprints,
  Hand,
  Heart,
  Home,
  Map as MapIcon,
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
  Trees,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import './App.css'
import { GameEngine } from './game/GameEngine'
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
  createHealthyBody,
  restoreObjectives,
} from './game/types'

interface Notice {
  id: number
  message: string
  tone: 'info' | 'success' | 'warning' | 'danger'
}

const MUSIC_MUTED_KEY = 'korovany-music-muted'

const factionIcons: Record<Faction, ReactNode> = {
  elf: <Trees aria-hidden="true" />,
  guard: <Shield aria-hidden="true" />,
  villain: <Skull aria-hidden="true" />,
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
  return {
    faction,
    health: savedGame?.health ?? 100,
    maxHealth: 100,
    stamina: savedGame?.stamina ?? 100,
    gold: savedGame?.gold ?? 55,
    kills: savedGame?.kills ?? 0,
    damage: savedGame?.damage ?? (faction === 'villain' ? 31 : faction === 'guard' ? 28 : 26),
    zone,
    body: savedGame ? { ...savedGame.body } : createHealthyBody(),
    objectives: restoreObjectives(faction, savedGame?.objectives),
    prompt: '',
    markers: [],
    squad: 0,
    elapsed: savedGame?.elapsed ?? 0,
    pointerLocked: false,
    paused: false,
    caravanCooldown: 0,
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
          />
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

function BodyPanel({ view }: { view: GameView }) {
  return (
    <section className="body-panel" aria-label="Состояние тела">
      <div className="body-title">
        <Bone aria-hidden="true" />
        <span>Состояние</span>
        {view.body.bleeding > 0 ? <strong>Кровотечение {view.body.bleeding.toFixed(1)}</strong> : null}
      </div>
      <div className="body-parts">
        {bodyParts.map((part) => (
          <div className="body-part" key={part.id} title={part.label}>
            {part.icon}
            <span>{part.short}</span>
            <StatusDot status={view.body[part.id]} />
          </div>
        ))}
      </div>
    </section>
  )
}

function MenuScreen({
  savedGame,
  onStart,
  onLoad,
}: {
  savedGame: SavedGame | null
  onStart: (faction: Faction) => void
  onLoad: () => void
}) {
  return (
    <main className="menu-screen">
      <div className="menu-atmosphere" aria-hidden="true">
        <div className="contour contour-a" />
        <div className="contour contour-b" />
        <div className="contour contour-c" />
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
  onResume,
  onSave,
  onMenu,
}: {
  view: GameView
  onResume: () => void
  onSave: () => void
  onMenu: () => void
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
        <div className="pause-actions">
          <button className="primary-button" type="button" onClick={onResume}>
            <Play aria-hidden="true" />
            Продолжить
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
  onRestart,
  onMenu,
}: {
  result: 'victory' | 'defeat'
  view: GameView
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
  paused,
  shopOpen,
  endResult,
  onResume,
  onPause,
  onSave,
  onMenu,
  onBuy,
  onCloseShop,
  onAttack,
  onInteract,
  onCommand,
  onPointerLock,
  onInput,
  onRestart,
  musicMuted,
  onToggleMusic,
}: {
  view: GameView
  worldRef: React.RefObject<HTMLDivElement | null>
  notices: Notice[]
  paused: boolean
  shopOpen: boolean
  endResult: 'victory' | 'defeat' | null
  onResume: () => void
  onPause: () => void
  onSave: () => void
  onMenu: () => void
  onBuy: (item: ShopItem) => void
  onCloseShop: () => void
  onAttack: () => void
  onInteract: () => void
  onCommand: () => void
  onPointerLock: () => void
  onInput: (code: string, active: boolean) => void
  onRestart: () => void
  musicMuted: boolean
  onToggleMusic: () => void
}) {
  const info = FACTION_INFO[view.faction]
  const eyeLoss =
    view.body.leftEye === 'missing' ? 'left' : view.body.rightEye === 'missing' ? 'right' : null
  const healthPercent = `${(view.health / view.maxHealth) * 100}%`
  const staminaPercent = `${view.stamina}%`

  const touchHold = (code: string) => ({
    onPointerDown: () => onInput(code, true),
    onPointerUp: () => onInput(code, false),
    onPointerCancel: () => onInput(code, false),
    onPointerLeave: () => onInput(code, false),
  })

  return (
    <main className={`game-screen faction-${view.faction}`}>
      <div className="world-stage" ref={worldRef} />
      <div className="screen-vignette" aria-hidden="true" />
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
        <ObjectiveList view={view} />
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
        <div className="control-ribbon">
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
        <PauseModal view={view} onResume={onResume} onSave={onSave} onMenu={onMenu} />
      ) : null}
      {endResult ? (
        <EndModal result={endResult} view={view} onRestart={onRestart} onMenu={onMenu} />
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
  const [paused, setPaused] = useState(false)
  const [shopOpen, setShopOpen] = useState(false)
  const [endResult, setEndResult] = useState<'victory' | 'defeat' | null>(null)
  const [musicMuted, setMusicMuted] = useState(() => readMusicMuted())
  const [runId, setRunId] = useState(0)
  const worldRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<GameEngine | null>(null)
  const noticeCounter = useRef(0)
  const musicMutedRef = useRef(musicMuted)

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

  useEffect(() => {
    if (screen !== 'game' || !worldRef.current) return
    const engine = new GameEngine(
      worldRef.current,
      faction,
      {
        onView: setGameView,
        onNotice: addNotice,
        onShop: () => setShopOpen(true),
        onPauseRequest: () => setPaused((current) => !current),
        onSaveRequest: () => {
          const save = engineRef.current?.save()
          if (save) setSavedGame(save)
        },
        onEnd: setEndResult,
      },
      pendingSave,
      musicMutedRef.current,
    )
    engineRef.current = engine
    engine.start()
    addNotice(
      pendingSave ? 'Сохранение загружено.' : `${FACTION_INFO[faction].name}: кампания началась.`,
      'success',
    )
    return () => {
      engine.destroy()
      if (engineRef.current === engine) engineRef.current = null
    }
  }, [addNotice, faction, pendingSave, runId, screen])

  useEffect(() => {
    engineRef.current?.setPaused(paused || shopOpen || Boolean(endResult))
  }, [paused, shopOpen, endResult])

  const startGame = (selectedFaction: Faction, save?: SavedGame) => {
    engineRef.current?.stopAudio()
    setFaction(selectedFaction)
    setPendingSave(save)
    setGameView(createInitialView(selectedFaction, save))
    setNotices([])
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

  if (screen === 'menu') {
    return (
      <MenuScreen
        savedGame={savedGame}
        onStart={(selectedFaction) => startGame(selectedFaction)}
        onLoad={() => {
          if (savedGame) startGame(savedGame.faction, savedGame)
        }}
      />
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
    <GameScreen
      view={gameView}
      worldRef={worldRef}
      notices={notices}
      paused={paused}
      shopOpen={shopOpen}
      endResult={endResult}
      onResume={() => setPaused(false)}
      onPause={() => setPaused(true)}
      onSave={saveGame}
      onMenu={returnToMenu}
      onBuy={buyItem}
      onCloseShop={() => setShopOpen(false)}
      onAttack={() => engineRef.current?.attack()}
      onInteract={() => engineRef.current?.interact()}
      onCommand={() => engineRef.current?.commandSquad()}
      onPointerLock={() => engineRef.current?.requestPointerLock()}
      onInput={(code, active) => engineRef.current?.setInput(code, active)}
      onRestart={() => startGame(faction)}
      musicMuted={musicMuted}
      onToggleMusic={toggleMusic}
    />
  )
}

export default App
