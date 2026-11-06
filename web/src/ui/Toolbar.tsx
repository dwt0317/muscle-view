import { useStore } from '../store'
import { VIEW_LABELS, type ViewPreset } from '../scene/cameraPresets'

const VIEWS: ViewPreset[] = ['front', 'back', 'left', 'right']

export function ViewToolbar() {
  const requestView = useStore((s) => s.requestView)
  return (
    <div className="toolbar" role="toolbar" aria-label="视角 / View">
      {VIEWS.map((v) => (
        <button key={v} data-testid={`view-${v}`} onClick={() => requestView(v)} title={VIEW_LABELS[v].en}>
          {VIEW_LABELS[v].zh}
        </button>
      ))}
      <button data-testid="view-reset" onClick={() => requestView('reset')} title="Reset view">
        重置
      </button>
    </div>
  )
}
