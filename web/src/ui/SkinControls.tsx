import { useStore } from '../store'

export function SkinControls() {
  const { lang, skinOpacity, setSkinOpacity, showLandmarks, setShowLandmarks } = useStore()
  const pct = Math.round(skinOpacity * 100)
  return (
    <section className="panel skin" data-testid="skin-controls">
      <label className="slider">
        <span>{lang === 'zh' ? '皮肤' : 'Skin'}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          data-testid="skin-slider"
          onChange={(e) => setSkinOpacity(Number(e.target.value) / 100)}
        />
        <output data-testid="skin-value">{pct}%</output>
      </label>
      <label className="chk">
        <input type="checkbox" data-testid="toggle-landmarks" checked={showLandmarks} onChange={() => setShowLandmarks(!showLandmarks)} />
        {lang === 'zh' ? '体表骨性标志（触诊）' : 'Surface bony landmarks (palpation)'}
      </label>
    </section>
  )
}
