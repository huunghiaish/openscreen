/**
 * Decoded Frame Buffer for WebCodecs Video Pipeline
 *
 * Buffers decoded VideoFrames between VideoDecoderService output and worker
 * consumption. Handles frame lookup by index (via timestamp conversion),
 * memory management through bounded buffer with eviction, and backpressure
 * signaling when buffer has space.
 *
 * Key features:
 * - Stores VideoFrames indexed by timestamp for O(1) lookup
 * - Converts frame index to timestamp using frame rate
 * - Evicts oldest frames when buffer full (calls frame.close())
 * - Promise-based backpressure for buffer space waiting
 * - Memory-bounded to prevent GPU memory exhaustion
 */

/**
 * Configuration for DecodedFrameBuffer
 */
export interface FrameBufferConfig {
  /** Maximum frames to buffer before eviction. Default: 16 */
  maxFrames?: number;
  /**
   * Frame rate for index->timestamp mapping. Required.
   *
   * For Variable Frame Rate (VFR) content, use the average frame rate.
   * The timestampTolerance parameter can be increased to handle VFR variation.
   */
  frameRate: number;
  /**
   * Timestamp tolerance for frame matching in microseconds. Default: half frame duration.
   *
   * For Variable Frame Rate (VFR) content, consider setting this to a full frame duration
   * or higher to accommodate timestamp drift. For example, at 30fps with VFR:
   * - Default tolerance (16667µs) may miss frames with timing variation
   * - Recommended VFR tolerance: 33333µs to 50000µs (1-1.5x frame duration)
   */
  timestampTolerance?: number;
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
  /** Total frames evicted due to buffer full */
  framesEvicted: number;
  /** Oldest timestamp in buffer (microseconds) */
  oldestTimestamp: number | null;
  /** Newest timestamp in buffer (microseconds) */
  newestTimestamp: number | null;
}

/**
 * DecodedFrameBuffer - Memory-bounded buffer for decoded VideoFrames
 *
 * Usage:
 * ```typescript
 * const buffer = new DecodedFrameBuffer({ frameRate: 30, maxFrames: 16 });
 *
 * // Producer (VideoDecoderService callback)
 * decoderService.setFrameCallback((frame) => {
 *   if (buffer.isFull()) {
 *     await buffer.waitForSpace();
 *   }
 *   buffer.addFrame(frame);
 * });
 *
 * // Consumer (Worker requesting frames)
 * if (buffer.hasFrame(frameIndex)) {
 *   const frame = buffer.consumeFrame(frameIndex);
 *   // Process frame...
 *   frame.close(); // Consumer responsible for cleanup
 * }
 * ```
 */
export class DecodedFrameBuffer {
  private frames: Map<number, VideoFrame> = new Map();
  /** Sorted array of timestamps for O(log n) lookup */
  private sortedTimestamps: number[] = [];
  private readonly maxFrames: number;
  private readonly frameRate: number;
  private readonly frameDurationMicros: number;
  private readonly timestampTolerance: number;
  private readonly debug: boolean;

  // Statistics
  private framesAdded = 0;
  private framesConsumed = 0;
  private framesEvicted = 0;

  // Cached stats for efficient getStats() calls
  private cachedOldest: number | null = null;
  private cachedNewest: number | null = null;

  // Backpressure management
  private spaceWaiters: Array<() => void> = [];

  constructor(config: FrameBufferConfig) {
    if (!config.frameRate || config.frameRate <= 0) {
      throw new Error('frameRate must be positive');
    }

    this.maxFrames = config.maxFrames ?? 16;
    this.frameRate = config.frameRate;
    // Frame duration in microseconds (1 second = 1,000,000 microseconds)
    this.frameDurationMicros = (1 / this.frameRate) * 1_000_000;
    // Default tolerance: half a frame duration
    this.timestampTolerance = config.timestampTolerance ?? (this.frameDurationMicros / 2);
    this.debug = config.debug ?? false;

    this.log(`Initialized: maxFrames=${this.maxFrames}, frameRate=${this.frameRate}, frameDuration=${this.frameDurationMicros.toFixed(0)}µs`);
  }

  // ========== Input Methods (from decoder) ==========

