import { useEffect, useRef } from 'react'

interface Props {
  audioBuffer?: AudioBuffer
  startSec: number
  endSec: number
  playhead: number
}

export function BarWaveformBackdrop({ audioBuffer, startSec, endSec, playhead }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !audioBuffer) return

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      const context = canvas.getContext('2d')
      if (!context) return
      context.clearRect(0, 0, width, height)

      const samples = audioBuffer.getChannelData(0)
      const startFrame = Math.max(0, Math.floor(startSec * audioBuffer.sampleRate))
      const endFrame = Math.min(samples.length, Math.ceil(endSec * audioBuffer.sampleRate))
      const framesPerColumn = Math.max(1, Math.ceil((endFrame - startFrame) / width))
      const midline = height / 2

      context.fillStyle = 'rgba(77, 208, 225, 0.16)'
      for (let column = 0; column < width; column++) {
        const from = startFrame + column * framesPerColumn
        const to = Math.min(endFrame, from + framesPerColumn)
        let peak = 0
        for (let frame = from; frame < to; frame++) peak = Math.max(peak, Math.abs(samples[frame] ?? 0))
        const amplitude = peak * height * 0.44
        if (amplitude > 0) context.fillRect(column, midline - amplitude, 1, amplitude * 2)
      }

      if (playhead >= startSec && playhead <= endSec) {
        const progress = (playhead - startSec) / Math.max(endSec - startSec, 0.001)
        const x = Math.round(progress * width) + 0.5
        context.strokeStyle = 'rgba(255, 255, 255, 0.9)'
        context.lineWidth = 1
        context.beginPath()
        context.moveTo(x, 0)
        context.lineTo(x, height)
        context.stroke()
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [audioBuffer, endSec, playhead, startSec])

  return <canvas ref={canvasRef} className="bar-waveform-backdrop" aria-hidden="true" />
}
