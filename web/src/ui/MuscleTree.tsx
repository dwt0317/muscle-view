import { useEffect, useMemo, useRef, useState } from 'react'
import { REGION_ORDER, type Layer, type MuscleInfo, type RegionId } from '../data/manifest'
import { pickName, ui } from '../lib/i18n'
import { filterMuscles } from '../lib/search'
import {
  hideAll, isolate, musclesOfLayer, regionTree, setMusclesOn, showAll, toggleMuscles, triState, type SideShow,
} from '../lib/visibility'
import { useStore } from '../store'

function TriBox({ state, onChange, label, testId }: { state: 'on' | 'off' | 'mixed'; onChange: () => void; label: string; testId?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'mixed'
  }, [state])
  return <input ref={ref} type="checkbox" checked={state === 'on'} onChange={onChange} aria-label={label} data-testid={testId} />
}

const LAYERS: Layer[] = ['superficial', 'intermediate', 'deep']

export function MuscleControls() {
  const { manifest, vis, setVis, lang, selected, showLabels, setShowLabels, attachMode, setAttachMode, reviewMode, setReviewMode } = useStore()
  if (!manifest) return null
  const selMuscle = selected ? manifest.muscles.find((m) => m.nodes.r === selected || m.nodes.l === selected) : undefined
  const sides: { id: SideShow; zh: string; en: string }[] = [
    { id: 'both', zh: '双侧', en: 'Both' },
    { id: 'r', zh: '右侧', en: 'Right' },
    { id: 'l', zh: '左侧', en: 'Left' },
  ]
  return (
    <section className="panel controls" data-testid="controls">
      <div className="row">
        <button data-testid="show-all" onClick={() => setVis(showAll(vis))}>{lang === 'zh' ? '全部显示' : 'Show all'}</button>
        <button data-testid="hide-all" onClick={() => setVis(hideAll(vis, manifest))}>{lang === 'zh' ? '全部隐藏' : 'Hide all'}</button>
        <button data-testid="isolate-selected" disabled={!selMuscle} onClick={() => selMuscle && setVis(isolate(vis, manifest, [selMuscle.id]))}>
          {lang === 'zh' ? '仅显示选中' : 'Isolate'}
        </button>
        <button data-testid="hide-selected" disabled={!selMuscle} onClick={() => selMuscle && setVis(setMusclesOn(vis, [selMuscle.id], false))}>
          {lang === 'zh' ? '隐藏选中' : 'Hide'}
        </button>
      </div>
      <div className="row layers">
        {LAYERS.map((l) => {
          const ids = musclesOfLayer(manifest, l)
          return (
            <label key={l} className="chk">
              <TriBox state={triState(vis, ids)} onChange={() => setVis(toggleMuscles(vis, ids))} label={ui(lang, l)} testId={`layer-${l}`} />
              {ui(lang, l)}
            </label>
          )
        })}
      </div>
      <div className="row">
        <label className="chk">
          <input type="checkbox" data-testid="toggle-bones" checked={vis.bones} onChange={() => setVis({ ...vis, bones: !vis.bones })} />
          {ui(lang, 'bone')}
        </label>
        <label className="chk">
          <input
            type="checkbox"
            data-testid="toggle-context-bones"
            checked={vis.contextBones}
            disabled={!vis.bones}
            onChange={() => setVis({ ...vis, contextBones: !vis.contextBones })}
          />
          {lang === 'zh' ? '头/手/足骨' : 'Skull/hand/foot'}
        </label>
        <label className="chk">
          <input type="checkbox" data-testid="toggle-labels" checked={showLabels} onChange={() => setShowLabels(!showLabels)} />
          {lang === 'zh' ? '名称标签' : 'Labels'}
        </label>
      </div>
      <div className="row">
        <label className="chk">
          <input type="checkbox" data-testid="toggle-attach" checked={attachMode} onChange={() => setAttachMode(!attachMode)} />
          {lang === 'zh' ? '附着模式' : 'Attachment view'}
        </label>
        <label className="chk">
          <input type="checkbox" data-testid="toggle-review" checked={reviewMode} onChange={() => setReviewMode(!reviewMode)} />
          {lang === 'zh' ? '校对模式' : 'Review mode'}
        </label>
      </div>
      <div className="row">
        <div className="seg" role="group" aria-label="Side">
          {sides.map((s) => (
            <button key={s.id} data-testid={`side-${s.id}`} className={vis.side === s.id ? 'active' : ''} onClick={() => setVis({ ...vis, side: s.id })}>
              {lang === 'zh' ? s.zh : s.en}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

export function MuscleTree() {
  const { manifest, vis, setVis, lang, selected, select, focusNodes } = useStore()
  const [query, setQuery] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const searching = query.trim() !== ''

  const tree = useMemo(() => {
    if (!manifest) return []
    return REGION_ORDER.map((r) => ({
      region: r,
      groups: regionTree(manifest, r)
        .map((g) => ({ ...g, muscles: filterMuscles(g.muscles, query, manifest.groups) }))
        .filter((g) => g.muscles.length > 0),
    })).filter((r) => r.groups.length > 0)
  }, [manifest, query])

  if (!manifest) return null
  const toggleOpen = (k: string) => setClosed((c) => { const n = new Set(c); n.has(k) ? n.delete(k) : n.add(k); return n })
  const selectedId = selected ? manifest.muscles.find((m) => m.nodes.r === selected || m.nodes.l === selected)?.id : undefined

  const pick = (m: MuscleInfo) => {
    const node = m.nodes[vis.side === 'l' ? 'l' : 'r']
    setVis(setMusclesOn(vis, [m.id], true))
    select(node)
    focusNodes([m.nodes.r, m.nodes.l].filter((n) => vis.side === 'both' || n === node))
  }

  return (
    <section className="tree" data-testid="muscle-tree">
      <input
        className="search"
        type="search"
        data-testid="search"
        placeholder={lang === 'zh' ? '搜索肌肉（中文 / English / Latin）' : 'Search muscles (中文 / English / Latin)'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {tree.length === 0 && <div className="none">{lang === 'zh' ? '没有匹配的肌肉' : 'No matching muscles'}</div>}
      {tree.map(({ region, groups }) => {
        const all = groups.flatMap((g) => g.muscles.map((m) => m.id))
        const rKey = `r:${region}`
        return (
          <div key={region} className="region" data-testid={`region-${region}`}>
            <div className="head">
              <button className="fold" onClick={() => toggleOpen(rKey)} aria-label="fold">{closed.has(rKey) && !searching ? '▸' : '▾'}</button>
              <TriBox state={triState(vis, all)} onChange={() => setVis(toggleMuscles(vis, all))} label={pickName(manifest.regions[region as RegionId], lang)} testId={`chk-region-${region}`} />
              <b>{pickName(manifest.regions[region as RegionId], lang)}</b>
              <span className="count">{all.length}</span>
              <button className="solo" title={lang === 'zh' ? '仅显示此部位' : 'Show only this region'} onClick={() => setVis(isolate(vis, manifest, all))}>
                {lang === 'zh' ? '仅' : 'only'}
              </button>
            </div>
            {(!closed.has(rKey) || searching) &&
              groups.map((g) => {
                const ids = g.muscles.map((m) => m.id)
                const gKey = `g:${region}:${g.group}`
                const gName = manifest.groups[g.group]
                return (
                  <div key={g.group} className="group" data-testid={`group-${g.group}`}>
                    <div className="head">
                      <button className="fold" onClick={() => toggleOpen(gKey)} aria-label="fold">{closed.has(gKey) && !searching ? '▸' : '▾'}</button>
                      <TriBox state={triState(vis, ids)} onChange={() => setVis(toggleMuscles(vis, ids))} label={lang === 'zh' ? gName.zh : gName.en} testId={`chk-group-${g.group}`} />
                      <span>{lang === 'zh' ? gName.zh : gName.en}</span>
                      <button className="solo" onClick={() => setVis(isolate(vis, manifest, ids))}>{lang === 'zh' ? '仅' : 'only'}</button>
                    </div>
                    {(!closed.has(gKey) || searching) &&
                      g.muscles.map((m) => (
                        <div key={m.id} className={`muscle${selectedId === m.id ? ' selected' : ''}`} data-testid={`row-${m.id}`}>
                          <TriBox state={vis.muscleOff.has(m.id) ? 'off' : 'on'} onChange={() => setVis(toggleMuscles(vis, [m.id]))} label={pickName(m.name, lang)} testId={`chk-${m.id}`} />
                          <button className="name" onClick={() => pick(m)}>{pickName(m.name, lang)}</button>
                          <button className="solo" onClick={() => setVis(isolate(vis, manifest, [m.id]))}>{lang === 'zh' ? '仅' : 'only'}</button>
                        </div>
                      ))}
                  </div>
                )
              })}
          </div>
        )
      })}
    </section>
  )
}
