# Phase 03: Microphone Recording

## Context Links

- [Electron Media Capture Report](reports/researcher-01-electron-media-capture.md) - Audio capture patterns
- [Phase 01](phase-01-media-device-infrastructure.md) - Device enumeration
- [Phase 02](phase-02-camera-recording-capture.md) - Similar capture pattern
- useScreenRecorder: `/Users/nghia/Projects/openscreen/src/hooks/useScreenRecorder.ts`

## Overview

| Property | Value |
|----------|-------|
| Priority | P1 - Core feature |
| Status | complete |
| Effort | 4h |
| Completed | 2026-01-14 |
| Description | Capture microphone audio during recording with device selection and audio level indicator |

## Key Insights

- `getUserMedia({ audio: true })` works for microphone on macOS
- Use Web Audio API (AnalyserNode) for real-time level metering
- Record mic to separate audio track (not mixed into screen recording)
- Separate tracks enable independent volume control in editor
- Store as WebM (Opus codec) for quality + small file size

## Requirements

### Functional
- Capture microphone audio via getUserMedia
- Device selection dropdown (from Phase 01 hook)
- Real-time audio level indicator (VU meter style)
- Toggle mic on/off during pre-recording setup
- Store microphone audio as separate file
- Mute indicator when mic is off

### Non-Functional
- Audio level updates at 60fps (smooth animation)
- Low latency capture (<10ms)
- Opus codec for efficient encoding

## Architecture

```
Microphone Flow:
  getUserMedia({ audio: deviceId })
          ↓
    MediaStream
          ↓
  ┌───────┴───────┐
  │               │
AudioContext    MediaRecorder
  │               │
AnalyserNode    mic-{ts}.webm
  │
Level Meter UI
```

## Related Code Files

| File | Action | Purpose |
|------|--------|---------|
| `/Users/nghia/Projects/openscreen/src/hooks/use-microphone-capture.ts` | CREATE | Mic capture hook with level meter |
| `/Users/nghia/Projects/openscreen/src/components/audio-level-meter.tsx` | CREATE | VU meter component |
| `/Users/nghia/Projects/openscreen/src/hooks/useScreenRecorder.ts` | MODIFY | Integrate mic capture |
| `/Users/nghia/Projects/openscreen/electron/ipc/handlers.ts` | MODIFY | Store audio recording handler |
| `/Users/nghia/Projects/openscreen/electron/preload.ts` | MODIFY | Expose audio storage IPC |

## Implementation Steps

### 1. Create useMicrophoneCapture Hook (90 min)

Create `/Users/nghia/Projects/openscreen/src/hooks/use-microphone-capture.ts`:

```typescript
import { useState, useRef, useCallback, useEffect } from 'react';

interface UseMicrophoneCaptureReturn {
  stream: MediaStream | null;
  recording: boolean;
  audioLevel: number; // 0-100
  startCapture: (deviceId: string) => Promise<void>;
  stopCapture: () => void;
  startRecording: () => void;
  stopRecording: () => Promise<Blob | null>;
  error: string | null;
}

export function useMicrophoneCapture(): UseMicrophoneCaptureReturn {
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

  const updateAudioLevel = useCallback(() => {
    if (!analyser.current) return;

    const dataArray = new Uint8Array(analyser.current.fftSize);
    analyser.current.getByteTimeDomainData(dataArray);

    // Calculate RMS level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const level = Math.min(100, Math.round(rms * 300)); // Scale to 0-100

    setAudioLevel(level);
    animationFrame.current = requestAnimationFrame(updateAudioLevel);
  }, []);

  const startCapture = useCallback(async (deviceId: string) => {
    try {
      setError(null);

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      setStream(mediaStream);

      // Setup audio level metering
      audioContext.current = new AudioContext();
      const source = audioContext.current.createMediaStreamSource(mediaStream);
      analyser.current = audioContext.current.createAnalyser();
      analyser.current.fftSize = 256;
      source.connect(analyser.current);

      // Start level metering
      updateAudioLevel();
    } catch (err) {
      console.error('Microphone capture failed:', err);
      setError(err instanceof Error ? err.message : 'Microphone capture failed');
    }
  }, [updateAudioLevel]);

  const stopCapture = useCallback(() => {
    // Stop level metering
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }

    // Close audio context
    if (audioContext.current) {
      audioContext.current.close();
      audioContext.current = null;
      analyser.current = null;
    }

    // Stop stream
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }

    // Stop recorder
    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
    }

    setRecording(false);
    setAudioLevel(0);
  }, [stream]);

  const startRecording = useCallback(() => {
    if (!stream) return;

    chunks.current = [];

    // Use Opus codec for efficient audio encoding
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const recorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 128_000, // 128 kbps
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

### 2. Create AudioLevelMeter Component (45 min)

Create `/Users/nghia/Projects/openscreen/src/components/audio-level-meter.tsx`:

```typescript
interface AudioLevelMeterProps {
  level: number; // 0-100
  muted?: boolean;
  size?: 'small' | 'medium';
}

