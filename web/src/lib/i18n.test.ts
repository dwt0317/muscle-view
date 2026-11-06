import { describe, expect, it } from 'vitest'
import { otherNames, pickName, pickText, sideLabel, ui } from './i18n'

const name = { zh: '冈上肌', en: 'Supraspinatus', la: 'M. supraspinatus' }

describe('i18n', () => {
  it('picks the name for each language', () => {
    expect(pickName(name, 'zh')).toBe('冈上肌')
    expect(pickName(name, 'en')).toBe('Supraspinatus')
    expect(pickName(name, 'la')).toBe('M. supraspinatus')
  })
  it('falls back to English for a missing translation', () => {
    expect(pickName({ ...name, la: '' }, 'la')).toBe('Supraspinatus')
  })
  it('lists the other two names in zh/en/la order', () => {
    expect(otherNames(name, 'zh')).toEqual(['Supraspinatus', 'M. supraspinatus'])
    expect(otherNames(name, 'la')).toEqual(['冈上肌', 'Supraspinatus'])
  })
  it('free text in Latin mode shows English', () => {
    const t = { zh: '肩胛骨冈上窝', en: 'Supraspinous fossa' }
    expect(pickText(t, 'zh')).toBe('肩胛骨冈上窝')
    expect(pickText(t, 'la')).toBe('Supraspinous fossa')
  })
  it('translates UI strings and side labels', () => {
    expect(ui('zh', 'origin')).toBe('起点')
    expect(ui('en', 'origin')).toBe('Origin')
    expect(sideLabel('r', 'zh')).toBe('右侧')
    expect(sideLabel(null, 'en')).toBe('Midline')
  })
})
