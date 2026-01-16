/**
 * PixiJS renderer for Web Worker environment using OffscreenCanvas.
 * Extracted from frameRenderer.ts, stripped of DOM dependencies.
 *
 * Renders video frames with zoom, blur, shadow, and compositing effects.
 * Returns VideoFrame for zero-copy transfer back to main thread.
 */

import { Application, Container, Sprite, Graphics, BlurFilter, Texture } from 'pixi.js';
import type { ZoomDepth } from '@/components/video-editor/types';
import { ZOOM_DEPTH_SCALES } from '@/components/video-editor/types';
import { findDominantRegion } from '@/components/video-editor/videoPlayback/zoomRegionUtils';
import { applyZoomTransform } from '@/components/video-editor/videoPlayback/zoomTransform';
import { DEFAULT_FOCUS, SMOOTHING_FACTOR, MIN_DELTA } from '@/components/video-editor/videoPlayback/constants';
import { clampFocusToStage as clampFocusToStageUtil } from '@/components/video-editor/videoPlayback/focusUtils';
import type { WorkerRenderConfig } from './worker-types';

interface AnimationState {
  scale: number;
  focusX: number;
  focusY: number;
}

interface LayoutInfo {
  stageSize: { width: number; height: number };
  videoSize: { width: number; height: number };
  baseScale: number;
  baseOffset: { x: number; y: number };
  maskRect: { x: number; y: number; width: number; height: number };
}

export class WorkerPixiRenderer {
  private app: Application | null = null;
  private cameraContainer: Container | null = null;
  private videoContainer: Container | null = null;
  private videoSprite: Sprite | null = null;
  private maskGraphics: Graphics | null = null;
  private blurFilter: BlurFilter | null = null;
  private offscreenCanvas: OffscreenCanvas | null = null;
  // Composite canvas for shadow/background blending (OffscreenCanvas in worker)
  private compositeCanvas: OffscreenCanvas | null = null;
  private compositeCtx: OffscreenCanvasRenderingContext2D | null = null;
  // Shadow canvas
  private shadowCanvas: OffscreenCanvas | null = null;
  private shadowCtx: OffscreenCanvasRenderingContext2D | null = null;
  // Background canvas (pre-rendered once)
  private backgroundCanvas: OffscreenCanvas | null = null;

  private config: WorkerRenderConfig;
  private animationState: AnimationState;
  private layoutCache: LayoutInfo | null = null;
  private currentVideoTime = 0;

  constructor(config: WorkerRenderConfig) {
    this.config = config;
    this.animationState = {
      scale: 1,
      focusX: DEFAULT_FOCUS.cx,
      focusY: DEFAULT_FOCUS.cy,
    };
  }

  /**
   * Initialize PixiJS with OffscreenCanvas in worker environment.
   * @param canvas - Transferred OffscreenCanvas from main thread
   */
  async initialize(canvas: OffscreenCanvas): Promise<void> {
    this.offscreenCanvas = canvas;

    // Initialize PixiJS with the transferred OffscreenCanvas
    this.app = new Application();
    await this.app.init({
      canvas: canvas as unknown as HTMLCanvasElement,
      width: this.config.width,
      height: this.config.height,
      backgroundAlpha: 0,
      antialias: false,
      resolution: 1,
      autoDensity: true,
    });

    // Setup containers
    this.cameraContainer = new Container();
    this.videoContainer = new Container();
    this.app.stage.addChild(this.cameraContainer);
    this.cameraContainer.addChild(this.videoContainer);

    // Setup blur filter
    this.blurFilter = new BlurFilter();
    this.blurFilter.quality = 3;
    this.blurFilter.resolution = this.app.renderer.resolution;
    this.blurFilter.blur = 0;
    this.videoContainer.filters = [this.blurFilter];

    // Setup composite canvas for final output
    this.compositeCanvas = new OffscreenCanvas(this.config.width, this.config.height);
    this.compositeCtx = this.compositeCanvas.getContext('2d');

    if (!this.compositeCtx) {
      throw new Error('Failed to get 2D context for composite canvas');
    }

    // Setup shadow canvas if needed
    if (this.config.showShadow) {
      this.shadowCanvas = new OffscreenCanvas(this.config.width, this.config.height);
      this.shadowCtx = this.shadowCanvas.getContext('2d');
    }

    // Setup mask
    this.maskGraphics = new Graphics();
    this.videoContainer.addChild(this.maskGraphics);
    this.videoContainer.mask = this.maskGraphics;

    // Pre-render background
    await this.setupBackground();
  }

