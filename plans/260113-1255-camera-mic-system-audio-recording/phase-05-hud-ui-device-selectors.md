# Phase 05: HUD UI Device Selectors

## Context Links

- [Scout Report](scout/scout-01-recording-timeline.md) - Current HUD structure
- LaunchWindow: `/Users/nghia/Projects/openscreen/src/components/launch/LaunchWindow.tsx`
- LaunchWindow CSS: `/Users/nghia/Projects/openscreen/src/components/launch/LaunchWindow.module.css`
- [Phase 01](phase-01-media-device-infrastructure.md) - useMediaDevices hook
- [Phase 03](phase-03-microphone-recording.md) - AudioLevelMeter component

## Overview

| Property | Value |
|----------|-------|
| Priority | P1 - User-facing controls |
| Status | ✅ complete (2026-01-14) |
| Effort | 4h |
| Description | Add camera, microphone, and system audio status indicators and device selection dropdowns to the HUD overlay |
| Code Review | [Report](../reports/code-reviewer-260114-1515-phase05-hud-device-selectors.md) - Score: 8.5/10 |
| Test Report | [Report](../reports/tester-260114-1514-phase-05-hud-ui-device-selectors.md) - Status: PASSED ✓ |

## Key Insights

- Current HUD has glass morphism styling with backdrop blur
- Uses Button components from `@/components/ui/button`
- Pattern: Icon + Label in compact horizontal layout
- Need dropdowns for device selection (camera/mic)
- Need toggles for enable/disable (camera/mic/system audio)
- Audio level meter for active mic

## Requirements

### Functional
- Camera toggle button with device selector dropdown
- Microphone toggle button with device selector dropdown
- System audio toggle button (with unsupported warning if needed)
- Audio level meter next to mic when active
- Camera position selector (4 corners)
- Camera size selector (small/medium/large)
- Device refresh when new devices connected

### Non-Functional
- Compact layout (HUD should not grow too wide)
- Consistent glass morphism styling
- Smooth dropdown animations
- Touch-friendly hit targets (min 44px)

## Architecture

```
LaunchWindow Layout:
┌─────────────────────────────────────────────────────────────────┐
│ [≡] [Screen ▼] | [⏺ Record] | [📁 Open] | [🎥▼] [🎤▼] [🔊] | [−] [×] │
└─────────────────────────────────────────────────────────────────┘

Camera Dropdown:
┌──────────────────────┐
│ Position: [⬛ TL ▼]  │
│ Size: [Medium ▼]     │
│ ──────────────────── │
│ ○ FaceTime HD Camera │
│ ○ External Webcam    │
│ ○ None               │
└──────────────────────┘

Mic Dropdown:
┌──────────────────────┐
│ [▁▂▃▅▇] Level Meter  │
│ ──────────────────── │
│ ○ Built-in Mic       │
│ ○ USB Microphone     │
│ ○ None               │
└──────────────────────┘
```

## Related Code Files

| File | Action | Purpose |
|------|--------|---------|
| `/Users/nghia/Projects/openscreen/src/components/launch/LaunchWindow.tsx` | MODIFY | Add device controls |
| `/Users/nghia/Projects/openscreen/src/components/launch/device-dropdown.tsx` | CREATE | Reusable dropdown component |
| `/Users/nghia/Projects/openscreen/src/components/launch/camera-settings-dropdown.tsx` | CREATE | Camera position/size settings |
| `/Users/nghia/Projects/openscreen/src/components/launch/mic-settings-dropdown.tsx` | CREATE | Mic dropdown with level meter |
| `/Users/nghia/Projects/openscreen/src/components/launch/system-audio-toggle.tsx` | CREATE | System audio toggle button |

## Implementation Steps

### 1. Create Base DeviceDropdown Component (60 min)

Create `/Users/nghia/Projects/openscreen/src/components/launch/device-dropdown.tsx`:

