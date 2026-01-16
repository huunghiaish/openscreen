# Investigation Report: Exported Videos Missing Microphone and System Audio

**Date:** 2026-01-16 16:57
**Investigator:** debugger agent
**Issue:** Exported MP4/GIF videos do not include microphone or system audio tracks
**Severity:** High - Core functionality broken

---

## Executive Summary

**Root Cause:** VideoMuxer is initialized with `hasAudio = false` hardcoded in VideoExporter and GifExporter, preventing audio tracks from being added to exported videos.

**Impact:** All video exports (MP4/GIF) are silent, even when microphone and system audio were recorded. Audio files exist on disk but are not muxed into final output.

**Fix Required:** Pass microphone/system audio paths to exporters, decode audio, create audio encoder, and mux audio chunks alongside video chunks.

---

## Investigation Timeline

### 1. Initial Code Analysis

**Recording Pipeline (WORKING):**
- `useScreenRecorder.ts` lines 209-242: Mic and system audio MediaRecorders start successfully
- Lines 319-332: Audio blobs stored to disk as `mic-{timestamp}.webm` and `system-audio-{timestamp}.webm`
- IPC handlers `store-audio-recording` and `store-system-audio-recording` validate and save files
- Verified in `electron/ipc/handlers.ts` lines 338-367

**Audio File Loading (WORKING):**
- `VideoEditor.tsx` lines 240-256: Loads mic and system audio paths via IPC
- `getMicAudioPath` and `getSystemAudioPath` handlers resolve paths from recording timestamp
- Audio paths passed to `VideoPlayback` component for preview playback (lines 952-953)
- Preview playback WORKS: `<audio>` elements in `VideoPlayback.tsx` lines 970-984 play audio correctly

**Export Pipeline (BROKEN):**
- `VideoEditor.tsx` line 770-796: Creates VideoExporter with only video path and camera PiP config
- **CRITICAL:** No mic/system audio paths passed to exporter
- `VideoExporter.ts` line 120: Muxer initialized with `hasAudio = false` hardcoded
- `VideoMuxer.ts` line 19: Constructor accepts `hasAudio` but it's always false
- Lines 42-45: Audio source only created if `hasAudio === true`
- Result: No audio track added to MP4 container

---

## Technical Analysis

### Evidence Chain

**1. VideoExporter.ts (lines 770-796)**
```typescript
const exporter = new VideoExporter({
  videoUrl: videoPath,          // ✅ Screen video
  width: exportWidth,
  height: exportHeight,
  frameRate: 60,
  bitrate,
  codec: 'avc1.640033',
  wallpaper,
  zoomRegions,
  trimRegions,
  // ... visual effects ...
  cameraVideoUrl: cameraVideoPathRef.current || undefined,  // ✅ Camera video
  cameraPipConfig,
  // ❌ MISSING: micAudioUrl
  // ❌ MISSING: systemAudioUrl
});
```

**2. VideoMuxer.ts (line 120)**
```typescript
this.muxer = new VideoMuxer(this.config, false);  // ❌ hasAudio hardcoded false
```

**3. VideoMuxer.ts constructor (lines 19-22)**
```typescript
constructor(config: ExportConfig, hasAudio = false) {
  this.config = config;
  this.hasAudio = hasAudio;  // ❌ Always false, no audio track created
}
```

**4. VideoMuxer.ts audio track creation (lines 42-45)**
```typescript
if (this.hasAudio) {
  this.audioSource = new EncodedAudioPacketSource('opus');
  this.output.addAudioTrack(this.audioSource);
}
// ❌ This block never executes because hasAudio is always false
```

### System Behavior

**What Works:**
- ✅ Microphone audio recording (WebM format)
- ✅ System audio recording (WebM format on macOS 13.2+)
- ✅ Audio files stored with correct naming: `mic-{timestamp}.webm`, `system-audio-{timestamp}.webm`
- ✅ Audio paths resolved and loaded in editor
- ✅ Audio preview playback in editor (separate `<audio>` elements)
- ✅ Video export pipeline (visual effects, zoom, crop, camera PiP)

