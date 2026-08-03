/**
 * Roadmap 2.2's decider — how much does a seed actually change a run?
 *
 * `docs/STRATEGY.md` defers **2.2 — Full non-isomorphic macro-archetypes** (10–15 days)
 * "until run epilogues and player evidence show that seeds still feel interchangeable
 * after 1.5". This module is the instrument that turns that sentence into numbers.
 *
 * ---
 *
 * **THE FIVE FIELDS.** The 1.2 сводка prints route, cause, body, control and beats, and
 * the 1.2 session's read was that two runs differed in *route, cause and body* and did not
 * differ in *control and beat-shape*. So those five are what this measures — and it
 * measures them by building the real {@link buildRunEpilogue} from a harness run rather
 * than by re-implementing its selection, because a beat-shape metric that disagreed with
 * the postcard would be measuring a different game.
 *
 * **WHAT 1.2's READ COULD NOT SEE, AND THIS FIXES.** Its two runs differed in *both* seed
 * and faction, so start corner and squad differed for reasons that have nothing to do with
 * the seed. Every arm here therefore varies exactly one thing:
 *
 * - {@link runSeedArm} varies the seed with the faction **pinned** — the corrected primary.
 * - {@link runFactionArm} varies the faction with the seed **pinned** — how much of the
 *   apparent variety was faction-determined all along.
 * - {@link runNoiseArm} varies **nothing but the combat stream's salt**. Same world, same
 *   encounters, same chronicle draws. It is the negative control, and it exists because
 *   the named failure mode of this measurement is a metric that reports variety because it
 *   is reading dice rather than reading world structure.
 * - {@link runAblatedArm} varies the seed with the two layout axes 1.5 moved held still,
 *   using `tests/worldVariety.ts`'s own ablation. It is the closest thing to a pre-1.5
 *   baseline that can be *walked* rather than only counted.
 *
 * **WHAT THE HARNESS CANNOT MEASURE, SAID PLAINLY.** It has no limb, wound or companion
 * model — see its own "what it is not" list. So the epilogue's *body* field comes back
 * near-constant here for reasons that are about the harness and not about the generator,
 * and {@link RunFields.bodyEpilogue} is reported separately from {@link RunFields.bodyProxy}
 * so nobody reads "body does not vary across seeds" off an instrument that could not have
 * shown it varying. The qualitative browser read carries that field.
 *
 * **CONTROL IS MEASURED THREE WAYS, AND THE DIFFERENCE MATTERS.** The absolute control map
 * varies across seeds *trivially*, because the generator hands out a different territory
 * map to start with (`territoryMaps` = 176 of 200 seeds). What 1.2 found identical was the
 * **tally** — the four numbers the postcard prints — and what a player's choices can
 * actually move is the **delta** from the generated territory, which is the quantity 1.3's
 * placebo arm was about. All three are reported and they are not the same number.
 *
 * **ROUTE IS MEASURED TWICE, AND THE SECOND READING IS NOW A REGRESSION GUARD.** When this
 * module was written, `RunEpilogue.route` was documented as "map squares in discovery order"
 * and the engine filled `ActiveRunSaveV3.discoveredRegionIds` from
 * `RegionManager.getDiscoveredRegionIds`, which returned `sortedRegions(...)` — row-major
 * grid order by `compareRegions`. So the line the postcard printed was the low corner of the
 * map, not a path: a guard who started at E1 got a route line beginning at A1. This module
 * therefore measured both orders and judged the seed question on the discovery-order reading.
 *
 * **That defect is fixed.** `getDiscoveredRegionIds` now returns the order the squares were
 * discovered in, which the `Set` behind it always held. {@link RunFields.route} and
 * {@link RunFields.routeDiscovered} are consequently the *same* line on a shipped run, and
 * both are kept: the first is what a player reads, the second is what this module always
 * judged on, and a divergence between them means the grid order has come back.
 *
 * **One thing this module used to say about the shipped line was wrong, and the correction
 * is recorded rather than quietly dropped.** "The shipped one cannot discriminate anything"
 * reads as *flat*, and it is not: sorted, the eight labels `MAX_EPILOGUE_ROUTE` prints are
 * the eight lowest-numbered squares of whatever set a run discovered, so they move with the
 * *set*, and the grid line actually agrees **less** between two runs than the walked one
 * (0.674 against 0.787 on the 120-seed elf corpus). What was true is the part that mattered:
 * it was not a path, so its variation was never route variation. {@link RunFields.routeGridOrder}
 * keeps it measurable so that claim stays checkable.
 *
 * **WHAT THIS CANNOT SEE ABOUT 1.5.** The harness composes its own encounter packs around
 * a centre and never calls `createGeneratedEncounterPlan`, so 1.5's terrain-bound templates
 * are never *fought* here. {@link RunFields.encounterMix} therefore counts which template
 * each visited square would have earned — a fact about the world, not about the fight — and
 * the ablation arm bounds 1.5's **layout** contribution rather than the whole of it.
 */

