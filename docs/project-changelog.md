# OpenScreen Project Changelog

All notable changes to OpenScreen are documented in this file. The project follows semantic versioning.

## [Unreleased]

### Phase 07: Camera PiP Shape Selection (Completed)

#### Added
- **CameraPipShape Type**: Four shape options for camera overlay
  - `rounded-rectangle`: Original aspect ratio with configurable corner radius
  - `rectangle`: Original aspect ratio, sharp corners
  - `square`: 1:1 aspect ratio (center-cropped), sharp corners
  - `circle`: 1:1 aspect ratio (center-cropped), fully rounded for circular appearance
- **Shape Selector UI**: New shape selection in CameraPipSettings
  - 4-button grid layout with icon indicators (rounded rectangle, rectangle, square, circle)
  - Visual feedback for active selection (green highlight #34B27B)
  - Conditional border radius slider (only shown for rounded-rectangle shape)

#### Updated
- **CameraPipConfig Type**: Added `shape` property
  - New field: `shape: CameraPipShape`
  - `borderRadius` now only applies when shape is 'rounded-rectangle'
  - Updated DEFAULT_CAMERA_PIP_CONFIG to include shape default
- **CameraPipOverlay Component**: Shape-aware CSS styling
  - New `getShapeStyles()` helper function for CSS-in-JS styles
  - Responsive border radius calculation based on selected shape
  - Center-crop calculation for square/circle shapes (1:1 aspect ratio)
- **CameraPipRenderer Class**: Shape-aware export rendering
  - New `getShapeParams()` helper for export-specific shape parameters
  - Dynamic radius calculation for roundRect clipping path
  - Center-crop rendering for square/circle shapes during frame compositing
  - All 4 shapes properly handled in MP4 and GIF export pipelines

#### Technical Details
- **Shape Rendering Pipeline**:
  - Rounded-rectangle & rectangle: Use original camera aspect ratio
  - Square & circle: Center-crop camera frame to 1:1 aspect before rendering
  - Border radius: 0% for rectangle/square, 50% for circle, user-configurable for rounded-rectangle
- **UI Implementation**:
  - Shape selector uses lucide-react icons (RectangleHorizontal, Square, Circle)
  - Conditional slider visibility: only shows when shape === 'rounded-rectangle'
  - All 4 options available regardless of camera aspect ratio
- **Export Implementation**:
  - getShapeParams() returns { radius, forceSquare } for export rendering
  - Center-crop applied in canvas drawing pipeline when forceSquare=true
  - Maintains backward compatibility with existing recordings

#### UI/UX
- Shape selector positioned between size selector and border radius slider
- Icons visually represent each shape option
- Interactive grid layout (4 columns) for easy shape selection
- Green highlight (#34B27B) indicates selected shape
- Border radius slider appears/disappears smoothly based on shape choice

### Phase 06: Camera PiP Settings Controls (Completed)

#### Added
- **CameraPipSettings Component**: UI controls for camera PiP configuration
  - New `CameraPipSettings.tsx` component in SettingsPanel
  - Toggle switch to enable/disable camera overlay
  - Position selector: 2x2 grid for 4-corner placement (top-left, top-right, bottom-left, bottom-right)
  - Size selector: S/M/L buttons for relative sizing (15%, 22%, 30% of container width)
  - Conditional rendering: Controls only show when camera video is available
  - Status icon: Video camera icon with green accent color (#34B27B)

#### Updated
- **SettingsPanel Component**: Integrated CameraPipSettings
  - Added props: `cameraVideoPath`, `cameraPipConfig`, `onCameraPipConfigChange`
  - Renders CameraPipSettings when camera video path exists
  - Type-safe configuration updates passed to parent
- **VideoEditor Component**: Wiring camera config to settings panel
  - Pass `cameraPipConfig` state to SettingsPanel
  - Pass `onCameraPipConfigChange` handler for config updates

#### Technical Details
- Position buttons use visual indicator (dot) for selection state
- Green accent (#34B27B) for active selections and camera icon
- Responsive grid layout (2 columns for position, flex row for size)
- Settings only visible when camera was recorded during capture
- Type-safe prop interfaces for configuration updates

#### UI/UX
- Settings grouped under "Camera PiP" section with video camera icon
- Position selector shows visual 2x2 grid matching corner placement
- Size presets labeled S/M/L for quick selection
- White border states for inactive options, green for active
- Accessibility: aria-label and aria-pressed attributes on buttons

### Phase 04: Export Compositing - Camera PiP (Completed)

#### Added
- **CameraPipRenderer Class**: Extracts and composites camera PiP frames during export
  - New `src/lib/exporter/camera-pip-renderer.ts` (173 lines)
  - Handles camera video loading, frame extraction, and PiP compositing
  - Offscreen canvas for efficient frame extraction and rendering
  - Time-synchronized camera frame playback during export
- **CameraExportConfig Interface**: Export-specific camera configuration
  - `videoUrl: string` - Path to camera video file
  - `pipConfig: CameraPipConfig` - Reuses editor configuration (position, size, border radius)
- **CameraPipRenderer Methods**:
  - `initialize()`: Loads camera video metadata, creates extraction canvas. Returns success status.
  - `isReady()`: Checks if renderer is initialized and enabled
  - `getDuration()`: Returns camera video duration for validation
  - `render(ctx, canvasWidth, canvasHeight, timeMs)`: Composites PiP onto frame at time
  - `destroy()`: Cleanup resources

#### Updated
- **FrameRenderer** (`src/lib/exporter/frameRenderer.ts`):
  - Added `cameraPipRenderer: CameraPipRenderer | null` field
  - Initialize renderer with `CameraExportConfig` if camera video present
  - Call `cameraPipRenderer.render()` during frame rendering loop
  - Cleanup in destroy method: `cameraPipRenderer?.destroy()`
- **VideoExporter/GifExporter** (`src/lib/exporter/videoExporter.ts`, `gifExporter.ts`):
  - Added props: `cameraVideoUrl?: string`, `cameraPipConfig?: CameraPipConfig`
  - Create `CameraExportConfig` and pass to FrameRenderer
- **Type Definitions** (`src/lib/exporter/types.ts`):
  - Added `CameraExportConfig` interface

#### Technical Details

**Rendering Pipeline**:
- Time sync: Seeks camera video to match main video time in milliseconds
- Position: Corner-based (4 corners) with 2% margin from edges
- Size: Percentage-based (15%, 22%, 30% of export canvas width)
- Border radius: 0-100% for square to fully circular appearance
- Mirroring: Applied via canvas scale(-1, 1) for natural camera orientation
- Border: Semi-transparent white stroke (rgba 255,255,255,0.2), 3px lineWidth
- Clipping: Uses roundRect() path for smooth corners

**Frame Extraction**:
- Camera video element: Created in DOM but not displayed
- Offscreen canvas: Separate from main render target
- Drawing context: 2D context for canvas operations
- Metadata preload: Waits for loadedmetadata before rendering

**Resource Management**:
- Single video element per renderer instance
- Offscreen canvas dimensions match source camera resolution
- No texture caching or pooling (simple extraction)
- Memory cleanup on destroy: video src cleared, references nulled

**Error Handling**:
- Graceful degradation if camera video fails to load
- Skip PiP rendering if camera duration exceeded at export time
- No throwing exceptions; silent fallback to main video only
- Logs warnings via console for debugging

**Edge Cases**:
- Camera video shorter than main video: PiP stops rendering after camera ends
- Camera video file deleted during export: initialize() returns false, PiP disabled
- Seek timing: Uses onseeked callback to wait for frame availability

#### Verified Components
- CameraPipRenderer properly handles initialization failures
- Async render respects time-based seeking
- Border radius calculation supports 0% (square) to 100% (full circle)
- Mirror transform applied before drawing to canvas context
- Export works for both MP4 and GIF formats

### Phase 05: PiP Overlay Preview (Completed)

#### Added
- **CameraPipOverlay Component**: Display camera video as Picture-in-Picture overlay
  - New `CameraPipOverlay.tsx` component for rendering camera video over main video
  - Synchronized playback with main video (play/pause/seek events)
  - Position stored as normalized values for responsive sizing
  - Circular/rounded overlay styling with configurable border radius
  - Video sync with 0.1s threshold to prevent drift
- **Camera PiP Configuration Types**: Type-safe configuration for PiP overlay
  - `CameraPipConfig` interface with enabled, position, size, and borderRadius
  - `CameraPipPosition` type for 4-corner positioning
  - `CameraPipSize` preset type (small/medium/large)
  - `DEFAULT_CAMERA_PIP_CONFIG` constant for initialization
  - `CAMERA_PIP_SIZE_PRESETS` percentage-based sizing

#### Updated
- **VideoPlayback Component**: Integrated PiP overlay rendering
  - Added `cameraVideoPath` and `cameraPipConfig` props
  - Added sync logic for play/pause/seek events
  - Camera ref for imperative sync control
  - Position calculations based on container dimensions
- **VideoEditor Component**: Camera PiP state management
  - Added `cameraPipConfig` state with default values
  - Added `setCameraPipConfig` setter for future Phase 3 controls
  - Pass camera state to VideoPlayback component
- **Type Definitions** (`types.ts`): Camera PiP configuration types
  - Added position, size, and config interfaces
  - Default configuration constants and size presets

#### Technical Details
- Camera sync threshold: 0.1 seconds to prevent perceptible drift
- Size presets: small (15%), medium (22%), large (30%) of container width
- Position margin: 16px from edge for all corner placements
- Mirror transform applied for natural camera appearance (scaleX(-1))
- Responsive sizing based on container dimensions
- Zero impact on main video rendering performance

#### Security Implementation
- **Path Validation in `get-camera-video-path` IPC Handler** (`electron/ipc/handlers.ts`)
  - Defense in depth: Validates resolved path is within RECORDINGS_DIR
  - Uses `path.resolve()` and `startsWith()` check to prevent directory traversal attacks
  - Pattern matching ensures only valid camera filenames (`camera-{timestamp}.webm`) are processed
  - File existence verification before returning path to prevent information leakage
  - Graceful error handling with null return on path validation failure

#### Implementation Details
- **CameraPipOverlay.tsx Component Structure**:
  - forwardRef component for imperative ref control
  - useImperativeHandle to expose video element and sync method
  - EventListeners: play, pause, seeked, timeupdate from main video
  - Automatic cleanup of event listeners in useEffect return function
  - State: hasError flag for graceful degradation

- **Synchronization Mechanism**:
  - Continuous sync via timeupdate events (every ~200ms)
  - Threshold check: only sync if delta > 0.1s to prevent redundant updates
  - Imperative sync method for explicit updates when needed
  - Play/pause propagation with error handling (catch for autoplay restrictions)

- **Styling & Layout**:
  - Absolute positioned div with overflow hidden
  - CSS containment for visual isolation
  - 3px white border with 20% opacity for visual definition
  - Shadow-2xl Tailwind class for depth
  - Mirror transform (scaleX(-1)) for natural camera appearance
  - Responsive size calculation: containerWidth * (sizePercent / 100)

- **Responsive Sizing**:
  - CAMERA_PIP_MARGIN = 16px from edges
  - Small: 15% of container width
  - Medium: 22% of container width (default)
  - Large: 30% of container width
  - Uses Math.round() for pixel-perfect rendering

#### Verified Components
- CameraPipOverlay properly exported with displayName
- CameraPipOverlayRef interface exposes video and sync methods
- VideoPlayback integration with CameraPipOverlay ref management
- VideoEditor state management for cameraPipConfig
- Type safety with TypeScript interfaces and union types

### Phase 03: Camera Video Path Resolution (Completed)

#### Added
- **Camera Video Path Resolution**: IPC handler to resolve camera video from main recording
  - New `get-camera-video-path` IPC handler in `electron/ipc/handlers.ts`
  - Exposed `getCameraVideoPath(mainVideoPath)` in preload API
  - Timestamp-based pattern matching: `recording-{timestamp}.webm` → `camera-{timestamp}.webm`
  - File existence validation to detect if camera was recorded
- **VideoEditor Camera Track Loading**: Load camera video for future PiP overlay
  - New `cameraVideoPath` state in VideoEditor component
  - useEffect hook loads camera path after main video loads
  - Graceful fallback when camera file doesn't exist (recording without camera)
  - Foundation for Phase 4: Export compositing and Phase 5: PiP overlay

#### Updated
- **Preload API** (`electron/preload.ts`): Added `getCameraVideoPath` function
- **Type Definitions** (`electron-env.d.ts`, `src/vite-env.d.ts`): Added camera path resolution types

#### Technical Details
- Camera file location: same directory as main recording with `camera-` prefix
- Handles recordings made without camera enabled
- No video data processing at this phase (loading only)
- Foundation for Phase 4 Picture-in-Picture overlay

### Phase 02: Camera Recording Capture (Completed)

#### Added
- **Camera Device Infrastructure**: Enumeration and management of camera devices
  - `useMediaDevices` hook for listing and selecting cameras
  - Device persistence via localStorage
  - Support for plugging/unplugging cameras at runtime
- **Camera Recording During Screen Capture**: Optional camera recording while capturing screen
  - New `cameraDeviceId` parameter in recording options
  - Separate WebM file storage for camera feed
  - Independent camera MediaStream from screen capture
- **Camera Preview Overlay Component**: Live camera preview during recording
  - `CameraPreviewOverlay` component for displaying camera feed
  - Configurable positioning (top-left, top-right, bottom-left, bottom-right)
  - Real-time camera preview window during recording session
- **IPC Handler for Camera Storage**: Secure camera recording file handling
  - `store-camera-recording` IPC handler for saving camera WebM files
  - Proper error handling and file I/O validation
- **Type Definitions**: TypeScript types for camera functionality
  - `ScreenRecorderOptions` with optional `cameraDeviceId`
  - `CameraOverlayConfig` for overlay positioning and sizing

#### Updated
- **System Architecture Documentation**: Camera recording workflow and data flow
  - Updated recording session flow to show separate camera and screen streams
  - Added camera preview overlay to component hierarchy
  - Documented camera recording storage IPC messages
  - Added type definitions for camera recording functionality

#### Technical Details
- Camera recording stored as separate `.webm` file during capture
- Camera feed integrated into timeline editor alongside screen video
- Camera overlay composited during export process
- Full support for camera audio track in addition to video
- Optional feature - gracefully handles no camera selected case

### Phase 01: Project Foundation & Architecture (Completed)

#### Features
- Multi-window Electron application with HUD overlay and video editor
- Screen recording with audio capture (system audio + microphone)
- Basic video editing with timeline and zoom regions
- Export to MP4 and GIF formats
- PixiJS-based video playback with real-time effects
- Microphone and system audio device selection
- Cross-platform build support (macOS, Windows, Linux)

---

## Legend

- **Added**: New features or functionality
- **Changed**: Updates to existing features
- **Fixed**: Bug fixes
- **Removed**: Removed features or functionality
- **Updated**: Documentation or non-code updates
- **Security**: Security-related changes
