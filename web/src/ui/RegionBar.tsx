import { REGION_ORDER } from '../data/manifest'
import { REGION_VIEW } from '../lib/regions'
import { useStore } from '../store'

/** Region focus buttons over the 3D view: the camera flies to the region and only its structures stay visible. */
export function RegionBar() {
  const { lang, vis, focusRegion } = useStore()
  return (
    <div className="regionbar" role="toolbar" aria-label="部位 / Regions" data-testid="regionbar">
      {REGION_ORDER.map((r) => (
        <button key={r} data-testid={`region-btn-${r}`} className={vis.region === r ? 'active' : ''} onClick={() => focusRegion(vis.region === r ? null : r)}>
          {lang === 'zh' ? REGION_VIEW[r].label.zh : REGION_VIEW[r].label.en}
        </button>
      ))}
      <button data-testid="region-btn-all" className={vis.region === null ? 'active' : ''} onClick={() => focusRegion(null)}>
        {lang === 'zh' ? '全身' : 'Whole body'}
      </button>
    </div>
  )
}
