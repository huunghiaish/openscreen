/**
 * VideoDecoder Service with Backpressure
 *
 * Hardware-accelerated video decoding using WebCodecs VideoDecoder API.
 * Transforms EncodedVideoChunks into VideoFrames with proper backpressure
 * management to prevent memory exhaustion and queue overflow.
 *
 * Key features:
 * - Automatic hardware acceleration (VideoToolbox on macOS)
 * - Backpressure via decodeQueueSize monitoring
 * - Frame output callback in presentation order
 * - Decode timing stats for performance monitoring
 */

/**
 * Configuration for VideoDecoderService
 */
export interface DecoderServiceConfig {
  /** Maximum decode queue size before applying backpressure. Default: 8 */
  maxQueueSize?: number;
  /** Enable debug logging. Default: false */
  debug?: boolean;
}

/**
 * Callback type for decoded frame output
 * @param frame - Decoded VideoFrame (consumer must call frame.close())
 * @param timestamp - Frame timestamp in microseconds
 */
export type FrameCallback = (frame: VideoFrame, timestamp: number) => void;

/**
 * Decoder performance statistics
 */
export interface DecoderStats {
  /** Total frames successfully decoded */
  framesDecoded: number;
  /** Frames dropped due to errors */
  framesDropped: number;
  /** Average decode time in milliseconds */
  averageDecodeTime: number;
  /** Current decode queue size */
  queueSize: number;
  /** Estimated hardware acceleration (decode time <5ms suggests hardware) */
  isHardwareAccelerated: boolean;
}

/**
 * VideoDecoderService - WebCodecs-based video decoder with backpressure
 *
 * Usage:
 * ```typescript
 * const service = new VideoDecoderService({ maxQueueSize: 8 });
 * service.setFrameCallback((frame, timestamp) => {
 *   // Process frame
 *   frame.close(); // Required to release GPU memory
 * });
 *
 * await service.configure(decoderConfig);
 *
 * for await (const chunk of demuxer.getChunksFromTimestamp(0)) {
 *   await service.decode(chunk);
 * }
 *
 * await service.flush();
 * service.close();
 * ```
 */
export class VideoDecoderService {
  private decoder: VideoDecoder | null = null;
  private frameCallback: FrameCallback | null = null;
  private readonly maxQueueSize: number;
  private readonly debug: boolean;

  // Statistics tracking
  private framesDecoded = 0;
  private framesDropped = 0;
  private totalDecodeTime = 0;
  private decodeStartTimes: Map<number, number> = new Map();

  // Backpressure management
  private waitingResolvers: Array<() => void> = [];

  // Bound handler for event listener cleanup
  private boundHandleDequeue = this.handleDequeue.bind(this);

  // Error tracking
  private lastError: Error | null = null;
  private decoderConfig: VideoDecoderConfig | null = null;

  constructor(config: DecoderServiceConfig = {}) {
    this.maxQueueSize = config.maxQueueSize ?? 8;
    this.debug = config.debug ?? false;
  }

  /**
   * Configure the decoder with a VideoDecoderConfig
   * @param config - Configuration from VideoDemuxer.getDecoderConfig()
   * @returns true if configuration succeeded, false if unsupported
   */
  async configure(config: VideoDecoderConfig): Promise<boolean> {
    // Check codec support first
    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) {
      this.log(`Codec not supported: ${config.codec}`);
      return false;
    }

    // Close existing decoder if any
    this.close();

    // Create new decoder with callbacks
    this.decoder = new VideoDecoder({
      output: this.handleFrame.bind(this),
      error: this.handleError.bind(this),
    });

    // Configure decoder
    this.decoder.configure(config);
    this.decoderConfig = config;

    // Listen for dequeue events to resolve waiting promises
    this.decoder.addEventListener('dequeue', this.boundHandleDequeue);

    this.log(`Configured decoder: ${config.codec} ${config.codedWidth}x${config.codedHeight}`);

