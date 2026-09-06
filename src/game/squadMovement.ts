import type { ActorRole, Faction } from './types'
import type { SquadPoint } from './world/SquadCommand'

export const SQUAD_FOLLOW_CRUISE_SPEED = 9.2
export const SQUAD_FOLLOW_MAX_SPEED = 15.5
export const SQUAD_REGROUP_DISTANCE = 14
export const STARTING_SQUAD_VERSION = 1

const SQUAD_CATCH_UP_START_DISTANCE = 4.3
const SQUAD_CATCH_UP_FULL_DISTANCE = 20

export interface StartingSquadMember {
  role: ActorRole
  offsetX: number
  offsetZ: number
}

const STARTING_SQUADS: Record<Faction, readonly StartingSquadMember[]> = {
  elf: [
    { role: 'scout', offsetX: -3.2, offsetZ: 3.4 },
    { role: 'archer', offsetX: 3.2, offsetZ: 3.4 },
    { role: 'scout', offsetX: 0, offsetZ: 5.5 },
  ],
  guard: [
    { role: 'soldier', offsetX: -3.2, offsetZ: 3.4 },
    { role: 'archer', offsetX: 3.2, offsetZ: 3.4 },
    { role: 'soldier', offsetX: 0, offsetZ: 5.5 },
  ],
  villain: [
    { role: 'minion', offsetX: -3.2, offsetZ: 3.4 },
    { role: 'brute', offsetX: 3.2, offsetZ: 3.4 },
    { role: 'archer', offsetX: 0, offsetZ: 5.5 },
  ],
}

export function getStartingSquad(faction: Faction): readonly StartingSquadMember[] {
  return STARTING_SQUADS[faction]
}

export function shouldInitializeStartingSquad(version: unknown, restoredCompanions = 0): boolean {
  return version !== STARTING_SQUAD_VERSION && restoredCompanions === 0
}

export function startingSquadIdentity(faction: Faction, index: number): string {
  return `squad:${faction}:starter:${index}`
}

export function shouldSquadRegroup(playerDistance: number): boolean {
  return playerDistance > SQUAD_REGROUP_DISTANCE
}

export function getSquadFollowSpeed(baseSpeed: number, playerDistance: number): number {
  const catchUpProgress = Math.min(
    1,
    Math.max(
      0,
      (playerDistance - SQUAD_CATCH_UP_START_DISTANCE) /
        (SQUAD_CATCH_UP_FULL_DISTANCE - SQUAD_CATCH_UP_START_DISTANCE),
    ),
  )
  const followSpeed =
    SQUAD_FOLLOW_CRUISE_SPEED +
    (SQUAD_FOLLOW_MAX_SPEED - SQUAD_FOLLOW_CRUISE_SPEED) * catchUpProgress
  return Math.max(baseSpeed, followSpeed)
}

export interface SquadNavigationQueries {
  findPath: (start: SquadPoint, destination: SquadPoint) => readonly SquadPoint[] | null
  pathClear: (start: SquadPoint, destination: SquadPoint) => boolean
  walkable: (point: SquadPoint) => boolean
}

export function findSquadNavigationPath(
  start: SquadPoint,
  destination: SquadPoint,
  queries: SquadNavigationQueries,
): readonly SquadPoint[] | null {
  const path = queries.findPath(start, destination)
  if (path) return path
  // A collision-valid foot position can sit in a blocked 2m navigation cell.
  // Walk a short clear connector onto the grid; never snap the actor onto it.
  if (!queries.walkable(start) || queries.findPath(start, start) !== null ||
    queries.findPath(destination, destination) === null) return null
  for (let ring = 1; ring <= 3; ring += 1) {
    for (let step = 0; step < 12; step += 1) {
      const angle = step * Math.PI / 6
      const connector = {
        x: start.x + Math.cos(angle) * ring * 0.8,
        z: start.z + Math.sin(angle) * ring * 0.8,
      }
      if (!queries.walkable(connector) || !queries.pathClear(start, connector)) continue
      const connected = queries.findPath(connector, destination)
      if (connected) return [connector, ...connected.slice(1)]
    }
  }
  return null
}
