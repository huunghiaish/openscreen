# OpenScreen Codebase Summary

## Project Overview

OpenScreen is a free, open-source screen recording and video editing desktop application built with Electron, React, TypeScript, Vite, and PixiJS. It serves as a modern alternative to Screen Studio with cross-platform support.

**Repository**: Multi-window Electron app with React renderer and TypeScript throughout.

## Architecture Overview

### Technology Stack
- **Desktop Framework**: Electron 30+
- **UI Framework**: React 18+ with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS + Radix UI components
- **Canvas Rendering**: PixiJS for video playback
- **Video Processing**: mediabunny, mp4box, gif.js
- **Testing**: Vitest
- **Package Management**: npm

### Multi-Window Architecture

The application uses multiple Electron windows coordinated via IPC messages, routed using `?windowType=` query parameters in `src/App.tsx`:

| Window Type | Component | Purpose |
|------------|-----------|---------|
| `hud-overlay` | `LaunchWindow.tsx` | Floating recording controls and status display |
| `source-selector` | `SourceSelector.tsx` | Screen/window/app picker dialog |
| `editor` | `VideoEditor.tsx` | Main video editing interface |

### Core Directory Structure

```
openscreen/
├── electron/                    # Electron main process
│   ├── main.ts                 # App entry, window management, tray
│   ├── windows.ts              # Window factory functions
│   ├── preload.ts              # IPC bridge - exposes window.electronAPI
│   ├── ipc/handlers.ts         # IPC handlers for file operations and exports
│   └── electron-env.d.ts       # Type definitions
├── src/
│   ├── components/
│   │   ├── launch/             # HUD overlay and source selector
│   │   ├── video-editor/       # Main editing interface
│   │   │   ├── timeline/       # Timeline editor with zoom regions
│   │   │   ├── videoPlayback/  # Video rendering with PixiJS
│   │   │   └── settings/       # Editor settings panels
│   │   └── ui/                 # Radix UI based components
│   ├── hooks/                  # React hooks
│   │   ├── use-media-devices.ts    # Camera/mic enumeration
│   │   └── useScreenRecorder.ts    # Recording state management
│   ├── lib/
│   │   ├── exporter/           # Video/GIF export pipeline
│   │   ├── platform-utils.ts   # Platform detection (macOS versions)
│   │   └── utils.ts            # General utilities
│   ├── types/
│   │   ├── media-devices.ts    # Device enumeration types
│   │   └── index.ts            # Global type exports
│   ├── App.tsx                 # Window router
│   └── vite-env.d.ts           # Vite environment types
├── public/                      # Static assets
└── package.json                # Dependencies and scripts

```

## Key Modules

### Media Device Management

**Files**:
- `src/types/media-devices.ts` - TypeScript interfaces
- `src/hooks/use-media-devices.ts` - React hook
- `src/lib/platform-utils.ts` - Platform detection

**Hook API**:
```typescript
const {
  cameras,              // MediaDeviceInfo[]
  microphones,          // MediaDeviceInfo[]
  selectedCameraId,     // string | null
  selectedMicId,        // string | null
  systemAudioEnabled,   // boolean
  systemAudioSupported, // boolean (macOS 13.2+)
  permissionStatus,     // 'granted' | 'denied' | 'prompt' | 'unknown'
  isLoading,           // boolean
  error,               // string | null
  setSelectedCameraId,    // (id: string | null) => void
  setSelectedMicId,       // (id: string | null) => void
  setSystemAudioEnabled,  // (enabled: boolean) => void
  refreshDevices,         // () => Promise<void>
  requestPermissions,     // () => Promise<boolean>
} = useMediaDevices();
```

**Features**:
- Enumerate available cameras and microphones using `navigator.mediaDevices`
- Detect device connect/disconnect events and refresh automatically
- Persist device selection to localStorage with keys: `openscreen:selectedCameraId`, `openscreen:selectedMicId`, `openscreen:systemAudioEnabled`
- Validate device IDs on selection (warn if device unplugged)
- Request camera/mic permissions with fallback handling
- macOS 13.2+ detection for system audio support via user agent parsing

### System Audio Capture

**Files**:
- `src/lib/audio-capture-utils.ts` - Shared utilities for system and microphone audio capture
- `src/hooks/use-system-audio-capture.ts` - System audio capture with Web Audio API (macOS 13.2+)
- `src/lib/platform-utils.ts` - Platform detection (macOS version, system audio support)

