import type { FinaleStage, FinaleView } from '../types'
import './FinaleHud.css'

const STAGES: Record<FinaleStage, string> = {
  introduction: 'Противник',
  positioning: 'Манёвр',
  telegraph: 'Замах',
  contact: 'Удар',
  recovery: 'Открыт',
  transition: 'Новая тактика',
  resuming: 'Возвращение',
  suspended: 'Бой ждёт',
  defeated: 'Победа',
}

export function FinaleHud({ finale }: { finale: FinaleView | null }) {
  if (!finale) return null
  return (
    <section
      className={`finale-hud finale-${finale.stage}`}
      data-profile={finale.profile}
      data-phase={finale.phase}
      aria-label="Финальный противник"
    >
      <div className="finale-heading">
        <strong>{finale.name}</strong>
        <span>Фаза {finale.phase}/2</span>
      </div>
      <div
        className="finale-health"
        role="meter"
        aria-label="Здоровье противника"
        aria-valuemin={0}
        aria-valuemax={finale.maxHealth}
        aria-valuenow={Math.ceil(finale.health)}
      >
        <i style={{ width: `${100 * finale.health / finale.maxHealth}%` }} />
      </div>
      <div className="finale-status">
        <b>{STAGES[finale.stage]}</b>
        <span>{Math.ceil(finale.health)}/{finale.maxHealth} · Охрана {finale.escortsAlive}/2</span>
      </div>
      <p aria-live="polite">{finale.cue}</p>
    </section>
  )
}

export function FinaleResult({ finale }: { finale: FinaleView | null }) {
  if (!finale || finale.stage !== 'defeated') return null
  return <p className="finale-result"><strong>{finale.name}</strong> повержен. Дорога твоя.</p>
}
