class TelaPcmQueueProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSamples = Math.round(sampleRate * 0.04) * 2;
    this.capacity = Math.round(sampleRate * 0.12) * 2;
    this.samples = new Float32Array(this.capacity);
    this.readIndex = 0;
    this.queuedSamples = 0;
    this.droppedSamples = 0;
    this.underrunFrames = 0;
    this.framesSinceReport = 0;
    this.port.onmessage = ({ data }) => {
      if (!(data instanceof Float32Array) || !data.length || data.length % 2) return;
      let start = 0;
      const total = this.queuedSamples + data.length;
      if (total > this.capacity) {
        const drop = total - this.targetSamples;
        const queuedDrop = Math.min(drop, this.queuedSamples);
        this.readIndex = (this.readIndex + queuedDrop) % this.capacity;
        this.queuedSamples -= queuedDrop;
        start = drop - queuedDrop;
        this.droppedSamples += drop;
      }
      let writeIndex = (this.readIndex + this.queuedSamples) % this.capacity;
      for (let i = start; i < data.length; i++) {
        this.samples[writeIndex] = data[i];
        writeIndex = (writeIndex + 1) % this.capacity;
      }
      this.queuedSamples += data.length - start;
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const left = output[0];
    const right = output[1];
    left.fill(0);
    right.fill(0);
    const frames = Math.min(left.length, this.queuedSamples / 2);
    for (let frame = 0; frame < frames; frame++) {
      left[frame] = this.samples[this.readIndex];
      right[frame] = this.samples[(this.readIndex + 1) % this.capacity];
      this.readIndex = (this.readIndex + 2) % this.capacity;
    }
    this.queuedSamples -= frames * 2;
    this.underrunFrames += left.length - frames;
    this.framesSinceReport += left.length;
    if (this.framesSinceReport >= sampleRate) {
      this.framesSinceReport = 0;
      this.port.postMessage({ queuedMs: this.queuedSamples / 2 / sampleRate * 1000,
        droppedFrames: this.droppedSamples / 2, underrunFrames: this.underrunFrames });
    }
    return true;
  }
}

registerProcessor("tela-pcm-queue", TelaPcmQueueProcessor);
