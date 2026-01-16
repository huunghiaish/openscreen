/**
 * Video Demuxer Wrapper
 *
 * Unified demuxer that extracts EncodedVideoChunks from video containers (MP4/WebM)
 * using mediabunny. Abstracts container format differences and provides a consistent
 * interface for WebCodecs VideoDecoder consumption.
 */

import {
  Input,
  UrlSource,
  BlobSource,
  MP4,
  WEBM,
  MATROSKA,
  QTFF,
  EncodedPacketSink,
  type InputVideoTrack,
  type Source,
} from 'mediabunny';

// Supported input formats for video demuxing (priority order)
const SUPPORTED_VIDEO_FORMATS = [WEBM, MP4, MATROSKA, QTFF];

/**
 * Configuration for initializing the VideoDemuxer
 */
export interface DemuxerConfig {
  /** URL to the video file (file:// or http(s)://) */
  videoUrl: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Result returned after successful initialization
 */
export interface DemuxerResult {
  /** VideoDecoder configuration extracted from the video track */
  config: VideoDecoderConfig;
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
  /** Video duration in seconds */
  duration: number;
  /** Estimated frame count */
  frameCount: number;
  /** Estimated frames per second */
  fps: number;
}

/**
 * VideoDemuxer - Extracts EncodedVideoChunks from MP4/WebM containers
 *
 * Uses mediabunny for container parsing and provides:
 * - Async iterator for chunks in decode order
 * - Keyframe seeking
 * - Memory-efficient streaming (no full-file buffering)
 */
export class VideoDemuxer {
  private config: DemuxerConfig;
  private input: Input | null = null;
  private source: Source | null = null;
  private videoTrack: InputVideoTrack | null = null;
  private packetSink: EncodedPacketSink | null = null;
  private decoderConfig: VideoDecoderConfig | null = null;
  private initialized = false;
  private destroyed = false;
  /** Object URL to revoke on destroy (for blob-based sources) */
  private objectUrlToRevoke: string | null = null;

  constructor(config: DemuxerConfig) {
    this.config = config;
  }

  /**
   * Set an object URL to be revoked when this demuxer is destroyed
   * Used internally by createDemuxerFromBlob
   */
  setObjectUrlToRevoke(url: string): void {
    this.objectUrlToRevoke = url;
  }

  /**
   * Initialize the demuxer - loads video and extracts metadata
   * @returns DemuxerResult with video metadata and decoder config
   * @throws Error if video cannot be loaded or codec is unsupported
   */
  async initialize(): Promise<DemuxerResult> {
    if (this.destroyed) {
      throw new Error('VideoDemuxer has been destroyed');
    }

    if (this.initialized) {
      throw new Error('VideoDemuxer already initialized');
    }

    this.log('Initializing with URL:', this.config.videoUrl);

    try {
      // Create source - use BlobSource for file:// URLs (UrlSource doesn't support them)
      this.source = await this.createSource(this.config.videoUrl);

      // Create Input with supported video formats
      this.input = new Input({
        source: this.source,
        formats: SUPPORTED_VIDEO_FORMATS,
      });

      // Get primary video track
      this.videoTrack = await this.input.getPrimaryVideoTrack();
      if (!this.videoTrack) {
        throw new Error('No video track found in file');
      }

      // Get decoder configuration
      this.decoderConfig = await this.videoTrack.getDecoderConfig();
      if (!this.decoderConfig) {
        throw new Error('Could not extract decoder configuration');
      }

      // Validate codec support with WebCodecs
      const support = await VideoDecoder.isConfigSupported(this.decoderConfig);
      if (!support.supported) {
        throw new Error(`Unsupported codec: ${this.decoderConfig.codec}`);
      }

      this.log('Decoder config:', this.decoderConfig.codec);

      // Create packet sink for retrieving encoded packets
      this.packetSink = new EncodedPacketSink(this.videoTrack);

      // Get video metadata
      const duration = await this.input.computeDuration();
      const width = this.videoTrack.displayWidth;
      const height = this.videoTrack.displayHeight;

      // Estimate frame rate from packet stats (sample first 100 packets)
      const packetStats = await this.videoTrack.computePacketStats(100);
      const fps = packetStats.averagePacketRate || 30; // Default to 30 if unknown
      const frameCount = Math.ceil(duration * fps);

      this.initialized = true;

      this.log(`Initialized: ${width}x${height}, ${duration.toFixed(2)}s, ~${fps.toFixed(1)}fps`);

      return {
        config: this.decoderConfig,
        width,
        height,
        duration,
        frameCount,
        fps,
      };
    } catch (error) {
      // Cleanup on error
      this.destroy();
      throw error;
    }
  }

