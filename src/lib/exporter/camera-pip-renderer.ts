import { CAMERA_PIP_SIZE_PRESETS } from '@/components/video-editor/types';
import type { CameraExportConfig } from './types';

/**
 * Handles camera PiP (Picture-in-Picture) video loading, frame extraction,
 * and compositing for video/GIF export.
 */
export class CameraPipRenderer {
  private cameraVideo: HTMLVideoElement | null = null;
  private cameraCanvas: HTMLCanvasElement | null = null;
  private cameraCtx: CanvasRenderingContext2D | null = null;
  private config: CameraExportConfig;

  constructor(config: CameraExportConfig) {
    this.config = config;
  }

  /**
   * Initialize camera video element and offscreen canvas for frame extraction.
   * Loads video metadata before returning.
   */
  async initialize(): Promise<boolean> {
    if (!this.config.videoUrl) return false;

    // Create camera video element
    this.cameraVideo = document.createElement('video');
    this.cameraVideo.src = this.config.videoUrl;
    this.cameraVideo.muted = true;
    this.cameraVideo.playsInline = true;
    this.cameraVideo.preload = 'metadata';

    // Wait for metadata to load
    try {
      await new Promise<void>((resolve, reject) => {
        this.cameraVideo!.onloadedmetadata = () => resolve();
        this.cameraVideo!.onerror = () => reject(new Error('Failed to load camera video'));
      });
    } catch (error) {
      console.error('[CameraPipRenderer] Failed to load camera video:', error);
      this.destroy();
      return false;
    }

    // Create offscreen canvas for camera frame extraction
    this.cameraCanvas = document.createElement('canvas');
    this.cameraCanvas.width = this.cameraVideo.videoWidth;
    this.cameraCanvas.height = this.cameraVideo.videoHeight;
    this.cameraCtx = this.cameraCanvas.getContext('2d');

    if (!this.cameraCtx) {
      console.warn('[CameraPipRenderer] Failed to get 2D context for camera canvas');
      this.destroy();
      return false;
    }

    console.log(
      `[CameraPipRenderer] Initialized: ${this.cameraVideo.videoWidth}x${this.cameraVideo.videoHeight}, ` +
      `duration: ${this.cameraVideo.duration}s`
    );
    return true;
  }

  /**
   * Check if camera PiP renderer is ready for rendering.
   */
  isReady(): boolean {
    return !!(this.cameraVideo && this.cameraCanvas && this.cameraCtx && this.config.pipConfig.enabled);
  }

  /**
   * Get camera video duration in seconds.
   */
  getDuration(): number {
    return this.cameraVideo?.duration ?? 0;
  }

  /**
   * Render camera PiP overlay onto the provided canvas context at the specified time.
   * @param ctx - Target canvas context to draw on
   * @param canvasWidth - Target canvas width
   * @param canvasHeight - Target canvas height
   * @param timeMs - Current time in milliseconds
   */
  async render(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    timeMs: number
  ): Promise<void> {
    if (!this.isReady()) return;
    if (!this.cameraVideo || !this.cameraCanvas || !this.cameraCtx) return;

    const { position, size, borderRadius } = this.config.pipConfig;

    // Seek camera to correct time
    const timeSeconds = timeMs / 1000;
    if (timeSeconds > this.cameraVideo.duration) {
      // Camera video ended, don't render PiP
      return;
    }

    this.cameraVideo.currentTime = timeSeconds;
    await new Promise<void>((resolve) => {
      this.cameraVideo!.onseeked = () => resolve();
    });

    // Draw camera frame to its canvas
    this.cameraCtx.drawImage(this.cameraVideo, 0, 0);

    // Calculate PiP size and position for export resolution
    const sizePercent = CAMERA_PIP_SIZE_PRESETS[size] / 100;
    const pipSize = Math.round(canvasWidth * sizePercent);
    const margin = Math.round(canvasWidth * 0.02); // 2% margin

    let x: number, y: number;
    switch (position) {
      case 'top-left':
        x = margin;
        y = margin;
        break;
      case 'top-right':
        x = canvasWidth - pipSize - margin;
        y = margin;
        break;
      case 'bottom-left':
        x = margin;
        y = canvasHeight - pipSize - margin;
        break;
      case 'bottom-right':
      default:
        x = canvasWidth - pipSize - margin;
        y = canvasHeight - pipSize - margin;
        break;
    }

    // Draw camera PiP with border radius
    ctx.save();

    // Create circular/rounded clip path
    ctx.beginPath();
    const radius = (pipSize * borderRadius) / 100;
    ctx.roundRect(x, y, pipSize, pipSize, radius);
    ctx.clip();

    // Draw camera (mirrored horizontally for natural look)
    ctx.translate(x + pipSize, y);
    ctx.scale(-1, 1);
    ctx.drawImage(this.cameraCanvas, 0, 0, pipSize, pipSize);

    ctx.restore();

    // Draw border
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, pipSize, pipSize, radius);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Clean up all camera resources.
   */
  destroy(): void {
    if (this.cameraVideo) {
      this.cameraVideo.src = '';
      this.cameraVideo = null;
    }
    this.cameraCanvas = null;
    this.cameraCtx = null;
  }
}
