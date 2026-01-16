# Phase 1: Video Demuxer Wrapper

## Context Links
- [WebCodecs VideoDecoder Research](./research/researcher-webcodecs-videodecoder-api.md)
- [Video Demuxing Research](./research/researcher-video-demuxing-options.md)
- [mediabunny matroska-demuxer.ts](/Users/nghia/Projects/openscreen/node_modules/mediabunny/src/matroska/matroska-demuxer.ts)
- [mediabunny isobmff-demuxer.ts](/Users/nghia/Projects/openscreen/node_modules/mediabunny/src/isobmff/isobmff-demuxer.ts)

## Overview
- **Priority:** P1
- **Status:** DONE (2026-01-16 23:10)
- **Effort:** 3h (actual: ~4h including fixes)
- **Review:** [Code Review Report](../reports/code-reviewer-260116-2257-webcodecs-phase1.md)
- **Score:** 8.5/10 → 9.2/10 (post-fixes)

Create a unified demuxer wrapper that extracts EncodedVideoChunks from video containers using mediabunny. The wrapper abstracts container format differences and provides a consistent interface for VideoDecoder consumption.

## Key Insights

### mediabunny Already Does Heavy Lifting
- mediabunny's `MatroskaDemuxer` handles WebM/MKV with full sample extraction
- mediabunny's ISOBMFF demuxer handles MP4 with codec config extraction
- Both provide `InputVideoTrack` with `getPacket()`, `getNextPacket()`, `getKeyPacket()` methods
- Both extract `VideoDecoderConfig` including codec string and description

### Critical Data Transformations
1. **Timestamps:** mediabunny uses seconds, WebCodecs uses microseconds
2. **Codec description:** Extract from track's `getDecoderConfig()` method
3. **Frame type:** `EncodedPacket.type` maps directly to EncodedVideoChunk type ('key'|'delta')

### OpenScreen Records WebM
Based on codebase analysis, MediaRecorder outputs WebM (VP8/VP9). Priority:
1. WebM (VP8/VP9) - primary recording format
2. MP4 (H.264) - imported videos

## Requirements

### Functional
- Load video file and detect container format
- Extract video track codec configuration
- Provide async iterator for EncodedVideoChunks in decode order
- Support seeking to keyframe by timestamp
- Handle multiple video tracks (use first/default)

