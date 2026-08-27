class TelaPcmQueueProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.queuedSamples = 0;
    this.port.onmessage = ({ data }) => {
      if (!(data instanceof Float32Array) || data.length === 0) return;
      if (this.queuedSamples > 384000) {
        this.queue = [];
        this.offset = 0;
        this.queuedSamples = 0;
      }
      this.queue.push(data);
      this.queuedSamples += data.length;
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const left = output[0];
    const right = output[1];
    let outputFrame = 0;

    while (outputFrame < left.length && this.queue.length > 0) {
      const samples = this.queue[0];
      const availableFrames = Math.floor((samples.length - this.offset) / 2);
      const framesToCopy = Math.min(left.length - outputFrame, availableFrames);
      for (let frame = 0; frame < framesToCopy; frame += 1) {
        const sampleIndex = this.offset + frame * 2;
        left[outputFrame + frame] = samples[sampleIndex];
        right[outputFrame + frame] = samples[sampleIndex + 1];
      }
      outputFrame += framesToCopy;
      this.offset += framesToCopy * 2;
      this.queuedSamples -= framesToCopy * 2;
      if (this.offset >= samples.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("tela-pcm-queue", TelaPcmQueueProcessor);
