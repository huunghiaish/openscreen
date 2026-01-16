import { describe, it, expect, beforeEach } from 'vitest';
import { EncodeQueue } from './encode-queue';

describe('EncodeQueue', () => {
  let queue: EncodeQueue;

  beforeEach(() => {
    queue = new EncodeQueue({ maxSize: 4 });
  });

  describe('constructor', () => {
    it('should use default maxSize of 4 when not specified', () => {
      const defaultQueue = new EncodeQueue();
      expect(defaultQueue.hasSpace()).toBe(true);
    });

    it('should accept custom maxSize', () => {
      const customQueue = new EncodeQueue({ maxSize: 2 });
      customQueue.increment();
      customQueue.increment();
      expect(customQueue.hasSpace()).toBe(false);
    });
  });

  describe('waitForSpace', () => {
    it('should return immediately when queue has space', async () => {
      const startTime = Date.now();
      await queue.waitForSpace();
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(50);
    });

    it('should block when queue is full', async () => {
      // Fill the queue
      for (let i = 0; i < 4; i++) {
        queue.increment();
      }
      expect(queue.hasSpace()).toBe(false);

      // Start waiting
      let resolved = false;
      const waitPromise = queue.waitForSpace().then(() => {
        resolved = true;
      });

      // Should not resolve immediately
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(resolved).toBe(false);

      // Simulate chunk output
      queue.onChunkOutput();

      // Now should resolve
      await waitPromise;
      expect(resolved).toBe(true);
    });

    it('should resolve multiple waiters in order', async () => {
      // Fill the queue
      for (let i = 0; i < 4; i++) {
        queue.increment();
      }

      const resolveOrder: number[] = [];

      // Start multiple waiters
      const wait1 = queue.waitForSpace().then(() => resolveOrder.push(1));
      const wait2 = queue.waitForSpace().then(() => resolveOrder.push(2));
      const wait3 = queue.waitForSpace().then(() => resolveOrder.push(3));

      // Release space one at a time
      queue.onChunkOutput();
      await wait1;
      queue.onChunkOutput();
      await wait2;
      queue.onChunkOutput();
      await wait3;

      expect(resolveOrder).toEqual([1, 2, 3]);
    });
  });

  describe('increment', () => {
    it('should increase queue size', () => {
      expect(queue.size).toBe(0);
      queue.increment();
      expect(queue.size).toBe(1);
      queue.increment();
      expect(queue.size).toBe(2);
    });

    it('should track peak size', () => {
      queue.increment();
      queue.increment();
      queue.increment();
      queue.onChunkOutput();
      queue.onChunkOutput();

      const stats = queue.getStats();
      expect(stats.peakSize).toBe(3);
    });
  });

  describe('onChunkOutput', () => {
    it('should decrease queue size', () => {
      queue.increment();
      queue.increment();
      expect(queue.size).toBe(2);

      queue.onChunkOutput();
      expect(queue.size).toBe(1);
    });

    it('should track total encoded count', () => {
      queue.increment();
      queue.onChunkOutput();
      queue.increment();
      queue.onChunkOutput();
      queue.increment();
      queue.onChunkOutput();

      const stats = queue.getStats();
      expect(stats.totalEncoded).toBe(3);
    });
  });

  describe('hasSpace', () => {
    it('should return true when under max', () => {
      queue.increment();
      queue.increment();
      queue.increment();
      expect(queue.hasSpace()).toBe(true);
    });

    it('should return false when at max', () => {
      queue.increment();
      queue.increment();
      queue.increment();
      queue.increment();
      expect(queue.hasSpace()).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', async () => {
      // Fill queue and wait
      for (let i = 0; i < 4; i++) {
        queue.increment();
      }

      const waitPromise = queue.waitForSpace();
      queue.onChunkOutput();
      await waitPromise;

      const stats = queue.getStats();
      expect(stats.peakSize).toBe(4);
      expect(stats.totalEncoded).toBe(1);
      expect(stats.totalWaits).toBe(1);
      expect(stats.pendingWaits).toBe(0);
    });
  });

  describe('reset', () => {
    it('should clear all state', async () => {
      queue.increment();
      queue.increment();

      // Start a waiter
      for (let i = 0; i < 2; i++) {
        queue.increment();
      }
      const waitPromise = queue.waitForSpace();

      // Reset should resolve pending waiter and clear state
      queue.reset();
      await waitPromise; // Should resolve immediately due to reset

      expect(queue.size).toBe(0);
      expect(queue.hasSpace()).toBe(true);

      const stats = queue.getStats();
      expect(stats.peakSize).toBe(0);
      expect(stats.totalEncoded).toBe(0);
      expect(stats.totalWaits).toBe(0);
    });
  });
});
