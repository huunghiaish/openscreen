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

## Export Pipeline Architecture

### Phase 4: Frame Source Abstraction (NEW)

**Purpose**: Unified interface for frame extraction with automatic WebCodecs/HTMLVideo selection and trim region handling.

**FrameSource Interface** (`src/lib/exporter/frame-source.ts`, 149 lines):
- Abstraction enabling seamless switching between WebCodecs and HTMLVideoElement backends
- Automatic fallback: tries WebCodecs first, falls back if unsupported or initialization fails
- Built-in trim region mapping via `TrimTimeMapper`
- VideoFrame ownership contract: caller owns frames, must call `close()` to release GPU memory

**Key Types**:
```typescript
interface FrameSourceConfig {
  videoUrl: string;
  frameRate: number;
  trimRegions?: TrimRegion[];
  debug?: boolean;
}

interface FrameSourceResult {
  width: number;
  height: number;
  duration: number;  // Effective duration (excluding trims)
  mode: 'webcodecs' | 'htmlvideo';
}

interface FrameSource {
  initialize(): Promise<FrameSourceResult>
  getFrame(frameIndex, effectiveTimeMs): Promise<VideoFrame>
  destroy(): void
  getStats(): FrameSourceStats
}
```

**Factory Function**:
```typescript
const { source, result } = await createFrameSource(config);
// Returns WebCodecsFrameSource if available, else HTMLVideoFrameSource
```

**WebCodecsFrameSource** (`src/lib/exporter/webcodecs-frame-source.ts`, 338 lines):
- High-performance implementation (~5ms per frame)
- Pipeline: VideoDemuxer → VideoDecoderService → DecodedFrameBuffer
- Features:
  - Proactive decode-ahead loop with backpressure management
  - Trim time mapping via `TrimTimeMapper`
  - Frame index-based waiter notification system
  - Frame availability detection with error propagation
  - Statistics: frames retrieved, average/peak retrieval times

**HTMLVideoFrameSource** (`src/lib/exporter/htmlvideo-frame-source.ts`, 144 lines):
- Fallback implementation (~100-140ms per frame)
- Wraps `PrefetchManager` with `FrameSource` interface
- Maintains compatibility with existing export pipeline
- VideoFrame creation from HTMLVideoElement
- Same statistics tracking as WebCodecs path

**TrimTimeMapper Utility** (`src/lib/exporter/trim-time-mapper.ts`, 109 lines):
- Converts between effective time (excluding trims) and source time (original timeline)
- Used by both FrameSource implementations
- Methods:
  - `mapEffectiveToSourceTime()` - Timeline offset accounting for trims
  - `getEffectiveDuration()` - Duration with trims excluded
  - `getTotalTrimDurationMs/Sec()` - Trim metadata
  - `hasTrims()`, `getTrimCount()` - State queries

**Integration in VideoExporter**:
- Creates FrameSource during export initialization
- Passes to RenderCoordinator or FrameRenderer
- Receives VideoFrames with automatic trim mapping
- Destroys source on export cleanup

### Phase 1: Video Demuxer (NEW)

The export pipeline now includes a dedicated video demuxer for efficient frame extraction:

**VideoDemuxer Class** (`src/lib/exporter/video-demuxer.ts`, 320 LOC)
- Wraps mediabunny library for container format handling
- Supports MP4, WebM, Matroska, QuickTime containers
- Key responsibilities:
  1. **Initialization**: Load video file, extract codec metadata, validate with WebCodecs API
  2. **Frame Extraction**: Async iterator interface yields EncodedVideoChunks in decode order
  3. **Keyframe Seeking**: Locate nearest keyframe at/before requested timestamp
  4. **Memory Management**: Async generators prevent full-file buffering
  5. **Resource Cleanup**: Proper disposal of mediabunny Input and URL resources

**Public API**:
```typescript
class VideoDemuxer {
  async initialize(): Promise<DemuxerResult>
  async *getChunksFromTimestamp(startTime, endTime): AsyncGenerator<EncodedVideoChunk>
  async seekToKeyframe(timestamp): Promise<number | null>
  getDecoderConfig(): VideoDecoderConfig | null
  isInitialized(): boolean
  destroy(): void
}

// Factory for Blob/File inputs
async function createDemuxerFromBlob(blob): Promise<{ demuxer, result }>
```

