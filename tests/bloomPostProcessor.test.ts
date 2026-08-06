import assert from 'node:assert/strict'
import test from 'node:test'
import {
  postProcessingOutputIsVisible,
  renderPostProcessingFrame,
  type PostProcessingOutputReader,
  type PostProcessingRenderActions,
} from '../src/game/BloomPostProcessor.ts'

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
