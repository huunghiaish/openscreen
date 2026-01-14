# Phase 06: Timeline Multi-Track

## Context Links

- [Timeline Multi-Track Research](reports/researcher-02-timeline-multi-track.md) - dnd-timeline patterns
- [Scout Report](scout/scout-01-recording-timeline.md) - Current timeline structure
- TimelineEditor: `/Users/nghia/Projects/openscreen/src/components/video-editor/timeline/TimelineEditor.tsx`
- Row component: `/Users/nghia/Projects/openscreen/src/components/video-editor/timeline/Row.tsx`
- Types: `/Users/nghia/Projects/openscreen/src/components/video-editor/types.ts`

## Overview

| Property | Value |
|----------|-------|
| Priority | P1 - Editor integration |
| Status | pending |
| Effort | 4h |
| Description | Add audio and camera tracks to timeline editor with waveform visualization and sync via shared playhead |

## Key Insights

- dnd-timeline uses Row components with unique IDs
- Current rows: row-zoom, row-trim, row-annotation
- New rows: row-screen-video, row-camera-video, row-mic-audio, row-system-audio
- All rows sync via same `currentTime` playhead
- MVP: Color blocks for audio (waveform later)
- Items span full recording duration

## Requirements

### Functional
- Screen video track row (primary, always visible)
- Camera video track row (if camera was recorded)
- Microphone audio track row (if mic was recorded)
- System audio track row (if system audio was recorded)
- Audio waveform visualization (MVP: solid color blocks)
- Track labels in sidebar
- Mute/solo toggles per track (future)
- Volume sliders (future)

### Non-Functional
- Smooth scrolling with multiple tracks
- Minimal re-renders
- Track row heights consistent with existing rows

## Architecture

```
Timeline Structure:
┌─────────────────────────────────────────────┐
│ ▶ Screen     [████████████████████████████] │ <- row-screen-video
│ 🎥 Camera    [████████████████████████████] │ <- row-camera-video
│ 🎤 Mic       [▁▂▃▅▇▃▂▁▃▅▇▃▂▁▃▅▇▃▂▁▃▅▇▃▂▁] │ <- row-mic-audio (waveform)
│ 🔊 System    [▁▂▃▅▇▃▂▁▃▅▇▃▂▁▃▅▇▃▂▁▃▅▇▃▂▁] │ <- row-system-audio
├─────────────────────────────────────────────┤
│ Zoom         [    ▓▓▓▓▓     ]                │ <- existing row-zoom
│ Trim         [▓▓▓          ▓▓▓]              │ <- existing row-trim
│ Annotation   [   📝   ]                       │ <- existing row-annotation
└─────────────────────────────────────────────┘
```

## Related Code Files

| File | Action | Purpose |
|------|--------|---------|
| `/Users/nghia/Projects/openscreen/src/components/video-editor/types.ts` | MODIFY | Add AudioTrack, VideoTrack types |
| `/Users/nghia/Projects/openscreen/src/components/video-editor/timeline/media-track-row.tsx` | CREATE | Reusable media track row |
| `/Users/nghia/Projects/openscreen/src/components/video-editor/timeline/audio-waveform.tsx` | CREATE | Waveform visualization |
| `/Users/nghia/Projects/openscreen/src/components/video-editor/timeline/TimelineEditor.tsx` | MODIFY | Add media track rows |
| `/Users/nghia/Projects/openscreen/src/components/video-editor/VideoEditor.tsx` | MODIFY | Pass track data to timeline |

## Implementation Steps

### 1. Add Track Types (20 min)

Modify `/Users/nghia/Projects/openscreen/src/components/video-editor/types.ts`:

