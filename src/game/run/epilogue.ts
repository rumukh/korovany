import { formatRegionGridLabel } from '../content/gameCopy.ts'
import { normalizeDoctrineRunState } from './doctrine.ts'
import type { ActorRole, BodyPart, BodyState } from '../types.ts'
import type { ChronicleEvent, ChronicleEventKind } from '../world/Chronicle.ts'
import { WORLD_HEIGHT, WORLD_WIDTH } from '../world/worldTypes.ts'
import type {
  ActiveRunSaveV3,
  RunEndCause,
  RunEpilogue,
  RunEpilogueBeat,
  RunEpilogueCompanion,
  RunEpilogueControl,
  RunEpilogueWound,
  RunEpilogueWoundStatus,
} from './runTypes.ts'

/**
 * The «походная сводка» builder.
 *
 * Two properties this file exists to hold, both of them load-bearing:
 *
 * 1. **Bounded.** Every collection below has a constant beside it and every element is an id
 *    or a highlight. The profile is one localStorage blob rewritten on every save, so an
 *    epilogue whose size tracked the length of the run would be paid for on every write. The
 *    bounds are exported because `tests/runEpilogue.test.ts` measures against them, and a
 *    bound nobody can see from the outside is a bound nobody can prove.
 * 2. **Deterministic, and free of the run's random streams.** The epilogue is derived from a
 *    terminal snapshot and nothing else — no clock, no `Math.random`, and above all no draw
 *    from a gameplay stream, which would shift every roll after it. Selection where several
 *    candidates compete is by a written-down ranking with total tie-breaks, so the same
 *    snapshot yields the same сводка every time it is rendered.
 */

/** Map squares printed in the route. The rest are counted, not named. */
export const MAX_EPILOGUE_ROUTE = 8
/** Chronicle beats. Three, as the roadmap asks — never a feed. */
export const MAX_EPILOGUE_BEATS = 3
/** There are only six body parts, so this is a ceiling rather than a cut. */
export const MAX_EPILOGUE_WOUNDS = 6
/** Surviving companions, grouped by role. */
export const MAX_EPILOGUE_COMPANIONS = 6
/** Equipped doctrines. Roadmap 1.6 fills this; the three-slot cap bounds it long before. */
export const MAX_EPILOGUE_DOCTRINES = 4

/**
 * How loud a chronicle beat is, before witness weight.
 *
 * This is the only judgement in the file and it is written down rather than felt: a burned
 * settlement is a story, an arrived caravan is a logistics report.
 */
const BEAT_WEIGHT: Record<ChronicleEventKind, number> = {
  settlementBurned: 6,
  regionCaptured: 5,
  caravanLost: 4,
  beastRaid: 4,
  raidRepelled: 3,
  beastsRepelled: 3,
  caravanArrived: 1,
}

/** Added when the beat happened somewhere the player actually went. */
const WITNESSED_BONUS = 3

const BODY_PARTS: readonly BodyPart[] = [
  'leftArm',
  'rightArm',
  'leftLeg',
  'rightLeg',
  'leftEye',
  'rightEye',
]

/** `region-3-2` → `D3`. Unknown shapes keep the engine's own `??`. */
export function formatRegionIdLabel(regionId: string): string {
  const match = /^region-(\d+)-(\d+)$/.exec(regionId)
  if (!match) return '??'
  return formatRegionGridLabel(Number(match[1]), Number(match[2]))
}

function woundsOf(body: BodyState): RunEpilogueWound[] {
  const wounds: RunEpilogueWound[] = []
  for (const part of BODY_PARTS) {
    const status = body[part]
    if (status === 'healthy') continue
    wounds.push({ part, status: status as RunEpilogueWoundStatus })
    if (wounds.length >= MAX_EPILOGUE_WOUNDS) break
  }
  return wounds
}

function companionsOf(
  companions: ActiveRunSaveV3['companions'],
): RunEpilogueCompanion[] {
  const byRole = new Map<ActorRole, number>()
  for (const companion of companions ?? []) {
    if (companion.health <= 0) continue
    byRole.set(companion.role, (byRole.get(companion.role) ?? 0) + 1)
  }
  return [...byRole.entries()]
    .map(([role, count]) => ({ role, count }))
    .sort((left, right) =>
      right.count === left.count
        ? left.role.localeCompare(right.role)
        : right.count - left.count,
    )
    .slice(0, MAX_EPILOGUE_COMPANIONS)
}

function controlOf(regionDeltas: ActiveRunSaveV3['regionDeltas']): RunEpilogueControl {
  const control: RunEpilogueControl = { neutral: 0, elf: 0, guard: 0, villain: 0 }
  for (const delta of Object.values(regionDeltas)) {
    control[delta.chronicle.control] += 1
  }
  return control
}

