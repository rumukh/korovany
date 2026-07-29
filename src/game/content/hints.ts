/**
 * When a diegetic first-time line fires, and what counts as covering the HUD.
 *
 * `gameCopy.ts` owns the words; this file owns the timing. Two decisions shape everything
 * here:
 *
 * 1. **Hints read the view, not the engine.** Every trigger is a predicate over the
 *    `GameView` the HUD already draws, evaluated where the view is emitted. That is one
 *    hook site instead of a hint call scattered across every system, it cannot consume
 *    from a random stream — so a hint firing can never shift an encounter or a loot roll —
 *    and it makes "the HUD element said something for the first time" the literal
 *    definition of a first sighting rather than an approximation of one.
 *
 * 2. **The `GameView` is the enumeration of the HUD.** Anything the HUD shows is a field
 *    of that view, so every field must be claimed by a mechanic or exempted in writing.
 *    `findHudCoverageGaps` is what `tests/hints.test.ts` runs, which is why it lives in
 *    source and takes its inputs as parameters: the test drives it with mutated registries
 *    to prove it can fail.
 *
 * Nothing here reads a clock, a random stream or the DOM. The pacing gate uses
 * `view.elapsed`, which is engine time and stops when the game is paused.
 */

import {
  DEFAULT_UPGRADE_LEVELS,
  type BodyPart,
  type GameView,
  type NoticeTone,
  type UpgradeId,
} from '../types.ts'
import { HINT_IDS, describeHint, isHintId, type HintId } from './gameCopy.ts'

/**
 * Seconds between two hints. Longer than the 4.3 s a notice lives in `App.tsx`, so two
 * first-time lines can never share the notice stack: a run that trips four mechanics in
 * one fight teaches them one at a time instead of burying the fight under a wall of text.
 */
export const HINT_MIN_GAP_SECONDS = 6

const BODY_PART_KEYS: Record<BodyPart, true> = {
  leftArm: true,
  rightArm: true,
  leftLeg: true,
  rightLeg: true,
  leftEye: true,
  rightEye: true,
}

const BODY_PARTS = Object.keys(BODY_PART_KEYS) as BodyPart[]
const UPGRADE_IDS = Object.keys(DEFAULT_UPGRADE_LEVELS) as UpgradeId[]

function discoveredRegionCount(view: GameView): number {
  return view.worldMap.regions.filter((region) => region.discovered).length
}

export interface HudMechanic {
  /** The line this mechanic teaches. */
  readonly hint: HintId
  /** The `GameView` fields this mechanic puts on the HUD. */
  readonly viewFields: readonly (keyof GameView)[]
  /**
   * True on the first frame the HUD element actually shows the mechanic. `previous` is
   * `null` for the first view of a run, which is what keeps change-detecting triggers from
   * firing at launch on state the player has not caused yet.
   */
  readonly firstSighting: (view: GameView, previous: GameView | null) => boolean
}

/**
 * Every mechanic that owns a piece of the HUD, and the moment it first speaks.
 *
 * A mechanic may claim several fields (the health bar is `health` + `maxHealth`, and the
 * damage vignette is the same mechanic's feedback), and a field may back several mechanics
 * (`body` carries bleeding, lost limbs and prosthetics, which are three different lessons).
 */
