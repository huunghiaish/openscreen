# Code Review: WebCodecs VideoDecoder - Phase 1 Video Demuxer

**Date:** 2026-01-16
**Reviewer:** code-reviewer agent
**Plan:** `/Users/nghia/Projects/openscreen/plans/260116-2240-webcodecs-video-decoder/phase-01-video-demuxer.md`

---

## Score: 8.5/10

Strong implementation with solid architecture, proper TypeScript typing, and good error handling. Docked points for missing URL cleanup in primary workflow and incomplete TODO checklist.

---

## Scope

**Files Reviewed:**
- `/Users/nghia/Projects/openscreen/src/lib/exporter/video-demuxer.ts` (296 LOC)

**Lines of Code:** ~296 (within 200 LOC guideline, acceptable for initial implementation)

**Review Focus:**
- Phase 1 implementation for WebCodecs VideoDecoder plan
- mediabunny wrapper for video demuxing
- Security, performance, architecture, code quality

**Build Status:** ✅ Pass (TypeScript + Vite + electron-builder)
**Lint Status:** ✅ Pass (no warnings)
**Test Status:** ✅ Pass (68/68 tests, no new tests for this module yet)

---

## Overall Assessment

Well-structured demuxer wrapper with clean API design. Implementation correctly uses mediabunny's async APIs and properly handles resource cleanup. TypeScript types are explicit and comprehensive. Error handling is thorough with proper cleanup on failures.

**Strengths:**
- Clean separation of concerns (demuxing vs decoding)
- Proper async/await patterns
- Explicit TypeScript types with comprehensive interfaces
- Good error handling with cleanup on failures
- Proper lifecycle management (initialized/destroyed states)
- Debug logging capability
- WebCodecs codec validation before use

**Concerns:**
- Memory leak risk in `createDemuxerFromBlob` (URL not revoked on success)
- File exceeds 200 LOC guideline (296 LOC, should consider splitting)
- No unit tests for this critical module
- Unclear how `UrlSource` handles `file://` vs `http://` URLs

---

## Critical Issues

### 1. Memory Leak: Object URL Not Revoked in createDemuxerFromBlob

**Location:** Lines 276-296

**Issue:**
```typescript
export async function createDemuxerFromBlob(
  blob: Blob,
  options: { debug?: boolean } = {}
): Promise<{ demuxer: VideoDemuxer; result: DemuxerResult }> {
  const videoUrl = URL.createObjectURL(blob);  // Creates URL
  const demuxer = new VideoDemuxer({ videoUrl, debug: options.debug });

  try {
    const result = await demuxer.initialize();
    return { demuxer, result };  // ❌ URL never revoked on success path
  } catch (error) {
    URL.revokeObjectURL(videoUrl);  // ✅ Only revoked on error
    throw error;
  }
}
```

**Impact:** Object URLs persist in memory until page unload. For repeated imports, this leaks blob memory. Each 1GB video creates a persistent memory reference.

**Fix Required:**
```typescript
// Option 1: Revoke immediately after Input reads it
const result = await demuxer.initialize();
URL.revokeObjectURL(videoUrl); // ✅ Revoke after use
return { demuxer, result };

// Option 2: Add cleanup method to demuxer
// Return cleanup function to caller
return {
  demuxer,
  result,
  cleanup: () => URL.revokeObjectURL(videoUrl)
};

// Option 3: Document caller responsibility
// Add JSDoc warning that caller must revoke URL
```

**Recommendation:** Use Option 1 - revoke immediately after `initialize()`. mediabunny's `UrlSource` should have already loaded necessary data during initialization.

---

## High Priority Findings

### 2. File Size Exceeds 200 LOC Guideline

**Current:** 296 LOC
**Target:** <200 LOC per code-standards.md

