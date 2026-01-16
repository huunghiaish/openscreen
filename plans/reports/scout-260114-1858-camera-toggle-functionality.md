# Scout Report: Camera Toggle Functionality

**Date:** 2026-01-14  
**Scope:** Camera toggle functionality in Electron + React + TypeScript screen recording app  
**Status:** Complete

---

## Executive Summary

Located **13 core files** implementing comprehensive camera toggle and overlay functionality across the Electron app. The system spans:
- UI controls (HUD launch window, device selector, camera settings dropdown)
- State management (media devices hook, camera capture hook)
- Electron IPC layer (handlers, preload, window management)
- Camera preview rendering (overlay components, pip renderer)
- Type definitions

The implementation uses localStorage for persistence, supports camera enable/disable with device selection, camera preview toggle with position/size options, and separate camera overlay window rendering.

---

## Core Files by Category

### 1. UI Components (React)

#### `/Users/nghia/Projects/openscreen/src/components/launch/LaunchWindow.tsx` (284 lines)
**Purpose:** Main HUD overlay with recording controls and device selectors  
**Key Features:**
- Renders camera settings dropdown, mic dropdown, system audio toggle
- `cameraEnabled = selectedCameraId !== null` state tracking
- `toggleCameraPreview()` function for show/hide camera preview
- `handleCameraSelect()` with permission request handling
- Camera preview state: `cameraPreviewEnabled` (useState)
- Uses `useCameraOverlay` hook to manage overlay visibility
- Three main device controls: camera, mic, system audio

