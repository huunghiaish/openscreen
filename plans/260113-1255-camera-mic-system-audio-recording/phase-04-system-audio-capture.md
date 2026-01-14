# Phase 04: System Audio Capture

## Context Links

- [Electron Media Capture Report](reports/researcher-01-electron-media-capture.md) - ScreenCaptureKit details
- [Phase 01](phase-01-media-device-infrastructure.md) - Platform detection utility
- useScreenRecorder: `/Users/nghia/Projects/openscreen/src/hooks/useScreenRecorder.ts`

## Overview

| Property | Value |
|----------|-------|
| Priority | P1 - Key differentiator |
| Status | ✓ COMPLETE (2026-01-14) |
| Effort | 4h (4h complete) |
| Description | Capture desktop/system audio on macOS 13.2+ via ScreenCaptureKit, with graceful fallback for older versions |

## Key Insights

- macOS 13.2+ (Ventura): ScreenCaptureKit enables system audio capture
- System audio comes bundled with `desktopCapturer` screen stream when audio: true
- Pre-13.2 macOS: No native solution, can offer Soundflower workaround or skip
- System audio requires separate handling from screen video track
- Store as separate audio file for independent volume control in editor

## Requirements

### Functional
- Detect macOS version (13.2+ required)
- Capture system audio via desktopCapturer with audio flag
- Extract audio track from screen capture stream
- Toggle system audio capture on/off
- Store system audio as separate file
- Graceful fallback: show unavailable message on old macOS

### Non-Functional
- Audio quality: Opus 128kbps minimum
- Low latency (<50ms)
- Minimal CPU overhead

## Architecture

```
macOS 13.2+ Flow:
  desktopCapturer.getSources({ types: ['screen'] })
              ↓
  getUserMedia({
    video: { chromeMediaSource: 'desktop' },
    audio: { chromeMediaSource: 'desktop' }  ← KEY
  })
              ↓
    MediaStream (video + audio tracks)
              ↓
    ┌─────────┴─────────┐
    │                   │
  Video Track        Audio Track
    │                   │
  Screen Recorder   System Audio Recorder
    │                   │
  screen.webm       system-audio.webm
```

## Related Code Files

| File | Action | Purpose |
|------|--------|---------|
| `/Users/nghia/Projects/openscreen/src/hooks/use-system-audio-capture.ts` | CREATE | System audio capture hook |
| `/Users/nghia/Projects/openscreen/src/lib/platform-utils.ts` | MODIFY | Add detailed version check |
| `/Users/nghia/Projects/openscreen/src/hooks/useScreenRecorder.ts` | MODIFY | Integrate system audio |
| `/Users/nghia/Projects/openscreen/src/types/media-devices.ts` | MODIFY | Add system audio types |

## Implementation Steps

### 1. Enhance Platform Utils (30 min)

Modify `/Users/nghia/Projects/openscreen/src/lib/platform-utils.ts`:

```typescript
export interface MacOSVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export async function getMacOSVersion(): Promise<MacOSVersion | null> {
  const platform = await window.electronAPI?.getPlatform();
  if (platform !== 'darwin') return null;

  // Parse from user agent (works in Electron)
  const match = navigator.userAgent.match(/Mac OS X (\d+)[._](\d+)(?:[._](\d+))?/);
  if (match) {
    return {
      major: parseInt(match[1]),
      minor: parseInt(match[2]),
      patch: parseInt(match[3] || '0'),
      raw: match[0],
    };
  }
  return null;
}

export async function supportsSystemAudio(): Promise<boolean> {
  const version = await getMacOSVersion();
  if (!version) return false;

  // macOS 13.2+ (Ventura) required for ScreenCaptureKit system audio
  if (version.major > 13) return true;
  if (version.major === 13 && version.minor >= 2) return true;
  return false;
}

export async function getSystemAudioSupportMessage(): Promise<string | null> {
  const version = await getMacOSVersion();
  if (!version) {
    return 'System audio capture is only available on macOS.';
  }
  if (version.major < 13 || (version.major === 13 && version.minor < 2)) {
    return `System audio requires macOS 13.2+. You have ${version.major}.${version.minor}.`;
  }
  return null;
}
```

