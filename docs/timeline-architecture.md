# Timeline & Multi-Track Architecture

## Multi-Track Timeline System (Phase 06)

### Track Display System

Timeline layout with responsive grid and fixed label sidebar:

```
Timeline Layout (responsive grid)
│
├─ Label Sidebar (80px fixed width)
│  ├─ Icon (▶ 🎥 🎤 🔊)
│  └─ Label text (truncated if needed)
│
└─ Track Grid (flex, takes remaining width)
   ├─ MediaTrackRow (Screen video - always present)
   │  ├─ Duration block: startMs → endMs
   │  ├─ Color: Blue (#3b82f6)
   │  ├─ Styling: Solid color, opacity 0.8 (muted: 0.3)
   │  └─ Height: 28px
   │
   ├─ MediaTrackRow (Camera - if recorded)
   │  ├─ Duration block: startMs → endMs
   │  ├─ Color: Purple (#8b5cf6)
   │  ├─ Styling: Solid color, opacity 0.8 (muted: 0.3)
   │  └─ Height: 28px
   │
   ├─ MediaTrackRow (Microphone - if recorded)
   │  ├─ Duration block: startMs → endMs
   │  ├─ Color: Green (#22c55e)
   │  ├─ Styling: Gradient waveform pattern, opacity 0.8 (muted: 0.3)
   │  └─ Height: 28px
   │
   ├─ MediaTrackRow (System Audio - if recorded on macOS 13.2+)
   │  ├─ Duration block: startMs → endMs
   │  ├─ Color: Amber (#f59e0b)
   │  ├─ Styling: Gradient waveform pattern, opacity 0.8 (muted: 0.3)
   │  └─ Height: 28px
   │
   └─ ZoomRegionRow (existing zoom regions)
      └─ Stacked below media tracks
```

### MediaTrack Type System

```typescript
// Track type enumeration
type MediaTrackType = 'screen' | 'camera' | 'mic' | 'system-audio';

// Track data structure
interface MediaTrack {
  id: string;              // Unique identifier
  type: MediaTrackType;    // Track category
  label: string;           // Display name (e.g., "Screen", "Camera", "Microphone")
  filePath: string;        // Path to media file
  startMs: number;         // Track start time (milliseconds)
  endMs: number;           // Track end time (milliseconds)
  muted: boolean;          // Audio mute state
  volume: number;          // Volume level (0-100)
}

// Track building process in VideoEditor
buildMediaTracks({
  videoPath,              // Main recording (screen)
  cameraVideoPath,        // Camera video if recorded
  micAudioPath,          // Microphone audio if recorded
  systemAudioPath        // System audio if recorded (macOS only)
})
```

### Visual Design