**Key Variables:**
- `selectedCameraId` (from useMediaDevices)
- `cameraEnabled` (derived state)
- `cameraPreviewEnabled` (local state)
- `cameraPosition` (local state: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right')
- `cameraSize` (local state: 'small' | 'medium' | 'large')

---

#### `/Users/nghia/Projects/openscreen/src/components/launch/camera-settings-dropdown.tsx` (107 lines)
**Purpose:** Camera device selection dropdown with position/size settings  
**Key Features:**
- Shows camera list and overlay configuration options
- Position selector (4 corners)
- Size selector (small, medium, large)
- Active state icon (FiVideo green when selected, FiVideoOff gray when not)
- Extends DeviceDropdown base component
- Settings content rendered as dropdown header

**Key Props:**
- `cameras: MediaDeviceInfo[]`
- `selectedCameraId: string | null`
- `onSelectCamera: (deviceId: string | null) => void`
- `position: CameraPosition`
- `onPositionChange: (position: CameraPosition) => void`
- `size: CameraSize`
- `onSizeChange: (size: CameraSize) => void`

---

#### `/Users/nghia/Projects/openscreen/src/components/launch/device-dropdown.tsx` (247 lines)
**Purpose:** Base reusable device dropdown component (camera, mic)  
**Key Features:**
- Glass morphism styling matching HUD aesthetic
- Opens upward to avoid obscuring main controls
- Full keyboard navigation support (Arrow keys, Home, End, Enter)
- ARIA accessibility (listbox role, aria-expanded, aria-selected)
- Focus management with scroll-into-view
- Escape key and outside-click handlers
- "None" option plus device list with labels

**Key Behavior:**
- Options array: `[null, ...devices.map((d) => d.deviceId)]`
- Position: absolute, bottom: 100%, left: 50%, transform: translateX(-50%)
- Max height 300px with overflow-y auto

---

#### `/Users/nghia/Projects/openscreen/src/components/camera-preview-overlay.tsx` (72 lines)
**Purpose:** Camera preview overlay component for live webcam during recording  
**Key Features:**
- Fixed position overlay with corners (top-left, top-right, bottom-left, bottom-right)
- Configurable size (small: 160x120, medium: 240x180, large: 320x240)
- Mirror transform (scaleX(-1)) for natural selfie feel
- Border radius 16, box shadow, white border
- Video element with srcObject binding
- Only renders when `visible && stream` both true

**Props:**
- `stream: MediaStream | null`
- `position: CameraPosition`
- `size: CameraSize`
- `visible: boolean`

---

#### `/Users/nghia/Projects/openscreen/src/components/camera-overlay-window.tsx` (118 lines)
**Purpose:** Standalone camera overlay window (separate Electron window)  
**Key Features:**
- Separate component rendered in dedicated Electron window
- Transparent background (document.body.style.background = 'transparent')
- Exposes `window.startCameraPreview(deviceId)` function for IPC
- Calls `navigator.mediaDevices.getUserMedia()` directly with device ID
- Handles stream cleanup on unmount
- Same mirror transform and styling as CameraPreviewOverlay
- Empty div when no stream to maintain transparent window

**Window Setup:**
- Receives camera device ID via IPC after window loads
- Main window calls: `cameraOverlayWindow.webContents.executeJavaScript("window.startCameraPreview('${deviceId}')")`

---

### 2. State Management Hooks

#### `/Users/nghia/Projects/openscreen/src/hooks/use-media-devices.ts` (173 lines)
**Purpose:** Media device enumeration and selection state management  
**Key Features:**
- Lists available cameras and microphones
- Manages selected device IDs with localStorage persistence
- Permission request handling
- Device change listener (devicechange event)
- Validation ensures selected device still exists after enumeration
- System audio support detection

**State:**
- `selectedCameraId` (string | null)
- `selectedMicId` (string | null)
- `systemAudioEnabled` (boolean)
- `permissionStatus` ('granted' | 'denied' | 'prompt' | 'unknown')
- `cameras` (MediaDeviceInfo[])
- `microphones` (MediaDeviceInfo[])

**Storage Keys:**
- `DEVICE_STORAGE_KEYS.SELECTED_CAMERA: 'openscreen:selectedCameraId'`
- `DEVICE_STORAGE_KEYS.SELECTED_MIC: 'openscreen:selectedMicId'`
- `DEVICE_STORAGE_KEYS.SYSTEM_AUDIO_ENABLED: 'openscreen:systemAudioEnabled'`

**Key Functions:**
- `setSelectedCameraId(id: string | null)` - Validates device exists
- `requestPermissions()` - Requests camera/mic permissions
- `refreshDevices()` - Re-enumerate devices

---

#### `/Users/nghia/Projects/openscreen/src/hooks/use-camera-overlay.ts` (115 lines)
**Purpose:** Manage camera overlay window visibility  
**Key Features:**
- Controls when to show/hide camera overlay window
- Handles recording state changes
- Handles preview toggle (only when not recording)
- Handles camera enable/disable
- Safe Electron API access with runtime validation
- Three separate useEffect hooks for different trigger scenarios

**Options:**
```typescript
{
  recording: boolean;
  cameraEnabled: boolean;
  cameraDeviceId: string | null;
  previewEnabled: boolean;
}
```

**Logic:**
1. Initial mount: Show overlay if camera enabled with preview
2. Recording state change: Show on start (if camera+preview), hide on stop
3. Preview toggle: Show/hide only when not recording
4. Camera enable: Show when camera becomes enabled (if preview on)

**Electron API Calls:**
- `window.electronAPI.showCameraOverlay(deviceId)`
- `window.electronAPI.hideCameraOverlay()`

---

#### `/Users/nghia/Projects/openscreen/src/hooks/use-camera-capture.ts` (126 lines)
**Purpose:** Standalone camera capture for recording webcam independently  
**Key Features:**
- getUserMedia stream management
- MediaRecorder for camera recording
- Start/stop capture and recording
- Error handling for permission/device issues
- Cleanup on unmount
- Supports VP9 codec with fallback to WebM

**Return:**
```typescript
{
  stream: MediaStream | null;
  recording: boolean;
  startCapture: (deviceId: string) => Promise<void>;
  stopCapture: () => void;
  startRecording: () => void;
  stopRecording: () => Promise<Blob | null>;
  error: string | null;
}
```

---

#### `/Users/nghia/Projects/openscreen/src/hooks/useScreenRecorder.ts` (100+ lines)
**Purpose:** Main orchestration hook for screen, camera, mic, system audio recording  
**Key Features:**
- Accepts `cameraDeviceId` option
- Manages separate `cameraRecorder` ref
- `cameraStreamRef` for camera stream management
- `cameraChunks` for camera blob collection
- Integrates camera into main recording pipeline
- Returns `cameraStream` for preview rendering

**Key Options:**
```typescript
{
  cameraDeviceId?: string | null;
  micDeviceId?: string | null;
  systemAudioEnabled?: boolean;
}
```

---

### 3. Type Definitions

#### `/Users/nghia/Projects/openscreen/src/types/media-devices.ts` (88 lines)
**Purpose:** TypeScript types for camera/mic device management  
**Key Types:**

```typescript
type CameraPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type CameraSize = 'small' | 'medium' | 'large';

const CAMERA_SIZE_PIXELS = {
  small: { width: 160, height: 120 },
  medium: { width: 240, height: 180 },
  large: { width: 320, height: 240 },
};

interface CameraOverlayState {
  enabled: boolean;
  position: CameraPosition;
  size: CameraSize;
  deviceId: string | null;
}

type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unknown';
```

---

### 4. Electron IPC Layer

#### `/Users/nghia/Projects/openscreen/electron/preload.ts` (98 lines)
**Purpose:** Context bridge exposing IPC API to React components  
**Key Methods:**
- `showCameraOverlay(deviceId: string)` → `ipcRenderer.invoke('show-camera-overlay', deviceId)`
- `hideCameraOverlay()` → `ipcRenderer.invoke('hide-camera-overlay')`
- Other recording-related methods: storeCameraRecording, getCameraVideoPath, etc.

**Exposed in:** `window.electronAPI`

---

#### `/Users/nghia/Projects/openscreen/electron/ipc/handlers.ts` (199+ lines)
**Purpose:** IPC message handlers for camera operations  
**Key Handlers:**

```typescript
// Camera overlay window management
ipcMain.handle('show-camera-overlay', (_, deviceId: string) => {
  if (showCameraOverlay) {
    showCameraOverlay(deviceId)
  }
})

ipcMain.handle('hide-camera-overlay', () => {
  if (hideCameraOverlay) {
    hideCameraOverlay()
  }
})

// Camera recording storage (500MB max)
ipcMain.handle('store-camera-recording', async (_, videoData, fileName) => {
  safeWriteRecording(RECORDINGS_DIR, fileName, videoData, MAX_CAMERA_SIZE, ['webm', 'mp4'])
})

// Get camera video path
ipcMain.handle('get-camera-video-path', (_, mainVideoPath) => {
  // Returns associated camera video path
})
```

**File Size Limits:**
- `MAX_CAMERA_SIZE = 500 * 1024 * 1024` (500MB)
- Filename validation: strict pattern `(camera)-{timestamp}.{ext}`

---

#### `/Users/nghia/Projects/openscreen/electron/main.ts` (217 lines)
**Purpose:** App initialization and camera overlay window management  
**Key Functions:**

```typescript
function showCameraOverlayWindowWrapper(deviceId: string) {
  // Close existing camera window
  if (cameraOverlayWindow && !cameraOverlayWindow.isDestroyed()) {
    cameraOverlayWindow.close()
  }

  // Create new window
  cameraOverlayWindow = createCameraOverlayWindow()

  // Position in bottom-right: (screenWidth - 320 - 24, screenHeight - 240 - 24)
  cameraOverlayWindow.setBounds({
    x: screenWidth - windowWidth - margin,
    y: screenHeight - windowHeight - margin,
    width: 320,
    height: 240,
  })

  // Send device ID via JavaScript execution
  cameraOverlayWindow.webContents.on('did-finish-load', () => {
    cameraOverlayWindow.webContents.executeJavaScript(
      `window.startCameraPreview && window.startCameraPreview('${deviceId}')`
    )
  })

  cameraOverlayWindow.show()
}

function hideCameraOverlayWindowWrapper() {
  if (cameraOverlayWindow && !cameraOverlayWindow.isDestroyed()) {
    cameraOverlayWindow.close()
    cameraOverlayWindow = null
  }
}
```

**Lifecycle:**
- Recording stops → `hideCameraOverlayWindowWrapper()` called
- Camera enabled → `showCameraOverlayWindowWrapper(deviceId)` called
- App ready → IPC handlers registered with these functions passed

---

#### `/Users/nghia/Projects/openscreen/electron/windows.ts` (188 lines)
**Purpose:** Window factory functions  
**Key Function:**

```typescript
export function createCameraOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 240,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Load with query param
  win.loadURL(VITE_DEV_SERVER_URL + '?windowType=camera-overlay')
  // or in production:
  win.loadFile(path.join(RENDERER_DIST, 'index.html'), {
    query: { windowType: 'camera-overlay' }
  })

  return win
}
```

---

### 5. Type Definitions (Electron)

#### `/Users/nghia/Projects/openscreen/electron/electron-env.d.ts` (88 lines)
**Purpose:** TypeScript declarations for window.electronAPI  
**Key Declarations:**

```typescript
showCameraOverlay: (deviceId: string) => Promise<void>
hideCameraOverlay: () => Promise<void>
storeCameraRecording: (videoData: ArrayBuffer, fileName: string) => Promise<{...}>
getCameraVideoPath: (mainVideoPath: string) => Promise<{...}>
```

---

## Data Flow Diagram

### Enabling Camera

```
User clicks camera device in CameraSettingsDropdown
  ↓
handleCameraSelect() in LaunchWindow.tsx
  ↓
setSelectedCameraId(deviceId)  [persisted to localStorage]
  ↓
useMediaDevices returns selectedCameraId
  ↓
cameraEnabled = selectedCameraId !== null
  ↓
useCameraOverlay hook detects cameraEnabled=true
  ↓
window.electronAPI.showCameraOverlay(deviceId)
  ↓
IPC: preload.ts → handlers.ts → main.ts
  ↓
showCameraOverlayWindowWrapper(deviceId)
  ↓
createCameraOverlayWindow() in windows.ts
  ↓
Load CameraOverlayWindow component with ?windowType=camera-overlay
  ↓
On load: executeJavaScript("window.startCameraPreview('${deviceId}')")
  ↓
CameraOverlayWindow.tsx calls navigator.mediaDevices.getUserMedia({video: {deviceId}})
  ↓
Camera stream displays in overlay window
```

### Toggling Preview (Hide/Show)

```
User clicks eye icon button in LaunchWindow.tsx
  ↓
toggleCameraPreview() → setCameraPreviewEnabled(!prev)
  ↓
useCameraOverlay detects previewEnabled change
  ↓
If previewEnabled=true AND cameraEnabled:
  window.electronAPI.showCameraOverlay(deviceId)
Else if previewEnabled=false:
  window.electronAPI.hideCameraOverlay()
  ↓
IPC calls trigger main.ts wrapper functions
  ↓
Camera overlay window shown/hidden
```

---

## Key Integration Points

### 1. HUD Launch Window (LaunchWindow.tsx)

The central hub connecting all camera functionality:

```typescript
// Device enumeration
const { selectedCameraId, setSelectedCameraId, ...} = useMediaDevices();

// Camera state
const cameraEnabled = selectedCameraId !== null;
const [cameraPreviewEnabled, setCameraPreviewEnabled] = useState(true);
const [cameraPosition, setCameraPosition] = useState<CameraPosition>('bottom-right');
const [cameraSize, setCameraSize] = useState<CameraSize>('medium');

// Control overlay
useCameraOverlay({
  recording,
  cameraEnabled,
  cameraDeviceId: selectedCameraId,
  previewEnabled: cameraPreviewEnabled,
});

// Pass to camera settings dropdown
<CameraSettingsDropdown
  cameras={cameras}
  selectedCameraId={selectedCameraId}
  onSelectCamera={handleCameraSelect}
  position={cameraPosition}
  onPositionChange={setCameraPosition}
  size={cameraSize}
  onSizeChange={setCameraSize}
  disabled={recording}
/>

// Preview toggle button
<Button onClick={toggleCameraPreview} disabled={!cameraEnabled}>
  {cameraPreviewEnabled ? <BsEye /> : <BsEyeSlash />}
</Button>
```

### 2. Recording Integration

Camera is captured during screen recording via `useScreenRecorder`:

```typescript
const { recording, toggleRecording } = useScreenRecorder({
  cameraDeviceId: cameraEnabled ? selectedCameraId : null,
});
```

When recording:
- Overlay hidden when recording starts/stops (useCameraOverlay logic)
- Camera device ID passed to useScreenRecorder
- Separate camera MediaRecorder captures video
- Camera file stored independently for editor compositing

### 3. Editor Integration

Camera PiP rendering during export:

```typescript
CameraPipRenderer class handles:
- Loading camera video file
- Extracting frames at specific times
- Compositing onto main video
- Supporting shapes: rectangle, square, circle
- Supporting positions and sizes
```

---

## File Organization Summary

```
src/
├── components/
│   ├── launch/
│   │   ├── LaunchWindow.tsx                    [Main HUD]
│   │   ├── camera-settings-dropdown.tsx        [Camera selector]
│   │   └── device-dropdown.tsx                 [Base dropdown]
│   ├── camera-preview-overlay.tsx              [Overlay in HUD]
│   └── camera-overlay-window.tsx               [Overlay window]
├── hooks/
│   ├── use-media-devices.ts                    [Device enumeration]
│   ├── use-camera-overlay.ts                   [Overlay visibility]
│   ├── use-camera-capture.ts                   [Standalone camera]
│   └── useScreenRecorder.ts                    [Main recording]
├── lib/exporter/
│   └── camera-pip-renderer.ts                  [PiP export]
└── types/
    └── media-devices.ts                        [Type defs]

electron/
├── main.ts                                     [App init + overlay]
├── windows.ts                                  [Window factory]
├── preload.ts                                  [IPC bridge]
├── ipc/handlers.ts                             [IPC handlers]
└── electron-env.d.ts                           [TS declarations]
```

---

## Key Configuration Constants

**Camera Recording:**
- Width: 1280px (ideal)
- Height: 720px (ideal)
- Frame rate: 30fps (ideal)
- Bitrate: 2.5 Mbps
- Codec: VP9 (fallback WebM)

**Overlay Window:**
- Default size: 320x240 (medium preset)
- Default position: bottom-right
- alwaysOnTop: true
- transparent: true
- resizable: false

**Keyboard Navigation:**
- Arrow Up/Down: cycle through devices
- Home/End: jump to first/last
- Enter/Space: select device
- Escape: close dropdown
- Tab: close dropdown and move focus

---

## Permissions & Security

**Device Access:**
- Camera permissions requested via `requestPermissions()`
- Uses standard Web API: `navigator.mediaDevices.getUserMedia()`
- Graceful fallback if permissions denied

**File Storage:**
- Recordings stored in `app.getPath('userData')/recordings`
- Filename validation: strict pattern matching
- Max size enforcement: 500MB for camera videos
- Path traversal protection in `safeWriteRecording()`

---

## Unresolved Questions

1. Camera export configuration - how are camera position/size settings applied during editor export? (Reference: `CameraPipRenderer`)
2. Are camera preview overlays shown only in HUD window or also in main editor window?
3. Is there fallback handling if overlay window creation fails?