  /**
   * Add a decoded VideoFrame to the buffer.
   * If buffer is full, evicts the oldest frame (calls close()).
   * @param frame - Decoded VideoFrame from VideoDecoderService
   */
  addFrame(frame: VideoFrame): void {
    const timestamp = frame.timestamp;

    // Evict oldest if full
    if (this.frames.size >= this.maxFrames) {
      this.evictOldest();
    }

    this.frames.set(timestamp, frame);
    this.insertSorted(timestamp);
    this.updateCachedBounds(timestamp);
    this.framesAdded++;

    this.log(`Added frame at ${timestamp}µs, buffer size: ${this.frames.size}/${this.maxFrames}`);
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

  // ========== Output Methods (to workers) ==========

  /**
   * Check if a frame at the given index is available in buffer.
   * @param frameIndex - Frame sequence number (0-based)
   */
  hasFrame(frameIndex: number): boolean {
    const targetTimestamp = this.indexToTimestamp(frameIndex);
    return this.findFrameTimestamp(targetTimestamp) !== null;
  }

  /**
   * Get a frame by index without removing it from buffer.
   * @param frameIndex - Frame sequence number (0-based)
   * @returns VideoFrame or null if not found
   */
  getFrame(frameIndex: number): VideoFrame | null {
    const targetTimestamp = this.indexToTimestamp(frameIndex);
    const actualTimestamp = this.findFrameTimestamp(targetTimestamp);

    if (actualTimestamp === null) {
      return null;
    }

    return this.frames.get(actualTimestamp) ?? null;
  }

  /**
   * Consume a frame by index, removing it from buffer.
   * Consumer is responsible for calling frame.close() after use.
   * @param frameIndex - Frame sequence number (0-based)
   * @returns VideoFrame or null if not found
   */
  consumeFrame(frameIndex: number): VideoFrame | null {
    const targetTimestamp = this.indexToTimestamp(frameIndex);
    const actualTimestamp = this.findFrameTimestamp(targetTimestamp);

    if (actualTimestamp === null) {
      this.log(`Frame not found for index ${frameIndex} (target: ${targetTimestamp}µs)`);
      return null;
    }

    const frame = this.frames.get(actualTimestamp);
    if (frame) {
      this.frames.delete(actualTimestamp);
      this.removeSorted(actualTimestamp);
      this.rebuildCachedBounds();
      this.framesConsumed++;
      this.notifyWaiters();
      this.log(`Consumed frame ${frameIndex} at ${actualTimestamp}µs, buffer size: ${this.frames.size}/${this.maxFrames}`);
    }

    return frame ?? null;
  }

  // ========== Lifecycle Methods ==========

  /**
   * Flush buffer, returning all remaining frames without closing them.
   * Caller is responsible for closing returned frames.
   * @returns Array of remaining VideoFrames in timestamp order
   */
  flush(): VideoFrame[] {
    // Use pre-sorted timestamps for O(1) ordering
    const frames: VideoFrame[] = [];

    for (const timestamp of this.sortedTimestamps) {
      const frame = this.frames.get(timestamp);
      if (frame) {
        frames.push(frame);
      }
    }

    this.frames.clear();
    this.sortedTimestamps = [];
    this.cachedOldest = null;
    this.cachedNewest = null;
    this.notifyWaiters();

    this.log(`Flushed ${frames.length} frames`);

    return frames;
  }

  /**
   * Reset buffer state, closing all buffered frames.
   * Call when aborting or starting new export.
   */
  reset(): void {
    // Close all buffered frames to release GPU memory
    for (const frame of this.frames.values()) {
      try {
        frame.close();
      } catch {
        // Frame may already be closed
      }
    }

    this.frames.clear();
    this.sortedTimestamps = [];
    this.cachedOldest = null;
    this.cachedNewest = null;
    this.framesAdded = 0;
    this.framesConsumed = 0;
    this.framesEvicted = 0;

    // Resolve waiting promises to avoid deadlock
    this.notifyWaiters();
    this.spaceWaiters = [];

    this.log('Reset complete');
  }

  /**
   * Destroy buffer and release all resources.
   * Call when done with buffer entirely.
   */
  destroy(): void {
    this.reset();
    this.log('Destroyed');
  }

  // ========== Statistics ==========

  /**
   * Get buffer statistics for monitoring.
   * Uses cached min/max timestamps for O(1) performance.
   */
  getStats(): BufferStats {
    return {
      currentSize: this.frames.size,
      maxSize: this.maxFrames,
      framesAdded: this.framesAdded,
      framesConsumed: this.framesConsumed,
      framesEvicted: this.framesEvicted,
      oldestTimestamp: this.cachedOldest,
      newestTimestamp: this.cachedNewest,
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
   * Convert frame index to presentation timestamp in microseconds.
   */
  private indexToTimestamp(frameIndex: number): number {
    return (frameIndex / this.frameRate) * 1_000_000;
  }

  /**
   * Find the actual frame timestamp closest to target within tolerance.
   * Uses binary search on sorted timestamps for O(log n) performance.
   * @returns Actual timestamp if found, null otherwise
   */
  private findFrameTimestamp(targetTimestamp: number): number | null {
    // Fast path: exact match in Map (O(1))
    if (this.frames.has(targetTimestamp)) {
      return targetTimestamp;
    }

    // Empty buffer check
    if (this.sortedTimestamps.length === 0) {
      return null;
    }

    // Binary search for closest timestamp
    const idx = this.binarySearchClosest(targetTimestamp);
    const closest = this.sortedTimestamps[idx];

    if (closest !== undefined && Math.abs(closest - targetTimestamp) <= this.timestampTolerance) {
      return closest;
    }

    return null;
  }

  /**
   * Binary search to find index of closest timestamp to target.
   * Returns index of element closest to target.
   */
  private binarySearchClosest(target: number): number {
    const arr = this.sortedTimestamps;
    if (arr.length === 0) return 0;
    if (arr.length === 1) return 0;

    let left = 0;
    let right = arr.length - 1;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (arr[mid] === target) {
        return mid;
      } else if (arr[mid] < target) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    // Check if we should return left or left-1 (whichever is closer)
    if (left > 0 && Math.abs(arr[left - 1] - target) < Math.abs(arr[left] - target)) {
      return left - 1;
    }
    return left;
  }

  /**
   * Evict the oldest frame from buffer.
   * CRITICAL: Calls frame.close() to release GPU memory.
   * Uses sorted array for O(1) oldest lookup.
   */
  private evictOldest(): void {
    if (this.sortedTimestamps.length === 0) {
      return;
    }

    // Oldest is always first in sorted array
    const oldestTimestamp = this.sortedTimestamps[0];
    const frame = this.frames.get(oldestTimestamp);

    if (frame) {
      try {
        frame.close(); // CRITICAL: Release GPU memory
      } catch {
        // Frame may already be closed
      }
      this.frames.delete(oldestTimestamp);
      this.sortedTimestamps.shift(); // Remove from sorted array
      this.rebuildCachedBounds();
      this.framesEvicted++;
      this.log(`Evicted frame at ${oldestTimestamp}µs`);
    }
  }

  /**
   * Insert timestamp into sorted array maintaining order.
   * Uses binary search for O(log n) insertion point finding.
   */
  private insertSorted(timestamp: number): void {
    // Binary search for insertion point
    let left = 0;
    let right = this.sortedTimestamps.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this.sortedTimestamps[mid] < timestamp) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    this.sortedTimestamps.splice(left, 0, timestamp);
  }

  /**
   * Remove timestamp from sorted array.
   * Uses binary search for O(log n) lookup.
   */
  private removeSorted(timestamp: number): void {
    const idx = this.sortedTimestamps.indexOf(timestamp);
    if (idx !== -1) {
      this.sortedTimestamps.splice(idx, 1);
    }
  }

  /**
   * Update cached bounds when adding a new timestamp.
   */
  private updateCachedBounds(timestamp: number): void {
    if (this.cachedOldest === null || timestamp < this.cachedOldest) {
      this.cachedOldest = timestamp;
    }
    if (this.cachedNewest === null || timestamp > this.cachedNewest) {
      this.cachedNewest = timestamp;
    }
  }

  /**
   * Rebuild cached bounds from sorted array.
   */
  private rebuildCachedBounds(): void {
    if (this.sortedTimestamps.length === 0) {
      this.cachedOldest = null;
      this.cachedNewest = null;
    } else {
      this.cachedOldest = this.sortedTimestamps[0];
      this.cachedNewest = this.sortedTimestamps[this.sortedTimestamps.length - 1];
    }
  }

  /**
   * Notify waiting producers that buffer has space.
   */
  private notifyWaiters(): void {
    // Resolve one waiter at a time (FIFO)
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
