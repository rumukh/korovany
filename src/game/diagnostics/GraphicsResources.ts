import { MethodPatch } from './MethodPatch.ts'

type ResourceKind = 'buffer' | 'texture' | 'renderbuffer' | 'framebuffer' | 'program' | 'shader' | 'vertexArray'
interface ImageAllocation {
  width: number
  height: number
  depth: number
  bytesPerPixel: number
  bytes: number
}
interface Allocation {
  id: number
  kind: ResourceKind
  bytes: number
  target: number
  renderTarget: boolean
  samples: number
  images: Map<string, ImageAllocation>
}

export interface GraphicsResourceSnapshot {
  trackingActive: boolean
  buffers: number
  textures: number
  renderbuffers: number
  framebuffers: number
  programs: number
  shaders: number
  vertexArrays: number
  bufferBytes: number
  textureBytes: number
  renderbufferBytes: number
  renderTargetBytes: number
  trackedBytes: number
  peakTrackedBytes: number
  allocatedBytes: number
  releasedBytes: number
  creates: number
  deletes: number
  storageCalls: number
  unknownFormats: number[]
  implicitMultisampleBytesEstimate: number
}

const counts = {
  buffer: 'buffers', texture: 'textures', renderbuffer: 'renderbuffers', framebuffer: 'framebuffers',
  program: 'programs', shader: 'shaders', vertexArray: 'vertexArrays',
} as const

const CUBE = 0x8513
const CUBE_FIRST_FACE = 0x8515
const CUBE_LAST_FACE = 0x851a
const TEXTURE_3D = 0x806f
const ELEMENT_ARRAY_BUFFER = 0x8893

/** Sized WebGL2 internal formats. Depth24 consumes a 32-bit storage word. */
export function graphicsFormatBytes(format: number, type?: number): number | null {
  const sized: Record<number, number> = {
    0x8229: 1, 0x8f94: 1, 0x8231: 1, 0x8232: 1,
    0x822b: 2, 0x8f95: 2, 0x8237: 2, 0x8238: 2,
    0x8051: 3, 0x8c41: 3, 0x8f96: 3, 0x8d8f: 3, 0x8d7d: 3,
    0x8058: 4, 0x8c43: 4, 0x8f97: 4, 0x8d8e: 4, 0x8d7c: 4,
    0x822d: 2, 0x8233: 2, 0x8234: 2, 0x822f: 4, 0x8239: 4, 0x823a: 4,
    0x881b: 6, 0x8d89: 6, 0x8d77: 6, 0x881a: 8, 0x8d88: 8, 0x8d76: 8,
    0x822e: 4, 0x8235: 4, 0x8236: 4, 0x8230: 8, 0x823b: 8, 0x823c: 8,
    0x8815: 12, 0x8d83: 12, 0x8d71: 12, 0x8814: 16, 0x8d82: 16, 0x8d70: 16,
    0x8056: 2, 0x8057: 2, 0x8d62: 2, 0x8059: 4, 0x906f: 4, 0x8c3a: 4, 0x8c3d: 4,
    0x81a5: 2, 0x81a6: 4, 0x8cac: 4, 0x88f0: 4, 0x8cad: 8, 0x8d48: 1,
  }
  if (sized[format] !== undefined) return sized[format]
  if (type === 0x8033 || type === 0x8034 || type === 0x8363) return 2
  if (type === 0x8368 || type === 0x8c3b || type === 0x8c3e || type === 0x84fa) return 4
  if (type === 0x8dad) return 8
  const channels: Record<number, number> = {
    0x1903: 1, 0x1906: 1, 0x1909: 1, 0x8227: 2, 0x190a: 2, 0x1907: 3, 0x1908: 4,
    0x8d94: 1, 0x8228: 2, 0x8d98: 3, 0x8d99: 4, 0x1902: 1,
  }
  const bytes: Record<number, number> = {
    0x1400: 1, 0x1401: 1, 0x1402: 2, 0x1403: 2, 0x140b: 2, 0x1404: 4, 0x1405: 4, 0x1406: 4,
  }
  return channels[format] && type !== undefined && bytes[type] ? channels[format] * bytes[type] : null
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid instrumented GL number')
  return value
}

function handle(value: unknown): object | null {
  if (value === null) return null
  if (typeof value !== 'object') throw new Error('Invalid instrumented GL handle')
  return value
}

function textureTarget(target: number): number {
  return target >= CUBE_FIRST_FACE && target <= CUBE_LAST_FACE ? CUBE : target
}