**What's Broken:**
- ❌ Audio not passed to VideoExporter config
- ❌ VideoMuxer not configured for audio
- ❌ No audio decoder for mic/system audio WebM files
- ❌ No audio encoder for transcoding to MP4-compatible codec
- ❌ No audio chunks muxed into final MP4 container

---

## Root Cause Analysis

### Primary Issue: Missing Audio Pipeline in Export

**Location:** `src/lib/exporter/videoExporter.ts` + `src/lib/exporter/muxer.ts`

**Problem:**
1. `VideoExporter` only processes screen video (and composites camera PiP visually)
2. No mechanism to:
   - Accept mic/system audio file paths as config parameters
   - Decode audio WebM files to raw audio frames
   - Encode audio to AAC/Opus for MP4 container
   - Mux audio chunks with video chunks
3. Muxer initialized with `hasAudio = false` prevents audio track creation

**Contrast with Camera PiP (WORKING):**
- Camera video passed as `cameraVideoUrl` (line 794)
- `CameraPipRenderer` loads and decodes camera video
- Camera frames composited onto video canvas during render
- **BUT:** Camera audio also lost (same issue - no audio muxing)

---

## Code Locations Requiring Fixes

### 1. Export Configuration Types
**File:** `src/lib/exporter/types.ts`
**Changes Required:**
```typescript
export interface ExportConfig {
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
  codec?: string;
  // ADD:
  micAudioUrl?: string;      // Path to mic-{timestamp}.webm
  systemAudioUrl?: string;   // Path to system-audio-{timestamp}.webm
}
```

### 2. VideoExporter Constructor
**File:** `src/lib/exporter/videoExporter.ts` (line 7)
**Changes Required:**
```typescript
interface VideoExporterConfig extends ExportConfig {
  videoUrl: string;
  // ... existing fields ...
  cameraVideoUrl?: string;
  cameraPipConfig?: CameraPipConfig;
  // ADD:
  micAudioUrl?: string;
  systemAudioUrl?: string;
}
```

### 3. Audio Decoder Module (NEW FILE NEEDED)
**File:** `src/lib/exporter/audioDecoder.ts` (create new)
**Purpose:**
- Load WebM audio file into `<audio>` element
- Use Web Audio API `AudioContext.decodeAudioData()` to decode
- Return raw PCM audio samples for encoding

**Similar Pattern:** See `videoDecoder.ts` for reference

### 4. Audio Encoder Integration
**File:** `src/lib/exporter/videoExporter.ts`
**Changes Required:**
- Initialize `AudioEncoder` from WebCodecs API
- Configure for AAC or Opus codec (MP4 compatible)
- Feed decoded audio samples to encoder
- Pass encoded audio chunks to muxer

**Reference:** Line 255 shows VideoEncoder setup - similar pattern needed for audio

### 5. Muxer Audio Track Setup
**File:** `src/lib/exporter/muxer.ts` (line 120)
**Changes Required:**
```typescript
// BEFORE:
this.muxer = new VideoMuxer(this.config, false);

// AFTER:
const hasAudio = !!(this.config.micAudioUrl || this.config.systemAudioUrl);
this.muxer = new VideoMuxer(this.config, hasAudio);
```

### 6. Audio Chunk Synchronization
**File:** `src/lib/exporter/videoExporter.ts` (export loop)
**Changes Required:**
- Process audio in parallel with video frames
- Calculate audio sample timestamps matching video frame timestamps
- Handle trim regions for audio (same as video)
- Encode and mux audio chunks with proper timing

**Critical:** Audio samples must align with video frames for A/V sync

### 7. Caller Updates
**File:** `src/components/video-editor/VideoEditor.tsx` (lines 770-796)
**Changes Required:**
```typescript
const exporter = new VideoExporter({
  videoUrl: videoPath,
  // ... existing fields ...
  cameraVideoUrl: cameraVideoPathRef.current || undefined,
  cameraPipConfig,
  // ADD:
  micAudioUrl: micAudioPath || undefined,
  systemAudioUrl: systemAudioPath || undefined,
});
```

