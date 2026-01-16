import type { ExportConfig, ExportProgress, ExportResult } from './types';
import { VideoFileDecoder } from './videoDecoder';
import { AudioFileDecoder, mixAudioBuffersAsync } from './audioDecoder';
import { FrameRenderer } from './frameRenderer';
import { VideoMuxer } from './muxer';
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
}

export class VideoExporter {
  private config: VideoExporterConfig;
  private decoder: VideoFileDecoder | null = null;
  private renderer: FrameRenderer | null = null;
  private encoder: VideoEncoder | null = null;
  private muxer: VideoMuxer | null = null;
  private cancelled = false;
  private encodeQueue = 0;
  // Increased queue size for better throughput with hardware encoding
  private readonly MAX_ENCODE_QUEUE = 120;
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
  private audioEncodeQueue = 0;
  private readonly MAX_AUDIO_ENCODE_QUEUE = 60;
  private audioChunkCount = 0;

  constructor(config: VideoExporterConfig) {
    this.config = config;
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

      // Initialize decoder and load video
      this.decoder = new VideoFileDecoder();
      const videoInfo = await this.decoder.loadVideo(this.config.videoUrl);

      // Initialize frame renderer
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

      // Get the video element for frame extraction
      const videoElement = this.decoder.getVideoElement();
      if (!videoElement) {
        throw new Error('Video element not available');
      }

      // Calculate effective duration and frame count (excluding trim regions)
      const effectiveDuration = this.getEffectiveDuration(videoInfo.duration);
      const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);
      
      console.log('[VideoExporter] Original duration:', videoInfo.duration, 's');
      console.log('[VideoExporter] Effective duration:', effectiveDuration, 's');
      console.log('[VideoExporter] Total frames to export:', totalFrames);

      // Process frames continuously without batching delays
      const frameDuration = 1_000_000 / this.config.frameRate; // in microseconds
      let frameIndex = 0;
      const timeStep = 1 / this.config.frameRate;

      while (frameIndex < totalFrames && !this.cancelled) {
        const i = frameIndex;
        const timestamp = i * frameDuration;

        // Map effective time to source time (accounting for trim regions)
        const effectiveTimeMs = (i * timeStep) * 1000;
        const sourceTimeMs = this.mapEffectiveToSourceTime(effectiveTimeMs);
        const videoTime = sourceTimeMs / 1000;
          
        // Seek if needed or wait for first frame to be ready
        const needsSeek = Math.abs(videoElement.currentTime - videoTime) > 0.001;

        if (needsSeek) {
          // Attach listener BEFORE setting currentTime to avoid race condition
          const seekedPromise = new Promise<void>(resolve => {
            videoElement.addEventListener('seeked', () => resolve(), { once: true });
          });
          
          videoElement.currentTime = videoTime;
          await seekedPromise;
        } else if (i === 0) {
          // Only for the very first frame, wait for it to be ready
          await new Promise<void>(resolve => {
            videoElement.requestVideoFrameCallback(() => resolve());
          });
        }

        // Create a VideoFrame from the video element (on GPU!)
        const videoFrame = new VideoFrame(videoElement, {
          timestamp,
        });

        // Render the frame with all effects using source timestamp
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

        // Check encoder queue before encoding to keep it full
        while (this.encodeQueue >= this.MAX_ENCODE_QUEUE && !this.cancelled) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        if (this.encoder && this.encoder.state === 'configured') {
          this.encodeQueue++;
          this.encoder.encode(exportFrame, { keyFrame: i % 150 === 0 });
        } else {
          console.warn(`[Frame ${i}] Encoder not ready! State: ${this.encoder?.state}`);
        }

        exportFrame.close();

        frameIndex++;

        // Update progress
        if (this.config.onProgress) {
          this.config.onProgress({
            currentFrame: frameIndex,
            totalFrames,
            percentage: (frameIndex / totalFrames) * 100,
            estimatedTimeRemaining: 0,
          });
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
    this.encodeQueue = 0;
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
        this.encodeQueue--;
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
   * Initialize AAC audio encoder
   */
  private async initializeAudioEncoder(): Promise<void> {
    if (!this.mixedAudioBuffer) {
      throw new Error('No audio buffer available');
    }

    this.audioEncodeQueue = 0;
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
        this.audioEncodeQueue--;
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

      // Wait for encoder queue to have space
      while (this.audioEncodeQueue >= this.MAX_AUDIO_ENCODE_QUEUE && !this.cancelled) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (this.audioEncoder.state === 'configured') {
        this.audioEncodeQueue++;
        this.audioEncoder.encode(audioDataObj);
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
    this.encodeQueue = 0;
    this.muxingPromises = [];
    this.chunkCount = 0;
    this.videoDescription = undefined;
    this.videoColorSpace = undefined;
    // Clean up audio state
    this.mixedAudioBuffer = null;
    this.audioEncodeQueue = 0;
    this.audioChunkCount = 0;
  }
}
