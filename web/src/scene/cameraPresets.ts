export type ViewPreset = 'front' | 'back' | 'left' | 'right'

export type Vec3 = [number, number, number]

// World: +Y up, +Z anterior, patient's right is -X.
// "front" looks at the patient's anterior side from +Z, "right" looks at the patient's right (-X) side.
export const BODY_CENTER: Vec3 = [0, 0.95, 0]
export const DEFAULT_DISTANCE = 3.4

const DIRS: Record<ViewPreset, Vec3> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
}

export interface CameraPose {
  position: Vec3
  target: Vec3
}

export function presetPose(
  preset: ViewPreset,
  target: Vec3 = BODY_CENTER,
  distance: number = DEFAULT_DISTANCE,
): CameraPose {
  const d = DIRS[preset]
  return {
    target,
    position: [target[0] + d[0] * distance, target[1] + d[1] * distance, target[2] + d[2] * distance],
  }
}

export const VIEW_LABELS: Record<ViewPreset, { zh: string; en: string }> = {
  front: { zh: '前', en: 'Front' },
  back: { zh: '后', en: 'Back' },
  left: { zh: '左', en: 'Left' },
  right: { zh: '右', en: 'Right' },
}