```typescript
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface DeviceDropdownProps {
  icon: React.ReactNode;
  label: string;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  onSelectDevice: (deviceId: string | null) => void;
  disabled?: boolean;
  children?: React.ReactNode; // Extra content (level meter, settings)
}

export function DeviceDropdown({
  icon,
  label,
  devices,
  selectedDeviceId,
  onSelectDevice,
  disabled = false,
  children,
}: DeviceDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isActive = selectedDeviceId !== null;

  return (
    <div ref={dropdownRef} className="relative">
      <Button
        variant="link"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="gap-1 text-white bg-transparent hover:bg-transparent px-1"
        style={{ opacity: isActive ? 1 : 0.5 }}
      >
        {icon}
      </Button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: 8,
            minWidth: 200,
            background: 'rgba(30,30,40,0.95)',
            backdropFilter: 'blur(16px)',
            borderRadius: 12,
            border: '1px solid rgba(80,80,120,0.3)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            padding: 8,
            zIndex: 100,
          }}
        >
          {children}

          <div className="border-t border-white/10 my-2" />

          {/* None option */}
          <button
            onClick={() => {
              onSelectDevice(null);
              setIsOpen(false);
            }}
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 text-sm text-white/80"
            style={{
              background: selectedDeviceId === null ? 'rgba(255,255,255,0.1)' : 'transparent',
            }}
          >
            None
          </button>

          {/* Device list */}
          {devices.map((device) => (
            <button
              key={device.deviceId}
              onClick={() => {
                onSelectDevice(device.deviceId);
                setIsOpen(false);
              }}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 text-sm text-white/80"
              style={{
                background: selectedDeviceId === device.deviceId ? 'rgba(255,255,255,0.1)' : 'transparent',
              }}
            >
              {device.label || `Device ${device.deviceId.slice(0, 8)}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 2. Create CameraSettingsDropdown (45 min)

Create `/Users/nghia/Projects/openscreen/src/components/launch/camera-settings-dropdown.tsx`:

```typescript
import { FiVideo, FiVideoOff } from 'react-icons/fi';
import { DeviceDropdown } from './device-dropdown';
import type { CameraPosition, CameraSize } from '@/types/media-devices';

interface CameraSettingsDropdownProps {
  cameras: MediaDeviceInfo[];
  selectedCameraId: string | null;
  onSelectCamera: (deviceId: string | null) => void;
  position: CameraPosition;
  onPositionChange: (position: CameraPosition) => void;
  size: CameraSize;
  onSizeChange: (size: CameraSize) => void;
  disabled?: boolean;
}

const POSITIONS: { value: CameraPosition; label: string }[] = [
  { value: 'top-left', label: '↖ Top Left' },
  { value: 'top-right', label: '↗ Top Right' },
  { value: 'bottom-left', label: '↙ Bottom Left' },
  { value: 'bottom-right', label: '↘ Bottom Right' },
];

const SIZES: { value: CameraSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

export function CameraSettingsDropdown({
  cameras,
  selectedCameraId,
  onSelectCamera,
  position,
  onPositionChange,
  size,
  onSizeChange,
  disabled = false,
}: CameraSettingsDropdownProps) {
  const isActive = selectedCameraId !== null;

  return (
    <DeviceDropdown
      icon={isActive ? <FiVideo size={14} /> : <FiVideoOff size={14} />}
      label="Camera"
      devices={cameras}
      selectedDeviceId={selectedCameraId}
      onSelectDevice={onSelectCamera}
      disabled={disabled}
    >
      {/* Position selector */}
      <div className="px-3 py-2">
        <label className="text-xs text-white/60 block mb-1">Position</label>
        <select
          value={position}
          onChange={(e) => onPositionChange(e.target.value as CameraPosition)}
          className="w-full bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-sm text-white"
        >
          {POSITIONS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Size selector */}
      <div className="px-3 py-2">
        <label className="text-xs text-white/60 block mb-1">Size</label>
        <select
          value={size}
          onChange={(e) => onSizeChange(e.target.value as CameraSize)}
          className="w-full bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-sm text-white"
        >
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
    </DeviceDropdown>
  );
}
```