### 2. Add System Audio Types (15 min)

Add to `/Users/nghia/Projects/openscreen/src/types/media-devices.ts`:

```typescript
export interface SystemAudioState {
  supported: boolean;
  enabled: boolean;
  unsupportedMessage: string | null;
}
```

### 3. Create useSystemAudioCapture Hook (90 min)

Create `/Users/nghia/Projects/openscreen/src/hooks/use-system-audio-capture.ts`:

```typescript
import { useState, useRef, useCallback, useEffect } from 'react';
import { supportsSystemAudio, getSystemAudioSupportMessage } from '@/lib/platform-utils';

interface UseSystemAudioCaptureReturn {
  supported: boolean;
  unsupportedMessage: string | null;
  stream: MediaStream | null;
  recording: boolean;
  audioLevel: number;
  startCapture: (screenSourceId: string) => Promise<boolean>;
  stopCapture: () => void;
  startRecording: () => void;
  stopRecording: () => Promise<Blob | null>;
  error: string | null;
}

export function useSystemAudioCapture(): UseSystemAudioCaptureReturn {
  const [supported, setSupported] = useState(false);
  const [unsupportedMessage, setUnsupportedMessage] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const chunks = useRef<Blob[]>([]);
  const animationFrame = useRef<number | null>(null);
  const recordingPromise = useRef<{
    resolve: (blob: Blob | null) => void;
  } | null>(null);

  // Check support on mount
  useEffect(() => {
    async function checkSupport() {
      const isSupported = await supportsSystemAudio();
      setSupported(isSupported);
      if (!isSupported) {
        const message = await getSystemAudioSupportMessage();
        setUnsupportedMessage(message);
      }
    }
    checkSupport();
  }, []);

  const updateAudioLevel = useCallback(() => {
    if (!analyser.current) return;

    const dataArray = new Uint8Array(analyser.current.fftSize);
    analyser.current.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const level = Math.min(100, Math.round(rms * 300));

    setAudioLevel(level);
    animationFrame.current = requestAnimationFrame(updateAudioLevel);
  }, []);

  const startCapture = useCallback(async (screenSourceId: string): Promise<boolean> => {
    if (!supported) {
      setError(unsupportedMessage || 'System audio not supported');
      return false;
    }

    try {
      setError(null);

      // Request screen capture WITH audio
      const mediaStream = await (navigator.mediaDevices as any).getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: screenSourceId,
          },
        },
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: screenSourceId,
            maxWidth: 1,
            maxHeight: 1,
          },
        },
      });

      // Extract audio track only
      const audioTracks = mediaStream.getAudioTracks();
      if (audioTracks.length === 0) {
        // Stop video track we don't need
        mediaStream.getVideoTracks().forEach(t => t.stop());
        setError('No system audio track available. Check System Preferences > Privacy > Screen Recording.');
        return false;
      }

      // Create audio-only stream
      const audioOnlyStream = new MediaStream(audioTracks);

      // Stop the dummy video track
      mediaStream.getVideoTracks().forEach(t => t.stop());

      setStream(audioOnlyStream);

      // Setup level metering
      audioContext.current = new AudioContext();
      const source = audioContext.current.createMediaStreamSource(audioOnlyStream);
      analyser.current = audioContext.current.createAnalyser();
      analyser.current.fftSize = 256;
      source.connect(analyser.current);

      updateAudioLevel();
      return true;
    } catch (err) {
      console.error('System audio capture failed:', err);
      setError(err instanceof Error ? err.message : 'System audio capture failed');
      return false;
    }
  }, [supported, unsupportedMessage, updateAudioLevel]);

  const stopCapture = useCallback(() => {
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }

    if (audioContext.current) {
      audioContext.current.close();
      audioContext.current = null;
      analyser.current = null;
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }

    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
    }

    setRecording(false);
    setAudioLevel(0);
  }, [stream]);

  const startRecording = useCallback(() => {
    if (!stream) return;

    chunks.current = [];

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const recorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 192_000, // 192 kbps for system audio
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks.current, { type: mimeType });
      chunks.current = [];
      if (recordingPromise.current) {
        recordingPromise.current.resolve(blob);
        recordingPromise.current = null;
      }
      setRecording(false);
    };

    mediaRecorder.current = recorder;
    recorder.start(1000);
    setRecording(true);
  }, [stream]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorder.current || mediaRecorder.current.state !== 'recording') {
        resolve(null);
        return;
      }
      recordingPromise.current = { resolve };
      mediaRecorder.current.stop();
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
      if (audioContext.current) {
        audioContext.current.close();
      }
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  return {
    supported,
    unsupportedMessage,
    stream,
    recording,
    audioLevel,
    startCapture,
    stopCapture,
    startRecording,
    stopRecording,
    error,
  };
}
```

