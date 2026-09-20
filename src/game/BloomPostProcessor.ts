import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js'
import { disposeOwnedVisualResources, type VisualResourceOwner } from './visualLifecycle.ts'

// §08 — retuned so emissive FX still bloom but ink lines and dark cloth do not get
// eaten. The old 0.55 / 0.4 / 0.85 washed out every outline it touched.
const BLOOM_STRENGTH = 0.42
const BLOOM_RADIUS = 0.55
const BLOOM_THRESHOLD = 0.9

const VIGNETTE_STRENGTH = 0.22
const SATURATION_LIFT = 1.08
const SHADOW_TINT_AMOUNT = 0.16
const HIGHLIGHT_TINT_AMOUNT = 0.1

// The grade multiplies by these, so their *magnitude* is the strength of the effect
// and only their hue should follow the scene. A raw daylight fog colour dropped in
// here would brighten shadows instead of cooling them.
const DEFAULT_SHADOW_TINT = new THREE.Color(0x2c3c58)
const DEFAULT_HIGHLIGHT_TINT = new THREE.Color(0xffe2b0)

export interface PostProcessingOutputReader {
  readonly drawingBufferWidth: number
  readonly drawingBufferHeight: number
  readonly RGBA: number
  readonly UNSIGNED_BYTE: number
  readPixels(
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: Uint8Array,
  ): void
}

export interface PostProcessingRenderActions {
  renderPostProcessing(): void
  outputIsVisible(): boolean
  /**
   * Removes an active bloom stage and returns whether the remaining grade can be
   * retried. Optional so the headless/direct fallback contract stays compatible
   * with renderers that cannot isolate their glow stage.
   */
  disableBloom?(error?: unknown): boolean
  disablePostProcessing(error?: unknown): void
  renderDirect(): void
}

export interface BloomPresentationOptions {
  readonly enhanced?: boolean
  readonly antialiasing?: 'none' | 'fxaa'
}

export function postProcessingPassNames(
  enabled: boolean,
  antialiasing: 'none' | 'fxaa',
  bloom = enabled,
): readonly string[] {
  if (!enabled) return []
  return [
    'scene',
    ...(bloom ? ['bloom'] : []),
    'grade',
    'output',
    ...(antialiasing === 'fxaa' ? ['fxaa'] : []),
  ]
}

/**
 * The game scene always has an opaque background, so a transparent center pixel
 * means the post chain silently dropped the base render.
 */
export function postProcessingOutputIsVisible(
  context: PostProcessingOutputReader,
  sample: Uint8Array,
): boolean {
  const width = context.drawingBufferWidth
  const height = context.drawingBufferHeight
  if (width < 1 || height < 1) return true

  sample.fill(0)
  context.readPixels(
    Math.floor(width / 2),
    Math.floor(height / 2),
    1,
    1,
    context.RGBA,
    context.UNSIGNED_BYTE,
    sample,
  )
  return sample[3] > 0
}

export function renderPostProcessingFrame(
  actions: PostProcessingRenderActions,
  validateOutput: boolean,
): boolean {
  const attempt = (): { succeeded: boolean; error?: unknown } => {
    try {
      actions.renderPostProcessing()
      return {
        succeeded: !validateOutput || actions.outputIsVisible(),
      }
    } catch (error) {
      return { succeeded: false, error }
    }
  }

  const firstAttempt = attempt()
  if (firstAttempt.succeeded) return true

  if (actions.disableBloom?.(firstAttempt.error)) {
    const gradeOnlyAttempt = attempt()
    if (gradeOnlyAttempt.succeeded) return true
    actions.disablePostProcessing(gradeOnlyAttempt.error)
  } else {
    actions.disablePostProcessing(firstAttempt.error)
  }

  actions.renderDirect()
  return false
}

/** Takes `source`'s hue at `reference`'s magnitude. Allocation-free. */
function retint(
  source: THREE.Color,
  reference: THREE.Color,
  target: THREE.Color,
): void {
  const peak = Math.max(source.r, source.g, source.b, 1e-4)
  const scale = Math.max(reference.r, reference.g, reference.b) / peak
  target.setRGB(source.r * scale, source.g * scale, source.b * scale)
}

