import { describe, it, expect, beforeEach } from 'vitest';
import { FrameReassembler } from './frame-reassembler';

// Mock VideoFrame for testing (not available in Node.js environment)
class MockVideoFrame {
  closed = false;
  close() {
    this.closed = true;
  }
}

describe('FrameReassembler', () => {
  let reassembler: FrameReassembler;

  beforeEach(() => {
    reassembler = new FrameReassembler({ debug: false });
  });

  describe('in-order frame collection', () => {
    it('should return frame immediately when in order', () => {
      const frame0 = new MockVideoFrame() as unknown as VideoFrame;
      const result = reassembler.addFrame(0, frame0);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(frame0);
      expect(reassembler.getNextExpected()).toBe(1);
    });

    it('should return multiple consecutive frames', () => {
      const frame0 = new MockVideoFrame() as unknown as VideoFrame;
      const frame1 = new MockVideoFrame() as unknown as VideoFrame;
      const frame2 = new MockVideoFrame() as unknown as VideoFrame;

      const result0 = reassembler.addFrame(0, frame0);
      expect(result0).toHaveLength(1);

      const result1 = reassembler.addFrame(1, frame1);
      expect(result1).toHaveLength(1);

      const result2 = reassembler.addFrame(2, frame2);
      expect(result2).toHaveLength(1);

      expect(reassembler.getNextExpected()).toBe(3);
      expect(reassembler.getBufferSize()).toBe(0);
    });
  });

  describe('out-of-order buffering', () => {
    it('should buffer out-of-order frames', () => {
      const frame1 = new MockVideoFrame() as unknown as VideoFrame;

      const result = reassembler.addFrame(1, frame1);

      expect(result).toHaveLength(0);
      expect(reassembler.getBufferSize()).toBe(1);
      expect(reassembler.getNextExpected()).toBe(0);
    });

    it('should release buffered frames when gap is filled', () => {
      const frame0 = new MockVideoFrame() as unknown as VideoFrame;
      const frame1 = new MockVideoFrame() as unknown as VideoFrame;
      const frame2 = new MockVideoFrame() as unknown as VideoFrame;

      // Add frames out of order
      reassembler.addFrame(2, frame2);
      reassembler.addFrame(1, frame1);

      expect(reassembler.getBufferSize()).toBe(2);
      expect(reassembler.getNextExpected()).toBe(0);

      // Fill the gap
      const result = reassembler.addFrame(0, frame0);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe(frame0);
      expect(result[1]).toBe(frame1);
      expect(result[2]).toBe(frame2);
      expect(reassembler.getBufferSize()).toBe(0);
      expect(reassembler.getNextExpected()).toBe(3);
    });

    it('should handle non-consecutive frame gaps', () => {
      const frame0 = new MockVideoFrame() as unknown as VideoFrame;
      const frame2 = new MockVideoFrame() as unknown as VideoFrame;
      const frame4 = new MockVideoFrame() as unknown as VideoFrame;

      reassembler.addFrame(4, frame4);
      reassembler.addFrame(2, frame2);

      expect(reassembler.getBufferSize()).toBe(2);

      const result = reassembler.addFrame(0, frame0);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(frame0);
      expect(reassembler.getBufferSize()).toBe(2); // Still waiting for frames 1 and 3
      expect(reassembler.getNextExpected()).toBe(1);
    });
  });

  describe('statistics tracking', () => {
    it('should track total received and released', () => {
      const frame0 = new MockVideoFrame() as unknown as VideoFrame;
      const frame1 = new MockVideoFrame() as unknown as VideoFrame;

      reassembler.addFrame(1, frame1);
      reassembler.addFrame(0, frame0);

      const stats = reassembler.getStats();
      expect(stats.totalReceived).toBe(2);
      expect(stats.totalReleased).toBe(2);
      // Only frame 1 is out of order (arrived before frame 0 which is expected first)
      expect(stats.outOfOrderCount).toBe(1);
    });

    it('should track max buffer reached', () => {
      const frames = Array.from({ length: 5 }, () => new MockVideoFrame() as unknown as VideoFrame);

      // Add frames 4, 3, 2, 1 (out of order)
      reassembler.addFrame(4, frames[4]);
      reassembler.addFrame(3, frames[3]);
      reassembler.addFrame(2, frames[2]);
      reassembler.addFrame(1, frames[1]);

      const statsBefore = reassembler.getStats();
      expect(statsBefore.maxBufferReached).toBe(4);

      // Add frame 0 to flush - this also gets added to buffer momentarily
      reassembler.addFrame(0, frames[0]);

      const statsAfter = reassembler.getStats();
      // Max buffer was 5 when frame 0 was added before being released
      expect(statsAfter.maxBufferReached).toBe(5);
      expect(statsAfter.bufferedCount).toBe(0);
    });
  });

  describe('flush operation', () => {
    it('should return all buffered frames on flush', () => {
      const frame1 = new MockVideoFrame() as unknown as VideoFrame;
      const frame2 = new MockVideoFrame() as unknown as VideoFrame;
      const frame3 = new MockVideoFrame() as unknown as VideoFrame;

      reassembler.addFrame(3, frame3);
      reassembler.addFrame(1, frame1);
      reassembler.addFrame(2, frame2);

      const flushed = reassembler.flush();

      expect(flushed).toHaveLength(3);
      expect(flushed[0]).toBe(frame1);
      expect(flushed[1]).toBe(frame2);
      expect(flushed[2]).toBe(frame3);
      expect(reassembler.isEmpty()).toBe(true);
    });

    it('should update nextExpected after flush', () => {
      const frame1 = new MockVideoFrame() as unknown as VideoFrame;
      const frame2 = new MockVideoFrame() as unknown as VideoFrame;

      reassembler.addFrame(1, frame1);
      reassembler.addFrame(2, frame2);
      reassembler.flush();

      expect(reassembler.getNextExpected()).toBe(3);
    });
  });

  describe('reset operation', () => {
    it('should clear buffer and close frames on reset', () => {
      const frame1 = new MockVideoFrame();
      const frame2 = new MockVideoFrame();

      reassembler.addFrame(1, frame1 as unknown as VideoFrame);
      reassembler.addFrame(2, frame2 as unknown as VideoFrame);

      reassembler.reset();

      expect(frame1.closed).toBe(true);
      expect(frame2.closed).toBe(true);
      expect(reassembler.isEmpty()).toBe(true);
      expect(reassembler.getNextExpected()).toBe(0);
    });

    it('should reset all statistics', () => {
      const frame0 = new MockVideoFrame() as unknown as VideoFrame;

      reassembler.addFrame(0, frame0);
      reassembler.reset();

      const stats = reassembler.getStats();
      expect(stats.totalReceived).toBe(0);
      expect(stats.totalReleased).toBe(0);
      expect(stats.maxBufferReached).toBe(0);
      expect(stats.outOfOrderCount).toBe(0);
    });
  });

  describe('hasFrame utility', () => {
    it('should return true for buffered frames', () => {
      const frame1 = new MockVideoFrame() as unknown as VideoFrame;

      reassembler.addFrame(1, frame1);

      expect(reassembler.hasFrame(1)).toBe(true);
      expect(reassembler.hasFrame(0)).toBe(false);
      expect(reassembler.hasFrame(2)).toBe(false);
    });
  });
});
