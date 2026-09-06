import * as THREE from 'three'
import { StylizedArtLibrary } from '../art/StylizedArtLibrary.ts'

/** CPU ray evidence, not a claim about final pixels or visibility through walls. */
export function graphicsSceneEvidence(scene: THREE.Scene, camera: THREE.Camera,
  subjects: readonly { id: string; position: THREE.Vector3 }[]) {
  const instances: THREE.InstancedMesh[] = []
  let meshes = 0
  let inkShells = 0
  let shadowCasters = 0
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    meshes++
    if (StylizedArtLibrary.isOutlineShell(object)) { inkShells++; return }
    if (object.castShadow) shadowCasters++
    if (object instanceof THREE.InstancedMesh && object.name.startsWith('dressing-')) instances.push(object)
  })
  const raycaster = new THREE.Raycaster()
  const direction = new THREE.Vector3()
  return {
    meshes, inkShells, shadowCasters,
    dressingMeshes: instances.length,
    dressingInstances: instances.reduce((sum, object) => sum + object.count, 0),
    subjectRays: subjects.map((subject) => {
      direction.copy(subject.position).add(new THREE.Vector3(0, 1.65, 0)).sub(camera.position)
      raycaster.set(camera.position, direction.clone().normalize())
      raycaster.far = direction.length()
      const hit = raycaster.intersectObjects(instances, false)[0]
      return {
        subject: subject.id,
        firstDressingHit: hit ? {
          mesh: hit.object.name, instanceId: hit.instanceId, distance: hit.distance,
          point: hit.point.toArray(),
        } : null,
      }
    }),
  }
}