import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { chooseEncounterTerrain } from '../src/game/content/registry.ts'
import { buildRunEpilogue, formatRegionIdLabel } from '../src/game/run/epilogue.ts'
import type {
  ActiveRunSaveV3,
  RunEndCause,
  RunEpilogue,
} from '../src/game/run/runTypes.ts'
import type { RegionDelta } from '../src/game/world/RegionRuntime.ts'
import type { Faction } from '../src/game/types.ts'
import type { Territory, WorldBlueprint } from '../src/game/world/worldTypes.ts'
import { collapseAxis } from './worldVariety.ts'
import {
  runHarness,
  type CampaignShape,
  type ContractPolicy,
  type DoctrinePolicy,
  type InputPolicy,
  type MeleeModel,
  type RumourPolicy,
  type RunReport,
} from './runHarness.ts'
// ---------------------------------------------------------------------------
// The arm
// ---------------------------------------------------------------------------

/**
 * The scripted player every arm uses, and why it is this one and not `beeline`.
 *
 * The brief for this measurement asks for **completed campaigns**, because the chronicle
 * is the system that needs time to diverge and 1.2's two runs both died at objective three
 * after one to two minutes. `beeline` finishes in ~118 simulated seconds and leaves the
 * chronicle ~12 events; `cautious` with a rumour commitment runs ~430 s and leaves ~28.
 * That is the arm with room in it, measured over twelve seeds before it was chosen:
 *
 * ```
 * arm              victories  elapsed  regions  chronicle
 * beeline/off          11/12     118s      9.6       12.3
 * cautious/off          8/12     375s      9.8       21.2
 * cautious/commit       8/12     428s     10.3       28.0   <- chosen
 * cautious/walk         5/12     591s     10.0       30.9
 * duelist/commit         1/12      98s      4.3        9.8
 * ```
 *
 * `cautious/walk` leaves more history still, but completes two runs in five, and a corpus
 * dominated by timeouts would be measuring the time limit rather than the seed. The rest
 * of the configuration is simply the shipped game as of 1.6 — honest melee, seeded contract
 * pinning, a seeded draft — because the question is about *this* generator, not a museum
 * piece.
 */
export const MEASUREMENT_ARM: {
  policy: InputPolicy
  meleeModel: MeleeModel
  rumourPolicy: RumourPolicy
  contractPolicy: ContractPolicy
  doctrinePolicy: DoctrinePolicy
  hz: number
  timeLimit: number
} = {
  policy: 'cautious',
  meleeModel: 'honest',
  rumourPolicy: 'commit',
  contractPolicy: 'seeded',
  doctrinePolicy: 'seeded',
  hz: 20,
  timeLimit: 900,
}

/** A run and the world it was walked in, because the control delta needs both. */
export interface MeasuredRun {
  report: RunReport
  blueprint: WorldBlueprint
}

// ---------------------------------------------------------------------------
// The epilogue, rebuilt from a harness run
// ---------------------------------------------------------------------------

const HARNESS_BODY = {
  leftArm: 'healthy',
  rightArm: 'healthy',
  leftLeg: 'healthy',
  rightLeg: 'healthy',
  leftEye: 'healthy',
  rightEye: 'healthy',
  bleeding: 0,
} as const

function endCause(report: RunReport): RunEndCause {
  if (report.outcome === 'victory') return 'objectives'
  if (report.outcome === 'timeout') return 'abandoned'
  if (report.deathCause === 'none') return 'unknown'
  return report.deathCause
}

