# Phase 01: Media Device Infrastructure

## Context Links

- [Electron Media Capture Report](reports/researcher-01-electron-media-capture.md)
- [Scout Report](scout/scout-01-recording-timeline.md)
- Current hook: `/Users/nghia/Projects/openscreen/src/hooks/useScreenRecorder.ts`
- Preload: `/Users/nghia/Projects/openscreen/electron/preload.ts`
- IPC handlers: `/Users/nghia/Projects/openscreen/electron/ipc/handlers.ts`

## Overview

| Property | Value |
|----------|-------|
| Priority | P1 - Foundation for all media capture |
| Status | ✓ DONE |
| Effort | 3h |
| Completed | 2026-01-13 16:25 |
| Description | Create device enumeration infrastructure, TypeScript types, and shared hooks for camera/mic device selection |

## Key Insights

- `navigator.mediaDevices.enumerateDevices()` works in Electron renderer
- Device list may change (user plugs in webcam) - need event listener
- Permission may be required before device labels are visible
- IPC not strictly required for device enumeration (renderer-side API)

## Requirements

### Functional
- Enumerate available video input devices (cameras)
- Enumerate available audio input devices (microphones)
- Track selected device IDs in state
- Handle device connect/disconnect events
- Request permissions before showing device list

### Non-Functional
- Fast enumeration (<100ms)
- No memory leaks from event listeners
- TypeScript strict mode compliance

## Architecture

```
Renderer Process:
  useMediaDevices hook
    ├── cameras: MediaDeviceInfo[]
    ├── microphones: MediaDeviceInfo[]
    ├── selectedCameraId: string | null
    ├── selectedMicId: string | null
    ├── setSelectedCameraId()
    ├── setSelectedMicId()
    ├── refreshDevices()
    └── permissionStatus: 'granted' | 'denied' | 'prompt'
```

## Related Code Files

| File | Action | Purpose |
|------|--------|---------|
| `/Users/nghia/Projects/openscreen/src/hooks/use-media-devices.ts` | CREATE | Device enumeration hook |
| `/Users/nghia/Projects/openscreen/src/types/media-devices.ts` | CREATE | TypeScript types for devices |
| `/Users/nghia/Projects/openscreen/src/vite-env.d.ts` | MODIFY | Add window.electronAPI types if needed |

## Implementation Steps

### 1. Create TypeScript Types (15 min)

Create `/Users/nghia/Projects/openscreen/src/types/media-devices.ts`:

```typescript
export interface MediaDeviceState {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  selectedCameraId: string | null;
  selectedMicId: string | null;
  systemAudioEnabled: boolean;
  permissionStatus: PermissionStatus;
}

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface UseMediaDevicesReturn {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  selectedCameraId: string | null;
  selectedMicId: string | null;
  systemAudioEnabled: boolean;
  setSelectedCameraId: (id: string | null) => void;
  setSelectedMicId: (id: string | null) => void;
  setSystemAudioEnabled: (enabled: boolean) => void;
  refreshDevices: () => Promise<void>;
  requestPermissions: () => Promise<boolean>;
  permissionStatus: PermissionStatus;
  isLoading: boolean;
}
```

### 2. Create useMediaDevices Hook (90 min)

