export const SQUAD_FOLLOW_CRUISE_SPEED = 9.2
export const SQUAD_FOLLOW_MAX_SPEED = 15.5

const SQUAD_CATCH_UP_START_DISTANCE = 4.3
const SQUAD_CATCH_UP_FULL_DISTANCE = 20

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
