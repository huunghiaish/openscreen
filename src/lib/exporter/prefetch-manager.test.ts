import { describe, it, expect } from 'vitest';

/**
 * PrefetchManager tests
 *
 * Note: PrefetchManager uses HTMLVideoElement which requires a DOM environment.
 * These tests cover the logic that can be tested without DOM (primarily time mapping).
 * Full integration testing requires running in a browser environment.
 */

describe('PrefetchManager', () => {
  describe('trim region time mapping (logic test)', () => {
    // Test the time mapping logic without instantiating PrefetchManager
    // This mirrors the mapEffectiveToSourceTime implementation

    const mapEffectiveToSourceTime = (
      effectiveTimeMs: number,
      trimRegions: Array<{ startMs: number; endMs: number }>
    ): number => {
      const sortedTrims = [...trimRegions].sort((a, b) => a.startMs - b.startMs);
      let sourceTimeMs = effectiveTimeMs;

      for (const trim of sortedTrims) {
        if (sourceTimeMs < trim.startMs) {
          break;
        }
        const trimDuration = trim.endMs - trim.startMs;
        sourceTimeMs += trimDuration;
      }

      return sourceTimeMs;
    };

    it('should return same time when no trim regions', () => {
      const result = mapEffectiveToSourceTime(1000, []);
      expect(result).toBe(1000);
    });

    it('should add trim duration when effective time is after trim region', () => {
      const trimRegions = [{ startMs: 1000, endMs: 2000 }]; // 1 second trim
      // Effective time 2000ms should map to source time 3000ms (2000 + 1000 trim)
      const result = mapEffectiveToSourceTime(2000, trimRegions);
      expect(result).toBe(3000);
    });

    it('should not add trim duration when effective time is before trim region', () => {
      const trimRegions = [{ startMs: 5000, endMs: 6000 }];
      // Effective time 1000ms is before trim, should remain 1000ms
      const result = mapEffectiveToSourceTime(1000, trimRegions);
      expect(result).toBe(1000);
    });

    it('should handle multiple trim regions', () => {
      const trimRegions = [
        { startMs: 1000, endMs: 2000 }, // 1 second
        { startMs: 5000, endMs: 7000 }, // 2 seconds
      ];
      // Effective time 10000ms should map to source time 13000ms (10000 + 1000 + 2000)
      const result = mapEffectiveToSourceTime(10000, trimRegions);
      expect(result).toBe(13000);
    });

    it('should sort trim regions by start time', () => {
      const trimRegions = [
        { startMs: 5000, endMs: 6000 }, // Added second but starts later
        { startMs: 1000, endMs: 2000 }, // Added first but starts earlier
      ];
      // Effective time 3000ms should map to source time 4000ms (only first trim applies)
      const result = mapEffectiveToSourceTime(3000, trimRegions);
      expect(result).toBe(4000);
    });

    it('should handle trim at the start of video', () => {
      const trimRegions = [{ startMs: 0, endMs: 1000 }];
      // Effective time 0 is at start, which equals trim start, so trim is added
      const result = mapEffectiveToSourceTime(0, trimRegions);
      expect(result).toBe(1000);
    });

    it('should handle consecutive trim regions', () => {
      const trimRegions = [
        { startMs: 1000, endMs: 2000 },
        { startMs: 2000, endMs: 3000 },
      ];
      // After the second trim region, effective time 3000ms should map to 5000ms
      const result = mapEffectiveToSourceTime(3000, trimRegions);
      expect(result).toBe(5000);
    });
  });

  describe('stats calculation (logic test)', () => {
    it('should calculate hit rate correctly', () => {
      // Test the hit rate calculation logic
      const calculateHitRate = (hits: number, misses: number): number => {
        const total = hits + misses;
        return total > 0 ? hits / total : 0;
      };

      expect(calculateHitRate(0, 0)).toBe(0);
      expect(calculateHitRate(10, 0)).toBe(1);
      expect(calculateHitRate(0, 10)).toBe(0);
      expect(calculateHitRate(5, 5)).toBe(0.5);
      expect(calculateHitRate(3, 1)).toBe(0.75);
    });
  });
});
