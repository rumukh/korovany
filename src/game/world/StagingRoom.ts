/**
 * W1-6 — room for a set piece the player has reached, made by the player's own side.
 *
 * `ActorBudget` lets a category borrow the spare room of every category below it and never
 * hands it back. The generator's packs are `campaign`, which outranks `chronicle`, so a
 * contract the player chose and walked to can find every slot it needs held by packs that
 * nobody is fighting. W1-1 made the game's own events make way, and W1-6 stopped idle
 * garrison commanders from calling men. What can still crowd a contract out is a square full
 * of the player's own side: seed 1's guard «Зверьё у домиков» stands among eighteen of the
 * palace's own soldiers, and a beast raid needs five slots where four are left.
 *
 * So, only for a staging the player has reached, the player's **own** idle packs step back
 * into their squares, farthest first, as many as the staging is short:
 *
 * 1. **Who may go.** A generated pack that is not hostile to the player and is one of the
 *    generator's ordinary packs (`isParkableEncounterPlan`): never a boss slot, a unique or an
 *    objective. Every living member is idle, unwounded, at least
 *    {@link STAGING_PARK_MIN_DISTANCE} from the player and out of the camera's sight
 *    (`isHiddenFrom`). The engine never offers the squad, a commander, the finale, an event's
 *    actors or anything that is not one of the generator's packs. **A hostile pack is never
 *    reclaimed**: enemies do not vanish so that a contract can start.
 * 2. **What going means.** The pack is not beaten. It is never counted cleared, the members
 *    it lost before it went stay dead, and nothing drops, pays or is recorded, because nobody
 *    died. Its members are not saved anywhere: like every pack, they come back with their
 *    square.
 * 3. **How it comes back.** Once no staging has asked for room for
 *    {@link STAGING_PARK_HOLD_SECONDS}, when the whole pack fits and none of its stations is
 *    near the player or in sight (`canReturnPack`). If its square streams out first, it comes
 *    back with the square, once, like any pack.
 *
 * The rule takes a budget category, so a caravan beat that materialises into `campaign` can
 * ask for room the same way a contract asks for `chronicle` room.
 *
 * Pure data: no THREE, no scene, no clock and no random stream.
 */

import type { GeneratedEncounterPlan } from '../content/registry.ts'
import {
  ACTOR_BUDGET_PRIORITY,
  ActorBudget,
  type ActorBudgetCategory,
  type ActorBudgetUsage,
} from './ActorBudget.ts'

/**
 * No member of a pack nearer than this to the player ever steps back, and no pack comes back
 * this close.
 *
 * W1-1's `EVENT_ENGAGEMENT_RADIUS`: beyond 60 m the player has walked away from a fight. It is
 * past `MORALE_NOTICE_RANGE` (45 m), inside which the game treats a fight as one the player can
 * see, and past every pursuit leash — an archer's 18 m sense range times 2.25 is 40.5 m, a
 * beast's `BEAST_LEASH_RANGE` is 52 m.
 */
export const STAGING_PARK_MIN_DISTANCE = 60
/**
 * Added to the camera's horizontal half field of view before anything counts as out of sight.
 *
 * Ten degrees covers the view widening from `CAMERA_BASE_FOV` to `CAMERA_FOV_MAX` (56° to 65°
 * vertical, about five degrees of horizontal half angle at 16:9), the screen shake's roll
 * (0.7°) and a body a metre wide at 60 m (about one degree), with room to spare.
 */
export const STAGING_VIEW_MARGIN = (10 * Math.PI) / 180
/**
 * Seconds a pack stays away after the last request for room.
 *
 * Twice the 2 s retry of the bridge ambush and of a caravan beat on a full budget, so a staging
 * that is still retrying never watches its room walk back in between two attempts. A contract
 * asks every frame it stands on its site, so a stall that is not about room — no ground to
 * stand on — does not churn the same pack out and back in for twelve seconds.
 */
export const STAGING_PARK_HOLD_SECONDS = 4