**DemuxerResult Metadata**:
- `config: VideoDecoderConfig` - Codec info (for WebCodecs setup)
- `width, height: number` - Video dimensions
- `duration: number` - Total duration in seconds
- `frameCount, fps: number` - Estimated frame metrics

**Integration Points**:
- Used by VideoExporter for reading source video frames
- Provides EncodedVideoChunk stream for WebCodecs VideoDecoder
- Supports trim region time mapping via PrefetchManager
- Factory function handles Blob→URL lifecycle management

**Testing** (313 LOC):
- Initialization with valid/invalid codecs
- Chunk generation and endTime boundary testing
- Keyframe seeking accuracy
- Resource cleanup (idempotent destroy, URL revocation)
- Error handling (destroyed state validation)

### Phase 2: Video Decoder Service (NEW)

**VideoDecoderService Class** (`src/lib/exporter/video-decoder-service.ts`, 337 LOC)

Hardware-accelerated video decoding using WebCodecs VideoDecoder API with automatic backpressure management.

**Key Features**:
- **Hardware Acceleration**: Automatic GPU acceleration (VideoToolbox on macOS, MediaFoundation on Windows)
- **Backpressure Management**: Monitors `decodeQueueSize` to prevent memory exhaustion and queue overflow
- **Frame Output Callback**: Decoded frames delivered in presentation order
- **Performance Monitoring**: Decode timing stats and hardware acceleration detection

**Configuration**:
```typescript
interface DecoderServiceConfig {
  maxQueueSize?: number;  // Default: 8 (threshold before backpressure applied)
  debug?: boolean;        // Enable debug logging
}
```

**Public API**:
```typescript
class VideoDecoderService {
  constructor(config?: DecoderServiceConfig)
  async configure(config: VideoDecoderConfig): Promise<boolean>
  canAcceptChunk(): boolean
  async waitForSpace(): Promise<void>
  async decode(chunk: EncodedVideoChunk): Promise<void>
  async flush(): Promise<void>
  close(): void
  async reset(): Promise<boolean>
  setFrameCallback(callback: FrameCallback): void
  getStats(): DecoderStats
  getState(): 'unconfigured' | 'configured' | 'closed'
  getLastError(): Error | null
}
```

**Usage Example**:
```typescript
const service = new VideoDecoderService({ maxQueueSize: 8 });
service.setFrameCallback((frame, timestamp) => {
  // Process frame
  frame.close(); // Must close to release GPU memory
});

await service.configure(decoderConfig);

for await (const chunk of demuxer.getChunksFromTimestamp(0)) {
  await service.decode(chunk);  // Applies backpressure automatically
}

await service.flush();
service.close();
```

**Backpressure Mechanism**:
- `canAcceptChunk()`: Returns false if `decodeQueueSize >= maxQueueSize`
- `waitForSpace()`: Returns immediately if space available, else waits for dequeue event
- `decode()`: Internally calls `waitForSpace()` before submitting chunk
- Event listener on 'dequeue' event resolves waiting promises

**Performance Statistics** (`DecoderStats`):
- `framesDecoded` - Successfully decoded frame count
- `framesDropped` - Frames dropped due to errors
- `averageDecodeTime` - Mean decode time in milliseconds
- `queueSize` - Current decode queue size
- `isHardwareAccelerated` - Estimated hardware acceleration (avg decode time <5ms with >10 frames)

**Integration Points**:
- Used by VideoExporter in Phase 2+ for decoding video frames from demuxer
- Replaces synchronous HTML5 video element seeking for performance
- Enables true hardware-accelerated export pipeline

### Phase 3: Decoded Frame Buffer (NEW)

**DecodedFrameBuffer Class** (`src/lib/exporter/decoded-frame-buffer.ts`, 488 LOC)

Memory-bounded buffer for decoded VideoFrames between VideoDecoderService output and worker consumption with frame index-based lookup.

**Key Features**:
- **Frame Storage**: Map of VideoFrames indexed by timestamp for O(1) lookup
- **Index Mapping**: Converts frame sequence numbers to timestamps using frame rate
- **Memory Bounded**: Max buffer size (default: 16 frames) with automatic eviction
- **Frame Eviction**: Oldest frames closed and removed when buffer full
- **Backpressure**: Promise-based waiting for buffer space
- **Timestamp Tolerance**: Configurable tolerance (microseconds) for VFR content handling
- **Statistics**: Tracks added, consumed, evicted frame counts and buffer bounds