**Hook API**:
```typescript
const {
  supported,            // boolean - macOS 13.2+ required
  unsupportedMessage,   // string | null - reason if not supported
  stream,              // MediaStream | null - active audio stream
  recording,           // boolean - recording state
  audioLevel,          // number (0-100) - real-time audio level
  error,              // string | null - capture errors
  startCapture,       // (screenSourceId: string) => Promise<boolean>
  stopCapture,        // () => void
  startRecording,     // () => void
  stopRecording,      // () => Promise<Blob | null>
} = useSystemAudioCapture();
```

**Features**:
- ScreenCaptureKit-based audio extraction (macOS 13.2+ Ventura)
- Desktop audio capture via desktop media source
- Real-time audio level metering (FFT analysis)
- Safe resource cleanup (AudioContext, MediaStream)
- Timeout-protected recording stop (5 second default)
- Platform detection with user-friendly messages
- Graceful degradation on unsupported platforms

### Microphone Capture

**Files**:
- `src/hooks/use-microphone-capture.ts` - Microphone audio capture with Web Audio API level metering
- `src/components/audio-level-meter.tsx` - VU meter component for real-time audio visualization
- `src/lib/recording-constants.ts` - Centralized recording configuration constants
- `src/lib/audio-capture-utils.ts` - Shared utilities for audio capture (also used for system audio)

**Hook API**:
```typescript
const {
  isCapturing,         // boolean - capture state
  audioLevel,          // number (0-100) - current audio level
  peakLevel,          // number (0-100) - peak audio level since start
  error,              // string | null - capture errors
  startCapture,       // (deviceId: string) => Promise<void>
  stopCapture,        // () => Promise<void>
  resetMeters,        // () => void
} = useMicrophoneCapture();
```

**Features**:
- Audio level metering via AnalyserNode (FFT analysis)
- Automatic echo cancellation, noise suppression, auto gain control
- Graceful degradation if constraints unsupported by browser
- Real-time peak level tracking for VU meter visualization
- Clean resource cleanup on component unmount

**VU Meter Component**:
- Needle-based analog meter (0-100 scale)
- Responsive SVG design with animated needle
- dB scale labels for professional audio metering
- Updates every audioprocess event (~50ms)

### Video Editor

**Location**: `src/components/video-editor/`

**Key Components**:
- `VideoEditor.tsx` - Main editor interface and layout
- `VideoPlayback.tsx` - PixiJS canvas rendering with zoom/pan
- `SettingsPanel.tsx` - Recording and export settings
- `timeline/TimelineEditor.tsx` - Drag-and-drop timeline with zoom regions