/**
 * One fullscreen shader that finishes the drawing.
 *
 * A comic page is not evenly exposed: the edges fall off, the shadows drift cool and
 * the lights drift warm. Doing it here rather than in every material means it costs
 * one pass and it applies to particles, sprites and the sky as well as to lit
 * geometry.
 */
const ComicGradeShader = {
  name: 'ComicGradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: VIGNETTE_STRENGTH },
    uSaturation: { value: SATURATION_LIFT },
    uShadowTint: { value: DEFAULT_SHADOW_TINT.clone() },
    uHighlightTint: { value: DEFAULT_HIGHLIGHT_TINT.clone() },
    uShadowAmount: { value: SHADOW_TINT_AMOUNT },
    uHighlightAmount: { value: HIGHLIGHT_TINT_AMOUNT },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uSaturation;
    uniform vec3 uShadowTint;
    uniform vec3 uHighlightTint;
    uniform float uShadowAmount;
    uniform float uHighlightAmount;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D( tDiffuse, vUv );
      vec3 color = texel.rgb;

      float lum = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
      color = mix( vec3( lum ), color, uSaturation );

      float shadowMask = 1.0 - smoothstep( 0.0, 0.45, lum );
      float highlightMask = smoothstep( 0.55, 1.0, lum );
      color = mix( color, color * uShadowTint * 2.0, shadowMask * uShadowAmount );
      color = mix( color, color * uHighlightTint * 1.6, highlightMask * uHighlightAmount );

      vec2 offset = vUv - 0.5;
      float vignette = 1.0 - uVignette * dot( offset, offset ) * 1.6;
      color *= clamp( vignette, 0.0, 1.0 );

      gl_FragColor = vec4( max( color, vec3( 0.0 ) ), texel.a );
    }
  `,
}

/**
 * The optional chain follows the resolved visual policy:
 *
 * - enabled: `RenderPass -> UnrealBloomPass -> ComicGradePass -> OutputPass`
 * - enhanced FXAA appends a non-converting resolve
 * - disabled: direct rendering, with no composer allocations
 *
 * If bloom fails while the policy still enables post-processing, only its
 * multi-resolution targets are released and the grade is retried for that frame.
 */
export class BloomPostProcessor {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.Camera
  private composer: EffectComposer | null = null
  private gradePass: ShaderPass | null = null
  private bloomPass: UnrealBloomPass | null = null
  private aaPass: ShaderPass | null = null
  private readonly options: BloomPresentationOptions
  private antialiasing: 'none' | 'fxaa'
  private readonly owned: VisualResourceOwner[] = []
  private readonly bufferSize = new THREE.Vector2()
  private readonly shadowTint = DEFAULT_SHADOW_TINT.clone()
  private readonly highlightTint = DEFAULT_HIGHLIGHT_TINT.clone()
  private readonly savedClearColor = new THREE.Color()
  private width = 1
  private height = 1
  private validationPending = false
  private readonly outputSample = new Uint8Array(4)
  private readonly renderActions: PostProcessingRenderActions = {
    renderPostProcessing: () => this.renderComposer(),
    outputIsVisible: () =>
      postProcessingOutputIsVisible(this.renderer.getContext(), this.outputSample),
    disableBloom: (error) => this.disableBloomAfterFailure(error),
    disablePostProcessing: (error) => {
      this.disableComposerAfterFailure(
        error === undefined ? 'produced a transparent frame' : 'failed while rendering',
        error,
      )
    },
    renderDirect: () => {
      this.renderer.setRenderTarget(null)
      this.renderer.render(this.scene, this.camera)
    },
  }

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    enabled: boolean,
    options: BloomPresentationOptions = {},
  ) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.options = options
    this.antialiasing = options.antialiasing ?? 'none'
    this.renderer.getDrawingBufferSize(this.bufferSize)
    this.width = Math.max(1, this.bufferSize.x)
    this.height = Math.max(1, this.bufferSize.y)
    this.setEnabled(enabled)
  }

  setEnabled(enabled: boolean, antialiasing: 'none' | 'fxaa' = this.antialiasing): void {
    if (antialiasing !== 'none' && antialiasing !== 'fxaa') throw new Error('Unknown post antialiasing mode')
    if (antialiasing !== this.antialiasing) {
      this.disposeComposer()
      this.antialiasing = antialiasing
    }
    if (!enabled) {
      this.disposeComposer()
      return
    }

    if (!this.composer && !this.createGradeComposer()) return
    this.enableBloom()
  }

  /**
   * Points the grade at the current atmosphere.
   *
   * Only the hue of each colour is taken — the magnitudes are what set the strength
   * of the grade and they stay fixed. Safe to call every frame: nothing allocates,
   * and it is a no-op only when the whole post-processing pipeline is unavailable.
   */
  setGradeTints(shadow: THREE.Color, highlight: THREE.Color): void {
    retint(shadow, DEFAULT_SHADOW_TINT, this.shadowTint)
    retint(highlight, DEFAULT_HIGHLIGHT_TINT, this.highlightTint)
    this.writeGradeTints()
  }

  /** Diagnostic override lasts until the next explicit engine post-policy update. */
  setAntialiasing(value: 'none' | 'fxaa'): void {
    this.setEnabled(this.composer !== null, value)
  }

  private writeGradeTints(): void {
    const uniforms = this.gradePass?.uniforms
    if (!uniforms) return
    ;(uniforms.uShadowTint.value as THREE.Color).copy(this.shadowTint)
    ;(uniforms.uHighlightTint.value as THREE.Color).copy(this.highlightTint)
  }

  render(): void {
    if (!this.composer) {
      this.renderer.setRenderTarget(null)
      this.renderer.render(this.scene, this.camera)
      return
    }

    const validateOutput = this.validationPending && this.scene.background !== null
    if (validateOutput) this.validationPending = false
    renderPostProcessingFrame(this.renderActions, validateOutput)
  }

  setSize(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      throw new RangeError('Post-processing dimensions must be finite and positive')
    }
    this.renderer.getDrawingBufferSize(this.bufferSize)
    const nextWidth = Math.max(1, this.bufferSize.x)
    const nextHeight = Math.max(1, this.bufferSize.y)
    if (this.width === nextWidth && this.height === nextHeight) return
    this.width = nextWidth
    this.height = nextHeight
    const composer = this.composer
    if (!composer) return

    try {
      composer.setSize(this.width, this.height)
      this.aaPass?.uniforms.resolution.value.set(1 / this.width, 1 / this.height)
      this.validationPending = true
      return
    } catch (error) {
      if (!this.disableBloomAfterFailure(error, 'could not be resized')) {
        this.disableComposerAfterFailure('could not be resized', error)
        return
      }
    }

    try {
      composer.setSize(this.width, this.height)
      this.aaPass?.uniforms.resolution.value.set(1 / this.width, 1 / this.height)
      this.validationPending = true
    } catch (error) {
      this.disableComposerAfterFailure('could not be resized after bloom was removed', error)
    }
  }

  dispose(): void {
    this.disposeComposer()
  }

  private createGradeComposer(): boolean {
    try {
      const target = new THREE.WebGLRenderTarget(this.width, this.height, {
        type: THREE.HalfFloatType,
      })
      this.owned.push(target)
      const composer = new EffectComposer(this.renderer, target)
      this.owned.pop()
      this.owned.push(composer)
      this.composer = composer
      // Targets and pass sizes are physical pixels. Composer's cached renderer
      // DPR must not multiply them a second time, including after a DPI change.
      composer.setPixelRatio(1)

      const renderPass = new RenderPass(this.scene, this.camera)
      this.owned.push(renderPass)
      composer.addPass(renderPass)

      const gradePass = new ShaderPass(ComicGradeShader)
      this.owned.push(gradePass)
      if (this.options.enhanced) {
        gradePass.uniforms.uVignette.value = 0.1
        gradePass.uniforms.uSaturation.value = 1.02
        gradePass.uniforms.uShadowAmount.value = 0.035
        gradePass.uniforms.uHighlightAmount.value = 0.04
      }
      composer.addPass(gradePass)
      this.gradePass = gradePass

      const outputPass = new OutputPass()
      this.owned.push(outputPass)
      composer.addPass(outputPass)

      if (this.antialiasing === 'fxaa') {
        const aaPass = new ShaderPass(FXAAShader)
        this.owned.push(aaPass)
        aaPass.material.toneMapped = false
        // FXAAShader samples display-referred pixels and contains no output
        // transform. OutputPass remains the one and only conversion.
        aaPass.uniforms.resolution.value.set(1 / this.width, 1 / this.height)
        composer.addPass(aaPass)
        this.aaPass = aaPass
      }

      this.validationPending = true
      // Atmosphere updates can arrive while policy disables the chain. Replay the
      // latest tint when policy later creates a fresh grade.
      this.writeGradeTints()
      return true
    } catch (error) {
      this.disableComposerAfterFailure('could not be enabled', error)
      return false
    }
  }

  private enableBloom(): void {
    const composer = this.composer
    if (!composer || this.bloomPass) return

    let bloomPass: UnrealBloomPass
    try {
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(this.width, this.height),
        BLOOM_STRENGTH,
        BLOOM_RADIUS,
        BLOOM_THRESHOLD,
      )
    } catch (error) {
      console.warn(
        'Korovany: bloom could not be created. Comic grade remains active.',
        error,
      )
      return
    }

    this.owned.push(bloomPass)
    try {
      composer.insertPass(bloomPass, 1)
      this.bloomPass = bloomPass
      this.validationPending = true
    } catch (error) {
      // EffectComposer inserts before sizing, so an insertion error can leave the
      // failed pass in the array even though ownership was never committed.
      composer.removePass(bloomPass)
      this.disposeOwnedResource(bloomPass, 'failed bloom pass')
      console.warn(
        'Korovany: bloom could not be attached. Comic grade remains active.',
        error,
      )
    }
  }

  private renderComposer(): void {
    const composer = this.composer
    if (!composer) throw new Error('Comic grade composer was unavailable during render')

    const renderTarget = this.renderer.getRenderTarget()
    const autoClear = this.renderer.autoClear
    this.renderer.getClearColor(this.savedClearColor)
    const clearAlpha = this.renderer.getClearAlpha()

    try {
      composer.render()
    } finally {
      // EffectComposer and UnrealBloomPass restore these only on their success
      // paths. Restore them here as well so a grade-only retry or direct fallback
      // cannot accidentally render into a half-finished bloom target.
      this.renderer.setRenderTarget(renderTarget)
      this.renderer.setClearColor(this.savedClearColor, clearAlpha)
      this.renderer.autoClear = autoClear
    }
  }

  private removeBloomPass(): boolean {
    const bloomPass = this.bloomPass
    if (!bloomPass) return false

    this.bloomPass = null
    this.composer?.removePass(bloomPass)
    this.validationPending = true
    this.disposeOwnedResource(bloomPass, 'bloom pass')
    return true
  }

  private disableBloomAfterFailure(
    error?: unknown,
    reason = error === undefined
      ? 'produced a transparent frame'
      : 'failed while rendering',
  ): boolean {
    if (!this.removeBloomPass()) return false

    const message =
      `Korovany: post-processing with bloom ${reason}. ` +
      'Bloom was removed; retrying the comic grade only.'
    if (error === undefined) console.warn(message)
    else console.warn(message, error)
    return true
  }

  private disposeOwnedResource(resource: VisualResourceOwner, label: string): void {
    const index = this.owned.indexOf(resource)
    if (index >= 0) this.owned.splice(index, 1)
    try {
      resource.dispose()
    } catch (error) {
      console.warn(`Korovany: a ${label} could not be disposed.`, error)
    }
  }

  private disposeComposer(): void {
    this.composer = null
    this.gradePass = null
    this.bloomPass = null
    this.aaPass = null
    this.validationPending = false
    disposeOwnedVisualResources(this.owned)
  }

  private disableComposerAfterFailure(reason: string, error?: unknown): void {
    const message = `Korovany: post-processing ${reason}. Direct rendering will be used.`
    if (error === undefined) console.warn(message)
    else console.warn(message, error)

    try {
      this.disposeComposer()
    } catch (disposeError) {
      console.warn('Korovany: failed post-processing resources could not all be disposed.', disposeError)
    }
  }

  getDebugSnapshot() {
    return {
      width: this.width, height: this.height, composer: this.composer !== null,
      passes: postProcessingPassNames(
        this.composer !== null,
        this.antialiasing,
        this.bloomPass !== null,
      ),
      sceneSamples: this.composer?.renderTarget1.samples ?? 0,
    }
  }
}
