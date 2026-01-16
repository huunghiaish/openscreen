# Investigation Report: Parallel Rendering Bottleneck Analysis

**Date:** 2026-01-16 22:34
**Phase:** Video Export Optimization M4 - Phase 2
**Status:** Completed with critical finding

## Summary

Parallel rendering infrastructure is complete and functional, but provides no speedup due to a previously unidentified bottleneck: **video frame extraction via HTMLVideoElement takes 100-140ms per frame**, while parallel workers render in only 1-2ms.

## Investigation Timeline

### Initial Implementation
- Implemented 4-worker pool with OffscreenCanvas + PixiJS 8 WebWorkerAdapter
- Zero-copy VideoFrame transfer via Transferables
- Frame reassembler for in-order delivery
- Expected: 3-4x speedup from parallel rendering

### Testing Results
| Mode | Frames | Total Time | Avg Frame Time |
|------|--------|------------|----------------|
| Single-threaded | 323 | 36.11s | 111ms |
| Parallel (4 workers) | 346 | 31.32s | 90ms |

**Only ~8% faster** - not the expected 3-4x improvement.

### Detailed Timing Analysis
Added instrumentation to identify where time is spent:

| Step | Time | Notes |
|------|------|-------|
| Prefetch (video seek) | **100-140ms** | ← BOTTLENECK |
| VideoFrame creation | 0.1ms | |
| Worker render (PixiJS) | 1-2ms | Very fast! |
| Submit to worker | 0.3ms | |
| Wait for idle worker | 0ms | Always idle |

### Worker Utilization
```
[WorkerPool] Frame 100: Worker 0 done, busy=0/4
[WorkerPool] Frame 200: Worker 0 done, busy=0/4
[WorkerPool] Frame 300: Worker 0 done, busy=0/4
```

**Only Worker 0 is ever used.** Workers 1-3 never receive frames because Worker 0 finishes before the next frame is ready.

## Root Cause

The `HTMLVideoElement.currentTime = X` seek operation takes ~100ms due to:
1. Browser needs to seek to keyframe
2. Decode intermediate frames to reach target
3. Wait for `seeked` event
4. Ensure frame data is ready (readyState >= 2)

Even with dual video elements for prefetching, each frame still incurs ~100ms latency. Workers process 50x faster than frames can be supplied.

## Deliverables

Despite the bottleneck, Phase 2 deliverables are complete:

- ✅ `render-worker.ts` - Web Worker entry point
- ✅ `worker-pixi-renderer.ts` - Headless PixiJS for OffscreenCanvas
- ✅ `worker-pool.ts` - 4-worker lifecycle management
- ✅ `frame-reassembler.ts` - In-order frame collection
- ✅ `render-coordinator.ts` - Orchestration layer
- ✅ `worker-types.ts` - Type definitions
- ✅ Vite worker bundling config
- ✅ 12 unit tests for frame reassembler
- ✅ Graceful fallback to single-threaded

## Recommendation

### Immediate Next Step: Phase 2.5 - Fast Frame Extraction

Use **WebCodecs VideoDecoder** to decode frames directly:

```
Current (slow):
HTMLVideoElement → seek (100ms) → VideoFrame → Worker (2ms)

Proposed (fast):
VideoDecoder → decode chunk (<2ms) → VideoFrame → Worker (2ms)
```

Benefits:
- Hardware-accelerated decoding on M4
- No seek latency (sequential decode)
- Can batch decode ahead of workers
- Enables true parallel processing

### Implementation Approach

1. Demux WebM/MP4 to get encoded video chunks
2. Create VideoDecoder with codec config
3. Feed chunks sequentially (no seeking)
4. Collect decoded VideoFrames
5. Feed to parallel workers

### Expected Outcome

With VideoDecoder:
- Frame extraction: ~2ms (vs 100ms)
- 4 workers can process in true parallel
- Expected total speedup: 10-20x

## Conclusion

Phase 2 parallel infrastructure is ready and waiting. The next optimization must focus on frame extraction speed, not rendering speed. VideoDecoder is the path forward.