export interface StagingPoint {
  x: number
  z: number
}

/** What the player could see right now. */
export interface StagingViewer {
  /** Where the player stands. The distance floor is measured from here. */
  player: StagingPoint
  /** Where the camera stands. The view cone is measured from here. */
  camera: StagingPoint
  /** The horizontal direction the camera looks. Need not be unit length. */
  forward: StagingPoint
  /** Half the camera's horizontal field of view, in radians. */
  halfFov: number
}

/** One body on the field, as far as making room is concerned. */
export interface StagingBody {
  alive: boolean
  hostileToPlayer: boolean
  x: number
  z: number
  /** Fighting, hunting, wounded, routing, alerted, ordered to fight or loading a cart. */
  busy: boolean
  /** The squad, a commander, the finale, an event's actor, a unique or an objective. */
  untouchable: boolean
}

/** One generator pack that might step back: its plan, and its living members. */
export interface StagingPack {
  /** The encounter id. Stable, so the choice never depends on list order. */
  key: string
  regionId: string
  /** Its living members, where they stand. */
  members: readonly StagingPoint[]
  /** Any member busy, untouchable or hostile to the player: this pack stays. */
  busy: boolean
}

/**
 * Whether a plan is one of the player's own side's ordinary packs. A pack hostile to the
 * player never steps back, and a boss slot or any pack with a unique or objective spawn in it
 * is a set piece of its own.
 */
export function isParkableEncounterPlan(
  plan: Pick<GeneratedEncounterPlan, 'kind' | 'spawns' | 'hostileToPlayer'>,
): boolean {
  return (
    !plan.hostileToPlayer &&
    plan.kind !== 'boss' &&
    !plan.spawns.some((spawn) => spawn.unique || spawn.objective || spawn.objectiveEligible)
  )
}

/**
 * The packs of the simulated squares that could step back, with their living members. A plan
 * that may not step back, or that has nobody alive on the field, is left out. `membersOf` is
 * asked only about plans that may step back, so nobody else is ever looked at.
 */
export function gatherStagingPacks(
  regionIds: Iterable<string>,
  plansIn: (regionId: string) => readonly GeneratedEncounterPlan[],
  membersOf: (regionId: string, encounterId: string) => readonly StagingBody[],
): StagingPack[] {
  const packs: StagingPack[] = []
  for (const regionId of regionIds) {
    for (const plan of plansIn(regionId)) {
      if (!isParkableEncounterPlan(plan)) continue
      const bodies = membersOf(regionId, plan.encounterId)
      const members = bodies.filter((body) => body.alive)
      if (members.length === 0) continue
      packs.push({
        key: plan.encounterId,
        regionId,
        members: members.map((body) => ({ x: body.x, z: body.z })),
        busy: members.some((body) => body.busy || body.untouchable || body.hostileToPlayer),
      })
    }
  }
  return packs
}

/** Half the horizontal field of view of a camera with this vertical one, in radians. */
export function horizontalHalfFov(verticalFovDegrees: number, aspect: number): number {
  return Math.atan(Math.tan((verticalFovDegrees * Math.PI) / 360) * aspect)
}

/**
 * Whether the player could not see `point` from the camera: outside the horizontal view cone
 * and its margin. Anything undecidable — no view direction, non-finite numbers — counts as
 * seen.
 *
 * Only the cone, never distance or fog. A body straight ahead is in sight however far off
 * it stands, and a horizontal wedge is the cautious reading of the camera's frustum: for a
 * body at least {@link STAGING_PARK_MIN_DISTANCE} away, pitching the camera only narrows the
 * strip of ground it shows.
 */
export function isHiddenFrom(viewer: StagingViewer, point: StagingPoint): boolean {
  const length = Math.hypot(viewer.forward.x, viewer.forward.z)
  if (!(length > 0) || !Number.isFinite(length)) return false
  const forwardX = viewer.forward.x / length
  const forwardZ = viewer.forward.z / length
  const dx = point.x - viewer.camera.x
  const dz = point.z - viewer.camera.z
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return false
  const depth = dx * forwardX + dz * forwardZ
  const lateral = Math.abs(dx * forwardZ - dz * forwardX)
  return Math.atan2(lateral, depth) > viewer.halfFov + STAGING_VIEW_MARGIN
}

