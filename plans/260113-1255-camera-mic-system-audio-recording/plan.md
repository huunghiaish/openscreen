---
title: "Camera, Microphone & System Audio Recording"
description: "Add webcam capture with overlay, microphone recording, macOS system audio capture, and multi-track timeline integration"
status: in-progress
priority: P1
effort: 24h (completed: 16.5h of 24h - 69%)
branch: main
tags: [recording, audio, camera, timeline, media-devices]
created: 2026-01-13
updated: 2026-01-14
---

# Camera, Microphone & System Audio Recording

## Overview

Extend OpenScreen's recording capabilities from screen-only to full multi-stream capture: webcam, microphone, and system audio (macOS 13.2+). Display separate tracks in editor timeline.

## Research Reports

- [Electron Media Capture](reports/researcher-01-electron-media-capture.md) - APIs, macOS strategy
- [Timeline Multi-Track](reports/researcher-02-timeline-multi-track.md) - dnd-timeline patterns, waveforms
- [Scout Report](scout/scout-01-recording-timeline.md) - Current codebase gaps

## Architecture

```
RECORDING FLOW:
Screen  → desktopCapturer + system audio (macOS 13.2+)
Camera  → getUserMedia video
Mic     → getUserMedia audio
                ↓
        AudioContext (mix or separate)
        Canvas (composite or separate)
                ↓
        MediaRecorder → WebM → MP4
```

## Phases

| Phase | Name | Effort | Status |
|-------|------|--------|--------|
| 01 | [Media Device Infrastructure](phase-01-media-device-infrastructure.md) | 3h | ✓ complete (2026-01-13) |
| 02 | [Camera Recording & Capture](phase-02-camera-recording-capture.md) | 5h | ✓ complete (2026-01-13) |
| 03 | [Microphone Recording](phase-03-microphone-recording.md) | 4h | ✓ complete (2026-01-14) |
| 04 | [System Audio Capture](phase-04-system-audio-capture.md) | 4h | ✓ complete (2026-01-14) |
| 05 | [HUD UI Device Selectors](phase-05-hud-ui-device-selectors.md) | 4h | pending |
| 06 | [Timeline Multi-Track](phase-06-timeline-multi-track.md) | 4h | pending |

## Key Dependencies

- macOS 13.2+ for system audio via ScreenCaptureKit
- Existing dnd-timeline library for track rows
- Current useState pattern (no store refactor needed)

## Success Criteria

- [ ] Camera preview overlay during recording
- [ ] Mic audio captured and stored
- [ ] System audio on macOS 13.2+, graceful fallback on older
- [ ] Separate tracks visible in timeline editor
- [ ] Audio waveform visualization (MVP: color blocks)
- [ ] All streams sync via shared playhead

## Validation Summary

**Validated:** 2026-01-13
**Questions asked:** 7

### Confirmed Decisions

| Decision | Choice |
|----------|--------|
| Camera video storage | **Separate file** - flexible editing, overlay in editor |
| Audio waveform MVP | **Color blocks** - simple, fast implementation |
| Audio offset handling | **Track starts from actual offset** - shows real timeline position |
| Default camera size | **Medium (240x180px)** - balance visibility & screen space |
| Default camera position | **Bottom-right** - most common convention |
| macOS < 13.2 fallback | **Show disabled toggle + tooltip** - user knows feature exists |
| Device selection persistence | **Yes, localStorage** - better UX across sessions |

### Action Items
- [ ] Phase 01: Add localStorage persistence for device selection
- [ ] Phase 02: Set default camera size to Medium, position to bottom-right
- [ ] Phase 04: Ensure tooltip shows macOS version requirement
- [ ] Phase 06: Implement offset-based track positioning (not padding silence)
