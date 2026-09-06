export const LOOK_DRAG_THRESHOLD = 6

export function cameraRelativeMovement(keys: ReadonlySet<string>, yaw: number): { x: number; z: number } {
  const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) -
    Number(keys.has('KeyS') || keys.has('ArrowDown'))
  const right = Number(keys.has('KeyD') || keys.has('ArrowRight')) -
    Number(keys.has('KeyA') || keys.has('ArrowLeft'))
  return {
    x: Math.sin(yaw) * forward + Math.cos(yaw) * right,
    z: -Math.cos(yaw) * forward + Math.sin(yaw) * right,
  }
}

export function isEditableGameplayTarget(target: EventTarget | null): boolean {
  return target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') !== null
}

export function blocksGameplayKey(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
    event.isComposing || (event.code !== 'Escape' && isEditableGameplayTarget(event.target))
}

export interface LookGesture {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  dragged: boolean
}

export function beginLookGesture(pointerId: number, x: number, y: number): LookGesture {
  return { pointerId, startX: x, startY: y, lastX: x, lastY: y, dragged: false }
}

export function moveLookGesture(
  gesture: LookGesture,
  pointerId: number,
  x: number,
  y: number,
): { x: number; y: number } {
  if (pointerId !== gesture.pointerId) return { x: 0, y: 0 }
  const wasDragging = gesture.dragged
  gesture.dragged ||= Math.hypot(x - gesture.startX, y - gesture.startY) >= LOOK_DRAG_THRESHOLD
  const delta = gesture.dragged
    ? { x: x - (wasDragging ? gesture.lastX : gesture.startX), y: y - (wasDragging ? gesture.lastY : gesture.startY) }
    : { x: 0, y: 0 }
  gesture.lastX = x
  gesture.lastY = y
  return delta
}

export function finishLookGesture(gesture: LookGesture, pointerId: number, cancelled: boolean): boolean {
  return gesture.pointerId === pointerId && !cancelled && !gesture.dragged
}

/** Secondary touch pointers do not necessarily synthesize a click. Keyboard clicks still do. */
export function instantGameplayAction(action: () => void) {
  return {
    onPointerDown(event: Pick<PointerEvent, 'button' | 'preventDefault'>): void {
      if (event.button !== 0) return
      event.preventDefault()
      action()
    },
    onClick(event: Pick<MouseEvent, 'detail'>): void {
      if (event.detail === 0) action()
    },
  }
}

interface PointerCaptureTarget {
  setPointerCapture(pointerId: number): void
  hasPointerCapture(pointerId: number): boolean
  releasePointerCapture(pointerId: number): void
}

export class GameplayPointerCaptures {
  private readonly targets = new Map<number, PointerCaptureTarget>()
  private readonly cancelled = new Set<number>()

  capture(target: PointerCaptureTarget, pointerId: number): void {
    this.beginPointer(pointerId)
    this.release(pointerId)
    target.setPointerCapture(pointerId)
    this.targets.set(pointerId, target)
  }

  release(pointerId: number): void {
    const target = this.targets.get(pointerId)
    this.targets.delete(pointerId)
    if (target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
  }

  releaseAll(): void {
    for (const pointerId of this.targets.keys()) this.cancel(pointerId)
  }

  cancel(pointerId: number): void {
    // A released touch can still synthesize a delayed click over the newly opened menu.
    this.cancelled.add(pointerId)
    if (this.cancelled.size > 32) {
      const oldest = this.cancelled.values().next().value
      if (oldest !== undefined) this.cancelled.delete(oldest)
    }
    this.release(pointerId)
  }

  beginPointer(pointerId: number): void {
    this.cancelled.delete(pointerId)
  }

  consumeCancelledClick(pointerId: number): boolean {
    return this.cancelled.delete(pointerId)
  }
}

/** App-owned so a touch released during game teardown cannot click the next screen. */
export function bindGameplayPointerCancellation(target: EventTarget, captures: GameplayPointerCaptures): () => void {
  const begin = (event: Event) => {
    if ('pointerId' in event && typeof event.pointerId === 'number') captures.beginPointer(event.pointerId)
  }
  const click = (event: Event) => {
    if ('pointerId' in event && typeof event.pointerId === 'number' &&
        captures.consumeCancelledClick(event.pointerId)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  target.addEventListener('pointerdown', begin, true)
  target.addEventListener('click', click, true)
  return () => {
    target.removeEventListener('pointerdown', begin, true)
    target.removeEventListener('click', click, true)
  }
}
