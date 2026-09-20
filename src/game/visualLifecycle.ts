export interface VisualResourceOwner {
  dispose(): void
}

/** BloomPostProcessor is the one frame owner; libraries and regions are not pipelines. */
export interface VisualFrameOwner extends VisualResourceOwner {
  render(): void
  setSize(width: number, height: number): void
}

/**
 * Drain exclusive allocations before releasing them, including after partial construction.
 * Borrowed geometry, materials, skeletons and instance buffers must not enter this list.
 */
export function disposeOwnedVisualResources(owned: VisualResourceOwner[]): void {
  const resources = [...new Set(owned.splice(0))].reverse()
  const errors: unknown[] = []
  for (const resource of resources) {
    try {
      resource.dispose()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Visual resource cleanup was incomplete')
  }
}