export const HUD_MECHANICS: readonly HudMechanic[] = [
  {
    hint: 'health',
    viewFields: ['health', 'maxHealth', 'damageFlash'],
    firstSighting: (view) => view.health < view.maxHealth,
  },
  {
    hint: 'stamina',
    viewFields: ['stamina', 'maxStamina'],
    // Not "any drop": the bar twitches on a single jump. 15 % is a sprint the player
    // chose, which is the moment the meter starts meaning something.
    firstSighting: (view) => view.stamina <= view.maxStamina * 0.85,
  },
  {
    hint: 'bleeding',
    viewFields: ['body'],
    firstSighting: (view) => view.body.bleeding > 0,
  },
  {
    hint: 'limbLoss',
    viewFields: ['body'],
    firstSighting: (view) => BODY_PARTS.some((part) => view.body[part] === 'missing'),
  },
  {
    hint: 'prosthetic',
    viewFields: ['body'],
    firstSighting: (view) => BODY_PARTS.some((part) => view.body[part] === 'prosthetic'),
  },
  {
    hint: 'gold',
    viewFields: ['gold'],
    // Gold is non-zero at launch because of the starting purse, so the first sighting is
    // gold the player earned, not gold they were handed.
    firstSighting: (view, previous) => previous !== null && view.gold > previous.gold,
  },
  {
    hint: 'upgrades',
    viewFields: ['damage', 'upgrades'],
    firstSighting: (view, previous) =>
      previous !== null &&
      (view.damage > previous.damage ||
        UPGRADE_IDS.some((id) => view.upgrades[id] > previous.upgrades[id])),
  },
  {
    hint: 'shopPrices',
    viewFields: ['shopPriceMultiplier'],
    // Matches the threshold the shop uses to render the surcharge line at all.
    firstSighting: (view) => view.shopPriceMultiplier > 1.02,
  },
  {
    hint: 'zone',
    viewFields: ['zone'],
    firstSighting: (view, previous) => previous !== null && view.zone !== previous.zone,
  },
  {
    hint: 'objectives',
    viewFields: ['objectives'],
    firstSighting: (view) => view.objectives.some((objective) => objective.done),
  },
  {
    hint: 'interact',
    viewFields: ['prompt'],
    firstSighting: (view) => view.prompt.length > 0,
  },
  {
    hint: 'map',
    viewFields: ['worldMap', 'markers'],
    firstSighting: (view, previous) =>
      previous !== null && discoveredRegionCount(view) > discoveredRegionCount(previous),
  },
  {
    hint: 'chronicle',
    viewFields: ['chronicle'],
    firstSighting: (view) => view.chronicle.length > 0,
  },
  {
    hint: 'rumours',
    viewFields: ['rumours'],
    // The panel only exists when the world has something to offer, so the first sighting
    // is the first offer — the line arrives attached to a decision the player can still
    // make, not to the news that they missed one.
    firstSighting: (view) => view.rumours.length > 0,
  },
  {
    hint: 'squad',
    viewFields: ['squad'],
    firstSighting: (view) => view.squad > 0,
  },
  {
    hint: 'threat',
    viewFields: ['threatTier', 'elapsed'],
    firstSighting: (view) => view.threatTier > 1,
  },
  {
    hint: 'ability',
    viewFields: ['ability'],
    firstSighting: (view) => view.ability.active || view.ability.cooldown > 0,
  },
  {
    hint: 'melee',
    viewFields: ['melee'],
    // The first swing, not the first fight: the counter only ever reads above zero once
    // the player has actually pressed attack, so the line arrives attached to the thing
    // it explains rather than to the sight of an enemy.
    firstSighting: (view) => view.melee.beat > 0,
  },
  {
    hint: 'events',
    viewFields: ['activeEvent'],
    firstSighting: (view) => view.activeEvent !== null,
  },
  {
    hint: 'loot',
    viewFields: ['lootToast'],
    firstSighting: (view) => view.lootToast !== null,
  },
]

/**
 * `GameView` fields that are not a mechanic the player has to learn, each with the reason.
 *
 * This is the escape hatch the coverage gate deliberately leaves open, so it is written
 * down rather than implied: a field lands here when it is UI plumbing, a label chosen
 * before the run started, or state that never reaches the HUD at all. The test requires a
 * real sentence, because "" would turn the gate off one field at a time.
 */
export const HUD_VIEW_EXEMPTIONS: Readonly<Record<string, string>> = {
  faction: 'Chosen on the menu before the run starts; the emblem is identity, not a mechanic.',
  kills: 'Not on the HUD. Read only by the pause and end modals, which already label it.',
  pointerLocked:
    'Input plumbing. The capture prompt it drives is itself the instruction, and it repeats.',
  paused: 'UI state. The pause modal is the explanation, and it is on screen while it applies.',
  caravanCooldown:
    'Never read by the UI. It rides in the view so the director can serialise it with a save.',
  campaignCompleted:
    'A terminal state, announced by the end screen a frame later. A first-time line about a run that is over teaches nothing.',
}

export type HudCoverageProblem = 'unclaimed' | 'stale' | 'unexplained' | 'unreachable'

export interface HudCoverageGap {
  /** The view field, exemption key or hint id at fault. */
  readonly subject: string
  readonly problem: HudCoverageProblem
}

const MIN_EXEMPTION_REASON = 24

/**
 * The coverage gate, as a function so it can be run against mutated inputs.
 *
 * Reports, in this order: view fields nothing claims, registry entries naming fields the
 * view no longer has, exemptions without a stated reason, and hints that exist in
 * `gameCopy.ts` but that no mechanic can ever fire.
 */
