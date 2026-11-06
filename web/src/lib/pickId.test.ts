import { describe, expect, it } from 'vitest'
import { decodeId, encodeId } from './pickId'

describe('pick id encoding', () => {
  it('round-trips ids', () => {
    for (const id of [0, 1, 255, 256, 65535, 65536, 123456, 0xffffff]) {
      expect(decodeId(...encodeId(id))).toBe(id)
    }
  })
  it('rejects out-of-range ids', () => {
    expect(() => encodeId(-1)).toThrow()
    expect(() => encodeId(0x1000000)).toThrow()
  })
})
