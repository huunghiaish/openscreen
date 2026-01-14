/**
 * Camera device selection dropdown.
 * Click icon to toggle camera on/off, click arrow for device selection.
 */
import { useRef, useCallback } from 'react';
import { FiVideo, FiVideoOff } from 'react-icons/fi';
import { DeviceDropdown } from './device-dropdown';

interface CameraSettingsDropdownProps {
  cameras: MediaDeviceInfo[];
  selectedCameraId: string | null;
  onSelectCamera: (deviceId: string | null) => void;
  disabled?: boolean;
}

export function CameraSettingsDropdown({
  cameras,
  selectedCameraId,
  onSelectCamera,
  disabled = false,
}: CameraSettingsDropdownProps) {
  const isActive = selectedCameraId !== null;
  // Track last used camera for toggle-on behavior
  const lastUsedCameraRef = useRef<string | null>(selectedCameraId);

  // Update last used camera when a camera is selected (not when deselected)
  const handleCameraSelect = useCallback((deviceId: string | null) => {
    if (deviceId !== null) {
      lastUsedCameraRef.current = deviceId;
    }
    onSelectCamera(deviceId);
  }, [onSelectCamera]);

  return (
    <DeviceDropdown
      icon={
        isActive ? (
          <FiVideo size={14} className="text-green-400" />
        ) : (
          <FiVideoOff size={14} className="text-white/50" />
        )
      }
      ariaLabel="Toggle camera"
      devices={cameras}
      selectedDeviceId={selectedCameraId}
      onSelectDevice={handleCameraSelect}
      disabled={disabled}
      enableClickToggle={true}
      lastUsedDeviceId={lastUsedCameraRef.current}
    />
  );
}
