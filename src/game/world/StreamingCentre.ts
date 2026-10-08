/**
 * W3-4 — where the streamed world is centred, and why it does not jump straight back.
 *
 * `GeneratedWorldRuntime` builds its `RegionManager` around one square, the centre: it shows the
 * 3x3 around it and simulates the five-square plus inside that. Until W3-4 the centre was simply
 * the square under the player's feet, frame by frame. A player stepping back and forth over an
 * edge recentred the world on every crossing: three squares were built and three thrown away,
 * three squares' packs went home and three others were fielded, and the diagonal squares in
 * plain view lost their packs and got them back. A scripted player pinned against an edge did it
 * every frame, and fielded tens of thousands of bodies a run.
 *
 * The rule is a hold on the way back, nothing more:
 *
 * 1. Stepping into a square that is not the one just left moves the centre at once, exactly as
 *    before. Walking on never waits, so nothing ahead is seen or fielded any later than it was.
 * 2. Turning back into the square just left — the previous centre, an edge neighbour of the
 *    current one — keeps the current centre while the player is within
 *    {@link STREAMING_RETURN_HOLD_METRES} of it. Only past that does the world recentre.
 *
 * The simulated set is always exactly the plus around the centre, and the player's square is
 * always in it: rule 2 holds only for an edge neighbour, and any other square moves the centre.
 * The actor budget and its reservations never see more than the plus. Nothing here is saved: a
 * continue centres the world on the square the player stands in.
 *
 * Pure data: no THREE, no scene, no clock and no random stream.
 */

/**
 * How far into the square just left the player may step back before the world recentres on it.
 *
 * A soldier senses at 15 m (an archer at 18), so a player who fights across an edge, or steps
 * back out of a soldier's reach from it, stays inside the hold. It is a fifth of an 80 m square,
 * about two seconds of walking at 8.2 m/s. While turned back, the nearest unloaded ground is at
 * least 80 − 16 = 64 m away, 16 m past where clear-weather fog begins (48 m; rain and storm fog
 * begin at 18 to 32 m), against 80 m before.
 */
export const STREAMING_RETURN_HOLD_METRES = 16

export interface StreamingPoint {
  x: number
  z: number
}

/** What the hold needs of a square: its grid coordinate and its bounds. */
export interface StreamingSquare<Id = string> {
  id: Id
  coordinate: { x: number; z: number }
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
}

export interface StreamingCentreState<Id = string> {
  /** The square the world is centred on, or null before the first update. */
  centre: Id | null
  /** The centre before the last move: the square a player turning back steps into. */
  previous: Id | null
}

export function createStreamingCentreState<Id = string>(): StreamingCentreState<Id> {
  return { centre: null, previous: null }
}

/** Metres from `point` to the nearest point of `bounds`; zero inside them. */
export function distanceToSquare(point: StreamingPoint, bounds: StreamingSquare['bounds']): number {
  const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX)
  const dz = Math.max(bounds.minZ - point.z, 0, point.z - bounds.maxZ)
  return Math.hypot(dx, dz)
}

function edgeNeighbours(left: StreamingSquare<unknown>, right: StreamingSquare<unknown>): boolean {
  return Math.abs(left.coordinate.x - right.coordinate.x) + Math.abs(left.coordinate.z - right.coordinate.z) === 1
}

/**
 * The centre for a player standing at `focus` in `square`. True when it moved. `squareOf` looks
 * a centre's square up; `holdMetres` is the hold, zero for the rule before W3-4.
 */
export function advanceStreamingCentre<Id>(
  state: StreamingCentreState<Id>,
  square: StreamingSquare<Id>,
  focus: StreamingPoint,
  squareOf: (id: Id) => StreamingSquare<Id> | undefined,
  holdMetres = STREAMING_RETURN_HOLD_METRES,
): boolean {
  const centreId = state.centre
  if (centreId !== null && String(centreId) === String(square.id)) return false
  if (centreId !== null && state.previous !== null && String(state.previous) === String(square.id)) {
    const centre = squareOf(centreId)
    if (centre && edgeNeighbours(centre, square) && distanceToSquare(focus, centre.bounds) < holdMetres) {
      return false
    }
  }
  state.previous = centreId
  state.centre = square.id
  return true
}

/** A teleport: the world centres on `squareId` at once, with nothing to turn back into. */
export function recentreStreaming<Id>(state: StreamingCentreState<Id>, squareId: Id): boolean {
  const moved = state.centre === null || String(state.centre) !== String(squareId)
  state.previous = null
  state.centre = squareId
  return moved
}
