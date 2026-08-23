interface Props {
  onExportMix: () => void
  onExportVocals: () => void
  progress: number
  isRendering: boolean
  disabled?: boolean
}

export function ExportDialog({ onExportMix, onExportVocals, progress, isRendering, disabled }: Props) {
  return (
    <div className="panel">
      <div className="section-title">
        <h3>Export</h3>
        <span className="tag">WAV 44.1k</span>
      </div>
      <div className="controls">
        <button onClick={onExportMix} disabled={disabled || isRendering}>
          Mix (Beat + Vocals)
        </button>
        <button className="secondary" onClick={onExportVocals} disabled={disabled || isRendering}>
          Vocals only
        </button>
        {isRendering && (
          <div className="progress">
            <span style={{ width: `${Math.min(progress * 100, 100)}%` }}></span>
          </div>
        )}
      </div>
    </div>
  )
}