function distanceFromPlayer(viewer: StagingViewer, point: StagingPoint): number {
  return Math.hypot(point.x - viewer.player.x, point.z - viewer.player.z)
}

/** How close the pack's nearest living member stands to the player. */
export function packDistance(viewer: StagingViewer, pack: StagingPack): number {
  let nearest = Number.POSITIVE_INFINITY
  for (const member of pack.members) {
    nearest = Math.min(nearest, distanceFromPlayer(viewer, member))
  }
  return nearest
}

/** Whether a pack may step back into its square right now. */
export function canParkPack(viewer: StagingViewer, pack: StagingPack): boolean {
  if (pack.busy || pack.members.length === 0) return false
  return pack.members.every(
    (member) =>
      distanceFromPlayer(viewer, member) >= STAGING_PARK_MIN_DISTANCE &&
      isHiddenFrom(viewer, member),
  )
}

/**
 * Whether a pack that stepped back may come back onto these stations right now: none of them
 * near the player, and none in sight.
 */
export function canReturnPack(
  viewer: StagingViewer,
  stations: readonly StagingPoint[],
): boolean {
  if (stations.length === 0) return false
  return stations.every(
    (station) =>
      distanceFromPlayer(viewer, station) >= STAGING_PARK_MIN_DISTANCE &&
      isHiddenFrom(viewer, station),
  )
}

/**
 * The packs that step back for `shortfall` slots: whole packs that {@link canParkPack},
 * farthest first by their nearest member, stopping as soon as the shortfall is covered.
 *
 * `null` when every eligible pack together would not cover it, so nobody goes for a staging
 * that could not happen anyway. An empty list when nothing is short.
 */
export function choosePacksToPark<T extends StagingPack>(
  viewer: StagingViewer,
  packs: readonly T[],
  shortfall: number,
): T[] | null {
  if (!(shortfall > 0)) return []
  const eligible = packs
    .filter((pack) => canParkPack(viewer, pack))
    .map((pack) => ({ pack, away: packDistance(viewer, pack) }))
    .sort(
      (left, right) =>
        right.away - left.away ||
        (left.pack.key < right.pack.key ? -1 : left.pack.key > right.pack.key ? 1 : 0),
    )
  const chosen: T[] = []
  let freed = 0
  for (const { pack } of eligible) {
    if (freed >= shortfall) break
    chosen.push(pack)
    freed += pack.members.length
  }
  return freed >= shortfall ? chosen : null
}

/** The living bodies every pack that could step back right now would free. */
export function parkableBodies(viewer: StagingViewer, packs: readonly StagingPack[]): number {
  let count = 0
  for (const pack of packs) if (canParkPack(viewer, pack)) count += pack.members.length
  return count
}

/**
 * Slots `category` could take once every category below it gave up everything it may: all of
 * it, except `pinned` — a contract's own fighters, which `yieldActorSlots` never hands over.
 *
 * Arithmetic on a scratch ledger, the same as W1-1's dry run. For `chronicle` with nothing
 * pinned it is exactly `ActorBudget.capacityFor('chronicle')`.
 */
export function stagingCapacity(
  usage: ActorBudgetUsage,
  category: ActorBudgetCategory,
  pinned: Partial<ActorBudgetUsage> = {},
): number {
  const settled: ActorBudgetUsage = { ...usage }
  for (const lower of ACTOR_BUDGET_PRIORITY.slice(ACTOR_BUDGET_PRIORITY.indexOf(category) + 1)) {
    settled[lower] = Math.min(usage[lower], Math.max(0, pinned[lower] ?? 0))
  }
  const ledger = new ActorBudget()
  ledger.sync(settled)
  return ledger.availableFor(category)
}
