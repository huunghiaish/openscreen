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
    it('should add frames to buffer with decode index', () => {
      const frame = new MockVideoFrame(0) as unknown as VideoFrame;
      buffer.addFrame(frame, 0);

      expect(buffer.size).toBe(1);
      expect(buffer.getStats().framesAdded).toBe(1);
    });

    it('should detect when buffer is full', () => {
      expect(buffer.isFull()).toBe(false);

      for (let i = 0; i < 4; i++) {
        const frame = new MockVideoFrame(i * 33333) as unknown as VideoFrame;
        buffer.addFrame(frame, i);
      }

      expect(buffer.isFull()).toBe(true);
      expect(buffer.size).toBe(4);
    });

    it('should drop new frames when buffer is full', () => {
      const frames: MockVideoFrame[] = [];
      for (let i = 0; i < 5; i++) {
        const frame = new MockVideoFrame(i * 33333);
        frames.push(frame);
        buffer.addFrame(frame as unknown as VideoFrame, i);
      }

      // Buffer should still be at max size
      expect(buffer.size).toBe(4);
      // First 4 frames should still be in buffer
      expect(frames[0].closed).toBe(false);
      expect(frames[1].closed).toBe(false);
      expect(frames[2].closed).toBe(false);
      expect(frames[3].closed).toBe(false);
      // 5th frame was dropped (closed) because buffer was full
      expect(frames[4].closed).toBe(true);
    });
  });

  describe('frame retrieval by index', () => {
    it('should find frame by decode index', () => {
      const frame0 = new MockVideoFrame(0) as unknown as VideoFrame;
      buffer.addFrame(frame0, 0);

      expect(buffer.hasFrame(0)).toBe(true);
      expect(buffer.getFrame(0)).toBe(frame0);
    });

    it('should find frames with any decode index', () => {
      const frame5 = new MockVideoFrame(500) as unknown as VideoFrame;
      const frame10 = new MockVideoFrame(1000) as unknown as VideoFrame;
      buffer.addFrame(frame5, 5);
      buffer.addFrame(frame10, 10);

      expect(buffer.hasFrame(5)).toBe(true);
      expect(buffer.hasFrame(10)).toBe(true);
      expect(buffer.getFrame(5)).toBe(frame5);
      expect(buffer.getFrame(10)).toBe(frame10);
    });

    it('should return null for missing frame index', () => {
      buffer.addFrame(new MockVideoFrame(0) as unknown as VideoFrame, 0);

      expect(buffer.hasFrame(1)).toBe(false);
      expect(buffer.getFrame(1)).toBeNull();
    });

    it('should not remove frame when using getFrame', () => {
      const frame = new MockVideoFrame(0) as unknown as VideoFrame;
      buffer.addFrame(frame, 0);

      buffer.getFrame(0);
      buffer.getFrame(0);

      expect(buffer.size).toBe(1);
      expect(buffer.hasFrame(0)).toBe(true);
    });
  });

  describe('consumeFrame', () => {
    it('should return and remove frame from buffer', () => {
      const frame = new MockVideoFrame(0) as unknown as VideoFrame;
      buffer.addFrame(frame, 0);

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
      buffer.addFrame(frame as unknown as VideoFrame, 0);

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
        buffer.addFrame(new MockVideoFrame(i * 33333) as unknown as VideoFrame, i);
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
        buffer.addFrame(new MockVideoFrame(i * 33333) as unknown as VideoFrame, i);
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
        buffer.addFrame(frame as unknown as VideoFrame, i);
      }

      const flushed = buffer.flush();

      expect(flushed).toHaveLength(3);
      expect(buffer.size).toBe(0);
      // Frames should not be closed
      frames.forEach(f => expect(f.closed).toBe(false));
    });

    it('should return frames in index order', () => {
      // Add frames in random order
      buffer.addFrame(new MockVideoFrame(66666) as unknown as VideoFrame, 2);
      buffer.addFrame(new MockVideoFrame(0) as unknown as VideoFrame, 0);
      buffer.addFrame(new MockVideoFrame(33333) as unknown as VideoFrame, 1);

      const flushed = buffer.flush();

      // Should be sorted by index (0, 1, 2), which corresponds to timestamps 0, 33333, 66666
      expect(flushed[0].timestamp).toBe(0);
      expect(flushed[1].timestamp).toBe(33333);
      expect(flushed[2].timestamp).toBe(66666);
    });

    it('should resolve pending waiters after flush', async () => {
      // Fill buffer
      for (let i = 0; i < 4; i++) {
        buffer.addFrame(new MockVideoFrame(i * 33333) as unknown as VideoFrame, i);
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
        buffer.addFrame(frame as unknown as VideoFrame, i);
      }

      buffer.reset();

      frames.forEach(f => expect(f.closed).toBe(true));
      expect(buffer.size).toBe(0);
    });

    it('should reset all statistics', () => {
      buffer.addFrame(new MockVideoFrame(0) as unknown as VideoFrame, 0);
      buffer.consumeFrame(0);

      buffer.reset();

      const stats = buffer.getStats();
      expect(stats.framesAdded).toBe(0);
      expect(stats.framesConsumed).toBe(0);
    });

    it('should resolve pending waiters', async () => {
      // Fill buffer
      for (let i = 0; i < 4; i++) {
        buffer.addFrame(new MockVideoFrame(i * 33333) as unknown as VideoFrame, i);
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
      buffer.addFrame(frame as unknown as VideoFrame, 0);

      buffer.destroy();

      expect(frame.closed).toBe(true);
      expect(buffer.size).toBe(0);
    });
  });

  describe('statistics', () => {
    it('should track min and max indices', () => {
      buffer.addFrame(new MockVideoFrame(100000) as unknown as VideoFrame, 3);
      buffer.addFrame(new MockVideoFrame(50000) as unknown as VideoFrame, 1);
      buffer.addFrame(new MockVideoFrame(200000) as unknown as VideoFrame, 6);

      const stats = buffer.getStats();
      expect(stats.minIndex).toBe(1);
      expect(stats.maxIndex).toBe(6);
    });

    it('should return null indices when empty', () => {
      const stats = buffer.getStats();
      expect(stats.minIndex).toBeNull();
      expect(stats.maxIndex).toBeNull();
    });
  });

  describe('index-based lookup', () => {
    it('should correctly find frames by decode index', () => {
      const buffer30 = new DecodedFrameBuffer({ frameRate: 30 });

      const frame0 = new MockVideoFrame(0) as unknown as VideoFrame;
      const frame1 = new MockVideoFrame(33333) as unknown as VideoFrame;
      const frame30 = new MockVideoFrame(1000000) as unknown as VideoFrame;

      buffer30.addFrame(frame0, 0);
      buffer30.addFrame(frame1, 1);
      buffer30.addFrame(frame30, 30);

      expect(buffer30.hasFrame(0)).toBe(true);
      expect(buffer30.hasFrame(1)).toBe(true);
      expect(buffer30.hasFrame(30)).toBe(true);
      expect(buffer30.hasFrame(2)).toBe(false);
    });

    it('should support non-sequential indices', () => {
      const buffer60 = new DecodedFrameBuffer({ frameRate: 60 });

      buffer60.addFrame(new MockVideoFrame(0) as unknown as VideoFrame, 0);
      buffer60.addFrame(new MockVideoFrame(50000) as unknown as VideoFrame, 3);
      buffer60.addFrame(new MockVideoFrame(100000) as unknown as VideoFrame, 6);

      expect(buffer60.hasFrame(0)).toBe(true);
      expect(buffer60.hasFrame(3)).toBe(true);
      expect(buffer60.hasFrame(6)).toBe(true);
      expect(buffer60.hasFrame(1)).toBe(false);
      expect(buffer60.hasFrame(2)).toBe(false);
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
          largeBuffer.addFrame(frame as unknown as VideoFrame, i);
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

    it('should return frames in index order when flushed', () => {
      const randomBuffer = new DecodedFrameBuffer({ frameRate: 30, maxFrames: 20 });

      // Add frames in random order with non-sequential indices
      const entries = [
        { index: 3, ts: 100000 },
        { index: 1, ts: 33333 },
        { index: 6, ts: 200000 },
        { index: 0, ts: 0 },
        { index: 2, ts: 66666 },
        { index: 4, ts: 133333 },
        { index: 5, ts: 166666 },
      ];
      for (const { index, ts } of entries) {
        randomBuffer.addFrame(new MockVideoFrame(ts) as unknown as VideoFrame, index);
      }

      // Flush should return in index order
      const flushed = randomBuffer.flush();
      const expectedTimestamps = [0, 33333, 66666, 100000, 133333, 166666, 200000];

      expect(flushed.map(f => f.timestamp)).toEqual(expectedTimestamps);
    });
  });

  describe('edge cases', () => {
    it('should find frame at buffer boundaries', () => {
      // Add exactly maxFrames frames
      for (let i = 0; i < 4; i++) {
        buffer.addFrame(new MockVideoFrame(i * 33333) as unknown as VideoFrame, i);
      }

      // Should find first and last frames
      expect(buffer.hasFrame(0)).toBe(true);
      expect(buffer.hasFrame(3)).toBe(true);
    });

    it('should handle single frame in buffer', () => {
      buffer.addFrame(new MockVideoFrame(33333) as unknown as VideoFrame, 5);

      expect(buffer.hasFrame(5)).toBe(true);
      expect(buffer.hasFrame(0)).toBe(false);
      expect(buffer.hasFrame(4)).toBe(false);
      expect(buffer.hasFrame(6)).toBe(false);
    });
  });
});