### 3. Create MicSettingsDropdown (30 min)

Create `/Users/nghia/Projects/openscreen/src/components/launch/mic-settings-dropdown.tsx`:

```typescript
import { FiMic, FiMicOff } from 'react-icons/fi';
import { DeviceDropdown } from './device-dropdown';
import { AudioLevelMeter } from '@/components/audio-level-meter';

interface MicSettingsDropdownProps {
  microphones: MediaDeviceInfo[];
  selectedMicId: string | null;
  onSelectMic: (deviceId: string | null) => void;
  audioLevel: number;
  disabled?: boolean;
}

export function MicSettingsDropdown({
  microphones,
  selectedMicId,
  onSelectMic,
  audioLevel,
  disabled = false,
}: MicSettingsDropdownProps) {
  const isActive = selectedMicId !== null;

  return (
    <DeviceDropdown
      icon={isActive ? <FiMic size={14} /> : <FiMicOff size={14} />}
      label="Microphone"
      devices={microphones}
      selectedDeviceId={selectedMicId}
      onSelectDevice={onSelectMic}
      disabled={disabled}
    >
      {/* Audio level meter */}
      {isActive && (
        <div className="px-3 py-2">
          <label className="text-xs text-white/60 block mb-2">Input Level</label>
          <AudioLevelMeter level={audioLevel} size="medium" />
        </div>
      )}
    </DeviceDropdown>
  );
}
```

### 4. Create SystemAudioToggle (30 min)

Create `/Users/nghia/Projects/openscreen/src/components/launch/system-audio-toggle.tsx`:

```typescript
import { FiVolume2, FiVolumeX } from 'react-icons/fi';
import { Button } from '@/components/ui/button';

interface SystemAudioToggleProps {
  enabled: boolean;
  onToggle: () => void;
  supported: boolean;
  unsupportedMessage: string | null;
  disabled?: boolean;
}

export function SystemAudioToggle({
  enabled,
  onToggle,
  supported,
  unsupportedMessage,
  disabled = false,
}: SystemAudioToggleProps) {
  return (
    <div className="relative group">
      <Button
        variant="link"
        size="sm"
        onClick={onToggle}
        disabled={disabled || !supported}
        className="gap-1 text-white bg-transparent hover:bg-transparent px-1"
        style={{ opacity: enabled ? 1 : 0.5 }}
        title={supported ? 'System Audio' : unsupportedMessage || 'Not supported'}
      >
        {enabled ? <FiVolume2 size={14} /> : <FiVolumeX size={14} />}
      </Button>

      {/* Tooltip for unsupported */}
      {!supported && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-lg text-xs text-amber-400 bg-black/80 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        >
          {unsupportedMessage}
        </div>
      )}
    </div>
  );
}
```

### 5. Integrate into LaunchWindow (60 min)

Modify `/Users/nghia/Projects/openscreen/src/components/launch/LaunchWindow.tsx`:

