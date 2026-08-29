interface Props {
  onExportMix: () => void
  onExportVocals: () => void
  progress: number
  isRendering: boolean
  disabled?: boolean
}

export function ExportDialog({ onExportMix, onExportVocals, progress, isRendering, disabled }: Props) {
  return (
    <div className="export-buttons">
      <button className="playback-wide-button" onClick={onExportVocals} disabled={disabled || isRendering}>
        Export Vocals Only
      </button>
      <button className="secondary playback-wide-button" onClick={onExportMix} disabled={disabled || isRendering}>
        Export Vocals + Music Mix
      </button>
      {isRendering && (
        <div className="progress" style={{ marginTop: 10 }}>
          <span style={{ width: `${Math.min(progress * 100, 100)}%` }}></span>
        </div>
      )}
    </div>
  )
}
