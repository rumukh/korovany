import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import * as THREE from 'three'
import { StylizedArtLibrary, validateArtGeometry } from '../src/game/art/index.ts'
import { affineSkinNormalChunk } from '../src/game/art/skinNormalShader.ts'

interface RecordedVertex {
  vertex: number
  boneName: string
  weights: number[]
  skinIndex: number[]
  bindMatrix: number[]
  bindMatrixInverse: number[]
  weightedBoneMatrix: number[]
  affine: number[]
  modelMatrix: number[]
  position: number[]
  deformedPosition: number[]
  normal: number[]
  outlineNormal: number[] | null
  previousNormalErrorRadians: number
}
interface RecordedTriangle {
  points: number[][]
  normal: number[]
  affine: number[]
  modelMatrix: number[]
  deformed: number[][]
}
interface RigCase {
  name: string
  sourceName: string
  vertices: RecordedVertex[]
  triangles: RecordedTriangle[]
}
const rawFixture = gunzipSync(readFileSync(new URL('./fixtures/affine-rigs-fc1af54.json.gz', import.meta.url)))
const fixture: { revision: string; cases: RigCase[] } = JSON.parse(rawFixture.toString('utf8'))
const ink = { player: 0x102030, enemy: 0x301020, interactable: 0x302010, landmark: 0x203010 }

function shader(material: THREE.Material, kind: 'standard' | 'basic' | 'depth') {
  const result = {
    uniforms: {}, vertexShader: THREE.ShaderLib[kind].vertexShader,
    fragmentShader: THREE.ShaderLib[kind].fragmentShader,
  }
  material.onBeforeCompile(result as never, null as never)
  return result.vertexShader
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`vec3 ${name}(`)
  assert.ok(start >= 0, `Missing emitted ${name}`)
  const opening = source.indexOf('{', start)
  let depth = 1
  for (let offset = opening + 1; offset < source.length; offset++) {
    if (source[offset] === '{') depth++
    else if (source[offset] === '}' && --depth === 0) return source.slice(start, offset + 1)
  }
  assert.fail(`Unclosed ${name}`)
}

type CpuVector = { x: number; y: number; z: number }
type CpuMatrix = CpuVector[]

/**
 * Execute the exact emitted scalar GLSL arithmetic, not a second hand-written
 * normal transform. This adapter is not a GLSL compiler/float32 GPU simulation.
 * Independent transformed triangles and tangent orthogonality are the oracle.
 */
function normalEvaluator(source: string, outline = false, wind = false) {
  let functions = functionBody(source, 'kArtUnitNormal') + '\n' + functionBody(source, 'kArtAffineNormal')
  if (wind) functions += '\n' + functionBody(source, 'kArtDeformNormal')
  const variable = outline ? 'kOutlineNormal' : 'objectNormal'
  const assignment = `${variable} = kArtAffineNormal( mat3( skinMatrix ), ${variable} );`
  assert.ok(source.includes(assignment), `Emitted ${variable} must actually use the affine helper`)
  const windAssignment = `${variable} = kArtDeformNormal( ${variable} );`
  if (wind) assert.ok(source.indexOf(windAssignment) > source.indexOf(assignment))
  const asJs = functions
    .replace(/\bvec3 (kArt\w+)\(/g, 'function $1(')
    .replace(/function (\w+)\(([^)]*)\)/g, (_match, name: string, params: string) =>
      `function ${name}(${params.replace(/\b(?:vec3|mat3)\s+/g, '')})`)
    .replace(/\b(?:float|vec3)\s+(\w+)\s*=/g, 'let $1 =')
  const vec3 = (x: number, y: number, z: number): CpuVector => ({ x, y, z })
  const mat3 = (...values: (CpuMatrix | CpuVector)[]): CpuMatrix =>
    Array.isArray(values[0]) ? values[0] : values as CpuVector[]
  const evaluate: (basis: CpuMatrix, value: CpuVector, shear: CpuVector) => CpuVector = new Function(
    'abs', 'max', 'inversesqrt', 'vec3', 'mat3',
    `return (skinMatrix, value, shear) => {
      const kArtWindShear = () => shear;
      ${asJs}
      let ${variable} = value;
      ${assignment}
      ${wind ? windAssignment : ''}
      return ${variable};
    }`,
  )(Math.abs, Math.max, (x: number) => 1 / Math.sqrt(x), vec3, mat3)
  return (matrix: THREE.Matrix4, value: THREE.Vector3, shear = new THREE.Vector3()): THREE.Vector3 => {
    const e = matrix.elements
    const result = evaluate([vec3(e[0], e[1], e[2]), vec3(e[4], e[5], e[6]), vec3(e[8], e[9], e[10])], value, shear)
    return new THREE.Vector3(result.x, result.y, result.z)
  }
}

