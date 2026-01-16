# Video Demuxing Research Report
Date: 2026-01-16 | Focus: WebM and MP4 demuxing for WebCodecs integration

## Executive Summary
Current OpenScreen uses HTMLVideoElement + canvas rendering for playback. To enable true frame-level control, WebCodecs VideoDecoder requires demuxed EncodedVideoChunk data with proper codec config and timestamps. MP4Box.js covers MP4; WebM needs EBML parser library.

---

## 1. MP4 Demuxing (mp4box.js)

**Status:** Already in project via mediabunny.

### Key Implementation Details
```typescript
// mp4box.js extracts samples with critical properties:
interface Sample {
  cts: number;           // Composition time stamp (presentation time)
  dts: number;           // Decode time stamp
  duration: number;      // Frame duration in timescale units
  timescale: number;     // Timescale (e.g., 90000 Hz for video)
  is_sync: boolean;      // Keyframe indicator
  data: Uint8Array;      // Raw video data
}

// Convert to EncodedVideoChunk (timestamps in microseconds)
const timestamp = (sample.cts * 1_000_000) / sample.timescale;
const duration = (sample.duration * 1_000_000) / sample.timescale;

const chunk = new EncodedVideoChunk({
  type: sample.is_sync ? 'key' : 'delta',
  timestamp,
  duration,
  data: sample.data,
});
```

### Codec Configuration Extraction
```typescript
// From mp4box.js track info:
// H.264 (AVC): Extract from avcC box
const avcConfig = track.mdia.minf.stbl.stsd.entries[0].avcC;
const sps = avcConfig.sps[0];  // Sequence Parameter Set
const pps = avcConfig.pps[0];  // Picture Parameter Set
const description = new Uint8Array([...sps, ...pps]);

// VP9: Extract from vpcC box (if present in MP4)
const vpcConfig = track.mdia.minf.stbl.stsd.entries[0].vpcC;
```

---

## 2. WebM Demuxing Libraries

### Recommended: mkvdemuxjs
- **Pros:** Minimal, focused on MediaRecorder output, pure JS
- **Cons:** No longer maintained, lacks advanced features
- **Best for:** Simple recordings, known good state

### Alternative: ebml-web-stream
- **Pros:** Modern, ArrayBuffer-based, web + Node.js support, active
- **Cons:** Lower-level, requires manual sample extraction
- **Best for:** New projects, streaming scenarios

### Code Example (ebml-web-stream)
```typescript
import { EBML } from 'ebml-web-stream';

const ebml = new EBML();
const elements = await ebml.parseBuffer(webmData);

// Find VideoTrack and CodecPrivate (contains codec config)
const vtrack = elements.find(e => e.type === 'TrackVideo');
const codecPrivate = vtrack.CodecPrivate; // VP8/VP9 config

// Sample extraction requires traversing Cluster > SimpleBlock elements
// Each SimpleBlock contains: track number, timestamp, keyframe flag, data
```

---

## 3. Codec Configuration Extraction

### H.264 (AVC)
- **MP4:** avcC box contains SPS (Sequence Parameter Set) + PPS
- **WebM:** CodecPrivate = empty or codec-specific data
- **For WebCodecs:** `description` = concatenated [SPS, PPS]

### VP8/VP9
- **MP4:** vpcC box (VP9 Profile, Level, BitDepth)
- **WebM:** CodecPrivate has 4-byte header (frame tag for VP8, IVF for VP9)
- **For WebCodecs:** Use CodecPrivate as description

### Pseudo-code for codec string generation
```typescript
function buildCodecString(codec: string, config: any): string {
  if (codec.startsWith('avc')) {
    return `avc1.${formatAvcProfile(config.profile)}.${formatAvcLevel(config.level)}`;
  }
  if (codec === 'vp9') {
    return `vp09.${config.profile}.${config.level}.${config.bitDepth}`;
  }
  return codec;
}
```

---

## 4. B-Frames & Decode vs. Presentation Order

### Critical Insight
**WebCodecs VideoDecoder expects chunks in DECODE order, not presentation order.**

With B-frames:
- Decode order: [I, P, B, B, P, ...] (depends on future frames)
- Presentation order: [I, P, B, B, P, ...] (display time)

### Timestamp Mapping
- **Send to decoder:** chunks in decode order with `dts` (decode timestamp)
- **Decoder outputs:** VideoFrames in presentation order with `timestamp` (cts)
- **mp4box.js:** Provides both `dts` and `cts`; use `dts` for chunk ordering

### Implementation
```typescript
// Sort samples by dts (decode order), not cts
const sortedSamples = samples.sort((a, b) => a.dts - b.dts);

for (const sample of sortedSamples) {
  const chunk = new EncodedVideoChunk({
    type: sample.is_sync ? 'key' : 'delta',
    timestamp: (sample.dts * 1_000_000) / sample.timescale,
    duration: (sample.duration * 1_000_000) / sample.timescale,
    data: sample.data,
  });

  await videoDecoder.decode(chunk);
}
```

---

## 5. Variable Frame Rate (VFR) Handling

### Issue
Not all frames have equal duration. Timestamps must reflect actual frame times.

### Solution
mp4box.js provides per-sample `duration` field; use directly:
```typescript
let currentTime = 0;
for (const sample of samples) {
  const duration = (sample.duration * 1_000_000) / sample.timescale;
  const chunk = new EncodedVideoChunk({
    timestamp: currentTime,
    duration,
    // ...
  });
  currentTime += duration;
}
```

### For WebM
ebml-web-stream provides timestamp in Matroska timecode; must account for block groups' duration.

---

## 6. Current Project Gap

**VideoFileDecoder** currently:
- Hardcodes frameRate: 60
- Hardcodes codec: 'avc1.640033'
- Uses HTMLVideoElement (no direct demuxing)
- Doesn't extract codec description

**Required for WebCodecs:**
- Extract actual codec config from container
- Demux samples with correct timestamps
- Handle B-frame reordering (decode vs. presentation order)

---

## 7. Implementation Recommendation

### Phase 1: MP4 Support (Using mp4box.js)
1. Wrap mp4box.js with proper sample extraction
2. Extract codec description (SPS/PPS for H.264)
3. Handle decode order reordering
4. Create VideoDecoder configuration

### Phase 2: WebM Support
1. Add ebml-web-stream or mkvdemuxjs
2. Extract CodecPrivate
3. Implement sample clustering extraction
4. Validate against MediaRecorder WebM output

### Phase 3: Unified Interface
```typescript
interface Demuxer {
  getCodecString(): string;
  getDescription(): Uint8Array;
  getSamples(): AsyncGenerator<EncodedVideoChunk>;
}

class MP4Demuxer implements Demuxer { }
class WebMDemuxer implements Demuxer { }
```

---

## Unresolved Questions
1. Does OpenScreen currently record to WebM or MP4? (affects priority)
2. What's the scope: playback decoding only, or editing with frame extraction?
3. GPU decoding preference (WebCodecs can use hardware decoders)?
4. Audio track demuxing also needed, or video-only for now?

## Sources
- [MP4Box.js GitHub](https://github.com/gpac/mp4box.js)
- [WebCodecs API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- [mkvdemuxjs - GitHub](https://github.com/Yahweasel/mkvdemuxjs)
- [ebml-web-stream - GitHub](https://github.com/saghen/ebml-web-stream)
- [WebCodecs VideoDecoder - MDN](https://developer.mozilla.org/en-US/docs/Web/API/VideoDecoder)
- [Video processing with WebCodecs - Chrome Developers](https://developer.chrome.com/articles/webcodecs/)
