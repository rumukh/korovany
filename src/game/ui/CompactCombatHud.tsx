import type { ReactNode } from 'react'
import { COMPACT_HUD_COPY as copy } from '../content/gameCopy.ts'
import type { GameView } from '../types.ts'
import type { HudMode } from '../visualSettings.ts'
import { keepDisclosureKeyLocal } from '../input/CombatInput.ts'
import './compact-combat.css'

function Disclosure({ mode, title, summary, children }: {
  mode: HudMode
  title: string
  summary: ReactNode
  children: ReactNode
}) {
  if (mode === 'full') return <>{children}</>
  return (
    <details className="compact-hud-disclosure">
      <summary onKeyDown={keepDisclosureKeyLocal}>
        <strong>{title}</strong>
        <span className="compact-hud-summary">{summary}</span>
        <small>{copy.expand}</small>
      </summary>
      <div className="compact-hud-details">{children}</div>
    </details>
  )
}

export function CompactMissionHud({ view, mode, children }: {
  view: GameView
  mode: HudMode
  children: ReactNode
}) {
  const pinned = view.contracts.find((entry) => entry.pinned)
  const objective = view.objectives.find((entry) => entry.id === pinned?.id) ??
    view.objectives.find((entry) => !entry.done && !entry.skipped)
  const timed = view.contracts.filter((entry) => entry.timeRemaining !== null)
  return (
    <Disclosure mode={mode} title={copy.mission} summary={
      <>
        <span>{objective?.text ?? copy.settled}</span>
        {view.contracts.length > 1 ? <span>{copy.choices}: {view.contracts.length}</span> : null}
        {timed.map((entry) => <span className="compact-hud-deadline" key={entry.id}>
          {entry.regionLabel} · {entry.title}: {Math.ceil(entry.timeRemaining!)} {copy.seconds}
        </span>)}
        {view.doctrines.offer.length > 0 ? <span className="compact-hud-deadline">{copy.doctrine}</span> : null}
      </>
    }>{children}</Disclosure>
  )
}

export function CompactWorldNews({ view, mode, children }: {
  view: GameView
  mode: HudMode
  children: ReactNode
}) {
  return (
    <Disclosure mode={mode} title={copy.news} summary={
      <>
        <span>{copy.chronicle}: {view.chronicle.length}</span>
        {view.rumours.map((rumour) => <span key={rumour.id} className="compact-hud-deadline">
          {rumour.regionLabel} · {rumour.title}
          {rumour.outcome === null ? `: ${Math.ceil(rumour.timeRemaining)} ${copy.seconds}` : ` · ${rumour.outcomeText}`}
        </span>)}
      </>
    }>{children}</Disclosure>
  )
}
