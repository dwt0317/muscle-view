import { useEffect } from 'react'
import { loadManifest } from './data/manifest'
import { Viewer } from './scene/Viewer'
import { useStore } from './store'
import { InfoPanel } from './ui/InfoPanel'
import { LangSwitch } from './ui/LangSwitch'
import { MotionPanel } from './ui/MotionPanel'
import { MuscleControls, MuscleTree } from './ui/MuscleTree'
import { RegionBar } from './ui/RegionBar'
import { ReviewPanel } from './ui/ReviewPanel'
import { SkinControls } from './ui/SkinControls'
import { ScreenLabels } from './ui/ScreenLabels'
import { ViewToolbar } from './ui/Toolbar'
import { ui } from './lib/i18n'

export default function App() {
  const { status, error, manifest, setManifest, setStatus, lang } = useStore()

  useEffect(() => {
    loadManifest()
      .then(setManifest)
      .catch((e: Error) => setStatus('error', e.message))
  }, [setManifest, setStatus])

  return (
    <div className="app">
      <header className="topbar">
        <h1>{ui(lang, 'title')}</h1>
        <span className="sub">{lang === 'zh' ? '肩 · 髋 · 膝 · 腰' : 'Shoulder · Hip · Knee · Lumbar'}</span>
        <div className="right">
          <LangSwitch />
          <span data-testid="status" className={`status ${status}`}>
            {status === 'loading' ? ui(lang, 'loading') : status === 'ready' ? ui(lang, 'ready') : `Error: ${error}`}
          </span>
        </div>
      </header>
      <aside className="sidebar">
        <ReviewPanel />
        <InfoPanel />
        <MotionPanel />
        <MuscleControls />
        <SkinControls />
        <MuscleTree />
      </aside>
      <main className="stage">
        <Viewer />
        <ScreenLabels />
        <RegionBar />
        <ViewToolbar />
        {status === 'loading' && <div className="overlay">正在加载模型…</div>}
        {status === 'error' && <div className="overlay error">加载失败：{error}</div>}
      </main>
      <footer className="footer">
        {manifest?.attribution.map((a) => <span key={a}>{a}</span>)}
        {manifest && <span className="note">{lang === 'zh' ? manifest.clinicalNote.zh : manifest.clinicalNote.en}</span>}
      </footer>
    </div>
  )
}
