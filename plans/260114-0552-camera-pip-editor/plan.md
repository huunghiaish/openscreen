---
title: "Camera PiP in Video Editor"
description: "Add Picture-in-Picture camera overlay feature to the video editor with position/size controls and export compositing"
status: in-progress
priority: P1
effort: 9.5h
branch: main
tags: [camera, pip, editor, pixijs, export]
created: 2026-01-14
progress: 80%
---

# Camera PiP in Video Editor

## Overview

Add Picture-in-Picture (PiP) camera overlay feature to the video editor, allowing users to see their camera recording as a draggable overlay on the main video and composite it into final exports.

## Current State

- Camera recording during screen capture: **Complete** (Phase 2)
- Camera saves as separate file: `camera-{timestamp}.webm`
- Main video saves as: `recording-{timestamp}.webm`
- Editor renders video via PixiJS with zoom/crop/annotations
- No camera video loading or display in editor yet

## Implementation Phases

| Phase | Description | Status | Est. |
|-------|-------------|--------|------|
| [Phase 1](./phase-01-camera-video-loading.md) | Load camera video in editor | **completed** | 1.5h |
| [Phase 2](./phase-02-pip-overlay-preview.md) | Display PiP overlay in preview | **completed** | 2.5h |
| [Phase 3](./phase-03-pip-position-controls.md) | Position/size controls in settings | **completed** | 1.5h |
| [Phase 4](./phase-04-export-compositing.md) | Composite PiP into exports | **completed** | 2.5h |
| [Phase 5](./phase-05-camera-shape-selection.md) | Camera shape selection | pending | 1.5h |

## Architecture

```
VideoEditor
├── State: cameraPipConfig, cameraVideoPath
├── VideoPlayback
│   ├── Main video (existing PixiJS pipeline)
│   └── CameraPipOverlay (new)
│       ├── HTML video element (synced playback)
│       └── Position/size from config
├── SettingsPanel
│   └── CameraPipSettings (new)
│       ├── Position selector (4 corners)
│       ├── Size slider (small/medium/large)
│       └── Enable/disable toggle
└── Export Pipeline
    ├── FrameRenderer (modified)
    │   └── renderCameraPip() (new)
    └── GifExporter (modified)
        └── renderCameraPip() (new)
```

## Key Dependencies

- PixiJS for rendering
- VideoFrame API for export compositing
- Existing crop/zoom pipeline
- IPC for camera file path resolution

## Success Criteria

1. Camera video loads automatically when available
2. PiP displays in preview, synced with main video
3. User can choose 4 corner positions
4. User can choose 3 size presets
5. User can choose 4 shapes (rounded-rect, rect, square, circle)
6. PiP composited correctly in MP4 and GIF exports
7. No performance regression in playback/export

## Risks

| Risk | Mitigation |
|------|------------|
| Playback sync issues | Use shared time reference, handle seek events |
| Export quality mismatch | Scale camera video appropriately for export resolution |
| Performance impact | Use hardware video decode, efficient compositing |

## Related Files

**To Modify:**
- `src/components/video-editor/VideoEditor.tsx`
- `src/components/video-editor/VideoPlayback.tsx`
- `src/components/video-editor/SettingsPanel.tsx`
- `src/components/video-editor/types.ts`
- `src/lib/exporter/frameRenderer.ts`
- `src/lib/exporter/gifExporter.ts`
- `electron/ipc/handlers.ts`

**To Create:**
- `src/components/video-editor/CameraPipOverlay.tsx`
- `src/components/video-editor/CameraPipSettings.tsx`