function evaluatedShaders(wind = false) {
  const art = new StylizedArtLibrary({ ink, enhanced: true })
  const material = art.createMaterial({ color: 0xffffff, surface: 'cloth', attributes: { wind } })
  const geometry = new THREE.BoxGeometry()
  if (wind) geometry.setAttribute('artWind', new THREE.Float32BufferAttribute(new Float32Array(24 * 2).fill(0.5), 2))
  const source = new THREE.Mesh(geometry, material)
  const binding = art.bindRenderSource(source, { shadowParticipation: true })
  const outline = art.applyOutline(source, 'structural')
  const mainShader = shader(material, 'standard')
  const inkShader = shader(outline.shells[0].material as THREE.Material, 'basic')
  const depthShader = shader(source.customDepthMaterial!, 'depth')
  return {
    mainShader, inkShader, depthShader,
    main: normalEvaluator(mainShader, false, wind),
    ink: normalEvaluator(inkShader, true, wind),
    dispose() { art.releaseOutline(outline); art.releaseRenderSource(binding); geometry.dispose(); material.dispose(); art.dispose() },
  }
}

function tangentOracle(matrix: THREE.Matrix4, normal: THREE.Vector3) {
  const axis = Math.abs(normal.x) < 0.8 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const first = new THREE.Vector3().crossVectors(normal, axis).normalize()
  const second = new THREE.Vector3().crossVectors(normal, first).normalize()
  const linear = new THREE.Matrix3().setFromMatrix4(matrix)
  first.applyMatrix3(linear)
  second.applyMatrix3(linear)
  const expected = new THREE.Vector3().crossVectors(first, second)
  if (matrix.determinant() < 0) expected.negate()
  return { expected: expected.normalize(), first: first.normalize(), second: second.normalize() }
}

function assertUnit(actual: THREE.Vector3): void {
  assert.ok(actual.toArray().every(Number.isFinite), 'Normal must remain finite')
  assert.ok(Math.abs(actual.length() - 1) < 1e-10, 'Normal must remain unit length')
}