function beatsOf(
  log: readonly ChronicleEvent[],
  discovered: ReadonlySet<string>,
): RunEpilogueBeat[] {
  const ranked = [...log]
    .map((event) => ({
      event,
      score:
        BEAT_WEIGHT[event.kind] + (discovered.has(String(event.regionId)) ? WITNESSED_BONUS : 0),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      if (right.event.tick !== left.event.tick) return right.event.tick - left.event.tick
      // Total order, so two renders of one snapshot can never disagree.
      return left.event.id.localeCompare(right.event.id)
    })

  // Three beats should be three stories. A contested square can change hands four times in
  // one run, and without this the сводка reports the same sentence three times over.
  const chosen: (typeof ranked)[number][] = []
  const seen = new Set<string>()
  for (const candidate of ranked) {
    const pair = `${candidate.event.kind}:${String(candidate.event.regionId)}`
    if (seen.has(pair)) continue
    seen.add(pair)
    chosen.push(candidate)
    if (chosen.length >= MAX_EPILOGUE_BEATS) break
  }
  // A run whose whole chronicle happened in one square still gets its beats, just repeated
  // ones: reporting two when three exist would be a different kind of lie.
  for (const candidate of ranked) {
    if (chosen.length >= MAX_EPILOGUE_BEATS) break
    if (!chosen.includes(candidate)) chosen.push(candidate)
  }

  return chosen
    .sort((left, right) =>
      left.event.tick === right.event.tick
        ? left.event.id.localeCompare(right.event.id)
        : left.event.tick - right.event.tick,
    )
    .map(({ event }) => ({
      kind: event.kind,
      region: formatRegionIdLabel(String(event.regionId)),
      faction: event.faction,
      tick: Math.max(0, Math.trunc(event.tick)),
    }))
}

/**
 * The route, oldest square first, always ending where the run ended.
 *
 * When a run outgrows the bound the head is kept and the final square is spliced onto the
 * end: where a march started and where it stopped are the two squares a reader needs, and the
 * middle is what `routeTotal` is for. The final square is pulled out of the discovery order
 * rather than left where it was first seen, because a route that ends somewhere other than
 * where the body is reads as a contradiction.
 */
function routeOf(discoveredRegionIds: readonly string[], finalRegion: string): string[] {
  const labels = discoveredRegionIds.map(formatRegionIdLabel)
  if (labels.length === 0) return []
  const rest = labels.filter((label) => label !== finalRegion)
  return [...rest.slice(0, MAX_EPILOGUE_ROUTE - 1), finalRegion]
}

/**
 * Roadmap 1.6 — the doctrines the run went out under.
 *
 * Read from `directorState`, which is where the ledger lives (and *not* from
 * `RunConfig.modifiers`, which is launch configuration and stays reserved for launch-time
 * challenge rules). The сводка's stated purpose is to show whether two runs were genuinely
 * different, and the rules a run committed to are exactly that kind of difference — so this
 * field stops being the empty list 1.2 provisioned and starts carrying something.
 */
function doctrinesOf(directorState: ActiveRunSaveV3['directorState']): string[] {
  return normalizeDoctrineRunState(directorState.doctrines).equipped.slice(
    0,
    MAX_EPILOGUE_DOCTRINES,
  )
}

function causeOf(snapshot: ActiveRunSaveV3): RunEndCause {  if (snapshot.status === 'victory') return 'objectives'
  if (snapshot.status === 'abandoned') return 'abandoned'
  return snapshot.ending?.cause ?? 'unknown'
}

function elapsedOf(snapshot: ActiveRunSaveV3): number {
  const recorded = snapshot.achievementRunState.elapsedAtEnd
  if (Number.isFinite(recorded) && recorded > 0) return Math.max(0, Math.round(recorded))
  const directed = snapshot.directorState.elapsed
  return typeof directed === 'number' && Number.isFinite(directed)
    ? Math.max(0, Math.round(directed))
    : 0
}

export function buildRunEpilogue(snapshot: ActiveRunSaveV3): RunEpilogue {
  const discovered = new Set(snapshot.discoveredRegionIds.map(String))
  const achievements = snapshot.achievementRunState
  const finalRegion = formatRegionIdLabel(snapshot.currentLocation.regionId)
  return {
    route: routeOf(snapshot.discoveredRegionIds, finalRegion),
    routeTotal: discovered.size,
    regionsTotal: Math.max(
      WORLD_WIDTH * WORLD_HEIGHT,
      discovered.size,
      Object.keys(snapshot.regionDeltas).length,
    ),
    finalRegion,
    control: controlOf(snapshot.regionDeltas),
    beats: beatsOf(snapshot.chronicleState.log, discovered),
    wounds: woundsOf(snapshot.player.body),
    bleeding: snapshot.player.body.bleeding > 0,
    limbsLost: Math.max(0, Math.trunc(achievements.limbsLost)),
    injuries: Math.max(0, Math.trunc(achievements.injuries)),
    companions: companionsOf(snapshot.companions),
    doctrines: doctrinesOf(snapshot.directorState),
    cause: causeOf(snapshot),
    causeRole: snapshot.ending?.role ?? null,
    elapsed: elapsedOf(snapshot),
    caravansRobbed: Math.max(0, Math.trunc(achievements.caravansRobbed)),
    eventsCompleted: Math.max(0, Math.trunc(achievements.eventsCompleted)),
    bestKillStreak: Math.max(0, Math.trunc(achievements.bestKillStreak)),
  }
}
