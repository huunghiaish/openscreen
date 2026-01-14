# Timeline Multi-Track Research Report

## Current Implementation Analysis

**dnd-timeline** (v2.2.0) is a React drag-and-drop timeline library with core concepts:
- **Row**: Container for timeline items, keyed by `id`
- **Item**: Draggable/resizable element with `span` (start/end) and `rowId`
- **useItem/useRow hooks**: Provide drag handles, resize listeners, positioning styles
- **useTimelineContext**: Global context with range, valueToPixels, sidebarWidth

**Current OpenScreen timeline structure**:
```
TimelineEditor
├── TimelineAxis (time ruler with markers)
├── PlaybackCursor (green scrubber line)
└── Timeline (container)
    ├── Row id="row-zoom" (zoom items)
    ├── Row id="row-trim" (trim items)
    └── Row id="row-annotation" (annotation items)
```

Each Row renders Items with different variants (zoom/trim/annotation). Rows are independent and don't share data—all synced by time only.

## Adding Audio/Video Tracks

**Multi-track pattern**: Create additional Row components for each track type.

```tsx
// New track row IDs
const CAMERA_VIDEO_ROW_ID = "row-camera-video";
const MIC_AUDIO_ROW_ID = "row-mic-audio";
const SYSTEM_AUDIO_ROW_ID = "row-system-audio";
const SCREEN_VIDEO_ROW_ID = "row-screen-video";

<Timeline>
  <Row id={SCREEN_VIDEO_ROW_ID}>
    {screenVideoItem}  // Full timeline span
  </Row>

  <Row id={CAMERA_VIDEO_ROW_ID}>
    {cameraVideoItem}  // Optional, may have gaps
  </Row>

  <Row id={MIC_AUDIO_ROW_ID}>
    {micAudioItems}    // May have multiple segments
  </Row>

  <Row id={SYSTEM_AUDIO_ROW_ID}>
    {systemAudioItems}
  </Row>

  {/* Existing editing rows */}
  <Row id={ZOOM_ROW_ID} />
  <Row id={TRIM_ROW_ID} />
  <Row id={ANNOTATION_ROW_ID} />
</Timeline>
```

**Key advantages**:
- No dnd-timeline modifications needed—just add Row components
- Each track can hold Items with span/duration
- Playback cursor & time ruler work across all rows automatically

## Audio Waveform Rendering

**Approaches**:

1. **Canvas-based waveform** (recommended for performance):
   - Use Web Audio API to decode audio buffer
   - Draw waveform peaks to Canvas element inside Item
   - Update on span changes
   - Libraries: `wavesurfer.js`, `tone.js`, custom Canvas rendering

2. **SVG-based** (simpler, less performant):
   - Generate SVG paths from audio data
   - Render inside Item content
   - Suitable for short clips

3. **Color blocks** (MVP):
   - Skip actual waveform visualization
   - Use solid color background for audio items
   - Quick win before adding waveform support

**Data flow for waveform**:
```
AudioTrack
├── audioUrl or audioBuffer
├── peak data (pre-computed)
└── WaveformRenderer
    ├── Canvas/SVG
    └── TimeScale context (valueToPixels)
```

**Implementation note**: Extract peak/RMS values at multiple intervals (e.g., every 100ms) for efficient rendering at any zoom level.

## Track Synchronization

**Sync mechanisms**:

1. **Time-based sync** (current approach):
   - All rows reference same `currentTime` playhead
   - `onSeek(timeInSeconds)` updates playback position
   - PlaybackCursor component automatically positioned in all rows

2. **Duration alignment**:
   - Screen video defines total duration (always present)
   - Camera/mic tracks may be shorter → start at offset
   - Track data structure: `{ audioUrl, startTimeMs, endTimeMs, trackType }`

3. **State management**:
   ```tsx
   interface AudioTrack {
     id: string;
     type: 'mic' | 'system' | 'camera';
     audioUrl: string;
     startTimeMs: number;
     endTimeMs: number;
     volumeDb: number;
   }
   ```

4. **Playback sync**:
   - HTMLMediaElement or Web Audio API plays all tracks
   - Seek moves all tracks to same position
   - No special sync logic needed—handled by player

## Row Height & Visual Hierarchy

**Recommended layout**:
```css
row-screen-video: 56px (primary)
row-camera-video: 48px
row-mic-audio: 40px (waveform visible)
row-system-audio: 40px
/* Divider */
row-zoom: 48px
row-trim: 48px
row-annotation: 48px
```

Current Row component:
```tsx
<div style={{ minHeight: 48, marginBottom: 4 }}>
```

Can vary minHeight per row ID for visual emphasis.

## Implementation Roadmap

1. **Phase 1**: Define track data structures & state
2. **Phase 2**: Create new Row components (camera, mic, system)
3. **Phase 3**: Build canvas waveform renderer (standalone component)
4. **Phase 4**: Integrate audio items into timeline
5. **Phase 5**: Implement seek/sync logic
6. **Phase 6**: Add track controls (mute, solo, volume)

## Unresolved Questions

- Should camera video overlay on screen video or be separate track?
- How to handle audio offset relative to screen recording start?
- Should audio tracks support multiple segments or single continuous clip?
- Pre-compute waveform peaks at recording time or on-demand during playback?
- UI for adding/removing tracks—buttons, dropdown, or context menu?
