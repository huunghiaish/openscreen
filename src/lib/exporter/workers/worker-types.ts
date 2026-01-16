/**
 * Type definitions for worker-based parallel rendering.
 * Shared between main thread and Web Workers.
 */

import type { ZoomRegion, CropRegion, AnnotationRegion, CameraPipConfig } from '@/components/video-editor/types';

/**
 * Configuration passed to worker for PixiJS rendering setup.
 * Excludes DOM-dependent properties from FrameRenderConfig.
 */
export interface WorkerRenderConfig {
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
  // Camera PiP config (rendered in worker)
  cameraPipConfig?: {
    pipConfig: CameraPipConfig;
    videoWidth: number;
    videoHeight: number;
  };
}

/**
 * Messages sent from main thread to worker.
 */
export interface InitWorkerMessage {
  type: 'init';
  workerId: number;
  config: WorkerRenderConfig;
  canvas: OffscreenCanvas;
}

export interface RenderWorkerMessage {
  type: 'render';
  frameIndex: number;
  videoFrame: VideoFrame;
  timestamp: number;
  // Optional: camera frame if PiP enabled
  cameraFrame?: VideoFrame;
}

export interface ShutdownWorkerMessage {
  type: 'shutdown';
}

export type MainToWorkerMessage = InitWorkerMessage | RenderWorkerMessage | ShutdownWorkerMessage;

/**
 * Messages sent from worker to main thread.
 */
export interface ReadyWorkerResponse {
  type: 'ready';
  workerId: number;
}

export interface RenderedWorkerResponse {
  type: 'rendered';
  frameIndex: number;
  workerId: number;
  renderedFrame: VideoFrame;
}

export interface ErrorWorkerResponse {
  type: 'error';
  frameIndex?: number;
  workerId: number;
  error: string;
}

export interface ShutdownCompleteResponse {
  type: 'shutdown_complete';
  workerId: number;
}

export type WorkerToMainMessage =
  | ReadyWorkerResponse
  | RenderedWorkerResponse
  | ErrorWorkerResponse
  | ShutdownCompleteResponse;
