/**
 * Who gets a caravan once its escort is down.
 *
 * «Можно грабить корованы» is the player's verb. Before this module an unguarded cart
 * went to whatever hostile actor first stood within 3.4 m of it, in a single frame, and
 * that included the player's own squad: the companions who had just helped kill the
 * escort usually reached the tailgate before the player did, and the robbery paid nobody.
 *
 * The rules here, for every cart that NPCs can take (the ordinary road cart and the
 * chronicle's ambushed carts):
 *
 * 1. **Looting is a channel, not a touch.** A looter has to stand at the cart for
 *    {@link CARAVAN_LOOT_CHANNEL_SECONDS}. Any hit that lands on it, a rout, a returning
 *    escort or the player taking the cargo first ends the channel without a robbery.
 * 2. **The player who won the fight keeps the cart for a moment.** When the last escort
 *    goes down (or the cart stops being guarded) and the player either hit an escort in
 *    the last {@link CARAVAN_CLAIM_HIT_MEMORY} seconds or stands within
 *    {@link CARAVAN_CLAIM_RANGE} metres, nobody else may start loading for
 *    {@link CARAVAN_CLAIM_SECONDS}. The claim only exists for a side that robs this cart;
 *    the palace guard defends the road cart and never gets one.
 *
 * Which actors may loot is the caller's decision, because it differs per cart: the squad
 * is excluded from the road cart by the engine, and a chronicle ambush is looted only by
 * its own raiders. Everything here is pure: no THREE, no actors, no clock and no random
 * stream, so a decision can be driven frame by frame in a test.
 *
 * None of this state is saved. It is bound to live escorts and looters, which a continue
 * re-creates (the road cart's escorts respawn and a chronicle fight re-materializes), so a
 * restored run starts with no claim and no channel rather than with a refreshed one.
 */

/**
 * Seconds a looter has to spend at the cart before the cargo is gone.
 *
 * 3.5 s, inside the 3–4 s the design asked for, measured against the player rather than
 * picked: the first melee beat lands 0.12 s after the press and the bow's shot cooldown is
 * 0.9 s, so a player who sees the cue at the cart interrupts with time to spare, and the
 * cue itself is shown from {@link CARAVAN_LOOT_CUE_RANGE} metres — about 29 m of walking or
 * 47 m of sprinting at the player's 8.2 m/s and 13.5 m/s. Shorter would make the cue a
 * notice of something already lost; longer would make NPC looting a formality.
 */
export const CARAVAN_LOOT_CHANNEL_SECONDS = 3.5
/**
 * Seconds nobody but the player may start loading after the player wins the escort fight.
 * Long enough to walk 70 m or to finish off a wounded raider first, short enough that a
 * cart nobody comes back for is still lost.
 */
export const CARAVAN_CLAIM_SECONDS = 9
/** A player hit on an escort this recent still counts as having won the fight. */
export const CARAVAN_CLAIM_HIT_MEMORY = 10
/** A player standing this close to the cart when its escort falls was there for it. */
export const CARAVAN_CLAIM_RANGE = 10
/** Somebody else's loading bar is shown to the player within this many metres. */
export const CARAVAN_LOOT_CUE_RANGE = 40
/**
 * A looter dragged this far from the cart is no longer loading it. Knockback already
 * breaks the channel through the hit that caused it; this is the backstop for anything
 * else that moves an actor, so a channel can never complete at a distance.
 */
export const CARAVAN_LOOT_BREAK_RANGE = 4.6

export type CaravanLooterKind = 'raider' | 'beast'
/** Who emptied a cart. Drives the honest prompt, never a reward. */
export type CaravanRobber = 'player' | CaravanLooterKind

export interface CaravanClaimState {
  /** The actor loading the cart right now, or null. */
  looterId: string | null
  /** A beast eats the cargo; anything else carries it off. */
  looterKind: CaravanLooterKind
  /** Seconds of loading the current looter has done. */
  loaded: number
  /** Seconds left in which nobody but the player may start loading. */
  claim: number
  /** Engine time of the player's last hit on one of this cart's escorts. */
  escortHitAt: number | null
  /** Whether an escort was guarding the cart on the previous frame. */
  wasGuarded: boolean
}

export function createCaravanClaimState(): CaravanClaimState {
  return {
    looterId: null,
    looterKind: 'raider',
    loaded: 0,
    claim: 0,
    escortHitAt: null,
    wasGuarded: false,
  }
}

/** One actor, as this frame's world sees it next to one cart. */
export interface CaravanLooterSample {
  id: string
  /** Horizontal metres from the actor to the cart. */
  distance: number
  /**
   * For the current looter: still able to keep loading (alive, steady, not routing).
   * For a candidate: free to start (all of that, and not busy fighting anybody).
   */
  ready: boolean
  beast: boolean
}

