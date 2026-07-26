/**
 * Headless AI harness.
 *
 * `GameEngine` cannot be instantiated without a WebGL context, so the decision half of
 * actor AI was extracted into the pure `world/ActorAi.ts` (with an equivalence control in
 * `tests/actorAi.test.ts` proving the extraction changed nothing). This file drives that
 * real code over many simulated frames so questions about behaviour can be *counted*
 * rather than reasoned about.
 *
 * WHAT IT IS: the game's actual target selection (`selectCombatTarget` for the Layer 3
 * arm, `selectThreat` for the Layer 4 one), morale (`beastPackShare` + `shouldBeastRout`,
 * or the unified `evaluateMorale` + `localGroupShare`), player-pursuit gating
 * (`evaluatePlayerPursuit`), and the real `BEAST_PROFILES` numbers, run on a fixed frame
 * delta with a seeded stream.
 *
 * WHAT IT IS NOT: the full simulation. Movement here is a straight line at role speed with
 * no navmesh, no collision, no steering, no separation, and no terrain. Attacks land at
 * contact range on a cooldown with no wind-up, poise, stagger or knockback. So a number
 * from this harness describes **what the decision logic does**, not what a player would
 * experience. Where that distinction could change a conclusion, it is called out at the
 * assertion.
 *
 * **It cannot say anything at all about flanking.** Flanking is an approach path, and an
 * approach path needs the steering, separation and collision this file does not have.
 * The flanking rules are tested directly as geometry in `tests/actorAi.test.ts` and
 * checked by eye in the browser; no number here is about them.
 *
 * ---
 *
 * **READ THIS BEFORE YOU MODEL A NEW BEHAVIOUR: the movement model is where this file's
 * errors come from, and they come back in new clothes.**
 *
 * Twice now the same mistake has inverted a measurement, and both times the *decision*
 * code was correct and the harness's idea of what an actor does with that decision was
 * not:
 *
 * 1. Layer 3 modelled a routed wolf as "skip your turn". Broken wolves stood still and
 *    were killed where they stood, so routing looked like it made things *worse*.
 * 2. Layer 4 modelled a broken non-beast as "run home" — from a rally point it was
 *    already standing on. Same failure, different disguise: a no-op step, an actor
 *    absorbing hits without fighting, and numbers that flattered the arm without morale.
 *
 * The pattern is that a behaviour whose whole point is **disengaging** degenerates into
 * standing in the fight not fighting, which is strictly worse than either real outcome
 * and therefore biases the comparison hard. Anything you add whose purpose is to leave,
 * avoid, retreat, take cover or keep distance is a candidate for exactly this, and it
 * will not announce itself — it looks like a plausible number.
 *
 * So: when you model a behaviour here, check that the actor's **position actually
 * changes** in the direction the behaviour claims, and prove the arm against something
 * known before you trust it. `nearestThreat` and the three flee branches in `runFight`
 * are the load-bearing part of this file; they are not incidental plumbing.
 *
 * **Layer 5's civilian panic is the third such behaviour and was written against this
 * warning.** A villager that panicked but stood still would be a bystander taking hits
 * without fighting — the exact degenerate case above — and it would make scattering look
 * like it *increases* civilian deaths. `tests/ambientLife.test.ts` therefore asserts the
 * displacement directly: that a panicking villager's distance from what frightened it
 * grows, with a control that the same villager standing still does not.
 *
 * ---
 *
 * Both Layer 4 arms are off by default. That is deliberate: it keeps every pre-existing
 * measurement in `tests/aiQuestions.test.ts` running the code it originally ran, which is
 * the check that this file's Layer 4 extension did not quietly change the Layer 3 answers.
 */

import {
  BEAST_PROFILES,
  shouldBeastRout,
  WOLF_PACK_RADIUS,
  BEAST_SENSE_RANGE,
  BEAST_LEASH_RANGE,
} from '../src/game/world/Fauna.ts'
import {
  aiDistance,
  beastPackShare,
  evaluateMorale,
  evaluatePlayerPursuit,
  findCivilianAlarm,
  isPacifistRole,
  localGroupShare,
  selectCombatTarget,
  selectThreat,
  THREAT_PLAYER,
  type AiActor,
  type AiPoint,
  type MoraleBreak,
} from '../src/game/world/ActorAi.ts'
import {
  CIVILIAN_ALARM_RADIUS,
  CIVILIAN_PANIC_RECOVERY,
  CIVILIAN_PANIC_SECONDS,
  CIVILIAN_PANIC_SPEED_MULTIPLIER,
} from '../src/game/world/AmbientLife.ts'
import { isBeastRole, areAllegiancesHostile, type ActorRole, type Allegiance } from '../src/game/types.ts'
import type { RandomStream } from '../src/game/random/RandomStream.ts'

