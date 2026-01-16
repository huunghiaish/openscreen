import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DecodedFrameBuffer } from './decoded-frame-buffer';

// Mock VideoFrame for testing (not available in Node.js environment)
class MockVideoFrame {
  closed = false;
  timestamp: number;

  constructor(timestamp: number) {
    this.timestamp = timestamp;
  }

  close() {
    this.closed = true;
  }
}

describe('DecodedFrameBuffer', () => {
  let buffer: DecodedFrameBuffer;
  const frameRate = 30;

  beforeEach(() => {
    buffer = new DecodedFrameBuffer({ frameRate, maxFrames: 4, debug: false });
  });

  describe('constructor', () => {
    it('should throw if frameRate is not positive', () => {
      expect(() => new DecodedFrameBuffer({ frameRate: 0 })).toThrow('frameRate must be positive');
      expect(() => new DecodedFrameBuffer({ frameRate: -1 })).toThrow('frameRate must be positive');
    });

    it('should use default maxFrames of 16', () => {
      const defaultBuffer = new DecodedFrameBuffer({ frameRate: 30 });
      expect(defaultBuffer.getStats().maxSize).toBe(16);
    });

    it('should accept custom maxFrames', () => {
      expect(buffer.getStats().maxSize).toBe(4);
    });
  });

  describe('addFrame and buffer filling', () => {
    it('should add frames to buffer', () => {
      const frame = new MockVideoFrame(0) as unknown as VideoFrame;
      buffer.addFrame(frame);

      expect(buffer.size).toBe(1);
      expect(buffer.getStats().framesAdded).toBe(1);
    });

    it('should detect when buffer is full', () => {
      expect(buffer.isFull()).toBe(false);

      for (let i = 0; i < 4; i++) {
        const frame = new MockVideoFrame(i * 33333) as unknown as VideoFrame; // ~30fps timestamps
        buffer.addFrame(frame);
      }

      expect(buffer.isFull()).toBe(true);
      expect(buffer.size).toBe(4);
    });

    it('should evict oldest frame when buffer is full', () => {
      const frames: MockVideoFrame[] = [];
      for (let i = 0; i < 5; i++) {
        const frame = new MockVideoFrame(i * 33333);
        frames.push(frame);
        buffer.addFrame(frame as unknown as VideoFrame);
      }

      // Buffer should still be at max size
      expect(buffer.size).toBe(4);
      // First frame should have been evicted and closed
      expect(frames[0].closed).toBe(true);
      // Other frames should still be open
      expect(frames[1].closed).toBe(false);
      expect(buffer.getStats().framesEvicted).toBe(1);
    });

    it('should close frame on eviction', () => {
      const evictedFrame = new MockVideoFrame(0);
      buffer.addFrame(evictedFrame as unknown as VideoFrame);

      // Fill buffer to trigger eviction
      for (let i = 1; i <= 4; i++) {
        buffer.addFrame(new MockVideoFrame(i * 33333) as unknown as VideoFrame);
      }

      expect(evictedFrame.closed).toBe(true);
    });
  });

  describe('frame retrieval by index', () => {
    it('should find frame by index using timestamp conversion', () => {
      // Frame at index 0 = timestamp 0
      const frame0 = new MockVideoFrame(0) as unknown as VideoFrame;
      buffer.addFrame(frame0);

      expect(buffer.hasFrame(0)).toBe(true);
      expect(buffer.getFrame(0)).toBe(frame0);
    });

    it('should find frame within timestamp tolerance', () => {
      // 30fps = 33333µs per frame, tolerance = 16666µs
      // Frame at timestamp 1000 should match index 0 (target 0µs, tolerance 16666µs)
      const frame = new MockVideoFrame(1000) as unknown as VideoFrame;
      buffer.addFrame(frame);

      expect(buffer.hasFrame(0)).toBe(true);
      expect(buffer.getFrame(0)).toBe(frame);
    });

    it('should not find frame outside tolerance', () => {
      // Frame at 50000µs should NOT match index 0 (tolerance ~16666µs)
      const frame = new MockVideoFrame(50000) as unknown as VideoFrame;
      buffer.addFrame(frame);

      expect(buffer.hasFrame(0)).toBe(false);
      expect(buffer.getFrame(0)).toBeNull();
    });

    it('should return null for missing frame', () => {
      expect(buffer.hasFrame(0)).toBe(false);
      expect(buffer.getFrame(0)).toBeNull();
    });

    it('should not remove frame when using getFrame', () => {
      const frame = new MockVideoFrame(0) as unknown as VideoFrame;
      buffer.addFrame(frame);

      buffer.getFrame(0);
      buffer.getFrame(0);

      expect(buffer.size).toBe(1);
      expect(buffer.hasFrame(0)).toBe(true);
    });
  });

  describe('consumeFrame', () => {
    it('should return and remove frame from buffer', () => {
      const frame = new MockVideoFrame(0) as unknown as VideoFrame;
      buffer.addFrame(frame);

      const consumed = buffer.consumeFrame(0);

      expect(consumed).toBe(frame);
      expect(buffer.size).toBe(0);
      expect(buffer.hasFrame(0)).toBe(false);
      expect(buffer.getStats().framesConsumed).toBe(1);
    });

    it('should return null for missing frame', () => {
      const consumed = buffer.consumeFrame(0);
      expect(consumed).toBeNull();
    });

    it('should not close consumed frame (consumer responsibility)', () => {
      const frame = new MockVideoFrame(0);
      buffer.addFrame(frame as unknown as VideoFrame);

      buffer.consumeFrame(0);

      expect(frame.closed).toBe(false);
    });
  });

  describe('backpressure with waitForSpace', () => {
    it('should resolve immediately if buffer has space', async () => {
      const promise = buffer.waitForSpace();
      await expect(promise).resolves.toBeUndefined();
    });

    it('should wait when buffer is full', async () => {
      // Fill buffer
      for (let i = 0; i < 4; i++) {
        buffer.addFrame(new MockVideoFrame(i * 33333) as unknown as VideoFrame);
      }

      let resolved = false;
      const waitPromise = buffer.waitForSpace().then(() => {
        resolved = true;
      });

      // Should not resolve yet
      await vi.waitFor(() => {
        expect(resolved).toBe(false);
      }, { timeout: 10 });

      // Consume a frame to make space
      buffer.consumeFrame(0);

      await waitPromise;
      expect(resolved).toBe(true);
    });

    it('should resolve multiple waiters FIFO', async () => {
      // Fill buffer
      for (let i = 0; i < 4; i++) {
        buffer.addFrame(new MockVideoFrame(i * 33333) as unknown as VideoFrame);
      }

      const order: number[] = [];

      const wait1 = buffer.waitForSpace().then(() => order.push(1));
      const wait2 = buffer.waitForSpace().then(() => order.push(2));

      // Consume frames to trigger waiters
      buffer.consumeFrame(0);
      buffer.consumeFrame(1);

      await Promise.all([wait1, wait2]);
      expect(order).toEqual([1, 2]);
    });
  });

  describe('flush', () => {
    it('should return all frames without closing them', () => {
      const frames: MockVideoFrame[] = [];
      for (let i = 0; i < 3; i++) {
        const frame = new MockVideoFrame(i * 33333);
        frames.push(frame);
        buffer.addFrame(frame as unknown as VideoFrame);
      }

      const flushed = buffer.flush();

      expect(flushed).toHaveLength(3);
      expect(buffer.size).toBe(0);
      // Frames should not be closed
      frames.forEach(f => expect(f.closed).toBe(false));
    });

    it('should return frames in timestamp order', () => {
      // Add frames in random order
      buffer.addFrame(new MockVideoFrame(66666) as unknown as VideoFrame);
      buffer.addFrame(new MockVideoFrame(0) as unknown as VideoFrame);
      buffer.addFrame(new MockVideoFrame(33333) as unknown as VideoFrame);

      const flushed = buffer.flush();

      expect(flushed[0].timestamp).toBe(0);
      expect(flushed[1].timestamp).toBe(33333);
      expect(flushed[2].timestamp).toBe(66666);
    });

    it('should resolve pending waiters after flush', async () => {
      // Fill buffer
      for (let i = 0; i < 4; i++) {
        buffer.addFrame(new MockVideoFrame(i * 33333) as unknown as VideoFrame);
      }

      let resolved = false;
      const waitPromise = buffer.waitForSpace().then(() => {
        resolved = true;
      });

      buffer.flush();

      await waitPromise;
      expect(resolved).toBe(true);
    });
  });

  describe('reset', () => {
    it('should close all buffered frames', () => {
      const frames: MockVideoFrame[] = [];
      for (let i = 0; i < 3; i++) {
        const frame = new MockVideoFrame(i * 33333);
        frames.push(frame);
        buffer.addFrame(frame as unknown as VideoFrame);
      }

      buffer.reset();

      frames.forEach(f => expect(f.closed).toBe(true));
      expect(buffer.size).toBe(0);
    });

    it('should reset all statistics', () => {
      buffer.addFrame(new MockVideoFrame(0) as unknown as VideoFrame);
      buffer.consumeFrame(0);

      buffer.reset();

      const stats = buffer.getStats();
      expect(stats.framesAdded).toBe(0);
      expect(stats.framesConsumed).toBe(0);
      expect(stats.framesEvicted).toBe(0);
    });

    it('should resolve pending waiters', async () => {
      // Fill buffer
      for (let i = 0; i < 4; i++) {
        buffer.addFrame(new MockVideoFrame(i * 33333) as unknown as VideoFrame);
      }

      let resolved = false;
      const waitPromise = buffer.waitForSpace().then(() => {
        resolved = true;
      });

      buffer.reset();

      await waitPromise;
      expect(resolved).toBe(true);
    });
  });

  describe('destroy', () => {
    it('should call reset and clean up', () => {
      const frame = new MockVideoFrame(0);
      buffer.addFrame(frame as unknown as VideoFrame);

      buffer.destroy();

      expect(frame.closed).toBe(true);
      expect(buffer.size).toBe(0);
    });
  });

  describe('statistics', () => {
    it('should track oldest and newest timestamps', () => {
      buffer.addFrame(new MockVideoFrame(100000) as unknown as VideoFrame);
      buffer.addFrame(new MockVideoFrame(50000) as unknown as VideoFrame);
      buffer.addFrame(new MockVideoFrame(200000) as unknown as VideoFrame);

      const stats = buffer.getStats();
      expect(stats.oldestTimestamp).toBe(50000);
      expect(stats.newestTimestamp).toBe(200000);
    });

    it('should return null timestamps when empty', () => {
      const stats = buffer.getStats();
      expect(stats.oldestTimestamp).toBeNull();
      expect(stats.newestTimestamp).toBeNull();
    });
  });

  describe('index to timestamp conversion', () => {
    it('should correctly convert frame index to timestamp at 30fps', () => {
      // At 30fps: frame 0 = 0µs, frame 1 = 33333µs, frame 30 = 1000000µs (1 second)
      const buffer30 = new DecodedFrameBuffer({ frameRate: 30 });

      const frame0 = new MockVideoFrame(0) as unknown as VideoFrame;
      const frame1 = new MockVideoFrame(33333) as unknown as VideoFrame;
      const frame30 = new MockVideoFrame(1000000) as unknown as VideoFrame;

      buffer30.addFrame(frame0);
      buffer30.addFrame(frame1);
      buffer30.addFrame(frame30);

      expect(buffer30.hasFrame(0)).toBe(true);
      expect(buffer30.hasFrame(1)).toBe(true);
      expect(buffer30.hasFrame(30)).toBe(true);
    });

    it('should correctly convert frame index to timestamp at 60fps', () => {
      // At 60fps: frame 0 = 0µs, frame 1 = 16666µs, frame 60 = 1000000µs
      const buffer60 = new DecodedFrameBuffer({ frameRate: 60 });

      const frame0 = new MockVideoFrame(0) as unknown as VideoFrame;
      const frame1 = new MockVideoFrame(16666) as unknown as VideoFrame;

      buffer60.addFrame(frame0);
      buffer60.addFrame(frame1);

      expect(buffer60.hasFrame(0)).toBe(true);
      expect(buffer60.hasFrame(1)).toBe(true);
    });
  });

  describe('concurrent producer/consumer stress test', () => {
    it('should handle rapid concurrent add and consume operations', async () => {
      const largeBuffer = new DecodedFrameBuffer({ frameRate: 60, maxFrames: 8 });
      const totalFrames = 100;
      const addedFrames: MockVideoFrame[] = [];
      const consumedFrames: VideoFrame[] = [];
      let producerDone = false;

      // Producer: adds frames rapidly
      const producer = async () => {
        for (let i = 0; i < totalFrames; i++) {
          if (largeBuffer.isFull()) {
            await largeBuffer.waitForSpace();
          }
          const frame = new MockVideoFrame(i * 16666);
          addedFrames.push(frame);
          largeBuffer.addFrame(frame as unknown as VideoFrame);
        }
        producerDone = true;
      };

      // Consumer: consumes frames as they arrive
      const consumer = async () => {
        let consumed = 0;
        while (consumed < totalFrames) {
          if (largeBuffer.hasFrame(consumed)) {
            const frame = largeBuffer.consumeFrame(consumed);
            if (frame) {
              consumedFrames.push(frame);
              consumed++;
            }
          } else if (producerDone && consumed >= totalFrames) {
            break;
          } else {
            // Wait a tick before retrying
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
      };

      await Promise.all([producer(), consumer()]);

      // Verify all frames were consumed
      expect(consumedFrames.length).toBe(totalFrames);

      // Verify no frames were lost or closed prematurely
      for (let i = 0; i < totalFrames; i++) {
        expect(addedFrames[i].closed).toBe(false);
        expect(consumedFrames[i].timestamp).toBe(i * 16666);
      }

      // Clean up stats
      const stats = largeBuffer.getStats();
      expect(stats.framesAdded).toBe(totalFrames);
      expect(stats.framesConsumed).toBe(totalFrames);
      expect(largeBuffer.size).toBe(0);
    });

    it('should maintain sorted order under random insertion', () => {
      const randomBuffer = new DecodedFrameBuffer({ frameRate: 30, maxFrames: 20 });

      // Add frames in random order
      const timestamps = [100000, 33333, 200000, 0, 66666, 133333, 166666];
      for (const ts of timestamps) {
        randomBuffer.addFrame(new MockVideoFrame(ts) as unknown as VideoFrame);
      }

      // Flush should return in sorted order
      const flushed = randomBuffer.flush();
      const sortedTimestamps = [...timestamps].sort((a, b) => a - b);

      expect(flushed.map(f => f.timestamp)).toEqual(sortedTimestamps);
    });

    it('should handle VFR content with custom tolerance', () => {
      // Simulate VFR: 30fps average but with variation
      const vfrBuffer = new DecodedFrameBuffer({
        frameRate: 30,
        maxFrames: 16,
        timestampTolerance: 50000, // 1.5x frame duration for VFR
      });

      // VFR frames with slight timing drift
      vfrBuffer.addFrame(new MockVideoFrame(500) as unknown as VideoFrame);    // Should match index 0 (target: 0)
      vfrBuffer.addFrame(new MockVideoFrame(35000) as unknown as VideoFrame);  // Should match index 1 (target: 33333)
      vfrBuffer.addFrame(new MockVideoFrame(68000) as unknown as VideoFrame);  // Should match index 2 (target: 66666)

      expect(vfrBuffer.hasFrame(0)).toBe(true);
      expect(vfrBuffer.hasFrame(1)).toBe(true);
      expect(vfrBuffer.hasFrame(2)).toBe(true);
    });
  });

  describe('binary search edge cases', () => {
    it('should find frame at buffer boundaries', () => {
      // Add exactly maxFrames frames
      for (let i = 0; i < 4; i++) {
        buffer.addFrame(new MockVideoFrame(i * 33333) as unknown as VideoFrame);
      }

      // Should find first and last frames
      expect(buffer.hasFrame(0)).toBe(true);
      expect(buffer.hasFrame(3)).toBe(true);
    });

    it('should handle single frame in buffer', () => {
      buffer.addFrame(new MockVideoFrame(33333) as unknown as VideoFrame);

      expect(buffer.hasFrame(1)).toBe(true);
      expect(buffer.hasFrame(0)).toBe(false); // Tolerance check
      expect(buffer.hasFrame(2)).toBe(false);
    });
  });
});
