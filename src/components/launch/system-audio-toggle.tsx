/**
 * System audio toggle button with unsupported state tooltip.
 * Shows warning for macOS versions < 13.2 that don't support ScreenCaptureKit audio.
 */
import { FiVolume2, FiVolumeX } from 'react-icons/fi';
import { Button } from '@/components/ui/button';

interface SystemAudioToggleProps {
  enabled: boolean;
  onToggle: () => void;
  supported: boolean;
  unsupportedMessage: string | null;
  disabled?: boolean;
  /** Audio level 0-100 for VU meter display */
  audioLevel?: number;
}

export function SystemAudioToggle({
  enabled,
  onToggle,
  supported,
  unsupportedMessage,
  disabled = false,
  audioLevel = 0,
}: SystemAudioToggleProps) {
  const isClickable = supported && !disabled;

  return (
    <div className="relative group flex items-center gap-1">
      <Button
        variant="link"
        size="icon"
        onClick={isClickable ? onToggle : undefined}
        disabled={disabled || !supported}
        className="bg-transparent hover:bg-transparent px-0"
        style={{ opacity: enabled && supported ? 1 : 0.5, cursor: isClickable ? 'pointer' : 'not-allowed' }}
        title={supported ? (enabled ? 'Disable system audio' : 'Enable system audio') : unsupportedMessage || 'Not supported'}
      >
        {enabled && supported ? (
          <FiVolume2 size={14} className="text-green-400" />
        ) : (
          <FiVolumeX size={14} className="text-white/50" />
        )}
      </Button>

      {/* Audio level meter - only show when enabled */}
      {enabled && supported && (
        <div
          className="w-1 h-4 rounded-full bg-white/20 overflow-hidden"
          title={`System audio level: ${audioLevel}%`}
        >
          <div
            className="w-full bg-green-400 transition-all duration-75"
            style={{ height: `${audioLevel}%`, marginTop: `${100 - audioLevel}%` }}
          />
        </div>
      )}

      {/* Tooltip for unsupported systems */}
      {!supported && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-lg text-xs text-amber-400 bg-black/90 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50"
          style={{ maxWidth: 220, whiteSpace: 'normal', textAlign: 'center' }}
        >
          {unsupportedMessage || 'System audio not supported'}
        </div>
      )}
    </div>
  );
}
