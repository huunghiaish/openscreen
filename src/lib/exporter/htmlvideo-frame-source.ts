/**
 * HTMLVideo Frame Source
 *
 * Fallback frame extraction using HTMLVideoElement seek.
 * Wraps the existing PrefetchManager to provide FrameSource interface.
 *
 * Used when:
 * - WebCodecs VideoDecoder is not available
 * - Codec is not supported by WebCodecs
 *
 * Performance: ~100-140ms per frame (due to seek latency)
 */

import type { FrameSource, FrameSourceConfig, FrameSourceResult, FrameSourceStats } from './frame-source';
import { PrefetchManager } from './prefetch-manager';

/**
 * HTMLVideoFrameSource - Fallback frame extraction using HTMLVideoElement
 *
 * Wraps PrefetchManager with FrameSource interface for consistent API.
 * Creates VideoFrames from video element for compatibility with the pipeline.
 */
export class HTMLVideoFrameSource implements FrameSource {
  private readonly config: FrameSourceConfig;
  private readonly debug: boolean;

  // PrefetchManager for video element handling
  private prefetchManager: PrefetchManager | null = null;

  // Video metadata
  private videoWidth = 0;
  private videoHeight = 0;
  private videoDuration = 0;

  // Frame rate for timestamp calculation
  private frameRate: number;

  // Statistics
  private framesRetrieved = 0;
  private totalRetrievalTime = 0;
  private peakRetrievalTime = 0;

  constructor(config: FrameSourceConfig) {
    this.config = config;
    this.debug = config.debug ?? false;
    this.frameRate = config.frameRate;
  }

  async initialize(): Promise<FrameSourceResult> {
    this.log('Initializing HTMLVideo frame source (fallback)');

    // Create and initialize PrefetchManager
    this.prefetchManager = new PrefetchManager({
      videoUrl: this.config.videoUrl,
      trimRegions: this.config.trimRegions,
      frameRate: this.config.frameRate,
      debug: this.debug,
    });

    const videoInfo = await this.prefetchManager.initialize();

    this.videoWidth = videoInfo.width;
    this.videoHeight = videoInfo.height;
    this.videoDuration = videoInfo.duration;

    // Calculate effective duration (excluding trims)
    const trimRegions = this.config.trimRegions || [];
    const totalTrimDuration = trimRegions.reduce(
      (sum, region) => sum + (region.endMs - region.startMs) / 1000,
      0
    );
    const effectiveDuration = this.videoDuration - totalTrimDuration;

    this.log(`Initialized: ${this.videoWidth}x${this.videoHeight}, effective duration ${effectiveDuration.toFixed(2)}s`);

    return {
      width: this.videoWidth,
      height: this.videoHeight,
      duration: effectiveDuration,
      mode: 'htmlvideo',
    };
  }

  async getFrame(frameIndex: number, effectiveTimeMs: number): Promise<VideoFrame> {
    if (!this.prefetchManager) {
      throw new Error('HTMLVideoFrameSource not initialized');
    }

    const startTime = performance.now();

    // Get video element with frame seeked (PrefetchManager handles trim mapping)
    const videoElement = await this.prefetchManager.getFrame(frameIndex, effectiveTimeMs);

    // Calculate timestamp in microseconds
    const timestamp = (frameIndex / this.frameRate) * 1_000_000;

    // Create VideoFrame from video element
    const frame = new VideoFrame(videoElement, { timestamp });

    // Update stats
    const retrievalTime = performance.now() - startTime;
    this.framesRetrieved++;
    this.totalRetrievalTime += retrievalTime;
    this.peakRetrievalTime = Math.max(this.peakRetrievalTime, retrievalTime);

    if (this.debug && frameIndex % 60 === 0) {
      this.log(`Frame ${frameIndex}: ${retrievalTime.toFixed(1)}ms`);
    }

    return frame;
  }

  destroy(): void {
    this.log('Destroying HTMLVideo frame source');

    if (this.prefetchManager) {
      this.prefetchManager.destroy();
      this.prefetchManager = null;
    }
  }

  getStats(): FrameSourceStats {
    return {
      framesRetrieved: this.framesRetrieved,
      averageRetrievalTime: this.framesRetrieved > 0
        ? this.totalRetrievalTime / this.framesRetrieved
        : 0,
      peakRetrievalTime: this.peakRetrievalTime,
      modeStats: {
        prefetch: this.prefetchManager?.getStats() ?? null,
      },
    };
  }

  /**
   * Debug logging helper
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[HTMLVideoFrameSource]', ...args);
    }
  }
}
