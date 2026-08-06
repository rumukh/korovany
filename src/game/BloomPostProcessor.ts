import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

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
 * When bloom is on: `RenderPass -> UnrealBloomPass -> ComicGradePass -> OutputPass`.
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
    renderDirect: () => this.renderer.render(this.scene, this.camera),
  }

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    enabled: boolean,
  ) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.setEnabled(enabled)
  }

  setEnabled(enabled: boolean): void {
    if (enabled === Boolean(this.composer)) return
    if (!enabled) {
      this.disposeComposer()
      return
    }

    try {
      const composer = new EffectComposer(this.renderer)
      this.composer = composer
      composer.addPass(new RenderPass(this.scene, this.camera))
      composer.addPass(
        new UnrealBloomPass(
          new THREE.Vector2(this.width, this.height),
          BLOOM_STRENGTH,
          BLOOM_RADIUS,
          BLOOM_THRESHOLD,
        ),
      )
      const gradePass = new ShaderPass(ComicGradeShader)
      composer.addPass(gradePass)
      // OutputPass reads the renderer's tone mapping and exposure settings at render
      // time, so it has to stay last.
      composer.addPass(new OutputPass())
      composer.setSize(this.width, this.height)
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
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    if (!this.composer) return
    try {
      this.composer.setSize(this.width, this.height)
      this.validationPending = true
    } catch (error) {
      this.disableComposerAfterFailure('could not be resized', error)
    }
  }

  dispose(): void {
    this.disposeComposer()
  }

  private disposeComposer(): void {
    const composer = this.composer
    this.composer = null
    this.gradePass = null
    this.validationPending = false
    if (!composer) return
    composer.passes.forEach((pass) => pass.dispose())
    composer.dispose()
  }

  private disableComposerAfterFailure(reason: string, error?: unknown): void {
    const message = `Korovany: bloom post-processing ${reason}. Direct rendering will be used.`
    if (error === undefined) console.warn(message)
    else console.warn(message, error)

    const composer = this.composer
    this.composer = null
    this.gradePass = null
    this.validationPending = false
    if (!composer) return

    composer.passes.forEach((pass) => {
      try {
        pass.dispose()
      } catch (disposeError) {
        console.warn('Korovany: a failed bloom pass could not be disposed.', disposeError)
      }
    })
    try {
      composer.dispose()
    } catch (disposeError) {
      console.warn('Korovany: failed bloom render targets could not be disposed.', disposeError)
    }
  }
}
