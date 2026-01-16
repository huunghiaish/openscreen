/**
 * Render coordinator that orchestrates parallel frame rendering.
 * Connects: PrefetchManager → WorkerPool → FrameReassembler → Encoder
 *
 * Key features:
 * - Distributes frames to worker pool (4 workers)
 * - Collects rendered frames in order via reassembler
 * - Manages backpressure with encode queue
 * - Provides fallback to single-threaded rendering if workers fail
 */

import { WorkerPool, type WorkerPoolConfig, type WorkerPoolStats } from './worker-pool';
import { FrameReassembler, type ReassemblerStats } from './frame-reassembler';
import { FrameRenderer } from './frameRenderer';
import type { WorkerRenderConfig, WorkerToMainMessage, RenderedWorkerResponse } from './workers/worker-types';
import type { ZoomRegion, CropRegion, AnnotationRegion } from '@/components/video-editor/types';
import type { CameraExportConfig } from './types';

export interface RenderCoordinatorConfig {
  width: number;
  height: number;
  wallpaper: string;
  zoomRegions: ZoomRegion[];
  showShadow: boolean;
  shadowIntensity: number;
  showBlur: boolean;
  motionBlurEnabled?: boolean;
  borderRadius?: number;
  padding?: number;
  cropRegion: CropRegion;
  videoWidth: number;
  videoHeight: number;
  annotationRegions?: AnnotationRegion[];
  previewWidth?: number;
  previewHeight?: number;
  // Camera PiP config
  cameraExport?: CameraExportConfig;
  // Worker pool options
  workerCount?: number;
  debug?: boolean;
}

export interface CoordinatorStats {
  mode: 'parallel' | 'fallback';
  workerPool: WorkerPoolStats | null;
  reassembler: ReassemblerStats;
  pendingFrames: number;
  renderedFrames: number;
}

type FrameCallback = (frame: VideoFrame, frameIndex: number) => Promise<void>;

export class RenderCoordinator {
  private workerPool: WorkerPool | null = null;
  private reassembler: FrameReassembler;
  private fallbackRenderer: FrameRenderer | null = null;
  private config: RenderCoordinatorConfig;
  private isInitialized = false;
  private useParallel = true;
  private frameCallback: FrameCallback | null = null;
  // Track pending render operations
  private pendingRenders = 0;
  private nextFrameIndex = 0;
  private renderedFrames = 0;
  // For waiting on all pending frames
  private pendingResolvers: Array<() => void> = [];

  constructor(config: RenderCoordinatorConfig) {
    this.config = config;
    this.reassembler = new FrameReassembler({
      debug: config.debug,
      maxBufferSize: 32, // Allow some buffering for out-of-order arrivals
    });
  }

  /**
   * Initialize the coordinator.
   * Attempts parallel workers first, falls back to single-threaded if workers fail.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('RenderCoordinator already initialized');
    }

    // Check if Web Workers are supported
    if (typeof Worker === 'undefined') {
      console.warn('[RenderCoordinator] Web Workers not supported, using fallback');
      await this.initializeFallback();
      return;
    }

    // Try to initialize worker pool
    try {
      await this.initializeWorkerPool();
      this.useParallel = true;
      console.log('[RenderCoordinator] Parallel rendering initialized');
    } catch (error) {
      console.warn('[RenderCoordinator] Worker pool init failed, using fallback:', error);
      await this.initializeFallback();
      this.useParallel = false;
    }

    this.isInitialized = true;
  }

  private async initializeWorkerPool(): Promise<void> {
    const workerConfig: WorkerRenderConfig = {
      width: this.config.width,
      height: this.config.height,
      wallpaper: this.config.wallpaper,
      zoomRegions: this.config.zoomRegions,
      showShadow: this.config.showShadow,
      shadowIntensity: this.config.shadowIntensity,
      showBlur: this.config.showBlur,
      motionBlurEnabled: this.config.motionBlurEnabled,
      borderRadius: this.config.borderRadius,
      padding: this.config.padding,
      cropRegion: this.config.cropRegion,
      videoWidth: this.config.videoWidth,
      videoHeight: this.config.videoHeight,
      annotationRegions: this.config.annotationRegions,
      previewWidth: this.config.previewWidth,
      previewHeight: this.config.previewHeight,
    };

    const poolConfig: WorkerPoolConfig = {
      workerCount: this.config.workerCount ?? 4,
      debug: this.config.debug,
    };

    this.workerPool = new WorkerPool(poolConfig);
    this.workerPool.setMessageHandler(this.handleWorkerMessage.bind(this));
    await this.workerPool.initialize(workerConfig);
  }

  private async initializeFallback(): Promise<void> {
    this.fallbackRenderer = new FrameRenderer({
      width: this.config.width,
      height: this.config.height,
      wallpaper: this.config.wallpaper,
      zoomRegions: this.config.zoomRegions,
      showShadow: this.config.showShadow,
      shadowIntensity: this.config.shadowIntensity,
      showBlur: this.config.showBlur,
      motionBlurEnabled: this.config.motionBlurEnabled,
      borderRadius: this.config.borderRadius,
      padding: this.config.padding,
      cropRegion: this.config.cropRegion,
      videoWidth: this.config.videoWidth,
      videoHeight: this.config.videoHeight,
      annotationRegions: this.config.annotationRegions,
      previewWidth: this.config.previewWidth,
      previewHeight: this.config.previewHeight,
      cameraExport: this.config.cameraExport,
    });
    await this.fallbackRenderer.initialize();
  }

  /**
   * Set callback for when frames are ready for encoding.
   * Called with frames in order (frame 0, 1, 2, ...).
   */
  setFrameCallback(callback: FrameCallback): void {
    this.frameCallback = callback;
  }

