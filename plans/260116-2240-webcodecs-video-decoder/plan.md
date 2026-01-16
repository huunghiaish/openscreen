---
title: "WebCodecs VideoDecoder for Fast Frame Extraction"
description: "Replace HTMLVideoElement seek (~100ms) with WebCodecs VideoDecoder (~2ms) to unlock parallel rendering"
status: in-progress
priority: P1
effort: 12h
branch: main
tags: [performance, webcodecs, videodecoder, export, optimization]
created: 2026-01-16
updated: 2026-01-16 23:40
---

# Phase 2.5: WebCodecs VideoDecoder for Fast Frame Extraction

## Problem Statement
Parallel rendering workers are blocked by video decoding bottleneck:
- HTMLVideoElement.currentTime seek: 100-140ms per frame
- Workers render in 1-2ms but starve waiting for frames
- Only 1 of 4 workers utilized (98% idle time)

## Solution
Replace HTMLVideoElement with WebCodecs VideoDecoder pipeline:
- Demux video containers (MP4/WebM) using mediabunny
- Decode frames with hardware-accelerated VideoDecoder
- Feed parallel workers at full speed

## Performance Targets
| Metric | Current | Target |
|--------|---------|--------|
| Frame extraction | 100-140ms | <5ms |
| Worker utilization | 25% | 90%+ |
| Export time (1min 1080p60) | ~10min | 30-60s |

## Architecture

```
[Video File] --> [Demuxer] --> [VideoDecoder] --> [FrameBuffer] --> [Workers]
                 (mediabunny)   (WebCodecs)       (8-16 frames)    (4x parallel)
```

## Phases

| Phase | Description | Status | Effort | Completed |
|-------|-------------|--------|--------|-----------|
| [Phase 1](./phase-01-video-demuxer.md) | Video demuxer wrapper for MP4/WebM | ✅ DONE | 3h (actual: 4h) | 2026-01-16 23:10 |
| [Phase 2](./phase-02-video-decoder-service.md) | VideoDecoder service with backpressure | ✅ DONE | 4h (actual: ~4h) | 2026-01-16 23:26 |
| [Phase 3](./phase-03-frame-buffer.md) | Frame buffer and reordering | ✅ DONE | 2h (actual: ~2h) | 2026-01-16 23:40 |
| [Phase 4](./phase-04-integration.md) | Integration with RenderCoordinator | pending | 3h | — |

## Key Dependencies
- mediabunny (already in project) - provides MP4/WebM demuxing
- WebCodecs API (Chromium/Electron) - provides VideoDecoder
- Existing RenderCoordinator/WorkerPool infrastructure

## Risk Summary
- **High:** B-frame reordering complexity (mitigated by mediabunny)
- **Medium:** Codec support variability (fallback to HTMLVideoElement)
- **Low:** Memory pressure from frame buffer (managed with close() calls)

## Success Criteria
1. Frame extraction <5ms average
2. 4 workers actively processing in parallel
3. 10-20x speedup for 1080p60 export
4. Graceful fallback when WebCodecs unavailable

## Validation Summary

**Validated:** 2026-01-16
**Questions asked:** 6

### Confirmed Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Demuxer library | mediabunny exclusively | Already integrated, adapt if issues arise |
| Frame buffer size | 16 frames (128MB) | Good balance of throughput and memory |
| Fallback trigger | Only if codec unsupported | Fall back only when isConfigSupported() fails |
| B-frame handling | Skip for now | VP9 screen recordings don't use B-frames |
| Trim region logic | In FrameSource.getFrame() | Transparent mapping, clean interface |
| Decode strategy | Continuous decode-ahead | Proactive buffer filling for max throughput |

### Action Items
- [x] Validation completed
- [ ] Update Phase 3 to use 16 frames as default buffer size (confirmed)
- [ ] Ensure FrameSource handles trim mapping internally (Phase 4)
