# Phase 2: VideoDecoder Service with Backpressure

## Context Links
- [WebCodecs VideoDecoder Research](./research/researcher-webcodecs-videodecoder-api.md)
- [Phase 1: Video Demuxer](./phase-01-video-demuxer.md)
- [Existing PrefetchManager](/Users/nghia/Projects/openscreen/src/lib/exporter/prefetch-manager.ts)

## Overview
- **Priority:** P1
- **Status:** pending
- **Effort:** 4h

Create a VideoDecoder wrapper service that handles hardware-accelerated decoding with proper backpressure management. This is the core component that transforms EncodedVideoChunks into VideoFrames at hardware speed.

## Key Insights

### VideoDecoder Lifecycle
```
unconfigured -> configured -> closed
                    |
                    v
                 (error)
```

### Backpressure is Critical
From research: monitor `decodeQueueSize` to prevent:
- Memory exhaustion from unbounded queue growth
- Stalling when queue saturates
- Lost frames from overflow

### Hardware Acceleration
- WebCodecs automatically uses hardware decoders when available
- No explicit flag needed; system codecs (VideoToolbox on macOS) used automatically
- Electron M4: Hardware acceleration works out of box with standard build

### Memory Management
- `VideoFrame.close()` MUST be called to release GPU memory
- Don't rely on garbage collection
- Clone frames only when needed (shares GPU resources)

## Requirements

### Functional
- Configure VideoDecoder from VideoDecoderConfig
- Decode EncodedVideoChunks into VideoFrames
- Manage decode queue with backpressure (max 8 pending)
- Emit decoded frames via callback in presentation order
- Support flush() for complete draining
- Handle decoder errors with recovery/reset

### Non-Functional
- Decode latency <5ms per frame (hardware path)
- Support 4K60 decode rates (240 frames/sec theoretical)
- Zero frame drops under normal operation

## Architecture

```typescript
interface DecoderServiceConfig {
  maxQueueSize?: number;  // Default: 8
  debug?: boolean;
}

type FrameCallback = (frame: VideoFrame, timestamp: number) => void;

class VideoDecoderService {
  constructor(config?: DecoderServiceConfig)

  // Lifecycle
  async configure(config: VideoDecoderConfig): Promise<boolean>
  async decode(chunk: EncodedVideoChunk): Promise<void>
  async flush(): Promise<void>
  close(): void

  // Backpressure
  canAcceptChunk(): boolean
  waitForSpace(): Promise<void>

  // Output
  setFrameCallback(callback: FrameCallback): void

  // Stats
  getStats(): DecoderStats
}

interface DecoderStats {
  framesDecoded: number;
  framesDropped: number;
  averageDecodeTime: number;
  queueSize: number;
  isHardwareAccelerated: boolean;  // Estimated
}
```

### Decode Flow

```
[EncodedVideoChunk] --> canAcceptChunk()?
                              |
              yes ------------|------------- no
               |                              |
               v                              v
          decode(chunk)                 waitForSpace()
               |                              |
               v                              |
          [VideoDecoder]                      |
               |                              |
               v                              |
          outputCallback <--------------------+
               |
               v
          frameCallback(VideoFrame)
```

## Related Code Files

### To Create
- `src/lib/exporter/video-decoder-service.ts` - Main decoder service class

### To Reference
- `src/lib/exporter/encode-queue.ts` - Backpressure pattern reference
- `src/lib/exporter/prefetch-manager.ts` - Current frame extraction (to replace)

## Implementation Steps

### Step 1: Create VideoDecoderService Class (1.5h)
1. Create `src/lib/exporter/video-decoder-service.ts`
2. Implement constructor with config defaults
3. Add private VideoDecoder instance management
4. Implement `configure()` method:
   ```typescript
   async configure(config: VideoDecoderConfig): Promise<boolean> {
     // 1. Check support
     const support = await VideoDecoder.isConfigSupported(config);
     if (!support.supported) return false;

     // 2. Create decoder with callbacks
     this.decoder = new VideoDecoder({
       output: this.handleFrame.bind(this),
       error: this.handleError.bind(this),
     });

     // 3. Configure
     this.decoder.configure(config);
     return true;
   }
   ```

