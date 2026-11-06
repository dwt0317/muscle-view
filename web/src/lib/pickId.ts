/** 24-bit id <-> RGB, used by the GPU colour-id picking pass. 0 means "nothing". */
export function encodeId(id: number): [number, number, number] {
  if (id < 0 || id > 0xffffff) throw new RangeError(`pick id out of range: ${id}`)
  return [id & 255, (id >> 8) & 255, (id >> 16) & 255]
}

export function decodeId(r: number, g: number, b: number): number {
  return r | (g << 8) | (b << 16)
}
