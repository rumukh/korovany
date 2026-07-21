import type { ActorRole, Faction } from './types'

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

export function shouldInitializeStartingSquad(version: unknown): boolean {
  return version !== STARTING_SQUAD_VERSION
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
