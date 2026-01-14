/**
 * Camera device selection dropdown with position/size settings.
 * Shows camera list and overlay configuration options.
 */
import { FiVideo, FiVideoOff } from 'react-icons/fi';
import { DeviceDropdown } from './device-dropdown';
import type { CameraPosition, CameraSize } from '@/types/media-devices';

interface CameraSettingsDropdownProps {
  cameras: MediaDeviceInfo[];
  selectedCameraId: string | null;
  onSelectCamera: (deviceId: string | null) => void;
  position: CameraPosition;
  onPositionChange: (position: CameraPosition) => void;
  size: CameraSize;
  onSizeChange: (size: CameraSize) => void;
  disabled?: boolean;
}

const POSITIONS: { value: CameraPosition; label: string }[] = [
  { value: 'top-left', label: '↖ Top Left' },
  { value: 'top-right', label: '↗ Top Right' },
  { value: 'bottom-left', label: '↙ Bottom Left' },
  { value: 'bottom-right', label: '↘ Bottom Right' },
];

const SIZES: { value: CameraSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

export function CameraSettingsDropdown({
  cameras,
  selectedCameraId,
  onSelectCamera,
  position,
  onPositionChange,
  size,
  onSizeChange,
  disabled = false,
}: CameraSettingsDropdownProps) {
  const isActive = selectedCameraId !== null;

  const settingsContent = (
    <>
      {/* Position selector */}
      <div className="px-3 py-2">
        <label htmlFor="camera-position" className="text-xs text-white/60 block mb-1">
          Position
        </label>
        <select
          id="camera-position"
          value={position}
          onChange={(e) => onPositionChange(e.target.value as CameraPosition)}
          className="w-full bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-sm text-white cursor-pointer"
          style={{ outline: 'none' }}
        >
          {POSITIONS.map((p) => (
            <option key={p.value} value={p.value} className="bg-gray-800">
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Size selector */}
      <div className="px-3 py-2">
        <label htmlFor="camera-size" className="text-xs text-white/60 block mb-1">
          Size
        </label>
        <select
          id="camera-size"
          value={size}
          onChange={(e) => onSizeChange(e.target.value as CameraSize)}
          className="w-full bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-sm text-white cursor-pointer"
          style={{ outline: 'none' }}
        >
          {SIZES.map((s) => (
            <option key={s.value} value={s.value} className="bg-gray-800">
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );

  return (
    <DeviceDropdown
      icon={
        isActive ? (
          <FiVideo size={14} className="text-green-400" />
        ) : (
          <FiVideoOff size={14} className="text-white/50" />
        )
      }
      ariaLabel="Select camera"
      devices={cameras}
      selectedDeviceId={selectedCameraId}
      onSelectDevice={onSelectCamera}
      disabled={disabled}
      headerContent={settingsContent}
    />
  );
}
