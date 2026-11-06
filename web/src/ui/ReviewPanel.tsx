import { useEffect, useState } from 'react'
import { pickName } from '../lib/i18n'
import { clearVerdict, exportReview, nextPending, progress, setVerdict } from '../lib/review'
import { useStore } from '../store'

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Step through the muscles one by one, mark the attachment areas OK / problematic and export review.json. */
export function ReviewPanel() {
  const { manifest, reviewMode, reviewIdx, reviewGo, review, setReview, lang, setReviewMode } = useStore()
  const [note, setNote] = useState('')
  const mu = manifest?.muscles[reviewIdx]
  useEffect(() => setNote(mu ? review[mu.id]?.note ?? '' : ''), [mu?.id, review]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!manifest || !reviewMode || !mu) return null
  const ids = manifest.muscles.map((m) => m.id)
  const pg = progress(review, ids)
  const cur = review[mu.id]
  const zh = lang === 'zh'
  const att = manifest.attachments?.[mu.id]?.r

  const mark = (v: 'ok' | 'issue') => {
    setReview(setVerdict(review, mu.id, v, note))
    const n = nextPending({ ...review, [mu.id]: { verdict: v, note, at: '' } }, ids, reviewIdx)
    if (n >= 0) reviewGo(n)
  }

  return (
    <section className="panel review" data-testid="review-panel">
      <div className="review-head">
        <b>{zh ? '起止点校对' : 'Attachment review'}</b>
        <span data-testid="review-progress">
          {pg.ok + pg.issue}/{pg.total} · ✓{pg.ok} · ✗{pg.issue}
        </span>
        <button className="close" onClick={() => setReviewMode(false)} aria-label="close">×</button>
      </div>
      <div className="review-nav">
        <button data-testid="review-prev" onClick={() => reviewGo(reviewIdx - 1)}>‹</button>
        <span data-testid="review-current">
          {reviewIdx + 1}/{ids.length} {pickName(mu.name, lang)}
        </span>
        <button data-testid="review-next" onClick={() => reviewGo(reviewIdx + 1)}>›</button>
      </div>
      <div className="review-state" data-testid="review-state">
        {cur ? (cur.verdict === 'ok' ? (zh ? '已通过' : 'Approved') : zh ? '有问题' : 'Flagged') : zh ? '待校对' : 'Pending'}
        {att && att.notes.length > 0 && <span className="muted"> · {att.notes.join('; ')}</span>}
      </div>
      <textarea
        data-testid="review-note"
        placeholder={zh ? '备注（例如：起点范围过大 / 缺少 xx 处止点）' : 'Note (e.g. origin too wide / insertion missing)'}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
      />
      <div className="row">
        <button data-testid="review-ok" className="ok" onClick={() => mark('ok')}>✓ {zh ? '通过' : 'OK'}</button>
        <button data-testid="review-issue" className="bad" onClick={() => mark('issue')}>✗ {zh ? '有问题' : 'Problem'}</button>
        <button data-testid="review-clear" onClick={() => setReview(clearVerdict(review, mu.id))}>{zh ? '清除' : 'Clear'}</button>
      </div>
      <div className="row">
        <button
          data-testid="review-export"
          onClick={() => download('review.json', JSON.stringify(exportReview(review, manifest), null, 2))}
        >
          {zh ? '导出 review.json' : 'Export review.json'}
        </button>
      </div>
    </section>
  )
}