/** One simulated frame. 20 Hz: fine enough for approach and contact, cheap to run. */
export const HARNESS_FRAME = 0.05
/** Melee reach, matching the engine's actor-vs-actor stop distance. */
export const HARNESS_CONTACT_RANGE = 2.45
/** Seconds between melee swings, matching the engine's `meleeActor` cooldown. */
export const HARNESS_ATTACK_COOLDOWN = 1.3
/**
 * How long a body stays countable for morale, matching the engine's `CORPSE_LIFETIME`.
 *
 * This one number is why the harness can say anything about morale at all. `localGroupShare`
 * counts standing allies against fallen ones, and the engine drops a corpse from the actor
 * list after twelve seconds — so morale there is a memory of *recent* losses. Leaving
 * corpses in the harness forever would depress `groupShare` permanently and manufacture
 * routs that the game would never produce.
 */
export const HARNESS_CORPSE_LIFETIME = 12
/** Matches the engine's `MORALE_GROUP_RADIUS`. */
export const HARNESS_MORALE_RADIUS = 14
/** Matches the engine's `MORALE_ROUT_SECONDS` for anything that is not a beast. */
export const HARNESS_ROUT_SECONDS = 7
/** Matches the engine's `MORALE_RALLY_POINT_TOLERANCE`. */
export const HARNESS_RALLY_TOLERANCE = 3
/** Matches the engine's `MORALE_LAST_STAND_SECONDS`. */
export const HARNESS_LAST_STAND_SECONDS = 2
/** Matches the engine's `MORALE_RALLY_SECONDS`. */
export const HARNESS_RALLY_SECONDS = 12
/**
 * How far a bystander gets from home before the harness treats it as gone.
 *
 * The engine despawns a villager that strays past `CIVILIAN_SPAWN_RADIUS +
 * CIVILIAN_HOME_RADIUS` from the player, so a chase does not run to the map edge. Without
 * an equivalent here a panicking villager and the wolf behind it run forever, no fight
 * ever resolves, and — worse — "got away" is invisible, which is the single most
 * interesting thing about the behaviour under test.
 */
export const HARNESS_ESCAPE_DISTANCE = 74

export interface HarnessFighter extends AiActor {
  role: ActorRole
  position: { x: number; y: number; z: number }
  hp: number
  maxHp: number
  speed: number
  damage: number
  hostileToPlayer: boolean
  playerAggro: boolean
  aggroMemory: number
  attackCooldown: number
  routTimer: number
  /** Set once when this fighter breaks, so routs can be counted rather than sampled. */
  routed: boolean
  /** Layer 4 — why it is running, and the latch that grants rally immunity when it stops. */
  routReason: MoraleBreak
  /** Layer 4 — where a broken non-beast falls back to, matching `Actor.home`. */
  home: { x: number; y: number; z: number }
  /** Layer 4 — seconds of morale immunity after recovering or being rallied. */
  rallyTimer: number
  /** Layer 4 — elapsed seconds at death, so corpses age out of the morale count. */
  deathAt: number | null
  /** Layer 5 — what a panicking bystander is running from, matching `Actor.alarmPos`. */
  alarmPos: AiPoint | null
  /** Layer 5 — how far this fighter has been displaced by fleeing, for the disengage check. */
  fledDistance: number
}

export interface HarnessOptions {
  /** Layer 3's wolf rule. Turning it off is the A/B arm for "does routing matter?". */
  packRoutEnabled?: boolean
  /**
   * Layer 4 — the individual half of `evaluateMorale`. Off leaves exactly Layer 3's
   * cohesion rule, which is what makes this a real A/B rather than a re-run.
   */
  individualMorale?: boolean
  /**
   * Layer 4 — score the player in the same pass as every NPC (`selectThreat`) instead of
   * Layer 3's "player first, then nearest" (`evaluatePlayerPursuit` + `selectCombatTarget`).
   * The off arm calls the real Layer 3 functions, which are still exported for exactly
   * this reason, so both arms are shipped code rather than a re-implementation.
   */
  threatScoring?: boolean
  /**
   * Layer 5 — bystanders scatter from a fight rather than standing in it.
   *
   * Off is the arm *without* the mechanism, and off must mean "carries on with its day",
   * not "stands still": a villager frozen in the fight not fighting is the degenerate
   * model the file header warns about, and it would make scattering look like it
   * increases civilian deaths. With the arm off a villager keeps walking its route, which
   * is exactly what the engine does when nothing has frightened it.
   */
  civilianPanic?: boolean
  /** Player stands still and fights back; omit for an NPC-only brawl. */
  player?: { x: number; z: number; hp: number; damage: number } | null
  /** Frames to run before giving up on a stalemate. */
  maxFrames?: number
}

