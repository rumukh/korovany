import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Flag, Target, UsersRound, X } from 'lucide-react'
import { lockDocumentScroll } from '../../documentScrollLock'
import {
  SQUAD_COMMAND_COPY as copy,
  SQUAD_ORDER_DETAILS,
  SQUAD_ORDER_LABELS,
  SQUAD_STATUS_LABELS,
  describeSquadRole,
} from '../content/gameCopy'
import type { SquadCommandMode, SquadCommandView, SquadRosterMember } from '../world/SquadCommand'
import './squad-command.css'

const ORDERS: readonly SquadCommandMode[] = ['follow', 'hold', 'focus', 'regroup']

function memberName(member: SquadRosterMember): string {
  return `#${member.slot + 1} ${describeSquadRole(member.role)}`
}

function MemberHealth({ member }: { member: SquadRosterMember }) {
  return (
    <span className="squad-member-health">
      <span>{Math.ceil(member.health)}/{member.maxHealth}</span>
      <progress
        value={member.health}
        max={member.maxHealth}
        aria-label={memberName(member)}
      />
    </span>
  )
}

export function SquadCommandStrip({ view, onOpen, disabled }: {
  view: SquadCommandView
  onOpen: () => void
  disabled: boolean
}) {
  return (
    <section className="squad-command-strip" aria-label={copy.roster}>
      <button type="button" onClick={onOpen} disabled={disabled}
        aria-label={`${copy.open}: ${SQUAD_ORDER_LABELS[view.mode]}`}
        aria-haspopup="dialog" className="squad-strip-open">
        <UsersRound aria-hidden="true" />
        <strong>{SQUAD_ORDER_LABELS[view.mode]}</strong>
        <span>{view.roster.length}</span>
        <kbd>T</kbd>
      </button>
      <ul className="squad-strip-roster">
        {view.roster.map((member) => (
          <li key={member.id} data-squad-member-id={member.id} data-status={member.status} tabIndex={0}>
            <span className="squad-member-name">{memberName(member)}</span>
            <MemberHealth member={member} />
            <span className="squad-member-state">
              {SQUAD_STATUS_LABELS[member.status]} · {Math.round(member.distance)} {copy.metres}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function SquadCommandPanel({ view, onClose, onConfirm }: {
  view: SquadCommandView
  onClose: () => void
  onConfirm: (mode: SquadCommandMode, targetId?: string) => boolean
}) {
  const [selected, setSelected] = useState<SquadCommandMode>(view.mode)
  const [targetId, setTargetId] = useState(view.focusTargetId ?? '')
  const [rejected, setRejected] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement
    const unlockScroll = lockDocumentScroll()
    dialogRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus()
    return () => {
      unlockScroll()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:checked, select:not(:disabled), [tabindex="0"]',
    ))
    const first = controls[0]
    const last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
  const focusedTarget = view.targets.some((target) => target.id === targetId)
  return (
    <div className="squad-command-backdrop">
      <section className="squad-command-panel" role="dialog" aria-modal="true"
        aria-labelledby="squad-command-title" aria-describedby="squad-command-description"
        ref={dialogRef} onKeyDown={trapFocus}>
        <header>
          <div>
            <h2 id="squad-command-title">{copy.title}</h2>
            <p id="squad-command-description">{copy.pause}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={copy.close}><X aria-hidden="true" /></button>
        </header>
        <p className="squad-current-order">
          <Flag aria-hidden="true" /> {copy.current}: <strong>{SQUAD_ORDER_LABELS[view.mode]}</strong>
          <span>{copy.quick}</span>
        </p>
        {view.anchor ? <p className="squad-anchor">
          {copy.anchor}: {Math.round(view.anchor.x)}, {Math.round(view.anchor.z)}
        </p> : null}
        {view.focus ? <p className="squad-anchor">
          <Target aria-hidden="true" /> {copy.target}: {describeSquadRole(view.focus.role)}
          {' · '}{Math.round(view.focus.distance)} {copy.metres}
        </p> : null}
        <fieldset className="squad-order-choices">
          <legend>{copy.title}</legend>
          {ORDERS.map((mode) => (
            <label key={mode} className={selected === mode ? 'selected' : ''}>
              <input type="radio" name="squad-order" value={mode} checked={selected === mode}
                onChange={() => { setSelected(mode); setRejected(false) }} />
              <span><strong>{SQUAD_ORDER_LABELS[mode]}</strong><span>{SQUAD_ORDER_DETAILS[mode]}</span></span>
            </label>
          ))}
        </fieldset>
        {selected === 'focus' ? (
          <div className="squad-target-choice">
            <label htmlFor="squad-focus-target">{copy.target}</label>
            <select id="squad-focus-target" value={focusedTarget ? targetId : ''}
              onChange={(event) => { setTargetId(event.target.value); setRejected(false) }}
              disabled={view.targets.length === 0}>
              <option value="">{copy.chooseTarget}</option>
              {view.targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {describeSquadRole(target.role)} · {Math.round(target.distance)} {copy.metres}
                  {' · '}{Math.ceil(target.health)}/{target.maxHealth} · {target.id}
                </option>
              ))}
            </select>
            {view.targets.length === 0 ? <p>{copy.noTargets}</p> : null}
          </div>
        ) : null}
        <h3>{copy.roster}</h3>
        {view.roster.length === 0 ? <p>{copy.empty}</p> : (
          <ul className="squad-panel-roster">
            {view.roster.map((member) => (
              <li key={member.id} data-squad-member-id={member.id} data-status={member.status}>
                <strong>{memberName(member)}</strong>
                <MemberHealth member={member} />
                <span>{SQUAD_STATUS_LABELS[member.status]} · {Math.round(member.distance)} {copy.metres}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="squad-distance-note">{copy.distant}</p>
        {rejected ? <p role="alert" className="squad-command-error">{copy.rejected}</p> : null}
        <footer>
          <button className="primary-button" type="button"
            disabled={view.roster.length === 0 || (selected === 'focus' && !focusedTarget)}
            onClick={() => {
              if (!onConfirm(selected, selected === 'focus' ? targetId : undefined)) setRejected(true)
            }}>{copy.confirm}</button>
          <button type="button" onClick={onClose}>{copy.cancel}</button>
        </footer>
      </section>
    </div>
  )
}