Create `/Users/nghia/Projects/openscreen/src/hooks/use-media-devices.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import type { UseMediaDevicesReturn, PermissionStatus } from '@/types/media-devices';

export function useMediaDevices(): UseMediaDevicesReturn {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [selectedMicId, setSelectedMicId] = useState<string | null>(null);
  const [systemAudioEnabled, setSystemAudioEnabled] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('unknown');
  const [isLoading, setIsLoading] = useState(true);

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(d => d.kind === 'videoinput');
      const audioInputs = devices.filter(d => d.kind === 'audioinput');

      setCameras(videoInputs);
      setMicrophones(audioInputs);

      // Check if labels are available (indicates permission granted)
      const hasLabels = devices.some(d => d.label && d.label.length > 0);
      if (hasLabels) {
        setPermissionStatus('granted');
      }
    } catch (error) {
      console.error('Failed to enumerate devices:', error);
    }
  }, []);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    try {
      // Request both camera and mic permissions
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      // Stop tracks immediately - we just needed permission
      stream.getTracks().forEach(track => track.stop());
      setPermissionStatus('granted');
      await enumerateDevices();
      return true;
    } catch (error) {
      console.error('Permission denied:', error);
      setPermissionStatus('denied');
      return false;
    }
  }, [enumerateDevices]);

  const refreshDevices = useCallback(async () => {
    setIsLoading(true);
    await enumerateDevices();
    setIsLoading(false);
  }, [enumerateDevices]);

  // Initial enumeration
  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  // Listen for device changes
  useEffect(() => {
    const handleDeviceChange = () => {
      enumerateDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [enumerateDevices]);

  return {
    cameras,
    microphones,
    selectedCameraId,
    selectedMicId,
    systemAudioEnabled,
    setSelectedCameraId,
    setSelectedMicId,
    setSystemAudioEnabled,
    refreshDevices,
    requestPermissions,
    permissionStatus,
    isLoading,
  };
}
```

### 3. Add macOS Version Check Utility (30 min)

Create helper to detect macOS 13.2+ for system audio support:

```typescript
// In /Users/nghia/Projects/openscreen/src/lib/platform-utils.ts
export async function getMacOSVersion(): Promise<{ major: number; minor: number } | null> {
  if (typeof window === 'undefined') return null;

  const platform = await window.electronAPI?.getPlatform();
  if (platform !== 'darwin') return null;

  // Parse from navigator.userAgent or use Electron API
  const match = navigator.userAgent.match(/Mac OS X (\d+)[._](\d+)/);
  if (match) {
    return { major: parseInt(match[1]), minor: parseInt(match[2]) };
  }
  return null;
}

export async function supportsSystemAudio(): Promise<boolean> {
  const version = await getMacOSVersion();
  if (!version) return false;
  // macOS 13.2+ (Ventura)
  return version.major > 13 || (version.major === 13 && version.minor >= 2);
}
```

### 4. Export from Hooks Index (15 min)

Update `/Users/nghia/Projects/openscreen/src/hooks/index.ts` if it exists, or ensure proper export.

## Todo List

- [x] Create `src/types/media-devices.ts` with TypeScript interfaces
- [x] Create `src/hooks/use-media-devices.ts` hook
- [x] Create `src/lib/platform-utils.ts` for macOS version detection
- [x] Test platform utils (15 passing tests)
- [x] Device ID validation in setters
- [x] Permission status fallback when labels missing
- [x] Device enumeration error handling
- [x] Devicechange event listener cleanup
- [x] Permission request flow
- [x] Cleanup on unmount (no memory leaks)

## Success Criteria

- [x] `useMediaDevices()` returns list of cameras and microphones
- [x] Device labels visible after permission granted
- [x] Selecting a device updates state correctly
- [x] Device connect/disconnect triggers refresh
- [x] `supportsSystemAudio()` returns correct value on macOS 13.2+
- [x] No console errors during normal operation

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Permission denied by user | Medium | High | Show clear explanation, graceful fallback |
| Device enumeration fails | Low | Medium | Retry mechanism, error state |
| Device labels empty (no permission) | Medium | Low | Prompt for permission first |

## Security Considerations

- Only request permissions when user initiates action
- Do not cache MediaStream objects (security risk)
- Stop tracks immediately after permission request

## Code Review

- **Status:** ✓ APPROVED - Phase complete
- **Test Coverage:** 15 tests passing
- **Key Files:**
  - src/types/media-devices.ts - Device type definitions
  - src/hooks/use-media-devices.ts - Device enumeration hook with localStorage persistence
  - src/lib/platform-utils.ts - macOS version detection with tests

## Next Steps

- Proceed to [Phase 02: Camera Recording & Capture](phase-02-camera-recording-capture.md)
- Phase 02 depends on device infrastructure established in this phase
