import { useRow, useItem, useTimelineContext } from "dnd-timeline";
import type { MediaTrack } from "../types";
import { MEDIA_TRACK_COLORS, MEDIA_TRACK_ICONS, MEDIA_TRACK_ROW_IDS } from "../types";

interface MediaTrackRowProps {
  track: MediaTrack;
}

/**
 * MediaTrackRow renders a single media track (screen, camera, mic, system-audio)
 * in the timeline with a label sidebar and track visualization.
 */
export function MediaTrackRow({ track }: MediaTrackRowProps) {
  const rowId = MEDIA_TRACK_ROW_IDS[track.type];
  const { setNodeRef, rowWrapperStyle, rowStyle } = useRow({ id: rowId });

  const icon = MEDIA_TRACK_ICONS[track.type];

  return (
    <div
      className="border-b border-[#18181b] bg-[#18181b]"
      style={{ ...rowWrapperStyle, minHeight: 40, marginBottom: 2 }}
    >
      <div ref={setNodeRef} style={rowStyle}>
        <MediaTrackItem track={track} />
      </div>
      {/* Track label sidebar - positioned absolutely to overlay */}
      <div
        className="absolute left-0 top-0 bottom-0 flex items-center px-3 text-xs text-white/60 z-20 pointer-events-none"
        style={{ width: 80 }}
      >
        <span className="mr-1.5">{icon}</span>
        <span className="truncate">{track.label}</span>
      </div>
    </div>
  );
}

interface MediaTrackItemProps {
  track: MediaTrack;
}

/**
 * Renders the media track item block that spans the track duration.
 * Audio tracks display a waveform pattern, video tracks show solid color.
 */
function MediaTrackItem({ track }: MediaTrackItemProps) {
  const { sidebarWidth } = useTimelineContext();
  const color = MEDIA_TRACK_COLORS[track.type];

  const rowId = MEDIA_TRACK_ROW_IDS[track.type];
  const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
    id: track.id,
    span: {
      start: track.startMs,
      end: track.endMs,
    },
    data: { rowId },
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
        height: 28,
        borderRadius: 4,
        overflow: 'hidden',
        marginLeft: sidebarWidth > 0 ? 0 : 80, // Account for label sidebar when no dnd-timeline sidebar
      }}
    >
      <div
        style={{
          ...itemContentStyle,
          background: isAudio
            ? `linear-gradient(90deg, ${color}40, ${color}60, ${color}40)`
            : color,
          height: '100%',
          opacity: track.muted ? 0.3 : 0.8,
          borderRadius: 4,
        }}
      >
        {isAudio && <AudioWaveformPlaceholder color={color} />}
      </div>
    </div>
  );
}

/**
 * MVP placeholder for audio waveform visualization.
 * Uses a repeating gradient pattern to simulate waveform appearance.
 * Real waveform rendering can be implemented in a future phase.
 */
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