/**
 * `compareRegions`'s ordering, restated on ids alone.
 *
 * `TerrainSystem.compareRegions` sorts by `coordinate.z`, then `coordinate.x`, and region
 * ids are `region-<x>-<z>`, so this is the same order without needing the layout.
 */
function compareRegionIds(first: string, second: string): number {
  const left = /^region-(\d+)-(\d+)$/.exec(first)
  const right = /^region-(\d+)-(\d+)$/.exec(second)
  if (!left || !right) return first.localeCompare(second)
  return (
    Number(left[2]) - Number(right[2]) ||
    Number(left[1]) - Number(right[1]) ||
    first.localeCompare(second)
  )
}

function regionDeltaFor(regionId: string, control: Territory): RegionDelta {
  return {
    version: 2,
    regionId,
    revision: 1,
    clearedEncounterIds: [],
    defeatedActorIds: [],
    removedPropIds: [],
    collectedLootIds: [],
    completedInteractionIds: [],
    completedEventIds: [],
    chronicle: {
      control,
      pressure: { elf: 0, guard: 0, villain: 0 },
      beastPressure: 0,
      settlementIntegrity: 100,
      supply: 0.5,
      lastEventTick: 0,
    },
    state: {},
  }
}

/**
 * The shipped сводка, built from a harness run.
 *
 * Everything load-bearing is real: the discovery order, the chronicle log, the terminal
 * control map, the cause and the equipped doctrines all come out of the run. What is
 * fabricated is exactly what the harness does not simulate — body state, companions and
 * the achievement counters — and it is fabricated as a **constant**, so those fields
 * cannot contribute variety they did not earn.
 *
 * `routeOrder` is the **regression control**, and it stays now that the defect is fixed.
 * `engine` reproduces what the shipped engine hands the postcard; `gridOrder` reproduces
 * what it handed the postcard *before* `RegionManager.getDiscoveredRegionIds` stopped
 * sorting — row-major grid order by `compareRegions` (z, then x). The two used to be the
 * same and are now different, which is the fix; keeping the second is what lets a test say
 * "and it must not be that one again" rather than merely asserting the current output.
 */
export function buildHarnessEpilogue(
  report: RunReport,
  routeOrder: 'engine' | 'gridOrder' = 'engine',
): RunEpilogue {
  const discovered =
    routeOrder === 'gridOrder'
      ? [...report.discoveredRegionIds].sort(compareRegionIds)
      : [...report.discoveredRegionIds]
  const snapshot: ActiveRunSaveV3 = {
    version: 3,
    runId: `harness-${report.seed}-${report.faction}`,
    config: {
      seed: report.seed,
      generatorVersion: 1,
      faction: report.faction,
      selectedBoonId: 'provisions',
    },
    status: report.outcome === 'timeout' ? 'abandoned' : report.outcome,
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    blueprintFingerprint: `generator-1:${report.seed}`,
    currentLocation: {
      regionId: report.finalRegionId,
      localPosition: [0, 0, 0],
      worldPosition: [0, 0, 0],
    },
    player: {
      health: report.health,
      maxHealth: 100,
      stamina: 100,
      maxStamina: 100,
      gold: 0,
      kills: report.kills,
      damage: 28,
      body: { ...HARNESS_BODY },
      objectives: [],
      upgrades: { blade: 0, vitality: 0, endurance: 0 },
    },
    companions: [],
    discoveredRegionIds: discovered,
    regionDeltas: Object.fromEntries(
      Object.entries(report.regionControl).map(([regionId, control]) => [
        regionId,
        regionDeltaFor(regionId, control),
      ]),
    ),
    directorState: {
      elapsed: report.elapsed,
      doctrines: {
        pool: [...report.doctrines.pool],
        equipped: [...report.doctrines.equipped],
        anchors: report.doctrines.draftsOpened,
      },
    },
    eventState: {},
    chronicleState: {
      tick: report.chronicleTicks,
      factionStrength: { elf: 0, guard: 0, villain: 0 },
      caravans: [],
      log: report.chronicleLog.map((event) => ({ ...event })),
    },
    rngStates: {},
    achievementRunState: {
      runId: `harness-${report.seed}`,
      faction: report.faction,
      startedAt: '2026-01-01T00:00:00.000Z',
      kills: report.kills,
      killsSinceDamage: 0,
      bestKillStreak: 0,
      damageTaken: report.damageTaken.total,
      injuries: 0,
      limbsLost: 0,
      goldEarned: 0,
      purchases: 0,
      objectivesCompleted: report.objectivesCompleted,
      eventsCompleted: 0,
      abilitiesUsed: 0,
      shieldBlocks: 0,
      squadCommands: 0,
      caravansRobbed: 0,
      zonesVisited: [],
      eventKindsCompleted: [],
      unlockedIds: [],
      result: report.outcome === 'victory' ? 'victory' : 'defeat',
      elapsedAtEnd: report.elapsed,
      healthAtEnd: report.health,
    },
    ending: {
      cause: endCause(report),
      ...(report.deathRole === null ? {} : { role: report.deathRole }),
    },
  }
  return buildRunEpilogue(snapshot)
}

