import { HeartPulse, MapPinned, UsersRound } from 'lucide-react'
import {
  SQUAD_CARE_COPY,
  SQUAD_REPLENISHMENT_COPY,
  describeSquadCareJournal,
  describeVillainMusterJournal,
} from '../content/gameCopy'
import type { Faction } from '../types'
import type { SquadResourceView } from '../world/SquadResource'
import './squad-command.css'

export function SquadResourceCard({
  faction,
  squadSize,
  resource,
  onOpen,
}: {
  faction: Faction
  squadSize: number
  resource: SquadResourceView
  onOpen: () => void
}) {
  const muster = resource.villainMuster
  return (
    <section className="hud-card squad-resource-card" aria-labelledby="squad-resource-title">
      <header>
        <h3 id="squad-resource-title">
          <UsersRound aria-hidden="true" /> {SQUAD_CARE_COPY.journalTitle}
        </h3>
        <strong>{squadSize + resource.pending}/{resource.cap}</strong>
      </header>
      <p>{SQUAD_REPLENISHMENT_COPY[faction]}</p>
      <p className="squad-resource-care">
        <HeartPulse aria-hidden="true" />
        {describeSquadCareJournal(resource.rations, resource.treatmentRange)}
      </p>
      {muster?.available ? (
        <p className="squad-resource-muster">
          <MapPinned aria-hidden="true" />
          {describeVillainMusterJournal(muster.regionLabel, muster.remaining)}
        </p>
      ) : null}
      <button type="button" onClick={onOpen}>{SQUAD_CARE_COPY.open}</button>
    </section>
  )
}
