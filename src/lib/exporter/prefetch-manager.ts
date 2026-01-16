/**
 * Prefetch manager for double-buffered video frame extraction.
 * Uses two video elements: one for current frame, one for prefetching next.
 *
 * Key benefits:
 * - Overlaps seek latency (~50-100ms) with rendering
 * - Eliminates sequential seek-wait-render blocking
 * - Handles trim region mapping automatically
 */

import type { TrimRegion } from '@/components/video-editor/types';

export interface PrefetchConfig {
  /** Video source URL */
  videoUrl: string;
  /** Sorted trim regions to skip */
  trimRegions?: TrimRegion[];
  /** Target frame rate */
  frameRate: number;
  /** Enable debug logging */
  debug?: boolean;
}

interface SeekResult {
  videoElement: HTMLVideoElement;
  timestamp: number;
}

// Default seek timeout in milliseconds
const SEEK_TIMEOUT_MS = 5000;

export class PrefetchManager {
  private videoA: HTMLVideoElement | null = null;
  private videoB: HTMLVideoElement | null = null;
  private currentElement: 'A' | 'B' = 'A';
  private prefetchPromise: Promise<SeekResult> | null = null;
  private prefetchedFrame: number = -1;
  private readonly config: PrefetchConfig;
  private readonly debug: boolean;
  private isInitialized = false;
  // Abort controller for cancelling pending operations
  private abortController: AbortController | null = null;

  // Performance tracking
  private seekCount = 0;
  private prefetchHits = 0;
  private prefetchMisses = 0;

  constructor(config: PrefetchConfig) {
    this.config = config;
    this.debug = config.debug ?? false;
  }

