import { Check, Coins, Navigation2, Package, Shield, Swords, UsersRound } from 'lucide-react'
import type { BridgeAmbushChoice, BridgeAmbushView } from '../world/BridgeAmbush'
import './bridge-ambush.css'

export function BridgeAmbushHud({ view, paused, onChoose, onSquad, onTrack, inJournal = false }: {
  view: BridgeAmbushView | null
  paused: boolean
  onChoose: (choice: BridgeAmbushChoice) => void
  onSquad: () => void
  onTrack: () => void
  inJournal?: boolean
}) {
  if (!view || view.phase === 'unavailable') return null
  const settled = view.phase === 'resolved' || view.phase === 'lost'
  if (!inJournal && (settled ? view.distance > 60 : view.active === false)) return null
  const choosing = view.phase === 'secured'
  return (
    <section className={`bridge-encounter ${settled ? 'settled' : ''}`}
      data-phase={view.phase} aria-label={view.title}>
      <header>
        {view.phase === 'lost' ? <Shield aria-hidden="true" /> : settled ? <Check aria-hidden="true" /> : view.phase === 'fighting'
          ? <Swords aria-hidden="true" /> : <Package aria-hidden="true" />}
        <h2>{view.title}</h2>
        {!settled ? (
          <span className="bridge-distance" title={view.routeLabel ?? 'По прямой'}>
            <Navigation2 aria-hidden="true" style={{ transform: `rotate(${view.bearing}rad)` }} />
            {Math.ceil(view.distance)} м
          </span>
        ) : null}
      </header>
      <p className="bridge-stage-copy" role="status">{settled ? view.consequence : view.description}</p>
      {view.phase === 'approach' ? (
        <span className="bridge-route-label">{view.routeLabel ?? 'Направление по прямой, не дорога'}</span>
      ) : null}
      {view.phase === 'fighting' ? (
        <div className="bridge-combat-status">
          <span><Swords aria-hidden="true" /> Противники: {view.remainingEnemies}/{view.totalEnemies}</span>
          <span><Shield aria-hidden="true" /> Груз: {Math.ceil(view.cargoHealth)}/{view.cargoMaxHealth}</span>
        </div>
      ) : null}
      {view.phase === 'delivering' ? (
        <progress max={1} value={view.progress} aria-label="Доставка груза" />
      ) : null}
      {!settled ? <p className="bridge-hint">{view.hint}</p> : null}
      {view.phase === 'approach' ? (
        <div className="bridge-preparation">
          <button className="bridge-squad-button" type="button" onClick={onTrack} disabled={paused}>
            <Navigation2 aria-hidden="true" /> К мосту
          </button>
          <button className="bridge-squad-button" type="button" onClick={onSquad}
            disabled={paused} aria-haspopup="dialog">
            <UsersRound aria-hidden="true" /> Отряд <kbd>T</kbd>
          </button>
        </div>
      ) : null}
      {choosing ? (
        <div className="bridge-choices">
          <button type="button" disabled={paused || !view.canChoose} onClick={() => onChoose('seize')}>
            <Coins aria-hidden="true" /><span>Забрать груз<small>{view.seizeDetail ?? 'Добыча сейчас'}</small></span>
          </button>
          <button type="button" disabled={paused || !view.canChoose} onClick={() => onChoose('deliver')}>
            <Package aria-hidden="true" /><span>Довести обоз<small>{view.deliverDetail ?? 'Припасы для края'}</small></span>
          </button>
        </div>
      ) : null}
    </section>
  )
}
