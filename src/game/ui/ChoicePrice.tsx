import { Clock3, Coins, Footprints } from 'lucide-react'
import {
  describeChoiceDanger,
  describeChoicePayout,
  describeChoiceTravel,
  describeContractTimeLimit,
} from '../content/gameCopy'
import type { ChoicePayoutView, ChoiceTravelView } from '../types'
import './choice-price.css'

/**
 * W2-3 — the price under a choice: what it pays, how long it lasts once started, how far it
 * is and what is known to stand in the way. Shared by the contract board (Full HUD, the
 * Compact disclosure and the journal) and by the atlas, so a choice reads the same wherever
 * the player meets it. It renders nothing for a choice nobody priced.
 */
export function ChoicePrice({ payout, timeLimit, travel }: {
  payout?: ChoicePayoutView | null
  timeLimit?: number | null
  travel?: ChoiceTravelView | null
}) {
  const paid = payout ? describeChoicePayout(payout) : null
  const clock = typeof timeLimit === 'number' ? describeContractTimeLimit(timeLimit) : null
  if (!paid && !clock && !travel) return null
  return (
    <div className="choice-price">
      {paid ? <p className="choice-price-payout"><Coins aria-hidden="true" />{paid}</p> : null}
      {clock || travel ? (
        <p className="choice-price-route">
          {clock ? <span><Clock3 aria-hidden="true" />{clock}</span> : null}
          {travel ? <span><Footprints aria-hidden="true" />{describeChoiceTravel(travel)}</span> : null}
          {travel ? (
            <span className={travel.danger.length > 0 ? 'choice-price-danger' : undefined}>
              {describeChoiceDanger(travel)}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
