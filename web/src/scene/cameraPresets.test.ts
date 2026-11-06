import { describe, expect, it } from 'vitest'
import { BODY_CENTER, DEFAULT_DISTANCE, presetPose } from './cameraPresets'

describe('presetPose', () => {
  it('front camera sits on the anterior (+Z) side, looking at the body centre', () => {
    const p = presetPose('front')
    expect(p.target).toEqual(BODY_CENTER)
    expect(p.position).toEqual([0, BODY_CENTER[1], DEFAULT_DISTANCE])
  })

  it('back is opposite to front', () => {
    expect(presetPose('back').position[2]).toBe(-DEFAULT_DISTANCE)
  })

  it("the patient's right side is -X, left is +X", () => {
    expect(presetPose('right').position[0]).toBeLessThan(0)
    expect(presetPose('left').position[0]).toBeGreaterThan(0)
  })

  it('honours a custom target and distance', () => {
    const p = presetPose('left', [0.1, 0.5, 0.2], 1)
    expect(p.position).toEqual([1.1, 0.5, 0.2])
    expect(p.target).toEqual([0.1, 0.5, 0.2])
  })
})
