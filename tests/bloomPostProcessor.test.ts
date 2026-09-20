import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {
  BloomPostProcessor,
  postProcessingOutputIsVisible,
  renderPostProcessingFrame,
  type PostProcessingOutputReader,
  type PostProcessingRenderActions,
} from '../src/game/BloomPostProcessor.ts'

interface ComposerProbe {
  passes: Array<{ constructor: { name: string }; dispose(): void }>
  render(): void
}

interface PostProcessorProbe {
  composer: ComposerProbe | null
  gradePass: { uniforms: Record<string, { value: unknown }> } | null
  bloomPass: { dispose(): void } | null
}

function inspect(processor: BloomPostProcessor): PostProcessorProbe {
  return processor as unknown as PostProcessorProbe
}

function headlessRenderer(): {
  renderer: THREE.WebGLRenderer
  state: {
    directRenders: number
    renderTarget: THREE.WebGLRenderTarget | null
    clearColor: THREE.Color
    clearAlpha: number
  }
} {
  const state = {
    directRenders: 0,
    renderTarget: null as THREE.WebGLRenderTarget | null,
    clearColor: new THREE.Color(0x172033),
    clearAlpha: 1,
  }

  const renderer = {
    autoClear: true,
    getPixelRatio(): number {
      return 1
    },
    getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2 {
      return target.set(64, 36)
    },
    getSize(target: THREE.Vector2): THREE.Vector2 {
      return target.set(64, 36)
    },
    getRenderTarget(): THREE.WebGLRenderTarget | null {
      return state.renderTarget
    },
    setRenderTarget(target: THREE.WebGLRenderTarget | null): void {
      state.renderTarget = target
    },
    getClearColor(target: THREE.Color): THREE.Color {
      return target.copy(state.clearColor)
    },
    getClearAlpha(): number {
      return state.clearAlpha
    },
    setClearColor(color: THREE.ColorRepresentation, alpha?: number): void {
      state.clearColor.set(color)
      if (alpha !== undefined) state.clearAlpha = alpha
    },
    render(): void {
      state.directRenders += 1
    },
  } as unknown as THREE.WebGLRenderer

  return { renderer, state }
}

function captureWarnings(run: () => void): unknown[][] {
  const originalWarn = console.warn
  const warnings: unknown[][] = []
  console.warn = (...args: unknown[]) => {
    warnings.push(args)
  }
  try {
    run()
  } finally {
    console.warn = originalWarn
  }
  return warnings
}

function outputReader(
  alpha: number,
  dimensions: readonly [number, number] = [12, 8],
): { reader: PostProcessingOutputReader; reads: number[][] } {
  const reads: number[][] = []
  return {
    reader: {
      drawingBufferWidth: dimensions[0],
      drawingBufferHeight: dimensions[1],
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      readPixels(x, y, width, height, format, type, pixels): void {
        reads.push([x, y, width, height, format, type])
        pixels[3] = alpha
      },
    },
    reads,
  }
}

test('post-processing validation accepts an opaque center pixel', () => {
  const { reader, reads } = outputReader(255)
  const sample = new Uint8Array([255, 255, 255, 0])

  assert.equal(postProcessingOutputIsVisible(reader, sample), true)
  assert.deepEqual(reads, [[6, 4, 1, 1, 0x1908, 0x1401]])
})

test('post-processing validation rejects transparent output and resets stale samples', () => {
  const { reader } = outputReader(0)
  const sample = new Uint8Array([255, 255, 255, 255])

  assert.equal(postProcessingOutputIsVisible(reader, sample), false)
  assert.deepEqual([...sample], [0, 0, 0, 0])
})

test('post-processing validation defers while the drawing buffer has no area', () => {
  const { reader, reads } = outputReader(0, [0, 0])

  assert.equal(postProcessingOutputIsVisible(reader, new Uint8Array(4)), true)
  assert.equal(reads.length, 0)
})

test('a transparent post-processing frame disables the chain and renders the base scene', () => {
  const calls: string[] = []
  let failure: unknown = 'not-called'
  const actions: PostProcessingRenderActions = {
    renderPostProcessing: () => calls.push('post-processing'),
    outputIsVisible: () => {
      calls.push('validate')
      return false
    },
    disablePostProcessing: (error) => {
      calls.push('disable')
      failure = error
    },
    renderDirect: () => calls.push('direct'),
  }

  assert.equal(renderPostProcessingFrame(actions, true), false)
  assert.deepEqual(calls, ['post-processing', 'validate', 'disable', 'direct'])
  assert.equal(failure, undefined)
})

