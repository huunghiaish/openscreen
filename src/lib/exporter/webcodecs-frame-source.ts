/**
 * WebCodecs Frame Source
 *
 * High-performance frame extraction using WebCodecs VideoDecoder pipeline.
 * Wires together: VideoDemuxer -> VideoDecoderService -> DecodedFrameBuffer
 *
 * Target performance: <5ms per frame (vs ~100ms with HTMLVideoElement seek)
 */

import type { FrameSource, FrameSourceConfig, FrameSourceResult, FrameSourceStats } from './frame-source';
import { VideoDemuxer, type DemuxerResult } from './video-demuxer';
import { VideoDecoderService } from './video-decoder-service';
import { DecodedFrameBuffer } from './decoded-frame-buffer';
import { TrimTimeMapper } from './trim-time-mapper';

/**
 * WebCodecsFrameSource - Fast frame extraction using WebCodecs pipeline
 *
 * Flow:
 * 1. VideoDemuxer extracts EncodedVideoChunks from container
 * 2. VideoDecoderService decodes chunks to VideoFrames
 * 3. DecodedFrameBuffer stores frames for consumption
 * 4. Decode-ahead loop proactively fills buffer
 */
export class WebCodecsFrameSource implements FrameSource {
  private readonly config: FrameSourceConfig;
  private readonly debug: boolean;

  // Pipeline components
  private demuxer: VideoDemuxer | null = null;
  private decoder: VideoDecoderService | null = null;
  private buffer: DecodedFrameBuffer | null = null;

  // Decode-ahead state
  private decodeAheadTask: Promise<void> | null = null;
  private decodeAheadAbort = false;
  private decodeError: Error | null = null;

  // Video metadata
  private demuxerResult: DemuxerResult | null = null;

  // Trim region handling
  private trimMapper: TrimTimeMapper;

  // Statistics
  private framesRetrieved = 0;
  private totalRetrievalTime = 0;
  private peakRetrievalTime = 0;

  // Frame waiting - keyed by frame index for exact matching
  private frameWaiters: Map<number, Array<() => void>> = new Map();

  // Decode index counter - tracks which frame number we're on
  private nextDecodeIndex = 0;
  // Total frames decoded (for knowing when source is exhausted)
  private totalDecodedFrames = 0;
  // Last frame cache - used to return when export requests beyond source frames
  private lastFrame: VideoFrame | null = null;

  // Pending frame queue - absorbs burst from decoder when buffer is full
  // Each entry is [frame, decodeIndex] tuple to preserve index association
  private pendingFrames: Array<[VideoFrame, number]> = [];
  private pendingWaiters: Array<() => void> = [];
  // Large pending queue (32) to absorb decoder callback bursts
  // Combined with buffer (16), total capacity = 48 frames
  // With headroom of 10, we allow decoding when totalFrames <= 38
  private readonly maxPendingFrames = 32;

  constructor(config: FrameSourceConfig) {
    this.config = config;
    this.debug = config.debug ?? false;

    // Initialize trim mapper for time conversion
    this.trimMapper = new TrimTimeMapper(config.trimRegions);
  }

