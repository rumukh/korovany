import { Coins, PawPrint, ShieldAlert } from 'lucide-react'
import { describeCaravanLootCue } from '../content/gameCopy'
import type { CaravanLootView } from '../world/CaravanClaim'
import './caravan-loot.css'

/**
 * The HUD half of somebody else loading a caravan: what is happening, how far away, and a
 * bar for how much of the cargo is already gone. It sits inside the action prompt so it
 * shares the one interaction lane on both desktop and narrow screens instead of claiming
 * another region of an already full HUD.
 */
export function CaravanLootCue({ view }: { view: CaravanLootView | null }) {
  if (!view) return null
  const percent = Math.round(Math.min(1, Math.max(0, view.progress)) * 100)
  return (
    <span className="caravan-loot-cue" role="status" data-looter={view.looter}
      data-defend={view.defend ? 'true' : 'false'}>
      <span className="caravan-loot-title">
        {view.looter === 'beast'
          ? <PawPrint aria-hidden="true" />
          : view.defend ? <ShieldAlert aria-hidden="true" /> : <Coins aria-hidden="true" />}
        <strong>{describeCaravanLootCue(view.looter, view.defend)}</strong>
        <small>{view.distance} м</small>
      </span>
      <span className="caravan-loot-meter" role="meter" aria-label="Сколько груза уже унесли"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <i style={{ transform: `scaleX(${percent / 100})` }} />
      </span>
    </span>
  )
}