```typescript
export type MediaTrackType = 'screen' | 'camera' | 'mic' | 'system-audio';

export interface MediaTrack {
  id: string;
  type: MediaTrackType;
  label: string;
  filePath: string;
  startMs: number;
  endMs: number;
  muted: boolean;
  volume: number; // 0-100
}

export const MEDIA_TRACK_ROW_IDS: Record<MediaTrackType, string> = {
  'screen': 'row-screen-video',
  'camera': 'row-camera-video',
  'mic': 'row-mic-audio',
  'system-audio': 'row-system-audio',
};

export const MEDIA_TRACK_COLORS: Record<MediaTrackType, string> = {
  'screen': '#3b82f6', // blue
  'camera': '#8b5cf6', // purple
  'mic': '#22c55e',    // green
  'system-audio': '#f59e0b', // amber
};

export const MEDIA_TRACK_ICONS: Record<MediaTrackType, string> = {
  'screen': '▶',
  'camera': '🎥',
  'mic': '🎤',
  'system-audio': '🔊',
};
```

### 2. Create MediaTrackRow Component (60 min)

Create `/Users/nghia/Projects/openscreen/src/components/video-editor/timeline/media-track-row.tsx`:

```typescript
import { useRow, useItem } from 'dnd-timeline';
import type { MediaTrack } from '../types';
import { MEDIA_TRACK_COLORS, MEDIA_TRACK_ICONS, MEDIA_TRACK_ROW_IDS } from '../types';

interface MediaTrackRowProps {
  track: MediaTrack;
  durationMs: number;
}

export function MediaTrackRow({ track, durationMs }: MediaTrackRowProps) {
  const rowId = MEDIA_TRACK_ROW_IDS[track.type];
  const { setNodeRef, rowWrapperStyle, rowStyle } = useRow({ id: rowId });

  const color = MEDIA_TRACK_COLORS[track.type];
  const icon = MEDIA_TRACK_ICONS[track.type];

  const itemSpan = {
    start: new Date(track.startMs).getTime(),
    end: new Date(track.endMs).getTime(),
  };

  return (
    <div
      className="border-b border-[#18181b] bg-[#18181b]"
      style={{ ...rowWrapperStyle, minHeight: 40, marginBottom: 4 }}
    >
      {/* Track label sidebar */}
      <div
        className="absolute left-0 top-0 bottom-0 flex items-center px-2 text-xs text-white/60 z-10"
        style={{ width: 80 }}
      >
        <span className="mr-1">{icon}</span>
        <span className="truncate">{track.label}</span>
      </div>

      {/* Track content */}
      <div ref={setNodeRef} style={{ ...rowStyle, marginLeft: 80 }}>
        <MediaTrackItem track={track} color={color} />
      </div>
    </div>
  );
}

interface MediaTrackItemProps {
  track: MediaTrack;
  color: string;
}

function MediaTrackItem({ track, color }: MediaTrackItemProps) {
  const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
    id: track.id,
    rowId: MEDIA_TRACK_ROW_IDS[track.type],
    span: {
      start: new Date(track.startMs).getTime(),
      end: new Date(track.endMs).getTime(),
    },
    disabled: true, // Media tracks are not draggable
  });

  const isAudio = track.type === 'mic' || track.type === 'system-audio';

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        ...itemStyle,
        height: 32,
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          ...itemContentStyle,
          background: isAudio
            ? `linear-gradient(90deg, ${color}40, ${color}60, ${color}40)`
            : color,
          height: '100%',
          opacity: track.muted ? 0.3 : 1,
        }}
      >
        {isAudio && (
          <AudioWaveformPlaceholder color={color} />
        )}
      </div>
    </div>
  );
}

// MVP: Simple animated pattern instead of real waveform
function AudioWaveformPlaceholder({ color }: { color: string }) {
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{
        background: `repeating-linear-gradient(
          90deg,
          ${color}20 0px,
          ${color}40 4px,
          ${color}60 8px,
          ${color}40 12px,
          ${color}20 16px
        )`,
      }}
    />
  );
}
```

### 3. Create AudioWaveform Component (60 min - Optional for V1)

Create `/Users/nghia/Projects/openscreen/src/components/video-editor/timeline/audio-waveform.tsx`:

