export interface GraphicsGpuSample {
  gpuMs: number | null
  gpuStatus: 'pending' | 'available' | 'unavailable' | 'disjoint' | 'queue-full' | 'context-lost' | 'timeout'
}

interface TimerExtension {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

function timerExtension(value: unknown): TimerExtension | null {
  if (value === null) return null
  if (typeof value !== 'object' || !('TIME_ELAPSED_EXT' in value) || !('GPU_DISJOINT_EXT' in value)
    || typeof value.TIME_ELAPSED_EXT !== 'number' || typeof value.GPU_DISJOINT_EXT !== 'number') {
    throw new Error('Malformed EXT_disjoint_timer_query_webgl2 extension')
  }
  return { TIME_ELAPSED_EXT: value.TIME_ELAPSED_EXT, GPU_DISJOINT_EXT: value.GPU_DISJOINT_EXT }
}

/** Bounded asynchronous queries: never finish(), readPixels(), or wait for a result. */
export class GraphicsGpuTimer {
  readonly extension: TimerExtension | null
  readonly unavailableReason: string | null
  private readonly gl: WebGL2RenderingContext
  private readonly free: WebGLQuery[] = []
  private readonly pending: Array<{ query: WebGLQuery; sample: GraphicsGpuSample }> = []
  private active: { query: WebGLQuery; sample: GraphicsGpuSample } | null = null
  private allocated = 0
  private disposed = false
  private readonly limit: number

  constructor(gl: WebGL2RenderingContext, limit = 12) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 64) throw new Error('Invalid GPU query capacity')
    this.gl = gl
    this.limit = limit
    this.extension = timerExtension(gl.getExtension('EXT_disjoint_timer_query_webgl2'))
    this.unavailableReason = this.extension ? null : 'EXT_disjoint_timer_query_webgl2 is not exposed by this context'
  }

  begin(sample: GraphicsGpuSample): void {
    if (this.disposed) throw new Error('Graphics GPU timer is disposed')
    if (this.active) throw new Error('Nested graphics GPU query')
    this.poll()
    sample.gpuMs = null
    if (!this.extension) { sample.gpuStatus = 'unavailable'; return }
    if (this.gl.isContextLost()) { sample.gpuStatus = 'context-lost'; return }
    if (this.gl.getQuery(this.extension.TIME_ELAPSED_EXT, this.gl.CURRENT_QUERY) !== null) {
      throw new Error('Another owner has an active TIME_ELAPSED query')
    }
    let query = this.free.pop()
    if (!query && this.allocated < this.limit) {
      query = this.gl.createQuery() ?? undefined
      if (!query) throw new Error('Could not allocate graphics GPU query')
      this.allocated++
    }
    if (!query) { sample.gpuStatus = 'queue-full'; return }
    sample.gpuStatus = 'pending'
    this.active = { query, sample }
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query)
  }

  end(): void {
    if (!this.active || !this.extension) return
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT)
    if (this.active.sample.gpuStatus === 'pending') this.pending.push(this.active)
    else this.free.push(this.active.query)
    this.active = null
  }

  poll(): void {
    if (!this.extension || this.disposed) return
    if (this.gl.isContextLost()) { this.invalidate('context-lost'); return }
    if (this.gl.getParameter(this.extension.GPU_DISJOINT_EXT)) {
      this.invalidate('disjoint')
      return
    }
    while (this.pending.length) {
      const entry = this.pending[0]
      if (!this.gl.getQueryParameter(entry.query, this.gl.QUERY_RESULT_AVAILABLE)) break
      const nanoseconds: unknown = this.gl.getQueryParameter(entry.query, this.gl.QUERY_RESULT)
      if (typeof nanoseconds !== 'number' || !Number.isFinite(nanoseconds) || nanoseconds < 0) {
        throw new Error('Invalid asynchronous GPU timer result')
      }
      entry.sample.gpuMs = nanoseconds / 1_000_000
      entry.sample.gpuStatus = 'available'
      this.free.push(entry.query)
      this.pending.shift()
    }
  }

  get pendingCount(): number { return this.pending.length }

  invalidate(reason: 'disjoint' | 'context-lost' | 'timeout'): void {
    if (this.active) this.active.sample.gpuStatus = reason
    for (const entry of this.pending) {
      entry.sample.gpuMs = null
      entry.sample.gpuStatus = reason
      this.free.push(entry.query)
    }
    this.pending.length = 0
  }

  dispose(): void {
    if (this.disposed) return
    this.end()
    this.invalidate('timeout')
    this.disposed = true
    for (const query of this.free) this.gl.deleteQuery(query)
    this.free.length = 0
    this.allocated = 0
  }
}
