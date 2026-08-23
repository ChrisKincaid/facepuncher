declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void
declare const currentFrame: number

class RecorderWorklet extends AudioWorkletProcessor {
  constructor() {
    super()
  }

  process(inputs: Float32Array[][]) {
    const input = inputs[0]
    // Firefox delivers an empty input array on silent render quanta. Posting a
    // zero-filled frame anyway keeps the capture timeline gap-free so recorded
    // takes stay aligned to real time instead of collapsing to the front.
    const channelData = input && input.length > 0 ? input[0] : undefined
    const frame = channelData ? channelData.slice(0) : new Float32Array(128)
    this.port.postMessage({ frame, startFrame: currentFrame }, [frame.buffer])
    return true
  }
}

registerProcessor('recorder-worklet', RecorderWorklet)
