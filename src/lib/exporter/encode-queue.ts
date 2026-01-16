/**
 * Event-driven encode queue with Promise-based backpressure.
 * Replaces busy-wait polling with proper async flow control.
 *
 * Key improvements over the old approach:
 * - No more `while (queue >= MAX) await setTimeout(0)` blocking
 * - Uses Promise resolution to signal when queue has space
 * - Configurable max queue size (default: 4, optimal for hardware encoders)
 */

export interface EncodeQueueConfig {
  /** Maximum number of frames in queue before blocking. Default: 4 */
  maxSize?: number;
  /** Enable debug logging. Default: false */
  debug?: boolean;
}

export class EncodeQueue {
  private pendingResolves: Array<() => void> = [];
  private currentSize = 0;
  private readonly maxSize: number;
  private readonly debug: boolean;
  private peakSize = 0;
  private totalEncoded = 0;
  private totalWaits = 0;

  constructor(config: EncodeQueueConfig = {}) {
    this.maxSize = config.maxSize ?? 4;
    this.debug = config.debug ?? false;
  }

  /**
   * Wait for space in the encode queue.
   * Returns immediately if queue has space, otherwise blocks until space available.
   */
  async waitForSpace(): Promise<void> {
    if (this.currentSize < this.maxSize) {
      return;
    }

    this.totalWaits++;

    if (this.debug) {
      console.log(`[EncodeQueue] Waiting for space. Current: ${this.currentSize}/${this.maxSize}`);
    }

    return new Promise<void>(resolve => {
      this.pendingResolves.push(resolve);
    });
  }

  /**
   * Called when encoder output callback fires (chunk produced).
   * Decrements queue size and resolves any waiting promises.
   */
  onChunkOutput(): void {
    this.currentSize--;
    this.totalEncoded++;

    if (this.debug) {
      console.log(`[EncodeQueue] Chunk output. Queue: ${this.currentSize}/${this.maxSize}`);
    }

    // Resolve one waiting promise if any
    if (this.pendingResolves.length > 0) {
      const resolve = this.pendingResolves.shift()!;
      resolve();
    }
  }

  /**
   * Called when a frame is submitted for encoding.
   * Increments queue size and tracks peak.
   */
  increment(): void {
    this.currentSize++;

    if (this.currentSize > this.peakSize) {
      this.peakSize = this.currentSize;
    }

    if (this.debug) {
      console.log(`[EncodeQueue] Frame queued. Queue: ${this.currentSize}/${this.maxSize}`);
    }
  }

  /**
   * Get current queue size.
   */
  get size(): number {
    return this.currentSize;
  }

  /**
   * Check if queue has space for more frames.
   */
  hasSpace(): boolean {
    return this.currentSize < this.maxSize;
  }

  /**
   * Get performance statistics.
   */
  getStats(): {
    peakSize: number;
    totalEncoded: number;
    totalWaits: number;
    pendingWaits: number;
  } {
    return {
      peakSize: this.peakSize,
      totalEncoded: this.totalEncoded,
      totalWaits: this.totalWaits,
      pendingWaits: this.pendingResolves.length,
    };
  }

  /**
   * Reset queue state. Call when starting a new export.
   */
  reset(): void {
    // Resolve any pending waits to avoid deadlocks
    for (const resolve of this.pendingResolves) {
      resolve();
    }
    this.pendingResolves = [];
    this.currentSize = 0;
    this.peakSize = 0;
    this.totalEncoded = 0;
    this.totalWaits = 0;
  }
}
