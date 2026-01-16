# Phase 4: Integration with RenderCoordinator

## Context Links
- [Phase 1: Video Demuxer](./phase-01-video-demuxer.md)
- [Phase 2: VideoDecoder Service](./phase-02-video-decoder-service.md)
- [Phase 3: Frame Buffer](./phase-03-frame-buffer.md)
- [Existing RenderCoordinator](/Users/nghia/Projects/openscreen/src/lib/exporter/render-coordinator.ts)
- [Existing VideoExporter](/Users/nghia/Projects/openscreen/src/lib/exporter/videoExporter.ts)
- [Existing PrefetchManager](/Users/nghia/Projects/openscreen/src/lib/exporter/prefetch-manager.ts)

## Overview
- **Priority:** P1
- **Status:** pending
- **Effort:** 3h

Integrate the WebCodecs decoding pipeline with the existing RenderCoordinator and VideoExporter. Create a new FrameSource abstraction that can be backed by either WebCodecs (fast) or HTMLVideoElement (fallback), enabling seamless switching and maintaining backward compatibility.

## Key Insights

### Current Bottleneck Location
```
VideoExporter.export()
  -> prefetchManager.getFrame(frameIndex)     // <-- 100-140ms HERE
     -> HTMLVideoElement.currentTime = time
     -> await seeked event
  -> new VideoFrame(videoElement)             // <-- ~1ms
  -> renderCoordinator.renderFrame(videoFrame) // <-- Worker: ~2ms
```

### Target Pipeline
```
VideoExporter.export()
  -> frameSource.getFrame(frameIndex)         // <-- <5ms with WebCodecs
     -> decodedFrameBuffer.consumeFrame()
  -> renderCoordinator.renderFrame(videoFrame) // <-- Worker: ~2ms (4 parallel!)
```

### Fallback Strategy
WebCodecs may not be available or supported for specific codecs. Maintain HTMLVideoElement path:
1. Try WebCodecs first
2. If `VideoDecoder.isConfigSupported()` fails, fall back
3. Log which path is used for debugging

## Requirements

### Functional
- Create FrameSource interface abstracting frame extraction
- Implement WebCodecsFrameSource using new pipeline
- Wrap existing PrefetchManager as HTMLVideoFrameSource (fallback)
- Auto-detect and select best available source
- Integrate with RenderCoordinator's parallel workers
- Handle trim regions via timestamp mapping

### Non-Functional
- Transparent to VideoExporter (same interface)
- <10ms frame acquisition with WebCodecs
- Graceful degradation to HTMLVideoElement
- No breaking changes to export flow

## Architecture

### FrameSource Interface
```typescript
interface FrameSourceConfig {
  videoUrl: string;
  frameRate: number;
  trimRegions?: TrimRegion[];
  debug?: boolean;
}

interface FrameSourceResult {
  width: number;
  height: number;
  duration: number;  // Effective duration (excluding trims)
  mode: 'webcodecs' | 'htmlvideo';
}

interface FrameSource {
  initialize(): Promise<FrameSourceResult>
  getFrame(frameIndex: number, effectiveTimeMs: number): Promise<VideoFrame>
  destroy(): void
  getStats(): FrameSourceStats
}
```

### WebCodecs Pipeline
```typescript
class WebCodecsFrameSource implements FrameSource {
  private demuxer: VideoDemuxer;
  private decoder: VideoDecoderService;
  private buffer: DecodedFrameBuffer;
  private decodeAheadTask: Promise<void> | null = null;

  async initialize(): Promise<FrameSourceResult> {
    // 1. Initialize demuxer
    const demuxResult = await this.demuxer.initialize();

    // 2. Configure decoder
    const supported = await this.decoder.configure(demuxResult.config);
    if (!supported) throw new Error('Codec not supported');

    // 3. Wire up: decoder output -> buffer
    this.decoder.setFrameCallback((frame) => {
      this.buffer.addFrame(frame);
    });

    // 4. Start decode-ahead loop
    this.startDecodeAhead();

    return { ...demuxResult, mode: 'webcodecs' };
  }

  async getFrame(frameIndex: number, effectiveTimeMs: number): Promise<VideoFrame> {
    // Map effective time to source time (skip trims)
    const sourceTimeMs = this.mapEffectiveToSourceTime(effectiveTimeMs);

    // Wait for frame to be available
    while (!this.buffer.hasFrame(frameIndex)) {
      await this.waitForFrame(frameIndex);
    }

    // Consume and return (caller owns frame, must close)
    return this.buffer.consumeFrame(frameIndex)!;
  }
}
```

