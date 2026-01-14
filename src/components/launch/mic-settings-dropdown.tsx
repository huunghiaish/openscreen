/**
 * Microphone device selection dropdown with audio level meter.
 * Shows real-time VU meter when mic is active.
 */
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

  const levelMeterContent = isActive ? (
    <div className="px-3 py-2">
      <label className="text-xs text-white/60 block mb-2" id="mic-level-label">
        Input Level
      </label>
      <AudioLevelMeter level={audioLevel} size="medium" />
    </div>
  ) : null;

  return (
    <DeviceDropdown
      icon={
        isActive ? (
          <FiMic size={14} className="text-green-400" />
        ) : (
          <FiMicOff size={14} className="text-white/50" />
        )
      }
      ariaLabel="Select microphone"
      devices={microphones}
      selectedDeviceId={selectedMicId}
      onSelectDevice={onSelectMic}
      disabled={disabled}
      headerContent={levelMeterContent}
    />
  );
}