**Configuration**:
```typescript
interface FrameBufferConfig {
  maxFrames?: number;        // Default: 16 (evict oldest when full)
  frameRate: number;         // Required for index→timestamp conversion
  timestampTolerance?: number;  // Default: half frame duration (µs)
  debug?: boolean;           // Enable debug logging
}
```

**Public API**:
```typescript
class DecodedFrameBuffer {
  // Producer methods (from VideoDecoderService callback)
  addFrame(frame: VideoFrame): void
  isFull(): boolean
  async waitForSpace(): Promise<void>

  // Consumer methods (from workers requesting frames)
  hasFrame(frameIndex: number): boolean
  getFrame(frameIndex: number): VideoFrame | null      // Non-destructive
  consumeFrame(frameIndex: number): VideoFrame | null  // Removes from buffer

  // Lifecycle methods
  flush(): VideoFrame[]  // Return all frames without closing
  reset(): void          // Close all frames, clear state
  destroy(): void        // Final cleanup

  // Monitoring
  getStats(): BufferStats
  get size(): number
}
```

**Usage Pattern**:
```typescript
const buffer = new DecodedFrameBuffer({ frameRate: 30, maxFrames: 16 });

// Producer: decoder service adds frames
decoderService.setFrameCallback((frame) => {
  if (buffer.isFull()) {
    await buffer.waitForSpace();
  }
  buffer.addFrame(frame);
});

// Consumer: workers fetch frames by index
if (buffer.hasFrame(frameIndex)) {
  const frame = buffer.consumeFrame(frameIndex);
  await worker.render(frame);  // Zero-copy transfer
  frame.close();  // Consumer responsible for cleanup
}
```

**Memory Management**:
- **Eviction Policy**: FIFO (oldest frame first) when maxFrames exceeded
- **GPU Memory**: `frame.close()` called on evicted frames to release GPU resources
- **VFR Handling**: Timestamp tolerance parameter accommodates Variable Frame Rate content drift
  - For VFR: Recommend tolerance = 1-1.5x frame duration (e.g., 33-50ms at 30fps)
  - Default tolerance = half frame duration (handles minor timing variation)

**Integration Points**:
- Sits between VideoDecoderService output and RenderCoordinator input
- Enables decoupling of decode and render rates for pipeline flexibility
- Supports zero-copy VideoFrame transfer to workers
- Backpressure prevents decoder from outpacing worker consumption

**Testing** (34 unit tests):
- Frame addition, lookup, and consumption
- Index→timestamp conversion with tolerance
- Buffer full eviction behavior
- Backpressure waiting mechanism
- Batch operations and flush behavior
- VFR timestamp handling

### Phase 2: Parallel Rendering Workers

The export pipeline uses Web Workers for parallel frame rendering:
1. **Worker Pool** (4 workers, fixed pool size per validation)
2. **Frame Distribution** via RenderCoordinator
3. **In-Order Reassembly** via FrameReassembler
4. **Zero-Copy Transfer** of VideoFrame objects
5. **Graceful Fallback** to single-threaded rendering if workers unavailable

### Phase 1: Frame Pipeline Optimization

The export pipeline has been optimized to eliminate busy-wait polling and reduce memory churn through:
1. **Promise-based backpressure** via EncodeQueue (replaces busy-wait)
2. **Dual video element prefetching** (overlaps seek latency with rendering)
3. **Texture caching optimization** (reuses GPU memory instead of destroy/recreate)
4. **AbortController cleanup** (prevents deadlocks on seek timeout)
5. **Performance telemetry** (tracks queue depth, prefetch hits, seek counts)

### Parallel Rendering Flow (Phase 2)