  /**
   * Get EncodedVideoChunks starting from a timestamp
   * Yields chunks in decode order (not presentation order for B-frames)
   *
   * @param startTime Start timestamp in seconds (seeks to nearest keyframe before this time)
   * @param endTime Optional end timestamp in seconds
   * @yields EncodedVideoChunk in decode order
   */
  async *getChunksFromTimestamp(
    startTime = 0,
    endTime = Infinity
  ): AsyncGenerator<EncodedVideoChunk, void, unknown> {
    this.ensureInitialized();

    this.log(`Getting chunks from ${startTime.toFixed(3)}s to ${endTime === Infinity ? 'end' : endTime.toFixed(3) + 's'}`);

    // Get keyframe at or before start time
    const keyPacket = await this.packetSink!.getKeyPacket(startTime, { verifyKeyPackets: true });
    if (!keyPacket) {
      this.log('No keyframe found at or before start time');
      return;
    }

    this.log(`Starting from keyframe at ${keyPacket.timestamp.toFixed(3)}s`);

    // Iterate packets in decode order
    const packets = this.packetSink!.packets(keyPacket);

    for await (const packet of packets) {
      // Stop if we've passed the end time (check presentation timestamp)
      if (packet.timestamp >= endTime) {
        this.log(`Reached end time at ${packet.timestamp.toFixed(3)}s`);
        break;
      }

      // Convert to EncodedVideoChunk (handles timestamp conversion to microseconds)
      yield packet.toEncodedVideoChunk();
    }
  }

  /**
   * Seek to the nearest keyframe at or before the given timestamp
   *
   * @param timestamp Target timestamp in seconds
   * @returns Actual keyframe timestamp in seconds, or null if not found
   */
  async seekToKeyframe(timestamp: number): Promise<number | null> {
    this.ensureInitialized();

    const keyPacket = await this.packetSink!.getKeyPacket(timestamp, { verifyKeyPackets: true });
    if (!keyPacket) {
      this.log(`No keyframe found at or before ${timestamp.toFixed(3)}s`);
      return null;
    }

    this.log(`Seeked to keyframe at ${keyPacket.timestamp.toFixed(3)}s (requested: ${timestamp.toFixed(3)}s)`);
    return keyPacket.timestamp;
  }

  /**
   * Get the VideoDecoderConfig for configuring a VideoDecoder
   */
  getDecoderConfig(): VideoDecoderConfig | null {
    return this.decoderConfig;
  }

  /**
   * Check if the demuxer is ready for use
   */
  isInitialized(): boolean {
    return this.initialized && !this.destroyed;
  }

  /**
   * Release all resources
   */
  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.log('Destroying demuxer');

    this.destroyed = true;
    this.initialized = false;

    // Dispose mediabunny Input (which also disposes the source)
    if (this.input) {
      this.input.dispose();
      this.input = null;
    }

    // Revoke object URL if one was created (prevents memory leak)
    if (this.objectUrlToRevoke) {
      URL.revokeObjectURL(this.objectUrlToRevoke);
      this.objectUrlToRevoke = null;
    }

    this.source = null;
    this.videoTrack = null;
    this.packetSink = null;
    this.decoderConfig = null;
  }

  /**
   * Create appropriate Source based on URL protocol
   * - file:// URLs: Fetch as Blob, use BlobSource (UrlSource doesn't support file://)
   * - http(s):// URLs: Use UrlSource directly
   */
  private async createSource(url: string): Promise<Source> {
    const isFileUrl = url.startsWith('file://');

    if (isFileUrl) {
      this.log('Fetching file:// URL as Blob');
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      this.log(`Loaded ${(blob.size / 1024 / 1024).toFixed(1)}MB as Blob`);
      return new BlobSource(blob);
    }

    // HTTP(S) URLs work with UrlSource
    return new UrlSource(url);
  }

  /**
   * Ensure the demuxer is initialized before operations
   */
  private ensureInitialized(): void {
    if (this.destroyed) {
      throw new Error('VideoDemuxer has been destroyed');
    }
    if (!this.initialized) {
      throw new Error('VideoDemuxer not initialized - call initialize() first');
    }
  }

  /**
   * Debug logging helper
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[VideoDemuxer]', ...args);
    }
  }
}

/**
 * Create a VideoDemuxer from a Blob (e.g., File)
 * Useful for user-uploaded files
 *
 * @param blob Video file as Blob
 * @param options Debug options
 * @returns Demuxer instance and initialization result
 * @note The object URL is automatically revoked when demuxer.destroy() is called
 */
export async function createDemuxerFromBlob(
  blob: Blob,
  options: { debug?: boolean } = {}
): Promise<{ demuxer: VideoDemuxer; result: DemuxerResult }> {
  // Create object URL from blob
  const videoUrl = URL.createObjectURL(blob);

  const demuxer = new VideoDemuxer({
    videoUrl,
    debug: options.debug,
  });

  // Register URL for cleanup on destroy
  demuxer.setObjectUrlToRevoke(videoUrl);

  try {
    const result = await demuxer.initialize();
    return { demuxer, result };
  } catch (error) {
    // Error path: destroy() will revoke the URL
    demuxer.destroy();
    throw error;
  }
}