  async initialize(): Promise<FrameSourceResult> {
    this.log('Initializing WebCodecs frame source');

    // 1. Initialize demuxer
    this.demuxer = new VideoDemuxer({
      videoUrl: this.config.videoUrl,
      debug: this.debug,
    });

    this.demuxerResult = await this.demuxer.initialize();
    this.log(`Demuxer initialized: ${this.demuxerResult.width}x${this.demuxerResult.height}, ${this.demuxerResult.fps}fps`);

    // 2. Configure decoder
    // IMPORTANT: Keep maxQueueSize low (2) to limit "in-flight" frames
    // Higher values cause frame flooding via async callbacks that overflow
    // the pending queue before backpressure can take effect
    this.decoder = new VideoDecoderService({
      maxQueueSize: 2,
      debug: this.debug,
    });

    const supported = await this.decoder.configure(this.demuxerResult.config);
    if (!supported) {
      throw new Error(`WebCodecs codec not supported: ${this.demuxerResult.config.codec}`);
    }

    // 3. Initialize buffer
    this.buffer = new DecodedFrameBuffer({
      frameRate: this.demuxerResult.fps,
      maxFrames: 16, // Per validation
      debug: this.debug,
    });

    // 4. Wire decoder output to buffer (with pending queue for backpressure)
    this.decoder.setFrameCallback((frame) => {
      // Check if we're aborting (don't add frames during shutdown)
      if (this.decodeAheadAbort) {
        frame.close();
        return;
      }

      // Get the decode index for this frame (frames arrive in decode order)
      const decodeIndex = this.nextDecodeIndex++;

      // Try to add to buffer first, use pending queue as overflow
      if (this.buffer!.isFull()) {
        // Buffer full - use pending queue with decode index
        if (this.pendingFrames.length < this.maxPendingFrames) {
          this.pendingFrames.push([frame, decodeIndex]);
          this.log(`Queued pending frame ${decodeIndex} at ${frame.timestamp}µs (${this.pendingFrames.length} pending)`);
        } else {
          // Both buffer and pending queue full - this indicates backpressure failure
          this.log(`ERROR: Dropping frame ${decodeIndex} at ${frame.timestamp}µs - both buffer and pending queue full`);
          frame.close();
          return;
        }
        // Don't notify waiters for pending frames - they'll be notified when drained to buffer
      } else {
        this.buffer!.addFrame(frame, decodeIndex);
        // Notify ALL waiters when any frame is added to buffer
        this.notifyAllWaiters();
      }
    });

    // 5. Wire decoder error callback to propagate async errors
    this.decoder.setErrorCallback((error) => {
      this.log('Decoder error callback:', error.message);
      this.decodeError = error;
      // Notify all waiters so they can check decodeError and throw
      this.notifyAllWaiters();
    });

    // 6. Start decode-ahead loop
    this.startDecodeAhead();

    // Calculate effective duration using TrimTimeMapper
    const effectiveDuration = this.trimMapper.getEffectiveDuration(this.demuxerResult.duration);

    this.log(`Initialized: effective duration ${effectiveDuration.toFixed(2)}s (${this.trimMapper.getTotalTrimDurationSec().toFixed(2)}s trimmed)`);

    return {
      width: this.demuxerResult.width,
      height: this.demuxerResult.height,
      duration: effectiveDuration,
      mode: 'webcodecs',
    };
  }

  async getFrame(frameIndex: number, effectiveTimeMs: number): Promise<VideoFrame> {
    if (!this.buffer || !this.demuxerResult) {
      throw new Error('WebCodecsFrameSource not initialized');
    }

    // Check for decoder error before attempting to get frame
    this.throwIfError();

    const startTime = performance.now();

    // Map effective time to source time (accounting for trims)
    const sourceTimeMs = this.trimMapper.mapEffectiveToSourceTime(effectiveTimeMs);

    // Wait for frame to be available in buffer
    while (!this.buffer.hasFrame(frameIndex)) {
      // Check if decode-ahead already completed BEFORE waiting
      // This prevents deadlock when waiter is added after notifyAllWaiters() was called
      if (this.decodeAheadTask === null) {
        // Source video exhausted - return clone of last frame if available
        // This handles when export frame rate > source frame rate
        if (this.lastFrame && frameIndex >= this.totalDecodedFrames) {
          this.log(`Frame ${frameIndex} beyond source (${this.totalDecodedFrames} frames), returning last frame clone`);
          // Clone the last frame to return (VideoFrame can only be consumed once)
          return this.cloneFrame(this.lastFrame);
        }
        throw new Error(`Frame ${frameIndex} not available (decode completed with ${this.totalDecodedFrames} frames, source time: ${sourceTimeMs.toFixed(1)}ms)`);
      }

      await this.waitForFrame(frameIndex);

      // Check for decoder error after waiting
      this.throwIfError();
    }

    // Consume frame from buffer
    const frame = this.buffer.consumeFrame(frameIndex);
    if (!frame) {
      throw new Error(`Frame ${frameIndex} disappeared from buffer`);
    }

    // Cache this frame as potential last frame (for hold-last-frame when source exhausted)
    // Close previous cached frame if exists
    if (this.lastFrame) {
      this.lastFrame.close();
    }
    this.lastFrame = this.cloneFrame(frame);

    // Drain pending frames into buffer now that there's space
    this.drainPendingFrames();

    // Update stats
    const retrievalTime = performance.now() - startTime;
    this.framesRetrieved++;
    this.totalRetrievalTime += retrievalTime;
    this.peakRetrievalTime = Math.max(this.peakRetrievalTime, retrievalTime);

    if (this.debug && frameIndex % 60 === 0) {
      this.log(`Frame ${frameIndex}: ${retrievalTime.toFixed(1)}ms, buffer: ${this.buffer.size}`);
    }

    return frame;
  }