### 4. Integrate into useScreenRecorder (60 min)

Modify `/Users/nghia/Projects/openscreen/src/hooks/useScreenRecorder.ts`:

Key changes:
- Accept `systemAudioEnabled` parameter
- If enabled and supported, request screen capture with audio flag
- Extract and record system audio track separately
- Store as `system-audio-{timestamp}.webm`

### 5. Add Fallback UI Message Component (30 min)

Create component to show when system audio unavailable:

```typescript
// In LaunchWindow or separate component
{!systemAudioSupported && (
  <div className="text-xs text-amber-400">
    {systemAudioMessage}
  </div>
)}
```

## Todo List

- [x] Enhance `src/lib/platform-utils.ts` with detailed version check
- [x] Add system audio types to `src/types/media-devices.ts`
- [x] Create `src/hooks/use-system-audio-capture.ts` hook
- [x] Integrate into `useScreenRecorder.ts`
- [x] Add fallback UI message for unsupported macOS
- [x] Extract shared audio capture utilities
- [x] Add IPC handler for system audio recording storage
- [x] Add preload type definitions
- [x] Test on macOS 13.2+ (passing)
- [x] Test system audio level meter
- [x] Verify Opus encoding quality
- [x] Test cleanup on recording stop

## Success Criteria

- [x] System audio captured on macOS 13.2+
- [x] Clear message shown on unsupported macOS versions
- [x] Audio stored as separate `.webm` file
- [x] Level meter shows system audio activity
- [x] No impact on screen recording quality
- [x] Resources properly cleaned up
- [x] All tests passing (35/35)
- [x] Build successful
- [x] Code review completed (9/10)

## Code Review Notes (2026-01-14)

**Review:** [Code Review Report](../reports/code-reviewer-260114-1453-phase04-system-audio.md)
**Score:** 9/10
**Build:** ✅ Success | **Tests:** 35/35 ✅ | **Security:** 10/10 ✅

**Status:** All critical issues resolved

**Completed Fixes:**
1. ✓ Extracted shared audio capture utilities to `src/lib/audio-capture-utils.ts`
2. ✓ AudioContext error handling implemented with proper cleanup
3. ✓ MediaRecorder promises protected with timeout handling
4. ✓ Fallback UI message component implemented
5. ✓ Visual system audio level meter integrated
6. ✓ IPC handler added for system audio storage (`electron/ipc/handlers.ts`)

**Remaining Technical Debt (Phase 06+):**
- useScreenRecorder.ts optimization (modularization pending in future phase)

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| ScreenCaptureKit fails silently | Medium | High | Check for empty audio tracks |
| Privacy permission denied | Medium | High | Clear error message, link to System Preferences |
| Audio sync drift | Low | Medium | Use same MediaRecorder timing |
| High CPU on older Macs | Low | Medium | Test on Intel Macs |

## Security Considerations

- System audio capture requires Screen Recording permission
- User must explicitly enable system audio toggle
- Clear indication when system audio is being captured

## Next Steps

After this phase, proceed to [Phase 05: HUD UI Device Selectors](phase-05-hud-ui-device-selectors.md)
