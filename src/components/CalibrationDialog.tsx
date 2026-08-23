interface Props {
  open: boolean
  busy: boolean
  error?: string
  manualClap: boolean
  detectedHits: number
  micLevel: number
  onCalibrate: (manualClap: boolean) => void
  onClose: () => void
}

export function CalibrationDialog({ open, busy, error, manualClap, detectedHits, micLevel, onCalibrate, onClose }: Props) {
  if (!open) return null
  return (
    <div className="calibration-backdrop" role="presentation">
      <div className="calibration-dialog" role="dialog" aria-modal="true" aria-labelledby="calibration-title">
        <div className="section-title">
          <h2 id="calibration-title">Quick audio setup</h2>
          <button className="secondary calibration-close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <p className="text-muted">
          Punchin will measure the timing of your current microphone and speakers. Keep the room quiet and turn off microphone monitoring.
        </p>
        <div className="calibration-choice">
          <strong>Automatic speaker setup</strong>
          <span className="text-muted">Use speakers. The app plays test clicks and measures them automatically.</span>
          <button onClick={() => onCalibrate(false)} disabled={busy}>{busy ? 'Measuring...' : 'Calibrate with speakers'}</button>
        </div>
        <div className="calibration-choice">
          <strong>Wired headphone setup</strong>
          <span className="text-muted">Put on wired headphones. Wait through the four-click count-in, then clap along with the next six clicks.</span>
          <button className="secondary" onClick={() => onCalibrate(true)} disabled={busy}>Calibrate with claps</button>
        </div>
        {busy && (
          <div className="calibration-progress">
            <div className="calibration-meter"><span style={{ width: `${micLevel * 100}%` }} /></div>
            <strong>{manualClap ? 'Count-in first, then clap on each click.' : 'Listening for all calibration clicks...'}</strong>
            <div className="text-muted">{manualClap ? `Detected claps: ${detectedHits} / 6` : `Listening for calibration clicks: ${detectedHits} / 10`}</div>
          </div>
        )}
        {error && <div className="calibration-error">{error}</div>}
        <p className="text-muted calibration-note">Bluetooth audio is not supported for recording.</p>
      </div>
    </div>
  )
}
