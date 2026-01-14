# OpenScreen System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Electron Main Process                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ • App lifecycle & window management                      │  │
│  │ • Tray menu                                             │  │
│  │ • File system operations (save, export)                 │  │
│  │ • Screen capture via native APIs                        │  │
│  │ • IPC request handlers                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           ↕ IPC Messages
┌─────────────────────────────────────────────────────────────────┐
│              Electron Renderer (React Application)              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Window Router (src/App.tsx)                              │  │
│  │ ?windowType=hud-overlay | source-selector | editor       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐   │
│  │ HUD Overlay     │  │ Source Selector │  │ Video Editor │   │
│  │ • Record button │  │ • Screen list   │  │ • Timeline   │   │
│  │ • Device sel.   │  │ • Window list   │  │ • Playback   │   │
│  │ • Status        │  │ • App list      │  │ • Export UI  │   │
│  └─────────────────┘  └─────────────────┘  └──────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ React Hooks & State Management                          │  │
│  │ • useMediaDevices - Camera/mic enumeration              │  │
│  │ • useScreenRecorder - Recording state                   │  │
│  │ • Custom hooks for UI state                             │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Libraries & Utilities                                   │  │
│  │ • PixiJS - Canvas rendering                             │  │
│  │ • dnd-timeline - Timeline interaction                   │  │
│  │ • Exporter - MP4/GIF pipeline                           │  │
│  │ • platform-utils - macOS detection                      │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           ↕ Web APIs
┌─────────────────────────────────────────────────────────────────┐
│                    Browser/OS APIs                              │
│  • navigator.mediaDevices (camera/mic)                          │
│  • MediaStream API                                              │
│  • localStorage                                                 │
│  • File system (via Electron preload)                           │
│  • Native screen capture (via Electron main)                    │
└─────────────────────────────────────────────────────────────────┘
```

## Process Architecture

### Main Process (Electron)

**Entry**: `electron/main.ts`

**Responsibilities**:
- Application lifecycle (init, ready, quit)
- Create/manage application windows (HUD, Editor, SourceSelector)
- Handle system tray menu
- Intercept file operations and safe writes
- Manage screen capture sessions
- Process IPC requests from renderer

**Key Files**:
- `electron/main.ts` - App entry and initialization
- `electron/windows.ts` - Window creation functions
- `electron/preload.ts` - Secure IPC bridge
- `electron/ipc/handlers.ts` - IPC request handlers

### Renderer Process (React)

**Entry**: `src/App.tsx`

**Window Router**:
```typescript
// In src/App.tsx - routes based on ?windowType query param
if (windowType === 'hud-overlay') return <LaunchWindow />;
if (windowType === 'source-selector') return <SourceSelector />;
return <VideoEditor />; // default
```

**Components by Type**:
- **HUD Overlay** (`src/components/launch/LaunchWindow.tsx`)
  - Recording controls (play/pause/stop)
  - Device selection dropdowns
  - Status display (recording, selected device)

- **Source Selector** (`src/components/launch/SourceSelector.tsx`)
  - List of available screens
  - List of open windows
  - List of running applications
  - Preview of selected source

- **Editor** (`src/components/video-editor/VideoEditor.tsx`)
  - Video playback with PixiJS canvas
  - Timeline with drag-and-drop regions
  - Settings panel for export options
  - Preview of edits in real-time

## Data Flow Architecture

### Recording Session Flow

```
1. HUD Launch Window
   ├─ useMediaDevices hook
   │  ├─ Calls navigator.mediaDevices.enumerateDevices()
   │  ├─ Filters for videoinput/audioinput kinds
   │  ├─ Listens for 'devicechange' events
   │  ├─ Persists selection to localStorage
   │  └─ Validates device IDs on selection
   │
   ├─ User selects camera, microphone, and system audio preference
   │
   ├─ Source Selector Window
   │  ├─ Queries main process for available screens/windows
   │  ├─ User selects display region
   │  │
   │  └─ Click Record
   │     ├─ Emit 'START_CAPTURE' IPC to main
   │     │  └─ Payload includes optional cameraDeviceId and systemAudioEnabled flag
   │     │
   │     ├─ Main process initializes capture
   │     │  ├─ Start screen capture
   │     │  ├─ If cameraDeviceId: Start camera capture (separate MediaStream)
   │     │  ├─ Begin microphone audio stream (if enabled)
   │     │  └─ Begin system audio capture (if enabled and macOS 13.2+)
   │     │     └─ Extract audio from ScreenCaptureKit desktop capture
   │     │
   │     ├─ Recording flows via IPC
   │     │  ├─ Screen frame data → RECORDINGS_DIR/recording-{timestamp}.webm
   │     │  ├─ Camera frame data → RECORDINGS_DIR/camera-{timestamp}.webm (if camera enabled)
   │     │  ├─ Microphone audio → RECORDINGS_DIR/mic-{timestamp}.webm (if mic enabled)
   │     │  └─ System audio → RECORDINGS_DIR/system-audio-{timestamp}.webm (if system audio enabled)
   │     │
   │     ├─ useSystemAudioCapture Hook (if system audio enabled)
   │     │  ├─ captureSystemAudio() extracts audio from ScreenCaptureKit
   │     │  ├─ setupAudioLevelMeter() for VU meter display
   │     │  ├─ startRecording() captures audio at 192 kbps
   │     │  └─ Runs in parallel with screen recording
   │     │
   │     ├─ Camera preview overlay shown (optional)
   │     │  └─ useScreenRecorder with cameraDeviceId displays live camera feed
   │     │
   │     └─ User clicks Stop → 'STOP_CAPTURE' IPC
   │        ├─ Screen recording stops
   │        ├─ Camera recording stops (if enabled)
   │        ├─ Microphone audio stops (if enabled)
   │        │  └─ Emit 'store-audio-recording' IPC with mic audio blob
   │        ├─ System audio stops (if enabled)
   │        │  └─ Emit 'store-system-audio-recording' IPC with system audio blob
   │        └─ All files saved to RECORDINGS_DIR
   │
   └─ Editor Window Opens (Phase 06: Multi-Track Timeline)
      ├─ Video data loaded from file
      ├─ buildMediaTracks() resolves all available audio/video paths
      │  ├─ Call getMicAudioPath(mainVideoPath)
      │  ├─ Call getSystemAudioPath(mainVideoPath)
      │  ├─ Reuse cameraVideoPath from Phase 03
      │  └─ Construct MediaTrack[] for each available file
      ├─ TimelineEditor renders multi-track display
      │  ├─ MediaTrackRow (Screen) - always present
      │  ├─ MediaTrackRow (Camera) - if camera-{timestamp}.webm exists
      │  ├─ MediaTrackRow (Microphone) - if mic-{timestamp}.webm exists
      │  ├─ MediaTrackRow (System Audio) - if system-audio-{timestamp}.webm exists
      │  └─ Color-coded blocks + waveform patterns for audio tracks
      └─ Each track spans correct duration (startMs → endMs)

