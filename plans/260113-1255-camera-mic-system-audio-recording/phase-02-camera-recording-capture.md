# Phase 02: Camera Recording & Capture

## Context Links

- [Electron Media Capture Report](reports/researcher-01-electron-media-capture.md) - getUserMedia patterns
- [Phase 01](phase-01-media-device-infrastructure.md) - Device enumeration (prerequisite)
- useScreenRecorder: `/Users/nghia/Projects/openscreen/src/hooks/useScreenRecorder.ts`
- LaunchWindow: `/Users/nghia/Projects/openscreen/src/components/launch/LaunchWindow.tsx`

## Overview

| Property | Value |
|----------|-------|
| Priority | P1 - Core feature |
| Status | DONE (2026-01-13 16:45) |
| Blockers | None - all critical issues resolved |
| Effort | 5h (actual: ~3.5h) |
| Description | Capture webcam video during screen recording, display resizable overlay preview in one of 4 corner positions |

## Key Insights

- `getUserMedia({ video: true })` works on macOS in Electron
- Camera stream independent of screen stream - captured separately
- Preview overlay = floating `<video>` element positioned absolutely
- Overlay position: 4 corners (top-left, top-right, bottom-left, bottom-right)
- For V1: Record camera to separate file, not composited into main video
- Canvas composition can be added later for single-file export

## Requirements

### Functional
- Capture camera video via getUserMedia
- Display live camera preview overlay during recording
- 4 corner positions: TL, TR, BL, BR (user selectable)
- Resizable overlay (3 sizes: small, medium, large)
- Rounded corners style
- Toggle camera on/off during recording
- Store camera recording as separate file

### Non-Functional
- Camera preview <16ms latency (60fps capable)
- Minimal CPU impact (<5% on M1)
- Clean track cleanup on stop

## Architecture

```
Recording Flow:
  1. Start screen recording (existing)
  2. If camera enabled:
     a. getUserMedia({ video: deviceId })
     b. Display <video> preview overlay
     c. MediaRecorder for camera stream
     d. Store camera-{timestamp}.webm
  3. On stop: stop both recorders

Preview Overlay:
  CameraPreviewOverlay component
    ├── <video> element (srcObject = stream)
    ├── position state (TL|TR|BL|BR)
    ├── size state (small|medium|large)
    └── Electron window: alwaysOnTop, transparent
```

## Related Code Files

| File | Action | Purpose |
|------|--------|---------|
| `/Users/nghia/Projects/openscreen/src/hooks/use-camera-capture.ts` | CREATE | Camera capture hook |
| `/Users/nghia/Projects/openscreen/src/components/camera-preview-overlay.tsx` | CREATE | Overlay component |
| `/Users/nghia/Projects/openscreen/src/hooks/useScreenRecorder.ts` | MODIFY | Integrate camera capture |
| `/Users/nghia/Projects/openscreen/electron/windows.ts` | MODIFY | Camera overlay window factory |
| `/Users/nghia/Projects/openscreen/electron/ipc/handlers.ts` | MODIFY | Store camera recording handler |
| `/Users/nghia/Projects/openscreen/src/types/media-devices.ts` | MODIFY | Add camera overlay types |

## Implementation Steps

### 1. Define Camera Overlay Types (15 min)

Add to `/Users/nghia/Projects/openscreen/src/types/media-devices.ts`:

```typescript
export type CameraPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type CameraSize = 'small' | 'medium' | 'large';

export const CAMERA_SIZE_PIXELS: Record<CameraSize, { width: number; height: number }> = {
  small: { width: 160, height: 120 },
  medium: { width: 240, height: 180 },
  large: { width: 320, height: 240 },
};

export interface CameraOverlayState {
  enabled: boolean;
  position: CameraPosition;
  size: CameraSize;
  deviceId: string | null;
}
```

### 2. Create useCameraCapture Hook (90 min)

Create `/Users/nghia/Projects/openscreen/src/hooks/use-camera-capture.ts`:

```typescript
import { useState, useRef, useCallback, useEffect } from 'react';
import type { CameraOverlayState } from '@/types/media-devices';

interface UseCameraCaptureReturn {
  stream: MediaStream | null;
  recording: boolean;
  startCapture: (deviceId: string) => Promise<void>;
  stopCapture: () => void;
  startRecording: () => void;
  stopRecording: () => Promise<Blob | null>;
  error: string | null;
}

export function useCameraCapture(): UseCameraCaptureReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recordingPromise = useRef<{
    resolve: (blob: Blob | null) => void;
  } | null>(null);

  const startCapture = useCallback(async (deviceId: string) => {
    try {
      setError(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false, // Audio handled separately
      });
      setStream(mediaStream);
    } catch (err) {
      console.error('Camera capture failed:', err);
      setError(err instanceof Error ? err.message : 'Camera capture failed');
    }
  }, []);

  const stopCapture = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
    }
    setRecording(false);
  }, [stream]);

  const startRecording = useCallback(() => {
    if (!stream) return;

    chunks.current = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 2_500_000, // 2.5 Mbps for camera
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks.current, { type: 'video/webm' });
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
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  return {
    stream,
    recording,
    startCapture,
    stopCapture,
    startRecording,
    stopRecording,
    error,
  };
}
```

### 3. Create CameraPreviewOverlay Component (60 min)

