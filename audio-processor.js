class AudioProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const audioChunk = inputs[0][0];

    if (audioChunk) {
      // Send the audio chunk back to the main thread.
      // We send a transferable buffer for performance.
      this.port.postMessage(audioChunk.buffer, [audioChunk.buffer]);
    }

    // Return true to keep the processor alive.
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
