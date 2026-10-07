import {
  Check,
  Coins,
  Flame,
  House,
  Landmark,
  Navigation2,
  Package,
  Send,
  Shield,
  Swords,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import type { CaravanBeatOutcome, CaravanBeatView } from '../world/CaravanBeats'
import './bridge-ambush.css'

const CHOICE_ICONS: Record<CaravanBeatOutcome, LucideIcon> = {
  take: Coins,
  plunder: Coins,
  confiscate: Landmark,
  give: House,
  deliver: Package,
  release: Send,
  press: UserPlus,
  burn: Flame,
}

/**
 * W2-2 — one caravan beat: the field card for the beat that matters now, and the same card
 * in the journal for every beat of the run. Grew out of the bridge ambush card, whose styles
 * it keeps.
 */
export function CaravanBeatHud({ view, paused, onChoose, onSquad, onTrack, inJournal = false }: {
  view: CaravanBeatView | null
  paused: boolean
  onChoose: (beatId: string, outcome: CaravanBeatOutcome) => void
  onSquad: () => void
  onTrack: (beatId: string) => void
  inJournal?: boolean
}) {
  if (!view) return null
  if (view.phase === 'unavailable') {
    return inJournal ? (
      <section className="journal-consequence" aria-label={view.title}>
        <h3>{view.title}</h3>
        <p>{view.description}</p>
      </section>
    ) : null
  }
  const settled = view.phase === 'resolved' || view.phase === 'lost' || view.phase === 'escaped'
  if (!inJournal && (settled ? view.distance > 60 : !view.active)) return null
  const choosing = view.phase === 'secured'
  return (
    <section className={`bridge-encounter ${settled ? 'settled' : ''}`}
      data-phase={view.phase} data-placement={view.placement} aria-label={view.title}>
      <header>
        {view.phase === 'lost' || view.phase === 'escaped' ? <Shield aria-hidden="true" />
          : settled ? <Check aria-hidden="true" />
            : view.phase === 'fighting' ? <Swords aria-hidden="true" /> : <Package aria-hidden="true" />}
        <h2>{view.title}</h2>
        {!settled ? (
          <span className="bridge-distance" title={view.routeLabel ?? 'По прямой'}>
            <Navigation2 aria-hidden="true" style={{ transform: `rotate(${view.bearing}rad)` }} />
            {Math.ceil(view.distance)} м
          </span>
        ) : null}
      </header>
      <p className="bridge-stage-copy" role="status">{settled ? view.consequence : view.description}</p>
      {inJournal && !settled ? (
        <span className="bridge-route-label">
          {view.regionLabel} · {view.role === 'defend' ? 'налётчики' : 'охрана'}: {view.escort}
        </span>
      ) : null}
      {view.phase === 'approach' ? (
        <span className="bridge-route-label">{view.routeLabel ?? 'Направление по прямой, не дорога'}</span>
      ) : null}
      {view.phase === 'fighting' ? (
        <div className="bridge-combat-status">
          <span><Swords aria-hidden="true" /> Противники: {view.remainingEnemies}/{view.totalEnemies}</span>
          {view.role === 'defend' ? (
            <span><Shield aria-hidden="true" /> Груз: {Math.ceil(view.cargoHealth)}/{view.cargoMaxHealth}</span>
          ) : null}
        </div>
      ) : null}
      {view.phase === 'delivering' ? (
        <progress max={1} value={view.progress} aria-label="Телегу ведут" />
      ) : null}
      {!settled ? <p className="bridge-hint">{view.hint}</p> : null}
      {view.phase === 'approach' ? (
        <div className="bridge-preparation">
          <button className="bridge-squad-button" type="button" onClick={() => onTrack(view.id)} disabled={paused}>
            <Navigation2 aria-hidden="true" /> {view.placement === 'bridge' ? 'К мосту' : 'К телеге'}
          </button>
          <button className="bridge-squad-button" type="button" onClick={onSquad}
            disabled={paused} aria-haspopup="dialog">
            <UsersRound aria-hidden="true" /> Отряд <kbd>T</kbd>
          </button>
        </div>
      ) : null}
      {choosing ? (
        <div className="bridge-choices">
          {view.choices.map((choice) => {
            const Icon = CHOICE_ICONS[choice.outcome]
            return (
              <button key={choice.outcome} type="button"
                disabled={paused || !view.canChoose || choice.disabledReason !== null}
                title={choice.disabledReason ?? undefined}
                onClick={() => onChoose(view.id, choice.outcome)}>
                <Icon aria-hidden="true" />
                <span>{choice.label}<small>{choice.disabledReason ?? choice.detail}</small></span>
              </button>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