2. Video Editing
   ├─ User interacts with timeline
   │  ├─ Drag regions for zoom
   │  ├─ Add annotations
   │  ├─ Trim video segments
   │  └─ Adjust camera overlay (position/size if present)
   │
   ├─ PixiJS canvas updates in real-time
   │  ├─ Renders current frame
   │  ├─ Applies zoom/effects
   │  ├─ Overlays camera preview (if present)
   │  └─ Playback synchronized with all timeline tracks
   │
   └─ User Exports
      ├─ Select export format (MP4, GIF)
      ├─ Configure settings
      ├─ Emit 'EXPORT_VIDEO' IPC
      ├─ Main process:
      │  ├─ Render all frames with effects
      │  ├─ Composite camera overlay onto screen frames (if present)
      │  ├─ Mux video + audio tracks
      │  └─ Write file to disk
      └─ Export complete
```

## Component Hierarchy

### Launch Window (HUD Overlay)

```
LaunchWindow (Main HUD component)
├── useMediaDevices Hook (device enumeration)
├── useMicrophoneCapture Hook (audio level metering)
├── useSelectedSource Hook (source name display)
├── useRecordingTimer Hook (elapsed time display)
├── useCameraOverlay Hook (camera window management)
│
├── RecordButton + Status Display
│   ├── Recording timer (MM:SS format)
│   └── Selected source name
│
├── CameraSettingsDropdown
│   ├── DeviceDropdown (base component)
│   ├── None / Camera list options
│   └── Permission request handling
│
├── MicSettingsDropdown
│   ├── DeviceDropdown (base component)
│   ├── AudioLevelMeter (header content - real-time VU meter)
│   ├── None / Microphone list options
│   └── Audio level display (0-100, dB scale)
│
└── SystemAudioToggle
    ├── Toggle button (enabled/disabled)
    └── Platform check (macOS 13.2+ required)
