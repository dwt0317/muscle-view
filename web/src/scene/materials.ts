import * as THREE from 'three'

export interface Materials {
  muscle: THREE.MeshStandardMaterial
  bone: THREE.MeshStandardMaterial
  skin: THREE.MeshStandardMaterial
}

export function createMaterials(): Materials {
  return {
    muscle: new THREE.MeshStandardMaterial({ color: '#b8453f', roughness: 0.62, metalness: 0 }),
    bone: new THREE.MeshStandardMaterial({ color: '#e9e2cf', roughness: 0.8, metalness: 0 }),
    skin: new THREE.MeshStandardMaterial({
      color: '#e2b9a2', roughness: 0.9, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false,
    }),
  }
}