**Track Row Structure**:
- Total height per track: 40px (28px item + 2px margin + 10px padding)
- Sidebar width: 80px (left-positioned, overlays content)
- Track item: Spans full timeline width, responsive
- Border: Bottom border (#18181b) separates tracks
- Z-index: Sidebar z-20 (above dnd-timeline content)

**Color Scheme** (by track type):
| Track Type | Color | Icon | Purpose |
|-----------|-------|------|---------|
| Screen | Blue (#3b82f6) | ▶ | Main recording video |
| Camera | Purple (#8b5cf6) | 🎥 | Optional camera video |
| Microphone | Green (#22c55e) | 🎤 | Optional mic audio |
| System Audio | Amber (#f59e0b) | 🔊 | Optional system audio (macOS) |

**Waveform Visualization** (audio tracks only):
- MVP implementation: Repeating linear gradient pattern
- Pattern: 8px cycle alternating color opacity (20% → 50% → 70% → 50% → 20%)
- Muted state: Entire track opacity reduced to 0.3
- Video tracks: Solid color blocks (no waveform)

### File Path Resolution

```
Main Recording (always present)
└─ recording-{timestamp}.webm → Screen track

Camera (optional)
└─ camera-{timestamp}.webm (derived from recording timestamp)

Microphone (optional)
└─ mic-{timestamp}.webm (derived from recording timestamp)

System Audio (optional, macOS 13.2+ only)
└─ system-audio-{timestamp}.webm (derived from recording timestamp)

Path resolution pattern:
- Extract timestamp from main video path
- Construct alternate filenames with same timestamp
- Check file existence via IPC handlers
- Return null if file doesn't exist
- All paths validated for security (no directory traversal)
```

### Track Loading Process

```
1. VideoEditor mounts
   └─ Wait for video metadata loaded

2. useEffect hook triggers
   ├─ Load main video metadata
   ├─ Call getMicAudioPath(mainVideoPath)
   │  └─ IPC handler returns mic-{timestamp}.webm path or null
   ├─ Call getSystemAudioPath(mainVideoPath)
   │  └─ IPC handler returns system-audio-{timestamp}.webm path or null
   ├─ Camera path already available from Phase 03
   └─ buildMediaTracks() creates MediaTrack[] array

3. buildMediaTracks() function
   ├─ Create screen track (always present)
   ├─ Add camera track if cameraVideoPath exists
   ├─ Add mic track if micAudioPath exists
   ├─ Add system audio track if systemAudioPath exists
   └─ Return sorted array [screen, camera, mic, system-audio]

4. setMediaTracks(tracks) updates state
   └─ TimelineEditor re-renders with all tracks

5. TimelineEditor rendering
   └─ Map tracks to MediaTrackRow components
      ├─ Each row renders with correct color/icon
      ├─ Layout calculated based on track duration
      └─ Positioned in dnd-timeline grid
```

## Component Integration

### TimelineEditor Updates

**Props**:
```typescript
interface TimelineEditorProps {
  mediaTracks?: MediaTrack[];  // Array of media tracks to display
  // ... existing props
}
```

**Rendering Logic**:
```typescript
{mediaTracks && mediaTracks.length > 0 && (
  {mediaTracks.map((track) => (
    <MediaTrackRow key={track.id} track={track} />
  ))}
)}
```

### VideoEditor State Management

```typescript
const [mediaTracks, setMediaTracks] = useState<MediaTrack[]>([]);

useEffect(() => {
  if (!videoPath) return;

  // Load audio file paths
  const micPath = await electronAPI.getMicAudioPath(videoPath);
  const systemAudioPath = await electronAPI.getSystemAudioPath(videoPath);

  // Build track array
  const tracks = buildMediaTracks({
    videoPath,
    cameraVideoPath,
    micAudioPath: micPath,
    systemAudioPath,
  });

  setMediaTracks(tracks);
}, [videoPath]);
```

## MediaTrackRow Component

**Location**: `src/components/video-editor/timeline/media-track-row.tsx` (116 LOC)

**Responsibilities**:
- Render track row with label sidebar
- Display track item block spanning duration
- Apply color and styling based on track type
- Render waveform visualization for audio tracks
- Handle muted state with opacity changes

**Key Features**:
- Uses dnd-timeline hooks (useRow, useItem)
- Non-draggable items (disabled: true)
- Audio waveform gradient pattern (MVP)
- Responsive sizing and layout
- ARIA-compliant structure

## Audio Waveform MVP

**Implementation**: `media-track-row.tsx` lines 99-115

```typescript
function AudioWaveformPlaceholder({ color }: { color: string }) {
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{
        background: `repeating-linear-gradient(
          90deg,
          ${color}20 0px,
          ${color}50 2px,
          ${color}70 4px,
          ${color}50 6px,
          ${color}20 8px
        )`,
      }}
    />
  );
}
```

**Pattern Details**:
- Direction: 90° (horizontal)
- Repeat interval: 8px
- Color opacity variations:
  - 0-2px: 20% opacity (edges)
  - 2-4px: 50% opacity (ramping up)
  - 4px center: 70% opacity (peak)
  - 4-6px: 50% opacity (ramping down)
  - 6-8px: 20% opacity (edges)

**Visual Effect**: Creates illusion of audio waveform peaks and valleys

**Future Enhancements**:
- Real waveform rendering from audio data
- Buffer analysis and peak detection
- Configurable waveform detail levels
- Performance optimization with canvas rendering

## Security Considerations

### Path Validation
- All audio file paths validated via IPC handlers
- Pattern matching ensures only valid filenames processed
- Directory traversal protection: paths must be within RECORDINGS_DIR
- File existence verified before path returned

### Type Safety
- TypeScript interfaces enforce track structure
- Enum prevents invalid track types
- Readonly audio file references (no direct file access)

## Performance Notes

- Track rendering: O(n) where n = number of tracks (typically 4)
- Waveform pattern: CSS gradient (zero cost, GPU accelerated)
- Layout: Uses dnd-timeline grid (optimized for frequent updates)
- Memory: Minimal (track metadata only, no audio buffers)

## Future Enhancements

1. **Real Waveform Rendering**
   - Decode audio data and calculate peaks
   - Canvas-based rendering for accuracy
   - Scalable detail levels based on zoom

2. **Track Controls**
   - Mute/unmute buttons per track
   - Volume sliders for audio tracks
   - Track deletion/hiding options

3. **Timeline Interactions**
   - Drag to reorder tracks
   - Split audio/video editing capability
   - Track synchronization controls

4. **Advanced Visualization**
   - Spectrum analyzer view
   - Peak level indicators
   - Audio levels in real-time
