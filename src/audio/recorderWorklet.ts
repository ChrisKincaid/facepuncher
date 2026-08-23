declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void

class RecorderWorklet extends AudioWorkletProcessor {
  constructor() {
    super()
  }

  process(inputs: Float32Array[][]) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channelData = input[0]
    // Copy frame to transfer list to avoid blocking audio thread
    const frame = channelData.slice(0)
    this.port.postMessage(frame, [frame.buffer])
    return true
  }
}

registerProcessor('recorder-worklet', RecorderWorklet)