### Decode-Ahead Loop
```typescript
private async startDecodeAhead(): Promise<void> {
  this.decodeAheadTask = (async () => {
    const chunks = this.demuxer.getChunksFromTimestamp(0);

    for await (const chunk of chunks) {
      // Backpressure: wait for buffer space
      await this.buffer.waitForSpace();

      // Backpressure: wait for decoder queue space
      await this.decoder.decode(chunk);
    }

    // Flush decoder to get final frames
    await this.decoder.flush();
  })();
}
```

## Related Code Files

### To Create
- `src/lib/exporter/frame-source.ts` - Interface and factory
- `src/lib/exporter/webcodecs-frame-source.ts` - WebCodecs implementation
- `src/lib/exporter/htmlvideo-frame-source.ts` - Fallback wrapper for PrefetchManager

### To Modify
- `src/lib/exporter/videoExporter.ts` - Use FrameSource instead of PrefetchManager
- `src/lib/exporter/render-coordinator.ts` - Minor: accept VideoFrame directly

## Implementation Steps

### Step 1: Create FrameSource Interface (30min)
1. Create `src/lib/exporter/frame-source.ts`
2. Define FrameSource interface and types
3. Create factory function:
   ```typescript
   async function createFrameSource(config: FrameSourceConfig): Promise<FrameSource> {
     // Try WebCodecs first
     if (typeof VideoDecoder !== 'undefined') {
       try {
         const source = new WebCodecsFrameSource(config);
         await source.initialize();
         return source;
       } catch (e) {
         console.warn('[FrameSource] WebCodecs failed, falling back:', e);
       }
     }

     // Fallback to HTMLVideoElement
     return new HTMLVideoFrameSource(config);
   }
   ```

### Step 2: Implement WebCodecsFrameSource (1.5h)
1. Create `src/lib/exporter/webcodecs-frame-source.ts`
2. Wire up: VideoDemuxer -> VideoDecoderService -> DecodedFrameBuffer
3. Implement `initialize()`:
   - Initialize demuxer
   - Configure decoder with extracted config
   - Wire decoder output to buffer
   - Start decode-ahead loop
4. Implement `getFrame()`:
   - Map effective->source timestamp (trim handling)
   - Wait for buffer to have frame
   - Return consumed frame
5. Implement decode-ahead loop with backpressure
6. Implement `destroy()` with full cleanup

### Step 3: Create HTMLVideoFrameSource Wrapper (30min)
1. Create `src/lib/exporter/htmlvideo-frame-source.ts`
2. Wrap existing PrefetchManager
3. Implement FrameSource interface:
   ```typescript
   class HTMLVideoFrameSource implements FrameSource {
     private prefetchManager: PrefetchManager;

     async getFrame(frameIndex: number, effectiveTimeMs: number): Promise<VideoFrame> {
       const video = await this.prefetchManager.getFrame(frameIndex, effectiveTimeMs);
       const timestamp = frameIndex * (1_000_000 / this.frameRate);
       return new VideoFrame(video, { timestamp });
     }
   }
   ```

### Step 4: Integrate with VideoExporter (30min)
1. Modify `VideoExporter.export()`:
   ```typescript
   // Replace:
   // this.prefetchManager = new PrefetchManager({...});

   // With:
   this.frameSource = await createFrameSource({
     videoUrl: this.config.videoUrl,
     frameRate: this.config.frameRate,
     trimRegions: this.config.trimRegions,
     debug: false,
   });

   console.log(`[VideoExporter] Using ${this.frameSource.mode} frame source`);
   ```