export function AudioLevelMeter({
  level,
  muted = false,
  size = 'small',
}: AudioLevelMeterProps) {
  const height = size === 'small' ? 16 : 24;
  const barCount = size === 'small' ? 8 : 12;

  // Calculate how many bars should be active
  const activeBars = Math.round((level / 100) * barCount);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 2,
        height,
        opacity: muted ? 0.3 : 1,
      }}
    >
      {Array.from({ length: barCount }, (_, i) => {
        const isActive = i < activeBars;
        const isHigh = i >= barCount * 0.8; // Top 20% = red zone

        let color = 'rgba(255,255,255,0.2)';
        if (isActive) {
          color = isHigh ? '#ef4444' : '#22c55e';
        }

        return (
          <div
            key={i}
            style={{
              width: 4,
              height: `${30 + (i / barCount) * 70}%`,
              backgroundColor: color,
              borderRadius: 1,
              transition: 'background-color 50ms',
            }}
          />
        );
      })}
    </div>
  );
}
```

### 3. Add IPC Handler for Audio Recording Storage (20 min)

Modify `/Users/nghia/Projects/openscreen/electron/ipc/handlers.ts`:

```typescript
ipcMain.handle('store-audio-recording', async (_, audioData: ArrayBuffer, fileName: string) => {
  try {
    const audioPath = path.join(RECORDINGS_DIR, fileName);
    await fs.writeFile(audioPath, Buffer.from(audioData));
    return { success: true, path: audioPath };
  } catch (error) {
    console.error('Failed to store audio recording:', error);
    return { success: false, error: String(error) };
  }
});
```

### 4. Expose Handler in Preload (10 min)

Modify `/Users/nghia/Projects/openscreen/electron/preload.ts`:

```typescript
storeAudioRecording: (audioData: ArrayBuffer, fileName: string) => {
  return ipcRenderer.invoke('store-audio-recording', audioData, fileName);
},
```

### 5. Integrate into useScreenRecorder (60 min)

Modify `/Users/nghia/Projects/openscreen/src/hooks/useScreenRecorder.ts`:

Key changes:
- Accept `micDeviceId` parameter
- Start mic capture if deviceId provided
- Store mic audio as separate file
- Pass mic audio path to editor

## Todo List

- [x] Create `src/hooks/use-microphone-capture.ts` hook
- [x] Create `src/components/audio-level-meter.tsx` component
- [x] Add `store-audio-recording` IPC handler
- [x] Expose handler in preload
- [x] Modify `useScreenRecorder.ts` to integrate mic capture
- [x] Test audio level meter responsiveness
- [x] Test mic recording quality
- [x] Test echo cancellation / noise suppression
- [x] Verify Opus codec encoding
- [x] Test cleanup on recording stop

## Success Criteria

- [x] Microphone audio captured with selected device
- [x] Audio level meter shows real-time levels (0-100)
- [x] Red zone indicator for high levels
- [x] Muted state clearly visible
- [x] Audio stored as separate `.webm` file with Opus codec
- [x] No audio crackling or dropouts
- [x] Echo cancellation works correctly
- [x] Resources properly cleaned up on stop

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Mic permission denied | Medium | High | Clear UI prompt, fallback |
| Audio crackling/dropouts | Low | Medium | Test buffer sizes, use Opus |
| Echo from speakers | Medium | Medium | Enable echoCancellation |
| High CPU from level meter | Low | Low | Use requestAnimationFrame |

## Security Considerations

- Microphone access requires explicit user consent
- Stop audio tracks immediately when recording ends
- Do not record audio when user expects muted state

## Code Review Status

**Cycle 2 Review:** [code-reviewer-260114-1245-phase03-mic-recording-cycle2.md](reports/code-reviewer-260114-1245-phase03-mic-recording-cycle2.md)
**Score:** 8.5/10
**Status:** ✅ Approved for Phase 04

**Fixes Applied:**
- ✅ C1: Path traversal vulnerability fixed with `safeWriteRecording()` helper
- ✅ C2: File size limits enforced (5GB video, 500MB camera, 100MB audio)
- ✅ Modularization: Created `recording-constants.ts` (~80 LOC) and `media-recorder-utils.ts` (~145 LOC)
- ✅ useScreenRecorder reduced from 446 to 385 lines

**Outstanding (Non-blocking):**
- M1: Audio handler extension validation needs alignment with regex
- M2: Filename regex should enforce timestamp format
- M3: Review unused exports in recording-constants.ts

## Next Steps

After this phase, proceed to [Phase 04: System Audio Capture](phase-04-system-audio-capture.md)
