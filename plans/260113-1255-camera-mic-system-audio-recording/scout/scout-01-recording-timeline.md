# Scout Report: Recording & Timeline Files

## Recording Flow Files

### Core Recording
| File | Lines | Purpose |
|------|-------|---------|
| `src/hooks/useScreenRecorder.ts` | 191 | Main recording hook, MediaRecorder, **audio: false hardcoded** |
| `electron/ipc/handlers.ts` | 222 | IPC handlers: get-sources, store-recorded-video, set-recording-state |
| `electron/main.ts` | 166 | App lifecycle, tray menu, RECORDINGS_DIR |
| `electron/windows.ts` | 155 | Window factory: HUD, Editor, SourceSelector |
| `electron/preload.ts` | 65 | IPC bridge exposed to renderer |

### Key Findings - Recording
- `desktopCapturer.getSources()` used in handlers.ts
- Screen capture via `getUserMedia` with `chromeMediaSource: 'desktop'`
- **No audio capture** - hardcoded `audio: false` in useScreenRecorder.ts:91
- VideoMuxer (`src/lib/exporter/muxer.ts`) has audio support but never receives chunks

## HUD Overlay UI Files

### Components
| File | Lines | Purpose |
|------|-------|---------|
| `src/components/launch/LaunchWindow.tsx` | 186 | Floating HUD controls |
| `src/components/launch/SourceSelector.tsx` | 159 | Screen/window picker dialog |

### Key Findings - HUD
- Source selector + Record/Stop toggle + Open video button
- **No camera/mic device selectors**
- **No audio status indicators** ("No camera", "No microphone")
- Glass morphism styling with backdrop blur

## Timeline Components

### Files in `src/components/video-editor/timeline/`
| File | Lines | Purpose |
|------|-------|---------|
| `TimelineEditor.tsx` | 962 | Main orchestrator, keyboard shortcuts, region management |
| `TimelineWrapper.tsx` | 163 | Context provider from dnd-timeline |
| `Row.tsx` | 21 | Track row wrapper, 48px min-height |
| `Item.tsx` | 120 | Zoom/trim/annotation items with variants |
| `Subrow.tsx` | 12 | Sub-container 32px height |
| `KeyframeMarkers.tsx` | 51 | Yellow diamond keyframe markers |

### Key Findings - Timeline
- Uses `dnd-timeline` library for drag-drop
- Three row types: zoom, trim, annotation
- **No audio/camera track rows**
- Items have variants (green=zoom, red=trim, yellow=annotation)

## Video Editor State

### Main State: `src/components/video-editor/VideoEditor.tsx`
- **Pattern:** useState hooks (no store/context)
- **27 state variables** managed in component
- Regions: zoomRegions, trimRegions, annotationRegions
- **No audio/camera track state**

### Types: `src/components/video-editor/types.ts`
- ZoomRegion, TrimRegion, AnnotationRegion, CropRegion
- **No AudioTrack or CameraTrack types**

## Architecture Gap Summary

```
CURRENT:
Screen → desktopCapturer → MediaRecorder → WebM → MP4

MISSING:
├── Camera capture (getUserMedia video)
├── Microphone capture (getUserMedia audio)
├── System audio (desktopCapturer + audio flag macOS 13.2+)
├── Canvas composition for multi-video
├── AudioContext mixing for multi-audio
├── Audio/Camera track types
├── Audio/Camera timeline rows
└── Device selector UI
```

## Files to Modify

### Recording Layer
- `src/hooks/useScreenRecorder.ts` - Add camera/mic/system audio capture
- `electron/ipc/handlers.ts` - Add audio device enumeration handlers
- `electron/preload.ts` - Expose audio APIs
- `src/vite-env.d.ts` - Add audio types

### UI Layer
- `src/components/launch/LaunchWindow.tsx` - Add camera/mic status + selectors
- `src/components/video-editor/timeline/TimelineEditor.tsx` - Add audio/camera tracks
- `src/components/video-editor/types.ts` - Add AudioTrack, CameraTrack types

### New Files Needed
- `src/hooks/useMediaDevices.ts` - Device enumeration hook
- `src/components/launch/MediaDeviceSelector.tsx` - Device picker UI
- `src/components/video-editor/timeline/AudioTrackRow.tsx` - Audio waveform track
- `src/components/video-editor/timeline/CameraTrackRow.tsx` - Camera thumbnail track