**Recommendation:**
Consider splitting into:
- `video-demuxer-core.ts` (150 LOC) - Core VideoDemuxer class
- `video-demuxer-utils.ts` (50 LOC) - Helper functions (`createDemuxerFromBlob`, constants)
- `video-demuxer-types.ts` (30 LOC) - Type definitions

**Rationale:** While 296 LOC is manageable, following project guidelines ensures consistency and better LLM context management. Can defer until Phase 2 if timeline tight.

---

### 3. Missing Unit Tests

**Risk:** No tests for critical demuxing logic

**Missing Coverage:**
- `initialize()` error paths (network failure, unsupported codec, no video track)
- `getChunksFromTimestamp()` iteration logic
- `seekToKeyframe()` boundary conditions
- `destroy()` idempotency
- State validation (`ensureInitialized`, `destroyed` checks)
- `createDemuxerFromBlob()` error handling

**Recommendation:** Add tests before Phase 2 integration. Critical for catching edge cases with different video formats.

---

### 4. Unclear UrlSource Behavior with file:// URLs

**Location:** Line 92

```typescript
this.source = new UrlSource(this.config.videoUrl);
```

**Question:** Does mediabunny's `UrlSource` support `file://` URLs in Electron?

**Risk:** Electron may restrict `file://` access from renderer. May need `FileSource` instead for local files.

**Validation Needed:**
```typescript
// Check if videoUrl is file:// protocol
if (this.config.videoUrl.startsWith('file://')) {
  // May need to use FileSource or Electron protocol handlers
}
```

**Recommendation:** Test with actual local video file in Electron before Phase 2. Document URL requirements in JSDoc.

---

## Medium Priority Improvements

### 5. Add JSDoc Documentation

**Current:** Minimal inline comments
**Required:** JSDoc for all public exports per code-standards.md

**Missing Documentation:**
- Class-level JSDoc explaining usage pattern
- Parameter descriptions for all methods
- Return type descriptions
- `@throws` annotations for error cases
- Usage examples

**Example:**
```typescript
/**
 * VideoDemuxer - Extracts EncodedVideoChunks from MP4/WebM containers
 *
 * Wraps mediabunny for container parsing and provides WebCodecs-compatible
 * chunk extraction. Supports keyframe seeking and streaming iteration.
 *
 * @example
 * ```typescript
 * const demuxer = new VideoDemuxer({ videoUrl: 'file:///path/to/video.mp4' });
 * const { config, width, height, fps } = await demuxer.initialize();
 *
 * for await (const chunk of demuxer.getChunksFromTimestamp(0)) {
 *   videoDecoder.decode(chunk);
 * }
 *
 * demuxer.destroy();
 * ```
 */
export class VideoDemuxer {
  // ...
}
```

---

### 6. Error Messages Could Be More Specific

**Current:**
```typescript
throw new Error('No video track found in file');
throw new Error('Could not extract decoder configuration');
```

**Better:**
```typescript
throw new Error(`No video track found in file: ${this.config.videoUrl}`);
throw new Error(
  `Could not extract decoder configuration from video track ` +
  `(codec: ${this.videoTrack?.codec}, trackId: ${this.videoTrack?.id})`
);
```

**Benefit:** Easier debugging when multiple videos are being processed.

---

### 7. Consider Adding Progress Callback

**Use Case:** Long videos may take time to initialize (computing duration/stats)

**Enhancement:**
```typescript
export interface DemuxerConfig {
  videoUrl: string;
  debug?: boolean;
  onProgress?: (phase: string, progress: number) => void; // NEW
}

async initialize(): Promise<DemuxerResult> {
  this.config.onProgress?.('loading', 0.1);
  this.source = new UrlSource(this.config.videoUrl);

  this.config.onProgress?.('detecting-format', 0.3);
  this.input = new Input({ source: this.source, formats: SUPPORTED_VIDEO_FORMATS });

  // ... etc
}
```

**Priority:** Low. Nice-to-have for UX but not critical for Phase 1.

---

## Low Priority Suggestions

### 8. Consider Defensive Cloning of decoderConfig

