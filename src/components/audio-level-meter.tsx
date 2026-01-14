/**
 * VU-style audio level meter component.
 * Displays real-time audio level as animated bars.
 * Green bars for normal levels, red for high (clipping warning).
 */

interface AudioLevelMeterProps {
  /** Audio level 0-100 */
  level: number;
  /** Whether mic is muted (dims display) */
  muted?: boolean;
  /** Display size variant */
  size?: 'inline' | 'small' | 'medium';
}

export function AudioLevelMeter({
  level,
  muted = false,
  size = 'small',
}: AudioLevelMeterProps) {
  // Inline variant: single thin bar for HUD display
  if (size === 'inline') {
    return (
      <div
        style={{
          position: 'relative',
          width: 3,
          height: 14,
          backgroundColor: 'rgba(255,255,255,0.15)',
          borderRadius: 2,
          overflow: 'hidden',
          opacity: muted ? 0.3 : 1,
        }}
      >
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: `${level}%`,
            backgroundColor: level > 80 ? '#ef4444' : '#22c55e',
            borderRadius: 2,
            transition: 'height 50ms, background-color 50ms',
          }}
        />
      </div>
    );
  }

  const height = size === 'small' ? 16 : 24;
  const barCount = size === 'small' ? 8 : 12;

  // Calculate how many bars should be active based on level
  const activeBars = Math.round((level / 100) * barCount);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 2,
        height,
        opacity: muted ? 0.3 : 1,
      }}
    >
      {Array.from({ length: barCount }, (_, i) => {
        const isActive = i < activeBars;
        // Top 20% of bars are red zone (clipping warning)
        const isHigh = i >= barCount * 0.8;

        let color = 'rgba(255,255,255,0.2)';
        if (isActive) {
          color = isHigh ? '#ef4444' : '#22c55e'; // red-500 : green-500
        }

        return (
          <div
            key={i}
            style={{
              width: 4,
              // Bars grow taller towards the end (30% to 100% height)
              height: `${30 + (i / barCount) * 70}%`,
              backgroundColor: color,
              borderRadius: 1,
              transition: 'background-color 50ms',
            }}
          />
        );
      })}
    </div>
  );
}