test('immutable real character, creature and wagon CPU poses exercise affine normal errors, not invented rig matrices', () => {
  assert.equal(createHash('sha256').update(rawFixture).digest('hex'), 'c339ecf8555587c172cda4c9dfbd460087c8cc522271e280ed208abdefd02e60')
  assert.equal(fixture.revision, 'fc1af5436c7db73cd090f8a61823430f4a45408c')
  assert.equal(fixture.cases.length, 24)
  const shaders = evaluatedShaders()
  let vertices = 0, triangles = 0, oldError = 0, omittedBindError = 0, doubledModelError = 0
  const failuresByPopulation = new Map<string, number>()
  try {
    for (const rig of fixture.cases) {
      for (const record of rig.vertices) {
        const affine = new THREE.Matrix4().fromArray(record.affine)
        const complete = new THREE.Matrix4().fromArray(record.bindMatrixInverse)
          .multiply(new THREE.Matrix4().fromArray(record.weightedBoneMatrix))
          .multiply(new THREE.Matrix4().fromArray(record.bindMatrix))
        assert.ok(complete.elements.every((v, i) => Math.abs(v - affine.elements[i]) < 1e-10))
        const position = new THREE.Vector3().fromArray(record.position)
        const actualPosition = new THREE.Vector3().fromArray(record.deformedPosition)
        assert.ok(position.applyMatrix4(affine).distanceTo(actualPosition) < 1e-5, 'Matrix must describe production getVertexPosition')
        const model = new THREE.Matrix4().fromArray(record.modelMatrix)
        const modelNormal = new THREE.Matrix3().getNormalMatrix(model)
        for (const [isInk, values] of [[false, record.normal], [true, record.outlineNormal]] as const) {
          if (!values) continue
          const normal = new THREE.Vector3().fromArray(values).normalize()
          const actual = (isInk ? shaders.ink : shaders.main)(affine, normal)
          const oracle = tangentOracle(affine, normal)
          assertUnit(actual)
          assert.ok(actual.distanceTo(oracle.expected) < 1e-9, `${rig.name}/${record.boneName}: affine normal disagrees`)
          assert.ok(Math.abs(actual.dot(oracle.first)) < 1e-9 && Math.abs(actual.dot(oracle.second)) < 1e-9)
          const world = actual.clone().applyMatrix3(modelNormal).normalize()
          assert.ok(world.distanceTo(tangentOracle(model.clone().multiply(affine), normal).expected) < 1e-9)
          doubledModelError = Math.max(doubledModelError, world.clone().applyMatrix3(modelNormal).normalize().angleTo(world))
          const old = normal.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(affine)).normalize()
          const error = old.angleTo(actual)
          oldError = Math.max(oldError, error)
          const population = rig.name.split('-')[0]
          failuresByPopulation.set(population, Math.max(failuresByPopulation.get(population) ?? 0, error))
          const noBind = shaders.main(new THREE.Matrix4().fromArray(record.weightedBoneMatrix), normal)
          omittedBindError = Math.max(omittedBindError, noBind.angleTo(actual))
        }
        vertices++
      }
      for (const record of rig.triangles) {
        const affine = new THREE.Matrix4().fromArray(record.affine)
        const normal = new THREE.Vector3().fromArray(record.normal)
        const points = record.deformed.map((p) => new THREE.Vector3().fromArray(p))
        const face = new THREE.Triangle(points[0], points[1], points[2]).getNormal(new THREE.Vector3())
        if (affine.determinant() < 0) face.negate()
        assert.ok(shaders.main(affine, normal).distanceTo(face) < 1e-5, `${rig.name}: deformed production triangle`)
        assert.ok(shaders.ink(affine, normal).distanceTo(face) < 1e-5)
        triangles++
      }
    }
  } finally { shaders.dispose() }
  assert.equal(vertices, 266)
  assert.equal(triangles, 188)
  assert.ok(oldError > 0.17, 'The former forward-normal transform must fail these actual poses')
  assert.ok(omittedBindError > 0.5, 'Skipping bind matrices must fail the same instrument')
  assert.ok(doubledModelError > 0.5, 'Applying model normalMatrix twice must be detectable')
  for (const kind of ['character', 'beast']) assert.ok(failuresByPopulation.get(kind)! > 0.01, `${kind} must contain a real affine case`)
  // The recorded wagon/ox update is a rigid control after its bind transforms
  // cancel; do not claim an anisotropic defect in a pose that does not have one.
  assert.ok(failuresByPopulation.has('wagon'))
  assert.ok(failuresByPopulation.get('wagon')! < 1e-6)
  console.log(`Actual rig normal probes: ${vertices} vertices/${triangles} triangles; old maximum ${(oldError * 180 / Math.PI).toFixed(4)} degrees`)
})

