/**
 * Layer 2, §5.1 — the one place the actor cap is enforced.
 *
 * The engine used to sprinkle `actors.length + n <= MAX_ACTORS` checks across every
 * spawn site, so nothing could reason about *which* actors were allowed to exist. The
 * budget splits the cap into reserved categories and lets a category borrow only from
 * the spare capacity of lower-priority ones — which is what makes `ambient` yield its
 * slots first when the world needs room for a real fight.
 *
 * Pure data: no THREE, no scene, no actor objects.
 */

export type ActorBudgetCategory = 'squad' | 'campaign' | 'chronicle' | 'ambient'

export const MAX_ACTORS = 25

export const ACTOR_BUDGET: Record<ActorBudgetCategory, number> = {
  squad: 3,
  campaign: 8,
  chronicle: 8,
  ambient: 6,
}

/** Highest priority first. A category may only borrow from the ones after it. */
export const ACTOR_BUDGET_PRIORITY: readonly ActorBudgetCategory[] = [
  'squad',
  'campaign',
  'chronicle',
  'ambient',
]

/**
 * Asked to give up `count` slots so a higher-priority category can spawn. Returns how
 * many actors were actually removed; the budget releases exactly that many.
 */
export type ActorBudgetYield = (
  category: ActorBudgetCategory,
  count: number,
) => number

export type ActorBudgetUsage = Record<ActorBudgetCategory, number>

export function createActorBudgetUsage(): ActorBudgetUsage {
  return { squad: 0, campaign: 0, chronicle: 0, ambient: 0 }
}

export class ActorBudget {
  private readonly used: ActorBudgetUsage = createActorBudgetUsage()
  private readonly onYield: ActorBudgetYield | null

  constructor(onYield: ActorBudgetYield | null = null) {
    this.onYield = onYield
  }

  /** Total actors currently accounted for. Never exceeds `MAX_ACTORS`. */
  get total(): number {
    let total = 0
    for (const category of ACTOR_BUDGET_PRIORITY) total += this.used[category]
    return total
  }

  getUsed(category: ActorBudgetCategory): number {
    return this.used[category]
  }

  usage(): ActorBudgetUsage {
    return { ...this.used }
  }

  /** Slots the category can take right now without anything being evicted. */
  availableFor(category: ActorBudgetCategory): number {
    const own = Math.max(0, ACTOR_BUDGET[category] - this.used[category])
    let borrowable = 0
    for (const other of lowerPriorityThan(category)) {
      borrowable += Math.max(0, ACTOR_BUDGET[other] - this.used[other])
    }
    return Math.max(0, Math.min(MAX_ACTORS - this.total, own + borrowable))
  }

  /**
   * Slots the category could take if every lower-priority category gave up everything
   * it holds. Purely informational — `reserve` is what actually asks them to yield.
   */
  capacityFor(category: ActorBudgetCategory): number {
    let held = 0
    let borrowable = 0
    for (const other of lowerPriorityThan(category)) {
      held += this.used[other]
      borrowable += ACTOR_BUDGET[other]
    }
    return Math.max(
      0,
      Math.min(
        MAX_ACTORS - this.total + held,
        Math.max(0, ACTOR_BUDGET[category] - this.used[category]) + borrowable,
      ),
    )
  }

  /** All-or-nothing reservation. Lower-priority categories yield, `ambient` first. */
  reserve(category: ActorBudgetCategory, count: number): boolean {
    const wanted = normalizeCount(count)
    if (wanted === 0) return true
    if (this.availableFor(category) < wanted) {
      this.requestYield(category, wanted - this.availableFor(category))
    }
    if (this.availableFor(category) < wanted) return false
    this.used[category] += wanted
    return true
  }

  /** Partial reservation: grants as many of `count` as fit, and returns how many. */
  reserveUpTo(category: ActorBudgetCategory, count: number): number {
    const wanted = normalizeCount(count)
    if (wanted === 0) return 0
    if (this.availableFor(category) < wanted) {
      this.requestYield(category, wanted - this.availableFor(category))
    }
    const granted = Math.min(wanted, this.availableFor(category))
    this.used[category] += granted
    return granted
  }

  release(category: ActorBudgetCategory, count = 1): void {
    this.used[category] = Math.max(0, this.used[category] - normalizeCount(count))
  }

  /** Reconciles the ledger against the live actor list so it can never drift. */
  sync(usage: Partial<ActorBudgetUsage>): void {
    for (const category of ACTOR_BUDGET_PRIORITY) {
      this.used[category] = Math.max(0, Math.trunc(usage[category] ?? 0))
    }
    this.enforceCap()
  }

  clear(): void {
    for (const category of ACTOR_BUDGET_PRIORITY) this.used[category] = 0
  }

  private requestYield(category: ActorBudgetCategory, shortfall: number): void {
    if (!this.onYield || shortfall <= 0) return
    let remaining = shortfall
    // Lowest priority first: ambient gives up its actors before anything else does.
    for (const other of [...lowerPriorityThan(category)].reverse()) {
      if (remaining <= 0) break
      const holding = this.used[other]
      if (holding <= 0) continue
      const freed = normalizeCount(this.onYield(other, Math.min(holding, remaining)))
      if (freed <= 0) continue
      this.used[other] = Math.max(0, holding - freed)
      remaining -= Math.min(freed, holding)
    }
  }

  private enforceCap(): void {
    // Trim from the lowest priority up; the invariant matters more than the ledger.
    for (const category of [...ACTOR_BUDGET_PRIORITY].reverse()) {
      const excess = this.total - MAX_ACTORS
      if (excess <= 0) return
      this.used[category] = Math.max(0, this.used[category] - excess)
    }
  }
}

function lowerPriorityThan(
  category: ActorBudgetCategory,
): readonly ActorBudgetCategory[] {
  return ACTOR_BUDGET_PRIORITY.slice(ACTOR_BUDGET_PRIORITY.indexOf(category) + 1)
}

function normalizeCount(count: number): number {
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
}
