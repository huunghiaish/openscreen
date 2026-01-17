/**
 * Decoded Frame Buffer for WebCodecs Video Pipeline
 *
 * Buffers decoded VideoFrames between VideoDecoderService output and consumer.
 * Uses decode-order indexing (not timestamp) to properly support VFR video.
 *
 * Key features:
 * - Stores VideoFrames indexed by decode order (0, 1, 2, ...)
 * - Direct O(1) lookup by frame index
 * - Memory-bounded to prevent GPU memory exhaustion
 * - Promise-based backpressure for buffer space waiting
 */

/**
 * Configuration for DecodedFrameBuffer
 */
export interface FrameBufferConfig {
  /** Maximum frames to buffer. Default: 16 */
  maxFrames?: number;
  /** Frame rate (used for stats only, not lookup). Required. */
  frameRate: number;
  /** Enable debug logging. Default: false */
  debug?: boolean;
}

/**
 * Buffer statistics for monitoring
 */
export interface BufferStats {
  /** Current number of buffered frames */
  currentSize: number;
  /** Maximum buffer capacity */
  maxSize: number;
  /** Total frames added to buffer */
  framesAdded: number;
  /** Total frames consumed from buffer */
  framesConsumed: number;
  /** Lowest frame index in buffer */
  minIndex: number | null;
  /** Highest frame index in buffer */
  maxIndex: number | null;
}

/**
 * DecodedFrameBuffer - Index-based buffer for decoded VideoFrames
 *
 * This buffer stores frames by their decode order index, which properly
 * supports Variable Frame Rate (VFR) video where timestamps don't align
 * with calculated frame indices.
 */
export class DecodedFrameBuffer {
  // Store frames by decode index (not timestamp)
  private frames: Map<number, VideoFrame> = new Map();
  private readonly maxFrames: number;
  private readonly debug: boolean;

  // Statistics
  private framesAdded = 0;
  private framesConsumed = 0;

  // Backpressure management
  private spaceWaiters: Array<() => void> = [];

  constructor(config: FrameBufferConfig) {
    if (!config.frameRate || config.frameRate <= 0) {
      throw new Error('frameRate must be positive');
    }

    this.maxFrames = config.maxFrames ?? 16;
    this.debug = config.debug ?? false;

    this.log(`Initialized: maxFrames=${this.maxFrames}, frameRate=${config.frameRate}`);
  }

  // ========== Input Methods (from decoder) ==========

  /**
   * Add a decoded VideoFrame to the buffer with its decode index.
   * IMPORTANT: Caller MUST check isFull() before calling this method.
   * @param frame - Decoded VideoFrame from VideoDecoderService
   * @param decodeIndex - The decode order index (0, 1, 2, ...)
   */
  addFrame(frame: VideoFrame, decodeIndex: number): void {
    // Safety check: caller should have checked isFull() first
    if (this.frames.size >= this.maxFrames) {
      this.log(`ERROR: addFrame() called on full buffer - dropping frame ${decodeIndex}`);
      frame.close();
      return;
    }

    this.frames.set(decodeIndex, frame);
    this.framesAdded++;

    this.log(`Added frame ${decodeIndex} at ${frame.timestamp}µs, buffer size: ${this.frames.size}/${this.maxFrames}`);
  }

  /**
   * Check if buffer is at maximum capacity.
   */
  isFull(): boolean {
    return this.frames.size >= this.maxFrames;
  }

  /**
   * Wait for space in the buffer.
   * Returns immediately if buffer has space, otherwise waits until frame consumed.
   */
  async waitForSpace(): Promise<void> {
    if (!this.isFull()) {
      return;
    }

    this.log(`Waiting for space, buffer full at ${this.frames.size}/${this.maxFrames}`);

    return new Promise<void>(resolve => {
      this.spaceWaiters.push(resolve);
    });
  }

  // ========== Output Methods (to consumer) ==========

  /**
   * Check if a frame at the given index is available in buffer.
   * @param frameIndex - Frame decode index (0-based)
   */
  hasFrame(frameIndex: number): boolean {
    return this.frames.has(frameIndex);
  }

  /**
   * Get a frame by index without removing it from buffer.
   * @param frameIndex - Frame decode index (0-based)
   * @returns VideoFrame or null if not found
   */
  getFrame(frameIndex: number): VideoFrame | null {
    return this.frames.get(frameIndex) ?? null;
  }

  /**
   * Consume a frame by index, removing it from buffer.
   * Consumer is responsible for calling frame.close() after use.
   * @param frameIndex - Frame decode index (0-based)
   * @returns VideoFrame or null if not found
   */
  consumeFrame(frameIndex: number): VideoFrame | null {
    const frame = this.frames.get(frameIndex);
    if (!frame) {
      this.log(`Frame not found for index ${frameIndex}`);
      return null;
    }

    this.frames.delete(frameIndex);
    this.framesConsumed++;
    this.notifyWaiters();
    this.log(`Consumed frame ${frameIndex} at ${frame.timestamp}µs, buffer size: ${this.frames.size}/${this.maxFrames}`);

    return frame;
  }

  // ========== Lifecycle Methods ==========

  /**
   * Flush buffer, returning all remaining frames without closing them.
   * Caller is responsible for closing returned frames.
   * @returns Array of remaining VideoFrames in index order
   */
  flush(): VideoFrame[] {
    const indices = Array.from(this.frames.keys()).sort((a, b) => a - b);
    const frames: VideoFrame[] = [];

    for (const index of indices) {
      const frame = this.frames.get(index);
      if (frame) {
        frames.push(frame);
      }
    }

    this.frames.clear();
    this.notifyWaiters();

    this.log(`Flushed ${frames.length} frames`);

    return frames;
  }

  /**
   * Reset buffer state, closing all buffered frames.
   */
  reset(): void {
    for (const frame of this.frames.values()) {
      try {
        frame.close();
      } catch {
        // Frame may already be closed
      }
    }

    this.frames.clear();
    this.framesAdded = 0;
    this.framesConsumed = 0;

    this.notifyWaiters();
    this.spaceWaiters = [];

    this.log('Reset complete');
  }

  /**
   * Destroy buffer and release all resources.
   */
  destroy(): void {
    this.reset();
    this.log('Destroyed');
  }

  // ========== Statistics ==========

  /**
   * Get buffer statistics for monitoring.
   */
  getStats(): BufferStats {
    const indices = Array.from(this.frames.keys());
    return {
      currentSize: this.frames.size,
      maxSize: this.maxFrames,
      framesAdded: this.framesAdded,
      framesConsumed: this.framesConsumed,
      minIndex: indices.length > 0 ? Math.min(...indices) : null,
      maxIndex: indices.length > 0 ? Math.max(...indices) : null,
    };
  }

  /**
   * Get current buffer size.
   */
  get size(): number {
    return this.frames.size;
  }

  // ========== Private Methods ==========

  /**
   * Notify waiting producers that buffer has space.
   */
  private notifyWaiters(): void {
    while (this.spaceWaiters.length > 0 && !this.isFull()) {
      const resolve = this.spaceWaiters.shift()!;
      resolve();
    }
  }

  /**
   * Debug logging helper.
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[DecodedFrameBuffer]', ...args);
    }
  }
}