export interface HarnessResult {
  frames: number
  /** Melee connections, by the allegiance that threw them. Dense: thousands per batch. */
  attacksBy: Record<string, number>
  /** Melee connections, by what was hit: an allegiance, or `player`. */
  attacksAgainst: Record<string, number>
  /** Melee connections, by the *role* that was hit — the metric role preference moves. */
  attacksAgainstRole: Record<string, number>
  /** Damage dealt, by attacker allegiance. */
  damageBy: Record<string, number>
  /** Damage taken, by victim allegiance or `player`. */
  damageAgainst: Record<string, number>
  deathsBy: Record<string, number>
  /** Beasts that broke and cleared the field. Alive, but no longer in the fight. */
  fledBy: Record<string, number>
  survivorsBy: Record<string, number>
  /**
   * Rout *events*, not distinct fighters. Layer 4 lets a rallied actor break a second
   * time, so counting fighters would silently stop rising once everybody had broken once.
   */
  routs: number
  /** Layer 4 — routs by reason, so cohesion and individual morale can be told apart. */
  routsByReason: Record<string, number>
  /** Layer 4 — routs by the role that broke, which is how "never routs" is checked. */
  routsByRole: Record<string, number>
  /**
   * Layer 5 — metres of displacement produced by the flee branches, **by rout reason**.
   *
   * The disengage check the file header demands, as a number rather than a promise: a
   * behaviour whose point is leaving must move somebody, and this is what a test asserts
   * against. By reason rather than by role on purpose — a villager can leave through the
   * ordinary individual door too, and lumping the two together would let a broken
   * `panic` branch hide behind displacement it did not cause.
   */
  fledDistanceByReason: Record<string, number>
  playerHp: number
  /** True when one side was wiped out rather than the frame budget running out. */
  resolved: boolean
}

let nextId = 0

export function makeFighter(
  allegiance: Allegiance,
  role: ActorRole,
  x: number,
  z: number,
  options: Partial<HarnessFighter> = {},
): HarnessFighter {
  const beast = isBeastRole(role) ? BEAST_PROFILES[role] : null
  const hp =
    beast?.hp ?? (role === 'brute' ? 130 : role === 'archer' ? 45 : role === 'peasant' ? 26 : 70)
  nextId += 1
  return {
    id: options.id ?? `${allegiance}-${role}-${nextId}`,
    allegiance,
    role,
    alive: true,
    ignoredTargetId: null,
    targetId: null,
    packId: null,
    packKinSize: 1,
    position: { x, y: 0, z },
    home: { x, y: 0, z },
    hp,
    maxHp: hp,
    speed: beast?.speed ?? (role === 'brute' ? 2.6 : role === 'peasant' ? 3.1 : 3.7),
    damage: beast?.meleeDamage ?? (role === 'brute' ? 14 : 13),
    hostileToPlayer: true,
    playerAggro: false,
    aggroMemory: 0,
    attackCooldown: 0,
    routTimer: 0,
    routed: false,
    routReason: 'none',
    rallyTimer: 0,
    deathAt: null,
    alarmPos: null,
    fledDistance: 0,
    ...options,
  }
}

const positionOf = (fighter: HarnessFighter): AiPoint => fighter.position

function bump(counter: Record<string, number>, key: string, amount = 1): void {
  counter[key] = (counter[key] ?? 0) + amount
}

function senseRangeFor(fighter: HarnessFighter): number {
  return isBeastRole(fighter.role) ? BEAST_SENSE_RANGE : 15
}

function leashRangeFor(fighter: HarnessFighter): number {
  return isBeastRole(fighter.role) ? BEAST_LEASH_RANGE : 15 * 2.25
}

