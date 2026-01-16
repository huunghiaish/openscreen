# Phase 3: Frame Buffer and Reordering

## Context Links
- [WebCodecs VideoDecoder Research](./research/researcher-webcodecs-videodecoder-api.md)
- [Phase 2: VideoDecoder Service](./phase-02-video-decoder-service.md)
- [Existing FrameReassembler](/Users/nghia/Projects/openscreen/src/lib/exporter/frame-reassembler.ts)

## Overview
- **Priority:** P1
- **Status:** pending
- **Effort:** 2h

Create a frame buffer that stores decoded VideoFrames ahead of worker consumption, handles presentation order (B-frame reordering), and manages memory by limiting buffer size. This decouples decode rate from render rate.

## Key Insights

### VideoDecoder Output Order
- VideoDecoder outputs frames in **presentation order** (PTS)
- Input chunks are fed in **decode order** (DTS)
- For most screen recordings (VP9 no B-frames), these are identical
- H.264 content may have B-frames requiring reorder handling

### Memory Management Critical
- Each VideoFrame holds GPU memory until `close()` called
- 1080p VideoFrame ~8MB GPU memory
- 16-frame buffer = ~128MB GPU memory
- MUST close frames when evicted or consumed

### Existing FrameReassembler Pattern
The codebase already has `FrameReassembler` for parallel rendering. Key differences:
- FrameReassembler: Reorders rendered frames by frameIndex
- FrameBuffer: Buffers decoded VideoFrames by timestamp for consumption

## Requirements

### Functional
- Store decoded VideoFrames indexed by timestamp
- Provide frames in sequential order to consumers
- Limit buffer size to prevent memory exhaustion
- Signal when buffer has space for more frames
- Handle frame requests by index/timestamp
- Close frames when evicted or consumed

### Non-Functional
- Buffer capacity: 8-16 frames configurable
- Lookup/retrieval: O(1) or O(log n)
- Memory efficient: Close frames immediately when done
- Thread-safe concepts (single-threaded but async-safe)

## Architecture

```typescript
interface FrameBufferConfig {
  maxFrames?: number;      // Default: 16
  frameRate: number;       // Required for index->timestamp mapping
  debug?: boolean;
}

class FrameBuffer {
  constructor(config: FrameBufferConfig)

  // Input (from decoder)
  addFrame(frame: VideoFrame): void
  isFull(): boolean
  waitForSpace(): Promise<void>

  // Output (to workers)
  hasFrame(frameIndex: number): boolean
  getFrame(frameIndex: number): VideoFrame | null
  consumeFrame(frameIndex: number): VideoFrame | null  // Removes from buffer

  // Lifecycle
  flush(): VideoFrame[]  // Returns remaining frames
  reset(): void          // Closes all frames, clears buffer
  destroy(): void

  // Stats
  getStats(): BufferStats
}

interface BufferStats {
  currentSize: number;
  maxSize: number;
  framesAdded: number;
  framesConsumed: number;
  framesEvicted: number;
}
```

### Data Flow

```
[VideoDecoderService]
        |
        v
   addFrame(VideoFrame)
        |
        v
   [FrameBuffer Map<timestamp, VideoFrame>]
        |
        +---> isFull()? --> waitForSpace()
        |
        v
   getFrame(index) --> [timestamp lookup] --> VideoFrame
        |
        v
   consumeFrame(index) --> VideoFrame --> [Worker]
                                              |
                                              v
                                         frame.close()
```

### Frame Index to Timestamp Mapping

```typescript
// Frame index -> presentation timestamp
function indexToTimestamp(frameIndex: number, frameRate: number): number {
  return (frameIndex / frameRate) * 1_000_000; // microseconds
}

// Find frame closest to target timestamp
function findFrameByIndex(frameIndex: number): VideoFrame | null {
  const targetTimestamp = indexToTimestamp(frameIndex, this.frameRate);
  // Binary search or direct map lookup
}
```

## Related Code Files

### To Create
- `src/lib/exporter/decoded-frame-buffer.ts` - Frame buffer class

### To Reference
- `src/lib/exporter/frame-reassembler.ts` - Similar pattern for rendered frames
- `src/lib/exporter/encode-queue.ts` - Backpressure pattern

## Implementation Steps

### Step 1: Create FrameBuffer Class (45min)
1. Create `src/lib/exporter/decoded-frame-buffer.ts`
2. Implement constructor with config
3. Use Map<number, VideoFrame> for storage (timestamp as key)
4. Add frame rate for index/timestamp conversion