**Features**:
- Play, pause, scrub through recorded video
- **Multi-track timeline display** (Phase 06):
  - Screen video track (always present, blue #3b82f6)
  - Camera video track (if recorded, purple #8b5cf6)
  - Microphone audio track (if recorded, green #22c55e)
  - System audio track (if recorded on macOS 13.2+, amber #f59e0b)
  - Audio waveform visualization (MVP gradient pattern)
  - Track labels with icons (▶ 🎥 🎤 🔊)
- Timeline editing with zoom regions and annotations
- Real-time preview of edits
- Settings panel for video/GIF export configuration

### Timeline Module (Phase 06)

**Location**: `src/components/video-editor/timeline/`

**Key Files**:
- `TimelineEditor.tsx` - Main timeline container with dnd-timeline integration
- `media-track-row.tsx` - Individual media track row rendering
- `types.ts` - MediaTrack type definitions and constants

**Type System**:
- `MediaTrack` interface: id, type, label, filePath, startMs, endMs, muted, volume
- `MediaTrackType`: 'screen' | 'camera' | 'mic' | 'system-audio'
- Constants: `MEDIA_TRACK_COLORS`, `MEDIA_TRACK_ICONS`, `MEDIA_TRACK_ROW_IDS`

**Features**:
- Multi-track display with color-coded blocks by track type
- Track labels with emoji icons in left sidebar (80px fixed width)
- Audio waveform visualization via repeating gradient pattern (MVP)
- Muted state reduces track opacity to 0.3
- Each track row: 40px height (28px item + margins)
- Video tracks: solid color, Audio tracks: gradient pattern

### Export Pipeline

**Location**: `src/lib/exporter/`

**Core Modules**:
- `FrameSource` - Abstraction layer (Phase 4 - NEW)
  - `frame-source.ts` - Interface, types, factory function
  - `webcodecs-frame-source.ts` - WebCodecs implementation (~5ms/frame)
  - `htmlvideo-frame-source.ts` - HTMLVideoElement fallback (~100ms/frame)
  - `trim-time-mapper.ts` - Time mapping utility for trim regions
- `VideoDemuxer` - Container demuxing and frame extraction (Phase 1)
- `VideoDecoderService` - WebCodecs decoding with backpressure (Phase 2)
- `DecodedFrameBuffer` - Memory-bounded frame buffer (Phase 3)
- `VideoExporter` - MP4 export with mediabunny and mp4box
- `GifExporter` - Animated GIF export with gif.js
- Frame rendering utilities for image-based exports
- Parallel rendering with Web Workers (Phase 2)
- Audio decoders for microphone and system audio mixing

**FrameSource Abstraction** (NEW - Phase 4):
- Files:
  - `frame-source.ts` (149 lines) - Interface, config, factory
  - `webcodecs-frame-source.ts` (338 lines) - Fast implementation
  - `htmlvideo-frame-source.ts` (144 lines) - Fallback implementation
  - `trim-time-mapper.ts` (109 lines) - Time conversion utility
- Purpose: Unified frame extraction API with automatic WebCodecs/HTMLVideo selection
- Interface:
  - `initialize()` - Setup and return video metadata
  - `getFrame(frameIndex, effectiveTimeMs)` - Get frame at index
  - `getStats()` - Performance metrics
  - `destroy()` - Cleanup resources
- Factory:
  - `createFrameSource(config)` - Auto-select best implementation
  - Returns `{ source, result: FrameSourceResult }`
- WebCodecs path:
  - Pipeline: VideoDemuxer → VideoDecoderService → DecodedFrameBuffer
  - Decode-ahead loop for proactive frame buffering
  - Backpressure management via frame waiters
  - Performance: <5ms per frame average
- HTMLVideo fallback:
  - Wraps existing `PrefetchManager`
  - VideoFrame creation from video element
  - Performance: ~100-140ms per frame
- TrimTimeMapper:
  - Converts effective time (no trims) ↔ source time (original timeline)
  - Methods: `mapEffectiveToSourceTime()`, `getEffectiveDuration()`
  - Used by both FrameSource implementations

**Video Demuxer** (Phase 1):
- Class: `VideoDemuxer` wraps mediabunny for container format handling
- Supports: MP4, WebM, Matroska, QuickTime containers
- Key methods:
  - `initialize()` - Load video, extract metadata and decoder config
  - `getChunksFromTimestamp()` - Async iterator yielding EncodedVideoChunks
  - `seekToKeyframe()` - Find nearest keyframe at/before timestamp
  - `getDecoderConfig()` - Get VideoDecoderConfig for WebCodecs
  - `destroy()` - Clean up mediabunny resources
- Factory: `createDemuxerFromBlob()` - Create demuxer from File/Blob with auto URL revocation
- Returns metadata: width, height, duration, fps, frameCount
- Tested: 313-line test suite with mock mediabunny

**Video Decoder Service** (NEW - Phase 2):
- Class: `VideoDecoderService` wraps WebCodecs VideoDecoder with backpressure
- Hardware-accelerated video decoding (VideoToolbox on macOS, MediaFoundation on Windows)
- Key methods:
  - `configure()` - Setup decoder with VideoDecoderConfig from demuxer
  - `decode()` - Submit EncodedVideoChunk with automatic backpressure
  - `waitForSpace()` - Promise-based backpressure (waits for dequeue event if queue full)
  - `canAcceptChunk()` - Check if queue has space (< maxQueueSize)
  - `flush()` - Drain pending frames after all chunks submitted
  - `getStats()` - Performance metrics (frames decoded, average decode time, hardware acceleration detection)
- Configuration: maxQueueSize (default: 8), debug logging
- Backpressure prevention: Monitors `decodeQueueSize` to prevent memory exhaustion
- Frame callback delivers decoded VideoFrames in presentation order

**Decoded Frame Buffer** (NEW - Phase 3):
- Class: `DecodedFrameBuffer` memory-bounded buffer for decoded VideoFrames
- Buffers frames between VideoDecoderService output and worker consumption
- Key methods:
  - `addFrame()` - Add decoded frame (evicts oldest if buffer full)
  - `consumeFrame(frameIndex)` - Get and remove frame by index from buffer
  - `getFrame(frameIndex)` - Non-destructive frame lookup
  - `waitForSpace()` - Backpressure for producer when buffer full
  - `getStats()` - Buffer metrics (size, added/consumed/evicted counts, bounds)
- Configuration: maxFrames (default: 16), frameRate (required), timestampTolerance (µs)
- Frame index conversion: Converts frame sequence number to timestamp using frame rate
- Memory management: FIFO eviction with GPU memory cleanup via `frame.close()`
- VFR support: Configurable timestamp tolerance for Variable Frame Rate content
- 34 unit tests covering lookup, consumption, eviction, backpressure

**Formats Supported**:
- MP4 (H.264 video codec, AAC audio)
- GIF (animated, adjustable frame rate and size)
- Image sequence (PNG frames)

### Launch/Capture Interface

**Location**: `src/components/launch/`

**Components**:
- `LaunchWindow.tsx` - Floating HUD with record/stop controls, device selection
- `SourceSelector.tsx` - Screen/window/app picker with preview

### UI Components

**Location**: `src/components/ui/`

Built on Radix UI + Tailwind CSS. Includes:
- Buttons, inputs, dropdowns, dialogs
- Settings panels with form controls
- Timeline-related UI components

## Data Flow

### Recording Session
```
1. User opens app → HUD window appears
2. User selects camera/mic/system audio in device selector
3. Devices persisted to localStorage
4. User selects source (screen/window)
5. Click record → Multi-track capture starts:
   - Screen video → recording-{timestamp}.webm
   - Camera video → camera-{timestamp}.webm (if enabled)
   - Microphone audio → mic-{timestamp}.webm (if enabled)
   - System audio → embedded in main recording (if enabled)
6. Recording data flows to renderer via IPC with secure storage
7. User clicks stop → Editor window opens with video + audio tracks
```

### Video Editing
```
1. Video loaded in VideoEditor component
2. PixiJS canvas renders frames with applied effects
3. Timeline shows audio tracks and edits
4. User exports → ExportPipeline processes frames + audio
5. Final file written to disk via IPC
```

## IPC Message Flow

**Main Process to Renderer**:
- `CAPTURE_FRAME` - Video frame data
- `CAPTURE_END` - Recording complete
- `ERROR` - Capture errors

**Renderer to Main Process**:
- `START_CAPTURE` - Begin recording
- `STOP_CAPTURE` - End recording
- `EXPORT_VIDEO` - Start export with settings
- `SELECT_OUTPUT_PATH` - File save dialog
- `GET_PLATFORM` - Query macOS version for feature detection
- `get-camera-video-path` - Resolve camera video file from recording timestamp
- `get-mic-audio-path` (Phase 06) - Resolve microphone audio file from recording timestamp
- `get-system-audio-path` (Phase 06) - Resolve system audio file from recording timestamp
- `store-camera-recording` - Save camera WebM file with path validation
- `store-audio-recording` - Save microphone audio WebM file with security checks
- `store-system-audio-recording` - Save system audio WebM file with security checks

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `electron` | Desktop app framework |
| `react`, `react-dom` | UI framework |
| `typescript` | Static type checking |
| `vite` | Build and dev server |
| `tailwindcss` | Utility CSS framework |
| `@radix-ui/*` | Headless UI components |
| `pixijs` | Canvas rendering for video |
| `mediabunny` | Video codec processing |
| `mp4box.js` | MP4 muxing |
| `gif.js` | GIF encoding |
| `dnd-timeline` | Drag-and-drop timeline |

## Build & Development Commands

```bash
npm run dev              # Start dev server with hot reload
npm run build            # Full TypeScript + Vite + electron-builder build
npm run build:mac        # macOS build
npm run build:win        # Windows build
npm run build:linux      # Linux build
npm run lint             # ESLint check
npm run test             # Run tests once
npm run test:watch       # Watch mode tests
```

## Path Aliases

`@/` maps to `src/` (configured in `vite.config.ts`)

## Recent Changes (as of 2026-01-17)

**Phase 04: Frame Source Integration (WebCodecs)** (COMPLETE)
- New `FrameSource` abstraction layer for unified frame extraction
  - `frame-source.ts` (149 lines) - Interface, config types, factory function
  - `webcodecs-frame-source.ts` (338 lines) - WebCodecs VideoDecoder implementation
  - `htmlvideo-frame-source.ts` (144 lines) - HTMLVideoElement fallback
  - `trim-time-mapper.ts` (109 lines) - Time mapping utility for trim regions
- Features:
  - Automatic selection: tries WebCodecs first, falls back to HTMLVideo if unsupported
  - Unified `FrameSource` interface with `getFrame()`, `initialize()`, `destroy()`, `getStats()`
  - WebCodecs pipeline: VideoDemuxer → VideoDecoderService → DecodedFrameBuffer
  - Proactive decode-ahead loop with frame waiter notification system
  - Trim region handling via TrimTimeMapper (converts effective ↔ source time)
  - VideoFrame ownership contract: caller responsible for `frame.close()`
  - Performance: <5ms per frame (WebCodecs) vs ~100ms (HTMLVideo fallback)
- Integration in `VideoExporter`:
  - Uses `createFrameSource()` factory during export initialization
  - Automatically handles mode detection and metrics collection
  - Passes frames to RenderCoordinator or FrameRenderer
  - Cleanup via `frameSource.destroy()` on export completion
- Statistics:
  - Frames retrieved, average/peak retrieval times
  - Mode-specific stats (decoder, buffer, or prefetch metrics)

**Phase 05: HUD UI Device Selectors** (COMPLETE)
- New `device-dropdown.tsx` reusable dropdown component (246 lines)
  - Base component for camera/microphone selection with ARIA accessibility
  - Keyboard navigation: Arrow keys, Enter/Space, Escape to close
  - Glass morphism styling, opens upward to avoid obscuring controls
  - Optional header content slot for additional UI (audio meters, status)
- New `camera-settings-dropdown.tsx` camera device selector (106 lines)
  - Specialized dropdown with None option for disabling camera
  - Permission request on first selection
  - Integrates with useMediaDevices for device enumeration
- New `mic-settings-dropdown.tsx` microphone device selector (52 lines)
  - Audio level meter header showing real-time input (0-100 scale, dB units)
  - Displays visual VU meter during microphone selection
- New `system-audio-toggle.tsx` system audio toggle component (54 lines)
  - Platform detection with disabled state for non-macOS systems
  - Tooltip explaining macOS 13.2+ requirement
- New `use-camera-overlay.ts` hook (101 lines)
  - Manages camera overlay window visibility based on recording/preview state
  - Shows overlay: recording with camera+preview OR preview enabled (idle)
  - Hides overlay: recording stops, preview disabled, or camera deselected
  - Safe Electron API access with runtime validation
- New `use-recording-timer.ts` hook (52 lines)
  - Tracks recording elapsed time (seconds) and formatted display (MM:SS)
  - Auto-resets on recording stop
- New `use-selected-source.ts` hook (61 lines)
  - Polls Electron API for selected capture source (screen/window)
  - Returns sourceName and hasSelectedSource boolean
  - 500ms polling interval for state sync
- Updated `LaunchWindow.tsx` component integration
  - Integrated all new dropdowns and toggles
  - Uses new hooks for overlay, timer, and source management
  - Camera position/size state (defaults: bottom-right, medium)
  - Microphone capture lifecycle management (start/stop on selection)

**Phase 04: System Audio Capture** (COMPLETE)
- New `audio-capture-utils.ts` shared utility module (169 lines)
  - `captureSystemAudio()`: Extracts audio track from ScreenCaptureKit desktop capture (macOS 13.2+ only)
  - `setupAudioLevelMeter()`: Creates Web Audio API analyser for real-time level metering
  - `cleanupAudioResources()`: Safe resource cleanup (AudioContext, MediaStream tracks)
  - `getAudioLevel()`: FFT-based audio level calculation (0-100 scale)
  - `stopMediaRecorderSafely()`: Timeout-protected MediaRecorder stop with race condition handling
  - Bitrate constant: `SYSTEM_AUDIO_BITRATE = 192 kbps` for higher quality desktop audio
- New `use-system-audio-capture.ts` hook (186 lines)
  - `captureSystemAudio()`: Initializes desktop audio capture from screen source
  - `startRecording()`: Begin recording system audio stream
  - `stopRecording()`: Stop recording with safe blob creation
  - Platform detection with user-friendly error messages
  - Real-time audio level metering for VU meter display
  - Automatic resource cleanup on component unmount
- Enhanced `electron/ipc/handlers.ts` audio storage
  - New `store-system-audio-recording` IPC handler for secure system audio file storage
  - Filename validation regex updated: `(recording|camera|mic|system-audio)-\\d{13,14}\\.[a-z0-9]+`
  - File size limit: 100MB max for system audio recordings
- Platform detection improvements
  - `supportsSystemAudio()` returns true for macOS 13.2+ (Ventura with ScreenCaptureKit)
  - `getSystemAudioSupportMessage()` provides user-friendly explanations for unsupported platforms
  - Graceful degradation: returns null for system audio on non-supported platforms

**Phase 03: Microphone Recording** (COMPLETE)
- New `use-microphone-capture.ts` hook for microphone capture with Web Audio API
  - Real-time audio level metering (0-100 scale) using analyser node
  - Automatic echo cancellation, noise suppression, and auto gain control
  - Graceful error handling with null return on permission denial
  - Updates peak level on every audioprocess event
- New `audio-level-meter.tsx` component for VU meter visualization
  - Real-time audio level display with animated SVG needle
  - Zero-to-peak level indicator with responsive design
  - Audio unit labels (dB) for professional metering
- New `recording-constants.ts` centralized recording constants
  - Recording codec (Opus), bitrate (128 kbps), frame rate (30 fps)
  - File size limits: video 5GB, camera 500MB, audio 100MB, system audio 100MB
  - Filename validation regex: `(recording|camera|mic|system-audio)-\\d{13,14}\\.[a-z0-9]+`
- Enhanced `useScreenRecorder.ts` integration
  - Microphone capture integrated with screen recording
  - Separate mic audio track in editor alongside screen/camera audio
  - Unified recording options with microphone device selection
- Enhanced `electron/ipc/handlers.ts` security
  - New `store-audio-recording` IPC handler for secure audio file storage
  - Path traversal protection with resolved path validation
  - Strict filename validation against regex pattern
  - File size limit enforcement (100MB max for audio)
  - Error handling with descriptive messages for debugging

**Phase 04: Export Compositing - Camera PiP** (COMPLETE)
- New `CameraPipRenderer` class (173 lines) in `src/lib/exporter/camera-pip-renderer.ts`
  - Handles camera video loading, frame extraction, and compositing for MP4/GIF export
  - `initialize()`: Loads camera video metadata, creates offscreen canvas for frame extraction
  - `render()`: Composites camera PiP overlay onto export frames at specified time
  - `getDuration()`: Returns camera video duration for sync validation
  - `destroy()`: Cleanup of video element and canvas resources
- New `CameraExportConfig` interface in types.ts
  - `videoUrl: string` - Path to camera video file
  - `pipConfig: CameraPipConfig` - Overlay position/size/border radius settings
- Integration in `FrameRenderer` for frame-level compositing
  - Instantiated with `CameraExportConfig` if camera video present
  - Called during frame rendering with current playback time
- Integration in `VideoExporter` and `GifExporter`
  - Props: `cameraVideoUrl`, `cameraPipConfig` in config
  - Passed to FrameRenderer for export pipeline
- Features:
  - Position: all 4 corners (top-left, top-right, bottom-left, bottom-right)
  - Size: 3 presets (15%, 22%, 30% of export canvas width)
  - Border radius: 0-100% for square to fully circular overlay
  - Horizontal mirror: camera displayed in natural mirror orientation
  - Border: semi-transparent white (rgba 255,255,255,0.2) with 3px width
  - Graceful handling when camera video ends before main video
  - 2% margin from edge, responsive positioning based on export resolution

**Phase 05: Settings Controls** (COMPLETE)
- New `CameraPipSettings.tsx` component in SettingsPanel
- UI controls: toggle, position grid (2x2), size buttons (S/M/L)
- VideoEditor state management for cameraPipConfig
- Type-safe configuration updates

**Phase 03: PiP Overlay Preview** (COMPLETE)
- CameraPipOverlay component for real-time playback preview
- Synchronized with main video (play/pause/seek)
- Responsive corner positioning, circular/rounded styling

**Phase 02: Camera Video Loading** (COMPLETE)
- IPC handler `get-camera-video-path` with path validation
- Pattern matching: `recording-{timestamp}.webm` → `camera-{timestamp}.webm`
- VideoEditor loads camera video path

**Phase 01: Media Device Infrastructure** (COMPLETE)
- useMediaDevices hook for camera/mic enumeration
- localStorage persistence, device validation, auto-refresh on plug/unplug

## File Metrics

**Total Files**: 105 (excluding node_modules)
**Total Code Tokens**: ~262K
**Largest Files**: `release-manifest.json`, `TimelineEditor.tsx`, `SettingsPanel.tsx`

## Next Steps

All HUD and recording phases complete. Upcoming work:
- Timeline multi-track support (audio synchronization)
- Advanced audio effects (normalization, EQ, compression)
- Export optimization (performance improvements)
- Plugin system for third-party filters