  destroy(): void {
    this.log('Destroying WebCodecs frame source');

    // Stop decode-ahead
    this.decodeAheadAbort = true;

    // Flush decoder before closing (ensures pending frames are processed)
    if (this.decoder && this.decoder.getState() === 'configured') {
      try {
        // Use sync close, any pending frames will be lost but we're destroying anyway
        this.decoder.close();
      } catch {
        // Ignore errors during cleanup
      }
      this.decoder = null;
    }

    // Destroy buffer (closes remaining frames)
    if (this.buffer) {
      this.buffer.destroy();
      this.buffer = null;
    }

    // Destroy demuxer
    if (this.demuxer) {
      this.demuxer.destroy();
      this.demuxer = null;
    }

    // Close pending frames to release GPU memory
    for (const [frame] of this.pendingFrames) {
      try {
        frame.close();
      } catch {
        // Frame may already be closed
      }
    }
    this.pendingFrames = [];
    this.nextDecodeIndex = 0;
    this.totalDecodedFrames = 0;

    // Close cached last frame
    if (this.lastFrame) {
      try {
        this.lastFrame.close();
      } catch {
        // Frame may already be closed
      }
      this.lastFrame = null;
    }

    // Notify all waiters so they can exit (they will check decodeError or return immediately)
    this.notifyAllWaiters();

    // Resolve pending space waiters to avoid deadlock
    for (const resolve of this.pendingWaiters) {
      resolve();
    }
    this.pendingWaiters = [];

    this.decodeAheadTask = null;
    this.demuxerResult = null;
    this.decodeError = null;
  }

  getStats(): FrameSourceStats {
    return {
      framesRetrieved: this.framesRetrieved,
      averageRetrievalTime: this.framesRetrieved > 0
        ? this.totalRetrievalTime / this.framesRetrieved
        : 0,
      peakRetrievalTime: this.peakRetrievalTime,
      modeStats: {
        decoder: this.decoder?.getStats() ?? null,
        buffer: this.buffer?.getStats() ?? null,
        pendingQueueSize: this.pendingFrames.length,
        pendingQueueMax: this.maxPendingFrames,
      },
    };
  }

  /**
   * Start the decode-ahead loop.
   * Proactively decodes frames into buffer to stay ahead of consumption.
   */
  private startDecodeAhead(): void {
    if (!this.demuxer || !this.decoder || !this.buffer) {
      return;
    }

    this.decodeAheadAbort = false;

    this.decodeAheadTask = (async () => {
      this.log('Starting decode-ahead loop');

      try {
        const chunks = this.demuxer!.getChunksFromTimestamp(0);

        for await (const chunk of chunks) {
          // Check for abort
          if (this.decodeAheadAbort) {
            this.log('Decode-ahead aborted');
            break;
          }

          // Backpressure: wait for space in buffer OR pending queue
          await this.waitForFrameSpace();

          // Check for abort again after waiting
          if (this.decodeAheadAbort) {
            break;
          }

          // Decode chunk (decoder has its own backpressure)
          await this.decoder!.decode(chunk);
        }

        // Flush decoder to get final frames
        if (!this.decodeAheadAbort && this.decoder) {
          await this.decoder.flush();
        }

        // Record total decoded frames for end-of-video handling
        this.totalDecodedFrames = this.nextDecodeIndex;
        this.log(`Decode-ahead complete: ${this.totalDecodedFrames} frames decoded`);
      } catch (error) {
        // Store error to propagate to getFrame() callers
        this.decodeError = error instanceof Error ? error : new Error(String(error));
        this.log('Decode-ahead error:', error);
      } finally {
        this.decodeAheadTask = null;
        // Notify all remaining waiters to unblock (they will check decodeError)
        this.notifyAllWaiters();
      }
    })();
  }