  /**
   * Setup background canvas (color, gradient, or fallback).
   * Image backgrounds not supported in worker (no Image constructor).
   */
  private async setupBackground(): Promise<void> {
    const wallpaper = this.config.wallpaper;

    this.backgroundCanvas = new OffscreenCanvas(this.config.width, this.config.height);
    const bgCtx = this.backgroundCanvas.getContext('2d');
    if (!bgCtx) return;

    try {
      // Handle color backgrounds
      if (wallpaper.startsWith('#')) {
        bgCtx.fillStyle = wallpaper;
        bgCtx.fillRect(0, 0, this.config.width, this.config.height);
      } else if (wallpaper.startsWith('linear-gradient') || wallpaper.startsWith('radial-gradient')) {
        // Parse and render gradient
        const gradientMatch = wallpaper.match(/(linear|radial)-gradient\((.+)\)/);
        if (gradientMatch) {
          const [, type, params] = gradientMatch;
          const parts = params.split(',').map(s => s.trim());

          let gradient: CanvasGradient;

          if (type === 'linear') {
            gradient = bgCtx.createLinearGradient(0, 0, 0, this.config.height);
            parts.forEach((part, index) => {
              if (part.startsWith('to ') || part.includes('deg')) return;

              const colorMatch = part.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/);
              if (colorMatch) {
                const color = colorMatch[1];
                const position = index / (parts.length - 1);
                gradient.addColorStop(position, color);
              }
            });
          } else {
            const cx = this.config.width / 2;
            const cy = this.config.height / 2;
            const radius = Math.max(this.config.width, this.config.height) / 2;
            gradient = bgCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);

            parts.forEach((part, index) => {
              const colorMatch = part.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/);
              if (colorMatch) {
                const color = colorMatch[1];
                const position = index / (parts.length - 1);
                gradient.addColorStop(position, color);
              }
            });
          }

          bgCtx.fillStyle = gradient;
          bgCtx.fillRect(0, 0, this.config.width, this.config.height);
        } else {
          // Fallback to black
          bgCtx.fillStyle = '#000000';
          bgCtx.fillRect(0, 0, this.config.width, this.config.height);
        }
      } else if (wallpaper.startsWith('file://') || wallpaper.startsWith('data:') ||
                 wallpaper.startsWith('/') || wallpaper.startsWith('http')) {
        // Image backgrounds: use ImageBitmap in worker (fetch + createImageBitmap)
        try {
          const response = await fetch(wallpaper);
          const blob = await response.blob();
          const imageBitmap = await createImageBitmap(blob);

          // Draw with cover and center positioning
          const imgAspect = imageBitmap.width / imageBitmap.height;
          const canvasAspect = this.config.width / this.config.height;

          let drawWidth, drawHeight, drawX, drawY;

          if (imgAspect > canvasAspect) {
            drawHeight = this.config.height;
            drawWidth = drawHeight * imgAspect;
            drawX = (this.config.width - drawWidth) / 2;
            drawY = 0;
          } else {
            drawWidth = this.config.width;
            drawHeight = drawWidth / imgAspect;
            drawX = 0;
            drawY = (this.config.height - drawHeight) / 2;
          }

          bgCtx.drawImage(imageBitmap, drawX, drawY, drawWidth, drawHeight);
          imageBitmap.close();
        } catch (err) {
          console.warn('[WorkerPixiRenderer] Failed to load background image, using black:', err);
          bgCtx.fillStyle = '#000000';
          bgCtx.fillRect(0, 0, this.config.width, this.config.height);
        }
      } else {
        // Treat as color
        bgCtx.fillStyle = wallpaper;
        bgCtx.fillRect(0, 0, this.config.width, this.config.height);
      }
    } catch (error) {
      console.warn('[WorkerPixiRenderer] Error setting up background:', error);
      bgCtx.fillStyle = '#000000';
      bgCtx.fillRect(0, 0, this.config.width, this.config.height);
    }
  }

  /**
   * Render a single frame with all effects.
   * @param videoFrame - VideoFrame from main thread (transferred)
   * @param timestamp - Frame timestamp in microseconds
   * @returns Rendered VideoFrame for transfer back to main thread
   */
  async renderFrame(videoFrame: VideoFrame, timestamp: number): Promise<VideoFrame> {
    if (!this.app || !this.videoContainer || !this.cameraContainer || !this.compositeCanvas || !this.compositeCtx) {
      videoFrame.close();
      throw new Error('Renderer not initialized');
    }

    this.currentVideoTime = timestamp / 1_000_000;

    // Create or update video sprite from VideoFrame
    if (!this.videoSprite) {
      const texture = Texture.from(videoFrame as unknown as HTMLVideoElement);
      this.videoSprite = new Sprite(texture);
      this.videoContainer.addChild(this.videoSprite);
    } else {
      const newTexture = Texture.from(videoFrame as unknown as HTMLVideoElement);
      const oldTexture = this.videoSprite.texture;
      this.videoSprite.texture = newTexture;
      if (oldTexture !== newTexture && oldTexture !== Texture.EMPTY) {
        oldTexture.destroy(true);
      }
    }

    // Apply layout and animation
    this.updateLayout();

    const timeMs = this.currentVideoTime * 1000;

    let maxMotionIntensity = 0;
    const motionIntensity = this.updateAnimationState(timeMs);
    maxMotionIntensity = Math.max(maxMotionIntensity, motionIntensity);

    applyZoomTransform({
      cameraContainer: this.cameraContainer,
      blurFilter: this.blurFilter,
      stageSize: this.layoutCache!.stageSize,
      baseMask: this.layoutCache!.maskRect,
      zoomScale: this.animationState.scale,
      focusX: this.animationState.focusX,
      focusY: this.animationState.focusY,
      motionIntensity: maxMotionIntensity,
      isPlaying: true,
      motionBlurEnabled: this.config.motionBlurEnabled ?? true,
    });

    // Render PixiJS stage to offscreen canvas
    this.app.renderer.render(this.app.stage);

    // Close the input VideoFrame AFTER rendering (texture has been uploaded to GPU)
    videoFrame.close();

    // Composite with background and shadows
    this.compositeWithShadows();

    // Create VideoFrame from composite canvas
    // @ts-expect-error - colorSpace not in TypeScript definitions but works at runtime
    const renderedFrame = new VideoFrame(this.compositeCanvas, {
      timestamp,
      colorSpace: {
        primaries: 'bt709',
        transfer: 'iec61966-2-1',
        matrix: 'rgb',
        fullRange: true,
      },
    });

    return renderedFrame;
  }

  private updateLayout(): void {
    if (!this.app || !this.videoSprite || !this.maskGraphics || !this.videoContainer) return;

    const { width, height } = this.config;
    const { cropRegion, borderRadius = 0, padding = 0 } = this.config;
    const videoWidth = this.config.videoWidth;
    const videoHeight = this.config.videoHeight;

    const cropStartX = cropRegion.x;
    const cropStartY = cropRegion.y;
    const cropEndX = cropRegion.x + cropRegion.width;
    const cropEndY = cropRegion.y + cropRegion.height;

    const croppedVideoWidth = videoWidth * (cropEndX - cropStartX);
    const croppedVideoHeight = videoHeight * (cropEndY - cropStartY);

    const paddingScale = 1.0 - (padding / 100) * 0.4;
    const viewportWidth = width * paddingScale;
    const viewportHeight = height * paddingScale;
    const scale = Math.min(viewportWidth / croppedVideoWidth, viewportHeight / croppedVideoHeight);

    this.videoSprite.width = videoWidth * scale;
    this.videoSprite.height = videoHeight * scale;

    const cropPixelX = cropStartX * videoWidth * scale;
    const cropPixelY = cropStartY * videoHeight * scale;
    this.videoSprite.x = -cropPixelX;
    this.videoSprite.y = -cropPixelY;

    const croppedDisplayWidth = croppedVideoWidth * scale;
    const croppedDisplayHeight = croppedVideoHeight * scale;
    const centerOffsetX = (width - croppedDisplayWidth) / 2;
    const centerOffsetY = (height - croppedDisplayHeight) / 2;
    this.videoContainer.x = centerOffsetX;
    this.videoContainer.y = centerOffsetY;

    const previewWidth = this.config.previewWidth || 1920;
    const previewHeight = this.config.previewHeight || 1080;
    const canvasScaleFactor = Math.min(width / previewWidth, height / previewHeight);
    const scaledBorderRadius = borderRadius * canvasScaleFactor;

    this.maskGraphics.clear();
    this.maskGraphics.roundRect(0, 0, croppedDisplayWidth, croppedDisplayHeight, scaledBorderRadius);
    this.maskGraphics.fill({ color: 0xffffff });

    this.layoutCache = {
      stageSize: { width, height },
      videoSize: { width: croppedVideoWidth, height: croppedVideoHeight },
      baseScale: scale,
      baseOffset: { x: centerOffsetX, y: centerOffsetY },
      maskRect: { x: 0, y: 0, width: croppedDisplayWidth, height: croppedDisplayHeight },
    };
  }

  private clampFocusToStage(focus: { cx: number; cy: number }, depth: number): { cx: number; cy: number } {
    if (!this.layoutCache) return focus;
    return clampFocusToStageUtil(focus, depth as ZoomDepth, this.layoutCache.stageSize);
  }

  private updateAnimationState(timeMs: number): number {
    if (!this.cameraContainer || !this.layoutCache) return 0;

    const { region, strength } = findDominantRegion(this.config.zoomRegions, timeMs);

    const defaultFocus = DEFAULT_FOCUS;
    let targetScaleFactor = 1;
    let targetFocus = { ...defaultFocus };

    if (region && strength > 0) {
      const zoomScale = ZOOM_DEPTH_SCALES[region.depth];
      const regionFocus = this.clampFocusToStage(region.focus, region.depth);

      targetScaleFactor = 1 + (zoomScale - 1) * strength;
      targetFocus = {
        cx: defaultFocus.cx + (regionFocus.cx - defaultFocus.cx) * strength,
        cy: defaultFocus.cy + (regionFocus.cy - defaultFocus.cy) * strength,
      };
    }

    const state = this.animationState;

    const prevScale = state.scale;
    const prevFocusX = state.focusX;
    const prevFocusY = state.focusY;

    const scaleDelta = targetScaleFactor - state.scale;
    const focusXDelta = targetFocus.cx - state.focusX;
    const focusYDelta = targetFocus.cy - state.focusY;

    let nextScale = prevScale;
    let nextFocusX = prevFocusX;
    let nextFocusY = prevFocusY;

    if (Math.abs(scaleDelta) > MIN_DELTA) {
      nextScale = prevScale + scaleDelta * SMOOTHING_FACTOR;
    } else {
      nextScale = targetScaleFactor;
    }

    if (Math.abs(focusXDelta) > MIN_DELTA) {
      nextFocusX = prevFocusX + focusXDelta * SMOOTHING_FACTOR;
    } else {
      nextFocusX = targetFocus.cx;
    }

    if (Math.abs(focusYDelta) > MIN_DELTA) {
      nextFocusY = prevFocusY + focusYDelta * SMOOTHING_FACTOR;
    } else {
      nextFocusY = targetFocus.cy;
    }

    state.scale = nextScale;
    state.focusX = nextFocusX;
    state.focusY = nextFocusY;

    return Math.max(
      Math.abs(nextScale - prevScale),
      Math.abs(nextFocusX - prevFocusX),
      Math.abs(nextFocusY - prevFocusY)
    );
  }

  private compositeWithShadows(): void {
    if (!this.compositeCanvas || !this.compositeCtx || !this.app || !this.offscreenCanvas) return;

    const ctx = this.compositeCtx;
    const w = this.compositeCanvas.width;
    const h = this.compositeCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Draw background (with optional blur)
    if (this.backgroundCanvas) {
      if (this.config.showBlur) {
        ctx.save();
        ctx.filter = 'blur(6px)';
        ctx.drawImage(this.backgroundCanvas, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(this.backgroundCanvas, 0, 0, w, h);
      }
    }

    // Draw video with shadow
    if (this.config.showShadow && this.config.shadowIntensity > 0 && this.shadowCanvas && this.shadowCtx) {
      const shadowCtx = this.shadowCtx;
      shadowCtx.clearRect(0, 0, w, h);
      shadowCtx.save();

      const intensity = this.config.shadowIntensity;
      const baseBlur1 = 48 * intensity;
      const baseBlur2 = 16 * intensity;
      const baseBlur3 = 8 * intensity;
      const baseAlpha1 = 0.7 * intensity;
      const baseAlpha2 = 0.5 * intensity;
      const baseAlpha3 = 0.3 * intensity;
      const baseOffset = 12 * intensity;

      shadowCtx.filter = `drop-shadow(0 ${baseOffset}px ${baseBlur1}px rgba(0,0,0,${baseAlpha1})) drop-shadow(0 ${baseOffset/3}px ${baseBlur2}px rgba(0,0,0,${baseAlpha2})) drop-shadow(0 ${baseOffset/6}px ${baseBlur3}px rgba(0,0,0,${baseAlpha3}))`;
      shadowCtx.drawImage(this.offscreenCanvas, 0, 0, w, h);
      shadowCtx.restore();
      ctx.drawImage(this.shadowCanvas, 0, 0, w, h);
    } else {
      ctx.drawImage(this.offscreenCanvas, 0, 0, w, h);
    }
  }

  /**
   * Clean up all resources.
   */
  destroy(): void {
    if (this.videoSprite) {
      this.videoSprite.destroy();
      this.videoSprite = null;
    }
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true, textureSource: true });
      this.app = null;
    }
    this.cameraContainer = null;
    this.videoContainer = null;
    this.maskGraphics = null;
    this.blurFilter = null;
    this.offscreenCanvas = null;
    this.compositeCanvas = null;
    this.compositeCtx = null;
    this.shadowCanvas = null;
    this.shadowCtx = null;
    this.backgroundCanvas = null;
    this.layoutCache = null;
  }
}
