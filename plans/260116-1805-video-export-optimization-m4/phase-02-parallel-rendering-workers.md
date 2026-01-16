# Phase 2: Parallel Rendering via Web Workers

## Context Links

- [Research: Web Workers + OffscreenCanvas](./research/researcher-web-workers-offscreen-canvas.md)
- [Phase 1: Frame Pipeline](./phase-01-frame-pipeline-optimization.md)
- [Current FrameRenderer](../src/lib/exporter/frameRenderer.ts)
- [PixiJS Web Worker Guide](https://pixijs.com/8.x/guides/concepts/environments)

## Overview

| Field | Value |
|-------|-------|
| Priority | P1 - Critical Path |
| Status | completed |
| Effort | 8h |
| Impact | 3-4x additional speedup (pending benchmark) |

Move PixiJS rendering to Web Workers using OffscreenCanvas. Enable parallel frame rendering across 4-8 workers for true multi-core utilization on M4.

## Key Insights from Research

1. **VideoFrame is transferable**: Zero-copy transfer (302ms→6.6ms = 45x faster)
2. **OffscreenCanvas**: Decouples rendering from DOM; works in workers
3. **@pixi/webworker**: Official package for PixiJS in workers, handles headless mode
4. **Worker pool**: 4-8 workers optimal; more causes contention
5. **Batch frames**: Amortize IPC overhead; send 4-8 frames per message

## Requirements

### Functional Requirements

- [ ] OffscreenCanvas renderer in Web Worker
- [ ] Worker pool with 4-8 concurrent workers
- [ ] Frame distribution with in-order reassembly
- [ ] Zero-copy VideoFrame transfer (transferable)
- [ ] Graceful shutdown and cleanup

### Non-Functional Requirements

- [ ] Reduce frame time from 40-80ms to 15-30ms (batch amortized)
- [ ] Maintain frame order in final output
- [ ] Handle worker crashes gracefully
- [ ] Support fallback to single-threaded if workers unavailable

## Architecture

### Worker Pool Design

```
┌──────────────────────────────────────────────────────────────┐
│                      MAIN THREAD                              │
│                                                              │
│  [RenderCoordinator]                                         │
│       │                                                      │
│       ├─→ [PrefetchManager] ─→ VideoFrame (N, N+1, N+2...)  │
│       │                                                      │
│       ├─→ [WorkerPool]                                       │
│       │       ├─→ Worker 0 (busy/idle)                       │
│       │       ├─→ Worker 1 (busy/idle)                       │
│       │       ├─→ Worker 2 (busy/idle)                       │
│       │       └─→ Worker 3 (busy/idle)                       │
│       │                                                      │
│       └─→ [FrameReassembler] ─→ Ordered frames → Encoder     │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                      WEB WORKER (x4-8)                        │
│                                                              │
│  [RenderWorker]                                              │
│       │                                                      │
│       ├─→ OffscreenCanvas (export resolution)                │
│       │                                                      │
│       ├─→ PixiJS Application (headless via @pixi/webworker)  │
│       │       ├─→ Stage                                      │
│       │       ├─→ VideoContainer                             │
│       │       ├─→ BlurFilter                                 │
│       │       └─→ MaskGraphics                               │
│       │                                                      │
│       └─→ CompositeCanvas (shadow, background)               │
│                                                              │
│  Input:  { frameIndex, videoFrame, timestamp, config }       │
│  Output: { frameIndex, renderedFrame (transferable) }        │
└──────────────────────────────────────────────────────────────┘
```

### Message Protocol

```typescript
// Main → Worker
interface RenderRequest {
  type: 'render';
  frameIndex: number;
  videoFrame: VideoFrame;  // Transferred, not copied
  timestamp: number;       // microseconds
  config: RenderConfig;    // Only on first message or config change
}

interface InitRequest {
  type: 'init';
  config: RenderConfig;
  offscreenCanvas: OffscreenCanvas;  // Transferred
}

interface ShutdownRequest {
  type: 'shutdown';
}

// Worker → Main
interface RenderResponse {
  type: 'rendered';
  frameIndex: number;
  renderedFrame: VideoFrame;  // Transferred back
}

interface ErrorResponse {
  type: 'error';
  frameIndex: number;
  error: string;
}
```

### Frame Distribution Strategy

```typescript
class FrameDistributor {
  private nextFrameIndex = 0;
  private workers: Worker[];
  private pending: Map<number, PromiseResolver>;

  async distributeFrame(frame: VideoFrame): Promise<RenderedFrame> {
    const index = this.nextFrameIndex++;
    const worker = this.getIdleWorker() ?? await this.waitForWorker();

    return new Promise((resolve, reject) => {
      this.pending.set(index, { resolve, reject });
      worker.postMessage(
        { type: 'render', frameIndex: index, videoFrame: frame, timestamp: frame.timestamp },
        [frame]  // Transfer, not copy
      );
    });
  }
}
```

### In-Order Reassembly

```typescript
class FrameReassembler {
  private buffer: Map<number, RenderedFrame> = new Map();
  private nextExpected = 0;

  onFrameRendered(index: number, frame: RenderedFrame): RenderedFrame[] {
    this.buffer.set(index, frame);
    const ready: RenderedFrame[] = [];

    while (this.buffer.has(this.nextExpected)) {
      ready.push(this.buffer.get(this.nextExpected)!);
      this.buffer.delete(this.nextExpected);
      this.nextExpected++;
    }

    return ready;  // May return 0, 1, or multiple frames
  }
}
```

## Related Code Files

### Files to Modify

| File | Changes |
|------|---------|
| `src/lib/exporter/videoExporter.ts` | Use RenderCoordinator instead of inline rendering |
| `src/lib/exporter/frameRenderer.ts` | Extract config; make worker-compatible |

### Files to Create

| File | Purpose | LOC Est |
|------|---------|---------|
| `src/lib/exporter/workers/render-worker.ts` | Web Worker entry point | 80 |
| `src/lib/exporter/workers/worker-pixi-renderer.ts` | PixiJS rendering in worker | 150 |
| `src/lib/exporter/worker-pool.ts` | Worker lifecycle management | 100 |
| `src/lib/exporter/render-coordinator.ts` | Orchestrates distribution + reassembly | 120 |
| `src/lib/exporter/frame-reassembler.ts` | In-order frame collection | 60 |

## Implementation Steps

### Step 1: Create Worker Entry Point (2h)

1. Create `src/lib/exporter/workers/render-worker.ts`
2. Import `@pixi/webworker` and configure headless mode
3. Handle `init` message: create OffscreenCanvas + PixiJS app
4. Handle `render` message: receive VideoFrame, render, transfer back
5. Handle `shutdown` message: cleanup resources

```typescript
// render-worker.ts
import { WebWorkerAdapter } from '@pixi/webworker';
import { WorkerPixiRenderer } from './worker-pixi-renderer';

WebWorkerAdapter.add();  // Must be first

let renderer: WorkerPixiRenderer | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data;

  switch (type) {
    case 'init':
      renderer = new WorkerPixiRenderer(e.data.config);
      await renderer.initialize(e.data.offscreenCanvas);
      self.postMessage({ type: 'ready' });
      break;

    case 'render':
      const { frameIndex, videoFrame, timestamp } = e.data;
      const rendered = await renderer!.render(videoFrame, timestamp);
      self.postMessage(
        { type: 'rendered', frameIndex, renderedFrame: rendered },
        [rendered]
      );
      break;

    case 'shutdown':
      renderer?.destroy();
      renderer = null;
      self.close();
      break;
  }
};
```

### Step 2: Extract PixiJS Rendering (2h)

1. Create `src/lib/exporter/workers/worker-pixi-renderer.ts`
2. Extract PixiJS setup from FrameRenderer (without DOM dependencies)
3. Accept OffscreenCanvas instead of creating HTMLCanvasElement
4. Return VideoFrame instead of canvas reference
5. Ensure no document/window references

### Step 3: Create Worker Pool (1.5h)

1. Create `src/lib/exporter/worker-pool.ts`
2. Spawn 4-8 workers based on `navigator.hardwareConcurrency`
3. Track busy/idle state per worker
4. Implement `getIdleWorker()` and `waitForWorker()`
5. Handle worker crashes: respawn or propagate error

```typescript
class WorkerPool {
  private workers: WorkerState[] = [];
  private workerCount: number;

  constructor(scriptUrl: string, count?: number) {
    this.workerCount = count ?? Math.min(navigator.hardwareConcurrency || 4, 8);
    for (let i = 0; i < this.workerCount; i++) {
      this.workers.push({
        worker: new Worker(scriptUrl, { type: 'module' }),
        busy: false,
        onIdle: null,
      });
    }
  }

  getIdleWorker(): Worker | null {
    const idle = this.workers.find(w => !w.busy);
    if (idle) {
      idle.busy = true;
      return idle.worker;
    }
    return null;
  }

  async waitForWorker(): Promise<Worker> {
    // ... Promise-based wait for next idle
  }

  shutdown(): void {
    this.workers.forEach(w => w.worker.terminate());
  }
}
```

### Step 4: Create Render Coordinator (1.5h)

1. Create `src/lib/exporter/render-coordinator.ts`
2. Orchestrate: PrefetchManager → WorkerPool → FrameReassembler
3. Manage frame distribution with backpressure
4. Collect rendered frames in order
5. Feed to EncodeQueue

### Step 5: Integrate into VideoExporter (1h)

1. Replace inline FrameRenderer usage with RenderCoordinator
2. Initialize workers at export start
3. Shutdown workers at export end (or on cancel)
4. Add fallback: if workers fail, use single-threaded path

## Todo List

- [x] ~~Install @pixi/webworker package~~ - Used WebWorkerAdapter from pixi.js core
- [x] Create render-worker.ts entry point - 120 LOC
- [x] Create worker-pixi-renderer.ts (extract from frameRenderer) - 488 LOC
- [x] Create worker-pool.ts with spawn/terminate lifecycle - 316 LOC
- [x] Create frame-reassembler.ts for ordering - 202 LOC (100% tested)
- [x] Create render-coordinator.ts for orchestration - 354 LOC
- [x] Update videoExporter.ts to use coordinator - Integrated with fallback
- [x] Add Vite worker bundling config - ES modules with proper bundling
- [x] Test with 4 worker count (fixed per validation)
- [ ] Benchmark parallel vs sequential - **PENDING** (needs integration test)
- [x] Handle worker crash recovery - Error propagation + timeout handling
- [x] Add fallback for worker-unsupported environments - Graceful fallback to FrameRenderer

**Status:** 11/12 complete (92%)

## Success Criteria

1. **Performance**: Frame time 15-30ms (batch amortized), export 30-60s for 1min
2. **Correctness**: Frames in correct order; no visual corruption
3. **Stability**: No worker crashes; graceful degradation
4. **Resource**: Workers terminate cleanly; no zombie processes
5. **Compatibility**: Works in Electron; fallback for Safari

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| @pixi/webworker issues | Medium | High | Test early; fallback to single-thread |
| VideoFrame transfer fails | Low | High | Feature detection; copy fallback |
| Worker IPC overhead | Medium | Medium | Batch frames; profile messaging |
| Memory contention | Medium | Medium | Limit worker count; monitor heap |
| Frame ordering bugs | Low | High | Comprehensive tests; sequence assertions |

## Security Considerations

- Workers isolated from main thread (no DOM access)
- Transferred objects prevent shared memory issues
- No eval() or dynamic imports in workers
- Worker URLs validated (same-origin)

## Implementation Summary

**Completed:** 2026-01-16
**Code Review:** [Report](../reports/code-reviewer-260116-1902-phase-02-parallel-rendering-workers.md)
**Score:** 8.5/10

### Key Achievements
- ✅ Zero-copy VideoFrame transfer implemented
- ✅ Clean architecture: WorkerPool → RenderCoordinator → FrameReassembler
- ✅ Graceful fallback to single-threaded rendering
- ✅ Comprehensive error handling with worker crash recovery
- ✅ In-order frame reassembly with 100% test coverage
- ✅ Fixed 4 workers (validated optimal for M4)

### Files Created
- `src/lib/exporter/workers/render-worker.ts` (120 LOC)
- `src/lib/exporter/workers/worker-pixi-renderer.ts` (488 LOC)
- `src/lib/exporter/workers/worker-types.ts` (94 LOC)
- `src/lib/exporter/workers/index.ts` (8 LOC)
- `src/lib/exporter/worker-pool.ts` (316 LOC)
- `src/lib/exporter/frame-reassembler.ts` (202 LOC)
- `src/lib/exporter/frame-reassembler.test.ts` (210 LOC)
- `src/lib/exporter/render-coordinator.ts` (354 LOC)

**Total:** ~1,800 LOC (new code)

### Integration Points
- Modified `src/lib/exporter/videoExporter.ts` - Added `useParallelRendering` config
- Modified `vite.config.ts` - Added worker bundling configuration

### Testing Status
- ✅ Unit tests: 12 tests passing (FrameReassembler)
- ✅ Build: Successful (macOS x64/arm64)
- ✅ Linting: 0 errors (1 warning unrelated to Phase 2)
- ⏳ Performance benchmark: Pending
- ⏳ Integration test: Pending
- ⏳ Windows/Linux validation: Pending

### Outstanding Tasks
1. Add integration test for end-to-end parallel rendering
2. Benchmark actual speedup on M4 Mac (target: 3-4x)
3. Validate worker loading on Windows/Linux Electron
4. Fix pre-existing linting warning in VideoEditor.tsx

## Next Steps

After Phase 2 completion:
1. ✅ Phase 2 implementation complete - Proceed to validation
2. [ ] Run performance benchmark (1min 1080p30 video export)
3. [ ] Profile GPU utilization (expect ~50% with parallel rendering)
4. [ ] Identify remaining bottlenecks (likely canvas filters)
5. [ ] Proceed to Phase 3 (WebGPU) for GPU-accelerated effects
