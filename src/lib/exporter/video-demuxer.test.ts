/**
 * Video Demuxer Unit Tests
 *
 * Tests for the VideoDemuxer class which wraps mediabunny for
 * extracting EncodedVideoChunks from video containers.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { VideoDemuxer, createDemuxerFromBlob, type DemuxerConfig } from './video-demuxer';

// Store mock instances for access in tests
let mockInputInstance: ReturnType<typeof createMockInput>;
let mockPacketSinkInstance: ReturnType<typeof createMockPacketSink>;

function createMockVideoTrack() {
  return {
    displayWidth: 1920,
    displayHeight: 1080,
    getDecoderConfig: vi.fn().mockResolvedValue({
      codec: 'vp09.00.10.08',
      codedWidth: 1920,
      codedHeight: 1080,
    }),
    computePacketStats: vi.fn().mockResolvedValue({
      averagePacketRate: 30,
      averageBitrate: 5000000,
      packetCount: 100,
    }),
  };
}

function createMockPacketSink() {
  return {
    getKeyPacket: vi.fn().mockResolvedValue({
      timestamp: 0,
      duration: 0.033,
      type: 'key',
      toEncodedVideoChunk: () => ({
        type: 'key',
        timestamp: 0,
        duration: 33000,
        byteLength: 1000,
      }),
    }),
    packets: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          timestamp: 0,
          duration: 0.033,
          type: 'key',
          toEncodedVideoChunk: () => ({
            type: 'key',
            timestamp: 0,
            duration: 33000,
            byteLength: 1000,
          }),
        };
        yield {
          timestamp: 0.033,
          duration: 0.033,
          type: 'delta',
          toEncodedVideoChunk: () => ({
            type: 'delta',
            timestamp: 33000,
            duration: 33000,
            byteLength: 500,
          }),
        };
      },
    }),
  };
}

function createMockInput() {
  const videoTrack = createMockVideoTrack();
  return {
    getPrimaryVideoTrack: vi.fn().mockResolvedValue(videoTrack),
    computeDuration: vi.fn().mockResolvedValue(10.0),
    dispose: vi.fn(),
    videoTrack,
  };
}

// Mock mediabunny module with proper class constructors
vi.mock('mediabunny', () => {
  return {
    Input: class MockInput {
      getPrimaryVideoTrack: Mock;
      computeDuration: Mock;
      dispose: Mock;

      constructor() {
        mockInputInstance = createMockInput();
        this.getPrimaryVideoTrack = mockInputInstance.getPrimaryVideoTrack;
        this.computeDuration = mockInputInstance.computeDuration;
        this.dispose = mockInputInstance.dispose;
      }
    },
    UrlSource: class MockUrlSource {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
    },
    EncodedPacketSink: class MockEncodedPacketSink {
      getKeyPacket: Mock;
      packets: Mock;

      constructor() {
        mockPacketSinkInstance = createMockPacketSink();
        this.getKeyPacket = mockPacketSinkInstance.getKeyPacket;
        this.packets = mockPacketSinkInstance.packets;
      }
    },
    MP4: { name: 'MP4' },
    WEBM: { name: 'WEBM' },
    MATROSKA: { name: 'MATROSKA' },
    QTFF: { name: 'QTFF' },
  };
});

// Mock VideoDecoder.isConfigSupported
const mockIsConfigSupported = vi.fn().mockResolvedValue({ supported: true });
vi.stubGlobal('VideoDecoder', {
  isConfigSupported: mockIsConfigSupported,
});

// Mock URL.createObjectURL and revokeObjectURL
const mockCreateObjectURL = vi.fn().mockReturnValue('blob:test-url');
const mockRevokeObjectURL = vi.fn();
vi.stubGlobal('URL', {
  createObjectURL: mockCreateObjectURL,
  revokeObjectURL: mockRevokeObjectURL,
});

describe('VideoDemuxer', () => {
  let demuxer: VideoDemuxer;
  const defaultConfig: DemuxerConfig = {
    videoUrl: 'http://example.com/test.webm',
    debug: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    demuxer = new VideoDemuxer(defaultConfig);
  });

  afterEach(() => {
    if (demuxer.isInitialized()) {
      demuxer.destroy();
    }
  });

  describe('initialization', () => {
    it('should initialize successfully with valid video URL', async () => {
      const result = await demuxer.initialize();

      expect(result).toBeDefined();
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.duration).toBe(10.0);
      expect(result.fps).toBe(30);
      expect(result.frameCount).toBe(300);
      expect(result.config).toBeDefined();
      expect(result.config.codec).toBe('vp09.00.10.08');
    });

    it('should set initialized state after successful init', async () => {
      expect(demuxer.isInitialized()).toBe(false);
      await demuxer.initialize();
      expect(demuxer.isInitialized()).toBe(true);
    });

    it('should throw if initialized twice', async () => {
      await demuxer.initialize();
      await expect(demuxer.initialize()).rejects.toThrow('already initialized');
    });

    it('should throw if codec is not supported', async () => {
      mockIsConfigSupported.mockResolvedValueOnce({ supported: false });
      await expect(demuxer.initialize()).rejects.toThrow('Unsupported codec');
    });
  });

  describe('state validation', () => {
    it('should throw on getChunksFromTimestamp before initialization', async () => {
      const generator = demuxer.getChunksFromTimestamp(0);
      await expect(generator.next()).rejects.toThrow('not initialized');
    });

    it('should throw on seekToKeyframe before initialization', async () => {
      await expect(demuxer.seekToKeyframe(0)).rejects.toThrow('not initialized');
    });

    it('should throw after destroy', async () => {
      await demuxer.initialize();
      demuxer.destroy();
      await expect(demuxer.initialize()).rejects.toThrow('has been destroyed');
    });

    it('should return null decoder config before initialization', () => {
      expect(demuxer.getDecoderConfig()).toBeNull();
    });
  });

  describe('getChunksFromTimestamp', () => {
    it('should yield EncodedVideoChunks', async () => {
      await demuxer.initialize();
      const chunks: Array<{ type: string; timestamp: number }> = [];

      for await (const chunk of demuxer.getChunksFromTimestamp(0)) {
        chunks.push(chunk);
        if (chunks.length >= 2) break;
      }

      expect(chunks.length).toBe(2);
      expect(chunks[0].type).toBe('key');
      expect(chunks[1].type).toBe('delta');
    });

    it('should stop at endTime', async () => {
      await demuxer.initialize();
      const chunks: Array<{ timestamp: number }> = [];

      for await (const chunk of demuxer.getChunksFromTimestamp(0, 0.02)) {
        chunks.push(chunk);
      }

      // Should only get the first chunk (timestamp 0), not the second (timestamp 0.033)
      expect(chunks.length).toBe(1);
    });
  });

  describe('seekToKeyframe', () => {
    it('should return keyframe timestamp', async () => {
      await demuxer.initialize();
      const timestamp = await demuxer.seekToKeyframe(5.0);
      expect(timestamp).toBe(0); // Mock returns timestamp 0
    });
  });

  describe('destroy', () => {
    it('should clean up resources', async () => {
      await demuxer.initialize();
      demuxer.destroy();

      expect(mockInputInstance.dispose).toHaveBeenCalled();
      expect(demuxer.isInitialized()).toBe(false);
    });

    it('should be idempotent', async () => {
      await demuxer.initialize();
      demuxer.destroy();
      demuxer.destroy(); // Should not throw
      expect(demuxer.isInitialized()).toBe(false);
    });

    it('should revoke object URL if set', async () => {
      demuxer.setObjectUrlToRevoke('blob:test-url-to-revoke');
      await demuxer.initialize();
      demuxer.destroy();

      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url-to-revoke');
    });
  });

  describe('getDecoderConfig', () => {
    it('should return config after initialization', async () => {
      await demuxer.initialize();
      const config = demuxer.getDecoderConfig();

      expect(config).toBeDefined();
      expect(config?.codec).toBe('vp09.00.10.08');
    });
  });
});

describe('createDemuxerFromBlob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create demuxer from blob', async () => {
    const blob = new Blob(['test'], { type: 'video/webm' });
    const { demuxer, result } = await createDemuxerFromBlob(blob);

    expect(demuxer).toBeInstanceOf(VideoDemuxer);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(mockCreateObjectURL).toHaveBeenCalledWith(blob);

    demuxer.destroy();
  });

  it('should revoke URL on destroy', async () => {
    const blob = new Blob(['test'], { type: 'video/webm' });
    const { demuxer } = await createDemuxerFromBlob(blob);

    demuxer.destroy();

    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });

  it('should cleanup on error', async () => {
    mockIsConfigSupported.mockResolvedValueOnce({ supported: false });

    const blob = new Blob(['test'], { type: 'video/webm' });

    await expect(createDemuxerFromBlob(blob)).rejects.toThrow('Unsupported codec');
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });
});
