import type { ExportConfig, ExportProgress, ExportResult } from './types';
import { VideoFileDecoder } from './videoDecoder';
import { AudioFileDecoder, mixAudioBuffersAsync } from './audioDecoder';
import { FrameRenderer } from './frameRenderer';
import { VideoMuxer } from './muxer';
import { EncodeQueue } from './encode-queue';
import { PrefetchManager } from './prefetch-manager';
import { RenderCoordinator } from './render-coordinator';
import type { ZoomRegion, CropRegion, TrimRegion, AnnotationRegion, CameraPipConfig } from '@/components/video-editor/types';

interface VideoExporterConfig extends ExportConfig {
  videoUrl: string;
  wallpaper: string;
  zoomRegions: ZoomRegion[];
  trimRegions?: TrimRegion[];
  showShadow: boolean;
  shadowIntensity: number;
  showBlur: boolean;
  motionBlurEnabled?: boolean;
  borderRadius?: number;
  padding?: number;
  videoPadding?: number;
  cropRegion: CropRegion;
  annotationRegions?: AnnotationRegion[];
  previewWidth?: number;
  previewHeight?: number;
  onProgress?: (progress: ExportProgress) => void;
  // Camera PiP config
  cameraVideoUrl?: string;
  cameraPipConfig?: CameraPipConfig;
  // Audio tracks
  micAudioUrl?: string;
  systemAudioUrl?: string;
  // Parallel rendering (4 Web Workers)
  useParallelRendering?: boolean;
}

export class VideoExporter {
  private config: VideoExporterConfig;
  private decoder: VideoFileDecoder | null = null;
  private renderer: FrameRenderer | null = null;
  private encoder: VideoEncoder | null = null;
  private muxer: VideoMuxer | null = null;
  private cancelled = false;
  // Event-driven encode queue (replaces busy-wait with Promise backpressure)
  private encodeQueueManager: EncodeQueue;
  // Prefetch manager for dual video element frame extraction
  private prefetchManager: PrefetchManager | null = null;
  private videoDescription: Uint8Array | undefined;
  private videoColorSpace: VideoColorSpaceInit | undefined;
  // Track muxing promises for parallel processing
  private muxingPromises: Promise<void>[] = [];
  private chunkCount = 0;
  // Audio encoding state
  private micAudioDecoder: AudioFileDecoder | null = null;
  private systemAudioDecoder: AudioFileDecoder | null = null;
  private audioEncoder: AudioEncoder | null = null;
  private mixedAudioBuffer: AudioBuffer | null = null;
  // Event-driven audio encode queue
  private audioEncodeQueueManager: EncodeQueue;
  private audioChunkCount = 0;
  // Performance telemetry
  private exportStartTime = 0;
  private frameTimings: number[] = [];
  // Parallel rendering coordinator (optional, enabled via config)
  private renderCoordinator: RenderCoordinator | null = null;

  constructor(config: VideoExporterConfig) {
    this.config = config;
    // Initialize encode queues with optimal sizes for hardware encoding
    // Video: 4-8 frames optimal for hardware encoder pipeline
    // Audio: 8 frames for audio chunks
    this.encodeQueueManager = new EncodeQueue({ maxSize: 6 });
    this.audioEncodeQueueManager = new EncodeQueue({ maxSize: 8 });
  }

  // Calculate the total duration excluding trim regions (in seconds)
  private getEffectiveDuration(totalDuration: number): number {
    const trimRegions = this.config.trimRegions || [];
    const totalTrimDuration = trimRegions.reduce((sum, region) => {
      return sum + (region.endMs - region.startMs) / 1000;
    }, 0);
    return totalDuration - totalTrimDuration;
  }

  private mapEffectiveToSourceTime(effectiveTimeMs: number): number {
    const trimRegions = this.config.trimRegions || [];
    // Sort trim regions by start time
    const sortedTrims = [...trimRegions].sort((a, b) => a.startMs - b.startMs);

    let sourceTimeMs = effectiveTimeMs;

    for (const trim of sortedTrims) {
      // If the source time hasn't reached this trim region yet, we're done
      if (sourceTimeMs < trim.startMs) {
        break;
      }

      // Add the duration of this trim region to the source time
      const trimDuration = trim.endMs - trim.startMs;
      sourceTimeMs += trimDuration;
    }

    return sourceTimeMs;
  }

