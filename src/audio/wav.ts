function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

export function encodeWavFromAudioBuffer(buffer: AudioBuffer, float32 = false) {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const totalFrames = buffer.length
  const bytesPerSample = float32 ? 4 : 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = totalFrames * blockAlign
  const bufferSize = 44 + dataSize
  const arrayBuffer = new ArrayBuffer(bufferSize)
  const view = new DataView(arrayBuffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, float32 ? 3 : 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bytesPerSample * 8, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  const interleaved = interleave(buffer)
  if (float32) {
    const floatView = new Float32Array(arrayBuffer, 44)
    floatView.set(interleaved)
  } else {
    const intView = new Int16Array(arrayBuffer, 44)
    for (let i = 0; i < interleaved.length; i++) {
      const s = Math.max(-1, Math.min(1, interleaved[i]))
      intView[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' })
}

function interleave(buffer: AudioBuffer) {
  const channels = [] as Float32Array[]
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i))
  }
  const length = buffer.length * buffer.numberOfChannels
  const interleaved = new Float32Array(length)
  let index = 0
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < channels.length; ch++) {
      interleaved[index++] = channels[ch][i]
    }
  }
  return interleaved
}
