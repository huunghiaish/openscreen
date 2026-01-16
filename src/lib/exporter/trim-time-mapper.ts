/**
 * Trim Time Mapper Utility
 *
 * Provides consistent time mapping between effective time (excluding trims)
 * and source time (original video timeline with trims).
 *
 * Used by VideoExporter and FrameSource implementations to handle trim regions.
 */

import type { TrimRegion } from '@/components/video-editor/types';

/**
 * TrimTimeMapper - Converts between effective and source timestamps
 *
 * Effective time: Timeline after trims are removed (what user sees)
 * Source time: Original video timeline (includes trimmed regions)
 */
export class TrimTimeMapper {
  private readonly sortedTrims: TrimRegion[];
  private readonly totalTrimDuration: number;

  /**
   * Create a new TrimTimeMapper
   * @param trimRegions - Array of trim regions to skip (will be sorted internally)
   */
  constructor(trimRegions: TrimRegion[] = []) {
    // Sort trim regions by start time for efficient lookup
    this.sortedTrims = [...trimRegions].sort((a, b) => a.startMs - b.startMs);

    // Pre-calculate total trim duration
    this.totalTrimDuration = this.sortedTrims.reduce(
      (sum, region) => sum + (region.endMs - region.startMs),
      0
    );
  }

  /**
   * Map effective time to source time
   *
   * Effective time is the timeline after trims are removed.
   * This maps it back to the original source timeline.
   *
   * @param effectiveTimeMs - Time in milliseconds on the effective (trimmed) timeline
   * @returns Source time in milliseconds on the original timeline
   */
  mapEffectiveToSourceTime(effectiveTimeMs: number): number {
    let sourceTimeMs = effectiveTimeMs;

    for (const trim of this.sortedTrims) {
      // If we haven't reached this trim region yet, we're done
      if (sourceTimeMs < trim.startMs) {
        break;
      }

      // Add the duration of this trim region to skip over it
      const trimDuration = trim.endMs - trim.startMs;
      sourceTimeMs += trimDuration;
    }

    return sourceTimeMs;
  }

  /**
   * Get total trim duration in milliseconds
   */
  getTotalTrimDurationMs(): number {
    return this.totalTrimDuration;
  }

  /**
   * Get total trim duration in seconds
   */
  getTotalTrimDurationSec(): number {
    return this.totalTrimDuration / 1000;
  }

  /**
   * Calculate effective duration from original duration
   * @param originalDurationSec - Original video duration in seconds
   * @returns Effective duration in seconds (excluding trims)
   */
  getEffectiveDuration(originalDurationSec: number): number {
    return originalDurationSec - this.getTotalTrimDurationSec();
  }

  /**
   * Check if there are any trim regions
   */
  hasTrims(): boolean {
    return this.sortedTrims.length > 0;
  }

  /**
   * Get the number of trim regions
   */
  getTrimCount(): number {
    return this.sortedTrims.length;
  }
}

/**
 * Create a TrimTimeMapper from optional trim regions
 * @param trimRegions - Optional trim regions array
 * @returns TrimTimeMapper instance
 */
export function createTrimMapper(trimRegions?: TrimRegion[]): TrimTimeMapper {
  return new TrimTimeMapper(trimRegions);
}