```
VideoExporter / GifExporter (with useParallelRendering: true)
│
├─ Initialize components
│  ├─ RenderCoordinator (with WorkerPool)
│  │  ├─ WorkerPool (4 workers, fixed count)
│  │  │  ├─ Worker 0-3: Web Worker instances
│  │  │  ├─ OffscreenCanvas per worker
│  │  │  └─ PixiJS renderer in each worker
│  │  ├─ FrameReassembler (collects rendered frames in-order)
│  │  └─ Fallback: Single-threaded FrameRenderer if workers fail
│  │
│  ├─ EncodeQueue (Promise backpressure, max: 6 frames)
│  ├─ PrefetchManager (dual video elements for overlap)
│  ├─ AudioFileDecoders (mic, system)
│  └─ VideoEncoder + AudioEncoder
│
├─ Main export loop (per frame)
│  │
│  ├─ Await EncodeQueue.waitForSpace()
│  │  └─ Returns immediately if space, else Promise backpressure
│  │
│  ├─ Get frame via PrefetchManager.getFrame()
│  │  ├─ Check if prefetched frame available (overlap from prev iteration)
│  │  ├─ If prefetch miss: Seek synchronously with 5s timeout
│  │  └─ Start async prefetch of next frame on alternate video element
│  │
│  ├─ Distribute to RenderCoordinator.renderFrame()
│  │  ├─ If parallel mode:
│  │  │  ├─ Find idle worker from pool
│  │  │  ├─ Send render config + frame data via postMessage
│  │  │  ├─ Transfer VideoFrame as Transferable (zero-copy)
│  │  │  └─ Track pending render with index
│  │  │
│  │  └─ If fallback mode:
│  │     └─ Single-threaded FrameRenderer.render()
│  │
│  ├─ FrameReassembler collects rendered frames
│  │  ├─ Wait for frames in-order (index 0, 1, 2, ...)
│  │  ├─ Buffer out-of-order arrivals (max 32 frames)
│  │  └─ Emit ordered frames for encoding
│  │
│  ├─ Submit frame to VideoEncoder
│  ├─ Increment EncodeQueue.increment()
│  │
│  └─ Process pending audio frames (mixed mic + system audio)
│     ├─ Mix audio buffers asynchronously
│     ├─ Encode audio chunk
│     └─ Await AudioEncodeQueue.waitForSpace() for backpressure
│
├─ Encoder output loop (runs in parallel)
│  ├─ VideoEncoder.output callback fires
│  │  ├─ Receive encoded chunk
│  │  ├─ Queue for muxing
│  │  └─ Call EncodeQueue.onChunkOutput() (unblocks waitForSpace)
│  │
│  └─ AudioEncoder.output callback fires
│     └─ Similar flow for audio chunks
│
├─ Mux final frames with audio tracks
│  └─ Combined MP4 output
│
└─ Performance reporting
   ├─ RenderCoordinator stats: parallel/fallback mode, worker pool stats
   ├─ FrameReassembler stats: buffer size, out-of-order frames
   ├─ PrefetchManager stats: seekCount, prefetchHits, prefetchMisses, hitRate
   ├─ EncodeQueue stats: peakSize, totalEncoded, totalWaits, pendingWaits
   └─ Total timings for optimization tracking
```

### Frame Pipeline Flow (Phase 1)

```
VideoExporter / GifExporter (with useParallelRendering: false)
│
├─ Initialize components
│  ├─ FrameRenderer (with texture caching)
│  ├─ EncodeQueue (Promise backpressure, max: 6 frames)
│  ├─ PrefetchManager (dual video elements for overlap)
│  ├─ AudioFileDecoders (mic, system)
│  └─ VideoEncoder + AudioEncoder
│
├─ Main export loop (per frame)
│  │
│  ├─ Await EncodeQueue.waitForSpace()
│  │  └─ Returns immediately if space, else Promise backpressure
│  │
│  ├─ Get frame via PrefetchManager.getFrame()
│  │  ├─ Check if prefetched frame available (overlap from prev iteration)
│  │  ├─ If prefetch miss: Seek synchronously with 5s timeout
│  │  └─ Start async prefetch of next frame on alternate video element
│  │
│  ├─ FrameRenderer.render() processes frame
│  │  ├─ Decode video frame from source
│  │  ├─ Render effects (zoom, crop, blur, shadow)
│  │  ├─ Render annotations
│  │  ├─ Apply texture caching (update source, avoid destroy/recreate)
│  │  │
│  │  └─ If Camera PiP enabled:
│  │     └─ CameraPipRenderer composites PiP onto frame
│  │
│  ├─ Submit frame to VideoEncoder
│  ├─ Increment EncodeQueue.increment()
│  │
│  └─ Process pending audio frames (mixed mic + system audio)
│     ├─ Mix audio buffers asynchronously
│     ├─ Encode audio chunk
│     └─ Await AudioEncodeQueue.waitForSpace() for backpressure
│
├─ Encoder output loop (runs in parallel)
│  ├─ VideoEncoder.output callback fires
│  │  ├─ Receive encoded chunk
│  │  ├─ Queue for muxing
│  │  └─ Call EncodeQueue.onChunkOutput() (unblocks waitForSpace)
│  │
│  └─ AudioEncoder.output callback fires
│     └─ Similar flow for audio chunks
│
├─ Mux final frames with audio tracks
│  └─ Combined MP4 output
│
└─ Performance reporting
   ├─ PrefetchManager stats: seekCount, prefetchHits, prefetchMisses, hitRate
   ├─ EncodeQueue stats: peakSize, totalEncoded, totalWaits, pendingWaits
   └─ Total timings for optimization tracking
```