  async export(): Promise<ExportResult> {
    try {
      this.cleanup();
      this.cancelled = false;
      this.exportStartTime = performance.now();
      this.frameTimings = [];

      // Initialize prefetch manager with dual video elements
      this.prefetchManager = new PrefetchManager({
        videoUrl: this.config.videoUrl,
        trimRegions: this.config.trimRegions,
        frameRate: this.config.frameRate,
        debug: false,
      });
      const videoInfo = await this.prefetchManager.initialize();

      // Also initialize decoder for compatibility (some features may still need it)
      this.decoder = new VideoFileDecoder();
      await this.decoder.loadVideo(this.config.videoUrl);

      // Initialize renderer based on parallel mode config
      // Note: Parallel rendering with Web Workers is ready, but currently disabled by default
      // because the bottleneck is video frame extraction (~100ms/frame), not rendering (~2ms/frame).
      // Workers process 50x faster than we can feed them frames.
      // To enable: set useParallelRendering: true (useful when video decoding is optimized)
      const useParallel = this.config.useParallelRendering ?? false;

      if (useParallel) {
        // Use RenderCoordinator with worker pool for parallel rendering
        this.renderCoordinator = new RenderCoordinator({
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
          videoWidth: videoInfo.width,
          videoHeight: videoInfo.height,
          annotationRegions: this.config.annotationRegions,
          previewWidth: this.config.previewWidth,
          previewHeight: this.config.previewHeight,
          cameraExport: this.config.cameraVideoUrl && this.config.cameraPipConfig
            ? {
                videoUrl: this.config.cameraVideoUrl,
                pipConfig: this.config.cameraPipConfig,
              }
            : undefined,
          workerCount: 4, // Fixed at 4 per validation
          debug: false,
        });
        await this.renderCoordinator.initialize();
        console.log('[VideoExporter] Using parallel rendering mode:', this.renderCoordinator.isParallelMode() ? '4 workers' : 'fallback');
      } else {
        // Use single-threaded FrameRenderer (existing behavior)
        this.renderer = new FrameRenderer({
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
          videoWidth: videoInfo.width,
          videoHeight: videoInfo.height,
          annotationRegions: this.config.annotationRegions,
          previewWidth: this.config.previewWidth,
          previewHeight: this.config.previewHeight,
          // Pass camera PiP config if provided
          cameraExport: this.config.cameraVideoUrl && this.config.cameraPipConfig
            ? {
                videoUrl: this.config.cameraVideoUrl,
                pipConfig: this.config.cameraPipConfig,
              }
            : undefined,
        });
        await this.renderer.initialize();
        console.log('[VideoExporter] Using single-threaded rendering mode');
      }

      // Initialize video encoder
      await this.initializeEncoder();

      // Load and decode audio files if provided
      const hasAudio = await this.loadAndMixAudio();

      // Initialize muxer with audio support if audio files present (use Opus codec)
      this.muxer = new VideoMuxer(this.config, hasAudio, 'opus');
      await this.muxer.initialize();

      // Initialize audio encoder if we have audio
      if (hasAudio) {
        await this.initializeAudioEncoder();
      }

      // Calculate effective duration and frame count (excluding trim regions)
      const effectiveDuration = this.getEffectiveDuration(videoInfo.duration);
      const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);

      console.log('[VideoExporter] Original duration:', videoInfo.duration, 's');
      console.log('[VideoExporter] Effective duration:', effectiveDuration, 's');
      console.log('[VideoExporter] Total frames to export:', totalFrames);
      console.log('[VideoExporter] Using prefetch manager with dual video elements');

      // Process frames with prefetch-based pipeline (overlaps seek latency)
      const frameDuration = 1_000_000 / this.config.frameRate; // in microseconds
      const timeStep = 1 / this.config.frameRate;

      if (useParallel && this.renderCoordinator) {
        // Parallel rendering mode: use RenderCoordinator with frame callback
        this.renderCoordinator.setFrameCallback(async (renderedFrame, frameIdx) => {
          // Wait for encoder queue space
          await this.encodeQueueManager.waitForSpace();

          if (this.encoder && this.encoder.state === 'configured') {
            try {
              this.encodeQueueManager.increment();
              this.encoder.encode(renderedFrame, { keyFrame: frameIdx % 150 === 0 });
            } catch (encodeError) {
              this.encodeQueueManager.onChunkOutput();
              console.error(`[Frame ${frameIdx}] Encode error:`, encodeError);
            }
          }

          renderedFrame.close();
        });

        // Submit all frames to coordinator
        for (let frameIndex = 0; frameIndex < totalFrames && !this.cancelled; frameIndex++) {
          const frameStartTime = performance.now();
          const timestamp = frameIndex * frameDuration;
          const effectiveTimeMs = frameIndex * timeStep * 1000;

          // Get prefetched video element
          const videoElement = await this.prefetchManager!.getFrame(frameIndex, effectiveTimeMs);

          // Create VideoFrame from video element
          const videoFrame = new VideoFrame(videoElement, { timestamp });

          // Map effective -> source timestamp for zoom animation
          const sourceTimeMs = this.mapEffectiveToSourceTime(effectiveTimeMs);
          const sourceTimestamp = sourceTimeMs * 1000;

          // Submit to coordinator (will be rendered in worker pool)
          await this.renderCoordinator.renderFrame(videoFrame, sourceTimestamp);

          // Track frame timing
          this.frameTimings.push(performance.now() - frameStartTime);
          if (this.frameTimings.length > 1000) {
            this.frameTimings.shift();
          }

          // Update progress
          if (this.config.onProgress) {
            const avgFrameTime = this.frameTimings.reduce((a, b) => a + b, 0) / this.frameTimings.length;
            const remainingFrames = totalFrames - frameIndex - 1;
            const estimatedTimeRemaining = (avgFrameTime * remainingFrames) / 1000;

            this.config.onProgress({
              currentFrame: frameIndex + 1,
              totalFrames,
              percentage: ((frameIndex + 1) / totalFrames) * 100,
              estimatedTimeRemaining,
            });
          }
        }

        // Wait for all pending renders to complete
        await this.renderCoordinator.waitForPending();
        await this.renderCoordinator.flush();

        // Log coordinator stats
        const coordStats = this.renderCoordinator.getStats();
        console.log('[VideoExporter] Parallel rendering stats:', coordStats);
      } else {
        // Single-threaded mode: existing behavior
        for (let frameIndex = 0; frameIndex < totalFrames && !this.cancelled; frameIndex++) {
          const frameStartTime = performance.now();
          const timestamp = frameIndex * frameDuration;
          const effectiveTimeMs = frameIndex * timeStep * 1000;

          // Get prefetched video element (handles seek timing overlap)
          const videoElement = await this.prefetchManager!.getFrame(frameIndex, effectiveTimeMs);

          // Create a VideoFrame from the video element (on GPU!)
          const videoFrame = new VideoFrame(videoElement, {
            timestamp,
          });

          // Render the frame with all effects using source timestamp
          // PrefetchManager already mapped effective -> source time internally
          const sourceTimeMs = this.mapEffectiveToSourceTime(effectiveTimeMs);
          const sourceTimestamp = sourceTimeMs * 1000; // Convert to microseconds
          await this.renderer!.renderFrame(videoFrame, sourceTimestamp);

          videoFrame.close();

          const canvas = this.renderer!.getCanvas();

          // Create VideoFrame from canvas on GPU without reading pixels
          // @ts-expect-error - colorSpace not in TypeScript definitions but works at runtime
          const exportFrame = new VideoFrame(canvas, {
            timestamp,
            duration: frameDuration,
            colorSpace: {
              primaries: 'bt709',
              transfer: 'iec61966-2-1',
              matrix: 'rgb',
              fullRange: true,
            },
          });

          // Wait for encoder queue space using Promise-based backpressure (no busy-wait)
          await this.encodeQueueManager.waitForSpace();

          if (this.encoder && this.encoder.state === 'configured') {
            try {
              this.encodeQueueManager.increment();
              this.encoder.encode(exportFrame, { keyFrame: frameIndex % 150 === 0 });
            } catch (encodeError) {
              // Decrement queue on encode failure to prevent queue desync
              this.encodeQueueManager.onChunkOutput();
              console.error(`[Frame ${frameIndex}] Encode error:`, encodeError);
              // Continue export - single frame failure shouldn't halt entire export
            }
          } else {
            console.warn(`[Frame ${frameIndex}] Encoder not ready! State: ${this.encoder?.state}`);
          }

          exportFrame.close();

          // Track frame timing for telemetry (limit to last 1000 samples to prevent unbounded growth)
          this.frameTimings.push(performance.now() - frameStartTime);
          if (this.frameTimings.length > 1000) {
            this.frameTimings.shift();
          }

          // Update progress with estimated time remaining
          if (this.config.onProgress) {
            const avgFrameTime = this.frameTimings.reduce((a, b) => a + b, 0) / this.frameTimings.length;
            const remainingFrames = totalFrames - frameIndex - 1;
            const estimatedTimeRemaining = (avgFrameTime * remainingFrames) / 1000; // in seconds

            this.config.onProgress({
              currentFrame: frameIndex + 1,
              totalFrames,
              percentage: ((frameIndex + 1) / totalFrames) * 100,
              estimatedTimeRemaining,
            });
          }
        }
      }

      if (this.cancelled) {
        return { success: false, error: 'Export cancelled' };
      }

      // Finalize video encoding
      if (this.encoder && this.encoder.state === 'configured') {
        await this.encoder.flush();
      }

      // Encode audio if we have audio buffer
      if (hasAudio && this.mixedAudioBuffer) {
        await this.encodeAudioBuffer(effectiveDuration);
      }

      // Finalize audio encoding
      if (this.audioEncoder && this.audioEncoder.state === 'configured') {
        await this.audioEncoder.flush();
      }

      // Wait for all muxing operations to complete
      await Promise.all(this.muxingPromises);

      // Finalize muxer and get output blob
      const blob = await this.muxer!.finalize();

      return { success: true, blob };
    } catch (error) {
      console.error('Export error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.cleanup();
    }
  }