test('normal transport inverts the weighted affine map, never blends already inverted bone normals', () => {
  const shaders = evaluatedShaders()
  const rig = fixture.cases.find((r) => r.name === 'character-elf-0.7')!
  const hand = rig.vertices.find((v) => v.boneName === 'leftHand')!
  const forearm = rig.vertices.find((v) => v.boneName === 'leftArm-forearm')!
  assert.ok(hand && forearm)
  const maps = [hand, forearm].map((r) => new THREE.Matrix4().fromArray(r.weightedBoneMatrix))
  const geometry = new THREE.BufferGeometry()
  const points = [new THREE.Vector3(.1, .2, .3), new THREE.Vector3(.7, .1, .4), new THREE.Vector3(.2, .8, .9)]
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap((v) => v.toArray()), 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0], 4))
  const bones = maps.map((matrix) => {
    const bone = new THREE.Bone(); bone.matrixWorld.copy(matrix); return bone
  })
  const skeleton = new THREE.Skeleton(bones, [new THREE.Matrix4(), new THREE.Matrix4()])
  const source = new THREE.SkinnedMesh(geometry)
  source.skeleton = skeleton
  source.bindMatrix.fromArray(hand.bindMatrix)
  source.bindMatrixInverse.fromArray(hand.bindMatrixInverse)
  const rest = new THREE.Triangle(...points).getNormal(new THREE.Vector3())
  let incorrectBlend = 0
  try {
    for (const weight of [.2, .4, .7]) {
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(
        Array.from({ length: 3 }, () => [weight, 1 - weight, 0, 0]).flat(), 4))
      const blend = new THREE.Matrix4()
      blend.fromArray(maps[0].elements.map((v, i) => v * weight + maps[1].elements[i] * (1 - weight)))
      const affine = source.bindMatrixInverse.clone().multiply(blend).multiply(source.bindMatrix)
      const actual = shaders.main(affine, rest)
      const posed = [0, 1, 2].map((i) => source.getVertexPosition(i, new THREE.Vector3()))
      const expected = new THREE.Triangle(posed[0], posed[1], posed[2]).getNormal(new THREE.Vector3())
      assert.ok(actual.distanceTo(expected) < 2e-6)
      assert.ok(shaders.ink(affine, rest).distanceTo(expected) < 2e-6)
      const wrong = new THREE.Vector3()
      maps.forEach((map, i) => wrong.addScaledVector(rest.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(
        source.bindMatrixInverse.clone().multiply(map).multiply(source.bindMatrix),
      )), i === 0 ? weight : 1 - weight))
      incorrectBlend = Math.max(incorrectBlend, wrong.normalize().angleTo(actual))
    }
    assert.ok(incorrectBlend > 0.001, 'A weighted sum of inverse-transposes must fail the independent triangle oracle')
  } finally { geometry.dispose(); skeleton.dispose(); shaders.dispose() }
})

test('skin then wind then model normalMatrix agrees with deformed tangents and keeps main/ink in the same space', () => {
  const shaders = evaluatedShaders(true)
  const shear = new THREE.Vector3(.08, -.12, -.05)
  const wind = new THREE.Matrix4().set(1, shear.x, 0, 0, 0, 1 + shear.y, 0, 0, 0, shear.z, 1, 0, 0, 0, 0, 1)
  let wrongOrder = 0
  try {
    for (const rig of fixture.cases) for (const record of rig.vertices) {
      const affine = new THREE.Matrix4().fromArray(record.affine)
      const normal = new THREE.Vector3().fromArray(record.normal).normalize()
      const model = new THREE.Matrix4().fromArray(record.modelMatrix)
      const expected = tangentOracle(model.clone().multiply(wind).multiply(affine), normal)
      const modelNormal = new THREE.Matrix3().getNormalMatrix(model)
      for (const evaluate of [shaders.main, shaders.ink]) {
        const actual = evaluate(affine, normal, shear).applyMatrix3(modelNormal).normalize()
        assert.ok(actual.distanceTo(expected.expected) < 1e-9)
        assert.ok(Math.abs(actual.dot(expected.first)) < 1e-9)
        assert.ok(Math.abs(actual.dot(expected.second)) < 1e-9)
      }
      const wrong = normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(model.clone().multiply(affine).multiply(wind))).normalize()
      wrongOrder = Math.max(wrongOrder, wrong.angleTo(expected.expected))
    }
    assert.ok(wrongOrder > 0.01)
  } finally { shaders.dispose() }
})

test('singular and tiny bone scales retain finite normals with an explicit surviving-area or collapsed-area policy', () => {
  const shaders = evaluatedShaders(true)
  const rest = new THREE.Vector3(.3, .6, .8).normalize()
  try {
    for (const scale of [1, 1e-20, 1e20]) {
      for (const x of [1, -1, 1e-9, -1e-9]) {
        const affine = new THREE.Matrix4().makeScale(x * scale, 2 * scale, .7 * scale)
        const expected = rest.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(affine)).normalize()
        for (const evaluate of [shaders.main, shaders.ink]) {
          const actual = evaluate(affine, rest)
          assertUnit(actual)
          assert.ok(actual.distanceTo(expected) < 1e-8)
        }
      }
    }
    for (const evaluate of [shaders.main, shaders.ink]) {
      assert.ok(evaluate(new THREE.Matrix4().makeScale(1, 0, 2), rest).distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-10)
      assert.ok(evaluate(new THREE.Matrix4().makeScale(1, 0, 0), rest).distanceTo(rest) < 1e-10)
      assert.ok(evaluate(new THREE.Matrix4().makeScale(0, 0, 0), rest).distanceTo(rest) < 1e-10)
      assertUnit(evaluate(new THREE.Matrix4().makeScale(0, 0, 0), new THREE.Vector3()))
      assertUnit(evaluate(new THREE.Matrix4(), rest, new THREE.Vector3(0, -1, 0)))
    }
  } finally { shaders.dispose() }
})

