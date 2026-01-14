/**
 * Microphone device selection dropdown with audio level meter.
 * Shows real-time VU meter when mic is active.
 * Click icon to toggle mic on/off, click arrow for device selection.
 */
import { useRef, useCallback } from 'react';
import { FiMic, FiMicOff } from 'react-icons/fi';
import { DeviceDropdown } from './device-dropdown';
import { AudioLevelMeter } from '@/components/audio-level-meter';

interface MicSettingsDropdownProps {
  microphones: MediaDeviceInfo[];
  selectedMicId: string | null;
  onSelectMic: (deviceId: string | null) => void;
  audioLevel: number;
  disabled?: boolean;
}

export function MicSettingsDropdown({
  microphones,
  selectedMicId,
  onSelectMic,
  audioLevel,
  disabled = false,
}: MicSettingsDropdownProps) {
  const isActive = selectedMicId !== null;
  // Track last used mic for toggle-on behavior
  const lastUsedMicRef = useRef<string | null>(selectedMicId);

  // Update last used mic when a mic is selected (not when deselected)
  const handleMicSelect = useCallback((deviceId: string | null) => {
    if (deviceId !== null) {
      lastUsedMicRef.current = deviceId;
    }
    onSelectMic(deviceId);
  }, [onSelectMic]);

  return (
    <div className="flex items-center gap-0.5">
      <DeviceDropdown
        icon={
          isActive ? (
            <FiMic size={14} className="text-green-400" />
          ) : (
            <FiMicOff size={14} className="text-white/50" />
          )
        }
        ariaLabel="Toggle microphone"
        devices={microphones}
        selectedDeviceId={selectedMicId}
        onSelectDevice={handleMicSelect}
        disabled={disabled}
        enableClickToggle={true}
        lastUsedDeviceId={lastUsedMicRef.current}
      />
      {/* Inline level indicator visible when mic is active */}
      {isActive && <AudioLevelMeter level={audioLevel} size="inline" />}
    </div>
  );
}