function step(from: AiPoint, toward: AiPoint, distance: number): void {
  const dx = toward.x - from.x
  const dz = toward.z - from.z
  const length = Math.hypot(dx, dz)
  if (length < 0.0001) return
  const scale = Math.min(distance, length) / length
  ;(from as { x: number }).x += dx * scale
  ;(from as { z: number }).z += dz * scale
}

/** Nearest thing this fighter is at war with, the player included. */
function nearestThreat(
  fighter: HarnessFighter,
  living: readonly HarnessFighter[],
  player: { x: number; z: number; alive: boolean } | null,
): AiPoint | null {
  let nearest: AiPoint | null = null
  let best = Number.POSITIVE_INFINITY
  if (player?.alive && fighter.hostileToPlayer) {
    const point = { x: player.x, y: 0, z: player.z }
    best = aiDistance(fighter.position, point)
    nearest = point
  }
  for (const other of living) {
    if (other === fighter || !other.alive) continue
    if (!areAllegiancesHostile(fighter.allegiance, other.allegiance)) continue
    const distance = aiDistance(fighter.position, other.position)
    if (distance >= best) continue
    best = distance
    nearest = other.position
  }
  return nearest
}

/**
 * Runs one fight to a conclusion. Deterministic given the same fighters and rng state:
 * the only stochastic element is the attack jitter, drawn from the seeded stream.
 */