export function findHudCoverageGaps(
  viewFields: readonly string[],
  mechanics: readonly HudMechanic[] = HUD_MECHANICS,
  exemptions: Readonly<Record<string, string>> = HUD_VIEW_EXEMPTIONS,
  hintIds: readonly string[] = HINT_IDS,
): HudCoverageGap[] {
  const present = new Set(viewFields)
  const claimed = new Set<string>()
  const gaps: HudCoverageGap[] = []

  for (const mechanic of mechanics) {
    for (const field of mechanic.viewFields) claimed.add(field)
  }

  for (const field of viewFields) {
    if (!claimed.has(field) && !Object.hasOwn(exemptions, field)) {
      gaps.push({ subject: field, problem: 'unclaimed' })
    }
  }
  for (const field of [...claimed, ...Object.keys(exemptions)]) {
    if (!present.has(field)) gaps.push({ subject: field, problem: 'stale' })
  }
  for (const [field, reason] of Object.entries(exemptions)) {
    if (reason.trim().length < MIN_EXEMPTION_REASON) {
      gaps.push({ subject: field, problem: 'unexplained' })
    }
  }

  const reachable = new Set(mechanics.map((mechanic) => mechanic.hint))
  for (const hintId of hintIds) {
    if (!reachable.has(hintId as HintId)) {
      gaps.push({ subject: hintId, problem: 'unreachable' })
    }
  }

  return gaps
}

export interface HintDirectorOptions {
  /** Hint ids the profile has already been shown. Unknown ids are kept and ignored. */
  seen?: Iterable<string>
  /**
   * Hints queued by an earlier session of the same run but never shown.
   *
   * Without this the queue would die with the engine, and a *transition* trigger — gold
   * rising, an upgrade bought, a square discovered — cannot rediscover its transition
   * after a restore, because the change already happened. Unknown or already-seen ids are
   * dropped rather than trusted.
   */
  pending?: Iterable<string>
  /** The existing notice channel. Hints do not get a surface of their own. */
  emit: (message: string, tone: NoticeTone) => void
  /** Called once, when a hint is actually shown, so the profile can record it. */
  onSeen?: (hintId: HintId) => void
  minGapSeconds?: number
  mechanics?: readonly HudMechanic[]
}

/**
 * Watches the emitted view, queues the mechanics it meets for the first time, and releases
 * them one at a time through the notice channel.
 *
 * A hint is marked seen when it is *shown*, not when it is queued: a run that ends with
 * something still in the queue leaves it for the next run rather than burning it on a
 * screen the player never read.
 */
export class HintDirector {
  private readonly seen: Set<string>
  private readonly emit: (message: string, tone: NoticeTone) => void
  private readonly onSeen: ((hintId: HintId) => void) | undefined
  private readonly minGapSeconds: number
  private readonly mechanics: readonly HudMechanic[]
  private readonly queue: HintId[] = []
  private previous: GameView | null = null
  private nextHintAt = 0

  constructor(options: HintDirectorOptions) {
    this.seen = new Set(options.seen ?? [])
    this.emit = options.emit
    this.onSeen = options.onSeen
    this.minGapSeconds = options.minGapSeconds ?? HINT_MIN_GAP_SECONDS
    this.mechanics = options.mechanics ?? HUD_MECHANICS
    for (const id of options.pending ?? []) {
      if (!isHintId(id) || this.seen.has(id) || this.queue.includes(id)) continue
      if (this.mechanics.some((mechanic) => mechanic.hint === id)) this.queue.push(id)
    }
  }

  /** One emitted frame of HUD state. Safe to call at any rate, including twice in a row. */
  observe(view: GameView): void {
    for (const mechanic of this.mechanics) {
      if (this.seen.has(mechanic.hint) || this.queue.includes(mechanic.hint)) continue
      if (mechanic.firstSighting(view, this.previous)) this.queue.push(mechanic.hint)
    }
    // `buildGameView` hands back a fresh object with copied sub-objects every frame, so
    // holding the reference is a snapshot, not an alias into engine state.
    this.previous = view
    this.release(view)
  }

  /** The ledger to persist. Includes ids this build did not recognise. */
  snapshot(): string[] {
    return [...this.seen]
  }

  /** Queued but not yet shown, to be carried across a save and restore of the same run. */
  pending(): HintId[] {
    return [...this.queue]
  }

  hasSeen(hintId: string): boolean {
    return this.seen.has(hintId)
  }

  private release(view: GameView): void {
    if (view.paused || this.queue.length === 0 || view.elapsed < this.nextHintAt) return
    const hintId = this.queue.shift()
    if (hintId === undefined) return
    this.seen.add(hintId)
    const copy = describeHint(hintId)
    this.nextHintAt = view.elapsed + this.minGapSeconds
    this.emit(copy.text, copy.tone)
    this.onSeen?.(hintId)
  }
}