test('finite bind data is checked without rejecting a finite collapsed-bone pose or changing skin positions', () => {
  const art = new StylizedArtLibrary({ ink, enhanced: true })
  const material = art.createMaterial({ color: 0xffffff, surface: 'skin' })
  const geometry = new THREE.BoxGeometry()
  const count = geometry.getAttribute('position').count
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4))
  const weights = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) weights[i * 4] = 1
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4))
  const source = new THREE.SkinnedMesh(geometry, material), bone = new THREE.Bone()
  source.add(bone)
  const skeleton = new THREE.Skeleton([bone])
  source.bind(skeleton)
  bone.scale.set(0, 1, 1)
  source.updateMatrixWorld(true)
  const before = source.getVertexPosition(0, new THREE.Vector3()).toArray()
  assert.doesNotThrow(() => validateArtGeometry(source))
  source.bindMatrix.elements[0] = NaN
  assert.throws(() => validateArtGeometry(source), /finite/)
  source.bindMatrix.identity()
  bone.matrixWorld.elements[5] = Infinity
  assert.throws(() => validateArtGeometry(source), /finite/)
  source.updateMatrixWorld(true)
  assert.deepEqual(source.getVertexPosition(0, new THREE.Vector3()).toArray(), before)
  geometry.dispose(); material.dispose(); skeleton.dispose(); art.dispose()
})

test('enhanced main/ink normal injection is localized; legacy, forward tangents and depth position skinning remain stock', () => {
  const enhanced = evaluatedShaders(true)
  const legacy = new StylizedArtLibrary({ ink })
  const material = legacy.createMaterial({ color: 0xffffff, surface: 'metal' })
  try {
    const main = enhanced.mainShader, outline = enhanced.inkShader
    const chunk = affineSkinNormalChunk(THREE.ShaderChunk.skinnormal_vertex)
    assert.match(chunk, /skinMatrix = bindMatrixInverse \* skinMatrix \* bindMatrix/)
    assert.match(chunk, /objectTangent = vec4\( skinMatrix \* vec4\( objectTangent, 0\.0 \) \)\.xyz/)
    assert.equal(chunk.replace('objectNormal = kArtAffineNormal( mat3( skinMatrix ), objectNormal );',
      'objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;'), THREE.ShaderChunk.skinnormal_vertex)
    assert.throws(() => affineSkinNormalChunk('missing-chunk'), /requires/)
    for (const source of [main, outline]) {
      assert.ok(source.indexOf('objectNormal = kArtAffineNormal') < source.indexOf('#include <defaultnormal_vertex>'))
      assert.match(source, /#include <skinning_vertex>\ntransformed \+= kArtWindShear\(\) \* transformed.y;/)
      assert.match(source, /objectTangent \+= kArtWindShear\(\) \* objectTangent.y/)
      assert.doesNotMatch(source, /skinMatrix \* vec4\( (objectNormal|kOutlineNormal),/)
    }
    assert.match(outline, /vec3 kOutlineViewNormal = normalMatrix \* kOutlineNormal;/)
    assert.doesNotMatch(enhanced.depthShader, /kArtAffineNormal|kArtUnitNormal/)
    assert.match(enhanced.depthShader, /#include <skinnormal_vertex>/)
    assert.match(enhanced.depthShader, /#include <skinning_vertex>\ntransformed \+= kArtWindShear\(\) \* transformed.y;/)
    const legacyMain = shader(material, 'standard'), legacyInk = shader(legacy.getOutlineMaterial('player', true), 'basic')
    assert.match(legacyMain, /#include <skinnormal_vertex>/)
    assert.match(legacyInk, /skinMatrix \* vec4\( kOutlineNormal, 0.0 \)/)
    assert.doesNotMatch(legacyMain + legacyInk, /kArtAffineNormal|kArtUnitNormal/)
    assert.equal(material.customProgramCacheKey(), 'korovany-stylized-v1')
    assert.equal(legacy.getOutlineMaterial('player', true).customProgramCacheKey(), 'korovany-outline-v1:smooth')
  } finally { enhanced.dispose(); material.dispose(); legacy.dispose() }
})