// ---------------------------------------------------------------------------
// The five fields, as comparable signatures
// ---------------------------------------------------------------------------

/**
 * One run reduced to the fields the postcard prints, each as a string two runs can be
 * compared on.
 *
 * Nine strings for five fields, because three of them split in ways the 1.2 read did not:
 * *control* into the tally it printed, the map underneath it and the delta a player can
 * actually move; *beats* into the whole beat and the verbs alone, which is the form 1.2's
 * claim ("the same two or three verbs in different squares") was actually about; and
 * *body* into what the epilogue would print and what the harness can honestly see.
 */
export interface RunFields {
  /** The postcard's bounded route line, in the order the engine actually persists. */
  route: string
  /**
   * The same line read in **discovery order**, which is what this module always judged on.
   *
   * Kept, and kept under its own name, even though it is now identical to {@link route} on
   * every shipped run — because every band and every recorded number in this module and its
   * test is expressed in it, and folding it into `route` would silently re-baseline them
   * against a field whose meaning had just changed. The two agreeing *is* the fix, and
   * `seedVariance.test.ts` asserts that agreement rather than assuming it.
   */
  routeDiscovered: string
  /**
   * The line the postcard printed **before** the discovery-order fix: row-major grid order.
   *
   * The regression control. A guard who starts at E1 printed a line beginning at A1; if
   * this ever equals {@link route} again on a run that walked more than a corner of the
   * map, the sort has come back.
   */
  routeGridOrder: string
  /** Every square discovered, sorted — for overlap rather than for equality. */
  routeSet: readonly string[]
  /** How the run ended, and who ended it. */
  cause: string
  /** The epilogue's body fields. Near-constant here: the harness has no limb model. */
  bodyEpilogue: string
  /** What the harness *can* see of the body: survival, health band, who hurt it. */
  bodyProxy: string
  /** The four numbers the postcard prints. */
  control: string
  /** The four numbers the *generator* handed this run before it was played. */
  controlBase: string
  /** How the run moved them, signed. What a player can actually change. */
  controlShift: string
  /** The twenty-five squares underneath them. */
  controlMap: string
  /** Squares whose holder differs from the generated territory, sorted. */
  controlDelta: string
  /** How many squares that is. */
  controlDeltaCount: number
  /** The three beats as the postcard prints them: verb and square. */
  beatShape: string
  /** The three verbs alone, in order — 1.2's actual claim. */
  beatVerbs: string
  /**
   * The encounter templates the run's squares actually earned, counted.
   *
   * Not one of the сводка's five fields — it is 1.5's *alternative* hypothesis, that the
   * thin thing is the encounter grammar rather than the layout. Measured on the squares a
   * run visited rather than over the whole map, because a template on a square nobody
   * enters is not an experience.
   */
  encounterMix: string
}

function healthBand(report: RunReport): string {
  if (report.outcome !== 'victory') return 'dead'
  return `hp${Math.min(9, Math.floor(report.health / 10))}`
}

const TERRITORIES: readonly Territory[] = ['neutral', 'elf', 'guard', 'villain']

