import { useEffect, useMemo, useRef } from 'react'
import { REGION_ORDER, type MotionInfo, type RoleName } from '../data/manifest'
import { pickName, ui } from '../lib/i18n'
import { direction, pingPong, roleLists, resolveEntry } from '../lib/motions'
import { classify, LEGEND, strainColor } from '../lib/strain'
import { setMusclesOn } from '../lib/visibility'
import { useStore } from '../store'

const PLAY_PERIOD_S = 5 // one back-and-forth sweep

const ROLE_LABEL: Record<RoleName, { zh: string; en: string }> = {
  agonist: { zh: '主动肌', en: 'Agonists' },
  stabilizer: { zh: '稳定肌', en: 'Stabilisers' },
  antagonist: { zh: '拮抗肌', en: 'Antagonists' },
}
const STRAIN_LABEL = {
  shortened: { zh: '缩短（收缩）', en: 'Shortened' },
  neutral: { zh: '变化小', en: 'Little change' },
  lengthened: { zh: '拉长（舒张）', en: 'Lengthened' },
}

/** Drives `motionValue` while playing: sweeps back and forth through the motion's play range. */
function usePlayback() {
  const playing = useStore((s) => s.playing)
  const motionId = useStore((s) => s.motionId)
  const raf = useRef(0)
  useEffect(() => {
    if (!playing || !motionId) return
    const m = useStore.getState().manifest?.motions.find((x) => x.id === motionId)
    if (!m) return
    const [a, b] = m.play ?? [m.param.min, m.param.max]
    // start the sweep from the current value so the body does not jump
    const cur = useStore.getState().motionValue
    const startPhase = Math.min(1, Math.max(0, (cur - a) / (b - a))) * (PLAY_PERIOD_S / 2)
    const t0 = performance.now()
    const tick = (now: number) => {
      useStore.getState().setMotionValue(pingPong(a, b, startPhase + (now - t0) / 1000, PLAY_PERIOD_S))
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, motionId])
}

export function MotionPanel() {
  const { manifest, lang, motionId, motionValue, playing, selectMotion, setMotionValue, setPlaying, setPose, ratios, vis, setVis, select, focusNodes } = useStore()
  usePlayback()
  const zh = lang === 'zh'
  const motion = manifest?.motions.find((m) => m.id === motionId)
  const lists = useMemo(() => (motion ? roleLists(motion, motionValue) : null), [motion, motionValue < 0])
  if (!manifest) return null
  const dir = motion ? direction(motion, motionValue) : null

  const byRegion = REGION_ORDER.map((r) => ({ r, items: manifest.motions.filter((m) => m.region === r) })).filter((g) => g.items.length)
  const muscleName = (id: string) => {
    const m = manifest.muscles.find((x) => x.id === id)
    return m ? pickName(m.name, lang) : id
  }
  const goMuscle = (entry: string) => {
    if (!motion) return
    const { id, sides } = resolveEntry(entry, motion.limb, dir?.ipsi)
    const mu = manifest.muscles.find((x) => x.id === id)
    if (!mu) return
    const node = mu.nodes[sides[0]]
    setVis(setMusclesOn(vis, [id], true))
    select(node)
    focusNodes([node])
  }

  return (
    <section className="panel motion" data-testid="motion-panel">
      <h3>{zh ? '动作演示' : 'Motion demo'}</h3>
      <select
        data-testid="motion-select"
        value={motionId ?? ''}
        onChange={(e) => selectMotion(e.target.value || null)}
        aria-label={zh ? '选择动作' : 'Choose a motion'}
      >
        <option value="">{zh ? '— 选择动作 —' : '— choose a motion —'}</option>
        {byRegion.map(({ r, items }) => (
          <optgroup key={r} label={pickName(manifest.regions[r], lang)}>
            {items.map((m) => (
              <option key={m.id} value={m.id}>
                {zh ? m.name.zh : m.name.en}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {motion && dir && lists && (
        <>
          <label className="slider">
            <span>{zh ? motion.param.zh : motion.param.en}</span>
            <input
              type="range"
              min={motion.param.min}
              max={motion.param.max}
              step={1}
              value={Math.round(motionValue)}
              data-testid="motion-slider"
              onChange={(e) => {
                setPlaying(false)
                setMotionValue(Number(e.target.value))
              }}
            />
            <output data-testid="motion-value">{Math.round(motionValue)}°</output>
          </label>
          <div className="motion-dir" data-testid="motion-direction">
            {zh ? dir.label.zh : dir.label.en}
          </div>
          <div className="row">
            <button data-testid="motion-play" className={playing ? 'active' : ''} onClick={() => setPlaying(!playing)}>
              {playing ? (zh ? '❚❚ 暂停' : '❚❚ Pause') : zh ? '▶ 播放' : '▶ Play'}
            </button>
            <button data-testid="motion-reset" onClick={() => selectMotion(null)}>
              {zh ? '结束演示' : 'Stop'}
            </button>
          </div>
          <p className="motion-note">{zh ? motion.note.zh : motion.note.en}</p>

          <div className="legend" data-testid="motion-legend">
            {LEGEND.map((l) => (
              <span key={l.key}>
                <i style={{ background: l.color }} />
                {zh ? STRAIN_LABEL[l.key].zh : STRAIN_LABEL[l.key].en}
              </span>
            ))}
          </div>

          {(['agonist', 'stabilizer', 'antagonist'] as RoleName[]).map((role) =>
            lists[role].length === 0 ? null : (
              <div key={role} className="roles" data-testid={`roles-${role}`}>
                <h4>{zh ? ROLE_LABEL[role].zh : ROLE_LABEL[role].en}</h4>
                <div className="chips">
                  {lists[role].map((e) => {
                    const entry = e.tag ? `${e.id}@${e.tag}` : e.id
                    const side = resolveEntry(entry, motion.limb, dir.ipsi).sides[0]
                    const ratio = ratios.get(`${e.id}:${side}`)
                    const cls = ratio === undefined ? 'neutral' : classify(ratio)
                    return (
                      <button
                        key={entry}
                        className={`chip role-${role}`}
                        data-testid={`role-${role}-${e.id}${e.tag ? '-' + e.tag : ''}`}
                        title={ratio === undefined ? undefined : `${Math.round(ratio * 100)} %`}
                        style={ratio === undefined ? undefined : { borderColor: strainColor(ratio) }}
                        onClick={() => goMuscle(entry)}
                      >
                        <i className={`strain ${cls}`} />
                        {muscleName(e.id)}
                        {e.tag && <small>{e.tag === 'ipsi' ? (zh ? ' 同侧' : ' ipsi') : zh ? ' 对侧' : ' contra'}</small>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ),
          )}
          <p className="pending">{ui(lang, 'pendingReview')} · {zh ? '示意级：颜色按起止点连线长度变化估算' : 'Schematic: colour = change of origin-insertion path length'}</p>
        </>
      )}
      {!motion && (
        <button data-testid="pose-reset" onClick={() => setPose({})}>
          {zh ? '回到中立位' : 'Neutral pose'}
        </button>
      )}
    </section>
  )
}

export type { MotionInfo }
