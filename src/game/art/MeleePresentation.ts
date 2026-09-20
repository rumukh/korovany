import { playerBeatSpec, type PlayerMeleeState } from '../world/CombatResolver.ts'

export interface MeleePresentation {
  attack: number
  anticipation: number
  recovery: number
  sweep: number
  twist: number
  drive: number
  trail: number
}

export function createMeleePresentation(): MeleePresentation {
  return { attack: 0, anticipation: 0, recovery: 0, sweep: 0, twist: 0, drive: 0, trail: 0 }
}

function ease(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)))
  return t * t * (3 - 2 * t)
}

/** Read the combat clock; a pose never advances a swing or owns a second timer. */
export function sampleMeleePresentation(
  state: Readonly<PlayerMeleeState>,
  output: MeleePresentation,
): MeleePresentation {
  output.attack = 0
  output.anticipation = 0
  output.recovery = 0
  output.sweep = 0
  output.twist = 0
  output.drive = 0
  output.trail = 0
  if (state.phase === 'idle') return output

  const spec = playerBeatSpec(state.beat)
  const winding = state.phase === 'windup'
  const duration = winding ? spec.windup : spec.recovery
  const progress = Math.max(0, Math.min(1, 1 - state.phaseRemaining / duration))
  if (winding) {
    const release = ease(0.65, 1, progress)
    output.anticipation = ease(0, 0.65, progress) * (1 - release)
    output.attack = release
  } else {
    output.attack = 1 - ease(0, 1, progress)
    output.recovery = Math.sin(progress * Math.PI)
    output.trail = 1 - ease(0, 0.55, progress)
  }

  const direction = state.beat === 2 ? -1 : 1
  const weight = spec.commits ? 1.35 : 1
  output.sweep = direction * (output.attack * 0.75 - output.anticipation * 0.55) * weight
  output.twist = direction * (output.attack * 0.28 - output.anticipation * 0.24) * weight
  output.drive = (output.attack * 0.14 - output.anticipation * 0.1) * weight
  return output
}