export function runFight(
  fighters: HarnessFighter[],
  rng: RandomStream,
  options: HarnessOptions = {},
): HarnessResult {
  const packRoutEnabled = options.packRoutEnabled ?? true
  const individualMorale = options.individualMorale ?? false
  const threatScoring = options.threatScoring ?? false
  const civilianPanic = options.civilianPanic ?? false
  const maxFrames = options.maxFrames ?? 3_000
  const player = options.player ? { ...options.player, alive: true } : null
  const playerMaxHp = player?.hp ?? 1

  const result: HarnessResult = {
    frames: 0,
    attacksBy: {},
    attacksAgainst: {},
    attacksAgainstRole: {},
    damageBy: {},
    damageAgainst: {},
    deathsBy: {},
    fledBy: {},
    survivorsBy: {},
    routs: 0,
    routsByReason: {},
    routsByRole: {},
    fledDistanceByReason: {},
    playerHp: player?.hp ?? 0,
    resolved: false,
  }

  let now = 0
  const kill = (fighter: HarnessFighter): void => {
    fighter.alive = false
    fighter.deathAt = now
    bump(result.deathsBy, fighter.allegiance)
  }

  /**
   * Everything still worth counting for morale: the living, plus bodies that have not
   * yet aged out. The engine's actor list has exactly this shape because corpses linger
   * for `CORPSE_LIFETIME` and are then removed.
   */
  const moraleView = (): HarnessFighter[] =>
    fighters.filter(
      (fighter) =>
        fighter.alive ||
        (fighter.deathAt !== null && now - fighter.deathAt < HARNESS_CORPSE_LIFETIME),
    )

  for (let frame = 0; frame < maxFrames; frame += 1) {
    result.frames = frame + 1
    now = frame * HARNESS_FRAME
    const living = fighters.filter((fighter) => fighter.alive)
    const sides = new Set(living.map((fighter) => fighter.allegiance))
    // Over when nothing left can fight anything else.
    const anyHostility =
      living.some(
        (fighter) =>
          player?.alive &&
          fighter.hostileToPlayer &&
          !(packRoutEnabled && fighter.routTimer > 0),
      ) ||
      living.some((fighter) =>
        living.some(
          (other) =>
            other !== fighter &&
            selectCombatTarget(fighter, living, 1_000, positionOf) === other,
        ),
      )
    if (!anyHostility || (sides.size === 0 && !player?.alive)) {
      result.resolved = true
      break
    }

    const morale = individualMorale ? moraleView() : living

    for (const fighter of living) {
      fighter.attackCooldown = Math.max(0, fighter.attackCooldown - HARNESS_FRAME)
      fighter.aggroMemory = Math.max(0, fighter.aggroMemory - HARNESS_FRAME)
      fighter.routTimer = Math.max(0, fighter.routTimer - HARNESS_FRAME)
      fighter.rallyTimer = Math.max(0, fighter.rallyTimer - HARNESS_FRAME)

      // Morale, using the real rule. Layer 3's arm is cohesion only; Layer 4's is the
      // unified `evaluateMorale`, whose second half can break things cohesion cannot.
      //
      // Mirrors the engine's ordering exactly: a rout whose clock has run out grants
      // rally immunity *before* the next check rather than re-breaking on the same
      // frame. Getting that wrong in the engine made a broken soldier run forever.
      if (fighter.routTimer <= 0 && fighter.routReason !== 'none') {
        const panicked = fighter.routReason === 'panic'
        fighter.routReason = 'none'
        fighter.alarmPos = null
        fighter.rallyTimer = panicked ? CIVILIAN_PANIC_RECOVERY : HARNESS_RALLY_SECONDS
      } else if (fighter.routTimer > 0 && fighter.routReason === 'panic') {
        // §5D — panic tracks, exactly as `GameEngine.updateActorMorale` does. A villager
        // that stopped every four seconds would be caught by anything, and one running
        // from a frozen `alarmPos` curves back into what is chasing it.
        const chasing = findCivilianAlarm(
          fighter,
          morale,
          CIVILIAN_ALARM_RADIUS,
          positionOf,
          null,
        )
        if (chasing) {
          fighter.routTimer = CIVILIAN_PANIC_SECONDS
          fighter.alarmPos = chasing.source
        }
      } else if (packRoutEnabled && fighter.routTimer <= 0 && fighter.rallyTimer <= 0) {
        const packShare = beastPackShare(fighter, living, WOLF_PACK_RADIUS, positionOf)
        // Layer 5 — the alarm search only runs for bystanders, and only in the arm that
        // has the mechanism. With it off `alarmDistance` is `Infinity`, which is the
        // honest "nothing measured" value rather than a `??` default (see `MoraleInput`).
        //
        // It scans `morale`, not `living`, because the engine scans `this.actors` — which
        // keeps corpses for `CORPSE_LIFETIME` — and a body in the road is one of the three
        // things §5D.3 says is alarming. Scanning the living only would model a village
        // that stops caring the instant somebody stops moving.
        const alarm =
          civilianPanic && isPacifistRole(fighter.role)
            ? findCivilianAlarm(fighter, morale, CIVILIAN_ALARM_RADIUS, positionOf, null)
            : null
        const broke = individualMorale
          ? evaluateMorale(fighter.role, {
              hpFraction: fighter.maxHp > 0 ? fighter.hp / fighter.maxHp : 1,
              groupShare: localGroupShare(
                fighter,
                morale,
                HARNESS_MORALE_RADIUS,
                positionOf,
              ),
              packShare,
              commanderNearby: false,
              commanderLost: false,
              alarmDistance: alarm ? alarm.distance : Number.POSITIVE_INFINITY,
            })
          : isBeastRole(fighter.role) && shouldBeastRout(fighter.role, packShare)
            ? 'cohesion'
            : 'none'
        if (broke !== 'none') {
          fighter.routTimer =
            broke === 'panic'
              ? CIVILIAN_PANIC_SECONDS
              : isBeastRole(fighter.role)
                ? 9
                : HARNESS_ROUT_SECONDS
          if (broke === 'panic' && alarm) fighter.alarmPos = alarm.source
          fighter.routReason = broke
          fighter.targetId = null
          fighter.playerAggro = false
          if (!fighter.routed) {
            fighter.routed = true
          }
          result.routs += 1
          bump(result.routsByReason, broke)
          bump(result.routsByRole, fighter.role)
        }
      }
      // A routed fighter runs, exactly as `GameEngine.updateRoutingActor` does — it does
      // not stand there absorbing hits. Modelling the rout as "skip your turn" inverted
      // the first measurement taken with this harness, so the flee is not optional.
      //
      // A beast runs from whatever broke it and is gone past the leash. Anything else
      // falls back on its rally point and stays in the world, which is what keeps a
      // campaign objective from walking off the map because it lost a morale check.
      if (packRoutEnabled && fighter.routTimer > 0) {
        const before = { ...fighter.position }
        if (fighter.routReason === 'panic') {
          // §5D — a villager puts the thing that frightened it behind itself. It has no
          // rally point, and `alarmPos` rather than `nearestThreat` because what
          // frightened it is very often not hostile to it: two soldiers fighting each
          // other are `neutral` to a villager and a hostility search would miss them.
          //
          // **This step is the load-bearing line of the Layer 5 measurement.** Model it
          // as "skip your turn" and a panicking villager stands in the fight not
          // fighting, which is strictly worse than either real outcome and would make
          // the arm *with* scattering look lethal. See the file header.
          const source = fighter.alarmPos ?? nearestThreat(fighter, living, player)
          if (source) {
            step(
              fighter.position,
              {
                x: fighter.position.x * 2 - source.x,
                y: 0,
                z: fighter.position.z * 2 - source.z,
              },
              fighter.speed * CIVILIAN_PANIC_SPEED_MULTIPLIER * HARNESS_FRAME,
            )
          }
        } else if (isBeastRole(fighter.role)) {
          const threat = nearestThreat(fighter, living, player)
          if (threat) {
            const away = {
              x: fighter.position.x * 2 - threat.x,
              y: 0,
              z: fighter.position.z * 2 - threat.z,
            }
            step(fighter.position, away, fighter.speed * 1.15 * HARNESS_FRAME)
            // Cleared the field: gone, not dead. The engine removes it the same way.
            if (aiDistance(fighter.position, threat) > BEAST_LEASH_RANGE) {
              fighter.alive = false
              fighter.deathAt = now
              bump(result.fledBy, fighter.allegiance)
            }
          }
        } else {
          // Mirrors `GameEngine.updateRoutingActor`: fall back on the rally point, or —
          // when the rally point is already underfoot — give ground to whatever is doing
          // the killing. Modelling this as "stand still and skip your turn" is the exact
          // mistake that inverted this harness's first measurement.
          const toHome = aiDistance(fighter.position, fighter.home)
          if (toHome > HARNESS_RALLY_TOLERANCE) {
            step(fighter.position, fighter.home, fighter.speed * 1.15 * HARNESS_FRAME)
          } else {
            const threat = nearestThreat(fighter, living, player)
            if (threat) {
              step(
                fighter.position,
                {
                  x: fighter.position.x * 2 - threat.x,
                  y: 0,
                  z: fighter.position.z * 2 - threat.z,
                },
                fighter.speed * 1.15 * HARNESS_FRAME,
              )
            }
            fighter.routTimer = Math.min(fighter.routTimer, HARNESS_LAST_STAND_SECONDS)
          }
        }
        // The disengage check, recorded rather than assumed: every flee branch above is
        // supposed to move somebody, and a test can now assert that it did — attributed
        // to the reason that caused it, so a broken branch cannot hide behind another's
        // displacement.
        const moved = aiDistance(before, fighter.position)
        fighter.fledDistance += moved
        bump(result.fledDistanceByReason, fighter.routReason, moved)
        // Out of the square and away: gone, not dead. The engine despawns a villager
        // that strays this far, and counting it here is what makes "got away" a number
        // rather than an absence of one.
        if (
          isPacifistRole(fighter.role) &&
          aiDistance(fighter.position, fighter.home) > HARNESS_ESCAPE_DISTANCE
        ) {
          fighter.alive = false
          fighter.deathAt = now
          bump(result.fledBy, fighter.allegiance)
        }
        continue
      }
      // Back in the line with its nerve restored, so it does not break again instantly.
      if (fighter.routed && fighter.routTimer <= 0 && fighter.rallyTimer <= 0) {
        fighter.rallyTimer = 12
      }

      // The player, if present and worth chasing.
      let targetPosition: AiPoint | null = null
      let targetFighter: HarnessFighter | null = null
      const playerPoint = player?.alive ? { x: player.x, y: 0, z: player.z } : null
      let pursuesPlayer = false

      // §5D — a bystander that is not running is *going about its day*, in both arms.
      // This matters more than it looks: if the arm without panic left villagers standing
      // motionless, the two arms would differ in "moves at all" rather than in the
      // mechanism under test, and the file header's failure class would be reintroduced
      // from the other side. In the engine an unfrightened villager walks between the
      // houses; here it circles its `home`, which is the same thing without a navmesh.
      if (isPacifistRole(fighter.role)) {
        const orbit = now * 0.6 + fighter.position.x
        step(
          fighter.position,
          {
            x: fighter.home.x + Math.sin(orbit) * 4,
            y: 0,
            z: fighter.home.z + Math.cos(orbit) * 4,
          },
          fighter.speed * 0.35 * HARNESS_FRAME,
        )
        continue
      }

      if (player?.alive && playerPoint) {
        const pursuit = evaluatePlayerPursuit({
          hostileToPlayer: fighter.hostileToPlayer,
          playerAggro: fighter.playerAggro,
          aggroMemory: fighter.aggroMemory,
          playerDistance: aiDistance(fighter.position, playerPoint),
          senseRange: senseRangeFor(fighter),
          leashRange: leashRangeFor(fighter),
        })
        if (pursuit.canSense || pursuit.canTrack) {
          fighter.playerAggro = true
          fighter.aggroMemory = 6
        }
        pursuesPlayer = pursuit.shouldPursue && (pursuit.canSense || pursuit.canTrack)
        // Layer 3: the player short-circuits everything else. That ordering is what §9
        // measured as a step function at `BEAST_SENSE_RANGE`.
        if (!threatScoring && pursuit.shouldPursue) targetPosition = playerPoint
      }

      if (threatScoring) {
        // Layer 4: one scored pass over the hostiles *and* the player.
        const choice = selectThreat(
          fighter,
          living,
          senseRangeFor(fighter),
          positionOf,
          pursuesPlayer && playerPoint
            ? {
                position: playerPoint,
                hpFraction: Math.max(0, player!.hp) / playerMaxHp,
                provoked: fighter.playerAggro,
              }
            : null,
        )
        if (choice === THREAT_PLAYER && playerPoint) {
          targetPosition = playerPoint
          fighter.targetId = null
        } else if (choice && choice !== THREAT_PLAYER) {
          targetFighter = choice
          fighter.targetId = choice.id
          targetPosition = choice.position
        } else {
          fighter.targetId = null
        }
      } else if (!targetPosition) {
        // Otherwise the nearest hostile actor, chosen by the Layer 3 selector.
        targetFighter = selectCombatTarget(
          fighter,
          living,
          senseRangeFor(fighter),
          positionOf,
        )
        fighter.targetId = targetFighter?.id ?? null
        if (targetFighter) targetPosition = targetFighter.position
      }
      if (!targetPosition) continue

      const distance = aiDistance(fighter.position, targetPosition)
      if (distance > HARNESS_CONTACT_RANGE) {
        step(fighter.position, targetPosition, fighter.speed * HARNESS_FRAME)
        continue
      }
      if (fighter.attackCooldown > 0) continue

      fighter.attackCooldown = HARNESS_ATTACK_COOLDOWN
      const dealt = fighter.damage * rng.range(0.9, 1.1)
      bump(result.attacksBy, fighter.allegiance)
      bump(result.damageBy, fighter.allegiance, dealt)
      if (targetFighter) {
        bump(result.attacksAgainst, targetFighter.allegiance)
        bump(result.attacksAgainstRole, targetFighter.role)
        bump(result.damageAgainst, targetFighter.allegiance, dealt)
        targetFighter.hp -= dealt
        if (targetFighter.hp <= 0) kill(targetFighter)
      } else if (player?.alive) {
        bump(result.attacksAgainst, 'player')
        bump(result.attacksAgainstRole, 'player')
        bump(result.damageAgainst, 'player', dealt)
        player.hp -= dealt
        if (player.hp <= 0) player.alive = false
      }
    }
  }

  for (const fighter of fighters) {
    if (fighter.alive) bump(result.survivorsBy, fighter.allegiance)
  }
  result.playerHp = player ? Math.max(0, player.hp) : 0
  return result
}

/** Sums many fights into one set of counts, so the metrics are dense enough to read. */
export function accumulate(results: readonly HarnessResult[]): HarnessResult {
  const total: HarnessResult = {
    frames: 0,
    attacksBy: {},
    attacksAgainst: {},
    attacksAgainstRole: {},
    damageBy: {},
    damageAgainst: {},
    deathsBy: {},
    fledBy: {},
    survivorsBy: {},
    routs: 0,
    routsByReason: {},
    routsByRole: {},
    fledDistanceByReason: {},
    playerHp: 0,
    resolved: true,
  }
  for (const result of results) {
    total.frames += result.frames
    total.routs += result.routs
    total.playerHp += result.playerHp
    total.resolved = total.resolved && result.resolved
    for (const key of ['attacksBy', 'attacksAgainst', 'attacksAgainstRole', 'damageBy', 'damageAgainst', 'deathsBy', 'fledBy', 'survivorsBy', 'routsByReason', 'routsByRole', 'fledDistanceByReason'] as const) {
      for (const [name, value] of Object.entries(result[key])) {
        bump(total[key], name, value)
      }
    }
  }
  return total
}