**Current:**
```typescript
getDecoderConfig(): VideoDecoderConfig | null {
  return this.decoderConfig;
}
```

**Safer:**
```typescript
getDecoderConfig(): VideoDecoderConfig | null {
  return this.decoderConfig ? { ...this.decoderConfig } : null;
}
```

**Rationale:** Prevents accidental mutation by callers. However, `VideoDecoderConfig` is typically treated as immutable, so low priority.

---

### 9. Default FPS Fallback Could Use Better Value

**Current:**
```typescript
const fps = packetStats.averagePacketRate || 30; // Default to 30 if unknown
```

**Consideration:** Screen recordings typically 60fps. Consider:
```typescript
const fps = packetStats.averagePacketRate || 60; // Default to 60fps (common for screen recordings)
```

Or extract from container metadata first.

---

### 10. Consider Caching computeDuration Result

**Observation:** `computeDuration()` may scan entire file

**Enhancement:**
```typescript
private cachedDuration: number | null = null;

async initialize(): Promise<DemuxerResult> {
  // ...
  const duration = this.cachedDuration = await this.input.computeDuration();
  // ...
}
```

**Priority:** Very low. Only beneficial if duration is queried multiple times.

---

## Positive Observations

### ✅ Excellent State Management
- Clear `initialized` and `destroyed` flags
- `ensureInitialized()` guard prevents invalid operations
- Idempotent `destroy()` method

### ✅ Proper Async Iterator Pattern
```typescript
async *getChunksFromTimestamp(startTime = 0, endTime = Infinity): AsyncGenerator<...> {
  // Clean implementation with early return and proper iteration
}
```

### ✅ Codec Validation with WebCodecs
```typescript
const support = await VideoDecoder.isConfigSupported(this.decoderConfig);
if (!support.supported) {
  throw new Error(`Unsupported codec: ${this.decoderConfig.codec}`);
}
```

### ✅ Cleanup on Error
```typescript
try {
  // initialization
} catch (error) {
  this.destroy(); // ✅ Ensures cleanup even on error
  throw error;
}
```

### ✅ Explicit TypeScript Types
All interfaces and method signatures have explicit types. No `any` usage.

### ✅ Debug Logging
Optional debug logging without performance impact in production.

---

## Security Audit

### ✅ No Injection Vulnerabilities
- No eval, Function constructor, or innerHTML
- URL handling via standard APIs

### ✅ Input Validation
- Codec validation via `VideoDecoder.isConfigSupported()`
- Container format validation via mediabunny
- State checks before operations

### ⚠️ URL Security
- **Concern:** No validation of `videoUrl` origin
- **Recommendation:** Add CORS/same-origin check for `http://` URLs
- **Example:**
```typescript
if (this.config.videoUrl.startsWith('http')) {
  // Validate same-origin or CORS
  const url = new URL(this.config.videoUrl);
  if (url.origin !== window.location.origin) {
    // Warn or require explicit allowlist
  }
}
```

### ✅ No Sensitive Data Exposure
- No logging of video content
- Debug logs only show metadata (timestamps, dimensions)

---

## Performance Analysis

### ✅ Memory Efficient Streaming
- Uses mediabunny's streaming reads (no full-file buffering)
- Async generator for chunk iteration (yield on demand)
- Proper disposal via `destroy()`

### ✅ Async Patterns
- All I/O operations are async
- No blocking operations

### ⚠️ Potential Bottleneck
- `computePacketStats(100)` samples 100 packets
- For videos with many B-frames, this could be slow
- **Mitigation:** Already limited to 100 packets (good)

### ✅ Zero-Copy Chunk Creation
```typescript
yield packet.toEncodedVideoChunk();
```
mediabunny's `toEncodedVideoChunk()` should use underlying buffer without copy.

---

## Architecture Assessment

### ✅ Follows YAGNI/KISS/DRY
- No premature abstractions
- Single responsibility (demuxing only)
- No code duplication