  /**
   * Check if we can accept more frames (buffer + pending with headroom for in-flight)
   *
   * We need significant headroom because decoder callbacks fire asynchronously in bursts.
   * The decoder pipeline has multiple stages: queued chunks + actively decoding chunk.
   * All these can fire callbacks rapidly between our checks.
   *
   * With decoder queue=2 and 1 actively decoding, up to 6+ frames can arrive in a burst.
   * We use headroom of 10 to be safe.
   */
  private canAcceptFrame(): boolean {
    if (!this.buffer) return false;
    const totalFrames = this.buffer.size + this.pendingFrames.length;
    const totalCapacity = this.buffer.getStats().maxSize + this.maxPendingFrames;
    // Reserve 10 slots for in-flight frames (decoder burst can be 6+ frames)
    const headroom = 10;
    return totalFrames <= totalCapacity - headroom;
  }

  /**
   * Wait for space to accept a new frame (in buffer or pending queue).
   * Returns immediately if space available, otherwise waits until frame consumed.
   */
  private async waitForFrameSpace(): Promise<void> {
    if (this.canAcceptFrame()) {
      return;
    }

    this.log(`Waiting for frame space (buffer: ${this.buffer?.size}/${this.buffer?.getStats().maxSize}, pending: ${this.pendingFrames.length}/${this.maxPendingFrames})`);

    return new Promise<void>(resolve => {
      this.pendingWaiters.push(resolve);
    });
  }

  /**
   * Notify pending waiters when frame space becomes available
   */
  private notifyPendingWaiters(): void {
    while (this.pendingWaiters.length > 0 && this.canAcceptFrame()) {
      const resolve = this.pendingWaiters.shift()!;
      resolve();
    }
  }

  /**
   * Drain pending frames into buffer when space becomes available.
   * Called after consuming a frame from buffer.
   */
  private drainPendingFrames(): void {
    let drained = false;
    while (this.pendingFrames.length > 0 && !this.buffer!.isFull()) {
      const [frame, decodeIndex] = this.pendingFrames.shift()!;
      this.buffer!.addFrame(frame, decodeIndex);
      this.log(`Drained pending frame ${decodeIndex} at ${frame.timestamp}µs to buffer (${this.pendingFrames.length} remaining)`);
      drained = true;
    }
    // Notify ALL waiters if any frames were drained to buffer
    if (drained) {
      this.notifyAllWaiters();
    }
    // Notify decode-ahead that there's space now
    this.notifyPendingWaiters();
  }

  /**
   * Notify all waiting promises to unblock them (on error or completion)
   */
  private notifyAllWaiters(): void {
    for (const waiters of this.frameWaiters.values()) {
      for (const resolve of waiters) {
        resolve();
      }
    }
    this.frameWaiters.clear();
  }

  /**
   * Wait for a specific frame to become available
   * @param frameIndex - Frame index to wait for
   */
  private waitForFrame(frameIndex: number): Promise<void> {
    return new Promise<void>((resolve) => {
      // Key by frame index for exact matching (no fuzzy timestamp issues)
      if (!this.frameWaiters.has(frameIndex)) {
        this.frameWaiters.set(frameIndex, []);
      }
      this.frameWaiters.get(frameIndex)!.push(resolve);
    });
  }

  /**
   * Throw if a decode error has occurred
   */
  private throwIfError(): void {
    if (this.decodeError !== null) {
      throw new Error(`Decoder failed: ${this.decodeError.message}`);
    }
  }

  /**
   * Clone a VideoFrame for reuse (e.g., hold-last-frame when source exhausted)
   */
  private cloneFrame(frame: VideoFrame): VideoFrame {
    return new VideoFrame(frame, {
      timestamp: frame.timestamp,
      duration: frame.duration ?? undefined,
    });
  }

  /**
   * Debug logging helper
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[WebCodecsFrameSource]', ...args);
    }
  }
}