test('a thrown post-processing failure also renders the base scene', () => {
  const failure = new Error('composer failed')
  const calls: string[] = []
  let reported: unknown
  const actions: PostProcessingRenderActions = {
    renderPostProcessing: () => {
      calls.push('post-processing')
      throw failure
    },
    outputIsVisible: () => {
      calls.push('validate')
      return true
    },
    disablePostProcessing: (error) => {
      calls.push('disable')
      reported = error
    },
    renderDirect: () => calls.push('direct'),
  }

  assert.equal(renderPostProcessingFrame(actions, true), false)
  assert.deepEqual(calls, ['post-processing', 'disable', 'direct'])
  assert.equal(reported, failure)
})

test('a compatible post-processing frame remains active', () => {
  const calls: string[] = []
  const actions: PostProcessingRenderActions = {
    renderPostProcessing: () => calls.push('post-processing'),
    outputIsVisible: () => {
      calls.push('validate')
      return true
    },
    disablePostProcessing: () => calls.push('disable'),
    renderDirect: () => calls.push('direct'),
  }

  assert.equal(renderPostProcessingFrame(actions, true), true)
  assert.deepEqual(calls, ['post-processing', 'validate'])
})

test('steady post-processing frames do not stall on framebuffer validation', () => {
  const calls: string[] = []
  const actions: PostProcessingRenderActions = {
    renderPostProcessing: () => calls.push('post-processing'),
    outputIsVisible: () => {
      calls.push('validate')
      return true
    },
    disablePostProcessing: () => calls.push('disable'),
    renderDirect: () => calls.push('direct'),
  }

  assert.equal(renderPostProcessingFrame(actions, false), true)
  assert.deepEqual(calls, ['post-processing'])
})

test('a bloom failure retries the surviving comic grade before direct rendering', () => {
  const failure = new Error('bloom pass failed')
  const calls: string[] = []
  let attempts = 0
  let reported: unknown
  const actions: PostProcessingRenderActions = {
    renderPostProcessing: () => {
      calls.push('post-processing')
      attempts += 1
      if (attempts === 1) throw failure
    },
    outputIsVisible: () => {
      calls.push('validate')
      return true
    },
    disableBloom: (error) => {
      calls.push('disable-bloom')
      reported = error
      return true
    },
    disablePostProcessing: () => calls.push('disable-all'),
    renderDirect: () => calls.push('direct'),
  }

  assert.equal(renderPostProcessingFrame(actions, false), true)
  assert.deepEqual(calls, [
    'post-processing',
    'disable-bloom',
    'post-processing',
  ])
  assert.equal(reported, failure)
})

test('a failed grade-only retry still falls back to the base scene', () => {
  const bloomFailure = new Error('bloom path failed')
  const gradeFailure = new Error('grade path failed')
  const calls: string[] = []
  let attempts = 0
  let reported: unknown
  const actions: PostProcessingRenderActions = {
    renderPostProcessing: () => {
      calls.push('post-processing')
      attempts += 1
      throw attempts === 1 ? bloomFailure : gradeFailure
    },
    outputIsVisible: () => true,
    disableBloom: () => {
      calls.push('disable-bloom')
      return true
    },
    disablePostProcessing: (error) => {
      calls.push('disable-all')
      reported = error
    },
    renderDirect: () => calls.push('direct'),
  }

  assert.equal(renderPostProcessingFrame(actions, false), false)
  assert.deepEqual(calls, [
    'post-processing',
    'disable-bloom',
    'post-processing',
    'disable-all',
    'direct',
  ])
  assert.equal(reported, gradeFailure)
})

test('policy disable releases the whole chain and re-enable replays stored grade tints', () => {
  const { renderer } = headlessRenderer()
  const processor = new BloomPostProcessor(
    renderer,
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    false,
  )
  let probe = inspect(processor)

  assert.equal(probe.composer, null, 'the visual policy owns the optional pipeline')
  assert.equal(probe.gradePass, null)
  assert.equal(probe.bloomPass, null)
  processor.setGradeTints(
    new THREE.Color().setRGB(0, 1, 0),
    new THREE.Color().setRGB(0, 0, 1),
  )

  processor.setEnabled(true)
  probe = inspect(processor)
  assert.deepEqual(
    probe.composer?.passes.map((pass) => pass.constructor.name),
    ['RenderPass', 'UnrealBloomPass', 'ShaderPass', 'OutputPass'],
  )
  assert.ok(probe.gradePass)
  const shadowTint = probe.gradePass.uniforms.uShadowTint.value as THREE.Color
  const highlightTint = probe.gradePass.uniforms.uHighlightTint.value as THREE.Color
  assert.equal(shadowTint.r, 0)
  assert.ok(shadowTint.g > 0)
  assert.equal(shadowTint.b, 0)
  assert.equal(highlightTint.r, 0)
  assert.equal(highlightTint.g, 0)
  assert.ok(highlightTint.b > 0)

  const bloomPass = probe.bloomPass
  assert.ok(bloomPass)
  let bloomDisposals = 0
  const disposeBloom = bloomPass.dispose.bind(bloomPass)
  bloomPass.dispose = () => {
    bloomDisposals += 1
    disposeBloom()
  }
  processor.setEnabled(false)
  probe = inspect(processor)
  probe = inspect(processor)
  assert.equal(probe.composer, null)
  assert.equal(probe.gradePass, null)
  assert.equal(probe.bloomPass, null)
  assert.deepEqual(processor.getDebugSnapshot().passes, [])
  assert.equal(bloomDisposals, 1)

  processor.dispose()
  assert.equal(bloomDisposals, 1, 'idempotent teardown does not release bloom twice')
})