### Key Components

#### EncodeQueue (NEW)

**Location**: `src/lib/exporter/encode-queue.ts` (132 lines)

**Purpose**: Event-driven queue with Promise-based backpressure to replace busy-wait polling.

**Key Methods**:
- `async waitForSpace()` - Returns immediately if space, else Promises until chunk output
- `increment()` - Called when frame submitted (increments queue size)
- `onChunkOutput()` - Called by encoder output callback (decrements, resolves waiters)
- `getStats()` - Performance metrics (peak size, total encoded, waits)
- `reset()` - Clear state for new export

**Configuration**:
- Default `maxSize: 6` (optimal for hardware encoders)
- Configurable `debug` logging
- Tracks peak queue depth for diagnostics

**Performance Impact**:
- Replaces `while (queue >= MAX) await setTimeout(0)` busy-wait
- Reduced CPU spinning during backpressure
- Better responsiveness to encoder output events

#### PrefetchManager (NEW)

**Location**: `src/lib/exporter/prefetch-manager.ts` (314 lines)

**Purpose**: Double-buffered video element strategy to overlap seek latency (~50-100ms) with frame rendering.

**Key Methods**:
- `async initialize()` - Create both video elements, return metadata
- `async getFrame(frameIndex, effectiveTimeMs)` - Get video element at time
- `destroy()` - Cleanup and abort pending operations

**Optimization Strategy**:
- **Element A** (current frame): Used for immediate rendering
- **Element B** (prefetch): Asynchronously seeks to next frame
- On next iteration, elements swap roles
- Seek latency overlaps with rendering computation

**Prefetch Hit Rate**:
- High hit rate (>90%) when processing consecutive frames
- Miss handling: Synchronous seek with graceful timeout
- Seek timeout: 5s default (prevents deadlock on corrupted videos)

**Trim Region Support**:
- Automatically maps effective time (excluding trims) to source time
- Handles arbitrary trim regions with overlap detection

#### FrameRenderer Texture Caching

**Location**: `src/lib/exporter/frameRenderer.ts`

**Change**: Optimized texture management in frame loop.

**Before**:
```javascript
const oldTexture = this.videoSprite.texture;
const newTexture = Texture.from(videoFrame);
this.videoSprite.texture = newTexture;
oldTexture.destroy(true);  // Immediate GPU memory free
```

**After**:
```javascript
const newTexture = Texture.from(videoFrame);
const oldTexture = this.videoSprite.texture;
this.videoSprite.texture = newTexture;
// Only destroy if different reference (avoid double-free)
if (oldTexture !== newTexture && oldTexture !== Texture.EMPTY) {
  oldTexture.destroy(true);
}
```

**Impact**:
- Reduces GPU memory churn per frame
- Reuses texture memory more efficiently
- Improves frame submission throughput

#### WorkerPool (NEW - Phase 2)

**Location**: `src/lib/exporter/worker-pool.ts`

**Purpose**: Manages pool of 4 Web Workers for parallel frame rendering.

**Key Features**:
- Fixed worker count: 4 workers (validated as optimal for M4)
- Worker state tracking: busy/idle status per worker
- OffscreenCanvas per worker: Isolated rendering surfaces
- Error propagation: Worker crashes don't deadlock pipeline
- Graceful shutdown: Cleanup all workers on destroy

**Public Methods**:
- `constructor(config: WorkerPoolConfig)` - Initialize pool config
- `async initialize(renderConfig)` - Create workers and send init messages
- `async renderFrame(frameIndex, renderRequest)` - Dispatch frame to idle worker
- `async waitForIdle()` - Block until worker available
- `getStats(): WorkerPoolStats` - Query pool performance metrics
- `destroy()` - Cleanup all workers and listeners

**Worker Lifecycle**:
1. Create Worker from bundled `render-worker.ts`
2. Create OffscreenCanvas with render dimensions
3. Send init message with canvas + render config (Transferable)
4. Worker sets up PixiJS renderer with OffscreenCanvas
5. Send render requests with frame data as Transferable
6. Worker processes frame and sends back rendered canvas
7. Main thread receives rendered frame and marks worker idle
8. On destroy: Terminate all workers

