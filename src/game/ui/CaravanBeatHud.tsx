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
  Split,
  Swords,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import {
  CARAVAN_OFFER_TAKE_LABEL,
  CARAVAN_OFFER_TAKEN_LABEL,
  CARAVAN_OPENING_HINT,
  CARAVAN_OPENING_TITLE,
  describeCaravanOpeningLead,
} from '../content/gameCopy'
import type { Faction } from '../types'
import type { CaravanBeatOutcome, CaravanBeatView, CaravanOpeningView } from '../world/CaravanBeats'
import { ChoicePrice } from './ChoicePrice'
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
  if (view.phase === 'unavailable' || view.phase === 'declined') {
    return inJournal ? (
      <section className="journal-consequence" aria-label={view.title}>
        <h3>{view.title}</h3>
        <p>{view.description}</p>
      </section>
    ) : null
  }
  // PR B — a road beat before the camp's choice is only a line in the journal.
  if (view.dormant) {
    return inJournal ? (
      <section className="bridge-encounter dormant" data-phase="dormant" data-placement={view.placement}
        aria-label={view.title}>
        <header>
          <Package aria-hidden="true" />
          <h2>{view.title}</h2>
        </header>
        <p className="bridge-stage-copy">{view.description}</p>
        <span className="bridge-route-label">
          {view.regionLabel} · {view.role === 'defend' ? 'налётчики' : 'охрана'}: {view.escort}
        </span>
        <ChoicePrice payout={view.payout} />
        {view.alternatives ? <p className="bridge-hint caravan-offer-alternatives">{view.alternatives}</p> : null}
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
      {view.phase === 'approach' ? (
        <>
          <ChoicePrice payout={view.payout} travel={view.travel} />
          {view.alternatives ? <p className="bridge-hint caravan-offer-alternatives">{view.alternatives}</p> : null}
        </>
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

/**
 * W2-2, PR B — «Суть такова: два корована». The run's first decision, in the field while it is
 * open and in the journal for a longer look. Each offer is priced in W2-3's card language
 * (`ChoicePrice`: what its first verb pays, the walk, the known danger) with the side's other
 * verbs said after it. «Взяться» points the compass at one; walking up to either cart is the
 * same choice. A planning action, so it stays available while the game is paused.
 */
export function CaravanOpeningCard({ opening, faction, onTake, inJournal = false }: {
  opening: CaravanOpeningView | null
  faction: Faction
  onTake: (beatId: string) => void
  inJournal?: boolean
}) {
  if (!opening || opening.offers.length === 0) return null
  return (
    <section className={`bridge-encounter caravan-opening${inJournal ? ' in-journal' : ''}`}
      data-phase="opening" aria-label={CARAVAN_OPENING_TITLE}>
      <header>
        <Split aria-hidden="true" />
        <h2>{CARAVAN_OPENING_TITLE}</h2>
      </header>
      <p className="bridge-stage-copy">{describeCaravanOpeningLead(faction)}</p>
      <div className="caravan-offers">
        {opening.offers.map((offer) => {
          const chosen = opening.chosenId === offer.id
          return (
            <article className={`caravan-offer${chosen ? ' chosen' : ''}`} key={offer.id}>
              <div className="caravan-offer-line">
                <span className="chronicle-square">{offer.regionLabel}</span>
                <strong>{offer.title}</strong>
              </div>
              <span className="bridge-route-label">
                {offer.role === 'defend' ? 'налётчики' : 'охрана'}: {offer.escort}
              </span>
              <ChoicePrice payout={offer.payout} travel={offer.travel} />
              {offer.alternatives ? (
                <p className="bridge-hint caravan-offer-alternatives">{offer.alternatives}</p>
              ) : null}
              <button type="button" className="bridge-squad-button caravan-offer-take"
                aria-pressed={chosen} onClick={() => onTake(offer.id)}>
                <Navigation2 aria-hidden="true" /> {chosen ? CARAVAN_OFFER_TAKEN_LABEL : CARAVAN_OFFER_TAKE_LABEL}
              </button>
            </article>
          )
        })}
      </div>
      <p className="bridge-hint">{CARAVAN_OPENING_HINT}</p>
    </section>
  )
}