**Also Update:** GifExporter instantiation (line 641) - same pattern

---

## Fix Recommendations

### Immediate Fix (Simple but Limited)

**Approach:** Mix mic and system audio into single track during export

**Steps:**
1. Add `micAudioUrl` and `systemAudioUrl` to ExportConfig
2. Create AudioDecoder to load and decode WebM audio files
3. Use Web Audio API to mix mic + system audio into single stream
4. Initialize AudioEncoder with AAC codec
5. Pass audio chunks to muxer alongside video chunks
6. Update muxer initialization to `hasAudio = true` when audio present

**Pros:**
- Simplest implementation
- Handles most common use case (both audio sources mixed)

**Cons:**
- No independent volume control for mic vs system audio in exported file
- User can't post-process audio tracks separately

---

### Comprehensive Fix (Recommended)

**Approach:** Multi-track audio export with separate mic and system audio tracks

**Steps:**
1. Create two audio encoders (mic + system)
2. Decode both audio files separately
3. Mux both audio tracks into MP4 container (MP4 supports multi-track)
4. Add volume/mute controls to export settings panel
5. Apply volume adjustments during encoding

**Pros:**
- Professional multi-track output
- Users can adjust mic/system audio balance in export settings
- Matches timeline multi-track display (Phase 06 work)
- Future-proof for advanced audio features (EQ, compression, noise reduction)

**Cons:**
- More complex implementation
- Requires muxer updates to handle multiple audio tracks

**Implementation:**
```typescript
// Muxer updates
if (this.config.micAudioUrl) {
  this.micAudioSource = new EncodedAudioPacketSource('aac');
  this.output.addAudioTrack(this.micAudioSource, { label: 'Microphone' });
}

if (this.config.systemAudioUrl) {
  this.systemAudioSource = new EncodedAudioPacketSource('aac');
  this.output.addAudioTrack(this.systemAudioSource, { label: 'System Audio' });
}
```

---

## Audio Synchronization Considerations

### Trim Region Handling
- Video frames use `mapEffectiveToSourceTime()` to skip trimmed segments (line 58-77)
- Audio MUST use same logic to maintain sync
- Calculate audio sample offsets matching video frame timestamps

### Frame Rate vs Sample Rate
- Video: 60 fps (16.67ms per frame)
- Audio: 48 kHz typical (0.021ms per sample)
- Audio chunks must be calculated at frame boundaries for proper muxing

### Duration Calculation
- Use effective duration (line 50-56) accounting for trim regions
- Ensure audio duration matches video duration exactly
- Handle cases where audio files may be shorter than video (recording stopped early)

---

## Security Considerations

### File Path Validation
- Audio paths already validated by IPC handlers (lines 338-367)
- Reuse same validation pattern in exporter
- Ensure paths stay within RECORDINGS_DIR

### Resource Cleanup
- Audio decoders must be destroyed after export
- Close AudioContext to release system resources
- Similar pattern to video decoder cleanup (line 363-368)

---

## Testing Strategy

### Unit Tests Needed
1. AudioDecoder module: Load WebM, decode to PCM samples
2. Audio encoder configuration: AAC codec support
3. Muxer multi-track: Verify both audio tracks added
4. Volume control: Test 0-100% volume scaling
5. Mute handling: Verify muted tracks excluded from export

### Integration Tests Needed
1. Export with mic only
2. Export with system audio only
3. Export with both mic + system audio
4. Export with trim regions (verify audio sync)
5. Export with zoom regions (verify no audio desync)

### Manual Testing Checklist
- [ ] Record with mic only → Export → Verify mic audio present
- [ ] Record with system audio only → Export → Verify system audio present
- [ ] Record with both → Export → Verify both audible
- [ ] Record 60s, trim middle 20s → Export → Verify audio matches trimmed video
- [ ] Play exported file in QuickTime/VLC → Verify A/V sync perfect
- [ ] Check MP4 metadata → Verify audio tracks listed correctly