  /**
   * Initialize both video elements with the same source.
   * Returns video metadata once loaded.
   */
  async initialize(): Promise<{ width: number; height: number; duration: number }> {
    const createVideoElement = (): Promise<HTMLVideoElement> => {
      return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.src = this.config.videoUrl;
        video.preload = 'auto';
        video.muted = true;

        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
          resolve(video);
        };

        const onError = (e: Event) => {
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
          reject(new Error(`Failed to load video: ${e}`));
        };

        video.addEventListener('loadedmetadata', onLoaded);
        video.addEventListener('error', onError);
      });
    };

    // Initialize both video elements in parallel
    const [videoA, videoB] = await Promise.all([
      createVideoElement(),
      createVideoElement(),
    ]);

    this.videoA = videoA;
    this.videoB = videoB;
    this.isInitialized = true;
    this.abortController = new AbortController();

    if (this.debug) {
      console.log('[PrefetchManager] Initialized dual video elements');
    }

    return {
      width: videoA.videoWidth,
      height: videoA.videoHeight,
      duration: videoA.duration,
    };
  }

  /**
   * Get the current video element (already seeked to requested frame).
   * If prefetch hit, returns immediately. Otherwise, seeks synchronously.
   */
  async getFrame(frameIndex: number, effectiveTimeMs: number): Promise<HTMLVideoElement> {
    if (!this.isInitialized || !this.videoA || !this.videoB) {
      throw new Error('PrefetchManager not initialized');
    }

    const sourceTimeMs = this.mapEffectiveToSourceTime(effectiveTimeMs);
    const videoTime = sourceTimeMs / 1000;

    // Check if we have a prefetch hit
    if (this.prefetchedFrame === frameIndex && this.prefetchPromise) {
      const result = await this.prefetchPromise;
      this.prefetchHits++;
      this.prefetchPromise = null;

      if (this.debug) {
        console.log(`[PrefetchManager] Prefetch HIT for frame ${frameIndex}`);
      }

      // Verify video is in valid state for VideoFrame creation
      // readyState >= 2 (HAVE_CURRENT_DATA) means we have frame data
      if (result.videoElement.readyState < 2) {
        console.warn(`[PrefetchManager] Prefetch hit but video not ready (readyState=${result.videoElement.readyState}), re-seeking`);
        await this.seekTo(result.videoElement, videoTime);
        await this.waitForVideoReady(result.videoElement);
      }

      // Start prefetching next frame on the other element
      this.startPrefetch(frameIndex + 1);

      return result.videoElement;
    }

    // Prefetch miss - need to seek synchronously
    this.prefetchMisses++;
    this.prefetchPromise = null;

    if (this.debug) {
      console.log(`[PrefetchManager] Prefetch MISS for frame ${frameIndex}`);
    }

    const currentVideo = this.currentElement === 'A' ? this.videoA : this.videoB;
    await this.seekTo(currentVideo, videoTime);

    // Ensure video is ready for VideoFrame creation
    if (currentVideo.readyState < 2) {
      await this.waitForVideoReady(currentVideo);
    }

    // Start prefetching next frame on the other element
    this.startPrefetch(frameIndex + 1);

    return currentVideo;
  }

  /**
   * Wait for video to have enough data for frame extraction.
   */
  private async waitForVideoReady(video: HTMLVideoElement, timeoutMs = 2000): Promise<void> {
    if (video.readyState >= 2) return;

    return new Promise<void>((resolve) => {
      const startTime = Date.now();

      const checkReady = () => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        if (Date.now() - startTime > timeoutMs) {
          console.warn('[PrefetchManager] Timeout waiting for video ready');
          resolve();
          return;
        }
        requestAnimationFrame(checkReady);
      };

      checkReady();
    });
  }

  /**
   * Start prefetching a frame on the alternate video element.
   */
  private startPrefetch(frameIndex: number): void {
    if (!this.videoA || !this.videoB) return;

    const timeStep = 1 / this.config.frameRate;
    const effectiveTimeMs = frameIndex * timeStep * 1000;
    const sourceTimeMs = this.mapEffectiveToSourceTime(effectiveTimeMs);
    const videoTime = sourceTimeMs / 1000;

    // Use the alternate element for prefetching
    const prefetchElement = this.currentElement === 'A' ? this.videoB : this.videoA;

    // Check if video time is within bounds
    if (videoTime > prefetchElement.duration) {
      this.prefetchedFrame = -1;
      this.prefetchPromise = null;
      return;
    }

    this.prefetchedFrame = frameIndex;
    this.prefetchPromise = this.seekTo(prefetchElement, videoTime).then(() => {
      // Swap current element for next frame
      this.currentElement = this.currentElement === 'A' ? 'B' : 'A';
      return {
        videoElement: prefetchElement,
        timestamp: videoTime,
      };
    });
  }

  /**
   * Seek video element to specified time and wait for seeked event.
   * Includes timeout to prevent deadlock on problematic videos.
   */
  private async seekTo(video: HTMLVideoElement, time: number): Promise<void> {
    // Skip seek if already at the right time
    if (Math.abs(video.currentTime - time) < 0.001) {
      return;
    }

    this.seekCount++;

    return new Promise<void>((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
      };

      const onSeeked = () => {
        cleanup();
        resolve();
      };

      const onError = (e: Event) => {
        cleanup();
        // Resolve instead of reject to avoid breaking export on transient errors
        console.warn(`[PrefetchManager] Seek error at ${time}s:`, e);
        resolve();
      };

      // Timeout to prevent deadlock on bad videos
      timeoutId = setTimeout(() => {
        cleanup();
        console.warn(`[PrefetchManager] Seek timeout at ${time}s (${SEEK_TIMEOUT_MS}ms)`);
        resolve(); // Resolve to continue export, frame may be stale
      }, SEEK_TIMEOUT_MS);

      // Handle abort signal
      if (this.abortController?.signal.aborted) {
        cleanup();
        resolve();
        return;
      }

      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);
      video.currentTime = time;
    });
  }

  /**
   * Map effective time (excluding trims) to source time (with trims).
   */
  private mapEffectiveToSourceTime(effectiveTimeMs: number): number {
    const trimRegions = this.config.trimRegions || [];
    const sortedTrims = [...trimRegions].sort((a, b) => a.startMs - b.startMs);

    let sourceTimeMs = effectiveTimeMs;

    for (const trim of sortedTrims) {
      if (sourceTimeMs < trim.startMs) {
        break;
      }
      const trimDuration = trim.endMs - trim.startMs;
      sourceTimeMs += trimDuration;
    }

    return sourceTimeMs;
  }

  /**
   * Get the primary video element (for initial frame extraction).
   */
  getPrimaryElement(): HTMLVideoElement | null {
    return this.videoA;
  }

  /**
   * Get performance statistics.
   */
  getStats(): {
    seekCount: number;
    prefetchHits: number;
    prefetchMisses: number;
    hitRate: number;
  } {
    const total = this.prefetchHits + this.prefetchMisses;
    return {
      seekCount: this.seekCount,
      prefetchHits: this.prefetchHits,
      prefetchMisses: this.prefetchMisses,
      hitRate: total > 0 ? this.prefetchHits / total : 0,
    };
  }

  /**
   * Destroy and clean up resources.
   * Aborts any pending prefetch operations to prevent memory leaks.
   */
  destroy(): void {
    // Abort any pending seek/prefetch operations
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.videoA) {
      this.videoA.pause();
      this.videoA.src = '';
      this.videoA = null;
    }

    if (this.videoB) {
      this.videoB.pause();
      this.videoB.src = '';
      this.videoB = null;
    }

    this.prefetchPromise = null;
    this.prefetchedFrame = -1;
    this.isInitialized = false;

    if (this.debug) {
      console.log('[PrefetchManager] Destroyed');
    }
  }
}
