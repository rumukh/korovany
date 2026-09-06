export type GameOverlay = 'end' | 'achievements' | 'shop' | 'atlas' | 'orders' | 'pause'

export interface GameOverlayState {
  ended: boolean
  achievementsOpen: boolean
  shopOpen: boolean
  atlasOpen: boolean
  squadCommandOpen: boolean
  paused: boolean
}

export function initialGameOverlayState(): GameOverlayState {
  return {
    ended: false,
    achievementsOpen: false,
    shopOpen: false,
    atlasOpen: false,
    squadCommandOpen: false,
    paused: false,
  }
}

const overlayFields = {
  atlas: 'atlasOpen',
  orders: 'squadCommandOpen',
  shop: 'shopOpen',
} as const

type RequestedGameOverlay = keyof typeof overlayFields

/** A lower pause may remain set, but only this owner renders and receives Escape. */
export function topGameOverlay(state: GameOverlayState): GameOverlay | null {
  if (state.ended) return 'end'
  if (state.achievementsOpen) return 'achievements'
  if (state.shopOpen) return 'shop'
  if (state.atlasOpen) return 'atlas'
  if (state.squadCommandOpen) return 'orders'
  return state.paused ? 'pause' : null
}

export function canOpenGameOverlay(state: GameOverlayState, requested: RequestedGameOverlay): boolean {
  const top = topGameOverlay(state)
  return top === null || top === requested
}

export function openGameOverlay(state: GameOverlayState, requested: RequestedGameOverlay): GameOverlayState {
  if (!canOpenGameOverlay(state, requested) || state[overlayFields[requested]]) return state
  return { ...state, [overlayFields[requested]]: true }
}

export function toggleGameOverlay(state: GameOverlayState, requested: RequestedGameOverlay): GameOverlayState {
  if (topGameOverlay(state) === requested) return closeTopGameOverlay(state)
  return openGameOverlay(state, requested)
}

/** A stale close button must not dismiss a different overlay or its underlying pause. */
export function dismissGameOverlay(state: GameOverlayState, owner: GameOverlay): GameOverlayState {
  return topGameOverlay(state) === owner ? closeTopGameOverlay(state) : state
}

/** Escape/P enters pause only when there is no overlay to dismiss. */
export function closeTopGameOverlay(state: GameOverlayState): GameOverlayState {
  switch (topGameOverlay(state)) {
    case 'end': return state
    case 'achievements': return { ...state, achievementsOpen: false }
    case 'shop': return { ...state, shopOpen: false }
    case 'atlas': return { ...state, atlasOpen: false }
    case 'orders': return { ...state, squadCommandOpen: false }
    case 'pause': return { ...state, paused: false }
    case null: return { ...state, paused: true }
  }
}