function sourceSize(source: unknown): [number, number] {
  if (source === null || typeof source !== 'object') throw new Error('Unknown GL image source')
  const width = Reflect.get(source, 'videoWidth') || Reflect.get(source, 'width')
  const height = Reflect.get(source, 'videoHeight') || Reflect.get(source, 'height')
  return [number(width), number(height)]
}

/**
 * Observes actual API storage, including allocations not reachable by traversing a
 * THREE scene (composer ping-pong/depth/MSAA, retained geometry, shadow targets).
 * These are requested storage bytes, not a measurement of driver-resident VRAM.
 */
export class GraphicsResources {
  private readonly resources = new Map<object, Allocation>()
  private readonly patches = new MethodPatch()
  private readonly boundBuffers = new Map<number, object | null>()
  private readonly elementBuffers = new Map<object | null, object | null>()
  private readonly boundTextures = new Map<string, object | null>()
  private readonly extensions = new Set<object>()
  private readonly unknownFormats = new Set<number>()
  private vertexArray: object | null = null
  private boundRenderbuffer: object | null = null
  private textureUnit = 0x84c0
  private sequence = 0
  private totalBytes = 0
  private peakBytes = 0
  private allocated = 0
  private released = 0
  private creates = 0
  private deletes = 0
  private storageCalls = 0
  private disposed = false
  private trackingActive = true

  constructor(gl: WebGL2RenderingContext) {
    const kinds = [
      ['Buffer', 'buffer'], ['Texture', 'texture'], ['Renderbuffer', 'renderbuffer'],
      ['Framebuffer', 'framebuffer'], ['Program', 'program'], ['Shader', 'shader'],
      ['VertexArray', 'vertexArray'],
    ] as const
    try {
      for (const [suffix, kind] of kinds) {
        this.observe(gl, `create${suffix}`, (_args, result) => {
          const resource = handle(result)
          if (resource === null) throw new Error(`WebGL could not allocate ${kind}`)
          this.resources.set(resource, {
            id: ++this.sequence, kind, bytes: 0, target: 0, renderTarget: false, samples: 1, images: new Map(),
          })
          this.creates++
        })
        this.observe(gl, `delete${suffix}`, (args) => this.remove(handle(args[0])))
      }
      this.observe(gl, 'bindBuffer', (args) => {
        const target = number(args[0])
        const resource = handle(args[1])
        this.boundBuffers.set(target, resource)
        if (target === ELEMENT_ARRAY_BUFFER) this.elementBuffers.set(this.vertexArray, resource)
      })
      this.observe(gl, 'bindVertexArray', (args) => {
        this.vertexArray = handle(args[0])
        this.boundBuffers.set(ELEMENT_ARRAY_BUFFER, this.elementBuffers.get(this.vertexArray) ?? null)
      })
      this.observe(gl, 'bufferData', (args) => {
        const resource = this.allocation(this.boundBuffers.get(number(args[0])))
        const data = args[1]
        let size: number
        if (typeof data === 'number') size = data
        else if (ArrayBuffer.isView(data)) {
          const elementSize = 'BYTES_PER_ELEMENT' in data ? number(data.BYTES_PER_ELEMENT) : 1
          const offset = args[3] === undefined ? 0 : number(args[3])
          const length = args[4] === undefined || args[4] === 0
            ? data.byteLength / elementSize - offset : number(args[4])
          size = length * elementSize
        } else if (data instanceof ArrayBuffer) size = data.byteLength
        else throw new Error('Unknown WebGL bufferData source')
        this.replace(resource, size)
      })
      this.observe(gl, 'activeTexture', (args) => { this.textureUnit = number(args[0]) })
      this.observe(gl, 'bindTexture', (args) => {
        const target = number(args[0])
        const resource = handle(args[1])
        this.boundTextures.set(`${this.textureUnit}:${target}`, resource)
        if (resource) this.allocation(resource).target = target
      })
      this.observe(gl, 'texStorage2D', (args) => this.storage(args, false))
      this.observe(gl, 'texStorage3D', (args) => this.storage(args, true))
      this.observe(gl, 'texImage2D', (args) => this.image(args, false))
      this.observe(gl, 'texImage3D', (args) => this.image(args, true))
      this.observe(gl, 'compressedTexImage2D', (args) => this.compressedImage(args, false))
      this.observe(gl, 'compressedTexImage3D', (args) => this.compressedImage(args, true))
      this.observe(gl, 'copyTexImage2D', (args) => {
        this.setImage(this.texture(number(args[0])), number(args[0]), number(args[1]),
          number(args[5]), number(args[6]), 1, this.format(number(args[2])))
      })
      this.observe(gl, 'generateMipmap', (args) => {
        const resource = this.texture(number(args[0]))
        for (const [key, base] of [...resource.images]) {
          if (!key.endsWith(':0')) continue
          const face = Number(key.split(':')[0])
          const levels = 1 + Math.floor(Math.log2(Math.max(base.width, base.height,
            resource.target === TEXTURE_3D ? base.depth : 1)))
          for (let level = 1; level < levels; level++) {
            if (resource.images.has(`${face}:${level}`)) continue
            this.setImage(resource, face, level,
              Math.max(1, base.width >> level), Math.max(1, base.height >> level),
              resource.target === TEXTURE_3D ? Math.max(1, base.depth >> level) : base.depth, base.bytesPerPixel)
          }
        }
      })
      this.observe(gl, 'bindRenderbuffer', (args) => { this.boundRenderbuffer = handle(args[1]) })
      this.observe(gl, 'renderbufferStorage', (args) => this.renderbuffer(args, false))
      this.observe(gl, 'renderbufferStorageMultisample', (args) => this.renderbuffer(args, true))
      this.observe(gl, 'framebufferTexture2D', (args) => this.markTarget(handle(args[3])))
      this.observe(gl, 'framebufferTextureLayer', (args) => this.markTarget(handle(args[2])))
      this.observe(gl, 'framebufferRenderbuffer', (args) => this.markTarget(handle(args[3])))
      this.observe(gl, 'getExtension', (args, extension) => {
        if (args[0] !== 'WEBGL_multisampled_render_to_texture' || !extension || typeof extension !== 'object') return
        if (this.extensions.has(extension)) return
        this.extensions.add(extension)
        this.observe(extension, 'renderbufferStorageMultisampleEXT', (values) => this.renderbuffer(values, true))
        this.observe(extension, 'framebufferTexture2DMultisampleEXT', (values) => {
          const resource = handle(values[3])
          this.markTarget(resource)
          if (resource) this.allocation(resource).samples = Math.max(1, number(values[5]))
        })
      })
    } catch (error) {
      this.patches.dispose()
      throw error
    }
  }