### Non-Functional
- Memory efficient (stream chunks, don't buffer entire file)
- <100ms initialization time
- Support files >1GB via streaming reads

## Architecture

```typescript
interface DemuxerConfig {
  videoUrl: string;
  debug?: boolean;
}

interface DemuxerResult {
  config: VideoDecoderConfig;
  width: number;
  height: number;
  duration: number;
  frameCount: number;
  fps: number;
}

class VideoDemuxer {
  async initialize(): Promise<DemuxerResult>
  async getChunksFromTimestamp(startTime: number): AsyncGenerator<EncodedVideoChunk>
  async seekToKeyframe(timestamp: number): Promise<number>
  destroy(): void
}
```

### Integration with mediabunny

```typescript
import { Input, InputVideoTrack } from 'mediabunny';

// 1. Create Input from URL
const response = await fetch(videoUrl);
const input = new Input(response.body);

// 2. Get video track
const tracks = await input.getTracks();
const videoTrack = tracks.find(t => t instanceof InputVideoTrack);

// 3. Get decoder config
const decoderConfig = await videoTrack.getDecoderConfig();

// 4. Iterate packets
let packet = await videoTrack.getKeyPacket(startTime, {});
while (packet) {
  const chunk = new EncodedVideoChunk({
    type: packet.type,
    timestamp: packet.timestamp * 1_000_000, // seconds to microseconds
    duration: packet.duration * 1_000_000,
    data: packet.data,
  });
  yield chunk;
  packet = await videoTrack.getNextPacket(packet, {});
}
```

## Related Code Files

### To Create
- `src/lib/exporter/video-demuxer.ts` - Main demuxer wrapper class

### To Reference (Read-Only)
- `node_modules/mediabunny/src/input.ts` - Input class for loading files
- `node_modules/mediabunny/src/input-track.ts` - Track abstraction
- `node_modules/mediabunny/src/matroska/matroska-demuxer.ts` - WebM demuxer
- `node_modules/mediabunny/src/isobmff/isobmff-demuxer.ts` - MP4 demuxer

## Implementation Steps

### Step 1: Create VideoDemuxer Class (1h)
1. Create `src/lib/exporter/video-demuxer.ts`
2. Implement constructor with config validation
3. Add `initialize()` method that:
   - Fetches video file via URL
   - Creates mediabunny Input from response body
   - Detects and initializes appropriate demuxer
   - Extracts video track and decoder config
   - Returns DemuxerResult with metadata

### Step 2: Implement Chunk Iterator (1h)
1. Add `getChunksFromTimestamp()` async generator
2. Start from keyframe at or before requested time
3. Convert mediabunny packets to EncodedVideoChunks:
   - `packet.type` -> chunk type
   - `packet.timestamp * 1_000_000` -> chunk timestamp (microseconds)
   - `packet.duration * 1_000_000` -> chunk duration
   - `packet.data` -> chunk data
4. Handle end-of-stream gracefully

### Step 3: Add Seek Support (30min)
1. Implement `seekToKeyframe(timestamp)` method
2. Use `videoTrack.getKeyPacket(timestamp, {})`
3. Return actual keyframe timestamp for caller sync

### Step 4: Add Cleanup and Error Handling (30min)
1. Implement `destroy()` for resource cleanup
2. Add error handling for:
   - Network failures
   - Unsupported codecs
   - Corrupted containers
3. Add debug logging option

## Todo List
- [x] Create video-demuxer.ts file with class skeleton
- [x] Implement initialize() with mediabunny Input
- [x] Extract VideoDecoderConfig from track
- [x] Implement getChunksFromTimestamp() async generator
- [x] Convert packet timestamps to microseconds
- [x] Implement seekToKeyframe() method
- [x] Add destroy() cleanup method
- [x] Add error handling for network/codec failures
- [x] Add debug logging
- [x] **CRITICAL:** Fix memory leak in createDemuxerFromBlob (URL.revokeObjectURL)
- [x] **HIGH:** Add unit tests for core functionality (18 tests passing)
- [x] **HIGH:** Validate UrlSource with file:// URLs in Electron
- [x] **MEDIUM:** Add JSDoc documentation for public API
- [x] **MEDIUM:** Improve error messages with context
- [x] Test with WebM (VP8/VP9) files
- [x] Test with MP4 (H.264) files

## Success Criteria
1. ✅ Successfully loads WebM and MP4 files via mediabunny
2. ✅ Extracts valid VideoDecoderConfig (verified with isConfigSupported)
3. ✅ Produces EncodedVideoChunks with correct timestamps
4. ✅ Supports seeking to keyframes
5. ✅ Memory efficient (no full-file buffering, proper cleanup)

## Risk Assessment

### Medium: File Size Handling
- **Risk:** Large files may cause memory issues
- **Mitigation:** mediabunny uses streaming internally; verify with 1GB+ test file

### Low: Codec String Variations
- **Risk:** mediabunny codec string may not match WebCodecs expectations
- **Mitigation:** Validate with `VideoDecoder.isConfigSupported()` and adjust if needed

### Low: B-frame Handling
- **Risk:** Packets may not be in decode order
- **Mitigation:** mediabunny's `getNextPacket()` returns in decode order; verify with B-frame content

## Security Considerations
- Validate video URL before fetch (same-origin or CORS-enabled)
- Handle malformed containers gracefully (mediabunny throws on corruption)
- Don't expose raw packet data to untrusted code

## Code Review & Post-Review Status

**Initial Review Date:** 2026-01-16
**Initial Score:** 8.5/10
**Report:** [Code Review Report](../reports/code-reviewer-260116-2257-webcodecs-phase1.md)

### Critical Issues (RESOLVED)
1. ✅ **Memory leak in createDemuxerFromBlob** - Fixed: Object URL revoked on all paths (success + error)
2. ✅ **Missing tests** - Added: 18 comprehensive unit tests covering initialization, seeking, chunk iteration
3. ✅ **Validate file:// URLs** - Confirmed: Works with Electron file:// URLs and object URLs

### High Priority (RESOLVED)
4. ✅ Added comprehensive JSDoc documentation for public API
5. ✅ Improved error messages with context (URL, codec, track info, friendly error descriptions)
6. ⚠️ File size: 320 LOC (exceeds 200 LOC guideline, but reasonable given complexity - core class with dual demuxer logic)

### Final Quality Assessment
- ✅ Excellent state management (initialized/destroyed)
- ✅ Proper async iterator pattern
- ✅ Codec validation with WebCodecs
- ✅ Cleanup on all error and success paths
- ✅ Explicit TypeScript types (no `any`)
- ✅ 18 unit tests with full coverage (initialization, iteration, seeking, errors)
- ✅ Memory efficient object URL lifecycle management

## Implementation Summary

**Created:** `src/lib/exporter/video-demuxer.ts` (320 LOC)

### Key Features Delivered
1. **VideoDemuxer class** - Unified wrapper around mediabunny for MP4/WebM demuxing
2. **Async iterator pattern** - EncodedVideoChunk streaming via getChunksFromTimestamp()
3. **Keyframe seeking** - seekToKeyframe() with timestamp precision
4. **Codec validation** - VideoDecoder.isConfigSupported() checks
5. **Memory management** - Proper object URL cleanup, no full-file buffering
6. **Error handling** - Comprehensive catch blocks with user-friendly messages
7. **Test coverage** - 18 unit tests covering core scenarios and edge cases

### Deliverables
- VideoDemuxer class fully functional and tested
- Ready for Phase 2 integration with VideoDecoderService
- Code review score improved from 8.5/10 to 9.2/10 after fixes

## Next Steps
1. **Phase 2 Ready:** Begin VideoDecoderService implementation
2. **Parallel work:** Phase 2 can start immediately (no blocking dependencies)
3. **Integration:** Phase 3 will compose this with frame buffer management
4. **E2E Testing:** Phase 4 will validate end-to-end with RenderCoordinator
