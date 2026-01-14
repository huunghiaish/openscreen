# Electron Media Capture Research: Camera, Microphone & System Audio on macOS

## Executive Summary
Recording multiple simultaneous media streams in Electron on macOS requires combining three APIs: `getUserMedia` (camera/mic), `desktopCapturer` (screen), and platform-specific workarounds for system audio. Recent developments enable system audio capture on macOS 13.2+ via ScreenCaptureKit with experimental flags.

---

## 1. Camera Capture (getUserMedia)

**Status:** Fully supported on macOS

**Key Implementation:**
```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false // Audio via getUserMedia fails on macOS
});
```

**macOS-Specific Considerations:**
- Requires explicit user permission (one-time, then persistent)
- Recent fix (July 2024): Properly rejects with `NotAllowedError` when camera permission denied
- Permission check needed before requesting access to avoid hangs on M1/Ventura
- Signed app required for production builds

---

## 2. Microphone Capture (getUserMedia Audio)

**Status:** Supported via Web Audio API, NOT via getUserMedia on macOS

**Why `getUserMedia({ audio: true })` fails on macOS:**
- Apps accessing system audio require signed kernel extension (Chromium/Electron lack this)
- Chromium/Webkit cannot capture audio on macOS without native integration

**Working Alternative:**
```javascript
const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
const audioContext = new AudioContext();
const micTrack = micStream.getAudioTracks()[0];
// Use WebRTC or pipe to MediaRecorder
```

**Note:** This works for microphone input, but not for system audio playback.

---

## 3. System Audio Recording (Loopback Audio)

**Status:** Now possible via ScreenCaptureKit on macOS 13.2-15.5

**Electron's Solution (2024-2025):**
- Electron now uses `ScreenCaptureKit` API to enable system audio capture
- Requires macOS 13.2+ (ScreenCaptureKit deemed too buggy before 13.2)
- Requires internal Chromium flags for older systems:
  - `MacLoopbackAudioForScreenShare`
  - `MacSckSystemAudioLoopbackOverride`

**Implementation via desktopCapturer:**
```javascript
const sources = await desktopCapturer.getSources({
  types: ['screen'],
  thumbnailSize: { width: 0, height: 0 }
});

// Get display source with audio
const displaySource = sources[0]; // main display
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: displaySource.id
    }
  },
  video: {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: displaySource.id
    }
  }
});
```

**Limitations:**
- Not available on macOS < 13.2
- System audio only from screen capture, not independent recording
- May require App Transport Security/privacy entitlements

**Alternative Workaround (Pre-13.2):**
- Use virtual audio device (Soundflower) as intermediary
- Route system audio → virtual device → capture via getUserMedia
- User must install third-party software (poor UX)

---

## 4. MediaRecorder API for Multi-Stream Recording

**Status:** Partial support for multi-stream via composition

**Limitations:**
- MediaRecorder accepts single MediaStream object
- Cannot natively mux multiple independent streams
- Must composite before recording

**Pattern for Multiple Streams:**
```javascript
// Combine streams via canvas (video) and AudioContext (audio)
const canvasStream = canvas.captureStream(30);
const audioContext = new AudioContext();
const destination = audioContext.createMediaStreamDestination();

// Connect all audio sources to destination
micStream.getTracks().forEach(track => {
  const source = audioContext.createMediaStreamSource(micStream);
  source.connect(destination);
});

systemAudioStream.getTracks().forEach(track => {
  const source = audioContext.createMediaStreamSource(systemAudioStream);
  source.connect(destination);
});

// Combine for MediaRecorder
const combinedStream = new MediaStream([
  ...canvasStream.getVideoTracks(),
  ...destination.stream.getAudioTracks()
]);

const recorder = new MediaRecorder(combinedStream, {
  mimeType: 'video/webm;codecs=vp8,opus'
});
```

**Multi-Stream Libraries:**
- **MediaStreamRecorder.js** - Cross-browser, supports WebM with multiple tracks
- **MultiStreamRecorder** - Specialized for recording multiple video/audio streams simultaneously

---

## 5. Recommended Architecture for OpenScreen

**Three-Phase Approach:**

### Phase 1: Screen + Camera
```
Screen (desktopCapturer) → Canvas Composite
                        ↓
Camera (getUserMedia)  → Canvas Layer 2
                        ↓
                   MediaRecorder
```

### Phase 2: Add Microphone
- Capture via `getUserMedia({ audio: true })`
- Pipe to AudioContext → MediaRecorder audio tracks

### Phase 3: Add System Audio
- macOS 13.2+: Use desktopCapturer with audio flag
- macOS < 13.2: Offer virtual audio device workaround or skip

**Implementation Stack:**
- `getUserMedia` for camera/mic
- `desktopCapturer` for screen + system audio (when available)
- `Canvas API` for video composition
- `AudioContext` for audio mixing
- `MediaRecorder` for final encoding (WebM/MP4)

---

## 6. macOS Version Strategy

| macOS Version | Camera | Mic | System Audio | Approach |
|---|---|---|---|---|
| < 13.2 | ✓ | ✓ | ✗ | Mic only, offer Soundflower workaround |
| 13.2-15.5 | ✓ | ✓ | ✓ | Full support via ScreenCaptureKit |
| ≥ 15.5 | ✓ | ✓ | ⚠️ | Verify ScreenCaptureKit stability |

---

## 7. Code Dependencies

**Minimal Approach (No external libs):**
- Built-in APIs: `getUserMedia`, `AudioContext`, `Canvas`, `MediaRecorder`, `desktopCapturer`

**For Complex Muxing:**
- `mediacodec` / `mediabunny` (already in OpenScreen)
- `mp4box.js` (already in OpenScreen)
- `gif.js` (already in OpenScreen)

**Optional Enhancements:**
- `RecordKit.Electron` (@nonstrict/recordkit) - macOS native, higher quality
- `electron-recorder` npm package - simpler multi-stream handling

---

## 8. Unresolved Questions

1. **Permission Persistence:** Does Electron cache camera/mic permissions? Test needed.
2. **ScreenCaptureKit on macOS 15+:** Any breaking changes in latest macOS versions?
3. **Audio Sync:** How to maintain A/V sync when compositing multiple audio sources?
4. **Performance:** Canvas composition overhead at 1080p60 with multiple video streams?
5. **MP4 Muxing:** Current setup (mp4box.js) supports multi-audio tracks out-of-box?

---

## Sources

- [Electron desktopCapturer API Documentation](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [getUserMedia macOS Fix PR #42899](https://github.com/electron/electron/pull/42899)
- [ScreenCaptureKit System Audio Support Issue #47490](https://github.com/electron/electron/issues/47490)
- [RecordKit.Electron GitHub](https://github.com/nonstrict-hq/RecordKit.Electron)
- [MediaRecorder API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [Using MediaStream Recording API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream_Recording_API/Using_the_MediaStream_Recording_API)
- [Desktop Audio Recording on macOS - Strongly Typed](https://stronglytyped.uk/articles/recording-system-audio-electron-macos-approaches)
- [Janus - Electron Multi-Stream Recording](https://github.com/elliotaplant/janus)
- [electron-recorder npm](https://www.npmjs.com/package/electron-recorder)
- [System Audio with Soundflower Workaround](https://doumer.me/record-system-sound-on-macos-with-javascript-and-soundflower/)
