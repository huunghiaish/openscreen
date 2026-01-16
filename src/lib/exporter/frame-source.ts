/**
 * FrameSource Interface
 *
 * Abstraction for frame extraction that can be backed by either:
 * - WebCodecs VideoDecoder (fast, <5ms per frame)
 * - HTMLVideoElement seek (fallback, ~100ms per frame)
 *
 * Enables seamless switching between implementations and maintains
 * backward compatibility with existing export pipeline.
 */

import type { TrimRegion } from '@/components/video-editor/types';

/**
 * Configuration for creating a FrameSource
 */
export interface FrameSourceConfig {
  /** URL to the video file */
  videoUrl: string;
  /** Target frame rate for export */
  frameRate: number;
  /** Trim regions to exclude from export */
  trimRegions?: TrimRegion[];
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Result returned after FrameSource initialization
 */
export interface FrameSourceResult {
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
  /** Effective duration in seconds (excluding trims) */
  duration: number;
  /** Which frame source mode is active */
  mode: 'webcodecs' | 'htmlvideo';
}

/**
 * Statistics for FrameSource performance monitoring
 */
export interface FrameSourceStats {
  /** Total frames retrieved */
  framesRetrieved: number;
  /** Average frame retrieval time in milliseconds */
  averageRetrievalTime: number;
  /** Peak frame retrieval time in milliseconds */
  peakRetrievalTime: number;
  /** Mode-specific stats */
  modeStats: Record<string, unknown>;
}

/**
 * FrameSource interface for abstracting frame extraction
 *
 * ## VideoFrame Ownership Contract
 *
 * The returned VideoFrame is TRANSFERRED to the caller:
 * - Caller MUST call frame.close() when done to release GPU memory
 * - FrameSource will NOT close the frame
 * - Failure to close frames will cause GPU memory exhaustion
 *
 * ## Implementation Requirements
 * - Return VideoFrames that the caller owns (caller must call close())
 * - Handle trim region mapping internally
 * - Provide consistent behavior regardless of backing implementation
 */
export interface FrameSource {
  /**
   * Initialize the frame source
   * @returns Result with video metadata and active mode
   */
  initialize(): Promise<FrameSourceResult>;

  /**
   * Get a frame at the given index
   *
   * **OWNERSHIP:** The returned VideoFrame is transferred to the caller.
   * Caller MUST call `frame.close()` when done to release GPU memory.
   *
   * @param frameIndex - Sequential frame number (0-based)
   * @param effectiveTimeMs - Effective time in milliseconds (excluding trims)
   * @returns VideoFrame (caller owns, caller must close())
   */
  getFrame(frameIndex: number, effectiveTimeMs: number): Promise<VideoFrame>;

  /**
   * Release all resources
   */
  destroy(): void;

  /**
   * Get performance statistics
   */
  getStats(): FrameSourceStats;
}

/**
 * Create a FrameSource with automatic WebCodecs/HTMLVideoElement selection
 *
 * Tries WebCodecs first for optimal performance (<5ms per frame).
 * Falls back to HTMLVideoElement if:
 * - WebCodecs API is not available
 * - Codec is not supported
 * - Initialization fails
 *
 * @param config - Frame source configuration
 * @returns Initialized FrameSource ready for frame extraction
 */
export async function createFrameSource(config: FrameSourceConfig): Promise<{ source: FrameSource; result: FrameSourceResult }> {
  const debug = config.debug ?? false;

  // Check if WebCodecs VideoDecoder is available
  if (typeof VideoDecoder !== 'undefined') {
    try {
      // Dynamically import to avoid bundling issues if WebCodecs unavailable
      const { WebCodecsFrameSource } = await import('./webcodecs-frame-source');
      const source = new WebCodecsFrameSource(config);
      const result = await source.initialize();

      if (debug) {
        console.log('[createFrameSource] Using WebCodecs frame source');
      }

      return { source, result };
    } catch (error) {
      if (debug) {
        console.warn('[createFrameSource] WebCodecs failed, falling back to HTMLVideo:', error);
      }
    }
  } else if (debug) {
    console.log('[createFrameSource] WebCodecs not available, using HTMLVideo fallback');
  }

  // Fallback to HTMLVideoElement
  const { HTMLVideoFrameSource } = await import('./htmlvideo-frame-source');
  const source = new HTMLVideoFrameSource(config);
  const result = await source.initialize();

  if (debug) {
    console.log('[createFrameSource] Using HTMLVideo frame source (fallback)');
  }

  return { source, result };
}