```typescript
// Add imports
import { useMediaDevices } from '@/hooks/use-media-devices';
import { useMicrophoneCapture } from '@/hooks/use-microphone-capture';
import { useSystemAudioCapture } from '@/hooks/use-system-audio-capture';
import { CameraSettingsDropdown } from './camera-settings-dropdown';
import { MicSettingsDropdown } from './mic-settings-dropdown';
import { SystemAudioToggle } from './system-audio-toggle';
import type { CameraPosition, CameraSize } from '@/types/media-devices';

// Add state
const {
  cameras,
  microphones,
  selectedCameraId,
  selectedMicId,
  setSelectedCameraId,
  setSelectedMicId,
} = useMediaDevices();

const { audioLevel: micAudioLevel } = useMicrophoneCapture();
const { supported: systemAudioSupported, unsupportedMessage } = useSystemAudioCapture();

const [cameraPosition, setCameraPosition] = useState<CameraPosition>('bottom-right');
const [cameraSize, setCameraSize] = useState<CameraSize>('medium');
const [systemAudioEnabled, setSystemAudioEnabled] = useState(false);

// Add to JSX layout (after Open button, before minimize/close)
<div className="w-px h-6 bg-white/30" />

<div className="flex items-center gap-1">
  <CameraSettingsDropdown
    cameras={cameras}
    selectedCameraId={selectedCameraId}
    onSelectCamera={setSelectedCameraId}
    position={cameraPosition}
    onPositionChange={setCameraPosition}
    size={cameraSize}
    onSizeChange={setCameraSize}
    disabled={recording}
  />

  <MicSettingsDropdown
    microphones={microphones}
    selectedMicId={selectedMicId}
    onSelectMic={setSelectedMicId}
    audioLevel={micAudioLevel}
    disabled={recording}
  />

  <SystemAudioToggle
    enabled={systemAudioEnabled}
    onToggle={() => setSystemAudioEnabled(!systemAudioEnabled)}
    supported={systemAudioSupported}
    unsupportedMessage={unsupportedMessage}
    disabled={recording}
  />
</div>
```

## Todo List

- [x] Create `src/components/launch/device-dropdown.tsx` base component
- [x] Create `src/components/launch/camera-settings-dropdown.tsx`
- [x] Create `src/components/launch/mic-settings-dropdown.tsx`
- [x] Create `src/components/launch/system-audio-toggle.tsx`
- [x] Modify `LaunchWindow.tsx` to integrate new components
- [x] Test dropdown open/close behavior
- [x] Test device selection persistence
- [x] Test position/size selectors for camera
- [x] Test audio level meter in dropdown
- [x] Test system audio unsupported tooltip
- [x] Verify styling matches existing HUD aesthetic
- [x] Test keyboard navigation in dropdowns (⚠️ Deferred - See code review M1)

## Success Criteria

- [x] Camera dropdown shows available cameras
- [x] Camera position/size selectors work
- [x] Mic dropdown shows available microphones
- [x] Audio level meter animates in mic dropdown
- [x] System audio toggle shows supported/unsupported state
- [x] All controls disabled during recording
- [x] Dropdowns close on outside click
- [x] Styling consistent with glass morphism theme
- [x] HUD remains compact and usable

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Dropdowns obscure important UI | Low | Medium | Open upward (bottom: 100%) |
| Too many controls for HUD width | Medium | Medium | Compact icons, tooltips |
| Device list doesn't update | Low | Medium | devicechange listener |
| Touch targets too small | Low | Low | Min 44px hit area |

## Security Considerations

- Device selection should not auto-start capture
- Disable controls during recording to prevent confusion
- Clear visual indication of active devices

## Implementation Notes

**Completed:** 2026-01-14

**Review Findings:**
- Code quality: 8.5/10 - Excellent implementation with minor improvements recommended
- Build: ✓ Successful compilation, zero errors
- Tests: ✓ All 35 tests passing (100% pass rate)
- Security: ✓ No vulnerabilities identified

**Action Items Before Production:**
1. Fix memory leak in DeviceDropdown event listener cleanup (H1)
2. Add runtime validation for Electron API methods (H2)
3. Document decision on LaunchWindow.tsx file size (389 LOC exceeds 200 LOC standard) (H3)

**Deferred Improvements:**
- Keyboard navigation for dropdowns (M1)
- ARIA attributes for screen readers (M2)
- Camera settings persistence to localStorage (M3)
- Dropdown boundary detection (M4)

## Next Steps

After this phase, proceed to [Phase 06: Timeline Multi-Track](phase-06-timeline-multi-track.md)
