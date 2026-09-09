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
  disablePostProcessing(error?: unknown): void
  renderDirect(): void
}

export interface BloomPresentationOptions {
  readonly enhanced?: boolean
  readonly antialiasing?: 'none' | 'fxaa'
}

export function postProcessingPassNames(enabled: boolean, antialiasing: 'none' | 'fxaa'): readonly string[] {
  return enabled ? ['scene', 'bloom', 'grade', 'output', ...(antialiasing === 'fxaa' ? ['fxaa'] : [])] : []
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
  let renderError: unknown
  try {
    actions.renderPostProcessing()
    if (!validateOutput || actions.outputIsVisible()) return true
  } catch (error) {
    renderError = error
  }

  actions.disablePostProcessing(renderError)
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
 * The optional post chain.
 *
 * Legacy bloom: `RenderPass -> UnrealBloomPass -> ComicGradePass -> OutputPass`.
 * Enhanced post appends a non-converting FXAA resolve.
 * When bloom is off there is no composer at all and the renderer draws straight to
 * the canvas — that path stays real and supported, so the art has to read without
 * any of this. Grade and bloom are a finish, not a crutch.
 */
export class BloomPostProcessor {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.Camera
  private composer: EffectComposer | null = null
  private gradePass: ShaderPass | null = null
  private aaPass: ShaderPass | null = null
  private readonly options: BloomPresentationOptions
  private antialiasing: 'none' | 'fxaa'
  private readonly owned: VisualResourceOwner[] = []
  private readonly bufferSize = new THREE.Vector2()
  private readonly shadowTint = DEFAULT_SHADOW_TINT.clone()
  private readonly highlightTint = DEFAULT_HIGHLIGHT_TINT.clone()
  private width = 1
  private height = 1
  private validationPending = false
  private readonly outputSample = new Uint8Array(4)
  private readonly renderActions: PostProcessingRenderActions = {
    renderPostProcessing: () => {
      if (!this.composer) throw new Error('Bloom composer was unavailable during render')
      this.composer.render()
    },
    outputIsVisible: () =>
      postProcessingOutputIsVisible(this.renderer.getContext(), this.outputSample),
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

  setEnabled(enabled: boolean): void {
    if (enabled === Boolean(this.composer)) return
    if (!enabled) {
      this.disposeComposer()
      return
    }

    try {
      const target = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.HalfFloatType })
      this.owned.push(target)
      const composer = new EffectComposer(this.renderer, target)
      this.owned.pop()
      this.owned.push(composer)
      this.composer = composer
      // Targets and pass sizes are physical pixels. Composer's cached renderer
      // DPR must not multiply them a second time, including after a DPI change.
      composer.setPixelRatio(1)
      const scenePass = new RenderPass(this.scene, this.camera)
      this.owned.push(scenePass)
      composer.addPass(scenePass)
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(this.width, this.height),
        BLOOM_STRENGTH,
        BLOOM_RADIUS,
        BLOOM_THRESHOLD,
      )
      this.owned.push(bloomPass)
      composer.addPass(bloomPass)
      const gradePass = new ShaderPass(ComicGradeShader)
      this.owned.push(gradePass)
      if (this.options.enhanced) {
        gradePass.uniforms.uVignette.value = 0.1
        gradePass.uniforms.uSaturation.value = 1.02
        gradePass.uniforms.uShadowAmount.value = 0.035
        gradePass.uniforms.uHighlightAmount.value = 0.04
      }
      composer.addPass(gradePass)
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
      this.gradePass = gradePass
      this.validationPending = true
      // Bloom can be toggled at any time; replay whatever the atmosphere last asked
      // for so a fresh chain does not snap back to the noon defaults.
      this.writeGradeTints()
    } catch (error) {
      this.disableComposerAfterFailure('could not be enabled', error)
    }
  }

  /**
   * Points the grade at the current atmosphere.
   *
   * Only the hue of each colour is taken — the magnitudes are what set the strength
   * of the grade and they stay fixed. Safe to call every frame: nothing allocates,
   * and it is a no-op while bloom is off.
   */
  setGradeTints(shadow: THREE.Color, highlight: THREE.Color): void {
    retint(shadow, DEFAULT_SHADOW_TINT, this.shadowTint)
    retint(highlight, DEFAULT_HIGHLIGHT_TINT, this.highlightTint)
    this.writeGradeTints()
  }

  /** Diagnostic A/B seam; the engine's normal path always uses its resolved policy. */
  setAntialiasing(value: 'none' | 'fxaa'): void {
    if (value !== 'none' && value !== 'fxaa') throw new Error('Unknown post antialiasing mode')
    if (value === this.antialiasing) return
    const enabled = this.composer !== null
    this.disposeComposer()
    this.antialiasing = value
    this.setEnabled(enabled)
  }

  private writeGradeTints(): void {
    const uniforms = this.gradePass?.uniforms
    if (!uniforms) return
    ;(uniforms.uShadowTint.value as THREE.Color).copy(this.shadowTint)
    ;(uniforms.uHighlightTint.value as THREE.Color).copy(this.highlightTint)
  }

  render(): void {
    if (!this.composer) {
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
    if (!this.composer) return
    try {
      this.composer.setSize(this.width, this.height)
      this.aaPass?.uniforms.resolution.value.set(1 / this.width, 1 / this.height)
      this.validationPending = true
    } catch (error) {
      this.disableComposerAfterFailure('could not be resized', error)
    }
  }

  dispose(): void {
    this.disposeComposer()
  }

  private disposeComposer(): void {
    this.composer = null
    this.gradePass = null
    this.aaPass = null
    this.validationPending = false
    disposeOwnedVisualResources(this.owned)
  }

  private disableComposerAfterFailure(reason: string, error?: unknown): void {
    const message = `Korovany: bloom post-processing ${reason}. Direct rendering will be used.`
    if (error === undefined) console.warn(message)
    else console.warn(message, error)

    try {
      this.disposeComposer()
    } catch (disposeError) {
      console.warn('Korovany: failed post-processing resources could not all be disposed.', disposeError)
      throw disposeError
    }
  }

  getDebugSnapshot() {
    return {
      width: this.width, height: this.height, composer: this.composer !== null,
      passes: postProcessingPassNames(this.composer !== null, this.antialiasing),
      sceneSamples: this.composer?.renderTarget1.samples ?? 0,
    }
  }
}
