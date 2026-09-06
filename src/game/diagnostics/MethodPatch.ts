/** Instance-local instrumentation. Never patches a browser or THREE prototype. */
export class MethodPatch {
  private readonly releases: Array<() => void> = []
  private disposed = false

  wrap(
    owner: object,
    key: PropertyKey,
    invoke: (call: () => unknown, args: readonly unknown[]) => unknown,
  ): void {
    if (this.disposed) throw new Error('Graphics method patches are disposed')
    const original: unknown = Reflect.get(owner, key)
    if (typeof original !== 'function') throw new Error(`Cannot instrument ${String(key)}`)
    const descriptor = Object.getOwnPropertyDescriptor(owner, key)
    const replacement = (...args: unknown[]): unknown =>
      invoke(() => Reflect.apply(original, owner, args), args)
    Object.defineProperty(owner, key, { configurable: true, writable: true, value: replacement })
    this.releases.push(() => {
      if (Reflect.get(owner, key) !== replacement) {
        throw new Error(`Graphics instrumentation lost ownership of ${String(key)}`)
      }
      if (descriptor) Object.defineProperty(owner, key, descriptor)
      else Reflect.deleteProperty(owner, key)
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const errors: unknown[] = []
    for (const release of this.releases.reverse()) {
      try { release() } catch (error) { errors.push(error) }
    }
    this.releases.length = 0
    if (errors.length) throw new AggregateError(errors, 'Graphics method restoration failed')
  }
}