2. Update frame loop:
   ```typescript
   // Replace:
   // const videoElement = await this.prefetchManager.getFrame(frameIndex, effectiveTimeMs);
   // const videoFrame = new VideoFrame(videoElement, { timestamp });

   // With:
   const videoFrame = await this.frameSource.getFrame(frameIndex, effectiveTimeMs);
   ```
3. Update cleanup to destroy frameSource

### Step 5: Testing and Validation (30min)
1. Test WebCodecs path with WebM (VP9)
2. Test WebCodecs path with MP4 (H.264)
3. Test fallback triggers when codec unsupported
4. Verify parallel workers receive frames at speed
5. Verify trim region handling preserved
6. Performance comparison: before/after

## Todo List
- [ ] Create frame-source.ts interface and factory
- [ ] Define FrameSource, FrameSourceConfig, FrameSourceResult types
- [ ] Implement createFrameSource() factory with fallback logic
- [ ] Create webcodecs-frame-source.ts
- [ ] Wire Demuxer -> Decoder -> Buffer in initialize()
- [ ] Implement decode-ahead loop with backpressure
- [ ] Implement getFrame() with trim mapping
- [ ] Create htmlvideo-frame-source.ts wrapper
- [ ] Wrap PrefetchManager with FrameSource interface
- [ ] Modify videoExporter.ts to use FrameSource
- [ ] Replace prefetchManager with frameSource
- [ ] Update frame loop to use frameSource.getFrame()
- [ ] Update cleanup to destroy frameSource
- [ ] Test with WebM (VP9) recordings
- [ ] Test with MP4 (H.264) imports
- [ ] Test fallback path
- [ ] Verify parallel worker utilization
- [ ] Performance benchmarking

## Success Criteria
1. WebCodecs path used when available and supported
2. Frame extraction <5ms average with WebCodecs
3. All 4 parallel workers actively processing
4. 10-20x speedup for 1080p60 export (target: 30-60s for 1min)
5. Graceful fallback maintains existing behavior
6. Trim regions handled correctly in both paths

## Risk Assessment

### High: Integration Complexity
- **Risk:** Multiple async pipelines (demux, decode, buffer, render) may have timing issues
- **Mitigation:** Extensive logging; add debug mode; test with various content

### Medium: Codec Support Gaps
- **Risk:** Some imported videos may have unsupported codecs
- **Mitigation:** Fallback path ensures functionality; log which path used

### Low: Performance Regression in Fallback
- **Risk:** New abstraction layer adds overhead to HTMLVideoElement path
- **Mitigation:** HTMLVideoFrameSource is thin wrapper; benchmark to verify

## Security Considerations
- Validate video URLs before fetch (existing behavior)
- Handle malformed video gracefully (decoder error -> fallback)
- Close VideoFrames to prevent GPU memory exhaustion

## Performance Expectations

### Before (Current)
- Frame extraction: 100-140ms
- Worker utilization: 25% (1 of 4)
- Export time (1min 1080p60): ~10 minutes

### After (Target)
- Frame extraction: <5ms
- Worker utilization: 90%+
- Export time (1min 1080p60): 30-60 seconds

### Measurement Points
```typescript
// Add timing to videoExporter.ts
const frameStart = performance.now();
const videoFrame = await this.frameSource.getFrame(frameIndex, effectiveTimeMs);
const frameTime = performance.now() - frameStart;

if (this.debug) {
  console.log(`[Frame ${frameIndex}] Extraction: ${frameTime.toFixed(1)}ms`);
}
```

## Next Steps
After completing this phase:
1. Enable `useParallelRendering: true` by default in VideoExporter
2. Monitor performance in production usage
3. Consider Phase 3 (GPU Effects) if further optimization needed