    return true;
  }

  /**
   * Check if the decoder can accept another chunk without exceeding queue limit
   */
  canAcceptChunk(): boolean {
    if (!this.decoder || this.decoder.state !== 'configured') {
      return false;
    }
    return this.decoder.decodeQueueSize < this.maxQueueSize;
  }

  /**
   * Wait for space in the decode queue
   * Returns immediately if queue has space, otherwise waits for dequeue event
   */
  async waitForSpace(): Promise<void> {
    if (this.canAcceptChunk()) {
      return;
    }

    this.log(`Waiting for space. Queue: ${this.decoder?.decodeQueueSize}/${this.maxQueueSize}`);

    return new Promise<void>(resolve => {
      this.waitingResolvers.push(resolve);
    });
  }

  /**
   * Decode an EncodedVideoChunk
   * Applies backpressure by waiting for queue space
   * @param chunk - Encoded video chunk from demuxer
   */
  async decode(chunk: EncodedVideoChunk): Promise<void> {
    if (!this.decoder || this.decoder.state !== 'configured') {
      throw new Error('Decoder not configured');
    }

    // Wait for space in queue (backpressure)
    await this.waitForSpace();

    // Track decode start time for stats
    this.decodeStartTimes.set(chunk.timestamp, performance.now());

    try {
      this.decoder.decode(chunk);
    } catch (error) {
      this.framesDropped++;
      this.decodeStartTimes.delete(chunk.timestamp);
      this.clearWaitingResolvers(); // Unblock waiting promises on error
      this.log(`Decode error for chunk at ${chunk.timestamp}:`, error);
      throw error;
    }
  }

  /**
   * Flush the decoder to drain all pending frames
   * Call this after feeding all chunks to ensure complete output
   */
  async flush(): Promise<void> {
    if (!this.decoder || this.decoder.state !== 'configured') {
      this.log('Cannot flush: decoder not configured');
      return;
    }

    this.log('Flushing decoder...');
    await this.decoder.flush();
    this.log('Flush complete');
  }

  /**
   * Close the decoder and release resources
   */
  close(): void {
    if (this.decoder) {
      // Remove event listener to prevent memory leak
      this.decoder.removeEventListener('dequeue', this.boundHandleDequeue);

      if (this.decoder.state !== 'closed') {
        this.decoder.close();
      }
    }

    this.decoder = null;
    this.lastError = null;
    this.clearWaitingResolvers();
    this.decodeStartTimes.clear();

    this.log('Decoder closed');
  }

  /**
   * Reset the decoder after an error
   * Attempts to reconfigure with the same config
   */
  async reset(): Promise<boolean> {
    if (!this.decoderConfig) {
      this.log('Cannot reset: no saved config');
      return false;
    }

    this.log('Resetting decoder after error');
    this.close();
    return await this.configure(this.decoderConfig);
  }

  /**
   * Set the callback for decoded frame output
   * @param callback - Called for each decoded frame (consumer must call frame.close())
   */
  setFrameCallback(callback: FrameCallback): void {
    this.frameCallback = callback;
  }

  /**
   * Get decoder performance statistics
   */
  getStats(): DecoderStats {
    const avgDecodeTime = this.framesDecoded > 0
      ? this.totalDecodeTime / this.framesDecoded
      : 0;

    return {
      framesDecoded: this.framesDecoded,
      framesDropped: this.framesDropped,
      averageDecodeTime: avgDecodeTime,
      queueSize: this.decoder?.decodeQueueSize ?? 0,
      // Hardware acceleration typically achieves <5ms decode time
      isHardwareAccelerated: avgDecodeTime < 5 && this.framesDecoded > 10,
    };
  }

  /**
   * Get the current decoder state
   */
  getState(): 'unconfigured' | 'configured' | 'closed' {
    return this.decoder?.state ?? 'unconfigured';
  }

  /**
   * Get the last error that occurred
   */
  getLastError(): Error | null {
    return this.lastError;
  }

  /**
   * Handle decoded frame output from VideoDecoder
   */
  private handleFrame(frame: VideoFrame): void {
    this.framesDecoded++;

    // Calculate decode time
    const startTime = this.decodeStartTimes.get(frame.timestamp);
    if (startTime !== undefined) {
      const decodeTime = performance.now() - startTime;
      this.totalDecodeTime += decodeTime;
      this.decodeStartTimes.delete(frame.timestamp);
    }

    // Invoke callback (consumer is responsible for closing frame)
    if (this.frameCallback) {
      this.frameCallback(frame, frame.timestamp);
    } else {
      // No callback - close frame to prevent memory leak
      this.log(`Warning: No frame callback set, closing frame at ${frame.timestamp}`);
      frame.close();
    }
  }

  /**
   * Handle dequeue event - resolve waiting promises when queue has space
   */
  private handleDequeue(): void {
    // Check if we now have space and resolve waiting promises
    while (this.waitingResolvers.length > 0 && this.canAcceptChunk()) {
      const resolve = this.waitingResolvers.shift()!;
      resolve();
    }
  }

  /**
   * Handle decoder errors
   */
  private handleError(error: DOMException): void {
    this.lastError = error;
    this.framesDropped++;
    this.log(`Decoder error: ${error.name} - ${error.message}`);
    this.clearWaitingResolvers();
  }

  /**
   * Clear and resolve all waiting promises to avoid deadlock
   */
  private clearWaitingResolvers(): void {
    for (const resolve of this.waitingResolvers) {
      resolve();
    }
    this.waitingResolvers = [];
  }

  /**
   * Debug logging helper
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[VideoDecoderService]', ...args);
    }
  }
}
