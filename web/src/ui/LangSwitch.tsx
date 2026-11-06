import { LANGS } from '../lib/i18n'
import { useStore } from '../store'

export function LangSwitch() {
  const lang = useStore((s) => s.lang)
  const setLang = useStore((s) => s.setLang)
  return (
    <div className="seg" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button key={l.id} data-testid={`lang-${l.id}`} className={lang === l.id ? 'active' : ''} onClick={() => setLang(l.id)}>
          {l.label}
        </button>
      ))}
    </div>
  )
}
