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
  // Track decoded frame indices for waiter notification
  private lastDecodedFrameIndex = -1;

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
    this.decoder = new VideoDecoderService({
      maxQueueSize: 8,
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

    // 4. Wire decoder output to buffer
    this.decoder.setFrameCallback((frame) => {
      this.buffer!.addFrame(frame);
      // Convert timestamp to frame index and notify waiters
      this.lastDecodedFrameIndex++;
      this.notifyFrameWaiters(this.lastDecodedFrameIndex);
    });

    // 5. Start decode-ahead loop
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
      await this.waitForFrame(frameIndex);

      // Check for decoder error after waiting (re-check since async operation may have set it)
      this.throwIfError();

      // Safety check: if decode-ahead completed and frame still not found
      if (this.decodeAheadTask === null && !this.buffer.hasFrame(frameIndex)) {
        throw new Error(`Frame ${frameIndex} not available (decode completed, source time: ${sourceTimeMs.toFixed(1)}ms)`);
      }
    }

    // Consume frame from buffer
    const frame = this.buffer.consumeFrame(frameIndex);
    if (!frame) {
      throw new Error(`Frame ${frameIndex} disappeared from buffer`);
    }

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

    // Notify all waiters so they can exit (they will check decodeError or return immediately)
    this.notifyAllWaiters();

    this.decodeAheadTask = null;
    this.demuxerResult = null;
    this.decodeError = null;
    this.lastDecodedFrameIndex = -1;
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

          // Backpressure: wait for buffer space
          await this.buffer!.waitForSpace();

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

        this.log('Decode-ahead complete');
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
   * Notify waiters when a frame arrives
   * @param decodedFrameIndex - Index of the frame that was just decoded
   */
  private notifyFrameWaiters(decodedFrameIndex: number): void {
    // Notify exact match for this frame index
    const waiters = this.frameWaiters.get(decodedFrameIndex);
    if (waiters && waiters.length > 0) {
      for (const resolve of waiters) {
        resolve();
      }
      this.frameWaiters.delete(decodedFrameIndex);
    }

    // Also notify waiters for earlier frames (in case of out-of-order processing)
    // This handles edge cases where frames arrive slightly out of order
    for (const [idx, idxWaiters] of this.frameWaiters.entries()) {
      if (idx <= decodedFrameIndex && idxWaiters.length > 0) {
        for (const resolve of idxWaiters) {
          resolve();
        }
        this.frameWaiters.delete(idx);
      }
    }
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
   * Debug logging helper
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[WebCodecsFrameSource]', ...args);
    }
  }
}