---

## Performance Impact

### Export Time
- Audio encoding adds ~5-10% overhead (AAC is fast)
- Parallel video+audio encoding minimizes impact
- Muxing overhead negligible (mediabunny handles efficiently)

### Memory Usage
- Audio buffers ~10MB per minute (48 kHz stereo PCM)
- Two audio tracks = ~20MB per minute max
- Acceptable for typical recordings (5-10 minutes)

### Optimization Opportunities
- Stream audio decoding (don't load entire file into memory)
- Use Web Workers for audio encoding (parallel with video)
- Reuse AudioContext across exports (singleton pattern)

---

## Dependencies

### External Packages
- ✅ `mediabunny` - Already supports multi-track audio
- ✅ Web Audio API - Native browser support
- ✅ WebCodecs AudioEncoder - Native browser support (Chrome 94+)
- ✅ `mp4box.js` - Already used for muxing

**No new dependencies required** - all APIs already available

---

## Preventive Measures

### Code Review Checklist
- [ ] Verify export config includes all media paths (video, camera, mic, system audio)
- [ ] Check muxer `hasAudio` flag calculated from config, not hardcoded
- [ ] Ensure audio decoders match video decoder lifecycle (init → use → destroy)
- [ ] Validate audio chunks have correct timestamps for A/V sync

### Documentation Updates
- Update export architecture docs with audio pipeline flowchart
- Document multi-track export capabilities
- Add troubleshooting guide for A/V sync issues

### Monitoring
- Add telemetry: Export success rate, audio track presence, A/V sync errors
- Log warnings if audio files exist but export config missing audio paths
- Track export duration by media type (video-only vs video+audio)

---

## Unresolved Questions

1. **Codec Selection:** Should we use AAC or Opus for audio encoding?
   - AAC: Better compatibility (all players support)
   - Opus: Better quality at lower bitrates
   - **Recommendation:** AAC for MP4 exports (industry standard)

2. **Volume Control UI:** Where to add mic/system audio volume sliders?
   - Option A: Export settings dialog (simple, export-time only)
   - Option B: Timeline track headers (preview + export)
   - **Recommendation:** Option B for consistency with Phase 06 timeline work

3. **Default Behavior:** If user mutes mic track in timeline, should export exclude it?
   - Current: Timeline mute is preview-only, export uses original files
   - **Recommendation:** Respect timeline mute state in export (user expectation)

4. **Backward Compatibility:** Old recordings (before Phase 03) have no audio files
   - Handle gracefully: Export succeeds with video-only if audio paths null
   - No breaking changes needed

5. **GIF Export:** Should GIF export preserve audio?
   - GIF format doesn't support audio
   - **Recommendation:** Ignore audio for GIF exports (document this limitation)

---

## Next Steps

1. **Immediate:** Create implementation plan in `./plans/260116-audio-export-fix/`
2. **Research:** Test AudioDecoder with actual recorded WebM files
3. **Prototype:** Simple single-track audio export (mic + system mixed)
4. **Testing:** Verify A/V sync across different trim/zoom scenarios
5. **Enhancement:** Multi-track export with volume controls (Phase 2)

---

## References

- Recording pipeline: `src/hooks/useScreenRecorder.ts` lines 209-332
- IPC handlers: `electron/ipc/handlers.ts` lines 338-467
- Export pipeline: `src/lib/exporter/videoExporter.ts`
- Muxer: `src/lib/exporter/muxer.ts`
- Timeline integration: `src/components/video-editor/VideoEditor.tsx` lines 45-124
- MediaBunny docs: https://mediabunny.dev/docs/api/output
- WebCodecs AudioEncoder: https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder

---

**Report Status:** Complete
**Next Agent:** `planner` (create implementation plan)
**Priority:** High (blocks core export functionality)