### Step 2: Implement Decode with Backpressure (1.5h)
1. Track queue size via `decodeQueueSize` property
2. Implement `canAcceptChunk()`:
   ```typescript
   canAcceptChunk(): boolean {
     return this.decoder?.decodeQueueSize < this.maxQueueSize;
   }
   ```
3. Implement `waitForSpace()` using dequeue event:
   ```typescript
   async waitForSpace(): Promise<void> {
     if (this.canAcceptChunk()) return;

     return new Promise(resolve => {
       const handler = () => {
         if (this.canAcceptChunk()) {
           this.decoder?.removeEventListener('dequeue', handler);
           resolve();
         }
       };
       this.decoder?.addEventListener('dequeue', handler);
     });
   }
   ```
4. Implement `decode()`:
   ```typescript
   async decode(chunk: EncodedVideoChunk): Promise<void> {
     await this.waitForSpace();
     this.decoder?.decode(chunk);
   }
   ```

### Step 3: Implement Output Handler (30min)
1. Add frame callback registration
2. Implement `handleFrame()` output callback:
   ```typescript
   private handleFrame(frame: VideoFrame): void {
     this.framesDecoded++;
     this.frameCallback?.(frame, frame.timestamp);
     // Note: Consumer is responsible for calling frame.close()
   }
   ```
3. Track decode timing for stats

### Step 4: Implement Flush and Close (30min)
1. Implement `flush()`:
   ```typescript
   async flush(): Promise<void> {
     if (this.decoder?.state === 'configured') {
       await this.decoder.flush();
     }
   }
   ```
2. Implement `close()`:
   ```typescript
   close(): void {
     if (this.decoder?.state !== 'closed') {
       this.decoder?.close();
     }
     this.decoder = null;
   }
   ```
3. Add error handler with decoder reset capability

### Step 5: Add Stats and Debug Logging (30min)
1. Track frames decoded/dropped
2. Track average decode time
3. Estimate hardware acceleration (decode time <5ms suggests hardware)
4. Add debug logging option

## Todo List
- [ ] Create video-decoder-service.ts with class skeleton
- [ ] Implement constructor with config defaults
- [ ] Implement configure() with isConfigSupported check
- [ ] Create VideoDecoder with output/error callbacks
- [ ] Implement canAcceptChunk() queue check
- [ ] Implement waitForSpace() with dequeue event
- [ ] Implement decode() with backpressure
- [ ] Implement handleFrame() output callback
- [ ] Implement flush() for complete drain
- [ ] Implement close() for cleanup
- [ ] Add handleError() with recovery
- [ ] Track decode timing stats
- [ ] Add debug logging
- [ ] Test with VP9 content
- [ ] Test with H.264 content
- [ ] Test backpressure under load

## Success Criteria
1. Decodes VP9 and H.264 content successfully
2. Average decode time <5ms with hardware acceleration
3. No dropped frames under normal operation
4. Proper backpressure prevents queue overflow
5. Clean shutdown with flush() completes all pending

## Risk Assessment

### High: Decoder Configuration Failures
- **Risk:** Codec config from demuxer may be rejected
- **Mitigation:** Validate with `isConfigSupported()` first; log detailed error info

### Medium: Hardware Acceleration Not Available
- **Risk:** Software decode may be too slow for 4K60
- **Mitigation:** Track decode timing; warn if >10ms average; consider 1080p target

### Medium: Frame Ordering
- **Risk:** Decoder outputs in presentation order, may not match input
- **Mitigation:** Phase 3 FrameBuffer handles reordering

### Low: Memory Leaks from Unclosed Frames
- **Risk:** Consumer forgets to call `frame.close()`
- **Mitigation:** Document requirement clearly; add optional auto-close mode

## Security Considerations
- VideoDecoder operates on ArrayBuffer data; validate chunk sizes
- Handle malformed chunks gracefully (decoder error callback)
- Don't expose decoder internals to untrusted code

## Next Steps
After completing this phase:
1. Phase 3: FrameBuffer manages decoded frames for consumption
2. Integration point: `DecoderService.setFrameCallback()` feeds `FrameBuffer.addFrame()`
