/**
 * Hook for managing camera overlay window visibility.
 * Handles show/hide logic based on recording state and preview settings.
 * Includes safe Electron API access with runtime validation.
 */
import { useEffect, useRef } from 'react';

/** Extended Electron API with camera overlay methods */
interface CameraOverlayAPI {
  showCameraOverlay?: (deviceId: string) => Promise<void>;
  hideCameraOverlay?: () => Promise<void>;
}

/** Safely get camera overlay API methods with runtime validation */
function getCameraOverlayAPI(): CameraOverlayAPI {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return {};
  }
  const api = window.electronAPI as CameraOverlayAPI;
  return {
    showCameraOverlay: typeof api.showCameraOverlay === 'function' ? api.showCameraOverlay : undefined,
    hideCameraOverlay: typeof api.hideCameraOverlay === 'function' ? api.hideCameraOverlay : undefined,
  };
}

interface UseCameraOverlayOptions {
  /** Whether recording is active */
  recording: boolean;
  /** Whether camera is enabled (device selected) */
  cameraEnabled: boolean;
  /** Active camera device ID */
  cameraDeviceId: string | null;
  /** Whether camera preview is enabled */
  previewEnabled: boolean;
}

/**
 * Manages camera overlay window based on recording and preview state.
 * Shows overlay when: recording starts with camera+preview, or preview enabled while not recording.
 * Hides overlay when: recording stops, preview disabled, or camera deselected.
 */
export function useCameraOverlay({
  recording,
  cameraEnabled,
  cameraDeviceId,
  previewEnabled,
}: UseCameraOverlayOptions): void {
  const prevRecordingRef = useRef(recording);
  const prevPreviewRef = useRef(previewEnabled);
  const prevCameraEnabledRef = useRef(cameraEnabled);
  const initializedRef = useRef(false);

  // Handle initial mount - show overlay if camera already enabled
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // On mount, if camera is enabled with preview, show overlay
    if (!recording && cameraEnabled && cameraDeviceId && previewEnabled) {
      const api = getCameraOverlayAPI();
      api.showCameraOverlay?.(cameraDeviceId);
    }
  }, [recording, cameraEnabled, cameraDeviceId, previewEnabled]);

  // Handle recording state changes
  useEffect(() => {
    const wasRecording = prevRecordingRef.current;
    prevRecordingRef.current = recording;

    const api = getCameraOverlayAPI();

    if (recording && !wasRecording && cameraEnabled && cameraDeviceId && previewEnabled) {
      // Recording just started with camera enabled and preview on
      api.showCameraOverlay?.(cameraDeviceId);
    } else if (!recording && wasRecording) {
      // Recording just stopped - always hide overlay
      api.hideCameraOverlay?.();
    }
  }, [recording, cameraEnabled, cameraDeviceId, previewEnabled]);

  // Handle preview toggle (only when not recording)
  useEffect(() => {
    const wasPreviewEnabled = prevPreviewRef.current;
    prevPreviewRef.current = previewEnabled;

    // Only respond to preview toggle changes, not recording state
    if (wasPreviewEnabled === previewEnabled) return;
    if (recording) return;

    const api = getCameraOverlayAPI();

    if (previewEnabled && cameraEnabled && cameraDeviceId) {
      api.showCameraOverlay?.(cameraDeviceId);
    } else if (!previewEnabled) {
      api.hideCameraOverlay?.();
    }
  }, [previewEnabled, cameraEnabled, cameraDeviceId, recording]);

  // Handle camera enable/disable (only when not recording)
  useEffect(() => {
    const wasCameraEnabled = prevCameraEnabledRef.current;
    prevCameraEnabledRef.current = cameraEnabled;

    // Skip if no change
    if (wasCameraEnabled === cameraEnabled) return;
    if (recording) return;

    const api = getCameraOverlayAPI();

    if (cameraEnabled && previewEnabled && cameraDeviceId) {
      // Camera just enabled - show overlay
      api.showCameraOverlay?.(cameraDeviceId);
    } else if (!cameraEnabled && wasCameraEnabled) {
      // Camera just disabled - hide overlay
      api.hideCameraOverlay?.();
    }
  }, [cameraEnabled, previewEnabled, cameraDeviceId, recording]);
}
