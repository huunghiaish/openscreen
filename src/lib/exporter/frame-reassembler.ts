/**
 * Frame reassembler for in-order collection of parallel-rendered frames.
 * Buffers out-of-order frames and releases them in sequence.
 *
 * Key features:
 * - Maintains strict frame ordering (critical for video encoding)
 * - Buffers early arrivals until expected frame is ready
 * - Releases consecutive frames in batch for encoding efficiency
 * - Memory-bounded buffer with configurable max size
 */

export interface ReassemblerConfig {
  /** Maximum frames to buffer before warning. Default: 32 */
  maxBufferSize?: number;
  /** Enable debug logging. Default: false */
  debug?: boolean;
}

export interface ReassemblerStats {
  nextExpected: number;
  bufferedCount: number;
  totalReceived: number;
  totalReleased: number;
  maxBufferReached: number;
  outOfOrderCount: number;
}

interface BufferedFrame {
  frameIndex: number;
  renderedFrame: VideoFrame;
  receivedAt: number;
}

export class FrameReassembler {
  private buffer: Map<number, BufferedFrame> = new Map();
  private nextExpected = 0;
  private readonly maxBufferSize: number;
  private readonly debug: boolean;
  // Stats tracking
  private totalReceived = 0;
  private totalReleased = 0;
  private maxBufferReached = 0;
  private outOfOrderCount = 0;

  constructor(config: ReassemblerConfig = {}) {
    this.maxBufferSize = config.maxBufferSize ?? 32;
    this.debug = config.debug ?? false;
  }

  /**
   * Add a rendered frame to the reassembler.
   * @param frameIndex - The frame's sequence number
   * @param renderedFrame - The rendered VideoFrame
   * @returns Array of ready frames (in order) that can be encoded
   */
  addFrame(frameIndex: number, renderedFrame: VideoFrame): VideoFrame[] {
    this.totalReceived++;

    // Check if this is out of order
    if (frameIndex !== this.nextExpected) {
      this.outOfOrderCount++;
    }

    // Buffer the frame
    this.buffer.set(frameIndex, {
      frameIndex,
      renderedFrame,
      receivedAt: performance.now(),
    });

    // Track buffer high water mark
    if (this.buffer.size > this.maxBufferReached) {
      this.maxBufferReached = this.buffer.size;
    }

    // Warn if buffer is getting large (potential memory issue)
    if (this.buffer.size >= this.maxBufferSize) {
      console.warn(
        `[FrameReassembler] Buffer size ${this.buffer.size} reached max ${this.maxBufferSize}. ` +
        `Next expected: ${this.nextExpected}, latest received: ${frameIndex}`
      );
    }

    // Collect consecutive ready frames
    const readyFrames: VideoFrame[] = [];

    while (this.buffer.has(this.nextExpected)) {
      const buffered = this.buffer.get(this.nextExpected)!;
      readyFrames.push(buffered.renderedFrame);
      this.buffer.delete(this.nextExpected);
      this.nextExpected++;
      this.totalReleased++;
    }

    if (this.debug && readyFrames.length > 0) {
      console.log(
        `[FrameReassembler] Released ${readyFrames.length} frames. ` +
        `Next expected: ${this.nextExpected}, buffered: ${this.buffer.size}`
      );
    }

    return readyFrames;
  }

  /**
   * Check if a specific frame is ready (already buffered).
   */
  hasFrame(frameIndex: number): boolean {
    return this.buffer.has(frameIndex);
  }

  /**
   * Get the next expected frame index.
   */
  getNextExpected(): number {
    return this.nextExpected;
  }

  /**
   * Get current buffer size.
   */
  getBufferSize(): number {
    return this.buffer.size;
  }

  /**
   * Check if buffer is empty (all frames released).
   */
  isEmpty(): boolean {
    return this.buffer.size === 0;
  }

  /**
   * Force release all buffered frames (for error recovery or shutdown).
   * Returns frames in order where possible, with gaps logged.
   */
  flush(): VideoFrame[] {
    const frames: VideoFrame[] = [];
    const indices = Array.from(this.buffer.keys()).sort((a, b) => a - b);

    let lastIndex = this.nextExpected - 1;
    for (const index of indices) {
      if (index !== lastIndex + 1) {
        console.warn(`[FrameReassembler] Gap detected: expected ${lastIndex + 1}, got ${index}`);
      }
      const buffered = this.buffer.get(index)!;
      frames.push(buffered.renderedFrame);
      this.buffer.delete(index);
      lastIndex = index;
    }

    this.totalReleased += frames.length;

    if (frames.length > 0) {
      this.nextExpected = lastIndex + 1;
    }

    return frames;
  }

  /**
   * Get reassembler statistics.
   */
  getStats(): ReassemblerStats {
    return {
      nextExpected: this.nextExpected,
      bufferedCount: this.buffer.size,
      totalReceived: this.totalReceived,
      totalReleased: this.totalReleased,
      maxBufferReached: this.maxBufferReached,
      outOfOrderCount: this.outOfOrderCount,
    };
  }

  /**
   * Reset reassembler state (for new export).
   * Closes any buffered VideoFrames to prevent leaks.
   */
  reset(): void {
    // Close any remaining frames
    for (const buffered of this.buffer.values()) {
      try {
        buffered.renderedFrame.close();
      } catch (e) {
        // Frame may already be closed
      }
    }
    this.buffer.clear();
    this.nextExpected = 0;
    this.totalReceived = 0;
    this.totalReleased = 0;
    this.maxBufferReached = 0;
    this.outOfOrderCount = 0;
  }

  /**
   * Destroy reassembler and clean up resources.
   */
  destroy(): void {
    this.reset();
  }
}
