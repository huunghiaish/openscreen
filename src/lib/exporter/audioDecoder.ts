/**
 * AudioDecoder - Decodes WebM audio files for export
 * Uses Web Audio API to decode audio and provide PCM data for encoding
 */

export interface DecodedAudioInfo {
  sampleRate: number;
  numberOfChannels: number;
  duration: number; // in seconds
  totalSamples: number;
}

export class AudioFileDecoder {
  private audioContext: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private info: DecodedAudioInfo | null = null;

  /**
   * Load and decode audio file from URL
   */
  async loadAudio(audioUrl: string): Promise<DecodedAudioInfo> {
    // Fetch the audio file as ArrayBuffer
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();

    // Create AudioContext and decode the audio data
    this.audioContext = new AudioContext();
    this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

    this.info = {
      sampleRate: this.audioBuffer.sampleRate,
      numberOfChannels: this.audioBuffer.numberOfChannels,
      duration: this.audioBuffer.duration,
      totalSamples: this.audioBuffer.length,
    };

    return this.info;
  }

  /**
   * Get AudioBuffer for processing
   */
  getAudioBuffer(): AudioBuffer | null {
    return this.audioBuffer;
  }

  /**
   * Get decoded audio info
   */
  getInfo(): DecodedAudioInfo | null {
    return this.info;
  }

  /**
   * Extract audio samples for a time range
   * Returns interleaved Float32Array (L,R,L,R,... for stereo)
   */
  extractSamples(
    startTimeMs: number,
    endTimeMs: number,
  ): Float32Array | null {
    if (!this.audioBuffer || !this.info) {
      return null;
    }

    const sampleRate = this.audioBuffer.sampleRate;
    const numChannels = this.audioBuffer.numberOfChannels;

    // Calculate effective time range accounting for trims
    const startSample = Math.floor((startTimeMs / 1000) * sampleRate);
    const endSample = Math.min(
      Math.ceil((endTimeMs / 1000) * sampleRate),
      this.audioBuffer.length
    );
    const sampleCount = Math.max(0, endSample - startSample);

    if (sampleCount === 0) {
      return new Float32Array(0);
    }

    // Get channel data
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(this.audioBuffer.getChannelData(ch));
    }

    // Create interleaved output (for stereo: L,R,L,R,...)
    const interleaved = new Float32Array(sampleCount * numChannels);

    for (let i = 0; i < sampleCount; i++) {
      const sampleIndex = startSample + i;
      for (let ch = 0; ch < numChannels; ch++) {
        interleaved[i * numChannels + ch] = channels[ch][sampleIndex] || 0;
      }
    }

    return interleaved;
  }

  /**
   * Get all audio samples as interleaved Float32Array
   */
  getAllSamples(): Float32Array | null {
    if (!this.audioBuffer || !this.info) {
      return null;
    }
    return this.extractSamples(0, this.info.duration * 1000);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.audioBuffer = null;
    this.info = null;
  }
}

/**
 * Mix multiple audio sources into a single buffer
 * Used to combine mic and system audio into one track
 */
export function mixAudioBuffers(
  buffers: (AudioBuffer | null)[],
  targetSampleRate: number = 48000
): AudioBuffer | null {
  const validBuffers = buffers.filter((b): b is AudioBuffer => b !== null);
  if (validBuffers.length === 0) {
    return null;
  }

  // Find max duration and channels
  const maxDuration = Math.max(...validBuffers.map(b => b.duration));
  const maxChannels = Math.max(...validBuffers.map(b => b.numberOfChannels));
  const totalSamples = Math.ceil(maxDuration * targetSampleRate);

  // Create offline context for mixing
  const offlineCtx = new OfflineAudioContext(
    maxChannels,
    totalSamples,
    targetSampleRate
  );

  // Mix each buffer
  validBuffers.forEach(buffer => {
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    source.start(0);
  });

  // Render and return
  return null; // This is async, see mixAudioBuffersAsync below
}

/**
 * Async version of mixAudioBuffers with individual gain control
 * @param buffers - Array of audio buffers to mix (can contain null)
 * @param gains - Optional array of gain values for each buffer (default: 1.0 for all)
 * @param targetSampleRate - Target sample rate for output (default: 48000)
 */
export async function mixAudioBuffersAsync(
  buffers: (AudioBuffer | null)[],
  gains?: number[],
  targetSampleRate: number = 48000
): Promise<AudioBuffer | null> {
  const validBuffers: { buffer: AudioBuffer; gain: number }[] = [];

  buffers.forEach((buffer, index) => {
    if (buffer !== null) {
      validBuffers.push({
        buffer,
        gain: gains?.[index] ?? 1.0,
      });
    }
  });

  if (validBuffers.length === 0) {
    return null;
  }

  // Find max duration and channels
  const maxDuration = Math.max(...validBuffers.map(b => b.buffer.duration));
  const maxChannels = Math.max(...validBuffers.map(b => b.buffer.numberOfChannels));
  const totalSamples = Math.ceil(maxDuration * targetSampleRate);

  // Create offline context for mixing
  const offlineCtx = new OfflineAudioContext(
    maxChannels,
    totalSamples,
    targetSampleRate
  );

  // Mix each buffer with specified gain
  validBuffers.forEach(({ buffer, gain }) => {
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;

    // Apply specified gain for this buffer
    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = gain;

    source.connect(gainNode);
    gainNode.connect(offlineCtx.destination);
    source.start(0);
  });

  // Render the mixed audio
  return offlineCtx.startRendering();
}