  private async initializeEncoder(): Promise<void> {
    this.encodeQueueManager.reset();
    this.muxingPromises = [];
    this.chunkCount = 0;
    let videoDescription: Uint8Array | undefined;

    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        // Capture decoder config metadata from encoder output
        if (meta?.decoderConfig?.description && !videoDescription) {
          const desc = meta.decoderConfig.description;
          videoDescription = new Uint8Array(desc instanceof ArrayBuffer ? desc : (desc as ArrayBufferLike));
          this.videoDescription = videoDescription;
        }
        // Capture colorSpace from encoder metadata if provided
        if (meta?.decoderConfig?.colorSpace && !this.videoColorSpace) {
          this.videoColorSpace = meta.decoderConfig.colorSpace;
        }

        // Stream chunk to muxer immediately (parallel processing)
        const isFirstChunk = this.chunkCount === 0;
        this.chunkCount++;

        const muxingPromise = (async () => {
          try {
            if (isFirstChunk && this.videoDescription) {
              // Add decoder config for the first chunk
              const colorSpace = this.videoColorSpace || {
                primaries: 'bt709',
                transfer: 'iec61966-2-1',
                matrix: 'rgb',
                fullRange: true,
              };

              const metadata: EncodedVideoChunkMetadata = {
                decoderConfig: {
                  codec: this.config.codec || 'avc1.640033',
                  codedWidth: this.config.width,
                  codedHeight: this.config.height,
                  description: this.videoDescription,
                  colorSpace,
                },
              };

              await this.muxer!.addVideoChunk(chunk, metadata);
            } else {
              await this.muxer!.addVideoChunk(chunk, meta);
            }
          } catch (error) {
            console.error('Muxing error:', error);
          }
        })();

        this.muxingPromises.push(muxingPromise);
        // Signal queue space available (triggers Promise resolution for waiters)
        this.encodeQueueManager.onChunkOutput();
      },
      error: (error) => {
        console.error('[VideoExporter] Encoder error:', error);
        // Stop export encoding failed
        this.cancelled = true;
      },
    });

    const codec = this.config.codec || 'avc1.640033';
    
    const encoderConfig: VideoEncoderConfig = {
      codec,
      width: this.config.width,
      height: this.config.height,
      bitrate: this.config.bitrate,
      framerate: this.config.frameRate,
      latencyMode: 'realtime',
      bitrateMode: 'variable',
      hardwareAcceleration: 'prefer-hardware',
    };

    // Check hardware support first
    const hardwareSupport = await VideoEncoder.isConfigSupported(encoderConfig);

    if (hardwareSupport.supported) {
      // Use hardware encoding
      console.log('[VideoExporter] Using hardware acceleration');
      this.encoder.configure(encoderConfig);
    } else {
      // Fall back to software encoding
      console.log('[VideoExporter] Hardware not supported, using software encoding');
      encoderConfig.hardwareAcceleration = 'prefer-software';
      
      const softwareSupport = await VideoEncoder.isConfigSupported(encoderConfig);
      if (!softwareSupport.supported) {
        throw new Error('Video encoding not supported on this system');
      }
      
      this.encoder.configure(encoderConfig);
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.cleanup();
  }

  /**
   * Load and mix audio files from mic and system audio
   * Returns true if audio is available for export
   */
  private async loadAndMixAudio(): Promise<boolean> {
    const { micAudioUrl, systemAudioUrl } = this.config;

    if (!micAudioUrl && !systemAudioUrl) {
      console.log('[VideoExporter] No audio files provided');
      return false;
    }

    try {
      const audioBuffers: (AudioBuffer | null)[] = [];
      const audioGains: number[] = [];

      // Load mic audio if provided (full volume - priority for voiceover)
      if (micAudioUrl) {
        console.log('[VideoExporter] Loading mic audio:', micAudioUrl);
        this.micAudioDecoder = new AudioFileDecoder();
        const micInfo = await this.micAudioDecoder.loadAudio(micAudioUrl);
        console.log('[VideoExporter] Mic audio loaded:', micInfo);
        audioBuffers.push(this.micAudioDecoder.getAudioBuffer());
        audioGains.push(1.0); // Mic at full volume
      }

      // Load system audio if provided (reduced volume so mic is clearer)
      if (systemAudioUrl) {
        console.log('[VideoExporter] Loading system audio:', systemAudioUrl);
        this.systemAudioDecoder = new AudioFileDecoder();
        const systemInfo = await this.systemAudioDecoder.loadAudio(systemAudioUrl);
        console.log('[VideoExporter] System audio loaded:', systemInfo);
        audioBuffers.push(this.systemAudioDecoder.getAudioBuffer());
        audioGains.push(0.5); // System audio at 50% to not overpower mic
      }

      // Mix audio buffers with specified gains at 48kHz
      console.log('[VideoExporter] Mixing audio with gains:', audioGains);
      this.mixedAudioBuffer = await mixAudioBuffersAsync(audioBuffers, audioGains, 48000);

      if (this.mixedAudioBuffer) {
        console.log('[VideoExporter] Mixed audio buffer ready:',
          'duration:', this.mixedAudioBuffer.duration,
          'channels:', this.mixedAudioBuffer.numberOfChannels,
          'sampleRate:', this.mixedAudioBuffer.sampleRate
        );
        return true;
      }

      return false;
    } catch (error) {
      console.error('[VideoExporter] Failed to load audio:', error);
      // Don't fail export if audio fails, just export without audio
      return false;
    }
  }

  /**
   * Initialize Opus audio encoder
   */
  private async initializeAudioEncoder(): Promise<void> {
    if (!this.mixedAudioBuffer) {
      throw new Error('No audio buffer available');
    }

    this.audioEncodeQueueManager.reset();
    this.audioChunkCount = 0;

    this.audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        const isFirstChunk = this.audioChunkCount === 0;
        this.audioChunkCount++;

        const muxingPromise = (async () => {
          try {
            if (isFirstChunk) {
              // Add decoder config for the first chunk (Opus codec)
              const metadata: EncodedAudioChunkMetadata = {
                decoderConfig: {
                  codec: 'opus',
                  sampleRate: 48000,
                  numberOfChannels: this.mixedAudioBuffer?.numberOfChannels || 2,
                },
              };
              await this.muxer!.addAudioChunk(chunk, metadata);
            } else {
              await this.muxer!.addAudioChunk(chunk, meta);
            }
          } catch (error) {
            console.error('[VideoExporter] Audio muxing error:', error);
          }
        })();

        this.muxingPromises.push(muxingPromise);
        // Signal audio queue space available
        this.audioEncodeQueueManager.onChunkOutput();
      },
      error: (error) => {
        console.error('[VideoExporter] Audio encoder error:', error);
        this.cancelled = true;
      },
    });

    // Use Opus codec - well supported by WebCodecs (AAC is not reliably supported)
    const audioConfig: AudioEncoderConfig = {
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: this.mixedAudioBuffer.numberOfChannels,
      bitrate: 128000, // 128 kbps stereo
    };

    const support = await AudioEncoder.isConfigSupported(audioConfig);
    if (!support.supported) {
      throw new Error('Opus audio encoding not supported on this system');
    }

    console.log('[VideoExporter] Initializing Opus audio encoder');
    this.audioEncoder.configure(audioConfig);
  }

  /**
   * Encode audio buffer in chunks synchronized with video timeline
   * Handles trim regions by calculating effective audio range
   */
  private async encodeAudioBuffer(effectiveDuration: number): Promise<void> {
    if (!this.mixedAudioBuffer || !this.audioEncoder) {
      return;
    }

    const sampleRate = this.mixedAudioBuffer.sampleRate;
    const numChannels = this.mixedAudioBuffer.numberOfChannels;

    // Calculate effective audio samples to encode
    // We need to skip samples that correspond to trimmed video regions
    const effectiveSamples = Math.ceil(effectiveDuration * sampleRate);

    console.log('[VideoExporter] Encoding audio:',
      'effectiveDuration:', effectiveDuration,
      'effectiveSamples:', effectiveSamples
    );

    // Get channel data
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(this.mixedAudioBuffer.getChannelData(ch));
    }

    // Process audio in chunks of 1024 samples (standard AAC frame size)
    const samplesPerChunk = 1024;
    let outputSampleIndex = 0;

    while (outputSampleIndex < effectiveSamples && !this.cancelled) {
      // Calculate time range for this chunk (in effective time, without trims)
      const startTimeMs = (outputSampleIndex / sampleRate) * 1000;
      const chunkSamples = Math.min(samplesPerChunk, effectiveSamples - outputSampleIndex);

      // Map effective time to source time (accounting for trims)
      const sourceTimeMs = this.mapEffectiveToSourceTime(startTimeMs);
      const sourceSampleStart = Math.floor((sourceTimeMs / 1000) * sampleRate);

      // Create interleaved audio data for this chunk
      const audioData = new Float32Array(chunkSamples * numChannels);

      for (let i = 0; i < chunkSamples; i++) {
        const srcIdx = sourceSampleStart + i;
        for (let ch = 0; ch < numChannels; ch++) {
          const value = srcIdx < channels[ch].length ? channels[ch][srcIdx] : 0;
          audioData[i * numChannels + ch] = value;
        }
      }

      // Create AudioData object for encoding
      const timestamp = outputSampleIndex / sampleRate * 1_000_000; // microseconds
      const planarData = this.interleaveToPlanes(audioData, numChannels, chunkSamples);
      const audioDataObj = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: chunkSamples,
        numberOfChannels: numChannels,
        timestamp,
        data: planarData.buffer as ArrayBuffer,
      });

      // Wait for encoder queue space using Promise-based backpressure (no busy-wait)
      await this.audioEncodeQueueManager.waitForSpace();

      if (this.audioEncoder.state === 'configured') {
        try {
          this.audioEncodeQueueManager.increment();
          this.audioEncoder.encode(audioDataObj);
        } catch (audioEncodeError) {
          // Decrement queue on encode failure to prevent queue desync
          this.audioEncodeQueueManager.onChunkOutput();
          console.error('[VideoExporter] Audio encode error:', audioEncodeError);
          // Continue - single chunk failure shouldn't halt entire export
        }
      }

      audioDataObj.close();
      outputSampleIndex += chunkSamples;
    }

    console.log('[VideoExporter] Audio encoding complete:',
      'chunks:', this.audioChunkCount
    );
  }

  /**
   * Convert interleaved audio data to planar format for AudioData
   */
  private interleaveToPlanes(interleaved: Float32Array, numChannels: number, numFrames: number): Float32Array {
    const planar = new Float32Array(numFrames * numChannels);

    for (let ch = 0; ch < numChannels; ch++) {
      for (let i = 0; i < numFrames; i++) {
        planar[ch * numFrames + i] = interleaved[i * numChannels + ch];
      }
    }

    return planar;
  }

  private cleanup(): void {
    // Log performance telemetry before cleanup
    if (this.frameTimings.length > 0) {
      const avgFrameTime = this.frameTimings.reduce((a, b) => a + b, 0) / this.frameTimings.length;
      const totalTime = (performance.now() - this.exportStartTime) / 1000;
      const encodeStats = this.encodeQueueManager.getStats();
      const prefetchStats = this.prefetchManager?.getStats();

      console.log('[VideoExporter] Export telemetry:');
      console.log(`  - Total time: ${totalTime.toFixed(2)}s`);
      console.log(`  - Avg frame time: ${avgFrameTime.toFixed(2)}ms`);
      console.log(`  - Encode queue: peak=${encodeStats.peakSize}, waits=${encodeStats.totalWaits}`);
      if (prefetchStats) {
        console.log(`  - Prefetch: hits=${prefetchStats.prefetchHits}, misses=${prefetchStats.prefetchMisses}, hitRate=${(prefetchStats.hitRate * 100).toFixed(1)}%`);
      }
    }

    if (this.encoder) {
      try {
        if (this.encoder.state === 'configured') {
          this.encoder.close();
        }
      } catch (e) {
        console.warn('Error closing encoder:', e);
      }
      this.encoder = null;
    }

    // Clean up audio encoder
    if (this.audioEncoder) {
      try {
        if (this.audioEncoder.state === 'configured') {
          this.audioEncoder.close();
        }
      } catch (e) {
        console.warn('Error closing audio encoder:', e);
      }
      this.audioEncoder = null;
    }

    // Clean up prefetch manager
    if (this.prefetchManager) {
      try {
        this.prefetchManager.destroy();
      } catch (e) {
        console.warn('Error destroying prefetch manager:', e);
      }
      this.prefetchManager = null;
    }

    // Clean up render coordinator (parallel rendering)
    if (this.renderCoordinator) {
      try {
        this.renderCoordinator.terminate();
      } catch (e) {
        console.warn('Error terminating render coordinator:', e);
      }
      this.renderCoordinator = null;
    }

    if (this.decoder) {
      try {
        this.decoder.destroy();
      } catch (e) {
        console.warn('Error destroying decoder:', e);
      }
      this.decoder = null;
    }

    // Clean up audio decoders
    if (this.micAudioDecoder) {
      try {
        this.micAudioDecoder.destroy();
      } catch (e) {
        console.warn('Error destroying mic audio decoder:', e);
      }
      this.micAudioDecoder = null;
    }

    if (this.systemAudioDecoder) {
      try {
        this.systemAudioDecoder.destroy();
      } catch (e) {
        console.warn('Error destroying system audio decoder:', e);
      }
      this.systemAudioDecoder = null;
    }

    if (this.renderer) {
      try {
        this.renderer.destroy();
      } catch (e) {
        console.warn('Error destroying renderer:', e);
      }
      this.renderer = null;
    }

    this.muxer = null;
    this.encodeQueueManager.reset();
    this.muxingPromises = [];
    this.chunkCount = 0;
    this.videoDescription = undefined;
    this.videoColorSpace = undefined;
    // Clean up audio state
    this.mixedAudioBuffer = null;
    this.audioEncodeQueueManager.reset();
    this.audioChunkCount = 0;
    // Clean up telemetry
    this.frameTimings = [];
  }
}