#### RenderCoordinator (NEW - Phase 2)

**Location**: `src/lib/exporter/render-coordinator.ts`

**Purpose**: Orchestrates parallel rendering with fallback to single-threaded.

**Key Features**:
- Parallel/fallback modes (automatic detection)
- Frame distribution to worker pool
- In-order frame reassembly
- Zero-copy VideoFrame transfer
- Graceful degradation if workers unavailable

**Public Methods**:
- `constructor(config: RenderCoordinatorConfig)` - Initialize with render settings
- `async initialize()` - Setup workers (with fallback)
- `async renderFrame(frameIndex, sourceFrame)` - Distribute frame to pool
- `async waitForAllFrames()` - Block until all pending renders complete
- `getStats(): CoordinatorStats` - Query rendering stats
- `destroy()` - Cleanup all resources

**Fallback Strategy**:
- Checks for Worker support via `typeof Worker`
- Initializes single-threaded FrameRenderer if workers unavailable
- Transparently switches modes (parallel vs. fallback)
- Reports stats with `mode: 'parallel' | 'fallback'`

#### FrameReassembler (NEW - Phase 2)

**Location**: `src/lib/exporter/frame-reassembler.ts`

**Purpose**: Collects out-of-order rendered frames and emits in-order.

**Key Features**:
- In-order collection: Guarantees frame sequence (index 0, 1, 2, ...)
- Out-of-order buffering: Holds frames arriving ahead of sequence
- Max buffer size: 32 frames (prevents unbounded growth)
- Automatic emission: Yields frames as soon as sequence is available
- Performance tracking: Buffers size, out-of-order counts

**Public Methods**:
- `async addFrame(frameIndex, frame)` - Collect rendered frame
- `async getNextFrame()` - Block until next in-sequence frame available
- `getStats(): ReassemblerStats` - Query reassembler metrics
- `reset()` - Clear state for new export session

**Buffering Example**:
```
Received: [0, 2, 1, 3, ...]
Expected sequence: 0, 1, 2, 3

Step 1: addFrame(0, data) → emit immediately → nextExpected = 1
Step 2: addFrame(2, data) → buffer (ahead of sequence)
Step 3: addFrame(1, data) → emit → emit buffered[2] → nextExpected = 3
Step 4: addFrame(3, data) → emit → nextExpected = 4
```

#### Worker Types & Messages (NEW - Phase 2)

**Location**: `src/lib/exporter/workers/worker-types.ts`

**Key Types**:
- `WorkerRenderConfig` - Render settings (canvas size, effects, regions)
- `WorkerRenderRequest` - Single frame render request (frameIndex, sourceFrame)
- `RenderedWorkerResponse` - Rendered frame result (frameIndex, canvas, transferable)
- `WorkerToMainMessage` - Union of all worker→main messages

**Message Protocol**:
1. Main → Worker: `{ type: 'INIT', renderConfig, canvas }` (Transferable)
2. Worker → Main: `{ type: 'READY' }`
3. Main → Worker: `{ type: 'RENDER', renderRequest, sourceFrame }` (Transferable)
4. Worker → Main: `{ type: 'RENDERED', frameIndex, canvas }` (Transferable)

#### Worker Entry Point (NEW - Phase 2)

**Location**: `src/lib/exporter/workers/render-worker.ts`

**Purpose**: Web Worker entry point that sets up PixiJS renderer.

**Workflow**:
1. Listen for INIT message with OffscreenCanvas
2. Create WorixiRenderer with canvas + render config
3. Send READY message
4. Listen for RENDER messages in loop
5. Call workerRenderer.render(sourceFrame, frameIndex, effects)
6. Send RENDERED message with result canvas

**Key Details**:
- Uses WorkerPixiRenderer for frame rendering
- Transfers canvas back via Transferable (zero-copy)
- Async rendering awaits frame decode completion
- Error handling: Logs and sends ERROR message

### Camera PiP Export Pipeline

```
VideoExporter / GifExporter (with frame pipeline optimization)
│
├─ Initialize FrameRenderer
│  └─ Passes cameraExportConfig if camera video present
│
├─ Frame pipeline optimization enabled:
│  ├─ EncodeQueue manages backpressure
│  ├─ PrefetchManager overlaps seek latency
│  └─ Texture caching reduces GPU churn
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
