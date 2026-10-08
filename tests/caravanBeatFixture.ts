/**
 * W2-2 — the caravan beats of a field-by-field engine, the way `GameEngine` keeps them.
 *
 * Tests build engines with `Object.create(GameEngine.prototype)` and assign only the fields a
 * scenario needs. `initializeCaravanBeatCarts` cannot run on such an engine, because it builds
 * a real cart mesh, so this helper sets up the same three fields it would: the plans, the
 * saved state and the scene runtime, with a bare group standing in for the cart.
 */
import * as THREE from 'three'
import { createCaravanClaimState } from '../src/game/world/CaravanClaim.ts'
import {
  createCaravanBeatPlans,
  createCaravanBeatsState,
  type CaravanBeatPlan,
  type CaravanBeatState,
  type CaravanBeatsState,
} from '../src/game/world/CaravanBeats.ts'
import type { Faction } from '../src/game/types.ts'
import type { WorldBlueprint } from '../src/game/world/worldTypes.ts'

export interface AttachedCaravanBeat {
  plans: CaravanBeatPlan[]
  beats: CaravanBeatsState
  plan: CaravanBeatPlan
  state: CaravanBeatState
  cart: THREE.Group
  runtime: {
    cart: THREE.Group
    spawnRetryAt: number
    capacityNoticeShown: boolean
    stalled: number
    lootSite: {
      claim: ReturnType<typeof createCaravanClaimState>
      cart: THREE.Group
      defend: boolean
      isEscort: (actorId: string) => boolean
      sparkle: number
    }
  }
}

export function attachCaravanBeats(
  engine: object,
  blueprint: WorldBlueprint,
  faction: Faction,
  saved?: CaravanBeatsState,
): AttachedCaravanBeat {
  const plans = createCaravanBeatPlans(blueprint, faction)
  const beats = saved ?? createCaravanBeatsState(plans)
  const runtime = new Map<string, AttachedCaravanBeat['runtime']>()
  for (const plan of plans) {
    const state = beats.beats.find((entry) => entry.id === plan.id)
    const cart = new THREE.Group()
    cart.position.set(state?.cargoX ?? plan.cargoStart.x, 0, state?.cargoZ ?? plan.cargoStart.z)
    runtime.set(plan.id, {
      cart,
      spawnRetryAt: 0,
      capacityNoticeShown: false,
      stalled: 0,
      lootSite: {
        claim: createCaravanClaimState(),
        cart,
        defend: plan.role === 'defend',
        isEscort: (actorId) => Reflect.apply(
          Reflect.get(engine, 'isCaravanBeatEnemy') as (beatId: string, id: string) => boolean,
          engine,
          [plan.id, actorId],
        ),
        sparkle: 0,
      },
    })
  }
  Object.assign(engine, {
    caravanBeatPlans: plans,
    caravanBeats: beats,
    caravanBeatRuntime: runtime,
  })
  const plan = plans[0]
  const first = runtime.get(plan.id)
  const state = beats.beats.find((entry) => entry.id === plan.id)
  if (!first || !state) throw new Error('The fixture world has no caravan beat')
  return { plans, beats, plan, state, cart: first.cart, runtime: first }
}
