import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store'

describe('store', () => {
  beforeEach(() => useStore.setState({ selected: null, hovered: null, lang: 'zh', viewRequest: null }))

  it('selects and clears a node', () => {
    useStore.getState().select('m_supraspinatus_r')
    expect(useStore.getState().selected).toBe('m_supraspinatus_r')
    useStore.getState().select(null)
    expect(useStore.getState().selected).toBeNull()
  })

  it('switches language', () => {
    useStore.getState().setLang('la')
    expect(useStore.getState().lang).toBe('la')
  })

  it('view requests carry an increasing nonce so repeating a view re-triggers it', () => {
    useStore.getState().requestView('front')
    const a = useStore.getState().viewRequest!.nonce
    useStore.getState().requestView('front')
    expect(useStore.getState().viewRequest!.nonce).toBe(a + 1)
  })

  it('clamps the skin opacity to 0..1 and ignores NaN', () => {
    const { setSkinOpacity } = useStore.getState()
    setSkinOpacity(0.4)
    expect(useStore.getState().skinOpacity).toBe(0.4)
    setSkinOpacity(7)
    expect(useStore.getState().skinOpacity).toBe(1)
    setSkinOpacity(-3)
    expect(useStore.getState().skinOpacity).toBe(0)
    setSkinOpacity(Number.NaN)
    expect(useStore.getState().skinOpacity).toBe(0)
  })
})