### ✅ Clean API Surface
```typescript
new VideoDemuxer(config)
  .initialize() -> metadata
  .getChunksFromTimestamp(start, end) -> AsyncGenerator<EncodedVideoChunk>
  .seekToKeyframe(timestamp) -> number
  .destroy()
```

### ✅ Proper Separation of Concerns
- Demuxing (this module) vs Decoding (Phase 2)
- Configuration vs Result types
- Helper function (`createDemuxerFromBlob`) for common use case

### ✅ Consistent with Codebase Patterns
- Matches existing exporter structure (`src/lib/exporter/`)
- Follows TypeScript standards from code-standards.md
- Uses kebab-case file naming

---

## Plan Status Check

### Phase 1 Todo Checklist (from phase-01-video-demuxer.md)

- ✅ Create video-demuxer.ts file with class skeleton
- ✅ Implement initialize() with mediabunny Input
- ✅ Extract VideoDecoderConfig from track
- ✅ Implement getChunksFromTimestamp() async generator
- ✅ Convert packet timestamps to microseconds
- ✅ Implement seekToKeyframe() method
- ✅ Add destroy() cleanup method
- ✅ Add error handling for network/codec failures
- ✅ Add debug logging
- ❌ Test with WebM (VP8/VP9) files
- ❌ Test with MP4 (H.264) files

**Status:** Implementation complete, testing incomplete

---

## Recommended Actions

### Must Fix (Before Phase 2)
1. **Fix memory leak in createDemuxerFromBlob** - Revoke object URL after initialization
2. **Validate UrlSource with file:// URLs** - Test in Electron environment
3. **Add unit tests** - Cover initialization, iteration, seeking, error paths

### Should Fix (Before Phase 2)
4. **Add JSDoc documentation** - Class and method documentation
5. **Improve error messages** - Include context (URL, codec, track info)
6. **Consider file size split** - Move types/utils to separate files (defer to Phase 2 if needed)

### Nice to Have (Post-Phase 2)
7. Add progress callbacks for long operations
8. Add URL origin validation for security
9. Consider defensive cloning of decoderConfig
10. Add integration tests with actual video files

---

## Metrics

- **Type Coverage:** 100% (no `any` usage)
- **Test Coverage:** 0% (no tests yet for this module)
- **Linting Issues:** 0 (clean)
- **Build Status:** ✅ Pass
- **Cyclomatic Complexity:** Low (simple control flow)
- **LOC:** 296 (target: <200)

---

## Updated Plan Status

**Phase 1: Video Demuxer Wrapper**
- Status: Implementation complete, testing incomplete
- Next: Fix critical issue #1, add tests, validate with real files
- Estimated: +2h for fixes and tests

---

## Unresolved Questions

1. Does mediabunny's `UrlSource` support `file://` protocol in Electron renderer?
2. Should object URLs be revoked immediately or kept alive for demuxer lifetime?
3. What's the expected behavior for videos with no audio track (ensure demuxer still works)?
4. Should we support video track selection (if multiple video tracks exist)?
5. How should we handle encrypted/DRM-protected videos?

---

## Next Steps

1. **Immediate:** Fix memory leak (Issue #1)
2. **Before Phase 2:** Add unit tests + validate file:// URLs in Electron
3. **Phase 2:** Integrate with VideoDecoderService
4. **Phase 4:** Add end-to-end integration tests with RenderCoordinator

---

## References

- Plan: `/Users/nghia/Projects/openscreen/plans/260116-2240-webcodecs-video-decoder/phase-01-video-demuxer.md`
- Code: `/Users/nghia/Projects/openscreen/src/lib/exporter/video-demuxer.ts`
- mediabunny docs: `node_modules/mediabunny/README.md`
- WebCodecs spec: https://w3c.github.io/webcodecs/
- Code standards: `/Users/nghia/Projects/openscreen/docs/code-standards.md`
