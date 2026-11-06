import { REGION_ORDER } from '../data/manifest'
import { otherNames, pickName, pickText, sideLabel, ui } from '../lib/i18n'
import { buildNodeIndex } from '../lib/nodes'
import { useStore } from '../store'
import { useMemo } from 'react'
import { setMusclesOn } from '../lib/visibility'

export function InfoPanel() {
  const { manifest, selected, lang, select, vis, setVis, focusNodes, attachMode, setAttachMode } = useStore()
  const index = useMemo(() => (manifest ? buildNodeIndex(manifest) : null), [manifest])
  const ref = selected && index ? index.get(selected) : undefined

  if (!manifest || !ref) {
    return (
      <section className="panel info empty" data-testid="info-empty">
        {ui(lang, 'nothingSelected')}
      </section>
    )
  }
  const info = (ref.muscle ?? ref.bone ?? ref.landmark)!
  const regions = REGION_ORDER.filter((r) => info.regions.includes(r)).map((r) => pickName(manifest.regions[r], lang))
  const m = ref.muscle
  const lm = ref.landmark
  const item = ref.item
  const related = lm && item ? item.muscles.map((id) => manifest.muscles.find((x) => x.id === id)!).filter(Boolean) : []
  const att = m && ref.side ? manifest.attachments?.[m.id]?.[ref.side] : undefined
  const boneName = (id: string) => {
    const b = manifest.bones.find((x) => x.id === id)
    return b ? pickName(b.name, lang) : id
  }
  const goMuscle = (id: string) => {
    const mu = manifest.muscles.find((x) => x.id === id)
    if (!mu) return
    const node = mu.nodes[ref.side === 'l' ? 'l' : 'r']
    setVis(setMusclesOn(vis, [id], true))
    select(node)
    focusNodes([node])
  }

  return (
    <section className="panel info" data-testid="info-panel">
      <button className="close" onClick={() => select(null)} aria-label={ui(lang, 'close')}>
        ×
      </button>
      <h2 data-testid="info-name">{pickName(info.name, lang)}</h2>
      <div className="names" data-testid="info-names">
        {otherNames(info.name, lang).map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
      <dl>
        <dt>{ui(lang, 'side')}</dt>
        <dd data-testid="info-side">{sideLabel(ref.side, lang)}</dd>
        <dt>{ui(lang, 'region')}</dt>
        <dd>{regions.join(' · ')}</dd>
        {m && (
          <>
            <dt>{ui(lang, 'group')}</dt>
            <dd>{pickName({ ...manifest.groups[m.group], la: '' }, lang)}</dd>
            <dt>{ui(lang, 'layer')}</dt>
            <dd>{ui(lang, m.layer)}</dd>
            <dt>{ui(lang, 'origin')}</dt>
            <dd data-testid="info-origin">{pickText(m.origin, lang)}</dd>
            <dt>{ui(lang, 'insertion')}</dt>
            <dd data-testid="info-insertion">{pickText(m.insertion, lang)}</dd>
            <dt>{ui(lang, 'function')}</dt>
            <dd>{pickText(m.function, lang)}</dd>
            {m.fma[ref.side ?? 'r'] && (
              <>
                <dt>{ui(lang, 'fma')}</dt>
                <dd>{m.fma[ref.side ?? 'r']}</dd>
              </>
            )}
          </>
        )}
      </dl>
      {m && att && (
        <div className="att" data-testid="attachments">
          <h3>{lang === 'zh' ? '骨骼上的附着区' : 'Attachment areas on bone'}</h3>
          {(['origin', 'insertion'] as const).map((role) =>
            att[role].length === 0 ? (
              <div key={role} className="att-row none" data-testid={`att-${role}`}>
                <i className={`dot ${role}`} />
                {ui(lang, role)}: {lang === 'zh' ? '未能确定' : 'not determined'}
              </div>
            ) : (
              att[role].map((p, i) => (
                <div key={`${role}${i}`} className="att-row" data-testid={`att-${role}`}>
                  <i className={`dot ${role}`} />
                  {ui(lang, role)}: {boneName(p.bone)} · {p.areaCm2.toFixed(1)} cm²
                  <span className="src">{p.source === 'za' ? (lang === 'zh' ? '手绘' : 'hand-drawn') : p.source === 'point' ? (lang === 'zh' ? '点标记' : 'point') : p.source === 'algorithm' ? (lang === 'zh' ? '算法' : 'auto') : p.source}</span>
                </div>
              ))
            ),
          )}
          <button data-testid="toggle-attach-info" className={attachMode ? 'active' : ''} onClick={() => setAttachMode(!attachMode)}>
            {attachMode ? (lang === 'zh' ? '退出附着模式' : 'Exit attachment view') : lang === 'zh' ? '在骨骼上显示起止点' : 'Show on bones'}
          </button>
        </div>
      )}
      {lm && item && (
        <div className="lm-extra" data-testid="landmark-info">
          <h3>{lang === 'zh' ? '触诊提示' : 'Palpation'}</h3>
          <p data-testid="landmark-palpation">{pickText(lm.palpation, lang)}</p>
          <h3>{lang === 'zh' ? '附着 / 邻近肌肉' : 'Attaching / adjacent muscles'}</h3>
          <div className="chips" data-testid="landmark-muscles">
            {related.map((mu) => (
              <button key={mu.id} className="chip" data-testid={`lm-muscle-${mu.id}`} onClick={() => goMuscle(mu.id)}>
                {pickName(mu.name, lang)}
              </button>
            ))}
            {related.length === 0 && <span className="muted">{lang === 'zh' ? '无' : 'none'}</span>}
          </div>
        </div>
      )}
      {(m || lm) && <p className="pending">{ui(lang, 'pendingReview')}</p>}
    </section>
  )
}
