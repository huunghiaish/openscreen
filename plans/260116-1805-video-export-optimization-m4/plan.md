---
title: "Video Export Pipeline Optimization for M4"
description: "Achieve 5-10x export speedup on Apple Silicon M4 via frame prefetching, parallel rendering, and GPU effects"
status: in-progress
priority: P1
effort: 16h
branch: main
tags: [performance, export, webcodecs, webworkers, webgpu, m4]
created: 2026-01-16
---

# Video Export Pipeline Optimization for Apple Silicon M4

## Summary

Optimize OpenScreen's video export pipeline to achieve 5-10x speedup on M4 Macs. Current: 3-8 min for 1 min 1080p30 video. Target: 20-40 seconds.

## Current State Analysis

### Bottlenecks Identified

| Bottleneck | Impact | Root Cause |
|------------|--------|------------|
| Sequential frame seeking | 30-40% | Each frame requires individual `videoElement.currentTime` + `seeked` event |
| Single-threaded PixiJS | 20-30% | All rendering on main thread blocks encode queue |
| Texture recreation | 10-15% | `Texture.from(videoFrame)` + destroy per frame |
| Busy-wait queue polling | 5-10% | `while (encodeQueue >= MAX) await setTimeout(0)` blocks event loop |
| Canvas filter operations | 10-15% | CPU-bound blur/shadow filters via `ctx.filter` every frame |

### Current Pipeline (Sequential)

```
[Video Element] → [Seek & Wait] → [VideoFrame] → [PixiJS Render] → [Canvas Composite]
                                                                          ↓
[Muxer/MP4] ← [WebCodecs Encode] ← [VideoFrame from Canvas]
```

**Time per frame (1080p30):** ~100-250ms

## Target Architecture

### Optimized Pipeline (Parallel)

```
                    ┌─────────────────────────────────────────┐
                    │         MAIN THREAD                     │
                    │                                         │
[Video Elem A] ─┬───┼─→ [Prefetch Queue] ────→ [Distribute]   │
[Video Elem B] ─┘   │         ↓                     ↓         │
                    │   [Frame Pool]          [Worker Pool]   │
                    └─────────────────────────────────────────┘
                                                    ↓
                    ┌───────────────────────────────────────────┐
                    │       WEB WORKERS (4-8 parallel)          │
                    │                                           │
                    │  [OffscreenCanvas + PixiJS] → [Rendered]  │
                    │  [WebGPU Blur/Shadow] → [GPU Effects]     │
                    └───────────────────────────────────────────┘
                                                    ↓
                    ┌───────────────────────────────────────────┐
                    │       ENCODER THREAD                       │
                    │                                           │
                    │  [Event-driven Queue] → [H.264 HW Encode] │
                    │  [encodeQueueSize monitor] → [Backpressure]│
                    └───────────────────────────────────────────┘
                                                    ↓
                               [Muxer/MP4 Finalize]
```

**Target time per frame:** 10-30ms (batch amortized)

## Implementation Phases

### Phase 1: Frame Pipeline Optimization
**Status:** pending | **Effort:** 4h | **Impact:** 2-3x speedup

- Double-buffer video elements for frame prefetching
- VideoFrame pool to reuse allocations (clone vs new)
- Event-driven encode queue replacing busy-wait
- Texture caching and canvas context reuse

**Files:** `videoExporter.ts`, `frameRenderer.ts`, new `frame-pool.ts`, `encode-queue.ts`

[Detailed Plan](./phase-01-frame-pipeline-optimization.md)

### Phase 2: Parallel Rendering via Web Workers
**Status:** completed | **Effort:** 8h | **Impact:** Infrastructure ready, blocked by video decoding | **Completed:** 2026-01-16 22:19

- ✅ OffscreenCanvas in Web Workers (PixiJS 8 WebWorkerAdapter)
- ✅ Zero-copy VideoFrame transfer via Transferables
- ✅ Worker pool management (4 workers)
- ✅ Frame reassembler for in-order delivery
- ✅ Graceful fallback to single-threaded mode

