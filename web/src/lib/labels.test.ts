import { describe, expect, it } from 'vitest'
import { nodeLabel, sideSuffix, textWidth } from './labels'
import type { NodeRef } from './nodes'

const ref = {
  node: 'm_supraspinatus_r', kind: 'muscle', id: 'supraspinatus', side: 'r',
  muscle: { name: { zh: '冈上肌', en: 'Supraspinatus', la: 'M. supraspinatus' } },
} as unknown as NodeRef

describe('labels', () => {
  it('includes the side in the chosen language', () => {
    expect(nodeLabel(ref, 'zh')).toBe('冈上肌（右）')
    expect(nodeLabel(ref, 'en')).toBe('Supraspinatus (R)')
    expect(nodeLabel(ref, 'la')).toBe('M. supraspinatus (R)')
    expect(sideSuffix(null, 'zh')).toBe('')
  })
  it('estimates wider boxes for CJK text', () => {
    expect(textWidth('冈上肌')).toBeGreaterThan(textWidth('abc'))
  })
})
