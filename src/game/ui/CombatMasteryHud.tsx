import { COMBAT_MASTERY_COPY as copy, describeEvadeRefused } from '../content/gameCopy.ts'
import type { CombatMasteryView } from '../world/CombatMastery.ts'
import { instantGameplayAction } from '../input/CombatInput.ts'
import './combatMastery.css'

function evadeStatus(view: CombatMasteryView): string {
  if (view.evadeProtected) return copy.protected
  if (view.evadeActive) return view.evadeSettled ? copy.recovery : copy.active
  if (view.evadeReason === 'cooldown') return `${copy.recovery} ${view.evadeCooldown.toFixed(1)} ${copy.seconds}`
  if (view.evadeReady) return `${copy.ready} · ${view.evadeCost}`
  return describeEvadeRefused(view.evadeReason)
}

export function CombatMasteryHud({ view }: { view: CombatMasteryView }) {
  const guard = view.perfectGuard
  const outcome = view.outcome === 'evaded' ? copy.evaded :
    view.outcome === 'perfectGuard' ? copy.perfectGuard : ''
  return (
    <div className="combat-mastery-hud" role="group" aria-label={copy.title}>
      <div className="combat-mastery-step" data-ready={view.evadeReady}>
        <span><kbd>C</kbd> {copy.evade}</span>
        <span>{evadeStatus(view)}</span>
      </div>
      {view.evadeActive ? (
        <progress className="combat-mastery-progress" value={view.evadeProgress} max={1} aria-label={copy.active} />
      ) : null}
      {guard ? (
        <small className="combat-mastery-guard">
          {guard.window ? copy.guardWindow : guard.ready ? `${copy.guardReady} · ${guard.cost}` :
            guard.cooldown > 0 ? `${copy.guardRecovery} ${guard.cooldown.toFixed(1)} ${copy.seconds}` :
              guard.active ? copy.guardHeld : copy.guardUnavailable}
        </small>
      ) : null}
      <span className="combat-mastery-outcome" role="status">{outcome}</span>
      {view.cameraMode !== 'locked' ? <small className="combat-mastery-touch-look">{copy.touchLook}</small> : null}
    </div>
  )
}

export function CombatEvadeButton({ view, onEvade, paused }: {
  view: CombatMasteryView
  onEvade: () => void
  paused: boolean
}) {
  return (
    <button className="combat-evade-button" type="button" {...instantGameplayAction(onEvade)}
      disabled={paused || !view.evadeReady} aria-label={`${copy.evade}: ${evadeStatus(view)}`}>
      <span>{copy.evade}</span>
      <small aria-hidden="true">{view.evadeCooldown > 0 ? view.evadeCooldown.toFixed(1) : 'C'}</small>
    </button>
  )
}

export function CombatCameraControls({ mode, paused, onCapture }: {
  mode: CombatMasteryView['cameraMode']
  paused: boolean
  onCapture: () => void
}) {
  if (paused || mode === 'locked') return null
  return (
    <div className={`combat-camera-controls mode-${mode}`} aria-label={copy.camera}>
      <span className="combat-mouse-help">{mode === 'drag' ? copy.drag : copy.native}</span>
      <button type="button" onClick={onCapture}>{copy.capture}</button>
    </div>
  )
}