test('a live bloom render failure removes bloom and completes the frame with grade', () => {
  const { renderer, state } = headlessRenderer()
  const processor = new BloomPostProcessor(
    renderer,
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    true,
    { enhanced: true, antialiasing: 'fxaa' },
  )
  const composer = inspect(processor).composer
  assert.ok(composer)
  const bloomPass = inspect(processor).bloomPass
  assert.ok(bloomPass)
  let bloomDisposals = 0
  const disposeBloom = bloomPass.dispose.bind(bloomPass)
  bloomPass.dispose = () => {
    bloomDisposals += 1
    disposeBloom()
  }

  const failure = new Error('simulated bloom render failure')
  const originalTarget = new THREE.WebGLRenderTarget(2, 2)
  const failedTarget = new THREE.WebGLRenderTarget(1, 1)
  state.renderTarget = originalTarget
  let postRenders = 0
  composer.render = () => {
    postRenders += 1
    if (postRenders === 1) {
      renderer.setRenderTarget(failedTarget)
      renderer.setClearColor(0xff0000, 0.25)
      renderer.autoClear = false
      throw failure
    }
    assert.equal(renderer.getRenderTarget(), originalTarget)
    assert.equal(renderer.autoClear, true)
    assert.equal(renderer.getClearColor(new THREE.Color()).getHex(), 0x172033)
    assert.equal(renderer.getClearAlpha(), 1)
  }

  const warnings = captureWarnings(() => processor.render())

  assert.equal(postRenders, 2, 'the second render uses the grade-only chain')
  assert.equal(state.directRenders, 0)
  assert.ok(inspect(processor).composer, 'post-processing remains available')
  assert.equal(inspect(processor).bloomPass, null)
  assert.equal(bloomDisposals, 1)
  assert.deepEqual(
    processor.getDebugSnapshot().passes,
    ['scene', 'grade', 'output', 'fxaa'],
  )
  assert.equal(state.renderTarget, originalTarget)
  assert.equal(renderer.autoClear, true)
  assert.equal(state.clearColor.getHex(), 0x172033)
  assert.equal(state.clearAlpha, 1)
  assert.match(String(warnings[0]?.[0]), /retrying the comic grade only/)

  processor.dispose()
  assert.equal(bloomDisposals, 1, 'full teardown does not revisit removed bloom')
  originalTarget.dispose()
  failedTarget.dispose()
})

test('a failed grade-only retry restores renderer state before direct fallback', () => {
  const { renderer, state } = headlessRenderer()
  const processor = new BloomPostProcessor(
    renderer,
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    true,
  )
  const composer = inspect(processor).composer
  assert.ok(composer)

  const originalTarget = new THREE.WebGLRenderTarget(2, 2)
  const failedTarget = new THREE.WebGLRenderTarget(1, 1)
  state.renderTarget = originalTarget
  let postRenders = 0
  composer.render = () => {
    postRenders += 1
    renderer.setRenderTarget(failedTarget)
    renderer.setClearColor(0xff0000, 0.25)
    renderer.autoClear = false
    throw new Error(postRenders === 1 ? 'bloom failed' : 'grade failed')
  }

  const warnings = captureWarnings(() => processor.render())

  assert.equal(postRenders, 2)
  assert.equal(state.directRenders, 1)
  assert.equal(inspect(processor).composer, null)
  assert.deepEqual(processor.getDebugSnapshot().passes, [])
  assert.equal(state.renderTarget, null, 'direct fallback explicitly targets the canvas')
  assert.equal(renderer.autoClear, true)
  assert.equal(state.clearColor.getHex(), 0x172033)
  assert.equal(state.clearAlpha, 1)
  assert.match(String(warnings[0]?.[0]), /retrying the comic grade only/)
  assert.match(String(warnings[1]?.[0]), /Direct rendering will be used/)

  processor.dispose()
  originalTarget.dispose()
  failedTarget.dispose()
})