### Step 2: Implement addFrame with Eviction (30min)
1. Implement `addFrame()`:
   ```typescript
   addFrame(frame: VideoFrame): void {
     const timestamp = frame.timestamp;

     // Evict oldest if full (close frame!)
     if (this.frames.size >= this.maxFrames) {
       this.evictOldest();
     }

     this.frames.set(timestamp, frame);
     this.framesAdded++;
     this.notifyWaiters();
   }
   ```
2. Implement `evictOldest()`:
   ```typescript
   private evictOldest(): void {
     const oldest = this.getOldestTimestamp();
     if (oldest !== null) {
       const frame = this.frames.get(oldest);
       frame?.close();  // CRITICAL: Release GPU memory
       this.frames.delete(oldest);
       this.framesEvicted++;
     }
   }
   ```

### Step 3: Implement Frame Retrieval (30min)
1. Implement `hasFrame()` with index->timestamp mapping
2. Implement `getFrame()` (returns without removing):
   ```typescript
   getFrame(frameIndex: number): VideoFrame | null {
     const targetTimestamp = this.indexToTimestamp(frameIndex);
     // Find frame closest to target (within tolerance)
     return this.findClosestFrame(targetTimestamp);
   }
   ```
3. Implement `consumeFrame()` (returns and removes):
   ```typescript
   consumeFrame(frameIndex: number): VideoFrame | null {
     const frame = this.getFrame(frameIndex);
     if (frame) {
       this.frames.delete(frame.timestamp);
       this.framesConsumed++;
     }
     return frame;  // Consumer responsible for close()
   }
   ```

### Step 4: Implement Backpressure (15min)
1. Implement `isFull()`:
   ```typescript
   isFull(): boolean {
     return this.frames.size >= this.maxFrames;
   }
   ```
2. Implement `waitForSpace()`:
   ```typescript
   async waitForSpace(): Promise<void> {
     if (!this.isFull()) return;

     return new Promise(resolve => {
       this.spaceWaiters.push(resolve);
     });
   }
   ```
3. Call `notifyWaiters()` when frame consumed

### Step 5: Implement Cleanup (15min)
1. Implement `flush()` - returns remaining frames without closing
2. Implement `reset()` - closes all frames, clears buffer
3. Implement `destroy()` - calls reset, clears waiters

## Todo List
- [ ] Create decoded-frame-buffer.ts with class skeleton
- [ ] Implement constructor with config and Map storage
- [ ] Implement indexToTimestamp conversion
- [ ] Implement addFrame() with eviction
- [ ] Implement evictOldest() with frame.close()
- [ ] Implement hasFrame() check
- [ ] Implement getFrame() with timestamp lookup
- [ ] Implement consumeFrame() with removal
- [ ] Implement isFull() check
- [ ] Implement waitForSpace() with Promise queue
- [ ] Implement notifyWaiters() callback
- [ ] Implement flush() for drain
- [ ] Implement reset() with cleanup
- [ ] Implement destroy()
- [ ] Add debug logging
- [ ] Test buffer filling and eviction
- [ ] Test frame retrieval by index
- [ ] Verify frame.close() called on eviction

## Success Criteria
1. Buffers up to maxFrames VideoFrames
2. Evicts oldest frames when full (with close())
3. Retrieves frames by index with timestamp mapping
4. Consumer receives frames without data loss
5. Memory stable under sustained load (no leaks)

## Risk Assessment

### High: Memory Leaks
- **Risk:** Frames not closed on eviction/reset
- **Mitigation:** Explicit close() calls in evict/reset; add debug mode to track

### Medium: Timestamp Precision
- **Risk:** Frame timestamps don't align exactly with expected
- **Mitigation:** Use tolerance window for matching (e.g., half frame duration)

### Low: Buffer Starvation
- **Risk:** Consumer requests frames before decoder produces them
- **Mitigation:** Consumer should check hasFrame() or handle null gracefully

## Security Considerations
- No external input validation needed (internal component)
- Ensure frames closed to prevent GPU memory exhaustion (DoS vector)

## Next Steps
After completing this phase:
1. Phase 4: Integration connects Demuxer -> Decoder -> Buffer -> RenderCoordinator
2. Integration point: `RenderCoordinator` consumes frames via `buffer.consumeFrame()`