**Critical Finding:** Workers render in 1-2ms but video frame extraction takes 100-140ms. Bottleneck is `HTMLVideoElement.currentTime` seek, not PixiJS rendering. Workers idle 98% of time waiting for frames.

**Files:** `render-worker.ts`, `worker-pool.ts`, `render-coordinator.ts`, `frame-reassembler.ts`, `worker-pixi-renderer.ts`

[Detailed Plan](./phase-02-parallel-rendering-workers.md)

### Phase 2.5: Fast Frame Extraction (NEW - Required for Parallel Benefit)
**Status:** pending | **Effort:** 8h | **Impact:** Unlocks 3-4x from parallel workers

- WebCodecs VideoDecoder for direct frame decoding
- Demux video file without HTMLVideoElement seek latency
- Decode frames at hardware speed (potentially 10-50x faster)
- Feed parallel workers at full speed

**Files:** new `video-decoder.ts`, `demuxer.ts`, update `prefetch-manager.ts`

**Why needed:** Current HTMLVideoElement seek takes ~100ms/frame. VideoDecoder can decode at near-realtime speed, enabling workers to process in true parallel.

### Phase 3: GPU Effects via WebGPU
**Status:** pending | **Effort:** 4h | **Impact:** 2-3x additional

- WebGPU compute shaders for blur, shadow, zoom
- Direct GPU → Encoder pipeline (no CPU round-trip)
- Metal backend optimization for M4
- Fallback to canvas filters for non-WebGPU browsers

**Files:** new `gpu-effects.ts`, `blur-shader.wgsl`, `shadow-shader.wgsl`

[Detailed Plan](./phase-03-gpu-effects-webgpu.md)

## Dependencies

- Phase 2 depends on Phase 1 (frame pool + queue management)
- Phase 3 can run in parallel with Phase 2 (independent GPU pipeline)

## Success Metrics

| Metric | Current | Phase 1 | Phase 2 | Phase 2.5 | Phase 3 |
|--------|---------|---------|---------|-----------|---------|
| 1 min 1080p30 export | 3-8 min | 1-3 min | No change* | 30-60s | 20-40s |
| Frame time (avg) | 100-250ms | 40-80ms | ~90ms* | 15-30ms | 10-20ms |
| Worker render time | N/A | N/A | 1-2ms | 1-2ms | <1ms |
| Frame extraction | ~100ms | ~100ms | ~100ms | ~2ms | ~2ms |

*Phase 2 infrastructure ready but blocked by video decoding bottleneck. Phase 2.5 unlocks the parallel benefit.

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| OffscreenCanvas/PixiJS issues | Medium | High | Use @pixi/webworker, test headless mode |
| WebGPU availability | Medium | Medium | Fallback to canvas filters, feature detect |
| Worker IPC overhead | Low | Medium | Batch frames, use transferable objects |
| Memory pressure with pools | Low | High | Configurable pool size, GC monitoring |

## Validation Summary

**Validated:** 2026-01-16
**Questions asked:** 6

### Confirmed Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| MAX_ENCODE_QUEUE | Giảm xuống 4-8 | Research confirms hardware encoder optimal với small queue |
| @pixi/webworker | OK to add | Official package, well-maintained |
| Phase 3 (WebGPU) | Implement | M4 support tốt, potential 2-3x thêm |
| Worker count | 4 workers | Safe, đủ cho 3-4x speedup, ít contention |
| Modularization | Files riêng | Clean separation, dễ test, follow code standards |
| GIF export | Defer, MP4 first | Primary use case, GIF optimize sau |

### Action Items
- [x] Validation completed
- [x] Update phase-02 to fix worker count at 4 (completed in implementation)
- [x] Exclude gifExporter.ts from optimization scope (deferred to Phase 1)

## Research Reports

- [WebCodecs Optimization](./research/researcher-webcodecs-optimization.md)
- [Web Workers + OffscreenCanvas](./research/researcher-web-workers-offscreen-canvas.md)
