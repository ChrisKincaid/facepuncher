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
      <div className="collapsible-header">
        <span className="collapsible-title">Export</span>
      </div>
      <div className="export-buttons">
        <button className="playback-wide-button" onClick={onExportMix} disabled={disabled || isRendering}>
          Mix (Beat + Vocals)
        </button>
        <button className="secondary playback-wide-button" onClick={onExportVocals} disabled={disabled || isRendering}>
          Vocals only
        </button>
      </div>
      {isRendering && (
        <div className="progress" style={{ marginTop: 10 }}>
          <span style={{ width: `${Math.min(progress * 100, 100)}%` }}></span>
        </div>
      )}
    </div>
  )
}