function tallyOf(counts: Record<Territory, number>): string {
  return TERRITORIES.map((territory) => counts[territory]).join('-')
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

/** The templates the run's own squares earned, as a stable `kind:count` string. */
function encounterMixOf(report: RunReport, blueprint: WorldBlueprint): string {
  const visited = new Set(report.discoveredRegionIds)
  const regionById = new Map(
    blueprint.regions.map((region) => [String(region.id), region]),
  )
  const counts = new Map<string, number>()
  for (const slot of blueprint.encounters) {
    const regionId = String(slot.regionId)
    if (!visited.has(regionId)) continue
    const region = regionById.get(regionId)
    if (!region) continue
    const terrain = chooseEncounterTerrain(blueprint, region, slot)
    counts.set(terrain, (counts.get(terrain) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([terrain, count]) => `${terrain}:${count}`)
    .join(',')
}

export function measureRunFields(run: MeasuredRun): RunFields {
  const { report, blueprint } = run
  const epilogue = buildHarnessEpilogue(report)
  const gridOrder = buildHarnessEpilogue(report, 'gridOrder')
  const base: Record<Territory, number> = { neutral: 0, elf: 0, guard: 0, villain: 0 }
  for (const region of blueprint.regions) base[region.territory] += 1
  const changed = blueprint.regions
    .filter((region) => report.regionControl[String(region.id)] !== region.territory)
    .map(
      (region) =>
        `${formatRegionIdLabel(String(region.id))}:${region.territory}>${
          report.regionControl[String(region.id)]
        }`,
    )
    .sort()
  const hurtBy = Object.keys(report.damageTaken.byAllegiance).sort().join('+')
  return {
    route: epilogue.route.join('>'),
    // The engine's own order *is* the discovery order now, so these two are the same string
    // and the second is what every band here was measured in. Computing it from the same
    // epilogue rather than from a second build is the point: if they ever came apart, the
    // engine would have started sorting again.
    routeDiscovered: epilogue.route.join('>'),
    routeGridOrder: gridOrder.route.join('>'),
    routeSet: [...report.discoveredRegionIds].sort(),
    cause: `${epilogue.cause}/${epilogue.causeRole ?? '-'}`,
    bodyEpilogue: `w${epilogue.wounds.length}/l${epilogue.limbsLost}/i${epilogue.injuries}/${
      epilogue.bleeding ? 'bleeding' : 'dry'
    }`,
    bodyProxy: `${healthBand(report)}/${
      report.damageTaken.bleeding > 0 ? 'bled' : 'dry'
    }/${hurtBy}`,
    control: tallyOf(epilogue.control),
    controlBase: tallyOf(base),
    controlShift: TERRITORIES.map((territory) =>
      signed(epilogue.control[territory] - base[territory]),
    ).join('/'),
    controlMap: blueprint.regions
      .map((region) => report.regionControl[String(region.id)][0])
      .join(''),
    controlDelta: changed.join(','),
    controlDeltaCount: changed.length,
    beatShape: epilogue.beats.map((beat) => `${beat.kind}@${beat.region}`).join('+'),
    beatVerbs: epilogue.beats.map((beat) => beat.kind).join('+'),
    encounterMix: encounterMixOf(report, blueprint),
  }
}

// ---------------------------------------------------------------------------
// Variance
// ---------------------------------------------------------------------------

/** The signature fields a variance is reported for. Everything else is a summary. */
export const VARIANCE_METRICS = [
  'route',
  'routeDiscovered',
  'routeGridOrder',
  'cause',
  'bodyEpilogue',
  'bodyProxy',
  'control',
  'controlBase',
  'controlShift',
  'controlMap',
  'controlDelta',
  'beatShape',
  'beatVerbs',
  'encounterMix',
] as const

export type VarianceMetric = (typeof VARIANCE_METRICS)[number]

/**
 * Which of the five fields a metric belongs to, so a report cannot silently drop one.
 *
 * `encounters` is the sixth entry and deliberately not one of the сводка's fields: it
 * carries 1.5's alternative hypothesis, which this measurement is obliged to be able to
 * see if the evidence points at it.
 */
export const METRIC_FIELDS: Readonly<
  Record<
    VarianceMetric,
    'route' | 'cause' | 'body' | 'control' | 'beatShape' | 'encounters'
  >
> = {
  route: 'route',
  routeDiscovered: 'route',
  routeGridOrder: 'route',
  cause: 'cause',
  bodyEpilogue: 'body',
  bodyProxy: 'body',
  control: 'control',
  controlBase: 'control',
  controlShift: 'control',
  controlMap: 'control',
  controlDelta: 'control',
  beatShape: 'beatShape',
  beatVerbs: 'beatShape',
  encounterMix: 'encounters',
}

export interface FieldVariance {
  runs: number
  /** How many different values the corpus produced. */
  distinct: number
  /** `distinct / runs`. One means every run was unique; `1/runs` means none were. */
  distinctShare: number
  /** The share of runs sharing the single most common value. The "one run twice" number. */
  modeShare: number
  /** Shannon entropy in bits, normalised by `log2(runs)`. Zero when every run agrees. */
  entropy: number
}

function varianceOf(values: readonly string[]): FieldVariance {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const runs = values.length
  if (runs === 0) {
    return { runs: 0, distinct: 0, distinctShare: 0, modeShare: 0, entropy: 0 }
  }
  let bits = 0
  let mode = 0
  for (const count of counts.values()) {
    const share = count / runs
    bits -= share * Math.log2(share)
    if (count > mode) mode = count
  }
  return {
    runs,
    distinct: counts.size,
    distinctShare: counts.size / runs,
    modeShare: mode / runs,
    entropy: runs <= 1 ? 0 : bits / Math.log2(runs),
  }
}

/** Mean pairwise Jaccard overlap. One means every pair walked the same squares. */
function meanJaccard(sets: readonly (readonly string[])[]): number {
  if (sets.length < 2) return 1
  let total = 0
  let pairs = 0
  for (let left = 0; left < sets.length; left += 1) {
    const first = new Set(sets[left])
    for (let right = left + 1; right < sets.length; right += 1) {
      const second = sets[right]
      let shared = 0
      for (const value of second) if (first.has(value)) shared += 1
      const union = first.size + second.length - shared
      total += union === 0 ? 1 : shared / union
      pairs += 1
    }
  }
  return pairs === 0 ? 1 : total / pairs
}

/**
 * Mean share of *printed* route positions two runs agree on.
 *
 * The overlap above asks whether two runs saw the same squares; this asks whether the
 * postcard's route line reads the same, position by position, which is what a person
 * comparing two сводки is actually doing.
 */
function meanRouteLineAgreement(lines: readonly (readonly string[])[]): number {
  if (lines.length < 2) return 1
  let total = 0
  let pairs = 0
  for (let left = 0; left < lines.length; left += 1) {
    for (let right = left + 1; right < lines.length; right += 1) {
      const first = lines[left]
      const second = lines[right]
      const span = Math.max(first.length, second.length)
      if (span === 0) {
        total += 1
      } else {
        let same = 0
        for (let index = 0; index < span; index += 1) {
          if (first[index] !== undefined && first[index] === second[index]) same += 1
        }
        total += same / span
      }
      pairs += 1
    }
  }
  return pairs === 0 ? 1 : total / pairs
}

export interface SeedVarianceReport {
  runs: number
  /** Share of the corpus that finished the campaign. A corpus of timeouts measures a clock. */
  completionRate: number
  fields: Record<VarianceMetric, FieldVariance>
  /** Mean pairwise square overlap between two runs' routes. */
  routeOverlap: number
  /**
   * Mean pairwise agreement between two runs' route lines **in discovery order**.
   *
   * This is the number every band in `seedVariance.test.ts` is expressed in, and it is the
   * one the seed question was judged on. When the module was written the engine persisted
   * `discoveredRegionIds` in row-major grid order, so this was the *generous* reading —
   * what the postcard would say if `route` were the discovery order its own doc claimed.
   * The engine now hands over that order, so this is simply what the postcard says, and
   * {@link shippedRouteLineAgreement} agrees with it rather than measuring the low corner
   * of the map. {@link gridOrderRouteLineAgreement} is what the old behaviour scored, kept
   * as the regression reading.
   */
  routeLineAgreement: number
  /** The same statistic on the line the game actually prints. Equal to the above. */
  shippedRouteLineAgreement: number
  /** And the same statistic under the grid ordering the fix removed. The control. */
  gridOrderRouteLineAgreement: number
  /** Mean squares whose holder moved off the generated territory. */
  meanControlDelta: number
  /** Mean simulated seconds, so a corpus that never got going is visible. */
  meanElapsed: number
  /** Mean chronicle events, for the same reason. */
  meanChronicleEvents: number
}

function routeLine(value: string): string[] {
  return value === '' ? [] : value.split('>')
}

export function measureSeedVariance(runs: readonly MeasuredRun[]): SeedVarianceReport {
  const fields = runs.map(measureRunFields)
  const of = (metric: VarianceMetric): FieldVariance =>
    varianceOf(fields.map((entry) => String(entry[metric])))
  const victories = runs.filter((run) => run.report.outcome === 'victory').length
  const total = Math.max(1, runs.length)
  return {
    runs: runs.length,
    completionRate: victories / total,
    fields: Object.fromEntries(
      VARIANCE_METRICS.map((metric) => [metric, of(metric)]),
    ) as Record<VarianceMetric, FieldVariance>,
    routeOverlap: meanJaccard(fields.map((entry) => entry.routeSet)),
    routeLineAgreement: meanRouteLineAgreement(
      fields.map((entry) => routeLine(entry.routeDiscovered)),
    ),
    shippedRouteLineAgreement: meanRouteLineAgreement(
      fields.map((entry) => routeLine(entry.route)),
    ),
    gridOrderRouteLineAgreement: meanRouteLineAgreement(
      fields.map((entry) => routeLine(entry.routeGridOrder)),
    ),
    meanControlDelta:
      fields.reduce((sum, entry) => sum + entry.controlDeltaCount, 0) / total,
    meanElapsed: runs.reduce((sum, run) => sum + run.report.elapsed, 0) / total,
    meanChronicleEvents:
      runs.reduce((sum, run) => sum + run.report.chronicleLog.length, 0) / total,
  }
}

// ---------------------------------------------------------------------------
// The arms
// ---------------------------------------------------------------------------

export interface ArmOptions {
  seeds: number
  firstSeed?: number
  stride?: number
}

const DEFAULT_FIRST_SEED = 1
const DEFAULT_STRIDE = 7919

function seedAt(options: ArmOptions, index: number): number {
  return (
    (options.firstSeed ?? DEFAULT_FIRST_SEED) + index * (options.stride ?? DEFAULT_STRIDE)
  )
}

function walk(
  blueprint: WorldBlueprint,
  seed: number,
  faction: Faction,
  combatNoiseSalt?: number,
  campaignShape?: CampaignShape,
  contractPolicy?: ContractPolicy,
): MeasuredRun {
  return {
    report: runHarness({
      seed,
      faction,
      blueprint,
      ...MEASUREMENT_ARM,
      ...(combatNoiseSalt === undefined ? {} : { combatNoiseSalt }),
      ...(campaignShape === undefined ? {} : { campaignShape }),
      ...(contractPolicy === undefined ? {} : { contractPolicy }),
    }),
    blueprint,
  }
}

/**
 * **The primary.** One faction, many seeds. This is the comparison 1.2 could not make.
 */
export function runSeedArm(faction: Faction, options: ArmOptions): MeasuredRun[] {
  return Array.from({ length: options.seeds }, (_, index) => {
    const seed = seedAt(options, index)
    return walk(generateWorld(seed), seed, faction)
  })
}

/**
 * **Roadmap 2.1's anti-placebo.** The same seeds and the same faction, with the fork's
 * exclusivity removed and nothing else.
 *
 * `allRequired` strips `optional` and `exclusiveGroup` from the shipped graph, which
 * reproduces 1.4's shape exactly: same sites, same contracts, same two ready nodes, same
 * seeded pin — and both arms required, so the run walks both. It is the arm that separates
 * "the player took one road" from "the map has two roads on it". If the route statistics
 * move here too, the exclusive choice is not what moved them, and 2.1's claim is
 * unfounded.
 */
export function runShapeArm(
  faction: Faction,
  options: ArmOptions,
  shape: CampaignShape,
): MeasuredRun[] {
  return Array.from({ length: options.seeds }, (_, index) => {
    const seed = seedAt(options, index)
    return walk(generateWorld(seed), seed, faction, undefined, shape)
  })
}

/**
 * **Roadmap 2.1's primary, and the reason this instrument needed a fourth arm.**
 *
 * Every other arm here varies the *world*: the seed, the faction, the dice, the layout. But
 * 2.1's claim is not that the world moved — it is that **the player can move the route
 * without the world moving at all**, which is precisely what 1.4 could not offer and what
 * PR #84 found the seed could not buy either.
 *
 * So this arm holds the seed, the faction, the layout, the chronicle and the dice all still
 * and varies exactly one thing: which arm of the fork the player takes. `firstReady` walks
 * the faction's signature contract; `contrary` walks the alternative. Two runs of the same
 * world, and the only difference between them is a decision.
 *
 * It is the same shape as {@link runFactionArm}, which is this file's positive control, and
 * it is read the same way: a *low* agreement here is the finding, and the noise arm's zero
 * is the floor it has to clear.
 */
export function runChoiceArm(
  faction: Faction,
  options: ArmOptions,
  shape: CampaignShape = 'branched',
): { first: MeasuredRun; contrary: MeasuredRun }[] {
  return Array.from({ length: options.seeds }, (_, index) => {
    const seed = seedAt(options, index)
    return {
      first: walk(generateWorld(seed), seed, faction, undefined, shape, 'firstReady'),
      contrary: walk(generateWorld(seed), seed, faction, undefined, shape, 'contrary'),
    }
  })
}

/**
 * **The confound, isolated.** One seed, all three factions — how much of what 1.2 read as
 * seed variety was faction variety wearing its coat.
 */
export function runFactionArm(
  factions: readonly Faction[],
  options: ArmOptions,
): MeasuredRun[] {
  const runs: MeasuredRun[] = []
  for (let index = 0; index < options.seeds; index += 1) {
    const seed = seedAt(options, index)
    for (const faction of factions) runs.push(walk(generateWorld(seed), seed, faction))
  }
  return runs
}

/**
 * **The negative control.** One seed, one faction, and nothing different but the dice.
 *
 * If a field's variance here matches its variance across seeds, that field is reading
 * combat randomness and any cross-seed reading of it is worthless. This is the same
 * discipline as 1.3's placebo and 1.5's ablation, pointed at this measurement's own
 * failure mode.
 */
export function runNoiseArm(
  seed: number,
  faction: Faction,
  samples: number,
): MeasuredRun[] {
  const blueprint = generateWorld(seed)
  return Array.from({ length: samples }, (_, index) => walk(blueprint, seed, faction, index))
}

/**
 * **The baseline.** Many seeds, with layout axes 1.5 moved held still.
 *
 * `collapseAxis` is 1.5's own ablation: it rewrites the corpus so the named axis carries
 * the first world's value and leaves everything else alone. The two axes 1.5 actually
 * moved are `river` (a meander, where before there was one straight seeded column) and
 * `optionalSites` (placed by eligibility, where before there were six literal region ids),
 * so collapsing them is what "route moved" has to be measured against.
 *
 * It is an **approximation** of the pre-1.5 generator and not a checkout of it, and the
 * two ways it differs are stated rather than hidden. Collapsing the river axis pins the
 * river to one shape rather than restoring the old three-column straight one, which if
 * anything removes *more* variety than 1.5 added. And `blueprint.bridges` is not
 * re-derived, so a collapsed world can carry a bridge record for a square the collapsed
 * river no longer runs through — which affects the encounter template that square earns,
 * not whether the run can be walked.
 */
export function runAblatedArm(
  faction: Faction,
  axes: readonly ('river' | 'optionalSites' | 'layout' | 'objectives')[],
  options: ArmOptions,
): MeasuredRun[] {
  const seeds = Array.from({ length: options.seeds }, (_, index) => seedAt(options, index))
  let corpus: WorldBlueprint[] = seeds.map((seed) => generateWorld(seed))
  for (const axis of axes) corpus = collapseAxis(corpus, axis)
  return corpus.map((blueprint, index) => walk(blueprint, seeds[index], faction))
}