export interface CaravanClaimInput {
  delta: number
  elapsed: number
  /** A living, steady escort is guarding the cart. */
  guarded: boolean
  /** The last living escort went down this frame. */
  escortFell: boolean
  /** Nothing left to take: the cart was already robbed, plundered or resolved. */
  empty: boolean
  /** The player's side robs this cart. False for a side that defends it. */
  playerRobs: boolean
  /** Horizontal metres from the player to the cart. */
  playerDistance: number
  /** The current looter, or null when it no longer exists. */
  looter: CaravanLooterSample | null
  /** The nearest actor that may start loading now, or null. */
  candidate: CaravanLooterSample | null
  /** How close a candidate has to be to start. */
  plunderRange: number
}

export interface CaravanClaimStep {
  /** The player's claim window opened this frame. */
  claimOpened: boolean
  /** The id of an actor that started loading this frame. */
  started: string | null
  /** The id of an actor whose loading ended this frame without taking anything. */
  broken: string | null
  /** The cargo was taken this frame, and by whom. */
  plundered: { id: string; kind: CaravanLooterKind } | null
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function clearLoot(state: CaravanClaimState): void {
  state.looterId = null
  state.loaded = 0
}

function breakLoot(state: CaravanClaimState, step: CaravanClaimStep): void {
  if (state.looterId === null) return
  step.broken = state.looterId
  clearLoot(state)
}

function wonTheFight(state: CaravanClaimState, input: CaravanClaimInput): boolean {
  if (finite(input.playerDistance) <= CARAVAN_CLAIM_RANGE) return true
  return state.escortHitAt !== null &&
    finite(input.elapsed) - state.escortHitAt <= CARAVAN_CLAIM_HIT_MEMORY
}

/**
 * One frame of one cart. Mutates `state` and reports what changed, so the engine can
 * play the cue, hold the looter and pay out (or not) without re-deriving any of it.
 */
export function advanceCaravanClaim(
  state: CaravanClaimState,
  input: CaravanClaimInput,
): CaravanClaimStep {
  const step: CaravanClaimStep = { claimOpened: false, started: null, broken: null, plundered: null }
  const delta = Math.max(0, finite(input.delta))
  state.claim = Math.max(0, state.claim - delta)
  const escortGone = !input.guarded && (state.wasGuarded || input.escortFell)
  state.wasGuarded = input.guarded
  if (input.guarded || input.empty) {
    breakLoot(state, step)
    return step
  }
  if (escortGone && input.playerRobs && wonTheFight(state, input)) {
    state.claim = CARAVAN_CLAIM_SECONDS
    step.claimOpened = true
  }
  if (state.claim > 0) {
    breakLoot(state, step)
    return step
  }
  if (state.looterId !== null) {
    const looter = input.looter
    if (
      !looter ||
      looter.id !== state.looterId ||
      !looter.ready ||
      !(finite(looter.distance) <= CARAVAN_LOOT_BREAK_RANGE)
    ) {
      breakLoot(state, step)
      return step
    }
    state.loaded += delta
    if (state.loaded >= CARAVAN_LOOT_CHANNEL_SECONDS) {
      step.plundered = { id: state.looterId, kind: state.looterKind }
      clearLoot(state)
    }
    return step
  }
  const candidate = input.candidate
  if (candidate && candidate.ready && finite(candidate.distance) <= input.plunderRange) {
    state.looterId = candidate.id
    state.looterKind = candidate.beast ? 'beast' : 'raider'
    state.loaded = 0
    step.started = candidate.id
  }
  return step
}

/** A hit landed on `actorId`. True when it was loading this cart, which it no longer is. */
export function interruptCaravanLoot(state: CaravanClaimState, actorId: string): boolean {
  if (state.looterId === null || state.looterId !== actorId) return false
  clearLoot(state)
  return true
}

/** The cart was emptied some other way. Returns whoever had been loading it. */
export function cancelCaravanLoot(state: CaravanClaimState): string | null {
  const looterId = state.looterId
  clearLoot(state)
  return looterId
}

/** The player just landed a hit on one of this cart's escorts. */
export function noteCaravanEscortHit(state: CaravanClaimState, elapsed: number): void {
  if (Number.isFinite(elapsed)) state.escortHitAt = elapsed
}

/** 0..1 of the cargo already loaded, or 0 when nobody is loading. */
export function caravanLootProgress(state: CaravanClaimState): number {
  if (state.looterId === null) return 0
  return Math.min(1, Math.max(0, state.loaded / CARAVAN_LOOT_CHANNEL_SECONDS))
}

export interface CaravanLootView {
  /** 0..1 of the cargo the looter has already loaded. */
  progress: number
  looter: CaravanLooterKind
  /** The player's side protects this cart, so the call is to defend it, not to race. */
  defend: boolean
  /** Whole metres from the player to the cart. */
  distance: number
}

/** The HUD cue for one cart, or null when nobody is loading it within sight. */
export function buildCaravanLootView(
  state: CaravanClaimState,
  input: { playerDistance: number; defend: boolean },
): CaravanLootView | null {
  if (state.looterId === null) return null
  const distance = finite(input.playerDistance)
  if (distance > CARAVAN_LOOT_CUE_RANGE) return null
  return {
    progress: caravanLootProgress(state),
    looter: state.looterKind,
    defend: input.defend,
    distance: Math.round(distance),
  }
}