  private handleWorkerMessage(workerId: number, message: WorkerToMainMessage): void {
    if (message.type === 'rendered') {
      const response = message as RenderedWorkerResponse;
      this.onFrameRendered(response.frameIndex, response.renderedFrame);
    } else if (message.type === 'error') {
      console.error(`[RenderCoordinator] Worker ${workerId} error:`, message.error);
      this.pendingRenders--;
      this.notifyPendingComplete();
    }
  }

  private async onFrameRendered(frameIndex: number, renderedFrame: VideoFrame): Promise<void> {
    this.pendingRenders--;

    // Add to reassembler and get ready frames
    const readyFrames = this.reassembler.addFrame(frameIndex, renderedFrame);

    // Process ready frames through callback
    for (const frame of readyFrames) {
      this.renderedFrames++;
      if (this.frameCallback) {
        await this.frameCallback(frame, this.renderedFrames - 1);
      } else {
        // No callback - close frame to prevent leak
        frame.close();
      }
    }

    this.notifyPendingComplete();
  }

  private notifyPendingComplete(): void {
    if (this.pendingRenders === 0 && this.pendingResolvers.length > 0) {
      for (const resolve of this.pendingResolvers) {
        resolve();
      }
      this.pendingResolvers = [];
    }
  }

  /**
   * Submit a frame for rendering.
   * In parallel mode: distributes to workers
   * In fallback mode: renders synchronously
   *
   * @param videoFrame - VideoFrame from video element (will be transferred to worker)
   * @param timestamp - Frame timestamp in microseconds
   */
  async renderFrame(videoFrame: VideoFrame, timestamp: number): Promise<void> {
    if (!this.isInitialized) {
      videoFrame.close();
      throw new Error('RenderCoordinator not initialized');
    }

    if (this.useParallel && this.workerPool) {
      // Parallel mode: submit to worker pool
      const worker = await this.workerPool.waitForIdleWorker();
      const frameIndex = this.nextFrameIndex++;
      this.pendingRenders++;

      this.workerPool.submitRenderTask(worker, frameIndex, videoFrame, timestamp);
    } else if (this.fallbackRenderer) {
      // Fallback mode: render synchronously
      const frameIndex = this.nextFrameIndex++;

      await this.fallbackRenderer.renderFrame(videoFrame, timestamp);
      videoFrame.close();

      const canvas = this.fallbackRenderer.getCanvas();
      // @ts-expect-error - colorSpace not in TypeScript definitions but works at runtime
      const renderedFrame = new VideoFrame(canvas, {
        timestamp,
        colorSpace: {
          primaries: 'bt709',
          transfer: 'iec61966-2-1',
          matrix: 'rgb',
          fullRange: true,
        },
      });

      await this.onFrameRendered(frameIndex, renderedFrame);
    } else {
      videoFrame.close();
      throw new Error('No renderer available');
    }
  }

  /**
   * Wait for all pending renders to complete.
   * Call this before finalizing export.
   */
  async waitForPending(): Promise<void> {
    if (this.pendingRenders === 0) return;

    return new Promise((resolve) => {
      this.pendingResolvers.push(resolve);
    });
  }

  /**
   * Flush any remaining buffered frames.
   * Call after waitForPending() to get final frames.
   */
  async flush(): Promise<void> {
    const remainingFrames = this.reassembler.flush();

    for (const frame of remainingFrames) {
      this.renderedFrames++;
      if (this.frameCallback) {
        await this.frameCallback(frame, this.renderedFrames - 1);
      } else {
        frame.close();
      }
    }
  }

  /**
   * Check if using parallel rendering mode.
   */
  isParallelMode(): boolean {
    return this.useParallel;
  }

  /**
   * Get coordinator statistics.
   */
  getStats(): CoordinatorStats {
    return {
      mode: this.useParallel ? 'parallel' : 'fallback',
      workerPool: this.workerPool?.getStats() ?? null,
      reassembler: this.reassembler.getStats(),
      pendingFrames: this.pendingRenders,
      renderedFrames: this.renderedFrames,
    };
  }

  /**
   * Shutdown coordinator and clean up resources.
   */
  async shutdown(): Promise<void> {
    // Wait for pending renders
    await this.waitForPending();

    // Flush remaining frames
    await this.flush();

    // Shutdown worker pool
    if (this.workerPool) {
      await this.workerPool.shutdown();
      this.workerPool = null;
    }

    // Destroy fallback renderer
    if (this.fallbackRenderer) {
      this.fallbackRenderer.destroy();
      this.fallbackRenderer = null;
    }

    // Clean up reassembler
    this.reassembler.destroy();

    this.isInitialized = false;
    this.frameCallback = null;
    this.nextFrameIndex = 0;
    this.renderedFrames = 0;
    this.pendingRenders = 0;
    this.pendingResolvers = [];
  }

  /**
   * Force terminate (for error recovery).
   */
  terminate(): void {
    if (this.workerPool) {
      this.workerPool.terminate();
      this.workerPool = null;
    }

    if (this.fallbackRenderer) {
      this.fallbackRenderer.destroy();
      this.fallbackRenderer = null;
    }

    this.reassembler.reset();
    this.isInitialized = false;
    this.frameCallback = null;
  }
}