```

**DeviceDropdown (Base Component)**:
- Reusable dropdown for device selection
- Keyboard navigation: Arrow Up/Down, Enter/Space, Escape
- ARIA accessibility: aria-label, aria-expanded, aria-selected
- Glass morphism styling (HUD aesthetic)
- Opens upward to avoid obscuring controls
- Optional headerContent slot (e.g., audio meters)

### Video Editor

```
VideoEditor
├── VideoPlayback (PixiJS Canvas)
│   ├── FrameRenderer
│   ├── CameraPipOverlay (if camera recorded)
│   │   └── Synchronized with main video (play/pause/seek)
│   └── ZoomEffectApplier
├── TimelineEditor
│   ├── MediaTrackRow (Screen video)
│   │   ├── Label: ▶ Screen
│   │   └── Block: Blue (#3b82f6), solid color
│   ├── MediaTrackRow (Camera video) [optional]
│   │   ├── Label: 🎥 Camera
│   │   └── Block: Purple (#8b5cf6), solid color
│   ├── MediaTrackRow (Microphone audio) [optional]
│   │   ├── Label: 🎤 Microphone
│   │   └── Block: Green (#22c55e), gradient waveform pattern
│   ├── MediaTrackRow (System audio) [optional]
│   │   ├── Label: 🔊 System Audio
│   │   └── Block: Amber (#f59e0b), gradient waveform pattern
│   └── ZoomRegionEditor (existing zoom regions)
└── SettingsPanel (Tabs: General, Export, Annotations)
    ├── CameraPipSettings (if camera recorded)
    │   ├── EnableToggle
    │   ├── PositionSelector
    │   ├── SizeSelector
    │   ├── ShapeSelector (4 shapes: rounded-rectangle, rectangle, square, circle)
    │   └── BorderRadiusSlider (only shown for rounded-rectangle shape)
    ├── CropControl
    ├── AnnotationSettingsPanel
    ├── VideoSettings
    │   ├── ShadowIntensity
    │   ├── BlurToggle
    │   ├── MotionBlurToggle
    │   ├── BorderRadiusControl
    │   └── PaddingControl
    └── ExportSettings
        ├── FormatSelector
        ├── QualityControl
        ├── GifSettings
        └── FilenameInput
```

## Multi-Track Timeline Architecture (Phase 06)

See dedicated documentation: [Timeline & Multi-Track Architecture](./timeline-architecture.md)

Covers:
- Track display system with responsive layout
- MediaTrack type system and interfaces
- Visual design (color scheme, icons, waveform visualization)
- File path resolution pattern
- Track loading process
- Component integration
- Audio waveform MVP implementation
- Security considerations
- Performance notes

## Export Compositing Architecture

### Camera PiP Export Pipeline

```
VideoExporter / GifExporter
│
├─ Initialize FrameRenderer
│  └─ Passes cameraExportConfig if camera video present
│
├─ FrameRenderer processes each frame
│  │
│  ├─ Decode video frame from source
│  ├─ Render effects (zoom, crop, blur, shadow)
│  ├─ Render annotations
│  │
│  └─ If Camera PiP enabled:
│     │
│     ├─ CameraPipRenderer.render(ctx, canvasWidth, canvasHeight, timeMs)
│     │  ├─ Seek camera video to current time
│     │  ├─ Extract camera frame to offscreen canvas
│     │  ├─ Calculate PiP position (based on corner setting)
│     │  │  ├─ Apply 2% margin from edge
│     │  │  └─ Size from preset percentage (15%, 22%, 30%)
│     │  ├─ Create clipping path (rounded rectangle for border radius)
│     │  ├─ Draw camera frame mirrored (natural camera orientation)
│     │  └─ Draw semi-transparent white border (3px)
│     │
│     └─ Graceful handling if camera video ends early
│        └─ Stop rendering PiP for remaining frames
│
├─ Mux final frames with audio tracks
└─ Write output file (MP4 or GIF)
```

### CameraPipRenderer Class

**Location**: `src/lib/exporter/camera-pip-renderer.ts` (173 lines)

**Public Methods**:
- `constructor(config: CameraExportConfig)` - Initialize with camera video URL and PiP settings
- `async initialize(): Promise<boolean>` - Load camera video, prepare offscreen canvas. Returns success status.
- `isReady(): boolean` - Check if renderer can process frames
- `getDuration(): number` - Get camera video duration (seconds)
- `async render(ctx, canvasWidth, canvasHeight, timeMs): Promise<void>` - Composite PiP onto frame at time
- `destroy(): void` - Cleanup resources (video element, canvas)

**Private State**:
- `cameraVideo: HTMLVideoElement | null` - Loaded camera video
- `cameraCanvas: HTMLCanvasElement | null` - Offscreen canvas for frame extraction
- `cameraCtx: CanvasRenderingContext2D | null` - 2D context for drawing
- `config: CameraExportConfig` - Configuration (video URL, PiP settings)

**Rendering Details**:
- Time sync: Seeks camera to `timeMs / 1000` before rendering
- Position calculation: Corner-based placement with dynamic margins (2% of canvas width)
- Shape support: 4 configurable shapes via `getShapeParams()` helper
  - `rounded-rectangle`: Original aspect ratio, configurable border radius (0-50%)
  - `rectangle`: Original aspect ratio, no rounding
  - `square`: 1:1 aspect (center-cropped), no rounding
  - `circle`: 1:1 aspect (center-cropped), 50% rounding for full circle
- Center-crop: Applied for square/circle shapes to maintain 1:1 aspect ratio
- Clipping: Uses `roundRect()` with calculated radius based on shape
- Mirroring: Applied via `scale(-1, 1)` transform for natural appearance
- Border: White semi-transparent stroke (rgba 255,255,255,0.2), 3px width
- Early termination: Stops rendering if camera duration exceeded

### Integration Points

**In FrameRenderer**:
- Instantiated if `config.cameraExport` provided
- Called during frame render loop: `await cameraPipRenderer.render(...)`
- Cleanup in destroy: `cameraPipRenderer?.destroy()`

**In VideoExporter/GifExporter**:
- Config props: `cameraVideoUrl`, `cameraPipConfig`
- Passed to FrameRenderer as `cameraExport: CameraExportConfig`

**Type System**:
```typescript
interface CameraExportConfig {
  videoUrl: string;           // Path to camera video file
  pipConfig: CameraPipConfig;  // Position, size, border radius
}

// From types.ts (reused from editor)
interface CameraPipConfig {
  enabled: boolean;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  size: 'small' | 'medium' | 'large';
  shape: 'rounded-rectangle' | 'rectangle' | 'square' | 'circle';
  borderRadius: number;  // 0-100%, only used for rounded-rectangle
}
```

## Media Device Infrastructure

### Device Enumeration

```
useMediaDevices Hook
│
├─ Initial Load (useEffect)
│  ├─ Call navigator.mediaDevices.enumerateDevices()
│  ├─ Filter by kind: 'videoinput' → cameras[]
│  ├─ Filter by kind: 'audioinput' → microphones[]
│  ├─ Restore from localStorage if available
│  └─ Validate restored IDs still exist
│
├─ Device Change Listener (useEffect)
│  ├─ addEventListener('devicechange')
│  └─ Re-enumerate on user plug/unplug
│
├─ Permission Handling
│  ├─ Check if device labels visible (indicates 'granted')
│  ├─ requestPermissions() calls getUserMedia()
│  │  ├─ Requests video: true, audio: true
│  │  ├─ Stops tracks immediately
│  │  └─ Updates permission status
│  └─ Graceful fallback if 'denied'
│
└─ Selection Validation
   ├─ setSelectedCameraId(id)
   │  ├─ Validates id exists in cameras[]
   │  ├─ Saves to localStorage
   │  └─ Warns if device not found
   └─ setSelectedMicId(id)
      ├─ Validates id exists in microphones[]
      ├─ Saves to localStorage
      └─ Warns if device not found
```

### System Audio Capture (macOS 13.2+)

```
useSystemAudioCapture Hook
│
├─ Platform Detection (on mount)
│  ├─ supportsSystemAudio() checks macOS version >= 13.2
│  └─ getSystemAudioSupportMessage() provides fallback message
│
├─ startCapture(screenSourceId)
│  │
│  ├─ Call captureSystemAudio() from audio-capture-utils
│  │  │
│  │  ├─ Request desktop capture WITH audio flag (ScreenCaptureKit)
│  │  │  └─ Minimal 1x1px video requested (only need audio)
│  │  ├─ Extract audio track from combined stream
│  │  └─ Stop dummy video track, return audio-only stream
│  │
│  ├─ Setup audio level metering (Web Audio API)
│  │  ├─ Create AudioContext
│  │  ├─ Create AnalyserNode with fftSize=2048
│  │  └─ Connect stream → analyser
│  │
│  └─ Start updateAudioLevel() animation frame loop
│
├─ startRecording()
│  ├─ Create MediaRecorder from audio stream
│  ├─ Set bitrate: 192 kbps for high quality
│  └─ Begin recording with 1 second data chunks
│
├─ stopRecording() (timeout-protected)
│  ├─ Stop MediaRecorder with 5 second timeout
│  ├─ Collect chunks into Blob
│  └─ Return audio blob for IPC storage
│
└─ stopCapture()
   ├─ Cancel animation frame loop
   ├─ Close AudioContext
   ├─ Stop all media tracks
   └─ Reset state

Audio Capture Utils Shared Module (src/lib/audio-capture-utils.ts)
│
├─ captureSystemAudio(screenSourceId)
│  └─ Extract audio from ScreenCaptureKit desktop capture
│
├─ setupAudioLevelMeter(stream)
│  └─ Create Web Audio API analyser for real-time metering
│
├─ getAudioLevel(analyser)
│  └─ Calculate FFT-based level (0-100 scale)
│
├─ cleanupAudioResources(resources)
│  └─ Safe cleanup of AudioContext and MediaStream
│
└─ stopMediaRecorderSafely(recorder, chunks, mimeType)
   └─ Stop with timeout protection (5 second default)
```

### Platform Detection

```
supportsSystemAudio()
│
└─ getMacOSVersion()
   ├─ Parse navigator.userAgent
   │  └─ Extract "Mac OS X 14_2" pattern
   ├─ Return { major: 14, minor: 2 }
   │
   └─ Compare version >= 13.2
      ├─ macOS 14.x+ → true (system audio supported)
      ├─ macOS 13.2+ → true (Ventura with ScreenCaptureKit)
      └─ Earlier versions → false

getSystemAudioSupportMessage()
│
└─ Returns user-friendly message
   ├─ macOS < 13.2: "macOS Ventura (13.2+) required for system audio"
   └─ Non-macOS: "System audio capture only supported on macOS"
```

## Storage Architecture

### localStorage Keys

| Key | Purpose | Type | Default |
|-----|---------|------|---------|
| `openscreen:selectedCameraId` | Last selected camera | string \| null | null |
| `openscreen:selectedMicId` | Last selected microphone | string \| null | null |
| `openscreen:systemAudioEnabled` | System audio preference | boolean | false |

**Lifecycle**:
- Loaded on app start by useMediaDevices hook
- Updated when user changes selection
- Validated on load (device still exists?)
- Cleared if device unplugged

## Type System

### Media Device Types

```typescript
// From navigator.mediaDevices.enumerateDevices()
interface MediaDeviceInfo {
  deviceId: string;        // Unique identifier
  groupId: string;         // Related I/O devices group
  kind: 'videoinput' | 'audioinput' | 'audiooutput';
  label: string;           // Human-readable name (requires permission)
}

// Hook return type
interface UseMediaDevicesReturn {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  selectedCameraId: string | null;
  selectedMicId: string | null;
  systemAudioEnabled: boolean;
  systemAudioSupported: boolean;
  permissionStatus: 'granted' | 'denied' | 'prompt' | 'unknown';
  isLoading: boolean;
  error: string | null;
  setSelectedCameraId(id: string | null): void;
  setSelectedMicId(id: string | null): void;
  setSystemAudioEnabled(enabled: boolean): void;
  refreshDevices(): Promise<void>;
  requestPermissions(): Promise<boolean>;
}
```

### Camera Recording Types

```typescript
// Screen recorder options with optional camera recording
interface ScreenRecorderOptions {
  sourceId: string;
  deviceIds: MediaDeviceIds;
  cameraDeviceId?: string | null;  // Optional camera device ID
  onError?: (error: Error) => void;
}

// Camera PiP overlay configuration (Phase 3)
interface CameraPipConfig {
  enabled: boolean;                    // Toggle PiP overlay on/off
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  size: 'small' | 'medium' | 'large';  // Relative to container width
  borderRadius: number;                // Percentage (0-100): 0=square, 50=circle
}

// Size presets (percentage of container width)
const CAMERA_PIP_SIZE_PRESETS = {
  small: 15,    // 15% of container width
  medium: 22,   // 22% of container width
  large: 30,    // 30% of container width
}
```

## IPC Message Protocol

### Recording Control

```
Client → Main: { type: 'START_CAPTURE', payload: { sourceId, deviceIds, cameraDeviceId? } }
Main → Client: { type: 'CAPTURE_FRAME', payload: ArrayBuffer }
Main → Client: { type: 'CAPTURE_STATUS', payload: { frame, timestamp } }
Client → Main: { type: 'STOP_CAPTURE' }
Main → Client: { type: 'CAPTURE_END', payload: { filepath, duration } }
```

### Audio Recording Storage

```
Microphone Audio:
Client → Main: { type: 'store-audio-recording', payload: { audioData: ArrayBuffer, fileName: string } }
Main → Client: { type: 'store-audio-recording-result', payload: { success: boolean, path: string } }

System Audio (macOS 13.2+ only):
Client → Main: { type: 'store-system-audio-recording', payload: { audioData: ArrayBuffer, fileName: string } }
Main → Client: { type: 'store-system-audio-recording-result', payload: { success: boolean, path: string } }

Security Measures:
- Path validation: Resolved path must be within RECORDINGS_DIR
- Filename validation: Pattern `(mic|system-audio)-\\d{13,14}\\.[a-z0-9]+`
- File size limits: 100MB max for each audio file
- Directory traversal protection with path.startsWith() check
```

### Camera Recording Storage

```
Client → Main: { type: 'store-camera-recording', payload: { videoData: ArrayBuffer, fileName: string } }
Main → Client: { type: 'store-camera-recording-result', payload: { success: boolean, path: string } }
```

### Audio/Video Path Resolution

```
Camera Video Path:
Client → Main: { type: 'get-camera-video-path', payload: mainVideoPath }
Main → Client: { type: 'get-camera-video-path-result', payload: { success: boolean, path: string | null } }

Microphone Audio Path (Phase 06):
Client → Main: { type: 'get-mic-audio-path', payload: mainVideoPath }
Main → Client: { type: 'get-mic-audio-path-result', payload: { success: boolean, path: string | null } }

System Audio Path (Phase 06):
Client → Main: { type: 'get-system-audio-path', payload: mainVideoPath }
Main → Client: { type: 'get-system-audio-path-result', payload: { success: boolean, path: string | null } }
```

**Details**:
- Pattern matching: `recording-{timestamp}.webm` → `camera|mic|system-audio-{timestamp}.webm`
- Returns null if file doesn't exist (track was not recorded)
- Used in VideoEditor.buildMediaTracks() to construct timeline tracks
- **Security**: Path validation prevents directory traversal attacks
  - Resolved path must be within RECORDINGS_DIR
  - Check: `path.startsWith(RECORDINGS_DIR + path.sep)`
  - File existence verified before returning path
  - Filename pattern validation ensures only valid audio files processed

### Export Pipeline

```
Client → Main: { type: 'EXPORT_VIDEO', payload: { format, settings } }
Main → Client: { type: 'EXPORT_PROGRESS', payload: { progress, current, total } }
Main → Client: { type: 'EXPORT_COMPLETE', payload: { filepath } }
Main → Client: { type: 'EXPORT_ERROR', payload: { message } }
```

## Error Handling

### Device Enumeration Errors

| Error | Cause | Recovery |
|-------|-------|----------|
| `NotAllowedError` | Permission denied | Show permission dialog, ask user to retry |
| `NotFoundError` | No devices present | Show message, allow retry when device plugged in |
| `TypeError` | API not available | Fall back to default device, continue |

### Validation Errors

| Error | Cause | Recovery |
|-------|-------|----------|
| Device not found | Device unplugged | Clear selection, use next available |
| Invalid device ID | Corrupted localStorage | Remove entry, use next available |

## Performance Considerations

### Media Device Enumeration
- **Cost**: ~50-100ms to enumerate devices
- **Optimization**: Debounce 'devicechange' events
- **Caching**: Keep device list in state, update on events only

### Canvas Rendering (PixiJS)
- **Target FPS**: 30-60 depending on video
- **Optimization**: Off-screen rendering, use textures for frames
- **Memory**: Cap texture cache to prevent leaks

### Export Pipeline
- **Bottleneck**: Frame encoding and audio muxing
- **Optimization**: Web Worker for frame processing
- **Memory**: Stream frames instead of loading entire video

## Security Considerations

### Media Access
- Only request permissions when user initiates action
- Request both camera and microphone together
- Stop tracks immediately after permission check
- Don't store MediaStream objects (security risk)

### Storage
- localStorage is per-origin (safe for device selection)
- Device IDs are persistent but non-sensitive
- No authentication tokens or secrets in storage

### File Operations
- All file I/O goes through main process IPC
- Validate file paths before writing
- Use safe save dialogs for user selection

## Deployment Architecture

### Build Process

```
Development:
  npm run dev
  ├─ Vite dev server (HMR)
  ├─ Electron main process with debugger
  └─ Live reload of React components

Production:
  npm run build
  ├─ TypeScript compilation (src/)
  ├─ Vite bundling (React app)
  ├─ Electron main process build
  ├─ electron-builder packaging
  │  ├─ macOS: .dmg installer
  │  ├─ Windows: .msi installer
  │  └─ Linux: AppImage
  └─ Code signing (macOS/Windows)
```

### Platform-Specific Notes

**macOS**:
- System audio capture requires macOS 13.2+ (ScreenCaptureKit)
- User agent parsing: "Mac OS X 14_2" or "Mac OS X 14.2"
- Built with electron-builder for .dmg distribution

**Windows**:
- All media APIs available
- Built with electron-builder for .msi installer

**Linux**:
- All media APIs available
- Built with electron-builder for AppImage

## Future Architecture Enhancements

1. **Multi-track Timeline** - Support stacking multiple recordings
2. **Audio Effects** - EQ, compression, normalization per track
3. **Video Effects** - Filters, blur, text overlays
4. **Keyboard Shortcuts** - Full keyboard navigation
5. **Plugin System** - Third-party filters and effects