  private observe(owner: object, key: string, after: (args: readonly unknown[], result: unknown) => void): void {
    const allocatesStorage = new Set([
      'bufferData', 'texStorage2D', 'texStorage3D', 'texImage2D', 'texImage3D',
      'compressedTexImage2D', 'compressedTexImage3D', 'copyTexImage2D', 'generateMipmap',
      'renderbufferStorage', 'renderbufferStorageMultisample', 'renderbufferStorageMultisampleEXT',
    ]).has(key)
    this.patches.wrap(owner, key, (call, args) => {
      const result = call()
      if (allocatesStorage) this.storageCalls++
      after(args, result)
      return result
    })
  }

  private allocation(resource: object | null | undefined): Allocation {
    const allocation = resource ? this.resources.get(resource) : undefined
    if (!allocation) throw new Error('Graphics ledger encountered untracked or unbound storage')
    return allocation
  }

  private texture(target: number): Allocation {
    return this.allocation(this.boundTextures.get(`${this.textureUnit}:${textureTarget(target)}`))
  }

  private format(internalFormat: number, type?: number): number {
    const bytes = graphicsFormatBytes(internalFormat, type)
    if (bytes !== null) return bytes
    this.unknownFormats.add(internalFormat)
    return 0
  }

  private replace(resource: Allocation, bytes: number, oldBytes = resource.bytes, newBytes = bytes): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid graphics allocation size')
    this.released += oldBytes
    this.allocated += newBytes
    this.totalBytes += bytes - resource.bytes
    resource.bytes = bytes
    this.peakBytes = Math.max(this.peakBytes, this.totalBytes)
  }

  private setImage(resource: Allocation, face: number, level: number, width: number, height: number,
    depth: number, bytesPerPixel: number, compressedBytes?: number): void {
    const key = `${face}:${level}`
    const oldBytes = resource.images.get(key)?.bytes ?? 0
    const bytes = compressedBytes ?? width * height * depth * bytesPerPixel
    resource.images.set(key, { width, height, depth, bytesPerPixel, bytes })
    this.replace(resource, resource.bytes - oldBytes + bytes, oldBytes, bytes)
  }

  private storage(args: readonly unknown[], threeDimensional: boolean): void {
    const target = number(args[0])
    const resource = this.texture(target)
    const levels = number(args[1])
    const width = number(args[3])
    const height = number(args[4])
    const depth = threeDimensional ? number(args[5]) : 1
    resource.images.clear()
    this.replace(resource, 0)
    for (let face = 0; face < (target === CUBE ? 6 : 1); face++) {
      for (let level = 0; level < levels; level++) {
        this.setImage(resource, target === CUBE ? CUBE_FIRST_FACE + face : target, level,
          Math.max(1, width >> level), Math.max(1, height >> level),
          target === TEXTURE_3D ? Math.max(1, depth >> level) : depth, this.format(number(args[2])))
      }
    }
  }

  private image(args: readonly unknown[], threeDimensional: boolean): void {
    const target = number(args[0])
    const sourceOverload = !threeDimensional && args.length === 6
    const [width, height] = sourceOverload ? sourceSize(args[5]) : [number(args[3]), number(args[4])]
    const type = number(args[sourceOverload ? 4 : threeDimensional ? 8 : 7])
    this.setImage(this.texture(target), target, number(args[1]), width, height,
      threeDimensional ? number(args[5]) : 1, this.format(number(args[2]), type))
  }

  private compressedImage(args: readonly unknown[], threeDimensional: boolean): void {
    const data = args[threeDimensional ? 7 : 6]
    const bytes = ArrayBuffer.isView(data) ? data.byteLength : number(data)
    this.setImage(this.texture(number(args[0])), number(args[0]), number(args[1]),
      number(args[3]), number(args[4]), threeDimensional ? number(args[5]) : 1, 0, bytes)
  }

  private renderbuffer(args: readonly unknown[], multisampled: boolean): void {
    const resource = this.allocation(this.boundRenderbuffer)
    const offset = multisampled ? 1 : 0
    resource.samples = multisampled ? Math.max(1, number(args[1])) : 1
    const width = number(args[2 + offset])
    const height = number(args[3 + offset])
    const bpp = this.format(number(args[1 + offset]))
    resource.images.set('storage', { width, height, depth: 1, bytesPerPixel: bpp, bytes: width * height * bpp })
    this.replace(resource, width * height * bpp * resource.samples)
  }

  private markTarget(resource: object | null): void {
    if (resource) this.allocation(resource).renderTarget = true
  }

  private remove(resource: object | null): void {
    if (!resource) return
    const allocation = this.resources.get(resource)
    if (!allocation) return // WebGL permits repeated delete calls.
    this.totalBytes -= allocation.bytes
    this.released += allocation.bytes
    this.deletes++
    this.resources.delete(resource)
    this.elementBuffers.delete(resource)
    for (const [vao, bound] of this.elementBuffers) if (bound === resource) this.elementBuffers.set(vao, null)
    for (const [target, bound] of this.boundBuffers) if (bound === resource) this.boundBuffers.delete(target)
    for (const [target, bound] of this.boundTextures) if (bound === resource) this.boundTextures.delete(target)
    if (this.boundRenderbuffer === resource) this.boundRenderbuffer = null
    if (this.vertexArray === resource) this.vertexArray = null
  }

  snapshot(): GraphicsResourceSnapshot {
    const snapshot: GraphicsResourceSnapshot = {
      trackingActive: this.trackingActive,
      buffers: 0, textures: 0, renderbuffers: 0, framebuffers: 0, programs: 0, shaders: 0, vertexArrays: 0,
      bufferBytes: 0, textureBytes: 0, renderbufferBytes: 0, renderTargetBytes: 0,
      trackedBytes: this.totalBytes, peakTrackedBytes: this.peakBytes,
      allocatedBytes: this.allocated, releasedBytes: this.released,
      creates: this.creates, deletes: this.deletes, storageCalls: this.storageCalls,
      unknownFormats: [...this.unknownFormats], implicitMultisampleBytesEstimate: 0,
    }
    for (const entry of this.resources.values()) {
      snapshot[counts[entry.kind]]++
      if (entry.kind === 'buffer') snapshot.bufferBytes += entry.bytes
      if (entry.kind === 'texture') snapshot.textureBytes += entry.bytes
      if (entry.kind === 'renderbuffer') snapshot.renderbufferBytes += entry.bytes
      if (entry.renderTarget) snapshot.renderTargetBytes += entry.bytes
      if (entry.kind === 'texture' && entry.samples > 1) {
        snapshot.implicitMultisampleBytesEstimate += entry.bytes * entry.samples
      }
    }
    return snapshot
  }

  targets(): object[] {
    return [...this.resources.values()].filter((entry) => entry.renderTarget).map((entry) => ({
      id: entry.id, kind: entry.kind, bytes: entry.bytes, samples: entry.samples,
      images: [...entry.images].map(([level, image]) => ({ level, ...image })),
    }))
  }

  stopTracking(): void {
    if (!this.trackingActive) return
    this.patches.dispose()
    this.trackingActive = false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopTracking()
    this.resources.clear()
    this.boundBuffers.clear()
    this.elementBuffers.clear()
    this.boundTextures.clear()
    this.extensions.clear()
  }
}