Create `/Users/nghia/Projects/openscreen/src/components/camera-preview-overlay.tsx`:

```typescript
import { useRef, useEffect } from 'react';
import type { CameraPosition, CameraSize } from '@/types/media-devices';
import { CAMERA_SIZE_PIXELS } from '@/types/media-devices';

interface CameraPreviewOverlayProps {
  stream: MediaStream | null;
  position: CameraPosition;
  size: CameraSize;
  visible: boolean;
}

const POSITION_STYLES: Record<CameraPosition, React.CSSProperties> = {
  'top-left': { top: 24, left: 24 },
  'top-right': { top: 24, right: 24 },
  'bottom-left': { bottom: 24, left: 24 },
  'bottom-right': { bottom: 24, right: 24 },
};

export function CameraPreviewOverlay({
  stream,
  position,
  size,
  visible,
}: CameraPreviewOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  if (!visible || !stream) return null;

  const dimensions = CAMERA_SIZE_PIXELS[size];
  const positionStyle = POSITION_STYLES[position];

  return (
    <div
      style={{
        position: 'fixed',
        ...positionStyle,
        width: dimensions.width,
        height: dimensions.height,
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        border: '2px solid rgba(255,255,255,0.2)',
        zIndex: 9999,
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)', // Mirror for natural feel
        }}
      />
    </div>
  );
}
```

### 4. Add Electron Window for Camera Overlay (45 min)

Modify `/Users/nghia/Projects/openscreen/electron/windows.ts`:

```typescript
// Add camera overlay window factory
export function createCameraOverlayWindow(): BrowserWindow {
  const cameraWindow = new BrowserWindow({
    width: 320,
    height: 240,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = VITE_DEV_SERVER_URL
    ? `${VITE_DEV_SERVER_URL}?windowType=camera-overlay`
    : `file://${path.join(__dirname, '../dist/index.html')}?windowType=camera-overlay`;

  cameraWindow.loadURL(url);
  return cameraWindow;
}
```

### 5. Add IPC Handler for Camera Recording Storage (30 min)

Modify `/Users/nghia/Projects/openscreen/electron/ipc/handlers.ts`:

```typescript
ipcMain.handle('store-camera-recording', async (_, videoData: ArrayBuffer, fileName: string) => {
  try {
    const videoPath = path.join(RECORDINGS_DIR, fileName);
    await fs.writeFile(videoPath, Buffer.from(videoData));
    return { success: true, path: videoPath };
  } catch (error) {
    console.error('Failed to store camera recording:', error);
    return { success: false, error: String(error) };
  }
});
```

### 6. Integrate into useScreenRecorder (60 min)

Modify `/Users/nghia/Projects/openscreen/src/hooks/useScreenRecorder.ts` to optionally start camera recording alongside screen recording.

Key changes:
- Accept `cameraDeviceId` parameter
- Start camera capture if deviceId provided
- Store camera blob as separate file
- Pass both paths to editor

## Todo List

- [x] Add camera overlay types to `src/types/media-devices.ts`
- [x] Create `src/hooks/use-camera-capture.ts` hook
- [x] Create `src/components/camera-preview-overlay.tsx` component
- [x] Add camera overlay window factory to `electron/windows.ts`
- [x] Add `store-camera-recording` IPC handler
- [x] Expose handler in `electron/preload.ts`
- [x] Modify `useScreenRecorder.ts` to integrate camera capture
- [x] **FIX CRITICAL:** Resolve TS2345 compilation error in handlers.ts:141
- [x] **FIX CRITICAL:** Add camera-overlay route to App.tsx
- [x] **FIX CRITICAL:** Wire createCameraOverlayWindow() to recording lifecycle
- [x] **FIX HIGH:** Refactor camera stream cleanup to use ref (memory leak risk)
- [x] **FIX HIGH:** Fix race condition in dual recorder stop timing
- [x] **FIX HIGH:** Add error UX for camera storage failures
- [x] **FIX HIGH:** Decide: delete or use use-camera-capture.ts hook
- [x] Test camera preview with different positions
- [x] Test camera preview with different sizes
- [x] Test recording start/stop synchronization
- [x] Test camera file storage
- [x] Verify cleanup on recording stop

## Success Criteria

- [x] ✓ Camera preview shows live feed during recording (implemented with app routing)
- [x] ✓ Preview appears in selected corner position (all 4 corners working)
- [x] ✓ Preview resizes correctly (small/medium/large sizes available)
- [x] ✓ Preview has rounded corners and shadow (styled and rendered)
- [x] ✓ Camera recording stored as separate `.webm` file (integration complete)
- [x] ✓ Both screen and camera recordings stop together (synchronized)
- [x] ✓ No memory leaks (proper track cleanup on unmount)

**Status:** All success criteria met. Phase 02 complete and functional.

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Camera permission denied | Medium | High | Clear UI prompt, graceful fallback |
| High CPU usage with two recorders | Medium | Medium | Optimize bitrate, test on M1 |
| Preview overlay flicker | Low | Low | Use hardware-accelerated video |
| A/V sync between screen and camera | Medium | Medium | Use same startTime reference |

## Security Considerations

- Camera access requires explicit user consent
- Stop camera tracks immediately when recording ends
- Do not expose camera stream to other windows

## Next Steps

After this phase, proceed to [Phase 03: Microphone Recording](phase-03-microphone-recording.md)
