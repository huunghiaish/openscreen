/**
 * TypeScript types for media device enumeration and selection.
 * Used by useMediaDevices hook for camera/mic device management.
 */

/** Permission status for media device access */
export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unknown';

/** State shape for media device tracking */
export interface MediaDeviceState {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  selectedCameraId: string | null;
  selectedMicId: string | null;
  systemAudioEnabled: boolean;
  permissionStatus: PermissionStatus;
}

/** Return type for useMediaDevices hook */
export interface UseMediaDevicesReturn {
  /** Available video input devices */
  cameras: MediaDeviceInfo[];
  /** Available audio input devices */
  microphones: MediaDeviceInfo[];
  /** Currently selected camera device ID */
  selectedCameraId: string | null;
  /** Currently selected microphone device ID */
  selectedMicId: string | null;
  /** Whether system audio capture is enabled */
  systemAudioEnabled: boolean;
  /** Set selected camera by device ID (validates against available devices) */
  setSelectedCameraId: (id: string | null) => void;
  /** Set selected microphone by device ID (validates against available devices) */
  setSelectedMicId: (id: string | null) => void;
  /** Toggle system audio capture */
  setSystemAudioEnabled: (enabled: boolean) => void;
  /** Refresh device list from system */
  refreshDevices: () => Promise<void>;
  /** Request camera/mic permissions from user */
  requestPermissions: () => Promise<boolean>;
  /** Current permission status */
  permissionStatus: PermissionStatus;
  /** Loading state during device enumeration */
  isLoading: boolean;
  /** Whether system audio is supported on this platform */
  systemAudioSupported: boolean;
  /** Error message if device enumeration fails */
  error: string | null;
}

/** localStorage keys for device selection persistence */
export const DEVICE_STORAGE_KEYS = {
  SELECTED_CAMERA: 'openscreen:selectedCameraId',
  SELECTED_MIC: 'openscreen:selectedMicId',
  SYSTEM_AUDIO_ENABLED: 'openscreen:systemAudioEnabled',
} as const;

/** Camera overlay position options for preview during recording */
export type CameraPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Camera overlay size options */
export type CameraSize = 'small' | 'medium' | 'large';

/** Pixel dimensions for each camera size */
export const CAMERA_SIZE_PIXELS: Record<CameraSize, { width: number; height: number }> = {
  small: { width: 160, height: 120 },
  medium: { width: 240, height: 180 },
  large: { width: 320, height: 240 },
};

/** State for camera overlay during recording */
export interface CameraOverlayState {
  enabled: boolean;
  position: CameraPosition;
  size: CameraSize;
  deviceId: string | null;
}
