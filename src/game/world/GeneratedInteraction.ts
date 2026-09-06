import type { ObjectiveKind, SiteKind } from './worldTypes.ts'

export interface GeneratedInteractionInput {
  site: { id: string; kind: SiteKind } | null
  objective: { siteId: string; kind: ObjectiveKind; liveContract: boolean } | null
  sabotage: boolean
  razed: boolean
  caravanDistance: number
  supplyCount: number
  health: number
  maxHealth: number
  rationOnBleed: boolean
}

export type GeneratedInteractionKind =
  | 'sabotage' | 'shop' | 'recovery' | 'ruin' | 'treasure'
  | 'inspect' | 'claim' | 'caravan' | 'ration' | 'none'

/** Both the prompt and E execute this priority decision; events precede it in the engine. */
export function chooseGeneratedInteraction(input: GeneratedInteractionInput): {
  kind: GeneratedInteractionKind
  targetsObjective: boolean
} {
  const { site, objective } = input
  const targetsObjective = Boolean(site && objective && !objective.liveContract &&
    objective.siteId === site.id && (objective.kind === 'interact' || objective.kind === 'claim'))
  let kind: GeneratedInteractionKind
  if (site && input.sabotage) kind = 'sabotage'
  else if (site && (site.kind === 'shop' || site.kind === 'recovery')) {
    kind = input.razed ? 'ruin' : site.kind
  } else if (site?.kind === 'treasure') kind = 'treasure'
  else if (targetsObjective) kind = objective?.kind === 'claim' ? 'claim' : 'inspect'
  else if (input.caravanDistance < 7) kind = 'caravan'
  else if (input.supplyCount > 0 && input.health < input.maxHealth && !input.rationOnBleed) kind = 'ration'
  else kind = 'none'
  return { kind, targetsObjective }
}