```typescript
import { useRef, useEffect, useState } from 'react';

interface AudioWaveformProps {
  audioUrl: string;
  color: string;
  width: number;
  height: number;
}

export function AudioWaveform({ audioUrl, color, width, height }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);

  // Load and analyze audio
  useEffect(() => {
    async function loadPeaks() {
      try {
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Get raw audio data
        const channelData = audioBuffer.getChannelData(0);
        const samples = channelData.length;
        const samplesPerPeak = Math.floor(samples / width);

        const peakData: number[] = [];
        for (let i = 0; i < width; i++) {
          const start = i * samplesPerPeak;
          const end = start + samplesPerPeak;
          let max = 0;
          for (let j = start; j < end; j++) {
            const abs = Math.abs(channelData[j]);
            if (abs > max) max = abs;
          }
          peakData.push(max);
        }

        setPeaks(peakData);
        audioContext.close();
      } catch (error) {
        console.error('Failed to load audio waveform:', error);
      }
    }

    if (audioUrl) {
      loadPeaks();
    }
  }, [audioUrl, width]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;

    const centerY = height / 2;
    const maxHeight = height * 0.8;

    for (let i = 0; i < peaks.length; i++) {
      const barHeight = peaks[i] * maxHeight;
      const x = i;
      const y = centerY - barHeight / 2;
      ctx.fillRect(x, y, 1, barHeight);
    }
  }, [peaks, color, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
```

### 4. Modify TimelineEditor (60 min)

Modify `/Users/nghia/Projects/openscreen/src/components/video-editor/timeline/TimelineEditor.tsx`:

Key changes:
- Accept `mediaTracks: MediaTrack[]` prop
- Render MediaTrackRow for each track before zoom/trim/annotation rows
- Add section divider between media tracks and editing tracks

```typescript
// Add imports
import { MediaTrackRow } from './media-track-row';
import type { MediaTrack } from '../types';

// Add prop
interface TimelineEditorProps {
  // ... existing props
  mediaTracks?: MediaTrack[];
}

// In render, before zoom row:
{mediaTracks && mediaTracks.length > 0 && (
  <>
    {mediaTracks.map((track) => (
      <MediaTrackRow key={track.id} track={track} durationMs={durationMs} />
    ))}
    <div className="h-2 bg-[#0f0f0f]" /> {/* Divider */}
  </>
)}
```

### 5. Update VideoEditor to Pass Track Data (30 min)

Modify `/Users/nghia/Projects/openscreen/src/components/video-editor/VideoEditor.tsx`:

- Add state for `mediaTracks: MediaTrack[]`
- Parse recording metadata to determine which tracks exist
- Pass tracks to TimelineEditor

## Todo List

- [ ] Add track types to `src/components/video-editor/types.ts`
- [ ] Create `src/components/video-editor/timeline/media-track-row.tsx`
- [ ] Create `src/components/video-editor/timeline/audio-waveform.tsx` (optional for V1)
- [ ] Modify `TimelineEditor.tsx` to render media track rows
- [ ] Modify `VideoEditor.tsx` to pass track data
- [ ] Test with screen-only recording (should work as before)
- [ ] Test with camera recording
- [ ] Test with microphone recording
- [ ] Test with system audio recording
- [ ] Test with all tracks present
- [ ] Verify playhead syncs across all tracks
- [ ] Test timeline scrolling performance

## Success Criteria

- [ ] Screen video track always visible
- [ ] Camera track appears when camera was recorded
- [ ] Mic audio track appears with color block (MVP)
- [ ] System audio track appears with color block (MVP)
- [ ] Playhead moves through all tracks simultaneously
- [ ] Track labels visible in sidebar
- [ ] No performance degradation with 4 tracks
- [ ] Muted track appears dimmed

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Timeline performance with many tracks | Low | Medium | Virtualize if needed |
| dnd-timeline conflicts with new rows | Low | Medium | Use unique row IDs |
| Waveform rendering too slow | Medium | Low | Use color blocks for MVP |
| Audio decoding fails | Low | Medium | Graceful fallback to color block |

## Security Considerations

- Audio files read from local filesystem only
- No external network requests for waveform data

## Next Steps

After this phase:
- Add mute/solo toggle buttons
- Add volume sliders
- Implement real waveform rendering
- Add track reordering
- Export with track mixing options
